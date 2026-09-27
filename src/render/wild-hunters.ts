import {
  coatPalette, curve, cyc, disc, eyes, lighter, merge, moved, orb, orbAlong, paint, quadBonesOf, scale, taper, TAU, tube, type Kind, type Piece, type QuadSpec,
} from './beasts';
import { mesh, type Mesh, type V3 } from './figure';
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
  tail: { at: [0, -1.95, 0.35], links: 3, len: 0.55, lift: 30, curl: 14, sway: 10 },
  ears: { at: [0.51, -0.12, 0.67], out: 12, back: 8 },
  swing: [24, 44],
  graze: 62,
  nose: 2,
  bow: 24,
  rock: 7,
};

/** How much bigger the head is drawn than it is built: a head a size too big for it, the way a pup's is. */
const ULVA_HEAD_K = 1.22;
const ULVA_HEAD = { c: [0, 0.15 * ULVA_HEAD_K, 0.2 * ULVA_HEAD_K] as V3, r: [0.78 * ULVA_HEAD_K, 0.82 * ULVA_HEAD_K, 0.68 * ULVA_HEAD_K] as V3 };

/** A mesh made `k` times bigger about its own origin. */
const grown = (m: Mesh, k: number): Mesh => mesh(m.v.map((p) => scale(p, k)), m.f);

function ulvaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  // A deep chest and a tucked waist, pale beneath.
  const ys = [-2.15, -1.85, -1.2, -0.3, 0.6, 1.4, 1.95, 2.2];
  const body = tube(ys.map((y, q) => [0, y, [0.1, 0.12, 0.1, 0.02, 0.0, 0.05, 0.12, 0.2][q]] as V3),
    [0.2, 0.62, 0.74, 0.66, 0.8, 0.92, 0.72, 0.2], [0.2, 0.6, 0.66, 0.56, 0.72, 0.8, 0.66, 0.25], n,
    (ring, j) => (ring > 0 && under(n, j, 0.9) ? 'mark' : 'coat'));
  // The ruff: a collar of tufts all round the base of the neck, lying out over the shoulders and the chest, each ending in ice.
  // Few and fat, so it reads as fur with frost on it and not as spikes, and none of it comes up over the face.
  const ruff = merge(...Array.from({ length: 9 }, (_, q) => {
    const a = (q / 9) * TAU + 0.3;
    const root: V3 = [Math.cos(a) * 0.46, Math.sin(a) * 0.46, 0.05];
    const tip: V3 = [Math.cos(a) * 1.0, Math.sin(a) * 1.0, -0.3];
    return taper(curve(root, [Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0.05], tip, 3), 0.28, 0.03, 6, (ring) => (ring >= 2 ? 'crystal' : 'mark'));
  }));
  // The head, built at the size it was and drawn a size bigger.
  const skull = merge(
    orb([0, 0.15, 0.2], [0.78, 0.82, 0.68], n + 1, k + 1, 'coat'),
    // Round cheeks, pale.
    orb([0.42, 0.45, -0.12], [0.36, 0.34, 0.3], n, k, 'mark'), orb([-0.42, 0.45, -0.12], [0.36, 0.34, 0.3], n, k, 'mark'),
  );
  const snout = merge(
    taper([[0, 0.55, -0.08], [0, 1.0, -0.14], [0, 1.4, -0.2]], 0.36, 0.2, n, 'muzzle', 0.85),
    orbAlong([0, 1.45, -0.14], [0, 1, 0.2], [0.17, 0.12, 0.13], 6, 3, 'nose'),
  );
  // The crescent on its brow: a moon, and the coat laid over one side of it.
  const moon = paint([
    disc([0, 0.55, 0.72], [0, 0.62, 0.78], 0.24, 0.22, 10, 'crystal', { lit: true }),
    disc([0.1, 0.6, 0.76], [0, 0.62, 0.78], 0.2, 0.2, 10, 'coat'),
  ]);
  // Its eyes set back along the head, so side on there is a whole eye and then the muzzle in front of it.
  const look = (shut: boolean): Mesh => eyes([0, 0.15, 0.2], [0.78, 0.82, 0.68], [0.7, 0.6, 0.28], 0.26 / ULVA_HEAD_K, { tall: 1.05, shut, iris: 'bloom', pupil: 0.55, rim: 0.05 });
  // An ear, cupped a little and turned out, so side on it shows its face rather than its edge.
  const ear = grown(merge(
    taper(curve([0, 0, 0], [0, 0.02, 0.4], [0, -0.05, 0.85], 3), 0.36, 0.02, n, 'coat', 0.4, [0, 1, 0]),
    paint([disc([0, 0.13, 0.32], [0, 1, 0.1], 0.19, 0.26, 6, 'inner')]),
  ), 1.12);
  // The plume of a tail: one tube through its three links, fullest a little way along and frost at its end.
  const tail = (q: number): Mesh => {
    const rs = [[0.24, 0.36], [0.38, 0.44], [0.42, 0.12]][q];
    const w = [0, 1, 2].map((i) => rs[0] + ((rs[1] - rs[0]) * i) / 2);
    return tube([[0, 0.05, 0], [0, -0.3, 0], [0, -0.62, 0]], w, w, n, q === 2 ? ((ring) => (ring >= 1 ? 'crystal' : 'coat')) : 'coat', { seam: q === 1 ? 'both' : 'start' });
  };
  const H = ULVA_HEAD;
  const hide = [{ c: H.c, r: H.r }];
  const head = (shut: boolean): Mesh => grown(merge(skull, snout, moon, look(shut)), ULVA_HEAD_K);
  const pieces: Piece[] = [
    { key: 'body', mesh: body, bone: 'body', bias: 0, breathes: { c: [0, 0.8, 0], k: 0.04 } },
    ...[0, 1, 2].map((q): Piece => ({ key: `tail${q}`, mesh: tail(q), bone: `tail${q}`, bias: -0.05 + q * 0.01, chain: 'tail' })),
    { key: 'neck', mesh: tube([[0, 0, -0.35], [0, 0, 0.5], [0, 0.05, 1.15]], [0.56, 0.5, 0.46], [0.54, 0.5, 0.46], n, 'coat'), bone: 'neck', bias: 0, under: 'head', convex: true },
    { key: 'ruff', mesh: ruff, bone: 'neck', bias: 0.1, after: ['neck', 'body'] },
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
    // Standing, the plume lifts and settles as it sways; grazing, the fore legs fold further, to get its head down to the grass,
    // and the tug at the grass taken out of the chest and mostly out of so long a neck, which would swing the muzzle a long way.
    p.tail[0] += 6 * cyc(a.t, 6) * (1 - a.go);
    p.legs[0][1] += 0.5 * a.graze;
    p.legs[1][1] += 0.5 * a.graze;
    const tug = cyc(a.t, 72) * (0.45 + 0.55 * Math.max(0, cyc(a.t, 8))) * a.graze;
    p.pitch += 2.5 * tug;
    p.neck[0] -= 4.5 * tug;
  }),
  build: ulvaBuild,
  palette: (coat, mark) => coatPalette(coat, mark, { crystal: [196, 230, 246], bloom: [236, 176, 70], nose: [110, 80, 100], muzzle: lighter(mark, 0.15) }),
  shadow: [2.6, 1.1],
  stride: 0.9,
  size: 1.4,
};
