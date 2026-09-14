-- The two trades that fight for a living: a guard on the border, a hunter in
-- the country round it.
--
-- ## A fight is a round trip whose work is somebody else
--
-- A gatherer walks out to a tile, works it, and carries a load home. A guard
-- walks out to a *creature*, works it — one blow is one turn of the phase
-- machine — and walks out to it again wherever it has got to. A hunter does
-- the same and then does what a gatherer does: the carcass is the load, and
-- it goes in the crate like sand or stone.
--
-- So neither of them needed a loop of their own. What they needed was a
-- `work_x` that moves.

/**
 * Hurting a beast, with the thing that hurt it named.
 *
 * `hurt_creature` had the whole of this in it and took a player's uid, which
 * was fine while a player was the only thing that could swing at anything.
 * A guard changes that, so the body moved down here behind two points — what
 * hit it and where from — and `hurt_creature` is the player's way in.
 */
create or replace function wound_beast(p_world uuid, p_id int, p_dmg double precision,
    p_from_x double precision default null, p_from_y double precision default null,
    p_teller uuid default null, p_by int default null) returns boolean
  language plpgsql as $$
declare c creature; d species_def; cx double precision; cy double precision;
        v_len double precision; v_size double precision; v_killer creature;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  cx := creature_x(c); cy := creature_y(c);

  update creature set health = c.health - p_dmg, hurt_at = now(), hurt_by = p_by,
      coaxed = 0, coaxed_at = null,
      from_x = cx, from_y = cy, to_x = cx, to_y = cy, leg_at = now(), leg_ends = now(),
      settled_at = now()
    where world_id = p_world and id = p_id;

  if c.health - p_dmg > 0 then
    if c.mode = 'wild' and d.timid and p_from_x is not null then
      v_len := greatest(0.001, sqrt((cx - p_from_x) ^ 2 + (cy - p_from_y) ^ 2));
      update creature set to_x = cx + ((cx - p_from_x) / v_len) * 5, to_y = cy + ((cy - p_from_y) / v_len) * 5,
          leg_ends = now() + interval '3 seconds', until = now() + interval '3 seconds'
        where world_id = p_world and id = p_id;
    end if;
    return false;
  end if;

  -- What the carcass is worth follows the size of the thing that left it.
  v_size := (age_row(c.born)).yield;
  delete from creature where world_id = p_world and id = p_id;
  -- Nothing goes on fighting something that is no longer there.
  update creature set enemy = null where world_id = p_world and enemy = p_id;
  perform drop_on_ground(p_world, floor(cx)::int, floor(cy)::int, 'corpse',
    (15 + random() * 35) * v_size, d.name);

  -- A hunter marks where its kill went down and comes back for it.
  if p_by is not null then
    select * into v_killer from creature where world_id = p_world and id = p_by;
    if found and v_killer.carrying is null
       and (select gathers from species_def where id = v_killer.species) = 'hunt' then
      update creature set work_x = floor(cx)::int, work_y = floor(cy)::int
        where world_id = p_world and id = p_by;
      perform worker_learn(p_world, p_by, 'fighting', 0.4);
    end if;
  end if;

  if p_teller is not null then
    if d.monster then
      perform tell(p_world, p_teller, 'The ' || lower(d.name)
        || ' goes down. Butcher it before it rots: there is a great deal on it.', 'system');
    else
      perform tell(p_world, p_teller, 'You kill the wild ' || lower(d.name)
        || '. Its corpse lies where it fell.', 'event');
    end if;
  end if;
  return true;
end $$;

/** A player's blow, which is where all of this came from. */
create or replace function hurt_creature(p_world uuid, p_id int, p_dmg double precision,
    p_by uuid default null) returns boolean
  language plpgsql as $$
declare px double precision; py double precision;
begin
  select p.x, p.y into px, py from player p where p.world_id = p_world and p.uid = p_by;
  return wound_beast(p_world, p_id, p_dmg, px, py, p_by, null);
end $$;

/**
 * One creature's blow at another.
 *
 * A hunter hits harder the more hunting it has done: half again at mastery.
 * And only something that already knows how to fight learns anything by it —
 * a guard trains its back, not its sword arm.
 */
create or replace function creature_attack(p_world uuid, p_attacker int, p_target int)
  returns boolean language plpgsql as $$
declare a creature; d species_def; v_dmg double precision;
begin
  select * into a from creature where world_id = p_world and id = p_attacker;
  if not found then return false; end if;
  select * into d from species_def where id = a.species;
  v_dmg := d.attack * (1 + coalesce((a.skills->>'fighting')::double precision, 0) / 200)
           * (0.7 + random() * 0.6);
  if a.skills ? 'fighting' then perform worker_learn(p_world, p_attacker, 'fighting', 0.05); end if;
  return wound_beast(p_world, p_target, v_dmg, creature_x(a), creature_y(a), null, p_attacker);
end $$;

/** The two trades whose work is a creature rather than a tile. */
create or replace function fight_trade(p_kind text) returns boolean language sql immutable as $$
  select p_kind in ('guard', 'hunt')
$$;

/** How far each of them ranges: a guard the border, a hunter what it has learned. */
create or replace function fight_range(c creature, p_kind text, dd deed) returns double precision
  language sql stable as $$
  select case when p_kind = 'guard' then dd.radius + 1 else work_range(c) end
$$;

/** The nearest wild thing inside the range, measured from where the worker stands. */
create or replace function wild_quarry(p_world uuid, p_cx double precision, p_cy double precision,
    p_range double precision, p_from_x double precision, p_from_y double precision)
  returns creature language sql stable as $$
  select q.* from creature q
  where q.world_id = p_world and q.mode = 'wild'
    and greatest(abs(creature_x(q) - p_cx), abs(creature_y(q) - p_cy)) <= p_range
  order by (creature_x(q) - p_from_x) ^ 2 + (creature_y(q) - p_from_y) ^ 2, q.id
  limit 1
$$;

/**
 * The nearest carcass lying inside the range.
 *
 * This kill or an older one left in the grass: the browser looks through the
 * whole of what is on the ground rather than a box of tiles round the hunter,
 * because the piles are few and the tiles are many.
 */
create or replace function carcass_near(p_world uuid, p_cx double precision, p_cy double precision,
    p_range double precision, p_from_x double precision, p_from_y double precision)
  returns item language sql stable as $$
  select i.* from item i
  where i.world_id = p_world and i.holder = 'ground' and i.def = 'corpse'
    and greatest(abs(i.gx - p_cx), abs(i.gy - p_cy)) <= p_range
  order by (i.gx + 0.5 - p_from_x) ^ 2 + (i.gy + 0.5 - p_from_y) ^ 2, i.id
  limit 1
$$;

/** Take a carcass off the ground, the way a hunter takes it: in its teeth. */
create or replace function take_from_ground(p_world uuid, p_x int, p_y int, p_def text)
  returns jsonb language plpgsql as $$
declare v_it item;
begin
  select * into v_it from item where world_id = p_world and holder = 'ground'
    and gx = p_x and gy = p_y and def = p_def order by id limit 1;
  if not found then return null; end if;
  delete from item where id = v_it.id;
  return jsonb_build_object('def', v_it.def, 'count', v_it.count, 'ql', v_it.ql, 'extra', v_it.extra);
end $$;

/** Close enough to strike. A hunter reaches a little further than a guard. */
create or replace function fight_reach(p_kind text) returns double precision
  language sql immutable as $$ select case when p_kind = 'hunt' then 1.1 else 1 end $$;
/** And hits a little faster. */
create or replace function fight_blow(p_kind text) returns double precision
  language sql immutable as $$ select case when p_kind = 'hunt' then 1.1 else 1.2 end $$;
/** Everything runs harder at something than it walks about. */
create or replace function fight_pace(p_kind text) returns double precision
  language sql immutable as $$ select case when p_kind = 'hunt' then 1.4 else 1.3 end $$;

/**
 * What a worker is going for, or nothing.
 *
 * Three rules in one place, because they are the same question asked by three
 * sorts of creature: a guard takes anything wild that crosses the border, a
 * hunter anything wild in the country it has learned, and everything else
 * only what its stance tells it to. Passive carries on working whatever
 * happens; defensive wants to have been given a reason, and a reason is a
 * blow at it or at somebody on the island in the last eight seconds;
 * aggressive needs no reason at all.
 *
 * What it is already set on wins, while that is still a wild thing inside the
 * ground it is allowed to cover — with a few tiles of grace, so that a chase
 * does not end on the border it started at.
 */
create or replace function fight_target(p_world uuid, p_id int) returns creature
  language plpgsql stable as $$
declare c creature; d species_def; dd deed; v_kind text; q creature;
        v_rng double precision; v_cx double precision; v_cy double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found then return null; end if;
  select * into dd from deed where world_id = p_world;
  if not found then return null; end if;
  select * into d from species_def where id = c.species;
  v_kind := d.gathers;
  v_cx := creature_x(c); v_cy := creature_y(c);
  v_rng := fight_range(c, v_kind, dd);

  if c.enemy is not null then
    select * into q from creature where world_id = p_world and id = c.enemy;
    if found and q.mode = 'wild'
       and greatest(abs(creature_x(q) - dd.x), abs(creature_y(q) - dd.y)) <= v_rng + 4 then
      return q;
    end if;
    return null;
  end if;

  if not fight_trade(v_kind) then
    if c.stance = 'passive' then return null; end if;
    -- A worker that answers for itself works to the border, not to its range.
    v_rng := dd.radius + 1;
    if c.stance = 'defensive' then
      if not (c.hurt_at > now() - interval '8 seconds'
              or exists (select 1 from player pl where pl.world_id = p_world
                   and (pl.stats->>'hurtAt')::timestamptz > now() - interval '8 seconds')) then
        return null;
      end if;
      select * into q from creature qq where qq.world_id = p_world and qq.mode = 'wild'
        and greatest(abs(creature_x(qq) - dd.x), abs(creature_y(qq) - dd.y)) <= v_rng
        and (c.hurt_by = qq.id
             or exists (select 1 from player pl where pl.world_id = p_world
                  and (pl.stats->>'hurtBy')::int = qq.id
                  and (pl.stats->>'hurtAt')::timestamptz > now() - interval '8 seconds'))
        order by (creature_x(qq) - v_cx) ^ 2 + (creature_y(qq) - v_cy) ^ 2, qq.id
        limit 1;
      if not found then return null; end if;
      return q;
    end if;
  end if;

  q := wild_quarry(p_world, dd.x, dd.y, v_rng, v_cx, v_cy);
  if q.id is null then return null; end if;
  return q;
end $$;

select private.lock_doors();
