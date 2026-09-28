-- Garden steps: a flight laid up a sloping tile, walked where the bare ground
-- would be too steep to stand on.
--
-- The tile is `steps_tile()` (23), the stone (an index of `slab_def`) or, with
-- `steps_timber_bit()` set, the wood (an index of `tree_def`) in its data
-- byte, and which way it climbs is read off its four corners (`steps_fit`),
-- the same way the browser reads them (`stepsFit` in `src/world/tiles.ts`).
--
-- What it changes about walking is two things, the browser's `standsOn` and
-- `groundStep` on this side:
--
--   * a flight is stood on at any slope a flight is laid on, `steps_most()`,
--     or the body's own cap where that is higher (`stand_cap`): in
--     `walk_share`, `creature_tile_ok` and `line_clear`;
--   * a step onto a flight or off one is not measured centre to centre, since
--     the flight carries you from its foot to its head: only the tile stepped
--     onto is asked whether it can be stood on (`walk_share`);
--
-- and two about who uses it: no wheel takes one (a cart or a wagon being
-- driven, in `walk_share`, as `Game.driveRule` refuses it), and a step on or
-- off one teaches the feet no climbing (`walk_climbs`, as `tryMove` counts it).
--
-- It is laid, and taken up, as ground work: `lay_steps` in stone with a
-- trowel, `lay_timber_steps` with a mallet, and `take_up_steps` with a
-- pickaxe, through `ground_refusal` and `perform_ground` like paving, and
-- inside a settlement only by those who may shape its ground.

/** The steepest a tile may be for a body to stand on it: its own cap, or on a flight at least `steps_most()`. */
create or replace function stand_cap(p_tile int, p_cap double precision)
returns double precision language sql immutable as $$
  select case when p_tile = steps_tile() then greatest(steps_most(), p_cap) else p_cap end
$$;

/**
 * Which way the ground of a tile climbs, and how far, and how far out of
 * level each end of it is, and its slope: the browser's `stepsFit`. The side
 * whose two corners stand highest over the two opposite, first of n e s w on
 * a tie.
 */
create or replace function steps_fit(p_world uuid, p_x int, p_y int,
  out up text, out rise double precision, out twist int, out slope int)
language plpgsql stable as $$
declare nw int; ne int; se int; sw int; r double precision;
begin
  nw := land_height(p_world, p_x, p_y); ne := land_height(p_world, p_x + 1, p_y);
  se := land_height(p_world, p_x + 1, p_y + 1); sw := land_height(p_world, p_x, p_y + 1);
  up := 'n'; rise := (nw + ne - se - sw) / 2.0; twist := greatest(abs(nw - ne), abs(sw - se));
  r := (ne + se - nw - sw) / 2.0;
  if r > rise then up := 'e'; rise := r; twist := greatest(abs(ne - se), abs(nw - sw)); end if;
  r := (se + sw - nw - ne) / 2.0;
  if r > rise then up := 's'; rise := r; twist := greatest(abs(nw - ne), abs(sw - se)); end if;
  r := (nw + sw - ne - se) / 2.0;
  if r > rise then up := 'w'; rise := r; twist := greatest(abs(ne - se), abs(nw - sw)); end if;
  slope := greatest(nw, ne, se, sw) - least(nw, ne, se, sw);
end $$;

/** Why a flight will not go on this tile's ground, or null: the browser's `stepsGroundRefusal`, word for word. */
create or replace function steps_ground_refusal(p_world uuid, p_x int, p_y int)
returns text language plpgsql stable as $$
declare f record;
begin
  select * into f from steps_fit(p_world, p_x, p_y);
  if f.slope < steps_least() or f.slope > steps_most() then
    return 'Steps are laid on a slope of ' || steps_least()::int || ' to ' || steps_most()::int
      || '. This one is ' || f.slope || '.';
  end if;
  if f.twist > steps_twist() then
    return 'The two corners at each end of a flight have to be within ' || steps_twist()::int
      || ' of each other. These are ' || f.twist || ' apart.';
  end if;
  return null;
end $$;

/** What a flight is called: "Marble steps", "Oak steps". The browser's `stepsName`. */
create or replace function steps_name(p_data int)
returns text language sql stable as $$
  select case when (p_data & steps_timber_bit()) <> 0
    then (select name from tree_def where id = least((select max(id) from tree_def), p_data & 31)) || ' steps'
    else regexp_replace((select name from slab_def where id = least((select max(id) from slab_def), p_data & 3)), ' slabs$', '') || ' steps' end
$$;

/** The brick a stone flight's risers and cheeks are laid in, for the slab its treads are cut from. */
create or replace function steps_brick(p_slab text)
returns text language sql immutable as $$ select regexp_replace(p_slab, '_slab$', '_brick') $$;

/** Which of the woods a plank is, as a flight's data byte keeps it: a plank with none written on it is pine. */
create or replace function steps_wood(p_extra text)
returns int language sql stable as $$
  select coalesce((select id from tree_def where name = p_extra), (select id from tree_def where name = 'Pine'))
$$;

/** The slab a stone flight is laid with: the one named, or the first cut slab in the pack; null when that is not one. */
create or replace function steps_slab(p_world uuid, p_uid uuid, p_target jsonb)
returns item language sql stable as $$
  select i.* from item i join slab_def s on s.item = i.def
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
     and (target_item(p_target) is null or i.id = target_item(p_target))
   order by i.id limit 1
$$;

/** The planks a timber flight is laid with: the ones named, or the first in the pack. */
create or replace function steps_planks(p_world uuid, p_uid uuid, p_target jsonb)
returns item language sql stable as $$
  select i.* from item i
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked and i.def = 'plank'
     and (target_item(p_target) is null or i.id = target_item(p_target))
   order by i.id limit 1
$$;

/** Loose planks in the pack of exactly this wood, one with none written on it counting only with others like it. */
create or replace function steps_planks_of(p_world uuid, p_uid uuid, p_extra text)
returns int language sql stable as $$
  select coalesce(sum(i.count), 0)::int from item i
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
     and i.def = 'plank' and i.extra is not distinct from p_extra
$$;

/**
 * Why a flight will not be laid or taken up, after the reach and the tool,
 * which `act_refusal_rules` asks of every job that works the ground: the
 * building over it, the packing, the water, the shape of the ground, and what
 * goes into it. The browser's `STEPS_ACTIONS` doors, in the same words.
 */
create or replace function steps_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns text language plpgsql stable as $$
declare tx int; ty int; here int; v_under text; v_why text; v_it item;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  if p_action = 'take_up_steps' then
    if here <> steps_tile() then return 'There are no steps here.'; end if;
    return under_building(p_world, tx, ty);
  end if;
  v_under := under_building(p_world, tx, ty);
  if v_under is not null then return v_under; end if;
  if here <> 2 then return 'The ground has to be packed flat before anything is laid on it.'; end if;
  if has_water(p_world, tx, ty) then return 'Not under water.'; end if;
  v_why := steps_ground_refusal(p_world, tx, ty);
  if v_why is not null then return v_why; end if;
  if p_action = 'lay_steps' then
    v_it := steps_slab(p_world, p_uid, p_target);
    if v_it.id is null or pack_count(p_world, p_uid, v_it.def) < steps_slabs()
       or pack_count(p_world, p_uid, steps_brick(v_it.def)) < steps_bricks()
       or pack_count(p_world, p_uid, 'mortar') < steps_mortar() then
      return 'A flight of stone steps takes ' || number_word(steps_slabs()::int) || ' cut slabs of one stone, '
        || number_word(steps_bricks()::int) || ' bricks of the same stone and ' || number_word(steps_mortar()::int) || ' mortar.';
    end if;
  else
    v_it := steps_planks(p_world, p_uid, p_target);
    if v_it.id is null or steps_planks_of(p_world, p_uid, v_it.extra) < steps_planks()
       or pack_count(p_world, p_uid, 'nail') < steps_nails() then
      return 'A flight of timber steps takes ' || number_word(steps_planks()::int) || ' planks of one wood and '
        || number_word(steps_nails()::int) || ' nails.';
    end if;
  end if;
  return null;
end $$;

/**
 * A go at laying a flight or taking one up: the browser's `STEPS_ACTIONS`
 * performers. The tool is worn every go, as the browser wears it; a failed
 * laying spends nothing and teaches a try; a flight taken up leaves packed
 * dirt and gives back `steps_back()` of its slabs and bricks, or its planks.
 */
create or replace function perform_steps(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns void language plpgsql as $$
declare tx int; ty int; d action_def; v_it item; v_tool bigint; v_data int; v_left int; v_take int;
        v_row record; v_ql double precision; v_name text; v_slab text; v_n int; v_m int;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  select * into d from action_def where id = p_action;
  select i.id into v_tool from item i
    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
    order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;

  if p_action = 'lay_steps' then
    v_it := steps_slab(p_world, p_uid, p_target);
    if v_it.id is null or pack_count(p_world, p_uid, v_it.def) < steps_slabs()
       or pack_count(p_world, p_uid, steps_brick(v_it.def)) < steps_bricks()
       or pack_count(p_world, p_uid, 'mortar') < steps_mortar() then return; end if;
    if v_tool is not null then perform wear_tool(v_tool); end if;
    if not skill_check(skill_of(p_world, p_uid, d.skill), d.difficulty, tool_ql(p_world, p_uid, d.tool)) then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'The treads rock on their bed however you set them. You take them up again.', 'event');
      return;
    end if;
    if not consume(p_world, p_uid, v_it.def, steps_slabs()::int, v_it.id)
       or not consume(p_world, p_uid, steps_brick(v_it.def), steps_bricks()::int)
       or not consume(p_world, p_uid, 'mortar', steps_mortar()::int) then return; end if;
    v_data := (select id from slab_def where item = v_it.def);
    perform land_set_tile(p_world, tx, ty, steps_tile());
    perform land_set_data(p_world, tx, ty, v_data);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay a flight of ' || lower(steps_name(v_data)) || ' up the slope.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'lay_timber_steps' then
    v_it := steps_planks(p_world, p_uid, p_target);
    if v_it.id is null or steps_planks_of(p_world, p_uid, v_it.extra) < steps_planks()
       or pack_count(p_world, p_uid, 'nail') < steps_nails() then return; end if;
    if v_tool is not null then perform wear_tool(v_tool); end if;
    if not skill_check(skill_of(p_world, p_uid, d.skill), d.difficulty, tool_ql(p_world, p_uid, d.tool)) then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'The boards will not sit square on their bearers. You knock them loose again.', 'event');
      return;
    end if;
    -- Planks of the one wood, the stack named first.
    v_left := steps_planks()::int;
    for v_row in
      select i.id, i.count from item i
       where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
         and i.def = 'plank' and i.extra is not distinct from v_it.extra
       order by (i.id = v_it.id) desc, i.id
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_row.count);
      if v_take >= v_row.count then delete from item where id = v_row.id;
      else update item set count = count - v_take where id = v_row.id; end if;
      v_left := v_left - v_take;
    end loop;
    if not consume(p_world, p_uid, 'nail', steps_nails()::int) then return; end if;
    v_data := steps_timber_bit() | steps_wood(v_it.extra);
    perform land_set_tile(p_world, tx, ty, steps_tile());
    perform land_set_data(p_world, tx, ty, v_data);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay a flight of ' || lower(steps_name(v_data)) || ' up the slope.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'take_up_steps' then
    if land_tile(p_world, tx, ty) <> steps_tile() then return; end if;
    if v_tool is not null then perform wear_tool(v_tool); end if;
    v_data := land_data(p_world, tx, ty);
    v_name := lower(steps_name(v_data));
    perform land_set_tile(p_world, tx, ty, 2);
    perform land_set_data(p_world, tx, ty, 0);
    perform land_announce(p_world, tx, ty);
    v_ql := product_ql(skill_of(p_world, p_uid, d.skill));
    if (v_data & steps_timber_bit()) <> 0 then
      v_n := floor(steps_planks() * steps_back())::int;
      perform gather(p_world, p_uid, 'plank', v_n, v_ql,
        (select name from tree_def where id = least((select max(id) from tree_def), v_data & 31)));
      perform tell(p_world, p_uid, 'You take up the ' || v_name || ' and keep ' || number_word(v_n)
        || ' planks whole. The ground under them is packed dirt.', 'event');
    else
      v_slab := (select item from slab_def where id = least((select max(id) from slab_def), v_data & 3));
      v_n := floor(steps_slabs() * steps_back())::int;
      v_m := floor(steps_bricks() * steps_back())::int;
      perform gather(p_world, p_uid, v_slab, v_n, v_ql);
      perform gather(p_world, p_uid, steps_brick(v_slab), v_m, v_ql);
      perform tell(p_world, p_uid, 'You take up the ' || v_name || ' and keep '
        || number_word(v_n) || ' ' || lower((select name from item_def where id = v_slab)) || case when v_n = 1 then '' else 's' end
        || ' and ' || number_word(v_m) || ' ' || lower((select name from item_def where id = steps_brick(v_slab))) || 's'
        || ' whole. The ground under them is packed dirt.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, d.skill, 1);
  end if;
end $$;

-- ---- Garden steps are ground work, and shape a settlement's ground.

CREATE OR REPLACE FUNCTION public.ground_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('flatten', 'drop_dirt', 'pave_slabs', 'remove_paving',
                      'cut_grass', 'cut_reeds', 'pick_fruit', 'pick_sprout',
                      'plant', 'prune', 'graft', 'harvest_bush', 'dig_stump', 'raise_rock', 'dredge', 'dig_worms', 'prospect',
                      -- The surveyor's level, which is a corner and nothing else.
                      'take_level', 'clear_level',
                      -- A Mason's Rubble Fill.
                      'rubble_fill',
                      -- A Forester's Coppice, Tap Resin and Clear Brush.
                      'coppice', 'tap_resin', 'clear_brush',
                      -- Garden steps, laid and taken up.
                      'lay_steps', 'lay_timber_steps', 'take_up_steps')
$function$
;

CREATE OR REPLACE FUNCTION public.shapes_ground(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('dig', 'dredge', 'flatten', 'drop_dirt', 'drop_dirt_here', 'raise_rock',
                      'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble',
                      'pave_slabs', 'remove_paving',
                      'plan_foundation', 'pour_foundation', 'strike_foundation',
                      'dig_spring', 'stop_spring', 'dig_pool', 'fill_pool',
                      'lay_steps', 'lay_timber_steps', 'take_up_steps')
$function$
;

-- ---- The ground doors hand a flight to its own.

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

  -- A flight of garden steps answers for itself (`steps_refusal`).
  if p_action in ('lay_steps', 'lay_timber_steps', 'take_up_steps') then
    return steps_refusal(p_world, p_uid, p_action, p_target);
  end if;

  if p_action = 'flatten' then
    if t.dig_yield is null then return 'You cannot flatten that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel to flatten.'; end if;
    -- Shallows are workable, to the depth a pick works to. `has_water` refuses
    -- a tile with one corner an inch under, which is most of a shoreline.
    if centre_height(p_world, tx, ty) < -pk(p_world, p_uid, 'depth:dig', mine_depth()) then
      return 'The water is too deep here to work in.';
    end if;
    if flatten_target(p_world, p_uid, tx, ty) < -pk(p_world, p_uid, 'depth:dig', mine_depth()) then
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
    return rock_raise_refusal(p_world, p_uid, cx, cy, 'Concrete');

  elsif p_action = 'rubble_fill' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if pk(p_world, p_uid, 'rubble', 0) <= 0 then return 'That wants a Mason who has learned to fill with rubble.'; end if;
    if pack_count(p_world, p_uid, 'rock_shards') < pk(p_world, p_uid, 'rubble', 0) then
      return 'You need ' || number_word(pk(p_world, p_uid, 'rubble', 0)::int) || ' rock shards.';
    end if;
    return rock_raise_refusal(p_world, p_uid, cx, cy, 'Rubble');

  elsif p_action = 'dredge' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Digging from a boat: the bottom comes up a spadeful at a time, to a
    -- depth the shore never reaches. The doors are the digger's, in the
    -- digger's words, with the hull's in front of them.
    if t.dig_yield is null then return 'You cannot dredge that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel to dredge with.'; end if;
    if not coalesce(is_boat(driving(p_world, p_uid)), false) then return 'Dredging is done from a boat.'; end if;
    if land_height(p_world, cx, cy) >= 0 then return 'That corner is above the water. Dig it from the shore.'; end if;
    if land_height(p_world, cx, cy) < -pk(p_world, p_uid, 'depth:dredge', dredge_depth()) then return 'The bottom is too deep to reach from a boat.'; end if;
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
    if here not in (14, 21) then return 'There is no paving here to break up.'; end if;
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

  elsif p_action = 'coppice' then
    if pk(p_world, p_uid, 'coppice', 0) <= 0 then return 'That wants a Forester who has learned to coppice.'; end if;
    if here <> 16 then return 'There is no tree here to coppice.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no coppicing a dead tree.';
    end if;
    -- Grown enough to bear: mature and older.
    if not coalesce((select bears from tree_age_def where id = tree_age(v_data)), false) then
      return 'The ' || lower(v_tree.name) || ' is too young to coppice. Let it grow.';
    end if;

  elsif p_action = 'tap_resin' then
    if pk(p_world, p_uid, 'tap_resin', 0) <= 0 then return 'That wants a Forester who has learned to tap resin.'; end if;
    if here <> 16 then return 'There is no tree here to tap.'; end if;
    select * into v_tree from tree_def where id = resin_tree();
    if tree_species(v_data) <> resin_tree() then return 'Only a ' || lower(v_tree.name) || ' gives resin.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'A dead ' || lower(v_tree.name) || ' gives no resin.';
    end if;
    -- Not a sapling, and not one clipped to a shrub: a tree with timber in it.
    if coalesce((select logs from tree_age_def where id = tree_age(v_data)), 0) <= 0 then
      return 'The ' || lower(v_tree.name) || ' is too small to tap. Let it grow.';
    end if;
    -- Once a day for each pine, the day turning at the woods' dawn.
    if exists (select 1 from foraged f where f.world_id = p_world and f.x = tx and f.y = ty
                 and f.kind = 'resin' and f.at >= tree_last_dawn()) then
      return 'This ' || lower(v_tree.name) || ' has given its resin today. It runs again at dawn.';
    end if;

  elsif p_action = 'clear_brush' then
    if pk(p_world, p_uid, 'clear_brush', 0) <= 0 then return 'That wants a Forester who has learned to clear brush.'; end if;
    if here not in (tile_id('Bush'), tile_id('Reed')) then return 'There is no brush here to clear.'; end if;

  elsif p_action = 'dig_worms' then
    if not t.wormy then return 'Nothing lives in that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel.'; end if;
    if has_water(p_world, tx, ty) then return 'Not under water.'; end if;

  elsif p_action = 'prospect' then
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to prospect.'; end if;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.perform_ground(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        d action_def; v_spoil text;
        v_skill double precision; v_tool double precision; v_ql double precision; v_n int; v_slab item; v_kind int; v_target int; v_hi record; v_lo record;
        v_rock rock_def; v_rad int; v_tiles int[] := '{}'; v_names text[] := '{}'; v_row record;
        v_id bigint; v_species int; v_sprout item; v_buried text; v_size int;
        v_age tree_age_def; v_to tree_age_def; v_needs double precision; v_grown int; v_cut int;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);
  select * into d from action_def where id = p_action;
  -- What this ground is made of, which digging has always read off the tile
  -- and flattening never did.
  v_spoil := coalesce(t.dig_yield, 'dirt');

  -- A flight of garden steps, laid or taken up (`perform_steps`).
  if p_action in ('lay_steps', 'lay_timber_steps', 'take_up_steps') then
    perform perform_steps(p_world, p_uid, p_action, p_target);
    return;
  end if;

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
    /*
     * A go moves `flatten_step` -- two units for a Terraformer's Level Hand --
     * but never past the height being worked to, so a corner one short of it
     * moves the one.
     */
    v_n := pk(p_world, p_uid, 'flatten:step', flatten_step())::int;
    if v_hi.cx is not null then
      v_n := least(v_n, land_height(p_world, v_hi.cx, v_hi.cy) - v_target, land_dirt(p_world, v_hi.cx, v_hi.cy));
    end if;
    if v_lo.cx is not null then v_n := least(v_n, v_target - land_height(p_world, v_lo.cx, v_lo.cy)); end if;
    v_n := greatest(1, v_n);
    if v_hi.cx is not null and v_lo.cx is not null then
      -- One corner down and one up: the dirt simply moves across the tile.
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -v_n);
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, v_n);
      perform tell(p_world, p_uid, 'You move some dirt across the tile.', 'event');
    elsif v_hi.cx is not null then
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -v_n);
      perform gather(p_world, p_uid, v_spoil, v_n,
        least(100, product_ql(skill_of(p_world, p_uid, d.skill), tool_ql(p_world, p_uid, 'shovel'))
                   * pk(p_world, p_uid, 'ql:flatten', 1)));
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
        -- And the second unit of a Level Hand's go, if there is soil for it.
        if v_n > 1 and take_spoil(p_world, p_uid, v_spoil) then perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1); end if;
        perform tell(p_world, p_uid, 'You pack '
          || lower((select name from item_def where id = v_spoil))
          || ' in to bring the ground up.', 'event');
      elsif take_spoil(p_world, p_uid, 'dirt') then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        if v_n > 1 and take_spoil(p_world, p_uid, 'dirt') then perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1); end if;
        perform tell(p_world, p_uid, 'You pack dirt in to bring the ground up.', 'event');
      else
        perform tell(p_world, p_uid, 'You need '
          || lower((select name from item_def where id = v_spoil))
          || ' or dirt to bring this ground up, in the pack or in something beside you.', 'error');
        return;
      end if;
    end if;
    -- And what an hour of levelling ground teaches, which was nothing at all.
    perform skill_raise(p_world, p_uid, d.skill, 1);
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
    -- A Mason's Concrete Hand never fails (`fail:raise_rock`).
    if not perk_pass(skill_check(v_skill, d.difficulty, v_tool), pk(p_world, p_uid, 'fail:raise_rock', 1)) then
      perform skill_raise(p_world, p_uid, 'masonry', try_gain(false));
      perform tell(p_world, p_uid, 'The concrete slumps off the rock before it sets, and is lost.', 'event');
      return;
    end if;
    -- The rock rises: the height goes up and the soil over it stays nought --
    -- two steps for a Mason's Double Lift, where the slope and the level let it.
    v_n := greatest(1, floor(pk(p_world, p_uid, 'lift:raise_rock', 1))::int);
    if v_n > 1 and (slope_refusal(p_world, p_uid, 'masonry', cx, cy, v_n) is not null
                    or land_height(p_world, cx, cy) + v_n
                       > coalesce((select pl.level_h from player pl where pl.world_id = p_world and pl.uid = p_uid),
                                  land_height(p_world, cx, cy) + v_n)) then
      v_n := 1;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + v_n);
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay concrete on the ' || corner_name(tx, ty, cx, cy)
      || ' corner and the rock stands ' || case when v_n > 1 then number_word(v_n) || ' steps' else 'a step' end
      || ' higher.', 'event');
    perform skill_raise(p_world, p_uid, 'masonry', 1);

  /*
   * A Mason's Rubble Fill: the same step up on bare rock for rock shards
   * rather than a concrete, spent either way, under the same check.
   */
  elsif p_action = 'rubble_fill' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if not consume(p_world, p_uid, 'rock_shards', pk(p_world, p_uid, 'rubble', 0)::int) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'masonry');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'trowel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'masonry', try_gain(false));
      perform tell(p_world, p_uid, 'The rubble slides off the rock before it binds, and is lost.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You pack rubble into the ' || corner_name(tx, ty, cx, cy)
      || ' corner and the rock stands a step higher.', 'event');
    perform skill_raise(p_world, p_uid, 'masonry', 1);

  elsif p_action = 'dredge' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    v_skill := skill_of(p_world, p_uid, 'digging');
    v_tool := tool_ql(p_world, p_uid, 'shovel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'The shovel comes up with nothing but water.', 'event');
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
    v_ql := least(100, product_ql(v_skill, v_tool) * pk(p_world, p_uid, 'ql:dredge', 1));
    perform gather(p_world, p_uid, v_spoil, 1, v_ql, null, perk_rare(pk(p_world, p_uid, 'rare:dredge', 0)));
    perform tell(p_world, p_uid, 'You dredge up some ' || lower((select name from item_def where id = v_spoil))
      || ' off the bottom at the ' || corner_name(tx, ty, cx, cy) || ' corner. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'pave_slabs' then
    select i.* into v_slab from item i join slab_def s on s.item = i.def
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
      order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select id into v_kind from slab_def where item = v_slab.def;
    if not perk_pass(skill_check(skill_of(p_world, p_uid, 'paving'), d.difficulty, v_slab.ql),
                     pk(p_world, p_uid, 'fail:pave_slabs', 1)) then
      perform skill_raise(p_world, p_uid, 'paving', try_gain(false));
      perform tell(p_world, p_uid,
        'The slab rocks on its bed however you set it. You leave it for now.', 'event');
      return;
    end if;
    if not consume(p_world, p_uid, v_slab.def, 1, v_slab.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 21);
    perform land_set_data(p_world, tx, ty, v_kind);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You bed the '
      || lower((select name from item_def where id = v_slab.def)) || ' down flat and true.', 'event');
    perform skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'remove_paving' then
    -- A slab comes up whole more often than not; gravel and cobbles do not.
    v_kind := case when here = 21 then v_data & 3 else null end;
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    if v_kind is not null and random() < 0.6 then
      v_ql := product_ql(skill_of(p_world, p_uid, 'paving'));
      perform gather(p_world, p_uid, (select item from slab_def where id = v_kind), 1, v_ql);
      perform tell(p_world, p_uid, 'You lever the '
        || regexp_replace(lower((select name from slab_def where id = v_kind)), 's$', '')
        || ' up whole. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    else
      perform tell(p_world, p_uid, 'You break up the paving, leaving bare dirt.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'cut_grass' then
    perform mark_foraged(p_world, tx, ty, 'grass');
    -- More to a cut for a Naturalist's Hay Cutter.
    v_cut := floor(pk(p_world, p_uid, 'count:mixed_grass', grass_per_cut()))::int;
    perform gather(p_world, p_uid, 'mixed_grass', v_cut, product_ql(skill_of(p_world, p_uid, 'foraging')));
    -- Grass kept cut on a deed becomes lawn: the tile counts the days, in
    -- the bits `tree_day` reads.
    if here = tile_id('Grass') and on_deed(p_world, tx, ty) then
      v_n := v_data & 3;
      perform land_set_data(p_world, tx, ty, v_n | 4);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You cut ' || number_word(v_cut) || ' bundles of mixed grass.'
        || case when 3 - v_n - 1 > 0
             then ' Kept cut, this will be lawn in ' || (3 - v_n - 1) || ' more day' || case when 3 - v_n - 1 = 1 then '' else 's' end || '.'
             else ' Kept cut, this will be lawn tomorrow.' end, 'event');
    else
      perform tell(p_world, p_uid, 'You cut ' || number_word(v_cut) || ' bundles of mixed grass.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_reeds' then
    perform mark_foraged(p_world, tx, ty, 'reed');
    v_skill := skill_of(p_world, p_uid, 'foraging');
    -- Never fewer than a Naturalist's Reed Cutter says, whatever the roll.
    v_n := greatest(floor(pk(p_world, p_uid, 'count:reed', 0))::int,
                    reed_cut()::int + case when random() < v_skill / reed_extra_at() then 1 else 0 end);
    perform gather(p_world, p_uid, 'reed', v_n,
      product_ql(v_skill, tool_ql(p_world, p_uid, 'carving_knife')));
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' reeds out of the bed.', 'event');
    perform skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'pick_fruit' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- An old tree carries more than one only just come into bearing, and a
    -- very old one as much as an old one.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_n := greatest(1, round(case when tree_age(v_data) in (2, 4) then 5 else 3 end
                             * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int)
           -- And one more for a Forester's Fruitful.
           + case when random() < pk(p_world, p_uid, 'more:pick_fruit', 0) then 1 else 0 end;
    v_ql := product_ql(v_skill);
    perform gather(p_world, p_uid, v_tree.fruit, v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    perform skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You pick ' || v_n || ' '
      || lower((select name from item_def where id = v_tree.fruit))
      || case when v_n = 1 then '' else 's' end
      || ' off the ' || lower(v_tree.name) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'pick_sprout' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- A Forester's Sprout Picker never fails (`fail:pick_sprout`).
    if not perk_pass(skill_check(skill_of(p_world, p_uid, 'forestry'), 15), pk(p_world, p_uid, 'fail:pick_sprout', 1)) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You find no sprout worth picking.', 'event');
      return;
    end if;
    -- And picks more than one (`count:sprout`).
    v_n := greatest(1, floor(pk(p_world, p_uid, 'count:sprout', 1))::int);
    perform gather(p_world, p_uid, 'sprout', v_n,
      product_ql(skill_of(p_world, p_uid, 'forestry')), v_tree.name);
    perform tell(p_world, p_uid, case when v_n = 1 then 'You pick a ' || lower(v_tree.name) || ' sprout.'
      else 'You pick ' || number_word(v_n) || ' ' || lower(v_tree.name) || ' sprouts.' end, 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

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
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You cut at the ' || lower(v_tree.name)
        || ' and take off nothing that matters.', 'event');
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
    perform skill_raise(p_world, p_uid, 'forestry', 1);

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
    -- Young, or further on for a Forester's Nursery (`grown:plant`).
    v_grown := planted_age(floor(pk(p_world, p_uid, 'grown:plant', 0))::int);
    perform land_set_data(p_world, tx, ty, tree_pack(v_species, v_grown));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'planted');
    if (select fruit from tree_def where id = v_species) is not null then
      perform journal_note(p_world, p_uid, 'orchard');
    end if;
    perform tell(p_world, p_uid, 'You plant the '
      || lower((select name from tree_def where id = v_species)) || ' sprout.'
      || case when v_grown = planted_age(0) then ''
              else ' It comes up a ' || lower((select name from tree_age_def where id = v_grown)) || ' '
                   || lower((select name from tree_def where id = v_species)) || '.' end, 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

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
    -- A Forester's Master Grafter's graft always takes (`fail:graft`).
    if not perk_pass(skill_check(v_skill, d.difficulty, v_tool), pk(p_world, p_uid, 'fail:graft', 1)) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'The ' || lower(v_sprout.extra) || ' graft does not take, and the sprout is spent.', 'event');
      return;
    end if;
    -- The species and nothing else: the age stays, and so does any notch.
    perform land_set_data(p_world, tx, ty, tree_pack(v_species, tree_age(v_data)));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'orchard');
    perform tell(p_world, p_uid, 'You graft the ' || lower(v_sprout.extra) || ' sprout onto the ' || lower(v_tree.name)
      || '. It is a ' || lower((select name from tree_age_def where id = tree_age(v_data))) || ' '
      || lower(v_sprout.extra) || ' tree now.', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'harvest_bush' then
    -- As fruit off a tree: more to a practised hand, and never nothing.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'sickle');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    v_n := greatest(1, round(3 * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int)
           -- And one more for a Forester's Hedge Harvest.
           + case when random() < pk(p_world, p_uid, 'more:harvest_bush', 0) then 1 else 0 end;
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, (select yields from bush_def where id = bush_species(v_data)), v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    perform skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' '
      || lower((select name from item_def where id = (select yields from bush_def where id = bush_species(v_data))))
      || ' off the ' || lower((select name from bush_def where id = bush_species(v_data)))
      || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'coppice' then
    -- A Forester's Coppice: a tree grown enough to bear, cut back to young off
    -- the stool for `coppice` logs, and left standing to grow on.
    select * into v_tree from tree_def where id = tree_species(v_data);
    select * into v_age from tree_age_def where id = tree_age(v_data);
    if here <> 16 or not coalesce(v_age.alive and v_age.bears, false) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'woodcutting');
    v_tool := tool_ql(p_world, p_uid, 'hatchet');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'hatchet'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'woodcutting', try_gain(false));
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      return;
    end if;
    -- A fresh trunk off the stool: whatever notch was in the old one went with it.
    perform land_set_data(p_world, tx, ty, tree_pack(tree_species(v_data), planted_age(0)));
    delete from tree_notch where world_id = p_world and x = tx and y = ty;
    perform land_announce(p_world, tx, ty);
    v_n := floor(pk(p_world, p_uid, 'coppice', 0))::int;
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, 'log', v_n, v_ql, v_tree.name);
    perform tell(p_world, p_uid, 'You cut the ' || lower(v_age.name) || ' ' || lower(v_tree.name)
      || ' back to the stool and get ' || v_n || case when v_n = 1 then ' log' else ' logs' end
      || '. (QL ' || to_char(v_ql, 'FM990.0') || ') It stands as a '
      || lower((select name from tree_age_def where id = planted_age(0))) || ' ' || lower(v_tree.name) || ' now.', 'event');
    perform skill_raise(p_world, p_uid, 'woodcutting', 1);

  elsif p_action = 'tap_resin' then
    -- A Forester's Tap Resin: `tap_resin` tar out of a living pine, once a day
    -- for each -- the refusal says when it runs again.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'carving_knife');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'carving_knife'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    perform mark_foraged(p_world, tx, ty, 'resin');
    v_n := floor(pk(p_world, p_uid, 'tap_resin', 0))::int;
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, 'tar', v_n, v_ql);
    perform tell(p_world, p_uid, 'You cut the ' || lower((select name from tree_def where id = resin_tree()))
      || '''s bark and collect ' || v_n || ' ' || lower((select name from item_def where id = 'tar'))
      || ' from it. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'clear_brush' then
    -- A Forester's Clear Brush: every bush and reed within `clear_brush` tiles
    -- of the one chosen, in one go. A bush leaves grass and reeds bare dirt,
    -- as `CLEARED_TO` has it in the browser.
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    v_rad := floor(pk(p_world, p_uid, 'clear_brush', 0))::int;
    v_n := 0;
    for v_row in select gx, gy from generate_series(ty - v_rad, ty + v_rad) gy, generate_series(tx - v_rad, tx + v_rad) gx
                  where in_bounds(p_world, gx, gy) and land_tile(p_world, gx, gy) in (tile_id('Bush'), tile_id('Reed')) loop
      perform land_set_tile(p_world, v_row.gx, v_row.gy,
        case when land_tile(p_world, v_row.gx, v_row.gy) = tile_id('Bush') then tile_id('Grass') else tile_id('Dirt') end);
      perform land_set_data(p_world, v_row.gx, v_row.gy, 0);
      perform land_announce(p_world, v_row.gx, v_row.gy);
      v_n := v_n + 1;
    end loop;
    perform tell(p_world, p_uid, 'You clear the brush off ' || v_n || case when v_n = 1 then ' tile.' else ' tiles.' end, 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'dig_stump' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    v_skill := skill_of(p_world, p_uid, 'digging');
    v_tool := tool_ql(p_world, p_uid, 'shovel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'The roots hold. You dig round the ' || lower(v_tree.name)
        || ' stump and it does not shift.', 'event');
      return;
    end if;
    -- Bare dirt where it stood: the roots came out with it.
    perform land_set_tile(p_world, tx, ty, tile_id('Dirt'));
    perform land_set_data(p_world, tx, ty, 0);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You dig the ' || lower(v_tree.name)
      || ' stump out. The ground is bare dirt where it stood.', 'event');
    -- And a log of the tree's kind, for a Terraformer's Stump Puller.
    v_n := pk(p_world, p_uid, 'stump:log', 0)::int;
    if v_n > 0 then
      perform gather(p_world, p_uid, 'log', v_n, product_ql(v_skill, v_tool), v_tree.name);
      perform tell(p_world, p_uid, 'The root ball comes up with a length of good ' || lower(v_tree.name) || ' on it.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'dig_worms' then
    perform skill_raise(p_world, p_uid, 'digging', 0.2);
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
    perform gather(p_world, p_uid, 'worm', v_n, 20 + random() * 40);
    perform journal_note(p_world, p_uid, 'worms');
    perform tell(p_world, p_uid, 'You turn the dirt over and pick ' || v_n || ' worm'
      || case when v_n > 1 then 's' else '' end || ' out of it.', 'event');

  elsif p_action = 'prospect' then
    v_skill := skill_of(p_world, p_uid, 'prospecting');
    v_rad := prospect_radius(v_skill) + pk(p_world, p_uid, 'further:prospect', 0)::int;
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
        || '. It needs mining ' || to_char(case when v_rock.ore
                                                then greatest(0, v_rock.level - pk(p_world, p_uid, 'ore:below', 0))
                                                else v_rock.level end, 'FM990')
        || ' to work' || case when skill_of(p_world, p_uid, 'mining')
                                   >= case when v_rock.ore
                                           then greatest(0, v_rock.level - pk(p_world, p_uid, 'ore:below', 0))
                                           else v_rock.level end
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
    perform skill_raise(p_world, p_uid, 'prospecting', 1);
  end if;

end $function$
;

-- ---- Walking: a flight is stood on to `steps_most()`, stepped on and off without the step between centres, and taken by no wheel.

CREATE OR REPLACE FUNCTION public.walk_share(p_world uuid, p_uid uuid, p_level integer, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare far double precision; n int; i int; t double precision;
        cart placed; climbing double precision;
        fx int; fy int; tx int; ty int; climb double precision;
        size int; step int := chunk_size()::int;
        k land_chunk; kx int := -999; ky int := -999;
        here double precision; there double precision; spans boolean; walls int[];
        stand double precision; afloat boolean; beast creature;
        there_tile int; here_tile int;
begin
  if p_level <> 0 then return 1; end if;
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return 1; end if;
  select w.size into size from world w where w.id = p_world;
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  -- Asked once for the island rather than once a tile. `bridge_at` is two
  -- index probes and a subquery, and on an island with no bridges on it at all
  -- — which is most of them, most of the time — it was the largest thing left
  -- in this loop once the ground came out of a square.
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  -- The one tile nothing stands on, asked for once. A select per tile against
  -- a table of twenty rows is still a select per tile.
  select coalesce(array_agg(id), '{}') into walls from tile_def where blocks;
  if spans and bridge_at(p_world, fx, fy) is not null then return 1; end if;

  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  -- Asked once. `driving`, `mount_of` and `skill_of` are all STABLE and this
  -- function writes nothing, so the second ask could only ever return what the
  -- first did -- at the price of another index probe apiece, on the one call a
  -- walking browser makes constantly.
  climbing := skill_of(p_world, p_uid, 'climbing');
  climb := max_step() + climbing * climb_per_level();
  /*
   * The steepest tile a body can stand on, before the step between tiles is
   * asked about at all: sixty between a tile's highest corner and its lowest,
   * and climbing raises it at the rate it raises the step. A rider has the
   * mount's legs under them, so the cap is the mount's, raised the way its
   * step is; wheels get the bare sixty; and a hull floats over whatever the
   * bottom does, so afloat there is no cap. A deck is ground: a bridge over a
   * steep tile is not the tile.
   */
  cart := driving(p_world, p_uid);
  afloat := coalesce(is_boat(cart), false);
  beast := mount_of(p_world, p_uid);
  if beast.id is not null then stand := max_stand() + mount_step(beast) - max_step();
  elsif cart.id is not null then stand := max_stand();
  else stand := max_stand() + climbing * climb_per_level();
  end if;
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      if tx < 0 or ty < 0 or tx >= size or ty >= size then return (i - 1)::double precision / n; end if;
      if tx / step <> kx or ty / step <> ky then
        kx := tx / step; ky := ty / step;
        k := land_chunk_get(p_world, kx, ky);
      end if;
      -- A square built from an island with rows missing can be short; the
      -- scanlines are the truth, so fall back to them rather than reading off
      -- the end of a cache.
      if k.tiles is null or length(k.tiles) <= (ty - ky * step) * step + (tx - kx * step) then
        if not passable(p_world, tx, ty) then return (i - 1)::double precision / n; end if;
        there_tile := land_tile(p_world, tx, ty);
      else
        there_tile := get_byte(k.tiles, (ty - ky * step) * step + (tx - kx * step));
        if there_tile = any (walls) then return (i - 1)::double precision / n; end if;
      end if;
      -- A flight of garden steps is climbed, not driven: no wheel takes one.
      if cart.id is not null and not afloat and there_tile = steps_tile() then
        return (i - 1)::double precision / n;
      end if;
      -- And what the tile being left is, the first time it is asked: a flight
      -- carries you on or off it without the step between centres.
      if here_tile is null then
        here_tile := case when fx / step = kx and fy / step = ky and k.tiles is not null
                               and length(k.tiles) > (fy - ky * step) * step + (fx - kx * step)
                          then get_byte(k.tiles, (fy - ky * step) * step + (fx - kx * step))
                          else land_tile(p_world, fx, fy) end;
      end if;
      if not afloat and (not spans or bridge_at(p_world, tx, ty) is null) then
        if k.heights is not null and length(k.heights) >= (step + 1) * (step + 1) * 2 then
          if chunk_slope(k, kx, ky, tx, ty, step) > stand_cap(there_tile, stand) then return (i - 1)::double precision / n; end if;
        elsif tile_slope(p_world, tx, ty) > stand_cap(there_tile, stand) then
          return (i - 1)::double precision / n;
        end if;
      end if;
      if there_tile = steps_tile() or here_tile = steps_tile() then
        null;
      elsif abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and fx / step = kx and fy / step = ky
         and k.heights is not null and length(k.heights) >= (step + 1) * (step + 1) * 2
         and (not spans or bridge_at(p_world, tx, ty) is null) then
        there := chunk_centre(k, kx, ky, tx, ty, step);
        here := chunk_centre(k, kx, ky, fx, fy, step);
        if abs(there - here) > climb then return (i - 1)::double precision / n; end if;
      elsif abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or bridge_at(p_world, tx, ty) is null)
         and abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy)) > climb then
        return (i - 1)::double precision / n;
      end if;
      fx := tx; fy := ty; here_tile := there_tile;
    end if;
  end loop;
  return 1;
end $function$
;

-- ---- A wild thing stands on a flight too, and runs along it.

CREATE OR REPLACE FUNCTION public.creature_tile_ok(p_world uuid, p_x integer, p_y integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select p_x >= 0 and p_y >= 0 and p_x < q.size and p_y < q.size
     and not coalesce(q.blocks, true)
     and (q.a + q.b + q.c + q.d) / 4.0 >= -1
     and greatest(q.a, q.b, q.c, q.d) - least(q.a, q.b, q.c, q.d) <= stand_cap(q.tile, max_stand())
  from (
    select w.size,
           case when p_x >= 0 and p_x < length(t.tiles) then get_byte(t.tiles, p_x) end as tile,
           (select d.blocks from tile_def d
             where d.id = case when p_x >= 0 and p_x < length(t.tiles)
                               then get_byte(t.tiles, p_x) end) as blocks,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c0.heights) then b_i16(c0.heights, p_x) end as a,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c0.heights) then b_i16(c0.heights, p_x + 1) end as b,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c1.heights) then b_i16(c1.heights, p_x + 1) end as c,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c1.heights) then b_i16(c1.heights, p_x) end as d
    from world w
    left join land_tile   t  on t.world_id  = p_world and t.y = p_y
    left join land_corner c0 on c0.world_id = p_world and c0.y = p_y
    left join land_corner c1 on c1.world_id = p_world and c1.y = p_y + 1
    where w.id = p_world) q
$function$
;

CREATE OR REPLACE FUNCTION public.line_clear(p_world uuid, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
declare n int; i int; tx int; ty int; t double precision; size int;
        step int := chunk_size()::int; k land_chunk; kx int := -999; ky int := -999; walls int[];
begin
  select w.size into size from world w where w.id = p_world;
  if size is null then return false; end if;
  select coalesce(array_agg(id), '{}') into walls from tile_def where blocks;
  n := greatest(1, ceil(2 * sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2)))::int);
  for i in 0..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    -- `in_bounds`, which the square below cannot answer: a chunk at the edge is
    -- padded out to its full width, and a padded byte is not ground.
    if tx < 0 or ty < 0 or tx >= size or ty >= size then return false; end if;
    if tx / step <> kx or ty / step <> ky then
      kx := tx / step; ky := ty / step;
      select * into k from land_chunk c where c.world_id = p_world and c.cx = kx and c.cy = ky;
    end if;
    if k.tiles is null or length(k.tiles) <= (ty - ky * step) * step + (tx - kx * step)
       or k.heights is null or length(k.heights) < (step + 1) * (step + 1) * 2 then
      -- No square built here yet, or one built short. The scanlines are the
      -- truth; this only ever reads the square, never makes one, because a
      -- STABLE function may not write and `chase_leg` needs this one STABLE.
      if not creature_tile_ok(p_world, tx, ty) then return false; end if;
    else
      if get_byte(k.tiles, (ty - ky * step) * step + (tx - kx * step)) = any (walls) then return false; end if;
      -- `bool_and` ignored a null and so does this: a corner the island has no
      -- row for makes the comparison null, which is not `true`, so nothing
      -- returns and the walk carries on. That was the old answer too.
      if chunk_centre(k, kx, ky, tx, ty, step) < -1 then return false; end if;
      if chunk_slope(k, kx, ky, tx, ty, step) > stand_cap(get_byte(k.tiles, (ty - ky * step) * step + (tx - kx * step)), max_stand()) then return false; end if;
    end if;
  end loop;
  return true;
end $function$
;

-- ---- And a flight teaches the feet no climbing.

CREATE OR REPLACE FUNCTION public.walk_climbs(p_world uuid, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS double precision[]
 LANGUAGE plpgsql
 STABLE
AS $function$
declare far double precision; n int; i int; t double precision;
        fx int; fy int; tx int; ty int; spans boolean;
        steps double precision[] := '{}';
begin
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return steps; end if;
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      -- And a step on or off a flight of garden steps is no climb.
      if abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or bridge_at(p_world, tx, ty) is null)
         and land_tile(p_world, tx, ty) <> steps_tile() and land_tile(p_world, fx, fy) <> steps_tile() then
        steps := steps || abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy));
      end if;
      fx := tx; fy := ty;
    end if;
  end loop;
  return steps;
end $function$
;

select private.lock_doors();
