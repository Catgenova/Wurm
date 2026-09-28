/**
 * Crops through the year: how fast a field grows in each season, how fast a
 * planter grows in all of them, and the field clock that turns the one into
 * growing seconds the same way on both sides of the wire.
 *
 * Asked for: "Implement outdoor seasonal growths for crops, with planters that
 * can be grown indoors regardless of season at a much slower rate."
 *
 * A crop in a field grows at a share of its own pace that its season sets, and
 * in winter not at all: it keeps its stage and waits for spring. A planter
 * grows at one share in every season, wherever it stands. Everything else a
 * crop's pace was already made of -- the pace stamped at sowing, the
 * gardener's path -- stays a multiplier on the length of a stage.
 *
 * ## The field clock
 *
 * What a field has grown is the integral of its rate over the wall clock, and
 * a stage that begins late in autumn ends in spring. So growth is counted on a
 * clock of its own, `fieldClock`: growing seconds up to a moment, rate 1
 * before the first spring and then the seasons' rates round the year. It is
 * piecewise linear and worked out in closed form from the moment alone, so
 * the island (`field_clock`) and this browser work it out alike, operation for
 * operation, and `supabase/test/seasons.ts` holds the two to each other bit
 * for bit. `fieldMoment` goes back: the earliest moment the clock reads so
 * much, so a stage that came due as a winter began is dated at the end of the
 * autumn rather than somewhere in the flat.
 *
 * A crop's stage start is kept on the clock it grows on and a stage is due
 * when that clock has run its stage's length past it: added on, never
 * restarted from now. A planter's clock is the plain one at `PLANTER_GROWTH`.
 *
 * Data in, numbers out; nothing here reads the time for itself.
 */
import { SEASONS, SEASON_DAYS, YEAR_FROM, seasonAt, type Season } from '../world/calendar';
import { DAY_SECONDS } from './pace';

/** A field's growth in spring, as a share of the crop's own pace. */
export const SPRING_GROWTH = 1;
/** A field's growth in summer, as a share of the crop's own pace. */
export const SUMMER_GROWTH = 1.5;
/** A field's growth in autumn, as a share of the crop's own pace. */
export const AUTUMN_GROWTH = 0.5;
/** A field's growth in winter, as a share of the crop's own pace: none, so a crop in a field keeps its stage until spring. */
export const WINTER_GROWTH = 0;
/** A field's growth before the first spring, when there were no seasons: the whole of its pace, so nothing then growing changed. */
export const YEARLESS_GROWTH = 1;
/** A planter's growth, in every season and wherever it stands, as a share of the crop's own pace. */
export const PLANTER_GROWTH = 0.25;

/** Each season's growth in a field. */
export const SEASON_GROWTH: Record<Season, number> = {
  spring: SPRING_GROWTH, summer: SUMMER_GROWTH, autumn: AUTUMN_GROWTH, winter: WINTER_GROWTH,
};

/** Seconds in a season: its days, each one of the island's days and nights. */
export const SEASON_SECONDS = SEASON_DAYS * DAY_SECONDS;
/** Seconds in a year. */
export const YEAR_SECONDS = SEASONS.length * SEASON_SECONDS;
/** The growing seconds a field has in a whole year, added up season by season in the order they come. */
export const YEAR_GROWTH = SEASONS.reduce((g, s) => g + SEASON_GROWTH[s] * SEASON_SECONDS, 0);

/** How fast a field grows at a moment (epoch seconds), as a share of a crop's own pace. */
export function fieldRate(t: number): number {
  return t < YEAR_FROM ? YEARLESS_GROWTH : SEASON_GROWTH[seasonAt(t).season];
}

/**
 * The field clock: the growing seconds a field has had up to a moment, in
 * epoch seconds. It reads the wall clock itself up to the first spring and
 * then runs at each season's rate, standing still through a winter.
 *
 * Every step is a double's step in the order the island's `field_clock` takes
 * them, which is what makes the two agree to the last bit.
 */
export function fieldClock(t: number): number {
  if (t < YEAR_FROM) return YEAR_FROM + (t - YEAR_FROM) * YEARLESS_GROWTH;
  const d = t - YEAR_FROM;
  const k = Math.floor(d / YEAR_SECONDS);
  const w = d - k * YEAR_SECONDS;
  let g = YEAR_FROM + k * YEAR_GROWTH;
  for (let i = 0; i < SEASONS.length; i++) {
    g = g + SEASON_GROWTH[SEASONS[i]] * Math.min(Math.max(w - i * SEASON_SECONDS, 0), SEASON_SECONDS);
  }
  return g;
}

/**
 * And back: the earliest moment the field clock reads `g`. A reading a winter
 * holds the clock at is reached at the end of the autumn before it.
 */
export function fieldMoment(g: number): number {
  if (g <= YEAR_FROM) return YEAR_FROM + (g - YEAR_FROM) / YEARLESS_GROWTH;
  const e = g - YEAR_FROM;
  let k = Math.floor(e / YEAR_GROWTH);
  let rem = e - k * YEAR_GROWTH;
  // A whole number of years is reached at the end of the last of them that grew, not at the start of the next.
  if (rem <= 0) {
    k = k - 1;
    rem = rem + YEAR_GROWTH;
  }
  const t0 = YEAR_FROM + k * YEAR_SECONDS;
  for (let i = 0; i < SEASONS.length; i++) {
    const r = SEASON_GROWTH[SEASONS[i]];
    if (r <= 0) continue;
    const most = r * SEASON_SECONDS;
    if (rem <= most) return t0 + i * SEASON_SECONDS + rem / r;
    rem = rem - most;
  }
  return t0 + YEAR_SECONDS;
}

/** The season turns after a moment, the next `n` of them: the first spring's dawn is the first there ever was. */
export function turnsAfter(t: number, n: number): number[] {
  const first = t < YEAR_FROM ? YEAR_FROM : YEAR_FROM + (Math.floor((t - YEAR_FROM) / SEASON_SECONDS) + 1) * SEASON_SECONDS;
  return Array.from({ length: n }, (_, i) => first + i * SEASON_SECONDS);
}

/** The first moment from `t` on at which a field grows: `t` itself when one is growing then, Infinity if one never will. */
export function fieldWakes(t: number): number {
  if (fieldRate(t) > 0) return t;
  return turnsAfter(t, SEASONS.length).find((s) => fieldRate(s) > 0) ?? Infinity;
}

/** The first moment after `t` at which a field stops growing, or Infinity if it never does. */
export function fieldStops(t: number): number {
  return turnsAfter(t, SEASONS.length + 1).find((s) => fieldRate(s) <= 0) ?? Infinity;
}
