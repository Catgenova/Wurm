-- Mosaic is a solid wall, a floor or a roof, and nothing else.
--
-- A material may carry an `only` (`building.ts`): the wall types and the
-- floor kinds it is laid as, and the sentence that says so, which the
-- definitions put on `build_material_def`. This asks it, at the points the
-- browser asks `onlyRefusal`: right after the glass, in planning a wall, a
-- fence or a floor (`glass_refusal`); in planning a column (`frame_refusal`),
-- which no such material makes; in a Mason's Repoint, which may not lay a
-- window or a door again in it (`build_refusal`); and in asking for a hidden
-- door (`rpc_plan_hidden_wall`), before its padlock and hinges.

set local lock_timeout = '3s';

/** Why a material will not be laid as this wall type, this floor kind or a column (`'column'`), or null. */
create or replace function material_only_refusal(p_material text, p_wall text, p_floor text)
returns text language sql stable as $$
  select d.only_said from build_material_def d
   where d.id = p_material and d.only_said is not null
     and ((p_wall is not null and p_wall <> '' and not (p_wall = any(coalesce(d.only_walls, array[]::text[]))))
       or (p_floor is not null and p_floor <> '' and not (p_floor = any(coalesce(d.only_floors, array[]::text[])))))
$$;

CREATE OR REPLACE FUNCTION public.glass_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int := (p_target->>'x')::int; ty int := (p_target->>'y')::int;
        v_mat text := coalesce(p_target->>'material', ''); v_kind text := coalesce(p_target->>'floorKind', 'floor');
        b building;
begin
  if p_action = 'add_floor' then
    select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);
    return case when b.id is not null and field_in(p_world, b.id) then field_no_storey_said() end;
  end if;
  if p_action in ('plan_wall', 'plan_fence') then
    if coalesce(p_target->>'side', '') = '' or coalesce(p_target->>'wallType', '') = '' or v_mat = '' then return null; end if;
    -- Glass on a roof only, and a material with an `only` as that and nothing else (`material_only_refusal`).
    return case when v_mat = glass_material() then glass_roof_only_said()
                else material_only_refusal(v_mat, p_target->>'wallType', null) end;
  end if;
  if p_action <> 'plan_floor' or v_mat = '' then return null; end if;
  if v_mat = glass_material() and v_kind <> 'roof' then return glass_roof_only_said(); end if;
  if material_only_refusal(v_mat, null, v_kind) is not null then return material_only_refusal(v_mat, null, v_kind); end if;
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);
  if b.id is null then return null; end if;
  -- A building has one roof, and its first tile set the shape; the first tile asks for its own.
  if v_mat = glass_material()
     and coalesce(b.roof, (select r.id from roof_shape_def r where r.id = p_target->>'roofShape'), 'hip') = 'flat' then
    return glass_pitched_said();
  end if;
  if v_kind = 'floor' and work_level(p_world, b.id) = 0 and land_tile(p_world, tx, ty) = tile_id('Field') then
    return field_unfloored_said();
  end if;
  if v_kind = 'roof' and v_mat <> glass_material() and field_in(p_world, b.id) then
    return field_glass_only_said();
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.frame_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb, p_b building)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int := (p_target->>'x')::int; ty int := (p_target->>'y')::int; side text := p_target->>'side';
        cx int := (p_target->>'cx')::int; cy int := (p_target->>'cy')::int;
        mat build_material_def; lvl int; kind text; over building; f floor_tile; tool text; bears int;
        col building_column; v_lvl int; v_gap text;
        v_terrace boolean := coalesce((p_target->>'terrace')::boolean, false);
begin
  select * into mat from build_material_def where id = p_target->>'material';

  -- Nothing is planned under a jetty: the ground there stays open ground.
  if p_action in ('plan_building', 'add_to_building') then
    select * into over from building where world_id = p_world and id = frame_jetty_of(p_world, tx, ty);
    if over.id is not null then return 'That tile is under ' || over.name || '''s jetty.'; end if;
    return null;
  end if;

  if p_action = 'remove_from_plan' then
    -- The cellar's word comes first, as the browser asks it (`cellar.ts`).
    if p_b.id is null or p_b.levels > 1 or (cellar_at(p_world, tx, ty)).world_id is not null
       or tile_has_structures(p_world, tx, ty) then return null; end if;
    if exists (select 1 from building_column c where c.world_id = p_world and c.level = 0
                 and c.x in (tx, tx + 1) and c.y in (ty, ty + 1)) then
      return 'Take down the columns on its corners first.';
    end if;
    return null;
  end if;

  if p_action = 'remove_storey' then
    if p_b.id is null or p_b.levels <= 1 or has_roof(p_world, p_b.id)
       or exists (select 1 from wall where world_id = p_world and building = p_b.id and level = p_b.levels - 1)
       or exists (select 1 from floor_tile where world_id = p_world and building = p_b.id and level = p_b.levels - 1) then
      return null;
    end if;
    if exists (select 1 from building_column c where c.world_id = p_world and c.building = p_b.id
                 and c.level = p_b.levels - 1) then
      return 'Take down the columns of the top storey first.';
    end if;
    return null;
  end if;

  -- A terrace takes a railing and nothing else; a railing goes nowhere on the ground.
  if p_action = 'plan_wall' then
    if side is null or not exists (select 1 from wall_type_def where id = p_target->>'wallType') or mat.id is null
       or need_tool(p_world, p_uid, 'mallet') is not null or p_b.id is null then
      return null;
    end if;
    if v_terrace then
      if roof_shape_of(p_world, p_b.id) <> 'flat' then return 'Only a flat roof is a terrace.'; end if;
      if p_target->>'wallType' <> 'railing' then return 'Only a railing goes round a terrace.'; end if;
      if not exists (select 1 from floor_tile ft where ft.world_id = p_world and ft.level = p_b.levels
                       and ft.x = tx and ft.y = ty and ft.kind = 'roof' and bill_done(ft.needed)) then
        return 'Finish the roof on this tile first.';
      end if;
      return null;
    end if;
    -- The ground floor of a tile on piers is its deck, whose edge is a drop as an upper floor's is.
    if p_target->>'wallType' = 'railing' and frame_job_level(p_b, p_target) < 1 and not on_piers(p_world, tx, ty) then
      return 'A railing goes on the edge of a storey above the ground, of a deck on piers, or round a terrace. On the ground, plan a fence.';
    end if;
    -- A wall shutting a roofed jetty off from its storey would make a balcony with a roof on it.
    if not is_low_wall(p_target->>'wallType') and frame_job_level(p_b, p_target) = p_b.levels - 1
       and (frame_wall_at(p_world, tx, ty, side, p_target)).world_id is null
       and exists (select 1 from border_of(tx, ty, side) bd where frame_roof_cut_off(p_world, p_b, bd.dir, bd.x, bd.y)) then
      return 'The roof is over that jetty: take it off first. A balcony takes no roof.';
    end if;
    return null;
  end if;

  -- A floor out past the footprint: a jetty, or the roof over one.
  if p_action = 'plan_floor' then
    if mat.id is null or need_tool(p_world, p_uid, 'mallet') is not null or p_b.id is null
       or building_at(p_world, tx, ty) is not null then
      return null;
    end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    return frame_jetty_refusal(p_world, p_uid, p_b, tx, ty, kind, frame_floor_level(p_world, p_b.id, kind, p_target), mat,
                               p_target->>'roofShape');
  end if;

  -- A jetty resting on a wall and on nothing else would be left in the air.
  if p_action = 'remove_wall' then
    if side is null then return null; end if;
    v_lvl := frame_bears_jetty(p_world, frame_wall_at(p_world, tx, ty, side, p_target));
    if v_lvl is not null then
      return 'A jetty of storey ' || (v_lvl + 1) || ' rests on this wall: raise a column at each end of it, or tear the jetty up, first.';
    end if;
    -- And a roof over a jetty resting on it alone, or the storey over it.
    return coalesce(frame_roof_on_wall(p_world, frame_wall_at(p_world, tx, ty, side, p_target)),
                    frame_storey_on_wall(p_world, frame_wall_at(p_world, tx, ty, side, p_target)));
  end if;

  -- A railing round a flat roof stands on it.
  if p_action = 'remove_floor' then
    if p_b.id is null then return null; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, p_b.id, kind, p_target);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return null; end if;
    if f.kind = 'roof' and exists (
        select 1 from (values ('n'), ('e'), ('s'), ('w')) s(side)
        cross join lateral border_of(tx, ty, s.side) bd
        join wall w on w.world_id = p_world and w.level = p_b.levels
          and w.dir = bd.dir and w.x = bd.x and w.y = bd.y
       where w.building = p_b.id) then
      return 'Take down the railing standing on it first.';
    end if;
    -- A column on it, or the roof over a jetty: asked after the walls on it, which `build_refusal` names.
    if f.kind <> 'roof' and not exists (
        select 1 from (values ('n'), ('e'), ('s'), ('w')) s(side)
        cross join lateral border_of(tx, ty, s.side) bd
        join wall w on w.world_id = p_world and w.level = lvl and w.dir = bd.dir and w.x = bd.x and w.y = bd.y) then
      return frame_floor_holds(p_world, p_b, lvl, tx, ty);
    end if;
    return null;
  end if;

  if p_action = 'plan_column' then
    if mat.id is null then return 'Choose a material.'; end if;
    if cx is null or cy is null or cx not in (tx, tx + 1) or cy not in (ty, ty + 1) then return 'Choose a corner of the tile.'; end if;
    -- Glass goes on a roof and nowhere else (`glass_refusal`).
    if mat.id = glass_material() then return glass_roof_only_said(); end if;
    -- And no material with an `only` makes a column.
    if material_only_refusal(mat.id, 'column', null) is not null then return material_only_refusal(mat.id, 'column', null); end if;
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if p_b.id is null then return 'No building here.'; end if;
    lvl := frame_job_level(p_b, p_target);
    if not frame_column_footing(p_world, p_b.id, lvl, cx, cy) then return 'Build the floor of this storey first.'; end if;
    if exists (select 1 from building_column c where c.world_id = p_world and c.level = lvl and c.x = cx and c.y = cy) then
      return 'There is already a column on that corner.';
    end if;
    -- On the ground floor it takes the corner spot of every tile round it (`frame_column_corner`): none with a piece in it.
    if lvl = 0 and frame_piece_in_corner(p_world, cx, cy) then return 'Move what stands in that corner first.'; end if;
    -- What is under it has to carry it, as it would a wall: on piers its decks first (`deck_carries`).
    v_gap := case when p_b.deck is not null then deck_carries(p_world, p_b.id, mat.id) end;
    if v_gap is not null then return v_gap; end if;
    bears := bearing(p_world, p_b.id, lvl);
    if mat.heft > coalesce(bears, 9) then
      return mat.name || ' is too heavy to raise over what is under it. This storey carries '
          || heft_word(bears) || ', no more.';
    end if;
    return null;
  end if;

  if p_action in ('build_column', 'remove_column') then
    if cx is null or cy is null or cx not in (tx, tx + 1) or cy not in (ty, ty + 1) then return 'Choose a corner of the tile.'; end if;
    if p_b.id is not null then
      select * into col from building_column c
       where c.world_id = p_world and c.level = frame_job_level(p_b, p_target) and c.x = cx and c.y = cy;
    end if;
    if p_action = 'remove_column' then
      if col.world_id is null then return 'There is no column there.'; end if;
      -- What it carries, if it carries anything, comes down first, or a wall goes up to take it.
      return frame_column_carries(p_world, col);
    end if;
    if col.world_id is null then return 'There is no column planned there.'; end if;
    if bill_done(col.needed) then return 'That column is finished.'; end if;
    select * into mat from build_material_def where id = col.material;
    tool := need_tool(p_world, p_uid, mat.tool);
    if tool is not null then return tool; end if;
    if next_material(p_world, p_uid, col.material, col.needed, tx, ty) is null then
      return 'You need ' || bill_text(col.material, col.needed) || '.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.build_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; side text; wt wall_type_def; mat build_material_def; b building;
        w wall; f floor_tile; lvl int; kind text; tool text; other record; v_gap text;
        bears int; cap int; worst build_material_def; under build_material_def;
        pot item; colour dye_def; v_was build_material_def; v_over int; v_stands int; v_bill jsonb; v_glass text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into wt from wall_type_def where id = p_target->>'wallType';
  select * into mat from build_material_def where id = p_target->>'material';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);
  -- Frame: a storey job out past the footprint is for the building it names (`frame_building`).
  b := frame_building(p_world, p_action, p_target, b);

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
  -- Glass goes on a pitched roof and nowhere else, and no floor over a field (`glass_refusal`).
  v_glass := glass_refusal(p_world, p_uid, p_action, p_target);
  if v_glass is not null then return v_glass; end if;
  -- Frame: jetties, terraces, railings and columns, where the browser asks them, after the glass (`frame_refusal`).
  v_gap := frame_refusal(p_world, p_uid, p_action, p_target, b);
  if v_gap is not null or frame_action(p_action) then return v_gap; end if;

  if p_action = 'plan_building' then
    return coalesce(need_tool(p_world, p_uid, 'mallet'), plan_reason(p_world, p_uid, tx, ty),
                    counter_street_refusal(p_world, tx, ty));  -- a counter's street (`counters.ts`)

  elsif p_action = 'add_to_building' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return 'There is no building next to this tile.'; end if;
    if b.levels > 1 then return 'The footprint cannot change once upper floors are planned.'; end if;
    -- Piers: under the deck, or beside the floor, of the building it joins (`extend_reason`).
    return coalesce(extend_reason(p_world, p_uid, tx, ty, b.id), counter_street_refusal(p_world, tx, ty));  -- a counter's street

  elsif p_action = 'remove_from_plan' then
    if b.id is null then return 'No building here.'; end if;
    if b.levels > 1 then return 'Remove the upper floors first.'; end if;
    -- cellar: a building with a cellar under it comes down only once the cellar is filled in.
    if (cellar_at(p_world, tx, ty)).world_id is not null then return 'Fill in the cellar under it first.'; end if;
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
    lvl := frame_wall_level(p_world, tx, ty, p_target);  -- Frame: a jetty's storey, or round a terrace.
    -- Piers: and on the ground floor of a tile on piers, which is its deck.
    if lvl > 0 or on_piers(p_world, tx, ty) then
      select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
      if not found or not bill_done(f.needed) then return 'Build the floor of this storey first.'; end if;
    end if;
    -- Frame: and on the job's storey.
    if (frame_wall_at(p_world, tx, ty, side, p_target)).world_id is not null then return 'There is already a wall on that side.'; end if;
    -- A shop counter faces the street from the ground floor (`counters.ts`).
    if wt.id = 'counter' then
      v_gap := counter_plan_refusal(p_world, lvl, tx, ty, side);
      if v_gap is not null then return v_gap; end if;
    end if;
    -- Nor does a wall close over a lantern post's arm (`lamps.ts`).
    v_gap := lamp_wall_refusal(p_world, lvl, tx, ty, side, wt.id);
    if v_gap is not null then return v_gap; end if;
    /*
     * And what is underneath has to carry it. The courses below are what hold
     * a wall up, and a beginner finds that out by being told rather than by
     * watching it come down.
     */
    -- Piers: and a building on piers stands on its decks, which carry what they are laid in (`deck_carries`).
    v_gap := case when b.deck is not null then deck_carries(p_world, b.id, mat.id) end;
    if v_gap is not null then return v_gap; end if;
    bears := coalesce(bearing(p_world, b.id, lvl), 9);
    if mat.heft > bears then
      return mat.name || ' is too heavy to raise over what is under it. This storey carries '
          || heft_word(bears) || ', no more.';
    end if;
    -- gates: a portcullis in stone on the ground floor; a hidden door is planned as a solid wall.
    return gate_plan_refusal(p_world, p_uid, wt.id, mat.id, lvl, building_at(p_world, tx, ty) is null);

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
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if p_action = 'remove_wall' then
      -- And a shop counter comes down empty, till and all (`counters.ts`).
      -- gates: and a padlock on a portcullis keeps it from being taken down as from being worked; a hidden
      -- door answers as the solid wall it is to whoever it does not admit, which is nothing (`gateRemoveRefusal`).
      return case when w.world_id is null then 'There is no wall there.'
                  else coalesce(counter_remove_refusal(p_world, w),
                                case when w.type = 'portcullis' then lock_refusal(p_world, p_uid, w.lock, w.x, w.y) end) end;
    end if;
    if w.world_id is null then return 'There is no wall planned there.'; end if;
    if bill_done(w.needed) then return 'That wall is finished.'; end if;
    -- Nor is one raised over a lantern post's arm (`lamps.ts`).
    v_gap := lamp_wall_refusal(p_world, w.level, tx, ty, side, w.type);
    if v_gap is not null then return v_gap; end if;
    select * into mat from build_material_def where id = w.material;
    if mat.id is not null then
      tool := need_tool(p_world, p_uid, mat.tool);
      if tool is not null then return tool; end if;
    end if;
    if next_material(p_world, p_uid, w.material, w.needed, tx, ty) is null then
      return 'You need ' || bill_text(w.material, w.needed) || '.';
    end if;
    return null;

  elsif p_action = 'add_floor' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    -- A Mason's Tall Walls: stone stands higher in a building they planned.
    if b.levels >= max_levels()::int + tall_of(p_world, b.id) then
      return 'Buildings cannot be taller than ' || (max_levels()::int + tall_of(p_world, b.id)) || ' storeys.';
    end if;
    /*
     * And no taller than what it is made of will stand. The shortest material
     * in the whole building answers, not the one you are standing on: a plank
     * wing joined to a stone tower caps the tower.
     */
    cap := storey_cap(p_world, b.id);
    if b.levels >= cap then
      worst := storey_capper(p_world, b.id);
      return coalesce(worst.name, 'What this is built of') || ' will not stand '
          || (cap + 1) || ' storeys. ' || cap || ' is as high as it goes.';
    end if;
    -- And the hands to raise it: ten a storey in the trade of the one below.
    under := storey_material(p_world, b.id, b.levels - 1);
    -- Past the tenth storey, which only Tall Walls reaches, a hundred is as much as there is.
    if under.id is not null and skill_of(p_world, p_uid, under.skill) < least(100, b.levels * storey_skill()) then
      return 'Raising a ' || (b.levels + 1) || nth(b.levels + 1) || ' storey over '
          || lower(under.name) || ' takes ' || under.skill || ' '
          || least(100, b.levels * storey_skill()) || '. You have '
          || to_char(skill_of(p_world, p_uid, under.skill), 'FM990.0') || '.';
    end if;
    if has_roof(p_world, b.id) then return 'Take the roof off first.'; end if;
    if has_low_wall(p_world, b.id, b.levels - 1) then
      -- Frame: a railing is low work too, and columns close a side.
      return 'Nothing rests on a fence, a half wall or a railing: the storey below needs walls, or finished columns at both ends of every open side.';
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
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
    if kind = 'roof' then
      v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
      if v_gap is not null then return v_gap; end if;
    elsif kind in ('stairs', 'ladder') then
      -- cellar: on the ground floor, a way down to the cellar under it.
      if lvl < 1 then
        -- Frame: not a way down, so a way up: in a building with a storey over the ground, that storey to work on.
        if (cellar_at(p_world, tx, ty)).world_id is null and not coalesce((p_target->>'down')::boolean, false) and b.levels > 1 then
          return 'Work on storey 2 or above to plan ' || case when kind = 'ladder' then 'a ladder' else 'stairs' end || ' here.';
        end if;
        v_gap := cellar_flight_refusal(p_world, b.id, tx, ty, side, coalesce((p_target->>'down')::boolean, false));
        if v_gap is not null then return v_gap; end if;
      end if;
      if side is null then return 'Choose the side to climb from.'; end if;
      -- Piers: a flight or a ladder up from a tile on piers stands on its deck.
      if (lvl > 1 or on_piers(p_world, tx, ty)) and not exists (select 1 from floor_tile where world_id = p_world
          and level = lvl - 1 and x = tx and y = ty) then
        return 'Plan the floor of the storey below first.';
      end if;
      -- cellar: one way off the ground floor a tile: a flight up and a flight down are not stacked on it.
      v_gap := cellar_stack_refusal(p_world, lvl, tx, ty); -- cellar
      if v_gap is not null then return v_gap; end if; -- cellar
    end if;
    -- cellar: a flight or a ladder down takes up the ground floor's flooring where it goes (`flooringUnder`).
    if exists (select 1 from floor_tile f2 where f2.world_id = p_world and f2.level = lvl and f2.x = tx and f2.y = ty
                 and not (lvl = 0 and f2.kind = 'floor' and p_target->>'floorKind' in ('stairs', 'ladder'))) then -- cellar
      return case when kind = 'roof' then 'There is already roof planned here.'
                  else 'There is already a floor planned here.' end;
    end if;
    -- Piers: a deck on piers carries what it is laid in, and the building on it is as heavy as its heaviest wall (`deck_bears`).
    if lvl = 0 and kind = 'floor' and on_piers(p_world, tx, ty) then return deck_bears(p_world, b.id, mat.id); end if;
    return null;

  elsif p_action in ('build_floor', 'remove_floor') then
    if b.id is null then return case when p_action = 'build_floor'
      then 'There is nothing planned here.' else 'No building here.' end; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar; Frame: on the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if p_action = 'remove_floor' then
      if not found then return 'There is nothing here to remove.'; end if;
      -- cellar: a flight down is let into the ground floor, and the walls round it stand on the ground;
      -- cellar: and a way down is a way up too, for whoever is down there.
      if lvl = 0 and f.kind in ('stairs', 'ladder') then -- cellar
        if (cellar_at(p_world, tx, ty)).world_id is not null and cellar_occupied(p_world, b.id) then -- cellar
          return 'Somebody is down in the cellar, and this is a way up out of it.'; -- cellar
        end if; -- cellar
        return null; -- cellar
      end if; -- cellar
      -- A wall stands on a floor only where it may not go up without a finished one (`plan_wall`): a storey up, or
      -- a deck on piers. On the ground floor it stands on the ground, and a floor still planned carries nothing.
      if f.kind <> 'roof' and bill_done(f.needed) and (lvl > 0 or on_piers(p_world, tx, ty)) and exists (
          select 1 from (values ('n'), ('e'), ('s'), ('w')) as s(side)
          cross join lateral border_of(tx, ty, s.side) bd
          join wall w2 on w2.world_id = p_world and w2.level = lvl
            and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y) then
        return 'Take down the walls standing on it first.';
      end if;
      -- Piers: a deck holds up whatever stands or lies on it, and whoever is taking it up (`deck_refusal`).
      v_gap := deck_refusal(p_world, p_uid, lvl, tx, ty);
      if v_gap is not null then return v_gap; end if;
      return null;
    end if;
    if not found then return 'There is nothing planned here.'; end if;
    if bill_done(f.needed) then return 'That is already finished.'; end if;
    select * into mat from build_material_def where id = f.material;
    tool := need_tool(p_world, p_uid, case when f.kind = 'ladder' then 'mallet' else mat.tool end);
    if tool is not null then return tool; end if;
    if next_material(p_world, p_uid, f.material, f.needed, tx, ty) is null then
      return 'You need ' || bill_text(f.material, f.needed) || '.';
    end if;
    return null;

  elsif p_action in ('paint_wall', 'strip_wall_paint') then
    if side is null then return 'Choose a side.'; end if;
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return 'There is no wall there.'; end if;
    if p_action = 'strip_wall_paint' then
      if w.dye is null then return 'It has taken no colour.'; end if;
      if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then return 'You need a bucket of lye to scrub it back.'; end if;
      return null;
    end if;
    if not bill_done(w.needed) then return 'Finish it before you paint it.'; end if;
    pot := pick_dye(p_world, p_uid);
    if pot.id is null then return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.'; end if;
    select * into colour from dye_def where name = pot.extra;
    if w.dye = colour.id then return 'It is ' || colour.word || ' already.'; end if;
    return null;

  elsif p_action = 'paint_floor' then
    if b.id is null then return 'There is no floor here.'; end if;
    lvl := frame_job_level(b, p_target);  -- Frame: on the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return 'There is no floor here.'; end if;
    if not bill_done(f.needed) then return 'Finish it before you paint it.'; end if;
    pot := pick_dye(p_world, p_uid);
    if pot.id is null then return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.'; end if;
    select * into colour from dye_def where name = pot.extra;
    if f.dye = colour.id then return 'It is ' || colour.word || ' already.'; end if;
    return null;

  /*
   * A Mason's Repoint, in the browser's words: a finished wall of stone, a
   * stone to lay it in that is not what it is, and everything to hand -- and
   * what is under it has to carry the new stone and the new stone what stands
   * on it, and stand as many storeys as the building has.
   */
  elsif p_action = 'repoint_wall' then
    if pk(p_world, p_uid, 'repoint', 0) <= 0 then return 'That wants a Mason who has learned to repoint.'; end if;
    if side is null then return 'Choose a side.'; end if;
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return 'There is no wall there.'; end if;
    select * into v_was from build_material_def where id = w.material;
    if v_was.kind is distinct from 'stone' then return 'Only a wall of stone is repointed.'; end if;
    if not bill_done(w.needed) then return 'Finish it before you repoint it.'; end if;
    if mat.id is null or mat.kind <> 'stone' then return 'Choose the stone to lay it in.'; end if;
    if mat.id = v_was.id then return 'It is ' || lower(mat.name) || ' already.'; end if;
    if material_only_refusal(mat.id, w.type, null) is not null then return material_only_refusal(mat.id, w.type, null); end if;
    tool := need_tool(p_world, p_uid, mat.tool);
    if tool is not null then return tool; end if;
    if b.id is not null and w.building = b.id then
      -- Piers: a building on piers stands on its decks, which carry what they are laid in (`deck_carries`).
      v_gap := case when b.deck is not null then deck_carries(p_world, b.id, mat.id) end;
      if v_gap is not null then return v_gap; end if;
      bears := bearing(p_world, b.id, w.level);
      if mat.heft > bears then
        return mat.name || ' is too heavy to raise over what is under it. This storey carries '
            || heft_word(bears) || ', no more.';
      end if;
      select max(m2.heft) into v_over from wall w2 join build_material_def m2 on m2.id = w2.material
       where w2.world_id = p_world and w2.building = b.id and w2.level > w.level;
      if mat.heft < coalesce(v_over, 0) then
        return mat.name || ' will not carry the ' || heft_word(v_over) || ' standing on it.';
      end if;
      v_stands := mat.storeys + floor(pk(p_world, p_uid, 'storeys:' || build_work(mat.kind), 0))::int;
      if b.levels > v_stands then
        return mat.name || ' will not stand ' || b.levels || ' storeys. ' || v_stands || ' is as high as it goes.';
      end if;
    end if;
    v_bill := scaled_bill(mat.id, coalesce((select t2.factor::text::float8 from wall_type_def t2 where t2.id = w.type), 1));
    if exists (select 1 from jsonb_each_text(v_bill) e
                where build_to_hand(p_world, p_uid, e.key, tx, ty, mat.id) < e.value::int) then
      return 'You need ' || bill_text(mat.id, v_bill) || '.';
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

CREATE OR REPLACE FUNCTION public.rpc_plan_hidden_wall(p_world uuid, p_target jsonb, p_times integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); why text; v jsonb; bd record;
        t jsonb := coalesce(p_target, '{}'::jsonb) || '{"wallType": "solid"}'::jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  -- A material laid as only some things is no hidden door unless it says so (`material_only_refusal`); then the padlock and the hinges.
  why := coalesce(material_only_refusal(t->>'material', 'hidden_door', null), hidden_door_wants(p_world, me));
  if why is not null then
    if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
    perform settle(p_world, me);
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  v := rpc_act(p_world, 'plan_wall', t, p_times);
  if coalesce((v->>'started')::boolean, false) or coalesce((v->>'queued')::boolean, false) then
    select * into bd from border_of((t->>'x')::int, (t->>'y')::int, t->>'side');
    insert into private.hidden_door_plan (world_id, uid, dir, x, y, at)
      values (p_world, me, bd.dir, bd.x, bd.y, now())
    on conflict (world_id, uid, dir, x, y) do update set at = excluded.at;
  end if;
  return v;
end $function$;

select private.lock_doors();
