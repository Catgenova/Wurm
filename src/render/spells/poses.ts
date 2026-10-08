/**
 * Casts for the body, one for each way a spell is cast (`CastKind`), and the
 * little that writing one takes: keys through the cast and a smooth way
 * between them.
 *
 * A pose here is written as the body is at full strength through the whole
 * cast, key by key; `castOver` (./index) blends it in at the start and out at
 * the end, and keeps the legs to the walk while the caster is on the move.
 * The keys are put at fractions of the cast's own `release`, so one pose
 * serves a quick blow and a long working alike.
 *
 * The figure's joints (render/figure.ts `Rig`), in degrees: `arm[k]` =
 * [forward, out from the side, turned in], k = 1 the right; `elbow[k]` its
 * bend; `hand[k]` = [pitch, roll, yaw]; `spine`, `chest`, `neck`, `head` =
 * [pitch, roll, yaw] with a positive pitch leaning back and a positive yaw
 * turning the front to the body's left; `leg[k]` = [forward, out, turned];
 * `knee[k]` its bend; `open[k]` an open hand; `wield` the weapon in the right
 * fist carried by the forearm.
 */
import type { Euler, Rig } from '../figure';
import type { CastPose, PoseCue } from './index';
import type { CastKind } from './info';
import { clamp, smooth } from './kit';

/** A key: at `t` (nought to one through the cast), these numbers. */
export type Key = readonly [number, readonly number[]];

/** The numbers at `t` along keys in time order, eased smoothly from each key to the next and held past the ends. */
export function track(t: number, keys: readonly Key[]): number[] {
  if (t <= keys[0][0]) return [...keys[0][1]];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const u = smooth(t1 > t0 ? (t - t0) / (t1 - t0) : 1);
      return v0.map((a, j) => a + (v1[j] - a) * u);
    }
  }
  return [...keys[keys.length - 1][1]];
}

/** Keys as an Euler, for a joint. */
export const euler = (t: number, keys: readonly Key[]): Euler => track(t, keys) as unknown as Euler;
/** One number along keys. */
export const one = (t: number, keys: ReadonlyArray<readonly [number, number]>): number => track(t, keys.map(([a, v]) => [a, [v]] as const))[0];

/**
 * The moments of a cast as fractions of it, from its release: `ready` the
 * start of the wind-up, `top` the top of it, `let` the instant it goes,
 * `through` the follow-through, `back` settled again.
 */
export function beats(c: PoseCue): { top: number; let: number; through: number; back: number } {
  const rel = clamp(c.timing.release, 0.1, 0.9);
  return { top: rel * 0.82, let: rel, through: rel + (1 - rel) * 0.3, back: 1 };
}

/* ---- the stand-ins -------------------------------------------------------------------------- */

/** A blow: the arm up and back over the shoulder, then down and across, the body turning into it and a foot going forward. */
export const strike: CastPose = (r, t, c) => {
  const b = beats(c);
  r.arm[1] = euler(t, [[0, [30, 16, 0]], [b.top, [168, 26, -12]], [b.let, [52, 10, 18]], [b.through, [22, 8, 24]], [1, [16, 8, 10]]]);
  r.elbow[1] = one(t, [[0, 40], [b.top, 78], [b.let, 12], [b.through, 22], [1, 26]]);
  r.arm[0] = euler(t, [[0, [20, 12, 0]], [b.top, [48, 18, 8]], [b.let, [-8, 16, 0]], [1, [6, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [b.top, 48], [b.let, 30], [1, 24]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [6, -4, -20]], [b.let, [-8, 4, 18]], [b.through, [-6, 2, 12]], [1, [0, 0, 4]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [5, 0, -6]], [b.let, [-12, 0, 6]], [1, [-3, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-2, 0, 14]], [b.let, [-8, 0, -10]], [1, [-2, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [2, 3, 0]], [b.let, [24, 3, 0]], [b.through, [20, 3, 0]], [1, [6, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.let, 26], [1, 8]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.let, [-14, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.let, 14], [1, 5]]);
  r.wield = 1;
};

/** A thrust: both hands drawn back by the hip, then driven straight out ahead, the body lunging after them. */
export const thrust: CastPose = (r, t, c) => {
  const b = beats(c);
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [b.top, [-24, 14, 6]], [b.let, [82, 4, 4]], [b.through, [74, 6, 4]], [1, [24, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [b.top, 96], [b.let, 4], [b.through, 10], [1, 30]]);
  r.arm[0] = euler(t, [[0, [30, 10, 0]], [b.top, [14, 8, 20]], [b.let, [78, 2, 18]], [1, [30, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 50], [b.top, 80], [b.let, 22], [1, 46]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [4, 0, -22]], [b.let, [-6, 0, 10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, -4]], [b.let, [-16, 0, 4]], [b.through, [-12, 0, 2]], [1, [-2, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [-6, 3, 0]], [b.let, [34, 4, 0]], [b.through, [30, 4, 0]], [1, [6, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.top, 12], [b.let, 38], [1, 8]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.top, [6, 2, 0]], [b.let, [-22, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.top, 18], [b.let, 10], [1, 5]]);
  r.wield = 1;
};

/** A bow drawn and loosed: the bow arm up and out ahead, the string hand drawn back to the cheek, then flying open as it goes. */
export const shot: CastPose = (r, t, c) => {
  const b = beats(c);
  r.arm[0] = euler(t, [[0, [30, 10, 0]], [b.top * 0.5, [86, 6, -4]], [b.let, [88, 6, -4]], [b.through, [84, 8, -4]], [1, [40, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [b.top * 0.5, 6], [1, 20]]);
  r.arm[1] = euler(t, [[0, [30, 12, 0]], [b.top * 0.5, [84, 8, 10]], [b.top, [84, 38, 6]], [b.let, [84, 40, 6]], [b.through, [66, 56, 0]], [1, [24, 14, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [b.top * 0.5, 60], [b.top, 138], [b.let, 136], [b.through, 70], [1, 34]]);
  r.open[1] = t > b.let;
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top * 0.5, [0, 0, -26]], [b.through, [2, 0, -24]], [1, [0, 0, -6]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top * 0.5, [-2, -4, 24]], [b.through, [0, -4, 22]], [1, [0, 0, 4]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [2, 0, 0]], [b.let, [3, 0, 0]], [1, [0, 0, 0]]]);
};

/** A throw: the hand cocked back over the shoulder, the other arm pointing the way, then the whip of the body and the arm across. */
export const thrown: CastPose = (r, t, c) => {
  const b = beats(c);
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [b.top, [158, 34, -26]], [b.let, [78, 12, 22]], [b.through, [26, 4, 34]], [1, [14, 10, 6]]]);
  r.elbow[1] = one(t, [[0, 34], [b.top, 96], [b.let, 12], [b.through, 26], [1, 24]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [b.top, [84, 10, -6]], [b.let, [30, 22, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [b.top, 10], [b.let, 40], [1, 22]]);
  r.open[0] = t > 0.1 && t < b.let;
  r.open[1] = t > b.let && t < b.through + 0.1;
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [8, -6, -28]], [b.let, [-8, 4, 22]], [b.through, [-10, 2, 26]], [1, [0, 0, 4]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [8, 0, -8]], [b.let, [-14, 0, 8]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [0, 0, 22]], [b.let, [-4, 0, -6]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [16, 3, 0]], [b.let, [26, 3, 0]], [1, [6, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.top, 10], [b.let, 24], [1, 6]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.top, [-8, 2, 0]], [b.let, [-18, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.top, 18], [b.let, 12], [1, 5]]);
};

/** Something sent out of the hand: both hands gathered before the chest as it builds, then the right driven out ahead, open. */
export const bolt: CastPose = (r, t, c) => {
  const b = beats(c);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [b.top * 0.4, [58, -6, 28]], [b.top, [62, -10, 34]],
      ...(k ? [[b.let, [90, 4, 0]], [b.through, [84, 6, 0]], [1, [30, 10, 0]]] as const : [[b.let, [26, 26, 4]], [1, [14, 10, 0]]] as const)]);
    r.elbow[k] = one(t, k ? [[0, 30], [b.top * 0.4, 100], [b.top, 108], [b.let, 4], [b.through, 10], [1, 30]] : [[0, 30], [b.top * 0.4, 100], [b.top, 108], [b.let, 70], [1, 30]]);
    r.open[k] = t > 0.06;
  }
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [0, 0, 0]], [b.let, [-30, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, -10]], [b.let, [-6, 0, 8]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [4, 0, 0]], [b.let, [-10, 0, 0]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-10, 0, 0]], [b.let, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.let, [18, 3, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.let, 18], [1, 6]]);
};

/** On oneself: the arms rising out to the sides and up, the head going back, held, and let down. */
export const buff: CastPose = (r, t, c) => {
  const b = beats(c);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 12, 0]], [b.top * 0.5, [36, 56, 0]], [b.let, [140, 44, -10]], [b.through, [136, 46, -10]], [1, [20, 20, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [b.top * 0.5, 30], [b.let, 14], [1, 20]]);
    r.open[k] = t > 0.1;
  }
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top * 0.5, [-4, 0, 0]], [b.let, [10, 0, 0]], [b.through, [9, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top * 0.5, [-10, 0, 0]], [b.let, [16, 0, 0]], [b.through, [14, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.let, [3, 0, 0]], [1, [0, 0, 0]]]);
  r.knee = [one(t, [[0, 4], [b.top * 0.5, 16], [b.let, 2], [1, 4]]), one(t, [[0, 4], [b.top * 0.5, 16], [b.let, 2], [1, 4]])];
  r.leg = [euler(t, [[0, [2, 2, 0]], [b.top * 0.5, [8, 2, 0]], [b.let, [0, 3, 0]], [1, [2, 2, 0]]]), euler(t, [[0, [2, 2, 0]], [b.top * 0.5, [8, 2, 0]], [b.let, [0, 3, 0]], [1, [2, 2, 0]]])];
};

/** On somebody else: the left hand to the chest, the right held out to them, palm up, and a small bow of the head. */
export const ally: CastPose = (r, t, c) => {
  const b = beats(c);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [b.top * 0.6, [48, -8, 34]], [1, [44, -6, 30]]]);
  r.elbow[0] = one(t, [[0, 20], [b.top * 0.6, 118], [1, 110]]);
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [b.top, [40, 20, -20]], [b.let, [78, 14, -8]], [b.through, [76, 14, -8]], [1, [30, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [b.top, 70], [b.let, 16], [1, 26]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.let, [0, 0, -70]], [1, [0, 0, -40]]]);
  r.open = [t > 0.1, t > 0.1];
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-12, 0, 0]], [b.let, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 4]], [b.let, [-4, 0, -6]], [1, [0, 0, 0]]]);
};

/** Everything round oneself: gathered in, arms crossed and knees giving, then flung out and down as it goes. */
export const nova: CastPose = (r, t, c) => {
  const b = beats(c);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [b.top, [64, -22, 34]], [b.let, [34, 74, -6]], [b.through, [28, 78, -6]], [1, [10, 14, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [b.top, 124], [b.let, 6], [1, 18]]);
    r.open[k] = t > b.let - 0.04;
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [b.top, [24, 8, 0]], [b.let, [10, 12, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [b.top, 44], [b.let, 18], [1, 4]]);
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-16, 0, 0]], [b.let, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-8, 0, 0]], [b.let, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-14, 0, 0]], [b.let, [10, 0, 0]], [1, [0, 0, 0]]]);
};

/** A patch of ground: both arms raised high, then brought down ahead to point at where it falls. */
export const ground: CastPose = (r, t, c) => {
  const b = beats(c);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [b.top, [166, 16, 0]], [b.let, [64, 10, 0]], [b.through, [58, 12, 0]], [1, [14, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [b.top, 22], [b.let, 4], [1, 18]]);
    r.open[k] = t > 0.08;
  }
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [18, 0, 0]], [b.let, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, 0]], [b.let, [-14, 0, 0]], [b.through, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, 0]], [b.let, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.let, [16, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.let, 20], [1, 5]]);
};

/** A command: the right arm drawn back, then flung out to point, the left fist set on the hip. */
export const command: CastPose = (r, t, c) => {
  const b = beats(c);
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [b.top, [40, 30, -10]], [b.let, [96, 2, 0]], [b.through, [92, 4, 0]], [1, [20, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 18], [b.top, 92], [b.let, 0], [1, 20]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [b.top * 0.6, [-12, 42, -10]], [1, [-10, 40, -10]]]);
  r.elbow[0] = one(t, [[0, 18], [b.top * 0.6, 96], [1, 92]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [4, 0, -12]], [b.let, [-6, 0, 6]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, 4]], [b.let, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.let, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.let, [20, 3, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.let, 16], [1, 6]]);
};

/** A prayer: hands together before the chest and the head bowed, then the hands opened upward and the face lifted. */
export const pray: CastPose = (r, t, c) => {
  const b = beats(c);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [b.top * 0.5, [52, -18, 36]], [b.top, [54, -20, 38]], [b.let, [112, 34, 0]], [b.through, [108, 36, 0]], [1, [14, 12, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [b.top * 0.5, 124], [b.top, 126], [b.let, 28], [1, 20]]);
    r.open[k] = true;
  }
  r.head = euler(t, [[0, [0, 0, 0]], [b.top * 0.5, [-18, 0, 0]], [b.top, [-20, 0, 0]], [b.let, [14, 0, 0]], [b.through, [12, 0, 0]], [1, [0, 0, 0]]]);
  r.neck = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 0]], [b.let, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 0]], [b.let, [8, 0, 0]], [1, [0, 0, 0]]]);
};

/** A curse: the right hand pulled back to the ear, clawed, then thrust at the creature; the body hunched over it. */
export const curse: CastPose = (r, t, c) => {
  const b = beats(c);
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [b.top, [118, 34, -34]], [b.let, [84, 10, -10]], [b.through, [80, 12, -10]], [1, [20, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 18], [b.top, 126], [b.let, 22], [b.through, 28], [1, 22]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.let, [-40, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > 0.1;
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [b.top, [46, -10, 30]], [b.let, [30, 20, 10]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 18], [b.top, 110], [b.let, 70], [1, 20]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-4, 0, -6]], [b.let, [-14, 0, 6]], [1, [-2, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-4, 0, -14]], [b.let, [-6, 0, 10]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-10, 0, 8]], [b.let, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.let, [20, 3, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.let, 22], [1, 6]]);
};

/** The stand-in pose for each way of casting. */
export const POSE_OF: Record<CastKind, CastPose> = {
  strike, thrust, shot, throw: thrown, bolt, curse, buff, ally, nova, ground, command, pray,
};

/** How long each way of casting takes, and when it lets go: what the stand-ins are timed by. */
export const TIMING_OF: Record<CastKind, { secs: number; release: number }> = {
  strike: { secs: 0.75, release: 0.42 },
  thrust: { secs: 0.7, release: 0.45 },
  shot: { secs: 1.1, release: 0.62 },
  throw: { secs: 0.8, release: 0.48 },
  bolt: { secs: 1.0, release: 0.55 },
  curse: { secs: 1.0, release: 0.5 },
  buff: { secs: 1.2, release: 0.55 },
  ally: { secs: 1.1, release: 0.55 },
  nova: { secs: 1.1, release: 0.5 },
  ground: { secs: 1.4, release: 0.55 },
  command: { secs: 0.8, release: 0.45 },
  pray: { secs: 1.5, release: 0.55 },
};

/** For a pose of one's own: start from a stand-in and change only what differs. */
export const withPose = (base: CastPose, more: (r: Rig, t: number, c: PoseCue) => void): CastPose => (r, t, c) => {
  base(r, t, c);
  more(r, t, c);
};
