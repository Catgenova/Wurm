import {
  add, beat, clamp, coatPalette, cross, curve, cyc, disc, lighter, merge, mix, orb, orbAlong, paint, pastel, quadBonesOf, scale, smile, smooth, sub, taper,
  TAU, tube, unit, type Anim, type Kind, type Piece, type QuadPose, type QuadSpec,
} from './beasts';
import { blade, cut, earMesh, hoofMesh, quadPieces, type QuadLook } from './beastkit';
import { mesh, onScreen, place, type Face, type Mat, type Mesh, type RGB, type V3, type View, type Xf } from './figure';

/**
 * The herd: the big grazers and beasts of burden -- the roxxen, the orse,
 * the cudda, the bura, the gorral, the shaggan, the snedda and the sappa.
 * Hooves, deep bodies, and heads still a size too big for them.
 */

/**
 * A body on four hooves: `len` shoulder to hip, `legs` long, the neck `neck`
 * long and carried at `lean` degrees, the ears splayed and laid back by
 * `ears`. Grazing (`crop`), the neck bends down that much further, the head
 * goes that far past its own carriage, and the chest dips that far onto the
 * folded fore legs: each kind's own, so its muzzle meets the grass with the
 * head no more than about twenty degrees past level.
 */
const hoofed = (o: { high: number; len: number; legs: number; neck: number; lean: number; swing?: [number, number]; ears?: [number, number]; crop?: [number, number, number] }): QuadSpec => ({
  high: o.high,
  fore: { at: [0.7, o.len * 0.45, -0.5], len: [o.legs * 0.52, o.legs * 0.48, 0.2], rest: [0, 0, 0], fold: [50, 85], toe: [0.3, 0.2] },
  hind: { at: [0.72, -o.len * 0.45, -0.4], len: [o.legs * 0.55, o.legs * 0.55, 0.2], rest: [16, -32, 0], fold: [40, 65], toe: [0.3, 0.2] },
  neck: { at: [0, o.len * 0.55, 0.3], len: o.neck, lean: o.lean },
  head: { pitch: -6 },
  tail: { at: [0, -o.len * 0.62, 0.55], links: 3, len: 0.45, lift: -35, curl: -6, sway: 10 },
  ears: { at: [0.72, -0.25, 0.45], out: o.ears?.[0] ?? 55, back: o.ears?.[1] ?? 20 },
  swing: o.swing ?? [20, 34],
  graze: o.crop?.[0] ?? 36,
  nose: o.crop?.[1] ?? 8,
  bow: o.crop?.[2] ?? 14,
  rock: 5,
});

/**
 * A tuft-ended tail on a body `len` long, carried out from the rump before it
 * curls down, short in the link: hanging straight down from the root, it was
 * another leg beside the hind ones seen from behind and three quarters round.
 */
const curledTail = (len: number): QuadSpec['tail'] => ({ at: [0, -len * 0.62, 0.55], links: 3, len: 0.35, lift: -5, curl: -25, sway: 10 });

/**
 * The pieces of a body on four hooves (`quadPieces`), its short neck lined
 * only where it is the edge of the whole. Most of a short neck is in front of
 * the shoulder or behind the head, and its own lines drawn there were stray
 * strokes from the poll down across the shoulder.
 */
const shortNecked = (o: QuadLook): Piece[] => quadPieces(o).map((pc) => (pc.key === 'neck' ? { ...pc, lines: false } : pc));

/** How bright a colour looks (its luma), nought to 255: the grass the herd grazes is 177. */
const luma = (c: RGB): number => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
/** The least a coat is painted at: a clear step over the grass's 177, so the darkest variant still stands off the pasture it is on. */
const COAT_LEAST = 186;
/** How much lighter than that the palest variants are painted at the least: the room the variants keep their own lightness in. */
const COAT_SPREAD = 30;
/**
 * A variant's coat made light enough to stand off the grass once it is
 * painted (`pastel`, with the kind's `grey`), without its variants all
 * coming out the one colour. It is scaled up rather than mixed with white,
 * which keeps its hue, to the least lightness its own lightness gives it:
 * `COAT_LEAST` for the darkest, up to `COAT_SPREAD` over that for a pale
 * one, so the variants of a kind keep the order of lightness they had. And
 * its colour is made a fifth as strong again, its lightness kept, since
 * lightened as far as it is a faint bay would be a grey: so a bay stays a
 * bay, a dun a dun, and a grey a grey.
 */
function lit(coat: RGB, grey: number): RGB {
  const y = luma(coat), least = COAT_LEAST + COAT_SPREAD * clamp((y - 50) / 90);
  const strong = coat.map((x) => clamp(y + (x - y) * 1.2, 0, 255)) as RGB;
  const up = (k: number): RGB => [Math.min(255, strong[0] * k), Math.min(255, strong[1] * k), Math.min(255, strong[2] * k)];
  let k = 1;
  while (k < 3 && luma(pastel(up(k), grey)) < least) k += 0.02;
  return up(k);
}

/**
 * The hue a kind paints a variant's greys in (`pastel`): its own `warm` one,
 * or for a coat that is itself a grey, with next to no colour in it, `cool`
 * -- a dove's lilac, a slate's blue -- so that lightened to stand off the
 * grass, a grey variant is not the kind's brown one a shade paler.
 */
const greyFor = (coat: RGB, warm: number, cool: number): number => (Math.max(...coat) - Math.min(...coat) <= 10 ? cool : warm);

/** A plod: a slow heavy walk, the head nodding with each step and the body rolling over its feet; standing, chewing and a flick of the tail. */
function plod(p: QuadPose, a: Anim): void {
  const w = a.u - Math.floor(a.u);
  if (a.go > 0) {
    p.neck[0] += a.go * 6 * Math.sin(w * TAU * 2 + 0.5) * (1 - a.gait);
    p.roll += a.go * 3 * Math.sin(w * TAU);
    p.squash += a.go * 0.03 * Math.max(0, Math.cos(w * TAU * 2));
    p.tail[1] += a.go * 12 * Math.sin(w * TAU + 1.5);
    return;
  }
  p.head[0] += 2 * Math.sin(a.t * Math.PI * 4);
  p.tail[1] += 30 * beat(a.t, [3.1, 8.6, 14.9, 21.2], 0.7) * Math.sin(a.t * Math.PI * 6);
  p.ears[0][0] += 25 * beat(a.t, [6.2, 17.7], 0.5);
  p.ears[1][0] += 25 * beat(a.t, [11.4, 22.1], 0.5);
}

/**
 * A flower `r` across at `at`, facing out along `up`: a round of five petals,
 * each a lobe of the rim (`n` round, ten or more for the lobes to show), a
 * little thick so it is never a line seen edge on, and a bead of a heart.
 */
function flower(at: V3, up: V3, r: number, n: number, petal: Mat, heart: Mat): Mesh {
  const z = unit(up);
  let x = cross([0, 1, 0], z);
  if (Math.hypot(x[0], x[1], x[2]) < 1e-4) x = [1, 0, 0];
  x = unit(x);
  const y = cross(z, x);
  const to = (p: V3): V3 => add(at, add(add(scale(x, p[0]), scale(y, p[1])), scale(z, p[2])));
  const disc0 = orb([0, 0, 0], [r, r, r * 0.45], n, 3, petal);
  const lobe = (p: V3): V3 => { const k = n >= 10 ? 0.74 + 0.26 * Math.cos(5 * Math.atan2(p[1], p[0])) : 1; return [p[0] * k, p[1] * k, p[2]]; };
  const bead = orb([0, 0, r * 0.4], [r * 0.38, r * 0.38, r * 0.24], 6, 3, heart);
  return merge(mesh(disc0.v.map((p) => to(lobe(p))), disc0.f), mesh(bead.v.map(to), bead.f));
}

/**
 * A sheet laid over something round, `at(t, a)` the point on it `t` nought
 * to one along it and `a` radians round it: from `left(t)` round to
 * `right(t)` at each `t`, in `K` rows along and `J` round, each facet drawn in
 * `mat` of its row and column. Faces out, away from the line it is laid
 * round; open all round its edge, since it lies on what it is laid over.
 */
function drape(at: (t: number, a: number) => V3, left: (t: number) => number, right: (t: number) => number, K: number, J: number, mat: (k: number, j: number) => Mat): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    for (let j = 0; j <= J; j++) v.push(at(t, left(t) + (right(t) - left(t)) * (j / J)));
  }
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < J; j++) {
      const A = k * (J + 1) + j, B = A + J + 1;
      const i = [A, A + 1, B + 1, B];
      // Wound to face out, away from the line it is laid round.
      const c = i.reduce((s, q) => add(s, scale(v[q], 0.25)), [0, 0, 0] as V3);
      const n = cross(sub(v[A + 1], v[A]), sub(v[B], v[A]));
      f.push({ i: n[0] * c[0] + n[1] * c[1] < 0 ? i.reverse() : i, m: mat(k, j) });
    }
  }
  return mesh(v, f);
}

/** Light drawn over a body, as a kind's glow is (`Kind.glow`): bright in the middle, gone at its edge, and added to what is under it. */
function shine(g: CanvasRenderingContext2D, view: View, p: V3, r: number, c: RGB, al: number): void {
  if (al < 0.01) return;
  const [x, y] = onScreen(view, p);
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`);
  grad.addColorStop(0.45, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al * 0.35})`);
  grad.addColorStop(1, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0)`);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

/**
 * Whether a point is out of sight behind an egg (`c`, `r` in the frame `xf`,
 * a head on its bone) as seen along `T`, toward the viewer: inside it, or
 * with the egg between it and the viewer.
 */
function inEgg(xf: Xf, c: V3, r: V3, T: V3): (p: V3) => boolean {
  const m = xf.m;
  const back = (v: V3): V3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const t = back(T), d: V3 = [t[0] / r[0], t[1] / r[1], t[2] / r[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  return (p) => {
    const q = back([p[0] - xf.t[0], p[1] - xf.t[1], p[2] - xf.t[2]]);
    const o: V3 = [(q[0] - c[0]) / r[0], (q[1] - c[1]) / r[1], (q[2] - c[2]) / r[2]];
    const oo = o[0] * o[0] + o[1] * o[1] + o[2] * o[2], od = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
    return oo < 1 || (od < 0 && od * od - dd * (oo - 1) > 0);
  };
}

/** A tail: a rope with a tuft at its end. */
const tuftTail = (n: number): Mesh[] => [
  taper([[0, 0, 0], [0, -0.5, 0]], 0.12, 0.1, 5, 'coat'),
  taper([[0, 0, 0], [0, -0.5, 0]], 0.1, 0.08, 5, 'coat'),
  merge(taper([[0, 0, 0], [0, -0.2, 0]], 0.08, 0.1, 5, 'coat'), orbAlong([0, -0.45, 0], [0, -1, 0], [0.22, 0.22, 0.34], n, 4, 'mark')),
];

/* ---- the roxxen ---------------------------------------------------------------------- */

/**
 * A roxxen: a great slab-shouldered ox that holds its head low. Its shoulders
 * are a hill -- a hump of moss with flowers and a toadstool in it -- its
 * lyre of horns is ringed like old stone, and its hooves are stone.
 */
const ROXXEN_SPEC: QuadSpec = {
  ...hoofed({ high: 2.4, len: 3.6, legs: 1.7, neck: 0.8, lean: 80, swing: [18, 30], ears: [70, 10], crop: [56, 10, 12] }),
  // The ears on the corners of its big head.
  ears: { at: [0.83, -0.29, 0.52], out: 70, back: 10 },
  tail: curledTail(3.6),
};
const ROXXEN_HEAD = { c: [0, 0.35, 0.0] as V3, r: [1.32, 1.2, 1.1] as V3 };

function roxxenBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = ROXXEN_HEAD;
  // A broad soft muzzle standing half a head's depth out in front of the eyes, so side on there is a face ahead of the eye.
  const muzzle = merge(
    orbAlong([0, 1.56, -0.25], [0, 1, -0.2], [0.8, 0.71, 0.58], n, k, 'muzzle'),
    paint([disc([0.32, 2.13, -0.17], [0.2, 1, 0.2], 0.115, 0.09, 6, 'nose'), disc([-0.32, 2.13, -0.17], [-0.2, 1, 0.2], 0.115, 0.09, 6, 'nose')]),
    smile([0, 2.16, -0.52], [0, 1, -0.3], 0.39),
  );
  // Horns growing from the sides of the head, out and up at once and curving forward at the tips, ringed in darker bands like
  // weathered stone above their plain roots: no part of them pointing at the viewer from any side, so each shows its length and
  // not its end -- side on a horn's hook over the brow, and from in front or behind a lyre.
  const horn = (s: number): Mesh => taper(curve([s * 1.05, 0.08, 0.58], [s * 1.7, 0.0, 1.15], [s * 1.55, 0.3, 1.8], 5), 0.3, 0.1, 7, (ring) => (ring >= 2 && ring % 2 ? 'stoneDark' : 'horn'));
  // The hill on its shoulders: moss heaped half a unit over the line of the back, so it breaks the outline from every side, and
  // flowers and a toadstool growing out of the top of it.
  const hill = merge(
    orb([0, 0.9, 1.85], [1.05, 1.25, 0.65], n + 1, k, 'moss'),
    orb([0, 0.2, 1.75], [0.9, 0.9, 0.55], n, k, 'moss'),
    ...([[0.4, 1.3, 2.5], [-0.5, 0.7, 2.45], [0.2, 0.3, 2.3], [-0.2, 1.5, 2.4]] as V3[]).map((c, q) => orb(c, 0.17, 5, 3, q % 2 ? 'petal' : 'bloom')),
    taper([[0.55, 0.6, 2.25], [0.55, 0.6, 2.6]], 0.08, 0.07, 5, 'spot'),
    orbAlong([0.55, 0.6, 2.62], [0, 0, 1], [0.26, 0.26, 0.14], n, 3, 'cap'),
  );
  // Stout legs, not a calf's thin ones, on stone hooves as wide as the leg is thick and five-sided like a cut block.
  const hoof = hoofMesh(0.5, 0.22, 5, 'stone');
  return quadPieces({
    n, k,
    // Rounded off at the rump and the chest rather than cut square: the ends of the trunk close over in three rings.
    body: { y: [-2.6, -2.45, -2.25, -1.2, 0, 1.2, 2.0, 2.3, 2.5], z: [0.3, 0.22, 0.2, 0.25, 0.35, 0.55, 0.6, 0.58, 0.55], w: [0.35, 0.9, 1.15, 1.45, 1.55, 1.7, 1.5, 1.15, 0.5], h: [0.3, 0.8, 1.0, 1.2, 1.3, 1.45, 1.3, 1.0, 0.45], belly: true },
    neck: { w: 1.0, h: 0.95, len: 0.8 },
    head: { c: H.c, r: H.r, face: muzzle, eye: { dir: [0.8, 0.52, 0.2], size: 0.38, rim: 0.12 }, blush: [[0.82, 0.45, -0.35], 0.27] },
    ear: earMesh(0.66, 0.4, n),
    tail: tuftTail(n),
    fore: { upper: [0.35, -0.88, 0.62, 0.5], lower: [0, -0.82, 0.45, 0.42], foot: hoof },
    hind: { upper: [0.35, -0.94, 0.7, 0.52], lower: [0, -0.94, 0.45, 0.42], foot: hoof },
    extras: [
      { key: 'horns', mesh: merge(horn(1), horn(-1)), bone: 'head', bias: 0.25, after: ['head', 'ear0', 'ear1'] },
      { key: 'hill', mesh: hill, bone: 'trunk', bias: 0.03, after: 'body' },
    ],
    breath: 0.04,
  });
}

export const ROXXEN: Kind = {
  bones: quadBonesOf(ROXXEN_SPEC, plod),
  build: roxxenBuild,
  palette: (coat, mark) => coatPalette(lit(coat, 28), mark, { moss: [134, 178, 100], horn: [232, 222, 200], stoneDark: [170, 162, 150], stone: [150, 145, 138], bloom: [250, 220, 120], petal: [244, 180, 206], cap: [222, 106, 96], spot: [250, 244, 232] }, 28),
  shadow: [3.0, 1.9],
  stride: 0.75,
  size: 1.75,
};

/* ---- the orse ------------------------------------------------------------------------ */

/**
 * An orse: long in the leg and deep in the chest, its mane falling to one
 * side like water, with stars caught in it; feathered tufts at its fetlocks
 * like little wings, and a tail like a waterfall.
 */
const ORSE_SPEC: QuadSpec = {
  ...hoofed({ high: 3.3, len: 3.4, legs: 2.9, neck: 2.0, lean: 24, swing: [22, 40], ears: [18, 6], crop: [114, 10, 18] }),
  // The neck rising from high on the chest, so a length of it shows between the back and the head, and the mane on it.
  neck: { at: [0, 1.95, 0.55], len: 2.0, lean: 24 },
  // Ears up on the crown, as a horse's are, rather than at the back corners of the head.
  ears: { at: [0.5, 0.05, 0.85], out: 18, back: 6 },
  // A waterfall of a tail: set high on the rump, arching back and pouring down.
  tail: { at: [0, -2.25, 0.9], links: 3, len: 0.75, lift: -40, curl: -18, sway: 15 },
};
const ORSE_HEAD = { c: [0, 0.45, 0.12] as V3, r: [1.0, 1.1, 0.94] as V3 };
/**
 * A point on its mane, in the neck's frame: `t` nought to one up the neck
 * from the withers to the poll, `a` radians round it from the crest (a
 * quarter turn is the right side), and `off` out from the mane's face. The
 * mane stands proud of the neck along the crest and lies close to it at its
 * edges, and the further down the side it falls the further back toward the
 * withers it runs, as water running off it would.
 */
const orseMane = (t: number, a: number, off = 0): V3 => {
  const up = 1.03 + 0.36 * Math.sin(Math.PI * (0.15 + 0.7 * t)) * Math.cos(a) ** 2, s = Math.sin(a);
  return [s * (0.56 * up + off), -Math.cos(a) * (0.72 * up + off), -0.3 + 2.35 * t - 0.3 * s * s];
};
/** Tongues of the mane, a bump of one at each of `at` along the neck, `w` long. */
const tongues = (t: number, at: readonly number[], w: number): number => at.reduce((s, c) => s + Math.exp(-(((t - c) / w) ** 2)), 0);
/** Where the stars are caught in its mane, along it and round it: one in each of the tongues it falls in down the right side. */
const ORSE_STARS: Array<[number, number]> = [[0.28, 1.2], [0.55, 1.35], [0.78, 1.5]];

function orseBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = ORSE_HEAD;
  // A long soft muzzle well out in front of the eyes, its top at their height, so side on it is a face with a nose to it.
  const muzzle = merge(
    orbAlong([0, 1.6, -0.08], [0, 1, -0.35], [0.6, 0.62, 0.55], n, k, 'muzzle'),
    paint([disc([0.22, 2.07, -0.16], [0.3, 1, 0.1], 0.09, 0.07, 6, 'nose'), disc([-0.22, 2.07, -0.16], [-0.3, 1, 0.1], 0.09, 0.07, 6, 'nose')]),
    smile([0, 2.0, -0.53], [0, 1, -0.4], 0.28),
  );
  // The mane, water: lying along the top of the neck, standing up off it at the crest, and falling to both sides of it -- in three
  // tongues down the right, where most of it falls, and two little ones down the left -- with a streak of light along it just off
  // the crest. Each side is a piece of its own, so the side turned away from the viewer goes down under the neck, and each is
  // lined only round the outside, as water has no lines in it. Stars are caught in the tongues on the right, each two crossed
  // slivers of light, so it has points, and a glow over it (`ORSE.extra`).
  const K = lod ? 18 : 12;
  const right = drape(orseMane, () => 0, (t) => 1.1 + 0.72 * tongues(t, [0.28, 0.56, 0.84], 0.085), K, 3, (_k, j) => (j === 0 ? 'shell' : 'water'));
  const left = drape(orseMane, (t) => -0.85 - 0.4 * tongues(t, [0.4, 0.78], 0.1), () => 0, K, 2, () => 'water');
  const stars = paint(ORSE_STARS.flatMap(([t, a]) => {
    const c = orseMane(t, a, 0.03), n = unit(sub(orseMane(t, a, 1), c));
    return [disc(c, n, 0.2, 0.06, 4, 'glint', { lit: true }), disc(c, n, 0.06, 0.2, 4, 'glint', { lit: true })];
  }));
  const forelock = taper(curve([0, 0.2, 1.02], [0.1, 0.8, 1.0], [0.15, 1.2, 0.72], 3), 0.26, 0.06, 6, 'mark', 0.6);
  // The tail: three long links, flatter across than deep so side on it is a broad fall, widening and then drawn to a point: water,
  // with streaks of its markings and of light down the length of it.
  const streak = (d: [number, number, number]): Mesh => tube(curve([0, 0, 0], [0, -0.38, 0.03], [0, -0.75, 0], 2), d.map((x) => x * 0.62), d, n, (_ring, j) => (j % 3 === 1 ? 'mark' : j % 3 === 2 ? 'crystal' : 'water'));
  const tail = [streak([0.24, 0.3, 0.36]), streak([0.36, 0.42, 0.44]), streak([0.44, 0.3, 0.08])];
  // A little wing at each fetlock: two broad pale feathers, flat side out, swept back and up, lined lightly.
  const wing = (sd: number): Mesh => merge(
    blade(curve([sd * 0.2, -0.04, 0.3], [sd * 0.42, -0.3, 0.45], [sd * 0.5, -0.58, 0.78], 3), [0.05, 0.17, 0.18, 0.03], [sd, 0.15, 0.3], { mat: 'spot', rib: 'water', fold: 0.15, thick: 0.035 }),
    blade(curve([sd * 0.2, -0.02, 0.22], [sd * 0.4, -0.32, 0.3], [sd * 0.47, -0.6, 0.48], 3), [0.04, 0.14, 0.14, 0.02], [sd, 0.15, 0.2], { mat: 'spot', rib: 'water', fold: 0.15, thick: 0.035 }),
  );
  const wings: Piece[] = (['fl', 'fr', 'hl', 'hr'] as const).map((leg) => {
    const sd = leg[1] === 'l' ? -1 : 1;
    return { key: `wing${leg}`, mesh: wing(sd), bone: `${leg}2`, bias: 0.035, after: `${leg}2`, front: [sd * 0.7, leg[0] === 'f' ? 0.7 : -0.7, 0] as V3, airy: true };
  });
  return quadPieces({
    n, k,
    body: { y: [-2.35, -2.2, -1.95, -1.1, 0, 1.1, 1.85, 2.1, 2.3], z: [0.35, 0.3, 0.3, 0.35, 0.3, 0.38, 0.45, 0.48, 0.5], w: [0.3, 0.8, 1.0, 1.15, 1.1, 1.2, 1.1, 0.85, 0.35], h: [0.3, 0.75, 0.95, 1.05, 1.0, 1.1, 1.0, 0.8, 0.35], belly: false },
    neck: { w: 0.56, h: 0.72, len: 2.0 },
    head: { c: H.c, r: H.r, face: muzzle, eye: { dir: [0.8, 0.52, 0.22], size: 0.34, rim: 0.12 }, blush: [[0.8, 0.5, -0.3], 0.22] },
    // A horse's ear, pointed and near as thick as it is broad, so turned edge on it is still an ear and not a sliver.
    ear: merge(
      tube(curve([0, 0, 0], [0, 0.04, 0.36], [0, -0.04, 0.72], 4), [0.24, 0.3, 0.24, 0.135, 0.02], [0.16, 0.17, 0.15, 0.1, 0.02], n, 'coat', { up: [0, 1, 0], seam: 'start' }),
      paint([disc([0, 0.19, 0.32], [0, 1, 0.1], 0.14, 0.2, 7, 'inner')]),
    ),
    earTurn: 25,
    tail,
    fore: { upper: [0.35, -1.5, 0.42, 0.28], lower: [0, -1.4, 0.24, 0.22], foot: hoofMesh(0.3, 0.24, n) },
    hind: { upper: [0.35, -1.6, 0.5, 0.3], lower: [0, -1.6, 0.24, 0.22], foot: hoofMesh(0.3, 0.24, n) },
    extras: [
      { key: 'mane', mesh: merge(right, stars), bone: 'neck', bias: 0.12, after: ['neck', 'body'], front: [1, -0.7, 0], lines: false },
      { key: 'maneLeft', mesh: left, bone: 'neck', bias: 0.12, after: ['neck', 'body'], front: [-1, -0.7, 0], lines: false },
      { key: 'forelock', mesh: forelock, bone: 'head', bias: 0.22, after: ['head', 'ear0', 'ear1'] },
      ...wings,
    ],
  });
}

export const ORSE: Kind = {
  bones: quadBonesOf(ORSE_SPEC, (p, a) => {
    plod(p, a);
    // At a run the neck stretches out and the tail streams out behind.
    p.neck[0] += 25 * a.gait * a.go;
    p.tail[0] += 25 * a.gait * a.go;
    // Standing, now and then a toss of the head, the neck drawn up with it; and a fore hoof pawing at the ground, twice over.
    const toss = beat(a.t, [3.6, 14.2], 0.8) * (1 - a.graze);
    p.head[0] += 24 * toss;
    p.neck[0] -= 10 * toss;
    const paw = stamp(a.t, [10.4, 11.1]) * (1 - a.go) * (1 - a.graze);
    p.legs[1][0] += 18 * paw;
    p.legs[1][1] += 0.7 * paw;
    p.legs[1][2] = Math.max(p.legs[1][2], paw);
  }),
  build: orseBuild,
  palette: (coat, mark) => {
    // The muzzle the paler of the coat and the markings lightened, so a dark-maned orse does not have a dark nose.
    const c = lit(coat, 30), fromCoat = lighter(pastel(c, 30), 0.3), fromMark = lighter(pastel(mark, 30), 0.3);
    const water = mix([150, 206, 236], pastel(mark), 0.2);
    return coatPalette(c, mark, {
      muzzle: luma(fromMark) > luma(fromCoat) ? fromMark : fromCoat, water, crystal: [218, 240, 252], shell: mix(water, [246, 252, 255], 0.5),
      spot: [250, 248, 240], hoof: [120, 104, 100],
    }, 30);
  },
  // Stars caught in the mane, each twinkling in its own time: a point of light each, and only while the side of the mane it is in
  // is turned toward the viewer and the head is not in front of it, since light added over the picture would shine through both.
  extra: (g, view, b, a, under) => {
    if (under) return;
    const m = b.neck.m, T = view.T;
    const side = clamp(((m[0] * T[0] + m[3] * T[1] + m[6] * T[2]) - 0.05) / 0.3);
    if (side <= 0) return;
    const head = inEgg(b.head, ORSE_HEAD.c, ORSE_HEAD.r, T);
    ORSE_STARS.forEach(([u, round], q) => {
      const p = place(b.neck, orseMane(u, round, 0.05));
      if (head(p)) return;
      shine(g, view, p, 0.7, [236, 246, 255], side * (0.35 + 0.4 * Math.max(0, Math.sin(a.t * 2.1 + q * 2.3))));
    });
  },
  shadow: [2.6, 1.3],
  stride: 0.7,
  size: 1.6,
};

/* ---- the cudda ----------------------------------------------------------------------- */

/**
 * A cudda: a placid, deep-bellied grazer that chews whatever it is given and
 * gives milk back for it. Its patches are clouds, it wears a crown of flowers
 * between its little horns, and a bell hangs at its throat.
 */
const CUDDA_SPEC: QuadSpec = {
  // A neck just long enough that grazing, the chest let down only a little, the muzzle reaches the grass with all four feet on it.
  ...hoofed({ high: 2.4, len: 3.4, legs: 1.7, neck: 1.1, lean: 70, swing: [18, 30], ears: [72, 22], crop: [68, 10, 12] }),
  tail: curledTail(3.4),
};
const CUDDA_HEAD = { c: [0, 0.35, 0.05] as V3, r: [1.1, 1.0, 0.92] as V3 };

function cuddaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = CUDDA_HEAD;
  // A soft pink muzzle standing out in front of the eyes, its top up at their height, so side on there is a face ahead of the eye.
  const muzzle = merge(
    orbAlong([0, 1.36, -0.14], [0, 1, -0.2], [0.66, 0.56, 0.46], n, k, 'inner'),
    paint([disc([0.24, 1.82, -0.06], [0.2, 1, 0.2], 0.1, 0.08, 6, 'nose'), disc([-0.24, 1.82, -0.06], [-0.2, 1, 0.2], 0.1, 0.08, 6, 'nose')]),
    smile([0, 1.84, -0.34], [0, 1, -0.3], 0.3),
  );
  // The clouds: three little heaps of cloud sitting on its back, apart from one another, each three puffs in a row with the middle
  // one highest -- one tube swelling and pinching along its length, which is a cloud's lumpy top at a fraction of what three
  // balls cost; lined only round the outside, with a silver edge (`sheen`). Each to one side of the back or the other and sat up
  // on it, so from in front or behind they are clouds apart and not one plume over its head, and side on they still stand up
  // out of the line of the back.
  const PUFF = { d: [-1.0, -0.78, -0.42, 0, 0.42, 0.78, 1.0], h: [0.12, 0.56, 0.4, 0.72, 0.4, 0.56, 0.12], w: [0.2, 0.62, 0.56, 0.72, 0.56, 0.62, 0.2], z: [0, 0.02, 0.05, 0.14, 0.05, 0.02, 0] };
  const clouds = merge(...([[0.5, -1.55, 1.5, 0.48], [0.46, 1.2, 1.58, 0.44], [-0.46, -0.2, 1.68, 0.42]] as number[][]).map(([x, y, z, r]) =>
    tube(PUFF.d.map((d, q) => [x, y + d * r * 1.25, z + PUFF.z[q] * r] as V3), PUFF.w.map((w) => w * r), PUFF.h.map((h) => h * r), n, 'spot')));
  const horns = merge(taper(curve([0.5, 0.2, 0.7], [0.75, 0.25, 0.95], [0.7, 0.4, 1.1], 2), 0.13, 0.04, 6, 'horn'), taper(curve([-0.5, 0.2, 0.7], [-0.75, 0.25, 0.95], [-0.7, 0.4, 1.1], 2), 0.13, 0.04, 6, 'horn'));
  // The crown: five flowers big enough to stand up out of the line of the head.
  const crown = merge(...Array.from({ length: 5 }, (_, q) => {
    const a = -Math.PI * 0.9 + (q / 4) * Math.PI * 0.8;
    return orb([Math.cos(a) * 0.55, 0.35 + Math.sin(a) * -0.5, 1.0], 0.2, 6, 3, q % 2 ? 'petal' : 'bloom');
  }));
  // The bell, on the throat under the jaw (in the neck's frame, whose forward is down the throat at the neck's lean), drawn before
  // the head so that the face is never behind it.
  const bell = merge(taper([[0, 0.8, 0.6], [0, 1.25, 0.63]], 0.16, 0.28, 7, 'fitting'), orb([0, 1.32, 0.63], 0.08, 5, 3, 'fitting'));
  return shortNecked({
    n, k,
    // Deep in the belly: the middle of the trunk let down, round at the rump and the chest.
    body: { y: [-2.45, -2.3, -2.05, -1.1, 0, 1.1, 1.9, 2.15, 2.35], z: [0.3, 0.25, 0.25, 0.2, 0.1, 0.25, 0.45, 0.45, 0.42], w: [0.3, 0.9, 1.2, 1.5, 1.6, 1.55, 1.3, 1.0, 0.4], h: [0.3, 0.8, 1.02, 1.3, 1.45, 1.35, 1.1, 0.85, 0.35] },
    neck: { w: 0.9, h: 0.9, len: 1.1 },
    head: { c: H.c, r: H.r, face: muzzle, eye: { dir: [0.8, 0.52, 0.2], size: 0.34, rim: 0.12 }, blush: [[0.84, 0.42, -0.35], 0.24] },
    ear: earMesh(0.55, 0.34, n),
    tail: tuftTail(n),
    fore: { upper: [0.35, -0.9, 0.46, 0.36], lower: [0, -0.8, 0.32, 0.3], foot: hoofMesh(0.34, 0.2, n) },
    hind: { upper: [0.35, -0.95, 0.52, 0.38], lower: [0, -0.95, 0.32, 0.3], foot: hoofMesh(0.34, 0.2, n) },
    extras: [
      { key: 'clouds', mesh: clouds, bone: 'trunk', bias: 0.01, after: 'body', lines: false, sheen: 'glint' },
      { key: 'horns', mesh: merge(horns, crown), bone: 'head', bias: 0.25, after: ['head', 'ear0', 'ear1'] },
      { key: 'bell', mesh: bell, bone: 'neck', bias: 0.19, after: 'neck', under: 'head' },
    ],
  });
}

export const CUDDA: Kind = {
  bones: quadBonesOf(CUDDA_SPEC, plod),
  build: cuddaBuild,
  // Its clouds a cool white, a sky's rather than a fleece's, so they stand off a cream coat; a grey cudda a dove's grey.
  palette: (coat, mark) => {
    const grey = greyFor(coat, 24, 250);
    return coatPalette(lit(coat, grey), mark, { spot: mix(lighter(pastel(mark), 0.55), [236, 244, 255], 0.6), inner: [240, 176, 184], nose: [196, 110, 126], horn: [244, 232, 206], bloom: [250, 222, 120], petal: [246, 176, 204], fitting: [232, 192, 104] }, grey);
  },
  shadow: [2.8, 1.8],
  stride: 0.8,
  size: 2.1,
};

/* ---- the bura ------------------------------------------------------------------------ */

/**
 * A bura: broad, slow and endlessly patient, made to have things strapped
 * to it. Its back is flat as a table and grown over with grass, a little
 * bush and a fern on it; two small stubby horns, and legs like posts.
 */
const BURA_SPEC: QuadSpec = {
  // A neck just long enough that grazing, the chest let down only a little, the muzzle reaches the grass with all four feet on it.
  ...hoofed({ high: 2.4, len: 3.8, legs: 1.6, neck: 1.0, lean: 72, swing: [16, 26], ears: [80, 20], crop: [64, 10, 12] }),
  tail: curledTail(3.8),
};
const BURA_HEAD = { c: [0, 0.35, 0.0] as V3, r: [1.1, 1.0, 0.9] as V3 };

function buraBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = BURA_HEAD;
  // A broad soft muzzle standing out in front of the eyes, so side on there is a face ahead of the eye.
  const muzzle = merge(
    orbAlong([0, 1.35, -0.2], [0, 1, -0.2], [0.66, 0.58, 0.46], n, k, 'muzzle'),
    paint([disc([0.24, 1.8, -0.12], [0.2, 1, 0.2], 0.09, 0.07, 6, 'nose'), disc([-0.24, 1.8, -0.12], [-0.2, 1, 0.2], 0.09, 0.07, 6, 'nose')]),
    smile([0, 1.82, -0.4], [0, 1, -0.3], 0.3),
  );
  const horns = merge(taper([[0.45, 0.3, 0.72], [0.55, 0.35, 1.05]], 0.16, 0.08, 6, 'horn'), taper([[-0.45, 0.3, 0.72], [-0.55, 0.35, 1.05]], 0.16, 0.08, 6, 'horn'));
  // The table of its back: a slab of turf cut from a meadow -- a deep band of soil under a mat of grass a little wider than it,
  // grass standing up in tufts all along both edges -- and a bush, a fern and a flower growing on it.
  const table = merge(
    tube([[0, -2.0, 1.02], [0, 2.0, 1.02]], [1.4, 1.45], 0.38, n, 'bark', { up: [0, 0, 1] }),
    tube([[0, -2.06, 1.42], [0, 2.06, 1.42]], [1.48, 1.53], 0.09, n, 'moss', { up: [0, 0, 1] }),
    orb([0.5, -1.0, 1.78], [0.55, 0.55, 0.48], n, k, 'leaf'),
    orb([0.22, -1.35, 1.64], [0.36, 0.36, 0.32], n, k, 'leafDark'),
    orb([-0.9, -0.3, 1.58], 0.2, 6, 3, 'bloom'),
  );
  // Each blade of grass an open three-sided cone: its root is in the turf and its tip a point, so neither end needs closing.
  const grass = (from: V3, to: V3, r: number): Mesh => tube([from, to], [r, 0.01], [r, 0.01], 3, 'stem', { start: false, end: false });
  const tufts = merge(...[-1.75, -1.15, -0.55, 0.05, 0.65, 1.25, 1.8].flatMap((y, q) => [1, -1].flatMap((s) => {
    const x = s * (1.44 - 0.04 * (q % 2)), lean = s * (0.08 + 0.04 * (q % 3));
    return [grass([x, y, 1.42], [x + lean, y + 0.06, 1.8], 0.1), grass([x, y + 0.16, 1.42], [x + lean * 1.5, y + 0.22, 1.7], 0.08)];
  })));
  // The fern: five fronds sprung from one heart, each a broad blade creased down its middle, arching out and over.
  const fern = merge(...[0, 1, 2, 3, 4].map((q) => {
    const a = q * (TAU / 5) + 0.4, c = Math.cos(a), sn = Math.sin(a);
    return blade(curve([-0.5, 0.8, 1.48], [-0.5 + c * 0.28, 0.8 + sn * 0.28, 1.86], [-0.5 + c * 0.6, 0.8 + sn * 0.6, 1.74], 3), [0.04, 0.15, 0.12, 0.02], [c * 0.6, sn * 0.6, 1], { twist: 0.5, fold: 0.3, mat: 'leaf', rib: 'leafDark' });
  }));
  return quadPieces({
    n, k,
    body: { y: [-2.6, -2.45, -2.2, -1.2, 0, 1.2, 2.1, 2.35, 2.55], z: [0.2, 0.15, 0.2, 0.3, 0.3, 0.3, 0.35, 0.33, 0.3], w: [0.3, 1.0, 1.35, 1.6, 1.65, 1.6, 1.4, 1.05, 0.35], h: [0.3, 0.72, 0.95, 1.05, 1.08, 1.05, 0.95, 0.72, 0.35], belly: true },
    neck: { w: 0.95, h: 0.85, len: 1.0 },
    head: { c: H.c, r: H.r, face: muzzle, eye: { dir: [0.8, 0.52, 0.2], size: 0.34, rim: 0.12 }, blush: [[0.82, 0.45, -0.35], 0.22] },
    ear: earMesh(0.5, 0.32, n),
    tail: tuftTail(n),
    fore: { upper: [0.35, -0.85, 0.55, 0.48], lower: [0, -0.75, 0.46, 0.44], foot: hoofMesh(0.48, 0.2, n) },
    hind: { upper: [0.35, -0.9, 0.58, 0.5], lower: [0, -0.9, 0.46, 0.44], foot: hoofMesh(0.48, 0.2, n) },
    extras: [
      { key: 'horns', mesh: horns, bone: 'head', bias: 0.25, after: ['head', 'ear0', 'ear1'] },
      { key: 'table', mesh: table, bone: 'trunk', bias: 0.04, after: 'body' },
      // The grass and the fern each lined only round the outside, so they are a tuft and a frond and not a scribble of lines.
      { key: 'tufts', mesh: tufts, bone: 'trunk', bias: 0.045, after: 'table', lines: false },
      { key: 'fern', mesh: fern, bone: 'trunk', bias: 0.05, after: 'table', lines: false },
    ],
    breath: 0.03,
  });
}

export const BURA: Kind = {
  bones: quadBonesOf(BURA_SPEC, plod),
  build: buraBuild,
  // A turf deeper and yellower than the grass it walks on, over a band of soil, so the table does not read as the ground through it;
  // a grey bura the blue-grey of a rain cloud.
  palette: (coat, mark) => {
    const grey = greyFor(coat, 32, 215);
    return coatPalette(lit(coat, grey), mark, { moss: [138, 176, 88], stem: [164, 204, 98], bark: [140, 110, 84], leaf: [124, 184, 96], leafDark: [92, 150, 82], horn: [230, 216, 188], bloom: [250, 206, 120] }, grey);
  },
  shadow: [3.0, 2.0],
  stride: 0.65,
  size: 2.2,
};

/* ---- the gorral ---------------------------------------------------------------------- */

/**
 * A gorral: a cliff-goat that stands where you would not put a ladder. Its
 * horns are spirals of pale crystal, its beard is a small cloud, and its
 * hooves are neat and dark.
 */
// A body long enough to carry a rider, a neck long enough that grazing it keeps all four feet on the ground, and ears splayed
// only half out, so side on the near one shows its face and not its rim.
const GORRAL_SPEC = hoofed({ high: 2.5, len: 3.2, legs: 2.1, neck: 1.05, lean: 35, swing: [22, 40], ears: [45, 5], crop: [100, 10, 13] });
const GORRAL_HEAD = { c: [0, 0.35, 0.12] as V3, r: [0.98, 1.04, 0.92] as V3 };
/**
 * A point `u` of the way up the right horn (`sd` 1) or the left (-1), in the
 * head's frame: a corkscrew of a turn and three quarters about a line going
 * up and back, its coils drawn in as it rises.
 */
const gorralHorn = (sd: number, u: number): V3 => {
  const a = u * Math.PI * 3.5, R = 0.2 * (1 - 0.45 * u);
  return [sd * (0.4 + 0.3 * u + Math.cos(a) * R), 0.2 - 0.75 * u + Math.sin(a) * R, 0.8 + 1.0 * u];
};

function gorralBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = GORRAL_HEAD;
  // A neat muzzle out in front of the eyes, its top up at their height, so side on there is a face ahead of the eye.
  const muzzle = merge(
    orbAlong([0, 1.42, -0.03], [0, 1, -0.25], [0.52, 0.55, 0.46], n, k, 'muzzle'),
    paint([disc([0.2, 1.84, -0.01], [0.2, 1, 0.1], 0.08, 0.06, 6, 'nose'), disc([-0.2, 1.84, -0.01], [-0.2, 1, 0.1], 0.08, 0.06, 6, 'nose')]),
    smile([0, 1.82, -0.29], [0, 1, -0.3], 0.26),
  );
  // Crystal horns: thick corkscrews, banded at every third ring in a deeper blue, and a silver edge of light on them (`sheen`);
  // thick to the tip, so up close they are crystal with a line round it and not a coil of ink.
  const horn = (sd: number): Mesh => taper(Array.from({ length: 17 }, (_, q) => gorralHorn(sd, q / 16)), 0.28, 0.09, 5, (ring) => (ring % 3 === 2 ? 'crystalDark' : 'crystal'));
  const beard = merge(orb([0, 1.25, -0.85], [0.34, 0.3, 0.32], n, k, 'spot'), orb([0.17, 1.12, -0.66], 0.23, n, k, 'spot'), orb([-0.17, 1.12, -0.66], 0.23, n, k, 'spot'));
  return shortNecked({
    n, k,
    body: { y: [-2.05, -1.77, -0.91, 0, 0.91, 1.66, 2.05], z: [0.3, 0.35, 0.35, 0.3, 0.35, 0.4, 0.45], w: [0.3, 0.95, 1.1, 1.1, 1.15, 1.0, 0.3], h: [0.3, 0.9, 0.98, 0.96, 1.02, 0.94, 0.3], belly: true },
    neck: { w: 0.6, h: 0.66, len: 1.05 },
    head: { c: H.c, r: H.r, face: muzzle, eye: { dir: [0.8, 0.52, 0.22], size: 0.32, rim: 0.12 }, blush: [[0.8, 0.45, -0.3], 0.22] },
    ear: earMesh(0.52, 0.25, n, { point: true }),
    tail: [taper([[0, 0, 0], [0, -0.3, 0]], 0.16, 0.1, 5, 'mark'), taper([[0, 0, 0], [0, -0.2, 0]], 0.1, 0.02, 5, 'mark')],
    fore: { upper: [0.3, -1.1, 0.38, 0.28], lower: [0, -1.0, 0.24, 0.21], foot: hoofMesh(0.27, 0.2, n) },
    hind: { upper: [0.3, -1.15, 0.46, 0.3], lower: [0, -1.15, 0.24, 0.21], foot: hoofMesh(0.27, 0.2, n) },
    extras: [
      { key: 'horns', mesh: merge(horn(1), horn(-1)), bone: 'head', bias: 0.25, after: ['head', 'ear0', 'ear1'], sheen: 'glint', lines: false },
      { key: 'beard', mesh: beard, bone: 'head', bias: 0.22, after: 'head', lines: false },
    ],
  });
}

/**
 * A stamp of a hoof, nought to one: lifted in a quarter of a second, held up
 * a moment, and struck down in a tenth, at each of `at` (seconds into the
 * loop).
 */
function stamp(t: number, at: readonly number[]): number {
  let s = 0;
  for (const x of at) {
    const u = t - x;
    if (u > 0 && u < 0.65) s = Math.max(s, u < 0.25 ? smooth(u / 0.25) : u < 0.55 ? 1 : 1 - (u - 0.55) / 0.1);
  }
  return s;
}

export const GORRAL: Kind = {
  bones: quadBonesOf({ ...GORRAL_SPEC, tail: { at: [0, -2.0, 0.6], links: 2, len: 0.3, lift: 40, curl: 10, sway: 12 } }, (p, a) => {
    plod(p, a);
    // A goat's bound at a run; and standing, now and then a toss of the horns, the neck drawn back with it, and a stamp -- a fore
    // hoof lifted, held and struck down twice.
    p.lift += a.go * a.gait * 0.4 * Math.max(0, Math.sin((a.u % 1) * TAU));
    const toss = beat(a.t, [7.8, 19.3], 0.7);
    p.head[0] += 28 * toss;
    p.neck[0] -= 8 * toss;
    const st = stamp(a.t, [12.5, 13.3]) * (1 - a.go);
    p.legs[1][0] += 10 * st;
    p.legs[1][1] += 0.8 * st;
    p.legs[1][2] = Math.max(p.legs[1][2], st);
  }),
  build: gorralBuild,
  // A grey gorral a slate's blue-grey, the colour of the cliffs it climbs.
  palette: (coat, mark) => {
    const grey = greyFor(coat, 36, 215);
    return coatPalette(lit(coat, grey), mark, { crystal: [214, 232, 252], crystalDark: [170, 196, 236], spot: [252, 250, 246], hoof: [110, 96, 100] }, grey);
  },
  // A faint light at the tip of each crystal horn.
  glow: (b) => [1, -1].map((sd) => ({ p: place(b.head, gorralHorn(sd, 1)), r: 0.9, c: [200, 228, 255] as RGB, a: 0.3 })),
  shadow: [2.2, 1.2],
  stride: 0.85,
  size: 1.5,
};

/* ---- the shaggan --------------------------------------------------------------------- */

/**
 * A shaggan: a mountain of hair, slower than anything else that pulls and
 * stronger than all of them. The hair is a haystack with wildflowers in it,
 * two little tusks curl out of it, and somewhere under the fringe a pair of
 * eyes looks out.
 */
const SHAGGAN_SPEC: QuadSpec = {
  ...hoofed({ high: 2.6, len: 4.2, legs: 1.5, neck: 0.6, lean: 80, swing: [14, 24], ears: [90, 20], crop: [50, 10, 10] }),
  // The ears on the corners of its big head.
  ears: { at: [0.83, -0.15, 0.52], out: 90, back: 20 },
  // A short tassel of a tail, not a rope out of the hem.
  tail: { at: [0, -2.7, 0.9], links: 1, len: 0.4, lift: -50, curl: 0, sway: 10 },
};
/** Its head: big, and well forward of the heap, so the face is not lost in the hair. */
const SHAGGAN_HEAD = { c: [0, 0.6, 0.0] as V3, r: [1.38, 1.21, 1.15] as V3 };
/** How fast a shaggan shakes itself, in swings a second: slow enough that the island's six stills a second catch each swing. */
const SHAKE_HZ = 1.5;
/** How far into a shake of itself a shaggan is, nought to one and back, twice a loop, and only as it stands with its head up. */
const shagganShake = (a: Anim): number => beat(a.t, [9.3, 20.6], 2.0) * (1 - a.go) * (1 - a.graze);
/** The haystack's ridge along the back: where along it (y), how high (z), and how wide and deep the heap is there. */
const SHAGGAN_RIDGE = { y: [-2.6, -2.0, 0, 2.0, 2.5], z: [0.9, 1.6, 2.05, 1.75, 0.95], w: [0.6, 1.3, 1.6, 1.4, 0.7], h: [0.6, 0.9, 0.9, 0.85, 0.6] };
/** The ridge's height, width or depth `y` along the back, between the points it is given at. */
function ridgeAt(y: number, of: readonly number[]): number {
  const R = SHAGGAN_RIDGE.y;
  for (let i = 0; i < R.length - 1; i++) if (y <= R[i + 1]) return of[i] + ((of[i + 1] - of[i]) * (Math.max(y, R[i]) - R[i])) / (R[i + 1] - R[i]);
  return of[of.length - 1];
}

function shagganBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = SHAGGAN_HEAD;
  const R = SHAGGAN_RIDGE;
  // The haystack: a heap along the back, highest over the middle, and the hair hanging from all along it down to the knees in
  // locks. Each lock is a few strands of widths of their own, drawn together toward the hem so that the locks part there, and
  // each strand ends at a length and a place of its own: hair, and not the ruled boards of a fence.
  const strands: Mesh[] = [];
  const LOCKS = 6, per = lod ? 3 : 2;
  const pale = [false, true, false, false, true, false];
  for (const s of [-1, 1]) {
    for (let l = 0; l < LOCKS; l++) {
      // Where the lock hangs along the back, a little off even and not the same on the two sides.
      const mid = -2.4 + ((l + 0.5) / LOCKS) * 4.8 + 0.12 * Math.sin(l * 1.9 + s * 1.3);
      for (let q = 0; q < per; q++) {
        const o = q - (per - 1) / 2, j = l * 3.1 + q * 1.7 + s * 0.9;
        const y = mid + o * 0.3, top = ridgeAt(y, R.z);
        const wide = 1 + 0.3 * Math.sin(j * 2.3), tip = mid + o * 0.12 + 0.17 * Math.sin(j * 2.9 + 1);
        // Each lock drawn to a point, its middle strand the longest, and every lock of a length of its own.
        const hem = -0.56 - 0.16 * (1 - Math.abs(o)) + 0.12 * Math.sin(l * 2.3 + s) + 0.06 * Math.sin(j * 1.7 + 0.4);
        const flare = 1.95 + 0.12 * Math.sin(j * 1.3);
        strands.push(taper(curve([s * 0.5, y, top - 0.15], [s * 1.8, (y + tip) / 2, 0.9 + 0.5 * (top - 0.9)], [s * flare, tip, hem], 3), 0.44 * wide, 0.16 * wide, 6, pale[(l + (s > 0 ? 0 : 3)) % LOCKS] ? 'coatLight' : 'coat', 0.6, [0, 1, 0]));
      }
    }
  }
  // On the surface of the heap, `x` across it and `y` along it, and `up` over it.
  const onHeap = (x: number, y: number, up: number): V3 => [x, y, ridgeAt(y, R.z) + ridgeAt(y, R.h) * Math.sqrt(Math.max(0, 1 - (x / ridgeAt(y, R.w)) ** 2)) + up];
  const hair = merge(
    tube(R.y.map((y, q) => [0, y, R.z[q]] as V3), R.w, R.h, n, 'coat'),
    ...strands,
    // Clumps heaped along the top, so its back is a haystack's and not a roof's.
    ...([[0.25, -1.45, 0.52], [-0.3, -0.2, 0.6], [0.2, 1.05, 0.5], [-0.15, 2.0, 0.4]] as number[][]).map(([x, y, r], q) => orb(onHeap(x, y, -r * 0.45), [r, r * 1.1, r * 0.8], 7, 4, q % 2 ? 'coatLight' : 'coat')),
    // Wildflowers growing out of it, on top where they show, each turned up and out the way the heap faces there.
    ...([[0.6, -1.2], [-0.45, 0.4], [0.25, 1.4], [-0.2, -1.9], [0.7, 0.5], [-0.7, -0.6]] as number[][]).map(([x, y], q) =>
      flower(onHeap(x, y, 0.26), [x * 0.8, 0, 1], 0.34, lod ? 10 : 6, q % 2 ? 'petal' : 'bloom', q % 2 ? 'bloom' : 'ember')),
  );
  // The hair a moment behind the body: its ends trailing out behind and bouncing at every footfall as it goes, swinging after
  // the body when it shakes itself (`shagganShake`), and stirred by a breeze as it stands. How much a corner moves goes with how
  // far down the hair it is, so the heap itself stays put and the hem swings a quarter of a unit and more.
  const sway = (v: readonly V3[], a: Anim): V3[] => {
    const w = a.u - Math.floor(a.u), go = a.go, still = 1 - go, shake = shagganShake(a);
    const back = go * (0.3 + 0.08 * Math.sin(w * TAU * 2)), bob = go * 0.1 * Math.sin(w * TAU * 2 + 1.2);
    const side = go * 0.1 * Math.sin(w * TAU + 0.8) + still * (0.18 * cyc(a.t, 3) + 0.07 * cyc(a.t, 7, 1)) - 0.34 * shake * Math.sin(a.t * TAU * SHAKE_HZ - 1.2);
    const fwd = still * (0.12 * cyc(a.t, 2, 1) + 0.05 * cyc(a.t, 5));
    return v.map((c) => {
      const f = clamp((1.4 - c[2]) / 2.0);
      return f > 0 ? [c[0] + side * f, c[1] + (fwd - back) * f, c[2] + bob * f] as V3 : c as V3;
    });
  };
  // The fringe over its eyes, lifted enough at its tips for the eyes to look out from under it.
  const fringe = merge(...[-0.6, -0.2, 0.2, 0.6].map((x) => taper(curve([x * 0.92, 0.49, 1.15], [x * 1.15, 1.18, 1.09], [x * 1.27, 1.46, 0.52], 3), 0.3, 0.09, 6, 'coat', 0.6, [0, 1, 0])));
  // A broad muzzle forward and up to the height of the eyes, so side on there is a face ahead of them.
  const muzzle = merge(
    orbAlong([0, 1.75, -0.29], [0, 1, -0.2], [0.83, 0.67, 0.58], n, k, 'muzzle'),
    paint([disc([0.3, 2.3, -0.21], [0.2, 1, 0.2], 0.1, 0.08, 6, 'nose'), disc([-0.3, 2.3, -0.21], [-0.2, 1, 0.2], 0.1, 0.08, 6, 'nose')]),
    smile([0, 2.33, -0.58], [0, 1, -0.3], 0.35),
  );
  // Tusks out of the sides of the muzzle, curling forward and up in front of it.
  const tusk = (s: number): Mesh => taper(curve([s * 0.46, 1.87, -0.71], [s * 0.76, 2.33, -0.83], [s * 0.8, 2.5, -0.25], 3), 0.21, 0.07, 6, 'tooth');
  return quadPieces({
    n, k,
    body: { y: [-2.4, -2.1, -1.2, 0, 1.2, 2.0, 2.4], z: [0.2, 0.3, 0.35, 0.35, 0.35, 0.4, 0.4], w: [0.3, 1.2, 1.4, 1.45, 1.45, 1.3, 0.35], h: [0.3, 0.95, 1.05, 1.1, 1.08, 1.0, 0.35] },
    neck: { w: 0.95, h: 0.95, len: 0.6 },
    head: { c: H.c, r: H.r, face: merge(muzzle, tusk(1), tusk(-1)), eye: { dir: [0.75, 0.6, 0.05], size: 0.345, rim: 0.14 }, blush: [[0.8, 0.5, -0.35], 0.25] },
    ear: earMesh(0.52, 0.34, n),
    // The tassel of a tail: a short root and a brush of three locks fanned out and drawn to points, so from behind and three
    // quarters round it is a tuft of its hair and not a ring.
    tail: [merge(taper([[0, 0, 0], [0, -0.2, -0.04]], 0.2, 0.24, 5, 'coat'), ...[-1, 0, 1].map((q) => taper(curve([q * 0.08, -0.12, -0.02], [q * 0.17, -0.42, -0.08], [q * 0.24, -0.72, -0.04], 2), 0.18, 0.03, 5, q ? 'coat' : 'coatLight')))],
    fore: { upper: [0.35, -0.8, 0.55, 0.5], lower: [0, -0.7, 0.5, 0.48], foot: hoofMesh(0.52, 0.2, n) },
    hind: { upper: [0.35, -0.85, 0.58, 0.52], lower: [0, -0.85, 0.5, 0.48], foot: hoofMesh(0.52, 0.2, n) },
    extras: [
      { key: 'hair', mesh: hair, bone: 'trunk', bias: 0.05, after: ['body', 'fl0', 'fr0', 'hl0', 'hr0', 'fl1', 'fr1', 'hl1', 'hr1'], lines: false, bent: sway },
      { key: 'fringe', mesh: fringe, bone: 'head', bias: 0.26, after: ['head', 'ear0', 'ear1'], lines: false },
    ],
    breath: 0.03,
  });
}

export const SHAGGAN: Kind = {
  bones: quadBonesOf(SHAGGAN_SPEC, (p, a) => {
    plod(p, a);
    // The whole haystack swaying from side to side as it goes; and standing, now and then a shake of itself from end to end, the
    // body rolled and the head wagged with it.
    p.roll += a.go * 3 * Math.sin((a.u % 1) * TAU);
    p.head[2] += 6 * cyc(a.t, 3);
    const shake = shagganShake(a), wag = Math.sin(a.t * TAU * SHAKE_HZ);
    p.roll += 7 * shake * wag;
    p.head[1] += 14 * shake * Math.sin(a.t * TAU * SHAKE_HZ + 0.6);
    p.head[2] -= 8 * shake * wag;
  }),
  build: shagganBuild,
  // A grey haystack a dove's grey, with lilac in it.
  palette: (coat, mark) => {
    const grey = greyFor(coat, 28, 250), c = lit(coat, grey);
    return coatPalette(c, mark, { coatLight: lighter(pastel(c, grey), 0.14), tooth: [250, 244, 226], bloom: [250, 214, 110], petal: [240, 170, 200], ember: [236, 150, 84] }, grey);
  },
  shadow: [3.2, 2.2],
  stride: 0.55,
  size: 1.72,
};

/* ---- the snedda ---------------------------------------------------------------------- */

/**
 * A snedda: a long-necked browser of the wood's edge that crops the new
 * leaves off anything it can reach. Two twig antlers grow from its head with
 * new leaves on them, its ears are leaves, and bark rings its legs.
 */
const SNEDDA_SPEC: QuadSpec = {
  ...hoofed({ high: 2.8, len: 2.9, legs: 2.4, neck: 2.4, lean: 22, swing: [20, 36], ears: [30, 10], crop: [100, 8, 16] }),
  // The neck from high on the chest, so the whole length of it shows.
  neck: { at: [0, 1.6, 0.6], len: 2.4, lean: 22 },
  // The leaf ears up on the crown, where they frame the antlers, rather than on the cheeks: splayed only a little, so that side
  // on the near one is not pointed at the viewer.
  ears: { at: [0.7, -0.15, 0.65], out: 30, back: 10 },
};
const SNEDDA_HEAD = { c: [0, 0.45, 0.12] as V3, r: [0.92, 1.04, 0.83] as V3 };

function sneddaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = SNEDDA_HEAD;
  // A soft muzzle out in front of the eyes, so side on there is a face ahead of the eye: a ball with its poles up and down, so
  // that pale as it is, its steps of light are bands round it -- a lit top and a shaded chin -- and not a crumple of facets
  // meeting at a point on the end of the nose.
  const muzzle = merge(
    orb([0, 1.3, -0.18], [0.5, 0.44, 0.6], n + 2, k, 'muzzle'),
    paint([disc([0.18, 1.72, -0.18], [0.2, 1, 0.1], 0.07, 0.05, 6, 'nose'), disc([-0.18, 1.72, -0.18], [-0.2, 1, 0.1], 0.07, 0.05, 6, 'nose')]),
    smile([0, 1.68, -0.46], [0, 1, -0.3], 0.24),
  );
  // Each antler a forked twig standing well up and out over the head -- the beam forward at its tip and a tine swept back off
  // it, so side on the pair is a spread of branches and not one sprig -- with new leaves on each point, the brightest green it
  // has: three together at the tip of the beam and two on the tine.
  const leaf = (at: V3, dir: V3): Mesh => orbAlong(add(at, scale(unit(dir), 0.26)), dir, [0.24, 0.08, 0.3], 6, 3, 'leaf');
  const antler = (s: number): Mesh => {
    const tip: V3 = [s * 1.15, 0.3, 1.9], tine: V3 = [s * 0.85, -0.7, 1.7];
    return merge(
      taper(curve([s * 0.32, 0.15, 0.7], [s * 0.7, 0.2, 1.35], tip, 3), 0.13, 0.06, 5, 'bark'),
      taper(curve([s * 0.55, 0.12, 1.15], [s * 0.75, -0.3, 1.35], tine, 2), 0.08, 0.045, 5, 'bark'),
      ...([[s * 0.3, 0.1, 1], [s * 1, 0.5, 0.3], [-s * 0.1, 0.6, 0.7]] as V3[]).map((d) => leaf(tip, d)),
      ...([[s * 0.3, -0.6, 1], [s * 0.5, -1, 0.2]] as V3[]).map((d) => leaf(tine, d)),
    );
  };
  // Bark round the lower legs in three rings, painted all the way round in overlapping pieces, so from every side it is a band
  // of bark and not a row of stitches.
  const bark = (zs: number[]): Mesh => paint(zs.flatMap((z) => Array.from({ length: 6 }, (_, q): V3 => [Math.cos((q * TAU) / 6), Math.sin((q * TAU) / 6), 0]).map((d) => disc([d[0] * 0.25, d[1] * 0.25 + 0.01, z], d, 0.15, 0.05, 6, 'bark'))));
  const rings = (['fl', 'fr', 'hl', 'hr'] as const).map((leg): Piece => ({
    key: `bark${leg}`, mesh: bark(leg[0] === 'f' ? [-0.25, -0.55, -0.85] : [-0.3, -0.65, -1.0]), bone: `${leg}1`, bias: 0.025, after: `${leg}1`,
    front: [leg[1] === 'l' ? -0.7 : 0.7, leg[0] === 'f' ? 0.7 : -0.7, 0],
  }));
  return quadPieces({
    n, k,
    // Round at the rump and the chest rather than cut square.
    body: { y: [-2.05, -1.9, -1.65, -0.8, 0, 0.9, 1.55, 1.8, 1.95], z: [0.3, 0.25, 0.25, 0.3, 0.28, 0.35, 0.45, 0.48, 0.5], w: [0.25, 0.65, 0.85, 1.0, 1.0, 1.05, 0.92, 0.7, 0.25], h: [0.25, 0.62, 0.85, 0.95, 0.92, 1.0, 0.92, 0.7, 0.28], belly: true },
    neck: { w: 0.52, h: 0.56, len: 2.4 },
    head: { c: H.c, r: H.r, face: muzzle, eye: { dir: [0.8, 0.5, 0.24], size: 0.32, rim: 0.12 }, blush: [[0.8, 0.45, -0.3], 0.2] },
    ear: earMesh(0.66, 0.33, n, { mat: 'leaf' }),
    // Turned well out, a leaf's face to the side rather than its edge.
    earTurn: 55,
    tail: [taper([[0, 0, 0], [0, -0.3, 0]], 0.1, 0.08, 5, 'coat'), merge(taper([[0, 0, 0], [0, -0.2, 0]], 0.08, 0.06, 5, 'coat'), orbAlong([0, -0.35, 0], [0, -1, 0], [0.14, 0.14, 0.2], 6, 3, 'mark'))],
    fore: { upper: [0.3, -1.25, 0.36, 0.27], lower: [0, -1.15, 0.25, 0.22], foot: hoofMesh(0.26, 0.2, n) },
    hind: { upper: [0.3, -1.3, 0.42, 0.28], lower: [0, -1.3, 0.25, 0.22], foot: hoofMesh(0.26, 0.2, n) },
    extras: [{ key: 'antlers', mesh: merge(antler(1), antler(-1)), bone: 'head', bias: 0.25, after: ['head', 'ear0', 'ear1'] }, ...rings],
  });
}

export const SNEDDA: Kind = {
  bones: quadBonesOf(SNEDDA_SPEC, (p, a) => {
    plod(p, a);
    // Browsing, standing with its head up: the long neck swaying, reaching up now and then to nip at something over its head.
    if (a.go <= 0) {
      const up = 1 - a.graze, reach = beat(a.t, [4.2, 15.5], 2.5) * up;
      p.neck[0] -= 25 * reach;
      p.head[0] += 25 * reach;
      p.neck[1] += 10 * cyc(a.t, 2) * up;
    }
  }),
  build: sneddaBuild,
  palette: (coat, mark) => coatPalette(lit(coat, 60), mark, { leaf: [176, 226, 120], bark: [150, 112, 86], inner: [238, 180, 170] }, 60),
  shadow: [2.2, 1.2],
  stride: 0.8,
  size: 1.3,
};

/* ---- the sappa ----------------------------------------------------------------------- */

/**
 * A sappa: a moss-backed browser of the deep woods that buries more seed
 * than it eats and forgets where. A sapling is growing out of the moss on its
 * back, with toadstools round its foot, and its nose is long and soft.
 */
const SAPPA_SPEC: QuadSpec = {
  ...hoofed({ high: 2.1, len: 3.0, legs: 1.4, neck: 0.7, lean: 60, swing: [20, 34], ears: [70, 15], crop: [60, 8, 16] }),
  // The ears up on the crown rather than on the cheeks.
  ears: { at: [0.66, -0.15, 0.65], out: 70, back: 15 },
};
const SAPPA_HEAD = { c: [0, 0.45, 0.05] as V3, r: [0.95, 0.92, 0.82] as V3 };
/** Where the sapling stands up out of the moss, in the trunk's frame: what it sways about. */
const SAPLING_FOOT: V3 = [0, -0.3, 1.1];

function sappaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = SAPPA_HEAD;
  // The long soft nose, the colour of its coat, its bridge a little over the height of the eyes so side on there is a face ahead
  // of them even with the head turned half away or down at the ground, curving down to a blunt pink end; and the mouth under it.
  const nose = merge(
    taper(curve([0, 0.8, 0.14], [0, 1.45, 0.12], [0, 1.78, -0.5], 3), 0.34, 0.24, n, 'coat'),
    orbAlong([0, 1.8, -0.58], [0, 0.4, -1], [0.22, 0.22, 0.2], n, 3, 'nose'),
    smile([0, 1.15, -0.6], [0, 1, -0.4], 0.24),
  );
  // The moss on its back, and two toadstools growing in it.
  const moss = merge(
    orb([0, -0.2, 0.85], [1.0, 1.6, 0.42], n + 1, k, 'moss'),
    orb([0.4, 0.8, 0.8], [0.55, 0.6, 0.3], n, k, 'moss'),
    orb([-0.45, -1.2, 0.75], [0.55, 0.6, 0.3], n, k, 'moss'),
    ...([[0.5, 0.3, 1.05], [-0.5, -0.8, 1.02]] as V3[]).map((c) => merge(taper([c, add(c, [0, 0, 0.2])], 0.06, 0.05, 5, 'spot'), orbAlong(add(c, [0, 0, 0.22]), [0, 0, 1], [0.18, 0.18, 0.1], 6, 3, 'cap'))),
  );
  // The sapling: a thin trunk and a round crown of leaves.
  const sapling = merge(
    taper(curve(SAPLING_FOOT, [0.1, -0.35, 1.8], [0.05, -0.3, 2.5], 3), 0.1, 0.06, 6, 'bark'),
    orb([0.05, -0.3, 2.75], [0.55, 0.55, 0.45], n, k, 'leaf'),
    orb([0.3, -0.1, 2.55], [0.32, 0.32, 0.28], n, k, 'leafDark'),
    orb([-0.25, -0.5, 2.6], [0.3, 0.3, 0.26], n, k, 'leafDark'),
  );
  // It sways from its foot: slowly to and fro and side to side as the sappa stands, and at a trot a moment behind the rock of the
  // back, so it nods after each stride rather than with it.
  const sway = (v: readonly V3[], a: Anim): V3[] => {
    const w = a.u - Math.floor(a.u), still = 1 - a.go;
    const fore = (still * 4 * cyc(a.t, 8) + a.go * a.gait * 6 * Math.sin(w * TAU - 1.2)) * (Math.PI / 180);
    const side = (still * 3 * cyc(a.t, 6, 1) + a.go * 2.5 * Math.sin(w * TAU - 0.8)) * (Math.PI / 180);
    const cf = Math.cos(fore), sf = Math.sin(fore), cs = Math.cos(side), ss = Math.sin(side);
    const [bx, by, bz] = SAPLING_FOOT;
    return v.map((p) => {
      const x = p[0] - bx, y = p[1] - by, z = p[2] - bz;
      const y1 = y * cf - z * sf, z1 = y * sf + z * cf;
      return [bx + x * cs + z1 * ss, by + y1, bz - x * ss + z1 * cs] as V3;
    });
  };
  return quadPieces({
    n, k,
    // Round at the rump and the chest rather than cut square.
    body: { y: [-2.1, -1.95, -1.7, -0.9, 0, 0.9, 1.6, 1.82, 1.95], z: [0.3, 0.25, 0.25, 0.3, 0.3, 0.3, 0.35, 0.35, 0.35], w: [0.25, 0.7, 0.95, 1.15, 1.2, 1.15, 1.0, 0.75, 0.3], h: [0.25, 0.6, 0.8, 0.92, 0.95, 0.9, 0.82, 0.62, 0.28], belly: true },
    neck: { w: 0.7, h: 0.68, len: 0.7 },
    head: { c: H.c, r: H.r, face: nose, eye: { dir: [0.8, 0.5, 0.25], size: 0.32, rim: 0.12 }, blush: [[0.8, 0.45, -0.3], 0.2] },
    ear: earMesh(0.5, 0.3, n),
    tail: [taper([[0, 0, 0], [0, -0.25, 0]], 0.14, 0.06, 5, 'coat')],
    fore: { upper: [0.3, -0.75, 0.34, 0.26], lower: [0, -0.65, 0.24, 0.22], foot: hoofMesh(0.26, 0.18, n) },
    hind: { upper: [0.3, -0.8, 0.4, 0.28], lower: [0, -0.75, 0.24, 0.22], foot: hoofMesh(0.26, 0.18, n) },
    extras: [
      { key: 'moss', mesh: moss, bone: 'trunk', bias: 0.03, after: 'body', lines: false },
      { key: 'sapling', mesh: sapling, bone: 'trunk', bias: 0.06, after: ['body', 'moss'], bent: sway },
    ],
  });
}

export const SAPPA: Kind = {
  bones: quadBonesOf(SAPPA_SPEC, (p, a) => {
    plod(p, a);
    // Standing, now and then its nose right down to the ground to snuffle, and then a look round with the soft nose up.
    if (a.go <= 0) {
      const snuffle = beat(a.t, [2.2, 9.9, 16.4], 2.0) * (1 - a.graze);
      p.neck[0] += 30 * snuffle;
      p.head[0] -= 15 * snuffle;
    }
  }),
  build: sappaBuild,
  // A moss deeper than the grass it walks on, so the back is not the pasture seen through it.
  palette: (coat, mark) => coatPalette(lit(coat, 40), mark, { moss: [104, 158, 78], leaf: [150, 206, 110], leafDark: [110, 170, 90], bark: [140, 104, 82], cap: [220, 110, 100], spot: [250, 244, 232], nose: [200, 130, 140] }, 40),
  shadow: [2.3, 1.5],
  stride: 0.85,
  size: 1.55,
};
