-- What you are in the middle of, in seconds rather than in timestamps.
--
-- On an island the browser asks and the island decides, so nothing on this
-- machine knows a job is running — which is right, and left the screen with no
-- clock on anything. There was no progress bar at all: you pressed cut down,
-- the log said "You start cutting down", and then nothing moved for half a
-- minute.
--
-- The island has always known. `rpc_settle` now says how much of the job is
-- left and how long it was to begin with, so the browser can draw the bar
-- without owning the work.
--
-- Seconds, not timestamps, on purpose. A browser clock that is a minute out
-- would draw a bar that is a minute wrong, and there is no reason to make the
-- page do arithmetic against a clock it does not share when the island can
-- subtract two of its own.
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
  return jsonb_build_object(
    'settled', n,
    'act', p.act,
    'ends', p.act_ends,
    'left', p.act_left,
    -- How much of it is still to come, and how long the whole go was.
    'secs', case when p.act_ends is null then null
                 else greatest(0, extract(epoch from (p.act_ends - now()))) end,
    'total', case when p.act_ends is null or p.act_started is null then null
                  else greatest(0.001, extract(epoch from (p.act_ends - p.act_started))) end,
    'queued', coalesce(jsonb_array_length(p.act_queue), 0));
end $$;

select private.lock_doors();
