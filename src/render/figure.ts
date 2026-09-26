import { emotePose } from '../game/emotes';
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
type Pt = [number, number];

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
const ROOT: Xf = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
/** A joint `at` in its parent's frame, turned by pitch, then roll, then yaw, in degrees. */
function joint(p: Xf, at: V3, pitch = 0, roll = 0, yaw = 0): Xf {
  const r = mm(rz(yaw * DEG), mm(ry(roll * DEG), rx(pitch * DEG)));
  const o = mv(p.m, at);
  return { m: mm(p.m, r), t: [o[0] + p.t[0], o[1] + p.t[1], o[2] + p.t[2]] };
}
const place = (x: Xf, v: V3): V3 => { const o = mv(x.m, v); return [o[0] + x.t[0], o[1] + x.t[1], o[2] + x.t[2]]; };
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
export type GearMat = 'metal' | 'metalDark' | 'metalLit' | 'mail' | 'scale' | 'scaleDark' | 'leather' | 'leatherDark' | 'lace'
  | 'cloth' | 'clothDark' | 'lining' | 'wood' | 'woodDark' | 'grip' | 'blade' | 'fitting' | 'gem' | 'string' | 'fletch' | 'rivet';
export type Mat = BodyMat | GearMat;
/**
 * Worked into a facet's surface, in its own shade, where it is drawn big
 * enough to read: the rows of a mail shirt, the courses of scale, the channels
 * of a quilted coat, the lames of plate, the grain of a board.
 */
export type Pattern = 'mail' | 'scale' | 'quilt' | 'lames' | 'grain';

export interface Face {
  /** Corners, anticlockwise seen from outside. */
  i: number[];
  m: Mat;
  /** Painted on the face under it rather than a surface of its own: no outline, and drawn after the rest of its part. */
  decal?: boolean;
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

function mesh(v: V3[], f: Face[]): Mesh {
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
function ball(c: V3, r: V3, n: number, k: number, mat: Mat): Mesh {
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
function decals(quads: Array<{ q: V3[]; m: Mat; unless?: V3 }>): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  for (const { q, m, unless } of quads) {
    const base = v.length;
    v.push(...q);
    f.push({ i: q.map((_, k) => base + k), m, decal: true, unless });
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
  const brow: Pt[] = [[-0.33, 1.8], [0.08, 1.82], [0.1, 1.87], [-0.15, 1.91], [-0.34, 1.86]];
  const mouth = (w: number, z: number): V3[] => {
    const y = faceFront(fr, z) + 0.005;
    return [[-w, y, z + 0.03], [0, y + 0.02, z - 0.03], [w, y, z + 0.03], [w * 0.8, y, z + 0.055], [0, y + 0.02, z + 0.01], [-w * 0.8, y, z + 0.055]];
  };
  // The white of the eye showing round the dark of it, most at the outer corner.
  const [eu, ez] = [eye.reduce((a, p) => a + p[0], 0) / eye.length, eye.reduce((a, p) => a + p[1], 0) / eye.length];
  const white: Pt[] = eye.map(([u, z]) => [eu + (u - eu) * 1.22 + 0.012, ez + (z - ez) * 1.15]);
  const marks = [
    ...[-1, 1].flatMap((s) => [
      ...(blink ? [] : faceMarks(fr, s, white, 'white')),
      ...faceMarks(fr, s, eye, 'eye'),
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
  /** Left and right, each with its thumb on the inside: fists, and open. */
  hands: [Mesh, Mesh];
  open: [Mesh, Mesh];
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

function grownHair(h: HairKit): HairKit {
  return {
    cap: h.cap && grown(h.cap),
    top: h.top && grown(h.top),
    fall: h.fall && grown(h.fall),
    tails: h.tails.map((t) => ({ ...t, at: bigger(t.at), mesh: grown(t.mesh) })),
  };
}

function kitOf(look: Look, lod: number): Kit {
  const fr = frameOf(look, lod);
  const beard = beardOf(fr, look.beard);
  const sw = (fr.sh + fr.wa) / 2;
  const bust = 1 + fr.fem * 0.13;
  const chest = rings([
    [-0.1, 1.58 * sw, 1.22, 0, 0], [0.9, 1.9 * fr.sh, 1.34 * bust, 0, 0.05], [1.7, 2.06 * fr.sh, 1.22, 0, -0.04], [2.24, 1.3 * fr.sh, 0.74, 0, -0.08],
  ], 8, 'tunic', { bottom: false });
  // The neck of the tunic: open in a V at the throat, from the neck down the upper facet of the chest.
  const top = 0.74 * Math.sin((3 * Math.PI) / 8) - 0.08, below = 1.22 * Math.sin((3 * Math.PI) / 8) - 0.04;
  const front = (z: number): number => top + ((2.24 - z) / 0.54) * (below - top) + 0.03;
  const vee: V3[] = [[-0.3, front(2.235), 2.235], [0.3, front(2.235), 2.235], [0, front(1.72), 1.72]];
  const collar = decals([{ q: newell(vee)[1] < 0 ? [...vee].reverse() : vee, m: 'skin' }]);
  return {
    fr,
    pelvis: rings([[-1, 1.36 * fr.hi, 1.12, 0, -0.05], [0.3, 1.55 * fr.hi, 1.2, 0, -0.05], [1.15, 1.45 * fr.wa, 1.14]], 8, 'trousers'),
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
    // The sleeve's end in shade, as the inside of a sleeve is: seen end on, with the arm raised toward the viewer, a lit end is a pale disc.
    upper: seamed(rings([[0.45, 0.46, 0.48], [0.05, 0.82 * (0.9 + fr.sh * 0.1), 0.8], [-1.5, 0.74, 0.72], [-3.05, 0.65, 0.63]], 6, (band) => (band === 3 ? 'trim' : 'tunic')), (p) => p[2] > 0 || p[2] < -3),
    lower: join(rings([[0.1, 0.57, 0.54], [-2.3, 0.44, 0.41]], 6, 'skin'), seamed(seamed(rings([[0.25, 0.7, 0.66], [-0.75, 0.66, 0.62]], 6, 'trim'), (p) => p[2] > 0.2), (p) => p[2] < -0.7)),
    hands: [-1, 1].map((s) => handSized(join(
      rings([[0.08, 0.42, 0.27], [-0.5, 0.52, 0.31], [-1.1, 0.38, 0.24]], 6, 'skin'),
      chain([[-s * 0.18, 0.12, -0.22], [-s * 0.26, 0.3, -0.52], [-s * 0.22, 0.36, -0.78]], [0.14, 0.12, 0.07], 4, 'skin'),
    ))) as [Mesh, Mesh],
    // Open: a flat palm, broad, four fingers spread in a fan -- the outer two nearly a third of a right angle out
    // from the line of the hand, far enough apart at the tips for a pixel or two of what is behind to show between
    // them at zoom four -- and the thumb out from them, the palm on the side a fist's is. Spread, and as much bigger
    // than the fist as a hand opened out is, so that one held up a few pixels across is a hand and not a mitten.
    open: [-1, 1].map((s) => handSized(grownBy(1.15, join(
      rings([[0.08, 0.23, 0.38], [-0.5, 0.22, 0.5], [-0.88, 0.17, 0.49]], 6, 'skin'),
      ...([[0.35, 0.52, 28], [0.12, 0.6, 9], [-0.12, 0.56, -9], [-0.35, 0.44, -28]] as Array<[number, number, number]>).map(([y, l, a]) =>
        fine(chain([[0, y, -0.84], [0, y + l * Math.sin(a * DEG), -0.84 - l * Math.cos(a * DEG)]], [0.12, 0.09], 4, 'skin'), 0.24 * 1.15 * HAND)),
      fine(chain([[-s * 0.06, 0.32, -0.18], [-s * 0.08, 0.62, -0.46], [-s * 0.08, 0.78, -0.74]], [0.13, 0.11, 0.08], 4, 'skin'), 0.26 * 1.15 * HAND),
    )))) as [Mesh, Mesh],
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
    thigh: rings([[-1.05, 1.02 * fr.hi, 1.05], [-3.45, 0.8, 0.84]], 6, 'trousers', { top: false }),
    shin: rings([[0.12, 0.8, 0.84], [-1.55, 0.68, 0.72]], 6, 'trousers', { bottom: false }),
    boot: rings([[-1.3, 0.84, 0.88], [-1.62, 0.8, 0.84], [-1.66, 0.72, 0.76], [-3.02, 0.66, 0.7], [-3.15, 0.61, 0.64]], 6, (band) => (band === 0 ? 'cuff' : 'boot'), { bottom: false }),
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

type Euler = [number, number, number];

/** A pose: every joint's turn, in degrees, and where the body is. */
interface Rig {
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
   * mid-stance, which is what says where the hips are then. Never lower
   * than a foot on the ground allows.
   */
  hover?: { h: number; w: number; thigh: number; knee: number };
  /** Each shoulder raised this far, for an arm lifted high. */
  shrug: [number, number];
  /** How firmly each foot is on the ground, for the body carried on a curve: its knee gives or straightens to keep it there. */
  plant?: [number, number];
  /** Each hand open rather than closed. */
  open: [boolean, boolean];
}

function rest(): Rig {
  return {
    at: [0, 0, 0], pelvis: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    arm: [[4, 8, 0], [4, 8, 0]], elbow: [10, 10], hand: [[0, 0, 0], [0, 0, 0]],
    leg: [[0, 2, 0], [0, 2, 0]], knee: [3, 3], foot: [0, 0], flat: [true, true],
    tail: [0, 0, 0], lift: 0, sink: 0, blink: false, reins: false, tool: false, lefty: false, shrug: [0, 0], open: [false, false],
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
  if (r.plant) r.plant = [r.plant[1], r.plant[0]];
  r.lefty = !r.lefty;
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
}

/**
 * Standing: breathing, the weight shifting from one leg to the other and
 * the free knee easing as it goes, the head turning to look about, and a
 * blink every few seconds. `t` is in seconds.
 */
function idle(r: Rig, t: number): void {
  const b = Math.sin((t * TAU) / 4.2);
  // Stood with the weight on one leg, the hip up on that side and the other knee eased, changing legs every eight seconds.
  const w = Math.tanh(3 * Math.sin((t * TAU) / 16));
  r.at = [0.35 * w, 0, 0];
  r.pelvis = [0, -5 * w, 0];
  r.spine = [0, 3.2 * w, 0];
  r.chest = [1.2 * b, 1.4 * w, 0];
  r.neck = [-0.6 * b, -0.8 * w, 0];
  r.head = [2 * Math.sin((t * TAU) / 6.3 + 1), -1.2 * w, 7 * Math.sin((t * TAU) / 11)];
  r.knee = [3 + 14 * Math.max(0, w), 3 + 14 * Math.max(0, -w)];
  r.leg = [[1 + 4 * Math.max(0, w), 2 + 2 * Math.max(0, w), 0], [1 + 4 * Math.max(0, -w), 2 + 2 * Math.max(0, -w), 0]];
  for (let k = 0; k < 2; k++) {
    r.arm[k] = [3 + 1.5 * b + (k ? -1.5 : 1.5) * w, 7 + b, 0];
    r.elbow[k] = 18 + 2 * b;
  }
  r.blink = ((t % 4.3) + 4.3) % 4.3 < 0.14;
  r.tail = [3 * Math.sin(t * 1.3), 2 * Math.sin(t * 0.9), 0];
  // And every thirteen seconds something else for two: a stretch with the shoulders rolled back, or a look at one hand.
  const round = Math.floor(t / 13), u = t - round * 13;
  const e = u < 1.9 ? Math.pow(Math.sin((u / 1.9) * Math.PI), 2) : 0;
  if (e > 0 && round % 2 === 0) {
    r.chest[0] += 5 * e;
    r.head[0] += 6 * e;
    for (let k = 0; k < 2; k++) {
      r.arm[k][0] -= 8 * e;
      r.arm[k][1] += 9 * e;
      r.elbow[k] += 6 * e;
    }
  } else if (e > 0) {
    r.arm[1] = [r.arm[1][0] + 28 * e, r.arm[1][1], r.arm[1][2] + 20 * e];
    r.elbow[1] += 70 * e;
    r.head = [r.head[0] - 14 * e, r.head[1], r.head[2] - 16 * e];
    r.neck[0] -= 4 * e;
  }
}

/**
 * Walking into running, `g` between them. The legs swing through the
 * stride with the knee folding under the body as it passes, heel down on
 * landing and toe down leaving; the hips turn with the leading leg and the
 * shoulders the other way, the arms swing against the legs, and at a run the
 * whole leans in, the knees come up behind, the elbows bend and there is a
 * moment with both feet off the ground.
 */
function walk(r: Rig, phi: number, g: number): void {
  const L = (a: number, b: number): number => a + (b - a) * g;
  const A = L(26, 40);
  const lean = L(4, 13);
  for (let k = 0; k < 2; k++) {
    const psi = phi + k * Math.PI;
    const s = Math.sin(psi);
    const swing = Math.max(0, Math.cos(psi - L(0, -0.55)));
    r.leg[k] = [A * s + L(0, 9), L(2, 3), 0];
    // Folded through the swing; and at a run bent under the body's weight through the stance, so the body is lowest there and highest in the air.
    r.knee[k] = L(5, 12) + L(46, 102) * Math.pow(swing, L(2, 1.3)) + L(4, 34) * Math.pow(Math.max(0, -Math.cos(psi)), 1.5);
    r.foot[k] = 14 * Math.pow(Math.max(0, s), 6) * (1 - g) - L(24, 34) * Math.pow(Math.max(0, -s), 5);
    // The arm against the leg: at a run bent hard coming forward, the hand up by the chest, and opening going back past the hip.
    r.arm[k] = [-L(20, 44) * s + L(3, 4), L(7, 10), L(0, 18)];
    r.elbow[k] = L(12, 68) + L(14, 52) * Math.max(0, -s) - L(0, 10) * Math.max(0, s);
  }
  // The hips turn with the leading leg and the shoulders the other way. The lean is along the way of going, not the way the hips are
  // turned -- which would tip the whole body to each side in turn -- so the spine takes the hips' turn back out before it leans.
  const hips = -L(8, 11) * Math.sin(phi);
  r.pelvis = [0, -L(3, 2) * Math.cos(phi), hips];
  r.spine = [-lean, 0, -hips];
  r.chest = [-L(0, 3), L(2, 1) * Math.cos(phi), L(13, 17) * Math.sin(phi) + hips];
  r.neck = [lean * 0.45, 0, -L(4, 5) * Math.sin(phi)];
  r.head = [lean * 0.3, 0, 0];
  r.at = [L(0.16, 0.06) * Math.cos(phi), 0, 0];
  // The body is carried on a curve rather than stood on whichever foot is lowest, which jolts. At a run: lowest at mid-stance with the knee giving under it, one smooth rise into the air between steps, and down again.
  // At a walk, a quarter of a tenth of a metre lower just after each heel comes down than just after mid-stance.
  const u = (((phi / Math.PI) % 1) + 1) % 1;
  const air = Math.abs(u - 0.5) < 0.3 ? 0.5 * (1 + Math.cos((Math.PI * (u - 0.5)) / 0.3)) : 0;
  // And at a run a seventh of a tenth of a metre lower at mid-stance than as the foot lands or leaves, sinking onto the knee, so the body does not glide level between strides.
  const stance = Math.min(u, 1 - u);
  const sink = stance < 0.2 ? 0.5 * (1 + Math.cos((Math.PI * stance) / 0.2)) : 0;
  const settle = 0.5 + 0.5 * Math.cos(TAU * (u - 0.6));
  r.hover = { h: L(-0.25 * settle, 0.62 * air - 0.14 * sink), w: 1, thigh: L(0, 9), knee: L(5, 12) + L(4, 34) };
  // The foot going back under the body is on the ground -- except in the air between strides at a run.
  r.plant = [0, 1].map((k) => (1 - air * g) * ramp(-Math.cos(phi + k * Math.PI), 0.02, 0.25)) as [number, number];
  r.tail = [L(8, 30) + 10 * Math.sin(phi * 2 + 1), 5 * Math.sin(phi), 0];
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

/**
 * At work with a mallet and chisel: the chisel held upright in the left
 * hand at the belt, and the mallet in the right swung up round behind the
 * head and brought down over it onto the top of the chisel. The body rises
 * and turns the right shoulder back as the mallet goes up, and turns and
 * bends into the blow, which jolts through both hands and the knees; the
 * head stays down over the work. Seen from where the right hand's swing
 * would come across the face, it is done the other way about, left-handed.
 */
function work(r: Rig, w: number, fr: Frame, facing: number): void {
  const s = (((w / TAU) % 1) + 1) % 1;
  const T = fr.tall;
  r.tool = true;
  // How high the mallet is, near enough: nought as it lands, one held up at the top.
  const up = s < 0.2 ? 0.12 * Math.sin((Math.PI * s) / 0.2) : s < 0.7 ? ease((s - 0.2) / 0.5) : s < 0.88 ? 1 : 1 - Math.pow((s - 0.88) / 0.12, 2);
  const jolt = s < 0.25 ? Math.pow(1 - s / 0.25, 2) : 0;
  r.leg = [[6, 7, -4], [-4, 8, 6]];
  r.knee = [12 + 5 * jolt, 9 + 4 * jolt];
  r.at = [0, 0, -0.1 * jolt];
  r.spine = [-9 + 4 * up - 2 * jolt, 0, 0];
  r.chest = [-4 + 3 * up, -2 * up, 7 - 14 * up];
  r.neck = [-9 + 2 * up, 0, -3 + 5 * up];
  r.head = [-10 + up, 0, -2 + 3 * up];
  // The chisel, stood on the work at the belt and jolted down by each blow.
  const chisel = hold(r, fr, 0, [-0.6 * T, 3.6 * T, (1.05 - 0.12 * jolt) * T], [-1, -0.3, -0.8], [0.1, 0.2, 1]);
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

/** How far a swimmer is in the water: to the chest. */
const SINK = 10.2;

/** Breaststroke, chest-deep: arms sweeping out and round, the body leant into the water and the head held up out of it. */
function swim(r: Rig, phi: number, moving: boolean): void {
  const q = phi * (moving ? 0.55 : 0.22);
  const s = Math.sin(q), c = Math.cos(q);
  r.flat = [false, false];
  r.sink = SINK;
  r.spine = [-24, 0, 0];
  r.chest = [-6, 0, 0];
  r.neck = [18, 0, 0];
  r.head = [14, 0, 0];
  for (let k = 0; k < 2; k++) {
    r.arm[k] = [78 + 22 * s, 24 + 34 * Math.max(0, c), 0];
    r.elbow[k] = 26 + 48 * Math.max(0, -s);
    r.leg[k] = [-14 + 16 * s, 12, 0];
    r.knee[k] = 40 + 40 * Math.max(0, c);
  }
  r.at = [0, 0, 0.18 * s];
  r.tail = [55, 0, 0];
}

/** Sat on the box with the reins in both hands, jolting when the wheels are turning. */
function drive(r: Rig, phi: number, moving: boolean): void {
  const jolt = moving ? 0.22 * Math.sin(phi * 2) : 0;
  r.leg = [[80, 7, 0], [80, 7, 0]];
  r.knee = [96, 96];
  r.spine = [-4 + jolt * 3, 0, 0];
  r.arm = [[50, 9, 10], [50, 9, 10]];
  r.elbow = [60, 60];
  r.at = [0, 0, jolt];
  r.reins = true;
  r.tail = [10 + 6 * Math.sin(phi * 2), 0, 0];
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

/** A wave with the right hand, raised to the side and swung from the shoulder; or a hop, knees tucked in the air. */
function emote(r: Rig, id: string, t: number, facing: number): void {
  const e = emotePose(id, t);
  if (id === 'wave') {
    /*
     * The upper arm up, and further forward than out to the side, turned so
     * the elbow bends across that diagonal: the forearm stands upright over it,
     * and the wave is the forearm swinging from the elbow. Forward as well as
     * out puts the hand clear of the head from every side -- beside it from
     * the front, ahead of the face side on -- and the shoulder comes up with
     * it and the body leans away a little.
     */
    //
    // With whichever hand is on the outline of the body from where it is
    // seen, as it would be staged for a camera: the right, unless that would
    // put the hand across the face (turned three-quarters to the right) or
    // behind the head (three-quarters away to the left, or side on to the
    // left, where the left arm is the near one). Side on, forward of the face
    // is across it, so the arm goes up through the side to stand straight up
    // behind the ear, turned over so the elbow bends forward, and the hand
    // waves over the crown.
    const up = Math.max(0, Math.min(1, t / 0.2, (1 - t) / 0.2));
    const f = ((Math.round(facing) % 8) + 8) % 8;
    const k = f === 1 || f === 5 || f === 6 ? 0 : 1, s = k ? 1 : -1;
    const [P, A, W] = f === 2 || f === 6 ? [175, -10, -180] : [123, 0, -33];
    const [p, a, w] = r.arm[k];
    r.arm[k] = [p + (P - p) * up, a + (A - a) * up, w + (W - w) * up];
    r.elbow[k] = r.elbow[k] + (35 - r.elbow[k]) * up + 25 * e.wave;
    // The hand open, its palm turned forward to whoever is being waved at.
    r.open[k] = up > 0.3;
    r.hand[k] = [0, 0, palmTo(r, k, [0, 1, 0.3]) * up];
    r.shrug = k ? [r.shrug[0], r.shrug[1] + 0.4 * up] : [r.shrug[0] + 0.4 * up, r.shrug[1]];
    r.chest = [r.chest[0], r.chest[1] - 6 * up * s, r.chest[2]];
    r.head = [r.head[0] + 4 * up, r.head[1] - 3 * up * s, r.head[2] - 6 * up * s];
  } else if (id === 'hop') {
    /*
     * Two hops. Before each a crouch, knees bent and arms swung back, and
     * after each the same crouch taking the landing; in the air the knees
     * tuck and the arms go up and out.
     */
    const k = e.lift / 7;
    const env = Math.max(0, Math.min(1, t / 0.06, (1 - t) / 0.1));
    const crouch = env * Math.max(0, 1 - 3 * Math.abs(Math.sin(t * Math.PI * 2)));
    r.lift += e.lift / HEIGHT_SCALE;
    r.leg = [[26 * k + 32 * crouch, 3, 0], [26 * k + 32 * crouch, 3, 0]];
    r.knee = [3 + 48 * k + 58 * crouch, 3 + 48 * k + 58 * crouch];
    r.spine = [r.spine[0] - 10 * crouch, r.spine[1], r.spine[2]];
    r.arm = [[8 + 14 * k - 30 * crouch, 8 + 26 * k, 0], [8 + 14 * k - 30 * crouch, 8 + 26 * k, 0]];
    r.elbow = [14 + 20 * k, 14 + 20 * k];
    r.foot = [-18 * k, -18 * k];
  }
}

function rigOf(p: FigurePose, fr: Frame): Rig {
  const r = rest();
  if (p.swimming) swim(r, p.phase, p.moving);
  else if (p.driving) drive(r, p.phase, p.moving);
  else if (p.moving) walk(r, p.phase, Math.max(0, Math.min(1, p.gait ?? 0)));
  else if (p.working) work(r, p.phase, fr, p.facing);
  else idle(r, p.phase / 6);
  if (p.emote && !p.swimming && !p.driving) emote(r, p.emote, p.emoteT ?? 0, p.facing);
  return r;
}

/* ---- one pose into the next -------------------------------------------------- */

/** What a body is doing, as far as blending goes: a change of it is blended. */
const doing = (p: FigurePose): string => (p.swimming ? 'swim' : p.driving ? 'drive' : p.moving ? 'walk' : p.working ? (lefty(p.facing) ? 'work left' : 'work') : 'idle');

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
    hover: b.hover && { ...b.hover, w: b.hover.w * w }, shrug: [n(a.shrug[0], b.shrug[0]), n(a.shrug[1], b.shrug[1])], open: b.open,
    plant: b.plant && [b.plant[0] * w, b.plant[1] * w],
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
}

const held = new Map<string, Held>();
const ease = (x: number): number => x * x * (3 - 2 * x);

/** The pose and facing to draw a known body in now, blended from how it was last drawn. */
function settle(id: string, p: FigurePose, target: Rig, now: number): { rig: Rig; facing: number; changing: boolean } {
  const goal = ((Math.round(p.facing) % 8) + 8) % 8;
  let h = held.get(id);
  // A body not drawn for a while -- off screen, or just arrived -- starts where it is.
  if (!h || now - h.seen > 0.5) {
    h = { doing: doing(p), rig: target, from: target, since: -1, facing: goal, goal, turnFrom: goal, turnSince: -1, seen: now };
    held.set(id, h);
    if (held.size > 256) for (const [k, v] of held) if (now - v.seen > 5) held.delete(k);
  }
  h.seen = now;
  if (doing(p) !== h.doing) {
    h.doing = doing(p);
    h.from = h.rig;
    h.since = now;
  }
  const w = ease(Math.min(1, Math.max(0, (now - h.since) / BLEND)));
  h.rig = w < 1 ? mixRig(h.from, target, w) : target;
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
  return { rig: h.rig, facing: h.facing, changing: w < 1 || k < 1 };
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
  let dz = -low * (1 - wet) - r.sink * (wet > 0 ? 1 : 0) + r.lift;
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
 * A foot put down on the ground, `weight` of the way, by bending or
 * straightening its knee: the rest of the leg as it was, the body `dz` above
 * where the bones were built, and the foot kept level if it was being kept so.
 * Or, `clear`, only lifted out of the ground if it is in it.
 */
function plantFoot(b: Bones, r: Rig, fr: Frame, k: number, dz: number, weight: number, clear = false): void {
  const T = fr.tall, S = SHIN * T;
  const lp = r.leg[k][0];
  let kap = r.knee[k] * DEG;
  for (let q = 0; q < 3; q++) {
    let low = Infinity;
    for (const p of SOLE) low = Math.min(low, place(b[`ankle${k}`], p)[2]);
    // How far the sole is off the ground, to take out.
    const off = clear ? Math.min(0, low + dz) : (low + dz) * weight;
    if (Math.abs(off) < 1e-3) return;
    // The ankle's height below the knee is S times (h1 sin + h2 cos) of the knee's bend, h the hip frame's reach upward; solved for the bend that moves it by `off`.
    const m = b[`hip${k}`].m;
    const h1 = m[7], h2 = m[8];
    const rho = Math.hypot(h1, h2) || 1, alpha = Math.atan2(h1, h2);
    const c = Math.max(-1, Math.min(1, (rho * Math.cos(kap - alpha) + off / S) / rho));
    const d = Math.acos(c);
    kap = alpha + (kap - alpha >= 0 ? d : -d);
    const deg = kap / DEG;
    b[`knee${k}`] = joint(b[`hip${k}`], [0, 0, -THIGH * T], -deg);
    const level = r.flat[k] ? -(r.pelvis[0] + lp - deg) : 0;
    b[`ankle${k}`] = joint(b[`knee${k}`], [0, 0, -SHIN * T], level + r.foot[k]);
  }
}

/**
 * The tunic's skirt, pushed by the legs under it: the hem goes forward over
 * a thigh coming up and back over one going behind, so a stride does not
 * put a knee through the cloth.
 */
function skirtBent(kit: Kit, r: Rig): V3[] {
  const v = kit.skirt.v.map((p) => [...p] as V3);
  // The hem goes all the way with the thigh, the cloth over the hips some of the way, and the waist not at all.
  for (const p of v) {
    const share = p[2] < -0.9 ? 1 : p[2] < 0.5 ? 0.4 : 0;
    if (share) {
      for (let k = 0; k < 2; k++) {
        const s = k ? 1 : -1;
        const d = 1.35 * Math.sin(r.leg[k][0] * DEG) * share;
        const w = Math.max(0, Math.min(1, 1 - Math.abs(p[0] - s * 0.95 * kit.fr.hi) / 1.5));
        if (d > 0 && p[1] > -0.4) { p[1] += d * w; p[2] += d * 0.3 * w; }
        if (d < 0 && p[1] < 0.4) { p[1] += d * w * 0.8; p[2] -= d * 0.2 * w; }
      }
    }
  }
  return v;
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
  scale: [104, 138, 124], scaleDark: [66, 92, 86], leather: [138, 98, 66], leatherDark: [96, 66, 46], lace: [210, 190, 152],
  cloth: [194, 178, 142], clothDark: [156, 140, 108], lining: [210, 196, 164], wood: [178, 134, 88], woodDark: [124, 90, 58],
  grip: [100, 68, 46], blade: [220, 224, 228], fitting: [200, 168, 96], gem: [124, 184, 204], string: [228, 216, 192],
  fletch: [228, 220, 202], rivet: [200, 202, 208],
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
  };
}

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
  /** How rare the piece it belongs to is, 1 to 3, for the shine laid over it (`drawGearShine`); and where in its cycle. */
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
   * Never drawn after this other part: a neck goes under the head it holds
   * up, from in front where the chin comes over it and from behind where the
   * hair does, however far forward the head is bowed.
   */
  under?: Part;
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
}

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
  iron: [150, 151, 158], steel: [170, 178, 192], copper: [200, 132, 96], bronze: [190, 148, 92], brass: [210, 182, 110],
  tin: [200, 202, 200], zinc: [178, 188, 194], lead: [128, 132, 146], silver: [216, 220, 226], gold: [230, 190, 98],
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
};
/** Dragon scale, off one kind of beast and one colour: a jade gone grey at the edges. */
const DRAGON: RGB = [98, 146, 128];
/** What a metal's shadow and its light lean toward. */
const COOL_SHADOW: RGB = [58, 64, 84];
const WARM_LIGHT: RGB = [255, 250, 238];
/** The metals that are fittings in their own right, gilt rather than iron. */
const YELLOW_METAL = new Set(['gold', 'brass', 'bronze', 'electrum', 'seryll']);

/**
 * A piece's own colours: the body's, with its metal, its wood, its stone and
 * its dye laid in. Made once for each piece in each material and dye on each
 * body's colours.
 */
const gearPals = new Map<string, Palette>();
function gearPalette(base: Palette, p: GearPiece): Palette {
  const key = `${p.material ?? ''}|${p.dye ?? ''}|${base.tunic.join()}|${base.trousers.join()}|${base.skin.join()}`;
  let pal = gearPals.get(key);
  if (pal) return pal;
  const mat = (p.material ?? '').toLowerCase();
  const metal = METAL_TONE[mat] ?? METAL_TONE.iron;
  const wood = WOOD_GEAR[mat] ?? WOOD_GEAR.oak;
  const dye = p.dye && /^#[0-9a-f]{6}$/i.test(p.dye) ? hex(p.dye) : undefined;
  const cloth = dye ?? GEAR_BASE.cloth;
  const leather = dye ? mixRGB(GEAR_BASE.leather, dye, 0.45) : GEAR_BASE.leather;
  pal = {
    ...base,
    metal,
    metalDark: mixRGB(metal, COOL_SHADOW, 0.42),
    metalLit: mixRGB(metal, WARM_LIGHT, 0.36),
    mail: mixRGB(metal, COOL_SHADOW, 0.16),
    rivet: mixRGB(metal, WARM_LIGHT, 0.62),
    blade: mixRGB(metal, WARM_LIGHT, 0.38),
    fitting: YELLOW_METAL.has(mat) ? mixRGB(metal, WARM_LIGHT, 0.2) : GEAR_BASE.fitting,
    scale: DRAGON,
    scaleDark: mixRGB(DRAGON, COOL_SHADOW, 0.45),
    cloth,
    clothDark: mixRGB(cloth, COOL_SHADOW, 0.24),
    lining: mixRGB(cloth, WARM_LIGHT, 0.25),
    leather,
    leatherDark: mixRGB(leather, COOL_SHADOW, 0.34),
    wood,
    woodDark: mixRGB(wood, COOL_SHADOW, 0.32),
    gem: GEM_TONE[mat] ?? GEAR_BASE.gem,
    grip: GEAR_BASE.grip, lace: GEAR_BASE.lace, string: GEAR_BASE.string, fletch: GEAR_BASE.fletch,
  };
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
  /** How far out it is worn, where not as far as the rest of its piece. */
  layer?: number;
  /** Over what it covers only while this side of it is toward the viewer: see `Part.front`. */
  front?: V3;
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
function arcs(rs: number[][], n: number, from: number, to: number, m: Mat): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  rs.forEach(([z, rxx, ryy, cx = 0, cy = 0]) => {
    for (let j = 0; j <= n; j++) {
      const a = (from + ((to - from) * j) / n) * DEG;
      v.push([cx + Math.cos(a) * rxx, cy + Math.sin(a) * ryy, z]);
    }
  });
  for (let k = 0; k < rs.length - 1; k++) {
    for (let j = 0; j < n; j++) f.push({ i: [k * (n + 1) + j, k * (n + 1) + j + 1, (k + 1) * (n + 1) + j + 1, (k + 1) * (n + 1) + j], m });
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

interface Build { fr: Frame; sw: number; bust: number; arm: number }
const buildOf = (fr: Frame): Build => ({ fr, sw: (fr.sh + fr.wa) / 2, bust: 1 + fr.fem * 0.13, arm: 0.9 + fr.sh * 0.1 });

/** The chest, `g` times the body's own round: the shell of whatever is worn over it. */
const chestShell = (b: Build, g: number, m: Mat | ((band: number, j: number) => Mat), top = 2.24): Mesh => rings([
  [-0.15, 1.58 * b.sw * g, 1.22 * g, 0, 0], [0.9, 1.9 * b.fr.sh * g, 1.34 * b.bust * g, 0, 0.05],
  [1.7, 2.06 * b.fr.sh * g, 1.22 * g, 0, -0.04], [top, 1.3 * b.fr.sh * g, 0.74 * g, 0, -0.08],
], 8, m, { bottom: false });
/** The waist, on the spine. */
const waistShell = (b: Build, g: number, m: Mat): Mesh =>
  rings([[-0.4, 1.45 * b.fr.wa * g, 1.16 * g], [1.98, 1.6 * b.sw * g, 1.22 * g]], 8, m, { top: false, bottom: false });
/** What hangs from the hips to `hem`, flaring as it goes: a skirt of mail, of plate, of quilting. */
const skirtShell = (b: Build, g: number, hem: number, m: Mat | ((band: number, j: number) => Mat)): Mesh => {
  const flare = Math.max(0, -1.35 - hem) * 0.07;
  return rings([
    [hem, (1.92 + flare) * b.fr.hi * g, (1.55 + flare) * g], [Math.min(-1.08, hem + 0.5), 1.9 * b.fr.hi * g, 1.53 * g],
    [0.2, 1.74 * b.fr.hi * g, 1.36 * g], [1.25, 1.53 * b.fr.wa * g, 1.22 * g],
  ], 8, m, { top: false, bottom: false });
};
/** A belt round the waist, `g` out, on the hips. */
const beltRing = (b: Build, g: number, m: Mat, lo = 0.98, hi = 1.42): Mesh =>
  rings([[lo, 1.64 * b.fr.wa * g, 1.32 * g], [hi, 1.64 * b.fr.wa * g, 1.32 * g]], 8, m, { top: false, bottom: false });
/** The upper arm, from the shoulder down to `to`. */
const upperShell = (b: Build, g: number, to: number, m: Mat): Mesh => rings([
  [0.5, 0.5 * g, 0.52 * g], [0.08, 0.82 * b.arm * g, 0.8 * g], [Math.max(to, -1.5), 0.74 * g, 0.72 * g], ...(to < -1.5 ? [[to, 0.66 * g, 0.64 * g]] : []),
], 6, m, { top: false, bottom: false });
/** The forearm, from the elbow down to the wrist. */
const forearmShell = (g: number, m: Mat): Mesh => rings([[0.32, 0.66 * g, 0.62 * g], [-2.15, 0.5 * g, 0.47 * g]], 6, m, { top: false, bottom: false });
/** The thigh, from the hip down to the knee. */
const thighShell = (b: Build, g: number, m: Mat): Mesh => rings([[-0.9, 1.02 * b.fr.hi * g, 1.05 * g], [-3.42, 0.8 * g, 0.84 * g]], 6, m, { top: false, bottom: false });
/** The shin, from the knee down to `to`. */
const shinShell = (g: number, to: number, m: Mat | ((band: number, j: number) => Mat)): Mesh =>
  rings([[0.22, 0.82 * g, 0.86 * g], [-1.4, 0.72 * g, 0.76 * g], [to, 0.64 * g, 0.68 * g]], 6, m, { top: false, bottom: false });

/** The skull in the head's own frame, `out` further out, at height `z`: a ring of it, for a helm to follow. */
const skullRing = (fr: Frame, z: number, out: number, dy = 0): number[] => {
  const [rxx, ryy, cy] = skull(fr, z);
  return [z, rxx + out, ryy + out, 0, cy + dy];
};

/**
 * A ridge up the middle of the head from the brow over the crown to the
 * nape, `out` off the skull and `r` round: a helm's comb, a cap's seam.
 */
function crestOf(fr: Frame, out: number, r: number, m: Mat, top = CROWN + 0.3, from = 2.2): Mesh {
  const zs = [from, (from + 2.9) / 2, 2.9, CROWN - 0.12];
  const front = zs.map((z): V3 => { const [, ry, cy] = skull(fr, z); return [0, cy + ry + out, z]; });
  const back = [...zs].reverse().map((z): V3 => { const [, ry, cy] = skull(fr, z); return [0, cy - ry - out, z]; });
  const pts: V3[] = [...front, [0, skull(fr, CROWN - 0.12)[2], top], ...back];
  return chain(pts, pts.map(() => r), 4, m);
}

/** Everything a hat is drawn over: the head and whatever of the hair and the face is left on it. */
const HEAD_OVER: Covers[] = ['head', 'ears', 'nose', 'beard', 'fall', 'tails', 'cap', 'top'];

/* -- what is worn ---------------------------------------------------------------------- */

/** How much bigger round the waist each chest piece is than the body, for what goes round it. */
const CHEST_FIT: Record<string, number> = { cloth_tunic: 1.12, leather_jerkin: 1.09, chain_hauberk: 1.1, plate_breastplate: 1.16, scale_cuirass: 1.12 };

/**
 * Every piece, a model of its own, given the build of the body it is on, and
 * `fit`, how far out round the waist the chest piece under it comes, for a
 * belt to go round.
 */
const MODELS: Record<string, (b: Build, fit: number) => GearModel> = {
  /* Head */
  wool_cap: (b) => ({
    layer: 1,
    bits: [{
      bone: 'head', over: HEAD_OVER, bias: 0.03,
      mesh: grown(join(
        // The turned-up band round the brow, then the knitted crown slouching back over the top.
        rings([skullRing(b.fr, 1.72, 0.26), skullRing(b.fr, 2.1, 0.28)], 8, 'clothDark', { top: false, bottom: false }),
        worn(rings([skullRing(b.fr, 2.08, 0.22), skullRing(b.fr, 2.55, 0.2, -0.08), [CROWN + 0.02, 1.05, 1.1, 0, -0.35], [CROWN + 0.32, 0.42, 0.46, 0, -0.62]], 8, 'cloth', { bottom: false }), 'quilt'),
      )),
    }],
    hides: ['cap', 'top'],
  }),
  leather_cap: (b) => ({
    layer: 2,
    bits: [{
      bone: 'head', over: HEAD_OVER, bias: 0.03,
      mesh: grown(join(
        // A round cap of hide to just over the brow, a darker band round its edge, and a button on the crown.
        rings([skullRing(b.fr, 1.72, 0.2), skullRing(b.fr, 1.92, 0.19)], 8, 'leatherDark', { top: false, bottom: false }),
        rings([skullRing(b.fr, 1.9, 0.16), skullRing(b.fr, 2.3, 0.16), skullRing(b.fr, 2.75, 0.13), [CROWN + 0.12, 0.34, 0.36, 0, 0]], 8, 'leather', { bottom: false }),
        ball([0, skull(b.fr, CROWN - 0.1)[2], CROWN + 0.14], [0.2, 0.2, 0.12], 5, 3, 'leatherDark'),
        // Flaps down over the ears, curved round the head.
        ...[0, 180].map((c) => arcs([skullRing(b.fr, 0.95, 0.2), skullRing(b.fr, 1.35, 0.21), skullRing(b.fr, 1.8, 0.2)], 3, c - 34, c + 34, 'leather')),
        ...[0, 180].map((c) => arcs([skullRing(b.fr, 0.88, 0.2), skullRing(b.fr, 0.98, 0.2)], 3, c - 34, c + 34, 'leatherDark')),
      )),
    }],
    hides: ['cap', 'top'],
  }),
  chain_coif: (b) => ({
    layer: 3,
    bits: [
      {
        bone: 'head', over: HEAD_OVER, bias: 0.035,
        mesh: grown(join(
          worn(rings([skullRing(b.fr, 1.85, 0.3), skullRing(b.fr, 2.4, 0.28), skullRing(b.fr, 2.85, 0.24), [CROWN + 0.2, 0.52, 0.55, 0, 0]], 8, 'mail', { bottom: false }), 'mail'),
          // Round the face and down the throat, open in front from the brow to the chin.
          worn(arcs([[-0.9, 1.3, 1.35, 0, -0.05], [0.25, 1.4, 1.35, 0, 0.1], [1.3, 1.72, 1.78, 0, 0.14], [1.9, 1.78, 1.86, 0, 0.06]], 7, 128, 412, 'mail'), 'mail'),
        )),
      },
      // The cape of it over the shoulders.
      {
        bone: 'chest', over: ['chest', 'neck'], bias: 0.11,
        mesh: worn(rings([[1.15, 2.2 * b.fr.sh, 1.46], [2.05, 1.62 * b.fr.sh, 1.08], [2.75, 0.98, 0.92, 0, -0.05]], 8, 'mail', { top: false, bottom: false }), 'mail'),
      },
    ],
    hides: ['cap', 'top', 'fall', 'tails'],
  }),
  helm: (b) => ({
    layer: 5,
    bits: [{
      bone: 'head', over: HEAD_OVER, bias: 0.04,
      mesh: grown(join(
        // A round steel cap to a rim just over the brow, and a ridge from the brow over the crown.
        rings([skullRing(b.fr, 1.62, 0.34), skullRing(b.fr, 1.78, 0.3), skullRing(b.fr, 2.3, 0.27), skullRing(b.fr, 2.8, 0.22), [CROWN + 0.26, 0.5, 0.52, 0, 0]], 8,
          (band) => (band === 0 ? 'metalLit' : 'metal'), { bottom: false }),
        crestOf(b.fr, 0.3, 0.13, 'metalLit', CROWN + 0.36, 2.25),
        // The nasal down over the nose, and a cheek plate down each side of the face.
        box([-0.13, 1.72, 0.92], [0.13, 1.98, 1.72], 'metal'),
        box([1.34, -0.2, 0.62], [1.72, 1.2, 1.7], 'metal', 'metalLit'), box([-1.72, -0.2, 0.62], [-1.34, 1.2, 1.7], 'metal', 'metalLit'),
      )),
    }],
    hides: ['cap', 'top', 'fall'],
  }),
  scale_helm: (b) => ({
    layer: 4,
    bits: [{
      bone: 'head', over: HEAD_OVER, bias: 0.04,
      mesh: grown(join(
        worn(rings([skullRing(b.fr, 1.6, 0.32), skullRing(b.fr, 2.2, 0.3), skullRing(b.fr, 2.75, 0.24), [CROWN + 0.24, 0.5, 0.52, 0, 0]], 8,
          (band) => (band === 0 ? 'scaleDark' : 'scale'), { bottom: false }), 'scale'),
        // A row of scale-spines up the middle, tallest over the crown.
        ...[-1.15, -0.45, 0.25, 0.95].map((y, i) => slab([[y - 0.28, CROWN - 0.1 - Math.abs(y) * 0.3], [y + 0.24, CROWN - 0.1 - Math.abs(y) * 0.3], [y - 0.12, CROWN + 0.52 - Math.abs(i - 1.5) * 0.16]].map(([yy, z]): [number, number, number] => [yy, z, 0.07]), 'scaleDark')),
        box([1.32, -0.3, 0.7], [1.66, 1.05, 1.66], 'scale'), box([-1.66, -0.3, 0.7], [-1.32, 1.05, 1.66], 'scale'),
      )),
    }],
    hides: ['cap', 'top', 'fall'],
  }),

  /* Chest */
  cloth_tunic: (b) => ({
    layer: 1,
    bits: [
      { bone: 'chest', over: ['chest'], bias: 0.02, convex: true, mesh: worn(join(chestShell(b, 1.1, 'cloth'), rings([[2.15, 1.02, 0.86, 0, -0.1], [2.55, 0.86, 0.76, 0, -0.1]], 8, 'clothDark', { bottom: false, top: false })), 'quilt', (f) => f.m === 'cloth') },
      { bone: 'spine', over: ['abdomen'], bias: 0.02, convex: true, mesh: worn(waistShell(b, 1.1, 'cloth'), 'quilt') },
      { bone: 'pelvis', over: ['skirt', 'thigh'], bias: 0.16, skirt: true, mesh: worn(skirtShell(b, 1.08, -2.3, (band) => (band === 0 ? 'clothDark' : 'cloth')), 'quilt', (f) => f.m === 'cloth') },
      { bone: 'pelvis', over: ['belt', 'skirt', 'abdomen'], bias: 0.02, convex: true, mesh: beltRing(b, 1.1, 'belt') },
    ],
    hides: ['skirt', 'belt', 'chest', 'abdomen'],
  }),
  leather_jerkin: (b) => ({
    layer: 2,
    bits: [
      {
        bone: 'chest', over: ['chest'], bias: 0.02, convex: true,
        mesh: join(chestShell(b, 1.07, 'leather', 2.18), rings([[2.08, 1.08, 0.86, 0, -0.1], [2.34, 0.92, 0.78, 0, -0.1]], 8, 'leatherDark', { top: false, bottom: false }), decals([
          // Laced up the front: three crossings of the lace.
          ...[0.35, 0.95, 1.5].map((z) => plate([0, 1.43 * b.bust, z], [0.32, 0, 0.18], [0.05, 0, -0.18], [0, 1, 0], 'lace')),
        ])),
      },
      { bone: 'spine', over: ['abdomen'], bias: 0.02, convex: true, mesh: waistShell(b, 1.07, 'leather') },
      { bone: 'pelvis', over: ['skirt', 'thigh'], bias: 0.16, skirt: true, mesh: skirtShell(b, 1.06, -1.6, (band) => (band === 0 ? 'leatherDark' : 'leather')) },
      { bone: 'pelvis', over: ['belt', 'skirt', 'abdomen'], bias: 0.02, convex: true, mesh: beltRing(b, 1.07, 'belt') },
    ],
    hides: ['skirt', 'belt', 'chest', 'abdomen'],
  }),
  chain_hauberk: (b) => ({
    layer: 3,
    bits: [
      { bone: 'chest', over: ['chest'], bias: 0.02, convex: true, mesh: worn(chestShell(b, 1.06, 'mail'), 'mail') },
      { bone: 'spine', over: ['abdomen'], bias: 0.02, convex: true, mesh: worn(waistShell(b, 1.06, 'mail'), 'mail') },
      // To the middle of the thigh, with a band of brass rings round the hem.
      { bone: 'pelvis', over: ['skirt', 'thigh'], bias: 0.16, skirt: true, mesh: worn(skirtShell(b, 1.06, -2.6, 'mail'), 'mail') },
      { bone: 'pelvis', over: ['skirt', 'thigh'], bias: 0.18, skirt: true, mesh: rings([[-2.66, 2.14 * b.fr.hi * 1.07, 1.73 * 1.07], [-2.42, 2.11 * b.fr.hi * 1.07, 1.71 * 1.07]], 8, 'fitting', { top: false, bottom: false }) },
      { bone: 'pelvis', over: ['belt', 'skirt', 'abdomen'], bias: 0.02, convex: true, mesh: beltRing(b, 1.08, 'belt') },
      // And short sleeves of it to halfway down the upper arm.
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.02, convex: true, mesh: worn(upperShell(b, 1.12, -1.35, 'mail'), 'mail') },
    ],
    hides: ['skirt', 'belt', 'chest', 'abdomen'],
  }),
  plate_breastplate: (b) => ({
    layer: 5,
    bits: [
      {
        bone: 'chest', over: ['chest'], bias: 0.03, convex: true,
        mesh: join(chestShell(b, 1.12, 'metal'), rings([[2.18, 1.4 * b.fr.sh * 1.12, 0.8 * 1.12, 0, -0.08], [2.3, 1.3 * b.fr.sh * 1.12, 0.74 * 1.12, 0, -0.08]], 8, 'metalLit', { top: false, bottom: false })),
      },
      { bone: 'spine', over: ['abdomen'], bias: 0.03, convex: true, mesh: waistShell(b, 1.12, 'metal') },
      // The faulds: lames of plate over the hips, overlapping down.
      { bone: 'pelvis', over: ['skirt', 'thigh'], bias: 0.16, skirt: true, mesh: worn(skirtShell(b, 1.12, -1.75, (band) => (band === 0 ? 'metalLit' : 'metal')), 'lames') },
    ],
    hides: ['skirt', 'belt', 'chest', 'abdomen'],
  }),
  scale_cuirass: (b) => ({
    layer: 4,
    bits: [
      { bone: 'chest', over: ['chest'], bias: 0.02, convex: true, mesh: worn(chestShell(b, 1.08, 'scale'), 'scale') },
      { bone: 'spine', over: ['abdomen'], bias: 0.02, convex: true, mesh: worn(waistShell(b, 1.08, 'scale'), 'scale') },
      // A leather skirt, edged in dark scale.
      { bone: 'pelvis', over: ['skirt', 'thigh'], bias: 0.16, skirt: true, mesh: skirtShell(b, 1.08, -1.9, (band) => (band === 0 ? 'scaleDark' : 'leather')) },
      { bone: 'pelvis', over: ['belt', 'skirt', 'abdomen'], bias: 0.02, convex: true, mesh: beltRing(b, 1.09, 'belt') },
      // Great scales capping the shoulders.
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.2, convex: true, mesh: worn(rings([[-0.75, 0.86, 0.86, 0.06], [0.2, 1.0, 0.98, 0.06], [0.72, 0.62, 0.62, 0.02]], 6, 'scale', { bottom: false }), 'scale') },
    ],
    hides: ['skirt', 'belt', 'chest', 'abdomen'],
  }),

  /* Arms, hands and all */
  cloth_sleeves: (b) => ({
    layer: 1,
    bits: [
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.01, convex: true, mesh: worn(upperShell(b, 1.16, -2.95, 'cloth'), 'quilt') },
      { bone: 'elbow', side: 'both', over: ['lower'], bias: 0.01, convex: true, mesh: join(worn(forearmShell(1.12, 'cloth'), 'quilt'), rings([[-1.7, 0.6, 0.57], [-2.2, 0.58, 0.55]], 6, 'clothDark', { top: false, bottom: false })) },
    ],
    hides: ['upper'],
  }),
  leather_sleeves: (b) => ({
    layer: 2,
    bits: [
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.02, convex: true, mesh: upperShell(b, 1.1, -2.95, 'leather') },
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.2, convex: true, mesh: rings([[-0.9, 0.9, 0.88, 0.05], [-0.1, 1.0 * b.arm, 0.96, 0.05], [0.62, 0.6, 0.6, 0.02]], 6, 'leatherDark', { bottom: false }) },
      {
        bone: 'elbow', side: 'both', over: ['lower'], bias: 0.02,
        mesh: join(rings([[-0.35, 0.7, 0.66], [-2.1, 0.58, 0.55]], 6, 'leather', { top: false, bottom: false }),
          decals([-0.8, -1.3, -1.8].map((z) => plate([0, 0.69, z], [0.2, 0, 0.1], [0, 0, 0.05], [0, 1, 0], 'lace')))),
      },
    ],
    glove: 'leather',
  }),
  chain_sleeves: (b) => ({
    layer: 3,
    bits: [
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.015, convex: true, mesh: worn(upperShell(b, 1.1, -2.95, 'mail'), 'mail') },
      { bone: 'elbow', side: 'both', over: ['lower'], bias: 0.015, convex: true, mesh: worn(forearmShell(1.08, 'mail'), 'mail') },
    ],
    glove: 'mail',
    hides: ['upper'],
  }),
  plate_arms: (b) => ({
    layer: 5,
    bits: [
      // The rerebrace down the upper arm, and the pauldron over the shoulder: a dome of lames.
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.02, convex: true, mesh: rings([[0.05, 0.9 * b.arm, 0.86], [-2.75, 0.74, 0.72]], 6, 'metal', { top: false, bottom: false }) },
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.2, convex: true, mesh: worn(rings([[-1.15, 1.02, 1.0, 0.14], [-0.35, 1.16, 1.12, 0.16], [0.4, 1.02, 1.0, 0.12], [0.86, 0.56, 0.56, 0.05]], 6, (band) => (band === 0 ? 'metalLit' : 'metal'), { bottom: false }), 'lames', (f) => f.m === 'metal') },
      // The couter over the point of the elbow, and the vambrace down the forearm.
      { bone: 'elbow', side: 'both', over: ['lower'], bias: 0.02, convex: true, mesh: rings([[0.28, 0.68, 0.64], [-2.1, 0.54, 0.51]], 6, 'metal', { top: false, bottom: false }) },
      { bone: 'elbow', side: 'both', over: ['lower'], bias: 0.03, mesh: ball([0, -0.38, 0.1], [0.46, 0.36, 0.44], 6, 4, 'metal') },
      // The flared cuff of the gauntlet.
      { bone: 'wrist', side: 'both', over: ['hand'], bias: 0.05, convex: true, mesh: rings([[0.35, 0.52, 0.48], [-0.2, 0.62, 0.58]], 6, 'metalLit', { top: false, bottom: false }) },
    ],
    glove: 'metal',
    hides: ['upper'],
  }),
  scale_sleeves: (b) => ({
    layer: 4,
    bits: [
      { bone: 'arm', side: 'both', over: ['upper'], bias: 0.015, convex: true, mesh: worn(upperShell(b, 1.12, -2.95, 'scale'), 'scale') },
      { bone: 'elbow', side: 'both', over: ['lower'], bias: 0.015, convex: true, mesh: worn(forearmShell(1.1, 'scale'), 'scale') },
      // A cuff of scale flaring over the back of the glove.
      { bone: 'elbow', side: 'both', over: ['lower', 'hand'], bias: 0.03, convex: true, mesh: rings([[-1.75, 0.58, 0.55], [-2.3, 0.72, 0.68]], 6, 'scaleDark', { top: false, bottom: false }) },
    ],
    glove: 'leatherDark',
    hides: ['upper'],
  }),

  /* Legs */
  cloth_trousers: (b) => ({
    layer: 1,
    bits: [
      { bone: 'hip', side: 'both', over: ['thigh'], bias: 0.01, convex: true, mesh: worn(rings([[-0.9, 1.06 * b.fr.hi * 1.12, 1.1 * 1.12], [-2.4, 0.96 * 1.16, 1.0 * 1.16], [-3.42, 0.86 * 1.16, 0.9 * 1.16]], 6, 'cloth', { top: false, bottom: false }), 'quilt') },
      { bone: 'knee', side: 'both', over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: worn(rings([[0.3, 0.92 * 1.14, 0.96 * 1.14], [-0.8, 0.84 * 1.14, 0.88 * 1.14], [-1.5, 0.7 * 1.1, 0.74 * 1.1]], 6, 'cloth', { top: false, bottom: false }), 'quilt') },
      // Bound in below the knee with a wrap of the darker cloth, as a soldier's legs are.
      { bone: 'knee', side: 'both', over: ['shin', 'boot'], bias: 0.035, convex: true, mesh: rings([[-1.35, 0.74, 0.78], [-2.1, 0.68, 0.72]], 6, (band, j) => (j % 2 ? 'clothDark' : 'lining'), { top: false, bottom: false }) },
    ],
    hides: ['thigh', 'shin'],
  }),
  leather_trousers: (b) => ({
    layer: 2,
    bits: [
      { bone: 'hip', side: 'both', over: ['thigh'], bias: 0.01, convex: true, mesh: thighShell(b, 1.08, 'leatherDark') },
      { bone: 'knee', side: 'both', over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: shinShell(1.08, -1.9, 'leatherDark') },
      // A patch of doubled hide over each knee.
      { bone: 'knee', side: 'both', over: ['shin', 'boot'], bias: 0.04, mesh: ball([0, 0.42, 0.02], [0.62, 0.4, 0.62], 6, 4, 'leather') },
    ],
    hides: ['thigh', 'shin'],
  }),
  chain_leggings: (b) => ({
    layer: 3,
    bits: [
      { bone: 'hip', side: 'both', over: ['thigh'], bias: 0.012, convex: true, mesh: worn(thighShell(b, 1.08, 'mail'), 'mail') },
      { bone: 'knee', side: 'both', over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: worn(shinShell(1.1, -2.6, 'mail'), 'mail') },
      // A garter of hide under the knee, holding the mail up.
      { bone: 'knee', side: 'both', over: ['shin', 'boot'], bias: 0.04, convex: true, mesh: rings([[-0.62, 0.9, 0.94], [-0.86, 0.88, 0.92]], 6, 'leatherDark', { top: false, bottom: false }) },
    ],
    hides: ['thigh', 'shin'],
  }),
  plate_legs: (b) => ({
    layer: 5,
    bits: [
      { bone: 'hip', side: 'both', over: ['thigh'], bias: 0.015, convex: true, mesh: worn(thighShell(b, 1.12, 'metal'), 'lames') },
      { bone: 'knee', side: 'both', over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: shinShell(1.16, -2.7, 'metal') },
      // The poleyn: a cop over the knee with a wing to the outside.
      { bone: 'knee', side: 'both', over: ['shin', 'boot'], bias: 0.05, mesh: join(ball([0, 0.46, 0.08], [0.62, 0.4, 0.6], 6, 4, 'metal'), moved(slab([[-0.1, -0.35, 0.09], [0.55, -0.05, 0.09], [0.55, 0.3, 0.09], [-0.1, 0.45, 0.09]], 'metal', 'metalLit', 0.5), [0.7, 0, 0])) },
    ],
    hides: ['thigh', 'shin'],
  }),
  scale_leggings: (b) => ({
    layer: 4,
    bits: [
      { bone: 'hip', side: 'both', over: ['thigh'], bias: 0.012, convex: true, mesh: worn(thighShell(b, 1.1, 'scale'), 'scale') },
      { bone: 'knee', side: 'both', over: ['shin', 'boot'], bias: 0.03, convex: true, mesh: worn(shinShell(1.12, -2.4, 'scale'), 'scale') },
      // A tasset of great scales flaring down the outside of the thigh.
      { bone: 'hip', side: 'both', over: ['thigh'], bias: 0.03, mesh: worn(arcs([[-2.0, 1.28, 1.24, 0.1], [-1.2, 1.3, 1.25, 0.05], [-0.5, 1.22, 1.16, 0]], 4, -58, 58, 'scaleDark'), 'scale') },
    ],
    hides: ['thigh', 'shin'],
  }),

  /* Feet: in place of the body's own boots */
  cloth_shoes: () => ({
    layer: 1,
    bits: [
      // The leg of the trousers down to the shoe, which the boot's shaft was: under anything worn on the leg.
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.01, convex: true, layer: 0, mesh: rings([[-1.3, 0.8, 0.84], [-3.0, 0.64, 0.68]], 6, 'trousers', { top: false, bottom: false }) },
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.02, convex: true, mesh: rings([[-2.75, 0.68, 0.72], [-3.1, 0.66, 0.7]], 6, 'clothDark', { top: false, bottom: false }) },
      { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: recoloured(swelled(footMesh(), 0.96, 0.8), { boot: 'clothDark' }) },
    ],
    hides: ['boot', 'foot'],
  }),
  leather_boots: () => ({
    layer: 2,
    bits: [
      // To below the knee, the top turned down.
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.02, convex: true, mesh: rings([[-0.55, 0.96, 1.0], [-0.95, 0.94, 0.98], [-1.0, 0.86, 0.9], [-3.02, 0.68, 0.72], [-3.15, 0.63, 0.66]], 6, (band) => (band === 0 ? 'leatherDark' : 'leather'), { bottom: false }) },
      { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: recoloured(swelled(footMesh(), 1.04), { boot: 'leather' }) },
    ],
    hides: ['boot', 'foot'],
  }),
  chain_boots: () => ({
    layer: 3,
    bits: [
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.02, convex: true, mesh: worn(rings([[-1.2, 0.9, 0.94], [-3.1, 0.68, 0.72]], 6, 'mail', { top: false, bottom: false }), 'mail') },
      { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: worn(recoloured(swelled(footMesh(), 1.05), { boot: 'mail' }), 'mail') },
      // Strapped at the ankle over the mail.
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.03, convex: true, mesh: rings([[-2.72, 0.74, 0.78], [-2.92, 0.73, 0.77]], 6, 'leatherDark', { top: false, bottom: false }) },
    ],
    hides: ['boot', 'foot'],
  }),
  plate_boots: () => ({
    layer: 5,
    bits: [
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.02, convex: true, mesh: rings([[-1.3, 0.84, 0.88], [-3.0, 0.72, 0.76], [-3.18, 0.7, 0.74]], 6, (band) => (band === 1 ? 'metalLit' : 'metal'), { top: false, bottom: false }) },
      { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: worn(recoloured(swelled(footMesh(), 1.08), { boot: 'metal' }), 'lames') },
    ],
    hides: ['boot', 'foot'],
  }),
  scale_boots: () => ({
    layer: 4,
    bits: [
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.02, convex: true, mesh: worn(rings([[-1.05, 0.88, 0.92], [-3.08, 0.68, 0.72]], 6, 'scale', { top: false, bottom: false }), 'scale') },
      // The top of the shaft flared into a crown of scales.
      { bone: 'knee', side: 'both', over: ['shin'], bias: 0.03, convex: true, mesh: rings([[-1.2, 0.9, 0.94], [-0.8, 1.06, 1.1]], 6, 'scaleDark', { top: false, bottom: false }) },
      { bone: 'ankle', side: 'both', over: ['foot'], bias: 0.02, mesh: recoloured(swelled(footMesh(), 1.05), { boot: 'leatherDark' }) },
    ],
    hides: ['boot', 'foot'],
  }),

  /* Round the waist */
  toolbelt: (b, fit) => {
    const g = fit + 0.04, wa = b.fr.wa;
    const front = 1.32 * g * Math.cos(Math.PI / 8);
    return {
      layer: 6,
      bits: [
        {
          bone: 'pelvis', over: ['belt', 'skirt', 'abdomen'], bias: 0.03, convex: true,
          mesh: join(beltRing(b, g, 'leather', 0.9, 1.5), decals([plate([0, front + 0.01, 1.2], [0.26, 0, 0], [0, 0, 0.26], [0, 1, 0], 'fitting'), plate([0, front + 0.02, 1.2], [0.12, 0, 0], [0, 0, 0.12], [0, 1, 0], 'leatherDark')])),
        },
        // A pouch on the right hip and a bigger one round at the left of the back, each with its flap.
        { bone: 'pelvis', over: ['belt', 'skirt', 'thigh'], bias: 0.06, mesh: join(box([1.5 * wa * g - 0.15, 0.1, 0.25], [1.5 * wa * g + 0.42, 0.95, 1.25], 'leather'), box([1.5 * wa * g - 0.12, 0.08, 0.95], [1.5 * wa * g + 0.46, 0.98, 1.3], 'leatherDark')) },
        { bone: 'pelvis', over: ['belt', 'skirt', 'thigh'], bias: 0.06, mesh: join(box([-1.35 * wa * g, -1.3 * g - 0.5, 0.15], [-0.45 * wa * g, -1.3 * g + 0.15, 1.3], 'leather'), box([-1.38 * wa * g, -1.3 * g - 0.54, 0.95], [-0.42 * wa * g, -1.3 * g + 0.15, 1.36], 'leatherDark')) },
        // And a hammer hung through a loop on the left hip, head down.
        {
          bone: 'pelvis', over: ['belt', 'skirt', 'thigh'], bias: 0.07,
          mesh: moved(join(
            rings([[-0.9, 0.11, 0.11], [1.2, 0.12, 0.12]], 5, 'wood'),
            box([-0.2, -0.55, -1.25], [0.2, 0.45, -0.85], 'metal', 'metalLit'),
            rings([[0.95, 0.2, 0.2], [1.35, 0.2, 0.2]], 6, 'leatherDark', { top: false, bottom: false }),
          ), [-1.62 * wa * g, 0.35, 0]),
        },
      ],
      hides: ['belt'],
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
      mesh: handSized(join(
        rings([[-0.95, 0.5, 0.3], [-0.8, 0.52, 0.32]], 6, 'fitting', { top: false, bottom: false }),
        ball([0.5, 0.05, -0.88], [0.13, 0.13, 0.13], 5, 3, 'gem'),
      )),
    }],
  }),
};

/** A model for a piece on a body of this build, made once. */
const models = new Map<string, GearModel | null>();
function modelOf(id: string, fr: Frame, fit: number): GearModel | null {
  const key = `${id}|${fr.sh}|${fr.wa}|${fr.hi}|${fr.fem}|${id === 'toolbelt' ? fit : ''}`;
  let m = models.get(key);
  if (m === undefined) {
    const make = MODELS[id];
    m = make ? make(buildOf(fr), fit) : null;
    models.set(key, m);
    if (models.size > 400) models.delete(models.keys().next().value as string);
  }
  return m;
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

/** A skirt of gear, bent with the legs as the tunic's own hem is (`skirtBent`), and further for a longer one. */
function bentWith(v: V3[], r: Rig, fr: Frame): V3[] {
  return v.map((p0) => {
    const p: V3 = [...p0];
    const share = p[2] < -0.9 ? 1 : p[2] < 0.5 ? 0.4 : 0;
    if (!share) return p;
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1;
      const lever = Math.max(1.35, -p[2]);
      const d = lever * Math.sin(r.leg[k][0] * DEG) * share;
      const w = Math.max(0, Math.min(1, 1 - Math.abs(p[0] - s * 0.95 * fr.hi) / 1.5));
      if (d > 0 && p[1] > -0.4) { p[1] += d * w; p[2] += d * 0.3 * w; }
      if (d < 0 && p[1] < 0.4) { p[1] += d * w * 0.8; p[2] -= d * 0.2 * w; }
    }
    return p;
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
   * How it is carried: in the right fist, point forward and down; upright in
   * the right fist, as a staff is; in the left fist, a bow; or slung across
   * the back, which is where everything goes while the hands are busy.
   */
  carry: 'fist' | 'staff' | 'bow' | 'back';
  /** From its butt to its tip along z, for hanging it across the back by its middle. */
  from: number;
  to: number;
  /** Slung head up over the right shoulder, rather than point down to the left hip. */
  headUp?: boolean;
}

/** A round shaft along z, from `a` to `b`, `r0` across at `a` and `r1` at `b`. */
const rod = (a: number, b: number, r0: number, r1: number, m: Mat, n = 5): Mesh => rings([[a, r0, r0], [b, r1, r1]], n, m);

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

const WEAPONS: Record<string, () => Weapon> = {
  hunting_knife: () => ({
    carry: 'fist', from: -0.7, to: 2.5,
    grip: rod(-0.55, 0.52, 0.15, 0.13, 'grip', 6),
    head: join(pommelOf(-0.62, 0.17), guardOf(0.6, 0.3), bladeOf(0.66, 2.5, 0.2, 0.06, 0.35, 'blade', 1)),
  }),
  butchering_knife: () => ({
    carry: 'fist', from: -0.7, to: 2.7,
    grip: rod(-0.55, 0.55, 0.15, 0.15, 'woodDark', 6),
    // A broad blade, straight along its back, for going through a joint.
    head: join(rings([[0.55, 0.16, 0.2], [0.68, 0.17, 0.21]], 6, 'fitting'), rings([[0.68, 0.06, 0.34, 0, 0.1], [2.3, 0.05, 0.42, 0, 0.16], [2.7, 0.03, 0.26, 0, 0.26]], 6, 'blade', { top: true })),
  }),
  carving_knife: () => ({
    carry: 'fist', from: -0.65, to: 3.1,
    grip: rod(-0.55, 0.52, 0.13, 0.13, 'grip', 6),
    head: join(rings([[0.52, 0.15, 0.17], [0.66, 0.12, 0.15]], 6, 'fitting'), bladeOf(0.66, 3.1, 0.16, 0.045, 0.45, 'blade', 1)),
  }),
  short_sword: () => ({
    carry: 'fist', from: -0.8, to: 5.4,
    grip: rod(-0.52, 0.52, 0.15, 0.14, 'grip', 6),
    head: join(pommelOf(-0.66, 0.21), guardOf(0.6, 0.62), bladeOf(0.7, 5.4, 0.3, 0.075, 0.2), fullerOf(0.95, 3.9, 0.3, 0.075)),
  }),
  sword: () => ({
    carry: 'fist', from: -0.9, to: 7.6,
    grip: rod(-0.55, 0.55, 0.15, 0.14, 'grip', 6),
    head: join(
      rings([[-0.95, 0.24, 0.3], [-0.62, 0.24, 0.3]], 6, 'fitting'),
      box([-0.13, -0.85, 0.58], [0.13, 0.85, 0.76], 'fitting'), box([-0.1, -0.95, 0.7], [0.1, -0.72, 0.9], 'fitting'), box([-0.1, 0.72, 0.7], [0.1, 0.95, 0.9], 'fitting'),
      bladeOf(0.76, 7.6, 0.33, 0.08, 0.18), fullerOf(1.0, 5.6, 0.33, 0.08),
    ),
  }),
  long_sword: () => ({
    carry: 'back', from: -1.6, to: 10.4,
    // A grip for two hands.
    grip: rod(-1.25, 0.6, 0.16, 0.15, 'grip', 6),
    head: join(pommelOf(-1.42, 0.25), guardOf(0.68, 1.05), bladeOf(0.78, 10.4, 0.36, 0.085, 0.16), fullerOf(1.05, 8.0, 0.36, 0.085)),
  }),
  hatchet: () => ({
    carry: 'fist', from: -1.1, to: 3.5,
    grip: rod(-1.0, 0.6, 0.15, 0.14, 'wood', 5),
    head: join(
      rod(0.6, 3.25, 0.14, 0.13, 'wood', 5),
      slab([[-0.4, 2.62, 0.17], [0.22, 2.56, 0.17], [1.18, 2.2, 0.04], [1.3, 2.86, 0.03], [1.18, 3.52, 0.04], [0.22, 3.2, 0.17], [-0.4, 3.12, 0.17]], 'metal', 'blade', 1.1),
    ),
  }),
  battle_axe: () => ({
    carry: 'back', headUp: true, from: -4.1, to: 6.4,
    grip: rod(-4.0, 0.6, 0.18, 0.17, 'grip', 5),
    head: join(
      rod(0.6, 5.6, 0.17, 0.15, 'wood', 5),
      rings([[4.3, 0.2, 0.2], [4.5, 0.2, 0.2]], 5, 'metalDark', { top: false, bottom: false }),
      // A bearded bit, and a spike behind.
      slab([[-0.3, 4.55, 0.22], [0.3, 4.5, 0.22], [1.2, 3.55, 0.08], [2.0, 3.4, 0.04], [2.25, 4.6, 0.03], [2.05, 6.0, 0.04], [0.9, 5.7, 0.1], [0.3, 5.45, 0.22], [-0.3, 5.45, 0.22]], 'metal', 'blade', 1.9),
      slab([[-0.3, 4.72, 0.16], [-1.35, 4.95, 0.05], [-0.3, 5.25, 0.16]], 'metalDark'),
    ),
  }),
  club: () => ({
    carry: 'fist', from: -0.9, to: 4.3,
    grip: rod(-0.85, 0.6, 0.18, 0.2, 'woodDark', 6),
    // Swelling from the grip to the knob of the root it was cut from, with a knot or two on it.
    head: worn(join(
      rings([[0.6, 0.2, 0.2], [2.4, 0.36, 0.34], [3.7, 0.52, 0.5], [4.3, 0.34, 0.32]], 6, 'wood'),
      ball([0.3, 0.12, 2.9], [0.2, 0.2, 0.2], 5, 3, 'woodDark'), ball([-0.28, -0.3, 3.5], [0.2, 0.2, 0.2], 5, 3, 'woodDark'),
    ), 'grain'),
  }),
  maul: () => ({
    carry: 'back', headUp: true, from: -4.2, to: 5.6,
    grip: rod(-4.1, 0.6, 0.18, 0.17, 'grip', 5),
    head: join(
      rod(0.6, 4.8, 0.17, 0.16, 'wood', 5),
      // The head: a block of iron, its striking faces bright.
      box([-0.55, -1.15, 4.3], [0.55, 1.15, 5.4], 'metal', 'metalLit'),
      box([-0.6, -1.25, 4.25], [0.6, -1.1, 5.45], 'metalLit'), box([-0.6, 1.1, 4.25], [0.6, 1.25, 5.45], 'metalLit'),
    ),
  }),
  spear: () => ({
    carry: 'staff', headUp: true, from: -5.5, to: 13.2,
    grip: rod(-0.6, 0.6, 0.15, 0.15, 'grip', 5),
    head: join(
      rod(-5.3, -0.6, 0.13, 0.14, 'wood', 5), rod(0.6, 11.2, 0.14, 0.13, 'wood', 5),
      rings([[-5.5, 0.08, 0.08], [-5.15, 0.15, 0.15]], 5, 'metal'),
      rings([[10.9, 0.15, 0.15], [11.5, 0.12, 0.12]], 5, 'metal'),
      // A leaf-shaped head.
      rings([[11.5, 0.08, 0.14], [12.2, 0.07, 0.36], [13.2, 0.012, 0.012]], 6, 'blade', { top: false }),
    ),
  }),
  javelin: () => ({
    carry: 'staff', headUp: true, from: -4.4, to: 8.2,
    grip: rod(-0.5, 0.5, 0.13, 0.13, 'grip', 5),
    head: join(
      rod(-4.4, -0.5, 0.1, 0.11, 'wood', 5), rod(0.5, 7.2, 0.11, 0.1, 'wood', 5),
      rings([[7.1, 0.12, 0.12], [7.4, 0.1, 0.1]], 5, 'metal'),
      rings([[7.4, 0.07, 0.1], [7.8, 0.06, 0.2], [8.2, 0.012, 0.012]], 6, 'blade', { top: false }),
    ),
  }),
  throwing_axe: () => ({
    carry: 'fist', from: -1.0, to: 2.9,
    grip: rod(-0.9, 0.5, 0.14, 0.13, 'wood', 5),
    // A short haft and a head swept down, heavy at the bit.
    head: join(
      rod(0.5, 2.75, 0.13, 0.12, 'wood', 5),
      slab([[-0.3, 2.3, 0.15], [0.2, 2.26, 0.15], [0.9, 1.7, 0.05], [1.45, 1.55, 0.03], [1.35, 2.35, 0.03], [1.0, 2.9, 0.04], [0.2, 2.8, 0.15], [-0.3, 2.72, 0.15]], 'metal', 'blade', 1.3),
    ),
  }),
  short_bow: () => bowOf(11, 0.8, 'wood'),
  medium_bow: () => bowOf(14, 1.0, 'wood'),
  long_bow: () => bowOf(16, 1.1, 'wood'),
  composite_bow: () => bowOf(12, 0.95, 'leatherDark', true),
};

/**
 * A bow `L` long, standing along z, bellied `c` forward of its string at the
 * grip, in `m`. A composite one is the horseman's shape: its tips turned
 * forward again past where the string meets them, in bone, with the string
 * bearing on the limb where the turn begins.
 */
function bowOf(L: number, c: number, m: Mat, recurve = false): Weapon {
  const h = L / 2;
  const EAR = 0.78;
  const at = (u: number): V3 => {
    // u from -1 at the lower tip to 1 at the upper: a bow bent into a flat arc, and a recurve's ears flicked forward.
    const a = Math.abs(u);
    const y = c * (1 - u * u) + (recurve && a > EAR ? Math.pow((a - EAR) / (1 - EAR), 1.3) * 1.05 * c : 0);
    return [0, y, u * h];
  };
  const r = (x: number): number => 0.09 + 0.08 * (1 - Math.abs(x));
  const limb = (u: number[], mat: Mat): Mesh => chain(u.map(at), u.map(r), 5, mat, false);
  if (!recurve) {
    const us = [-1, -0.82, -0.6, -0.34, -0.12, 0.12, 0.34, 0.6, 0.82, 1];
    return {
      carry: 'bow', headUp: true, from: -h, to: h,
      grip: chain([at(-0.12), at(0.12)], [0.19, 0.19], 6, 'grip'),
      head: join(
        limb(us.slice(0, 5), m), limb(us.slice(5), m),
        ball(at(-1), [0.1, 0.1, 0.14], 5, 3, 'woodDark'), ball(at(1), [0.1, 0.1, 0.14], 5, 3, 'woodDark'),
        fine(chain([at(-0.985), at(0.985)], [0.025, 0.025], 4, 'string'), 0.05),
      ),
    };
  }
  const inner = [0.14, 0.4, 0.62, EAR], ear = [EAR, 0.9, 1];
  const side = (s: number, us: number[]): number[] => us.map((u) => u * s);
  return {
    carry: 'bow', headUp: true, from: -h, to: h,
    grip: join(chain([at(-0.14), at(0.14)], [0.2, 0.2], 6, 'grip'), ...[-0.15, 0.15].map((u) => chain([at(u - 0.02), at(u + 0.02)], [0.22, 0.22], 6, 'fitting'))),
    head: join(
      limb(side(-1, inner).reverse(), m), limb(side(1, inner), m),
      limb(side(-1, ear).reverse(), 'lace'), limb(side(1, ear), 'lace'),
      fine(chain([at(-EAR), at(EAR)], [0.025, 0.025], 4, 'string'), 0.05),
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
    const rim = rings([[-0.16, R + 0.1, R + 0.1], [0.17, R + 0.1, R + 0.1]], n, 'metalDark', { top: false, bottom: false });
    const seams = decals([-1.25, 0, 1.25].map((x) => {
      const half = Math.sqrt(Math.max(0, R * R - x * x)) * 0.97;
      return plate([x, 0, 0.125], [0.04, 0, 0], [0, half, 0], [0, 0, 1], dyed ? 'clothDark' : 'woodDark');
    }));
    const rivets = decals(Array.from({ length: 8 }, (_, k) => {
      const a = (k / 8) * TAU + 0.2;
      return plate([Math.cos(a) * (R - 0.25), Math.sin(a) * (R - 0.25), 0.126], [0.09, 0, 0], [0, 0.09, 0], [0, 0, 1], 'rivet');
    }));
    const boss = join(rings([[0.1, 0.78, 0.78], [0.3, 0.72, 0.72]], 8, 'metal', { bottom: false, top: false }), ball([0, 0, 0.36], [0.66, 0.66, 0.42], 8, 4, 'metalLit'));
    return join(disc, rim, seams, rivets, boss);
  },
  metal_shield: (dyed) => {
    // A heater: flat along the top, curved down each side to a point, bent back a little either side of its middle.
    const outline: Pt[] = [[-1.75, 2.3], [0, 2.3], [1.75, 2.3], [1.8, 0.6], [1.45, -0.9], [0.8, -2.1], [0, -2.9], [-0.8, -2.1], [-1.45, -0.9], [-1.8, 0.6]];
    const bend = (x: number): number => -Math.abs(x) * 0.22;
    const n = outline.length;
    const v: V3[] = [...outline.map(([x, y]): V3 => [x, y, bend(x) + 0.1]), ...outline.map(([x, y]): V3 => [x, y, bend(x) - 0.1])];
    // The face as two halves, right and left of the middle, so the bend shows in the light; lined in hide behind.
    const right = [1, 2, 3, 4, 5, 6], left = [6, 7, 8, 9, 0, 1];
    const f: Face[] = [
      faceOut(v, right, [0, 0, 1], 'metalLit'), faceOut(v, left, [0, 0, 1], 'metalLit'),
      faceOut(v, right.map((i) => n + i), [0, 0, -1], 'leatherDark'), faceOut(v, left.map((i) => n + i), [0, 0, -1], 'leatherDark'),
    ];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = outline[j][0] - outline[i][0], ey = outline[j][1] - outline[i][1];
      f.push(faceOut(v, [i, j, n + j, n + i], [ey, -ex, 0], 'metal'));
    }
    // The field inside the rim, painted when dyed, and a boss on the middle.
    const inset = (i: number): V3 => {
      const [x, y] = outline[i];
      return [x * 0.84, y * 0.84 - 0.05, bend(x * 0.84) + 0.105];
    };
    const field: Mat = dyed ? 'cloth' : 'metal';
    const paint = decals([right, left].map((idx) => {
      const q = idx.map(inset);
      return { q: newell(q)[2] < 0 ? q.reverse() : q, m: field };
    }));
    const boss = ball([0, 0.2, 0.16], [0.5, 0.5, 0.3], 8, 4, 'metalLit');
    return join(mesh(v, f), paint, boss);
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

/** A frame turned by a matrix, whose columns are where its x, y and z go, at `at`. */
const framed = (bone: Xf, at: V3, x: V3, y: V3, z: V3): Xf => ({ m: mm(bone.m, [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]), t: place(bone, at) });

/** How far the arm of a body standing at rest is turned forward from the shoulder down to the hand, in degrees: what a held staff or bow is kept upright against. */
const REST_BEND = 21;

/** Where across the back a thing is slung, in the chest's frame: its middle, how far out behind for a weapon and for a shield over it. */
const BACK: V3 = [0, -1.72, 0.85];
const BACK_SHIELD = -2.05;

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
function dress(parts: Part[], named: Map<string, Part[]>, kit: Kit, r: Rig, b: Bones, gear: GearLook, pal: Palette): Part[] {
  const fr = kit.fr;
  const fit = CHEST_FIT[gear.chest?.id ?? ''] ?? 1;
  const hidden = new Set<Part>();
  const worn: Array<[number, GearPiece, GearModel]> = [];
  DRESSED.forEach((slot, si) => {
    const piece = gear[slot];
    const model = piece && modelOf(piece.id, fr, fit);
    if (!piece || !model) return;
    worn.push([si, piece, model]);
    for (const c of model.hides ?? []) for (const key of regionsOf(c, -1)) for (const p of named.get(key) ?? []) hidden.add(p);
  });
  const out = parts.filter((p) => !hidden.has(p));
  const put: Put[] = [];
  worn.forEach(([si, piece, model], order) => {
    const P = gearPalette(pal, piece);
    const rare = piece.rare || undefined;
    model.bits.forEach((bit, seq) => {
      const sides = bit.side === 'both' ? [0, 1] : bit.side === undefined ? [-1] : [bit.side];
      for (const k of sides) {
        const bone = b[k < 0 ? bit.bone : `${bit.bone}${k}`];
        const m = k === 0 && bit.side === 'both' ? mirrored(bit.mesh) : bit.mesh;
        const xf = bit.at || bit.turn ? joint(bone, bit.at ?? [0, 0, 0], ...(bit.turn ?? [0, 0, 0])) : bone;
        const part: Part = { mesh: m, xf, bias: bit.bias ?? 0.02, pal: P, rare, seed: si + 1, convex: bit.convex, front: bit.front, v: bit.skirt ? bentWith(m.v, r, fr) : undefined };
        out.push(part);
        put.push({ part, on: regionsOf(bit.over[0], k)[0], over: bit.over.flatMap((c) => regionsOf(c, k)), layer: bit.layer ?? model.layer, order, seq });
      }
    });
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
  wield(out, named, r, b, gear, pal, put);
  return out;
}

/**
 * What is held: a weapon in the right hand, or a bow in the left, and a
 * shield on the left forearm; and all of it slung across the back while the
 * hands are busy -- at work, swimming, at the reins, or waving.
 */
function wield(out: Part[], named: Map<string, Part[]>, r: Rig, b: Bones, gear: GearLook, pal: Palette, put: Put[]): void {
  const busy = r.tool || r.reins || r.sink > 0;
  const onBack = (): Part[] => [...(named.get('chest') ?? []), ...(named.get('abdomen') ?? []), ...put.filter((p) => p.on === 'chest' || p.on === 'abdomen').map((p) => p.part)];
  const w = gear.weapon;
  const arm = w && weaponOf(w.id);
  let slung: Part | undefined;
  if (w && arm) {
    const P = gearPalette(pal, w);
    const rare = w.rare || undefined, seed = DRESSED.indexOf('weapon') + 1;
    const hand = arm.carry === 'bow' ? 0 : 1;
    const free = !busy && !r.open[hand] && arm.carry !== 'back';
    if (free) {
      /*
       * A blade forward and down and out a little from the body, so it shows
       * its length from the front as well as the side, and kept so as the
       * elbow bends at a run rather than coming up in front of the face. A
       * staff upright and a bow slanted across, each held at its slant
       * however the arm swings, which is what keeps a bow's lower tip and a
       * spear's butt out of the ground.
       */
      const bend = r.arm[hand][0] + r.elbow[hand] + r.hand[hand][0] - REST_BEND;
      // The swing taken back out first, about the same axis it was put in about, and then the slant and the turn out.
      const kept = (undo: number): Xf => joint(b[`wrist${hand}`], [0, 0, GRIP], -undo);
      const xf = arm.carry === 'fist' ? joint(kept(0.85 * (r.elbow[1] - 18)), [0, 0, 0], -128, 0, -25)
        : arm.carry === 'staff' ? joint(kept(bend), [0, 0, 0], -10)
          : joint(kept(bend), [0, 0, 0], -46, 0, 30);
      const grip: Part = { mesh: arm.grip, xf, bias: 0.02, pal: P, rare, seed };
      out.push(grip, { mesh: arm.head, xf, bias: 0.035, pal: P, rare, seed });
      // The fingers round the grip.
      for (const h of named.get(`hand${hand}`) ?? []) h.after = grip;
    } else {
      const dir: V3 = arm.headUp ? [0.42, 0, 0.9] : [-0.42, 0, -0.9];
      const mid = (arm.from + arm.to) / 2;
      const d = unit(dir);
      const xf = aimed(b.chest, [BACK[0] - d[0] * mid, BACK[1], BACK[2] - d[2] * mid], dir, [0, -1, 0]);
      slung = { mesh: join(arm.grip, arm.head), xf, bias: 0.05, pal: P, rare, seed, after: onBack(), front: [1, 0, 0] };
      out.push(slung);
    }
  }
  const s = gear.offhand;
  const shield = s && shieldOf(s.id, !!s.dye);
  if (s && shield) {
    const P = gearPalette(pal, s);
    const rare = s.rare || undefined, seed = DRESSED.indexOf('offhand') + 1;
    if (!busy && !(arm && arm.carry === 'bow')) {
      // On the left forearm, its face out to the left and a little forward, where it reads from the front.
      const n = unit([-0.62, 0.78, 0]);
      const xf = framed(b.elbow0, [n[0] * 0.78, n[1] * 0.78, -1.25], cross([0, 0, 1], n), [0, 0, 1], n);
      out.push({ mesh: shield, xf, bias: 0.06, pal: P, rare, seed, front: [0, 0, 1], after: [...(named.get('lower0') ?? []), ...put.filter((p) => p.on === 'lower0').map((p) => p.part)] });
    } else {
      const xf = framed(b.chest, [0, BACK_SHIELD, 0.55], [1, 0, 0], [0, 0, 1], [0, -1, 0]);
      out.push({ mesh: shield, xf, bias: 0.07, pal: P, rare, seed, after: [...onBack(), ...(slung ? [slung] : [])], front: [0, 0, 1] });
    }
  }
}

function partsOf(kit: Kit, r: Rig, b: Bones, gear?: GearLook, pal?: Palette): Part[] {
  // Each of the body's parts under a name, for gear to go on over or take the place of.
  const named = new Map<string, Part[]>();
  const name = (key: string, p: Part): Part => {
    const list = named.get(key);
    if (list) list.push(p);
    else named.set(key, [p]);
    return p;
  };
  const skirt = name('skirt', { mesh: kit.skirt, xf: b.pelvis, v: skirtBent(kit, r), bias: 0.15 });
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
      name(`upper${k}`, { mesh: kit.upper, xf: b[`arm${k}`], bias: 0, convex: true }),
      name(`lower${k}`, { mesh: kit.lower, xf: b[`elbow${k}`], bias: 0.02 }),
      name(`hand${k}`, { mesh: r.open[k] ? kit.open[k] : kit.hands[k], xf: b[`wrist${k}`], bias: 0.03 }),
      name(`thigh${k}`, { mesh: kit.thigh, xf: b[`hip${k}`], bias: 0, convex: true }),
      name(`shin${k}`, { mesh: kit.shin, xf: b[`knee${k}`], bias: 0, convex: true }),
      name(`boot${k}`, { mesh: kit.boot, xf: b[`knee${k}`], bias: 0.01, convex: true }),
      name(`foot${k}`, { mesh: kit.foot, xf: b[`ankle${k}`], bias: 0.02 }),
    );
  }
  return gear && pal ? dress(parts, named, kit, r, b, gear, pal) : parts;
}

interface View {
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
function viewOf(facing: number): View {
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
  d: number[];
  key: number;
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
  mail: { a: 0.2, b: 0.2, px: 2.7 },
  scale: { a: 0.46, b: 0.4, px: 3.8 },
  quilt: { a: 0.42, b: 9, px: 3.4 },
  lames: { a: 9, b: 0.5, px: 3.6 },
  grain: { a: 9, b: 0.35, px: 3 },
};

/**
 * The patterns on the facets of one part just filled: each clipped to its
 * facet and drawn through the facet's corners, so it lies on the surface and
 * turns with it -- a mail row runs round a sleeve, a lame across a skirt of
 * plate -- in a dark and a light shade of the facet's own colour at its own
 * light. A four-cornered facet only, which is every band of a ring or a
 * chain; the ends are left plain.
 */
function worked(g: CanvasRenderingContext2D, l: Laid, faces: number[], P: Palette, px: number): void {
  const f = l.part.mesh.f;
  const v = l.part.mesh.v;
  for (const fi of faces) {
    const face = f[fi];
    if (!face.pat || face.i.length !== 4) continue;
    const [i0, i1, i2, i3] = face.i;
    let [s0, s1, s2, s3] = [l.s[i0], l.s[i1], l.s[i2], l.s[i3]];
    const across = (Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) + Math.hypot(s2[0] - s3[0], s2[1] - s3[1])) / 2 / px;
    const up = (Math.hypot(s3[0] - s0[0], s3[1] - s0[1]) + Math.hypot(s2[0] - s1[0], s2[1] - s1[1])) / 2 / px;
    const cut = PATTERN[face.pat];
    const W = (dist(v[i0], v[i1]) + dist(v[i3], v[i2])) / 2, H = (dist(v[i0], v[i3]) + dist(v[i1], v[i2])) / 2;
    const cols = Math.floor(Math.min(W / cut.a, across / cut.px));
    const rows = Math.floor(Math.min(H / cut.b, up / cut.px));
    if ((cut.a < 9 && cols < 2) || (cut.b < 9 && rows < 2)) continue;
    // Up the facet is up the screen, whichever way round the mesh was cut: scales overlap downward.
    if ((s3[1] + s2[1]) / 2 > (s0[1] + s1[1]) / 2) [s0, s1, s2, s3] = [s3, s2, s1, s0];
    const at = (a: number, b: number): Pt => {
      const x0 = s0[0] + (s1[0] - s0[0]) * a, y0 = s0[1] + (s1[1] - s0[1]) * a;
      const x1 = s3[0] + (s2[0] - s3[0]) * a, y1 = s3[1] + (s2[1] - s3[1]) * a;
      return [x0 + (x1 - x0) * b, y0 + (y1 - y0) * b];
    };
    const k = l.k[fi];
    const dark = new Path2D(), lit = new Path2D();
    const seg = (path: Path2D, pts: Pt[]): void => {
      path.moveTo(pts[0][0], pts[0][1]);
      for (let q = 1; q < pts.length; q++) path.lineTo(pts[q][0], pts[q][1]);
    };
    const curve = (path: Path2D, a0: number, b0: number, ac: number, bc: number, a1: number, b1: number): void => {
      const p0 = at(a0, b0), c = at(ac, bc), p1 = at(a1, b1);
      path.moveTo(p0[0], p0[1]);
      path.quadraticCurveTo(c[0], c[1], p1[0], p1[1]);
    };
    if (face.pat === 'mail') {
      // Rows of rings, every other row half a ring along: each ring the bottom of a loop, its top caught by the row above.
      const da = 1 / cols, db = 1 / rows;
      for (let r = 0; r < rows; r++) {
        const b = (r + 0.5) * db;
        for (let c = -1; c <= cols; c++) {
          const a = (c + 0.5 + (r % 2) * 0.5) * da;
          curve(dark, a - 0.5 * da, b + 0.32 * db, a, b - 0.5 * db, a + 0.5 * da, b + 0.32 * db);
          curve(lit, a - 0.3 * da, b + 0.02 * db, a, b - 0.2 * db, a + 0.3 * da, b + 0.02 * db);
        }
      }
    } else if (face.pat === 'scale') {
      // Courses laid from the bottom up, each scale's rounded foot over the tops of the course below.
      const da = 1 / cols, db = 1 / rows;
      for (let r = 0; r < rows; r++) {
        const b = r * db;
        for (let c = -1; c <= cols; c++) {
          const a = (c + (r % 2) * 0.5) * da;
          curve(dark, a, b + 0.9 * db, a + 0.5 * da, b - 0.35 * db, a + da, b + 0.9 * db);
          curve(lit, a + 0.2 * da, b + 0.22 * db, a + 0.5 * da, b + 0.02 * db, a + 0.8 * da, b + 0.22 * db);
        }
      }
    } else if (face.pat === 'quilt') {
      // The channels a padded coat is stitched in, running down it, each with the puff of its wadding beside it.
      for (let c = 1; c < cols; c++) {
        const a = c / cols;
        seg(dark, [at(a, 0), at(a, 1)]);
        seg(lit, [at(a + 0.16 / cols, 0), at(a + 0.16 / cols, 1)]);
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
}

/* ---- rare gear --------------------------------------------------------------------- */

/**
 * The shine on rare gear, worn.
 *
 * On the ground a rare thing sheds motes and a bloom (`drawShine`); on a body
 * that would wash the whole figure in one colour and bury the pieces that are
 * rare under it. So what is rare carries its light on itself, clipped to its
 * own outline, in the colour its rarity is written in, and more of it the
 * rarer it is:
 *
 *   rare        tinted blue, and a slow glint across it now and again
 *   supreme     tinted violet, breathing, and a quicker, brighter glint
 *   fantastic   tinted gold, breathing, a glint more often still, and stars
 *               that open on it here and there as the glint goes by
 *
 * Everything of one rarity on a body shines as one: one tint, and one glint
 * that crosses all of it together, so a rare set reads as a set rather than
 * as a dozen things twinkling out of step. The colours are read off
 * `RARITIES`, like the ground's, so the list, the ground and the body all say
 * the same colour for the same word.
 */
const GLINT = [
  null,
  { period: 3.2, band: 0.18, core: 0.62, tint: 0.11, breathe: 0, stars: 0 },
  { period: 2.6, band: 0.22, core: 0.72, tint: 0.16, breathe: 0.4, stars: 0 },
  { period: 2.0, band: 0.26, core: 0.86, tint: 0.2, breathe: 0.4, stars: 2 },
] as const;

const rarityRgb = (rare: number): RGB => hex(rarityOf({ rare }).colour);
/** A rarity's ink pushed away from grey, as the ground's shine does: the pastel blue a real blue, the lilac a violet. */
const deepened = (c: RGB, spread = 2): RGB => {
  const top = Math.max(c[0], c[1], c[2]);
  return [top - (top - c[0]) * spread, top - (top - c[1]) * spread, top - (top - c[2]) * spread].map((x) => Math.max(0, x)) as RGB;
};
const rgba = (k: RGB, a: number): string => `rgba(${Math.round(k[0])}, ${Math.round(k[1])}, ${Math.round(k[2])}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;

function shineOn(g: CanvasRenderingContext2D, laid: Laid[], now: number): void {
  const groups = new Map<number, { path: Path2D; x0: number; y0: number; x1: number; y1: number; spots: Pt[]; seed: number }>();
  for (const l of laid) {
    const rare = l.part.rare;
    if (!rare || !GLINT[rare]) continue;
    let p = groups.get(rare);
    if (!p) { p = { path: new Path2D(), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, spots: [], seed: 0 }; groups.set(rare, p); }
    p.seed += l.part.seed ?? 0;
    const f = l.part.mesh.f;
    for (let fi = 0; fi < f.length; fi++) {
      if (!l.vis[fi] || f[fi].decal) continue;
      const idx = f[fi].i;
      let cx = 0, cy = 0;
      p.path.moveTo(l.s[idx[0]][0], l.s[idx[0]][1]);
      for (let q = 1; q < idx.length; q++) p.path.lineTo(l.s[idx[q]][0], l.s[idx[q]][1]);
      p.path.closePath();
      for (const i of idx) {
        const [x, y] = l.s[i];
        cx += x / idx.length;
        cy += y / idx.length;
        if (x < p.x0) p.x0 = x;
        if (y < p.y0) p.y0 = y;
        if (x > p.x1) p.x1 = x;
        if (y > p.y1) p.y1 = y;
      }
      p.spots.push([cx, cy]);
    }
  }
  for (const [rare, p] of groups) {
    const look = GLINT[rare];
    if (!look || p.x1 < p.x0) continue;
    const c = rarityRgb(rare), deep = deepened(c);
    const w = p.x1 - p.x0, h = p.y1 - p.y0;
    const t = (((now + p.seed * 0.13) / look.period) % 1 + 1) % 1;
    g.save();
    g.clip(p.path);
    // The tint: the pieces take their rarity's hue, keeping their own light and shade.
    const breath = 1 - look.breathe * (0.5 + 0.5 * Math.sin((now * TAU) / 3.1 + p.seed));
    g.globalCompositeOperation = 'color';
    g.fillStyle = rgba(deep, look.tint * breath);
    g.fillRect(p.x0 - 1, p.y0 - 1, w + 2, h + 2);
    // The glint: across all of it from upper left to lower right over the first half of the cycle, and gone the rest.
    g.globalCompositeOperation = 'lighter';
    if (t < 0.5) {
      const u = t / 0.5;
      const span = Math.max(w, h) + 1e-6;
      const grad = g.createLinearGradient(p.x0 - span * 0.25, p.y0 - span * 0.25, p.x1 + span * 0.25, p.y1 + span * 0.25);
      const at = 0.08 + u * 0.84, hw = look.band / 2;
      grad.addColorStop(Math.max(0, at - hw), rgba(deep, 0));
      grad.addColorStop(Math.max(0, at - hw * 0.35), rgba(deep, look.core * 0.55));
      grad.addColorStop(at, rgba([255, 252, 244], look.core));
      grad.addColorStop(Math.min(1, at + hw * 0.35), rgba(c, look.core * 0.5));
      grad.addColorStop(Math.min(1, at + hw), rgba(c, 0));
      g.fillStyle = grad;
      g.fillRect(p.x0 - 1, p.y0 - 1, w + 2, h + 2);
    }
    g.restore();
    // And the fantastic one's stars, each opening on a spot of it and closing again, a new spot each time round.
    for (let k = 0; k < look.stars && p.spots.length; k++) {
      const cyc = (now + p.seed * 0.13) / look.period + k / look.stars;
      const u = ((cyc % 1) + 1) % 1;
      if (u > 0.4) continue;
      const life = Math.sin((u / 0.4) * Math.PI);
      const n = Math.floor(cyc) * 7919 + k * 104729 + p.seed * 31;
      const [sx, sy] = p.spots[((n % p.spots.length) + p.spots.length) % p.spots.length];
      const r = Math.max(2.2, Math.min(5.5, Math.max(w, h) * 0.09)) * (0.45 + life * 0.55);
      g.save();
      g.translate(sx, sy);
      g.rotate(now * 0.9 + k);
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = rgba(deep, 0.7 * life);
      fourPoint(g, r, r * 0.2);
      g.fill();
      g.fillStyle = rgba([255, 250, 236], 0.9 * life);
      fourPoint(g, r * 0.5, r * 0.12);
      g.fill();
      g.restore();
    }
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

/**
 * Put the parts on the screen. Each is sorted into place by how near its
 * middle is along the ground -- which is what puts the near arm in front of
 * the body and the far one behind it -- and its facets among themselves by
 * how near each is. The outside of the whole is inked first, fattened, so
 * only its rim shows; then each part in turn, and a line along every edge
 * of it that turns away from the viewer, which is what draws an arm over a
 * chest.
 */
function render(g: CanvasRenderingContext2D, parts: Part[], pal: Palette, view: View, ink: number, px: number, now = 0): void {
  const { ex, ey, T, L, H } = view;
  const laid: Laid[] = parts.map((part) => {
    const pv = (part.v ?? part.mesh.v).map((p) => place(part.xf, p));
    const s = pv.map((p): Pt => [p[0] * ex[0] + p[1] * ey[0], p[0] * ex[1] + p[1] * ey[1] - p[2] * HEIGHT_SCALE]);
    const vis: boolean[] = [], k: number[] = [], d: number[] = [];
    const tests = (part.hide ?? []).map((solid) => behind(part.hideIn ?? part.xf, solid, T));
    const hidden = tests.length ? (p: V3): boolean => tests.some((t) => t(p)) : undefined;
    for (const face of part.mesh.f) {
      const pts = face.i.map((i) => pv[i]);
      const n = newell(pts);
      const l = Math.hypot(n[0], n[1], n[2]);
      const u: V3 = l > 1e-9 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0];
      let cx = 0, cy = 0, cz = 0;
      for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
      const c: V3 = [cx / pts.length, cy / pts.length, cz / pts.length];
      const off = face.unless && mv(part.xf.m, face.unless);
      vis.push(l > 1e-9 && u[0] * T[0] + u[1] * T[1] + u[2] * T[2] > 1e-4 && !(hidden && hidden(face.at ? place(part.xf, face.at) : c)) && !(off && off[0] * T[0] + off[1] * T[1] + off[2] * T[2] > 0.05));
      k.push(lightOn(u, L));
      d.push(c[0] * T[0] + c[1] * T[1] + c[2] * T[2]);
    }
    let cx = 0, cy = 0, cz = 0;
    for (const p of pv) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= pv.length; cy /= pv.length; cz /= pv.length;
    return { part, s, vis, k, d, key: cx * H[0] + cy * H[1] + cz * 0.02 + part.bias };
  });
  for (const l of laid) {
    const leads = l.part.after ? (Array.isArray(l.part.after) ? l.part.after : [l.part.after]) : [];
    const keys = leads.map((p) => laid.find((m) => m.part === p)?.key).filter((x): x is number => x !== undefined);
    if (!keys.length) continue;
    const fw = l.part.front && mv(l.part.xf.m, l.part.front);
    if (!fw || fw[0] * T[0] + fw[1] * T[1] + fw[2] * T[2] > -1 / 3) l.key = Math.max(...keys) + l.part.bias;
    else l.key = Math.min(l.key, Math.min(...keys) - l.part.bias);
  }
  for (const l of laid) {
    const top = l.part.under && laid.find((m) => m.part === l.part.under);
    if (top) l.key = Math.min(l.key, top.key - 0.001);
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
  const inks = {} as Record<Mat, string>;
  for (const m of Object.keys(pal) as Mat[]) inks[m] = shade(inkOf(pal[m]), 1);
  // A piece of gear is in colours of its own, and inked in a dark shade of each of them.
  const palOf = (l: Laid): Palette => l.part.pal ?? pal;
  const partInks = new Map<Palette, Partial<Record<Mat, string>>>();
  const inkIn = (l: Laid, m: Mat): string => {
    const P = l.part.pal;
    if (!P) return inks[m];
    let c = partInks.get(P);
    if (!c) { c = {}; partInks.set(P, c); }
    return (c[m] ??= shade(inkOf(P[m]), 1));
  };
  const grow = 0.5 * px;
  const add = (path: Path2D, l: Laid, fi: number, fat = grow): void => {
    const idx = l.part.mesh.f[fi].i;
    const n = idx.length;
    if (!fat) {
      path.moveTo(l.s[idx[0]][0], l.s[idx[0]][1]);
      for (let q = 1; q < n; q++) path.lineTo(l.s[idx[q]][0], l.s[idx[q]][1]);
      path.closePath();
      return;
    }
    // Which way round it goes on the screen, so "out" is out.
    let area = 0;
    for (let q = 0; q < n; q++) {
      const a = l.s[idx[q]], b = l.s[idx[(q + 1) % n]];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const turn = area < 0 ? -1 : 1;
    const out = (a: Pt, b: Pt): Pt => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy);
      return dl > 1e-9 ? [(dy / dl) * turn, (-dx / dl) * turn] : [0, 0];
    };
    for (let q = 0; q < n; q++) {
      const p = l.s[idx[(q + n - 1) % n]], v = l.s[idx[q]], nx = l.s[idx[(q + 1) % n]];
      let n1 = out(p, v), n2 = out(v, nx);
      if (!n1[0] && !n1[1]) n1 = n2;
      if (!n2[0] && !n2[1]) n2 = n1;
      // The mitre: both neighbouring edges pushed out by `fat`, where they meet; never more than three times as far.
      const k = Math.min(3, 1 / Math.max(1e-3, 1 + n1[0] * n2[0] + n1[1] * n2[1])) * fat;
      const x = v[0] + (n1[0] + n2[0]) * k, y = v[1] + (n1[1] + n2[1]) * k;
      if (q === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
  };
  // Where a facet that is seen meets one that is not, or nothing: the lines round a part, and along it where it turns away.
  const edgesOf = (l: Laid): Array<[number, number, number]> => {
    const f = l.part.mesh.f;
    const out: Array<[number, number, number]> = [];
    for (const [a, b, f1, f2] of l.part.mesh.e) {
      const v1 = l.vis[f1], v2 = f2 >= 0 ? l.vis[f2] : false;
      if (v1 === v2 || (f2 < 0 && f[f1].soft)) continue;
      // A shave or a shadow of beard is colour on the skin, not a thing on it, and is not inked; nor is a seam.
      const seen = f[v1 ? f1 : f2];
      if (seen.m === 'stubble' || seen.m === 'shaved' || seen.seam || (seen.fine && seen.fine * Math.SQRT2 * SX < Math.max(2 * ink, 4 * px))) continue;
      out.push([a, b, v1 ? f1 : f2]);
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
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const edges = laid.map(edgesOf);
  // The outline: every part's own outline in its ink, fattened, so that only a rim shows round the outside once the facets go over it.
  laid.forEach((l, li) => { for (const [a, b, fi] of edges[li]) line(l, a, b, fi); });
  flush(ink * 2, false);
  laid.forEach((l, li) => {
    const f = l.part.mesh.f;
    const shown: number[] = [];
    for (let fi = 0; fi < f.length; fi++) if (l.vis[fi] && !f[fi].decal) shown.push(fi);
    const P = palOf(l);
    if (l.part.convex) {
      for (const fi of shown) add(into(shade(P[f[fi].m], l.k[fi])), l, fi);
      flush(0, true);
      worked(g, l, shown, P, px);
      for (const [a, b, fi] of edges[li]) line(l, a, b, fi);
      flush(ink * 0.6, false);
    } else {
      // Far to near, a run of one shade at a time, and after each run the lines along its edges.
      const mine = new Map<number, Array<[number, number]>>();
      for (const [a, b, fi] of edges[li]) {
        const list = mine.get(fi);
        if (list) list.push([a, b]);
        else mine.set(fi, [[a, b]]);
      }
      shown.sort((a, b) => l.d[a] - l.d[b]);
      let q = 0;
      while (q < shown.length) {
        const c = shade(P[f[shown[q]].m], l.k[shown[q]]);
        let end = q;
        while (end < shown.length && shade(P[f[shown[end]].m], l.k[shown[end]]) === c) end++;
        for (let r = q; r < end; r++) add(into(c), l, shown[r]);
        flush(0, true);
        worked(g, l, shown.slice(q, end), P, px);
        for (let r = q; r < end; r++) for (const [a, b] of mine.get(shown[r]) ?? []) line(l, a, b, shown[r]);
        flush(ink * 0.6, false);
        q = end;
      }
    }
    // What is painted on: in the order it was laid on, so a glint goes on over its eye.
    for (let fi = 0; fi < f.length; fi++) {
      if (!l.vis[fi] || !f[fi].decal) continue;
      const path = new Path2D();
      add(path, l, fi, 0);
      g.fillStyle = shade(P[f[fi].m], l.k[fi]);
      g.fill(path);
    }
  });
  // And over whatever of it is rare, its shine: see `drawGearShine`.
  if (laid.some((l) => l.part.rare)) shineOn(g, laid, now);
}

const onScreen = (view: View, p: V3): Pt => [p[0] * view.ex[0] + p[1] * view.ey[0], p[0] * view.ex[1] + p[1] * view.ey[1] - p[2] * HEIGHT_SCALE];

/** The reins, from each hand out ahead to where a team would be. */
function reins(g: CanvasRenderingContext2D, b: Bones, view: View, pal: Palette, ink: number): void {
  g.strokeStyle = css(pal.rein);
  g.lineWidth = Math.max(0.55, ink * 0.7);
  for (let k = 0; k < 2; k++) {
    const h = place(b[`wrist${k}`], [0, 0.15, -0.55]);
    const a = onScreen(view, h), z = onScreen(view, [h[0] * 0.4, h[1] + 7.5, h[2] - 3.2]);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.quadraticCurveTo((a[0] + z[0]) / 2, (a[1] + z[1]) / 2 + 1.2, z[0], z[1]);
    g.stroke();
  }
}

/** The water round a swimmer: the far half of the ring before the body goes down, the near half after. */
function ripple(g: CanvasRenderingContext2D, half: 'back' | 'front', phase: number): void {
  g.strokeStyle = 'rgb(255, 255, 255)';
  g.lineWidth = 0.9;
  // Three rings going out from the body and fading as they go, a new one every stroke or so.
  for (let k = 0; k < 3; k++) {
    const u = (((phase * 0.085 + k / 3) % 1) + 1) % 1;
    const rx = 6 + 7 * u;
    g.globalAlpha = 0.62 * Math.pow(1 - u, 1.4);
    g.beginPath();
    if (half === 'back') g.ellipse(0, 0, rx, rx * 0.43, 0, Math.PI, TAU);
    else g.ellipse(0, 0, rx, rx * 0.43, 0, 0, Math.PI);
    g.stroke();
  }
  g.globalAlpha = 1;
}

/**
 * A body with its feet at (sx, sy): the player, and everybody else on the
 * island. `ink` overrides the width of the outline in screen pixels, for a
 * figure drawn big.
 */
export function drawFigure(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: FigurePose, opts: { ink?: number } = {}): void {
  const look = pose.look ?? DEFAULT_LOOK;
  // Cut coarser at the sizes the island is played at: under one and a half, a lock of hair is a pixel or two.
  const kit = kitFor(look, zoom < 1.5 ? 0.5 : 1);
  const now = performance.now() / 1000;
  const { rig: r, facing, changing } = pose.id
    ? settle(pose.id, pose, rigOf(pose, kit.fr), now)
    : { rig: rigOf(pose, kit.fr), facing: ((Math.round(pose.facing) % 8) + 8) % 8, changing: false };
  // Most of a pixel however far out, and never more than three and a half however far in.
  const ink = opts.ink !== undefined ? opts.ink / zoom : Math.max(0.9 / zoom, 0.7);
  if (pose.id && zoom < STILL_BELOW && opts.ink === undefined) {
    drawStill(ctx, sx, sy, zoom, pose, kit, r, facing, changing, ink, now);
    return;
  }
  drawLive(ctx, sx, sy, zoom, pose, kit, r, facing, ink, now);
}

function drawLive(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: FigurePose, kit: Kit, r: Rig, facing: number, ink: number, now: number): void {
  const look = pose.look ?? DEFAULT_LOOK;
  const b = skeleton(kit.fr, r);
  const view = viewOf(facing);
  const pal = paletteOf(pose, look);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  if (pose.swimming) {
    ripple(ctx, 'back', pose.phase);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-60, -120, 120, 120.4);
    ctx.clip();
  }
  render(ctx, partsOf(kit, r, b, pose.gear, pal), pal, view, ink, 1 / zoom, now);
  if (pose.swimming) {
    ctx.restore();
    ripple(ctx, 'front', pose.phase);
  }
  if (r.reins) reins(ctx, b, view, pal, ink);
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
 * Only at the sizes the island is usually played at. Closer in there are
 * few enough people on the screen, and each big enough to see it hitch,
 * that they are drawn every frame.
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
  let st = stills.get(id);
  if (now - lately.since > 0.25 || now < lately.since) {
    lately.count = lately.ids.size;
    lately.ids.clear();
    lately.since = now;
  }
  lately.ids.add(id);
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
  ctx.drawImage(st.canvas, sx - st.ox / st.dev, sy - st.oy / st.dev, st.canvas.width / st.dev, st.canvas.height / st.dev);
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
  else idle(r, t);
  const b = skeleton(kit.fr, r);
  const parts = partsOf(kit, r, b).filter((p) => p.xf === b.head || p.xf === b.neck || p.xf === b.chest || p.mesh === kit.upper || kit.hair.tails.some((t) => t.mesh === p.mesh));
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
