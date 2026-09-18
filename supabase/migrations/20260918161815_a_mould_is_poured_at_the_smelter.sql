-- A mould is poured at the smelter, and beaten out at the anvil once poured
--
-- Asked for. A mould used to be carried to the anvil and filled there, the
-- lumps and the beating one action; the smelter only ever cast an anvil. The
-- pour is the smelter's now (`pour_mould`, a firing action): the lumps go in,
-- the mould wears as it always did, and the furnace's heat cools the filling
-- into a *casting*, a thing in its own right (`item.piece` says which piece it
-- is of, `casting` is its def) that comes out with the lumps and stacks by
-- its piece. The anvil takes castings and nothing else (`smith`, on a
-- casting named the browser's way), and the casting's one quality stands for
-- the mould and the metal it was poured from. A bell and a statue were
-- castings already, and come out of the pour as themselves.
--
-- Because a casting is a thing, everything that stacks a thing by what it is
-- learns the new column: `give`, `move_part`, `crate_add` (and so the crate's
-- store), and `item_name` says "shovel head casting (iron)" rather than
-- "casting (iron)". Melted down, a casting gives back half its whole filling,
-- which is the mould's lumps rather than a piece's share of them
-- (`item_metal`). The browser was changed the same day and the suite
-- measures the chain end to end.

alter table item add column if not exists piece text;
comment on column item.piece is 'The piece a casting is of: the item it becomes at the anvil. Null for everything that is not a casting.';

/** The name of what was made, lower-cased for the middle of a sentence: a casting is named for its piece. */
create or replace function made_name(p_def text, p_cast text) returns text language sql stable as $fn$
  select case when p_def = 'casting' and p_cast is not null
              then lower(coalesce((select name from item_def where id = p_cast), p_cast)) || ' casting'
              else lower(coalesce((select name from item_def where id = p_def), p_def)) end
$fn$;

/**
 * Seconds for a filled mould to cool into a casting: the anvil's cooling time
 * scaled by the metal in it, an anvil being twenty lumps, and never under
 * eight. The browser reads the same sum.
 */
create or replace function pour_seconds(p_mould text, p_metal text, p_ql double precision) returns double precision language sql stable as $fn$
  select greatest(8, cast_seconds(p_metal, p_ql) * (select lumps from mould_def where id = p_mould) / 20.0)
$fn$;

/** The casting to beat out: the one the player named, or any in the pack when none was. Nothing else will do. */
create or replace function smith_casting(p_world uuid, p_uid uuid, p_item bigint) returns item language sql stable as $fn$
  select i.* from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    and not i.locked and i.def = 'casting' and i.piece is not null
    and (p_item is null or i.id = p_item)
  order by i.id limit 1
$fn$;

/** Lumps of metal in one of a thing: a casting holds its whole filling, anything else what the melt table says; null for a thing not made of metal. */
create or replace function item_metal(it item) returns real language sql stable as $fn$
  select case when it.def = 'casting' and it.piece is not null
              then (select lumps from mould_def where makes = it.piece)::real
              else (select content from melt_def where item = it.def) end
$fn$;

/** Lumps that come back from this many of a thing: half its metal, and never none. */
create or replace function melt_lumps(it item, p_count integer) returns integer language sql stable as $fn$
  select greatest(1, round(coalesce(item_metal(it), 0) * p_count * melt_share())::int)
$fn$;

/** A thing's name with its colour, rarity, material and charge: a casting is named for the piece it is of. */
create or replace function item_name(it item) returns text language sql stable as $fn$
  select case when w.words = '' then b.base
              else upper(left(w.words, 1)) || substr(w.words, 2) || ' ' || lower(b.base) end
      || coalesce(' (' || lower(it.extra) || ')', '')
      || case when d.charges is null then ''
              else ' (' || coalesce(it.charges, 0)::text || '/' || d.charges::text || ')' end
  from item_def d
  cross join lateral (select case when it.def = 'casting' and it.piece is not null
                                  then coalesce((select c.name from item_def c where c.id = it.piece), it.piece) || ' casting'
                                  else d.name end as base) b
  cross join lateral (select btrim(concat_ws(' ',
      (select y.word from dye_def y where y.id = it.dye), it.rare)) as words) w
  where d.id = it.def
$fn$;

-- A defaulted ninth argument: the eight-argument one would make every call ambiguous.
drop function give(uuid, uuid, text, integer, double precision, text, text, text);
CREATE OR REPLACE FUNCTION public.give(p_world uuid, p_uid uuid, p_item text, p_n integer, p_ql double precision, p_extra text DEFAULT NULL::text, p_rare text DEFAULT NULL::text, p_maker text DEFAULT NULL::text, p_cast text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare stacks boolean; found bigint;
begin
  select coalesce(d.stackable, false) into stacks from item_def d where d.id = p_item;
  if stacks then
    select i.id into found from item i
    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = p_item
      and i.extra is not distinct from p_extra and i.rare is not distinct from p_rare
      and i.maker is not distinct from p_maker and i.piece is not distinct from p_cast
    limit 1;
    if found is not null then
      -- Quality of a stack is the average of what is in it, by the unit.
      update item set ql = (ql * count + p_ql * p_n) / (count + p_n), count = count + p_n where id = found;
      return found;
    end if;
  end if;
  insert into item (world_id, holder, holder_uid, def, ql, count, extra, rare, maker, piece)
  values (p_world, 'player', p_uid, p_item, greatest(0, least(100, p_ql)), p_n, p_extra, p_rare, p_maker, p_cast)
  returning id into found;
  return found;
end $function$

;

-- Likewise a seventh.
drop function crate_add(uuid, integer, text, integer, double precision, text);
CREATE OR REPLACE FUNCTION public.crate_add(p_world uuid, p_id integer, p_def text, p_count integer, p_ql double precision, p_extra text DEFAULT NULL::text, p_cast text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c crate; stacks boolean; into_id bigint;
begin
  select * into c from crate where world_id = p_world and id = p_id;
  if not found then return false; end if;
  if crate_units(p_world, p_id) + p_count > crate_capacity(c) then return false; end if;
  select coalesce(d.stackable, false) into stacks from item_def d where d.id = p_def;
  if stacks then
    select i.id into into_id from item i
    where i.world_id = p_world and i.holder = 'crate' and i.crate = p_id and i.def = p_def
      and i.extra is not distinct from p_extra and i.piece is not distinct from p_cast
    limit 1;
    if into_id is not null then
      update item set ql = (ql * count + p_ql * p_count) / (count + p_count), count = count + p_count
        where id = into_id;
      return true;
    end if;
  end if;
  insert into item (world_id, holder, crate, gx, gy, def, ql, count, extra, piece)
  values (p_world, 'crate', p_id, c.x, c.y, p_def, greatest(0, least(100, p_ql)), p_count, p_extra, p_cast);
  return true;
end $function$

;

CREATE OR REPLACE FUNCTION public.move_part(p_item bigint, p_count integer, p_holder text, p_uid uuid, p_inside bigint, p_placed bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare it item; v_new bigint; v_stack item;
begin
  select * into it from item where id = p_item for update;
  if not found or p_count <= 0 or p_count > it.count then return null; end if;

  -- Somewhere to merge into, if the thing stacks at all.
  if coalesce((select stackable from item_def where id = it.def), false) then
    select * into v_stack from item o
    where o.world_id = it.world_id and o.holder = p_holder and o.id <> it.id
      and o.inside is not distinct from p_inside and o.placed is not distinct from p_placed
      -- Whose stack it is, not only what kind of holder has it: on a shared
      -- island the first stack of seeds ashore is somebody else's.
      and o.holder_uid is not distinct from p_uid
      and o.def = it.def and o.extra is not distinct from it.extra
      and o.rare is not distinct from it.rare and o.dye is not distinct from it.dye
      and o.maker is not distinct from it.maker
      and o.piece is not distinct from it.piece
    order by o.id limit 1;
  end if;

  if v_stack.id is not null then
    update item set ql = (v_stack.ql * v_stack.count + it.ql * p_count) / (v_stack.count + p_count),
        count = v_stack.count + p_count
      where id = v_stack.id;
    if p_count >= it.count then delete from item where id = it.id;
    else update item set count = it.count - p_count where id = it.id; end if;
    return v_stack.id;
  end if;

  if p_count = it.count then
    update item set holder = p_holder, holder_uid = p_uid, inside = p_inside, placed = p_placed,
        gx = null, gy = null, crate = null
      where id = it.id;
    return it.id;
  end if;
  update item set count = it.count - p_count where id = it.id;
  insert into item (world_id, holder, holder_uid, inside, placed, def, ql, dmg, count,
                    extra, rare, dye, bless, charges, locked, maker, piece)
  values (it.world_id, p_holder, p_uid, p_inside, p_placed, it.def, it.ql, it.dmg, p_count,
          it.extra, it.rare, it.dye, it.bless, it.charges, false, it.maker, it.piece)
  returning id into v_new;
  return v_new;
end $function$

;

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
        || made_name(v_r.def, v_r.piece));
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
    if coalesce((select stackable from item_def where id = v_it.def), false) then
      -- Stackables merge into the crate's own stack of them, a part at a time.
      if not crate_add(p_world, v_c.id, v_it.def, v_want, v_it.ql, v_it.extra, v_it.piece) then
        perform tell(p_world, p_uid, 'The crate is full.', 'error');
        return;
      end if;
      if v_want >= v_it.count then delete from item where id = v_it.id;
      else update item set count = count - v_want where id = v_it.id; end if;
    else
      -- Anything else is the same row moved into the crate, so a bag keeps
      -- what is in it: the contents belong to the bag, wherever the bag is.
      -- The row used to be copied and the original deleted, and the deletion
      -- took the bag's contents with it.
      if crate_units(p_world, v_c.id) + v_it.count > crate_capacity(v_c) then
        perform tell(p_world, p_uid, 'The crate is full.', 'error');
        return;
      end if;
      update item set holder = 'crate', holder_uid = null, crate = v_c.id, gx = v_c.x, gy = v_c.y, inside = null, placed = null
        where id = v_it.id;
    end if;
    perform tell(p_world, p_uid, 'You put ' || case when v_want > 1 then v_want || ' × ' else 'the ' end
      || made_name(v_it.def, v_it.piece)
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
end $function$

;

CREATE OR REPLACE FUNCTION public.firing_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('smelt_ore', 'melt_down', 'cast_anvil', 'pour_mould', 'smelter_take_all',
                      'load_kiln', 'kiln_take_all')
$function$

;

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
    if v_metal.id is null or item_metal(v_it) is null then
      return 'That is not made of metal the fire would give back.';
    end if;
    if jsonb_array_length(furnace_jobs(v_p))
       + melt_lumps(v_it, least(greatest(1, coalesce((p_target->>'count')::int, 1)), v_it.count))
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
    if jsonb_array_length(furnace_jobs(v_p)) >= furnace_capacity('smelter') then
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
    if v_metal.id is null or item_metal(v_it) is null then return; end if;
    v_n := least(greatest(1, coalesce((p_target->>'count')::int, 1)), v_it.count);
    v_need := melt_lumps(v_it, v_n);
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

  elsif p_action = 'pour_mould' then
    select * into v_mould from item where world_id = p_world and id = target_mould(p_target)
      and holder = 'player' and holder_uid = p_uid;
    select * into d from mould_def where id = v_mould.def;
    v_metal := metal_by_lump(v_it.def);
    if v_mould.id is null or d.id is null or d.makes = 'anvil' or v_metal.id is null then return; end if;
    v_need := mould_lumps(d.id, v_metal.id);
    if v_it.count < v_need or jsonb_array_length(v_jobs) >= furnace_capacity('smelter') then return; end if;
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

CREATE OR REPLACE FUNCTION public.furnace_settle(p_world uuid, p_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p placed; budget double precision; jobs jsonb; out_j jsonb; done jsonb;
        v_job jsonb; v_left double precision; made int := 0; was_lit boolean;
        v_name text;
begin
  select * into p from placed where id = p_id and world_id = p_world for update;
  if not found then return 0; end if;
  -- Seconds of burning it has done since anybody last looked. A furnace that
  -- ran out of fuel on Tuesday gets Tuesday's seconds and not a moment more.
  budget := case when p.lit then least(placed_fuel_spent(p), p.fuel) else 0 end;
  was_lit := p.lit;
  perform placed_settle(p_id);
  select * into p from placed where id = p_id;

  jobs := furnace_jobs(p);
  done := furnace_output(p);
  out_j := '[]'::jsonb;

  for v_job in select * from jsonb_array_elements(jobs) loop
    v_left := (v_job->>'left')::double precision;
    if budget <= 0 then
      out_j := out_j || v_job;
      continue;
    end if;
    if v_left > budget then
      out_j := out_j || jsonb_set(v_job, '{left}', to_jsonb(v_left - budget));
      budget := 0;
      continue;
    end if;
    -- It came out. Whatever is left of the budget goes on the next one.
    budget := budget - v_left;
    done := done || jsonb_build_object('def', v_job->>'makes', 'ql', (v_job->>'ql')::double precision,
      'count', 1, 'extra', v_job->>'extra', 'piece', v_job->>'piece');
    made := made + 1;
  end loop;

  update placed set state = jsonb_set(jsonb_set(coalesce(state, '{}'::jsonb),
      '{jobs}', out_j), '{output}', done)
    where id = p_id;

  if made > 0 and p.made_by is not null then
    v_name := made_name(done->(jsonb_array_length(done) - 1)->>'def',
                        done->(jsonb_array_length(done) - 1)->>'piece');
    perform tell(p_world, p.made_by, 'The ' || p.kind || ' finishes '
      || case when made = 1 then 'a ' || v_name else made || ' pieces, the last of them a ' || v_name end
      || '.', 'event');
  end if;
  if was_lit and not (select lit from placed where id = p_id) then
    if p.made_by is not null then
      perform tell(p_world, p.made_by, 'A ' || p.kind
        || ' burns through the last of its fuel and goes cold.', 'event');
    end if;
  end if;
  return made;
end $function$

;

CREATE OR REPLACE FUNCTION public.forge_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; v_lump item; v_cast item;
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
      if not found then return 'An oven takes what a fire takes: ' || fuel_said() || '.'; end if;
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
  if p_action = 'strike_coins' then
    -- Coins: a die in the pack, and a lump of a metal that coins, in the
    -- words the browser uses.
    if pack_count(p_world, p_uid, 'coin_die') < 1 then return 'You need a coin die.'; end if;
    v_lump := smith_lump(p_world, p_uid, target_item(p_target));
    if v_lump.id is null then return 'You have no metal to strike.'; end if;
    if not coalesce((metal_by_lump(v_lump.def)).coins, false) then return 'Coins are struck from silver or gold.'; end if;
    return null;
  end if;
  -- Smithing: a casting poured at the smelter, in the words the browser uses.
  v_cast := smith_casting(p_world, p_uid, target_item(p_target));
  if v_cast.id is null then
    return case when target_item(p_target) is not null then 'Choose a casting.'
                else 'Pour a mould at the smelter first.' end;
  end if;
  if not exists (select 1 from mould_def where makes = v_cast.piece) then return 'Choose a casting.'; end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.perform_forge(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item; m metal_def; v_cast item;
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
      || ' down. Bring a casting to it.', 'event');
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
  if p_action = 'strike_coins' then
    -- The die wears with every strike, good or bad, and no die can be mended.
    select * into v_mould from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'coin_die' order by tool_worth(ql, dmg, extra, rare, bless) desc limit 1;
    v_lump := smith_lump(p_world, p_uid, target_item(p_target));
    select * into m from metal_def where lump = v_lump.def;
    if v_mould.id is null or v_lump.id is null or m.id is null or not m.coins then return; end if;
    if not consume(p_world, p_uid, v_lump.def, 1, v_lump.id) then return; end if;
    v_mould_ql := greatest(1, v_mould.ql - v_mould.dmg / 2);
    v_broke := v_mould.dmg + die_wear() >= 100;
    if v_broke then
      delete from item where id = v_mould.id;
    else
      update item set dmg = least(100, v_mould.dmg + die_wear()) where id = v_mould.id;
    end if;
    v_hard := coin_difficulty() + (mat_of(v_lump.extra)).difficulty;
    if not skill_check(skill_of(p_world, p_uid, 'blacksmithing'), v_hard, anvil_ql(p),
                       mind_ease(p_world, p_uid)) then
      v_gained := skill_raise(p_world, p_uid, 'blacksmithing', try_gain(false, smith_gain()));
      perform tell(p_world, p_uid, 'The blanks come out smeared and you throw the metal back.'
        || case when v_broke then ' The die is worn through.' else '' end, 'event');
      perform skill_said(p_world, p_uid, 'blacksmithing', v_gained);
      return;
    end if;
    v_ql := smith_ql(p_world, p_uid, 'blacksmithing', v_mould_ql, v_lump.ql, anvil_ql(p));
    v_gained := skill_raise(p_world, p_uid, 'blacksmithing', try_gain(true, smith_gain()));
    v_rare := rarity_roll();
    v_made := give(p_world, p_uid, 'coin', coins_per_lump()::int, v_ql, m.name, v_rare, maker_mark(p_world, p_uid, v_rare));
    perform journal_made(p_world, p_uid, 'coin', v_ql, coins_per_lump()::int, v_rare);
    perform journal_note(p_world, p_uid, 'minted');
    if v_rare is not null then
      perform journal_note(p_world, p_uid, v_rare);
      perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
    end if;
    perform tell(p_world, p_uid, 'You strike ' || coins_per_lump()::int || ' ' || lower(m.name)
      || ' coins on the ' || lower(anvil_name(p)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')'
      || case when v_broke then ' The die is worn through and done.'
              else ' The die has ' || ceil((100 - (v_mould.dmg + die_wear())) / die_wear())::int || ' strikes left.' end, 'event');
    perform skill_said(p_world, p_uid, 'blacksmithing', v_gained);
    return;
  end if;

  -- Smithing: a casting poured at the smelter, beaten true on the anvil.
  v_cast := smith_casting(p_world, p_uid, target_item(p_target));
  select * into d from mould_def where makes = v_cast.piece;
  m := metal_by_name(v_cast.extra);
  if v_cast.id is null or d.id is null or m.id is null then return; end if;
  if v_cast.count > 1 then
    update item set count = count - 1 where id = v_cast.id;
  else
    delete from item where id = v_cast.id;
  end if;

  -- The deeper the seam it came out of, the harder it is to beat into shape.
  v_hard := d.difficulty + (mat_of(v_cast.extra)).difficulty;
  if not skill_check(skill_of(p_world, p_uid, d.skill), v_hard, anvil_ql(p),
                     mind_ease(p_world, p_uid)) then
    v_gained := skill_raise(p_world, p_uid, d.skill, try_gain(false, smith_gain()));
    perform tell(p_world, p_uid, 'The '
      || lower((select name from item_def where id = d.makes))
      || ' comes out misshapen and you throw the metal back.', 'event');
    perform skill_said(p_world, p_uid, d.skill, v_gained);
    return;
  end if;

  -- The casting carries the mould and the metal it was poured from, so it stands for both.
  v_ql := smith_ql(p_world, p_uid, d.skill, v_cast.ql, v_cast.ql, anvil_ql(p));
  v_gained := skill_raise(p_world, p_uid, d.skill, try_gain(true, smith_gain()));
  v_rare := rarity_roll();
  v_made := give(p_world, p_uid, d.makes, d.per, v_ql, m.name, v_rare, maker_mark(p_world, p_uid, v_rare));
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
    || ' on the ' || lower(anvil_name(p)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
  -- And what the go taught, said: it was raised and never told, which read as nothing learned.
  perform skill_said(p_world, p_uid, d.skill, v_gained);
end $function$
;

-- A column was added to a table the API sees.
notify pgrst, 'reload schema';

select private.lock_doors();
