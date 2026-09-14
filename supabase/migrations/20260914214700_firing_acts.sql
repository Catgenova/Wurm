-- Charging a furnace, and drawing what is done out of it.

create or replace function firing_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('smelt_ore', 'cast_anvil', 'smelter_take_all',
                      'load_kiln', 'kiln_take_all')
$$;

create or replace function fire_action(p_action text) returns boolean language sql immutable as $$
  select p_action in (
    'build_campfire', 'light_campfire', 'put_out_campfire', 'fuel_campfire',
    'take_ashes_fire', 'take_apart_campfire',
    'place_smelter', 'pick_up_smelter', 'light_smelter', 'fuel_smelter',
    'damp_smelter', 'take_ashes_smelter',
    'place_kiln', 'pick_up_kiln', 'light_kiln', 'fuel_kiln',
    'damp_kiln', 'take_ashes_kiln',
    'place_furniture', 'pick_up_furniture')
$$;

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
      'build_campfire', 'light_campfire', 'put_out_campfire', 'fuel_campfire',
      'take_ashes_fire', 'take_apart_campfire',
      'place_smelter', 'pick_up_smelter', 'light_smelter', 'fuel_smelter',
      'damp_smelter', 'take_ashes_smelter',
      'place_kiln', 'pick_up_kiln', 'light_kiln', 'fuel_kiln',
      'damp_kiln', 'take_ashes_kiln',
      'place_furniture', 'pick_up_furniture')
      or exists (select 1 from recipe where id = p_action)
$$;

create or replace function firing_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql as $$
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

  select * into v_it from item where id = nullif(p_target->>'itemUid', '')::bigint
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
end $$;

create or replace function perform_firing(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
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

  select * into v_it from item where id = nullif(p_target->>'itemUid', '')::bigint;
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
end $$;

select private.lock_doors();
