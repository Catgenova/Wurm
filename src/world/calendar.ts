/**
 * The island's year: four seasons of a week each.
 *
 * Asked for along with wildflowers that come up in spring and summer, trees
 * that blossom for a week in spring and lilies that flower in their season.
 * There was no year before this: the days went round and nothing else did.
 *
 * A day of the year is a day of the woods, turning at the same hour
 * (`TREE_DAWN_UTC`), and a season is `SEASON_DAYS` of them, so a year is four
 * weeks of the wall clock: long enough to wait for, short enough to see come
 * round. It is worked out from the wall clock alone, the same on every page
 * and on the island (`season_at`), and nothing about it is kept.
 */
import { TREE_DAWN_UTC } from './tiles';

/** The seasons, in the order they come round. */
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];
/** Days in a season. */
export const SEASON_DAYS = 7;
/** Days in a year. */
export const YEAR_DAYS = SEASONS.length * SEASON_DAYS;
/** The first dawn of the first spring, in epoch seconds: 13:00 UTC on 28 September 2026. */
export const YEAR_FROM = Date.UTC(2026, 8, 28, TREE_DAWN_UTC) / 1000;

const DAY = 24 * 60 * 60;

/** The season at `now` (epoch seconds), and which day of it, from 1 to `SEASON_DAYS`. */
export function seasonAt(now: number): { season: Season; day: number } {
  const days = Math.floor((now - YEAR_FROM) / DAY);
  const inYear = ((days % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  return { season: SEASONS[Math.floor(inYear / SEASON_DAYS)], day: (inYear % SEASON_DAYS) + 1 };
}

/**
 * Which year a moment falls in: nought for the first, counted from the first
 * dawn of the first spring and below nought before it. A year begins with a
 * spring, so a new one is what a picked tile of flowers waits for. The
 * island's `year_of` is the same count.
 */
export function yearOf(now: number): number {
  return Math.floor(Math.floor((now - YEAR_FROM) / DAY) / YEAR_DAYS);
}

/** The season as the hud says it: "Spring, day 3 of 7". */
export function seasonLine(now: number): string {
  const { season, day } = seasonAt(now);
  return `${season[0].toUpperCase()}${season.slice(1)}, day ${day} of ${SEASON_DAYS}`;
}
