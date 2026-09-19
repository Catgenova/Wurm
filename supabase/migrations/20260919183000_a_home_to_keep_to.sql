-- Herds, and a territory rather than a leash
--
-- Nothing kept a wild animal anywhere. A wander target was drawn a tile and a
-- half from wherever it was standing, from wherever it had got to last time,
-- for ever — a random walk with nothing pulling on it. So an island's
-- wildlife had no geography at all: a thing that spawned in the tundra was as
-- likely to be on the south beach an hour later, and the places you learned
-- to go for a particular animal were places only until you next looked.
--
-- Everything wild has a **home** now: the middle of its own ground, set where
-- it is first put down. A step that would take it past `wild_range()` from
-- home is drawn towards home instead, so a valley keeps what lives in it.
--
-- And a **herd** is not a list anywhere — it is a shared home. A grazer
-- arriving within `herd_reach()` of another of its species takes that one's
-- home ground for its own, so the pair wander the same patch and are found
-- together ever after; the next one along joins whichever it lands nearest,
-- which is how a herd grows out of one look round at birth and no bookkeeping
-- at all. Hunters keep their own ground: six goblins sharing a range would be
-- a pack, and what makes a hunter frightening is meeting it where it lives.
--
-- The leash gets the same treatment. It was tied where a chase began, which
-- is the right measure for a hunter you walked in on and the wrong one for a
-- hunter that had already wandered halfway to the next valley — that one
-- would take you thirty tiles further still, sixty tiles of country between
-- it and anywhere it has any business being. Both are asked now and the first
-- to run out ends it, so a hunter met at its den chases you the full thirty
-- as it always did and one met at the edge of its range gives up in a dozen.
-- Then it turns for home, rather than standing where it stopped.

alter table creature add column if not exists home_x double precision;
alter table creature add column if not exists home_y double precision;

-- Everything already on an island takes where it stands as home, which is the
-- same answer it would have got had it only just arrived.
update creature set home_x = to_x, home_y = to_y where home_x is null;


-- The three numbers this leans on — `wild_range()`, `herd_reach()` and
-- `hunt_home()` — live in `creatures.ts` and arrive in Postgres with the
-- definitions, like every other constant in this game. There is no second
-- place to forget one.

CREATE OR REPLACE FUNCTION public.creature_spawn(p_world uuid, p_species text, p_x double precision, p_y double precision, p_mode text DEFAULT 'wild'::text, p_born timestamp with time zone DEFAULT NULL::timestamp with time zone, p_keeper uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $fn$
declare d species_def; new_id int; tr text[]; sk jsonb := '{}'::jsonb; gskill text;
        hx double precision; hy double precision;
begin
  select * into d from species_def where id = p_species;
  if not found then return null; end if;
  select coalesce(max(id), 0) + 1 into new_id from creature where world_id = p_world;
  tr := roll_traits(0);
  -- A worker starts knowing nothing about its trade and learns it by doing it.
  select skill into gskill from gather_def where id = d.gathers;
  if gskill is not null then sk := jsonb_build_object(gskill, 1); end if;
  -- Its own ground, or a herd's. A grazer takes the home of the nearest of
  -- its own kind within reach; a hunter, and anything that is not wild, keeps
  -- where it is standing.
  hx := p_x; hy := p_y;
  if p_mode = 'wild' and not coalesce(d.hunter, false) then
    select c.home_x, c.home_y into hx, hy
      from creature c
      where c.world_id = p_world and c.species = d.id and c.mode = 'wild'
        and c.home_x is not null
        and (c.home_x - p_x) ^ 2 + (c.home_y - p_y) ^ 2 <= herd_reach() ^ 2
      order by (c.home_x - p_x) ^ 2 + (c.home_y - p_y) ^ 2
      limit 1;
    if hx is null then hx := p_x; hy := p_y; end if;
  end if;
  insert into creature (world_id, id, species, name, variant, mode, stance,
      from_x, from_y, to_x, to_y, leg_at, leg_ends, until,
      health, hunger, fleece, care, sex, traits, skills, born, keeper, home_x, home_y)
  values (p_world, new_id, d.id, d.name, floor(random() * greatest(1, d.variants))::int,
      p_mode, coalesce(d.default_stance, 'defensive'),
      p_x, p_y, p_x, p_y, now(), now(), now(),
      round(d.health * trait_mul(tr, 'hardy')), 0.6 + random() * 0.4, 0.6 + random() * 0.4,
      0, case when random() < 0.5 then 'male' else 'female' end, tr, sk, p_born, p_keeper, hx, hy);
  return new_id;
end $fn$;
CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $fn$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record; ax double precision; ay double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born);
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then
    -- Nothing has passed for the body — but a worker's day is not its body,
    -- and the trips it is owed are still owed.
    if c.mode = 'deed' then perform worker_settle(p_world, p_id);
    elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
    return false;
  end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * beast_mul(c, 'appetite'));
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end * beast_mul(c, 'mend'));
  end if;
  if d.fleece is not null and a.growth > 0 and c.fleece < 1 then
    c.fleece := least(1, c.fleece + elapsed * d.fleece * a.growth * beast_mul(c, 'grow'));
  end if;
  c.care := greatest(0, c.care - elapsed / (3 * 3600));
  /*
   * And a hungry one on a deed goes to the stores.
   *
   * Written on the row rather than on `c`, so the settle below does not carry
   * the old belly back over it. Only when it is actually hungry, which for a
   * worker is an hour or so apart — this is not a cost anybody pays on a beat.
   */
  if c.mode <> 'wild' and c.hunger < graze_hungry() then
    if worker_feed(p_world, p_id) is not null then
      c.hunger := least(1, c.hunger + graze_fill());
    end if;
  end if;

  if c.mode = 'wild' then
    if d.hunter then c := hunt_settle(p_world, c, d, a); else c.hunting := null; end if;
  else
    c.hunting := null;
  end if;

  if c.mode = 'wild' and c.hunting is null then
    pace := d.speed * a.speed * beast_mul(c, 'speed') * 0.7;
    while c.until <= now() and guard < 40 loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      -- A step about its own country rather than a step from wherever it
      -- last got to. Past the edge of its range it draws towards home
      -- instead, which is what keeps an island's wildlife somewhere in
      -- particular. A creature from before homes existed takes where it
      -- stands, which is what it would have had anyway.
      if c.home_x is null then c.home_x := c.to_x; c.home_y := c.to_y; end if;
      if (c.to_x - c.home_x) ^ 2 + (c.to_y - c.home_y) ^ 2 > wild_range() ^ 2 then
        ax := c.home_x; ay := c.home_y;
      else
        ax := c.to_x; ay := c.to_y;
      end if;
      for i in 0..7 loop
        nx := ax + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * wild_reach();
        ny := ay + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * wild_reach();
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
      if c.hunger < graze_hungry() and coalesce((select forage from tile_def
            where id = land_tile(p_world, floor(nx)::int, floor(ny)::int)), false) then
        c.hunger := least(1, c.hunger + graze_fill());
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
  elsif c.mode = 'active' and c.keeper is not null and c.enemy is null then
    -- A companion is wherever its keeper is; following is not a walk of its own.
    -- A fight is, and one with something in its teeth keeps the legs it has:
    -- `companion_settle`, below, walks it, strikes, and brings it back to heel.
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    -- Kept at the token: it stands by the token.
    select md.x + 0.5 as x, md.y + 1.5 as y into home from my_deed(p_world, c.keeper) md where md.world_id is not null;
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
      home_x = c.home_x, home_y = c.home_y,
      settled_at = now()
    where world_id = p_world and id = p_id;
  -- And then the day's work, for whichever of them is on a deed rather than
  -- out in the country. The row goes down first because the work reads it back.
  if c.mode = 'deed' then perform worker_settle(p_world, p_id);
  -- And a companion's company, which is the one thing at heel that is a walk of its own.
  elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
  return true;
end $fn$;
CREATE OR REPLACE FUNCTION public.hunt_settle(p_world uuid, c creature, d species_def, a age_def)
 RETURNS creature
 LANGUAGE plpgsql
AS $fn$
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
    /*
     * And how far it is from its own home ground, which is what stops a
     * hunter that had already strayed from taking you another thirty tiles
     * beyond where it strayed to. Both are asked; the first to run out ends
     * it.
     */
    if sqrt((v_cx - coalesce(c.hunt_x, v_cx)) ^ 2 + (v_cy - coalesce(c.hunt_y, v_cy)) ^ 2)
         > hunt_leash()
       or sqrt((v_cx - coalesce(c.home_x, v_cx)) ^ 2 + (v_cy - coalesce(c.home_y, v_cy)) ^ 2)
         > hunt_home() then
      c.hunting := null;
      c.hunt_again := now() + make_interval(secs => hunt_rest());
      -- And back to its own country, rather than standing wherever it
      -- happened to stop. A hunter that gave up ten valleys from home and
      -- stayed there is how a range stops meaning anything.
      if c.home_x is not null then
        c.from_x := v_cx; c.from_y := v_cy;
        c.to_x := c.home_x; c.to_y := c.home_y;
        c.leg_at := now();
        c.leg_ends := now() + make_interval(secs => greatest(1,
          sqrt((v_cx - c.home_x) ^ 2 + (v_cy - c.home_y) ^ 2)
            / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * 0.7)));
        c.until := c.leg_ends;
      end if;
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
    perform tell(p_world, p.uid, 'A ' || lower(d.name) || ' has your scent.', 'fight');
  end if;

  -- Only the last few seconds of the gap were spent on you.
  if c.until < now() - make_interval(secs => hunt_window()) then
    c.from_x := v_cx; c.from_y := v_cy; c.to_x := v_cx; c.to_y := v_cy;
    c.until := now() - make_interval(secs => hunt_window());
    c.leg_at := c.until; c.leg_ends := c.until;
  end if;

  v_pace := d.speed * a.speed * beast_mul(c, 'speed') * 1.15;
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
      c.until := c.until + make_interval(secs => hunt_blow() / beast_mul(c, 'haste'));
    end if;
  end loop;
  return c;
end $fn$;

select private.lock_doors();
