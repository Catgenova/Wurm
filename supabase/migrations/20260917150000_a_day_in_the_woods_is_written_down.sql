-- A day in the woods is written down
--
-- Reported from the island: *"some dirt tiles return an error when trying to
-- pack."* Some of them did. They were not dirt tiles.
--
-- The browser does not download the land. It cannot: the island is 4096
-- tiles across and that is 138 MB a join. It builds the ground from the seed
-- and the chart, which it has, and then replays `tile_change` — every change
-- anybody has ever made — over the top. So `tile_change` is not a courtesy
-- to whoever is watching. **It is the entire record that the land ever
-- moved.** A change with no row in it happened on the island and nowhere
-- else, and every browser will draw the old ground for ever.
--
-- `tree_day` wrote almost none of them.
--
-- ## Measured, before anything was touched
--
-- A wooded island, one day's turnover, nobody logged in — which is what an
-- island is most of the time:
--
--     trees that turned over:             1867
--     tiles whose face actually changed:   723
--     tile_change rows written:              0
--
-- And with somebody standing in the middle of it, wide awake:
--
--     tiles whose face changed:            710
--     tile_change rows written:           1858
--     changed tiles with no row at all:    364   — every one of them a Tree
--
-- Two separate holes. The ageing pass only told tiles within
-- `tree_tell_reach()` of a waking body, so an island with nobody on it told
-- nobody anything; and the seeding told *nobody at all*, ever, because the
-- statement that plants the saplings writes `land_tile` and stops there.
--
-- Those 364 are the bug as reported. A sapling lands on plantable ground —
--
--     plantable   grass, dirt, steppe, tundra, moss, lawn
--     packable    grass, dirt, steppe, tundra, moss, lawn
--
-- — the same six, because both mean "soft ground with nothing on it". So the
-- island has a tree there and every browser still has dirt. The browser
-- offers Pack, because it can see dirt; the island answers *"That ground will
-- not pack down"*, because it can see a tree. Same tile, two islands.
--
-- The rest of that family was in the post too and had not been noticed yet: a
-- tree that dies away from anybody stands in the browser for ever and refuses
-- to be cut down, and a tree that ages never changes its age on screen, so it
-- is drawn wrong and its strokes and logs are guessed wrong.
--
-- ## The guard was mine, and it was guarding the wrong thing
--
-- It went in with the once-a-day turnover, to stop `land_announce` — thirteen
-- single-row lookups to describe one tile — being called sixteen thousand
-- times inside a pass that had to be quick. The cost was real. What was wrong
-- was what it spent the saving on: it dropped the record of *what a tile is*,
-- which nothing else carries, to save writing down *how old a tree looks*,
-- which is worth much less.
--
-- Those are now two different things.
--
--     a tree dies, a sapling lands   written down always, for everybody
--     a tree has a birthday          written down for whoever is near it
--
-- The first changes what the tile *is*: what grows there, what walks through
-- it, what a shovel may do to it. A browser that has not been told is a
-- browser that is wrong about the ground, and that is the reported bug. The
-- second changes only which of four pictures is drawn and how many logs the
-- browser guesses — worth telling somebody standing there, not worth the
-- island's whole record.
--
-- The difference is in the rows. The same day, the same 346,087 trees on a
-- 1024 island, the same sowing, timed as a pair:
--
--     the pass with no record at all             42.5 s
--     + stumps and saplings written down         49.5 s,  178,000 rows
--     + every birthday as well                   59.4 s,  437,000 rows
--
-- Seconds are not what is at stake — this runs on the woods' own lock, where
-- taking a while costs nothing, and most of those forty-two seconds are the
-- seeding rather than either. The rows are. A 4096 island is sixteen times
-- this: a quarter of a million rows a day to say what the ground is, or four
-- million to keep four pictures in step as well. The first is the price of
-- the island being the authority. The second is not worth paying.
--
-- What is still owed, and is a day's work rather than a fix: ages are uniform
-- and deterministic — every tree has a birthday every day — so the browser
-- should count the days and work them out, the way it counts everything else
-- the island does on a clock. Then the record carries only what cannot be
-- worked out, which is what a record is for.

CREATE OR REPLACE FUNCTION public.tree_day(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare w record; v_y int; v_tiles bytea; v_data bytea; v_row record;
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
    select t.tiles, t.data into v_tiles, v_data
      from land_tile t where t.world_id = p_world and t.y = v_y;
    if not found then continue; end if;
    if position('\x10'::bytea in v_tiles) = 0 then continue; end if;

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
     * `stirred` is every tree in the line, because every tree in the line
     * moved: the ones with a next age have a new age byte. The two are wanted
     * separately, because they are not worth the same.
     */
    select
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t = 16 and v_next[g.a + 1] < 0 then 0 else g.t end), ''::bytea order by g.gi) as tiles,
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t <> 16 then g.d
        when v_next[g.a + 1] < 0 then 0
        else (g.d & 15) | (v_next[g.a + 1] << 4) end), ''::bytea order by g.gi) as data,
      count(*) filter (where g.t = 16) as here,
      array_agg(g.gi) filter (where g.t = 16) as stirred,
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
                 case when s.gx is not null then (s.sp & 15) | (tree_first() << 4)
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
           16, (u.sp & 15) | (tree_first() << 4),
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

select private.lock_doors();
