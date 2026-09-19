-- A worker with nothing to do says so
--
-- Reported, more than once and from more than one angle: a mola standing
-- about on a deed doing nothing. Every reading offered for it was reasonable
-- — it is trying to mine the vein under the paving; it is stuck on a seam it
-- cannot work — and the island knew the answer the whole time and had no way
-- of saying it.
--
-- `worker_settle` looks for a tile of its trade, and when `find_work_tile`
-- comes back with nothing it wanders a few tiles off the token and waits four
-- seconds. Then it does it again. Forever, in silence. From outside that is
-- indistinguishable from a beast that is broken, and every guess anybody
-- makes about which of a dozen rules is in the way is a guess the island
-- could have settled in a sentence.
--
-- `worker_nowhere` already does this for the other way a worker gets stuck —
-- holding a load with nowhere to put it — down to the ten-minute spacing on
-- `told_at`, and this is its sibling.
--
-- ---- and an hour of it, not a moment of it ------------------------------
--
-- The first cut of this said it the instant a worker found nothing, and the
-- suite caught it on the one measurement written to: 996 asserts that a
-- plucka set to fruit is "told of nothing but its work", and a plucka that
-- has just stripped the orchard for the day finds nothing the very next tick.
-- It is not stuck. It is finished until tomorrow, and a line every ten
-- minutes about it is noise laid over a beast doing its job perfectly.
--
-- So `idle_since` is stamped when a worker first comes up empty and cleared
-- the moment it finds anything, and nothing is said until it has been empty
-- for an hour of real time. A run of the suite is seconds of real time, so a
-- working beast stays quiet; an orchard picked at dawn gets one line, once,
-- some hours later; and a mola that has never had anything to mine says so
-- while somebody is still watching it.
--
-- The line names the three things a keeper would otherwise have to work out:
-- what it is looking for, how far it can see, and from where. The radius is
-- `work_range` — eight tiles for a fresh beast, widening by ten for every ten
-- points of the skill — measured from the deed token unless the worker is on
-- a post, which is the thing most likely to be the answer.

alter table creature add column if not exists idle_since timestamptz;

create or replace function work_words(p_kind text) returns text
  language sql immutable as $fn$
  select case p_kind
    when 'woodcut' then 'trees to fell'
    when 'prune'   then 'trees worth pruning'
    when 'fruit'   then 'fruit on the bough'
    when 'stump'   then 'stumps to dig out'
    when 'mine'    then 'bare rock with a seam in it'
    when 'quarry'  then 'bare rock to cut'
    when 'sand'    then 'sand to dig'
    when 'clay'    then 'clay to dig'
    when 'peat'    then 'peat to cut'
    when 'reed'    then 'reeds to cut'
    when 'fish'    then 'water worth a rod'
    when 'seek'    then 'ground worth turning over'
    when 'farm'    then 'fields wanting work'
    else 'work' end
$fn$;

/**
 * How long a worker must have had nothing to do before it is worth saying so.
 * An hour of real time: long enough that a trade which runs dry for the rest
 * of the day is not a complaint, short enough that somebody watching a beast
 * that has never worked at all gets an answer the same afternoon.
 */
create or replace function idle_before_telling() returns interval
  language sql immutable as $fn$ select interval '1 hour' $fn$;

create or replace function worker_idle(p_world uuid, c creature, p_kind text,
                                       p_x int, p_y int, p_radius int, p_post bigint)
returns void language plpgsql as $fn$
declare v_since timestamptz;
begin
  if c.keeper is null then return; end if;
  select idle_since into v_since from creature where world_id = p_world and id = c.id;
  -- Empty for a moment is between jobs; empty for an hour is stuck.
  if v_since is null or v_since > now() - idle_before_telling() then return; end if;
  -- The same ten minutes, off the same stamp, as `worker_nowhere`: one line
  -- per worker per ten minutes is the budget, and a worker that is both idle
  -- and full only needs telling once that it wants looking at.
  if (select told_at from creature where world_id = p_world and id = c.id) > now() - interval '10 minutes'
    then return; end if;
  update creature set told_at = now() where world_id = p_world and id = c.id;
  perform tell(p_world, c.keeper, c.name || ' can find no ' || work_words(p_kind)
    || ' within ' || p_radius || ' tiles of '
    || case when p_post is not null then 'its work post' else 'the token' end
    || ' at ' || p_x || ',' || p_y || '. '
    || case when p_kind in ('mine', 'quarry')
         then 'A seam under soil or paving is not a face; the rock has to be bare. '
         else '' end
    || 'Put it on a work post nearer the work, or raise its skill to widen the search.', 'error');
end $fn$;

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
        -- Nothing of its trade anywhere it can reach. It wanders a few tiles
        -- and waits, which from outside is a beast standing about for no
        -- reason anybody is ever told. The clock on it starts here; whether
        -- that is worth a word is `worker_idle`'s to decide, and it wants an
        -- hour of it before it says anything, so that a trade which has run
        -- dry for the day is not mistaken for one that is stuck.
        c.idle_since := coalesce(c.idle_since, now());
        perform worker_idle(p_world, c, kind, v_site.x, v_site.y, v_site.radius, v_site.post);
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
        -- Anything found at all, and the idle clock starts over.
        c.idle_since := null;
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
      idle_since = c.idle_since,
      enemy = c.enemy, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $function$;

select private.lock_doors();
