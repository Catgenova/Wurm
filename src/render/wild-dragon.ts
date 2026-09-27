import {
  add, beat, coatPalette, curve, cyc, darker, disc, lerp, lighter, merge, mirrored, mix, onEgg, orb, orbAlong, paint, pastel, quadBones, quadPose,
  scale, smooth, taper, tube, type Anim, type Bones, type Kind, type Piece, type QuadPose, type QuadSpec,
} from './beasts';
import { joint, mesh, type Face, type Mat, type Mesh, type V3 } from './figure';
import { blade, cut, earMesh, pawMesh, quadPieces, under } from './beastkit';
import { glower } from './wild-upright';

/**
 * The dragon: there is one. A great slate-scaled body on four legs, its back
 * laid in courses of scale like a roof in slates, a furnace of a belly that
 * glows through the plates of it, a long neck and a long tail, a horned head
 * with big eyes, and wings that fold along its flanks.
 */

/** A flat thing a little thick, from a polygon of corners all in one plane: a wing's membrane between its fingers. */
function sheet(poly: readonly V3[], up: V3, thick: number, mat: Mat): Mesh {
  const n = poly.length;
  const v: V3[] = [...poly.map((p) => add(p, [up[0] * thick, up[1] * thick, up[2] * thick])), ...poly.map((p) => add(p, [-up[0] * thick, -up[1] * thick, -up[2] * thick]))];
  const f: Face[] = [
    { i: Array.from({ length: n }, (_, q) => q), m: mat },
    { i: Array.from({ length: n }, (_, q) => 2 * n - 1 - q), m: mat },
    ...Array.from({ length: n }, (_, q): Face => ({ i: [q, n + q, n + ((q + 1) % n), (q + 1) % n], m: mat })),
  ];
  // Wound to face out, whichever way round the polygon was given.
  const c = poly.reduce((s, p) => add(s, p), [0, 0, 0] as V3).map((x) => x / n) as V3;
  f.forEach((face) => {
    const idx = face.i;
    let nx = 0, ny = 0, nz = 0, mx = 0, my = 0, mz = 0;
    for (let a = 0; a < idx.length; a++) {
      const p = v[idx[a]], r = v[idx[(a + 1) % idx.length]];
      nx += (p[1] - r[1]) * (p[2] + r[2]); ny += (p[2] - r[2]) * (p[0] + r[0]); nz += (p[0] - r[0]) * (p[1] + r[1]);
      mx += p[0]; my += p[1]; mz += p[2];
    }
    const out: V3 = [mx / idx.length - c[0], my / idx.length - c[1], mz / idx.length - c[2]];
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) idx.reverse();
  });
  return mesh(v, f);
}

const DRAGON_SPEC: QuadSpec = {
  high: 3.2,
  fore: { at: [1.0, 1.9, -0.55], len: [1.2, 1.1, 0.24], rest: [4, -8, 0], fold: [50, 80], toe: [0.55, 0.2] },
  hind: { at: [1.1, -1.9, -0.45], len: [1.3, 1.3, 0.24], rest: [26, -48, 0], fold: [40, 65], toe: [0.55, 0.2] },
  neck: { at: [0, 2.6, 0.5], len: 1.9, lean: 38 },
  head: { pitch: -6 },
  tail: { at: [0, -2.9, 0.3], links: 5, len: 1.05, lift: 6, curl: -3, sway: 16 },
  ears: { at: [0.62, -0.25, 0.55], out: 40, back: 55 },
  swing: [18, 32],
  graze: 30,
  nose: 14,
  bow: 10,
  rock: 5,
};

const DRAGON_HEAD = { c: [0, 0.45, 0.3] as V3, r: [1.25, 1.3, 1.08] as V3 };

function dragonBuild(lod: number): Piece[] {
  const n = cut(lod, 9, 12), k = cut(lod, 5, 7);
  const H = DRAGON_HEAD;
  // The face: a long rounded snout with two nostrils, and two fangs down over the lip in place of a smile.
  const face = merge(
    orbAlong([0, 1.3, -0.15], [0, 1, -0.1], [0.72, 0.85, 0.56], n, k, 'coat'),
    orbAlong([0, 1.2, -0.52], [0, 1, -0.1], [0.6, 0.72, 0.2], n, k, 'mark'),
    ...[1, -1].map((s) => orbAlong([s * 0.26, 2.0, 0.08], [0, 1, 0.4], [0.1, 0.07, 0.07], 5, 3, 'nose')),
    ...[1, -1].map((s) => taper([[s * 0.35, 1.7, -0.42], [s * 0.34, 1.72, -0.54], [s * 0.32, 1.74, -0.64]], 0.075, 0.015, 5, 'horn')),
  );
  // The glare: a slit down the middle of each eye, the lid over the top of it sloping down to the snout, and a brow of dark slate.
  const eyeDir: V3 = [0.62, 0.68, 0.36];
  const { lids, brows } = glower(H.c, H.r, eyeDir, 0.36, { tall: 1.2, drop: 0.3, slope: 0.3, brow: 0.12 });
  const slits = paint([1, -1].map((s) => {
    const { p, n: out } = onEgg(H.c, H.r, [eyeDir[0] * s, eyeDir[1], eyeDir[2]]);
    return disc(add(p, scale(out, 0.045)), out, 0.36 * 0.14, 0.36 * 1.1, 8, 'eye');
  }));
  // Two horns back off the brow, ringed; a spiny crest in slate down the middle.
  const horns = merge(...[1, -1].map((s) => taper(curve([s * 0.5, 0.1, 0.72], [s * 0.72, -0.55, 1.2], [s * 0.6, -1.25, 1.35], 4), 0.2, 0.03, 6, (r) => (r % 2 ? 'horn' : 'hornDark' as Mat)),
  ), ...[0, 1, 2].map((q) => taper([[0, 0.3 - q * 0.45, 0.85 - q * 0.05], [0, 0.1 - q * 0.45, 1.2 - q * 0.08]], 0.12, 0.02, 5, 'stoneDark')));
  // The ears: fins of membrane, back along the head.
  const ear = earMesh(0.8, 0.42, n, { mat: 'mark', point: true });
  // Slates down the back and flanks: courses of flat scales, each course lapped over the one below it.
  const slates: Mesh[] = [];
  const along = 6, round = 4;
  for (let i = 0; i < along; i++) {
    const y = -2.7 + (i / (along - 1)) * 5.2;
    const girth = Math.sin(((y + 3.0) / 5.9) * Math.PI);
    for (let j = 0; j < round; j++) {
      const a = (j / (round - 1) - 0.5) * 2.3 + (i % 2 ? 0.12 : -0.12);
      const R = 1.45 * girth + 0.35, Rz = 1.3 * girth + 0.3;
      const c: V3 = [Math.sin(a) * R, y, 0.35 + Math.cos(a) * Rz];
      const out: V3 = [Math.sin(a), 0, Math.cos(a) * 0.9];
      // Shaded by course, each course a band of one slate, rather than in a chequer that at play size is noise.
      slates.push(blade([add(c, [0, 0.5, 0]), c, add(c, [0, -0.5, -0.04])], [0.44, 0.5, 0.44], out, { mat: i % 2 === 0 ? 'stone' : 'stoneDark', fold: 0.06, thick: 0.07 }));
    }
  }
  // The furnace: a glowing strip down the belly, one piece from the hind legs to the chest, not a row of toes.
  const belly = tube(Array.from({ length: 6 }, (_, q) => [0, -1.6 + q * 0.75, -0.9 + Math.sin((q / 5) * Math.PI) * -0.12] as V3), [0.5, 0.66, 0.72, 0.72, 0.66, 0.5], 0.16, n, 'ember');
  // A wing: an arm to an elbow, three long fingers from it, membrane between, scalloped at the trailing edge.
  const E: V3 = [1.7, 0.3, 0.1], F1: V3 = [3.9, 0.45, 0.25], F2: V3 = [3.3, -1.6, 0.05], F3: V3 = [2.0, -2.5, -0.1], B: V3 = [0, -2.1, -0.2];
  const mid = (a: V3, b: V3, inset: number): V3 => { const m = add(a, b).map((x) => x / 2) as V3; return add(m, [(E[0] - m[0]) * inset, (E[1] - m[1]) * inset, (E[2] - m[2]) * inset]); };
  const wing = merge(
    taper([[0, 0, 0], E], 0.2, 0.15, 6, 'coat'),
    ...[F1, F2, F3].map((F) => taper([E, F], 0.12, 0.04, 5, 'coat')),
    sheet([E, F1, mid(F1, F2, 0.18), F2], [0, 0, 1], 0.03, 'membrane'),
    sheet([E, F2, mid(F2, F3, 0.18), F3], [0, 0, 1], 0.03, 'membrane'),
    sheet([[0, 0, 0], E, F3, mid(F3, B, 0.15), B], [0, 0, 1], 0.03, 'membrane'),
    orb(E, 0.2, 6, 3, 'horn'),
  );
  // The tail's last link carries a spade of slate.
  const tailLinks = [0, 1, 2, 3, 4].map((q) => {
    const r0 = 0.7 - q * 0.13, r1 = 0.7 - (q + 1) * 0.13;
    const link = tube([[0, 0.1, 0], [0, -1.1, 0]], [r0, Math.max(0.1, r1)], [r0 * 0.9, Math.max(0.09, r1 * 0.9)], n, (ring, j) => (under(n, j, 1.0) ? 'mark' : 'coat'), { seam: 'start' });
    return q === 4 ? merge(link, blade([[0, -0.8, 0], [0, -1.4, 0], [0, -2.1, 0]], [0.5, 0.72, 0.02], [0, 0, 1], { mat: 'stoneDark', rib: 'stone', fold: 0.1, thick: 0.09 })) : link;
  });
  return quadPieces({
    n, k,
    body: { y: [-3.0, -2.6, -1.6, 0, 1.6, 2.5, 2.95], z: [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5], w: [0.5, 1.35, 1.7, 1.8, 1.7, 1.35, 0.5], h: [0.45, 1.2, 1.45, 1.5, 1.42, 1.15, 0.45], belly: true },
    neck: { w: 0.82, h: 0.9, len: 1.9 },
    head: { c: H.c, r: H.r, face, eye: { dir: eyeDir, size: 0.36, iris: 'bloom', pupil: 0, rim: 0, tall: 1.2 } },
    ear,
    tail: tailLinks,
    fore: { upper: [0.5, -1.2, 0.62, 0.5], lower: [0, -1.1, 0.46, 0.42], foot: merge(pawMesh(0.5, n, k, 'coat', 0.24), ...[-0.25, 0, 0.25].map((x) => taper([[x, 0.55, -0.2], [x * 1.3, 0.85, -0.24]], 0.1, 0.03, 5, 'horn'))) },
    hind: { upper: [0.6, -1.3, 0.72, 0.56], lower: [0, -1.3, 0.48, 0.42], foot: merge(pawMesh(0.52, n, k, 'coat', 0.24), ...[-0.25, 0, 0.25].map((x) => taper([[x, 0.55, -0.2], [x * 1.3, 0.85, -0.24]], 0.1, 0.03, 5, 'horn'))) },
    extras: [
      { key: 'glare', mesh: merge(slits, lids), bone: 'head', bias: 0.205, after: 'head', hide: [{ c: H.c, r: H.r }] },
      { key: 'brows', mesh: brows, bone: 'head', bias: 0.21, after: ['head', 'glare'], hide: [{ c: H.c, r: H.r }] },
      { key: 'horns', mesh: horns, bone: 'head', bias: 0.22, after: ['head', 'ear0', 'ear1'] },
      { key: 'slates', mesh: merge(...slates), bone: 'trunk', bias: 0.03, after: ['body', 'fl0', 'fr0', 'hl0', 'hr0'], lines: false },
      { key: 'belly', mesh: belly, bone: 'trunk', bias: 0.002, after: 'body' },
      { key: 'wing0', mesh: mirrored(wing), bone: 'wing0', bias: 0.05, after: ['body', 'slates'], front: [-1, 0, 0.3], airy: false, bent: folded },
      { key: 'wing1', mesh: wing, bone: 'wing1', bias: 0.05, after: ['body', 'slates'], front: [1, 0, 0.3], bent: folded },
    ],
    breath: 0.04,
  });
}

/** A wing drawn in to seven tenths of its reach while it is folded, and let out to its whole reach as it opens. */
function folded(v: readonly V3[], a: Anim): V3[] {
  const k = lerp(0.7, 1, wingsOpen(a));
  return v.map((p) => [p[0] * k, p[1] * k, p[2] * k]);
}

/** How far open the wings are: folded going, half out at a run, and stretched now and then standing. */
function wingsOpen(a: Anim): number {
  const stretch = a.go > 0 ? 0 : smooth(beat(a.t, [6.0, 17.5], 3.0) * 1.4);
  return lerp(stretch, 0.35 + 0.1 * Math.sin(a.u * Math.PI * 2), a.go * a.gait);
}

function dragonOwn(p: QuadPose, a: Anim): void {
  const w = a.u - Math.floor(a.u);
  if (a.go > 0) {
    p.neck[0] += 4 * Math.sin(w * Math.PI * 4) * a.go;
    p.tail[1] += 12 * Math.sin(w * Math.PI * 2 + 1) * a.go;
    return;
  }
  // A great slow breath; the head turned to look round; the tail's end twitching.
  p.neck[1] += 18 * cyc(a.t, 2);
  p.tail[1] += 16 * cyc(a.t, 3);
  p.tail[2] += 4 * cyc(a.t, 5);
  // Head up and back as the wings stretch.
  const s = smooth(beat(a.t, [6.0, 17.5], 3.0) * 1.4);
  p.neck[0] -= 14 * s;
  p.head[0] += 10 * s;
}

export const DRAGON: Kind = {
  bones: (a): Bones => {
    const p = quadPose(DRAGON_SPEC, a);
    dragonOwn(p, a);
    const b = quadBones(DRAGON_SPEC, p);
    // The wings from the shoulders: folded, a sail stood up along the top of each shoulder, its fingers back; opened, fanned out
    // and up over the back, never edge on.
    const open = wingsOpen(a);
    for (let k = 0; k < 2; k++) {
      const sd = k ? 1 : -1;
      b[`wing${k}`] = joint(b.body, [sd * 1.2, 1.5, 1.0], lerp(-90, -40, open), sd * lerp(0, -40, open), sd * lerp(-90, -15, open));
    }
    return b;
  },
  build: dragonBuild,
  palette: (coat, mark) => {
    const c = pastel(coat, 250);
    return coatPalette(coat, mark, {
      stone: lighter(c, 0.06), stoneDark: darker(c, 0.18), membrane: mix(pastel(mark), c, 0.35), horn: [240, 228, 206], hornDark: [214, 198, 170],
      ember: [255, 170, 90], bloom: [255, 196, 80], nose: darker(c, 0.4),
    }, 250);
  },
  shadow: [4.6, 2.3],
  stride: 0.7,
  size: 4.2,
  blinks: 6,
  glow: (b, a) => {
    const t = b.trunk ?? b.body;
    const at = (x: V3): V3 => [t.t[0] + t.m[0] * x[0] + t.m[1] * x[1] + t.m[2] * x[2], t.t[1] + t.m[3] * x[0] + t.m[4] * x[1] + t.m[5] * x[2], t.t[2] + t.m[6] * x[0] + t.m[7] * x[1] + t.m[8] * x[2]];
    const pulse = 0.3 + 0.12 * cyc(a.t, 7);
    return [{ p: at([0, 0.4, -1.1]), r: 3.4, c: [255, 150, 70], a: pulse }];
  },
};
