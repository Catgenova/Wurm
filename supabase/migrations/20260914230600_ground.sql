-- Working the ground, and what grows out of it.
--
-- ## Eleven actions, and almost no new machinery
--
-- Everything here reads something the island already keeps: the corner heights
-- and the soil over them, the forage bed and its cooldown, the tree species
-- and age packed into a tile's data byte, the rock under every tile whether it
-- is bare or buried or drowned. What was missing was the eleven doors onto it.
--
-- The one genuinely new thing is a prospector's marks, and they are new
-- because they belong to a person rather than to the island: what you have
-- read the ground for is yours, it fades after two minutes, and somebody else
-- standing on the same seam has to look for themselves.

create or replace function ground_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('flatten', 'drop_dirt', 'pave_slabs', 'remove_paving',
                      'cut_grass', 'cut_reeds', 'pick_fruit', 'pick_sprout',
                      'plant', 'dig_worms', 'prospect')
$$;

/* ------------------------------------------------------------------ *
 * Corners, and what stands over them.
 * ------------------------------------------------------------------ */

/** The four corners of a tile, north-west first and going clockwise. */
create or replace function tile_corners(p_x int, p_y int)
  returns table (cx int, cy int, ord int) language sql immutable as $$
  select * from (values (p_x, p_y, 0), (p_x + 1, p_y, 1),
                        (p_x + 1, p_y + 1, 2), (p_x, p_y + 1, 3)) v(cx, cy, ord)
$$;

/** Which corner of a tile this is, said the way somebody would say it. */
create or replace function corner_name(p_x int, p_y int, p_cx int, p_cy int)
  returns text language sql immutable as $$
  select case when p_cy = p_y then 'north' else 'south' end || '-'
      || case when p_cx = p_x then 'west' else 'east' end
$$;

/** Terraforming is not allowed under a building. */
create or replace function under_building(p_world uuid, p_x int, p_y int) returns text
  language sql stable as $$
  select case when building_at(p_world, p_x, p_y) is not null
              then 'You cannot do that inside a building.' end
$$;

create or replace function corner_under_building(p_world uuid, p_cx int, p_cy int) returns text
  language sql stable as $$
  select case when exists (select 1 from generate_series(p_cx - 1, p_cx) x
                             cross join generate_series(p_cy - 1, p_cy) y
                           where building_at(p_world, x, y) is not null)
              then 'You cannot dig under a building.' end
$$;

/**
 * Move a corner up or down, taking the soil with it.
 *
 * Height and soil move together because a shovel moves earth rather than
 * ground: take a spit off a corner and there is one less of soil over the
 * rock, and `reconcile_around` decides whether that has left the rock showing.
 */
create or replace function raise_corner(p_world uuid, p_cx int, p_cy int, p_by int) returns void
  language plpgsql as $$
begin
  perform land_set_height(p_world, p_cx, p_cy, land_height(p_world, p_cx, p_cy) + p_by);
  perform land_set_dirt(p_world, p_cx, p_cy, land_dirt(p_world, p_cx, p_cy) + p_by);
  perform reconcile_around(p_world, p_cx, p_cy);
end $$;

/* ------------------------------------------------------------------ *
 * Flattening, which is a terrace carried outwards a tile at a time.
 * ------------------------------------------------------------------ */

/**
 * The height flattening works towards: the ground you are standing on, so a
 * terrace can be carried outwards tile by tile. Standing on the tile being
 * flattened there is nothing to match, so it settles to its own lowest corner
 * and the ground only ever comes down.
 */
create or replace function flatten_target(p_world uuid, p_uid uuid, p_x int, p_y int)
  returns int language plpgsql stable as $$
declare p player;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if floor(p.x)::int = p_x and floor(p.y)::int = p_y then
    return (select min(land_height(p_world, c.cx, c.cy)) from tile_corners(p_x, p_y) c);
  end if;
  return round(centre_height(p_world, floor(p.x)::int, floor(p.y)::int));
end $$;

/** True while any corner of the tile is off the height flattening aims at. */
create or replace function needs_flattening(p_world uuid, p_uid uuid, p_x int, p_y int)
  returns boolean language sql stable as $$
  select exists (select 1 from tile_corners(p_x, p_y) c
                 where land_height(p_world, c.cx, c.cy) <> flatten_target(p_world, p_uid, p_x, p_y))
$$;

/* ------------------------------------------------------------------ *
 * A prospector's marks, which belong to a person rather than to the island.
 * ------------------------------------------------------------------ */

/** How long a reading of the ground stays lit: two minutes. */
create or replace function prospect_mark_time() returns double precision
  language sql immutable as $$ select 120 $$;

/** How far a prospector reads the ground: one tile further every ten levels. */
create or replace function prospect_radius(p_skill double precision) returns int
  language sql immutable as $$ select 3 + floor(p_skill / 10)::int $$;

/** Light up the metal somebody has just read, for a while. */
create or replace function mark_prospected(p_world uuid, p_uid uuid, p_tiles int[]) returns void
  language sql as $$
  update player set stats = jsonb_set(stats, '{prospected}',
      case when coalesce(array_length(p_tiles, 1), 0) = 0 then 'null'::jsonb
           else jsonb_build_object('tiles', to_jsonb(p_tiles),
                                   'until', extract(epoch from now()) + prospect_mark_time()) end)
  where world_id = p_world and uid = p_uid
$$;

/** Whether a tile is still lit for whoever read it. */
create or replace function is_prospected(p_world uuid, p_uid uuid, p_x int, p_y int)
  returns boolean language sql stable as $$
  select coalesce((
    select (m->>'until')::double precision > extract(epoch from now())
       and to_jsonb(p_y * (select size from world where id = p_world) + p_x) in
           (select value from jsonb_array_elements(m->'tiles'))
    from (select stats->'prospected' as m from player
          where world_id = p_world and uid = p_uid) q
    where m is not null and jsonb_typeof(m) = 'object'), false)
$$;

/* ------------------------------------------------------------------ *
 * The doors.
 * ------------------------------------------------------------------ */

create or replace function ground_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        v_under text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if tx is null or ty is null or not in_bounds(p_world, tx, ty) then
    return 'There is nothing there.';
  end if;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);

  if p_action = 'flatten' then
    if t.dig_yield is null then return 'You cannot flatten that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel to flatten.'; end if;
    if has_water(p_world, tx, ty) then return 'You cannot flatten below the water level.'; end if;
    if flatten_target(p_world, p_uid, tx, ty) < 0 then
      return 'The ground you stand on is below the water line.';
    end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if not needs_flattening(p_world, p_uid, tx, ty) then return 'That ground is already flat.'; end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if pack_count(p_world, p_uid, 'dirt') < 1 then return 'You have no dirt to drop.'; end if;
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    if corner_slope_after(p_world, cx, cy, 1) > max_dig_slope(p_world, p_uid) then
      return 'The slope would be too steep for your digging skill.';
    end if;

  elsif p_action = 'pave_slabs' then
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if here <> 2 then return 'The ground has to be packed flat before anything is laid on it.'; end if;
    if pack_count(p_world, p_uid, 'trowel') < 1 then return 'You need a trowel to bed a slab.'; end if;
    if not exists (select 1 from item i join slab_def s on s.item = i.def
                   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
                     and not i.locked) then
      return 'You need a cut slab to pave with.';
    end if;

  elsif p_action = 'remove_paving' then
    if here not in (13, 14, 21) then return 'There is no paving here to break up.'; end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to break up paving.'; end if;

  elsif p_action = 'cut_grass' then
    if here not in (0, 5, 6, 20) then return 'There is no grass here to cut.'; end if;
    if is_foraged(p_world, tx, ty, 'grass') then return 'The grass here is still short.'; end if;

  elsif p_action = 'cut_reeds' then
    if here <> 19 then return 'There are no reeds here.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') < 1 then return 'You need a knife to cut reeds.'; end if;
    if is_foraged(p_world, tx, ty, 'reed') then return 'The reeds here are cut back to the water.'; end if;

  elsif p_action = 'pick_fruit' then
    if here <> 16 then return 'There is no tree here.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if v_tree.fruit is null then return 'Nothing grows on this that you would eat.'; end if;
    -- A sapling bears nothing; it has to have some years in it first.
    if tree_age(v_data) = 0 then
      return 'The ' || lower(v_tree.name) || ' is too young to bear. Leave it to grow.';
    end if;
    if is_foraged(p_world, tx, ty, 'forage') then
      return 'You have had what this ' || lower(v_tree.name) || ' has on it. Come back later.';
    end if;

  elsif p_action = 'pick_sprout' then
    if here <> 16 then return 'There is no tree here.'; end if;

  elsif p_action = 'plant' then
    if not exists (select 1 from plantable where tile = here) then
      return 'Nothing will take root in that.';
    end if;
    if pack_count(p_world, p_uid, 'sprout') < 1 then return 'You have no sprout to plant.'; end if;

  elsif p_action = 'dig_worms' then
    if not t.wormy then return 'Nothing lives in that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel.'; end if;
    if has_water(p_world, tx, ty) then return 'Not under water.'; end if;

  elsif p_action = 'prospect' then
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to prospect.'; end if;
  end if;
  return null;
end $$;

create or replace function perform_ground(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        v_skill double precision; v_tool double precision; v_ql double precision; v_n int;
        v_gained double precision; v_slab item; v_kind int; v_target int; v_hi record; v_lo record;
        v_rock rock_def; v_rad int; v_tiles int[] := '{}'; v_names text[] := '{}'; v_row record;
        v_id bigint; v_species int; v_sprout item; v_buried text; v_size int;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);

  if p_action = 'flatten' then
    v_target := flatten_target(p_world, p_uid, tx, ty);
    -- The corners furthest above and below the height we are working towards.
    select c.cx, c.cy into v_hi from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) > v_target
      order by land_height(p_world, c.cx, c.cy) desc limit 1;
    select c.cx, c.cy into v_lo from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) < v_target
      order by land_height(p_world, c.cx, c.cy) limit 1;
    if v_hi.cx is null and v_lo.cx is null then return; end if;
    -- Only soil can be moved with a shovel; bedrock needs a pickaxe.
    if v_hi.cx is not null and land_dirt(p_world, v_hi.cx, v_hi.cy) <= 0 then
      perform tell(p_world, p_uid, 'The high corner is bare rock. Mine it down instead.', 'error');
      return;
    end if;
    if v_hi.cx is not null and v_lo.cx is not null then
      -- One corner down and one up: the dirt simply moves across the tile.
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
      perform tell(p_world, p_uid, 'You move some dirt across the tile.', 'event');
    elsif v_hi.cx is not null then
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform give(p_world, p_uid, 'dirt', 1,
        product_ql(skill_of(p_world, p_uid, 'digging'), tool_ql(p_world, p_uid, 'shovel')));
      perform tell(p_world, p_uid, 'You scrape the ground down and pocket the dirt.', 'event');
    else
      if not consume(p_world, p_uid, 'dirt', 1) then
        perform tell(p_world, p_uid, 'You need dirt to bring this ground up to your level.', 'error');
        return;
      end if;
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
      perform tell(p_world, p_uid, 'You pack dirt in to bring the ground up.', 'event');
    end if;
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    if not needs_flattening(p_world, p_uid, tx, ty) then
      perform tell(p_world, p_uid,
        case when floor((select x from player where world_id = p_world and uid = p_uid))::int = tx
              and floor((select y from player where world_id = p_world and uid = p_uid))::int = ty
             then 'The tile is now flat at its lowest corner.'
             else 'The tile is now flat and level with the ground you stand on.' end, 'event');
    end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    perform raise_corner(p_world, cx, cy, 1);
    if here in (0, 20) then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You drop the dirt on the ' || corner_name(tx, ty, cx, cy)
      || ' corner, raising the ground.', 'event');

  elsif p_action = 'pave_slabs' then
    select i.* into v_slab from item i join slab_def s on s.item = i.def
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
      order by (i.id = nullif(p_target->>'uid', '')::bigint) desc, i.id limit 1;
    if not found then return; end if;
    select id into v_kind from slab_def where item = v_slab.def;
    if not skill_check(skill_of(p_world, p_uid, 'paving'), 10, v_slab.ql) then
      perform tell(p_world, p_uid,
        'The slab rocks on its bed however you set it. You leave it for now.', 'event');
      return;
    end if;
    if not consume(p_world, p_uid, v_slab.def, 1, v_slab.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 21);
    perform land_set_data(p_world, tx, ty, v_kind);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You bed the '
      || lower((select name from item_def where id = v_slab.def)) || ' down flat and true.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'remove_paving' then
    -- A slab comes up whole more often than not; gravel and cobbles do not.
    v_kind := case when here = 21 then v_data & 3 else null end;
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    if v_kind is not null and random() < 0.6 then
      v_ql := product_ql(skill_of(p_world, p_uid, 'paving'));
      perform give(p_world, p_uid, (select item from slab_def where id = v_kind), 1, v_ql);
      perform tell(p_world, p_uid, 'You lever the '
        || regexp_replace(lower((select name from slab_def where id = v_kind)), 's$', '')
        || ' up whole. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    else
      perform tell(p_world, p_uid, 'You break up the paving, leaving bare dirt.', 'event');
    end if;
    v_gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'cut_grass' then
    perform mark_foraged(p_world, tx, ty, 'grass');
    perform give(p_world, p_uid, 'mixed_grass', 2, product_ql(skill_of(p_world, p_uid, 'foraging')));
    perform tell(p_world, p_uid, 'You cut two bundles of mixed grass.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_reeds' then
    perform mark_foraged(p_world, tx, ty, 'reed');
    v_skill := skill_of(p_world, p_uid, 'foraging');
    v_n := 2 + case when random() < v_skill / 140 then 1 else 0 end;
    perform give(p_world, p_uid, 'reed', v_n,
      product_ql(v_skill, tool_ql(p_world, p_uid, 'carving_knife')));
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' reeds out of the bed.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'pick_fruit' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- An old tree carries more than one only just come into bearing.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_n := greatest(1, round(case when tree_age(v_data) = 2 then 5 else 3 end
                             * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int);
    v_ql := product_ql(v_skill);
    perform give(p_world, p_uid, v_tree.fruit, v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You pick ' || v_n || ' '
      || lower((select name from item_def where id = v_tree.fruit))
      || case when v_n = 1 then '' else 's' end
      || ' off the ' || lower(v_tree.name) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'pick_sprout' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not skill_check(skill_of(p_world, p_uid, 'forestry'), 15) then
      perform tell(p_world, p_uid, 'You find no sprout worth picking.', 'event');
      return;
    end if;
    perform give(p_world, p_uid, 'sprout', 1,
      product_ql(skill_of(p_world, p_uid, 'forestry')), v_tree.name);
    perform tell(p_world, p_uid, 'You pick a ' || lower(v_tree.name) || ' sprout.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'plant' then
    select * into v_sprout from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'sprout' and not locked order by id limit 1;
    if not found then return; end if;
    v_species := coalesce((select id from tree_def where name = v_sprout.extra), 0);
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 16);
    -- Species in the low nibble, age in the two bits above it: a planted tree
    -- starts as a sapling and grows on the same clock as one that seeded itself.
    perform land_set_data(p_world, tx, ty, v_species & 15);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You plant the '
      || lower((select name from tree_def where id = v_species)) || ' sprout.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'dig_worms' then
    v_gained := skill_raise(p_world, p_uid, 'digging', 0.2);
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id, 0.4); end if;
    -- Damp ground gives more than dry: a marsh is full of them.
    v_n := floor(random() * case when t.rich_worms then 5 else 3 end)::int
           + case when t.rich_worms then 1 else 0 end;
    if v_n = 0 then
      perform tell(p_world, p_uid, 'You turn a spadeful over and nothing is moving in it.', 'event');
      return;
    end if;
    perform give(p_world, p_uid, 'worm', v_n, 20 + random() * 40);
    perform tell(p_world, p_uid, 'You turn the dirt over and pick ' || v_n || ' worm'
      || case when v_n > 1 then 's' else '' end || ' out of it.', 'event');

  elsif p_action = 'prospect' then
    v_skill := skill_of(p_world, p_uid, 'prospecting');
    v_rad := prospect_radius(v_skill);
    v_size := (select size from world where id = p_world);
    -- Metal counts wherever it lies: bare, under soil, or below water.
    for v_row in select x, y, (bedrock_at(p_world, x, y)).name as nm
      from generate_series(greatest(0, tx - v_rad), least(v_size - 1, tx + v_rad)) x
      cross join generate_series(greatest(0, ty - v_rad), least(v_size - 1, ty + v_rad)) y
      where (bedrock_at(p_world, x, y)).ore
      order by y, x
    loop
      v_tiles := v_tiles || (v_row.y * v_size + v_row.x);
      v_names := v_names || lower(v_row.nm);
    end loop;
    perform mark_prospected(p_world, p_uid, v_tiles);

    -- Sampling where you stand tells you what that particular rock holds.
    v_rock := bedrock_at(p_world, tx, ty);
    v_ql := ore_max_ql((select seed from world where id = p_world), tx, ty);
    v_buried := case when here = 4 then ''
      else ' It lies under ' || greatest(1, land_dirt(p_world, tx, ty)) || ' of ground.' end;
    if v_rock.ore then
      perform tell(p_world, p_uid, 'You sample the ' || lower(v_rock.name)
        || '. It needs mining ' || to_char(v_rock.level, 'FM990')
        || ' to work' || case when skill_of(p_world, p_uid, 'mining') >= v_rock.level
                              then ', which you have' else '' end
        || ', and will give up nothing finer than quality ' || to_char(v_ql, 'FM990')
        || '.' || v_buried, 'event');
    else
      perform tell(p_world, p_uid, 'Plain ' || lower(v_rock.name)
        || ' beneath you, with no metal in it, and nothing finer than quality '
        || to_char(v_ql, 'FM990') || ' in the stone.' || v_buried, 'event');
    end if;

    if coalesce(array_length(v_tiles, 1), 0) = 0 then
      perform tell(p_world, p_uid, 'You read the ground ' || v_rad
        || ' tiles about you and find no sign of metal.', 'event');
    else
      perform tell(p_world, p_uid, 'Within ' || v_rad || ' tiles you read '
        || (select string_agg(case when n > 1 then n || ' tiles of ' || nm
                                   else 'a tile of ' || nm end, ' and ' order by nm)
            from (select nm, count(*) as n from unnest(v_names) nm group by nm) q)
        || ', buried or bare. They are marked for a while.', 'event');
    end if;
    v_gained := skill_raise(p_world, p_uid, 'prospecting', 1);
  end if;

  if v_gained > 0 then
    perform tell(p_world, p_uid, (select name from skill_def where id =
        (select skill from action_def where id = p_action))
      || ' increased by ' || to_char(v_gained, 'FM0.0000') || ' to '
      || to_char(skill_of(p_world, p_uid, (select skill from action_def where id = p_action)),
                 'FM990.0000'), 'skill');
  end if;
end $$;

/**
 * Examining a tile, corrected.
 *
 * The version that shipped an hour ago declared `b building` and assigned
 * `building_at()` to it, which returns the building's *number*. Postgres says
 * "malformed record literal" the moment it is handed one — so examining any
 * tile inside a building raised, and every tile outside one worked perfectly,
 * because `building_at` answers null out there and null goes into a row
 * variable without complaint. The suite examined the ground by the token,
 * which is exactly the case that does not fail, and the tile the browser
 * would have shown "It belongs to Mead Hall" for was never asked.
 */
create or replace function examine_tile_text(p_world uuid, p_x int, p_y int)
  returns text language plpgsql stable as $$
declare v_t int; v_data int; v_out text; v_extra text := ''; b building; v_id int; n int;
begin
  v_t := land_tile(p_world, p_x, p_y);
  v_data := land_data(p_world, p_x, p_y);
  if v_t = 16 then
    v_out := 'You see a '
      || (array['young', 'mature', 'old'])[least(3, greatest(1, tree_age(v_data) + 1))]
      || ' ' || lower((select name from tree_def where id = tree_species(v_data)))
      || ' tree at (' || p_x || ', ' || p_y || ').';
  elsif v_t = 17 then
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
  v_id := building_at(p_world, p_x, p_y);
  if v_id is not null then
    select * into b from building where world_id = p_world and id = v_id;
    if found then
      v_extra := v_extra || ' It belongs to ' || b.name || ', '
        || case when b.levels = 1 then 'a single-storey building'
                else b.levels || ' storeys tall' end || '.';
    end if;
  end if;
  select count(*) into n from crate c where c.world_id = p_world
    and p_x between c.x and c.x + c.sx - 1 and p_y between c.y and c.y + c.sy - 1;
  if n = 1 then v_extra := v_extra || ' A crate stands here.';
  elsif n > 1 then v_extra := v_extra || ' ' || n || ' crates stand here.'; end if;
  return v_out || v_extra;
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
      'plant', 'dig_worms', 'prospect')
      or exists (select 1 from recipe where id = p_action)
$$;

select private.lock_doors();
