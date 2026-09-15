-- The settlement you keep, and the posts you drive about it.
--
-- ## A post is the seventh thing that will not sit still, and the first that dies
--
-- A fire burns down, a crop comes on, a well fills, a candle burns while it is
-- lit, a creature walks, a wound drains. All of them settle to a number. A work
-- post settles to a number too — it is a stake in open ground with nothing
-- holding it up, and it rots where it stands, half an hour for a rough one and
-- three hours for the best that can be made — but when that number reaches a
-- hundred the post is *gone*, and whoever was working out of it comes home.
--
-- So `post_settle` is the first settling that deletes a row, and it has to be
-- called before anything asks a post a question. A post nobody has looked at
-- for a day is not a post standing at 100 damage; it is not there.

/** How far gone a thing standing about is. */
alter table placed add column if not exists dmg real not null default 0;
/** The post a worker takes its orders from, when it is not the settlement. */
alter table creature add column if not exists post bigint;

create or replace function settlement_action(p_action text) returns boolean
  language sql immutable as $$
  select p_action in ('upgrade_deed', 'disband_deed', 'rename_deed',
                      'place_post', 'pick_up_post', 'assign_post', 'unassign_post')
$$;

/* ------------------------------------------------------------------ *
 * The settlement.
 * ------------------------------------------------------------------ */

create or replace function max_deed_level() returns int language sql immutable as $$ select 5 $$;

/**
 * What each level beyond the first asks for.
 *
 * Upgrades are taken in order, so each level's own requirement is the new
 * thing the settlement has to show; everything the levels below wanted is
 * already standing.
 */
create or replace function upgrade_wants(p_world uuid, p_level int)
  returns table (label text, met boolean) language plpgsql stable as $$
declare dd deed;
begin
  select * into dd from deed where world_id = p_world;
  if not found then return; end if;
  if p_level = 2 then
    label := 'a crate on the deed';
    met := exists (select 1 from crate c where c.world_id = p_world and on_deed(p_world, c.x, c.y));
    return next;
    label := 'a campfire on the deed';
    met := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'campfire'
                     and on_deed(p_world, p.x, p.y));
    return next;
  elsif p_level = 3 then
    label := 'a stone smelter on the deed';
    met := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'smelter'
                     and on_deed(p_world, p.x, p.y));
    return next;
  elsif p_level = 4 then
    label := 'an anvil set down on the deed';
    met := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'anvil'
                     and on_deed(p_world, p.x, p.y));
    return next;
  elsif p_level = 5 then
    label := 'a building with every ground-floor wall up';
    met := exists (select 1 from building b
                   where b.world_id = p_world and level_complete(p_world, b.id, 0)
                     and exists (select 1 from building_tile t where t.world_id = p_world
                                   and t.building = b.id and on_deed(p_world, t.x, t.y)));
    return next;
    label := '3 wildermon working the deed';
    met := workers_on_deed(p_world) >= 3;
    return next;
  end if;
end $$;

/** Why the settlement cannot be upgraded right now, or null. */
create or replace function upgrade_reason(p_world uuid) returns text
  language plpgsql stable as $$
declare dd deed; v_next int; v_missing text;
begin
  select * into dd from deed where world_id = p_world;
  if not found then return 'You have no settlement.'; end if;
  if dd.level >= max_deed_level() then
    return dd.name || ' is as grand as a settlement gets.';
  end if;
  v_next := dd.level + 1;
  select string_agg(w.label, ', ' order by w.label) into v_missing
    from upgrade_wants(p_world, v_next) w where not w.met;
  if v_missing is not null then return 'Still wanted: ' || v_missing || '.'; end if;
  return null;
end $$;

/* ------------------------------------------------------------------ *
 * The posts.
 * ------------------------------------------------------------------ */

/** Half an hour at the roughest, three hours at the finest. */
create or replace function post_life(p_ql double precision) returns double precision
  language sql immutable as $$
  select 30 * 60 + ((least(100, greatest(1, p_ql)) - 1) / 99) * (3 * 60 * 60 - 30 * 60)
$$;

/** Damage it takes a second, which is the same thing said the other way round. */
create or replace function post_decay_rate(p_ql double precision) returns double precision
  language sql immutable as $$ select 100 / post_life(p_ql) $$;

/** How far gone it is now, rather than when anybody last looked. */
create or replace function post_dmg(p placed) returns double precision language sql stable as $$
  select least(100, p.dmg + post_decay_rate(p.ql) * extract(epoch from (now() - p.since)))
$$;

/** Seconds it has left in it. */
create or replace function post_left(p placed) returns double precision language sql stable as $$
  select greatest(0, post_life(p.ql) * (1 - post_dmg(p) / 100))
$$;

/**
 * How far the wildermon set to it will range.
 *
 * A post is a work site and not a settlement: eight tiles round a rough one,
 * twenty round the best, and never further however much the creature has
 * learned.
 */
create or replace function post_radius(p_ql double precision) returns int language sql immutable as $$
  select round(8 + (least(100, greatest(1, p_ql)) / 100) * 12)::int
$$;

create or replace function post_name(p placed) returns text language sql stable as $$
  select coalesce(p.name, case when p.sub is not null then 'Work post (' || lower(p.sub) || ')'
                               else 'Work post' end)
$$;

/** How long it has left, said the way a person would say it. */
create or replace function post_state(p placed) returns text language sql stable as $$
  select case when post_left(p) <= 0 then 'falling over'
              when post_left(p) >= 3600 then to_char(post_left(p) / 3600, 'FM990.0') || ' hours left in it'
              else ceil(post_left(p) / 60) || ' minutes left in it' end
$$;

/**
 * Write down what has rotted, and take the post away when it has all gone.
 *
 * Every question about a post goes through here first. Whoever was working out
 * of it comes home to the token rather than being left standing in a field
 * taking orders from a hole in the ground.
 */
create or replace function post_settle(p_id bigint) returns boolean language plpgsql as $$
declare p placed; v_dmg double precision; c creature; dd deed;
begin
  select * into p from placed where id = p_id and kind = 'post' for update;
  if not found then return false; end if;
  v_dmg := post_dmg(p);
  if v_dmg < 100 then
    update placed set dmg = v_dmg, since = now() where id = p_id;
    return false;
  end if;
  select * into dd from deed where world_id = p.world_id;
  for c in select * from creature where world_id = p.world_id and post = p_id loop
    if dd.world_id is null then
      update creature set post = null, mode = 'wild', phase = 'idle' where world_id = c.world_id and id = c.id;
    else
      update creature set post = null, phase = 'idle',
          from_x = dd.x + 0.5, from_y = dd.y + 1.5, to_x = dd.x + 0.5, to_y = dd.y + 1.5,
          leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
        where world_id = c.world_id and id = c.id;
    end if;
    if c.keeper is not null then
      perform tell(p.world_id, c.keeper, 'The ' || lower(post_name(p))
        || ' has rotted through and gone over. ' || c.name || ' comes home.', 'system');
    end if;
  end loop;
  delete from placed where id = p_id;
  return true;
end $$;

/** Bring every post on the island up to date, and say how many went over. */
create or replace function post_sweep(p_world uuid) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  for r in select id from placed where world_id = p_world and kind = 'post' order by id loop
    if post_settle(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

/**
 * Where a worker takes its orders from: a settlement, or a post standing in
 * for one.
 *
 * A deed lets a worker range as far as it has earned; a post is a work site
 * rather than a settlement, and holds it to the post's own reach however much
 * the creature has learned.
 */
create or replace function work_site(p_world uuid, c creature)
  returns table (x int, y int, radius int, post bigint) language plpgsql stable as $$
declare p placed; dd deed;
begin
  if c.post is not null then
    select * into p from placed where id = c.post and kind = 'post';
    if found then
      x := p.x; y := p.y;
      radius := least(work_range(c), post_radius(p.ql));
      post := p.id;
      return next;
      return;
    end if;
  end if;
  select * into dd from deed where world_id = p_world;
  if not found then return; end if;
  x := dd.x; y := dd.y; radius := work_range(c); post := null;
  return next;
end $$;

/** Whether the four subtiles a post wants are free of everything else. */
create or replace function post_place_reason(p_world uuid, p_x int, p_y int, p_sx int, p_sy int)
  returns text language plpgsql stable as $$
begin
  if not in_bounds(p_world, p_x, p_y) then return 'That is off the edge of the world.'; end if;
  if has_water(p_world, p_x, p_y) then return 'A post will not stand in water.'; end if;
  if not passable(p_world, p_x, p_y) then return 'There is no room to drive it in.'; end if;
  if exists (select 1 from placed pl where pl.world_id = p_world and pl.x = p_x and pl.y = p_y
               and pl.sx = p_sx and pl.sy = p_sy) then
    return 'Something is already standing there.';
  end if;
  return null;
end $$;

/* ------------------------------------------------------------------ *
 * The doors.
 * ------------------------------------------------------------------ */

create or replace function settlement_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql as $$
declare dd deed; p placed; it item; c creature; v_name text;
begin
  if p_action in ('upgrade_deed', 'disband_deed', 'rename_deed') then
    select * into dd from deed where world_id = p_world;
    if not found then return 'You have no settlement.'; end if;
    if dd.founded_by is distinct from p_uid then return 'That is not your settlement.'; end if;
    if p_action = 'upgrade_deed' then return upgrade_reason(p_world); end if;
    if p_action = 'rename_deed'
       and nullif(btrim(coalesce(p_target->>'name', '')), '') is null then
      return 'Choose a name.';
    end if;
    return null;
  end if;

  if p_action = 'place_post' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'work_post' and not locked
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
      order by id limit 1;
    if not found then return 'You have no work post to drive in.'; end if;
    return post_place_reason(p_world, (p_target->>'x')::int, (p_target->>'y')::int,
      coalesce((p_target->>'sx')::int, 0), coalesce((p_target->>'sy')::int, 0));
  end if;

  -- Everything else is asked of a post, so the post is brought up to date
  -- before it is asked: one nobody has looked at for a day is not there.
  perform post_settle((p_target->>'id')::bigint);
  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'post';
  if not found then return 'It is gone.'; end if;
  if not near_piece(p_world, p_uid, p) then return 'Stand at the post.'; end if;

  if p_action = 'assign_post' then
    if exists (select 1 from creature q where q.world_id = p_world and q.post = p.id) then
      return 'Something is already working out of it.';
    end if;
    select * into c from creature where world_id = p_world and id = (p_target->>'creature')::int;
    if not found then return 'Choose a wildermon.'; end if;
    if c.mode = 'wild' then return c.name || ' is not yours to set to work.'; end if;
    if not worker_job_ported((select gathers from species_def where id = c.species)) then
      return 'Nobody has taught this island what '
        || (select plain from gather_def where id = (select gathers from species_def where id = c.species))
        || ' looks like yet.';
    end if;
  elsif p_action = 'unassign_post' then
    if not exists (select 1 from creature q where q.world_id = p_world and q.post = p.id) then
      return 'Nothing is working out of it.';
    end if;
  end if;
  return null;
end $$;

create or replace function perform_settlement(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare dd deed; p placed; it item; c creature; v_name text; v_level int; v_sx int; v_sy int;
        v_freed int := 0; v_tipped int := 0; cr crate; r record;
begin
  if p_action = 'upgrade_deed' then
    select * into dd from deed where world_id = p_world;
    v_level := dd.level + 1;
    update deed set level = v_level, radius = deed_radius(v_level) where world_id = p_world;
    perform tell(p_world, p_uid, dd.name || ' grows to level ' || v_level
      || '. The border reaches ' || deed_radius(v_level) || ' tiles from the token and '
      || worker_cap(p_world) || ' wildermon may work here.', 'system');
    perform land_announce(p_world, dd.x, dd.y);

  elsif p_action = 'rename_deed' then
    v_name := left(btrim(p_target->>'name'), 32);
    update deed set name = v_name where world_id = p_world;
    perform tell(p_world, p_uid, 'The settlement is now called ' || v_name || '.', 'system');

  elsif p_action = 'disband_deed' then
    select * into dd from deed where world_id = p_world;
    -- Everything kept here runs wild, and what it was carrying goes on the
    -- ground where it stood rather than with it.
    for c in select * from creature where world_id = p_world and mode in ('stored', 'deed') loop
      if c.carrying is not null then
        perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
          c.carrying->>'def', (c.carrying->>'ql')::double precision, c.carrying->>'extra',
          (c.carrying->>'count')::int);
      end if;
      update creature set mode = 'wild', phase = 'idle', job = null, post = null, carrying = null,
          name = (select name from species_def where id = c.species)
        where world_id = p_world and id = c.id;
      v_freed := v_freed + 1;
    end loop;
    -- The settlement's own crate goes with the settlement, and whatever was in
    -- it is tipped out where it stood rather than vanishing with it.
    cr := deed_crate(p_world);
    if cr.id is not null then
      for r in select * from item where world_id = p_world and crate = cr.id loop
        update item set holder = 'ground', holder_uid = null, crate = null, gx = cr.x, gy = cr.y
          where id = r.id;
        v_tipped := v_tipped + 1;
      end loop;
      delete from crate where world_id = p_world and id = cr.id;
    end if;
    delete from deed where world_id = p_world;
    perform tell(p_world, p_uid, dd.name || ' is disbanded. '
      || v_freed || case when v_freed = 1 then ' wildermon runs' else ' wildermon run' end
      || ' wild and ' || v_tipped
      || case when v_tipped = 1 then ' thing is' else ' things are' end
      || ' tipped out where the crate stood.', 'system');
    perform land_announce(p_world, dd.x, dd.y);

  elsif p_action = 'place_post' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'work_post' and not locked
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
      order by id limit 1;
    if not found then return; end if;
    v_sx := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, 'post', it.extra, (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 0.5) / subtiles(),
            (p_target->>'y')::int + (v_sy + 0.5) / subtiles(), it.ql, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You drive the post in and tack the ribbon to it. It will stand about '
      || round(post_life(p.ql) / 60) || ' minutes and reach ' || post_radius(p.ql)
      || ' tiles. Set a wildermon to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  if p_action in ('upgrade_deed', 'rename_deed', 'disband_deed') then return; end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_post' then
    -- Half rotten by now, most likely, and it comes up as it went in.
    perform give(p_world, p_uid, 'work_post', 1,
      greatest(1, p.ql * (1 - post_dmg(p) / 100)), p.sub);
    update creature set post = null, phase = 'idle' where world_id = p_world and post = p.id;
    delete from placed where id = p.id;
    perform tell(p_world, p_uid, 'You pull the post up and coil the ribbon round it.', 'event');
    perform land_announce(p_world, p.x, p.y);

  elsif p_action = 'assign_post' then
    select * into c from creature where world_id = p_world and id = (p_target->>'creature')::int;
    if not found then return; end if;
    update creature set post = p.id, mode = 'deed', phase = 'idle', enemy = null, hunting = null,
        from_x = p.cx, from_y = p.cy + 0.6, to_x = p.cx, to_y = p.cy + 0.6,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select g.plain from gather_def g
                   where g.id = (select gathers from species_def where id = c.species)),
                  'keep to the post')
      || ' within ' || least(work_range(c), post_radius(p.ql))
      || ' tiles of the post while it stands. (' || post_state(p) || ')', 'system');

  elsif p_action = 'unassign_post' then
    select * into c from creature where world_id = p_world and post = p.id limit 1;
    if not found then return; end if;
    select * into dd from deed where world_id = p_world;
    update creature set post = null, phase = 'idle',
        from_x = coalesce(dd.x + 0.5, p.cx), from_y = coalesce(dd.y + 1.5, p.cy),
        to_x = coalesce(dd.x + 0.5, p.cx), to_y = coalesce(dd.y + 1.5, p.cy),
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' is called off the post.', 'system');
  end if;
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
      'place_post', 'pick_up_post', 'assign_post', 'unassign_post')
      or exists (select 1 from recipe where id = p_action)
$$;





select private.lock_doors();
