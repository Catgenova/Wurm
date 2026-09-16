-- "3 of 10" was drawn off two numbers from different jobs.
--
-- Reported as: "action queue bar is screwed up, especially when interacting
-- with actions that have multiples, e.g. flatten x10".
--
-- The bar says how far through a run it is:
--
--     const count = a.goes !== undefined && a.left !== undefined
--       ? ` · ${a.goes - a.left + 1} of ${a.goes}` : ...
--
-- `left` is the island's — `act_left`, counting down. `goes` was the browser's
-- own tally, and the comment on it said why:
--
--     How many goes we asked for, which the island does not keep. `act_left`
--     counts down and the number originally asked for is not written anywhere,
--     so "3 of 10" can only be said by the side that said ten.
--
-- Except the side that said ten only ever heard itself when the job *started*.
-- Ask for ten while something is already in hand and the ask is queued, so
-- `started` comes back false, the browser records nothing, and the count it is
-- still holding belongs to whatever ran before. Measured:
--
--     one dig in hand, then ten more asked for behind it
--       -> {"queued": true, "started": false, "queue": ["dig"]}
--     the row:  dig | 1 | [{"goes": 10, "action": "dig", ...}]
--     the beat: {"act": "dig", "left": 1,  "queue": ["dig"]}
--     and once the first is done:
--               {"act": "dig", "left": 10, "queue": []}
--
-- So the browser holds goes = 1 from the job that started, the ten come to
-- hand with left = 10, and the bar draws 1 - 10 + 1 = -8 of 1.
--
-- Note the third line. The island knew all along — `act_queue[0].goes` is
-- right there in the row — and `jsonb_agg(q->>'action')` threw it away on the
-- way out, so a queue of one flatten and a queue of ten went out the same.
--
-- ## The fix
--
-- The island keeps what was asked for, like it keeps every other number on
-- that bar. `act_goes` is written wherever `act_left` is written from a fresh
-- ask — when a job starts, and when one comes out of the queue — left alone by
-- a go off a run, which is the whole point of it, and cleared with the job.
-- The browser stops keeping a tally of its own.
--
-- The queue goes out with its counts on it too, so what is lined up behind can
-- say what each one is for rather than naming the same job three times. A page
-- that has not been redeployed reads those entries as ids and finds none, so
-- its "Then:" line goes quiet rather than wrong; a redeployed one reads both
-- shapes, so neither order of landing shows anything false.

alter table player add column if not exists act_goes int;

CREATE OR REPLACE FUNCTION public.rpc_act(p_world uuid, p_action text, p_target jsonb, p_times integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); d action_def; p player; why text; secs double precision;
        s double precision; tq double precision; cap int; room int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  why := act_refusal(p_world, me, p_action, p_target);
  if why is not null then
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = me for update;

  -- Something already in hand: line this one up behind it rather than drop it.
  if p.act is not null then
    cap := queue_capacity(p_world, me);
    room := cap - 1 - jsonb_array_length(p.act_queue);
    if room <= 0 then
      why := 'You can only keep ' || cap || ' jobs in your head at once. Mind logic is what widens that.';
      perform tell(p_world, me, why, 'error');
      return jsonb_build_object('started', false, 'queued', false, 'why', why);
    end if;
    update player set act_queue = act_queue || jsonb_build_object(
        'action', p_action, 'target', p_target, 'goes', greatest(1, least(100, coalesce(p_times, 1))))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me, d.label || ' is next, ' || jsonb_array_length(p.act_queue) + 1 || ' of ' || cap || ' in hand.', 'info');
    /*
     * And what is in the head now, not just how much of it.
     *
     * The bar drew its queue from `rpc_settle` and nothing else, and
     * `rpc_settle` runs on the heartbeat and when a job comes due — never when
     * one is *added*. So asking for a third job while two were running left the
     * bar saying "2 of 3" until the job in hand finished, at which point one
     * came off the queue and it said "2 of 3" again. Reported as never changing
     * from 2/3 to 3/3, which is exactly what it did: it was always one behind,
     * and topping the queue up kept it there.
     *
     * The answer to the ask is where the browser should hear about what the ask
     * did, so it says so here rather than waiting to be asked again.
     */
    return jsonb_build_object('started', false, 'queued', true,
      'inHand', jsonb_array_length(p.act_queue) + 1, 'capacity', cap,
      'queue', coalesce((select jsonb_agg(jsonb_build_object(
                           'action', q->>'action',
                           'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
                         from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb));
  end if;

  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, me, d.tool) end;
  -- Every other job has a floor of a second or so under it; an instant one has
  -- no duration to put a floor under, and act_duration would give it one.
  secs := case when d.instant then 0 else act_duration(d.base_time, s, tq, control_speed(p_world, me)) end;
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))),
      act_goes = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  if d.instant then
    perform settle(p_world, me);
    return jsonb_build_object('started', true, 'done', true, 'seconds', 0);
  end if;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $function$;

CREATE OR REPLACE FUNCTION public.settle(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
begin
  perform wounds_settle(p_world, p_uid);
  perform body_settle(p_world, p_uid);
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found or p.act is null then return 0; end if;
  while p.act is not null and p.act_ends <= now() and guard < 200 loop
    guard := guard + 1;
    perform act_perform(p_world, p_uid, p.act, p.act_target);
    -- And what the go took out of you, which nothing over here had ever
    -- charged: `action_def.stamina` was a column no function read.
    perform spend_wind(p_world, p_uid, p.act);
    done := done + 1;
    select * into d from action_def where id = p.act;
    ended := p.act_ends;
    if p.act_left > 1 and act_refusal(p_world, p_uid, p.act, p.act_target) is null then
      update player set act_left = act_left - 1, act_started = ended,
             act_ends = ended + make_interval(secs => act_duration(
               d.base_time,
               case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
               case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end,
               control_speed(p_world, p_uid)))
        where world_id = p_world and uid = p_uid returning * into p;
    else
      if p.act_left > 1 then
        -- Why, when there is a why. A run of goes that stops because the wind
        -- gave out should say so rather than leave somebody wondering what
        -- they did wrong, which is what the browser has always said.
        perform tell(p_world, p_uid,
          coalesce(act_refusal(p_world, p_uid, p.act, p.act_target) || ' That was '
                   || (coalesce(p.act_left, 1)) || ' to go.',
                   'You stop ' || d.verb || '.'), 'info');
      end if;
      nxt := p.act_queue -> 0;
      if nxt is null then
        update player set act = null, act_target = null, act_started = null, act_ends = null,
               act_left = null, act_goes = null
          where world_id = p_world and uid = p_uid returning * into p;
      else
        select * into d from action_def where id = nxt->>'action';
        if d is null or act_refusal(p_world, p_uid, nxt->>'action', nxt->'target') is not null then
          perform tell(p_world, p_uid,
            coalesce(act_refusal(p_world, p_uid, nxt->>'action', nxt->'target'), 'That cannot be done now.'), 'error');
          update player set act = null, act_target = null, act_started = null, act_ends = null,
                 act_left = null, act_goes = null, act_queue = act_queue - 0
            where world_id = p_world and uid = p_uid returning * into p;
        else
          update player set act = nxt->>'action', act_target = nxt->'target',
                 act_left = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                 -- What was asked for, carried out of the queue with the job.
                 -- Without it the browser was left holding the count of
                 -- whatever ran *before* this one, and the bar drew "3 of 10"
                 -- off two numbers from different jobs.
                 act_goes = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                 act_started = ended,
                 act_ends = ended + make_interval(secs => act_duration(
                   d.base_time,
                   case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                   case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end,
                   control_speed(p_world, p_uid))),
                 act_queue = act_queue - 0
            where world_id = p_world and uid = p_uid returning * into p;
          perform tell(p_world, p_uid, 'You start ' || d.verb || '.', 'info');
        end if;
      end if;
    end if;
  end loop;
  return done;
end $function$;

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
    -- And how many were asked for, which nothing wrote down until now. The bar
    -- says "3 of 10" off this and `left`; the browser used to keep its own
    -- tally, which is a second opinion about a number the island owns — and it
    -- only ever heard one for a job that *started*, never for one that waited
    -- its turn in the queue.
    'goes', p.act_goes,
    'secs', case when p.act_ends is null then null
                 else greatest(0, extract(epoch from (p.act_ends - now()))) end,
    'total', case when p.act_ends is null or p.act_started is null then null
                  else greatest(0.001, extract(epoch from (p.act_ends - p.act_started))) end,
    -- What is lined up behind it, and how much room is left in your head.
    'queue', coalesce((select jsonb_agg(jsonb_build_object(
                         'action', q->>'action',
                         'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
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

/*
 * And the three other ways a job ends.
 *
 * `settle` is not the only one that puts `act_left` back to nothing: you can
 * stop, you can be swept off for idling, and you can die. A count left behind
 * with no job to belong to is harmless — the bar is hidden while `act` is
 * null — but it is the kind of leftover that becomes somebody else's bug, so
 * all four clear the same set.
 */

CREATE OR REPLACE FUNCTION public.log_out_idle(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare r record; n int := 0;
begin
  for r in select uid, name from player
    where world_id = p_world and not away
      and seen_at < now() - make_interval(secs => idle_logout())
    order by uid limit tick_players()
  loop
    update player set away = true, left_at = now(),
           act = null, act_target = null, act_started = null, act_ends = null,
           act_left = null, act_goes = null, act_queue = '[]'::jsonb
      where world_id = p_world and uid = r.uid;
    perform tell(p_world, null, r.name || ' has gone home.', 'info');
    n := n + 1;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.player_die(p_world uuid, p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare w world;
begin
  select * into w from world where id = p_world;
  -- Whatever killed you stays with the body. The wounds that did it would
  -- open you again in a minute, and nothing you could do would be quick
  -- enough; waking up is waking up whole.
  update player set
      stats = jsonb_build_object('health', 1, 'stamina', 0.5, 'hunger', 0.6, 'thirst', 0.6,
                                 'hurtSettled', to_jsonb(now())),
      wounds = '[]'::jsonb, x = w.spawn_x + 0.5, y = w.spawn_y + 0.5, level = 0,
      act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_goes = null,
      act_queue = '[]'::jsonb, moved_at = now()
    where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, 'You have died. You wake up, shivering, where you first came ashore.', 'error');
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_cancel(p_world uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; had text; dropped int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  -- What is due is done. Stopping is for what is still in your hands.
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then return jsonb_build_object('stopped', false, 'dropped', 0); end if;
  had := p.act;
  dropped := coalesce(jsonb_array_length(p.act_queue), 0);
  if had is null and dropped = 0 then
    return jsonb_build_object('stopped', false, 'dropped', 0);
  end if;
  update player set
      act = null, act_target = null, act_started = null, act_ends = null,
      act_left = null, act_goes = null, act_queue = '[]'::jsonb, seen_at = now()
    where world_id = p_world and uid = me;
  return jsonb_build_object('stopped', had is not null, 'was', had, 'dropped', dropped);
end $function$;
select private.lock_doors();
