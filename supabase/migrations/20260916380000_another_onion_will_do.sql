-- A queued job means another one like it, not that exact row again.
--
-- Reported from the island, with a screenshot: *"notifications are doubled and
-- when you queue eat, the next 2 queues try to eat the same food."* Two
-- separate faults, and only one of them is on this side.
--
-- ## What the island actually says
--
-- Three eats queued against a stack of two onions, read straight off `event`:
--
--     684 [info]  You start eating.
--     685 [info]  Eat is next, 2 of 3 in hand.
--     686 [info]  Eat is next, 3 of 3 in hand.
--     687 [event] You eat the onion.
--     688 [info]  You start eating.
--     689 [event] You eat the onion.
--     690 [error] It is gone.
--
-- Every line once, so the doubling is the browser saying the same row twice
-- and is fixed over there. What *is* wrong here is line 690.
--
-- ## Why "It is gone"
--
-- A job goes into `act_queue` carrying the target it was asked with, and for an
-- item that target is a row id. Eat the last of a stack and `consume` deletes
-- the row — so the next job off the queue names an id that no longer exists,
-- `act_refusal` quite correctly answers "It is gone.", and the job is thrown
-- away.
--
-- Which is not what anybody meant. Queueing three eats means *eat three
-- times*; the row id was how you pointed at the onion, not which onion you had
-- an appointment with. So the queue remembers what the thing **was**, and a job
-- whose row has gone is pointed at another of the same kind if there is one:
--
--     'was', the item's def, stamped in when the job is queued
--     act_retarget, which swaps the id at the moment the job comes up
--
-- Nothing is invented. If there is no other onion the refusal stands and reads
-- exactly as it did.
--
-- Only the queue. A run of goes on one job — `act_left` — keeps its target
-- through the run, and it should: a stack's row survives until its last unit,
-- so the last go is the one that empties it, and the go after that stops with
-- "That was 1 to go." which is the truth.

/**
 * Point a queued job at another one like it, when the one it named is gone.
 *
 * `was` is the def the target had when it was queued, which is the only thing
 * that survives the row being deleted. Everything else about the job is left
 * exactly as it was — this swaps an id and nothing more, and only when the old
 * id names nothing that is still carried.
 */
create or replace function act_retarget(p_world uuid, p_uid uuid, p_job jsonb) returns jsonb
  language plpgsql stable as $fn$
declare v_uid bigint; v_was text; v_other bigint;
begin
  if p_job is null then return p_job; end if;
  v_was := p_job->>'was';
  if v_was is null then return p_job; end if;
  v_uid := (p_job->'target'->>'uid')::bigint;
  if v_uid is null then return p_job; end if;
  -- Still there: nothing to do, and this is the ordinary case.
  if (carried(p_world, p_uid, v_uid)).id is not null then return p_job; end if;
  select i.id into v_other from item i
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
     and i.def = v_was and not i.locked
   order by i.id limit 1;
  if v_other is null then return p_job; end if;
  return jsonb_set(p_job, '{target,uid}', to_jsonb(v_other));
end $fn$;

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
    /*
     * And what the thing *was*, for a job that may outlive the row it names.
     *
     * Stamped now rather than worked out later, because later is exactly when
     * it cannot be: once `consume` has deleted the last of a stack there is
     * nothing left to ask what kind of thing it had been.
     */
    update player set act_queue = act_queue || (jsonb_build_object(
        'action', p_action, 'target', p_target, 'goes', greatest(1, least(100, coalesce(p_times, 1))))
        || coalesce((select jsonb_build_object('was', i.def) from item i
                      where i.id = (p_target->>'uid')::bigint and i.world_id = p_world), '{}'::jsonb))
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
    return held_now(p_world, me) || jsonb_build_object('started', false, 'queued', true,
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
  /*
   * And what the ask left you holding, said in the answer to the ask.
   *
   * Reported as inventory rubberbanding: a thing put in a crate turns up in
   * the crate and stays in the pack as well, for up to the twenty seconds
   * until the next reconcile, and then goes. Two causes with one shape —
   * nothing ever tells a browser that a thing has *left* its hands.
   *
   * `item` is published with the default replica identity, so a DELETE carries
   * the primary key and nothing else, and the browser's Realtime filter is
   * `holder_uid = me`: a row carrying only an `id` cannot match it. Putting a
   * whole stack in a crate deletes the row, so nothing is said. And a thing
   * that goes to the ground, or to somebody else, has `holder_uid` set to
   * null, so the *new* row does not match the filter either. Realtime carries
   * every arrival and no departure, and `refresh_pack` on the twenty-second
   * reconcile was the only thing that ever noticed.
   *
   * Said at each return rather than worked out once at the top, because for an
   * instant ask the work happens in the `settle` three lines below this — a
   * value built any earlier is the pack as it was before the thing moved,
   * which is the very answer that was wrong.
   */
  if d.instant then
    perform settle(p_world, me);
    return held_now(p_world, me) || jsonb_build_object('started', true, 'done', true, 'seconds', 0);
  end if;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return held_now(p_world, me)
      || jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
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
  /*
   * Twenty-five goes to a call, not two hundred.
   *
   * This is the one way a round of the clock can run long: somebody back from
   * an hour away is owed hundreds of goes, and at two hundred apiece — inside
   * `tick_players` inside `tick_worlds` — one person's backlog is the whole
   * tick. It mattered less at five seconds. It matters at one.
   *
   * Nothing is lost by taking less at a time: what is still due is still due,
   * and there is another round a second from now, plus the browser's own beat
   * the moment its job comes up. A backlog drains in seconds either way; the
   * difference is whether everybody else waits while it does.
   */
  while p.act is not null and p.act_ends <= now() and guard < 25 loop
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
      -- Another onion will do. See `act_retarget`: only when the row it named
      -- has gone, and only to another of what it was.
      nxt := act_retarget(p_world, p_uid, nxt);
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


select private.lock_doors();

notify pgrst, 'reload schema';
