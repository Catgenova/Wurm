-- Creatures that come at you unprompted.
--
-- ## Time only passes for a hunter while you are there to be hunted
--
-- Everything else that settles lazily settles from a timestamp and needs
-- nothing else: a fire knows how long it has been burning, a crop knows when
-- it was sown. A hunt needs a second thing, and that thing is you — and the
-- island has no record of where you were between two looks, only where you
-- are at the moment of each. So a hunter cannot have been closing on a path
-- nobody wrote down, and an hour of absence is not an hour of being chased.
--
-- What the elapsed seconds buy, then, is the ground it covers toward where
-- you *are*, and the blows that land once it arrives — and no more of them
-- than could have fallen between two looks, because the rest of that hour it
-- spent alone. `hunt_window` is that clamp, and it is the whole of the
-- difference between this and the browser's frame loop.
--
-- ## A hunting leg is a leg, aimed
--
-- The wild walk is legs to nowhere in particular. A hunt is the same walk
-- with the destination decided rather than hashed: from where it stands to a
-- pace short of your feet, taking as long as the distance and its speed say.
-- That falls out of the model rather than fighting it, and it means somebody
-- watching sees the thing coming at them rather than arriving.

alter table creature add column if not exists hunting uuid;
/**
 * The creature it is fighting, and who last hurt it.
 *
 * The browser keeps one `enemy` field and puts -1 in it for the player. A
 * sentinel is a thing you have to remember, so here they are two columns with
 * their own names: `hunting` is the person it has the scent of, `enemy` is
 * the beast it is set on. Nothing is ever both.
 */
alter table creature add column if not exists enemy int;
alter table creature add column if not exists hurt_by int;

/** How far off it takes your scent, unless its own kind says further. */
create or replace function hunt_sight() returns double precision language sql immutable as $$ select 7 $$;
/** And how far off it loses interest. A monster follows more than twice as far. */
create or replace function hunt_give_up() returns double precision language sql immutable as $$ select 13 $$;
/** Close enough to be bitten. */
create or replace function hunt_reach() returns double precision language sql immutable as $$ select 1.1 $$;
/** The gap between one blow and the next. */
create or replace function hunt_blow() returns double precision language sql immutable as $$ select 1.4 $$;
/**
 * How much of the gap between two looks a hunter is allowed to have spent on
 * you: ten seconds, which is seven blows. Shut the tab with a wolf on you and
 * you come back to a wolf on you, not to a corpse.
 */
create or replace function hunt_window() returns double precision language sql immutable as $$ select 10 $$;

/** Whoever is nearest, which on an island this size is whoever it goes for. */
create or replace function nearest_player(p_world uuid, p_x double precision, p_y double precision)
  returns table (uid uuid, x double precision, y double precision, d double precision)
  language sql stable as $$
  select pl.uid, pl.x, pl.y, sqrt((pl.x - p_x) ^ 2 + (pl.y - p_y) ^ 2)
  from player pl where pl.world_id = p_world
  order by (pl.x - p_x) ^ 2 + (pl.y - p_y) ^ 2
  limit 1
$$;

/** Who hit you last, and when: what a worker reads before it breaks off. */
create or replace function mark_attacker(p_world uuid, p_uid uuid, p_id int) returns void
  language sql as $$
  update player set stats = jsonb_set(jsonb_set(stats, '{hurtBy}', to_jsonb(p_id)),
                                      '{hurtAt}', to_jsonb(now()))
  where world_id = p_world and uid = p_uid
$$;

/**
 * A leg toward a point, sliding along whatever is in the way.
 *
 * The browser walks a creature a frame at a time and asks three questions at
 * every step: the way it wants to go, then the same move with only the x of
 * it, then only the y. That is what lets a thing follow you round the corner
 * of a house rather than standing at the wall wondering. A leg out here is a
 * great many of those steps at once, so it asks the same three questions of
 * the whole leg, and gives up only when all three are shut.
 */
create or replace function chase_leg(p_world uuid, p_fx double precision, p_fy double precision,
    p_tx double precision, p_ty double precision)
  returns table (x double precision, y double precision) language plpgsql stable as $$
begin
  if line_clear(p_world, p_fx, p_fy, p_tx, p_ty) then x := p_tx; y := p_ty; return next; return; end if;
  if p_tx <> p_fx and line_clear(p_world, p_fx, p_fy, p_tx, p_fy) then
    x := p_tx; y := p_fy; return next; return;
  end if;
  if p_ty <> p_fy and line_clear(p_world, p_fx, p_fy, p_fx, p_ty) then
    x := p_fx; y := p_ty; return next; return;
  end if;
  return;
end $$;

/**
 * A hunter closing on whoever is in front of it.
 *
 * Handed the creature mid-settle and handed it back changed, so that the one
 * write at the end of `creature_settle` is still the only write. It gives up
 * when you get far enough away or when it has been badly enough hurt to think
 * better of it — and a monster is far harder to shake and far slower to
 * decide it has had enough.
 */
create or replace function hunt_settle(p_world uuid, c creature, d species_def, a age_def)
  returns creature language plpgsql as $$
declare p record; v_dist double precision; v_pace double precision; v_guard int := 0;
        v_cx double precision; v_cy double precision; v_secs double precision;
        v_ax double precision; v_ay double precision; v_step record;
begin
  v_cx := creature_x(c); v_cy := creature_y(c);
  select * into p from nearest_player(p_world, v_cx, v_cy);
  if not found then c.hunting := null; return c; end if;

  if c.hunting is not null then
    if p.d > (case when d.monster then hunt_give_up() * 2.2 else hunt_give_up() end)
       or c.health < max_health(c) * (case when d.monster then 0.08 else 0.3 end) then
      c.hunting := null;
      return c;
    end if;
    c.hunting := p.uid;
  else
    -- Nothing comes for you across ground it cannot stand on.
    if p.d > coalesce(d.notice, hunt_sight()) then return c; end if;
    if not creature_tile_ok(p_world, floor(p.x)::int, floor(p.y)::int) then return c; end if;
    c.hunting := p.uid;
    perform tell(p_world, p.uid, 'A ' || lower(d.name) || ' has your scent.', 'error');
  end if;

  -- Only the last few seconds of the gap were spent on you. See the head of
  -- the file: before that you were not there to be hunted.
  if c.until < now() - make_interval(secs => hunt_window()) then
    c.from_x := v_cx; c.from_y := v_cy; c.to_x := v_cx; c.to_y := v_cy;
    c.until := now() - make_interval(secs => hunt_window());
    c.leg_at := c.until; c.leg_ends := c.until;
  end if;

  v_pace := d.speed * a.speed * trait_mul(c.traits, 'speed') * 1.15;
  while c.until <= now() and v_guard < 12 loop
    v_guard := v_guard + 1;
    v_dist := sqrt((p.x - c.to_x) ^ 2 + (p.y - c.to_y) ^ 2);
    if v_dist > hunt_reach() then
      -- A leg that ends a pace short of your feet, round whatever is between.
      v_ax := c.to_x + (p.x - c.to_x) * (v_dist - 1) / v_dist;
      v_ay := c.to_y + (p.y - c.to_y) * (v_dist - 1) / v_dist;
      select * into v_step from chase_leg(p_world, c.to_x, c.to_y, v_ax, v_ay);
      if v_step.x is null then
        -- Nothing open at all: the browser's chase ends here too.
        c.hunting := null;
        exit;
      end if;
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := v_step.x; c.to_y := v_step.y;
      v_secs := greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                              / greatest(0.1, v_pace));
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => v_secs);
      c.until := c.leg_ends;
    else
      perform mark_attacker(p_world, p.uid, c.id);
      perform hurt_player(p_world, p.uid, attack_of(c) * 0.012,
        'The ' || lower(d.name) || ' is on you', coalesce(d.wound, 'bite'));
      c.until := c.until + make_interval(secs => hunt_blow());
    end if;
  end loop;
  return c;
end $$;

/**
 * The wild branch, now with a second thing it might be doing.
 *
 * A hunter that has your scent is not wandering, so the random walk is the
 * else of the hunt rather than something the hunt interrupts.
 */
create or replace function creature_settle(p_world uuid, p_id int) returns boolean
  language plpgsql as $$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born);
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then return false; end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * trait_mul(c.traits, 'appetite'));
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end);
  end if;
  if d.fleece is not null and a.growth > 0 and c.fleece < 1 then
    c.fleece := least(1, c.fleece + elapsed * d.fleece * a.growth * trait_mul(c.traits, 'grow'));
  end if;
  c.care := greatest(0, c.care - elapsed / (3 * 3600));

  if c.mode = 'wild' then
    if d.hunter then c := hunt_settle(p_world, c, d, a); else c.hunting := null; end if;
  else
    c.hunting := null;
  end if;

  if c.mode = 'wild' and c.hunting is null then
    pace := d.speed * a.speed * trait_mul(c.traits, 'speed') * 0.7;
    while c.until <= now() and guard < 40 loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      for i in 0..7 loop
        nx := c.to_x + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * 4;
        ny := c.to_y + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * 4;
        if creature_tile_ok(p_world, floor(nx)::int, floor(ny)::int)
           and line_clear(p_world, c.to_x, c.to_y, nx, ny) then ok := true; exit; end if;
      end loop;
      c.leg := n;
      if not ok then
        -- Hemmed in: stand where it is and look again in a moment.
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '2 seconds';
        continue;
      end if;
      -- It feeds itself on the way. The browser walks it to a forage bed,
      -- grazes for a few seconds and tops the belly up; out here the leg that
      -- ends on ground worth grazing is the same thing without the detail.
      if c.hunger < 0.5 and coalesce((select forage from tile_def
            where id = land_tile(p_world, floor(nx)::int, floor(ny)::int)), false) then
        c.hunger := least(1, c.hunger + 0.5);
      end if;
      dist := sqrt((nx - c.to_x) ^ 2 + (ny - c.to_y) ^ 2);
      secs := greatest(0.2, dist / greatest(0.1, pace));
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := nx; c.to_y := ny;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => secs);
      c.until := c.leg_ends + make_interval(secs => 1 + hash_tile(p_id, n, 11001) * 5);
    end loop;
    -- Forty legs is as far back as anybody can be bothered to walk. Past that
    -- it is where it got to and the clock catches up with it, which is all
    -- anybody arriving could tell anyway.
    if c.until <= now() then
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.leg_at := now(); c.leg_ends := now();
      c.until := now() + make_interval(secs => 1 + hash_tile(p_id, c.leg, 11001) * 5);
    end if;
  elsif c.mode = 'active' and c.keeper is not null then
    -- A companion is wherever its keeper is; following is not a walk of its own.
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    -- Kept at the token: it stands by the token.
    select dd.x + 0.5 as x, dd.y + 1.5 as y into home from deed dd where dd.world_id = p_world;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      hunting = c.hunting, settled_at = now()
    where world_id = p_world and id = p_id;
  return true;
end $$;

/** What is alive around you, with the ones that have your scent saying so. */
create or replace function rpc_creatures(p_world uuid, p_range double precision default 40)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  perform creature_sweep(p_world, p.x, p.y, p_range);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'species', c.species, 'name', c.name, 'variant', c.variant,
      'mode', c.mode, 'stance', c.stance,
      'x', creature_x(c), 'y', creature_y(c),
      'fromX', c.from_x, 'fromY', c.from_y, 'toX', c.to_x, 'toY', c.to_y,
      'legAt', c.leg_at, 'legEnds', c.leg_ends,
      'health', c.health, 'max', max_health(c), 'hunger', c.hunger,
      'sex', c.sex, 'age', age_of(c.born), 'traits', c.traits,
      'hunting', c.hunting = me, 'mine', coalesce(c.keeper = me, false))
      order by c.id)
    from creature c
    where c.world_id = p_world
      and greatest(abs(creature_x(c) - p.x), abs(creature_y(c) - p.y)) <= p_range), '[]'::jsonb);
end $$;

select private.lock_doors();
