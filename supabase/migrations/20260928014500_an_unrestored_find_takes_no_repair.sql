/*
 * A find nobody has restored takes no repair, and one that breaks first is gone.
 *
 * Asked for: "Artifacts that have not been restored should not be able to be
 * repaired. If not restored before broken they are gone." A fragment of a
 * relic and a tarnished bauble are what a trowel turns up and a restorer has
 * not had yet (`unrestored`, the browser's `UNRESTORED`), and nothing takes
 * damage off one of them now:
 *
 *   * Repair and a repair kit refuse it (`item_refusal`), and Mend does
 *     (`cast_reason`), in the browser's words (`not_restored_says`);
 *   * a worker mending the stores passes it by for the worst of the rest
 *     (`damaged_in_stores`).
 *
 * Its damage only goes up, from a restoring that fails and from lying out in
 * the weather, and at a hundred `damage_item` and the sweep take it away as
 * they take anything. So Restore no longer refuses one past eighty-five and
 * sends you to repair it first (`dig_refusal`): it is restored as it is, at
 * any damage short of breaking, or not at all. Restored, it is a thing like
 * any other and mends like one.
 *
 * `supabase/test/unrestored.ts` holds the two sides to each other.
 */

/** A find nobody has restored yet, which nothing mends: a fragment of a relic, or a tarnished bauble. */
create or replace function unrestored(p_def text) returns boolean language sql immutable as $fn$
  select p_def in ('fragment', 'tarnished_bauble')
$fn$;

/** Why nothing mends one, in the browser's words (`NOT_RESTORED`). */
create or replace function not_restored_says() returns text language sql immutable as $fn$
  select 'It has not been restored, and nothing repairs it until it is. If it breaks first, it is gone.'::text
$fn$;

CREATE OR REPLACE FUNCTION public.item_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_it item; v_what improvable_def; v_mat improve_material_def; v_miss text;
        v_ceiling double precision; v_made text; v_tx int; v_ty int; v_p player;
begin
  if p_action = 'drink' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    if not has_water(p_world, v_tx, v_ty) then return 'There is no water there.'; end if;
    return null;
  end if;

  -- A Tailor's Patch, before anything is asked of the piece: the browser's order.
  if p_action = 'patch_item' and pk(p_world, p_uid, 'patch_item', 0) <= 0 then
    return 'That wants a Tailor who has learned to patch.';
  end if;
  -- And an Artisan's Glaze, the same way.
  if p_action = 'glaze_item' and pk(p_world, p_uid, 'glaze_item', 0) <= 0 then
    return 'That wants an Artisan who has learned to glaze.';
  end if;
  v_it := carried(p_world, p_uid, target_item(p_target));
  if v_it.id is null then return 'It is gone.'; end if;

  if p_action = 'eat' then
    if coalesce((select food from item_def where id = v_it.def), 0) <= 0 then
      return 'That is not food.';
    end if;
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
    if v_it.locked then return 'You have that one put by.'; end if;
    return null;

  -- A Naturalist's remedies, which anybody who has one may use.
  elsif p_action = 'drink_tea' then
    if coalesce((select stamina from item_def where id = v_it.def), 0) <= 0 then return 'That is not something to drink.'; end if;
    select * into v_p from player where world_id = p_world and uid = p_uid;
    if coalesce((v_p.stats->>'stamina')::double precision, 1) >= 0.999 then return 'You are not tired.'; end if;
    return null;

  elsif p_action = 'take_tincture' then
    if v_it.def <> 'tincture' then return 'That is not a tincture.'; end if;
    return null;

  elsif p_action = 'apply_salve' then
    if v_it.def <> 'salve' then return 'That is not a salve.'; end if;
    perform wounds_settle(p_world, p_uid);
    select * into v_p from player where world_id = p_world and uid = p_uid;
    return salve_refusal(v_p.wounds);

  elsif p_action = 'drink_skin' then
    if coalesce((select drink from item_def where id = v_it.def), 0) <= 0
       or (select charges from item_def where id = v_it.def) is null then
      return 'There is nothing in that to drink.';
    end if;
    if coalesce(v_it.charges, 0) <= 0 then return 'It is empty.'; end if;
    return null;

  elsif p_action = 'repair_item' then
    if unrestored(v_it.def) then return not_restored_says(); end if;
    if v_it.dmg <= 0 then return 'There is nothing wrong with it.'; end if;
    if v_it.ql <= 1 then return 'It is worn away to nothing and will not take another repair.'; end if;
    return null;

  -- A Mender's kit and sealant, which anybody who has one may use, in the browser's words.
  elsif p_action = 'mend_kit' then
    if unrestored(v_it.def) then return not_restored_says(); end if;
    if v_it.dmg <= 0 then return 'There is nothing wrong with it.'; end if;
    if v_it.def = 'repair_kit' then return 'A kit does not mend itself.'; end if;
    if pack_count(p_world, p_uid, 'repair_kit', null) < 1 then return 'You have no repair kit.'; end if;
    return null;

  -- A stone set in an Artisan's circlet, by anybody with a file, in the browser's words.
  elsif p_action = 'set_in_circlet' then
    if v_it.def <> 'gem' or not exists (select 1 from gem_def g where lower(g.name) = lower(v_it.extra)) then
      return 'Only a stone goes in a circlet.';
    end if;
    if (circlet_with_room(p_world, p_uid)).id is null then
      return 'You have no circlet with a setting empty: each takes ' || circlet_stones() || ' stones.';
    end if;
    if tool_ql(p_world, p_uid, 'file') <= 0 then return 'You need a file.'; end if;
    return null;

  elsif p_action = 'glaze_item' then
    if not glazeable(v_it.def) then return 'Only a fired pot, bowl or jar, or an amphora, takes a glaze.'; end if;
    if coalesce(v_it.mark, '{}'::jsonb) ? 'glaze' then return 'It is glazed already.'; end if;
    if pack_count(p_world, p_uid, 'ash', null) < glaze_ash() then return 'You need ashes to make a glaze of.'; end if;
    return null;

  elsif p_action = 'seal_item' then
    if v_it.def = 'sealant' then return 'Sealant does not seal itself.'; end if;
    if coalesce(v_it.mark, '{}'::jsonb) ? 'seal' then return 'It is sealed already.'; end if;
    if pack_count(p_world, p_uid, 'sealant', null) < v_it.count then
      return 'You need ' || v_it.count || ' sealant to seal all ' || v_it.count || ' of them; you have '
        || pack_count(p_world, p_uid, 'sealant', null) || '.';
    end if;
    return null;

  elsif p_action = 'patch_item' then
    if patch_with(v_it.def) is null then return 'Only cloth or leather takes a patch.'; end if;
    if v_it.dmg <= 0 then return 'There is nothing wrong with it.'; end if;
    if pack_count(p_world, p_uid, patch_with(v_it.def), null) < 1 then
      return 'You need ' || patch_with(v_it.def) || ' to patch it with.';
    end if;
    return null;

  elsif p_action = 'improve_item' then
    select * into v_what from improvable_def where item = v_it.def;
    if not found then return 'That is not something you can better.'; end if;
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
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
    -- A quality to stop at, when one was asked for. This refusal is the whole
    -- of "take it to sixty": a repeating job asks before every go and stops
    -- the moment it is told no.
    if (p_target ? 'upto') and v_it.ql >= (p_target->>'upto')::numeric then
      return 'The ' || lower(item_name(v_it)) || ' is at QL '
        || to_char(v_it.ql, 'FM990.0') || ', which is what you asked for.';
    end if;
    return null;

  elsif p_action = 'quench_item' then
    -- A Smith's Temper Bath, in the words the browser uses.
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
    if coalesce((v_it.mark->>'temper')::double precision, 0) <= 0 then return 'There is no quench left in it.'; end if;
    if pk(p_world, p_uid, 'temper:' || v_it.def, 0) <= 0 then return 'That wants a Smith who has learned to temper.'; end if;
    if not water_near(p_world, p_uid) then
      return 'You need water to quench it in: stand at the water, or beside a barrel or a well of it.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.cast_reason(p_world uuid, p_uid uuid, p_cast text, p_uid_item bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d cast_def; it item; faith double precision; have double precision;
begin
  select * into d from cast_def where id = p_cast;
  if not found then return 'Choose what to call for.'; end if;
  faith := skill_of(p_world, p_uid, faith_skill());
  if faith < d.level then
    return d.name || ' takes ' || to_char(d.level, 'FM990') || ' prayer; you have '
      || to_char(faith, 'FM990') || '.';
  end if;
  have := favour_settle(p_world, p_uid);
  if have < d.cost then
    return d.name || ' costs ' || to_char(d.cost, 'FM990') || ' favour; you hold '
      || to_char(floor(have), 'FM990') || '. Pray at an altar.';
  end if;
  if p_uid_item is not null then
    select * into it from item where world_id = p_world and id = p_uid_item
      and holder = 'player' and holder_uid = p_uid;
  end if;
  if d.on_what = 'item' and it.id is null then return 'Choose something to lay it on.'; end if;
  if p_cast = 'mend' and it.id is not null and unrestored(it.def) then return not_restored_says(); end if;
  if p_cast = 'mend' and it.id is not null and it.dmg <= 0 then
    return 'There is nothing wrong with the ' || lower(item_name(it)) || '.';
  end if;
  if p_cast = 'cunning' and it.id is not null then
    if coalesce(it.bless, 0) >= bless_cap() then
      return 'The ' || lower(item_name(it)) || ' has taken all it will take.';
    end if;
    if it.issued then return 'What you washed ashore with has nothing in it to work on.'; end if;
  end if;
  if p_cast = 'call' and not exists (select 1 from creature c where c.world_id = p_world
      and c.mode = 'active' and c.keeper = p_uid) then
    return 'Nothing travels with you.';
  end if;
  if p_cast = 'dawnlight' and jsonb_array_length((select wounds from player
      where world_id = p_world and uid = p_uid)) = 0 then
    return 'Nothing is open on you.';
  end if;
  if p_cast = 'bounty' and (my_deed(p_world, p_uid)).world_id is null then
    return 'You have no settlement, and so no fields.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.damaged_in_stores(p_world uuid, p_uid uuid)
 RETURNS item
 LANGUAGE sql
 STABLE
AS $function$
  select i.* from item i join crate c on c.world_id = i.world_id and c.id = i.crate
  where i.world_id = p_world and i.holder = 'crate' and i.dmg > 1 and not unrestored(i.def)
    and on_my_deed(p_world, p_uid, c.x, c.y)
  order by i.dmg desc limit 1
$function$;

CREATE OR REPLACE FUNCTION public.dig_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; t tile_def; it item; v_relic text; v_missing int[]; r relic_def;
begin
  if p_action = 'investigate' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    if tx is null or not in_bounds(p_world, tx, ty) then return 'There is nothing there.'; end if;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if not t.diggable then return 'There is nothing to go through here.'; end if;
    if has_water(p_world, tx, ty) then return 'Not under water.'; end if;
    if pack_count(p_world, p_uid, 'trowel') < 1 then
      return 'You need a trowel to go through the soil carefully.';
    end if;
    if is_foraged(p_world, tx, ty, 'dig') then
      return 'You have been over this ground already. Try somewhere else.';
    end if;
    return null;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target)
    and holder = 'player' and holder_uid = p_uid;
  if not found then return 'It is gone.'; end if;

  if p_action = 'study_book' then
    if it.def not in ('book', 'trade_book') then return 'That is not a book.'; end if;
    if it.dmg >= 90 then return 'The pages are too far gone to read. Repair it first.'; end if;
    return null;
  end if;

  -- At any damage short of breaking: nothing mends a find before it is restored.
  if it.def = 'tarnished_bauble' then return null; end if;

  -- Restoring.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if it.def <> 'fragment' or not found then return 'That is not a fragment of anything.'; end if;
  v_missing := parts_missing(p_world, p_uid, v_relic);
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    return 'You are missing ' || array_length(v_missing, 1) || ' of the ' || r.parts
      || ' pieces of the ' || r.name || ' (' || array_to_string(v_missing, ', ') || ').';
  end if;
  return null;
end $function$;

select private.lock_doors();
