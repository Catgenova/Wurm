/*
 * The quiet island first.
 *
 * Found, not asked for. The live run after d3874d4 failed one check on the
 * island it founds to play on: "and it moves when it is looked at -- 0 of 96
 * are somewhere else 15s later", where the run before it, an hour earlier,
 * had 33 of 82 moving.
 *
 * Nothing had changed on the island between the two. What had changed was
 * who was on it. The run before was made while the page would not load for
 * anybody, so the island everybody plays on was empty; the run after was
 * made as they all came back, six of them at once. And a round of the clock
 * served islands in the order of their ids, all of them out of the one
 * budget for the wildlife (`settle_budget()`, a quarter of a second): the
 * island everybody plays on sorted first, spent the budget on its own
 * thirteen hundred creatures -- a hundred and fifty milliseconds on average,
 * all of it on a busy round -- and the island after it got what was left,
 * which was often nothing at all. Its wildlife stood still for as long as
 * people were playing somewhere else.
 *
 * So `tick_order()` says which islands a round serves and in what order: the
 * islands with the fewest people awake on them first, and the ids only to
 * break a tie. A quiet island's sweep is a few creatures round one or two
 * bodies, a few milliseconds, and the busy island still gets nearly all of
 * the budget; what it cannot do any more is take all of it and leave another
 * island's wildlife frozen. It is its own function so that the order can be
 * asked for and checked, which a round of the clock cannot be.
 */
set local lock_timeout = '3s';

create or replace function tick_order()
 returns setof uuid
 language sql
 stable
 set search_path to 'public'
as $fn$
  select w.id
    from world w
    cross join lateral (
      select count(*) as awake from player p
       where p.world_id = w.id and not p.away
         and p.seen_at > now() - make_interval(secs => idle_logout())) a
   where w.ready and a.awake > 0
   order by a.awake, w.id
$fn$;
revoke all on function tick_order() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.world_tick()
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
        v_tidy boolean := false; v_deadline timestamptz; v_coarse boolean;
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

  -- In the order `tick_order` gives: the islands with the fewest people awake on them first.
  for w in
    select t.id from tick_order() as t(id) limit tick_worlds()
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
    -- What is shown, and a little past it, every round; and the tame in the
    -- whole old box once every `stir_coarse_every()` seconds.
    v_coarse := floor(extract(epoch from v_t0))::bigint % stir_coarse_every()::bigint = 0;
    begin
      for p in select distinct floor(x) as x, floor(y) as y from player
        where world_id = w.id and not away
          and seen_at > now() - make_interval(secs => idle_logout())
        order by 1, 2 limit tick_players()
      loop
        exit when clock_timestamp() > v_deadline;
        v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y, 40, v_deadline, stir_slack());
        if v_coarse then
          v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y, 40, v_deadline, null, true);
        end if;
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
