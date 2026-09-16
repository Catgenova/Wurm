-- Two things every call pays for, and one of them is not worth paying.
--
-- ## The rate limiter, which writes on every single RPC
--
-- `too_fast` is the first thing every door does, and it is an upsert: one row
-- per person, rewritten on every call. That is a new tuple version, a WAL
-- record, and vacuum work, on the hot path of everything. Measured:
--
--     a thousand rate-limit checks   ->   127 kB of WAL
--
-- A hundred and thirty bytes a call. At the cadence the polls run now — about
-- a hundred and thirty calls a minute each — fifty people write something like
-- a gigabyte a day of write-ahead log to count to four hundred and eighty.
--
-- It does not need to survive a crash. Losing the counter means everybody gets
-- a fresh minute's allowance, which is what happens every minute anyway. So
-- the table is UNLOGGED, and gets room in each page for the updates to be made
-- in place rather than moved:
--
--     the same thousand, unlogged    ->   40 bytes
--
-- ## And the settle loop, which can eat a whole round
--
-- See the note on it below. Two hundred goes to a call was fine at a tick of
-- five seconds; at one it is the one way a round runs long.

alter table caller set unlogged;
alter table caller set (fillfactor = 50);

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
