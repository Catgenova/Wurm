-- Wildermon: the things that are alive when nobody is looking.
--
-- ## A creature is a walk, not a place
--
-- Everything else on this island settles from a timestamp: a fire burns down,
-- a crop comes on, a forage bed recovers. None of them *move*. A creature
-- does, and a column called `x` would be a lie the moment the last person
-- looked away — it would say where the thing was, not where it is.
--
-- So a creature is stored as the leg it is on: from a point, to a point,
-- starting at a moment and ending at one, and then standing still until the
-- next leg begins. Where it is now is the interpolation, which anybody can
-- work out without writing anything. When the leg is over, whoever touches it
-- next walks it forward — and because the next leg is a hash of the creature
-- and the leg number rather than a roll, walking it forward twice lands it in
-- the same place.
--
-- ## Why there is no streaming here
--
-- The browser keeps only the wildlife near the player and banks the rest as a
-- number per stretch of country, because a frame has to touch everything that
-- exists. Nothing here touches a creature unless somebody asks about it, so
-- the whole island's wildlife is simply rows: a Rabba nobody has seen for a
-- week costs one row and is brought up to date the moment somebody walks past.

/* ------------------------------------------------------------------ *
 * The hour, and the dark.
 * ------------------------------------------------------------------ */

create or replace function hour_of_day(p_world uuid) returns double precision
  language sql stable as $$ select ((world_time(p_world)::numeric % 1440) / 1440)::double precision * 24 $$;

/** Nought at noon, one in the small hours, and a ramp at either end of the day. */
create or replace function darkness(p_world uuid) returns double precision
  language sql stable as $$
  select case
    when h >= 7 and h <= 19 then 0
    when h >= 21 or h <= 5 then 1
    when h > 12 then least(1, greatest(0, (h - 19) / 2))
    else least(1, greatest(0, (7 - h) / 2)) end
  from (select hour_of_day(p_world) as h) q
$$;

create or replace function is_night(p_world uuid) returns boolean
  language sql stable as $$ select darkness(p_world) > 0.45 $$;

/* ------------------------------------------------------------------ *
 * Blood, and age.
 * ------------------------------------------------------------------ */

/** One creature's own traits multiplied together on a channel. */
create or replace function trait_mul(p_traits text[], p_channel text) returns double precision
  language sql stable as $$
  select coalesce(exp(sum(ln(e.mul))), 1) from trait_effect e
  where e.channel = p_channel and e.trait = any(coalesce(p_traits, '{}'))
$$;

create or replace function trait_names(p_traits text[]) returns text
  language sql stable as $$
  select coalesce(string_agg(d.name, ', ' order by o.ord), 'nothing in particular')
  from unnest(coalesce(p_traits, '{}')) with ordinality o(id, ord)
  join trait_def d on d.id = o.id
$$;

/** The best tier in a set of traits, which is what a keeper reads first. */
create or replace function best_tier(p_traits text[]) returns text
  language sql stable as $$
  select d.tier from trait_def d
  join tier_odds t on t.tier = d.tier
  where d.id = any(coalesce(p_traits, '{}'))
  order by t.ord desc limit 1
$$;

/**
 * Three traits out of the wild.
 *
 * Rolled from the tier table and then from the tier, avoiding what is already
 * there. Husbandry tilts it, exactly as it does in the browser: a keeper who
 * knows what they are looking at finds better blood in the wild as well as
 * breeding it.
 */
create or replace function roll_traits(p_husbandry double precision default 0) returns text[]
  language plpgsql as $$
/*
 * Every local name here is prefixed, and that is not tidiness.
 *
 * A plpgsql variable called `tier` inside a query against `trait_def` is not
 * a variable, it is the column — Postgres says "ambiguous" if you are lucky
 * and quietly means the column if you are not. It has cost this island a
 * `land_tile.y` and a `crop.y` already.
 */
declare v_lift double precision := greatest(0, least(100, p_husbandry)) / 100;
        v_out text[] := '{}'; v_tier text; v_got text; v_i int;
begin
  for v_i in 1..trait_slots() loop
    select t.tier into v_tier from tier_odds t
    order by random() / greatest(1e-9, t.weight * case t.tier
        when 'common' then 1 - v_lift * 0.35 when 'rare' then 1 + v_lift * 1.5
        when 'supreme' then 1 + v_lift * 3 else 1 + v_lift * 5 end)
    limit 1;
    select d.id into v_got from trait_def d
    where d.tier = v_tier and not (d.id = any(v_out)) order by random() limit 1;
    -- Nothing left in that tier: take anything that is not already in.
    if v_got is null then
      select d.id into v_got from trait_def d where not (d.id = any(v_out)) order by random() limit 1;
    end if;
    if v_got is not null then v_out := v_out || v_got; end if;
  end loop;
  return v_out;
end $$;

/** Young for an hour, grown for five more, old after that. */
create or replace function age_of(p_born timestamptz) returns text
  language sql stable as $$
  select case
    when p_born is null then 'grown'
    when now() - p_born < interval '1 hour' then 'young'
    when now() - p_born < interval '6 hours' then 'grown'
    else 'old' end
$$;

create or replace function age_row(p_born timestamptz) returns age_def
  language sql stable as $$ select * from age_def where id = age_of(p_born) $$;

/* ------------------------------------------------------------------ *
 * The creature itself.
 * ------------------------------------------------------------------ */

create table if not exists creature (
  world_id uuid not null references world on delete cascade,
  id int not null,
  species text not null,
  name text not null,
  variant int not null default 0,
  mode text not null default 'wild' check (mode in ('wild', 'active', 'deed', 'stored')),
  stance text not null default 'defensive' check (stance in ('passive', 'defensive', 'aggressive')),
  /**
   * The leg it is on. Where it is now is `from` walked towards `to` by however
   * much of the time between `leg_at` and `leg_ends` has gone by; after that
   * it stands at `to` until `until`, and then takes the next one.
   */
  from_x double precision not null,
  from_y double precision not null,
  to_x double precision not null,
  to_y double precision not null,
  leg_at timestamptz not null default now(),
  leg_ends timestamptz not null default now(),
  until timestamptz not null default now(),
  leg int not null default 0,
  health real not null,
  hunger real not null default 1,
  fleece real not null default 0,
  care real not null default 0,
  xp real not null default 0,
  sex text not null check (sex in ('male', 'female')),
  traits text[] not null default '{}',
  skills jsonb not null default '{}',
  /** The hour it was born; null for whatever was already walking about. */
  born timestamptz,
  /** Offerings taken from one hand in a row, and when the last was taken. */
  coaxed int not null default 0,
  coaxed_at timestamptz,
  hurt_at timestamptz,
  /** Whose it is, once somebody has won it over. */
  keeper uuid,
  /** When the body was last brought up to date. */
  settled_at timestamptz not null default now(),
  primary key (world_id, id)
);
create index if not exists creature_by_world on creature (world_id, mode);
create index if not exists creature_by_keeper on creature (world_id, keeper) where keeper is not null;

alter table creature enable row level security;
drop policy if exists creature_read on creature;
create policy creature_read on creature for select to authenticated using (true);
grant select on creature to authenticated;
revoke insert, update, delete on creature from anon, authenticated;

/* ------------------------------------------------------------------ *
 * Where it is.
 * ------------------------------------------------------------------ */

/** How far along its leg it is, 0 at the start and 1 once it has arrived. */
create or replace function leg_t(c creature) returns double precision
  language sql stable as $$
  select case when c.leg_ends <= c.leg_at then 1 else
    least(1, greatest(0, extract(epoch from (now() - c.leg_at))
                       / extract(epoch from (c.leg_ends - c.leg_at)))) end
$$;

create or replace function creature_x(c creature) returns double precision
  language sql stable as $$ select c.from_x + (c.to_x - c.from_x) * leg_t(c) $$;
create or replace function creature_y(c creature) returns double precision
  language sql stable as $$ select c.from_y + (c.to_y - c.from_y) * leg_t(c) $$;

/* ------------------------------------------------------------------ *
 * Ground it will stand on.
 * ------------------------------------------------------------------ */

/** The lie of the land at the middle of a tile: the four corners, averaged. */
create or replace function centre_height(p_world uuid, p_x int, p_y int) returns double precision
  language sql stable as $$
  select (land_height(p_world, p_x, p_y) + land_height(p_world, p_x + 1, p_y)
        + land_height(p_world, p_x + 1, p_y + 1) + land_height(p_world, p_x, p_y + 1)) / 4.0
$$;

create or replace function creature_tile_ok(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select passable(p_world, p_x, p_y) and centre_height(p_world, p_x, p_y) >= -1
$$;

/**
 * Whether a straight line between two points is ground the whole way.
 *
 * A wanderer picks a spot a few tiles off and walks to it, and nothing is
 * watching it take the steps — but a leg that crossed a river would still be
 * wrong when somebody arrived and found it standing in the water. So the line
 * is sampled every half tile, which is close enough that it cannot step over
 * anything a creature could not walk round.
 */
create or replace function line_clear(p_world uuid, p_x0 double precision, p_y0 double precision,
                                      p_x1 double precision, p_y1 double precision) returns boolean
  language sql stable as $$
  select bool_and(creature_tile_ok(p_world,
      floor(p_x0 + (p_x1 - p_x0) * (i / steps.n))::int,
      floor(p_y0 + (p_y1 - p_y0) * (i / steps.n))::int))
  from (select greatest(1, ceil(2 * sqrt((p_x1 - p_x0) ^ 2 + (p_y1 - p_y0) ^ 2))) as n) steps,
       generate_series(0, steps.n::int) i
$$;

/** Whether open water, clay, tar or trees lie within a few tiles of here. */
create or replace function near_tile(p_world uuid, p_x int, p_y int, p_what text, p_range int default 4)
  returns boolean language sql stable as $$
  select exists (
    select 1 from generate_series(p_x - p_range, p_x + p_range) gx,
                  generate_series(p_y - p_range, p_y + p_range) gy
    where in_bounds(p_world, gx, gy)
      and case p_what
        when 'water' then has_water(p_world, gx, gy)
        when 'clay'  then land_tile(p_world, gx, gy) = tile_id('Clay')
        when 'trees' then land_tile(p_world, gx, gy) = tile_id('Tree')
        when 'tar'   then land_tile(p_world, gx, gy) in (tile_id('Tar'), tile_id('Peat'), tile_id('Marsh'))
        else false end)
$$;

/**
 * Whether a stretch of ground is the sort a species settles on. A Mola
 * settles over metal, bare or buried, a Crawler on the sand and a Gorral on
 * bare rock; the rest want something growing. Beyond the ground itself a few
 * of them want water, trees, clay or tar within sight of the door, and a Lume
 * wants the sun down.
 */
create or replace function suits(p_world uuid, p_species text, p_x int, p_y int) returns boolean
  language plpgsql stable as $$
declare d species_def;
begin
  select * into d from species_def where id = p_species;
  if not found then return false; end if;
  if d.on_ore then
    if (bedrock_at(p_world, p_x, p_y)).ore is not true then return false; end if;
  elsif d.on_sand then
    if land_tile(p_world, p_x, p_y) <> tile_id('Sand') then return false; end if;
  elsif d.on_stone then
    -- Bare rock with nothing in it: the Mola takes the seams, the Quarra the rest.
    if land_tile(p_world, p_x, p_y) <> tile_id('Rock')
       or (bedrock_at(p_world, p_x, p_y)).ore is true then return false; end if;
  elsif not coalesce((select forage from tile_def where id = land_tile(p_world, p_x, p_y)), false) then
    return false;
  end if;
  if d.near_water and not near_tile(p_world, p_x, p_y, 'water') then return false; end if;
  if d.near_trees and not near_tile(p_world, p_x, p_y, 'trees') then return false; end if;
  if d.near_clay  and not near_tile(p_world, p_x, p_y, 'clay')  then return false; end if;
  if d.near_tar   and not near_tile(p_world, p_x, p_y, 'tar')   then return false; end if;
  if d.nocturnal and not is_night(p_world) then return false; end if;
  return true;
end $$;

/* ------------------------------------------------------------------ *
 * What it can take, and what it is worth.
 * ------------------------------------------------------------------ */

create or replace function max_health(c creature) returns double precision
  language sql stable as $$
  select round((select health from species_def where id = c.species) * trait_mul(c.traits, 'hardy'))
$$;

create or replace function attack_of(c creature) returns double precision
  language sql stable as $$
  select (select attack from species_def where id = c.species) * trait_mul(c.traits, 'tough')
$$;

/** Read off its best task skill, the same way the browser reads it. */
create or replace function creature_level(p_skills jsonb) returns int
  language sql stable as $$
  select 1 + floor(coalesce((select max(value::numeric) from jsonb_each_text(p_skills)), 0) / 5)::int
$$;

create or replace function care_word(p_care double precision) returns text
  language sql immutable as $$
  select case when p_care >= 0.75 then 'well looked after' when p_care >= 0.4 then 'kept'
              when p_care >= 0.12 then 'wanting a brush' else 'neglected' end
$$;

/** What a run of offerings is worth to the next one, nothing once it has lapsed. */
create or replace function coax_bonus(c creature) returns double precision
  language sql stable as $$
  select case when c.coaxed <= 0 or c.coaxed_at is null
                or now() - c.coaxed_at > interval '90 seconds' then 0
              else least(0.12, c.coaxed * 0.03) end
$$;

create or replace function is_bait_for(p_species text, p_item text) returns boolean
  language sql stable as $$
  select exists (select 1 from species_diet where species = p_species and item = p_item)
$$;

/** "blueberries, raspberries or potatoes" — everything this one will take. */
create or replace function diet_text(p_species text) returns text
  language sql stable as $$
  select case when count(*) = 1 then max(nm)
    else array_to_string((array_agg(nm order by nm))[1:count(*) - 1], ', ')
         || ' or ' || (array_agg(nm order by nm))[count(*)] end
  from (select lower((select coalesce(d.name, s.item) from item_def d where d.id = s.item)) nm
        from species_diet s where s.species = p_species) q
$$;

/** The first thing in somebody's pack that this species will eat. */
create or replace function bait_in_pack(p_world uuid, p_uid uuid, p_species text) returns text
  language sql stable as $$
  select i.def from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    and is_bait_for(p_species, i.def)
  order by i.id limit 1
$$;

/* ------------------------------------------------------------------ *
 * Standing one up.
 * ------------------------------------------------------------------ */

/**
 * How fast a belly empties, per second. Roughly the pace a player's own
 * hunger falls, so a wildermon goes most of an hour between meals rather than
 * needing one every few minutes. Nothing kept at the token gets hungry.
 */
create or replace function hunger_rate(p_mode text) returns double precision
  language sql immutable as $$
  select case p_mode when 'wild' then 0.0005 when 'active' then 0.00025
                     when 'deed' then 0.0004 else 0 end
$$;

create or replace function creature_spawn(p_world uuid, p_species text,
    p_x double precision, p_y double precision, p_mode text default 'wild',
    p_born timestamptz default null, p_keeper uuid default null) returns int
  language plpgsql as $$
declare d species_def; new_id int; tr text[]; sk jsonb := '{}'::jsonb; gskill text;
begin
  select * into d from species_def where id = p_species;
  if not found then return null; end if;
  select coalesce(max(id), 0) + 1 into new_id from creature where world_id = p_world;
  tr := roll_traits(0);
  -- A worker starts knowing nothing about its trade and learns it by doing it.
  select skill into gskill from gather_def where id = d.gathers;
  if gskill is not null then sk := jsonb_build_object(gskill, 1); end if;
  insert into creature (world_id, id, species, name, variant, mode, stance,
      from_x, from_y, to_x, to_y, leg_at, leg_ends, until,
      health, hunger, fleece, care, sex, traits, skills, born, keeper)
  values (p_world, new_id, d.id, d.name, floor(random() * greatest(1, d.variants))::int,
      p_mode, coalesce(d.default_stance, 'defensive'),
      p_x, p_y, p_x, p_y, now(), now(), now(),
      round(d.health * trait_mul(tr, 'hardy')), 0.6 + random() * 0.4, 0.6 + random() * 0.4,
      0, case when random() < 0.5 then 'male' else 'female' end, tr, sk, p_born, p_keeper);
  return new_id;
end $$;

/**
 * Which of the bad things, if any. Each sort is capped across the island and
 * the big ones keep away from anywhere anybody lives: nothing walks out of the
 * trees onto your deed.
 */
create or replace function pick_monster(p_world uuid, p_x int, p_y int) returns text
  language plpgsql stable as $$
declare got text; want double precision; d record;
begin
  select w.species into got from wild_table w
  where w.monster and (select count(*) from creature c
    where c.world_id = p_world and c.mode = 'wild' and c.species = w.species) < w.cap
  order by random() / greatest(1e-9, w.weight) limit 1;
  if got is null then return null; end if;
  want := case got when 'dragon' then 90 when 'ogre' then 55 when 'orc' then 40 else 26 end;
  if exists (select 1 from deed dd where dd.world_id = p_world
             and sqrt((p_x - dd.x) ^ 2 + (p_y - dd.y) ^ 2) < want) then
    return null;
  end if;
  return got;
end $$;

/** The wild mix, weighted; now and again what stands up is not a wildermon at all. */
create or replace function pick_wild(p_world uuid, p_x int, p_y int) returns text
  language plpgsql stable as $$
declare got text;
begin
  if random() < monster_share() then return pick_monster(p_world, p_x, p_y); end if;
  select species into got from wild_table where not monster
  order by random() / greatest(1e-9, weight) limit 1;
  return got;
end $$;

/** How much wildlife an island of this size should hold in all. */
create or replace function creature_target(p_world uuid) returns int
  language sql stable as $$
  select greatest(32, (ceil(size / 32.0) * ceil(size / 32.0))::int) from world where id = p_world
$$;

/**
 * Lay a whole island's wildlife down at once.
 *
 * The browser banks this as a number per stretch of country and only gives a
 * body to what somebody is near, because a frame costs. Nothing here touches a
 * creature unless it is asked about, so they are simply rows from the start —
 * and an island that has never been walked still has wildlife on it that has
 * been getting on with its life the whole time.
 */
create or replace function creature_stock(p_world uuid) returns int
  language plpgsql as $$
declare want int; placed int := 0; tries int := 0; size int; gx int; gy int; got text;
begin
  select w.size into size from world w where w.id = p_world;
  want := creature_target(p_world) - (select count(*) from creature where world_id = p_world and mode = 'wild');
  while placed < want and tries < want * 40 loop
    tries := tries + 1;
    gx := floor(random() * size)::int;
    gy := floor(random() * size)::int;
    if not creature_tile_ok(p_world, gx, gy) then continue; end if;
    if centre_height(p_world, gx, gy) < 2 or on_deed(p_world, gx, gy) then continue; end if;
    got := pick_wild(p_world, gx, gy);
    if got is null or not suits(p_world, got, gx, gy) then continue; end if;
    -- Born at some point in the past, so the country is not all yearlings.
    perform creature_spawn(p_world, got, gx + 0.5, gy + 0.5, 'wild',
      now() - make_interval(secs => random() * 6 * 3600 * 1.6));
    placed := placed + 1;
  end loop;
  return placed;
end $$;

/* ------------------------------------------------------------------ *
 * Walking it forward.
 * ------------------------------------------------------------------ */

/**
 * Bring one creature up to date: its body from the clock, and its walk from
 * wherever its last leg left it.
 *
 * The legs are a hash of the creature and the leg number rather than a roll,
 * so walking the same row forward twice puts it in the same place. And a leg
 * begins when the last one's rest ended rather than now — the same no-drift
 * rule a crop's stages follow, and for the same reason.
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
  else
    -- Kept at the token, or working the deed: it stands by the token.
    select dd.x + 0.5 as x, dd.y + 1.5 as y into home from deed dd where dd.world_id = p_world;
    if found and c.mode = 'stored' then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      settled_at = now()
    where world_id = p_world and id = p_id;
  return true;
end $$;

/** Everything alive within reach of a point, brought up to date on the way out. */
create or replace function creature_sweep(p_world uuid, p_x double precision, p_y double precision,
                                          p_range double precision default 40) returns int
  language plpgsql as $$
declare r record; n int := 0;
begin
  for r in select id from creature
    where world_id = p_world
      and greatest(abs(to_x - p_x), abs(to_y - p_y)) <= p_range + 8
      and until <= now()
    order by id limit 120
  loop
    if creature_settle(p_world, r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

/**
 * What is alive around you, walked forward first.
 *
 * This is the one call that makes the island move: nothing ticks, so the
 * wildlife near whoever is looking is brought up to date by the looking.
 */
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
      'sex', c.sex, 'age', age_of(c.born), 'traits', c.traits, 'mine', coalesce(c.keeper = me, false))
      order by c.id)
    from creature c
    where c.world_id = p_world
      and greatest(abs(creature_x(c) - p.x), abs(creature_y(c) - p.y)) <= p_range), '[]'::jsonb);
end $$;

/** The creature a target names, if it is close enough to touch. */
create or replace function target_creature(p_world uuid, p_target jsonb) returns creature
  language sql stable as $$
  select * from creature where world_id = p_world and id = (p_target->>'id')::int
$$;

create or replace function creature_in_reach(p_world uuid, p_uid uuid, c creature,
                                             p_range double precision default 1.9)
  returns boolean language sql stable as $$
  select exists (select 1 from player p where p.world_id = p_world and p.uid = p_uid
    and sqrt((creature_x(c) - p.x) ^ 2 + (creature_y(c) - p.y) ^ 2) <= p_range)
$$;

select private.lock_doors();
