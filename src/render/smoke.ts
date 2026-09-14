/**
 * Smoke.
 *
 * Anything burning on the island now says so from a distance. A puff is not
 * an object anywhere — it is worked out from the clock, so a fire that has
 * been alight for an hour costs exactly what one lit a second ago costs, and
 * none of it is saved.
 *
 * Each source carries a handful of puffs at even spacings through their life.
 * A puff climbs, spreads, goes from dark to pale as it thins, and drifts down
 * the wind by more the higher it gets — which is what makes a plume lean over
 * in a blow instead of standing straight up.
 */

/** How many puffs one fire has in the air at once. */
export const PUFFS = 12;

/** Seconds from leaving the fire to gone. */
export const PUFF_LIFE = 3.1;

/** How far a puff climbs over its life, in screen pixels at 1x zoom. */
export const PUFF_RISE = 96;

/** How far the wind carries the top of a plume, in tiles, at full strength. */
export const PUFF_DRIFT = 2.4;

export interface Puff {
  /** 0 at the fire, 1 at the last of it. */
  age: number;
  /** Radius in screen pixels at 1x zoom. */
  radius: number;
  alpha: number;
}

/** Where the nth puff of a fire is in its life right now. */
export function puffAge(i: number, t: number, seed: number): number {
  const phase = t / PUFF_LIFE + i / PUFFS + seed;
  return phase - Math.floor(phase);
}

/** What that puff looks like: bigger and fainter the older it is. */
export function puffOf(age: number, heat: number): Puff {
  // It leaves the fire small and tight, opens out quickly, then thins away.
  const radius = (5 + age * 40) * (0.6 + heat * 0.6);
  const alpha = 0.85 * heat * Math.min(1, age * 6) * (1 - age) * (1 - age);
  return { age, radius, alpha };
}
