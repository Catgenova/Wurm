/*
 * A cheaper stir: the box a browser is shown every round, and the rest in
 * coarse steps.
 *
 * Asked for: "A cheaper world tick. It averages 111 ms but hits 556 ms at the
 * 95th percentile and 1.5 s at worst, on a 1-second clock. 94% of that is
 * wild creatures wandering (1,339 on the main island). Move creatures near a
 * player every second and the rest in coarse steps."
 *
 * Every round swept a box round each body by where its creatures were
 * heading: the 40 tiles a browser is shown plus `leg_slack()`, 104 tiles each
 * way and six and a half times the ground anybody could see. Every creature
 * in it that was due was walked, whatever it was due for.
 *
 * Now a round sweeps what is shown plus `stir_slack()`, so a creature walking
 * into view has been walked already. A wild creature further than that from
 * everybody stands where it is until somebody comes near, and then catches up
 * in the legs it is owed -- `catch_up_legs()` of them, then a jump, as it
 * always has when a box first reached it. Nothing is lost by it: nothing that
 * hunts notices anybody from further off than its `notice`, twenty tiles at
 * the most, and a chase lets go at `hunt_leash()`, thirty.
 *
 * Tame ones are not left standing. A settlement's workers do work that counts
 * whether or not anybody is watching, so once every `stir_coarse_every()`
 * seconds the round sweeps the whole old box for the tame alone -- workers,
 * posted ones and crated ones -- and they catch up in the same way.
 *
 * And a creature in a crate is settled every `stored_settle()` seconds rather
 * than every round. It never walks: it only stands where its crate is, and
 * its hunger and care are counted from the time that passed.
 *
 * Measured on a local island of 450 wild creatures within a hundred tiles of
 * one body, their legs spread over twenty seconds, thirty real rounds a
 * second apart: see the commit.
 */

drop function if exists creature_sweep(uuid, double precision, double precision, double precision, timestamptz);
/*
 * The overdue creatures in a box, longest-waiting first, and no longer than
 * the round can afford.
 *
 * `p_slack` is how far past `p_range` the box reaches, by where a creature is
 * heading; left out, it is `leg_slack()`, the most a leg can carry one, which
 * is what every caller but the clock's every-round sweep asks for. And
 * `p_tame` keeps to creatures that are somebody's.
 */
create or replace function creature_sweep(p_world uuid, p_x double precision, p_y double precision,
                                          p_range double precision default 40,
                                          p_until timestamptz default null,
                                          p_slack double precision default null,
                                          p_tame boolean default false)
returns integer language plpgsql as $fn$
declare r record; n int := 0; v_reach double precision := p_range + coalesce(p_slack, leg_slack());
begin
  for r in select id from creature
    where world_id = p_world
      and to_x between p_x - v_reach and p_x + v_reach
      and to_y between p_y - v_reach and p_y + v_reach
      and until <= now()
      and (not p_tame or mode <> 'wild')
    order by until limit 120
  loop
    exit when p_until is not null and clock_timestamp() > p_until;
    if creature_settle(p_world, r.id) then n := n + 1; end if;
  end loop;
  return n;
end $fn$;

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

CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record; ax double precision; ay double precision; v_rig placed;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born);
  /*
   * In the traces until somebody takes it out.
   *
   * A hitch was a column and nothing else read it: the settle below went on
   * walking a companion to its keeper's feet and sending a worker out to its
   * trade, so an animal backed into a yoke was at its owner's heels a second
   * later, still hitched to a wagon it was nowhere near. It stands at the
   * vehicle now, thinks nothing, and does not get hungry, until `unhitch_one`
   * or `unhitch_all` takes it out -- or what it was hitched to is gone, in
   * which case there is nothing left to be in the traces of.
   */
  if c.hitched_to is not null then
    select * into v_rig from placed where world_id = p_world and id = c.hitched_to;
    if not found then
      update creature set hitched_to = null where world_id = p_world and id = p_id;
      c.hitched_to := null;
    end if;
  end if;
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then
    -- Nothing has passed for the body — but a worker's day is not its body,
    -- and the trips it is owed are still owed. One in the traces owes none.
    if c.hitched_to is not null then return false; end if;
    if c.mode = 'deed' then perform worker_settle(p_world, p_id);
    elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
    return false;
  end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  -- Except in the traces, where the belly holds where it was when it went in.
  if c.hitched_to is null then
    c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * beast_mul(c, 'appetite'));
  end if;
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end * beast_mul(c, 'mend'));
  end if;
  if d.fleece is not null and a.growth > 0 and c.fleece < 1 then
    c.fleece := least(1, c.fleece + elapsed * d.fleece * a.growth * beast_mul(c, 'grow'));
  end if;
  c.care := greatest(0, c.care - elapsed / (3 * 3600));
  /*
   * And a hungry one on a deed goes to the stores.
   *
   * Written on the row rather than on `c`, so the settle below does not carry
   * the old belly back over it. Only when it is actually hungry, which for a
   * worker is an hour or so apart — this is not a cost anybody pays on a beat.
   */
  if c.mode <> 'wild' and c.hitched_to is null and c.hunger < graze_hungry() then
    if worker_feed(p_world, p_id) is not null then
      c.hunger := least(1, c.hunger + graze_fill());
    end if;
  end if;

  -- And no further: it stands at the vehicle, the body settled and nothing else.
  if c.hitched_to is not null then
    update creature set
        from_x = v_rig.cx, from_y = v_rig.cy, to_x = v_rig.cx, to_y = v_rig.cy,
        leg_at = now(), leg_ends = now(), until = now(),
        health = c.health, fleece = c.fleece, care = c.care,
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = p_id;
    return true;
  end if;

  if c.mode = 'wild' then
    if d.hunter then c := hunt_settle(p_world, c, d, a); else c.hunting := null; end if;
  else
    c.hunting := null;
  end if;

  if c.mode = 'wild' and c.hunting is null then
    pace := d.speed * a.speed * beast_mul(c, 'speed') * 0.7;
    while c.until <= now() and guard < catch_up_legs() loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      -- A step about its own country rather than a step from wherever it
      -- last got to. Past the edge of its range it draws towards home
      -- instead, which is what keeps an island's wildlife somewhere in
      -- particular. A creature from before homes existed takes where it
      -- stands, which is what it would have had anyway.
      if c.home_x is null then c.home_x := c.to_x; c.home_y := c.to_y; end if;
      if (c.to_x - c.home_x) ^ 2 + (c.to_y - c.home_y) ^ 2 > wild_range() ^ 2 then
        ax := c.home_x; ay := c.home_y;
      else
        ax := c.to_x; ay := c.to_y;
      end if;
      for i in 0..7 loop
        nx := ax + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * wild_reach();
        ny := ay + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * wild_reach();
        if creature_tile_ok(p_world, floor(nx)::int, floor(ny)::int)
           and line_clear(p_world, c.to_x, c.to_y, nx, ny) then ok := true; exit; end if;
      end loop;
      c.leg := n;
      if not ok then
        -- Hemmed in: stand where it is and look again in a moment.
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '2 seconds';
        continue;
      end if;
      -- It feeds itself on the way. The browser walks it to a forage bed,
      -- grazes for a few seconds and tops the belly up; out here the leg that
      -- ends on ground worth grazing is the same thing without the detail.
      if c.hunger < graze_hungry() and coalesce((select forage from tile_def
            where id = land_tile(p_world, floor(nx)::int, floor(ny)::int)), false) then
        c.hunger := least(1, c.hunger + graze_fill());
      end if;
      dist := sqrt((nx - c.to_x) ^ 2 + (ny - c.to_y) ^ 2);
      secs := greatest(0.2, dist / greatest(0.1, pace));
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := nx; c.to_y := ny;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => secs);
      c.until := c.leg_ends + make_interval(secs => wild_rest() + hash_tile(p_id, n, 11001) * wild_rest_spread());
    end loop;
    /*
     * And past the cap it is where it got to, and the clock catches up with
     * it. This line is the whole reason the cap can come down: it was already
     * here, and it was already the answer for anything more than forty legs
     * behind. Forty was doing an eighth of a second of arithmetic to reach an
     * answer this line gives for nothing.
     *
     * Measured, on a creature an hour behind: 109.10 ms with the cap at forty,
     * against 4.78 ms for one a second behind. Every one of those legs is a
     * random step inside a home range nobody was standing in.
     */
    if c.until <= now() then
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.leg_at := now(); c.leg_ends := now();
      c.until := now() + make_interval(secs => 1 + hash_tile(p_id, c.leg, 11001) * 5);
    end if;
  elsif c.mode = 'active' and c.keeper is not null and c.enemy is null then
    -- A companion is wherever its keeper is; following is not a walk of its own.
    -- A fight is, and one with something in its teeth keeps the legs it has:
    -- `companion_settle`, below, walks it, strikes, and brings it back to heel.
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    -- In a crate: where the crate stands, or at the feet of whoever carries it.
    select pl.cx as x, pl.cy as y into home from placed pl where pl.world_id = p_world and pl.creature = p_id limit 1;
    if not found then
      select py.x, py.y into home from player py where py.world_id = p_world and py.uid = c.keeper;
    end if;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      -- A crated one never walks, so it is not asked every round.
      c.leg_at := now(); c.leg_ends := now(); c.until := now() + make_interval(secs => stored_settle());
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      hunting = c.hunting, hunt_x = c.hunt_x, hunt_y = c.hunt_y, hunt_again = c.hunt_again,
      home_x = c.home_x, home_y = c.home_y,
      settled_at = now()
    where world_id = p_world and id = p_id;
  -- And then the day's work, for whichever of them is on a deed rather than
  -- out in the country. The row goes down first because the work reads it back.
  if c.mode = 'deed' then perform worker_settle(p_world, p_id);
  -- And a companion's company, which is the one thing at heel that is a walk of its own.
  elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
  return true;
end $function$;

select private.lock_doors();
