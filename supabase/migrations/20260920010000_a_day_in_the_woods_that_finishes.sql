-- A day in the woods that finishes, at the hour it is supposed to happen
--
-- Two things were wrong with the trees, and only one of them was visible.
--
-- ## The hour
--
-- Asked: "if the tree tick is to age up the trees, it should ONLY be doing
-- that every morning at 9AM UTC-4." It should, and the island already agreed
-- with that to the hour -- `tree_dawn_utc()` is thirteen, which is nine in the
-- morning at UTC-4, and `tree_last_dawn()` has always been the gate on the
-- work. What disagreed was the *clock*: `tree-tick` was wound at ten-minute
-- intervals, a hundred and forty-four goes a day at a job with one day's work
-- in it.
--
-- A hundred and forty-three of those find nothing owed and go back to bed, so
-- on a healthy island the poll would be nearly free and nobody would have
-- noticed it. It is the hundred and forty-fourth that matters, and what that
-- one did was fail -- twenty-eight times in a row, `canceling statement due to
-- statement timeout`, every ten minutes around the clock.
--
-- ## The cliff on the fourth line
--
-- `tree_day` reads a line of the island into a variable and walks it a byte at
-- a time:
--
--     select t.tiles, t.data into v_tiles, v_data ...
--     ... get_byte(v_tiles, gi), get_byte(v_data, gi), tree_age(get_byte(v_data, gi))
--         from generate_series(0, w.size - 1) gi
--
-- Both columns are four kilobytes wide and both compress hard: a wooded line
-- is 621 bytes of `tiles` and 56 of `data` as the row actually stores it, in
-- the row, packed. `select into` copies the datum it is handed, so the
-- variable holds the packed form. It is not a line; it is a line folded up.
--
-- That costs nothing for three lines and then falls off a cliff, which is why
-- it was never spotted. plpgsql plans a statement afresh for its first few
-- goes, and a fresh plan folds the parameter in as a *constant* -- unpacked
-- once, at plan time. On the fifth go it keeps the plan, and a kept plan takes
-- the value as a *parameter* -- so every `get_byte` unpacks the whole four
-- kilobytes again to read one byte out of it. Three per tile as written; the
-- subqueries flatten and the `case` arms repeat them, so nearer a dozen in
-- fact. Fifty thousand unpackings of a folded line, per line:
--
--     call  1  1.93 ms      call  7  92.57 ms
--     call  2  1.74 ms      call  8  89.05 ms
--     call  3  1.76 ms      call  9  88.74 ms
--     call  4 89.43 ms  <-- call 10  85.19 ms
--     call  5 88.66 ms      call 11  86.55 ms
--     call  6 90.81 ms      call 12  87.24 ms
--
-- Which the whole-function profile agrees with exactly -- everything else in
-- the loop is noise beside it:
--
--     read the line       0.012 ms a line
--     the skip test       0.007 ms a line
--     the line pass      85.5   ms a line     <-- here
--     write the line      0.22  ms a line
--
-- Four thousand lines of that is **five minutes and fifty-seven seconds** for
-- one day in the woods. Nothing with a statement timeout on it survives that,
-- and every attempt had spent minutes rewriting land and holding row locks
-- over it before it was cut down, and then rolled all of it back. The trees on
-- the big island have not aged a day in as long as the log goes back, and the
-- island wore the cost of trying, every ten minutes, around the clock.
--
-- ## The fix is to append nothing
--
--     select t.tiles || ''::bytea, t.data || ''::bytea into v_tiles, v_data
--
-- which unpacks the line in the read, once, and hands `select into` a line
-- rather than a folded one. The kept plan then costs what the fresh plan cost
-- and goes on costing it -- 1.80, 1.79, 1.82, 1.80, 1.80 ms, flat.
--
-- Proved rather than asserted: the old body and the new one, run against the
-- same island in two transactions and both rolled back, moved the same
-- 1,677,610 trees, wrote the same two `tile_change` rows, and left every one
-- of the four thousand lines byte for byte identical --
--
--     md5 over every line, old body   20d3412173c1e621ee5dfa597c162a54
--     md5 over every line, new body   20d3412173c1e621ee5dfa597c162a54
--
-- -- in 357.5 seconds and 24.6 seconds respectively, the second of which is
-- 8.1 on a box with nothing else running on it. Forty-five times, for two
-- appended nothings.
--
-- The grep that found it is worth keeping: no other function on this island
-- reads a wide `bytea` out of a variable a byte at a time. `tree_day` was the
-- only one with a `generate_series` over one, and the only one that loops
-- enough times to reach the fifth go.
--
-- ## So the tick is wound for dawn
--
-- Once a day, at thirteen hundred UTC, which is the dawn the rulebook already
-- named. The gate stays exactly where it was -- an island whose `trees_at` is
-- older than the last dawn has a day owed and takes it -- so an island that
-- misses its turn still gets it, and a `tree_day` that now takes eight seconds
-- has no business being asked a hundred and forty-four times to find that out.


CREATE OR REPLACE FUNCTION public.tree_day(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare w record; v_y int; v_tiles bytea; v_data bytea; v_row record; v_stump int := tile_id('Stump'); v_grass int := tile_id('Grass'); v_lawn int := tile_id('Lawn');
        v_next int[]; v_moved int := 0; i int; k int;
        v_sx int[] := '{}'; v_sy int[] := '{}'; v_ss int[] := '{}';
        v_tx int[]; v_ty int[]; v_ts int[]; v_touched boolean := false;
        v_px int[]; v_py int[]; v_near boolean;
begin
  select * into w from world where id = p_world;
  if not found or not w.ready then return 0; end if;

  -- What each age becomes, read once rather than per tree. -1 is the end of it.
  select array_agg(coalesce(next, -1) order by id) into v_next from tree_age_def;
  -- And who is about, for the half of this that is only worth telling somebody
  -- who can see it happen.
  select array_agg(floor(p.x)::int), array_agg(floor(p.y)::int) into v_px, v_py
    from player p where p.world_id = p_world and not p.away
      and p.seen_at > now() - make_interval(secs => idle_logout());

  for v_y in 0 .. w.size - 1 loop
    /*
     * Read the line out, not the note that says where it is.
     *
     * Both columns are four thousand and ninety-six bytes wide and both
     * compress hard -- a wooded line is 621 bytes of tiles and 56 of data --
     * so what the row holds is the packed form, and `select into` copies the
     * datum it is handed, packed. `v_tiles` was never a line. It was a line
     * folded up.
     *
     * That is free until the fourth time round this loop. plpgsql plans a
     * statement afresh for its first few goes, and a fresh plan folds the
     * parameter in as a constant, which is unpacked once. On the fifth go it
     * keeps the plan, and a kept plan takes the value as a parameter instead
     * -- so every `get_byte` below unpacks the whole four kilobytes again to
     * read one byte of it. The statement under this reads three bytes a tile
     * as written, but the subqueries flatten and the cases repeat them, so it
     * is nearer a dozen: fifty thousand unpackings of a folded line, per line.
     *
     *     line 1-3, plan made fresh      1.8 ms
     *     line 4 onward, plan kept      89.0 ms     <-- the cliff
     *
     * Appending nothing unpacks it here instead, once, and hands `select into`
     * a line rather than a folded line. The kept plan then costs what the
     * fresh one did, and goes on costing it:
     *
     *     line 4 onward, unpacked here   1.8 ms
     *
     * Which is a day in the woods on an island four thousand tiles square
     * going from **five minutes fifty-seven** to **eight seconds**, for the
     * same 1,677,610 trees and the same bytes in every line of the island.
     */
    select t.tiles || ''::bytea, t.data || ''::bytea into v_tiles, v_data
      from land_tile t where t.world_id = p_world and t.y = v_y;
    if not found then continue; end if;
    -- A line with nothing on it that the day moves is thrown out unread: no
    -- tree, no stump, and no grass with a count in it. The last is asked of
    -- the data bytes, which a rock or a tree can also put in the range, so it
    -- errs towards reading a line, never towards skipping one.
    if position('\x10'::bytea in v_tiles) = 0 and position(set_byte('\x00'::bytea, 0, v_stump) in v_tiles) = 0
       and not any_byte_between(v_data, 1, 7) then continue; end if;

    /*
     * The whole line in one statement: the new faces, the new ages, how many
     * trees were in it, which of them went, and which columns moved at all.
     *
     * Built rather than edited — `set_byte` on a variable copies the line every
     * time, so a thousand trees in a row would be four megabytes of copying to
     * change a thousand bytes — and one pass rather than three, because reading
     * four thousand bytes is the cost and doing it once is the saving.
     *
     * `dead` is the ones that went, which is a change of *what the tile is*.
     * `stirred` is every tree in the line that moved: a new age byte, or
     * gone. A stage whose next is itself is not stirred, and is not told of.
     * The two are wanted separately, because they are not worth the same.
     */
    select
      -- What a dead tree leaves is a stump of its kind, for a day; a stump
      -- left a day is grass.
      -- And grass kept cut on a deed: the day moves the cut-today flag into
      -- the count, the third day makes lawn, and a day with no cut starts
      -- the count over.
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t = 16 and g.n < 0 then v_stump
        when g.t = v_stump then 0
        when g.t = v_grass and (g.d & 4) <> 0 and (g.d & 3) + 1 >= 3 then v_lawn
        else g.t end), ''::bytea order by g.gi) as tiles,
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t = v_stump then 0
        when g.t = v_grass and (g.d & 4) <> 0 then case when (g.d & 3) + 1 >= 3 then 0 else (g.d & 3) + 1 end
        when g.t = v_grass then 0
        when g.t <> 16 then g.d
        -- The species bits, low nibble and top bit, kept; the age between them moved on.
        when g.n < 0 then g.d & 143
        else (g.d & 143) | (g.n << 4) end), ''::bytea order by g.gi) as data,
      count(*) filter (where g.t = 16) as here,
      array_agg(g.gi) filter (where (g.t = 16 and (g.n < 0 or g.n <> g.a)) or g.t = v_stump or (g.t = v_grass and g.d <> 0)) as stirred,
      array_agg(g.gi) filter (where g.t = 16 and g.n < 0) as dead
      into v_row
      -- `i` is a local here as well as a column, and inside a query the column
      -- wins. The eighth time this class has bitten the island.
      --
      -- `n` is what the age becomes: the next stage, -1 for the end of it, or
      -- the same age again for one with nothing written down — a stage that
      -- stays as it is, or a byte nobody has a row for. A null here would
      -- drop the byte out of the line and shorten it.
      from (select q.gi, q.t, q.d, q.a, coalesce(v_next[q.a + 1], q.a) as n
              from (select gi, get_byte(v_tiles, gi) as t, get_byte(v_data, gi) as d,
                           tree_age(get_byte(v_data, gi)) as a
                      from generate_series(0, w.size - 1) gi) q) g;
    if v_row.here = 0 and v_row.stirred is null then continue; end if;
    v_moved := v_moved + v_row.here;
    v_touched := true;

    update land_tile t set tiles = v_row.tiles, data = v_row.data
      where t.world_id = p_world and t.y = v_y;

    /*
     * And the line's changes into the record, in one statement.
     *
     * This is `land_announce` for a whole line at once. That function reads
     * thirteen tiles to describe one — the face, the data and eight corner
     * lookups apiece for height and soil — and a line of a thousand trees is
     * thirteen thousand single-row reads. The corners of every tile in a line
     * live in exactly two rows of `land_corner`, so they are joined once and
     * read from memory.
     *
     * The stumps go in whatever else is true, because a tile that has stopped
     * being a tree has stopped being a tree for everybody.
     */
    v_near := false;
    if v_px is not null then
      for k in 1 .. array_length(v_px, 1) loop
        if abs(v_py[k] - v_y) <= tree_tell_reach() then v_near := true; exit; end if;
      end loop;
    end if;
    insert into tile_change (world_id, x, y, region, tile, data, corners, soil)
    select p_world, u.gi, v_y, region_of(u.gi, v_y),
           get_byte(v_row.tiles, u.gi), get_byte(v_row.data, u.gi),
           array[b_i16(c0.heights, u.gi), b_i16(c0.heights, u.gi + 1),
                 b_i16(c1.heights, u.gi + 1), b_i16(c1.heights, u.gi)],
           array[get_byte(c0.dirt, u.gi), get_byte(c0.dirt, u.gi + 1),
                 get_byte(c1.dirt, u.gi + 1), get_byte(c1.dirt, u.gi)]
      from unnest(case when v_near then v_row.stirred else v_row.dead end) as u(gi)
      join land_corner c0 on c0.world_id = p_world and c0.y = v_y
      join land_corner c1 on c1.world_id = p_world and c1.y = v_y + 1;

    -- What the ones that went leave behind them is gathered up, not planted
    -- here: seeds land in the lines either side of this one, and a line is
    -- written once.
    if v_row.dead is not null then
      foreach i in array v_row.dead loop
        v_sx := v_sx || i;
        v_sy := v_sy || v_y;
        v_ss := v_ss || tree_species(get_byte(v_data, i));
      end loop;
    end if;
  end loop;

  -- A year's growth closes whatever was cut into anything.
  delete from tree_notch where world_id = p_world;

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
      -- One roll per stump, not per spot it might take: `random()` in the
      -- candidate list would give a different answer for every neighbour.
      select d.x, d.y, d.sp, random() as roll
        from unnest(v_sx, v_sy, v_ss) as d(x, y, sp)
    ), cand as (
      select d.x, d.y, d.sp, d.roll, d.x + q.dx as gx, d.y + q.dy as gy
      from dead d cross join (
        select dx, dy from generate_series(-tree_seed_reach()::int, tree_seed_reach()::int) dx,
                           generate_series(-tree_seed_reach()::int, tree_seed_reach()::int) dy
        where not (dx = 0 and dy = 0)) q
      where d.x + q.dx between 0 and w.size - 1 and d.y + q.dy between 0 and w.size - 1
    ), free as (
      select c.gx, c.gy, c.sp, c.roll,
             row_number() over (partition by c.x, c.y order by random()) as rn,
             count(*) over (partition by c.x, c.y) as room
      from cand c
      join land_tile t on t.world_id = p_world and t.y = c.gy
      join plantable pl on pl.tile = get_byte(t.tiles, c.gx)
      where not exists (select 1 from deed d
                         where d.world_id = p_world and deed_covers(d, c.gx, c.gy))
    ), want as (
      /*
       * What it wants, and what the ground will have.
       *
       * The roll averages a shade over replacement; the room is what keeps a
       * thick wood from running away, because a stump with nothing open round
       * it leaves nothing. Neither alone settles anywhere — together they do.
       */
      select f.gx, f.gy, f.sp, f.rn, least(
        case when f.roll < tree_seed_none() then 0
             when f.roll < 1 - tree_seed_both() then 1 else tree_seeds()::int end,
        case when f.room >= tree_room_two() then tree_seeds()::int
             when f.room >= tree_room_one() then 1 else 0 end) as take
      from free f
    ), took as (
      select distinct on (gx, gy) gx, gy, sp from want
       where rn <= take order by gx, gy, random()
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
                 case when s.gx is not null then tree_pack(s.sp, tree_first())
                      else get_byte(t.data, g.gi) end), ''::bytea order by g.gi)
               from generate_series(0, w.size - 1) g(gi)
               left join unnest(v_tx, v_ty, v_ts) as s(gx, gy, sp)
                 on s.gy = t.y and s.gx = g.gi)
     where t.world_id = p_world and t.y in (select distinct gy from unnest(v_ty) as u(gy));

    /*
     * And the saplings into the record as well, which is the half that was
     * never written at all.
     *
     * After the stumps, deliberately: a tile can lose its tree and gain a
     * neighbour's sapling in the same day, and the reader lays changes down in
     * the order they were written. Grass first, then the sapling on it.
     */
    insert into tile_change (world_id, x, y, region, tile, data, corners, soil)
    select p_world, u.gx, u.gy, region_of(u.gx, u.gy),
           16, tree_pack(u.sp, tree_first()),
           array[b_i16(c0.heights, u.gx), b_i16(c0.heights, u.gx + 1),
                 b_i16(c1.heights, u.gx + 1), b_i16(c1.heights, u.gx)],
           array[get_byte(c0.dirt, u.gx), get_byte(c0.dirt, u.gx + 1),
                 get_byte(c1.dirt, u.gx + 1), get_byte(c1.dirt, u.gx)]
      from unnest(v_tx, v_ty, v_ts) as u(gx, gy, sp)
      join land_corner c0 on c0.world_id = p_world and c0.y = u.gy
      join land_corner c1 on c1.world_id = p_world and c1.y = u.gy + 1;
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
end $function$;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return; end if;
  -- `cron.schedule` is an upsert on the name, so this re-times the job rather
  -- than winding a second one beside it. The ten-minute poll is gone.
  perform cron.schedule('tree-tick', '0 13 * * *', 'select public.tree_tick()');
exception when others then
  raise notice 'could not wind the woods (%)', sqlerrm;
end $$;

/*
 * And while we are here: what `caller` is actually set to.
 *
 * `20260916131000_hot_path.sql` made that table unlogged with room in the page
 * to rewrite a row in place, on the strength of a measurement -- a thousand
 * rate-limit checks went from 127 kB of write-ahead log to forty bytes. Two
 * migrations since have shipped an ALTER on top of it, one of them by mistake,
 * and altering the one table every single door writes to is not a free thing
 * to type: it wants ACCESS EXCLUSIVE, and the moment it starts waiting for
 * that, every query behind it waits too. There is a CI guard now that will not
 * let one through without a `lock_timeout` in front of it.
 *
 * This asks rather than sets, because asking takes no lock at all.
 */
do $$
declare v_p "char"; v_o text[];
begin
  select relpersistence, reloptions into v_p, v_o from pg_class
   where oid = 'public.caller'::regclass;
  if v_p <> 'u' then
    raise exception 'caller is not unlogged (relpersistence %)', v_p;
  end if;
  if not coalesce(v_o, '{}') @> array['fillfactor=50'] then
    raise exception 'caller has lost its fillfactor (reloptions %)', coalesce(v_o, '{}');
  end if;
end $$;
