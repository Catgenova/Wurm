/*
 * The clock takes over a second a round, and this is where it was going.
 *
 * Asked for: "look into why the tick takes over a second", and then the two
 * fixes that came out of it. Measured on a Postgres of our own, against the
 * 4096-tile world, warm:
 *
 *     land_tile               3.7 us    one scanline read
 *     land_height            28.1 us    one corner
 *     four land_height calls  115 us    written out by hand
 *     tile_slope              407 us    the same four, through the function
 *     centre_height           117 us
 *     passable                132 us
 *     creature_tile_ok        683 us    the three above
 *     line_clear              920 us    one short leg
 *
 * Two things in that table. `tile_slope` spends 407 us doing 115 us of work,
 * and `passable` spends 132 us doing 13 us of it: the rest is the machinery of
 * a STABLE SQL function calling a STABLE SQL function calling another. And
 * `centre_height` and `tile_slope` read the *same four corners*, so a tile
 * check reads eight rows where four would do.
 *
 * ## The multiplier
 *
 * A wild creature that has fallen behind replays its walk in `creature_settle`:
 *
 *     while c.until <= now() and guard < 40 loop     -- up to forty legs
 *       for i in 0..7 loop                           -- up to eight candidates
 *         if creature_tile_ok(...) and line_clear(...)
 *
 * Forty legs, eight candidates, 1.6 ms a candidate. Measured, the same
 * creature settled twice:
 *
 *     one second behind      4.78 ms
 *     one hour behind      109.10 ms      -- twenty-three times as much
 *
 * And it is the stale ones that cost: `creature_sweep` only looks forty tiles
 * around a body, so everything else on an island goes stale, and it orders
 * `by until` -- stalest first -- so the 250 ms budget is spent on the dearest
 * rows available. At 109 ms each it buys two creature settles a round.
 *
 * ## What this changes
 *
 * **The legs nobody watched are not walked.** `catch_up_legs()` is four rather
 * than forty. The line that handles "still behind after the cap" was already
 * there and already did the right thing; forty was an eighth of a second of
 * arithmetic to reach an answer that line gives for nothing. Nobody can tell
 * the difference, because a creature only goes stale when there is nobody
 * within forty tiles of it to go stale in front of.
 *
 * **The tile check is one query.** `creature_tile_ok` reads the world row, the
 * tile scanline and the two corner scanlines its four corners lie on, and asks
 * the three questions of them. Four row reads rather than eight, one level of
 * nesting rather than three: 683 us to 343 us, a shade under half.
 *
 * Held to the old one over 62,500 tiles across four islands -- including one
 * with no land rows at all, and every tile from four past each edge -- with
 * **no disagreements**, nulls included. It is also now proof against a
 * scanline shorter than the island says it is: `land_height` would raise on
 * one, this returns "not ground", which is the same answer the bounds check
 * gives a tile that is not there.
 *
 * ## And a round that says where it went
 *
 * `pg_stat_statements` gives one mean for `world_tick` and nothing about which
 * part of it is slow, which is why the paragraphs above had to be arrived at
 * by reading the source. `tick_time` holds one row a round -- settling,
 * stirring, sweeping, tidying -- pruned to the last hour, and the deploy reads
 * it back. The next island that will not keep up can be diagnosed from a run.
 */

/*
 * And first, the thing this migration's own DDL leans on, which turns out not
 * to have been holding anything up.
 *
 * `private.shut` catches `lock_not_available` and retries, six times with a
 * back-off. It never sets `lock_timeout`, so on a session with none set --
 * which is every migration that does not write one at the top of the file --
 * an `alter table` waiting for ACCESS EXCLUSIVE waits for ever and that
 * exception is never raised. The retry has only ever worked for deadlocks.
 * Which is to say: every `alter table` put through `shut` since it was
 * written has been an unbounded stall wearing the costume of a bounded one,
 * and the only reason no deploy has hung on it is that the locks were free.
 *
 * Three seconds an attempt, six attempts, restored afterwards -- the same
 * pattern `private.lock_doors` has used since it was written, which is where
 * this should have been copied from in the first place.
 */
create or replace function private.shut(p_sql text) returns void language plpgsql as $fn$
declare tries int := 0; was text;
begin
  was := coalesce(nullif(current_setting('lock_timeout', true), ''), '0');
  loop
    begin
      perform set_config('lock_timeout', '3s', true);
      execute p_sql;
      perform set_config('lock_timeout', was, true);
      return;
    exception when deadlock_detected or lock_not_available then
      tries := tries + 1;
      if tries >= 6 then
        perform set_config('lock_timeout', was, true);
        raise;
      end if;
      -- Backing off rather than hammering: the heartbeat's own statement is
      -- over in milliseconds and the next go is very likely to be clear.
      perform pg_sleep(0.2 * tries);
    end;
  end loop;
end $fn$;

/* Milliseconds since a mark, which the clock now asks four times a round. */
create or replace function ms_since(p_from timestamptz) returns double precision
language sql stable as $fn$ select extract(epoch from (clock_timestamp() - p_from)) * 1000 $fn$;

/*
 * Legs of catching up worth walking before the clock simply catches the
 * creature up. A leg is a step and a rest -- eight seconds and up to
 * twenty-two more -- so four is a minute or two, and anything settled on a
 * beat is never more than one behind.
 */
create or replace function catch_up_legs() returns integer
language sql immutable as $fn$ select 4 $fn$;

/*
 * Whether a creature can stand on a tile: in bounds, on ground that is not a
 * wall, above the water line, and flat enough. One query.
 *
 * The four corners of a tile lie on two rows of `land_corner`, and the mean of
 * them and the spread of them are both wanted, so both are taken from the one
 * pair of reads. It was `passable` and `centre_height` and `tile_slope`, three
 * STABLE functions over eight reads of four distinct rows.
 */
create or replace function creature_tile_ok(p_world uuid, p_x integer, p_y integer)
returns boolean language sql stable as $fn$
  select p_x >= 0 and p_y >= 0 and p_x < q.size and p_y < q.size
     and not coalesce(q.blocks, true)
     and (q.a + q.b + q.c + q.d) / 4.0 >= -1
     and greatest(q.a, q.b, q.c, q.d) - least(q.a, q.b, q.c, q.d) <= max_stand()
  from (
    select w.size,
           (select d.blocks from tile_def d
             where d.id = case when p_x >= 0 and p_x < length(t.tiles)
                               then get_byte(t.tiles, p_x) end) as blocks,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c0.heights) then b_i16(c0.heights, p_x) end as a,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c0.heights) then b_i16(c0.heights, p_x + 1) end as b,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c1.heights) then b_i16(c1.heights, p_x + 1) end as c,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c1.heights) then b_i16(c1.heights, p_x) end as d
    from world w
    left join land_tile   t  on t.world_id  = p_world and t.y = p_y
    left join land_corner c0 on c0.world_id = p_world and c0.y = p_y
    left join land_corner c1 on c1.world_id = p_world and c1.y = p_y + 1
    where w.id = p_world) q
$fn$;

/* One row a round: how long it took, and which part of it. */
select private.shut($ddl$
create table if not exists tick_time (
  n bigserial primary key,
  at timestamptz not null default now(),
  ms double precision not null,
  worlds int not null default 0,
  stages jsonb not null default '{}'::jsonb
)$ddl$);
select private.shut('create index if not exists tick_time_at on tick_time (at)');
select private.shut('alter table tick_time enable row level security');
CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record; ax double precision; ay double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born);
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then
    -- Nothing has passed for the body — but a worker's day is not its body,
    -- and the trips it is owed are still owed.
    if c.mode = 'deed' then perform worker_settle(p_world, p_id);
    elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
    return false;
  end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * beast_mul(c, 'appetite'));
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
  if c.mode <> 'wild' and c.hunger < graze_hungry() then
    if worker_feed(p_world, p_id) is not null then
      c.hunger := least(1, c.hunger + graze_fill());
    end if;
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
    -- Kept at the token: it stands by the token.
    select md.x + 0.5 as x, md.y + 1.5 as y into home from my_deed(p_world, c.keeper) md where md.world_id is not null;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
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
    for p in select distinct floor(x) as x, floor(y) as y from player
      where world_id = w.id and not away
        and seen_at > now() - make_interval(secs => idle_logout())
      order by 1, 2 limit tick_players()
    loop
      exit when clock_timestamp() > v_deadline;
      v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y, 40, v_deadline);
    end loop;
    v_stir_ms := v_stir_ms + ms_since(v_mark);
    v_mark := clock_timestamp();

    v_sprung := v_sprung + trap_sweep(w.id) + post_sweep(w.id);
    -- And the braziers, which take at dusk and are raked out at dawn.
    v_lit := v_lit + brazier_sweep(w.id);
    -- And the furnaces, which used to move only when somebody asked them a question.
    v_fired := v_fired + furnace_sweep(w.id);
    -- And what is lying about, going off where it lies.
    v_rotted := v_rotted + ground_sweep(w.id);
    v_gone := v_gone + log_out_idle(w.id);
    v_sweep_ms := v_sweep_ms + ms_since(v_mark);

    if v_tidy then
      v_mark := clock_timestamp();
      v_said := v_said + prune_events(w.id);
      v_folded := v_folded + compact_changes(w.id);
      v_tidy_ms := v_tidy_ms + ms_since(v_mark);
    end if;
  end loop;

  if v_tidy then
    v_mark := clock_timestamp();
    v_sunk := reap_islands();
    -- An hour of rounds is all anybody needs to see where the time went.
    delete from tick_time where at < now() - interval '1 hour';
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
                       'tidy', round(v_tidy_ms::numeric, 2)));

  perform pg_advisory_unlock(hashtext('world_tick')::bigint);
  return jsonb_build_object('worlds', v_worlds, 'settled', v_settled, 'rotted', v_rotted,
                            'stirred', v_stirred, 'sprung', v_sprung, 'left', v_gone,
                            'swept', v_said, 'folded', v_folded, 'sunk', v_sunk,
                            'braziers', v_lit, 'fired', v_fired);
end $function$;

select private.lock_doors();
