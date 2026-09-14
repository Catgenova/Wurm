-- Wildermon set to work on the deed.
--
-- ## A worker is a round trip
--
-- A wild creature wanders: legs with no purpose, and the last one is as good
-- an answer as any to where it is. A worker is doing something, and a round
-- trip has parts — out to a tile, work it, back to the crate, put the load
-- down — each of which begins and ends at a moment. So a worker is stored as
-- which part of the trip it is in and when that part is over, and settling it
-- walks it through as many whole trips as have come due.
--
-- Which means the result of an hour of a worker's labour is a loop over the
-- clock rather than an hour of simulation: the logs are in the crate because
-- the arithmetic says they would be, and nothing had to be running to put
-- them there.

/* ------------------------------------------------------------------ *
 * Somewhere to put a load down.
 * ------------------------------------------------------------------ */

/**
 * The settlement's own crate.
 *
 * Only this one, for now: crates you make, place and stuff by hand are their
 * own family. This is the one the token comes with, and it is here because a
 * worker that has nowhere to put a log is a worker doing nothing.
 */
create table if not exists crate (
  world_id uuid not null references world on delete cascade,
  id int not null,
  kind text not null default 'plank' check (kind in ('log', 'plank')),
  x int not null,
  y int not null,
  sx int not null default 1,
  sy int not null default 1,
  material text,
  name text,
  /** The settlement's own, which is where a worker takes things by default. */
  deed boolean not null default false,
  primary key (world_id, id)
);
alter table crate enable row level security;
drop policy if exists crate_read on crate;
create policy crate_read on crate for select to authenticated using (true);
grant select on crate to authenticated;
revoke insert, update, delete on crate from anon, authenticated;

-- What is in one. `holder = 'crate'` and the crate's own number, which is not
-- an item number, so it wants a column of its own rather than `inside`.
alter table item add column if not exists crate int;
create index if not exists item_in_crate on item (world_id, crate) where holder = 'crate';

create or replace function crate_capacity(c crate) returns int language sql stable as $$
  select round(case c.kind when 'log' then 30 else 60 end
    * coalesce((mat_of(c.material)).hold, 1))::int
$$;

create or replace function crate_units(p_world uuid, p_id int) returns int language sql stable as $$
  select coalesce(sum(count), 0)::int from item
  where world_id = p_world and holder = 'crate' and crate = p_id
$$;

create or replace function crate_centre_x(c crate) returns double precision
  language sql immutable as $$ select c.x + (c.sx + 0.5) / 4.0 $$;
create or replace function crate_centre_y(c crate) returns double precision
  language sql immutable as $$ select c.y + (c.sy + 0.5) / 4.0 $$;

create or replace function deed_crate(p_world uuid) returns crate language sql stable as $$
  select * from crate where world_id = p_world and deed order by id limit 1
$$;

/** Put something in a crate, or say it would not go. */
create or replace function crate_add(p_world uuid, p_id int, p_def text, p_count int,
    p_ql double precision, p_extra text default null) returns boolean
  language plpgsql as $$
declare c crate; stacks boolean; into_id bigint;
begin
  select * into c from crate where world_id = p_world and id = p_id;
  if not found then return false; end if;
  if crate_units(p_world, p_id) + p_count > crate_capacity(c) then return false; end if;
  select coalesce(d.stackable, false) into stacks from item_def d where d.id = p_def;
  if stacks then
    select i.id into into_id from item i
    where i.world_id = p_world and i.holder = 'crate' and i.crate = p_id and i.def = p_def
      and i.extra is not distinct from p_extra
    limit 1;
    if into_id is not null then
      update item set ql = (ql * count + p_ql * p_count) / (count + p_count), count = count + p_count
        where id = into_id;
      return true;
    end if;
  end if;
  insert into item (world_id, holder, crate, gx, gy, def, ql, count, extra)
  values (p_world, 'crate', p_id, c.x, c.y, p_def, greatest(0, least(100, p_ql)), p_count, p_extra);
  return true;
end $$;

/** Stand the settlement's crate beside the token, on the first tile that will have it. */
create or replace function place_deed_crate(p_world uuid) returns int
  language plpgsql as $$
declare d deed; spot record; new_id int;
begin
  select * into d from deed where world_id = p_world;
  if not found or (deed_crate(p_world)).id is not null then return null; end if;
  select gx, gy into spot from (values (1, 0), (0, 1), (-1, 0), (0, -1), (1, 1)) as v(dx, dy),
    lateral (select d.x + v.dx as gx, d.y + v.dy as gy) q
  where in_bounds(p_world, q.gx, q.gy) and passable(p_world, q.gx, q.gy)
    and not has_water(p_world, q.gx, q.gy)
    and building_at(p_world, q.gx, q.gy) is null
    and not exists (select 1 from crate cr where cr.world_id = p_world and cr.x = q.gx and cr.y = q.gy)
  limit 1;
  if not found then return null; end if;
  select coalesce(max(id), 0) + 1 into new_id from crate where world_id = p_world;
  insert into crate (world_id, id, kind, x, y, sx, sy, deed) values (p_world, new_id, 'plank', spot.gx, spot.gy, 1, 1, true);
  return new_id;
end $$;

/* ------------------------------------------------------------------ *
 * The worker itself.
 * ------------------------------------------------------------------ */

alter table creature add column if not exists job text;
alter table creature add column if not exists phase text not null default 'idle';
alter table creature add column if not exists work_x int;
alter table creature add column if not exists work_y int;
alter table creature add column if not exists carrying jsonb;

/** How long a worker takes over a task: twice what a player of the same skill would. */
create or replace function work_duration(p_skill double precision) returns double precision
  language sql immutable as $$ select 2 * greatest(1.2, 5 * (1 - p_skill / 140)) $$;

/** A worker's task skill, or 1 for a species with no trade. */
create or replace function task_skill(c creature) returns double precision
  language sql stable as $$
  select coalesce((c.skills->>(select skill from gather_def where id =
    (select gathers from species_def where id = c.species)))::double precision, 1)
$$;

/** Every ten levels of its trade let a worker range ten tiles further from the token. */
create or replace function work_range(c creature) returns int language sql stable as $$
  select round((d.work_range + floor(task_skill(c) / 10) * 10) * trait_mul(c.traits, 'range'))::int
  from species_def d where d.id = c.species
$$;

create or replace function workers_on_deed(p_world uuid) returns int language sql stable as $$
  select count(*)::int from creature where world_id = p_world and mode = 'deed'
$$;

/** How many wildermon may work the deed at this level. */
create or replace function worker_cap(p_world uuid) returns int language sql stable as $$
  select coalesce((select level from deed where world_id = p_world), 0)
$$;

/** One tile to one worker: nobody else's seam, tree or field. */
create or replace function claimed(p_world uuid, p_x int, p_y int, p_id int) returns boolean
  language sql stable as $$
  select exists (select 1 from creature c where c.world_id = p_world and c.mode = 'deed'
    and c.id <> p_id and c.work_x = p_x and c.work_y = p_y and c.phase in ('out', 'work'))
$$;

/** A tile beside one that cannot be stood on: a tree, or open water. */
create or replace function beside_tile(p_world uuid, p_x int, p_y int)
  returns table (x int, y int) language sql stable as $$
  select p_x + dx, p_y + dy from (values (1,0), (-1,0), (0,1), (0,-1)) as v(dx, dy)
  where creature_tile_ok(p_world, p_x + dx, p_y + dy)
  limit 1
$$;

/**
 * Whether a tile is worth a worker walking to, for its trade.
 *
 * Every one of these rules is already in this database somewhere — a forage
 * bed's cooldown, a seam's metal and its level, a field that has come ripe.
 * A worker is not a second set of rules, it is the same ones with nobody
 * watching.
 */
create or replace function worker_gatherable(p_world uuid, p_x int, p_y int, p_kind text, c creature)
  returns boolean language plpgsql stable as $$
declare here int; t tile_def; rock rock_def;
begin
  if not in_bounds(p_world, p_x, p_y) or claimed(p_world, p_x, p_y, c.id) then return false; end if;
  here := land_tile(p_world, p_x, p_y);
  select * into t from tile_def where id = here;

  if p_kind = 'woodcut' then
    -- Any tree with somewhere to stand beside it. An old one is worth a log
    -- more, which is the felling's business rather than the choosing's.
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
  elsif p_kind = 'farm' then
    -- Only ground that has been tilled and sown; a worker never rakes a field
    -- of its own, and it does not sow one either — that wants seeds in its
    -- cheeks, which is a piece still to come.
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
 * The nearest tile to the token worth working, searched ring by ring outwards.
 *
 * Written as a scan of the whole square first, which is correct and costs the
 * same whether the answer is under the worker's nose or nowhere: two workers
 * half an hour behind took four seconds to catch up, nearly all of it looking
 * at ground they had no need to look at. Outwards from the token, stopping at
 * the first ring with anything in it, is both what the browser does and what
 * the cost wants — and the ring is shuffled so two workers do not queue up on
 * the same tile.
 */
create or replace function find_work_tile(p_world uuid, p_cx int, p_cy int, p_range int,
    p_kind text, c creature)
  returns table (x int, y int) language plpgsql stable as $$
declare ring int; spot record;
begin
  for ring in 0..p_range loop
    for spot in
      select p_cx + dx as gx, p_cy + dy as gy
      from generate_series(-ring, ring) dx, generate_series(-ring, ring) dy
      where greatest(abs(dx), abs(dy)) = ring
      order by random()
    loop
      if worker_gatherable(p_world, spot.gx, spot.gy, p_kind, c) then
        x := spot.gx; y := spot.gy;
        return next;
        return;
      end if;
    end loop;
  end loop;
  return;
end $$;

select private.lock_doors();

/* ------------------------------------------------------------------ *
 * What a worker learns, and what it brings back.
 * ------------------------------------------------------------------ */

/** A beast learns on the same curve a player does, at half the pace. */
create or replace function worker_learn(p_world uuid, p_id int, p_skill text, p_base double precision)
  returns double precision language plpgsql as $$
declare was double precision; now_v double precision;
begin
  was := coalesce((select (skills->>p_skill)::double precision from creature
                   where world_id = p_world and id = p_id), 1);
  now_v := least(100, was + skill_gain_of(was, p_base, 0.6 + 0.8 * random()));
  update creature set skills = jsonb_set(skills, array[p_skill], to_jsonb(now_v)), xp = xp + (now_v - was)
    where world_id = p_world and id = p_id;
  return now_v - was;
end $$;

/**
 * Do the job, once, and hand back what it is carrying home — or null, because
 * a trip out is not always a trip back with something.
 *
 * Every rule underneath this is the one a player gets. A worker rolls like a
 * player of its own skill, wears the same forage cooldown into the ground,
 * fells the same tree and leaves the rest of it at the stump.
 */
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

/**
 * Walk a worker through as many whole round trips as have come due.
 *
 * Four parts, each of which begins and ends at a moment: out to the tile,
 * work it, home to the crate, put the load down. Thirty round trips — a
 * hundred and twenty of those parts — is as far back as anybody walks; past
 * that the clock catches up, exactly as it does for a wild one's legs, because
 * an island left alone for a week should not cost a week of arithmetic the
 * first time somebody looks at it.
 */
create or replace function worker_settle(p_world uuid, p_id int) returns int
  language plpgsql as $$
declare c creature; d species_def; dd deed; cr crate; kind text; guard int := 0; done int := 0;
        spot record; stand record; pace double precision; dist double precision; secs double precision;
        load jsonb; cx double precision; cy double precision; ax double precision; ay double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'deed' then return 0; end if;
  select * into dd from deed where world_id = p_world;
  if not found then
    -- No settlement to work for any more.
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

    if c.phase = 'out' then
      -- Arrived at the tile. Now the work, which takes as long as it takes.
      c.phase := 'work';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / trait_mul(c.traits, 'work'));

    elsif c.phase = 'work' then
      -- Write back where it stands before the job reads the row.
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
        -- Nothing to carry, or nowhere to carry it: back to pottering.
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
      -- At the crate. In it goes, if it will go in.
      if c.carrying is not null and crate_add(p_world, cr.id, c.carrying->>'def',
          (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra') then
        c.carrying := null;
      end if;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + interval '1 second';

    else
      -- Idle: look for something to do, and potter if there is nothing.
      select * into spot from find_work_tile(p_world, dd.x, dd.y, work_range(c), kind, c);
      if spot.x is null then
        /*
         * Nothing to do. Replaying half an hour of finding nothing costs a
         * search every four seconds and produces exactly nothing, so the
         * catch-up stops here: it has been pottering, and it is pottering now.
         */
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
        -- A tree cannot be stood on and neither can the water: both are
        -- worked from beside.
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

  -- Thirty round trips is as far back as anybody walks.
  if c.until <= now() then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now() + interval '1 second';
  end if;

  update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
      work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $$;

select private.lock_doors();
