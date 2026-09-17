-- What a trait is worth, said in figures — and kept by the island.
--
-- Reported from the island: *"wildermon traits are useless flair text. provide
-- the actual stats and benefits they provide."*
--
-- Half of that is a card that never printed a number. The other half is worse:
-- some of the numbers were not being applied at all, so a card that printed
-- them would have been lying rather than merely vague. Three things this island
-- had written down and never once read:
--
--     learn     read by nothing. `worker_learn` is the only rule that turns a
--               worker's day into skill and it never asked what the animal
--               was. `curious`, `bright` and `quick-witted` do nothing else at
--               all, so on the island those three were decoration; `old blood`
--               and `herd-minded` and `pack leader` were half decoration.
--
--     the aura  no rule anywhere. Four traits say "what it lifts, it lifts for
--               the whole deed" and `trait_mul` gives the bearer its own share
--               and stops. A lead beast standing in the field made itself
--               quicker and the herd around it nothing.
--
--     care      `perform_creature` raises it, `creature_settle` decays it,
--               `care_word` describes it, and no rule multiplies by it. The
--               card has claimed "a brushed wildermon works and learns a
--               quarter faster" for as long as the Care bar has existed.
--
-- The browser applied all three. So this is not a missing feature; it is two
-- sides of one wire disagreeing, and the side that disagreed is the one that
-- decides.
--
-- ## One function, because there were nine places to forget
--
-- `trait_mul(c.traits, X)` appeared in nine functions and answered the narrow
-- question — what this animal's own blood is worth. Every call site then had
-- the chance to remember the herd and the brush, and every one of them forgot.
--
--     beast_mul(c, channel) = blood  ×  herd  ×  brush-where-the-brush-counts
--
-- and the nine call sites now ask the question they meant. `work` and `learn`
-- take the brush, which is exactly the browser's `workMul` and `learnMul`;
-- everything else does not, which is exactly its `speedMul` and `yieldMul`.
--
-- `deed_aura` is deed-only and channel-gated: it leaves without touching the
-- creature table unless the animal is working a deed *and* some aura trait
-- actually lifts that channel — asked of `trait_def` rather than written out
-- as a list of three, so a communal trait added later is picked up by the rule
-- instead of by somebody remembering this file.
--
-- ## And then the figures, on both sides
--
-- `channel_def` is the eleven channels written out: what each is called on a
-- card and what it decides. They existed only as arms of a TypeScript union
-- with a line of comment over each, and a comment is not something either side
-- can print. Now the card prints `+60% learning` beside the name, the card
-- prints what the three of them come to *after* the herd and the brush, and
-- `blood_read` — the island's own examine line — says what the blood comes to.
--
-- `sight` stays where it is. Fog of war is the browser's own and always was, so
-- `keen-nosed` is applied where it is felt; it is on this list only so that
-- nothing has to wonder about it again.

/**
 * What a brush is worth: one at nothing, `care_bonus()` better at a shine.
 *
 * Crossed from `CARE_BONUS` rather than written out, because the number had
 * already been written twice — once in the browser and once in the tooltip
 * that called it "a quarter".
 */
create or replace function care_mul(c creature) returns double precision
  language sql immutable as $fn$
  select 1 + least(1, greatest(0, c.care)) * care_bonus()
$fn$;

/** Whether any communal trait lifts this channel at all. Data, not a list. */
create or replace function aura_channel(p_channel text) returns boolean
  language sql stable as $fn$
  select exists (select 1 from trait_effect e join trait_def d on d.id = e.trait
                 where d.aura and e.channel = p_channel)
$fn$;

/**
 * The communal part of a channel: what every wildermon working the same
 * settlement — or the same post — lends to all of them, the bearer included.
 *
 * Grouped by keeper as well as post, which the browser had no need to do and
 * this island does: over there `creatures.list` is one person's herd, over here
 * it is everybody's, and a neighbour's lead beast is not yours.
 */
create or replace function deed_aura(c creature, p_channel text) returns double precision
  language sql stable as $fn$
  select case when c.mode <> 'deed' or not aura_channel(p_channel) then 1 else
    coalesce((select exp(sum(ln(e.mul)))
      from creature o
      cross join lateral unnest(coalesce(o.traits, '{}')) u(id)
      join trait_def d on d.id = u.id and d.aura
      join trait_effect e on e.trait = u.id and e.channel = p_channel
      where o.world_id = c.world_id and o.mode = 'deed'
        and o.keeper is not distinct from c.keeper
        and o.post is not distinct from c.post), 1) end
$fn$;

/**
 * Everything that bears on one channel for one animal.
 *
 * The one place the three parts are multiplied together, so that a rule asking
 * what a beast is worth cannot get a different answer from the rule beside it.
 */
create or replace function beast_mul(c creature, p_channel text) returns double precision
  language sql stable as $fn$
  select trait_mul(c.traits, p_channel) * deed_aura(c, p_channel)
       * case when p_channel in ('work', 'learn') then care_mul(c) else 1 end
$fn$;

/** A multiplier as it is printed: 1.32 is +32%, 0.8 is −20%. */
create or replace function pct_say(p_mul double precision) returns text
  language sql immutable as $fn$
  select case when round((p_mul - 1) * 100) < 0 then '−' else '+' end
      || abs(round((p_mul - 1) * 100))::int || '%'
$fn$;

/**
 * What a set of traits comes to, channel by channel, in the words a card uses.
 *
 * Blood only — no herd and no brush, because this is read off an animal rather
 * than off the field it is standing in.
 */
create or replace function trait_worth(p_traits text[]) returns text
  language sql stable as $fn$
  select string_agg(s.say, ', ' order by s.ord)
  from (
    select cd.ord, pct_say(exp(sum(ln(e.mul)))) || ' ' || cd.label as say
    from unnest(coalesce(p_traits, '{}')) u(id)
    join trait_effect e on e.trait = u.id
    join channel_def cd on cd.id = e.channel
    group by cd.ord, cd.label
    having abs(exp(sum(ln(e.mul))) - 1) >= 0.005
  ) s
$fn$;

/**
 * What a worker takes from its day.
 *
 * `p_base` is what the job is worth; what the animal is worth was never asked.
 * The browser has always written `skillGain(v, base * learnMul(c), …)` and this
 * wrote `skill_gain_of(was, p_base, …)`, which is the whole of why four traits
 * with nothing in them but learning did nothing here.
 */
create or replace function worker_learn(p_world uuid, p_id integer, p_skill text, p_base double precision)
  returns double precision
  language plpgsql as $fn$
declare c creature; was double precision; now_v double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found then return 0; end if;
  was := coalesce((c.skills->>p_skill)::double precision, 1);
  now_v := least(100, was + skill_gain_of(was, p_base * beast_mul(c, 'learn'), 0.6 + 0.8 * random()));
  update creature set skills = jsonb_set(skills, array[p_skill], to_jsonb(now_v)), xp = xp + (now_v - was)
    where world_id = p_world and id = p_id;
  return now_v - was;
end $fn$;
CREATE OR REPLACE FUNCTION public.attack_of(c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select (select attack from species_def where id = c.species) * beast_mul(c, 'tough')
$function$;

CREATE OR REPLACE FUNCTION public.max_health(c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select round((select health from species_def where id = c.species) * beast_mul(c, 'hardy'))
$function$;

CREATE OR REPLACE FUNCTION public.work_range(c creature)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select round((d.work_range + floor(task_skill(c) / 10) * 10) * beast_mul(c, 'range'))::int
  from species_def d where d.id = c.species
$function$;

CREATE OR REPLACE FUNCTION public.mount_speed(c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select least(max_mount_speed(),
    (select speed from species_def where id = c.species)
    * (age_row(c.born)).speed * beast_mul(c, 'speed')
    * footing(beast_climb(c)) * (0.6 + 0.4 * c.hunger))
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_speed(p_world uuid, p_id bigint)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v vehicle_def; p placed; c creature; n int := 0;
        sum_pace double precision := 0; worst double precision := 1; pull double precision := 0.75;
begin
  select * into p from placed where world_id = p_world and id = p_id;
  if not found then return 0; end if;
  select * into v from vehicle_def where id = p.sub;
  if not found then return 0; end if;
  for c in select * from team_of(p_world, p_id) loop
    n := n + 1;
    sum_pace := sum_pace + (select speed from species_def where id = c.species)
      * (age_row(c.born)).speed * beast_mul(c, 'speed');
    worst := least(worst, 0.6 + 0.4 * c.hunger);
    -- Every beast adds its own share; the ones bred for it add more.
    pull := pull + coalesce((select sp.pull from species_def sp where sp.id = c.species), 0.25)
      * (age_row(c.born)).pull * beast_mul(c, 'haul');
  end loop;
  if n < v.needs then return 0; end if;
  return least(max_vehicle_speed(),
    (sum_pace / n) * pull * worst * footing(team_climb(p_world, p_id)) * roll_ease(p.material));
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
  c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * beast_mul(c, 'appetite'));
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end);
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
      c.until := c.until + make_interval(secs => hunt_blow());
    end if;
  end loop;
  return c;
end $function$;

CREATE OR REPLACE FUNCTION public.worker_do(p_world uuid, p_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
  careful := beast_mul(c, 'yield');
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
    got := case when kind = 'mine' and rock.seam then rock.yields else 'rock_shards' end;
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

  elsif kind = 'seek' then
    -- A nose over ground nobody has turned. It finds what it knows to look
    -- for and no more, and nothing it brings up is sound.
    perform mark_foraged(p_world, wx, wy, 'dig');
    if random() > find_chance(skill, 30) then return null; end if;
    declare v_relic relic_def; v_part int;
    begin
      select * into v_relic from relics_within(skill) order by random() limit 1;
      if not found then return null; end if;
      v_part := 1 + floor(random() * v_relic.parts)::int;
      return jsonb_build_object('def', 'fragment', 'count', 1,
        'ql', least(100, greatest(1, skill * (0.6 + random() * 0.8))),
        'extra', v_relic.name || ' ' || v_part || '/' || v_relic.parts);
    end;

  elsif kind = 'fetch' then
    -- Whatever is lying there, carried home. A feller leaves two logs at every
    -- stump it works; this is what tidies them away.
    declare lying item;
    begin
      select * into lying from item where world_id = p_world and holder = 'ground'
        and gx = wx and gy = wy order by id limit 1;
      if not found then return null; end if;
      delete from item where id = lying.id;
      return jsonb_build_object('def', lying.def, 'count', lying.count,
        'ql', lying.ql, 'extra', lying.extra);
    end;

  elsif kind = 'compost' then
    -- Whatever it was, what comes back is compost, and the more of it the better.
    declare rot item;
    begin
      select * into rot from item where world_id = p_world and holder = 'ground'
        and gx = wx and gy = wy and (def = 'corpse' or dmg >= 40) order by id limit 1;
      if not found then return null; end if;
      delete from item where id = rot.id;
      return jsonb_build_object('def', 'compost', 'count', greatest(1, round(rot.count / 2.0)::int),
        'ql', least(100, 20 + skill * 0.6));
    end;

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
end $function$;

CREATE OR REPLACE FUNCTION public.worker_settle(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; dd deed; cr crate; kind text; guard int := 0; done int := 0;
        spot record; stand record; step record; pace double precision; dist double precision;
        secs double precision; load jsonb; cx double precision; cy double precision;
        ax double precision; ay double precision; v_foe creature; v_corpse item;
        v_step record; v_site record;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'deed' then return 0; end if;
  select * into dd from deed where world_id = p_world and founded_by = c.keeper;
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
  kind := d.gathers;
  cr := deed_crate(p_world, c.keeper);
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

    if fight_trade(kind) and c.phase = 'idle' and c.carrying is not null and cr.id is not null then
      ax := crate_centre_x(cr); ay := crate_centre_y(cr);
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
          c.until := c.until + make_interval(secs => fight_blow(kind));
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
      if load is null or cr.id is null then
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
      if c.carrying is not null and crate_add(p_world, cr.id, c.carrying->>'def',
          (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra') then
        c.carrying := null;
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

/*
 * The examine line, with the figures in it.
 *
 * `blood_read` named the traits and stopped, which on a page of real
 * multipliers is the same complaint in one sentence instead of three chips.
 */
CREATE OR REPLACE FUNCTION public.blood_read(p_world uuid, p_uid uuid, c creature)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare skill double precision; seen text[]; hidden int; d species_def; carrying text;
begin
  select * into d from species_def where id = c.species;
  skill := skill_of(p_world, p_uid, 'animal_husbandry');
  -- Blood does not read itself. Without the skill you can see that there is
  -- something in it; with the skill you can see what.
  select array_agg(t.id order by t.ord) into seen
  from unnest(coalesce(c.traits, '{}')) with ordinality t(id, ord)
  join trait_def td on td.id = t.id
  join tier_odds o on o.tier = td.tier
  where walks(p_world, p_uid, 'knowledge', 3) or skill >= 1 + o.level;
  seen := coalesce(seen, '{}');
  hidden := coalesce(array_length(c.traits, 1), 0) - coalesce(array_length(seen, 1), 0);
  carrying := case when c.due is not null
    then ' She is in young, due in about '
         || clock_left(extract(epoch from (c.due - now()))) || '.' else '' end;
  return c.name || ', ' || c.sex || ' ' || lower(d.name) || ', ' || age_of(c.born)
    || ' and ' || care_word(c.care) || '. It carries '
    || case when array_length(seen, 1) > 0 then trait_names(seen) else 'nothing you can read' end
    || case when hidden > 0 then ', and ' || case when hidden = 1 then 'one thing'
                                                  else hidden || ' things' end
                                 || ' you cannot read yet' else '' end
    || '.'
    -- And what that blood is actually worth, which the line had never said.
    -- Only over what can be read: a trait you cannot name is a trait whose
    -- figure you have not earned either.
    || coalesce(' That blood comes to ' || trait_worth(seen) || '.', '') || carrying;
end $function$;

notify pgrst, 'reload schema';
select private.lock_doors();
