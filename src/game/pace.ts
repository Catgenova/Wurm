/**
 * How long everything takes, in one number.
 *
 * This is data with no imports, so anything may read it — the browser's clock,
 * the definition dump that hands it to Postgres, the suite that checks it —
 * without anything importing anything back.
 *
 * ## Mining is the yardstick
 *
 * Every `baseTime` in the action and recipe tables is a *weight*, not a number
 * of seconds: felling a tree is worth more than picking a berry, and the
 * tables say by how much. What they never said is what one unit is worth, and
 * the answer used to be a second — which made a full go at solid rock take
 * eight of them, and most of the game a handful.
 *
 * A unit is worth `ACTION_PACE` seconds now, chosen so that a beginner with a
 * plain pickaxe spends **thirty seconds** on a face of rock. Everything else
 * keeps exactly the ratio to that it always had: nothing was re-weighted, the
 * unit was re-priced. Change `MINING_SECONDS` and the whole game moves with
 * it, in one edit, on both sides of the wire.
 *
 * ## Both sides, one number
 *
 * The browser multiplies by `ACTION_PACE` in `Game.duration`; Postgres does it
 * in `act_duration`, which reads `action_pace()` — a function generated from
 * this file by `scripts/dump-defs.ts`, like every other constant down there.
 * There is no second place to forget.
 */

/** What a full go at a face of rock costs somebody who has never done it. */
export const MINING_SECONDS = 30;

/**
 * Mining's weight in `ACTIONS`, which is the whole of what makes it the
 * yardstick. The suite checks these two have not drifted apart: change the
 * weight without changing this and every timer in the game would quietly
 * re-price itself around a mining job that is no longer thirty seconds.
 */
export const MINING_WEIGHT = 8;

/** Seconds to the unit. */
export const ACTION_PACE = MINING_SECONDS / MINING_WEIGHT;

/**
 * And the shortest a go at anything can be.
 *
 * It was 1.2 seconds against a one-second unit, so it is 1.2 units still — a
 * floor that did not move with everything else would turn every quick job into
 * the same quick job.
 */
export const ACTION_FLOOR = 1.2 * ACTION_PACE;

/**
 * What a worker takes over a task: twice what a player of middling skill
 * would, off a weight of its own because a wildermon has no tool to speak of.
 */
export const WORKER_WEIGHT = 5;
