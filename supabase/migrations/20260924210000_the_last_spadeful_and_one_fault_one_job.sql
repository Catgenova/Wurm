/*
 * The last spadeful in a cart, and a fault in one job kept to that job.
 *
 * Reported: "something just broke, no actions are working". From 20:22 UTC
 * the clock failed every second with
 *
 *   new row for relation "item" violates check constraint "item_count_check"
 *
 * and nothing anybody did on the island finished. Two things were wrong, and
 * either would have done it.
 *
 * `take_spoil`, which finds the spadeful that brings a corner up, and
 * `site_take`, which takes a building's material off the pile on its site,
 * took one off a stack by setting its count to one less and then deleting the
 * row if that left nothing. The item table refuses a count of 0 before the
 * delete is ever reached, so the last one of any stack could not be taken.
 * Since this morning what you dig goes into the cart you are driving, so a
 * cart's last spadeful of dirt is an ordinary thing to use, and the first
 * time somebody used one, the job raised that error.
 *
 * And a job that raised an error took everybody's work down with it:
 * `world_tick` settles every body on every island in one transaction, so the
 * same job failed the whole round, every second, for as long as it was due.
 * `settle` now runs a body's goes in a block of their own. A fault undoes
 * what that block did, stops that job and the queue behind it, says so to
 * its owner, and is kept in `private.tick_fault`, where the deploy reports it
 * and no browser can read it. The sweeps in `world_tick` go in blocks of their
 * own for the same reason.
 */

-- What went wrong, where, and how often: one row for a fault, counted again
-- while it keeps happening, so a sweep that fails every second is one row.
create table if not exists private.tick_fault (
  n bigserial primary key,
  at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  times int not null default 1,
  world_id uuid,
  uid uuid,
  stage text not null,
  job text,
  error text not null,
  state text,
  context text
);
create index if not exists tick_fault_last on private.tick_fault (last_at);

/*
 * Keep a fault: a new row, or one more on the same fault if it was last seen
 * in the past ten minutes. True when it is new. Said to the log once, when it
 * is new, rather than every second it goes on.
 */
create or replace function fault_note(p_world uuid, p_uid uuid, p_stage text, p_job text,
                                      p_error text, p_state text, p_where text)
returns boolean language plpgsql as $fn$
begin
  update private.tick_fault f set times = f.times + 1, last_at = now()
   where f.world_id is not distinct from p_world and f.uid is not distinct from p_uid
     and f.stage = p_stage and f.job is not distinct from p_job and f.error = p_error
     and f.last_at > now() - interval '10 minutes';
  if found then return false; end if;
  insert into private.tick_fault (world_id, uid, stage, job, error, state, context)
  values (p_world, p_uid, p_stage, p_job, p_error, p_state, left(p_where, 2000));
  raise warning 'island fault in % (world %, body %, job %): % [%]',
    p_stage, p_world, p_uid, p_job, p_error, p_state;
  return true;
end $fn$;

/*
 * A body whose goes raised an error: the job and its queue stop, and its
 * owner is told what the island said. The goes that had come due in that call
 * were undone with the block they ran in, so nothing they used or made has
 * changed. A body with no job whose own upkeep failed is told once, not on
 * every beat.
 */
create or replace function settle_fault(p_world uuid, p_uid uuid, p_error text, p_state text, p_where text)
returns void language plpgsql as $fn$
declare v_job text; v_verb text; v_new boolean;
begin
  select pl.act into v_job from player pl where pl.world_id = p_world and pl.uid = p_uid;
  select d.verb into v_verb from action_def d where d.id = v_job;
  update player set act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]'::jsonb
   where world_id = p_world and uid = p_uid and act is not null;
  v_new := fault_note(p_world, p_uid, 'settle', v_job, p_error, p_state, p_where);
  if v_job is not null then
    perform tell(p_world, p_uid, 'You stop ' || coalesce(v_verb, 'working')
      || '. The island failed to finish it: "' || p_error || '". What had come due of it is undone,'
      || ' and anything queued after it is cleared.', 'error');
  elsif v_new then
    perform tell(p_world, p_uid, 'The island failed to bring you up to date: "' || p_error || '".', 'error');
  end if;
end $fn$;

/*
 * One off a stack, the last one included.
 *
 * The count comes down only while more than one is left; the last one goes
 * with its row. Asked in that order rather than read first, so two hands on
 * one stack at once take one each: the second finds one left, or none, and
 * says which rather than taking one that is not there.
 */
create or replace function site_take(p_world uuid, p_x int, p_y int, p_item text)
returns boolean language plpgsql as $fn$
declare v_id bigint;
begin
  select i.id into v_id
    from crate c
    join item i on i.world_id = c.world_id and i.holder = 'crate' and i.crate = c.id and i.def = p_item
   where c.world_id = p_world and c.x = p_x and c.y = p_y and i.count > 0
   order by i.ql, i.id limit 1;
  if v_id is null then return false; end if;
  update item set count = count - 1 where id = v_id and count > 1;
  if found then return true; end if;
  delete from item where id = v_id;
  return found;
end $fn$;

create or replace function take_spoil(p_world uuid, p_uid uuid, p_def text)
returns boolean language plpgsql as $fn$
declare v_id bigint;
begin
  if consume(p_world, p_uid, p_def, 1) then return true; end if;
  select i.id into v_id from item i
    join crate c on c.world_id = i.world_id and c.id = i.crate
   where i.world_id = p_world and i.holder = 'crate' and i.def = p_def and not i.locked
     and sqrt((crate_centre_x(c) - (select pl.x from player pl where pl.world_id = p_world and pl.uid = p_uid)) ^ 2
            + (crate_centre_y(c) - (select pl.y from player pl where pl.world_id = p_world and pl.uid = p_uid)) ^ 2) <= 2.5
   order by i.id limit 1;
  if v_id is null then
    select i.id into v_id from item i
      join placed p on p.world_id = i.world_id and p.id = i.placed
     where i.world_id = p_world and i.holder = 'furniture' and i.def = p_def and not i.locked
       and near_piece(p_world, p_uid, p, 2.5)
     order by i.id limit 1;
  end if;
  if v_id is null then return false; end if;
  update item set count = count - 1 where id = v_id and count > 1;
  if found then return true; end if;
  delete from item where id = v_id;
  return found;
end $fn$;

create or replace function public.settle(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
        v_err text; v_state text; v_where text;
begin
  /*
   * One body's work, and nobody else's.
   *
   * Everything below used to run bare, and `world_tick` settles every body on
   * every island in one transaction: one go that raised an error took the
   * whole round down with it, every second, for as long as that job was
   * still due. Reported as "something just broke, no actions are working":
   * `take_spoil` set the last spadeful in a cart to a count of 0, which the
   * item table refuses, and for a quarter of an hour nothing anybody did on
   * the island finished.
   *
   * So the goes run in a block of their own. A fault undoes what the block
   * had done -- the goes that had come due in this call, and nothing else --
   * stops that job and the queue behind it, tells its owner what the island
   * said, and is kept in `private.tick_fault` for the deploy to report. A
   * deadlock, a lock that timed out or a serialization failure is not a
   * fault in the job: those are raised as before, and the job is tried again
   * next round. A statement timeout is not caught by `others` at all.
   */
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
                 -- The body's own pace, and then the trade's, which tells only
                 -- on the skill this job is done with.
                 control_speed(p_world, p_uid)
                   * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                               act_scope(p_world, p_uid, d.skill))))
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
                     control_speed(p_world, p_uid)
                       * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                                   act_scope(p_world, p_uid, d.skill)))),
                   act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            perform tell(p_world, p_uid, 'You start ' || d.verb || '.', 'info');
            exit;
          end if;
        end loop;
      end if;
    end loop;
    return done;
  exception
    when deadlock_detected or lock_not_available or serialization_failure then raise;
    when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
      perform settle_fault(p_world, p_uid, v_err, v_state, v_where);
      return 0;
  end;
end $function$;

create or replace function public.world_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare v_rotted int := 0; w record; p record; v_lit int := 0; v_fired int := 0;
        v_t0 timestamptz; v_mark timestamptz;
        v_settle_ms double precision := 0; v_stir_ms double precision := 0;
        v_sweep_ms double precision := 0; v_tidy_ms double precision := 0;
        v_worlds int := 0; v_settled int := 0; v_stirred int := 0;
        v_sprung int := 0; v_gone int := 0;
        v_said int := 0; v_folded int := 0; v_sunk int := 0;
        v_tidy boolean := false; v_deadline timestamptz;
        v_err text; v_state text; v_where text; v_faults int := 0;
begin
  /*
   * One round at a time.
   *
   * `pg_cron` starts a job on its schedule whether or not the last one has
   * finished, and at a second there is far less room than there was at five.
   * Nothing here can settle a job twice — `settle` takes `for update` on the
   * player row and re-checks `act_ends <= now()` — but two rounds fighting
   * over the same rows is work neither of them needed to do. A round that
   * finds the clock already turning goes back to bed; its work is due again
   * in a second.
   */
  if not pg_try_advisory_lock(hashtext('world_tick')::bigint) then
    return jsonb_build_object('worlds', 0, 'busy', true);
  end if;

  v_t0 := clock_timestamp();
  -- How long this round may spend settling wildlife. See the note above.
  v_deadline := clock_timestamp() + settle_budget();

  -- The tidying is not the settling and does not want the settling's pace: a
  -- scan every five seconds to delete nothing is just a scan.
  update keeper set swept_at = now()
    where one and swept_at < now() - make_interval(secs => sweep_every());
  v_tidy := found;

  for w in
    select id from world where ready and exists (
      select 1 from player
      where player.world_id = world.id and not player.away
        and player.seen_at > now() - make_interval(secs => idle_logout()))
    order by id limit tick_worlds()
  loop
    v_worlds := v_worlds + 1;

    -- Everything anybody has finished doing, and the next go of it. This is
    -- not on the budget: a person waiting on their own action is the one
    -- thing the clock exists to serve, and there are at most `tick_players()`
    -- of them.
    v_mark := clock_timestamp();
    for p in select uid from player
      where world_id = w.id and act is not null and act_ends <= now()
      order by uid limit tick_players()
    loop
      v_settled := v_settled + settle(w.id, p.uid);
    end loop;
    v_settle_ms := v_settle_ms + ms_since(v_mark);

    /*
     * The rest of the round goes in blocks of its own, for the reason
     * `settle` does: one sweep that raised an error took every island's round
     * down with it, and with it the settling of everybody's work. A fault is
     * kept in `private.tick_fault`, that block's work this round is undone,
     * and the round goes on.
     */
    /*
     * The country round everybody still on their feet — once per patch of it,
     * and only while the round has time left.
     *
     * A crowd at a token or a mine face is a dozen bodies on one tile, and
     * this swept the same ground for each of them. Deduping on the tile is the
     * conservative version of that: two people standing together cost one
     * sweep, two people a tile apart still cost two, and nothing that was
     * being stirred stops being stirred.
     */
    v_mark := clock_timestamp();
    begin
      for p in select distinct floor(x) as x, floor(y) as y from player
        where world_id = w.id and not away
          and seen_at > now() - make_interval(secs => idle_logout())
        order by 1, 2 limit tick_players()
      loop
        exit when clock_timestamp() > v_deadline;
        v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y, 40, v_deadline);
      end loop;
    exception
      when deadlock_detected or lock_not_available or serialization_failure then raise;
      when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
        perform fault_note(w.id, null, 'stir', null, v_err, v_state, v_where);
        v_faults := v_faults + 1;
    end;
    v_stir_ms := v_stir_ms + ms_since(v_mark);
    v_mark := clock_timestamp();

    begin
      v_sprung := v_sprung + trap_sweep(w.id) + post_sweep(w.id);
      -- And the braziers, which take at dusk and are raked out at dawn.
      v_lit := v_lit + brazier_sweep(w.id);
      -- And the furnaces, which used to move only when somebody asked them a question.
      v_fired := v_fired + furnace_sweep(w.id);
      -- And what is lying about, going off where it lies.
      v_rotted := v_rotted + ground_sweep(w.id);
      v_gone := v_gone + log_out_idle(w.id);
    exception
      when deadlock_detected or lock_not_available or serialization_failure then raise;
      when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
        perform fault_note(w.id, null, 'sweeps', null, v_err, v_state, v_where);
        v_faults := v_faults + 1;
    end;
    v_sweep_ms := v_sweep_ms + ms_since(v_mark);

    if v_tidy then
      v_mark := clock_timestamp();
      begin
        v_said := v_said + prune_events(w.id);
        v_folded := v_folded + compact_changes(w.id);
      exception
        when deadlock_detected or lock_not_available or serialization_failure then raise;
        when others then
          get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
          perform fault_note(w.id, null, 'tidy', null, v_err, v_state, v_where);
          v_faults := v_faults + 1;
      end;
      v_tidy_ms := v_tidy_ms + ms_since(v_mark);
    end if;
  end loop;

  if v_tidy then
    v_mark := clock_timestamp();
    begin
      v_sunk := reap_islands();
      -- An hour of rounds is all anybody needs to see where the time went.
      delete from tick_time where at < now() - interval '1 hour';
      -- And a week of faults, which is long enough for somebody to ask.
      delete from private.tick_fault where last_at < now() - interval '7 days';
    exception
      when deadlock_detected or lock_not_available or serialization_failure then raise;
      when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
        perform fault_note(null, null, 'reap', null, v_err, v_state, v_where);
        v_faults := v_faults + 1;
    end;
    v_tidy_ms := v_tidy_ms + ms_since(v_mark);
  end if;

  /*
   * And the wildlife, but only where nothing else is going to do it.
   *
   * `stock_tick` has a `pg_cron` job of its own, because a block of fresh
   * country is a second and a half and this clock comes round every one of
   * them: run it from in here on a project that has cron and the world clock
   * would spend most of its life holding its own lock and skipping beats.
   *
   * Where there is no `pg_cron` -- the suite's bare postgres, and any project
   * without the extension -- this clock is the only clock there is, wound by
   * `rpc_settle` and the browser, so the stocking has to ride it or no wild
   * thing would ever be put out at all.
   */
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform stock_tick();
  end if;

  /*
   * And where the round went, which no run has ever been able to say.
   *
   * `pg_stat_statements` gives one mean for `world_tick` and nothing about
   * which half of it is slow, so an island that will not keep up has had to be
   * diagnosed by reading the source and guessing. One row a round, four
   * numbers, pruned to the last hour on the tidy sweep -- about eighteen
   * hundred rows at a round every two seconds, which is a rounding error
   * beside the work it describes.
   */
  insert into tick_time (ms, worlds, stages) values (
    ms_since(v_t0), v_worlds,
    jsonb_build_object('settle', round(v_settle_ms::numeric, 2),
                       'stir', round(v_stir_ms::numeric, 2),
                       'sweeps', round(v_sweep_ms::numeric, 2),
                       'tidy', round(v_tidy_ms::numeric, 2),
                       'faults', v_faults));

  perform pg_advisory_unlock(hashtext('world_tick')::bigint);
  return jsonb_build_object('worlds', v_worlds, 'settled', v_settled, 'rotted', v_rotted,
                            'stirred', v_stirred, 'sprung', v_sprung, 'left', v_gone,
                            'swept', v_said, 'folded', v_folded, 'sunk', v_sunk,
                            'braziers', v_lit, 'fired', v_fired, 'faults', v_faults);
end $function$;

select private.lock_doors();
