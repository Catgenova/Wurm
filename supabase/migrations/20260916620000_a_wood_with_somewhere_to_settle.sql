-- A wood with somewhere to settle, instead of somewhere to run to
--
-- Asked from the island: *"to avoid a strict doubling, what are the costs of an
-- old tree rolling 0-2 saplings?"*, and then: *"room threshold at mean 1.02."*
--
-- Two apiece is two offspring per tree per life — a doubling every four days
-- until the island runs out of plantable ground. Run on the island's own rules,
-- a wood at a quarter density is the whole map inside three weeks.
--
-- A smaller number does not fix it, and the reason is the interesting part. A
-- flat roll of 0-2 averages one, which reads like replacement and is not: a
-- seed that finds no room is a seed lost, and nothing ever gives one back, so
-- the realised average sits under one for ever. A wood at a quarter thins to a
-- sixth over eight months and keeps going. Nor is there a flat average that
-- holds — the knife edge is exactly at one, and either side of it runs away
-- slowly.
--
-- ## So the room does the regulating, not the number
--
-- What a stump actually gets is capped by the free ground around it:
-- `tree_room_two()` of the twenty-four tiles near it open for two saplings,
-- `tree_room_one()` for one, and a wood that has closed over gets none. In the
-- open a stump leaves a shade more than it took; hemmed in it leaves less. That
-- is a wood with an equilibrium rather than a ceiling, and it finds it from
-- either side.
--
-- ## But the roll has to clear one by more than a shade
--
-- The asked-for 1.02 was built and measured, and it does not hold. Sown over a
-- whole island and run to three hundred days, a fifth wooded went to a sixth by
-- forty days, to a twentieth by three hundred, and was still falling. Moving
-- the room thresholds between 3+ and 8+ barely touched it, which is the proof
-- that the roll and not the cap was binding: at low density there is always
-- room, so the cap never fires and the wood is left with a flat mean of 1.02
-- against every other way a seed is lost. Two stumps that pick the same tile
-- plant one tree between them. A stump at the island's edge has fewer
-- neighbours to try. A stump beside a settlement may have nowhere at all. None
-- of those ever gives a seed back, so the surplus has to cover them first.
--
-- Sweeping the mean with the room cap held at 8+/4+, the same ground sown thin
-- and sown thick, forty days each:
--
--     mean 1.02    a fifth -> 17%, four fifths -> 32%     both down
--     mean 1.10    a fifth -> 30%, four fifths -> 46%     <- this one
--     mean 1.30    a fifth -> 68%, four fifths -> 69%
--     mean 1.50    a fifth -> 78%, four fifths -> 78%
--
-- 1.10 is the gentlest that holds a thin wood up and still pulls a thick one
-- down — `tree_seed_none()` of nothing, `tree_seed_both()` of two, the rest one.
-- The ones above it settle at two thirds of the island and better, which is a
-- wood with no clearings in it and a daily turnover three times the size. All
-- four numbers are crossed, so moving the wood up or down is one line.
--
-- ## And it costs nothing to do
--
-- The roll is one column on the stump and the room is a `count(*) over` on the
-- candidate list the seeding already builds. No extra statement, no extra pass
-- — and a wood that settles near a third rather than filling the island is a
-- daily turnover that stays a third of the size for ever.

CREATE OR REPLACE FUNCTION public.tree_day(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
