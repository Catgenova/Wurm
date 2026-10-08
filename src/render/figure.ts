import { HOPS, emotePose } from '../game/emotes';
import {
  BUILDS, DEFAULT_LOOK, eyeColour, hairColour, shirtColour, skinColour, trouserColour, type Look,
} from '../game/look';
import { HALF_H, HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from './iso';
import { rarityOf } from '../game/items';

/**
 * People, as low-poly bodies.
 *
 * A body was a stack of flat rectangles with a ball for a head, one drawing
 * mirrored and squeezed to fake the eight ways round. It is a model now: a
 * rig of nineteen bones -- pelvis, spine, chest, neck, head, and a shoulder,
 * elbow, wrist, hip, knee and ankle each side -- with a faceted mesh on each,
 * posed every frame and drawn through the same projection as the ground it
 * stands on. So turning round is turning round: the face goes out of sight,
 * the back of the head comes into it, and a ponytail swings behind whichever
 * way the body is pointed.
 *
 * Low-poly on purpose, and drawn the way the rest of the island is: every
 * facet a flat colour in the light from over the viewer's left shoulder, the
 * whole inked round its outside in a dark shade of each thing's own colour,
 * and a thinner line wherever one part of the body crosses in front of
 * another, so an arm swung across the chest is still an arm.
 *
 * Units are tenths of a metre, as everywhere else that stands on the ground:
 * `x` to the body's right, `y` the way it faces, `z` up, from the ground
 * between its feet.
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export type V3 = [number, number, number];
export type RGB = [number, number, number];
export type Pt = [number, number];

/* ---- colour ---------------------------------------------------------------- */

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as RGB;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, k = 1, a = 1): string =>
  `rgba(${Math.max(0, Math.min(255, Math.round(c[0] * k)))}, ${Math.max(0, Math.min(255, Math.round(c[1] * k)))}, ${Math.max(0, Math.min(255, Math.round(c[2] * k)))}, ${a})`;
const INK: RGB = [40, 28, 26];

/* ---- turns ------------------------------------------------------------------ */

type M3 = number[];
const mm = (a: M3, b: M3): M3 => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
const mv = (m: M3, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
/** Pitch about x: a limb hanging down swings forward. */
const rx = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
/** Roll about y: a limb hanging down swings to the left. */
const ry = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
/** Yaw about z: the front turns to the left. */
const rz = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

/** A bone's frame: its turn, and where its joint is. */
export interface Xf { m: M3; t: V3 }
export const ROOT: Xf = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
/** A joint `at` in its parent's frame, turned by pitch, then roll, then yaw, in degrees. */
export function joint(p: Xf, at: V3, pitch = 0, roll = 0, yaw = 0): Xf {
  const r = mm(rz(yaw * DEG), mm(ry(roll * DEG), rx(pitch * DEG)));
  const o = mv(p.m, at);
  return { m: mm(p.m, r), t: [o[0] + p.t[0], o[1] + p.t[1], o[2] + p.t[2]] };
}
export const place = (x: Xf, v: V3): V3 => { const o = mv(x.m, v); return [o[0] + x.t[0], o[1] + x.t[1], o[2] + x.t[2]]; };
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const middle = (ps: V3[]): V3 => { const c: V3 = [0, 0, 0]; for (const p of ps) { c[0] += p[0] / ps.length; c[1] += p[1] / ps.length; c[2] += p[2] / ps.length; } return c; };

/* ---- meshes ----------------------------------------------------------------- */

/** What a facet is made of, looked up per body when it is drawn. */
type BodyMat = 'skin' | 'lip' | 'hair' | 'brow' | 'edge' | 'eye' | 'white' | 'glint' | 'tunic' | 'trim' | 'trousers' | 'boot' | 'cuff' | 'sole' | 'belt' | 'buckle' | 'stubble' | 'shaved' | 'rein' | 'haft' | 'iron';
/**
 * And what a piece of gear is made of, looked up in the piece's own palette
 * (`gearPalette` in `./gear`): the same names on every piece, each piece its
 * own metal, wood, leather and dye.
 */
export type GearMat = 'metal' | 'metalDark' | 'metalLit' | 'mail' | 'scale' | 'scaleDark' | 'leather' | 'leatherDark' | 'leatherLit' | 'lace'
  | 'cloth' | 'clothDark' | 'lining' | 'wood' | 'woodDark' | 'grip' | 'blade' | 'fitting' | 'gem' | 'string' | 'fletch' | 'rivet'
  // A circlet's three settings, each its stone or, while it is empty, its gold.
  | 'stone1' | 'stone2' | 'stone3';
/**
 * And what a wildermon is made of (`./beasts`), looked up in its own
 * palette: its coat and its markings, the colours of its variant, and the
 * things of its kind -- a horn, a hoof, a leaf growing out of its back.
 */
export type BeastMat = 'coat' | 'coatDark' | 'coatLight' | 'mark' | 'belly' | 'muzzle' | 'nose' | 'inner' | 'eyeWhite' | 'lid'
  | 'claw' | 'pad' | 'horn' | 'hornDark' | 'membrane' | 'hoof' | 'tooth' | 'tongue' | 'leaf' | 'leafDark' | 'stem' | 'petal' | 'bloom' | 'moss' | 'bark'
  | 'stone' | 'stoneDark' | 'crystal' | 'crystalDark' | 'ember' | 'flame' | 'shell' | 'shellDark' | 'feather' | 'featherDark'
  | 'bill' | 'billDark' | 'water' | 'cap' | 'spot';
export type Mat = BodyMat | GearMat | BeastMat;
/**
 * Worked into a facet's surface, in its own shade, where it is drawn big
 * enough to read: the rows of a mail shirt, the courses of scale, the channels
 * of a quilted coat, the lames of plate, the grain of a board.
 */
export type Pattern = 'mail' | 'scale' | 'quilt' | 'lames' | 'grain' | 'studs';

export interface Face {
  /** Corners, anticlockwise seen from outside. */
  i: number[];
  m: Mat;
  /** Painted on the face under it rather than a surface of its own: no outline, and drawn after the rest of its part. */
  decal?: boolean;
  /** A decal lit as a glint is, whichever way it is turned to the light: the gold of a ring too small to have a lit side of its own. */
  lit?: boolean;
  /** Part of a surface rather than an edge of one: its open rim is not inked. A nose is not outlined where it meets the face. */
  soft?: boolean;
  /**
   * Where one piece of the body goes into another, and no edge of either: no
   * line along any edge of it, however it is turned. The top of a sleeve,
   * which is the shoulder of the tunic it is sewn into, turns out to the side
   * when the arm is swung up or back, and would otherwise be outlined on the
   * chest; and the ends of the cuff, with the forearm in it, turn to face
   * the viewer as the arm swings back, and would be a ring round the elbow.
   */
  seam?: boolean;
  /**
   * How wide the thing it is part of is, when that is narrow: inked only
   * where it is drawn at least twice as wide as the lines along it and four
   * pixels across. The fingers of an open hand, lined in lines as wide as
   * they are, are a mitten.
   */
  fine?: number;
  /** Only while this way, in the mesh's own frame, is not toward the viewer: an eye seen side on, drawn only when the face is not. */
  unless?: V3;
  /** The point, in the mesh's own frame, whose being out of sight behind a solid hides this facet: one for all a curl's facets, so it goes or stays whole. */
  at?: V3;
  /** Worked into its surface where it is drawn big enough: see `Pattern`. */
  pat?: Pattern;
}

export interface Mesh {
  v: V3[];
  f: Face[];
  /** Every edge between two surfaces, or on the rim of one: [a, b, face, other face or -1]. */
  e: Array<[number, number, number, number]>;
}

export function mesh(v: V3[], f: Face[]): Mesh {
  const at = new Map<string, [number, number, number, number]>();
  f.forEach((face, fi) => {
    if (face.decal) return;
    const n = face.i.length;
    for (let k = 0; k < n; k++) {
      const a = face.i[k], b = face.i[(k + 1) % n];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const had = at.get(key);
      if (had) had[3] = fi;
      else at.set(key, [a, b, fi, -1]);
    }
  });
  return { v, f, e: [...at.values()] };
}

/** Put two meshes together as one part. */
function join(...ms: Mesh[]): Mesh {
  const v: V3[] = [], f: Face[] = [];
  for (const m of ms) {
    const base = v.length;
    v.push(...m.v);
    for (const face of m.f) f.push({ ...face, i: face.i.map((i) => i + base) });
  }
  return mesh(v, f);
}

/**
 * Rings round the z axis, bottom to top, each `[z, rx, ry, cx, cy]`, `n`
 * round and starting half a step round from the right so that one flat
 * facet looks straight ahead. Closed at either end unless told otherwise;
 * `mat` may be a function of the band and the facet, for a sleeve or a sole.
 */
function rings(rs: number[][], n: number, mat: Mat | ((band: number, j: number) => Mat), caps: { top?: boolean; bottom?: boolean } = {}): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  const m = (b: number, j: number): Mat => (typeof mat === 'function' ? mat(b, j) : mat);
  rs.forEach(([z, rxx, ryy, cx = 0, cy = 0]) => {
    for (let j = 0; j < n; j++) {
      const a = ((j + 0.5) / n) * TAU;
      v.push([cx + Math.cos(a) * rxx, cy + Math.sin(a) * ryy, z]);
    }
  });
  for (let k = 0; k < rs.length - 1; k++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      f.push({ i: [k * n + j, k * n + j2, (k + 1) * n + j2, (k + 1) * n + j], m: m(k, j) });
    }
  }
  if (caps.bottom !== false) f.push({ i: Array.from({ length: n }, (_, j) => n - 1 - j), m: m(-1, 0) });
  if (caps.top !== false) {
    const last = (rs.length - 1) * n;
    f.push({ i: Array.from({ length: n }, (_, j) => last + j), m: m(rs.length - 1, 0) });
  }
  return mesh(v, f);
}

/** A low-poly ball: `n` round and `k` bands from pole to pole. */
export function ball(c: V3, r: V3, n: number, k: number, mat: Mat): Mesh {
  const v: V3[] = [[c[0], c[1], c[2] - r[2]]];
  for (let b = 1; b < k; b++) {
    const t = (b / k) * Math.PI, z = -Math.cos(t), s = Math.sin(t);
    for (let j = 0; j < n; j++) {
      const a = ((j + (b % 2) * 0.5) / n) * TAU;
      v.push([c[0] + Math.cos(a) * s * r[0], c[1] + Math.sin(a) * s * r[1], c[2] + z * r[2]]);
    }
  }
  v.push([c[0], c[1], c[2] + r[2]]);
  const f: Face[] = [];
  const top = v.length - 1;
  for (let j = 0; j < n; j++) f.push({ i: [0, 1 + ((j + 1) % n), 1 + j], m: mat });
  for (let b = 0; b < k - 2; b++) {
    for (let j = 0; j < n; j++) {
      const a0 = 1 + b * n, a1 = 1 + (b + 1) * n, j2 = (j + 1) % n;
      // Every other band is turned half a step, so its quads are split into triangles that meet the band either side.
      if (b % 2 === 0) {
        f.push({ i: [a0 + j, a0 + j2, a1 + j], m: mat });
        f.push({ i: [a0 + j2, a1 + j2, a1 + j], m: mat });
      } else {
        f.push({ i: [a0 + j, a0 + j2, a1 + j2], m: mat });
        f.push({ i: [a0 + j, a1 + j2, a1 + j], m: mat });
      }
    }
  }
  const last = 1 + (k - 2) * n;
  for (let j = 0; j < n; j++) f.push({ i: [last + j, last + ((j + 1) % n), top], m: mat });
  return mesh(v, f);
}

/**
 * A tapering chain along a line of points: a ponytail, a braid, a lock, the
 * point of a beard. `rs` is the radius at each point, `n` how many sides.
 */
function chain(pts: V3[], rs: number[], n: number, mat: Mat, ends = true): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    let d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    d = [d[0] / l, d[1] / l, d[2] / l];
    // Two directions square to the chain: one across it, one from it and that.
    let u: V3 = Math.abs(d[0]) < 0.9 ? [0, d[2], -d[1]] : [-d[2], 0, d[0]];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const w: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    for (let j = 0; j < n; j++) {
      const t = ((j + 0.5) / n) * TAU, c = Math.cos(t) * rs[k], s = Math.sin(t) * rs[k];
      v.push([pts[k][0] + u[0] * c + w[0] * s, pts[k][1] + u[1] * c + w[1] * s, pts[k][2] + u[2] * c + w[2] * s]);
    }
  }
  // Each ring runs round the chain the same way, so one winding faces every side out, however the chain bends.
  for (let k = 0; k < pts.length - 1; k++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      f.push({ i: [k * n + j, k * n + j2, (k + 1) * n + j2, (k + 1) * n + j], m: mat });
    }
  }
  if (ends) {
    f.push({ i: Array.from({ length: n }, (_, j) => n - 1 - j), m: mat });
    const last = (pts.length - 1) * n;
    f.push({ i: Array.from({ length: n }, (_, j) => last + j), m: mat });
  }
  return mesh(v, f);
}

/** A polygon's normal, the long way round, which is right for a quad that is not quite flat. */
function newell(p: V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < p.length; k++) {
    const a = p[k], b = p[(k + 1) % p.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

/** Flat pieces laid on a surface: an eye, a brow, a buckle. Each is a decal of four corners. */
function decals(quads: Array<{ q: V3[]; m: Mat; unless?: V3; lit?: boolean }>): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  for (const { q, m, unless, lit } of quads) {
    const base = v.length;
    v.push(...q);
    f.push({ i: q.map((_, k) => base + k), m, decal: true, unless, lit });
  }
  return mesh(v, f);
}


/** A quad laid flat on a surface, centred at `c`, spanning ±`u` and ±`w`, wound to face along `n`. */
function plate(c: V3, u: V3, w: V3, n: V3, m: Mat): { q: V3[]; m: Mat } {
  const q: V3[] = [
    [c[0] - u[0] - w[0], c[1] - u[1] - w[1], c[2] - u[2] - w[2]],
    [c[0] + u[0] - w[0], c[1] + u[1] - w[1], c[2] + u[2] - w[2]],
    [c[0] + u[0] + w[0], c[1] + u[1] + w[1], c[2] + u[2] + w[2]],
    [c[0] - u[0] + w[0], c[1] - u[1] + w[1], c[2] - u[2] + w[2]],
  ];
  const k = newell(q);
  return { q: k[0] * n[0] + k[1] * n[1] + k[2] * n[2] < 0 ? q.reverse() : q, m };
}

/** A face made of these corners, wound to face along `want`. */
function faceOut(v: V3[], idx: number[], want: V3, m: Mat): Face {
  const k = newell(idx.map((i) => v[i]));
  return { i: k[0] * want[0] + k[1] * want[1] + k[2] * want[2] < 0 ? [...idx].reverse() : idx, m };
}

/* ---- the body, per look ------------------------------------------------------ */

/** The proportions a build comes to: shoulders, waist and hips, how far toward a woman's frame, and height. */
export interface Frame {
  sh: number;
  wa: number;
  hi: number;
  fem: number;
  tall: number;
  /**
   * How finely the hair and the small round things are cut: one for a body
   * drawn big, a half for one drawn at the size the island is played at,
   * where a lock of hair is a pixel and twice the facets is twice the cost
   * for nothing anybody can see.
   */
  lod: number;
}

function frameOf(look: Look, lod = 1): Frame {
  const b = BUILDS[look.gender] ?? BUILDS.neither;
  const fem = look.gender === 'woman' ? 1 : look.gender === 'man' ? 0 : 0.5;
  return { sh: b.shoulder, wa: b.waist, hi: b.hip, fem, tall: 1 - fem * 0.035, lod };
}

/** How many of something to cut, at a frame's detail: never fewer than `least`, and a multiple of `by`. */
const cut = (fr: Frame, n: number, least: number, by = 1): number => Math.max(least, by * Math.round((n * fr.lod) / by));

/*
 * The skeleton at rest. A body is sixteen and a half tenths of a metre to the
 * crown -- thirty-seven pixels at zoom one, the figure the island was drawn
 * round -- and proportioned to be read at that size rather than measured:
 * a head a quarter of the height, a long body over short sturdy legs, and
 * hands and feet a little big, which is what makes a figure thirty pixels
 * tall read as somebody rather than a stick.
 */
const HIP = 7.25;
const SPINE = 1.1;
const CHEST = 1.8;
const NECK = 2.12;
const HEADJ = 0.62;
const ARM_AT = 1.66;
const UPPER = 2.8;
const LOWER = 2.4;
const THIGH = 3.3;
const SHIN = 3.1;

/**
 * The head, bottom to top: [height, half-width, half-depth, 0, how far
 * forward]. Chin, jaw, cheekbones, the temples where it is widest, and
 * three rings rounding the dome of the skull over them. The eyes come a
 * little under halfway up, the brows a little over, and the mouth a quarter
 * of the way, as on a head: the face is not a small thing under a big skull.
 *
 * The island draws a tenth of a metre of height taller than a tenth across
 * -- 2.25 pixels up against about 1.7 along -- so a skull modelled round
 * would be drawn as an egg standing on end, and one that narrowed to the
 * crown in two steps as a cone. So the dome is modelled as much lower than
 * it is wide as that stretches it, and is drawn round: as tall over the
 * temples as it is wide from them, and full far up before it turns over.
 */
function headRings(fr: Frame): number[][] {
  const jaw = 1.06 - fr.fem * 0.14;
  // The dome over the temples, a quarter-ellipse: [how far round from the side, as a fraction of a right angle].
  const W = 1.46, D = 1.56, top = CROWN - 2;
  const dome = [0.33, 0.61, 0.83].map((f) => {
    const a = (f * Math.PI) / 2;
    return [2 + top * Math.sin(a), W * Math.cos(a), D * Math.cos(a), 0, 0.06 - 0.14 * f];
  });
  return [
    [0.22, 0.74 * jaw, 0.55, 0, 0.8],
    [0.72, 1.16 * jaw, 1.1, 0, 0.42],
    [1.3, 1.38, 1.46, 0, 0.18],
    [2, W, D, 0, 0.06],
    ...dome,
  ];
}
/** The top of the skull: over the temples by as much as the stretch of the drawing leaves the dome looking as tall as it is wide. */
const CROWN = 2 + (1.46 * 1.7) / 2.25 / 1.01;
/** How far forward the front of the neck is where it goes up under the jaw: a beard that hangs below the chin turns back in to here. */
const THROAT = 0.55;

/**
 * The head is made at one size and then scaled up to the one it is drawn at,
 * hair, beard, face and all, so every haircut sits on the skull it was cut
 * for whatever size heads end up.
 */
const HEAD_SIZE: V3 = [1.24, 1.22, 1.08];
const bigger = (p: V3): V3 => [p[0] * HEAD_SIZE[0], p[1] * HEAD_SIZE[1], p[2] * HEAD_SIZE[2] + 0.03];
const grown = (m: Mesh): Mesh => ({ v: m.v.map(bigger), f: m.f.map((f) => (f.at ? { ...f, at: bigger(f.at) } : f)), e: m.e });

/** Hands a little over life size too, so that a hand reads at the size the island is played at: a fist, and an open hand waving. */
const HAND = 1.12;
const handSized = (m: Mesh): Mesh => ({ v: m.v.map((p): V3 => [p[0] * HAND, p[1] * HAND, p[2] * HAND]), f: m.f, e: m.e });
/** How far down the hand from the wrist a haft goes through the fist. */
const GRIP = -0.55 * HAND;
/** A mesh made `k` times bigger about its own origin, the joint it hangs from. */
const grownBy = (k: number, m: Mesh): Mesh => ({ ...m, v: m.v.map((p): V3 => [p[0] * k, p[1] * k, p[2] * k]) });

/** Every facet of a mesh marked as part of something `w` wide: see `Face.fine`. */
const fine = (m: Mesh, w: number): Mesh => ({ ...m, f: m.f.map((f) => ({ ...f, fine: w })) });
/** The facets of a mesh wholly where `inside` holds, made seams: see `Face.seam`. */
const seamed = (m: Mesh, inside: (p: V3) => boolean): Mesh => ({ ...m, f: m.f.map((f) => (f.i.every((i) => inside(m.v[i])) ? { ...f, seam: true } : f)) });

/** The skull as a solid, a little inside the facets, for what lies on it to be hidden behind. */
const SKULL = { c: bigger([0, 0.1, 1.85]), r: [1.3 * HEAD_SIZE[0], 1.4 * HEAD_SIZE[1], (CROWN - 1.85 - 0.08) * HEAD_SIZE[2]] as V3 };
/**
 * And the jaw, inside the cheeks and the chin, for a beard: what of one is
 * round the far side of the face, or hangs behind the chin seen from behind,
 * is out of sight behind it.
 */
const JAW = { c: bigger([0, 0.35, 0.85]), r: [1.05 * HEAD_SIZE[0], 1.1 * HEAD_SIZE[1], 0.6 * HEAD_SIZE[2]] as V3 };

/** The skull at height `z`: half-width, half-depth, and how far forward its middle is. */
function skull(fr: Frame, z: number): [number, number, number] {
  const rs = headRings(fr);
  if (z <= rs[0][0]) return [rs[0][1], rs[0][2], rs[0][4]];
  for (let k = 0; k < rs.length - 1; k++) {
    const a = rs[k], b = rs[k + 1];
    if (z <= b[0]) {
      const t = (z - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[4] + (b[4] - a[4]) * t];
    }
  }
  const top = rs[rs.length - 1];
  const t = Math.min(1, (z - top[0]) / (CROWN - top[0]));
  return [top[1] * (1 - t), top[2] * (1 - t), top[4]];
}

/**
 * Where a mark on the face goes: `u` across the face from the corner where
 * the front facet turns into the cheek, `z` up. Across the corner the mark
 * bends round onto the cheek facet with it, so an eye or a brow is still
 * there when the head is seen side on and the front facet is edge-on to the
 * viewer.
 */
function faceMarks(fr: Frame, s: number, shape: Pt[], m: Mat): Array<{ q: V3[]; m: Mat }> {
  const zs = shape.map((p) => p[1]);
  const [rxx, ryy, cy] = skull(fr, (Math.min(...zs) + Math.max(...zs)) / 2);
  // The two corners of the cheek facet: where it meets the front, and where it meets the side.
  const c0: Pt = [Math.cos((3 * Math.PI) / 8) * rxx, cy + Math.sin((3 * Math.PI) / 8) * ryy];
  const c1: Pt = [Math.cos(Math.PI / 8) * rxx, cy + Math.sin(Math.PI / 8) * ryy];
  const dl = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
  const along: Pt = [(c1[0] - c0[0]) / dl, (c1[1] - c0[1]) / dl];
  const out: Pt = [-along[1], along[0]];
  const lift = 0.035;
  const put = (u: number, z: number): V3 =>
    u <= 0
      ? [s * (c0[0] + u), c0[1] + lift, z]
      : [s * (c0[0] + along[0] * u + out[0] * lift), c0[1] + along[1] * u + out[1] * lift, z];
  // Cut the shape at the corner and lay each side on its own facet.
  const halves: Pt[][] = [[], []];
  for (let k = 0; k < shape.length; k++) {
    const a = shape[k], b = shape[(k + 1) % shape.length];
    for (let h = 0; h < 2; h++) {
      const inA = h === 0 ? a[0] <= 0 : a[0] >= 0;
      const inB = h === 0 ? b[0] <= 0 : b[0] >= 0;
      if (inA) halves[h].push(a);
      if (inA !== inB) {
        const t = a[0] / (a[0] - b[0]);
        halves[h].push([0, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return halves.filter((h) => h.length >= 3).map((h, i) => {
    const q = h.map(([u, z]) => put(u, z));
    const want: V3 = i === 0 && h.some((p) => p[0] < 0) ? [0, 1, 0] : [s * out[0], out[1], 0];
    const k = newell(q);
    return { q: k[0] * want[0] + k[1] * want[1] + k[2] * want[2] < 0 ? q.reverse() : q, m };
  });
}

/**
 * The ears: each flat, from the line of the brows down to the bottom of the
 * nose, half sunk in the side of the head -- narrow at the lobe, broadest
 * near the top and leaning back, rounded all the way up rather than a cut
 * stone.
 */
const earsOf = (fr: Frame): Mesh => {
  // Lobe to top: [height, half as thick as it is, half as broad, how far forward].
  const up = [[1.14, 0.06, 0.08, 0.02], [1.24, 0.1, 0.15, -0.02], [1.42, 0.12, 0.21, -0.08], [1.62, 0.13, 0.25, -0.13], [1.78, 0.11, 0.2, -0.17], [1.87, 0.06, 0.1, -0.19]];
  return join(...[-1, 1].map((s) => {
    const x = s * (skull(fr, 1.5)[0] + 0.02);
    return rings(up.map(([z, thick, broad, fore]) => [z, thick, broad, x, fore]), fr.lod < 1 ? 5 : 7, 'skin');
  }));
};

/** How far forward the front facet of the face is at height `z`: as far as the ring's corners are, times the cosine of half a facet. */
const faceFront = (fr: Frame, z: number): number => {
  const [, ryy, cy] = skull(fr, z);
  return cy + ryy * Math.cos(Math.PI / 8);
};

/**
 * The nose: a wedge on the front facet, a third of a tenth of a metre out
 * from it at the tip, lit down one side and shaded down the other. A piece
 * of its own, drawn after the head and whatever lies on it, because seen
 * from above its tip is where a moustache under it is, and it is in front.
 */
function noseOf(fr: Frame): Mesh {
  const [top, base, tip] = [1.58, 1.18, 1.23];
  // Its back a little into the face, so no rim of it shows.
  const at = (z: number): number => faceFront(fr, z) - 0.01;
  const v: V3[] = [[0, at(top), top], [-0.15, at(base), base], [0.15, at(base), base], [0, at(tip) + 0.34, tip]];
  return mesh(v, ([[[0, 1, 3], [-1, 0.6, 0.3]], [[0, 3, 2], [1, 0.6, 0.3]], [[1, 2, 3], [0, 0.4, -1]]] as Array<[number[], V3]>).map(([i, want]) => ({ ...faceOut(v, i, want, 'skin'), soft: true })));
}

/**
 * A head: eight facets round, a jaw that narrows to the chin,
 * and the face painted on -- eyes, brows and a mouth -- so that it goes out
 * of sight when the front does; the nose is a piece of its own, `noseOf`. The eyes sit on the corners where the face
 * turns into the cheeks, as eyes do, so the face still has one side on.
 */
function headMesh(fr: Frame, blink: boolean): Mesh {
  const rs = headRings(fr);
  const shell = rings(rs, 8, 'skin', { top: false });
  const v = [...shell.v, [0, -0.08, CROWN] as V3];
  const crown = v.length - 1;
  const last = (rs.length - 1) * 8;
  const f = [...shell.f];
  for (let j = 0; j < 8; j++) f.push({ i: [last + j, last + ((j + 1) % 8), crown], m: 'skin' });
  const face = mesh(v, f);
  // An eye is a dark almond with a catch of light in it, or a lid when it blinks.
  // Mostly on the front of the face, wrapping a little round the corner: from three-quarters the far eye is still on the face.
  const eye: Pt[] = (blink
    ? [[-0.16, 1.5], [0.15, 1.52], [0.15, 1.55], [-0.16, 1.53]]
    : [[-0.16, 1.54], [-0.09, 1.66], [0.06, 1.67], [0.15, 1.57], [0.07, 1.44], [-0.09, 1.44]]).map(([u, z]) => [u - 0.11, z]);
  // A woman's brow finer and arched higher at the middle, a man's straight and heavy.
  const brow: Pt[] = [[-0.33, 1.8 + fr.fem * 0.02], [0.08, 1.82 + fr.fem * 0.01], [0.1, 1.87 - fr.fem * 0.02], [-0.15, 1.91 + fr.fem * 0.02], [-0.34, 1.86 - fr.fem * 0.01]];
  // And on a woman's eye the upper lid's line drawn dark and flicked up past the outer corner, which is the cheek's side (`faceMarks`): the lashes.
  const lash: Pt[] = [[-0.26, 1.58], [-0.2, 1.685], [-0.05, 1.7], [0.07, 1.64], [0.14, 1.675], [0.06, 1.6], [-0.05, 1.665], [-0.2, 1.655], [-0.25, 1.555]];
  // Fuller on a woman: the lower lip down and the upper up, by as much again as a man's lips are thick.
  const full = fr.fem * 0.03;
  const mouth = (w: number, z: number): V3[] => {
    const y = faceFront(fr, z) + 0.005;
    return [[-w, y, z + 0.03], [0, y + 0.02, z - 0.03 - full], [w, y, z + 0.03], [w * 0.8, y, z + 0.055 + full * 0.6], [0, y + 0.02, z + 0.01 + full], [-w * 0.8, y, z + 0.055 + full * 0.6]];
  };
  // The white of the eye showing round the dark of it, most at the outer corner.
  const [eu, ez] = [eye.reduce((a, p) => a + p[0], 0) / eye.length, eye.reduce((a, p) => a + p[1], 0) / eye.length];
  const white: Pt[] = eye.map(([u, z]) => [eu + (u - eu) * 1.22 + 0.012, ez + (z - ez) * 1.15]);
  const marks = [
    ...[-1, 1].flatMap((s) => [
      ...(blink ? [] : faceMarks(fr, s, white, 'white')),
      ...faceMarks(fr, s, eye, 'eye'),
      ...(blink || fr.fem < 1 ? [] : faceMarks(fr, s, lash, 'eye')),
      ...faceMarks(fr, s, brow, 'brow'),
      ...(blink ? [] : faceMarks(fr, s, [[-0.225, 1.605], [-0.15, 1.63], [-0.15, 1.565], [-0.225, 1.55]], 'glint')),
      // Side on the front of the face is edge-on and its eyes with it, so the cheek carries the eye then.
      ...faceMarks(fr, s, blink ? [[0.01, 1.5], [0.13, 1.52], [0.13, 1.55], [0.01, 1.53]] : [[0.01, 1.45], [0.12, 1.47], [0.13, 1.64], [0.01, 1.66]], 'eye')
        .map((d) => ({ ...d, unless: [0, 1, 0] as V3 })),
    ]),
    { q: mouth(0.21 - fr.fem * 0.03, 1), m: 'lip' as Mat },
  ];
  return join(face, decals(marks.map((d: { q: V3[]; m: Mat; unless?: V3 }) => {
    const k = newell(d.q);
    return { ...d, q: k[1] < -1e-9 && d.m === 'lip' ? [...d.q].reverse() : d.q };
  })));
}

/* ---- hair and beards ----------------------------------------------------------- */

interface ShellSpec {
  /** The lower edge round the head, by angle: nought is the right, a quarter turn the face. */
  lo: (a: number) => number;
  /** The upper edge; to the crown, closed, when there is none. */
  hi?: (a: number) => number;
  /** How far it stands off the skull. */
  loft: (a: number, z: number) => number;
  /** Only this much of the way round, for a beard or a strip. */
  arc?: [number, number];
  n?: number;
  rows?: number;
  mat?: Mat;
  /** How far up the upper rows rise as they stand off, as a part of the loft: hair lifts off the head toward its edge; a beard lies on the cheek, and does not. */
  lift?: number;
}

/**
 * A surface laid over the skull between two edges: a beard, or the shadow
 * of a shave. Rows run from the lower edge to the upper, and each
 * point stands out from the skull by the loft, so volume is a number rather
 * than a separate shape.
 */
function shell(fr: Frame, s: ShellSpec): Mesh {
  const n = cut(fr, s.n ?? 14, 8), rows = cut(fr, s.rows ?? 5, 2) + (fr.lod < 1 ? 1 : 0);
  const full = !s.arc;
  const [a0, a1] = s.arc ?? [0, TAU];
  const cols = full ? n : n + 1;
  const closed = !s.hi;
  const v: V3[] = [];
  const at = (a: number, z: number, t: number): V3 => {
    const [rxx, ryy, cy] = skull(fr, z);
    const l = s.loft(a, z);
    return [Math.cos(a) * (rxx + l), cy + Math.sin(a) * (ryy + l), z + l * t * t * (s.lift ?? 0.7)];
  };
  const last = closed ? rows - 1 : rows;
  for (let k = 0; k <= last; k++) {
    const t = k / rows;
    for (let j = 0; j < cols; j++) {
      const a = a0 + ((a1 - a0) * j) / n;
      // A closed cap's last ring goes round the crown at one height, whatever height its hairline is,
      // so the cone over the top of it stays outside the skull all the way round.
      const lo = s.lo(a), hi = s.hi ? s.hi(a) : CROWN - 0.14;
      v.push(at(a, lo + (hi - lo) * Math.pow(k / last, 0.9), t));
    }
  }
  const f: Face[] = [];
  const m = s.mat ?? 'hair';
  for (let k = 0; k < last; k++) {
    for (let j = 0; j < n; j++) {
      const j2 = full ? (j + 1) % n : j + 1;
      f.push({ i: [k * cols + j, k * cols + j2, (k + 1) * cols + j2, (k + 1) * cols + j], m });
    }
  }
  if (closed) {
    // The crown: over the middle of the last ring, as far out again as the ring stands off the skull on average.
    const [, , cy] = skull(fr, CROWN - 0.2);
    let lift = 0;
    for (let j = 0; j < n; j++) lift += s.loft(a0 + ((a1 - a0) * j) / n, CROWN) / n;
    v.push([0, cy, CROWN + lift * 0.9]);
    const pole = v.length - 1, top = last * cols;
    for (let j = 0; j < n; j++) f.push({ i: [top + j, top + ((j + 1) % n), pole], m });
  }
  return mesh(v, f);
}

/**
 * A hairline, by how high it comes at the middle of the brow, at the corners
 * of the forehead, over the ears and at the nape; `burn` is how far a
 * sideburn comes down in front of each ear, and `round` how far round from
 * the middle of the face the corners are, in radians. The ears are 1.2 to
 * 1.8 up the head and the brows 1.9, so a line over the ears at 1.95 leaves
 * them out and one at 1.3 covers them; the brows end 0.7 round, so hair that
 * comes down over the ears from corners short of that comes down beside the
 * ends of the brows.
 */
const hairline = (brow: number, corner: number, ear: number, nape: number, burn = 0, round = 0.62) => (a: number): number => {
  // Round from the middle of the face: nought there, a quarter turn at the ears, a half at the nape.
  const f = Math.abs(Math.atan2(Math.cos(a), Math.sin(a)));
  const knots: Array<[number, number]> = [[0, brow], [round, corner], [Math.PI / 2, ear], [Math.PI, nape]];
  let h = nape;
  for (let k = 0; k < knots.length - 1; k++) {
    const [f0, h0] = knots[k], [f1, h1] = knots[k + 1];
    if (f <= f1) {
      const t = (f - f0) / (f1 - f0);
      h = h0 + (h1 - h0) * t * t * (3 - 2 * t);
      break;
    }
  }
  return h - burn * Math.exp(-Math.pow((f - 1.2) / 0.16, 2));
};
/** Nought below `a`, one above `b`, smooth between. */
const ramp = (x: number, a: number, b: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Hair that hangs off the head and swings: where it is fixed on, and its mesh, built from there. */
interface Tail {
  at: V3;
  mesh: Mesh;
  /** How freely it swings: a braid less than a ponytail. */
  give: number;
  /** Coming out from under the hair over the head, and never drawn over it: a lock from behind the ear, seen from behind. */
  under?: boolean;
}

interface HairKit {
  /** On the skull: drawn over the head from wherever it is seen. */
  cap?: Mesh;
  /** Standing up out of the cap, a crest or a knot: drawn over it. */
  top?: Mesh;
  /** Below it, behind the neck: drawn in its own place among the rest of the body. */
  fall?: Mesh;
  tails: Tail[];
}

/**
 * A crest standing up along the middle of the skull from the hairline over
 * the crown to the nape: a flat-topped fin, `h` high at each point of the
 * way (nought to one) and `w` across its foot.
 */
function crest(fr: Frame, from: number, to: number, h: (t: number) => number, w: number): Mesh {
  // The skull's middle line, front then back, as points and the way out from it.
  const line: Array<{ p: V3; n: V3 }> = [];
  const stations = 11;
  for (let k = 0; k <= stations; k++) {
    // Round the head in its middle plane, from the front hairline (a quarter turn up from ahead) over to the nape.
    const phi = from + ((to - from) * k) / stations;
    const dir: Pt = [Math.cos(phi), Math.sin(phi)];
    let lo = 0, hi = 3;
    for (let q = 0; q < 24; q++) {
      const r = (lo + hi) / 2, z = 1.9 + dir[1] * r;
      const [, ry, cy] = skull(fr, z);
      const y = 0.05 + dir[0] * r;
      if (z < CROWN && Math.abs(y - cy) < ry) lo = r; else hi = r;
    }
    line.push({ p: [0, 0.05 + dir[0] * lo, 1.9 + dir[1] * lo], n: [0, dir[0], dir[1]] });
  }
  const v: V3[] = [];
  line.forEach(({ p, n }, k) => {
    const t = k / stations, up = h(t), cap = w * 0.35;
    const at = (x: number, out: number): V3 => [x, p[1] + n[1] * out, p[2] + n[2] * out];
    v.push(at(-w, -0.02), at(-cap, up), at(cap, up), at(w, -0.02));
  });
  const f: Face[] = [];
  for (let k = 0; k < stations; k++) {
    const a = k * 4, b = (k + 1) * 4;
    const mid: V3 = [0, (line[k].p[1] + line[k + 1].p[1]) / 2, (line[k].p[2] + line[k + 1].p[2]) / 2];
    for (let side = 0; side < 3; side++) {
      const q = [a + side, a + side + 1, b + side + 1, b + side];
      const c = q.reduce((acc, i) => [acc[0] + v[i][0] / 4, acc[1] + v[i][1] / 4, acc[2] + v[i][2] / 4], [0, 0, 0] as number[]);
      f.push(faceOut(v, q, [c[0] - mid[0], c[1] - mid[1], c[2] - mid[2]], 'hair'));
    }
  }
  // Its two ends, square across.
  for (const [k, dir] of [[0, 1], [stations, -1]] as Array<[number, number]>) {
    const tan: V3 = [0, line[k].n[2] * dir, -line[k].n[1] * dir];
    f.push(faceOut(v, [k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 3], tan, 'hair'));
  }
  return mesh(v, f);
}

/**
 * A low dome of `n` facets round, `r` across its foot at `c` and standing `h`
 * out along `up`: a curl on a head of them. Its foot is sunk in the hair
 * under it and its rim is not inked, so a curl facing the viewer is a round
 * of shading on the hair; only one on the outline gets a line, and that line
 * is what makes the outline bump.
 */
function dome(c: V3, up: V3, r: number, h: number, n: number, mat: Mat): Mesh {
  const z = unit(up);
  const x = unit(Math.abs(z[2]) < 0.9 ? cross(z, [0, 0, 1]) : cross(z, [1, 0, 0])), y = cross(z, x);
  const at = (a: number, rr: number, hh: number): V3 => [
    c[0] + (x[0] * Math.cos(a) + y[0] * Math.sin(a)) * rr + z[0] * hh,
    c[1] + (x[1] * Math.cos(a) + y[1] * Math.sin(a)) * rr + z[1] * hh,
    c[2] + (x[2] * Math.cos(a) + y[2] * Math.sin(a)) * rr + z[2] * hh,
  ];
  const v: V3[] = [];
  for (let j = 0; j < n; j++) v.push(at((j / n) * TAU, r, 0));
  for (let j = 0; j < n; j++) v.push(at(((j + 0.5) / n) * TAU, r * 0.78, h * 0.66));
  v.push(at(0, 0, h));
  // Each facet turned to face away from a point under the middle of the foot; and all of them hidden or shown by the one halfway up.
  const o = at(0, 0, -r), mid = at(0, 0, h * 0.5);
  const f: Face[] = [];
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    for (const q of [[j, j2, n + j], [j2, n + j2, n + j], [n + j, n + j2, 2 * n]]) {
      const m = middle(q.map((i) => v[i]));
      f.push({ ...faceOut(v, q, [m[0] - o[0], m[1] - o[1], m[2] - o[2]], mat), soft: true, at: mid });
    }
  }
  // Its foot closed, for when it is seen from under it, over the top of a head from the far side: open, the far rim would show alone.
  f.push({ ...faceOut(v, Array.from({ length: n }, (_, j) => j), [-z[0], -z[1], -z[2]], mat), at: mid });
  return mesh(v, f);
}

/**
 * Round curls sat on a head of hair laid by `cap`: each `[round the head, up
 * from level, how big]` in radians and tenths of a metre, its foot a little
 * into the hair under it wherever that is.
 */
function clusters(fr: Frame, cap: Sweep, spots: Array<[number, number, number]>): Mesh {
  // Drawn small, the smallest curls are under a pixel, and are left out.
  return join(...spots.filter(([, , r]) => fr.lod >= 1 || r >= 0.35).flatMap(([a, up, r]) => {
    const d: V3 = [Math.cos(up) * Math.cos(a), Math.cos(up) * Math.sin(a), Math.sin(up)];
    const out = surface(fr, cap, d);
    return out > 0 ? [dome(over(fr, d, out - 0.04), d, r, r * 0.6, fr.lod < 1 ? 4 : 7, 'hair')] : [];
  }));
}

/** A braid: beads of hair down a line, fat and thin by turns, tied at the end. */
function braid(pts: V3[], r: number): Mesh {
  const dense: V3[] = [];
  const rs: number[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    for (let q = 0; q < 2; q++) {
      const t = q / 2;
      dense.push([pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t, pts[k][2] + (pts[k + 1][2] - pts[k][2]) * t]);
      const taper = 1 - (k + t) / pts.length * 0.45;
      rs.push(r * taper * (q === 0 ? 1 : 0.62));
    }
  }
  dense.push(pts[pts.length - 1]);
  rs.push(r * 0.45);
  // Tied off near the end, and the loose hair below the tie flaring into a short tassel.
  const a = pts[pts.length - 2], z = pts[pts.length - 1];
  const d = unit([z[0] - a[0], z[1] - a[1], z[2] - a[2]]);
  const at = (k: number): V3 => [z[0] + d[0] * k, z[1] + d[1] * k, z[2] + d[2] * k];
  return join(
    chain(dense, rs, 5, 'hair'),
    ball(at(0), [r * 0.55, r * 0.55, r * 0.45], 6, 2, 'brow'),
    chain([at(0.05), at(0.35), at(0.55)], [r * 0.4, r * 0.62, r * 0.2], 5, 'hair'),
  );
}

/* ---- laying hair over the skull ------------------------------------------------ */

/** The middle of the skull, which hair is laid out from. */
const MID: V3 = [0, 0.05, 1.9];

/** How far from the middle of the skull its surface is, going out along `d`. */
function reach(fr: Frame, d: V3): number {
  let lo = 0, hi = 3.4;
  for (let q = 0; q < 20; q++) {
    const r = (lo + hi) / 2;
    const x = MID[0] + d[0] * r, y = MID[1] + d[1] * r, z = MID[2] + d[2] * r;
    const [rxx, ryy, cy] = skull(fr, z);
    if (z >= 0.3 && z < CROWN && (x / rxx) ** 2 + ((y - cy) / ryy) ** 2 <= 1) lo = r;
    else hi = r;
  }
  return lo;
}

/**
 * The point over the skull out along `d`, stood `out` off it. Hair that
 * `hangs` falls straight down past the cheekbones rather than following the
 * jaw in under them.
 */
function over(fr: Frame, d: V3, out: number, hangs = false): V3 {
  const r = reach(fr, d) + out;
  const p: V3 = [MID[0] + d[0] * r, MID[1] + d[1] * r, MID[2] + d[2] * r];
  if (hangs && p[2] < 1.3) {
    const [rx0, ry0, cy0] = skull(fr, 1.3), [rx1, ry1, cy1] = skull(fr, Math.max(0.3, p[2]));
    p[0] *= rx0 / rx1;
    p[1] = cy0 + (p[1] - cy1) * (ry0 / ry1);
  }
  return p;
}

/** Round the head from the right, a quarter turn at the face: where a point is, for the hairline to be read at. */
const around = (fr: Frame, p: V3): number => Math.atan2(p[1] - skull(fr, p[2])[2], p[0]);

/**
 * A head of hair laid in locks from where it grows. Every lock is a line
 * over the skull from a pole -- the crown, the back of the head where it is
 * combed to, a tie, or either side of a parting -- out to the hairline, so
 * the facets run the way the hair does and a parting is a parting. Every
 * other lock stands a little proud of its neighbours and runs on past the
 * hairline to a point: that, far more than volume, is what makes a shell of
 * hair read as hair.
 */
interface Sweep {
  /** Where the hair grows from. */
  pole: V3;
  /** Which way is nought round the pole. */
  zero: V3;
  /** Round the pole from and to, in radians, and how many locks. A whole turn joins up. */
  round: [number, number, number];
  /** A parting: the hair starts where the skull is this far to the right, and grows toward the pole. */
  part?: number;
  /** Or bare out to this angle from the pole, as round a tonsure. */
  bare?: number;
  /** The hairline, as a height by where round the head it is. */
  edge: (a: number) => number;
  /** And no lower than this, where something else takes over. */
  floor?: number;
  /** How far off the skull, by how far along the lock (root 0, end 1) and where round the pole it is. */
  loft: (s: number, lam: number) => number;
  /** How far every other lock stands proud of its neighbours, and runs on past the hairline to a point: everywhere, or by where round the head it ends. */
  ridge?: number | ((a: number) => number);
  tip?: number | ((a: number) => number);
  hangs?: boolean;
  rows?: number;
  mat?: Mat;
  /** The shade of the last row, where the hair meets the skin: a step darker unless said otherwise. */
  under?: Mat;
  /**
   * A lock put in between any two that end far apart round the hairline, so
   * the ends run evenly along it. For hair all drawn to one place: spread
   * evenly round the pole, two neighbouring locks can end a quarter of the
   * way round the head apart -- one behind the ear, the next at the corner
   * of the brow -- where the hairline runs away from the pole, and the hair
   * between them stands off the head in a point.
   */
  even?: boolean;
}

/**
 * How a sweep's hair is laid out: `dir` is the way out from the middle of
 * the skull `lam` round its pole and `mu` out from it, and `lockAt` finds the
 * lock along `lam` -- where it starts, where it leaves the hair, and where
 * round the head that is.
 */
function laid(fr: Frame, s: Sweep) {
  const P = unit(s.pole);
  const zp = dot(s.zero, P);
  const e1 = unit([s.zero[0] - P[0] * zp, s.zero[1] - P[1] * zp, s.zero[2] - P[2] * zp]);
  const e2 = cross(P, e1);
  const dir = (lam: number, mu: number): V3 => {
    const c = Math.cos(mu), sn = Math.sin(mu), cl = Math.cos(lam), sl = Math.sin(lam);
    return [c * P[0] + sn * (cl * e1[0] + sl * e2[0]), c * P[1] + sn * (cl * e1[1] + sl * e2[1]), c * P[2] + sn * (cl * e1[2] + sl * e2[2])];
  };
  // From a parting the hair grows toward the pole; from a crown, away from it.
  const way = s.part !== undefined ? -1 : 1;
  const hair = (d: V3): boolean => {
    const p = over(fr, d, 0);
    return p[2] >= Math.max(s.floor ?? -9, s.edge(around(fr, p)));
  };
  // Along one line round the pole, the first angle at which `test` holds, between two it changes between.
  const cross0 = (lam: number, a: number, b: number, test: (mu: number) => boolean): number => {
    for (let q = 0; q < 12; q++) {
      const c = (a + b) / 2;
      if (test(c) === test(a)) a = c;
      else b = c;
    }
    return (a + b) / 2;
  };
  /*
   * Hair grown from a point does not start at the point: every lock meeting
   * there would make a star of slivers and ink. It starts a little way out,
   * on a ring, and the ring is closed with one facet -- the crown of the
   * head, or the knot of hair where it is tied.
   */
  const whorl = s.part === undefined && s.bare === undefined;
  // One lock: its way round the pole, how far out from the pole it starts and ends, and where round the head it ends.
  const lockAt = (lam: number): { lam: number; mu0: number; mu1: number; end: number } => {
    let mu0 = s.bare ?? (whorl ? 0.2 : 0);
    if (s.part !== undefined) {
      const x = s.part;
      mu0 = cross0(lam, 0.02, Math.PI - 0.02, (mu) => over(fr, dir(lam, mu), 0)[0] * Math.sign(P[0] || 1) > x * Math.sign(P[0] || 1));
    }
    // Out from the root until it leaves the hair, then halved down to where.
    let mu1 = mu0;
    const step = 0.07 * way;
    const stop = way > 0 ? Math.PI - 0.02 : 0.02;
    if (hair(dir(lam, mu0 + step * 0.2))) {
      let m = mu0;
      while ((way > 0 ? m + step < stop : m + step > stop) && hair(dir(lam, m + step))) m += step;
      mu1 = (way > 0 ? m + step < stop : m + step > stop) ? cross0(lam, m, m + step, (mu) => hair(dir(lam, mu))) : m;
    }
    return { lam, mu0, mu1, end: around(fr, over(fr, dir(lam, mu1), 0)) };
  };
  return { P, e1, e2, dir, lockAt, way, whorl };
}

/** How far off the skull a sweep's hair stands along `d`, before any lock stands proud of it; and nought where it has none. */
function surface(fr: Frame, s: Sweep, d: V3): number {
  const { P, e1, e2, lockAt } = laid(fr, s);
  const u = unit(d);
  const lam = Math.atan2(dot(u, e2), dot(u, e1));
  const { mu0, mu1 } = lockAt(lam);
  const t = (Math.acos(Math.max(-1, Math.min(1, dot(u, P)))) - mu0) / (mu1 - mu0 || 1);
  return t < 0 || t > 1 ? 0 : s.loft(t, lam);
}

function sweep(fr: Frame, s: Sweep): Mesh {
  const { P, dir, lockAt, way, whorl } = laid(fr, s);
  const [l0, l1] = s.round;
  const whole = Math.abs(l1 - l0 - TAU) < 1e-6;
  // Locks in fours at the finest, so one lies down the middle of the brow; in fours still when cut coarser.
  const n = fr.lod < 1 ? cut(fr, s.round[2], 8, 4) : s.round[2];
  const cols = whole ? n : n + 1;
  const rows = fr.lod < 1 ? cut(fr, s.rows ?? 5, 3) : s.rows ?? 5;
  const v: V3[] = [];
  let locks = Array.from({ length: cols }, (_, j) => lockAt(l0 + ((l1 - l0) * j) / n));
  if (s.even) {
    // Where two neighbours end more than a quarter-radian and a bit apart round the head, a lock between them; and between those, up to three times over.
    for (let pass = 0; pass < 3; pass++) {
      const more: typeof locks = [];
      for (let j = 0; j < locks.length; j++) {
        more.push(locks[j]);
        if (!whole && j === locks.length - 1) break;
        const a = locks[j], b = locks[(j + 1) % locks.length];
        const gap = Math.abs(Math.atan2(Math.sin(b.end - a.end), Math.cos(b.end - a.end)));
        const to = j === locks.length - 1 ? b.lam + (l1 - l0) : b.lam;
        if (gap > 0.45) more.push(lockAt((a.lam + to) / 2));
      }
      locks = more;
    }
  }
  const strips = whole ? locks.length : locks.length - 1;
  locks.forEach(({ lam, mu0, mu1, end }, j) => {
    const odd = j % 2 === 1;
    const live = Math.abs(mu1 - mu0) > 0.04;
    // A pointed lock runs on past the hairline by `tip`, as an angle at its distance from the middle.
    const by = (x: number | ((a: number) => number) | undefined): number => (!live || !odd || !x ? 0 : typeof x === 'number' ? x : x(end));
    const tip = by(s.tip), ridge = by(s.ridge);
    const past = tip ? (tip / Math.max(0.6, reach(fr, dir(lam, mu1)))) * way : 0;
    for (let k = 0; k <= rows; k++) {
      const t = k / rows;
      const mu = mu0 + (mu1 + past - mu0) * t;
      const proud = ridge * Math.sin(Math.PI * Math.min(1, t * 1.1));
      v.push(over(fr, dir(lam, mu), live ? s.loft(t, lam) + proud : 0, s.hangs));
    }
  });
  const f: Face[] = [];
  const m = s.mat ?? 'hair';
  const R = rows + 1;
  for (let j = 0; j < strips; j++) {
    const j2 = whole ? (j + 1) % locks.length : j + 1;
    for (let k = 0; k < rows; k++) {
      const q = [j * R + k, j * R + k + 1, j2 * R + k + 1, j2 * R + k];
      const c = middle(q.map((i) => v[i]));
      // The last row, where the hair meets the skin, a shade darker: its underside, and what keeps fair hair from running into a fair face.
      // Over the face only a little darker, and not at all just over the brows, where it would run into them in one dark bar and make a
      // scowl; a full step darker there beside plain facets would stand out as a notch.
      const low = Math.min(...q.map((i) => v[i][2]));
      const under: Mat = c[1] <= 0.3 ? s.under ?? 'brow' : low < 2.15 && c[1] > 0.6 ? 'hair' : 'edge';
      f.push(faceOut(v, q, [c[0] - MID[0], c[1] - MID[1], c[2] - MID[2]], k === rows - 1 && m === 'hair' ? under : m));
    }
  }
  if (whorl) {
    const ring = Array.from({ length: locks.length }, (_, j) => j * R);
    if (!whole) {
      v.push(over(fr, P, s.loft(0, (l0 + l1) / 2)));
      ring.push(v.length - 1);
    }
    const c = middle(ring.map((i) => v[i]));
    f.push(faceOut(v, ring, [c[0] - MID[0], c[1] - MID[1], c[2] - MID[2]], m));
  }
  return mesh(v, f);
}

/**
 * Hair hanging from round the back of the head: a curtain of locks from
 * `top` down to where each ends, flaring out over the shoulders on the way,
 * and waved if asked. `span` is the stretch of its length to build, so the
 * part against the head and the part down the back can be drawn apart.
 */
interface Hang {
  /** Round the head from and to, and how many locks. */
  round: [number, number, number];
  top: number;
  out: number;
  /** How low each lock comes, by where round the head it hangs. */
  to: (a: number) => number;
  flare: number;
  /** How far a lock swings from side to side, and how many half-waves it makes on the way down. */
  wave?: [number, number];
  tip?: number;
  ridge?: number;
  rows?: number;
  span?: [number, number];
  /**
   * Laid over the back of the skull from `top`, high on the crown, down to
   * where the skull is widest, and falling straight from there: one sheet of
   * locks from the crown to the ends, with no edge across the back of the
   * head where hair over the top would stop and this start.
   */
  drape?: boolean;
}

function hang(fr: Frame, h: Hang): Mesh {
  const [a0, a1] = h.round;
  const n = fr.lod < 1 ? cut(fr, h.round[2], 8, 2) : h.round[2];
  const rows = fr.lod < 1 ? cut(fr, h.rows ?? 4, 2) : h.rows ?? 4;
  const [t0, t1] = h.span ?? [0, 1];
  // The ring of the skull a point at height `z` hangs round: the one at the top; or, draped, the one at its own height down to the widest.
  const widest = headRings(fr).reduce((w, r) => (r[1] > w[1] ? r : w))[0];
  const ring = (z: number): [number, number, number] => skull(fr, h.drape ? Math.max(z, widest) : h.top);
  const v: V3[] = [];
  for (let j = 0; j <= n; j++) {
    const a = a0 + ((a1 - a0) * j) / n;
    const odd = j % 2 === 1;
    const bottom = h.to(a) - (odd && h.tip ? h.tip : 0);
    for (let k = 0; k <= rows; k++) {
      const t = t0 + ((t1 - t0) * k) / rows;
      // Tucked in against the skull at the top, under the hair over it, so there is no slot to see down into; out to `out` below that, and flaring.
      // Draped from the crown it is the hair over the top, and is out to `out` from the first.
      const tuck = h.drape ? 1 : ramp(t, 0, 0.12);
      const out = 0.04 + (h.out - 0.04) * tuck + h.flare * Math.sin((t * Math.PI) / 2) + (odd && h.ridge ? h.ridge * Math.sin(Math.PI * Math.min(1, t * 1.1)) : 0);
      const sw = h.wave ? h.wave[0] * Math.sin(t * h.wave[1] * Math.PI) * Math.min(1, t * 3) : 0;
      const z = h.top + (bottom - h.top) * t;
      const [rxx, ryy, cy] = ring(z);
      v.push([Math.cos(a) * (rxx + out) - Math.sin(a) * sw, cy + Math.sin(a) * (ryy + out) + Math.cos(a) * sw, z]);
    }
  }
  const f: Face[] = [];
  const R = rows + 1;
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < rows; k++) {
      const q = [j * R + k, j * R + k + 1, (j + 1) * R + k + 1, (j + 1) * R + k];
      const c = middle(q.map((i) => v[i]));
      const face = faceOut(v, q, [c[0], c[1] - ring(c[2])[2], Math.max(0, c[2] - widest)], 'hair');
      // A stretch that starts part way down lies on the one above it there, so its top is no edge to ink, nor the
      // bottom of one that stops part way; nor the top of hair draped from the crown, which is the whorl.
      f.push((k === 0 && (t0 > 0 || h.drape)) || (k === rows - 1 && t1 < 1) ? { ...face, soft: true } : face);
    }
  }
  return mesh(v, f);
}

/**
 * One lock on its own: a flattened diamond across, `w` wide at each point of
 * the line and a third as thick, its broad side turned `out`, coming to a
 * point where `w` is nought. The strands that fall in front of the shoulders.
 */
function lockOf(pts: V3[], w: number[], out: V3, mat: Mat = 'hair'): Mesh {
  const v: V3[] = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const d = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const od = dot(out, d);
    const o = unit([out[0] - d[0] * od, out[1] - d[1] * od, out[2] - d[2] * od]);
    const x = cross(d, o);
    const p = pts[k], ww = w[k], tt = w[k] * 0.36;
    v.push(
      [p[0] + x[0] * ww, p[1] + x[1] * ww, p[2] + x[2] * ww],
      [p[0] + o[0] * tt, p[1] + o[1] * tt, p[2] + o[2] * tt],
      [p[0] - x[0] * ww, p[1] - x[1] * ww, p[2] - x[2] * ww],
      [p[0] - o[0] * tt * 0.6, p[1] - o[1] * tt * 0.6, p[2] - o[2] * tt * 0.6],
    );
  }
  const f: Face[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const c = middle([pts[k], pts[k + 1]]);
    for (let s = 0; s < 4; s++) {
      const q = [k * 4 + s, k * 4 + ((s + 1) % 4), (k + 1) * 4 + ((s + 1) % 4), (k + 1) * 4 + s];
      const m = middle(q.map((i) => v[i]));
      f.push(faceOut(v, q, [m[0] - c[0], m[1] - c[1], m[2] - c[2]], mat));
    }
  }
  const d0 = unit([pts[0][0] - pts[1][0], pts[0][1] - pts[1][1], pts[0][2] - pts[1][2]]);
  f.push(faceOut(v, [0, 1, 2, 3], d0, mat));
  return mesh(v, f);
}

/**
 * The twenty haircuts, each after a real one: where it grows from and which
 * way it lies, how far it comes down, where it has volume, and whether it
 * ends in points. Men's cuts are short at the sides and long on top, long
 * hair is parted and falls to frame the face, and tied hair is drawn in
 * lines to whatever it is tied with.
 */
function hairOf(fr: Frame, id: string): HairKit {
  const tails: Tail[] = [];
  // All of it from a whorl at the crown. Locks in fours round, so one lies straight down the middle of the brow.
  type Lay = Omit<Sweep, 'pole' | 'zero' | 'round'> & { n?: number };
  const crownOf = (o: Lay, round: [number, number] = [0, TAU]): Sweep => ({ pole: [0, -0.15, 1], zero: [1, 0, 0], round: [round[0], round[1], o.n ?? 16], ...o });
  const crown = (o: Lay, round: [number, number] = [0, TAU]): Mesh => sweep(fr, crownOf(o, round));
  // Combed to one place: the back of the head, a tie, a knot.
  const toward = (pole: V3, o: Lay): Mesh => sweep(fr, { pole, zero: [1, 0, 0], round: [0, TAU, o.n ?? 16], ...o });
  /*
   * Parted at `x` across the head, each side lying away from the parting
   * toward a pole low on its own side. The parting runs from the brow to the
   * crown, and behind that the hair falls from the crown -- unless it goes
   * `through` to the nape, as it does for two braids, and under the fall of
   * long hair.
   */
  const parted = (x: number, drop: number, o: Omit<Lay, 'part'> & { back?: number; through?: boolean }): Mesh => join(
    ...[1, -1].map((s) => sweep(fr, {
      pole: [s, -(o.back ?? 0), -drop], zero: [0, 1, 0], round: [-0.25 * s, (o.through ? Math.PI + 0.7 : 1.75) * s, o.n ?? 12], part: x, ...o,
    })),
    // Round from the crown under the ends of the locks either side of the parting as well as down the back, and as full
    // at the crown as those are a quarter of the way from the parting, so that where they end over it there is hair
    // level with their edges and not a step down under them to the scalp.
    ...(o.through ? [] : [crown({ ...o, part: undefined, n: 12, tip: o.tip, loft: (t, lam) => o.loft(Math.max(t, 0.25), lam) }, [Math.PI - 0.9, TAU + 0.9])]),
  );
  // Shaved close: the hair's own colour over the skin, up to `top`, or all over.
  const shaved = (top?: number): Mesh =>
    shell(fr, { lo: hairline(2.55, 2.35, 2, 1, 0.3), hi: top === undefined ? undefined : () => top, loft: () => 0.05, mat: 'shaved', n: 16, rows: top === undefined ? 5 : 3 });
  // Tied back tight, clear of the ears, with a little lift over the forehead where it is drawn back from the face.
  const TIED = hairline(2.45, 2.25, 1.97, 1.05, 0.28);
  const tied = (t: number, lam: number): number => 0.08 + 0.08 * (1 - t) + 0.1 * Math.max(0, Math.sin(lam)) * Math.sin(Math.PI * ramp(t, 0.55, 1));
  // Combed back in ridges to the tie, the hairline over the forehead cut in small points, and its edge only a little darker than the rest.
  // Only over the forehead: further round, a lock meets the hairline side on, and a point there is a hook standing off the head.
  const TIED_CAP: Lay = { edge: TIED, loft: tied, ridge: (a) => 0.09 * ramp(Math.sin(a), 0.1, 0.6), tip: (a) => 0.12 * Math.max(0, Math.sin(a)) ** 2, under: 'edge', even: true };
  switch (id) {
    case 'bald':
      return { tails };
    case 'crop':
      // A textured crop, faded at the sides: short points brushed forward over a close back and sides.
      return {
        cap: join(
          shaved(2.25),
          crown({ edge: hairline(2.55, 2.4, 2.3, 1.95), loft: (t) => 0.06 + 0.09 * Math.sin(Math.PI * Math.min(1, t * 1.1)), ridge: 0.06, tip: 0.26, rows: 4 }),
        ),
        tails,
      };
    case 'short':
      // Short and tousled on top, falling forward onto the brow in points, over sides faded close.
      return {
        cap: join(
          shaved(2.2),
          crown({
            edge: hairline(2.45, 2.27, 2.12, 1.9, 0.15),
            floor: 2.05,
            loft: (t, lam) => 0.12 + 0.26 * Math.sin(Math.PI * Math.min(1, t * 0.95)) + 0.08 * Math.max(0, Math.sin(lam)) * t,
            ridge: 0.1,
            tip: 0.26,
            rows: 5,
          }),
        ),
        tails,
      };
    case 'bowl':
      // Cut round a bowl: one line all the way round over the tops of the ears.
      return { cap: crown({ edge: hairline(2.02, 1.98, 1.84, 1.58), loft: (t) => 0.2 + 0.1 * Math.sin(Math.PI * t * 0.9), ridge: 0.04, tip: 0.06, n: 24 }), tails };
    case 'side': {
      // Parted deep on the left and swept over to the right, where it comes down across the forehead.
      const line = (a: number): number => hairline(2.45, 2.25, 1.96, 0.85, 0.36)(a) - 0.46 * Math.pow(Math.max(0, Math.cos(a - 1.15)), 3);
      return {
        cap: join(
          shaved(2.2),
          parted(-0.55, 0.35, { edge: line, floor: 2.05, loft: (t) => 0.12 + 0.28 * Math.pow(1 - t, 0.6) * Math.min(1, t * 5), ridge: 0.08, tip: 0.2, back: 0.1 }),
        ),
        tails,
      };
    }
    case 'swept':
      // Combed straight back, standing up in a roll over the forehead, over sides faded close.
      return {
        cap: join(shaved(2.2), toward([0, -0.85, 0.5], {
          edge: hairline(2.6, 2.35, 2.12, 1.95),
          floor: 2.05,
          // Rising from the hairline, fullest just behind it, and lying flatter toward the crown.
          loft: (t, lam) => 0.12 + 0.5 * Math.pow(Math.max(0, Math.sin(lam)), 1.3) * Math.pow(Math.sin(Math.PI * ramp(t, 0.25, 1)), 0.7) + 0.06 * t,
          ridge: 0.06,
          rows: 6,
        })),
        tails,
      };
    case 'fringe':
      // A bob to the jaw with a blunt fringe straight across above the brows.
      return {
        cap: crown({ edge: (a) => Math.min(2.02, hairline(2.02, 1.72, 1.2, 0.9)(a)), loft: (t) => 0.18 + 0.1 * Math.sin(Math.PI * t * 0.8), hangs: true, ridge: 0.06, tip: 0.1, n: 24, rows: 6 }),
        tails,
      };
    case 'curls': {
      // Loose curls, full on top and close at the sides as the references cut them: a mass standing off the crown and thinning to the
      // tops of the ears, with round curls standing out of it over the brow and round the top, and smaller ones low round the back.
      // Close over the ears above all: at the sides the hair thins to little more than half as far out below the crown, so the curls stand
      // up in a mass taller than it is wide, where an afro is rounder and wider.
      const side = (lam: number): number => Math.cos(lam) ** 2;
      const cap = crownOf({
        edge: hairline(2.32, 2.1, 1.68, 0.7),
        loft: (t, lam) => (0.38 - 0.2 * ramp(t, 0.3, 0.9) - 0.12 * ramp(t, 0.85, 1)) * (1 - 0.45 * side(lam) * ramp(t, 0.35, 0.75)),
        ridge: 0.05,
        n: 24,
        rows: 6,
      });
      // One mesh with the hair under them, so a curl behind the head is sorted behind the hair in front of it.
      return {
        cap: join(sweep(fr, cap), clusters(fr, cap, [
          [0.9, 1.2, 0.42], [2.3, 1.2, 0.42], [-0.8, 1.15, 0.42], [-2.3, 1.15, 0.42],
          [1.25, 0.72, 0.4], [1.95, 0.72, 0.4], [0.35, 0.62, 0.34], [2.8, 0.62, 0.34], [-0.55, 0.6, 0.4], [-1.57, 0.62, 0.42], [-2.6, 0.6, 0.4],
          [-0.9, 0.12, 0.3], [-2.25, 0.12, 0.3],
        ])),
        tails,
      };
    }
    case 'afro': {
      /*
       * Round and close, wider than it is tall: low over the crown, fullest
       * round the upper sides, and tucked under all round an edge that comes
       * down over the tops of the ears. Over the brow it slopes down to the
       * hairline rather than standing out over it, where its underside would
       * be a dark band across the forehead. Tight curls bump its outline from
       * every side.
       */
      const full = (t: number): number => 0.3 + 0.32 * Math.sin((Math.PI / 2) * Math.min(1, t / 0.62));
      const loft = (t: number, lam: number): number => {
        const front = Math.max(0, Math.sin(lam)) ** 2;
        return full(t) * (1 - 0.2 * front * ramp(t, 0.4, 0.8)) - 0.5 * Math.pow(ramp(t, 0.7 - 0.25 * front, 1), 1.3);
      };
      const cap = crownOf({ edge: hairline(2.44, 2.18, 1.65, 1.2), loft, ridge: 0.03, n: 24, rows: 7, under: 'edge' });
      return {
        cap: join(sweep(fr, cap), clusters(fr, cap, [
          [0, 0.85, 0.44], [0.9, 0.88, 0.42], [1.57, 0.92, 0.4], [2.25, 0.88, 0.42], [3.14, 0.85, 0.44], [-0.8, 0.85, 0.44], [-1.57, 0.85, 0.44], [-2.35, 0.85, 0.44],
          [-0.75, 0.4, 0.44], [-1.57, 0.38, 0.44], [-2.39, 0.4, 0.44], [0.12, 0.42, 0.44], [3.02, 0.42, 0.44],
          // Along the hairline over the brow, of sizes a quarter either side of the rest, so the edge there is curls and not a straight cut.
          [1.12, 0.42, 0.33], [1.43, 0.4, 0.4], [1.74, 0.41, 0.36], [2.03, 0.43, 0.3],
        ])),
        tails,
      };
    }
    case 'waves':
    case 'long': {
      // Parted in the middle and falling past the ears: to the shoulders in waves, or halfway down the back straight.
      const wavy = id === 'waves';
      // The corners of the forehead round past the ends of the brows, and high over them, so the hair comes down the
      // side of the face behind the eyes rather than down the temple into a brow.
      const edge = hairline(2.42, 2.2, 0.4, -1, 0, 0.95);
      // The curtain hangs from high on the crown, laid over the back of the head, and the hair either side of the
      // parting runs on round under it to the nape: from behind it is one fall of hair from the crown to the ends.
      const top = CROWN - 0.1, floor = 1.04;
      // Longest at the middle of the back, a little shorter toward the front.
      const end = wavy ? -1.2 : -3.2;
      const fall: Hang = {
        round: [0.5, -Math.PI - 0.5, 18],
        top,
        drape: true,
        // Clear of the hair either side of the parting that runs on under it, ridges and all.
        out: 0.4,
        to: (a) => end + (wavy ? 0.35 : 0.7) * (1 + Math.sin(a)),
        flare: wavy ? 0.5 : 0.36,
        wave: wavy ? [0.32, 3.5] : undefined,
        tip: wavy ? 0.4 : 0.5,
        ridge: 0.1,
      };
      // Against the head down to the jaw, and hanging free below it.
      const split = (top - 0.45) / (top - end);
      for (const s of [-1, 1]) {
        if (wavy) {
          // Waves: a thick lock from behind each ear, over the shoulder and down the front in a slow S, lying close
          // and turned mostly side on, so from the front it is a waving edge to the hair beside the face and not a flap.
          const pts: V3[] = [];
          const w: number[] = [];
          const N = 16;
          for (let k = 0; k <= N; k++) {
            const t = k / N;
            const sway = 0.13 * Math.sin(t * 2.5 * Math.PI) * ramp(t, 0.1, 0.35);
            pts.push([s * (0.02 + 0.12 * ramp(t, 0, 0.3) + sway), 0.05 + 1.1 * ramp(t, 0.15, 0.6), -3 * t]);
            // Coming out from under the hair over its first three points, rather than starting square.
            w.push(k < N ? 0.52 * (1 - t * 0.5) * Math.max(0.1, Math.min(1, k / 3)) : 0);
          }
          tails.push({ at: [s * 1.3, -0.1, 1.45], mesh: lockOf(pts, w, [s, 0.55, 0.1]), give: 0.25, under: true });
          continue;
        }
        // Long: a lock from under the hair behind each temple, down beside the face, then out over the collarbone and
        // down the front. Coming out from under the hair over its first three points rather than starting square, and
        // turned mostly side on, so from the front it is an edge of hair beside the face and not a plank off the cheek.
        const pts: V3[] = [];
        const w: number[] = [];
        const N = 8;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          pts.push([s * (0.02 + 0.22 * Math.sin(t * Math.PI * 0.6)), 0.05 + 1.25 * ramp(t, 0.25, 0.7), -4.75 * t]);
          w.push(k < N ? 0.46 * (1 - t * 0.45) * Math.max(0.1, Math.min(1, k / 3)) : 0);
        }
        tails.push({ at: [s * 1.36, 0.25, 1.95], mesh: lockOf(pts, w, [s, 0.55, 0.1]), give: 0.3, under: true });
      }
      return {
        cap: join(
          parted(0, 0.75, { edge, floor, loft: (t) => 0.14 + 0.14 * Math.sin(Math.PI * t), ridge: 0.08, n: 14, through: true }),
          hang(fr, { ...fall, span: [0, split], rows: 4 }),
        ),
        // Starting a little above where the part against the head stops, so the two overlap and nothing shows between them.
        fall: hang(fr, { ...fall, span: [split * 0.5, 1], rows: wavy ? 5 : 4 }),
        tails,
      };
    }
    case 'ponytail':
      // Drawn back tight to a tie high on the back of the crown, and a full tail falling from it.
      tails.push({
        at: [0, -1.3, 2.9],
        mesh: join(
          ball([0, -0.1, 0], [0.3, 0.24, 0.24], 6, 3, 'brow'),
          chain([[0, -0.08, 0], [0, -0.45, -0.25], [0, -0.72, -1.1], [0, -0.66, -2.2], [0, -0.5, -3.1], [0, -0.4, -3.5]], [0.3, 0.54, 0.54, 0.4, 0.18, 0.03], 6, 'hair'),
        ),
        give: 1,
      });
      return { cap: toward([0, -0.8, 0.6], TIED_CAP), tails };
    case 'topknot':
      // All of it drawn up to a big knot on the crown.
      return {
        cap: toward([0, -0.2, 1], TIED_CAP),
        top: join(
          ball([0, -0.25, CROWN + 0.58], [0.72, 0.7, 0.58], cut(fr, 8, 6, 2), cut(fr, 4, 3), 'hair'),
          ball([0, -0.2, CROWN + 0.08], [0.34, 0.34, 0.12], 6, 2, 'brow'),
        ),
        tails,
      };
    case 'bun':
      // Drawn back to a bun low at the back of the head.
      tails.push({ at: [0, -1.55, 1.75], mesh: join(ball([0, -0.28, 0], [0.64, 0.52, 0.6], cut(fr, 8, 6, 2), cut(fr, 4, 3), 'hair'), ball([0, 0.06, 0], [0.4, 0.14, 0.4], 6, 2, 'brow')), give: 0.12 });
      return { cap: toward([0, -1, 0.05], TIED_CAP), tails };
    case 'braid':
      // Drawn back to the nape and plaited down the back.
      tails.push({ at: [0, -1.16, 1.12], mesh: braid([[0, 0, 0], [0, -0.3, -1], [0, -0.35, -2.1], [0, -0.3, -3.2], [0, -0.25, -4]], 0.3), give: 0.55 });
      // Combed to the back of the head at the height of the ears rather than to the nape, where the locks going round to the ears would run along the hairline instead of across it.
      return { cap: toward([0, -1, -0.1], TIED_CAP), tails };
    case 'braids':
      // Parted in the middle, each half drawn to a braid behind its ear and brought forward over the shoulder.
      for (const s of [-1, 1]) {
        tails.push({ at: [s * 1.2, -0.45, 1.3], mesh: braid([[0, 0, 0], [s * 0.2, 0.25, -0.9], [s * 0.3, 0.5, -1.9], [s * 0.3, 0.6, -2.8]], 0.28), give: 0.4 });
      }
      return { cap: parted(0, 0.6, { edge: hairline(2.45, 2.25, 1.6, 0.9, 0.2), loft: (t) => 0.08 + 0.06 * t, ridge: 0.05, back: 0.55, through: true }), tails };
    case 'locs': {
      /*
       * Locs drawn back off the face and hanging to the shoulders, in two
       * rows: one rooted high on the back of the head, over the place the
       * hair is drawn back to, and one at the nape under it. No two the same
       * length, thickness or hang; and the one at each side brought forward
       * over the shoulder.
       */
      // A fraction that looks drawn at random but is the same every time for the same `k`.
      const jit = (k: number): number => {
        const x = Math.sin(k * 12.9898 + 4.1) * 43758.5453;
        return x - Math.floor(x);
      };
      const loc = (a: number, z: number, len: number, r: number, bend: number, k: number): void => {
        const [rxx, ryy, cy] = skull(fr, z);
        // Its root sunk in the hair, thin, so no end of it shows.
        const x = Math.cos(a) * rxx * 0.88, y = cy + Math.sin(a) * ryy * 0.88;
        // Out a little over the back as it falls, and bent to one side or the other.
        const ox = Math.cos(a), oy = Math.sin(a);
        const pts: V3[] = [0, 0.12, 0.4, 0.72, 1].map((t) => [ox * (0.16 + 0.24 * t) - oy * bend * Math.sin(t * 1.8), oy * (0.17 + 0.26 * t) + ox * bend * Math.sin(t * 1.8), -len * t]);
        tails.push({ at: [x, y, z], mesh: chain(pts, [r * 0.5, r, r * 0.95, r * 0.85, r * 0.45], fr.lod < 1 ? 4 : 5, 'hair'), give: 0.35 + 0.25 * jit(k + 100) });
      };
      // Every other one, and each that much fuller, where a figure is drawn small enough that a loc is a pixel across:
      // each is a piece that swings on its own, and so drawn on its own.
      const every = fr.lod < 1 ? 2 : 1, fuller = fr.lod < 1 ? 1.3 : 1;
      // The row at the nape, round the back from ear to ear.
      for (let k = 1; k < 12; k += every) loc(Math.PI * (1.04 + (k / 12) * 0.92) + (jit(k) - 0.5) * 0.14, 1.02 + 0.4 * jit(k + 20), 2.2 + 1.4 * jit(k + 40), (0.17 + 0.09 * jit(k + 60)) * fuller, (jit(k + 80) - 0.5) * 0.6, k);
      // The row over it, high on the back of the head, falling to about as low.
      for (let k = 0; k < 5; k += every) {
        const z = 2.15 + 0.35 * jit(k + 120);
        loc(-Math.PI / 2 + (k - 2) * 0.3 + (jit(k + 140) - 0.5) * 0.1, z, z - 1.0 + 2.2 + 1.2 * jit(k + 160), (0.19 + 0.07 * jit(k + 180)) * fuller, (jit(k + 200) - 0.5) * 0.5, k + 20);
      }
      // And one from each side forward over the shoulder and down the front.
      for (const side of [-1, 1]) {
        const [rxx, ryy, cy] = skull(fr, 1.75);
        const a = side > 0 ? -0.35 : Math.PI + 0.35;
        tails.push({
          at: [Math.cos(a) * rxx * 0.88, cy + Math.sin(a) * ryy * 0.88, 1.75],
          mesh: chain([[0, 0, 0], [side * 0.2, 0.05, -0.3], [side * 0.36, 0.35, -1.0], [side * 0.5, 0.95, -2.05], [side * 0.44, 1.25, -3.3]], [0.1, 0.2, 0.19, 0.17, 0.09], fr.lod < 1 ? 4 : 5, 'hair'),
          give: 0.3,
        });
      }
      // The hair lies on the scalp along three parts that divide it into sections, and every lock stands proud by its own amount.
      const parts = [Math.PI / 2 - 0.85, Math.PI / 2, Math.PI / 2 + 0.85];
      const lift = (lam: number): number => ramp(Math.min(...parts.map((q) => Math.abs(Math.atan2(Math.sin(lam - q), Math.cos(lam - q))))), 0.06, 0.26);
      return {
        cap: toward([0, -1, 0.25], {
          edge: hairline(2.4, 2.15, 1.72, 0.9),
          loft: (t, lam) => (0.05 + 0.13 * lift(lam)) * (0.6 + 0.4 * Math.sin(Math.PI * t)),
          ridge: (end) => 0.04 + 0.12 * jit(Math.round(end * 40)),
          n: 28,
          even: true,
        }),
        tails,
      };
    }
    case 'ridge':
      // A crest from the brow to the nape over shaved sides, highest over the crown.
      return {
        cap: shaved(),
        top: crest(fr, 0.62, Math.PI + 0.5, (t) => 0.3 + 0.55 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.25)), 0.8), 0.3),
        tails,
      };
    case 'undercut':
      // Shaved at the back and sides, long on top and swept up and back off the forehead.
      return {
        cap: join(
          shaved(2.5),
          toward([0, -0.7, 0.72], {
            edge: hairline(2.55, 2.45, 2.45, 2.4),
            loft: (t, lam) => 0.16 + 0.46 * Math.pow(Math.max(0, Math.sin(lam)), 1.1) * Math.pow(Math.sin(Math.PI * ramp(t, 0.2, 1)), 0.7),
            ridge: 0.1,
            tip: 0.22,
            rows: 5,
          }),
        ),
        tails,
      };
    case 'tonsure':
      // The crown shaved bare in a ring of hair.
      return { cap: crown({ bare: 0.62, edge: hairline(2.35, 2.15, 1.9, 0.8, 0.25), loft: () => 0.12, ridge: 0.05, tip: 0.1, rows: 3 }), tails };
    default:
      return hairOf(fr, 'short');
  }
}

/**
 * The seven beards: a shell over the jaw, from the chin to the cheek, and
 * what hangs from it. Below the lower lip at the front, so the mouth is still
 * there to smile with, and up to the sideburns at the ears.
 */
function beardOf(fr: Frame, id: string): Mesh | undefined {
  const chin = headRings(fr)[0][0];
  const jaw = (below: number, loft: number, mat: Mat = 'hair'): Mesh => {
    const spec: ShellSpec = {
      arc: [0.02 * Math.PI, 0.98 * Math.PI],
      lo: (a) => 1.25 - (1.25 - below) * Math.pow(Math.sin(a), 0.8),
      // Up to the sideburn at the ear, but low across the cheek between -- under the cheekbone, well clear of the eye
      // and the nose -- so that a beard is hair on the jaw and not a mask over the face.
      hi: (a) => 0.88 + 0.77 * Math.pow(1 - Math.sin(a), 1.5),
      lift: 0,
      loft: (a) => loft * (0.5 + 0.5 * Math.sin(a)),
      n: 10,
      rows: 3,
      mat,
    };
    const outer = shell(fr, spec);
    if (mat !== 'hair') return outer;
    // Its underside, from the lower edge in to the skin -- or, where it hangs below the chin, back
    // under the jaw to the front of the neck -- so that it is a mass of hair and not a mask, and has
    // a depth from the side.
    const [a0, a1] = spec.arc!;
    const n = cut(fr, spec.n!, 8);
    const v: V3[] = [];
    for (let j = 0; j <= n; j++) {
      const a = a0 + ((a1 - a0) * j) / n;
      const z = spec.lo(a), l = spec.loft(a, z);
      const [rxx, ryy, cy] = skull(fr, z);
      v.push([Math.cos(a) * (rxx + l), cy + Math.sin(a) * (ryy + l), z]);
      const up = Math.max(z, chin);
      const [rx2, ry2, cy2] = skull(fr, up);
      const y = cy2 + Math.sin(a) * ry2;
      v.push([Math.cos(a) * rx2, y + (THROAT - y) * Math.min(1, (up - z) / 0.4), up]);
    }
    const f: Face[] = [];
    for (let j = 0; j < n; j++) f.push(faceOut(v, [2 * j, 2 * j + 1, 2 * j + 3, 2 * j + 2], [0, -0.4, -1], mat));
    return join(outer, mesh(v, f));
  };
  const moustache = (): Mesh => chain([[-0.46, 1.36, 1.02], [-0.2, 1.52, 1.14], [0.2, 1.52, 1.14], [0.46, 1.36, 1.02]], [0.07, 0.11, 0.11, 0.07], 4, 'hair');
  switch (id) {
    case 'stubble':
      // A shadow on the skin of the jaw and no further: it stops where the chin does.
      return jaw(0.25, 0.025, 'stubble');
    case 'moustache':
      return moustache();
    case 'goatee':
      return join(moustache(), chain([[0, 1.36, 0.5], [0, 1.3, 0], [0, 1.12, -0.4]], [0.22, 0.2, 0.08], 5, 'hair'));
    case 'short':
      return join(jaw(0.08, 0.1), moustache());
    case 'full':
      return join(jaw(-0.45, 0.22), moustache());
    case 'long':
      return join(jaw(-0.45, 0.22), moustache(), chain([[0, 1.15, 0], [0, 1.3, -1.1], [0, 1.3, -2.1], [0, 1.15, -2.8]], [0.62, 0.5, 0.3, 0.06], 6, 'hair'));
    default:
      return undefined;
  }
}

/* ---- the kit a look is built from, and kept ------------------------------------ */

interface Kit {
  fr: Frame;
  pelvis: Mesh;
  skirt: Mesh;
  belt: Mesh;
  abdomen: Mesh;
  chest: Mesh;
  neck: Mesh;
  head: Mesh;
  blink: Mesh;
  nose: Mesh;
  ears: Mesh;
  hair: HairKit;
  beard?: Mesh;
  upper: Mesh;
  lower: Mesh;
  /** Left and right, each with its thumb on the inside: fists, open, and hanging loose. */
  hands: [Mesh, Mesh];
  open: [Mesh, Mesh];
  loose: [Mesh, Mesh];
  /** What is in each hand while at work. */
  mallet: Mesh;
  chisel: Mesh;
  thigh: Mesh;
  shin: Mesh;
  boot: Mesh;
  foot: Mesh;
}

/** A boot's foot, in the ankle's frame: heel, instep and toe over a sole of its own colour. */
function footMesh(): Mesh {
  const v: V3[] = [
    [-0.37, -0.58, -0.75], [0.37, -0.58, -0.75], [0.35, 1.72, -0.75], [-0.35, 1.72, -0.75],
    [-0.38, -0.6, -0.6], [0.38, -0.6, -0.6], [0.36, 1.78, -0.6], [-0.36, 1.78, -0.6],
    [-0.38, -0.52, 0.02], [0.38, -0.52, 0.02], [0.37, 0.62, -0.14], [-0.37, 0.62, -0.14],
    [0.3, 1.74, -0.36], [-0.3, 1.74, -0.36],
  ];
  const f: Face[] = [
    faceOut(v, [0, 1, 2, 3], [0, 0, -1], 'sole'),
    faceOut(v, [0, 1, 5, 4], [0, -1, 0], 'sole'), faceOut(v, [1, 2, 6, 5], [1, 0, 0], 'sole'),
    faceOut(v, [2, 3, 7, 6], [0, 1, 0], 'sole'), faceOut(v, [3, 0, 4, 7], [-1, 0, 0], 'sole'),
    faceOut(v, [4, 5, 9, 8], [0, -1, 0], 'boot'),
    faceOut(v, [5, 6, 12, 10, 9], [1, 0, 0], 'boot'), faceOut(v, [7, 4, 8, 11, 13], [-1, 0, 0], 'boot'),
    faceOut(v, [6, 7, 13, 12], [0, 1, 0.3], 'boot'),
    faceOut(v, [8, 9, 10, 11], [0, 0.2, 1], 'boot'),
    faceOut(v, [11, 10, 12, 13], [0, 0.5, 1], 'boot'),
  ];
  return mesh(v.map((p) => [p[0] * 1.08, p[1] * 1.04, p[2]] as V3), f);
}

/**
 * A tube down a leg made straight in the knee's terms (`kneeBent`): `rs` its
 * rings bottom first, one of them at the knee (`z` nought). In two, the thigh
 * down to that ring and the shin from it, each a part on its own bone and
 * drawn as one, which is what lets either be drawn over the other where it is
 * nearer. The two share the ring at the knee, edge to edge at every bend, and
 * neither is inked along it, so the leg is one outline and not a thigh and a
 * shin with a line round the knee between them.
 */
function legTube(rs: number[][], n: number, mat: Mat | ((band: number, j: number) => Mat), shut = false): { thigh: Mesh; shin: Mesh } {
  const knee = rs.findIndex((r) => r[0] === 0);
  const m = (band: number, j: number): Mat => (typeof mat === 'function' ? mat(band, j) : mat);
  const half = (from: number, to: number, foot: boolean): Mesh => {
    const t = rings(rs.slice(from, to + 1), n, (band, j) => m(band + from, j), { top: false, bottom: foot });
    const z0 = rs[from][0];
    return {
      ...t,
      f: t.f.map((f) => (f.i.every((i) => t.v[i][2] === z0) && foot ? { ...f, seam: true } : f.i.some((i) => t.v[i][2] === 0) ? { ...f, soft: true } : f)),
    };
  };
  // `shut`: the foot of the shin closed, the lid a seam (`Face.seam`), for a leg that comes down to the foot -- kicked up behind at a
  // run, the open end of it was turned to the viewer, a ring with nothing in it.
  return { thigh: half(knee, rs.length - 1, false), shin: half(0, knee, shut) };
}

/** A winding round a limb: every ring tipped across it, so the bands slant round it rather than going round it level. */
const wound = (m: Mesh, slant = 0.14): Mesh => ({ ...m, v: m.v.map(([x, y, z]): V3 => [x, y, z + slant * x]) });

/**
 * How wide a thigh is at the top: wider on wider hips, but by less than they
 * are. Grown with them all the way, a woman's thighs stood out past the hem of
 * a skirt at either side.
 */
const thighTop = (fr: Frame): number => 0.55 + 0.45 * fr.hi;

function grownHair(h: HairKit): HairKit {
  return {
    cap: h.cap && grown(h.cap),
    top: h.top && grown(h.top),
    fall: h.fall && grown(h.fall),
    tails: h.tails.map((t) => ({ ...t, at: bigger(t.at), mesh: grown(t.mesh) })),
  };
}

/*
 * The breast: the ring across the chest made deeper by `BUST` of itself on a
 * woman's frame, and carried forward by as much again, so the back stays
 * where it was and the front comes out by twice that. It was deeper by a
 * little over a tenth and no further forward, which spread it round the back
 * as much as the front -- on a woman in the same tunic and haircut as a man
 * it did not show at all, from the front or the side.
 */
const BUST = 0.17;
/** The ring across the chest, `g` times the body's own round: [height, half width, half depth, across, forward]. */
const bustRing = (fr: Frame, g: number): number[] => [0.9, 1.9 * fr.sh * g, 1.34 * bustDeep(fr) * g, 0, 0.05 + bustAhead(fr, g)];
/** How much deeper the chest is than a man's, and how much further forward its middle, `g` times the body's own round. */
const bustDeep = (fr: Frame): number => 1 + fr.fem * BUST;
const bustAhead = (fr: Frame, g: number): number => 1.34 * fr.fem * BUST * g;

/*
 * The arm, modelled as one limb that bends rather than two tubes hinged. The
 * upper arm's shell stops at the elbow in a ring and the forearm's starts in
 * the same ring, edge to edge, neither reaching into the other: drawn one
 * over the other by the painter, a tube's end inside another was drawn on
 * top of it, a disc or a stub standing out of the crook. Each has a ring
 * where the bend ends on its side of the elbow (`ELBOW_BEND`), so the bend
 * is spread over the three (`bentAtElbow`), and is open at the elbow, its
 * rim not inked, so the join is no line at all.
 *
 * Bottom first, as `rings` wants them: the other way up turns every facet
 * inside out, and a tube drawn from its inside is lit on the wrong side and
 * shows its far end through itself.
 */
/** Where the bend at the elbow begins above it and is all done below it, in tenths of a metre. */
const ELBOW_BEND = 0.6;
/** How much of the way in to the bone the inside of an elbow bent double is drawn (`bentAtElbow`). */
const ELBOW_PINCH = 0.7;
/** The ring round the elbow, `g` times the arm's own round: where a shell on the upper arm ends and the forearm's begins. */
const elbowRing = (g: number): number[] => [0, 0.62 * g, 0.59 * g];
/**
 * The top of the upper arm, bottom first, `g` times the bare arm's round, for the right arm (the left is its mirror): full over
 * the deltoid and rounding in over the top of it, and drawn in toward the body as it goes up, so that its top is under the slope
 * of the shoulder rather than a lid standing up beside it -- seen from the front, the shoulder's line runs down off the chest
 * and round the outside of the arm in one curve. The ring at the bottom is where the shoulder's give (`bentAtShoulder`) ends.
 */
const deltoid = (arm: number, g: number): number[][] => [
  [-0.7, 0.8 * arm * g, 0.77 * g, -0.04], [-0.15, 0.84 * arm * g, 0.8 * g, -0.12], [0.26, 0.56 * arm * g, 0.54 * g, -0.28],
];
/** The faces with a corner at height `z` not inked along their open rim there: see `Face.soft`. */
const softAt = (m: Mesh, z: number): Mesh => ({ ...m, f: m.f.map((f) => (f.i.some((i) => Math.abs(m.v[i][2] - z) < 1e-6) ? { ...f, soft: true } : f)) });

/**
 * The bare upper arm in the tunic's short sleeve, the elbow `UPPER` below the
 * shoulder: skin from the elbow up to the sleeve's hem, well clear of the
 * bend (`ELBOW_BEND`, and `HEM_CLEAR` over it) so that the skin bends and the
 * sleeve never does -- bent in the crook, a hem there stood out through the
 * forearm in front of it; the hem turned in to the skin under it, in the
 * sleeve's own colour, which the shade it faces into darkens (lit, with the
 * arm raised toward the viewer it was a pale ring, and in the trim, with the
 * arm swung back at a run, a dark notch in the sleeve); a band of the trim
 * round it; and the sleeve up over the shoulder (`deltoid`), its top a seam
 * into the tunic, never inked.
 */
const HEM_CLEAR = 0.35;
function bareUpper(fr: Frame): Mesh {
  const U = UPPER * fr.tall, arm = 0.9 + fr.sh * 0.1, hem = -U + ELBOW_BEND + HEM_CLEAR;
  const [, ex, ey] = elbowRing(0.9);
  const m = rings([
    [-U, ex, ey], [-U + ELBOW_BEND, 0.6, 0.57], [hem, 0.62, 0.59], [hem, 0.72, 0.7], [hem + 0.22, 0.73, 0.71], ...deltoid(arm, 1),
  ], 6, (band) => (band <= 1 ? 'skin' : band === 3 ? 'trim' : 'tunic'), { bottom: false });
  // The turn of the hem into the sleeve a seam (`Face.seam`): seen up the sleeve with the arm swung back, inked, it was a ring
  // drawn in the mouth of the sleeve.
  return softAt(seamed(seamed(m, (p) => p[2] > 0), (p) => Math.abs(p[2] - hem) < 1e-6), -U);
}

/** The bare forearm, from the elbow's ring down to the wrist: fullest a little under the elbow, as a forearm is, and narrowing to the wrist. */
function bareLower(): Mesh {
  const [, ex, ey] = elbowRing(0.9);
  return softAt(rings([[-2.3, 0.44, 0.41], [-1.0, 0.56, 0.52], [-ELBOW_BEND, 0.58, 0.55], [0, ex, ey]], 6, 'skin', { top: false }), 0);
}

function kitOf(look: Look, lod: number): Kit {
  const fr = frameOf(look, lod);
  const beard = beardOf(fr, look.beard);
  const sw = (fr.sh + fr.wa) / 2;
  const chest = rings([
    [-0.1, 1.58 * sw, 1.22, 0, 0], bustRing(fr, 1), [1.7, 2.06 * fr.sh, 1.22, 0, -0.04], [2.24, 1.3 * fr.sh, 0.74, 0, -0.08],
  ], 8, 'tunic', { bottom: false });
  // The neck of the tunic: open in a V at the throat, from the neck down the upper facet of the chest.
  const top = 0.74 * Math.sin((3 * Math.PI) / 8) - 0.08, below = 1.22 * Math.sin((3 * Math.PI) / 8) - 0.04;
  const front = (z: number): number => top + ((2.24 - z) / 0.54) * (below - top) + 0.03;
  const vee: V3[] = [[-0.3, front(2.235), 2.235], [0.3, front(2.235), 2.235], [0, front(1.72), 1.72]];
  const collar = decals([{ q: newell(vee)[1] < 0 ? [...vee].reverse() : vee, m: 'skin' }]);
  return {
    fr,
    // Open at the top, where the body goes down into it: closed, the lid was sorted over the coat's back by its middle when the body
    // leant into a run, a pale oval of trouser in the belt seen from behind.
    pelvis: rings([[-1, 1.36 * fr.hi, 1.12, 0, -0.05], [0.3, 1.55 * fr.hi, 1.2, 0, -0.05], [1.15, 1.45 * fr.wa, 1.14]], 8, 'trousers', { top: false }),
    // A band of the darker trim round the hem.
    skirt: rings([[-1.35, 1.92 * fr.hi, 1.55], [-1.08, 1.9 * fr.hi, 1.53], [0.2, 1.74 * fr.hi, 1.36], [1.25, 1.53 * fr.wa, 1.22]], 8, (band) => (band === 0 ? 'trim' : 'tunic'), { top: false, bottom: false }),
    belt: join(
      rings([[0.98, 1.6 * fr.wa, 1.28], [1.42, 1.6 * fr.wa, 1.28]], 8, 'belt', { top: false, bottom: false }),
      decals([plate([0, 1.31, 1.2], [0.22, 0, 0], [0, 0, 0.21], [0, 1, 0], 'buckle')]),
    ),
    abdomen: rings([[-0.35, 1.45 * fr.wa, 1.16], [1.95, 1.6 * sw, 1.22]], 8, 'tunic', { top: false, bottom: false }),
    chest: join(chest, collar),
    // Up inside the skull, so there is no gap under the back of the head, and thick enough not to be a stick under it close to.
    neck: rings([[-0.3, 0.74 - fr.fem * 0.08, 0.7 - fr.fem * 0.08], [1.45, 0.62 - fr.fem * 0.06, 0.58 - fr.fem * 0.06, 0, 0.1]], 6, 'skin', { top: false, bottom: false }),
    head: grown(headMesh(fr, false)),
    blink: grown(headMesh(fr, true)),
    nose: grown(noseOf(fr)),
    ears: grown(earsOf(fr)),
    hair: grownHair(hairOf(fr, look.hair)),
    beard: beard ? grown(beard) : undefined,
    upper: bareUpper(fr),
    lower: bareLower(),
    hands: [-1, 1].map((s) => handSized(join(
      // Bottom first, so the facets face out (see `bareUpper`).
      rings([[-1.1, 0.38, 0.24], [-0.5, 0.52, 0.31], [0.08, 0.42, 0.27]], 6, 'skin'),
      chain([[-s * 0.18, 0.12, -0.22], [-s * 0.26, 0.3, -0.52], [-s * 0.22, 0.36, -0.78]], [0.14, 0.12, 0.07], 4, 'skin'),
    ))) as [Mesh, Mesh],
    // Open: a flat palm, broad, four fingers spread in a fan -- the outer two nearly a third of a right angle out
    // from the line of the hand, far enough apart at the tips for a pixel or two of what is behind to show between
    // them at zoom four -- and the thumb out from them, the palm on the side a fist's is. Spread, and as much bigger
    // than the fist as a hand opened out is, so that one held up a few pixels across is a hand and not a mitten.
    open: [-1, 1].map((s) => handSized(grownBy(1.15, join(
      rings([[-0.88, 0.17, 0.49], [-0.5, 0.22, 0.5], [0.08, 0.23, 0.38]], 6, 'skin'),
      ...([[0.35, 0.52, 28], [0.12, 0.6, 9], [-0.12, 0.56, -9], [-0.35, 0.44, -28]] as Array<[number, number, number]>).map(([y, l, a]) =>
        fine(chain([[0, y, -0.84], [0, y + l * Math.sin(a * DEG), -0.84 - l * Math.cos(a * DEG)]], [0.12, 0.09], 4, 'skin'), 0.24 * 1.15 * HAND)),
      fine(chain([[-s * 0.06, 0.32, -0.18], [-s * 0.08, 0.62, -0.46], [-s * 0.08, 0.78, -0.74]], [0.13, 0.11, 0.08], 4, 'skin'), 0.26 * 1.15 * HAND),
    )))) as [Mesh, Mesh],
    // Hanging loose at a walk: the fingers together and a little curled toward the palm, flat across and as broad as the open
    // hand, with the thumb lying along the front of it -- longer and flatter than the fist, which is what reads as a hand not
    // holding anything rather than one clenched on nothing.
    loose: [-1, 1].map((s) => handSized(join(
      rings([[-1.2, 0.15, 0.3, -s * 0.07, 0.04], [-0.86, 0.19, 0.42, -s * 0.03, 0.02], [-0.45, 0.22, 0.45], [0.08, 0.24, 0.37]], 6, 'skin'),
      chain([[-s * 0.1, 0.3, -0.18], [-s * 0.16, 0.42, -0.46], [-s * 0.16, 0.42, -0.7]], [0.12, 0.1, 0.07], 4, 'skin'),
    ))) as [Mesh, Mesh],
    // A mallet through the fist, its haft out past the thumb and its head square across the end, faced the way the palm is.
    mallet: join(
      chain([[0, -0.45, GRIP], [0, MALLET_HEAD[1], GRIP]], [0.11, 0.1], 4, 'haft'),
      chain([[-0.45, MALLET_HEAD[1], GRIP], [0.45, MALLET_HEAD[1], GRIP]], [0.3, 0.3], 4, 'iron'),
    ),
    // A chisel through the other fist: the handle up out of it to where it is struck, and the blade down.
    chisel: join(
      chain([[0, -0.25, GRIP], [0, CHISEL_TOP[1], GRIP]], [0.14, 0.18], 5, 'haft'),
      chain([[0, -0.25, GRIP], [0, -1.05, GRIP]], [0.1, 0.03], 4, 'iron'),
    ),
    // From up inside the hips, so a thigh swung forward or back does not come out from under them, to the knee and down into the boot,
    // with the calf a little fuller behind under the knee.
    ...legTube([[-1.6, 0.7, 0.74], [-KNEE_SPAN, 0.78, 0.82, 0, -0.03], [0, 0.8, 0.84], [KNEE_SPAN, 0.84, 0.88], [THIGH * fr.tall - 0.8, thighTop(fr), 1.04]], 6, 'trousers', true),
    // Bottom first, so the facets face out: made top first it was inside out, its far side drawn in its place and lit as the near
    // side would be from the other side, and a shin folded up behind at a run showed the inside of the shaft.
    boot: rings([[-3.15, 0.61, 0.64], [-3.02, 0.66, 0.7], [-1.66, 0.72, 0.76], [-1.62, 0.8, 0.84], [-1.3, 0.84, 0.88]], 6, (band) => (band === 3 ? 'cuff' : 'boot'), { top: false }),
    foot: footMesh(),
  };
}

const kits = new Map<string, Kit>();
function kitFor(look: Look, lod = 1): Kit {
  const key = `${look.gender}|${look.hair}|${look.beard}|${lod}`;
  let k = kits.get(key);
  if (!k) {
    k = kitOf(look, lod);
    kits.set(key, k);
    if (kits.size > 160) kits.delete(kits.keys().next().value as string);
  }
  return k;
}

/* ---- posing ------------------------------------------------------------------- */

export type Euler = [number, number, number];

/** A pose: every joint's turn, in degrees, and where the body is. Exported for the spells' cast poses (`./spells`). */
export interface Rig {
  at: V3;
  pelvis: Euler;
  spine: Euler;
  chest: Euler;
  neck: Euler;
  head: Euler;
  /** Each side, left then right: [forward, out from the body, turned in]. */
  arm: [Euler, Euler];
  elbow: [number, number];
  hand: [Euler, Euler];
  leg: [Euler, Euler];
  knee: [number, number];
  /** Toe up, over and above whatever keeps the foot flat. */
  foot: [number, number];
  /** Keep the foot flat to the ground whatever the leg above it is doing. */
  flat: [boolean, boolean];
  /** How hair that hangs is swinging: back, and to the side. */
  tail: Euler;
  /** Off the ground, a hop's worth. */
  lift: number;
  /** In water to the chest, a swimmer: the body is let down this far rather than stood on its feet. */
  sink: number;
  /** A swimmer's head, held this far over the water whatever the body under it is doing; the water is where the feet were. */
  float?: number;
  /** How far a swimmer is under way rather than treading water, nought to one: blended, so the rings of the one fade in over the other. */
  under?: number;
  /** Sat down, on a seat this high over the floor the feet are on, and astride or not: see `Seat`. */
  sit?: { up: number; astride: boolean };
  /** What a driver has in hand: see `Seat`. */
  seat?: Seat;
  /** How slack the reins hang, from taut (nought) to let go (one). */
  slack?: number;
  /** A pair of oars, right then left: each turned about its rowlock, out over the water, and its blade turned flat to the air from square to it by `feather`. */
  oars?: Array<{ lock: V3; out: V3; feather: number; splash?: number }>;
  blink: boolean;
  reins: boolean;
  /** A mallet in the right hand and a chisel in the left. */
  tool: boolean;
  /** The pose mirrored left for right, and whatever is in the hands with it. */
  lefty: boolean;
  /**
   * A run carried on a curve rather than stood on whichever foot is lowest:
   * `h` above where the hips are at mid-stance, `w` of the way (nought at a
   * walk, one at a run), and the stance leg's thigh and knee angles at
   * mid-stance, which is what says where the hips are then; and the gait,
   * nought walking and one running. Never lower than a foot on the ground
   * allows.
   */
  hover?: { h: number; w: number; thigh: number; knee: number; g: number };
  /** Each shoulder raised this far, for an arm lifted high. */
  shrug: [number, number];
  /** How firmly each foot is on the ground, for the body carried on a curve: its knee gives or straightens to keep it there. */
  plant?: [number, number];
  /** Each hand open rather than closed. */
  open: [boolean, boolean];
  /** Each hand hanging loose, neither open nor closed: walking with nothing in it. */
  loose: [boolean, boolean];
  /** The hands wanted for something else -- work, the water, the reins, a wave or a hop -- and whatever they held put away. */
  stowed: boolean;
  /** Which shoulder something heavy is carried over: the right (1), or the left (0) from where the right would put it behind the head. */
  carried: number;
  /** How much further it is turned about itself there, in degrees, to show its head to the viewer. */
  spin: number;
  /**
   * A weapon in the right fist carried by the forearm rather than set off the hips, this share of the way: a blow
   * struck by a spell (`./spells`), where the swing of the arm has to be the swing of the blade. Nought or absent
   * is the carry as it always was.
   */
  wield?: number;
}

function rest(): Rig {
  return {
    at: [0, 0, 0], pelvis: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    arm: [[4, 8, 0], [4, 8, 0]], elbow: [10, 10], hand: [[0, 0, 0], [0, 0, 0]],
    leg: [[0, 2, 0], [0, 2, 0]], knee: [3, 3], foot: [0, 0], flat: [true, true],
    tail: [0, 0, 0], lift: 0, sink: 0, blink: false, reins: false, tool: false, lefty: false, shrug: [0, 0], open: [false, false], loose: [false, false], stowed: false, carried: 1, spin: 0,
  };
}

/** The same pose the other way about, left for right. */
function mirror(r: Rig): void {
  const m = (e: Euler): Euler => [e[0], -e[1], -e[2]];
  r.at = [-r.at[0], r.at[1], r.at[2]];
  r.pelvis = m(r.pelvis);
  r.spine = m(r.spine);
  r.chest = m(r.chest);
  r.neck = m(r.neck);
  r.head = m(r.head);
  r.tail = m(r.tail);
  // The limbs are already set down alike for both sides, so each takes the other's angles; a hand's turn about the arm is the one thing that flips.
  r.arm = [r.arm[1], r.arm[0]];
  r.elbow = [r.elbow[1], r.elbow[0]];
  r.hand = [m(r.hand[1]), m(r.hand[0])];
  r.leg = [r.leg[1], r.leg[0]];
  r.knee = [r.knee[1], r.knee[0]];
  r.foot = [r.foot[1], r.foot[0]];
  r.flat = [r.flat[1], r.flat[0]];
  r.shrug = [r.shrug[1], r.shrug[0]];
  r.open = [r.open[1], r.open[0]];
  r.loose = [r.loose[1], r.loose[0]];
  if (r.plant) r.plant = [r.plant[1], r.plant[0]];
  r.lefty = !r.lefty;
}

/**
 * What somebody driving is sat on, and what is in their hands, in the
 * body's own frame from where its feet are put -- the floor of a cart's box
 * or a boat, or a saddle -- across to the right, forward, and up. A driver
 * was a body stood on that floor with its thighs held out level, so it sat
 * on the air above a bench a hand lower, or with its feet on a boat's
 * gunwale, holding reins out over the water to nothing.
 */
export interface Seat {
  /** The reins of a team or a mount, a pair of oars, or a boat's tiller. */
  hands: 'reins' | 'oars' | 'tiller';
  /** The top of what is sat on, over the floor the feet are put on: nought on a saddle, which is where the feet are put. */
  up: number;
  /** Astride a beast's back with the legs down either side of it, rather than sat with the feet on a floor. */
  astride?: boolean;
  /** Where the reins run to; the right-hand oar's rowlock (the left's is its mirror); the end of the tiller. */
  grip: V3;
  /**
   * The near side of what is sat in, on the screen from the feet at zoom
   * one, for whatever of the body is down behind it: the outline of the
   * whole of it from outside, and the rim round the open top that is seen
   * down into. Reins and oars, which come out over the top, are not hidden.
   */
  sides?: { outline: Pt[]; rim: Pt[] };
}

/** What the game says a body is doing: the same fields a player's pose has always had. */
export interface FigurePose {
  phase: number;
  moving: boolean;
  /** 0 at a walk, 1 at a run. */
  gait?: number;
  /** Which of the eight ways it faces: nought straight at you, two to screen right. */
  facing: number;
  swimming: boolean;
  working: boolean;
  driving?: boolean;
  /**
   * For a body `driving`, what it is sat on and what its hands are doing
   * there; a cart's box with the reins when left out. With it, `facing` may
   * be between two of the eight ways, square along whatever is sat in.
   */
  seat?: Seat;
  tunic?: string;
  trousers?: string;
  look?: Look;
  emote?: string;
  emoteT?: number;
  /**
   * Who this is, for a body drawn frame after frame: with it, going from
   * standing to walking, into the water or down to work is a blend over a
   * fifth of a second rather than a jump, and turning from one of the eight
   * ways to the next is a quick turn rather than a cut.
   */
  id?: string;
  /** What is worn and held, each piece drawn on the body in its own material, dye and rarity. */
  gear?: GearLook;
  /**
   * A spell part way through being cast: which, and how far through it, nought to one. What it does to the body
   * is the spell's own (`./spells`, registered with `castPosesBy`), laid over whatever else the body is doing --
   * over the arms and the trunk only while it walks, swims or drives.
   */
  cast?: { id: string; t: number };
}

/*
 * Feet that stay where they are put. Standing, working and hopping were
 * posed joint by joint, the hips swayed over to one foot and rolled, and the
 * legs swung with them: the feet slid most of a tenth of a metre across the
 * ground each time the weight changed legs, and the free one stood on
 * nothing. Now where each ankle stands is said first and the leg is solved
 * to it from wherever the hips have been put -- the thigh's pitch and roll
 * and the knee's bend that reach it exactly -- so the hips can sway, drop
 * and turn over planted feet.
 */

/** Where the ankles stand at rest, in the frame the body is stood in: a little wider than the hips, the left a little ahead, toes turned out. */
function stance(fr: Frame): [V3, V3] {
  const T = fr.tall, z = HIP * T - 0.1 - (THIGH + SHIN) * T + 0.06;
  return [[-(fr.hi + 0.3), 0.2, z], [fr.hi + 0.3, -0.12, z]];
}
/** How far each foot is turned out at rest, in degrees: the leg's turn in, negative. */
const TOE_OUT = -6;

/** The hips' height, as `r.at[2]`, that leaves leg `k` bent `bend` degrees at the knee to reach `ankle`. */
function hipsFor(r: Rig, fr: Frame, k: number, ankle: V3, bend: number): number {
  const T = fr.tall, a = THIGH * T, b = SHIN * T, s = k ? 1 : -1;
  const pelvis = joint(ROOT, [r.at[0], r.at[1], 0], ...r.pelvis);
  const hip = place(pelvis, [s * fr.hi, 0, -0.1]);
  const reach = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(bend * DEG));
  const dx = ankle[0] - hip[0], dy = ankle[1] - hip[1];
  return ankle[2] + Math.sqrt(Math.max(0, reach * reach - dx * dx - dy * dy)) - hip[2] - HIP * T;
}

/**
 * Leg `k` put down with its ankle at `ankle`, in the frame the body is
 * stood in, from the hips as `r` has them: the thigh pitched and rolled and
 * the knee bent so the ankle is there, the leg's turn kept. Out of reach, it
 * reaches straight toward it.
 */
function plant(r: Rig, fr: Frame, k: number, ankle: V3): void {
  const T = fr.tall, a = THIGH * T, b = SHIN * T, s = k ? 1 : -1;
  const pelvis = joint(ROOT, [r.at[0], r.at[1], HIP * T + r.at[2]], ...r.pelvis);
  const hip = place(pelvis, [s * fr.hi, 0, -0.1]);
  const m = pelvis.m, w: V3 = [ankle[0] - hip[0], ankle[1] - hip[1], ankle[2] - hip[2]];
  // Into the hips' frame, and the leg's own turn about itself undone.
  const d = mv(rz(-s * r.leg[k][2] * DEG), [m[0] * w[0] + m[3] * w[1] + m[6] * w[2], m[1] * w[0] + m[4] * w[1] + m[7] * w[2], m[2] * w[0] + m[5] * w[1] + m[8] * w[2]]);
  const far = Math.hypot(d[0], d[1], d[2]) || 1, L = Math.min(a + b - 1e-3, far);
  const x = (d[0] * L) / far, y = (d[1] * L) / far, z = (d[2] * L) / far;
  const knee = Math.acos(Math.max(-1, Math.min(1, (L * L - a * a - b * b) / (2 * a * b))));
  // Straight down the leg, the ankle is the thigh's length and the shin's, bent back by the knee; pitched forward, then rolled out.
  const pitch = Math.atan2(y, Math.hypot(x, z)) - Math.atan2(-b * Math.sin(knee), a + b * Math.cos(knee));
  const roll = Math.atan2(-x, -z);
  r.leg[k] = [pitch / DEG, (-s * roll) / DEG, r.leg[k][2]];
  r.knee[k] = knee / DEG;
}

/**
 * Both feet planted at `feet`, the hips `r.at[2]` as high as leaves the leg
 * taking the weight -- the right at `on` one, the left at minus one, shared
 * between -- bent `bend` degrees at the knee, and never so high that either
 * leg is pulled straight.
 */
function standOn(r: Rig, fr: Frame, feet: [V3, V3], on: number, bend: number): void {
  const u = 0.5 + 0.5 * Math.max(-1, Math.min(1, on));
  const h = hipsFor(r, fr, 0, feet[0], bend) * (1 - u) + hipsFor(r, fr, 1, feet[1], bend) * u;
  r.at[2] = Math.min(h, hipsFor(r, fr, 0, feet[0], 2), hipsFor(r, fr, 1, feet[1], 2));
  for (let k = 0; k < 2; k++) plant(r, fr, k, feet[k]);
}

/** A smooth step from `a` to `b`: nought before, one after. */
const step = (x: number, a: number, b: number): number => ease(Math.max(0, Math.min(1, (x - a) / (b - a))));

/**
 * Where a standing body looks in each sixteen seconds, as [when, turned to
 * its left, nodded up], in seconds and degrees: about, and held a while each
 * time, as somebody does who is waiting -- not a slow sway side to side.
 */
const LOOKS: [number, number, number][] = [[0.4, 3, 1], [2.7, 17, -1], [5.0, 10, 2], [8.6, -13, 0], [10.1, -21, -2], [14.6, -2, 0]];
/** And when it blinks: as each look starts, and now and then besides, once twice in a row. */
const BLINKS = [0.45, 2.75, 4.1, 5.05, 8.65, 10.15, 11.3, 11.62, 14.65];

/**
 * Standing: breathing, the weight on one leg and then the other with the
 * hips swinging over it and the free knee easing, the shoulders tilted
 * against the hips, the head looking about and blinking, and now and then a
 * shrug of the shoulders or a look at a hand. Everything repeats in sixteen
 * seconds and nothing more often than it should: four breaths, unevenly
 * spaced and of uneven depth, in quicker than out; the weight changing legs
 * twice; the looks and the blinks at their own times. `t` is in seconds.
 */
function idle(r: Rig, t: number, fr: Frame): void {
  const tt = ((t % 16) + 16) % 16;
  const turn = (period: number): number => (TAU * t) / period;
  // Breathing: the rate drifting a sixth either way over the loop, in quicker than out, deeper and shallower.
  const bp = turn(4) + 0.55 * Math.sin(turn(16) + 0.9);
  const depth = 0.8 + 0.2 * Math.sin(turn(16 / 3) + 0.4);
  const b = depth * Math.sin(bp + 0.4 * Math.sin(bp));
  // The weight on the right at one, the left at minus one, changing over in a second and a half and then held, with a little drift.
  const weight = (x: number): number => Math.tanh(2.6 * Math.sin((TAU * x) / 16)) / Math.tanh(2.6) + 0.05 * Math.sin((TAU * x) / (16 / 5));
  const w = weight(t);
  // The arms hang a third of a second behind the body as it goes over, as anything hanging does.
  const lag = w - weight(t - 0.35);
  r.pelvis = [0, -4.5 * w, -2.5 * w];
  r.at = [0.42 * w, 0, 0];
  r.spine = [0.4 * b, 3 * w, 1.6 * w];
  r.chest = [1.3 * b, 2 * w, 0.9 * w];
  r.neck = [-0.6 * b, -0.8 * w, 0];
  r.shrug = [0.09 * (b + 1), 0.09 * (b + 1)];
  // Clear of the hips: wider set ones, under narrower shoulders, hang the arms further out.
  const out = Math.max(7, Math.asin(Math.min(1, (1.55 * fr.hi + 0.85 - 2.1 * fr.sh) / 4.6)) / DEG);
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    r.arm[k] = [3 + 1.2 * b + (k ? -1 : 1) * w, out + 0.8 * b - s * 9 * lag, 4];
    r.elbow[k] = 15 + 2 * b + 2 * (k ? Math.max(0, w) : Math.max(0, -w));
    r.hand[k] = [0, 0, 0];
  }
  // The head: from one look to the next in under half a second, then held.
  const n = LOOKS.length;
  let i = n - 1;
  while (i >= 0 && LOOKS[i][0] > tt) i--;
  const cur = LOOKS[(i + n) % n], was = LOOKS[(i - 1 + 2 * n) % n];
  const g = step((tt - cur[0] + 16) % 16, 0, 0.45);
  const yaw = was[1] + (cur[1] - was[1]) * g, nod = was[2] + (cur[2] - was[2]) * g;
  // The neck takes a third of a look and the head the rest, and the head stays level as the shoulders tilt.
  r.neck[2] = 0.35 * yaw;
  r.head = [nod - 0.6 * b, -1.2 * w, 0.65 * yaw];
  r.blink = BLINKS.some((at) => tt >= at && tt < at + 0.14);
  r.tail = [3 * Math.sin(turn(16 / 5)), 2 * Math.sin(turn(16 / 3)), 0];
  // A shrug, the shoulders up and back and down again with a deeper breath, between six and eight seconds in.
  const sh = Math.pow(Math.sin(Math.PI * step(tt, 5.7, 7.7)), 2);
  if (sh > 0) {
    r.chest[0] += 4 * sh;
    r.head[0] += 4 * sh;
    r.shrug = [r.shrug[0] + 0.55 * sh, r.shrug[1] + 0.55 * sh];
    for (let k = 0; k < 2; k++) {
      r.arm[k][0] -= 6 * sh;
      r.arm[k][1] += 3 * sh;
    }
  }
  // And a look at the right hand from twelve seconds in: the forearm brought up, the hand turned over and back, and let down.
  const lk = step(tt, 12.1, 12.7) * (1 - step(tt, 13.7, 14.4));
  if (lk > 0) {
    const over = Math.sin(Math.PI * step(tt, 12.6, 13.8));
    r.arm[1] = [r.arm[1][0] + 24 * lk, r.arm[1][1] - 2 * lk, r.arm[1][2] + 18 * lk];
    r.elbow[1] += 78 * lk;
    r.hand[1] = [8 * lk, 0, -55 * over];
    r.neck = [r.neck[0] - 5 * lk, r.neck[1], r.neck[2] * (1 - lk) - 6 * lk];
    r.head = [r.head[0] * (1 - lk) - 12 * lk, r.head[1], r.head[2] * (1 - lk) - 12 * lk];
  }
  // The feet stay where they are, and the legs are solved to them from where the hips have gone.
  r.leg = [[0, 0, TOE_OUT], [0, 0, TOE_OUT]];
  standOn(r, fr, stance(fr), w, 3);
}

/*
 * A stride as an animator keys it, for one leg from the moment its heel
 * comes down (nought) to the next: the thigh's angle from upright in the
 * ground's terms (forward positive -- the hips' own tilt is taken off it),
 * the knee's bend, and the toe's lift off flat. The other leg is the same
 * half a stride on. Between the keys it is curved smoothly (`loop`).
 *
 * Walking: the heel down with the leg reaching (contact); the knee giving as
 * the weight comes onto it and the foot slapping flat (down); the leg upright
 * under the body as the other comes past (passing); the heel peeling up as the
 * body goes over the toes (up); the toe last off the ground with the knee
 * already folding, the foot carried through low under the body, and the shin
 * swung out ahead to reach for the next. Each foot is on the ground for
 * `WALK_DOWN` of the stride, so both are down for a tenth of each step.
 *
 * Running: landing nearly under the body rather than out ahead of it; sinking
 * onto the knee to mid-stance; the leg driven out straight behind to the toe;
 * the heel flicked up under the seat as the thigh comes through; the knee
 * driven up high in front, and the shin swung out and pawed back under the
 * body for the landing. Each foot is down for `RUN_DOWN` of the stride, and
 * between steps the body is in the air.
 */
const WALK_LEG: Key[] = [
  { at: 0, v: [25, 3, 16] },
  { at: 0.1, v: [18, 15, 0] },
  { at: 0.3, v: [3, 5, 0] },
  { at: 0.45, v: [-9, 4, -7] },
  { at: 0.55, v: [-15, 20, -24] },
  { at: 0.63, v: [-10, 42, -30] },
  { at: 0.74, v: [9, 60, -8] },
  { at: 0.86, v: [24, 34, 4] },
  { at: 0.94, v: [27, 9, 13] },
];
const RUN_LEG: Key[] = [
  { at: 0, v: [22, 16, 6] },
  { at: 0.1, v: [8, 34, 0] },
  { at: 0.2, v: [-8, 28, -6] },
  { at: 0.31, v: [-25, 14, -32] },
  { at: 0.42, v: [-18, 72, -30] },
  { at: 0.55, v: [8, 118, -12] },
  { at: 0.67, v: [42, 104, 0] },
  { at: 0.79, v: [54, 58, 8] },
  { at: 0.89, v: [38, 22, 10] },
  { at: 0.95, v: [28, 14, 8] },
];
/** How much of a stride each foot is on the ground, walking and running. */
const WALK_DOWN = 0.62;
const RUN_DOWN = 0.32;
/*
 * How far the hips are let down from where a straight leg would hold them,
 * through one step (nought at a heel strike), walking and running: what puts
 * the weight in a stride. Walking, lowest just after the heel comes down
 * with the knee giving, highest as the legs pass. Running, lowest at
 * mid-stance sunk on the knee, and up into the air off the toe, highest
 * between the steps with both feet off the ground.
 */
const WALK_DROP: Key[] = [
  { at: 0, v: [0.26] },
  { at: 0.18, v: [0.38] },
  { at: 0.55, v: [0.03] },
  { at: 0.8, v: [0.08] },
];
const RUN_DROP: Key[] = [
  { at: 0, v: [0.35] },
  { at: 0.28, v: [0.48] },
  { at: 0.64, v: [0.1] },
  { at: 0.84, v: [-0.1] },
];

/**
 * Walking into running, `g` between them: the two strides keyed above mixed,
 * with the body over them. A foot on the ground stays where it was put down:
 * from its heel strike to its toe leaving, the hip and the knee are turned to
 * keep it on a track going back under the body at an even pace, rolling from
 * the heel over the flat of the foot to the toe -- the pace the keyed contact
 * and toe-off poses imply, so the stride is the keys' and not a number of its
 * own. The hips turn with the leading leg and drop on the side of the leg in
 * the air; the shoulders turn the other way; the arms swing against the legs
 * from the shoulder, the forearm and hand following through a moment behind;
 * and the head is held level and looking where it is going whatever the body
 * under it is doing. At a run the whole body leans in from the ankles and
 * the arms are bent and driven.
 */
function walk(r: Rig, phi: number, g: number, fr: Frame): void {
  const L = (a: number, b: number): number => a + (b - a) * g;
  const frac = (x: number): number => x - Math.floor(x);
  const T = fr.tall, A = THIGH * T, B = SHIN * T;
  // Leg 0's stride, from its heel strike; and the step, from either's.
  const u0 = frac(phi / TAU - 0.25);
  const step = frac(2 * u0);
  // Leaning into the run from the ankles, the hips tipped with the body: the back bent forward over them instead opened a gap
  // between the coat and the belt behind, and the trousers showed in it.
  const tip = -L(1, 10);
  const down = L(WALK_DOWN, RUN_DOWN);
  // The keyed leg at `u` of its stride: [thigh from upright, knee, toe up].
  const keyed = (u: number): number[] => {
    const w = loop(WALK_LEG, u), n = loop(RUN_LEG, u);
    return [L(w[0], n[0]), L(w[1], n[1]), L(w[2], n[2])];
  };
  // The hips turn with the leading leg (see below), which carries each hip forward and back.
  const hipsAt = (u: number): number => -L(6, 9) * Math.cos(TAU * u);
  const hipY = (k: number, u: number): number => (k ? 1 : -1) * fr.hi * Math.sin(hipsAt(u) * DEG);
  // A point of the sole, from the ankle, with the foot tipped `a` toe up: along the way of going, and up.
  const sole = (p: V3, a: number): Pt => [p[1] * Math.cos(a * DEG) - p[2] * Math.sin(a * DEG), p[1] * Math.sin(a * DEG) + p[2] * Math.cos(a * DEG)];
  const ankleY = (q: number[]): number => A * Math.sin(q[0] * DEG) + B * Math.sin((q[0] - q[1]) * DEG);
  const HEEL = SOLE[0], TOE: V3 = [0, SOLE[2][1], SOLE[0][2]];
  // Where the heel comes down, from the hip, and how far the ground goes back under the body in a stride: from there to where the
  // toe leaves it, keyed, with the sole between.
  const strike = keyed(0), off = keyed(down);
  const heel0 = ankleY(strike) + sole(HEEL, strike[2])[0];
  const pace = (heel0 + (TOE[1] - HEEL[1]) - ankleY(off) - sole(TOE, off[2])[0]) / down;
  // The body carried on a curve rather than stood on whichever foot is lowest, which jolts: how far the hips are let down, here.
  const H0 = A + B - HEEL[2];
  let H = H0 - L(loop(WALK_DROP, step)[0], loop(RUN_DROP, step)[0]);
  // Where a foot on the ground has its ankle, from the hip, with the hips `h` up: the heel it rolls over on the track while the
  // toe is up, the toe once the heel has lifted.
  // The hips dropped on one side (see below) put that hip lower, and with the leg turned out from them the sole's outer edge too.
  const drop = L(4, 3) * Math.sin(TAU * (u0 + 0.05));
  const ankleOf = (k: number, u: number, a: number, h: number): Pt => {
    const s = k ? 1 : -1, tilt = (drop - s * L(2.5, 1.2)) * DEG;
    const y = hipY(k, 0) + heel0 - pace * u - hipY(k, u);
    const [py, pz] = a >= 0 ? sole(HEEL, a) : sole(TOE, a);
    // Down the leg's own plane, which the hips' roll and the leg's turn out of them tip from upright.
    return [y + (a >= 0 ? 0 : TOE[1] - HEEL[1]) - py, (-h + s * fr.hi * Math.sin(drop * DEG) - pz + SOLE[1][0] * Math.abs(Math.sin(tilt))) / Math.cos(tilt)];
  };
  const reach = 0.998 * (A + B);
  const legs = [0, 1].map((k) => {
    // Its stride, counted from a little before the heel comes down so the weight can come onto it as it lands.
    const u = frac(u0 + k / 2), early = u > 0.8 ? u - 1 : u;
    // On the ground from the heel strike to the toe leaving it, the weight coming on and going off over a few hundredths.
    return { u: early, q: keyed(u), on: ramp(early, -0.04, 0.02) * (1 - ramp(early, down - 0.07, down)) };
  });
  // Never higher than a foot on the ground reaches with its knee all but straight, which would leave it standing on nothing: let
  // down smoothly toward that rather than stopped at it in a kink.
  for (let k = 0; k < 2; k++) {
    const { u, q, on } = legs[k];
    if (on <= 0) continue;
    const [y, z] = ankleOf(k, u, q[2], H);
    const by = -z - Math.sqrt(Math.max(0, reach * reach - y * y));
    if (by > -0.06) H -= on * (by > 0.06 ? by : ((by + 0.06) * (by + 0.06)) / 0.24);
  }
  r.plant = [0, 0];
  for (let k = 0; k < 2; k++) {
    const { u, q, on } = legs[k];
    let [thigh, knee] = q;
    if (on > 0) {
      // The leg that puts the ankle there: the knee's bend from how far it is, and the thigh from which way.
      const [y, z] = ankleOf(k, u, q[2], H);
      const d = Math.min(reach, Math.hypot(y, z));
      const bend = Math.acos(Math.max(-1, Math.min(1, (d * d - A * A - B * B) / (2 * A * B))));
      const at = Math.atan2(y, -z) - Math.atan2(-B * Math.sin(bend), A + B * Math.cos(bend));
      thigh += on * (at / DEG - thigh);
      knee += on * (bend / DEG - knee);
    }
    r.leg[k] = [thigh - tip, L(2.5, 1.2), 0];
    r.knee[k] = knee;
    r.foot[k] = q[2];
    r.plant[k] = on;
    // The arm against the leg, so with the other leg: forward as that heel comes down, a moment behind it, and the forearm a moment
    // behind the upper arm again -- still folding forward as the arm starts back, and opening behind as it starts forward.
    const v = frac(u + 0.5);
    const swing = Math.cos(TAU * (v - L(0.04, 0.03)));
    const follow = Math.cos(TAU * (v - L(0.12, 0.09)));
    r.arm[k] = [L(3, 6) + L(20, 40) * swing, L(6, 9) - L(0, 4) * Math.max(0, swing), L(3, 20)];
    r.elbow[k] = L(20, 90) + L(12, 18) * follow;
    // The hand hanging loose trails the swing walking; closed in a fist at a run, it goes with the forearm.
    r.hand[k] = [L(7, 2) * Math.cos(TAU * (v - 0.22)), 0, 0];
    r.loose[k] = g < 0.5;
  }
  // The hips turn with the leading leg, and drop on the side whose leg is off the ground, most just after the other heel takes the
  // weight; the body goes over the foot it is on. The back takes the hips' turn and drop back out, so the lean is along the way of
  // going and the shoulders turn against the hips from square.
  const hips = hipsAt(u0);
  // At a run the body gives forward a little at each landing, sunk on the knee, and comes up straight off the toe.
  const give = L(0.5, 1.5) * (0.5 - 0.5 * Math.cos(TAU * Math.min(1, step / L(0.6, 0.64))));
  r.pelvis = [tip, drop, hips];
  r.spine = [-L(2, 1) - give, -0.6 * drop, -hips];
  const turn = L(6, 13) * Math.cos(TAU * (u0 - 0.03));
  r.chest = [-L(0.5, 1), -0.25 * drop, turn];
  // The head held level and looking ahead, the neck taking most of what the body under it turns and tips.
  const pitch = tip + r.spine[0] + r.chest[0], roll = drop + r.spine[1] + r.chest[1];
  const ahead = -L(1, 3) - pitch;
  r.neck = [0.6 * ahead, -0.6 * roll, -0.55 * turn];
  r.head = [0.4 * ahead, -0.4 * roll, -0.38 * turn];
  r.at = [-L(0.16, 0.05) * Math.sin(TAU * u0), 0, 0];
  // Carried at that height, the feet that are down kept on the ground by their knees for whatever the hips' roll leaves (`plantFoot`).
  r.hover = { h: H - H0, w: 1, thigh: 0, knee: 0, g };
  // Hair that hangs bouncing with the steps, and streaming out behind at a run.
  r.tail = [L(8, 30) + L(5, 9) * Math.sin(TAU * (step - 0.25)), 5 * Math.sin(TAU * u0), 0];
}

/**
 * An arm put where its hand is wanted rather than joint by joint: the wrist
 * to `to` with the elbow out toward `pole`, both in the hips' frame, so a
 * hand on something stays on it however the body above the hips moves. Out
 * of reach, it reaches as far as it goes toward the place. Given `haft`, the
 * hand turns so what it grips runs that way through the fist, with the
 * fingers as near the line of the forearm as that allows. Returns the
 * wrist's frame in the hips' frame, for finding what is in the hand.
 */
function hold(r: Rig, fr: Frame, k: number, to: V3, pole: V3, haft?: V3): Xf {
  const T = fr.tall, s = k ? 1 : -1;
  const chest = joint(joint(ROOT, [0, 0, SPINE * T], ...r.spine), [0, 0, CHEST * T], ...r.chest);
  const c = chest.m;
  // From the hips' frame into the chest's, which the arm hangs from.
  const into = (v: V3): V3 => [c[0] * v[0] + c[3] * v[1] + c[6] * v[2], c[1] * v[0] + c[4] * v[1] + c[7] * v[2], c[2] * v[0] + c[5] * v[1] + c[8] * v[2]];
  const S: V3 = [s * 2.1 * fr.sh, -0.1, ARM_AT * T + r.shrug[k]];
  const W = into([to[0] - chest.t[0], to[1] - chest.t[1], to[2] - chest.t[2]]);
  const a = UPPER * T, b = LOWER * T;
  const n = unit([W[0] - S[0], W[1] - S[1], W[2] - S[2]]);
  const d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, Math.hypot(W[0] - S[0], W[1] - S[1], W[2] - S[2])));
  const q = into(pole), qn = dot(q, n);
  const p = unit([q[0] - n[0] * qn, q[1] - n[1] * qn, q[2] - n[2] * qn]);
  // The upper arm out of the line to the wrist, toward the pole, as far as the two bones need to meet.
  const ca = (a * a + d * d - b * b) / (2 * a * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const u: V3 = [n[0] * ca + p[0] * sa, n[1] * ca + p[1] * sa, n[2] * ca + p[2] * sa];
  const f = unit([n[0] * d - u[0] * a, n[1] * d - u[1] * a, n[2] * d - u[2] * a]);
  // The upper arm's frame -- x the elbow's hinge, z back up the arm -- and the pitch, roll and yaw that turn it so, undone in the order a joint does them.
  const x = unit(cross(p, n)), z: V3 = [-u[0], -u[1], -u[2]], y = cross(z, x);
  r.arm[k] = [Math.atan2(y[2], z[2]) / DEG, (s * Math.asin(Math.max(-1, Math.min(1, x[2])))) / DEG, (s * Math.atan2(x[1], x[0])) / DEG];
  const e = Math.atan2(dot(f, y), dot(f, u));
  r.elbow[k] = e / DEG;
  // The forearm's frame.
  const ce = Math.cos(e), se = Math.sin(e);
  const yf: V3 = [y[0] * ce + z[0] * se, y[1] * ce + z[1] * se, y[2] * ce + z[2] * se];
  const zf: V3 = [z[0] * ce - y[0] * se, z[1] * ce - y[1] * se, z[2] * ce - y[2] * se];
  let hx: V3, hy: V3, hz: V3;
  if (haft) {
    // The haft through the fist along the hand's y, the fingers down its z as near the forearm's way as square to the haft lets them.
    hy = unit(into(haft));
    const fd = dot(f, hy);
    hz = unit([hy[0] * fd - f[0], hy[1] * fd - f[1], hy[2] * fd - f[2]]);
    hx = cross(hy, hz);
    const g = (v: V3, w: V3): number => dot(v, w);
    r.hand[k] = [Math.atan2(g(zf, hy), g(zf, hz)) / DEG, Math.asin(Math.max(-1, Math.min(1, -g(zf, hx)))) / DEG, Math.atan2(g(yf, hx), g(x, hx)) / DEG];
  } else {
    const h = joint({ m: [x[0], yf[0], zf[0], x[1], yf[1], zf[1], x[2], yf[2], zf[2]], t: [0, 0, 0] }, [0, 0, 0], ...r.hand[k]).m;
    hx = [h[0], h[3], h[6]];
    hy = [h[1], h[4], h[7]];
    hz = [h[2], h[5], h[8]];
  }
  // Back out into the hips' frame.
  const wc: V3 = [S[0] + u[0] * a + f[0] * b, S[1] + u[1] * a + f[1] * b, S[2] + u[2] * a + f[2] * b];
  return { m: mm(c, [hx[0], hy[0], hz[0], hx[1], hy[1], hz[1], hx[2], hy[2], hz[2]]), t: place(chest, wc) };
}

/** A key of a motion that loops: `at` of the way round, the values there, and whether it is a blow landing -- arrived at full speed and left from still. */
interface Key { at: number; v: number[]; hit?: boolean }

/** Where a looping motion is `s` of the way round, curved smoothly through its keys (which run in order from nought). */
function loop(keys: Key[], s: number): number[] {
  const n = keys.length;
  const t = (i: number): number => keys[((i % n) + n) % n].at + Math.floor(i / n);
  const v = (i: number): number[] => keys[((i % n) + n) % n].v;
  let i = n - 1;
  while (i > 0 && keys[i].at > s) i--;
  const h = t(i + 1) - t(i), u = (s - t(i)) / h;
  // How fast each value is changing at a key, per whole turn of the loop.
  const rate = (j: number, into: boolean): number[] => {
    const key = keys[((j % n) + n) % n];
    if (key.hit && !into) return v(j).map(() => 0);
    if (key.hit) return v(j).map((x, m) => (2 * (x - v(j - 1)[m])) / (t(j) - t(j - 1)));
    return v(j).map((_, m) => (v(j + 1)[m] - v(j - 1)[m]) / (t(j + 1) - t(j - 1)));
  };
  const m0 = rate(i, false), m1 = rate(i + 1, true);
  const u2 = u * u, u3 = u2 * u;
  return v(i).map((a, m) => (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * h * m0[m] + (-2 * u3 + 3 * u2) * v(i + 1)[m] + (u3 - u2) * h * m1[m]);
}

/** Where a mallet's head is and a chisel's top, in the frame of the hand holding it. */
const MALLET_HEAD: V3 = [0, 2.25, GRIP];
const CHISEL_TOP: V3 = [0, 0.95, GRIP];

/*
 * The mallet hand through a blow, in the hips' frame: where the wrist is,
 * which way the elbow points, and which way the haft runs. It lands at
 * nought (that key is filled in by `work`, from wherever the chisel is),
 * bounces and settles; then swings down and back past the hip, up behind
 * the shoulder with the mallet out along the line of the arm, and on up
 * over the crown; is held there, cocked back; and comes over and down in
 * front of the face onto the chisel in the last tenth of the turn. Round
 * the outside of the head all the way, so from no side does the hand or
 * the mallet go across the face.
 */
const BLOW: Key[] = [
  { at: 0.08, v: [1.8, 3.1, 3.2, 0.5, -0.6, -0.7, -0.95, 0.15, 0.35] },
  { at: 0.2, v: [1.8, 3.2, 2.8, 0.4, -0.6, -0.8, -1, 0.15, 0.12] },
  { at: 0.32, v: [3.1, 1.2, 1.4, 1, 0, -0.3, -0.3, 0.8, -0.5] },
  { at: 0.45, v: [3.3, -2.6, 1.8, 1, 0, -0.2, 0.25, -0.6, -0.75] },
  { at: 0.58, v: [3.2, -2.9, 8.0, 1, -0.3, 0.4, 0.2, -0.6, 0.77] },
  { at: 0.7, v: [2.5, -0.6, 9.3, 0.7, 0.5, 0.5, 0.1, -0.13, 0.99] },
  { at: 0.88, v: [2.5, -1.0, 9.1, 0.7, 0.5, 0.5, 0.1, -0.5, 0.86] },
  { at: 0.95, v: [2.4, 4.6, 6.2, 1, 0, 0.3, 0.06, 0.94, 0.34] },
];

/** Where the ankles stand at work: apart, the left forward under the work and the right back and turned out, braced for the blow. */
function workFeet(fr: Frame): [V3, V3] {
  const z = stance(fr)[0][2];
  return [[-(fr.hi + 0.6), 0.95, z], [fr.hi + 0.75, -0.55, z]];
}

/**
 * At work with a mallet and chisel: the chisel held upright in the left
 * hand at the belt, and the mallet in the right swung up round behind the
 * head and brought down over it onto the top of the chisel. The body rises
 * and turns the right shoulder back as the mallet goes up, the weight going
 * back onto the right foot and the hips with it, and turns and bends into
 * the blow with the weight driven onto the left, which jolts through both
 * hands and the knees; the feet stay planted and the work stays where it is
 * through all of it, and the head stays down over the work. Seen from where the right hand's swing
 * would come across the face, it is done the other way about, left-handed.
 */
function work(r: Rig, w: number, fr: Frame, facing: number): void {
  const s = (((w / TAU) % 1) + 1) % 1;
  const T = fr.tall;
  r.tool = true;
  // How high the mallet is, near enough: nought as it lands, one held up at the top.
  const up = s < 0.2 ? 0.12 * Math.sin((Math.PI * s) / 0.2) : s < 0.7 ? ease((s - 0.2) / 0.5) : s < 0.88 ? 1 : 1 - Math.pow((s - 0.88) / 0.12, 2);
  const jolt = s < 0.25 ? Math.pow(1 - s / 0.25, 2) : 0;
  // The weight back on the right foot as the mallet goes up, and driven onto the left, the forward one, into the blow.
  const on = -0.65 + 1.25 * up - 0.25 * jolt;
  // The hips go with the weight, and turn the right side back with the mallet and round again into the blow.
  r.pelvis = [-3, -3 * on, 3 - 9 * up + 2 * jolt];
  r.at = [0.3 * on, -0.35 * on, 0];
  r.spine = [-8 + 4 * up - 2.5 * jolt, 1.5 * on, 0];
  r.chest = [-4 + 3 * up - jolt, -2 * up, 4 - 7 * up - 2 * jolt];
  r.neck = [-9 + 2 * up, 0, -3 + 5 * up];
  r.head = [-10 + up + 1.5 * jolt, 0, -2 + 3 * up];
  // Feet planted apart, the left forward under the work and the right back, and the knees giving a little more to each blow.
  const feet = workFeet(fr);
  r.leg = [[0, 0, -4], [0, 0, -16]];
  standOn(r, fr, feet, on, 9 + 7 * jolt);
  /*
   * The chisel, stood on the work at the belt and jolted down by each blow.
   * The work does not move as the hips sway and turn over it, so the chisel
   * is put where it is in the world -- where it was in front of the hips
   * stood square -- and found in the hips' frame from there.
   */
  const pelvis = joint(ROOT, [r.at[0], r.at[1], HIP * T + r.at[2]], ...r.pelvis), pm = pelvis.m;
  const into = (v: V3): V3 => [pm[0] * v[0] + pm[3] * v[1] + pm[6] * v[2], pm[1] * v[0] + pm[4] * v[1] + pm[7] * v[2], pm[2] * v[0] + pm[5] * v[1] + pm[8] * v[2]];
  const square = HIP * T + hipsFor({ ...rest(), leg: r.leg }, fr, 1, feet[1], 9);
  const bench: V3 = [-0.6 * T, 3.6 * T, square + (1.05 - 0.12 * jolt) * T];
  const chisel = hold(r, fr, 0, into([bench[0] - pelvis.t[0], bench[1] - pelvis.t[1], bench[2] - pelvis.t[2]]), into([-1, -0.3, -0.8]), into([0.1, 0.2, 1]));
  const top = place(chisel, CHISEL_TOP);
  // The wrist that puts the mallet's head on the chisel's top, found by moving it by however far the head misses, a few times over.
  const haft: V3 = [-1, 0.15, 0];
  let wrist: V3 = [top[0] + 2.2 * T, top[1] - 0.9 * T, top[2] + 0.5 * T];
  for (let q = 0; q < 3; q++) {
    const head = place(hold(r, fr, 1, wrist, [0.4, -0.6, -0.8], haft), MALLET_HEAD);
    wrist = [wrist[0] + top[0] - head[0], wrist[1] + top[1] - head[1], wrist[2] + top[2] + 0.5 * T - head[2]];
  }
  const k = loop([{ at: 0, v: [wrist[0] / T, wrist[1] / T, wrist[2] / T, 0.4, -0.6, -0.8, ...haft], hit: true }, ...BLOW], s);
  hold(r, fr, 1, [k[0] * T, k[1] * T, k[2] * T], [k[3], k[4], k[5]], [k[6], k[7], k[8]]);
  if (lefty(facing)) mirror(r);
}

/** Whether work is done left-handed from where it is seen: see `work`. */
const lefty = (facing: number): boolean => {
  const f = ((Math.round(facing) % 8) + 8) % 8;
  return f === 3 || f === 7;
};

/** How far a swimmer is in the water: to the chest. Going in and coming out are blended by how much of this they are in. */
const SINK = 10.2;

/*
 * Swimming. The body was stood upright and let down to the chest, the arms
 * waving over the water, and the picture cut off flat along the screen at
 * the feet: whatever of the body was nearer the viewer than the feet and
 * above the water was cut away with what was under it, and whatever was
 * further off and under it showed. Now the water is a level in the body's
 * own space and every facet is cut at it (`waterline`): what is over it is
 * drawn, what is under it is drawn faintly through the water, and where the
 * two meet the water rings the body. So a swimmer can lie in the water as a
 * swimmer does, and the stroke under the surface shows as it would.
 *
 * Under way, breaststroke: from the glide, arms out ahead and legs out
 * behind, the hands sweep out and round and in under the chin while the
 * head and shoulders come up to breathe; the knees draw up as the hands
 * come in, the hands shoot forward, and the legs whip round and together
 * behind, which drives the body on into the next glide. One stroke to
 * every `SWIM_STROKE` of the walk's phase, which goes as fast as the
 * swimmer does, so a better swimmer strokes faster. Stopped, treading
 * water: upright, the hands sculling flat under the surface out to the
 * sides and the legs turning over in turn under the body, the head bobbing
 * a little with each sweep.
 */
/** Walk-phase radians to a stroke: a stroke every second and a quarter at an unskilled swimmer's pace. */
const SWIM_STROKE = TAU / 0.9;
/** Radians of the idle clock (six to a second) to one sweep of the hands treading water: one every second and three-quarters. */
const TREAD_RATE = 0.6;
/** How far out past the shoulder a hand sculls treading water, at the middle of its sweep. */
const TREAD_REACH = 1.5;

/**
 * Breaststroke, a stroke from the start of the glide: [the body's lean (pelvis),
 * the back arched up against it (spine and chest each), where the wrists
 * are -- across from the middle, ahead of the head and up from the surface
 * (`swimHand`) -- which way the elbows go, out and up, the hand's turn, the
 * thigh's forward/out, the knee, the foot pointed, and the head's height
 * over the water].
 *
 * The hands were keyed as the arm's angles, and in between keys they went
 * where the angles took them: up out of the water and together in front of
 * the face, as if praying, while the head came up. Keyed where they are,
 * they sweep out wide under the surface, come in under the chin at it as
 * the head comes up to breathe -- a head's height, which reads at any zoom
 * -- and shoot forward under it into the glide.
 *
 * At the out-sweep the wrists were barely under the surface with the elbows
 * level, so both arms lay straight out on it to the sides, the one the
 * mirror of the other, a foam ring round each: from in front or behind, a
 * scarecrow. Now the sweep is a forearm's depth under, the elbows let down
 * under the line of the arm so that it bends, and one arm runs a few hundredths of a
 * stroke ahead of the other (`ARM_LEAD`), as no two arms are ever quite together.
 */
const BREAST: Key[] = [
  { at: 0, v: [-62, 7, 0.5, 5.6, -1.6, 1, -0.2, -20, 2, 3, 6, -30, 0.1] },
  { at: 0.14, v: [-60, 8, 2.3, 5.0, -1.45, 1, -0.5, -30, 2, 5, 6, -30, 0.2] },
  { at: 0.28, v: [-52, 10, 3.2, 2.7, -1.25, 1, -0.45, -10, 6, 7, 14, -24, 0.75] },
  { at: 0.4, v: [-44, 12, 0.8, 1.4, -0.45, 1, 0.2, 30, 26, 12, 70, 10, 1.6] },
  { at: 0.52, v: [-54, 10, 0.4, 3.4, -0.7, 1, -0.4, 10, 40, 24, 112, 22, 0.35] },
  { at: 0.64, v: [-60, 8, 0.45, 5.4, -1.4, 1, -0.2, -10, 12, 22, 46, -10, 0.12] },
  { at: 0.76, v: [-62, 7, 0.5, 5.6, -1.6, 1, -0.2, -20, 2, 5, 8, -30, 0.1] },
];

/**
 * Put a swimmer's wrist `k` at `at` -- across from the body's middle (out to
 * its own side), ahead of the head, and up from the surface of the water --
 * the elbow toward `pole` (out to its own side, back, up), both in the body's
 * frame. The water is where the head's `float` says it is, so a hand put at
 * the surface stays there however the body bobs or leans under it.
 */
function swimHand(r: Rig, fr: Frame, k: number, at: V3, pole: V3): void {
  const T = fr.tall, s = k ? 1 : -1;
  const pelvis = joint(ROOT, [r.at[0], r.at[1], HIP * T + r.at[2]], ...r.pelvis);
  const chest = joint(joint(pelvis, [0, 0, SPINE * T], ...r.spine), [0, 0, CHEST * T], ...r.chest);
  const head = joint(joint(chest, [0, -0.08, NECK * T], ...r.neck), [0, 0.06, HEADJ], ...r.head).t;
  const water = head[2] - (r.float ?? 0);
  const m = pelvis.m;
  // Into the hips' own frame, which `hold` works in.
  const into = (v: V3): V3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const w: V3 = [s * at[0] - pelvis.t[0], head[1] + at[1] - pelvis.t[1], water + at[2] - pelvis.t[2]];
  hold(r, fr, k, into(w), into([s * pole[0], pole[1], pole[2]]));
}

/**
 * Turn hand `k` at the wrist, and about the forearm, so its fingers run as
 * near `fingers` and the back of the hand faces as near `back` as a wrist
 * goes, both in the body's frame: found a few turns at a time from where it
 * is, coarse and then fine. A hand that only followed the forearm went up out
 * of the water wherever the forearm rose to it, waving.
 */
function aimHand(r: Rig, fr: Frame, k: number, fingers: V3, back: V3): void {
  const T = fr.tall, s = k ? 1 : -1;
  const chest = joint(joint(joint(ROOT, [0, 0, 0], ...r.pelvis), [0, 0, SPINE * T], ...r.spine), [0, 0, CHEST * T], ...r.chest);
  const [ap, aa, at] = r.arm[k];
  const elbow = joint(joint(chest, [s * 2.1 * fr.sh, -0.1, ARM_AT * T + r.shrug[k]], ap, -s * aa, s * at), [0, 0, -UPPER * T], r.elbow[k]);
  const f = unit(fingers), n = unit(back);
  const score = (h: Euler): number => {
    const m = joint(elbow, [0, 0, 0], ...h).m;
    // The fingers down the hand's -z; the back of it out its x on the hand's own side.
    return -(m[2] * f[0] + m[5] * f[1] + m[8] * f[2]) + s * (m[0] * n[0] + m[3] * n[1] + m[6] * n[2]);
  };
  const most: Euler = [70, 35, 100];
  const h: Euler = [...r.hand[k]];
  let best = score(h);
  for (const step of [24, 10, 4]) {
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < 3; a++) {
        for (const d of [-step, step]) {
          const was = h[a];
          h[a] = Math.max(-most[a], Math.min(most[a], was + d));
          const got = score(h);
          if (got > best) best = got;
          else h[a] = was;
        }
      }
    }
  }
  r.hand[k] = h;
}

/** How far ahead of the stroke one arm is, and behind it the other, as a share of a stroke. */
const ARM_LEAD = 0.014;

function swim(r: Rig, phi: number, moving: boolean, fr: Frame): void {
  r.flat = [false, false];
  r.sink = SINK;
  r.under = moving ? 1 : 0;
  if (!moving) {
    tread(r, phi, fr);
    return;
  }
  const s = (((phi / SWIM_STROKE) % 1) + 1) % 1;
  const [lean, arch, , , , , , , lp, la, kn, ft, up] = loop(BREAST, s);
  r.pelvis = [lean, 0, 0];
  r.spine = [arch, 0, 0];
  r.chest = [arch, 0, 0];
  // The head up out of the water, looking where it is going: whatever the body's lean, the face is turned to the way ahead.
  r.neck = [-(lean + 2 * arch) * 0.62, 0, 0];
  r.head = [-(lean + 2 * arch) * 0.38 + 4, 0, 0];
  r.float = up;
  for (let k = 0; k < 2; k++) {
    // Each arm a little off the stroke the body is at: the right a touch ahead, the left a touch behind.
    const [, , ax, ay, az, apx, apz, awr] = loop(BREAST, (s + (k ? ARM_LEAD : -ARM_LEAD) + 1) % 1);
    r.hand[k] = [0, 0, awr];
    r.open[k] = true;
    swimHand(r, fr, k, [ax, ay, az], [apx, -0.2, apz]);
    r.leg[k] = [lp, la, 0];
    r.knee[k] = kn;
    r.foot[k] = ft;
  }
  r.tail = [70, 0, 0];
}

/*
 * Treading water. Nothing of it showed: the head went up and down by under a
 * pixel, and the hands and legs were all under the water. Now the hands
 * scull just under the surface, out and in, the palms turned the way they
 * push, and the body rises on each sweep -- twice to a sweep, out and in,
 * a little after the hands are going fastest, a hand's breadth -- with the
 * shoulders rolling against the legs as they turn over under it.
 */
function tread(r: Rig, phi: number, fr: Frame): void {
  const q = phi * TREAD_RATE;
  const s = Math.sin(q), c = Math.cos(q);
  r.pelvis = [-10, -2 * s, 0];
  r.spine = [-4, 2 * s, 0];
  r.chest = [2 + 1.5 * c, 3 * s, 0];
  // The head kept level over the roll, and looking about.
  r.neck = [6, -2.5 * s, 0];
  r.head = [4, -0.5 * s, 14 * Math.sin(q * 0.23)];
  // Topped out a little under the shoulders: any higher and the top of the shirt showed in a crescent inside the foam round them.
  r.float = 0.42 + 0.2 * Math.cos(2 * q - 0.6);
  // The shoulders let down a little with the arms out under the water, the tops of them under it with the arms.
  r.shrug = [-0.25, -0.25];
  for (let k = 0; k < 2; k++) {
    /*
     * The hands out to the sides just under the surface, sweeping out and in, each a little behind the other, and each
     * flat on the water and tipped the way it is going, so it pushes down on it both ways. The elbows were let straight
     * down under them, so the forearm rose steeply to the wrist and the hand, which a wrist cannot bend back flat from
     * that, stood up out of the water palm out, waving. Now the elbow goes out to the side and only a little down, the
     * forearm lies nearly level a hand's depth under, and the hand lies flat at the end of it.
     */
    const side = k ? 1 : -1, o = Math.sin(q + (k ? 0.35 : 0)), v = Math.cos(q + (k ? 0.35 : 0));
    r.open[k] = true;
    swimHand(r, fr, k, [2.1 * fr.sh + TREAD_REACH + 0.8 * o, 1.1 + 0.35 * c, -0.75], [0.8, -0.5, -0.5]);
    aimHand(r, fr, k, [side * 0.8, 0.6, 0], [-side * 0.5 * v, 0, 1]);
    // The legs turning over in turn, as a cyclist's do: a knee up and forward while the other leg presses down.
    const w = Math.sin(q + (k * Math.PI));
    r.leg[k] = [34 + 18 * w, 18, 0];
    r.knee[k] = 64 + 26 * Math.sin(q + k * Math.PI + 1.2);
    r.foot[k] = -14;
  }
  r.tail = [40 + 6 * c, 0, 0];
}

/*
 * Driving. Sat on whatever the vehicle has to sit on (`Seat`): the box of a
 * cart or a wagon, a rowing boat's thwart, a sailing boat's stern sheets by
 * the tiller, or a saddle. The body is put on the seat and the feet on the
 * floor (`skeleton`), so it sits on the bench at every facing whatever the
 * build, and the hands go where what they hold is.
 */
/** The hips' frame, sat on a seat `up` high over the floor: the underside of the thighs on it, in the body's frame from the feet. */
function hipsOn(r: Rig, up: number): Xf {
  const m = joint(ROOT, [0, 0, 0], ...r.pelvis).m;
  return { m, t: [r.at[0], r.at[1], up - m[8] * SEAT] };
}
/** Put the fist of hand `k` on a point given in the body's frame from the feet, `pole` the way the elbow goes, `haft` what it holds. */
function fistOn(r: Rig, fr: Frame, k: number, at: V3, pole: V3, haft: V3): void {
  const { m, t } = hipsOn(r, r.sit?.up ?? 0);
  // Into the hips' own frame, which `hold` works in.
  const into = (v: V3): V3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const want = into([at[0] - t[0], at[1] - t[1], at[2] - t[2]]);
  const p = into(pole), h = into(haft);
  let wrist = want;
  // The wrist that puts the middle of the fist there, found by moving it by however far the fist misses, a few times over.
  for (let q = 0; q < 3; q++) {
    const fist = place(hold(r, fr, k, wrist, p, h), [0, 0, GRIP]);
    wrist = [wrist[0] + want[0] - fist[0], wrist[1] + want[1] - fist[1], wrist[2] + want[2] - fist[2]];
  }
  hold(r, fr, k, wrist, p, h);
}

/** A saddled beast's barrel under its rider, from the saddle: what the far leg is hidden behind. */
const BARREL = { c: [0, 0, -2.4] as V3, r: [1.9, 5.5, 2.4] as V3 };

/** The box seat of a cart or wagon when nothing says otherwise: the reins out ahead to a team, the bench a hand over the boards. */
const BOX: Seat = { hands: 'reins', up: 2.7, grip: [0, 14, 5.6] };

function drive(r: Rig, phi: number, moving: boolean, seat: Seat, fr: Frame): void {
  r.seat = seat;
  r.sit = { up: seat.up, astride: !!seat.astride };
  r.flat = [true, true];
  if (seat.hands === 'oars') row(r, phi, moving, seat, fr);
  else if (seat.hands === 'tiller') steer(r, phi, moving, seat, fr);
  else reinsIn(r, phi, moving, seat, fr);
}

/*
 * At the reins: sat square on the box, the thighs along the bench and the
 * feet braced on the boards ahead, the forearms out level and a fist round
 * each pair of reins over the knees. Going, the team's heads nod and draw
 * the reins out and let them back, so the hands give forward and come back
 * with them, the reins going slack and taut; the cart rocks on its wheels
 * and the body sways with it from the hips, the head held level over it,
 * and every so often a rut jolts the shoulders. Stopped, the hands are let
 * down onto the thighs with the reins slack, and the driver breathes and
 * looks about. On a saddle, the same hands over the withers, the legs down
 * either side of the beast with the heels down, and the body going with
 * the beast's stride.
 */
function reinsIn(r: Rig, phi: number, moving: boolean, seat: Seat, fr: Frame): void {
  r.reins = true;
  const t = phi / 6;
  // The team's nod, once to a stride of theirs; the rock of the wheels, slower and not in step with it; a jolt now and then.
  const nod = moving ? Math.sin(phi * 0.5) : 0;
  const rock = moving ? Math.sin(phi * 0.43 + 0.7) : 0;
  const jolt = moving ? Math.pow(Math.max(0, Math.sin(phi * 0.37) * Math.sin(phi * 0.83 + 1)), 3) : 0;
  // The bench's bump with each beat of the wheels, and the same a little later, which is when the shoulders feel it.
  const bump = moving ? Math.pow(Math.abs(Math.sin(phi * 0.5 + 0.6)), 1.5) : 0;
  const after = moving ? Math.pow(Math.abs(Math.sin(phi * 0.5 + 0.1)), 1.5) : 0;
  const b = Math.sin((t * TAU) / 4.2);
  if (seat.astride) {
    r.leg = [[46, 26, -8], [46, 26, -8]];
    r.knee = [62, 62];
    r.foot = [12, 12];
    r.flat = [false, false];
    r.at = [0, 0.3, moving ? 0.12 * Math.abs(Math.sin(phi * 0.5)) : 0];
  } else {
    // The feet a little apart and turned out, the knees over them, and the feet in under the knees: further out and further
    // apart, on a wagon the boot on the near side stood on the top of the board there, seen from in front.
    r.leg = [[84, 4, -6], [84, 4, -6]];
    r.knee = [98, 98];
  }
  /*
   * Going, the body goes with the cart: it was a couple of degrees of sway
   * and a pixel of nod, which at the size the island is played at was a
   * driver sat still on a moving cart. Then it was a bump that was mostly
   * nothing, a rock that took nearly three seconds and was all taken back
   * at the head, and a jolt that hardly ever came: still a passenger sat
   * still. Now the bench bumps the body up with every beat of the wheels and
   * the shoulders give forward a beat after it; the body rocks from the hips
   * ten degrees either way, about once in a second and a half at a walk, the
   * head turning back against little more than half of it so it rocks too;
   * and a rut every few seconds throws the shoulders forward and the head
   * back.
   */
  if (moving && !seat.astride) r.lift = 0.5 * bump + 0.3 * jolt;
  r.pelvis = [4, 3 * rock, 0];
  r.spine = [-9 + 3.8 * jolt + 1.2 * b * (moving ? 0 : 1), 5 * rock, 0];
  r.chest = [-2 + 2.2 * jolt + 1.4 * nod * 0.3 + 2.5 * after, 2 * rock, 0];
  // The head kept nearly level and looking ahead over the team; stopped, looking about.
  r.neck = [6 - 3 * jolt - 1.5 * after, -3.2 * rock, 0];
  r.head = [4 - 4.5 * jolt, -2.2 * rock, moving ? 3 * Math.sin(phi * 0.09) : 14 * Math.sin((t * TAU) / 11) * Math.min(1, 2 * Math.abs(Math.sin((t * TAU) / 23)))];
  r.blink = !moving && t % 4.3 < 0.12;
  // How taut the reins are, nought to one: drawn out with each nod and let back, and let go slack stopped.
  r.slack = moving ? 0.45 - 0.35 * nod : 1;
  const hips = hipsOn(r, seat.up).t;
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    const at: V3 = moving
      ? [s * 0.85, hips[1] + 2.75 + 0.42 * nod, hips[2] + 1.75 + 0.18 * nod - 0.25 * jolt]
      : [s * 1.0, hips[1] + 2.35, hips[2] + 1.15 + 0.06 * b];
    fistOn(r, fr, k, at, [s * 0.7, -0.6, -0.5], [-s * 0.9, 0.15, 0.4]);
  }
  r.tail = [12 + 4 * rock + 6 * jolt, 3 * rock, 0];
}

/*
 * At the oars: sat on the thwart facing her stern, the feet braced on the
 * boards, an oar in each fist over its rowlock. A stroke is the catch --
 * leant forward with the arms out, the blades dropped in behind -- the
 * drive, the back swinging up and the arms drawing the handles into the
 * ribs while the blades sweep through the water, the finish, the hands
 * pressed down to lift the blades out and turned to lay them flat, and the
 * recovery, the hands away first and then the body swinging forward after
 * them, the blades skimming back over the water. One stroke to `ROW_STROKE`
 * of the walk's phase, which goes as fast as she does. Stopped, the oars
 * lie flat on the water with the handles in the lap.
 */
const ROW_STROKE = TAU / 0.42;
/** An oar outboard of its rowlock, for its inboard: sculls as they are cut. */
const OAR_OUT = 1.75;
/**
 * The stroke, from the catch: [how far round each oar is (its blade toward
 * the stern from straight out), the blade's height over the water, how far
 * it is turned flat, the back's swing (forward is less)].
 *
 * The back swung from 26 degrees forward to 12 back, which seen from in
 * front or behind was a body sat upright while only the oars moved. Now it
 * reaches well forward at the catch, the hands out past the knees, and lies
 * back past upright at the finish, as a rower's does.
 *
 * The oars went round to 44 degrees at the catch, which took the hands out
 * past the shoulders a hand and a half either side, at shoulder height: from
 * behind, a body with its arms straight out to the sides. Now they go round to
 * 36, the hands a little over shoulder-width apart and further forward, the
 * body reaching down after them.
 */
const STROKE: Key[] = [
  { at: 0, v: [-36, -0.05, 0, -39] },
  { at: 0.1, v: [-28, -0.75, 0, -29] },
  { at: 0.3, v: [0, -0.75, 0, 4] },
  { at: 0.42, v: [16, -0.3, 0, 20] },
  { at: 0.5, v: [14, 0.9, 1, 17] },
  { at: 0.66, v: [-8, 1.2, 1, -6] },
  { at: 0.84, v: [-31, 1.1, 1, -31] },
  { at: 0.94, v: [-37, 0.5, 0.2, -39] },
];
/** Where in the stroke the blades go in, and how much of it the splash they throw up takes to open out and settle. */
const ROW_CATCH = 0.97;
const ROW_SPLASH = 0.24;

function row(r: Rig, phi: number, moving: boolean, seat: Seat, fr: Frame): void {
  const st = (((phi / ROW_STROKE) % 1) + 1) % 1;
  const [sweep, height, feather, swing] = moving ? loop(STROKE, st) : [10, 0.02, 1, 4 + 1.5 * Math.sin(phi / 6 * TAU / 4.2)];
  // How far through its life the splash of the blades going in is: from nought as they go in to one as it has settled.
  const splash = moving ? ((st - ROW_CATCH + 1) % 1) / ROW_SPLASH : 1;
  // The legs out along the boards to the stretcher, the knees down under the gunwales.
  r.leg = [[92, 12, -4], [92, 12, -4]];
  r.knee = [50, 50];
  // The back swings from the hips; the head stays up, looking over the stern.
  r.pelvis = [6, 0, 0];
  r.spine = [swing * 0.55 - 4, 0, 0];
  r.chest = [swing * 0.45, 0, 0];
  r.neck = [-swing * 0.45 + 2, 0, 0];
  r.head = [-swing * 0.35 + 2, 0, moving ? 0 : 10 * Math.sin(phi / 6 * TAU / 13)];
  const lock = seat.grip, inboard = Math.max(2, lock[0] - 1.05), out = inboard * OAR_OUT;
  // Dropped toward the blade by as much as puts its middle at `height` over the water.
  const dip = Math.asin(Math.max(-0.9, Math.min(0.9, (lock[2] - height) / (out - 1.4))));
  r.oars = [];
  for (let k = 1; k >= 0; k--) {
    const s = k ? 1 : -1;
    const a = sweep * DEG;
    const dir: V3 = [s * Math.cos(a) * Math.cos(dip), Math.sin(a) * Math.cos(dip), -Math.sin(dip)];
    const at: V3 = [s * lock[0], lock[1], lock[2]];
    r.oars.push({ lock: at, out: [dir[0] * out, dir[1] * out, dir[2] * out], feather, splash });
    // The fist on the handle, a hand in from its end, the elbow drawn back past the ribs rather than winged out.
    const h = inboard - 0.5;
    fistOn(r, fr, k, [at[0] - dir[0] * h, at[1] - dir[1] * h, at[2] - dir[2] * h], [s * 0.4, -0.7, -0.4], [s * dir[0], s * dir[1], s * dir[2]]);
  }
  r.tail = [10 - swing * 0.3, 0, 0];
}

/*
 * At the tiller: sat aft on the stern sheets to one side of it, the hand on
 * that side on its end and the other on the knee, looking forward past the
 * mast and now and then up at the sail. Under way she heels and lifts to
 * the water and the body leans against it from the hips, the head held
 * level; stopped, the same, gentler.
 */
function steer(r: Rig, phi: number, moving: boolean, seat: Seat, fr: Frame): void {
  const t = phi / 6;
  // How far she is over and up on the water, nought to one either way: under way slow and deep, stopped a gentle roll.
  const lift = moving ? Math.sin(phi * 0.19) : 0.4 * Math.sin((t * TAU) / 5.5);
  const b = Math.sin((t * TAU) / 4.2);
  /*
   * A degree or two of lean and a head that looked up now and then were all
   * there was of it, and the free hand sat on the hip with the elbow out. Now
   * the body heels with her from the hips, five degrees and more, the neck and
   * head turned back against it so the eyes stay level on the water ahead; the
   * seat lifts under it as she rises; the tiller hand works the tiller fore and
   * aft a little, the arm swinging with it; and the free hand lies flat on the
   * thigh with the elbow back and down.
   *
   * At the size the island is played at that was still a body sat still: the
   * seat rose a sixth of a unit, and the neck and head took back the whole of
   * the heel, so the face, which is all that reads, did not move. And the fist
   * slid fore and aft along a tiller that stayed where it was, off its end and
   * back. Now she lifts the body over a third of a unit; it heels with her
   * eight degrees, the head taking back two-thirds of that so the rest shows,
   * and sways fore and aft three degrees as she pitches; and the fist stays on
   * the end of the tiller, the steering in the elbow and the shoulders, which
   * turn a little with each pull and push.
   */
  r.lift = (moving ? 0.36 : 0.1) * (0.5 + 0.5 * Math.sin(phi * 0.38 + 1.1));
  const pitch = moving ? Math.sin(phi * 0.3 + 0.5) : 0.5 * Math.sin((t * TAU) / 4.9);
  r.leg = [[80, 12, -6], [80, 12, -6]];
  r.knee = [80, 80];
  const k = seat.grip[0] >= 0 ? 1 : 0, s = k ? 1 : -1;
  const work = moving ? Math.sin(phi * 0.27 + 0.4) : 0.3 * Math.sin((t * TAU) / 7);
  r.pelvis = [6, 3.5 * lift, 0];
  r.spine = [-6 + 1.2 * b + 1.8 * pitch, 3 * lift, 0];
  r.chest = [-1 + 0.8 * b + 1.2 * pitch, 1.5 * lift, s * 4 * work];
  r.neck = [4 - 1.5 * pitch, -3.1 * lift, -s * 1.5 * work];
  // Looking ahead, and up at the sail every so often.
  const up = Math.pow(Math.max(0, Math.sin((t * TAU) / 9)), 8);
  r.head = [4 + 16 * up - pitch, -2.1 * lift, 6 * Math.sin((t * TAU) / 13) - 10 * up - s * work];
  r.blink = t % 4.7 < 0.12;
  const g = seat.grip;
  fistOn(r, fr, k, g, [s * (0.5 - 0.35 * work), -0.9 + 0.2 * work, -0.35 + 0.3 * work], [0, 1, 0.1]);
  // The other hand flat on its thigh, half way to the knee, the fingers toward the knee.
  const hips = hipsOn(r, seat.up).t;
  r.open[1 - k] = true;
  fistOn(r, fr, 1 - k, [-s * 1.2, hips[1] + 1.75, hips[2] + 0.75], [-s * 0.3, -0.9, -0.6], [s, 0, 0]);
  aimHand(r, fr, 1 - k, [0, 0.95, -0.3], [0, -0.2, 1]);
  r.tail = [10 + 4 * lift, 2 * lift, 0];
}

/** How far to turn the hand on side `k` about its forearm, in degrees, for its palm to face as near `want` as it can, in the chest's frame. */
function palmTo(r: Rig, k: number, want: V3): number {
  const s = k ? 1 : -1;
  const [ap, aa, at] = r.arm[k];
  const m = mm(rz(s * at * DEG), mm(ry(-s * aa * DEG), rx((ap + r.elbow[k]) * DEG)));
  // Into the forearm's frame, where the palm faces across the hand, away from the side the hand is on, until it is turned.
  const w: V3 = [m[0] * want[0] + m[3] * want[1] + m[6] * want[2], m[1] * want[0] + m[4] * want[1] + m[7] * want[2], m[2] * want[0] + m[5] * want[1] + m[8] * want[2]];
  return Math.atan2(-s * w[1], -s * w[0]) / DEG;
}

/** A wave with the hand nearest whoever is looking (see `wave`); or a hop, knees tucked in the air (see `hop`). */
function emote(r: Rig, id: string, t: number, facing: number, fr: Frame): void {
  if (id === 'wave') wave(r, t, facing, fr);
  else if (id === 'hop') hop(r, t, fr);
}

/*
 * Which way round from straight out to the side the waving arm is raised, at
 * each facing, toward straight ahead, in degrees. Seen from in front or
 * behind, a little forward of out to the side, where the hand is beside the
 * head; three-quarters on, a little behind straight out, which is what takes
 * the hand off the side of the head on the screen and away from the face;
 * three-quarters away, half way, which takes it furthest from the head; and
 * side on all but straight ahead, so it waves in front of the face and
 * clear of it.
 */
const WAVE_ROUND = [20, -25, 86, 42, 20, 42, 86, -25];
/** How high the upper arm is raised, from hanging, and how far the elbow is bent at the middle of each swing, at each facing: the forearm leaning further out, away from the head, where the head is nearest the hand on the screen. */
const WAVE_RAISE = [102, 98, 102, 102, 102, 102, 102, 98];
const WAVE_BEND = [86, 76, 66, 84, 86, 84, 66, 76];

/**
 * A wave, `t` of the way through. The arm is raised from where it hangs, in
 * one turn of the shoulder through the plane it ends up in -- it was the
 * shoulder's three angles each eased from one end to the other, which swung
 * the hand in an arc round the back of the head side on -- the elbow leading
 * and the forearm coming up after it, a little past where it stops and back.
 * Then the forearm swings from the elbow three times, the hand flapping a
 * moment behind it and the palm toward whoever is looking; and it comes down
 * the way it went up, the forearm first. The shoulder comes up with the arm,
 * the body leans away from it and rocks a little with each swing, and the
 * head turns toward whoever is looking.
 *
 * With the arm on the near side of the body from where it is seen -- the
 * right, but the left from the left-hand side -- as it would be staged for a
 * camera: the far arm waves behind the head. Except side on, where the arm
 * goes up ahead of the face: the near one, upper arm and shoulder piece and
 * all, comes up across the face on its way, and the far one goes up behind
 * the head and comes out in front of it with only the forearm and the hand.
 */
function wave(r: Rig, t: number, facing: number, fr: Frame): void {
  const T = fr.tall, f = ((Math.round(facing) % 8) + 8) % 8;
  const k = f === 2 ? 0 : f >= 5 && f !== 6 ? 0 : 1, s = k ? 1 : -1;
  // Up from still, a little past and back; the forearm a moment behind; down again, the forearm first, and still at the end.
  const x = ease(Math.max(0, Math.min(1, t / 0.2)));
  const raise = (1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2)) * (1 - step(t, 0.8, 1));
  const lift = step(t, 0.04, 0.22) * (1 - step(t, 0.76, 0.96));
  // Three swings of the forearm, in and out from upright, eased in and out of.
  const swings = step(t, 0.15, 0.25) * (1 - step(t, 0.72, 0.82));
  const ph = (TAU * 3 * (t - 0.2)) / 0.58;
  const swing = swings * Math.sin(ph);
  const view = viewOf(f);
  // The body leans away from the arm, rocks with each swing, and the shoulder comes up.
  r.spine = [r.spine[0], r.spine[1] - 2 * s * raise, r.spine[2]];
  r.chest = [r.chest[0] + 1.5 * raise, r.chest[1] - 4 * s * raise + 1.2 * s * swing, r.chest[2] - 1.5 * s * swing];
  r.shrug = k ? [r.shrug[0], r.shrug[1] + 0.45 * raise] : [r.shrug[0] + 0.45 * raise, r.shrug[1]];
  // Every direction from here on in the chest's frame: x to the right, y forward, z up.
  const chest = joint(joint(ROOT, [0, 0, SPINE * T], ...r.spine), [0, 0, CHEST * T], ...r.chest);
  const back = (v: V3): V3 => { const m = chest.m; return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]]; };
  const [ap, aa, at] = r.arm[k];
  const hang = mv(mm(rz(s * at * DEG), mm(ry(-s * aa * DEG), rx(ap * DEG))), [0, 0, -1]);
  const psi = WAVE_ROUND[f] * DEG, el = WAVE_RAISE[f] * DEG;
  const out: V3 = [s * Math.cos(psi), Math.sin(psi), 0];
  const raised: V3 = [Math.sin(el) * out[0], Math.sin(el) * out[1], -Math.cos(el)];
  // The upper arm turned from hanging to raised about the one axis between them, overshooting a little at the top.
  const om = Math.acos(Math.max(-1, Math.min(1, dot(hang, raised)))), so = Math.sin(om) || 1;
  const wa = Math.sin((1 - raise) * om) / so, wb = Math.sin(raise * om) / so;
  const u = unit([hang[0] * wa + raised[0] * wb, hang[1] * wa + raised[1] * wb, hang[2] * wa + raised[2] * wb]);
  // The forearm bent from the elbow toward forward as it hangs and toward straight up as it is raised.
  const want: V3 = [0, 1 - lift, lift], wu = dot(want, u);
  const p = unit([want[0] - u[0] * wu, want[1] - u[1] * wu, want[2] - u[2] * wu]);
  const bend = (r.elbow[k] + (WAVE_BEND[f] - (swing > 0 ? 24 : 16) * swing - r.elbow[k]) * lift) * DEG;
  const fa: V3 = [u[0] * Math.cos(bend) + p[0] * Math.sin(bend), u[1] * Math.cos(bend) + p[1] * Math.sin(bend), u[2] * Math.cos(bend) + p[2] * Math.sin(bend)];
  const S: V3 = [s * 2.1 * fr.sh, -0.1, ARM_AT * T + r.shrug[k]];
  const a = UPPER * T, b = LOWER * T;
  const wrist = place(chest, [S[0] + u[0] * a + fa[0] * b, S[1] + u[1] * a + fa[1] * b, S[2] + u[2] * a + fa[2] * b]);
  const was = r.hand[k];
  hold(r, fr, k, wrist, mv(chest.m, u));
  // The palm turned toward whoever is looking, and forward, and the hand flapping a little behind the forearm's swing.
  const toward = back([view.T[0], view.T[1], 0]);
  const palm = palmTo(r, k, unit([toward[0] + 0.3 * out[0], toward[1] + 0.6, 0.2]));
  r.hand[k] = [was[0] + (14 * swings * Math.cos(ph) - was[0]) * lift, was[1] * (1 - lift), was[2] + (palm - was[2]) * lift];
  r.open[k] = lift > 0.3;
  // The head turned toward whoever is looking, when they are in front, rather than about; and tilted toward the arm.
  const to = view.T[1] > -0.2 ? Math.max(-20, Math.min(20, Math.atan2(-view.T[0], view.T[1]) / DEG)) : 0;
  r.neck = [r.neck[0], r.neck[1], r.neck[2] * (1 - raise)];
  r.head = [r.head[0] + 3 * raise, r.head[1] + 3 * s * raise, r.head[2] * (1 - Math.min(1, raise)) + 0.6 * to * Math.min(1, raise)];
}

/*
 * The hop, phase by phase, in the hop's own time (see `HOPS` for when the
 * feet are off the ground): a crouch to load, the legs driven straight and
 * up onto the toes to leave, the knees tucked in the air and let down again
 * to reach for the ground, the landing taken on the knees and hips -- which
 * is also the crouch that loads the second, smaller hop -- and the last
 * landing taken and stood up out of. The body's height in the air is a fall
 * under gravity between where the hips were as the feet left and where they
 * are as the feet come down, whatever the legs are doing under it.
 */
const HOP_LOAD = 0.15;
/** How far down the hips go at the deepest of the first crouch, in the body's units, and how much of that each landing takes. */
const HOP_DROP = 1.7;
const HOP_LAND = [0.9, 0.7];
/** When each landing is at its deepest. */
const HOP_LOW = [0.53, 0.84];
/** The arms through a hop, as [when, swung forward, out, elbow]: back to load, swung forward and up through the leap, out to the sides in the air for balance, and forward and down to land. */
const HOP_ARMS: Key[] = [
  { at: 0, v: [3, 7, 15] },
  { at: 0.15, v: [-44, 12, 28] },
  { at: 0.21, v: [46, 24, 28] },
  { at: 0.27, v: [28, 54, 30] },
  { at: 0.36, v: [16, 66, 28] },
  { at: 0.45, v: [12, 38, 30] },
  { at: 0.51, v: [12, 18, 38] },
  { at: 0.555, v: [-24, 14, 30] },
  { at: 0.6, v: [36, 26, 30] },
  { at: 0.67, v: [18, 48, 30] },
  { at: 0.76, v: [12, 30, 32] },
  { at: 0.84, v: [12, 16, 32] },
  { at: 0.93, v: [5, 9, 20] },
];

/** The hop's pose `t` of the way through, over whatever the body was doing standing: everything but how high it is off the ground. */
function hopPose(r: Rig, t: number, fr: Frame): void {
  const [one, two] = HOPS;
  // In from standing and back out to it at the ends, so it starts and finishes on the idle it was done over.
  const env = step(t, 0, 0.08) * (1 - step(t, 0.9, 1));
  // How deep the crouch is: down to load, driven up out of it as fast as the hop leaves, and each landing taken as fast as it comes.
  const wave = (x: number, a: number, b: number): number => Math.sin((Math.PI / 2) * Math.max(0, Math.min(1, (x - a) / (b - a))));
  let c = 0;
  if (t < HOP_LOAD) c = ease(t / HOP_LOAD);
  else if (t < one.off) c = 1 - wave(t, HOP_LOAD, one.off);
  else if (t >= one.on && t < HOP_LOW[0]) c = HOP_LAND[0] * wave(t, one.on, HOP_LOW[0]);
  else if (t >= HOP_LOW[0] && t < two.off) c = HOP_LAND[0] * (1 - wave(t, HOP_LOW[0], two.off));
  else if (t >= two.on && t < HOP_LOW[1]) c = HOP_LAND[1] * wave(t, two.on, HOP_LOW[1]);
  else if (t >= HOP_LOW[1]) c = HOP_LAND[1] * (1 - ease((t - HOP_LOW[1]) / (1 - HOP_LOW[1])));
  // Up on the toes as the legs straighten to leave, pointed in the air, and down toe first, the heel after.
  const push = Math.max(wave(t, HOP_LOAD, one.off) * (t < one.off ? 1 : 0), wave(t, HOP_LOW[0], two.off) * (t >= HOP_LOW[0] && t < two.off ? 1 : 0));
  let toe = -24 * push;
  let tuck = 0;
  for (const [i, h] of HOPS.entries()) {
    if (t >= h.off && t < h.on) {
      const u = (t - h.off) / (h.on - h.off);
      toe = -24 + 20 * ease(u);
      // The knees drawn up through the rise and let down again to reach for the ground before it arrives.
      tuck = (i ? 0.55 : 1) * Math.pow(Math.sin(Math.PI * Math.min(1, u / 0.85)), 2);
    } else if (t >= h.on && t < h.on + 0.03) toe = -4 * (1 - (t - h.on) / 0.03);
  }
  // The hips go down and back over the feet, and the body leans forward over them as far as keeps it balanced.
  const base = hipsFor({ ...r, pelvis: [0, 0, 0], at: [0, 0, 0] }, fr, 1, stance(fr)[1], 3);
  r.pelvis = [r.pelvis[0] * (1 - env), r.pelvis[1] * (1 - env), r.pelvis[2] * (1 - env)];
  r.at = [r.at[0] * (1 - env), -0.55 * c, r.at[2] * (1 - env) + base * env - HOP_DROP * c];
  r.spine = [r.spine[0] * (1 - env) - 18 * c - 5 * tuck, r.spine[1] * (1 - env), r.spine[2] * (1 - env)];
  r.chest = [r.chest[0] - 4 * c, r.chest[1] * (1 - env), r.chest[2] * (1 - env)];
  // The head kept looking ahead rather than at the ground.
  r.neck = [r.neck[0] + 12 * c + 3 * tuck, r.neck[1], r.neck[2]];
  r.head = [r.head[0] + 8 * c, r.head[1], r.head[2]];
  r.hover = undefined;
  r.plant = undefined;
  r.leg = [[0, 0, TOE_OUT], [0, 0, TOE_OUT]];
  // Up on the toes, the ankle goes up and forward over the tip of the boot, which stays where it was on the ground.
  const q = toe * DEG, tip = SOLE[2];
  const lift: V3 = [0, tip[1] - (tip[1] * Math.cos(q) - tip[2] * Math.sin(q)), tip[2] - (tip[1] * Math.sin(q) + tip[2] * Math.cos(q))];
  r.at[2] += lift[2];
  for (let k = 0; k < 2; k++) {
    const at = stance(fr)[k];
    plant(r, fr, k, [at[0], at[1] + lift[1], at[2] + lift[2]]);
    r.leg[k] = [r.leg[k][0] + 42 * tuck, r.leg[k][1] + 4 * tuck, r.leg[k][2]];
    r.knee[k] += 78 * tuck;
    r.foot[k] = toe;
  }
  const arms = loop(HOP_ARMS, Math.max(0, Math.min(0.9999, t)));
  for (let k = 0; k < 2; k++) {
    const [p, a, e] = arms;
    r.arm[k] = [r.arm[k][0] + (p - r.arm[k][0]) * env, Math.max(r.arm[k][1], r.arm[k][1] + (a - r.arm[k][1]) * env), r.arm[k][2] * (1 - env)];
    r.elbow[k] = r.elbow[k] + (e - r.elbow[k]) * env;
  }
}

/** The hop `t` of the way through, and lifted off the ground as far as the leap has it. */
function hop(r: Rig, t: number, fr: Frame): void {
  const under = mixRig(r, r, 1);
  hopPose(r, t, fr);
  const h = HOPS.find((h) => t > h.off && t < h.on);
  if (!h) return;
  // Where the hips are, stood on the lowest sole, for the pose at a moment of it.
  const hips = (x: Rig): number => skeleton(fr, { ...x, lift: 0 }).pelvis.t[2];
  const at = (x: number): number => {
    const q = mixRig(under, under, 1);
    hopPose(q, x, fr);
    return hips(q);
  };
  const u = (t - h.off) / (h.on - h.off);
  const want = at(h.off) + (at(h.on) - at(h.off)) * u + emotePose('hop', t).lift / HEIGHT_SCALE;
  r.lift = Math.max(0, want - hips(r));
}

function rigOf(p: FigurePose, fr: Frame): Rig {
  const r = rest();
  if (p.swimming) swim(r, p.phase, p.moving, fr);
  else if (p.driving) drive(r, p.phase, p.moving, p.seat ?? BOX, fr);
  else if (p.moving) walk(r, p.phase, Math.max(0, Math.min(1, p.gait ?? 0)), fr);
  else if (p.working) work(r, p.phase, fr, p.facing);
  else idle(r, p.phase / 6, fr);
  if (p.emote && !p.swimming && !p.driving) emote(r, p.emote, p.emoteT ?? 0, p.facing, fr);
  r.stowed = r.tool || r.reins || !!r.sit || r.sink > 0 || !!p.emote;
  // Something too heavy to carry out in front, over the right shoulder.
  const held = p.gear?.weapon && weaponOf(p.gear.weapon.id);
  if (held && held.carry === 'shoulder' && !r.stowed) shoulder(r, fr, held, overLeft(p.facing) ? 0 : 1, p.facing);
  // At a run the body goes lower on bent knees, and the bow is held that much higher.
  if (held && held.carry === 'bow' && !r.stowed) bowArm(r, fr, held, p.moving ? 1.3 * Math.max(0, Math.min(1, p.gait ?? 0)) : 0, p.facing);
  if (p.moving && !p.swimming && !p.driving && !r.stowed) carrying(r, held || undefined, !!p.gear?.offhand, Math.max(0, Math.min(1, p.gait ?? 0)));
  // A hand with something in it is closed on it.
  if (held && !r.stowed) r.loose[held.carry === 'bow' ? 0 : held.carry === 'shoulder' ? r.carried : 1] = false;
  if (p.gear?.offhand && !r.stowed) r.loose[0] = false;
  if (p.cast && castPoser) castOver(r, p, castPoser);
  return r;
}

/**
 * The arms on the move with something in them, at gait `g`: an arm holding
 * a weight does not swing as a free one does. A blade or a hatchet in the
 * right fist swings a little over half as far, held out from the thigh so the
 * blade goes by the leg and not through it, and at a run is carried with the
 * elbow bent at the hip rather than pumped up at the chest; a spear upright in
 * it hardly swings at all, the hand at the side where its slant (`staffUp`)
 * keeps the shaft off the face, out from the hip and up a little so the butt
 * rides beside the stride and not down among the feet; and a shield on the left forearm is carried steady at the side, the
 * elbow bent and the arm out from the body, swinging a fraction as far.
 */
function carrying(r: Rig, held: Weapon | undefined, shield: boolean, g: number): void {
  const L = (a: number, b: number): number => a + (b - a) * g;
  // The arm's swing about where it hangs from, `keep` of it kept.
  const steady = (k: number, keep: number, fore = L(3, 6)): void => {
    r.arm[k][0] = fore + keep * (r.arm[k][0] - L(3, 6));
  };
  if (held?.carry === 'fist') {
    const e = r.elbow[1] - L(20, 90);
    steady(1, L(0.55, 0.45), L(3, 10));
    r.arm[1][1] += L(6, 9);
    r.arm[1][2] = L(0, 6);
    r.elbow[1] = L(24, 46) + 0.4 * e;
  } else if (held?.carry === 'staff') {
    const e = r.elbow[1] - L(20, 90);
    steady(1, L(0.25, 0.2), L(-4, -2));
    r.arm[1][1] += 9;
    r.arm[1][2] = 0;
    r.elbow[1] = L(44, 52) + 0.2 * e;
  }
  if (shield && held?.carry !== 'bow') {
    const e = r.elbow[0] - L(20, 90);
    steady(0, L(0.3, 0.3), L(8, 14));
    r.arm[0][1] += L(5, 4);
    r.arm[0][2] = L(0, 10);
    r.elbow[0] = L(34, 76) + 0.3 * e;
  }
}

/* ---- a spell being cast ------------------------------------------------------- */

/** What lays a spell's cast over a pose: `./spells`, which registers itself so this file needs to know no spell. */
let castPoser: ((r: Rig, p: FigurePose) => void) | null = null;
export function castPosesBy(fn: ((r: Rig, p: FigurePose) => void) | null): void {
  castPoser = fn;
}

/**
 * The cast over the pose. On the move -- walking, swimming, driving -- only the arms and the trunk are the
 * spell's: the legs, the hips and the body's height are put back as the motion had them, so a spell cast on the
 * run neither stops the feet nor lifts them off the ground.
 */
function castOver(r: Rig, p: FigurePose, poser: (r: Rig, p: FigurePose) => void): void {
  const moving = p.moving || p.swimming || !!p.driving;
  const keep = moving ? {
    at: r.at, pelvis: r.pelvis, leg: r.leg, knee: r.knee, foot: r.foot, flat: r.flat, lift: r.lift, sink: r.sink,
    hover: r.hover, plant: r.plant, tail: r.tail,
  } : null;
  poser(r, p);
  if (keep) Object.assign(r, keep);
}

/**
 * Where a point in a bone's frame is, on a body posed so, in the body's own units from the middle of its feet:
 * x to its right, y ahead of it, z up. For what a spell draws at a hand, the head or a weapon's point (`./spells`).
 * Bones: pelvis, spine, chest, neck, head, arm0/1, elbow0/1, wrist0/1, hip0/1, knee0/1, ankle0/1 (0 the left).
 */
export function figureJoint(pose: FigurePose, bone: string, at: V3 = [0, 0, 0]): V3 {
  const kit = kitFor(pose.look ?? DEFAULT_LOOK, 0.5);
  const b = skeleton(kit.fr, rigOf(pose, kit.fr));
  const xf = b[bone];
  return xf ? place(xf, at) : [0, 0, 0];
}

/* ---- one pose into the next -------------------------------------------------- */

/**
 * What a body is doing, as far as blending goes: a change of it is blended.
 * Swimming and driving are each two things, under way and stopped: one name
 * for both let the breaststroke drop to treading water, and an oar or the
 * reins jump from the middle of a stroke to lying still, in one frame.
 */
const doing = (p: FigurePose): string => (p.swimming ? (p.moving ? 'swim' : 'tread') : p.driving ? (p.moving ? 'drive' : 'drive still') : p.moving ? 'walk' : p.working ? (lefty(p.facing) ? 'work left' : 'work') : 'idle');

/** Seconds to blend from one thing to the next, and to come round one eighth of a turn. */
const BLEND = 0.22;
const TURN = 0.11;

function mixRig(a: Rig, b: Rig, w: number): Rig {
  const n = (x: number, y: number): number => x + (y - x) * w;
  const e = (x: Euler, y: Euler): Euler => [n(x[0], y[0]), n(x[1], y[1]), n(x[2], y[2])];
  return {
    at: e(a.at, b.at), pelvis: e(a.pelvis, b.pelvis), spine: e(a.spine, b.spine), chest: e(a.chest, b.chest), neck: e(a.neck, b.neck), head: e(a.head, b.head),
    arm: [e(a.arm[0], b.arm[0]), e(a.arm[1], b.arm[1])], elbow: [n(a.elbow[0], b.elbow[0]), n(a.elbow[1], b.elbow[1])], hand: [e(a.hand[0], b.hand[0]), e(a.hand[1], b.hand[1])],
    leg: [e(a.leg[0], b.leg[0]), e(a.leg[1], b.leg[1])], knee: [n(a.knee[0], b.knee[0]), n(a.knee[1], b.knee[1])], foot: [n(a.foot[0], b.foot[0]), n(a.foot[1], b.foot[1])],
    flat: b.flat, tail: e(a.tail, b.tail), lift: n(a.lift, b.lift), sink: n(a.sink, b.sink), blink: b.blink, reins: b.reins, tool: b.tool, lefty: b.lefty,
    // A float or a seat is taken at once, from the start of the blend, so the body is let into the water or onto the seat by it rather than
    // dropped on at the end; from one float to another -- swimming to treading water -- the head goes from the one height to the other.
    float: a.float !== undefined && b.float !== undefined ? n(a.float, b.float) : b.float ?? a.float,
    under: a.under !== undefined && b.under !== undefined ? n(a.under, b.under) : b.under,
    sit: b.sit && { ...b.sit, up: a.sit ? n(a.sit.up, b.sit.up) : b.sit.up }, seat: b.seat,
    // What is in the hands comes with the pose it is held in: an oar swung from where it was to where it goes, and turned flat or square
    // on the way, and the reins taken up or let go, rather than either put down at once.
    oars: a.oars && b.oars && a.oars.length === b.oars.length
      ? b.oars.map((o, i) => ({ ...o, out: e(a.oars![i].out, o.out), feather: n(a.oars![i].feather, o.feather) }))
      : b.oars,
    slack: a.slack !== undefined && b.slack !== undefined ? n(a.slack, b.slack) : b.slack,
    // Carried on the curve as much as the walk being blended into or out of is, so that stopping in the air at a run comes down
    // over the blend rather than dropping onto the lower foot at once.
    hover: b.hover ? { ...b.hover, w: b.hover.w * w } : a.hover && { ...a.hover, w: a.hover.w * (1 - w) },
    shrug: [n(a.shrug[0], b.shrug[0]), n(a.shrug[1], b.shrug[1])], open: b.open, loose: b.loose, stowed: b.stowed, carried: b.carried, spin: b.spin,
    plant: b.plant ? [b.plant[0] * w, b.plant[1] * w] : a.plant && [a.plant[0] * (1 - w), a.plant[1] * (1 - w)],
  };
}

/**
 * From swimming to treading water and back, which in the water is not done
 * in the time it takes to stop walking: the blend took the body from lying
 * along the surface to upright in a fifth of a second, which read as being
 * snapped upright on a string. Now it takes most of a second, and the arms go
 * first and the body after them: stopping, the hands come round out to the
 * sides while the legs are still sinking under; setting off, the hands reach
 * forward and the body tips up along the surface behind them.
 */
const WATER_BLEND = 0.6;
function mixWater(a: Rig, b: Rig, t: number): Rig {
  const arms = mixRig(a, b, ease(Math.min(1, t / 0.65)));
  const body = mixRig(a, b, ease(Math.max(0, (t - 0.25) / 0.75)));
  return { ...body, arm: arms.arm, elbow: arms.elbow, hand: arms.hand, shrug: arms.shrug };
}

interface Held {
  doing: string;
  /** The pose last drawn, and the one a blend started from, and when. */
  rig: Rig;
  from: Rig;
  since: number;
  /** The way it faces as drawn, the way it is turning to, where the turn started and when. */
  facing: number;
  goal: number;
  turnFrom: number;
  turnSince: number;
  seen: number;
  /** How far the head and shoulders are turned ahead of the body toward where it is turning, in degrees: see `settle`. */
  lead: number;
  /** Whether the blend going on is from swimming to treading water or back, which is blended its own way (`mixWater`). */
  water?: boolean;
}

const held = new Map<string, Held>();
const ease = (x: number): number => x * x * (3 - 2 * x);

/** The pose and facing to draw a known body in now, blended from how it was last drawn. */
function settle(id: string, p: FigurePose, target: Rig, now: number): { rig: Rig; facing: number; changing: boolean } {
  // One of the eight ways; or, sat in something, square along it however it is turned (`FigurePose.seat`).
  const goal = (((p.seat ? p.facing : Math.round(p.facing)) % 8) + 8) % 8;
  let h = held.get(id);
  // A body not drawn for a while -- off screen, or just arrived -- starts where it is.
  if (!h || now - h.seen > 0.5) {
    h = { doing: doing(p), rig: target, from: target, since: -1, facing: goal, goal, turnFrom: goal, turnSince: -1, seen: now, lead: 0 };
    held.set(id, h);
    if (held.size > 256) for (const [k, v] of held) if (now - v.seen > 5) held.delete(k);
  }
  const dt = Math.max(0, Math.min(0.1, now - h.seen));
  h.seen = now;
  if (doing(p) !== h.doing) {
    h.water = p.swimming && (h.doing === 'swim' || h.doing === 'tread');
    h.doing = doing(p);
    h.from = h.rig;
    h.since = now;
  }
  const w = Math.min(1, Math.max(0, (now - h.since) / (h.water ? WATER_BLEND : BLEND)));
  h.rig = w < 1 ? (h.water ? mixWater(h.from, target, w) : mixRig(h.from, target, ease(w))) : target;
  if (goal !== h.goal) {
    h.goal = goal;
    h.turnFrom = h.facing;
    h.turnSince = now;
  }
  // The short way round, at an eighth of a turn per TURN seconds.
  let d = h.goal - h.turnFrom;
  d -= 8 * Math.round(d / 8);
  const k = Math.min(1, Math.max(0, (now - h.turnSince) / (TURN * Math.max(1, Math.abs(d)))));
  h.facing = k < 1 ? h.turnFrom + d * ease(k) : h.goal;
  /*
   * Turned as a body turns rather than as a figure on a turntable: the head
   * goes round first, the shoulders after it and the hips last, and each
   * comes to rest a moment after the turn is done -- the head and
   * shoulders by how much of the turn is still to come, and the hips that
   * much behind. Followed rather than set, so a turn started, or changed, in
   * the middle of another does not snap the head round.
   */
  let togo = h.goal - h.facing;
  togo -= 8 * Math.round(togo / 8);
  const want = Math.max(-LEAD_MOST, Math.min(LEAD_MOST, togo * 45 * LEAD));
  h.lead += (want - h.lead) * Math.min(1, dt * LEAD_RATE);
  if (Math.abs(h.lead) < 0.05) h.lead = 0;
  const rig = h.lead ? turnedAhead(h.rig, h.lead) : h.rig;
  return { rig, facing: h.facing, changing: w < 1 || k < 1 || h.lead !== 0 };
}

/** How far ahead of the body the head and shoulders turn, as a share of the turn still to come, and at most, in degrees; and how quickly they follow it, per second. */
const LEAD = 0.7;
const LEAD_MOST = 60;
const LEAD_RATE = 22;

/** A pose with the body turned `lead` degrees ahead of its facing, most at the head and least at the hips, which are behind it. */
function turnedAhead(r: Rig, lead: number): Rig {
  const yaw = (e: Euler, by: number): Euler => [e[0], e[1], e[2] + by * lead];
  // Of the lead: the hips -0.3, the chest +0.25 and the head +0.6 of it, from the ground.
  return { ...r, pelvis: yaw(r.pelvis, -0.3), spine: yaw(r.spine, 0.4), chest: yaw(r.chest, 0.15), neck: yaw(r.neck, 0.15), head: yaw(r.head, 0.2) };
}

type Bones = Record<string, Xf>;

/** The sole's corners in the ankle's frame: what is stood on. */
const SOLE: V3[] = [[-0.37, -0.58, -0.75], [0.37, -0.58, -0.75], [0.35, 1.72, -0.75], [-0.35, 1.72, -0.75]];

/**
 * The pose put on the skeleton, and then the whole stood on the ground: the
 * lowest point of either sole goes down to it, which is what makes a stride
 * rise and fall and keeps a planted foot planted, whatever the angles above.
 */
function skeleton(fr: Frame, r: Rig): Bones {
  const T = fr.tall;
  const pelvis = joint(ROOT, [r.at[0], r.at[1], HIP * T + r.at[2]], ...r.pelvis);
  const spine = joint(pelvis, [0, 0, SPINE * T], ...r.spine);
  const chest = joint(spine, [0, 0, CHEST * T], ...r.chest);
  const neck = joint(chest, [0, -0.08, NECK * T], ...r.neck);
  const head = joint(neck, [0, 0.06, HEADJ], ...r.head);
  const b: Bones = { pelvis, spine, chest, neck, head };
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    const [ap, aa, at] = r.arm[k];
    b[`arm${k}`] = joint(chest, [s * 2.1 * fr.sh, -0.1, ARM_AT * T + r.shrug[k]], ap, -s * aa, s * at);
    b[`elbow${k}`] = joint(b[`arm${k}`], [0, 0, -UPPER * T], r.elbow[k]);
    b[`wrist${k}`] = joint(b[`elbow${k}`], [0, 0, -LOWER * T], ...r.hand[k]);
    const [lp, la, lt] = r.leg[k];
    b[`hip${k}`] = joint(pelvis, [s * 1.0 * fr.hi, 0, -0.1], lp, -s * la, s * lt);
    b[`knee${k}`] = joint(b[`hip${k}`], [0, 0, -THIGH * T], -r.knee[k]);
    const level = r.flat[k] ? -(r.pelvis[0] + lp - r.knee[k]) : 0;
    b[`ankle${k}`] = joint(b[`knee${k}`], [0, 0, -SHIN * T], level + r.foot[k]);
  }
  let low = Infinity;
  for (let k = 0; k < 2; k++) for (const p of SOLE) low = Math.min(low, place(b[`ankle${k}`], p)[2]);
  // Stood on the lowest sole; or, a swimmer, let down into the water -- and part way between while going in or coming out.
  const wet = Math.min(1, r.sink / SINK);
  // A swimmer is held with the head at its height over the water, however the body is laid in it; and part way there going in or out.
  let dz = -low * (1 - wet) + wet * (r.float !== undefined ? r.float - b.head.t[2] : -SINK) + r.lift;
  if (r.sit) {
    /*
     * Sat: the underside of the thighs (`SEAT`, which is where a skirt lies
     * on the seat too) down on the seat, and each foot put down on the floor
     * by bending or straightening its knee, from where the pose has it. A
     * rider's feet hang in the stirrups instead, wherever the legs put them.
     */
    dz = r.sit.up - place(b.pelvis, [0, 0, SEAT])[2] + r.lift;
    if (!r.sit.astride) for (let k = 0; k < 2; k++) plantFoot(b, r, fr, k, dz, 1);
  }
  if (r.hover && r.hover.w > 0) {
    // Where the hips are at mid-stance, from the stance leg then: the thigh, the shin under the bent knee, the foot.
    const T = fr.tall, { h, w, thigh, knee } = r.hover;
    const stood = 0.1 + THIGH * T * Math.cos(thigh * DEG) + SHIN * T * Math.cos((thigh - knee) * DEG) + 0.75;
    const want = stood + h - HIP * T - r.at[2];
    if (r.plant) {
      /*
       * Carried on the curve exactly, and the foot that is on the ground
       * kept on it: its knee bent a little more where the leg is too long
       * for the body's height there, which is what would otherwise push the
       * body up off the curve in a jolt, and straightened where it is too
       * short, which would leave the foot standing on nothing.
       */
      dz += w * (want - dz);
      // A foot swinging through low enough to catch the ground folds its knee just enough to clear it.
      for (let k = 0; k < 2; k++) plantFoot(b, r, fr, k, dz, r.plant[k], r.plant[k] <= 0);
      // And never with a foot through the ground, planted or not.
      let under = Infinity;
      for (let k = 0; k < 2; k++) for (const p of SOLE) under = Math.min(under, place(b[`ankle${k}`], p)[2] + dz);
      if (under < 0) dz -= under;
    } else dz += w * Math.max(0, want - dz);
  }
  for (const key of Object.keys(b)) b[key] = { m: b[key].m, t: [b[key].t[0], b[key].t[1], b[key].t[2] + dz] };
  return b;
}

/**
 * A foot put down on the ground, `weight` of the way, by turning the leg at
 * the hip and the knee together so the foot goes straight down to it (or up)
 * and stays where it is along the ground: the body `dz` above where the
 * bones were built, and the foot kept level if it was being kept so. The knee
 * alone did it once, which swung the foot forward or back along the ground as
 * it bent -- a foot that should have been still slid under the body. Or,
 * `clear`, only lifted out of the ground if it is in it.
 */
function plantFoot(b: Bones, r: Rig, fr: Frame, k: number, dz: number, weight: number, clear = false): void {
  const T = fr.tall, A = THIGH * T, B = SHIN * T;
  const s = k ? 1 : -1, [, la, lt] = r.leg[k];
  // The hip's frame before its pitch, which the leg swings in.
  const F = joint(b.pelvis, [s * 1.0 * fr.hi, 0, -0.1], 0, -s * la, s * lt);
  const m = F.m;
  for (let q = 0; q < 2; q++) {
    let low = Infinity;
    for (const p of SOLE) low = Math.min(low, place(b[`ankle${k}`], p)[2]);
    // How far the sole is off the ground, to take out. A foot coming down or leaving is put part of the way down, but out of the
    // ground all the way: pushed into it, it stood the whole body up off the other foot.
    const off = clear || low + dz < 0 ? Math.min(0, low + dz) : (low + dz) * weight;
    if (Math.abs(off) < 1e-3) return;
    // The ankle moved straight down by that, in the hip's frame.
    const at = b[`ankle${k}`].t;
    const w: V3 = [at[0] - F.t[0], at[1] - F.t[1], at[2] - off - F.t[2]];
    const y = m[1] * w[0] + m[4] * w[1] + m[7] * w[2], z = m[2] * w[0] + m[5] * w[1] + m[8] * w[2];
    // The knee's bend from how far that is, never bent backward and never past straight; and the thigh's swing from which way.
    const d = Math.max(Math.abs(A - B) + 1e-3, Math.min(0.9995 * (A + B), Math.hypot(y, z)));
    const bend = Math.acos(Math.max(-1, Math.min(1, (d * d - A * A - B * B) / (2 * A * B))));
    const lp = (Math.atan2(y, -z) - Math.atan2(-B * Math.sin(bend), A + B * Math.cos(bend))) / DEG, deg = bend / DEG;
    b[`hip${k}`] = joint(b.pelvis, [s * 1.0 * fr.hi, 0, -0.1], lp, -s * la, s * lt);
    b[`knee${k}`] = joint(b[`hip${k}`], [0, 0, -A], -deg);
    const level = r.flat[k] ? -(r.pelvis[0] + lp - deg) : 0;
    b[`ankle${k}`] = joint(b[`knee${k}`], [0, 0, -B], level + r.foot[k]);
  }
}

/*
 * The knee, bent. The leg was a thigh and a shin, two tubes each rigid on its
 * own bone, and a ball over the joint between them: bent, the end of the
 * thigh stood out at the back of the knee, the top of the shin's tube at the
 * front, and the ball as a cap poking out of whichever side was toward the
 * viewer -- stacked tubes, not a leg. Now everything on the leg is made
 * straight, in the knee's own terms -- `z` up the thigh from the knee and down
 * the shin from it -- and bent here as a modeller's skinned joint is: what is
 * further than `KNEE_SPAN` above the knee goes with the thigh, what is
 * further below it with the shin, and between the two it turns part of the
 * way, half at the knee itself, so a ring there is the joint ring that keeps
 * the two meeting edge to edge at every bend. The ring at the knee also
 * keeps the leg's volume as it bends: out at the front, where the kneecap
 * comes to a point between the thigh and the shin (by `KNEE_POINT` of the
 * way to the sharp mitre the two would meet in), and in at the back, where
 * the thigh and the calf close on each other (by `KNEE_FOLD`), and a
 * little wider across (by `KNEE_WIDE`).
 */
const KNEE_SPAN = 0.62;
const KNEE_POINT = 0.5;
const KNEE_FOLD = 0.9;
/** And wider across, by this much bent square, as a knee is: without it a knee bent toward the viewer came to a point like a stake. */
const KNEE_WIDE = 0.16;

/** How far a leg's knee is bent, in degrees: read off its bones rather than the pose, since a foot put down on the ground bends it further. */
function kneeBend(b: Bones, k: number): number {
  const h = b[`hip${k}`].m, n = b[`knee${k}`].m;
  // The knee's turn in the hip's frame is a pitch about x alone, of minus the bend: its row for z, column for y and z.
  const s = h[2] * n[1] + h[5] * n[4] + h[8] * n[7];
  const c = h[2] * n[2] + h[5] * n[5] + h[8] * n[8];
  return -Math.atan2(s, c) / DEG;
}

/**
 * A mesh made straight in the knee's terms bent as the leg is: in the frame
 * of the thigh at the knee, for what is put on the thigh, or of the shin, for
 * what is put on the shin. Either way the same point of it goes to the same
 * place, so a thing on the thigh and a thing on the shin made to meet at the
 * knee meet there at every bend.
 */
function kneeBent(v: readonly V3[], bend: number, onShin: boolean): V3[] {
  const th = Math.max(0, Math.min(150, bend)) * DEG, th0 = bend * DEG;
  const half = Math.cos(th / 2);
  const point = KNEE_POINT * (1 / half - 1), fold = KNEE_FOLD * (1 - half), wide = KNEE_WIDE * Math.sin(th / 2);
  return v.map(([x, y, z]) => {
    // How far round with the shin: none above the span, all of it below, a half at the knee.
    const w = Math.max(0, Math.min(1, (KNEE_SPAN - z) / (2 * KNEE_SPAN)));
    const at = 1 - Math.abs(2 * w - 1);
    const yy = y * (1 + (y > 0 ? point : -fold) * at);
    // Where it goes in the thigh's frame at the knee.
    const a = -w * bend * DEG;
    let c = Math.cos(a), s = Math.sin(a);
    let qy = c * yy - s * z;
    const qz = s * yy + c * z;
    // The back of the calf, folded up beside the thigh, pressed flat against the back of it rather than through it: bent hard, the
    // top of the calf came up inside the thigh, and drawn over it was a lit patch at the back of the knee.
    if (w > 0.5 && y < 0 && qz > 0 && qy > y) qy += (y - qy) * ramp(qz, 0, 0.5);
    if (!onShin) return [x * (1 + wide * at), qy, qz];
    c = Math.cos(th0); s = Math.sin(th0);
    return [x * (1 + wide * at), c * qy - s * qz, s * qy + c * qz];
  });
}

/**
 * The elbow bent as an arm bends, rather than as two tubes hinged: every
 * corner of whatever is worn on the upper arm or the forearm is carried round
 * the elbow's hinge by a share of its bend -- none `ELBOW_BEND` above the
 * elbow, all of it as far below, and half at the elbow itself -- so the upper
 * arm's shell and the forearm's, meeting in one ring there, stay one limb
 * however far it bends: the outside of the elbow turns in steps across the
 * rings either side of it rather than in one corner, and opens no gap, and
 * the crook folds in on itself. `e` is the bend in degrees; `U`, for corners
 * in the upper arm's frame, how far down it the elbow is, and none for corners
 * in the forearm's, whose origin it is.
 */
function bentAtElbow(v: V3[], e: number, U?: number): V3[] {
  const z0 = U === undefined ? 0 : -U;
  // How far the crook is drawn in: nothing straight, most of the way bent double.
  const pinch = ELBOW_PINCH * Math.pow(Math.sin((Math.max(0, e) * DEG) / 2), 2);
  return v.map((p) => {
    const share = Math.max(0, Math.min(1, (ELBOW_BEND - (p[2] - z0)) / (2 * ELBOW_BEND)));
    // The forearm's corners are already bent all the way, and come back by what of the bend is not theirs.
    const a = (U === undefined ? share - 1 : share) * e * DEG;
    if (!a) return p;
    // The inside of the bend drawn in toward the bone, most at the elbow, as the flesh and the cloth of the crook are pressed
    // aside: turned without it, the crook of an arm bent hard folded out through the forearm in front of it.
    const y = p[1] > 0 ? p[1] * (1 - pinch * (1 - Math.abs(2 * share - 1))) : p[1];
    const c = Math.cos(a), s = Math.sin(a), z = p[2] - z0;
    return [p[0], c * y - s * z, z0 + s * y + c * z];
  });
}

/**
 * The shoulder's give: from `SHOULDER_GIVE` under the joint, where the arm
 * swings whole, up to `SHOULDER_KEEP` over it, where its top stays on the
 * shoulder; and the most of a swing the top is kept back from, in degrees.
 */
const SHOULDER_GIVE = 0.7;
const SHOULDER_KEEP = 0.3;
const SHOULDER_MOST = 32;
/**
 * And of an arm raised past `SHOULDER_RAISED` degrees, this much of the rest of the turn kept back as well: the underside of a
 * thick sleeve over the armpit is drawn down toward the side of the coat rather than raised square off it, where it was a step
 * out from the side of the body under the arm.
 */
const SHOULDER_RAISED = 50;
const SHOULDER_HIGH = 0.35;

/**
 * The top of the upper arm kept on the shoulder rather than swung bodily
 * with the arm: every corner of what is on the upper arm above
 * `SHOULDER_GIVE` under the joint is carried round with the arm by less of
 * its swing the higher it is -- of the turn from where the arm hangs at rest
 * to where it is, as much as `SHOULDER_MOST` of it is taken back out about
 * the joint, all of that at the top. Swung whole, an arm swung forward stood
 * the back of its top up off the shoulder blade as a knob, and one swung
 * back the front of it over the collarbone; as a shoulder does, the top now
 * stays over the joint at a walk and a run and the turn is taken down the
 * deltoid. An arm raised high takes most of the rest of the turn with it
 * (all but `SHOULDER_HIGH` of it), or its top would be left as a lid on the
 * side of the shoulder.
 */
function bentAtShoulder(v: V3[], r: Rig, k: number): V3[] {
  const { n, angle } = shoulderTurn(r, k);
  if (angle < 0.01) return v;
  const kept = Math.min(angle, SHOULDER_MOST * DEG) + SHOULDER_HIGH * Math.max(0, angle - SHOULDER_RAISED * DEG);
  return v.map((p) => {
    const share = Math.max(0, Math.min(1, (p[2] + SHOULDER_GIVE) / (SHOULDER_GIVE + SHOULDER_KEEP)));
    return share ? turnedAbout(p, n, share * kept) : p;
  });
}

/** How far an arm is turned from where it hangs at rest, and about what axis, in the arm's own frame: the turn that takes it back. */
function shoulderTurn(r: Rig, k: number): { n: V3; angle: number } {
  const s = k ? 1 : -1;
  const [ap, aa, at] = r.arm[k];
  const turn = (p: number, a: number, w: number): M3 => mm(rz(s * w * DEG), mm(ry(-s * a * DEG), rx(p * DEG)));
  // From the arm's frame as posed into its frame at rest.
  const A = turn(ap, aa, at), R = turn(4, 8, 0);
  const D: M3 = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
    const row = Math.floor(i / 3), col = i % 3;
    return A[row] * R[col] + A[3 + row] * R[3 + col] + A[6 + row] * R[6 + col];
  });
  const cos = Math.max(-1, Math.min(1, (D[0] + D[4] + D[8] - 1) / 2)), angle = Math.acos(cos);
  const n = Math.sin(angle) > 1e-4 ? unit([D[7] - D[5], D[2] - D[6], D[3] - D[1]]) : unit([D[0] + 1, D[3], D[6]]);
  return { n, angle };
}

/** A point turned by `a` about the axis `n` through the origin (Rodrigues). */
function turnedAbout(p: V3, n: V3, a: number): V3 {
  const c = Math.cos(a), sn = Math.sin(a), d = dot(n, p), x = cross(n, p);
  return [p[0] * c + x[0] * sn + n[0] * d * (1 - c), p[1] * c + x[1] * sn + n[1] * d * (1 - c), p[2] * c + x[2] * sn + n[2] * d * (1 - c)];
}

/**
 * How far round with the arm what is carried whole on top of it goes -- a
 * shoulder cap, a pauldron -- for the arm turned `a` from where it hangs: half
 * of it up to `CAP_EASY`, and a quarter of the rest. It was carried bodily
 * with the arm, stiff as it is, and an arm raised to wave stood the cap on
 * its edge beside the head, its lames fanned up past the ear like a stack of
 * discs, and a pauldron on the arm raised to strike swung its dome into the
 * chin. A cap is strapped to the shoulder as much as to the arm: it stays
 * over the joint and only tips as the arm goes up, and the arm comes up out
 * from under its rim.
 */
const CAP_EASY = 40;
const capTurn = (a: number): number => (a < CAP_EASY * DEG ? a * 0.5 : CAP_EASY * DEG * 0.5 + (a - CAP_EASY * DEG) * 0.25);
function heldOnShoulder(v: readonly V3[], r: Rig, k: number): V3[] {
  const { n, angle } = shoulderTurn(r, k);
  if (angle < 0.01) return [...v];
  const back = angle - capTurn(angle);
  return v.map((p) => turnedAbout(p, n, back));
}

/* ---- drawing ------------------------------------------------------------------ */

export type Palette = Record<Mat, RGB>;

/**
 * A piece of gear's colours before its own metal, wood and dye go in: iron,
 * oak, undyed linen and tanned hide, in the island's chalky range -- nothing
 * a pure grey or a pure black, the steel a shade toward blue and the shadows
 * of everything toward cool.
 */
export const GEAR_BASE: Record<GearMat, RGB> = {
  metal: [156, 160, 168], metalDark: [98, 102, 114], metalLit: [214, 218, 224], mail: [134, 139, 148],
  scale: [104, 138, 124], scaleDark: [66, 92, 86], leather: [158, 112, 92], leatherDark: [120, 90, 80], leatherLit: [198, 152, 126], lace: [210, 190, 152],
  cloth: [194, 178, 142], clothDark: [156, 140, 108], lining: [210, 196, 164], wood: [176, 146, 114], woodDark: [124, 100, 80],
  grip: [100, 78, 62], blade: [220, 224, 228], fitting: [200, 168, 96], gem: [124, 184, 204], string: [228, 216, 192],
  fletch: [228, 220, 202], rivet: [200, 202, 208], stone1: [200, 168, 96], stone2: [200, 168, 96], stone3: [200, 168, 96],
};

/**
 * A wildermon's colours before its coat and its own things go in: the coat
 * and its markings are its variant's (`./beasts`), and these are the horn,
 * hoof, leaf and ember any kind starts from. Nothing of a person is made of
 * them.
 */
export const BEAST_BASE: Record<BeastMat, RGB> = {
  coat: [150, 120, 96], coatDark: [118, 92, 76], coatLight: [184, 158, 134], mark: [214, 196, 170], belly: [200, 180, 154],
  muzzle: [226, 212, 190], nose: [70, 52, 58], inner: [232, 170, 170], eyeWhite: [246, 242, 234], lid: [96, 74, 66],
  claw: [96, 82, 76], pad: [92, 70, 72], horn: [226, 214, 188], hornDark: [196, 182, 152], membrane: [206, 160, 168], hoof: [88, 72, 64], tooth: [244, 236, 214], tongue: [220, 120, 128],
  leaf: [132, 178, 104], leafDark: [92, 142, 86], stem: [112, 148, 84], petal: [246, 196, 214], bloom: [250, 222, 120],
  moss: [124, 156, 92], bark: [132, 100, 76], stone: [168, 164, 156], stoneDark: [120, 118, 116], crystal: [170, 214, 236],
  crystalDark: [118, 164, 200], ember: [246, 150, 72], flame: [255, 214, 120], shell: [226, 196, 164], shellDark: [184, 148, 120],
  feather: [150, 120, 96], featherDark: [118, 92, 76], bill: [240, 176, 92], billDark: [206, 142, 70], water: [168, 214, 232], cap: [214, 92, 88],
  spot: [248, 240, 226],
};

function paletteOf(p: FigurePose, look: Look): Palette {
  const skin = hex(skinColour(look)), hair = hex(hairColour(look)), tunic = hex(p.tunic ?? shirtColour(look));
  return {
    skin,
    lip: mixRGB(skin, [150, 62, 60], 0.32),
    hair,
    brow: mixRGB(hair, [22, 16, 14], 0.3),
    eye: mixRGB(hex(eyeColour(look)), [10, 8, 8], 0.35),
    glint: [250, 246, 236],
    // The white of the eye, a little of it round the dark: what makes an eye read on the darkest skins.
    white: mixRGB(skin, [248, 244, 236], 0.62),
    tunic,
    trim: mixRGB(tunic, [30, 24, 22], 0.2),
    trousers: hex(p.trousers ?? trouserColour(look)),
    boot: [84, 62, 50],
    cuff: [150, 118, 86],
    sole: [52, 40, 33],
    belt: [68, 48, 33],
    buckle: [214, 180, 98],
    // A shaved scalp is most of the way to the hair's colour; a shadow of beard on the jaw is most of the way to the skin's.
    shaved: mixRGB(mixRGB(skin, hair, 0.62), [40, 30, 28], 0.1),
    stubble: mixRGB(skin, mixRGB(hair, [40, 30, 28], 0.2), 0.3),
    edge: mixRGB(hair, [22, 16, 14], 0.15),
    rein: [74, 53, 36],
    haft: [158, 118, 76],
    iron: [128, 126, 132],
    // Nothing of the body is made of these; a piece of gear brings its own (`gearPalette`), and these are what it starts from.
    ...GEAR_BASE,
    ...BEAST_BASE,
  };
}

/** Every colour at what it starts from, for a palette built over it: a wildermon's, which has a body's eyes and a goblin's leather. */
export const PLAIN_PALETTE: Palette = paletteOf({ phase: 0, moving: false, facing: 0, swimming: false, working: false }, DEFAULT_LOOK);

/**
 * The metals and scale of a piece of gear, whose dark side leans cool as well
 * as going darker: a copper helm is a cooler brown in its shadow, not a
 * deeper orange, and iron goes blue-grey.
 */
const COOLS = new Set<Mat>(['metal', 'metalDark', 'metalLit', 'mail', 'blade', 'rivet', 'fitting', 'scale', 'scaleDark']);
const COOL_TINT: RGB = [118, 130, 160];
/**
 * Hide, and the lightest it goes in shadow: over a whole suit of it the shadow side at half its colour is most of the figure gone to
 * dark brown, where a suit of plate, held to three-fifths, keeps its value.
 */
const HIDE = new Set<Mat>(['leather', 'leatherDark', 'leatherLit', 'lace']);
const HIDE_LEAST = 0.64;
function toneOf(P: Palette, m: Mat, k: number, gear: boolean): string {
  // A rare piece: the tone its own colours give it, glazed toward its rarity's hue, further on its lit side than in its shadow.
  const glaze = GLAZES.get(P);
  if (glaze) return glazedTone(toneOf(glaze.base, m, k, gear), glaze, k);
  if (!gear) return shade(P[m], k);
  // Gear takes the same light as the body, harder, so its lit side and its shadow side are two planes whatever its colour: metal half as
  // much again between them, cloth and hide and wood well over a half, scale a third; and no metal goes darker than three-fifths lit.
  const cool = COOLS.has(m);
  // A lit edge or a blade's flat full in the light no further than a little over its own colour, which is pale already: past that it
  // goes to paper white and the blade is a gap in the picture.
  const kk = Math.min(m === 'metalLit' ? 1.02 : m === 'blade' ? 1.05 : Infinity, Math.max(cool ? 0.6 : HIDE.has(m) ? HIDE_LEAST : 0, 0.92 + (k - 0.92) * (m === 'scale' || m === 'scaleDark' ? 1.3 : cool ? 1.5 : 1.55)));
  // Hide in the light takes a sheen off its oiled face, toward the light's own colour: scaled up alone a red-brown goes to a hotter
  // red rather than a lighter one.
  if (HIDE.has(m) && kk > 1) {
    const c = mixRGB(P[m], WARM_LIGHT, kk - 1);
    return shade(c, Math.min(kk, 250 / Math.max(1, c[0], c[1], c[2])));
  }
  // Its shadow leans cool: blue-grey, or on copper the green it weathers to -- from further into the light and further, since copper's
  // own colour is near hide's, and a warm shadow on it is a leather one.
  const green = P.metal === METAL_TONE.copper || P.metal === METAL_TONE.bronze;
  const from = green ? 1.0 : 0.94;
  // Lit no further than its brightest channel will go: past that, a colour clips toward lemon or cyan instead of getting lighter.
  if (!cool || kk >= from) return shade(P[m], Math.min(kk, 250 / Math.max(1, P[m][0], P[m][1], P[m][2])));
  return shade(mixRGB(P[m], green ? VERDIGRIS : COOL_TINT, Math.min(green ? 0.6 : 0.32, (from - kk) * (green ? 2.0 : 1.1))), kk);
}
/** The ink round a piece of gear: the body's own warm dark, with a breath of the colour it is round. */
const gearInk = (c: RGB): RGB => {
  const m = mixRGB(INK, c, 0.14);
  // Never lighter than a little under half the colour it is round, darkened as a whole so it keeps the ink's warmth.
  const k = Math.min(1, (0.45 * Math.max(c[0], c[1], c[2])) / Math.max(1, m[0], m[1], m[2]));
  return [m[0] * k, m[1] * k, m[2] * k];
};

/** The ink round a colour: a dark, warm shade of it, and never lighter than a little over half of it, so black hair is not outlined in brown. */
const inkOf = (c: RGB): RGB => {
  const m = mixRGB(c, INK, 0.6);
  return [Math.min(m[0], c[0] * 0.55), Math.min(m[1], c[1] * 0.55), Math.min(m[2], c[2] * 0.55)];
};

/** A colour at a light level, as the canvas wants it, made once and kept. */
const shades = new Map<number, string>();
function shade(c: RGB, k: number): string {
  const r = Math.max(0, Math.min(255, Math.round(c[0] * k)));
  const gg = Math.max(0, Math.min(255, Math.round(c[1] * k)));
  const b = Math.max(0, Math.min(255, Math.round(c[2] * k)));
  const key = (r << 16) | (gg << 8) | b;
  let s = shades.get(key);
  if (!s) {
    if (shades.size > 8192) shades.clear();
    s = `rgb(${r},${gg},${b})`;
    shades.set(key, s);
  }
  return s;
}

export interface Part {
  mesh: Mesh;
  xf: Xf;
  /** Its own colours, for a piece of gear: its metal, its wood, its dye. The body's otherwise. */
  pal?: Palette;
  /** How rare the piece it belongs to is, 1 to 3, for the shine laid over it (`shineOn`); and where in its cycle. */
  rare?: number;
  seed?: number;
  /** Corners already bent, for a mesh that moves within itself. */
  v?: V3[];
  /** Pushed nearer in the drawing order than where it stands says. */
  bias: number;
  /**
   * Drawn just after this other part, whatever their middles say: hair lies
   * on the head, so it goes down after it from every side, and a belt goes
   * round the tunic.
   */
  after?: Part | Part[];
  /**
   * Only after it while this side of the part is toward the viewer, or not
   * far off square to them, and before it once it is turned well away: a
   * beard lies on the cheek seen side on, and from behind the head and the
   * neck are in front of it. Well away is past a third of the way from
   * square to straight away, so a head a little turned at either does not
   * flip it.
   */
  front?: V3;
  /**
   * Never drawn after this other part, or any of these: a neck goes under
   * the head it holds up, from in front where the chin comes over it and from
   * behind where the hair does, however far forward the head is bowed.
   */
  under?: Part | Part[];
  /** No facet of it can be in front of another, so its facets may go down in any order. */
  convex?: boolean;
  /**
   * Solids in the part's own frame, each `c` its middle and `r` its
   * half-sizes, that hide whatever of the part is behind them. Hair is drawn
   * after the head so that it lies on it; this is what keeps a bun or the end
   * of a crest out of sight when it is round the far side, and a beard when
   * it is round the far side of the jaw.
   */
  hide?: Array<{ c: V3; r: V3 }>;
  /** The frame those solids are in, when not the part's own: a lock of hair swings from the head, and is hidden by the skull. */
  hideIn?: Xf;
  /**
   * A wildermon's piece (`./beasts`), lit its own way: from higher overhead
   * than a person is, in three steps rather than a slope, the shadow step
   * cooler as well as darker. A round mass is a lit top, a middle and a shade
   * rather than a flicker of facets.
   */
  toon?: boolean;
  /** Lines inside it or not: without, only the outline round the whole of it, for a fleece of puffs or a cloud. */
  lines?: boolean;
  /** Inked lightly, for what is airy: a seed head, a wisp. */
  airy?: boolean;
  /** Not inked at all, round the outside or in: what is too fine to carry a line. */
  rim?: boolean;
  /** Outlined at half the width, for what is thin enough that a full outline would be most of it: a wader's leg. */
  thin?: boolean;
  /** For a `toon` part, a rim of light in this colour where its top turns away from the viewer: a cloud's silver edge. */
  sheen?: Mat;
  /**
   * One of the links of something in links -- a tail -- named for the whole
   * of it: the lines round every link that follows another in the drawing go
   * down together before any of them, fattened, so each link covers the
   * others' lines where they join and the whole is lined as one thing, with
   * no ring round it at every joint.
   */
  chain?: string;
}

/** A wildermon's light, in the steps a piece that is `toon` is lit in. */
const TOON_LIT = 1.07, TOON_MID = 0.97, TOON_SHADE = 0.84;
/** The light on a surface turned along `u`, before it is cut into steps: mostly from overhead, some from over the viewer's shoulder. */
const toonD = (u: V3, L: V3): number => (u[0] * L[0] + u[1] * L[1] + u[2] * L[2]) * 0.5 + u[2] * 0.65;
/** Where that light is cut into its steps. */
const TOON_CUTS = [-0.12, 0.5];
const toonStep = (d: number): number => (d > TOON_CUTS[1] ? TOON_LIT : d > TOON_CUTS[0] ? TOON_MID : TOON_SHADE);
/** The step a facet in a part's sheen is drawn in: its sheen colour, lit. */
const TOON_SHEEN = 2;
/** Which step a facet turned along `u` is in. */
const toonK = (u: V3, L: V3): number => toonStep(toonD(u, L));

/** Lightness as the eye has it, nought to a hundred (CIE L*), and back; in the light a screen gives out, not the numbers it is sent. */
const toLin = (v: number): number => { const x = Math.max(0, v) / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const fromLin = (y: number): number => 255 * (y <= 0.0031308 ? y * 12.92 : 1.055 * Math.max(0, y) ** (1 / 2.4) - 0.055);
const lumOf = (c: RGB): number => 0.2126 * toLin(c[0]) + 0.7152 * toLin(c[1]) + 0.0722 * toLin(c[2]);
const lightness = (c: RGB): number => { const y = lumOf(c); return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y; };
const lumAt = (l: number): number => (l > 8 ? ((l + 16) / 116) ** 3 : (l * 27) / 24389);
/** A colour taken to a lightness: darkened keeping its hue, or lightened toward `up`. */
function atLightness(c: RGB, l: number, up: RGB = [255, 255, 255]): RGB {
  const y = lumOf(c), want = lumAt(l);
  const lc: RGB = [toLin(c[0]), toLin(c[1]), toLin(c[2])];
  if (want <= y) {
    const k = want / Math.max(1e-6, y);
    return [fromLin(lc[0] * k), fromLin(lc[1] * k), fromLin(lc[2] * k)];
  }
  const lu: RGB = [toLin(up[0]), toLin(up[1]), toLin(up[2])];
  const a = Math.min(1, (want - y) / Math.max(1e-6, lumOf(up) - y));
  return [fromLin(lc[0] + (lu[0] - lc[0]) * a), fromLin(lc[1] + (lu[1] - lc[1]) * a), fromLin(lc[2] + (lu[2] - lc[2]) * a)];
}

/**
 * The steps a `toon` colour is lit in, a set way apart whatever the colour
 * is: the lit top eight lighter than the colour itself and the shade fourteen
 * darker and cooler, toward the island's lavender shadow. A colour too pale
 * for a lit step over it keeps its lit top by having its middle stepped down,
 * a breath of lavender, rather than its light pushed past white.
 */
const TOON_COOL: RGB = [104, 108, 168];
const TOON_LAVENDER: RGB = [214, 208, 240];
const TOON_STEP = 8, TOON_DROP = 14, TOON_TOP = 97;
const toonTones = new Map<number, string>();
function toonTone(c: RGB, k: number): string {
  const step = k >= TOON_LIT ? 2 : k >= TOON_MID ? 1 : 0;
  const key = (((Math.round(c[0]) & 255) << 16) | ((Math.round(c[1]) & 255) << 8) | (Math.round(c[2]) & 255)) * 3 + step;
  let s = toonTones.get(key);
  if (s) return s;
  const l = lightness(c);
  const lit = Math.min(l + TOON_STEP, TOON_TOP), mid = Math.min(l, lit - TOON_STEP);
  const out = step === 2 ? atLightness(mixRGB(c, WARM_LIGHT, 0.1), lit, WARM_LIGHT)
    : step === 1 ? (mid < l - 0.5 ? atLightness(mixRGB(c, TOON_LAVENDER, 0.12), mid) : c)
      : atLightness(mixRGB(c, TOON_COOL, 0.22), Math.max(4, mid - TOON_DROP));
  s = shade(out, 1);
  if (toonTones.size > 4096) toonTones.clear();
  toonTones.set(key, s);
  return s;
}

/** How dark a wildermon's outline is at the lightest, whatever it is round: dark enough to hold it off pale grass. */
const TOON_INK_MAX = 30;
const toonInk = (c: RGB): RGB => (lightness(c) > TOON_INK_MAX ? atLightness(c, TOON_INK_MAX) : c);
/** The ink round a `toon` part only a pixel or two across: a darker shade of its own colour, rather than the dark round the body. */
const toonThinInk = (c: RGB): RGB => atLightness(c, Math.min(lightness(c) * 0.55, 48));

/**
 * How wide a mesh is across, in its own units: the middle one of its three
 * extents, which for anything long -- a whisker, a stalk, a petal -- is how
 * wide it is rather than how long.
 */
const widths = new WeakMap<Mesh, number>();
function acrossOf(m: Mesh): number {
  let w = widths.get(m);
  if (w === undefined) {
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const v of m.v) for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], v[q]); hi[q] = Math.max(hi[q], v[q]); }
    w = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].sort((a, b) => a - b)[1];
    widths.set(m, w);
  }
  return w;
}
/**
 * Pixels across under which a `toon` part is lined only at half the width,
 * in a darker shade of its own colour and not along its folds (a leaf, a
 * horn's tip); and under which it is not lined at all, being narrower than
 * the line round it would be (a whisker, a spoke).
 */
const TOON_THIN_PX = 2, TOON_FLECK_PX = 0.8;

/* ---- gear ------------------------------------------------------------------------------ */

/**
 * What a body wears and holds, drawn on it.
 *
 * Every piece is a model of its own on the bones it covers -- a wool cap is
 * not a steel helm in another colour -- and every piece is cut to go on over
 * whatever else is worn: a mail coif and mail mittens sit with a breastplate
 * because each is a shell a set margin out from the body and each is drawn
 * after what it covers, the further out the later. What a piece is made of
 * comes with it: a copper helm is copper, an oak shield oak, a tunic the
 * colour it was dyed.
 */

/** A piece as a body wears it: which thing, how rare, the material it was made of and the colour it was dyed. */
export interface GearPiece {
  id: string;
  rare?: number;
  /** A material's id: a metal, a wood or a stone. */
  material?: string;
  /** The dye's colour, as `#rrggbb`. */
  dye?: string;
}
export type GearSlot = 'head' | 'chest' | 'arms' | 'legs' | 'feet' | 'weapon' | 'offhand' | 'belt' | 'jewel';
export type GearLook = Partial<Record<GearSlot, GearPiece>>;
/** The order a body is dressed in, inside out. */
const DRESSED: GearSlot[] = ['legs', 'feet', 'chest', 'arms', 'head', 'belt', 'jewel', 'offhand', 'weapon'];
/** How much lighter (or darker) cloth and hide are worn in each place: a cap a little lighter than the coat, breeches and shoes darker. */
const STEP: Partial<Record<GearSlot, number>> = { head: 0.1, arms: -0.07, legs: -0.16, feet: -0.26 };

/** What a body has on, as a string: a kept drawing of it is drawn again when this changes. */
export const gearKey = (g?: GearLook): string =>
  g ? DRESSED.map((s) => { const p = g[s]; return p ? `${p.id}:${p.rare ?? 0}:${p.material ?? ''}:${p.dye ?? ''}` : ''; }).join(',') : '';
/** Whether anything on a body is rare enough to shine. */
export const gearShines = (g?: GearLook): boolean => !!g && DRESSED.some((s) => (g[s]?.rare ?? 0) > 0);

/**
 * The metals, worked, in the island's range: each one chalky and a shade
 * toward blue in its shadow, steel the palest of the working metals, copper
 * and bronze warm, and the rare ones each a colour nobody could take for
 * iron.
 */
const METAL_TONE: Record<string, RGB> = {
  iron: [138, 147, 164], steel: [160, 170, 188], copper: [188, 128, 104], bronze: [180, 148, 106], brass: [200, 180, 120],
  tin: [196, 200, 204], zinc: [176, 188, 198], lead: [124, 130, 148], silver: [212, 218, 228], gold: [222, 190, 112],
  electrum: [222, 204, 142], pewter: [164, 168, 172], adamantine: [104, 136, 166], glimmersteel: [210, 226, 240],
  mithril: [170, 198, 232], seryll: [214, 198, 152],
};
/** The woods, as the furniture is built of them. */
const WOOD_GEAR: Record<string, RGB> = {
  pine: [220, 192, 147], birch: [228, 210, 174], oak: [187, 143, 92], maple: [216, 180, 137], willow: [207, 190, 154],
  cedar: [191, 125, 94], apple: [191, 143, 114], cherry: [173, 106, 78], olive: [187, 162, 122], pear: [198, 158, 134],
  plum: [149, 95, 80], peach: [207, 166, 130], fig: [210, 187, 147], lemon: [220, 198, 146], pomegranate: [162, 110, 86],
  apricot: [204, 159, 103], quince: [202, 168, 125],
};
/** The stones a jewel is set with. */
const GEM_TONE: Record<string, RGB> = {
  diamond: [226, 240, 248], ruby: [226, 98, 120], sapphire: [108, 148, 228], emerald: [98, 192, 146], garnet: [168, 64, 82], topaz: [242, 198, 102],
  opal: [236, 222, 238], peridot: [176, 208, 96], amethyst: [168, 120, 208], jasper: [182, 92, 66], onyx: [58, 58, 66], amber: [232, 164, 64],
};
/** Dragon scale, off one kind of beast and one colour: a jade gone grey at the edges. */
const DRAGON: RGB = [98, 146, 128];
/** What a metal's shadow and its light lean toward. */
const COOL_SHADOW: RGB = [58, 64, 84];
/** The grey a dye is chalked toward. */
const CHALK: RGB = [176, 172, 164];
/** What copper's shadow leans toward: the grey-green it weathers to, which keeps it off the colour of skin in the shade. */
const VERDIGRIS: RGB = [104, 132, 120];
const WARM_LIGHT: RGB = [255, 250, 238];
/** Hide tanned dark and red, for the step a leather cap takes away from the face: toward a hue of about 15 degrees, where skin is nearer 28. */
const TANNED: RGB = [104, 50, 40];
/** A colour made lighter or darker by `k` along its own hue: every channel scaled, none past white. */
const lift = (c: RGB, k: number): RGB => {
  const top = Math.max(c[0], c[1], c[2]) * k;
  const f = top > 255 ? 255 / Math.max(c[0], c[1], c[2]) : k;
  return [c[0] * f, c[1] * f, c[2] * f];
};
/** A shield's boards weathered toward grey, where new-cut oak on the arm is the tan of the hide coat behind it. */
const weathered = new WeakMap<Palette, Palette>();
function weatheredOf(P: Palette): Palette {
  let w = weathered.get(P);
  if (!w) weathered.set(P, (w = { ...P, wood: mixRGB(P.wood, CHALK, 0.4), woodDark: mixRGB(P.woodDark, COOL_SHADOW, 0.18) }));
  return w;
}
/** The metals that are fittings in their own right, gilt rather than iron. */
const YELLOW_METAL = new Set(['gold', 'brass', 'bronze', 'electrum', 'seryll']);

/** Hide dyed `dye`: the dye's hue, as saturated as the dye or as undyed hide is, whichever is less, at undyed hide's value. */
function dyedHide(dye: RGB): RGB {
  const [h, sat] = hsvOf(dye), [, hs, hv] = hsvOf(GEAR_BASE.leather);
  return fromHsv(h, Math.min(sat, hs), hv);
}

/**
 * A piece's own colours: the body's, with its metal, its wood, its stone and
 * its dye laid in. Made once for each piece in each material and dye on each
 * body's colours.
 */
const gearPals = new Map<string, Palette>();
function gearPalette(base: Palette, p: GearPiece, step = 0): Palette {
  const key = `${p.material ?? ''}|${p.dye ?? ''}|${step}|${base.tunic.join()}|${base.trousers.join()}|${base.skin.join()}`;
  let pal = gearPals.get(key);
  if (pal) return pal;
  const mat = (p.material ?? '').toLowerCase();
  const metal = METAL_TONE[mat] ?? METAL_TONE.iron;
  // A wood worked into a haft or a board is the furniture's wood, chalked a little further: a club is not the loudest thing on a body.
  const wood = mixRGB(WOOD_GEAR[mat] ?? WOOD_GEAR.oak, CHALK, 0.3);
  // A dye as the island's chalky range has it: a third of the way to its grey.
  const dye = p.dye && /^#[0-9a-f]{6}$/i.test(p.dye) ? mixRGB(hex(p.dye), CHALK, 0.42) : undefined;
  // Cloth and hide a step lighter or darker by where on the body they are, so a suit of one dye is still a cap, a coat and breeches.
  const stepped = (c: RGB): RGB => (step ? mixRGB(c, step > 0 ? WARM_LIGHT : COOL_SHADOW, Math.abs(step)) : c);
  const cloth = stepped(dye ?? GEAR_BASE.cloth);
  // A dye on hide keeps its own hue, at the hide's darkness and no more saturated than hide is: mixed into the red-brown of the
  // undyed hide, a green came out khaki.
  const hide = dye ? dyedHide(dye) : GEAR_BASE.leather;
  // Hide worn on the head the other way, darker and warmer than the coat: a step lighter, a leather cap is the colour of the face
  // under it, and from behind the head it reads as a bald crown.
  const leather = step > 0 ? mixRGB(hide, TANNED, 0.6) : stepped(hide);
  pal = {
    ...base,
    metal,
    // The metal's own colour, lighter and darker along its own ramp: a lit edge that is still steel, a shadow that is still iron.
    metalDark: mixRGB(metal, COOL_SHADOW, 0.25),
    // Copper's lit edge further toward the light's own colour, a pale peach, where a lift of its own colour is a hotter pink.
    metalLit: mixRGB(lift(metal, 1.16), WARM_LIGHT, metal === METAL_TONE.copper ? 0.34 : 0.1),
    mail: mixRGB(metal, COOL_SHADOW, 0.16),
    rivet: mixRGB(metal, WARM_LIGHT, 0.5),
    blade: mixRGB(lift(metal, 1.1), WARM_LIGHT, 0.12),
    fitting: YELLOW_METAL.has(mat) ? mixRGB(mixRGB(metal, CHALK, 0.22), WARM_LIGHT, 0.12) : GEAR_BASE.fitting,
    scale: DRAGON,
    scaleDark: mixRGB(DRAGON, COOL_SHADOW, 0.2),
    cloth,
    clothDark: mixRGB(cloth, COOL_SHADOW, 0.24),
    lining: mixRGB(cloth, WARM_LIGHT, 0.25),
    leather,
    leatherDark: mixRGB(leather, COOL_SHADOW, 0.34),
    // Its edges burnished by wear and the slicker, lighter than the face of the hide.
    leatherLit: mixRGB(lift(leather, 1.16), WARM_LIGHT, 0.16),
    wood,
    woodDark: mixRGB(wood, COOL_SHADOW, 0.32),
    gem: GEM_TONE[mat] ?? GEAR_BASE.gem,
    grip: GEAR_BASE.grip, lace: GEAR_BASE.lace, string: GEAR_BASE.string, fletch: GEAR_BASE.fletch,
  };
  // A circlet's stones, one after another as its label has them, and a setting with none in it its gold.
  const stones = mat.split(',').map((s) => GEM_TONE[s.trim()]);
  [pal.stone1, pal.stone2, pal.stone3] = [stones[0] ?? pal.fitting, stones[1] ?? pal.fitting, stones[2] ?? pal.fitting];
  gearPals.set(key, pal);
  if (gearPals.size > 400) gearPals.delete(gearPals.keys().next().value as string);
  return pal;
}

/** Which of the body's own parts a bit of gear goes on over, or takes the place of. */
type Covers = 'pelvis' | 'skirt' | 'belt' | 'abdomen' | 'chest' | 'neck' | 'head' | 'ears' | 'nose' | 'cap' | 'top' | 'fall' | 'tails' | 'beard'
  | 'upper' | 'lower' | 'hand' | 'thigh' | 'shin' | 'boot' | 'foot';
type Bone = 'pelvis' | 'spine' | 'chest' | 'neck' | 'head' | 'arm' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle';

interface GearBit {
  bone: Bone;
  /** Of a pair of bones: the left (0), the right (1), or both, the left the right one mirrored. */
  side?: 0 | 1 | 'both';
  mesh: Mesh;
  /** Where on the bone it hangs, and turned how there, in degrees of pitch, roll and yaw. */
  at?: V3;
  turn?: [number, number, number];
  bias?: number;
  /**
   * Drawn over these of the body, and over whatever of the gear is on them:
   * all of it on the others, and on the first -- where the bit itself is --
   * only what is worn further in than it.
   */
  over: Covers[];
  convex?: boolean;
  /** Bends with the legs below the hips, as a skirt does. */
  skirt?: boolean;
  /**
   * Made straight in the knee's terms and bent with it (`kneeBent`): on the
   * hip, it is put at the knee, and on the knee, it is there already.
   */
  bend?: boolean;
  /** How far out it is worn, where not as far as the rest of its piece. */
  layer?: number;
  /** Over what it covers only while this side of it is toward the viewer: see `Part.front`. */
  front?: V3;
  /**
   * Carried whole, not given at the shoulder or bent at the elbow with the
   * arm under it (`bentAtShoulder`, `bentAtElbow`): a stiff cap or a plate
   * standing off the shoulder, which bent was crumpled. On the arm, it stays
   * on the joint and tips only part of the way with the arm (`heldOnShoulder`).
   */
  whole?: boolean;
  /** Solids that hide what of it is behind them (see `Part.hide`): a helm's nasal, out of sight round the far side of the skull. */
  hide?: Array<{ c: V3; r: V3 }>;
}

interface GearModel {
  /** How far out from the skin it is worn: cloth one, plate five. What is further out is drawn over what is further in. */
  layer: number;
  bits: GearBit[];
  /** Instead of the body's own hands, these, in the gear's colours: gloves. */
  glove?: Mat;
  /**
   * The body's own parts it takes off: the hair a helm covers, the boots
   * boots replace, the belt a belt does, and whatever it covers whole, which
   * would only be drawn to be drawn over.
   */
  hides?: Covers[];
  /**
   * A hat's rim, at `f` over the brow and `b` at the nape as its rows are:
   * the hair is cut off level with it, so what shows of it is what hangs
   * below the brim, and none of it stands out through the crown.
   */
  hairTo?: { f: number; b: number };
  /**
   * The body's own parts made of this, in its colours, where nothing else
   * worn takes them off: these of each part's materials as these of the
   * piece's. A tunic's own short sleeves -- left the shirt's, a padded tunic
   * of undyed linen had a red shirt's sleeves standing out of it at either
   * shoulder -- and the seat of a pair of leggings, which showed in the shirt's
   * undyed linen through every slit up a skirt over them, a pale strip down
   * the back of a leather coat.
   */
  dyes?: Partial<Record<Covers, Partial<Record<Mat, Mat>>>>;
}

/** Every side facet of a mesh worked with a pattern. */
const worn = (m: Mesh, pat: Pattern, only?: (face: Face) => boolean): Mesh =>
  ({ ...m, f: m.f.map((f) => (f.i.length === 4 && (!only || only(f)) ? { ...f, pat } : f)) });
/** A mesh with some of its materials swapped for others. */
const recoloured = (m: Mesh, to: Partial<Record<Mat, Mat>>): Mesh => ({ ...m, f: m.f.map((f) => (to[f.m] ? { ...f, m: to[f.m] as Mat } : f)) });
/** Grown `k` about its own origin across (x, y) and `kz` up it. */
const swelled = (m: Mesh, k: number, kz = k): Mesh => ({ ...m, v: m.v.map((p): V3 => [p[0] * k, p[1] * k, p[2] * kz]) });
/** Moved by `d`. */
const moved = (m: Mesh, d: V3): Mesh => ({ ...m, v: m.v.map((p): V3 => [p[0] + d[0], p[1] + d[1], p[2] + d[2]]) });
/** A mesh whose first `n` facets -- a hat's lowest band -- are not inked along the open edge they leave. */
const softRim = (m: Mesh, n: number): Mesh => ({ ...m, f: m.f.map((f, i) => (i < n ? { ...f, soft: true } : f)) });
/** The same mesh turned about its z by `deg`, its front toward its right. */
const spun = (m: Mesh, deg: number): Mesh => {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return { ...m, v: m.v.map(([x, y, z]): V3 => [x * c + y * s, y * c - x * s, z]) };
};
/** The same mesh for the other side of the body: across mirrored, and every facet turned back round to face out. */
const mirrors = new WeakMap<Mesh, Mesh>();
function mirrored(m: Mesh): Mesh {
  let o = mirrors.get(m);
  if (!o) {
    o = mesh(m.v.map((p): V3 => [-p[0], p[1], p[2]]), m.f.map((f) => ({ ...f, i: [...f.i].reverse(), unless: f.unless && [-f.unless[0], f.unless[1], f.unless[2]] as V3, at: f.at && [-f.at[0], f.at[1], f.at[2]] as V3 })));
    mirrors.set(m, o);
  }
  return o;
}

/**
 * An open band of rings round the z axis from angle `from` to `to` -- in
 * degrees from the body's right, round toward its front -- for what goes
 * round most of something and leaves a gap: a coif round a face.
 */
function arcs(rs: number[][], n: number, from: number | number[], to: number | number[], m: Mat | ((band: number, j: number) => Mat)): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  const mat = (band: number, j: number): Mat => (typeof m === 'function' ? m(band, j) : m);
  rs.forEach(([z, rxx, ryy, cx = 0, cy = 0], k) => {
    // Each ring from and to angles of its own where given them: a plate that narrows and comes round as it goes down.
    const a0 = Array.isArray(from) ? from[k] : from, a1 = Array.isArray(to) ? to[k] : to;
    for (let j = 0; j <= n; j++) {
      const a = (a0 + ((a1 - a0) * j) / n) * DEG;
      v.push([cx + Math.cos(a) * rxx, cy + Math.sin(a) * ryy, z]);
    }
  });
  for (let k = 0; k < rs.length - 1; k++) {
    for (let j = 0; j < n; j++) f.push({ i: [k * (n + 1) + j, k * (n + 1) + j + 1, (k + 1) * (n + 1) + j + 1, (k + 1) * (n + 1) + j], m: mat(k, j) });
  }
  return mesh(v, f);
}

/** A box, from `a` to `b` corner to corner, every face out. */
function box(a: V3, b: V3, m: Mat, top: Mat = m): Mesh {
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  const v: V3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return mesh(v, [
    faceOut(v, [0, 1, 2, 3], [0, 0, -1], m), faceOut(v, [4, 5, 6, 7], [0, 0, 1], top),
    faceOut(v, [0, 1, 5, 4], [0, -1, 0], m), faceOut(v, [1, 2, 6, 5], [1, 0, 0], m),
    faceOut(v, [2, 3, 7, 6], [0, 1, 0], m), faceOut(v, [3, 0, 4, 7], [-1, 0, 0], m),
  ]);
}

/**
 * A flat piece cut to an outline in the y-z plane, each corner `h` either
 * side of it: an axe's head, a shield's face. The rim is `edge` where both
 * its ends are at least `edgeFrom` out along y -- an axe's bit.
 */
function slab(pts: Array<[number, number, number]>, m: Mat, edge?: Mat, edgeFrom = Infinity, back: Mat = m): Mesh {
  const n = pts.length;
  const v: V3[] = [...pts.map(([y, z, h]): V3 => [h, y, z]), ...pts.map(([y, z, h]): V3 => [-h, y, z])];
  const f: Face[] = [faceOut(v, pts.map((_, i) => i), [1, 0, 0], m), faceOut(v, pts.map((_, i) => n + i), [-1, 0, 0], back)];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  const o = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const sharp = edge && pts[i][0] >= edgeFrom && pts[j][0] >= edgeFrom;
    f.push(faceOut(v, [i, j, n + j, n + i], [0, o * (pts[j][1] - pts[i][1]), -o * (pts[j][0] - pts[i][0])], sharp ? edge : m));
  }
  return mesh(v, f);
}

/* -- the body's own shapes, a margin out ---------------------------------------------- */

interface Build { fr: Frame; sw: number; arm: number }
const buildOf = (fr: Frame): Build => ({ fr, sw: (fr.sh + fr.wa) / 2, arm: 0.9 + fr.sh * 0.1 });

/** The chest's rings, `g` times the body's own round, bottom first. */
const chestRings = (b: Build, g: number, top = 2.24): number[][] => [
  [-0.15, 1.58 * b.sw * g, 1.22 * g, 0, 0], bustRing(b.fr, g),
  // The shoulder rounded over rather than squared off, so a thick coat does not stand up in corners above the arms.
  [1.7, 2.06 * b.fr.sh * g, 1.22 * g, 0, -0.04], [1.7 + (top - 1.7) * 0.55, 1.8 * b.fr.sh * g, 1.02 * g, 0, -0.06], [top, 1.3 * b.fr.sh * g, 0.74 * g, 0, -0.08],
];
/** The chest, `g` times the body's own round: the shell of whatever is worn over it. */
const chestShell = (b: Build, g: number, m: Mat | ((band: number, j: number) => Mat), top = 2.24): Mesh => rings(chestRings(b, g, top), 8, m, { bottom: false });
/** The waist, on the spine. */
const waistRings = (b: Build, g: number): number[][] => [[-0.4, 1.45 * b.fr.wa * g, 1.16 * g], [1.98, 1.6 * b.sw * g, 1.22 * g]];
const waistShell = (b: Build, g: number, m: Mat): Mesh => rings(waistRings(b, g), 8, m, { top: false, bottom: false });
/**
 * What hangs from the hips to `hem`, bottom first: a skirt of mail, of plate,
 * of quilting. It flares the longer it is, and by `bell` more again.
 */
const skirtRings = (b: Build, g: number, hem: number, bell = 1): number[][] => {
  const flare = Math.max(0, -1.35 - hem) * 0.07 * bell;
  return [
    [hem, (1.92 + flare) * b.fr.hi * g, (1.55 + flare) * g], [Math.min(-1.08, hem + 0.5), (1.9 + flare * 0.3) * b.fr.hi * g, (1.53 + flare * 0.3) * g],
    [0.2, 1.74 * b.fr.hi * g, 1.36 * g], [1.25, 1.53 * b.fr.wa * g, 1.22 * g],
  ];
};
/** A belt round the waist, `g` out, on the hips. */
const beltRing = (b: Build, g: number, m: Mat, lo = 0.98, hi = 1.42): Mesh =>
  rings([[lo, 1.64 * b.fr.wa * g, 1.32 * g], [hi, 1.64 * b.fr.wa * g, 1.32 * g]], 8, m, { top: false, bottom: false });
/**
 * The last of a shell on the upper arm, bottom first: the elbow's ring
 * (`elbowRing`), and one at the top of the bend (`ELBOW_BEND`) on the way to
 * `r` at height `z` -- the joint ring and the loop over it that the bend is
 * taken across, the forearm's shell having the loop under it.
 */
const overElbow = (fr: Frame, g: number, z: number, r: number[]): number[][] => {
  const U = UPPER * fr.tall, [, ex, ey] = elbowRing(g), t = ELBOW_BEND / (U + z);
  return [[-U, ex, ey], [-U + ELBOW_BEND, ex + (r[0] - ex) * t, ey + (r[1] - ey) * t]];
};
/** The upper arm, from the shoulder down to `to`, bottom first; or, without it, down to the elbow, to meet the forearm's shell there. */
const upperRings = (b: Build, g: number, to?: number): number[][] => {
  // Without the ring at the foot of the shoulder's give, which a shell over the arm can spare: the give is taken down the whole of it.
  const top = deltoid(b.arm, g).slice(1);
  return [...(to === undefined ? overElbow(b.fr, g, top[0][0], [top[0][1], top[0][2]]) : [[to, 0.76 * g, 0.74 * g]]), ...top];
};
const upperShell = (b: Build, g: number, to: number | undefined, m: Mat): Mesh => {
  const shell = capped(rings(upperRings(b, g, to), 6, m, { bottom: false }));
  return to === undefined ? softAt(shell, -UPPER * b.fr.tall) : shell;
};
/**
 * The underside of what stands off the top of the arm -- a shoulder cap, a pauldron -- from its lower edge `p` in to the arm: with
 * the arm raised it is seen from below, and open it was a hollow rim with the arm and the chest showing through it. Neither of its
 * edges inked: the arm goes up through the inner one, and inked it was a hexagon drawn round the arm, a hole in the plate.
 */
const underside = (p: number[], n: number, m: Mat): Mesh => softAt(rings([[p[0], 0.86, 0.84], p], n, m, { top: false, bottom: false }), p[0]);
/**
 * A sleeve's top closed, and the lid a seam into the coat (`Face.seam`): open, the arm swung forward or up turned the hole in its
 * top to the viewer, a ring inked on the shoulder with the chest showing through it.
 */
const capped = (m: Mesh): Mesh => {
  const top = Math.max(...m.v.map((p) => p[2]));
  return seamed(m, (p) => p[2] > top - 1e-6);
};
/** The forearm, from the elbow down into the glove, bottom first: fullest a little under the elbow, and meeting the upper arm's shell in its ring. */
const forearmRings = (g: number): number[][] => [
  [-2.46, 0.56 * g, 0.53 * g], [-1.2, 0.62 * g, 0.58 * g], [-ELBOW_BEND, 0.64 * g, 0.6 * g], elbowRing(g),
];
/** Closed at the wrist and the lid a seam, as the top of a sleeve is (`capped`): with the forearm raised, its end was a hollow ring round the wrist. */
const forearmShell = (g: number, m: Mat): Mesh => softAt(seamed(rings(forearmRings(g), 6, m, { top: false }), (p) => p[2] < -2.45), 0);
/**
 * A leg of gear, `g` round the leg, in the knee's terms (`kneeBent`), bottom
 * first: from `to` up the shin, through the joint ring at the knee and the
 * rings either side of it that go with the thigh and the shin, and up the
 * thigh to under the hips.
 */
const legRings = (b: Build, g: number, to: number): number[][] => [
  [to, 0.66 * g, 0.7 * g], ...(to < -1.6 ? [[-1.4, 0.74 * g, 0.78 * g]] : []),
  [-KNEE_SPAN, 0.8 * g, 0.84 * g, 0, -0.03 * g], [0, 0.83 * g, 0.87 * g], [KNEE_SPAN, 0.86 * g, 0.9 * g], [THIGH * b.fr.tall - 0.9, 1.04 * thighTop(b.fr) * g, 1.07 * g],
];
/** That leg's ring at height `z`, for what goes round it. */
const legAt = (b: Build, g: number, z: number): number[] => profileAt(legRings(b, g, -3), (z + 3) / (THIGH * b.fr.tall + 2.1));
/**
 * A pad of a darker hide or scale worked into the front of a knee rather than
 * laid on it: painted on the two facets either side of the ridge down the
 * front of a six-sided leg (`rs`, bottom first, the knee's ring at nought),
 * `h` above and below the knee and `wide` of the way across each facet at
 * the knee, narrowing above and below to a rounded point. A cop of its own
 * standing off the leg, however little, was what the knee was drawn as when
 * it was stacked tubes: a flat dark hexagon over the front of the knee with a
 * line round it. Painted, it has no rim to ink and no edge to stand out of
 * the leg at any bend; split at the knee into the thigh's half and the
 * shin's, each bent with its own (`kneeBent`), it is one pad across the joint.
 */
function kneePad(rs: number[][], h: number, wide: number, m: Mat): { thigh: Mesh; shin: Mesh } {
  const z0 = rs[0][0], z1 = rs[rs.length - 1][0];
  const half = (up: number): Mesh => decals([-1, 1].map((s) => {
    // Across the facet from the ridge at the front to its corner at the side, a little proud of it, at `t` of the way and height `z`.
    const on = (t: number, z: number): V3 => {
      const [, rx, ry, cx, cy] = profileAt(rs, (z - z0) / (z1 - z0));
      const a = Math.PI / 2 - (s * Math.PI) / 3;
      const p0: Pt = [cx, cy + ry], p1: Pt = [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
      const d: Pt = [p1[0] - p0[0], p1[1] - p0[1]], l = Math.hypot(d[0], d[1]);
      const out: Pt = [(-s * d[1]) / l, (s * d[0]) / l];
      return [p0[0] + d[0] * t + out[0] * 0.012, p0[1] + d[1] * t + out[1] * 0.012, z];
    };
    const q = [on(0, 0), on(wide, 0), on(wide * 0.9, up * h * 0.45), on(wide * 0.55, up * h * 0.85), on(0, up * h)];
    const n = newell(q), want: V3 = [s * Math.cos(Math.PI / 3), Math.sin(Math.PI / 3), 0];
    return { q: n[0] * want[0] + n[1] * want[1] < 0 ? q.reverse() : q, m };
  }));
  return { thigh: half(1), shin: half(-1) };
}
/**
 * A boot's shaft closed at its foot, the lid a seam (`Face.seam`): with the foot kicked up behind at a run, the open end of the
 * shaft was turned to the viewer over the instep, an inked hexagon with the leg's end inside it.
 */
const soled = (m: Mesh): Mesh => {
  const lo = Math.min(...m.v.map((p) => p[2]));
  return seamed(m, (p) => p[2] < lo + 1e-6);
};
/** A boot's shaft goes over the leg in it unless its foot end is turned well away from the viewer (see `Part.front`). */
const SHAFT: V3 = [0, 0, -0.5];

/** A profile of rings, bottom first, at `t` of the way up it by height, every ring five numbers. */
function profileAt(rs: number[][], t: number): number[] {
  const full = rs.map((r) => [r[0], r[1], r[2], r[3] ?? 0, r[4] ?? 0]);
  const z = full[0][0] + (full[full.length - 1][0] - full[0][0]) * t;
  for (let k = 0; k < full.length - 1; k++) {
    const a = full[k], c = full[k + 1];
    if (z <= c[0] || k === full.length - 2) {
      const u = (z - a[0]) / (c[0] - a[0] || 1);
      return a.map((x, i) => (i === 0 ? z : x + (c[i] - x) * u));
    }
  }
  return full[full.length - 1];
}

/**
 * Overlapping courses up a profile of rings, bottom first: each course flares
 * `lip` out at its foot over the top of the one below, which is what scales
 * and lames are, and the step under every course is inked, which reads at
 * any size where a pattern worked into the surface does not. Every other
 * course in `b`.
 */
function shingled(rs: number[][], count: number, lip: number, a: Mat, b: Mat = a, n = 6): Mesh {
  const out: number[][] = [];
  for (let k = 0; k < count; k++) {
    const lo = profileAt(rs, k / count), hi = profileAt(rs, (k + 1) / count);
    out.push([lo[0], lo[1] + lip, lo[2] + lip, lo[3], lo[4]], [hi[0] - 0.002, hi[1], hi[2], hi[3], hi[4]]);
  }
  return rings(out, n, (band) => (band % 2 ? a : (band / 2) % 2 ? b : a), { top: false, bottom: false });
}

/**
 * Scale, laid in `count` courses up a profile of rings, bottom first, `n`
 * scales round: each course half a scale round from the one under it and
 * standing `lip` out at its foot over it, and each scale's rounded tip hanging
 * `tip` below the notches either side of it. The lower part of every scale,
 * out in the light, is `a`; the upper part, in the shadow of the course over
 * it, `b`. What reads as scale at the size the island is played at, where a
 * pattern worked into a band does not: the outline goes saw-toothed where the
 * courses stand out, and the tips make a row of points across the body.
 *
 * Every shadowed upper part comes before every lit tip in the mesh, and a
 * course only ever lies over the one below it, so drawn in that order --
 * as a `convex` part is, a colour at a time -- each course's tips cover the
 * shadowed part of the course under them from every side, with no sorting.
 */


/**
 * A band round the ring `p` (`[z, rx, ry, cx, cy]`) hanging `h` down from it -- up, if `h` is less than nought -- its edge cut in `n`
 * points that stand `out` further out than the ring: the serrated hem of a course of scale, which is what says scale in the outline
 * of a shoulder, an elbow or a hem, where a smooth one is any coat's.
 */
function teeth(p: number[], n: number, h: number, out: number, m: Mat): Mesh {
  const [z, rx, ry, cx = 0, cy = 0] = p;
  const N = 2 * n;
  const v: V3[] = [];
  for (let j = 0; j < N; j++) {
    const a = ((j + 0.5) / N) * TAU;
    v.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z]);
  }
  for (let j = 0; j < N; j++) {
    const a = ((j + 0.5) / N) * TAU, point = j % 2 === 0, o = point ? out : out * 0.55;
    v.push([cx + Math.cos(a) * (rx + o), cy + Math.sin(a) * (ry + o), z - (point ? h : h * 0.35)]);
  }
  const f: Face[] = [];
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N, mid = ((j + 1) / N) * TAU;
    f.push(faceOut(v, [N + j, N + j2, j2, j], [Math.cos(mid), Math.sin(mid), 0], m));
  }
  return mesh(v, f);
}

/** The skull in the head's own frame, `out` further out, at height `z`: a ring of it, for a helm to follow. */
const skullRing = (fr: Frame, z: number, out: number, dy = 0): number[] => {
  const [rxx, ryy, cy] = skull(fr, z);
  return [z, rxx + out, ryy + out, 0, cy + dy];
};

/**
 * A row of a hat: at `f` over the brow and `b` at the nape, `out` off the
 * skull in front and `outB` behind, or `r` across where the skull has run
 * out; `dy` forward.
 */
interface HatRow { f: number; b?: number; out?: number; outB?: number; r?: [number, number]; dy?: number }

/**
 * A hat, a helm or a hood, ring over ring up the skull and tipped as a hat is
 * worn: up off the brow in front, so the eyes are never under it, and down
 * over the nape behind. Wound as `rings` is, and capped on top unless told.
 */
function hat(fr: Frame, rows: HatRow[], n: number, mat: Mat | ((band: number, j: number) => Mat), top = true): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  const m = (band: number, j: number): Mat => (typeof mat === 'function' ? mat(band, j) : mat);
  for (const row of rows) {
    for (let j = 0; j < n; j++) {
      const a = ((j + 0.5) / n) * TAU;
      const front = (1 + Math.sin(a)) / 2;
      const z = row.b === undefined ? row.f : row.b + (row.f - row.b) * front;
      const out = (row.outB ?? row.out ?? 0) + ((row.out ?? 0) - (row.outB ?? row.out ?? 0)) * front;
      const [sx, sy, cy] = row.r ? [row.r[0], row.r[1], 0] : skull(fr, z);
      const rx = row.r ? sx : sx + out, ry = row.r ? sy : sy + out;
      v.push([Math.cos(a) * rx, cy + (row.dy ?? 0) + Math.sin(a) * ry, z]);
    }
  }
  for (let k = 0; k < rows.length - 1; k++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      f.push({ i: [k * n + j, k * n + j2, (k + 1) * n + j2, (k + 1) * n + j], m: m(k, j) });
    }
  }
  if (top) {
    const last = (rows.length - 1) * n;
    f.push({ i: Array.from({ length: n }, (_, j) => last + j), m: m(rows.length - 1, 0) });
  }
  return mesh(v, f);
}

/**
 * A ridge up the middle of the head from the brow over the crown to the
 * nape, `out` off the skull and `r` round: a helm's comb, a cap's seam.
 */
function crestOf(fr: Frame, out: number, r: number, m: Mat, top = CROWN + 0.3, from = 2.2, to = from): Mesh {
  const zs = [from, (from + 2.9) / 2, 2.9, CROWN - 0.12];
  const front = zs.map((z): V3 => { const [, ry, cy] = skull(fr, z); return [0, cy + ry + out, z]; });
  const back = [...zs].reverse().filter((z) => z >= to).map((z): V3 => { const [, ry, cy] = skull(fr, z); return [0, cy - ry - out, z]; });
  const pts: V3[] = [...front, [0, skull(fr, CROWN - 0.12)[2], top], ...back];
  return chain(pts, pts.map(() => r), 4, m);
}

/** A seam up a cap from `from` to `to`, `a` degrees round from the right (90 over the brow), `out` off the skull and `r` round. */
function seamOf(fr: Frame, a: number, from: number, to: number, out: number, r: number, m: Mat): Mesh {
  const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
  const pts = [0, 0.34, 0.67, 1].map((t): V3 => {
    const z = from + (to - from) * t;
    const [sx, sy, cy] = skull(fr, z);
    return [c * (sx + out), cy + s * (sy + out), z];
  });
  return chain(pts, pts.map(() => r), 4, m);
}

/**
 * A coif's mail round the head below its hood, bottom to top: the throat,
 * under the chin, the jaw, the cheekbones and the temples, standing off the
 * head all round. Closed round the throat and under the chin, and open from
 * there to the brow in a face-shaped opening: a point under the chin, wider
 * at the jaw and widest across the eyes, its edges running straight from one
 * ring to the next rather than stepping by whole facets, so it is round at
 * the chin and cut back at the cheek, and some of the face shows side on.
 * The top band's edge is not inked, where it lies over the hood and would be
 * a line across the head.
 */
let coifMesh: Mesh | undefined;
function coifOf(): Mesh {
  if (coifMesh) return coifMesh;
  const rs = [[-0.9, 1.3, 1.35, 0, -0.05], [0.08, 1.38, 1.3, 0, 0.3], [0.75, 1.54, 1.46, 0, 0.26], [1.3, 1.76, 1.74, 0, 0.16], [1.98, 1.82, 1.86, 0, 0.06]];
  // How far round either side of the middle of the face each ring is open, in degrees.
  const open = [0, 0, 26, 46, 52];
  // The throat a closed ring, with no seam down the front of it; the rest open at the face.
  const throat = rings(rs.slice(0, 2), 18, 'mail', { top: false, bottom: false });
  const face = arcs(rs.slice(1), 18, open.slice(1).map((a) => 90 + a), open.slice(1).map((a) => 450 - a), 'mail');
  const top = rs.length - 3;
  // Its top band's edge not inked all the way round, the corners of the face opening as well: inked there, beside the eyes, it is
  // a dash across the side of the face.
  coifMesh = join(throat, mesh(face.v, face.f.map((f, i) => (Math.floor(i / 18) === top ? { ...f, soft: true } : f))));
  return coifMesh;
}

/** Everything a hat is drawn over: the head and whatever of the hair and the face is left on it. */
const HEAD_OVER: Covers[] = ['head', 'ears', 'nose', 'beard', 'fall', 'tails', 'cap', 'top'];

/**
 * Where round the head a cheek plate runs at the jaw, the cheekbone and the rim, bottom first, for the right side and the left: broad
 * under the rim from behind the ear to beside the eye, and narrowing to the front as it goes down, toward the chin.
 */
function cheekPlates(): Array<[number[], number[]]> {
  const right: Array<[number, number]> = [[16, 56], [-6, 52], [-14, 48]];
  return [
    [right.map(([a]) => a), right.map(([, c]) => c)],
    [right.map(([, c]) => 180 - c), right.map(([a]) => 180 - a)],
  ];
}

/** A mesh leant over sideways by `deg` about the line along y at height `z0`, its top toward its right, and moved `dx` across. */
const splayed = (m: Mesh, deg: number, z0: number, dx: number): Mesh => {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return { ...m, v: m.v.map(([x, y, z]): V3 => [dx + x * c + (z - z0) * s, y, z0 - x * s + (z - z0) * c]) };
};

/* -- what is worn ---------------------------------------------------------------------- */

/**
 * How much bigger round the body each chest piece is, heavier further out:
 * padding, hide, mail over its padding, scale and plate. What goes round the
 * waist over it goes round this.
 */
const CHEST_FIT: Record<string, number> = { cloth_tunic: 1.25, leather_jerkin: 1.14, chain_hauberk: 1.13, plate_breastplate: 1.2, scale_cuirass: 1.17 };

/**
 * An open band like `arcs`, from `from` to `to` degrees round, but on the
 * facets of a ring of `N` corners cut as `rings` cuts it: its corners are the
 * ring's own corners between the two ends, and its ends lie on the facets the
 * ring has there rather than out on the round. So a band cut out of a ring
 * meets that ring edge to edge, and two bands cut out of it side by side make
 * the ring again but for the gap between them.
 */
function facetArcs(rs: number[][], N: number, from: number, to: number, m: Mat | ((band: number, j: number) => Mat)): Mesh {
  const step = 360 / N;
  const angles = [from];
  for (let j = Math.ceil(from / step - 0.5); (j + 0.5) * step < to; j++) if ((j + 0.5) * step > from) angles.push((j + 0.5) * step);
  angles.push(to);
  const v: V3[] = [];
  const f: Face[] = [];
  const mat = (band: number, j: number): Mat => (typeof m === 'function' ? m(band, j) : m);
  const n = angles.length;
  for (const [z, rxx, ryy, cx = 0, cy = 0] of rs) {
    for (const deg of angles) {
      // The facet it is on, and how far along it from its first corner.
      const k = Math.floor(deg / step - 0.5), t = deg / step - 0.5 - k;
      const a0 = (k + 0.5) * step * DEG, a1 = (k + 1.5) * step * DEG;
      v.push([cx + rxx * (Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * t), cy + ryy * (Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * t), z]);
    }
  }
  for (let k = 0; k < rs.length - 1; k++) {
    for (let j = 0; j < n - 1; j++) f.push({ i: [k * n + j, k * n + j + 1, (k + 1) * n + j + 1, (k + 1) * n + j], m: mat(k, j) });
  }
  return mesh(v, f);
}

/**
 * A skirt split from its hem up to the fork, front and back, so each half
 * goes with its own leg: the profile below `fork` as two halves, and above it
 * whole, `2n` round. Each half is `from` to `to` degrees round from the body's
 * right toward its front, cut out of the same ring as the skirt above the fork
 * (`facetArcs`), and `mat` is a material or a function of the band. The halves
 * were each cut evenly round in `n`, every forty degrees, against a ring above
 * cut every forty-five: none of their corners met at the fork, and the bell
 * stepped out there all the way round.
 */
function splitSkirt(rs: number[][], fork: number, halves: Array<[number, number]>, n: number, mat: Mat | ((band: number, j: number) => Mat)): Mesh {
  const z0 = rs[0][0], z1 = rs[rs.length - 1][0];
  const at = (z: number): number[] => profileAt(rs, (z - z0) / (z1 - z0));
  const below = [...rs.filter((r) => r[0] < fork), at(fork)];
  const above = [at(fork), ...rs.filter((r) => r[0] > fork)];
  const m = (band: number, j: number): Mat => (typeof mat === 'function' ? mat(band, j) : mat);
  return join(
    ...halves.map(([a, c]) => facetArcs(below, 2 * n, a, c, m)),
    rings(above, 2 * n, (band, j) => m(band + below.length - 1, j), { top: false, bottom: false }),
  );
}

/** Where a split skirt is split, front and back: a hair either side of straight ahead and straight behind, so the two halves close. */
const SLIT: Array<[number, number]> = [[-88, 88], [92, 268]];

/**
 * Every piece, a model of its own, given the build of the body it is on, and
 * `fit`, how far out round the waist the chest piece under it comes, for a
 * belt to go round.
 *
 * Each class has an outline of its own, so the five tell apart with the
 * colour taken away: cloth is padded out to the knee with a rolled collar and
 * hem, leather stands up in a tall collar, shoulder caps and a skirt of four
 * flared panels, mail hangs in a bell past the hips split front and back,
 * scale lies in overlapping courses that saw-tooth the outline from the head
 * to the feet, and plate stands off the shoulders in pauldrons and off the
 * hips in lames.
 */
const MODELS: Record<string, (b: Build, fit: number) => GearModel> = {
  /* Head */
  wool_cap: (b) => {
    const rim = { f: 2.16, b: 1.6 };
    return {
      layer: 1,
      bits: [{
        bone: 'head', over: HEAD_OVER, bias: 0.03,
        mesh: grown(worn(hat(b.fr, [
          // A rolled brim up on the brow and down at the nape, and the knitted crown slouching back over the top.
          { ...rim, out: 0.12, outB: 0.2 }, { f: 2.32, b: 1.74, out: 0.3, outB: 0.34 }, { f: 2.46, b: 1.9, out: 0.2, outB: 0.24 },
          { f: 2.8, b: 2.46, out: 0.17, outB: 0.2, dy: -0.08 }, { f: CROWN + 0.04, r: [1.04, 1.1], dy: -0.4 }, { f: CROWN + 0.3, r: [0.6, 0.64], dy: -0.95 },
        ], 8, (band) => (band < 2 ? 'clothDark' : 'cloth')), 'quilt', (f) => f.m === 'cloth')),
      }],
      hides: ['top', 'tails'],
      hairTo: rim,
    };
  },
  leather_cap: (b) => {
    const rim = { f: 2.16, b: 1.62 };
    // Where the rim is at `a` degrees round from the right: over the brow in front, down to the nape behind.
    const rimAt = (a: number): number => rim.b + (rim.f - rim.b) * (1 + Math.sin(a * DEG)) / 2;
    return {
      layer: 2,
      bits: [{
        bone: 'head', over: HEAD_OVER, bias: 0.03,
        mesh: grown(join(
          // A round cap of hide to just over the brow, standing well off the head all round so it is a cap and not the head's own
          // outline, with a button on the crown.
          hat(b.fr, [
            { ...rim, out: 0.26, outB: 0.3 }, { f: 2.3, b: 1.76, out: 0.32, outB: 0.34 },
            { f: 2.7, b: 2.34, out: 0.32 }, { f: 3.0, b: 2.86, out: 0.27 }, { f: CROWN + 0.26, r: [0.5, 0.52] },
          ], 8, 'leather'),
          ball([0, skull(b.fr, CROWN - 0.1)[2], CROWN + 0.31], [0.22, 0.22, 0.13], 5, 3, 'leatherDark'),
          // Its edge rolled over on itself, standing proud of the cap all round.
          hat(b.fr, [
            { f: rim.f - 0.06, b: rim.b - 0.06, out: 0.3, outB: 0.34 }, { f: rim.f + 0.06, b: rim.b + 0.06, out: 0.5, outB: 0.54 },
            { f: rim.f + 0.2, b: rim.b + 0.2, out: 0.34, outB: 0.38 },
          ], 8, 'leatherDark', false),
          // Sewn from four panels, a raised seam from the roll to the button between each, unbroken, so it is a cap of panels and
          // not a head of hair -- or, cut short, a pair of brows.
          ...[45, 135, 225, 315].map((a) => seamOf(b.fr, a, rimAt(a) + 0.22, CROWN + 0.05, 0.33, 0.06, 'leatherDark')),
          // Flaps down over the ears, narrow, and behind the cheek rather than over it.
          ...[-22, 202].map((c) => arcs([skullRing(b.fr, 1.1, 0.28), skullRing(b.fr, 1.45, 0.3), skullRing(b.fr, 1.85, 0.3)], 3, c - 16, c + 16, (band) => (band === 0 ? 'leatherDark' : 'leather'))),
        )),
      }],
      hides: ['top', 'tails'],
      hairTo: rim,
    };
  },
  chain_coif: (b) => ({
    layer: 3,
    bits: [
      {
        bone: 'head', over: HEAD_OVER, bias: 0.035,
        mesh: grown(join(
          // Close over the head and down to the brow in front, the face left open below it.
          // Its rim not inked: round the back it lies under the mail that hangs round the face, and inked there it is a line across the back of the head.
          worn(softRim(hat(b.fr, [{ f: 2.02, b: 1.3, out: 0.24, outB: 0.3 }, { f: 2.42, b: 2.1, out: 0.27 }, { f: 2.86, out: 0.24 }, { f: CROWN + 0.2, r: [0.54, 0.57] }], 8, 'mail'), 8), 'mail'),
          // Round the head and down the throat, standing off the cheeks, the ears and the jaw, and closed under the chin: the face left
          // open from under the chin to the brow and between the cheekbones, a frame of mail round it seen from the front.
          worn(coifOf(), 'mail'),
        )),
      },
      // The cape of it over the shoulders, standing a little off them.
      {
        bone: 'chest', over: ['chest', 'neck'], bias: 0.11,
        mesh: worn(rings([[1.08, 2.32 * b.fr.sh, 1.54], [2.05, 1.7 * b.fr.sh, 1.12], [2.75, 1.0, 0.94, 0, -0.05]], 8, 'mail', { top: false, bottom: false }), 'mail'),
      },
    ],
    // A hood hides the hair and the ears: it covers the head to the shoulders, and they would stand out through it.
    hides: ['cap', 'top', 'fall', 'tails', 'ears'],
  }),
  helm: (b) => {
    const rim = { f: 1.98, b: 1.55 };
    const cheeks = cheekPlates();
    return {
      layer: 5,
      bits: [{
        bone: 'head', over: HEAD_OVER, bias: 0.04,
        mesh: grown(join(
          // A round steel cap to a rolled rim just over the brow, deeper behind, and a comb from the brow over the crown: standing
          // clear of the hair all round, so the head is the helm's shape and not the haircut's.
          hat(b.fr, [
            { ...rim, out: 0.42, outB: 0.48 }, { f: 2.1, b: 1.7, out: 0.4, outB: 0.44 }, { f: 2.5, b: 2.3, out: 0.38 },
            { f: 2.85, out: 0.32 }, { f: CROWN + 0.36, r: [0.6, 0.62] },
          ], 8, (band) => (band === 0 ? 'metalLit' : 'metal')),
          // From the brow up to the top of the crown and no further: down the back, it is a stroke of light down the middle of the head from behind.
          crestOf(b.fr, 0.4, 0.13, 'metalLit', CROWN + 0.48, 2.25, Infinity),
          // A tail of lames over the nape from the rim, meeting the cheek plates either side and flaring out further at each step down,
          // so from behind it is a helm's back and not a face, nor a box.
          arcs([skullRing(b.fr, 0.46, 1.0), skullRing(b.fr, 0.86, 0.76), skullRing(b.fr, 1.24, 0.56), skullRing(b.fr, rim.b + 0.08, 0.46)], 6, [190, 192, 194, 196], [350, 348, 346, 344], (band) => (band === 1 ? 'metalLit' : 'metal')),
        )),
      }, {
        // The nasal down over the nose, and a cheek plate down each side of the face: broad under the rim, and narrowing as it goes
        // down and comes round the jaw toward the chin, standing off it a little more at the bottom, so it is a curved plate and not a
        // strap. A bit of their own, out of sight behind the skull: drawn over the head with the rest of the helm, the nasal showed
        // under the back of the rim with the head bowed and seen from behind, a bar down the back of the neck.
        bone: 'head', over: HEAD_OVER, bias: 0.045, hide: [SKULL, JAW],
        mesh: grown(join(
          box([-0.13, 1.82, 0.92], [0.13, 2.08, 2.02], 'metal'),
          ...cheeks.map(([lo, hi]) => arcs([skullRing(b.fr, 0.62, 0.44), skullRing(b.fr, 1.15, 0.4), skullRing(b.fr, rim.f - 0.1, 0.4)], 3, lo, hi, (band) => (band === 1 ? 'metalLit' : 'metal'))),
        )),
      }],
      hides: ['top', 'tails'],
      hairTo: rim,
    };
  },
  scale_helm: (b) => {
    const rim = { f: 1.98, b: 1.5 };
    const cheeks = cheekPlates();
    return {
      layer: 4,
      bits: [{
        bone: 'head', over: HEAD_OVER, bias: 0.04,
        mesh: grown(join(
          // Courses of scale up the skull from a rim over the brow, and a row of scale-spines up the middle, tallest over the crown.
          worn(hat(b.fr, [
            { ...rim, out: 0.42, outB: 0.46 }, { f: 2.2, b: 1.9, out: 0.38 }, { f: 2.24, b: 1.94, out: 0.44 }, { f: 2.56, b: 2.36, out: 0.38 },
            { f: 2.6, b: 2.4, out: 0.42 }, { f: 2.92, out: 0.34 }, { f: CROWN + 0.34, r: [0.6, 0.62] },
          ], 8, (band) => (band === 0 ? 'scaleDark' : band % 2 ? 'scaleDark' : 'scale')), 'scale', (f) => f.m === 'scale'),
          // A crest of three fins over the crown, splayed: the middle one upright and tallest, one leaning out to either side. Each is
          // broad and thick where it stands on the helm and swept back to its point, so end on it is three spikes with a width to
          // them, side on one fin, and from behind no ridge down the back of the head.
          ...[-24, 0, 24].map((lean) => {
            // Standing on the dome rather than sunk into it, where from three-quarters behind the edges of what was inside it showed
            // through as two dark chevrons, a face on the back of the head.
            const B = CROWN + 0.24, T = lean ? CROWN + 1.1 : CROWN + 1.5;
            return splayed(slab([[-0.6, B, 0.2], [0.45, B, 0.2], [-0.05, B + (T - B) * 0.5, 0.12], [-0.35, T, 0.04]], 'scaleDark'), lean, B, lean ? Math.sign(lean) * 0.26 : 0);
          }),
          // A cheek plate of scale down each side of the face, cut as the helm's are.
          ...cheeks.map(([lo, hi]) => worn(arcs([skullRing(b.fr, 0.62, 0.44), skullRing(b.fr, 1.15, 0.4), skullRing(b.fr, rim.f - 0.1, 0.4)], 3, lo, hi, (band) => (band === 0 ? 'scaleDark' : 'scale')), 'scale', (f) => f.m === 'scale')),
          // A curtain of scale hung from the rim round the back of the neck, so from behind it is the helm and not a face.
          worn(arcs([skullRing(b.fr, 0.62, 0.66), skullRing(b.fr, 1.05, 0.52), skullRing(b.fr, rim.b + 0.06, 0.44)], 5, 205, 335, (band) => (band === 0 ? 'scale' : 'scaleDark')), 'scale', (f) => f.m === 'scale'),
        )),
      }],
      hides: ['top', 'tails'],
      hairTo: rim,
    };
  },

  /* Chest */
  cloth_tunic: (b) => {
    const g = CHEST_FIT.cloth_tunic;
    const skirt = skirtRings(b, g - 0.04, -3.1, 1.8);
    return {
      layer: 1,
      bits: [
        {
          bone: 'chest', over: ['chest'], bias: 0.02, convex: true,
          // Padded thick and quilted in channels.
          mesh: worn(chestShell(b, g, 'cloth'), 'quilt'),
        },
        // A thick rolled collar standing round the neck, faced in the lighter lining as the hem and the cuffs are, so a tunic of any
        // dye is broken at the neck, the waist and the knee and is not one column of it.
        { bone: 'chest', over: ['chest', 'neck'], bias: 0.04, mesh: rings([[2.06, 1.3, 1.08, 0, -0.1], [2.34, 1.32, 1.1, 0, -0.1], [2.62, 1.02, 0.88, 0, -0.1]], 8, 'lining', { top: false, bottom: false }) },
        { bone: 'spine', over: ['abdomen', 'skirt'], bias: 0.02, convex: true, mesh: worn(waistShell(b, g, 'cloth'), 'quilt') },
        // Down to the knee and flaring, split up the front and the back for the stride.
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.16, skirt: true, mesh: worn(splitSkirt(skirt, -1.2, SLIT, 4, 'cloth'), 'quilt') },
        // And a thick roll round the hem.
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.17, skirt: true, mesh: join(...SLIT.map(([a, c]) => facetArcs(profileHem(skirt, 0.18, 0.28), 8, a, c, 'lining'))) },
        { bone: 'pelvis', over: ['belt', 'skirt', 'abdomen', 'pelvis'], bias: 0.02, convex: true, mesh: beltRing(b, g + 0.01, 'belt') },
      ],
      hides: ['skirt', 'belt', 'chest', 'abdomen'],
      dyes: { upper: { tunic: 'cloth', trim: 'clothDark' } },
    };
  },
  leather_jerkin: (b) => {
    const g = CHEST_FIT.leather_jerkin;
    const skirt = skirtRings(b, g + 0.03, -2.3, 4.4);
    return {
      layer: 2,
      bits: [
        {
          bone: 'chest', over: ['chest'], bias: 0.02, convex: true,
          mesh: join(worn(chestShell(b, g, 'leather', 2.18), 'studs'),
            decals([
              // Laced up the front: three crossings of the lace.
              ...[0.35, 0.95, 1.5].map((z) => plate([0, (1.43 * bustDeep(b.fr) * g) / 1.07 + bustAhead(b.fr, g), z], [0.32, 0, 0.18], [0.05, 0, -0.18], [0, 1, 0], 'lace')),
              ...stitchesOf(b, g),
            ])),
        },
        // A tall stiff collar, turned out at its top, the turn burnished pale.
        { bone: 'chest', over: ['chest', 'neck'], bias: 0.04, mesh: rings([[2.06, 1.14, 0.92, 0, -0.1], [2.56, 1.02, 0.84, 0, -0.1], [2.8, 1.16, 0.96, 0, -0.12]], 8, (band) => (band === 1 ? 'leatherLit' : 'leather'), { top: false, bottom: false }) },
        // A strap of the darker hide over the right shoulder and across to the left hip, buckled high on the chest, and a row of
        // stitching down each side of the lacing: what breaks up a coat of one hide.
        { bone: 'chest', over: ['chest'], bias: 0.03, mesh: baldricOf(b, g + 0.05) },
        { bone: 'spine', over: ['abdomen', 'skirt'], bias: 0.02, convex: true, mesh: waistShell(b, g, 'leather') },
        // A stiff skirt in four panels, split at the front, the back and each side, flaring, and bound along the hem in pale rawhide.
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.16, skirt: true, mesh: worn(join(...[[8, 82], [98, 172], [188, 262], [278, 352]].map(([a, c]) => arcs(skirt, 3, a, c, 'leather'))), 'studs') },
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.17, skirt: true, mesh: join(...[[8, 82], [98, 172], [188, 262], [278, 352]].map(([a, c]) => arcs(profileHem(skirt, 0.05, 0.2), 3, a, c, 'lace'))) },
        { bone: 'pelvis', over: ['belt', 'skirt', 'abdomen', 'pelvis'], bias: 0.02, convex: true, mesh: join(beltRing(b, g + 0.01, 'belt', 0.9, 1.5), decals([plate([0, 1.32 * (g + 0.01) * Math.cos(Math.PI / 8) + 0.01, 1.2], [0.24, 0, 0], [0, 0, 0.22], [0, 1, 0], 'fitting')])) },
        // Stiff caps over the shoulders, their edge burnished pale: domed from a short wall rather than a tall one, which seen with
        // the arm toward the viewer was a box standing on the shoulder.
        {
          bone: 'arm', side: 'both', over: ['upper'], bias: 0.2, convex: true, whole: true,
          mesh: join(rings([[-0.82, 1.04, 1.02, 0.08], [-0.66, 1.1, 1.08, 0.08], [-0.1, 1.14 * b.arm, 1.1, 0.08], [0.38, 0.92, 0.9, 0.06], [0.64, 0.44, 0.42, 0.03]], 6, (band) => (band === 0 ? 'leatherLit' : 'leather'), { bottom: false }), underside([-0.82, 1.04, 1.02, 0.08], 6, 'leatherDark')),
        },
      ],
      hides: ['skirt', 'belt', 'chest', 'abdomen'],
    };
  },
  chain_hauberk: (b) => {
    const g = CHEST_FIT.chain_hauberk;
    // Hanging long and belling out well past the hips, which is what tells it from a coat at a distance.
    const skirt = skirtRings(b, g - 0.02, -3.0, 7.2);
    return {
      layer: 3,
      bits: [
        { bone: 'chest', over: ['chest'], bias: 0.02, convex: true, mesh: worn(join(chestShell(b, g, 'mail'), rings([[2.12, 1.1, 0.9, 0, -0.1], [2.42, 0.96, 0.82, 0, -0.1]], 8, 'mail', { top: false, bottom: false })), 'mail') },
        { bone: 'spine', over: ['abdomen', 'skirt'], bias: 0.02, convex: true, mesh: worn(waistShell(b, g, 'mail'), 'mail') },
        // Hanging in a bell to the middle of the thigh, split up the front and the back to the fork so each half goes with its leg, with a
        // band of bright rings round the hem: of its own metal, as brass it was a band of the gold that says fantastic, on every hauberk.
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.16, skirt: true, mesh: worn(splitSkirt(skirt, -0.9, SLIT, 4, 'mail'), 'mail') },
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.18, skirt: true, mesh: join(...SLIT.map(([a, c]) => facetArcs(profileHem(skirt, 0.05, 0.26), 8, a, c, 'metalLit'))) },
        { bone: 'pelvis', over: ['belt', 'skirt', 'abdomen', 'pelvis'], bias: 0.02, convex: true, mesh: beltRing(b, g + 0.02, 'belt') },
        // And short sleeves of it to halfway down the upper arm.
        { bone: 'arm', side: 'both', over: ['upper'], bias: 0.02, convex: true, mesh: worn(upperShell(b, 1.2, -1.45, 'mail'), 'mail') },
      ],
      hides: ['skirt', 'belt', 'chest', 'abdomen'],
    };
  },
  plate_breastplate: (b) => {
    const g = CHEST_FIT.plate_breastplate;
    const front = 1.34 * bustDeep(b.fr) * g * Math.cos(Math.PI / 8) + bustAhead(b.fr, g);
    return {
      layer: 5,
      bits: [
        {
          bone: 'chest', over: ['chest'], bias: 0.03, convex: true,
          mesh: join(chestShell(b, g, 'metal'),
            // A rolled rim at the neck, and the ridge down the middle catching the light.
            rings([[2.18, 1.4 * b.fr.sh * g, 0.8 * g, 0, -0.08], [2.32, 1.3 * b.fr.sh * g, 0.74 * g, 0, -0.08]], 8, 'metalLit', { top: false, bottom: false }),
            decals([plate([0, front + 0.012, 0.95], [0, 0, 0.8], [0.07, 0, 0], [0, 1, 0], 'metalLit')])),
        },
        { bone: 'spine', over: ['abdomen', 'skirt'], bias: 0.03, convex: true, mesh: waistShell(b, g, 'metal') },
        // The faulds: three lames over the hips, each over the one below, standing off them.
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.16, skirt: true, mesh: worn(shingled(skirtRings(b, g, -1.8, 2.4), 3, 0.12, 'metal', 'metal', 8), 'lames') },
      ],
      hides: ['skirt', 'belt', 'chest', 'abdomen'],
    };
  },
  scale_cuirass: (b) => {
    const g = CHEST_FIT.scale_cuirass;
    const skirt = skirtRings(b, g - 0.02, -2.2, 1.8);
    const shoulder = [[-0.95, 1.04, 1.02, 0.1], [0.2, 1.18, 1.14, 0.1], [0.78, 0.68, 0.66, 0.04]];
    const scaly = (m: Mesh): Mesh => worn(m, 'scale', (f) => f.m === 'scale');
    return {
      layer: 4,
      bits: [
        // Scale in courses over the whole body of it (see `worked`), and a collar of the dark scale.
        { bone: 'chest', over: ['chest'], bias: 0.02, convex: true, mesh: scaly(join(chestShell(b, g, 'scale'), rings([[2.16, 1.36 * b.fr.sh * g, 0.78 * g, 0, -0.08], [2.3, 1.24 * b.fr.sh * g, 0.72 * g, 0, -0.08]], 8, 'scaleDark', { top: false, bottom: false }))) },
        { bone: 'spine', over: ['abdomen', 'skirt'], bias: 0.02, convex: true, mesh: scaly(waistShell(b, g, 'scale')) },
        // And a skirt of it to the middle of the thigh, flaring, its hem cut in points.
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.16, skirt: true, convex: true, mesh: scaly(rings(skirt, 8, 'scale', { top: false, bottom: false })) },
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.17, skirt: true, convex: true, mesh: teeth(profileAt(skirt, 0), 10, 0.42, 0.1, 'scaleDark') },
        { bone: 'pelvis', over: ['belt', 'skirt', 'abdomen', 'pelvis'], bias: 0.02, convex: true, mesh: beltRing(b, g + 0.03, 'belt') },
        // Great scales capping the shoulders, their edge in points over the top of the arm.
        { bone: 'arm', side: 'both', over: ['upper'], bias: 0.2, convex: true, whole: true, mesh: join(scaly(rings(shoulder, 8, 'scale', { bottom: false })), underside(shoulder[0], 8, 'scaleDark')) },
        { bone: 'arm', side: 'both', over: ['upper'], bias: 0.21, convex: true, whole: true, mesh: teeth(shoulder[0], 6, 0.42, 0.1, 'scaleDark') },
      ],
      hides: ['skirt', 'belt', 'chest', 'abdomen'],
    };
  },

  /* Arms, hands and all */
  cloth_sleeves: (b) => ({
    layer: 1,
    bits: [
      // Padded out, thickest over the shoulder, and rolled at the cuff: the top of it rounded in and sloping in toward the neck, as a
      // raglan sleeve's does, and closed there with a seam into the coat's armhole (`capped`), where a cap standing on it or a roll
      // round it was a lid on a tube.
      {
        bone: 'arm', side: 'both', over: ['upper'], bias: 0.01, convex: true,
        mesh: worn(softAt(capped(rings([
          ...overElbow(b.fr, 1.24, -0.2, [0.84 * b.arm * 1.42, 0.82 * 1.42]),
          [-0.2, 0.84 * b.arm * 1.42, 0.82 * 1.42], [0.2, 0.64 * 1.42, 0.62 * 1.42, -0.22], [0.36, 0.4, 0.38, -0.55],
        ], 6, 'cloth', { bottom: false })), -UPPER * b.fr.tall), 'quilt'),
      },
      // No ball over the elbow: soft cloth is one tube bent there (see `bentAtElbow`), where a ball of its own showed through the
      // crook as a doll's joint.
      { bone: 'elbow', side: 'both', over: ['lower'], bias: 0.015, convex: true, mesh: join(worn(forearmShell(1.24, 'cloth'), 'quilt'), rings([[-2.46, 0.72, 0.68], [-1.95, 0.74, 0.7]], 6, 'lining', { top: false, bottom: false })) },
    ],
    hides: ['upper', 'lower'],
  }),
  leather_sleeves: (b) => ({
    layer: 2,
    bits: [
      // No ball over the elbow, as with cloth: from behind it was a button of lit hide on each arm.
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.02, convex: true, mesh: upperShell(b, 1.1, undefined, 'leather') },
      {
        bone: 'elbow', side: 'both', over: ['lower'], bias: 0.025,
        // Bracers of the darker hide, stiff and standing off the forearm, laced down the inside.
        mesh: join(rings(BRACER, 6, 'leatherDark', { top: false, bottom: false }), decals([-0.9, -1.35, -1.8].flatMap((z) => laceOver(BRACER, z)))),
      },
      { bone: 'elbow', side: 'both', over: ['lower'], bias: 0.02, convex: true, mesh: forearmShell(1.1, 'leather') },
    ],
    glove: 'leather',
    hides: ['upper', 'lower'],
  }),
  chain_sleeves: (b) => ({
    layer: 3,
    bits: [
      // No ball over the elbow: mail hangs in one sleeve bent there, and a ball stood out of the crook of every bent arm.
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.015, convex: true, mesh: worn(upperShell(b, 1.12, undefined, 'mail'), 'mail') },
      { bone: 'elbow', side: 'both', over: ['lower'], bias: 0.02, convex: true, mesh: worn(forearmShell(1.12, 'mail'), 'mail') },
      // Flaring out over the back of the hand at the wrist, its edge hanging in the ragged points rings do: what says mail in the
      // outline of an arm, where a sleeve of anything else is a tube.
      { bone: 'elbow', side: 'both', over: ['lower', 'hand'], bias: 0.03, convex: true, mesh: worn(rings([[-2.52, 0.8, 0.76], [-1.95, 0.64, 0.6]], 6, 'mail', { top: false, bottom: false }), 'mail') },
      { bone: 'elbow', side: 'both', over: ['lower', 'hand'], bias: 0.032, convex: true, mesh: teeth([-2.5, 0.8, 0.76], 8, 0.24, 0.05, 'mail') },
    ],
    glove: 'mail',
    hides: ['upper', 'lower'],
  }),
  plate_arms: (b) => ({
    layer: 5,
    bits: [
      // The rerebrace down the upper arm, and the pauldron standing off the shoulder: one plate domed over the point of it, and two
      // lames under its edge -- ring on ring all the way up, it is a bellows.
      {
        bone: 'arm', side: 'both', over: ['upper'], bias: 0.02, convex: true,
        mesh: softAt(capped(rings([...overElbow(b.fr, 1.16, 0.05, [0.94 * b.arm, 0.9]), [0.05, 0.94 * b.arm, 0.9]], 6, 'metal', { bottom: false })), -UPPER * b.fr.tall),
      },
      {
        bone: 'arm', side: 'both', over: ['upper'], bias: 0.2, convex: true, whole: true,
        // Domed no higher than the top of the shoulder and standing no further off it than a plate and its padding: as tall as the
        // shoulder was to the jaw, it stood up in front of the chin seen side on and went into the jaw with the arm raised.
        mesh: join(
          shingled([[-1.3, 1.26, 1.22, 0.26], [-0.4, 1.44, 1.4, 0.3]], 2, 0.1, 'metal'),
          underside([-1.3, 1.36, 1.32, 0.26], 6, 'metalDark'),
          rings([[-0.4, 1.54, 1.5, 0.32], [0.35, 1.48, 1.44, 0.28], [0.78, 1.06, 1.02, 0.14], [0.98, 0.46, 0.44, 0.05]], 6, (band) => (band >= 1 ? 'metalLit' : 'metal'), { bottom: false }),
        ),
      },
      // The vambrace down the forearm, meeting the rerebrace at the elbow; and the couter, a cup over the point of the elbow and
      // round its outside, open to the crook and bent round the elbow with the arm, standing off the rerebrace and the vambrace by a
      // plate's thickness. A ball there, or a dome on the elbow's frame, stood half out of the crook of a bent arm.
      { bone: 'elbow', side: 'both', over: ['lower'], bias: 0.024, convex: true, mesh: forearmShell(1.16, 'metal') },
      {
        bone: 'elbow', side: 'both', over: ['lower', 'upper'], bias: 0.03, convex: true,
        mesh: arcs([[-0.66, 0.78, 0.74, 0, -0.02], [-0.32, 0.86, 0.86, 0, -0.08], [0, 0.88, 0.9, 0, -0.12], [0.32, 0.86, 0.86, 0, -0.08], [0.66, 0.8, 0.76, 0, -0.02]], 4, 195, 345, (band) => (band === 1 || band === 2 ? 'metalLit' : 'metal')),
      },
      // The flared cuff of the gauntlet, its top going in under the vambrace and not inked there: drawn over it, with the forearm
      // raised toward the viewer it was a ring round the wrist.
      { bone: 'wrist', side: 'both', over: ['hand'], bias: 0.05, convex: true, mesh: softAt(rings([[-0.2, 0.66, 0.62], [0.08, 0.6, 0.56], [0.35, 0.54, 0.5]], 6, 'metalLit', { top: false, bottom: false }), 0.35) },
    ],
    glove: 'metal',
    hides: ['upper', 'lower'],
  }),
  scale_sleeves: (b) => ({
    layer: 4,
    bits: [
      // Courses of scale down the arm, the upper arm's hem cut in points over the elbow, and no ball at the elbow: side on it was a
      // ring round the joint.
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.015, convex: true, mesh: worn(upperShell(b, 1.14, undefined, 'scale'), 'scale') },
      { bone: 'arm', side: 'both', over: ['upper', 'lower'], bias: 0.018, convex: true, mesh: teeth(upperRings(b, 1.14)[1], 6, 0.36, 0.08, 'scaleDark') },
      { bone: 'elbow', side: 'both', over: ['lower'], bias: 0.02, convex: true, mesh: worn(forearmShell(1.14, 'scale'), 'scale') },
      // A cuff of scale flaring over the back of the glove.
      { bone: 'elbow', side: 'both', over: ['lower', 'hand'], bias: 0.03, convex: true, mesh: rings([[-2.4, 0.76, 0.72], [-1.8, 0.62, 0.59]], 6, 'scaleDark', { top: false, bottom: false }) },
    ],
    // Gauntlets of the dark scale: in dark hide they were blots at the ends of the arms.
    glove: 'scaleDark',
    hides: ['upper', 'lower'],
  }),

  /*
   * Legs. Each leg of every pair one tube from up under the hips to the
   * shin, made straight in the knee's terms and bent there as the body's own
   * leg is (`kneeBent`), in a thigh and a shin that meet edge to edge at the
   * knee (`legTube`): no ball over the knee, which bent stood out of the
   * front of it or the back as a cap of its own, and no step where a thigh's
   * tube ended and a shin's began. What is on the knee -- a pad, a poleyn,
   * the points of a hem -- is bent with it the same way, so it stays on it.
   */
  cloth_trousers: (b) => {
    // Padded out, fullest over the thigh and full over the knee, quilted in channels down the leg.
    const top = THIGH * b.fr.tall - 0.9, mid = KNEE_SPAN + 0.45 * (top - KNEE_SPAN);
    const tube = legTube([[-3.05, 0.74, 0.78], [-1.5, 0.84, 0.88], [-KNEE_SPAN, 0.94, 0.98, 0, -0.03], [0, 1.0, 1.04], [KNEE_SPAN, 1.06, 1.1], [mid, 1.12, 1.16], [top, 1.06 * thighTop(b.fr) * 1.1, 1.1 * 1.12]], 6, 'cloth', true);
    return {
      layer: 1,
      bits: [
        { bone: 'hip', side: 'both', bend: true, over: ['thigh'], bias: 0.01, convex: true, mesh: worn(tube.thigh, 'quilt') },
        { bone: 'knee', side: 'both', bend: true, over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: worn(tube.shin, 'quilt') },
        // Wound from the shoe to below the knee in strips of the darker cloth, slanting round the leg as a winding does. Wound level,
        // every band's edge came to a point over the ridge down the shin, a stack of chevrons. Either end of the winding is not inked:
        // it lies on the leg, and with the shin kicked up behind, its open end turned to the viewer was a ring with nothing in it.
        { bone: 'knee', side: 'both', over: ['shin', 'boot'], bias: 0.035, convex: true, mesh: wound(softAt(softAt(rings([-3.02, -2.72, -2.42, -2.12, -1.82, -1.52].map((z, i) => [z, 0.8 + i * 0.016, 0.84 + i * 0.016]), 6, (band) => (band % 2 ? 'cloth' : 'clothDark'), { top: false, bottom: false }), -3.02), -1.52)) },
      ],
      hides: ['thigh', 'shin'],
      dyes: { pelvis: { trousers: 'cloth' } },
    };
  },
  leather_trousers: (b) => {
    const rs = legRings(b, 1.08, -1.9), tube = legTube(rs, 6, 'leather', true);
    // A pad of doubled hide over the front of each knee, darker, worked into the leg rather than laid on it (`kneePad`).
    const pad = kneePad(rs, 0.5, 0.62, 'leatherDark');
    return {
      layer: 2,
      bits: [
        { bone: 'hip', side: 'both', bend: true, over: ['thigh'], bias: 0.01, convex: true, mesh: join(tube.thigh, pad.thigh) },
        { bone: 'knee', side: 'both', bend: true, over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: join(tube.shin, pad.shin) },
      ],
      hides: ['thigh', 'shin'],
      dyes: { pelvis: { trousers: 'leather' } },
    };
  },
  chain_leggings: (b) => {
    const tube = legTube(legRings(b, 1.1, -2.6), 6, 'mail', true);
    return {
      layer: 3,
      bits: [
        { bone: 'hip', side: 'both', bend: true, over: ['thigh'], bias: 0.012, convex: true, mesh: worn(tube.thigh, 'mail') },
        { bone: 'knee', side: 'both', bend: true, over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: worn(tube.shin, 'mail') },
        // A row of ragged points round the leg over the knee, where the mail of the thigh is laced over that of the shin.
        { bone: 'hip', side: 'both', bend: true, over: ['thigh', 'shin'], bias: 0.016, convex: true, mesh: teeth(legAt(b, 1.1, 0.5), 9, 0.26, 0.05, 'mail') },
        // A garter of hide under the knee, holding the mail up.
        { bone: 'knee', side: 'both', bend: true, over: ['shin', 'boot'], bias: 0.04, convex: true, mesh: rings([legAt(b, 1.15, -0.86), legAt(b, 1.15, -0.6)], 6, 'leatherDark', { top: false, bottom: false }) },
      ],
      hides: ['thigh', 'shin'],
      dyes: { pelvis: { trousers: 'mail' } },
    };
  },
  plate_legs: (b) => {
    // The greave and the knee as one, and the cuisses over the thigh in lames, from up under the fauld so no gap shows between them.
    const g = 1.1, top = THIGH * b.fr.tall;
    // The poleyn, a cup over the front of the knee, raised out of the leg's own ring there -- the ring at the knee carried forward
    // and out -- and polished: a cup of its own standing off the knee was what the knee was drawn as when it was stacked tubes,
    // and seen edge on, with the leg kicked up behind at a run, it was a dark needle out of the fold.
    const rs = legRings(b, g, -2.7).filter((r) => r[0] <= KNEE_SPAN).map((r) => (r[0] === 0 ? [0, r[1] + 0.05, r[2] + 0.06, 0, 0.1] : r));
    const tube = legTube(rs, 6, 'metal', true), cop = kneePad(rs, 0.5, 0.7, 'metalLit');
    const cuisse = shingled([legAt(b, g, KNEE_SPAN), legAt(b, g, top - 0.9), [top + 0.25, 1.1 * b.fr.hi * g, 1.12 * g]], 3, 0.1, 'metal');
    return {
      layer: 5,
      bits: [
        { bone: 'hip', side: 'both', bend: true, over: ['thigh'], bias: 0.015, convex: true, mesh: join(tube.thigh, cop.thigh, worn(cuisse, 'lames')) },
        { bone: 'knee', side: 'both', bend: true, over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: join(tube.shin, cop.shin) },
      ],
      hides: ['thigh', 'shin'],
      dyes: { pelvis: { trousers: 'metal' } },
    };
  },
  scale_leggings: (b) => {
    const g = 1.12;
    const rs = legRings(b, g, -2.4), tube = legTube(rs, 6, 'scale', true);
    // The knee worked in the dark scale (`kneePad`), and over it the thigh's scale ending in points.
    const pad = kneePad(rs, 0.42, 0.55, 'scaleDark');
    return {
      layer: 4,
      bits: [
        { bone: 'hip', side: 'both', bend: true, over: ['thigh'], bias: 0.012, convex: true, mesh: join(worn(tube.thigh, 'scale'), pad.thigh) },
        { bone: 'knee', side: 'both', bend: true, over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: join(worn(tube.shin, 'scale'), pad.shin) },
        { bone: 'hip', side: 'both', bend: true, over: ['thigh', 'shin'], bias: 0.04, convex: true, mesh: teeth(legAt(b, g, 0.62), 6, 0.34, 0.08, 'scaleDark') },
      ],
      hides: ['thigh', 'shin'],
      dyes: { pelvis: { trousers: 'scale' } },
    };
  },

  /*
   * Feet: in place of the body's own boots. Each shaft is over the leg of
   * whatever is worn under it unless its foot is turned well away from the
   * viewer, when the leg is the nearer and goes over it.
   */
  cloth_shoes: () => ({
    layer: 1,
    bits: [
      // The leg of the trousers down to the shoe, which the boot's shaft was: under anything worn on the leg.
      // As full as the leg it goes up into at its top, and not inked there, and only a little narrower at the ankle: it narrowed to
      // a peg standing in the shoe, and stood out of the leg at its top in a ring. Closed at its foot (see `legTube`).
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.01, convex: true, layer: 0, front: SHAFT, mesh: softAt(soled(rings([[-3.0, 0.68, 0.72], [-1.3, 0.73, 0.77]], 6, 'trousers', { top: false })), -1.3) },
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.02, convex: true, front: SHAFT, mesh: soled(rings([[-3.1, 0.68, 0.72], [-2.5, 0.72, 0.76]], 6, 'clothDark', { top: false })) },
      { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: recoloured(swelled(footMesh(), 0.96, 0.8), { boot: 'clothDark' }) },
    ],
    hides: ['boot', 'foot'],
  }),
  leather_boots: () => {
    // To under the knee, clear of the pad on it, and close round the leg all the way up -- a hand's breadth outside the leather of
    // the trousers (`legRings` at 1.08), no more -- in the darker hide, with the top turned down to show its burnished side, and
    // that only as far proud of the shaft as the hide is thick. The cuff stood a fifth of a tenth out over a shaft that narrowed
    // under it to less than the leg, a third tube stacked on the shin; and cut lower behind, it opened a notch at the back of the leg.
    // Closed at the foot, as every shaft is (`soled`).
    const shaft = rings([
      [-3.1, 0.7, 0.74], [-1.4, 0.84, 0.88], [-1.12, 0.86, 0.9], [-1.08, 0.9, 0.94], [-0.86, 0.91, 0.95],
    ], 6, (band) => (band >= 3 ? 'leatherLit' : 'leatherDark'), { top: false });
    return {
      layer: 2,
      bits: [
        { bone: 'knee', side: 'both', over: ['shin'], bias: 0.02, convex: true, front: SHAFT, mesh: soled(shaft) },
        { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: recoloured(swelled(footMesh(), 1.04), { boot: 'leather' }) },
      ],
      hides: ['boot', 'foot'],
    };
  },
  chain_boots: () => ({
    layer: 3,
    bits: [
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.02, convex: true, front: SHAFT, mesh: worn(soled(rings([[-3.1, 0.68, 0.72], [-1.2, 0.9, 0.94]], 6, 'mail', { top: false })), 'mail') },
      { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: worn(recoloured(swelled(footMesh(), 1.05), { boot: 'mail' }), 'mail') },
      // Strapped at the ankle over the mail.
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.03, convex: true, front: SHAFT, mesh: rings([[-2.92, 0.73, 0.77], [-2.72, 0.74, 0.78]], 6, 'leatherDark', { top: false, bottom: false }) },
    ],
    hides: ['boot', 'foot'],
  }),
  plate_boots: (b) => ({
    layer: 5,
    bits: [
      // The shaft up to the calf, its top the greave's own round there (`legAt`) and not inked: a hair outside it, it was a step
      // across the calf, a line round the leg where the greave and the sabaton are one surface of plate.
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.02, convex: true, front: SHAFT, mesh: softAt(soled(rings([[-3.18, 0.7, 0.74], [-3.0, 0.72, 0.76], legAt(b, 1.1, -1.3)], 6, (band) => (band === 0 ? 'metalLit' : 'metal'), { top: false })), -1.3) },
      { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: worn(recoloured(swelled(footMesh(), 1.08), { boot: 'metal' }), 'lames') },
    ],
    hides: ['boot', 'foot'],
  }),
  scale_boots: () => ({
    layer: 4,
    bits: [
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.02, convex: true, front: SHAFT, mesh: worn(soled(rings([[-3.08, 0.68, 0.72], [-1.05, 0.88, 0.92]], 8, 'scale', { top: false })), 'scale') },
      // The top of the shaft flared into a crown of points.
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.03, convex: true, front: SHAFT, mesh: teeth([-1.12, 0.9, 0.94], 7, -0.38, 0.1, 'scaleDark') },
      // And the foot scaled, its toe capped in the dark scale.
      { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: recoloured(swelled(footMesh(), 1.05), { boot: 'scaleDark', cuff: 'scale' }) },
    ],
    hides: ['boot', 'foot'],
  }),

  /* Round the waist */
  toolbelt: (b, fit) => {
    const g = fit + 0.04, wa = b.fr.wa;
    const X = 1.64 * wa * g, Y = 1.32 * g;
    const front = Y * Math.cos(Math.PI / 8);
    // Something made facing out along +y from the belt's middle, put on the belt `deg` round from the front toward the right.
    const onBelt = (m: Mesh, deg: number): Mesh => {
      const a = deg * DEG;
      return spun(moved(m, [0, 1 / Math.hypot(Math.sin(a) / X, Math.cos(a) / Y), 0]), deg);
    };
    return {
      layer: 6,
      bits: [
        {
          bone: 'pelvis', over: ['belt', 'skirt', 'abdomen'], bias: 0.03, convex: true,
          mesh: join(beltRing(b, g, 'leather', 0.86, 1.52), decals([plate([0, front + 0.01, 1.2], [0.28, 0, 0], [0, 0, 0.28], [0, 1, 0], 'fitting'), plate([0, front + 0.02, 1.2], [0.13, 0, 0], [0, 0, 0.13], [0, 1, 0], 'leatherDark')])),
        },
        // Drawn bigger than life, as the jewels are, to be seen at all.
        // A pocket at the front of the right hip, and standing up out of it the handles of a chisel and an awl.
        {
          bone: 'pelvis', over: ['belt', 'skirt', 'thigh', 'abdomen'], bias: 0.06,
          mesh: onBelt(join(
            box([-0.55, -0.02, 0.1], [0.55, 0.46, 1.4], 'leather', 'leatherDark'),
            box([-0.58, 0.38, 0.98], [0.58, 0.5, 1.46], 'leatherDark'),
            moved(rings([[1.2, 0.17, 0.17], [2.3, 0.21, 0.21], [2.52, 0.13, 0.13]], 6, 'wood'), [-0.26, 0.22, 0]),
            moved(rings([[1.2, 0.13, 0.13], [1.95, 0.16, 0.16], [2.12, 0.08, 0.08]], 5, 'woodDark'), [0.28, 0.22, 0]),
          ), 55),
        },
        // A pouch round at the left of the back, with its flap.
        { bone: 'pelvis', over: ['belt', 'skirt', 'thigh'], bias: 0.06, mesh: onBelt(join(box([-0.5, -0.05, 0.2], [0.5, 0.5, 1.3], 'leather'), box([-0.53, -0.05, 0.96], [0.53, 0.55, 1.38], 'leatherDark')), -160) },
        // And a claw hammer behind the left hip, where the arm does not hide it, hung head down through a loop on the belt by the
        // swell at the end of its handle: the end standing up out of the loop over the belt, and the head down at the thigh, face
        // forward and claw back. Hung by its head, the head was across the belt and read as a buckle.
        {
          bone: 'pelvis', over: ['belt', 'skirt', 'thigh'], bias: 0.07,
          mesh: onBelt(join(
            rings([[0.92, 0.26, 0.26, 0, 0.36], [1.34, 0.26, 0.26, 0, 0.36]], 6, 'leatherDark', { top: false, bottom: false }),
            moved(rings([[-1.4, 0.15, 0.15], [1.36, 0.16, 0.16], [1.56, 0.21, 0.21], [1.8, 0.12, 0.12]], 5, 'wood'), [0, 0.36, 0]),
            box([-0.42, 0.14, -1.86], [0.62, 0.58, -1.4], 'metal', 'metalLit'),
            box([0.5, 0.1, -1.91], [0.84, 0.62, -1.35], 'metalLit'),
            // The claw, back and up: drawn across and turned to lie along the head.
            moved(spun(slab([[-0.42, -1.44, 0.16], [-0.42, -1.82, 0.16], [-0.86, -1.72, 0.12], [-1.26, -1.32, 0.07], [-1.0, -1.28, 0.08]], 'metalDark'), 90), [0, 0.36, 0]),
          ), -122),
        },
      ],
      hides: ['belt'],
    };
  },

  /*
   * An Artisan's circlet, in the head's place for a helm: a thin gold band
   * round the brow over the hair, down a little to the nape as a hat is worn,
   * and its three settings over the brow, the middle one the largest.
   */
  circlet: (b) => {
    const at = 2.36;
    const [sx, sy, cy] = skull(b.fr, at);
    const stone = (deg: number, m: Mat, r: number): Mesh => {
      const a = deg * DEG;
      return ball([Math.cos(a) * (sx + 0.17), cy + Math.sin(a) * (sy + 0.17), at + 0.02], [r, r * 0.7, r * 1.15], 5, 3, m);
    };
    return {
      layer: 3,
      bits: [
        {
          bone: 'head', over: HEAD_OVER, bias: 0.05,
          mesh: grown(hat(b.fr, [{ f: at - 0.1, b: at - 0.34, out: 0.1, outB: 0.12 }, { f: at + 0.1, b: at - 0.14, out: 0.1, outB: 0.12 }], 14, 'fitting', false)),
        },
        // The stones over the head only while the brow is toward the viewer: from behind, the head is in front of them.
        {
          bone: 'head', over: HEAD_OVER, bias: 0.06, front: [0, 1, 0],
          mesh: grown(join(stone(90, 'stone1', 0.17), stone(62, 'stone2', 0.13), stone(118, 'stone3', 0.13))),
        },
      ],
    };
  },

  /* Jewels */
  jewelled_pendant: () => ({
    layer: 7,
    bits: [{
      bone: 'chest', over: ['chest', 'neck'], bias: 0.3, front: [0, 1, 0],
      mesh: join(
        fine(chain([[-0.78, 0.12, 2.3], [-0.62, 0.72, 1.98], [-0.28, 1.12, 1.66], [0, 1.24, 1.52], [0.28, 1.12, 1.66], [0.62, 0.72, 1.98], [0.78, 0.12, 2.3]], [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05], 4, 'fitting', false), 0.1),
        ball([0, 1.36, 1.3], [0.2, 0.12, 0.24], 6, 3, 'gem'),
        rings([[1.44, 0.12, 0.08, 0, 1.3], [1.56, 0.09, 0.06, 0, 1.28]], 5, 'fitting'),
      ),
    }],
  }),
  jewelled_ring: () => ({
    layer: 7,
    bits: [{
      bone: 'wrist', side: 1, over: ['hand'], bias: 0.06,
      // A narrow gold band round the first finger, on the thumb's side of the fist, and a small stone set in it: round the whole fist
      // it is a knuckle-duster, and a stone standing off the hand is a wart. And laid on the band either side of the stone, gold with
      // no ink round it, which at the size the island is played at is the one gold point the ring is, whichever way the hand is turned:
      // inked, a band that narrow is all ink, a dark nub.
      mesh: handSized(join(
        arcs([[-0.86, 0.5, 0.32], [-0.72, 0.51, 0.33]], 4, 118, 242, 'fitting'),
        ball([-0.47, 0.06, -0.79], [0.11, 0.11, 0.1], 5, 3, 'gem'),
        decals([132, 222].map((deg) => {
          const a = deg * DEG, c = Math.cos(a), sn = Math.sin(a);
          const n = unit([c / 0.51, sn / 0.33, 0]);
          return { ...plate([c * 0.53, sn * 0.35, -0.79], [-sn * 0.17, c * 0.11, 0], [0, 0, 0.11], n, 'fitting'), lit: true };
        })),
      )),
    }],
  }),
};

/** A skirt's hem, `below` under its lowest ring and `up` above it, `out` further out: a roll or a band round it. */
function profileHem(rs: number[][], out: number, up: number, below = 0.06): number[][] {
  const hem = profileAt(rs, 0), over = profileAt(rs, Math.min(1, up / Math.max(0.01, rs[rs.length - 1][0] - rs[0][0])));
  return [[hem[0] - below, hem[1] + out, hem[2] + out, hem[3], hem[4]], [over[0], over[1] + out * 0.6, over[2] + out * 0.6, over[3], over[4]]];
}

/** A leather bracer's rings, bottom first. */
const BRACER: number[][] = [[-2.3, 0.8, 0.76], [-1.1, 0.84, 0.8], [-0.55, 0.76, 0.72]];
/**
 * A crossing of lace over the front of six-sided rings at height `z`, laid on
 * the two facets either side of the ridge down the front rather than flat
 * across it: flat, its ends stood off the facets as they fell away, and seen
 * side on they were pale splinters standing out of the arm.
 */
function laceOver(rs: number[][], z: number): Array<{ q: V3[]; m: Mat }> {
  const [, rx, ry] = profileAt(rs, (z - rs[0][0]) / (rs[rs.length - 1][0] - rs[0][0]));
  // Across the facet from the ridge at the front to the next corner round, a little proud of it.
  const on = (x: number, dz: number): V3 => [x, ry - ((ry * 0.5) / (rx * Math.cos(Math.PI / 6))) * Math.abs(x) + 0.02, z + dz];
  const q = (a: V3[]): { q: V3[]; m: Mat } => ({ q: newell(a)[1] < 0 ? [...a].reverse() : a, m: 'lace' });
  return [
    q([on(-0.22, -0.15), on(0, -0.05), on(0, 0.05), on(-0.22, -0.05)]),
    q([on(0, -0.05), on(0.22, 0.05), on(0.22, 0.15), on(0, 0.05)]),
  ];
}

/** A model for a piece on a body of this build, made once. */
const models = new Map<string, GearModel | null>();
function modelOf(id: string, fr: Frame, fit: number): GearModel | null {
  const key = `${id}|${fr.sh}|${fr.wa}|${fr.hi}|${fr.fem}|${fr.lod}|${id === 'toolbelt' ? fit : ''}`;
  let m = models.get(key);
  if (m === undefined) {
    const make = MODELS[id];
    m = make ? make(buildOf(fr), fit) : null;
    models.set(key, m);
    if (models.size > 400) models.delete(models.keys().next().value as string);
  }
  return m;
}

/** The body's own part recoloured as a piece's (`GearModel.dyes`), kept for each, as it is the same every frame. */
const dyed = new WeakMap<Mesh, WeakMap<object, Mesh>>();
function dyedOf(m: Mesh, to: Partial<Record<Mat, Mat>>): Mesh {
  let byTo = dyed.get(m);
  if (!byTo) dyed.set(m, (byTo = new WeakMap()));
  let o = byTo.get(to);
  if (!o) byTo.set(to, (o = recoloured(m, to)));
  return o;
}

/** Gloves: the hands' own meshes, fist and open, in the gear's colour and a little bigger. */
const gloves = new WeakMap<Mesh, Map<Mat, Mesh>>();
function gloveOf(hand: Mesh, mat: Mat): Mesh {
  let byMat = gloves.get(hand);
  if (!byMat) { byMat = new Map(); gloves.set(hand, byMat); }
  let g = byMat.get(mat);
  if (!g) {
    g = swelled({ ...hand, f: hand.f.map((f) => ({ ...f, m: f.m === 'skin' ? mat : f.m })) }, 1.08, 1.04);
    byMat.set(mat, g);
  }
  return g;
}

/*
 * A skirt -- the tunic's own, or one of gear -- swung with the legs under it.
 * It was pushed: the hem slid forward over a thigh coming up and back over
 * one going behind, by a guess at how far, so a thigh raised high went
 * through the cloth, and the cloth over a thigh sat down in a seat went on
 * hanging straight down with the leg gone into it. Now the cloth over each
 * leg turns about the hip as the thigh lifts it: over the front of a thigh
 * going forward or the back of one going behind, as far as keeps it
 * `SKIRT_CLEAR` off the line of the thigh and no further -- so a hem far out
 * on a bell is lifted less than one close over the leg, and heavy mail is
 * not flung up like a board -- over the side the thigh is moving away from
 * not at all, and in between as much as it is round toward the one or the
 * other. Nothing turns above the hip joint and the whole of it does
 * `SKIRT_TURNS` below, so the waist stays put. Sat down, the front lies
 * along the lap and the rest of it on the seat.
 *
 * How much of it goes with which leg, and how much toward the way the leg
 * is going, both change smoothly all the way round the hem, as the sine and
 * the cosine of how far round it is. They were ramps clamped to all or
 * nothing a short way either side of the middle: either side of a slit up
 * the front, a hair apart, one edge went with one leg and the other with
 * the other, and the hem broke into steps, a panel standing out in front of
 * the thigh like a board with its neighbour hanging straight down.
 */
const SKIRT_TURNS = 1.4;
/** How far in front of the line of a thigh, or behind it, a skirt must keep to clear it: the thigh's round, in what is worn on it. */
const SKIRT_CLEAR = 1.2;
/** Where a body sat down sits, in the hips' frame: the underside of the thighs. */
const SEAT = -1.15;
/** How much of a thigh's swing the cloth in front of it goes with at a run, at most: all of it, and the front of a coat flew up level. */
const SKIRT_RUN = 0.6;
/** How much of the hips' roll from side to side the hem is let hang back from: it hangs, and does not tip with them like a plate. */
const SKIRT_HANG = 0.8;
function bentWith(v: V3[], r: Rig, fr: Frame): V3[] {
  // How far apart the legs are, fore and aft: the hem swings out wider the longer the stride, as a skirt does at a run.
  const stride = Math.min(1, 1.2 * Math.abs(Math.sin(r.leg[0][0] * DEG) - Math.sin(r.leg[1][0] * DEG)));
  // How far toward a run, and nought standing: the hem flies out only at a run.
  const run = (r.hover?.w ?? 0) * (r.hover?.g ?? 0);
  const most = 1 - (1 - SKIRT_RUN) * run;
  const roll = -SKIRT_HANG * r.pelvis[1] * DEG;
  const hip = -0.1;
  return v.map((p0) => {
    const down = Math.max(0, Math.min(1, (hip - p0[2]) / SKIRT_TURNS));
    if (!down) return [...p0] as V3;
    const swing = 1 + 0.14 * stride * down;
    let x = p0[0] * swing;
    let y = p0[1] * swing, z = p0[2] - hip;
    // How far round to the front of the body it is, from straight behind to straight ahead, and to the right, from the left.
    const l = Math.hypot(p0[0] / (1.25 * fr.hi), p0[1]) || 1;
    const ahead = p0[1] / l, across = p0[0] / (1.25 * fr.hi) / l;
    let turn = 0, seat = 0;
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1, a = r.leg[k][0] * DEG;
      // Over this leg rather than the other: half each at the front and the back, all of it at its own side.
      const over = 0.5 + 0.5 * Math.sin((s * across * Math.PI) / 2);
      // On the side the thigh is going toward.
      const t = (1 + Math.sign(a) * ahead) / 2, toward = t * t * (3 - 2 * t);
      // As far as keeps it off the thigh and no further, reckoned where it is: the hem far out on a bell turns less than one close
      // over the leg, a short skirt's hardly at all, and none of it further than the thigh does.
      const off = Math.max(Math.sign(a) * y, SKIRT_CLEAR + 0.05);
      const clear = Math.max(0, Math.abs(a) - Math.acos(SKIRT_CLEAR / Math.hypot(off, z)) + Math.atan2(-z, off));
      turn += Math.sign(a) * Math.min(Math.abs(a) * most, clear) * over * toward * down;
      // And a thigh raised far enough to sit on sits on what is behind it and beside it.
      seat = Math.max(seat, over * (1 - toward) * ramp(a / DEG, 45, 85));
    }
    const c = Math.cos(turn), sn = Math.sin(turn);
    [y, z] = [c * y - sn * z, sn * y + c * z];
    // Hung back from the hips' roll, the more the further down it is, about the hip.
    if (roll) {
      const q = roll * down, cr = Math.cos(q), sr = Math.sin(q);
      [x, z] = [cr * x + sr * z, -sr * x + cr * z];
    }
    z += hip;
    // Sat on, what hung below the seat lies on it behind and beside, gathered in as it is sat on rather than spread as wide as its hem:
    // left hanging, it went down through the seat, and the sides twisted out at the knees in points.
    let gather = 1;
    if (seat > 0 && z < SEAT) {
      gather = 1 - 0.4 * seat * Math.min(1, (SEAT - z) / 1.5);
      z += (SEAT - z) * seat;
    }
    // At a run the back of it flies out behind and up, the further the longer the stride, and falls back as the legs pass: side on,
    // a hem that tilts and swings with the legs rather than a cone carried down the road on them.
    if (run > 0 && y < 0.2) {
      const t = Math.min(1, (0.2 - y) / 1.6);
      y -= 0.45 * run * stride * down * t;
      z += 0.6 * run * stride * down * t;
    }
    return [x * gather, y * gather, z];
  });
}

/* -- what is held ------------------------------------------------------------------ */

/**
 * A weapon, in its own frame: the middle of where the fist closes on it at
 * the origin, and its business end up the z axis -- a blade's point, an axe's
 * head, a bow's upper limb. `grip` is what the fingers close round, drawn
 * under the hand; `head` is the rest.
 */
interface Weapon {
  grip: Mesh;
  head: Mesh;
  /**
   * How it is carried in the hands: in the right fist, point forward and
   * down; upright in the right fist, as a staff is; in the left fist, a bow;
   * or over the right shoulder, the right hand low on it and its head behind,
   * as anything too heavy to hold out in front is.
   */
  carry: 'fist' | 'staff' | 'bow' | 'shoulder';
  /**
   * Where it goes while the hands are wanted for something else: sheathed
   * at the left hip, a blade; through the belt at the right hip, a hatchet
   * or a club; or across the back on a strap.
   */
  stow: 'hip' | 'belt' | 'back';
  /** From its butt to its tip along z. */
  from: number;
  to: number;
  /** Slung head up over the right shoulder, rather than point down to the left hip; through the belt head up. */
  headUp?: boolean;
  /** A blade's scabbard, and what of the weapon shows out of the top of it: the guard and the pommel. */
  sheath?: Mesh;
  hilt?: Mesh;
  /** Where along it the scabbard's throat is. */
  throat?: number;
  /**
   * Shouldered: where along it the fist closes, how far along from there it
   * lies on the shoulder, how far back from upright, how far out from the
   * head, and turned how far about itself, in degrees.
   */
  fist?: number;
  reach?: number;
  tilt?: number;
  out?: number;
  spin?: number;
  /**
   * Shouldered, seen from behind: at each facing where the rest above would
   * lay it along the line of sight, [what share of its tilt back it keeps,
   * how much further out it leans, how much further it is turned about
   * itself], so its head or its blade shows beside the head rather than
   * behind it; and seen side on, how far back behind the neck it goes over
   * the shoulder, so it rises behind the jaw rather than across it.
   */
  stage?: Record<number, [number, number, number] | [number, number, number, number]>;
  /** Carried upright: how far its top leans forward, in degrees. */
  lean?: number;
  /** In the fist: how far down from level its point is, in degrees, if not `FIST_DOWN`; below nought, up from level. */
  down?: number;
  /** Across the back: how far from upright, in degrees. */
  slant?: number;
  /** Through the belt: how far along it the belt goes, from the middle of the grip. */
  belt?: number;
  /** Through the belt: how far its head leans out from the hip and forward, as parts of its length. */
  splay?: [number, number];
}

/** A round shaft along z, from `a` to `b`, `r0` across at `a` and `r1` at `b`. */
const rod = (a: number, b: number, r0: number, r1: number, m: Mat, n = 5): Mesh => rings([[a, r0, r0], [b, r1, r1]], n, m);
/** A shaft in lengths, each ring `[z, r]`: so it can be cut where it lies on a shoulder without a facet crossing the cut. */
const shaft = (zr: Array<[number, number]>, m: Mat, n = 5): Mesh => rings(zr.map(([z, r]) => [z, r, r]), n, m);

/**
 * A blade along z from its root at `a` to its point at `b`: `w` from its
 * middle to either edge and `t` thick at the root, six-sided across so each
 * flat and each bevel takes its own light, narrowing over the last `point` of
 * its length. A single edge (`back` one) has its point drawn up to the back.
 */
function bladeOf(a: number, b: number, w: number, t: number, point = 0.24, m: Mat = 'blade', back = 0): Mesh {
  const p = b - (b - a) * point;
  return rings([[a, t, w], [p, t * 0.85, w * 0.94, 0, -back * w * 0.12], [b, 0.012, 0.012, 0, -back * w * 0.8]], 6, m, { top: false });
}
/** The fuller down each flat of a blade: a groove, painted on. */
const fullerOf = (a: number, b: number, w: number, t: number): Mesh =>
  decals([1, -1].map((s) => plate([s * (t * 0.87 + 0.006), 0, (a + b) / 2], [0, 0, (b - a) / 2], [0, w * 0.16, 0], [s, 0, 0], 'metalDark')));
/** A crossguard across the blade's edges, at `z`, `span` out either side. */
const guardOf = (z: number, span: number, m: Mat = 'fitting'): Mesh => box([-0.13, -span, z - 0.1], [0.13, span, z + 0.1], m);
/** A pommel, a knob on the end of the grip. */
const pommelOf = (z: number, r: number, m: Mat = 'fitting'): Mesh => ball([0, 0, z], [r, r, r * 0.85], 6, 4, m);

/**
 * A scabbard over a blade from `a` to `b`, `w` from its middle to either edge
 * and `t` thick, `cy` off its middle: leather a little bigger round than the
 * blade, narrowing to a metal chape at the tip, with a metal locket at the
 * throat.
 */
function sheathOf(a: number, b: number, w: number, t: number, cy = 0, end = 0.36): Mesh {
  const W = w + 0.1, K = t + 0.1, L = b - a;
  return join(
    rings([[a, K, W, 0, cy], [b - L * 0.16, K * 0.94, W * 0.9, 0, cy], [b + 0.16, K * 0.55, W * end, 0, cy * (end > 0.5 ? 1 : 0.5)]], 6, (band) => (band === 1 ? 'fitting' : 'leatherDark'), { top: false }),
    rings([[a - 0.05, K + 0.05, W + 0.05, 0, cy], [a + Math.min(0.5, L * 0.13), K + 0.05, W + 0.05, 0, cy]], 6, 'fitting'),
  );
}

/**
 * A weapon with a blade that goes into a scabbard: the hilt is what shows out of it, the blade what goes in, and the scabbard is cut
 * to the blade `fits` [root, point, half-width, thickness, off-middle, how wide its end is as a share of its mouth].
 */
const bladed = (w: Omit<Weapon, 'head' | 'sheath'> & { hilt: Mesh; blade: Mesh; fits: [number, number, number, number, number?, number?] }): Weapon =>
  ({ ...w, head: join(w.hilt, w.blade), sheath: sheathOf(...w.fits), throat: w.fits[0] });

const WEAPONS: Record<string, () => Weapon> = {
  // Knives: a hunting knife with its point swept up to the back, a butcher's cleaver of a blade, a long thin carving blade.
  hunting_knife: () => bladed({
    carry: 'fist', stow: 'hip', from: -0.7, to: 2.6,
    grip: rod(-0.55, 0.52, 0.16, 0.14, 'grip', 6),
    hilt: join(pommelOf(-0.62, 0.18), guardOf(0.6, 0.32)),
    blade: bladeOf(0.66, 2.6, 0.24, 0.065, 0.38, 'blade', 1.3), fits: [0.66, 2.6, 0.24, 0.065],
  }),
  butchering_knife: () => bladed({
    carry: 'fist', stow: 'hip', from: -0.7, to: 2.9,
    grip: rod(-0.55, 0.55, 0.16, 0.16, 'woodDark', 6),
    hilt: rings([[0.55, 0.17, 0.21], [0.68, 0.18, 0.22]], 6, 'fitting'),
    // A cleaver: a square slab of a blade, deep and straight-backed, for going through a joint.
    blade: box([-0.06, -0.2, 0.68], [0.06, 0.82, 2.9], 'blade'),
    // Its sheath as broad as the blade to the end, and square there, where a pointed one is any knife's.
    fits: [0.68, 2.9, 0.6, 0.06, 0.31, 0.9],
  }),
  carving_knife: () => bladed({
    carry: 'fist', stow: 'hip', from: -0.65, to: 4.0,
    grip: rod(-0.55, 0.52, 0.14, 0.14, 'grip', 6),
    hilt: join(rings([[0.52, 0.16, 0.18], [0.66, 0.13, 0.16]], 6, 'fitting'), box([-0.07, -0.08, 0.56], [0.07, 0.42, 0.68], 'fitting')),
    // Long and narrowing all the way from a deep heel to a needle of a point, for slicing, its edge ground bright.
    blade: slab([[-0.08, 0.66, 0.05], [0.26, 0.66, 0.05], [0.22, 1.9, 0.045], [0.13, 3.1, 0.035], [-0.02, 4.0, 0.01], [-0.07, 3.2, 0.03], [-0.09, 1.9, 0.045]], 'blade', 'metalLit', 0.1),
    fits: [0.66, 4.0, 0.2, 0.05, 0.08],
  }),
  // A short broad leaf of a blade, widest below its middle, with a round guard and a round pommel: a stabbing sword, not a small sword.
  short_sword: () => bladed({
    carry: 'fist', stow: 'hip', from: -0.8, to: 5.4,
    grip: rod(-0.52, 0.52, 0.16, 0.15, 'grip', 6),
    hilt: join(pommelOf(-0.7, 0.3), rings([[0.44, 0.22, 0.78], [0.7, 0.22, 0.78]], 8, 'fitting')),
    blade: rings([[0.7, 0.1, 0.36], [2.5, 0.12, 0.54], [4.1, 0.1, 0.4], [5.4, 0.012, 0.012]], 6, 'blade', { top: false }),
    fits: [0.7, 5.4, 0.54, 0.12],
  }),
  sword: () => bladed({
    carry: 'fist', stow: 'hip', from: -0.9, to: 7.6,
    grip: rod(-0.55, 0.55, 0.16, 0.15, 'grip', 6),
    // A wheel pommel, and a guard with its ends turned toward the point.
    hilt: join(
      rings([[-1.0, 0.32, 0.4], [-0.6, 0.32, 0.4]], 6, 'fitting'),
      box([-0.15, -1.05, 0.56], [0.15, 1.05, 0.78], 'fitting'), box([-0.12, -1.16, 0.7], [0.12, -0.88, 0.98], 'fitting'), box([-0.12, 0.88, 0.7], [0.12, 1.16, 0.98], 'fitting'),
    ),
    blade: join(bladeOf(0.76, 7.6, 0.42, 0.12, 0.18), fullerOf(1.0, 5.6, 0.42, 0.12)), fits: [0.76, 7.6, 0.42, 0.12],
  }),
  // Two-handed: a long grip, a long guard, and a blade to match, carried on the shoulder.
  long_sword: () => bladed({
    carry: 'shoulder', stow: 'back', from: -1.7, to: 10.6, fist: -0.2, reach: 3.1, tilt: 70, out: 28, spin: 90, slant: 42,
    // From behind: straight up off the shoulder and a little forward three-quarters away, and back at a slant square behind.
    stage: { 0: [1, 16, 0], 2: [0.85, 0, 0, 0.8], 3: [0.4, 14, 0], 4: [0.35, 25, 0], 5: [0.4, 14, 0], 6: [0.85, 0, 0, 0.8] },
    grip: shaft([[-1.3, 0.17], [0.62, 0.16]], 'grip', 6),
    hilt: join(pommelOf(-1.48, 0.27), guardOf(0.7, 1.25), box([-0.16, -0.3, 0.6], [0.16, 0.3, 0.98], 'fitting')),
    blade: join(
      rings([[0.8, 0.095, 0.44], [2.4, 0.093, 0.43], [8.6, 0.08, 0.4], [10.6, 0.012, 0.012]], 6, 'blade', { top: false }),
      fullerOf(1.05, 8.0, 0.44, 0.095),
    ),
    fits: [0.8, 10.6, 0.44, 0.095],
  }),
  // Axes: a bearded hatchet, a francisca swept up at the bit, and a battle axe with a long crescent of an edge and a spike behind.
  hatchet: () => ({
    carry: 'fist', stow: 'belt', headUp: true, from: -1.2, to: 3.9, belt: 1.95,
    grip: rod(-1.1, 0.6, 0.16, 0.15, 'wood', 5),
    // A bearded bit, narrow at the eye and dropping to a beard below a straight top, and a hammer's poll behind it for driving pegs
    // and wedges: an axe's head, where a square one is a cleaver's.
    head: join(
      rod(0.6, 3.55, 0.15, 0.14, 'wood', 5),
      slab([
        [-0.3, 2.9, 0.26], [0.3, 2.9, 0.26], [0.9, 2.74, 0.14], [1.5, 2.26, 0.06], [1.8, 2.04, 0.03], [1.98, 2.2, 0.03],
        [2.04, 3.0, 0.03], [1.96, 3.66, 0.03], [1.2, 3.56, 0.08], [0.3, 3.47, 0.26], [-0.3, 3.47, 0.26],
      ], 'metal', 'blade', 1.85),
      box([-0.3, -1.0, 2.9], [0.3, -0.28, 3.47], 'metal', 'metalLit'),
      box([-0.34, -1.12, 2.86], [0.34, -0.96, 3.51], 'metalLit'),
    ),
  }),
  throwing_axe: () => ({
    // Leaning out from the hip through the belt, so its haft shows below the head and it is an axe there, not a flap of blue.
    // In the hand head up and back over the forearm, cocked for the throw, where a hatchet hangs from the fist head down: of a size and a
    // shape, the two are told apart by how they are held.
    carry: 'fist', stow: 'belt', headUp: true, from: -0.9, to: 3.7, belt: 1.5, splay: [0.34, 0.3], down: -58,
    grip: rod(-0.8, 0.5, 0.14, 0.13, 'woodDark', 5),
    // A francisca: a short dark haft bound in leather and bowed toward the bit, and a narrow head that sweeps up in an S from the
    // haft to a long upper horn standing well above the end of it.
    head: join(
      chain([[0, 0, 0.5], [0, 0.1, 1.3], [0, 0.08, 2.2]], [0.13, 0.12, 0.12], 5, 'woodDark'),
      rings([[-0.3, 0.16, 0.16], [0.1, 0.16, 0.16]], 5, 'leather'),
      slab([[-0.24, 1.86, 0.15], [0.22, 1.82, 0.15], [0.8, 1.68, 0.08], [1.3, 1.52, 0.05], [1.72, 1.6, 0.03], [1.98, 2.25, 0.03], [2.18, 3.05, 0.03], [2.3, 3.7, 0.03], [1.86, 3.3, 0.04], [1.2, 2.66, 0.06], [0.6, 2.36, 0.1], [0.22, 2.3, 0.15], [-0.24, 2.3, 0.15]], 'metal', 'blade', 1.7),
    ),
  }),
  battle_axe: () => ({
    carry: 'shoulder', stow: 'back', headUp: true, from: -4.2, to: 6.8, fist: -3.3, reach: 2.8, tilt: 34, out: 64, spin: 150, slant: 38,
    // Three-quarters away, all but upright with the bit turned to the viewer, where lying back it would be edge on beside the cheek;
    // side on, lying further back, so the haft goes over the shoulder below the jaw rather than across the throat; from behind,
    // standing up out from the shoulder, where lying back it points at the viewer and the bit sits on the shoulder with no haft.
    stage: { 2: [1, -40, 0, 0.8], 3: [1.6, -44, 0], 4: [0.7, -16, 0], 5: [1.6, -44, 0], 6: [1, -40, 0, 0.8] },
    grip: shaft([[-4.1, 0.19], [-0.7, 0.18], [0.6, 0.175]], 'grip', 5),
    head: join(
      shaft([[0.6, 0.175], [5.9, 0.16]], 'wood', 5),
      rings([[4.1, 0.21, 0.21], [4.35, 0.21, 0.21]], 5, 'metalDark', { top: false, bottom: false }),
      // A bearded bit, its edge a long crescent, and a spike behind.
      slab([[-0.36, 4.45, 0.24], [0.36, 4.4, 0.24], [1.3, 3.75, 0.09], [2.3, 3.05, 0.04], [2.72, 3.9, 0.03], [2.92, 5.0, 0.03], [2.7, 6.1, 0.03], [2.28, 6.75, 0.04], [1.25, 6.1, 0.1], [0.36, 5.6, 0.24], [-0.36, 5.6, 0.24]], 'metal', 'blade', 2.6),
      slab([[-0.36, 4.7, 0.18], [-1.6, 5.02, 0.05], [-0.36, 5.35, 0.18]], 'metalDark'),
    ),
  }),
  club: () => ({
    // Through the belt head up, caught at the swell under its knob so the knob stands on the hip rather than up under the arm, where
    // the arm hides all but a stick of it; hung the other way it is a bag.
    carry: 'fist', stow: 'belt', headUp: true, from: -0.9, to: 4.4, belt: 2.0, splay: [0.42, 0.34],
    grip: rod(-0.85, 0.6, 0.19, 0.21, 'woodDark', 6),
    // Swelling from the grip to the knob of the root it was cut from, dark with handling, bound in two bands of iron and studded.
    head: join(
      worn(rings([[0.6, 0.21, 0.21], [2.4, 0.4, 0.38], [3.7, 0.58, 0.55], [4.4, 0.36, 0.34]], 6, 'woodDark'), 'grain'),
      rings([[2.55, 0.46, 0.44], [2.8, 0.49, 0.47]], 6, 'metalDark', { top: false, bottom: false }),
      rings([[3.85, 0.58, 0.55], [4.1, 0.52, 0.5]], 6, 'metalDark', { top: false, bottom: false }),
      ...[0, 1, 2, 3, 4, 5].map((k) => { const a = ((k + 0.5) / 6) * TAU; return ball([Math.cos(a) * 0.56, Math.sin(a) * 0.53, 3.3], [0.1, 0.1, 0.1], 4, 3, 'rivet'); }),
    ),
  }),
  maul: () => ({
    // Slung head up, as a hammer is carried: head down on the back it is a spade, and at the hip a satchel.
    carry: 'shoulder', stow: 'back', headUp: true, from: -4.3, to: 5.9, fist: -3.4, reach: 2.8, tilt: 40, out: 64, spin: 90, slant: 36,
    stage: { 2: [1, -40, 0, 0.8], 3: [1.6, -44, 0], 4: [0.7, -16, 0], 5: [1.6, -44, 0], 6: [1, -40, 0, 0.8] },
    grip: shaft([[-4.2, 0.19], [-0.8, 0.18], [0.6, 0.175]], 'grip', 5),
    head: join(
      shaft([[0.6, 0.175], [4.9, 0.17]], 'wood', 5),
      // The head: a block of iron bound at either end, its striking faces bright.
      box([-0.66, -1.35, 4.25], [0.66, 1.35, 5.85], 'metal', 'metalLit'),
      box([-0.72, -1.47, 4.18], [0.72, -1.3, 5.92], 'metalLit'), box([-0.72, 1.3, 4.18], [0.72, 1.47, 5.92], 'metalLit'),
      box([-0.72, -0.9, 4.18], [0.72, -0.72, 5.92], 'metalDark'), box([-0.72, 0.72, 4.18], [0.72, 0.9, 5.92], 'metalDark'),
    ),
  }),
  spear: () => ({
    carry: 'staff', stow: 'back', headUp: true, from: -4.4, to: 14.4, lean: 7, slant: 58,
    grip: rod(-0.6, 0.6, 0.15, 0.15, 'grip', 5),
    head: join(
      rod(-4.2, -0.6, 0.13, 0.14, 'wood', 5), rod(0.6, 12.2, 0.14, 0.13, 'wood', 5),
      rings([[-4.4, 0.08, 0.08], [-4.05, 0.15, 0.15]], 5, 'metal'),
      rings([[11.9, 0.16, 0.16], [12.55, 0.13, 0.13]], 5, 'metal'),
      // A leaf-shaped head.
      rings([[12.55, 0.08, 0.16], [13.3, 0.07, 0.46], [14.4, 0.012, 0.012]], 6, 'blade', { top: false }),
    ),
  }),
  javelin: () => ({
    carry: 'staff', stow: 'back', headUp: true, from: -2.6, to: 10.8, lean: 22, slant: 48,
    grip: rod(-0.5, 0.5, 0.13, 0.13, 'grip', 5),
    head: join(
      rod(-2.6, -0.5, 0.1, 0.11, 'wood', 5), rod(0.5, 9.2, 0.11, 0.1, 'wood', 5),
      // Two pale vanes across each other at the butt, which is what says it is thrown: narrow, as a dart's are, or slung on the back
      // the four fins of them from behind are a broom head.
      ...[0, 90].map((a) => spun(slab([[-0.3, -2.6, 0.015], [0.3, -2.6, 0.015], [0.2, -1.2, 0.015], [-0.2, -1.2, 0.015]], 'fletch'), a)),
      rings([[9.1, 0.13, 0.13], [9.5, 0.1, 0.1]], 5, 'metal'),
      // A long thin head, for going in rather than cutting.
      rings([[9.5, 0.07, 0.11], [10.0, 0.06, 0.24], [10.8, 0.012, 0.012]], 6, 'blade', { top: false }),
    ),
  }),
  // Staves in the darker heart of the wood, so a bow seen edge on is still a line against the grass.
  short_bow: () => bowOf(11, 1.35, 'woodDark', 'deep'),
  medium_bow: () => bowOf(14, 1.0, 'woodDark', 'flat'),
  long_bow: () => bowOf(18, 0.9, 'woodDark', 'long'),
  composite_bow: () => bowOf(12, 0.95, 'leatherDark', 'recurve'),
};

/**
 * A bow `L` long, standing along z, bellied `c` forward of its string at the
 * grip, in `m`, with the limbs of its kind, which are what tell one bow from
 * another at a glance: `deep`, a hunter's short bow bent into a round D in
 * thick round limbs; `flat`, limbs wider than they are thick, broadest a
 * third of the way out and narrowing to the handle and the tips; `long`,
 * tall and slender, tipped in pale horn; and `recurve`, the horseman's
 * shape, its tips turned forward again past where the string meets them, in
 * bone, with the string bearing on the limb where the turn begins.
 */
function bowOf(L: number, c: number, m: Mat, limbs: 'deep' | 'flat' | 'long' | 'recurve'): Weapon {
  const h = L / 2;
  const EAR = 0.78;
  const recurve = limbs === 'recurve';
  const at = (u: number): V3 => {
    // u from -1 at the lower tip to 1 at the upper: a bow bent into a flat arc, and a recurve's ears flicked forward.
    const a = Math.abs(u);
    const y = c * (1 - u * u) + (recurve && a > EAR ? Math.pow((a - EAR) / (1 - EAR), 1.3) * 1.05 * c : 0);
    return [0, y, u * h];
  };
  const [r0, r1] = limbs === 'deep' ? [0.11, 0.1] : limbs === 'long' ? [0.075, 0.07] : [0.09, 0.08];
  const r = (x: number): number => r0 + r1 * (1 - Math.abs(x));
  // A flat bow's limb spread across the bow (along x) and thinned from belly to back, most a third of the way out from the handle.
  const flat = (me: Mesh): Mesh => ({
    ...me,
    v: me.v.map(([x, y, z]): V3 => {
      const a = Math.min(1, Math.abs(z) / h);
      const k = a < 0.12 ? 1 : a < 0.35 ? 1 + (1.5 * (a - 0.12)) / 0.23 : 2.5 - (1.4 * (a - 0.35)) / 0.65;
      const mid = at(z / h)[1];
      return [x * k, mid + (y - mid) * (a < 0.12 ? 1 : 0.7), z];
    }),
  });
  const limb = (u: number[], mat: Mat): Mesh => {
    const me = chain(u.map(at), u.map(r), 5, mat, false);
    return limbs === 'flat' ? flat(me) : me;
  };
  // Slung across the back flatter the longer it is, so a long bow's lower tip stays off the ground while its upper one stops at the ear.
  const bow = { carry: 'bow' as const, stow: 'back' as const, headUp: true, from: -h, to: h, slant: L > 13 ? 56 : 40 };
  if (!recurve) {
    const us = [-1, -0.82, -0.6, -0.34, -0.12, 0.12, 0.34, 0.6, 0.82, 1];
    // A long bow's nocks in horn, pale at both ends of it; the others' cut in the stave.
    const nock = (u: number): Mesh => (limbs === 'long' ? ball(at(u), [0.11, 0.11, 0.26], 5, 3, 'fletch') : ball(at(u), [0.1, 0.1, 0.14], 5, 3, 'woodDark'));
    return {
      ...bow,
      grip: chain([at(-0.12), at(0.12)], [0.19, 0.19], 6, 'grip'),
      head: join(
        limb(us.slice(0, 5), m), limb(us.slice(5), m),
        nock(-1), nock(1),
        fine(chain([at(-0.985), at(0.985)], [0.05, 0.05], 4, 'string'), 0.1),
      ),
    };
  }
  const inner = [0.14, 0.4, 0.62, EAR], ear = [EAR, 0.9, 1];
  const side = (s: number, us: number[]): number[] => us.map((u) => u * s);
  return {
    ...bow,
    grip: join(chain([at(-0.14), at(0.14)], [0.2, 0.2], 6, 'grip'), ...[-0.15, 0.15].map((u) => chain([at(u - 0.02), at(u + 0.02)], [0.22, 0.22], 6, 'fitting'))),
    head: join(
      limb(side(-1, inner).reverse(), m), limb(side(1, inner), m),
      limb(side(-1, ear).reverse(), 'lace'), limb(side(1, ear), 'lace'),
      fine(chain([at(-EAR), at(EAR)], [0.05, 0.05], 4, 'string'), 0.1),
    ),
  };
}

const weapons = new Map<string, Weapon | null>();
function weaponOf(id: string): Weapon | null {
  let h = weapons.get(id);
  if (h === undefined) {
    const make = WEAPONS[id];
    h = make ? make() : null;
    weapons.set(id, h);
  }
  return h;
}

/** A blade put away at the hip that reaches no further than this from the fist is a knife, and goes upright at the front of the belt. */
const KNIFE_TO = 4.5;

/**
 * How a weapon is carried in the hands and where it goes when they are wanted, as it is drawn -- `front` for a knife at the front of
 * the belt -- and nothing for one that is not drawn.
 */
export function weaponCarry(id: string): { carry: Weapon['carry']; stow: Weapon['stow']; front: boolean; headUp: boolean } | null {
  const w = weaponOf(id);
  return w && { carry: w.carry, stow: w.stow, front: w.stow === 'hip' && w.to < KNIFE_TO, headUp: !!w.headUp };
}

/**
 * A mesh cut in two across its own z at `z`: what is below, and what is
 * above. A facet that crosses is cut along the line, and the rim the cut
 * leaves either side is not inked, so the two drawn one after the other are
 * the one thing -- a haft in front of a shoulder and behind it.
 */
function cutAcross(m: Mesh, z: number): [Mesh, Mesh] {
  const halves = [0, 1].map(() => ({ v: [] as V3[], f: [] as Face[], at: new Map<string, number>() }));
  const vert = (h: (typeof halves)[number], key: string, p: V3): number => {
    let i = h.at.get(key);
    if (i === undefined) {
      i = h.v.length;
      h.v.push(p);
      h.at.set(key, i);
    }
    return i;
  };
  for (const face of m.f) {
    const zs = face.i.map((i) => m.v[i][2]);
    const lo = Math.min(...zs), hi = Math.max(...zs);
    if (hi <= z || lo >= z) {
      const h = halves[hi <= z ? 0 : 1];
      h.f.push({ ...face, i: face.i.map((i) => vert(h, `${i}`, m.v[i])) });
      continue;
    }
    halves.forEach((h, side) => {
      const keep = (i: number): boolean => (side ? m.v[i][2] >= z : m.v[i][2] <= z);
      const idx: number[] = [];
      face.i.forEach((a, k) => {
        const c = face.i[(k + 1) % face.i.length];
        if (keep(a)) idx.push(vert(h, `${a}`, m.v[a]));
        if (keep(a) !== keep(c)) {
          const pa = m.v[a], pc = m.v[c], t = (z - pa[2]) / (pc[2] - pa[2]);
          idx.push(vert(h, a < c ? `${a}-${c}` : `${c}-${a}`, [pa[0] + (pc[0] - pa[0]) * t, pa[1] + (pc[1] - pa[1]) * t, z]));
        }
      });
      if (idx.length >= 3) h.f.push({ ...face, i: idx, soft: true });
    });
  }
  return [mesh(halves[0].v, halves[0].f), mesh(halves[1].v, halves[1].f)];
}


/**
 * Hair cut off level with a hat's rim, which runs from `f` over the brow down
 * to `b` at the nape: what is left of it under the brim. The rim is a plane
 * tipped from front to back; the hair is sheared until it lies level, cut
 * across, and sheared back, so the cut runs along the rim however far the
 * hat is tipped. Kept for each haircut and rim, as it is the same every frame.
 */
const trims = new WeakMap<Mesh, Map<string, Mesh>>();
function trimmed(m: Mesh, fr: Frame, rim: { f: number; b: number }, taper = false, fall = false, nape = false): Mesh {
  let byRim = trims.get(m);
  if (!byRim) trims.set(m, (byRim = new Map()));
  const key = `${rim.f},${rim.b},${taper},${fall},${nape}`;
  let t = byRim.get(key);
  if (!t) {
    // The rim's middle over the brow and at the nape, as the head is grown, as the hair is.
    const [, fy, fc] = skull(fr, rim.f), [, by, bc] = skull(fr, rim.b);
    const F = bigger([0, fc + fy, rim.f]), B = bigger([0, bc - by, rim.b]);
    const s = (F[2] - B[2]) / (F[1] - B[1]);
    const level: Mesh = { ...m, v: m.v.map(([x, y, z]): V3 => [x, y, z - s * (y - F[1])]) };
    let [below] = cutAcross(level, F[2]);
    // `nape`: hair on the head with none falling from it cut off under the back of the rim as well, along a line from just under
    // the rim at the nape down and forward to under the ears, so that what is left of it is the hair in front of the ears and none
    // behind: left, it was a dark tab standing out under the back of every cap, the edge of the hair's thickness cut off square.
    // Hair that falls down the back goes on from under the rim, and is left to.
    if (nape) {
      const N = B[2] - 0.05, up = NAPE_CUT / B[1];
      const back = (p: V3): number => -s * (p[1] - F[1]) + up * (p[1] - B[1]);
      const tipped: Mesh = { ...below, v: below.v.map((p): V3 => [p[0], p[1], p[2] - back(p)]) };
      const [, kept] = cutAcross(tipped, N);
      below = { ...kept, v: kept.v.map((p): V3 => [p[0], p[1], p[2] + back(p)]) };
    }
    // Hair falling from under it drawn in toward the nape where it comes out, rather than standing out square at either side of
    // the rim: what it is cut off at is the cap's edge, and hair does not stop there in a shelf. Hair falling down the back further,
    // to the width of the neck it comes out over, and from there one curtain, as it is with nothing on the head.
    const TAPER = 2.6, IN = fall ? 0.5 : 0.36;
    t = {
      ...below,
      v: below.v.map(([x, y, z]): V3 => {
        const u = taper ? Math.max(0, 1 - (F[2] - z) / TAPER) : 0;
        return [x * (1 - IN * u * u), y, z + s * (y - F[1])];
      }),
    };
    byRim.set(key, t);
  }
  return t;
}

/** How far under the rim at the nape the line the hair is cut along at the back (`trimmed`) comes down by the time it is under the ears. */
const NAPE_CUT = 0.75;

/** What of a shouldered weapon is in front of the shoulder, from its butt up, and what is behind it; its whole, and a blade in its scabbard. */
const cuts = new WeakMap<Weapon, { fore: Mesh; aft: Mesh; whole: Mesh; sheathed?: Mesh }>();
function cutsOf(w: Weapon): { fore: Mesh; aft: Mesh; whole: Mesh; sheathed?: Mesh } {
  let c = cuts.get(w);
  if (!c) {
    const whole = join(w.grip, w.head);
    const [fore, aft] = cutAcross(whole, (w.fist ?? 0) + (w.reach ?? 2.7));
    c = { fore, aft, whole, sheathed: w.sheath && w.hilt && join(w.grip, w.hilt, w.sheath) };
    cuts.set(w, c);
  }
  return c;
}


/**
 * The left arm holding a bow upright at its side, the hand raised as far as
 * the bow's length needs for its lower tip to clear the ground by a margin --
 * a short bow hangs at arm's length, a long bow is held up at the hip -- and
 * kept there through a stride, as a bow is carried.
 */
function bowArm(r: Rig, fr: Frame, w: Weapon, up: number, facing: number): void {
  const T = fr.tall, dir = bowUp(facing);
  // The fist's height over the hips that puts the lower tip over the ground, with a margin -- and more of one seen from behind and
  // the left, where the bow leans toward whoever is looking and its lower tip comes down the screen onto the feet.
  const fist = Math.max(-2.6, -w.from * dir[2] + BOW_CLEAR - HIP * T) + up + byFacing(BOW_LIFT, facing);
  // At a run, further forward seen from in front, where the body leaning into the run comes forward over the bow and hides its
  // lower limb behind the coat.
  const at: V3 = [-2.15 * fr.sh - byFacing(BOW_WIDE, facing), byFacing(BOW_AHEAD, facing) + up * byFacing(BOW_RUN_AHEAD, facing), fist - GRIP];
  hold(r, fr, 0, at, [-0.4, -0.8, -0.4], dir);
}

/**
 * The right arm carrying `w` over the shoulder: the fist low in front of the
 * chest and the shaft from it back up over the top of the shoulder at the
 * weapon's slant, set in the chest's frame so it rides with the shoulders
 * whatever the hips are doing, with the elbow out and down.
 */
function shoulder(r: Rig, fr: Frame, w: Weapon, k: number, facing: number): void {
  const T = fr.tall, s = k ? 1 : -1;
  const chest = joint(joint(ROOT, [0, 0, SPINE * T], ...r.spine), [0, 0, CHEST * T], ...r.chest);
  const [keep, wider, turn, back = 0] = w.stage?.[((Math.round(facing) % 8) + 8) % 8] ?? [1, 0, 0];
  const tilt = (w.tilt ?? 45) * keep * DEG, out = ((w.out ?? 12) + wider) * DEG;
  r.spin = turn;
  // Back from upright by the tilt, and leaning out from the head by `out`, so what is behind the shoulder clears the skull.
  const d = unit([s * Math.sin(out) * Math.cos(tilt), -Math.sin(tilt), Math.cos(out) * Math.cos(tilt)]);
  const top: V3 = [s * 2.0 * fr.sh, -0.1 - back, ARM_AT * T + 0.8];
  const reach = w.reach ?? 2.7;
  const fist = place(chest, [top[0] - d[0] * reach, top[1] - d[1] * reach, top[2] - d[2] * reach]);
  const haft = mv(chest.m, d), pole = mv(chest.m, [s * 0.75, -0.25, -0.62]);
  // The wrist that puts the fist there, found by moving it by however far the fist misses, a few times over.
  let wrist = fist;
  for (let q = 0; q < 3; q++) {
    const at = place(hold(r, fr, k, wrist, pole, haft), [0, 0, GRIP]);
    wrist = [wrist[0] + fist[0] - at[0], wrist[1] + fist[1] - at[1], wrist[2] + fist[2] - at[2]];
  }
  hold(r, fr, k, wrist, pole, haft);
  r.carried = k;
}

/**
 * How far round from pointing forward to pointing out to the right a blade in
 * the fist is turned, in degrees, at each facing. Three-quarters on with the
 * right hand nearest, forward is at the viewer, and three-quarters away with
 * it furthest, forward is behind the body; from behind, forward is away. At
 * each the blade is turned out to where its length shows, and between them
 * it comes round smoothly as the body turns.
 */
const FIST_OUT = [58, 130, 38, 38, 70, 130, 38, 38];
const fistOut = (facing: number): number => byFacing(FIST_OUT, facing);
/** How far down from level a blade in the fist points, and how much of the arm's swing it takes, in degrees and as a share. */
const FIST_DOWN = 30, FIST_SWING = 0.4;
/** How much nearer level than `FIST_DOWN` a blade is carried at a run, in degrees. */
const FIST_RUN = 16;

/** A value given for each of the eight facings, at `facing` as drawn: eased from one to the next as the body comes round. */
function byFacing(table: number[], facing: number): number {
  const f = ((facing % 8) + 8) % 8, i = Math.floor(f), u = f - i;
  return table[i % 8] + (table[(i + 1) % 8] - table[i % 8]) * u * u * (3 - 2 * u);
}

/**
 * Which way a bow in the left fist stands, in the hips' frame, at each
 * facing: all but upright, out from the body a little, and its top leaning
 * forward -- except side on and three-quarters away to the right, and
 * three-quarters on to the left, where forward is across the head on the
 * screen, and it leans back instead.
 */
const BOW_FWD = [6, 6, -22, -16, 6, 6, 20, -4];
/** How far over the soles a bow's lower tip is held, so it clears the boots and the stride rather than standing on them. */
const BOW_CLEAR = 1.8;
/**
 * How far forward of the hip a bow is held at each facing: further out in front seen from the left, where the bow's side is toward
 * whoever is looking and an upright bow at the hip stands up across the face.
 */
const BOW_AHEAD = [0.45, 0.45, 0.45, -0.3, -0.35, 0.8, 1.7, 0.2];
/** And how much further out to the left than the hip: three-quarters on from the left, the width is what takes it off the face. */
const BOW_WIDE = [0.6, 0.5, 0, 1.3, 1.0, 0, 0.3, 2.6];
/** How much further forward a bow is held at a run, at each facing, for each unit it is lifted: see `bowArm`. */
const BOW_RUN_AHEAD = [0.7, 0.7, 0.3, 0, 0, 0, 0.3, 0.7];
/** How much higher again a bow is held at each facing: see `bowArm`. */
const BOW_LIFT = [0, 0, 0, 0, 0.3, 0.9, 1.2, 0.9];
/**
 * How far out from the body the top of a bow leans at each facing: out past the head from in front, where upright it would stand
 * up across the cheek, and all but upright elsewhere, where out would bring its lower tip in under the stride.
 */
const BOW_OUT = [12, 12, -4, -4, -4, -4, -4, 12];
/**
 * How far a bow is turned about its stave at each facing, its bend swung from straight ahead toward the body's left: seen from in
 * front or behind, a bow bent straight ahead is its edge, a line.
 */
const BOW_TURN = [40, 0, 0, 30, 40, 0, 0, 20];
const bowUp = (facing: number): V3 => {
  const fwd = byFacing(BOW_FWD, facing) * DEG, out = byFacing(BOW_OUT, facing) * DEG;
  return unit([-Math.sin(out), Math.sin(fwd), Math.cos(out) * Math.cos(fwd)]);
};
/**
 * And a spear or a javelin upright in the right fist: leaning forward and out
 * past the face -- except three-quarters on to the right and three-quarters
 * away to the left, where the fist is in line with the head on the screen and
 * the shaft leans back and out instead, clear of it.
 */
const STAFF_BACK = [0, 1, 0, 0, 0, 1, 0, 0];
const STAFF_BACK_BY = -8;
const STAFF_OUT = [10, 22, 10, 10, 10, 22, 10, 10];
/** And side on to the left, where the shaft in the far hand stands in front of the face, leaning forward at least this far, clear of it. */
const STAFF_LEAST = [0, 0, 22, 0, 0, 0, 22, 0];
const staffUp = (facing: number, lean: number): V3 => {
  const back = byFacing(STAFF_BACK, facing);
  const ahead = Math.max(lean, byFacing(STAFF_LEAST, facing));
  const fwd = (ahead + (STAFF_BACK_BY - ahead) * back) * DEG, out = byFacing(STAFF_OUT, facing) * DEG;
  return unit([Math.sin(out), Math.sin(fwd), Math.cos(out) * Math.cos(fwd)]);
};

/**
 * Which shoulder whatever is slung on the back goes up over, at each facing:
 * the left, along the strap and away from the right hand and whatever it
 * works with -- save side on to the left, where the left is the near
 * shoulder and anything going up over it comes toward whoever is looking,
 * end on and lost against the back. At work where the work is done
 * left-handed (see `lefty`), the whole body is the mirror of itself, and
 * what is on its back is mirrored with it, strap and all: over the left
 * shoulder there, a spear's point stands up beside the raised mallet, and
 * three-quarters on from the left what hangs to the right hip is behind the
 * body.
 *
 * Something long, a spear, a javelin, a bow or a long sword in its
 * scabbard, shows past the head or below the hips wherever it is seen. A
 * head that stops at the ear, an axe's or a maul's, is lost behind the head
 * over the far shoulder three-quarters on or away, and there it goes up over
 * the near one, where it stands out past the shoulder. Staged for the
 * camera, as a wave is.
 */
const SLUNG_LEFT = [1, 1, 1, 1, 1, 1, 0, 1];
const SLUNG_LEFT_HEAD = [1, 0, 1, 0, 1, 1, 0, 1];
/**
 * How far each is turned about itself at each facing, over the right
 * shoulder (and the mirror of it over the left): an axe's bit turned to show
 * its face, standing off behind the haft, rather than its edge; and a bow,
 * side on, turned back off the body to show the bend of it.
 */
const SLUNG_HEAD_TURN = [0, -38, -90, 45, 0, 45, -90, -38];
const SLUNG_BOW_TURN = [0, 0, -50, 0, 0, 0, -50, 0];

/**
 * Whether something heavy goes over the left shoulder from where it is seen:
 * turned three-quarters away to the left, or side on to the left, the right
 * shoulder is the far one, and whatever lies back over it is behind the head
 * however it is angled. Staged for the camera, as a wave is.
 */
const overLeft = (facing: number): boolean => {
  const f = ((Math.round(facing) % 8) + 8) % 8;
  return f === 3 || f === 6 || f === 7;
};

/**
 * The shields, in their own frame: the face toward +z, up toward +y. A
 * dyed one is painted: the planks of a wooden one, the field inside the rim
 * of a metal one.
 */
const SHIELD: Record<string, (dyed: boolean) => Mesh> = {
  wooden_shield: (dyed) => {
    const R = 2.5, n = 12;
    const face: Mat = dyed ? 'cloth' : 'wood';
    // The rim bound in iron, the planks across it, and the boss over the grip.
    const disc = rings([[-0.12, R, R], [0.12, R, R]], n, (band) => (band === 1 ? face : 'woodDark'));
    // The rim bound in dark rawhide standing proud of the boards either side, so edge on the shield is a straight band and not a
    // strand, and face on a dark ring round the boards, which are the colour of a hide coat behind them without it.
    const rim = rings([[-0.26, R + 0.12, R + 0.12], [0.27, R + 0.12, R + 0.12]], n, 'grip', { top: false, bottom: false });
    const seams = decals([-1.25, 0, 1.25].map((x) => {
      const half = Math.sqrt(Math.max(0, R * R - x * x)) * 0.97;
      return plate([x, 0, 0.125], [0.04, 0, 0], [0, half, 0], [0, 0, 1], dyed ? 'clothDark' : 'woodDark');
    }));
    const rivets = decals(Array.from({ length: 8 }, (_, k) => {
      const a = (k / 8) * TAU + 0.2;
      return plate([Math.cos(a) * (R - 0.25), Math.sin(a) * (R - 0.25), 0.126], [0.09, 0, 0], [0, 0.09, 0], [0, 0, 1], 'rivet');
    }));
    // One dome, rather than a ring and a dome whose outlines, a little apart, drew a star round the middle.
    const boss = join(rings([[0.1, 0.74, 0.74], [0.28, 0.72, 0.72]], 8, 'metal', { bottom: false, top: false }), ball([0, 0, 0.28], [0.72, 0.72, 0.42], 8, 3, 'metalLit'));
    return join(disc, rim, seams, rivets, boss);
  },
  metal_shield: (dyed) => {
    // A heater: flat along the top, curved down each side to a point, bent back a little either side of its middle.
    const outline: Pt[] = [[-1.75, 2.3], [0, 2.3], [1.75, 2.3], [1.8, 0.6], [1.45, -0.9], [0.8, -2.1], [0, -2.9], [-0.8, -2.1], [-1.45, -0.9], [-1.8, 0.6]];
    const bend = (x: number): number => -Math.abs(x) * 0.22;
    const n = outline.length;
    // Thick enough edge on to be a band rather than a hairline.
    const T = 0.16;
    const v: V3[] = [...outline.map(([x, y]): V3 => [x, y, bend(x) + T]), ...outline.map(([x, y]): V3 => [x, y, bend(x) - T])];
    // The face as two halves, right and left of the middle, so the bend shows in the light; boarded behind in wood.
    const right = [1, 2, 3, 4, 5, 6], left = [6, 7, 8, 9, 0, 1];
    const f: Face[] = [
      faceOut(v, right, [0, 0, 1], 'metalLit'), faceOut(v, left, [0, 0, 1], 'metalLit'),
      faceOut(v, right.map((i) => n + i), [0, 0, -1], 'wood'), faceOut(v, left.map((i) => n + i), [0, 0, -1], 'wood'),
    ];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = outline[j][0] - outline[i][0], ey = outline[j][1] - outline[i][1];
      f.push(faceOut(v, [i, j, n + j, n + i], [ey, -ex, 0], 'metal'));
    }
    // The field inside the rim, painted when dyed, and a boss on the middle.
    const inset = (i: number): V3 => {
      const [x, y] = outline[i];
      return [x * 0.84, y * 0.84 - 0.05, bend(x * 0.84) + T + 0.005];
    };
    const field: Mat = dyed ? 'cloth' : 'metal';
    const paint = decals([right, left].map((idx) => {
      const q = idx.map(inset);
      return { q: newell(q)[2] < 0 ? q.reverse() : q, m: field };
    }));
    // A pale down the middle in brass, the one device on it, and a boss over the grip.
    const pale = decals([plate([0, -0.25, bend(0) + T + 0.012], [0.3, 0, 0], [0, 2.35, 0], [0, 0, 1], 'fitting')]);
    const boss = ball([0, 0.2, T + 0.08], [0.62, 0.62, 0.36], 8, 4, 'metalLit');
    return join(mesh(v, f), paint, pale, boss);
  },
};
const shields = new Map<string, Mesh | null>();
function shieldOf(id: string, dyed: boolean): Mesh | null {
  const key = `${id}|${dyed}`;
  let m = shields.get(key);
  if (m === undefined) {
    const make = SHIELD[id];
    m = make ? make(dyed) : null;
    shields.set(key, m);
  }
  return m;
}

/** A frame at `at` on a bone, its z along `dir` and its x as near `out` as square to that allows. */
function aimed(bone: Xf, at: V3, dir: V3, out: V3): Xf {
  const z = unit(dir);
  const d = dot(out, z);
  const x = unit([out[0] - z[0] * d, out[1] - z[1] * d, out[2] - z[2] * d]);
  const y = cross(z, x);
  return { m: mm(bone.m, [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]), t: place(bone, at) };
}

/**
 * A weapon in the fist as the forearm carries it, `w` of the way from where the carry `xf` set it: its point
 * ahead of the knuckles and a little down the arm, as a sword is held out at the end of a blow, and its flat
 * square to the forearm. In the body's frame, from the fist.
 */
function wielded(xf: Xf, wrist: Xf, fist: V3, w: number): Xf {
  const n = (v: V3): V3 => unit(v);
  const mix = (a: V3, b: V3): V3 => n([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]);
  const col = (m: M3, i: number): V3 => [m[i], m[3 + i], m[6 + i]];
  const dir = mix(col(xf.m, 2), n(mv(wrist.m, [0, 0.87, -0.5])));
  const out = mix(col(xf.m, 0), n(mv(wrist.m, [1, 0, 0])));
  return { m: aimed(ROOT, [0, 0, 0], dir, out).m, t: fist };
}

/** A frame turned by a matrix, whose columns are where its x, y and z go, at `at`. */
const framed = (bone: Xf, at: V3, x: V3, y: V3, z: V3): Xf => ({ m: mm(bone.m, [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]), t: place(bone, at) });

/**
 * A strap over the left shoulder and down across the chest to under the
 * right arm, and back up across the back: what anything slung on the back
 * hangs from. `g` out round the chest, over whatever is worn on it. The
 * front and the back of it, each a band lying on the surface, in the chest's
 * frame.
 */
const straps = new Map<string, [Mesh, Mesh]>();
function strapOf(fr: Frame, g: number): [Mesh, Mesh] {
  const key = `${fr.sh}|${fr.wa}|${fr.fem}|${g}`;
  let st = straps.get(key);
  if (st) return st;
  const b = buildOf(fr);
  const rs = chestRings(b, g);
  const z0 = rs[0][0], z1 = rs[rs.length - 1][0];
  const ring = (z: number): number[] => profileAt(rs, Math.max(0, Math.min(1, (z - z0) / (z1 - z0))));
  const HW = 0.21, N = 8;
  const side = (s: number): Mesh => {
    // From the top of the left shoulder, where front and back meet, down and across to the right side under the arm.
    const pts: V3[] = [], out: V3[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const z = 2.3 + (0.15 - 2.3) * u;
      const [, rxx, ryy, cx, cy] = ring(Math.min(z, z1));
      const x = (-0.93 + 1.93 * u) * rxx;
      const q = Math.sqrt(Math.max(0, 1 - Math.pow((x - cx) / rxx, 2)));
      const y = cy + s * ryy * q * (u > 0.94 ? 0.2 : 1);
      pts.push([x, y, z + (u < 0.08 ? 0.12 * (1 - u / 0.08) : 0)]);
      const n = unit([(x - cx) / (rxx * rxx), (y - cy) / (ryy * ryy) + s * 0.001, u < 0.12 ? 1.2 * (1 - u / 0.12) : 0.1]);
      out.push(n);
    }
    const v: V3[] = [];
    pts.forEach((p, i) => {
      const t = unit([pts[Math.min(N, i + 1)][0] - pts[Math.max(0, i - 1)][0], pts[Math.min(N, i + 1)][1] - pts[Math.max(0, i - 1)][1], pts[Math.min(N, i + 1)][2] - pts[Math.max(0, i - 1)][2]]);
      const w = unit(cross(out[i], t));
      v.push([p[0] - w[0] * HW, p[1] - w[1] * HW, p[2] - w[2] * HW], [p[0] + w[0] * HW, p[1] + w[1] * HW, p[2] + w[2] * HW]);
    });
    const f: Face[] = [];
    for (let i = 0; i < N; i++) f.push(faceOut(v, [2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2], out[i], 'leatherDark'));
    return mesh(v, f);
  };
  st = [side(1), side(-1)];
  straps.set(key, st);
  return st;
}

/**
 * A jerkin's own strap: over the right shoulder, down across the chest to
 * the left hip and down the back, the mirror of the one a weapon on the back
 * hangs from, so that with one it is an X. A brass buckle on it high on the
 * chest, where it shows from the front and from either side.
 */
function baldricOf(b: Build, g: number): Mesh {
  const [front, rear] = strapOf(b.fr, g);
  const rs = chestRings(b, g);
  const z0 = rs[0][0], z1 = rs[rs.length - 1][0];
  // A third of the way down the strap, as `strapOf` lays it, mirrored.
  const u = 0.34, z = 2.3 + (0.15 - 2.3) * u;
  const [, rxx, ryy, cx, cy] = profileAt(rs, Math.max(0, Math.min(1, (z - z0) / (z1 - z0))));
  const x = -(-0.93 + 1.93 * u) * rxx;
  const y = cy + ryy * Math.sqrt(Math.max(0, 1 - Math.pow((x - cx) / rxx, 2))) + 0.07;
  const n = unit([(x - cx) / (rxx * rxx), (y - cy) / (ryy * ryy), 0]);
  const across = unit(cross([0, 0, 1], n));
  const buckle = decals([
    plate([x, y, z], [across[0] * 0.2, across[1] * 0.2, 0], [0, 0, 0.24], n, 'fitting'),
    plate([x + n[0] * 0.01, y + n[1] * 0.01, z], [across[0] * 0.09, across[1] * 0.09, 0], [0, 0, 0.13], n, 'leatherDark'),
  ]);
  return join(mirrored(front), mirrored(rear), buckle);
}

/** Stitching down each side of a jerkin's lacing, on the flat of its front, from the waist to under the collar: a dash of pale thread every so far. */
function stitchesOf(b: Build, g: number): Array<{ q: V3[]; m: Mat }> {
  const rs = chestRings(b, g, 2.18);
  const z0 = rs[0][0], z1 = rs[rs.length - 1][0];
  const out: Array<{ q: V3[]; m: Mat }> = [];
  for (let z = 0.05; z <= 1.85; z += 0.3) {
    const [, rxx, ryy, , cy] = profileAt(rs, Math.max(0, Math.min(1, (z - z0) / (z1 - z0))));
    // The front of the shell is flat between its facets' corners, at the sine of three-eighths of a right angle across.
    const y = cy + ryy * Math.sin((3 * Math.PI) / 8) + 0.02;
    for (const sx of [-1, 1]) out.push(plate([sx * 0.3 * rxx, y, z], [0.025, 0, 0], [0, 0, 0.09], [0, 1, 0], 'lace'));
  }
  return out;
}

/* -- putting it all on ---------------------------------------------------------------- */

interface Put {
  part: Part;
  /** The body's part it is on, with its side: 'upper1', 'chest'. */
  on: string;
  /** What it goes on over, each with its side. */
  over: string[];
  layer: number;
  order: number;
  /** Its place among its piece's bits: of two on the same part of the body, the later is drawn over the earlier. */
  seq: number;
}

/** The regions a bit on side `k` covers under the name `c`: its own side's, or both sides' for a bit on no side. */
const regionsOf = (c: string, k: number): string[] => (k < 0 ? [c, `${c}0`, `${c}1`] : [`${c}${k}`, c]);

/**
 * A body dressed: its own parts, less what the gear takes off, and the gear
 * on it, each piece in its own colours, drawn over what it covers and over
 * whatever is worn further in on the same part of the body.
 */
function dress(parts: Part[], named: Map<string, Part[]>, kit: Kit, r: Rig, b: Bones, gear: GearLook, pal: Palette, facing: number, lod: number): Part[] {
  const fr = kit.fr;
  // The gear cut as finely as the size it is drawn at wants, which need not be as finely as the body.
  const cutTo = lod === fr.lod ? fr : { ...fr, lod };
  const fit = CHEST_FIT[gear.chest?.id ?? ''] ?? 1;
  const hidden = new Set<Part>();
  const worn: Array<[number, GearPiece, GearModel]> = [];
  DRESSED.forEach((slot, si) => {
    const piece = gear[slot];
    const model = piece && modelOf(piece.id, cutTo, fit);
    if (!piece || !model) return;
    worn.push([si, piece, model]);
    for (const c of model.hides ?? []) for (const key of regionsOf(c, -1)) for (const p of named.get(key) ?? []) hidden.add(p);
    // What hair a hat leaves showing: the cap of it and what falls from it, as far up as the rim and no further.
    const falls = !!named.get('fall')?.length;
    if (model.hairTo) for (const key of ['cap', 'fall']) for (const p of named.get(key) ?? []) p.mesh = trimmed(p.mesh, fr, model.hairTo, true, key === 'fall', key === 'cap' && !falls);
  });
  const out = parts.filter((p) => !hidden.has(p));
  const put: Put[] = [];
  worn.forEach(([si, piece, model], order) => {
    const P = gearPalette(pal, piece, STEP[DRESSED[si]] ?? 0);
    const rare = piece.rare || undefined;
    model.bits.forEach((bit, seq) => {
      const sides = bit.side === 'both' ? [0, 1] : bit.side === undefined ? [-1] : [bit.side];
      for (const k of sides) {
        const bone = b[k < 0 ? bit.bone : `${bit.bone}${k}`];
        const m = k === 0 && bit.side === 'both' ? mirrored(bit.mesh) : bit.mesh;
        // A bit carried whole is on a frame of its own, the bone's own frame being what is bent.
        const xf = bit.bend && bit.bone === 'hip' ? joint(bone, [0, 0, -THIGH * fr.tall])
          : bit.at || bit.turn || bit.whole ? joint(bone, bit.at ?? [0, 0, 0], ...(bit.turn ?? [0, 0, 0])) : bone;
        const v = bit.skirt ? bentWith(m.v, r, fr) : bit.bend ? kneeBent(m.v, kneeBend(b, k), bit.bone === 'knee')
          : bit.whole && bit.bone === 'arm' ? heldOnShoulder(m.v, r, k) : undefined;
        const part: Part = { mesh: m, xf, bias: bit.bias ?? 0.02, pal: P, rare, seed: si + 1, convex: bit.convex, front: bit.front, v, hide: bit.hide };
        out.push(part);
        put.push({ part, on: regionsOf(bit.over[0], k)[0], over: bit.over.flatMap((c) => regionsOf(c, k)), layer: bit.layer ?? model.layer, order, seq });
      }
    });
    // The body's own parts made of the piece, where nothing else worn has taken them off.
    for (const [c, to] of Object.entries(model.dyes ?? {}) as Array<[Covers, Partial<Record<Mat, Mat>>]>) {
      for (const key of regionsOf(c, -1)) {
        for (const p of named.get(key) ?? []) {
          if (hidden.has(p)) continue;
          p.mesh = dyedOf(p.mesh, to);
          p.pal = P;
          p.rare = rare;
          p.seed = si + 1;
        }
      }
    }
    // Gloves in place of the hands.
    if (model.glove) {
      for (let k = 0; k < 2; k++) {
        for (const hand of named.get(`hand${k}`) ?? []) {
          hand.mesh = gloveOf(hand.mesh, model.glove);
          hand.pal = P;
          hand.rare = rare;
          hand.seed = si + 1;
        }
      }
    }
  });
  // Each bit after what it covers.
  for (const w of put) {
    const leads: Part[] = [];
    for (const key of w.over) {
      for (const p of named.get(key) ?? []) if (!hidden.has(p)) leads.push(p);
      for (const o of put) {
        if (o === w || o.on !== key) continue;
        const inner = o.layer < w.layer || (o.layer === w.layer && (o.order < w.order || (o.order === w.order && o.seq < w.seq)));
        if (o.on !== w.on || inner) leads.push(o.part);
      }
    }
    if (leads.length) w.part.after = leads;
  }
  wield(out, named, r, b, gear, pal, put, fr, fit, facing);
  return out;
}

/** Which way `dir`, in the body's model space, is in a frame's own terms: for a part's `front`, when its frame is not the body's. */
const within = (xf: Xf, d: V3): V3 => {
  const m = xf.m;
  return [m[0] * d[0] + m[3] * d[1] + m[6] * d[2], m[1] * d[0] + m[4] * d[1] + m[7] * d[2], m[2] * d[0] + m[5] * d[1] + m[8] * d[2]];
};

/**
 * What is held, and where it goes when the hands are wanted.
 *
 * In the hands: a weapon in the right fist, point forward and down; a spear
 * upright and a bow slanted across, each kept at its slant off the hips
 * however the arm swings, which keeps a bow's lower tip and a spear's butt
 * out of the ground; anything too heavy to hold out in front over the right
 * shoulder, its head behind; and a shield on the left forearm, the hand
 * behind it.
 *
 * At work, in the water, at the reins or waving, everything is put away: a
 * blade in its scabbard at the left hip, a hatchet or a club through the
 * belt at the right, and the rest across the back on a strap, with the
 * shield over it.
 */
function wield(out: Part[], named: Map<string, Part[]>, r: Rig, b: Bones, gear: GearLook, pal: Palette, put: Put[], fr: Frame, fit: number, facing: number): void {
  /*
   * Swimming, what is put away is not drawn. Slung across the back of a body
   * laid forward in the water, a sword's hilt stood up out of it by the face
   * and a shield's rim behind the head, and treading water a maul's head stood
   * up beside it, none of them where anything worn on the back would be.
   * Gone from the moment the body is half way in, which is under the water's
   * edge as it goes in.
   */
  if (r.stowed && r.sink >= SINK / 2) return;
  // The body's own parts under these names, and whatever of the gear is on them.
  const on = (...keys: string[]): Part[] => keys.flatMap((k) => [...(named.get(k) ?? []), ...put.filter((p) => p.on === k).map((p) => p.part)]);
  const w = gear.weapon;
  const arm = w && weaponOf(w.id);
  const back: Part[] = [];
  // How far out behind a thing slung on the back is, in the chest's frame: over the chest and whatever is on it.
  const behind = -(1.3 * fit + 0.34);
  let strapPal: Palette | undefined;
  let slung: Part | undefined;
  // Which shoulder the strap goes over: the one what is slung on it goes up over.
  let slungLeft = true;
  if (w && arm) {
    const P = gearPalette(pal, w);
    const bit = (m: Mesh, xf: Xf, bias: number, more: Partial<Part> = {}): Part => {
      const p: Part = { mesh: m, xf, bias, pal: P, rare: w.rare || undefined, seed: DRESSED.indexOf('weapon') + 1, ...more };
      out.push(p);
      return p;
    };
    const c = cutsOf(arm);
    if (!r.stowed && arm.carry === 'shoulder') {
      // In the fist and back over the shoulder: what is in front of the shoulder over the chest, and what is behind it under.
      const k = r.carried;
      const xf = joint(joint(b[`wrist${k}`], [0, 0, GRIP], -90), [0, 0, -(arm.fist ?? 0)], 0, 0, (k ? 1 : -1) * ((arm.spin ?? 0) + r.spin));
      const fw = within(xf, mv(b.chest.m, [0, 1, 0]));
      const grip = bit(c.fore, xf, 0.03, { after: on('chest', 'abdomen', `upper${k}`), front: fw });
      const aft = bit(c.aft, xf, 0.03, { after: on('chest', 'abdomen', `upper${k}`), front: [-fw[0], -fw[1], -fw[2]] });
      for (const h of named.get(`hand${k}`) ?? []) h.after = grip;
      // With the chest turned away, the forearm reaches round the far side of it to a fist in front: under the body, whatever is
      // on it and all, however near the middle of the forearm comes.
      const T = viewOf(facing).T, ahead = mv(b.chest.m, [0, 1, 0]);
      const away = ahead[0] * T[0] + ahead[1] * T[1] + ahead[2] * T[2];
      if (away < -1 / 3) {
        const body = on('chest', 'abdomen');
        for (const p of on(`lower${k}`, `hand${k}`)) p.under = body;
      }
      // Seen square from behind, what is behind the shoulder comes up from under its top rather than starting on the face of it.
      if (away < -0.8) aft.under = on(`upper${k}`);
    } else if (!r.stowed && arm.carry === 'fist') {
      // A blade forward and down and out from the body, set off the hips rather than the forearm so it keeps to a line that shows its
      // length whichever way the body is seen, and tipped forward and back with the arm's swing by a share of it.
      const out = fistOut(facing) * DEG;
      const fist = place(b.wrist1, [0, 0, GRIP]);
      const aim = (down: number): Xf => {
        const tip = down - FIST_SWING * (r.arm[1][0] - 3) * DEG;
        const h: V3 = [Math.sin(out), Math.cos(out), 0];
        const dir: V3 = [h[0] * Math.cos(tip), h[1] * Math.cos(tip), -Math.sin(tip)];
        return { m: aimed(b.pelvis, [0, 0, 0], dir, [Math.cos(out), -Math.sin(out), 0]).m, t: fist };
      };
      // At a run a blade is carried nearer level, so its point goes along over the knees coming through rather than down across them.
      const run = (r.hover?.w ?? 0) * (r.hover?.g ?? 0);
      let down = (arm.down ?? FIST_DOWN - FIST_RUN * run) * DEG;
      let xf = aim(down);
      // Raised toward level, a step at a time, wherever that would put its point in the ground.
      for (let q = 0; q < 9 && place(xf, [0, 0, arm.to])[2] < 0.5; q++) xf = aim((down -= 8 * DEG));
      // A blow struck by a spell: carried by the forearm, `wield` of the way, so the swing of the arm swings it.
      if ((r.wield ?? 0) > 0) xf = wielded(xf, b.wrist1, fist, Math.min(1, r.wield ?? 0));
      const grip = bit(arm.grip, xf, 0.02);
      bit(arm.head, xf, 0.035);
      for (const h of named.get('hand1') ?? []) h.after = grip;
    } else if (!r.stowed) {
      const hand = arm.carry === 'bow' ? 0 : 1;
      // A staff leant out from the body as well as forward, so its shaft passes beside the face rather than across it.
      const dir: V3 = arm.carry === 'staff' ? staffUp(facing, arm.lean ?? 0) : bowUp(facing);
      // A bow turned about its stave from where it is seen, so its bend shows rather than its edge (see `BOW_TURN`).
      const turn = arm.carry === 'bow' ? byFacing(BOW_TURN, facing) * DEG : 0;
      const xf: Xf = { m: aimed(b.pelvis, [0, 0, 0], dir, [Math.cos(turn), -Math.sin(turn), 0]).m, t: place(b[`wrist${hand}`], [0, 0, GRIP]) };
      const grip = bit(arm.grip, xf, 0.02);
      bit(arm.head, xf, 0.035);
      for (const h of named.get(`hand${hand}`) ?? []) h.after = grip;
    } else if (arm.stow === 'hip' && c.sheathed) {
      // The scabbard's throat at the belt on the left, forward of the hip, and the blade down and back behind the leg; a knife's
      // upright at the front of the belt, its handle standing up over it where it shows from either side.
      const side = 1.64 * fr.wa * fit + 0.3;
      const knife = arm.to < KNIFE_TO;
      // A knife on the right of the buckle, clear of the left hand wherever work holds it; a blade on the left, drawn across.
      const x = knife ? 1 : -1;
      // Seated, the scabbard swings back along the seat and a little out, rather than hanging down through it to below the feet.
      // Standing, a sword's hangs out from the leg enough to be seen past it from the front.
      const dir = unit(r.sit ? [0.3 * x, -0.9, -0.28] : knife ? [0.12, 0.1, -1] : [-0.3, -0.56, -0.78]);
      const at: V3 = knife ? [side * 0.84, 1.18 * fit, 1.25] : [-side * 1.06, 0.55, 1.15];
      const k = arm.throat ?? 0.7;
      const xf = aimed(b.pelvis, [at[0] - dir[0] * k, at[1] - dir[1] * k, at[2] - dir[2] * k], dir, [x, 0, 0]);
      bit(c.sheathed, xf, 0.03, { after: on('pelvis', 'skirt', 'belt', 'abdomen', knife ? 'thigh1' : 'thigh0'), front: within(xf, mv(b.pelvis.m, [x, 0, 0])) });
    } else if (arm.stow === 'belt') {
      // Through the belt at the right hip, head up: a hatchet by its haft with its head on the belt, a club by its grip under the knob;
      // an axe's bit turned out from the hip and a little back, so its profile shows from in front and behind, and three-quarters on
      // from the right and three-quarters away from the left, rather than its edge.
      const side = 1.64 * fr.wa * fit + 0.25;
      const [outward, ahead] = arm.splay ?? [0.12, 0.2];
      const dir = unit(arm.headUp ? [outward, ahead, 1] : [outward, ahead + 0.02, -1]);
      const k = arm.belt ?? 0;
      const xf = aimed(b.pelvis, [side - dir[0] * k, 0.35 - dir[1] * k, 1.15 - dir[2] * k], dir, [-0.5, -1, 0]);
      // Over the chest as well as the hips from its own side: a club's knob stands up beside the ribs, and under the coat it is a stick.
      bit(c.whole, xf, 0.03, { after: on('pelvis', 'skirt', 'belt', 'abdomen', 'chest', 'thigh1'), front: within(xf, mv(b.pelvis.m, [1, 0, 0])) });
    } else {
      // Across the back by its middle, head up over a shoulder or point down to the other hip: which, from where it is seen (see
      // `SLUNG_LEFT`).
      const f = ((Math.round(facing) % 8) + 8) % 8;
      // Something heavy slung head up is slung head down while the hands work, so its head is down by the hip and not up by the
      // shoulder beside the head of the hammer that is raised over it.
      const up = arm.headUp && !(r.tool && arm.carry === 'shoulder');
      const left = (arm.carry === 'shoulder' && up ? SLUNG_LEFT_HEAD : SLUNG_LEFT)[f] === 1;
      const lr = left !== (r.tool && lefty(facing)) ? -1 : 1;
      slungLeft = lr < 0;
      const sl = (arm.slant ?? 30) * DEG;
      const dir: V3 = up ? [lr * Math.sin(sl), 0, Math.cos(sl)] : [-lr * Math.sin(sl), 0, -Math.cos(sl)];
      const mid = (arm.from + arm.to) / 2;
      // Hung lower the longer it is, so whichever end is up stops at the ear rather than over the crown -- except a spear or a
      // javelin, whose head goes up over the head as a slung spear's does, so that its butt stops at the calf and not on the ground;
      // while the hands work, down behind the head, where over it the head of the spear stands beside the hammer raised there.
      const top = 0.85 + Math.max(dir[2] * (arm.to - mid), dir[2] * (arm.from - mid));
      const z = 0.85 - Math.max(0, top - (arm.carry === 'staff' ? (r.tool ? 3.1 : 4.6) : 3.1));
      // Turned about itself from where it is seen (see `SLUNG_HEAD_TURN`); over the left shoulder, turned half round as well, so that
      // it is the mirror of itself over the right, an axe's bit standing off the outside of the haft there too.
      const turn = arm.carry === 'shoulder' && up ? SLUNG_HEAD_TURN[f] : arm.carry === 'bow' ? SLUNG_BOW_TURN[f] : 0;
      const xf = joint(aimed(b.chest, [-dir[0] * mid, behind, z - dir[2] * mid], dir, [0, -1, 0]), [0, 0, 0], 0, 0, lr < 0 ? 180 - turn : turn);
      // A blade in its scabbard.
      slung = bit(c.sheathed ?? c.whole, xf, 0.05, { front: within(xf, mv(b.chest.m, [0, -1, 0])) });
      back.push(slung);
      strapPal = P;
    }
  }
  const s = gear.offhand;
  const shield = s && shieldOf(s.id, !!s.dye);
  if (s && shield) {
    const P = s.id === 'wooden_shield' && !s.dye ? weatheredOf(gearPalette(pal, s)) : gearPalette(pal, s);
    const rare = s.rare || undefined, seed = DRESSED.indexOf('offhand') + 1;
    if (!r.stowed && !(arm && arm.carry === 'bow')) {
      // On the left forearm, its face out to the left and a little forward, where it reads from the front, and the hand behind it.
      const n = unit([-0.62, 0.78, 0]);
      const xf = framed(b.elbow0, [n[0] * 0.78, n[1] * 0.78, -1.25], cross([0, 0, 1], n), [0, 0, 1], n);
      out.push({ mesh: shield, xf, bias: 0.06, pal: P, rare, seed, front: [0, 0, 1], after: on('lower0', 'hand0') });
    } else {
      const xf = framed(b.chest, [0, behind - 0.36, 0.55], [1, 0, 0], [0, 0, 1], [0, -1, 0]);
      const p: Part = { mesh: shield, xf, bias: 0.07, pal: P, rare, seed, front: [0, 0, 1] };
      out.push(p);
      back.push(p);
      strapPal ??= P;
    }
  }
  if (back.length && strapPal) {
    // The strap it all hangs from, under what hangs from it.
    const [front, rear] = strapOf(fr, fit + 0.05).map((m) => (slungLeft ? m : mirrored(m)));
    const under = on('chest', 'abdomen');
    const band = (m: Mesh, f: V3): Part => ({ mesh: m, xf: b.chest, bias: 0.02, pal: strapPal, after: under, front: f });
    const straps = [band(front, [0, 1, 0]), band(rear, [0, -1, 0])];
    out.push(...straps);
    for (const p of back) p.after = [...under, ...straps, ...(p !== slung && slung ? [slung] : [])];
  }
}

function partsOf(kit: Kit, r: Rig, b: Bones, gear?: GearLook, pal?: Palette, facing = 0, lod = kit.fr.lod): Part[] {
  // Each of the body's parts under a name, for gear to go on over or take the place of.
  const named = new Map<string, Part[]>();
  const name = (key: string, p: Part): Part => {
    const list = named.get(key);
    if (list) list.push(p);
    else named.set(key, [p]);
    return p;
  };
  const skirt = name('skirt', { mesh: kit.skirt, xf: b.pelvis, v: bentWith(kit.skirt.v, r, kit.fr), bias: 0.15 });
  const abdomen = name('abdomen', { mesh: kit.abdomen, xf: b.spine, bias: 0.05, convex: true });
  const head = name('head', { mesh: r.blink ? kit.blink : kit.head, xf: b.head, bias: 0.2 });
  const parts: Part[] = [
    name('pelvis', { mesh: kit.pelvis, xf: b.pelvis, bias: 0, convex: true }),
    skirt,
    // Round the waist, over both the tunic's skirt and its body, whichever of them is drawn later.
    name('belt', { mesh: kit.belt, xf: b.pelvis, bias: 0.01, after: [skirt, abdomen], convex: true }),
    abdomen,
    name('chest', { mesh: kit.chest, xf: b.chest, bias: 0.1, convex: true }),
    name('neck', { mesh: kit.neck, xf: b.neck, bias: 0, under: head, convex: true }),
    head,
    // The ears on the head, the far one hidden behind the skull rather than drawn through it.
    name('ears', { mesh: kit.ears, xf: b.head, bias: 0.005, after: head, hide: [SKULL] }),
  ];
  const cap = kit.hair.cap && name('cap', { mesh: kit.hair.cap, xf: b.head, bias: 0.01, after: head, hide: [SKULL] });
  if (cap) parts.push(cap);
  // What stands up out of the hair -- a crest, a knot -- goes on over it.
  if (kit.hair.top) parts.push(name('top', { mesh: kit.hair.top, xf: b.head, bias: 0.012, after: cap ?? head, hide: [SKULL] }));
  if (kit.hair.fall) parts.push(name('fall', { mesh: kit.hair.fall, xf: b.head, bias: 0 }));
  const beard = kit.beard && name('beard', { mesh: kit.beard, xf: b.head, bias: 0.02, after: head, front: [0, 1, 0], hide: [SKULL, JAW] });
  if (beard) parts.push(beard);
  // The nose over the head and a moustache under it, and out of sight round the far side.
  parts.push(name('nose', { mesh: kit.nose, xf: b.head, bias: 0.025, after: beard ? [head, beard] : head, hide: [SKULL] }));
  for (const t of kit.hair.tails) {
    parts.push(name('tails', { mesh: t.mesh, xf: joint(b.head, t.at, -r.tail[0] * t.give, r.tail[1] * t.give, 0), bias: 0, hide: [SKULL], hideIn: b.head, under: t.under ? cap : undefined }));
  }
  if (r.tool) parts.push({ mesh: kit.mallet, xf: r.lefty ? b.wrist0 : b.wrist1, bias: 0.04 }, { mesh: kit.chisel, xf: r.lefty ? b.wrist1 : b.wrist0, bias: 0.04 });
  for (let k = 0; k < 2; k++) {
    parts.push(
      name(`upper${k}`, { mesh: k ? kit.upper : mirrored(kit.upper), xf: b[`arm${k}`], bias: 0, convex: true }),
      name(`lower${k}`, { mesh: kit.lower, xf: b[`elbow${k}`], bias: 0.02 }),
      name(`hand${k}`, { mesh: r.open[k] ? kit.open[k] : r.loose[k] ? kit.loose[k] : kit.hands[k], xf: b[`wrist${k}`], bias: 0.03 }),
    );
    const bend = kneeBend(b, k);
    const shin = name(`shin${k}`, { mesh: kit.shin, xf: b[`knee${k}`], v: kneeBent(kit.shin.v, bend, true), bias: 0, convex: true });
    parts.push(
      name(`thigh${k}`, { mesh: kit.thigh, xf: joint(b[`hip${k}`], [0, 0, -THIGH * kit.fr.tall]), v: kneeBent(kit.thigh.v, bend, false), bias: 0, convex: true }),
      shin,
      // The boot round the shin, over it unless its foot is turned well away from the viewer, when the shin is the nearer.
      name(`boot${k}`, { mesh: kit.boot, xf: b[`knee${k}`], bias: 0.01, convex: true, after: shin, front: [0, 0, -0.5] }),
      name(`foot${k}`, { mesh: kit.foot, xf: b[`ankle${k}`], bias: 0.02 }),
    );
  }
  const all = gear && pal ? dress(parts, named, kit, r, b, gear, pal, facing, lod) : parts;
  // Everything on either arm, the body's own and what is worn over it, kept on the shoulder at the top and bent at the elbow as one limb.
  for (let k = 0; k < 2; k++) {
    const e = Math.abs(r.elbow[k]) < 0.5 ? 0 : r.elbow[k], arm = b[`arm${k}`], fore = b[`elbow${k}`];
    for (const p of all) {
      if (p.xf === arm) p.v = bentAtShoulder(e ? bentAtElbow(p.v ?? p.mesh.v, e, UPPER * kit.fr.tall) : p.v ?? p.mesh.v, r, k);
      else if (p.xf === fore && e) p.v = bentAtElbow(p.v ?? p.mesh.v, e);
    }
  }
  return all;
}

export interface View {
  /** Where a step along the body's right and its front go on the screen. */
  ex: Pt;
  ey: Pt;
  /** Toward the viewer, and the light, in the body's own frame. */
  T: V3;
  L: V3;
  /** Toward the viewer along the ground. */
  H: Pt;
}

const SX = HALF_W / UNITS_PER_TILE;
const SY = HALF_H / UNITS_PER_TILE;
/**
 * The body turned to face one of the eight ways. Nought is straight at the
 * viewer and each step an eighth of a turn to screen right, which on the
 * island's ground is one of the eight compass steps; so a body walking
 * north-east faces the way it is walking at every one of the camera's turns.
 */
export function viewOf(facing: number): View {
  const th = Math.PI / 4 - (facing * Math.PI) / 4;
  const R: Pt = [-Math.sin(th), Math.cos(th)];
  const F: Pt = [Math.cos(th), Math.sin(th)];
  const ex: Pt = [(R[0] - R[1]) * SX, (R[0] + R[1]) * SY];
  const ey: Pt = [(F[0] - F[1]) * SX, (F[0] + F[1]) * SY];
  const T = unit([R[0] + R[1], F[0] + F[1], (2 * SY) / HEIGHT_SCALE]);
  // Over the viewer's left shoulder: to the left on the screen, a little toward the viewer, and high.
  const lu = -0.55 / Math.SQRT2 + 0.38 / Math.SQRT2, lv = 0.55 / Math.SQRT2 + 0.38 / Math.SQRT2;
  const L = unit([lu * R[0] + lv * R[1], lu * F[0] + lv * F[1], 0.78]);
  const h = Math.hypot(T[0], T[1]) || 1;
  return { ex, ey, T, L, H: [T[0] / h, T[1] / h] };
}

/** Light on a facet turned along `n`: wrapped, so a face turned from the light is shaded rather than black. */
function lightOn(n: V3, L: V3): number {
  const d = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
  return 0.62 + 0.44 * Math.pow(0.5 + 0.5 * d, 1.25) + (n[2] > 0.7 ? 0.03 : 0);
}

/**
 * Whether a point is out of sight behind a solid: inside it, or with it
 * between the point and the viewer. The solid is an egg in the frame `xf`,
 * so the test is a line against a ball once that frame is undone.
 */
function behind(xf: Xf, solid: { c: V3; r: V3 }, T: V3): (p: V3) => boolean {
  const m = xf.m;
  // The frame's turn undone is its transpose.
  const back = (v: V3): V3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const t = back(T);
  const d: V3 = [t[0] / solid.r[0], t[1] / solid.r[1], t[2] / solid.r[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  return (p: V3): boolean => {
    const q = back([p[0] - xf.t[0], p[1] - xf.t[1], p[2] - xf.t[2]]);
    const o: V3 = [(q[0] - solid.c[0]) / solid.r[0], (q[1] - solid.c[1]) / solid.r[1], (q[2] - solid.c[2]) / solid.r[2]];
    const oo = o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
    if (oo < 1) return true;
    const od = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
    // Toward the viewer the line only meets the ball if it is heading for it and passes within its radius.
    return od < 0 && od * od - dd * (oo - 1) > 0;
  };
}

interface Laid {
  part: Part;
  s: Pt[];
  vis: boolean[];
  k: number[];
  /** For a `toon` part, each facet the light's steps cut across, in its pieces: each piece's step and its corners on the screen. */
  split?: Map<number, Array<[number, Pt[]]>>;
  d: number[];
  /** How squarely each facet faces the viewer: near nought at the edge of the thing, turning away. */
  t: number[];
  key: number;
  /** For a `toon` part, how fine it is drawn: nought as anything else, one lined thinly (`TOON_THIN_PX`), two not lined at all. */
  fine: number;
}

/* ---- what is worked into a surface ------------------------------------------------ */

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * How finely each pattern is cut, in tenths of a metre, and how close it is
 * ever drawn on the screen, in pixels: a mail ring is two centimetres across,
 * but a row of them two pixels apart is a grey smear, so at the sizes the
 * island is played at the rows go wider apart than life until they read as
 * rows. Under two of a pattern to a facet it is not drawn at all.
 */
const PATTERN: Record<Pattern, { a: number; b: number; px: number }> = {
  mail: { a: 0.2, b: 0.2, px: 3.0 },
  scale: { a: 0.9, b: 0.62, px: 5.0 },
  quilt: { a: 0.62, b: 9, px: 5.2 },
  lames: { a: 9, b: 0.5, px: 3.6 },
  grain: { a: 9, b: 0.35, px: 3 },
  studs: { a: 0.62, b: 0.62, px: 5.5 },
};

/**
 * The patterns on the facets of one part just filled: each clipped to its
 * facet and drawn through the facet's corners, so it lies on the surface and
 * turns with it -- a mail row runs round a sleeve, a lame across a skirt of
 * plate -- in a dark and a light shade of the facet's own colour at its own
 * light. A four-cornered facet only, which is every band of a ring or a
 * chain; the ends are left plain.
 */
function worked(g: CanvasRenderingContext2D, l: Laid, faces: number[], P: Palette, px: number, hs: number): void {
  const f = l.part.mesh.f;
  const v = l.part.mesh.v;
  // Mail's rows and rings, gathered by shade across the whole part and laid down together at the end.
  const mailRows = new Map<string, Path2D>(), mailRings = new Map<string, Path2D>();
  // Studs' shadows and heads, gathered the same way.
  const studShadows = new Map<string, Path2D>(), studHeads = new Map<string, Path2D>();
  // Scale's courses: the dark line under each row of feet, and the lit lip along them.
  const scaleUnders = new Map<string, Path2D>(), scaleLips = new Map<string, Path2D>();
  const pathIn = (m: Map<string, Path2D>, c: string): Path2D => {
    let path = m.get(c);
    if (!path) { path = new Path2D(); m.set(c, path); }
    return path;
  };
  for (const fi of faces) {
    const face = f[fi];
    if (!face.pat || face.i.length !== 4) continue;
    const [i0, i1, i2, i3] = face.i;
    let [s0, s1, s2, s3] = [l.s[i0], l.s[i1], l.s[i2], l.s[i3]];
    const across = (Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) + Math.hypot(s2[0] - s3[0], s2[1] - s3[1])) / 2 / px;
    const up = (Math.hypot(s3[0] - s0[0], s3[1] - s0[1]) + Math.hypot(s2[0] - s1[0], s2[1] - s1[1])) / 2 / px;
    const cut = PATTERN[face.pat];
    const W = (dist(v[i0], v[i1]) + dist(v[i3], v[i2])) / 2, H = (dist(v[i0], v[i3]) + dist(v[i1], v[i2])) / 2;
    // Up the facet is up the screen, whichever way round the mesh was cut: scales overlap downward.
    if ((s3[1] + s2[1]) / 2 > (s0[1] + s1[1]) / 2) [s0, s1, s2, s3] = [s3, s2, s1, s0];
    const at = (a: number, b: number): Pt => {
      const x0 = s0[0] + (s1[0] - s0[0]) * a, y0 = s0[1] + (s1[1] - s0[1]) * a;
      const x1 = s3[0] + (s2[0] - s3[0]) * a, y1 = s3[1] + (s2[1] - s3[1]) * a;
      return [x0 + (x1 - x0) * b, y0 + (y1 - y0) * b];
    };
    const k = l.k[fi];
    if (face.pat === 'mail') {
      /*
       * Mail as it reads at the size the island is played at: rows of rings,
       * each row a dark line where it hangs over the one below and a bead of
       * light on the top of every ring, every other row half a ring along.
       * The rows and the rings in them are counted off the facet's own size,
       * not off how turned it is to the viewer, so the rows run on unbroken
       * from one facet of a band to the next round the body.
       */
      const nr = Math.max(1, Math.min(Math.floor(H / cut.b), Math.round((H * HEIGHT_SCALE) / (px * cut.px))));
      const nc = Math.max(1, Math.min(Math.floor(W / cut.a), Math.round((W * hs) / (px * cut.px))));
      // In steps of light a twenty-fifth apart, so a part's rings go down in a few batches, not one for every facet.
      const kq = Math.round(k * 25) / 25;
      const dark = pathIn(mailRows, shade(mixRGB(P[face.m], COOL_SHADOW, 0.3), kq * 0.72));
      const beads = pathIn(mailRings, shade(mixRGB(P[face.m], WARM_LIGHT, 0.42), Math.min(1.25, kq * 1.08)));
      const r0 = px * 0.5;
      for (let r = 0; r < nr; r++) {
        const lo = at(0, (r + 0.12) / nr), hi = at(1, (r + 0.12) / nr);
        dark.moveTo(lo[0], lo[1]);
        dark.lineTo(hi[0], hi[1]);
        const b = (r + 0.62) / nr;
        for (let c = 0; c <= nc; c++) {
          const a = (c + (r % 2 ? 0 : 0.5)) / nc;
          if (a <= 0 || a > 1) continue;
          const p = at(a, b);
          beads.rect(p[0] - r0, p[1] - r0, 2 * r0, 2 * r0);
        }
      }
      continue;
    }
    if (face.pat === 'scale') {
      /*
       * Dragon scale as it reads at the size the island is played at: courses
       * of scales, each a row of rounded feet with a dark line under them where
       * they hang over the course below and a lit lip just inside it, every
       * other course half a scale along. Counted off the facet's own size as
       * mail's rows are, so the courses run on unbroken round the body from
       * one facet of a band to the next, and a scale cut by the edge of a
       * facet is finished on the next.
       */
      const nr = Math.max(1, Math.min(Math.floor(H / cut.b), Math.round((H * HEIGHT_SCALE) / (px * cut.px))));
      const nc = Math.max(1, Math.min(Math.floor(W / cut.a), Math.round((W * hs) / (px * cut.px))));
      const kq = Math.round(k * 25) / 25;
      const under = pathIn(scaleUnders, shade(mixRGB(P[face.m], COOL_SHADOW, 0.42), kq * 0.62));
      const lip = pathIn(scaleLips, shade(mixRGB(P[face.m], WARM_LIGHT, 0.32), Math.min(1.25, kq * 1.1)));
      const half = (path: Path2D, a0: number, a1: number, foot: number, notch: number, rising: boolean): void => {
        // Half a scale's foot: from its notch round down to the middle of its foot, or back up the other side.
        const [p0, c, p1] = rising ? [at(a0, foot), at(a1, foot), at(a1, notch)] : [at(a0, notch), at(a0, foot), at(a1, foot)];
        path.moveTo(p0[0], p0[1]);
        path.quadraticCurveTo(c[0], c[1], p1[0], p1[1]);
      };
      for (let r = 0; r < nr; r++) {
        const foot = (r + 0.08) / nr, notch = (r + 0.62) / nr, lipAt = (r + 0.2) / nr;
        const off = r % 2 ? 0.5 : 0;
        for (let c = -1; c <= nc; c++) {
          const a0 = (c + off) / nc, am = (c + off + 0.5) / nc, a1 = (c + off + 1) / nc;
          if (a0 >= 0 && am <= 1) half(under, a0, am, foot, notch, false);
          if (am >= 0 && a1 <= 1) half(under, am, a1, foot, notch, true);
          // The lit lip only where a scale is big enough on the screen to have one: at the size the island is played at, a lip of
          // light along each is a speckle over the course, which is what should read.
          const l0 = Math.max(0, a0 + 0.22 / nc), l1 = Math.min(1, a1 - 0.22 / nc);
          if (px < 0.22 && l1 > l0) {
            const p0 = at(l0, lipAt), p1 = at(l1, lipAt);
            lip.moveTo(p0[0], p0[1]);
            lip.lineTo(p1[0], p1[1]);
          }
        }
      }
      continue;
    }
    if (face.pat === 'studs') {
      // Hide studded with rivets: a head at each crossing of a coarse grid, lit on top with its shadow below and to the side, counted
      // off the facet as mail's rings are. It is what says leather armour rather than a coat, the shape of the two being alike.
      const nr = Math.max(1, Math.min(Math.floor(H / cut.b), Math.round((H * HEIGHT_SCALE) / (px * cut.px))));
      const nc = Math.max(1, Math.min(Math.floor(W / cut.a), Math.round((W * hs) / (px * cut.px))));
      const kq = Math.round(k * 25) / 25;
      const under = pathIn(studShadows, shade(mixRGB(P[face.m], COOL_SHADOW, 0.4), kq * 0.6));
      const heads = pathIn(studHeads, shade(mixRGB(P.rivet, P[face.m], 0.25), Math.min(1.2, kq * 1.06)));
      const r0 = px * 0.7;
      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nc; c++) {
          const p = at((c + (r % 2 ? 0.25 : 0.75)) / nc, (r + 0.5) / nr);
          under.rect(p[0] - r0 + px * 0.45, p[1] - r0 + px * 0.6, 2 * r0, 2 * r0);
          heads.rect(p[0] - r0, p[1] - r0, 2 * r0, 2 * r0);
        }
      }
      continue;
    }
    // Quilting's channels are counted off the facet's own width, as mail's rings are, so they run on from facet to facet round a coat.
    const quilt = face.pat === 'quilt';
    const cols = quilt ? Math.max(1, Math.min(Math.floor(W / cut.a), Math.round((W * hs) / (px * cut.px)))) : Math.floor(Math.min(W / cut.a, across / cut.px));
    const rows = Math.floor(Math.min(H / cut.b, up / cut.px));
    if ((!quilt && cut.a < 9 && cols < 2) || (cut.b < 9 && rows < 2)) continue;
    const dark = new Path2D(), lit = new Path2D();
    const seg = (path: Path2D, pts: Pt[]): void => {
      path.moveTo(pts[0][0], pts[0][1]);
      for (let q = 1; q < pts.length; q++) path.lineTo(pts[q][0], pts[q][1]);
    };
    if (face.pat === 'quilt') {
      // The channels a padded coat is stitched in, running down it -- one down each facet's edge as well -- each with the puff of its wadding beside it.
      for (let c = 0; c < cols; c++) {
        const a = c / cols;
        seg(dark, [at(a, 0), at(a, 1)]);
        seg(lit, [at(a + 0.3 / cols, 0), at(a + 0.3 / cols, 1)]);
      }
    } else if (face.pat === 'lames') {
      // Plates overlapping downward: each lame's lower edge a dark line with the lit lip of the one below it.
      for (let r = 1; r < rows; r++) {
        const b = r / rows;
        seg(dark, [at(0, b), at(1, b)]);
        seg(lit, [at(0, b - 0.14 / rows), at(1, b - 0.14 / rows)]);
      }
    } else if (face.pat === 'grain') {
      for (let r = 1; r < rows; r++) {
        const b = r / rows;
        seg(dark, [at(0, b), at(0.3, b + 0.04 / rows), at(0.62, b - 0.05 / rows), at(1, b + 0.02 / rows)]);
      }
    }
    g.save();
    const clip = new Path2D();
    seg(clip, [s0, s1, s2, s3]);
    clip.closePath();
    g.clip(clip);
    g.lineWidth = Math.max(px * 0.8, 0.12);
    g.lineCap = 'round';
    g.strokeStyle = shade(P[face.m], k * 0.68);
    g.stroke(dark);
    g.lineWidth = Math.max(px * 0.6, 0.09);
    g.strokeStyle = shade(P[face.m], Math.min(1.5, k * 1.22));
    g.stroke(lit);
    g.restore();
  }
  if (mailRows.size) {
    g.lineWidth = px * 0.75;
    g.lineCap = 'butt';
    for (const [c, path] of mailRows) { g.strokeStyle = c; g.stroke(path); }
    for (const [c, path] of mailRings) { g.fillStyle = c; g.fill(path); }
  }
  for (const [c, path] of studShadows) { g.fillStyle = c; g.fill(path); }
  for (const [c, path] of studHeads) { g.fillStyle = c; g.fill(path); }
  if (scaleUnders.size) {
    g.lineCap = 'round';
    g.lineWidth = Math.max(px * 1.3, 0.14);
    for (const [c, path] of scaleUnders) { g.strokeStyle = c; g.stroke(path); }
    g.lineWidth = Math.max(px * 0.6, 0.09);
    for (const [c, path] of scaleLips) { g.strokeStyle = c; g.stroke(path); }
  }
}

/* ---- rare gear --------------------------------------------------------------------- */

/**
 * The shine on rare gear, worn.
 *
 * On the ground a rare thing sheds motes and a bloom (`drawShine`); on a body
 * that would wash the whole figure in one colour and bury the pieces that are
 * rare under it. So what is rare carries its light on itself, inside its own
 * outline, in the colour its rarity is written in -- as light only: the piece
 * keeps its own steel, wood or dye, and the colour is a sheen on the side of
 * it the light falls on and the glint that crosses it, more of it the rarer
 * it is:
 *
 *   rare        a blue sheen, and a slow glint crossing it nearly always
 *   supreme     a violet sheen that breathes, and a quicker glint
 *   fantastic   a gold sheen that breathes, a glint quicker still and
 *               whiter, and stars that open on it here and there
 *
 * Everything of one rarity on a body shines as one: one tint, and one glint
 * that crosses all of it together, so a rare set reads as a set rather than
 * as a dozen things twinkling out of step. Each part takes its shine as it is
 * drawn, so a plain sleeve over a rare breastplate covers the breastplate's
 * shine as it covers the breastplate. The colours are read off `RARITIES`,
 * like the ground's, so the list, the ground and the body all say the same
 * colour for the same word.
 */
const GLINT = [
  null,
  { period: 3.2, sweep: 0.92, band: 0.22, core: 0.46, glow: 0, stars: 0, white: 0.2, dye: 0.7 },
  { period: 2.6, sweep: 0.9, band: 0.2, core: 0.5, glow: 0.03, stars: 0, white: 0.2, dye: 0.75 },
  { period: 2.2, sweep: 0.88, band: 0.18, core: 0.56, glow: 0.04, stars: 3, white: 0.15, dye: 0.85 },
] as const;
/** How saturated the colour of a rarity's light on a piece may be: the island's chalk, not a sign painter's. */
const SHINE_SAT = 0.55;
/** A colour with its saturation, as the eye reads it, held to at most `s`: pulled toward its own grey. */
const tamed = (c: RGB, s: number): RGB => {
  const top = Math.max(c[0], c[1], c[2]), low = Math.min(c[0], c[1], c[2]);
  const sat = top > 0 ? (top - low) / top : 0;
  if (sat <= s) return c;
  const k = s / sat;
  return [top - (top - c[0]) * k, top - (top - c[1]) * k, top - (top - c[2]) * k];
};
/** Seconds to one breath of a supreme or fantastic piece's light. */
const BREATH = 2.4;

const rarityRgb = (rare: number): RGB => hex(rarityOf({ rare }).colour);
/** A rarity's ink pushed away from grey, as the ground's shine does: the pastel blue a real blue, the lilac a violet. */
const deepened = (c: RGB, spread = 2): RGB => {
  const top = Math.max(c[0], c[1], c[2]);
  return [top - (top - c[0]) * spread, top - (top - c[1]) * spread, top - (top - c[2]) * spread].map((x) => Math.max(0, x)) as RGB;
};
/** A colour at full saturation for its hue, at middle lightness: what a 'color' blend takes the hue and saturation of. */
const saturated = (c: RGB): RGB => {
  const top = Math.max(c[0], c[1], c[2]), low = Math.min(c[0], c[1], c[2]);
  if (top - low < 1) return c;
  return c.map((x) => ((x - low) / (top - low)) * 255) as RGB;
};
const rgba = (k: RGB, a: number): string => `rgba(${Math.round(k[0])}, ${Math.round(k[1])}, ${Math.round(k[2])}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** A colour's hue in degrees, its saturation and its value, each of the last two nought to one. */
function hsvOf(c: RGB): [number, number, number] {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const top = Math.max(r, g, b), low = Math.min(r, g, b), d = top - low;
  let h = 0;
  if (d > 1e-6) h = top === r ? ((g - b) / d) % 6 : top === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, top > 0 ? d / top : 0, top];
}
function fromHsv(h: number, s: number, v: number): RGB {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * How far a rare piece is glazed toward its rarity's hue, in shadow and full in the light: every facet of it, so it reads as rare
 * whichever way it is turned, and never the whole way, so it reads as what it is made of -- steel still steel, a green scale still
 * green. The rarity's colour at full strength is kept for its glint and the rim round it.
 */
const RARE_GLAZE: Array<[number, number] | null> = [null, [0.2, 0.34], [0.22, 0.38], [0.34, 0.52]];
/**
 * The saturation a glaze raises a colour toward: the island's chalk, and gold a little past it, which paler is beige on steel --
 * whose own blue takes some of it away.
 */
const GLAZE_SAT = [0, 0.5, 0.5, 0.66];
interface Glaze { base: Palette; hue: number; sat: number; shadow: number; lit: number }
/** The palettes of rare pieces, each with what it glazes and how: see `rarePalette`. */
const GLAZES = new WeakMap<Palette, Glaze>();
const rarePalettes = new WeakMap<Palette, Map<number, Palette>>();

/**
 * A colour glazed toward a hue by `t`, at its own value, so what is lit stays lit. The two are mixed as colour and not as light:
 * the colour's own hue and saturation give way by `t` to the glaze's hue at the island's chalk, so a grey takes the glaze's hue
 * and nothing between -- steel toward gold goes warm, not through green -- and a colour keeps its own the more the stronger it is,
 * a coloured material by as little as half as much, so a green scale is still green under gold and not mud.
 */
function glazed(c: RGB, hue: number, t: number, to: number): RGB {
  const [h, sat, v] = hsvOf(c);
  const tt = t * (1 - 0.5 * Math.min(1, sat / 0.4));
  const x = sat * Math.cos(h * DEG) * (1 - tt) + to * Math.cos(hue * DEG) * tt;
  const y = sat * Math.sin(h * DEG) * (1 - tt) + to * Math.sin(hue * DEG) * tt;
  return fromHsv((Math.atan2(y, x) / DEG + 360) % 360, Math.min(1, Math.hypot(x, y)), v);
}

/**
 * A rare piece's colours, glazed toward its rarity's hue at the strength its shadow takes: what its patterns, its lines and its rim
 * are drawn in. Its facets are glazed from its own colours by `toneOf`, further where the light is on them. Made once a palette.
 */
function rarePalette(P: Palette, rare: number): Palette {
  const how = RARE_GLAZE[rare];
  if (!how) return P;
  let byRare = rarePalettes.get(P);
  if (!byRare) rarePalettes.set(P, (byRare = new Map()));
  let R = byRare.get(rare);
  if (!R) {
    const hue = hsvOf(rarityRgb(rare))[0], sat = GLAZE_SAT[rare];
    R = { ...P };
    for (const m of Object.keys(P) as Mat[]) R[m] = glazed(P[m], hue, how[0], sat);
    GLAZES.set(R, { base: P, hue, sat, shadow: how[0], lit: how[1] });
    byRare.set(rare, R);
  }
  return R;
}

/** A colour back out of the `rgb(r,g,b)` that `shade` makes of it. */
const rgbOfCss = (c: string): RGB => c.slice(4, -1).split(',').map(Number) as RGB;

/** A tone of a rare piece glazed by how much light is on it: its shadow's strength below three-quarters lit, the light's at full. */
const glazedTones = new Map<string, string>();
function glazedTone(tone: string, glaze: Glaze, k: number): string {
  const u = Math.max(0, Math.min(1, (k - 0.78) / 0.24));
  const t = glaze.shadow + (glaze.lit - glaze.shadow) * u * u * (3 - 2 * u);
  const key = `${tone}|${glaze.hue}|${glaze.sat}|${t.toFixed(2)}`;
  let out = glazedTones.get(key);
  if (!out) {
    const c = rgbOfCss(tone);
    out = shade(glazed(c, glaze.hue, t, glaze.sat), 1);
    glazedTones.set(key, out);
    if (glazedTones.size > 4000) glazedTones.delete(glazedTones.keys().next().value as string);
  }
  return out;
}

/** Everything of one rarity on a body, as it is laid on the screen: its extent, for the glint to cross all of it together, and where the stars open this time. */
interface Shine {
  rare: number;
  c: RGB;
  deep: RGB;
  /** The colour glazed into its lit side and the glint's own: its rarity's, deepened and held to the island's chalk. */
  tone: RGB;
  /** Its rarity's hue at full strength, whose hue and saturation are laid over what it shines on at that thing's own lightness. */
  hue: RGB;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The line the glint sweeps along, the long way of whatever shines: from `a` to `b` on the screen. */
  a: Pt;
  b: Pt;
  seed: number;
  stars: Array<{ li: number; at: Pt; life: number; k: number }>;
}

function shinesOf(laid: Laid[], now: number): Map<number, Shine> {
  const out = new Map<number, Shine>();
  const spots = new Map<number, Array<[number, Pt]>>();
  laid.forEach((l, li) => {
    const rare = l.part.rare;
    if (!rare || !GLINT[rare]) return;
    let s = out.get(rare);
    if (!s) {
      const c = rarityRgb(rare), deep = deepened(c);
      s = { rare, c, deep, tone: tamed(mixRGB(deep, c, 0.5), SHINE_SAT), hue: saturated(c), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, a: [0, 0], b: [0, 0], seed: 0, stars: [] };
      out.set(rare, s);
      spots.set(rare, []);
    }
    s.seed += l.part.seed ?? 0;
    const f = l.part.mesh.f;
    for (let fi = 0; fi < f.length; fi++) {
      if (!l.vis[fi] || f[fi].decal) continue;
      let cx = 0, cy = 0;
      for (const i of f[fi].i) {
        const [x, y] = l.s[i];
        cx += x / f[fi].i.length;
        cy += y / f[fi].i.length;
        if (x < s.x0) s.x0 = x;
        if (y < s.y0) s.y0 = y;
        if (x > s.x1) s.x1 = x;
        if (y > s.y1) s.y1 = y;
      }
      spots.get(rare)?.push([li, [cx, cy]]);
    }
  });
  for (const s of out.values()) {
    // The long way of it, from how its facets lie: the glint sweeps along that, so it crosses a shield seen edge on or a blade
    // slanting across the body from end to end, rather than passing over it in a moment somewhere in the middle of its sweep.
    const at = spots.get(s.rare) ?? [];
    let mx = 0, my = 0;
    for (const [, [x, y]] of at) { mx += x / at.length; my += y / at.length; }
    let xx = 0, xy = 0, yy = 0;
    for (const [, [x, y]] of at) { xx += (x - mx) ** 2; xy += (x - mx) * (y - my); yy += (y - my) ** 2; }
    const th = 0.5 * Math.atan2(2 * xy, xx - yy);
    // Down the screen and to the right, as a light from over the left shoulder crosses a thing.
    let ux = Math.cos(th), uy = Math.sin(th);
    if (ux + uy < 0) { ux = -ux; uy = -uy; }
    let lo = Infinity, hi = -Infinity;
    for (const [x, y] of [[s.x0, s.y0], [s.x1, s.y0], [s.x0, s.y1], [s.x1, s.y1]]) {
      const d = (x - mx) * ux + (y - my) * uy;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    const pad = (hi - lo) * 0.25 + 1e-6;
    s.a = [mx + ux * (lo - pad), my + uy * (lo - pad)];
    s.b = [mx + ux * (hi + pad), my + uy * (hi + pad)];
    // The fantastic one's stars, each opening on a spot of it and closing again, a new spot each time round.
    const look = GLINT[s.rare];
    for (let k = 0; look && k < look.stars && at.length; k++) {
      const cyc = (now + s.seed * 0.13) / look.period + k / look.stars;
      const u = ((cyc % 1) + 1) % 1;
      if (u > 0.4) continue;
      const n = Math.floor(cyc) * 7919 + k * 104729 + s.seed * 31;
      const [li, p] = at[((n % at.length) + at.length) % at.length];
      s.stars.push({ li, at: p, life: Math.sin((u / 0.4) * Math.PI), k });
    }
  }
  return out;
}


/**
 * The rest of the shine on one rare part, laid on as soon as the part is
 * drawn so that whatever is drawn in front of it afterwards covers it too: a
 * breath of its rarity's colour over a supreme or fantastic one, the glint as
 * it crosses, and the stars that are open on it.
 */
function shineOn(g: CanvasRenderingContext2D, l: Laid, li: number, s: Shine, now: number): void {
  const look = GLINT[s.rare];
  if (!look) return;
  const f = l.part.mesh.f;
  // Its facets as one shape -- they all face the viewer, so wound alike, and filled once where they overlap -- which every layer of the shine is painted through.
  const face = new Path2D();
  let any = false;
  for (let fi = 0; fi < f.length; fi++) {
    if (!l.vis[fi] || f[fi].decal) continue;
    const idx = f[fi].i;
    face.moveTo(l.s[idx[0]][0], l.s[idx[0]][1]);
    for (let q = 1; q < idx.length; q++) face.lineTo(l.s[idx[q]][0], l.s[idx[q]][1]);
    face.closePath();
    any = true;
  }
  if (!any) return;
  const w = s.x1 - s.x0, h = s.y1 - s.y0;
  const breath = 0.5 + 0.5 * Math.sin((now * TAU) / BREATH + s.seed);
  // The piece keeps its own colour -- steel stays steel, a dye its dye -- and the rarity's colour is only ever light on it.
  // Its breath: a trace of the colour's light coming and going over a supreme or fantastic piece.
  g.globalCompositeOperation = 'lighter';
  if (look.glow) {
    g.fillStyle = rgba(tamed(s.c, SHINE_SAT), look.glow * breath);
    g.fill(face);
  }
  // The glint: along the long way of it over most of the cycle, and gone the rest.
  const t = ((((now + s.seed * 0.13) / look.period) % 1) + 1) % 1;
  if (t < look.sweep) {
    const u = t / look.sweep;
    const at = 0.08 + u * 0.84, hw = look.band / 2;
    const band = (c: RGB, mid: RGB, edge: number, core: number): CanvasGradient => {
      const grad = g.createLinearGradient(s.a[0], s.a[1], s.b[0], s.b[1]);
      grad.addColorStop(Math.max(0, at - hw), rgba(c, 0));
      grad.addColorStop(Math.max(0, at - hw * 0.3), rgba(c, edge));
      grad.addColorStop(at, rgba(mid, core));
      grad.addColorStop(Math.min(1, at + hw * 0.3), rgba(c, edge));
      grad.addColorStop(Math.min(1, at + hw), rgba(c, 0));
      return grad;
    };
    // It turns what it crosses to its colour first, keeping how light or dark each facet is, so that it is the rarity's colour going
    // over steel or green scale and not white, or lime where yellow light lands on green; then light in that colour over it.
    g.globalCompositeOperation = 'color';
    g.fillStyle = band(s.hue, s.hue, look.core * look.dye * 0.6, look.core * look.dye);
    g.fill(face);
    g.globalCompositeOperation = 'lighter';
    const c = tamed(mixRGB(s.tone, [255, 252, 244], look.white * 0.6), SHINE_SAT);
    g.fillStyle = band(c, mixRGB([255, 252, 244], s.tone, 1 - look.white), look.core * 0.45, look.core * 0.85);
    g.fill(face);
  }
  g.globalCompositeOperation = 'source-over';
  for (const st of s.stars) {
    if (st.li !== li) continue;
    // Big enough to be a star at the size the island is played at, and not a stray pixel.
    const r = Math.max(2, Math.min(3, Math.max(w, h) * 0.07)) * (0.55 + st.life * 0.45);
    g.save();
    g.translate(st.at[0], st.at[1]);
    g.rotate(now * 0.9 + st.k);
    g.globalCompositeOperation = 'screen';
    g.fillStyle = rgba(tamed(s.deep, SHINE_SAT + 0.1), 0.85 * st.life);
    fourPoint(g, r, r * 0.22);
    g.fill();
    g.fillStyle = rgba([255, 250, 236], 0.95 * st.life);
    fourPoint(g, r * 0.62, r * 0.14);
    g.fill();
    g.restore();
  }
}

/** A four-pointed star, tapered, round the origin. */
function fourPoint(g: CanvasRenderingContext2D, r: number, waist: number): void {
  g.beginPath();
  g.moveTo(0, -r);
  g.quadraticCurveTo(waist, -waist, r, 0);
  g.quadraticCurveTo(waist, waist, 0, r);
  g.quadraticCurveTo(-waist, waist, -r, 0);
  g.quadraticCurveTo(-waist, -waist, 0, -r);
  g.closePath();
}

/** Two canvases the shine on a picture is worked on, kept between frames: the picture glazed, and the light laid over it. */
let shineWork: [HTMLCanvasElement, HTMLCanvasElement] | null = null;

/**
 * A picture of something rare laid on the screen shining as a rare thing worn
 * does (`shineOn`): glazed toward its rarity's hue, the glint crossing it the
 * long way, and a supreme or fantastic one's breath and a fantastic one's
 * stars -- the same light, the same colours and the same timing, laid through
 * the picture's own ink rather than through a part's facets. For what is drawn
 * as a picture and not as parts: a wildermon still drawn by hand.
 *
 * The picture is the top left `W` by `H` of `pic`, drawn at `x`, `y`, `w` by
 * `h` on the screen, as `drawImage` would; `seed` sets it apart from anything
 * else of its rarity, so two rare ones side by side do not glint in step.
 */
export function shineOver(ctx: CanvasRenderingContext2D, pic: HTMLCanvasElement, W: number, H: number, x: number, y: number, w: number, h: number, rare: number, seed: number, now: number): void {
  const look = GLINT[rare];
  const how = RARE_GLAZE[rare];
  if (!look || !how || W < 1 || H < 1) {
    ctx.drawImage(pic, 0, 0, W, H, x, y, w, h);
    return;
  }
  if (!shineWork) shineWork = [document.createElement('canvas'), document.createElement('canvas')];
  const [glazedC, lightC] = shineWork;
  for (const c of shineWork) if (c.width < W || c.height < H) { c.width = Math.max(c.width, W); c.height = Math.max(c.height, H); }
  const gz = glazedC.getContext('2d') as CanvasRenderingContext2D;
  const lt = lightC.getContext('2d') as CanvasRenderingContext2D;
  const c = rarityRgb(rare), deep = deepened(c), tone = tamed(mixRGB(deep, c, 0.5), SHINE_SAT), hue = saturated(c);
  // Glazed toward its rarity's hue as far as a rare piece is in shadow, keeping how light or dark each part of it is: a picture
  // has no facets to tell its light from its shade by, and a blend takes all of the glaze's colour where a part's glaze takes a
  // share of it, so the glaze a part keeps for its darkest facets is what a picture takes all over.
  gz.setTransform(1, 0, 0, 1, 0, 0);
  gz.globalCompositeOperation = 'source-over';
  gz.clearRect(0, 0, W, H);
  gz.drawImage(pic, 0, 0, W, H, 0, 0, W, H);
  gz.globalCompositeOperation = 'color';
  gz.fillStyle = rgba(fromHsv(hsvOf(hue)[0], GLAZE_SAT[rare], 1), how[0]);
  gz.fillRect(0, 0, W, H);
  gz.globalCompositeOperation = 'destination-in';
  gz.drawImage(pic, 0, 0, W, H, 0, 0, W, H);
  // Its light: the breath, and the glint crossing it the long way, down the screen and to the right, and gone for the rest of the cycle.
  lt.setTransform(1, 0, 0, 1, 0, 0);
  lt.globalCompositeOperation = 'source-over';
  lt.clearRect(0, 0, W, H);
  const breath = 0.5 + 0.5 * Math.sin((now * TAU) / BREATH + seed);
  if (look.glow) {
    lt.fillStyle = rgba(tamed(c, SHINE_SAT), look.glow * breath);
    lt.fillRect(0, 0, W, H);
  }
  const t = ((((now + seed * 0.13) / look.period) % 1) + 1) % 1;
  if (t < look.sweep) {
    const u = t / look.sweep, at = 0.08 + u * 0.84, hw = look.band / 2;
    const grad = lt.createLinearGradient(-W * 0.25, -H * 0.1, W * 1.25, H * 0.35);
    const lit = tamed(mixRGB(tone, [255, 252, 244], look.white * 0.6), SHINE_SAT);
    const mid = mixRGB([255, 252, 244], tone, 1 - look.white);
    grad.addColorStop(Math.max(0, at - hw), rgba(lit, 0));
    grad.addColorStop(Math.max(0, at - hw * 0.3), rgba(lit, look.core * 0.45));
    grad.addColorStop(at, rgba(mid, look.core * 0.85));
    grad.addColorStop(Math.min(1, at + hw * 0.3), rgba(lit, look.core * 0.45));
    grad.addColorStop(Math.min(1, at + hw), rgba(lit, 0));
    lt.fillStyle = grad;
    lt.fillRect(0, 0, W, H);
  }
  lt.globalCompositeOperation = 'destination-in';
  lt.drawImage(pic, 0, 0, W, H, 0, 0, W, H);
  gz.globalCompositeOperation = 'lighter';
  gz.drawImage(lightC, 0, 0, W, H, 0, 0, W, H);
  gz.globalCompositeOperation = 'source-over';
  ctx.drawImage(glazedC, 0, 0, W, H, x, y, w, h);
  // A fantastic one's stars, each opening on a spot of it and closing again, somewhere new each time round: spots near the middle
  // of the picture, where a body is, rather than out at its edges where there may be nothing.
  for (let k = 0; k < look.stars; k++) {
    const cyc = (now + seed * 0.13) / look.period + k / look.stars;
    const v = ((cyc % 1) + 1) % 1;
    if (v > 0.4) continue;
    const n = Math.floor(cyc) * 7919 + k * 104729 + Math.round(seed * 31);
    const fx = 0.25 + 0.5 * (((n * 0.6180339887) % 1 + 1) % 1), fy = 0.3 + 0.45 * (((n * 0.7548776662) % 1 + 1) % 1);
    const life = Math.sin((v / 0.4) * Math.PI);
    const r = Math.max(2, Math.min(4, Math.max(w, h) * 0.06)) * (0.55 + life * 0.45);
    ctx.save();
    ctx.translate(x + fx * w, y + fy * h);
    ctx.rotate(now * 0.9 + k);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = rgba(tamed(deep, SHINE_SAT + 0.1), 0.85 * life);
    fourPoint(ctx, r, r * 0.22);
    ctx.fill();
    ctx.fillStyle = rgba([255, 250, 236], 0.95 * life);
    fourPoint(ctx, r * 0.62, r * 0.14);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Put the parts on the screen. Each is sorted into place by how near its
 * middle is along the ground -- which is what puts the near arm in front of
 * the body and the far one behind it -- and its facets among themselves by
 * how near each is. The outside of the whole is inked first, fattened, so
 * only its rim shows; then each part in turn, and a line along every edge
 * of it that turns away from the viewer, which is what draws an arm over a
 * chest.
 */
/** Which facets meet at each corner of a mesh, worked out once for it. */
const cornersOf = new WeakMap<object, number[][]>();
function facetsAt(mesh: Mesh): number[][] {
  let at = cornersOf.get(mesh.f);
  if (!at) {
    at = mesh.v.map(() => [] as number[]);
    mesh.f.forEach((face, fi) => { for (const vi of face.i) at![vi].push(fi); });
    cornersOf.set(mesh.f, at);
  }
  return at;
}

/** The part of a polygon on one side of a level of what is known at its corners, with that at its new corners. */
function clipAt(pts: readonly Pt[], val: readonly number[], level: number, above: boolean): [Pt[], number[]] {
  const op: Pt[] = [], ov: number[] = [];
  const n = pts.length;
  for (let q = 0; q < n; q++) {
    const a = pts[q], b = pts[(q + 1) % n], va = val[q], vb = val[(q + 1) % n];
    const ina = above ? va >= level : va < level, inb = above ? vb >= level : vb < level;
    if (ina) { op.push(a); ov.push(va); }
    if (ina !== inb) {
      const r = (level - va) / (vb - va);
      op.push([a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r]);
      ov.push(level);
    }
  }
  return [op, ov];
}

/**
 * Where the light's steps cross a `toon` part: the light worked out at each
 * corner of each facet from the facets round it that turn the same way (not
 * across a crease), so a step runs as one smooth line over a round mass
 * rather than along the edges of its facets. A facet the line crosses is cut
 * along it, each piece in its own step; a facet it does not cross takes the
 * step of its corners.
 */
function toonSplit(mesh: Mesh, s: readonly Pt[], vis: readonly boolean[], k: number[], normals: readonly V3[], areas: readonly number[], L: V3, toward?: readonly number[]): Map<number, Array<[number, Pt[]]>> | undefined {
  const at = facetsAt(mesh);
  let out: Map<number, Array<[number, Pt[]]>> | undefined;
  const val: number[] = [];
  mesh.f.forEach((face, fi) => {
    if (!vis[fi] || face.decal) return;
    const u = normals[fi];
    // Along the top of the outline, where the surface turns away: the sheen, whole.
    if (toward && toward[fi] < 0.32 && u[2] > 0.3) { k[fi] = TOON_SHEEN; return; }
    val.length = 0;
    let lo = Infinity, hi = -Infinity;
    for (const vi of face.i) {
      let x = 0, y = 0, z = 0;
      for (const gi of at[vi]) {
        const w = normals[gi];
        if (w[0] * u[0] + w[1] * u[1] + w[2] * u[2] < 0.5) continue;
        x += w[0] * areas[gi]; y += w[1] * areas[gi]; z += w[2] * areas[gi];
      }
      const l = Math.sqrt(x * x + y * y + z * z);
      const d = l > 1e-9 ? toonD([x / l, y / l, z / l], L) : toonD(u, L);
      val.push(d);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    const a = toonStep(lo), b = toonStep(hi);
    if (a === b) { k[fi] = a; return; }
    const pts = face.i.map((vi) => s[vi]);
    const pieces: Array<[number, Pt[]]> = [];
    const [top] = clipAt(pts, val, TOON_CUTS[1], true);
    const [rest, restV] = clipAt(pts, val, TOON_CUTS[1], false);
    const [mid] = clipAt(rest, restV, TOON_CUTS[0], true);
    const [low] = clipAt(rest, restV, TOON_CUTS[0], false);
    if (low.length > 2) pieces.push([TOON_SHADE, low]);
    if (mid.length > 2) pieces.push([TOON_MID, mid]);
    if (top.length > 2) pieces.push([TOON_LIT, top]);
    (out ??= new Map()).set(fi, pieces);
  });
  return out;
}

/** Room for the outward squares of a facet's edges, kept between facets rather than made for each. */
let EDGE_X = new Float64Array(32), EDGE_Y = new Float64Array(32);

export function render(g: CanvasRenderingContext2D, parts: Part[], pal: Palette, view: View, ink: number, px: number, now = 0): void {
  const { ex, ey, T, L, H } = view;
  const normals: V3[] = [], areas: number[] = [];
  // How far a step across the body goes on the screen, on the whole: what a pattern's rings are counted off.
  const hs = (Math.hypot(ex[0], ex[1]) + Math.hypot(ey[0], ey[1])) / 2;
  const laid: Laid[] = parts.map((part) => {
    const pv = (part.v ?? part.mesh.v).map((p) => place(part.xf, p));
    const s = pv.map((p): Pt => [p[0] * ex[0] + p[1] * ey[0], p[0] * ex[1] + p[1] * ey[1] - p[2] * HEIGHT_SCALE]);
    const vis: boolean[] = [], k: number[] = [], d: number[] = [], t: number[] = [];
    const tests = (part.hide ?? []).map((solid) => behind(part.hideIn ?? part.xf, solid, T));
    const hidden = tests.length ? (p: V3): boolean => tests.some((t) => t(p)) : undefined;
    for (const face of part.mesh.f) {
      // Its normal the long way round (Newell's), and its middle, straight off the corners.
      const idx = face.i, m = idx.length;
      let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
      for (let q = 0; q < m; q++) {
        const a = pv[idx[q]], b = pv[idx[(q + 1) % m]];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
        cx += a[0]; cy += a[1]; cz += a[2];
      }
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const u: V3 = l > 1e-9 ? [nx / l, ny / l, nz / l] : [0, 0, 0];
      const c: V3 = [cx / m, cy / m, cz / m];
      const off = face.unless && mv(part.xf.m, face.unless);
      const toward = u[0] * T[0] + u[1] * T[1] + u[2] * T[2];
      vis.push(l > 1e-9 && toward > 1e-4 && !(hidden && hidden(face.at ? place(part.xf, face.at) : c)) && !(off && off[0] * T[0] + off[1] * T[1] + off[2] * T[2] > 0.05));
      t.push(toward);
      k.push(part.toon ? toonK(u, L) : lightOn(u, L));
      d.push(c[0] * T[0] + c[1] * T[1] + c[2] * T[2]);
      if (part.toon) { normals.push(u); areas.push(l); }
    }
    let cx = 0, cy = 0, cz = 0;
    for (const p of pv) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= pv.length; cy /= pv.length; cz /= pv.length;
    const split = part.toon ? toonSplit(part.mesh, s, vis, k, normals, areas, L, part.sheen ? t : undefined) : undefined;
    normals.length = 0;
    areas.length = 0;
    const across = part.toon ? acrossOf(part.mesh) / px : Infinity;
    return { part, s, vis, k, split, d, t, key: cx * H[0] + cy * H[1] + cz * 0.02 + part.bias, fine: across < TOON_FLECK_PX ? 2 : across < TOON_THIN_PX ? 1 : 0 };
  });
  // Each part goes after (or before) what it follows once that has itself been put in its place, whichever was made first: a
  // hand made with the body follows a grip made after it, and from behind the grip goes under the chest and the hand with it.
  const at = new Map<Part, Laid>();
  for (const l of laid) at.set(l.part, l);
  const settled = new Set<Laid>();
  const settle = (l: Laid): void => {
    if (settled.has(l)) return;
    settled.add(l);
    const leads = l.part.after ? (Array.isArray(l.part.after) ? l.part.after : [l.part.after]) : [];
    const keys: number[] = [];
    for (const p of leads) {
      const m = at.get(p);
      if (!m) continue;
      settle(m);
      keys.push(m.key);
    }
    if (!keys.length) return;
    const fw = l.part.front && mv(l.part.xf.m, l.part.front);
    if (!fw || fw[0] * T[0] + fw[1] * T[1] + fw[2] * T[2] > -1 / 3) l.key = Math.max(...keys) + l.part.bias;
    else l.key = Math.min(l.key, Math.min(...keys) - l.part.bias);
  };
  for (const l of laid) settle(l);
  for (const l of laid) {
    const tops = l.part.under ? (Array.isArray(l.part.under) ? l.part.under : [l.part.under]) : [];
    for (const p of tops) {
      const top = at.get(p);
      if (top) l.key = Math.min(l.key, top.key - 0.001);
    }
  }
  laid.sort((a, b) => a.key - b.key);
  /*
   * Drawn in batches of one colour, because a canvas pays by the call and
   * not by the corner: the ink round each part is one stroke per colour of
   * ink along its outline, a part whose facets cannot overlap is one fill
   * per shade, and the rest go down far to near, a run of one shade at a
   * time, each run followed by the lines along its own edges so that what
   * is nearer covers them too. Nothing is stroked facet by facet: each
   * facet is grown outward by half a pixel instead, every edge pushed out
   * square to itself, which closes the seams between neighbours that
   * anti-aliasing leaves.
   */
  // Worked out for the colours that are drawn, as they are drawn, rather than every colour the palette has.
  const inks: Partial<Record<Mat, string>> = {};
  // A piece of gear is in colours of its own, and inked in a dark shade of each of them.
  // A rare piece in its colours glazed toward its rarity's hue, and inked in a dark of them: its rim is its rarity's colour.
  // A rare piece is glazed over its own colours, or over the body's for a part that has none of its own: a rare wildermon's.
  const palOf = (l: Laid): Palette => (l.part.rare ? rarePalette(l.part.pal ?? pal, l.part.rare) : l.part.pal ?? pal);
  const partInks = new Map<Palette, Partial<Record<Mat, string>>>();
  const airyInks: Partial<Record<Mat, string>> = {};
  const inkIn = (l: Laid, m: Mat): string => {
    if (l.part.airy) return (airyInks[m] ??= shade(mixRGB((l.part.pal ?? pal)[m], INK, 0.3), 1));
    if (!l.part.pal) return (inks[m] ??= shade(inkOf(pal[m]), 1));
    const P = palOf(l);
    let c = partInks.get(P);
    if (!c) { c = {}; partInks.set(P, c); }
    // A rare piece's ink half a dark of its rarity's own hue, so the line round it is the one place its colour is at full strength.
    const glaze = GLAZES.get(P);
    return (c[m] ??= shade(glaze ? mixRGB(gearInk(P[m]), fromHsv(glaze.hue, 0.7, 0.36), 0.55) : gearInk(P[m]), 1));
  };
  const grow = 0.5 * px;
  const add = (path: Path2D, l: Laid, fi: number, fat = grow): void => {
    const idx = l.part.mesh.f[fi].i;
    addPts(path, idx.length, (q) => l.s[idx[q]], fat);
  };
  const addPts = (path: Path2D, n: number, pt: (q: number) => Pt, fat = grow): void => {
    if (!fat) {
      const p0 = pt(0);
      path.moveTo(p0[0], p0[1]);
      for (let q = 1; q < n; q++) { const p = pt(q); path.lineTo(p[0], p[1]); }
      path.closePath();
      return;
    }
    // Which way round it goes on the screen, so "out" is out.
    let area = 0;
    for (let q = 0; q < n; q++) {
      const a = pt(q), b = pt((q + 1) % n);
      area += a[0] * b[1] - b[0] * a[1];
    }
    const turn = area < 0 ? -1 : 1;
    // Each edge's outward square, once: edge q runs from corner q to the next.
    if (EDGE_X.length < n) { EDGE_X = new Float64Array(2 * n); EDGE_Y = new Float64Array(2 * n); }
    for (let q = 0; q < n; q++) {
      const a = pt(q), b = pt((q + 1) % n);
      const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.sqrt(dx * dx + dy * dy);
      if (dl > 1e-9) { EDGE_X[q] = (dy / dl) * turn; EDGE_Y[q] = (-dx / dl) * turn; } else { EDGE_X[q] = 0; EDGE_Y[q] = 0; }
    }
    for (let q = 0; q < n; q++) {
      const e = (q + n - 1) % n;
      let ax = EDGE_X[e], ay = EDGE_Y[e], bx = EDGE_X[q], by = EDGE_Y[q];
      if (!ax && !ay) { ax = bx; ay = by; }
      if (!bx && !by) { bx = ax; by = ay; }
      // The mitre: both neighbouring edges pushed out by `fat`, where they meet; never more than three times as far.
      const k = Math.min(3, 1 / Math.max(1e-3, 1 + ax * bx + ay * by)) * fat;
      const v = pt(q);
      const x = v[0] + (ax + bx) * k, y = v[1] + (ay + by) * k;
      if (q === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
  };
  // Something only a pixel or two across -- a flower, a leaf, a bead -- is lit and in its own colour, never in the cool shade: a
  // step of lavender on it is a smudge.
  const accent = (l: Laid, k: number): number => (l.fine && k < TOON_MID ? TOON_MID : k);
  /** A facet of a `toon` part the light's steps cut across, each piece into the path of its own shade. */
  const addSplit = (l: Laid, P: Palette, fi: number, pieces: Array<[number, Pt[]]>): void => {
    const c = P[l.part.mesh.f[fi].m];
    for (const [k, pts] of pieces) addPts(into(toonTone(c, accent(l, k))), pts.length, (q) => pts[q]);
  };
  // Where a facet that is seen meets one that is not, or nothing: the lines round a part, and along it where it turns away.
  // Each is [from, to, the facet seen, whether it is the open edge of the mesh rather than a fold where it turns away].
  const edgesOf = (l: Laid): Array<[number, number, number, boolean]> => {
    const f = l.part.mesh.f;
    const out: Array<[number, number, number, boolean]> = [];
    for (const [a, b, f1, f2] of l.part.mesh.e) {
      const v1 = l.vis[f1], v2 = f2 >= 0 ? l.vis[f2] : false;
      if (v1 === v2 || (f2 < 0 && f[f1].soft)) continue;
      // A shave or a shadow of beard is colour on the skin, not a thing on it, and is not inked; nor is a seam.
      const seen = f[v1 ? f1 : f2];
      if (seen.m === 'stubble' || seen.m === 'shaved' || seen.seam || (seen.fine && seen.fine * Math.SQRT2 * SX < Math.max(2 * ink, 4 * px))) continue;
      out.push([a, b, v1 ? f1 : f2, f2 < 0]);
    }
    return out;
  };
  const batch = new Map<string, Path2D>();
  const into = (c: string): Path2D => {
    let path = batch.get(c);
    if (!path) { path = new Path2D(); batch.set(c, path); }
    return path;
  };
  const flush = (width: number, fill: boolean): void => {
    g.lineWidth = width;
    for (const [c, path] of batch) {
      g.fillStyle = c;
      g.strokeStyle = c;
      if (fill) g.fill(path);
      if (width > 0) g.stroke(path);
    }
    batch.clear();
  };
  const line = (l: Laid, a: number, b: number, fi: number): void => {
    const to = into(inkIn(l, l.part.mesh.f[fi].m));
    to.moveTo(l.s[a][0], l.s[a][1]);
    to.lineTo(l.s[b][0], l.s[b][1]);
  };
  // The outline round the whole in the dark ink gear is drawn in, the body's own parts as well: in the body's lighter inks a bare
  // sleeve beside a coat of mail has half the line round it the mail has, and goes soft at the edge of the figure.
  const outlines: Partial<Record<Mat, string>> = {};
  const toonOutlines: Partial<Record<Mat, string>> = {};
  const thinOutlines: Partial<Record<Mat, string>> = {};
  const rimLine = (l: Laid, a: number, b: number, fi: number): void => {
    const m = l.part.mesh.f[fi].m;
    const to = into(l.part.pal || l.part.airy ? inkIn(l, m)
      : l.part.toon ? (l.fine ? (thinOutlines[m] ??= shade(toonThinInk(pal[m]), 1)) : (toonOutlines[m] ??= shade(toonInk(gearInk(pal[m])), 1)))
        : (outlines[m] ??= shade(gearInk(pal[m]), 1)));
    to.moveTo(l.s[a][0], l.s[a][1]);
    to.lineTo(l.s[b][0], l.s[b][1]);
  };
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const edges = laid.map(edgesOf);
  // The outline: every part's own outline in its ink, fattened, so that only a rim shows round the outside once the facets go over it.
  laid.forEach((l, li) => { if (l.part.rim !== false && !l.part.thin && !l.fine) for (const [a, b, fi] of edges[li]) rimLine(l, a, b, fi); });
  flush(ink * 2, false);
  laid.forEach((l, li) => { if (l.part.rim !== false && (l.part.thin || l.fine === 1)) for (const [a, b, fi] of edges[li]) rimLine(l, a, b, fi); });
  flush(ink, false);
  const shines = laid.some((l) => l.part.rare) ? shinesOf(laid, now) : null;
  laid.forEach((l, li) => {
    const f = l.part.mesh.f;
    const shown: number[] = [];
    for (let fi = 0; fi < f.length; fi++) if (l.vis[fi] && !f[fi].decal) shown.push(fi);
    const P = palOf(l);
    const sh = shines && l.part.rare ? shines.get(l.part.rare) : undefined;
    const tone = (fi: number, k = l.k[fi]): string => (l.part.toon ? (k === TOON_SHEEN && l.part.sheen ? toonTone(P[l.part.sheen], TOON_LIT) : toonTone(P[f[fi].m], accent(l, k))) : toneOf(P, f[fi].m, k, P !== pal));
    // The links of a chain: the lines of this link and every one straight after it go down now, fattened, before any of them does.
    const chain = l.part.chain;
    if (chain !== undefined && (li === 0 || laid[li - 1].part.chain !== chain)) {
      for (let r = li; r < laid.length && laid[r].part.chain === chain; r++) {
        const m = laid[r];
        if (m.part.lines !== false && m.part.rim !== false && !m.fine) for (const [a, b, fi] of edges[r]) line(m, a, b, fi);
      }
      flush(ink * 1.2, false);
    }
    const lined = l.part.lines !== false && l.part.rim !== false && !l.fine && chain === undefined;
    if (l.part.convex) {
      for (const fi of shown) {
        const pieces = l.split?.get(fi);
        if (pieces) addSplit(l, P, fi, pieces);
        else add(into(tone(fi)), l, fi);
      }
      flush(0, true);
      worked(g, l, shown, P, px, hs);
      if (lined) for (const [a, b, fi] of edges[li]) line(l, a, b, fi);
      flush(ink * 0.6, false);
    } else {
      // Far to near, a run of one shade at a time, and after each run the lines along its edges.
      const mine = new Map<number, Array<[number, number, boolean]>>();
      for (const [a, b, fi, open] of edges[li]) {
        const list = mine.get(fi);
        if (list) list.push([a, b, open]);
        else mine.set(fi, [[a, b, open]]);
      }
      shown.sort((a, b) => l.d[a] - l.d[b]);
      let q = 0;
      while (q < shown.length) {
        // A facet the light's steps cut across goes down on its own, in its pieces, and its lines after it.
        const pieces = l.split?.get(shown[q]);
        if (pieces) {
          addSplit(l, P, shown[q], pieces);
          flush(0, true);
          if (lined) for (const [a, b] of mine.get(shown[q]) ?? []) line(l, a, b, shown[q]);
          flush(ink * 0.6, false);
          q++;
          continue;
        }
        const c = tone(shown[q]);
        let end = q;
        while (end < shown.length && !l.split?.has(shown[end]) && tone(shown[end]) === c) end++;
        for (let r = q; r < end; r++) add(into(c), l, shown[r]);
        flush(0, true);
        worked(g, l, shown.slice(q, end), P, px, hs);
        if (lined) for (let r = q; r < end; r++) for (const [a, b] of mine.get(shown[r]) ?? []) line(l, a, b, shown[r]);
        flush(ink * 0.6, false);
        q = end;
      }
    }
    // What is painted on: in the order it was laid on, so a glint goes on over its eye.
    for (let fi = 0; fi < f.length; fi++) {
      if (!l.vis[fi] || !f[fi].decal) continue;
      const path = new Path2D();
      add(path, l, fi, 0);
      // Painted on a wildermon, flat: an eye is the same dark whichever way the head is turned, and a glint is always lit.
      g.fillStyle = l.part.toon ? toonTone(P[f[fi].m], f[fi].lit ? TOON_LIT : TOON_MID) : toneOf(P, f[fi].m, f[fi].lit ? Math.max(l.k[fi], 1.06) : l.k[fi], P !== pal);
      g.fill(path);
    }
    // And if it is rare, the rest of its shine, before anything in front of it goes down.
    if (sh) shineOn(g, l, li, sh, now);
  });
}

export const onScreen = (view: View, p: V3): Pt => [p[0] * view.ex[0] + p[1] * view.ey[0], p[0] * view.ex[1] + p[1] * view.ey[1] - p[2] * HEIGHT_SCALE];

/**
 * A body with its feet at (sx, sy): the player, and everybody else on the
 * island. `ink` overrides the width of the outline in screen pixels, for a
 * figure drawn big.
 */
/**
 * How finely gear is cut at a zoom: as coarsely as the body under one and a
 * half, and three-quarters as finely up to where bodies stop being kept as
 * pictures -- dragon scale a course and a quarter of its scales fewer, which
 * at seventy pixels tall is not to be seen and is a third of what it costs.
 */
const gearLod = (zoom: number): number => (zoom < 1.5 ? 0.5 : zoom < STILL_BELOW ? 0.75 : 1);

export function drawFigure(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: FigurePose, opts: { ink?: number } = {}): void {
  const look = pose.look ?? DEFAULT_LOOK;
  // Cut coarser at the sizes the island is played at: under one and a half, a lock of hair is a pixel or two.
  const kit = kitFor(look, zoom < 1.5 ? 0.5 : 1);
  const now = performance.now() / 1000;
  const settled = pose.id
    ? settle(pose.id, pose, rigOf(pose, kit.fr), now)
    : { rig: rigOf(pose, kit.fr), facing: (((pose.seat ? pose.facing : Math.round(pose.facing)) % 8) + 8) % 8, changing: false };
  const { rig: r, facing } = settled;
  // A cast moves every frame it lasts, so it is drawn every frame, as a blend or a turn is, and never from a stride's pictures.
  const changing = settled.changing || !!pose.cast;
  // Most of a pixel however far out, and never more than three and a half however far in.
  const ink = opts.ink !== undefined ? opts.ink / zoom : Math.max(0.9 / zoom, 0.7);
  if (pose.id && opts.ink === undefined) {
    drawStill(ctx, sx, sy, zoom, pose, kit, r, facing, changing, ink, now);
    return;
  }
  drawLive(ctx, sx, sy, zoom, pose, kit, r, facing, ink, now);
}

/* ---- what a driver holds, and the water round a swimmer ------------------------ */

/** The reins: a dark line under a leather one, as the team's are drawn from their heads (`drawReins` in `./renderer`). */
const REIN_UNDER = 'rgba(46, 30, 22, 0.85)';
const REIN_OVER = 'rgb(112, 74, 46)';

/**
 * The reins, from each fist out to where they go (`Seat.grip`), a hand
 * apart there, where the team's take them on: the two are one line. They
 * hang between in a curve that sags as they are let slack and draws nearly
 * straight as they are taken up.
 *
 * They were drawn after the body from every side, so with the team away
 * from the viewer they ran over the driver's head and back; and a line and
 * a half wide, as thick as the forearm, so they read as two wooden bows. Now
 * each is drawn before the body or after it by whether it is further off than
 * the chest or nearer (`behind`), and is a strap's width, a third of a unit,
 * never under the most of a pixel a line needs to be seen.
 */
function reins(g: CanvasRenderingContext2D, b: Bones, view: View, r: Rig, px: number, behind: boolean): void {
  const to = (r.seat ?? BOX).grip, slack = r.slack ?? 0.5;
  const T = view.T, chest = dot(b.chest.t, T);
  g.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    const h = place(b[`wrist${k}`], [0, 0, GRIP]);
    const e: V3 = [to[0] + s * 0.45, to[1], to[2]];
    const span = Math.hypot(e[0] - h[0], e[1] - h[1], e[2] - h[2]);
    const mid: V3 = [(h[0] + e[0]) / 2, (h[1] + e[1]) / 2, (h[2] + e[2]) / 2 - span * (0.015 + 0.075 * slack)];
    // Which side of the body this one is on, by the first stretch of it out of the fist, which is what passes the body.
    const near: V3 = [h[0] + (mid[0] - h[0]) * 0.4, h[1] + (mid[1] - h[1]) * 0.4, h[2] + (mid[2] - h[2]) * 0.4];
    if ((dot(near, T) < chest) !== behind) continue;
    const a = onScreen(view, h), m = onScreen(view, mid), z = onScreen(view, e);
    for (const [ink, w] of [[REIN_UNDER, Math.max(0.5, 1.5 * px)], [REIN_OVER, Math.max(0.3, 0.8 * px)]] as Array<[string, number]>) {
      g.strokeStyle = ink;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(a[0], a[1]);
      // Through the sagging middle: the control point that puts the curve's midpoint there.
      g.quadraticCurveTo(2 * m[0] - (a[0] + z[0]) / 2, 2 * m[1] - (a[1] + z[1]) / 2, z[0], z[1]);
      g.stroke();
    }
  }
  g.lineCap = 'butt';
}

/** An oar's blade: how long, and how wide, in the body's units. */
const BLADE: [number, number] = [3.2, 1.15];
const OAR_WOOD: RGB = [188, 150, 104];

/** A polygon cut to what of it is above the water (`up`) or below it, the water being level nought. */
function wet(ps: V3[], up: boolean): V3[] {
  const out: V3[] = [];
  const keep = (p: V3): boolean => (up ? p[2] >= 0 : p[2] < 0);
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length];
    if (keep(a)) out.push(a);
    if (keep(a) !== keep(b)) {
      const t = a[2] / (a[2] - b[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0]);
    }
  }
  return out;
}

/**
 * One oar: the loom from the handle in the fist out through the rowlock,
 * and the blade, square to the water through the drive and turned flat to
 * skim it on the way back. What is in the water is drawn faint, as it is
 * seen through it, and the water rings the oar where it goes in.
 */
function oar(g: CanvasRenderingContext2D, view: View, ink: number, o: { lock: V3; out: V3; feather: number; splash?: number }): void {
  const L = Math.hypot(o.out[0], o.out[1], o.out[2]);
  const d: V3 = [o.out[0] / L, o.out[1] / L, o.out[2] / L];
  // Along it from the end of the handle.
  const inboard = L / OAR_OUT, whole = inboard + L, loom = whole - BLADE[0];
  const at = (u: number): V3 => [o.lock[0] + d[0] * (u - inboard), o.lock[1] + d[1] * (u - inboard), o.lock[2] + d[2] * (u - inboard)];
  const handle = at(0), neck = at(loom), tip = at(whole);
  // Where it goes into the water, if it does.
  const into = handle[2] > 0 && tip[2] < 0 ? (whole * handle[2]) / (handle[2] - tip[2]) : whole;
  // Across the blade: up and down it while it is square, flat across the water when feathered.
  const flat = unit(cross([0, 0, 1], d)), square = unit(cross(d, flat));
  const w = unit([square[0] * (1 - o.feather) + flat[0] * o.feather, square[1] * (1 - o.feather) + flat[1] * o.feather, square[2] * (1 - o.feather) + flat[2] * o.feather]);
  const half = BLADE[1] / 2;
  const blade: V3[] = [
    [neck[0] + w[0] * half * 0.35, neck[1] + w[1] * half * 0.35, neck[2] + w[2] * half * 0.35],
    [tip[0] + w[0] * half, tip[1] + w[1] * half, tip[2] + w[2] * half],
    [tip[0] - w[0] * half, tip[1] - w[1] * half, tip[2] - w[2] * half],
    [neck[0] - w[0] * half * 0.35, neck[1] - w[1] * half * 0.35, neck[2] - w[2] * half * 0.35],
  ];
  const wood = css(OAR_WOOD), dark = css(inkOf(OAR_WOOD));
  const line = (p: V3, q: V3, width: number, colour: string): void => {
    const a = onScreen(view, p), b = onScreen(view, q);
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  };
  const fill = (ps: V3[], colour: string): void => {
    if (ps.length < 3) return;
    g.beginPath();
    ps.forEach((p, i) => { const s = onScreen(view, p); if (i) g.lineTo(s[0], s[1]); else g.moveTo(s[0], s[1]); });
    g.closePath();
    g.fillStyle = colour;
    g.fill();
    g.strokeStyle = dark;
    g.lineWidth = ink;
    g.stroke();
  };
  g.lineCap = 'round';
  // Under the water first, faint: the blade and the end of the loom, as much as is in.
  g.globalAlpha = 0.4;
  fill(wet(blade, false), wood);
  if (into < loom) line(at(into), neck, 0.55, wood);
  g.globalAlpha = 1;
  const dry = at(Math.min(into, loom));
  line(handle, dry, 0.62 + 2 * ink, dark);
  line(handle, dry, 0.62, wood);
  fill(wet(blade, true), wood);
  // The grip, darker with handling.
  line(handle, at(1.1), 0.78, dark);
  g.lineCap = 'butt';
  /*
   * And the water round it where it is in: a short wash either side of the
   * loom, and as the blade goes in, a splash that opens out round it into a
   * puddle of broken rings and settles. It was a crisp white ring the same
   * from the moment the blade went in to the moment it came out.
   */
  if (into < whole) {
    const c = onScreen(view, at(into));
    const arc = (r: number, from: number, to: number, a: number, w: number): void => {
      g.globalAlpha = a;
      g.lineWidth = w;
      g.beginPath();
      g.ellipse(c[0], c[1], r * 1.6, r * 0.75, 0, from, to);
      g.stroke();
    };
    g.strokeStyle = 'rgb(255, 255, 255)';
    g.lineCap = 'round';
    arc(0.9, 0.3, 1.3, 0.45, 0.5);
    arc(0.9, Math.PI + 0.3, Math.PI + 1.3, 0.45, 0.5);
    const u = o.splash ?? 1;
    if (u < 1) {
      // Coming up over the first quarter of its life, so the blade going in is not a bright closed ring; the inner ring only once it has opened.
      const R = 0.7 + 1.9 * Math.sqrt(u), a = 0.85 * Math.min(1, u / 0.25) * Math.pow(1 - u, 1.3), w = 0.75 - 0.4 * u;
      arc(R, 0.15, 1.35, a, w);
      arc(R * 0.92, 1.75, 2.9, a * 0.8, w);
      arc(R, Math.PI + 0.35, Math.PI + 1.6, a, w);
      arc(R * 0.85, Math.PI + 2.0, Math.PI + 2.85, a * 0.7, w);
      if (u >= 0.2) arc(R * 0.45, 0.6, 2.4, a * 0.6, w * 0.8);
    }
    g.globalAlpha = 1;
    g.lineCap = 'butt';
  }
}

/**
 * The rings a swimmer leaves on the water. Under way, one is set going as
 * each kick drives the body forward and is left behind as it goes on,
 * opening out and fading; treading water, they open out round the body with
 * every sweep of the hands.
 *
 * They were rings round the feet -- under the hips of a body laid forward in
 * the water -- set going at full size and full strength, with the near half
 * of each drawn over the body: a white hoop popped up round a swimmer's head
 * and cut across the face. Now each starts small and fades in as it opens
 * out, and the whole of it goes down on the water before what is over the
 * water is drawn: a ring on the surface is under whatever stands up out of
 * it, from any side.
 *
 * Under way, a closed ring left behind the head was, seen from in front, a
 * halo over it. Now what the kick leaves is a wake: two arcs, one either side
 * of the line the swimmer went along, opening out sideways from behind the
 * shoulders, with nothing across the line itself.
 *
 * Treading water, every ring went round one middle, two or three at a time:
 * a target. Now each is made by a hand, the left and the right in turn, and
 * goes round where that hand was when it made it, a little off from there
 * and a little early or late, so no two share a middle.
 *
 * Setting off or stopping, the rings of what the swimmer was doing were
 * dropped in a frame, and those of what they were now doing came up as if
 * they had been going all along. Now a ring once made lives out its own life
 * (`RingSet`): the ones left as the swimmer stops are left where they were
 * and open out and fade there, and the ones left treading water are left
 * behind as the swimmer sets off; and the new rings are only those made
 * since.
 */
interface RingSet {
  moving: boolean;
  /** The set's own clock: the walk's phase under way, the idle clock treading water. */
  phase: number;
  /** Only the rings made at or after this on its clock, and before that one. */
  after?: number;
  before?: number;
  /** Under way: when the swimmer stopped, after which a ring is no further behind them. */
  halt?: number;
  /** Treading water: how far the swimmer has gone on since setting off, which the rings are left that far behind. */
  drift?: number;
}
function ripple(g: CanvasRenderingContext2D, view: View, set: RingSet, at: V3, fr: Frame): void {
  const { moving, phase } = set;
  g.strokeStyle = 'rgb(255, 255, 255)';
  g.lineCap = 'round';
  const every = moving ? SWIM_STROKE : TAU / TREAD_RATE / 2;
  // Under way, from the kick; treading water, from each sweep of a hand.
  const shift = moving ? RIPPLE_KICK * every : 0;
  const from = phase - shift;
  const now = Math.floor(from / every);
  for (let k = 0; k < 4; k++) {
    const j = now - k;
    // A ring's own small differences, from which one it is.
    const h = (n: number): number => { const x = Math.sin(j * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
    const late = moving ? 0 : (h(1) - 0.5) * 0.7 * every;
    const born = j * every + late;
    if (set.after !== undefined && born + shift < set.after) continue;
    if (set.before !== undefined && born + shift >= set.before) continue;
    const age = from - born;
    const life = every * (moving ? 3 : 2 + 0.8 * h(2));
    const u = age / life;
    // Left where it was made, which the swimmer has gone on from at the pace the phase goes at, as far as the picture reaches.
    const back = moving ? Math.min(age, set.halt !== undefined ? set.halt - shift - born : age) * SWUM : set.drift ?? 0;
    if (u < 0 || u >= 1 || back > RIPPLE_REACH) continue;
    // Each comes up as it opens out, so none is ever a small bright ring by the head.
    const fade = 0.6 * Math.min(1, u / 0.3) * Math.pow(1 - u, 1.5) * (1 - back / RIPPLE_REACH);
    g.lineWidth = 1 - 0.5 * u;
    // Opening fast and then slower, from about the width of the shoulders.
    const open = 1 - (1 - u) * (1 - u);
    g.globalAlpha = fade;
    g.beginPath();
    if (moving) {
      // A wake from behind the shoulders: either side of the line gone along, square out from it and a little back.
      const c: V3 = [at[0], at[1] - back - WAKE_BEHIND, 0];
      const R = 2.4 + 6 * open;
      for (const s of [-1, 1]) {
        for (let i = 0; i <= 6; i++) {
          const a = (70 + (55 * i) / 6) * DEG;
          const p = onScreen(view, [c[0] + s * R * Math.sin(a), c[1] + R * Math.cos(a) * 0.8, 0]);
          if (i) g.lineTo(p[0], p[1]);
          else g.moveTo(p[0], p[1]);
        }
      }
    } else {
      // Round where the hand was that made it: the left and the right in turn, out toward the reach of the sweep.
      const side = j & 1 ? 1 : -1, q = (born + shift) * TREAD_RATE;
      const reach = 2.1 * fr.sh + TREAD_REACH + 0.8 * Math.sin(q + (side > 0 ? 0.35 : 0));
      const c = onScreen(view, [
        at[0] + side * reach * 0.6 + 1.2 * (h(3) - 0.5),
        at[1] + 1.0 + 0.35 * Math.cos(q) + 1.2 * (h(4) - 0.5) - back,
        0,
      ]);
      const R = (0.8 + 5.2 * open) * (0.75 + 0.5 * h(5));
      // A level circle on the water is drawn twice as wide as it is deep.
      g.ellipse(c[0], c[1], R * 1.7, R * 0.85, 0, 0, TAU);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  g.lineCap = 'butt';
}
/** How far behind where the head breaks the water a wake opens out from: behind the shoulders. */
const WAKE_BEHIND = 1.6;
/** How far through a stroke the kick drives the body on, and the ring that goes with it is set going. */
const RIPPLE_KICK = 0.55;

/** Where the head and shoulders break the water, in the body's frame: the first of the trunk's bones, from the head down, that crosses it. */
function breakOf(b: Bones): V3 {
  const bones = [b.head.t, b.neck.t, b.chest.t, b.pelvis.t];
  for (let i = 0; i + 1 < bones.length; i++) {
    const p = bones[i], q = bones[i + 1];
    if ((p[2] >= 0) !== (q[2] >= 0)) {
      const t = p[2] / (p[2] - q[2]);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, 0];
    }
  }
  return [b.neck.t[0], b.neck.t[1], 0];
}

/** Where a swimmer of each build breaks the water as the kick drives them on: the same in every stroke, so worked out once. */
const kicked = new WeakMap<Frame, V3>();
function kickAt(fr: Frame): V3 {
  let at = kicked.get(fr);
  if (!at) {
    const r = rest();
    swim(r, RIPPLE_KICK * SWIM_STROKE, true, fr);
    at = breakOf(skeleton(fr, r));
    kicked.set(fr, at);
  }
  return at;
}
/** Units of water covered to a radian of the walk's phase, which goes eleven radians to a walking pace's worth of tiles a second, at any pace. */
const SWUM = (UNITS_PER_TILE * 2.4) / 11;
/** How far behind a swimmer its rings are drawn before they are let go: inside the picture a body is kept in. */
const RIPPLE_REACH = 22;

/*
 * The water, a level through the body. Every part that crosses it is cut
 * there, facet by facet, into what is above and what is below, in the
 * body's own frame: a cut facet is new corners on the level shared with its
 * neighbours, so the part is still one surface and its outline is still its
 * outline. What is cut has no rim line along the cut: the water's own edge
 * goes round it instead (`foam`).
 */
const SLIVER = 0.45;
function waterline(parts: Part[], up: boolean): Part[] {
  const made = new Map<Part, Part>();
  for (const part of parts) {
    const pv = (part.v ?? part.mesh.v).map((p) => place(part.xf, p));
    const above = (i: number): boolean => pv[i][2] >= 0;
    let n = 0, top = -Infinity;
    for (let i = 0; i < pv.length; i++) {
      if (above(i)) n++;
      top = Math.max(top, pv[i][2]);
    }
    if (n === (up ? pv.length : 0)) { made.set(part, part); continue; }
    if (n === (up ? 0 : pv.length)) continue;
    // A part that comes up out of the water by a sliver -- the collar of a shirt round the neck, the top of a shoulder at the top
    // of a bob -- is a crescent of another colour inside the foam: under the lip of the water there, rather.
    if (up && top < SLIVER) continue;
    const v = pv.slice();
    const cuts = new Map<number, number>();
    const cutOf = (a: number, b: number): number => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let i = cuts.get(key);
      if (i === undefined) {
        const [p, q] = a < b ? [pv[a], pv[b]] : [pv[b], pv[a]];
        const t = p[2] / (p[2] - q[2]);
        i = v.length;
        v.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, 0]);
        cuts.set(key, i);
      }
      return i;
    };
    const faces: Face[] = [];
    for (const face of part.mesh.f) {
      const keep = face.i.map((i) => above(i) === up);
      if (keep.every(Boolean)) {
        faces.push(rehomed(face, part.xf));
        continue;
      }
      if (!keep.some(Boolean)) continue;
      const idx: number[] = [];
      const m = face.i.length;
      for (let q = 0; q < m; q++) {
        const a = face.i[q], b = face.i[(q + 1) % m];
        if (keep[q]) idx.push(a);
        if (keep[q] !== keep[(q + 1) % m]) {
          idx.push(cutOf(a, b));
        }
      }
      if (idx.length < 3) continue;
      faces.push({ ...rehomed(face, part.xf), i: idx, soft: true, pat: undefined });
    }
    if (!faces.length) continue;
    made.set(part, {
      ...part, mesh: mesh(v, faces), v: undefined, xf: ROOT, hideIn: part.hideIn ?? part.xf,
      front: part.front && mv(part.xf.m, part.front),
    });
  }
  // What is drawn after or never after another part is drawn after or never after what that part was cut to.
  const to = (ps: Part | Part[] | undefined): Part[] | undefined => {
    if (!ps) return undefined;
    const list = (Array.isArray(ps) ? ps : [ps]).map((p) => made.get(p)).filter((p): p is Part => !!p);
    return list.length ? list : undefined;
  };
  return [...made.values()].map((p) => (p.after || p.under ? { ...p, after: to(p.after), under: to(p.under) } : p));
}

/** A facet with whatever it says in its mesh's own frame said in the body's, for a mesh whose corners are put there. */
const rehomed = (face: Face, xf: Xf): Face =>
  face.unless || face.at ? { ...face, unless: face.unless && mv(xf.m, face.unless), at: face.at && place(xf, face.at) } : face;

/**
 * Where the body goes through the water, and how thick it is there: each
 * bone that crosses the level, where it crosses, its thickness across, and
 * which way it lies over the water -- a limb slanting through is cut long
 * along its slant.
 */
interface Wake { at: V3; r: number; along: V3; long: number }
function wakeOf(b: Bones, fr: Frame): Wake[] {
  const out: Wake[] = [];
  const through = (p: V3, q: V3, r: number): void => {
    if ((p[2] >= 0) === (q[2] >= 0)) return;
    const t = p[2] / (p[2] - q[2]);
    const d: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const flat = Math.hypot(d[0], d[1]), l = Math.hypot(flat, d[2]) || 1;
    out.push({
      at: [p[0] + d[0] * t, p[1] + d[1] * t, 0], r,
      along: flat > 1e-6 ? [d[0] / flat, d[1] / flat, 0] : [0, 1, 0],
      // Cut on a slant, the round of it is drawn out along the slant: the length of the cut through a tube of that round.
      long: r * Math.min(3, l / Math.max(Math.abs(d[2]), 1e-6)),
    });
  };
  through(b.pelvis.t, b.chest.t, 1.75 * fr.wa);
  through(b.chest.t, b.neck.t, 1.9 * fr.sh);
  through(b.neck.t, b.head.t, 0.85);
  for (let k = 0; k < 2; k++) {
    through(b[`arm${k}`].t, b[`elbow${k}`].t, 0.72);
    through(b[`elbow${k}`].t, b[`wrist${k}`].t, 0.6);
    through(b[`wrist${k}`].t, place(b[`wrist${k}`], [0, 0, 2 * GRIP]), 0.5);
    through(b[`hip${k}`].t, b[`knee${k}`].t, 0.95);
    through(b[`knee${k}`].t, b[`ankle${k}`].t, 0.75);
  }
  return out;
}

/** The ring round one place the body goes through the water, `out` beyond it, as far round as `on` says: drawn as a path. */
function wakeRing(g: CanvasRenderingContext2D, view: View, w: Wake, out: number, on: (o: V3) => boolean): void {
  const across: V3 = [-w.along[1], w.along[0], 0];
  const a = w.long + out, c = w.r + out;
  const N = 16;
  let pen = false;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * TAU;
    const o: V3 = [w.along[0] * a * Math.cos(th) + across[0] * c * Math.sin(th), w.along[1] * a * Math.cos(th) + across[1] * c * Math.sin(th), 0];
    if (!on(o)) { pen = false; continue; }
    const s = onScreen(view, [w.at[0] + o[0], w.at[1] + o[1], 0]);
    if (pen) g.lineTo(s[0], s[1]);
    else g.moveTo(s[0], s[1]);
    pen = true;
  }
}

/** The water's edge round each place the body goes through it: the far side of each before the body over the water is drawn, the near side after. */
function foam(g: CanvasRenderingContext2D, view: View, wake: Wake[], near: boolean): void {
  const T = view.T;
  g.strokeStyle = 'rgba(238, 247, 250, 0.8)';
  g.lineWidth = 0.55;
  g.lineCap = 'round';
  g.beginPath();
  /*
   * Where two of them run into each other -- the arms close in to the chest,
   * a hand at the chin -- they are one place the water goes round, not two:
   * whatever of one ring is inside another is left out, so the edge goes round
   * the outside of the lot rather than crossing itself over the chest.
   */
  const inside = (p: V3, w: Wake): boolean => {
    const d: V3 = [p[0] - w.at[0], p[1] - w.at[1], 0];
    const a = (d[0] * w.along[0] + d[1] * w.along[1]) / (w.long + 0.25), c = (d[1] * w.along[0] - d[0] * w.along[1]) / (w.r + 0.25);
    return a * a + c * c < 1;
  };
  for (const w of wake) {
    wakeRing(g, view, w, 0.25, (o) => {
      if ((o[0] * T[0] + o[1] * T[1] >= 0) !== near) return false;
      const p: V3 = [w.at[0] + o[0], w.at[1] + o[1], 0];
      for (const v of wake) if (v !== w && inside(p, v)) return false;
      return true;
    });
  }
  g.stroke();
  g.lineCap = 'butt';
}

/** The colour of water a swimmer's body is seen through, and how much of the body comes through it. */
const UNDERWATER: RGB = [44, 92, 104];
const UNDERWATER_SHOWS = 0.32;
let underPad: HTMLCanvasElement | null = null;

/**
 * What of the body is under the water, drawn on a scratch picture, washed
 * with the water's colour, and laid down faint: the stroke shows through
 * the surface as a shape, as a swimmer's body does.
 */
function underwater(ctx: CanvasRenderingContext2D, parts: Part[], pal: Palette, view: View, ink: number, px: number, now: number): void {
  if (!parts.length || typeof document === 'undefined') return;
  const t = ctx.getTransform();
  const k = Math.hypot(t.a, t.b);
  const box = { left: -30, right: 30, top: -24, bottom: 14 };
  const w = Math.ceil((box.right - box.left) * k), h = Math.ceil((box.bottom - box.top) * k);
  underPad ??= document.createElement('canvas');
  if (underPad.width < w || underPad.height < h) {
    underPad.width = Math.max(underPad.width, w);
    underPad.height = Math.max(underPad.height, h);
  }
  const g = underPad.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  g.setTransform(k, 0, 0, k, -box.left * k, -box.top * k);
  // Lined lightly: seen through the water, the edges go soft.
  render(g, parts, pal, view, ink * 0.5, px, now);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = css(UNDERWATER, 1, 0.62);
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = UNDERWATER_SHOWS;
  ctx.drawImage(underPad, 0, 0, w, h, t.e + box.left * k, t.f + box.top * k, w, h);
  ctx.restore();
}

/**
 * What of the outline of something sat in is its near side, on the screen:
 * the outline cut off along the top of the far side of the rim, and below.
 * The whole outline less the rim was what hid the body, which took in the top
 * of the far side as well -- a thin band of a cart's far rail drawn across the
 * driver's back from behind, which read as a rein over him. Nothing of the
 * body is ever behind the far side; only the near side hides it.
 */
function nearSide(outline: Pt[], rim: Pt[]): Pt[] {
  // The rim's top edge on the screen, left to right: its outline's upper run between its leftmost and rightmost corners.
  const turn = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const sorted = [...rim].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const top: Pt[] = [];
  for (const q of sorted) {
    while (top.length >= 2 && turn(top[top.length - 2], top[top.length - 1], q) <= 0) top.pop();
    top.push(q);
  }
  if (top.length < 2) return outline;
  const l = top[0], r = top[top.length - 1];
  // Everything under that edge, out to either side of it level with its ends.
  let cut: Pt[] = [[l[0] - 400, l[1]], ...top, [r[0] + 400, r[1]], [r[0] + 400, 400], [l[0] - 400, 400]];
  // Cut to the outline, which is convex: what of `cut` is inside each of its edges in turn.
  let area = 0;
  for (let i = 0; i < outline.length; i++) area += turn([0, 0], outline[i], outline[(i + 1) % outline.length]);
  const side = Math.sign(area);
  for (let i = 0; i < outline.length && cut.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const inside = (p: Pt): boolean => turn(a, b, p) * side >= 0;
    const out: Pt[] = [];
    for (let j = 0; j < cut.length; j++) {
      const p = cut[j], q = cut[(j + 1) % cut.length];
      if (inside(p)) out.push(p);
      if (inside(p) !== inside(q)) {
        const dp = turn(a, b, p), dq = turn(a, b, q), t = dp / (dp - dq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    cut = out;
  }
  return cut;
}

/** Where treading water is done from, in the body's frame: under the head, a little ahead of the feet. */
const TREAD_AT: V3 = [0, 1.1, 0];

/**
 * What each swimmer was doing on the water and when it changed, so that the
 * rings made before the change live out their lives after it: the clock each
 * set of rings goes by (the walk's phase under way, the idle clock treading
 * water) where it was at the change and how fast it was going, and the clock
 * of what came next where it was then.
 */
interface Wash { moving: boolean; at: number; seen: number; rate: number; since: number; was: number; pace: number; from: number }
const washes = new Map<string, Wash>();
/** How long after setting off or stopping the rings made before it are still drawn: longer than any of them lives. */
const WASH_KEEP = 4;

/** The rings to draw for a swimmer now: of what they are doing, and of what they were doing if they changed lately. */
function ringSets(pose: FigurePose, now: number): RingSet[] {
  const id = pose.id;
  if (!id) return [{ moving: pose.moving, phase: pose.phase }];
  let w = washes.get(id);
  if (!w || now - w.seen > 0.5 || now < w.seen) {
    w = { moving: pose.moving, at: pose.phase, seen: now, rate: pose.moving ? 7 : 6, since: -Infinity, was: 0, pace: 6, from: 0 };
    washes.set(id, w);
    if (washes.size > 256) for (const [k, v] of washes) if (now - v.seen > 5) washes.delete(k);
  }
  if (pose.moving !== w.moving) {
    // Where the clock of what has stopped had got to, going on as it went; and where the new one starts from.
    w.was = w.at + (now - w.seen) * w.rate;
    w.pace = w.rate;
    w.since = now;
    w.from = pose.phase;
    w.moving = pose.moving;
    w.rate = pose.moving ? 7 : 6;
  } else if (now > w.seen && pose.phase > w.at) {
    // The walk's phase goes as fast as the swimmer does: how fast, from the last two frames, steadied.
    w.rate += ((pose.phase - w.at) / (now - w.seen) - w.rate) * 0.3;
  }
  w.at = pose.phase;
  w.seen = now;
  const ago = now - w.since;
  if (ago > WASH_KEEP) return [{ moving: pose.moving, phase: pose.phase }];
  // The clock of what was being done, as if it had gone on at the pace it went.
  const old = w.was + ago * w.pace;
  return [
    pose.moving
      ? { moving: false, phase: old, before: w.was, drift: Math.min(RIPPLE_REACH, (pose.phase - w.from) * SWUM) }
      : { moving: true, phase: old, before: w.was, halt: w.was },
    { moving: pose.moving, phase: pose.phase, after: w.from },
  ];
}

function drawLive(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: FigurePose, kit: Kit, r: Rig, facing: number, ink: number, now: number): void {
  const look = pose.look ?? DEFAULT_LOOK;
  const b = skeleton(kit.fr, r);
  const view = viewOf(facing);
  const pal = paletteOf(pose, look);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  const parts = partsOf(kit, r, b, pose.gear, pal, facing, gearLod(zoom));
  if (pose.swimming) {
    const rings = wakeOf(b, kit.fr);
    underwater(ctx, waterline(parts, false), pal, view, ink, 1 / zoom, now);
    for (const set of ringSets(pose, now)) ripple(ctx, view, set, set.moving ? kickAt(kit.fr) : TREAD_AT, kit.fr);
    // The water's face where the body goes through it, under what of the body is over it: what is cut is open, and the water is in it.
    for (const w of rings) {
      ctx.beginPath();
      wakeRing(ctx, view, w, 0, () => true);
      ctx.fillStyle = css(UNDERWATER, 1.25, 0.85);
      ctx.fill();
    }
    foam(ctx, view, rings, false);
    render(ctx, waterline(parts, true), pal, view, ink, 1 / zoom, now);
    foam(ctx, view, rings, true);
  } else {
    // A far oar goes under the body, a near one over it.
    const T = view.T;
    const near = (o: { lock: V3 }): boolean => o.lock[0] * T[0] + o.lock[1] * T[1] > 0;
    for (const o of r.oars ?? []) if (!near(o)) oar(ctx, view, ink, o);
    if (r.reins) reins(ctx, b, view, r, 1 / zoom, true);
    const sides = r.seat?.sides;
    if (sides) {
      // Whatever of the body is down behind the near side of what it sits in: hidden, except where it is seen down into over the rim.
      ctx.save();
      const p = new Path2D();
      p.rect(-200, -200, 400, 400);
      for (const loop of [nearSide(sides.outline, sides.rim), sides.rim]) {
        loop.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
        p.closePath();
      }
      ctx.clip(p, 'evenodd');
    }
    // Astride, the far leg goes down behind the beast's barrel, which is drawn first: hidden behind it rather than drawn over its flank.
    render(ctx, r.sit?.astride ? parts.map((p) => (p.hide ? p : { ...p, hide: [BARREL], hideIn: ROOT })) : parts, pal, view, ink, 1 / zoom, now);
    if (sides) ctx.restore();
    for (const o of r.oars ?? []) if (near(o)) oar(ctx, view, ink, o);
    if (r.reins) reins(ctx, b, view, r, 1 / zoom, false);
  }
  ctx.restore();
}

/**
 * How far above the feet the top of a standing body's hair comes, in screen
 * units at zoom one: where a name or what somebody said goes over them. The
 * crown of the skeleton at rest, and the volume of a full head of hair on it.
 */
export const FIGURE_TOP: number = (() => {
  const b = skeleton(frameOf(DEFAULT_LOOK), rest());
  return Math.ceil(place(b.head, bigger([0, -0.1, CROWN + 0.6]))[2] * HEIGHT_SCALE);
})();

/* ---- bodies kept between frames -------------------------------------------------- */

/**
 * A body on the island is not drawn afresh every frame. It is drawn into a
 * picture of its own, and that picture put on the screen wherever the body
 * is; the picture is drawn again a dozen times a second while it stands and
 * thirty while it walks, which is more than a stride or a breath needs --
 * fewer in a crowd -- and every frame while it is blending from one thing to
 * another or turning.
 * A few hundred facets a frame for every person in view is what the island
 * could not afford; a picture a frame is what it always drew.
 *
 * At every size. From `STILL_BELOW` in it is put down on a whole device
 * pixel, so it stays sharp. It was drawn again twice as often there too, which
 * at that size is a picture as big as a tree remade every frame of a walk:
 * seven milliseconds of a close view for one person standing in it. The rates
 * are the same at every zoom now.
 */
const STILL_BELOW = 2.5;

/** Redraws a second, by what the body is doing. */
const STILL_RATE: Record<string, number> = { idle: 12, work: 20, walk: 30, swim: 20, drive: 20 };
/** And never fewer than this for a body wearing something that shines. */
const SHINE_RATE = 24;

/**
 * With more people than this in view, none is drawn again more than
 * `CROWD_RATE` times a second: in a crowd no one person is watched closely
 * enough to see a stride at half the rate, and it holds the cost of a crowd
 * to what eight people cost at full rate.
 */
const CROWD = 8;
const CROWD_RATE = 15;

/** Who has been drawn lately, counted afresh every quarter of a second, and how many were last time. */
const lately = { since: 0, ids: new Set<string>(), count: 0 };

/** The picture's extent round the feet, in the figure's own screen units: reins, a raised arm, a hop, a blade held out to the side and a spear upright all inside it. */
const STILL_BOX = { left: -42, right: 42, top: -62, bottom: 14 };

interface Still {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** Everything that, changed, means drawing it again whatever the time. */
  key: string;
  at: number;
  /** Where the feet are in it, in its own pixels, and how many of those to a pixel of the screen it goes on. */
  ox: number;
  oy: number;
  dev: number;
}

const stills = new Map<string, Still>();

function drawStill(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: FigurePose, kit: Kit, r: Rig, facing: number, changing: boolean, ink: number, now: number): void {
  const id = pose.id as string;
  const t = ctx.getTransform();
  const dev = Math.hypot(t.a, t.b) || 1;
  const look = pose.look ?? DEFAULT_LOOK;
  const key = [look.gender, look.skin, look.hair, look.hairColour, look.eyes, look.beard, look.shirt, look.trousers, pose.tunic, pose.trousers,
    Math.round(facing * 100), zoom.toFixed(3), dev, doing(pose), pose.emote ?? '', gearKey(pose.gear)].join('|');
  if (stride(ctx, sx, sy, zoom, pose, kit, facing, changing, ink, key, dev)) return;
  let st = stills.get(id);
  if (now - lately.since > 0.25 || now < lately.since) {
    lately.count = lately.ids.size;
    lately.ids.clear();
    lately.since = now;
  }
  lately.ids.add(id);
  const close = zoom >= STILL_BELOW;
  // Something rare on them is drawn often enough for its glint to cross it smoothly.
  const rate = Math.min(Math.max(pose.emote ? 30 : STILL_RATE[doing(pose)] ?? 30, gearShines(pose.gear) ? SHINE_RATE : 0), lately.count > CROWD ? CROWD_RATE : Infinity);
  if (!st || st.key !== key || changing || now - st.at >= 1 / rate || now < st.at) {
    const k = zoom * dev;
    const w = Math.ceil((STILL_BOX.right - STILL_BOX.left) * k), h = Math.ceil((STILL_BOX.bottom - STILL_BOX.top) * k);
    if (!st) {
      const canvas = document.createElement('canvas');
      st = { canvas, g: canvas.getContext('2d') as CanvasRenderingContext2D, key: '', at: 0, ox: 0, oy: 0, dev };
      stills.set(id, st);
      if (stills.size > 96) for (const [k2, v] of stills) if (now - v.at > 5) stills.delete(k2);
    }
    if (st.canvas.width !== w || st.canvas.height !== h) {
      st.canvas.width = w;
      st.canvas.height = h;
    }
    st.ox = Math.round(-STILL_BOX.left * k);
    st.oy = Math.round(-STILL_BOX.top * k);
    st.dev = dev;
    st.key = key;
    st.at = now;
    st.g.setTransform(1, 0, 0, 1, 0, 0);
    st.g.clearRect(0, 0, w, h);
    st.g.setTransform(dev, 0, 0, dev, st.ox, st.oy);
    drawLive(st.g, 0, 0, zoom, pose, kit, r, facing, ink, now);
  }
  const x = sx - st.ox / st.dev, y = sy - st.oy / st.dev;
  if (close) ctx.drawImage(st.canvas, Math.round(x * st.dev) / st.dev, Math.round(y * st.dev) / st.dev, st.canvas.width / st.dev, st.canvas.height / st.dev);
  else ctx.drawImage(st.canvas, x, y, st.canvas.width / st.dev, st.canvas.height / st.dev);
}

/*
 * A walk is a loop: the same sixteen pictures a stride, at each of the eight
 * ways round, over and over for as long as the body keeps walking. So a body
 * walking steadily, facing one way, is put down from a picture of that
 * sixteenth of its stride kept from the stride before, and only the first
 * stride at a size draws anything. Turning, starting or stopping, emoting, or
 * wearing something whose light moves across it, it is drawn as a still is.
 * The wildermon have kept theirs this way since they were made (`drawBeast`).
 */

/** Pictures to a stride, and the steps between a walk and a run they are kept at. */
export const WALK_FRAMES = 16;
const GAIT_STEPS = 10;
/** Device pixels of stride pictures kept, the longest unused going first: about forty-eight megabytes. */
const STRIDE_PIXELS = 12_000_000;

interface StrideFrame {
  canvas: HTMLCanvasElement;
  ox: number;
  oy: number;
  dev: number;
}

const strides = new Map<string, StrideFrame>();
let stridePixels = 0;

/** Put down a walking body from its stride's pictures, making the picture it needs if it is new; false when it is not walking steadily. */
function stride(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: FigurePose, kit: Kit, facing: number, changing: boolean,
  ink: number, still: string, dev: number): boolean {
  if (changing || doing(pose) !== 'walk' || pose.emote || !Number.isInteger(facing) || gearShines(pose.gear)) return false;
  const turn = (((pose.phase / TAU) % 1) + 1) % 1;
  const i = Math.min(WALK_FRAMES - 1, Math.floor(turn * WALK_FRAMES));
  const gait = Math.round(Math.max(0, Math.min(1, pose.gait ?? 0)) * GAIT_STEPS) / GAIT_STEPS;
  const key = `${still}|${gait}|${i}`;
  let f = strides.get(key);
  if (f) {
    strides.delete(key);
    strides.set(key, f);
  } else {
    const k = zoom * dev;
    const w = Math.ceil((STILL_BOX.right - STILL_BOX.left) * k), h = Math.ceil((STILL_BOX.bottom - STILL_BOX.top) * k);
    while (stridePixels + w * h > STRIDE_PIXELS && strides.size) {
      const [old, gone] = strides.entries().next().value as [string, StrideFrame];
      strides.delete(old);
      stridePixels -= gone.canvas.width * gone.canvas.height;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    f = { canvas, ox: Math.round(-STILL_BOX.left * k), oy: Math.round(-STILL_BOX.top * k), dev };
    g.setTransform(dev, 0, 0, dev, f.ox, f.oy);
    // The middle of its sixteenth, at its step of gait.
    const at: FigurePose = { ...pose, phase: ((i + 0.5) / WALK_FRAMES) * TAU, gait };
    drawLive(g, 0, 0, zoom, at, kit, rigOf(at, kit.fr), facing, ink, 0);
    strides.set(key, f);
    stridePixels += w * h;
  }
  const x = sx - f.ox / f.dev, y = sy - f.oy / f.dev;
  if (zoom >= STILL_BELOW) ctx.drawImage(f.canvas, Math.round(x * f.dev) / f.dev, Math.round(y * f.dev) / f.dev, f.canvas.width / f.dev, f.canvas.height / f.dev);
  else ctx.drawImage(f.canvas, x, y, f.canvas.width / f.dev, f.canvas.height / f.dev);
  return true;
}

/**
 * Head and shoulders, three-quarters on unless turned, filling a square: what
 * a haircut or a beard is chosen by. The same head as the body, so a
 * thumbnail cannot promise what the island will not draw.
 */
export function drawBust(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, look: Look, facing = 1, t?: number, tall = size): void {
  const kit = kitFor(look);
  const r = rest();
  // Still for a thumbnail; breathing, looking about and blinking, `t` seconds in, for a mirror.
  if (t === undefined) r.head = [3, 0, 0];
  else idle(r, t, kit.fr);
  const b = skeleton(kit.fr, r);
  const parts = partsOf(kit, r, b).filter((p) => p.xf === b.head || p.xf === b.neck || p.xf === b.chest || p.mesh === kit.upper || p.mesh === mirrored(kit.upper) || kit.hair.tails.some((t) => t.mesh === p.mesh));
  const view = viewOf(facing);
  const head = place(b.head, [0, 0, 2]);
  const zoom = size / 14;
  const pal = paletteOf({ phase: 0, moving: false, facing, swimming: false, working: false, look }, look);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, tall);
  ctx.clip();
  const c = onScreen(view, head);
  // A square has the head a little below its middle, for the hair over it; a taller frame, the shoulders under it.
  ctx.translate(x + size / 2 - c[0] * zoom, y + (tall > size ? tall * 0.42 : size * 0.57) - c[1] * zoom);
  ctx.scale(zoom, zoom);
  render(ctx, parts, pal, view, 1.1 / zoom, 1 / zoom);
  ctx.restore();
}
