-- Three numbers that were written down twice.
--
-- The world has a pace now — cotton takes five minutes a stage and everything
-- else the world does on its own keeps the ratio to that — and every world
-- duration is scaled where it is *defined*, so the definition dump carries it
-- down here already paced. That covers crops, brews, firing, smelting, traps,
-- fuel, lights, pregnancies and the length of a day, without a line of SQL.
--
-- Except for three it could not reach, because they were not definitions down
-- here at all. How long a beast is young, when it turns old, and how long a
-- run of offerings keeps its worth were `interval '1 hour'`, `interval '6
-- hours'` and `interval '90 seconds'`, hand-written into these functions and
-- duplicating the TypeScript exactly. Nothing noticed while the two agreed.
--
-- Moving the world's clock moved one copy and not the other, which would have
-- left the browser calling a beast grown at two and a half hours while this
-- database still called it young — and that is not a timer being wrong, it is
-- two islands disagreeing about the same animal. They are generated now, like
-- every other number, and these functions read them.

/** Young for a while, grown for a while longer, old after that. */
create or replace function age_of(p_born timestamptz) returns text
  language sql stable as $$
  select case
    when p_born is null then 'grown'
    when now() - p_born < make_interval(secs => young_for()) then 'young'
    when now() - p_born < make_interval(secs => old_at()) then 'grown'
    else 'old' end
$$;

/** What a run of offerings is worth to the next one, nothing once it has lapsed. */
create or replace function coax_bonus(c creature) returns double precision
  language sql stable as $$
  select case when c.coaxed <= 0 or c.coaxed_at is null
                or now() - c.coaxed_at > make_interval(secs => coax_lapse()) then 0
              else least(0.12, c.coaxed * 0.03) end
$$;

/**
 * The hour of the island's day.
 *
 * A fourth number written down twice: this had 1440 in it — the old length of
 * a day — while the browser had `DAY_SECONDS`. With the world's clock moved,
 * one of them says it is noon and the other says it is the small hours, and
 * everything that turns on the time of day splits in half: what is out
 * hunting, whether a lantern is worth lighting, how far anybody can see, and
 * whether a night of fighting teaches you anything.
 *
 * It reads `day_seconds()` now, which is generated from the same constant the
 * browser uses. Found because a fog test hard-coded 1440 as well and started
 * measuring midday in the dark — the test was wrong too, and it was wrong in
 * exactly the way that pointed here.
 */
create or replace function hour_of_day(p_world uuid) returns double precision
  language sql stable as $$
  select ((world_time(p_world)::numeric % day_seconds()::numeric) / day_seconds()::numeric)::double precision * 24
$$;

select private.lock_doors();
