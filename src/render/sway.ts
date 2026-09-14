/**
 * What the wind does to things that are rooted.
 *
 * The island has had a wind since sails went in: it has a direction, a
 * strength, and it wanders on its own clock. Until now nothing on land ever
 * noticed it. A tree standing dead still in a gale is one of those things you
 * do not consciously see and cannot unsee afterwards.
 *
 * The lean is a function of where a thing stands and what time it is, so
 * nothing has to be stored and no two trees on the island are ever in step.
 * Two waves for the sway itself, and a third much slower one for the gusting,
 * which is what stops a wood looking like a metronome.
 */

/** How far the top of a tree leans at full strength, as a share of its height. */
export const SWAY_MAX = 0.13;

/**
 * Which way and how far a thing at this spot is leaning, -1 to 1 before the
 * wind's strength is counted.
 */
export function swayAt(x: number, y: number, t: number, force: number): number {
  const seed = x * 0.73 + y * 1.13;
  const gust = 0.5 + 0.5 * Math.sin(t * 0.29 + seed * 0.17);
  const wave = 0.62 * Math.sin(t * 1.6 + seed) + 0.38 * Math.sin(t * 2.7 + seed * 1.7);
  // Even a calm has a breath in it; a blow is mostly the gusting.
  return wave * (0.25 + 0.75 * gust) * Math.max(0.12, force);
}
