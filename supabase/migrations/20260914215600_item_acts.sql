-- The four things a pair of hands does to a thing it is holding.
--
-- Better it, mend it, eat it, drink it. None of them is complicated on its
-- own; between them they are most of what a day is made of, and until now this
-- island could not answer any of the four.

create or replace function item_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('improve_item', 'repair_item', 'eat', 'drink', 'drink_skin')
$$;

/* ------------------------------------------------------------------ *
 * Bettering a thing.
 * ------------------------------------------------------------------ */

/**
 * A thing cannot be bettered past the hands doing the work — except that a
 * rare thing has something in it the hands did not put there, and goes a
 * little further than they could take an ordinary one.
 */
create or replace function improve_ceiling(p_world uuid, p_uid uuid, p_skill text, p_rare text)
  returns double precision language sql stable as $$
  select greatest(10, skill_of(p_world, p_uid, p_skill))
    + case p_rare when 'rare' then 4 when 'supreme' then 10 when 'fantastic' then 20 else 0 end
$$;

/** How much a successful pass adds: a great deal at first, very little near the end. */
create or replace function improve_step(p_level double precision, p_ql double precision)
  returns double precision language sql immutable as $$
  select greatest(0.08, greatest(0, 100 - p_ql) * 0.05 * (0.35 + p_level / 130))
$$;

/** The first of a material's tools that is not in hand, or null when all are. */
create or replace function missing_tool(p_world uuid, p_uid uuid, p_material text) returns text
  language sql stable as $$
  select t.tool from improve_tool t
  where t.material = p_material and pack_count(p_world, p_uid, t.tool) <= 0
  order by t.ord limit 1
$$;

/**
 * The stock carried for a material, preferring the poorest so the good stays.
 *
 * A thing that is made of something can only be built up with more of the
 * same: you do not patch an oak chest with pine, and a copper blade will not
 * take bronze.
 */
create or replace function stock_for(p_world uuid, p_uid uuid, p_material text, p_made text) returns item
  language sql stable as $$
  select i.* from item i
  join improve_stock s on s.item = i.def and s.material = p_material
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    and (p_made is null or lower(coalesce(i.extra, '')) = lower(p_made))
  order by i.ql limit 1
$$;

/* ------------------------------------------------------------------ *
 * What is actually in a meal.
 * ------------------------------------------------------------------ */

/** How much of a helping goes in: a thing made well is worth more. */
create or replace function helping_of(p_ql double precision) returns double precision
  language sql immutable as $$ select 0.55 + greatest(1, least(100, p_ql)) / 220 $$;

/**
 * Which trade a dish favours on this island.
 *
 * Settled when the island is raised and never moving on it: the same scramble
 * the browser uses, over the island's own seed, so no two islands agree about
 * what a fish pie is good for and the only way to find out is to eat one.
 */
create or replace function boon_of(p_seed bigint, p_item text) returns text
  language plpgsql immutable as $$
declare h bigint; i int;
begin
  if not exists (select 1 from item_def d where d.id = p_item and d.category = 'food'
                   and (coalesce(d.food, 0) > 0 or coalesce(d.drink, 0) > 0)) then
    return null;
  end if;
  h := ((p_seed # 2654435769) % 4294967296 + 4294967296) % 4294967296;
  for i in 1..length(p_item) loop
    h := h # ascii(substr(p_item, i, 1));
    h := (h * 16777619) % 4294967296;
  end loop;
  return (select skill from boon_skill where ord = (h % (select count(*) from boon_skill))::int);
end $$;

/** How long a helping of it holds, by how good a helping it was. */
create or replace function boon_time(p_item text, p_ql double precision) returns double precision
  language sql stable as $$
  select round(boon_seconds() * least(2.5, (coalesce(food, 0) + coalesce(drink, 0) * 2.4) * 2.2)
    * (0.4 + least(100, p_ql) / 140))
  from item_def where id = p_item
$$;

create or replace function clock_left(p_seconds double precision) returns text
  language sql immutable as $$
  select case when floor(p_seconds / 60) >= 1 then floor(p_seconds / 60) || 'm'
              else round(p_seconds) || 's' end
$$;

/**
 * Leave a knack behind. One to a trade: eating a second helping of the same
 * thing pushes the hour out rather than stacking a second bonus on it.
 */
create or replace function grant_boon(p_world uuid, p_uid uuid, p_item text, p_ql double precision)
  returns text language plpgsql as $$
declare v_skill text; v_secs double precision; v_boons jsonb; v_out jsonb := '[]'::jsonb;
        v_one jsonb; v_found boolean := false; v_until double precision; v_now double precision;
begin
  select boon_of((select seed from world where id = p_world), p_item) into v_skill;
  if v_skill is null then return null; end if;
  v_secs := boon_time(p_item, p_ql);
  v_now := world_time(p_world);
  v_until := v_now + v_secs;
  select boons into v_boons from player where world_id = p_world and uid = p_uid;
  for v_one in select * from jsonb_array_elements(coalesce(v_boons, '[]'::jsonb)) loop
    -- Drop what has already run out rather than letting the list grow for ever.
    if (v_one->>'until')::double precision <= v_now then continue; end if;
    if v_one->>'skill' = v_skill then
      v_one := jsonb_set(v_one, '{until}', to_jsonb(greatest((v_one->>'until')::double precision, v_until)));
      v_found := true;
    end if;
    v_out := v_out || v_one;
  end loop;
  if not v_found then
    v_out := v_out || jsonb_build_object('skill', v_skill, 'bonus', boon_bonus(),
      'until', v_until, 'from', lower((select coalesce(name, p_item) from item_def where id = p_item)));
  end if;
  update player set boons = v_out where world_id = p_world and uid = p_uid;
  return (select name from skill_def where id = v_skill) || ' comes easier for the next '
    || clock_left(v_secs) || '.';
end $$;

/**
 * What a helping puts into the four. Raw food feeds one of them a little; a
 * cooked dish feeds several, and better food feeds them fuller.
 */
create or replace function nourish(p_world uuid, p_uid uuid, p_item text, p_ql double precision)
  returns text language plpgsql as $$
declare v_n jsonb; v_share double precision; v_r record; v_was double precision;
        v_now double precision; v_filled text[] := '{}'; v_all boolean;
begin
  if not exists (select 1 from item_feeds where item = p_item) then return null; end if;
  select nutrition into v_n from player where world_id = p_world and uid = p_uid;
  v_n := coalesce(v_n, '{}'::jsonb);
  v_share := helping_of(p_ql);
  for v_r in select nutrient, amount from item_feeds where item = p_item order by nutrient loop
    v_was := coalesce((v_n->>v_r.nutrient)::double precision, 0);
    v_now := least(1, v_was + v_r.amount * v_share);
    v_n := jsonb_set(v_n, array[v_r.nutrient], to_jsonb(v_now));
    if v_now >= 1 and v_was < 1 then v_filled := v_filled || v_r.nutrient; end if;
  end loop;
  update player set nutrition = v_n where world_id = p_world and uid = p_uid;
  if array_length(v_filled, 1) is null then return null; end if;
  v_all := (select bool_and(coalesce((v_n->>k)::double precision, 0) >= 1)
            from unnest(array['starch', 'flesh', 'fat', 'greens']) k);
  if v_all then
    return 'You could not eat another thing. Everything you do goes in a fifth faster while it lasts.';
  end if;
  return 'That is as much ' || array_to_string(v_filled, ' and ') || ' as you can hold.';
end $$;

/* ------------------------------------------------------------------ *
 * The actions.
 * ------------------------------------------------------------------ */

create or replace function item_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql as $$
declare v_it item; v_what improvable_def; v_mat improve_material_def; v_miss text;
        v_ceiling double precision; v_made text; v_tx int; v_ty int;
begin
  if p_action = 'drink' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    if not has_water(p_world, v_tx, v_ty) then return 'There is no water there.'; end if;
    return null;
  end if;

  select * into v_it from item where id = nullif(p_target->>'uid', '')::bigint
    and world_id = p_world and holder = 'player' and holder_uid = p_uid;
  if not found then return 'It is gone.'; end if;

  if p_action = 'eat' then
    if coalesce((select food from item_def where id = v_it.def), 0) <= 0 then
      return 'That is not food.';
    end if;
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
end $$;

create or replace function perform_item(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare v_it item; v_what improvable_def; v_mat improve_material_def; v_stock item;
        v_made text; v_ceiling double precision; v_tool_ql double precision;
        v_healed double precision; v_lost double precision; v_skill double precision;
        v_favour text; v_full text; v_name text; v_p player;
begin
  if p_action = 'drink' then
    update player set stats = jsonb_set(stats, '{thirst}', '1') where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You drink the cool water. It is refreshing.', 'event');
    return;
  end if;

  select * into v_it from item where id = nullif(p_target->>'uid', '')::bigint;
  if not found then return; end if;
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
    perform skill_raise(p_world, p_uid, v_what.skill, 0.4);
    -- A failed pass marks the piece rather than spoiling it outright. Oak and
    -- the deep metals are stubborn under the file as under the saw.
    if not skill_check(skill_of(p_world, p_uid, v_what.skill),
        12 + v_it.ql / 3 + mat_difficulty(v_it.extra), v_tool_ql) then
      perform damage_item(v_it.id, 3 + random() * 5);
      perform tell(p_world, p_uid, 'You work at the ' || v_name || ' and mark it. (damage '
        || to_char((select dmg from item where id = v_it.id), 'FM990.0') || ')', 'event');
      return;
    end if;
    v_ceiling := least(99.9, improve_ceiling(p_world, p_uid, v_what.skill, v_it.rare));
    update item set ql = greatest(ql, least(v_ceiling,
        ql + improve_step(skill_of(p_world, p_uid, v_what.skill), ql)))
      where id = v_it.id returning * into v_it;
    perform tell(p_world, p_uid, 'The ' || v_name || ' is better than it was. (QL '
      || to_char(v_it.ql, 'FM990.0') || ')', 'event');
  end if;
end $$;

-- The list of what has a performer behind it, four longer.
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
      'place_furniture', 'pick_up_furniture')
      or exists (select 1 from recipe where id = p_action)
$$;

select private.lock_doors();
