import { emotePose } from '../game/emotes';
import {
  BUILDS, DEFAULT_LOOK, eyeColour, hairColour, shirtColour, skinColour, trouserColour, type Look,
} from '../game/look';
import { HALF_H, HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from './iso';

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

type V3 = [number, number, number];
type RGB = [number, number, number];
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
interface Xf { m: M3; t: V3 }
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
type Mat = 'skin' | 'lip' | 'hair' | 'brow' | 'eye' | 'glint' | 'tunic' | 'trim' | 'trousers' | 'boot' | 'cuff' | 'sole' | 'belt' | 'buckle' | 'stubble' | 'rein' | 'haft' | 'iron';

interface Face {
  /** Corners, anticlockwise seen from outside. */
  i: number[];
  m: Mat;
  /** Painted on the face under it rather than a surface of its own: no outline, and drawn after the rest of its part. */
  decal?: boolean;
  /** Part of a surface rather than an edge of one: its open rim is not inked. A nose is not outlined where it meets the face. */
  soft?: boolean;
  /** Only while this way, in the mesh's own frame, is not toward the viewer: an eye seen side on, drawn only when the face is not. */
  unless?: V3;
}

interface Mesh {
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
interface Frame {
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
 * forward]. Chin, jaw, cheekbones, temples, and two rings rounding the crown;
 * the face is the lower half, the eyes on the middle line.
 */
function headRings(fr: Frame): number[][] {
  const jaw = 1.06 - fr.fem * 0.14;
  return [
    [0.42, 0.6 * jaw, 0.46, 0, 0.62],
    [0.82, 1.04 * jaw, 1.06, 0, 0.4],
    [1.3, 1.37, 1.42, 0, 0.18],
    [2, 1.43, 1.52, 0, 0.08],
    [2.75, 1.22, 1.38, 0, -0.02],
    [3.2, 0.64, 0.78, 0, -0.08],
  ];
}
const CROWN = 3.34;

/**
 * The head is made at one size and then scaled up to the one it is drawn at,
 * hair, beard, face and all, so every haircut sits on the skull it was cut
 * for whatever size heads end up.
 */
const HEAD_SIZE: V3 = [1.12, 1.12, 1.13];
const bigger = (p: V3): V3 => [p[0] * HEAD_SIZE[0], p[1] * HEAD_SIZE[1], p[2] * HEAD_SIZE[2] + 0.03];
const grown = (m: Mesh): Mesh => ({ v: m.v.map(bigger), f: m.f, e: m.e });

/** The skull as a solid, a little inside the facets, for what lies on it to be hidden behind. */
const SKULL = { c: bigger([0, 0.1, 1.9]), r: [1.28 * HEAD_SIZE[0], 1.38 * HEAD_SIZE[1], 1.42 * HEAD_SIZE[2]] as V3 };

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

/** The ears: a flattened ball each side, half sunk into the head. */
const earsOf = (fr: Frame): Mesh =>
  join(...[-1, 1].map((s) => ball([s * 1.3, -0.1, 1.5], [0.15, 0.2, 0.3], fr.lod < 1 ? 4 : 5, fr.lod < 1 ? 2 : 3, 'skin')));

/**
 * A head: eight facets round, a jaw that narrows to the chin, a nose,
 * and the face painted on -- eyes, brows and a mouth -- so that it goes out
 * of sight when the front does. The eyes sit on the corners where the face
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
  // The nose: a wedge on the front facet, lit down one side and shaded down the other.
  const nb = v.length;
  v.push([0, 1.5, 1.58], [-0.15, 1.5, 1.18], [0.15, 1.5, 1.18], [0, 1.84, 1.23]);
  for (const [i, want] of [[[nb, nb + 1, nb + 3], [-1, 0.6, 0.3]], [[nb, nb + 3, nb + 2], [1, 0.6, 0.3]], [[nb + 1, nb + 2, nb + 3], [0, 0.4, -1]]] as Array<[number[], V3]>) {
    f.push({ ...faceOut(v, i, want, 'skin'), soft: true });
  }
  const face = mesh(v, f);
  // An eye is a dark almond with a catch of light in it, or a lid when it blinks.
  // Mostly on the front of the face, wrapping a little round the corner: from three-quarters the far eye is still on the face.
  const eye: Pt[] = (blink
    ? [[-0.16, 1.5], [0.15, 1.52], [0.15, 1.55], [-0.16, 1.53]]
    : [[-0.16, 1.54], [-0.09, 1.66], [0.06, 1.67], [0.15, 1.57], [0.07, 1.44], [-0.09, 1.44]]).map(([u, z]) => [u - 0.11, z]);
  const brow: Pt[] = [[-0.33, 1.8], [0.08, 1.82], [0.1, 1.87], [-0.15, 1.91], [-0.34, 1.86]];
  const mouth = (w: number, z: number, y: number): V3[] => [
    [-w, y, z + 0.03], [0, y + 0.02, z - 0.03], [w, y, z + 0.03], [w * 0.8, y, z + 0.055], [0, y + 0.02, z + 0.01], [-w * 0.8, y, z + 0.055],
  ];
  const marks = [
    ...[-1, 1].flatMap((s) => [
      ...faceMarks(fr, s, eye, 'eye'),
      ...faceMarks(fr, s, brow, 'brow'),
      ...(blink ? [] : faceMarks(fr, s, [[-0.21, 1.6], [-0.16, 1.62], [-0.16, 1.575], [-0.21, 1.56]], 'glint')),
      // Side on the front of the face is edge-on and its eyes with it, so the cheek carries the eye then.
      ...faceMarks(fr, s, blink ? [[0.01, 1.5], [0.13, 1.52], [0.13, 1.55], [0.01, 1.53]] : [[0.01, 1.45], [0.12, 1.47], [0.13, 1.64], [0.01, 1.66]], 'eye')
        .map((d) => ({ ...d, unless: [0, 1, 0] as V3 })),
    ]),
    { q: mouth(0.21 - fr.fem * 0.03, 1, 1.45), m: 'lip' as Mat },
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
    return [Math.cos(a) * (rxx + l), cy + Math.sin(a) * (ryy + l), z + l * t * t * 0.7];
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
 * sideburn comes down in front of each ear. The ears are 1.2 to 1.8 up the
 * head and the brows 1.9, so a line over the ears at 1.95 leaves them out
 * and one at 1.3 covers them.
 */
const hairline = (brow: number, corner: number, ear: number, nape: number, burn = 0) => (a: number): number => {
  // Round from the middle of the face: nought there, a quarter turn at the ears, a half at the nape.
  const f = Math.abs(Math.atan2(Math.cos(a), Math.sin(a)));
  const knots: Array<[number, number]> = [[0, brow], [0.62, corner], [Math.PI / 2, ear], [Math.PI, nape]];
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
  ridge?: number;
  tip?: number;
  hangs?: boolean;
  rows?: number;
  mat?: Mat;
}

function sweep(fr: Frame, s: Sweep): Mesh {
  const P = unit(s.pole);
  const zp = dot(s.zero, P);
  const e1 = unit([s.zero[0] - P[0] * zp, s.zero[1] - P[1] * zp, s.zero[2] - P[2] * zp]);
  const e2 = cross(P, e1);
  const dir = (lam: number, mu: number): V3 => {
    const c = Math.cos(mu), sn = Math.sin(mu), cl = Math.cos(lam), sl = Math.sin(lam);
    return [c * P[0] + sn * (cl * e1[0] + sl * e2[0]), c * P[1] + sn * (cl * e1[1] + sl * e2[1]), c * P[2] + sn * (cl * e1[2] + sl * e2[2])];
  };
  const [l0, l1] = s.round;
  const whole = Math.abs(l1 - l0 - TAU) < 1e-6;
  // Locks in fours at the finest, so one lies down the middle of the brow; in fours still when cut coarser.
  const n = fr.lod < 1 ? cut(fr, s.round[2], 8, 4) : s.round[2];
  const cols = whole ? n : n + 1;
  const rows = fr.lod < 1 ? cut(fr, s.rows ?? 5, 3) : s.rows ?? 5;
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
  const v: V3[] = [];
  /*
   * Hair grown from a point does not start at the point: every lock meeting
   * there would make a star of slivers and ink. It starts a little way out,
   * on a ring, and the ring is closed with one facet -- the crown of the
   * head, or the knot of hair where it is tied.
   */
  const whorl = s.part === undefined && s.bare === undefined;
  for (let j = 0; j < cols; j++) {
    const lam = l0 + ((l1 - l0) * j) / n;
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
    const odd = j % 2 === 1;
    const live = Math.abs(mu1 - mu0) > 0.04;
    // A pointed lock runs on past the hairline by `tip`, as an angle at its distance from the middle.
    const past = live && odd && s.tip ? (s.tip / Math.max(0.6, reach(fr, dir(lam, mu1)))) * way : 0;
    for (let k = 0; k <= rows; k++) {
      const t = k / rows;
      const mu = mu0 + (mu1 + past - mu0) * t;
      const proud = odd && s.ridge ? s.ridge * Math.sin(Math.PI * Math.min(1, t * 1.1)) : 0;
      v.push(over(fr, dir(lam, mu), live ? s.loft(t, lam) + proud : 0, s.hangs));
    }
  }
  const f: Face[] = [];
  const m = s.mat ?? 'hair';
  const R = rows + 1;
  for (let j = 0; j < n; j++) {
    const j2 = whole ? (j + 1) % n : j + 1;
    for (let k = 0; k < rows; k++) {
      const q = [j * R + k, j * R + k + 1, j2 * R + k + 1, j2 * R + k];
      const c = middle(q.map((i) => v[i]));
      // The last row, where the hair meets the skin, a shade darker: its underside, and what keeps fair hair from running into a fair face.
      f.push(faceOut(v, q, [c[0] - MID[0], c[1] - MID[1], c[2] - MID[2]], k === rows - 1 && m === 'hair' ? 'brow' : m));
    }
  }
  if (whorl) {
    const ring = Array.from({ length: cols }, (_, j) => j * R);
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
}

function hang(fr: Frame, h: Hang): Mesh {
  const [a0, a1] = h.round;
  const n = fr.lod < 1 ? cut(fr, h.round[2], 8, 2) : h.round[2];
  const rows = fr.lod < 1 ? cut(fr, h.rows ?? 4, 2) : h.rows ?? 4;
  const [t0, t1] = h.span ?? [0, 1];
  const [rxx, ryy, cy] = skull(fr, h.top);
  const v: V3[] = [];
  for (let j = 0; j <= n; j++) {
    const a = a0 + ((a1 - a0) * j) / n;
    const odd = j % 2 === 1;
    const bottom = h.to(a) - (odd && h.tip ? h.tip : 0);
    for (let k = 0; k <= rows; k++) {
      const t = t0 + ((t1 - t0) * k) / rows;
      const out = h.out + h.flare * Math.sin((t * Math.PI) / 2) + (odd && h.ridge ? h.ridge * Math.sin(Math.PI * Math.min(1, t * 1.1)) : 0);
      const sw = h.wave ? h.wave[0] * Math.sin(t * h.wave[1] * Math.PI) * Math.min(1, t * 3) : 0;
      v.push([
        Math.cos(a) * (rxx + out) - Math.sin(a) * sw,
        cy + Math.sin(a) * (ryy + out) + Math.cos(a) * sw,
        h.top + (bottom - h.top) * t,
      ]);
    }
  }
  const f: Face[] = [];
  const R = rows + 1;
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < rows; k++) {
      const q = [j * R + k, j * R + k + 1, (j + 1) * R + k + 1, (j + 1) * R + k];
      const c = middle(q.map((i) => v[i]));
      f.push(faceOut(v, q, [c[0], c[1] - cy, 0], 'hair'));
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
  const crown = (o: Lay, round: [number, number] = [0, TAU]): Mesh =>
    sweep(fr, { pole: [0, -0.15, 1], zero: [1, 0, 0], round: [round[0], round[1], o.n ?? 16], ...o });
  // Combed to one place: the back of the head, a tie, a knot.
  const toward = (pole: V3, o: Lay): Mesh => sweep(fr, { pole, zero: [1, 0, 0], round: [0, TAU, o.n ?? 16], ...o });
  /*
   * Parted at `x` across the head, each side lying away from the parting
   * toward a pole low on its own side. The parting runs from the brow to the
   * crown, and behind that the hair falls from the crown -- unless it goes
   * `through` to the nape, as it does for two braids.
   */
  const parted = (x: number, drop: number, o: Omit<Lay, 'part'> & { back?: number; through?: boolean }): Mesh => join(
    ...[1, -1].map((s) => sweep(fr, {
      pole: [s, -(o.back ?? 0), -drop], zero: [0, 1, 0], round: [-0.25 * s, (o.through ? Math.PI + 0.7 : 1.75) * s, o.n ?? 12], part: x, ...o,
    })),
    ...(o.through ? [] : [crown({ ...o, part: undefined, n: 8, tip: o.tip }, [Math.PI, TAU])]),
  );
  // Shaved close: the hair's own colour over the skin, up to `top`, or all over.
  const shaved = (top?: number): Mesh =>
    shell(fr, { lo: hairline(2.55, 2.35, 2, 1, 0.3), hi: top === undefined ? undefined : () => top, loft: () => 0.05, mat: 'stubble', n: 16, rows: top === undefined ? 5 : 3 });
  // Tied back tight, clear of the ears, with a little lift over the forehead where it is drawn back from the face.
  const TIED = hairline(2.45, 2.25, 1.97, 1.05, 0.28);
  const tied = (t: number, lam: number): number => 0.08 + 0.08 * (1 - t) + 0.1 * Math.max(0, Math.sin(lam)) * Math.sin(Math.PI * ramp(t, 0.55, 1));
  switch (id) {
    case 'bald':
      return { tails };
    case 'crop':
      // A textured crop, faded at the sides: short points brushed forward over a close back and sides.
      return {
        cap: join(
          shaved(2.4),
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
    case 'curls':
      // A head of loose curls, rounded clusters of them all over, falling over the brow and the tops of the ears.
      return {
        cap: crown({
          edge: hairline(2.32, 2.1, 1.68, 0.7, 0.15),
          loft: (t, lam) => 0.3 + 0.2 * (0.5 + 0.5 * Math.cos(lam * 8)) * (0.5 + 0.5 * Math.cos(t * Math.PI * 4)) + 0.12 * Math.sin(Math.PI * t),
          ridge: 0.06,
          n: 24,
          rows: 8,
        }),
        tails,
      };
    case 'afro':
      // Rounded and even all over, standing well off the head.
      return {
        cap: crown({
          edge: hairline(2.48, 2.2, 1.62, 0.6),
          // Round: as full over the crown as at the sides, in nine soft lobes, and turning in again at the edge, clear of the forehead.
          loft: (t, lam) => 0.78 + 0.12 * Math.sin(Math.PI * t) + 0.14 * (0.5 + 0.5 * Math.cos(lam * 9)) * Math.sqrt(Math.sin(Math.PI * t))
            - 0.62 * Math.pow(ramp(t, 0.55, 1), 1.6) - 0.42 * Math.pow(Math.max(0, Math.sin(lam)), 1.5) * ramp(t, 0.3, 0.9),
          ridge: 0.04,
          n: 24,
          rows: 8,
        }),
        tails,
      };
    case 'waves':
    case 'long': {
      // Parted in the middle and falling past the ears: to the shoulders in waves, or halfway down the back straight.
      const wavy = id === 'waves';
      const edge = hairline(2.42, 2.08, 0.4, -1);
      const top = 1.12;
      // Longest at the middle of the back, a little shorter toward the front.
      const end = wavy ? -1.2 : -3.2;
      const fall: Hang = {
        round: [0.5, -Math.PI - 0.5, 18],
        top,
        out: 0.2,
        to: (a) => end + (wavy ? 0.35 : 0.7) * (1 + Math.sin(a)),
        flare: wavy ? 0.5 : 0.36,
        wave: wavy ? [0.32, 3.5] : undefined,
        tip: wavy ? 0.4 : 0.5,
        ridge: 0.1,
      };
      // Against the head down to the jaw, and hanging free below it.
      const split = (top - 0.45) / (top - end);
      for (const s of [-1, 1]) {
        // A lock from each temple down in front of the shoulder.
        const len = wavy ? 2.9 : 4.4;
        const pts: V3[] = [];
        const w: number[] = [];
        for (let k = 0; k <= 6; k++) {
          const t = k / 6;
          const sway = wavy ? 0.34 * Math.sin(t * 4 * Math.PI) * Math.min(1, t * 3) : 0;
          // Down the side of the face, then out over the collarbone and down the front.
          pts.push([s * (0.02 + 0.25 * Math.sin(t * Math.PI * 0.6) + sway), 0.05 + 0.95 * ramp(t, 0.25, 0.7), -len * t]);
          w.push(t < 1 ? 0.46 * (1 - t * 0.45) : 0);
        }
        tails.push({ at: [s * 1.38, 0.55, 1.6], mesh: lockOf(pts, w, [s * 0.6, 1, 0]), give: 0.3 });
      }
      return {
        cap: join(
          parted(0, 0.75, { edge, floor: top - 0.08, loft: (t) => 0.14 + 0.14 * Math.sin(Math.PI * t), ridge: 0.08, n: 14 }),
          hang(fr, { ...fall, span: [0, split], rows: 2 }),
        ),
        fall: hang(fr, { ...fall, span: [split, 1], rows: wavy ? 5 : 4 }),
        tails,
      };
    }
    case 'ponytail':
      // Drawn back tight to a tie high on the back of the crown, and a full tail falling from it.
      tails.push({
        at: [0, -1.3, 2.9],
        mesh: join(
          ball([0, -0.1, 0], [0.3, 0.24, 0.24], 6, 3, 'brow'),
          chain([[0, -0.08, 0], [0, -0.45, -0.25], [0, -0.72, -1.1], [0, -0.66, -2.2], [0, -0.5, -3.1], [0, -0.4, -3.5]], [0.3, 0.44, 0.4, 0.3, 0.14, 0.03], 6, 'hair'),
        ),
        give: 1,
      });
      return { cap: toward([0, -0.8, 0.6], { edge: TIED, loft: tied, ridge: 0.09 }), tails };
    case 'topknot':
      // All of it drawn up to a big knot on the crown.
      return {
        cap: toward([0, -0.2, 1], { edge: TIED, loft: tied, ridge: 0.09 }),
        top: join(
          ball([0, -0.25, CROWN + 0.58], [0.72, 0.7, 0.58], cut(fr, 8, 6, 2), cut(fr, 4, 3), 'hair'),
          ball([0, -0.2, CROWN + 0.08], [0.34, 0.34, 0.12], 6, 2, 'brow'),
        ),
        tails,
      };
    case 'bun':
      // Drawn back to a bun low at the back of the head.
      tails.push({ at: [0, -1.55, 1.75], mesh: join(ball([0, -0.28, 0], [0.64, 0.52, 0.6], cut(fr, 8, 6, 2), cut(fr, 4, 3), 'hair'), ball([0, 0.06, 0], [0.4, 0.14, 0.4], 6, 2, 'brow')), give: 0.12 });
      return { cap: toward([0, -1, 0.05], { edge: TIED, loft: tied, ridge: 0.09 }), tails };
    case 'braid':
      // Drawn back to the nape and plaited down the back.
      tails.push({ at: [0, -1.16, 1.12], mesh: braid([[0, 0, 0], [0, -0.3, -1], [0, -0.35, -2.1], [0, -0.3, -3.2], [0, -0.25, -4]], 0.3), give: 0.55 });
      return { cap: toward([0, -1, -0.35], { edge: TIED, loft: tied, ridge: 0.09 }), tails };
    case 'braids':
      // Parted in the middle, each half drawn to a braid behind its ear and brought forward over the shoulder.
      for (const s of [-1, 1]) {
        tails.push({ at: [s * 1.2, -0.45, 1.3], mesh: braid([[0, 0, 0], [s * 0.2, 0.25, -0.9], [s * 0.3, 0.5, -1.9], [s * 0.3, 0.6, -2.8]], 0.28), give: 0.4 });
      }
      return { cap: parted(0, 0.6, { edge: hairline(2.45, 2.25, 1.6, 0.9, 0.2), loft: (t) => 0.08 + 0.06 * t, ridge: 0.05, back: 0.55, through: true }), tails };
    case 'locs':
      // Locs drawn back off the face and hanging to the shoulders.
      // Eleven of them, no two the same length or thickness, each curving out a little over the shoulders as it falls.
      for (let k = 0; k < 11; k++) {
        const a = Math.PI * (1.02 + (k / 10) * 0.96);
        const x = Math.cos(a) * 1.5, y = 0.05 + Math.sin(a) * 1.55;
        const len = 2.5 + ((k * 7) % 5) * 0.28;
        const r = 0.19 + ((k * 3) % 4) * 0.025;
        tails.push({
          at: [x, y, 1.1],
          mesh: chain([[0, 0, 0], [x * 0.06, y * 0.08, -len * 0.35], [x * 0.14, y * 0.16, -len * 0.7], [x * 0.18, y * 0.2, -len]], [r, r * 0.95, r * 0.85, r * 0.45], 5, 'hair'),
          give: 0.4 + (k % 3) * 0.1,
        });
      }
      return { cap: toward([0, -1, 0.25], { edge: hairline(2.4, 2.15, 1.35, 0.6), loft: () => 0.12, ridge: 0.12, n: 24, hangs: true }), tails };
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
  const jaw = (below: number, loft: number, mat: Mat = 'hair'): Mesh => shell(fr, {
    arc: [0.02 * Math.PI, 0.98 * Math.PI],
    lo: (a) => {
      const s = Math.sin(a);
      return 1.25 - (1.25 - below) * Math.pow(s, 0.8);
    },
    hi: (a) => 0.88 + 0.77 * (1 - Math.pow(Math.sin(a), 2)),
    loft: (a) => loft * (0.5 + 0.5 * Math.sin(a)),
    n: 10,
    rows: 3,
    mat,
  });
  const moustache = (): Mesh => chain([[-0.46, 1.36, 1.02], [-0.2, 1.52, 1.14], [0.2, 1.52, 1.14], [0.46, 1.36, 1.02]], [0.07, 0.11, 0.11, 0.07], 4, 'hair');
  switch (id) {
    case 'stubble':
      // A shadow on the skin of the jaw and no further: it stops where the chin does.
      return jaw(0.45, 0.025, 'stubble');
    case 'moustache':
      return moustache();
    case 'goatee':
      return join(moustache(), chain([[0, 1.28, 0.62], [0, 1.2, 0.2], [0, 1.02, -0.2]], [0.22, 0.2, 0.08], 5, 'hair'));
    case 'short':
      return join(jaw(0.28, 0.1), moustache());
    case 'full':
      return join(jaw(-0.25, 0.22), moustache());
    case 'long':
      return join(jaw(-0.25, 0.22), moustache(), chain([[0, 1.05, 0.2], [0, 1.2, -0.9], [0, 1.2, -1.9], [0, 1.05, -2.6]], [0.62, 0.5, 0.3, 0.06], 6, 'hair'));
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
  ears: Mesh;
  hair: HairKit;
  beard?: Mesh;
  upper: Mesh;
  lower: Mesh;
  /** Left and right, each with its thumb on the inside. */
  hands: [Mesh, Mesh];
  /** What is in the right hand while at work. */
  mallet: Mesh;
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
    tails: h.tails.map((t) => ({ at: bigger(t.at), mesh: grown(t.mesh), give: t.give })),
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
    neck: rings([[-0.3, 0.56, 0.52], [0.9, 0.5, 0.47, 0, 0.05]], 6, 'skin', { top: false, bottom: false }),
    head: grown(headMesh(fr, false)),
    blink: grown(headMesh(fr, true)),
    ears: grown(earsOf(fr)),
    hair: grownHair(hairOf(fr, look.hair)),
    beard: beard ? grown(beard) : undefined,
    upper: rings([[0.45, 0.46, 0.48], [0.05, 0.82 * (0.9 + fr.sh * 0.1), 0.8], [-1.5, 0.74, 0.72], [-3.05, 0.65, 0.63]], 6, 'tunic'),
    lower: join(rings([[0.1, 0.57, 0.54], [-2.3, 0.44, 0.41]], 6, 'skin'), rings([[0.25, 0.7, 0.66], [-0.75, 0.66, 0.62]], 6, 'trim')),
    hands: [-1, 1].map((s) => join(
      rings([[0.08, 0.42, 0.27], [-0.5, 0.52, 0.31], [-1.1, 0.38, 0.24]], 6, 'skin'),
      chain([[-s * 0.18, 0.12, -0.22], [-s * 0.26, 0.3, -0.52], [-s * 0.22, 0.36, -0.78]], [0.14, 0.12, 0.07], 4, 'skin'),
    )) as [Mesh, Mesh],
    // A mallet held across the fist: a haft forward out of it and a head across the end.
    mallet: join(
      chain([[0, -0.3, -0.62], [0, 2.3, -0.62]], [0.11, 0.1], 4, 'haft'),
      rings([[-1.3, 0.34, 0.34, 0, 2.3], [0.06, 0.34, 0.34, 0, 2.3]], 4, 'iron'),
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
  /** A mallet in the right hand. */
  tool: boolean;
}

function rest(): Rig {
  return {
    at: [0, 0, 0], pelvis: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    arm: [[4, 8, 0], [4, 8, 0]], elbow: [10, 10], hand: [[0, 0, 0], [0, 0, 0]],
    leg: [[0, 2, 0], [0, 2, 0]], knee: [3, 3], foot: [0, 0], flat: [true, true],
    tail: [0, 0, 0], lift: 0, sink: 0, blink: false, reins: false, tool: false,
  };
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
  r.pelvis = [0, -L(3, 2) * Math.cos(phi), -L(8, 11) * Math.sin(phi)];
  r.spine = [-lean, 0, 0];
  r.chest = [-L(0, 3), L(2, 1) * Math.cos(phi), L(13, 17) * Math.sin(phi)];
  r.neck = [lean * 0.45, 0, -L(4, 5) * Math.sin(phi)];
  r.head = [lean * 0.3, 0, 0];
  r.at = [L(0.16, 0.06) * Math.cos(phi), 0, 0];
  r.lift = g * 1.1 * ramp(Math.abs(Math.sin(phi)), 0.5, 1);
  r.tail = [L(8, 30) + 10 * Math.sin(phi * 2 + 1), 5 * Math.sin(phi), 0];
}

/**
 * At work: the right arm raised and brought down on whatever is in front,
 * the left steadying it, the body bending into each blow and the head
 * down over the job. Slow up, fast down, a jolt through the body at the
 * bottom.
 */
function work(r: Rig, w: number): void {
  const s = (((w / TAU) % 1) + 1) % 1;
  r.tool = true;
  const p = s < 0.6 ? ease(s / 0.6) : s < 0.72 ? 1 - Math.pow((s - 0.6) / 0.12, 2) : 0;
  const jolt = s >= 0.72 && s < 0.9 ? 1 - (s - 0.72) / 0.18 : 0;
  r.arm[1] = [30 + 125 * p, 6 + 10 * p, 0];
  r.elbow[1] = 36 + 56 * p;
  r.arm[0] = [46 + 4 * jolt, -4, 14];
  r.elbow[0] = 70;
  r.spine = [-13 + 10 * p - 3 * jolt, 0, 0];
  r.chest = [0, 0, -6 + 18 * p];
  r.neck = [-8 + 4 * p, 0, 0];
  r.head = [-9, 0, -4 + 4 * p];
  r.leg = [[5, 6, 0], [-3, 6, 0]];
  r.knee = [13, 10];
  r.at = [0, 0, -0.12 * jolt];
}

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

/** A wave with the right hand, raised to the side and swung from the shoulder; or a hop, knees tucked in the air. */
function emote(r: Rig, id: string, t: number): void {
  const e = emotePose(id, t);
  if (id === 'wave') {
    /*
     * The upper arm up and out to the side, turned so the elbow bends in the
     * plane of the body: then the forearm stands straight up over it, and the
     * wave is the forearm swinging side to side from the elbow, well clear of
     * the face. The body leans away a little to lift the shoulder.
     */
    const up = Math.max(0, Math.min(1, t / 0.2, (1 - t) / 0.2));
    const [p, a, w] = r.arm[1];
    r.arm[1] = [p + (145 - p) * up, a * (1 - up), w + (-70 - w) * up];
    r.elbow[1] = r.elbow[1] + (35 - r.elbow[1]) * up + 25 * e.wave;
    r.hand[1] = [0, 0, -30 * up];
    r.chest = [r.chest[0], r.chest[1] - 6 * up, r.chest[2]];
    r.head = [r.head[0] + 4 * up, r.head[1] - 3 * up, r.head[2] - 6 * up];
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

function rigOf(p: FigurePose): Rig {
  const r = rest();
  if (p.swimming) swim(r, p.phase, p.moving);
  else if (p.driving) drive(r, p.phase, p.moving);
  else if (p.moving) walk(r, p.phase, Math.max(0, Math.min(1, p.gait ?? 0)));
  else if (p.working) work(r, p.phase);
  else idle(r, p.phase / 6);
  if (p.emote && !p.swimming && !p.driving) emote(r, p.emote, p.emoteT ?? 0);
  return r;
}

/* ---- one pose into the next -------------------------------------------------- */

/** What a body is doing, as far as blending goes: a change of it is blended. */
const doing = (p: FigurePose): string => (p.swimming ? 'swim' : p.driving ? 'drive' : p.moving ? 'walk' : p.working ? 'work' : 'idle');

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
    flat: b.flat, tail: e(a.tail, b.tail), lift: n(a.lift, b.lift), sink: n(a.sink, b.sink), blink: b.blink, reins: b.reins, tool: b.tool,
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
    b[`arm${k}`] = joint(chest, [s * 2.1 * fr.sh, -0.1, ARM_AT * T], ap, -s * aa, s * at);
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
  const dz = -low * (1 - wet) - r.sink * (wet > 0 ? 1 : 0) + r.lift;
  for (const key of Object.keys(b)) b[key] = { m: b[key].m, t: [b[key].t[0], b[key].t[1], b[key].t[2] + dz] };
  return b;
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

type Palette = Record<Mat, RGB>;

function paletteOf(p: FigurePose, look: Look): Palette {
  const skin = hex(skinColour(look)), hair = hex(hairColour(look)), tunic = hex(p.tunic ?? shirtColour(look));
  return {
    skin,
    lip: mixRGB(skin, [150, 62, 60], 0.32),
    hair,
    brow: mixRGB(hair, [22, 16, 14], 0.3),
    eye: mixRGB(hex(eyeColour(look)), [10, 8, 8], 0.35),
    glint: [250, 246, 236],
    tunic,
    trim: mixRGB(tunic, [30, 24, 22], 0.2),
    trousers: hex(p.trousers ?? trouserColour(look)),
    boot: [84, 62, 50],
    cuff: [150, 118, 86],
    sole: [52, 40, 33],
    belt: [68, 48, 33],
    buckle: [214, 180, 98],
    stubble: mixRGB(mixRGB(skin, hair, 0.62), [40, 30, 28], 0.1),
    rein: [74, 53, 36],
    haft: [158, 118, 76],
    iron: [128, 126, 132],
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

interface Part {
  mesh: Mesh;
  xf: Xf;
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
   * Only after it while this side of the part is toward the viewer, and
   * before it otherwise: a beard is on the front of the head, and from behind
   * the head is in front of it.
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
   * A solid in the part's own frame, `c` its middle and `r` its half-sizes,
   * that hides whatever of the part is behind it. Hair is drawn after the
   * head so that it lies on it; this is what keeps a bun or the end of a
   * crest out of sight when it is round the far side.
   */
  hide?: { c: V3; r: V3 };
}

function partsOf(kit: Kit, r: Rig, b: Bones): Part[] {
  const skirt: Part = { mesh: kit.skirt, xf: b.pelvis, v: skirtBent(kit, r), bias: 0.15 };
  const abdomen: Part = { mesh: kit.abdomen, xf: b.spine, bias: 0.05, convex: true };
  const head: Part = { mesh: r.blink ? kit.blink : kit.head, xf: b.head, bias: 0.2 };
  const parts: Part[] = [
    { mesh: kit.pelvis, xf: b.pelvis, bias: 0, convex: true },
    skirt,
    // Round the waist, over both the tunic's skirt and its body, whichever of them is drawn later.
    { mesh: kit.belt, xf: b.pelvis, bias: 0.01, after: [skirt, abdomen], convex: true },
    abdomen,
    { mesh: kit.chest, xf: b.chest, bias: 0.1, convex: true },
    { mesh: kit.neck, xf: b.neck, bias: 0, under: head, convex: true },
    head,
    // The ears on the head, the far one hidden behind the skull rather than drawn through it.
    { mesh: kit.ears, xf: b.head, bias: 0.005, after: head, hide: SKULL },
  ];
  const cap: Part | undefined = kit.hair.cap && { mesh: kit.hair.cap, xf: b.head, bias: 0.01, after: head, hide: SKULL };
  if (cap) parts.push(cap);
  // What stands up out of the hair -- a crest, a knot -- goes on over it.
  if (kit.hair.top) parts.push({ mesh: kit.hair.top, xf: b.head, bias: 0.012, after: cap ?? head, hide: SKULL });
  if (kit.hair.fall) parts.push({ mesh: kit.hair.fall, xf: b.head, bias: 0 });
  if (kit.beard) parts.push({ mesh: kit.beard, xf: b.head, bias: 0.02, after: head, front: [0, 1, 0], hide: SKULL });
  for (const t of kit.hair.tails) parts.push({ mesh: t.mesh, xf: joint(b.head, t.at, -r.tail[0] * t.give, r.tail[1] * t.give, 0), bias: 0 });
  if (r.tool) parts.push({ mesh: kit.mallet, xf: b.wrist1, bias: 0.04 });
  for (let k = 0; k < 2; k++) {
    parts.push(
      { mesh: kit.upper, xf: b[`arm${k}`], bias: 0, convex: true },
      { mesh: kit.lower, xf: b[`elbow${k}`], bias: 0.02 },
      { mesh: kit.hands[k], xf: b[`wrist${k}`], bias: 0.03 },
      { mesh: kit.thigh, xf: b[`hip${k}`], bias: 0, convex: true },
      { mesh: kit.shin, xf: b[`knee${k}`], bias: 0, convex: true },
      { mesh: kit.boot, xf: b[`knee${k}`], bias: 0.01, convex: true },
      { mesh: kit.foot, xf: b[`ankle${k}`], bias: 0.02 },
    );
  }
  return parts;
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

/**
 * Put the parts on the screen. Each is sorted into place by how near its
 * middle is along the ground -- which is what puts the near arm in front of
 * the body and the far one behind it -- and its facets among themselves by
 * how near each is. The outside of the whole is inked first, fattened, so
 * only its rim shows; then each part in turn, and a line along every edge
 * of it that turns away from the viewer, which is what draws an arm over a
 * chest.
 */
function render(g: CanvasRenderingContext2D, parts: Part[], pal: Palette, view: View, ink: number, px: number): void {
  const { ex, ey, T, L, H } = view;
  const laid: Laid[] = parts.map((part) => {
    const pv = (part.v ?? part.mesh.v).map((p) => place(part.xf, p));
    const s = pv.map((p): Pt => [p[0] * ex[0] + p[1] * ey[0], p[0] * ex[1] + p[1] * ey[1] - p[2] * HEIGHT_SCALE]);
    const vis: boolean[] = [], k: number[] = [], d: number[] = [];
    const hidden = part.hide && behind(part.xf, part.hide, T);
    for (const face of part.mesh.f) {
      const pts = face.i.map((i) => pv[i]);
      const n = newell(pts);
      const l = Math.hypot(n[0], n[1], n[2]);
      const u: V3 = l > 1e-9 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0];
      let cx = 0, cy = 0, cz = 0;
      for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
      const c: V3 = [cx / pts.length, cy / pts.length, cz / pts.length];
      const off = face.unless && mv(part.xf.m, face.unless);
      vis.push(l > 1e-9 && u[0] * T[0] + u[1] * T[1] + u[2] * T[2] > 1e-4 && !(hidden && hidden(c)) && !(off && off[0] * T[0] + off[1] * T[1] + off[2] * T[2] > 0.05));
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
    const lead = Math.max(...keys);
    const fw = l.part.front && mv(l.part.xf.m, l.part.front);
    if (!fw || fw[0] * T[0] + fw[1] * T[1] + fw[2] * T[2] > -0.08) l.key = lead + l.part.bias;
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
    const to = into(inks[l.part.mesh.f[fi].m]);
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
    if (l.part.convex) {
      for (const fi of shown) add(into(shade(pal[f[fi].m], l.k[fi])), l, fi);
      flush(0, true);
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
        const c = shade(pal[f[shown[q]].m], l.k[shown[q]]);
        let end = q;
        while (end < shown.length && shade(pal[f[shown[end]].m], l.k[shown[end]]) === c) end++;
        for (let r = q; r < end; r++) add(into(c), l, shown[r]);
        flush(0, true);
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
      g.fillStyle = shade(pal[f[fi].m], l.k[fi]);
      g.fill(path);
    }
  });
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
    ? settle(pose.id, pose, rigOf(pose), now)
    : { rig: rigOf(pose), facing: ((Math.round(pose.facing) % 8) + 8) % 8, changing: false };
  // Most of a pixel however far out, and never more than three and a half however far in.
  const ink = opts.ink !== undefined ? opts.ink / zoom : Math.max(0.9 / zoom, 0.7);
  if (pose.id && zoom < STILL_BELOW && opts.ink === undefined) {
    drawStill(ctx, sx, sy, zoom, pose, kit, r, facing, changing, ink, now);
    return;
  }
  drawLive(ctx, sx, sy, zoom, pose, kit, r, facing, ink);
}

function drawLive(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: FigurePose, kit: Kit, r: Rig, facing: number, ink: number): void {
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
  render(ctx, partsOf(kit, r, b), pal, view, ink, 1 / zoom);
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
 * thirty while it walks, which is more than a stride or a breath needs, and
 * every frame while it is blending from one thing to another or turning.
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

/** The picture's extent round the feet, in the figure's own screen units: reins, a raised arm and a hop all inside it. */
const STILL_BOX = { left: -34, right: 34, top: -58, bottom: 14 };

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
    Math.round(facing * 100), zoom.toFixed(3), dev, doing(pose), pose.emote ?? ''].join('|');
  let st = stills.get(id);
  const rate = pose.emote ? 30 : STILL_RATE[doing(pose)] ?? 30;
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
    drawLive(st.g, 0, 0, zoom, pose, kit, r, facing, ink);
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
