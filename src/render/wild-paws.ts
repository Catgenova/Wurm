import { beat, cyc, TAU, type Anim, type QuadPose, type QuadSpec } from './beasts';

/**
 * What the kinds on four paws in `./wild-wild` and `./wild-brook` are built
 * from: a body on four paws from a few numbers, and a trot.
 */

/** A body on four paws: `len` shoulder to hip, `legs` long, the neck `neck` long and carried at `lean`. */
export const pawed = (o: { high: number; len: number; legs: number; neck: number; lean: number; swing?: [number, number]; ears?: [number, number]; tail?: [number, number, number] }): QuadSpec => ({
  high: o.high,
  fore: { at: [0.6, o.len * 0.45, -0.4], len: [o.legs * 0.52, o.legs * 0.46, 0.14], rest: [2, -4, 0], fold: [55, 85], toe: [0.32, 0.12] },
  hind: { at: [0.62, -o.len * 0.45, -0.3], len: [o.legs * 0.56, o.legs * 0.56, 0.14], rest: [22, -44, 0], fold: [40, 65], toe: [0.32, 0.12] },
  neck: { at: [0, o.len * 0.52, 0.25], len: o.neck, lean: o.lean },
  head: { pitch: -4 },
  tail: { at: [0, -o.len * 0.6, 0.3], links: 3, len: o.tail?.[0] ?? 0.45, lift: o.tail?.[1] ?? 10, curl: o.tail?.[2] ?? -6, sway: 12 },
  ears: { at: [0.5, -0.1, 0.55], out: o.ears?.[0] ?? 14, back: o.ears?.[1] ?? 6 },
  swing: o.swing ?? [24, 42],
  graze: 30,
  nose: 14,
  bow: 16,
  rock: 7,
});

/** A trot: the body rolling a little over its feet and the tail going; standing, looking about and a flick of an ear. */
export function trot(p: QuadPose, a: Anim): void {
  const w = a.u - Math.floor(a.u);
  if (a.go > 0) {
    p.roll += a.go * 3 * Math.sin(w * TAU);
    p.tail[1] += a.go * 16 * Math.sin(w * TAU + 1.2);
    p.squash += a.go * 0.04 * Math.max(0, Math.cos(w * TAU * 2));
    return;
  }
  p.ears[0][0] += 22 * beat(a.t, [4.1, 15.3], 0.4);
  p.ears[1][0] += 22 * beat(a.t, [9.7, 20.2], 0.4);
  p.tail[1] += 14 * cyc(a.t, 6);
}
