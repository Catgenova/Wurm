-- The hour of the day, told rather than counted.
--
-- "Day and night only seem to change on client refresh." They did, and the
-- clock was not the thing that was wrong: `hour_of_day()` here reads the
-- island's own age against `day_seconds()` and has been right all along.
--
-- What the browser did with it was read it once, at the join, and then add up
-- frames. `GameLoop` caps a frame at a tenth of a second — rightly, because a
-- frame that arrives after a two-minute stall must not walk anybody two
-- minutes across an island — and every scrap of real time past that cap is
-- simply gone. A phone that locks its screen, changes tab, or takes a call
-- stops getting frames at all. So the browser's clock fell behind the
-- island's and stayed behind, by as much as the session had been interrupted,
-- and the only thing that ever put it right was a reload reading the hour
-- again. On a desktop it drifts by seconds; on a phone it is most of a day.
--
-- A count that has to be kept up by being watched is not a clock. The heartbeat
-- every browser makes anyway carries the island's own reading now, and the
-- browser pins it against a monotonic reading of its own — so the hour is
-- extrapolated between beats, corrected on every beat, and a tab that was
-- asleep for ten minutes comes back to the right sky rather than to the sky it
-- was showing when it went under.
--
-- `night` rides along beside it, and nothing draws from it. The browser works
-- the darkness out from the hour exactly as it always has, because two
-- authorities on the same fact is how the two ends of this game have come
-- apart every other time. It is here to be *compared*: measurement 665 asks
-- the island both questions and checks they are the same answer, so a day
-- that drifts apart again is caught by the suite rather than by somebody
-- lighting a lantern at noon.

CREATE OR REPLACE FUNCTION public.rpc_settle(p_seen bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); r record; n int := 0; p player; v_world uuid;
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
  v_world := p.world_id;
  /*
   * And the body itself, which nothing had ever brought up to date.
   *
   * `settle` above runs only for somebody with a job whose time is up, and
   * `world_tick` only for the same — so a body standing still never got
   * hungry, never got its wind back and never healed. This is the heartbeat
   * every browser makes anyway, once a minute, and it is where a body that is
   * only standing there lives.
   */
  if v_world is not null then
    perform body_settle(v_world, me);
    select * into p from player where world_id = v_world and uid = me;
  end if;
  return jsonb_build_object(
    'settled', n,
    'act', p.act,
    'ends', p.act_ends,
    'left', p.act_left,
    'secs', case when p.act_ends is null then null
                 else greatest(0, extract(epoch from (p.act_ends - now()))) end,
    'total', case when p.act_ends is null or p.act_started is null then null
                  else greatest(0.001, extract(epoch from (p.act_ends - p.act_started))) end,
    -- What is lined up behind it, and how much room is left in your head.
    'queue', coalesce((select jsonb_agg(q->>'action' order by o)
                       from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb),
    'cap', case when v_world is null then null else queue_capacity(v_world, me) end,
    -- The bars, which have been the ones you came ashore with until now.
    'stats', p.stats,
    -- Every skill, because the log says one went up and the window said it did not.
    'skills', coalesce((select jsonb_object_agg(s.id, s.value) from skill s
                        where s.world_id = v_world and s.uid = me), '{}'::jsonb),
    -- The ore a prospector read, and how much longer it is lit for.
    'marks', case when jsonb_typeof(p.stats->'prospected') <> 'object' then null
                  else jsonb_build_object(
                    'tiles', p.stats->'prospected'->'tiles',
                    'secs', greatest(0, (p.stats->'prospected'->>'until')::double precision
                                        - extract(epoch from now()))) end,
    'queued', coalesce(jsonb_array_length(p.act_queue), 0),
    -- And what hour it is out there, which the browser had been keeping for
    -- itself. Seconds since the island began, so the browser works the hour
    -- out the way it always did rather than being handed a picture to draw.
    'time', case when v_world is null then null else world_time(v_world) end,
    -- The island's own reading of the same clock. Nothing draws from this: it
    -- is here so that two ends disagreeing about whether it is dark can be
    -- seen, rather than found out by a lantern that would not light.
    'night', case when v_world is null then null else is_night(v_world) end);
end $function$;

select private.lock_doors();
