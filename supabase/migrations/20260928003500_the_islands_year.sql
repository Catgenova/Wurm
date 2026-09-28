/*
 * The island's year: four seasons of seven days, turning with the woods.
 *
 * The same year as the browser's `seasonAt` (src/world/calendar.ts): a day of
 * it is a real day, turning at the hour the woods do (`tree_dawn_utc()`), a
 * season is seven of them, and the first dawn of the first spring was on
 * 28 September 2026. Nothing is kept; it is read off the clock.
 * `supabase/test/year.ts` holds the two to each other.
 */

/** Days since the first dawn of the first spring, counted at the woods' hour; below nought before it. */
create or replace function year_day(p_at timestamptz default now())
returns int language sql stable as $fn$
  select floor(extract(epoch from p_at - (timestamptz '2026-09-28 00:00:00+00' + tree_dawn_utc() * interval '1 hour')) / 86400)::int
$fn$;

/** The season at a moment: spring, summer, autumn or winter. */
create or replace function season_at(p_at timestamptz default now())
returns text language sql stable as $fn$
  select (array['spring', 'summer', 'autumn', 'winter'])[1 + mod(mod(year_day(p_at), 28) + 28, 28) / 7]
$fn$;

/** Which day of its season a moment falls on, from 1 to 7. */
create or replace function season_day_at(p_at timestamptz default now())
returns int language sql stable as $fn$
  select 1 + mod(mod(mod(year_day(p_at), 28) + 28, 28), 7)
$fn$;

select private.lock_doors();
