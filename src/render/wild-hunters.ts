import {
  add, coatPalette, cross, curve, cyc, DEG, disc, dot, eyes, lighter, merge, moved, onEgg, orb, orbAlong, paint, quadBonesOf, scale, sub, taper, TAU, tube, unit,
  type Disc, type Kind, type Piece, type QuadSpec,
} from './beasts';
import { mesh, place, type Mat, type Mesh, type V3 } from './figure';
import { cut, legPieces, pawMesh, under } from './beastkit';

/** The hunters: the ulva. */

/* ---- the ulva ----------------------------------------------------------------------- */

/**
 * An ulva: grey, lean and long in the leg, and the first thing on the island
 * that will come at you unasked. A ruff of frost stands round its neck, each
 * tuft of it ending in ice; a crescent moon is on its brow; its eyes are
 * amber, and its plume of a tail ends in frost.
 */
const ULVA_SPEC: QuadSpec = {
  high: 2.4,
  fore: { at: [0.5, 1.45, -0.45], len: [0.9, 0.85, 0.2], rest: [2, -4, 0], fold: [55, 85], toe: [0.35, 0.12] },
  hind: { at: [0.52, -1.4, -0.3], len: [0.95, 1.02, 0.2], rest: [24, -48, 0], fold: [35, 60], toe: [0.35, 0.12] },
  neck: { at: [0, 1.75, 0.35], len: 1.1, lean: 48 },
  head: { pitch: -4 },
  // The plume carried low and curling up toward its end: carried high, seen from ahead it stood up over the head like a hood.
  tail: { at: [0, -1.95, 0.35], links: 3, len: 0.55, lift: 6, curl: 22, sway: 10 },
  ears: { at: [0.51, -0.12, 0.67], out: 12, back: 8 },
  swing: [24, 44],
  graze: 62,
  nose: 2,
  bow: 24,
  rock: 7,
};

/** The ruff's tufts: how many, the way each points round the neck (the first straight ahead), and where each grows from. */
const RUFF_TUFTS = 7;
const tuftAt = (q: number): number => Math.PI / 2 + (q / RUFF_TUFTS) * TAU;
const tuftRoot = (q: number): V3 => [Math.cos(tuftAt(q)) * 0.46, Math.sin(tuftAt(q)) * 0.46, 0.05];
/** How much further round the neck is grazing than standing, from leaning forward to hanging down, in degrees. */
const RUFF_BOW = 108;
/** How far the tufts behind the neck are laid down along the back while grazing, in degrees. */
const RUFF_FLAT = 40;

/**
 * The ruff grazing. Turned with the neck as it goes down to the grass, what
 * grew behind the neck would stand straight up over the ears; so the ruff is
 * turned back by as far as the neck went round, and stays on the shoulders as
 * it was standing, with the tufts behind the neck laid down along the back.
 */
function ruffLaid(v: readonly V3[], graze: number): V3[] {
  if (graze <= 0) return [...v];
  const per = v.length / RUFF_TUFTS;
  const c0 = Math.cos(RUFF_BOW * graze * DEG), s0 = Math.sin(RUFF_BOW * graze * DEG);
  return v.map((p, i) => {
    const q = Math.floor(i / per), a = tuftAt(q);
    const f = RUFF_FLAT * Math.max(0, -Math.sin(a)) * graze * DEG;
    // Laid down: turned about the line round the neck through its root, which takes a tuft pointing out from the neck toward
    // the shoulders.
    const R = tuftRoot(q), t: V3 = [-Math.sin(a), Math.cos(a), 0], w = sub(p, R);
    const c = Math.cos(f), s = Math.sin(f), k = dot(t, w) * (1 - c), tw = cross(t, w);
    const l: V3 = [R[0] + w[0] * c + tw[0] * s + t[0] * k, R[1] + w[1] * c + tw[1] * s + t[1] * k, R[2] + w[2] * c + tw[2] * s + t[2] * k];
    // And the whole turned back against the neck's bow, about the neck's root.
    return [l[0], l[1] * c0 - l[2] * s0, l[1] * s0 + l[2] * c0];
  });
}

/** The skull's egg as it is built, before the head is drawn a size bigger. */
const SKULL = { c: [0, 0.15, 0.2] as V3, r: [0.78, 0.82, 0.68] as V3 };
/** How much bigger the head is drawn than it is built: a head a size too big for it, the way a pup's is. */
const ULVA_HEAD_K = 1.22;
const ULVA_HEAD = { c: scale(SKULL.c, ULVA_HEAD_K), r: scale(SKULL.r, ULVA_HEAD_K) };

/** A mesh made `k` times bigger about its own origin. */
const grown = (m: Mesh, k: number): Mesh => mesh(m.v.map((p) => scale(p, k)), m.f);

/** The way out of the skull's middle to the middle of the moon on its brow. */
const MOON_DIR: V3 = [0, 0.6, 0.8];
/** The moon: its radius, and the bite out of it, the bite's radius and how far aside of the middle it is. */
const MOON = { r: 0.4, bite: 0.36, off: 0.14 };

/**
 * A crescent moon painted on an egg of a head, where the way out of its middle
 * `dir` meets the shell: a disc `R` across with a bite `bite` across taken out
 * of one side of it, `off` aside, so it is `R + off - bite` thick at its
 * thickest and its horns point toward the bite. Every corner is laid on the
 * shell, so a moon as wide as the brow bends round it rather than standing
 * off it.
 */
function crescent(c: V3, r: V3, dir: V3, R: number, bite: number, off: number, m: Mat): Disc {
  const { p, n } = onEgg(c, r, dir);
  const u = unit(cross([0, 0, 1], n)), up = cross(n, u);
  // Where the two rims cross, which are the tips of the horns; and the whole moved over so its middle is on `dir`.
  const x = (R * R - bite * bite + off * off) / (2 * off), y = Math.sqrt(R * R - x * x);
  const a0 = Math.atan2(y, x), b0 = Math.atan2(y, x - off), mid = (x - R) / 2;
  const K = 12;
  const rim = Array.from({ length: K + 1 }, (_, q): [number, number] => {
    const a = a0 + ((TAU - 2 * a0) * q) / K;
    return [Math.cos(a) * R - mid, Math.sin(a) * R];
  });
  const inside = Array.from({ length: K - 1 }, (_, q): [number, number] => {
    const b = TAU - b0 - ((TAU - 2 * b0) * (q + 1)) / K;
    return [off + Math.cos(b) * bite - mid, Math.sin(b) * bite];
  });
  const v = [...rim, ...inside].map(([s, t]): V3 => {
    const e = onEgg(c, r, sub(add(p, add(scale(u, s), scale(up, t))), c));
    return add(e.p, scale(e.n, 0.03));
  });
  return { v, m, lit: true };
}

function ulvaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  // A deep chest and a tucked waist, pale beneath.
  const ys = [-2.15, -1.85, -1.2, -0.3, 0.6, 1.4, 1.95, 2.2];
  const body = tube(ys.map((y, q) => [0, y, [0.1, 0.12, 0.1, 0.02, 0.0, 0.05, 0.12, 0.2][q]] as V3),
    [0.2, 0.62, 0.74, 0.66, 0.8, 0.92, 0.72, 0.2], [0.2, 0.6, 0.66, 0.56, 0.72, 0.8, 0.66, 0.25], n,
    (ring, j) => (ring > 0 && under(n, j, 0.9) ? 'mark' : 'coat'));
  // The ruff: a collar of tufts all round the base of the neck, lying out over the shoulders and the chest, each ending in ice.
  // Few and fat, so it reads as fur with frost on it and not as spikes, and none of it comes up over the face. One tuft points
  // straight ahead down the chest and none straight back, so it is the same on both sides; the ice is a colder, darker blue than
  // the pale fur it grows from, and reaches out past the shoulders, so the points of it show at play size.
  const ruff = merge(...Array.from({ length: RUFF_TUFTS }, (_, q) => {
    const a = tuftAt(q);
    const tip: V3 = [Math.cos(a) * 1.15, Math.sin(a) * 1.15, -0.32];
    return taper(curve(tuftRoot(q), [Math.cos(a) * 0.86, Math.sin(a) * 0.86, 0.06], tip, 4), 0.3, 0.03, 6, (ring) => (ring >= 2 ? 'crystalDark' : 'mark'));
  }));
  // The head, built at the size it was and drawn a size bigger.
  const skull = merge(
    orb(SKULL.c, SKULL.r, n + 1, k + 1, 'coat'),
    // Round cheeks, pale.
    orb([0.42, 0.45, -0.12], [0.36, 0.34, 0.3], n, k, 'mark'), orb([-0.42, 0.45, -0.12], [0.36, 0.34, 0.3], n, k, 'mark'),
  );
  const snout = merge(
    taper([[0, 0.55, -0.08], [0, 1.0, -0.14], [0, 1.4, -0.2]], 0.36, 0.2, n, 'muzzle', 0.85),
    orbAlong([0, 1.45, -0.14], [0, 1, 0.2], [0.17, 0.12, 0.13], 6, 3, 'nose'),
  );
  // The crescent on its brow, as wide as the brow between the eyes and thick enough to be a moon rather than a line at play size.
  const moon = paint([crescent(SKULL.c, SKULL.r, MOON_DIR, MOON.r, MOON.bite, MOON.off, 'crystal')]);
  // Its eyes set back along the head, so side on there is a whole eye and then the muzzle in front of it.
  const look = (shut: boolean): Mesh => eyes(SKULL.c, SKULL.r, [0.7, 0.6, 0.28], 0.26 / ULVA_HEAD_K, { tall: 1.05, shut, iris: 'bloom', pupil: 0.55, rim: 0.05 });
  // An ear, cupped a little and turned out, so side on it shows its face rather than its edge.
  const ear = grown(merge(
    taper(curve([0, 0, 0], [0, 0.02, 0.4], [0, -0.05, 0.85], 3), 0.36, 0.02, n, 'coat', 0.4, [0, 1, 0]),
    paint([disc([0, 0.13, 0.32], [0, 1, 0.1], 0.19, 0.26, 6, 'inner')]),
  ), 1.12);
  // The plume of a tail: one tube through its three links, fullest a little way along and ending in the ruff's ice.
  const tail = (q: number): Mesh => {
    const rs = [[0.24, 0.36], [0.38, 0.44], [0.42, 0.12]][q];
    const w = [0, 1, 2].map((i) => rs[0] + ((rs[1] - rs[0]) * i) / 2);
    return tube([[0, 0.05, 0], [0, -0.3, 0], [0, -0.62, 0]], w, w, n, q === 2 ? ((ring) => (ring >= 1 ? 'crystalDark' : 'coat')) : 'coat', { seam: q === 1 ? 'both' : 'start' });
  };
  const H = ULVA_HEAD;
  const hide = [{ c: H.c, r: H.r }];
  const head = (shut: boolean): Mesh => grown(merge(skull, snout, moon, look(shut)), ULVA_HEAD_K);
  const pieces: Piece[] = [
    { key: 'body', mesh: body, bone: 'body', bias: 0, breathes: { c: [0, 0.8, 0], k: 0.04 } },
    ...[0, 1, 2].map((q): Piece => ({ key: `tail${q}`, mesh: tail(q), bone: `tail${q}`, bias: -0.05 + q * 0.01, chain: 'tail' })),
    { key: 'neck', mesh: tube([[0, 0, -0.35], [0, 0, 0.5], [0, 0.05, 1.15]], [0.56, 0.5, 0.46], [0.54, 0.5, 0.46], n, 'coat'), bone: 'neck', bias: 0, under: 'head', convex: true },
    { key: 'ruff', mesh: ruff, bone: 'neck', bias: 0.1, after: ['neck', 'body'], bent: (v, a) => ruffLaid(v, a.graze) },
    { key: 'head', mesh: head(false), shut: head(true), bone: 'head', bias: 0.2 },
    { key: 'ear0', mesh: moved(ear, [0, 0, 0], 35), bone: 'ear0', bias: 0.21, after: 'head', hide, hideIn: 'head' },
    { key: 'ear1', mesh: moved(ear, [0, 0, 0], -35), bone: 'ear1', bias: 0.21, after: 'head', hide, hideIn: 'head' },
  ];
  const paw = pawMesh(0.22, n, k, 'mark', 0.2);
  for (const [key, side] of [['fl', -1], ['fr', 1]] as Array<[string, number]>) {
    pieces.push(...legPieces(key, true, side, [[0, 0, 0.3], [0, 0, -0.9]], [0.32, 0.22], [[0, 0, 0], [0, 0, -0.85]], [0.2, 0.17], paw, n));
  }
  for (const [key, side] of [['hl', -1], ['hr', 1]] as Array<[string, number]>) {
    pieces.push(...legPieces(key, false, side, [[0, 0, 0.35], [0, 0, -0.95]], [0.42, 0.26], [[0, 0, 0], [0, 0, -1.02]], [0.2, 0.16], paw, n));
  }
  return pieces;
}

export const ULVA: Kind = {
  bones: quadBonesOf(ULVA_SPEC, (p, a) => {
    const run = a.gait * a.go;
    // Ears up and forward at a run, the head carried low and level, and the tail streaming out behind.
    p.ears[0][0] -= 20 * run;
    p.ears[1][0] -= 20 * run;
    p.neck[0] += 25 * run;
    p.tail[0] -= 45 * run;
    // Standing, the plume is swept to its left, so seen from ahead or behind it is beside the head rather than standing up over
    // it, and it lifts and settles as it sways; grazing, the fore legs fold further, to get its head down to the grass.
    p.tail[0] += 6 * cyc(a.t, 6) * (1 - a.go);
    p.tail[1] -= 40 * (1 - a.go);
    p.legs[0][1] += 0.5 * a.graze;
    p.legs[1][1] += 0.5 * a.graze;
  }),
  build: ulvaBuild,
  palette: (coat, mark) => coatPalette(coat, mark, { crystal: [196, 230, 246], crystalDark: [150, 205, 240], bloom: [236, 176, 70], nose: [110, 80, 100], muzzle: lighter(mark, 0.15) }),
  // The moon's light on its brow, waxing and waning a little every six seconds.
  glow: (b, a) => [{ p: place(b.head, scale(onEgg(SKULL.c, SKULL.r, MOON_DIR).p, ULVA_HEAD_K)), r: 0.85, c: [200, 226, 255], a: 0.3 + 0.06 * cyc(a.t, 4) }],
  shadow: [2.6, 1.1],
  stride: 0.9,
  size: 1.4,
};
