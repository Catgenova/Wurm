-- Jobs held in your head.
--
-- Asking for something while your hands are full does not lose it: the game
-- lines it up behind what you are doing, three deep to start with and one
-- deeper for every ten points of mind logic above where you began. Only when
-- there is no room does it refuse.
--
-- The port refused outright, which is a small difference that is felt
-- constantly — every queued dig, every "saw the whole stack into planks" is
-- this. It turned up because a test asked a second question while a six-deep
-- dig was still running and was told "You are already busy", which is exactly
-- what a player would have been told, and exactly what they should not be.

alter table player add column if not exists act_queue jsonb not null default '[]'::jsonb;

/** Three, and one more for every ten points of mind logic above the start. */
create or replace function queue_capacity(p_world uuid, p_uid uuid) returns int language sql stable as $$
  select 3 + floor(greatest(0, skill_of(p_world, p_uid, 'mind_logic') - 20) / 10)::int
$$;

create or replace function rpc_act(p_world uuid, p_action text, p_target jsonb, p_times int default 1)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d action_def; p player; why text; secs double precision;
        s double precision; tq double precision; cap int; room int;
begin
  if me is null then raise exception 'not signed in'; end if;
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
    return jsonb_build_object('started', false, 'queued', true,
      'inHand', jsonb_array_length(p.act_queue) + 1, 'capacity', cap);
  end if;

  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, me, d.tool) end;
  secs := act_duration(d.base_time, s, tq, control_speed(p_world, me));
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now()
    where world_id = p_world and uid = me;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $$;

/**
 * Finish whatever has come due, and pick up whatever was waiting behind it.
 *
 * A job taken off the queue starts when the last one ended rather than now, so
 * a queue settled late is not paid for twice — the same reasoning as a repeat,
 * and for the same reason: nothing is running to notice when any of this
 * happened, so it all has to be worked out from when it was due.
 */
create or replace function settle(p_world uuid, p_uid uuid) returns int
  language plpgsql as $$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found or p.act is null then return 0; end if;
  while p.act is not null and p.act_ends <= now() and guard < 200 loop
    guard := guard + 1;
    perform act_perform(p_world, p_uid, p.act, p.act_target);
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
        perform tell(p_world, p_uid, 'You stop ' || d.verb || '.', 'info');
      end if;
      -- Whatever was waiting behind it, if anything still can be done.
      nxt := p.act_queue -> 0;
      if nxt is null then
        update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null
          where world_id = p_world and uid = p_uid returning * into p;
      else
        select * into d from action_def where id = nxt->>'action';
        if d is null or act_refusal(p_world, p_uid, nxt->>'action', nxt->'target') is not null then
          perform tell(p_world, p_uid,
            coalesce(act_refusal(p_world, p_uid, nxt->>'action', nxt->'target'), 'That cannot be done now.'), 'error');
          update player set act = null, act_target = null, act_started = null, act_ends = null,
                 act_left = null, act_queue = act_queue - 0
            where world_id = p_world and uid = p_uid returning * into p;
        else
          update player set act = nxt->>'action', act_target = nxt->'target',
                 act_left = greatest(1, coalesce((nxt->>'goes')::int, 1)),
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
end $$;

select private.lock_doors();
