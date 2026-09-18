-- A surveyor's level, and a spadeful out of the cart
--
-- The last three off a list of twenty suggestions for terraforming, which
-- turn out to be two things.
--
-- "Flatten toward a chosen height" and "a run of goes that knows when to
-- stop" are one thing: a mark. Flattening aimed at whatever tile you happened
-- to be standing on, so levelling a yard meant standing in exactly the right
-- place for every tile of it; and a run of goes had no mark at all, so
-- twenty-five spadefuls asked for at a bank were twenty-five spadefuls
-- whatever height they left it at, and the only way to land on a number was to
-- count. Take the level at a corner (`take_level`, `player.level_h`) and it is
-- the mark until you clear it: `flatten_target` aims at it, and every door
-- that moves a corner refuses once the corner is there (`level_stop`) — so a
-- run of any length stops exactly on the mark, because the refusal ends a run
-- the way every refusal does. Digging and chipping stop coming down to it,
-- dirt and concrete stop going up to it. It rides back in the ground read, so
-- it is the same mark in every browser you open.
--
-- "Drop dirt straight from the cart or crate" is the other. A spadeful weighs
-- twenty kilos and a hundred and twenty on your back is six of them, so moving
-- a bank of earth was a great many walks to the crate and back. A crate, a
-- cart or a bin within reach is as good as a pocket for this one job, since
-- the ground is what the load was fetched for: `spoil_near` looks in the pack
-- first and then beside you, and `take_spoil` takes it from wherever it was
-- found. Both the dropping and the packing-in half of flattening draw on it.

alter table player add column if not exists level_h int;

/*
 * Why this corner is finished, when a level has been taken.
 *
 * The one thing a run of goes never knew was when to stop. Ask for twenty-five
 * spadefuls at a corner and you get twenty-five, whatever height that leaves
 * it at, and the only way to land on a number was to count. With a level taken
 * the door itself says when the corner is there, so a run of any length stops
 * exactly on it: the refusal ends the run the way every other refusal does.
 * `p_dir` is which way the job moves the ground. The browser's `levelStop` is
 * the same rule in the same words.
 */
CREATE OR REPLACE FUNCTION public.level_stop(p_world uuid, p_uid uuid, p_cx integer, p_cy integer, p_dir integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_level int; v_h int;
begin
  select level_h into v_level from player where world_id = p_world and uid = p_uid;
  if v_level is null then return null; end if;
  v_h := land_height(p_world, p_cx, p_cy);
  if p_dir < 0 and v_h <= v_level then
    return 'That corner is down to the level of ' || v_level || ' already.';
  end if;
  if p_dir > 0 and v_h >= v_level then
    return 'That corner is up to the level of ' || v_level || ' already.';
  end if;
  return null;
end $function$;

/*
 * A spadeful, from the pack or out of a store you are standing beside.
 *
 * Twenty kilos a spadeful and a hundred and twenty on your back is six of
 * them, so moving a bank of earth is a great many walks to the crate and back.
 * A cart, a crate or a bin within reach is as good as a pocket for this one
 * job: the ground is what the load was fetched for. The pack comes first, so
 * nothing changes for anybody carrying their own. The browser's `spoilFrom`
 * looks in the same places in the same order.
 */
CREATE OR REPLACE FUNCTION public.spoil_near(p_world uuid, p_uid uuid, p_item bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_def text; v_want text[] := array['dirt', 'clay', 'sand'];
begin
  v_def := spoil_in_hand(p_world, p_uid, p_item);
  if v_def is not null or p_item is not null then return v_def; end if;
  select i.def into v_def from item i
    join crate c on c.world_id = i.world_id and c.id = i.crate
   where i.world_id = p_world and i.holder = 'crate' and i.def = any(v_want) and not i.locked
     and c.id = (select cc.id from nearest_crate(p_world, crate_centre_x(c), crate_centre_y(c), 2.5) cc limit 1)
   order by array_position(v_want, i.def), i.id limit 1;
  if v_def is not null then return v_def; end if;
  select i.def into v_def from item i
    join placed p on p.world_id = i.world_id and p.id = i.placed
   where i.world_id = p_world and i.holder = 'furniture' and i.def = any(v_want) and not i.locked
     and near_piece(p_world, p_uid, p, 2.5)
   order by array_position(v_want, i.def), i.id limit 1;
  return v_def;
end $function$;

/*
 * And taking it, from wherever `spoil_near` found it. The pack first, then a
 * crate, then a piece of furniture, and one spadeful either way.
 */
CREATE OR REPLACE FUNCTION public.take_spoil(p_world uuid, p_uid uuid, p_def text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare v_id bigint;
begin
  if consume(p_world, p_uid, p_def, 1) then return true; end if;
  select i.id into v_id from item i
    join crate c on c.world_id = i.world_id and c.id = i.crate
   where i.world_id = p_world and i.holder = 'crate' and i.def = p_def and not i.locked
     and sqrt((crate_centre_x(c) - (select pl.x from player pl where pl.world_id = p_world and pl.uid = p_uid)) ^ 2
            + (crate_centre_y(c) - (select pl.y from player pl where pl.world_id = p_world and pl.uid = p_uid)) ^ 2) <= 2.5
   order by i.id limit 1;
  if v_id is null then
    select i.id into v_id from item i
      join placed p on p.world_id = i.world_id and p.id = i.placed
     where i.world_id = p_world and i.holder = 'furniture' and i.def = p_def and not i.locked
       and near_piece(p_world, p_uid, p, 2.5)
     order by i.id limit 1;
  end if;
  if v_id is null then return false; end if;
  update item set count = count - 1 where id = v_id;
  delete from item where id = v_id and count <= 0;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.flatten_target(p_world uuid, p_uid uuid, p_x integer, p_y integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  -- A level taken is the mark for everything, and the reason to take one.
  if p.level_h is not null then return p.level_h; end if;
  if floor(p.x)::int = p_x and floor(p.y)::int = p_y then
    return (select min(land_height(p_world, c.cx, c.cy)) from tile_corners(p_x, p_y) c);
  end if;
  return round(centre_height(p_world, floor(p.x)::int, floor(p.y)::int));
end $function$;

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
  -- Whose ground it is, before anything about what it is made of.
  aimed := ground_deed_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
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
    return coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                    slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.terrain_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare cx int; cy int; tx int; ty int; t tile_def; r rock_def; mining double precision; here int;
begin
  cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
  tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;

  if p_action in ('mine', 'chip_corner') then
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if not t.mineable then return 'There is no rock face there to work.'; end if;
    /*
     * How deep the water over a face may be and still be worked.
     *
     * This was `rock_height(corner) <= 0`, and the report that moved it came
     * with a picture: a copper vein, "You cannot mine below the water level",
     * and no water drawn anywhere on the tile. Two things were wrong in the
     * one line.
     *
     * It asked the wrong height. `rock_height` is the surface less the soil
     * over it, so a corner shared with a meadow refuses a face standing fifty
     * units above the sea because the bedrock buried under the grass beside it
     * is below sea level. Water is a question about the surface, and the
     * surface is what `has_water` reads and what a browser draws.
     *
     * And it was a height out even where the two agree: `<= 0` refuses a face
     * standing *at* the waterline, while water is only drawn below it. Nought
     * is the one height that refuses and shows nothing — which is exactly
     * where a shore face sits.
     *
     * So: the corner's own height, and `mine_depth` of water allowed over it.
     * That is about waist deep at the tide line and you work standing in it,
     * which is what a shore quarry looks like. Past that you are swimming, and
     * nobody swings a pick while swimming — so the refusal says that, rather
     * than blaming water for ground that is not under any.
     */
    if land_height(p_world, cx, cy) < -mine_depth() then
      return 'The water is too deep here to work in.';
    end if;
    -- A seam only gives up its metal to somebody who knows how to take it.
    if land_tile(p_world, tx, ty) = 4 then
      r := bedrock_at(p_world, tx, ty);
      mining := skill_of(p_world, p_uid, 'mining');
      if r.ore and mining < r.level then
        -- `FM990.9` leaves "5." on a whole number, which reads as a typo in the
        -- middle of a sentence. The browser prints the number as it is.
        return r.name || ' needs mining ' || rtrim(rtrim(to_char(r.level, 'FM990.99'), '0'), '.')
          || ' to work. Yours is ' || to_char(mining, 'FM990.0') || '.';
      end if;
    end if;
    -- Cutting a face back stops at the level like everything else; working it
    -- for what is in it does not, since that leaves the face where it was.
    if p_action = 'chip_corner' then return level_stop(p_world, p_uid, cx, cy, -1); end if;
    return null;
  end if;

  here := land_tile(p_world, tx, ty);
  if p_action = 'pack' then
    if not packable(here) then return 'That ground will not pack down.'; end if;
  elsif p_action = 'cultivate' then
    if here <> 2 then return 'Only packed earth can be broken up.'; end if;
  elsif p_action in ('pave_gravel', 'pave_cobble') then
    if here <> 2 then return 'Pack the ground down before paving it.'; end if;
    if p_action = 'pave_gravel' and pack_count(p_world, p_uid, 'rock_shards') < 1 then
      return 'You need rock shards to pave with gravel.';
    end if;
    if p_action = 'pave_cobble' and pack_count(p_world, p_uid, 'stone_brick') < 1 then
      return 'You need a stone brick to lay cobblestone.';
    end if;
  elsif p_action = 'drop_dirt_here' then
    if pack_count(p_world, p_uid, 'dirt') < 1 then return 'You have no dirt to drop.'; end if;
    -- The corner nearest whoever is standing there, as the game reckons it.
    select round(x)::int, round(y)::int into cx, cy from player where world_id = p_world and uid = p_uid;
    return slope_refusal(p_world, p_uid, 'digging', cx, cy, 1);
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.ground_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        v_under text; p player; v_spoil text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if tx is null or ty is null or not in_bounds(p_world, tx, ty) then
    return 'There is nothing there.';
  end if;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);

  if p_action = 'flatten' then
    if t.dig_yield is null then return 'You cannot flatten that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel to flatten.'; end if;
    -- Shallows are workable, to the depth a pick works to. `has_water` refuses
    -- a tile with one corner an inch under, which is most of a shoreline.
    if centre_height(p_world, tx, ty) < -mine_depth() then
      return 'The water is too deep here to work in.';
    end if;
    if flatten_target(p_world, p_uid, tx, ty) < -mine_depth() then
      return 'The ground you stand on is too deep to work from.';
    end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if not needs_flattening(p_world, p_uid, tx, ty) then return 'That ground is already flat.'; end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    v_spoil := spoil_near(p_world, p_uid, target_item(p_target));
    if v_spoil is null then
      return case when target_item(p_target) is not null then 'That is not dirt, clay or sand.'
                  else 'You have no dirt, clay or sand to drop, and nothing beside you is holding any.' end;
    end if;
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, 1),
                    slope_refusal(p_world, p_uid, 'digging', cx, cy, 1));

  elsif p_action = 'raise_rock' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if pack_count(p_world, p_uid, 'concrete') < 1 then return 'You have no concrete.'; end if;
    -- Concrete goes on bare rock, above the water: the only way to build up
    -- on rock without dirt, which slides off it.
    if land_dirt(p_world, cx, cy) > 0 then return 'There is soil on that corner. Concrete goes on bare rock.'; end if;
    if land_height(p_world, cx, cy) < 0 then return 'Concrete will not set under water.'; end if;
    -- And never on a seam. A corner holds up four tiles, and a vein under any
    -- of them raised with concrete would be ore for ever: mined down, laid up
    -- and mined again. `rock_def.seam` is the browser's own `isSeam`: every
    -- vein, and the coal seam with them.
    if exists (select 1 from (values (cx - 1, cy - 1), (cx, cy - 1), (cx - 1, cy), (cx, cy)) v(x, y)
               where in_bounds(p_world, v.x, v.y) and (bedrock_at(p_world, v.x, v.y)).seam) then
      return 'That corner is on a seam. Concrete goes on plain rock.';
    end if;
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, 1),
                    slope_refusal(p_world, p_uid, 'masonry', cx, cy, 1));

  elsif p_action = 'dredge' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Digging from a boat: the bottom comes up a spadeful at a time, to a
    -- depth the shore never reaches. The doors are the digger's, in the
    -- digger's words, with the hull's in front of them.
    if t.dig_yield is null then return 'You cannot dredge that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel to dredge with.'; end if;
    if not coalesce(is_boat(driving(p_world, p_uid)), false) then return 'Dredging is done from a boat.'; end if;
    if land_height(p_world, cx, cy) >= 0 then return 'That corner is above the water. Dig it from the shore.'; end if;
    if land_height(p_world, cx, cy) < -dredge_depth() then return 'The bottom is too deep to reach from a boat.'; end if;
    if land_dirt(p_world, cx, cy) <= 0 then return 'That corner is bare rock down there. A shovel will not bite on it.'; end if;
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    return slope_refusal(p_world, p_uid, 'digging', cx, cy, -1);

  elsif p_action = 'pave_slabs' then
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if here <> 2 then return 'The ground has to be packed flat before anything is laid on it.'; end if;
    if pack_count(p_world, p_uid, 'trowel') < 1 then return 'You need a trowel to bed a slab.'; end if;
    if not exists (select 1 from item i join slab_def s on s.item = i.def
                   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
                     and not i.locked) then
      return 'You need a cut slab to pave with.';
    end if;

  elsif p_action = 'remove_paving' then
    if here not in (13, 14, 21) then return 'There is no paving here to break up.'; end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to break up paving.'; end if;

  elsif p_action = 'cut_grass' then
    if here not in (0, 5, 6, 20) then return 'There is no grass here to cut.'; end if;
    if is_foraged(p_world, tx, ty, 'grass') then return 'The grass here is still short.'; end if;

  elsif p_action = 'cut_reeds' then
    if here <> 19 then return 'There are no reeds here.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') < 1 then return 'You need a knife to cut reeds.'; end if;
    if is_foraged(p_world, tx, ty, 'reed') then return 'The reeds here are cut back to the water.'; end if;

  elsif p_action = 'pick_fruit' then
    if here <> 16 then return 'There is no tree here.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if v_tree.fruit is null then return 'Nothing grows on this that you would eat.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'Nothing hangs on a dead tree.';
    end if;
    -- A sapling bears nothing; it has to have some years in it first.
    if not coalesce((select bears from tree_age_def where id = tree_age(v_data)), false) then
      return 'The ' || lower(v_tree.name) || ' is too young to bear. Leave it to grow.';
    end if;
    if is_foraged(p_world, tx, ty, 'forage') then
      return 'You have had what this ' || lower(v_tree.name) || ' has on it. Come back later.';
    end if;

  elsif p_action = 'pick_sprout' then
    if here <> 16 then return 'There is no tree here.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no life in it to sprout.';
    end if;

  elsif p_action = 'prune' then
    if here <> 16 then return 'There is no tree here to prune.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no pruning a dead tree.';
    end if;
    -- What each stage prunes to is the table's: a stage back for a grown
    -- tree, a shrub for good out of a sapling, and a young tree left to grow.
    -- A stage whose next stage is itself is a shrub already kept.
    if exists (select 1 from tree_age_def where id = tree_age(v_data) and pruned is null and next = id) then
      return 'It is clipped as far as it goes.';
    end if;
    if (select pruned from tree_age_def where id = tree_age(v_data)) is null then
      return 'The ' || lower(v_tree.name) || ' is too young to prune. Let it grow.';
    end if;

  elsif p_action = 'plant' then
    if not exists (select 1 from plantable where tile = here) then
      return 'Nothing will take root in that.';
    end if;
    if pack_count(p_world, p_uid, 'sprout') < 1 then return 'You have no sprout to plant.'; end if;
    -- A grown tile of tree is something you walk round, not through, and the
    -- sprout becomes that tile the moment it goes in.
    select * into p from player where world_id = p_world and uid = p_uid;
    if p.uid is not null and floor(p.x)::int = tx and floor(p.y)::int = ty then
      return 'You would be planting it under your own feet. Step off the tile first.';
    end if;

  elsif p_action = 'graft' then
    if here <> 16 then return 'There is no tree here to graft to.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no life in it to graft to.';
    end if;
    if (select fruit from tree_def where id = tree_species(v_data)) is not null then return 'It bears already.'; end if;
    -- Grafting is the forester's finest work, and a beginner's graft is a
    -- sprout thrown away.
    if skill_of(p_world, p_uid, 'forestry') < graft_skill() then
      return 'You do not know enough of trees to graft one yet. It takes forestry ' || graft_skill() || '.';
    end if;
    -- The sprout named, or any of the three that bear.
    if target_item(p_target) is not null and not exists (
        select 1 from item i join tree_def td on td.name = i.extra and td.fruit is not null
         where i.world_id = p_world and i.id = target_item(p_target) and i.holder = 'player'
           and i.holder_uid = p_uid and i.def = 'sprout') then
      return 'That is not a fruit sprout.';
    end if;
    if not exists (
        select 1 from item i join tree_def td on td.name = i.extra and td.fruit is not null
         where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
           and i.def = 'sprout' and not i.locked) then
      return 'You have no fruit sprout to graft.';
    end if;

  elsif p_action = 'harvest_bush' then
    if here <> 17 then return 'There is no bush here.'; end if;
    if (select yields from bush_def where id = bush_species(v_data)) is null then
      return 'Nothing on a ' || lower((select name from bush_def where id = bush_species(v_data))) || ' is worth a sickle.';
    end if;
    if is_foraged(p_world, tx, ty, 'forage') then
      return 'You have had what this ' || lower((select name from bush_def where id = bush_species(v_data))) || ' has on it. Come back later.';
    end if;

  elsif p_action = 'dig_stump' then
    if here <> tile_id('Stump') then return 'There is no stump here.'; end if;

  elsif p_action = 'dig_worms' then
    if not t.wormy then return 'Nothing lives in that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel.'; end if;
    if has_water(p_world, tx, ty) then return 'Not under water.'; end if;

  elsif p_action = 'prospect' then
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to prospect.'; end if;
  end if;
  return null;
end $function$;

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
        v_age tree_age_def; v_to tree_age_def;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);
  select * into d from action_def where id = p_action;
  -- What this ground is made of, which digging has always read off the tile
  -- and flattening never did.
  v_spoil := coalesce(t.dig_yield, 'dirt');

  if p_action in ('take_level', 'clear_level') then
    if p_action = 'clear_level' then
      update player set level_h = null where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid,
        'You put the level away. Flattening works to the ground you stand on again.', 'event');
    else
      cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
      update player set level_h = land_height(p_world, cx, cy) where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'You sight the level at ' || land_height(p_world, cx, cy)
        || '. Flattening works to it, and digging, dropping and concrete stop at it.', 'event');
    end if;
    return;
  end if;

  if p_action = 'flatten' then
    v_target := flatten_target(p_world, p_uid, tx, ty);
    -- The corners furthest above and below the height we are working towards.
    /*
     * The high corner has to be soil, because a shovel does not move rock. It
     * used to be the highest corner whatever it was made of, and a tile with
     * one rock shoulder on it stopped the whole run dead with "Mine it down
     * instead" while the other three corners still had work in them. The rock
     * is stepped round now and named at the end.
     */
    select c.cx, c.cy into v_hi from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) > v_target and land_dirt(p_world, c.cx, c.cy) > 0
      order by land_height(p_world, c.cx, c.cy) desc limit 1;
    select c.cx, c.cy into v_lo from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) < v_target
      order by land_height(p_world, c.cx, c.cy) limit 1;
    if v_hi.cx is null and v_lo.cx is null then
      perform tell(p_world, p_uid,
        case when exists (select 1 from tile_corners(tx, ty) c
                           where land_height(p_world, c.cx, c.cy) > v_target and land_dirt(p_world, c.cx, c.cy) <= 0)
             then 'What is still standing high here is bare rock. Mine it down.'
             else 'There is nothing left to move here.' end, 'error');
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
      if take_spoil(p_world, p_uid, v_spoil) then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        perform tell(p_world, p_uid, 'You pack '
          || lower((select name from item_def where id = v_spoil))
          || ' in to bring the ground up.', 'event');
      elsif take_spoil(p_world, p_uid, 'dirt') then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        perform tell(p_world, p_uid, 'You pack dirt in to bring the ground up.', 'event');
      else
        perform tell(p_world, p_uid, 'You need '
          || lower((select name from item_def where id = v_spoil))
          || ' or dirt to bring this ground up, in the pack or in something beside you.', 'error');
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
    -- Dirt, clay or sand: the one named off the menu, or the first to hand.
    v_spoil := spoil_near(p_world, p_uid, target_item(p_target));
    if v_spoil is null or not take_spoil(p_world, p_uid, v_spoil) then return; end if;
    perform raise_corner(p_world, cx, cy, 1);
    -- What a spadeful covers over becomes what was in it, off the list both
    -- sides read: a clay bank or a beach can be laid now as well as dug.
    if exists (select 1 from buryable b where b.tile = here) then
      perform land_set_tile(p_world, tx, ty, spoil_tile(v_spoil));
    end if;
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You drop the ' || lower((select name from item_def where id = v_spoil))
      || ' on the ' || corner_name(tx, ty, cx, cy) || ' corner, raising the ground.', 'event');

  elsif p_action = 'raise_rock' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Spent either way: concrete that slumps off is concrete gone.
    if not consume(p_world, p_uid, 'concrete', 1) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'masonry');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'trowel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      v_gained := skill_raise(p_world, p_uid, 'masonry', try_gain(false));
      perform tell(p_world, p_uid, 'The concrete slumps off the rock before it sets, and is lost.', 'event');
      perform skill_said(p_world, p_uid, 'masonry', v_gained);
      return;
    end if;
    -- The rock rises: the height goes up and the soil over it stays nought.
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay concrete on the ' || corner_name(tx, ty, cx, cy)
      || ' corner and the rock stands a step higher.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'masonry', 1);

  elsif p_action = 'dredge' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    v_skill := skill_of(p_world, p_uid, 'digging');
    v_tool := tool_ql(p_world, p_uid, 'shovel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      v_gained := skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'The shovel comes up with nothing but water.', 'event');
      perform skill_said(p_world, p_uid, 'digging', v_gained);
      return;
    end if;
    -- The bottom comes up a spadeful at a time, exactly as a corner ashore
    -- does under `dig`: the height and the soil over the rock go down
    -- together, and the water over it is that much deeper.
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    v_n := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, v_n);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    v_ql := product_ql(v_skill, v_tool);
    perform give(p_world, p_uid, v_spoil, 1, v_ql);
    perform tell(p_world, p_uid, 'You dredge up some ' || lower((select name from item_def where id = v_spoil))
      || ' off the bottom at the ' || corner_name(tx, ty, cx, cy) || ' corner. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    v_gained := skill_raise(p_world, p_uid, 'digging', 1);

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
    -- Grass kept cut on a deed becomes lawn: the tile counts the days, in
    -- the bits `tree_day` reads.
    if here = tile_id('Grass') and on_deed(p_world, tx, ty) then
      v_n := v_data & 3;
      perform land_set_data(p_world, tx, ty, v_n | 4);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You cut two bundles of mixed grass.'
        || case when 3 - v_n - 1 > 0
             then ' Kept cut, this will be lawn in ' || (3 - v_n - 1) || ' more day' || case when 3 - v_n - 1 = 1 then '' else 's' end || '.'
             else ' Kept cut, this will be lawn tomorrow.' end, 'event');
    else
      perform tell(p_world, p_uid, 'You cut two bundles of mixed grass.', 'event');
    end if;
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
    -- An old tree carries more than one only just come into bearing, and a
    -- very old one as much as an old one.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_n := greatest(1, round(case when tree_age(v_data) in (2, 4) then 5 else 3 end
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

  elsif p_action = 'prune' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    select * into v_age from tree_age_def where id = tree_age(v_data);
    select * into v_to from tree_age_def where id = v_age.pruned;
    -- The door has already said no to a tree too young for this; a null age
    -- is never written into a tile.
    if v_to.id is null then return; end if;
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'sickle');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      v_gained := skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You cut at the ' || lower(v_tree.name)
        || ' and take off nothing that matters.', 'event');
      perform skill_said(p_world, p_uid, 'forestry', v_gained);
      return;
    end if;
    /*
     * The age and nothing else. The species stays, and so does the notch a
     * hatchet has left in the trunk — it is beside the land, and the tile is
     * still a tree: pruning is the crown's business, and a half-felled tree
     * pruned back is still half felled.
     */
    perform land_set_data(p_world, tx, ty, tree_pack(tree_species(v_data), v_to.id));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You prune the ' || lower(v_age.name) || ' ' || lower(v_tree.name)
      || ' back. It stands as a ' || lower(v_to.name) || ' ' || lower(v_tree.name) || ' now.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'plant' then
    -- The one chosen off the menu first, and the oldest that comes to hand if
    -- nobody chose. Sprouts come in nine species and what goes in the ground
    -- is what stands there for the next twenty years, so "whichever was picked
    -- up first" was not a choice anybody had made.
    select * into v_sprout from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'sprout' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by (id = target_item(p_target)) desc, id limit 1;
    if not found then return; end if;
    v_species := coalesce((select id from tree_def where name = v_sprout.extra), 0);
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 16);
    -- Species and age packed the one way (`tree_pack`): a planted tree
    -- starts as a sapling and grows on the same clock as one that seeded itself.
    perform land_set_data(p_world, tx, ty, tree_pack(v_species, 0));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'planted');
    if (select fruit from tree_def where id = v_species) is not null then
      perform journal_note(p_world, p_uid, 'orchard');
    end if;
    perform tell(p_world, p_uid, 'You plant the '
      || lower((select name from tree_def where id = v_species)) || ' sprout.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'graft' then
    -- The sprout named off the menu, or the first fruit sprout to hand.
    select i.* into v_sprout from item i join tree_def td on td.name = i.extra and td.fruit is not null
     where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and i.def = 'sprout' and not i.locked
       and (target_item(p_target) is null or i.id = target_item(p_target))
     order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    v_species := (select id from tree_def where name = v_sprout.extra);
    -- The sprout is spent either way: a graft that does not take is a sprout gone.
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'carving_knife');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'carving_knife'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      v_gained := skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'The ' || lower(v_sprout.extra) || ' graft does not take, and the sprout is spent.', 'event');
      perform skill_said(p_world, p_uid, 'forestry', v_gained);
      return;
    end if;
    -- The species and nothing else: the age stays, and so does any notch.
    perform land_set_data(p_world, tx, ty, tree_pack(v_species, tree_age(v_data)));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'orchard');
    perform tell(p_world, p_uid, 'You graft the ' || lower(v_sprout.extra) || ' sprout onto the ' || lower(v_tree.name)
      || '. It is a ' || lower((select name from tree_age_def where id = tree_age(v_data))) || ' '
      || lower(v_sprout.extra) || ' tree now.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'harvest_bush' then
    -- As fruit off a tree: more to a practised hand, and never nothing.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'sickle');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    v_n := greatest(1, round(3 * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int);
    v_ql := product_ql(v_skill, v_tool);
    perform give(p_world, p_uid, (select yields from bush_def where id = bush_species(v_data)), v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' '
      || lower((select name from item_def where id = (select yields from bush_def where id = bush_species(v_data))))
      || ' off the ' || lower((select name from bush_def where id = bush_species(v_data)))
      || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'dig_stump' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    v_skill := skill_of(p_world, p_uid, 'digging');
    v_tool := tool_ql(p_world, p_uid, 'shovel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      v_gained := skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'The roots hold. You dig round the ' || lower(v_tree.name)
        || ' stump and it does not shift.', 'event');
      perform skill_said(p_world, p_uid, 'digging', v_gained);
      return;
    end if;
    -- Bare dirt where it stood: the roots came out with it.
    perform land_set_tile(p_world, tx, ty, tile_id('Dirt'));
    perform land_set_data(p_world, tx, ty, 0);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You dig the ' || lower(v_tree.name)
      || ' stump out. The ground is bare dirt where it stood.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'digging', 1);

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

CREATE OR REPLACE FUNCTION public.ground_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('flatten', 'drop_dirt', 'pave_slabs', 'remove_paving',
                      'cut_grass', 'cut_reeds', 'pick_fruit', 'pick_sprout',
                      'plant', 'prune', 'graft', 'harvest_bush', 'dig_stump', 'raise_rock', 'dredge', 'dig_worms', 'prospect',
                      -- The surveyor's level, which is a corner and nothing else.
                      'take_level', 'clear_level')
$function$;

CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
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
  /*
   * On the slow half only, because this writes.
   *
   * The fast read runs about once a second per body — everything burning, what
   * is on the tile under you — and a settle on that path is an update a second
   * per player whether or not anything is due. The crops ride the slow half
   * beside the settlements, and any of your own work forces one of those, so
   * sowing is seen at once and a stage is at worst one reconcile late.
   */
  if p_slow then perform crops_settle(p_world, p.x, p.y, p_range); end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false),
        /*
         * And what is in it, which this never said.
         *
         * Reported as "i opened it and dragged my dirt into it and the dirt
         * vanished". It had not: the island had the dirt in the bin and told
         * nobody. Every chest, bin, larder and cart on an island read as
         * empty over there, so anything put away went out of the pack and was
         * never seen again — the same hole a crate fell down before crates
         * carried their contents, and closed the same way. Within six tiles
         * only: you must be within two and a half to reach into one, so six
         * is generous, and a yard of full chests is not worth a phone's
         * second.
         */
                              'things', case when pl.kind = 'furniture'
                                              and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= 6
                                then coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                                       'count', i.count, 'extra', i.extra) order by i.id)
                                     from item i
                                     where i.world_id = p_world and i.holder = 'furniture' and i.placed = pl.id),
                                   '[]'::jsonb)
                                else '[]'::jsonb end)
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', crates_near(p_world, me, p_range),
    /*
     * And what is lying on the ground, which this never carried.
     *
     * Reported as "killed a roxxa, no corpse dropped to butcher, or at least
     * isn't displaying". The corpse was there: `wound_beast` drops one where
     * the thing fell, and the suite has measured it since kills were ported.
     * This sent the fires, the crates, the crops and the walls, and never a
     * thing lying on the grass — and the browser's map of the ground was only
     * ever written by its own rules, which do not run on an island. So a
     * corpse, a log a worker put down, a hatchet somebody else dropped: all
     * in this table and drawn by nobody.
     *
     * On the fast half, because a corpse is looked for the second the thing
     * goes down; `item_on_ground` serves the box. The whole row, the way the
     * pack is sent, so the browser reads it with the same map.
     */
    'lying', coalesce((select jsonb_agg(to_jsonb(i) - 'world_id' order by i.id)
      from item i
      where i.world_id = p_world and i.holder = 'ground'
        and i.gx between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and i.gy between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb))
  /*
   * And the half that hardly ever moves.
   *
   * A fire burns down and a kiln works through its load while you stand and
   * watch it, which is why this is asked for every second. A wall is not like
   * that: it goes up when somebody builds it and then it is a wall. Sending
   * both at one pace meant a correlated subquery over `building_tile` per
   * building, a scan of `wall` and one of `floor_tile`, every second for every
   * player, to say that the house is still a house.
   *
   * So the caller says whether it wants them. A browser asks for the lot on
   * its twenty-second reconcile and after any of its own work, and for the
   * burning half the rest of the time. Left out rather than emptied: the
   * browser applies only the keys it is given, so what it holds stands.
   *
   * `p_slow` defaults true, so a page that has not been redeployed gets
   * exactly what it always got.
   */
  || case when not p_slow then '{}'::jsonb else jsonb_build_object(
    /*
     * And everybody ashore, on the slow half, which is the beat that already
     * carries the settlements. The map draws them; `folk_ashore` decides
     * whether there is anything to draw them at.
     */
    'folk', folk_ashore(p_world, me),
    /*
     * What is growing here, settled first so the stage reported is the stage
     * it is actually at rather than the stage it was at when somebody last
     * touched it. Everything on this island settles lazily off a timestamp,
     * and for a crop nobody had ever been the one to ask.
     *
     * `ago` rather than `stage_at`: the browser counts in its own seconds and
     * has no use for the hour this island stamped on it.
     */
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
        'x', c.x, 'y', c.y, 'id', c.id, 'stage', c.stage,
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql))
      from crop c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    /*
     * The felling notches near you, and how long ago the woods last turned
     * over. Look reads both: "2 of 3 strokes in it", "the woods turn over in
     * 9 hours". A browser on an island keeps no clock of its own for the
     * woods, so this is the only place it hears the hour.
     */
    'notches', coalesce((select jsonb_agg(jsonb_build_object('x', n.x, 'y', n.y, 'cuts', n.cuts))
      from tree_notch n
      where n.world_id = p_world
        and greatest(abs(n.x + 0.5 - p.x), abs(n.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'treesAgo', (select extract(epoch from (now() - w.trees_at)) from world w where w.id = p_world),
    -- The mark the ground is being worked to, which lives on the player row
    -- so that it is the same mark in every browser you open.
    'level', p.level_h,
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true)
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        -- Land you were asked onto is land you may work, so it is drawn as
        -- yours rather than as a stranger's border you happen to be inside.
        'mine', exists (select 1 from deed_member m where m.world_id = p_world
                          and m.uid = me and m.founder = d.founded_by),
        'holder', account_name(d.founded_by)) order by d.founded_at)
      from deed d
      where d.world_id = p_world and d.founded_by <> me
        and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= p_range + d.radius),
      '[]'::jsonb),
    /*
     * And what is standing.
     *
     * `building`, `wall` and `floor_tile` have been kept here since buildings
     * were ported and have never been sent to anybody. The rules answered
     * about them, a plan went up in Postgres, and no browser ever drew a wall
     * of it — so on an island a building was invisible to everyone, the person
     * who planned it included.
     *
     * Shaped as the browser's own `BuildingsJSON`, so it is laid straight in.
     * A building comes along whole if any of its tiles is in range: half a
     * house is worse than none, and a house is a handful of rows.
     */
    'buildings', jsonb_build_object(
      'nextId', coalesce((select max(b.id) + 1 from building b where b.world_id = p_world), 1),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'levels', b.levels, 'workLevel', b.work_level,
          'tiles', (select coalesce(jsonb_agg(bt.x || ',' || bt.y order by bt.y, bt.x), '[]'::jsonb)
                      from building_tile bt
                     where bt.world_id = p_world and bt.building = b.id)) order by b.id)
        from building b
        where b.world_id = p_world
          and exists (select 1 from building_tile bt
                       where bt.world_id = p_world and bt.building = b.id
                         and greatest(abs(bt.x + 0.5 - p.x), abs(bt.y + 0.5 - p.y)) <= p_range)),
        '[]'::jsonb),
      'walls', coalesce((select jsonb_agg(jsonb_build_object(
          'building', w.building, 'level', w.level, 'x', w.x, 'y', w.y, 'dir', w.dir,
          'type', w.type, 'material', w.material, 'needed', w.needed, 'total', w.total)
          order by w.level, w.dir, w.x, w.y)
        from wall w
        where w.world_id = p_world
          and greatest(abs(w.x + 0.5 - p.x), abs(w.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      'floors', coalesce((select jsonb_agg(jsonb_build_object(
          'building', f.building, 'level', f.level, 'x', f.x, 'y', f.y,
          'material', f.material, 'kind', f.kind, 'facing', f.facing,
          'needed', f.needed, 'total', f.total) order by f.level, f.x, f.y)
        from floor_tile f
        where f.world_id = p_world
          and greatest(abs(f.x + 0.5 - p.x), abs(f.y + 0.5 - p.y)) <= p_range), '[]'::jsonb))) end;
end $function$;

select private.lock_doors();
