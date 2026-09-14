-- Bags, bins, chests, and the crate with the rotten bottom.
--
-- ## A thing in a bag is not to hand
--
-- This is the whole of why bags did not come with the rest of the pack three
-- commits ago. The browser keeps a bag's contents out of the inventory list
-- entirely, so a recipe that wants two planks cannot see the two in your
-- satchel — and making that true down here looked like teaching every question
-- the island asks of a pack to skip what is inside something. Fifty-odd
-- places, of which `consume`, `pack_count` and `tool_ql` are only the obvious
-- three, and half of that is worse than none: a bag you can put things into
-- and then cannot craft with, and no message saying why.
--
-- The way through was to stop trying. Every one of those fifty queries already
-- says `holder = 'player'`, so a stowed thing simply stops being held by the
-- player: `holder` becomes 'bag' and `inside` says which one. Nothing had to
-- learn anything. The schema had been spelling out 'player', 'ground',
-- 'crate', 'bag' in a comment since the first migration, and the last of the
-- four had never been used.
--
-- ## And the read policy did not need to recurse
--
-- The reason to fear this was row level security: a policy on `item` that has
-- to ask whether the *bag* belongs to you is a policy on `item` that queries
-- `item`, which recurses. It never needed to ask. A thing in your satchel
-- keeps your `holder_uid` — it is still yours, it is only not to hand — so the
-- policy is a column test like every other.

/** What a thing in a chest or a bin is standing in. */
alter table item add column if not exists placed bigint references placed (id) on delete cascade;
create index if not exists item_in_furniture on item (world_id, placed) where holder = 'furniture';
create index if not exists item_in_bag on item (inside) where holder = 'bag';

/** Your own pack, what is in your own bags, the ground, and the island's stores. */
drop policy if exists item_read on item;
create policy item_read on item for select to authenticated using (
  (holder = 'player' and holder_uid = (select auth.uid()))
  or (holder = 'bag' and holder_uid = (select auth.uid()))
  or holder = 'ground'
  or (holder = 'crate' and private.on_island(world_id))
  or (holder = 'furniture' and private.on_island(world_id))
);

create or replace function holding_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('stow_item', 'empty_bag', 'store_in_furniture',
                      'furniture_take_all', 'throw_away')
$$;

/**
 * Move part of a stack somewhere else, splitting it when it is only part.
 *
 * A whole stack keeps its own number; a part of one gets a new row, because
 * two halves of a stack in two places are two things. And it merges into a
 * matching stack where there is one, which is what stops a satchel filling up
 * with eleven separate rows of nail.
 */
create or replace function move_part(p_item bigint, p_count int, p_holder text,
    p_uid uuid, p_inside bigint, p_placed bigint) returns bigint
  language plpgsql as $$
declare it item; v_new bigint; v_stack item;
begin
  select * into it from item where id = p_item for update;
  if not found or p_count <= 0 or p_count > it.count then return null; end if;

  -- Somewhere to merge into, if the thing stacks at all.
  if coalesce((select stackable from item_def where id = it.def), false) then
    select * into v_stack from item o
    where o.world_id = it.world_id and o.holder = p_holder and o.id <> it.id
      and o.inside is not distinct from p_inside and o.placed is not distinct from p_placed
      and o.def = it.def and o.extra is not distinct from it.extra
      and o.rare is not distinct from it.rare and o.dye is not distinct from it.dye
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
                    extra, rare, dye, bless, charges, locked)
  values (it.world_id, p_holder, p_uid, p_inside, p_placed, it.def, it.ql, it.dmg, p_count,
          it.extra, it.rare, it.dye, it.bless, it.charges, false)
  returning id into v_new;
  return v_new;
end $$;

/* ------------------------------------------------------------------ *
 * Bags.
 * ------------------------------------------------------------------ */

/** How many a bag takes, or nothing at all for the things that are not bags. */
create or replace function bag_room(p_def text) returns int language sql stable as $$
  select coalesce((select round(holds)::int from item_def where id = p_def), 0)
$$;

create or replace function is_bag(p_def text) returns boolean language sql stable as $$
  select bag_room(p_def) > 0
$$;

create or replace function bag_units(p_bag bigint) returns int language sql stable as $$
  select coalesce(sum(count), 0)::int from item where inside = p_bag and holder = 'bag'
$$;

/**
 * Why a bag will not take something, or null.
 *
 * Nothing that holds things may go inside something else that holds things:
 * that way lies a bag inside a bag inside a bag and a weight nobody can work
 * out — which is also why `item_weight` only has to look one level down.
 */
create or replace function bag_refuses(p_bag item, p_def text, p_count int) returns text
  language sql stable as $$
  select case
    when not is_bag(p_bag.def) then 'A ' || lower((select name from item_def where id = p_bag.def))
      || ' does not hold things.'
    when is_bag(p_def) then 'One bag will not go inside another.'
    when bag_units(p_bag.id) + p_count > bag_room(p_bag.def) then
      'The ' || lower((select name from item_def where id = p_bag.def)) || ' is full.'
    end
$$;

/** The first bag in the pack with room for this. */
create or replace function first_bag(p_world uuid, p_uid uuid, p_def text, p_count int) returns item
  language sql stable as $$
  select b.* from item b
  where b.world_id = p_world and b.holder = 'player' and b.holder_uid = p_uid
    and is_bag(b.def) and bag_refuses(b, p_def, p_count) is null
  order by b.id
  limit 1
$$;

/* ------------------------------------------------------------------ *
 * Chests, bins and the trash crate.
 * ------------------------------------------------------------------ */

create or replace function furniture_units(p placed) returns int language sql stable as $$
  select coalesce(sum(count), 0)::int from item where placed = p.id and holder = 'furniture'
$$;

/** What it holds: its build, and a hive's own combs count the same way. */
create or replace function furniture_capacity(p placed) returns int language sql stable as $$
  select coalesce((select round(coalesce(capacity, hive, 0))::int from furniture_def where id = p.sub), 0)
$$;

/** Why a piece will not take something, or null if it will. */
create or replace function furniture_refuses(p placed, p_def text) returns text
  language sql stable as $$
  select case
    when holds_liquid(p) then v.it || ' holds liquid and nothing else.'
    when d.hive is not null then v.it || ' is the swarm''s, not yours. Take what is in it; do not put anything back.'
    when coalesce(d.capacity, 0) = 0 then v.it || ' does not hold things.'
    when d.bulk and not coalesce((select stackable from item_def where id = p_def), false) then
      'A bulk bin takes bulk: things that stack, by the pile.'
    end
  from furniture_def d
  cross join lateral (select case when lower(d.name) ~ '^[aeiou]' then 'An ' else 'A ' end
                        || lower(d.name) as it) v
  where d.id = p.sub
$$;

/** The thing beside you that will take this, the roomiest first. */
create or replace function nearest_store(p_world uuid, p_uid uuid, p_def text, p_count int)
  returns placed language sql stable as $$
  select p.* from placed p
  where p.world_id = p_world and p.kind = 'furniture'
    and near_piece(p_world, p_uid, p, 2.6)
    and furniture_refuses(p, p_def) is null
    and furniture_units(p) + p_count <= furniture_capacity(p)
  order by furniture_capacity(p) desc, p.id
  limit 1
$$;

/** The trash crate you are standing beside, if there is one. */
create or replace function trash_near(p_world uuid, p_uid uuid) returns placed
  language sql stable as $$
  select p.* from placed p
  where p.world_id = p_world and p.kind = 'furniture'
    and coalesce((select trash from furniture_def where id = p.sub), 0) > 0
    and near_piece(p_world, p_uid, p, 3)
  order by p.id limit 1
$$;

/* ------------------------------------------------------------------ *
 * The doors.
 * ------------------------------------------------------------------ */

create or replace function holding_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare it item; p placed; v_bag item; v_want int; v_why text; v_other placed;
begin
  if p_action in ('furniture_take_all') then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found then return 'It is gone.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to it.'; end if;
    if furniture_units(p) = 0 then return 'It is empty.'; end if;
    return null;
  end if;

  select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
    and holder = 'player' and holder_uid = p_uid;
  if not found then return 'It is gone.'; end if;
  v_want := greatest(1, least(coalesce((p_target->>'count')::int, 1), it.count));

  if p_action = 'stow_item' then
    if is_bag(it.def) then return 'One bag will not go inside another.'; end if;
    if (first_bag(p_world, p_uid, it.def, v_want)).id is null then
      return 'There is no bag with room for it.';
    end if;

  elsif p_action = 'empty_bag' then
    if not is_bag(it.def) then return 'That does not hold things.'; end if;
    if bag_units(it.id) = 0 then return 'There is nothing in it.'; end if;

  elsif p_action = 'store_in_furniture' then
    p := nearest_store(p_world, p_uid, it.def, v_want);
    if p.id is null then
      -- Say why the thing beside you will not take it, rather than that
      -- nothing will: standing at a barrel with a plank, "a barrel holds
      -- liquid and nothing else" is the answer somebody wanted.
      for v_other in select o.* from placed o
        where o.world_id = p_world and o.kind = 'furniture' and near_piece(p_world, p_uid, o, 2.6)
        order by furniture_capacity(o) desc, o.id
      loop
        v_why := furniture_refuses(v_other, it.def);
        if v_why is not null then return v_why; end if;
        if furniture_units(v_other) + v_want > furniture_capacity(v_other) then
          return 'The ' || lower(placed_name(v_other)) || ' is full.';
        end if;
      end loop;
      return 'Stand next to something that will take it.';
    end if;

  elsif p_action = 'throw_away' then
    p := trash_near(p_world, p_uid);
    if p.id is null then return 'There is no trash crate beside you.'; end if;
    if furniture_units(p) + v_want > furniture_capacity(p) then
      return 'The trash crate is full. Wait for it to rot down.';
    end if;
  end if;
  return null;
end $$;

create or replace function perform_holding(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare it item; p placed; v_bag item; v_want int; v_moved bigint; v_names text; v_n int;
begin
  if p_action = 'furniture_take_all' then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select string_agg(case when q.count > 1 then q.count || ' × ' || lower(item_name(q))
                           else lower(item_name(q)) end, ', ' order by q.id), count(*)
      into v_names, v_n
      from item q where q.placed = p.id and q.holder = 'furniture';
    if v_n = 0 then return; end if;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where placed = p.id and holder = 'furniture';
    perform tell(p_world, p_uid, 'You take ' || v_names || ' out of the '
      || lower(placed_name(p)) || '.', 'event');
    return;
  end if;

  select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
    and holder = 'player' and holder_uid = p_uid;
  if not found then return; end if;
  v_want := greatest(1, least(coalesce((p_target->>'count')::int, 1), it.count));

  if p_action = 'stow_item' then
    v_bag := first_bag(p_world, p_uid, it.def, v_want);
    if v_bag.id is null then return; end if;
    v_moved := move_part(it.id, v_want, 'bag', p_uid, v_bag.id, null);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, 'You put '
      || case when v_want > 1 then v_want || ' × ' else '' end || lower(item_name(it))
      || ' in the ' || lower((select name from item_def where id = v_bag.def)) || '.', 'event');

  elsif p_action = 'empty_bag' then
    select count(*) into v_n from item where inside = it.id and holder = 'bag';
    -- Back through `move_part` rather than a bare update, so what comes out
    -- merges into the stack it left rather than sitting beside it.
    for v_bag in select * from item where inside = it.id and holder = 'bag' order by id loop
      perform move_part(v_bag.id, v_bag.count, 'player', p_uid, null, null);
    end loop;
    perform tell(p_world, p_uid, 'You turn the '
      || lower((select name from item_def where id = it.def)) || ' out: ' || v_n
      || case when v_n = 1 then ' thing' else ' things' end || ' back in your pack.', 'event');

  elsif p_action = 'store_in_furniture' then
    p := nearest_store(p_world, p_uid, it.def, v_want);
    if p.id is null then return; end if;
    v_moved := move_part(it.id, v_want, 'furniture', null, null, p.id);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, 'You put '
      || case when v_want > 1 then v_want || ' × ' else 'the ' end || lower(item_name(it))
      || ' in the ' || lower(placed_name(p)) || '.', 'event');

  elsif p_action = 'throw_away' then
    p := trash_near(p_world, p_uid);
    if p.id is null then return; end if;
    v_moved := move_part(it.id, v_want, 'furniture', null, null, p.id);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, 'You throw '
      || case when v_want > 1 then v_want || ' × ' else 'the ' end || lower(item_name(it))
      || ' in the trash crate. It will not last long in there.', 'event');
  end if;
end $$;

/* ------------------------------------------------------------------ *
 * A plural the port got wrong.
 * ------------------------------------------------------------------ */

/**
 * How many of a thing, said the way somebody would say it.
 *
 * The port put an 's' on the end whenever there was more than one, which is
 * how a recipe came to ask for "8 nailss". The browser is careful about it in
 * two ways this was not: only a thing that *stacks* takes a plural at all, and
 * a name that already ends in an s is left alone. Found by a bag test that had
 * nothing to do with nails, which is the usual way.
 */
create or replace function plural_of(p_item text, p_n int) returns text
  language sql stable as $$
  select case when p_n = 1 or not coalesce(d.stackable, false) or lower(d.name) like '%s'
              then lower(d.name) else lower(d.name) || 's' end
  from item_def d where d.id = p_item
$$;

create or replace function craft_refusal(p_world uuid, p_uid uuid, p_recipe text, p_prefer bigint)
  returns text language plpgsql stable as $$
declare r recipe; i record; mat text; have int;
begin
  select * into r from recipe where id = p_recipe;
  if not found then return null; end if;
  if r.tool is not null and tool_ql(p_world, p_uid, r.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, r.tool) from item_def where id = r.tool)) || '.';
  end if;
  if r.station is not null and not at_station(p_world, p_uid, r.station) then
    return 'You need to stand at a ' || station_name(r.station) || '.';
  end if;
  mat := craft_material(p_world, p_uid, p_recipe, p_prefer);
  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    have := greatest(pack_count(p_world, p_uid, i.item, mat), pack_count(p_world, p_uid, i.item));
    if have < i.count then
      return (select coalesce(name, r.result) from item_def where id = r.result)
        || ' takes ' || i.count || ' ' || plural_of(i.item, i.count) || '.';
    end if;
  end loop;
  return null;
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
      'place_anvil', 'pick_up_anvil', 'smith',
      'stow_item', 'empty_bag', 'store_in_furniture', 'furniture_take_all', 'throw_away')
      or exists (select 1 from recipe where id = p_action)
$$;




select private.lock_doors();
