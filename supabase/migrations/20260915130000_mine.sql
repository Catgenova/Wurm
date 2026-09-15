-- What the island knows about you that the browser never hears.
--
-- The island owns the player: the queue, the skills, the stats, and the ore a
-- prospector just read are all written there, and `player` came off the
-- Realtime publication when bodies moved to Broadcast. So the browser's copy
-- of *you* was whatever it was handed at the join and never moved again.
--
-- It shows. The action bar never listed what was lined up behind the job in
-- hand, because `act_queue` lives here. Prospecting said "they are marked for
-- a while" and marked nothing, because the marks are a row here. The health
-- and stamina bars were the ones you came ashore with. All the same gap.
--
-- `rpc_settle` is already the round trip the browser makes — for the job it is
-- watching, for the heartbeat, for the cursor — so it carries the rest of you
-- as well. It is a few hundred bytes on a call that was happening anyway.
create or replace function rpc_settle(p_seen bigint default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
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
    'queued', coalesce(jsonb_array_length(p.act_queue), 0));
end $$;

select private.lock_doors();
