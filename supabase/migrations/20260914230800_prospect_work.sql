-- The prospector's round, which is the twentieth trade.
--
-- ## The work is the walk
--
-- Every other errand carries something: a log to a furnace, a plank to a
-- wall, a sprout to a hole. A prospector carries nothing at all — it walks out
-- to a piece of ground nobody has read lately, reads it, and walks out to the
-- next one. So it is an errand with the fetch taken out and the delivery left
-- in, which the phase machine already knows how to run.
--
-- What it finds is lit for its keeper rather than for the island. A beast
-- cannot read a map, and two people standing on the same seam still each have
-- to look.

/** The prospector joins the four that fetch, and the trade list is twenty of twenty-two. */
create or replace function worker_errand(p_kind text) returns boolean language sql immutable as $$
  select p_kind in ('hod', 'mend', 'stoke', 'plant', 'prospect')
$$;

create or replace function worker_job_ported(p_kind text) returns boolean
  language sql immutable as $$
  select p_kind in ('forage', 'botanize', 'woodcut', 'mine', 'quarry',
                    'sand', 'clay', 'peat', 'reed', 'fish', 'farm', 'fetch',
                    'hod', 'mend', 'stoke', 'plant', 'compost', 'guard', 'hunt',
                    'prospect')
$$;

/** How far a prospector moves on before the next reading is worth taking. */
create or replace function prospect_stride() returns double precision
  language sql immutable as $$ select 4 $$;

/**
 * Ground worth walking to: a spot inside the range, out of the water, and far
 * enough from where the beast stands that the two readings do not overlap.
 *
 * Sixty guesses and the furthest of them, exactly as the browser throws them,
 * except that the guesses are hashed off the creature and its leg rather than
 * rolled — so a prospector settled twice from the same row walks the same
 * round, which is the rule everything out here is built on.
 */
create or replace function unread_ground(p_world uuid, p_cx int, p_cy int, p_range int,
    p_id int, c creature)
  returns table (x int, y int) language plpgsql stable as $$
declare i int; v_x int; v_y int; v_d double precision; v_best double precision := -1;
        v_size int; v_fx double precision; v_fy double precision;
begin
  v_size := (select size from world where id = p_world);
  v_fx := creature_x(c); v_fy := creature_y(c);
  for i in 0..59 loop
    v_x := round(p_cx + (hash_tile(p_id, c.leg + i, 4801) * 2 - 1) * p_range)::int;
    v_y := round(p_cy + (hash_tile(p_id, c.leg + i, 4901) * 2 - 1) * p_range)::int;
    if v_x < 0 or v_y < 0 or v_x >= v_size or v_y >= v_size then continue; end if;
    if greatest(abs(v_x - p_cx), abs(v_y - p_cy)) > p_range then continue; end if;
    if has_water(p_world, v_x, v_y) then continue; end if;
    if not creature_tile_ok(p_world, v_x, v_y) then continue; end if;
    v_d := sqrt((v_x - v_fx) ^ 2 + (v_y - v_fy) ^ 2);
    if v_d < prospect_stride() or v_d <= v_best then continue; end if;
    v_best := v_d; x := v_x; y := v_y;
  end loop;
  if v_best < 0 then return; end if;
  return next;
end $$;

/**
 * Read the ground around a point and light up any metal under it.
 *
 * The player's own `prospect` reads the bedrock wherever it lies — buried or
 * drowned — because a pickaxe and a trained eye will tell. A beast scratches
 * at what it can get at, so this reads only the rock that is already bare,
 * which is the difference the browser draws between the two.
 */
create or replace function read_ground(p_world uuid, p_id int, p_x int, p_y int, p_radius int)
  returns int language plpgsql as $$
declare c creature; v_size int; v_tiles int[] := '{}'; v_names text[] := '{}'; v_row record;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found or c.keeper is null then return 0; end if;
  v_size := (select size from world where id = p_world);
  for v_row in select x, y, (bedrock_at(p_world, x, y)).name as nm
    from generate_series(greatest(0, p_x - p_radius), least(v_size - 1, p_x + p_radius)) x
    cross join generate_series(greatest(0, p_y - p_radius), least(v_size - 1, p_y + p_radius)) y
    where land_tile(p_world, x, y) = tile_id('Rock') and (bedrock_at(p_world, x, y)).ore
    order by y, x
  loop
    v_tiles := v_tiles || (v_row.y * v_size + v_row.x);
    v_names := v_names || lower(v_row.nm);
  end loop;
  if coalesce(array_length(v_tiles, 1), 0) = 0 then return 0; end if;
  perform mark_prospected(p_world, c.keeper, v_tiles);
  perform tell(p_world, c.keeper, c.name || ' scratches at the ground and stands over '
    || (select string_agg(distinct nm, ' and ') from unnest(v_names) nm) || '.', 'event');
  return array_length(v_tiles, 1);
end $$;

create or replace function errand_step(p_world uuid, p_id int)
  returns table (gx double precision, gy double precision, want text, wx int, wy int)
  language plpgsql stable as $$
declare c creature; d species_def; dd deed; kind text; rng int;
        v_job record; v_store item; v_crate crate; v_hearth placed; v_spot record;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  select * into d from species_def where id = c.species;
  select * into dd from deed where world_id = p_world;
  if not found then return; end if;
  kind := d.gathers;
  rng := work_range(c);

  if kind = 'mend' then
    -- Nothing is carried: it works at whichever crate holds the worst of it.
    v_store := damaged_in_stores(p_world);
    if v_store.id is null then return; end if;
    select * into v_crate from crate where world_id = p_world and id = v_store.crate;
    gx := crate_centre_x(v_crate); gy := crate_centre_y(v_crate);
    want := null; wx := v_crate.x; wy := v_crate.y;
    return next;
    return;

  elsif kind = 'hod' then
    select * into v_job from wall_needing(p_world, dd.x, dd.y, rng, c.carrying->>'def');
    if v_job.item is null then return; end if;
    if c.carrying->>'def' is distinct from v_job.item then
      v_store := stocked(p_world, v_job.item);
      if v_store.id is null then return; end if;
      select * into v_crate from crate where world_id = p_world and id = v_store.crate;
      gx := crate_centre_x(v_crate); gy := crate_centre_y(v_crate);
      want := v_job.item; wx := v_crate.x; wy := v_crate.y;
    else
      gx := v_job.x + 0.5; gy := v_job.y + 0.5;
      want := null; wx := v_job.x; wy := v_job.y;
    end if;
    return next;
    return;

  elsif kind = 'stoke' then
    v_hearth := cold_hearth(p_world, dd.x, dd.y, rng);
    if v_hearth.id is null then return; end if;
    if c.carrying is null then
      v_store := fuel_in_stores(p_world);
      if v_store.id is null then return; end if;
      select * into v_crate from crate where world_id = p_world and id = v_store.crate;
      gx := crate_centre_x(v_crate); gy := crate_centre_y(v_crate);
      want := v_store.def; wx := v_crate.x; wy := v_crate.y;
    else
      gx := v_hearth.cx; gy := v_hearth.cy;
      want := null; wx := v_hearth.x; wy := v_hearth.y;
    end if;
    return next;
    return;

  elsif kind = 'prospect' then
    -- Nothing is carried and nothing is fetched: the work *is* the walk.
    select * into v_spot from unread_ground(p_world, dd.x, dd.y, rng, p_id, c);
    if v_spot.x is null then return; end if;
    gx := v_spot.x + 0.5; gy := v_spot.y + 0.5;
    want := null; wx := v_spot.x; wy := v_spot.y;
    return next;
    return;

  elsif kind = 'plant' then
    if c.carrying->>'def' is distinct from 'sprout' then
      v_store := stocked(p_world, 'sprout');
      if v_store.id is null then return; end if;
      select * into v_crate from crate where world_id = p_world and id = v_store.crate;
      gx := crate_centre_x(v_crate); gy := crate_centre_y(v_crate);
      want := 'sprout'; wx := v_crate.x; wy := v_crate.y;
    else
      select * into v_spot from planting_spot(p_world, dd.x, dd.y, rng);
      if v_spot.x is null then return; end if;
      gx := v_spot.x + 0.5; gy := v_spot.y + 0.5;
      want := null; wx := v_spot.x; wy := v_spot.y;
    end if;
    return next;
    return;
  end if;
  return;
end $$;

create or replace function errand_do(p_world uuid, p_id int) returns boolean
  language plpgsql as $$
declare c creature; d species_def; kind text; skill_id text; skill double precision;
        v_job record; v_it item; v_hearth placed; v_per double precision; v_tree int;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  select * into d from species_def where id = c.species;
  kind := d.gathers;
  select g.skill into skill_id from gather_def g where g.id = kind;
  skill := task_skill(c);

  if kind = 'mend' then
    v_it := damaged_in_stores(p_world);
    if v_it.id is null then return false; end if;
    perform worker_learn(p_world, p_id, skill_id, 0.2);
    -- The same bargain the player's own repair makes: damage out, a little
    -- quality with it, and a better hand loses less of it.
    update item set dmg = greatest(0, dmg - (2 + skill / 12)),
        ql = greatest(1, ql - greatest(0.05, 0.6 - skill / 220))
      where id = v_it.id;
    return true;

  elsif kind = 'hod' then
    if c.carrying is null then return false; end if;
    select * into v_job from wall_needing(p_world, c.work_x, c.work_y, 0, c.carrying->>'def');
    if v_job.item is null or v_job.item is distinct from c.carrying->>'def' then return false; end if;
    update wall set needed = jsonb_set(needed, array[v_job.item],
        to_jsonb((needed->>v_job.item)::int - 1))
      where world_id = p_world and level = 0 and dir = v_job.dir and x = v_job.x and y = v_job.y;
    update creature set carrying = null where world_id = p_world and id = p_id;
    perform worker_learn(p_world, p_id, skill_id, 0.25);
    return true;

  elsif kind = 'stoke' then
    if c.carrying is null then return false; end if;
    v_hearth := cold_hearth(p_world, c.work_x, c.work_y, 0);
    if v_hearth.id is null then return false; end if;
    perform placed_settle(v_hearth.id);
    v_per := fuel_value(c.carrying->>'def');
    if v_per is null then
      update creature set carrying = null where world_id = p_world and id = p_id;
      return false;
    end if;
    -- Fed, and lit if it had gone out: a stoker's whole job is that nothing
    -- on the deed is ever cold when somebody comes back to it.
    update placed set fuel = least(fire_capacity(), placed_fuel(placed) + v_per),
        ash = placed_ash(placed), lit = true, since = now()
      where id = v_hearth.id;
    update creature set carrying = null where world_id = p_world and id = p_id;
    perform worker_learn(p_world, p_id, skill_id, 0.2);
    return true;

  elsif kind = 'prospect' then
    perform worker_learn(p_world, p_id, skill_id, 0.22);
    -- The radius grows with what it knows, the same way a player's does, and
    -- what it finds is lit for its keeper: the beast cannot read a map.
    perform read_ground(p_world, p_id, c.work_x, c.work_y, 2 + floor(skill / 20)::int);
    /*
     * And it moves on.
     *
     * `unread_ground` hashes its sixty guesses off the creature and its leg
     * number, which is how everything out here stays the same when it is
     * replayed. A deed worker never touches its leg, though — nothing in the
     * round trip needs one — so the hash was constant and the prospector
     * walked to the same square forty times, learning a great deal about one
     * patch of grass. A reading is a leg, so it counts as one.
     */
    update creature set leg = leg + 1 where world_id = p_world and id = p_id;
    return true;

  elsif kind = 'plant' then
    if c.carrying->>'def' is distinct from 'sprout' then return false; end if;
    if not plantable_tile(p_world, c.work_x, c.work_y) then
      update creature set carrying = null where world_id = p_world and id = p_id;
      return false;
    end if;
    v_tree := coalesce((select id from tree_def where name = c.carrying->>'extra'), 0);
    perform land_set_tile(p_world, c.work_x, c.work_y, tile_id('Tree'));
    perform land_set_data(p_world, c.work_x, c.work_y, v_tree);
    perform land_announce(p_world, c.work_x, c.work_y);
    update creature set carrying = null where world_id = p_world and id = p_id;
    perform worker_learn(p_world, p_id, skill_id, 0.25);
    return true;
  end if;
  return false;
end $$;

select private.lock_doors();
