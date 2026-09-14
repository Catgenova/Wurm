-- What a pair of hands does to what is lying about.
--
-- ## The island could put things down and nobody could pick them up
--
-- A felling leaves two logs at the stump. A butcher leaves what it could not
-- carry. Anything that dies leaves a carcass, a crate that is taken up tips
-- its contents out where it stood, and a settlement that disbands tips out
-- everything in it. All of that has been landing on the ground for eight
-- commits, and until this one the only two things on the island that could
-- pick any of it up again were a hunter and a middun. A player walked over it.
--
-- So: the ground, and the four things you do to what is in your hands —
-- look at it, put it down, set it aside, and call it something.

/* A name written on a thing that stands about, rather than on the ground. */
alter table placed add column if not exists name text;

create or replace function hands_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('pick_up', 'pick_up_all', 'drop', 'examine', 'examine_item',
                      'lock_item', 'unlock_item', 'name_thing')
$$;

/* ------------------------------------------------------------------ *
 * What a thing is called, and what it weighs.
 * ------------------------------------------------------------------ */

/**
 * The whole name of a thing.
 *
 * Colour first, then rarity, then the thing itself, then what it is made of
 * and what is left in it: a Blue supreme cloth tunic reads the way somebody
 * would actually say it, and a waterskin says how much is in it without being
 * asked.
 */
create or replace function item_name(it item) returns text language sql stable as $$
  select case when w.words = '' then d.name
              else upper(left(w.words, 1)) || substr(w.words, 2) || ' ' || lower(d.name) end
      || coalesce(' (' || lower(it.extra) || ')', '')
      || case when d.charges is null then ''
              else ' (' || coalesce(it.charges, 0)::text || '/' || d.charges::text || ')' end
  from item_def d
  cross join lateral (select btrim(concat_ws(' ',
      (select y.word from dye_def y where y.id = it.dye), it.rare)) as words) w
  where d.id = it.def
$$;

/** What one of a thing weighs: its make, and what it is made of. */
create or replace function unit_weight(it item) returns double precision language sql stable as $$
  select (select weight from item_def where id = it.def) * (mat_of(it.extra)).weight
$$;

/**
 * And what the whole stack weighs, with everything inside it.
 *
 * One level deep and no more, because nothing that holds things may go inside
 * something else that holds things — that way lies a bag inside a bag inside a
 * bag and a weight nobody can work out.
 */
create or replace function item_weight(it item) returns double precision language sql stable as $$
  select unit_weight(it) * it.count
       + coalesce((select sum(unit_weight(i) * i.count) from item i where i.inside = it.id), 0)
$$;

/* ------------------------------------------------------------------ *
 * Looking at things.
 * ------------------------------------------------------------------ */

/** What a thing says about itself when you turn it over in your hands. */
create or replace function examine_item_text(p_world uuid, p_uid uuid, it item)
  returns text language plpgsql stable as $$
declare d item_def; m material_def; r rarity_def; v_worth double precision;
        v_skill text; v_out text;
begin
  select * into d from item_def where id = it.def;
  m := mat_of(it.extra);
  select * into r from rarity_def where id = it.rare;
  v_worth := tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless);

  v_out := item_name(it) || ': QL ' || to_char(it.ql, 'FM990.00')
    || ', damage ' || to_char(it.dmg, 'FM990.00')
    || ', weight ' || to_char(item_weight(it), 'FM990.00') || ' kg.';
  -- What it is worth at the work now, which is rarely the number stamped on it.
  if d.category = 'tool' and abs(v_worth - it.ql) >= 0.05 then
    v_out := v_out || ' It works as a ' || to_char(v_worth, 'FM990.0') || ' today.';
  end if;
  if d.description is not null then v_out := v_out || ' ' || d.description; end if;
  if r.id is not null then
    v_out := v_out || ' It is ' || r.id || ': better at what it is for by a '
      || case when r.boost > 1.3 then 'half' when r.boost > 1.15 then 'quarter' else 'tenth' end
      || ', slower to wear and to rot, and can be bettered ' || to_char(r.ceiling, 'FM990')
      || ' past your own skill.';
  end if;
  v_skill := boon_of((select seed from world where id = p_world), it.def);
  if v_skill is not null then
    v_out := v_out || ' It favours '
      || lower((select coalesce(name, v_skill) from skill_def where id = v_skill)) || '.';
  end if;
  -- What it is made of is half of what it is, so it is said here.
  if m.name is not null then v_out := v_out || ' ' || m.name || ': ' || m.note; end if;
  return v_out;
end $$;

/** And what a tile says, which is most of what a map would have told you. */
create or replace function examine_tile_text(p_world uuid, p_x int, p_y int)
  returns text language plpgsql stable as $$
declare v_t int; v_data int; v_out text; v_extra text := ''; b building; n int;
begin
  v_t := land_tile(p_world, p_x, p_y);
  v_data := land_data(p_world, p_x, p_y);
  if v_t = (select id from tile_def where name = 'Tree') then
    v_out := 'You see a '
      || (array['young', 'mature', 'old'])[least(3, greatest(1, tree_age(v_data) + 1))]
      || ' ' || lower((select name from tree_def where id = tree_species(v_data)))
      || ' tree at (' || p_x || ', ' || p_y || ').';
  elsif v_t = (select id from tile_def where name = 'Bush') then
    v_out := 'You see a ' || lower((select name from bush_def where id = bush_species(v_data)))
      || ' at (' || p_x || ', ' || p_y || ').';
  else
    v_out := 'You see ' || lower((select name from tile_def where id = v_t))
      || ' at (' || p_x || ', ' || p_y || ').';
  end if;
  v_out := v_out || ' Height ' || to_char(centre_height(p_world, p_x, p_y), 'FM990.0')
    || ', slope ' || tile_slope(p_world, p_x, p_y) || '.';
  if has_water(p_world, p_x, p_y) then v_out := v_out || ' Water laps over it.'; end if;

  if is_token(p_world, p_x, p_y) then
    v_extra := v_extra || ' The settlement token of '
      || (select name from deed where world_id = p_world) || ' stands here.';
  elsif on_deed(p_world, p_x, p_y) then
    v_extra := v_extra || ' This is part of ' || (select name from deed where world_id = p_world) || '.';
  end if;
  b := building_at(p_world, p_x, p_y);
  if b.id is not null then
    v_extra := v_extra || ' It belongs to ' || b.name || ', '
      || case when b.levels = 1 then 'a single-storey building'
              else b.levels || ' storeys tall' end || '.';
  end if;
  select count(*) into n from crate c where c.world_id = p_world
    and p_x between c.x and c.x + c.sx - 1 and p_y between c.y and c.y + c.sy - 1;
  if n = 1 then v_extra := v_extra || ' A crate stands here.';
  elsif n > 1 then v_extra := v_extra || ' ' || n || ' crates stand here.'; end if;
  return v_out || v_extra;
end $$;

/* ------------------------------------------------------------------ *
 * The ground.
 * ------------------------------------------------------------------ */

/** How far a sweep of the ground reaches: the tile you are on and its neighbours. */
create or replace function sweep_range() returns int language sql immutable as $$ select 1 $$;

/** How many loose things are lying within reach of a spot. */
create or replace function sweepable(p_world uuid, p_x int, p_y int) returns int
  language sql stable as $$
  select count(*)::int from item i
  where i.world_id = p_world and i.holder = 'ground'
    and abs(i.gx - p_x) <= sweep_range() and abs(i.gy - p_y) <= sweep_range()
$$;

/**
 * What a heap of things is called, counted up by kind and read out.
 *
 * Deliberately the plain name rather than the whole one: a sweep says "3 ×
 * log" where picking one thing up says "2 × log (oak)". That is the browser's
 * own inconsistency and it is kept, because a port that tidies up as it goes
 * is a port nobody can check against the thing it came from.
 */
create or replace function pile_text(p_ids bigint[]) returns text language sql stable as $$
  select string_agg(case when n > 1 then n || ' × ' || nm else nm end, ', ' order by nm)
  from (select lower((select coalesce(d.name, i.def) from item_def d where d.id = i.def)) as nm,
               sum(i.count) as n
        from item i where i.id = any(p_ids) group by 1) q
$$;

/* ------------------------------------------------------------------ *
 * The doors.
 * ------------------------------------------------------------------ */

create or replace function hands_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare it item; v_x int; v_y int; d action_def; p player;
begin
  if p_action in ('drop', 'examine_item', 'lock_item', 'unlock_item') then
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
      and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    if p_action = 'drop' then
      if it.def = 'dirt' then return 'Dirt goes back in a hole, not on the grass.'; end if;
      if it.locked then return 'You have set that aside. Put it back in the pack first.'; end if;
    elsif p_action = 'lock_item' and it.locked then
      return 'That is already set aside.';
    elsif p_action = 'unlock_item' and not it.locked then
      return 'That is not set aside.';
    end if;
    return null;
  end if;

  if p_action in ('pick_up', 'pick_up_all', 'examine') then
    v_x := (p_target->>'x')::int; v_y := (p_target->>'y')::int;
    if v_x is null or v_y is null then return 'There is nothing there.'; end if;
    if not in_bounds(p_world, v_x, v_y) then return 'That is off the edge of the world.'; end if;
    -- These three answer for their own reach, because the dispatcher sends a
    -- hands action here before it has asked how far away anything is.
    select * into d from action_def where id = p_action;
    select * into p from player where world_id = p_world and uid = p_uid;
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then
      return 'You are too far away from that.';
    end if;
    if p_action = 'pick_up' and not exists (select 1 from item i where i.world_id = p_world
         and i.holder = 'ground' and i.gx = v_x and i.gy = v_y) then
      return 'There is nothing there any more.';
    end if;
    if p_action = 'pick_up_all' and sweepable(p_world, v_x, v_y) = 0 then
      return 'There is nothing lying about here.';
    end if;
    return null;
  end if;

  if p_action = 'name_thing' then
    if p_target->>'kind' = 'crate' then
      if not exists (select 1 from crate where world_id = p_world and id = (p_target->>'id')::int) then
        return 'That is not there any more.';
      end if;
    elsif p_target->>'kind' = 'furniture' then
      if not exists (select 1 from placed where world_id = p_world and id = (p_target->>'id')::bigint
                       and kind = 'furniture') then
        return 'That is not there any more.';
      end if;
    else
      return 'That is not something that takes a name.';
    end if;
    return null;
  end if;
  return null;
end $$;

create or replace function perform_hands(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare it item; p player; v_x int; v_y int; v_want int; v_name text; v_was text;
        v_took bigint[]; v_row record; v_left int;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'examine' then
    perform tell(p_world, p_uid,
      examine_tile_text(p_world, (p_target->>'x')::int, (p_target->>'y')::int), 'event');

  elsif p_action = 'examine_item' then
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint;
    if found then perform tell(p_world, p_uid, examine_item_text(p_world, p_uid, it), 'event'); end if;

  elsif p_action = 'lock_item' or p_action = 'unlock_item' then
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
      and holder = 'player' and holder_uid = p_uid;
    if not found then return; end if;
    update item set locked = (p_action = 'lock_item') where id = it.id;
    if p_action = 'lock_item' then
      perform tell(p_world, p_uid, 'You set the ' || lower(item_name(it))
        || ' aside. Nothing will spend it, drop it or feed it away until you say so.', 'info');
    else
      perform tell(p_world, p_uid, 'The ' || lower(item_name(it)) || ' is fair game again.', 'info');
    end if;

  elsif p_action = 'drop' then
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
      and holder = 'player' and holder_uid = p_uid;
    if not found then return; end if;
    v_want := least(greatest(1, coalesce((p_target->>'count')::int, 1)), it.count);
    if v_want >= it.count then
      -- The whole stack goes down as it stands, keeping its own number.
      update item set holder = 'ground', holder_uid = null, gx = floor(p.x)::int, gy = floor(p.y)::int,
          locked = false, made_at = now()
        where id = it.id;
    else
      update item set count = it.count - v_want where id = it.id;
      perform drop_on_ground(p_world, floor(p.x)::int, floor(p.y)::int, it.def, it.ql, it.extra, v_want);
    end if;
    perform tell(p_world, p_uid, 'You drop '
      || case when v_want > 1 then v_want || ' × ' || lower(item_name(it))
              else 'the ' || lower(item_name(it)) end
      || ' on the ground.', 'event');
    perform land_announce(p_world, floor(p.x)::int, floor(p.y)::int);

  elsif p_action = 'pick_up' then
    v_x := (p_target->>'x')::int; v_y := (p_target->>'y')::int;
    -- A named thing if the target says which; otherwise whatever is on top,
    -- which is how a pile answers when nobody has said.
    select * into it from item where world_id = p_world and holder = 'ground'
      and gx = v_x and gy = v_y
      and (p_target->>'uid' is null or id = (p_target->>'uid')::bigint)
      order by id limit 1;
    if not found then return; end if;
    update item set holder = 'player', holder_uid = p_uid, gx = null, gy = null where id = it.id;
    perform tell(p_world, p_uid, 'You pick up ' ||
      case when it.count > 1 then it.count || ' × ' else '' end || lower(item_name(it)) || '.', 'event');
    perform land_announce(p_world, v_x, v_y);

  elsif p_action = 'pick_up_all' then
    v_x := (p_target->>'x')::int; v_y := (p_target->>'y')::int;
    /*
     * Nearest first, because a sweep that fills your hands should fill them
     * with what is under your feet rather than what is furthest away.
     */
    for v_row in select i.id, i.gx, i.gy from item i
      where i.world_id = p_world and i.holder = 'ground'
        and abs(i.gx - v_x) <= sweep_range() and abs(i.gy - v_y) <= sweep_range()
      order by (i.gx - v_x) ^ 2 + (i.gy - v_y) ^ 2, i.id
    loop
      update item set holder = 'player', holder_uid = p_uid, gx = null, gy = null where id = v_row.id;
      v_took := v_took || v_row.id;
      perform land_announce(p_world, v_row.gx, v_row.gy);
    end loop;
    if v_took is null then
      perform tell(p_world, p_uid, 'There is nothing lying about here.', 'error');
    else
      perform tell(p_world, p_uid, 'You gather up ' || pile_text(v_took) || '.', 'event');
    end if;

  elsif p_action = 'name_thing' then
    v_name := left(btrim(coalesce(p_target->>'name', '')), 28);
    if p_target->>'kind' = 'crate' then
      select coalesce(c.name, crate_name(c)) into v_was from crate c
        where c.world_id = p_world and c.id = (p_target->>'id')::int;
      update crate set name = nullif(v_name, '')
        where world_id = p_world and id = (p_target->>'id')::int;
    else
      select coalesce(pl.name, (select f.name from furniture_def f where f.id = pl.sub))
        into v_was from placed pl
        where pl.world_id = p_world and pl.id = (p_target->>'id')::bigint;
      update placed set name = nullif(v_name, '')
        where world_id = p_world and id = (p_target->>'id')::bigint;
    end if;
    if v_name = '' then
      -- An empty answer takes the name off again rather than leaving a blank.
      perform tell(p_world, p_uid, 'It goes back to being what it was.', 'info');
    else
      perform tell(p_world, p_uid, 'The ' || lower(coalesce(v_was, 'thing'))
        || ' is called ' || v_name || ' from now on.', 'info');
    end if;
  end if;
end $$;

/* ------------------------------------------------------------------ *
 * What "set aside" actually stops.
 * ------------------------------------------------------------------ */

/**
 * Locking is only a word until the two functions that spend things read it.
 *
 * The browser states the rule in a line worth keeping exactly: `find`,
 * `consume` and `count` look past a locked thing while `has`, `get` and `tool`
 * do not — you can still *work* with a locked hatchet, nothing will quietly
 * eat it. So these two learn to skip one, and `tool_ql` deliberately does not.
 *
 * `give` is left as it is, and that is a decision rather than an oversight:
 * the browser merges a new stack into a matching one without looking at the
 * lock, so three planks made beside twenty set aside become twenty-three set
 * aside. It is a quirk, and a port that quietly improves on the thing it is
 * porting is a port you can no longer check.
 */
create or replace function pack_count(p_world uuid, p_uid uuid, p_item text, p_mat text default null)
  returns int language sql stable as $$
  select coalesce(sum(i.count), 0)::int from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    and i.def = p_item and not i.locked
    and (p_mat is null or i.extra is not distinct from p_mat)
$$;

create or replace function consume(p_world uuid, p_uid uuid, p_item text, p_n int,
                                   p_prefer bigint default null, p_mat text default null)
  returns boolean language plpgsql as $$
declare left_to_take int := p_n; r record; take int; only_mat boolean;
begin
  only_mat := p_mat is not null and pack_count(p_world, p_uid, p_item, p_mat) >= p_n;
  if pack_count(p_world, p_uid, p_item, case when only_mat then p_mat end) < p_n then return false; end if;
  for r in
    select i.id, i.count from item i
    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = p_item
      and not i.locked
      and (not only_mat or i.extra is not distinct from p_mat)
    order by (i.id = p_prefer) desc, i.id
  loop
    exit when left_to_take <= 0;
    take := least(left_to_take, r.count);
    if take >= r.count then delete from item where id = r.id;
    else update item set count = count - take where id = r.id; end if;
    left_to_take := left_to_take - take;
  end loop;
  return left_to_take = 0;
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
      'lock_item', 'unlock_item', 'name_thing')
      or exists (select 1 from recipe where id = p_action)
$$;

select private.lock_doors();
