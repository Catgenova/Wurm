-- The round trip, with an errand in it.

alter table creature add column if not exists fetching text;

create or replace function worker_job_ported(p_kind text) returns boolean
  language sql immutable as $$
  select p_kind in ('forage', 'botanize', 'woodcut', 'mine', 'quarry',
                    'sand', 'clay', 'peat', 'reed', 'fish', 'farm', 'fetch',
                    'hod', 'mend', 'stoke', 'plant', 'compost')
$$;

/** Clearing up: what is rotting on the ground goes back to the fields. */
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
    return on_deed(p_world, p_x, p_y) and creature_tile_ok(p_world, p_x, p_y)
       and exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                     and i.gx = p_x and i.gy = p_y);
  elsif p_kind = 'compost' then
    -- A carcass, or anything knocked about past saving.
    return on_deed(p_world, p_x, p_y) and creature_tile_ok(p_world, p_x, p_y)
       and exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                     and i.gx = p_x and i.gy = p_y and (i.def = 'corpse' or i.dmg >= 40));
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

/**
 * Walk a worker through as many whole trips as have come due.
 *
 * A gatherer goes out to a tile, works it, and carries a load home: idle, out,
 * work, home. An errand runner as often as not goes the other way — out of the
 * stores with a piece and off to wherever it is wanted — so there is one more
 * part, `fetch`, and for those the delivery *is* the work.
 *
 * Thirty round trips is as far back as anybody walks; past that the clock
 * catches up, the same rule a wild one's legs follow.
 */
create or replace function worker_settle(p_world uuid, p_id int) returns int
  language plpgsql as $$
declare c creature; d species_def; dd deed; cr crate; kind text; guard int := 0; done int := 0;
        spot record; stand record; step record; pace double precision; dist double precision;
        secs double precision; load jsonb; cx double precision; cy double precision;
        ax double precision; ay double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'deed' then return 0; end if;
  select * into dd from deed where world_id = p_world;
  if not found then
    update creature set mode = 'wild', phase = 'idle', job = null where world_id = p_world and id = p_id;
    return 0;
  end if;
  select * into d from species_def where id = c.species;
  kind := d.gathers;
  cr := deed_crate(p_world);
  pace := d.speed * (age_row(c.born)).speed * trait_mul(c.traits, 'speed')
          * (1 + greatest(1, task_skill(c)) / 500);

  while c.until <= now() and guard < 120 loop
    guard := guard + 1;
    cx := c.to_x; cy := c.to_y;

    if worker_errand(kind) then
      -- Everything an errand asks about is on the row, so the row goes down
      -- before it is asked.
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, fetching = c.fetching,
          settled_at = now()
        where world_id = p_world and id = p_id;

      if c.phase = 'fetch' then
        load := take_from_stores(p_world, c.fetching);
        if load is null then
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := now() + interval '4 seconds';
          exit;
        end if;
        c.carrying := load;
        c.fetching := null;
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '0.5 seconds';

      elsif c.phase = 'out' then
        c.phase := 'work';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / trait_mul(c.traits, 'work'));

      elsif c.phase = 'work' then
        if errand_do(p_world, p_id) then done := done + 1; end if;
        select * into c from creature where world_id = p_world and id = p_id;
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '1 second';

      else
        select * into step from errand_step(p_world, p_id);
        if step.gx is null then
          -- Nothing to run. Replaying an afternoon of that produces nothing.
          c.from_x := cx; c.from_y := cy;
          c.leg_at := now(); c.leg_ends := now();
          c.until := now() + interval '4 seconds';
          exit;
        end if;
        c.work_x := step.wx; c.work_y := step.wy;
        c.fetching := step.want;
        dist := sqrt((step.gx - cx) ^ 2 + (step.gy - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := step.gx; c.to_y := step.gy;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := case when step.want is null then 'out' else 'fetch' end;
      end if;
      continue;
    end if;

    if c.phase = 'out' then
      c.phase := 'work';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / trait_mul(c.traits, 'work'));

    elsif c.phase = 'work' then
      update creature set from_x = cx, from_y = cy, to_x = cx, to_y = cy,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, settled_at = now()
        where world_id = p_world and id = p_id;
      load := worker_do(p_world, p_id);
      select * into c from creature where world_id = p_world and id = p_id;
      done := done + 1;
      c.carrying := load;
      c.work_x := null; c.work_y := null;
      if load is null or cr.id is null then
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '1 second';
      else
        ax := crate_centre_x(cr); ay := crate_centre_y(cr);
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        secs := greatest(0.2, dist / greatest(0.1, pace));
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until; c.leg_ends := c.leg_at + make_interval(secs => secs);
        c.until := c.leg_ends;
        c.phase := 'home';
      end if;

    elsif c.phase = 'home' then
      if c.carrying is not null and crate_add(p_world, cr.id, c.carrying->>'def',
          (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra') then
        c.carrying := null;
      end if;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + interval '1 second';

    else
      select * into spot from find_work_tile(p_world, dd.x, dd.y, work_range(c), kind, c);
      if spot.x is null then
        c.from_x := cx; c.from_y := cy;
        c.to_x := dd.x + 0.5 + (hash_tile(p_id, guard, 601) * 2 - 1) * 3;
        c.to_y := dd.y + 0.5 + (hash_tile(p_id, guard, 701) * 2 - 1) * 3;
        if not creature_tile_ok(p_world, floor(c.to_x)::int, floor(c.to_y)::int) then
          c.to_x := cx; c.to_y := cy;
        end if;
        dist := sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2);
        c.leg_at := now();
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends + interval '4 seconds';
        exit;
      else
        if kind in ('woodcut', 'fish') then
          select * into stand from beside_tile(p_world, spot.x, spot.y);
          if stand.x is null then
            c.until := c.until + interval '4 seconds';
            continue;
          end if;
          ax := stand.x + 0.5; ay := stand.y + 0.5;
        else
          ax := spot.x + 0.5; ay := spot.y + 0.5;
        end if;
        c.work_x := spot.x; c.work_y := spot.y;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := 'out';
      end if;
    end if;
  end loop;

  if c.until <= now() then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now() + interval '1 second';
  end if;

  update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
      work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, fetching = c.fetching,
      settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $$;

/** And what a Middun brings home, which is the best thing that happens to a field. */
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

  elsif kind = 'compost' then
    -- Whatever it was, what comes back is compost, and the more of it the better.
    declare rot item;
    begin
      select * into rot from item where world_id = p_world and holder = 'ground'
        and gx = wx and gy = wy and (def = 'corpse' or dmg >= 40) order by id limit 1;
      if not found then return null; end if;
      delete from item where id = rot.id;
      return jsonb_build_object('def', 'compost', 'count', greatest(1, round(rot.count / 2.0)::int),
        'ql', least(100, 20 + skill * 0.6));
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
