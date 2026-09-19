/*
 * A mola may work a shore face, and may not work the sea floor.
 *
 * "Allow mola to mine ore, seams and rock at up to -10 water level just like
 * players." It could not, and the reason was a question asked in the wrong
 * shape: the only test either side ever ran on a mining tile was whether a
 * body could stand on it.
 */

/*
 * A face a body can reach, which is not the same as one it can stand on.
 *
 * A person may put a pick to a corner under ten units of water — `mine_depth`,
 * about waist deep — and the browser's note on it says in as many words that
 * you work standing in it. That is what a shore quarry is, and it is the whole
 * reason anybody digs at a shore at all.
 *
 * Neither side let a wildermon do it, and the two sides were wrong in opposite
 * directions. The browser asked only whether the beast could stand on the
 * tile, which allows a single unit of water, so a mola would not touch ore,
 * seam or rock below the tide line — reported exactly so. This island asked
 * nothing whatever: `worker_gatherable` had no reach test on either mining
 * trade, so a worker here would happily set about the sea floor at forty
 * fathoms, which is the same rule broken the other way.
 *
 * One rule now, and it is the person's: ten units of water, and a face too
 * deep to stand on is worked from the bank — which is what `beside_tile` is
 * for and what a feller, a pruner, an angler and a fruit picker have always
 * done. Past ten it is over everybody's head.
 *
 * The depth allowance alone would still have changed nothing, because there
 * was a second waterline rule in the way wearing different clothes:
 * `rock_height > 1`. That reads as "is there any rock standing here" and is
 * not — `rock_height` is the bedrock's own height, so bedrock at minus three
 * is bedrock three under the sea, and every submerged tile failed it however
 * shallow. The floor under both mining trades is the person's floor now, ten
 * under, which is the only floor a person has.
 */
/*
 * And a bank on any of the eight sides rather than four.
 *
 * The browser has always looked at all eight; this looked at north, south,
 * east and west, so a face whose only dry neighbour was on a corner was a face
 * nothing could be worked from. It is the same list a feller, a pruner, an
 * angler and a fruit picker stand on, and they had the same hole in it.
 */
create or replace function beside_tile(p_world uuid, p_x int, p_y int)
  returns table(x int, y int) language sql stable as $$
  select p_x + dx, p_y + dy
  from (values (1,0), (-1,0), (0,1), (0,-1), (1,1), (1,-1), (-1,1), (-1,-1)) as v(dx, dy)
  where creature_tile_ok(p_world, p_x + dx, p_y + dy)
  limit 1
$$;

create or replace function face_reach(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  -- Standing on it is still the first answer, and the usual one. Otherwise the
  -- only two questions are how much water is over the face and whether there
  -- is a bank to swing from; its own slope is not asked about, because that is
  -- a question about standing on it and nobody is going to.
  select creature_tile_ok(p_world, p_x, p_y)
      or (centre_height(p_world, p_x, p_y) >= -mine_depth()
          and exists (select 1 from beside_tile(p_world, p_x, p_y)))
$$;

-- worker_gatherable: a face is work when a body can reach it.
CREATE OR REPLACE FUNCTION public.worker_gatherable(p_world uuid, p_x integer, p_y integer, p_kind text, c creature)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
declare here int; t tile_def; rock rock_def;
begin
  if not in_bounds(p_world, p_x, p_y) or claimed(p_world, p_x, p_y, c.id) then return false; end if;
  here := land_tile(p_world, p_x, p_y);
  select * into t from tile_def where id = here;

  if p_kind = 'woodcut' then
    return here = tile_id('Tree') and exists (select 1 from beside_tile(p_world, p_x, p_y));
  elsif p_kind = 'prune' then
    -- What would otherwise die: a stage that prunes back and whose next stage
    -- has no life in it. Nothing else is touched — a mature tree pruned stops
    -- bearing, and a sapling pruned is a shrub for good.
    return here = tile_id('Tree') and exists (select 1 from beside_tile(p_world, p_x, p_y))
       and exists (select 1 from tree_age_def a join tree_age_def n on n.id = a.next
                    where a.id = tree_age(land_data(p_world, p_x, p_y))
                      and a.pruned is not null and not n.alive);
  elsif p_kind = 'fruit' then
    -- A bearing tree with something on it, and a tile beside it to stand on.
    return here = tile_id('Tree') and exists (select 1 from beside_tile(p_world, p_x, p_y))
       and not is_foraged(p_world, p_x, p_y, 'forage')
       and exists (select 1 from tree_def td, tree_age_def a
                    where td.id = tree_species(land_data(p_world, p_x, p_y))
                      and a.id = tree_age(land_data(p_world, p_x, p_y))
                      and td.fruit is not null and a.bears and a.alive);
  elsif p_kind = 'stump' then
    return here = tile_id('Stump') and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'mine' then
    rock := bedrock_at(p_world, p_x, p_y);
    return here = tile_id('Rock') and rock.seam and rock.level <= task_skill(c)
       and rock_height(p_world, p_x, p_y) > -mine_depth() and face_reach(p_world, p_x, p_y);
  elsif p_kind = 'quarry' then
    rock := bedrock_at(p_world, p_x, p_y);
    return here = tile_id('Rock') and not rock.seam and rock_height(p_world, p_x, p_y) > -mine_depth()
       and face_reach(p_world, p_x, p_y);
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
  elsif p_kind = 'seek' then
    -- Ground nobody has been over yet, which is the only ground worth a nose.
    return t.diggable and not has_water(p_world, p_x, p_y)
       and creature_tile_ok(p_world, p_x, p_y)
       and not is_foraged(p_world, p_x, p_y, 'dig');
  elsif p_kind = 'fetch' then
    return on_my_deed(p_world, c.keeper, p_x, p_y) and creature_tile_ok(p_world, p_x, p_y)
       and exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                     and i.gx = p_x and i.gy = p_y);
  elsif p_kind = 'compost' then
    -- A carcass, or anything knocked about past saving.
    return on_my_deed(p_world, c.keeper, p_x, p_y) and creature_tile_ok(p_world, p_x, p_y)
       and exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                     and i.gx = p_x and i.gy = p_y and (i.def = 'corpse' or i.dmg >= 40));
  elsif p_kind = 'farm' then
    perform crop_settle(p_world, p_x, p_y);
    if exists (select 1 from crop cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y
      and (cr.stage >= crop_ripe() or not cr.tended_now)) then return true; end if;
    /*
     * And a field with nothing in it, which was never work at all: the island
     * knew how to weed a crop and how to reap one and not how to sow one, so a
     * seavic walked over bare fields with seed sitting in the crate behind it.
     * Reported exactly so.
     */
    /*
     * And seed lying on a field that is already sown, which this tile has no
     * use for. Reported as "seavics also move seeds to storage if not using
     * them when working deed": a harvest leaves its seed in the furrow, the
     * next sowing takes one of them, and the rest sat there under the growing
     * crop where nobody could see, count or cook them. Picking them up is
     * work, so it is work here.
     */
    if exists (select 1 from crop cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y)
       and exists (select 1 from item i join crop_def sd on sd.seed = i.def
                    where i.world_id = p_world and i.holder = 'ground'
                      and i.gx = p_x and i.gy = p_y)
    then return true; end if;
    return land_tile(p_world, p_x, p_y) = tile_id('Field')
       and not exists (select 1 from crop cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y)
       and (sow_seed(p_world, c, p_x, p_y)).id is not null;
  elsif p_kind = 'forage' then
    return coalesce(t.forage, false) and not is_foraged(p_world, p_x, p_y, 'forage')
       and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'botanize' then
    return coalesce(t.botanize, false) and not is_foraged(p_world, p_x, p_y, 'botanize')
       and creature_tile_ok(p_world, p_x, p_y);
  end if;
  return false;
end $function$;

-- worker_settle: walk to the bank when the face cannot be stood on.
CREATE OR REPLACE FUNCTION public.worker_settle(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; kind text; guard int := 0; done int := 0;
        spot record; stand record; step record; pace double precision; dist double precision;
        secs double precision; load jsonb; cx double precision; cy double precision;
        ax double precision; ay double precision; v_foe creature; v_corpse item;
        v_step record; v_site record; v_store record; v_in boolean;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'deed' then return 0; end if;
  /*
   * Where it takes its orders from. A post stands in for a settlement, and a
   * worker with neither has nobody to take them from at all.
   */
  select * into v_site from work_site(p_world, c);
  if v_site.x is null then
    /*
     * Let go, and told.
     *
     * A worker with neither a post nor a settlement to take orders from is
     * turned loose — which is right, because the cap on how many you may keep
     * is your settlement's level and it is nought without one. What was wrong
     * was doing it in silence. From the island: a wildermon that had been
     * working stood about on fifty tiles of forage it could have been on, and
     * nothing anywhere said it had stopped being a worker. The rules were
     * doing exactly as written and the only broken thing was that nobody was
     * told.
     */
    update creature set mode = 'wild', phase = 'idle', job = null, post = null
      where world_id = p_world and id = p_id;
    if c.keeper is not null then
      perform tell(p_world, c.keeper,
        c.name || ' has no settlement to work for and has gone back to its own business.', 'event');
    end if;
    return 0;
  end if;
  select * into d from species_def where id = c.species;
  -- The trade it was set to, which is its species' own unless it was told otherwise.
  kind := coalesce(c.job, d.gathers);
  pace := d.speed * (age_row(c.born)).speed * beast_mul(c, 'speed')
          * (1 + greatest(1, task_skill(c)) / 500);

  while c.until <= now() and guard < 120 loop
    guard := guard + 1;
    cx := c.to_x; cy := c.to_y;

    /*
     * Company first.
     *
     * Nothing works while something is coming at it, and the two trades that
     * fight for a living are always looking for company. A worker breaks off
     * between jobs rather than mid-load: what is already in its arms goes in
     * the crate before it goes for anything, which is the one place this is
     * tidier than the browser.
     */
    if c.phase = 'strike' then
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, enemy = c.enemy,
          settled_at = now()
        where world_id = p_world and id = p_id;
      if c.enemy is not null and creature_attack(p_world, p_id, c.enemy) then done := done + 1; end if;
      select * into c from creature where world_id = p_world and id = p_id;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      continue;

    elsif c.phase = 'stalk' then
      -- Arrived where the carcass went down. If somebody else has had it, the
      -- walk was wasted, which is what happens to a hunter now and then.
      c.carrying := take_from_ground(p_world, c.work_x, c.work_y, 'corpse');
      c.work_x := null; c.work_y := null;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + interval '0.5 seconds';
      continue;
    end if;

    if fight_trade(kind) and c.phase = 'idle' and c.carrying is not null then
      select * into v_store from worker_store(p_world, c, c.carrying->>'def', (c.carrying->>'count')::int);
      if v_store.id is null then
        c.until := now() + interval '30 seconds';
        exit;
      end if;
      ax := v_store.cx; ay := v_store.cy;
      dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
      c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
      c.until := c.leg_ends;
      c.phase := 'home';
      continue;
    end if;

    if c.phase = 'idle' and c.carrying is null
       and (fight_trade(kind) or c.enemy is not null or c.stance <> 'passive') then
      v_foe := fight_target(p_world, p_id);
      if v_foe.id is null then
        c.enemy := null;
      else
        if c.enemy is distinct from v_foe.id then
          -- It has just seen it. A guard trains its back by keeping watch; a
          -- hunter learns the country by hunting it.
          if fight_trade(kind) then
            perform worker_learn(p_world, p_id,
              case when kind = 'hunt' then 'fighting' else 'body_strength' end,
              case when kind = 'hunt' then 0.08 else 0.1 end);
          end if;
          c.enemy := v_foe.id;
        end if;
        ax := creature_x(v_foe); ay := creature_y(v_foe);
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        if dist <= fight_reach(kind) then
          c.phase := 'strike';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := c.until + make_interval(secs => fight_blow(kind) / beast_mul(c, 'haste'));
        else
          select * into v_step from chase_leg(p_world, cx, cy,
            cx + (ax - cx) * (dist - 1) / dist, cy + (ay - cy) * (dist - 1) / dist);
          if v_step.x is null then
            -- Nothing open at all: the browser gives up here too.
            c.enemy := null;
            c.until := c.until + interval '2 seconds';
          else
            c.from_x := cx; c.from_y := cy;
            c.to_x := v_step.x; c.to_y := v_step.y;
            c.leg_at := c.until;
            c.leg_ends := c.leg_at + make_interval(secs =>
              greatest(0.2, sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2)
                            / greatest(0.1, pace * fight_pace(kind))));
            c.until := c.leg_ends;
          end if;
        end if;
        continue;
      end if;
    end if;

    if kind = 'hunt' and c.phase = 'idle' and c.carrying is null then
      if c.work_x is not null and not exists (select 1 from item i
           where i.world_id = p_world and i.holder = 'ground'
             and i.gx = c.work_x and i.gy = c.work_y and i.def = 'corpse') then
        c.work_x := null; c.work_y := null;
      end if;
      if c.work_x is null then
        v_corpse := carcass_near(p_world, v_site.x, v_site.y, v_site.radius, cx, cy);
        if v_corpse.id is not null then c.work_x := v_corpse.gx; c.work_y := v_corpse.gy; end if;
      end if;
      if c.work_x is not null then
        ax := c.work_x + 0.5; ay := c.work_y + 0.5;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := 'stalk';
        continue;
      end if;
    end if;

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
        c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / beast_mul(c, 'work'));

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
      c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / beast_mul(c, 'work'));

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
      if load is null then
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '1 second';
      else
        select * into v_store from worker_store(p_world, c, load->>'def', (load->>'count')::int);
        if v_store.id is null then
          -- Everything on the deed is full. A worker will not tip a load out
          -- on the ground: it holds it and waits for room, and says so, once
          -- in a while rather than once a job.
          perform worker_nowhere(p_world, c);
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := now() + interval '30 seconds';
          exit;
        end if;
        ax := v_store.cx; ay := v_store.cy;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        secs := greatest(0.2, dist / greatest(0.1, pace));
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until; c.leg_ends := c.leg_at + make_interval(secs => secs);
        c.until := c.leg_ends;
        c.phase := 'home';
      end if;

    elsif c.phase = 'home' then
      /*
       * Wherever the room is *now*. A crate that had room when the walk began
       * may be full by the time the load arrives — somebody else filled it, or
       * another worker got there first — and the old rule walked to the
       * settlement's crate, failed quietly into a full one and carried the
       * load back out to the fields. Reported as workers overdelivering to a
       * full crate with an empty one standing beside it.
       */
      if c.carrying is not null then
        select * into v_store from worker_store(p_world, c, c.carrying->>'def', (c.carrying->>'count')::int);
        if v_store.id is null then
          perform worker_nowhere(p_world, c);
          c.until := now() + interval '30 seconds';
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          exit;
        end if;
        if sqrt((v_store.cx - cx) ^ 2 + (v_store.cy - cy) ^ 2) > 1.6 then
          -- The room is somewhere else now: walk there rather than stand at a
          -- full crate holding a load.
          dist := sqrt((v_store.cx - cx) ^ 2 + (v_store.cy - cy) ^ 2);
          c.from_x := cx; c.from_y := cy; c.to_x := v_store.cx; c.to_y := v_store.cy;
          c.leg_at := c.until;
          c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
          c.until := c.leg_ends;
          continue;
        end if;
        if v_store.kind = 'crate' then
          v_in := crate_add(p_world, v_store.id::int, c.carrying->>'def',
            (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra');
        else
          v_in := furniture_add(p_world, v_store.id, c.carrying->>'def',
            (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra');
        end if;
        if v_in then c.carrying := null; end if;
      end if;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + interval '1 second';

    else
      select * into spot from find_work_tile(p_world, v_site.x, v_site.y, v_site.radius, kind, c);
      if spot.x is null then
        c.from_x := cx; c.from_y := cy;
        c.to_x := v_site.x + 0.5 + (hash_tile(p_id, guard, 601) * 2 - 1) * 3;
        c.to_y := v_site.y + 0.5 + (hash_tile(p_id, guard, 701) * 2 - 1) * 3;
        if not creature_tile_ok(p_world, floor(c.to_x)::int, floor(c.to_y)::int) then
          c.to_x := cx; c.to_y := cy;
        end if;
        dist := sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2);
        c.leg_at := now();
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends + interval '4 seconds';
        exit;
      else
        -- Worked from the bank when there is no standing on it: always for a
        -- tree, a rod or a fruit bough, and for a rock face when the water
        -- over it is deeper than a beast can wade.
        if kind in ('woodcut', 'prune', 'fish', 'fruit')
           or (kind in ('mine', 'quarry') and not creature_tile_ok(p_world, spot.x, spot.y)) then
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
      enemy = c.enemy, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $function$;

select private.lock_doors();
