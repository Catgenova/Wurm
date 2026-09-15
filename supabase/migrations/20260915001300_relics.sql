-- What the old people left in the ground.
--
-- ## A fragment is a thing that knows what it is a piece of
--
-- Everything else made on this island is one item with a quality on it. A
-- fragment is one of several, and the several only mean anything together:
-- `old lamp 2/3` is the second piece of a three-piece lamp, and until the
-- other two are in the same pack it is a scrap of metal.
--
-- There is no table for that and there does not need to be. The pieces are
-- ordinary rows with the relic and the number written into `extra`, exactly as
-- the browser writes them, and a regex takes them apart again. A relic
-- half-found is a pack with some of the numbers in it.
--
-- ## The ground is kinder than it needs to be
--
-- A turn of the trowel that finds anything finds a piece you are *short* of,
-- if you are short of any. That is not realism; it is the difference between
-- an eight-piece helm being a long afternoon and an eight-piece helm being
-- something nobody ever finishes.

create or replace function dig_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('investigate', 'restore_relic', 'study_book')
$$;

/** How likely a turn of the trowel is to find anything at all. */
create or replace function find_chance(p_skill double precision, p_tool_ql double precision)
  returns double precision language sql immutable as $$
  select least(0.7, 0.14 + (p_skill / 100) * 0.4 + (p_tool_ql / 100) * 0.1)
$$;

/** The relics a given archaeologist would recognise if they turned one up. */
create or replace function relics_within(p_skill double precision) returns setof relic_def
  language sql stable as $$
  select * from relic_def where difficulty <= p_skill + 14 order by difficulty
$$;

/* "old lamp 2/3" on the end of a fragment says what it is a piece of. */
create or replace function fragment_relic(p_extra text) returns text language sql immutable as $$
  select (regexp_match(coalesce(p_extra, ''), '^(.+) ([0-9]+)/([0-9]+)$'))[1]
$$;
create or replace function fragment_part(p_extra text) returns int language sql immutable as $$
  select ((regexp_match(coalesce(p_extra, ''), '^(.+) ([0-9]+)/([0-9]+)$'))[2])::int
$$;

/**
 * Every piece of one relic that is carried, at most one of each.
 *
 * The soundest of any duplicates is the one that goes into the work, which is
 * what `distinct on` is for and what a second copy of piece two is for.
 */
create or replace function pieces_held(p_world uuid, p_uid uuid, p_relic text) returns setof item
  language sql stable as $$
  select distinct on (fragment_part(i.extra)) i.*
  from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    and i.def = 'fragment' and fragment_relic(i.extra) = p_relic
  order by fragment_part(i.extra), i.dmg
$$;

/** Which pieces of a relic are still missing, in order. */
create or replace function parts_missing(p_world uuid, p_uid uuid, p_relic text) returns int[]
  language sql stable as $$
  select coalesce(array_agg(n order by n), '{}') from generate_series(1,
    (select parts from relic_def where name = p_relic)) n
  where not exists (select 1 from pieces_held(p_world, p_uid, p_relic) h
                    where fragment_part(h.extra) = n)
$$;

/* ------------------------------------------------------------------ *
 * The doors.
 * ------------------------------------------------------------------ */

create or replace function dig_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
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

  select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
    and holder = 'player' and holder_uid = p_uid;
  if not found then return 'It is gone.'; end if;

  if p_action = 'study_book' then
    if it.def <> 'book' then return 'That is not a book.'; end if;
    if it.dmg >= 90 then return 'The pages are too far gone to read. Repair it first.'; end if;
    return null;
  end if;

  -- Restoring.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if it.def <> 'fragment' or not found then return 'That is not a fragment of anything.'; end if;
  v_missing := parts_missing(p_world, p_uid, v_relic);
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    return 'You are missing ' || array_length(v_missing, 1) || ' of the ' || r.parts
      || ' pieces of the ' || r.name || ' (' || array_to_string(v_missing, ', ') || ').';
  end if;
  if exists (select 1 from pieces_held(p_world, p_uid, v_relic) h where h.dmg >= 85) then
    return 'One of the pieces is too far gone to join. Repair it first.';
  end if;
  return null;
end $$;

create or replace function perform_dig(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare tx int; ty int; it item; r relic_def; v_skill double precision; v_tool double precision;
        v_part int; v_ql double precision; v_dmg double precision; v_left int; v_new bigint;
        v_missing int[]; v_relic text; v_avg double precision; v_gain double precision;
        /*
         * `v_piece`, not `h`. The seventh time this class has bitten and the
         * first that was not a column name: `h` was the loop variable *and*
         * the alias of `pieces_held(...) h`, so `h.ql` was ambiguous between a
         * record field and a column of the very rows being looped over. Alias
         * every table, prefix every local, and the two can never meet.
         */
        v_piece item;
        v_lectern boolean; v_roll double precision; v_sum double precision;
begin
  if p_action = 'investigate' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    perform mark_foraged(p_world, tx, ty, 'dig');
    v_skill := skill_of(p_world, p_uid, 'archaeology');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    perform skill_raise(p_world, p_uid, 'archaeology', 0.5);
    if random() > find_chance(v_skill, v_tool) then
      perform tell(p_world, p_uid,
        'You go through the soil and turn up nothing but roots and small stones.', 'event');
      return;
    end if;
    if not exists (select 1 from relics_within(v_skill)) then
      perform tell(p_world, p_uid,
        'You turn up a scrap of something worked, but you cannot tell what it was and it crumbles.',
        'event');
      return;
    end if;
    -- The commonplace comes up far more often than the rare, as it did when
    -- it was lost: weighted by difficulty, and the weights are small numbers.
    select sum(1 / (1 + w.difficulty / 12)) into v_sum from relics_within(v_skill) w;
    v_roll := random() * v_sum;
    for r in select * from relics_within(v_skill) loop
      v_roll := v_roll - 1 / (1 + r.difficulty / 12);
      exit when v_roll <= 0;
    end loop;
    -- A piece you are still short of, if you are short of any.
    v_missing := parts_missing(p_world, p_uid, r.name);
    if coalesce(array_length(v_missing, 1), 0) > 0 then
      v_part := v_missing[1 + floor(random() * array_length(v_missing, 1))::int];
    else
      v_part := 1 + floor(random() * r.parts)::int;
    end if;
    v_ql := greatest(1, product_ql(v_skill, v_tool) * (0.55 + random() * 0.35));
    -- Nothing comes out of the ground sound.
    v_dmg := 18 + random() * 50;
    v_new := give(p_world, p_uid, 'fragment', 1, v_ql, r.name || ' ' || v_part || '/' || r.parts);
    update item set dmg = v_dmg where id = v_new;
    v_left := coalesce(array_length(parts_missing(p_world, p_uid, r.name), 1), 0);
    perform tell(p_world, p_uid, 'Your trowel turns up a fragment of ' || r.name || ', piece '
      || v_part || ' of ' || r.parts || '. (QL ' || to_char(v_ql, 'FM990.0')
      || ', damage ' || to_char(v_dmg, 'FM990') || ')'
      || case when v_left > 0 then ' ' || v_left || ' of ' || r.parts || ' still missing.'
              else ' That is all ' || r.parts || ' of them.' end, 'event');
    return;
  end if;

  select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint;
  if not found then return; end if;

  if p_action = 'study_book' then
    -- A lectern holds the pages open at the right angle, and you get twice as
    -- much out of the hour.
    v_lectern := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'furniture'
                           and p.sub = 'lectern' and near_piece(p_world, p_uid, p, 2.6));
    v_gain := skill_raise(p_world, p_uid, 'mind_logic',
      (0.5 + it.ql / 90) * case when v_lectern then 2 else 1 end);
    perform damage_item(it.id, 2 + random() * 3);
    perform tell(p_world, p_uid, 'You work through the ' || lower(item_name(it)) || '.'
      || case when v_lectern
              then ' The lectern holds it open at the right angle and you make good use of the hour.'
              else ' Held in one hand, it is hard going. A lectern would be better.' end
      || case when v_gain > 0.0005 then '' else ' There is nothing left in it you do not already know.' end,
      'event');
    return;
  end if;

  -- Restoring: every piece in at once, and what comes out is only as good as
  -- the pieces that went in, less what age took.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if not found then return; end if;
  if not skill_check(skill_of(p_world, p_uid, 'restoration'), r.difficulty, 0,
                     mind_ease(p_world, p_uid)) then
    for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
      perform damage_item(v_piece.id, 5 + random() * 9);
    end loop;
    perform tell(p_world, p_uid, 'The pieces of the ' || r.name
      || ' will not sit together and you mark them trying.', 'event');
    return;
  end if;
  select avg(h.ql * (1 - h.dmg / 200)) into v_avg from pieces_held(p_world, p_uid, v_relic) h;
  v_ql := greatest(1, least(100, v_avg * (0.72 + skill_of(p_world, p_uid, 'restoration') / 260)));
  for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
    perform consume(p_world, p_uid, 'fragment', 1, v_piece.id);
  end loop;
  v_new := give(p_world, p_uid, r.result, 1, v_ql);
  perform skill_raise(p_world, p_uid, 'mind_logic', 0.4);
  perform tell(p_world, p_uid, 'The pieces go back together and the ' || r.name || ' is whole: '
    || lower((select item_name(i) from item i where i.id = v_new))
    || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
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
      'stow_item', 'empty_bag', 'store_in_furniture', 'furniture_take_all', 'throw_away',
      'upgrade_deed', 'disband_deed', 'rename_deed',
      'place_post', 'pick_up_post', 'assign_post', 'unassign_post',
      'investigate', 'restore_relic', 'study_book')
      or exists (select 1 from recipe where id = p_action)
$$;






select private.lock_doors();
