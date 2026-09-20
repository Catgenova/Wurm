-- A round that always finishes
--
-- Reported: wildly laggy since four o'clock. Measured on the real project,
-- two samples of `pg_stat_statements` eleven and a half minutes apart:
--
--     select public.world_tick()   308,711 -> 308,720 calls
--                                  16,977,934 -> 17,617,037 ms
--
-- Nine rounds in 697 seconds, consuming 639 of them: **seventy-one seconds a
-- round, against a one-second schedule.** `stock_tick` beside it managed 684
-- rounds at 11.6 ms each, which is the control that says the reading is real
-- and the machine is not simply on fire.
--
-- `pg_cron` will not start a job while its last run is still going, so the
-- island's heartbeat was coming round about once a minute. Everything waits
-- on that clock -- every queued action settles on it, every animal moves on
-- it -- so a player sees a world that has stopped and a pick-up that takes
-- fourteen seconds. CI playing on the real island failed a disband outright:
-- `canceling statement due to statement timeout`.
--
-- ---- two faults, and the second made it permanent ------------------------
--
-- **There was no cap on a round.** `creature_sweep` caps *itself* at a
-- hundred and twenty, and that was mistaken for a cap on the work. It is not:
-- `world_tick` runs it once per patch of country anybody is standing on --
-- `tick_players()` of those, on `tick_worlds()` islands -- so the bound on a
-- round was two hundred times twenty times a hundred and twenty.
--
-- **And the sweep starved its own queue.** It took the overdue creatures
-- `order by id limit 120`: not by how long they had waited, by id. Where more
-- than a hundred and twenty were overdue in one box, the same low-numbered
-- hundred and twenty were settled every round and the rest were never reached
-- at all. They stayed overdue for ever, so the next round also found more
-- than a hundred and twenty overdue, and the backlog could not drain however
-- long the clock ran. `order by until` is the whole fix for that half:
-- longest-waiting first, and the cap becomes a delay instead of a wall.
--
-- ---- why the budget is in seconds and not in animals ----------------------
--
-- The first cut of this counted creatures, and it was wrong twice. It counted
-- what `creature_sweep` *returned*, which is the number that settled, not the
-- number it looked at -- a sweep that examines its full hundred and twenty
-- and settles forty-five had spent the work and reported a third of it. And
-- the count it should have used cannot be chosen at all without knowing how
-- fast the machine is: a settle beside a player measured 15.7 ms here, and
-- the live box is several times slower again, by a factor nobody has
-- measured honestly.
--
-- A budget in time needs to know none of that. It spends what it has and
-- stops, the same on a laptop as on a shared instance, and it goes on being
-- right when either of them changes. `clock_timestamp` rather than `now`,
-- because `now` is the transaction's start and would never move.
--
-- Past the budget the wildlife takes its turn a little later, which is the
-- mildest thing in here that can give. The clock keeps time, which is the
-- thing that cannot. And with the queue draining oldest-first, "a little
-- later" is shared out rather than landing on the same unlucky animals every
-- round.
--
-- Nothing about what a creature *does* when its turn comes is touched. Only
-- how many turns come due in one round.

create or replace function settle_budget() returns interval
  language sql immutable as $fn$ select interval '250 milliseconds' $fn$;

-- The parameter is new, so `create or replace` would leave the four-argument
-- version standing beside the five and every three-argument call on the
-- island would stop resolving: *"could not choose a best candidate
-- function"*, from the clock, on the first round after deploy. Caught here by
-- asking the rebuilt database rather than by reading the diff. The old
-- signature goes first.
drop function if exists creature_sweep(uuid, double precision, double precision, double precision);

/**
 * The overdue creatures in a box, longest-waiting first, and no longer than
 * the round can afford.
 *
 * `p_until` is null for every caller that is not the clock -- the no-cron
 * path in `rpc_creatures` among them -- and those behave exactly as before.
 */
create or replace function creature_sweep(p_world uuid, p_x double precision, p_y double precision,
                                          p_range double precision default 40,
                                          p_until timestamptz default null)
returns integer language plpgsql as $fn$
declare r record; n int := 0;
begin
  for r in select id from creature
    where world_id = p_world
      -- The same square as before, written as two ranges so `creature_at` can
      -- serve it. `greatest(abs(dx), abs(dy)) <= r` *is* the box; a function
      -- of a column is not something a btree can look up, and a pair of
      -- `between`s is.
      and to_x between p_x - (p_range + leg_slack()) and p_x + (p_range + leg_slack())
      and to_y between p_y - (p_range + leg_slack()) and p_y + (p_range + leg_slack())
      and until <= now()
    order by until limit 120
  loop
    exit when p_until is not null and clock_timestamp() > p_until;
    if creature_settle(p_world, r.id) then n := n + 1; end if;
  end loop;
  return n;
end $fn$;

create or replace function world_tick() returns jsonb language plpgsql as $fn$
declare v_rotted int := 0; w record; p record; v_lit int := 0; v_fired int := 0;
        v_worlds int := 0; v_settled int := 0; v_stirred int := 0;
        v_sprung int := 0; v_gone int := 0;
        v_said int := 0; v_folded int := 0; v_sunk int := 0;
        v_tidy boolean := false; v_deadline timestamptz;
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
    for p in select uid from player
      where world_id = w.id and act is not null and act_ends <= now()
      order by uid limit tick_players()
    loop
      v_settled := v_settled + settle(w.id, p.uid);
    end loop;

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
    for p in select distinct floor(x) as x, floor(y) as y from player
      where world_id = w.id and not away
        and seen_at > now() - make_interval(secs => idle_logout())
      order by 1, 2 limit tick_players()
    loop
      exit when clock_timestamp() > v_deadline;
      v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y, 40, v_deadline);
    end loop;

    v_sprung := v_sprung + trap_sweep(w.id) + post_sweep(w.id);
    -- And the braziers, which take at dusk and are raked out at dawn.
    v_lit := v_lit + brazier_sweep(w.id);
    -- And the furnaces, which used to move only when somebody asked them a question.
    v_fired := v_fired + furnace_sweep(w.id);
    -- And what is lying about, going off where it lies.
    v_rotted := v_rotted + ground_sweep(w.id);
    v_gone := v_gone + log_out_idle(w.id);

    if v_tidy then
      v_said := v_said + prune_events(w.id);
      v_folded := v_folded + compact_changes(w.id);
    end if;
  end loop;

  if v_tidy then v_sunk := reap_islands(); end if;

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

  perform pg_advisory_unlock(hashtext('world_tick')::bigint);
  return jsonb_build_object('worlds', v_worlds, 'settled', v_settled, 'rotted', v_rotted,
                            'stirred', v_stirred, 'sprung', v_sprung, 'left', v_gone,
                            'swept', v_said, 'folded', v_folded, 'sunk', v_sunk,
                            'braziers', v_lit, 'fired', v_fired);
end $fn$;

select private.lock_doors();

-- ---- and an erratum from earlier tonight ---------------------------------
--
-- `20260919350000` set `caller` to `fillfactor = 70`, reasoning that a table
-- whose every row is rewritten several times a second wants room on the page
-- to rewrite them in place. That reasoning was right and the number was
-- wrong: `20260916131000` had already set it to **50** on exactly that
-- argument, with the measurement beside it — a thousand rate-limit checks
-- going from 127 kB of WAL to 40 bytes, unlogged and with room to spare.
--
-- Raising it to 70 took half that headroom away. The suite caught it, in the
-- one line that has been quietly printing this table's settings all along:
--
--     old: ... with fillfactor=50 so the row is rewritten in place
--     new: ... with fillfactor=70 so the row is rewritten in place
--
-- Which is the argument for a suite that prints settings nobody asked about.
-- Put back.
alter table caller set (fillfactor = 50);
