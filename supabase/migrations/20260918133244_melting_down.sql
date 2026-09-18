-- Melting down: what the fire gives back
--
-- Asked from the island. A cast that came out wrong, a head worn to nothing,
-- a tool you have no more use for: the metal in it was gone for good. Now it
-- goes back into the smelter and comes out as lumps of its own metal, off
-- the one table both sides read (`melt_def`: the lumps a thing was cast
-- from, a piece at a time for a gang mould, a hafted tool holding its head's)
-- and three numbers beside it — half the metal comes back (`melt_share`), at
-- seven tenths of the quality less the damage it carried (`melt_keep`), in
-- half the heat an ore charge takes (`melt_heat`). A ruined cast is a setback
-- rather than a total loss.
--
-- `melt_down` joins the firing family beside `smelt_ore`: the same pack item
-- named off the menu, the same jobs in the furnace, the same lumps drawn out
-- when they are done. A thing put by is refused, and a thing not made of
-- metal, each in the words the browser uses.

/** The metal a thing is made of, off what it was cast from: the name the browser writes in `extra`. */
create or replace function metal_by_name(p_name text) returns metal_def language sql stable as $fn$
  select m.* from metal_def m where p_name is not null and lower(m.name) = lower(p_name) limit 1
$fn$;

/** Lumps that come back from this many of a thing: half its metal, and never none. */
create or replace function melt_lumps(p_item text, p_count int) returns int language sql stable as $fn$
  select greatest(1, round(coalesce((select content from melt_def where item = p_item), 0) * p_count * melt_share())::int)
$fn$;

/** The quality of what comes back: seven tenths, less the damage the thing carried. */
create or replace function melt_ql(p_ql double precision, p_dmg double precision) returns double precision
  language sql immutable as $fn$
  select greatest(1, p_ql * melt_keep() * (1 - p_dmg / 100))
$fn$;

CREATE OR REPLACE FUNCTION public.firing_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('smelt_ore', 'melt_down', 'cast_anvil', 'smelter_take_all',
                      'load_kiln', 'kiln_take_all')
$function$
;

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
    -- A charge is twenty kilograms of ore, which is `ore_per_lump` of them.
    if v_it.count < ore_per_lump() then
      return 'A charge is ' || ore_per_lump()::int || ' ore; you have ' || v_it.count || '.';
    end if;
    if jsonb_array_length(furnace_jobs(v_p)) >= furnace_capacity('smelter') then
      return 'The furnace is charged as full as it will go.';
    end if;
    return null;

  elsif p_action = 'melt_down' then
    -- Scrap goes back into the fire: anything cast from metal, or hafted to a
    -- cast head, in the words the browser uses.
    if not found then return 'Choose something to melt down.'; end if;
    if v_it.locked then return 'It is put by. Unlock it first.'; end if;
    v_metal := metal_by_name(v_it.extra);
    if v_metal.id is null or not exists (select 1 from melt_def where item = v_it.def) then
      return 'That is not made of metal the fire would give back.';
    end if;
    if jsonb_array_length(furnace_jobs(v_p))
       + melt_lumps(v_it.def, least(greatest(1, coalesce((p_target->>'count')::int, 1)), v_it.count))
       > furnace_capacity('smelter') then
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
    v_need := mould_lumps('anvil_mould', v_metal.id);
    if v_it.count < v_need then
      return 'An anvil takes ' || v_need || ' lumps of ' || lower(v_metal.name) || '.';
    end if;
    return null;
  end if;
  return null;
end $function$
;

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
    /*
     * Charges, not ore. One charge is `ore_per_lump` of it and comes out as one
     * lump, so "all" of a stack of fifty-seven is five charges with seven left
     * over rather than fifty-seven lumps.
     */
    v_n := least(greatest(1, floor(coalesce((p_target->>'count')::int, 1) / ore_per_lump())::int),
                 floor(v_it.count / ore_per_lump())::int,
                 furnace_capacity('smelter') - jsonb_array_length(v_jobs));
    if v_n < 1 then return; end if;
    if not consume(p_world, p_uid, v_it.def, v_n * ore_per_lump()::int, v_it.id) then return; end if;
    v_secs := smelt_seconds(v_metal.id, v_it.ql, v_p.ql);
    for v_i in 1..v_n loop
      v_jobs := v_jobs || jsonb_build_object('makes', v_metal.lump, 'left', v_secs,
        'total', v_secs, 'ql', v_it.ql);
    end loop;
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You charge the smelter with '
      || (v_n * ore_per_lump()::int) || ' × '
      || lower((select name from item_def where id = v_it.def))
      || case when v_n > 1 then ', ' || v_n || ' charges of it' else '' end
      || '. Each charge is about ' || round(v_secs) || ' seconds of heat and comes out as one lump.', 'event');

  elsif p_action = 'melt_down' then
    v_metal := metal_by_name(v_it.extra);
    if v_metal.id is null or not exists (select 1 from melt_def where item = v_it.def) then return; end if;
    v_n := least(greatest(1, coalesce((p_target->>'count')::int, 1)), v_it.count);
    v_need := melt_lumps(v_it.def, v_n);
    if jsonb_array_length(v_jobs) + v_need > furnace_capacity('smelter') then return; end if;
    v_ql := melt_ql(v_it.ql, v_it.dmg);
    -- Scrap is quicker than ore: it has been through the fire once already.
    v_secs := smelt_seconds(v_metal.id, v_it.ql, v_p.ql) * melt_heat();
    if not consume(p_world, p_uid, v_it.def, v_n, v_it.id) then return; end if;
    for v_i in 1..v_need loop
      v_jobs := v_jobs || jsonb_build_object('makes', v_metal.lump, 'left', v_secs, 'total', v_secs, 'ql', v_ql);
    end loop;
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You put ' || case when v_n > 1 then v_n || ' × ' else 'the ' end
      || lower((select name from item_def where id = v_it.def)) || ' into the smelter to melt down.'
      || ' It will come back as ' || v_need || ' ' || lower(v_metal.name) || ' lump'
      || case when v_need > 1 then 's' else '' end || ', at about ' || round(v_ql) || ' quality.', 'event');

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
    v_need := mould_lumps('anvil_mould', v_metal.id);
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
end $function$
;

select private.lock_doors();
