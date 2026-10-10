import type { LightSource } from '../game/light';
import { HALF_H, HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from './iso';
import { hashOf, MOSS, PPM, rand, STAGES, strandPic, type StrandKind } from './ivy';
import { star } from './shine';
import { VIEWS } from './view';

/**
 * The runestones: five great standing stones round the Crescent's inner bay,
 * where the Telestone carries you.
 *
 * Each is one monolith three or four storeys tall on a low mossy outcrop that
 * fills the three-by-three tiles it stands on, with ivy and moss coming up
 * from the foot, flowers round it and carved pieces fallen off it lying in
 * the grass. Down one broad face runs a sunk panel with a column of runes in
 * it under a carved roundel, and a shorter one down the other; the runes
 * glow, each breathing on its own beat a little after the one under it, so
 * the light seems to climb the stone.
 *
 * It is built the way furniture is (`furniture.ts`): a small model in tenths
 * of a metre -- across it, toward its carved front, and up -- of faceted
 * solids, put on the screen through the camera's turn, so it stands right at
 * all eight viewpoints and walking round it shows its back. The stone itself
 * is a plate: an outline of its face pushed back through its thickness, its
 * edges chamfered, sheared over as far as it leans and thinning toward the
 * top. The outcrop and the fallen pieces are boulders and plates of the same
 * kind, and every face is lit as furniture is, the left of two faces paler.
 *
 * It is drawn once for each way it is seen and each scale (`BAKE_STEPS`) and
 * kept; a frame after that is one blit and the runes' light over it, which is
 * a small picture of each rune laid at its own strength (`drawRunestone`).
 * After dark the runes take the night back off themselves (`runestoneHoles`)
 * and the stone throws a small pool of pale gold round itself
 * (`runestoneLight`), as an altar's stars do.
 *
 * The whole of it sorts as one thing, at the middle of its middle tile: the
 * outcrop fills the footprint, so nothing stands inside it, and whatever
 * stands round it is behind the middle when it is behind every tile of the
 * footprint it is beside, and in front of it when it is in front.
 */

const TAU = Math.PI * 2;
type Pt = [number, number];
type V3 = [number, number, number];
type RGB = [number, number, number];
type Ctx = CanvasRenderingContext2D;

/* ---- what there is --------------------------------------------------------- */

export type RunestoneId = 'crownstone' | 'mossmere' | 'harrowmark' | 'wardenfall' | 'sunreach';
export const RUNESTONE_IDS: readonly RunestoneId[] = ['crownstone', 'mossmere', 'harrowmark', 'wardenfall', 'sunreach'];
/** What each is called, on Look and under the pointer. */
export const RUNESTONE_NAMES: Record<RunestoneId, string> = {
  crownstone: 'The Crownstone',
  mossmere: 'Mossmere Stone',
  harrowmark: 'Harrowmark',
  wardenfall: 'The Wardenfall',
  sunreach: 'Sunreach Stone',
};
/** Tiles a runestone covers each way, its own tile in the middle. */
export const RUNESTONE_SPAN = 3;

/**
 * The light it throws after dark: a pool of pale gold reaching two tiles
 * from its middle, just past its outcrop, steady, falling off smoothly as a spell's light does --
 * enough to light the outcrop and whoever stands at its foot, and faint
 * enough that the runes and not the ground are the brightest thing there.
 * Drawn only, as an altar's is: no rule asks how far it reaches.
 */
export const RUNESTONE_REACH = 2.1;
export const RUNESTONE_GLOW = 0.28;
export const RUNESTONE_CAST = '255, 204, 128';
export const RUNESTONE_CAST_ALPHA = 0.28;
/** The light of a runestone whose middle is at world (x, y), for the island's list of lights. */
export const runestoneLight = (x: number, y: number): LightSource => ({
  x, y, radius: RUNESTONE_REACH, strength: RUNESTONE_GLOW, steady: true, soft: true, cast: RUNESTONE_CAST, castAlpha: RUNESTONE_CAST_ALPHA,
});

/* ---- small sums ------------------------------------------------------------ */

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** `o` and so much of each of the rest. */
const at = (o: V3, ...terms: Array<[number, V3]>): V3 => terms.reduce<V3>((p, [k, v]) => add(p, mul(v, k)), o);
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const css = (c: RGB, a = 1): string => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The normal of a polygon, however many corners and however nearly flat. */
function newell(pts: readonly V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return unit([x, y, z]);
}

/** Twice the signed area of an outline: more than nought going round anticlockwise. */
const area2 = (p: readonly Pt[]): number => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length];
  return s + a[0] * b[1] - b[0] * a[1];
}, 0);

/** An anticlockwise outline drawn in by `d` all round, its corners mitred and the sharp ones kept short. */
function inset(poly: readonly Pt[], d: number): Pt[] {
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i + n - 1) % n], b = poly[(i + 1) % n];
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1, l2 = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const n1: Pt = [(p[1] - a[1]) / l1, -(p[0] - a[0]) / l1], n2: Pt = [(b[1] - p[1]) / l2, -(b[0] - p[0]) / l2];
    const m: Pt = [n1[0] + n2[0], n1[1] + n2[1]];
    const ml = Math.hypot(m[0], m[1]);
    if (ml < 1e-6) return [p[0], p[1]] as Pt;
    const k = Math.min(d / (ml / 2), d * 2.2);
    return [p[0] - (m[0] / ml) * k, p[1] - (m[1] / ml) * k] as Pt;
  });
}

/** Smooth noise over the plane, nought to one, a cell a unit wide: where moss has got to and where it has not. */
function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number): number => hashOf(a, b, seed, 977);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Whether a point is inside an outline. */
function inside(poly: readonly Pt[], x: number, y: number): boolean {
  let n = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) n = !n;
  }
  return n;
}

/* ---- seeing it ------------------------------------------------------------- */

/**
 * How the stone's own frame lands on the screen from one viewpoint: the
 * pixels at zoom one a unit across it (`u`) and toward its front (`v`) carry
 * you, and the way toward the eye in its frame, which a face has to be
 * turned to be seen and which says what is in front of what.
 */
interface Eye {
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  toward: V3;
}

function eyeOf(yaw: number, rotation: number): Eye {
  const { cos, sin } = VIEWS[((rotation % 8) + 8) % 8];
  const scr = (dx: number, dy: number): Pt => {
    const u = dx * cos + dy * sin, v = dy * cos - dx * sin;
    return [((u - v) * HALF_W) / UNITS_PER_TILE, ((u + v) * HALF_H) / UNITS_PER_TILE];
  };
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const [ux, uy] = scr(c, s);
  const [vx, vy] = scr(-s, c);
  const k = vx * uy - ux * vy;
  const g = Math.sign(k) || 1;
  return { ux, uy, vx, vy, toward: [g * vx, -g * ux, (g * k) / HEIGHT_SCALE] };
}

/** A point of the model on the screen, in pixels at zoom one from the middle of its footprint. */
const proj = (e: Eye, p: V3): Pt => [p[0] * e.ux + p[1] * e.vx, p[0] * e.uy + p[1] * e.vy - p[2] * HEIGHT_SCALE];
/** How near the eye a point is: more is nearer. */
const nearness = (e: Eye, p: V3): number => dot(p, e.toward);
/** How near the eye a spot on the ground is, for laying whole things in order. */
const groundNear = (e: Eye, x: number, y: number): number => x * e.toward[0] + y * e.toward[1];

/**
 * How much light a face turned along `n` catches, as every piece on the
 * island is lit: a top all of it, a side more the further round to the left
 * of the screen it looks (`Scene.light` in `furniture.ts`).
 */
function lightOf(e: Eye, n: V3): number {
  const sx = n[0] * e.ux + n[1] * e.vx, sy = n[0] * e.uy + n[1] * e.vy;
  const l = Math.hypot(sx, sy);
  const side = l < 1e-9 ? 0.84 : 0.84 - (0.15 * sx) / l;
  const up = Math.max(0, Math.min(1, n[2]));
  return up + (1 - up) * side;
}

/* ---- stone ----------------------------------------------------------------- */

/**
 * A stone's colours: what a face full in the light is, and what one turned
 * right away from it is -- not the lit colour darkened but a cool lilac grey,
 * pale stone in shade going toward the sky's colour as the marble does
 * (`masonry.ts`). The carving is cut in the shade colour, a step deeper.
 */
interface Tone {
  lit: RGB;
  shade: RGB;
}

const toneOf = (lit: string, shade: string): Tone => ({ lit: hex(lit), shade: hex(shade) });
/** The colour of a face that catches `L` of the light. */
const faceColour = (t: Tone, L: number): RGB => mix(t.lit, t.shade, Math.max(0, Math.min(1, (1 - L) / 0.31)) * 0.92);

/** The warm ink every piece on the island is edged in, here a stone's: a warm grey-brown, never black. */
const STONE_INK: RGB = hex('#5f5148');
/** And the lighter ink between two faces of one stone. */
const CREASE_INK: RGB = hex('#8a7c74');

/* ---- solids ---------------------------------------------------------------- */

/** What is painted on a face: in the face's own frame when it has one, `k.base` for the screen. */
interface PaintCtx {
  e: Eye;
  /** The light on the face. */
  L: number;
  /** The colour the face was filled with. */
  fill: RGB;
  /** The context's own transform before the face's frame went on: pixels at zoom one, from the footprint's middle. */
  base: DOMMatrix;
}
type Painter = (g: Ctx, k: PaintCtx) => void;

/** One face of a solid: its corners, which way it is turned, and what is painted on it in its frame. */
interface Face {
  pts: V3[];
  n: V3;
  tone: Tone;
  /** A point of the face and two directions along it, in model units: what it is painted in. */
  frame?: { o: V3; a: V3; b: V3 };
  /** Painted over the face, kept inside it. */
  paint?: Painter;
  /** Painted after every face of the solid, and let run over its edges: ivy hanging off a face. */
  over?: Painter;
  /** How strong the line round it is, against the faces beside it. */
  crease?: number;
}

/** A thing in the model: drawn whole in its turn, the nearest last, ruled round in ink if it is a solid. */
interface Thing {
  /** Where it stands, for the order: on the ground in the model's frame. */
  x: number;
  y: number;
  /** Laid before everything else whatever its place: the outcrop the rest stands on. */
  first?: boolean;
  faces?: Face[];
  /** What is not a solid: flowers, drawn on the screen at zoom one from the footprint's middle. */
  draw?: (g: Ctx, e: Eye) => void;
  /** Points it reaches, for the size of the picture. */
  reach?: V3[];
}

/**
 * A plate: an outline in its own frame -- `s` along `U`, `t` along `W` --
 * pushed through its thickness along `A` (its front), as thick as `half`
 * either side at `t = 0` and `t = tTop`, its edges chamfered by `bevel`.
 * A monolith is one, sheared as it leans; a fallen roundel is one lying in
 * the grass. What is painted on its front or back is in the face's frame:
 * `s` and `t` as the outline has them on the front, and `s` the other way on
 * the back, so the back reads the right way round from behind it.
 */
interface PlateOpts {
  o: V3;
  U: V3;
  W: V3;
  A: V3;
  outline: Pt[];
  half: [number, number];
  tTop: number;
  bevel: number;
  tone: Tone;
  front?: Painter;
  back?: Painter;
  frontOver?: Painter;
  backOver?: Painter;
  /** What is painted on the edge strips, in and over them: given which edge and how far it is turned up; its frame is along it and through it. */
  edge?: (i: number, up: number) => { paint?: Painter; over?: Painter } | undefined;
  /** Leave out the face along the bottom edge, which stands in the ground. */
  sunk?: boolean;
  /**
   * Where through it its thickness is centred, and how thick each way, at a
   * point (s, t) of its outline, given how thick it would be there: so the
   * horns of a crown or the halves of a split head can stand at different
   * depths and be told apart from the side.
   */
  depthAt?: (s: number, t: number, half: number) => [number, number];
}

function plate(o: PlateOpts): Face[] {
  const outline = area2(o.outline) < 0 ? o.outline.slice().reverse() : o.outline;
  const inner = inset(outline, o.bevel);
  const f = (o.half[1] - o.half[0]) / o.tTop;
  const h = (t: number): number => o.half[0] + f * t;
  const P = ([s, t]: Pt, side: number): V3 => at(o.o, [s, o.U], [t, o.W], [side, o.A]);
  // Where its thickness is centred and how thick it is at a point of the outline: its own rule, or even about the middle.
  const mid = (p: Pt): [number, number] => o.depthAt?.(p[0], p[1], h(p[1])) ?? [0, h(p[1])];
  const front = (p: Pt): V3 => { const [c, hh] = mid(p); return P(p, c + hh); };
  const back = (p: Pt): V3 => { const [c, hh] = mid(p); return P(p, c - hh); };
  const frontEdge = (p: Pt): V3 => { const [c, hh] = mid(p); return P(p, c + hh - o.bevel); };
  const backEdge = (p: Pt): V3 => { const [c, hh] = mid(p); return P(p, c - (hh - o.bevel)); };
  const faces: Face[] = [];
  const face = (pts: V3[], expect: V3, extra: Partial<Face> = {}): void => {
    let n = newell(pts);
    if (dot(n, expect) < 0) n = mul(n, -1);
    faces.push({ pts, n, tone: o.tone, ...extra });
  };
  const A = unit(o.A);
  face(inner.map(front), A, {
    frame: { o: at(o.o, [o.half[0], o.A]), a: o.U, b: at(o.W, [f, o.A]) },
    paint: o.front, over: o.frontOver, crease: 0.5,
  });
  face(inner.map(back).reverse(), mul(A, -1), {
    frame: { o: at(o.o, [-o.half[0], o.A]), a: mul(o.U, -1), b: at(o.W, [-f, o.A]) },
    paint: o.back, over: o.backOver, crease: 0.5,
  });
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = outline[i], q = outline[j];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const es = (q[0] - p[0]) / l, et = (q[1] - p[1]) / l;
    // Out across the edge, in the plane of the outline.
    const out = at([0, 0, 0], [et, o.U], [-es, o.W]);
    // The bottom of a monolith is in the ground: nothing is seen of it.
    if (o.sunk && Math.abs(es) > 0.9 && p[1] < 0.5 && q[1] < 0.5) continue;
    const side = [frontEdge(p), frontEdge(q), backEdge(q), backEdge(p)];
    const up = newell(side)[2] * Math.sign(dot(newell(side), out) || 1);
    const along = unit(sub(P(q, 0), P(p, 0)));
    const dress = o.edge?.(i, up);
    face([front(inner[i]), front(inner[j]), frontEdge(q), frontEdge(p)], add(out, A), { crease: 0.32 });
    face(side, out, { frame: { o: P(p, 0), a: along, b: A }, paint: dress?.paint, over: dress?.over, crease: 0.4 });
    face([backEdge(p), backEdge(q), back(inner[j]), back(inner[i])], sub(out, A), { crease: 0.32 });
  }
  return faces;
}

/**
 * A boulder: a ring of corners on the ground, two rings up it bulging out
 * over that and drawing in, and a smaller top, every one of them pushed about
 * by its seed so no two are the same stone -- rounded, lower than it is wide,
 * a step warmer or cooler than the next. Moss lies over its top as far as
 * `moss` says and down the sides it can be seen by, in masses where the
 * noise has it (`mossOver`).
 */
function boulder(cx: number, cy: number, rx: number, ry: number, h: number, turn: number, seed: number, tone: Tone, moss: number): Face[] {
  const R = rand(seed);
  const n = 9 + Math.floor(R() * 3);
  const c = Math.cos(turn), s = Math.sin(turn);
  const jit = Array.from({ length: n }, () => [(R() - 0.5) * 0.3, 1 + (R() - 0.5) * 0.22] as Pt);
  const ring = (k: number, z: number, jig: number): V3[] => jit.map(([da, dr], i) => {
    const a = (i / n) * TAU + da;
    const r = k * (dr + (R() - 0.5) * jig);
    const x = Math.cos(a) * rx * r, y = Math.sin(a) * ry * r;
    return [cx + x * c - y * s, cy + x * s + y * c, z + (R() - 0.5) * jig * h * 0.4] as V3;
  });
  const rings = [ring(1, -0.6, 0.06), ring(1.05, h * 0.42, 0.08), ring(0.9, h * 0.8, 0.1), ring(0.6, h, 0.14)];
  const warm = R();
  const own: Tone = { lit: mix(tone.lit, warm < 0.5 ? hex('#ecdcc4') : hex('#d7dad6'), 0.25 + 0.2 * R()), shade: mix(tone.shade, warm < 0.5 ? hex('#b39fa2') : hex('#9ca2ae'), 0.3) };
  const faces: Face[] = [];
  const face = (pts: V3[], expect: V3, extra: Partial<Face> = {}): void => {
    let nn = newell(pts);
    if (dot(nn, expect) < 0) nn = mul(nn, -1);
    faces.push({ pts, n: nn, tone: own, crease: 0.22, ...extra });
  };
  const bands: Array<{ pts: V3[]; k: number; n: V3 }> = [];
  for (let b = 0; b < 3; b++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const lo = rings[b], hi = rings[b + 1];
      const mid = mul(add(lo[i], lo[j]), 0.5);
      const out: V3 = [mid[0] - cx, mid[1] - cy, 0];
      const pts = [lo[i], lo[j], hi[j], hi[i]];
      face(pts, add(unit(out), [0, 0, b * 0.5]));
      bands.push({ pts, k: b / 2, n: faces[faces.length - 1].n });
    }
  }
  const top = rings[3];
  const hz = top.reduce((m, p) => m + p[2], 0) / n;
  const flat = top.map((p) => [p[0], p[1]] as Pt);
  face(top.slice(), [0, 0, 1], { frame: { o: [cx, cy, hz], a: [1, 0, 0], b: [0, 1, 0] }, crease: 0.3, over: moss > 0 ? mossOver(flat, hz, bands, moss, seed) : undefined });
  return faces;
}

/**
 * Moss over a boulder: on its top wherever the noise and how far it has got
 * allow, and down whichever of its sides are turned to the eye, thinning as
 * it goes down -- cushions on the screen at points of the stone, so they lie
 * flat on the top and stand up on the sides.
 */
function mossOver(top: Pt[], hz: number, bands: Array<{ pts: V3[]; k: number; n: V3 }>, moss: number, seed: number): Painter {
  return (g, k) => {
    const T = rand(seed * 3 + 1);
    const across = Math.hypot(k.e.ux, k.e.uy);
    const ps: Pad[] = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of top) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let j = 0, n = Math.round(((x1 - x0) * (y1 - y0)) / 1.5); j < n; j++) {
      const x = x0 + T() * (x1 - x0), y = y0 + T() * (y1 - y0);
      if (!inside(top, x, y)) continue;
      const nz = noise2(x / 4.5, y / 4.5, seed) * 0.75 + noise2(x / 1.8, y / 1.8, seed + 1) * 0.25;
      if (moss * 1.1 + (nz - 0.5) * 1.4 < 0.6) continue;
      const [px, py] = proj(k.e, [x, y, hz]);
      const r = cushion(T) + 0.35;
      ps.push([px, py, r * across, r * across * 0.6]);
    }
    for (const b of bands) {
      if (dot(b.n, k.e.toward) <= 1e-6) continue;
      const [p0, p1, p2, p3] = b.pts;
      for (let j = 0; j < 9; j++) {
        const u = 0.05 + 0.9 * T(), v = T();
        {
          const lo = add(p0, mul(sub(p1, p0), u)), hi = add(p3, mul(sub(p2, p3), u));
          const p = add(lo, mul(sub(hi, lo), v));
          const nz = noise2(p[0] / 4.5, p[1] / 4.5, seed);
          const share = moss * (b.k + v / 2) * 0.9;
          if (share * 1.3 + (nz - 0.5) * 1.3 < 0.66) continue;
          const [px, py] = proj(k.e, p);
          const r = cushion(T, share) + 0.2;
          ps.push([px, py, r * across, r * across * 0.85]);
        }
      }
    }
    g.save();
    g.setTransform(k.base);
    pads(g, ps);
    g.restore();
  };
}

/* ---- moss and lichen ------------------------------------------------------- */

/**
 * How big a cushion of moss is, in units: mostly small, now and then a big
 * one, bigger where the moss has got furthest (`share`, nought to one).
 */
const cushion = (R: () => number, share = 1): number => (0.6 + 1.8 * R() * R()) * (0.75 + 0.45 * Math.min(1, share));

/**
 * Cushions of moss, painted as the island's moss is (`cushions` in
 * `ivy.ts`): the dark under each a step down, the body over it, and a fleck
 * of light on the bigger ones -- here at points already on the screen, each
 * as wide as `rx` and as tall as `ry`, so a cushion on a top lies flat and
 * one on an upright face stands up.
 */
type Pad = [number, number, number, number];
function pads(g: Ctx, ps: readonly Pad[]): void {
  const pass = (fill: string, k: number, dx: number, dy: number, min = 0, every = 1): void => {
    g.beginPath();
    for (let i = 0; i < ps.length; i++) {
      const [x, y, rx, ry] = ps[i];
      if (rx < min || (every > 1 && (i * 7) % every)) continue;
      const cx = x + rx * dx, cy = y + ry * dy;
      g.moveTo(cx + rx * k, cy);
      g.ellipse(cx, cy, rx * k, ry * k, 0, 0, TAU);
    }
    g.fillStyle = fill;
    g.fill();
  };
  /*
   * The rim and the shade under it, then the body laid over them nearly as
   * big and only a little up: where cushions crowd together the body closes
   * over all of them, so the dark shows only along the lower edge of a whole
   * clump, as one line round it, never round each bead.
   */
  pass(MOSS.line, 1.1, 0.05, 0.24);
  pass(MOSS.dark, 1.04, 0.03, 0.14);
  pass(MOSS.under, 1, 0, 0.05);
  pass(MOSS.fill, 0.98, -0.02, -0.07);
  // The light on the bigger cushions now and then, so a mass of them is moss and not a pattern.
  pass(MOSS.lit, 0.58, -0.22, -0.32, 1.6, 3);
  pass('#c3dea6', 0.26, -0.3, -0.45, 2.2, 5);
}

/** Lichen: rosettes of pale yellow-green crust, flat on the stone, a fine darker rim round each. */
/** The lichen every stone has unless it says otherwise: a pale yellow-green and a grey-green. */
const LICHEN: [string, string] = ['#e6e0ae', '#d3dcb4'];

function lichen(g: Ctx, R: () => number, x: number, y: number, r: number, tones: [string, string] = LICHEN): void {
  const n = 3 + Math.floor(R() * 4);
  const blobs: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, d = R() * r * 0.7;
    blobs.push([x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.35 + R() * 0.4)]);
  }
  const all = (k: number, fill: string): void => {
    g.beginPath();
    for (const [bx, by, br] of blobs) {
      g.moveTo(bx + br * k, by);
      g.arc(bx, by, br * k, 0, TAU);
    }
    g.fillStyle = fill;
    g.fill();
  };
  const tone = hex(R() < 0.6 ? tones[0] : tones[1]);
  all(1.15, css(mix(tone, hex('#6e6648'), 0.5), 0.3));
  all(1, css(tone, 0.78));
  all(0.45, 'rgba(255, 252, 226, 0.5)');
}

/* ---- the carving ----------------------------------------------------------- */

/** A stroke of a glyph, in its own box a unit each way from its middle: across, and up. */
interface Stroke {
  pts: Pt[];
  closed?: boolean;
}
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 14, ry = r): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * ry] as Pt;
  });
const dotAt = (x: number, y: number): Stroke => ({ pts: [[x, y + 0.05], [x, y - 0.05]] });
const wave = (y: number, k = 1): Pt[] => Array.from({ length: 13 }, (_, i) => [-0.72 + (1.44 * i) / 12, y + Math.sin((i / 12) * TAU * 1.25) * 0.16 * k] as Pt);

/**
 * The runes, after the reference's: diamonds, stars, a crescent, crosses,
 * and the old staves -- each a few straight strokes, cut, the way runes are.
 */
const GLYPHS: Record<string, Stroke[]> = {
  diamond: [{ pts: [[0, 1], [0.62, 0], [0, -1], [-0.62, 0]], closed: true }],
  diamondDot: [{ pts: [[0, 1], [0.62, 0], [0, -1], [-0.62, 0]], closed: true }, dotAt(0, 0)],
  star8: [{ pts: [[0, 1], [0, -1]] }, { pts: [[-0.74, 0], [0.74, 0]] }, { pts: [[-0.44, 0.52], [0.44, -0.52]] }, { pts: [[-0.44, -0.52], [0.44, 0.52]] }],
  star6: [{ pts: [[0, 1], [0, -1]] }, { pts: [[-0.7, 0.52], [0.7, -0.52]] }, { pts: [[-0.7, -0.52], [0.7, 0.52]] }],
  crescent: [{ pts: [...arc(0, 0, 0.88, 1.05, TAU - 1.05, 16), ...arc(0.38, 0, 0.62, TAU - 1.32, 1.32, 12).slice(1, -1)], closed: true }],
  cross: [{ pts: [[-0.6, -0.9], [0.6, 0.9]] }, { pts: [[-0.6, 0.9], [0.6, -0.9]] }],
  algiz: [{ pts: [[0, -1], [0, 1]] }, { pts: [[-0.62, 0.92], [0, 0.22], [0.62, 0.92]] }],
  tiwaz: [{ pts: [[0, -1], [0, 1]] }, { pts: [[-0.6, 0.38], [0, 1], [0.6, 0.38]] }],
  ingwaz: [{ pts: [[0, 0.62], [0.48, 0], [0, -0.62], [-0.48, 0]], closed: true }, { pts: [[0, 1], [0, 0.62]] }, { pts: [[0, -0.62], [0, -1]] }],
  dagaz: [{ pts: [[-0.6, 0.9], [0.6, -0.9], [0.6, 0.9], [-0.6, -0.9]], closed: true }],
  othala: [{ pts: [[0.62, -1], [-0.5, 0.25], [0, 0.95], [0.5, 0.25], [-0.62, -1]] }],
  ring: [{ pts: arc(0, 0, 0.7, 0, TAU, 20), closed: true }, dotAt(0, 0)],
  sowilo: [{ pts: [[-0.38, 1], [0.44, 0.22], [-0.44, -0.22], [0.38, -1]] }],
  laguz: [{ pts: [[-0.3, -1], [-0.3, 1], [0.48, 0.42]] }],
  wave: [{ pts: wave(0.36) }, { pts: wave(-0.36) }],
  harrow: [{ pts: [[-0.66, 0.72], [0.66, 0.72]] }, { pts: [[-0.58, 0.72], [-0.58, -0.62]] }, { pts: [[0, 1], [0, -1]] }, { pts: [[0.58, 0.72], [0.58, -0.62]] }],
  eye: [{ pts: [...arc(0, -0.62, 1.05, 0.62, Math.PI - 0.62, 10), ...arc(0, 0.62, 1.05, Math.PI + 0.62, TAU - 0.62, 10).slice(1, -1)], closed: true }, { pts: arc(0, 0, 0.24, 0, TAU, 10), closed: true }],
  sunDot: [{ pts: arc(0, 0, 0.46, 0, TAU, 14), closed: true }, dotAt(0, 0), { pts: [[0, 0.68], [0, 1]] }, { pts: [[0, -0.68], [0, -1]] }, { pts: [[0.68, 0], [0.92, 0]] }, { pts: [[-0.68, 0], [-0.92, 0]] }],
  tri: [{ pts: [[0, 0.95], [0.66, -0.72], [-0.66, -0.72]], closed: true }],
  hourglass: [{ pts: [[-0.58, 0.9], [0.58, 0.9], [-0.58, -0.9], [0.58, -0.9]], closed: true }],
  key: [{ pts: [[0, -1], [0, 0.5]] }, { pts: arc(0, 0.72, 0.28, 0, TAU, 10), closed: true }, { pts: [[0, -0.45], [0.4, -0.45]] }, { pts: [[0, -0.8], [0.4, -0.8]] }],
};

/** A glyph's strokes as a path, at (x, y) in the face, `s` units from its middle to its top. */
function glyphPath(g: Ctx, name: string, x: number, y: number, s: number): void {
  g.beginPath();
  for (const st of GLYPHS[name] ?? []) {
    st.pts.forEach(([px, py], i) => (i ? g.lineTo(x + px * s, y + py * s) : g.moveTo(x + px * s, y + py * s)));
    if (st.closed) g.closePath();
  }
}

/**
 * A roundel: the carved disc at the head of the panel, ringed twice, with
 * what each stone has in it -- a crowned sun, a moon over water, a harrow's
 * wheel, a watching eye, a rising sun. As strokes in a unit disc.
 */
function roundelStrokes(kind: string): Stroke[] {
  const out: Stroke[] = [{ pts: arc(0, 0, 1, 0, TAU, 40), closed: true }, { pts: arc(0, 0, 0.86, 0, TAU, 36), closed: true }];
  const ray = (a: number, r0: number, r1: number): Stroke => ({ pts: [[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(a) * r1, Math.sin(a) * r1]] });
  if (kind === 'crown') {
    out.push({ pts: arc(0, 0, 0.36, 0, TAU, 20), closed: true });
    for (let i = 0; i < 16; i++) out.push(ray(Math.PI / 2 + (i / 16) * TAU, 0.44, i % 2 ? 0.6 : 0.76));
    out.push({ pts: [[-0.2, -0.12], [-0.2, 0.08], [-0.1, -0.02], [0, 0.16], [0.1, -0.02], [0.2, 0.08], [0.2, -0.12]], closed: true });
  } else if (kind === 'moon') {
    out.push({ pts: [...arc(-0.08, 0.1, 0.56, 0.95, TAU - 0.95, 18), ...arc(0.2, 0.12, 0.44, TAU - 1.18, 1.18, 12).slice(1, -1)], closed: true });
    out.push({ pts: arc(0.3, 0.14, 0.16, 0, TAU, 10), closed: true });
    out.push({ pts: wave(-0.58, 0.7).map(([x, y]) => [x * 0.86, y] as Pt) });
    out.push({ pts: wave(-0.72, 0.6).map(([x, y]) => [x * 0.62, y] as Pt) });
    for (const [x, y] of [[0.52, 0.46], [-0.5, 0.52], [0.6, -0.1]] as Pt[]) out.push(dotAt(x, y));
  } else if (kind === 'wheel') {
    out.push({ pts: arc(0, 0, 0.2, 0, TAU, 12), closed: true });
    for (let i = 0; i < 8; i++) out.push(ray((i / 8) * TAU + Math.PI / 8, 0.2, 0.86));
    for (let i = 0; i < 8; i++) out.push(ray((i / 8) * TAU, 0.62, 0.74));
  } else if (kind === 'star' || kind === 'star8') {
    // A star of eight points, long and short by turns, round a small ring: a compass rose for Sunreach, a plain star for the Crownstone.
    const n = 8, pts: Pt[] = [];
    for (let i = 0; i < n * 2; i++) {
      const a = Math.PI / 2 + (i / (n * 2)) * TAU, r = i % 2 ? 0.26 : i % 4 === 0 ? 0.78 : (kind === 'star8' ? 0.56 : 0.78);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    out.push({ pts, closed: true });
    out.push({ pts: arc(0, 0, 0.14, 0, TAU, 10), closed: true });
    if (kind === 'star8') for (let i = 0; i < 4; i++) out.push(ray(Math.PI / 4 + (i / 4) * TAU, 0.3, 0.8));
  } else if (kind === 'wave') {
    out.push({ pts: wave(0.34, 0.9).map(([x, y]) => [x * 0.95, y] as Pt) });
    out.push({ pts: wave(0, 0.9).map(([x, y]) => [x * 1.05, y] as Pt) });
    out.push({ pts: wave(-0.34, 0.9).map(([x, y]) => [x * 0.95, y] as Pt) });
    out.push({ pts: arc(0, 0.62, 0.12, 0, TAU, 8), closed: true });
  } else if (kind === 'hourglass') {
    out.push({ pts: [[-0.46, 0.62], [0.46, 0.62], [-0.46, -0.62], [0.46, -0.62]], closed: true });
    out.push({ pts: [[-0.62, 0.62], [0.62, 0.62]] });
    out.push({ pts: [[-0.62, -0.62], [0.62, -0.62]] });
    for (let i = 0; i < 6; i++) out.push(ray((i / 6) * TAU, 0.72, 0.82));
  } else if (kind === 'key') {
    out.push({ pts: arc(0, 0.34, 0.26, 0, TAU, 14), closed: true });
    out.push({ pts: [[0, 0.08], [0, -0.72]] });
    out.push({ pts: [[0, -0.42], [0.3, -0.42]] });
    out.push({ pts: [[0, -0.64], [0.3, -0.64]] });
    for (let i = 0; i < 4; i++) out.push(ray(Math.PI / 4 + (i / 4) * TAU, 0.62, 0.76));
  } else if (kind === 'eye') {
    out.push({ pts: [...arc(0, -0.42, 0.74, 0.6, Math.PI - 0.6, 12), ...arc(0, 0.42, 0.74, Math.PI + 0.6, TAU - 0.6, 12).slice(1, -1)], closed: true });
    out.push({ pts: arc(0, 0, 0.2, 0, TAU, 12), closed: true });
    out.push(dotAt(0, 0));
    for (let i = 0; i < 5; i++) out.push(ray(Math.PI / 2 + (i - 2) * 0.36, 0.42, 0.66));
  } else {
    out.push({ pts: arc(0, 0, 0.34, 0, TAU, 18), closed: true });
    out.push(dotAt(0, 0));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + Math.PI / 2, w = 0.11, r0 = 0.42, r1 = i % 2 ? 0.66 : 0.8;
      out.push({ pts: [[Math.cos(a - w) * r0, Math.sin(a - w) * r0], [Math.cos(a) * r1, Math.sin(a) * r1], [Math.cos(a + w) * r0, Math.sin(a + w) * r0]] });
    }
  }
  return out;
}

function strokesPath(g: Ctx, strokes: readonly Stroke[], x: number, y: number, s: number): void {
  g.beginPath();
  for (const st of strokes) {
    st.pts.forEach(([px, py], i) => (i ? g.lineTo(x + px * s, y + py * s) : g.moveTo(x + px * s, y + py * s)));
    if (st.closed) g.closePath();
  }
}

/**
 * Cut a path into the stone: the groove in the face's own shade a step
 * deeper, and the lit far wall of it a hair down and to the right, so it
 * reads as cut in rather than drawn on. `w` is how wide it is, in units.
 */
function cut(g: Ctx, fill: RGB, w: number, path: () => void): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const deep = mix(fill, hex('#5a4e5e'), 0.42);
  path();
  g.strokeStyle = css(deep, 0.95);
  g.lineWidth = w;
  g.stroke();
  g.save();
  g.translate(w * 0.22, -w * 0.22);
  path();
  g.strokeStyle = css(mix(fill, [255, 250, 238], 0.55), 0.8);
  g.lineWidth = w * 0.38;
  g.stroke();
  g.restore();
}

/* ---- the five ---------------------------------------------------------------- */

/** The panel down a face: its middle at its foot and at its head, how wide, where it starts and stops, and its runes. */
interface Panel {
  x0: number;
  x1: number;
  w: number;
  z0: number;
  z1: number;
  /** How high its pointed head rises over `z1`. */
  arch: number;
  runes: string[];
  /** Units from a rune's middle to its top. */
  size: number;
  /** The carved disc over it, if it has one. */
  roundel?: { x: number; z: number; r: number; kind: string };
}

interface Spec {
  /**
   * Which way it is turned in the world, as a heading is (`headingView` in
   * `furniture.ts`): its width runs at this angle from east and its carved
   * face looks a quarter turn on, so nought faces south. Each looks into the
   * bay from its shore, turned an eighth of a half turn off it -- halfway
   * between two of the eight viewpoints -- so none of them sees it edge on.
   */
  yaw: number;
  outline: Pt[];
  /** Thickness through it at the foot and at the top. */
  depth: [number, number];
  /** How far it leans, across and toward its front, per unit up. */
  lean: [number, number];
  bevel: number;
  stone: Tone;
  rock: Tone;
  front: Panel;
  back: Panel;
  /** Which side of the front the moss and ivy climb (-1 its left, 1 its right), and how far it has got, nought to one. */
  mossSide: 1 | -1;
  moss: number;
  /** Ivy strands: up which face, from where along it, which reach, how big, how high it starts. */
  ivy: Array<{ face: 'front' | 'back' | 'side'; x: number; kind: StrandKind; v: number; k: number; z?: number; flip?: boolean }>;
  /** Cracks across the front: where they start and the way they wander. */
  cracks: Array<{ x: number; z: number; a: number; len: number }>;
  /** The colours of the flowers at its foot, by how many of each. */
  flowers: Array<[string, number]>;
  /** The rocks of the outcrop: how many round its foot and further out, and how big. */
  rocks: { foot: number; outer: number; size: number };
  /** The pieces lying about it. */
  fallen: Fallen[];
  /** The two colours its lichen comes in. */
  lichen: [string, string];
  /** Where through it its head stands, if not square about its middle (`PlateOpts.depthAt`). */
  depthAt?: (s: number, t: number, half: number) => [number, number];
  /** Runes cut down the long side away from the moss, in place of the notches. */
  sideRunes?: string[];
  /** A cleft down into its head, on the front: where its foot is and how wide it opens, kept clear of the head's moss. */
  cleft?: { x: number; z: number; w: number };
  /** Cracks across the back, as the front's are. */
  backCracks?: Array<{ x: number; z: number; a: number; len: number }>;
  /** Moss down the mossy edge of its top quarter, in the lee of its head, nought to one. */
  leeMoss?: number;
  /** How many patches of lichen on a broad face. */
  lichenN?: number;
  seed: number;
}

/** A piece fallen off a stone: a carved disc on its edge, a drum on its side, a chunk off its top, a flake leaning on its foot. */
type Fallen =
  | { kind: 'disc'; x: number; y: number; r: number; lean: number; face: number; carve: string; sink?: number }
  | { kind: 'drum'; x: number; y: number; r: number; len: number; face: number }
  | { kind: 'chunk'; x: number; y: number; face: number; tilt: number }
  | { kind: 'flake'; x: number; y: number; face: number; lean: number; w: number; h: number };

/** The tall stone, a step cooler or warmer for each, and the outcrop under it a step darker. */
const SPECS: Record<RunestoneId, Spec> = {
  /*
   * The Crownstone: upright and the most regal, on the north shore between
   * the two inlets, in a warm cream with golden lichen. Its head is two
   * horns of a crown, the left the taller and standing to the front, the
   * right set back, so they read as two from the side as well; a crowned
   * sun in its roundel and a star on its back; diamonds and stars down its
   * panel; white and gold flowers at its foot, a sun-disc fallen against a
   * rock and a flake off a horn lying in the grass.
   */
  crownstone: {
    yaw: -0.39,
    outline: [
      [-19, 0], [19, 0], [19.6, 26], [18.4, 58], [17.2, 88], [16.6, 100],
      [15.6, 110], [13.2, 118.5], [10.6, 124.5], [8.4, 118.4], [5.6, 111.6],
      [2.6, 106.4], [-0.4, 104.6], [-3.4, 107],
      [-6.6, 114], [-9.2, 123], [-11.4, 131], [-14, 123.6], [-16.4, 113], [-17.6, 102],
      [-18.4, 88], [-19.4, 58], [-19.8, 26],
    ],
    depth: [21, 17],
    lean: [0.012, 0],
    bevel: 1.6,
    stone: toneOf('#f5e8cf', '#bca9a4'),
    rock: toneOf('#e3d6c1', '#aa9ca3'),
    front: {
      x0: 0, x1: -0.4, w: 16, z0: 10, z1: 70, arch: 6, size: 3,
      runes: ['diamond', 'star8', 'algiz', 'crescent', 'ingwaz', 'cross', 'diamondDot'],
      roundel: { x: -0.6, z: 89, r: 10.5, kind: 'crown' },
    },
    back: {
      x0: 0, x1: 0.4, w: 13, z0: 14, z1: 68, arch: 5, size: 2.8, runes: ['tiwaz', 'ring', 'dagaz', 'star6', 'othala', 'diamond'],
      roundel: { x: 0.4, z: 84, r: 8, kind: 'star' },
    },
    mossSide: 1,
    moss: 0.55,
    ivy: [
      { face: 'front', x: 17, kind: 'climb', v: 2, k: 1.25 },
      { face: 'front', x: 15.6, kind: 'vine', v: 2, k: 1.6, z: 24 },
      { face: 'front', x: 16.6, kind: 'vine', v: 0, k: 1.15, z: 54 },
      { face: 'front', x: 14.6, kind: 'hang', v: 3, k: 1.35, z: 110 },
      { face: 'side', x: 0, kind: 'climb', v: 3, k: 1.5 },
      { face: 'back', x: -15.5, kind: 'climb', v: 2, k: 1.3 },
      { face: 'back', x: -15, kind: 'vine', v: 1, k: 1.2, z: 30 },
    ],
    cracks: [{ x: 19, z: 40, a: 2.7, len: 9 }, { x: -12, z: 122, a: -1.7, len: 10 }, { x: -19.4, z: 66, a: -0.2, len: 7 }],
    flowers: [['white', 5], ['yellow', 3], ['pink', 2]],
    rocks: { foot: 5, outer: 5, size: 1 },
    fallen: [
      { kind: 'disc', x: -30, y: 30, r: 8.5, lean: 0.5, face: 0.6, carve: 'crown' },
      { kind: 'flake', x: 36, y: 10, face: -2.2, lean: 1.25, w: 9, h: 13 },
    ],
    lichen: ['#efc867', '#ead9a0'],
    lichenN: 9,
    // The horns: the left forward of the middle, the right behind it, each thinner than the body under them.
    depthAt: (s, t, h) => {
      if (t < 94) return [0, h];
      const k = Math.min(1, (t - 94) / 12), u = Math.max(0, Math.min(1, (s + 3) / 6));
      return [(3.2 * (1 - u) - 3.6 * u) * k, h + (5.8 - h) * k];
    },
    seed: 11,
  },
  /*
   * Mossmere Stone, on the west shore: broad and round-headed, leaning a
   * little toward its right, and the greenest of them -- moss over its
   * head and down its left side, ivy up its left half to its roundel, and a
   * mossy moon-disc half sunk at its foot. A moon over water in its roundel
   * and waves on its back; waves and moons down its panel; blue, lilac and
   * white flowers.
   */
  mossmere: {
    yaw: -1.18,
    outline: [
      [-22, 0], [22, 0], [22.6, 24], [21.2, 52], [19.4, 74], [16.6, 88], [12, 96.5], [5.4, 101],
      [-1, 102.2], [-7.6, 100.4], [-13.4, 95.6], [-17.8, 87], [-20.4, 72], [-21.8, 50], [-22.8, 24],
    ],
    depth: [24, 19],
    lean: [0.1, -0.03],
    bevel: 2.2,
    stone: toneOf('#e7e4d4', '#a6a8ae'),
    rock: toneOf('#d6d2c2', '#9ea0a6'),
    front: {
      x0: 0.6, x1: 0, w: 16, z0: 9, z1: 62, arch: 6, size: 3,
      runes: ['wave', 'crescent', 'laguz', 'ring', 'diamond', 'crescent', 'wave'],
      roundel: { x: -0.4, z: 80, r: 10.5, kind: 'moon' },
    },
    back: {
      x0: 0, x1: -0.5, w: 13, z0: 12, z1: 60, arch: 5, size: 2.8, runes: ['laguz', 'wave', 'eye', 'star6', 'laguz', 'wave'],
      roundel: { x: -0.5, z: 75, r: 8.5, kind: 'wave' },
    },
    mossSide: -1,
    moss: 0.95,
    ivy: [
      { face: 'front', x: -18.5, kind: 'climb', v: 6, k: 1.8 },
      { face: 'front', x: -15.5, kind: 'vine', v: 2, k: 1.3, z: 34 },
      { face: 'front', x: -17, kind: 'vine', v: 1, k: 1.6, z: 60 },
      { face: 'front', x: -12.5, kind: 'hang', v: 4, k: 1.4, z: 95 },
      { face: 'side', x: 2, kind: 'climb', v: 6, k: 1.6 },
      { face: 'side', x: -3, kind: 'vine', v: 1, k: 1.4, z: 40 },
      { face: 'back', x: 17.5, kind: 'climb', v: 5, k: 1.5 },
      { face: 'back', x: 16, kind: 'vine', v: 1, k: 1.25, z: 50 },
      { face: 'back', x: 12.5, kind: 'hang', v: 2, k: 1.3, z: 96 },
    ],
    cracks: [{ x: 21, z: 30, a: 2.9, len: 8 }, { x: -21.8, z: 48, a: 0.3, len: 6 }],
    flowers: [['lilac', 5], ['blue', 3], ['white', 3]],
    rocks: { foot: 6, outer: 6, size: 1.1 },
    fallen: [
      { kind: 'disc', x: -28, y: 28, r: 15, lean: 1.05, face: 1.97, carve: 'moon', sink: 0.45 },
    ],
    lichen: ['#d3dcb4', '#e2e0b4'],
    seed: 23,
  },
  /*
   * Harrowmark, on the east shore: tall, hard-edged and the coldest grey,
   * its head split by a cleft as if a blow had been struck down into it --
   * the halves of unequal height and pushed apart through its thickness,
   * so the split shows from the side too. A harrow's wheel in its roundel
   * and an hourglass on its back; harrows, crosses and the sun-stave down
   * its panel and a strip of runes down one side; more cracks than the
   * rest, a collar of moss, a flake split off it leaning at its foot.
   */
  harrowmark: {
    yaw: 1.96,
    outline: [
      [-19, 0], [19, 0], [19.4, 30], [18.2, 66], [17.6, 94], [17, 102], [15, 105.4], [8.6, 106.6], [4.2, 105.2],
      [2.6, 96], [1.4, 82], [0.4, 97], [-0.6, 112.8],
      [-4.4, 116.6], [-12.6, 117.4], [-16.8, 114], [-18, 104], [-18.8, 62], [-19.6, 28],
    ],
    depth: [20, 17],
    lean: [-0.03, 0.02],
    bevel: 0.8,
    stone: toneOf('#dfe3e5', '#979fb6'),
    rock: toneOf('#cfd3d4', '#9399ad'),
    front: {
      x0: 0, x1: 0, w: 15, z0: 9, z1: 54, arch: 4, size: 2.6,
      runes: ['harrow', 'cross', 'tiwaz', 'sowilo', 'cross', 'dagaz', 'harrow'],
      roundel: { x: -0.4, z: 69, r: 9, kind: 'wheel' },
    },
    back: {
      x0: 0, x1: 0, w: 13, z0: 10, z1: 56, arch: 4, size: 2.7, runes: ['sowilo', 'hourglass', 'harrow', 'tri', 'cross', 'tiwaz'],
      roundel: { x: 0, z: 70, r: 8, kind: 'hourglass' },
    },
    mossSide: 1,
    moss: 0.42,
    ivy: [
      { face: 'front', x: 16.4, kind: 'climb', v: 3, k: 1.3 },
      { face: 'front', x: 15.8, kind: 'vine', v: 1, k: 1.45, z: 40 },
      { face: 'front', x: 13, kind: 'hang', v: 1, k: 1.1, z: 104 },
      { face: 'side', x: 0, kind: 'climb', v: 2, k: 1.5 },
      { face: 'back', x: -15.5, kind: 'climb', v: 3, k: 1.2 },
    ],
    cracks: [
      { x: 1.4, z: 82, a: -1.62, len: 12 }, { x: -19, z: 52, a: -0.35, len: 9 }, { x: 18.4, z: 64, a: 3.4, len: 8 },
      { x: -12, z: 116, a: -1.2, len: 9 }, { x: 10, z: 4, a: 1.9, len: 7 },
    ],
    flowers: [['white', 4], ['pink', 3], ['yellow', 2]],
    rocks: { foot: 5, outer: 6, size: 0.95 },
    fallen: [
      { kind: 'flake', x: -26, y: 22, face: 0.4, lean: 1.0, w: 11, h: 19 },
      { kind: 'drum', x: 34, y: -6, r: 5.5, len: 13, face: 1.2 },
    ],
    lichen: ['#b7c79b', '#d4dbb0'],
    lichenN: 11,
    cleft: { x: 1.4, z: 82, w: 3.4 },
    backCracks: [{ x: 19.2, z: 46, a: 2.9, len: 10 }, { x: -18.6, z: 70, a: 0.2, len: 9 }, { x: 6, z: 2, a: 1.4, len: 8 }],
    // The split halves: the left forward, the right back, apart through the thickness above the foot of the cleft.
    depthAt: (s, t, h) => {
      if (t < 80) return [0, h];
      const k = Math.min(1, (t - 80) / 10), u = Math.max(0, Math.min(1, (s - 0.2) / 2.4));
      return [(2.4 * (1 - u) - 2.8 * u) * k, h - 0.8 * k];
    },
    sideRunes: ['harrow', 'tiwaz', 'cross', 'sowilo', 'tri', 'harrow'],
    seed: 37,
  },
  /*
   * The Wardenfall, on the southwest point, looking out over the water: the
   * warden that fell -- leaning hard to its right, its right shoulder
   * broken away along a jagged line, and the piece that broke lying on its
   * back on the outcrop beside it with its carving still on it. An open eye
   * in its roundel and a key on its back; the guarding staves down a panel
   * cut short by the break; pink and lilac flowers.
   */
  wardenfall: {
    yaw: -1.18,
    outline: [
      [-19, 0], [19, 0], [19.6, 28], [18.8, 54],
      [17.4, 60], [13.2, 63.5], [14.4, 68], [9, 74.5], [10.2, 79], [4.2, 86.5], [2.6, 92.5], [-2.6, 97.5],
      [-6.8, 102], [-11.6, 103.2], [-15.6, 99], [-18, 88], [-18.8, 60], [-19.6, 28],
    ],
    depth: [21, 18],
    lean: [0.2, 0.05],
    bevel: 1.5,
    stone: toneOf('#ebe0d0', '#aa9eac'),
    rock: toneOf('#d8cebf', '#a196a6'),
    front: {
      x0: -1, x1: -3, w: 14, z0: 9, z1: 54, arch: 4, size: 2.8,
      runes: ['algiz', 'tiwaz', 'ingwaz', 'othala', 'algiz', 'key'],
      roundel: { x: -7, z: 79, r: 9, kind: 'eye' },
    },
    back: {
      x0: 0, x1: 2, w: 13, z0: 9, z1: 52, arch: 4, size: 2.7, runes: ['eye', 'algiz', 'diamond', 'tiwaz', 'othala', 'algiz'],
      roundel: { x: 3.4, z: 65, r: 7, kind: 'key' },
    },
    mossSide: -1,
    moss: 0.62,
    ivy: [
      { face: 'front', x: -16.6, kind: 'climb', v: 4, k: 1.5 },
      { face: 'front', x: -15.6, kind: 'vine', v: 1, k: 1.2, z: 40 },
      { face: 'front', x: -12, kind: 'hang', v: 3, k: 1.3, z: 101 },
      { face: 'side', x: 0, kind: 'climb', v: 5, k: 1.6 },
      { face: 'back', x: 16, kind: 'climb', v: 3, k: 1.4 },
      { face: 'back', x: 15.6, kind: 'vine', v: 2, k: 1.1, z: 34 },
    ],
    cracks: [{ x: 9, z: 74.5, a: -2.2, len: 8 }, { x: -18.6, z: 36, a: 0.25, len: 8 }],
    flowers: [['pink', 5], ['lilac', 3], ['white', 2]],
    rocks: { foot: 5, outer: 5, size: 1 },
    fallen: [
      { kind: 'chunk', x: 36, y: 10, face: 0.9, tilt: 0.16 },
      { kind: 'flake', x: -32, y: -18, face: 2.6, lean: 1.3, w: 7, h: 9 },
    ],
    lichen: ['#e6e0ae', '#e9cc8e'],
    seed: 53,
  },
  /*
   * Sunreach Stone, on the southeast point: the tallest and the slenderest,
   * narrowing to a blunt point as if it reached for the sun, the warmest
   * stone, ivy up one edge to half its height and moss in the lee of its
   * tip. A rising sun in its roundel and an eight-pointed star on its back;
   * the sun-stave and stars down a long panel; a column drum fallen in the
   * grass and pink and yellow flowers.
   */
  sunreach: {
    yaw: 1.96,
    outline: [
      [-17, 0], [17, 0], [17.2, 30], [16, 62], [14, 90], [11.6, 108], [8.4, 121], [4.8, 130], [1.6, 135.5],
      [-1.2, 136], [-4.4, 131], [-8.2, 122.5], [-11.4, 110], [-14, 92], [-16, 62], [-17.4, 30],
    ],
    depth: [19, 13],
    lean: [0.035, -0.012],
    bevel: 1.4,
    stone: toneOf('#f7ddd0', '#c4a2a7'),
    rock: toneOf('#e3d4bf', '#ab9ca3'),
    front: {
      x0: 0, x1: 0, w: 14, z0: 11, z1: 80, arch: 6, size: 2.8,
      runes: ['sowilo', 'star8', 'diamond', 'tiwaz', 'sunDot', 'star6', 'ingwaz', 'sowilo'],
      roundel: { x: 0.2, z: 98, r: 8.6, kind: 'sun' },
    },
    back: {
      x0: 0, x1: 0, w: 13, z0: 12, z1: 80, arch: 5, size: 2.8, runes: ['star6', 'sowilo', 'tri', 'sunDot', 'sowilo', 'star8', 'diamond'],
      roundel: { x: 0, z: 95, r: 8, kind: 'star8' },
    },
    mossSide: 1,
    moss: 0.45,
    ivy: [
      { face: 'front', x: 13.8, kind: 'climb', v: 3, k: 1.4 },
      { face: 'front', x: 13.2, kind: 'vine', v: 1, k: 1.3, z: 30 },
      { face: 'front', x: 7, kind: 'hang', v: 2, k: 1.2, z: 122 },
      { face: 'side', x: 0, kind: 'climb', v: 2, k: 1.4 },
      { face: 'side', x: 1, kind: 'vine', v: 1, k: 1.2, z: 30 },
      { face: 'back', x: -13.8, kind: 'climb', v: 4, k: 1.3 },
      { face: 'back', x: -13.2, kind: 'vine', v: 1, k: 1.2, z: 34 },
      { face: 'back', x: -7, kind: 'hang', v: 1, k: 1.1, z: 121 },
    ],
    cracks: [{ x: -16, z: 70, a: -0.4, len: 7 }, { x: 16, z: 40, a: 3.0, len: 6 }],
    flowers: [['pink', 4], ['yellow', 4], ['white', 2]],
    rocks: { foot: 4, outer: 5, size: 0.9 },
    fallen: [
      { kind: 'drum', x: -34, y: 16, r: 6.5, len: 15, face: 0.3 },
      { kind: 'disc', x: 30, y: 30, r: 7.5, lean: 0.75, face: -0.9, carve: 'sun' },
    ],
    lichen: ['#efcf7a', '#e6e0ae'],
    leeMoss: 0.85,
    seed: 71,
  },
};

/* ---- the flowers ------------------------------------------------------------- */

/** The flowers at their feet: the meadow's own (`flowers.ts`), with a lilac besides. */
const FLOWER: Record<string, { petal: string; ring: string; eye: string }> = {
  pink: { petal: '#f0a3b7', ring: '#a85f75', eye: '#f6d467' },
  white: { petal: '#fbf8ef', ring: '#7f988a', eye: '#efc23f' },
  yellow: { petal: '#f4d35a', ring: '#a5852a', eye: '#dd8f2b' },
  blue: { petal: '#98b8ee', ring: '#4f6b99', eye: '#f3eed6' },
  lilac: { petal: '#cdb4ee', ring: '#7a63a6', eye: '#f6e6a8' },
};

/**
 * A clump of flowers rooted at (x, y) on the screen, in pixels at zoom one:
 * a tuft of leaves and a handful of heads on stems, each head ringed in a
 * darker shade of its own colour round a bright eye, as the meadow's are --
 * or, for lilac and now and then pink, a spike: a stem with a column of
 * small heads up it, the lupins and foxgloves of the reference.
 */
function flowerClump(g: Ctx, x: number, y: number, colour: string, seed: number, big = 1): void {
  const R = rand(seed);
  const col = FLOWER[colour] ?? FLOWER.white;
  g.lineCap = 'round';
  g.fillStyle = 'rgba(40, 70, 52, 0.16)';
  g.beginPath();
  g.ellipse(x + 0.8, y + 0.3, 7 * big, 2 * big, 0, 0, TAU);
  g.fill();
  const leaves = 5 + Math.floor(R() * 3);
  const lens = Array.from({ length: leaves }, () => (4 + R() * 2.4) * big);
  const leafPass = (grow: number, fill: string, dy = 0): void => {
    g.beginPath();
    for (let i = 0; i < leaves; i++) {
      const lx = x + (i / (leaves - 1) - 0.5) * 11 * big, tilt = (i / (leaves - 1) - 0.5) * 2.2, len = lens[i];
      g.moveTo(lx, y);
      g.quadraticCurveTo(lx + tilt * len * 0.35 - grow, y - len * 0.6 + dy, lx + tilt * len * 0.7, y - len);
      g.quadraticCurveTo(lx + tilt * len * 0.35 + grow + 1.1, y - len * 0.45 + dy, lx, y);
    }
    g.fillStyle = fill;
    g.fill();
  };
  leafPass(0.5, '#4f7a5f');
  leafPass(0, '#6f9c7c');
  leafPass(-0.35, '#8db898', 0.5);
  const spike = colour === 'lilac' || (colour === 'pink' && R() < 0.3);
  if (spike) {
    // Two or three spikes, each a stem with heads up it smaller toward the tip.
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) {
      const sx = x + (k - (n - 1) / 2) * 4.2 * big + (R() - 0.5) * 1.5, tall = (12 + R() * 6) * big, lean = (R() - 0.5) * 2.4;
      g.strokeStyle = '#5b876a';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(sx, y - 1);
      g.quadraticCurveTo(sx + lean * 0.3, y - tall * 0.5, sx + lean, y - tall);
      g.stroke();
      for (let j = 0; j < 7; j++) {
        const t = 0.38 + (j / 6) * 0.62, r = (1.5 - t * 0.8) * big;
        const hx = sx + lean * t * t + (j % 2 ? 0.7 : -0.7) * (1 - t), hy = y - tall * t;
        g.beginPath();
        g.arc(hx, hy, r + 0.42, 0, TAU);
        g.fillStyle = col.ring;
        g.fill();
        g.beginPath();
        g.arc(hx, hy, r, 0, TAU);
        g.fillStyle = col.petal;
        g.fill();
        g.beginPath();
        g.arc(hx - r * 0.3, hy - r * 0.3, r * 0.35, 0, TAU);
        g.fillStyle = 'rgba(255, 255, 255, 0.55)';
        g.fill();
      }
    }
    return;
  }
  const heads: Pt[] = [];
  const n = 5 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) heads.push([(R() - 0.5) * 13 * big, (4 + R() * 9) * big]);
  g.strokeStyle = '#5b876a';
  g.lineWidth = 0.55;
  g.beginPath();
  for (const [hx, up] of heads) {
    g.moveTo(x + hx * 0.25, y - 0.4);
    g.quadraticCurveTo(x + hx * 0.7, y - up * 0.5, x + hx, y - up);
  }
  g.stroke();
  heads.sort((a, b) => b[1] - a[1]);
  heads.forEach(([hx, up], i) => {
    const cx = x + hx, cy = y - up;
    const r = 2.05 * big * (1 - (i % 3) * 0.08);
    const turn = i * 1.3 + seed;
    g.beginPath();
    g.arc(cx, cy, r + 0.42, 0, TAU);
    g.fillStyle = col.ring;
    g.fill();
    g.beginPath();
    for (let p = 0; p < 5; p++) {
      const a = turn + (p / 5) * TAU;
      const px = cx + Math.cos(a) * r * 0.52, py = cy + Math.sin(a) * r * 0.52;
      g.moveTo(px + r * 0.52, py);
      g.arc(px, py, r * 0.52, 0, TAU);
    }
    g.fillStyle = col.petal;
    g.fill();
    g.beginPath();
    g.arc(cx, cy, r * 0.36, 0, TAU);
    g.fillStyle = col.eye;
    g.fill();
  });
}

/** A tuft of grass at (x, y) on the screen: a fan of blades in the meadow's greens. */
function grassTuft(g: Ctx, x: number, y: number, seed: number, k = 1): void {
  const R = rand(seed);
  const n = 5 + Math.floor(R() * 4);
  g.lineCap = 'round';
  for (const [fill, w, grow] of [['#5f8a6c', 1.5, 0.3], ['#86ad8e', 1, 0]] as Array<[string, number, number]>) {
    g.strokeStyle = fill;
    g.lineWidth = w * k;
    g.beginPath();
    const r = rand(seed);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + ((i / (n - 1)) - 0.5) * 1.6 + (r() - 0.5) * 0.3, len = (4 + r() * 4 + grow) * k;
      g.moveTo(x + (i - n / 2) * 0.6 * k, y);
      g.quadraticCurveTo(x + Math.cos(a) * len * 0.4, y + Math.sin(a) * len * 0.6, x + Math.cos(a) * len, y + Math.sin(a) * len);
    }
    g.stroke();
  }
}

/** How far each kind of ivy strand climbs at its tallest, in units, at its own size. */
const STRAND_REACH_UNITS: Record<StrandKind, number> = { hang: 14, climb: 22, vine: 20 };

/**
 * A spray of small flowers on ivy, at (x, y) on the screen in pixels at zoom
 * one: five-petalled heads ringed in their own darker shade round a bright
 * eye, as the meadow's are, three to six of them in a loose knot.
 */
function blossom(g: Ctx, x: number, y: number, colour: string, R: () => number): void {
  const col = FLOWER[colour] ?? FLOWER.pink;
  const n = 3 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) {
    const cx = x + (R() - 0.5) * 6, cy = y + (R() - 0.5) * 5, r = 1.5 + R() * 0.6;
    g.beginPath();
    g.arc(cx, cy, r + 0.42, 0, TAU);
    g.fillStyle = col.ring;
    g.fill();
    g.beginPath();
    for (let p = 0; p < 5; p++) {
      const a = i * 1.3 + (p / 5) * TAU;
      const px = cx + Math.cos(a) * r * 0.52, py = cy + Math.sin(a) * r * 0.52;
      g.moveTo(px + r * 0.52, py);
      g.arc(px, py, r * 0.52, 0, TAU);
    }
    g.fillStyle = col.petal;
    g.fill();
    g.beginPath();
    g.arc(cx, cy, r * 0.36, 0, TAU);
    g.fillStyle = col.eye;
    g.fill();
  }
}

/* ---- building one ---------------------------------------------------------- */

/** Where a rune is on its face, and how big: kept so its light can be drawn over the bake. */
interface RuneAt {
  face: 'front' | 'back';
  glyph: string;
  x: number;
  z: number;
  s: number;
  /** Its place up the column, for its beat; the roundel is last. */
  i: number;
  roundel?: string;
}

interface Model {
  spec: Spec;
  things: Thing[];
  /** The monolith's two carved faces, in the frames their runes are drawn in. */
  faces: { front: { o: V3; a: V3; b: V3 }; back: { o: V3; a: V3; b: V3 } };
  /** The normal of each, for whether it is seen. */
  normals: { front: V3; back: V3 };
  runes: RuneAt[];
  /** The ground it lies on: an outline in the model's level frame. */
  turf: Pt[];
  top: number;
}

const models = new Map<RunestoneId, Model>();

/** Where the monolith stands: on the top of the outcrop's slab, sunk into it a little. */
const SLAB_H = 4.2;
const FOOT = SLAB_H - 0.6;

function modelOf(id: RunestoneId): Model {
  const had = models.get(id);
  if (had) return had;
  const spec = SPECS[id];
  const R = rand(spec.seed * 7919 + 13);
  const things: Thing[] = [];
  const tTop = Math.max(...spec.outline.map((p) => p[1]));
  const [lx, ly] = spec.lean;
  const W: V3 = [lx, ly, 1];
  const half0 = spec.depth[0] / 2, half1 = spec.depth[1] / 2;
  const f = (half1 - half0) / tTop;
  const O: V3 = [0, 0, FOOT];
  /** How wide the stone is at height z, from its outline: its left and right. */
  const widthAt = (z: number): [number, number] => {
    let lo = Infinity, hi = -Infinity;
    const p = spec.outline;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if ((a[1] - z) * (b[1] - z) > 0 || a[1] === b[1]) continue;
      const x = a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    return lo < hi ? [lo, hi] : [0, 0];
  };

  /* -- what is carved, and what grows, on each broad face -- */
  const runes: RuneAt[] = [];
  const carvedFace = (which: 'front' | 'back', panel: Panel): { paint: Painter; over: Painter } => {
    const sideK = which === 'front' ? spec.mossSide : -spec.mossSide;
    // On the back the frame runs the other way along it, so the outline is read mirrored.
    const outline = which === 'front' ? spec.outline : spec.outline.map(([x, z]) => [-x, z] as Pt);
    const xs = (z: number): [number, number] => {
      const [a, b] = widthAt(z);
      return which === 'front' ? [a, b] : [-b, -a];
    };
    /** How high the stone stands at `x` across the face: the top of its outline there. */
    const headAt = (x: number): number => {
      let top = 0;
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i], b = outline[(i + 1) % outline.length];
        if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
        top = Math.max(top, a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
      }
      return top;
    };
    const midAt = (z: number): number => panel.x0 + ((panel.x1 - panel.x0) * (z - panel.z0)) / Math.max(1, panel.z1 - panel.z0);
    // Runes up the panel, evenly, with room above and below.
    const n = panel.runes.length;
    const step = (panel.z1 - panel.z0 - panel.size * 2.4) / Math.max(1, n - 1);
    panel.runes.forEach((glyph, i) => {
      const z = panel.z0 + panel.size * 1.2 + step * i;
      runes.push({ face: which, glyph, x: midAt(z), z, s: panel.size, i });
    });
    if (panel.roundel) runes.push({ face: which, glyph: '', x: panel.roundel.x, z: panel.roundel.z, s: panel.roundel.r, i: n, roundel: panel.roundel.kind });
    const seed = spec.seed * 31 + (which === 'front' ? 1 : 2);
    const hw = panel.w / 2;
    const paint: Painter = (g, k) => {
      const T = rand(seed);
      const fill = k.fill;
      /*
       * The stone's own skin: flat patches a step paler and a step greyer,
       * as the island draws everything -- fields of colour, not a blur --
       * and specks of grit, more toward the foot.
       */
      for (let i = 0; i < 44; i++) {
        const z = T() * tTop, [a, b] = xs(z);
        const x = a + T() * (b - a);
        const rx = 1.5 + T() * 6.5, rz = 1 + T() * 4.5, turn = (T() - 0.5) * 0.8, n = 6 + Math.floor(T() * 3);
        g.beginPath();
        for (let j = 0; j < n; j++) {
          const q = (j / n) * TAU, w = 0.7 + T() * 0.45;
          const px = Math.cos(q) * rx * w, pz = Math.sin(q) * rz * w;
          const X = x + px * Math.cos(turn) - pz * Math.sin(turn), Z = z + px * Math.sin(turn) + pz * Math.cos(turn);
          if (j) g.lineTo(X, Z); else g.moveTo(X, Z);
        }
        g.closePath();
        g.fillStyle = T() < 0.5 ? css(mix(fill, [255, 252, 244], 0.4), 0.4) : css(mix(fill, hex('#9c94a4'), 0.32), 0.3);
        g.fill();
      }
      // The damp up out of the ground, a broad band a step darker over the lowest seventh of it.
      g.beginPath();
      g.moveTo(-40, -2);
      for (let x = -40; x <= 40; x += 3) g.lineTo(x, tTop * (0.11 + 0.06 * noise2(x / 9, 2.5, seed)));
      g.lineTo(40, -2);
      g.closePath();
      g.fillStyle = css(mix(fill, hex('#8c8f8e'), 0.3), 0.3);
      g.fill();
      // The foot, darker where the damp comes up out of the ground: one flat field with a wandering top.
      g.beginPath();
      g.moveTo(-40, -2);
      for (let x = -40; x <= 40; x += 3) g.lineTo(x, 4.5 + 3.5 * noise2(x / 7, 0.5, seed));
      g.lineTo(40, -2);
      g.closePath();
      g.fillStyle = css(mix(fill, hex('#7f8486'), 0.35), 0.45);
      g.fill();
      g.fillStyle = css(mix(fill, hex('#6d6274'), 0.5), 0.35);
      for (let i = 0; i < 150; i++) {
        const z = Math.pow(T(), 1.6) * tTop, [a, b] = xs(z);
        const x = a + T() * (b - a);
        g.fillRect(x, z, 0.35 + T() * 0.3, 0.35 + T() * 0.3);
      }
      // Pits weathered into it: a dark hollow and the lit lip below it.
      for (let i = 0; i < 26; i++) {
        const z = T() * tTop * 0.95, [a, b] = xs(z);
        const x = a + 1 + T() * (b - a - 2), r = 0.3 + T() * 0.45;
        g.beginPath();
        g.ellipse(x, z, r * 1.3, r, 0, 0, TAU);
        g.fillStyle = css(mix(fill, hex('#5d5464'), 0.4), 0.55);
        g.fill();
        g.beginPath();
        g.ellipse(x + r * 0.35, z - r * 0.45, r * 1.1, r * 0.5, 0, 0, TAU);
        g.fillStyle = css(mix(fill, [255, 252, 244], 0.6), 0.6);
        g.fill();
      }
      // Hairlines crazing it, branching, too fine to be cut.
      g.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        let z = T() * tTop;
        const [a, b] = xs(z);
        let x = a + T() * (b - a), ang = T() * TAU;
        g.beginPath();
        g.moveTo(x, z);
        for (let j = 0; j < 5 + T() * 5; j++) {
          ang += (T() - 0.5) * 1.1;
          x += Math.cos(ang) * 1.8;
          z += Math.sin(ang) * 1.8;
          g.lineTo(x, z);
          if (T() < 0.2) { g.moveTo(x, z); g.lineTo(x + Math.cos(ang + 1.2) * 2.2, z + Math.sin(ang + 1.2) * 2.2); g.moveTo(x, z); }
        }
        g.strokeStyle = css(mix(fill, hex('#6d6274'), 0.45), 0.4);
        g.lineWidth = 0.24;
        g.stroke();
      }
      // Weathering down from the top: a few streaks a step darker, where rain runs off the head.
      for (let i = 0; i < 9; i++) {
        const z1 = tTop * (0.6 + T() * 0.35), [a, b] = xs(z1);
        const x = a + (0.1 + T() * 0.8) * (b - a), len = 14 + T() * 30, w = 0.6 + T() * 1.4;
        g.beginPath();
        g.moveTo(x - w, z1);
        g.quadraticCurveTo(x - w * 0.6, z1 - len * 0.6, x, z1 - len);
        g.quadraticCurveTo(x + w * 0.6, z1 - len * 0.6, x + w, z1);
        g.fillStyle = css(mix(fill, hex('#8e8798'), 0.4), 0.2);
        g.fill();
      }

      /* -- the panel: a field sunk a step into the face, ruled twice round, a pointed head -- */
      const border = (d: number): void => {
        const zA = panel.z1, top = panel.z1 + panel.arch - d * 0.4;
        const l0 = midAt(panel.z0) - hw + d, r0 = midAt(panel.z0) + hw - d;
        const l1 = midAt(zA) - hw + d, r1 = midAt(zA) + hw - d, mx = midAt(zA);
        g.beginPath();
        g.moveTo(l0, panel.z0 + d);
        g.lineTo(l1, zA);
        g.quadraticCurveTo(l1, zA + (top - zA) * 0.7, mx, top);
        g.quadraticCurveTo(r1, zA + (top - zA) * 0.7, r1, zA);
        g.lineTo(r0, panel.z0 + d);
        g.closePath();
      };
      border(1.8);
      g.fillStyle = css(mix(fill, hex('#a39aac'), 0.42), 0.55);
      g.fill();
      cut(g, fill, 0.75, () => border(0));
      cut(g, fill, 0.5, () => border(1.8));
      // A row of drilled dots down each side between the two rules.
      for (let z = panel.z0 + 3; z < panel.z1 - 1; z += 3.2) {
        for (const sx of [-1, 1]) {
          const x = midAt(z) + sx * (hw - 0.9);
          cut(g, fill, 0.42, () => { g.beginPath(); g.moveTo(x, z + 0.05); g.lineTo(x, z - 0.05); });
        }
      }
      // The runes, cut, under the light they will have.
      for (const r of runes) {
        if (r.face !== which || r.roundel) continue;
        cut(g, fill, 0.78, () => glyphPath(g, r.glyph, r.x, r.z, r.s));
      }
      if (panel.roundel) {
        const { x, z, r, kind } = panel.roundel;
        g.beginPath();
        g.arc(x, z, r * 0.86, 0, TAU);
        g.fillStyle = css(mix(fill, hex('#a39aac'), 0.38), 0.5);
        g.fill();
        cut(g, fill, 0.7, () => strokesPath(g, roundelStrokes(kind), x, z, r));
      }

      /* -- cracks: a dark line jagging in from an edge, its lit lip below it -- */
      {
        for (const c of which === 'front' ? spec.cracks : spec.backCracks ?? []) {
          const pts: Pt[] = [[c.x, c.z]];
          let a = c.a, x = c.x, z = c.z;
          for (let i = 0; i < 6; i++) {
            const d = c.len / 6;
            a += (T() - 0.5) * 0.9;
            x += Math.cos(a) * d;
            z += Math.sin(a) * d;
            pts.push([x, z]);
          }
          cut(g, fill, 0.55, () => { g.beginPath(); pts.forEach(([px, pz], i) => (i ? g.lineTo(px, pz) : g.moveTo(px, pz))); });
        }
      }

      /* -- lichen, on the upper half, more on the side away from the moss -- */
      for (let i = 0; i < (spec.lichenN ?? 6); i++) {
        const z = tTop * (0.3 + 0.65 * T()), [a, b] = xs(z);
        const u = sideK > 0 ? Math.pow(T(), 1.6) : 1 - Math.pow(T(), 1.6);
        const x = a + u * (b - a);
        if (Math.abs(x - midAt(z)) < hw + 1 && z > panel.z0 && z < panel.z1 + panel.arch + (panel.roundel ? panel.roundel.r * 2 : 0)) continue;
        lichen(g, T, x, z, 0.8 + T() * 1.3, spec.lichen);
      }

      /*
       * Moss: up from the foot in a rounded band, higher on its mossy side,
       * and down the mossy edge; and hanging from the head of it, under
       * whatever has grown on top. On the screen, in cushions.
       */
      const m = spec.moss;
      const toScreen = new DOMMatrix([g.getTransform().a, g.getTransform().b, g.getTransform().c, g.getTransform().d, g.getTransform().e, g.getTransform().f]);
      const ps: Pad[] = [];
      const pad = (x: number, z: number, r: number): void => {
        const p = toScreen.transformPoint(new DOMPoint(x, z));
        const inv = k.base.inverse();
        const q = inv.transformPoint(p);
        // A cushion on an upright face: as wide as it is on the face across, a little squat.
        const across = Math.hypot(k.e.ux, k.e.uy) * 0.9;
        ps.push([q.x, q.y, r * across, r * across * 0.9]);
      };
      /*
       * Where it grows, as a share: up from the foot in a band higher on the
       * mossy side, in from the mossy edge in a band that narrows as it
       * climbs, and down from the head on the mossy half; and where that is
       * over a half, give or take what the noise says, a cushion -- close
       * enough that they run together into one mass with a lobed edge.
       */
      const foot = 6 + 22 * m;
      const reach = tTop * (0.35 + 0.55 * m);
      const cleftX = spec.cleft ? (which === 'front' ? spec.cleft.x : -spec.cleft.x) : null;
      if (cleftX !== null) {
        // The cleft: a dark shadow down into it, and a few cushions caught in its foot, the lowest spilling onto the face.
        const c = spec.cleft!;
        g.beginPath();
        g.moveTo(cleftX - 0.5, c.z + 14);
        g.lineTo(cleftX, c.z - 0.5);
        g.lineTo(cleftX + 0.5, c.z + 14);
        g.closePath();
        g.fillStyle = css(mix(fill, hex('#3f3b52'), 0.55), 0.7);
        g.fill();
        pad(cleftX + 0.3, c.z + 1.2, 1.9);
        pad(cleftX - 1.1, c.z - 0.8, 1.3);
        pad(cleftX + 0.9, c.z - 2.6, 0.9);
      }
      const nseed = seed * 13 + 5;
      const [fa, fb] = xs(0);
      const tries = Math.round(((fb - fa) * tTop) / 1.5);
      for (let i = 0; i < tries; i++) {
        const z = 0.4 + T() * tTop, [a, b] = xs(z);
        if (b - a < 1) continue;
        const x = a + 0.3 + T() * (b - a - 0.5);
        {
          const side = (x * sideK) / 22;
          const inFoot = 1 - z / (foot * (0.3 + 0.7 * Math.max(0, side + 0.35)));
          const d = sideK > 0 ? b - x : x - a, w = (3 + 8 * m) * (1 - z / reach);
          const inEdge = w > 0 ? 1 - d / w : 0;
          // A fringe along the head and the shoulders of every stone, deeper on its mossy side and the more it has.
          let inHead = (0.55 + 0.45 * m) * (0.5 + 0.5 * Math.min(1, Math.max(0, side + 0.5))) * (1 - (headAt(x) - z) / (2.5 + 5 * m));
          // Not in a cleft, where the head's fringe would run down both its sides as a pod of beads.
          if (cleftX !== null && Math.abs(x - cleftX) < spec.cleft!.w && z > spec.cleft!.z - 3) inHead = 0;
          const lee = spec.leeMoss ?? 0;
          const inLee = lee > 0 && z > tTop * 0.68 ? lee * (1 - d / (3 + 5 * lee)) * Math.min(1, (z - tTop * 0.68) / (tTop * 0.08)) : 0;
          const share = Math.max(inFoot, inEdge, inHead, inLee);
          if (share <= 0) continue;
          // Not over the runes: the panel is kept clear of all but the foot's.
          if (Math.abs(x - midAt(z)) < hw && z > panel.z0 + 3 && z < panel.z1 + panel.arch && inFoot < 0.5) continue;
          if (panel.roundel && Math.hypot(x - panel.roundel.x, z - panel.roundel.z) < panel.roundel.r * 0.95) continue;
          const n = noise2(x / 5.5, z / 5.5, nseed) * 0.7 + noise2(x / 2.2, z / 2.2, nseed + 1) * 0.3;
          if (share * 1.3 + (n - 0.5) * 1.1 < 0.62) continue;
          pad(x, z, cushion(T, share) + 0.25);
        }
      }
      g.save();
      g.setTransform(k.base);
      pads(g, ps);
      g.restore();
    };
    const over: Painter = (g, k) => {
      /*
       * Ivy on the mossy side, and over the shoulder: each strand moved out
       * just far enough that it keeps off the carving over the height it
       * covers, so nothing cuts it -- and only where moving it would take its
       * root off the stone is it trimmed, along a ragged line, never a ruled
       * one. Leaves let run over the stone's edge.
       */
      for (const iv of spec.ivy) {
        if (iv.face !== which) continue;
        const pic = strandPic(iv.kind, iv.v, STAGES, true);
        if (!pic) continue;
        const z0 = iv.z ?? 0.5;
        const sc = (iv.k * 10) / PPM;
        const left = (iv.flip ? pic.img.width - pic.ax : pic.ax) * sc, right = (iv.flip ? pic.ax : pic.img.width - pic.ax) * sc;
        const zLo = z0 - (pic.img.height - pic.ay) * sc, zHi = z0 + pic.ay * sc;
        const zoneTop = panel.roundel ? panel.roundel.z + panel.roundel.r : panel.z1 + panel.arch;
        let x = iv.x, carved: number | null = null;
        if (zHi > panel.z0 && zLo < zoneTop) {
          const z0p = Math.max(panel.z0, zLo), z1p = Math.min(panel.z1 + panel.arch, zHi);
          const mids = z1p > z0p ? [midAt(z0p), midAt(Math.min(panel.z1, z1p))] : [midAt(panel.z1)];
          let edge = sideK > 0 ? Math.max(...mids) + hw : Math.min(...mids) - hw;
          const rd = panel.roundel;
          if (rd && zHi > rd.z - rd.r && zLo < rd.z + rd.r) edge = sideK > 0 ? Math.max(edge, rd.x + rd.r) : Math.min(edge, rd.x - rd.r);
          carved = edge + sideK * 0.8;
          const want = sideK > 0 ? carved + left : carved - right;
          // No further out than keeps its root on the stone.
          const [a, b] = xs(Math.max(1, z0)), limit = sideK > 0 ? b - 1.5 : a + 1.5;
          x = sideK > 0 ? Math.max(x, Math.min(want, limit)) : Math.min(x, Math.max(want, limit));
          if (sideK > 0 ? x - left >= carved : x + right <= carved) carved = null;
        }
        g.save();
        if (carved !== null) {
          const cv = carved;
          g.beginPath();
          g.moveTo(cv, zLo - 2);
          for (let z = zLo - 2; z <= zHi + 2; z += 1.5) g.lineTo(cv + sideK * (0.8 + 0.8 * Math.sin(z * 1.7) + 0.6 * noise2(z / 2, 1, seed)), z);
          g.lineTo(cv + sideK * 200, zHi + 2);
          g.lineTo(cv + sideK * 200, zLo - 2);
          g.closePath();
          g.clip();
        }
        g.translate(x, z0);
        g.scale(iv.flip ? -sc : sc, -sc);
        g.drawImage(pic.img, -pic.ax, -pic.ay);
        g.restore();
        const panelEdge = carved ?? (sideK > 0 ? -999 : 999);
        // Blossom on it, as on the reference's: a few small clusters up the strand, in the colours at its foot.
        const B = rand(seed * 5 + iv.v * 11 + Math.round(iv.x));
        const tall = STRAND_REACH_UNITS[iv.kind] * iv.k;
        const tr = g.getTransform(), inv = k.base.inverse();
        const sprays: Array<[number, number, string]> = [];
        for (let j = 0; j < 2 + Math.floor(B() * 2); j++) {
          const z = z0 + (iv.kind === 'hang' ? -1 : 1) * tall * (0.15 + 0.6 * B()), bx = x + (B() - 0.5) * 6 * iv.k;
          if (sideK > 0 ? bx < panelEdge : bx > panelEdge) continue;
          const q = inv.transformPoint(tr.transformPoint(new DOMPoint(bx, z)));
          sprays.push([q.x, q.y, spec.flowers[Math.floor(B() * Math.min(2, spec.flowers.length))][0]]);
        }
        g.save();
        g.setTransform(k.base);
        for (const [x, y, c] of sprays) blossom(g, x, y, c, B);
        g.restore();
      }
    };
    return { paint, over };
  };
  const front = carvedFace('front', spec.front);
  const back = carvedFace('back', spec.back);

  /* -- moss along the head, and ivy up the mossy side -- */
  const edgePaint = (i: number, up: number): { paint?: Painter; over?: Painter } | undefined => {
    const p = spec.outline[i], q = spec.outline[(i + 1) % spec.outline.length];
    const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    const dx = q[0] - p[0], dz = q[1] - p[1];
    // How long the strip is in the stone: its edge as the lean has sheared it.
    const len = Math.hypot(dx + lx * dz, ly * dz, dz);
    const sideK = spec.mossSide;
    const onSide = Math.sign(mx) === sideK && up < 0.5;
    const ivy = spec.ivy.filter((v) => v.face === 'side');
    const G = half0 + f * mz - spec.bevel;
    const paint: Painter = (g, k) => {
      const T = rand(spec.seed * 101 + i);
      const ps: Pad[] = [];
      const tr = g.getTransform(), inv = k.base.inverse();
      const across = Math.hypot(k.e.ux, k.e.uy) * 0.9;
      const pad = (s: number, y: number, r: number): void => {
        const q0 = inv.transformPoint(tr.transformPoint(new DOMPoint(s, y)));
        ps.push([q0.x, q0.y, r * across, r * across * (up > 0.5 ? 0.62 : 0.9)]);
      };
      // The same skin as the broad faces: flat patches paler and greyer, and grit.
      for (let j = 0; j < Math.ceil(len / 5); j++) {
        g.beginPath();
        g.ellipse(T() * len, (T() - 0.5) * 2 * G, 1.5 + T() * 4, 1 + T() * 2.5, (T() - 0.5) * 0.6, 0, TAU);
        g.fillStyle = T() < 0.5 ? css(mix(k.fill, [255, 252, 244], 0.4), 0.4) : css(mix(k.fill, hex('#9c94a4'), 0.32), 0.3);
        g.fill();
      }
      g.fillStyle = css(mix(k.fill, hex('#6d6274'), 0.5), 0.35);
      for (let j = 0; j < len * 1.2; j++) g.fillRect(T() * len, (T() - 0.5) * 2 * G, 0.35 + T() * 0.3, 0.35 + T() * 0.3);
      /*
       * Down each long side, notches cut across its front
       * arris in groups of one to five, as the oldest stones are lettered on
       * their edges: so a stone seen side on still shows it is written on.
       */
      if (Math.abs(up) < 0.3 && len > 24 && spec.sideRunes && Math.sign(mx) === -sideK) {
        // A strip of runes down the middle of the side, ruled either side, each rune upright however the strip runs.
        const along = dz >= 0 ? 1 : -1, per = len / Math.max(1, Math.abs(dz));
        cut(g, k.fill, 0.45, () => { g.beginPath(); g.moveTo(3, G - 3); g.lineTo(len - 3, G - 3); });
        cut(g, k.fill, 0.45, () => { g.beginPath(); g.moveTo(3, -G + 3); g.lineTo(len - 3, -G + 3); });
        const n = Math.floor((len - 8) / 8.5);
        for (let j = 0; j < n; j++) {
          const sc = 4 + (len - 8) * ((j + 0.5) / n);
          const glyph = spec.sideRunes[(i * 3 + j) % spec.sideRunes.length];
          g.save();
          g.translate(sc, 0);
          g.transform(0, 1, along * per, 0, 0, 0);
          cut(g, k.fill, 0.6, () => glyphPath(g, glyph, 0, 0, 2.3));
          g.restore();
        }
      } else if (Math.abs(up) < 0.3 && len > 24) {
        const N = rand(spec.seed * 211 + i);
        const edge = G - 0.4;
        // On the mossy side only above the moss.
        const from = Math.sign(mx) === sideK ? 8 + 24 * spec.moss : 6;
        for (let s0 = from; s0 < len - 6;) {
          const n = 1 + Math.floor(N() * 5), long = N() < 0.5;
          for (let j = 0; j < n; j++) {
            const sj = s0 + j * 1.5;
            cut(g, k.fill, 0.5, () => { g.beginPath(); g.moveTo(sj, edge); g.lineTo(sj, edge - (long ? 5.5 : 3.2)); });
          }
          s0 += n * 1.5 + 3 + N() * 2;
        }
        cut(g, k.fill, 0.45, () => { g.beginPath(); g.moveTo(4, edge - 0.2); g.lineTo(len - 4, edge - 0.2); });
      }
      if (up > 0.35) {
        // A top: moss over it as far as it has got, thicker toward the mossy side, in masses where the noise has it.
        const lean = (mx * sideK) / 20;
        const cover = spec.moss * (0.8 + 0.5 * lean) + 0.12;
        for (let j = 0, n = Math.round((len * 2 * G) / 1.4); j < n; j++) {
          const s = T() * len, y = -G + 0.3 + T() * (2 * G - 0.6);
          const nz = noise2((mx + s) / 4.5, y / 4.5, spec.seed * 7 + 3);
          if (Math.max(0.6, cover) * 1.2 + (nz - 0.5) * 1.2 < 0.6) continue;
          pad(s, y, cushion(T) + 0.3);
        }
      } else if (onSide) {
        // The mossy side, low down: a band up from the foot.
        const rise = 8 + 20 * spec.moss;
        if (Math.min(p[1], q[1]) < rise) {
          for (let j = 0, n = Math.round((len * 2 * G) / 1.5); j < n; j++) {
            const s = T() * len, y = -G + 0.3 + T() * (2 * G - 0.6);
            const z = p[1] + (dz * s) / len;
            const nz = noise2(z / 5, y / 5, spec.seed * 7 + 11);
            if ((1 - z / rise) * 1.3 + (nz - 0.5) * 1.1 < 0.62) continue;
            pad(s, y, cushion(T, 1 - z / rise) + 0.25);
          }
        }
      }
      g.save();
      g.setTransform(k.base);
      pads(g, ps);
      g.restore();
    };
    // Ivy up the strip at the foot of the mossy side, let run on up past it.
    const over: Painter | undefined = onSide && Math.min(p[1], q[1]) < 1 && ivy.length ? (g) => {
      const along = dz >= 0 ? 1 : -1;
      const per = len / Math.max(1, Math.abs(dz));
      for (const iv of ivy) {
        const pic = strandPic(iv.kind, iv.v, STAGES, true);
        if (!pic) continue;
        // Along the strip is up it on the right side and down it on the left; through it is across the picture.
        const z0 = iv.z ?? 0.5;
        const low = along > 0 ? p[1] : q[1];
        const s0 = along > 0 ? (z0 - low) * per : len - (z0 - low) * per;
        const sc = (iv.k * 10) / PPM;
        g.save();
        g.transform(0, sc, -along * sc * per, 0, s0 + along * sc * per * pic.ay, iv.x - sc * pic.ax);
        g.drawImage(pic.img, 0, 0);
        g.restore();
      }
    } : undefined;
    return { paint, over };
  };

  things.push({
    x: 0,
    y: 0,
    faces: plate({
      o: O, U: [1, 0, 0], W, A: [0, 1, 0], outline: spec.outline, half: [half0, half1], tTop, bevel: spec.bevel, tone: spec.stone,
      front: front.paint, frontOver: front.over, back: back.paint, backOver: back.over, edge: edgePaint, sunk: true, depthAt: spec.depthAt,
    }),
  });

  /* -- the outcrop: a broad low slab, rocks hugging the foot, boulders further out -- */
  const slab = boulder(0, 0, 34, 29, SLAB_H, R() * TAU, spec.seed * 3 + 1, spec.rock, Math.min(1, 0.35 + spec.moss * 0.6));
  things.push({ x: 0, y: 0, first: true, faces: slab });
  const S = spec.rocks.size;
  // Rocks hugging the foot, all round it: the near ones in front of it, the far behind.
  for (let i = 0; i < spec.rocks.foot; i++) {
    const a = ((i + R() * 0.5) / spec.rocks.foot) * TAU;
    const d = 23 + R() * 6;
    const x = Math.cos(a) * d * 1.1, y = Math.sin(a) * d * 0.85;
    const r = (7 + R() * 5) * S, h = (3.5 + R() * 4.5) * S;
    const mossy = Math.max(0.2, Math.min(1, spec.moss + 0.25 * (x * spec.mossSide) / 25));
    things.push({ x, y, faces: boulder(x, y, r, r * (0.7 + R() * 0.3), h + SLAB_H * 0.6, R() * TAU, spec.seed * 17 + i, spec.rock, mossy) });
  }
  // And boulders out in the grass.
  for (let i = 0; i < spec.rocks.outer; i++) {
    const a = ((i + 0.5 + R() * 0.6) / spec.rocks.outer) * TAU;
    const d = 38 + R() * 12;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const r = (3.5 + R() * 4.5) * S, h = (2 + R() * 3) * S;
    things.push({ x, y, faces: boulder(x, y, r, r * (0.65 + R() * 0.3), h, R() * TAU, spec.seed * 23 + i, spec.rock, spec.moss * 0.8) });
  }

  /* -- what has fallen off it -- */
  for (const [n, fl] of spec.fallen.entries()) {
    const c = Math.cos(fl.face), s = Math.sin(fl.face);
    // Out along which the piece faces, and across it, level.
    const out: V3 = [c, s, 0], side: V3 = [-s, c, 0];
    if (fl.kind === 'disc' || fl.kind === 'drum') {
      const r = fl.r;
      const ring = Array.from({ length: 22 }, (_, i) => {
        const a = (i / 22) * TAU;
        // A chip out of the rim now and then.
        const k = i % 7 === 3 ? 0.9 : 1;
        return [Math.cos(a) * r * k, Math.sin(a) * r * k] as Pt;
      });
      if (fl.kind === 'disc') {
        // Standing on its rim, leaning back `lean` from upright, its carved face out.
        const A: V3 = [c * Math.cos(fl.lean), s * Math.cos(fl.lean), Math.sin(fl.lean)];
        const Wv: V3 = [-c * Math.sin(fl.lean), -s * Math.sin(fl.lean), Math.cos(fl.lean)];
        // Sunk into the turf as far as it says: what is under the ground is not drawn (`drawFaces`).
        const o: V3 = [fl.x, fl.y, r * Math.cos(fl.lean) * (1 - (fl.sink ?? 0)) - 1.2];
        const carve = fl.carve;
        things.push({
          x: fl.x, y: fl.y,
          faces: plate({
            o, U: side, W: Wv, A, outline: ring, half: [1.6, 1.6], tTop: 1, bevel: 0.7, tone: spec.rock,
            front: (g, k) => {
              cut(g, k.fill, 0.55, () => strokesPath(g, roundelStrokes(carve), 0, 0, r * 0.82));
              const T = rand(spec.seed + n);
              const tr = g.getTransform();
              const inv = k.base.inverse();
              const across = Math.hypot(k.e.ux, k.e.uy);
              const ps: Pad[] = [];
              for (let i = 0; i < 24 * spec.moss + 6; i++) {
                const a = Math.PI + (T() - 0.5) * 2.4, d = r * (0.55 + 0.45 * T());
                const q = inv.transformPoint(tr.transformPoint(new DOMPoint(Math.cos(a) * d * 0.4, -r + Math.abs(Math.sin(a)) * d * 0.5)));
                ps.push([q.x, q.y, (1 + T() * 1.4) * across, (1 + T() * 1.4) * across * 0.85]);
              }
              g.save();
              g.setTransform(k.base);
              pads(g, ps);
              g.restore();
            },
          }),
        });
      } else {
        // A drum on its side: its round ends face along it.
        const len = fl.len;
        const o: V3 = [fl.x, fl.y, r - 1.2];
        things.push({
          x: fl.x, y: fl.y,
          faces: plate({
            o, U: side, W: [0, 0, 1], A: out, outline: ring, half: [len / 2, len / 2], tTop: 1, bevel: 0.8, tone: spec.rock,
            front: (g, k) => {
              cut(g, k.fill, 0.5, () => { g.beginPath(); g.arc(0, 0, r * 0.62, 0, TAU); });
              cut(g, k.fill, 0.4, () => { g.beginPath(); g.moveTo(-r * 0.3, r * 0.5); g.lineTo(r * 0.1, -r * 0.1); g.lineTo(-r * 0.05, -r * 0.6); });
            },
            back: (g, k) => cut(g, k.fill, 0.5, () => { g.beginPath(); g.arc(0, 0, r * 0.62, 0, TAU); }),
            edge: (i) => (i % 3 === 0 ? { paint: (g, k) => {
              const T = rand(spec.seed + i);
              const tr = g.getTransform();
              const inv = k.base.inverse();
              const across = Math.hypot(k.e.ux, k.e.uy);
              const ps: Pad[] = [];
              for (let j = 0; j < 6; j++) {
                const q = inv.transformPoint(tr.transformPoint(new DOMPoint(T() * 3, (T() - 0.5) * len * 0.8)));
                ps.push([q.x, q.y, (1 + T()) * across, (1 + T()) * across * 0.7]);
              }
              g.save();
              g.setTransform(k.base);
              pads(g, ps);
              g.restore();
            } } : undefined),
          }),
        });
      }
    } else if (fl.kind === 'chunk') {
      /*
       * The shoulder broken off the Wardenfall: the part of the outline the
       * break took, lying on its back, its carved face up and tipped toward
       * where it fell from, the lines of the panel's border still on it.
       */
      const piece: Pt[] = [
        [-2.6, 97.5], [4.2, 86.5], [10.2, 79], [14.4, 68], [17.4, 60], [18.6, 74], [17.6, 92], [12, 103], [3, 104.6],
      ];
      const cx = piece.reduce((m, p) => m + p[0], 0) / piece.length, cz = piece.reduce((m, p) => m + p[1], 0) / piece.length;
      const local = piece.map(([x, z]) => [x - cx, z - cz] as Pt);
      const A: V3 = [-c * Math.sin(fl.tilt), -s * Math.sin(fl.tilt), Math.cos(fl.tilt)];
      const U: V3 = side;
      const Wv: V3 = [c * Math.cos(fl.tilt), s * Math.cos(fl.tilt), Math.sin(fl.tilt)];
      const o: V3 = [fl.x, fl.y, 5.2];
      things.push({
        x: fl.x, y: fl.y,
        faces: plate({
          o, U, W: Wv, A, outline: local, half: [6, 6], tTop: 1, bevel: 1.4, tone: spec.stone,
          front: (g, k) => {
            const fill = k.fill;
            const T = rand(spec.seed * 3 + 7);
            for (let i = 0; i < 10; i++) {
              g.beginPath();
              g.ellipse((T() - 0.5) * 16, (T() - 0.5) * 22, 2 + T() * 4, 1 + T() * 3, 0, 0, TAU);
              g.fillStyle = T() < 0.5 ? css(mix(fill, [255, 252, 244], 0.35), 0.35) : css(mix(fill, hex('#9c94a4'), 0.3), 0.22);
              g.fill();
            }
            // The border of the panel ran through here: two rules, cut off by the break.
            cut(g, fill, 0.7, () => { g.beginPath(); g.moveTo(-7 - cx * 0, -14); g.lineTo(-5.2, 6); g.quadraticCurveTo(-4, 13, 1, 16); });
            cut(g, fill, 0.5, () => { g.beginPath(); g.moveTo(-5.2, -14); g.lineTo(-3.4, 5.4); g.quadraticCurveTo(-2.4, 11, 1.6, 13.6); });
            cut(g, fill, 0.78, () => glyphPath(g, 'algiz', 2.6, -3, 2.8));
            for (let i = 0; i < 4; i++) lichen(g, T, (T() - 0.3) * 12, (T() - 0.5) * 20, 1.2 + T() * 1.4, spec.lichen);
          },
        }),
      });
    } else {
      // A flake split off the foot, leaning on it or on a rock, thin and sharp.
      const piece: Pt[] = [[-fl.w / 2, 0], [fl.w / 2, 0], [fl.w * 0.42, fl.h * 0.55], [fl.w * 0.12, fl.h], [-fl.w * 0.3, fl.h * 0.8], [-fl.w * 0.5, fl.h * 0.35]];
      const A: V3 = [c * Math.cos(fl.lean), s * Math.cos(fl.lean), Math.sin(fl.lean)];
      const Wv: V3 = [-c * Math.sin(fl.lean), -s * Math.sin(fl.lean), Math.cos(fl.lean)];
      things.push({
        x: fl.x, y: fl.y,
        faces: plate({
          o: [fl.x, fl.y, -0.5], U: side, W: Wv, A, outline: piece, half: [1.8, 1.4], tTop: fl.h, bevel: 0.6, tone: spec.rock,
          front: (g, k) => {
            cut(g, k.fill, 0.55, () => glyphPath(g, 'cross', 0, fl.h * 0.45, fl.h * 0.18));
            const T = rand(spec.seed * 7 + n);
            lichen(g, T, -fl.w * 0.2, fl.h * 0.7, 1.4, spec.lichen);
          },
        }),
      });
    }
  }

  /* -- flowers and grass at the foot of everything -- */
  const kinds: string[] = [];
  for (const [c, k] of spec.flowers) for (let i = 0; i < k; i++) kinds.push(c);
  const placeFlowers = (n: number, rMin: number, rMax: number, z: number, big: number): void => {
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = rMin + R() * (rMax - rMin);
      const x = Math.cos(a) * d * 1.05, y = Math.sin(a) * d * 0.95;
      const colour = kinds[Math.floor(R() * kinds.length)];
      const seed = spec.seed * 1000 + i * 7 + Math.round(z);
      things.push({
        x, y,
        reach: [[x, y, z + 14]],
        draw: (g, e) => {
          const [px, py] = proj(e, [x, y, z]);
          flowerClump(g, px, py, colour, seed, big);
        },
      });
    }
  };
  placeFlowers(3, 19, 22, SLAB_H, 1.6);
  placeFlowers(10, 20, 32, SLAB_H, 1.15);
  placeFlowers(16, 33, 54, 0, 1.05);
  for (let i = 0; i < 44; i++) {
    const a = R() * TAU, d = i < 26 ? 18 + R() * 38 : 46 + R() * 12;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const z = d < 31 ? SLAB_H : 0, seed = spec.seed * 77 + i;
    things.push({ x, y, draw: (g, e) => { const [px, py] = proj(e, [x, y, z]); grassTuft(g, px, py, seed); } });
  }

  /* -- the turf it all stands in: a blob a little inside the footprint -- */
  const turf: Pt[] = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * TAU;
    const r = 50 + R() * 7;
    return [Math.cos(a) * r, Math.sin(a) * r] as Pt;
  });

  const frontFrame = { o: at(O, [half0, [0, 1, 0]]), a: [1, 0, 0] as V3, b: at(W, [f, [0, 1, 0]]) };
  const backFrame = { o: at(O, [-half0, [0, 1, 0]]), a: [-1, 0, 0] as V3, b: at(W, [-f, [0, 1, 0]]) };
  const model: Model = {
    spec,
    things,
    faces: { front: frontFrame, back: backFrame },
    normals: { front: newell([frontFrame.o, add(frontFrame.o, frontFrame.a), add(add(frontFrame.o, frontFrame.a), frontFrame.b)]), back: [0, 0, 0] },
    runes,
    turf,
    top: FOOT + tTop,
  };
  // The front's normal is out through the front; the back's the other way.
  if (model.normals.front[1] < 0) model.normals.front = mul(model.normals.front, -1);
  const bn = newell([backFrame.o, add(backFrame.o, backFrame.a), add(add(backFrame.o, backFrame.a), backFrame.b)]);
  model.normals.back = bn[1] > 0 ? mul(bn, -1) : bn;
  models.set(id, model);
  return model;
}

/* ---- baking ----------------------------------------------------------------- */

/** One rune's light, baked: the lit groove and the glow round it, where they go, and its beat. */
interface Glow {
  core: HTMLCanvasElement;
  halo: HTMLCanvasElement;
  /** The glow after dark: tighter, so a rune lit against the night is its shape with a little light round it. */
  dusk: HTMLCanvasElement;
  /** Its own shape, a little widened, for the night to be taken off with (`runestoneMasks`): a picture the size of `box`. */
  mask: HTMLCanvasElement;
  /** How much of its face the eye sees square on, nought (edge on) to one: a slanted face's runes glow as lines, not haze. */
  square: number;
  /** Where each picture goes, in pixels at zoom one from the footprint's middle: left, top, width, height. */
  box: [number, number, number, number];
  /** Its middle and how far its light reaches, for the night's hole. */
  cx: number;
  cy: number;
  r: number;
  i: number;
  roundel: boolean;
}

interface Baked {
  canvas: HTMLCanvasElement;
  scale: number;
  /** Where the footprint's middle is on `canvas`, in its pixels. */
  ox: number;
  oy: number;
  /** What it covers from the footprint's middle, in pixels at zoom one: left, top, right, bottom. */
  bounds: [number, number, number, number];
  glows: Glow[];
  /** The carved face the eye sees, in the screen's frame at zoom one, for the motes: a 2x3 matrix, and the panel's run. */
  motes: { m: [number, number, number, number, number, number]; panel: Panel } | null;
}

/** The scales a stone is baked at: the first at or over the zoom, so it is always drawn down and never blown up. */
const BAKE_STEPS = [1, 1.5, 2, 3, 4, 5, 6];
/** Pixels of baked stones kept before the least lately drawn is let go. */
const BAKED_BUDGET = 24e6;
const baked = new Map<string, Baked>();
let bakedArea = 0;

const scaleFor = (zoom: number): number => BAKE_STEPS.find((s) => s >= zoom - 1e-6) ?? BAKE_STEPS[BAKE_STEPS.length - 1];

/** The night's wash, which the runes take back off themselves, never reaches this far. */
const canvasOf = (w: number, h: number): [HTMLCanvasElement, Ctx] => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext('2d') as Ctx];
};

/** Draw a solid's faces, back to front, each lit, painted and creased, ruled round in ink `ink` wide. */
/** A face cut off at the ground: what of it stands at or above nought, or nothing. */
function aboveGround(pts: readonly V3[]): V3[] {
  if (pts.every((p) => p[2] >= 0)) return pts as V3[];
  const out: V3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (a[2] >= 0) out.push(a);
    if ((a[2] >= 0) !== (b[2] >= 0)) {
      const t = a[2] / (a[2] - b[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0]);
    }
  }
  return out;
}

function drawFaces(g: Ctx, e: Eye, faces0: readonly Face[], ink: number): void {
  const base = g.getTransform();
  // What stands under the turf -- a sunk disc's lower half, a boulder's foot -- is not drawn.
  const faces = faces0.map((f) => ({ ...f, pts: aboveGround(f.pts) })).filter((f) => f.pts.length >= 3);
  const seen = faces.filter((f) => dot(f.n, e.toward) > 1e-6)
    .map((f) => ({ f, d: nearness(e, mul(f.pts.reduce<V3>((m, p) => add(m, p), [0, 0, 0]), 1 / f.pts.length)) }))
    .sort((a, b) => a.d - b.d);
  const path = (pts: Pt[]): void => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  };
  /*
   * The ink round the whole solid: every face it shows stroked twice as wide
   * as the ink in its colour, then the faces filled over that, so all that
   * is left of it is the rim outside them.
   */
  g.lineJoin = 'round';
  g.strokeStyle = css(STONE_INK);
  g.lineWidth = ink * 2;
  for (const { f } of seen) {
    path(f.pts.map((p) => proj(e, p)));
    g.stroke();
  }
  const overs: Array<() => void> = [];
  for (const { f } of seen) {
    const pts = f.pts.map((p) => proj(e, p));
    const L = lightOf(e, f.n);
    const fill = faceColour(f.tone, L);
    path(pts);
    g.fillStyle = css(fill);
    g.fill();
    // Stroked in the face's own colour first, so two faces meet without a hairline of the ground between them.
    g.strokeStyle = css(fill);
    g.lineWidth = 0.5;
    g.stroke();
    const frame = f.frame;
    const k: PaintCtx = { e, L, fill, base };
    if (f.paint && frame) {
      g.save();
      path(pts);
      g.clip();
      const [ox, oy] = proj(e, frame.o), [ax, ay] = proj(e, frame.a), [bx, by] = proj(e, frame.b);
      g.transform(ax, ay, bx, by, ox, oy);
      f.paint(g, k);
      g.restore();
    }
    if (f.over && frame) {
      const over = f.over;
      overs.push(() => {
        g.save();
        const [ox, oy] = proj(e, frame.o), [ax, ay] = proj(e, frame.a), [bx, by] = proj(e, frame.b);
        g.transform(ax, ay, bx, by, ox, oy);
        over(g, k);
        g.restore();
      });
    }
    path(pts);
    g.strokeStyle = css(mix(fill, CREASE_INK, 0.6), f.crease ?? 0.35);
    g.lineWidth = 0.55;
    g.lineJoin = 'round';
    g.stroke();
  }
  for (const o of overs) o();
}

/** What a stone covers from one viewpoint, in pixels at zoom one: every corner of everything, the flowers' heads, and room round it. */
function measure(model: Model, e: Eye): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (p: V3): void => {
    const [x, y] = proj(e, p);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  };
  for (const t of model.things) {
    for (const f of t.faces ?? []) for (const p of f.pts) take(p);
    for (const p of t.reach ?? []) take(p);
  }
  for (const [x, y] of model.turf) take([x, y, 0]);
  // Room for ivy over the edges, the ink, and the glow of the topmost runes.
  const pad = 14;
  return [Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 + pad), Math.ceil(y1 + pad)];
}

function bake(id: RunestoneId, rotation: number, scale: number): Baked {
  const model = modelOf(id);
  const spec = model.spec;
  const e = eyeOf(spec.yaw, rotation);
  const [x0, y0, x1, y1] = measure(model, e);
  const [canvas, g] = canvasOf((x1 - x0) * scale, (y1 - y0) * scale);
  const base = new DOMMatrix([scale, 0, 0, scale, -x0 * scale, -y0 * scale]);
  g.setTransform(base);

  /* -- the turf: a flat field of the outcrop's moss green, a step darker at its heart, round under it all -- */
  const turfPath = (k: number): void => {
    g.beginPath();
    model.turf.forEach(([x, y], i) => {
      const [px, py] = proj(e, [x * k, y * k, 0]);
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    });
    g.closePath();
  };
  turfPath(0.86);
  g.fillStyle = 'rgba(118, 156, 122, 0.4)';
  g.fill();
  {
    // Its edge, ragged: flat patches of it scattered across the line, thinning out into the grass.
    const F = rand(spec.seed * 991 + 7);
    const across = Math.hypot(e.ux, e.uy);
    for (let i = 0; i < 90; i++) {
      const j = Math.floor(F() * model.turf.length), q = model.turf[j];
      const a = Math.atan2(q[1], q[0]) + (F() - 0.5) * 0.3, rr = Math.hypot(q[0], q[1]) * (0.8 + F() * 0.26);
      const [px, py] = proj(e, [Math.cos(a) * rr, Math.sin(a) * rr, 0]);
      const out = (rr / Math.hypot(q[0], q[1]) - 0.8) / 0.26;
      const r = (1.4 + F() * 2.6) * across * (1.1 - 0.5 * out);
      g.fillStyle = `rgba(118, 156, 122, ${(0.4 * (1 - 0.7 * out)).toFixed(3)})`;
      g.beginPath();
      g.ellipse(px, py, r, r * 0.5, 0, 0, TAU);
      g.fill();
    }
  }
  // And the stone's shade on the ground, thrown away from the light: flat, one field, as every shade on the island is.
  {
    const [sx, sy] = proj(e, [0, 0, 0]);
    g.fillStyle = 'rgba(44, 74, 78, 0.17)';
    g.beginPath();
    g.ellipse(sx + 16, sy + 6, 52, 20, 0.12, 0, TAU);
    g.fill();
  }

  /* -- everything standing, in order: the slab first, then the rest by where it stands -- */
  const things = model.things.slice().sort((a, b) => (a.first ? -1 : b.first ? 1 : groundNear(e, a.x, a.y) - groundNear(e, b.x, b.y)));
  const ink = 1;
  for (const t of things) {
    if (t.draw) {
      t.draw(g, e);
      continue;
    }
    if (t.faces) drawFaces(g, e, t.faces, ink);
  }

  /* -- the runes' light, baked a rune at a time, to be laid at its own strength each frame -- */
  const glows: Glow[] = [];
  let motes: Baked['motes'] = null;
  for (const which of ['front', 'back'] as const) {
    if (dot(model.normals[which], e.toward) <= 1e-6) continue;
    const fr = model.faces[which];
    const [ox, oy] = proj(e, fr.o), [ax, ay] = proj(e, fr.a), [bx, by] = proj(e, fr.b);
    const M = new DOMMatrix([ax, ay, bx, by, ox, oy]);
    const panel = spec[which];
    if (!motes) motes = { m: [ax, ay, bx, by, ox, oy], panel };
    for (const r of model.runes) {
      if (r.face !== which) continue;
      const reach = r.roundel ? r.s * 1.25 : r.s * 1.9;
      // Its box on the screen: the corners of its square in the face, and room for the glow.
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = M.transformPoint(new DOMPoint(r.x + dx * reach, r.z + dz * reach));
        a = Math.min(a, p.x); c = Math.max(c, p.x); b = Math.min(b, p.y); d = Math.max(d, p.y);
      }
      a -= 3; b -= 3; c += 3; d += 3;
      const box: [number, number, number, number] = [a, b, c - a, d - b];
      const sheet = (draw: (h: Ctx) => void): HTMLCanvasElement => {
        const [cv, h] = canvasOf((c - a) * scale, (d - b) * scale);
        h.setTransform(scale, 0, 0, scale, -a * scale, -b * scale);
        h.transform(M.a, M.b, M.c, M.d, M.e, M.f);
        h.lineCap = 'round';
        h.lineJoin = 'round';
        draw(h);
        return cv;
      };
      const path = (h: Ctx): void => (r.roundel ? strokesPath(h, roundelStrokes(r.roundel), r.x, r.z, r.s) : glyphPath(h, r.glyph, r.x, r.z, r.s));
      const w = r.roundel ? 0.62 : 0.78;
      const halo = sheet((h) => {
        // Soft by being laid in widening strokes, each faint: light, which may be soft where nothing else on the island is.
        for (const [k, al] of [[5.2, 0.05], [3.8, 0.08], [2.6, 0.12], [1.7, 0.2]] as Array<[number, number]>) {
          path(h);
          h.strokeStyle = `rgba(255, 172, 72, ${al})`;
          h.lineWidth = w * k * (r.roundel ? 0.6 : 1);
          h.stroke();
        }
      });
      const dusk = sheet((h) => {
        for (const [k, al] of [[2.6, 0.08], [1.8, 0.14], [1.3, 0.2]] as Array<[number, number]>) {
          path(h);
          h.strokeStyle = `rgba(255, 176, 80, ${al})`;
          h.lineWidth = w * k;
          h.stroke();
        }
      });
      const core = sheet((h) => {
        path(h);
        h.strokeStyle = 'rgba(214, 140, 52, 0.9)';
        h.lineWidth = w * 1.05;
        h.stroke();
        path(h);
        h.strokeStyle = '#ffd98c';
        h.lineWidth = w * 0.72;
        h.stroke();
        path(h);
        h.strokeStyle = '#fffbea';
        h.lineWidth = w * 0.34;
        h.stroke();
      });
      const mid = M.transformPoint(new DOMPoint(r.x, r.z));
      // How far its light reaches on the screen: no further than the face it is on is wide there, seen slantwise.
      const up = Math.hypot(M.c, M.d) * r.s, across = Math.hypot(M.a, M.b) * r.s;
      const reachPx = r.roundel ? Math.min(up, across) * 1.1 : Math.min(up * 1.25, across * 1.5 + 1.5);
      /*
       * The night taken off it in its own shape: its strokes laid wide and
       * whole, and wider still and faint round them, on a picture the size of
       * its light -- so what shows through the dark is the rune and a little
       * of the stone round it, never a round spot, however slantwise its face.
       */
      const mask = sheet((h) => {
        path(h);
        // A roundel's strokes lie close, so its are narrower: its ring and figure lit, not the whole disc.
        h.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        h.lineWidth = w * (r.roundel ? 2.6 : 3.6);
        h.stroke();
        path(h);
        h.strokeStyle = 'rgba(0, 0, 0, 1)';
        h.lineWidth = w * (r.roundel ? 1.8 : 2.2);
        h.stroke();
      });
      const square = Math.max(0.15, Math.min(1, across / up / 0.53));
      glows.push({ core, halo, dusk, mask, square, box, cx: mid.x, cy: mid.y, r: reachPx, i: r.i, roundel: !!r.roundel });
    }
  }
  return { canvas, scale, ox: -x0 * scale, oy: -y0 * scale, bounds: [x0, y0, x1, y1], glows, motes };
}

function bakedFor(id: RunestoneId, rotation: number, zoom: number): Baked {
  const scale = scaleFor(zoom);
  const key = `${id}|${((rotation % 8) + 8) % 8}|${scale}`;
  let b = baked.get(key);
  if (b) {
    // Most lately drawn last, so the oldest go first.
    baked.delete(key);
    baked.set(key, b);
    return b;
  }
  b = bake(id, rotation, scale);
  baked.set(key, b);
  bakedArea += b.canvas.width * b.canvas.height;
  for (const [k, old] of baked) {
    if (bakedArea <= BAKED_BUDGET || k === key) break;
    baked.delete(k);
    bakedArea -= old.canvas.width * old.canvas.height;
  }
  return b;
}

/* ---- the light of the runes ------------------------------------------------- */

/** Seconds to a breath of the runes, and how far behind the one under it each is, in turns. */
const BREATH = 4.8;
const STAGGER = 0.11;
/** And the roundel's slower breath. */
const ROUNDEL_BREATH = 7.4;

/** How far into its breath a rune is at `t`, nought to one: the light climbs the column, the bottom rune first. */
const breath = (g: Glow, t: number): number => g.roundel
  ? 0.5 + 0.5 * Math.sin((t / ROUNDEL_BREATH) * TAU)
  : 0.5 + 0.5 * Math.sin((t / BREATH - g.i * STAGGER) * TAU);

/** Motes rising past the runes: how many, and the seconds each takes to rise. */
const MOTES = 7;
const MOTE_RISE = 6.5;

/**
 * Where the motes are at `t`: each rising from the foot of the panel past its
 * head on its own clock, swaying across it and fading in and out -- in pixels
 * at zoom one from the footprint's middle, how bright, and how big on the
 * screen at `zoom`.
 */
function motesAt(b: Baked, t: number, zoom: number): Array<{ x: number; y: number; a: number; r: number }> {
  if (!b.motes) return [];
  const [ma, mb, mc, md, me, mf] = b.motes.m;
  const pn = b.motes.panel;
  const top = pn.roundel ? pn.roundel.z + pn.roundel.r : pn.z1 + pn.arch;
  const out: Array<{ x: number; y: number; a: number; r: number }> = [];
  for (let i = 0; i < MOTES; i++) {
    const u = ((t / (MOTE_RISE + i * 0.6) + i * 0.37) % 1 + 1) % 1;
    const z = pn.z0 + u * (top - pn.z0 + 6);
    const mid = pn.x0 + (pn.x1 - pn.x0) * Math.min(1, (z - pn.z0) / Math.max(1, pn.z1 - pn.z0));
    const x = mid + Math.sin(u * TAU * 0.8 + i * 1.9) * pn.w * 0.62;
    out.push({
      x: ma * x + mc * z + me, y: mb * x + md * z + mf,
      a: Math.pow(Math.sin(Math.PI * u), 1.4),
      r: (1.1 + 0.5 * ((i * 0.618) % 1)) * zoom ** 0.75,
    });
  }
  return out;
}

/**
 * Draw a runestone whose footprint's middle is at (sx, sy) on the screen, from
 * viewpoint `rotation`, at `t` seconds, under a night `night` dark (0 by day,
 * 1 at midnight). Returns what it covers, from (sx, sy), in screen pixels:
 * left, top, right, bottom.
 *
 * By day the runes are lit gold in their grooves with a warm glow round them
 * laid on as colour, which pale stone takes as gold where added light would
 * not show at all; after dark the glow is light, added, and stronger, and the
 * night is taken back off them by `runestoneHoles`.
 */
export function drawRunestone(ctx: Ctx, sx: number, sy: number, zoom: number, id: RunestoneId, rotation: number, night = 0, t = performance.now() / 1000): [number, number, number, number] {
  const b = bakedFor(id, rotation, zoom);
  const k = zoom / b.scale;
  ctx.drawImage(b.canvas, sx - b.ox * k, sy - b.oy * k, b.canvas.width * k, b.canvas.height * k);
  const was = ctx.globalCompositeOperation;
  const wasA = ctx.globalAlpha;
  const day = 1 - night;
  for (const gl of b.glows) {
    const p = breath(gl, t);
    const [x, y, w, h] = gl.box;
    const X = sx + x * zoom, Y = sy + y * zoom, Wd = w * zoom, Ht = h * zoom;
    /*
     * The glow round it: colour by day, as wide as its face is seen square
     * on, so runes on a face seen slantwise are gold lines and not haze; and
     * after dark light, tight round its shape, a roundel's fainter still so
     * where its strokes cross it does not burn to a white spot.
     */
    if (day > 0.01) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = day * (0.3 + 0.45 * p) * (gl.roundel ? 0.7 : 1) * gl.square;
      ctx.drawImage(gl.halo, X, Y, Wd, Ht);
    }
    if (night > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = night * (gl.roundel ? 0.22 + 0.14 * p : 0.2 + 0.3 * p);
      ctx.drawImage(gl.dusk, X, Y, Wd, Ht);
    }
    // The lit groove itself, always there and brighter as it breathes in.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(1, 0.55 + 0.25 * night + 0.35 * p);
    ctx.drawImage(gl.core, X, Y, Wd, Ht);
    if (!gl.roundel) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.08 + 0.16 * night) * p;
      ctx.drawImage(gl.core, X, Y, Wd, Ht);
    }
  }
  // Motes of light rising up the panel and fading.
  for (const m of motesAt(b, t, zoom)) {
    const px = sx + m.x * zoom, py = sy + m.y * zoom;
    const a = m.a * (0.2 + 0.8 * night);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * 0.3;
    ctx.fillStyle = 'rgb(255, 196, 110)';
    ctx.beginPath();
    ctx.arc(px, py, m.r * 1.5, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgb(255, 238, 190)';
    ctx.save();
    ctx.translate(px, py);
    star(ctx, m.r * 1.7, m.r * 0.6);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalCompositeOperation = was;
  ctx.globalAlpha = wasA;
  const [l, tp, r, bt] = b.bounds;
  return [l * zoom, tp * zoom, r * zoom, bt * zoom];
}

/**
 * Where a runestone drawn at (sx, sy) takes the night back off itself this
 * frame: a soft hole at each rune its eye can see, as strong as the rune is
 * lit, one round the roundel, and a wide faint one over the panel, so the
 * face the runes are on is lit by them -- in screen pixels, for the renderer
 * to cut out of the wash as it does an altar's (`furnitureHoles`).
 */
export function runestoneHoles(sx: number, sy: number, zoom: number, id: RunestoneId, rotation: number, t = performance.now() / 1000): Array<{ x: number; y: number; r: number; a: number }> {
  const b = bakedFor(id, rotation, zoom);
  const out: Array<{ x: number; y: number; r: number; a: number }> = [];
  for (const gl of b.glows) {
    const p = breath(gl, t);
    // A wide, faint hole round each, so the stone round a rune is lit by it; the rune itself goes by its own shape (`runestoneMasks`).
    out.push({ x: sx + gl.cx * zoom, y: sy + gl.cy * zoom, r: gl.r * 1.5 * zoom, a: 0.06 + 0.04 * p });
  }
  for (const m of motesAt(b, t, zoom)) out.push({ x: sx + m.x * zoom, y: sy + m.y * zoom, r: m.r * 2.2, a: 0.8 * m.a });
  return out;
}

/**
 * The runes of a runestone drawn at (sx, sy), in their own shapes, to take
 * the night back off with this frame: each a picture whose alpha is how much
 * of the wash to take away, where to lay it on the screen in pixels, and how
 * strongly, as it breathes. The renderer lays them `destination-out` on its
 * night layer beside the round holes (`runestoneHoles`), so a lit rune shows
 * through the dark as a rune and anybody in front of it is still in front.
 */
export function runestoneMasks(sx: number, sy: number, zoom: number, id: RunestoneId, rotation: number, t = performance.now() / 1000): Array<{ canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number; a: number }> {
  const b = bakedFor(id, rotation, zoom);
  return b.glows.map((gl) => {
    const p = breath(gl, t);
    const [x, y, w, h] = gl.box;
    return { canvas: gl.mask, x: sx + x * zoom, y: sy + y * zoom, w: w * zoom, h: h * zoom, a: gl.roundel ? 0.72 + 0.18 * p : 0.68 + 0.27 * p };
  });
}

/** What a runestone covers on the screen from its footprint's middle, in pixels at zoom one: for where it is clicked. */
export function runestoneBounds(id: RunestoneId, rotation: number): [number, number, number, number] {
  const model = modelOf(id);
  return measure(model, eyeOf(model.spec.yaw, rotation));
}

/** How tall a runestone stands, in pixels at zoom one: the top of its head over the ground. */
export const runestoneTop = (id: RunestoneId): number => Math.ceil(modelOf(id).top * HEIGHT_SCALE);
