/*
 * And an altar stands on your own ground.
 *
 * Asked for, after `an_altar_goes_up_on_your_own_ground`: "restrict placing
 * altars to your settlement too". A piece whose building needs a settlement
 * of yours -- `recipe.deed` on its own recipe, `make_<piece>`, which is the
 * browser's `FurnitureDef.deed` crossed in the defs -- is set down only on
 * a tile of one: one you founded or one you are a citizen of, which is what
 * `on_my_deed` answers. It is the tile it is set down on that is asked, as
 * the browser asks it (`Game.furniturePlaceReason`), in the browser's words
 * (`DEED_PLACE`).
 *
 * An altar already standing somewhere else stays where it is, and may still
 * be turned; only setting one down is asked about.
 */
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.fire_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; n int; sub text; sz int[]; v_shut text;
begin
  -- Opening a creature crate, which is furniture standing on the ground.
  if p_action in ('crate_follow', 'crate_work') then
    return crate_open_refusal(p_world, p_uid, p_action, p_target);
  end if;
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
      -- A piece built only on a settlement of yours stands only on one: the same flag, off its own recipe.
      if exists (select 1 from recipe where id = 'make_' || sub and deed)
         and not on_my_deed(p_world, p_uid, (p_target->>'x')::int, (p_target->>'y')::int) then
        return 'You can only set this down on a settlement of yours.';
      end if;
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
    -- From what is at hand: the pack, a bag, or a store within reach.
    select i.* into it from craft_stock(p_world, p_uid, target_item(p_target)) s join item i on i.id = s.id
      where (s.id = target_item(p_target) or fuel_value(s.def) is not null)
      order by (s.id = target_item(p_target)) desc, s.draw limit 1;
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
    if exists (select 1 from player r where r.world_id = p_world and r.aboard = p.id) then
      return 'There are people aboard her.';
    end if;
    if crates_on_rack(p_world, p.id) > 0 then return 'Take the crates off it first.'; end if;
    return furniture_turn_reason(p);
  elsif p_action in ('take_apart_campfire', 'pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    if placed_lit(p) then return 'Put it out first.'; end if;
    if p_action = 'pick_up_furniture' then
      -- Locked, it stays where it is: lifting a ship or a cart and setting it
      -- down somewhere else is taking it, padlock and all.
      v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
      if v_shut is not null then return v_shut; end if;
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
      -- A crate with somebody else's wildermon in it is theirs to carry off.
      if p.creature is not null and exists (select 1 from creature q where q.world_id = p_world
            and q.id = p.creature and q.mode = 'stored' and q.keeper is distinct from p_uid) then
        return (select q.name from creature q where q.world_id = p_world and q.id = p.creature)
          || ' is not yours to carry off.';
      end if;
      if p.puller is not null then return 'Let go of it first.'; end if;
      if team_size(p_world, p.id) > 0 then return 'Unhitch the team first.'; end if;
      if p.driver is not null then return 'Get down off it first.'; end if;
      if exists (select 1 from player r where r.world_id = p_world and r.aboard = p.id) then
        return 'There are people aboard her.';
      end if;
    end if;
  end if;
  return null;
end $function$;

select private.lock_doors();
