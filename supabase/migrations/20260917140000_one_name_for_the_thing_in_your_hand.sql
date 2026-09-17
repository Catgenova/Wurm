-- One name for the thing in your hand
--
-- Reported from the island: *"getting an error when trying to place a kiln
-- that it isn't in my inventory. It is."*
--
-- It was. The browser and the island have two names for the same thing, and
-- the kiln is where that finally showed.
--
-- A target says what an action is aimed at. When the aim is a *thing you are
-- carrying* — the food you feed a wildermon, the fuel you put on a fire, the
-- kiln you set down — the browser writes it under `itemUid`, because the
-- target itself is already a tile or a fire or a beast and `uid` is spoken
-- for. That is not a convention anybody agreed to; it is in the type:
--
--     { kind: 'tile';   ...;  itemUid?: number }
--     { kind: 'kiln';   id;   itemUid?: number }
--     { kind: 'item';   uid }         <- here the thing IS the target
--     { kind: 'ground'; x; y; uid }   <- and here
--
-- The two are mutually exclusive by construction: no target the browser can
-- build carries both. But the island read `p_target->>'uid'` in sixty-five
-- places and `p_target->>'itemUid'` in five, and each rule had picked one
-- and stuck with it.
--
-- ## Why nothing caught it
--
-- Because the measurements ask in the island's own words. Number 231 has
-- been setting a kiln down since the day kilns landed:
--
--     act_refusal(w, me, 'place_kiln', '{"kind":"tile",...,"uid":' || kit || '}')
--
-- It passes. It has always passed. And it says nothing at all about the ask
-- the browser actually makes, because the test wrote the ask itself. A rule
-- checked only through a door the test built for it is a rule nobody has
-- checked.
--
-- ## What was broken, and what was quietly wrong
--
-- Three refused outright, having looked under `uid` and found nothing:
--
--     place_kiln, place_smelter, place_furniture   "You are not carrying that."
--
-- The rest had a fallback, which is worse, because a fallback hides it.
-- `place_anvil` takes the anvil you named *or* any anvil in your pack, so it
-- worked — while silently ignoring which one you picked, and anvils have
-- quality. `fuel_campfire`, `fuel_smelter` and `fuel_kiln` do the same with
-- fuel: choose a plank and they burn whatever turns up first. That one has
-- been on show the whole time. Measurement 236, every run:
--
--     You feed 2 x shaft to the fire.
--
-- Two lines above it, the suite hands the player six pine logs to fire the
-- kiln with. It fed the shafts left over from a campfire two hundred
-- measurements earlier, because nothing said which, because the way to say
-- which was a name the island did not read.
--
-- ## So: one name, asked in one place
--
-- `target_item()` is the whole of it — `itemUid` if the target has one, `uid`
-- otherwise — and every rule that meant "the thing in your hand" now asks it
-- rather than reaching into the json itself. Both names still answer, so a
-- job already queued on a live island still settles and nothing written the
-- island's way stops working.
--
-- Seventy sites across thirty-seven rules, which is the point of doing it
-- this way round: this was never a kiln bug. It was one mismatch with
-- thirty-seven chances to bite, and it had already taken seven of them.

/**
 * Which thing you are carrying a target names, whichever way it was asked.
 *
 * `itemUid` when the target is something else — a tile, a fire, a beast —
 * and the item is what the action uses on it. `uid` when the item is itself
 * the target. Never both, so the order settles nothing; it is written this
 * way round because `itemUid` is the one that says what it means.
 */
create or replace function target_item(p_target jsonb) returns bigint
  language sql immutable as $fn$
  select nullif(coalesce(p_target->>'itemUid', p_target->>'uid'), '')::bigint
$fn$;

-- act_refusal_rules (1)
CREATE OR REPLACE FUNCTION public.act_refusal_rules(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d action_def; p player; cx int; cy int; tx int; ty int; t tile_def; aimed text;
begin
  select * into d from action_def where id = p_action;
  if not found then return 'There is no such thing as ' || p_action || '.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  -- Deliberately not "are you busy": asked of queued jobs too. That is rpc_act's.
  if not act_ported(p_action) then
    return 'You cannot ' || lower(d.label) || ' on this island yet.';
  end if;

  aimed := p_target->>'kind';
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- The last ten answer for their own reach, every one of them: a bridge is
  -- worked from either bank, a bed is furniture, and a beast is not at a tile.
  -- First of all, because a map is an item and every other family that takes
  -- an item wants one it can name a use for. This one is aimed at the map.
  if treasure_action(p_action) then
    return treasure_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if last_action(p_action) then
    return last_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the only family that does not care what it is
  -- pointed at: a prayer wants an altar, a cast wants a name, and the other
  -- three want nothing but the ground you are sitting on.
  if faith_action(p_action) then
    return faith_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the ones asked of a beast, which is not at a
  -- tile, and half of a cart, which is furniture and would otherwise be handed
  -- to the code that lights fires. Both answer for their own reach.
  if ride_action(p_action) then
    return ride_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if hands_action(p_action) then
    return hands_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Before the one that lights fires, which is what pointing at furniture has
  -- meant up to now: a barrel is furniture too, and tipping it out is not a fire.
  if liquid_action(p_action) then
    return liquid_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Also before the one that lights fires: an oven is furniture and an anvil
  -- is pointed at the same way a kiln is, and neither wants that route.
  if forge_action(p_action) then
    return forge_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if holding_action(p_action) then
    return holding_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The token is under your feet and a post answers for its own reach, so
  -- neither wants the reach check below.
  if settlement_action(p_action) then
    return settlement_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if dig_action(p_action) then
    return dig_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A trap answers for its own reach, and rolls itself forward before it
  -- answers anything at all.
  if trap_action(p_action) then
    return trap_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Working the ground answers for its own reach for the same reason: a
  -- corner is a place rather than a thing, and `drop_dirt` names one.
  if ground_action(p_action) then
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
    if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
      return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
    end if;
    return ground_refusal(p_world, p_uid, p_action, p_target);
  end if;
  /*
   * A furnace is brought up to date before anything asks it a question: its
   * fire and its queue together, so that "is anything finished" is answered
   * about now rather than about whenever somebody last stood here.
   */
  if aimed in ('smelter', 'kiln') then
    perform furnace_settle(p_world, nullif(p_target->>'id', '')::bigint);
  end if;
  if item_action(p_action) then
    return item_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if firing_action(p_action) then
    return firing_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if aimed in ('campfire', 'smelter', 'kiln', 'furniture', 'anvil') or fire_action(p_action) then
    return fire_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A crate is reached for rather than stood in front of, so it answers for
  -- its own reach the way the creatures do.
  if crate_action(p_action) then
    return crate_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The stake is in your hand and the ground is under your feet: nothing to reach for.
  if p_action = 'found_settlement' then
    return deed_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A creature is not at a tile, it is wherever its last leg left it, so the
  -- reach check below cannot answer for it. Both of these do their own; the
  -- fighting ones reach as far as what is in your hand, which is further.
  if creature_action(p_action) then
    return creature_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if fight_action(p_action) then
    return fight_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
  if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
  end if;
  if build_action(p_action) then
    return build_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble', 'drop_dirt_here') then
    return terrain_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    return gather_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
    return farm_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('fish', 'drag_net') then
    return fish_refusal(p_world, p_uid, p_action, p_target);
  end if;

  if exists (select 1 from recipe where id = p_action) then
    return craft_refusal(p_world, p_uid, p_action, target_item(p_target));
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    /*
     * The same depth a pick works to. This was the exact line `terrain_refusal`
     * condemns in its own comment — `<= 0` refuses a corner standing at the
     * waterline, where no water is drawn — and mining was fixed for it while
     * digging was left with it.
     */
    if land_height(p_world, cx, cy) < -mine_depth() then
      return 'The water is too deep here to work in.';
    end if;
    if land_dirt(p_world, cx, cy) <= 0 then
      return 'That corner is bare rock. Only a pickaxe will take it lower.';
    end if;
  end if;
  return null;
end $function$;

-- crate_refusal (4)
CREATE OR REPLACE FUNCTION public.crate_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_p player; v_it item; v_c crate; v_pl placed;
        v_tx int; v_ty int; v_sx int; v_sy int; v_want int;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    if v_tx is null or v_sx is null or v_sy is null or target_item(p_target) is null then
      return 'Choose a crate and a spot.';
    end if;
    select * into v_it from item where id = target_item(p_target)
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
    select * into v_it from item where id = target_item(p_target)
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    if crate_kind_of_item(v_it.def) is not null then return 'A crate does not go in a crate.'; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if crate_units(p_world, v_c.id) + v_want > crate_capacity(v_c) then
      return 'The ' || lower(crate_name(v_c)) || ' is full.';
    end if;
    return null;

  elsif p_action = 'take_from_store' then
    /*
     * Taking one thing out, which the island could not do until now.
     *
     * There has been a way to put a thing in and a way to take *everything*
     * out, and nothing in between — so the browser did the in-between itself,
     * moving the row from one window to the other in its own copy and never
     * telling anybody. On an island the next answer put it back, which is what
     * "it rubber bands from crate to inventory" was.
     */
    select * into v_it from item where id = target_item(p_target) and world_id = p_world;
    if not found or v_it.holder not in ('crate', 'furniture', 'bag') then return 'It is gone.'; end if;
    -- A bag is worn rather than stood next to, so there is nothing to walk to
    -- and the only question is whether it is on you.
    if v_it.holder = 'bag' then
      if (carried(p_world, p_uid, v_it.id)).id is null then return 'It is gone.'; end if;
      return null;
    end if;
    if v_it.holder = 'crate' then
      select * into v_c from crate where world_id = p_world and id = v_it.crate;
      if not found then return 'It is gone.'; end if;
      if sqrt((crate_centre_x(v_c) - v_p.x) ^ 2 + (crate_centre_y(v_c) - v_p.y) ^ 2) > 2.4 then
        return 'Stand next to the crate.';
      end if;
      if not crate_yours(p_world, p_uid, v_c.id) then
        return 'The ' || lower(crate_name(v_c)) || ' is not yours.';
      end if;
    else
      select * into v_pl from placed where id = v_it.placed and world_id = p_world;
      if not found then return 'It is gone.'; end if;
      if greatest(abs(v_pl.cx - v_p.x), abs(v_pl.cy - v_p.y)) > 2.4 then
        return 'Stand next to the ' || lower(placed_name(v_pl)) || '.';
      end if;
    end if;
    return null;
  end if;
  return null;
end $function$;

-- dig_refusal (1)
CREATE OR REPLACE FUNCTION public.dig_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; t tile_def; it item; v_relic text; v_missing int[]; r relic_def;
begin
  if p_action = 'investigate' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    if tx is null or not in_bounds(p_world, tx, ty) then return 'There is nothing there.'; end if;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if not t.diggable then return 'There is nothing to go through here.'; end if;
    if has_water(p_world, tx, ty) then return 'Not under water.'; end if;
    if pack_count(p_world, p_uid, 'trowel') < 1 then
      return 'You need a trowel to go through the soil carefully.';
    end if;
    if is_foraged(p_world, tx, ty, 'dig') then
      return 'You have been over this ground already. Try somewhere else.';
    end if;
    return null;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target)
    and holder = 'player' and holder_uid = p_uid;
  if not found then return 'It is gone.'; end if;

  if p_action = 'study_book' then
    if it.def <> 'book' then return 'That is not a book.'; end if;
    if it.dmg >= 90 then return 'The pages are too far gone to read. Repair it first.'; end if;
    return null;
  end if;

  -- Restoring.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if it.def <> 'fragment' or not found then return 'That is not a fragment of anything.'; end if;
  v_missing := parts_missing(p_world, p_uid, v_relic);
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    return 'You are missing ' || array_length(v_missing, 1) || ' of the ' || r.parts
      || ' pieces of the ' || r.name || ' (' || array_to_string(v_missing, ', ') || ').';
  end if;
  if exists (select 1 from pieces_held(p_world, p_uid, v_relic) h where h.dmg >= 85) then
    return 'One of the pieces is too far gone to join. Repair it first.';
  end if;
  return null;
end $function$;

-- faith_refusal (1)
CREATE OR REPLACE FUNCTION public.faith_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare p player; pc placed; rest double precision; med double precision;
        v_way text; v_step path_step;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'pray' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found or not is_altar(pc) then return 'It is gone.'; end if;
    if not near_piece(p_world, p_uid, pc) then return 'Kneel at the altar.'; end if;
    rest := prayer_rest() - extract(epoch from (now() - coalesce(p.prayed_at, 'epoch')));
    if rest > 0 then
      return 'You have said what you had to say today. ' || ceil(rest / 60) || ' minutes.';
    end if;
    return null;

  elsif p_action = 'cast' then
    return cast_reason(p_world, p_uid, p_target->>'spell', target_item(p_target));

  elsif p_action = 'meditate' then
    if pack_count(p_world, p_uid, 'rug') <= 0 then return 'You need a rug to sit on.'; end if;
    rest := sit_rest() - extract(epoch from (now() - coalesce(p.sat_at, 'epoch')));
    if rest > 0 then
      return 'You have sat today and got what there was to get. ' || ceil(rest / 60) || ' minutes.';
    end if;
    return null;

  elsif p_action = 'choose_path' then
    if p.way is not null then
      return 'You have chosen, and it is not the sort of thing that is chosen twice.';
    end if;
    med := skill_of(p_world, p_uid, meditation_skill());
    if med < choose_at() then
      return 'Sit until you have ' || round(choose_at()) || ' meditation behind you.';
    end if;
    v_way := p_target->>'material';
    if v_way is null or not exists (select 1 from path_def where id = v_way) then
      return 'Choose one of the three.';
    end if;
    return null;

  elsif p_action = 'use_ability' then
    v_step := ability_of(p_world, p_uid, p_target->>'material');
    if v_step.path is null then return 'That is not something you know.'; end if;
    rest := v_step.rest - extract(epoch from (now()
      - coalesce((p.used_at->>v_step.ability)::timestamptz, 'epoch')));
    if rest > 0 then
      return v_step.name || ' again in ' || ceil(rest / 60) || ' minutes.';
    end if;
    return null;
  end if;
  return null;
end $function$;

-- farm_refusal (1)
CREATE OR REPLACE FUNCTION public.farm_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; here int; c crop; it item;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  -- Anything that reads a crop reads it up to date.
  perform crop_settle(p_world, tx, ty);
  select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;

  if p_action = 'till' then
    if not tillable(here) then return 'That ground will not rake into a field.'; end if;
    if land_height(p_world, tx, ty) < 0 or land_height(p_world, tx + 1, ty) < 0
       or land_height(p_world, tx + 1, ty + 1) < 0 or land_height(p_world, tx, ty + 1) < 0 then
      return 'You cannot till underwater.';
    end if;
    if tile_slope(p_world, tx, ty) > 20 then return 'The ground is too steep to work.'; end if;
  elsif p_action = 'plant_seed' then
    if here <> tile_id('Field') then return 'Sow on a tilled field.'; end if;
    if c.id is not null then return 'Something is already growing there.'; end if;
    select * into it from item
      where id = target_item(p_target) and world_id = p_world
        and holder = 'player' and holder_uid = p_uid;
    if not found or not exists (select 1 from crop_def where seed = it.def) then
      return 'Choose a seed to sow.';
    end if;
  elsif p_action = 'tend_crop' then
    if c.id is null then return 'Nothing is growing there.'; end if;
    if c.stage >= crop_ripe() then return 'It is ripe. Harvest it.'; end if;
    if c.tended_now then return 'You have already tended it at this stage. Wait for it to grow on.'; end if;
  elsif p_action = 'harvest_crop' then
    if c.id is null then return 'Nothing is growing there.'; end if;
    if c.stage < crop_ripe() then
      return 'It is only ' || crop_stage_name(c.stage) || '. Let it grow.';
    end if;
  elsif p_action = 'clear_field' then
    if here <> tile_id('Field') then return 'There is no field there.'; end if;
  end if;
  return null;
end $function$;

-- fight_refusal (1)
CREATE OR REPLACE FUNCTION public.fight_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare it item; c creature; d species_def; w weapon_def; bow weapon_def; dist double precision;
        p player; slot text; corpse item; hurt jsonb; use item;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action in ('equip', 'unequip') then
    select * into it from item where id = target_item(p_target)
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    slot := slot_of(it.def);
    if slot is null then return 'That is not worn or wielded.'; end if;
    if p_action = 'unequip' then
      return case when (p.equipped->>slot)::bigint is distinct from it.id
                  then 'You are not wearing that.' end;
    end if;
    if (p.equipped->>slot)::bigint = it.id then return 'You already have it on.'; end if;
    if slot = 'offhand' and two_handed_in_hand(p_world, p_uid) then
      return 'Both your hands are on your weapon.';
    end if;
    return null;

  elsif p_action in ('attack_creature', 'shoot_creature', 'treat_creature') then
    perform creature_settle(p_world, (p_target->>'id')::int);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is dead or gone.'; end if;
    select * into d from species_def where id = c.species;
    dist := (select sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2)
             from player pl where pl.world_id = p_world and pl.uid = p_uid);
    if p_action = 'attack_creature' then
      if c.mode <> 'wild' then return 'That one is tame. Release it first if you mean it.'; end if;
      if dist > melee_reach(p_world, p_uid) then return 'It is out of reach.'; end if;
      return null;
    elsif p_action = 'shoot_creature' then
      if c.mode <> 'wild' then return 'That one is tame. Release it first if you mean it.'; end if;
      select bw.* into bow from weapon_def bw where bw.id = (worn(p_world, p_uid, 'weapon')).def and bw.ammo is not null;
      if not found then return 'You have no bow in your hands.'; end if;
      if pack_count(p_world, p_uid, bow.ammo) <= 0 then return 'You are out of arrows.'; end if;
      if dist > coalesce(bow.range, 6) then
        return 'Too far for a ' || lower((select name from item_def where id = bow.id)) || '.';
      end if;
      if dist < 1.2 then return 'It is too close to draw on.'; end if;
      return null;
    else
      if c.mode = 'wild' then return 'It will not stand still for you while it is wild.'; end if;
      if c.health >= max_health(c) then return c.name || ' is not hurt.'; end if;
      if pack_count(p_world, p_uid, 'bandage') <= 0 then return 'You have no bandages. Cut some from cloth.'; end if;
      if dist > 1.9 then return 'You need to be beside it.'; end if;
      return null;
    end if;

  elsif p_action = 'butcher' then
    corpse := target_corpse(p_world, p_uid, p_target);
    if corpse.id is null then return 'There is nothing to butcher.'; end if;
    if (corpse_species(corpse.extra)).id is null then return 'You cannot make sense of this carcass.'; end if;
    return null;

  elsif p_action = 'bind_wound' then
    perform wounds_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid;
    hurt := worst_wound(p.wounds);
    if hurt is null then
      return case when coalesce((p.stats->>'health')::double precision, 1) >= 0.999
        then 'There is nothing wrong with you.' else 'Nothing is open. You are only tired and thin.' end;
    end if;
    if (hurt->>'infected')::boolean then
      return 'The ' || (select name from wound_kind_def where id = hurt->>'kind')
        || ' on your ' || part_name(hurt->>'part')
        || ' has gone bad. Clean it out before anything will hold on it.';
    end if;
    use := dressing_for(p_world, p_uid, hurt);
    if use.id is null then return 'You have nothing to dress it with.'; end if;
    return null;

  elsif p_action = 'clean_wound' then
    perform wounds_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid;
    if not exists (select 1 from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) x
                   where (x->>'infected')::boolean) then
      return 'Nothing on you has gone bad.';
    end if;
    if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then
      return 'You need a bucket of lye to clean it out with.';
    end if;
    return null;
  end if;
  return null;
end $function$;

-- fire_refusal (3)
CREATE OR REPLACE FUNCTION public.fire_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; n int; sub text;
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
      return 'Fires take wood and coal: shafts, thatch, planks, timbers, logs or coal.';
    end if;
    if placed_fuel(p) >= fire_capacity() then return 'It is already piled as high as it will take.'; end if;
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter', 'take_ashes_kiln') then
    if floor(placed_ash(p)) < 1 then return 'There are no ashes worth taking yet.'; end if;
  elsif p_action in ('take_apart_campfire', 'pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    if placed_lit(p) then return 'Put it out first.'; end if;
    if p_action = 'pick_up_furniture' then
      -- What is inside it, and what is in front of it.
      if exists (select 1 from item i where i.holder = 'furniture' and i.placed = p.id) then
        return 'Empty it first.';
      end if;
      if placed_litres(p) > 0 then return 'Empty it out first.'; end if;
      if p.puller is not null then return 'Let go of it first.'; end if;
      if team_size(p_world, p.id) > 0 then return 'Unhitch the team first.'; end if;
      if p.driver is not null then return 'Get down off it first.'; end if;
    end if;
  end if;
  return null;
end $function$;

-- firing_refusal (1)
CREATE OR REPLACE FUNCTION public.firing_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_p placed; v_it item; v_mould item; v_metal metal_def; v_need int;
begin
  perform furnace_settle(p_world, nullif(p_target->>'id', '')::bigint);
  v_p := target_placed(p_world, p_target);
  if v_p.id is null then return 'It is gone.'; end if;
  if not placed_in_reach(p_world, p_uid, v_p.id, 2.6) then
    return 'Stand next to the ' || v_p.kind || '.';
  end if;

  if p_action in ('smelter_take_all', 'kiln_take_all') then
    if jsonb_array_length(furnace_output(v_p)) = 0 then
      return case when p_action = 'kiln_take_all' then 'Nothing is fired yet.' else 'Nothing is finished yet.' end;
    end if;
    return null;
  end if;

  select * into v_it from item where id = target_item(p_target)
    and world_id = p_world and holder = 'player' and holder_uid = p_uid;

  if p_action = 'smelt_ore' then
    if not found or (metal_by_ore(v_it.def)).id is null then return 'Smelters take ore.'; end if;
    if jsonb_array_length(furnace_jobs(v_p)) >= furnace_capacity('smelter') then
      return 'The furnace is charged as full as it will go.';
    end if;
    return null;

  elsif p_action = 'load_kiln' then
    if not found then
      select * into v_it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and exists (select 1 from pottery_def where unfired = def) order by id limit 1;
    end if;
    if not found or not exists (select 1 from pottery_def where unfired = v_it.def) then
      return 'A kiln takes unfired clay.';
    end if;
    if jsonb_array_length(furnace_jobs(v_p)) >= furnace_capacity('kiln') then
      return 'The kiln is packed as full as it will go.';
    end if;
    return null;

  elsif p_action = 'cast_anvil' then
    if pack_count(p_world, p_uid, 'anvil_mould') <= 0 then return 'You need an anvil mould.'; end if;
    v_metal := metal_by_lump(v_it.def);
    if not found or v_metal.id is null then return 'Choose the metal to pour.'; end if;
    select lumps into v_need from mould_def where id = 'anvil_mould';
    if v_it.count < v_need then return 'An anvil takes ' || v_need || ' lumps.'; end if;
    return null;
  end if;
  return null;
end $function$;

-- forge_refusal (6)
CREATE OR REPLACE FUNCTION public.forge_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found or not is_oven(p) then return 'That is not an oven.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to the oven.'; end if;
    if p_action = 'fuel_oven' then
      select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and not locked and fuel_value(def) is not null
        and (target_item(p_target) is null or id = target_item(p_target))
        order by id limit 1;
      if not found then return 'Ovens take the same wood and coal a fire does.'; end if;
      if placed_fuel(p) >= hearth_capacity(p) then return 'It is packed as full as it will take.'; end if;
    elsif p_action = 'light_oven' then
      if placed_lit(p) then return 'It is already burning.'; end if;
      if placed_fuel(p) <= 0 then return 'There is nothing in the firebox. Feed it some wood.'; end if;
    elsif p_action = 'put_out_oven' then
      if not placed_lit(p) then return 'It is not burning.'; end if;
    elsif p_action = 'take_ashes_oven' then
      if floor(placed_ash(p)) < 1 then return 'There are no ashes worth taking yet.'; end if;
    end if;
    return null;
  end if;

  if p_action in ('candle_lantern', 'light_lantern', 'douse_lantern') then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if not found or not held_light(it.def) then return 'It is gone.'; end if;
    if p_action = 'candle_lantern' then
      if it.def <> 'lantern' then return 'Nothing goes in a torch.'; end if;
      if candle_left(it) > 0 then return 'There is still a candle in it.'; end if;
      if pack_count(p_world, p_uid, 'candle') < 1 then
        return 'You have no candles. Two are drawn from two beeswax and a yarn.';
      end if;
    elsif p_action = 'light_lantern' then
      if it.def = 'lantern' and candle_left(it) <= 0 then return 'There is no candle in it.'; end if;
      if it.lit then return 'It is already lit.'; end if;
      /*
       * The tinderbox is gone, and so is the hole it left.
       *
       * This check used to want one, faithfully, because the browser wanted
       * one — and there was no tinderbox in the browser either, so a lantern
       * could not be struck on either side of the port. That was the right
       * thing to *port* and the wrong thing to leave: a whole subsystem with
       * no way into it. The browser lights it at a fire now, and so does this.
       */
      if flame_near(p_world, p_uid, it.id) is null then
        return 'Nothing here is burning. Light it at a campfire, a kiln, a smelter or an oven — '
          || 'or off something already alight in your hand.';
      end if;
    elsif p_action = 'douse_lantern' then
      if not it.lit then return 'It is not lit.'; end if;
    end if;
    return null;
  end if;

  if p_action = 'place_anvil' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'anvil' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return 'You have no anvil to set down.'; end if;
    return anvil_place_reason(p_world, (p_target->>'x')::int, (p_target->>'y')::int,
      coalesce((p_target->>'sx')::int, 0), coalesce((p_target->>'sy')::int, 0));
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'anvil';
  if not found then return 'It is gone.'; end if;
  if p_action = 'pick_up_anvil' then return null; end if;

  -- Smithing.
  if not near_piece(p_world, p_uid, p) then return 'Stand at the anvil.'; end if;
  select * into v_mould from item where world_id = p_world
    and id = nullif(p_target->>'mould', '')::bigint
    and holder = 'player' and holder_uid = p_uid;
  if not found then return 'Choose a mould.'; end if;
  select * into d from mould_def where id = v_mould.def;
  if not found then return 'Choose a mould.'; end if;
  if d.makes = 'anvil' then return 'An anvil is cast in a smelter, not beaten out here.'; end if;
  v_lump := smith_lump(p_world, p_uid, target_item(p_target));
  if v_lump.id is null then return 'You have no metal to pour.'; end if;
  if v_lump.count < d.lumps then return 'That takes ' || d.lumps || ' lumps.'; end if;
  return null;
end $function$;

-- hands_refusal (1)
CREATE OR REPLACE FUNCTION public.hands_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare it item; v_x int; v_y int; d action_def; p player;
begin
  if p_action in ('drop', 'examine_item', 'lock_item', 'unlock_item') then
    select * into it from item where world_id = p_world and id = target_item(p_target)
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

-- holding_refusal (1)
CREATE OR REPLACE FUNCTION public.holding_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare it item; p placed; v_bag item; v_want int; v_why text; v_other placed;
begin
  if p_action in ('furniture_take_all') then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found then return 'It is gone.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to it.'; end if;
    if furniture_units(p) = 0 then return 'It is empty.'; end if;
    return null;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target)
    and holder = 'player' and holder_uid = p_uid;
  if not found then return 'It is gone.'; end if;
  v_want := greatest(1, least(coalesce((p_target->>'count')::int, 1), it.count));

  if p_action = 'stow_item' then
    if is_bag(it.def) then return 'One bag will not go inside another.'; end if;
    if (first_bag(p_world, p_uid, it.def, v_want)).id is null then
      return 'There is no bag with room for it.';
    end if;

  elsif p_action = 'empty_bag' then
    if not is_bag(it.def) then return 'That does not hold things.'; end if;
    if bag_units(it.id) = 0 then return 'There is nothing in it.'; end if;

  elsif p_action = 'store_in_furniture' then
    p := nearest_store(p_world, p_uid, it.def, v_want);
    if p.id is null then
      -- Say why the thing beside you will not take it, rather than that
      -- nothing will: standing at a barrel with a plank, "a barrel holds
      -- liquid and nothing else" is the answer somebody wanted.
      for v_other in select o.* from placed o
        where o.world_id = p_world and o.kind = 'furniture' and near_piece(p_world, p_uid, o, 2.6)
        order by furniture_capacity(o) desc, o.id
      loop
        v_why := furniture_refuses(v_other, it.def);
        if v_why is not null then return v_why; end if;
        if furniture_units(v_other) + v_want > furniture_capacity(v_other) then
          return 'The ' || lower(placed_name(v_other)) || ' is full.';
        end if;
      end loop;
      return 'Stand next to something that will take it.';
    end if;

  elsif p_action = 'throw_away' then
    p := trash_near(p_world, p_uid);
    if p.id is null then return 'There is no trash crate beside you.'; end if;
    if furniture_units(p) + v_want > furniture_capacity(p) then
      return 'The trash crate is full. Wait for it to rot down.';
    end if;
  end if;
  return null;
end $function$;

-- item_refusal (1)
CREATE OR REPLACE FUNCTION public.item_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_it item; v_what improvable_def; v_mat improve_material_def; v_miss text;
        v_ceiling double precision; v_made text; v_tx int; v_ty int;
begin
  if p_action = 'drink' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    if not has_water(p_world, v_tx, v_ty) then return 'There is no water there.'; end if;
    return null;
  end if;

  v_it := carried(p_world, p_uid, target_item(p_target));
  if v_it.id is null then return 'It is gone.'; end if;

  if p_action = 'eat' then
    if coalesce((select food from item_def where id = v_it.def), 0) <= 0 then
      return 'That is not food.';
    end if;
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
    if v_it.locked then return 'You have that one put by.'; end if;
    return null;

  elsif p_action = 'drink_skin' then
    if coalesce((select drink from item_def where id = v_it.def), 0) <= 0
       or (select charges from item_def where id = v_it.def) is null then
      return 'There is nothing in that to drink.';
    end if;
    if coalesce(v_it.charges, 0) <= 0 then return 'It is empty.'; end if;
    return null;

  elsif p_action = 'repair_item' then
    if v_it.dmg <= 0 then return 'There is nothing wrong with it.'; end if;
    if v_it.ql <= 1 then return 'It is worn away to nothing and will not take another repair.'; end if;
    return null;

  elsif p_action = 'improve_item' then
    select * into v_what from improvable_def where item = v_it.def;
    if not found then return 'That is not something you can better.'; end if;
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
    if v_it.issued then
      return 'That came ashore with you. There is nothing in it to better — make one of your own.';
    end if;
    if v_it.dmg > 10 then return 'It is too knocked about to work on. Repair it first.'; end if;
    select * into v_mat from improve_material_def where id = v_what.material;
    v_miss := missing_tool(p_world, p_uid, v_mat.id);
    if v_miss is not null then
      return 'You need ' || (select string_agg(lower((select coalesce(name, t.tool) from item_def where id = t.tool)),
                                               ' and ' order by t.ord)
                             from improve_tool t where t.material = v_mat.id)
        || ' to work ' || v_mat.name || '.';
    end if;
    v_made := (mat_of(v_it.extra)).name;
    if (stock_for(p_world, p_uid, v_mat.id, v_made)).id is null then
      return 'You have no ' || lower(coalesce(v_made, v_mat.name))
        || ' to work into it, and nothing else will do.';
    end if;
    v_ceiling := improve_ceiling(p_world, p_uid, v_what.skill, v_it.rare);
    if v_it.ql >= v_ceiling then
      return 'Your ' || replace(v_what.skill, '_', ' ') || ' is not good enough to better it further.';
    end if;
    if v_it.ql >= 99.9 then return 'It cannot be bettered.'; end if;
    return null;
  end if;
  return null;
end $function$;

-- last_refusal (1)
CREATE OR REPLACE FUNCTION public.last_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare p player; pc placed; b bridge; d bridge_def; s bridge_span; c creature; mate creature;
        it item; dye item; bd brew_def; v_kind text; v_short text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    return bridge_reason(p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
      (p_target->>'x')::int, (p_target->>'y')::int);

  elsif p_action in ('build_bridge', 'demolish_bridge') then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return 'It is gone.'; end if;
    select * into d from bridge_def where id = b.kind;
    if p_action = 'build_bridge' then
      select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
        and not span_done(sp.needed) order by sp.n limit 1;
      if not found then return 'It is finished.'; end if;
      if tool_ql(p_world, p_uid, d.tool) <= 0 then
        return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || '.';
      end if;
      if sqrt((s.x + 0.5 - p.x) ^ 2 + (s.y + 0.5 - p.y) ^ 2) > 4.5 then
        return 'Work from one end. Walk to the open part of the span.';
      end if;
      select e.key into v_short from jsonb_each(s.needed) e
        where (e.value)::int > 0 and pack_count(p_world, p_uid, e.key) < 1 order by e.key limit 1;
      if v_short is not null then
        return 'That span wants ' || span_wants(s.needed) || '; you are carrying no '
          || lower((select coalesce(name, v_short) from item_def where id = v_short)) || '.';
      end if;
    else
      if sqrt((b.ax + 0.5 - p.x) ^ 2 + (b.ay + 0.5 - p.y) ^ 2) > 4.5
         and sqrt((b.bx + 0.5 - p.x) ^ 2 + (b.by + 0.5 - p.y) ^ 2) > 4.5 then
        return 'Stand at one end of it.';
      end if;
    end if;
    return null;

  elsif p_action in ('sleep', 'set_home') then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found or not is_bed(pc) then return 'That is not a bed.'; end if;
    if not near_piece(p_world, p_uid, pc) then return 'Stand next to it.'; end if;
    if p_action = 'sleep' and not is_night(p_world) then
      return 'It is ' || world_clock(p_world) || ' and broad daylight. Sleep when it is dark.';
    end if;
    if p_action = 'set_home' and p.home_x = pc.x and p.home_y = pc.y then
      return 'You already wake up here.';
    end if;
    return null;

  elsif p_action in ('pair_creature', 'read_blood') then
    perform creature_settle(p_world, (p_target->>'id')::int);
    perform herd_settle(p_world);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is gone.'; end if;
    if p_action = 'read_blood' then return null; end if;
    if not exists (select 1 from deed where world_id = p_world and founded_by = p_uid) then
      return 'Breeding is settled work. Found a settlement first: the young one goes to the token.';
    end if;
    if not creature_in_reach(p_world, p_uid, c, 2.4) then return 'Stand next to ' || c.name || '.'; end if;
    if c.due is not null then return c.name || ' is already in young.'; end if;
    mate := mate_for(p_world, c);
    if mate.id is null then
      return 'There is no ' || lower((select name from species_def where id = c.species))
        || ' of the other sex within ' || round(pair_range()) || ' tiles. ' || c.name
        || ' is ' || c.sex || '.';
    end if;
    return pair_refuses(p_world, c, mate);

  elsif p_action in ('dye_item', 'strip_dye') then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if p_action = 'dye_item' then
      if not found then return 'It is gone.'; end if;
      if not takes_dye(it.def) then return 'Nothing will take on that.'; end if;
      dye := pick_dye(p_world, p_uid);
      if dye.id is null then
        return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.';
      end if;
      if it.dye = (select id from dye_def where name = dye.extra) then
        return 'It is ' || (select word from dye_def where name = dye.extra) || ' already.';
      end if;
    else
      if not found or it.dye is null then return 'It has taken no colour.'; end if;
      if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then
        return 'You need a bucket of lye to strip it.';
      end if;
    end if;
    return null;

  elsif p_action = 'start_brew' then
    select * into bd from brew_def where id = p_target->>'brew';
    if not found then return 'Choose what to brew.'; end if;
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    return brew_reason(p_world, p_uid, pc, bd);
  end if;
  return null;
end $function$;

-- liquid_refusal (1)
CREATE OR REPLACE FUNCTION public.liquid_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare it item; p placed; v_kind text;
begin
  if p_action in ('fill_bucket', 'fill_skin', 'empty_bucket', 'pour_into_barrel') then
    it := carried(p_world, p_uid, target_item(p_target));
    if it.id is null then return 'It is gone.'; end if;
  else
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found then return 'It is gone.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to it.'; end if;
  end if;

  if p_action = 'fill_bucket' then
    if it.def <> 'bucket' then return 'That is not an empty bucket.'; end if;
    if not exists (select 1 from vessels_near(p_world, p_uid) v where placed_litres(v) >= bucket_litres())
       and not near_water(p_world, p_uid) then
      return 'You need water: a shore, a well, or a barrel with something in it.';
    end if;

  elsif p_action = 'fill_skin' then
    if (select charges from item_def where id = it.def) is null then
      return 'That does not hold water.';
    end if;
    if coalesce(it.charges, 0) >= (select charges from item_def where id = it.def) then
      return 'It is already full.';
    end if;
    if not water_near(p_world, p_uid) then
      return 'You need water: a shore, a well, or a barrel of it.';
    end if;

  elsif p_action = 'empty_bucket' then
    if not exists (select 1 from vessel_def where item = it.def) then
      return 'That is not a bucket of anything.';
    end if;

  elsif p_action = 'pour_into_barrel' then
    select liquid into v_kind from vessel_def where item = it.def;
    if v_kind is null then return 'That is not a bucket of anything.'; end if;
    if (barrel_for(p_world, p_uid, v_kind)).id is null then
      return 'There is no barrel beside you with room for '
        || (select name from liquid_def where id = v_kind) || '.';
    end if;

  elsif p_action = 'empty_vessel' then
    if not holds_liquid(p) or is_well(p) then return 'That is not something you tip out.'; end if;
    if placed_litres(p) <= 0 then return 'It is already empty.'; end if;

  elsif p_action = 'drink_from_vessel' then
    if not holds_liquid(p) then return 'There is nothing in that to drink.'; end if;
    if not coalesce((select drinkable from liquid_def where id = placed_liquid(p)), false) then
      return 'You would not want to drink that.';
    end if;
    if placed_litres(p) < 1 then return 'It is dry.'; end if;
    if coalesce((select (stats->>'thirst')::double precision from player
                 where world_id = p_world and uid = p_uid), 1) >= 0.999
       and not coalesce((select brew from liquid_def where id = placed_liquid(p)), false) then
      return 'You are not thirsty.';
    end if;
  end if;
  return null;
end $function$;

-- perform_craft (1)
CREATE OR REPLACE FUNCTION public.perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r recipe; i record; prefer bigint; mat text; hard double precision; tq double precision;
        s double precision; made_ql double precision; rare text; total double precision := 0;
        weight double precision := 0; one double precision; gained double precision;
begin
  select * into r from recipe where id = p_recipe;
  prefer := target_item(p_target);
  mat := craft_material(p_world, p_uid, p_recipe, prefer);
  s := skill_of(p_world, p_uid, r.skill);
  tq := case when r.tool is null then 0 else tool_ql(p_world, p_uid, r.tool) end;
  -- Oak and the deep metals fight the hands that shape them.
  hard := coalesce(r.difficulty, 0) + coalesce((select difficulty from material_def where id = mat), 0);

  if r.difficulty is not null and not skill_check(s, hard, tq) then
    if r.consume_on_fail then
      for i in select * from recipe_input where recipe = p_recipe order by ord loop
        perform consume(p_world, p_uid, i.item, i.count, prefer, mat);
      end loop;
      -- The batch is wasted, not the vessel: you tip the ruin out and keep the
      -- bucket. Salvage if the recipe names any, otherwise whatever it returns.
      for i in
        select g.item, g.count from recipe_gives g
        where g.recipe = p_recipe
          and g.kind = (case when exists (select 1 from recipe_gives where recipe = p_recipe and kind = 'salvage')
                             then 'salvage' else 'return' end)
      loop
        perform give(p_world, p_uid, i.item, i.count, 20);
      end loop;
    end if;
    perform skill_raise(p_world, p_uid, r.skill, try_gain(false));
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, craft_head()));
    perform tell(p_world, p_uid, coalesce(r.fail,
      'You fail to make ' || lower((select coalesce(name, r.result) from item_def where id = r.result)) || '.'), 'event');
    return;
  end if;

  -- The quality of what is about to be used up, worked out before it is used
  -- up, since using it up changes the answer.
  if r.ql_from_inputs then
    for i in select * from recipe_input where recipe = p_recipe order by ord loop
      select it.ql into one from item it
        where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = i.item
        order by it.id limit 1;
      if one is not null then
        total := total + one * i.count;
        weight := weight + i.count;
      end if;
    end loop;
  end if;

  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    if not consume(p_world, p_uid, i.item, i.count, prefer, mat) then return; end if;
  end loop;

  if r.ql_from_inputs then
    made_ql := greatest(1, least(100, (case when weight > 0 then total / weight else 1 end) * (0.78 + s / 460)));
  else
    made_ql := product_ql(s, tq);
  end if;
  rare := rarity_roll();
  perform give(p_world, p_uid, r.result, r.count, made_ql, coalesce(r.extra, mat), rare);
  -- Into the ledger, which is the only memory this island has of what you have
  -- made. It says so when it is your first of a kind or your best.
  perform journal_made(p_world, p_uid, r.result, made_ql, r.count, rare);
  if rare is not null then
    perform journal_note(p_world, p_uid, rare);
    perform tell(p_world, p_uid, rarity_word(rare), 'skill');
  end if;
  for i in select g.item, g.count from recipe_gives g where g.recipe = p_recipe and g.kind = 'return' loop
    perform give(p_world, p_uid, i.item, i.count, 20);
  end loop;

  gained := skill_raise(p_world, p_uid, r.skill, 1);
  -- Working a thing out with your hands is what sharpens the head.
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, craft_head()));
  perform tell(p_world, p_uid, r.done || ' (' || case when mat is not null then lower(mat) || ', ' else '' end
    || 'QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  perform skill_said(p_world, p_uid, r.skill, gained);
end $function$;

-- perform_crate (3)
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
    select * into v_it from item where id = target_item(p_target);
    v_kind := crate_kind_of_item(v_it.def);
    if v_kind is null or not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    select coalesce(max(id), 0) + 1 into v_new_id from crate where world_id = p_world;
    insert into crate (world_id, id, kind, x, y, sx, sy, material, made_by)
    values (p_world, v_new_id, v_kind, v_tx, v_ty, v_sx, v_sy, v_it.extra, p_uid);
    select * into v_c from crate where world_id = p_world and id = v_new_id;
    perform journal_note(p_world, p_uid, 'crate');
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
    select * into v_it from item where id = target_item(p_target);
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

  elsif p_action = 'take_from_store' then
    select * into v_it from item where id = target_item(p_target) and world_id = p_world;
    if not found or v_it.holder not in ('crate', 'furniture', 'bag') then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    -- `move_part` splits the stack, merges into one you already carry, and
    -- clears whichever of `crate` and `placed` was holding it.
    if move_part(v_it.id, v_want, 'player', p_uid, null, null) is null then return; end if;
    perform tell(p_world, p_uid, 'You take '
      || case when v_want > 1 then v_want || ' × ' else 'the ' end
      || lower((select coalesce(name, v_it.def) from item_def where id = v_it.def))
      || ' out.', 'event');
  end if;
end $function$;

-- perform_dig (1)
CREATE OR REPLACE FUNCTION public.perform_dig(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; it item; r relic_def; v_skill double precision; v_tool double precision;
        v_part int; v_ql double precision; v_dmg double precision; v_left int; v_new bigint;
        v_missing int[]; v_relic text; v_avg double precision; v_gain double precision;
        /*
         * `v_piece`, not `h`. The seventh time this class has bitten and the
         * first that was not a column name: `h` was the loop variable *and*
         * the alias of `pieces_held(...) h`, so `h.ql` was ambiguous between a
         * record field and a column of the very rows being looped over. Alias
         * every table, prefix every local, and the two can never meet.
         */
        v_piece item;
        v_lectern boolean; v_roll double precision; v_sum double precision;
begin
  if p_action = 'investigate' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    perform mark_foraged(p_world, tx, ty, 'dig');
    v_skill := skill_of(p_world, p_uid, 'archaeology');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    if random() > find_chance(v_skill, v_tool) then
      -- Half a go here, where the browser's blanket pays a whole one. That
      -- disagreement is older than this change and is left where it is: what
      -- moves today is only what a *failed* go is worth.
      perform skill_raise(p_world, p_uid, 'archaeology', try_gain(false, 0.5));
      perform tell(p_world, p_uid,
        'You go through the soil and turn up nothing but roots and small stones.', 'event');
      return;
    end if;
    perform skill_raise(p_world, p_uid, 'archaeology', try_gain(true, 0.5));
    if not exists (select 1 from relics_within(v_skill)) then
      perform tell(p_world, p_uid,
        'You turn up a scrap of something worked, but you cannot tell what it was and it crumbles.',
        'event');
      return;
    end if;
    -- The commonplace comes up far more often than the rare, as it did when
    -- it was lost: weighted by difficulty, and the weights are small numbers.
    select sum(1 / (1 + w.difficulty / 12)) into v_sum from relics_within(v_skill) w;
    v_roll := random() * v_sum;
    for r in select * from relics_within(v_skill) loop
      v_roll := v_roll - 1 / (1 + r.difficulty / 12);
      exit when v_roll <= 0;
    end loop;
    -- A piece you are still short of, if you are short of any.
    v_missing := parts_missing(p_world, p_uid, r.name);
    if coalesce(array_length(v_missing, 1), 0) > 0 then
      v_part := v_missing[1 + floor(random() * array_length(v_missing, 1))::int];
    else
      v_part := 1 + floor(random() * r.parts)::int;
    end if;
    v_ql := greatest(1, product_ql(v_skill, v_tool) * (0.55 + random() * 0.35));
    -- Nothing comes out of the ground sound.
    v_dmg := 18 + random() * 50;
    v_new := give(p_world, p_uid, 'fragment', 1, v_ql, r.name || ' ' || v_part || '/' || r.parts);
    update item set dmg = v_dmg where id = v_new;
    v_left := coalesce(array_length(parts_missing(p_world, p_uid, r.name), 1), 0);
    perform tell(p_world, p_uid, 'Your trowel turns up a fragment of ' || r.name || ', piece '
      || v_part || ' of ' || r.parts || '. (QL ' || to_char(v_ql, 'FM990.0')
      || ', damage ' || to_char(v_dmg, 'FM990') || ')'
      || case when v_left > 0 then ' ' || v_left || ' of ' || r.parts || ' still missing.'
              else ' That is all ' || r.parts || ' of them.' end, 'event');
    return;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target);
  if not found then return; end if;

  if p_action = 'study_book' then
    -- A lectern holds the pages open at the right angle, and you get twice as
    -- much out of the hour.
    v_lectern := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'furniture'
                           and p.sub = 'lectern' and near_piece(p_world, p_uid, p, 2.6));
    v_gain := skill_raise(p_world, p_uid, 'mind_logic',
      (0.5 + it.ql / 90) * case when v_lectern then 2 else 1 end);
    perform damage_item(it.id, 2 + random() * 3);
    perform tell(p_world, p_uid, 'You work through the ' || lower(item_name(it)) || '.'
      || case when v_lectern
              then ' The lectern holds it open at the right angle and you make good use of the hour.'
              else ' Held in one hand, it is hard going. A lectern would be better.' end
      || case when v_gain > 0.0005 then '' else ' There is nothing left in it you do not already know.' end,
      'event');
    return;
  end if;

  -- Restoring: every piece in at once, and what comes out is only as good as
  -- the pieces that went in, less what age took.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if not found then return; end if;
  if not skill_check(skill_of(p_world, p_uid, 'restoration'), r.difficulty, 0,
                     mind_ease(p_world, p_uid)) then
    for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
      perform damage_item(v_piece.id, 5 + random() * 9);
    end loop;
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, restore_gain()));
    perform tell(p_world, p_uid, 'The pieces of the ' || r.name
      || ' will not sit together and you mark them trying.', 'event');
    return;
  end if;
  select avg(h.ql * (1 - h.dmg / 200)) into v_avg from pieces_held(p_world, p_uid, v_relic) h;
  v_ql := greatest(1, least(100, v_avg * (0.72 + skill_of(p_world, p_uid, 'restoration') / 260)));
  for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
    perform consume(p_world, p_uid, 'fragment', 1, v_piece.id);
  end loop;
  v_new := give(p_world, p_uid, r.result, 1, v_ql);
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, restore_gain()));
  perform tell(p_world, p_uid, 'The pieces go back together and the ' || r.name || ' is whole: '
    || lower((select item_name(i) from item i where i.id = v_new))
    || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $function$;

-- perform_faith (2)
CREATE OR REPLACE FUNCTION public.perform_faith(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; pc placed; faith double precision; hour double precision;
        gained double precision; cap double precision; got double precision;
        was double precision; med double precision; sit record; v_step path_step;
        v_way text; r record;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'pray' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    faith := skill_of(p_world, p_uid, faith_skill());
    hour := hour_of_day(p_world);
    cap := favour_cap(faith);
    got := least(cap, favour_settle(p_world, p_uid) + prayer_worth(pc.ql, hour, faith));
    update player set favour = got, favour_at = now(), prayed_at = now()
      where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'prayed');
    perform skill_raise(p_world, p_uid, faith_skill(), 1.4);
    perform tell(p_world, p_uid,
      case when abs(hour - 6) < 2 or abs(hour - 20) < 2
           then 'You kneel in the half light and it goes better than it usually does.'
           else 'You kneel at the stone.' end
      || ' Favour ' || floor(got) || ' of ' || floor(cap) || '.', 'event');

  elsif p_action = 'cast' then
    if cast_reason(p_world, p_uid, p_target->>'spell', target_item(p_target)) is not null then
      return;
    end if;
    perform journal_note(p_world, p_uid, 'cast:' || (p_target->>'spell'));
    perform tell(p_world, p_uid,
      do_cast(p_world, p_uid, p_target->>'spell', target_item(p_target)), 'event');

  elsif p_action = 'meditate' then
    select * into sit from sitting_worth(p_world, p_uid);
    was := skill_of(p_world, p_uid, meditation_skill());
    update player set sat_at = now() where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'sat');
    perform skill_raise(p_world, p_uid, meditation_skill(), sit.gain);
    med := skill_of(p_world, p_uid, meditation_skill());
    perform tell(p_world, p_uid, sit.said, 'event');
    if p.way is null and med >= choose_at() and was < choose_at() then
      perform tell(p_world, p_uid, 'Something settles. Three ways of looking at all this have '
        || 'become clear, and you may walk exactly one of them. Choose from the rug.', 'system');
    end if;
    if p.way is not null then
      for r in select s.*, d.name as path_name from path_step s join path_def d on d.id = s.path
        where s.path = p.way and was < s.at and med >= s.at order by s.n
      loop
        perform tell(p_world, p_uid, r.path_name || ': ' || r.name || '. ' || r.note, 'system');
      end loop;
    end if;

  elsif p_action = 'choose_path' then
    v_way := p_target->>'material';
    if p.way is not null or not exists (select 1 from path_def where id = v_way) then return; end if;
    update player set way = v_way where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You take the path of '
      || (select name from path_def where id = v_way) || '. '
      || (select note from path_def where id = v_way), 'system');

  elsif p_action = 'use_ability' then
    v_step := ability_of(p_world, p_uid, p_target->>'material');
    if v_step.path is null then return; end if;
    update player set used_at = jsonb_set(used_at, array[v_step.ability], to_jsonb(now()))
      where world_id = p_world and uid = p_uid;
    perform skill_raise(p_world, p_uid, meditation_skill(), 0.2);
    perform tell(p_world, p_uid, work_ability(p_world, p_uid, v_step.ability), 'event');
  end if;
end $function$;

-- perform_farm (1)
CREATE OR REPLACE FUNCTION public.perform_farm(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
-- `yld`, not `y`: the crop table has a column called y, and a plpgsql variable
-- of that name shadows it inside every query in the function — which Postgres
-- reports as "column reference y is ambiguous" from a line that does not
-- mention the variable at all.
declare d action_def; tx int; ty int; c crop; cd crop_def; it item; yld int[];
        s double precision; made_ql double precision; gained double precision; got int;
begin
  select * into d from action_def where id = p_action;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  s := skill_of(p_world, p_uid, 'farming');
  perform crop_settle(p_world, tx, ty);
  select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
  if c.id is not null then select * into cd from crop_def where id = c.id; end if;

  if p_action = 'till' then
    perform land_set_tile(p_world, tx, ty, tile_id('Field'));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You rake the ground into a field, ready for sowing.', 'event');

  elsif p_action = 'plant_seed' then
    select * into it from item where id = target_item(p_target);
    select * into cd from crop_def where seed = it.def;
    if not consume(p_world, p_uid, it.def, 1, it.id) then return; end if;
    insert into crop (world_id, x, y, id, ql, sown_by) values (p_world, tx, ty, cd.id, it.ql, p_uid)
      on conflict (world_id, x, y) do update set id = cd.id, stage = 0, stage_at = now(),
        tended = 0, tended_now = false, ql = it.ql, sown_by = p_uid;
    perform tell(p_world, p_uid, 'You sow ' || lower(cd.name)
      || '. It should be sprouting in a couple of minutes.', 'event');
    perform land_announce(p_world, tx, ty);

  elsif p_action = 'tend_crop' then
    made_ql := product_ql(s, 0);
    update crop cr set tended_now = true, tended = c.tended + 1,
      -- Quality follows the farmer, averaged over the care the field was given.
      ql = (c.ql * (c.tended + 1) + made_ql) / (c.tended + 2)
      where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    yld := crop_yield(c.tended + 1);
    perform tell(p_world, p_uid, 'You weed and water the ' || lower(cd.name) || '. It should give '
      || yld[2] || ' ' || lower((select coalesce(name, cd.produce) from item_def where id = cd.produce))
      || ' and ' || yld[1] || ' seed' || case when yld[1] > 1 then 's' else '' end || '.', 'event');
    gained := skill_raise(p_world, p_uid, 'farming', 1);

  elsif p_action = 'harvest_crop' then
    yld := crop_yield(c.tended);
    -- The field's own quality, lifted by the farmer's skill at harvest.
    made_ql := greatest(1, least(100, (c.ql + product_ql(s, 0)) / 2));
    -- The gardener's path takes a third more out of the same ground.
    got := greatest(1, round(yld[2] * case when walks(p_world, p_uid, 'love', 5) then 1.34 else 1 end));
    perform give(p_world, p_uid, cd.produce, got, made_ql);
    perform give(p_world, p_uid, cd.seed, yld[1], made_ql);
    delete from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    perform tell(p_world, p_uid, 'You harvest ' || got || ' × '
      || lower((select coalesce(name, cd.produce) from item_def where id = cd.produce))
      || ' and ' || yld[1] || ' ' || lower((select coalesce(name, cd.seed) from item_def where id = cd.seed))
      || '. The field is ready to sow again. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    gained := skill_raise(p_world, p_uid, 'farming', 1);
    perform land_announce(p_world, tx, ty);

  elsif p_action = 'clear_field' then
    delete from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    perform land_set_tile(p_world, tx, ty, tile_id('Dirt'));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when c.id is not null
      then 'You turn the ' || lower(cd.name) || ' back into the soil.'
      else 'You break the field back up into plain dirt.' end, 'event');
  end if;

  perform skill_said(p_world, p_uid, 'farming', gained);
end $function$;

-- perform_fight (2)
CREATE OR REPLACE FUNCTION public.perform_fight(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_landed boolean; it item; p player; slot text; shield item; c creature; d species_def; w weapon_def;
        bow weapon_def; arrow item; held item; dist double precision; dmg double precision;
        bane double precision; before double precision; died boolean; reach double precision;
        corpse item; sp species_def; knife_ql double precision; v_share double precision;
        made_ql double precision; taken text[] := '{}'; r record; v_n int; lumps text[] := '{}';
        hurt jsonb; use item; suits boolean; clean boolean; healed double precision;
        top double precision; out_w jsonb; one jsonb; lye item; got text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'equip' then
    select * into it from item where id = target_item(p_target);
    slot := slot_of(it.def);
    update player set equipped = jsonb_set(equipped, array[slot], to_jsonb(it.id))
      where world_id = p_world and uid = p_uid returning * into p;
    -- Both hands on it means nothing else in them.
    if slot = 'weapon' and coalesce((select two_handed from weapon_def where id = it.def), false) then
      shield := worn(p_world, p_uid, 'offhand');
      if shield.id is not null then
        update player set equipped = equipped - 'offhand' where world_id = p_world and uid = p_uid;
        perform tell(p_world, p_uid, 'You need both hands for that, so the '
          || lower((select name from item_def where id = shield.def)) || ' goes on your back.', 'info');
      end if;
    end if;
    perform tell(p_world, p_uid, 'You '
      || case when slot in ('weapon', 'offhand') then 'take up' else 'put on' end
      || ' the ' || lower((select name from item_def where id = it.def)) || '.', 'info');

  elsif p_action = 'unequip' then
    select * into it from item where id = target_item(p_target);
    slot := slot_of(it.def);
    update player set equipped = equipped - slot where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You put the '
      || lower((select name from item_def where id = it.def)) || ' away.', 'info');

  elsif p_action = 'attack_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select * into d from species_def where id = c.species;
    w := swung_with(p_world, p_uid);
    held := swung_item(p_world, p_uid);
    before := c.health;
    -- The gains used to be written above the roll, so a miss paid exactly
    -- what a landed blow paid.
    v_landed := random() <= hit_chance(p_world, p_uid, w.kind);
    perform skill_raise(p_world, p_uid, 'fighting', try_gain(v_landed, swing_fight()));
    perform skill_raise(p_world, p_uid, w.kind, try_gain(v_landed, swing_arm()));
    perform skill_raise(p_world, p_uid, 'body_strength', try_gain(v_landed, swing_body()));
    if not v_landed then
      perform tell(p_world, p_uid, 'You swing at the ' || lower(d.name)
        || case when held.id is null then '' else ' with your '
             || lower((select name from item_def where id = held.def)) end || ' and miss.', 'event');
    else
      bane := case when held.id is not null and mat_bane(held.extra) and d.glow is not null
                   then bane_bonus() else 1 end;
      dmg := weapon_damage(p_world, p_uid, w, held) * bane * (0.75 + random() * 0.5);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      if held.id is not null then perform damage_item(held.id, 0.35); end if;
      if not died then
        perform tell(p_world, p_uid, 'You strike the ' || lower(d.name)
          || case when held.id is null then '' else ' with your '
               || lower((select name from item_def where id = held.def)) end
          || '. It is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'event');
      end if;
    end if;
    -- A cornered animal gets a swipe in, and the defensive sorts never miss their chance.
    if not coalesce(died, false) and (d.defensive or random() < 0.35) then
      perform hurt_player(p_world, p_uid, attack_of(c) * 0.012,
        'The ' || lower(d.name) || case when d.defensive then ' comes straight back at you'
                                        else ' turns on you' end,
        coalesce(d.wound, 'bite'));
    end if;

  elsif p_action = 'shoot_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select * into d from species_def where id = c.species;
    held := worn(p_world, p_uid, 'weapon');
    select bw.* into bow from weapon_def bw where bw.id = held.def and bw.ammo is not null;
    if not found then return; end if;
    select i.* into arrow from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = bow.ammo
      order by i.ql desc limit 1;
    if arrow.id is null or not consume(p_world, p_uid, bow.ammo, 1, arrow.id) then return; end if;
    dist := (select sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2)
             from player pl where pl.world_id = p_world and pl.uid = p_uid);
    -- The far end of a bow's range is a far harder shot than the near end.
    v_landed := random() <= hit_chance(p_world, p_uid, 'archery')
                            * (1 - (dist / coalesce(bow.range, 6)) * 0.35);
    perform skill_raise(p_world, p_uid, 'fighting', try_gain(v_landed, shot_fight()));
    perform skill_raise(p_world, p_uid, 'archery', try_gain(v_landed, shot_archery()));
    if not v_landed then
      perform tell(p_world, p_uid, 'Your arrow goes wide of the ' || lower(d.name) || '.', 'event');
    else
      -- The stave throws it; the head is what goes in. Both have a say.
      bane := case when mat_bane(arrow.extra) and d.glow is not null then bane_bonus() else 1 end;
      dmg := weapon_damage(p_world, p_uid, bow, held) * mat_edge(arrow.extra) * bane
             * (0.6 + arrow.ql / 140) * (0.8 + random() * 0.4);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      perform damage_item(held.id, 0.25);
      if not died then
        perform tell(p_world, p_uid, 'Your arrow goes home. The ' || lower(d.name)
          || ' is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'event');
      end if;
    end if;

  elsif p_action = 'butcher' then
    corpse := target_corpse(p_world, p_uid, p_target);
    sp := corpse_species(corpse.extra);
    if corpse.id is null or sp.id is null then return; end if;
    knife_ql := nullif(tool_ql(p_world, p_uid, 'butchering_knife'), 0);
    v_share := butcher_yield(skill_of(p_world, p_uid, 'butchering'), knife_ql);
    made_ql := product_ql(skill_of(p_world, p_uid, 'butchering'), coalesce(knife_ql, 0))
               * (0.6 + corpse.ql / 250);
    -- What it was sleeping on, which is not a part of it at all.
    for r in select sb.n from species_butcher sb where sb.species = sp.id and sb.part = 'hoard' loop
      for v_n in 1..round(r.n * (4 + v_share * 6))::int loop
        select item into got from hoard_metal order by random() limit 1;
        perform give(p_world, p_uid, got, 1, greatest(20, least(100, 40 + random() * 55)));
        lumps := lumps || lower((select name from item_def where id = got));
      end loop;
    end loop;
    if array_length(lumps, 1) > 0 then
      perform journal_note(p_world, p_uid, 'hoard');
      perform tell(p_world, p_uid, 'Something rattles as the belly opens: ' || array_length(lumps, 1)
        || ' lumps of what it had been sleeping on. '
        || (select string_agg(distinct l, ', ') from unnest(lumps) l) || '.', 'event');
    end if;
    /* `n` was a plpgsql variable here and `species_butcher.n` a column, and
     * Postgres would not guess which was meant. That is the fourth time on
     * this island — `land_tile.y`, `crop.y`, `trait_def.tier` — so the locals
     * that could collide carry a prefix. */
    for r in select b.part, b.item, sb.n from butcher_part b
             join species_butcher sb on sb.part = b.part and sb.species = sp.id
             order by b.ord loop
      v_n := floor(r.n * v_share)::int;
      -- The remainder is a chance at one more, so a poor job still gives something.
      if random() < r.n * v_share - v_n then v_n := v_n + 1; end if;
      -- Glands are the rare part: only a steady hand finds them intact.
      if r.part = 'gland' and v_n > 0 and random() > 0.35 * (0.5 + v_share) then v_n := 0; end if;
      if v_n <= 0 then continue; end if;
      perform give(p_world, p_uid, r.item, v_n, greatest(1, least(100, made_ql)));
      taken := taken || (case when v_n > 1 then v_n || ' × ' else '' end
        || lower((select name from item_def where id = r.item)));
    end loop;
    delete from item where id = corpse.id;
    if array_length(taken, 1) is null then
      perform tell(p_world, p_uid, 'You make a mess of the ' || lower(sp.name)
        || ' carcass and salvage nothing.', 'event');
    else
      perform tell(p_world, p_uid, 'You butcher the ' || lower(sp.name) || ' and take '
        || array_to_string(taken, ', ') || '.'
        || case when knife_ql is null then ' Bare hands waste most of a carcass.' else '' end, 'event');
    end if;

  elsif p_action = 'bind_wound' then
    select * into p from player where world_id = p_world and uid = p_uid;
    hurt := worst_wound(p.wounds);
    if hurt is null or (hurt->>'infected')::boolean then return; end if;
    use := dressing_for(p_world, p_uid, hurt);
    if use.id is null or not consume(p_world, p_uid, use.def, 1, use.id) then return; end if;
    got := case when use.def = 'cover' then lower(coalesce(use.extra, '')) else '' end;
    suits := got = (select herb from wound_kind_def where id = hurt->>'kind');
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 10, use.ql);
    -- Cloth holds a dressing on. The right herb closes the wound.
    healed := (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end)
              * (case when suits then 1.5 when got <> '' then 1.1 else 1 end);
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(p.wounds) loop
      if one = hurt then
        one := jsonb_set(one, '{severity}', to_jsonb(greatest(0, (one->>'severity')::double precision - healed)));
        if clean then one := jsonb_set(jsonb_set(one, '{dressing}', to_jsonb(got)), '{bleeding}', 'false'); end if;
      end if;
      if (one->>'severity')::double precision > 0.004 or (one->>'infected')::boolean then
        out_w := out_w || one;
      end if;
    end loop;
    update player set wounds = out_w,
        stats = jsonb_set(p.stats, '{health}',
          to_jsonb(least(1, coalesce((p.stats->>'health')::double precision, 1) + healed)))
      where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'dressed');
    if clean and suits then perform journal_note(p_world, p_uid, 'covered'); end if;
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, bandage_gain()));
    perform tell(p_world, p_uid, case
      when not clean then 'The dressing slips and you make a poor job of it. You still have '
        || wound_text(hurt) || '.'
      when suits then 'You lay the ' || got
        || ' cover on and bind it. The bleeding stops at once and it is already closing.'
      when got <> '' then 'You bind the ' || got || ' cover over it. It is the wrong herb for a '
        || (select name from wound_kind_def where id = hurt->>'kind')
        || ', but it holds and the bleeding stops.'
      else 'You clean it and bind it with cloth. The bleeding stops, though it will be slow to close.'
      end, 'event');

  elsif p_action = 'clean_wound' then
    select * into p from player where world_id = p_world and uid = p_uid;
    select i.* into lye from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'lye_bucket'
      order by i.ql desc limit 1;
    if lye.id is null or not consume(p_world, p_uid, 'lye_bucket', 1, lye.id) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, lye.ql);
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 26, lye.ql);
    perform journal_note(p_world, p_uid, 'cleaned');
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, clean_gain()));
    select x into hurt from jsonb_array_elements(p.wounds) x where (x->>'infected')::boolean limit 1;
    if not clean then
      perform tell(p_world, p_uid, 'You scour the '
        || (select name from wound_kind_def where id = hurt->>'kind')
        || ' out and it is no better for it. The lye is gone.', 'error');
      return;
    end if;
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(p.wounds) loop
      if one = hurt then
        one := jsonb_set(jsonb_set(jsonb_set(one, '{infected}', 'false'),
          '{bleeding}', 'true'), '{dressing}', 'null'::jsonb);
      end if;
      out_w := out_w || one;
    end loop;
    update player set wounds = out_w where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You scour the '
      || (select name from wound_kind_def where id = hurt->>'kind') || ' on your '
      || part_name(hurt->>'part') || ' out with lye. It is open and clean again, and bleeding. Dress it.', 'event');

  elsif p_action = 'treat_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select i.* into use from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'bandage'
      order by i.ql desc limit 1;
    if use.id is null or not consume(p_world, p_uid, 'bandage', 1, use.id) then return; end if;
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 14, use.ql);
    top := max_health(c);
    healed := top * (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end);
    update creature set health = least(top, health + healed)
      where world_id = p_world and id = c.id returning * into c;
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, bandage_gain()));
    perform tell(p_world, p_uid, case when clean
      then 'You dress ' || c.name || '''s wounds with the '
        || lower((select name from item_def where id = 'bandage')) || '. It is up to '
      else c.name || ' will not hold still and the dressing goes on badly. It is up to '
      end || ceil(c.health) || ' of ' || top || '.', 'event');
  end if;
end $function$;

-- perform_fire (3)
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
    sz := placed_size(case p_action when 'place_smelter' then 'smelter'
                                    when 'place_kiln' then 'kiln' else 'furniture' end, sub);
    ax := least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0)));
    ay := least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, case p_action when 'place_smelter' then 'smelter'
                                   when 'place_kiln' then 'kiln' else 'furniture' end, sub,
            (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + sz[1] / 2.0) / subtiles(),
            (p_target->>'y')::int + (ay + sz[2] / 2.0) / subtiles(),
            it.ql, p_uid)
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
  elsif p_action in ('pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    back := case p.kind when 'smelter' then 'smelter' when 'kiln' then 'kiln'
                        else 'furniture_' || p.sub end;
    delete from placed where id = p.id;
    perform give(p_world, p_uid, back, 1, p.ql);
    perform tell(p_world, p_uid, 'You take up the ' || lower(coalesce(p.sub, p.kind)) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$;

-- perform_firing (1)
CREATE OR REPLACE FUNCTION public.perform_firing(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_p placed; v_it item; v_mould item; v_metal metal_def; v_need int; v_n int;
        v_secs double precision; v_ql double precision; v_jobs jsonb; v_out jsonb;
        v_one jsonb; v_names text[] := '{}'; v_makes text; v_i int;
begin
  v_p := target_placed(p_world, p_target);
  if v_p.id is null then return; end if;

  if p_action in ('smelter_take_all', 'kiln_take_all') then
    v_out := furnace_output(v_p);
    for v_one in select * from jsonb_array_elements(v_out) loop
      perform give(p_world, p_uid, v_one->>'def', (v_one->>'count')::int,
        (v_one->>'ql')::double precision, v_one->>'extra');
      v_names := v_names || ((case when (v_one->>'count')::int > 1 then (v_one->>'count') || ' × ' else '' end)
        || lower((select coalesce(name, v_one->>'def') from item_def where id = v_one->>'def')));
    end loop;
    if array_length(v_names, 1) is null then return; end if;
    update placed set state = jsonb_set(state, '{output}', '[]'::jsonb) where id = v_p.id;
    perform tell(p_world, p_uid, case when p_action = 'kiln_take_all' then 'You unpack ' else 'You draw ' end
      || array_to_string(v_names, ', ')
      || case when p_action = 'kiln_take_all' then ' from the kiln.' else ' from the smelter.' end, 'event');
    return;
  end if;

  select * into v_it from item where id = target_item(p_target);
  v_jobs := furnace_jobs(v_p);

  if p_action = 'smelt_ore' then
    v_metal := metal_by_ore(v_it.def);
    if v_metal.id is null then return; end if;
    v_n := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), v_it.count),
      furnace_capacity('smelter') - jsonb_array_length(v_jobs)));
    if not consume(p_world, p_uid, v_it.def, v_n, v_it.id) then return; end if;
    v_secs := smelt_seconds(v_metal.id, v_it.ql, v_p.ql);
    for v_i in 1..v_n loop
      v_jobs := v_jobs || jsonb_build_object('makes', v_metal.lump, 'left', v_secs,
        'total', v_secs, 'ql', v_it.ql);
    end loop;
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You charge the smelter with '
      || case when v_n > 1 then v_n || ' × ' else '' end
      || lower((select name from item_def where id = v_it.def))
      || '. Each takes about ' || round(v_secs) || ' seconds of heat.', 'event');

  elsif p_action = 'load_kiln' then
    if v_it.id is null then
      select * into v_it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and exists (select 1 from pottery_def where unfired = def) order by id limit 1;
    end if;
    v_makes := (select fired from pottery_def where unfired = v_it.def);
    if v_makes is null then return; end if;
    v_n := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), v_it.count),
      furnace_capacity('kiln') - jsonb_array_length(v_jobs)));
    if not consume(p_world, p_uid, v_it.def, v_n, v_it.id) then return; end if;
    v_secs := fire_seconds(v_it.def, v_p.ql);
    v_ql := fired_ql(v_it.ql, v_p.ql);
    for v_i in 1..v_n loop
      v_jobs := v_jobs || jsonb_build_object('makes', v_makes, 'left', v_secs, 'total', v_secs, 'ql', v_ql);
    end loop;
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You pack '
      || case when v_n > 1 then v_n || ' × ' else '' end
      || lower((select name from item_def where id = v_it.def))
      || ' into the kiln. Each needs about ' || round(v_secs) || ' seconds of heat.', 'event');

  elsif p_action = 'cast_anvil' then
    v_metal := metal_by_lump(v_it.def);
    select lumps into v_need from mould_def where id = 'anvil_mould';
    select i.* into v_mould from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = 'anvil_mould' order by i.ql desc limit 1;
    if v_metal.id is null or v_mould.id is null or v_it.count < v_need then return; end if;
    if not consume(p_world, p_uid, v_it.def, v_need, v_it.id) then return; end if;
    -- The mould is spent by a piece this size, whatever quality it was.
    if not consume(p_world, p_uid, 'anvil_mould', 1, v_mould.id) then return; end if;
    v_ql := greatest(1, least(100, (v_it.ql + v_mould.ql
      + product_ql(skill_of(p_world, p_uid, 'blacksmithing'))) / 3));
    v_secs := cast_seconds(v_metal.id, v_ql);
    -- An anvil remembers what it was poured from; that is what `extra` is for.
    v_jobs := v_jobs || jsonb_build_object('makes', 'anvil', 'left', v_secs, 'total', v_secs,
      'ql', v_ql, 'extra', v_metal.id);
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You pour ' || v_need || ' lumps of ' || lower(v_metal.name)
      || ' into the anvil mould. It needs about ' || round(v_secs) || ' seconds to cool.', 'event');
  end if;
end $function$;

-- perform_forge (7)
CREATE OR REPLACE FUNCTION public.perform_forge(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item; m metal_def;
        v_per double precision; v_room double precision; v_fits int; v_whole int;
        v_ql double precision; v_mould_ql double precision; v_hard double precision;
        v_rare text; v_made bigint; v_broke boolean; v_sz int[]; v_sx int; v_sy int;
        v_gained double precision; v_left double precision;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    perform placed_settle((p_target->>'id')::bigint);
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;

    if p_action = 'fuel_oven' then
      select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and not locked and fuel_value(def) is not null
        and (target_item(p_target) is null or id = target_item(p_target))
        order by id limit 1;
      if not found then return; end if;
      v_per := fuel_value(it.def);
      v_room := greatest(0, hearth_capacity(p) - p.fuel);
      v_fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                                  ceil(v_room / v_per)::int));
      if not consume(p_world, p_uid, it.def, v_fits, it.id) then return; end if;
      update placed set fuel = least(hearth_capacity(p), p.fuel + v_per * v_fits), since = now()
        where id = p.id;
      perform tell(p_world, p_uid, 'You feed '
        || case when v_fits > 1 then v_fits || ' × ' else 'a ' end
        || lower((select name from item_def where id = it.def)) || ' into the oven. '
        || oven_burns_for(least(hearth_capacity(p), p.fuel + v_per * v_fits) / placed_burn_rate(p)) || ' of fuel.', 'event');

    elsif p_action = 'light_oven' then
      update placed set lit = true, since = now() where id = p.id;
      perform tell(p_world, p_uid, 'The oven draws and the fire takes hold. '
        || oven_burns_for(p.fuel) || ' of fuel.', 'event');

    elsif p_action = 'put_out_oven' then
      update placed set lit = false, since = now() where id = p.id;
      perform tell(p_world, p_uid,
        'You rake the fire out of the oven. It will keep its heat for nobody.', 'event');

    elsif p_action = 'take_ashes_oven' then
      v_whole := floor(p.ash)::int;
      update placed set ash = p.ash - v_whole, since = now() where id = p.id;
      perform give(p_world, p_uid, 'ash', v_whole, 20);
      perform tell(p_world, p_uid, 'You rake ' || v_whole
        || case when v_whole = 1 then ' lot' else ' lots' end
        || ' of ashes out of the oven. (QL 20)', 'event');
    end if;
    return;
  end if;

  if p_action in ('candle_lantern', 'light_lantern', 'douse_lantern') then
    perform lantern_settle(target_item(p_target));
    select * into it from item where world_id = p_world and id = target_item(p_target);
    if not found then return; end if;
    if p_action = 'candle_lantern' then
      if not consume(p_world, p_uid, 'candle', 1) then return; end if;
      update item set charges = round(candle_burn(it.ql))::int, lit = false, lit_at = null
        where id = it.id;
      perform tell(p_world, p_uid, 'You set a candle in the lantern. '
        || ceil(candle_burn(it.ql) / 60) || ' minutes of it, at a guess.', 'event');
    elsif p_action = 'light_lantern' then
      -- A torch is wound and then lit; the pitch in it only starts burning at
      -- the moment it catches, so its clock starts here rather than at the bench.
      if it.def = 'torch' and candle_left(it) <= 0 then
        update item set charges = round(torch_burn(it.ql))::int where id = it.id;
        select * into it from item where id = it.id;
      end if;
      update item set lit = true, lit_at = now() where id = it.id;
      perform tell(p_world, p_uid, case when it.def = 'torch'
        then 'You touch the torch to the ' || flame_near(p_world, p_uid, it.id)
             || ' and it takes. ' || ceil(candle_left(it) / 60) || ' minutes of it, throwing '
             || held_reach(it.def, it.ql) || ' tiles.'
        else 'You take a light off the ' || flame_near(p_world, p_uid, it.id)
             || ' and the lantern throws it ' || held_reach(it.def, it.ql) || ' tiles.' end, 'event');
    else
      v_left := candle_left(it);
      update item set lit = false, lit_at = null, charges = round(v_left)::int where id = it.id;
      perform tell(p_world, p_uid, case when it.def = 'torch'
        then 'You smother the torch. ' || ceil(v_left / 60)
             || ' minutes of it left, if it will take again.'
        else 'You pinch the wick out. ' || ceil(v_left / 60) || ' minutes of candle saved.' end, 'event');
    end if;
    return;
  end if;

  if p_action = 'place_anvil' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'anvil' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return; end if;
    v_sx := least(subtiles() - anvil_subtiles(), greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - anvil_subtiles(), greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, 'anvil', coalesce(it.extra, 'copper'),
            (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 1.0) / subtiles(),
            (p_target->>'y')::int + (v_sy + 1.0) / subtiles(), it.ql, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' || lower(anvil_name(p))
      || ' down. Bring a filled mould to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_anvil' then
    perform give(p_world, p_uid, 'anvil', 1, p.ql, p.sub);
    perform tell(p_world, p_uid, 'You heave the ' || lower(anvil_name(p))
      || ' up onto your shoulder.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  -- Smithing: the mould, the metal, the anvil and the hands, in that order.
  select * into v_mould from item where world_id = p_world
    and id = nullif(p_target->>'mould', '')::bigint;
  select * into d from mould_def where id = v_mould.def;
  v_lump := smith_lump(p_world, p_uid, target_item(p_target));
  select * into m from metal_def where lump = v_lump.def;
  if v_mould.id is null or d.id is null or v_lump.id is null or m.id is null
     or v_lump.count < d.lumps then return; end if;
  if not consume(p_world, p_uid, v_lump.def, d.lumps, v_lump.id) then return; end if;

  v_mould_ql := greatest(1, v_mould.ql - v_mould.dmg / 2);
  -- Every filling wears the mould, and a hard metal takes more out of it.
  v_broke := v_mould.dmg + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30) >= 100;
  if v_broke then
    delete from item where id = v_mould.id;
  else
    update item set dmg = least(100, v_mould.dmg
        + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30))
      where id = v_mould.id;
  end if;

  -- The deeper the seam it came out of, the harder it is to beat into shape.
  v_hard := d.difficulty + (mat_of(v_lump.extra)).difficulty;
  if not skill_check(skill_of(p_world, p_uid, d.skill), v_hard, anvil_ql(p),
                     mind_ease(p_world, p_uid)) then
    v_gained := skill_raise(p_world, p_uid, d.skill, try_gain(false, smith_gain()));
    perform tell(p_world, p_uid, 'The '
      || lower((select name from item_def where id = d.makes))
      || ' comes out misshapen and you throw the metal back.'
      || case when v_broke then ' The ' || lower((select name from item_def where id = v_mould.def))
                                || ' cracks through.' else '' end, 'event');
    return;
  end if;

  v_ql := smith_ql(p_world, p_uid, d.skill, v_mould_ql, v_lump.ql, anvil_ql(p));
  v_gained := skill_raise(p_world, p_uid, d.skill, try_gain(true, smith_gain()));
  v_rare := rarity_roll();
  v_made := give(p_world, p_uid, d.makes, d.per, v_ql, m.name, v_rare);
  perform journal_made(p_world, p_uid, d.makes, v_ql, d.per, v_rare);
  perform journal_note(p_world, p_uid, 'smithed');
  -- The four that come out of the deep seams, which are worth a line of their own.
  if m.id in ('adamantine', 'glimmersteel', 'mithril', 'seryll') then
    perform journal_note(p_world, p_uid, 'moonmetal');
  end if;
  if v_rare is not null then
    perform journal_note(p_world, p_uid, v_rare);
    perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
  end if;
  perform tell(p_world, p_uid, 'You beat out '
    || case when d.per > 1 then d.per || ' ' else 'a ' end
    || lower(m.name) || ' '
    || case when d.per > 1 and right(lower((select name from item_def where id = d.makes)), 1) <> 's'
            then lower((select name from item_def where id = d.makes)) || 's'
            else lower((select name from item_def where id = d.makes)) end
    || ' on the ' || lower(anvil_name(p)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')'
    || case when v_broke then ' The ' || lower((select name from item_def where id = v_mould.def))
                              || ' cracks through and is done.'
            else ' The mould has ' || mould_uses_left(v_mould.ql, v_mould.dmg
                   + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30))
                 || ' fillings left.' end, 'event');
end $function$;

-- perform_ground (1)
CREATE OR REPLACE FUNCTION public.perform_ground(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        d action_def; v_spoil text;
        v_skill double precision; v_tool double precision; v_ql double precision; v_n int;
        v_gained double precision; v_slab item; v_kind int; v_target int; v_hi record; v_lo record;
        v_rock rock_def; v_rad int; v_tiles int[] := '{}'; v_names text[] := '{}'; v_row record;
        v_id bigint; v_species int; v_sprout item; v_buried text; v_size int;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);
  select * into d from action_def where id = p_action;
  -- What this ground is made of, which digging has always read off the tile
  -- and flattening never did.
  v_spoil := coalesce(t.dig_yield, 'dirt');

  if p_action = 'flatten' then
    v_target := flatten_target(p_world, p_uid, tx, ty);
    -- The corners furthest above and below the height we are working towards.
    select c.cx, c.cy into v_hi from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) > v_target
      order by land_height(p_world, c.cx, c.cy) desc limit 1;
    select c.cx, c.cy into v_lo from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) < v_target
      order by land_height(p_world, c.cx, c.cy) limit 1;
    if v_hi.cx is null and v_lo.cx is null then return; end if;
    -- Only soil can be moved with a shovel; bedrock needs a pickaxe.
    if v_hi.cx is not null and land_dirt(p_world, v_hi.cx, v_hi.cy) <= 0 then
      perform tell(p_world, p_uid, 'The high corner is bare rock. Mine it down instead.', 'error');
      return;
    end if;
    if v_hi.cx is not null and v_lo.cx is not null then
      -- One corner down and one up: the dirt simply moves across the tile.
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
      perform tell(p_world, p_uid, 'You move some dirt across the tile.', 'event');
    elsif v_hi.cx is not null then
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform give(p_world, p_uid, v_spoil, 1,
        product_ql(skill_of(p_world, p_uid, d.skill), tool_ql(p_world, p_uid, 'shovel')));
      perform tell(p_world, p_uid, 'You scrape the ground down and pocket the '
        || lower((select name from item_def where id = v_spoil)) || '.', 'event');
    else
      /*
       * Its own stuff first and dirt after. Dirt fills anything, and it would
       * be a strange rule that let you take clay out of a bank and not put it
       * back.
       */
      if consume(p_world, p_uid, v_spoil, 1) then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        perform tell(p_world, p_uid, 'You pack '
          || lower((select name from item_def where id = v_spoil))
          || ' in to bring the ground up.', 'event');
      elsif consume(p_world, p_uid, 'dirt', 1) then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        perform tell(p_world, p_uid, 'You pack dirt in to bring the ground up.', 'event');
      else
        perform tell(p_world, p_uid, 'You need '
          || lower((select name from item_def where id = v_spoil))
          || ' or dirt to bring this ground up to your level.', 'error');
        return;
      end if;
    end if;
    -- And what an hour of levelling ground teaches, which was nothing at all.
    v_gained := skill_raise(p_world, p_uid, d.skill, 1);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    if not needs_flattening(p_world, p_uid, tx, ty) then
      perform tell(p_world, p_uid,
        case when floor((select x from player where world_id = p_world and uid = p_uid))::int = tx
              and floor((select y from player where world_id = p_world and uid = p_uid))::int = ty
             then 'The tile is now flat at its lowest corner.'
             else 'The tile is now flat and level with the ground you stand on.' end, 'event');
    end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    perform raise_corner(p_world, cx, cy, 1);
    if here in (0, 20) then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You drop the dirt on the ' || corner_name(tx, ty, cx, cy)
      || ' corner, raising the ground.', 'event');

  elsif p_action = 'pave_slabs' then
    select i.* into v_slab from item i join slab_def s on s.item = i.def
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
      order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select id into v_kind from slab_def where item = v_slab.def;
    if not skill_check(skill_of(p_world, p_uid, 'paving'), 10, v_slab.ql) then
      v_gained := skill_raise(p_world, p_uid, 'paving', try_gain(false));
      perform tell(p_world, p_uid,
        'The slab rocks on its bed however you set it. You leave it for now.', 'event');
      perform skill_said(p_world, p_uid, 'paving', v_gained);
      return;
    end if;
    if not consume(p_world, p_uid, v_slab.def, 1, v_slab.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 21);
    perform land_set_data(p_world, tx, ty, v_kind);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You bed the '
      || lower((select name from item_def where id = v_slab.def)) || ' down flat and true.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'remove_paving' then
    -- A slab comes up whole more often than not; gravel and cobbles do not.
    v_kind := case when here = 21 then v_data & 3 else null end;
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    if v_kind is not null and random() < 0.6 then
      v_ql := product_ql(skill_of(p_world, p_uid, 'paving'));
      perform give(p_world, p_uid, (select item from slab_def where id = v_kind), 1, v_ql);
      perform tell(p_world, p_uid, 'You lever the '
        || regexp_replace(lower((select name from slab_def where id = v_kind)), 's$', '')
        || ' up whole. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    else
      perform tell(p_world, p_uid, 'You break up the paving, leaving bare dirt.', 'event');
    end if;
    v_gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'cut_grass' then
    perform mark_foraged(p_world, tx, ty, 'grass');
    perform give(p_world, p_uid, 'mixed_grass', 2, product_ql(skill_of(p_world, p_uid, 'foraging')));
    perform tell(p_world, p_uid, 'You cut two bundles of mixed grass.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_reeds' then
    perform mark_foraged(p_world, tx, ty, 'reed');
    v_skill := skill_of(p_world, p_uid, 'foraging');
    v_n := 2 + case when random() < v_skill / 140 then 1 else 0 end;
    perform give(p_world, p_uid, 'reed', v_n,
      product_ql(v_skill, tool_ql(p_world, p_uid, 'carving_knife')));
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' reeds out of the bed.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'pick_fruit' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- An old tree carries more than one only just come into bearing.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_n := greatest(1, round(case when tree_age(v_data) = 2 then 5 else 3 end
                             * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int);
    v_ql := product_ql(v_skill);
    perform give(p_world, p_uid, v_tree.fruit, v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You pick ' || v_n || ' '
      || lower((select name from item_def where id = v_tree.fruit))
      || case when v_n = 1 then '' else 's' end
      || ' off the ' || lower(v_tree.name) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'pick_sprout' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not skill_check(skill_of(p_world, p_uid, 'forestry'), 15) then
      v_gained := skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You find no sprout worth picking.', 'event');
      perform skill_said(p_world, p_uid, 'forestry', v_gained);
      return;
    end if;
    perform give(p_world, p_uid, 'sprout', 1,
      product_ql(skill_of(p_world, p_uid, 'forestry')), v_tree.name);
    perform tell(p_world, p_uid, 'You pick a ' || lower(v_tree.name) || ' sprout.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'plant' then
    select * into v_sprout from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'sprout' and not locked order by id limit 1;
    if not found then return; end if;
    v_species := coalesce((select id from tree_def where name = v_sprout.extra), 0);
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 16);
    -- Species in the low nibble, age in the two bits above it: a planted tree
    -- starts as a sapling and grows on the same clock as one that seeded itself.
    perform land_set_data(p_world, tx, ty, v_species & 15);
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'planted');
    if (select fruit from tree_def where id = v_species) is not null then
      perform journal_note(p_world, p_uid, 'orchard');
    end if;
    perform tell(p_world, p_uid, 'You plant the '
      || lower((select name from tree_def where id = v_species)) || ' sprout.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'dig_worms' then
    v_gained := skill_raise(p_world, p_uid, 'digging', 0.2);
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id, 0.4); end if;
    -- Damp ground gives more than dry: a marsh is full of them.
    v_n := floor(random() * case when t.rich_worms then 5 else 3 end)::int
           + case when t.rich_worms then 1 else 0 end;
    if v_n = 0 then
      perform tell(p_world, p_uid, 'You turn a spadeful over and nothing is moving in it.', 'event');
      return;
    end if;
    perform give(p_world, p_uid, 'worm', v_n, 20 + random() * 40);
    perform journal_note(p_world, p_uid, 'worms');
    perform tell(p_world, p_uid, 'You turn the dirt over and pick ' || v_n || ' worm'
      || case when v_n > 1 then 's' else '' end || ' out of it.', 'event');

  elsif p_action = 'prospect' then
    v_skill := skill_of(p_world, p_uid, 'prospecting');
    v_rad := prospect_radius(v_skill);
    v_size := (select size from world where id = p_world);
    -- Metal counts wherever it lies: bare, under soil, or below water.
    for v_row in select x, y, (bedrock_at(p_world, x, y)).name as nm
      from generate_series(greatest(0, tx - v_rad), least(v_size - 1, tx + v_rad)) x
      cross join generate_series(greatest(0, ty - v_rad), least(v_size - 1, ty + v_rad)) y
      -- Anything worth mining, not only what is metal: a coal seam is a
      -- seam, and asking `ore` is asking whether its name ends in `_ore`.
      where (bedrock_at(p_world, x, y)).seam
      order by y, x
    loop
      v_tiles := v_tiles || (v_row.y * v_size + v_row.x);
      v_names := v_names || lower(v_row.nm);
    end loop;
    perform mark_prospected(p_world, p_uid, v_tiles);

    -- Sampling where you stand tells you what that particular rock holds.
    v_rock := bedrock_at(p_world, tx, ty);
    v_ql := ore_max_ql((select seed from world where id = p_world), tx, ty);
    v_buried := case when here = 4 then ''
      else ' It lies under ' || greatest(1, land_dirt(p_world, tx, ty)) || ' of ground.' end;
    if v_rock.seam then
      perform tell(p_world, p_uid, 'You sample the ' || lower(v_rock.name)
        || '. It needs mining ' || to_char(v_rock.level, 'FM990')
        || ' to work' || case when skill_of(p_world, p_uid, 'mining') >= v_rock.level
                              then ', which you have' else '' end
        || ', and will give up nothing finer than quality ' || to_char(v_ql, 'FM990')
        || '.' || v_buried, 'event');
    else
      perform tell(p_world, p_uid, 'Plain ' || lower(v_rock.name)
        || ' beneath you, with no metal in it, and nothing finer than quality '
        || to_char(v_ql, 'FM990') || ' in the stone.' || v_buried, 'event');
    end if;

    if coalesce(array_length(v_tiles, 1), 0) = 0 then
      perform tell(p_world, p_uid, 'You read the ground ' || v_rad
        || ' tiles about you and find no sign of anything worth mining.', 'event');
    else
      perform tell(p_world, p_uid, 'Within ' || v_rad || ' tiles you read '
        || (select string_agg(case when n > 1 then n || ' tiles of ' || nm
                                   else 'a tile of ' || nm end, ' and ' order by nm)
            from (select nm, count(*) as n from unnest(v_names) nm group by nm) q)
        || ', buried or bare. They are marked for a while.', 'event');
    end if;
    v_gained := skill_raise(p_world, p_uid, 'prospecting', 1);
  end if;

  perform skill_said(p_world, p_uid,
    (select skill from action_def where id = p_action), v_gained);
end $function$;

-- perform_hands (5)
CREATE OR REPLACE FUNCTION public.perform_hands(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare it item; p player; v_x int; v_y int; v_want int; v_name text; v_was text;
        v_took bigint[]; v_row record; v_left int;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'examine' then
    perform tell(p_world, p_uid,
      examine_tile_text(p_world, (p_target->>'x')::int, (p_target->>'y')::int), 'event');

  elsif p_action = 'examine_item' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    if found then perform tell(p_world, p_uid, examine_item_text(p_world, p_uid, it), 'event'); end if;

  elsif p_action = 'lock_item' or p_action = 'unlock_item' then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if not found then return; end if;
    update item set locked = (p_action = 'lock_item') where id = it.id;
    if p_action = 'lock_item' then
      perform tell(p_world, p_uid, 'You set the ' || lower(item_name(it))
        || ' aside. Nothing will spend it, drop it or feed it away until you say so.', 'info');
    else
      perform tell(p_world, p_uid, 'The ' || lower(item_name(it)) || ' is fair game again.', 'info');
    end if;

  elsif p_action = 'drop' then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if not found then return; end if;
    v_want := least(greatest(1, coalesce((p_target->>'count')::int, 1)), it.count);
    if v_want >= it.count then
      -- The whole stack goes down as it stands, keeping its own number.
      update item set holder = 'ground', holder_uid = null, gx = floor(p.x)::int, gy = floor(p.y)::int,
          locked = false, made_at = now()
        where id = it.id;
    else
      update item set count = it.count - v_want where id = it.id;
      perform drop_on_ground(p_world, floor(p.x)::int, floor(p.y)::int, it.def, it.ql, it.extra, v_want);
    end if;
    perform tell(p_world, p_uid, 'You drop '
      || case when v_want > 1 then v_want || ' × ' || lower(item_name(it))
              else 'the ' || lower(item_name(it)) end
      || ' on the ground.', 'event');
    perform land_announce(p_world, floor(p.x)::int, floor(p.y)::int);

  elsif p_action = 'pick_up' then
    v_x := (p_target->>'x')::int; v_y := (p_target->>'y')::int;
    -- A named thing if the target says which; otherwise whatever is on top,
    -- which is how a pile answers when nobody has said.
    select * into it from item where world_id = p_world and holder = 'ground'
      and gx = v_x and gy = v_y
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return; end if;
    update item set holder = 'player', holder_uid = p_uid, gx = null, gy = null where id = it.id;
    perform tell(p_world, p_uid, 'You pick up ' ||
      case when it.count > 1 then it.count || ' × ' else '' end || lower(item_name(it)) || '.', 'event');
    perform land_announce(p_world, v_x, v_y);

  elsif p_action = 'pick_up_all' then
    v_x := (p_target->>'x')::int; v_y := (p_target->>'y')::int;
    /*
     * Nearest first, because a sweep that fills your hands should fill them
     * with what is under your feet rather than what is furthest away.
     */
    for v_row in select i.id, i.gx, i.gy from item i
      where i.world_id = p_world and i.holder = 'ground'
        and abs(i.gx - v_x) <= sweep_range() and abs(i.gy - v_y) <= sweep_range()
      order by (i.gx - v_x) ^ 2 + (i.gy - v_y) ^ 2, i.id
    loop
      update item set holder = 'player', holder_uid = p_uid, gx = null, gy = null where id = v_row.id;
      v_took := v_took || v_row.id;
      perform land_announce(p_world, v_row.gx, v_row.gy);
    end loop;
    if v_took is null then
      perform tell(p_world, p_uid, 'There is nothing lying about here.', 'error');
    else
      perform tell(p_world, p_uid, 'You gather up ' || pile_text(v_took) || '.', 'event');
    end if;

  elsif p_action = 'name_thing' then
    v_name := left(btrim(coalesce(p_target->>'name', '')), 28);
    if p_target->>'kind' = 'crate' then
      select coalesce(c.name, crate_name(c)) into v_was from crate c
        where c.world_id = p_world and c.id = (p_target->>'id')::int;
      update crate set name = nullif(v_name, '')
        where world_id = p_world and id = (p_target->>'id')::int;
    else
      select coalesce(pl.name, (select f.name from furniture_def f where f.id = pl.sub))
        into v_was from placed pl
        where pl.world_id = p_world and pl.id = (p_target->>'id')::bigint;
      update placed set name = nullif(v_name, '')
        where world_id = p_world and id = (p_target->>'id')::bigint;
    end if;
    if v_name = '' then
      -- An empty answer takes the name off again rather than leaving a blank.
      perform tell(p_world, p_uid, 'It goes back to being what it was.', 'info');
    else
      perform tell(p_world, p_uid, 'The ' || lower(coalesce(v_was, 'thing'))
        || ' is called ' || v_name || ' from now on.', 'info');
    end if;
  end if;
end $function$;

-- perform_holding (1)
CREATE OR REPLACE FUNCTION public.perform_holding(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare it item; p placed; v_bag item; v_want int; v_moved bigint; v_names text; v_n int;
begin
  if p_action = 'furniture_take_all' then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select string_agg(case when q.count > 1 then q.count || ' × ' || lower(item_name(q))
                           else lower(item_name(q)) end, ', ' order by q.id), count(*)
      into v_names, v_n
      from item q where q.placed = p.id and q.holder = 'furniture';
    if v_n = 0 then return; end if;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where placed = p.id and holder = 'furniture';
    perform tell(p_world, p_uid, 'You take ' || v_names || ' out of the '
      || lower(placed_name(p)) || '.', 'event');
    return;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target)
    and holder = 'player' and holder_uid = p_uid;
  if not found then return; end if;
  v_want := greatest(1, least(coalesce((p_target->>'count')::int, 1), it.count));

  if p_action = 'stow_item' then
    v_bag := first_bag(p_world, p_uid, it.def, v_want);
    if v_bag.id is null then return; end if;
    v_moved := move_part(it.id, v_want, 'bag', p_uid, v_bag.id, null);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, 'You put '
      || case when v_want > 1 then v_want || ' × ' else '' end || lower(item_name(it))
      || ' in the ' || lower((select name from item_def where id = v_bag.def)) || '.', 'event');

  elsif p_action = 'empty_bag' then
    select count(*) into v_n from item where inside = it.id and holder = 'bag';
    -- Back through `move_part` rather than a bare update, so what comes out
    -- merges into the stack it left rather than sitting beside it.
    for v_bag in select * from item where inside = it.id and holder = 'bag' order by id loop
      perform move_part(v_bag.id, v_bag.count, 'player', p_uid, null, null);
    end loop;
    perform tell(p_world, p_uid, 'You turn the '
      || lower((select name from item_def where id = it.def)) || ' out: ' || v_n
      || case when v_n = 1 then ' thing' else ' things' end || ' back in your pack.', 'event');

  elsif p_action = 'store_in_furniture' then
    p := nearest_store(p_world, p_uid, it.def, v_want);
    if p.id is null then return; end if;
    v_moved := move_part(it.id, v_want, 'furniture', null, null, p.id);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, 'You put '
      || case when v_want > 1 then v_want || ' × ' else 'the ' end || lower(item_name(it))
      || ' in the ' || lower(placed_name(p)) || '.', 'event');

  elsif p_action = 'throw_away' then
    p := trash_near(p_world, p_uid);
    if p.id is null then return; end if;
    v_moved := move_part(it.id, v_want, 'furniture', null, null, p.id);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, 'You throw '
      || case when v_want > 1 then v_want || ' × ' else 'the ' end || lower(item_name(it))
      || ' in the trash crate. It will not last long in there.', 'event');
  end if;
end $function$;

-- perform_item (1)
CREATE OR REPLACE FUNCTION public.perform_item(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_ok boolean; v_it item; v_what improvable_def; v_mat improve_material_def; v_stock item;
        v_made text; v_ceiling double precision; v_tool_ql double precision;
        v_healed double precision; v_lost double precision; v_skill double precision;
        v_favour text; v_full text; v_name text; v_p player; v_lift text;
begin
  if p_action = 'drink' then
    update player set stats = jsonb_set(stats, '{thirst}', '1') where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You drink the cool water. It is refreshing.', 'event');
    return;
  end if;

  v_it := carried(p_world, p_uid, target_item(p_target));
  if v_it.id is null then return; end if;
  v_name := lower((select coalesce(name, v_it.def) from item_def where id = v_it.def));
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'eat' then
    if not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    update player set stats = jsonb_set(stats, '{hunger}', to_jsonb(least(1,
        coalesce((v_p.stats->>'hunger')::double precision, 1)
        + coalesce((select food from item_def where id = v_it.def), 0) * (0.7 + v_it.ql / 200))))
      where world_id = p_world and uid = p_uid;
    -- A dish favours a trade, and having eaten it you are better at that
    -- trade for a while.
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql);
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql);
    perform tell(p_world, p_uid, 'You eat the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

  elsif p_action = 'drink_skin' then
    update item set charges = coalesce(charges, 1) - 1 where id = v_it.id;
    update player set stats = jsonb_set(stats, '{thirst}', to_jsonb(least(1,
        coalesce((v_p.stats->>'thirst')::double precision, 1)
        + coalesce((select drink from item_def where id = v_it.def), 0))))
      where world_id = p_world and uid = p_uid;
    -- Milk and anything brewed favour a trade the way a cooked dish does.
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql);
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql);
    perform tell(p_world, p_uid, 'You take a drink from the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

  elsif p_action = 'repair_item' then
    -- A second's work: some of the damage comes out, and a little of the
    -- quality with it — a little, not much, so mending a thing is not the end
    -- of it.
    v_skill := skill_of(p_world, p_uid, 'repair');
    v_healed := least(v_it.dmg, 1.2 + v_skill * 0.1);
    v_lost := v_healed * greatest(0.004, 0.03 - v_skill * 0.00026);
    update item set dmg = greatest(0, dmg - v_healed), ql = greatest(1, ql - v_lost)
      where id = v_it.id returning * into v_it;
    perform skill_raise(p_world, p_uid, 'repair', 0.25);
    if v_it.dmg <= 0 then
      perform tell(p_world, p_uid, 'The ' || v_name || ' is as sound as it will ever be again. (QL '
        || to_char(v_it.ql, 'FM990.0') || ')', 'event');
    end if;

  elsif p_action = 'improve_item' then
    select * into v_what from improvable_def where item = v_it.def;
    if not found then return; end if;
    select * into v_mat from improve_material_def where id = v_what.material;
    v_made := (mat_of(v_it.extra)).name;
    v_stock := stock_for(p_world, p_uid, v_mat.id, v_made);
    if v_stock.id is null or not consume(p_world, p_uid, v_stock.def, 1, v_stock.id) then return; end if;
    v_tool_ql := coalesce((select max(tool_ql(p_world, p_uid, t.tool)) from improve_tool t
                           where t.material = v_mat.id), 0);
    -- A failed pass marks the piece rather than spoiling it outright. Oak and
    -- the deep metals are stubborn under the file as under the saw. The gain
    -- used to be written above the roll, which paid a marked piece what a
    -- passed one is worth.
    v_ok := skill_check(skill_of(p_world, p_uid, v_what.skill),
        12 + v_it.ql / 3 + mat_difficulty(v_it.extra), v_tool_ql,
        mind_ease(p_world, p_uid));
    perform skill_raise(p_world, p_uid, v_what.skill, try_gain(v_ok, improve_gain()));
    if not v_ok then
      perform damage_item(v_it.id, 3 + random() * 5);
      perform tell(p_world, p_uid, 'You work at the ' || v_name || ' and mark it. (damage '
        || to_char((select dmg from item where id = v_it.id), 'FM990.0') || ')', 'event');
      return;
    end if;
    v_ceiling := least(99.9, improve_ceiling(p_world, p_uid, v_what.skill, v_it.rare));
    update item set ql = greatest(ql, least(v_ceiling,
        ql + improve_step(skill_of(p_world, p_uid, v_what.skill), ql)))
      where id = v_it.id returning * into v_it;
    /*
     * And now and again the thing itself comes on, not only its quality.
     *
     * The same odds as the bench, one step at a time: a hundred good passes
     * turn a plain thing rare about once, a thousand a rare thing supreme, ten
     * thousand a supreme thing fantastic. Never two steps, so the only road to
     * the top of it is through the middle of it.
     *
     * A step up also lifts the ceiling it may be bettered to, which is the
     * next pass's business rather than this one's — `v_ceiling` above was
     * worked out for the thing as it stood when this pass started.
     */
    v_lift := rarity_lift(v_it.rare);
    if v_lift is not null then
      update item set rare = v_lift where id = v_it.id returning * into v_it;
      perform journal_note(p_world, p_uid, v_lift);
      perform tell(p_world, p_uid,
        (select r.lift from rarity_def r where r.id = v_lift), 'skill');
    end if;
    perform tell(p_world, p_uid, 'The ' || v_name || ' is better than it was. (QL '
      || to_char(v_it.ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;

-- perform_last (2)
CREATE OR REPLACE FUNCTION public.perform_last(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_took boolean; p player; pc placed; b bridge; d bridge_def; s bridge_span; c creature; mate creature;
        dam creature; sire creature; it item; dye item; bd brew_def; dd dye_def;
        v_kind text; v_id bigint; v_h int; v_n int; v_left int; v_want text; v_back jsonb;
        v_parts text[]; v_half int; e record; r record; v_skill double precision;
        v_care double precision; v_one bigint; v_stock item; v_ql double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    if bridge_reason(p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
         (p_target->>'x')::int, (p_target->>'y')::int) is not null then return; end if;
    select * into d from bridge_def where id = v_kind;
    v_h := round((centre_height(p_world, floor(p.x)::int, floor(p.y)::int)
                + centre_height(p_world, (p_target->>'x')::int, (p_target->>'y')::int)) / 2);
    insert into bridge (world_id, kind, ax, ay, bx, by, height, material, made_by)
    values (p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
            (p_target->>'x')::int, (p_target->>'y')::int, v_h,
            case when v_kind = 'stone' then null else 'Oak' end, p_uid)
    returning id into v_id;
    insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select p_world, v_id, t.n, t.x, t.y, span_bill(v_kind), span_bill(v_kind)
    from span_tiles(floor(p.x)::int, floor(p.y)::int,
                    (p_target->>'x')::int, (p_target->>'y')::int) t;
    select count(*)::int into v_n from bridge_span sp where sp.world_id = p_world and sp.bridge = v_id;
    perform journal_note(p_world, p_uid, 'planned_bridge');
    perform skill_raise(p_world, p_uid, d.skill, 0.4);
    perform tell(p_world, p_uid, 'You set out a ' || lower(d.name) || ' of ' || v_n || ' span'
      || case when v_n > 1 then 's' else '' end || ' across. Each one wants '
      || span_wants(span_bill(v_kind)) || '. ' || d.note, 'system');

  elsif p_action = 'build_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select * into d from bridge_def where id = b.kind;
    select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
      and not span_done(sp.needed) order by sp.n limit 1;
    if not found then return; end if;
    -- One unit of one thing per go, as with a wall.
    select e2.key into v_want from jsonb_each(s.needed) e2
      where (e2.value)::int > 0 and pack_count(p_world, p_uid, e2.key) > 0 order by e2.key limit 1;
    if v_want is null then return; end if;
    if not consume(p_world, p_uid, v_want, 1) then return; end if;
    update bridge_span sp set needed = jsonb_set(sp.needed, array[v_want],
        to_jsonb(greatest(0, (sp.needed->>v_want)::int - 1)))
      where sp.world_id = p_world and sp.bridge = b.id and sp.n = s.n
      returning * into s;
    perform skill_raise(p_world, p_uid, d.skill, 0.5);
    perform wear_tool((select i.id from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1), 0.4);
    if span_done(s.needed) then
      v_left := bridge_left(p_world, b.id);
      if v_left > 0 then
        perform tell(p_world, p_uid, 'That span is decked. ' || v_left || ' still open.', 'event');
      else
        perform journal_note(p_world, p_uid, 'bridged');
        perform tell(p_world, p_uid, 'The last span is decked and the ' || lower(bridge_name(b))
          || ' is open. ' || case when d.carts then 'A cart will cross it.'
                                  else 'Foot traffic only; nothing with a wheel.' end, 'system');
      end if;
    else
      perform tell(p_world, p_uid, 'You work a '
        || lower((select coalesce(name, v_want) from item_def where id = v_want))
        || ' into the span. It still wants ' || span_wants(s.needed) || '.', 'event');
    end if;

  elsif p_action = 'demolish_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    -- Half of what went into it comes back, which is what pulling a thing down
    -- is worth anywhere else in the world.
    v_parts := '{}';
    for e in
      select k.key as item, sum((k.value)::int - coalesce((sp.needed->>k.key)::int, 0))::int as used
      from bridge_span sp cross join lateral jsonb_each(sp.total) k
      where sp.world_id = p_world and sp.bridge = b.id
      group by k.key order by k.key
    loop
      v_half := floor(e.used / 2.0)::int;
      if v_half > 0 then
        perform give(p_world, p_uid, e.item, v_half, 20);
        v_parts := v_parts || (v_half || ' ' ||
          lower((select coalesce(name, e.item) from item_def where id = e.item)));
      end if;
    end loop;
    delete from bridge_span where world_id = p_world and bridge = b.id;
    delete from bridge where world_id = p_world and id = b.id;
    perform tell(p_world, p_uid, case when array_length(v_parts, 1) > 0
      then 'You take the ' || lower(bridge_name(b)) || ' down and save '
           || array_to_string(v_parts, ', ') || '.'
      else 'You take the ' || lower(bridge_name(b)) || ' down.' end, 'event');

  elsif p_action = 'sleep' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    -- A well-made bed is a better night than a cot with a thin mattress.
    perform journal_note(p_world, p_uid, 'slept');
    perform sleep_until_morning(p_world, p_uid,
      (select bed from furniture_def where id = pc.sub) * (0.6 + pc.ql / 250),
      lower(placed_name(pc)));

  elsif p_action = 'set_home' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    update player set home_x = pc.x, home_y = pc.y where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You make up the ' || lower(placed_name(pc))
      || '. This is where you will wake, whatever happens to you.', 'event');

  elsif p_action = 'pair_creature' then
    c := target_creature(p_world, p_target);
    mate := mate_for(p_world, c);
    if c.world_id is null or mate.id is null or pair_refuses(p_world, c, mate) is not null then return; end if;
    if c.sex = 'female' then dam := c; sire := mate; else dam := mate; sire := c; end if;
    v_skill := skill_of(p_world, p_uid, 'animal_husbandry');
    v_care := (dam.care + sire.care) / 2;
    v_took := random() < breed_chance(v_skill, v_care);
    perform skill_raise(p_world, p_uid, 'animal_husbandry', try_gain(v_took, breed_gain()));
    if not v_took then
      -- A failed pairing costs both of them a rest, but only half of one.
      update creature set bred_at = now() - make_interval(secs => breed_rest() / 2)
        where world_id = p_world and id in (dam.id, sire.id);
      perform tell(p_world, p_uid, dam.name || ' and ' || sire.name
        || ' will have nothing to do with one another. Brush them, feed them, and try again.', 'error');
      return;
    end if;
    perform pair_them(p_world, dam.id, sire.id, v_skill);
    perform journal_note(p_world, p_uid, 'paired');
    perform tell(p_world, p_uid, sire.name || ' is put to ' || dam.name
      || '. She is in young and will drop in about ' || clock_left(gestation())
      || '. Between them they carry '
      || trait_names((select array_agg(distinct t) from unnest(sire.traits || dam.traits) t))
      || '.', 'event');

  elsif p_action = 'read_blood' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    perform tell(p_world, p_uid, blood_read(p_world, p_uid, c), 'event');

  elsif p_action = 'dye_item' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    dye := pick_dye(p_world, p_uid);
    if it.id is null or dye.id is null then return; end if;
    select * into dd from dye_def where name = dye.extra;
    if not consume(p_world, p_uid, 'dye', 1) then return; end if;
    -- One pot does one thing. A stack is split so the rest stays as it was.
    if it.count > 1 then
      update item set count = count - 1 where id = it.id;
      insert into item (world_id, holder, holder_uid, def, ql, dmg, count, extra, rare, dye)
      values (p_world, it.holder, it.holder_uid, it.def, it.ql, it.dmg, 1, it.extra, it.rare, dd.id);
    else
      update item set dye = dd.id where id = it.id;
    end if;
    perform journal_note(p_world, p_uid, 'dyed');
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work the ' || lower(dd.name)
      || ' through it. It comes out ' || dd.word || '.', 'event');

  elsif p_action = 'strip_dye' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    if it.id is null then return; end if;
    select * into dye from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = 'lye_bucket' order by i.id limit 1;
    if dye.id is null or not consume(p_world, p_uid, 'lye_bucket', 1) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, dye.ql);
    update item set dye = null where id = it.id;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.2);
    perform tell(p_world, p_uid, 'You boil it out in lye. It is back to the colour of '
      || lower((select coalesce(name, it.def) from item_def where id = it.def)) || '.', 'event');

  elsif p_action = 'start_brew' then
    select * into bd from brew_def where id = p_target->>'brew';
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if bd.id is null or pc.id is null
       or brew_reason(p_world, p_uid, pc, bd) is not null then return; end if;
    -- What goes in decides most of what comes out; the hand only decides how
    -- much of it survives the working.
    select * into v_stock from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = bd.input order by i.id limit 1;
    v_ql := coalesce(v_stock.ql, 20);
    if not consume(p_world, p_uid, bd.input, bd.count) then return; end if;
    if not skill_check(skill_of(p_world, p_uid, 'brewing'), bd.difficulty, 0) then
      update placed set litres = greatest(0, placed_litres(pc) - bd.litres), since = now()
        where id = pc.id;
      update placed set liquid = null where id = pc.id and litres <= 0;
      perform skill_raise(p_world, p_uid, 'brewing', try_gain(false, brew_gain()));
      perform tell(p_world, p_uid, 'It will not take. You tip the whole soured lot out of the '
        || lower(placed_name(pc)) || '.', 'event');
      return;
    end if;
    update placed set litres = bd.litres, liquid = bd.id, ferment = bd.seconds, since = now(),
        ql = greatest(1, least(100, (v_ql + skill_of(p_world, p_uid, 'brewing')) / 2))
      where id = pc.id;
    perform journal_note(p_world, p_uid, 'brew');
    perform journal_note(p_world, p_uid, 'brew:' || bd.id);
    perform skill_raise(p_world, p_uid, 'brewing', try_gain(true, brew_gain()));
    perform tell(p_world, p_uid, bd.done || ' (about ' || round(bd.seconds / 60) || ' minutes)', 'event');
  end if;
end $function$;

-- perform_liquid (1)
CREATE OR REPLACE FUNCTION public.perform_liquid(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare it item; p placed; v_kind text; v_from placed; v_full text; v_room double precision;
        v_poured double precision; v_favour text; v_full_msg text; v_thirst double precision;
begin
  if p_action in ('fill_bucket', 'fill_skin', 'empty_bucket', 'pour_into_barrel') then
    it := carried(p_world, p_uid, target_item(p_target));
    if it.id is null then return; end if;
  else
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
  end if;

  if p_action = 'fill_bucket' then
    -- A barrel beside you first, and the shore only if there is none.
    select * into v_from from vessels_near(p_world, p_uid) v
      where placed_litres(v) >= bucket_litres() limit 1;
    if found then
      v_kind := placed_liquid(v_from);
      if not draw_from(v_from.id, bucket_litres()) then return; end if;
    elsif near_water(p_world, p_uid) then
      v_kind := 'water';
    else
      return;
    end if;
    select item into v_full from vessel_def where liquid = v_kind limit 1;
    if not vessel_becomes(it.id, v_full) then return; end if;
    perform tell(p_world, p_uid, case when v_from.id is not null
      then 'You draw a bucket of ' || (select name from liquid_def where id = v_kind)
           || ' out of the ' || lower(placed_name(v_from)) || '.'
      else 'You dip the bucket full of water.' end, 'event');

  elsif p_action = 'fill_skin' then
    update item set charges = (select charges from item_def where id = it.def) where id = it.id;
    perform tell(p_world, p_uid, 'You fill the '
      || lower((select name from item_def where id = it.def)) || ' with water.', 'event');

  elsif p_action = 'empty_bucket' then
    select empty into v_full from vessel_def where item = it.def;
    if v_full is null then return; end if;
    if not vessel_becomes(it.id, v_full) then return; end if;
    perform tell(p_world, p_uid, 'You tip the '
      || lower((select name from item_def where id = it.def)) || ' out.', 'event');

  elsif p_action = 'pour_into_barrel' then
    select liquid into v_kind from vessel_def where item = it.def;
    v_from := barrel_for(p_world, p_uid, v_kind);
    if v_from.id is null then return; end if;
    v_room := liquid_capacity(v_from) - placed_litres(v_from);
    v_poured := least(bucket_litres(), v_room);
    if v_poured <= 0 then return; end if;
    if not vessel_becomes(it.id, (select empty from vessel_def where item = it.def)) then return; end if;
    update placed set litres = placed_litres(v_from) + v_poured, liquid = v_kind, since = now()
      where id = v_from.id;
    perform tell(p_world, p_uid, 'You pour ' || to_char(v_poured, 'FM990') || ' litres of '
      || (select name from liquid_def where id = v_kind) || ' into the '
      || lower(placed_name(v_from)) || '. '
      || to_char(placed_litres(v_from) + v_poured, 'FM990') || ' of '
      || to_char(liquid_capacity(v_from), 'FM990') || '.', 'event');

  elsif p_action = 'empty_vessel' then
    v_kind := coalesce((select name from liquid_def where id = placed_liquid(p)), 'it');
    update placed set litres = 0, liquid = null, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You tip the ' || v_kind || ' out of the '
      || lower(placed_name(p)) || '.', 'event');

  elsif p_action = 'drink_from_vessel' then
    if not draw_from(p.id, 1) then return; end if;
    v_thirst := coalesce((select (stats->>'thirst')::double precision from player
                          where world_id = p_world and uid = p_uid), 1);
    update player set stats = jsonb_set(stats, '{thirst}', to_jsonb(least(1, v_thirst + 0.5)))
      where world_id = p_world and uid = p_uid;
    -- A brew straight out of the barrel favours a trade like any other.
    if coalesce((select brew from liquid_def where id = placed_liquid(p)), false) then
      select item into v_full from vessel_def where liquid = placed_liquid(p) limit 1;
      v_favour := grant_boon(p_world, p_uid, v_full, p.ql);
      v_full_msg := nourish(p_world, p_uid, v_full, p.ql);
    end if;
    perform tell(p_world, p_uid, 'You drink your fill from the ' || lower(placed_name(p)) || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full_msg, ''), 'event');
  end if;
end $function$;

-- perform_settlement (2)
CREATE OR REPLACE FUNCTION public.perform_settlement(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare dd deed; p placed; it item; c creature; v_name text; v_level int; v_sx int; v_sy int;
        v_freed int := 0; v_tipped int := 0; cr crate; r record;
begin
  if p_action = 'upgrade_deed' then
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    v_level := dd.level + 1;
    update deed set level = v_level, radius = deed_radius(v_level)
      where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, dd.name || ' grows to level ' || v_level
      || '. The border reaches ' || deed_radius(v_level) || ' tiles from the token and '
      || worker_cap(p_world, p_uid) || ' wildermon may work here.', 'system');
    perform land_announce(p_world, dd.x, dd.y);

  elsif p_action = 'rename_deed' then
    v_name := left(btrim(p_target->>'name'), 32);
    update deed set name = v_name where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, 'The settlement is now called ' || v_name || '.', 'system');

  elsif p_action = 'disband_deed' then
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    -- Everything kept here runs wild, and what it was carrying goes on the
    -- ground where it stood rather than with it.
    for c in select * from creature where world_id = p_world and keeper = p_uid and mode in ('stored', 'deed') loop
      if c.carrying is not null then
        perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
          c.carrying->>'def', (c.carrying->>'ql')::double precision, c.carrying->>'extra',
          (c.carrying->>'count')::int);
      end if;
      update creature set mode = 'wild', phase = 'idle', job = null, post = null, carrying = null,
          name = (select name from species_def where id = c.species)
        where world_id = p_world and id = c.id;
      v_freed := v_freed + 1;
    end loop;
    -- The settlement's own crate goes with the settlement, and whatever was in
    -- it is tipped out where it stood rather than vanishing with it.
    cr := deed_crate(p_world, p_uid);
    if cr.id is not null then
      for r in select * from item where world_id = p_world and crate = cr.id loop
        update item set holder = 'ground', holder_uid = null, crate = null, gx = cr.x, gy = cr.y
          where id = r.id;
        v_tipped := v_tipped + 1;
      end loop;
      delete from crate where world_id = p_world and id = cr.id;
    end if;
    /*
     * Yours, and not the island's.
     *
     * Reported by somebody whose settlement was gone while his crate still
     * stood and who had not disbanded anything: somebody else had, at the
     * other end of the island, and this line took every settlement on it. The
     * deed crate is the tell — the disbanding tips out and removes the
     * *caller's* crate, so everybody else was left with an orphan standing in
     * a field and nothing to say what it had belonged to.
     *
     * `deed` was keyed on the island alone until a day ago, when it became
     * `(world_id, founded_by)`. The reads either side of this were re-scoped
     * with the key; the delete was not, and a delete is the one statement
     * where the whole island being in range does not read as a mistake.
     */
    delete from deed where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, dd.name || ' is disbanded. '
      || v_freed || case when v_freed = 1 then ' wildermon runs' else ' wildermon run' end
      || ' wild and ' || v_tipped
      || case when v_tipped = 1 then ' thing is' else ' things are' end
      || ' tipped out where the crate stood.', 'system');
    perform land_announce(p_world, dd.x, dd.y);

  elsif p_action = 'place_post' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'work_post' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return; end if;
    v_sx := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, 'post', it.extra, (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 0.5) / subtiles(),
            (p_target->>'y')::int + (v_sy + 0.5) / subtiles(), it.ql, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You drive the post in and tack the ribbon to it. It will stand about '
      || round(post_life(p.ql) / 60) || ' minutes and reach ' || post_radius(p.ql)
      || ' tiles. Set a wildermon to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  if p_action in ('upgrade_deed', 'rename_deed', 'disband_deed') then return; end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_post' then
    -- Half rotten by now, most likely, and it comes up as it went in.
    perform give(p_world, p_uid, 'work_post', 1,
      greatest(1, p.ql * (1 - post_dmg(p) / 100)), p.sub);
    update creature set post = null, phase = 'idle' where world_id = p_world and post = p.id;
    delete from placed where id = p.id;
    perform tell(p_world, p_uid, 'You pull the post up and coil the ribbon round it.', 'event');
    perform land_announce(p_world, p.x, p.y);

  elsif p_action = 'assign_post' then
    select * into c from creature where world_id = p_world and id = (p_target->>'creature')::int;
    if not found then return; end if;
    update creature set post = p.id, mode = 'deed', phase = 'idle', enemy = null, hunting = null,
        from_x = p.cx, from_y = p.cy + 0.6, to_x = p.cx, to_y = p.cy + 0.6,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform journal_note(p_world, p_uid, 'posted');
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select g.plain from gather_def g
                   where g.id = (select gathers from species_def where id = c.species)),
                  'keep to the post')
      || ' within ' || least(work_range(c), post_radius(p.ql))
      || ' tiles of the post while it stands. (' || post_state(p) || ')', 'system');

  elsif p_action = 'unassign_post' then
    select * into c from creature where world_id = p_world and post = p.id limit 1;
    if not found then return; end if;
    select * into dd from deed where world_id = p_world and founded_by = c.keeper;
    update creature set post = null, phase = 'idle',
        from_x = coalesce(dd.x + 0.5, p.cx), from_y = coalesce(dd.y + 1.5, p.cy),
        to_x = coalesce(dd.x + 0.5, p.cx), to_y = coalesce(dd.y + 1.5, p.cy),
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' is called off the post.', 'system');
  end if;
end $function$;

-- perform_trap (2)
CREATE OR REPLACE FUNCTION public.perform_trap(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; d trap_def; it item; c creature; s species_def; dd deed;
        v_sx int; v_sy int; v_names text; v_comers int; v_clean boolean; v_back bigint;
begin
  if p_action = 'set_trap' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and not locked and exists (select 1 from trap_def td where td.id = item.def)
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return; end if;
    select * into d from trap_def where id = it.def;
    v_sx := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, material, x, y, sx, sy, cx, cy, ql, dmg, made_by)
    values (p_world, 'trap', it.def, it.extra, (p_target->>'x')::int, (p_target->>'y')::int,
            v_sx, v_sy, (p_target->>'x')::int + (v_sx + 0.5) / subtiles(),
            (p_target->>'y')::int + (v_sy + 0.5) / subtiles(), it.ql, it.dmg, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, case when d.water
      then 'You sink the ' || lower(trap_name(p)) || ' and make the line fast. It will fish about '
           || round(trap_life(p.sub, p.ql) / 60) || ' minutes and holds ' || coalesce(d.hold, 8) || '. Bait it.'
      else 'You set the ' || lower(trap_name(p)) || ' and cover the sign of it. It will stand about '
           || round(trap_life(p.sub, p.ql) / 60) || ' minutes and will hold anything up to taming '
           || to_char(trap_holds(p), 'FM990') || '. Bait it.' end, 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;
  select * into d from trap_def where id = p.sub;

  if p_action = 'bait_trap' then
    it := bait_in_pack(p_world, p_uid, d.water);
    if it.id is null then return; end if;
    -- Whatever was in it goes back in the pack rather than on the ground.
    if p.bait is not null then perform give(p_world, p_uid, p.bait, 1, coalesce(p.bait_ql, 20)); end if;
    if not consume(p_world, p_uid, it.def, 1, it.id) then return; end if;
    update placed set bait = it.def, bait_ql = it.ql, since = now() where id = p.id;
    if d.water then
      perform tell(p_world, p_uid, 'You put the '
        || lower((select name from item_def where id = it.def))
        || ' in the creel and sink it again. '
        || coalesce((select note from bait_def where id = it.def), ''), 'event');
    else
      select count(*) into v_comers from species_def sp
        where exists (select 1 from species_diet sd where sd.species = sp.id and sd.item = it.def)
          and sp.tame_level <= trap_holds(p);
      perform tell(p_world, p_uid, 'You lay the '
        || lower((select name from item_def where id = it.def)) || ' in the ' || lower(trap_name(p))
        || '. ' || case when v_comers = 0 then 'Nothing this trap will hold eats that.'
                        when v_comers = 1 then 'One sort would come to that.'
                        else v_comers || ' sorts would come to that.' end, 'event');
    end if;

  elsif p_action = 'take_catch' then
    select * into c from creature where world_id = p_world and id = p.caught;
    if not found then return; end if;
    select * into s from species_def where id = c.species;
    -- It is held, not willing. Getting it out without being bitten is the skill.
    v_clean := skill_check(skill_of(p_world, p_uid, 'taming'), s.tame_level + 10, p.ql,
                           mind_ease(p_world, p_uid));
    perform skill_raise(p_world, p_uid, 'taming', try_gain(v_clean, free_gain()));
    if not v_clean then
      perform tell(p_world, p_uid, 'The ' || lower(s.name)
        || ' thrashes and you cannot get a hand on it. It is still held.', 'error');
      return;
    end if;
    update placed set caught = null, bait = null, bait_ql = null where id = p.id;
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    if not exists (select 1 from creature q where q.world_id = p_world and q.mode = 'active'
                     and q.keeper = p_uid) then
      update creature set trapped = null, mode = 'active', keeper = p_uid, until = now()
        where world_id = p_world and id = c.id;
      perform journal_note(p_world, p_uid, 'trapped');
      perform tell(p_world, p_uid, 'You get the noose off the ' || lower(s.name)
        || ' and it stays. It comes with you.', 'event');
    elsif dd.world_id is not null then
      update creature set trapped = null, mode = 'stored', keeper = p_uid,
          from_x = dd.x + 0.5, from_y = dd.y + 1.5, to_x = dd.x + 0.5, to_y = dd.y + 1.5,
          leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
        where world_id = p_world and id = c.id;
      perform journal_note(p_world, p_uid, 'trapped');
      perform tell(p_world, p_uid, 'You get it out of the trap and walk it home to the token of '
        || dd.name || '.', 'event');
    end if;

  elsif p_action = 'free_catch' then
    perform spring_trap(p.id,
      'You lift the board and it is gone into the grass before you have straightened up.');

  elsif p_action = 'empty_creel' then
    select string_agg(i.count || ' × ' || lower(f.name), ', ' order by f.name), count(*)
      into v_names, v_comers
      from item i join item_def f on f.id = i.def
      where i.holder = 'trap' and i.placed = p.id;
    if v_comers = 0 then return; end if;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where holder = 'trap' and placed = p.id;
    perform skill_raise(p_world, p_uid, 'fishing', 0.5);
    perform journal_note(p_world, p_uid, 'creeled');
    perform tell(p_world, p_uid, 'You lift the creel and tip it out: ' || v_names || '.', 'event');

  elsif p_action = 'pick_up_trap' then
    if p.bait is not null then perform give(p_world, p_uid, p.bait, 1, coalesce(p.bait_ql, 20)); end if;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where holder = 'trap' and placed = p.id;
    v_back := give(p_world, p_uid, p.sub, 1, p.ql, p.material);
    update item set dmg = trap_dmg(p) where id = v_back;
    perform tell(p_world, p_uid, 'You take the ' || lower(trap_name(p)) || ' up'
      || case when p.bait is not null then ' and pocket the bait' else '' end || '.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$;

-- perform_treasure (1)
CREATE OR REPLACE FUNCTION public.perform_treasure(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_map item; v_t treasure; v_tier treasure_def; v_i int; v_got text;
        v_ql double precision; v_rare text; v_c int;
begin
  v_map := carried(p_world, p_uid, target_item(p_target));
  if v_map.id is null then return; end if;
  v_t := treasure_at(v_map.id);
  if v_t.item_id is null then return; end if;
  select * into v_tier from treasure_def where id = v_t.tier;

  -- What was left to watch it, before anything is worth picking up.
  for v_i in 1..v_tier.guards loop
    perform creature_spawn(p_world, v_tier.guard, v_t.x + 0.5, v_t.y + 0.5, 'wild');
  end loop;

  for v_i in 1..v_tier.lumps loop
    select item into v_got from hoard_metal order by random() limit 1;
    v_ql := greatest(1, least(100, v_map.ql * (0.7 + random() * 0.5)));
    perform drop_on_ground(p_world, v_t.x, v_t.y, v_got, v_ql);
  end loop;
  for v_i in 1..v_tier.things loop
    /*
     * A tool or a blade, not a wardrobe. `improvable_def` is everything worth
     * bettering and that includes the furniture and the boats — the suite's
     * first hoard came up with a cart and a chest in it, which is a thing
     * nobody buried. `item_def.category` already draws the line: 55 tools,
     * heaviest eleven kilos, against 38 pieces of `misc` that run to a
     * six-hundred-kilo sailing boat.
     */
    select i.item into v_got from improvable_def i join item_def d on d.id = i.item
     where d.category = 'tool' order by random() limit 1;
    v_ql := greatest(1, least(100, v_map.ql * (0.7 + random() * 0.5)));
    v_rare := rarity_roll();
    v_c := drop_on_ground(p_world, v_t.x, v_t.y, v_got, v_ql);
    update item set rare = v_rare where world_id = p_world and holder = 'ground'
      and gx = v_t.x and gy = v_t.y and def = v_got and rare is null and v_rare is not null;
  end loop;

  perform consume(p_world, p_uid, 'treasure_map', 1, v_map.id);
  perform journal_note(p_world, p_uid, 'hoard');
  perform tell(p_world, p_uid, 'The spade goes through rotten board and the hoard is open — '
    || v_tier.lumps || ' lump' || case when v_tier.lumps = 1 then '' else 's' end
    || ' and ' || v_tier.things || ' thing' || case when v_tier.things = 1 then '' else 's' end
    || ' lying where they fell. And something was left to watch over it.', 'event');
  perform land_announce(p_world, v_t.x, v_t.y);
end $function$;

-- rpc_act (1)
CREATE OR REPLACE FUNCTION public.rpc_act(p_world uuid, p_action text, p_target jsonb, p_times integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); d action_def; p player; why text; secs double precision;
        s double precision; tq double precision; cap int; room int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  why := act_refusal(p_world, me, p_action, p_target);
  if why is not null then
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = me for update;

  -- Something already in hand: line this one up behind it rather than drop it.
  if p.act is not null then
    cap := queue_capacity(p_world, me);
    room := cap - 1 - jsonb_array_length(p.act_queue);
    if room <= 0 then
      why := 'You can only keep ' || cap || ' jobs in your head at once. Mind logic is what widens that.';
      perform tell(p_world, me, why, 'error');
      return jsonb_build_object('started', false, 'queued', false, 'why', why);
    end if;
    /*
     * And what the thing *was*, for a job that may outlive the row it names.
     *
     * Stamped now rather than worked out later, because later is exactly when
     * it cannot be: once `consume` has deleted the last of a stack there is
     * nothing left to ask what kind of thing it had been.
     */
    update player set act_queue = act_queue || (jsonb_build_object(
        'action', p_action, 'target', p_target, 'goes', greatest(1, least(100, coalesce(p_times, 1))))
        || coalesce((select jsonb_build_object('was', i.def) from item i
                      where i.id = target_item(p_target) and i.world_id = p_world), '{}'::jsonb))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me, d.label || ' is next, ' || jsonb_array_length(p.act_queue) + 1 || ' of ' || cap || ' in hand.', 'info');
    /*
     * And what is in the head now, not just how much of it.
     *
     * The bar drew its queue from `rpc_settle` and nothing else, and
     * `rpc_settle` runs on the heartbeat and when a job comes due — never when
     * one is *added*. So asking for a third job while two were running left the
     * bar saying "2 of 3" until the job in hand finished, at which point one
     * came off the queue and it said "2 of 3" again. Reported as never changing
     * from 2/3 to 3/3, which is exactly what it did: it was always one behind,
     * and topping the queue up kept it there.
     *
     * The answer to the ask is where the browser should hear about what the ask
     * did, so it says so here rather than waiting to be asked again.
     */
    return held_now(p_world, me) || jsonb_build_object('started', false, 'queued', true,
      'inHand', jsonb_array_length(p.act_queue) + 1, 'capacity', cap,
      'queue', coalesce((select jsonb_agg(jsonb_build_object(
                           'action', q->>'action',
                           'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
                         from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb));
  end if;

  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, me, d.tool) end;
  -- Every other job has a floor of a second or so under it; an instant one has
  -- no duration to put a floor under, and act_duration would give it one.
  secs := case when d.instant then 0 else act_duration(d.base_time, s, tq, control_speed(p_world, me)) end;
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))),
      act_goes = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  /*
   * And what the ask left you holding, said in the answer to the ask.
   *
   * Reported as inventory rubberbanding: a thing put in a crate turns up in
   * the crate and stays in the pack as well, for up to the twenty seconds
   * until the next reconcile, and then goes. Two causes with one shape —
   * nothing ever tells a browser that a thing has *left* its hands.
   *
   * `item` is published with the default replica identity, so a DELETE carries
   * the primary key and nothing else, and the browser's Realtime filter is
   * `holder_uid = me`: a row carrying only an `id` cannot match it. Putting a
   * whole stack in a crate deletes the row, so nothing is said. And a thing
   * that goes to the ground, or to somebody else, has `holder_uid` set to
   * null, so the *new* row does not match the filter either. Realtime carries
   * every arrival and no departure, and `refresh_pack` on the twenty-second
   * reconcile was the only thing that ever noticed.
   *
   * Said at each return rather than worked out once at the top, because for an
   * instant ask the work happens in the `settle` three lines below this — a
   * value built any earlier is the pack as it was before the thing moved,
   * which is the very answer that was wrong.
   */
  if d.instant then
    perform settle(p_world, me);
    return held_now(p_world, me) || jsonb_build_object('started', true, 'done', true, 'seconds', 0);
  end if;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return held_now(p_world, me)
      || jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $function$;

-- settlement_refusal (2)
CREATE OR REPLACE FUNCTION public.settlement_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare dd deed; p placed; it item; c creature; v_name text;
begin
  if p_action in ('upgrade_deed', 'disband_deed', 'rename_deed') then
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    if not found then return 'You have no settlement.'; end if;
    if dd.founded_by is distinct from p_uid then return 'That is not your settlement.'; end if;
    if p_action = 'upgrade_deed' then return upgrade_reason(p_world, p_uid); end if;
    if p_action = 'rename_deed'
       and nullif(btrim(coalesce(p_target->>'name', '')), '') is null then
      return 'Choose a name.';
    end if;
    return null;
  end if;

  if p_action = 'place_post' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'work_post' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return 'You have no work post to drive in.'; end if;
    return post_place_reason(p_world, (p_target->>'x')::int, (p_target->>'y')::int,
      coalesce((p_target->>'sx')::int, 0), coalesce((p_target->>'sy')::int, 0));
  end if;

  -- Everything else is asked of a post, so the post is brought up to date
  -- before it is asked: one nobody has looked at for a day is not there.
  perform post_settle((p_target->>'id')::bigint);
  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'post';
  if not found then return 'It is gone.'; end if;
  if not near_piece(p_world, p_uid, p) then return 'Stand at the post.'; end if;

  if p_action = 'assign_post' then
    if exists (select 1 from creature q where q.world_id = p_world and q.post = p.id) then
      return 'Something is already working out of it.';
    end if;
    select * into c from creature where world_id = p_world and id = (p_target->>'creature')::int;
    if not found then return 'Choose a wildermon.'; end if;
    if c.mode = 'wild' then return c.name || ' is not yours to set to work.'; end if;
    if not worker_job_ported((select gathers from species_def where id = c.species)) then
      return 'Nobody has taught this island what '
        || (select plain from gather_def where id = (select gathers from species_def where id = c.species))
        || ' looks like yet.';
    end if;
  elsif p_action = 'unassign_post' then
    if not exists (select 1 from creature q where q.world_id = p_world and q.post = p.id) then
      return 'Nothing is working out of it.';
    end if;
  end if;
  return null;
end $function$;

-- target_corpse (3)
CREATE OR REPLACE FUNCTION public.target_corpse(p_world uuid, p_uid uuid, p_target jsonb)
 RETURNS item
 LANGUAGE sql
 STABLE
AS $function$
  select i.* from item i
  where i.world_id = p_world and i.def = 'corpse'
    and case p_target->>'kind'
      when 'ground' then i.holder = 'ground' and i.gx = (p_target->>'x')::int and i.gy = (p_target->>'y')::int
        and (target_item(p_target) is null or i.id = target_item(p_target))
      else i.holder = 'player' and i.holder_uid = p_uid and i.id = target_item(p_target) end
  order by i.id limit 1
$function$;

-- trap_refusal (2)
CREATE OR REPLACE FUNCTION public.trap_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare p placed; d trap_def; it item; c creature; s species_def;
begin
  if p_action = 'set_trap' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and not locked and exists (select 1 from trap_def td where td.id = item.def)
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return 'You have no trap to set.'; end if;
    return trap_place_reason(p_world, p_uid, it.def, (p_target->>'x')::int, (p_target->>'y')::int,
      coalesce((p_target->>'sx')::int, 0), coalesce((p_target->>'sy')::int, 0));
  end if;

  -- Everything else is asked of a trap, so the trap is rolled forward first:
  -- one nobody has looked at for an hour may have caught something, or rotted.
  perform trap_settle((p_target->>'id')::bigint);
  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'trap';
  if not found then return 'It is gone.'; end if;
  select * into d from trap_def where id = p.sub;
  if not near_piece(p_world, p_uid, p) then
    return case when d.water then 'Stand at the creel.' else 'Stand at the trap.' end;
  end if;

  if p_action = 'bait_trap' then
    if p.caught is not null then return 'There is something in it already.'; end if;
    if (bait_in_pack(p_world, p_uid, d.water)).id is null then
      return case when d.water
        then 'You have nothing a fish would come to. Dig worms, or use corn, meat or a small fish.'
        else 'You have nothing anything would come to. Carry a berry, a vegetable, a nut, a spice.' end;
    end if;

  elsif p_action = 'take_catch' then
    if p.caught is null then return 'There is nothing in it.'; end if;
    select * into c from creature where world_id = p_world and id = p.caught;
    if not found then return 'Whatever was in it is gone.'; end if;
    select * into s from species_def where id = c.species;
    if skill_of(p_world, p_uid, 'taming') < s.tame_level then
      return 'A ' || lower(s.name) || ' takes taming ' || to_char(s.tame_level, 'FM990')
        || ' to handle, trapped or not. It is held; come back when you can.';
    end if;
    if not exists (select 1 from deed where world_id = p_world and founded_by = p_uid)
       and exists (select 1 from creature q where q.world_id = p_world and q.mode = 'active'
                     and q.keeper = p_uid) then
      return 'You have a companion at your side and no settlement to send this one to.';
    end if;

  elsif p_action = 'free_catch' then
    if p.caught is null then return 'There is nothing in it.'; end if;

  elsif p_action = 'empty_creel' then
    if not d.water then return 'That is not a creel.'; end if;
    if not exists (select 1 from item i where i.holder = 'trap' and i.placed = p.id) then
      return 'There is nothing in it yet.';
    end if;

  elsif p_action = 'pick_up_trap' then
    if p.caught is not null then return 'Deal with what is in it first.'; end if;
  end if;
  return null;
end $function$;

-- treasure_refusal (1)
CREATE OR REPLACE FUNCTION public.treasure_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_map item; v_t treasure; p player; v_d double precision; v_say text;
begin
  v_map := carried(p_world, p_uid, target_item(p_target));
  if v_map.id is null then return 'You are not holding a map.'; end if;
  if v_map.def <> 'treasure_map' then return 'That is not a map.'; end if;
  v_t := treasure_at(v_map.id);
  if v_t.item_id is null then
    return 'The hide is worn blank. Whatever was drawn on it is gone.';
  end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  v_d := sqrt((p.x - (v_t.x + 0.5)) ^ 2 + (p.y - (v_t.y + 0.5)) ^ 2);
  if v_d <= unearth_reach() then return null; end if;
  select b.say into v_say from map_band b where v_d <= b.within order by b.ord limit 1;
  return coalesce(v_say, 'Nothing here looks anything like the map.');
end $function$;

select private.lock_doors();
