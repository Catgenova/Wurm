-- Carrying water, which is the twenty-first trade.
--
-- ## An errand that carries nothing out of the stores
--
-- Every other fetching errand takes a piece out of a crate. A water carrier
-- takes its load out of the island itself — a well on the deed, or the shore —
-- and the only thing it puts down is five litres in a barrel. So it is the
-- round trip with the crate swapped for the water, which the phase machine
-- runs without knowing the difference.

create or replace function worker_errand(p_kind text) returns boolean language sql immutable as $$
  select p_kind in ('hod', 'mend', 'stoke', 'plant', 'prospect', 'water')
$$;

/** Twenty-one of twenty-two. Only `seek` is left, and it wants archaeology. */
create or replace function worker_job_ported(p_kind text) returns boolean
  language sql immutable as $$
  select p_kind in ('forage', 'botanize', 'woodcut', 'mine', 'quarry',
                    'sand', 'clay', 'peat', 'reed', 'fish', 'farm', 'fetch',
                    'hod', 'mend', 'stoke', 'plant', 'compost', 'guard', 'hunt',
                    'prospect', 'water')
$$;

/** A barrel on the deed with room in it for more water. */
create or replace function thirsty_vessel(p_world uuid) returns placed
  language sql stable as $$
  select p.* from placed p, deed dd
  where p.world_id = p_world and dd.world_id = p_world and p.kind = 'furniture'
    and holds_liquid(p) and not is_well(p)
    and placed_litres(p) < liquid_capacity(p)
    and (p.liquid is null or p.liquid = 'water')
    and on_deed(p_world, p.x, p.y)
  order by placed_litres(p), p.id
  limit 1
$$;

/**
 * Somewhere worth dipping into: a well on the deed first, and the nearest
 * open water within range if there is no well.
 */
create or replace function water_source(p_world uuid, p_cx int, p_cy int, p_range int, c creature)
  returns table (x int, y int, gx double precision, gy double precision)
  language plpgsql stable as $$
declare v_well placed; v_size int;
begin
  select p.* into v_well from placed p
    where p.world_id = p_world and p.kind = 'furniture' and is_well(p)
      and placed_litres(p) >= 1 and on_deed(p_world, p.x, p.y)
    order by p.id limit 1;
  if found then
    x := v_well.x; y := v_well.y; gx := v_well.cx; gy := v_well.cy;
    return next;
    return;
  end if;
  v_size := (select size from world where id = p_world);
  select q.wx, q.wy, q.wx + 0.5, q.wy + 0.5 into x, y, gx, gy
  from generate_series(greatest(0, p_cx - p_range), least(v_size - 1, p_cx + p_range)) as a(wx)
  cross join generate_series(greatest(0, p_cy - p_range), least(v_size - 1, p_cy + p_range)) as b(wy)
  cross join lateral (select a.wx as wx, b.wy as wy) q
  where has_water(p_world, q.wx, q.wy)
  order by (q.wx + 0.5 - creature_x(c)) ^ 2 + (q.wy + 0.5 - creature_y(c)) ^ 2, q.wx, q.wy
  limit 1;
  if x is null then return; end if;
  return next;
end $$;

create or replace function errand_step(p_world uuid, p_id int)
  returns table (gx double precision, gy double precision, want text, wx int, wy int)
  language plpgsql stable as $$
declare c creature; d species_def; dd deed; kind text; rng int;
        v_job record; v_store item; v_crate crate; v_hearth placed; v_spot record;
        v_vessel placed; v_wet record;
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

  elsif kind = 'water' then
    -- Full: to whichever barrel on the deed has room. Empty: to the water.
    if c.carrying->>'def' = 'water_bucket' then
      v_vessel := thirsty_vessel(p_world);
      if v_vessel.id is null then return; end if;
      gx := v_vessel.cx; gy := v_vessel.cy;
      want := null; wx := v_vessel.x; wy := v_vessel.y;
    else
      select * into v_wet from water_source(p_world, dd.x, dd.y, rng, c);
      if v_wet.x is null then return; end if;
      gx := v_wet.gx; gy := v_wet.gy;
      want := null; wx := v_wet.x; wy := v_wet.y;
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
        v_vessel placed;
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

  elsif kind = 'water' then
    if c.carrying->>'def' = 'water_bucket' then
      -- Pouring it in. Whichever barrel it walked to, if it still has room.
      -- Aliased, and not for tidiness: `kind` is a local in this function and
      -- a column of `placed`, and an unaliased table makes it ambiguous. That
      -- is the sixth time this class has bitten, and the first caught by
      -- running rather than by reading.
      select p2.* into v_vessel from placed p2 where p2.world_id = p_world and p2.kind = 'furniture'
        and p2.x = c.work_x and p2.y = c.work_y and holds_liquid(p2) and not is_well(p2)
        limit 1;
      if v_vessel.id is null then return false; end if;
      update placed set litres = least(liquid_capacity(v_vessel),
                                       placed_litres(v_vessel) + bucket_litres()),
          liquid = 'water', since = now()
        where id = v_vessel.id;
      update creature set carrying = null where world_id = p_world and id = p_id;
      perform worker_learn(p_world, p_id, skill_id, 0.2);
      return true;
    end if;
    -- Filling it. A well is drawn down by what is taken; a shore is not.
    select p2.* into v_vessel from placed p2 where p2.world_id = p_world and p2.kind = 'furniture'
      and p2.x = c.work_x and p2.y = c.work_y and is_well(p2) limit 1;
    if v_vessel.id is not null and not draw_from(v_vessel.id, bucket_litres()) then return false; end if;
    if v_vessel.id is null and not has_water(p_world, c.work_x, c.work_y) then return false; end if;
    update creature set carrying = jsonb_build_object('def', 'water_bucket', 'count', 1, 'ql', 40)
      where world_id = p_world and id = p_id;
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
