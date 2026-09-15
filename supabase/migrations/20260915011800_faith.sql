-- An altar, three ways of looking at the island, and what either is worth.
--
-- ## Favour is the tenth thing that will not sit still, and it is a well
--
-- It comes back on its own at four thousandths a second, up to what your faith
-- will carry, and stops there. That is the same shape as a well: a rate, a
-- ceiling, and a note of when anybody last looked. `favour_settle` does for a
-- body what `well_settle` does for a hole in the ground.
--
-- ## And a rest is not a thing that ticks at all
--
-- A prayer is worth nothing again for most of an island day; a sitting the
-- same; every ability has its own wait. In the browser each of those is a
-- number compared against a running clock, which is the only way to say it
-- when there is a loop. Down here they are simply timestamps, and "may I do
-- this again" is `now() - prayed_at > prayer_rest()`. Nothing settles, nothing
-- is rolled forward, and the whole of the machinery is a column.
--
-- ## What a path is worth, and what is honestly not wired yet
--
-- `walks(path, n)` answers whether somebody has the nth step of a path behind
-- them, and the effects that live in rules this island already has are wired
-- to it: taming, the growth of a field, what a harvest gives, how fast work
-- teaches, and what a blow lands. Three are not, and are named here rather
-- than quietly skipped — carrying weight, the reach of sight, and how much of
-- a blow armour turns are all computed in the browser and nowhere on this
-- island yet, so `power 1`, `knowledge 5` and `power 5` have a row in the
-- table and no effect behind them.

alter table player add column if not exists favour_at timestamptz not null default now();
alter table player add column if not exists prayed_at timestamptz;
alter table player add column if not exists sat_at timestamptz;
alter table player add column if not exists used_at jsonb not null default '{}'::jsonb;
alter table player add column if not exists fury_until timestamptz;
alter table player add column if not exists wind_until timestamptz;

/* ------------------------------------------------------------------ *
 * Favour: what it holds, and what it comes back at.
 * ------------------------------------------------------------------ */

create or replace function faith_skill() returns text language sql immutable as $$ select 'prayer' $$;
create or replace function meditation_skill() returns text language sql immutable as $$ select 'meditation' $$;

/** How much favour this much faith will carry at once. */
create or replace function favour_cap(p_faith double precision) returns double precision
  language sql immutable as $$ select least(favour_ceiling(), 25 + p_faith * 0.95) $$;

/**
 * Bring somebody's favour up to now.
 *
 * It only ever goes up, and only to a ceiling, so there is nothing to lose by
 * asking late — which is the whole argument for settling it rather than
 * ticking it.
 */
create or replace function favour_settle(p_world uuid, p_uid uuid) returns double precision
  language plpgsql as $$
declare p player; cap double precision; now_favour double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return 0; end if;
  cap := favour_cap(skill_of(p_world, p_uid, faith_skill()));
  now_favour := least(cap, p.favour
    + extract(epoch from (now() - p.favour_at)) * favour_trickle());
  update player set favour = now_favour, favour_at = now()
    where world_id = p_world and uid = p_uid;
  return now_favour;
end $$;

/** An altar is worth more the better it was built, and dawn more than noon. */
create or replace function prayer_worth(p_ql double precision, p_hour double precision,
    p_faith double precision)
  returns double precision language sql immutable as $$
  -- The hour before the sun is properly up, and the one as it goes: those two.
  select prayer_favour()
       * (0.55 + greatest(greatest(0, 1 - abs(p_hour - 6) / 3),
                          greatest(0, 1 - abs(p_hour - 20) / 3)) * 0.75)
       * (0.6 + p_ql / 200)
       * (0.7 + p_faith / 220)
$$;

create or replace function is_altar(p placed) returns boolean language sql stable as $$
  select p.kind = 'furniture' and coalesce((select altar from furniture_def where id = p.sub), false)
$$;

/* ------------------------------------------------------------------ *
 * The paths.
 * ------------------------------------------------------------------ */

/** How many steps of their path somebody has behind them. */
create or replace function path_steps(p_way text, p_meditation double precision) returns int
  language sql stable as $$
  select case when p_way is null then 0 else
    (select count(*)::int from path_step s where s.path = p_way and p_meditation >= s.at) end
$$;

/** Whether somebody walks a path and has its nth step behind them. */
create or replace function walks(p_world uuid, p_uid uuid, p_path text, p_n int) returns boolean
  language sql stable as $$
  select exists (select 1 from player p where p.world_id = p_world and p.uid = p_uid
    and p.way = p_path
    and path_steps(p.way, skill_of(p_world, p_uid, meditation_skill())) >= p_n)
$$;

/** The step of somebody's path that answers to this ability, if any. */
create or replace function ability_of(p_world uuid, p_uid uuid, p_ability text) returns path_step
  language sql stable as $$
  select s.* from path_step s, player p
  where p.world_id = p_world and p.uid = p_uid and s.path = p.way
    and s.ability = p_ability
    and skill_of(p_world, p_uid, meditation_skill()) >= s.at
$$;

/**
 * What a sitting is worth, and what it felt like.
 *
 * Somewhere quiet and out of the way is worth more than the middle of your own
 * yard: the island does not give up much to somebody who has not gone looking.
 */
create or replace function sitting_worth(p_world uuid, p_uid uuid)
  returns table (gain double precision, said text) language plpgsql stable as $$
declare p player; tx int; ty int; quiet double precision := 1; h double precision; on_deed boolean;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  said := 'You sit down and let the day go past.';
  on_deed := exists (select 1 from deed d where d.world_id = p_world
    and abs(tx - d.x) <= d.radius and abs(ty - d.y) <= d.radius);
  if on_deed then
    quiet := quiet * 0.7;
    said := 'You sit in your own yard. It is hard to empty your head where there is so much to do.';
  end if;
  -- High, wild ground is what the paths are walked on.
  h := centre_height(p_world, tx, ty);
  if h > 60 then
    quiet := quiet * 1.6;
    said := 'You sit where the ground runs out and the air is thin, and the day goes past a long way below.';
  elsif h > 25 and not on_deed then
    quiet := quiet * 1.25;
    said := 'You sit on the high ground with your back to a stone.';
  end if;
  if has_water(p_world, tx, ty) then
    quiet := quiet * 1.3;
    said := 'You sit with your feet in the water and let it go past.';
  end if;
  gain := 1.5 * quiet;
  return next;
end $$;

/* ------------------------------------------------------------------ *
 * What favour and the paths actually do.
 * ------------------------------------------------------------------ */

/** Every field on the settlement, brought on one stage at once. */
create or replace function hasten_crops(p_world uuid) returns int language plpgsql as $$
declare n int;
begin
  with mine as (
    select c.x, c.y from crop c join deed d on d.world_id = c.world_id
    where c.world_id = p_world and c.stage < crop_ripe()
      and abs(c.x - d.x) <= d.radius and abs(c.y - d.y) <= d.radius
  ), bumped as (
    update crop set stage = stage + 1, stage_at = now(), tended_now = false
    where world_id = p_world and (x, y) in (select x, y from mine)
    returning 1
  )
  select count(*)::int into n from bumped;
  return n;
end $$;

/** Mark every seam within a radius as read, as a prospector would. */
create or replace function sense_rock(p_world uuid, p_uid uuid, p_radius int) returns int
  language plpgsql as $$
declare p player; tx int; ty int; sz int; tiles int[] := '{}'; r record;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  sz := (select size from world where id = p_world);
  for r in select x, y from
    generate_series(greatest(0, tx - p_radius), least(sz - 1, tx + p_radius)) x
    cross join generate_series(greatest(0, ty - p_radius), least(sz - 1, ty + p_radius)) y
    where (bedrock_at(p_world, x, y)).ore
    order by y, x
  loop
    tiles := tiles || (r.y * sz + r.x);
  end loop;
  perform mark_prospected(p_world, p_uid, tiles);
  return coalesce(array_length(tiles, 1), 0);
end $$;

/** Why this cast will not go, or null. */
create or replace function cast_reason(p_world uuid, p_uid uuid, p_cast text, p_uid_item bigint)
  returns text language plpgsql as $$
declare d cast_def; it item; faith double precision; have double precision;
begin
  select * into d from cast_def where id = p_cast;
  if not found then return 'Choose what to call for.'; end if;
  faith := skill_of(p_world, p_uid, faith_skill());
  if faith < d.level then
    return d.name || ' takes ' || to_char(d.level, 'FM990') || ' prayer; you have '
      || to_char(faith, 'FM990') || '.';
  end if;
  have := favour_settle(p_world, p_uid);
  if have < d.cost then
    return d.name || ' costs ' || to_char(d.cost, 'FM990') || ' favour; you hold '
      || to_char(floor(have), 'FM990') || '. Pray at an altar.';
  end if;
  if p_uid_item is not null then
    select * into it from item where world_id = p_world and id = p_uid_item
      and holder = 'player' and holder_uid = p_uid;
  end if;
  if d.on_what = 'item' and it.id is null then return 'Choose something to lay it on.'; end if;
  if p_cast = 'mend' and it.id is not null and it.dmg <= 0 then
    return 'There is nothing wrong with the ' || lower(item_name(it)) || '.';
  end if;
  if p_cast = 'cunning' and it.id is not null then
    if coalesce(it.bless, 0) >= bless_cap() then
      return 'The ' || lower(item_name(it)) || ' has taken all it will take.';
    end if;
    if it.issued then return 'What you washed ashore with has nothing in it to work on.'; end if;
  end if;
  if p_cast = 'call' and not exists (select 1 from creature c where c.world_id = p_world
      and c.mode = 'active' and c.keeper = p_uid) then
    return 'Nothing travels with you.';
  end if;
  if p_cast = 'dawnlight' and jsonb_array_length((select wounds from player
      where world_id = p_world and uid = p_uid)) = 0 then
    return 'Nothing is open on you.';
  end if;
  if p_cast = 'bounty' and not exists (select 1 from deed where world_id = p_world) then
    return 'You have no settlement, and so no fields.';
  end if;
  return null;
end $$;

/** Work one cast. What comes back is what it did, for the log. */
create or replace function do_cast(p_world uuid, p_uid uuid, p_cast text, p_uid_item bigint)
  returns text language plpgsql as $$
declare d cast_def; it item; p player; c creature; n int;
begin
  select * into d from cast_def where id = p_cast;
  perform favour_settle(p_world, p_uid);
  update player set favour = greatest(0, favour - d.cost)
    where world_id = p_world and uid = p_uid;
  perform skill_raise(p_world, p_uid, faith_skill(), 0.6);
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_uid_item is not null then
    select * into it from item where world_id = p_world and id = p_uid_item;
  end if;

  if p_cast = 'call' then
    select * into c from creature where world_id = p_world and mode = 'active' and keeper = p_uid
      limit 1;
    if not found then return 'Nothing comes.'; end if;
    update creature set from_x = p.x + 0.6, from_y = p.y, to_x = p.x + 0.6, to_y = p.y,
        leg_at = now(), leg_ends = now(), settled_at = now(), enemy = null, hunting = null
      where world_id = p_world and id = c.id;
    return c.name || ' is beside you, and gives no sign of having travelled.';

  elsif p_cast = 'mend' then
    if it.id is null then return 'Nothing to mend.'; end if;
    update item set dmg = 0 where id = it.id;
    return 'Every mark of use goes out of the ' || lower(item_name(it)) || '.';

  elsif p_cast = 'dawnlight' then
    n := jsonb_array_length(p.wounds);
    update player set wounds = '[]'::jsonb,
        stats = jsonb_set(stats, '{health}',
          to_jsonb(least(1, coalesce((stats->>'health')::double precision, 1) + 0.25)))
      where world_id = p_world and uid = p_uid;
    return case when n = 1 then 'The wound closes over, and what had gone bad is clean.'
                else 'All ' || n || ' of them close over, and what had gone bad is clean.' end;

  elsif p_cast = 'cunning' then
    if it.id is null then return 'Nothing to work on.'; end if;
    update item set bless = least(bless_cap(), coalesce(bless, 0) + 1) where id = it.id;
    select * into it from item where id = it.id;
    return 'The ' || lower(item_name(it)) || ' comes out of it working '
      || round(least(bless_cap(), coalesce(it.bless, 0)) * bless_step()) || '% better than it was made. ('
      || it.bless || ' of ' || round(bless_cap()) || ')';

  elsif p_cast = 'fairwind' then
    update player set wind_until = now() + interval '6 minutes'
      where world_id = p_world and uid = p_uid;
    return 'The wind comes round behind you and settles there.';

  elsif p_cast = 'bounty' then
    n := hasten_crops(p_world);
    return case when n > 0 then 'Every field on the settlement comes on a stage: ' || n || ' of them.'
                else 'Nothing is in the ground to come on.' end;
  end if;
  return 'Nothing happens.';
end $$;

/** Call on what a path has taught, whatever that turns out to be. */
create or replace function work_ability(p_world uuid, p_uid uuid, p_ability text) returns text
  language plpgsql as $$
declare p player; n int; d deed;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_ability = 'refresh' then
    update player set stats = jsonb_set(jsonb_set(stats, '{hunger}', '1'), '{thirst}', '1')
      where world_id = p_world and uid = p_uid;
    return 'You are neither hungry nor thirsty, and cannot say when that happened.';

  elsif p_ability = 'mendflesh' then
    n := jsonb_array_length(p.wounds);
    update player set wounds = '[]'::jsonb,
        stats = jsonb_set(stats, '{health}',
          to_jsonb(least(1, coalesce((stats->>'health')::double precision, 1) + 0.4)))
      where world_id = p_world and uid = p_uid;
    return case when n = 1 then 'The wound closes and the ache goes with it.'
                when n > 1 then 'All ' || n || ' of them close and the ache goes with them.'
                else 'There was nothing to mend, and you feel better anyway.' end;

  elsif p_ability = 'sense' then
    n := sense_rock(p_world, p_uid, 15);
    return case when n > 0 then 'The ground gives up what is in it: ' || n
                  || ' seams within fifteen tiles, marked.'
                else 'There is nothing under this ground but rock.' end;

  elsif p_ability = 'recall' then
    select * into d from deed where world_id = p_world;
    if not found then return 'You have nowhere to be recalled to.'; end if;
    update player set x = d.x + 0.5, y = d.y + 1.5, moved_at = now()
      where world_id = p_world and uid = p_uid;
    perform drag_along(p_world, p_uid, d.x + 0.5, d.y + 1.5);
    return 'You are standing at the token of ' || d.name
      || ', and the walk is simply not in your legs.';

  elsif p_ability = 'secondwind' then
    update player set stats = jsonb_set(stats, '{stamina}', '1')
      where world_id = p_world and uid = p_uid;
    return 'Your wind comes back all at once.';

  elsif p_ability = 'fury' then
    update player set fury_until = now() + interval '30 seconds'
      where world_id = p_world and uid = p_uid;
    return 'For half a minute nothing you swing at is going to enjoy it.';
  end if;
  return 'Nothing happens.';
end $$;

/** What everything you hit takes, over what it would take. */
create or replace function fury_mult(p_world uuid, p_uid uuid) returns double precision
  language sql stable as $$
  select case when exists (select 1 from player p where p.world_id = p_world and p.uid = p_uid
                             and p.fury_until > now()) then 2 else 1 end
$$;

select private.lock_doors();
