-- The oven, the lantern, and the anvil.
--
-- ## A candle is the sixth thing that will not sit still, and the fussiest
--
-- A fire burns whether anybody is there or not. A crop grows, a well fills, a
-- creature walks. A candle is the first of them that burns *conditionally* —
-- only while the lantern is lit, and a dark lantern in your pack costs you
-- nothing but the weight of it. So it cannot settle from one timestamp: it
-- needs two, `lit` and `lit_at`, and the arithmetic is "what was left, less
-- the seconds since it was struck, but only if it is still burning".
--
-- ## An oven is a fire with a roof on it
--
-- Which is why it needed almost nothing: `placed` already carries fuel, ash,
-- lit and a clock, and the settling is the same settling. What an oven has
-- that a campfire has not is a firebox that takes two hours rather than ten
-- minutes, and a `hearth` flag on its definition that was generated months
-- ago and has never been read by anything down here until now.

/** Whether a lantern is burning, and when it was struck. */
alter table item add column if not exists lit boolean not null default false;
alter table item add column if not exists lit_at timestamptz;

create or replace function forge_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven',
                      'candle_lantern', 'light_lantern', 'douse_lantern',
                      'place_anvil', 'pick_up_anvil', 'smith')
$$;

/* ------------------------------------------------------------------ *
 * The oven.
 * ------------------------------------------------------------------ */

/** Two hours of firebox, against a campfire's ten minutes. */
create or replace function oven_capacity() returns double precision
  language sql immutable as $$ select 7200 $$;

create or replace function is_oven(p placed) returns boolean language sql stable as $$
  select p.kind = 'furniture'
     and coalesce((select hearth from furniture_def where id = p.sub), false)
$$;

/** How long it will burn, in whichever unit reads best. */
create or replace function oven_burns_for(p_fuel double precision) returns text
  language sql immutable as $$
  select case when round(p_fuel / 60) >= 60 then to_char(p_fuel / 3600, 'FM990.0') || ' hours'
              when round(p_fuel / 60) >= 1 then to_char(round(p_fuel / 60), 'FM990') || ' minutes'
              else to_char(round(p_fuel), 'FM990') || ' seconds' end
$$;

/* ------------------------------------------------------------------ *
 * The lantern.
 * ------------------------------------------------------------------ */

/** Twenty-two minutes of candle, a little more in a well-made lantern. */
create or replace function candle_burn(p_ql double precision) returns double precision
  language sql immutable as $$ select 22 * 60 * (0.7 + least(100, greatest(1, p_ql)) / 160) $$;

/** How far it throws, in tiles: five at the roughest, nine at the best. */
create or replace function lantern_reach(p_ql double precision) returns int
  language sql immutable as $$ select 5 + round(least(100, greatest(1, p_ql)) / 25)::int $$;

/**
 * Seconds of candle left.
 *
 * The charges on the row are what was left when it was last struck or pinched
 * out. A lit lantern has been burning since `lit_at` and the answer is that
 * much less; a dark one is exactly what it says.
 */
create or replace function candle_left(it item) returns double precision
  language sql stable as $$
  select greatest(0, case when it.lit and it.lit_at is not null
                          then coalesce(it.charges, 0) - extract(epoch from (now() - it.lit_at))
                          else coalesce(it.charges, 0) end)
$$;

/** Write down what has burnt, so that whatever happens next starts from now. */
create or replace function lantern_settle(p_item bigint) returns void language plpgsql as $$
declare it item; v_left double precision;
begin
  select * into it from item where id = p_item for update;
  if not found or it.def <> 'lantern' then return; end if;
  v_left := candle_left(it);
  update item set charges = round(v_left)::int,
      lit = (it.lit and v_left > 0),
      lit_at = case when it.lit and v_left > 0 then now() end
    where id = p_item;
end $$;

/** How it reads: dark, lit with so long left, or empty. */
create or replace function lantern_state(it item) returns text language sql stable as $$
  select case when candle_left(it) <= 0 then 'no candle in it'
              when it.lit then 'lit, ' || ceil(candle_left(it) / 60) || 'm of candle left'
              else ceil(candle_left(it) / 60) || 'm of candle in it, unlit' end
$$;

/* ------------------------------------------------------------------ *
 * The anvil, and what is beaten out on it.
 * ------------------------------------------------------------------ */

/** An anvil covers two subtiles each way: four in all. */
create or replace function anvil_subtiles() returns int language sql immutable as $$ select 2 $$;

create or replace function anvil_name(p placed) returns text language sql stable as $$
  select coalesce((select name from metal_def where id = p.sub), 'Iron') || ' anvil'
$$;

/** What a thing is worth to work with: its quality, and how hard its stuff is. */
create or replace function working_ql(p_ql double precision, p_extra text) returns double precision
  language sql stable as $$ select least(100, p_ql * (mat_of(p_extra)).bite) $$;

/** What the anvil is worth to beat on. */
create or replace function anvil_ql(p placed) returns double precision language sql stable as $$
  select working_ql(p.ql, (select name from metal_def where id = p.sub))
$$;

/** Every filling wears the mould, and no mould can be mended. */
create or replace function mould_wear(p_ql double precision) returns double precision
  language sql immutable as $$ select greatest(3, 26 - p_ql * 0.22) $$;

create or replace function mould_uses_left(p_ql double precision, p_dmg double precision) returns int
  language sql immutable as $$ select greatest(0, ceil((100 - p_dmg) / mould_wear(p_ql))::int) $$;

/** What mind logic lends to a hard piece of work. */
create or replace function mind_ease(p_world uuid, p_uid uuid) returns double precision
  language sql stable as $$
  select greatest(0, (skill_of(p_world, p_uid, 'mind_logic') - 20) * 0.2)
$$;

/** How good a piece comes out: the smith, the mould, the metal and the anvil all have a say. */
create or replace function smith_ql(p_world uuid, p_uid uuid, p_skill text,
    p_mould_ql double precision, p_lump_ql double precision, p_anvil_ql double precision)
  returns double precision language sql stable as $$
  select greatest(1, least(100,
    (product_ql(skill_of(p_world, p_uid, p_skill)) + p_mould_ql + p_lump_ql + p_anvil_ql) / 4
    + skill_of(p_world, p_uid, p_skill) / 25))
$$;

/** The lump the smith means to pour: the one they chose, or the first that will do. */
create or replace function smith_lump(p_world uuid, p_uid uuid, p_uid_item bigint) returns item
  language sql stable as $$
  select i.* from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    and not i.locked and exists (select 1 from metal_def m where m.lump = i.def)
  order by (i.id = p_uid_item) desc, i.id
  limit 1
$$;

/** Whether an anvil's four subtiles are free of everything else standing about. */
create or replace function anvil_place_reason(p_world uuid, p_x int, p_y int, p_sx int, p_sy int)
  returns text language plpgsql stable as $$
begin
  if not in_bounds(p_world, p_x, p_y) then return 'That is off the edge of the world.'; end if;
  if has_water(p_world, p_x, p_y) then return 'Not in the water.'; end if;
  if exists (select 1 from placed pl where pl.world_id = p_world and pl.x = p_x and pl.y = p_y
               and pl.sx < p_sx + anvil_subtiles() and pl.sx + (placed_size(pl.kind, pl.sub))[1] > p_sx
               and pl.sy < p_sy + anvil_subtiles() and pl.sy + (placed_size(pl.kind, pl.sub))[2] > p_sy) then
    return 'Something is already standing there.';
  end if;
  return null;
end $$;

/* ------------------------------------------------------------------ *
 * The doors.
 * ------------------------------------------------------------------ */

create or replace function forge_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare p placed; it item; v_mould item; d mould_def; v_lump item;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found or not is_oven(p) then return 'That is not an oven.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to the oven.'; end if;
    if p_action = 'fuel_oven' then
      select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and not locked and fuel_value(def) is not null
        and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
        order by id limit 1;
      if not found then return 'Ovens take the same wood and coal a fire does.'; end if;
      if placed_fuel(p) >= oven_capacity() then return 'The firebox is packed as full as it will take.'; end if;
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
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
      and holder = 'player' and holder_uid = p_uid;
    if not found or it.def <> 'lantern' then return 'It is gone.'; end if;
    if p_action = 'candle_lantern' then
      if candle_left(it) > 0 then return 'There is still a candle in it.'; end if;
      if pack_count(p_world, p_uid, 'candle') < 1 then
        return 'You have no candles. Two are drawn from two beeswax and a yarn.';
      end if;
    elsif p_action = 'light_lantern' then
      if candle_left(it) <= 0 then return 'There is no candle in it.'; end if;
      /*
       * The browser asks for a tinderbox, and there is no tinderbox in the
       * game — not in `ITEM_DEFS`, not in any recipe, nowhere but this check
       * and the help text that promises it. So a lantern cannot be struck
       * there either, and it cannot be struck here. Ported as written and
       * named out loud rather than quietly fixed: a port that improves on the
       * thing it is porting is a port nobody can check against it.
       */
      if pack_count(p_world, p_uid, 'tinderbox') < 1 then
        return 'You need a tinderbox to strike a light.';
      end if;
      if it.lit then return 'It is already lit.'; end if;
    elsif p_action = 'douse_lantern' then
      if not it.lit then return 'It is not lit.'; end if;
    end if;
    return null;
  end if;

  if p_action = 'place_anvil' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'anvil' and not locked
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
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
  v_lump := smith_lump(p_world, p_uid, nullif(p_target->>'uid', '')::bigint);
  if v_lump.id is null then return 'You have no metal to pour.'; end if;
  if v_lump.count < d.lumps then return 'That takes ' || d.lumps || ' lumps.'; end if;
  return null;
end $$;

create or replace function perform_forge(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
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
        and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
        order by id limit 1;
      if not found then return; end if;
      v_per := fuel_value(it.def);
      v_room := greatest(0, oven_capacity() - p.fuel);
      v_fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                                  ceil(v_room / v_per)::int));
      if not consume(p_world, p_uid, it.def, v_fits, it.id) then return; end if;
      update placed set fuel = least(oven_capacity(), p.fuel + v_per * v_fits), since = now()
        where id = p.id;
      perform tell(p_world, p_uid, 'You feed '
        || case when v_fits > 1 then v_fits || ' × ' else 'a ' end
        || lower((select name from item_def where id = it.def)) || ' into the oven. '
        || oven_burns_for(least(oven_capacity(), p.fuel + v_per * v_fits)) || ' of fuel.', 'event');

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
    perform lantern_settle((p_target->>'uid')::bigint);
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint;
    if not found then return; end if;
    if p_action = 'candle_lantern' then
      if not consume(p_world, p_uid, 'candle', 1) then return; end if;
      update item set charges = round(candle_burn(it.ql))::int, lit = false, lit_at = null
        where id = it.id;
      perform tell(p_world, p_uid, 'You set a candle in the lantern. '
        || ceil(candle_burn(it.ql) / 60) || ' minutes of it, at a guess.', 'event');
    elsif p_action = 'light_lantern' then
      update item set lit = true, lit_at = now() where id = it.id;
      perform tell(p_world, p_uid, 'The wick catches and the lantern throws its light '
        || lantern_reach(it.ql) || ' tiles.', 'event');
    else
      v_left := candle_left(it);
      update item set lit = false, lit_at = null, charges = round(v_left)::int where id = it.id;
      perform tell(p_world, p_uid, 'You pinch the wick out. '
        || ceil(v_left / 60) || ' minutes of candle saved.', 'event');
    end if;
    return;
  end if;

  if p_action = 'place_anvil' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'anvil' and not locked
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
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
  v_lump := smith_lump(p_world, p_uid, nullif(p_target->>'uid', '')::bigint);
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
    v_gained := skill_raise(p_world, p_uid, d.skill, 0.25);
    perform tell(p_world, p_uid, 'The '
      || lower((select name from item_def where id = d.makes))
      || ' comes out misshapen and you throw the metal back.'
      || case when v_broke then ' The ' || lower((select name from item_def where id = v_mould.def))
                                || ' cracks through.' else '' end, 'event');
    return;
  end if;

  v_ql := smith_ql(p_world, p_uid, d.skill, v_mould_ql, v_lump.ql, anvil_ql(p));
  v_gained := skill_raise(p_world, p_uid, d.skill, 0.5);
  v_rare := rarity_roll();
  v_made := give(p_world, p_uid, d.makes, d.per, v_ql, m.name, v_rare);
  if v_rare is not null then perform tell(p_world, p_uid, rarity_word(v_rare), 'skill'); end if;
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
end $$;

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
      'examine_creature', 'tame', 'feed', 'groom', 'shear', 'milk_creature',
      'set_stance', 'rename_creature', 'take_creature', 'store_creature', 'release_creature',
      'assign_deed',
      'place_crate', 'pick_up_crate', 'crate_take_all', 'store_in_crate',
      'equip', 'unequip', 'attack_creature', 'shoot_creature', 'butcher',
      'bind_wound', 'clean_wound', 'treat_creature',
      'smelt_ore', 'cast_anvil', 'smelter_take_all', 'load_kiln', 'kiln_take_all',
      'improve_item', 'repair_item', 'eat', 'drink', 'drink_skin',
      'build_campfire', 'light_campfire', 'put_out_campfire', 'fuel_campfire',
      'take_ashes_fire', 'take_apart_campfire',
      'place_smelter', 'pick_up_smelter', 'light_smelter', 'fuel_smelter',
      'damp_smelter', 'take_ashes_smelter',
      'place_kiln', 'pick_up_kiln', 'light_kiln', 'fuel_kiln',
      'damp_kiln', 'take_ashes_kiln',
      'place_furniture', 'pick_up_furniture',
      'pick_up', 'pick_up_all', 'drop', 'examine', 'examine_item',
      'lock_item', 'unlock_item', 'name_thing',
      'flatten', 'drop_dirt', 'pave_slabs', 'remove_paving',
      'cut_grass', 'cut_reeds', 'pick_fruit', 'pick_sprout',
      'plant', 'dig_worms', 'prospect',
      'fill_bucket', 'fill_skin', 'empty_bucket',
      'empty_vessel', 'drink_from_vessel', 'pour_into_barrel',
      'fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven',
      'candle_lantern', 'light_lantern', 'douse_lantern',
      'place_anvil', 'pick_up_anvil', 'smith')
      or exists (select 1 from recipe where id = p_action)
$$;



select private.lock_doors();
