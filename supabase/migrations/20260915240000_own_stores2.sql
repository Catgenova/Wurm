-- Whose crate, and whose building.
--
-- Named at the end of the last change as still tangled, and they were the two
-- plainest cases left. `crate` had no column saying whose it was at all, so
-- every crate on the island was everybody's: anybody could walk up to your
-- stores, empty them, pick the crate up and carry it off. `building` has had
-- `planned_by` since the day it was made and nothing has ever read it, so
-- anybody could rename your house, unpick its plan, or wall it up.
--
-- Neither was a hole somebody cut. Both are what a single-player game looks
-- like when the second player arrives: there was no one else to keep anything
-- from.
--
-- ## Yours, and what counts as yours
--
-- A crate is yours if you set it down, or if it stands on your settlement —
-- the second because a crate you were given, or that came with the deed, is
-- part of the place you hold. A building is yours if you planned it, or if it
-- stands on your settlement, for the same reason.
--
-- A crate nobody owns is anybody's, and that is deliberate: every crate that
-- already exists on the live island was set down before there was a column to
-- record it in, and a migration that guessed would be locking people out of
-- their own stores. The backfill below gives away only what it can be sure
-- of — a crate standing inside somebody's border is theirs — and leaves the
-- rest common ground. Every crate set down from here on has a name on it.

alter table crate add column if not exists made_by uuid;

-- What can be said for certain about the crates that are already out there.
update crate c set made_by = d.founded_by
  from deed d
 where c.made_by is null and c.world_id = d.world_id
   and abs(c.x - d.x) <= d.radius and abs(c.y - d.y) <= d.radius;

/**
 * Is this crate yours?
 *
 * `coalesce(made_by = p_uid, true)` rather than `made_by = p_uid`, because
 * null means a crate from before there was anywhere to write an owner and
 * nobody should lose their stores to a schema change.
 */
create or replace function crate_yours(p_world uuid, p_uid uuid, p_id int) returns boolean
  language sql stable as $$
  select coalesce(c.made_by = p_uid, true) or on_my_deed(p_world, p_uid, c.x, c.y)
    from crate c where c.world_id = p_world and c.id = p_id
$$;

/** And this building? Planned by you, or standing on ground you hold. */
create or replace function building_yours(p_world uuid, p_uid uuid, p_id int) returns boolean
  language sql stable as $$
  select coalesce(b.planned_by = p_uid, true)
      or exists (select 1 from building_tile t where t.world_id = p_world and t.building = p_id
                   and on_my_deed(p_world, p_uid, t.x, t.y))
    from building b where b.world_id = p_world and b.id = p_id
$$;

CREATE OR REPLACE FUNCTION public.perform_crate(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_p player; v_it item; v_c crate; v_tx int; v_ty int; v_sx int; v_sy int; v_new_id int;
        v_want int; v_names text[] := '{}'; v_r record; v_kind text;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    select * into v_it from item where id = (p_target->>'itemUid')::bigint;
    v_kind := crate_kind_of_item(v_it.def);
    if v_kind is null or not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    select coalesce(max(id), 0) + 1 into v_new_id from crate where world_id = p_world;
    insert into crate (world_id, id, kind, x, y, sx, sy, material, made_by)
    values (p_world, v_new_id, v_kind, v_tx, v_ty, v_sx, v_sy, v_it.extra, p_uid);
    select * into v_c from crate where world_id = p_world and id = v_new_id;
    perform tell(p_world, p_uid, 'You set the ' || lower(crate_name(v_c)) || ' down.', 'event');

  elsif p_action = 'pick_up_crate' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null or crate_units(p_world, v_c.id) > 0 then return; end if;
    delete from crate where world_id = p_world and id = v_c.id;
    perform give(p_world, p_uid, (select item from crate_def where crate_def.kind = v_c.kind), 1, 20, v_c.material);
    perform tell(p_world, p_uid, 'You pick up the '
      || lower((select name from crate_def where crate_def.kind = v_c.kind)) || '.'
      || case when v_c.deed then ' Deed workers will leave their finds by the token until a deed crate stands again.'
              else '' end, 'event');

  elsif p_action = 'crate_take_all' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return; end if;
    for v_r in select * from item where world_id = p_world and holder = 'crate' and crate = v_c.id order by id loop
      v_names := v_names || (case when v_r.count > 1 then v_r.count || ' × ' else '' end
        || lower((select coalesce(name, v_r.def) from item_def where id = v_r.def)));
      update item set holder = 'player', holder_uid = p_uid, crate = null, gx = null, gy = null
        where id = v_r.id;
    end loop;
    if array_length(v_names, 1) is null then return; end if;
    perform tell(p_world, p_uid, 'You take ' || array_to_string(v_names, ', ') || ' from the crate.', 'event');

  elsif p_action = 'store_in_crate' then
    v_c := nearest_crate(p_world, v_p.x, v_p.y);
    select * into v_it from item where id = (p_target->>'uid')::bigint;
    if v_c.id is null or not found then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if not crate_add(p_world, v_c.id, v_it.def, v_want, v_it.ql, v_it.extra) then
      perform tell(p_world, p_uid, 'The crate is full.', 'error');
      return;
    end if;
    if v_want >= v_it.count then delete from item where id = v_it.id;
    else update item set count = count - v_want where id = v_it.id; end if;
    perform tell(p_world, p_uid, 'You put ' || case when v_want > 1 then v_want || ' × ' else 'the ' end
      || lower((select coalesce(name, v_it.def) from item_def where id = v_it.def))
      || ' in the ' || lower((select name from crate_def where crate_def.kind = v_c.kind)) || '.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.place_deed_crate(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare d deed; spot record; new_id int;
begin
  select * into d from deed where world_id = p_world and founded_by = p_uid;
  if not found or (deed_crate(p_world, p_uid)).id is not null then return null; end if;
  select gx, gy into spot from (values (1, 0), (0, 1), (-1, 0), (0, -1), (1, 1)) as v(dx, dy),
    lateral (select d.x + v.dx as gx, d.y + v.dy as gy) q
  where in_bounds(p_world, q.gx, q.gy) and passable(p_world, q.gx, q.gy)
    and not has_water(p_world, q.gx, q.gy)
    and building_at(p_world, q.gx, q.gy) is null
    and not exists (select 1 from crate cr where cr.world_id = p_world and cr.x = q.gx and cr.y = q.gy)
  limit 1;
  if not found then return null; end if;
  select coalesce(max(id), 0) + 1 into new_id from crate where world_id = p_world;
  insert into crate (world_id, id, kind, x, y, sx, sy, deed, made_by)
  values (p_world, new_id, 'plank', spot.gx, spot.gy, 1, 1, true, p_uid);
  return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false))
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', coalesce((select jsonb_agg((to_jsonb(c) - 'world_id' - 'made_by')
        || jsonb_build_object('mine', crate_yours(p_world, me, c.id)) order by c.id)
      from crate c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true)
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        'mine', false, 'holder', account_name(d.founded_by)) order by d.founded_at)
      from deed d
      where d.world_id = p_world and d.founded_by <> me
        and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= p_range + d.radius),
      '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.crate_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_p player; v_it item; v_c crate; v_tx int; v_ty int; v_sx int; v_sy int; v_want int;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    if v_tx is null or v_sx is null or v_sy is null or p_target->>'itemUid' is null then
      return 'Choose a crate and a spot.';
    end if;
    select * into v_it from item where id = (p_target->>'itemUid')::bigint
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found or crate_kind_of_item(v_it.def) is null then return 'That is not a crate.'; end if;
    if not passable(p_world, v_tx, v_ty) or has_water(p_world, v_tx, v_ty) then
      return 'Crates need dry, open ground.';
    end if;
    if tile_slope(p_world, v_tx, v_ty) > 20 then return 'The ground is too steep for a crate to stand.'; end if;
    if (crate_at(p_world, v_tx, v_ty, v_sx, v_sy)).id is not null then return 'There is already a crate on that spot.'; end if;
    if is_token(p_world, v_tx, v_ty) then return 'Not on the token.'; end if;
    return null;

  elsif p_action in ('pick_up_crate', 'crate_take_all') then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return 'It is gone.'; end if;
    if not crate_yours(p_world, p_uid, v_c.id) then
      return 'The ' || lower(crate_name(v_c)) || ' is not yours.';
    end if;
    if sqrt((crate_centre_x(v_c) - v_p.x) ^ 2 + (crate_centre_y(v_c) - v_p.y) ^ 2) > 2.4 then
      return 'Stand next to the crate.';
    end if;
    if p_action = 'pick_up_crate' then
      return case when crate_units(p_world, v_c.id) > 0 then 'Empty it first.' end;
    end if;
    return case when crate_units(p_world, v_c.id) = 0 then 'The crate is empty.' end;

  elsif p_action = 'store_in_crate' then
    v_c := nearest_crate(p_world, v_p.x, v_p.y);
    if v_c.id is null then return 'Stand next to a crate.'; end if;
    -- Putting your things into somebody else's crate is a way of losing them.
    if not crate_yours(p_world, p_uid, v_c.id) then
      return 'The ' || lower(crate_name(v_c)) || ' is not yours to put anything in.';
    end if;
    select * into v_it from item where id = (p_target->>'uid')::bigint
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    if crate_kind_of_item(v_it.def) is not null then return 'A crate does not go in a crate.'; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if crate_units(p_world, v_c.id) + v_want > crate_capacity(v_c) then
      return 'The ' || lower(crate_name(v_c)) || ' is full.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.hands_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare it item; v_x int; v_y int; d action_def; p player;
begin
  if p_action in ('drop', 'examine_item', 'lock_item', 'unlock_item') then
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
      and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    if p_action = 'drop' then
      if it.def = 'dirt' then return 'Dirt goes back in a hole, not on the grass.'; end if;
      if it.locked then return 'You have set that aside. Put it back in the pack first.'; end if;
    elsif p_action = 'lock_item' and it.locked then
      return 'That is already set aside.';
    elsif p_action = 'unlock_item' and not it.locked then
      return 'That is not set aside.';
    end if;
    return null;
  end if;

  if p_action in ('pick_up', 'pick_up_all', 'examine') then
    v_x := (p_target->>'x')::int; v_y := (p_target->>'y')::int;
    if v_x is null or v_y is null then return 'There is nothing there.'; end if;
    if not in_bounds(p_world, v_x, v_y) then return 'That is off the edge of the world.'; end if;
    -- These three answer for their own reach, because the dispatcher sends a
    -- hands action here before it has asked how far away anything is.
    select * into d from action_def where id = p_action;
    select * into p from player where world_id = p_world and uid = p_uid;
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then
      return 'You are too far away from that.';
    end if;
    if p_action = 'pick_up' and not exists (select 1 from item i where i.world_id = p_world
         and i.holder = 'ground' and i.gx = v_x and i.gy = v_y) then
      return 'There is nothing there any more.';
    end if;
    if p_action = 'pick_up_all' and sweepable(p_world, v_x, v_y) = 0 then
      return 'There is nothing lying about here.';
    end if;
    return null;
  end if;

  if p_action = 'name_thing' then
    if p_target->>'kind' = 'crate' then
      if not crate_yours(p_world, p_uid, (p_target->>'id')::int) then
        return 'That is not yours to name.';
      end if;
      if not exists (select 1 from crate where world_id = p_world and id = (p_target->>'id')::int) then
        return 'That is not there any more.';
      end if;
    elsif p_target->>'kind' = 'furniture' then
      if not exists (select 1 from placed where world_id = p_world and id = (p_target->>'id')::bigint
                       and kind = 'furniture') then
        return 'That is not there any more.';
      end if;
    else
      return 'That is not something that takes a name.';
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
        w wall; f floor_tile; lvl int; kind text; tool text; other record;
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

select private.lock_doors();
