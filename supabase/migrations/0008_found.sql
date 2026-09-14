-- Founding an island, and getting it down the wire in both directions.
--
-- Generating an island stays in the browser. It is a big deterministic
-- function of a seed, it already exists and is tested, and teaching Postgres
-- to do it again would be two islands that have to agree forever. So the
-- browser rolls one and hands it over, once, and after that the database owns
-- it and nobody may write to the land again except through the rules.
--
-- Bytes travel as base64 rather than as Postgres's own `\x` hex, which is
-- twice the size for no gain, and in batches of rows rather than one call per
-- row: a thousand-tile island is two thousand rows, and two thousand round
-- trips to found an island is a minute of watching a progress bar.

/** Start an island. It is not playable until the land has arrived. */
create or replace function rpc_found(p_name text, p_seed bigint, p_size int,
                                     p_spawn_x int, p_spawn_y int)
  returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_size < 8 or p_size > 4096 then raise exception 'that is not a size of island'; end if;
  insert into world (name, seed, size, spawn_x, spawn_y, ready, made_by)
  values (coalesce(nullif(trim(p_name), ''), 'An island'), p_seed, p_size, p_spawn_x, p_spawn_y, false, me)
  returning id into w;
  perform land_blank(w, p_size);
  return w;
end $$;

/**
 * Hand over a batch of the island's rows.
 *
 * Only whoever founded it, and only until it opens. The moment an island is
 * `ready` this refuses for good, which is the line that matters: after that
 * the only thing that can move a corner is a rule.
 */
create or replace function rpc_put_land(p_world uuid, p_rows jsonb)
  returns int language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w world; r jsonb; n int := 0;
        h bytea; d bytea; ti bytea; da bytea; ro bytea;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into w from world where id = p_world;
  if not found then raise exception 'no such island'; end if;
  if w.made_by is distinct from me then raise exception 'that is not your island to lay down'; end if;
  if w.ready then raise exception 'that island is already open; the land is settled'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    if (r->>'heights') is not null then
      h := decode(r->>'heights', 'base64');
      d := decode(r->>'dirt', 'base64');
      if length(h) <> (w.size + 1) * 2 or length(d) <> w.size + 1 then
        raise exception 'row % is the wrong width: % height bytes and % of soil, wanted % and %',
          r->>'y', length(h), length(d), (w.size + 1) * 2, w.size + 1;
      end if;
      update land_corner set heights = h, dirt = d
        where world_id = p_world and y = (r->>'y')::int;
    end if;
    if (r->>'tiles') is not null then
      ti := decode(r->>'tiles', 'base64');
      da := decode(r->>'data', 'base64');
      ro := decode(r->>'rock', 'base64');
      if length(ti) <> w.size or length(da) <> w.size or length(ro) <> w.size then
        raise exception 'row % is the wrong width: % tiles, wanted %', r->>'y', length(ti), w.size;
      end if;
      update land_tile set tiles = ti, data = da, rock = ro
        where world_id = p_world and y = (r->>'y')::int;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

/** Open the island. One way: after this the land is only the rules' to change. */
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
  return true;
end $$;

/**
 * The island, back out again, a band of rows at a time.
 *
 * Reading the tables directly would work — the policies allow it — but
 * PostgREST hands `bytea` back as hex, which is twice the bytes for a thing
 * that is already the largest thing anybody downloads all day.
 */
create or replace function rpc_land(p_world uuid, p_y0 int, p_y1 int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_y1 - p_y0 > 256 then raise exception 'ask for fewer rows at a time'; end if;
  return coalesce((
    select jsonb_agg(row ORDER BY y)
    from (
      select c.y,
             jsonb_build_object(
               'y', c.y,
               'heights', encode(c.heights, 'base64'),
               'dirt', encode(c.dirt, 'base64'),
               'tiles', encode(t.tiles, 'base64'),
               'data', encode(t.data, 'base64'),
               'rock', encode(t.rock, 'base64')) as row
      from land_corner c
      left join land_tile t on t.world_id = c.world_id and t.y = c.y
      where c.world_id = p_world and c.y between p_y0 and p_y1
    ) q), '[]'::jsonb);
end $$;
