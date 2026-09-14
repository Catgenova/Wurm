-- The errands: work that is done where it is found rather than carried home.
--
-- A gatherer walks out to a tile, works it, and brings a load back to the
-- crate. An errand runner does the opposite as often as not: it takes a piece
-- *out* of the stores and carries it to wherever it is wanted — a plank to a
-- planned wall, a log to a furnace burning low, a sprout to where a tree used
-- to be. So the round trip grows one more part, `fetch`, and the delivery is
-- the work rather than the thing that follows it.
--
-- Five of the seven arrive here. `water` wants barrels that hold liquid,
-- `prospect` wants the marks a prospector writes on the map and `seek` wants
-- archaeology, and none of those three is on this island yet — so they go on
-- saying so.

create or replace function worker_errand(p_kind text) returns boolean language sql immutable as $$
  select p_kind in ('hod', 'mend', 'stoke', 'plant')
$$;

/** Fuel enough that a stoker leaves a hearth alone: ten minutes' worth. */
create or replace function hearth_full() returns double precision language sql immutable as $$ select 600 $$;

/* ------------------------------------------------------------------ *
 * What each errand is looking for.
 * ------------------------------------------------------------------ */

/**
 * A ground-floor wall still owing something, and the first thing it owes.
 *
 * A hod carrier that is already holding a plank looks for a wall that wants a
 * plank before it looks for one that wants anything: walking a load back to
 * the crate because the nearest wall wanted mortar is how an errand stops
 * being worth running.
 */
create or replace function wall_needing(p_world uuid, p_cx int, p_cy int, p_range int, p_holding text)
  returns table (dir text, x int, y int, item text) language sql stable as $$
  select w.dir, w.x, w.y, e.key
  from wall w
  cross join lateral jsonb_each_text(w.needed) e
  where w.world_id = p_world and w.level = 0 and e.value::int > 0
    and greatest(abs(w.x - p_cx), abs(w.y - p_cy)) <= p_range
  order by (p_holding is not null and e.key = p_holding) desc,
           (w.x - p_cx) ^ 2 + (w.y - p_cy) ^ 2
  limit 1
$$;

/** The most knocked-about thing in the deed's stores, and which crate holds it. */
create or replace function damaged_in_stores(p_world uuid) returns item language sql stable as $$
  select i.* from item i join crate c on c.world_id = i.world_id and c.id = i.crate
  where i.world_id = p_world and i.holder = 'crate' and i.dmg > 1
    and on_deed(p_world, c.x, c.y)
  order by i.dmg desc limit 1
$$;

/** The nearest fire, furnace or kiln burning low enough to be worth feeding. */
create or replace function cold_hearth(p_world uuid, p_cx int, p_cy int, p_range int) returns placed
  language sql stable as $$
  select p.* from placed p
  where p.world_id = p_world and p.kind in ('campfire', 'smelter', 'kiln')
    and placed_fuel(p) < hearth_full()
    and greatest(abs(p.x - p_cx), abs(p.y - p_cy)) <= p_range
  order by (p.x - p_cx) ^ 2 + (p.y - p_cy) ^ 2 limit 1
$$;

/**
 * Something in the stores that will burn: the first of it, as it lies.
 *
 * Ordering by what burns longest would be cleverer and would not be the game:
 * a stoker takes the first thing in the crate that will catch, so a crate with
 * planks at the front of it gets planks fed to the furnace until they run out.
 */
create or replace function fuel_in_stores(p_world uuid) returns item language sql stable as $$
  select i.* from item i join crate c on c.world_id = i.world_id and c.id = i.crate
  where i.world_id = p_world and i.holder = 'crate' and fuel_value(i.def) is not null
    and on_deed(p_world, c.x, c.y)
  order by i.id limit 1
$$;

/** A named thing in the stores, for the errands that carry one out. */
create or replace function stocked(p_world uuid, p_def text) returns item language sql stable as $$
  select i.* from item i join crate c on c.world_id = i.world_id and c.id = i.crate
  where i.world_id = p_world and i.holder = 'crate' and i.def = p_def
    and on_deed(p_world, c.x, c.y)
  order by i.id limit 1
$$;

/** Ground a sprout would take: open, dry, and nothing standing on it. */
create or replace function plantable_tile(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select in_bounds(p_world, p_x, p_y) and not has_water(p_world, p_x, p_y)
     and building_at(p_world, p_x, p_y) is null and not is_token(p_world, p_x, p_y)
     and not exists (select 1 from crate cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y)
     and not exists (select 1 from placed pl where pl.world_id = p_world and pl.x = p_x and pl.y = p_y)
     and exists (select 1 from plantable pt where pt.tile = land_tile(p_world, p_x, p_y))
$$;

/**
 * Somewhere worth putting a tree, kept clear of its neighbours.
 *
 * Ring by ring outwards, the same as the gatherers' search and for the same
 * reason — and a sprout is not put down next to another tree, or the planter
 * spends the afternoon making a thicket.
 */
create or replace function planting_spot(p_world uuid, p_cx int, p_cy int, p_range int)
  returns table (x int, y int) language plpgsql stable as $$
declare ring int; spot record;
begin
  for ring in 1..p_range loop
    for spot in
      select p_cx + dx as gx, p_cy + dy as gy
      from generate_series(-ring, ring) dx, generate_series(-ring, ring) dy
      where greatest(abs(dx), abs(dy)) = ring
      order by random()
    loop
      if plantable_tile(p_world, spot.gx, spot.gy)
         and not exists (
           select 1 from generate_series(spot.gx - 1, spot.gx + 1) nx,
                        generate_series(spot.gy - 1, spot.gy + 1) ny
           where land_tile(p_world, nx, ny) = tile_id('Tree')) then
        x := spot.gx; y := spot.gy;
        return next;
        return;
      end if;
    end loop;
  end loop;
  return;
end $$;

/* ------------------------------------------------------------------ *
 * Where an errand runner is headed next.
 * ------------------------------------------------------------------ */

/**
 * The next step of an errand: somewhere to stand, and whether it is going
 * there to pick something up or to do the job.
 *
 * `want` is what it should be holding when it arrives; null means it is going
 * to the job itself. An errand with nothing to do returns no row at all,
 * which is the signal to stop pottering through the catch-up.
 */
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

/**
 * Take one piece out of the stores. The crate is the deed's, so this is the
 * same withdrawal a player makes by hand, one at a time.
 */
create or replace function take_from_stores(p_world uuid, p_def text) returns jsonb
  language plpgsql as $$
declare v_it item;
begin
  v_it := stocked(p_world, p_def);
  if v_it.id is null then return null; end if;
  if v_it.count > 1 then
    update item set count = count - 1 where id = v_it.id;
  else
    delete from item where id = v_it.id;
  end if;
  return jsonb_build_object('def', v_it.def, 'count', 1, 'ql', v_it.ql, 'extra', v_it.extra);
end $$;

/** Doing the errand, once it is standing where it needs to stand. */
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
