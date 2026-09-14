/**
 * Weather, so far as a sail is concerned.
 *
 * The wind on this island has a direction and a strength, both of which move
 * slowly and neither of which anybody controls. It is worked out from the
 * clock and the seed rather than stored, so it is the same wind for anyone
 * who was here at that hour and there is nothing to save.
 *
 * A hull under oars ignores all of it. A hull under sail lives on it: how
 * fast she goes is the strength of the wind and, far more, the **angle**
 * between where the wind is coming from and where you are pointing. Across
 * the wind is fastest; downwind is comfortable and slower; hard up into it
 * she stops. Which is why nobody sails straight at where they are going.
 */

export interface Wind {
  /** Where it is blowing towards, in radians, x to the east and y to the south. */
  dir: number;
  /** How hard, 0..1. */
  force: number;
}

/** The eight points, for saying where it is coming from. */
const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** How long the wind takes to box the compass, and how long a squall lasts. */
const TURN_PERIOD = 40 * 60;
const GUST_PERIOD = 7 * 60;

/** The wind at this hour on this island. */
export function windAt(seed: number, time: number): Wind {
  const s = (seed % 1000) / 1000;
  // Two slow turns laid over each other, so it wanders rather than sweeps.
  const dir =
    (s * Math.PI * 2 +
      Math.sin(time / TURN_PERIOD + s * 7) * 2.2 +
      Math.sin(time / (TURN_PERIOD * 0.37) + s * 3) * 0.8) %
    (Math.PI * 2);
  // Strength wanders on its own clock: flat calms and hard blows both happen.
  const raw =
    0.5 +
    0.34 * Math.sin(time / (GUST_PERIOD * 3.1) + s * 11) +
    0.18 * Math.sin(time / GUST_PERIOD + s * 5) +
    0.1 * Math.sin(time / (GUST_PERIOD * 0.41) + s * 2);
  return { dir: (dir + Math.PI * 2) % (Math.PI * 2), force: Math.max(0, Math.min(1, raw)) };
}

/** Where it is blowing from, which is how a sailor says it. */
export function windFrom(w: Wind): string {
  const from = (w.dir + Math.PI) % (Math.PI * 2);
  return POINTS[Math.round(from / (Math.PI / 4)) % 8];
}

/** What that much wind is called. */
export function windWord(force: number): string {
  if (force < 0.12) return 'flat calm';
  if (force < 0.3) return 'light air';
  if (force < 0.5) return 'a steady breeze';
  if (force < 0.72) return 'a fresh wind';
  if (force < 0.9) return 'a hard blow';
  return 'a gale';
}

/** Half the width of the no-go zone: you cannot sail this close to the wind. */
export const NO_GO = Math.PI / 5;
/** Where close-hauled gives way to a reach, and a reach to a run. */
const CLOSE = (70 * Math.PI) / 180;
const RUN = (150 * Math.PI) / 180;

/**
 * The angle off the wind's eye: zero is pointed straight into it, pi is dead
 * before it. Both terms come in unwrapped, so they are folded to one turn
 * first — a remainder in this language keeps the sign of what it came from,
 * which is how a beam reach once came out as sailing backwards.
 */
export function offWind(heading: number, w: Wind): number {
  const wrapped = (((heading - w.dir) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return Math.PI - Math.abs(wrapped);
}

/**
 * What a hull makes of the wind she is pointed into, 0..~1.2.
 *
 * The angle is between where you are heading and where the wind is going.
 * Zero is dead downwind, pi is straight into it. A beam reach — the wind on
 * the side — is the fastest point of sail there is; hard on the wind is slow;
 * inside the no-go zone she is in irons and barely moves at all.
 */
export function pointOfSail(heading: number, w: Wind): number {
  const upwind = offWind(heading, w);
  if (Number.isNaN(upwind)) return 0.85;
  // In irons: the sail shakes and she will not go.
  if (upwind < NO_GO) return 0.12 + (upwind / NO_GO) * 0.18;
  // Close-hauled: hard work, and the only way to get anywhere upwind.
  if (upwind < CLOSE) return 0.55 + ((upwind - NO_GO) / (CLOSE - NO_GO)) * 0.3;
  // A reach: everything a hull has, best a little abaft the beam.
  if (upwind < RUN) return 0.85 + Math.sin(((upwind - CLOSE) / (RUN - CLOSE)) * Math.PI) * 0.35;
  // Running before it: steady, and not the quickest.
  return 0.9;
}

/** The whole of what the weather is worth to a sail, this heading, this hour. */
export function sailFactor(heading: number, w: Wind): number {
  // Even a flat calm leaves steerage way; a gale is worth half again.
  return (0.35 + w.force * 1.1) * pointOfSail(heading, w);
}

/**
 * Which side the wind is on and how full the sail is: negative to port,
 * positive to starboard, and near nothing when she is pointed into it.
 */
export function sailTrim(heading: number, w: Wind): number {
  const wrapped = (((heading - w.dir) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  if (offWind(heading, w) < NO_GO) return 0.1;
  return (wrapped < 0 ? -1 : 1) * Math.max(0.3, Math.min(1, Math.abs(wrapped) / (Math.PI / 2)));
}

/** How the point of sail reads on the hud. */
export function sailWord(heading: number, w: Wind): string {
  const upwind = offWind(heading, w);
  if (upwind < NO_GO) return 'in irons';
  if (upwind < CLOSE) return 'close-hauled';
  if (upwind < RUN) return 'reaching';
  return 'running';
}
