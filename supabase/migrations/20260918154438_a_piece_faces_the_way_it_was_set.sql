-- A piece faces the way it was set, and turns
--
-- Asked for. A piece of furniture is drawn with one face, and that face was
-- always turned to the viewer: turn the view and every piece turned with it.
-- A piece has a facing now, one of the four sides, chosen while it is being
-- set down and kept on its row (`placed.facing`), and the browser draws it
-- the way it stands however the view is turned. A piece standing across the
-- tile takes its width and depth swapped, which every reading of a footprint
-- here goes through `placed_size` with the facing to get. And a standing
-- piece turns in place a quarter at a time (`turn_furniture`, ten seconds),
-- walked to the nearest spot the turned block fits and refused when
-- something is in its way, in the browser's words.
--
-- Stairs and ladders had a side already (`floor_tile.facing`), chosen by the
-- browser; only the choosing changed there, and the island reads it as before.

alter table placed add column if not exists facing text not null default 's';
do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'placed_facing_check') then
    alter table placed add constraint placed_facing_check check (facing in ('n', 'e', 's', 'w'));
  end if;
end $do$;

/** The facing a quarter turn away: to the right for +1, to the left for -1. South, west, north, east, round. */
create or replace function turned_facing(p_facing text, p_step integer) returns text language sql immutable as $fn$
  select (array['s', 'w', 'n', 'e'])[((((array_position(array['s', 'w', 'n', 'e'], coalesce(p_facing, 's')) - 1 + p_step) % 4) + 4) % 4) + 1]
$fn$;

/** The block a placed thing covers, its width and depth swapped when it stands across the tile. */
create or replace function placed_size(p_kind text, p_sub text, p_facing text) returns integer[] language sql stable as $fn$
  select case when p_facing in ('e', 'w')
    then array[(placed_size(p_kind, p_sub))[2], (placed_size(p_kind, p_sub))[1]]
    else placed_size(p_kind, p_sub) end
$fn$;

/** Whether a block of spots on a tile has anything standing in it: a placed thing, leaving out one, or a crate. */
create or replace function block_taken(p_world uuid, p_x integer, p_y integer, p_sx integer, p_sy integer, p_w integer, p_h integer, p_except bigint default null)
  returns boolean language sql stable as $fn$
  select exists (select 1 from placed o
                 where o.world_id = p_world and o.x = p_x and o.y = p_y and o.id is distinct from p_except
                   and o.sx < p_sx + p_w and o.sx + (placed_size(o.kind, o.sub, o.facing))[1] > p_sx
                   and o.sy < p_sy + p_h and o.sy + (placed_size(o.kind, o.sub, o.facing))[2] > p_sy)
      or exists (select 1 from crate c
                 where c.world_id = p_world and c.x = p_x and c.y = p_y
                   and c.sx >= p_sx and c.sx < p_sx + p_w and c.sy >= p_sy and c.sy < p_sy + p_h)
$fn$;

/** Why a piece cannot turn a quarter to the right where it stands, or null. */
create or replace function furniture_turn_reason(p placed) returns text language plpgsql stable as $fn$
declare f text; sz int[]; ax int; ay int;
begin
  f := turned_facing(p.facing, 1);
  sz := placed_size(p.kind, p.sub, f);
  ax := least(subtiles() - sz[1], greatest(0, p.sx));
  ay := least(subtiles() - sz[2], greatest(0, p.sy));
  if ax < 0 or ay < 0 then return 'It would not fit turned that way.'; end if;
  if block_taken(p.world_id, p.x, p.y, ax, ay, sz[1], sz[2], p.id) then
    return 'Something is in the way of turning it.';
  end if;
  return null;
end $fn$;

CREATE OR REPLACE FUNCTION public.fire_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in (
    'build_campfire', 'light_campfire', 'put_out_campfire', 'fuel_campfire',
    'take_ashes_fire', 'take_apart_campfire',
    'place_smelter', 'pick_up_smelter', 'light_smelter', 'fuel_smelter',
    'damp_smelter', 'take_ashes_smelter',
    'place_kiln', 'pick_up_kiln', 'light_kiln', 'fuel_kiln',
    'damp_kiln', 'take_ashes_kiln',
    'place_furniture', 'pick_up_furniture', 'turn_furniture')
$function$

;

CREATE OR REPLACE FUNCTION public.fire_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; n int; sub text; sz int[];
begin
  if p_action = 'build_campfire' then
    if p_target->>'sx' is null or p_target->>'sy' is null then return 'Choose a spot.'; end if;
    if pack_count(p_world, p_uid, 'shaft') < 2 then return 'A campfire takes 2 shafts.'; end if;
    return null;
  end if;

  if p_action in ('place_smelter', 'place_furniture', 'place_kiln') then
    select * into it from item
      where id = target_item(p_target) and world_id = p_world
        and holder = 'player' and holder_uid = p_uid;
    if not found then return 'You are not carrying that.'; end if;
    if p_action = 'place_smelter' and it.def <> 'smelter' then return 'That is not a smelter.'; end if;
    if p_action = 'place_kiln' and it.def <> 'kiln' then return 'That is not a kiln.'; end if;
    if p_action = 'place_furniture' then
      sub := replace(it.def, 'furniture_', '');
      if not exists (select 1 from furniture_def where id = sub) then return 'That is not something you can set down.'; end if;
    end if;
    -- And the block of spots it would take, which used to be the browser's to refuse alone.
    sz := placed_size(case p_action when 'place_smelter' then 'smelter' when 'place_kiln' then 'kiln' else 'furniture' end, sub,
                      case when p_target->>'facing' in ('n', 'e', 's', 'w') then p_target->>'facing' else 's' end);
    if block_taken(p_world, (p_target->>'x')::int, (p_target->>'y')::int,
                   least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0))),
                   least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0))), sz[1], sz[2]) then
      return 'Something is already standing there.';
    end if;
    return null;
  end if;

  p := target_placed(p_world, p_target);
  if p.id is null then return 'It is gone.'; end if;
  if not placed_in_reach(p_world, p_uid, p.id) then
    return 'Stand next to the ' || coalesce(p.sub, p.kind) || '.';
  end if;

  if p_action in ('light_campfire', 'light_smelter', 'light_kiln') then
    if placed_lit(p) then return 'It is already burning.'; end if;
    if placed_fuel(p) <= 0 then return 'There is nothing left to burn. Feed it some wood.'; end if;
  elsif p_action in ('put_out_campfire', 'damp_smelter', 'damp_kiln') then
    if not placed_lit(p) then return 'It is not burning.'; end if;
  elsif p_action in ('fuel_campfire', 'fuel_smelter', 'fuel_kiln') then
    select * into it from item
      where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and (id = target_item(p_target) or fuel_value(def) is not null)
      order by (id = target_item(p_target)) desc limit 1;
    if not found or fuel_value(it.def) is null then
      return 'Fires take ' || fuel_said() || '.';
    end if;
    if placed_fuel(p) >= fire_capacity() then return 'It is already piled as high as it will take.'; end if;
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter', 'take_ashes_kiln') then
    if floor(placed_ash(p)) < 1 then return 'There are no ashes worth taking yet.'; end if;
  elsif p_action = 'turn_furniture' then
    if p.kind <> 'furniture' then return 'Only furniture turns.'; end if;
    if placed_lit(p) then return 'Put it out first.'; end if;
    if p.puller is not null then return 'Let go of it first.'; end if;
    if p.driver is not null then return 'Get down off it first.'; end if;
    if crates_on_rack(p_world, p.id) > 0 then return 'Take the crates off it first.'; end if;
    return furniture_turn_reason(p);
  elsif p_action in ('take_apart_campfire', 'pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    if placed_lit(p) then return 'Put it out first.'; end if;
    if p_action = 'pick_up_furniture' then
      -- What is inside it, and what is in front of it.
      if exists (select 1 from item i where i.holder = 'furniture' and i.placed = p.id) then
        return 'Empty it first.';
      end if;
      -- A rack holds nothing of its own, so the check above passes however
      -- loaded it is: what stands on it are crates of somebody else's, and
      -- lifting the rack out from under them would leave them in the air.
      if crates_on_rack(p_world, p.id) > 0 then
        return 'Take the ' || case when crates_on_rack(p_world, p.id) = 1 then 'crate'
                                   else crates_on_rack(p_world, p.id) || ' crates' end || ' off it first.';
      end if;
      if placed_litres(p) > 0 then return 'Empty it out first.'; end if;
      if p.puller is not null then return 'Let go of it first.'; end if;
      if team_size(p_world, p.id) > 0 then return 'Unhitch the team first.'; end if;
      if p.driver is not null then return 'Get down off it first.'; end if;
    end if;
  end if;
  return null;
end $function$

;

CREATE OR REPLACE FUNCTION public.perform_fire(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; sz int[]; ax int; ay int; per double precision; room double precision;
        fits int; whole int; sub text; made bigint; back text;
begin
  if p_action = 'build_campfire' then
    ax := least(subtiles() - 2, greatest(0, (p_target->>'sx')::int));
    ay := least(subtiles() - 2, greatest(0, (p_target->>'sy')::int));
    if not consume(p_world, p_uid, 'shaft', 2) then return; end if;
    insert into placed (world_id, kind, x, y, sx, sy, cx, cy, fuel, made_by)
    values (p_world, 'campfire', (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + 1.0) / subtiles(), (p_target->>'y')::int + (ay + 1.0) / subtiles(),
            120, p_uid);
    perform tell(p_world, p_uid, 'You lay a campfire from 2 shafts. Light it, or feed it more wood first.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  if p_action in ('place_smelter', 'place_furniture', 'place_kiln') then
    select * into it from item where id = target_item(p_target);
    sub := case when p_action = 'place_furniture' then replace(it.def, 'furniture_', '') end;
    -- Which way it faces, which is the browser's to say and south when it says nothing.
    back := case when p_target->>'facing' in ('n', 'e', 's', 'w') then p_target->>'facing' else 's' end;
    sz := placed_size(case p_action when 'place_smelter' then 'smelter'
                                    when 'place_kiln' then 'kiln' else 'furniture' end, sub, back);
    ax := least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0)));
    ay := least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, facing)
    values (p_world, case p_action when 'place_smelter' then 'smelter'
                                   when 'place_kiln' then 'kiln' else 'furniture' end, sub,
            (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + sz[1] / 2.0) / subtiles(),
            (p_target->>'y')::int + (ay + sz[2] / 2.0) / subtiles(),
            it.ql, p_uid, back)
    returning id into made;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' ||
      lower(coalesce((select name from furniture_def where id = sub),
        case when p_action = 'place_kiln' then 'kiln' else 'smelter' end)) || ' down.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  perform placed_settle(nullif(p_target->>'id', '')::bigint);
  p := target_placed(p_world, p_target);
  if p.id is null then return; end if;

  if p_action in ('light_campfire', 'light_smelter', 'light_kiln') then
    update placed set lit = true, since = now() where id = p.id;
    if p_action = 'light_campfire' then perform journal_note(p_world, p_uid, 'fire'); end if;
    perform tell(p_world, p_uid, 'The kindling catches and the ' || p.kind || ' burns. It has '
      || burns_for(p.fuel) || ' of fuel.', 'event');
  elsif p_action in ('put_out_campfire', 'damp_smelter', 'damp_kiln') then
    update placed set lit = false, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You smother the fire. The wood is saved for later.', 'event');
  elsif p_action in ('fuel_campfire', 'fuel_smelter', 'fuel_kiln') then
    select * into it from item
      where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and (id = target_item(p_target) or fuel_value(def) is not null)
      order by (id = target_item(p_target)) desc limit 1;
    per := fuel_value(it.def);
    room := greatest(0, fire_capacity() - p.fuel);
    fits := greatest(1, least(it.count, ceil(room / per)::int));
    if not consume(p_world, p_uid, it.def, fits, it.id) then return; end if;
    update placed set fuel = least(fire_capacity(), p.fuel + per * fits), since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You feed ' || case when fits > 1 then fits || ' × ' else 'a ' end
      || lower((select name from item_def where id = it.def)) || ' to the fire. '
      || burns_for(least(fire_capacity(), p.fuel + per * fits)) || ' of fuel.', 'event');
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter', 'take_ashes_kiln') then
    whole := floor(p.ash)::int;
    update placed set ash = p.ash - whole, since = now() where id = p.id;
    perform give(p_world, p_uid, 'ash', whole, 20);
    perform tell(p_world, p_uid, 'You rake ' || whole || case when whole = 1 then ' lot' else ' lots' end
      || ' of ashes out of the ' || p.kind || '. (QL 20)', 'event');
  elsif p_action = 'take_apart_campfire' then
    -- Coal burns but is never got back, so a pile of logs cannot be turned
    -- into coal by rebuilding the fire.
    delete from placed where id = p.id;
    perform give(p_world, p_uid, 'shaft', 2, 20);
    perform tell(p_world, p_uid, 'You take the campfire apart and save what will burn again.', 'event');
    perform land_announce(p_world, p.x, p.y);
  elsif p_action = 'turn_furniture' then
    -- A quarter turn to the right, walked to the nearest spot the turned block fits.
    back := turned_facing(p.facing, 1);
    sz := placed_size(p.kind, p.sub, back);
    ax := least(subtiles() - sz[1], greatest(0, p.sx));
    ay := least(subtiles() - sz[2], greatest(0, p.sy));
    update placed set facing = back, sx = ax, sy = ay,
        cx = p.x + (ax + sz[1] / 2.0) / subtiles(), cy = p.y + (ay + sz[2] / 2.0) / subtiles()
      where id = p.id;
    perform tell(p_world, p_uid, 'You turn the ' || lower(placed_name(p)) || ' to face ' || side_name(back) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);

  elsif p_action in ('pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    back := case p.kind when 'smelter' then 'smelter' when 'kiln' then 'kiln'
                        else 'furniture_' || p.sub end;
    delete from placed where id = p.id;
    perform give(p_world, p_uid, back, 1, p.ql);
    perform tell(p_world, p_uid, 'You take up the ' || lower(coalesce(p.sub, p.kind)) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$

;

CREATE OR REPLACE FUNCTION public.anvil_place_reason(p_world uuid, p_x integer, p_y integer, p_sx integer, p_sy integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
begin
  if not in_bounds(p_world, p_x, p_y) then return 'That is off the edge of the world.'; end if;
  if has_water(p_world, p_x, p_y) then return 'Not in the water.'; end if;
  if exists (select 1 from placed pl where pl.world_id = p_world and pl.x = p_x and pl.y = p_y
               and pl.sx < p_sx + anvil_subtiles() and pl.sx + (placed_size(pl.kind, pl.sub, pl.facing))[1] > p_sx
               and pl.sy < p_sy + anvil_subtiles() and pl.sy + (placed_size(pl.kind, pl.sub, pl.facing))[2] > p_sy) then
    return 'Something is already standing there.';
  end if;
  return null;
end $function$

;

-- A column was added to a table the API sees.
notify pgrst, 'reload schema';

select private.lock_doors();
