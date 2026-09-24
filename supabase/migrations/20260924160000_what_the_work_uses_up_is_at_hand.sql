-- What the work uses up is at hand
--
-- Asked: "pouring a mould, as an action that requires ingredients, should be
-- pulling the iron from the adjacent wagon as it is within 3 tiles".
--
-- ## Every station, and not only the bench
--
-- A craft has reached past the pack since
-- `a_craft_reaches_into_the_stores_around_you`: into the bags on your back
-- and into your stores within `craft_reach()` tiles, nearest first, through
-- `craft_stock`. Nothing else did. Pouring a mould, casting an anvil,
-- charging a smelter with ore or scrap, packing a kiln, feeding a fire, a
-- smelter, a kiln or an oven, beating out a casting and striking coins at an
-- anvil, working stock into a thing to better it and setting a brew going
-- all asked for the thing in your hands -- so a smelter with a wagon of iron
-- drawn up beside it said "You carry no metal."
--
-- They all read `craft_stock` now, in its order and by its rules: nothing
-- put by, priced, posted or held for a deal, and no store behind a padlock
-- you hold no key to. `at_hand` asks whether one stack is in it, and
-- `spend_stack` takes from that one stack and no other, which is what each of
-- these did with the pack: they are pointed at a stack rather than handed a
-- bill. A brew is a bill, and spends through `craft_consume` as a craft does.
-- Improving still works in the poorest stock first, and what you carry
-- before any store. The tools are the ones you carry, as they are for a
-- craft: the moulds, the coin die, the file.
--
-- ## A vehicle is anybody's store
--
-- A craft reached into a piece only when you set it down or it stands on a
-- settlement of yours. A cart, a wagon and a boat are open to whoever stands
-- at them -- anybody may load one or empty one -- so a craft reaches into one
-- whoever built it and whosever ground it stands on. A padlock on it still
-- keeps a craft out, as it keeps out a hand.

/* ---- One stack at hand, and spending from it ---- */

create or replace function public.at_hand(p_world uuid, p_uid uuid, p_id bigint)
returns boolean
language sql
stable
as $$
  -- In the pack, in a bag you are carrying, or in a store within reach, by
  -- the rules `craft_stock` keeps.
  select p_id is not null and exists (select 1 from craft_stock(p_world, p_uid) s where s.id = p_id)
$$;

create or replace function public.spend_stack(p_world uuid, p_uid uuid, p_id bigint, p_n integer)
returns boolean
language plpgsql
as $$
declare have int;
begin
  -- `p_n` of that one stack, or nothing: never the rest from somewhere else.
  if p_n <= 0 then return true; end if;
  if not at_hand(p_world, p_uid, p_id) then return false; end if;
  select i.count into have from item i where i.world_id = p_world and i.id = p_id for update;
  if not found or have < p_n then return false; end if;
  if have = p_n then delete from item where id = p_id;
  else update item set count = count - p_n where id = p_id; end if;
  return true;
end $$;

/* ---- A vehicle is anybody's store ---- */

CREATE OR REPLACE FUNCTION public.craft_stock(p_world uuid, p_uid uuid)
 RETURNS TABLE(id bigint, def text, count integer, extra text, ql real, carried boolean, draw bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with me as (
    select p.x, p.y, floor(p.x)::int as tx, floor(p.y)::int as ty
      from player p where p.world_id = p_world and p.uid = p_uid
  ),
  crates as materialized (
    select c.id, sqrt((crate_centre_x(c) - me.x) ^ 2 + (crate_centre_y(c) - me.y) ^ 2) as d
      from crate c, me
     where c.world_id = p_world
       and c.x between me.tx - craft_reach() and me.tx + craft_reach()
       and c.y between me.ty - craft_reach() and me.ty + craft_reach()
       and crate_yours(p_world, p_uid, c.id)
       and not lock_shut(p_world, p_uid, c.lock, c.x, c.y)
  ),
  pieces as materialized (
    select pl.id, sqrt((pl.cx - me.x) ^ 2 + (pl.cy - me.y) ^ 2) as d
      from placed pl join furniture_def f on f.id = pl.sub, me
     where pl.world_id = p_world and pl.kind = 'furniture'
       and pl.x between me.tx - craft_reach() and me.tx + craft_reach()
       and pl.y between me.ty - craft_reach() and me.ty + craft_reach()
       and furniture_holds(pl)
       and coalesce(f.trash, 0) = 0 and not f.stall
       -- Yours, or on a settlement of yours -- or a cart, a wagon or a boat,
       -- which is anybody's to load and to empty, and so anybody's to use.
       and (pl.made_by = p_uid or on_my_deed(p_world, p_uid, pl.x, pl.y) or f.cart or is_driveable(pl))
       and not lock_shut(p_world, p_uid, pl.lock, pl.x, pl.y)
  ),
  stock as (
    -- Loose in your hands.
    select i.id, i.def, i.count, i.extra, i.ql, true as carried,
           0 as rank, 0::double precision as d, 0 as kind, 0::bigint as store
      from item i
     where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and not i.locked and i.deal is null
    union all
    -- In a bag you are carrying: `carried`, the lookup `in_the_bag` made.
    select i.id, i.def, i.count, i.extra, i.ql, true, 1, 0, 0, b.id
      from item b join item i on i.inside = b.id and i.holder = 'bag'
     where b.world_id = p_world and b.holder = 'player' and b.holder_uid = p_uid
       and not i.locked and i.deal is null
    union all
    select i.id, i.def, i.count, i.extra, i.ql, false, 2, c.d, 0, c.id::bigint
      from crates c join item i on i.world_id = p_world and i.holder = 'crate' and i.crate = c.id
     where not i.locked and i.deal is null and i.price is null and i.letter is null
    union all
    select i.id, i.def, i.count, i.extra, i.ql, false, 2, pc.d, 1, pc.id
      from pieces pc join item i on i.world_id = p_world and i.holder = 'furniture' and i.placed = pc.id
     where not i.locked and i.deal is null and i.price is null and i.letter is null
  )
  select s.id, s.def, s.count, s.extra, s.ql, s.carried,
         row_number() over (order by s.rank, s.d, s.kind, s.store, s.id)
    from stock s
$function$;

/* ---- The furnaces: ore, scrap, metal and clay ---- */

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

  -- What goes in is at hand: in the pack, a bag, or a store within reach.
  select * into v_it from item where id = target_item(p_target)
    and world_id = p_world and at_hand(p_world, p_uid, id);

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
      select i.* into v_it from craft_stock(p_world, p_uid) s join item i on i.id = s.id
        where exists (select 1 from pottery_def where unfired = s.def) order by s.draw limit 1;
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
end $function$;

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
    if not spend_stack(p_world, p_uid, v_it.id, v_n * ore_per_lump()::int) then return; end if;
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
    if not spend_stack(p_world, p_uid, v_it.id, v_n) then return; end if;
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
      select i.* into v_it from craft_stock(p_world, p_uid) s join item i on i.id = s.id
        where exists (select 1 from pottery_def where unfired = s.def) order by s.draw limit 1;
    end if;
    v_makes := (select fired from pottery_def where unfired = v_it.def);
    if v_makes is null then return; end if;
    v_n := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), v_it.count),
      furnace_capacity(v_p) - jsonb_array_length(v_jobs)));
    if not spend_stack(p_world, p_uid, v_it.id, v_n) then return; end if;
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
    if not spend_stack(p_world, p_uid, v_it.id, v_need) then return; end if;
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
    if not spend_stack(p_world, p_uid, v_it.id, v_need) then return; end if;
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
end $function$;

/* ---- The fires: fuel ---- */

CREATE OR REPLACE FUNCTION public.fire_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; n int; sub text; sz int[];
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
    select i.* into it from craft_stock(p_world, p_uid) s join item i on i.id = s.id
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
    if crates_on_rack(p_world, p.id) > 0 then return 'Take the crates off it first.'; end if;
    return furniture_turn_reason(p);
  elsif p_action in ('take_apart_campfire', 'pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    if placed_lit(p) then return 'Put it out first.'; end if;
    if p_action = 'pick_up_furniture' then
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
      if p.puller is not null then return 'Let go of it first.'; end if;
      if team_size(p_world, p.id) > 0 then return 'Unhitch the team first.'; end if;
      if p.driver is not null then return 'Get down off it first.'; end if;
    end if;
  end if;
  return null;
end $function$;

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
    -- A piece stands there as whatever it was in the pack. This read the def
    -- through replace(it.def, 'furniture_', '') for as long as the pick-up put
    -- that prefix on, which meant the two halves disagreed about what an item
    -- is called and only one of them ever said so. Neither does now.
    sub := case when p_action = 'place_furniture' then it.def end;
    -- Which way it faces, which is the browser's to say and south when it says nothing.
    back := case when p_target->>'facing' in ('n', 'e', 's', 'w') then p_target->>'facing' else 's' end;
    sz := placed_size(case p_action when 'place_smelter' then 'smelter'
                                    when 'place_kiln' then 'kiln' else 'furniture' end, sub, back);
    ax := least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0)));
    ay := least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0)));
    /*
     * The quality, and -- new here -- the rarity and the wood.
     *
     * A piece set down used to reach the ground with nothing but its quality.
     * Its rarity went in the bin, so a rare chest was a rare chest right up
     * until somebody put it in a room and then it was a chest; and its wood
     * went with it, so an oak chest and a pine one were the same chest the
     * moment they were standing. Both are on the item being consumed here,
     * and both come across now.
     */
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, facing, rare, material)
    values (p_world, case p_action when 'place_smelter' then 'smelter'
                                   when 'place_kiln' then 'kiln' else 'furniture' end, sub,
            (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + sz[1] / 2.0) / subtiles(),
            (p_target->>'y')::int + (ay + sz[2] / 2.0) / subtiles(),
            it.ql, p_uid, back, it.rare, it.extra)
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
    -- From what is at hand: the pack, a bag, or a store within reach.
    select i.* into it from craft_stock(p_world, p_uid) s join item i on i.id = s.id
      where (s.id = target_item(p_target) or fuel_value(s.def) is not null)
      order by (s.id = target_item(p_target)) desc, s.draw limit 1;
    per := fuel_value(it.def);
    room := greatest(0, fire_capacity() - p.fuel);
    /*
     * How many you asked for, which this never read.
     *
     * Reported as "attempting to feed one coal to a smelter puts four coal
     * in". The menu offers one or all and sends the count either way; this
     * fed as much as would fit whatever it was told, so a firebox with room
     * in it swallowed the whole pile on a single "one". The browser has read
     * the count since fuelling was written.
     */
    fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                              ceil(room / per)::int));
    if not spend_stack(p_world, p_uid, it.id, fits) then return; end if;
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
  elsif p_action = 'turn_furniture' then
    -- A quarter turn to the right, walked to the nearest spot the turned block fits.
    back := turned_facing(p.facing, 1);
    sz := placed_size(p.kind, p.sub, back);
    ax := least(subtiles() - sz[1], greatest(0, p.sx));
    ay := least(subtiles() - sz[2], greatest(0, p.sy));
    update placed set facing = back, sx = ax, sy = ay,
        cx = p.x + (ax + sz[1] / 2.0) / subtiles(), cy = p.y + (ay + sz[2] / 2.0) / subtiles()
      where id = p.id;
    perform tell(p_world, p_uid, 'You turn the ' || lower(placed_name(p)) || ' to face ' || side_name(back) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);

  elsif p_action in ('pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    /*
     * What goes back in the pack is the thing's own definition, which for a
     * piece of furniture is its `sub` and nothing else.
     *
     * It used to be 'furniture_' || p.sub. There is no such item: the
     * catalogue calls a wagon a wagon, so picking one up put a row in your
     * pack with a definition nothing has ever heard of. It showed as its own
     * id under OTHER, weighed whatever the fallback weighs, and could not be
     * set down again, because the browser asks `isFurniture` of the id it is
     * holding and the answer was no. The wagon was not lost, but it was not a
     * wagon either.
     *
     * The other half of the pair hid it: `place_furniture` reads its `sub`
     * with replace(it.def, 'furniture_', ''), so it would have accepted the
     * broken id perfectly well and nothing on this side ever complained.
     */
    back := case p.kind when 'smelter' then 'smelter' when 'kiln' then 'kiln'
                        else p.sub end;
    delete from placed where id = p.id;
    -- And back the same way: what it stood there as is what goes in the pack.
    -- `give` has taken a material and a rarity since the day it was written.
    perform give(p_world, p_uid, back, 1, p.ql, p.material, p.rare);
    perform tell(p_world, p_uid, 'You take up the ' || lower(coalesce(p.sub, p.kind)) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$;

/* ---- The oven and the anvil ---- */

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
      select i.* into it from craft_stock(p_world, p_uid) s join item i on i.id = s.id
        where fuel_value(s.def) is not null
          and (target_item(p_target) is null or s.id = target_item(p_target))
        order by s.draw limit 1;
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
end $function$;

CREATE OR REPLACE FUNCTION public.perform_forge(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item; m metal_def; v_cast item;
        v_per double precision; v_room double precision; v_fits int; v_whole int;
        v_ql double precision; v_mould_ql double precision; v_hard double precision;
        v_rare text; v_made bigint; v_broke boolean; v_sz int[]; v_sx int; v_sy int; v_left double precision;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    perform placed_settle((p_target->>'id')::bigint);
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;

    if p_action = 'fuel_oven' then
      select i.* into it from craft_stock(p_world, p_uid) s join item i on i.id = s.id
        where fuel_value(s.def) is not null
          and (target_item(p_target) is null or s.id = target_item(p_target))
        order by s.draw limit 1;
      if not found then return; end if;
      v_per := fuel_value(it.def);
      v_room := greatest(0, hearth_capacity(p) - p.fuel);
      v_fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                                  ceil(v_room / v_per)::int));
      if not spend_stack(p_world, p_uid, it.id, v_fits) then return; end if;
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
    -- An anvil's metal rides in `sub`, and its rarity now rides beside it.
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, rare)
    values (p_world, 'anvil', coalesce(it.extra, 'copper'),
            (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 1.0) / subtiles(),
            (p_target->>'y')::int + (v_sy + 1.0) / subtiles(), it.ql, p_uid, it.rare)
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
    perform give(p_world, p_uid, 'anvil', 1, p.ql, p.sub, p.rare);
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
    if not spend_stack(p_world, p_uid, v_lump.id, 1) then return; end if;
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
      perform skill_raise(p_world, p_uid, 'blacksmithing', try_gain(false, smith_gain()));
      perform tell(p_world, p_uid, 'The blanks come out smeared and you throw the metal back.'
        || case when v_broke then ' The die is worn through.' else '' end, 'event');
      return;
    end if;
    v_ql := smith_ql(p_world, p_uid, 'blacksmithing', v_mould_ql, v_lump.ql, anvil_ql(p));
    perform skill_raise(p_world, p_uid, 'blacksmithing', try_gain(true, smith_gain()));
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
    return;
  end if;

  -- Smithing: a casting poured at the smelter, beaten true on the anvil.
  v_cast := smith_casting(p_world, p_uid, target_item(p_target));
  select * into d from mould_def where makes = v_cast.piece;
  m := metal_by_name(v_cast.extra);
  if v_cast.id is null or d.id is null or m.id is null then return; end if;
  if not spend_stack(p_world, p_uid, v_cast.id, 1) then return; end if;

  -- The deeper the seam it came out of, the harder it is to beat into shape.
  v_hard := d.difficulty + (mat_of(v_cast.extra)).difficulty;
  if not skill_check(skill_of(p_world, p_uid, d.skill), v_hard, anvil_ql(p),
                     mind_ease(p_world, p_uid)) then
    perform skill_raise(p_world, p_uid, d.skill, try_gain(false, smith_gain()));
    perform tell(p_world, p_uid, 'The '
      || lower((select name from item_def where id = d.makes))
      || ' comes out misshapen and you throw the metal back.', 'event');
    return;
  end if;

  -- The casting carries the mould and the metal it was poured from, so it stands for both.
  v_ql := smith_ql(p_world, p_uid, d.skill, v_cast.ql, v_cast.ql, anvil_ql(p));
  perform skill_raise(p_world, p_uid, d.skill, try_gain(true, smith_gain()));
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
end $function$;

CREATE OR REPLACE FUNCTION public.smith_lump(p_world uuid, p_uid uuid, p_uid_item bigint)
 RETURNS item
 LANGUAGE sql
 STABLE
AS $function$
  -- At hand: the pack, a bag, or a store within reach, in the order a craft
  -- spends them, and nothing put by.
  select i.* from craft_stock(p_world, p_uid) s join item i on i.id = s.id
  where exists (select 1 from metal_def m where m.lump = s.def)
  order by (s.id = p_uid_item) desc, s.draw
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.smith_casting(p_world uuid, p_uid uuid, p_item bigint)
 RETURNS item
 LANGUAGE sql
 STABLE
AS $function$
  -- At hand: the pack, a bag, or a store within reach, and nothing put by.
  select i.* from craft_stock(p_world, p_uid) s join item i on i.id = s.id
  where s.def = 'casting' and i.piece is not null
    and (p_item is null or s.id = p_item)
  order by s.draw limit 1
$function$;

/* ---- Bettering a thing ---- */

CREATE OR REPLACE FUNCTION public.stock_for(p_world uuid, p_uid uuid, p_material text, p_made text)
 RETURNS item
 LANGUAGE sql
 STABLE
AS $function$
  -- At hand: what you carry first, and only then your stores within reach;
  -- the poorest of whichever it is, so the good stays.
  select i.* from craft_stock(p_world, p_uid) h
  join item i on i.id = h.id
  join improve_stock s on s.item = i.def and s.material = p_material
  cross join lateral (select (mat_of_item(i.def, i.extra)).name as made) k
  where
    -- Stock that says what it is made of has to say the right thing; stock
    -- that says nothing is stock of no particular sort and goes into anything.
    (p_made is null or k.made is null or lower(k.made) = lower(p_made))
  order by h.carried desc, i.ql, h.draw limit 1
$function$;

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
    /*
     * And the tree, which is the one place fineness runs backwards: what a
     * mend costs the piece rather than what a pass puts on it. A mender whose
     * work comes back better than it went is a mender who takes less off, so
     * the multiplier divides here and multiplies everywhere else. It is the
     * same number saying the same thing about a different quantity.
     */
    v_lost := v_healed * greatest(0.004, 0.03 - v_skill * 0.00026)
            / class_mul(p_world, p_uid, 'fine', 'repair');
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
    if v_stock.id is null or not spend_stack(p_world, p_uid, v_stock.id, 1) then return; end if;
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
    -- And the tree, on the trade that would have made the thing: a smith's
    -- temper is worth as much at the file as at the anvil. The ceiling is
    -- untouched, so this buys passes rather than a higher top.
    update item set ql = greatest(ql, least(v_ceiling,
        ql + improve_step(skill_of(p_world, p_uid, v_what.skill), ql)
             * class_mul(p_world, p_uid, 'fine', v_what.skill)))
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

/* ---- A brew ---- */

CREATE OR REPLACE FUNCTION public.brew_reason(p_world uuid, p_uid uuid, p placed, b brew_def)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare have int;
begin
  if p.id is null then return 'Stand at a barrel.'; end if;
  if not holds_liquid(p) then return 'That holds no liquid.'; end if;
  if is_working(p) then return 'It is already working. Leave it alone.'; end if;
  if coalesce(placed_liquid(p), '') <> 'water' then
    return 'A brew is started in water. Empty the ' || lower(placed_name(p))
      || ' and fill it from a well.';
  end if;
  if placed_litres(p) < b.litres then
    return 'That takes ' || to_char(b.litres, 'FM990') || ' litres of water; there are '
      || to_char(placed_litres(p), 'FM990') || ' in it.';
  end if;
  -- What goes in is at hand: the pack, a bag, or a store within reach.
  have := craft_count(p_world, p_uid, b.input);
  if have < b.count then
    return 'That takes ' || b.count || ' × '
      || lower((select coalesce(name, b.input) from item_def where id = b.input))
      || '; you have ' || have || '.';
  end if;
  return null;
end $function$;

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

  elsif p_action = 'ring_bell' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select * into p from player where world_id = p_world and uid = p_uid;
    r := deed_at(p_world, pc.x, pc.y);
    if r.world_id is null then return; end if;
    v_n := 0;
    -- Every wildermon working the deed drops what it is doing and walks to
    -- whoever rang: a leg to the ringer, and a while standing there before
    -- the work takes it back.
    for e in select cr.*, coalesce(sp.speed, 1) as pace
             from creature cr join species_def sp on sp.id = cr.species
             where cr.world_id = p_world and cr.mode = 'deed' and cr.hitched_to is null
               and cr.keeper in (select m.uid from deed_member m
                                 where m.world_id = p_world and m.founder = r.founded_by
                                 union select r.founded_by)
    loop
      v_ql := greatest(0.5, sqrt(power(p.x - e.to_x, 2) + power(p.y - e.to_y, 2)) / greatest(0.4, e.pace));
      update creature set phase = 'idle', work_x = null, work_y = null, enemy = null,
          from_x = e.to_x, from_y = e.to_y, to_x = p.x, to_y = p.y,
          leg_at = now(), leg_ends = now() + make_interval(secs => v_ql),
          until = now() + make_interval(secs => v_ql + 20)
        where world_id = p_world and id = e.id;
      v_n := v_n + 1;
    end loop;
    -- And every citizen hears where it hangs.
    for e in select m.uid from deed_member m where m.world_id = p_world and m.founder = r.founded_by
             union select r.founded_by
    loop
      if e.uid <> p_uid then
        perform tell(p_world, e.uid, 'The bell rings out over ' || r.name || ' from ' || pc.x || ', ' || pc.y || '.', 'system');
      end if;
    end loop;
    perform journal_note(p_world, p_uid, 'rang');
    perform tell(p_world, p_uid, 'You ring the ' || lower(placed_name(pc)) || ' and it sounds over ' || r.name || '. '
      || case when v_n > 0 then v_n || ' wildermon ' || case when v_n = 1 then 'comes' else 'come' end || ' at the sound'
              else 'Nothing is working the deed to come' end
      || ', and every citizen hears where it hangs: ' || pc.x || ', ' || pc.y || '.', 'event');

  elsif p_action = 'sleep' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    /*
     * A well-made bed is a better night than a cot with a thin mattress — and
     * a bed under a roof, in a room with walls all round it, is a better night
     * again than the same bed standing in a field in the weather.
     */
    perform journal_note(p_world, p_uid, 'slept');
    perform sleep_until_morning(p_world, p_uid,
      (select bed from furniture_def where id = pc.sub) * (0.6 + pc.ql / 250)
        * case when indoors(p_world, 0, floor(pc.x)::int, floor(pc.y)::int) then indoors_rest() else 1 end,
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
    select i.* into v_stock from craft_stock(p_world, p_uid) h join item i on i.id = h.id
      where h.def = bd.input order by h.draw limit 1;
    v_ql := coalesce(v_stock.ql, 20);
    if not craft_consume(p_world, p_uid, bd.input, bd.count) then return; end if;
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

select private.lock_doors();
