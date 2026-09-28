/*
 * Seasons of thirty days, a day of the year as long as a day and night of the
 * island's clock.
 *
 * Asked for: "seasons are changing way too quickly. they should last
 * approximately 30 in game day cycles". A day of the year was a real day,
 * turning at the woods' hour, and a season seven of them; a day of the year
 * is `day_seconds()` now, the length of the clock's day and night, and a
 * season `season_days()` of them. The browser's `seasonAt`
 * (src/world/calendar.ts) counts the same, and the lengths come over with the
 * definitions, so nothing here says a number of its own.
 * `supabase/test/year.ts` holds the two sides to each other.
 *
 * Everything that keeps the year reads it through these: the seasons a
 * wildflower, a water plant or the ivy is in flower in, the year a picked
 * tile of flowers waits out (`year_of`), the season a water plant's picking
 * lasts (`season_began`), and the field clock, whose lengths are the
 * definitions' own (`season_seconds`, `year_seconds`).
 */

/** Days of the year since the first dawn of the first spring, each `day_seconds()` long; below nought before it. */
create or replace function year_day(p_at timestamptz default now())
returns int language sql stable as $fn$
  select floor((extract(epoch from p_at)::double precision - year_from()) / day_seconds())::int
$fn$;

/** The season at a moment: spring, summer, autumn or winter. */
create or replace function season_at(p_at timestamptz default now())
returns text language sql stable as $fn$
  select (seasons())[1 + mod(mod(year_day(p_at), year_days()) + year_days(), year_days()) / season_days()]
$fn$;

/** Which day of its season a moment falls on, from 1 to `season_days()`. */
create or replace function season_day_at(p_at timestamptz default now())
returns int language sql stable as $fn$
  select 1 + mod(mod(mod(year_day(p_at), year_days()) + year_days(), year_days()), season_days())
$fn$;

/** Which year a moment falls in: nought for the first, below nought before it. The browser's `yearOf`. */
create or replace function year_of(p_at timestamptz default now())
returns int language sql stable as $fn$
  select floor(year_day(p_at)::numeric / year_days())::int
$fn$;

/** The first dawn of the season a moment falls in: when the last season turned (`seasonBegan`). */
create or replace function season_began(p_at timestamptz default now()) returns timestamptz
language sql stable as $fn$
  select to_timestamp(year_from() + (year_day(p_at) - (season_day_at(p_at) - 1)) * day_seconds())
$fn$;

select private.lock_doors();
