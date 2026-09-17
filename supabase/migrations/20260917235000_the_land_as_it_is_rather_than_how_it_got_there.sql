-- The land as it is, rather than the whole story of how it got that way
--
-- Reported from a phone, with the boot screen on it: *"reading what has been
-- dug — 126,396"*, twenty-five seconds, and a fair question with it — "is
-- there a way to check only within what has been seen by the player? I'm
-- concerned this will be expensive on the server for players logging in and
-- out."
--
-- It is, and here is the shape of it. The browser has never downloaded the
-- land: it works the island out from the seed and the chart and then replays
-- `tile_change` over the top, which is every spadeful anybody has ever turned.
-- `compact_changes` settles that table at about one row per tile anybody has
-- ever touched — so the floor is the *area* that has been worked, and it only
-- ever goes up. A hundred and twenty-six thousand rows is thirteen megabytes
-- of JSON on every single login, and next month it is more.
--
-- Reading the land instead costs what the land costs, which is the area the
-- browser can draw and nothing to do with how hard it has been dug. A four
-- hundred tile square is about a megabyte before the transport gzips it, and
-- it is a megabyte whether that square was made yesterday or has had a town
-- built on it for a year.
--
-- So: a door that hands over a box of the island as it currently stands.
-- `land_tile` and `land_corner` have been kept current by every dig since the
-- island moved into Postgres — `land_set_tile` and its neighbours write them
-- on every change — and `land_window` has read bands of them for the
-- reconciling tool since the chunks went in. What was missing was a door a
-- player may knock on, and an x as well as a y.
--
-- ## The cursor comes first, and that is not a detail
--
-- The land is read at some moment, and the browser goes on listening from a
-- cursor. Take the cursor *after* the read and a change that lands in between
-- is in neither: not in the land that was read, and not in the history that is
-- replayed after it. It would be lost until something else happened to that
-- tile, which on a paved yard could be never.
--
-- Taken before, the same change is in both — read as part of the land and
-- replayed again a moment later. Laying a change twice is laying it once:
-- `layChange` sets absolute heights and an absolute tile, not deltas. So the
-- cursor is read first, deliberately, and the overlap is the point.
--
-- ## What it will not do
--
-- `land_ask` is generated from `LAND_ASK` in `keep.ts` like every other number
-- on this island, and it is a cap on one ask rather than a suggestion: without
-- it this door is a way to pull a hundred and thirty-eight megabytes of a 4096
-- island down four hundred rows at a time. The browser splits anything bigger
-- into several asks and reads what is near the body first.
--
-- It also answers only to somebody actually on the island, and goes through
-- `too_fast` like every other door, because a read this size is not one to
-- leave open to a loop.

create or replace function rpc_land_window(p_world uuid, p_x0 integer, p_y0 integer,
                                           p_x1 integer, p_y1 integer)
  returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  me uuid := auth.uid();
  v_size int; v_n bigint;
  x0 int; y0 int; x1 int; y1 int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select size into v_size from world where id = p_world;
  if v_size is null then raise exception 'no such island'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;

  -- Clamped rather than refused: a box that runs off the edge of the island is
  -- what a body standing near the shore asks for, every time.
  x0 := greatest(0, least(v_size - 1, p_x0));
  x1 := greatest(x0, least(v_size - 1, p_x1));
  y0 := greatest(0, least(v_size, p_y0));
  y1 := greatest(y0, least(v_size, p_y1));
  if (x1 - x0 + 1) > land_ask() or (y1 - y0 + 1) > land_ask() then
    raise exception 'ask for a smaller square of the island';
  end if;

  -- Before the land, and see the note above.
  select coalesce(max(n), 0) into v_n from tile_change where world_id = p_world;

  return jsonb_build_object(
    'n', v_n, 'x0', x0, 'y0', y0, 'x1', x1, 'y1', y1,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
          'y', c.y,
          'x0', x0,
          -- One more corner than there are tiles, in both directions: a row of
          -- squares from x0 to x1 stands on corners x0 to x1 + 1.
          'heights', encode(substring(c.heights from x0 * 2 + 1 for (x1 - x0 + 2) * 2), 'base64'),
          'dirt',    encode(substring(c.dirt    from x0     + 1 for (x1 - x0 + 2)), 'base64'),
          -- The row past the last row of squares comes for its corners alone.
          -- It has squares of its own on any island whose edge it is not, and
          -- sending them would lay a line of land outside the box that was
          -- asked for — right land in the wrong place, which is worse than no
          -- land, because the browser has not marked that row as read and will
          -- never think to ask for it again.
          'tiles',   case when c.y <= y1 then encode(substring(t.tiles from x0 + 1 for (x1 - x0 + 1)), 'base64') end,
          'data',    case when c.y <= y1 then encode(substring(t.data  from x0 + 1 for (x1 - x0 + 1)), 'base64') end,
          'rock',    case when c.y <= y1 then encode(substring(t.rock  from x0 + 1 for (x1 - x0 + 1)), 'base64') end)
        order by c.y)
      from land_corner c
      left join land_tile t on t.world_id = c.world_id and t.y = c.y
      -- One row past the last row of squares, for the same reason there is one
      -- more corner than there are squares across: a square at y1 stands on
      -- the corners at y1 and at y1 + 1. Asking only as far as y1 leaves the
      -- bottom edge of the window at whatever the browser had guessed, which
      -- is a seam of the generator's hillside along the foot of every window.
      where c.world_id = p_world and c.y between y0 and least(v_size, y1 + 1)), '[]'::jsonb));
end $fn$;

select private.lock_doors();
