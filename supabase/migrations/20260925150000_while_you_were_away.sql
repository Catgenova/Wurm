/*
 * While you were away.
 *
 * Asked for: "'While you were away' on login. Summarise what your workers
 * gathered, births, stall sales and parcels. Today only rotted items get a
 * line, and only in solo saves."
 *
 * The island tells you each of these as it happens, into the event log, one
 * line at a time: a worker's load says nothing at all, a birth and a sale
 * and a parcel say a line each. Come back after a night and the log is a
 * hundred lines of whatever happened last, or nothing, and none of it adds
 * up.
 *
 * So the island keeps a count for you while you are away -- `away_tally`,
 * one row for each sort of thing: a load of logs brought home, a young
 * rabba, planks sold, parcels from Bryn -- and `rpc_join` hands the counts
 * over when you come back and forgets them. Nothing is counted while you
 * are there to see it: `away_count` writes only for somebody whose
 * `player.away` is set, which the clock sets after `idle_logout()` seconds
 * without a word from their browser.
 *
 *   haul     a worker's load put into a store, by item, counted in items;
 *   born     a young one born to a wildermon of yours that stayed yours, by
 *            species;
 *   strayed  a young one born to a wildermon of yours that went off into the
 *            wild, because something already followed you and there was no
 *            empty creature crate to put it in;
 *   sold     a thing bought off one of your stalls, by item, with the silver
 *            it went into the till for;
 *   parcel   a parcel posted to you, by who sent it.
 */
set local lock_timeout = '3s';

select private.shut($ddl$
create table if not exists away_tally (
  world_id uuid not null,
  uid uuid not null,
  what text not null check (what in ('haul', 'born', 'strayed', 'sold', 'parcel')),
  -- The item, the species, or the name of whoever sent the parcel.
  def text not null,
  n bigint not null default 0 check (n >= 0),
  silver bigint not null default 0 check (silver >= 0),
  primary key (world_id, uid, what, def),
  foreign key (world_id, uid) references player (world_id, uid) on delete cascade
)$ddl$);
select private.shut('alter table away_tally enable row level security');
-- Read by `rpc_join` alone, for the one person it is about.
select private.shut('revoke all on away_tally from anon, authenticated');

/*
 * Counts something for somebody while they are away, and does nothing while
 * they are here to see it for themselves.
 */
create or replace function away_count(p_world uuid, p_uid uuid, p_what text, p_def text,
                                      p_n bigint, p_silver bigint default 0) returns void
language sql as $$
  insert into away_tally as t (world_id, uid, what, def, n, silver)
  select p_world, p_uid, p_what, p_def, p_n, coalesce(p_silver, 0)
   where p_uid is not null and p_def is not null and coalesce(p_n, 0) > 0
     and exists (select 1 from player where world_id = p_world and uid = p_uid and away)
  on conflict (world_id, uid, what, def) do update
    set n = t.n + excluded.n, silver = t.silver + excluded.silver
$$;

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
        if v_in then
          -- Counted for its keeper, if they are away: what came home while they were gone.
          perform away_count(p_world, c.keeper, 'haul', c.carrying->>'def', (c.carrying->>'count')::bigint);
          c.carrying := null;
        end if;
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
    perform away_count(p_world, v_dam.keeper, case when v_mode = 'wild' then 'strayed' else 'born' end,
                       v_dam.species, 1);
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

CREATE OR REPLACE FUNCTION public.rpc_buy(p_world uuid, p_item bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_it item; v_pl placed; p player; v_name text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  select * into v_it from item where world_id = p_world and id = p_item for update;
  if not found or v_it.price is null or v_it.placed is null then
    return jsonb_build_object('why', 'That is not for sale.');
  end if;
  select * into v_pl from placed where world_id = p_world and id = v_it.placed;
  if not found then return jsonb_build_object('why', 'That is not for sale.'); end if;
  if v_pl.made_by = me then
    return jsonb_build_object('why', 'It is your own stall. Take it back off the counter instead.');
  end if;
  if greatest(abs(v_pl.x + 0.5 - p.x), abs(v_pl.y + 0.5 - p.y)) > 2.4 then
    return jsonb_build_object('why', 'Stand at the counter.');
  end if;
  if purse(p_world, me) < v_it.price then
    return jsonb_build_object('why', 'You cannot afford it. It is ' || v_it.price || ' silver.');
  end if;
  if not take_coins(p_world, me, v_it.price) then
    return jsonb_build_object('why', 'You cannot afford it.');
  end if;
  update placed set till = till + v_it.price where world_id = p_world and id = v_pl.id;
  v_name := lower(coalesce((select name from item_def where id = v_it.def), v_it.def));
  update item set holder = 'player', holder_uid = me, placed = null, price = null
    where world_id = p_world and id = v_it.id;
  perform pack_fold_one(v_it.id);
  if v_pl.made_by is not null then
    perform tell(p_world, v_pl.made_by, folk_name(p_world, me) || ' buys your ' || v_name
      || ' for ' || v_it.price || ' silver.', 'event');
    perform away_count(p_world, v_pl.made_by, 'sold', v_it.def, v_it.count, v_it.price);
  end if;
  return jsonb_build_object('bought', v_name, 'paid', v_it.price);
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_parcel(p_world uuid, p_uid uuid, p_text text, p_items bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_box placed; v_n bigint; v_count int; v_mine int; v_said jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  v_count := coalesce(array_length(p_items, 1), 0);
  if v_count = 0 then return rpc_letter(p_world, p_uid, p_text); end if;
  v_box := mailbox_at(p_world, me);
  if v_box.id is null then
    return jsonb_build_object('why', 'Stand at a mailbox to send anything but words.');
  end if;
  select count(*) into v_mine from item i
    where i.world_id = p_world and i.id = any(p_items)
      and i.holder = 'player' and i.holder_uid = me and i.deal is null and not i.locked;
  if v_mine <> v_count then
    return jsonb_build_object('why', 'Some of that is not yours to send, or is locked.');
  end if;
  -- The words first, through the door that already rate-limits and cleans
  -- them; a parcel with no letter to ride in is not a thing the post carries.
  v_said := rpc_letter(p_world, p_uid, coalesce(nullif(btrim(coalesce(p_text, '')), ''), 'A parcel.'));
  if v_said ? 'why' then return v_said; end if;
  v_n := (v_said->>'n')::bigint;
  if v_n is null then
    select max(n) into v_n from letter where world_id = p_world and sender = me and reader = p_uid;
  end if;
  update item set holder = 'post', holder_uid = p_uid, letter = v_n,
                  crate = null, placed = null
    where world_id = p_world and id = any(p_items);
  perform tell(p_world, p_uid, folk_name(p_world, me) || ' has sent you a parcel. (Any mailbox)', 'system');
  perform away_count(p_world, p_uid, 'parcel', folk_name(p_world, me), 1);
  return v_said || jsonb_build_object('parcel', v_count);
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_join(p_world uuid, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); w world; p player; born boolean := false; v_look jsonb; v_was_away boolean := false;
        v_since timestamptz; v_away jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into w from world where id = p_world;
  if not found then raise exception 'no such island'; end if;
  if not w.ready then raise exception 'that island is still being laid down'; end if;
  select a.look into v_look from account a where a.uid = me;

  select * into p from player where world_id = p_world and uid = me;
  if not found then
    insert into player (world_id, uid, name, x, y, stats, look)
    values (p_world, me, coalesce(nullif(trim(p_name), ''), 'Wanderer'), w.spawn_x + 0.5, w.spawn_y + 0.5,
            '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb,
            look_clean(coalesce(v_look, look_random())))
    returning * into p;
    born := true;
    perform starter_kit(p_world, me);
    perform tell(p_world, me, 'You wash ashore on an untouched island with a few tools and your wits.', 'system');
  else
    v_was_away := p.away;
    v_since := coalesce(p.left_at, p.seen_at);
    select jsonb_agg(jsonb_build_object('what', t.what, 'def', t.def, 'n', t.n, 'silver', t.silver)
                     order by t.what, t.n desc, t.def)
      into v_away from away_tally t where t.world_id = p_world and t.uid = me;
    delete from away_tally where world_id = p_world and uid = me;
    update player set seen_at = now(), away = false, left_at = null,
           name = coalesce(nullif(trim(p_name), ''), name),
           look = look_clean(coalesce(v_look, nullif(player.look, '{}'::jsonb), look_random()))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me,
      case when v_was_away then 'You come back to the island. Whatever you were doing has long since stopped.'
           else 'Your journey continues where you left off.' end, 'system');
  end if;

  return jsonb_build_object(
    'world', to_jsonb(w) - 'made_by',
    'you', to_jsonb(p),
    'new', born,
    'time', world_time(p_world),
    -- What happened to your things while you were away, and for how long you were.
    'away', case when v_away is not null then jsonb_build_object(
      'secs', greatest(0, extract(epoch from now() - v_since))::bigint, 'tally', v_away) end);
end $function$;

select private.lock_doors();
