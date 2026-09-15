-- A quiet beach.
--
-- The clock is what made this matter. Wildlife never moved before it —
-- `creature_sweep` had no caller — so a goblin standing where people wash
-- ashore was scenery. It comes for you now, and a fresh body with a hatchet
-- and no fighting to speak of can do nothing at all about it.
--
-- The first live run after the front door started opening on the island lost
-- both its settlement and its dig to one, four minutes apart, with the event
-- log reading `The goblin is on you. You have a deep cut to the chest,
-- bleeding.` Nothing there is a bug: that is the game working exactly as
-- written. It is also a first five minutes nobody would come back from, and
-- the front door now sends everybody through it.
--
-- So: nothing that hunts is put down within `peace_reach` of the spawn, and
-- nothing that hunts will start on somebody standing inside it or keep at them
-- once they are. It is not safety, it is a beginning — walk off the beach and
-- the island is exactly as dangerous as it was.

/** Whether a point is on the landing beach, where nothing hunts. */
create or replace function at_peace(p_world uuid, p_x double precision, p_y double precision)
  returns boolean language sql stable as $$
  select coalesce((select greatest(abs(p_x - (w.spawn_x + 0.5)), abs(p_y - (w.spawn_y + 0.5))) <= peace_reach()
                   from world w where w.id = p_world), false)
$$;

/**
 * What to put down here — and never a hunter on the beach.
 *
 * The roll is skipped rather than re-rolled, so the beach carries the same
 * density of living things as anywhere else; they are simply all things that
 * do not come for you.
 */
create or replace function pick_wild(p_world uuid, p_x int, p_y int) returns text
  language plpgsql stable as $$
declare got text;
begin
  if not at_peace(p_world, p_x + 0.5, p_y + 0.5) and random() < monster_share() then
    return pick_monster(p_world, p_x, p_y);
  end if;
  select species into got from wild_table where not monster
  order by random() / greatest(1e-9, weight) limit 1;
  return got;
end $$;

/**
 * A hunter closing on whoever is in front of it, unless they are on the beach.
 *
 * Two lines, and they are deliberately in different places. One stops a hunt
 * beginning on somebody standing there; the other ends one that followed them
 * in — because a beach you can be chased onto and killed on is not a beach,
 * and getting there is exactly what a beginner should be able to do.
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
       or c.health < max_health(c) * (case when d.monster then 0.08 else 0.3 end)
       or at_peace(p_world, p.x, p.y) then
      c.hunting := null;
      return c;
    end if;
    c.hunting := p.uid;
  else
    -- Nothing comes for you across ground it cannot stand on, and nothing
    -- comes for you at all while you are still standing on the beach.
    if at_peace(p_world, p.x, p.y) then return c; end if;
    if p.d > coalesce(d.notice, hunt_sight()) then return c; end if;
    if not creature_tile_ok(p_world, floor(p.x)::int, floor(p.y)::int) then return c; end if;
    c.hunting := p.uid;
    perform tell(p_world, p.uid, 'A ' || lower(d.name) || ' has your scent.', 'error');
  end if;

  -- Only the last few seconds of the gap were spent on you.
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

select private.lock_doors();
