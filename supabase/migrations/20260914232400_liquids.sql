-- Barrels, buckets, and a well that fills itself.
--
-- ## A well is the fifth thing that will not sit still
--
-- A fire burns down, a crop comes on, a forage bed recovers, a creature walks.
-- A well draws its own water, and it draws it whether or not anybody is
-- standing over it — so it settles like all the others: how much is in it is
-- what was in it when somebody last touched it, plus the seconds since,
-- stopped at the depth it was sunk to. Nothing has to tick.
--
-- A barrel is the other half and the easy half. It holds what is poured into
-- it and loses nothing, so its litres are simply a number on the row.
--
-- ## Two litres tables, because a barrel and a well mean different things by
-- "how much it holds"
--
-- A coopered thing varies with the wood it was built out of: a large oak
-- barrel takes more than a large pine one. A well is a lined shaft in the
-- ground, and the ground does not care what the kerb is made of.

alter table placed add column if not exists litres real not null default 0;
alter table placed add column if not exists liquid text;

create or replace function liquid_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('fill_bucket', 'fill_skin', 'empty_bucket',
                      'empty_vessel', 'drink_from_vessel', 'pour_into_barrel')
$$;

/** A bucket holds five litres, whichever way it is going. */
create or replace function bucket_litres() returns double precision
  language sql immutable as $$ select 5 $$;

/** What a thing standing about is called, once somebody has called it anything. */
create or replace function placed_name(p placed) returns text language sql stable as $$
  select coalesce(p.name, (select f.name from furniture_def f where f.id = p.sub), p.kind)
$$;

/**
 * Litres a vessel holds: a barrel by its build, a well by how deep it was sunk.
 *
 * The browser scales a coopered thing by the wood it was built out of — a
 * large oak barrel takes more than a large pine one. Nothing standing on this
 * island records what it was built of yet, so there is nothing for that
 * multiplier to read, and a barrel holds what its build says. When a placed
 * thing remembers its material this is the one line that changes.
 */
create or replace function liquid_capacity(p placed) returns double precision
  language sql stable as $$
  select case when d.liquid is not null then d.liquid else coalesce(d.well, 0) end
  from furniture_def d where d.id = p.sub
$$;

create or replace function holds_liquid(p placed) returns boolean
  language sql stable as $$ select liquid_capacity(p) > 0 $$;

/** A well draws its own water; a barrel only holds what is poured into it. */
create or replace function is_well(p placed) returns boolean language sql stable as $$
  select coalesce((select well from furniture_def where id = p.sub), 0) > 0
$$;

/**
 * What is in it.
 *
 * A barrel says so on its row, because somebody poured it in. A well never
 * needed telling: it is water, it was always going to be water, and the column
 * only catches up the next time anybody draws from it. Asking through here
 * rather than reading the column is the difference between a bucket that fills
 * and a bucket that comes up holding null.
 */
create or replace function placed_liquid(p placed) returns text language sql stable as $$
  select case when is_well(p) then 'water' else p.liquid end
$$;

/** What a well finds in a second: a better-sunk shaft finds it faster. */
create or replace function well_rate(p_ql double precision) returns double precision
  language sql immutable as $$ select 0.012 + (p_ql / 100) * 0.055 $$;

/**
 * How much is in it now.
 *
 * A barrel: whatever was poured in. A well: that, plus what it has found since
 * somebody last looked, up to the depth it was sunk to.
 */
create or replace function placed_litres(p placed) returns double precision
  language sql stable as $$
  select case when not is_well(p) then p.litres
              else least(liquid_capacity(p),
                         p.litres + well_rate(p.ql) * extract(epoch from (now() - p.since))) end
$$;

/** Write down what a well has found, so that what happens next starts from now. */
create or replace function well_settle(p_id bigint) returns void language plpgsql as $$
declare p placed;
begin
  select * into p from placed where id = p_id for update;
  if not found or not is_well(p) then return; end if;
  update placed set litres = placed_litres(p), liquid = 'water', since = now() where id = p_id;
end $$;

/* ------------------------------------------------------------------ *
 * What is within reach of a pair of hands.
 * ------------------------------------------------------------------ */

/** Open water on the tile you stand on or any of its neighbours. */
create or replace function near_water(p_world uuid, p_uid uuid) returns boolean
  language sql stable as $$
  select exists (
    select 1 from player pl,
      lateral generate_series(floor(pl.x)::int - 1, floor(pl.x)::int + 1) as g(wx),
      lateral generate_series(floor(pl.y)::int - 1, floor(pl.y)::int + 1) as h(wy)
    where pl.world_id = p_world and pl.uid = p_uid
      and in_bounds(p_world, g.wx, h.wy) and has_water(p_world, g.wx, h.wy))
$$;

/** Whether a piece of furniture is close enough to dip into or pour from. */
create or replace function near_piece(p_world uuid, p_uid uuid, p placed,
                                      p_range double precision default 2.4)
  returns boolean language sql stable as $$
  select exists (select 1 from player pl where pl.world_id = p_world and pl.uid = p_uid
    and sqrt((p.cx - pl.x) ^ 2 + (p.cy - pl.y) ^ 2) <= p_range)
$$;

/**
 * Something beside you with a liquid in it, fullest first.
 *
 * A barrel still working is not drawn off — whatever is in it is not ready —
 * but nothing on this island ferments yet, so that question has only one
 * answer here and is left out until brewing arrives.
 */
create or replace function vessels_near(p_world uuid, p_uid uuid, p_kind text default null)
  returns setof placed language sql stable as $$
  select p.* from placed p
  where p.world_id = p_world and p.kind = 'furniture' and holds_liquid(p)
    and placed_litres(p) >= 1
    and (p_kind is null or placed_liquid(p) = p_kind)
    and near_piece(p_world, p_uid, p, 2.6)
  order by placed_litres(p) desc, p.id
$$;

/** Whether there is water at hand at all: a shore, a well, or a barrel of it. */
create or replace function water_near(p_world uuid, p_uid uuid) returns boolean
  language sql stable as $$
  select near_water(p_world, p_uid)
      or exists (select 1 from vessels_near(p_world, p_uid, 'water'))
$$;

/** The emptiest barrel beside you that would take this liquid. */
create or replace function barrel_for(p_world uuid, p_uid uuid, p_kind text) returns placed
  language sql stable as $$
  select p.* from placed p
  where p.world_id = p_world and p.kind = 'furniture'
    and holds_liquid(p) and not is_well(p)
    and (placed_litres(p) <= 0 or placed_liquid(p) = p_kind)
    and placed_litres(p) < liquid_capacity(p)
    and near_piece(p_world, p_uid, p, 2.6)
  order by placed_litres(p), p.id
  limit 1
$$;

/** Take a measure out of something, and leave it empty of anything if it runs dry. */
create or replace function draw_from(p_id bigint, p_litres double precision) returns boolean
  language plpgsql as $$
declare p placed; v_left double precision;
begin
  perform well_settle(p_id);
  select * into p from placed where id = p_id for update;
  if not found or placed_litres(p) < p_litres then return false; end if;
  v_left := placed_litres(p) - p_litres;
  update placed set litres = v_left, since = now(),
      liquid = case when v_left <= 0 and not is_well(p) then null else p.liquid end
    where id = p_id;
  return true;
end $$;

/* ------------------------------------------------------------------ *
 * The doors.
 * ------------------------------------------------------------------ */

create or replace function liquid_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare it item; p placed; v_kind text;
begin
  if p_action in ('fill_bucket', 'fill_skin', 'empty_bucket', 'pour_into_barrel') then
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
      and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
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
end $$;

create or replace function perform_liquid(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare it item; p placed; v_kind text; v_from placed; v_full text; v_room double precision;
        v_poured double precision; v_favour text; v_full_msg text; v_thirst double precision;
begin
  if p_action in ('fill_bucket', 'fill_skin', 'empty_bucket', 'pour_into_barrel') then
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
      and holder = 'player' and holder_uid = p_uid;
    if not found then return; end if;
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
    if not consume(p_world, p_uid, 'bucket', 1, it.id) then return; end if;
    perform give(p_world, p_uid, v_full, 1, it.ql);
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
    if not consume(p_world, p_uid, it.def, 1, it.id) then return; end if;
    perform give(p_world, p_uid, v_full, 1, it.ql);
    perform tell(p_world, p_uid, 'You tip the '
      || lower((select name from item_def where id = it.def)) || ' out.', 'event');

  elsif p_action = 'pour_into_barrel' then
    select liquid into v_kind from vessel_def where item = it.def;
    v_from := barrel_for(p_world, p_uid, v_kind);
    if v_from.id is null then return; end if;
    v_room := liquid_capacity(v_from) - placed_litres(v_from);
    v_poured := least(bucket_litres(), v_room);
    if v_poured <= 0 then return; end if;
    if not consume(p_world, p_uid, it.def, 1, it.id) then return; end if;
    update placed set litres = placed_litres(v_from) + v_poured, liquid = v_kind, since = now()
      where id = v_from.id;
    perform give(p_world, p_uid, (select empty from vessel_def where item = it.def), 1, it.ql);
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
      'empty_vessel', 'drink_from_vessel', 'pour_into_barrel')
      or exists (select 1 from recipe where id = p_action)
$$;


select private.lock_doors();
