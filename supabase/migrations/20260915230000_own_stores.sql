-- "Find other opportunities to untangle."
--
-- `on_deed(world, x, y)` answers "is this tile on a settlement". It was written
-- when there was one, so it also meant "is this tile on *your* settlement", and
-- a dozen callers took it as both. Now that there can be two, the two questions
-- have different answers and every caller has to say which it meant.
--
-- Most of them meant the ground and are right as they stand: a monster keeps
-- clear of any settlement, wild things are stocked away from any settlement, a
-- trap may not be set on anybody's. These are the ones that meant *yours*.
--
--   * `plan_reason` refused with the words "You may only build on your own
--     deed" while testing whether the tile was on *a* deed. Two settlements on
--     one island and that is not a wrong message, it is an open door: you could
--     plan a building inside somebody else's border.
--   * A worker mending gear, fetching fuel, or filling barrels searched every
--     crate and vessel on every settlement on the island. Farce's forager would
--     have burnt your logs and mended your hatchet.
--   * A worker would gather from any settlement's ground rather than its
--     keeper's.
--
-- `on_my_deed` is the other half of the pair, and the four functions that only
-- ever had the island grow the parameter that says whose.

/** Is this tile on the settlement *this person* holds? */
create or replace function on_my_deed(p_world uuid, p_uid uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select exists (select 1 from deed d where d.world_id = p_world and d.founded_by = p_uid
    and abs(p_x - d.x) <= d.radius and abs(p_y - d.y) <= d.radius)
$$;

drop function if exists plan_reason(uuid,integer,integer);
drop function if exists damaged_in_stores(uuid);
drop function if exists fuel_in_stores(uuid);
drop function if exists thirsty_vessel(uuid);

CREATE OR REPLACE FUNCTION public.plan_reason(p_world uuid, p_uid uuid, p_x integer, p_y integer)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when not on_my_deed(p_world, p_uid, p_x, p_y) then 'You may only build on your own deed.'
    when is_token(p_world, p_x, p_y) then 'The settlement token stands here.'
    when building_at(p_world, p_x, p_y) is not null then 'That tile is already part of a building.'
    when land_tile(p_world, p_x, p_y) <> tile_id('Packed dirt')
      then 'Buildings need flat packed dirt. Pack the tile first.'
    when tile_slope(p_world, p_x, p_y) <> 0 then 'The tile must be perfectly flat. Flatten it first.'
    when has_water(p_world, p_x, p_y) then 'You cannot build in water.'
    when exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                   and i.gx = p_x and i.gy = p_y) then 'Clear away the items lying there first.'
    end
$function$;

CREATE OR REPLACE FUNCTION public.build_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; side text; wt wall_type_def; mat build_material_def; b building;
        w wall; f floor_tile; lvl int; kind text; tool text; other record;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into wt from wall_type_def where id = p_target->>'wallType';
  select * into mat from build_material_def where id = p_target->>'material';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);

  if p_action = 'plan_building' then
    return coalesce(need_tool(p_world, p_uid, 'mallet'), plan_reason(p_world, p_uid, tx, ty));

  elsif p_action = 'add_to_building' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return 'There is no building next to this tile.'; end if;
    if b.levels > 1 then return 'The footprint cannot change once upper floors are planned.'; end if;
    return plan_reason(p_world, p_uid, tx, ty);

  elsif p_action = 'remove_from_plan' then
    if b.id is null then return 'No building here.'; end if;
    if b.levels > 1 then return 'Remove the upper floors first.'; end if;
    if tile_has_structures(p_world, tx, ty) then return 'Remove the walls and floor on this tile first.'; end if;
    return null;

  elsif p_action = 'rename_building' then
    if b.id is null then return 'No building here.'; end if;
    if nullif(btrim(coalesce(p_target->>'name', '')), '') is null then return 'Choose a name.'; end if;
    return null;

  elsif p_action = 'plan_wall' then
    if side is null or wt.id is null or mat.id is null then return 'Choose a side, a wall type and a material.'; end if;
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    lvl := work_level(p_world, b.id);
    if lvl > 0 then
      select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
      if not found or not bill_done(f.needed) then return 'Build the floor of this storey first.'; end if;
    end if;
    if (wall_at(p_world, tx, ty, side)).world_id is not null then return 'There is already a wall on that side.'; end if;
    return null;

  elsif p_action = 'plan_fence' then
    if side is null or wt.id is null or mat.id is null then return 'Choose a side, a kind and a material.'; end if;
    if not wt.standalone then return 'Only fences and half walls stand on their own.'; end if;
    tool := need_tool(p_world, p_uid, mat.tool);
    if tool is not null then return tool; end if;
    if b.id is not null then return 'That is part of a building: plan a wall instead.'; end if;
    select * into other from across(tx, ty, side);
    -- The border is shared, so the tile on the other side of it has a say.
    if building_at(p_world, other.x, other.y) is not null then return 'A building stands on the other side of that border.'; end if;
    if not in_bounds(p_world, other.x, other.y) then return 'That border is the edge of the world.'; end if;
    if has_water(p_world, tx, ty) or has_water(p_world, other.x, other.y) then return 'Fences do not stand in water.'; end if;
    if not passable(p_world, tx, ty) or not passable(p_world, other.x, other.y) then return 'There is no room for posts there.'; end if;
    if exists (select 1 from border_of(tx, ty, side) bd
               join wall w2 on w2.world_id = p_world and w2.level = 0
                 and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y) then
      return 'There is already something on that border.';
    end if;
    return null;

  elsif p_action in ('build_wall', 'remove_wall') then
    if side is null then return 'Choose a side.'; end if;
    w := wall_at(p_world, tx, ty, side);
    if p_action = 'remove_wall' then
      return case when w.world_id is null then 'There is no wall there.' end;
    end if;
    if w.world_id is null then return 'There is no wall planned there.'; end if;
    if bill_done(w.needed) then return 'That wall is finished.'; end if;
    select * into mat from build_material_def where id = w.material;
    if mat.id is not null then
      tool := need_tool(p_world, p_uid, mat.tool);
      if tool is not null then return tool; end if;
    end if;
    if next_material(p_world, p_uid, w.material, w.needed) is null then
      return 'You need ' || bill_text(w.material, w.needed) || '.';
    end if;
    return null;

  elsif p_action = 'add_floor' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    if b.levels >= 10 then return 'Buildings cannot be taller than 10 storeys.'; end if;
    if has_roof(p_world, b.id) then return 'Take the roof off first.'; end if;
    if has_low_wall(p_world, b.id, b.levels - 1) then
      return 'Nothing rests on a fence or a half wall. The storey below needs walls all round.';
    end if;
    if not level_complete(p_world, b.id, b.levels - 1) then
      return 'All walls of the storey below must be built first.';
    end if;
    return null;

  elsif p_action = 'plan_floor' then
    if mat.id is null then return 'Choose a material.'; end if;
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    if kind = 'roof' then
      if not level_complete(p_world, b.id, b.levels - 1) then
        return 'All walls of the top storey must be built before roofing.';
      end if;
    elsif kind in ('stairs', 'ladder') then
      if lvl < 1 then return 'Stairs and ladders belong to an upper storey; plan another storey first.'; end if;
      if side is null then return 'Choose the side to climb from.'; end if;
      if lvl > 1 and not exists (select 1 from floor_tile where world_id = p_world
          and level = lvl - 1 and x = tx and y = ty) then
        return 'Plan the floor of the storey below first.';
      end if;
    end if;
    if exists (select 1 from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty) then
      return case when kind = 'roof' then 'There is already roof planned here.'
                  else 'There is already a floor planned here.' end;
    end if;
    return null;

  elsif p_action in ('build_floor', 'remove_floor') then
    if b.id is null then return case when p_action = 'build_floor'
      then 'There is nothing planned here.' else 'No building here.' end; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if p_action = 'remove_floor' then
      if not found then return 'There is nothing here to remove.'; end if;
      if f.kind <> 'roof' and exists (
          select 1 from (values ('n'), ('e'), ('s'), ('w')) as s(side)
          cross join lateral border_of(tx, ty, s.side) bd
          join wall w2 on w2.world_id = p_world and w2.level = lvl
            and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y) then
        return 'Take down the walls standing on it first.';
      end if;
      return null;
    end if;
    if not found then return 'There is nothing planned here.'; end if;
    if bill_done(f.needed) then return 'That is already finished.'; end if;
    select * into mat from build_material_def where id = f.material;
    tool := need_tool(p_world, p_uid, case when f.kind = 'ladder' then 'mallet' else mat.tool end);
    if tool is not null then return tool; end if;
    if next_material(p_world, p_uid, f.material, f.needed) is null then
      return 'You need ' || bill_text(f.material, f.needed) || '.';
    end if;
    return null;

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return 'There is no upper storey.'; end if;
    lvl := b.levels - 1;
    if has_roof(p_world, b.id) then return 'Take the roof off first.'; end if;
    if exists (select 1 from wall where world_id = p_world and building = b.id and level = lvl) then
      return 'Take down the walls of the top storey first.';
    end if;
    if exists (select 1 from floor_tile where world_id = p_world and building = b.id and level = lvl) then
      return 'Tear up the floors of the top storey first.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.damaged_in_stores(p_world uuid, p_uid uuid)
 RETURNS item
 LANGUAGE sql
 STABLE
AS $function$
  select i.* from item i join crate c on c.world_id = i.world_id and c.id = i.crate
  where i.world_id = p_world and i.holder = 'crate' and i.dmg > 1
    and on_my_deed(p_world, p_uid, c.x, c.y)
  order by i.dmg desc limit 1
$function$;

CREATE OR REPLACE FUNCTION public.fuel_in_stores(p_world uuid, p_uid uuid)
 RETURNS item
 LANGUAGE sql
 STABLE
AS $function$
  select i.* from item i join crate c on c.world_id = i.world_id and c.id = i.crate
  where i.world_id = p_world and i.holder = 'crate' and fuel_value(i.def) is not null
    and on_my_deed(p_world, p_uid, c.x, c.y)
  order by i.id limit 1
$function$;

CREATE OR REPLACE FUNCTION public.thirsty_vessel(p_world uuid, p_uid uuid)
 RETURNS placed
 LANGUAGE sql
 STABLE
AS $function$
  select p.* from placed p, deed dd
  where p.world_id = p_world and dd.world_id = p_world and p.kind = 'furniture'
    and holds_liquid(p) and not is_well(p)
    and placed_litres(p) < liquid_capacity(p)
    and (p.liquid is null or p.liquid = 'water')
    and on_my_deed(p_world, p_uid, p.x, p.y)
  order by placed_litres(p), p.id
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.water_source(p_world uuid, p_cx integer, p_cy integer, p_range integer, c creature)
 RETURNS TABLE(x integer, y integer, gx double precision, gy double precision)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_well placed; v_size int;
begin
  select p.* into v_well from placed p
    where p.world_id = p_world and p.kind = 'furniture' and is_well(p)
      and placed_litres(p) >= 1 and on_my_deed(p_world, c.keeper, p.x, p.y)
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
end $function$;

CREATE OR REPLACE FUNCTION public.worker_gatherable(p_world uuid, p_x integer, p_y integer, p_kind text, c creature)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
declare here int; t tile_def; rock rock_def;
begin
  if not in_bounds(p_world, p_x, p_y) or claimed(p_world, p_x, p_y, c.id) then return false; end if;
  here := land_tile(p_world, p_x, p_y);
  select * into t from tile_def where id = here;

  if p_kind = 'woodcut' then
    return here = tile_id('Tree') and exists (select 1 from beside_tile(p_world, p_x, p_y));
  elsif p_kind = 'mine' then
    rock := bedrock_at(p_world, p_x, p_y);
    return here = tile_id('Rock') and rock.ore and rock.level <= task_skill(c)
       and rock_height(p_world, p_x, p_y) > 1;
  elsif p_kind = 'quarry' then
    rock := bedrock_at(p_world, p_x, p_y);
    return here = tile_id('Rock') and not rock.ore and rock_height(p_world, p_x, p_y) > 1;
  elsif p_kind in ('sand', 'clay') then
    return here = tile_id(case p_kind when 'sand' then 'Sand' else 'Clay' end)
       and land_dirt(p_world, p_x, p_y) > 0 and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'peat' then
    return here in (tile_id('Peat'), tile_id('Tar')) and not is_foraged(p_world, p_x, p_y, 'dig')
       and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'reed' then
    return here = tile_id('Reed') and not is_foraged(p_world, p_x, p_y, 'reed');
  elsif p_kind = 'fish' then
    return fishable(p_world, p_x, p_y);
  elsif p_kind = 'seek' then
    -- Ground nobody has been over yet, which is the only ground worth a nose.
    return t.diggable and not has_water(p_world, p_x, p_y)
       and creature_tile_ok(p_world, p_x, p_y)
       and not is_foraged(p_world, p_x, p_y, 'dig');
  elsif p_kind = 'fetch' then
    return on_my_deed(p_world, c.keeper, p_x, p_y) and creature_tile_ok(p_world, p_x, p_y)
       and exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                     and i.gx = p_x and i.gy = p_y);
  elsif p_kind = 'compost' then
    -- A carcass, or anything knocked about past saving.
    return on_my_deed(p_world, c.keeper, p_x, p_y) and creature_tile_ok(p_world, p_x, p_y)
       and exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                     and i.gx = p_x and i.gy = p_y and (i.def = 'corpse' or i.dmg >= 40));
  elsif p_kind = 'farm' then
    perform crop_settle(p_world, p_x, p_y);
    return exists (select 1 from crop cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y
      and (cr.stage >= crop_ripe() or not cr.tended_now));
  elsif p_kind = 'forage' then
    return coalesce(t.forage, false) and not is_foraged(p_world, p_x, p_y, 'forage')
       and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'botanize' then
    return coalesce(t.botanize, false) and not is_foraged(p_world, p_x, p_y, 'botanize')
       and creature_tile_ok(p_world, p_x, p_y);
  end if;
  return false;
end $function$;

CREATE OR REPLACE FUNCTION public.errand_do(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
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
    v_it := damaged_in_stores(p_world, c.keeper);
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
end $function$;

CREATE OR REPLACE FUNCTION public.errand_step(p_world uuid, p_id integer)
 RETURNS TABLE(gx double precision, gy double precision, want text, wx integer, wy integer)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare c creature; d species_def; dd deed; kind text; rng int;
        v_job record; v_store item; v_crate crate; v_hearth placed; v_spot record;
        v_vessel placed; v_wet record;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  select * into d from species_def where id = c.species;
  select * into dd from deed where world_id = p_world and founded_by = c.keeper;
  if not found then return; end if;
  kind := d.gathers;
  rng := work_range(c);

  if kind = 'mend' then
    -- Nothing is carried: it works at whichever crate holds the worst of it.
    v_store := damaged_in_stores(p_world, c.keeper);
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
      v_store := fuel_in_stores(p_world, c.keeper);
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
      v_vessel := thirsty_vessel(p_world, c.keeper);
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
end $function$;

CREATE OR REPLACE FUNCTION public.upgrade_wants(p_world uuid, p_uid uuid, p_level integer)
 RETURNS TABLE(label text, met boolean)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare dd deed;
begin
  select * into dd from deed where world_id = p_world and founded_by = p_uid;
  if not found then return; end if;
  if p_level = 2 then
    label := 'a crate on the deed';
    met := exists (select 1 from crate c where c.world_id = p_world and abs(c.x - dd.x) <= dd.radius and abs(c.y - dd.y) <= dd.radius);
    return next;
    label := 'a campfire on the deed';
    met := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'campfire'
                     and abs(p.x - dd.x) <= dd.radius and abs(p.y - dd.y) <= dd.radius);
    return next;
  elsif p_level = 3 then
    label := 'a stone smelter on the deed';
    met := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'smelter'
                     and abs(p.x - dd.x) <= dd.radius and abs(p.y - dd.y) <= dd.radius);
    return next;
  elsif p_level = 4 then
    label := 'an anvil set down on the deed';
    met := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'anvil'
                     and abs(p.x - dd.x) <= dd.radius and abs(p.y - dd.y) <= dd.radius);
    return next;
  elsif p_level = 5 then
    label := 'a building with every ground-floor wall up';
    met := exists (select 1 from building b
                   where b.world_id = p_world and level_complete(p_world, b.id, 0)
                     and exists (select 1 from building_tile t where t.world_id = p_world
                                   and t.building = b.id and on_my_deed(p_world, p_uid, t.x, t.y)));
    return next;
    label := '3 wildermon working the deed';
    met := workers_on_deed(p_world, p_uid) >= 3;
    return next;
  end if;
end $function$;

select private.lock_doors();
