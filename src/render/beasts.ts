import {
  ball, joint, mesh, onScreen, PLAIN_PALETTE, place, render, ROOT, viewOf,
  type Face, type Mat, type Mesh, type Palette, type Part, type RGB, type V3, type View, type Xf,
} from './figure';
import { UNITS_PER_TILE } from './iso';

/**
 * Wildermon, as low-poly bodies.
 *
 * Every animal on the island was a drawing in profile, squashed and sheared
 * to fake the other seven ways round. Each is a model now, the way a person
 * is: a skeleton of a dozen or two bones -- a body, a neck and a head, a tail
 * in links, a shoulder, an elbow and a paw at each corner -- with a faceted
 * mesh on each, posed every frame and drawn through the projection the ground
 * is drawn through. Turning round is turning round, and a walk is four legs
 * each going through a stride of its own rather than one drawing nodding.
 *
 * Drawn the way a person is (`render` in `./figure`): every facet one colour
 * in the light over the viewer's left shoulder, the whole inked round its
 * outside in a dark of each thing's own colour. What is here is what every
 * kind is made with -- the shapes, the bones, how a body on four legs moves,
 * and how a body is kept between frames; each kind is in `./wildermon`.
 *
 * Units are tenths of a metre, as for a person: `x` to the animal's right,
 * `y` the way it faces, `z` up from the ground under it.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/* ---- vectors ------------------------------------------------------------------ */

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (x: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, x));
export const smooth = (t: number): number => { const u = clamp(t); return u * u * (3 - 2 * u); };
export const frac = (x: number): number => x - Math.floor(x);

/** A point `t` of the way along the curve from `a` to `b` drawn toward `c`. */
export function bend(a: V3, c: V3, b: V3, t: number): V3 {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]];
}
/** `n + 1` points along that curve, evenly by `t`. */
export const curve = (a: V3, c: V3, b: V3, n: number): V3[] => Array.from({ length: n + 1 }, (_, k) => bend(a, c, b, k / n));

/* ---- colour ------------------------------------------------------------------- */

export const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as RGB;
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const PAPER: RGB = [252, 250, 244];
const DUSK: RGB = [44, 34, 40];
export const lighter = (c: RGB, t: number): RGB => mix(c, PAPER, t);
export const darker = (c: RGB, t: number): RGB => mix(c, DUSK, t);

function toHsl(c: RGB): [number, number, number] {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): RGB {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number): number => {
    const u = ((t % 1) + 1) % 1;
    return u < 1 / 6 ? p + (q - p) * 6 * u : u < 0.5 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
  };
  return [f(h / 360 + 1 / 3) * 255, f(h / 360) * 255, f(h / 360 - 1 / 3) * 255];
}

/**
 * A variant's colour brought into the island's range, where everything is
 * chalk and pastel: nothing darker than a slate, a grey that was dead
 * leaning to dove or lilac, and the browns warmed to caramel. The colours
 * the rules have for a variant are what it is; this is how it is painted.
 */
export function pastel(c: RGB, grey = 258): RGB {
  let [h, s, l] = toHsl(c);
  if (s < 0.14) {
    // A grey with no colour in it: a dove, a lilac, a storm cloud -- or whatever tint its kind wears its greys in.
    h = grey;
    s = 0.12 + s * 0.6;
  } else if (h >= 12 && h <= 48) {
    s = Math.min(0.62, s * 1.12);
  }
  // Light: a dark variant comes out a soft mid, never much darker than the grass it stands on.
  l = Math.min(0.93, 0.48 + l * 0.5);
  return fromHsl(h, s, l);
}

/**
 * A wildermon's colours: its variant's two -- the coat and the markings --
 * and what follows from them, over every colour at what it starts from, then
 * whatever its kind has of its own. The same palette a person is drawn from
 * (`Palette`), so a goblin's leather is the leather of a jerkin.
 */
export function coatPalette(coat0: RGB, mark0: RGB, own: Partial<Palette> = {}, grey?: number): Palette {
  const coat = pastel(coat0, grey), mark = pastel(mark0, grey);
  return {
    ...PLAIN_PALETTE,
    coat,
    coatDark: darker(coat, 0.2),
    coatLight: lighter(coat, 0.2),
    mark,
    belly: mix(coat, mark, 0.72),
    muzzle: lighter(mark, 0.3),
    inner: mix([238, 172, 176], coat, 0.2),
    lid: darker(coat, 0.42),
    // A warm dark, plum rather than black: black eyes on a pastel face are holes.
    eye: [58, 36, 54],
    glint: [255, 253, 246],
    feather: coat,
    featherDark: darker(coat, 0.24),
    ...own,
  };
}

/* ---- shapes ------------------------------------------------------------------- */

/** A number, or one for each ring along a tube. */
export type Prof = number | readonly number[];
const at = (p: Prof, k: number): number => (typeof p === 'number' ? p : p[Math.min(k, p.length - 1)]);
export type MatOf = Mat | ((ring: number, j: number) => Mat);

/**
 * A tube along a line of points, each ring an ellipse square to the line, `w`
 * across it and `h` up it: what nearly everything here is made of -- a body,
 * a neck, a leg, a tail, a horn, an ear pressed flat.
 *
 * "Up it" is the ground's up unless the line itself runs up and down, when it
 * is forward; for something flat, a leaf or an ear, it is the way the flat
 * side faces (`up`), and `h` is how thick it is. Closed at either end unless
 * told otherwise; a ring of no size is a point.
 */
export function tube(pts: readonly V3[], w: Prof, h: Prof, n: number, mat: MatOf,
  o: { up?: V3; start?: boolean; end?: boolean; turn?: number; seam?: 'start' | 'end' | 'both' } = {}): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  const m = (k: number, j: number): Mat => (typeof mat === 'function' ? mat(k, j) : mat);
  let last: V3 | null = null;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const d = unit(sub(b, a));
    const want: V3 = o.up ?? (Math.abs(d[2]) > 0.92 ? [0, 1, 0] : [0, 0, 1]);
    let u = cross(want, d);
    if (Math.hypot(u[0], u[1], u[2]) < 1e-4) u = last ?? [1, 0, 0];
    u = unit(u);
    // Kept turning the same way from one ring to the next, so a tube bending up through the vertical does not twist on itself.
    if (last && dot(u, last) < 0) u = scale(u, -1);
    last = u;
    const vv = cross(d, u);
    const ww = at(w, k), hh = at(h, k), turn = o.turn ?? 0.5;
    for (let j = 0; j < n; j++) {
      const t = ((j + turn) / n) * TAU, c = Math.cos(t) * ww, s = Math.sin(t) * hh;
      v.push([pts[k][0] + u[0] * c + vv[0] * s, pts[k][1] + u[1] * c + vv[1] * s, pts[k][2] + u[2] * c + vv[2] * s]);
    }
  }
  // Where it goes into something else -- a leg into a body, a shin into a thigh -- it is left open at that end, with no cap to be
  // lit as a disc on whatever it goes into, and the band there is `soft`, so its open rim is not inked either. Its sides are.
  const intoStart = o.seam === 'both' || o.seam === 'start', intoEnd = o.seam === 'both' || o.seam === 'end';
  for (let k = 0; k < pts.length - 1; k++) {
    const soft = (intoStart && k === 0) || (intoEnd && k === pts.length - 2) || undefined;
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      f.push({ i: [k * n + j, k * n + j2, (k + 1) * n + j2, (k + 1) * n + j], m: m(k, j), soft });
    }
  }
  if (o.start !== false && !intoStart) f.push({ i: Array.from({ length: n }, (_, j) => n - 1 - j), m: m(0, 0) });
  if (o.end !== false && !intoEnd) {
    const top = (pts.length - 1) * n;
    f.push({ i: Array.from({ length: n }, (_, j) => top + j), m: m(pts.length - 1, 0) });
  }
  return mesh(v, f);
}

/** A cone along a line of points, `r0` at the root going to `r1` at the tip: a horn, a tuft, a claw, a spike. */
export const taper = (pts: readonly V3[], r0: number, r1: number, n: number, mat: MatOf, flat = 1, up?: V3): Mesh =>
  tube(pts, pts.map((_, k) => lerp(r0, r1, k / Math.max(1, pts.length - 1))), pts.map((_, k) => lerp(r0, r1, k / Math.max(1, pts.length - 1)) * flat), n, mat, { up });

/** A ball, `n` round and `k` bands pole to pole. */
export const orb = (c: V3, r: V3 | number, n: number, k: number, mat: Mat): Mesh =>
  ball(c, typeof r === 'number' ? [r, r, r] : r, n, Math.max(3, k), mat);

/** A ball with its poles along `axis` rather than up and down: a snout, a bud, anything round that points somewhere. */
export function orbAlong(c: V3, axis: V3, r: V3, n: number, k: number, mat: Mat): Mesh {
  const b = ball([0, 0, 0], r, n, Math.max(3, k), mat);
  const z = unit(axis);
  let x = cross([0, 0, 1], z);
  if (Math.hypot(x[0], x[1], x[2]) < 1e-4) x = [1, 0, 0];
  x = unit(x);
  const y = cross(z, x);
  return mesh(b.v.map((p) => add(c, add(add(scale(x, p[0]), scale(y, p[1])), scale(z, p[2])))), b.f);
}

/** A flat shape painted on a surface -- an eye, a spot, a stripe -- `sides` round, `rx` by `ry`, facing along `n`. */
export interface Disc { v: V3[]; m: Mat; lit?: boolean; at?: V3 }
export function disc(c: V3, n: V3, rx: number, ry: number, sides: number, m: Mat, o: { up?: V3; lit?: boolean; spin?: number; at?: V3 } = {}): Disc {
  const d = unit(n);
  let u = cross(o.up ?? [0, 0, 1], d);
  if (Math.hypot(u[0], u[1], u[2]) < 1e-4) u = [1, 0, 0];
  u = unit(u);
  const w = cross(d, u);
  const v: V3[] = [];
  for (let j = 0; j < sides; j++) {
    const t = ((j + 0.5) / sides) * TAU + (o.spin ?? 0);
    v.push(add(c, add(scale(u, Math.cos(t) * rx), scale(w, Math.sin(t) * ry))));
  }
  return { v, m, lit: o.lit, at: o.at };
}

/** Painted shapes, gathered into one mesh of decals. */
export function paint(discs: readonly Disc[]): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  for (const d of discs) {
    const base = v.length;
    v.push(...d.v);
    f.push({ i: d.v.map((_, k) => base + k), m: d.m, decal: true, lit: d.lit, at: d.at });
  }
  return mesh(v, f);
}

/** Meshes put together as one. */
export function merge(...ms: Array<Mesh | null | undefined | false>): Mesh {
  const v: V3[] = [];
  const f: Face[] = [];
  for (const m of ms) {
    if (!m) continue;
    const base = v.length;
    v.push(...m.v);
    for (const face of m.f) f.push({ ...face, i: face.i.map((i) => i + base) });
  }
  return mesh(v, f);
}

/** A mesh pitched about x, then turned about z, both in degrees, then moved. */
export function moved(m: Mesh, by: V3, yaw = 0, pitch = 0, roll = 0): Mesh {
  const cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG), cp = Math.cos(pitch * DEG), sp = Math.sin(pitch * DEG);
  const cr = Math.cos(roll * DEG), sr = Math.sin(roll * DEG);
  return mesh(m.v.map((p) => {
    const q: V3 = [p[0] * cr + p[2] * sr, p[1], -p[0] * sr + p[2] * cr];
    const r: V3 = [q[0], q[1] * cp - q[2] * sp, q[1] * sp + q[2] * cp];
    return [r[0] * cy - r[1] * sy + by[0], r[0] * sy + r[1] * cy + by[1], r[2] + by[2]];
  }), m.f);
}

/** The same mesh left for right, its faces wound back the right way out. */
export const mirrored = (m: Mesh): Mesh =>
  mesh(m.v.map((p) => [-p[0], p[1], p[2]] as V3), m.f.map((f) => ({ ...f, i: [...f.i].reverse() })));

/** A mesh and its mirror, for a pair of anything: ears, horns, whiskers. */
export const pair = (m: Mesh): Mesh => merge(m, mirrored(m));

/** Where a direction out of the middle of an egg meets its shell, and the way out of it there. */
export function onEgg(c: V3, r: V3, dir: V3): { p: V3; n: V3 } {
  const d = unit(dir);
  const k = 1 / Math.hypot(d[0] / r[0], d[1] / r[1], d[2] / r[2]);
  const p = add(c, scale(d, k));
  return { p, n: unit([(p[0] - c[0]) / (r[0] * r[0]), (p[1] - c[1]) / (r[1] * r[1]), (p[2] - c[2]) / (r[2] * r[2])]) };
}

/**
 * A pair of eyes on an egg of a head, each dark and big with a glint high on
 * the side the light is: what makes a thing forty pixels long look back at
 * you. `dir` is the way out of the head to the right eye; the left is its
 * mirror. Shut, each is a lid's line instead.
 */
export function eyes(c: V3, r: V3, dir: V3, size: number, o: { tall?: number; shut?: boolean; glint?: number; iris?: Mat; pupil?: number; rim?: number; at?: boolean } = {}): Mesh {
  const out: Disc[] = [];
  for (const s of [1, -1]) {
    const { p, n } = onEgg(c, r, [dir[0] * s, dir[1], dir[2]]);
    const on = add(p, scale(n, 0.03));
    // Hidden whole behind the head's own solid when it is round the far side of it.
    const hideAt = o.at ? add(p, scale(n, -0.2)) : undefined;
    if (o.shut) {
      // A shut eye is a fat, curved lid-line, so a blink shows at forty pixels.
      out.push(disc(add(on, scale([0, 0, 1], -size * 0.2)), n, size * 1.08, size * 0.34, 8, 'lid', { at: hideAt }));
      continue;
    }
    const tall = o.tall ?? 1.15;
    if (o.rim) out.push(disc(add(p, scale(n, 0.015)), n, size * (1 + o.rim), size * tall * (1 + o.rim), 10, 'eyeWhite', { at: hideAt }));
    out.push(disc(on, n, size, size * tall, 10, o.iris ?? 'eye', { at: hideAt }));
    // A coloured eye has a dark middle of its own.
    if (o.pupil) out.push(disc(add(on, scale(n, 0.01)), n, size * o.pupil, size * tall * o.pupil * 1.1, 8, 'eye', { at: hideAt }));
    // The glint up and to the light's side, the same side on both eyes.
    const side = unit(cross([0, 0, 1], n));
    const g = add(add(on, scale([0, 0, 1], size * tall * 0.4)), scale(side, size * 0.32));
    out.push(disc(add(g, scale(n, 0.02)), n, size * (o.glint ?? 0.36), size * (o.glint ?? 0.36), 6, 'glint', { lit: true, at: hideAt }));
  }
  return paint(out);
}

/**
 * A face's small things, painted on an egg of a head: a pink blush under each
 * eye, and a mouth like an ω under the nose. `dir` is the way out of the head
 * to the right cheek; `mouth` is where the mouth goes, and which way it faces.
 */
export function blush(c: V3, r: V3, dir: V3, size: number): Mesh {
  const out: Disc[] = [];
  for (const s of [1, -1]) {
    const { p, n } = onEgg(c, r, [dir[0] * s, dir[1], dir[2]]);
    out.push(disc(add(p, scale(n, 0.03)), n, size, size * 0.6, 8, 'inner'));
  }
  return paint(out);
}
export function smile(at: V3, n: V3, w: number, m: Mat = 'nose'): Mesh {
  const d = unit(n);
  let u = cross([0, 0, 1], d);
  if (Math.hypot(u[0], u[1], u[2]) < 1e-4) u = [1, 0, 0];
  u = unit(u);
  const up = cross(d, u);
  // Two little arcs side by side, as a band a line thick: along the top of the ω and back along under it.
  const pts: Array<[number, number]> = [];
  for (let q = 0; q <= 8; q++) {
    const x = -1 + q / 4, y = -Math.abs(Math.sin((x + 1) * Math.PI));
    pts.push([x, y * 0.5]);
  }
  const band = [...pts.map(([x, y]) => [x, y + 0.14] as [number, number]), ...pts.reverse().map(([x, y]) => [x, y - 0.14] as [number, number])];
  // Wound the way a disc is, so it faces out of the face along `n` and not into the head.
  const v = band.reverse().map(([x, y]) => add(add(at, scale(d, 0.03)), add(scale(u, x * w * 0.5), scale(up, y * w * 0.5))));
  return paint([{ v, m }]);
}

/* ---- bones and pieces ------------------------------------------------------------ */

export type Bones = Record<string, Xf>;

/** Every bone moved up by `dz`, which is how a body is stood on its own feet. */
export function lifted(b: Bones, dz: number): Bones {
  const out: Bones = {};
  for (const k of Object.keys(b)) out[k] = { m: b[k].m, t: [b[k].t[0], b[k].t[1], b[k].t[2] + dz] };
  return out;
}

/**
 * One piece of a kind's body as it is built: a mesh on a bone, and how it
 * goes down against the others. The fields a person's parts have (`Part`),
 * with the others named rather than held, since a kind is built once and
 * posed every frame.
 */
export interface Piece {
  key: string;
  mesh: Mesh;
  bone: string;
  bias?: number;
  convex?: boolean;
  after?: string | string[];
  under?: string | string[];
  front?: V3;
  hide?: Array<{ c: V3; r: V3 }>;
  hideIn?: string;
  /** The same piece with its eyes shut, for a blink. */
  shut?: Mesh;
  /** Swollen and let down as it breathes: this much across and up, about this point. */
  breathes?: { c: V3; k: number };
  /** Only while this says so: a fleece while it has grown back, a flame while it burns. */
  shown?: (a: Anim) => boolean;
  /** Its corners moved, for something that bends within itself. */
  bent?: (v: readonly V3[], a: Anim) => V3[];
  /** No lines inside it, only the outline round the whole: a fleece of puffs, a cloud. */
  lines?: boolean;
  /** Inked lightly: a seed head, a wisp. */
  airy?: boolean;
  /** Not inked at all, not even round the outside: the fine spokes of a seed head. */
  rim?: boolean;
  /** Outlined at half the width: a leg so thin a full outline would be most of it. */
  thin?: boolean;
  /** One link of something in links, named for the whole of it: lined as one thing, with no ring at each joint (`Part.chain`). */
  chain?: string;
  /** A rim of light in this colour along its top edge, where it turns away: the silver edge of a cloud. */
  sheen?: Mat;
}

/** What a body is doing this frame, as its pose is worked out from it. */
export interface Anim {
  /** Its own clock, in seconds: the island's, set off by a little of its own so a herd is not all in step. */
  t: number;
  /** How far through its stride, in strides. */
  u: number;
  /** Between standing, nought, and going, one. */
  go: number;
  /** Nought at a walk, one at a run. */
  gait: number;
  /** Head down at the grass, nought to one. */
  graze: number;
  blink: boolean;
  /** Nought to one through a breath, while it stands. */
  breath: number;
  fleece: number;
  /** A number of its own, for all the things a herd should not do at once. */
  seed: number;
}

/**
 * A kind of body: its bones and how they are posed for what it is doing, the
 * pieces on them, its colours, and the ground it shades.
 */
export interface Kind {
  bones(a: Anim): Bones;
  build(lod: number): Piece[];
  palette(coat: RGB, mark: RGB): Palette;
  /** Half its length and half its width on the ground, for the shadow under it. */
  shadow: [number, number];
  /**
   * Strides to a turn of the island's walk phase, for a kind whose feet are
   * not on the ground to be measured (`strideLength`): a thing that floats
   * or flies. A kind that walks takes as many strides as its legs say.
   */
  stride: number;
  /**
   * How big it is drawn against how it is built. A kind is modelled in
   * whatever units make it easy to model, and then drawn at the size its old
   * drawing was, which is the size the island has always shown it at.
   */
  size?: number;
  /** How often it blinks, in seconds between; nought for a thing that has no eyelids. */
  blinks?: number;
  /**
   * Whether it leaps at a walk and at a run -- bounds, hops -- and so is
   * carried over the ground in the air rather than at an even pace, its feet
   * staying where they were put while they are down (`leapOf`).
   */
  leaps?: readonly [boolean, boolean];
  /** Light rather than stuff, drawn over the body: a lume's glow, an ember on a back. */
  glow?(b: Bones, a: Anim): Array<{ p: V3; r: number; c: RGB; a: number }>;
  /** Drawn by hand over or under the body, for what is not a mesh: a swarm, a flicker. */
  extra?(g: CanvasRenderingContext2D, view: View, b: Bones, a: Anim, under: boolean): void;
}

/* ---- motion ---------------------------------------------------------------------- */

/**
 * How long a body standing about takes to do everything it does before it
 * does it all again, in seconds: every sway, look, flick and blink of it is
 * a whole number of turns in this, so that standing is a loop, and a loop can
 * be kept as pictures (`drawBeast`). A herd is not in step because each body
 * is somewhere else in the loop.
 */
export const LOOP = 24;
/** A wave that goes round `n` whole times a loop. */
export const cyc = (t: number, n: number, at = 0): number => Math.sin((t * TAU * n) / LOOP + at);

/** A slow wander, for a head that looks about: three waves, of one, two and five turns a loop, that never quite repeat within it. */
export const drift = (t: number, at = 0): number => cyc(t, 1, at) * 0.55 + cyc(t, 2, at) * 0.3 + cyc(t, 5, at) * 0.15;

/**
 * Something that happens at a moment in the loop and is quickly over -- an
 * ear flicked, a sniff -- as a bump from nought to one and back, `len`
 * seconds long, starting at each of `at` (seconds into the loop).
 */
export function beat(t: number, at: readonly number[], len: number): number {
  let b = 0;
  for (const x of at) {
    const u = t - x;
    if (u > 0 && u < len) b = Math.max(b, Math.sin((u / len) * Math.PI));
  }
  return b;
}

/**
 * A leg through its stride, `u` of the way through it, on the ground for
 * `duty` of it. On the ground the leg sweeps evenly from `amp` forward to
 * `amp` behind, which is what carries the body; off it, the leg comes forward
 * again with the joints below folded, most at the middle of the swing.
 * Returns the swing (degrees, forward positive), the fold (nought to one) and
 * how far through the swing it is (nought on the ground).
 */
export function step(u: number, duty: number, amp: number): [number, number, number] {
  const p = frac(u);
  if (p < duty) return [amp * (1 - (2 * p) / duty), 0, 0];
  const s = (p - duty) / (1 - duty);
  return [-amp + 2 * amp * smooth(s), Math.sin(Math.PI * s), s];
}

/* ---- how far a stride goes ----------------------------------------------------------- */

/** The bones a body stands on, by the names its plan gives them: four legs, a bird's two, a body upright. */
const FEET = ['fl2', 'fr2', 'hl2', 'hr2', 'bl2', 'br2', 'll2', 'lr2'];

/** How a kind's feet meet the ground through a stride, at a walk and at a run: see `gaitOf`. */
interface GaitShape {
  /** How far its body goes over the ground in a stride, in its own units: what its feet on the ground say. */
  reach: number;
  /** At each of `STRIDE_SAMPLES` moments through a stride, whether any foot is on the ground. */
  down: boolean[];
  /** How much of the stride no foot is. */
  air: number;
}
const STRIDE_SAMPLES = 48;

/**
 * How a kind's feet meet the ground through a stride, at a walk and at a
 * run, measured off its bones. A foot on the ground sweeps back under the
 * body, and for it to stay where it was put the body has to go forward
 * exactly as fast: so how far the body goes in a stride is how far the feet
 * on the ground sweep back, over how much of the stride they are down.
 * Nothing for a kind with no feet on the ground to measure -- a thing that
 * floats or flies -- whose `stride` is taken as it is.
 */
const shapes = new Map<Kind, readonly [GaitShape, GaitShape] | null>();
export function gaitOf(kind: Kind): readonly [GaitShape, GaitShape] | null {
  const had = shapes.get(kind);
  if (had !== undefined) return had;
  const N = STRIDE_SAMPLES;
  const out: GaitShape[] = [];
  for (const gait of [0, 1]) {
    const track = new Map<string, V3[]>();
    for (let q = 0; q < N; q++) {
      const b = kind.bones({ t: 0, u: q / N, go: 1, gait, graze: 0, blink: false, breath: 0.5, fleece: 1, seed: 0 });
      for (const k of FEET) {
        if (!b[k]) continue;
        let list = track.get(k);
        if (!list) track.set(k, (list = []));
        list.push(place(b[k], [0, 0, 0]));
      }
    }
    let back = 0, time = 0;
    const down = new Array<boolean>(N).fill(false);
    for (const pts of track.values()) {
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { lo = Math.min(lo, p[2]); hi = Math.max(hi, p[2]); }
      // Down: going back under the body, and not up in the air. A foot on the ground is not always the lowest (the body rolls
      // and pitches over its feet), but a foot swinging goes forward, and the only way one goes back is along the ground.
      const floor = lo + Math.max(0.08, (hi - lo) * 0.6);
      for (let q = 0; q < N; q++) {
        const p = pts[q], n = pts[(q + 1) % N];
        if (p[2] <= floor && n[1] < p[1] - 1e-4) { back += p[1] - n[1]; time += 1 / N; down[q] = true; }
      }
    }
    if (!(time > 0 && back > 0)) { shapes.set(kind, null); return null; }
    out.push({ reach: back / time, down, air: down.filter((d) => !d).length / N });
  }
  const r = [out[0], out[1]] as const;
  shapes.set(kind, r);
  return r;
}

/** How far a kind's body goes over the ground in one of its strides, in its own units, at a walk and at a run (`gaitOf`). */
export function strideLength(kind: Kind): readonly [number, number] | null {
  const g = gaitOf(kind);
  return g ? [g[0].reach, g[1].reach] : null;
}

/** How much of a stride a kind that leaps (`Kind.leaps`) must be in the air for it to be carried there (`leapOf`). */
const LEAPS = 0.1;

/**
 * Where a body that leaps is against where the island has it, `w` of the
 * way through a stride that goes `reach` of its own units over the ground,
 * along the way it faces: its feet on the ground carry it only as fast as
 * they sweep back, so they stay where they were put, and the rest of the
 * way it goes in the air. Nought for a body that does not leap at this gait.
 */
export function leapOf(kind: Kind, gait: number, w: number, reach: number): number {
  const run = gait > 0.5 ? 1 : 0;
  const g = kind.leaps?.[run] ? gaitOf(kind) : null;
  if (!g) return 0;
  const shape = g[run];
  if (shape.air < LEAPS) return 0;
  const N = STRIDE_SAMPLES;
  const slow = Math.min(shape.reach, reach);
  const fast = (reach - slow * (1 - shape.air)) / shape.air;
  // How far along it is at `w`, the island having it at `w * reach`.
  const at = frac(w) * N;
  let gone = 0;
  for (let q = 0; q < Math.floor(at); q++) gone += (shape.down[q] ? slow : fast) / N;
  gone += (at - Math.floor(at)) * (shape.down[Math.floor(at) % N] ? slow : fast) / N;
  return gone - frac(w) * reach;
}

/** Radians of the island's walk phase to a tile crossed: what `walkPhase` is counted in. */
const PHASE_PER_TILE = 6;

/**
 * Strides to a radian of the walk phase, at a gait: as many as keep its
 * feet where they are put (`strideLength`), so a short-legged thing takes
 * more of them over a tile than a long-legged one, and a run, with its feet
 * down for less of each stride, takes longer strides than a walk.
 */
export function strideRate(kind: Kind, gait: number): number {
  const r = strideLength(kind);
  if (!r) return kind.stride / TAU;
  return UNITS_PER_TILE / PHASE_PER_TILE / (kind.size ?? 1) / lerp(r[0], r[1], clamp(gait));
}

/* ---- a body on four legs ---------------------------------------------------------- */

/** One leg of a pair, on the right: where it hangs from, how long each part of it is, and how it stands. */
export interface LegSpec {
  /** The shoulder or the hip, on the right side, in the body's frame. */
  at: V3;
  /** Upper, lower, and the drop from the last joint to the sole. */
  len: [number, number, number];
  /** Standing: the upper's pitch (forward positive), the lower's against it, the foot's, in degrees. */
  rest?: [number, number, number];
  /** How far the lower folds back at the top of a swing, at a walk and at a run, in degrees. */
  fold?: [number, number];
  /** How far the sole reaches ahead of the last joint, and behind it, for standing it flat. */
  toe?: [number, number];
}

export interface QuadSpec {
  /** Where the body bone sits over the ground before the feet are stood on it. */
  high: number;
  fore: LegSpec;
  hind: LegSpec;
  /** The neck's root on the body, its length, and how far it leans forward of upright, in degrees. */
  neck: { at: V3; len: number; lean: number };
  /** The head's pitch, nose up positive, against level. */
  head?: { pitch: number };
  /** The tail's root, its links and their length, and how it is carried: lifted (degrees up), curled a link, swung. */
  tail?: { at: V3; links: number; len: number; lift: number; curl: number; sway: number };
  /** The ears' roots on the head, on the right: splayed out, laid back, in degrees. */
  ears?: { at: V3; out: number; back: number };
  /** Swing of a leg at a walk and at a run, in degrees. */
  swing: [number, number];
  /** How much of a stride each foot is on the ground at a walk and at a run. */
  duty?: [number, number];
  /** How far down the neck goes to graze, in degrees past its lean; how far the nose goes down past level; how far the chest dips. */
  graze?: number;
  nose?: number;
  bow?: number;
  /** Both hind feet together and both fore, a bounding run: a rabba, a seavic. */
  bound?: boolean;
  /** How much its back rocks at a run, in degrees. */
  rock?: number;
}

/** A pose on four legs: the numbers every bone is turned by. */
export interface QuadPose {
  /** Up off the ground (over what the feet say), pitch nose-up and roll to the right, of the body. */
  lift: number;
  pitch: number;
  roll: number;
  /** The neck bent forward (positive) and turned left (positive), past how it is carried. */
  neck: [number, number];
  /** The head pitched nose-up, turned left, and tilted, past level. */
  head: [number, number, number];
  /** Each ear, left then right: laid back, and out. */
  ears: [[number, number], [number, number]];
  /** The tail lifted and swung past how it is carried, and a curl down its links. */
  tail: [number, number, number];
  /** Each leg, fore left, fore right, hind left, hind right: swing, fold, and how far it is off the ground. */
  legs: Array<[number, number, number]>;
  /** Each foot pitched past how the leg would set it, toe down negative, in degrees: a push off the toes. */
  foot: number[];
  /** How far through a breath: nought to one. */
  breath: number;
  jaw: number;
  /** Squashed down (positive) or stretched up (negative), for a landing and a leap: nought is as built. */
  squash: number;
}

const LEGS: Array<{ key: string; side: number; fore: boolean }> = [
  { key: 'fl', side: -1, fore: true }, { key: 'fr', side: 1, fore: true },
  { key: 'hl', side: -1, fore: false }, { key: 'hr', side: 1, fore: false },
];

/** Where each leg is in the stride at a walk (a four-beat, hind then fore on each side) and at a run (the diagonals together). */
const WALK_AT = [0.25, 0.75, 0, 0.5];
const TROT_AT = [0, 0.5, 0.5, 0];
const BOUND_AT = [0.5, 0.56, 0, 0.06];

function quadRest(): QuadPose {
  return { lift: 0, pitch: 0, roll: 0, neck: [0, 0], head: [0, 0, 0], ears: [[0, 0], [0, 0]], tail: [0, 0, 0], legs: LEGS.map(() => [0, 0, 0]), foot: [0, 0, 0, 0], breath: 0, jaw: 0, squash: 0 };
}

function mixPose(a: QuadPose, b: QuadPose, t: number): QuadPose {
  const m = (x: number, y: number): number => x + (y - x) * t;
  return {
    lift: m(a.lift, b.lift), pitch: m(a.pitch, b.pitch), roll: m(a.roll, b.roll),
    neck: [m(a.neck[0], b.neck[0]), m(a.neck[1], b.neck[1])],
    head: [m(a.head[0], b.head[0]), m(a.head[1], b.head[1]), m(a.head[2], b.head[2])],
    ears: [[m(a.ears[0][0], b.ears[0][0]), m(a.ears[0][1], b.ears[0][1])], [m(a.ears[1][0], b.ears[1][0]), m(a.ears[1][1], b.ears[1][1])]],
    tail: [m(a.tail[0], b.tail[0]), m(a.tail[1], b.tail[1]), m(a.tail[2], b.tail[2])],
    legs: a.legs.map((l, i) => [m(l[0], b.legs[i][0]), m(l[1], b.legs[i][1]), m(l[2], b.legs[i][2])] as [number, number, number]),
    foot: a.foot.map((f, i) => m(f, b.foot[i])),
    breath: m(a.breath, b.breath), jaw: m(a.jaw, b.jaw), squash: m(a.squash, b.squash),
  };
}

/**
 * The trunk: the body's own bone with a squash in it, a landing pressing it
 * flatter and wider and a leap drawing it out, which only what hangs on it
 * feels -- the legs and the head hang on the body and keep their lengths.
 */
export function trunkOf(body: Xf, squash: number): Xf {
  if (!squash) return body;
  const a = 1 + squash * 0.45, c = 1 - squash;
  const m = body.m;
  return { m: [m[0] * a, m[1] * a, m[2] * c, m[3] * a, m[4] * a, m[5] * c, m[6] * a, m[7] * a, m[8] * c], t: body.t };
}

/** Where the shadow goes and how big it is: under the body, and smaller the further the body is off the ground. */
export function shadowOf(body: Xf, lift: number): Xf {
  const k = 1 / (1 + Math.max(0, lift) * 0.22);
  return { m: [k, 0, 0, 0, k, 0, 0, 0, 1], t: [body.t[0], body.t[1], 0] };
}

/**
 * Standing about: breathing, looking round, an ear flicked now and then, the
 * tail going, the weight shifting, a sniff at the air; and, grazing, the head
 * down at the ground and nibbling.
 */
function quadStill(s: QuadSpec, a: Anim): QuadPose {
  const p = quadRest();
  const t = a.t;
  p.breath = a.breath;
  const look = drift(t);
  const sniff = beat(t, [6.5, 17.2], 1.3);
  // Looking about, but never so far round that the face is turned away from somebody watching it side on.
  p.neck = [-2 + 4 * sniff, 8 * look];
  p.head = [2 * cyc(t, 5) - 10 * sniff + 3 * sniff * Math.sin(t * 22), 6 * look, 5 * drift(t, 2)];
  p.ears = [[28 * beat(t, [3.1, 12.4, 20.3], 0.32), 0], [28 * beat(t, [8.7, 15.6], 0.32), 0]];
  p.tail = [0, 10 * cyc(t, 9), 0];
  p.roll = 1.2 * cyc(t, 3);
  // Grazing: the chest let down onto folded fore legs and the neck bowed, so the muzzle meets the grass with the whole face above
  // it -- the head never pitched far past level -- and cropping: a tug at the grass on every other still, in bursts.
  const gz = a.graze;
  if (gz > 0) {
    const burst = 0.45 + 0.55 * Math.max(0, cyc(t, 8));
    // Seventy-two turns a loop: a half turn to each sixth of a second, which is what the stills are drawn at.
    const alt = cyc(t, 72);
    const tug = alt * burst;
    const bow = gz * (s.bow ?? 16);
    p.pitch -= bow;
    p.legs[0][1] += gz * 0.85;
    p.legs[1][1] += gz * 0.85;
    p.neck[0] += gz * (s.graze ?? 22);
    p.neck[1] *= 1 - gz * 0.7;
    // The head is carried at its own pitch against the body, so the chest's bow is given back to it: `nose` is how far past its
    // own carriage it goes down, whatever the chest is doing. The tug is the head's alone, a nod of seven degrees either way with
    // the jaw: put into the chest or the neck, it swung the muzzle a long way on a long neck and tipped the whole body on every
    // other still, as the feet were stood again under it (`grazingBones`).
    p.head[0] += bow - gz * ((s.nose ?? 14) + 7 * tug);
    p.head[1] *= 1 - gz * 0.6;
    p.head[2] *= 1 - gz * 0.8;
    p.jaw = gz * (0.5 + 0.5 * alt);
    // The ears laid back along the neck rather than tipped forward with the head.
    const back = 14 + 0.9 * (s.nose ?? 14) + (s.graze ?? 22) * 0.4;
    p.ears = [[p.ears[0][0] + back * gz, 8 * gz], [p.ears[1][0] + back * gz, 8 * gz]];
  }
  return p;
}

/** Going: every leg through its own stride, and the rest of the body carried by them. */
function quadGoing(s: QuadSpec, a: Anim): QuadPose {
  const p = quadRest();
  const g = a.gait, u = a.u;
  const duty = lerp(s.duty?.[0] ?? 0.64, s.duty?.[1] ?? (s.bound ? 0.3 : 0.4), g);
  const amp = lerp(s.swing[0], s.swing[1], g);
  const beats = s.bound ? BOUND_AT : g < 0.5 ? WALK_AT : TROT_AT;
  p.legs = LEGS.map((_, i) => step(u + beats[i], duty, amp));
  const w = frac(u);
  p.breath = 0.5;
  // A walk nods twice a stride; a run rocks the back once, and lifts the whole body clear of the ground between the beats.
  p.neck = [3 * Math.sin(w * TAU * 2) * (1 - g) + 5 * g, 0];
  p.head = [-3 * Math.sin(w * TAU * 2) * (1 - g) - 4 * g, 0, 0];
  p.pitch = g * (s.rock ?? 5) * Math.sin(w * TAU + (s.bound ? Math.PI / 2 : 0));
  p.lift = g * (s.bound ? 1.4 : 0.5) * Math.max(0, Math.sin(w * TAU * (s.bound ? 1 : 2)));
  p.roll = (1 - g) * 1.5 * Math.sin(w * TAU);
  p.tail = [g * 20, 14 * Math.sin(w * TAU) * (1 - g * 0.5), g * -10];
  p.ears = [[10 + 25 * g, 0], [10 + 25 * g, 0]];
  return p;
}

/** The pose for what the body is doing: still and going mixed by how far it is between them. */
export function quadPose(s: QuadSpec, a: Anim): QuadPose {
  if (a.go <= 0) return quadStill(s, a);
  if (a.go >= 1) return quadGoing(s, a);
  return mixPose(quadStill(s, a), quadGoing(s, a), smooth(a.go));
}

/**
 * The bones of a body on four legs in a pose, stood on its feet: the lowest
 * sole goes down to the ground, which is what makes a stride rise and fall.
 * Bones: `body`, `neck`, `head`, `jaw`, `ear0` and `ear1` (left, right),
 * `tail0`.., and for each leg (`fl`, `fr`, `hl`, `hr`) `0` its upper, `1` its
 * lower and `2` its foot.
 */
export function quadBones(s: QuadSpec, p: QuadPose): Bones {
  const body = joint(ROOT, [0, 0, s.high], p.pitch, p.roll, 0);
  const b: Bones = { body };
  const lean = s.neck.lean + p.neck[0];
  b.neck = joint(body, s.neck.at, -lean, 0, p.neck[1]);
  // The head carried level (at its own pitch) whatever the neck is doing under it.
  b.head = joint(b.neck, [0, 0, s.neck.len], lean + (s.head?.pitch ?? 0) + p.head[0], p.head[2], p.head[1]);
  b.jaw = joint(b.head, [0, 0, 0], -8 * p.jaw);
  if (s.ears) {
    for (let k = 0; k < 2; k++) {
      const sd = k ? 1 : -1;
      // Laid back (a positive pitch takes an upright ear toward the tail) and splayed out.
      b[`ear${k}`] = joint(b.head, [sd * s.ears.at[0], s.ears.at[1], s.ears.at[2]], s.ears.back + p.ears[k][0], sd * (s.ears.out + p.ears[k][1]), 0);
    }
  }
  if (s.tail) {
    const tl = s.tail;
    let prev = joint(body, tl.at, -(tl.lift + p.tail[0]), 0, p.tail[1] * 0.5);
    b.tail0 = prev;
    for (let k = 1; k < tl.links; k++) {
      prev = joint(prev, [0, -tl.len, 0], -(tl.curl + p.tail[2]), 0, p.tail[1] * 0.5 / tl.links);
      b[`tail${k}`] = prev;
    }
  }
  LEGS.forEach((leg, i) => {
    const spec = leg.fore ? s.fore : s.hind;
    const rest = spec.rest ?? [0, 0, 0];
    const [sw, fold, off] = p.legs[i];
    const folds = spec.fold ?? [45, 75];
    const kneeFold = fold * lerp(folds[0], folds[1], clamp(Math.abs(sw) / 40));
    const up = joint(body, [leg.side * spec.at[0], spec.at[1], spec.at[2]], rest[0] + sw, 0, 0);
    const lo = joint(up, [0, 0, -spec.len[0]], rest[1] - kneeFold);
    // The foot kept flat to the ground while it bears weight, and let curl back as it swings.
    const flat = -(p.pitch + rest[0] + sw + rest[1] - kneeFold);
    const ft = joint(lo, [0, 0, -spec.len[1]], lerp(flat, flat * 0.4 - 35 * fold, clamp(off * 3)) + rest[2] + p.foot[i]);
    b[`${leg.key}0`] = up;
    b[`${leg.key}1`] = lo;
    b[`${leg.key}2`] = ft;
  });
  // Stood on the lowest sole, and lifted from there by as much as the pose says it is off the ground.
  let low = Infinity;
  for (const leg of LEGS) {
    const spec = leg.fore ? s.fore : s.hind;
    const [ahead, behind] = spec.toe ?? [0.3, 0.3];
    for (const y of [ahead, -behind]) low = Math.min(low, place(b[`${leg.key}2`], [0, y, -spec.len[2]])[2]);
  }
  b.trunk = trunkOf(body, p.squash);
  const out = lifted(b, -low + p.lift);
  out.shadow = shadowOf(out.body, p.lift);
  return out;
}

/** How far the hind feet's soles are over the fore feet's, in a body stood on its lowest sole (`quadBones`): nought or less when all four are down. */
function hindOverFore(s: QuadSpec, b: Bones): number {
  let fore = Infinity, hind = Infinity;
  for (const leg of LEGS) {
    const spec = leg.fore ? s.fore : s.hind;
    const [ahead, behind] = spec.toe ?? [0.3, 0.3];
    for (const y of [ahead, -behind]) {
      const z = place(b[`${leg.key}2`], [0, y, -spec.len[2]])[2];
      if (leg.fore) fore = Math.min(fore, z);
      else hind = Math.min(hind, z);
    }
  }
  return hind - fore;
}

/**
 * The bones of a body grazing, stood on its feet. Bowing the chest tips the
 * body forward over its fore legs, and stood on its lowest sole a body long
 * behind them has its hind feet off the ground; so it is tipped back toward
 * level until the hind feet are down too -- the head, carried against the
 * body, kept at its pitch -- and the neck bowed further, so the head is where
 * it was, down at the grass. A neck too short to reach the grass from a body
 * that level keeps the body tipped as far as it needs: grazing is the head at
 * the grass, and a hind foot a little off it is the lesser fault.
 */
function grazingBones(s: QuadSpec, p: QuadPose): Bones {
  const b = quadBones(s, p);
  if (hindOverFore(s, b) <= 0.02) return b;
  const head = b.head.t[2];
  const pitch = p.pitch, nod = p.head[0], bow = p.neck[0];
  const pose = (back: number, more: number): Bones => {
    p.pitch = pitch + back;
    p.head[0] = nod - back;
    p.neck[0] = bow + more;
    return quadBones(s, p);
  };
  // As far as the neck bows before it hangs straight down, tipped back by `back`: past that, bowing it further lifts the head.
  const most = (back: number): number => Math.max(0, 172 - (s.neck.lean + bow) + pitch + back);
  // How far back it must tip for the hind feet to come down.
  let lo = 0, hi = Math.max(4, -pitch + 6);
  for (let q = 0; q < 10; q++) {
    const mid = (lo + hi) / 2;
    if (hindOverFore(s, pose(mid, 0)) > 0.02) lo = mid;
    else hi = mid;
  }
  // And back no further than the neck, bowed as far as it goes, still reaches the grass from.
  let back = hi;
  if (pose(back, most(back)).head.t[2] > head) {
    lo = 0;
    for (let q = 0; q < 10; q++) {
      const mid = (lo + back) / 2;
      if (pose(mid, most(mid)).head.t[2] > head) back = mid;
      else lo = mid;
    }
    back = lo;
  }
  // The neck bowed as far as puts the head where it was.
  lo = 0;
  hi = most(back);
  for (let q = 0; q < 10; q++) {
    const mid = (lo + hi) / 2;
    if (pose(back, mid).head.t[2] > head) lo = mid;
    else hi = mid;
  }
  return pose(back, hi);
}

/** A kind on four legs: its bones posed from its spec, with anything of its own laid over the pose. */
export function quadBonesOf(s: QuadSpec, own?: (p: QuadPose, a: Anim) => void): (a: Anim) => Bones {
  return (a) => {
    const p = quadPose(s, a);
    if (own) own(p, a);
    return a.graze > 0 && a.go < 1 ? grazingBones(s, p) : quadBones(s, p);
  };
}

/* ---- drawing --------------------------------------------------------------------- */

const kits = new Map<string, Piece[]>();
/** A kind's pieces, built once for each fineness they are drawn at. */
export function kitOf(id: string, kind: Kind, lod: number): Piece[] {
  const key = `${id}|${lod}`;
  let kit = kits.get(key);
  if (!kit) {
    kit = kind.build(lod);
    kits.set(key, kit);
  }
  return kit;
}

const breathOf = (v: readonly V3[], c: V3, k: number): V3[] =>
  v.map((p) => [c[0] + (p[0] - c[0]) * (1 + k), p[1], c[2] + (p[2] - c[2]) * (1 + k)]);

/** The pieces of a kit on posed bones, as the parts `render` draws. */
/** A rare body's shine (`shineOn` in `./figure`): how rare it is, what sets its glint apart from another's, and the time. */
export interface BeastShine { rare: number; seed: number; now: number }

export function partsOf(kit: readonly Piece[], b: Bones, a: Anim, breath: number, shine?: BeastShine): Part[] {
  const byKey = new Map<string, Part>();
  const out: Part[] = [];
  for (const pc of kit) {
    if (pc.shown && !pc.shown(a)) continue;
    const xf = b[pc.bone];
    if (!xf) continue;
    const mesh = a.blink && pc.shut ? pc.shut : pc.mesh;
    const part: Part = { mesh, xf, bias: pc.bias ?? 0, convex: pc.convex, front: pc.front, hide: pc.hide, hideIn: pc.hideIn ? b[pc.hideIn] : undefined, toon: true, lines: pc.lines, airy: pc.airy, rim: pc.rim, sheen: pc.sheen, thin: pc.thin, chain: pc.chain };
    // A rare body shines the whole of it, as a rare thing worn does: every piece of it one rarity, so one glint crosses it all.
    if (shine?.rare) {
      part.rare = shine.rare;
      part.seed = shine.seed;
    }
    // What reshapes a piece goes on one after another: a fleece grown back still breathes.
    if (pc.bent) part.v = pc.bent(mesh.v, a);
    if (pc.breathes) part.v = breathOf(part.v ?? mesh.v, pc.breathes.c, pc.breathes.k * (breath - 0.5));
    byKey.set(pc.key, part);
    out.push(part);
  }
  const refs = (r: string | string[]): Part[] => (Array.isArray(r) ? r : [r]).map((k) => byKey.get(k)).filter((x): x is Part => !!x);
  for (const pc of kit) {
    const part = byKey.get(pc.key);
    if (!part) continue;
    if (pc.after) part.after = refs(pc.after);
    if (pc.under) part.under = refs(pc.under);
  }
  return out;
}

/**
 * What a thing standing on the ground puts on it right under itself: the
 * colour the trees throw, cool rather than black, laid along the body and
 * thrown a little away from the light.
 */
function contact(g: CanvasRenderingContext2D, view: View, b: Bones, half: [number, number]): void {
  const s = b.shadow ?? (b.body ? { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [b.body.t[0], b.body.t[1], 0] as V3 } : { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] as V3 });
  const c = s.t, k = s.m[0];
  g.save();
  g.transform(view.ex[0] * k, view.ex[1] * k, view.ey[0] * k, view.ey[1] * k, c[0] * view.ex[0] + c[1] * view.ey[0], c[0] * view.ex[1] + c[1] * view.ey[1]);
  g.fillStyle = 'rgba(44,74,78,0.2)';
  g.beginPath();
  g.ellipse(0.25, -0.1, half[1] * 1.05, half[0] * 1.02, 0, 0, TAU);
  g.fill();
  g.restore();
}

/** Light drawn over a body: bright in the middle, gone at its edge, and added to what is under it. */
function glows(g: CanvasRenderingContext2D, view: View, list: ReadonlyArray<{ p: V3; r: number; c: RGB; a: number }>): void {
  if (!list.length) return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const l of list) {
    const [x, y] = onScreen(view, l.p);
    const grad = g.createRadialGradient(x, y, 0, x, y, l.r);
    grad.addColorStop(0, `rgba(${l.c[0] | 0},${l.c[1] | 0},${l.c[2] | 0},${l.a})`);
    grad.addColorStop(0.45, `rgba(${l.c[0] | 0},${l.c[1] | 0},${l.c[2] | 0},${l.a * 0.35})`);
    grad.addColorStop(1, `rgba(${l.c[0] | 0},${l.c[1] | 0},${l.c[2] | 0},0)`);
    g.fillStyle = grad;
    g.fillRect(x - l.r, y - l.r, l.r * 2, l.r * 2);
  }
  g.restore();
}

/** One body, posed, with its feet at the origin of `g` in the figure's own units; `bare`, without its shadow or its light, for a silhouette. */
export function drawKind(g: CanvasRenderingContext2D, kind: Kind, kit: readonly Piece[], pal: Palette, facing: number, a: Anim, ink: number, px: number, bare = false, shine?: BeastShine): void {
  const b = kind.bones(a);
  const view = viewOf(facing);
  if (!bare) contact(g, view, b, kind.shadow);
  kind.extra?.(g, view, b, a, true);
  render(g, partsOf(kit, b, a, a.breath, shine), pal, view, ink, px, shine?.now ?? 0);
  kind.extra?.(g, view, b, a, false);
  if (kind.glow && !bare) glows(g, view, kind.glow(b, a));
}

/** Where a kind standing still puts ink round its feet, at a facing, in its own units: for a page that frames it. */
export function extentOf(kind: Kind, kit: readonly Piece[], facing: number, a: Anim): { x0: number; y0: number; x1: number; y1: number } {
  const b = kind.bones(a);
  const view = viewOf(facing);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pc of kit) {
    if (pc.shown && !pc.shown(a)) continue;
    const xf = b[pc.bone];
    if (!xf) continue;
    for (const v of pc.mesh.v) {
      const [x, y] = onScreen(view, place(xf, v));
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

/**
 * Where a kind's head is over its feet, standing, facing one of the eight
 * ways, in screen units at zoom one with its size in it: the middle of its
 * head piece, which is where the reins of a team come to (`drawReins`).
 * Nothing for a kind with no head piece.
 */
const heads = new Map<string, [number, number] | null>();
export function headOf(id: string, kind: Kind, facing: number): [number, number] | null {
  const f = ((Math.round(facing) % 8) + 8) % 8;
  const key = `${id}|${f}`;
  if (heads.has(key)) return heads.get(key) ?? null;
  const a: Anim = { t: 0, u: 0, go: 0, gait: 0, graze: 0, blink: false, breath: 0.5, fleece: 1, seed: 0 };
  const b = kind.bones(a);
  const view = viewOf(f);
  let sx = 0, sy = 0, n = 0;
  for (const pc of kitOf(id, kind, 0)) {
    if (pc.key !== 'head' || !b[pc.bone]) continue;
    for (const v of pc.mesh.v) {
      const [x, y] = onScreen(view, place(b[pc.bone], v));
      sx += x;
      sy += y;
      n++;
    }
  }
  const out: [number, number] | null = n ? [(sx / n) * (kind.size ?? 1), (sy / n) * (kind.size ?? 1)] : null;
  heads.set(key, out);
  return out;
}

/* ---- a body drawn frame after frame ------------------------------------------------ */

/** What the island says a wildermon is doing, as the renderer hands it over. */
export interface BeastPose {
  /** Who it is, for a body drawn frame after frame: with it, it turns and starts and stops smoothly, and is kept as a picture between. */
  id?: number | string;
  facing: number;
  phase: number;
  moving: boolean;
  gait?: number;
  fleece?: number;
  /** Head down at the ground: foraging, standing. */
  graze?: boolean;
  /** How rare it is, a step (`RARITIES`): a rare one shines, and is drawn afresh every frame for its light to move. */
  rare?: number;
}

/** How long a turn of an eighth takes, and how fast a body gets going or settles, per second. */
const TURN = 0.1;
const GET_GOING = 7;
const GET_GRAZING = 2.5;

interface Held {
  facing: number; goal: number; turnFrom: number; turnSince: number; go: number; graze: number; seen: number;
  /** Where it is in its stride, the walk phase that was counted up to, and when; and strides to a radian of the phase last frame: see `strideOf`. */
  u?: number; phase?: number; at?: number; k?: number;
}
const held = new Map<string, Held>();

/** A number of its own for each body, from its id: nought to one. */
export function seedOf(id: number | string | undefined): number {
  if (id === undefined) return 0.37;
  const s = String(id);
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

/**
 * Where a body drawn frame after frame is: turned the short way round from
 * the last of the eight ways to the next, rather than cut; eased into going
 * and out of it, and down to the grass and up.
 */
function settle(id: string, p: BeastPose, now: number): { facing: number; go: number; graze: number; changing: boolean } {
  const goal = ((Math.round(p.facing) % 8) + 8) % 8;
  let h = held.get(id);
  if (!h || now - h.seen > 0.5) {
    h = { facing: goal, goal, turnFrom: goal, turnSince: -1, go: p.moving ? 1 : 0, graze: p.graze && !p.moving ? 1 : 0, seen: now };
    held.set(id, h);
    if (held.size > 512) for (const [k, v] of held) if (now - v.seen > 5) held.delete(k);
  }
  const dt = Math.min(0.1, Math.max(0, now - h.seen));
  h.seen = now;
  h.go += ((p.moving ? 1 : 0) - h.go) * Math.min(1, dt * GET_GOING);
  h.graze += ((p.graze && !p.moving ? 1 : 0) - h.graze) * Math.min(1, dt * GET_GRAZING);
  if (goal !== h.goal) {
    h.goal = goal;
    h.turnFrom = h.facing;
    h.turnSince = now;
  }
  let d = h.goal - h.turnFrom;
  d -= 8 * Math.round(d / 8);
  const k = clamp((now - h.turnSince) / (TURN * Math.max(1, Math.abs(d))));
  h.facing = k < 1 ? h.turnFrom + d * smooth(k) : h.goal;
  const changing = k < 1 || (h.go > 0.01 && h.go < 0.99) || (h.graze > 0.01 && h.graze < 0.99);
  return { facing: h.facing, go: h.go < 0.01 ? 0 : h.go > 0.99 ? 1 : h.go, graze: h.graze < 0.01 ? 0 : h.graze, changing };
}

/**
 * How many strides a second a body's legs go through at most, at a walk and
 * at a run. The island moves its animals several of their own lengths a
 * second, faster than legs their length could carry them: stepped as fast as
 * the ground goes by, they would be a blur. So they step as fast as this,
 * and their feet keep up with the ground only when it goes by slowly enough.
 */
const CADENCE: readonly [number, number] = [3.2, 4.2];

/**
 * Where a body drawn frame after frame is in its stride: counted up from how
 * far its walk phase has gone since the last frame, at the rate its gait
 * wants (`strideRate`) and no faster than `CADENCE`, so that breaking into a
 * run lengthens its strides without its legs jumping to another part of one.
 * A phase gone backwards or a long way at once -- a body put somewhere else
 * -- starts it afresh.
 */
function strideOf(id: string, kind: Kind, phase: number, gait: number, now: number): number {
  const h = held.get(id);
  const rate = strideRate(kind, gait);
  if (!h) return phase * rate;
  if (h.u === undefined || h.phase === undefined || h.at === undefined || phase < h.phase || phase - h.phase > TAU) {
    h.u = phase * rate;
    h.k = rate;
  } else if (phase > h.phase) {
    const du = Math.min((phase - h.phase) * rate, lerp(CADENCE[0], CADENCE[1], clamp(gait)) * Math.max(0, now - h.at));
    h.u += du;
    h.k = du / (phase - h.phase);
  }
  h.phase = phase;
  h.at = now;
  return h.u;
}

/** Whether its eyes are shut, `t` into the loop: a blink every four seconds, six to a loop. */
const blinking = (kind: Kind, t: number): boolean => {
  const every = kind.blinks ?? 4;
  return every > 0 && frac(t / every) * every < 0.16;
};

/** What a body is doing this frame, for a kind: its clock (round the loop), its stride, its breath and its blink. */
export function animOf(kind: Kind, p: BeastPose, now: number, go: number, graze: number): Anim {
  const seed = seedOf(p.id);
  const t = frac((now + seed * 97) / LOOP) * LOOP;
  // A blink every four seconds, a little off the beat for each kind: six a loop.
  return {
    t, u: p.phase * strideRate(kind, go > 0 ? (p.gait ?? 0) : 0), go, gait: go > 0 ? (p.gait ?? 0) : 0, graze, blink: blinking(kind, t),
    breath: (0.5 + 0.5 * cyc(t, 7)) * (1 - go) + 0.5 * go,
    fleece: p.fleece ?? 1, seed,
  };
}

/**
 * A body on the island is not drawn afresh every frame, nor even once for
 * each body. Every kind is kept as pictures -- one for each facing, each
 * twelfth of a stride at a walk and at a run, and each sixth of a second of
 * its loop standing or grazing -- and each is drawn the first time a body
 * wants it and put down from then on. So a herd of woolas walking the same
 * way share twelve pictures between them, and a settlement full of animals
 * standing about costs what putting down pictures costs. Only a body turning
 * or getting going or settling is drawn for itself, while it does it.
 */
const STRIDE_FRAMES = 12;
const STAND_FPS = 6;
/**
 * The scales pictures are drawn at, a zoom taking the next one up and
 * shrinking it: the island's zoom is a wheel, and a picture for every notch
 * of it would be drawn and thrown away. Each a fourth of an octave over the
 * last, so a picture is never shrunk by more than a sixth, which keeps its
 * edges and its outline crisp.
 */
const STEPS = Array.from({ length: 21 }, (_, q) => 0.5 * 2 ** (q / 4));
/**
 * How long, in milliseconds, new pictures may take in any sixtieth of a
 * second. A herd come into view at once, or a zoom, wants a great many new
 * pictures in the same moment; past this, a body waiting for its next one
 * keeps the one before it a little longer, and the pictures fill in over the
 * next few frames rather than all in one.
 */
const ALLOWANCE = 4;
let spent = 0, since = 0;
function drawingAllowed(): boolean {
  const now = performance.now();
  if (now - since > 16) { since = now; spent = 0; }
  return spent < ALLOWANCE;
}

/** How many pixels of pictures are kept, all told, before the ones longest unused go. */
const BUDGET = 14_000_000;

interface Frame { canvas: HTMLCanvasElement; ox: number; oy: number; k: number; px: number }
const frames = new Map<string, Frame>();
let framePixels = 0;

function keep(key: string, f: Frame): void {
  frames.set(key, f);
  framePixels += f.px;
  if (framePixels > BUDGET) {
    for (const [k2, v] of frames) {
      frames.delete(k2);
      framePixels -= v.px;
      if (framePixels < BUDGET * 0.8) break;
    }
  }
}

/** How far round its feet a kind can reach at any facing and in any pose, in its own units, with room to spare: the size of its picture. */
const reach = new Map<string, { left: number; right: number; top: number; bottom: number }>();
function reachOf(id: string, kind: Kind, kit: readonly Piece[]): { left: number; right: number; top: number; bottom: number } {
  let r = reach.get(id);
  if (!r) {
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    const a: Anim = { t: 0, u: 0, go: 0, gait: 0, graze: 0, blink: false, breath: 0.5, fleece: 1, seed: 0 };
    for (let f = 0; f < 8; f++) {
      for (const [go, u, gz, g] of [[0, 0, 0, 0], [1, 0.25, 0, 0], [1, 0.75, 0, 0], [1, 0.4, 0, 1], [1, 0.9, 0, 1], [0, 0, 1, 0]]) {
        const e = extentOf(kind, kit, f, { ...a, go, u, gait: g, graze: gz });
        x0 = Math.min(x0, e.x0); x1 = Math.max(x1, e.x1); y0 = Math.min(y0, e.y0); y1 = Math.max(y1, e.y1);
      }
    }
    const pad = 3 + (x1 - x0) * 0.1;
    r = { left: x0 - pad, right: x1 + pad, top: y0 - pad * 1.5, bottom: Math.max(y1, 0) + pad };
    reach.set(id, r);
  }
  return r;
}

/** The top of a kind standing, over its feet, in screen units at zoom one: where a name or a health bar goes over it. */
export function topOf(id: string, kind: Kind): number {
  const r = reachOf(id, kind, kitOf(id, kind, 0));
  return (-r.top - 3 - (r.right - r.left) * 0.1 * 1.5) * (kind.size ?? 1);
}

/**
 * How wide the outline is, in a kind's own units, drawn at `step` (the
 * island's zoom times the kind's size): what a person is outlined in at the
 * island's zoom (`drawFigure`), whatever size the kind is drawn -- an ogre is
 * not inked in a rope, nor a rabba in a line wider than the person beside it
 * -- but never under a pixel and a tenth, which holds a small pale body off
 * the grass when the island is seen from furthest out.
 */
const inkAt = (step: number, size = 1): number => Math.max(1.1, (0.7 * step) / size) / step;

/**
 * A wildermon of a kind with its feet at (sx, sy), at `zoom` (its age already
 * in it), in the colours of its variant.
 */
export function drawBeast(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, species: string, kind: Kind, colors: [string, string], p: BeastPose): void {
  zoom *= kind.size ?? 1;
  const now = performance.now() / 1000;
  const id = p.id !== undefined ? String(p.id) : undefined;
  const s = id ? settle(id, p, now) : { facing: ((Math.round(p.facing) % 8) + 8) % 8, go: p.moving ? 1 : 0, graze: p.graze && !p.moving ? 1 : 0, changing: false };
  const a = animOf(kind, p, now, s.go, s.graze);
  if (id) a.u = strideOf(id, kind, p.phase, a.gait, now);
  // A body that leaps is carried in the air rather than at an even pace (`leapOf`): how far ahead of the island's place for it, or
  // behind, it is drawn, along the way it faces, for the part of its stride its picture is.
  const going = s.go > 0.5 && id ? held.get(id)?.k : undefined;
  const reach = going ? UNITS_PER_TILE / PHASE_PER_TILE / (kind.size ?? 1) / going : 0;
  const uc = a.u;
  const pal = paletteFor(species, kind, colors);
  const t = ctx.getTransform();
  const dev = Math.hypot(t.a, t.b) || 1;
  const step = STEPS.find((z) => z >= zoom * 0.98) ?? STEPS[STEPS.length - 1];
  const lod = step < 1.5 ? 0 : 1;
  const kit = kitOf(species, kind, lod);
  const ahead = (u: number): [number, number] => {
    if (!reach) return [0, 0];
    const off = leapOf(kind, a.gait, u, reach) + (frac(u) - frac(uc)) * reach;
    const ey = viewOf(s.facing).ey;
    return [off * ey[0] * zoom, off * ey[1] * zoom];
  };
  // Turning, getting going or settling, or rare, its light crossing it: drawn for itself, as it is this frame.
  if (s.changing || !Number.isInteger(s.facing) || p.rare) {
    const [ax, ay] = ahead(a.u);
    ctx.save();
    ctx.translate(sx + ax, sy + ay);
    ctx.scale(zoom, zoom);
    const shine = p.rare ? { rare: p.rare, seed: typeof p.id === 'number' ? p.id % 97 : 0, now } : undefined;
    drawKind(ctx, kind, kit, pal, s.facing, a, inkAt(zoom, kind.size), 1 / zoom, false, shine);
    ctx.restore();
    return;
  }
  // Which picture it is: a twelfth of a stride going, a sixth of a second of the loop standing.
  let prefix: string, i: number, count: number;
  if (s.go > 0) {
    const run = a.gait > 0.5;
    i = Math.floor(frac(a.u) * STRIDE_FRAMES);
    count = STRIDE_FRAMES;
    prefix = run ? 'r' : 'w';
    a.u = Math.floor(a.u) + (i + 0.5) / STRIDE_FRAMES;
    a.gait = run ? 1 : 0;
  } else {
    i = Math.floor(a.t * STAND_FPS);
    count = LOOP * STAND_FPS;
    prefix = s.graze > 0 ? 'g' : 's';
    a.t = (i + 0.5) / STAND_FPS;
    a.blink = blinking(kind, a.t);
    a.breath = 0.5 + 0.5 * cyc(a.t, 7);
  }
  const fleece = Math.round(clamp(a.fleece) * 6);
  a.fleece = fleece / 6;
  const head = `${species}|${colors[0]}|${colors[1]}|${s.facing}|`;
  const base = `${head}${step}|${dev}|`;
  const key = `${base}${prefix}${i}|${fleece}`;
  let fkey = key;
  let f = frames.get(key);
  // Over this moment's allowance for new pictures, the nearest one before it that is already drawn does, for now; or, a zoom
  // under way, the same one drawn at a scale near this, stretched to it.
  if (!f && !drawingAllowed()) {
    for (let back = 1; back <= 8 && !f; back++) {
      fkey = `${base}${prefix}${(i - back + count) % count}|${fleece}`;
      f = frames.get(fkey);
    }
    const at = STEPS.indexOf(step);
    for (let d = 1; d < STEPS.length && !f; d++) {
      for (const q of [at - d, at + d]) {
        if (f || q < 0 || q >= STEPS.length) continue;
        fkey = `${head}${STEPS[q]}|${dev}|${prefix}${i}|${fleece}`;
        f = frames.get(fkey);
      }
    }
  }
  if (f) {
    frames.delete(fkey);
    frames.set(fkey, f);
  } else {
    const t0 = performance.now();
    const box = reachOf(species, kind, kit);
    const k = step * dev;
    const w = Math.max(1, Math.ceil((box.right - box.left) * k)), h = Math.max(1, Math.ceil((box.bottom - box.top) * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    f = { canvas, ox: Math.round(-box.left * k), oy: Math.round(-box.top * k), k, px: w * h };
    g.setTransform(k, 0, 0, k, f.ox, f.oy);
    drawKind(g, kind, kit, pal, s.facing, a, inkAt(step, kind.size), 1 / step);
    keep(key, f);
    spent += performance.now() - t0;
  }
  const [ax, ay] = s.go > 0 ? ahead(a.u) : [0, 0];
  ctx.drawImage(f.canvas, sx + ax - (f.ox / f.k) * zoom, sy + ay - (f.oy / f.k) * zoom, (f.canvas.width / f.k) * zoom, (f.canvas.height / f.k) * zoom);
}

const palettes = new Map<string, Palette>();
/** A kind's palette in a variant's colours, made once. */
export function paletteFor(species: string, kind: Kind, colors: [string, string]): Palette {
  const key = `${species}|${colors[0]}|${colors[1]}`;
  let pal = palettes.get(key);
  if (!pal) {
    pal = kind.palette(hex(colors[0]), hex(colors[1]));
    palettes.set(key, pal);
  }
  return pal;
}

const portraits = new Map<string, HTMLCanvasElement>();
/**
 * A kind on its own, for a page: standing, grown and fleeced, turned the way
 * `facing` says and scaled to fill a `w` by `h` box on `ctx`, feet down. With
 * `ink`, every pixel of it that one colour instead: the shape and nothing
 * else, for a kind nobody has seen yet.
 */
export function drawBeastPortrait(ctx: CanvasRenderingContext2D, w: number, h: number, species: string, kind: Kind, colors: [string, string], facing = 1, ink?: string, t = 0): void {
  // Drawn once for each size and look it is wanted at, and put down from then on: a page of forty of them opens at once.
  const key = `${species}|${colors[0]}|${colors[1]}|${facing}|${Math.round(w)}|${Math.round(h)}|${ink ?? ''}|${t}`;
  let pic = portraits.get(key);
  if (!pic) {
    pic = document.createElement('canvas');
    pic.width = Math.max(1, Math.ceil(w));
    pic.height = Math.max(1, Math.ceil(h));
    const g = pic.getContext('2d');
    if (!g) return;
    const kit = kitOf(species, kind, 1);
    const a: Anim = { t, u: 0, go: 0, gait: 0, graze: 0, blink: false, breath: 0.5, fleece: 1, seed: 0.3 };
    const e = extentOf(kind, kit, facing, a);
    const bw = e.x1 - e.x0, bh = Math.max(e.y1, 0) - e.y0;
    const k = Math.min(w / Math.max(1, bw), h / Math.max(1, bh)) * 0.92;
    g.translate(w / 2 - ((e.x0 + e.x1) / 2) * k, h / 2 + (bh / 2) * k - Math.max(e.y1, 0) * k);
    g.scale(k, k);
    drawKind(g, kind, kit, paletteFor(species, kind, colors), facing, a, Math.max(0.9, 1.2 * Math.min(1, 40 / (bh * k))) / k, 1 / k, !!ink);
    // A kind nobody has seen yet: every pixel of it one colour, the shape and nothing else.
    if (ink) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = ink;
      g.fillRect(0, 0, pic.width, pic.height);
    }
    if (portraits.size > 256) portraits.clear();
    portraits.set(key, pic);
  }
  ctx.drawImage(pic, 0, 0);
}

/* ---- a body on two legs, with wings ------------------------------------------------ */

export interface BirdSpec {
  /** Where the body bone sits over the ground before the feet are stood on it. */
  high: number;
  /** The hip on the right, the thigh and the shank and the drop to the sole, and how they stand (degrees). */
  leg: { at: V3; len: [number, number, number]; rest: [number, number] };
  neck: { at: V3; len: number; lean: number };
  head?: { pitch: number };
  /** The shoulder on the right, where the folded wing hangs from. */
  wing: { at: V3 };
  /** Where the tail comes out, and how far it is lifted, in degrees. */
  tail: { at: V3; lift: number };
  /** Swing of a leg at a walk and at a run. */
  swing: [number, number];
  /** Both feet together, a hop, rather than one after the other. */
  hop?: boolean;
  /** How far the head is thrust forward and drawn back with each step, in degrees of the neck: a pigeon's walk. */
  thrust?: number;
  /** Foraging: how far down the neck goes, in degrees past its lean; how far the body tips forward; how far the head goes down past level. */
  peck?: number;
  tip?: number;
  nose?: number;
  /** Foraging, how far the legs bend at the knee (nought standing tall, one as deep as a hop's crouch). */
  crouch?: number;
  /** Foraging, how much of the body's tip the legs are given back (one: they stand as they did; nought: they tip with it). */
  stance?: number;
  /** How far the body rolls from foot to foot: a waddle. */
  waddle?: number;
}

export interface BirdPose {
  lift: number; pitch: number; roll: number;
  neck: [number, number]; head: [number, number, number];
  /** Each wing, left then right: how far open (nought folded, one spread), and how far up. */
  wings: [[number, number], [number, number]];
  tail: [number, number];
  legs: Array<[number, number, number]>;
  jaw: number;
}

function birdRest(): BirdPose {
  return { lift: 0, pitch: 0, roll: 0, neck: [0, 0], head: [0, 0, 0], wings: [[0, 0], [0, 0]], tail: [0, 0], legs: [[0, 0, 0], [0, 0, 0]], jaw: 0 };
}

function mixBird(a: BirdPose, b: BirdPose, t: number): BirdPose {
  const m = (x: number, y: number): number => x + (y - x) * t;
  return {
    lift: m(a.lift, b.lift), pitch: m(a.pitch, b.pitch), roll: m(a.roll, b.roll),
    neck: [m(a.neck[0], b.neck[0]), m(a.neck[1], b.neck[1])],
    head: [m(a.head[0], b.head[0]), m(a.head[1], b.head[1]), m(a.head[2], b.head[2])],
    wings: [[m(a.wings[0][0], b.wings[0][0]), m(a.wings[0][1], b.wings[0][1])], [m(a.wings[1][0], b.wings[1][0]), m(a.wings[1][1], b.wings[1][1])]],
    tail: [m(a.tail[0], b.tail[0]), m(a.tail[1], b.tail[1])],
    legs: a.legs.map((l, i) => [m(l[0], b.legs[i][0]), m(l[1], b.legs[i][1]), m(l[2], b.legs[i][2])] as [number, number, number]),
    jaw: m(a.jaw, b.jaw),
  };
}

/** A bird standing: looking about in jerks, as a bird does, a flick of the tail, a shake of the wings now and then; pecking, foraging. */
function birdStill(s: BirdSpec, a: Anim): BirdPose {
  const p = birdRest();
  const t = a.t;
  // A bird's head does not drift; it holds and then snaps to the next thing it looks at, eighteen times a loop.
  const looks = 18, at = (t * looks) / LOOP, k = Math.floor(at);
  const lookAt = (q: number): number => { const r = ((q % looks) + looks) % looks; return Math.sin(r * 2.7) * (0.6 + 0.4 * Math.sin(r * 1.3)); };
  const snap = smooth(clamp((at - k) * 6));
  p.head = [4 * Math.sin(k * 1.9), 40 * lerp(lookAt(k - 1), lookAt(k), snap), 10 * Math.sin((k % looks) * 3.1)];
  p.neck = [2 * cyc(t, 4), 0];
  p.tail = [8 * beat(t, [2.2, 5.6, 9.9, 14.1, 18.8, 22.3], 0.25), 0];
  const shake = beat(t, [11.3], 0.6);
  p.wings = [[0.25 * shake, 0.3 * shake], [0.25 * shake, 0.3 * shake]];
  p.pitch = a.breath * 1.5 - 0.75;
  const gz = a.graze;
  if (gz > 0) {
    // Foraging: the body tipped forward over its feet, tail up, and the neck bowed down to the ground in front of them, with the
    // head no further down than a fifth of a turn past level so the face still shows; and picking at the ground, a nod of three
    // degrees either way on every other still, in bursts.
    const burst = 0.45 + 0.55 * Math.max(0, cyc(t, 8));
    const tug = cyc(t, 72) * burst;
    const tip = gz * (s.tip ?? 30);
    p.pitch -= tip;
    p.neck[0] += gz * (s.peck ?? 50);
    // The head is carried against the body, so the tip is given back to it: it goes down `nose` past its own carriage, and the
    // pick is its nod alone.
    p.head[0] += tip - gz * ((s.nose ?? 18) + 3 * tug);
    p.head[1] *= 1 - gz * 0.8;
    p.head[2] *= 1 - gz * 0.8;
    // The legs are jointed to the body, so tipping it swung them back under it: each thigh is given the tip back (`stance` of
    // it), and the legs stand as they did, bent at the knee as far as `crouch` says, which is how a long-legged bird gets its
    // bill down.
    for (const l of p.legs) {
      l[0] += tip * (s.stance ?? 1) + gz * 20 * (s.crouch ?? 0);
      l[1] += gz * (s.crouch ?? 0);
    }
  }
  return p;
}

/** A bird going: stepping or hopping, the head thrust and drawn back with each step, the tail countering, the wings a little out at a run. */
function birdGoing(s: BirdSpec, a: Anim): BirdPose {
  const p = birdRest();
  const g = a.gait, w = frac(a.u);
  const amp = lerp(s.swing[0], s.swing[1], g);
  if (s.hop) {
    // Both feet push off together, the body goes up and forward, and they come through to land ahead.
    const air = Math.sin(clamp((w - 0.1) / 0.55) * Math.PI);
    const legs = step(a.u, 0.4, amp);
    p.legs = [legs, legs];
    p.lift = (0.8 + 0.8 * g) * (w > 0.1 && w < 0.65 ? air : 0);
    p.pitch = 8 * Math.sin(w * TAU);
    p.tail = [-12 * Math.sin(w * TAU), 0];
  } else {
    p.legs = [step(a.u, lerp(0.62, 0.42, g), amp), step(a.u + 0.5, lerp(0.62, 0.42, g), amp)];
    p.roll = (s.waddle ?? 3) * Math.sin(w * TAU);
    p.lift = g * 0.4 * Math.max(0, Math.sin(w * TAU * 2));
    p.tail = [4 * Math.sin(w * TAU * 2), (s.waddle ?? 3) * 1.5 * Math.sin(w * TAU)];
  }
  // The head held still while the body passes under it, then thrust ahead: a saw-tooth on the neck.
  const th = s.thrust ?? 10;
  const saw = frac(w * (s.hop ? 1 : 2));
  p.neck = [th * (saw < 0.7 ? 1 - saw / 0.7 : (saw - 0.7) / 0.3) - th * 0.5 + 6 * g, 0];
  p.head = [-p.neck[0] * 0.7, 0, 0];
  p.wings = [[0.2 * g, 0.3 * g], [0.2 * g, 0.3 * g]];
  return p;
}

/**
 * The bones of a bird in a pose, stood on its feet. Bones: `body`, `neck`,
 * `head`, `jaw`, `wing0` and `wing1` (left, right), `tail0`, and for each
 * leg (`bl`, `br`) `0` its thigh, `1` its shank and `2` its foot.
 */
export function birdBones(s: BirdSpec, a: Anim, own?: (p: BirdPose, a: Anim) => void): Bones {
  const p = a.go <= 0 ? birdStill(s, a) : a.go >= 1 ? birdGoing(s, a) : mixBird(birdStill(s, a), birdGoing(s, a), smooth(a.go));
  if (own) own(p, a);
  const body = joint(ROOT, [0, 0, s.high], p.pitch, p.roll, 0);
  const b: Bones = { body };
  const lean = s.neck.lean + p.neck[0];
  b.neck = joint(body, s.neck.at, -lean, 0, p.neck[1]);
  b.head = joint(b.neck, [0, 0, s.neck.len], lean + (s.head?.pitch ?? 0) + p.head[0], p.head[2], p.head[1]);
  b.jaw = joint(b.head, [0, 0, 0], -10 * p.jaw);
  for (let k = 0; k < 2; k++) {
    const sd = k ? 1 : -1;
    const [open, up] = p.wings[k];
    // A wing folds along the flank; opened, it swings out from the shoulder and up.
    b[`wing${k}`] = joint(body, [sd * s.wing.at[0], s.wing.at[1], s.wing.at[2]], -10 * open, sd * (70 * up), sd * 55 * open);
  }
  b.tail0 = joint(body, s.tail.at, -(s.tail.lift + p.tail[0]), 0, p.tail[1]);
  const [lp, kp] = s.leg.rest;
  ['bl', 'br'].forEach((key, i) => {
    const sd = i ? 1 : -1;
    const [sw, fold, off] = p.legs[i];
    const th = joint(body, [sd * s.leg.at[0], s.leg.at[1], s.leg.at[2]], lp + sw, 0, 0);
    const sh = joint(th, [0, 0, -s.leg.len[0]], kp - 50 * fold);
    const flat = -(p.pitch + lp + sw + kp - 50 * fold);
    b[`${key}0`] = th;
    b[`${key}1`] = sh;
    b[`${key}2`] = joint(sh, [0, 0, -s.leg.len[1]], lerp(flat, flat - 40 * fold, clamp(off * 3)));
  });
  let low = Infinity;
  for (const key of ['bl', 'br']) for (const y of [0.35, -0.2]) low = Math.min(low, place(b[`${key}2`], [0, y, -s.leg.len[2]])[2]);
  return lifted(b, -low + p.lift);
}

/* ---- a body stood upright on two legs ----------------------------------------------- */

export interface BipedSpec {
  /** Where the hips sit over the ground before the feet are stood on it. */
  high: number;
  /** The hip on the right, the thigh, the shin and the drop to the sole, and how they stand (degrees). */
  leg: { at: V3; len: [number, number, number]; rest: [number, number] };
  /** The chest's joint on the hips, and how far forward it is bowed. */
  chest: { at: V3; lean: number };
  neck: { at: V3; len: number; lean: number };
  head?: { pitch: number };
  /** The shoulder on the right, the upper arm and the forearm, and how they hang: forward, out, elbow bent (degrees). */
  arm: { at: V3; len: [number, number]; rest: [number, number, number] };
  tail?: { at: V3; lift: number; len: number; links: number };
  swing: [number, number];
  /** How far it rolls from foot to foot, and turns with each step: a waddle. */
  waddle?: number;
  /** How far the arms swing with the stride, against the legs. */
  armSwing?: number;
}

export interface BipedPose {
  lift: number; pitch: number; roll: number; yaw: number;
  chest: [number, number, number];
  neck: [number, number]; head: [number, number, number];
  /** Each arm: forward, out, elbow. */
  arms: [[number, number, number], [number, number, number]];
  legs: Array<[number, number, number]>;
  tail: [number, number];
  jaw: number;
}

function bipedRest(): BipedPose {
  return { lift: 0, pitch: 0, roll: 0, yaw: 0, chest: [0, 0, 0], neck: [0, 0], head: [0, 0, 0], arms: [[0, 0, 0], [0, 0, 0]], legs: [[0, 0, 0], [0, 0, 0]], tail: [0, 0], jaw: 0 };
}

function mixBiped(a: BipedPose, b: BipedPose, t: number): BipedPose {
  const m = (x: number, y: number): number => x + (y - x) * t;
  const m3 = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [m(x[0], y[0]), m(x[1], y[1]), m(x[2], y[2])];
  return {
    lift: m(a.lift, b.lift), pitch: m(a.pitch, b.pitch), roll: m(a.roll, b.roll), yaw: m(a.yaw, b.yaw),
    chest: m3(a.chest, b.chest), neck: [m(a.neck[0], b.neck[0]), m(a.neck[1], b.neck[1])], head: m3(a.head, b.head),
    arms: [m3(a.arms[0], b.arms[0]), m3(a.arms[1], b.arms[1])],
    legs: a.legs.map((l, i) => m3(l, b.legs[i])), tail: [m(a.tail[0], b.tail[0]), m(a.tail[1], b.tail[1])], jaw: m(a.jaw, b.jaw),
  };
}

/** Standing: breathing, the weight from foot to foot, looking about; foraging, bent over at the ground and digging at it. */
function bipedStill(s: BipedSpec, a: Anim): BipedPose {
  const p = bipedRest();
  const t = a.t;
  const look = drift(t);
  const w = Math.tanh(2.5 * cyc(t, 3));
  p.chest = [1.5 * (a.breath - 0.5), 2 * w, 0];
  p.roll = -2 * w;
  p.neck = [0, 10 * look];
  p.head = [3 * cyc(t, 4), 16 * look, 6 * drift(t, 3)];
  p.arms = [[4 + 2 * a.breath, 0, 8], [4 + 2 * a.breath, 0, 8]];
  p.tail = [0, 8 * cyc(t, 5)];
  const gz = a.graze;
  if (gz > 0) {
    // Bent over whatever it is at, both hands down at it and working.
    const dig = cyc(t, 30);
    p.chest[0] += gz * 38;
    p.head[0] -= gz * 22;
    p.head[1] *= 1 - gz * 0.8;
    p.arms = [[p.arms[0][0] + gz * (48 + 12 * dig), 5 * gz, 30 * gz], [p.arms[1][0] + gz * (48 - 12 * dig), 5 * gz, 30 * gz]];
    p.legs = [[gz * 18, gz * 0.35, 0], [gz * 18, gz * 0.35, 0]];
  }
  return p;
}

/** Walking or running: the legs through their strides, the arms against them, and the body rolling and bobbing over its feet. */
function bipedGoing(s: BipedSpec, a: Anim): BipedPose {
  const p = bipedRest();
  const g = a.gait, w = frac(a.u);
  const amp = lerp(s.swing[0], s.swing[1], g);
  const duty = lerp(0.6, 0.4, g);
  p.legs = [step(a.u, duty, amp), step(a.u + 0.5, duty, amp)];
  const wd = s.waddle ?? 3;
  p.roll = wd * Math.sin(w * TAU);
  p.yaw = wd * 0.8 * Math.cos(w * TAU);
  p.lift = g * 0.35 * Math.max(0, Math.sin(w * TAU * 2));
  p.chest = [4 + 10 * g, 0, -p.yaw * 0.8];
  p.head = [-2 - 6 * g, -p.yaw * 0.5, -p.roll * 0.5];
  const sw = (s.armSwing ?? 20) * (1 + 0.6 * g);
  p.arms = [[sw * Math.sin(w * TAU), 4, 12 + 30 * g], [-sw * Math.sin(w * TAU), 4, 12 + 30 * g]];
  p.tail = [6 * g, wd * 2 * Math.sin(w * TAU)];
  return p;
}

/**
 * The bones of a body on two legs in a pose, stood on its feet. Bones:
 * `body` (the hips), `chest`, `neck`, `head`, `jaw`, `arm0`/`arm1` (the
 * upper arms, left and right), `elbow0`/`elbow1`, `hand0`/`hand1`, `tail0`..,
 * and for each leg (`ll`, `lr`) `0` its thigh, `1` its shin and `2` its foot.
 */
export function bipedBones(s: BipedSpec, a: Anim, own?: (p: BipedPose, a: Anim) => void): Bones {
  const p = a.go <= 0 ? bipedStill(s, a) : a.go >= 1 ? bipedGoing(s, a) : mixBiped(bipedStill(s, a), bipedGoing(s, a), smooth(a.go));
  if (own) own(p, a);
  const body = joint(ROOT, [0, 0, s.high], p.pitch, p.roll, p.yaw);
  const b: Bones = { body };
  b.chest = joint(body, s.chest.at, -(s.chest.lean + p.chest[0]), p.chest[1], p.chest[2]);
  const lean = s.neck.lean + p.neck[0];
  b.neck = joint(b.chest, s.neck.at, -lean, 0, p.neck[1]);
  b.head = joint(b.neck, [0, 0, s.neck.len], lean + s.chest.lean + p.chest[0] + (s.head?.pitch ?? 0) + p.head[0], p.head[2], p.head[1]);
  b.jaw = joint(b.head, [0, 0, 0], -12 * p.jaw);
  for (let k = 0; k < 2; k++) {
    const sd = k ? 1 : -1;
    const [fw, out, el] = p.arms[k];
    b[`arm${k}`] = joint(b.chest, [sd * s.arm.at[0], s.arm.at[1], s.arm.at[2]], s.arm.rest[0] + fw, -sd * (s.arm.rest[1] + out), 0);
    b[`elbow${k}`] = joint(b[`arm${k}`], [0, 0, -s.arm.len[0]], s.arm.rest[2] + el);
    b[`hand${k}`] = joint(b[`elbow${k}`], [0, 0, -s.arm.len[1]]);
  }
  if (s.tail) {
    let prev = joint(body, s.tail.at, -(s.tail.lift + p.tail[0]), 0, p.tail[1]);
    b.tail0 = prev;
    for (let k = 1; k < s.tail.links; k++) {
      prev = joint(prev, [0, -s.tail.len, 0], 0, 0, p.tail[1] * 0.4);
      b[`tail${k}`] = prev;
    }
  }
  const [lp, kp] = s.leg.rest;
  ['ll', 'lr'].forEach((key, i) => {
    const sd = i ? 1 : -1;
    const [sw, fold, off] = p.legs[i];
    const th = joint(body, [sd * s.leg.at[0], s.leg.at[1], s.leg.at[2]], lp + sw + 20 * fold, 0, 0);
    const kn = kp - 55 * fold;
    const sh = joint(th, [0, 0, -s.leg.len[0]], kn);
    const flat = -(p.pitch + lp + sw + 20 * fold + kn);
    b[`${key}0`] = th;
    b[`${key}1`] = sh;
    b[`${key}2`] = joint(sh, [0, 0, -s.leg.len[1]], lerp(flat, flat - 25 * fold, clamp(off * 3)));
  });
  let low = Infinity;
  for (const key of ['ll', 'lr']) for (const y of [0.5, -0.3]) low = Math.min(low, place(b[`${key}2`], [0, y, -s.leg.len[2]])[2]);
  return lifted(b, -low + p.lift);
}
