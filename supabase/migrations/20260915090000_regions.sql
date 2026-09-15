-- What Realtime carries, and to whom.
--
-- Four tables were published and every change went to one channel per island.
-- Two of them should never have been there at all.
--
-- **`player`** is written once a second by every walking body — `MOVE_EVERY` is
-- one second — so each player was one WAL row a second and one billed message
-- per subscriber. The cost analysis budgeted "four changes a minute each";
-- movement alone is fifteen times that, and two hundred people on an island
-- works out at forty thousand messages a second. Bodies go over Broadcast now,
-- which never touches the write-ahead log. Nothing is lost: the only consumer
-- of the `player` stream was the roster, and the roster is reconciled from the
-- table every twenty seconds anyway.
--
-- **`item`** is the highest-churn table in the game, and the browser answered
-- every row of it — anybody's, anywhere on the island — by downloading its own
-- whole pack again. It stays published, because a pack has to be live, but a
-- client now listens only for rows with its own uid on them.
--
-- **`tile_change`** is the one that belongs. It is blocked by region so that a
-- 4096 island stops sending everybody the sound of somebody digging ten
-- kilometres away, and it carries a cursor so a join stops downloading the
-- whole history of the island every time.

alter publication supabase_realtime drop table player;

/* ------------------------------------------------------------------ *
 * A cursor, so catching up is what is new rather than everything.
 * ------------------------------------------------------------------ */

/**
 * `Island.join` read `tile_change` with `select('*').eq('world_id', …)` and no
 * cursor and no limit: the entire history of everything ever dug, on every
 * join, for ever. It is the 138 MB problem that the seed fixed, growing back
 * on a slower fuse — by how much a place has been lived in rather than by how
 * big it is, but growing.
 */
alter table player add column if not exists seen_change bigint not null default 0;

/* ------------------------------------------------------------------ *
 * Blocks of country.
 * ------------------------------------------------------------------ */

/** Which block of country a tile is in. Sixteen to a side at 4096. */
create or replace function region_of(p_x int, p_y int) returns int language sql immutable as $$
  select (p_y / region_size()::int) * 1024 + (p_x / region_size()::int)
$$;

alter table tile_change add column if not exists region int not null default 0;
update tile_change set region = region_of(x, y) where region = 0 and (x >= region_size() or y >= region_size());
create index if not exists tile_change_region on tile_change (world_id, region, n);

/**
 * Say that a tile changed, once, to everybody who is near enough to care.
 *
 * One shout, two jobs, still: Realtime carries the insert to the block it
 * happened in, and a player who was away reads the same rows back in order.
 */
create or replace function land_announce(p_world uuid, p_x int, p_y int) returns void language sql as $$
  insert into tile_change (world_id, x, y, region, tile, data, corners)
  values (p_world, p_x, p_y, region_of(p_x, p_y),
          land_tile(p_world, p_x, p_y), land_data(p_world, p_x, p_y),
          array[land_height(p_world, p_x, p_y), land_height(p_world, p_x + 1, p_y),
                land_height(p_world, p_x + 1, p_y + 1), land_height(p_world, p_x, p_y + 1)])
$$;

/* ------------------------------------------------------------------ *
 * The heartbeat carries the cursor.
 * ------------------------------------------------------------------ */

/**
 * Settle me, say I am still here, and remember how far I have read.
 *
 * Three things in one round trip because the browser was going to make it
 * anyway. The cursor only ever goes forward, and it is the browser's own — the
 * island does not care what anybody has seen except to know what it may fold
 * away.
 */
-- The no-argument one goes: `create or replace` with a new signature makes a
-- second function rather than replacing the first, and two candidates that
-- both answer `rpc_settle()` is a call nobody can resolve.
drop function if exists rpc_settle();

create or replace function rpc_settle(p_seen bigint default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r record; n int := 0; p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  update player set seen_at = now(), away = false,
         seen_change = greatest(seen_change, coalesce(p_seen, 0))
    where uid = me and (away or seen_at < now() - interval '5 seconds' or coalesce(p_seen, 0) > seen_change);
  for r in select world_id from player
    where uid = me and act is not null and act_ends <= now()
  loop
    n := n + settle(r.world_id, me);
  end loop;
  select * into p from player where uid = me order by seen_at desc limit 1;
  return jsonb_build_object('settled', n, 'act', p.act, 'ends', p.act_ends, 'left', p.act_left);
end $$;

select private.lock_doors();
