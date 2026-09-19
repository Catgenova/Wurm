-- Which storey, which side, and how many to go.
--
-- Reported: "cant plan roof on when conditions are met. make sure that doors
-- and window walls etc count as elligible walls if completed."
--
-- They do count, and always have: what a border wants is something standing on
-- it with its bill paid, and neither side has ever asked what kind of wall it
-- is. A finished door closes a storey exactly as a solid wall does, and so do
-- a window, a bay, a gate and a half wall.
--
-- What was wrong was the answer. "All walls of the top storey must be built
-- before roofing" names no storey and no side, and the storey it means is the
-- one planned over your head rather than the finished room you are standing
-- in — so on any building bigger than a shed it reads as a refusal for no
-- reason. It now says which storey is short, how many of its sides have
-- nothing on them, how many walls are up but not finished, and where the
-- nearest of them is from where you are standing. The same sentence on both
-- sides, down to which gap it calls nearest.

/**
 * What is left before a storey is closed in, as a sentence, or null when it is
 * closed in. Sides with nothing on them, walls that are up but unpaid for, and
 * the nearest of either from wherever the asking is done.
 */
create or replace function level_gap(p_world uuid, p_building int, p_level int,
                                     p_x double precision, p_y double precision) returns text
  language sql stable as $fn$
  with sides as (
    select t.x, t.y, s.side, b.dir, b.x as bx, b.y as by
    from building_tile t
    cross join lateral (values ('n'), ('e'), ('s'), ('w')) as s(side)
    cross join lateral across(t.x, t.y, s.side) a
    cross join lateral border_of(t.x, t.y, s.side) b
    where t.world_id = p_world and t.building = p_building
      and building_at(p_world, a.x, a.y) is distinct from p_building),
  holes as (
    select s.x, s.y, s.side, (w.type is null) as bare
    from sides s
    left join wall w on w.world_id = p_world and w.level = p_level
      and w.dir = s.dir and w.x = s.bx and w.y = s.by
    where w.type is null or not bill_done(w.needed)),
  -- And anything planned inside it and never finished, which stops a storey
  -- being closed in just as surely as a hole in the outside wall.
  within as (
    select count(*)::int as n from wall w
    where w.world_id = p_world and w.building = p_building and w.level = p_level
      and not bill_done(w.needed)
      and not exists (select 1 from sides s where s.dir = w.dir and s.bx = w.x and s.by = w.y)),
  tally as (
    select count(*) filter (where bare)::int as bare,
           count(*) filter (where not bare)::int + (select n from within) as going,
           (select ', nearest the ' || side_name(h.side) || ' side of ' || h.x || ',' || h.y
              from holes h
             order by (h.x + 0.5 - p_x) ^ 2 + (h.y + 0.5 - p_y) ^ 2, h.x, h.y, strpos('nesw', h.side)
             limit 1) as at
    from holes)
  select case when bare = 0 and going = 0 then null else
    'Storey ' || (p_level + 1) || ' is not closed in: '
      || array_to_string(array_remove(array[
           case when bare > 0 then bare || ' side' || case when bare = 1 then '' else 's' end
                                  || ' with no wall' end,
           case when going > 0 then going || ' still going up' end], null), ' and ')
      || coalesce(at, '') || '.' end
  from tally
$fn$;

/** The same, asked from wherever the person asking is standing. */
create or replace function level_gap(p_world uuid, p_building int, p_level int, p_uid uuid)
  returns text language sql stable as $fn$
  select level_gap(p_world, p_building, p_level, pl.x, pl.y)
  from player pl where pl.world_id = p_world and pl.uid = p_uid
$fn$;

CREATE OR REPLACE FUNCTION public.build_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; side text; wt wall_type_def; mat build_material_def; b building;
        w wall; f floor_tile; lvl int; kind text; tool text; other record; v_gap text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into wt from wall_type_def where id = p_target->>'wallType';
  select * into mat from build_material_def where id = p_target->>'material';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);

  /*
   * Whose building it is, asked once for every action that acts on one that
   * already stands.
   *
   * `plan_building` and `add_to_building` are answered by `plan_reason`, which
   * asks whose *ground* it is. Everything else — renaming, unpicking, walling,
   * flooring, adding a storey — was asked of nobody at all, so anybody could
   * rename or take apart anybody's building. `plan_fence` never reaches this
   * because it refuses outright on a tile that is part of a building.
   */
  if b.id is not null and p_action <> 'plan_building'
     and not building_yours(p_world, p_uid, b.id) then
    return 'That is not your building.';
  end if;

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
    v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
    if v_gap is not null then return v_gap; end if;
    return null;

  elsif p_action = 'plan_floor' then
    if mat.id is null then return 'Choose a material.'; end if;
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    if kind = 'roof' then
      v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
      if v_gap is not null then return v_gap; end if;
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

select private.lock_doors();
