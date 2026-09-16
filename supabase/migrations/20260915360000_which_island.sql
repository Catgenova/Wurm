-- The heartbeat did not say which island it was for.
--
-- Reported as: "occasionally it switches randomly to nighttime and
-- hunger/thirst plummet until refreshed".
--
-- Two symptoms, one payload. `rpc_settle` is the beat every browser makes once
-- a minute, and it carries both the hour and the bars. It was also the only
-- one of the island's twenty doors that did not take a `p_world` — so it had
-- to work out which island it was answering about, and it did it like this:
--
--     update player set seen_at = now(), away = false, ...
--       where uid = me and (away or seen_at < now() - interval '5 seconds' ...);
--     ...
--     select * into p from player where uid = me order by seen_at desc limit 1;
--
-- Neither line names a world. `rpc_join` inserts a player row per island and
-- never takes the old ones away, so anybody who has joined more than one has
-- more than one row — and the front door has moved twice today. The update
-- then sets `seen_at` to the same instant on every one of them, and the select
-- picks between rows that now tie exactly, with nothing left to sort by.
--
-- Measured, on one person with three islands, at one instant, from the same
-- rows — only the plan differs:
--
--     bitmap index scan  -> Stonehaven
--     sequential scan    -> Faraway
--     read the other way -> Bigness
--
-- Three answers, all of them correct for the query as written. And those
-- islands were founded at different times, so they are at different hours of a
-- day that is one real hour long:
--
--     Stonehaven  14.35  day    hunger 0.995  thirst 0.979
--     Bigness      2.39  night  hunger 1.000  thirst 1.000
--     Faraway      2.38  night  hunger 1.000  thirst 1.000
--
-- So when the choice moved, the sun moved and the bars moved together, because
-- they came down the same answer. A refresh put it right because `rpc_join`
-- names its island; the next beat broke it again because this one did not.
--
-- ## The fix
--
-- The browser says where it is standing. `p_world` is appended rather than put
-- first, so a page that has not been redeployed yet still resolves against
-- this function with the argument defaulted, and gets the old guess — but with
-- `world_id` breaking the tie, so such a session gets the same wrong island
-- every beat instead of a different one each time. A redeployed page gets the
-- right one.
--
-- The `seen_at` update is scoped too. Keeping it fresh on every island at once
-- told each of them you were standing there, which is why `log_out_idle` never
-- swept a body off an island you walked away from, and why a job left running
-- on one finished off a heartbeat sent from another.
--
-- Nothing else needed it: `rpc_settle` was the only door that looked you up
-- without an island.
--
--     select p.proname from pg_proc p ... where p.prosrc ~ 'where uid = me'
--     rpc_settle
--
-- ## What this does not explain
--
-- A body that really has been standing still gets hungry, and coming back to a
-- tab after ten minutes away will move the sun by four hours, because a day is
-- one real hour. Both of those are the island working. This is the one that
-- was not.

drop function if exists public.rpc_settle(bigint);

CREATE OR REPLACE FUNCTION public.rpc_settle(p_seen bigint DEFAULT NULL::bigint, p_world uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); r record; n int := 0; p player; v_world uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;

  /*
   * Which island this is a heartbeat for, settled before anything is written.
   *
   * It used to be `order by seen_at desc limit 1` over every row with your uid
   * on it, and the update above it had no world in its `where` either — so one
   * beat set `seen_at` to the same instant on every island you have ever
   * joined, and then picked between them with a sort that had nothing left to
   * sort by. Three rows, one timestamp, no tie-break: the answer is whichever
   * one Postgres happens to hand back, and that is a choice of plan rather
   * than a fact about you.
   *
   * The same answer carries the hour and the bars, so when the choice moved,
   * both moved together — reported as "occasionally it switches randomly to
   * nighttime and hunger/thirst plummet until refreshed". A refresh put it
   * right because `rpc_join` names its island, and the next beat broke it
   * again because this one did not.
   *
   * So the browser says where it is standing. `rpc_settle` was the only door
   * of the twenty that did not take a `p_world`, and it is the one that runs
   * every minute of every session.
   */
  if p_world is not null then
    select world_id into v_world from player where uid = me and world_id = p_world;
  end if;
  if v_world is null then
    -- A page that has not been redeployed yet, and does not say. The best
    -- guess is still a guess, but `world_id` breaks the tie, so a session gets
    -- the same wrong island every beat rather than a different one each time.
    select world_id into v_world from player where uid = me
      order by seen_at desc, world_id limit 1;
  end if;
  if v_world is null then return jsonb_build_object('settled', 0); end if;

  -- Standing here, and only here. Keeping `seen_at` fresh on every island at
  -- once told each of them you were present, which is how a body could be left
  -- standing on an island you walked away from an hour ago.
  update player set seen_at = now(), away = false,
         seen_change = greatest(seen_change, coalesce(p_seen, 0))
    where uid = me and world_id = v_world
      and (away or seen_at < now() - interval '5 seconds' or coalesce(p_seen, 0) > seen_change);
  for r in select world_id from player
    where uid = me and world_id = v_world and act is not null and act_ends <= now()
  loop
    n := n + settle(r.world_id, me);
  end loop;
  /*
   * And the body itself, which nothing had ever brought up to date.
   *
   * `settle` above runs only for somebody with a job whose time is up, and
   * `world_tick` only for the same — so a body standing still never got
   * hungry, never got its wind back and never healed. This is the heartbeat
   * every browser makes anyway, once a minute, and it is where a body that is
   * only standing there lives.
   */
  perform body_settle(v_world, me);
  select * into p from player where world_id = v_world and uid = me;
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
