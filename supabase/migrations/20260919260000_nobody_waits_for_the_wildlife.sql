-- Nobody waits for the wildlife any more
--
-- Putting the wild things out was work the island did *on the walk call*. A
-- block of country is stocked the first time somebody walks into it, and that
-- somebody stood still while it happened.
--
-- Measured on Bigness, one block, before this:
--
--     a block of land:  1,532 - 2,078 ms
--     a block of sea:     612 - 644 ms
--     a block already out: 0.013 ms
--
-- The last line is why it went unnoticed for so long: it is free every time
-- except the first, and the first is the one a player meets.
--
-- And the cost was never only the walking. PostgREST answers eight requests
-- at a time. A walk call that takes two seconds holds one of those eight for
-- two seconds; three people crossing fresh country hold three. Everything
-- else the island was asked queued behind them -- which is why this was
-- reported as the island severely delaying its answers rather than as
-- movement being laggy. It was never really about movement.
--
-- ## Two clocks, because one would eat the other
--
-- The obvious move is four lines inside `world_tick`. It is wrong. That clock
-- comes round every second and holds an advisory lock while it runs; drop a
-- second and a half of stocking into it and it spends most of its life
-- holding its own lock, every round behind it finds it held and goes back to
-- bed, and the settling -- everything anybody has finished doing, every move
-- every creature makes -- stops dead for the duration. That trades a stall
-- one walker could see for a stutter the whole island can.
--
-- So `stock_tick` is its own function on its own `pg_cron` job with its own
-- lock. The slow clock can take its second and a half and the fast one never
-- notices. A round does at most `stock_a_round()` blocks -- one -- for the
-- same reason.
--
-- Where there is no `pg_cron` -- the suite's bare postgres, and any project
-- without the extension -- `world_tick` calls it, because there the world
-- clock is the only clock there is and nothing would ever be put out
-- otherwise. That is guarded on the extension actually being installed, so no
-- project ever runs both.
--
-- ## Ahead of the walker, not behind them
--
-- The walk call could only ever stock the block somebody was already standing
-- in, because standing in it is how it found out. A clock knows where every
-- body on the island is -- `world_tick` already works out that same list of
-- tiles for the creature sweep -- so it puts out the block underfoot *and the
-- eight around it*. A block is two hundred and fifty-six tiles across and a
-- body does three or four a second, so the ring is a minute of walking away
-- and nine seconds of clock to fill. The country is stocked long before
-- anybody arrives, instead of because they did.
--
-- The block underfoot goes first, so that if a round only manages one thing
-- it is the one somebody is actually standing in.
--
-- ## What this does not touch
--
-- `rpc_ready` still stocks the spawn block when somebody comes ashore, and
-- deliberately. It happens once a session rather than once a walk, and it is
-- the difference between landing on an island with animals on it and landing
-- on an empty one and waiting for the clock. Coming ashore is allowed to cost
-- something; walking is not.
--
-- Nothing about *what* gets put out moved: same density, same species, same
-- ground rules, same `restock_every`. Only who waits for it.
--
-- ## Measured
--
--     thirty walk steps across fresh country:  58 ms   (1.94 ms a call)
--     the same walk before this:               2,078 ms on the step that hit it
--     one turn of the stocking clock:          725 ms, one block, eight animals
--     a turn with the country already out:     under a millisecond
--     `world_tick` with the stocking behind it: 0.79 ms a round
--
-- The walk call does not stock, and the test proves it by walking thirty
-- steps across a block that has never been stocked and finding it still
-- empty afterwards -- then turning the clock once and finding it full.

-- ------------------------------------------------------- what a round may do
--
-- Blocks a round, and how far ahead of a body to look. One block is a second
-- and a half of work at worst, and the stocking clock comes round every
-- `tick_seconds()`, so one is the honest number: a round that did four would
-- spend six seconds holding its own lock and the three rounds behind it would
-- find it held and go back to bed.
--
-- One block out is the eight around whoever is walking. A block is two hundred
-- and fifty-six tiles across and a body on its feet does three or four a
-- second, so the ring is a minute or more of walking away and nine seconds of
-- clock to fill -- which is the whole point: it is put out long before anybody
-- reaches it, rather than because they did.
create or replace function stock_a_round() returns int language sql immutable as $fn$ select 1 $fn$;
create or replace function stock_ahead() returns int language sql immutable as $fn$ select 1 $fn$;

-- Whether a block is owed a look: one indexed row, which is the whole cost on
-- the usual answer. Lifted out of `creature_stock_near` so the ring below can
-- ask it without calling the work itself.
create or replace function stock_due(p_world uuid, p_bx int, p_by int)
returns boolean language sql stable as $fn$
  select not exists (select 1 from world_stocked s
    where s.world_id = p_world and s.bx = p_bx and s.by = p_by
      and s.at > now() - make_interval(secs => restock_every()))
$fn$;

-- -------------------------------------------------- the country round a body
create or replace function creature_stock_ahead(p_world uuid, p_x double precision,
                                                p_y double precision, p_left int)
returns int language plpgsql as $fn$
declare v_block int := stock_block(); v_bx int; v_by int;
        dx int; dy int; r int := stock_ahead(); n int := 0;
begin
  if p_left <= 0 then return 0; end if;
  v_bx := floor(p_x / v_block)::int;
  v_by := floor(p_y / v_block)::int;
  -- The block underfoot first: if only one thing gets done this round it must
  -- be the one somebody is actually standing in.
  if stock_due(p_world, v_bx, v_by) then
    perform creature_stock_block(p_world, v_bx, v_by);
    n := n + 1;
  end if;
  for dy in -r .. r loop
    for dx in -r .. r loop
      if n >= p_left then return n; end if;
      if (dx <> 0 or dy <> 0) and stock_due(p_world, v_bx + dx, v_by + dy) then
        perform creature_stock_block(p_world, v_bx + dx, v_by + dy);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $fn$;

-- ------------------------------------------------------- the stocking clock
--
-- When a round may only do one block, which island gets it matters. Ordering
-- the islands by `id` and stopping at the first that had work would mean the
-- lowest id took every round it needed and the ones behind it were never
-- reached at all -- a second island could sit unstocked for ever while the
-- first one was being walked across. So the islands take turns, stamped as
-- they are served and served oldest first, which is exactly what `trees_at`
-- and `tree_tick` already do for the woods.
alter table world add column if not exists stocked_at timestamptz not null default now();

create or replace function stock_tick() returns jsonb language plpgsql as $fn$
declare w record; p record; v_put int := 0; v_worlds int := 0;
begin
  /*
   * A lock of its own, and that is the point of this function existing at all
   * rather than being four lines inside `world_tick`.
   *
   * Putting a block of country out is a second and a half. The world clock
   * comes round every second. Share a lock between them and the settling --
   * everything anybody has finished doing, and the wildlife's own moves --
   * stops dead for the duration, every time somebody walks somewhere new.
   * Two clocks, two locks: the slow one can take its second and a half and
   * the fast one never notices.
   */
  if not pg_try_advisory_lock(hashtext('stock_tick')::bigint) then
    return jsonb_build_object('worlds', 0, 'busy', true);
  end if;

  for w in
    select id from world where ready and exists (
      select 1 from player
      where player.world_id = world.id and not player.away
        and player.seen_at > now() - make_interval(secs => idle_logout()))
    order by stocked_at limit tick_worlds()
  loop
    v_worlds := v_worlds + 1;
    -- Stamped on the way in rather than on the way out, so that an island this
    -- round did reach goes to the back of the queue whether or not it turned
    -- out to have anything owing, and the ones it never reached keep their old
    -- stamp and come first next time.
    update world set stocked_at = now() where id = w.id;
    -- The same tiles the sweep uses, and deduped the same way: a dozen bodies
    -- on one tile are one patch of country, not a dozen.
    for p in select distinct floor(x) as x, floor(y) as y from player
      where world_id = w.id and not away
        and seen_at > now() - make_interval(secs => idle_logout())
      order by 1, 2 limit tick_players()
    loop
      exit when v_put >= stock_a_round();
      v_put := v_put + creature_stock_ahead(w.id, p.x, p.y, stock_a_round() - v_put);
    end loop;
    exit when v_put >= stock_a_round();
  end loop;

  perform pg_advisory_unlock(hashtext('stock_tick')::bigint);
  return jsonb_build_object('worlds', v_worlds, 'blocks', v_put);
end $fn$;

-- ------------------------------------------------------------ winding it up
do $$
declare every text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return; end if;
  every := case when exists (select 1 from pg_extension where extname = 'pg_cron'
                               and string_to_array(extversion, '.')::int[] >= array[1, 5])
                then tick_seconds()::int || ' seconds' else '* * * * *' end;
  perform cron.schedule('stock-tick', every, 'select public.stock_tick()');
  raise notice 'stock-tick now runs every %', every;
exception when others then
  raise notice 'could not wind the stocking clock (%)', sqlerrm;
end $$;

CREATE OR REPLACE FUNCTION public.rpc_move(p_world uuid, p_x double precision, p_y double precision, p_level integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; w world;
        gap double precision; far double precision; allowed double precision; share double precision;
        pulled boolean := false; blocked boolean := false;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then raise exception 'you are not on this island'; end if;
  select * into w from world where id = p_world;
  if p_x < 0 or p_y < 0 or p_x > w.size or p_y > w.size then raise exception 'that is off the island'; end if;

  /*
   * And first: whether this body can walk at all.
   *
   * Past what a back takes everything is already slower and dearer in wind,
   * and that was the whole of it — load a body with ten times its limit and it
   * still walked, at a crawl. Asked for: "when inventory is above 150% cap,
   * movement speed becomes 0". Half again over the limit is the end of it, and
   * the end has to be here rather than only in the browser: what the island
   * will not do is the only kind of cannot there is.
   *
   * Nothing is said from down here. This call is made a dozen times a walk, so
   * a line each time would be the whole event log; the browser holds the same
   * two numbers and says it once, when it happens.
   */
  if over_carry(p_world, me) > carry_stop() then
    p_x := p.x;
    p_y := p.y;
    p_level := p.level;
    blocked := true;
  end if;

  gap := greatest(0.05, extract(epoch from (now() - p.moved_at)));
  far := sqrt(power(p_x - p.x, 2) + power(p_y - p.y, 2));
  -- A walk, a saddle or a seat; the rest is slack for a link that hiccups.
  allowed := travel_speed(p_world, me) * least(gap, 10) * 1.6 + 1.5;
  if far > allowed then
    p_x := p.x + (p_x - p.x) * (allowed / far);
    p_y := p.y + (p_y - p.y) * (allowed / far);
    pulled := true;
  end if;

  share := walk_share(p_world, me, p_level, p.x, p.y, p_x, p_y);
  if share < 1 then
    p_x := p.x + (p_x - p.x) * share;
    p_y := p.y + (p_y - p.y) * share;
    blocked := true;
  end if;

  update player set x = p_x, y = p_y, level = p_level, moved_at = now(), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  perform drag_along(p_world, me, p_x, p_y);
  /*
   * And the wildlife is *not* put out here any more.
   *
   * It was: walking into a block of country nobody had been through stocked
   * it, on this call, while the walker stood and waited. A block of land is
   * something like a second and a half of that, and it is paid on the one
   * call a walking browser makes constantly -- so the walk stopped, and
   * because PostgREST answers eight at a time, three people crossing fresh
   * country took three of those eight for the duration and *everything* the
   * island was asked went slow with them. That is the whole of what was
   * reported as the island severely delaying its answers.
   *
   * It lives on `stock_tick` now, which has a clock of its own and a lock of
   * its own, and which puts out the block a body is standing in *and the
   * eight around it* -- so the country is stocked before anybody walks into
   * it rather than because they did. Nobody waits for it. See `stock_tick`.
   */
  /*
   * And the body, on the one call a walking browser makes constantly.
   *
   * Reported as being killed by a goblin with the health bar never moving and
   * no wound ever showing, and then walking about dead until a refresh. Both
   * halves are this answer: `stats` and `wounds` rode `rpc_settle` and nothing
   * else, and `rpc_settle` is a minute apart unless one of your *own* asks
   * arms it. Something eating you arms nothing, so a fight that takes ten
   * seconds happens entirely inside one heartbeat: the island takes the health
   * off and opens the wounds and kills you, and the browser is drawing a body
   * from a minute ago — full, unmarked, and still walking.
   *
   * Which is the second half. `settle` at the top of this function is where a
   * bleeding body dies, and `player_die` puts it back at the spawn; the row
   * below is read after that, so the pull-back above is already measuring from
   * where the island has *just put you*. The answer said none of it, and the
   * browser threw away what it did say — `x` and `y` have been in here since
   * the day it was written and nothing has ever read them.
   *
   * So it says where you are, what is left of you, and what you are carrying.
   * A walk is half a second apart at worst, which is the difference between
   * watching yourself die and being told about it afterwards.
   */
  select * into p from player where world_id = p_world and uid = me;
  return jsonb_build_object('x', p_x, 'y', p_y, 'level', p_level,
    'pulled', pulled, 'blocked', blocked,
    'stats', p.stats, 'wounds', coalesce(p.wounds, '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.world_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare v_rotted int := 0; w record; p record; v_lit int := 0; v_fired int := 0;
        v_worlds int := 0; v_settled int := 0; v_stirred int := 0;
        v_sprung int := 0; v_gone int := 0;
        v_said int := 0; v_folded int := 0; v_sunk int := 0;
        v_tidy boolean := false;
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

    -- Everything anybody has finished doing, and the next go of it.
    for p in select uid from player
      where world_id = w.id and act is not null and act_ends <= now()
      order by uid limit tick_players()
    loop
      v_settled := v_settled + settle(w.id, p.uid);
    end loop;

    /*
     * The country round everybody still on their feet — once per patch of it.
     *
     * A crowd at a token or a mine face is a dozen bodies on one tile, and
     * this swept the same ground for each of them. Deduping on the tile is the
     * conservative version of that: two people standing together cost one
     * sweep, two people a tile apart still cost two, and nothing that was
     * being stirred stops being stirred. The index under the sweep took most
     * of this win before this line did — it is a tenth of a millisecond now
     * rather than half of one — so the safe reading is the right one.
     */
    for p in select distinct floor(x) as x, floor(y) as y from player
      where world_id = w.id and not away
        and seen_at > now() - make_interval(secs => idle_logout())
      order by 1, 2 limit tick_players()
    loop
      v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y);
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
end $function$;

select private.lock_doors();
