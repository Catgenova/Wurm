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
  /**
   * In a fold, the back of a knee: lit as though turned down from level by
   * `CREASE_DOWN`, however it is turned, so it is in shadow. With the knee
   * bent, the calf behind it faces up into the light, and seen from behind
   * the back of the knee was the lightest thing on the leg where the crease
   * should be its darkest.
   */
  crease?: boolean;
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
function headMesh(fr: Frame, blink: boolean, open = 0): Mesh {
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
    ...(open > 0 ? shouted(fr, 0.21 - fr.fem * 0.03, 1, open) : [{ q: mouth(0.21 - fr.fem * 0.03, 1), m: 'lip' as Mat }]),
  ];
  return join(face, decals(marks.map((d: { q: V3[]; m: Mat; unless?: V3 }) => {
    const k = newell(d.q);
    return { ...d, q: k[1] < -1e-9 && d.m === 'lip' ? [...d.q].reverse() : d.q };
  })));
}

/**
 * A mouth `open` of the way to a shout, `w` wide at height `z` on the face: the lips round a dark
 * opening, the jaw's half of it dropped (down by `MOUTH_DROP` at its widest) and the corners drawn
 * in, with the upper teeth a pale band under the top lip. Each laid on the face's front facet, as
 * the closed mouth is, so it goes out of sight round the side with the face.
 */
const MOUTH_DROP = 0.42;
function shouted(fr: Frame, w: number, z: number, open: number): Array<{ q: V3[]; m: Mat }> {
  const drop = MOUTH_DROP * open, half = w * (1 - 0.08 * open);
  // An eight-sided ring: the top lip's line, and the lower one dropped with the jaw.
  const ring = (inset: number, upper: number): Pt[] => [
    [-half + inset, z + 0.02], [-half * 0.6 + inset * 0.6, z + upper - inset], [half * 0.6 - inset * 0.6, z + upper - inset], [half - inset, z + 0.02],
    [half * 0.7 - inset * 0.7, z - drop * 0.75 + inset], [half * 0.25, z - drop - 0.04 + inset], [-half * 0.25, z - drop - 0.04 + inset], [-half * 0.7 + inset * 0.7, z - drop * 0.75 + inset],
  ];
  const lay = (pts: Pt[], lift: number): V3[] => {
    const q = pts.map(([x, h]): V3 => [x, faceFront(fr, h) + 0.005 + lift, h]);
    return newell(q)[1] < 0 ? q.reverse() : q;
  };
  const inner = ring(0.045, 0.06 + 0.06 * open);
  const top = inner[1][1];
  return [
    { q: lay(ring(0, 0.08 + 0.06 * open), 0), m: 'lip' },
    { q: lay(inner, 0.004), m: 'eye' },
    { q: lay([[-half * 0.5, top], [half * 0.5, top], [half * 0.45, top - 0.05], [-half * 0.45, top - 0.05]], 0.008), m: 'white' },
  ];
}

/** The head to draw: its mouth open as far as `mouth` says (in two steps, made when first wanted), or blinking, or as it is. */
function headFor(kit: Kit, r: Rig): Mesh {
  const m = r.mouth ?? 0;
  if (m >= 0.2) {
    kit.shout ??= [grown(headMesh(kit.fr, false, 0.5)), grown(headMesh(kit.fr, false, 1))];
    return kit.shout[m < 0.7 ? 0 : 1];
  }
  return r.blink ? kit.blink : kit.head;
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
  /** Open, a step at a time from part way to spread: see `OPENING`. */
  open: [Mesh[], Mesh[]];
  loose: [Mesh, Mesh];
  /** Each hand in the shapes a pose may ask for, and the closed hand they are blended from, all alike vertex for vertex: see `shapedHand`. */
  shaped: [Record<HandShapeName, Mesh>, Record<HandShapeName, Mesh>];
  /** The head with its mouth open, half way and all the way: made when first asked for (`headFor`). */
  shout?: [Mesh, Mesh];
  /** What is in each hand while at work. */
  mallet: Mesh;
  chisel: Mesh;
  thigh: Mesh;
  shin: Mesh;
  boot: Mesh;
  foot: Mesh;
}

/**
 * A boot's foot, in the ankle's frame: heel, instep and toe over a sole of its own colour. As wide over the heel and the instep as
 * the foot of a shaft is at the ankle (a little under seven tenths round), so seen from the front or behind the shaft comes down
 * into the foot in one outline: it was little more than half that, and every boot was a stovepipe stood on a peg.
 */
function footMesh(): Mesh {
  const v: V3[] = [
    [-0.42, -0.58, -0.75], [0.42, -0.58, -0.75], [0.38, 1.72, -0.75], [-0.38, 1.72, -0.75],
    [-0.46, -0.6, -0.6], [0.46, -0.6, -0.6], [0.4, 1.78, -0.6], [-0.4, 1.78, -0.6],
    [-0.56, -0.56, 0.02], [0.56, -0.56, 0.02], [0.52, 0.62, -0.14], [-0.52, 0.62, -0.14],
    [0.32, 1.74, -0.36], [-0.32, 1.74, -0.36],
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
  const half = (from: number, to: number, foot: boolean, shin: boolean): Mesh => {
    const t = rings(rs.slice(from, to + 1), n, (band, j) => m(band + from, j), { top: false, bottom: foot });
    const z0 = rs[from][0];
    return {
      ...t,
      f: t.f.map((f) => (f.i.every((i) => t.v[i][2] === z0) && foot ? { ...f, seam: true } : f.i.some((i) => t.v[i][2] === 0) ? { ...f, soft: true, crease: shin && f.i.every((i) => t.v[i][1] < 0) } : f)),
    };
  };
  // `shut`: the foot of the shin closed, the lid a seam (`Face.seam`), for a leg that comes down to the foot -- kicked up behind at a
  // run, the open end of it was turned to the viewer, a ring with nothing in it.
  // The shin's facets at the back of the knee are its crease (`Face.crease`).
  return { thigh: half(knee, rs.length - 1, false, false), shin: half(0, knee, shut, true) };
}

/** A winding round a limb: every ring tipped across it, so the bands slant round it rather than going round it level. */
const wound = (m: Mesh, slant = 0.14): Mesh => ({ ...m, v: m.v.map(([x, y, z]): V3 => [x, y, z + slant * x]) });

/**
 * How wide a thigh is at the top: wider on wider hips, but by less than they
 * are. Grown with them all the way, a woman's thighs stood out past the hem of
 * a skirt at either side.
 */
const thighTop = (fr: Frame): number => 0.55 + 0.45 * fr.hi;

/** The body's tunic skirt, bottom first, in the hips' frame: hem, the trim's top, over the hips, the waist. */
const shirtSkirt = (fr: Frame): number[][] => [[-1.35, 1.92 * fr.hi, 1.55], [-1.08, 1.9 * fr.hi, 1.53], [0.2, 1.74 * fr.hi, 1.36], [1.25, 1.53 * fr.wa, 1.22]];
/** How far out toward the tunic skirt's eight sides, of the way, the top of a thigh may come (`underHem`). */
const HEM_ROOM = 0.84;
/**
 * The top of a thigh -- the body's own, or a legging's, made for the right leg in the knee's terms -- kept inside the tunic's skirt
 * over it: every corner above the hem drawn in toward the middle of the hips to `HEM_ROOM` of the way out to the skirt's sides at its
 * height, and no corner that is already inside moved. The thigh's top ring is as wide as the hips want it at the fork, and its
 * outer corners stood outside the skirt, which narrows over the hips: seen from behind or three-quarters away, with the camera
 * looking down, the outer side of the thigh's top was drawn up past the hem beside it as a thin spike of trouser to the belt.
 */
function underHem(m: Mesh, fr: Frame): Mesh {
  const sk = shirtSkirt(fr), z0 = sk[0][0], z1 = sk[sk.length - 1][0];
  // From the knee's terms to the hips': the thigh's frame is `THIGH` under the hip joint, which is a tenth under the hips'.
  const lift = THIGH * fr.tall + 0.1, edge = Math.cos(Math.PI / 8);
  return {
    ...m,
    v: m.v.map((p): V3 => {
      const z = p[2] - lift;
      if (z < z0) return p;
      const [, R, D] = profileAt(sk, Math.min(1, (z - z0) / (z1 - z0)));
      const x = fr.hi + p[0], u = x / R, w = p[1] / D;
      // How far out toward the eight-sided skirt's sides, its corners being half a step round from straight across.
      let out = 0;
      for (let k = 0; k < 4; k++) out = Math.max(out, Math.abs(u * Math.cos((k * Math.PI) / 4) + w * Math.sin((k * Math.PI) / 4)));
      out /= edge;
      if (out <= HEM_ROOM) return p;
      const q = HEM_ROOM / out;
      return [x * q - fr.hi, p[1] * q, p[2]];
    }),
  };
}

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

/**
 * And of an arm raised high, the short sleeve's hem drawn in to the arm, all of it by `HEM_RAISED[1]` degrees of turn from where
 * the arm hangs and none under `HEM_RAISED[0]`: raised overhead, the camera looks up the sleeve from the elbow, and the turn of the
 * hem in to the skin was a hexagonal ring of lit cloth round the arm with the skin inside it, a cap of its own on the arm. Drawn in,
 * the sleeve closes on the arm as cloth does when the arm goes up through it, and what shows is the trim round it.
 */
const HEM_RAISED: [number, number] = [45, 95];
/** How far round from the arm the hem's outer ring is drawn in, raised all the way: to a hair outside the skin under it. */
const HEM_DRAWN = 0.64;
function hemDrawnIn(v: readonly V3[], r: Rig, k: number, fr: Frame): V3[] | undefined {
  const t = ramp(shoulderTurn(r, k).angle / DEG, HEM_RAISED[0], HEM_RAISED[1]);
  if (t <= 0) return undefined;
  const hem = -UPPER * fr.tall + ELBOW_BEND + HEM_CLEAR;
  return v.map((p) => {
    if (Math.abs(p[2] - hem) > 1e-6) return p;
    const round = Math.hypot(p[0] / 0.72, p[1] / 0.7);
    if (round < 0.95) return p;
    const s = 1 + t * (HEM_DRAWN / 0.72 - 1);
    return [p[0] * s, p[1] * s, p[2]];
  });
}

/** The bare forearm, from the elbow's ring down to the wrist: fullest a little under the elbow, as a forearm is, and narrowing to the wrist. */
function bareLower(): Mesh {
  const [, ex, ey] = elbowRing(0.9);
  return softAt(rings([[-2.3, 0.44, 0.41], [-1.0, 0.56, 0.52], [-ELBOW_BEND, 0.58, 0.55], [0, ex, ey]], 6, 'skin', { top: false }), 0);
}

/** How far open each of the open hands made is, from closed (nought) to spread (one); and under how open a hand is a fist still. */
const OPENING = [1 / 3, 2 / 3, 1];
const OPEN_LEAST = 1 / 6;

/** An open hand on side `s`, `u` of the way from closed to spread: see `kitOf`. */
function openHand(s: number, u: number): Mesh {
  // How far each finger is curled in toward the palm from its knuckle, and the fan of them drawn in, the more the less open.
  const curl = (1 - u) * 95 * DEG, fan = 0.35 + 0.65 * u, k = 1 + 0.15 * u;
  return handSized(grownBy(k, join(
    rings([[-0.88, 0.17, 0.49], [-0.5, 0.22, 0.5], [0.08, 0.23, 0.38]], 6, 'skin'),
    ...([[0.35, 0.52, 28], [0.12, 0.6, 9], [-0.12, 0.56, -9], [-0.35, 0.44, -28]] as Array<[number, number, number]>).map(([y, l, a]) => {
      const q = a * fan * DEG;
      const tip: V3 = [-s * l * Math.sin(curl), y + l * Math.sin(q) * Math.cos(curl), -0.84 - l * Math.cos(q) * Math.cos(curl)];
      return fine(chain([[0, y, -0.84], tip], [0.12, 0.09], 4, 'skin'), 0.24 * k * HAND);
    }),
    fine(chain([[-s * 0.06, 0.32, -0.18], [-s * (0.08 + 0.12 * (1 - u)), 0.62 - 0.12 * (1 - u), -0.46], [-s * (0.08 + 0.3 * (1 - u)), 0.78 - 0.3 * (1 - u), -0.74]], [0.13, 0.11, 0.08], 4, 'skin'), 0.26 * k * HAND),
  )));
}

/*
 * Hands shaped for a spell: a claw, a cup, a flat palm, a pointing finger,
 * two fingers in a vee. The fist, the loose hand and the open ones are each
 * their own mesh, and a hand goes from one to the next a step at a time;
 * these are all one mesh in different places -- the palm, each finger in
 * two joints and the thumb, in the same vertices in the same order -- so a
 * hand can be any blend of them, and come out of a closed hand into any of
 * them smoothly. The fingers are four-sided tubes drawn to a point rather
 * than capped, which keeps the hand within a few facets of the open one.
 */
type HandShapeName = 'closed' | typeof HAND_SHAPES[number];
/** Each finger, thumb side first: where it leaves the palm across the hand, how long, and how far out it fans when spread, in degrees. */
const FINGERS: Array<[number, number, number]> = [[0.35, 0.52, 28], [0.12, 0.6, 9], [-0.12, 0.56, -9], [-0.35, 0.44, -28]];
/** Each shape: each finger's bend at the knuckle and at the middle joint and its share of the fan, the thumb's opening, and the size. */
const HAND_SPECS: Record<HandShapeName, { f: Array<[number, number, number]>; thumb: number; k: number }> = {
  closed: { f: [[92, 88, 0.3], [92, 88, 0.3], [92, 88, 0.3], [92, 88, 0.3]], thumb: 0, k: 1 },
  claw: { f: [[38, 72, 1.15], [38, 72, 1.05], [38, 72, 1.05], [38, 72, 1.15]], thumb: 0.55, k: 1.1 },
  cup: { f: [[34, 36, 0.12], [34, 36, 0.12], [34, 36, 0.12], [34, 36, 0.12]], thumb: 0.45, k: 1.08 },
  flat: { f: [[0, 0, 0.1], [0, 0, 0.1], [0, 0, 0.1], [0, 0, 0.1]], thumb: 0.75, k: 1.12 },
  point: { f: [[0, 0, 0.15], [94, 86, 0.3], [94, 86, 0.3], [94, 86, 0.3]], thumb: 0.15, k: 1.05 },
  two: { f: [[0, 0, 1.1], [0, 0, 1.1], [94, 86, 0.3], [94, 86, 0.3]], thumb: 0.15, k: 1.05 },
};

/** A tube through `pts`, `n`-sided, open at both ends, each ring turned about the line by `ref` -- the same at every bend, so tubes bent differently are alike vertex for vertex. */
function tube(pts: V3[], rs: number[], ref: V3, n: number, mat: Mat): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const d = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const u = unit([ref[0] - d[0] * dot(ref, d), ref[1] - d[1] * dot(ref, d), ref[2] - d[2] * dot(ref, d)]);
    const w = cross(d, u);
    for (let j = 0; j < n; j++) {
      const t = ((j + 0.5) / n) * TAU, c = Math.cos(t) * rs[k], sn = Math.sin(t) * rs[k];
      v.push([pts[k][0] + u[0] * c + w[0] * sn, pts[k][1] + u[1] * c + w[1] * sn, pts[k][2] + u[2] * c + w[2] * sn]);
    }
  }
  for (let k = 0; k < pts.length - 1; k++) {
    for (let j = 0; j < n; j++) f.push({ i: [k * n + j, k * n + (j + 1) % n, (k + 1) * n + (j + 1) % n, (k + 1) * n + j], m: mat });
  }
  return mesh(v, f);
}

/** A hand on side `s` in shape `name` (see `HAND_SPECS`): the open hand's palm, each finger bent toward the palm at two joints. */
function shapedHand(s: number, name: HandShapeName): Mesh {
  const spec = HAND_SPECS[name], k = spec.k, u = spec.thumb;
  return handSized(grownBy(k, join(
    rings([[-0.88, 0.17, 0.49], [-0.5, 0.22, 0.5], [0.08, 0.23, 0.38]], 6, 'skin'),
    ...FINGERS.map(([y, l, fan], i) => {
      const [a, b, share] = spec.f[i], q = fan * share * DEG;
      // Straight, a finger runs down the hand fanned out by `q`; bent, toward the palm, which faces the body's middle.
      const along = (bend: number): V3 => [-s * Math.sin(bend * DEG), Math.sin(q) * Math.cos(bend * DEG), -Math.cos(q) * Math.cos(bend * DEG)];
      const K: V3 = [0, y, -0.84], d1 = along(a), d2 = along(a + b);
      const M: V3 = [K[0] + d1[0] * l * 0.55, K[1] + d1[1] * l * 0.55, K[2] + d1[2] * l * 0.55];
      const P: V3 = [M[0] + d2[0] * l * 0.45, M[1] + d2[1] * l * 0.45, M[2] + d2[2] * l * 0.45];
      return fine(tube([K, M, P], [0.12, 0.1, 0.035], [0, Math.cos(q), Math.sin(q)], 4, 'skin'), 0.24 * k * HAND);
    }),
    fine(tube([[-s * 0.06, 0.32, -0.18], [-s * (0.08 + 0.12 * (1 - u)), 0.62 - 0.12 * (1 - u), -0.46], [-s * (0.08 + 0.3 * (1 - u)), 0.78 - 0.3 * (1 - u), -0.76]], [0.13, 0.11, 0.035], [1, 0, 0], 4, 'skin'), 0.26 * k * HAND),
  )));
}

/** The vertices of hand `k` blended to `want` from closed, or nothing when it asks for no shape. */
function shapedOf(kit: Kit, r: Rig, k: number): V3[] | undefined {
  const want = r.shape?.[k];
  if (!want) return undefined;
  let total = 0;
  for (const n of HAND_SHAPES) total += Math.max(0, want[n] ?? 0);
  if (total < 0.05) return undefined;
  const set = kit.shaped[k], base = set.closed.v, scale = total > 1 ? 1 / total : 1;
  const v = base.map((p): V3 => [p[0], p[1], p[2]]);
  for (const n of HAND_SHAPES) {
    const w = Math.max(0, want[n] ?? 0) * scale;
    if (!w) continue;
    const to = set[n].v;
    for (let i = 0; i < v.length; i++) {
      v[i][0] += (to[i][0] - base[i][0]) * w;
      v[i][1] += (to[i][1] - base[i][1]) * w;
      v[i][2] += (to[i][2] - base[i][2]) * w;
    }
  }
  return v;
}

/**
 * The leg in the body's trousers, bottom first, the knee's ring at nought (`legTube`): down into the boot only a little way past
 * the top of its cuff (`bodyBoot`). It went down to the ankle's end of the cuff, and on a leg kicked back, when the leg is drawn
 * over the boot (`Part.front`), the trouser came down over the cuff in a V.
 */
const bareLeg = (fr: Frame): number[][] => [
  [-1.4, 0.716, 0.756, 0, -0.006], [-KNEE_SPAN, 0.78, 0.82, 0, -0.03], [0, 0.8, 0.84], [KNEE_SPAN, 0.84, 0.88], [THIGH * fr.tall - 0.8, thighTop(fr), 1.04],
];
/** How far the body's boot cuff stands out over the shaft under it, and how close over the trouser leg its top comes in. */
const CUFF_PROUD = 0.04;
const CUFF_HUG = 0.01;
/**
 * The body's own boot, bottom first: the shaft from the ankle, and a turned-down cuff from `-1.62` up to `-1.3`, standing
 * `CUFF_PROUD` over the shaft at its foot and coming in at its top to `CUFF_HUG` over the trouser leg in it (`bareLeg`), so the
 * leg goes into the boot with nothing between them to see. It was a third tube a tenth wider than the leg, open at the top: the
 * trouser ended in it in a V with the dark inside of the boot round it, and from behind the cuff and a dark hexagonal collar under
 * it were stacked on the shaft. Closed with a lid down to the leg instead, the far half of the lid was drawn over the leg in front of
 * it, the boot being drawn after the leg, a dark line across the trouser.
 */
function bodyBoot(fr: Frame): Mesh {
  const leg = bareLeg(fr), z0 = leg[0][0], z1 = leg[leg.length - 1][0];
  const [z, rx, ry, cx, cy] = profileAt(leg, (-1.3 - z0) / (z1 - z0));
  const shaft = [-1.66, 0.72, 0.76];
  return rings([
    [-3.15, 0.61, 0.64], [-3.02, 0.66, 0.7], shaft, [-1.62, shaft[1] + CUFF_PROUD, shaft[2] + CUFF_PROUD], [z, rx + CUFF_HUG, ry + CUFF_HUG, cx, cy],
  ], 6, (band) => (band === 3 ? 'cuff' : 'boot'), { top: false });
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
    skirt: rings(shirtSkirt(fr), 8, (band) => (band === 0 ? 'trim' : 'tunic'), { top: false, bottom: false }),
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
    // And part way open, a third and two thirds (`OPENING`): the fingers hinged at the knuckles and curled toward the palm, closer
    // together, and the thumb in toward them, so a hand opening to wave uncurls over a few frames rather than going from a fist to a fan.
    open: [-1, 1].map((s) => OPENING.map((u) => openHand(s, u))) as [Mesh[], Mesh[]],
    // Hanging loose at a walk: the fingers together and a little curled toward the palm, flat across and as broad as the open
    // hand, with the thumb lying along the front of it -- longer and flatter than the fist, which is what reads as a hand not
    // holding anything rather than one clenched on nothing.
    loose: [-1, 1].map((s) => handSized(join(
      rings([[-1.2, 0.15, 0.3, -s * 0.07, 0.04], [-0.86, 0.19, 0.42, -s * 0.03, 0.02], [-0.45, 0.22, 0.45], [0.08, 0.24, 0.37]], 6, 'skin'),
      chain([[-s * 0.1, 0.3, -0.18], [-s * 0.16, 0.42, -0.46], [-s * 0.16, 0.42, -0.7]], [0.12, 0.1, 0.07], 4, 'skin'),
    ))) as [Mesh, Mesh],
    shaped: [-1, 1].map((s) => Object.fromEntries((['closed', ...HAND_SHAPES] as HandShapeName[]).map((n) => [n, shapedHand(s, n)]))) as Kit['shaped'],
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
    // Its top kept inside the tunic's skirt (`underHem`): made for the right leg, and mirrored for the left.
    ...((t) => ({ thigh: underHem(t.thigh, fr), shin: t.shin }))(legTube(bareLeg(fr), 6, 'trousers', true)),
    // Bottom first, so the facets face out: made top first it was inside out, its far side drawn in its place and lit as the near
    // side would be from the other side, and a shin folded up behind at a run showed the inside of the shaft.
    boot: bodyBoot(fr),
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
  /** A tiller in hand, from where it is pivoted on the rudder's head to its end in the fist, and its wood as `#rrggbb`: see `steer`. */
  tiller?: { pivot: V3; end: V3; wood?: string };
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
  /**
   * How far each hand is open, from closed (nought) to spread (one): a float rather than a switch, so that a hand opening to wave
   * or closing again uncurls and curls its fingers over a few frames (`kit.open`'s steps) instead of snapping from a fist to a fan. `true` is one, so a pose written before the float still reads.
   */
  open: [number | boolean, number | boolean];
  /** Each hand hanging loose, neither open nor closed: walking with nothing in it. */
  loose: [boolean, boolean];
  /** And how far a loose hand's fingers are curled in toward the palm, from hanging straight (nought) to closed (one): see `curled`. */
  curl: [number, number];
  /** The hands wanted for something else -- work, the water, the reins, a wave or a hop -- and whatever they held put away. */
  stowed: boolean;
  /** Which shoulder something heavy is carried over: the right (1), or the left (0) from where the right would put it behind the head. */
  carried: number;
  /** How much further it is turned about itself there, in degrees, to show its head to the viewer. */
  spin: number;
  /**
   * Something heavy on its way from one shoulder to the other in both hands: the weapon's own frame, in the hips' frame, which
   * the hands are put on rather than it hung from either (see `shoulder`). Absent on a shoulder.
   */
  swapping?: Xf;
  /** The facing a blade in the fist is carried for, following the body's round more slowly than it turns (see `settle`). */
  bladeFacing?: number;
  /**
   * A weapon in the right fist carried by the forearm rather than set off the hips, this share of the way: a blow
   * struck by a spell (`./spells`), where the swing of the arm has to be the swing of the blade. Nought or absent
   * is the carry as it always was.
   */
  wield?: number;
  /*
   * What follows is all for the spells' casts (`./spells`), and all of it
   * optional: a pose that sets none of it is drawn exactly as it always was.
   * The numbers are shares or degrees that a cast blends in from nought
   * (`castOver` in ./spells/index), so each comes in smoothly with the cast.
   */
  /**
   * A spear or a javelin (`carry 'staff'`) taken by the arms rather than stood upright off the hips, this share of the way: held
   * in the right fist along the line of the forearm, its point out past the knuckles -- or, with `both`, along the line from the
   * right fist through the left -- so a thrust levels it, a sweep swings it low and a brace grounds its butt.
   */
  wieldStaff?: number;
  /**
   * A bow taken by the left fist rather than stood off the hips, this share of the way: its stave through the fist as a haft is
   * held, and its back out past the knuckles, so the bow arm aims it. Put the hand with `reach` and a `haft` straight up to stand
   * the stave upright, leant to cant it; or turn the hand about the forearm (`hand[0]`).
   */
  wieldBow?: number;
  /**
   * The other hand on the haft too, this share of the way: for a weapon in the right fist or over a shoulder, that hand is put on
   * the haft `bothAt` from the first fist and closed on it; for a spear with `wieldStaff`, the shaft runs from the right fist
   * through the left wherever the pose puts it, and the left closes on it there.
   */
  both?: number;
  /** Where along the haft the second hand closes, in units from the first fist: toward the head above nought, toward the butt below. */
  bothAt?: number;
  /**
   * How far the weapon in the right fist (or the shouldering fist) is turned in it, in degrees, its head toward the line of the
   * forearm past the knuckles -- where a wrist would have to bend to do it -- from where the carry holds it: square across the fist
   * for something shouldered, a third of the way along for a blade with `wield`, along the forearm for a spear with `wieldStaff`.
   * About 150 with `wield` is a blade held point down, reversed in the fist.
   */
  haft?: number;
  /** How far the weapon is slid through the fist toward its point, in units: a spear held near its butt for a long thrust. */
  slide?: number;
  /** A bow's string drawn back to the right hand's fingers, this share of the way from straight. */
  draw?: number;
  /** An arrow on the string, its nock where the string is drawn to and its shaft over the bow hand. */
  nocked?: boolean;
  /** The right hand emptied -- what was in it thrown -- without putting anything away: the weapon is not drawn, the shield stays on. */
  thrown?: boolean;
  /**
   * Each hand put at a place, left then right, rather than posed joint by joint: the middle of the hand at `at`, in the body's
   * own frame from the middle of its feet as `figureJoint` gives it (x to the right, y ahead, z up), the elbow toward `pole`
   * (default down, back and out to its own side) and, given `haft`, the fist closed on something running that way. `w` of the
   * way from the pose's own arm (one when left out). Out of reach, the hand reaches as far as it goes toward the place.
   */
  reach?: [HandGoal | undefined, HandGoal | undefined];
  /** Each hand's shape, left then right, as shares of each shape: see `HandShape`. Over whatever `open` and `loose` say. */
  shape?: [HandShape | undefined, HandShape | undefined];
  /** The mouth open, this share of the way to a shout. */
  mouth?: number;
  /**
   * Down on one knee, this share of the way: the knee on the ground with its toes tucked under behind it, the other foot flat
   * ahead with the thigh over it all but level. The right knee unless `kneelLeft`. Not on the move.
   */
  kneel?: number;
  kneelLeft?: boolean;
}

/** Where a hand is put: see `Rig.reach`. */
export interface HandGoal {
  at: V3;
  w?: number;
  pole?: V3;
  haft?: V3;
  /** Bow the trunk forward over the hips as far as it takes for the hand to get there (down to the ground, say), and no further. */
  stoop?: boolean;
}

/**
 * A hand's shape, as shares of each, blended from a closed hand: `claw` fingers spread and bent hard at the middle joints; `cup`
 * fingers together, bent a little at both, a bowl; `flat` straight and together, an offering palm (turned up by the hand's roll);
 * `point` the forefinger out straight, the rest curled; `two` the fore and middle fingers out in a vee.
 */
export interface HandShape { claw?: number; cup?: number; flat?: number; point?: number; two?: number }
const HAND_SHAPES = ['claw', 'cup', 'flat', 'point', 'two'] as const;

function rest(): Rig {
  return {
    at: [0, 0, 0], pelvis: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    arm: [[4, 8, 0], [4, 8, 0]], elbow: [10, 10], hand: [[0, 0, 0], [0, 0, 0]],
    leg: [[0, 2, 0], [0, 2, 0]], knee: [3, 3], foot: [0, 0], flat: [true, true],
    tail: [0, 0, 0], lift: 0, sink: 0, blink: false, reins: false, tool: false, lefty: false, shrug: [0, 0], open: [0, 0], loose: [false, false], curl: [0, 0], stowed: false, carried: 1, spin: 0,
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
  r.curl = [r.curl[1], r.curl[0]];
  if (r.plant) r.plant = [r.plant[1], r.plant[0]];
  if (r.shape) r.shape = [r.shape[1], r.shape[0]];
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
   * A tiller's pivot, on the head of the rudder, in the same frame, and its wood as `#rrggbb`: given, the tiller is the
   * driver's to draw, swung about it with the hand, and whatever draws the hull leaves it out of her.
   */
  pivot?: V3;
  wood?: string;
  /**
   * How far the hull under the seat is heeled over to the body's right and pitched bow down, in degrees, as whoever draws
   * the hull has it this moment: the body is carried over with her by that, and balances against it.
   */
  sway?: { heel: number; pitch: number };
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
 * Which way leg `k`'s foot points along the ground as `r` has it, in
 * degrees round to the left from straight ahead: the hips, the leg and the
 * foot kept level, as `skeleton` puts them together.
 */
function footYaw(r: Rig, fr: Frame, k: number): number {
  const T = fr.tall, s = k ? 1 : -1, [lp, la, lt] = r.leg[k];
  const pelvis = joint(ROOT, [r.at[0], r.at[1], HIP * T + r.at[2]], ...r.pelvis);
  const knee = joint(joint(pelvis, [s * fr.hi, 0, -0.1], lp, -s * la, s * lt), [0, 0, -THIGH * T], -r.knee[k]);
  const ankle = joint(knee, [0, 0, -SHIN * T], (r.flat[k] ? -(r.pelvis[0] + lp - r.knee[k]) : 0) + r.foot[k]);
  return Math.atan2(-ankle.m[1], ankle.m[4]) / DEG;
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
/** How far down a standing body looks at most, in degrees: see `idle`. */
const LOOK_LEAST = -24;
/** And how much of that the neck and the head take, the chest bowing the rest. */
const LOOK_BOW = -16;
/**
 * Under a helm with a brim and a nasal the face is gone from in front at
 * far less than that, so there the head and the chest each bow no further
 * than this, and the hand is looked down at: bowed to it, the brim and
 * nasal covered all of the face but a strip. Brought up higher to the
 * eyes instead, the gauntlet was held in front of the face.
 */
const LOOK_BOW_HELM = -7;
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
 *
 * The two arms are not one arm twice: the left hangs a little straighter
 * and further forward, the right more bent with its hand turned further in,
 * and both hands loose rather than fists. The look at a hand is at one with
 * nothing in it (`busy`, left then right): the right, or the left when the
 * right holds something -- looked at, a sword's blade came up through the
 * body and a spear's shaft across the face -- and none when both are full.
 * And the eyes go to where the hand is, wherever that is.
 */
function idle(r: Rig, t: number, fr: Frame, busy: [boolean, boolean] = [false, false], helmed = false): void {
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
  // Far enough over, and the shoulders up enough with each breath, to be a pixel or two at the sizes the island is played at: less
  // was a body stood still there.
  r.pelvis = [0, -5.5 * w, -2.5 * w];
  r.at = [0.62 * w, 0, 0];
  r.spine = [0.5 * b, 3.6 * w, 1.6 * w];
  r.chest = [1.8 * b, 2.4 * w, 0.9 * w];
  r.neck = [-0.8 * b, -1 * w, 0];
  r.shrug = [0.15 * (b + 1), 0.15 * (b + 1)];
  // Clear of the hips: wider set ones, under narrower shoulders, hang the arms further out.
  const out = Math.max(5, Math.asin(Math.min(1, (1.55 * fr.hi + 0.85 - 2.1 * fr.sh) / 4.6)) / DEG - 2);
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    /*
     * Relaxed, the upper arm turned in at the shoulder and the elbow bent a
     * little, so the forearm comes forward and in and the hand hangs in front
     * of the side of the thigh, its fingers loosely curled. The elbows were
     * bent a few degrees straight forward and the upper arms not turned, so
     * from in front the arms hung straight, out from the body in an A, with
     * flat hands on the ends: a mannequin's.
     */
    r.arm[k] = [(k ? 2 : 5) + 1.2 * b + (k ? -1 : 1) * w, out + (k ? 0 : 1) + 0.8 * b - s * 9 * lag, k ? 22 : 15];
    r.elbow[k] = (k ? 27 : 21) + 2 * b + 2 * (k ? Math.max(0, w) : Math.max(0, -w));
    // The hands hanging relaxed, bent a little back off the forearm and turned in toward the thigh, the right further.
    r.hand[k] = [k ? 9 : 5, 0, -s * (k ? 8 : 3)];
    r.loose[k] = true;
    r.curl[k] = k ? 0.5 : 0.35;
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
  // And a look at a free hand from twelve seconds in: the forearm brought up, the hand turned over and back, and let down.
  const lk = step(tt, 12.1, 12.7) * (1 - step(tt, 13.7, 14.4));
  const k: number = !busy[1] ? 1 : !busy[0] ? 0 : -1;
  if (lk > 0 && k >= 0) {
    const s = k ? 1 : -1;
    const over = Math.sin(Math.PI * step(tt, 12.6, 13.8));
    r.arm[k] = [r.arm[k][0] + 24 * lk, r.arm[k][1] - 2 * lk, r.arm[k][2] + 18 * lk];
    r.elbow[k] += 80 * lk;
    r.hand[k] = [r.hand[k][0] * (1 - lk) + 8 * lk, 0, r.hand[k][2] * (1 - lk) - s * 55 * over];
    // Where the eyes are and where the hand is, in the chest's frame, which the neck and the head turn from: the look is the way
    // from the one to the other, the neck taking a third of it. It was a nod by so much, which side on put the eyes past a hand
    // held up at the chin. Bowed no further than leaves the face to be seen from above, though the eyes go a little further.
    const bones = skeleton(fr, r), c = bones.chest.m;
    const eye = place(bones.head, [0, 1.3, 1.45]), hand = place(bones[`wrist${k}`], [0, 0, -0.55]);
    const v: V3 = [hand[0] - eye[0], hand[1] - eye[1], hand[2] - eye[2]];
    const d: V3 = [c[0] * v[0] + c[3] * v[1] + c[6] * v[2], c[1] * v[0] + c[4] * v[1] + c[7] * v[2], c[2] * v[0] + c[5] * v[1] + c[8] * v[2]];
    const look = Math.max(LOOK_LEAST, Math.atan2(d[2], Math.hypot(d[0], d[1])) / DEG), yaw = Math.atan2(-d[0], d[1]) / DEG;
    // The neck and the head bow no further than `LOOK_BOW` and the chest the rest: bowed the whole way, a helm's crown and nasal
    // filled the face from in front.
    const nod = Math.max(helmed ? LOOK_BOW_HELM : LOOK_BOW, look);
    r.chest[0] += Math.max(helmed ? LOOK_BOW_HELM : -90, look - nod) * lk;
    r.neck = [r.neck[0] * (1 - lk) + 0.35 * nod * lk, r.neck[1], r.neck[2] * (1 - lk) + 0.35 * yaw * lk];
    r.head = [r.head[0] * (1 - lk) + 0.65 * nod * lk, r.head[1], r.head[2] * (1 - lk) + 0.65 * yaw * lk];
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
  { at: 0.42, v: [-17, 66, -30] },
  { at: 0.55, v: [12, 96, -12] },
  { at: 0.67, v: [38, 76, 0] },
  { at: 0.79, v: [48, 48, 8] },
  { at: 0.89, v: [38, 22, 10] },
  { at: 0.95, v: [28, 14, 8] },
];
/**
 * Seen from in front or behind, the running leg in the air, as far as the
 * body is square on to the viewer: its shin let back no further than this
 * many degrees from the thigh's line, its foot carried out to the side by as
 * much as this many units at the middle of the swing, so the knee goes out
 * a little with it, and the thigh driven up by as much as this many degrees
 * more through the swing, to no more than the last from upright. The knee
 * driven up with the shin folded under it was a thigh pointed at the viewer
 * with a flat cut for an end -- a stump, the shin a twentieth of its length
 * on the screen; with the shin let down and no more, the legs were two posts
 * and the boots never left the ground on the screen (a step toward the
 * viewer goes down the screen as far as the lift goes up it). Lifting the
 * knee itself, with the shin hanging under it, puts the boot up the screen.
 */
const RUN_FRONT = [30, 0.7, 55, 80];
/**
 * One stride in each four, walking or running, done a little differently,
 * so that a body going a long way does not read as one stride drawn over and
 * over: each row is a stride's [left arm's reach, right arm's reach (shares
 * more or less), the hips' turn (degrees more), the elbows (degrees more
 * bent), and a glance (degrees the head turns, to its left)]. One goes into
 * the next through the stride rather than at its end, and each body starts
 * the four at its own place (`strideSeed`), so two walking side by side are
 * not in step with each other's.
 */
const WALK_VARY = [
  [0, 0, 0, 0, 0],
  [0.07, -0.04, 1.4, 4, -3],
  [-0.05, 0.06, -0.8, -3, 1],
  [0.03, 0.08, 0.6, 2, 4],
];
/** Where in `WALK_VARY` a body starts, from who it is: a whole number of strides added to its walk's phase. */
function strideSeed(id: string | undefined): number {
  let h = 0;
  for (let i = 0; id && i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % WALK_VARY.length) + WALK_VARY.length) % WALK_VARY.length;
}
/** Walking, how far the elbow is bent with the arm back, and how much further as it comes forward, in degrees. */
const WALK_ELBOW = [24, 22];
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
  { at: 0, v: [0.22] },
  { at: 0.28, v: [0.48] },
  { at: 0.6, v: [0.12] },
  { at: 0.8, v: [-0.08] },
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
function walk(r: Rig, phi: number, g: number, fr: Frame, facing = 2): void {
  const L = (a: number, b: number): number => a + (b - a) * g;
  const frac = (x: number): number => x - Math.floor(x);
  const T = fr.tall, A = THIGH * T, B = SHIN * T;
  // This stride's way of being done, going into the next's (see `WALK_VARY`).
  const n = Math.floor(phi / TAU), into = ease(phi / TAU - n), N = WALK_VARY.length;
  const va = WALK_VARY[((n % N) + N) % N], vb = WALK_VARY[(((n + 1) % N) + N) % N];
  const vary = (j: number): number => (clearingNow ? 0 : va[j] + (vb[j] - va[j]) * into);
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
  const hipsAt = (u: number): number => -(L(6, 9) + vary(2)) * Math.cos(TAU * u);
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
  // On the ground from the heel strike to the toe leaving it, the weight coming on and going off over a few hundredths.
  const onOf = (early: number): number => ramp(early, -L(0.04, 0.08), L(0.02, 0.04)) * (1 - ramp(early, down - 0.07, down));
  const legs = [0, 1].map((k) => {
    // Its stride, counted from a little before the heel comes down so the weight can come onto it as it lands.
    const u = frac(u0 + k / 2), early = u > 0.8 ? u - 1 : u;
    return { u: early, q: keyed(u), on: onOf(early) };
  });
  /*
   * Never higher than a foot on the ground reaches with its knee all but
   * straight, which would leave it standing on nothing: let down smoothly
   * toward that rather than stopped at it in a kink -- and, coming down to
   * land, let down toward it from before the foot is down, as a body falling
   * onto a leg is, rather than as the weight came on in a frame: at a run that
   * dropped the hips a third of a unit in one frame, onto the foot.
   */
  const short = (k: number, w: number, h: number): number => {
    const u = frac(w + k / 2), early = u > 0.8 ? u - 1 : u, on = onOf(early);
    if (on <= 0) return 0;
    const [y, z] = ankleOf(k, early, keyed(u)[2], h);
    const by = -z - Math.sqrt(Math.max(0, reach * reach - y * y));
    return by > -0.06 ? on * (by > 0.06 ? by : ((by + 0.06) * (by + 0.06)) / 0.24) : 0;
  };
  {
    const at = (w: number): number => {
      const s = frac(2 * w), h = H0 - L(loop(WALK_DROP, s)[0], loop(RUN_DROP, s)[0]);
      return Math.max(short(0, w, h), short(1, w, h));
    };
    const d = L(0, 0.035);
    H -= d > 0 ? 0.25 * at(u0 - d) + 0.5 * at(u0) + 0.25 * at(u0 + d) : at(u0);
  }
  // The hips turn with the leading leg, and drop on the side whose leg is off the ground, most just after the other heel takes the
  // weight; the body goes over the foot it is on, most of a hand's breadth to each side at a walk. The back takes the hips' turn and
  // drop back out, so the lean is along the way of going and the shoulders turn against the hips from square.
  const hips = hipsAt(u0);
  r.pelvis = [tip, drop, hips];
  r.at = [-L(0.3, 0.12) * Math.sin(TAU * (u0 - 0.02)), 0, 0];
  /*
   * The legs put where the feet go, in the round. The ankle was solved in
   * the leg's own fore-and-aft plane alone, which the hips' turn swings
   * from side to side: a planted foot twisted seven degrees either way and
   * its ball skated a hand's breadth across the ground under every step.
   * Now each foot has a line along the ground -- out to its own side, a
   * little wider at a walk than at a run -- and is turned out a few
   * degrees, and the ankle is put on that line in three dimensions from
   * wherever the hips are, the leg turned against the hips' turn so the
   * foot keeps pointing the same way: on the ground, at the even pace the
   * keys imply; in the air, where the keyed thigh and knee carry it.
   */
  const pelvisXf = joint(ROOT, [r.at[0], r.at[1], HIP * T], ...r.pelvis);
  const ground = HIP * T - 0.1 - H;
  // How square on to the viewer, in front or behind, the body is seen, at a run (see `RUN_FRONT`).
  const front = g * Math.max(0, Math.min(1, (Math.abs(Math.cos(facing * 45 * DEG)) - 0.5) / 0.5));
  r.plant = [0, 0];
  for (let k = 0; k < 2; k++) {
    const { u, q, on } = legs[k];
    const s = k ? 1 : -1;
    // A degree and a half more out on the left than the right: nobody's two feet are the same.
    const out = L(5, 2) + (k ? 0 : 1.5), yaw = -s * out;
    const lineX = s * (fr.hi + L(0.28, 0.1));
    r.leg[k] = [0, 0, -out - s * hips];
    // In the air: the keyed thigh and knee from the hip -- seen from in front or behind at a run, the shin let down and the foot
    // carried out to the side (see `RUN_FRONT`).
    const hip = place(pelvisXf, [s * fr.hi, 0, -0.1]);
    const wide = front * (1 - on) * Math.sin(Math.PI * Math.max(0, Math.min(1, (u - down) / (1 - down))));
    const thigh = q[0] + Math.min(Math.max(0, RUN_FRONT[3] - q[0]), RUN_FRONT[2] * front * (1 - on) * Math.sin(Math.PI * Math.max(0, Math.min(1, (u - 0.45) / 0.52))));
    const knee = q[1] + (thigh - q[0]) - front * (1 - on) * Math.max(0, q[1] - q[0] - RUN_FRONT[0]);
    const air: V3 = [lineX + s * RUN_FRONT[1] * wide, hip[1] + A * Math.sin(thigh * DEG) + B * Math.sin((thigh - knee) * DEG), hip[2] - A * Math.cos(thigh * DEG) - B * Math.cos((thigh - knee) * DEG)];
    let at = air;
    if (on > 0) {
      // On the ground: the heel it rolls over on the track while the toe is up, the toe once the heel has lifted.
      const a = q[2];
      const [py, pz] = a >= 0 ? sole(HEEL, a) : sole(TOE, a);
      const down: V3 = [lineX, hipY(k, 0) + heel0 - pace * u + (a >= 0 ? 0 : TOE[1] - HEEL[1]) - py, ground - pz];
      at = [air[0] + on * (down[0] - air[0]), air[1] + on * (down[1] - air[1]), air[2] + on * (down[2] - air[2])];
    }
    r.foot[k] = q[2];
    plant(r, fr, k, at);
    // The leg rolled out from the hips tips a foot peeling up off its heel round toward the other: turned back by however far it is.
    let miss = footYaw(r, fr, k) - yaw;
    miss -= 360 * Math.round(miss / 360);
    r.leg[k][2] -= s * miss;
    plant(r, fr, k, at);
    r.plant[k] = on;
    // The arm against the leg, so with the other leg: forward as that heel comes down, a moment behind it, and the forearm a moment
    // behind the upper arm again -- still folding forward as the arm starts back, and opening behind as it starts forward.
    const v = frac(u + 0.5);
    const swing = Math.cos(TAU * (v - L(0.04, 0.03)));
    const follow = Math.cos(TAU * (v - L(0.12, 0.06)));
    const fore = Math.max(0, swing);
    // The right arm swings a little further than the left, as most people's does.
    const reach = (k ? 1.08 : 1) + vary(k);
    /*
     * Swung in across the body a little as it comes forward, and the
     * shoulder lifted with it, rather than straight fore and aft like a
     * pendulum: seen from in front or behind, that was two tubes hanging
     * still. At a run the elbow is keyed against the shoulder -- most bent
     * with the arm forward and the fist up at the chest, opening as it goes
     * back -- and the shoulder goes no further forward than puts the fist
     * there; how far the elbow is bent comes in with the square of the
     * gait, so half way to a run is not a pair of forearms held up still.
     * Walking, the elbow is bent a quarter of a right angle at rest and
     * half of one coming forward, so the forearm comes up off the line of the
     * thigh and in across the body: bent less, in armour at the size the
     * island is played at the arms were two tubes against the body.
     */
    // Walking, back as far as forward and a little out from the side, the elbow kept a little bent: back by less, from behind in
    // armour the hand never came out past the hip, and the arms read as hanging still.
    const back = Math.max(0, -swing);
    r.arm[k] = [L(3, 4) + reach * (swing > 0 ? L(27, 30) : L(30, 34)) * swing, L(6, 9) - L(10, 12) * fore + L(6, 0) * back, L(3, 16) + L(4, 8) * fore];
    r.elbow[k] = WALK_ELBOW[0] + vary(3) + L(8, 0) * back + WALK_ELBOW[1] * Math.max(0, follow) + g * g * (84 - WALK_ELBOW[0] + 24 * follow - WALK_ELBOW[1] * Math.max(0, follow));
    r.shrug[k] = L(0.14, 0.24) * fore;
    // The hand hanging loose trails the swing walking; curling closed with the gait into a fist at a run, it goes with the forearm,
    // turning knuckles-out as it comes forward and back as it goes back, rather than a piston's end.
    r.hand[k] = [L(10, 2) * Math.cos(TAU * (v - 0.22)), 0, -s * 8 * g * swing];
    r.loose[k] = true;
    r.curl[k] = g;
  }
  // At a run the body gives forward a little at each landing, sunk on the knee, and comes up straight off the toe.
  const give = L(0.5, 1.5) * (0.5 - 0.5 * Math.cos(TAU * Math.min(1, step / L(0.6, 0.64))));
  r.spine = [-L(2, 1) - give, -0.6 * drop, -hips];
  const turn = L(6, 13) * Math.cos(TAU * (u0 - 0.03));
  // And the shoulders roll against the hips, more at a run, where the arms drive.
  r.chest = [-L(0.5, 1), -0.25 * drop + L(0.6, 1.6) * Math.sin(TAU * (u0 + 0.05)), turn];
  // The head held level and looking ahead, the neck taking most of what the body under it turns and tips.
  const pitch = tip + r.spine[0] + r.chest[0], roll = drop + r.spine[1] + r.chest[1];
  const ahead = -L(1, 3) - pitch;
  r.neck = [0.6 * ahead, -0.6 * roll, -0.55 * turn + 0.4 * vary(4)];
  r.head = [0.4 * ahead, -0.4 * roll, -0.38 * turn + 0.6 * vary(4)];
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
 * bounces and settles; then is drawn up from the elbow, the forearm folding
 * back as the upper arm rises, until the wrist is beside the ear and a little
 * behind it with the elbow bent past a right angle and pointing up and out, and the
 * mallet lying back over the shoulder, its head behind the head; is held
 * there, cocked; and comes down onto the chisel in the last seventh of the
 * turn, the elbow leading and the head whipping over last. It went down past
 * the hip and up again with the arm straight, a windmill, and was held
 * straight up over the crown like a hand up in a class. Down beside the
 * head, not in front of it: the wrist out past the shoulder and no further
 * forward than the ear until it is below the chin, and only then forward and
 * in to the work. It came over and down in front of the face, the forearm
 * across the mouth seen from in front and three-quarters on, and the fist
 * over the nose side on from the left.
 */
const BLOW: Key[] = [
  { at: 0.08, v: [1.8, 3.1, 3.2, 0.5, -0.6, -0.7, -0.95, 0.15, 0.35] },
  { at: 0.2, v: [1.8, 3.2, 2.8, 0.4, -0.6, -0.8, -1, 0.15, 0.12] },
  { at: 0.27, v: [3.0, 1.5, 2.5, 0.65, -0.4, -0.6, -0.6, -0.1, 0.8] },
  { at: 0.34, v: [3.1, 1.2, 3.9, 0.9, -0.2, -0.4, -0.2, 0.6, 0.75] },
  { at: 0.48, v: [3.1, -0.4, 5.7, 0.9, 0.3, 0.2, 0, -0.1, 1] },
  { at: 0.6, v: [3.1, -0.6, 6.35, 0.85, 0.35, 0.45, -0.05, -0.65, 0.75] },
  { at: 0.72, v: [3.2, -0.82, 6.5, 0.85, 0.3, 0.45, -0.05, -0.85, 0.5] },
  { at: 0.86, v: [3.25, -1.0, 6.7, 0.85, 0.3, 0.45, -0.05, -0.97, 0.22] },
  { at: 0.92, v: [3.3, -0.5, 6.3, 0.8, 0.5, 0.1, 0.1, -0.7, 0.7] },
  { at: 0.955, v: [3.3, -0.2, 4.6, 0.8, -0.3, -0.5, 0.15, -0.15, 0.98] },
  { at: 0.98, v: [2.8, 1.2, 2.4, 0.5, -0.6, -0.7, -0.3, 0.5, 0.8] },
];
/*
 * At the top the arm was held dead still: the three keys there were within a
 * quarter of a unit of one another, and a third of a second of every second
 * the arm was frozen, a pause and then a hit. Now the cock loads through it --
 * the wrist creeping back and up and the head of the mallet tipping further
 * back over the shoulder -- until the blow comes down. And on the draw up the
 * fist goes out from the work to the side first and rises beside the shoulder,
 * out and back of it: brought forward at the height of the chest first, the
 * mallet's head went up past the mouth and chin.
 */
/** How far into a blow, after it lands, work may change hands: see `settle`. */
const WORK_SWAP = 0.12;
/**
 * Where the mallet is held up instead of cocked behind the ear while the hand
 * it is in is the far one from where it is seen -- after a turn onto a
 * facing that works the other way (see `lefty`), until the next blow lands
 * and the hands change: out beside the chest, below the shoulder, in the hips'
 * frame as `BLOW` has it. Cocked behind the ear with the far arm, the forearm
 * lay across the brow and the mallet over the crown, a hand on the forehead,
 * for up to half a second every time the body turned that way at work.
 */
const FAR_COCK = [3.4, 0.9, 2.5, 0.8, 0.1, -0.6];
/** Which facings work is done left-handed at, for easing between them as the body turns (see `lefty`). */
const LEFTY = [0, 0, 0, 1, 0, 0, 0, 1];

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
 * through all of it, and the head stays down over the work: bowed, back,
 * neck and head together, under twenty degrees, which leaves the face to be
 * seen from above and in front -- bowed as far as the eyes would need, over
 * thirty, it was a crown over a chest, and a cap or a helm hid the face. Seen from where the right hand's swing would come across
 * the face, it is done the other way about, left-handed (`left`, see `lefty`).
 */
function work(r: Rig, w: number, fr: Frame, left: boolean, far = 0): void {
  const s = (((w / TAU) % 1) + 1) % 1;
  const T = fr.tall;
  r.tool = true;
  // How high the mallet is, near enough: nought as it lands, one held up at the top.
  const up = s < 0.2 ? 0.12 * Math.sin((Math.PI * s) / 0.2) : s < 0.7 ? ease((s - 0.2) / 0.5) : s < 0.86 ? 1 : 1 - Math.pow((s - 0.86) / 0.14, 2);
  const jolt = s < 0.25 ? Math.pow(1 - s / 0.25, 2) : 0;
  // The weight back on the right foot as the mallet goes up, and driven onto the left, the forward one, into the blow.
  const on = -0.65 + 1.25 * up - 0.25 * jolt;
  // The hips go with the weight, and turn the right side back with the mallet and round again into the blow.
  r.pelvis = [-3, -3 * on, 3 - 9 * up + 2 * jolt];
  r.at = [0.3 * on, -0.35 * on, 0];
  r.spine = [-9 + 4 * up - 2.5 * jolt, 1.5 * on, 0];
  r.chest = [-4 + 3 * up - jolt, -2 * up, 4 - 7 * up - 2 * jolt];
  r.neck = [-3 + 2 * up, 0, -3 + 5 * up];
  r.head = [-4 + up + 1.5 * jolt, 0, -2 + 3 * up];
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
  // The far hand held up beside the shoulder rather than cocked behind the head, the elbow out and down, by as much as it is up
  // and the far one.
  const low = far * Math.min(1, Math.max(0, up));
  for (let i = 0; i < 6; i++) k[i] += (FAR_COCK[i] - k[i]) * low;
  hold(r, fr, 1, [k[0] * T, k[1] * T, k[2] * T], [k[3], k[4], k[5]], [k[6], k[7], k[8]]);
  if (left) mirror(r);
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
 *
 * That was still a bar of shirt along the surface from behind: a hundredth and
 * a half of a stroke between the arms is a sixtieth of a second, and the upper
 * arms lay on the water. Now the elbows at the out-sweep go down into it, so
 * the upper arm slants down through the surface, and the arms are four
 * hundredths apart and do not set their elbows quite alike (`ELBOW_ODD`).
 *
 * In under the chin the wrists were under the surface by less than a hand is
 * long, and turned up there the hand stood out of the water by the jaw with its
 * fingers up, seen side on. Now they come in a forearm's depth under, as
 * `HANDS_UNDER` keeps them setting off, and the hand under the water with them.
 */
const BREAST: Key[] = [
  { at: 0, v: [-62, 7, 0.5, 5.6, -1.6, 1, -0.2, -20, 2, 3, 6, -30, 0.1] },
  { at: 0.14, v: [-60, 8, 2.3, 5.0, -1.45, 1, -0.5, -30, 2, 5, 6, -30, 0.2] },
  { at: 0.28, v: [-52, 10, 3.2, 2.7, -1.25, 1, -0.8, -10, 6, 7, 14, -24, 0.75] },
  { at: 0.4, v: [-44, 12, 0.8, 1.4, -0.75, 1, 0.2, 30, 26, 12, 70, 10, 1.6] },
  { at: 0.52, v: [-54, 10, 0.4, 3.4, -0.85, 1, -0.4, 10, 40, 24, 112, 22, 0.35] },
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
const ARM_LEAD = 0.04;
/** How much further out, and how much lower, the right elbow is set than the left, swimming: each arm has its own habit. */
const ELBOW_ODD: [number, number] = [0.18, -0.15];

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
    r.open[k] = 1;
    const odd = k ? 0.5 : -0.5;
    swimHand(r, fr, k, [ax, ay, az], [apx + odd * ELBOW_ODD[0], -0.2, apz + odd * ELBOW_ODD[1]]);
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
  r.chest = [2 + 1.5 * c, 4 * s, 0];
  // The head kept level over the roll, and looking about.
  r.neck = [6, -3.5 * s, 0];
  r.head = [4, -0.5 * s, 14 * Math.sin(q * 0.23)];
  /*
   * Topped out a little under the shoulders, for the top of the shirt showed in a crescent inside the foam round them: so only
   * a head on a long neck ever showed, standing up out of rings. Now that what comes up out of the water by a sliver is let up
   * gradually (`waterline`), the tops of the shoulders break the surface at the top of each kick and go back under it, the one
   * a little before the other as the shoulders roll.
   */
  r.float = 0.8 + 0.32 * Math.cos(2 * q - 0.6);
  // The shoulders let down a little with the arms out under the water, the tops of them under it with the arms.
  r.shrug = [-0.15, -0.15];
  for (let k = 0; k < 2; k++) {
    /*
     * The hands out to the sides just under the surface, sweeping out and in, each a little behind the other, and each
     * flat on the water and tipped the way it is going, so it pushes down on it both ways. The elbows were let straight
     * down under them, so the forearm rose steeply to the wrist and the hand, which a wrist cannot bend back flat from
     * that, stood up out of the water palm out, waving. Now the elbow goes out to the side and only a little down, the
     * forearm lies nearly level a hand's depth under, and the hand lies flat at the end of it.
     */
    const side = k ? 1 : -1, o = Math.sin(q + (k ? 0.35 : 0)), v = Math.cos(q + (k ? 0.35 : 0));
    r.open[k] = 1;
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
 * Treading water side on, the line across the shoulders points at you, so the top of the near shoulder breaking the
 * surface at the top of a kick is seen end on: a round cap as wide as the neck standing in the foam under the jaw, which
 * read as a ball held under the chin however it was wetted and let down. From the front or the back the same two caps
 * are a line across the root of the neck and read as shoulders. So, turned side on, the body is let up only as far as
 * keeps the tops of the shoulders under the lip of the water (`waterline`), eased into that rather than stopped at it, and
 * the head bobs by what is left; it comes on from three quarters round to side on.
 */
const SIDE_ON_FROM = 0.75;
/** How far the top of the chest's round over each shoulder stands over the arm's joint, at any build: what showed side on. */
const SHOULDER_ROUND = 0.95;
/** How softly the bob is eased in under that ceiling: a hard stop at it was a head that rose, stuck and fell. */
const SHOULDERS_EASE = 0.12;
function shouldersUnder(r: Rig, fr: Frame, facing: number): void {
  const side = Math.abs(Math.sin((facing * TAU) / 8));
  const w = Math.max(0, Math.min(1, (side - SIDE_ON_FROM) / (1 - SIDE_ON_FROM)));
  if (!w) return;
  const b = skeleton(fr, r);
  const over = Math.max(b.arm0.t[2], b.arm1.t[2]) + SHOULDER_ROUND - SHOULDER_SLIVER;
  r.float = (r.float ?? 0) - w * SHOULDERS_EASE * Math.log(1 + Math.exp(over / SHOULDERS_EASE));
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
/**
 * A cart going along a track, at `phi` of the driver's clock: the team's nod,
 * once to a stride of theirs; the rock of the wheels, two swings slower than
 * that and never in step, so it is never the same twice running, the slower
 * of them on its own (`roll`); a jolt from a rut now and then; and the
 * bench's bump with each beat of the wheels, and the same a little later,
 * which is when the shoulders feel it.
 */
function rutted(phi: number): { nod: number; rock: number; roll: number; jolt: number; bump: number; after: number } {
  const roll = Math.sin(phi * 0.43 + 0.7);
  return {
    nod: Math.sin(phi * 0.5),
    rock: 0.65 * roll + 0.35 * Math.sin(phi * 1.07 + 2.1),
    roll,
    jolt: Math.pow(Math.max(0, Math.sin(phi * 0.37) * Math.sin(phi * 0.83 + 1)), 3),
    bump: Math.pow(Math.abs(Math.sin(phi * 0.5 + 0.6)), 1.5),
    after: Math.pow(Math.abs(Math.sin(phi * 0.5 + 0.1)), 1.5),
  };
}
/** How far a cart rolls on her springs with the slow swing of the rock, in degrees; her nose goes down with a rut's jolt; and lifts with each bump, in units. */
const CART_ROLL = 1.3;
const CART_PITCH = 1.2;
const CART_LIFT = 0.1;
/**
 * A cart or a wagon on the move, under the driver at `phi` of their clock, as
 * a boat's sway is (`boatSway` in `./furniture`): heeled to her right and
 * pitched nose down, in degrees, and lifted, in units. She was still while
 * her driver rocked and bumped on her, so the body gave against nothing that
 * was seen to move. Whoever draws her draws her driver through the same
 * sway, and the body's own rock is the rest of it (`reinsIn`).
 */
export function cartSway(phi: number, moving: boolean): { heel: number; pitch: number; lift: number } {
  if (!moving) return { heel: 0, pitch: 0, lift: 0 };
  const { roll, jolt, bump } = rutted(phi);
  return { heel: CART_ROLL * roll, pitch: CART_PITCH * jolt, lift: CART_LIFT * bump };
}

function reinsIn(r: Rig, phi: number, moving: boolean, seat: Seat, fr: Frame): void {
  r.reins = true;
  const t = phi / 6;
  const ride = rutted(phi);
  const nod = moving ? ride.nod : 0, rock = moving ? ride.rock : 0, jolt = moving ? ride.jolt : 0;
  const bump = moving ? ride.bump : 0, after = moving ? ride.after : 0;
  // What of the roll and the lift the cart takes under the body (`cartSway`), which the body is drawn through: not on a saddle.
  const cart = moving && !seat.astride ? 1 : 0;
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
   *
   * That rock was one pure swing, ten degrees either way: a metronome. And
   * the bump lifted the whole body most of a unit off a bench that stayed
   * where it was, a hop rather than a ride. Now the rock is two swings that
   * never fall into step, seven degrees at the most, and a rut throws the
   * body over to one side as well as forward and it settles back; the bench
   * lifts the hips a little, and the rest of the bump goes into the back,
   * which gives under it and comes up again a beat later.
   */
  // Which way a rut throws the body: one side for a while and then the other.
  // The way it changes over is a quick turn rather than a switch, so a jolt that lands just then is not thrown both ways at once.
  const kick = moving ? 3 * jolt * Math.tanh(4 * Math.sin(phi * 0.19)) : 0;
  if (moving && !seat.astride) r.lift = (0.25 - CART_LIFT) * bump + 0.1 * jolt;
  /*
   * Given how far the box is rolled this moment (`Seat.sway`), the hips take back that much: the renderer eases her roll in and
   * out as her driver sets off and stops, over longer than the body's own pose is blended (`BLEND`), and a body taking
   * back a roll she no longer had sat a degree off her for a fifth of a second.
   */
  const rolled = seat.sway && !seat.astride ? seat.sway.heel : cart * CART_ROLL * ride.roll;
  r.pelvis = [4, 2 * rock - rolled + 0.5 * kick, 0];
  r.spine = [-9 + 3.8 * jolt + 4 * bump + 1.2 * b * (moving ? 0 : 1), 3.5 * rock + kick, 0];
  r.chest = [-2 + 2.2 * jolt + 1.4 * nod * 0.3 + 2.5 * after - 1.2 * bump, 1.5 * rock + 0.5 * kick, 0];
  // The head kept nearly level and looking ahead over the team; stopped, looking about.
  r.neck = [6 - 3 * jolt - 1.5 * after - 2 * bump, -2.3 * rock - 1.2 * kick, 0];
  r.head = [4 - 4.5 * jolt, -1.6 * rock - 0.6 * kick, moving ? 3 * Math.sin(phi * 0.09) : 14 * Math.sin((t * TAU) / 11) * Math.min(1, 2 * Math.abs(Math.sin((t * TAU) / 23)))];
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
  r.tail = [12 + 4 * rock + 6 * jolt, 3 * rock + kick, 0];
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

/**
 * The two hands are never quite together: the left a little ahead through
 * the stroke, as a share of it, and over the right by this much in the
 * middle of the drive, where the handles come in toward each other.
 */
const ROW_LEAD = 0.04;
const ROW_OVER = 0.18;
/**
 * And the left blade squares and turns flat this much of a stroke after its own place in it. A lead of a fortieth of a
 * stroke, a twentieth of a second, was two oars moving as one at the size the island is played at, and two blades turned
 * at the same moment are a pair: the lead is four hundredths now, and the blades are not turned together.
 */
const ROW_FEATHER_LAG = 0.02;
/** How far back in the stroke the head is following the back from, as a share of it, and how much of the difference it keeps. */
const ROW_HEAD_LAG = 0.1;
const ROW_HEAD_GIVE = 0.5;

function row(r: Rig, phi: number, moving: boolean, seat: Seat, fr: Frame): void {
  const st = (((phi / ROW_STROKE) % 1) + 1) % 1;
  const still = (): number[] => [10, 0.02, 1, 4 + 1.5 * Math.sin(phi / 6 * TAU / 4.2)];
  const [, , , swing] = moving ? loop(STROKE, st) : still();
  // Where the back was a moment ago, which the head follows: it lags the swing a little, as a weight on the neck does.
  const was = moving ? loop(STROKE, (st + 1 - ROW_HEAD_LAG) % 1)[3] : swing;
  // The legs out along the boards to the stretcher, the knees down under the gunwales.
  r.leg = [[92, 12, -4], [92, 12, -4]];
  r.knee = [50, 50];
  // The back swings from the hips; the head stays up, looking over the stern.
  r.pelvis = [6, 0, 0];
  r.spine = [swing * 0.55 - 4, 0, 0];
  r.chest = [swing * 0.45, 0, 0];
  r.neck = [-swing * 0.45 + 2 - ROW_HEAD_GIVE * (swing - was), 0, 0];
  r.head = [-swing * 0.35 + 2 - 0.5 * ROW_HEAD_GIVE * (swing - was), 0, moving ? 0 : 10 * Math.sin(phi / 6 * TAU / 13)];
  const lock = seat.grip, inboard = Math.max(2, lock[0] - 1.05), out = inboard * OAR_OUT;
  r.oars = [];
  for (let k = 1; k >= 0; k--) {
    const s = k ? 1 : -1;
    /*
     * Each hand at its own place in the stroke, the left a touch ahead. Through
     * the drive the left handle rides over the right, which drops its blade
     * that much deeper, the oar turning about its rowlock. The two arms and
     * oars were each other's mirror all through the stroke.
     */
    const sk = (st + (k ? 0 : ROW_LEAD)) % 1;
    const [sweep, h0, square] = moving ? loop(STROKE, sk) : still();
    const feather = moving && !k ? loop(STROKE, (sk + 1 - ROW_FEATHER_LAG) % 1)[2] : square;
    // How far through its life the splash of the blade going in is: from nought as it goes in to one as it has settled.
    const splash = moving ? ((sk - ROW_CATCH + 1) % 1) / ROW_SPLASH : 1;
    const over = k || !moving ? 0 : ROW_OVER * Math.pow(Math.max(0, Math.sin(Math.PI * (st - 0.18) / 0.42)), 2) * (st > 0.18 && st < 0.6 ? 1 : 0);
    const height = h0 - over * (out - 1.4) / inboard;
    // Dropped toward the blade by as much as puts its middle at `height` over the water.
    const dip = Math.asin(Math.max(-0.9, Math.min(0.9, (lock[2] - height) / (out - 1.4))));
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
/** How far the tiller is put over either way at the most, in degrees, steering under way. */
const TILLER_SWING = 9;
function steer(r: Rig, phi: number, moving: boolean, seat: Seat, fr: Frame): void {
  const t = phi / 6;
  const b = Math.sin((t * TAU) / 4.2);
  /*
   * A degree or two of lean and a head that looked up now and then were all
   * there was of it. Then the body heeled eight degrees and rose a third of a
   * unit off its seat with the swell -- on a hull that did neither, so at the
   * size the island is played at it was a man swaying on a boat sat still,
   * and the fist stayed on a tiller that never moved.
   *
   * Now the hull heels, pitches and lifts on the water, and the body with
   * her (`Seat.sway`, from whoever draws her): sat on her, it goes where her
   * seat goes. What the body does of its own is balance against her, the
   * hips and back a third of the heel the other way and the neck and head
   * most of the rest, so the eyes stay level while the mast leans; and steer.
   * The tiller is his to draw (`Seat.pivot`): it swings on the rudder's head
   * with his fist on the end of it, put over this way and that in no steady
   * rhythm, the shoulders turning with each push and pull.
   */
  const heel = seat.sway?.heel ?? 0, pitch = seat.sway?.pitch ?? 0;
  const work = moving ? 0.7 * Math.sin(phi * 0.27 + 0.4) + 0.3 * Math.sin(phi * 0.61 + 1.3) : 0.3 * Math.sin((t * TAU) / 7);
  r.leg = [[80, 12, -6], [80, 12, -6]];
  r.knee = [80, 80];
  const k = seat.grip[0] >= 0 ? 1 : 0, s = k ? 1 : -1;
  r.pelvis = [6, -0.15 * heel, 0];
  r.spine = [-6 + 1.2 * b - 0.3 * pitch, -0.2 * heel, s * 2 * work];
  r.chest = [-1 + 0.8 * b, -0.1 * heel, s * 5 * work];
  r.neck = [4 + 0.3 * pitch, -0.25 * heel, -s * 2.5 * work];
  // Looking ahead, and up at the sail every so often.
  const up = Math.pow(Math.max(0, Math.sin((t * TAU) / 9)), 8);
  r.head = [4 + 16 * up + 0.3 * pitch, -0.2 * heel, 6 * Math.sin((t * TAU) / 13) - 10 * up - s * 1.5 * work];
  r.blink = t % 4.7 < 0.12;
  // The end of the tiller, swung about its pivot by how far it is put over.
  let g = seat.grip, haft: V3 = [0, 1, 0.1];
  if (seat.pivot) {
    const p = seat.pivot, a = TILLER_SWING * work * DEG, c = Math.cos(a), n = Math.sin(a);
    const d: V3 = [g[0] - p[0], g[1] - p[1], g[2] - p[2]];
    g = [p[0] + d[0] * c - d[1] * n, p[1] + d[0] * n + d[1] * c, g[2]];
    haft = unit([g[0] - p[0], g[1] - p[1], g[2] - p[2]]);
    r.tiller = { pivot: p, end: g, wood: seat.wood };
  }
  fistOn(r, fr, k, g, [s * (0.5 - 0.35 * work), -0.9 + 0.2 * work, -0.35 + 0.3 * work], haft);
  // The other hand flat on its thigh, half way to the knee, the fingers toward the knee.
  const hips = hipsOn(r, seat.up).t;
  r.open[1 - k] = 1;
  fistOn(r, fr, 1 - k, [-s * 1.2, hips[1] + 1.75, hips[2] + 0.75], [-s * 0.3, -0.9, -0.6], [s, 0, 0]);
  aimHand(r, fr, 1 - k, [0, 0.95, -0.3], [0, -0.2, 1]);
  r.tail = [10 - 0.2 * heel, -0.2 * heel, 0];
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

/**
 * A wave with the hand nearest whoever is looking, or the other if that one has something in it (see `wave`, `waveArm`); or a
 * hop, knees tucked in the air, with whatever is held still held (see `hop`). `busy` is which hands are full, left then right.
 */
function emote(r: Rig, id: string, t: number, facing: number, fr: Frame, busy: [boolean, boolean], arm = waveArm(facing, busy)): void {
  if (id === 'wave') wave(r, t, facing, fr, arm, busy);
  else if (id === 'hop') hop(r, t, fr, busy);
}

/**
 * The arm a wave is made with at `facing`: the one staged for the camera (see `wave`), unless it has something in it and the
 * other does not; with both full -- a weapon and a shield -- the shield arm, the shield on the forearm and the hand free behind it.
 */
function waveArm(facing: number, busy: [boolean, boolean]): number {
  const k = stagedArm(facing);
  return busy[0] && busy[1] ? 0 : busy[k] ? 1 - k : k;
}
/** The arm a wave is staged for at `facing` with both hands free: the near one, but the far one side on (see `wave`). */
const stagedArm = (facing: number): number => {
  const f = ((Math.round(facing) % 8) + 8) % 8;
  return f === 2 ? 0 : f >= 5 && f !== 6 ? 0 : 1;
};

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
/*
 * And the same for the other arm, the one a wave is not staged for at each
 * facing, which waves when the staged one has something in it, or when the
 * body turns in the middle of a wave made with the staged one: the far arm
 * three-quarters on raised half way forward, which takes the hand out past
 * the side of the head rather than behind it; the near one side on raised
 * straight ahead, a little lower and with the elbow opened, so the forearm
 * leans out ahead of the face and the hand is clear of it -- out to the side,
 * it comes at the viewer and the hand was over the face, and raised straight
 * back, the hand sat on the back of the crown and the wave read as
 * scratching the head; and the far one three-quarters away straight out,
 * past the back of the head.
 */
const WAVE_ROUND_OTHER = [20, 45, 84, 0, 20, 0, 84, 45];
const WAVE_RAISE_OTHER = [102, 98, 100, 102, 102, 102, 100, 98];
const WAVE_BEND_OTHER = [86, 80, 62, 84, 86, 84, 62, 80];
/** Each arm's tables, round the eight facings: the staged ones where it is the staged arm, the other ones where not. */
const WAVE_BY_ARM = [0, 1].map((k) => {
  const pick = (main: number[], other: number[]): number[] => main.map((v, f) => (stagedArm(f) === k ? v : other[f]));
  return { round: pick(WAVE_ROUND, WAVE_ROUND_OTHER), raise: pick(WAVE_RAISE, WAVE_RAISE_OTHER), bend: pick(WAVE_BEND, WAVE_BEND_OTHER) };
});

/**
 * A wave, `t` of the way through, with arm `k`. The arm is raised from where
 * it hangs, in one turn of the shoulder through the plane it ends up in -- it
 * was the shoulder's three angles each eased from one end to the other, which
 * swung the hand in an arc round the back of the head side on -- a little
 * past where it stops and back, the elbow bending from the start so the hand
 * comes up near the body and over the elbow: bent after the arm was up, it
 * went up a straight arm, a T with a fist on the end of it. The hand opens
 * as it comes up, over a few frames, and closes again as it comes down.
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
function wave(r: Rig, t: number, facing: number, fr: Frame, k: number, busy: [boolean, boolean] = [false, false]): void {
  if (busy[0] && busy[1]) {
    nod(r, t, facing);
    return;
  }
  const T = fr.tall, s = k ? 1 : -1;
  /*
   * Up from still, a little past and back, the elbow bending ahead of the raise; and down again with the elbow kept bent until
   * the upper arm is most of the way down, so the hand comes down past the shoulder. The elbow opened ahead of the upper arm
   * coming down, and for a tenth of a second the arm was held straight out ahead at the height of the shoulder.
   */
  const x = ease(Math.max(0, Math.min(1, t / 0.24)));
  const raise = (1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2)) * (1 - step(t, 0.76, 0.96));
  // The elbow bent from the first frames, and further than it is held up, so the forearm is folded up before the upper arm comes
  // level (`early`): bent as the arm rose, side on it went up for a frame or two as one straight arm pointing ahead at the height
  // of the shoulder, with the fist on the end of it.
  const lift = step(t, 0, 0.05) * (1 - step(t, 0.84, 1));
  // Three swings of the forearm, in and out from upright, eased in and out of.
  const swings = step(t, 0.15, 0.25) * (1 - step(t, 0.72, 0.82));
  const ph = (TAU * 3 * (t - 0.2)) / 0.58;
  const swing = swings * Math.sin(ph);
  // Read at the way the body faces as drawn, so turning in the middle of a wave eases from one facing's staging to the next.
  const view = viewOf(facing), table = WAVE_BY_ARM[k];
  // The body leans away from the arm, rocks with each swing, and the shoulder comes up.
  r.spine = [r.spine[0], r.spine[1] - 2 * s * raise, r.spine[2]];
  r.chest = [r.chest[0] + 1.5 * raise, r.chest[1] - 4 * s * raise + 1.2 * s * swing, r.chest[2] - 1.5 * s * swing];
  r.shrug = k ? [r.shrug[0], r.shrug[1] + 0.45 * raise] : [r.shrug[0] + 0.45 * raise, r.shrug[1]];
  // Every direction from here on in the chest's frame: x to the right, y forward, z up.
  const chest = joint(joint(ROOT, [0, 0, SPINE * T], ...r.spine), [0, 0, CHEST * T], ...r.chest);
  const back = (v: V3): V3 => { const m = chest.m; return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]]; };
  const [ap, aa, at] = r.arm[k];
  const hang = mv(mm(rz(s * at * DEG), mm(ry(-s * aa * DEG), rx(ap * DEG))), [0, 0, -1]);
  const psi = byFacing(table.round, facing) * DEG, el = byFacing(table.raise, facing) * DEG;
  const out: V3 = [s * Math.cos(psi), Math.sin(psi), 0];
  const raised: V3 = [Math.sin(el) * out[0], Math.sin(el) * out[1], -Math.cos(el)];
  // The upper arm turned from hanging to raised about the one axis between them, overshooting a little at the top.
  const om = Math.acos(Math.max(-1, Math.min(1, dot(hang, raised)))), so = Math.sin(om) || 1;
  const wa = Math.sin((1 - raise) * om) / so, wb = Math.sin(raise * om) / so;
  const u = unit([hang[0] * wa + raised[0] * wb, hang[1] * wa + raised[1] * wb, hang[2] * wa + raised[2] * wb]);
  // The forearm bent from the elbow toward forward as it hangs and toward straight up as it is raised; and kept toward up as it
  // comes down, so the hand comes down past the shoulder: bent toward forward, the arm side on lowered ahead of the body was one
  // straight line, the forearm on from the upper arm.
  const up = t < 0.5 ? Math.min(lift, Math.max(0, Math.min(1, 1.6 * raise))) : lift;
  const want: V3 = [0, 1 - up, up], wu = dot(want, u);
  const p = unit([want[0] - u[0] * wu, want[1] - u[1] * wu, want[2] - u[2] * wu]);
  // Coming down, the elbow folds further, the hand toward the shoulder, before it opens again at the side.
  const fold = 30 * step(t, 0.74, 0.86), early = t < 0.5 ? 35 * Math.max(0, 1 - raise) : 0;
  const bend = (r.elbow[k] + (byFacing(table.bend, facing) + fold + early - (swing > 0 ? 24 : 16) * swing - r.elbow[k]) * lift) * DEG;
  const fa: V3 = [u[0] * Math.cos(bend) + p[0] * Math.sin(bend), u[1] * Math.cos(bend) + p[1] * Math.sin(bend), u[2] * Math.cos(bend) + p[2] * Math.sin(bend)];
  const S: V3 = [s * 2.1 * fr.sh, -0.1, ARM_AT * T + r.shrug[k]];
  const a = UPPER * T, b = LOWER * T;
  const wrist = place(chest, [S[0] + u[0] * a + fa[0] * b, S[1] + u[1] * a + fa[1] * b, S[2] + u[2] * a + fa[2] * b]);
  const was = r.hand[k];
  hold(r, fr, k, wrist, mv(chest.m, u));
  // The palm turned toward whoever is looking, and forward, and the hand flapping a little behind the forearm's swing. Seen from
  // behind, forward, to whoever is in front: turned to the viewer, it was the palm shown over the back of the head.
  const fore = Math.max(0, Math.min(1, (view.T[1] + 0.4) / 0.6));
  const toward = back([view.T[0] * fore, view.T[1] * fore + 1 - fore, 0]);
  const palm = palmTo(r, k, unit([toward[0] + 0.3 * out[0], toward[1] + 0.6, 0.2]));
  r.hand[k] = [was[0] + (14 * swings * Math.cos(ph) - was[0]) * lift, was[1] * (1 - lift), was[2] + (palm - was[2]) * lift];
  r.open[k] = step(t, 0.04, 0.14) * (1 - step(t, 0.8, 0.92));
  // The head turned toward whoever is looking, when they are in front, rather than about; and tilted toward the arm.
  const to = view.T[1] > -0.2 ? Math.max(-20, Math.min(20, Math.atan2(-view.T[0], view.T[1]) / DEG)) : 0;
  r.neck = [r.neck[0], r.neck[1], r.neck[2] * (1 - raise)];
  r.head = [r.head[0] + 3 * raise, r.head[1] + 3 * s * raise, r.head[2] * (1 - Math.min(1, raise)) + 0.6 * to * Math.min(1, raise)];
}

/**
 * The greeting with both hands full, a weapon and a shield, `t` of the way
 * through: the head turned to whoever is looking and a nod with a little bow
 * from the chest. It was a wave with the shield arm, the hand behind the
 * shield, which read as the shield raised -- and side on, over the face.
 *
 * The weapon hand stays down, the forearm only coming up a little with the
 * bow: brought up and forward, it tipped a blade in the fist up to level
 * (see `heldFrame`), pointed at whoever the body faced, which reads as a
 * threat and not a greeting. And seen from behind, the head turns over the
 * shoulder toward the viewer by up to `NOD_BACK` degrees, so the nod is
 * made to them: kept facing away, it was the back of the head dipping,
 * which reads as looking at the ground.
 */
const NOD_BACK = 35;
function nod(r: Rig, t: number, facing: number): void {
  const held = step(t, 0.05, 0.25) * (1 - step(t, 0.72, 0.95));
  const dip = Math.pow(Math.sin(Math.PI * step(t, 0.22, 0.62)), 2);
  const view = viewOf(facing), way = Math.atan2(-view.T[0], view.T[1]) / DEG;
  const to = view.T[1] > -0.2 ? Math.max(-20, Math.min(20, way)) : way >= 0 ? NOD_BACK : -NOD_BACK;
  r.chest = [r.chest[0] - 5 * dip, r.chest[1], r.chest[2] + 0.25 * to * held];
  r.neck = [r.neck[0] - 7 * dip, r.neck[1], r.neck[2] * (1 - held) + 0.25 * to * held];
  r.head = [r.head[0] + 2 * held - 16 * dip, r.head[1], r.head[2] * (1 - held) + 0.5 * to * held];
  r.elbow[1] += 12 * held;
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
/**
 * The arms through a hop, as [when, swung forward, out, elbow]: back to load, swung forward and up through the leap, out to the
 * sides in the air for balance -- under half way to level: out to the level, it was a puppet's arms -- and forward and down to land.
 * This is the left; the right goes through it `HOP_RIGHT` behind and `HOP_RIGHT_SIZE` as far, and a hand with something in it
 * `HOP_HELD` as far, so the two arms are not one arm twice.
 */
const HOP_ARMS: Key[] = [
  { at: 0, v: [3, 7, 15] },
  { at: 0.15, v: [-44, 12, 28] },
  { at: 0.21, v: [46, 24, 28] },
  { at: 0.27, v: [28, 40, 30] },
  { at: 0.36, v: [16, 46, 28] },
  { at: 0.45, v: [12, 38, 30] },
  { at: 0.51, v: [12, 18, 38] },
  { at: 0.555, v: [-24, 14, 30] },
  { at: 0.6, v: [36, 26, 30] },
  { at: 0.67, v: [18, 36, 30] },
  { at: 0.76, v: [12, 30, 32] },
  { at: 0.84, v: [12, 16, 32] },
  { at: 0.93, v: [5, 9, 20] },
];

const HOP_RIGHT = 0.05;
const HOP_RIGHT_SIZE = 0.85;
const HOP_HELD = 0.35;
/** And the legs: the right, the back one, tucked `HOP_TRAIL` as far as the left and `HOP_RIGHT` after it; and the chest turned this far toward the left in the air, in degrees. */
const HOP_TRAIL = 0.8;
const HOP_TWIST = 7;
/**
 * And how the right arm differs in shape in the air, not only in time and size: bent further at the elbow, held less far out and
 * turned in at the shoulder, so one arm is out for balance and the other comes forward and in; and how far both arms are turned
 * in at the shoulder there, which is what shows a bent elbow from in front. In degrees, at the top of the leap.
 */
const HOP_RIGHT_BEND = 20, HOP_RIGHT_IN = 0.7, HOP_RIGHT_TURN = 12, HOP_TURN = 10;
/** How much of that shape the right arm keeps on the ground, and how far both elbows bend further at the deepest of a crouch, in degrees. */
const HOP_KEEP = 0.5, HOP_GIVE = 26;

/** The hop's pose `t` of the way through, over whatever the body was doing standing: everything but how high it is off the ground. */
function hopPose(r: Rig, t: number, fr: Frame, busy: [boolean, boolean]): void {
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
  let air = 0;
  for (const h of HOPS) {
    if (t >= h.off && t < h.on) {
      const u = (t - h.off) / (h.on - h.off);
      toe = -24 + 20 * ease(u);
      air = Math.sin(Math.PI * u);
    } else if (t >= h.on && t < h.on + 0.03) toe = -4 * (1 - (t - h.on) / 0.03);
  }
  // The knees drawn up through the rise and let down again to reach for the ground before it arrives: the back one later and less.
  const tuckAt = (x: number): number => {
    for (const [i, h] of HOPS.entries()) {
      if (x >= h.off && x < h.on) return (i ? 0.55 : 1) * Math.pow(Math.sin(Math.PI * Math.min(1, (x - h.off) / (h.on - h.off) / 0.85)), 2);
    }
    return 0;
  };
  const tucks = [tuckAt(t), HOP_TRAIL * tuckAt(t - HOP_RIGHT)], tuck = tucks[0];
  // The hips go down and back over the feet, and the body leans forward over them as far as keeps it balanced.
  const base = hipsFor({ ...r, pelvis: [0, 0, 0], at: [0, 0, 0] }, fr, 1, stance(fr)[1], 3);
  r.pelvis = [r.pelvis[0] * (1 - env), r.pelvis[1] * (1 - env), r.pelvis[2] * (1 - env)];
  r.at = [r.at[0] * (1 - env), -0.55 * c, r.at[2] * (1 - env) + base * env - HOP_DROP * c];
  r.spine = [r.spine[0] * (1 - env) - 18 * c - 5 * tuck, r.spine[1] * (1 - env), r.spine[2] * (1 - env)];
  r.chest = [r.chest[0] - 4 * c, r.chest[1] * (1 - env), r.chest[2] * (1 - env) + HOP_TWIST * air];
  // The hips turned a little against the chest, so the twist shows from in front as the shoulders going one way over the hips.
  r.pelvis = [r.pelvis[0], r.pelvis[1], r.pelvis[2] - 0.4 * HOP_TWIST * air];
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
    r.leg[k] = [r.leg[k][0] + 42 * tucks[k], r.leg[k][1] + 4 * tucks[k], r.leg[k][2]];
    r.knee[k] += 78 * tucks[k];
    r.foot[k] = toe;
  }
  for (let k = 0; k < 2; k++) {
    const [p, a, e] = loop(HOP_ARMS, Math.max(0, Math.min(0.9999, t - (k ? HOP_RIGHT : 0))));
    const g = env * (k ? HOP_RIGHT_SIZE : 1) * (busy[k] ? HOP_HELD : 1);
    // Something of the right arm's shape kept on the ground, and both elbows giving with the knees as a landing is taken: shaped
    // only in the air, the arms came down at the landing into one straight A, the one the mirror of the other.
    const shape = k ? Math.max(air, HOP_KEEP * env) : 0, out = a * (1 - (1 - HOP_RIGHT_IN) * shape);
    r.arm[k] = [r.arm[k][0] + (p - r.arm[k][0]) * g, Math.max(r.arm[k][1], r.arm[k][1] + (out - r.arm[k][1]) * g), r.arm[k][2] * (1 - g) + (HOP_TURN * air + HOP_RIGHT_TURN * shape) * g];
    r.elbow[k] = r.elbow[k] + (e + HOP_RIGHT_BEND * shape + HOP_GIVE * c - r.elbow[k]) * g;
  }
}

/** The hop `t` of the way through, and lifted off the ground as far as the leap has it. */
function hop(r: Rig, t: number, fr: Frame, busy: [boolean, boolean]): void {
  const under = mixRig(r, r, 1);
  hopPose(r, t, fr, busy);
  const h = HOPS.find((h) => t > h.off && t < h.on);
  if (!h) return;
  // Where the hips are, stood on the lowest sole, for the pose at a moment of it.
  const hips = (x: Rig): number => skeleton(fr, { ...x, lift: 0 }).pelvis.t[2];
  const at = (x: number): number => {
    const q = mixRig(under, under, 1);
    hopPose(q, x, fr, busy);
    return hips(q);
  };
  const u = (t - h.off) / (h.on - h.off);
  const want = at(h.off) + (at(h.on) - at(h.off)) * u + emotePose('hop', t).lift / HEIGHT_SCALE;
  r.lift = Math.max(0, want - hips(r));
}

/**
 * Which hands have something in them, left then right, at `facing`: a shield or a bow in the left; anything else in the right, or
 * over whichever shoulder it is carried (see `overLeft`).
 */
function busyOf(p: FigurePose, facing: number, side = overLeft(facing) ? 0 : 1): [boolean, boolean] {
  const held = p.gear?.weapon && weaponOf(p.gear.weapon.id);
  const over = !!held && held.carry === 'shoulder' && side < 0.5;
  return [!!p.gear?.offhand || (!!held && (held.carry === 'bow' || over)), !!held && held.carry !== 'bow' && !over];
}

/**
 * What `settle` chooses once and keeps for a body drawn frame after frame, rather than the pose choosing it afresh from the way it
 * faces each time: the arm a wave is being made with, chosen as it starts, and where something heavy is between the shoulders,
 * nought over the left and one over the right, which goes from the one to the other over `SWAP` seconds (see `shoulder`).
 */
interface Kept {
  wave?: number;
  side?: number;
  /** And the shoulder it is on its way to, which is the one whose hand is full as far as an emote is concerned (see `settle`). */
  bound?: number;
}

/**
 * The pose for `p`, at `p.facing` as drawn -- between two of the eight ways while turning, so that whatever is set by facing
 * (`byFacing`) comes round with the body -- and the work done left-handed or not as `left` says (see `lefty`, `settle`), with
 * whatever else `settle` keeps (`kept`).
 */
function rigOf(p: FigurePose, fr: Frame, left = lefty(p.facing), kept: Kept = {}): Rig {
  const r = rest();
  const side = kept.side ?? (overLeft(p.facing) ? 0 : 1);
  const busy = busyOf(p, p.facing, kept.bound ?? side);
  if (p.swimming) {
    swim(r, p.phase, p.moving, fr);
    if (!p.moving) shouldersUnder(r, fr, p.facing);
  } else if (p.driving) drive(r, p.phase, p.moving, p.seat ?? BOX, fr);
  else if (p.moving) walk(r, p.phase + TAU * strideSeed(p.id), Math.max(0, Math.min(1, p.gait ?? 0)), fr, p.facing);
  else if (p.working) work(r, p.phase, fr, left, left ? 1 - byFacing(LEFTY, p.facing) : byFacing(LEFTY, p.facing));
  else idle(r, p.phase / 6, fr, busy, /helm/.test(p.gear?.head?.id ?? ''));
  if (p.emote && !p.swimming && !p.driving) emote(r, p.emote, p.emoteT ?? 0, p.facing, fr, busy, kept.wave);
  // Put away for what wants both hands -- work, the water, the reins, a seat -- and not for an emote, which was a weapon and a
  // shield gone to the back in one frame and back again at the end: a wave is made with the hand that is free, and a hop with
  // everything held as it was (see `emote`).
  r.stowed = r.tool || r.reins || !!r.sit || r.sink > 0;
  // Something too heavy to carry out in front, over the right shoulder.
  const held = p.gear?.weapon && weaponOf(p.gear.weapon.id);
  if (held && held.carry === 'shoulder' && !r.stowed) shoulder(r, fr, held, side, p.facing);
  // At a run the body goes lower on bent knees, and the bow is held that much higher.
  if (held && held.carry === 'bow' && !r.stowed) bowArm(r, fr, held, p.moving ? 1.3 * Math.max(0, Math.min(1, p.gait ?? 0)) : 0, p.facing);
  if (p.moving && !p.swimming && !p.driving && !r.stowed) carrying(r, held || undefined, !!p.gear?.offhand, Math.max(0, Math.min(1, p.gait ?? 0)), fr, p.facing, held && held.carry !== 'shoulder' ? clearAhead(p, fr, held) : 0);
  // Standing, the arm with something in it kept off the legs as on the move (see `clearOfLegs`): stood at rest, a sword lay through
  // the thigh and was turned out of it in the fist.
  else if (held && held.carry !== 'shoulder' && !r.stowed && !p.swimming && !p.driving) clearOfLegs(r, fr, held, p.facing, 0);
  // A hand with something in it is closed on it.
  if (held && !r.stowed) r.loose[held.carry === 'bow' ? 0 : held.carry === 'shoulder' ? r.carried : 1] = false;
  // Both, while something heavy goes from one shoulder to the other in them.
  if (r.swapping) r.loose = [false, false];
  if (p.gear?.offhand && !r.stowed) r.loose[0] = false;
  if (p.cast && castPoser) {
    // Each hand's goal, seeded where the hand is before the cast, so a goal the cast sets is blended in from there (see `Rig.reach`).
    seedReach(r, fr);
    castOver(r, p, castPoser);
  }
  if (r.kneel || r.reach || r.both) castExtras(r, p, fr);
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
/** How much of a free arm's swing the arm carrying a spear upright keeps, at each facing: see `carrying`. */
const STAFF_SWING = [0.4, 0.4, 0.4, 0.4, 0.4, 0.3, 0.22, 0.4];
function carrying(r: Rig, held: Weapon | undefined, shield: boolean, g: number, fr: Frame, facing: number, least = 0): void {
  const L = (a: number, b: number): number => a + (b - a) * g;
  // The arm's swing about where it hangs from, `keep` of it kept.
  const steady = (k: number, keep: number, fore = L(3, 6)): void => {
    r.arm[k][0] = fore + keep * (r.arm[k][0] - L(3, 6));
  };
  // The elbow's swing about its middle, as the free arm has it (see `walk`).
  const bend = (k: number): number => r.elbow[k] - (WALK_ELBOW[0] + WALK_ELBOW[1] / 2 + g * g * (90 - WALK_ELBOW[0] - WALK_ELBOW[1] / 2));
  if (held?.carry === 'fist') {
    // At a run the sword arm still drives, the elbow working with it, rather than hanging dead at the side.
    const e = bend(1);
    steady(1, L(0.55, 0.6), L(3, 10));
    // Further out from the body the further back it swings, so the fist and the blade go by the thigh and not into it.
    r.arm[1][1] += L(6, 9) + 0.45 * Math.max(0, L(3, 10) - r.arm[1][0]);
    r.arm[1][2] = L(0, 6);
    r.elbow[1] = L(24, 46) + L(0.4, 0.5) * e;
  } else if (held?.carry === 'staff') {
    // Out from the hip and the elbow bent up a little more, so the butt rides beside the stride and not among the feet; and still
    // swung two fifths as far as a free arm rather than a prop held still at the side -- save side on to the left, where the
    // shaft in the far hand stands in front of the face and swung further it came within three units of its middle.
    const e = bend(1);
    steady(1, L(1, 0.85) * byFacing(STAFF_SWING, facing), L(-4, -2));
    r.arm[1][1] += 15;
    r.arm[1][2] = 0;
    r.elbow[1] = L(50, 56) + 0.2 * e;
  }
  if (shield && held?.carry !== 'bow') {
    const e = bend(0);
    steady(0, L(0.3, 0.3), L(8, 14));
    r.arm[0][1] += L(5, 4);
    r.arm[0][2] = L(0, 10);
    r.elbow[0] = L(34, 76) + 0.3 * e;
  }
  // And the arm with something in it out from the side as far as keeps it off the legs (see `clearOfLegs`), and as far as it is
  // already on its way out for a leg that is coming (`clearAhead`).
  if (held && held.carry !== 'shoulder') clearOfLegs(r, fr, held, facing, g, least);
}

/*
 * How far the arm with something in it is out from the side to keep it off
 * the legs, ahead of the leg that it is kept off. Taken out only by as much
 * as clears the leg now, the arm stood still until a thigh came at what it
 * held and then went out twenty or thirty degrees in a frame or two -- a
 * spear's hand and shaft nudged sideways once a stride. Now how far each
 * moment of the stride asks for is found once for each way of carrying it,
 * gait and facing (sampled at `CLEAR_SAMPLES` points round the stride, with
 * the stride itself as plain as it comes: see `WALK_VARY`), and the arm goes
 * out no faster than `CLEAR_RATE` degrees for each whole stride to be there
 * in time, and comes back in no faster either.
 */
const CLEAR_SAMPLES = 48, CLEAR_RATE = 150;
const clearings = new Map<string, Float32Array>();
let clearingNow = false;
function clearAhead(p: FigurePose, fr: Frame, w: Weapon): number {
  if (clearingNow) return 0;
  const g = Math.round(Math.max(0, Math.min(1, p.gait ?? 0)) * GAIT_STEPS) / GAIT_STEPS, facing = ((Math.round(p.facing) % 8) + 8) % 8;
  const key = `${p.gear?.weapon?.id}|${!!p.gear?.offhand}|${fr.fem}|${g}|${facing}`;
  let asks = clearings.get(key);
  if (!asks) {
    asks = new Float32Array(CLEAR_SAMPLES);
    clearingNow = true;
    try {
      for (let i = 0; i < CLEAR_SAMPLES; i++) {
        clearedBy = 0;
        rigOf({ ...p, id: undefined, emote: undefined, cast: undefined, phase: (i / CLEAR_SAMPLES) * TAU, gait: g, facing }, fr);
        asks[i] = clearedBy;
      }
    } finally {
      clearingNow = false;
    }
    if (clearings.size > 512) clearings.clear();
    clearings.set(key, asks);
  }
  const u = (((p.phase / TAU) % 1) + 1) % 1;
  let most = 0;
  for (let i = 0; i < CLEAR_SAMPLES; i++) {
    let d = Math.abs(u - i / CLEAR_SAMPLES);
    d = Math.min(d, 1 - d);
    most = Math.max(most, asks[i] - CLEAR_RATE * d);
  }
  return most;
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

/*
 * What a cast asks of the body besides its joints' turns: down on one knee,
 * a hand put at a place, the other hand on the haft. Each is solved here,
 * after the cast is laid over the pose and blended in, for the body's own
 * build -- a hand put on a haft is on it whether the shoulders are a man's
 * or a woman's -- and each only when a cast asks for it.
 */

/**
 * Seed `r.reach` with each hand as it is now -- where its middle is, the way its elbow is out from the line of the arm,
 * the way a haft through its fist would run -- nought of the way there, for a cast's goals to be blended in from: what a
 * goal gives is blended from these (`castOver` in ./spells/index), so the hand sets off from where it was.
 */
function seedReach(r: Rig, fr: Frame): void {
  const b = skeleton(fr, r);
  r.reach = [0, 1].map((k) => {
    const sh = b[`arm${k}`].t, el = b[`elbow${k}`].t, m = b[`wrist${k}`].m;
    return { at: place(b[`wrist${k}`], [0, 0, GRIP]), w: 0, pole: [el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]], haft: [m[1], m[4], m[7]] };
  }) as [HandGoal, HandGoal];
}

function castExtras(r: Rig, p: FigurePose, fr: Frame): void {
  const moving = p.moving || p.swimming || !!p.driving;
  if ((r.kneel ?? 0) > 0 && !moving && !r.sit) kneelDown(r, fr, Math.min(1, r.kneel ?? 0));
  if (r.reach) {
    const goals = r.reach;
    delete r.reach;
    for (let k = 0; k < 2; k++) {
      const g = goals[k];
      if (g && (g.w ?? 1) > 0) reachTo(r, fr, k, g);
    }
  }
  if ((r.both ?? 0) > 0) bothHands(r, p, fr);
}

/** From the body's frame (the feet's, as `skeleton` builds it) into its hips' own, which `hold` works in: a place, or with `dir` a way. */
const hipsInto = (b: Bones, v: V3, dir = false): V3 => {
  const m = b.pelvis.m, t = b.pelvis.t;
  const d: V3 = dir ? v : [v[0] - t[0], v[1] - t[1], v[2] - t[2]];
  return [m[0] * d[0] + m[3] * d[1] + m[6] * d[2], m[1] * d[0] + m[4] * d[1] + m[7] * d[2], m[2] * d[0] + m[5] * d[1] + m[8] * d[2]];
};

/**
 * Hand `k` put at `g.at` -- the middle of the hand, in the body's frame from the middle of its feet -- with the two-bone
 * solve that puts a hand on reins and oars (`hold`), and `g.w` of the way from where the pose had the arm.
 */
function reachTo(r: Rig, fr: Frame, k: number, g: HandGoal): void {
  const s = k ? 1 : -1, w = Math.min(1, g.w ?? 1);
  if (g.stoop) stoopTo(r, fr, k, g.at, w);
  const b = skeleton(fr, r);
  const want = hipsInto(b, g.at);
  /*
   * The elbow where the goal says, or else where the pose's own elbow is -- out from the line of the arm, and a little
   * down, back and out of its own side for an arm held straight, where that says nothing -- so a goal blended in from
   * where the hand was starts from the arm as it was, rather than swinging the elbow round to somewhere else first.
   */
  let pole: V3;
  if (g.pole) pole = hipsInto(b, g.pole, true);
  else {
    const { sh, el } = armNow(r, fr, k), d = hipsInto(b, [s * 0.5, -0.35, -0.8], true);
    pole = [el.t[0] - sh.t[0] + 0.3 * d[0], el.t[1] - sh.t[1] + 0.3 * d[1], el.t[2] - sh.t[2] + 0.3 * d[2]];
  }
  const haft = g.haft && hipsInto(b, g.haft, true);
  const was = { arm: [...r.arm[k]] as Euler, elbow: r.elbow[k], hand: [...r.hand[k]] as Euler };
  // The wrist that puts the middle of the hand there, found by moving it by however far the hand misses, a few times over.
  let wrist = want;
  for (let q = 0; q < 3; q++) {
    const fist = place(hold(r, fr, k, wrist, pole, haft), [0, 0, GRIP]);
    wrist = [wrist[0] + want[0] - fist[0], wrist[1] + want[1] - fist[1], wrist[2] + want[2] - fist[2]];
  }
  hold(r, fr, k, wrist, pole, haft);
  if (w < 1) {
    const n = (a: number, c: number): number => a + (c - a) * w;
    r.arm[k] = [n(was.arm[0], r.arm[k][0]), n(was.arm[1], r.arm[k][1]), n(was.arm[2], r.arm[k][2])];
    r.elbow[k] = n(was.elbow, r.elbow[k]);
    r.hand[k] = [n(was.hand[0], r.hand[k][0]), n(was.hand[1], r.hand[k][1]), n(was.hand[2], r.hand[k][2])];
  }
}

/** Arm `k`'s shoulder, elbow and wrist as the pose has them, in the hips' frame, as `hold` builds them. */
function armNow(r: Rig, fr: Frame, k: number): { sh: Xf; el: Xf; wr: Xf } {
  const T = fr.tall, s = k ? 1 : -1;
  const chest = joint(joint(ROOT, [0, 0, SPINE * T], ...r.spine), [0, 0, CHEST * T], ...r.chest);
  const sh = joint(chest, [s * 2.1 * fr.sh, -0.1, ARM_AT * T + r.shrug[k]], r.arm[k][0], -s * r.arm[k][1], s * r.arm[k][2]);
  const el = joint(sh, [0, 0, -UPPER * T], r.elbow[k]);
  return { sh, el, wr: joint(el, [0, 0, -LOWER * T]) };
}

/** How far forward the trunk may bow for a hand to reach somewhere (`HandGoal.stoop`), in degrees, and the spine's share of it (the chest takes the rest). */
const STOOP_MOST = 75, STOOP_SPINE = 0.6;

/**
 * The trunk bowed forward over the hips, spine and chest together, as little
 * as brings `at` within reach of hand `k`'s shoulder -- the arm all but
 * straight, and the hand's middle past the wrist -- and `w` of that.
 */
function stoopTo(r: Rig, fr: Frame, k: number, at: V3, w: number): void {
  const T = fr.tall, most = 0.97 * (UPPER + LOWER) * T - GRIP;
  const s0 = r.spine[0], c0 = r.chest[0];
  const bow = (a: number): number => {
    r.spine[0] = s0 - STOOP_SPINE * a;
    r.chest[0] = c0 - (1 - STOOP_SPINE) * a;
    const sh = skeleton(fr, r)[`arm${k}`].t;
    return Math.hypot(at[0] - sh[0], at[1] - sh[1], at[2] - sh[2]) - most;
  };
  if (bow(0) <= 0) return;
  // Halved toward the least bow that reaches, or as far as it goes.
  let lo = 0, hi = STOOP_MOST;
  if (bow(hi) > 0) lo = hi;
  else for (let q = 0; q < 8; q++) { const mid = (lo + hi) / 2; if (bow(mid) > 0) lo = mid; else hi = mid; }
  bow(hi * w);
}

/**
 * The second hand on the haft (`Rig.both`): for a spear taken by the arms, the shaft already runs through it and the hand only
 * closes on it; for anything else, the hand is put on the haft `bothAt` from the first fist -- by default below it toward the
 * butt where the grip is long enough, under the pommel where it is not, or up the haft of an axe or a maul held by its end --
 * and closed on it there.
 */
function bothHands(r: Rig, p: FigurePose, fr: Frame): void {
  const arm = p.gear?.weapon && weaponOf(p.gear.weapon.id);
  if (!arm || arm.carry === 'bow' || r.stowed || r.thrown) return;
  const both = Math.min(1, r.both ?? 0);
  const b = skeleton(fr, r);
  const held = heldFrame(r, b, arm, p.facing);
  if (!held) return;
  const k = 1 - held.hand, xf = held.xf;
  const along: V3 = [xf.m[2], xf.m[5], xf.m[8]];
  if (arm.carry === 'staff' && (r.wieldStaff ?? 0) > 0) {
    // The hand where the pose has it, turned to close on the shaft: `hold` to where the wrist already is, the elbow where it already is.
    const { sh, el, wr } = armNow(r, fr, k);
    const was = { arm: [...r.arm[k]] as Euler, elbow: r.elbow[k], hand: [...r.hand[k]] as Euler };
    hold(r, fr, k, wr.t, [el.t[0] - sh.t[0], el.t[1] - sh.t[1], el.t[2] - sh.t[2]], hipsInto(b, along, true));
    const turned = r.hand[k];
    r.arm[k] = was.arm;
    r.elbow[k] = was.elbow;
    r.hand[k] = [was.hand[0] + (turned[0] - was.hand[0]) * both, was.hand[1] + (turned[1] - was.hand[1]) * both, was.hand[2] + (turned[2] - was.hand[2]) * both];
  } else {
    // Where along it the first fist is: nought, or a shouldered weapon's `fist`; less however far it is slid through.
    const first = (arm.carry === 'shoulder' ? arm.fist ?? 0 : 0) - (r.slide ?? 0);
    const room = arm.from - first;
    // Below the first fist where the grip runs on far enough, a fist apart or as near the end as leaves the end in the hand; a
    // short grip's end cupped in the palm under the pommel; and up the haft of what is held by the end of it, an axe's or a maul's.
    const by = r.bothAt ?? (room <= -1.5 ? Math.max(-1.5, room + 0.5) : arm.carry === 'fist' ? room - 0.3 : 1.6);
    reachTo(r, fr, k, { at: place(xf, [0, 0, first + by]), haft: along, pole: [(k ? 1 : -1) * 0.6, -0.2, -0.75], w: both });
  }
  // Closed on it.
  r.open[k] = +r.open[k] * (1 - both);
  if (both >= 0.5) r.loose[k] = false;
}

/** How far the round of the knee stands out from its joint, under it, kneeling: what it is stood on. */
const KNEE_ROUND = 0.84;
/** Kneeling: how far behind upright the thigh of the knee that is down is, the shin of the foot that is flat ahead, and how far the toes behind point down from straight back, in degrees. */
const KNEEL_THIGH = -8, KNEEL_SHIN = -6, KNEEL_TOE = -80;
/** Where the ball of the foot is, under the toes, in the ankle's frame (see `footMesh`). */
const TOE_SOLE: V3 = [0, 1.72 * 1.04, -0.75];

/**
 * Down on one knee, `w` of the way from the pose's legs: the thigh of the
 * knee that is down hanging all but straight from the hip, the knee on the
 * ground, the shin back along it and the toes tucked under, the foot all but
 * upright on the ball of it; the other thigh out ahead all but level, its
 * shin upright and its foot flat. Solved in the leg's own plane for this
 * build: the knee's round and the ball of the foot behind it on one ground,
 * and the sole ahead on the same ground. The body is let down onto it by
 * `skeleton`, which stands a kneeling body on whatever of it is lowest,
 * knee or sole.
 */
function kneelDown(r: Rig, fr: Frame, w: number): void {
  const T = fr.tall, A = THIGH * T, B = SHIN * T, p0 = r.pelvis[0];
  const down = r.kneelLeft ? 0 : 1, ahead = 1 - down;
  // The shin back from the knee as far up as puts the ball of the foot, turned toes down, on the ground the knee is on.
  const psi = KNEEL_TOE * DEG, toe = TOE_SOLE[1] * Math.sin(psi) + TOE_SOLE[2] * Math.cos(psi);
  const phi = -Math.acos(Math.max(-1, Math.min(1, (toe + KNEE_ROUND) / B))) / DEG;
  // The hips that high over the ground, from the thigh hanging to the knee; the leg ahead reaching down to it.
  const H = A * Math.cos(KNEEL_THIGH * DEG) + KNEE_ROUND;
  const thigh = Math.acos(Math.max(-1, Math.min(1, (H - B * Math.cos(KNEEL_SHIN * DEG) - 0.75) / A))) / DEG;
  const want: Array<{ leg: Euler; knee: number; foot: number; flat: boolean }> = [];
  want[down] = { leg: [KNEEL_THIGH - p0, 4, 0], knee: KNEEL_THIGH - phi, foot: KNEEL_TOE - phi, flat: false };
  want[ahead] = { leg: [thigh - p0, 6, -6], knee: thigh - KNEEL_SHIN, foot: 0, flat: true };
  const n = (a: number, c: number): number => a + (c - a) * w;
  for (let k = 0; k < 2; k++) {
    const x = want[k], [lp] = r.leg[k];
    // The pose's foot as the turn at the ankle it comes to, for a foot that is kept level as well as one that is not.
    const was = r.flat[k] ? -(p0 + lp - r.knee[k]) + r.foot[k] : r.foot[k];
    r.leg[k] = [n(r.leg[k][0], x.leg[0]), n(r.leg[k][1], x.leg[1]), n(r.leg[k][2], x.leg[2])];
    r.knee[k] = n(r.knee[k], x.knee);
    if (x.flat && r.flat[k]) r.foot[k] = n(r.foot[k], 0);
    else {
      const level = x.flat ? -(p0 + r.leg[k][0] - r.knee[k]) : x.foot;
      r.foot[k] = n(was, level);
      r.flat[k] = false;
    }
  }
}

/** The bones and the weapon's frame for one pose, found once for however many points are asked of them. */
function posedFor(pose: FigurePose): { b: Bones; r: Rig; held: () => { xf: Xf; hand: number; arm: Weapon } | null } {
  const kit = kitFor(pose.look ?? DEFAULT_LOOK, 0.5);
  const r = rigOf(pose, kit.fr);
  const b = skeleton(kit.fr, r);
  let held: { xf: Xf; hand: number; arm: Weapon } | null | undefined;
  return {
    b, r,
    held: () => {
      if (held === undefined) {
        const arm = pose.gear?.weapon && weaponOf(pose.gear.weapon.id);
        const h = arm ? heldFrame(r, b, arm, pose.facing) : null;
        held = h && arm ? { ...h, arm } : null;
      }
      return held;
    },
  };
}

/** One point of a posed body: a bone's, or one of what is held (see `figureJoint`). */
function jointOn(f: ReturnType<typeof posedFor>, bone: string, at: V3): V3 {
  const xf = f.b[bone];
  if (xf) return place(xf, at);
  if (!HELD_POINTS.has(bone)) return [0, 0, 0];
  const h = f.held();
  // Nothing held, or it is put away: the right fist stands for it.
  if (!h) return place(f.b.wrist1, [at[0], at[1], GRIP + at[2]]);
  const { xf: w, arm } = h;
  const plus = (p: V3): V3 => place(w, [p[0] + at[0], p[1] + at[1], p[2] + at[2]]);
  switch (bone) {
    case 'tip': return plus([0, 0, arm.to]);
    case 'butt': return plus([0, 0, arm.from]);
    case 'grip': return place(f.b[`wrist${h.hand}`], [at[0], at[1], GRIP + at[2]]);
    case 'bowBottom': return plus(arm.tips?.[0] ?? [0, 0, arm.from]);
    case 'bowTop': return plus(arm.tips?.[1] ?? [0, 0, arm.to]);
    case 'nock': case 'arrow': {
      const lo = place(w, arm.tips?.[0] ?? [0, 0, arm.from]), hi = place(w, arm.tips?.[1] ?? [0, 0, arm.to]);
      const nock = nockOf(f.r, f.b, arm, w) ?? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      if (bone === 'nock') return [nock[0] + at[0], nock[1] + at[1], nock[2] + at[2]];
      const rest = place(w, arm.rest ?? [0, 0, 0]), d = unit([rest[0] - nock[0], rest[1] - nock[1], rest[2] - nock[2]]), L = (arm.arrow ?? 7) + at[2];
      return [nock[0] + d[0] * L, nock[1] + d[1] * L, nock[2] + d[2] * L];
    }
  }
  return plus([0, 0, 0]);
}
/** The points of what is held that `figureJoint` knows besides the bones. */
const HELD_POINTS = new Set(['weapon', 'tip', 'butt', 'grip', 'bowTop', 'bowBottom', 'nock', 'arrow']);

/**
 * Where a point in a bone's frame is, on a body posed so, in the body's own units from the middle of its feet:
 * x to its right, y ahead of it, z up. For what a spell draws at a hand, the head or a weapon's point (`./spells`).
 * Bones: pelvis, spine, chest, neck, head, arm0/1, elbow0/1, wrist0/1, hip0/1, knee0/1, ankle0/1 (0 the left).
 *
 * And what is held, wherever its carry and the cast put it: `weapon` (`at` in the weapon's own frame, z along it
 * from its butt to its point, nought where the fist closes), `tip` and `butt` (its ends, `at` added in its frame),
 * `grip` (the middle of the fist holding it), `bowTop` and `bowBottom` (where the string is made fast), `nock`
 * (where the string is, drawn or not) and `arrow` (the point of an arrow on it; `at[2]` further along). With
 * nothing in the hands, or it put away, each of these is the right fist.
 */
export function figureJoint(pose: FigurePose, bone: string, at: V3 = [0, 0, 0]): V3 {
  return jointOn(lastPosed(pose), bone, at);
}

/**
 * The last body posed for `figureJoint`, kept for the next call that asks of the same pose: a spell's effects ask
 * for a hand, the head and a blade's trail a point at a time, each with a pose made afresh (`./spells/stage`), and
 * each was a whole cast laid over the body and a skeleton built for one point.
 */
let posed: { pose: FigurePose; f: ReturnType<typeof posedFor> } | null = null;
const POSE_KEYS = ['phase', 'moving', 'gait', 'facing', 'swimming', 'working', 'driving', 'seat', 'look', 'gear', 'emote', 'emoteT', 'tunic', 'trousers'] as const;
function lastPosed(pose: FigurePose): ReturnType<typeof posedFor> {
  const was = posed?.pose;
  if (posed && was && POSE_KEYS.every((k) => was[k] === pose[k]) && was.cast?.id === pose.cast?.id && was.cast?.t === pose.cast?.t) return posed.f;
  posed = { pose, f: posedFor(pose) };
  return posed.f;
}

/** Several points of one posed body (see `figureJoint`), the body posed once for all of them: a blade's trail, a bow's tips and string. */
export function figureJoints(pose: FigurePose, wants: ReadonlyArray<string | readonly [string, V3]>): V3[] {
  const f = posedFor(pose);
  return wants.map((w) => (typeof w === 'string' ? jointOn(f, w, [0, 0, 0]) : jointOn(f, w[0], w[1])));
}

/**
 * The body's proportions for a look, in its own units, for a pose that places a hand by position and wants to
 * match the figure: the hips' joint over the soles standing straight, the spine and chest joints up from it, the
 * right shoulder in the chest's frame (the left is its mirror), the upper arm and the forearm, the fist's middle
 * below the wrist, the right hip joint in the hips' frame, the thigh and the shin.
 */
export function figureProportions(look: Look = DEFAULT_LOOK): {
  hips: number; spine: number; chest: number; shoulder: V3; upper: number; lower: number; fist: number; hip: V3; thigh: number; shin: number;
} {
  const fr = frameOf(look), T = fr.tall;
  return {
    hips: (THIGH + SHIN) * T + 0.1 + 0.75, spine: SPINE * T, chest: CHEST * T, shoulder: [2.1 * fr.sh, -0.1, ARM_AT * T],
    upper: UPPER * T, lower: LOWER * T, fist: -GRIP, hip: [fr.hi, 0, -0.1], thigh: THIGH * T, shin: SHIN * T,
  };
}

/**
 * Put hand `k` of a pose being written at `at` now, as `Rig.reach` does after the pose (see there), for the look
 * given or the plain one: for a pose that goes on to work from where the arm then is. The legs and trunk are taken
 * as the pose has them so far.
 */
export function reachHand(r: Rig, k: number, at: V3, o: { pole?: V3; haft?: V3; w?: number; look?: Look } = {}): void {
  reachTo(r, frameOf(o.look ?? DEFAULT_LOOK), k, { at, pole: o.pole, haft: o.haft, w: o.w });
}

/**
 * The turn of arm `k` (`Rig.arm[k]`) that points the upper arm along `dir`, in the chest's frame (x to the right, y
 * ahead, z up), with the elbow hinged so the forearm bends toward `bend` (ahead when left out). `arm[k]` is a
 * pitch forward, then a roll out, then a yaw, each about the chest's axes: raised past level ahead, a roll "out"
 * carries the arm across the body instead. Pointing the arm says where it goes whatever that place is.
 */
export function armToward(k: number, dir: V3, bend: V3 = [0, 1, 0]): Euler {
  const s = k ? 1 : -1, u = unit(dir);
  let q = unit(bend);
  if (Math.abs(dot(q, u)) > 0.97) q = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  // The elbow's hinge square to the arm and to the way the forearm bends; then the frame `hold` turns into a pitch, a roll and a yaw.
  const p: V3 = unit([-(q[0] - u[0] * dot(q, u)), -(q[1] - u[1] * dot(q, u)), -(q[2] - u[2] * dot(q, u))]);
  const x = unit(cross(p, u)), z: V3 = [-u[0], -u[1], -u[2]], y = cross(z, x);
  return [Math.atan2(y[2], z[2]) / DEG, (s * Math.asin(Math.max(-1, Math.min(1, x[2])))) / DEG, (s * Math.atan2(x[1], x[0])) / DEG];
}

/* ---- one pose into the next -------------------------------------------------- */

/**
 * What a body is doing, as far as blending goes: a change of it is blended.
 * Swimming and driving are each two things, under way and stopped: one name
 * for both let the breaststroke drop to treading water, and an oar or the
 * reins jump from the middle of a stroke to lying still, in one frame.
 */
const doing = (p: FigurePose): string => (p.swimming ? (p.moving ? 'swim' : 'tread') : p.driving ? (p.moving ? 'drive' : 'drive still') : p.moving ? 'walk' : p.working ? 'work' : 'idle');

/**
 * And the either/or choices made in it: work done left-handed (`left`, see `settle`), the emote, and the arm a wave is made with
 * (`arm`). Each is a different pose rather than a different amount of one, so a change of any of them is blended as a change of
 * what is being done is, rather than cut. Which shoulder something heavy is over is not among them: blended joint by joint, its
 * head went through the skull on the way, so it goes from the one to the other on a way of its own (see `shoulder`).
 */
const doingAt = (p: FigurePose, left: boolean, arm?: number): string =>
  `${doing(p)}|${p.working && left ? 'left' : ''}|${p.emote ?? ''}${p.emote === 'wave' ? arm ?? '' : ''}`;

/** Seconds to blend from one thing to the next, and to come round one eighth of a turn. */
const BLEND = 0.22;
const TURN = 0.11;
const TURN_STANDING = 0.16;

function mixRig(a: Rig, b: Rig, w: number): Rig {
  const n = (x: number, y: number): number => x + (y - x) * w;
  const e = (x: Euler, y: Euler): Euler => [n(x[0], y[0]), n(x[1], y[1]), n(x[2], y[2])];
  /*
   * Where what is in the hands changes. A weapon put away for work or the reins went at the start of the blend and the tools
   * came at the half way, so for a tenth of a second neither was in the hands; and coming back from work the sword was back in a
   * hand still raised at the chisel, its blade across the belly. Now the weapon goes and the tools come at the same moment, and
   * at the end where the hand is down where the weapon is held: a quarter of the way into work, three quarters out of it.
   * Otherwise -- work changing hands at a blow -- at the half way, where the two hands are passing at the work (see `settle`).
   */
  const swap = a.stowed === b.stowed ? 0.5 : a.stowed ? 0.75 : 0.25;
  return {
    at: e(a.at, b.at), pelvis: e(a.pelvis, b.pelvis), spine: e(a.spine, b.spine), chest: e(a.chest, b.chest), neck: e(a.neck, b.neck), head: e(a.head, b.head),
    arm: [e(a.arm[0], b.arm[0]), e(a.arm[1], b.arm[1])], elbow: [n(a.elbow[0], b.elbow[0]), n(a.elbow[1], b.elbow[1])], hand: [e(a.hand[0], b.hand[0]), e(a.hand[1], b.hand[1])],
    leg: [e(a.leg[0], b.leg[0]), e(a.leg[1], b.leg[1])], knee: [n(a.knee[0], b.knee[0]), n(a.knee[1], b.knee[1])], foot: [n(a.foot[0], b.foot[0]), n(a.foot[1], b.foot[1])],
    flat: b.flat, tail: e(a.tail, b.tail), lift: n(a.lift, b.lift), sink: n(a.sink, b.sink), blink: b.blink, reins: b.reins,
    tool: w < swap ? a.tool : b.tool, lefty: w < 0.5 ? a.lefty : b.lefty,
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
    tiller: a.tiller && b.tiller ? { ...b.tiller, end: e(a.tiller.end, b.tiller.end) } : b.tiller,
    slack: a.slack !== undefined && b.slack !== undefined ? n(a.slack, b.slack) : b.slack,
    // Carried on the curve as much as the walk being blended into or out of is, so that stopping in the air at a run comes down
    // over the blend rather than dropping onto the lower foot at once.
    hover: b.hover ? { ...b.hover, w: b.hover.w * w } : a.hover && { ...a.hover, w: a.hover.w * (1 - w) },
    shrug: [n(a.shrug[0], b.shrug[0]), n(a.shrug[1], b.shrug[1])], open: [n(+a.open[0], +b.open[0]), n(+a.open[1], +b.open[1])],
    // A loose hand changes to a fist three quarters of the way through, curling closed toward it before then, rather than at the
    // start, where a running fist opened in a frame as the body began to stop.
    loose: w < 0.75 ? a.loose : b.loose,
    curl: [n(a.loose[0] ? a.curl[0] : 1, b.loose[0] ? b.curl[0] : 1), n(a.loose[1] ? a.curl[1] : 1, b.loose[1] ? b.curl[1] : 1)],
    stowed: w < swap ? a.stowed : b.stowed,
    // Something heavy goes from one shoulder's hand to the other's half way, where the one coming down passes the one going up.
    carried: w < 0.5 ? a.carried : b.carried, spin: w < 0.5 ? a.spin : b.spin, swapping: w < 0.5 ? a.swapping : b.swapping,
    plant: b.plant ? [b.plant[0] * w, b.plant[1] * w] : a.plant && [a.plant[0] * (1 - w), a.plant[1] * (1 - w)],
    // A cast's asks, blended as a cast blends them in (from nought where one pose has none), so stopping or setting off in the
    // middle of a cast neither drops a blade back to its carry nor straightens a knee that is down; a switch goes over half way.
    wield: some(a.wield, b.wield, n), wieldStaff: some(a.wieldStaff, b.wieldStaff, n), wieldBow: some(a.wieldBow, b.wieldBow, n),
    both: some(a.both, b.both, n), bothAt: some(a.bothAt, b.bothAt, n), haft: some(a.haft, b.haft, n), slide: some(a.slide, b.slide, n),
    draw: some(a.draw, b.draw, n), mouth: some(a.mouth, b.mouth, n), kneel: some(a.kneel, b.kneel, n),
    nocked: w < 0.5 ? a.nocked : b.nocked, thrown: w < 0.5 ? a.thrown : b.thrown, kneelLeft: w < 0.5 ? a.kneelLeft : b.kneelLeft,
    shape: a.shape || b.shape ? [0, 1].map((k) => {
      const x = a.shape?.[k], y = b.shape?.[k];
      return x || y ? Object.fromEntries(HAND_SHAPES.map((s) => [s, n(x?.[s] ?? 0, y?.[s] ?? 0)])) : undefined;
    }) as Rig['shape'] : undefined,
  };
}

/** Two of a number a pose may leave out, blended from nought where one leaves it out, and left out where both do. */
const some = (a: number | undefined, b: number | undefined, n: (x: number, y: number) => number): number | undefined =>
  a === undefined && b === undefined ? undefined : n(a ?? 0, b ?? 0);

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
function mixWater(a: Rig, b: Rig, t: number, fr: Frame): Rig {
  /*
   * Setting off, the arms went first too, and the stroke's arms are set
   * against a body lying along the surface: put on one still upright, "out
   * ahead along the glide" is up at the shoulders in front of the chest, so
   * both forearms and fists came up out of the water and reached forward for
   * a third of a second. So setting off is the other way about: the body tips
   * forward first, the arms coming round under it after, and they are at
   * the stroke only once it is lying along the water.
   */
  const off = (b.under ?? 0) > (a.under ?? 0);
  const wa = ease(off ? Math.max(0, (t - 0.3) / 0.7) : Math.min(1, t / 0.65));
  const arms = mixRig(a, b, wa);
  const body = mixRig(a, b, ease(off ? Math.min(1, t / 0.6) : Math.max(0, (t - 0.25) / 0.75)));
  const r: Rig = { ...body, arm: arms.arm, elbow: arms.elbow, hand: arms.hand, shrug: arms.shrug };
  /*
   * But the arms' angles are the chest's, and the chest is part way between upright and lying along the water: tread's "down
   * and out to the side" on a chest tipped flat is forward along the surface, so a forearm and an open hand came up through it
   * for a sixth of a second, setting off, waving. Either order breaks somewhere. So the hands are not blended as angles at all
   * but as where they are in the water -- across, ahead of the head, under the surface -- from where each pose has them, and
   * kept a forearm's depth under it all the way; the arm is put to them on the body as it is, the elbow and the hand turned
   * as the two poses turn them between, the fingers never up.
   */
  const A = skeleton(fr, a), B = skeleton(fr, b);
  for (let k = 0; k < 2; k++) {
    const p = inWater(A, a, k), q = inWater(B, b, k);
    const at = mixV(p.at, q.at, wa), pole = mixV(p.pole, q.pole, wa), fingers = mixV(p.fingers, q.fingers, wa);
    at[2] = Math.min(at[2], HANDS_UNDER);
    fingers[2] = Math.min(fingers[2], 0);
    swimHand(r, fr, k, at, pole);
    aimHand(r, fr, k, fingers, mixV(p.back, q.back, wa));
  }
  return r;
}
/** How far under the surface a swimmer's wrists are kept going from swimming to treading water or back: a forearm's depth less a hand. */
const HANDS_UNDER = -0.75;
const mixV = (a: V3, b: V3, w: number): V3 => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
/**
 * Where a swimmer's hand `k` is in the water, as `swimHand` takes it -- the wrist across from the middle, ahead of the head
 * and up from the surface, the elbow's way out from the line of the arm -- and which way its fingers run and the back of it
 * faces, as `aimHand` takes them.
 */
function inWater(b: Bones, r: Rig, k: number): { at: V3; pole: V3; fingers: V3; back: V3 } {
  const s = k ? 1 : -1, w = b[`wrist${k}`], e = b[`elbow${k}`].t, sh = b[`arm${k}`].t, m = w.m;
  const water = b.head.t[2] - (r.float ?? 0);
  return {
    at: [s * w.t[0], w.t[1] - b.head.t[1], w.t[2] - water],
    pole: [s * (e[0] - (sh[0] + w.t[0]) / 2), e[1] - (sh[1] + w.t[1]) / 2, e[2] - (sh[2] + w.t[2]) / 2],
    fingers: [-m[2], -m[5], -m[8]],
    back: [s * m[0], s * m[3], s * m[6]],
  };
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
  /** What it was doing before, and at what gait it last walked: a stop from a run brakes, a start shifts the weight first. */
  was: string;
  gait: number;
  /** Its feet as drawn, and how high its hips were drawn over them: see `footed`. */
  feet?: Foot[];
  hips?: number;
  /** Working left-handed, as last changed at a blow: see `settle`. */
  left: boolean;
  /** The arm a wave is being made with and the way the body faced as it was chosen, and where something heavy is between the shoulders: see `Kept`. */
  wave?: number;
  waveFrom?: number;
  side: number;
  /** Whether the blend going on is from swimming to treading water or back, which is blended its own way (`mixWater`). */
  water?: boolean;
  /** The facing a blade in the fist is carried for: see `BLADE_TURN`. */
  blade?: number;
}

const held = new Map<string, Held>();
const ease = (x: number): number => x * x * (3 - 2 * x);

/**
 * The pose and facing to draw a known body in now, blended from how it was last drawn. The way it faces is worked out first, and
 * the pose (`rigAt`) asked for at that: posed at the way it was turning to, a carry or a wave set by facing went round in one
 * frame while the body was still drawn the old way.
 */
function settle(id: string, p: FigurePose, rigAt: (facing: number, left: boolean, kept: Kept) => Rig, now: number): { rig: Rig; facing: number; changing: boolean } {
  // One of the eight ways; or, sat in something, square along it however it is turned (`FigurePose.seat`).
  const goal = (((p.seat ? p.facing : Math.round(p.facing)) % 8) + 8) % 8;
  let h = held.get(id);
  // A body not drawn for a while -- off screen, or just arrived -- starts where it is.
  if (!h || now - h.seen > 0.5) {
    const left = lefty(goal), side = overLeft(goal) ? 0 : 1, wave = p.emote === 'wave' ? waveArm(goal, busyOf(p, goal, side)) : undefined;
    const target = rigAt(goal, left, { wave, side });
    h = { doing: doingAt(p, left, wave), rig: target, from: target, since: -1, facing: goal, goal, turnFrom: goal, turnSince: -1, seen: now, lead: 0, was: doing(p), gait: 0, left, wave, waveFrom: goal, side };
    held.set(id, h);
    if (held.size > 256) for (const [k, v] of held) if (now - v.seen > 5) held.delete(k);
  }
  const dt = Math.max(0, Math.min(0.1, now - h.seen));
  h.seen = now;
  if (goal !== h.goal) {
    h.goal = goal;
    h.turnFrom = h.facing;
    h.turnSince = now;
  }
  // The short way round, at an eighth of a turn per TURN seconds; standing, more slowly, for the feet to step round under it.
  let d = h.goal - h.turnFrom;
  d -= 8 * Math.round(d / 8);
  const k = Math.min(1, Math.max(0, (now - h.turnSince) / ((p.moving ? TURN : TURN_STANDING) * Math.max(1, Math.abs(d)))));
  const was = h.facing;
  h.facing = k < 1 ? h.turnFrom + d * ease(k) : h.goal;
  /*
   * Work changes hands only as a blow lands, with the mallet down on the chisel and both hands together at the work, and blends
   * from one to the other there (see `mixRig`): changed whenever the way it faces said so, the mallet went from a hand raised over
   * the head to the other at the belt, and both arms swung across the chest getting there.
   */
  const wasLeft = h.left;
  if (!p.working || (((p.phase / TAU) % 1) + 1) % 1 < WORK_SWAP) h.left = lefty(h.facing);
  /*
   * The arm a wave is made with is chosen as it starts and kept to the end: chosen afresh from the way the body faced, turning an
   * eighth in the middle of a wave changed the waving hand, which nobody does. Chosen again only if the body comes round more than
   * a quarter turn from where it started.
   */
  const over = overLeft(h.goal) ? 0 : 1, bound = h.side > 0 && h.side < 1 ? over : h.side;
  if (p.emote !== 'wave') h.wave = undefined;
  else {
    let off = h.facing - (h.waveFrom ?? h.facing);
    off -= 8 * Math.round(off / 8);
    if (h.wave === undefined || Math.abs(off) > 2) {
      h.wave = waveArm(h.facing, busyOf(p, h.facing, bound));
      h.waveFrom = h.facing;
    }
  }
  // Something heavy goes over to the other shoulder as the way it is turning to says, starting as the turn does, over `SWAP`
  // seconds -- but not during an emote, where the hand it would go into may be waving; put away, it is taken up again on whichever.
  // Caught half way by one, it goes on to where it was going, and the emote is made with the hand that will be free there: frozen
  // there, the wave or the hop was made holding the maul out in front in both hands; and sent back to the shoulder it was nearer,
  // it was carried through the wave on the shoulder staged for the other side, its head over the face.
  if (p.working || p.swimming || p.driving) h.side = over;
  else if (!p.emote || (h.side > 0 && h.side < 1)) h.side += Math.max(-dt / SWAP, Math.min(dt / SWAP, over - h.side));
  const kept: Kept = { wave: h.wave, side: h.side, bound: p.emote ? bound : undefined };
  const what = doingAt(p, h.left, h.wave);
  if (what !== h.doing) {
    /*
     * Work changing hands at a blow is blended from the blow landing in the hand it was in, as it is now, rather than from the
     * pose last drawn: drawn a dozen times a second, that could be the mallet half way down, and the blend swung the arm out
     * sideways from there for a sixth of a second.
     */
    const hands = p.working && h.left !== wasLeft && h.doing.split('|')[0] === 'work' && what.split('|')[0] === 'work';
    h.was = h.doing.split('|')[0];
    // Only a change between swimming and treading water: turning while doing either is blended as any turn is.
    h.water = p.swimming && (h.was === 'swim' || h.was === 'tread') && h.was !== doing(p);
    h.doing = what;
    h.from = hands ? rigAt(h.facing, wasLeft, kept) : h.rig;
    h.since = now;
  }
  const base = doing(p);
  if (base === 'walk') h.gait = Math.max(0, Math.min(1, p.gait ?? 0));
  // Stopping from a run takes longer than from a walk: the body brakes over a step rather than standing up out of the stride.
  const stopping = h.was === 'walk' && base === 'idle', starting = h.was === 'idle' && base === 'walk';
  const target = rigAt(h.facing, h.left, kept);
  const x = Math.min(1, Math.max(0, (now - h.since) / (h.water ? WATER_BLEND : BLEND * (stopping ? 1 + 0.8 * h.gait : 1))));
  const w = ease(x);
  h.rig = x < 1 ? (h.water ? mixWater(h.from, target, x, frameOf(p.look ?? DEFAULT_LOOK)) : mixRig(h.from, target, w)) : target;
  if (w < 1 && stopping) {
    /*
     * Braking: the hips carried on forward over the leading foot and the
     * body leant back against it, sunk on the knees, and then stood back up
     * over both feet as the other comes up beside it -- out of a run hard
     * enough to see at the size the island is played at (five degrees at
     * the hips and three at the back was not), and out of a walk a little.
     */
    const brake = (0.3 + 0.7 * h.gait) * Math.sin(Math.PI * x), r = h.rig;
    h.rig = { ...r, at: [r.at[0], r.at[1] + 1.5 * brake * (1 - x), r.at[2] - 0.5 * brake], pelvis: [r.pelvis[0] + 10 * brake, r.pelvis[1], r.pelvis[2]], spine: [r.spine[0] + 6 * brake, r.spine[1], r.spine[2]], neck: [r.neck[0] - 8 * brake, r.neck[1], r.neck[2]], head: [r.head[0] - 4 * brake, r.head[1], r.head[2]] };
  } else if (w < 1 && starting) {
    /*
     * Setting off: the weight goes over onto the foot that stays down
     * before the other lifts -- the hips across to it and a little down --
     * and the body tips into the way of going; by enough to see, where a
     * third of a unit and two and a half degrees did not show.
     */
    const r = h.rig, on = target.plant ? (target.plant[1] > target.plant[0] ? 1 : -1) : 1, shift = Math.sin(Math.PI * Math.min(1, x * 1.6));
    h.rig = { ...r, at: [r.at[0] + 0.5 * on * shift, r.at[1], r.at[2] - 0.2 * shift], pelvis: [r.pelvis[0] - 5 * shift, r.pelvis[1] - 4 * on * shift, r.pelvis[2]], spine: [r.spine[0], r.spine[1] + 2 * on * shift, r.spine[2]] };
  }
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
  const led = h.lead ? turnedAhead(h.rig, h.lead) : h.rig;
  // Everything on the ground goes round the other way in the body's frame as the body turns: a turn to the right, up the facings,
  // is the ground going round to the left.
  let turned = h.facing - was;
  turned -= 8 * Math.round(turned / 8);
  // And while something heavy is on its way between the shoulders: called settled once the turn was, a walk was put down from its
  // stride's pictures -- made with it already on the far shoulder -- and the swap jumped to its end, and standing it was drawn a
  // dozen times a second, which shows its last few tenths as one picture.
  const changing = w < 1 || k < 1 || h.lead !== 0 || !!target.swapping;
  const walking = p.moving && !p.swimming && !p.driving;
  const { rig, busy } = footed(h, led, walking ? target : undefined, stopping && w < 1 ? target : undefined, frameOf(p.look ?? DEFAULT_LOOK), changing, -turned * 45, -togo * 45, now, dt, starting && w < 1);
  /*
   * A blade in the fist is carried for each facing at its own angle out from the body (`FIST_OUT`), and came round to the next
   * with the body, in a tenth of a second: through pointing at whoever is looking, short on the screen, it swept from one side
   * to the other twenty-five degrees in a frame. It follows the body round no faster than an eighth of a turn in `BLADE_TURN`.
   */
  let bladeTurning = false;
  if (h.blade === undefined || !p.gear?.weapon) h.blade = h.facing;
  else {
    let d = h.facing - h.blade;
    d -= 8 * Math.round(d / 8);
    const most = dt / BLADE_TURN;
    h.blade = (((h.blade + Math.max(-most, Math.min(most, d))) % 8) + 8) % 8;
    bladeTurning = Math.abs(d) > most;
  }
  if (h.blade !== h.facing) rig.bladeFacing = h.blade;
  return { rig, facing: h.facing, changing: changing || busy || bladeTurning };
}

/** Seconds a blade in the fist takes to come round an eighth of a turn as the body turns: see `settle`. */
const BLADE_TURN = 0.3;

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

/*
 * Feet that stay put through a change. Blending one pose into the next, or
 * turning, was done joint by joint, and whatever a foot on the ground was
 * doing went with it: stopping, both feet skated two or three tenths of a
 * metre into the standing pose in a fifth of a second; turning on the spot,
 * the body went round on its feet like a figure on a turntable; starting,
 * the legs scissored out of the stance with both feet sliding. Now each foot
 * is kept where it is on the ground for as long as the pose being drawn has
 * it on the ground, and the legs are solved to it from wherever the hips have
 * gone. A foot left more than a little way from where the pose wants it --
 * by a stop, a start, a turn -- takes a step there, one foot at a time and
 * never both off the ground at once; one turned far from its way pivots on
 * its ball. A foot the pose lifts, a walk's swing, goes where the pose takes
 * it, and comes down there.
 */

/** A foot as drawn: its ankle in the body's frame over the ground, which way it points, and a step it is taking. */
interface Foot {
  at: V3;
  yaw: number;
  /** Where the pose being drawn has it, last time, and whether that was on the ground; and where the walk being blended into has it. */
  want: V3;
  down: boolean;
  ground: V3;
  planted: boolean;
  /** How far it is held up off where a blend carries it, for being carried along the ground: see `footed`. */
  raise: number;
  step?: { since: number; from: V3; yaw: number; lift: number; time: number };
}

/** How far a foot on the ground may be from where the pose wants it, along the ground and turned, while things are changing and once they have settled, before it steps there. */
const STEP_OFF = 0.55, STEP_TURNED = 18;
const SETTLED_OFF = 0.22, SETTLED_TURNED = 7;
/** How far a foot kept on the ground may be turned against the leg before it pivots on its ball, in degrees, and how fast it pivots then, in degrees a second. */
const PIVOT_FROM = 40, PIVOT_RATE = 600;
/** Where the ball of the foot is, from the ankle, along the ground: what a foot pivots on. */
const BALL = 1.15;

/** Which way an ankle's foot points along the ground, in degrees round to the left of straight ahead. */
const yawOf = (x: Xf): number => Math.atan2(-x.m[1], x.m[4]) / DEG;
const wrapDeg = (a: number): number => a - 360 * Math.round(a / 360);

/**
 * The pose `rig` with its feet kept on the ground (see above), for the body
 * `h` drawn now; `turned` is how far round to the left everything fixed on
 * the ground has gone in the body's frame since it was last drawn, by the
 * body turning, and `togo` how far it has still to go; and `walking` the
 * walk, while the ground is going by under it. Busy while a foot is
 * anywhere but where the pose has it.
 */
function footed(h: Held, rig: Rig, walking: Rig | undefined, goal: Rig | undefined, fr: Frame, changing: boolean, turned: number, togo: number, now: number, dt: number, starting = false): { rig: Rig; busy: boolean } {
  const moving = !!walking;
  if (rig.sink > 0 || rig.sit || rig.lift > 0) {
    h.feet = undefined;
    h.hips = undefined;
    return { rig, busy: false };
  }
  const b = skeleton(fr, rig);
  const want = [0, 1].map((k) => {
    const a = b[`ankle${k}`];
    let low = Infinity;
    for (const p of SOLE) low = Math.min(low, place(a, p)[2]);
    // A blend into standing brings a foot down over its length, and it is as good as down well before the end of it.
    return { at: a.t, yaw: yawOf(a), down: low < (changing && !walking ? 0.3 : 0.08), low: low - a.t[2] };
  });
  // Where the walk itself has the feet, blended into or not, for how fast the ground is going by under it; walking, a foot is on
  // the ground while the walk has it planted, whatever the blend into it has.
  const wb = walking && walking !== rig ? skeleton(fr, walking) : b;
  const ground = [0, 1].map((k) => ({ at: wb[`ankle${k}`].t, planted: !!walking?.plant && walking.plant[k] > 0.5 }));
  if (walking) for (let k = 0; k < 2; k++) want[k].down = ground[k].planted;
  /*
   * Setting off, a foot in the air goes where the walk has it, not where the blend into the walk has it: half way between the
   * stance and the stride, it came down a unit and a half short of where the walk put the ground, was dragged back on it until
   * the walk lifted it, and the hips sank nine tenths of a unit to reach it and sprang back up in a frame as it went.
   */
  if (walking && starting) for (let k = 0; k < 2; k++) if (!ground[k].planted) want[k] = { ...want[k], at: wb[`ankle${k}`].t, yaw: yawOf(wb[`ankle${k}`]) };
  else if (rig.plant && rig.hover && rig.hover.w > 0.5) for (let k = 0; k < 2; k++) want[k].down = rig.plant[k] > 0.5;
  if (!h.feet) {
    h.feet = want.map((w, k) => ({ at: w.at, yaw: w.yaw, want: w.at, down: w.down, ground: ground[k].at, planted: ground[k].planted, raise: 0 }));
    return { rig, busy: false };
  }
  const feet = h.feet;
  // How far each was out of place last time, for whether it still moves against the pose.
  const was = feet.map((f) => [f.at[0] - f.want[0], f.at[1] - f.want[1], f.at[2] - f.want[2], f.yaw]);
  // The ground going back under a walking body: as a foot the walk has planted goes back, both before and now -- its own, which
  // rolls over the heel and onto the toe as it goes, or the other's.
  const went = [0, 1].map((k) => (moving && feet[k].planted ? [ground[k].at[0] - feet[k].ground[0], ground[k].at[1] - feet[k].ground[1]] : undefined));
  const [gx, gy] = (ground[0].planted && went[0]) || (ground[1].planted && went[1]) || [0, 0];
  const c = Math.cos(turned * DEG), sn = Math.sin(turned * DEG);
  const round = (p: V3): V3 => [p[0] * c - p[1] * sn, p[0] * sn + p[1] * c, p[2]];
  /*
   * Where a foot is to step to: where the pose has it once the turn still to
   * come has gone round under it -- as far as a quarter turn of it, so that
   * a foot does not step round into the other's place -- so that a step
   * taken in the middle of a turn puts the foot down where it will be
   * wanted at the end of it, rather than where it is wanted now.
   */
  /*
   * And where the pose being blended into has it, not the blend: stopping,
   * a foot stepped toward the stance as the blend carried it there, then
   * again, and again, up to a second of shuffling and four or five units of
   * stepping a foot. Now each foot steps once, to where it will stand.
   */
  const lead = Math.max(-90, Math.min(90, togo)) * DEG, lc = Math.cos(-lead), ls = Math.sin(-lead);
  const gb = goal && goal !== rig && !goal.sit && goal.sink <= 0 ? skeleton(fr, goal) : undefined;
  const aim = want.map((w, k) => {
    const at = gb ? gb[`ankle${k}`].t : w.at, yaw = gb ? yawOf(gb[`ankle${k}`]) : w.yaw;
    return { at: [at[0] * lc - at[1] * ls, at[0] * ls + at[1] * lc, w.at[2]] as V3, yaw: yaw - lead / DEG };
  });
  for (let k = 0; k < 2; k++) {
    const f = feet[k], w = want[k];
    // How far a foot on the ground is from where the walk had it there, last time.
    const kept = Math.hypot(f.at[0] - f.ground[0], f.at[1] - f.ground[1]);
    // Fixed on the ground: round with the turn, and back with the ground going by if it is on it.
    const q = round(f.at);
    const g = went[k] ?? [gx, gy];
    f.at = f.down && w.down ? [q[0] + g[0], q[1] + g[1], q[2]] : q;
    f.yaw += turned;
    // Coming down out of a stride into a stop with the other foot already down, kept in the air until it is over where it is to
    // stand: put down short of there, it stepped again at once.
    if (gb && w.down && !f.down && !f.step && feet[1 - k].down && Math.hypot(f.at[0] - aim[k].at[0], f.at[1] - aim[k].at[1]) > STEP_OFF) w.down = false;
    if (f.step) {
      // Stepping: up off the ground and over to where the pose wants it now, and down; what it stepped from turned with the body.
      const s = f.step;
      s.from = round(s.from);
      s.yaw += turned;
      const t = Math.min(1, (now - s.since) / s.time), e = ease(t), to = aim[k];
      f.at = [s.from[0] + (to.at[0] - s.from[0]) * e, s.from[1] + (to.at[1] - s.from[1]) * e, s.from[2] + (to.at[2] - s.from[2]) * e + s.lift * Math.sin(Math.PI * t)];
      // Round the outside of the other foot, rather than through it, where it is in the way: stepping round in a turn.
      const o = feet[1 - k].at, dx = to.at[0] - s.from[0], dy = to.at[1] - s.from[1], L = Math.hypot(dx, dy);
      if (L > 0.3) {
        const along = Math.max(0, Math.min(1, ((o[0] - s.from[0]) * dx + (o[1] - s.from[1]) * dy) / (L * L)));
        const side = ((o[0] - s.from[0]) * dy - (o[1] - s.from[1]) * dx) / L;
        const clear = 1.5 - Math.abs(side);
        if (clear > 0 && along > 0 && along < 1) {
          const by = clear * Math.sin(Math.PI * t) * (side > 0 ? -1 : 1);
          f.at = [f.at[0] + (dy / L) * by, f.at[1] - (dx / L) * by, f.at[2]];
        }
      }
      f.yaw = s.yaw + wrapDeg(to.yaw - s.yaw) * e;
      if (t >= 1) f.step = undefined;
    } else if (f.down && (moving && f.planted ? kept > 0.5 : Math.hypot(f.at[0] - w.at[0], f.at[1] - w.at[1]) > (moving ? 0.9 : 0.3)) && (!w.down || (moving && feet[1 - k].down))) {
      /*
       * Lifted by the pose from somewhere else than the pose has it, or,
       * walking, kept so far from where the walk has it that the leg would
       * soon not reach it, the other foot being down: a quick step up off
       * the ground and over to it, rather than slid there low as a blend
       * carries it. One the walk has had on the ground goes by how far it
       * was kept from where the walk had it, not by where the walk's foot
       * has got to as it lifts: at a run that is most of a unit in a frame
       * off the toe, and a foot just put down in its place stepped again.
       */
      const off = Math.hypot(f.at[0] - w.at[0], f.at[1] - w.at[1]);
      f.step = { since: now - dt, from: f.at, yaw: f.yaw, lift: Math.min(0.9, 0.35 + 0.1 * off), time: 0.12 + 0.03 * Math.min(4, off) };
      const e = ease(dt / f.step.time);
      f.at = [f.at[0] + (w.at[0] - f.at[0]) * e, f.at[1] + (w.at[1] - f.at[1]) * e, f.at[2] + f.step.lift * Math.sin((Math.PI * dt) / f.step.time)];
    } else if (!w.down) {
      /*
       * Lifted by the pose: carried with it, and however far it was out of
       * place made up while it is in the air. While one pose is blended into
       * another, a foot the blend carries along low over the ground -- into
       * a walk's first stride, or round to the stance -- is lifted clear of
       * it by how fast it goes, rather than slid. Coming down into a stop, it
       * is carried over to where it is to stand as it comes down, rather than
       * to where the blend has it, which put it down a little short and then
       * stepped it the rest of the way.
       */
      const u = 1 - Math.min(1, dt * 14);
      const over = (p: V3): V3 => {
        if (!gb) return p;
        // And lifted by however far that takes it, so it goes over the ground rather than along it.
        const c = Math.max(0, Math.min(1, (1 - (p[2] - gb[`ankle${k}`].t[2])) / 0.8));
        const dx = (aim[k].at[0] - p[0]) * c, dy = (aim[k].at[1] - p[1]) * c;
        return [p[0] + dx, p[1] + dy, p[2] + Math.min(0.6, 0.5 * Math.hypot(dx, dy))];
      };
      const was = over(round(f.want)), to = over(w.at);
      const speed = dt > 0 ? Math.hypot(to[0] - was[0] - gx, to[1] - was[1] - gy) / dt : 0;
      const raised = f.raise;
      f.raise += ((changing ? Math.min(0.6, 0.035 * speed) : 0) - f.raise) * Math.min(1, dt * 20);
      f.at = [to[0] + (f.at[0] - was[0]) * u, to[1] + (f.at[1] - was[1]) * u, to[2] + (f.at[2] - raised - was[2]) * u + f.raise];
      f.yaw = w.yaw + wrapDeg(f.yaw - w.yaw) * u;
    } else if (moving && !f.down && Math.hypot(f.at[0] - w.at[0], f.at[1] - w.at[1]) > 0.3) {
      // Walking, a foot not yet back where the walk has it is not put down short of it.
      w.down = false;
      const was = round(f.want), u = 1 - Math.min(1, dt * 20);
      f.at = [w.at[0] + (f.at[0] - was[0]) * u, w.at[1] + (f.at[1] - was[1]) * u, w.at[2] + (f.at[2] - was[2]) * u + (1 - u) * 0.25];
      f.yaw = w.yaw + wrapDeg(f.yaw - w.yaw) * u;
    } else {
      // On the ground: kept there, at the height and the roll the pose has it, and turned on its ball if it is twisted too far; and
      // just put down, put down where the pose puts it, less whatever it was still out of place by in the air.
      if (!f.down) {
        const was = round(f.want);
        f.at = [w.at[0] + f.at[0] - was[0], w.at[1] + f.at[1] - was[1], w.at[2]];
      }
      f.at[2] = w.at[2];
      const twist = wrapDeg(f.yaw - w.yaw);
      if (Math.abs(twist) > PIVOT_FROM) {
        const by = -Math.sign(twist) * Math.min(Math.abs(twist) - PIVOT_FROM, PIVOT_RATE * dt);
        const a0 = f.yaw * DEG, a1 = (f.yaw + by) * DEG;
        const ball: Pt = [f.at[0] - Math.sin(a0) * BALL, f.at[1] + Math.cos(a0) * BALL];
        f.at = [ball[0] + Math.sin(a1) * BALL, ball[1] - Math.cos(a1) * BALL, f.at[2]];
        f.yaw += by;
      }
    }
  }
  // A foot too far from where the pose wants it, with the other on the ground to stand on, steps there: the further out of place
  // first. Not while walking, where the walk's own next step takes it.
  if (!moving && !feet[0].step && !feet[1].step) {
    const settled = !changing && Math.abs(turned) < 1e-3;
    const off = [0, 1].map((k) => Math.hypot(feet[k].at[0] - aim[k].at[0], feet[k].at[1] - aim[k].at[1]));
    const far = [0, 1].map((k) => want[k].down && (settled ? off[k] > SETTLED_OFF || Math.abs(wrapDeg(feet[k].yaw - aim[k].yaw)) > SETTLED_TURNED : off[k] > STEP_OFF || Math.abs(wrapDeg(feet[k].yaw - aim[k].yaw)) > STEP_TURNED));
    const k = far[0] && far[1] ? (off[0] >= off[1] ? 0 : 1) : far[0] ? 0 : far[1] ? 1 : -1;
    if (k >= 0 && want[1 - k].down) {
      const f = feet[k];
      f.step = { since: now, from: f.at, yaw: f.yaw, lift: Math.min(0.9, 0.3 + 0.12 * off[k]), time: 0.17 + 0.035 * Math.min(4, off[k]) };
    }
  }
  // Drawn otherwise than the pose has it while any foot is out of place; and changing, to be drawn again at once, while any is
  // stepping or still moving against the pose -- not for one left a little out of place, standing.
  let off = false, busy = false, lowest = Infinity;
  for (let k = 0; k < 2; k++) {
    const f = feet[k], w = want[k], o = was[k];
    f.want = w.at;
    f.down = w.down && !f.step;
    if (w.down || f.step) f.raise = 0;
    f.ground = ground[k].at;
    f.planted = ground[k].planted;
    const d: V3 = [f.at[0] - w.at[0], f.at[1] - w.at[1], f.at[2] - w.at[2]];
    if (f.step || Math.hypot(d[0], d[1], d[2]) > 0.01 || Math.abs(wrapDeg(f.yaw - w.yaw)) > 0.3) off = true;
    if (f.step || Math.hypot(d[0] - o[0], d[1] - o[1], d[2] - o[2]) > 0.003 || Math.abs(wrapDeg(f.yaw - o[3])) > 0.2) busy = true;
    lowest = Math.min(lowest, f.at[2] + w.low);
  }
  busy &&= off;
  /*
   * The legs solved to the feet from where the hips are, in the frame the
   * pose is stood in, which is the ground's once the hips are at the height
   * the pose put them: carried on its curve no longer, but let down if a leg
   * cannot reach a foot kept behind it, and held up off the ground where
   * the pose has both feet in the air.
   */
  const pose = b.pelvis.t[2] - HIP * fr.tall;
  const r: Rig = { ...rig, at: [rig.at[0], rig.at[1], pose], leg: [[...rig.leg[0]], [...rig.leg[1]]], knee: [rig.knee[0], rig.knee[1]], hover: undefined, plant: undefined };
  for (let k = 0; k < 2; k++) {
    r.leg[k][2] += (k ? 1 : -1) * wrapDeg(feet[k].yaw - want[k].yaw);
    if (off && !feet[k].step && want[k].down) r.at[2] = Math.min(r.at[2], hipsFor(r, fr, k, feet[k].at, 4));
  }
  if (off) {
    for (let k = 0; k < 2; k++) plant(r, fr, k, feet[k].at);
    r.lift = Math.max(0, lowest);
  }
  /*
   * Standing, the hips come up to where that leaves them over a few frames
   * rather than in one. Held down by a foot left behind, they sprang up four
   * tenths of a unit in a frame the moment that foot lifted to step; and the
   * body stood up on a foot the pose still had a little off the ground, left
   * as the only one down when the other lifted. Down they go at once, which
   * is what keeps a planted foot on the ground; and walking, they go as the
   * stride takes them.
   */
  const height = off ? skeleton(fr, r).pelvis.t[2] : b.pelvis.t[2], last = h.hips;
  if (moving || last === undefined || height <= last + HIPS_FREE * dt) {
    h.hips = height;
    return off ? { rig: r, busy } : { rig, busy };
  }
  h.hips = last + Math.min(HIPS_MOST * dt, Math.max(HIPS_FREE * dt, (height - last) * Math.min(1, dt * HIPS_RISE)));
  r.at[2] -= height - h.hips;
  for (let k = 0; k < 2; k++) plant(r, fr, k, feet[k].at);
  if (!off) r.lift = Math.max(0, lowest);
  return { rig: r, busy: true };
}

/**
 * How quickly standing hips come up to where the feet leave them, as a share of the way each second; how fast they may rise
 * without being held back at all, in units a second (more than breathing or a shift of the weight ever asks); and how fast
 * at most: see `footed`.
 */
const HIPS_RISE = 10, HIPS_FREE = 1.5, HIPS_MOST = 3.5;

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
  // Kneeling, on the knee that is down as well as the feet (see `kneelDown`).
  if ((r.kneel ?? 0) > 0) for (let k = 0; k < 2; k++) low = Math.min(low, b[`knee${k}`].t[2] - KNEE_ROUND);
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
 *
 * The bend is spread over three hinges -- the rings at either end of the
 * span and the one at the knee -- so the point is worked out from a quarter
 * of the bend, not the whole: a mitre for the whole of it, pushed out of a
 * ring that is already turned half way, came to a prow at the top of a run
 * (a bend of 120 degrees), a blade in front of the knee and, seen from the
 * front, a thigh ending in a downward spike with nothing under it. And it is
 * spread across the front corners (`KNEE_SQUARE`) as much as the ridge
 * between them, so a hard bend rounds over in a broad kneecap instead.
 */
const KNEE_SPAN = 0.62;
const KNEE_POINT = 0.5;
/** The most the front of the knee is pushed out, of its own round. */
const KNEE_POINT_MOST = 0.15;
/** The most the front of a plate leg's knee is pushed out, of its own round (see `GearBit.point`). */
const KNEE_PLATE = 0.06;
/** How far the front corners of the knee come out toward the ridge between them, bent square, of their own round. */
const KNEE_SQUARE = 0.45;
const KNEE_FOLD = 0.9;
/** And wider across, by this much bent square, as a knee is: without it a knee bent toward the viewer came to a point like a stake. */
const KNEE_WIDE = 0.16;
/**
 * How far below the knee's ring, in the thigh's frame, the back of the calf
 * is still pressed flat against the back of the thigh, and how far above it
 * all of it is.
 */
const KNEE_PRESS: [number, number] = [-0.35, 0.3];

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
function kneeBent(v: readonly V3[], bend: number, onShin: boolean, most = KNEE_POINT_MOST): V3[] {
  const th = Math.max(0, Math.min(150, bend)) * DEG, th0 = bend * DEG;
  const half = Math.cos(th / 2), bent = Math.sin(th / 2);
  const point = Math.min(most, KNEE_POINT * (1 / Math.cos(th / 4) - 1)), square = KNEE_SQUARE * bent * bent;
  const fold = KNEE_FOLD * (1 - half), wide = KNEE_WIDE * bent;
  return v.map(([x, y, z]) => {
    // How far round with the shin: none above the span, all of it below, a half at the knee.
    const w = Math.max(0, Math.min(1, (KNEE_SPAN - z) / (2 * KNEE_SPAN)));
    const at = 1 - Math.abs(2 * w - 1);
    // In front, out by the point at the ridge and by more toward the corners either side of it, all of it of the corner's own
    // round; behind, in by the fold.
    const round = Math.hypot(x, y);
    const yy = y > 0 ? y + at * (point * round + square * (round - y)) : y * (1 - fold * at);
    // Where it goes in the thigh's frame at the knee.
    const a = -w * bend * DEG;
    let c = Math.cos(a), s = Math.sin(a);
    let qy = c * yy - s * z;
    const qz = s * yy + c * z;
    // The back of the calf, folded up beside the thigh, pressed flat against the back of it rather than through it: bent hard, the
    // top of the calf came up inside the thigh, and drawn over it was a lit patch at the back of the knee. From a little under the
    // knee's ring (`KNEE_PRESS`), not only over it: the calf's own facets just below the ring tipped up into the light and stood
    // out behind the thigh's outline, a tube's end out of the back of the knee at a crouch.
    if (w > 0.4 && y < 0 && qy > y) qy += (y - qy) * ramp(qz, KNEE_PRESS[0], KNEE_PRESS[1]);
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
/**
 * And past `CAP_HIGH`, all of the rest of the raise, and the lag left behind by then closed by `CAP_FOLLOW` of the way by the time
 * the arm is overhead (`CAP_HIGH` and a right angle more), turned about the top outside of the shoulder (`CAP_PIVOT` in the arm's
 * frame, out and up) rather than the joint: so a cap on an arm raised overhead rides up with the deltoid round the root of the arm,
 * the arm coming out of it as out of a sleeve. Kept to a quarter of the raise and a little more, about a point inside its own dome,
 * a pauldron on an arm raised to wave or strike was left turned a right angle back from the arm, stood on its side down the front
 * of the chest like a crate with its top corner in the chin, and from behind its whole face was turned to the viewer.
 */
const CAP_HIGH = 60;
const CAP_FOLLOW = 0.8;
const CAP_PIVOT: V3 = [0.4, 0, 0.9];
const capTurn = (a: number): number => {
  const easy = CAP_EASY * DEG, high = CAP_HIGH * DEG;
  if (a < easy) return a * 0.5;
  const at = easy * 0.5 + (Math.min(a, high) - easy) * 0.25;
  if (a <= high) return at;
  const lag = high - at;
  return a - lag * (1 - CAP_FOLLOW * Math.min(1, (a - high) / (Math.PI / 2)));
};
function heldOnShoulder(v: readonly V3[], r: Rig, k: number): V3[] {
  const { n, angle } = shoulderTurn(r, k);
  if (angle < 0.01) return [...v];
  const back = angle - capTurn(angle);
  // About the joint while the arm is low, and from `CAP_EASY` on more and more about the top outside of the shoulder.
  const w = ramp(angle / DEG, CAP_EASY, CAP_HIGH + 30), s = k ? 1 : -1;
  const o: V3 = [s * CAP_PIVOT[0] * w, CAP_PIVOT[1] * w, CAP_PIVOT[2] * w];
  return v.map((p) => {
    const q = turnedAbout([p[0] - o[0], p[1] - o[1], p[2] - o[2]], n, back);
    return [q[0] + o[0], q[1] + o[1], q[2] + o[2]];
  });
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
    // A shade under the boot, not black: near black, a foot peeling off the ground at a walk showed its sole as a black notch under
    // the heel at the size the island is played at.
    sole: [66, 50, 41],
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
  hide?: Array<{ c: V3; r: V3; in?: Xf }>;
  /**
   * The frame those solids are in, when not the part's own: a lock of hair swings from the head, and is hidden by the skull.
   * A solid that says its own frame (`in`) is in that one: a tiller is hidden by the hips, the thighs and the arm.
   */
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
  /** Bent so, the most the front of its knee is pushed out (`kneeBent`), where less than the body's own (`KNEE_POINT_MOST`). */
  point?: number;
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
/** Grown `k` across (x) only: a foot made broader and no longer. */
const widened = (m: Mesh, k: number): Mesh => ({ ...m, v: m.v.map((p): V3 => [p[0] * k, p[1], p[2]]) });
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
/*
 * What stands off the top of the arm -- a shoulder cap, a pauldron -- has an underside from its lower edge in to the arm: with the
 * arm raised it is seen from below, and open it was a hollow rim with the arm and the chest showing through it. Its inner edge is
 * not inked: the arm goes up through it, and inked it was a hexagon drawn round the arm, a hole in the plate.
 */
/**
 * The ring under what stands off the top of the arm with its foot at `z`, to go first under its own: its underside drawn from the
 * foot up into it to a lid (the mesh made with its bottom closed), not left open round the arm. Held on the shoulder while the arm
 * goes up out of it (`heldOnShoulder`), there is no arm in the hole, and open it was a hexagon with the sky showing through it, or
 * seen edge on a wire loop standing off the armpit. With `undercut`, that lid a seam, a fold in the padding and no edge of the piece.
 */
const UNDER_LID = 0.4;
const underRings = (z: number): number[][] => [[z + UNDER_LID, 0.5, 0.48]];
const undercut = (m: Mesh): Mesh => seamed(m, (p) => Math.hypot(p[0], p[1]) < 0.9);
/**
 * The plate pauldron, bottom first, one ring stack: its closed underside (`underRings`) out to the foot of the lower lame, the
 * two lames each flaring a plate's thickness at its foot over the one below, stepping in under the next, and the dome. All of it
 * tipped down toward the neck by `PAULDRON_SLOPE` of how far across it is, as a pauldron runs down off the top of the shoulder onto
 * the trapezius: level, and as wide round as the head, its top stood at the height of the chin, and seen three-quarters on, with
 * the camera looking down, the far one rose beside the jaw to the mouth.
 */
const PAULDRON_SLOPE = 0.24;
function pauldron(): Mesh {
  const lames = [[-1.5, 1.1, 1.08, 0.24], [-0.62, 1.26, 1.24, 0.27]], lip = 0.1, count = 2;
  const rs: number[][] = underRings(-1.5);
  for (let k = 0; k < count; k++) {
    const lo = profileAt(lames, k / count), hi = profileAt(lames, (k + 1) / count);
    rs.push([lo[0], lo[1] + lip, lo[2] + lip, lo[3], lo[4]], [hi[0] - 0.002, hi[1], hi[2], hi[3], hi[4]]);
  }
  rs.push([-0.62, 1.36, 1.32, 0.29], [0.02, 1.3, 1.27, 0.26], [0.4, 0.94, 0.9, 0.14], [0.58, 0.42, 0.4, 0.06]);
  // The underside dark; the lames and the step under each, and the dome's foot, the metal; the dome over it lit.
  const dome = 2 * count + 1;
  const m = undercut(rings(rs, 6, (band) => (band <= 0 ? 'metalDark' : band > dome ? 'metalLit' : 'metal')));
  return { ...m, v: m.v.map(([x, y, z]): V3 => [x, y, z + PAULDRON_SLOPE * x]) };
}

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
/**
 * And a foot goes over the shaft it is under while its sole is turned up toward the viewer, past this of the way from square
 * (`soleUp`): kicked up behind and seen from behind, the foot is the nearest of the two, and drawn under the shaft by its middle
 * (which is out toward the toe, the far end) the shaft's shut end was a flat hexagon over the heel. Only then, and otherwise by its
 * own depth: the heel of a foot on the ground, or just lifting off it, is under the back of the shaft, which overhangs it; and
 * seen side on, held under the shaft, the foot of a leg kicked back went in under the shaft's end.
 */
const SOLE_UP = -0.1;
const soleUp = (b: Bones, k: number, facing: number): boolean => dot(mv(b[`knee${k}`].m, [0, 0, -1]), viewOf(facing).T) > SOLE_UP;

/**
 * The material of a leg of gear that stops above the boot, its shut foot (`legTube`) in the boot's own leather: seen from behind
 * on a leg kicked up, the foot of the legging was a flat hexagon of dark steel over the boot's shaft, a disc on the ankle; in
 * the boot's colour, and a seam, it is the shaft going up into the legging.
 */
const overBoot = (m: Mat) => (band: number): Mat => (band < 0 ? 'boot' : m);

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
 * under the rim from behind the ear to beside the eye, and narrowing as it goes down the cheek, its front edge kept back of the
 * corner of the mouth, over no more than half of the depth of the face seen from the side. Brought round to within a third of a
 * right angle of straight ahead at the jaw, seen side on it was a flat panel over the whole of the lower face, a visor and not a
 * guard on the cheek.
 */
function cheekPlates(): Array<[number[], number[]]> {
  const right: Array<[number, number]> = [[6, 28], [-8, 34], [-16, 38]];
  return [
    [right.map(([a]) => a), right.map(([, c]) => c)],
    [right.map(([, c]) => 180 - c), right.map(([a]) => 180 - a)],
  ];
}

/**
 * A helm's nasal, seen side on a wedge: its front a straight bar down from the rim at `top` to the tip of the nose, its back down the
 * brow onto the bridge of the nose and out along it to the tip. A bar standing off the face by the rim's depth all the way down,
 * side on it floated in front of the face with the sky between them, and hung down past the nose in front of the lip.
 */
function nasalOf(fr: Frame, top: number): Mesh {
  const ff = (z: number): number => faceFront(fr, z);
  // The nose's line, from the bridge out to the tip (`noseOf`).
  const bridge = 1.6, tip = 1.26, nose = (z: number): number => ff(z) + 0.34 * (bridge - z) / (bridge - 1.23);
  const back = ff(top) + 0.36, front = back + 0.18;
  return slab([[back, top, 0.13], [ff(bridge) + 0.03, bridge, 0.13], [nose(tip) + 0.03, tip, 0.13], [front - 0.02, tip - 0.04, 0.13], [front, top, 0.13]], 'metal');
}
/**
 * A cheek plate, the right (`i` nought, from `cheekPlates`) or the left, drawn only while the head is turned less than about a
 * quarter of a right angle away from it (see `Face.unless`): further round, it is round the far side of the face, but standing off
 * the jaw it is never all behind the skull, and it showed as a thin crescent outside the head's outline.
 */
const farCheek = (m: Mesh, i: number): Mesh => {
  const unless: V3 = [i ? 1 : -1, -0.45, 0];
  return { ...m, f: m.f.map((f) => ({ ...f, unless })) };
};

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
  // Not inked where the halves meet the whole at the fork: they meet there edge to edge, and inked it was a line round the skirt.
  return softAt(join(
    ...halves.map(([a, c]) => facetArcs(below, 2 * n, a, c, m)),
    rings(above, 2 * n, (band, j) => m(band + below.length - 1, j), { top: false, bottom: false }),
  ), at(fork)[0]);
}

/**
 * Where a split skirt is split, front and back: a hair either side of straight ahead and straight behind, so the two halves close.
 * A degree either side: two, widened as the hem swings out at a run, was a strip of the thigh up the front of a hauberk.
 */
const SLIT: Array<[number, number]> = [[-89, 89], [91, 269]];
/** A leather jerkin's four panels, split a hair either side of straight ahead, behind and either side. */
const JERKIN_PANELS: Array<[number, number]> = [[3, 87], [93, 177], [183, 267], [273, 357]];

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
          // so from behind it is a helm's back and not a face, nor a box; and the further round behind the further down it is, so
          // its flared foot does not stand out past the jaw seen three-quarters on, a crescent outside the head.
          arcs([skullRing(b.fr, 0.46, 1.0), skullRing(b.fr, 0.86, 0.76), skullRing(b.fr, 1.24, 0.56), skullRing(b.fr, rim.b + 0.08, 0.46)], 6, [208, 205, 203, 202], [332, 335, 337, 338], (band) => (band === 1 ? 'metalLit' : 'metal')),
        )),
      }, {
        // The nasal down over the nose, and a cheek plate down each side of the face: broad under the rim, and narrowing as it goes
        // down and comes round the jaw toward the chin, standing off it a little more at the bottom, so it is a curved plate and not a
        // strap. A bit of their own, out of sight behind the skull: drawn over the head with the rest of the helm, the nasal showed
        // under the back of the rim with the head bowed and seen from behind, a bar down the back of the neck.
        bone: 'head', over: HEAD_OVER, bias: 0.045, hide: [SKULL, JAW],
        mesh: grown(join(
          nasalOf(b.fr, rim.f),
          ...cheeks.map(([lo, hi], i) => farCheek(arcs([skullRing(b.fr, 0.76, 0.42), skullRing(b.fr, 1.2, 0.4), skullRing(b.fr, rim.f - 0.1, 0.4)], 3, lo, hi, (band) => (band === 1 ? 'metalLit' : 'metal')), i)),
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
          ...cheeks.map(([lo, hi], i) => farCheek(worn(arcs([skullRing(b.fr, 0.62, 0.44), skullRing(b.fr, 1.15, 0.4), skullRing(b.fr, rim.f - 0.1, 0.4)], 3, lo, hi, (band) => (band === 0 ? 'scaleDark' : 'scale')), 'scale', (f) => f.m === 'scale'), i)),
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
        // A stiff skirt in four panels, split at the front, the back and each side from the hem to a little under the fork
        // (`splitSkirt`), flaring, and bound along the hem in pale rawhide. Split to the belt, and a slit eight degrees either side of
        // each seam, at a run the panels either side of a slit at the side went each their own way, the side panel a board standing
        // off the hip and the back one a blade flown out behind it.
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.16, skirt: true, mesh: worn(splitSkirt(skirt, -1.6, JERKIN_PANELS, 4, 'leather'), 'studs') },
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.17, skirt: true, mesh: join(...JERKIN_PANELS.map(([a, c]) => facetArcs(profileHem(skirt, 0.05, 0.2), 8, a, c, 'lace'))) },
        { bone: 'pelvis', over: ['belt', 'skirt', 'abdomen', 'pelvis'], bias: 0.02, convex: true, mesh: join(beltRing(b, g + 0.01, 'belt', 0.9, 1.5), decals([plate([0, 1.32 * (g + 0.01) * Math.cos(Math.PI / 8) + 0.01, 1.2], [0.24, 0, 0], [0, 0, 0.22], [0, 1, 0], 'fitting')])) },
        // Stiff caps over the shoulders, their edge burnished pale: domed from a short wall rather than a tall one, which seen with
        // the arm toward the viewer was a box standing on the shoulder.
        // One ring stack from its closed underside (`underRings`) out under the rim and over the dome, and sorted facet by facet, not
        // drawn as a solid, which it is not.
        {
          bone: 'arm', side: 'both', over: ['upper'], bias: 0.2, whole: true,
          mesh: undercut(rings([...underRings(-0.82), [-0.82, 1.04, 1.02, 0.08], [-0.66, 1.1, 1.08, 0.08], [-0.1, 1.14 * b.arm, 1.1, 0.08], [0.38, 0.92, 0.9, 0.06], [0.64, 0.44, 0.42, 0.03]], 6, (band) => (band <= 0 ? 'leatherDark' : band === 1 ? 'leatherLit' : 'leather'))),
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
        // Hanging in a bell to the middle of the thigh, split up the front and the back from the hem to a little under the fork, so
        // each half goes with its leg -- split to the waist, at a run the slits stood open to the belt -- with a
        // band of bright rings round the hem: of its own metal, as brass it was a band of the gold that says fantastic, on every hauberk.
        { bone: 'pelvis', over: ['skirt', 'thigh', 'pelvis'], bias: 0.16, skirt: true, mesh: worn(splitSkirt(skirt, -1.4, SLIT, 4, 'mail'), 'mail') },
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
        // One ring stack with its closed underside, and sorted facet by facet, as the leather cap is.
        { bone: 'arm', side: 'both', over: ['upper'], bias: 0.2, whole: true, mesh: undercut(scaly(rings([...underRings(shoulder[0][0]), ...shoulder], 8, (band) => (band <= 0 ? 'scaleDark' : 'scale')))) },
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
      // Its points short and lying close: twice as deep and standing off, with the arm raised they were a sawtooth of spikes out of
      // the outline at the wrist.
      { bone: 'elbow', side: 'both', over: ['lower', 'hand'], bias: 0.032, convex: true, mesh: teeth([-2.5, 0.8, 0.76], 8, 0.12, 0.015, 'mail') },
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
        bone: 'arm', side: 'both', over: ['upper'], bias: 0.2, whole: true,
        // Domed no higher than the top of the shoulder and standing no further off it than a plate and its padding: as tall as the
        // shoulder was to the jaw, it stood up in front of the chin seen side on and went into the jaw with the arm raised.
        // One surface from the arm out under its edge, down each lame and in under the next, and over the dome, so that from below,
        // with the arm raised, every lame is closed under its foot by the step in to the one above it: made as three pieces, the
        // lames' and the dome's open feet were rims inked round nothing, a hollow hexagon with the arm showing through. Not drawn as
        // a solid, which it is not: drawn a shade at a time, the far lames went down over the near ones.
        mesh: pauldron(),
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
    // Its shut foot in the shoe's dark cloth (`overBoot`), so a leg kicked up behind ends in the shoe, not a pale disc over it.
    const tube = legTube([[-3.05, 0.68, 0.72], [-1.5, 0.84, 0.88], [-KNEE_SPAN, 0.94, 0.98, 0, -0.03], [0, 1.0, 1.04], [KNEE_SPAN, 1.06, 1.1], [mid, 1.12, 1.16], [top, 1.06 * thighTop(b.fr) * 1.1, 1.1 * 1.12]], 6, (band) => (band < 0 ? 'clothDark' : 'cloth'), true);
    return {
      layer: 1,
      bits: [
        { bone: 'hip', side: 'both', bend: true, over: ['thigh'], bias: 0.01, convex: true, mesh: worn(underHem(tube.thigh, b.fr), 'quilt') },
        { bone: 'knee', side: 'both', bend: true, over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: worn(tube.shin, 'quilt') },
        // Wound from the shoe to below the knee in strips of the darker cloth, slanting round the leg as a winding does. Wound level,
        // every band's edge came to a point over the ridge down the shin, a stack of chevrons. Either end of the winding is not inked:
        // it lies on the leg, and with the shin kicked up behind, its open end turned to the viewer was a ring with nothing in it.
        // The trousers drawn in to the ankle, and the winding a hair over them there, so the leg comes down into the shoe as wide as
        // the shoe is: a tenth wider than a leg that hardly narrowed, it stood over the shoe as a stovepipe over a peg, and kicked up
        // behind, its end was a hexagon over a heel half as wide.
        { bone: 'knee', side: 'both', over: ['shin', 'boot'], bias: 0.035, convex: true, mesh: wound(softAt(softAt(rings([-3.02, -2.72, -2.42, -2.12, -1.82, -1.52].map((z, i) => [z, 0.71 + i * 0.034, 0.75 + i * 0.034]), 6, (band) => (band % 2 ? 'cloth' : 'clothDark'), { top: false, bottom: false }), -3.02), -1.52)) },
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
        { bone: 'hip', side: 'both', bend: true, over: ['thigh'], bias: 0.01, convex: true, mesh: join(underHem(tube.thigh, b.fr), pad.thigh) },
        { bone: 'knee', side: 'both', bend: true, over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: join(tube.shin, pad.shin) },
      ],
      hides: ['thigh', 'shin'],
      dyes: { pelvis: { trousers: 'leather' } },
    };
  },
  chain_leggings: (b) => {
    const tube = legTube(legRings(b, 1.1, -2.6), 6, overBoot('mail'), true);
    return {
      layer: 3,
      bits: [
        { bone: 'hip', side: 'both', bend: true, over: ['thigh'], bias: 0.012, convex: true, mesh: worn(underHem(tube.thigh, b.fr), 'mail') },
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
    const rs = legRings(b, g, -2.7).filter((r) => r[0] <= KNEE_SPAN).map((r) => (r[0] === 0 ? [0, r[1] + 0.07, r[2] + 0.05, 0, 0.03] : r));
    const tube = legTube(rs, 6, overBoot('metal'), true), cop = kneePad(rs, 0.5, 0.7, 'metalLit');
    const cuisse = shingled([legAt(b, g, KNEE_SPAN), legAt(b, g, top - 0.9), [top + 0.25, 1.1 * b.fr.hi * g, 1.12 * g]], 3, 0.1, 'metal');
    return {
      layer: 5,
      bits: [
        // Its knee pushed out less than a leg's when bent hard (`KNEE_PLATE`): the poleyn is already carried out of the ring, and with
        // the leg's own point on top of it, at the top of a run the knee came to a blunt prow.
        { bone: 'hip', side: 'both', bend: true, point: KNEE_PLATE, over: ['thigh'], bias: 0.015, convex: true, mesh: join(underHem(tube.thigh, b.fr), cop.thigh, worn(underHem(cuisse, b.fr), 'lames')) },
        { bone: 'knee', side: 'both', bend: true, point: KNEE_PLATE, over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: join(tube.shin, cop.shin) },
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
        { bone: 'hip', side: 'both', bend: true, over: ['thigh'], bias: 0.012, convex: true, mesh: join(worn(underHem(tube.thigh, b.fr), 'scale'), pad.thigh) },
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
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.01, convex: true, layer: 0, front: SHAFT, mesh: softAt(soled(rings([[-3.0, 0.64, 0.68], [-1.3, 0.73, 0.77]], 6, 'trousers', { top: false })), -1.3) },
      // The shoe's top close round the leg, a hair proud of it and not inked: a twentieth out and outlined, seen from behind it was
      // the lid of a grey box over the heel.
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.02, convex: true, front: SHAFT, mesh: softAt(soled(rings([[-3.1, 0.66, 0.7], [-2.5, 0.68, 0.72]], 6, 'clothDark', { top: false })), -2.5) },
      { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: recoloured(widened(swelled(footMesh(), 1, 0.8), 1.12), { boot: 'clothDark' }) },
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
        // The foot in the shaft's own dark hide: in the lighter, the boot of a leg trailing behind was a pale chevron under a dark one
        // seen from in front.
        { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: recoloured(swelled(footMesh(), 1.04), { boot: 'leatherDark' }) },
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
/**
 * How far round from straight ahead or behind, as the sine of it, a skirt goes with both legs alike, and from where it goes more
 * with the nearer: a hair either side of a slit went each with its own leg, and at a run the halves of a hauberk parted from hem to
 * fork, the edges of the slit pale blades at the outline with the thigh showing up between them.
 */
const SKIRT_SLIT: [number, number] = [0.08, 0.34];
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
    const slit = ramp(Math.abs(across), SKIRT_SLIT[0], SKIRT_SLIT[1]);
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1, a = r.leg[k][0] * DEG;
      // Over this leg rather than the other: half each at the front and the back, all of it at its own side; and just half within
      // `SKIRT_SLIT` of straight ahead or behind, so either side of a slit up the front or the back turns as the other does.
      const over = 0.5 + 0.5 * Math.sin((s * across * Math.PI) / 2) * slit;
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
    // Not at the sides, where the back meets the front: flown out there as well, the panel behind a slit at the side lifted away
    // from the one in front of it.
    if (run > 0 && y < 0.2) {
      const t = Math.min(1, (0.2 - y) / 1.6) * ramp(Math.abs(ahead), 0.2, 0.6);
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
   * the shoulder, so it rises behind the jaw rather than across it; and seen
   * from in front, how much further out along the shoulder from the neck it
   * lies, so it rises past the cheek and the side of a helm rather than over
   * them.
   */
  stage?: Record<number, [number, number, number] | [number, number, number, number] | [number, number, number, number, number]>;
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
  /**
   * A bow: its `head` without the string, where the string is made fast at either end (lower, upper) in the bow's own frame,
   * where an arrow lies over the bow hand, and how long an arrow for it is: for a string drawn back (`Rig.draw`) and an arrow on it.
   */
  bare?: Mesh;
  tips?: [V3, V3];
  rest?: V3;
  arrow?: number;
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
    // From behind: straight up off the shoulder and a little forward three-quarters away, and back at a slant square behind. Side on
    // and three-quarters on, more upright and further back over the shoulder, so the blade rises behind the jaw and not across it.
    // Side on it lay back from the fist at the chest by the shoulder across the front of the neck, and read as at the throat; leant
    // out toward whoever is looking instead, it lay level at the height of the neck and read as through it. So side on the fist is
    // further back and out at the shoulder's edge, and the blade keeps its slant -- 35 to 53 degrees on the screen -- clear of the
    // neck and the jaw by a unit and more, standing, walking and running, in every build.
    stage: { 0: [1, 16, 0, 0, 0.85], 1: [0.7, 0, 0, 1], 2: [0.7, 4, 0, 2.0, 0.6], 3: [0.4, 14, 0], 4: [0.35, 25, 0], 5: [0.4, 14, 0], 6: [0.7, 4, 0, 2.0, 0.6], 7: [0.7, 0, 0, 1] },
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
    // standing up out from the shoulder, where lying back it points at the viewer and the bit sits on the shoulder with no haft; and
    // from in front, more upright and back over the shoulder, so the haft from the fist goes up beside the jaw rather than across it,
    // and out past the shoulder's edge only as far as keeps it a unit and a quarter off the head on the screen (carried steadier
    // through the stride -- see `CARRY_STEADY` -- it needs less, and sits nearer the shoulder).
    stage: { 0: [1, -30, 0, 0.6, 1.0], 1: [1, -30, 0, 0.6], 2: [1.15, -45, 0, 1.2], 3: [1.6, -44, 0], 4: [0.7, -16, 0], 5: [1.6, -44, 0], 6: [1.15, -45, 0, 1.2], 7: [1, -30, 0, 0.6] },
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
    // Staged as the battle axe is.
    stage: { 0: [1, -30, 0, 0.8, 1.1], 1: [1, -30, 0, 0.8], 2: [1, -45, 0, 1.2], 3: [1.6, -44, 0], 4: [0.7, -16, 0], 5: [1.6, -44, 0], 6: [1, -45, 0, 1.2], 7: [1, -30, 0, 0.8] },
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
    const bare = join(limb(us.slice(0, 5), m), limb(us.slice(5), m), nock(-1), nock(1));
    return {
      ...bow,
      grip: chain([at(-0.12), at(0.12)], [0.19, 0.19], 6, 'grip'),
      head: join(
        limb(us.slice(0, 5), m), limb(us.slice(5), m),
        nock(-1), nock(1),
        fine(chain([at(-0.985), at(0.985)], [0.05, 0.05], 4, 'string'), 0.1),
      ),
      bare, tips: [at(-0.985), at(0.985)], rest: arrowRest(at, 0.12, h), arrow: arrowFor(L),
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
    bare: join(limb(side(-1, inner).reverse(), m), limb(side(1, inner), m), limb(side(-1, ear).reverse(), 'lace'), limb(side(1, ear), 'lace')),
    tips: [at(-EAR), at(EAR)], rest: arrowRest(at, 0.14, h), arrow: arrowFor(L),
  };
}

/** Where an arrow lies over the bow hand: on the back of the bow just over the top of the grip, which reaches `grip` of the way up a limb `h` long. */
const arrowRest = (at: (u: number) => V3, grip: number, h: number): V3 => {
  const p = at(grip);
  return [0, p[1] + 0.1, p[2] + 0.12];
};
/** How long an arrow is for a bow `L` long, in units: as far as its string is drawn and a hand more, the longer the bow the longer the draw. */
const arrowFor = (L: number): number => Math.min(9.6, 0.36 * L + 3.4);

/** An arrow along z from its nock (nought) to its point (`len`): a shaft, a narrow iron head, three pale vanes at the nock. */
const arrows = new Map<number, Mesh>();
function arrowOf(len: number): Mesh {
  let m = arrows.get(len);
  if (!m) {
    m = join(
      fine(rings([[0, 0.055, 0.055], [len - 0.55, 0.055, 0.055]], 4, 'wood'), 0.11),
      rings([[len - 0.6, 0.07, 0.07], [len - 0.42, 0.06, 0.15], [len, 0.01, 0.01]], 4, 'blade', { top: false }),
      ...[0, 120, 240].map((a) => spun(slab([[0.05, 0.25, 0.012], [0.22, 0.45, 0.012], [0.2, 1.35, 0.012], [0.05, 1.45, 0.012]], 'fletch'), a)),
    );
    arrows.set(len, m);
  }
  return m;
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
 * A held weapon's measures in its own frame (z along it, nought where the fist closes): its butt and its point, where
 * a shouldering fist closes on it, and for a bow where its string is made fast (lower, upper), where an arrow lies over
 * the bow hand and how long an arrow is. For a spell that draws along a weapon without copying its numbers.
 */
export function weaponSpan(id: string): { from: number; to: number; fist: number; tips?: [V3, V3]; rest?: V3; arrow?: number } | null {
  const w = weaponOf(id);
  return w && { from: w.from, to: w.to, fist: w.fist ?? 0, tips: w.tips, rest: w.rest, arrow: w.arrow };
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
 * kept there through a stride, as a bow is carried; `wide` units further
 * out, for keeping its lower limb off the leg (`clearOfLegs`).
 */
function bowArm(r: Rig, fr: Frame, w: Weapon, up: number, facing: number, wide = 0): void {
  const T = fr.tall, dir = bowUp(facing);
  // The fist's height over the hips that puts the lower tip over the ground, with a margin -- and more of one seen from behind and
  // the left, where the bow leans toward whoever is looking and its lower tip comes down the screen onto the feet.
  const fist = Math.max(-2.6, -w.from * dir[2] + BOW_CLEAR - HIP * T) + up + byFacing(BOW_LIFT, facing);
  // At a run, further forward seen from in front, where the body leaning into the run comes forward over the bow and hides its
  // lower limb behind the coat.
  // And swung fore and aft a little with the shoulders' turn, as the free arm swings with it, rather than held still as a prop.
  const at: V3 = [-2.15 * fr.sh - byFacing(BOW_WIDE, facing) - wide, byFacing(BOW_AHEAD, facing) + up * byFacing(BOW_RUN_AHEAD, facing) - BOW_SWING * r.chest[2], fist - GRIP];
  hold(r, fr, 0, at, [-0.4, -0.8, -0.4], dir);
}

/**
 * The right arm carrying `w` over the shoulder: the fist low in front of the
 * chest and the shaft from it back up over the top of the shoulder at the
 * weapon's slant, set in the chest's frame so it rides with the shoulders
 * whatever the hips are doing, with the elbow out and down.
 */
function onShoulder(r: Rig, fr: Frame, w: Weapon, k: number, facing: number): Xf {
  const T = fr.tall, s = k ? 1 : -1;
  /*
   * Not turned all the way with the shoulders as they turn against the
   * stride: a weight on the shoulder has its own inertia, and the haft went
   * with them, so that from in front its head swung from side to side
   * through twenty to thirty degrees over a running stride. It rolls on the
   * shoulder instead, the shoulders turning under it by `CARRY_STEADY` of
   * their turn.
   */
  const chest = joint(joint(ROOT, [0, 0, SPINE * T], ...r.spine), [0, 0, CHEST * T], r.chest[0], r.chest[1], r.chest[2] * (1 - CARRY_STEADY));
  // Eased from one facing's staging to the next as the body comes round (see `byFacing`), rather than changed at the half way.
  const f = ((facing % 8) + 8) % 8, i = Math.floor(f), e = ease(f - i);
  const at = (j: number): number[] => { const s = w.stage?.[j % 8] ?? [1, 0, 0]; return [s[0], s[1], s[2], s[3] ?? 0, s[4] ?? 0]; };
  const [keep, wider, turn, back, aside] = at(i).map((v, j) => v + (at(i + 1)[j] - v) * e);
  /*
   * A weight on the shoulder is not welded to it: as the body drops onto
   * each foot it goes on down a little after it, tipping back over the
   * shoulder, and comes up again as the body rises -- a few degrees at a
   * walk, more at a run.
   */
  const sag = r.hover ? (-0.2 - r.hover.h) * (3 + 6 * r.hover.g) : 0;
  const tilt = ((w.tilt ?? 45) * keep + sag) * DEG, out = ((w.out ?? 12) + wider) * DEG;
  r.spin = turn;
  // Back from upright by the tilt, and leaning out from the head by `out`, so what is behind the shoulder clears the skull.
  const d = unit([s * Math.sin(out) * Math.cos(tilt), -Math.sin(tilt), Math.cos(out) * Math.cos(tilt)]);
  const top: V3 = [s * (2.0 * fr.sh + aside), -0.1 - back, ARM_AT * T + 0.8];
  const reach = w.reach ?? 2.7;
  const fist = place(chest, [top[0] - d[0] * reach, top[1] - d[1] * reach, top[2] - d[2] * reach]);
  const haft = mv(chest.m, d), pole = mv(chest.m, [s * 0.75, -0.25, -0.62]);
  // The wrist that puts the fist there, found by moving it by however far the fist misses, a few times over.
  let wrist = fist;
  for (let q = 0; q < 3; q++) {
    const at = place(hold(r, fr, k, wrist, pole, haft), [0, 0, GRIP]);
    wrist = [wrist[0] + fist[0] - at[0], wrist[1] + fist[1] - at[1], wrist[2] + fist[2] - at[2]];
  }
  const xf = hold(r, fr, k, wrist, pole, haft);
  r.carried = k;
  // The weapon's own frame, as `wield` hangs it from the fist.
  return joint(joint(xf, [0, 0, GRIP], -90), [0, 0, -(w.fist ?? 0)], 0, 0, s * ((w.spin ?? 0) + turn));
}

/** How much of the shoulders' turn a weight carried on one does not go round with: see `onShoulder`. */
const CARRY_STEADY = 0.6;

/** Seconds to take something heavy from one shoulder to the other. */
const SWAP = 1;

/*
 * Something heavy from one shoulder to the other, `side` of the way from the
 * left (nought) to the right (one), as [how far along, where the lower hand
 * is in the chest's frame, which way the haft runs from it]. Blended joint by
 * joint from the one carry to the other, the head of a maul went through the
 * back of the skull; then it was swung about the fist from the shoulder to
 * straight out in front in a twentieth of a second -- the head ten units
 * while the hand went one -- held out level at arm's length by its butt,
 * which nobody can hold a maul by, and swung back up the same way.
 *
 * Now it goes as a sledge does. Lifted off the shoulder by the haft, the
 * lower hand coming forward and down while the haft keeps its slant, so the
 * head comes up off the shoulder still behind the line of the head (see
 * `SWAP_LIFT`), the other hand having reached across to take it further up;
 * swung out past that shoulder and down, both hands on it, the head going
 * down past the knee on its own side -- out to the side, clear of the face
 * from wherever it is seen; hung from the hands at the waist, the head low
 * in front of the feet; swung across under the hands to the other side, up
 * past the knee and out past the other shoulder, and laid back on it. Taken at one pace along that way rather
 * than by the side's own easing (see `shoulder`), so the head never goes
 * faster than it does through the middle, about a unit in a sixtieth of a
 * second -- through the first and last hundredths of the way it went five.
 * Only the way off the left shoulder is given; the way onto the right is
 * the same mirrored.
 */
const SWAP_HALF: Array<[number, V3, V3]> = [
  [0.26, [-0.4, 1.2, -0.2], [-0.92, 0.36, 0.12]],
  [0.4, [-0.5, 1.6, -0.15], [-0.6, 0.45, -0.66]],
  [0.5, [0, 1.65, 0.1], [0, 0.5, -0.87]],
];
const SWAP_WAY: Array<[number, V3, V3]> = [
  ...SWAP_HALF,
  ...SWAP_HALF.filter(([u]) => u < 0.5).reverse().map(([u, g, d]): [number, V3, V3] => [1 - u, [-g[0], g[1], g[2]], [-d[0], d[1], d[2]]]),
];
/**
 * The lift off the shoulder, `SWAP_LIFT` of the way along: the lower hand
 * forward and down from where it carries by `SWAP_LIFT_HAND`, out to its
 * own side, and the haft only tipped by `SWAP_LIFT_TIP` toward upright and
 * forward -- most of its slant kept, so the head rises off the shoulder and
 * comes forward over it rather than swinging out from it.
 */
const SWAP_LIFT = 0.12;
const SWAP_LIFT_HAND: V3 = [0.1, 0.9, -1.0];
const SWAP_LIFT_TIP: V3 = [0.3, 0.2, 0.05];
/** How much of the swap's time the weapon takes to get up to its pace at the start, and to come to rest at the end. */
const SWAP_RAMP = 0.22;
/**
 * How far along the haft from the lower hand the other takes hold: half
 * way to the head of a hafted weapon, so it is carried between two hands a
 * forearm apart and not hung from one fist; and on a sword's grip, below
 * the first, the blade being no place for a hand.
 */
const swapReach = (w: Weapon): number => (w.headUp ? 2.6 : -0.75);

/**
 * Carrying `w` over the shoulders, `side` of the way from the left to the
 * right (see `Kept`): on one, as `onShoulder` has it; between, held in both
 * hands on the way of `SWAP_WAY`, the weapon's frame put in `r.swapping` and the
 * hands on it -- the one it came off the shoulder in at the butt, the other
 * taking hold further up as it is stood up and sliding down to the butt as
 * it goes up onto the other shoulder, and the first letting go. Either way
 * round, the same way.
 */
function shoulder(r: Rig, fr: Frame, w: Weapon, side: number, facing: number): void {
  if (side <= 0 || side >= 1) {
    onShoulder(r, fr, w, side >= 1 ? 1 : 0, facing);
    return;
  }
  const T = fr.tall;
  const chest = joint(joint(ROOT, [0, 0, SPINE * T], ...r.spine), [0, 0, CHEST * T], ...r.chest);
  const copy = (): Rig => ({ ...r, arm: [[...r.arm[0]], [...r.arm[1]]], elbow: [...r.elbow], hand: [[...r.hand[0]], [...r.hand[1]]] });
  // Each end as it is carried there; the weapon's frame, and its lower hand and its haft in the chest's frame.
  const ends = [0, 1].map((k) => {
    const xf = onShoulder(copy(), fr, w, k, facing);
    const c = chest.m, d: V3 = [xf.m[2], xf.m[5], xf.m[8]], g = place(xf, [0, 0, w.fist ?? 0]);
    const into = (v: V3): V3 => [c[0] * v[0] + c[3] * v[1] + c[6] * v[2], c[1] * v[0] + c[4] * v[1] + c[7] * v[2], c[2] * v[0] + c[5] * v[1] + c[8] * v[2]];
    return { xf, g: into([g[0] - chest.t[0], g[1] - chest.t[1], g[2] - chest.t[2]]), d: into(d) };
  });
  // Lifted off each shoulder: from where it carries there, out to that side.
  const lift = (k: number): [number, V3, V3] => {
    const s = k ? 1 : -1, { g, d } = ends[k], H = SWAP_LIFT_HAND, P = SWAP_LIFT_TIP;
    return [k ? 1 - SWAP_LIFT : SWAP_LIFT, [g[0] + s * H[0], g[1] + H[1], g[2] + H[2]], unit([d[0] + s * P[0], d[1] + P[1], d[2] + P[2]])];
  };
  const keys: Array<[number, V3, V3]> = [[0, ends[0].g, ends[0].d], lift(0), ...SWAP_WAY, lift(1), [1, ends[1].g, ends[1].d]];
  // Along the way at `x` of it, curved smoothly through its keys: the lower hand, and the haft's way, of unit length.
  const along = (x: number): [V3, V3] => {
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1][0] < x) i++;
    const v = (x - keys[i][0]) / (keys[i + 1][0] - keys[i][0]), v2 = v * v, v3 = v2 * v;
    const at = (j: number, m: 1 | 2): V3 => keys[Math.max(0, Math.min(keys.length - 1, j))][m];
    const curve = (m: 1 | 2): V3 => {
      const a = at(i - 1, m), b = at(i, m), c = at(i + 1, m), d = at(i + 2, m);
      return [0, 1, 2].map((n) => 0.5 * (2 * b[n] + (c[n] - a[n]) * v + (2 * a[n] - 5 * b[n] + 4 * c[n] - d[n]) * v2 + (3 * b[n] - a[n] - 3 * c[n] + d[n]) * v3)) as V3;
    };
    return [curve(1), unit(curve(2))];
  };
  /*
   * How far along the way it is: at one pace by the distance the head goes,
   * and a little of the hand's, getting up to it over the first `SWAP_RAMP` of the
   * time and coming to rest over the last. Eased by the side alone, the
   * first and last tenths of the way, where the head swings furthest for
   * the least of the hand, went by in four frames.
   */
  const far = (w.to ?? 0) - (w.fist ?? 0), N = 24, gone = [0];
  let [pg, pd] = along(0);
  for (let j = 1; j <= N; j++) {
    const [g, d] = along(j / N);
    gone.push(gone[j - 1] + 0.3 * Math.hypot(g[0] - pg[0], g[1] - pg[1], g[2] - pg[2]) + Math.hypot(g[0] + far * d[0] - pg[0] - far * pd[0], g[1] + far * d[1] - pg[1] - far * pd[1], g[2] + far * d[2] - pg[2] - far * pd[2]));
    [pg, pd] = [g, d];
  }
  const A = SWAP_RAMP, top = 1 / (1 - A);
  const paced = side < A ? (top * side * side) / (2 * A) : side > 1 - A ? 1 - (top * (1 - side) * (1 - side)) / (2 * A) : top * (side - A / 2);
  const want = paced * gone[N];
  let j = 0;
  while (j < N - 1 && gone[j + 1] < want) j++;
  const u = (j + Math.max(0, Math.min(1, (want - gone[j]) / (gone[j + 1] - gone[j] || 1)))) / N;
  const [cg, cd] = along(u);
  const g = place(chest, cg);
  let d = unit(mv(chest.m, cd));
  const low = g[2] + HIP * T - 0.6;
  if (d[2] * far < -low) {
    const flat = Math.hypot(d[0], d[1]) || 1, z = -low / far;
    d = [(d[0] / flat) * Math.sqrt(1 - z * z), (d[1] / flat) * Math.sqrt(1 - z * z), z];
  }
  // Turned about itself from the way it lay on the one shoulder to the way it lies on the other, through the middle of the way:
  // each end's turn carried round to here the shortest way, and the one eased into the other.
  const turned = (k: number): V3 => {
    const e = ends[k].xf.m, d0 = unit([e[2], e[5], e[8]]), x0: V3 = [e[0], e[3], e[6]];
    const axis = cross(d0, d), sn = Math.hypot(axis[0], axis[1], axis[2]), cs = dot(d0, d);
    if (sn < 1e-6) return x0;
    const n = unit(axis), a = Math.atan2(sn, cs);
    const nx = cross(n, x0), nd = dot(n, x0);
    return [0, 1, 2].map((j) => x0[j] * Math.cos(a) + nx[j] * Math.sin(a) + n[j] * nd * (1 - Math.cos(a))) as V3;
  };
  const x0 = turned(0), x1 = turned(1), y0 = cross(d, x0);
  const twist = Math.atan2(dot(x1, y0), dot(x1, x0)) * step(u, 0.25, 0.75);
  const ax = unit([0, 1, 2].map((j) => x0[j] * Math.cos(twist) + y0[j] * Math.sin(twist)) as V3);
  const ay = cross(d, ax), o: V3 = [g[0] - d[0] * (w.fist ?? 0), g[1] - d[1] * (w.fist ?? 0), g[2] - d[2] * (w.fist ?? 0)];
  r.swapping = { m: [ax[0], ay[0], d[0], ax[1], ay[1], d[1], ax[2], ay[2], d[2]], t: o };
  // The hands on it: the right reaching across to take hold up the haft by the left shoulder before it is lifted off, the two
  // changing over along the haft while it hangs, the right to the butt and the left up to where the right was, and the left
  // letting go once it is down on the right shoulder -- and the other way about going the other way. Taken hold of over a fifth of
  // the time, not of the way: a hand reaching across the chest in the first frames of the way went five units a frame.
  const reach = swapReach(w), over = step(u, 0.42, 0.58);
  const grip = [{ on: 1 - step(side, 0.8, 1), up: reach * over }, { on: step(side, 0, 0.2), up: reach * (1 - over) }];
  const free = copy();
  for (let k = 0; k < 2; k++) {
    if (grip[k].on <= 0) continue;
    const s = k ? 1 : -1, pole = mv(chest.m, [s * 0.75, -0.25, -0.62]);
    const fist: V3 = [g[0] + d[0] * grip[k].up, g[1] + d[1] * grip[k].up, g[2] + d[2] * grip[k].up];
    let wrist = fist;
    for (let q = 0; q < 3; q++) {
      const got = place(hold(r, fr, k, wrist, pole, d), [0, 0, GRIP]);
      wrist = [wrist[0] + fist[0] - got[0], wrist[1] + fist[1] - got[1], wrist[2] + fist[2] - got[2]];
    }
    hold(r, fr, k, wrist, pole, d);
    const m = grip[k].on, e = (a: Euler, b: Euler): Euler => [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
    r.arm[k] = e(free.arm[k], r.arm[k]);
    r.hand[k] = e(free.hand[k], r.hand[k]);
    r.elbow[k] = free.elbow[k] + (r.elbow[k] - free.elbow[k]) * m;
  }
  r.carried = u < 0.5 ? 0 : 1;
  r.spin = 0;
}

/**
 * How far round from pointing forward to pointing out to the right a blade in
 * the fist is turned, in degrees, at each facing. Three-quarters on with the
 * right hand nearest, forward is at the viewer, and three-quarters away with
 * it furthest, forward is behind the body; from behind, forward is away. At
 * each the blade is turned out to where its length shows, and between them
 * it comes round smoothly as the body turns -- never more than about fifty
 * degrees from one facing to the next, where it was ninety, and turning the
 * body through an eighth swung the blade round in two frames.
 */
const FIST_OUT = [52, 100, 46, 40, 62, 100, 46, 42];
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
 * screen, and it leans back instead. Side on to the right, held out ahead
 * of the body (`BOW_AHEAD`) and leaning forward too: leant back from the hip,
 * the long bow's stave crossed the face on the screen and the short bow's top
 * limb ended at the jaw; leant back further, the stave came into line with
 * the forearm and the bow turned over in the fist.
 */
const BOW_FWD = [6, 6, 12, -16, 6, 6, 20, -4];
/** How far over the soles a bow's lower tip is held, so it clears the boots and the stride rather than standing on them. */
const BOW_CLEAR = 1.8;
/**
 * How far forward of the hip a bow is held at each facing: further out in front seen from the left, where the bow's side is toward
 * whoever is looking and an upright bow at the hip stands up across the face, and side on from the right, where the bow is
 * beyond the body and its top limb ended at the jaw (see `BOW_FWD`).
 */
const BOW_AHEAD = [0.45, 0.45, 2.5, -0.3, -0.35, 0.8, 1.7, 0.2];
/**
 * And how much further out to the left than the hip: three-quarters on from the left, the width is what takes it off the face; from
 * in front and three-quarters on from the right, it keeps the lower limb off the left shin and thigh.
 */
const BOW_WIDE = [0.9, 0.8, 0, 1.3, 1.0, 0.4, 0.3, 2.6];
/** How far a bow's hand goes forward for each degree the shoulders turn back on its side, walking and running: see `bowArm`. */
const BOW_SWING = 0.03;
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
 * the shaft leans back and out instead, clear of it -- three-quarters away
 * to the left by more, where at a run it came within two units of the
 * middle of the face on the screen. (`./spells/pikeman` keeps a copy.)
 */
const STAFF_BACK = [0, 1, 0, 0, 0, 1, 0, 0];
const STAFF_BACK_BY = -8;
const STAFF_OUT = [10, 22, 10, 10, 10, 32, 10, 10];
/** And side on to the left, where the shaft in the far hand stands in front of the face, leaning forward at least this far, clear of it. */
const STAFF_LEAST = [0, 0, 22, 0, 0, 0, 22, 0];
const staffUp = (facing: number, lean: number): V3 => {
  const back = byFacing(STAFF_BACK, facing);
  const ahead = Math.max(lean, byFacing(STAFF_LEAST, facing));
  const fwd = (ahead + (STAFF_BACK_BY - ahead) * back) * DEG, out = byFacing(STAFF_OUT, facing) * DEG;
  return unit([Math.sin(out), Math.sin(fwd), Math.cos(out) * Math.cos(fwd)]);
};

/**
 * How far further down a blade in the fist dips, in degrees, at the middle of
 * a turn from each facing to the next. Turning from three-quarters on to the
 * left to side on, `FIST_OUT` brings the blade round through pointing at the
 * viewer: from down to the right on the screen to down to the left, short
 * in the middle, it swept sixty degrees across the screen in one frame.
 * Dipped toward the ground on the way, it goes round through pointing down
 * with its length showing.
 */
const FIST_DIP = [0, 0, 0, 0, 0, 40, 0, 0];

/**
 * A blade in the fist at `wrist` (in the body's frame): forward and down and
 * out from the body, set off the hips rather than the forearm so it keeps to
 * a line that shows its length whichever way the body is seen, and tipped
 * forward and back with the arm's swing by a share of it; at a run carried
 * nearer level, so its point goes along over the knees coming through rather
 * than down across them; and raised toward level wherever that would put its
 * point in the ground -- as far as keeps it out, worked out rather than tried
 * eight degrees at a time, which stepped.
 */
function fistHeld(r: Rig, b: Bones, w: Weapon, at: number, wrist: Xf): Xf {
  const facing = r.bladeFacing ?? at;
  const out = fistOut(facing) * DEG;
  const fist = place(wrist, [0, 0, GRIP]);
  const run = (r.hover?.w ?? 0) * (r.hover?.g ?? 0);
  const f = ((facing % 8) + 8) % 8, u = f - Math.floor(f);
  const dip = FIST_DIP[Math.floor(f) % 8] * 4 * u * (1 - u);
  let tip = ((w.down ?? FIST_DOWN - FIST_RUN * run) + dip - FIST_SWING * (r.arm[1][0] - 3)) * DEG;
  tip = Math.min(tip, Math.asin(Math.max(-1, Math.min(1, (fist[2] - 0.5) / w.to))));
  const h: V3 = [Math.sin(out), Math.cos(out), 0];
  const dir: V3 = [h[0] * Math.cos(tip), h[1] * Math.cos(tip), -Math.sin(tip)];
  return { m: aimed(b.pelvis, [0, 0, 0], dir, [Math.cos(out), -Math.sin(out), 0]).m, t: fist };
}

/**
 * A spear or a staff upright in the right fist at `wrist`, or a bow in the
 * left, as `staffUp` and `bowUp` stand them; a bow turned about its stave
 * from where it is seen, so its bend shows rather than its edge (see
 * `BOW_TURN`).
 */
function uprightHeld(b: Bones, w: Weapon, facing: number, wrist: Xf, swung = 0): Xf {
  let up: V3 = w.carry === 'staff' ? staffUp(facing, w.lean ?? 0) : bowUp(facing);
  if (swung) {
    // Its lower end swung out from the body about the hips' forward axis, `swung` degrees, and its top in toward the middle.
    const a = (w.carry === 'bow' ? -swung : swung) * DEG, c = Math.cos(a), sn = Math.sin(a);
    up = [up[0] * c - up[2] * sn, up[1], up[2] * c + up[0] * sn];
  }
  const turn = w.carry === 'bow' ? byFacing(BOW_TURN, facing) * DEG : 0;
  return { m: aimed(b.pelvis, [0, 0, 0], up, [Math.cos(turn), -Math.sin(turn), 0]).m, t: place(wrist, [0, 0, GRIP]) };
}

/** How far clear of the legs, bare, what is carried is kept: as thick as plate makes them, and a little more. */
const LEG_CLEAR = 0.25;
/** How far the arm carrying it may be taken out from the side for that, in degrees; a bow's hand, in units for each of those. */
const CLEAR_OUT = 34, BOW_OUT_BY = 0.05;
/** How far an upright one may be swung out about the hand where the arm has not kept it clear, in degrees: see `wield`. */
const UPRIGHT_OUT = 12;
/** How far from the middle of the head, on the screen, a spear's shaft or a bow's stave is kept: past the hair and the ears. */
const FACE_CLEAR = 3.2;

/**
 * The least turn, from nought to `most` degrees, that leaves `room` at
 * nought or more: stepped toward from nought by how fast the room grows
 * with the turn, a few times, so that it changes smoothly as the pose does.
 * Halving to the edge of what clears jumped to the far end of the range
 * the moment nothing in it cleared, and the blade with it, a quarter turn
 * in a frame.
 */
function leastTurn(room: (by: number) => number, most: number): number {
  let by = 0, r = room(0);
  for (let q = 0; q < 3 && r < 0; q++) {
    const h = by + 2 <= most ? 2 : -2, slope = (room(by + h) - r) / h;
    by = Math.max(0, Math.min(most, by - (r * slope) / (slope * slope + 1e-4)));
    r = room(by);
  }
  return by;
}

/**
 * How far what is carried in hand at `xf` is clear of the legs as `b` has
 * them (see `legRoom`) -- a blade and the grip's end below the fist; a
 * spear's butt or a bow's lower limb -- less `LEG_CLEAR`.
 */
function legsRoom(b: Bones, w: Weapon, xf: Xf): number {
  const lower = legRoom(b, place(xf, [0, 0, w.from]), place(xf, [0, 0, -0.6]));
  return (w.carry === 'fist' ? Math.min(lower, legRoom(b, place(xf, [0, 0, 0.6]), place(xf, [0, 0, w.to]))) : lower) - LEG_CLEAR;
}

/**
 * And how far the length of a spear or a bow above the fist is clear of the
 * face on the screen, less `FACE_CLEAR`: all of it, where the old guard
 * looked at the top alone, and the shaft went across the face below it.
 * What is well behind the head is hidden by it, and not counted.
 */
function faceRoom(b: Bones, w: Weapon, xf: Xf, view: View): number {
  const c = place(b.head, [0, 0.1, 1.2]), cd = dot(c, view.T), cs = onScreen(view, c);
  let room = Infinity;
  for (let i = 0; i <= 8; i++) {
    const q = place(xf, [0, 0, 0.6 + ((w.to - 0.6) * i) / 8]);
    if (dot(q, view.T) < cd - 0.8) continue;
    const p = onScreen(view, q);
    room = Math.min(room, Math.hypot(p[0] - cs[0], p[1] - cs[1]) - FACE_CLEAR);
  }
  return room;
}

/**
 * The arm carrying a blade, a spear or a bow taken out from the side as far
 * as keeps what is in it clear of the legs, and no further. It was turned in
 * the fist instead, by trying a handful of ways round each frame and taking
 * the cheapest that cleared: from one frame to the next the choice jumped,
 * and the blade flicked ten to thirty degrees once a stride; and a spear's
 * butt swung out from the leg brought its shaft in across the face. Now the
 * arm is moved, by the least that does it, found by halving: as the leg
 * comes and goes the arm goes out and back with it smoothly, the weapon is
 * held in the hand as it always is, and a spear moved out with the hand
 * stays as far off the face as it was.
 */
/** How far the last `clearOfLegs` took the arm out, in degrees: what `clearAhead` reads. */
let clearedBy = 0;
function clearOfLegs(r: Rig, fr: Frame, w: Weapon, facing: number, g: number, least = 0): void {
  const bow = w.carry === 'bow', k = bow ? 0 : 1, s = k ? 1 : -1, T = fr.tall;
  const b = skeleton(fr, r);
  const [ap, aa, at] = r.arm[k];
  // Out from the side by `by` degrees; a bow, whose arm is put where the hand is wanted (`bowArm`), by its hand put further out.
  const set = (by: number): void => {
    if (bow) bowArm(r, fr, w, 1.3 * g, facing, by * BOW_OUT_BY);
    else r.arm[k] = [ap, aa + by, at];
  };
  const room = (by: number): number => {
    set(by);
    const arm = joint(b.chest, [s * 2.1 * fr.sh, -0.1, ARM_AT * T + r.shrug[k]], r.arm[k][0], -s * r.arm[k][1], s * r.arm[k][2]);
    const wrist = joint(joint(arm, [0, 0, -UPPER * T], r.elbow[k]), [0, 0, -LOWER * T], ...r.hand[k]);
    return legsRoom(b, w, w.carry === 'fist' ? fistHeld(r, b, w, facing, wrist) : uprightHeld(b, w, facing, wrist));
  };
  clearedBy = 0;
  if (room(0) >= 0) {
    if (least > 0) set((clearedBy = Math.min(CLEAR_OUT, least)));
    else set(0);
    return;
  }
  let lo = 0, hi = CLEAR_OUT;
  if (room(hi) >= 0) {
    for (let q = 0; q < 8; q++) {
      const mid = (lo + hi) / 2;
      if (room(mid) >= 0) hi = mid;
      else lo = mid;
    }
  }
  set((clearedBy = Math.max(hi, Math.min(CLEAR_OUT, least))));
}

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

/**
 * How far round from facing forward to facing out to the left a shield on
 * the left forearm is turned, in degrees, at each facing, so that it is
 * never seen edge on: turned the same way at every facing, side on from the
 * right the back of a heater was all but edge on, a plank standing out in
 * front of the chest, and three-quarters on from the right and
 * three-quarters away from the left it was edge on outright. Now its face
 * is turned to whoever is looking, or its back square on, wherever it is.
 */
const SHIELD_OUT = [38, 15, 66, 45, 38, 75, 55, 38];
/**
 * And how much more at a run, at each facing, as far as the shield arm's
 * elbow is bent up for one (`SHIELD_BENT`, degrees from where it is walking to
 * where it is running): the forearm brought up turns the shield with it, and
 * from in front it was a board seen all but edge on beside the hip, at
 * three-quarters on to the left more so. Square on to the viewer, at a run,
 * its face or its back is turned a further three tenths or so toward them.
 */
const SHIELD_RUN = [-23, -30, 0, 0, -28, 20, 20, 0];
const SHIELD_BENT = [40, 76];

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
function wielded(xf: Xf, wrist: Xf, fist: V3, w: number, haft = 0): Xf {
  const n = (v: V3): V3 => unit(v);
  const mix = (a: V3, b: V3): V3 => n([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]);
  const col = (m: M3, i: number): V3 => [m[i], m[3 + i], m[6 + i]];
  // Turned further toward the line of the forearm by `haft`, or right round past it to point down out of the bottom of the fist.
  const a = Math.atan2(0.5, 0.87) + haft * DEG;
  const dir = mix(col(xf.m, 2), n(mv(wrist.m, haft ? [0, Math.cos(a), -Math.sin(a)] : [0, 0.87, -0.5])));
  const out = mix(col(xf.m, 0), n(mv(wrist.m, [1, 0, 0])));
  return { m: aimed(ROOT, [0, 0, 0], dir, out).m, t: fist };
}

/**
 * How far the length of something held, from `a` to `b`, is clear of the
 * legs as `b` has them -- the thighs and the shins, each as thick as it is,
 * and a little more -- in units: below nought, it goes through one.
 */
function legRoom(bones: Bones, a: V3, b: V3): number {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dd = dot(d, d) || 1;
  let least = Infinity;
  for (let k = 0; k < 2; k++) {
    // And the foot: running seen from in front, the boot comes up high enough in the air to meet a spear's butt or a bow's limb.
    const foot = bones[`ankle${k}`];
    for (const [p, q, r] of [[bones[`hip${k}`].t, bones[`knee${k}`].t, 1.15], [bones[`knee${k}`].t, foot.t, 0.95], [place(foot, [0, -0.5, -0.4]), place(foot, [0, 1.6, -0.5]), 0.7]] as Array<[V3, V3, number]>) {
      // Sampled along the held thing, the nearest point of the bone to each.
      const e: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], ee = dot(e, e) || 1;
      for (let i = 0; i <= 8; i++) {
        const x: V3 = [a[0] + (d[0] * i) / 8, a[1] + (d[1] * i) / 8, a[2] + (d[2] * i) / 8];
        const t = Math.max(0, Math.min(1, ((x[0] - p[0]) * e[0] + (x[1] - p[1]) * e[1] + (x[2] - p[2]) * e[2]) / ee));
        least = Math.min(least, Math.hypot(x[0] - p[0] - e[0] * t, x[1] - p[1] - e[1] * t, x[2] - p[2] - e[2] * t) - r);
      }
    }
  }
  return dd > 0 ? least : Infinity;
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
/** The material most of a mesh's facets are. */
function mostOf(m: Mesh): Mat {
  const n = new Map<Mat, number>();
  for (const f of m.f) n.set(f.m, (n.get(f.m) ?? 0) + 1);
  let best: Mat = m.f[0].m;
  for (const [k, c] of n) if (c > (n.get(best) ?? 0)) best = k;
  return best;
}
/** A palette with its boot this colour (see `dress`), kept, so each is made once. */
const SHAFTED = new WeakMap<Palette, Map<RGB, Palette>>();
function shaftIn(P: Palette, c?: RGB): Palette {
  if (!c) return P;
  let by = SHAFTED.get(P);
  if (!by) SHAFTED.set(P, (by = new Map()));
  let out = by.get(c);
  if (!out) by.set(c, (out = { ...P, boot: c }));
  return out;
}

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
  // What a legging that stops above the boot has at its shut foot (`overBoot`): the boot's colour, the body's own boot's unless
  // boots are worn, when it is the colour most of their shaft is. In the body's brown over a shoe's pale leg or a mail boot it was
  // a brown disc at the ankle.
  const feet = worn.find(([si]) => DRESSED[si] === 'feet');
  const shaft = feet && gearPalette(pal, feet[1], STEP.feet ?? 0)[mostOf(feet[2].bits[0].mesh)];
  worn.forEach(([si, piece, model], order) => {
    const P = shaftIn(gearPalette(pal, piece, STEP[DRESSED[si]] ?? 0), DRESSED[si] === 'legs' ? shaft : undefined);
    const rare = piece.rare || undefined;
    model.bits.forEach((bit, seq) => {
      const sides = bit.side === 'both' ? [0, 1] : bit.side === undefined ? [-1] : [bit.side];
      for (const k of sides) {
        const bone = b[k < 0 ? bit.bone : `${bit.bone}${k}`];
        const m = k === 0 && bit.side === 'both' ? mirrored(bit.mesh) : bit.mesh;
        // A bit carried whole is on a frame of its own, the bone's own frame being what is bent.
        const xf = bit.bend && bit.bone === 'hip' ? joint(bone, [0, 0, -THIGH * fr.tall])
          : bit.at || bit.turn || bit.whole ? joint(bone, bit.at ?? [0, 0, 0], ...(bit.turn ?? [0, 0, 0])) : bone;
        const v = bit.skirt ? bentWith(m.v, r, fr) : bit.bend ? kneeBent(m.v, kneeBend(b, k), bit.bone === 'knee', bit.point)
          : bit.whole && bit.bone === 'arm' ? heldOnShoulder(m.v, r, k) : undefined;
        const part: Part = { mesh: m, xf, bias: bit.bias ?? 0.02, pal: P, rare, seed: si + 1, convex: bit.convex, front: bit.front, v, hide: bit.hide };
        // What is worn on a thigh goes under the tunic's skirt as the thigh does, where the skirt is still to be seen.
        if (bit.bone === 'hip' && !bit.skirt) part.under = (named.get('skirt') ?? []).filter((p) => !hidden.has(p));
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
    // A boot's foot over its own shaft with its sole turned up (`soleUp`): the shaft put down under it, rather than the foot up over
    // the shaft, which was carried up past a coat's skirt by what the shaft goes over, and drew a foot kicked up behind over the hem.
    if (/^foot[01]$/.test(w.on) && soleUp(b, +w.on[4], facing)) for (const o of put) if (o.order === w.order && o.on === `shin${w.on[4]}`) o.part.under = w.part;
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
 * Where what is held in the hands is, and in which: its frame -- z along it
 * from its butt (`from`) to its point (`to`), nought where the fist closes on
 * it -- in the body's frame, as the carry puts it and as far as a spell's
 * pose takes it into the arms (`wield`, `wieldStaff`, `wieldBow`, `haft`,
 * `slide`). Nothing while it is put away. What `wield` draws it by, and what
 * `figureJoint` finds its point and its tips by.
 */
function heldFrame(r: Rig, b: Bones, arm: Weapon, facing: number): { xf: Xf; hand: number } | null {
  if (r.stowed) return null;
  let xf: Xf, hand: number;
  if (arm.carry === 'shoulder') {
    // In the fist square across it, and turned in the fist toward the line of the forearm by `haft`.
    hand = r.carried;
    const k = hand;
    xf = joint(joint(b[`wrist${k}`], [0, 0, GRIP], -90 - (r.haft ?? 0)), [0, 0, -(arm.fist ?? 0)], 0, 0, (k ? 1 : -1) * ((arm.spin ?? 0) + r.spin));
  } else if (arm.carry === 'fist') {
    hand = 1;
    // Forward and down from the fist (see `fistHeld`); on the move the arm carrying it keeps it clear of the legs (`clearOfLegs`).
    const fist = place(b.wrist1, [0, 0, GRIP]);
    const base = fistHeld(r, b, arm, facing, b.wrist1);
    /*
     * Wherever it would still go through a leg -- part way through a
     * blend from one pose to another -- turned out from the body about
     * the fist by as little as clears it (`leastTurn`), rather than the
     * cheapest of a few ways round tried afresh every frame, so that it
     * turns out smoothly and back as the leg comes and goes rather than
     * jumping between them.
     */
    const turned = (by: number): Xf => (by ? { m: mm(rz(-by * DEG), base.m), t: fist } : base);
    xf = turned(leastTurn((by) => legsRoom(b, arm, turned(by)) + LEG_CLEAR, CLEAR_OUT));
    // A blow struck by a spell: carried by the forearm, `wield` of the way, so the swing of the arm swings it.
    if ((r.wield ?? 0) > 0) xf = wielded(xf, b.wrist1, fist, Math.min(1, r.wield ?? 0), r.haft ?? 0);
  } else {
    hand = arm.carry === 'bow' ? 0 : 1;
    // A staff leant out from the body as well as forward, so its shaft passes beside the face rather than across it (see
    // `uprightHeld`); the arm carrying it keeps its lower end clear of the legs (`clearOfLegs`).
    xf = uprightHeld(b, arm, facing, b[`wrist${hand}`]);
    /*
     * Wherever the lower end -- a spear's butt, a bow's lower limb --
     * would still go through a leg, blended between poses: swung out from
     * the body about the hand by as little as clears it (`leastTurn`), a
     * few degrees at most, and never so far that the length above the
     * hand comes in over the face on the screen. It was swung five degrees
     * at a time, which jumped, with only the top kept off the head, and
     * the shaft below the top went across the face.
     */
    const wrist = b[`wrist${hand}`], at = (by: number): Xf => uprightHeld(b, arm, facing, wrist, by);
    if (legsRoom(b, arm, xf) + LEG_CLEAR < 0) {
      const view = viewOf(facing);
      let most = UPRIGHT_OUT;
      if (faceRoom(b, arm, at(most), view) < 0) {
        let ok = 0;
        if (faceRoom(b, arm, xf, view) >= 0) {
          for (let q = 0; q < 6; q++) {
            const mid = (ok + most) / 2;
            if (faceRoom(b, arm, at(mid), view) >= 0) ok = mid;
            else most = mid;
          }
        }
        most = ok;
      }
      xf = at(leastTurn((by) => legsRoom(b, arm, at(by)) + LEG_CLEAR, most));
    }
    // Taken into the arms by a spell: see `heldByArms`.
    const w = arm.carry === 'staff' ? r.wieldStaff ?? 0 : r.wieldBow ?? 0;
    if (w > 0) xf = heldByArms(r, b, arm, xf, hand, Math.min(1, w));
  }
  // Slid through the fist toward its point.
  if (r.slide) xf = { m: xf.m, t: [xf.t[0] + xf.m[2] * r.slide, xf.t[1] + xf.m[5] * r.slide, xf.t[2] + xf.m[8] * r.slide] };
  return { xf, hand };
}

/**
 * A spear or a bow taken from its carry into the arms, `w` of the way: a
 * spear along the line of the right forearm, its point past the knuckles
 * (turned toward or away from that line by `haft`), or with `both` along the
 * line from the right fist through the left; a bow square across the left
 * fist, its back out past the knuckles, so the bow arm points it and the
 * hand's turn about the forearm cants it.
 */
function heldByArms(r: Rig, b: Bones, arm: Weapon, carried: Xf, hand: number, w: number): Xf {
  const wrist = b[`wrist${hand}`].m;
  const col = (m: M3, i: number): V3 => [m[i], m[3 + i], m[6 + i]];
  const mix = (a: V3, c: V3, u: number): V3 => unit([a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u]);
  let dir: V3;
  if (arm.carry === 'staff') {
    const h = (r.haft ?? 0) * DEG;
    dir = mv(wrist, [0, -Math.sin(h), -Math.cos(h)]);
    const both = Math.min(1, r.both ?? 0);
    if (both > 0) {
      const a = place(b.wrist1, [0, 0, GRIP]), c = place(b.wrist0, [0, 0, GRIP]);
      const d: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      // Hands too near together to say a line between them leave it to the right forearm.
      if (Math.hypot(d[0], d[1], d[2]) > 0.8) dir = mix(dir, unit(d), both);
    }
  } else dir = mv(wrist, [0, 1, 0]);
  return { m: aimed(ROOT, [0, 0, 0], mix(col(carried.m, 2), dir, w), mix(col(carried.m, 0), col(wrist, 0), w)).m, t: carried.t };
}

/** Where a bow's string is drawn to: from straight between its tips toward the right hand's fingers, `Rig.draw` of the way; or nothing, undrawn and with no arrow on it. */
function nockOf(r: Rig, b: Bones, arm: Weapon, xf: Xf): V3 | null {
  const draw = Math.max(0, Math.min(1, r.draw ?? 0));
  if (!arm.tips || (draw <= 0 && !r.nocked)) return null;
  const [lo, hi] = arm.tips.map((p) => place(xf, p));
  const mid: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const to = place(b.wrist1, [0, 0, GRIP]);
  return [mid[0] + (to[0] - mid[0]) * draw, mid[1] + (to[1] - mid[1]) * draw, mid[2] + (to[2] - mid[2]) * draw];
}

/** How far over the seat the low end of what is slung across the back is kept, sat; and the most it is tipped across for that. */
const SLUNG_CLEAR = 0.4;
const SLUNG_MOST = 80 * DEG;

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
    const held = r.stowed ? null : heldFrame(r, b, arm, facing);
    if (!r.stowed && arm.carry === 'shoulder' && r.swapping) {
      // On its way from one shoulder to the other in both hands, in front of the body and nowhere behind it (see `shoulder`): over
      // the body from whichever side the middle of it is out to.
      const xf: Xf = { m: mm(b.pelvis.m, r.swapping.m), t: place(b.pelvis, r.swapping.t) };
      const mid = place(xf, [0, 0, (arm.from + arm.to) / 2]), ch = b.chest.t;
      const whole = bit(c.whole, xf, 0.03, { after: on('chest', 'abdomen', 'upper0', 'upper1'), front: within(xf, unit([mid[0] - ch[0], mid[1] - ch[1], 0])) });
      for (const h of [...(named.get('hand0') ?? []), ...(named.get('hand1') ?? [])]) h.after = whole;
      // And under the head and whatever is on it while its head is further off than the skull: lifted off the shoulder from behind
      // it, it was put after the chest and so over the head, and a maul's head was drawn on the back of the crown.
      const top = place(xf, [0, 0, arm.to - 1]), skull = place(b.head, SKULL.c), T = viewOf(facing).T;
      if ((top[0] - skull[0]) * T[0] + (top[1] - skull[1]) * T[1] + (top[2] - skull[2]) * T[2] < 0) whole.under = on('head', 'ears', 'cap', 'top', 'fall', 'beard', 'nose', 'tails', 'neck');
    } else if (held && r.thrown && held.hand === 1) {
      // Thrown: out of the hand and on its way (the spell draws it in flight), with nothing put away in its place.
    } else if (held && arm.carry === 'shoulder') {
      // In the fist and back over the shoulder: what is in front of the shoulder over the chest, and what is behind it under.
      const k = r.carried;
      const xf = held.xf;
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
    } else if (held && arm.carry === 'fist') {
      const grip = bit(arm.grip, held.xf, 0.02);
      bit(arm.head, held.xf, 0.035);
      for (const h of named.get('hand1') ?? []) h.after = grip;
    } else if (held) {
      const { xf, hand } = held;
      const grip = bit(arm.grip, xf, 0.02);
      // A bow with its string drawn, or an arrow on it: the bow without its string, and the string in two from either tip to where
      // it is drawn to; the arrow from there over the bow hand.
      const nock = arm.carry === 'bow' ? nockOf(r, b, arm, xf) : null;
      bit(nock && arm.bare ? arm.bare : arm.head, xf, 0.035);
      if (nock && arm.tips) {
        const [lo, hi] = arm.tips.map((p) => place(xf, p));
        bit(fine(chain([lo, nock, hi], [0.05, 0.05, 0.05], 4, 'string', false), 0.1), ROOT, 0.03);
        if (r.nocked && arm.rest && arm.arrow) {
          const rest = place(xf, arm.rest);
          bit(arrowOf(arm.arrow), aimed(ROOT, nock, [rest[0] - nock[0], rest[1] - nock[1], rest[2] - nock[2]], mv(xf.m, [1, 0, 0])), 0.04);
        }
      }
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
      const lr = left !== (r.tool && r.lefty) ? -1 : 1;
      slungLeft = lr < 0;
      const mid = (arm.from + arm.to) / 2;
      /*
       * Seated, a long blade slung across the back went straight down through the seat behind the hips and out under it:
       * tipped further across the back, a few degrees at a time, as far as keeps its low end over the seat.
       */
      const seat = r.sit ? place(b.pelvis, [0, 0, SEAT])[2] + SLUNG_CLEAR : -Infinity;
      let sl = (arm.slant ?? 30) * DEG, dir: V3, z: number;
      for (;;) {
        dir = up ? [lr * Math.sin(sl), 0, Math.cos(sl)] : [-lr * Math.sin(sl), 0, -Math.cos(sl)];
        // Hung lower the longer it is, so whichever end is up stops at the ear rather than over the crown -- except a spear or a
        // javelin, whose head goes up over the head as a slung spear's does, so that its butt stops at the calf and not on the ground;
        // while the hands work, down behind the head, where over it the head of the spear stands beside the hammer raised there.
        const top = 0.85 + Math.max(dir[2] * (arm.to - mid), dir[2] * (arm.from - mid));
        z = 0.85 - Math.max(0, top - (arm.carry === 'staff' ? (r.tool ? 3.1 : 4.6) : 3.1));
        const end = (e: number): number => place(b.chest, [dir[0] * (e - mid), behind, z + dir[2] * (e - mid)])[2];
        if (Math.min(end(arm.from), end(arm.to)) >= seat || sl >= SLUNG_MOST) break;
        sl = Math.min(SLUNG_MOST, sl + 5 * DEG);
      }
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
      /*
       * On the left forearm, its face out to the left and a little forward,
       * where it reads from the front, and the hand behind it. Which way it
       * faces is the chest's, not the forearm's: turned with the forearm, a
       * forearm brought up level at a run laid it flat like a tray, and it
       * see-sawed with the swing. Tipped a third of the way toward square
       * to the forearm, which is as much as keeps the arm along the back of
       * it, and its top as near the chest's up as that allows; turned out
       * from forward by however far shows it best from where it is seen (see
       * `SHIELD_OUT`).
       */
      const run = Math.max(0, Math.min(1, (r.elbow[0] - SHIELD_BENT[0]) / (SHIELD_BENT[1] - SHIELD_BENT[0])));
      const so = (byFacing(SHIELD_OUT, facing) + run * byFacing(SHIELD_RUN, facing)) * DEG;
      const fa = mv(b.elbow0.m, [0, 0, -1]), want = mv(b.chest.m, [-Math.sin(so), Math.cos(so), 0]), lift = mv(b.chest.m, [0, 0, 1]);
      const along = dot(want, fa) / 3;
      const n = unit([want[0] - fa[0] * along, want[1] - fa[1] * along, want[2] - fa[2] * along]);
      const y = unit([lift[0] - n[0] * dot(lift, n), lift[1] - n[1] * dot(lift, n), lift[2] - n[2] * dot(lift, n)]), x = cross(y, n);
      const mid = place(b.elbow0, [0, 0, -1.25]);
      const xf: Xf = { m: [x[0], y[0], n[0], x[1], y[1], n[1], x[2], y[2], n[2]], t: [mid[0] + n[0] * 0.78, mid[1] + n[1] * 0.78, mid[2] + n[2] * 0.78] };
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

/**
 * A loose hand's fingers curled in toward the palm by `c`, from hanging
 * straight (nought) to closed on themselves (one): turned about the
 * knuckles, all of it past them and none above. Walking into a run the hand
 * closes as the gait comes up, where it was loose up to half way and a fist
 * from there, and flickered between the two wherever the gait wavered
 * across the middle.
 */
const KNUCKLE = -0.45 * HAND;
function curled(v: V3[], k: number, c: number): V3[] {
  const s = k ? 1 : -1, most = 85 * DEG * c;
  return v.map(([x, y, z]) => {
    const share = Math.max(0, Math.min(1, (KNUCKLE - z) / 0.25));
    if (!share) return [x, y, z];
    const a = share * most, cs = Math.cos(a), sn = Math.sin(a), dz = z - KNUCKLE;
    return [x * cs + s * dz * sn, y, KNUCKLE + dz * cs - s * x * sn];
  });
}

/** The hand to draw on side `k`: a fist, loose, or the open one nearest as open as the pose has it. */
function handOf(kit: Kit, r: Rig, k: number): Mesh {
  const o = +r.open[k];
  if (o < OPEN_LEAST) return r.loose[k] ? kit.loose[k] : kit.hands[k];
  let i = 0;
  while (i < OPENING.length - 1 && o > (OPENING[i] + OPENING[i + 1]) / 2) i++;
  return kit.open[k][i];
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
  const head = name('head', { mesh: headFor(kit, r), xf: b.head, bias: 0.2 });
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
  // A hand in one of the shapes a spell asks for, blended from closed (see `shapedHand`).
  const shaped = [shapedOf(kit, r, 0), shapedOf(kit, r, 1)];
  if (r.tool) parts.push({ mesh: kit.mallet, xf: r.lefty ? b.wrist0 : b.wrist1, bias: 0.04 }, { mesh: kit.chisel, xf: r.lefty ? b.wrist1 : b.wrist0, bias: 0.04 });
  for (let k = 0; k < 2; k++) {
    // Raised, the upper arm is sorted facet by facet rather than drawn as a solid with no facet in front of another: looking down
    // the arm from the elbow, the far side of the sleeve's hem is behind the arm, and drawn a shade at a time it went over it.
    const upper = k ? kit.upper : mirrored(kit.upper), hemmed = hemDrawnIn(upper.v, r, k, kit.fr);
    parts.push(
      name(`upper${k}`, { mesh: upper, v: hemmed, xf: b[`arm${k}`], bias: 0, convex: !hemmed }),
      name(`lower${k}`, { mesh: kit.lower, xf: b[`elbow${k}`], bias: 0.02 }),
      name(`hand${k}`, shaped[k]
        ? { mesh: kit.shaped[k].closed, v: shaped[k], xf: b[`wrist${k}`], bias: 0.03 }
        : { mesh: handOf(kit, r, k), v: +r.open[k] < OPEN_LEAST && r.loose[k] && r.curl[k] > 0.02 ? curled(kit.loose[k].v, k, r.curl[k]) : undefined, xf: b[`wrist${k}`], bias: 0.03 }),
    );
    const bend = kneeBend(b, k);
    const shin = name(`shin${k}`, { mesh: kit.shin, xf: b[`knee${k}`], v: kneeBent(kit.shin.v, bend, true), bias: 0, convex: true });
    const foot = name(`foot${k}`, { mesh: kit.foot, xf: b[`ankle${k}`], bias: 0.02 });
    const boot = name(`boot${k}`, { mesh: kit.boot, xf: b[`knee${k}`], bias: 0.01, convex: true, after: shin, front: SHAFT, under: soleUp(b, k, facing) ? foot : undefined });
    parts.push(
      // Under the tunic's skirt, never over it: the top of the thigh is up inside the skirt, and a thigh swung toward the viewer had
      // its middle nearer than the skirt's and was drawn over it, its top a sliver of trouser up the skirt from the fork.
      name(`thigh${k}`, ((thigh) => ({ mesh: thigh, xf: joint(b[`hip${k}`], [0, 0, -THIGH * kit.fr.tall]), v: kneeBent(thigh.v, bend, false), bias: 0, convex: true, under: skirt }))(k ? kit.thigh : mirrored(kit.thigh))),
      shin,
      // The boot round the shin, over it unless its foot is turned well away from the viewer, when the shin is the nearer.
      boot,
      foot,
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

/** How far down from level a crease is lit as turned, whichever way it is (`Face.crease`), in degrees. */
const CREASE_DOWN = 30;
const creased = (n: V3): V3 => {
  const h = Math.hypot(n[0], n[1]) || 1, c = Math.cos(CREASE_DOWN * DEG) / h;
  return [n[0] * c, n[1] * c, -Math.sin(CREASE_DOWN * DEG)];
};
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
    const tests = (part.hide ?? []).map((solid) => behind(solid.in ?? part.hideIn ?? part.xf, solid, T));
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
      k.push(part.toon ? toonK(u, L) : face.crease ? lightOn(creased(u), L) : lightOn(u, L));
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
    ? settle(pose.id, pose, (f, left, kept) => rigOf({ ...pose, facing: f }, kit.fr, left, kept), now)
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

/**
 * A tiller, from its pivot on the rudder's head to its end in the fist, of
 * the boat's wood, drawn over the body wherever no part of the body is in
 * front of it. Drawn whole under the body or whole over it, by which side of
 * the chest its swung middle was, it went from behind the torso to across
 * the forearm and back half a dozen times in ten seconds as it swung; drawn
 * under, its end was behind the body with the fist holding nothing, and
 * drawn over, it lay across the forearm and the belly. It passes beside the
 * hip, under the forearm and into the fist, so neither was right. Now it is
 * cut in lengths, and a length is left out wherever a part of the body --
 * the hips, a thigh, the arm, the fist round its end -- is between it and
 * the viewer, each part taken as the egg that fills its own box. So it goes
 * behind the body and comes out of the fist from every side, and swinging
 * cannot make it jump. Its section is wider than it is deep, as a tiller is
 * cut, which on the screen is about as wide as it is tall.
 *
 * Each egg is a little fatter than the part, and the lengths are a fist long,
 * so where it went behind the hip it stopped short of it, its cut end square
 * in the air by the thigh. So it is drawn whole under the body first as well:
 * what of it is behind the body shows up to the body's own outline, and out
 * through any gap in it, and the lengths over the body are drawn after it.
 */
const TILLER_SECTION: [number, number] = [0.32, 0.62];
/** Lengths a tiller is cut in, for leaving out what is behind the body: about a fist's width each. */
const TILLER_LENGTHS = 14;
/** How much of the tiller's end is inside the fist round it, from the middle of the fist. */
const TILLER_IN_FIST = 0.7;
const tillerMeshes = new Map<number, Mesh>();
function tillerPart(t: { pivot: V3; end: V3; wood?: string }, parts: Part[], pal: Palette): Part {
  const d: V3 = [t.end[0] - t.pivot[0], t.end[1] - t.pivot[1], t.end[2] - t.pivot[2]];
  const L = Math.round(Math.hypot(d[0], d[1], d[2]) * 20) / 20;
  let m = tillerMeshes.get(L);
  if (!m) {
    m = rings(Array.from({ length: TILLER_LENGTHS + 1 }, (_, i) => [(i / TILLER_LENGTHS) * L, ...TILLER_SECTION]), 4, 'haft');
    tillerMeshes.set(L, m);
  }
  const hide: Array<{ c: V3; r: V3; in: Xf }> = [];
  for (const p of parts) {
    const v = p.v ?? p.mesh.v;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const [x, y, z] of v) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    hide.push({ c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], r: [(x1 - x0) / 2 + 0.05, (y1 - y0) / 2 + 0.05, (z1 - z0) / 2 + 0.05], in: p.xf });
  }
  // And the end of it, inside the fist: the fist's own egg is narrow across the grip, and the end showed in it as a square of wood.
  hide.push({ c: t.end, r: [TILLER_IN_FIST, TILLER_IN_FIST, TILLER_IN_FIST], in: ROOT });
  return { mesh: m, xf: aimed(ROOT, t.pivot, d, [0, 0, 1]), bias: 0, convex: true, pal: { ...pal, haft: t.wood ? hex(t.wood) : OAR_WOOD }, hide };
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
    // Each comes up as it opens out, so none is ever a small bright ring by the head. Treading water makes small soft rings,
    // fainter than a stroke's: as bright and as wide, two of them crossing over the neck were most of the picture.
    const fade = (moving ? 0.6 : 0.42) * Math.min(1, u / 0.3) * Math.pow(1 - u, 1.5) * (1 - back / RIPPLE_REACH);
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
      const R = (0.8 + 3.7 * open) * (0.75 + 0.5 * h(5));
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
/**
 * And for the shoulders and the top of the chest, more: side on, the round top of the near shoulder came up whole under
 * the jaw, a ball of shirt in the foam round the neck, before the rest of it was let up.
 */
const SHOULDER_SLIVER = 0.55;
function waterline(parts: Part[], up: boolean, shoulders?: Set<Xf>, pal?: Palette): Part[] {
  const made = new Map<Part, Part>();
  for (const part of parts) {
    const pv = (part.v ?? part.mesh.v).map((p) => place(part.xf, p));
    let n = 0, top = -Infinity;
    for (let i = 0; i < pv.length; i++) {
      if (pv[i][2] >= 0) n++;
      top = Math.max(top, pv[i][2]);
    }
    if (n === (up ? pv.length : 0)) { made.set(part, part); continue; }
    if (n === (up ? 0 : pv.length)) continue;
    /*
     * A part that comes up out of the water by a sliver -- the collar of a shirt round the neck, the top of a shoulder at the top
     * of a bob -- is a crescent of another colour inside the foam: under the lip of the water there, rather. That was a cut: the
     * part left out until it was `SLIVER` out and then drawn the whole of that at once, so the shoulders and upper arms came up
     * out of the water at full width in one frame. Now what shows of it is cut off at a level raised over the water that comes
     * down to it as the part comes up, from `SLIVER` to twice that, so what shows grows from nothing to the whole of it.
     */
    const sliver = shoulders?.has(part.xf) ? SHOULDER_SLIVER : SLIVER;
    if (up && top <= sliver) continue;
    const level = up && top < 2 * sliver ? 2 * sliver - top : 0;
    const above = (i: number): boolean => pv[i][2] >= level;
    const v = pv.slice();
    const cuts = new Map<number, number>();
    const cutOf = (a: number, b: number): number => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let i = cuts.get(key);
      if (i === undefined) {
        const [p, q] = a < b ? [pv[a], pv[b]] : [pv[b], pv[a]];
        const t = (p[2] - level) / (p[2] - q[2]);
        i = v.length;
        v.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, level]);
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
    if (!faces.length || (level > 0 && shownArea(v, faces) < SPECK)) continue;
    /*
     * And what shows is let down onto the water by as much as was cut off under it, so it comes up out of the water rather
     * than standing over it: cut off at the raised level and left there, the top of a shoulder side on was a dome sat on the
     * foam with a gap of water under it, a ball held under the jaw.
     */
    if (level > 0) for (let i = 0; i < v.length; i++) v[i] = [v[i][0], v[i][1], v[i][2] - level];
    made.set(part, {
      ...part, mesh: mesh(v, faces), v: undefined, xf: ROOT, pal: level > 0 && pal ? wetted(part.pal ?? pal, level / sliver) : part.pal, hideIn: part.hideIn ?? part.xf,
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

/**
 * Under this much area (square units) of a part only just up, nothing of it is drawn: the first of a plate up by the
 * jaw, a thousandth of a square unit and then a fifth of one, was all ink, a dark speck out on the open water beside the
 * helmet. Half a unit across is a pixel at the island's zoom, so nothing is lost but specks.
 */
const SPECK = 0.3;
function shownArea(v: V3[], faces: Face[]): number {
  let area = 0;
  for (const f of faces) {
    const o = v[f.i[0]];
    for (let q = 1; q + 1 < f.i.length; q++) {
      const a = v[f.i[q]], b = v[f.i[q + 1]];
      const u: V3 = [a[0] - o[0], a[1] - o[1], a[2] - o[2]], w: V3 = [b[0] - o[0], b[1] - o[1], b[2] - o[2]];
      area += 0.5 * Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
    }
  }
  return area;
}

/**
 * A palette with the water over it, `wet` of the way through coming up out of it (one just breaking the surface, nought
 * clear of it): what is only just up is still running with water, in the water's colour more than its own, and comes to
 * its own as it rises. The top of a red shirt just up out of the water was the reddest thing in the picture, a ball of
 * it side on. Kept for each palette in a few steps, so a swimmer does not make one a frame.
 */
const WET_MOST = 0.5;
const WET_STEPS = 8;
const wets = new WeakMap<Palette, Palette[]>();
function wetted(P: Palette, wet: number): Palette {
  const k = Math.max(0, Math.min(WET_STEPS, Math.round(wet * WET_STEPS)));
  if (!k) return P;
  let list = wets.get(P);
  if (!list) { list = []; wets.set(P, list); }
  const water = mixRGB(UNDERWATER, [255, 255, 255], 0.12);
  return (list[k] ??= Object.fromEntries(Object.entries(P).map(([m, c]) => [m, mixRGB(c, water, (WET_MOST * k) / WET_STEPS)])) as Palette);
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
interface Wake { at: V3; r: number; along: V3; long: number; behind?: boolean }
/** How far the top of a shoulder stands over its joint. */
const SHOULDER_TOP = 0.6;
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
  /*
   * The tops of the shoulders, up through the water while the root of the neck is still under it -- treading water, at the
   * top of a kick -- are in a ring of their own across them, which opens out from nothing as they come up: with only the
   * neck's, the shirt that came up showed as a red crescent inside a ring the width of the neck.
   */
  const s0 = b.arm0.t, s1 = b.arm1.t;
  const up = (s0[2] + s1[2]) / 2 + SHOULDER_TOP;
  if (b.neck.t[2] < 0 && up > 0) {
    const g = Math.min(1, up / (2 * SHOULDER_TOP));
    const d: V3 = [s1[0] - s0[0], s1[1] - s0[1], 0], l = Math.hypot(d[0], d[1]) || 1;
    out.push({ at: [(s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2, 0], r: 0.4 + 0.6 * g, along: [d[0] / l, d[1] / l, 0], long: 0.4 + (l / 2 + 0.3) * g });
  }
  for (let k = 0; k < 2; k++) {
    through(b[`arm${k}`].t, b[`elbow${k}`].t, 0.72);
    through(b[`elbow${k}`].t, b[`wrist${k}`].t, 0.6);
    through(b[`wrist${k}`].t, place(b[`wrist${k}`], [0, 0, 2 * GRIP]), 0.5);
    through(b[`hip${k}`].t, b[`knee${k}`].t, 0.95);
    through(b[`knee${k}`].t, b[`ankle${k}`].t, 0.75);
  }
  return out;
}

/**
 * A ring round each shoulder that is breaking the surface while the joint
 * under it is still under, from what is on the shoulder -- the top of the
 * arm, a sleeve's head, a pauldron -- and as big as what of it is up at the
 * surface, opening from nothing as it comes up. A pauldron going under at
 * the end of a breath was two flat caps of plate apart from the helmet with
 * no ring round them, as if floating; and side on, the top of a shoulder
 * treading water was a ball under the jaw inside the ring round the neck.
 */
const SHOULDER_DEEP = 0.3;
/** How far down from its top the round of a shoulder's cap goes, which is what a ring goes round. */
const SHOULDER_CAP = 0.9;
/**
 * Whether a part is on shoulder joint `arm`: on its frame, or on a frame of its own from the same point -- a pauldron is
 * carried whole on one (`heldOnShoulder`), and so came up out of the water with nothing round it, at the sliver of
 * anything else and not of a shoulder, a plate pebble on the open water beside the helmet.
 */
const onJoint = (p: Part, arm: Xf): boolean => p.xf === arm || (p.xf.t[0] === arm.t[0] && p.xf.t[1] === arm.t[1] && p.xf.t[2] === arm.t[2]);
function shouldersOut(parts: Part[], b: Bones, through: Wake[], T: V3): Wake[] {
  const out: Wake[] = [];
  const s0 = b.arm0.t, s1 = b.arm1.t, l = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) || 1;
  const al: V3 = [(s1[0] - s0[0]) / l, (s1[1] - s0[1]) / l, 0];
  for (let k = 0; k < 2; k++) {
    const arm = b[`arm${k}`];
    // Up through the water itself, the arm has its own ring where it goes through (`wakeOf`).
    if (arm.t[2] >= 0) continue;
    let top = -Infinity;
    const on: V3[] = [];
    for (const p of parts) {
      if (!onJoint(p, arm)) continue;
      for (const v of p.v ?? p.mesh.v) {
        const q = place(p.xf, v);
        if (q[2] > top) top = q[2];
        if (q[2] > -SHOULDER_DEEP) on.push(q);
      }
    }
    if (top <= SHOULDER_SLIVER) continue;
    // Round what is up at the surface of the cap: not the length of an arm lying out along it under the water, treading.
    let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    const from = Math.max(-SHOULDER_DEEP, Math.min(0, top - SHOULDER_CAP));
    for (const q of on) {
      if (q[2] < from) continue;
      const u = q[0] * al[0] + q[1] * al[1], w = q[1] * al[0] - q[0] * al[1];
      a0 = Math.min(a0, u); a1 = Math.max(a1, u);
      c0 = Math.min(c0, w); c1 = Math.max(c1, w);
    }
    if (a0 > a1) continue;
    // Opening from nothing as what is on the shoulder starts to show (`waterline`), and to its whole size as all of it does.
    const g = Math.min(1, (top - SHOULDER_SLIVER) / SHOULDER_SLIVER), u = (a0 + a1) / 2, w = (c0 + c1) / 2;
    const ring: Wake = { at: [u * al[0] - w * al[1], u * al[1] + w * al[0], 0], along: al, long: g * (0.15 + (a1 - a0) / 2), r: g * (0.15 + (c1 - c0) / 2) };
    // Not where the ring round the chest coming up through the water, treading, already goes round it: there it was a lug on that ring.
    const inside = through.some((o) => {
      const d: V3 = [ring.at[0] - o.at[0], ring.at[1] - o.at[1], 0];
      const x = (d[0] * o.along[0] + d[1] * o.along[1]) / (o.long + ring.long), y = (d[1] * o.along[0] - d[0] * o.along[1]) / (o.r + ring.long);
      return x * x + y * y < 1;
    });
    // Behind the root of the neck from where it is seen, it is behind whatever of the body is up out of the water.
    ring.behind = (ring.at[0] - b.neck.t[0]) * T[0] + (ring.at[1] - b.neck.t[1]) * T[1] < 0;
    if (!inside) out.push(ring);
  }
  return out;
}

/**
 * A ring round whatever on the trunk, the neck or the head is cut by the water wider than the bones' own rings
 * (`wakeOf`) go: a chain coif's cape over the shoulders came up out of the water wider than the ring round the neck, and
 * read as a helmet floating on rings. Round the cut as it is drawn -- what of a part only just up is cut higher and let
 * down (`waterline`), so its cut is at the water and grows from nothing as the part comes up -- and as an oval to the
 * box of it, across the body and along it; where it is inside a bone's ring it is left out with the rest (`foam`).
 */
function collarOut(above: Part[], b: Bones): Wake[] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of above) {
    if (p.xf !== ROOT || (p.hideIn !== b.chest && p.hideIn !== b.neck && p.hideIn !== b.head)) continue;
    for (const v of p.mesh.v) {
      if (Math.abs(v[2]) > 1e-6) continue;
      x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]);
      y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]);
    }
  }
  if (x0 > x1) return [];
  return [{ at: [(x0 + x1) / 2, (y0 + y1) / 2, 0], along: [1, 0, 0], long: (x1 - x0) / 2 + 0.1, r: (y1 - y0) / 2 + 0.1 }];
}

/** The ring round one place the body goes through the water, `out` beyond it, as far round as `on` says: drawn as a path. */
function wakeRing(g: CanvasRenderingContext2D, view: View, w: Wake, out: number, on: (o: V3) => boolean): void {
  const across: V3 = [-w.along[1], w.along[0], 0];
  const a = w.long + out, c = w.r + out;
  const N = 16;
  const at = (th: number): V3 => [w.along[0] * a * Math.cos(th) + across[0] * c * Math.sin(th), w.along[1] * a * Math.cos(th) + across[1] * c * Math.sin(th), 0];
  const to = (o: V3, move: boolean): void => {
    const s = onScreen(view, [w.at[0] + o[0], w.at[1] + o[1], 0]);
    if (move) g.moveTo(s[0], s[1]);
    else g.lineTo(s[0], s[1]);
  };
  /*
   * Where it stops or starts -- the near half meeting the far, or the edge going into another ring -- it stops or starts
   * there, found between the two points either side of it: from one point to the next, the near and the far halves each
   * left out the step between them, and a big ring was drawn with a gap at either side, and one wherever another met it.
   */
  const edge = (t0: number, t1: number, inAt0: boolean): V3 => {
    for (let q = 0; q < 5; q++) {
      const m = (t0 + t1) / 2;
      if (on(at(m)) === inAt0) t0 = m;
      else t1 = m;
    }
    return at(inAt0 ? t0 : t1);
  };
  let pen = false;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * TAU;
    const o = at(th);
    const was = (i - 1) / N * TAU;
    if (!on(o)) {
      if (pen) to(edge(was, th, true), false);
      pen = false;
      continue;
    }
    if (!pen && i > 0) to(edge(was, th, false), true);
    to(o, !pen && i === 0);
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
      // One behind the body is all drawn under it: its near half drawn over it was a white crescent across the throat.
      if (w.behind ? near : (o[0] * T[0] + o[1] * T[1] >= 0) !== near) return false;
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
    const above = waterline(parts, true, new Set([b.chest, ...parts.filter((p) => onJoint(p, b.arm0) || onJoint(p, b.arm1)).map((p) => p.xf)]), pal);
    const through = wakeOf(b, kit.fr), rings = [...through, ...shouldersOut(parts, b, through, view.T), ...collarOut(above, b)];
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
    render(ctx, above, pal, view, ink, 1 / zoom, now);
    foam(ctx, view, rings, true);
  } else {
    // A far oar goes under the body, a near one over it.
    const T = view.T;
    const near = (o: { lock: V3 }): boolean => o.lock[0] * T[0] + o.lock[1] * T[1] > 0;
    for (const o of r.oars ?? []) if (!near(o)) oar(ctx, view, ink, o);
    if (r.reins) reins(ctx, b, view, r, 1 / zoom, true);
    // The tiller whole under the body, and what of it is in front of the body over it (`tillerPart`).
    if (r.tiller) render(ctx, [tillerPart(r.tiller, [], pal)], pal, view, ink, 1 / zoom, now);
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
    // The tiller over the body, but for what of it the body is in front of (`tillerPart`); over the rim, as it is.
    if (r.tiller) render(ctx, [tillerPart(r.tiller, parts, pal)], pal, view, ink, 1 / zoom, now);
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
  /** Where it was last put down: on what, and where in that one's own units. */
  put?: { ctx: CanvasRenderingContext2D; x: number; y: number; w: number; h: number };
}

const stills = new Map<string, Still>();

/**
 * The picture of a body as it was last put down, and where, while it is kept
 * as one (see `drawStill`): what a boat's sail in front of my own helmsman is
 * let fade over, so he shows through it (`seeThrough` in `./furniture`).
 */
export function figurePicture(id: string): { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null {
  const st = stills.get(id);
  return st?.put ? { ...st.put, canvas: st.canvas } : null;
}

function drawStill(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: FigurePose, kit: Kit, r: Rig, facing: number, changing: boolean, ink: number, now: number): void {
  const id = pose.id as string;
  const t = ctx.getTransform();
  /*
   * Device pixels to a unit of the context it goes on, from the area the transform scales by and in sixteenths: under a
   * boat's or a cart's sway the transform is a shear and a turn that changes every frame, and its first column's length
   * went with it (by two per cent either way at sea), so the key never matched, and everybody aboard was drawn afresh and
   * the picture resized every frame. Kept at what it was while it is within a twentieth of that, for the root of the area
   * still goes by a per cent and a half either way at sea, which crossed from one sixteenth to the next at some sizes. That
   * much off, the picture is drawn that much larger or smaller, which nobody sees.
   */
  const seen = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1, was = stills.get(id)?.dev;
  const dev = was !== undefined && Math.abs(seen - was) < 0.05 * was ? was : Math.max(1, Math.round(seen * 16)) / 16;
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
  const px = close ? Math.round(x * st.dev) / st.dev : x, py = close ? Math.round(y * st.dev) / st.dev : y;
  ctx.drawImage(st.canvas, px, py, st.canvas.width / st.dev, st.canvas.height / st.dev);
  st.put = { ctx, x: px, y: py, w: st.canvas.width / st.dev, h: st.canvas.height / st.dev };
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
  // Which of the strides in `WALK_VARY` it is on, as the walk counts them (`rigOf`).
  const N = WALK_VARY.length, n = (((Math.floor(pose.phase / TAU) % N) + N) % N), v = (n + strideSeed(pose.id)) % N;
  const key = `${still}|${gait}|${v}|${i}`;
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
    const at: FigurePose = { ...pose, phase: (n + (i + 0.5) / WALK_FRAMES) * TAU, gait };
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
