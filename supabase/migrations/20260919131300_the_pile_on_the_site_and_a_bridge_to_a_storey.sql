-- The pile on the site, and a bridge that lands on a storey
--
-- A builder carried everything. Twenty-four logs for six walls, at what a log
-- weighs, is four trips from the woodpile to the corner of the house — and the
-- crate you tipped them into is standing on the very tile you are working,
-- which is where a builder's materials have stood since anybody built
-- anything. A wall or a floor now draws from a crate on its own tile first and
-- from the pack after. On the tile, not within reach: a crate two tiles off is
-- a store, and walking to it is the point of it being over there.
--
-- And a bridge may land on a storey. Its ends wanted a bank or a poured slab,
-- and both are ground — so two towers a tile apart were a staircase down, a
-- walk across the yard and a staircase up. A finished floor is as flat and as
-- solid as a slab and is already at a height somebody chose; both ends have to
-- be the same storey, and the deck is walked at that storey rather than at the
-- ground it passes over. The walking itself is the browser's, as all movement
-- is; what is here is where a deck may be set out and how high it is carried.

alter table bridge add column if not exists level int not null default 0;

/** What is on a tile of a work site: a crate standing on it holds this much. */
create or replace function site_count(p_world uuid, p_x int, p_y int, p_item text)
returns int language sql stable as $fn$
  select coalesce(sum(i.count), 0)::int
    from crate c
    join item i on i.world_id = c.world_id and i.holder = 'crate' and i.holder_uid is null
                and i.crate = c.id and i.def = p_item
   where c.world_id = p_world and c.x = p_x and c.y = p_y
$fn$;

/** One unit out of a crate on the site. The row goes when the last of it does. */
create or replace function site_take(p_world uuid, p_x int, p_y int, p_item text)
returns boolean language plpgsql as $fn$
declare v_id bigint;
begin
  select i.id into v_id
    from crate c
    join item i on i.world_id = c.world_id and i.holder = 'crate' and i.crate = c.id and i.def = p_item
   where c.world_id = p_world and c.x = p_x and c.y = p_y and i.count > 0
   order by i.ql, i.id limit 1;
  if v_id is null then return false; end if;
  update item set count = count - 1 where id = v_id;
  delete from item where id = v_id and count <= 0;
  return true;
end $fn$;

/**
 * The next item on a bill that is to hand: in the pack, or in a crate standing
 * on the tile being worked.
 */
create or replace function next_material(p_world uuid, p_uid uuid, p_material text, p_bill jsonb,
                                         p_x int, p_y int)
returns text language sql stable as $fn$
  select e.key from jsonb_each_text(p_bill) e
  left join build_material_bill b on b.material = p_material and b.item = e.key
  where e.value::int > 0
    and (pack_count(p_world, p_uid, e.key) > 0 or site_count(p_world, p_x, p_y, e.key) > 0)
  order by coalesce(b.ord, 99), e.key limit 1
$fn$;

/** A unit of it, out of the pack if it is there and off the site if it is not. */
create or replace function take_material(p_world uuid, p_uid uuid, p_item text, p_x int, p_y int)
returns boolean language sql as $fn$
  select case when pack_count(p_world, p_uid, p_item) > 0
              then consume(p_world, p_uid, p_item, 1)
              else site_take(p_world, p_x, p_y, p_item) end
$fn$;

/**
 * The highest thing at a tile that somebody may stand on and a bridge may land
 * on: a finished floor of a building, or the ground and whatever is poured
 * over it. Returns the storey, nought for the ground.
 */
create or replace function top_deck(p_world uuid, p_x int, p_y int) returns int
language sql stable as $fn$
  select coalesce((
    select max(f.level) from floor_tile f
     where f.world_id = p_world and f.x = p_x and f.y = p_y and f.level >= 1
       and bill_done(f.needed) and f.kind <> 'roof'), 0)
$fn$;

/** And how high that stands, which is the ground plus a storey for each one up. */
create or replace function deck_height(p_world uuid, p_x int, p_y int)
returns double precision language sql stable as $fn$
  select surface_height(p_world, p_x, p_y) + top_deck(p_world, p_x, p_y) * wall_height()
$fn$;

CREATE OR REPLACE FUNCTION public.build_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; side text; wt wall_type_def; mat build_material_def; b building;
        w wall; f floor_tile; lvl int; kind text; tool text; other record; v_gap text;
        bears int; cap int; worst build_material_def; under build_material_def;
        pot item; colour dye_def;
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
    /*
     * And what is underneath has to carry it. The courses below are what hold
     * a wall up, and a beginner finds that out by being told rather than by
     * watching it come down.
     */
    bears := coalesce(bearing(p_world, b.id, lvl), 9);
    if mat.heft > bears then
      return mat.name || ' is too heavy to raise over what is under it. This storey carries '
          || heft_word(bears) || ', no more.';
    end if;
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
    if next_material(p_world, p_uid, w.material, w.needed, tx, ty) is null then
      return 'You need ' || bill_text(w.material, w.needed) || '.';
    end if;
    return null;

  elsif p_action = 'add_floor' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    if b.levels >= 10 then return 'Buildings cannot be taller than 10 storeys.'; end if;
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
    if under.id is not null and skill_of(p_world, p_uid, under.skill) < b.levels * storey_skill() then
      return 'Raising a ' || (b.levels + 1) || nth(b.levels + 1) || ' storey over '
          || lower(under.name) || ' takes ' || under.skill || ' '
          || (b.levels * storey_skill()) || '. You have '
          || to_char(skill_of(p_world, p_uid, under.skill), 'FM990.0') || '.';
    end if;
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
    if next_material(p_world, p_uid, f.material, f.needed, tx, ty) is null then
      return 'You need ' || bill_text(f.material, f.needed) || '.';
    end if;
    return null;

  elsif p_action in ('paint_wall', 'strip_wall_paint') then
    if side is null then return 'Choose a side.'; end if;
    w := wall_at(p_world, tx, ty, side);
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
    lvl := work_level(p_world, b.id);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return 'There is no floor here.'; end if;
    if not bill_done(f.needed) then return 'Finish it before you paint it.'; end if;
    pot := pick_dye(p_world, p_uid);
    if pot.id is null then return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.'; end if;
    select * into colour from dye_def where name = pot.extra;
    if f.dye = colour.id then return 'It is ' || colour.word || ' already.'; end if;
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

CREATE OR REPLACE FUNCTION public.perform_building(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare shape text; pot item; colour dye_def; tx int; ty int; side text; b building; w wall; f floor_tile; mat build_material_def;
        wt wall_type_def; lvl int; kind text; used text; nm text;
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
    used := next_material(p_world, p_uid, w.material, w.needed, tx, ty);
    if used is null or not take_material(p_world, p_uid, used, tx, ty) then return; end if;
    bill := jsonb_set(w.needed, array[used], to_jsonb((w.needed->>used)::int - 1));
    update wall set needed = bill where world_id = w.world_id and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, mat.skill, 0.4);
    select * into wt from wall_type_def where id = w.type;
    if bill_done(bill) then
      what := case when wt.low then lower(wt.name) else 'wall' end;
      perform tell(p_world, p_uid, 'You finish the ' || lower(mat.name) || ' ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You fit ' || material_name(used, 1) || ' into the wall. Still needed: '
        || bill_text(w.material, bill) || '.', 'event');
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
    /*
     * A building has one roof, so the first tile of it decides the shape and
     * the rest follow. Changing your mind means taking the roof off, which is
     * what changing your mind about a roof means anywhere.
     */
    if kind = 'roof' and (select roof from building where world_id = p_world and id = b.id) is null then
      update building set roof = coalesce(
          (select id from roof_shape_def where id = p_target->>'roofShape'), 'hip')
        where world_id = p_world and id = b.id;
    end if;
    shape := roof_shape_of(p_world, b.id);
    bill := floor_bill(mat.id, kind, shape);
    insert into floor_tile (world_id, level, x, y, building, material, kind, facing, needed, total, planned_by)
    values (p_world, lvl, tx, ty, b.id, mat.id, kind,
            case when kind in ('stairs', 'ladder') then side end, bill, bill, p_uid);
    perform tell(p_world, p_uid, 'You plan a '
      || case when kind = 'ladder' then 'ladder'
              else case when kind = 'roof'
                        then lower((select name from roof_shape_def where id = shape)) || ' ' else '' end
                   || lower(mat.name) || ' ' || floor_kind_name(kind) end
      || '. It needs ' || bill_text(mat.id, bill) || '.', 'event');

  elsif p_action = 'build_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found or bill_done(f.needed) then return; end if;
    select * into mat from build_material_def where id = f.material;
    used := next_material(p_world, p_uid, f.material, f.needed, tx, ty);
    if used is null or not take_material(p_world, p_uid, used, tx, ty) then return; end if;
    bill := jsonb_set(f.needed, array[used], to_jsonb((f.needed->>used)::int - 1));
    update floor_tile set needed = bill where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Floors are paving; stairs, ladders and roofs are carpentry or masonry by material.
    sk := case f.kind when 'floor' then 'paving' when 'ladder' then 'carpentry'
                      else coalesce(mat.skill, 'carpentry') end;
    perform skill_raise(p_world, p_uid, sk, 0.4);
    what := case when f.kind = 'ladder' then 'ladder' else lower(mat.name) || ' ' || floor_kind_name(f.kind) end;
    if bill_done(bill) then
      perform tell(p_world, p_uid, 'You finish the ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You work ' || material_name(used, 1) || ' into the '
        || floor_kind_name(f.kind) || '. Still needed: ' || bill_text(f.material, bill) || '.', 'event');
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

  elsif p_action = 'paint_wall' then
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null then return; end if;
    pot := pick_dye(p_world, p_uid);
    select * into colour from dye_def where name = pot.extra;
    if colour.id is null or not consume(p_world, p_uid, 'dye', 1) then return; end if;
    update wall set dye = colour.id where world_id = p_world and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You brush the ' || lower(colour.name) || ' over the wall on the '
      || side_name(side) || ' side. It comes up ' || colour.word || '.', 'event');

  elsif p_action = 'strip_wall_paint' then
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null or w.dye is null then return; end if;
    select * into pot from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'lye_bucket' order by id limit 1;
    if pot.id is null or not consume(p_world, p_uid, 'lye_bucket', 1) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, pot.ql);
    update wall set dye = null where world_id = p_world and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.2);
    select * into mat from build_material_def where id = w.material;
    perform tell(p_world, p_uid, 'You scrub the wall back to bare '
      || coalesce(lower(mat.name), 'stone') || '.', 'event');

  elsif p_action = 'paint_floor' then
    if b.id is null then return; end if;
    lvl := work_level(p_world, b.id);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    pot := pick_dye(p_world, p_uid);
    select * into colour from dye_def where name = pot.extra;
    if colour.id is null or not consume(p_world, p_uid, 'dye', 1) then return; end if;
    update floor_tile set dye = colour.id where world_id = p_world and level = lvl and x = tx and y = ty;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work the ' || lower(colour.name)
      || ' into the boards. The floor comes up ' || colour.word || '.', 'event');

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return; end if;
    update building set levels = levels - 1, work_level = levels - 2
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, b.name || ' is back to '
      || case when b.levels = 1 then 'a single storey' else b.levels || ' storeys' end || '.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.bridge_reason(p_world uuid, p_kind text, p_ax integer, p_ay integer, p_bx integer, p_by integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare d bridge_def; n int; ha double precision; hb double precision; h int; r record; e record;
        la int; lb int;
begin
  select * into d from bridge_def where id = p_kind;
  if not found then return 'Choose what to build it out of.'; end if;
  if not in_bounds(p_world, p_ax, p_ay) or not in_bounds(p_world, p_bx, p_by) then return 'Not there.'; end if;
  if p_ax <> p_bx and p_ay <> p_by then
    return 'A bridge runs straight. Pick an end level with this one, north, south, east or west.';
  end if;
  select count(*)::int into n from span_tiles(p_ax, p_ay, p_bx, p_by);
  if n = 0 then return 'There is nothing between those two. Bridge a gap.'; end if;
  if n > d.span then
    return 'A ' || lower(d.name) || ' spans ' || d.span || ' tiles; that is ' || n || '.';
  end if;
  /*
   * And what each end lands on: a bank, a poured slab, or a finished floor of
   * a building — which is the new one, and the reason anybody builds a tower
   * and then wishes they had not.
   */
  la := top_deck(p_world, p_ax, p_ay);
  lb := top_deck(p_world, p_bx, p_by);
  for e in select * from (values (p_ax, p_ay, la), (p_bx, p_by, lb)) v(x, y, lvl) loop
    -- The bank of a ravine always shares a corner with the ravine, so what
    -- matters is whether you can stand in the middle of the tile, not whether
    -- every corner of it is dry.
    if e.lvl = 0 and slab_at(p_world, e.x, e.y) is null
       and (not passable(p_world, e.x, e.y) or centre_height(p_world, e.x, e.y) < 0) then
      return 'Both ends want dry, solid ground to stand on.';
    end if;
    if bridge_at(p_world, e.x, e.y) is not null then return 'One end is already under a bridge.'; end if;
  end loop;
  if la <> lb then
    return 'One end is on ' || case when la = 0 then 'the ground' else 'storey ' || (la + 1) end
        || ' and the other on ' || case when lb = 0 then 'the ground' else 'storey ' || (lb + 1) end
        || '. A deck meets one storey or the other.';
  end if;
  ha := deck_height(p_world, p_ax, p_ay);
  hb := deck_height(p_world, p_bx, p_by);
  if abs(ha - hb) > end_slop() then
    return 'The two ends are ' || to_char(abs(ha - hb), 'FM990')
      || ' apart in height. One deck will not meet both; level one of them.';
  end if;
  h := round((ha + hb) / 2);
  for r in select * from span_tiles(p_ax, p_ay, p_bx, p_by) loop
    if bridge_at(p_world, r.x, r.y) is not null then return 'Something is already bridged across there.'; end if;
    if building_at(p_world, r.x, r.y) is not null then return 'Not over a building.'; end if;
    if h - surface_height(p_world, r.x, r.y) < clearance() then return 'That is not a gap, it is ground. Walk it.'; end if;
  end loop;
  return null;
end $function$;

select private.lock_doors();
