-- A leash on what hunts you, and a knack off a dish rather than a bush.
--
-- ## Chased until you are dead
--
-- Reported in those words, and that is what the rules said. Every give-up in
-- `hunt_settle` measured the gap between the hunter and the hunted — and a
-- hunter runs at `speed * 1.15`, so the gap it was tested against was a gap it
-- was closing. Outrunning one was the only way to lose it, and most things on
-- this island are faster than a body carrying a pack.
--
-- The leash is tied where the chase began instead: thirty tiles from the spot
-- it first had your scent, which is a screen and a half. It gives up there and
-- then wants nothing to do with hunting for two and a half minutes, because
-- otherwise it drops you at thirty tiles, notices you again on the next breath
-- — you are still well inside its sight — and measures a fresh leash from
-- there, which is the same endless chase with a stutter in it.
--
-- `hunt_leash` and `hunt_rest` are crossed from `creatures.ts`, where the
-- browser reads the same two numbers for a game with no island under it.
--
-- ## And a knack off a raw berry
--
-- `boon_of` gave one for anything with something in it, which is a handful of
-- blueberries as much as a stew: a trade favoured for twenty minutes by eating
-- fruit off a bush. Eighteen of the forty-one nourishing things on the island
-- are made by somebody — thirteen dishes off a fire, a cheese, an oil pressed
-- under a quern, four barrels that have finished working. The other
-- twenty-three are food and are not a knack.

/* ------------------------------------------------------------------ *
 * Where a chase began, and when the hunter will take an interest again.
 * ------------------------------------------------------------------ */
alter table creature add column if not exists hunt_x double precision;
alter table creature add column if not exists hunt_y double precision;
alter table creature add column if not exists hunt_again timestamptz;

CREATE OR REPLACE FUNCTION public.hunt_settle(p_world uuid, c creature, d species_def, a age_def)
 RETURNS creature
 LANGUAGE plpgsql
AS $function$
declare p record; v_dist double precision; v_pace double precision; v_guard int := 0;
        v_cx double precision; v_cy double precision; v_secs double precision;
        v_ax double precision; v_ay double precision; v_step record;
begin
  v_cx := creature_x(c); v_cy := creature_y(c);
  select * into p from nearest_player(p_world, v_cx, v_cy);
  if not found then c.hunting := null; return c; end if;

  if c.hunting is not null then
    /*
     * How far it has come from where it started, which is the one measure that
     * grows while it chases.
     *
     * Reported as being chased until you are dead, and that is exactly what
     * happened: every give-up here was about the gap between hunter and
     * hunted, and a hunter runs at `speed * 1.15` — so the gap it was measured
     * against was a gap it was closing. Outrunning one was the only way to
     * lose it, and most things on this island are faster than a body carrying
     * a pack.
     *
     * So the leash is tied where the chase began. It gives up at the end of it
     * and then wants nothing to do with hunting for `hunt_rest`, because
     * otherwise it drops you at thirty tiles, notices you again on the next
     * breath because you are still well inside its sight, and measures a fresh
     * leash from there — which is the same endless chase with a stutter in it.
     */
    if sqrt((v_cx - coalesce(c.hunt_x, v_cx)) ^ 2 + (v_cy - coalesce(c.hunt_y, v_cy)) ^ 2)
         > hunt_leash() then
      c.hunting := null;
      c.hunt_again := now() + make_interval(secs => hunt_rest());
      return c;
    end if;
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
    if c.hunt_again is not null and c.hunt_again > now() then return c; end if;
    if p.d > coalesce(d.notice, hunt_sight()) then return c; end if;
    if not creature_tile_ok(p_world, floor(p.x)::int, floor(p.y)::int) then return c; end if;
    c.hunting := p.uid;
    -- Where the leash is tied.
    c.hunt_x := v_cx; c.hunt_y := v_cy;
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
end $function$;

CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
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
  if elapsed <= 0 then
    -- Nothing has passed for the body — but a worker's day is not its body,
    -- and the trips it is owed are still owed.
    if c.mode = 'deed' then perform worker_settle(p_world, p_id); end if;
    return false;
  end if;

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
        nx := c.to_x + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * wild_reach();
        ny := c.to_y + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * wild_reach();
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
      c.until := c.leg_ends + make_interval(secs => wild_rest() + hash_tile(p_id, n, 11001) * wild_rest_spread());
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
    select dd.x + 0.5 as x, dd.y + 1.5 as y into home from deed dd where dd.world_id = p_world and dd.founded_by = c.keeper;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      hunting = c.hunting, hunt_x = c.hunt_x, hunt_y = c.hunt_y, hunt_again = c.hunt_again,
      settled_at = now()
    where world_id = p_world and id = p_id;
  -- And then the day's work, for whichever of them is on a deed rather than
  -- out in the country. The row goes down first because the work reads it back.
  if c.mode = 'deed' then perform worker_settle(p_world, p_id); end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.boon_of(p_seed bigint, p_item text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare h bigint; i int;
begin
  /*
   * Something somebody made, rather than something picked up off the ground.
   *
   * Reported as a knack off a raw berry. The rule was "anything with something
   * in it", which is a handful of blueberries as much as a stew — so a trade
   * could be favoured for twenty minutes by eating fruit straight off a bush.
   * The comment over the list in `boons.ts` has said "everything cooked" since
   * the day it was written, and the code under it said nothing of the kind.
   *
   * A dish off a fire, a cheese, an oil pressed under a quern, a barrel that
   * has finished working: things that took a fire, a tool or a month. Meat off
   * a kill, a fish off a line, a berry off a bush and milk out of a beast are
   * food and are not a knack. Eighteen of the forty-one nourishing things on
   * the island carry one; twenty-three do not.
   */
  if not exists (select 1 from item_def d where d.id = p_item and d.category = 'food'
                   and (coalesce(d.food, 0) > 0 or coalesce(d.drink, 0) > 0)
                   and (exists (select 1 from recipe r where r.result = d.id)
                        or exists (select 1 from brew_def w where w.id || '_bucket' = d.id))) then
    return null;
  end if;
  h := ((p_seed # 2654435769) % 4294967296 + 4294967296) % 4294967296;
  for i in 1..length(p_item) loop
    h := h # ascii(substr(p_item, i, 1));
    h := (h * 16777619) % 4294967296;
  end loop;
  return (select skill from boon_skill where ord = (h % (select count(*) from boon_skill))::int);
end $function$;

notify pgrst, 'reload schema';
