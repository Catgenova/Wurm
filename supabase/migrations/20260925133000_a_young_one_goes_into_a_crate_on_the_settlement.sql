/*
 * A young one goes where a tamed one goes, and then into a crate standing on
 * the settlement.
 *
 * Asked for, of where a newborn goes: "Else goes into an empty crate placed
 * on deed".
 *
 * Births have been following the settlement rule since crates came in: a
 * young one joined the herd of its keeper's settlement, not put to work and
 * not counted against the deed's slots until it was grown. That was a way of
 * keeping a wildermon at the token under another name, and a way round the
 * slots besides -- a young one took no place going in and went on working
 * when it was grown. So there is no herd. A young one follows its keeper when
 * nothing else does; goes into an empty creature crate in their pack when
 * something does; and, when they carry none, into an empty crate of theirs
 * standing on their settlement, the nearest the dam. With none of those it
 * goes off into the wild. The browser says the same, in the same words.
 *
 * And with the herd goes what was only there for it: a young one set to work
 * the deed works, and takes its place on the books, as it did before crates.
 */

/* An empty creature crate of yours standing on your settlement, the nearest to (p_x, p_y). */
create or replace function standing_crate(p_world uuid, p_uid uuid, p_x double precision, p_y double precision) returns bigint
language sql stable as $$
  select pl.id from placed pl, my_deed(p_world, p_uid) dd
   where dd.world_id is not null and pl.world_id = p_world
     and pl.kind = 'furniture' and pl.sub = 'creature_crate' and pl.creature is null and pl.made_by = p_uid
     and abs(pl.x - dd.x) <= dd.radius and abs(pl.y - dd.y) <= dd.radius
   order by (pl.cx - p_x) ^ 2 + (pl.cy - p_y) ^ 2, pl.id
   limit 1
$$;

/*
 * The deed's books count what works it, which is everything on it that is not
 * at a post: one set to a post costs no settlement slot, which is most of what
 * a post is for.
 */
create or replace function workers_on_deed(p_world uuid, p_uid uuid) returns integer
language sql stable as $$
  select count(*)::int from creature c
   where c.world_id = p_world and c.keeper = p_uid and c.mode = 'deed' and c.post is null
$$;

CREATE OR REPLACE FUNCTION public.give_birth(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
/*
 * Every local prefixed, and the ninth and tenth times this class has bitten
 * were both in this one function: `born` is a column of `creature` and so is
 * `traits`, and an unprefixed local of either name inside `update creature` is
 * not a local at all. The rule is not "prefix the ones that have bitten", it
 * is "prefix all of them", and it has to be applied while writing rather than
 * while debugging.
 */
declare v_dam creature; v_d species_def; v_nx double precision; v_ny double precision;
        v_born int; v_coming jsonb; v_traits text[]; v_home record;
        v_mode text; v_where text := ''; v_crate bigint; v_placed bigint;
begin
  select * into v_dam from creature where world_id = p_world and id = p_id for update;
  if not found or v_dam.due is null or v_dam.due > now() then return 0; end if;
  v_coming := v_dam.unborn;
  update creature set unborn = null, due = null where world_id = p_world and id = p_id;
  if v_coming is null then return 0; end if;
  select * into v_d from species_def where id = v_dam.species;
  v_nx := creature_x(v_dam); v_ny := creature_y(v_dam);
  /*
   * Where it goes, now that nothing is kept at the token: where a tamed one
   * goes, and then a crate standing on the settlement -- with its keeper's
   * name on it, which a young one born at the token never had.
   *
   * A dam that is nobody's drops a wild one. Otherwise it follows its keeper
   * when nothing else does; goes into an empty creature crate in their pack
   * when something does; and, when they carry none, into an empty one of
   * theirs standing on their settlement, the nearest the dam. With none of
   * those it goes off into the wild.
   */
  v_mode := 'wild';
  if v_dam.keeper is not null and v_dam.mode <> 'wild' then
    if companion_of(p_world, v_dam.keeper) is null then
      v_mode := 'active';
      select py.x, py.y into v_home from player py where py.world_id = p_world and py.uid = v_dam.keeper;
      if found then v_nx := v_home.x; v_ny := v_home.y; end if;
      v_where := ' It follows you.';
    else
      v_crate := empty_crate(p_world, v_dam.keeper);
      if v_crate is null then v_placed := standing_crate(p_world, v_dam.keeper, v_nx, v_ny); end if;
      if v_crate is not null then
        v_mode := 'stored';
        v_where := ' It goes into the creature crate in your pack.';
      elsif v_placed is not null then
        v_mode := 'stored';
        select ' It goes into the empty creature crate at (' || pl.x || ', ' || pl.y || ') on '
               || coalesce((my_deed(p_world, v_dam.keeper)).name, 'your settlement') || '.'
          into v_where from placed pl where pl.id = v_placed;
      else
        v_where := ' Something already follows you and there is no empty creature crate in your pack or standing on your settlement, so it goes off into the wild.';
      end if;
    end if;
  end if;
  v_born := creature_spawn(p_world, v_dam.species, v_nx, v_ny,
    case when v_mode = 'stored' then 'active' else v_mode end, now(),
    case when v_mode = 'wild' then null else v_dam.keeper end);
  select array_agg(t) into v_traits from jsonb_array_elements_text(v_coming->'traits') t;
  update creature set traits = coalesce(v_traits, '{}'), sex = v_coming->>'sex',
      hunger = 0.9, care = 0.5
    where world_id = p_world and id = v_born;
  update creature c set health = max_health(c) where c.world_id = p_world and c.id = v_born;
  if v_mode = 'stored' then perform crate_shut_in(p_world, v_born, v_crate, v_placed); end if;
  if v_dam.keeper is not null then
    perform journal_note(p_world, v_dam.keeper, 'bred');
    -- Blood worth keeping, which is the whole point of putting two together.
    if exists (select 1 from unnest(coalesce(v_traits, '{}')) t
               join trait_def td on td.id = t where td.tier in ('supreme', 'fantastic')) then
      perform journal_note(p_world, v_dam.keeper, 'goodblood');
    end if;
    perform tell(p_world, v_dam.keeper, v_dam.name || ' drops a young ' || lower(v_d.name)
      || ' (' || (v_coming->>'sex') || '): ' || trait_names(coalesce(v_traits, '{}'))
      || '.' || v_where, 'event');
  end if;
  return v_born;
end $function$;

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
            /*
             * A tile of its trade with nowhere to stand and work it from.
             *
             * This added four seconds and went round again, and round again
             * re-derived the very same tile: `find_work_tile` walks the rings
             * outward from the site and hands back the first thing that
             * passes, so nothing about waiting changes which tile that is.
             * The only thing that could is the ground itself. A beast in here
             * stands still for ever and says nothing, which is the shape of
             * every bad hour this island has had lately.
             *
             * It is unreachable today, and that is worth being plain about:
             * `worker_gatherable` demands `face_reach`, and `face_reach` only
             * passes without standing room when `beside_tile` has something in
             * it, so the two cannot presently disagree. This is written as a
             * refusal rather than a retry so that the next rule added to one
             * of them and not the other is a worker that goes quiet and gets
             * reported, not one that spins in silence.
             *
             * Having found a tile it cannot work is having found nothing, so
             * it leaves by the same door: the idle clock starts, and an hour
             * of it is a word to the keeper.
             */
            c.idle_since := coalesce(c.idle_since, now());
            perform worker_idle(p_world, c, kind, v_site.x, v_site.y, v_site.radius, v_site.post);
            c.from_x := cx; c.from_y := cy;
            c.leg_at := now(); c.leg_ends := now();
            c.until := now() + interval '4 seconds';
            exit;
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

CREATE OR REPLACE FUNCTION public.crate_open_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_at record; v_c creature; v_cur creature; v_d species_def; v_dd deed;
begin
  select * into v_at from crate_aimed(p_world, p_uid, p_target);
  if v_at.v_item is null and v_at.v_placed is null then return 'That is not a creature crate.'; end if;
  if v_at.v_creature is null then return 'The crate is empty.'; end if;
  select * into v_c from creature where world_id = p_world and id = v_at.v_creature;
  if not found then return 'The crate is empty.'; end if;
  if v_c.mode <> 'stored' then return v_c.name || ' is not in it.'; end if;
  if v_c.keeper is distinct from p_uid then return v_c.name || ' is not yours to let out.'; end if;
  if v_at.v_placed is not null and not placed_in_reach(p_world, p_uid, v_at.v_placed) then
    return 'Stand next to the crate.';
  end if;
  if p_action = 'crate_follow' then
    select * into v_cur from creature where world_id = p_world and keeper = p_uid and mode = 'active' limit 1;
    if v_cur.id is not null and v_cur.hitched_to is not null then
      return v_cur.name || ' is in the traces, and would have to go into the crate in its place. Take it out first.';
    end if;
    if v_cur.id is not null and v_cur.rider is not null then
      return 'Get down off ' || v_cur.name || ' first: it goes into the crate in its place.';
    end if;
    return null;
  end if;
  v_dd := my_deed(p_world, p_uid);
  if v_dd.world_id is null then return 'You have no settlement to set it to work on.'; end if;
  select * into v_d from species_def where id = v_c.species;
  if v_d.gathers is null then return 'A ' || lower(v_d.name) || ' has no trade to be set to.'; end if;
  if not worker_job_ported(v_d.gathers) then
    return 'Nobody has taught this island what '
      || (select plain from gather_def where id = v_d.gathers) || ' looks like yet.';
  end if;
  if workers_on_deed(p_world, p_uid) >= worker_cap(p_world, p_uid) then
    return v_dd.name || ' has work for ' || worker_cap(p_world, p_uid) || ' wildermon at level '
      || v_dd.level || '. Upgrade the settlement to take on more.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_crate_open(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_at record; v_c creature; v_cur creature; v_d species_def;
begin
  if crate_open_refusal(p_world, p_uid, p_action, p_target) is not null then return; end if;
  select * into v_at from crate_aimed(p_world, p_uid, p_target);
  select * into v_c from creature where world_id = p_world and id = v_at.v_creature for update;
  select * into v_d from species_def where id = v_c.species;
  if p_action = 'crate_follow' then
    select * into v_cur from creature where world_id = p_world and keeper = p_uid and mode = 'active' limit 1;
    perform crate_let_out(p_world, v_c.id);
    update creature set mode = 'active', enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = v_c.id;
    if v_cur.id is not null then
      perform crate_shut_in(p_world, v_cur.id, v_at.v_item, v_at.v_placed);
      perform tell(p_world, p_uid, v_c.name || ' comes out of the crate and follows you. '
        || v_cur.name || ' goes into the crate in its place.', 'system');
    else
      perform tell(p_world, p_uid, v_c.name || ' comes out of the crate and follows you.', 'system');
    end if;
    perform creature_settle(p_world, v_c.id);
  else
    perform crate_let_out(p_world, v_c.id);
    update creature set mode = 'deed', keeper = p_uid, phase = 'idle', job = v_d.gathers,
        work_x = null, work_y = null, carrying = null, enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = v_c.id returning * into v_c;
    perform tell(p_world, p_uid, v_c.name || ' comes out of the crate and will ' || deed_job_line(v_c) || '.', 'system');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.companion_swap(p_world uuid, p_uid uuid, p_taking creature, OUT v_current integer, OUT v_to text, OUT v_why text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_cur creature; v_dd deed; v_freed int; v_adds int;
begin
  select * into v_cur from creature
   where world_id = p_world and keeper = p_uid and mode = 'active' and id <> p_taking.id limit 1;
  if v_cur.id is null then return; end if;
  v_current := v_cur.id;
  if v_cur.hitched_to is not null then v_why := v_cur.name || ' is in the traces. Take it out first.'; return; end if;
  if v_cur.rider is not null then v_why := 'Get down off ' || v_cur.name || ' first.'; return; end if;
  v_dd := my_deed(p_world, p_uid);
  -- What the deed counts once the one being taken is off it and this one is on it.
  v_freed := case when p_taking.mode = 'deed' and p_taking.post is null then 1 else 0 end;
  v_adds := 1;
  if v_dd.world_id is not null
     and workers_on_deed(p_world, p_uid) - v_freed + v_adds <= worker_cap(p_world, p_uid) then
    v_to := 'deed';
    return;
  end if;
  if empty_crate(p_world, p_uid) is not null then v_to := 'crate'; return; end if;
  v_why := case when v_dd.world_id is not null
    then v_cur.name || ' has nowhere to go: ' || v_dd.name || ' has work for ' || worker_cap(p_world, p_uid)
         || ' wildermon at level ' || v_dd.level || ', and you carry no empty creature crate.'
    else v_cur.name || ' has nowhere to go: you have no settlement to set it to work on, and you carry no empty creature crate.' end;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_creature(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; food text; n int; made_ql double precision;
        gained double precision; chance double precision; warm double precision; nm text;
        held int; brush_id bigint; top double precision; before double precision; skill double precision;
        dd deed; v_swap int; v_to text; v_why text;
begin
  -- Opening a crate is asked of the crate, standing or carried.
  if p_action in ('crate_follow', 'crate_work') then
    perform perform_crate_open(p_world, p_uid, p_action, p_target);
    return;
  end if;
  c := target_creature(p_world, p_target);
  if c.world_id is null then return; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born);

  if p_action = 'examine_creature' then
    if c.mode = 'wild' and d.monster then
      perform tell(p_world, p_uid, 'A ' || lower(d.name) || ': ' || d.description
        || ' It has ' || ceil(c.health) || ' of ' || max_health(c) || ' in it and hits for '
        || to_char(attack_of(c), 'FM990') || '. It cannot be tamed. Kill it and butcher it, or keep well clear.', 'error');
    elsif c.mode = 'wild' then
      warm := coax_bonus(c);
      perform tell(p_world, p_uid, 'A wild ' || lower(d.name) || ': ' || d.description
        || ' It eats ' || diet_text(c.species) || '.'
        || case when warm > 0 then ' It has taken ' ||
             case when c.coaxed = 1 then 'an offering' else c.coaxed || ' offerings' end
             || ' from your hand and is ' || to_char(warm * 100, 'FM990') || '% readier for the next.'
           else '' end
        || ' You would have to tame it to learn more.', 'event');
    else
      perform tell(p_world, p_uid, c.name || ' (' || c.sex || ' ' || lower(d.name) || ', ' || a.name
        || '): ' || d.description || ' Level ' || creature_level(c.skills)
        || '. Health ' || ceil(c.health) || '/' || max_health(c) || '. It is ' || care_word(c.care)
        || ' and carries ' || trait_names(c.traits) || '. '
        || case when c.hunger < 0.3 then 'It looks hungry.' when c.hunger < 0.6 then 'It could eat.'
                else 'It looks well fed.' end
        || ' It eats ' || diet_text(c.species) || '.', 'event');
    end if;

  elsif p_action = 'tame' then
    food := bait_in_pack(p_world, p_uid, c.species);
    if food is null then return; end if;
    -- The crate may have gone out of the pack since the offering was begun.
    if tame_room_refusal(p_world, p_uid) is not null then
      perform tell(p_world, p_uid, tame_room_refusal(p_world, p_uid), 'error');
      return;
    end if;
    if not consume(p_world, p_uid, food, 1) then return; end if;
    chance := tame_chance(p_world, p_uid, c);
    update creature set hunger = least(1, hunger + 0.25) where world_id = p_world and id = c.id;
    if random() < chance then
      held := companion_of(p_world, p_uid);
      update creature set mode = 'active', stance = 'defensive', keeper = p_uid, coaxed = 0, coaxed_at = null
        where world_id = p_world and id = c.id;
      -- One follows you; every one after that goes into the crate you carry.
      if held is not null then perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null); end if;
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' takes the '
        || material_name(food, 1) || ' from your hand and trusts you. '
        || case when held is null then c.name || ' now follows you.'
             else 'It goes into the creature crate in your pack: set the crate down, or open it to have it follow you or work the deed.' end,
        'system');
      perform journal_note(p_world, p_uid, 'tamed');
      perform skill_told(p_world, p_uid, 'taming', try_gain(true, tame_gain()));
      perform skill_told(p_world, p_uid, 'soul_strength', try_gain(true, tame_nerve()));
    else
      -- It refused, but it stayed for the offering, and that is worth
      -- something to the next one.
      update creature set coaxed = coaxed + 1, coaxed_at = now()
        where world_id = p_world and id = c.id returning * into c;
      warm := coax_bonus(c);
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' '
        || replace(d.tame_fail, '{food}', material_name(food, 1)) || '.'
        -- No ceiling on it any more, so nothing here says there is one: this
        -- read "as used to you as it will get" from the fourth offering on,
        -- which was true then and is not now.
        || case when warm > 0 then ' It is growing used to you: '
             || to_char(warm * 100, 'FM990') || '% readier than the first time.'
           else '' end, 'event');
      perform skill_told(p_world, p_uid, 'taming', try_gain(false, tame_gain()));
      perform skill_told(p_world, p_uid, 'soul_strength', try_gain(false, tame_nerve()));
    end if;

  elsif p_action = 'feed' then
    food := bait_in_pack(p_world, p_uid, c.species);
    if food is null or not consume(p_world, p_uid, food, 1) then return; end if;
    update creature set hunger = least(1, hunger + 0.5) where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' gobbles up the ' || material_name(food, 1) || '.', 'event');

  elsif p_action = 'groom' then
    select i.id into brush_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'brush'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    skill := skill_of(p_world, p_uid, 'animal_husbandry');
    before := c.care;
    top := max_health(c);
    update creature set
        care = least(1, care + 0.18 + (skill / 100) * 0.34
                          + (least(100, tool_ql(p_world, p_uid, 'brush')) / 100) * 0.22),
        -- A brushing is also a looking-over: it finds the small hurts.
        health = least(top, health + top * 0.06)
      where world_id = p_world and id = c.id returning * into c;
    if brush_id is not null then perform wear_tool(brush_id, 3); end if;
    perform journal_note(p_world, p_uid, 'groom');
    if c.care >= 0.995 then perform journal_note(p_world, p_uid, 'groomfull'); end if;
    gained := skill_told(p_world, p_uid, 'animal_husbandry', 0.4);
    perform tell(p_world, p_uid, case when before < 0.12 and c.care >= 0.12
        then 'You work the dust out of ' || c.name || '''s coat. It leans into the brush. ('
        else 'You brush ' || c.name || ' down. (' end || care_word(c.care) || ')', 'event');

  elsif p_action = 'shear' then
    -- A full fleece is three, a half-grown one is one, and quality follows the fleece.
    n := greatest(1, round(c.fleece * case when coalesce(d.shear_yield, 'wool') = 'wool' then 3 else 6 end)::int);
    made_ql := greatest(1, least(100, 15 + c.fleece * 45 + skill_of(p_world, p_uid, 'tailoring') * 0.4));
    perform gather(p_world, p_uid, coalesce(d.shear_yield, 'wool'), n, made_ql);
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'tailoring', 0.4);
    perform skill_told(p_world, p_uid, 'taming', 0.1);
    perform tell(p_world, p_uid, 'You '
      || case when coalesce(d.shear_yield, 'wool') = 'wool' then 'shear' else 'pluck' end
      || ' ' || c.name || ' and come away with ' || n || ' '
      || lower((select coalesce(name, 'wool') from item_def where id = coalesce(d.shear_yield, 'wool')))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ') It will grow back.', 'event');

  elsif p_action = 'milk_creature' then
    if not consume(p_world, p_uid, 'bucket', 1) then return; end if;
    -- What it has been fed on is what comes out of it.
    made_ql := greatest(1, least(100, 20 + c.fleece * 40 + c.hunger * 30));
    perform give(p_world, p_uid, 'milk_bucket', 1, made_ql);
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'farming', 0.3);
    perform tell(p_world, p_uid, 'You milk ' || c.name || ' into the bucket. (QL '
      || to_char(made_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'set_stance' then
    update creature set stance = p_target->>'stance' where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will be ' || (p_target->>'stance') || '.', 'info');

  elsif p_action = 'rename_creature' then
    nm := left(btrim(p_target->>'name'), 24);
    update creature set name = nm where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'It answers to ' || nm || ' now.', 'info');

  elsif p_action = 'take_creature' then
    -- The one following you takes its place, on the deed or in a crate you carry.
    select sw.v_current, sw.v_to, sw.v_why into v_swap, v_to, v_why from companion_swap(p_world, p_uid, c) sw;
    if v_why is not null then return; end if;
    if c.carrying is not null then
      perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
        c.carrying->>'def', coalesce((c.carrying->>'ql')::double precision, 1), c.carrying->>'extra',
        coalesce((c.carrying->>'count')::int, 1));
    end if;
    update creature set mode = 'active', keeper = p_uid, post = null, carrying = null, phase = 'idle',
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = c.id;
    perform creature_settle(p_world, c.id);
    perform tell(p_world, p_uid, c.name || ' now follows you.', 'system');
    if v_to = 'deed' then
      update creature set mode = 'deed', job = (select s.gathers from species_def s where s.id = creature.species),
          phase = 'idle', work_x = null, work_y = null, carrying = null, enemy = null, hunting = null,
          settled_at = now()
        where world_id = p_world and id = v_swap returning * into c;
      perform tell(p_world, p_uid, c.name || ' stays behind in its place, and will ' || deed_job_line(c) || '.', 'info');
    elsif v_to = 'crate' then
      perform crate_shut_in(p_world, v_swap, empty_crate(p_world, p_uid), null);
      perform tell(p_world, p_uid, (select q.name from creature q where q.world_id = p_world and q.id = v_swap)
        || ' goes into the creature crate in your pack.', 'info');
    end if;

  elsif p_action = 'crate_creature' then
    if empty_crate(p_world, p_uid) is null or c.mode not in ('active', 'deed') then return; end if;
    perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null);
    perform tell(p_world, p_uid, c.name || ' goes into the creature crate. Set the crate down and it can be seen inside.', 'system');

  elsif p_action = 'assign_deed' then
    -- The same key, missed in the same place: this is the token the wildermon
    -- is being put to work around, so it is the caller's own, not whichever
    -- one the planner happened to hand back first. On an island with two
    -- settlements it teleported a stored beast to a stranger's token.
    dd := my_deed(p_world, p_uid);
    -- The trade it was asked for by name, or its species' own. The door has
    -- already said the name is one of its trades.
    update creature set mode = 'deed', keeper = p_uid, phase = 'idle',
        job = coalesce(nullif(p_target->>'job', ''), d.gathers),
        work_x = null, work_y = null, carrying = null,
        from_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        from_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        to_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        to_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select plain from gather_def where id = coalesce(nullif(p_target->>'job', ''), d.gathers)), 'stay around the settlement')
      || ' within ' || work_range(c) || ' tiles of the token and bring what it finds to the crate.', 'system');

  elsif p_action = 'release_creature' then
    -- Out of its crate first, at the crate's door.
    if c.mode = 'stored' then perform crate_let_out(p_world, c.id); end if;
    -- Blood takes generations to build and a moment to walk away.
    update creature set mode = 'wild', stance = 'passive', keeper = null,
        name = d.name, coaxed = 0, coaxed_at = null, until = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' ' || d.leaves || '.', 'system');

  elsif p_action = 'cull_creature' then
    /*
     * One action, and it is done.
     *
     * A beast you keep could always be killed — by swinging at it until it
     * stopped, which is a strange thing to have to do to your own livestock
     * and takes as long as fighting a wild one. This is the short way, and it
     * leaves exactly what the long way left: a carcass on the tile, for the
     * knife.
     *
     * Walked forward first, so the carcass lands where the body actually is;
     * a kept one stands at the token, which `creature_settle` has already
     * seen to. Whatever it was carrying is not buried with it.
     */
    perform creature_settle(p_world, c.id);
    -- One in a crate is let out of it first: the carcass lies at the crate's door.
    if c.mode = 'stored' then perform crate_let_out(p_world, c.id); end if;
    select * into c from creature where world_id = p_world and id = c.id;
    if c.world_id is null then return; end if;
    if c.carrying is not null then
      perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
        c.carrying->>'def', coalesce((c.carrying->>'ql')::double precision, 1),
        c.carrying->>'extra', coalesce((c.carrying->>'count')::int, 1));
      update creature set carrying = null where world_id = p_world and id = c.id;
    end if;
    nm := c.name;
    -- Past any soak its blood could put in the way: this is not a blow, it is
    -- a decision. `wound_beast` is told nobody struck it, so it writes no
    -- hunter's line and no "you kill the wild one" — the words below are what
    -- happened.
    perform wound_beast(p_world, c.id, 1e9, null, null, null, null);
    perform tell(p_world, p_uid, 'You put ' || nm || ' down. The ' || lower(d.name)
      || '''s carcass lies where it stood, ready for the knife.', 'fight');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; food text; held int; working int; cap int;
begin
  -- Opening a crate you carry is asked of the crate, not of a creature.
  if p_action in ('crate_follow', 'crate_work') then
    return crate_open_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Walked forward before it is looked at: where it was is not where it is.
  perform creature_settle(p_world, (p_target->>'id')::int);
  c := target_creature(p_world, p_target);
  if c.world_id is null then return 'It is gone.'; end if;
  select * into d from species_def where id = c.species;

  -- In the traces until somebody takes it out: nothing that would send it
  -- anywhere else is open to it, in the words culling one already uses.
  if p_action in ('assign_deed', 'take_creature', 'crate_creature', 'release_creature')
     and c.hitched_to is not null then
    return c.name || ' is in the traces. Take it out first.';
  end if;

  -- Only your own is yours to send anywhere, put in a crate, order about or name.
  if p_action in ('take_creature', 'assign_deed', 'crate_creature', 'release_creature', 'cull_creature',
                  'set_stance', 'rename_creature')
     and c.mode <> 'wild' and c.keeper is distinct from p_uid then
    return c.name || ' is not yours.';
  end if;

  if p_action not in ('examine_creature', 'assign_deed')
     and not creature_in_reach(p_world, p_uid, c) then
    return case when c.mode = 'wild' then 'The ' || lower(d.name) || ' is not close enough.'
                else 'Stand next to ' || c.name || '.' end;
  end if;

  if p_action = 'tame' then
    if d.monster then
      return 'A ' || lower(d.name) || ' is not a wildermon. There is nothing to be done with it but kill it.';
    end if;
    if c.mode <> 'wild' then return c.name || ' is already yours.'; end if;
    if skill_of(p_world, p_uid, 'taming') < d.tame_level then
      return 'You need taming ' || to_char(d.tame_level, 'FM990.#') || ' to try.';
    end if;
    if bait_in_pack(p_world, p_uid, c.species) is null then
      return d.name || 's take ' || diet_text(c.species) || '. Bring some.';
    end if;
    -- The first follows you, and every one after that goes into a crate you carry.
    return tame_room_refusal(p_world, p_uid);

  elsif p_action = 'assign_deed' then
    if c.mode = 'wild' then return 'It is not yours to set to work.'; end if;
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Open the crate to set it to work.'; end if;
    if (my_deed(p_world, p_uid)).world_id is null then
      return 'You have no settlement to assign it to.';
    end if;
    if d.gathers is null then return 'A ' || lower(d.name) || ' has no trade to be set to.'; end if;
    -- A trade asked for by name has to be one of its own.
    if nullif(p_target->>'job', '') is not null
       and not (p_target->>'job' = d.gathers or p_target->>'job' = any(coalesce(d.trades, '{}'::text[]))) then
      return 'A ' || lower(d.name) || ' cannot be set to that.';
    end if;
    if not worker_job_ported(coalesce(nullif(p_target->>'job', ''), d.gathers)) then
      return 'Nobody has taught this island what '
        || (select plain from gather_def where id = coalesce(nullif(p_target->>'job', ''), d.gathers))
        || ' looks like yet.';
    end if;
    -- One off a post takes a place as much as one off the road, since a post costs none.
    if c.mode <> 'deed' or c.post is not null then
      working := workers_on_deed(p_world, p_uid);
      cap := worker_cap(p_world, p_uid);
      if working >= cap then
        return (my_deed(p_world, p_uid)).name || ' has work for ' || cap
          || ' wildermon at level ' || cap || '. Upgrade the settlement to take on more.';
      end if;
    end if;
    return null;

  elsif p_action = 'feed' then
    if c.mode not in ('active', 'deed') then return 'It is not yours to feed.'; end if;
    if bait_in_pack(p_world, p_uid, c.species) is null then
      return 'It eats ' || diet_text(c.species) || '.';
    end if;
    return null;

  elsif p_action = 'groom' then
    if d.monster then return 'Not that. Not ever.'; end if;
    if c.mode = 'wild' then return 'It is not yours to brush.'; end if;
    if pack_count(p_world, p_uid, 'brush') <= 0 then return 'You need a brush.'; end if;
    if c.care >= 0.995 then return c.name || ' has been brushed to a shine already.'; end if;
    return null;

  elsif p_action = 'shear' then
    if d.fleece is null then return 'There is nothing on it worth shearing.'; end if;
    if c.mode = 'wild' then return 'Tame it first; it will not stand still for you otherwise.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') <= 0 then return 'You need a knife to shear with.'; end if;
    if c.fleece < 0.35 then
      return c.name || ' has hardly any '
        || case when d.shear_yield = 'feather' then 'feathers' else 'fleece' end || ' back yet.';
    end if;
    return null;

  elsif p_action = 'milk_creature' then
    if not d.milk then return 'That is not something you milk.'; end if;
    if c.mode in ('wild', 'stored') then return 'It is not yours to milk.'; end if;
    if pack_count(p_world, p_uid, 'bucket') <= 0 then return 'You need an empty bucket.'; end if;
    if c.sex <> 'female' then return c.name || ' is male. Nothing is coming out of him.'; end if;
    if c.fleece < 0.4 then return c.name || ' has nothing to give yet.'; end if;
    return null;

  elsif p_action = 'set_stance' then
    if c.mode <> 'active' then return 'Only a companion takes orders like that.'; end if;
    if coalesce(p_target->>'stance', '') not in ('passive', 'defensive', 'aggressive') then
      return 'Passive, defensive or aggressive.';
    end if;
    return null;

  elsif p_action = 'rename_creature' then
    if c.mode = 'wild' then return 'It is not yours to name.'; end if;
    if nullif(btrim(coalesce(p_target->>'name', '')), '') is null then return 'Choose a name.'; end if;
    return null;

  elsif p_action = 'take_creature' then
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Open the crate to let it out.'; end if;
    if c.mode <> 'deed' then return 'It is already with you.'; end if;
    -- Where the one following you now goes, or why it has nowhere to.
    return (companion_swap(p_world, p_uid, c)).v_why;

  elsif p_action = 'crate_creature' then
    if c.mode = 'stored' then return c.name || ' is already in a creature crate.'; end if;
    if c.mode not in ('active', 'deed') then return 'It is not yours to put in a crate.'; end if;
    if c.rider is not null then return 'Get down off ' || c.name || ' first.'; end if;
    if empty_crate(p_world, p_uid) is null then return 'You need an empty creature crate in your pack.'; end if;
    return null;

  elsif p_action = 'release_creature' then
    if c.mode = 'wild' then return 'It is already wild.'; end if;
    return null;

  elsif p_action = 'cull_creature' then
    -- Only your own, and only one that is not in the traces or under you when
    -- you ask: both of those are a mess this does not have to make.
    if c.mode = 'wild' then return 'That one is nobody''s. Fight it if you mean it.'; end if;
    if c.hitched_to is not null then return c.name || ' is in the traces. Take it out first.'; end if;
    if c.rider is not null then return 'Get down off ' || c.name || ' first.'; end if;
    return null;
  end if;
  return null;
end $function$;
