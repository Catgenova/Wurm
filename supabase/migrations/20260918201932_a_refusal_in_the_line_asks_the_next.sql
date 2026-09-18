-- A refusal in the line asks the next
--
-- Reported: "queued up multiple chopping actions, then after the tree was
-- felled and no actions were running I'd dig up the stump and it would show
-- a cutting action following that I didn't queue." Three cuts asked for at
-- one tree, one in hand and two in the line. The one in hand fells it; the
-- second comes up, is refused — there is no tree there any more — and is put
-- out of the line, and `settle` stopped there: the third stayed in the line
-- behind an empty hand, and came up as "then" the moment the next thing
-- asked for started. Now a refusal puts that job out and asks the one behind
-- it, until one starts or the line is empty, which is what the browser's
-- `nextInQueue` has always done in a game of your own. Nothing else moves:
-- each refusal is still told in its own words.

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
      /*
       * The next job in the line, or the first one behind it that can be done.
       *
       * Reported: "queued up multiple chopping actions, then after the tree
       * was felled and no actions were running I'd dig up the stump and it
       * would show a cutting action following that I didn't queue." The
       * second chop, popped once the tree was down, was refused and put out of
       * the line — and the third stayed in it, behind an empty hand, until the
       * next thing asked for was done and it came up as "then". A refusal puts
       * that job out of the line and asks the next, as the browser's
       * `nextInQueue` has always done, until one starts or the line is empty.
       */
      loop
        nxt := p.act_queue -> 0;
        -- Another onion will do. See `act_retarget`: only when the row it named
        -- has gone, and only to another of what it was.
        nxt := act_retarget(p_world, p_uid, nxt);
        if nxt is null then
          update player set act = null, act_target = null, act_started = null, act_ends = null,
                 act_left = null, act_goes = null
            where world_id = p_world and uid = p_uid returning * into p;
          exit;
        end if;
        select * into d from action_def where id = nxt->>'action';
        if d is null or act_refusal(p_world, p_uid, nxt->>'action', nxt->'target') is not null then
          perform tell(p_world, p_uid,
            coalesce(act_refusal(p_world, p_uid, nxt->>'action', nxt->'target'), 'That cannot be done now.'), 'error');
          update player set act = null, act_target = null, act_started = null, act_ends = null,
                 act_left = null, act_goes = null, act_queue = act_queue - 0
            where world_id = p_world and uid = p_uid returning * into p;
          -- And the one behind it.
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
          exit;
        end if;
      end loop;
    end if;
  end loop;
  return done;
end $function$;

select private.lock_doors();
