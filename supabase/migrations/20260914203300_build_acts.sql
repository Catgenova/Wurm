-- Planting a stake, planning a house, and feeding it planks.

create or replace function act_ported(p_action text) returns boolean language sql stable as $$
  select p_action in (
      'dig', 'mine', 'chip_corner', 'pack', 'cultivate',
      'pave_gravel', 'pave_cobble', 'drop_dirt_here',
      'cut_down', 'forage', 'botanize', 'collect',
      'till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field',
      'fish', 'drag_net',
      'found_settlement',
      'plan_building', 'add_to_building', 'remove_from_plan', 'rename_building',
      'plan_wall', 'plan_fence', 'build_wall', 'remove_wall',
      'add_floor', 'plan_floor', 'build_floor', 'remove_floor', 'remove_storey',
      'build_campfire', 'light_campfire', 'put_out_campfire', 'fuel_campfire',
      'take_ashes_fire', 'take_apart_campfire',
      'place_smelter', 'pick_up_smelter', 'light_smelter', 'fuel_smelter',
      'damp_smelter', 'take_ashes_smelter',
      'place_furniture', 'pick_up_furniture')
      or exists (select 1 from recipe where id = p_action)
$$;

/** "You need a mallet for that.", or nothing when it is in hand. */
create or replace function need_tool(p_world uuid, p_uid uuid, p_tool text) returns text
  language sql stable as $$
  select case when pack_count(p_world, p_uid, p_tool) > 0 then null
    else 'You need a ' || lower((select coalesce(name, p_tool) from item_def where id = p_tool))
         || ' for that.' end
$$;

/** The storey wall work happens on: a building's working one, or the ground. */
create or replace function wall_level(p_world uuid, p_x int, p_y int) returns int
  language sql stable as $$
  select coalesce(work_level(p_world, building_at(p_world, p_x, p_y)), 0)
$$;

/** The wall or fence on the side of a tile that is being worked on. */
create or replace function wall_at(p_world uuid, p_x int, p_y int, p_side text) returns wall
  language sql stable as $$
  select w.* from border_of(p_x, p_y, p_side) b
  join wall w on w.world_id = p_world and w.level = wall_level(p_world, p_x, p_y)
    and w.dir = b.dir and w.x = b.x and w.y = b.y
$$;

/**
 * The storey a floor slot belongs to.
 *
 * A roof is not part of the top storey, it sits one above it; everything else
 * goes on the storey being worked on.
 */
create or replace function floor_level(p_world uuid, p_building int, p_kind text) returns int
  language sql stable as $$
  select case when p_kind = 'roof' then (select levels from building where world_id = p_world and id = p_building)
              else work_level(p_world, p_building) end
$$;

/* ------------------------------------------------------------------ *
 * Founding.
 * ------------------------------------------------------------------ */

create or replace function deed_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare p player; tx int; ty int; radius int := 5;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  if exists (select 1 from deed where world_id = p_world) then
    return 'You already hold a settlement. Disband it first.';
  end if;
  if pack_count(p_world, p_uid, 'deed_stake') <= 0 then return 'You have no deed stake.'; end if;
  if tx - radius < 0 or ty - radius < 0
     or not in_bounds(p_world, tx + radius, ty + radius) then
    return 'Too close to the edge of the world.';
  end if;
  if has_water(p_world, tx, ty) then return 'The token must stand on dry land.'; end if;
  if not passable(p_world, tx, ty) then return 'The token needs a clear tile.'; end if;
  return null;
end $$;

create or replace function perform_deed(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare p player; tx int; ty int; nm text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  -- The browser asks for a name in a dialog; here it rides in with the target,
  -- because there is nobody at this end to ask.
  nm := nullif(btrim(coalesce(p_target->>'name', '')), '');
  if nm is null then nm := 'Homestead'; end if;
  if not consume(p_world, p_uid, 'deed_stake', 1) then return; end if;
  insert into deed (world_id, name, x, y, radius, level, founded_by)
  values (p_world, left(nm, 32), tx, ty, deed_radius(1), 1, p_uid)
  on conflict do nothing;
  perform tell(p_world, p_uid, 'You found the settlement of ' || left(nm, 32)
    || '. The land ' || (deed_radius(1) * 2 + 1) || ' tiles across around the token is yours to build on.', 'system');
end $$;

/* ------------------------------------------------------------------ *
 * Building work.
 * ------------------------------------------------------------------ */

create or replace function build_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare tx int; ty int; side text; wt wall_type_def; mat build_material_def; b building;
        w wall; f floor_tile; lvl int; kind text; tool text; other record;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into wt from wall_type_def where id = p_target->>'wallType';
  select * into mat from build_material_def where id = p_target->>'material';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);

  if p_action = 'plan_building' then
    return coalesce(need_tool(p_world, p_uid, 'mallet'), plan_reason(p_world, tx, ty));

  elsif p_action = 'add_to_building' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return 'There is no building next to this tile.'; end if;
    if b.levels > 1 then return 'The footprint cannot change once upper floors are planned.'; end if;
    return plan_reason(p_world, tx, ty);

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
end $$;

/**
 * The doing of it.
 *
 * Planning writes a row with a bill on it; building takes one unit off that
 * bill. The unit taken is the first line of the material's own bill that the
 * builder is carrying, which is why the bill keeps its order: what the refusal
 * says you still need is what the next swing actually uses.
 */
create or replace function perform_building(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare tx int; ty int; side text; b building; w wall; f floor_tile; mat build_material_def;
        wt wall_type_def; lvl int; kind text; used text; nm text; gained double precision;
        sk text; bill jsonb; other record; what text; new_id int;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);

  if p_action = 'plan_building' then
    nm := left(coalesce(nullif(btrim(coalesce(p_target->>'name', '')), ''), 'House'), 32);
    select coalesce(max(id), 0) + 1 into new_id from building where world_id = p_world;
    insert into building (world_id, id, name, planned_by) values (p_world, new_id, nm, p_uid);
    insert into building_tile (world_id, building, x, y) values (p_world, new_id, tx, ty);
    perform tell(p_world, p_uid, 'You plan ' || nm || ' here. Extend it onto neighbouring flat packed '
      || 'tiles, then plan walls on its borders.', 'event');

  elsif p_action = 'add_to_building' then
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return; end if;
    insert into building_tile (world_id, building, x, y) values (p_world, b.id, tx, ty)
      on conflict do nothing;
    perform tell(p_world, p_uid, 'You add the tile to ' || b.name || '.', 'event');

  elsif p_action = 'remove_from_plan' then
    if b.id is null then return; end if;
    delete from building_tile where world_id = p_world and x = tx and y = ty;
    if exists (select 1 from building_tile where world_id = p_world and building = b.id) then
      perform tell(p_world, p_uid, 'You remove the tile from ' || b.name || '.', 'event');
    else
      -- The last tile of a plan is the plan.
      delete from building where world_id = p_world and id = b.id;
      perform tell(p_world, p_uid, 'You remove the last of ' || b.name || '''s plan.', 'event');
    end if;

  elsif p_action = 'rename_building' then
    if b.id is null then return; end if;
    nm := left(btrim(p_target->>'name'), 32);
    update building set name = nm where world_id = p_world and id = b.id;
    perform tell(p_world, p_uid, 'The building is now called ' || nm || '.', 'event');

  elsif p_action in ('plan_wall', 'plan_fence') then
    select * into wt from wall_type_def where id = p_target->>'wallType';
    select * into mat from build_material_def where id = p_target->>'material';
    lvl := case when p_action = 'plan_fence' then 0 else work_level(p_world, b.id) end;
    bill := wall_bill(mat.id, wt.id);
    insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, planned_by)
    select p_world, lvl, bd.dir, bd.x, bd.y,
           case when p_action = 'plan_fence' then 0 else b.id end,
           wt.id, mat.id, bill, bill, p_uid
    from border_of(tx, ty, side) bd;
    if p_action = 'plan_fence' then
      perform tell(p_world, p_uid, 'You mark out a ' || lower(mat.name) || ' ' || lower(wt.name)
        || ' on the ' || side_name(side) || ' border. It needs ' || bill_text(mat.id, bill) || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You plan a ' || lower(wt.name) || ' ' || lower(mat.name)
        || ' wall on the ' || side_name(side) || ' side. It needs ' || bill_text(mat.id, bill) || '.', 'event');
    end if;

  elsif p_action = 'build_wall' then
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null or bill_done(w.needed) then return; end if;
    select * into mat from build_material_def where id = w.material;
    used := next_material(p_world, p_uid, w.material, w.needed);
    if used is null or not consume(p_world, p_uid, used, 1) then return; end if;
    bill := jsonb_set(w.needed, array[used], to_jsonb((w.needed->>used)::int - 1));
    update wall set needed = bill where world_id = w.world_id and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    gained := skill_raise(p_world, p_uid, mat.skill, 0.4);
    select * into wt from wall_type_def where id = w.type;
    if bill_done(bill) then
      what := case when wt.low then lower(wt.name) else 'wall' end;
      perform tell(p_world, p_uid, 'You finish the ' || lower(mat.name) || ' ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You fit ' || material_name(used, 1) || ' into the wall. Still needed: '
        || bill_text(w.material, bill) || '.', 'event');
    end if;
    if gained > 0 then
      perform tell(p_world, p_uid, initcap(replace(mat.skill, '_', ' ')) || ' increased by '
        || to_char(gained, 'FM0.0000') || ' to '
        || to_char(skill_of(p_world, p_uid, mat.skill), 'FM990.0000') || '.', 'skill');
    end if;

  elsif p_action = 'remove_wall' then
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null then return; end if;
    select * into wt from wall_type_def where id = w.type;
    delete from wall where world_id = w.world_id and level = w.level and dir = w.dir and x = w.x and y = w.y;
    perform tell(p_world, p_uid, 'You take down the '
      || case when wt.low then lower(wt.name) else 'wall' end
      || ' on the ' || side_name(side) || ' side.', 'event');

  elsif p_action = 'add_floor' then
    if b.id is null then return; end if;
    update building set levels = levels + 1, work_level = levels
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, 'You plan storey ' || b.levels || ' of ' || b.name
      || '. Plan and build its floor tiles, then raise walls on them.', 'event');

  elsif p_action = 'plan_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into mat from build_material_def where id = p_target->>'material';
    bill := floor_bill(mat.id, kind);
    insert into floor_tile (world_id, level, x, y, building, material, kind, facing, needed, total, planned_by)
    values (p_world, lvl, tx, ty, b.id, mat.id, kind,
            case when kind in ('stairs', 'ladder') then side end, bill, bill, p_uid);
    perform tell(p_world, p_uid, 'You plan a '
      || case when kind = 'ladder' then 'ladder' else lower(mat.name) || ' ' || floor_kind_name(kind) end
      || '. It needs ' || bill_text(mat.id, bill) || '.', 'event');

  elsif p_action = 'build_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found or bill_done(f.needed) then return; end if;
    select * into mat from build_material_def where id = f.material;
    used := next_material(p_world, p_uid, f.material, f.needed);
    if used is null or not consume(p_world, p_uid, used, 1) then return; end if;
    bill := jsonb_set(f.needed, array[used], to_jsonb((f.needed->>used)::int - 1));
    update floor_tile set needed = bill where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Floors are paving; stairs, ladders and roofs are carpentry or masonry by material.
    sk := case f.kind when 'floor' then 'paving' when 'ladder' then 'carpentry'
                      else coalesce(mat.skill, 'carpentry') end;
    gained := skill_raise(p_world, p_uid, sk, 0.4);
    what := case when f.kind = 'ladder' then 'ladder' else lower(mat.name) || ' ' || floor_kind_name(f.kind) end;
    if bill_done(bill) then
      perform tell(p_world, p_uid, 'You finish the ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You work ' || material_name(used, 1) || ' into the '
        || floor_kind_name(f.kind) || '. Still needed: ' || bill_text(f.material, bill) || '.', 'event');
    end if;
    if gained > 0 then
      perform tell(p_world, p_uid, initcap(replace(sk, '_', ' ')) || ' increased by '
        || to_char(gained, 'FM0.0000') || ' to '
        || to_char(skill_of(p_world, p_uid, sk), 'FM990.0000') || '.', 'skill');
    end if;

  elsif p_action = 'remove_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    delete from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Anybody standing on what was just torn up goes down a storey, not through it.
    if lvl > 0 then
      update player set level = lvl - 1
        where world_id = p_world and floor(x)::int = tx and floor(y)::int = ty and level >= lvl;
    end if;
    perform tell(p_world, p_uid, 'You remove the ' || floor_kind_name(f.kind) || '.', 'event');

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return; end if;
    update building set levels = levels - 1, work_level = levels - 2
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, b.name || ' is back to '
      || case when b.levels = 1 then 'a single storey' else b.levels || ' storeys' end || '.', 'event');
  end if;
end $$;

select private.lock_doors();
