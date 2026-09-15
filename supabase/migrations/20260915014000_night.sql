-- A bed, a night, and the rest that comes of it.
--
-- ## You cannot make the island wait, so you make it have been longer
--
-- Every other thing in this port settles *forward*: something happened at a
-- moment, time has passed, work out how much of it. Sleeping is the one action
-- that asks for the opposite — the browser adds ten hours to its clock and
-- then walks every subsystem forward by hand, because it has a loop and a
-- clock it owns.
--
-- There is no clock here to move. `now()` is Postgres's and it will not be
-- argued with, and the hour of the island's day is `now() - world.epoch`. So
-- sleeping does not move the world forward: it moves the world's **memory
-- back**. Every timestamp this island settles from — when a fire was last
-- looked at, when a crop last came on, when a trap was last rolled, when
-- somebody last prayed — is pushed backwards by the length of the night, and
-- the epoch with them. Nothing is walked forward at all. The next person to
-- look at any of it finds that the night happened, because from where they are
-- standing it did.
--
-- Two things are deliberately *not* pushed back, and both would be bugs:
--
--   - `creature.born`, because a night should age a yearling rather than leave
--     it exactly as young as it was.
--   - `player.moved_at`, because `rpc_move` believes a claimed position in
--     proportion to how long it has been since you last said where you were. A
--     night's memory shifted there would be a night's worth of travel allowed
--     in one step. (The ceiling clamps the gap at ten seconds, so it was never
--     actually reachable — but relying on a clamp somewhere else to save a
--     mistake here is not a reason to make it.)
--
-- ## And rest is spent by the clock rather than by the work
--
-- The browser burns a night's banked rest only while you are actually working:
-- standing about does not spend it. There is nothing here that knows whether
-- you are working, and building something that did would mean a loop. So rest
-- runs out on the wall clock instead, from the moment you wake. A night is
-- worth the same amount; it simply cannot be saved up by idling. Named here
-- because it is a real difference and not an oversight.

alter table player add column if not exists rested_at timestamptz not null default now();
alter table player add column if not exists home_x int;
alter table player add column if not exists home_y int;

/** Something to sleep in. */
create or replace function is_bed(p placed) returns boolean language sql stable as $$
  select p.kind = 'furniture' and coalesce((select bed from furniture_def where id = p.sub), 0) > 0
$$;

/** How much of a night's rest this body still has in it, in seconds. */
create or replace function rest_left(p player) returns double precision language sql stable as $$
  select greatest(0, p.rested - extract(epoch from (now() - p.rested_at)))
$$;

/** What rest is worth while it burns, for the skill curve. */
create or replace function rest_bonus(p_world uuid, p_uid uuid) returns double precision
  language sql stable as $$
  select case when exists (select 1 from player p where p.world_id = p_world and p.uid = p_uid
                             and rest_left(p) > 0) then rest_mult() else 1 end
$$;

/** The island's own clock, as a clock. */
create or replace function world_clock(p_world uuid) returns text language sql stable as $$
  select to_char(floor(h), 'FM00') || ':' || to_char(floor((h - floor(h)) * 60), 'FM00')
  from (select hour_of_day(p_world) as h) q
$$;

/**
 * Push the island's memory back, which is the only way anything here can be
 * made to have taken longer than it did.
 *
 * Every `since`, `at`, `stage_at` and `settled_at` is a note of when somebody
 * last looked; moving one back by a night is exactly equivalent to walking
 * whatever it belongs to forward by a night, and costs one statement instead
 * of a subsystem.
 */
create or replace function sleep_forward(p_world uuid, p_uid uuid, p_seconds double precision)
  returns void language plpgsql as $$
declare gap interval := make_interval(secs => p_seconds);
begin
  update world set epoch = epoch - gap where id = p_world;

  update placed set since = since - gap where world_id = p_world;
  update crop set stage_at = stage_at - gap where world_id = p_world;
  update foraged set at = at - gap where world_id = p_world;
  update item set made_at = made_at - gap,
      lit_at = case when lit_at is null then null else lit_at - gap end
    where world_id = p_world;
  -- Everything a creature remembers except being born.
  update creature set settled_at = settled_at - gap, leg_at = leg_at - gap,
      leg_ends = leg_ends - gap, until = until - gap,
      coaxed_at = case when coaxed_at is null then null else coaxed_at - gap end,
      hurt_at = case when hurt_at is null then null else hurt_at - gap end,
      due = case when due is null then null else due - gap end,
      bred_at = case when bred_at is null then null else bred_at - gap end
    where world_id = p_world;
  -- And everything a body remembers except where it last said it was standing.
  update player set favour_at = favour_at - gap,
      prayed_at = case when prayed_at is null then null else prayed_at - gap end,
      sat_at = case when sat_at is null then null else sat_at - gap end
    where world_id = p_world;
end $$;

/**
 * A night, from wherever the clock has got to until half an hour after dawn.
 *
 * `rest` is what the bed is worth: a well-made one banks more of the night than
 * a cot with a thin mattress.
 */
create or replace function sleep_until_morning(p_world uuid, p_uid uuid, p_rest double precision,
    p_what text)
  returns void language plpgsql as $$
declare h double precision; hours double precision; secs double precision; p player;
        banked double precision; was double precision;
begin
  h := hour_of_day(p_world);
  hours := case when h < dawn_hour() + 0.5 then dawn_hour() + 0.5 - h
                else 24 - h + dawn_hour() + 0.5 end;
  secs := hours / 24 * day_seconds();
  perform sleep_forward(p_world, p_uid, secs);

  select * into p from player where world_id = p_world and uid = p_uid for update;
  was := rest_left(p);
  banked := least(rest_cap(), was + secs * rest_per_second() * p_rest);
  update player set
      stats = jsonb_set(jsonb_set(jsonb_set(stats,
        '{stamina}', '1'),
        '{health}', to_jsonb(least(1, coalesce((stats->>'health')::double precision, 1) + 0.25 * p_rest))),
        '{hunger}', to_jsonb(greatest(0, coalesce((stats->>'hunger')::double precision, 1) - 0.2))),
      rested = banked, rested_at = now()
    where world_id = p_world and uid = p_uid;
  -- Sleeping is hungry work, and a night is a long time to go without water.
  update player set stats = jsonb_set(stats, '{thirst}',
      to_jsonb(greatest(0, coalesce((stats->>'thirst')::double precision, 1) - 0.25)))
    where world_id = p_world and uid = p_uid;
  perform skill_raise(p_world, p_uid, 'body_stamina', 0.3 * p_rest);

  perform tell(p_world, p_uid, 'You sleep in the ' || p_what || ' and wake at '
    || world_clock(p_world) || ', rested.'
    || case when banked - was > 1
       then ' You have ' || clock_left(banked) || ' of rest in you; while it burns, '
            || 'everything teaches you twice as much.'
       else '' end, 'event');
end $$;

select private.lock_doors();
