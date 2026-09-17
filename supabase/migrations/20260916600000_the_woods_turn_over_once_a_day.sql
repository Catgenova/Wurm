-- The woods turn over once a day, and cost nothing on the days between
--
-- Reported from the island: *"there seems to be about a 1 second input delay
-- today."* Sixty frames a second on the screen, so nothing was slow about the
-- drawing. What was slow was the island, and it was slow because of what went
-- into `world_tick` the day before.
--
-- Measured on a four-thousand-wide island, one slice of sixteen lines:
--
--     sixteen empty lines                          0.8 ms
--     sixteen wooded lines, nothing due          110   ms
--     sixteen wooded lines, every tree due    15,550   ms
--
-- `world_tick` runs once a second and holds an advisory lock while it settles
-- everybody's actions. A tenth of a second of looking every second to find
-- nothing, and any slice with real work in it stopping the island's clock for
-- a quarter of a minute. That is the delay, and it is entirely mine.
--
-- ## A day's rule does not want a second's clock
--
-- The walk was built to creep: a slice of the map every round, each tree
-- carrying its own hour of the day so the wood would not turn over all at
-- once. That is a lot of machinery — a cursor, a hashed phase per tile, a
-- window between two moments — and all of it ran every second to answer a
-- question that changes once a day.
--
-- So it does not creep any more. One comparison per round, which is free, and
-- on the round where a day has actually passed the whole island turns over in
-- one go. No cursor, no phase, no window.
--
-- A wood does step together now, which was the thing the phases were for. It
-- is a fair trade: the ages of a wood are mixed to begin with and stay mixed,
-- so what turns over together is every *mature* tree rather than every tree,
-- and nobody is standing still watching one.
--
-- ## Per row, not per tile
--
-- The three costs that made a slice fifteen seconds were all the same mistake.
--
-- `set_byte` on a four-kilobyte line copies four kilobytes, so a thousand
-- trees in a row cost four megabytes of copying — the line is built once now,
-- in one statement, by `string_agg` over the bytes.
--
-- `land_set_data` rewrites the whole line for one byte. One `update` a row.
--
-- `land_announce` reads thirteen further tiles to describe one, and `tile_change`
-- is a live feed for browsers that are *there*. Announcing four million tiles
-- to nobody is four million rows nobody reads: the chunk is forgotten instead,
-- which is what makes the next read of it fresh, and only tiles somebody is
-- standing near are announced.

alter table world add column if not exists trees_at timestamptz not null default now();
alter table world drop column if exists trees_row;

drop function if exists tree_sweep(uuid);
-- And the width of a slice, which was the walk's and has nothing left to tell.
drop function if exists tree_rows();
drop function if exists tree_due(bigint, int, int, double precision, double precision);
drop function if exists tree_phase(bigint, int, int);

/** How near somebody has to be for a tree changing to be worth telling them. */
create or replace function tree_tell_reach() returns int
  language sql immutable as $fn$ select 48 $fn$;

/**
 * A day in the woods: every tree on the island one stage older, the old ones
 * gone, and two saplings out of each stump.
 *
 * One read and one write a line, and one statement to work out both. A line
 * with nothing standing on it is thrown out whole without being read at all.
 */
create or replace function tree_day(p_world uuid) returns int
  language plpgsql as $fn$
declare w record; v_y int; v_tiles bytea; v_data bytea; v_row record;
        v_next int[]; v_moved int := 0; i int; k int;
        v_sx int[] := '{}'; v_sy int[] := '{}'; v_ss int[] := '{}';
        v_tx int[]; v_ty int[]; v_ts int[];
        v_px int[]; v_py int[]; v_near boolean; v_lo int; v_hi int; v_touched boolean := false;
begin
  select * into w from world where id = p_world;
  if not found or not w.ready then return 0; end if;

  -- What each age becomes, read once rather than per tree. -1 is the end of it.
  select array_agg(coalesce(next, -1) order by id) into v_next from tree_age_def;
  -- And who is about, so that what changes under somebody's feet is told to them.
  select array_agg(floor(p.x)::int), array_agg(floor(p.y)::int) into v_px, v_py
    from player p where p.world_id = p_world and not p.away
      and p.seen_at > now() - make_interval(secs => idle_logout());
  if v_px is null then
    v_lo := 0; v_hi := -1;
  else
    select greatest(0, min(v_px[s]) - tree_tell_reach()),
           least(w.size - 1, max(v_px[s]) + tree_tell_reach())
      into v_lo, v_hi from generate_subscripts(v_px, 1) s;
  end if;

  for v_y in 0 .. w.size - 1 loop
    select t.tiles, t.data into v_tiles, v_data
      from land_tile t where t.world_id = p_world and t.y = v_y;
    if not found then continue; end if;
    if position('\x10'::bytea in v_tiles) = 0 then continue; end if;

    /*
     * The whole line in one statement: the new faces, the new ages, how many
     * trees were in it and which of them went.
     *
     * Built rather than edited — `set_byte` on a variable copies the line every
     * time, so a thousand trees in a row would be four megabytes of copying to
     * change a thousand bytes — and one pass rather than three, because reading
     * four thousand bytes is the cost and doing it once is the saving.
     */
    select
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t = 16 and v_next[g.a + 1] < 0 then 0 else g.t end), ''::bytea order by g.gi) as tiles,
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t <> 16 then g.d
        when v_next[g.a + 1] < 0 then 0
        else (g.d & 15) | (v_next[g.a + 1] << 4) end), ''::bytea order by g.gi) as data,
      count(*) filter (where g.t = 16) as here,
      array_agg(g.gi) filter (where g.t = 16 and v_next[g.a + 1] < 0) as dead
      into v_row
      -- `i` is a local here as well as a column, and inside a query the column
      -- wins. The eighth time this class has bitten the island.
      from (select gi, get_byte(v_tiles, gi) as t, get_byte(v_data, gi) as d,
                   (get_byte(v_data, gi) >> 4) & 3 as a
              from generate_series(0, w.size - 1) gi) g;
    if v_row.here = 0 then continue; end if;
    v_moved := v_moved + v_row.here;
    v_touched := true;

    update land_tile t set tiles = v_row.tiles, data = v_row.data
      where t.world_id = p_world and t.y = v_y;

    /*
     * And a word to anybody near enough to watch it happen.
     *
     * The line is asked first, once, whether anybody is within reach of it at
     * all. Walking four thousand columns of a line nobody is on is the same
     * mistake in a new place, and it is most of the island's lines.
     */
    v_near := false;
    if v_px is not null then
      for k in 1 .. array_length(v_px, 1) loop
        if abs(v_py[k] - v_y) <= tree_tell_reach() then v_near := true; exit; end if;
      end loop;
    end if;
    if v_near then
      for i in v_lo .. v_hi loop
        if get_byte(v_tiles, i) <> 16 then continue; end if;
        for k in 1 .. array_length(v_px, 1) loop
          if abs(v_px[k] - i) <= tree_tell_reach() and abs(v_py[k] - v_y) <= tree_tell_reach() then
            perform land_announce(p_world, i, v_y);
            exit;
          end if;
        end loop;
      end loop;
    end if;

    -- What the ones that went leave behind them is gathered up, not planted
    -- here: seeds land in the lines either side of this one, and a line is
    -- written once.
    if v_row.dead is not null then
      foreach i in array v_row.dead loop
        v_sx := v_sx || i;
        v_sy := v_sy || v_y;
        v_ss := v_ss || (get_byte(v_data, i) & 15);
      end loop;
    end if;
  end loop;

  /*
   * And now the saplings, all of them, in three statements rather than fifty
   * queries a stump.
   *
   * A wood that comes of age together dies together, and sixteen thousand
   * stumps looking at twenty-four neighbours apiece — each a tile read, a
   * settlement asked and two line rewrites — is the fifteen seconds all over
   * again. So the ground is asked once for all of them, the winners are drawn
   * once, and each line that gains a sapling is written once.
   */
  if array_length(v_sx, 1) > 0 then
    with dead as (
      select * from unnest(v_sx, v_sy, v_ss) as d(x, y, sp)
    ), cand as (
      select d.x, d.y, d.sp, d.x + q.dx as gx, d.y + q.dy as gy
      from dead d cross join (
        select dx, dy from generate_series(-tree_seed_reach()::int, tree_seed_reach()::int) dx,
                           generate_series(-tree_seed_reach()::int, tree_seed_reach()::int) dy
        where not (dx = 0 and dy = 0)) q
      where d.x + q.dx between 0 and w.size - 1 and d.y + q.dy between 0 and w.size - 1
    ), free as (
      select c.gx, c.gy, c.sp,
             row_number() over (partition by c.x, c.y order by random()) as rn
      from cand c
      join land_tile t on t.world_id = p_world and t.y = c.gy
      join plantable pl on pl.tile = get_byte(t.tiles, c.gx)
      where not exists (select 1 from deed d
                         where d.world_id = p_world and deed_covers(d, c.gx, c.gy))
    ), took as (
      select distinct on (gx, gy) gx, gy, sp from free
       where rn <= tree_seeds()::int order by gx, gy, random()
    )
    select array_agg(gx), array_agg(gy), array_agg(sp)
      into v_tx, v_ty, v_ts from took;
  end if;

  if array_length(v_tx, 1) > 0 then
    update land_tile t set
      tiles = (select string_agg(set_byte('\x00'::bytea, 0,
                 case when s.gx is not null then 16 else get_byte(t.tiles, g.gi) end), ''::bytea order by g.gi)
               from generate_series(0, w.size - 1) g(gi)
               left join unnest(v_tx, v_ty, v_ts) as s(gx, gy, sp)
                 on s.gy = t.y and s.gx = g.gi),
      data = (select string_agg(set_byte('\x00'::bytea, 0,
                 case when s.gx is not null then (s.sp & 15) | (tree_first() << 4)
                      else get_byte(t.data, g.gi) end), ''::bytea order by g.gi)
               from generate_series(0, w.size - 1) g(gi)
               left join unnest(v_tx, v_ty, v_ts) as s(gx, gy, sp)
                 on s.gy = t.y and s.gx = g.gi)
     where t.world_id = p_world and t.y in (select distinct gy from unnest(v_ty) as u(gy));
    v_touched := true;
  end if;

  /*
   * And the chunk cache, dropped for the island in one statement.
   *
   * `land_chunk_forget` takes a tile and deletes the chunk around it; calling
   * it per chunk per line is sixty-four deletes a line and thirty thousand for
   * a wooded island. A day in the woods changes ground everywhere, so the
   * answer is to forget all of it at once — a chunk is only a cache, and the
   * next read of one builds it again from the land.
   */
  if v_touched then delete from land_chunk where world_id = p_world; end if;
  update world set trees_at = now() where id = p_world;
  return v_moved;
end $fn$;

select private.lock_doors();

/*
 * And the woods out of the second-by-second clock altogether.
 *
 * Even once a day, a wood that comes of age together is ten seconds of work on
 * a big island — and `world_tick` holds an advisory lock while it settles
 * everybody's actions, so ten seconds in there is ten seconds of nobody's
 * hatchet landing. The woods get their own winding instead, on their own lock,
 * where taking a while costs nothing but time.
 */
CREATE OR REPLACE FUNCTION public.world_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare v_rotted int := 0; w record; p record; v_lit int := 0;
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
    -- And what is lying about, going off where it lies.
    v_rotted := v_rotted + ground_sweep(w.id);
    v_gone := v_gone + log_out_idle(w.id);

    if v_tidy then
      v_said := v_said + prune_events(w.id);
      v_folded := v_folded + compact_changes(w.id);
    end if;
  end loop;

  if v_tidy then v_sunk := reap_islands(); end if;

  perform pg_advisory_unlock(hashtext('world_tick')::bigint);
  return jsonb_build_object('worlds', v_worlds, 'settled', v_settled, 'rotted', v_rotted,
                            'stirred', v_stirred, 'sprung', v_sprung, 'left', v_gone,
                            'swept', v_said, 'folded', v_folded, 'sunk', v_sunk,
                            'braziers', v_lit);
end $function$;

/**
 * The woods' own round: every island whose day has come, and nothing else.
 *
 * Its own advisory lock, so a long day on a big island never has two of them
 * in it, and never stands in the clock's way.
 */
create or replace function tree_tick() returns jsonb
  language plpgsql as $fn$
declare w record; v_isles int := 0; v_grew int := 0;
begin
  if not pg_try_advisory_lock(hashtext('tree_tick')::bigint) then
    return jsonb_build_object('isles', 0, 'busy', true);
  end if;
  for w in
    select id from world
     where ready and trees_at <= now() - make_interval(secs => tree_stage())
     order by trees_at limit tick_worlds()
  loop
    v_isles := v_isles + 1;
    v_grew := v_grew + tree_day(w.id);
  end loop;
  perform pg_advisory_unlock(hashtext('tree_tick')::bigint);
  return jsonb_build_object('isles', v_isles, 'grew', v_grew);
end $fn$;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return; end if;
  -- Ten minutes: a day's rule does not want a second's clock, and this way an
  -- island whose day came while nobody was on it has it the next time anybody
  -- is. `cron.schedule` is an upsert on the name, so this re-times rather than
  -- winding a second one.
  perform cron.schedule('tree-tick', '*/10 * * * *', 'select public.tree_tick()');
exception when others then
  raise notice 'could not wind the woods (%)', sqlerrm;
end $$;

notify pgrst, 'reload schema';
select private.lock_doors();
