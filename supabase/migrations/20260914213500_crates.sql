-- Crates you make, set down and stuff by hand.
--
-- The settlement's own crate came in with the deed workers, because a beast
-- that has walked out for a log needs somewhere to put it. This is the rest of
-- it: a crate is a thing you carry, place on a subtile, fill, empty and pick
-- up again — and once there are crates on the deed, a magga has something to
-- do, which is why `fetch` comes in with them.

create or replace function crate_capacity(c crate) returns int language sql stable as $$
  select round((select capacity from crate_def where kind = c.kind)
    * coalesce((mat_of(c.material)).hold, 1))::int
$$;

create or replace function crate_kind_of_item(p_def text) returns text language sql stable as $$
  select kind from crate_def where item = p_def
$$;

create or replace function crate_name(c crate) returns text language sql stable as $$
  select coalesce(c.name,
    case when c.deed then 'Deed crate (' || lower(d.name) || ')' else d.name end
    || case when c.material is null then '' else ' (' || lower(c.material) || ')' end)
  from crate_def d where d.kind = c.kind
$$;

create or replace function crate_at(p_world uuid, p_x int, p_y int, p_sx int, p_sy int) returns crate
  language sql stable as $$
  select * from crate where world_id = p_world and x = p_x and y = p_y and sx = p_sx and sy = p_sy
$$;

/** The crate closest to somebody, within arm's reach of one. */
create or replace function nearest_crate(p_world uuid, p_x double precision, p_y double precision,
    p_range double precision default 2.4) returns crate
  language sql stable as $$
  select c.* from crate c
  where c.world_id = p_world
    and sqrt((crate_centre_x(c) - p_x) ^ 2 + (crate_centre_y(c) - p_y) ^ 2) <= p_range
  order by sqrt((crate_centre_x(c) - p_x) ^ 2 + (crate_centre_y(c) - p_y) ^ 2)
  limit 1
$$;

create or replace function target_crate(p_world uuid, p_target jsonb) returns crate
  language sql stable as $$
  select * from crate where world_id = p_world and id = (p_target->>'id')::int
$$;

create or replace function crate_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('place_crate', 'pick_up_crate', 'crate_take_all', 'store_in_crate')
$$;

create or replace function crate_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql as $$
declare v_p player; v_it item; v_c crate; v_tx int; v_ty int; v_sx int; v_sy int; v_want int;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    if v_tx is null or v_sx is null or v_sy is null or p_target->>'itemUid' is null then
      return 'Choose a crate and a spot.';
    end if;
    select * into v_it from item where id = (p_target->>'itemUid')::bigint
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found or crate_kind_of_item(v_it.def) is null then return 'That is not a crate.'; end if;
    if not passable(p_world, v_tx, v_ty) or has_water(p_world, v_tx, v_ty) then
      return 'Crates need dry, open ground.';
    end if;
    if tile_slope(p_world, v_tx, v_ty) > 20 then return 'The ground is too steep for a crate to stand.'; end if;
    if (crate_at(p_world, v_tx, v_ty, v_sx, v_sy)).id is not null then return 'There is already a crate on that spot.'; end if;
    if is_token(p_world, v_tx, v_ty) then return 'Not on the token.'; end if;
    return null;

  elsif p_action in ('pick_up_crate', 'crate_take_all') then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return 'It is gone.'; end if;
    if sqrt((crate_centre_x(v_c) - v_p.x) ^ 2 + (crate_centre_y(v_c) - v_p.y) ^ 2) > 2.4 then
      return 'Stand next to the crate.';
    end if;
    if p_action = 'pick_up_crate' then
      return case when crate_units(p_world, v_c.id) > 0 then 'Empty it first.' end;
    end if;
    return case when crate_units(p_world, v_c.id) = 0 then 'The crate is empty.' end;

  elsif p_action = 'store_in_crate' then
    v_c := nearest_crate(p_world, v_p.x, v_p.y);
    if v_c.id is null then return 'Stand next to a crate.'; end if;
    select * into v_it from item where id = (p_target->>'uid')::bigint
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    if crate_kind_of_item(v_it.def) is not null then return 'A crate does not go in a crate.'; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if crate_units(p_world, v_c.id) + v_want > crate_capacity(v_c) then
      return 'The ' || lower(crate_name(v_c)) || ' is full.';
    end if;
    return null;
  end if;
  return null;
end $$;

create or replace function perform_crate(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare v_p player; v_it item; v_c crate; v_tx int; v_ty int; v_sx int; v_sy int; v_new_id int;
        v_want int; v_names text[] := '{}'; v_r record; v_kind text;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    select * into v_it from item where id = (p_target->>'itemUid')::bigint;
    v_kind := crate_kind_of_item(v_it.def);
    if v_kind is null or not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    select coalesce(max(id), 0) + 1 into v_new_id from crate where world_id = p_world;
    insert into crate (world_id, id, kind, x, y, sx, sy, material)
    values (p_world, v_new_id, v_kind, v_tx, v_ty, v_sx, v_sy, v_it.extra);
    select * into v_c from crate where world_id = p_world and id = v_new_id;
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
        || lower((select coalesce(name, v_r.def) from item_def where id = v_r.def)));
      update item set holder = 'player', holder_uid = p_uid, crate = null, gx = null, gy = null
        where id = v_r.id;
    end loop;
    if array_length(v_names, 1) is null then return; end if;
    perform tell(p_world, p_uid, 'You take ' || array_to_string(v_names, ', ') || ' from the crate.', 'event');

  elsif p_action = 'store_in_crate' then
    v_c := nearest_crate(p_world, v_p.x, v_p.y);
    select * into v_it from item where id = (p_target->>'uid')::bigint;
    if v_c.id is null or not found then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if not crate_add(p_world, v_c.id, v_it.def, v_want, v_it.ql, v_it.extra) then
      perform tell(p_world, p_uid, 'The crate is full.', 'error');
      return;
    end if;
    if v_want >= v_it.count then delete from item where id = v_it.id;
    else update item set count = count - v_want where id = v_it.id; end if;
    perform tell(p_world, p_uid, 'You put ' || case when v_want > 1 then v_want || ' × ' else 'the ' end
      || lower((select coalesce(name, v_it.def) from item_def where id = v_it.def))
      || ' in the ' || lower((select name from crate_def where crate_def.kind = v_c.kind)) || '.', 'event');
  end if;
end $$;

/* ------------------------------------------------------------------ *
 * And the trade the crates unblock.
 * ------------------------------------------------------------------ */

create or replace function worker_job_ported(p_kind text) returns boolean
  language sql immutable as $$
  select p_kind in ('forage', 'botanize', 'woodcut', 'mine', 'quarry',
                    'sand', 'clay', 'peat', 'reed', 'fish', 'farm', 'fetch')
$$;

create or replace function worker_gatherable(p_world uuid, p_x int, p_y int, p_kind text, c creature)
  returns boolean language plpgsql stable as $$
declare here int; t tile_def; rock rock_def;
begin
  if not in_bounds(p_world, p_x, p_y) or claimed(p_world, p_x, p_y, c.id) then return false; end if;
  here := land_tile(p_world, p_x, p_y);
  select * into t from tile_def where id = here;

  if p_kind = 'woodcut' then
    return here = tile_id('Tree') and exists (select 1 from beside_tile(p_world, p_x, p_y));
  elsif p_kind = 'mine' then
    rock := bedrock_at(p_world, p_x, p_y);
    return here = tile_id('Rock') and rock.ore and rock.level <= task_skill(c)
       and rock_height(p_world, p_x, p_y) > 1;
  elsif p_kind = 'quarry' then
    rock := bedrock_at(p_world, p_x, p_y);
    return here = tile_id('Rock') and not rock.ore and rock_height(p_world, p_x, p_y) > 1;
  elsif p_kind in ('sand', 'clay') then
    return here = tile_id(case p_kind when 'sand' then 'Sand' else 'Clay' end)
       and land_dirt(p_world, p_x, p_y) > 0 and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'peat' then
    return here in (tile_id('Peat'), tile_id('Tar')) and not is_foraged(p_world, p_x, p_y, 'dig')
       and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'reed' then
    return here = tile_id('Reed') and not is_foraged(p_world, p_x, p_y, 'reed');
  elsif p_kind = 'fish' then
    return fishable(p_world, p_x, p_y);
  elsif p_kind = 'fetch' then
    -- Anything lying on the deed that is not already somebody's errand.
    return on_deed(p_world, p_x, p_y) and creature_tile_ok(p_world, p_x, p_y)
       and exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                     and i.gx = p_x and i.gy = p_y);
  elsif p_kind = 'farm' then
    perform crop_settle(p_world, p_x, p_y);
    return exists (select 1 from crop cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y
      and (cr.stage >= crop_ripe() or not cr.tended_now));
  elsif p_kind = 'forage' then
    return coalesce(t.forage, false) and not is_foraged(p_world, p_x, p_y, 'forage')
       and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'botanize' then
    return coalesce(t.botanize, false) and not is_foraged(p_world, p_x, p_y, 'botanize')
       and creature_tile_ok(p_world, p_x, p_y);
  end if;
  return false;
end $$;

/** And what a fetcher brings home, which is whatever it found lying there. */
create or replace function worker_do(p_world uuid, p_id int) returns jsonb
  language plpgsql as $$
declare c creature; d species_def; kind text; skill_id text; skill double precision;
        wx int; wy int; here int; data int; tree tree_def; rock rock_def; logs int;
        made_ql double precision; got text; careful double precision; chance double precision;
        cr crop; yld int[]; depth double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found or c.work_x is null then return null; end if;
  select * into d from species_def where id = c.species;
  kind := d.gathers;
  select g.skill into skill_id from gather_def g where g.id = kind;
  skill := task_skill(c);
  wx := c.work_x; wy := c.work_y;
  here := land_tile(p_world, wx, wy);
  careful := trait_mul(c.traits, 'yield');
  perform worker_learn(p_world, p_id, skill_id, 0.225);
  made_ql := least(100, greatest(1, skill * (0.6 + random() * 0.8) + 1) * careful);

  if kind = 'woodcut' then
    if here <> tile_id('Tree') then return null; end if;
    data := land_data(p_world, wx, wy);
    select * into tree from tree_def where id = tree_species(data);
    logs := tree.logs + case when tree_age(data) = 2 then 1 else 0 end;
    perform land_set_tile(p_world, wx, wy, tile_id('Grass'));
    perform land_set_data(p_world, wx, wy, 0);
    perform land_announce(p_world, wx, wy);
    -- It can only carry one at a time; the rest of the tree waits at the stump.
    if logs > 1 then
      perform drop_on_ground(p_world, wx, wy, 'log', made_ql, tree.name, logs - 1);
    end if;
    return jsonb_build_object('def', 'log', 'count', 1, 'ql', made_ql, 'extra', tree.name);

  elsif kind in ('mine', 'quarry') then
    rock := bedrock_at(p_world, wx, wy);
    got := case when kind = 'mine' and rock.ore then rock.yields else 'rock_shards' end;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), wx, wy), made_ql);
    return jsonb_build_object('def', got, 'count', 1, 'ql', made_ql);

  elsif kind in ('sand', 'clay') then
    if land_dirt(p_world, wx, wy) <= 0 then return null; end if;
    perform land_set_dirt(p_world, wx, wy, land_dirt(p_world, wx, wy) - 1);
    return jsonb_build_object('def', kind, 'count', 1, 'ql', made_ql);

  elsif kind = 'peat' then
    perform mark_foraged(p_world, wx, wy, 'dig');
    return jsonb_build_object('def', case when here = tile_id('Tar') then 'tar' else 'peat' end,
      'count', 1, 'ql', made_ql);

  elsif kind = 'reed' then
    perform mark_foraged(p_world, wx, wy, 'reed');
    return jsonb_build_object('def', 'reed', 'count', 1, 'ql', made_ql);

  elsif kind = 'fish' then
    depth := water_depth(p_world, wx, wy);
    got := catch_fish(depth, skill, 0, null);
    if got is null then return null; end if;
    return jsonb_build_object('def', got, 'count', 1, 'ql', made_ql);

  elsif kind = 'fetch' then
    -- Whatever is lying there, carried home. A feller leaves two logs at every
    -- stump it works; this is what tidies them away.
    declare lying item;
    begin
      select * into lying from item where world_id = p_world and holder = 'ground'
        and gx = wx and gy = wy order by id limit 1;
      if not found then return null; end if;
      delete from item where id = lying.id;
      return jsonb_build_object('def', lying.def, 'count', lying.count,
        'ql', lying.ql, 'extra', lying.extra);
    end;

  elsif kind = 'farm' then
    perform crop_settle(p_world, wx, wy);
    select * into cr from crop where world_id = p_world and x = wx and y = wy;
    if not found then return null; end if;
    if cr.stage < crop_ripe() then
      -- Not ripe: weed and water it, which is what makes the harvest worth having.
      if cr.tended_now then return null; end if;
      update crop set tended = tended + 1, tended_now = true,
          ql = least(100, ql + greatest(1, skill * 0.2))
        where world_id = p_world and x = wx and y = wy;
      return null;
    end if;
    yld := crop_yield(cr.tended);
    select produce into got from crop_def where id = cr.id;
    delete from crop where world_id = p_world and x = wx and y = wy;
    perform land_set_tile(p_world, wx, wy, tile_id('Field'));
    perform land_announce(p_world, wx, wy);
    -- The seed goes back in the ground's place; the produce goes home.
    perform drop_on_ground(p_world, wx, wy, (select seed from crop_def where id = cr.id),
      cr.ql, null, yld[2]);
    return jsonb_build_object('def', got, 'count', yld[1], 'ql', cr.ql);

  else
    -- Foraging and botanizing: the same table a player rolls on, and the same
    -- bed left picked clean behind it.
    perform mark_foraged(p_world, wx, wy, kind);
    chance := least(0.98, greatest(0.3, 0.6 + (skill / 100) * 0.38 - 5 / 150.0) * careful);
    if random() < 0.2 or random() >= chance then return null; end if;
    got := roll_table(kind, random());
    if got is null then return null; end if;
    return jsonb_build_object('def', got, 'count', 1, 'ql', made_ql);
  end if;
end $$;

select private.lock_doors();
