import { blush, clamp, curve, disc, eyes, merge, mirrored, moved, orb, orbAlong, paint, smooth, tube, type Piece } from './beasts';
import { mesh, type Face, type Mat, type Mesh, type V3 } from './figure';

/**
 * What the wildermon (`./wildermon`) are built from, over and above the
 * shapes in `./beasts`: a leg's pieces, an ordinary body on four legs from a
 * description of it, a hoof, a paw, an ear, a bird's leg.
 */

/* ---- pieces most of them have ---------------------------------------------------- */

/** How finely a kind is cut: coarser at the sizes the island is played at, finer drawn big. */
export const cut = (lod: number, far: number, near: number): number => (lod ? near : far);

/** Whether facet `j` of `n` round a tube is on its underside, within `spread` radians of straight down. */
export const under = (n: number, j: number, spread = 0.95): boolean => Math.abs(((j + 0.5) / n) * Math.PI * 2 - Math.PI * 1.5) < spread;

export const clamp01 = (x: number): number => clamp(x);
export const smooth01 = (x: number): number => smooth(x);

/**
 * A leg's pieces on its three bones: the upper and the lower as tubes down
 * each bone, and the foot as the kind makes it. The upper goes under the
 * body from every side, so the body hides as much of it as is up inside the
 * body and it comes out from under the belly, rather than standing on the
 * flank as a peg; `front` puts the lower leg and the foot of a near leg over
 * the body and a far one's under it.
 */
export function legPieces(key: string, fore: boolean, side: number, upper: V3[], upperW: number[], lower: V3[], lowerW: number[], foot: ReturnType<typeof tube>, n: number, mat: Parameters<typeof tube>[4] = 'coat'): Piece[] {
  const front: V3 = [side * 0.7, fore ? 0.7 : -0.7, 0];
  // The lower leg started a little up inside the upper, so a knee bent is still closed where the two meet.
  const d = [lower[1][0] - lower[0][0], lower[1][1] - lower[0][1], lower[1][2] - lower[0][2]];
  const dl = Math.hypot(d[0], d[1], d[2]) || 1, lap = lowerW[0] * 0.8;
  const into: V3[] = [[lower[0][0] - (d[0] / dl) * lap, lower[0][1] - (d[1] / dl) * lap, lower[0][2] - (d[2] / dl) * lap], ...lower.slice(1)];
  // No ink across a knee or where the leg goes into the body: a leg is one thing, not links.
  return [
    { key: `${key}0`, mesh: tube(upper, upperW, upperW, n, mat, { seam: 'both' }), bone: `${key}0`, bias: 0.01, under: 'body', convex: true },
    { key: `${key}1`, mesh: tube(into, lowerW, lowerW, n, mat, { seam: 'both' }), bone: `${key}1`, bias: 0.02, after: 'body', front, convex: true },
    { key: `${key}2`, mesh: foot, bone: `${key}2`, bias: 0.03, after: 'body', front },
  ];
}

/**
 * The pieces of an ordinary body on four legs, from a description of it: a
 * trunk of rings on the `trunk` bone, a neck, a head with its face on it,
 * ears, a tail in links, and legs whose tops go up into the body. What makes
 * a kind itself goes in `extras`.
 */
export interface QuadLook {
  n: number;
  k: number;
  /** The trunk's rings along it: where each is (y, z), how wide and how deep; and whether its underside is the marking colour. */
  body: { y: number[]; z: number[]; w: number[]; h: number[]; belly?: boolean; mat?: Mat };
  neck: { w: number; h: number; len: number; mat?: Mat };
  /** The head's egg, what else makes the face (a muzzle, a snout), and the eyes on it: the way out to the right one, and their size. */
  head: { c: V3; r: V3; mat?: Mat; face?: Mesh; eye: { dir: V3; size: number; iris?: Mat; pupil?: number; rim?: number; tall?: number }; blush?: [V3, number] };
  /** An ear, built upright in its own bone's frame facing forward; the left one is its mirror. */
  ear?: Mesh;
  /** How far each ear is turned out from facing forward, in degrees, so it shows its face side on rather than its edge. */
  earTurn?: number;
  /** Each link of the tail, built pointing back along -y in its own bone's frame. */
  tail?: Mesh[];
  /** The legs: each part's line and width, down the bone from its joint, and a foot. */
  fore: { upper: [number, number, number, number]; lower: [number, number, number, number]; foot: Mesh; mat?: Mat };
  hind: { upper: [number, number, number, number]; lower: [number, number, number, number]; foot: Mesh; mat?: Mat };
  extras?: Piece[];
  /** How much its body swells as it breathes. */
  breath?: number;
}

export function quadPieces(o: QuadLook): Piece[] {
  const { n, k } = o;
  const B = o.body;
  const body = tube(B.y.map((y, q) => [0, y, B.z[q]] as V3), B.w, B.h, n,
    (ring, j) => (B.belly && ring > 0 && ring < B.y.length - 1 && under(n, j) ? 'mark' : B.mat ?? 'coat'));
  const H = o.head;
  const eyeOf = (shut: boolean): Mesh => eyes(H.c, H.r, H.eye.dir, H.eye.size, { shut, iris: H.eye.iris, pupil: H.eye.pupil, rim: H.eye.rim ?? 0.1, tall: H.eye.tall ?? 1.12 });
  const face = merge(orb(H.c, H.r, n + 1, k + 1, H.mat ?? 'coat'), H.face, H.blush && blush(H.c, H.r, H.blush[0], H.blush[1]));
  const hide = [{ c: H.c, r: H.r }];
  const pieces: Piece[] = [
    { key: 'body', mesh: body, bone: 'trunk', bias: 0, breathes: { c: [0, 0, 0], k: o.breath ?? 0.05 } },
    { key: 'neck', mesh: tube([[0, 0, -0.3], [0, 0, o.neck.len * 0.5], [0, 0.05, o.neck.len]], o.neck.w, o.neck.h, n, o.neck.mat ?? 'coat', { seam: 'both' }), bone: 'neck', bias: 0, under: 'head', convex: true },
    { key: 'head', mesh: merge(face, eyeOf(false)), shut: merge(face, eyeOf(true)), bone: 'head', bias: 0.2 },
  ];
  if (o.ear) {
    const ear = moved(o.ear, [0, 0, 0], -(o.earTurn ?? 35));
    pieces.push(
      { key: 'ear0', mesh: mirrored(ear), bone: 'ear0', bias: 0.21, after: 'head', hide, hideIn: 'head' },
      { key: 'ear1', mesh: ear, bone: 'ear1', bias: 0.21, after: 'head', hide, hideIn: 'head' },
    );
  }
  (o.tail ?? []).forEach((m, q) => pieces.push({ key: `tail${q}`, mesh: m, bone: `tail${q}`, bias: -0.05 + q * 0.01, chain: 'tail' }));
  for (const [key, side, fore] of [['fl', -1, true], ['fr', 1, true], ['hl', -1, false], ['hr', 1, false]] as Array<[string, number, boolean]>) {
    const L = fore ? o.fore : o.hind;
    pieces.push(...legPieces(key, fore, side, [[0, 0, L.upper[0]], [0, 0, L.upper[1]]], [L.upper[2], L.upper[3]], [[0, 0, L.lower[0]], [0, 0.02, L.lower[1]]], [L.lower[2], L.lower[3]], side < 0 ? mirrored(L.foot) : L.foot, n, L.mat ?? 'coat'));
  }
  return [...pieces, ...(o.extras ?? [])];
}

/** A hoof: a squat cylinder a little wider at the ground, dark. */
export const hoofMesh = (r: number, h: number, n: number, mat: Mat = 'hoof'): Mesh => tube([[0, 0.02, 0.06], [0, 0.04, -h]], [r * 0.92, r], [r * 0.92, r * 1.05], n, mat, { seam: 'start' });
/**
 * A soft round paw, a mitten, a little forward of the leg: `r` across, half
 * again as long, and flatter than it is wide, with its sole at `drop` under
 * the ankle, which is where the leg's spec puts the ground (`LegSpec.len`).
 */
export const pawMesh = (r: number, n: number, k: number, mat: Mat = 'coat', drop = 0.14): Mesh =>
  orbAlong([0, r * 0.35, -drop + r * 0.53], [0, 1, 0], [r, r * 0.62, r * 1.3], n, k, mat);
/** An ear: a rounded leaf-shape, flat, pink inside. */
export const earMesh = (len: number, w: number, n: number, o: { mat?: Mat; point?: boolean; tilt?: number } = {}): Mesh => merge(
  tube(curve([0, 0, 0], [0, 0.04, len * 0.5], [0, -0.04 + (o.tilt ?? 0), len], 4), o.point ? [w * 0.8, w, w * 0.8, w * 0.45, 0.02] : [w * 0.75, w, w, w * 0.75, w * 0.25], w * 0.28, n, o.mat ?? 'coat', { up: [0, 1, 0], seam: 'start' }),
  paint([disc([0, w * 0.3, len * 0.45], [0, 1, 0.1], w * 0.52, len * 0.3, 7, 'inner')]),
);

/* ---- a bird's legs ---------------------------------------------------------------- */

/** A bird's leg: the thigh lost in the body, a thin shank, and three toes forward and one back. */
export function birdLegPieces(key: string, side: number, shank: number, w: number, n: number, mat: Parameters<typeof tube>[4] = 'claw'): Piece[] {
  const toes = merge(
    ...[-28, 0, 28].map((yaw) => moved(tube([[0, 0, 0], [0, 0.34, -0.04], [0, 0.46, -0.08]], [w * 0.9, w * 0.7, w * 0.3], [w * 0.7, w * 0.6, w * 0.3], 5, mat), [0, 0, 0], yaw)),
    tube([[0, 0, 0], [0, -0.22, -0.06]], [w * 0.8, w * 0.3], [w * 0.6, w * 0.3], 5, mat),
  );
  const front: V3 = [side, 0.2, 0];
  return [
    { key: `${key}1`, mesh: tube([[0, 0, 0.05], [0, 0, -shank]], [w * 1.1, w], [w * 1.1, w], n, mat), bone: `${key}1`, bias: 0.02, after: 'body', front, convex: true, thin: true },
    { key: `${key}2`, mesh: moved(toes, [0, 0, -0.06]), bone: `${key}2`, bias: 0.03, after: 'body', front, thin: true },
  ];
}

/* ---- a blade: a leaf, a petal, a fin ---------------------------------------------- */

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** `v` turned about the unit axis `d` by `a` radians. */
const turned = (v: V3, d: V3, a: number): V3 => add3(add3(mul3(v, Math.cos(a)), mul3(cross3(d, v), Math.sin(a))), mul3(d, dot3(d, v) * (1 - Math.cos(a))));

/**
 * A blade along a line of points, `widths` across it (half-widths) at each:
 * a thin solid, its face turned along `face` at the root and twisted about
 * the line by `twist` radians by the tip, its edges lifted by `fold` of its
 * width so it is a shallow V along its middle, which is a darker rib. A flat
 * thing never seen edge on from above: a leaf, a petal, a fin.
 */
export function blade(pts: readonly V3[], widths: readonly number[], face: V3, o: { twist?: number; fold?: number; thick?: number; mat?: Mat; rib?: Mat } = {}): Mesh {
  const K = pts.length, mat = o.mat ?? 'leaf', rib = o.rib ?? mat, th = o.thick ?? 0.035;
  const v: V3[] = [];
  const f: Face[] = [];
  const want: V3[] = [];
  const push = (i: number[], m: Mat, w: V3): void => { f.push({ i, m }); want.push(w); };
  const ns: V3[] = [], ds: V3[] = [], sides: V3[] = [];
  for (let k = 0; k < K; k++) {
    const d = unit3(sub3(pts[Math.min(K - 1, k + 1)], pts[Math.max(0, k - 1)]));
    const n = turned(unit3(sub3(face, mul3(d, dot3(face, d)))), d, ((o.twist ?? 0) * k) / Math.max(1, K - 1));
    const side = unit3(cross3(d, n));
    const w = widths[Math.min(k, widths.length - 1)], lift = (o.fold ?? 0.22) * w, r = Math.min(w * 0.3, 0.035);
    const top: V3[] = [add3(add3(pts[k], mul3(side, -w)), mul3(n, lift)), add3(pts[k], mul3(side, -r)), add3(pts[k], mul3(side, r)), add3(add3(pts[k], mul3(side, w)), mul3(n, lift))];
    for (const q of top) v.push(q);
    for (const q of top) v.push(add3(q, mul3(n, -th)));
    ns.push(n); ds.push(d); sides.push(side);
  }
  for (let k = 0; k < K - 1; k++) {
    const A = k * 8, B = (k + 1) * 8;
    const n = unit3(add3(ns[k], ns[k + 1])), side = unit3(add3(sides[k], sides[k + 1]));
    for (let j = 0; j < 3; j++) push([A + j, A + j + 1, B + j + 1, B + j], j === 1 ? rib : mat, n);
    for (let j = 0; j < 3; j++) push([A + 4 + j, A + 5 + j, B + 5 + j, B + 4 + j], mat, mul3(n, -1));
    push([A, B, B + 4, A + 4], mat, mul3(side, -1));
    push([A + 3, B + 3, B + 7, A + 7], mat, side);
  }
  const E = (K - 1) * 8;
  push([0, 1, 2, 3, 7, 6, 5, 4], mat, mul3(ds[0], -1));
  push([E, E + 1, E + 2, E + 3, E + 7, E + 6, E + 5, E + 4], mat, ds[K - 1]);
  // Each face wound so it faces out, whichever way round it was listed.
  f.forEach((face, q) => {
    const idx = face.i;
    let nx = 0, ny = 0, nz = 0;
    for (let a = 0; a < idx.length; a++) {
      const p = v[idx[a]], r = v[idx[(a + 1) % idx.length]];
      nx += (p[1] - r[1]) * (p[2] + r[2]);
      ny += (p[2] - r[2]) * (p[0] + r[0]);
      nz += (p[0] - r[0]) * (p[1] + r[1]);
    }
    if (nx * want[q][0] + ny * want[q][1] + nz * want[q][2] < 0) idx.reverse();
  });
  return mesh(v, f);
}
