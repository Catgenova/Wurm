-- Wildlife for an island sixteen kilometres across.
--
-- `creature_stock` laid an island's whole wildlife down the moment it opened:
-- one wild thing per 32 x 32 tiles, placed by throwing darts at the map until
-- enough of them stuck. On a 256-tile island that is sixty-four creatures and
-- a few hundred darts, and it is instant.
--
-- On a 4096-tile island it is **sixteen thousand three hundred and eighty-four
-- creatures and up to six hundred and fifty thousand darts**, each one reading
-- the height of a tile — which on a big island means detoasting a twelve
-- kilobyte scanline to look at two bytes of it. `rpc_ready` did not come back.
-- Found by opening one, which is the only way that was ever going to be found.
--
-- So wildlife settles like everything else here. Nothing ticks, and now
-- nothing is stocked until somebody is near enough for it to matter: a block
-- of country gets its animals the first time a person comes within a block of
-- it, and the row that says so is what stops it happening twice.
--
-- The density is unchanged — still one per 32 x 32 — so a small island gets
-- exactly the sixty-four it always got, in exactly one block, and nothing
-- about it is different. What changed is that a big island no longer has to
-- populate Cornwall before anybody can stand up in Kent.

/** How big a piece of country is stocked at a time. */
create or replace function stock_block() returns int language sql immutable as $$ select 256 $$;

/**
 * Which blocks have had their wildlife put out.
 *
 * It carries a `world_id`, which is what keeps `lock_doors()` from sweeping it
 * into the rulebook — it is not a definition, it is a note about one island.
 * Row level security on and no policy at all: nothing client-side has any
 * business reading it, and the functions below are `security definer` where
 * they need to be.
 */
create table if not exists world_stocked (
  world_id uuid not null references world(id) on delete cascade,
  bx int not null,
  by int not null,
  at timestamptz not null default now(),
  primary key (world_id, bx, by)
);
alter table world_stocked enable row level security;

/**
 * Put the wildlife out in one block of country.
 *
 * The row goes in *first*, and that is the whole of the locking: two people
 * walking into the same empty country at the same moment both try to claim it,
 * one of them wins the primary key, and the loser does nothing rather than
 * doubling the animals.
 */
create or replace function creature_stock_block(p_world uuid, p_bx int, p_by int) returns int
  language plpgsql as $$
declare v_size int; v_block int := stock_block(); v_want int; v_placed int := 0; v_tries int := 0;
        v_x int; v_y int; v_got text; v_x0 int; v_y0 int; v_w int; v_h int;
begin
  select w.size into v_size from world w where w.id = p_world;
  if v_size is null then return 0; end if;
  v_x0 := p_bx * v_block;
  v_y0 := p_by * v_block;
  if v_x0 < 0 or v_y0 < 0 or v_x0 >= v_size or v_y0 >= v_size then return 0; end if;

  insert into world_stocked (world_id, bx, by) values (p_world, p_bx, p_by) on conflict do nothing;
  if not found then return 0; end if;

  v_w := least(v_block, v_size - v_x0);
  v_h := least(v_block, v_size - v_y0);
  -- One wild thing per 32 x 32, which is the density the browser banks and the
  -- density `creature_target` always used. Only the reach has changed.
  v_want := (ceil(v_w / 32.0) * ceil(v_h / 32.0))::int;
  -- The old target had a floor of thirty-two so that a tiny island was not
  -- empty. That floor was about the island and not about a block, so it
  -- belongs to the block that *is* the island — and a small island is stocked
  -- exactly as it always was, in one block, with the same thirty-two darts.
  if v_size <= v_block then v_want := greatest(32, v_want); end if;
  while v_placed < v_want and v_tries < v_want * 40 loop
    v_tries := v_tries + 1;
    v_x := v_x0 + floor(random() * v_w)::int;
    v_y := v_y0 + floor(random() * v_h)::int;
    if not creature_tile_ok(p_world, v_x, v_y) then continue; end if;
    if centre_height(p_world, v_x, v_y) < 2 or on_deed(p_world, v_x, v_y) then continue; end if;
    v_got := pick_wild(p_world, v_x, v_y);
    if v_got is null or not suits(p_world, v_got, v_x, v_y) then continue; end if;
    -- Born at some point in the past, so the country is not all yearlings.
    perform creature_spawn(p_world, v_got, v_x + 0.5, v_y + 0.5, 'wild',
      now() - make_interval(secs => random() * 6 * 3600 * 1.6));
    v_placed := v_placed + 1;
  end loop;
  return v_placed;
end $$;

/**
 * Everything within a block of somewhere, stocked if it never has been.
 *
 * Nine blocks, so you never walk into country that has not been put out. The
 * count comes first and almost always answers nine, which makes this one index
 * probe on the hot path and nothing else — `rpc_move` calls it on every step.
 */
create or replace function creature_stock_near(p_world uuid, p_x double precision, p_y double precision) returns int
  language plpgsql as $$
declare v_block int := stock_block(); v_bx int; v_by int; v_n int := 0; i int; j int; v_have int;
begin
  v_bx := floor(p_x / v_block)::int;
  v_by := floor(p_y / v_block)::int;
  select count(*) into v_have from world_stocked s
    where s.world_id = p_world and s.bx between v_bx - 1 and v_bx + 1 and s.by between v_by - 1 and v_by + 1;
  if v_have >= 9 then return 0; end if;
  for j in v_by - 1 .. v_by + 1 loop
    for i in v_bx - 1 .. v_bx + 1 loop
      v_n := v_n + creature_stock_block(p_world, i, j);
    end loop;
  end loop;
  return v_n;
end $$;

/**
 * Opening an island stocks where people come ashore, and nothing else.
 *
 * The rest of it fills in as somebody walks into it. An island that has never
 * been walked still has wildlife on it that has been getting on with its life
 * the whole time — it simply has it in the country somebody has been to,
 * which is the only country where it could ever have been noticed.
 */
create or replace function rpc_ready(p_world uuid)
  returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w world;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into w from world where id = p_world;
  if not found then raise exception 'no such island'; end if;
  if w.made_by is distinct from me then raise exception 'that is not your island to open'; end if;
  if (select count(*) from land_corner where world_id = p_world) <> w.size + 1
     or (select count(*) from land_tile where world_id = p_world) <> w.size then
    raise exception 'the land is not all here yet';
  end if;
  update world set ready = true where id = p_world;
  perform creature_stock_near(p_world, w.spawn_x + 0.5, w.spawn_y + 0.5);
  return true;
end $$;

/**
 * And walking into empty country fills it in.
 *
 * `rpc_move` is the hottest thing in this database, so this is written to cost
 * one index probe when there is nothing to do, which is almost always: nine
 * rows found means the country around you is out, and it returns. The rest of
 * `rpc_move` is untouched — the reach ceiling that is the only thing between a
 * client and the far side of the island, the pull-back that is not an error,
 * and `drag_along`, which is still the one moment anything being carried
 * actually moves.
 */
create or replace function rpc_move(p_world uuid, p_x double precision, p_y double precision, p_level int default 0)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p player; w world; gap double precision; far double precision; allowed double precision;
begin
  if me is null then raise exception 'not signed in'; end if;
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then raise exception 'you are not on this island'; end if;
  select * into w from world where id = p_world;
  if p_x < 0 or p_y < 0 or p_x > w.size or p_y > w.size then raise exception 'that is off the island'; end if;

  gap := greatest(0.05, extract(epoch from (now() - p.moved_at)));
  far := sqrt(power(p_x - p.x, 2) + power(p_y - p.y, 2));
  -- A walk, a saddle or a seat; the rest is slack for a link that hiccups.
  allowed := travel_speed(p_world, me) * least(gap, 10) * 1.6 + 1.5;
  if far > allowed then
    -- Not an error: a client that has been asleep is not a cheat, and telling
    -- it off would be unplayable. It is simply pulled back to where it could
    -- actually have got to, and it will notice and correct.
    p_x := p.x + (p_x - p.x) * (allowed / far);
    p_y := p.y + (p_y - p.y) * (allowed / far);
  end if;
  update player set x = p_x, y = p_y, level = p_level, moved_at = now(), seen_at = now()
    where world_id = p_world and uid = me;
  perform drag_along(p_world, me, p_x, p_y);
  -- Walking into empty country is what fills it in. Not the join: coming
  -- ashore puts you somewhere you were already standing, and the step you take
  -- a second later asks the same question. One caller is enough, and it is the
  -- one that is actually about going somewhere.
  perform creature_stock_near(p_world, p_x, p_y);
  return jsonb_build_object('x', p_x, 'y', p_y, 'pulled', far > allowed);
end $$;

select private.lock_doors();
