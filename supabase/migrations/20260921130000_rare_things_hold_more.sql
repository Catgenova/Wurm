-- Rare things hold more
--
-- Asked for: *"all containers, smelters, kilns etc can roll rare. each level
-- of rarity increases maximum capacity by an additional +5%."*
--
-- A rare chest is a chest somebody got right: the boards sit closer, the lid
-- shuts true, and there is more room inside it than it has any business
-- having. A twentieth more per step, and it reaches everything with a limit on
-- what goes into it -- a bag, a crate, a cupboard, a weight bin, the charge a
-- smelter takes and the load a kiln fires.
--
-- Never less than one more unit a step, which is why this is a function and
-- not a multiplier. A twentieth of a small container rounds to nothing: a kiln
-- holds sixteen, and both a tenth and three twentieths of sixteen round to
-- eighteen, so supreme and fantastic would have been the same kiln. `room_for`
-- is the browser's `roomFor` line for line, floor and all, because the browser
-- draws the number and this side enforces it and a unit of daylight between
-- them is somebody told a crate is full when the window says it is not.
--
--   A crate keeps its rarity now
--
-- `place_crate` was the same fault `placed` had: it copied the wood off the
-- item it consumed and dropped the rarity, so a rare crate stopped being rare
-- the moment it stood on the ground. One column and two lines. `crates_near`
-- hands the browser `to_jsonb(c)` less two names, so it crosses for nothing.
--
--   And the wood, on furniture, at last
--
-- `furniture_capacity` has never multiplied by the wood where the browser
-- does, and a migration a day ago left it alone on purpose: *"changing it
-- would change what every chest, cupboard, cart and boat on a live island
-- holds. That is a decision, not a fix."* That was right then and is wrong
-- now, because it was only true while `placed.material` was always null --
-- `place_furniture` never wrote it. Yesterday's migration started writing it,
-- so from here the browser would say one number and this side enforce another.
--
-- Adding the wood changes nothing standing today: every furniture row on a
-- live island has `material = null`, `mat_of(null).hold` coalesces to 1, and
-- the answer is the one it was. Only pieces set down from now on differ, and
-- those are the ones the browser is already drawing with the wood in them.
--
--   And the view
--
-- `container` read `furniture_def.capacity` and `item_def.holds` straight off
-- the definitions rather than through the two functions, so it would have been
-- the one place on the island that had never heard of any of this. It asks the
-- functions now.

alter table crate add column if not exists rare text;

/** A twentieth per step of rarity, which is what a rare container is worth. */
create or replace function rarity_room() returns double precision
  language sql immutable as $fn$ select 0.05 $fn$;

/**
 * What a container holds, given what a plain one of it holds.
 *
 * The base is rounded first and the bonus added to that, and the bonus is
 * never less than one unit a step -- the browser's `roomFor`, exactly.
 */
create or replace function room_for(p_base double precision, p_rare text) returns int
  language sql stable as $fn$
  select case when step = 0 then plain
              else plain + greatest(step, round(plain * rarity_room() * step)::int) end
  from (select round(coalesce(p_base, 0))::int as plain,
               coalesce((select ord from rarity_def where id = p_rare), 0) as step) a
$fn$;

/** How many a bag takes, the kind of thing it is deciding the plain answer. */
create or replace function bag_room(b item) returns int language sql stable as $fn$
  select room_for((select holds from item_def where id = b.def), b.rare)
$fn$;


create or replace function crate_capacity(c crate) returns int language sql stable as $$
  select room_for((select capacity from crate_def where kind = c.kind)
    * coalesce((mat_of(c.material)).hold, 1), c.rare)
$$;

create or replace function furniture_capacity(p placed) returns int language sql stable as $$
  select room_for(coalesce((select coalesce(capacity, hive, 0) from furniture_def where id = p.sub), 0)
    * coalesce((mat_of(p.material)).hold, 1), p.rare)
$$;

create or replace function furniture_heft(p placed) returns double precision
language sql stable as $fn$
  select room_for(coalesce((select heft from furniture_def where id = p.sub), 0)
    * coalesce((mat_of(p.material)).hold, 1), p.rare)::double precision
$fn$;

/** How much work this furnace will take in at once: its sort, and its rarity. */
create or replace function furnace_capacity(p placed) returns int language sql stable as $fn$
  select room_for(furnace_capacity(p.kind), p.rare)
$fn$;


create or replace function bag_refuses(p_bag item, p_def text, p_count int) returns text
  language sql stable as $$
  select case
    when not is_bag(p_bag.def) then 'A ' || lower((select name from item_def where id = p_bag.def))
      || ' does not hold things.'
    when is_bag(p_def) then 'One bag will not go inside another.'
    when bag_units(p_bag.id) + p_count > bag_room(p_bag) then
      'The ' || lower((select name from item_def where id = p_bag.def)) || ' is full.'
    end
$$;

create or replace function bag_spare(b item) returns int
  language sql stable as $fn$
  select greatest(0, bag_room(b) - bag_units(b.id))
$fn$;

create or replace view container with (security_invoker = true) as
  select 'crate'::text as kind, c.world_id, c.id::bigint as id, coalesce(c.name, crate_name(c)) as name,
         c.x, c.y, null::uuid as holder_uid, crate_units(c.world_id, c.id) as units, crate_capacity(c) as capacity
    from crate c
  union all
  select 'furniture', p.world_id, p.id, coalesce(p.name, f.name), p.x, p.y, null::uuid,
         (select coalesce(sum(i.count), 0)::int from item i where i.holder = 'furniture' and i.placed = p.id),
         furniture_capacity(p)
    from placed p join furniture_def f on f.id = p.sub
    where p.kind = 'furniture' and f.capacity > 0
  union all
  select 'bag', b.world_id, b.id, d.name, b.gx, b.gy, b.holder_uid, bag_units(b.id), bag_room(b)
    from item b join item_def d on d.id = b.def
    where d.holds > 0;
grant select on container to anon, authenticated;

/*
 * And the three names, which say the rarity now because the browser's do.
 *
 * A name you gave a thing wins outright, as it always has; failing that it is
 * said the way the pack says it -- the word for what it is, the wood or the
 * metal it was made of, and rare, supreme or fantastic in front of the lot.
 * The browser started doing that when a piece began keeping its rarity, and a
 * log line from the island calling the same chest by a plainer name than the
 * window beside it is the kind of small lie that makes people distrust both.
 */
create or replace function rare_said(p_rare text, p_plain text) returns text
  language sql immutable as $fn$
  select case when p_rare is null or p_plain is null then p_plain
              else initcap(p_rare) || ' ' || lower(p_plain) end
$fn$;

create or replace function crate_name(c crate) returns text language sql stable as $$
  select coalesce(c.name, rare_said(c.rare,
    case when c.deed then 'Deed crate (' || lower(d.name) || ')' else d.name end
    || case when c.material is null then '' else ' (' || lower(c.material) || ')' end))
  from crate_def d where d.kind = c.kind
$$;

create or replace function placed_name(p placed) returns text language sql stable as $$
  select coalesce(p.name, rare_said(p.rare,
    coalesce((select f.name from furniture_def f where f.id = p.sub)
      || case when p.material is null then '' else ' (' || lower(p.material) || ')' end, p.kind)))
$$;

create or replace function anvil_name(p placed) returns text language sql stable as $$
  select rare_said(p.rare, coalesce((select name from metal_def where id = p.sub), 'Iron') || ' anvil')
$$;

CREATE OR REPLACE FUNCTION public.firing_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_p placed; v_it item; v_mould item; v_metal metal_def; v_need int; d mould_def;
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
    if jsonb_array_length(furnace_jobs(v_p)) >= furnace_capacity(v_p) then
      return 'The furnace is charged as full as it will go.';
    end if;
    return null;

  elsif p_action = 'melt_down' then
    -- Scrap goes back into the fire: anything cast from metal, or hafted to a
    -- cast head, in the words the browser uses.
    if not found then return 'Choose something to melt down.'; end if;
    if v_it.locked then return 'It is put by. Unlock it first.'; end if;
    v_metal := metal_by_name(v_it.extra);
    if v_metal.id is null or item_metal(v_it) is null then
      return 'That is not made of metal the fire would give back.';
    end if;
    if jsonb_array_length(furnace_jobs(v_p))
       + melt_lumps(v_it, least(greatest(1, coalesce((p_target->>'count')::int, 1)), v_it.count))
       > furnace_capacity(v_p) then
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
    if jsonb_array_length(furnace_jobs(v_p)) >= furnace_capacity(v_p) then
      return 'The kiln is packed as full as it will go.';
    end if;
    return null;

  elsif p_action = 'pour_mould' then
    -- Every mould but the anvil's is filled here and cools into a casting for
    -- the anvil, in the words the browser uses.
    select * into v_mould from item where world_id = p_world and id = target_mould(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if v_mould.id is null then return 'Choose a mould.'; end if;
    select * into d from mould_def where id = v_mould.def;
    if d.id is null then return 'Choose a mould.'; end if;
    if d.makes = 'anvil' then return 'An anvil is cast whole: pour it with Cast an anvil.'; end if;
    v_metal := metal_by_lump(v_it.def);
    if v_it.id is null or v_metal.id is null then return 'You have no metal to pour.'; end if;
    v_need := mould_lumps(d.id, v_metal.id);
    if v_it.count < v_need then return 'That takes ' || v_need || ' lumps.'; end if;
    if jsonb_array_length(furnace_jobs(v_p)) >= furnace_capacity(v_p) then
      return 'The furnace is charged as full as it will go.';
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
        d mould_def; v_mould_ql double precision; v_wear double precision; v_broke boolean;
begin
  v_p := target_placed(p_world, p_target);
  if v_p.id is null then return; end if;

  if p_action in ('smelter_take_all', 'kiln_take_all') then
    v_out := furnace_output(v_p);
    for v_one in select * from jsonb_array_elements(v_out) loop
      perform give(p_world, p_uid, v_one->>'def', (v_one->>'count')::int,
        (v_one->>'ql')::double precision, v_one->>'extra', null, null, v_one->>'piece');
      v_names := v_names || ((case when (v_one->>'count')::int > 1 then (v_one->>'count') || ' × ' else '' end)
        || made_name(v_one->>'def', v_one->>'piece'));
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
                 furnace_capacity(v_p) - jsonb_array_length(v_jobs));
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
    if v_metal.id is null or item_metal(v_it) is null then return; end if;
    v_n := least(greatest(1, coalesce((p_target->>'count')::int, 1)), v_it.count);
    v_need := melt_lumps(v_it, v_n);
    if jsonb_array_length(v_jobs) + v_need > furnace_capacity(v_p) then return; end if;
    v_ql := melt_ql(v_it.ql, v_it.dmg);
    -- Scrap is quicker than ore: it has been through the fire once already.
    v_secs := smelt_seconds(v_metal.id, v_it.ql, v_p.ql) * melt_heat();
    if not consume(p_world, p_uid, v_it.def, v_n, v_it.id) then return; end if;
    for v_i in 1..v_need loop
      v_jobs := v_jobs || jsonb_build_object('makes', v_metal.lump, 'left', v_secs, 'total', v_secs, 'ql', v_ql);
    end loop;
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You put ' || case when v_n > 1 then v_n || ' × ' else 'the ' end
      || made_name(v_it.def, v_it.piece) || ' into the smelter to melt down.'
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
      furnace_capacity(v_p) - jsonb_array_length(v_jobs)));
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

  elsif p_action = 'pour_mould' then
    select * into v_mould from item where world_id = p_world and id = target_mould(p_target)
      and holder = 'player' and holder_uid = p_uid;
    select * into d from mould_def where id = v_mould.def;
    v_metal := metal_by_lump(v_it.def);
    if v_mould.id is null or d.id is null or d.makes = 'anvil' or v_metal.id is null then return; end if;
    v_need := mould_lumps(d.id, v_metal.id);
    if v_it.count < v_need or jsonb_array_length(v_jobs) >= furnace_capacity(v_p) then return; end if;
    if not consume(p_world, p_uid, v_it.def, v_need, v_it.id) then return; end if;
    -- Every filling wears the mould, and a hard metal takes more out of it;
    -- no mould can be mended.
    v_mould_ql := greatest(1, v_mould.ql - v_mould.dmg / 2);
    v_wear := mould_wear(v_mould.ql) * (1 + (mat_of(v_metal.name)).difficulty / 30);
    v_broke := v_mould.dmg + v_wear >= 100;
    if v_broke then
      delete from item where id = v_mould.id;
    else
      update item set dmg = least(100, v_mould.dmg + v_wear) where id = v_mould.id;
    end if;
    -- The pour is the smelter's work: the metal, the mould and the hands at the furnace.
    v_ql := greatest(1, least(100, (v_it.ql + v_mould_ql
      + product_ql(skill_of(p_world, p_uid, 'smelting'))) / 3));
    v_secs := pour_seconds(d.id, v_metal.id, v_ql);
    -- A bell or a statue is a casting already and wants no anvil; everything
    -- else comes out as a casting of the piece, for the anvil to beat true.
    v_jobs := v_jobs || case when right(d.makes, 8) = '_casting'
      then jsonb_build_object('makes', d.makes, 'left', v_secs, 'total', v_secs, 'ql', v_ql,
                              'extra', v_metal.name)
      else jsonb_build_object('makes', 'casting', 'left', v_secs, 'total', v_secs, 'ql', v_ql,
                              'extra', v_metal.name, 'piece', d.makes) end;
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You pour '
      || case when v_need > 1 then v_need || ' lumps' else 'a lump' end
      || ' of ' || lower(v_metal.name) || ' into the ' || lower(d.name)
      || '. It needs about ' || round(v_secs) || ' seconds to cool.'
      || case when v_broke then ' The mould cracks through and is done.'
              else ' The mould has ' || mould_uses_left(v_mould.ql, v_mould.dmg + v_wear)
                   || ' fillings left.' end, 'event');
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.perform_crate(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_p player; v_it item; v_c crate; v_tx int; v_ty int; v_sx int; v_sy int; v_new_id int;
        v_want int; v_fit int; v_names text[] := '{}'; v_r record; v_kind text;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    select * into v_it from item where id = target_item(p_target);
    v_kind := crate_kind_of_item(v_it.def);
    if v_kind is null or not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    select coalesce(max(id), 0) + 1 into v_new_id from crate where world_id = p_world;
    -- The wood was already coming across; the rarity was not, so a rare crate
    -- stopped being rare the moment it stood on the ground -- and a rare crate
    -- is the one that holds more.
    insert into crate (world_id, id, kind, x, y, sx, sy, material, made_by, rare)
    values (p_world, v_new_id, v_kind, v_tx, v_ty, v_sx, v_sy, v_it.extra, p_uid, v_it.rare);
    select * into v_c from crate where world_id = p_world and id = v_new_id;
    perform journal_note(p_world, p_uid, 'crate');
    perform tell(p_world, p_uid, 'You set the ' || lower(crate_name(v_c)) || ' down.', 'event');

  elsif p_action = 'pick_up_crate' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null or crate_units(p_world, v_c.id) > 0 then return; end if;
    delete from crate where world_id = p_world and id = v_c.id;
    perform give(p_world, p_uid, (select item from crate_def where crate_def.kind = v_c.kind), 1, 20, v_c.material, v_c.rare);
    perform tell(p_world, p_uid, 'You pick up the '
      || lower((select name from crate_def where crate_def.kind = v_c.kind)) || '.'
      || case when v_c.deed then ' Deed workers will leave their finds by the token until a deed crate stands again.'
              else '' end, 'event');

  elsif p_action = 'crate_take_all' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return; end if;
    for v_r in select * from item where world_id = p_world and holder = 'crate' and crate = v_c.id order by id loop
      v_names := v_names || (case when v_r.count > 1 then v_r.count || ' × ' else '' end
        || made_name(v_r.def, v_r.piece));
      update item set holder = 'player', holder_uid = p_uid, crate = null, gx = null, gy = null
        where id = v_r.id;
    end loop;
    -- And onto the piles already in the pack. Emptying a crate is the loudest
    -- of these: a worker fills it a load at a time, so a crate of seeds is a
    -- dozen stacks, and taking them all used to put a dozen stacks in the pack.
    perform pack_fold(p_world, p_uid);
    if array_length(v_names, 1) is null then return; end if;
    perform tell(p_world, p_uid, 'You take ' || array_to_string(v_names, ', ') || ' from the crate.', 'event');

  elsif p_action = 'store_in_crate' then
    v_c := named_crate(p_world, v_p.x, v_p.y, p_target);
    if v_c.id is null then v_c := nearest_crate(p_world, v_p.x, v_p.y); end if;
    select * into v_it from item where id = target_item(p_target);
    if v_c.id is null or not found then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if coalesce((select stackable from item_def where id = v_it.def), false) then
      -- Stackables merge into the crate's own stack of them, a part at a time,
      -- and as far as there is room: what is over stays in the pack.
      v_fit := least(v_want, crate_spare(p_world, v_c));
      if v_fit <= 0 or not crate_add(p_world, v_c.id, v_it.def, v_fit, v_it.ql, v_it.extra, v_it.piece) then
        perform tell(p_world, p_uid, 'The ' || lower(crate_name(v_c)) || ' is full.', 'error');
        return;
      end if;
      if v_fit >= v_it.count then delete from item where id = v_it.id;
      else update item set count = count - v_fit where id = v_it.id; end if;
    else
      -- Anything else is the same row moved into the crate, so a bag keeps
      -- what is in it: the contents belong to the bag, wherever the bag is.
      -- The row used to be copied and the original deleted, and the deletion
      -- took the bag's contents with it.
      if crate_units(p_world, v_c.id) + v_it.count > crate_capacity(v_c) then
        perform tell(p_world, p_uid, 'The ' || lower(crate_name(v_c)) || ' is full.', 'error');
        return;
      end if;
      update item set holder = 'crate', holder_uid = null, crate = v_c.id, gx = v_c.x, gy = v_c.y, inside = null, placed = null
        where id = v_it.id;
      v_fit := v_it.count;
    end if;
    perform tell(p_world, p_uid,
      stored_line(v_fit, made_name(v_it.def, v_it.piece), crate_name(v_c), v_want - v_fit), 'event');

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
end $function$
;

select private.lock_doors();
