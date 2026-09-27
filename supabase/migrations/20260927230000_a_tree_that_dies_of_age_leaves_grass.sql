-- A tree that dies of age leaves grass, not a stump; and a stump that goes at
-- the turn goes for everybody.
--
-- Reported as stumps forming on their own, and asked for: stumps only from a
-- hatchet on a young tree or older, and every stump gone at the next turn.
--
-- The first was the morning a wood that came of age together died: every tree
-- of it became a stump of its kind for the day. A stump is what a hatchet
-- leaves, and only a tree with timber in it -- young and older -- leaves one
-- (`perform_gather`, `worker_do`).
--
-- The second the island already did, and told almost nobody. A tree's death
-- was written into the record for everybody, but the stump going the next day
-- was a change of face written down only for whoever stood within
-- `tree_tell_reach` of it, with the birthdays -- so a browser that had seen
-- the stump went on drawing it until it read the land again, which is the next
-- time the page loads. Measured by the suite: 357 of the 1,331 tiles whose
-- face changed on a day with nobody about went unwritten. Every change of what
-- a tile is -- a tree gone, a stump gone, grass become lawn -- is written for
-- everybody now, and only a birthday waits for somebody to see it.
--
-- The saplings are drawn as they were. A dead tree's own tile was a stump for
-- the day, which is not ground a seed takes, so a wood dying together had to
-- seed into the open round it; its tiles are grass now, and grass is, so they
-- are kept out of the day's draw by hand. Otherwise a wood would come back in
-- its own footprint and thicker every time it died, which is not the balance
-- `tree_seed_none` and the room rule were measured for.

CREATE OR REPLACE FUNCTION public.tree_day(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare w record; v_y int; v_tiles bytea; v_data bytea; v_row record; v_stump int := tile_id('Stump'); v_grass int := tile_id('Grass'); v_lawn int := tile_id('Lawn');
        v_next int[]; v_kind int[]; v_first int := tree_first(); v_reach int := tree_seed_reach()::int;
        v_moved int := 0; i int; k int; v_a int; v_b int; v_n int;
        v_sx int[] := '{}'; v_sy int[] := '{}'; v_ss int[] := '{}';
        v_gx int[] := '{}'; v_gy int[] := '{}'; v_gs int[] := '{}';
        v_tx int[]; v_ty int[]; v_ts int[]; v_touched boolean := false;
        v_px int[]; v_py int[]; v_near boolean; v_told int[];
        v_h0 bytea; v_h1 bytea; v_d0 bytea; v_d1 bytea;
        v_band int := 16; v_w0 int; v_w1 int; v_ground bytea; v_plant boolean[]; v_deeds deed[]; v_pick record;
        v_c0 int; v_c1 int;
begin
  select * into w from world where id = p_world;
  if not found or not w.ready then return 0; end if;

  -- What each age becomes, read once rather than per tree. -1 is the end of it.
  select array_agg(coalesce(next, -1) order by id) into v_next from tree_age_def;
  -- And what kind of tree each data byte is, the same way.
  select array_agg(tree_species(b) order by b) into v_kind from generate_series(0, 255) b;
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
     * `dead` is the trees that went, which seed. `faced` is every tile that is
     * something else after the day: those, the stumps, and grass become lawn.
     * `stirred` is all of that and every tree in the line that moved: a new
     * age byte, or gone. A stage whose next is itself is not stirred, and is
     * not told of. They are wanted separately, because they are not worth the
     * same.
     */
    select
      -- A tree that dies of age leaves grass: a stump is what a hatchet leaves,
      -- and every stump there is, however long it has stood, is grass after
      -- the turn.
      -- And grass kept cut on a deed: the day moves the cut-today flag into
      -- the count, the third day makes lawn, and a day with no cut starts
      -- the count over.
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t = 16 and g.n < 0 then v_grass
        when g.t = v_stump then 0
        when g.t = v_grass and (g.d & 4) <> 0 and (g.d & 3) + 1 >= 3 then v_lawn
        else g.t end), ''::bytea order by g.gi) as tiles,
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t = v_stump then 0
        when g.t = v_grass and (g.d & 4) <> 0 then case when (g.d & 3) + 1 >= 3 then 0 else (g.d & 3) + 1 end
        when g.t = v_grass then 0
        when g.t <> 16 then g.d
        when g.n < 0 then 0
        -- The species bits, low nibble and top bit, kept; the age between them moved on.
        else (g.d & 143) | (g.n << 4) end), ''::bytea order by g.gi) as data,
      count(*) filter (where g.t = 16) as here,
      array_agg(g.gi) filter (where (g.t = 16 and (g.n < 0 or g.n <> g.a)) or g.t = v_stump or (g.t = v_grass and g.d <> 0)) as stirred,
      -- Every tile that is something else after the day: a tree gone, a stump
      -- gone, grass become lawn. Told to everybody, near or not.
      array_agg(g.gi) filter (where (g.t = 16 and g.n < 0) or g.t = v_stump
                                 or (g.t = v_grass and (g.d & 4) <> 0 and (g.d & 3) + 1 >= 3)) as faced,
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
     * live in exactly two rows of `land_corner`, and those two are read out
     * once, unpacked, for the same reason the line is: a row of heights is
     * eight kilobytes stored as five, and a byte read out of it where it lies
     * unpacks all eight.
     *
     * What changed face goes in whatever else is true, because a tile that has
     * stopped being a tree, or a stump, has stopped being one for everybody.
     */
    v_near := false;
    if v_px is not null then
      for k in 1 .. array_length(v_px, 1) loop
        if abs(v_py[k] - v_y) <= tree_tell_reach() then v_near := true; exit; end if;
      end loop;
    end if;
    v_told := case when v_near then v_row.stirred else v_row.faced end;
    if v_told is not null then
      select c.heights || ''::bytea, c.dirt || ''::bytea into v_h0, v_d0
        from land_corner c where c.world_id = p_world and c.y = v_y;
      select c.heights || ''::bytea, c.dirt || ''::bytea into v_h1, v_d1
        from land_corner c where c.world_id = p_world and c.y = v_y + 1;
      if found and v_h0 is not null then
        insert into tile_change (world_id, x, y, region, tile, data, corners, soil)
        select p_world, u.gi, v_y, region_of(u.gi, v_y),
               get_byte(v_row.tiles, u.gi), get_byte(v_row.data, u.gi),
               array[b_i16(v_h0, u.gi), b_i16(v_h0, u.gi + 1),
                     b_i16(v_h1, u.gi + 1), b_i16(v_h1, u.gi)],
               array[get_byte(v_d0, u.gi), get_byte(v_d0, u.gi + 1),
                     get_byte(v_d1, u.gi + 1), get_byte(v_d1, u.gi)]
          from unnest(v_told) as u(gi);
      end if;
    end if;

    -- What the ones that went leave behind them is gathered up, not planted
    -- here: seeds land in the lines either side of this one, and a line is
    -- written once.
    if v_row.dead is not null then
      foreach i in array v_row.dead loop
        v_sx := v_sx || i;
        v_sy := v_sy || v_y;
        v_ss := v_ss || v_kind[get_byte(v_data, i) + 1];
      end loop;
    end if;
  end loop;

  -- A year's growth closes whatever was cut into anything.
  delete from tree_notch where world_id = p_world;

  /*
   * And now the saplings, sixteen lines of the dead at a time.
   *
   * Every tree that died asks the twenty-four tiles round it whether a seed can
   * take there, and the ground it asks is the ground after the day -- except
   * where one of the dead stood. That ground took the day to clear, as it did
   * when a stump stood on it for the day, so a wood that dies together comes
   * back as thickly as it always did rather than in its own footprint. That was one
   * statement over every stump on the island, joined to the land a tile at a
   * time -- and a byte read out of a line where it lies unpacks the whole
   * line, eight and a half million times on a die-off. So the lines a band of
   * stumps can reach are read out once, unpacked, end to end, and every
   * candidate is one byte of that.
   *
   * What is drawn is what always was: one roll per stump, the spots it could
   * take in a random order, as many as the roll and the room allow -- and
   * where two stumps pick the same spot, one of them has it. A stump that
   * rolled nothing is dropped before its neighbours are asked, because the
   * answer cannot change what it takes.
   */
  select array_agg(exists (select 1 from plantable p where p.tile = b) order by b) into v_plant
    from generate_series(0, 255) b;
  select array_agg(d) into v_deeds from deed d where d.world_id = p_world;
  v_n := coalesce(array_length(v_sx, 1), 0);
  v_a := 1;
  while v_a <= v_n loop
    v_b := v_a;
    while v_b < v_n and v_sy[v_b + 1] < v_sy[v_a] + v_band loop v_b := v_b + 1; end loop;
    v_w0 := greatest(0, v_sy[v_a] - v_reach);
    v_w1 := least(w.size - 1, v_sy[v_b] + v_reach);
    select string_agg(t.tiles, ''::bytea order by t.y) into v_ground
      from land_tile t where t.world_id = p_world and t.y between v_w0 and v_w1;
    -- The dead in the lines the band reads, which are in order of their line:
    -- the band's own and those either side of it within a seed's reach.
    v_c0 := v_a;
    while v_c0 > 1 and v_sy[v_c0 - 1] >= v_w0 loop v_c0 := v_c0 - 1; end loop;
    v_c1 := v_b;
    while v_c1 < v_n and v_sy[v_c1 + 1] <= v_w1 loop v_c1 := v_c1 + 1; end loop;

    for v_pick in
      with dead as (
        -- One roll per tree, not per spot it might take: `random()` in the
        -- candidate list would give a different answer for every neighbour.
        select d.x, d.y, d.sp, random() as roll
          from unnest(v_sx[v_a:v_b], v_sy[v_a:v_b], v_ss[v_a:v_b]) as d(x, y, sp)
      ), cand as (
        select d.x, d.y, d.sp, d.roll, d.x + q.dx as gx, d.y + q.dy as gy
        from dead d cross join (
          select dx, dy from generate_series(-v_reach, v_reach) dx,
                             generate_series(-v_reach, v_reach) dy
          where not (dx = 0 and dy = 0)) q
        where d.roll >= tree_seed_none()
          and d.x + q.dx between 0 and w.size - 1 and d.y + q.dy between 0 and w.size - 1
      ), cleared as (
        select k.x, k.y from unnest(v_sx[v_c0:v_c1], v_sy[v_c0:v_c1]) as k(x, y)
      ), free as (
        select c.gx, c.gy, c.sp, c.roll,
               row_number() over (partition by c.x, c.y order by random()) as rn,
               count(*) over (partition by c.x, c.y) as room
        from cand c
        where v_plant[get_byte(v_ground, (c.gy - v_w0) * w.size + c.gx) + 1]
          and not exists (select 1 from cleared k where k.x = c.gx and k.y = c.gy)
          and (v_deeds is null or not exists (select 1 from unnest(v_deeds) d where deed_covers(d, c.gx, c.gy)))
      ), want as (
        /*
         * What it wants, and what the ground will have.
         *
         * The roll averages a shade over replacement; the room is what keeps a
         * thick wood from running away, because a tree with nothing open round
         * it leaves nothing. Neither alone settles anywhere — together they do.
         */
        select f.gx, f.gy, f.sp, f.rn, least(
          case when f.roll < tree_seed_none() then 0
               when f.roll < 1 - tree_seed_both() then 1 else tree_seeds()::int end,
          case when f.room >= tree_room_two() then tree_seeds()::int
               when f.room >= tree_room_one() then 1 else 0 end) as take
        from free f
      )
      select gx, gy, sp from want where rn <= take
    loop
      v_gx := v_gx || v_pick.gx;
      v_gy := v_gy || v_pick.gy;
      v_gs := v_gs || v_pick.sp;
    end loop;
    v_a := v_b + 1;
  end loop;

  -- Two trees that picked the same spot plant one between them.
  if array_length(v_gx, 1) > 0 then
    select array_agg(gx order by gy, gx), array_agg(gy order by gy, gx), array_agg(sp order by gy, gx)
      into v_tx, v_ty, v_ts
      from (select distinct on (gx, gy) gx, gy, sp
              from unnest(v_gx, v_gy, v_gs) as p(gx, gy, sp)
             order by gx, gy, random()) took;
  end if;

  /*
   * And planted, a line at a time: the line read out unpacked, a byte set for
   * each sapling in it, the line written back once.
   *
   * And each sapling into the record, which is the half that was once never
   * written at all. After the dead, deliberately: a tile can lose its stump
   * and gain a neighbour's sapling in the same day, and the reader lays
   * changes down in the order they were written. Grass first, then the
   * sapling on it.
   */
  v_n := coalesce(array_length(v_tx, 1), 0);
  v_a := 1;
  while v_a <= v_n loop
    v_y := v_ty[v_a];
    v_b := v_a;
    while v_b < v_n and v_ty[v_b + 1] = v_y loop v_b := v_b + 1; end loop;

    select t.tiles || ''::bytea, t.data || ''::bytea into v_tiles, v_data
      from land_tile t where t.world_id = p_world and t.y = v_y;
    for k in v_a .. v_b loop
      v_tiles := set_byte(v_tiles, v_tx[k], 16);
      v_data := set_byte(v_data, v_tx[k], tree_pack(v_ts[k], v_first));
    end loop;
    update land_tile t set tiles = v_tiles, data = v_data
      where t.world_id = p_world and t.y = v_y;

    select c.heights || ''::bytea, c.dirt || ''::bytea into v_h0, v_d0
      from land_corner c where c.world_id = p_world and c.y = v_y;
    select c.heights || ''::bytea, c.dirt || ''::bytea into v_h1, v_d1
      from land_corner c where c.world_id = p_world and c.y = v_y + 1;
    if found and v_h0 is not null then
      insert into tile_change (world_id, x, y, region, tile, data, corners, soil)
      select p_world, u.gx, v_y, region_of(u.gx, v_y),
             16, tree_pack(u.sp, v_first),
             array[b_i16(v_h0, u.gx), b_i16(v_h0, u.gx + 1),
                   b_i16(v_h1, u.gx + 1), b_i16(v_h1, u.gx)],
             array[get_byte(v_d0, u.gx), get_byte(v_d0, u.gx + 1),
                   get_byte(v_d1, u.gx + 1), get_byte(v_d1, u.gx)]
        from unnest(v_tx[v_a:v_b], v_ts[v_a:v_b]) as u(gx, sp);
    end if;
    v_touched := true;
    v_a := v_b + 1;
  end loop;

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
