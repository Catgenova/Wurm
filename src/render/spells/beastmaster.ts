/**
 * The Beastmaster's spells: how each is cast and what it looks like.
 *
 * A Beastmaster casts nothing out of the hand. Every spell is a word to the
 * companion -- a whistle, a slap of the thigh, a howl -- and what happens
 * happens through the beast: its claws, its jaws, its leap, its blood up. So
 * the casts are a handler's body language, not a mage's, and the effects are
 * drawn in the beast's own marks, one shape language across the twelve:
 *
 *   claws    three or four curved rakes across what was struck (`rake`)
 *   jaws     a bite closing (`bite`), a ring of teeth on the ground (`toothRing`)
 *   paws     prints where it pushed off and landed (`paw`)
 *   hackles  tongues of light standing up off its back when its blood is up (`mane`)
 *   voice    arcs going out from a mouth, the beast's or the handler's (`howl`)
 *   the beast itself, in light, when it leaps (`spirit`)
 *
 * in amber and earth, with the green of the wild for a mending and a taming
 * and blood red where blood is the point (Disembowel, Bloodlust).
 *
 * The companion is `k.companion` only for one's own casts; somebody else's
 * companion is not known here. So every spell is drawn so that it reads
 * without one: what the beast does to an enemy is drawn on the enemy, the
 * leap of a Pounce runs from the caster's side, and a spell on the beast
 * itself goes to where a companion walks at heel (`beastOf`) and stands a
 * beast of light there (`heelBeast`), so a peer's Bloodlust is still a
 * beast's blood rising at their side.
 *
 * This file is this group's alone and nobody else edits it, so anything its
 * spells share is written here, not in the kit.
 */
import type { CastPose, SpellVisual } from './index';
import { COMPANION_REACH } from '../../game/fight';
import { HEIGHT_SCALE } from '../iso';
import { spellInfo } from './info';
import { arcAt, bump, clamp, easeBack, easeIn, easeOut, flashOf, hashOf, lerp, mid3, seg, smooth, TAU, type Body, type FxScene, type P3, type SpellPalette } from './kit';
import { beats, euler, one } from './poses';

/** Amber eyes and earth brown, with a green of the wild. */
export const PALETTE: SpellPalette = {
  core: '#fff0cc',
  main: '#e0a346',
  deep: '#7a4e1f',
  accent: '#8bbf5a',
  ink: '#352210',
  light: '#ffc760',
};

/** Blood, for the spells about it: a cut's wet red, its dark, and the hot edge of a fresh one. */
const BLOOD = { main: '#b3261c', deep: '#5c120d', core: '#ff8a66', light: '#ff4a32' };
/** The green of the wild, lit: a mending, a taming. */
const WILD = { main: PALETTE.accent, deep: '#3f6b2f', core: '#e9ffd0', light: '#a8f07a' };
/** Teeth and claws: old ivory. */
const IVORY = '#f6e7c4';

/* ---- where the beast is ----------------------------------------------------------------- */

/** A companion's height in height units, as the renderer stands a small creature: what a stand-in at heel is drawn as. */
const BEAST_TALL = 22 / HEIGHT_SCALE;

/**
 * The beast a spell works through: your companion when it is yours, or the
 * place a companion walks at heel -- a little to the right of and behind its
 * keeper -- when the cast is somebody else's and theirs is not known.
 */
function beastOf(k: FxScene): Body {
  return k.companion ?? heelOf(k);
}

/** Where a companion walks at heel: a little to the right of its keeper and behind. */
function heelOf(k: FxScene): Body {
  const p = k.local(k.caster, 22, -6, 0);
  return { x: p.x, y: p.y, z: k.ground(p.x, p.y), tall: BEAST_TALL, wide: 5, facing: k.caster.facing, kind: 'spot' };
}

/** Where a blow on the target comes from: the companion when it is known, else the caster. */
const strikerOf = (k: FxScene): Body => k.companion ?? k.caster;

/** The angle on the screen from one point to another. */
const screenAngle = (k: FxScene, a: P3, b: P3): number => Math.atan2(k.sy(b) - k.sy(a), k.sx(b) - k.sx(a));

/** Which way on the screen a blow from `from` goes across `to`: +1 to the right, -1 to the left. */
const sideOf = (k: FxScene, from: { x: number; y: number }, to: { x: number; y: number }): number =>
  (k.sx({ x: to.x, y: to.y, z: 0 }) >= k.sx({ x: from.x, y: from.y, z: 0 }) ? 1 : -1);

/* ---- drawing ------------------------------------------------------------------------------ */

/**
 * A tapered stroke along points on the screen: `w` pixels at its fattest,
 * `fat` of the way along (nought: fattest at the start, a talon's root),
 * pointed at the ends; filled, a lit core down one side, inked. Every claw,
 * tooth and talon here is one of these.
 */
function taper(g: CanvasRenderingContext2D, xs: number[], ys: number[], w: number, fat: number, fill: string, core: string | null, ink: string, inkW: number): void {
  const n = xs.length;
  if (n < 2) return;
  const lx: number[] = [], ly: number[] = [], rx: number[] = [], ry: number[] = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let dx = xs[i1] - xs[i0], dy = ys[i1] - ys[i0];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const u = i / (n - 1);
    const prof = fat <= 0 ? Math.cos((u * Math.PI) / 2) : fat >= 1 ? Math.sin((u * Math.PI) / 2)
      : u < fat ? Math.sin((u / fat) * (Math.PI / 2)) : Math.cos(((u - fat) / (1 - fat)) * (Math.PI / 2));
    const h = (w / 2) * Math.max(0, prof);
    lx.push(xs[i] - dy * h);
    ly.push(ys[i] + dx * h);
    rx.push(xs[i] + dy * h);
    ry.push(ys[i] - dx * h);
  }
  g.beginPath();
  g.moveTo(lx[0], ly[0]);
  for (let i = 1; i < n; i++) g.lineTo(lx[i], ly[i]);
  for (let i = n - 1; i >= 0; i--) g.lineTo(rx[i], ry[i]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (inkW > 0) {
    g.lineJoin = 'miter';
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    g.stroke();
  }
  if (core) {
    // The lit edge: the upper-left half of the stroke, where the light comes from.
    const up = ly[Math.floor(n / 2)] < ry[Math.floor(n / 2)];
    const ex = up ? lx : rx, ey = up ? ly : ry;
    g.beginPath();
    g.moveTo(xs[0], ys[0]);
    for (let i = 1; i < n; i++) g.lineTo(lerp(xs[i], ex[i], 0.7), lerp(ys[i], ey[i], 0.7));
    for (let i = n - 1; i >= 0; i--) g.lineTo(lerp(xs[i], ex[i], 0.12), lerp(ys[i], ey[i], 0.12));
    g.closePath();
    g.fillStyle = core;
    g.fill();
  }
}

interface RakeOpts {
  /** Screen angle the claws travel, radians. */
  ang: number;
  /** Pixels at zoom one: how long a claw mark, and how far apart. */
  len: number;
  gap: number;
  /** Claws in the rake. */
  n?: number;
  /** Nought to one, how far through the cut. */
  u: number;
  alpha?: number;
  width?: number;
  /** How much each mark bows, as a share of its length; negative bows the other way. */
  bend?: number;
  fill?: string;
  core?: string;
  ink?: string;
  light?: string;
  glow?: number;
  bias?: number;
  /** Pixels at zoom one to move it by on the screen: a second paw beside the first. */
  shift?: readonly [number, number];
}

/**
 * Claw marks: `n` curved, tapered rakes side by side, fanning a little as
 * they go and the middle one leading, as a paw's claws do. Drawn on as `u`
 * goes, and left standing after as the wound.
 */
function rake(k: FxScene, p: P3, o: RakeOpts): void {
  const u = clamp(o.u), a = o.alpha ?? 1;
  if (u <= 0.02 || a <= 0.01) return;
  const Z = k.zoom, x0 = k.sx(p) + (o.shift?.[0] ?? 0) * Z, y0 = k.sy(p) + (o.shift?.[1] ?? 0) * Z;
  const L = o.len * Z, G = o.gap * Z, W = (o.width ?? 2) * Z, n = o.n ?? 3, bend = o.bend ?? 0.16;
  const cx = Math.cos(o.ang), cy = Math.sin(o.ang), px = -cy, py = cx;
  const head = easeOut(u);
  const marks: number[][] = [];
  for (let i = 0; i < n; i++) {
    const off = i - (n - 1) / 2;
    const len = L * (1 - 0.16 * Math.abs(off));
    const start = -len / 2 - Math.abs(off) * 0.08 * L;
    const xs: number[] = [], ys: number[] = [];
    const m = k.fast ? 5 : 8;
    for (let j = 0; j <= m; j++) {
      const s = (j / m) * head;
      const along = start + s * len;
      const side = off * G * (1 + 0.35 * s) + Math.sin(Math.PI * s) * bend * len;
      xs.push(x0 + cx * along + px * side);
      ys.push(y0 + cy * along + py * side);
    }
    marks.push(xs, ys);
  }
  const fill = o.fill ?? k.pal.main, core = o.core ?? k.pal.core, ink = o.ink ?? k.pal.ink;
  const inkW = Math.max(0.8, 0.7 * Z);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    for (let i = 0; i < marks.length; i += 2) taper(g, marks[i], marks[i + 1], W, 0.32, fill, core, ink, inkW);
  }, o.bias ?? 4);
  const gl = o.glow ?? 1;
  if (gl > 0) k.glow(p, o.len * 0.8, a * gl * 0.45, o.light ?? k.pal.light);
}

/** A beast's jaws seen from the side, hinged at -x and the nose at +x: the upper jaw's outline, then the lower's, in units of half its length. */
const UPPER_JAW: ReadonlyArray<readonly [number, number]> = [
  [-1, -0.04], [-0.5, -0.3], [0.2, -0.36], [0.74, -0.27], [1, -0.08], [0.93, 0.04], [0.7, -0.07], [0.1, -0.1], [-0.6, -0.03],
];
const LOWER_JAW: ReadonlyArray<readonly [number, number]> = [
  [-1, 0.04], [-0.4, 0.25], [0.3, 0.25], [0.8, 0.11], [0.86, 0.01], [0.6, 0.04], [0, 0.06], [-0.6, 0.04],
];
/** Their teeth: where along, and how long. A canine at the front of each, smaller ones behind. */
const UPPER_TEETH: ReadonlyArray<readonly [number, number]> = [[0.8, 0.3], [0.46, 0.15], [0.16, 0.13], [-0.14, 0.1]];
const LOWER_TEETH: ReadonlyArray<readonly [number, number]> = [[0.6, 0.25], [0.26, 0.13], [-0.04, 0.1]];

/**
 * A bite: a beast's jaws side-on, open and snapping shut as `shut` goes from
 * nought to one, the teeth meeting. `size` pixels at zoom one, half its
 * length; `face` +1 to bite toward screen right, -1 to the left.
 */
function bite(k: FxScene, p: P3, o: { size: number; shut: number; face?: number; alpha?: number; turn?: number; bias?: number; jaw?: string }): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const S = o.size * k.zoom, x = k.sx(p), y = k.sy(p);
  const open = 1 - clamp(o.shut);
  const jaw = o.jaw ?? k.pal.main, ink = k.pal.ink, core = k.pal.core, deep = k.pal.deep;
  const face = o.face ?? 1, turn = o.turn ?? 0;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.translate(x, y);
    g.scale(face * S, S);
    g.rotate(turn);
    g.lineJoin = 'miter';
    g.lineWidth = inkW / S;
    g.strokeStyle = ink;
    for (const upper of [false, true]) {
      g.save();
      // Each jaw swung open about the hinge, the upper further than the lower, as a jaw opens.
      g.translate(-1, 0);
      g.rotate(upper ? -open * 0.5 : open * 0.36);
      g.translate(1, 0);
      const teeth = upper ? UPPER_TEETH : LOWER_TEETH, dir = upper ? 1 : -1, root = upper ? -0.09 : 0.05;
      g.fillStyle = IVORY;
      g.beginPath();
      for (const [tx, tl] of teeth) {
        const w = tl * 0.42;
        g.moveTo(tx - w, root);
        // A canine hooks a little back toward the hinge.
        g.lineTo(tx - (tl > 0.2 ? 0.05 : 0), root + dir * tl);
        g.lineTo(tx + w, root);
        g.closePath();
      }
      g.fill();
      g.stroke();
      const outline = upper ? UPPER_JAW : LOWER_JAW;
      g.beginPath();
      for (let i = 0; i < outline.length; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, outline[i][0], outline[i][1]);
      g.closePath();
      g.fillStyle = upper ? jaw : deep;
      g.fill();
      g.stroke();
      if (upper) {
        // The light along the top of the muzzle.
        g.beginPath();
        g.moveTo(-0.5, -0.27);
        g.lineTo(0.2, -0.33);
        g.lineTo(0.72, -0.24);
        g.lineTo(0.6, -0.17);
        g.lineTo(0.1, -0.22);
        g.closePath();
        g.fillStyle = core;
        g.fill();
      }
      g.restore();
    }
  }, o.bias ?? 4);
}

/** A paw print on the ground: a pad and four toes, `size` tiles long, pointing along `head`. */
function paw(k: FxScene, x: number, y: number, head: { x: number; y: number }, size: number, alpha: number, colour = k.pal.deep): void {
  if (alpha <= 0.01) return;
  const hx = head.x, hy = head.y;
  const at = (f: number, s: number): [number, number] => {
    const wx = x + (hx * f - hy * s) * size, wy = y + (hy * f + hx * s) * size;
    return [k.eye.worldToScreenX(wx, wy), k.eye.worldToScreenY(wx, wy, k.ground(wx, wy) + 0.1)];
  };
  const pad = [[-0.42, 0], [-0.3, 0.3], [0.02, 0.34], [0.14, 0.12], [0.14, -0.12], [0.02, -0.34], [-0.3, -0.3]].map(([f, s]) => at(f, s));
  const toes: Array<Array<[number, number]>> = [];
  for (const [f, s] of [[0.36, 0.33], [0.52, 0.11], [0.52, -0.11], [0.36, -0.33]]) {
    const t: Array<[number, number]> = [];
    for (let i = 0; i < 5; i++) {
      const an = (i / 5) * TAU;
      t.push(at(f + Math.cos(an) * 0.12, s + Math.sin(an) * 0.1));
    }
    toes.push(t);
  }
  k.groundDraw(x, y, size, (g) => {
    g.globalAlpha = clamp(alpha);
    g.fillStyle = colour;
    g.beginPath();
    for (const poly of [pad, ...toes]) {
      g.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
      g.closePath();
    }
    g.fill();
  });
}

/**
 * A ring of teeth on the ground, `r` tiles out: a band with fangs along its
 * inner edge pointing in at whatever is inside it. A snarl's reach, a guard's
 * line.
 */
function toothRing(k: FxScene, c: { x: number; y: number }, r: number, o: { teeth?: number; len?: number; band?: number; alpha?: number; turn?: number; from?: number; to?: number; out?: boolean; main?: string; glow?: number }): void {
  const a = o.alpha ?? 1;
  if (r <= 0.05 || a <= 0.01) return;
  const teeth = o.teeth ?? Math.max(8, Math.round(r * 7));
  const band = o.band ?? Math.min(0.12, r * 0.12), len = o.len ?? Math.min(0.3, r * 0.14);
  const from = o.from ?? 0, to = o.to ?? TAU, whole = to - from >= TAU - 1e-6;
  const turn = o.turn ?? 0;
  // The band runs from `edge` to `root`; the teeth stand on the root and point away from the edge -- in, or out for a guard's line.
  const dir = o.out ? 1 : -1;
  const edge = o.out ? r - band : r, root = o.out ? r : r - band;
  const steps = teeth * 2;
  const pt = (ang: number, rr: number, list: number[]): void => {
    const wx = c.x + Math.cos(ang) * rr, wy = c.y + Math.sin(ang) * rr;
    list.push(k.eye.worldToScreenX(wx, wy), k.eye.worldToScreenY(wx, wy, k.ground(wx, wy) + 0.15));
  };
  const edges: number[] = [], roots: number[] = [], tips: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const ang = turn + from + ((to - from) * i) / steps;
    pt(ang, edge, edges);
    pt(ang, root, roots);
    // Each tooth's point a little past its root's middle, hooking: a fang, not a sawtooth.
    if (i % 2 === 1) pt(ang + ((to - from) / steps) * 0.25, root + dir * len, tips);
  }
  const main = o.main ?? k.pal.main, deep = k.pal.deep, ink = k.pal.ink;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  const cy = k.eye.worldToScreenY(c.x, c.y, k.ground(c.x, c.y));
  k.groundDraw(c.x, c.y, r + len + 0.3, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    // The teeth, ivory, each from two roots to its tip.
    g.beginPath();
    for (let j = 0; j < teeth; j++) {
      const i = 2 * j;
      g.moveTo(roots[2 * i], roots[2 * i + 1]);
      g.lineTo(tips[2 * j], tips[2 * j + 1]);
      g.lineTo(roots[2 * i + 4], roots[2 * i + 5]);
      g.closePath();
    }
    g.fillStyle = IVORY;
    g.fill();
    g.stroke();
    // The band, its near half lit and its far half shaded, as a hoop lying on the ground.
    for (const near of [false, true]) {
      g.beginPath();
      for (let i = 0; i < steps; i++) {
        const isNear = edges[2 * i + 1] + edges[2 * i + 3] > 2 * cy;
        if (isNear !== near) continue;
        g.moveTo(edges[2 * i], edges[2 * i + 1]);
        g.lineTo(edges[2 * i + 2], edges[2 * i + 3]);
        g.lineTo(roots[2 * i + 2], roots[2 * i + 3]);
        g.lineTo(roots[2 * i], roots[2 * i + 1]);
        g.closePath();
      }
      g.fillStyle = near ? main : deep;
      g.fill();
    }
    g.beginPath();
    for (let i = 0; i <= steps; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, edges[2 * i], edges[2 * i + 1]);
    if (whole) g.closePath();
    g.stroke();
  });
  const gl = o.glow ?? 1;
  if (gl > 0) {
    const spots = 6;
    for (let i = 0; i < spots; i++) {
      const ang = turn + from + ((to - from) * (i + 0.5)) / spots;
      k.glow(k.on(c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r, 1), 7 + r * 2, a * gl * 0.3);
    }
  }
}

/**
 * Claw marks torn in the ground: `n` slivers `len` tiles long along `dir`,
 * side by side round (x, y), dark earth with a fresh pale lip along one side.
 * `grow` nought to one, how far torn.
 */
function gouge(k: FxScene, x: number, y: number, dir: { x: number; y: number }, len: number, alpha: number, n = 3, grow = 1, lip = k.pal.main): void {
  if (alpha <= 0.01 || grow <= 0.02) return;
  const px = -dir.y, py = dir.x;
  const m = k.fast ? 4 : 6;
  const marks: number[][] = [];
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * len * 0.24;
    const left: number[] = [], right: number[] = [];
    for (let j = 0; j <= m; j++) {
      const t = (j / m) * grow;
      const w = len * 0.075 * Math.sin(Math.PI * Math.min(1, t / Math.max(0.3, grow)));
      const side = off * (1 + 0.35 * t);
      const cx = x + dir.x * (t - 0.5) * len + px * side, cy = y + dir.y * (t - 0.5) * len + py * side;
      for (const [sgn, list] of [[1, left], [-1, right]] as const) {
        const wx = cx + px * w * sgn, wy = cy + py * w * sgn;
        list.push(k.eye.worldToScreenX(wx, wy), k.eye.worldToScreenY(wx, wy, k.ground(wx, wy) + 0.12));
      }
    }
    marks.push(left, right);
  }
  const lw = Math.max(0.8, 0.8 * k.zoom);
  k.groundDraw(x, y, len, (g) => {
    g.globalAlpha = clamp(alpha);
    g.beginPath();
    for (let i = 0; i < marks.length; i += 2) {
      const l = marks[i], r = marks[i + 1], q = l.length / 2;
      g.moveTo(l[0], l[1]);
      for (let j = 1; j < q; j++) g.lineTo(l[2 * j], l[2 * j + 1]);
      for (let j = q - 1; j >= 0; j--) g.lineTo(r[2 * j], r[2 * j + 1]);
      g.closePath();
    }
    g.fillStyle = '#2e2014';
    g.fill();
    // The lip of turned earth catching the light, on the far side of each furrow.
    g.beginPath();
    for (let i = 0; i < marks.length; i += 2) {
      const l = marks[i], q = l.length / 2;
      g.moveTo(l[0], l[1]);
      for (let j = 1; j < q; j++) g.lineTo(l[2 * j], l[2 * j + 1]);
    }
    g.lineWidth = lw;
    g.strokeStyle = lip;
    g.stroke();
  });
}

/** An arrowhead on the ground at (x, y) pointing along `head`, `size` tiles: a creature's attention turning. */
function chevron(k: FxScene, x: number, y: number, head: { x: number; y: number }, size: number, alpha: number, main = k.pal.main): void {
  if (alpha <= 0.01) return;
  const pts = [[0.55, 0], [-0.15, 0.55], [-0.5, 0.55], [0.02, 0], [-0.5, -0.55], [-0.15, -0.55]].map(([f, s]) => {
    const wx = x + (head.x * f - head.y * s) * size, wy = y + (head.y * f + head.x * s) * size;
    return [k.eye.worldToScreenX(wx, wy), k.eye.worldToScreenY(wx, wy, k.ground(wx, wy) + 0.15)];
  });
  const ink = k.pal.ink, inkW = Math.max(0.8, 0.7 * k.zoom);
  k.groundDraw(x, y, size, (g) => {
    g.globalAlpha = clamp(alpha);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fillStyle = main;
    g.fill();
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    g.stroke();
  });
}

/** A beast standing side-on, facing +x, its feet on y = 0.45: in units of its half-length. */
const STANDING: ReadonlyArray<readonly [number, number]> = [
  [1, -0.2], [0.8, -0.42], [0.73, -0.66], [0.62, -0.42], [0.45, -0.3], [0, -0.27], [-0.6, -0.3], [-0.84, -0.46], [-1, -0.42],
  [-0.78, -0.24], [-0.68, -0.04], [-0.62, 0.45], [-0.48, 0.45], [-0.44, 0.06], [0.2, 0.06], [0.36, 0.45], [0.5, 0.45], [0.54, 0],
  [0.7, -0.06], [0.86, -0.12], [1, -0.14],
];

/**
 * The beast a spell works through, when it is not known -- somebody else's
 * cast -- drawn as a beast of light standing at its keeper's heel, facing
 * the way they face, its eye lit: so a peer's spell on their companion still
 * has a beast in it. A real companion is drawn by the island; nothing here.
 */
function heelBeast(k: FxScene, beast: Body, size: number, alpha: number, colour = k.pal.light, core = k.pal.core): void {
  if (beast.kind !== 'spot' || alpha <= 0.01) return;
  const foot = { x: beast.x, y: beast.y, z: beast.z };
  const x = k.sx(foot), y = k.sy(foot), S = (BEAST_TALL * HEIGHT_SCALE * 0.62) * k.zoom;
  const dir = k.facingDir(k.caster);
  const flip = k.sx({ x: beast.x + dir.x, y: beast.y + dir.y, z: beast.z }) >= x ? 1 : -1;
  const main = k.pal.main, light = k.pal.core, ink = k.pal.ink;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  k.worldDraw(foot, (g) => {
    g.globalAlpha = clamp(alpha * 0.5);
    g.translate(x, y - 0.45 * S);
    g.scale(flip * S, S);
    g.lineJoin = 'miter';
    g.beginPath();
    for (let i = 0; i < STANDING.length; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, STANDING[i][0], STANDING[i][1]);
    g.closePath();
    g.fillStyle = main;
    g.fill();
    g.globalAlpha = clamp(alpha * 0.8);
    g.lineWidth = inkW / S;
    g.strokeStyle = ink;
    g.stroke();
    // The light along its back.
    g.globalAlpha = clamp(alpha * 0.55);
    g.beginPath();
    for (let i = 0; i <= 6; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, STANDING[i][0], STANDING[i][1] + 0.03);
    for (let i = 6; i >= 0; i--) g.lineTo(STANDING[i][0] * 0.97, STANDING[i][1] + 0.13);
    g.closePath();
    g.fillStyle = light;
    g.fill();
  });
  // Its eye, lit, in the colour of the spell.
  const ex = x + flip * S * 0.78, ey = y - 0.45 * S - S * 0.3;
  const E = size * k.zoom * 0.7;
  k.glowDraw((g) => {
    g.globalAlpha = clamp(alpha);
    g.fillStyle = colour;
    g.beginPath();
    g.moveTo(ex - flip * E, ey);
    g.lineTo(ex, ey - E * 0.45);
    g.lineTo(ex + flip * E, ey - E * 0.2);
    g.lineTo(ex, ey + E * 0.35);
    g.closePath();
    g.fill();
    g.fillStyle = core;
    g.fillRect(ex - E * 0.12, ey - E * 0.3, E * 0.24, E * 0.55);
  });
  k.glow({ ...foot, z: foot.z + (0.75 * S) / (HEIGHT_SCALE * k.zoom) }, size * 3, alpha * 0.4, colour);
}

/** A voice going out from a mouth: `n` faceted arcs, the newest nearest, spreading along screen angle `ang` as `u` goes. */
function howl(k: FxScene, from: P3, ang: number, u: number, o: { n?: number; reach?: number; span?: number; alpha?: number; width?: number; main?: string; bias?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || u <= 0) return;
  const n = o.n ?? 3, reach = (o.reach ?? 18) * k.zoom, span = o.span ?? 0.7, W = (o.width ?? 2.2) * k.zoom;
  const x = k.sx(from), y = k.sy(from);
  const arcs: Array<{ r: number; al: number }> = [];
  for (let i = 0; i < n; i++) {
    const v = u * 1.25 - i * 0.18;
    if (v <= 0 || v >= 1) continue;
    arcs.push({ r: reach * (0.18 + 0.82 * easeOut(v)), al: a * (1 - v * v) });
  }
  if (!arcs.length) return;
  const main = o.main ?? k.pal.main, ink = k.pal.ink, core = k.pal.core;
  k.worldDraw(from, (g) => {
    g.lineJoin = 'miter';
    g.lineCap = 'butt';
    for (const { r, al } of arcs) {
      const seg6 = (): void => {
        g.beginPath();
        for (let j = 0; j <= 5; j++) {
          const an = ang - span + (2 * span * j) / 5;
          // Flattened a little, as a ring seen from over the shoulder.
          (j === 0 ? g.moveTo : g.lineTo).call(g, x + Math.cos(an) * r, y + Math.sin(an) * r * 0.78);
        }
      };
      g.globalAlpha = clamp(al);
      seg6();
      g.lineWidth = W + Math.max(1.2, k.zoom);
      g.strokeStyle = ink;
      g.stroke();
      g.lineWidth = W;
      g.strokeStyle = main;
      g.stroke();
      g.lineWidth = Math.max(0.6, W * 0.35);
      g.strokeStyle = core;
      g.stroke();
    }
  }, o.bias ?? 3);
}

/**
 * A beast's blood up: tongues of light standing up off its back and head,
 * behind it, flickering like a flame -- longest along the top, short at the
 * flanks, none underneath. `len` is how far out they stand as a share of the
 * body's own size; `beat` how many times a second they surge.
 */
function mane(k: FxScene, b: Body, o: { len: number; alpha: number; beat: number; t: number; main: string; core: string; n?: number }): void {
  if (o.alpha <= 0.01 || o.len <= 0.01) return;
  const c = k.at(b, 0.5);
  const x = k.sx(c), y = k.sy(c);
  const ry = b.tall * HEIGHT_SCALE * k.zoom * 0.36, rx = Math.max(ry * 1.2, b.wide * 1.6 * k.zoom);
  const n = o.n ?? (k.fast ? 6 : 9);
  const ink = k.pal.ink;
  // Each tongue: root, swell, tip, swell, root -- a flame's leaf shape, the tip leaning off the vertical.
  const tongues: number[] = [];
  for (let i = 0; i < n; i++) {
    const ang = Math.PI - 0.1 + (i / (n - 1)) * (Math.PI + 0.2);
    const h = hashOf(k.seed, i);
    const upness = Math.max(0, -Math.sin(ang));
    // Each surges on the beat, and flickers on its own between.
    const surge = 0.74 + 0.2 * Math.sin(o.t * o.beat * TAU + h * 1.5) + 0.1 * Math.sin(o.t * 11 + i * 2.3);
    const len = o.len * (0.35 + 0.9 * upness) * (0.75 + 0.45 * h) * surge;
    const w = (Math.PI / n) * 0.9;
    // Rooted well inside the body's outline, so a body in front of them hides where they start.
    const bx = x + Math.cos(ang) * rx * 0.4, by = y + Math.sin(ang) * ry * 0.4;
    const out = len * 1.8 + 0.6;
    // Out along the normal, leaning back over the beast the way it streams, and swaying.
    const lean = 0.35 * Math.cos(ang) + 0.15 * Math.sin(o.t * 6 + i * 1.3);
    const dx = Math.cos(ang + lean) * rx * out, dy = Math.sin(ang + lean) * ry * out;
    const sx = -Math.sin(ang) * rx * w * 0.75, sy = Math.cos(ang) * ry * w * 0.75;
    tongues.push(
      bx - sx, by - sy,
      bx - sx * 0.9 + dx * 0.45, by - sy * 0.9 + dy * 0.45,
      bx + dx, by + dy,
      bx + sx * 0.9 + dx * 0.45, by + sy * 0.9 + dy * 0.45,
      bx + sx, by + sy,
    );
  }
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
    g.globalAlpha = clamp(o.alpha);
    g.lineJoin = 'miter';
    for (let pass = 0; pass < 2; pass++) {
      // The tongues inked in the main colour, then their hearts in the core: each drawn again shrunk toward its root.
      const f = pass ? 0.55 : 1;
      g.beginPath();
      for (let i = 0; i < tongues.length; i += 10) {
        const rx0 = (tongues[i] + tongues[i + 8]) / 2, ry0 = (tongues[i + 1] + tongues[i + 9]) / 2;
        for (let j = 0; j < 5; j++) {
          const px = lerp(rx0, tongues[i + 2 * j], f), py = lerp(ry0, tongues[i + 2 * j + 1], f);
          if (j === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
      }
      g.fillStyle = pass ? o.core : o.main;
      g.fill();
      if (!pass) {
        g.lineWidth = inkW;
        g.strokeStyle = ink;
        g.stroke();
      }
    }
  }, -1.5);
  k.glow(k.at(b, 0.7), (ry / k.zoom) * (1.4 + o.len), o.alpha * 0.5, o.main);
}

/**
 * A talon out of the ground: rooted `R` tiles from `c` at angle `ang`, rising
 * `h` height units and hooking in over whatever stands at `c`. `grow` nought
 * to one, how far out of the ground.
 */
function talon(k: FxScene, c: { x: number; y: number; z: number }, ang: number, R: number, h: number, grow: number, alpha: number, w = 4): void {
  if (grow <= 0.02 || alpha <= 0.01) return;
  const xs: number[] = [], ys: number[] = [];
  const m = k.fast ? 5 : 7;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let i = 0; i <= m; i++) {
    const s = (i / m) * grow;
    // Up and in over it, and the tip hooking down at the end: a claw, not an arch.
    const rr = R * (1 - 0.5 * s);
    const z = c.z + h * Math.sin(s * Math.PI * 0.78) - h * 0.15 * (1 - grow);
    xs.push(k.eye.worldToScreenX(c.x + ca * rr, c.y + sa * rr));
    ys.push(k.eye.worldToScreenY(c.x + ca * rr, c.y + sa * rr, z));
  }
  const base = { x: c.x + ca * R, y: c.y + sa * R, z: c.z };
  const W = w * k.zoom, inkW = Math.max(0.8, 0.7 * k.zoom);
  const ink = k.pal.ink;
  k.worldDraw(base, (g) => {
    g.globalAlpha = clamp(alpha);
    taper(g, xs, ys, W, 0, IVORY, '#ffffff', ink, inkW);
    // Where it comes out of the ground, a collar of torn earth.
    g.fillStyle = '#4a3420';
    g.beginPath();
    g.ellipse(xs[0], ys[0], W * 0.9, W * 0.38, 0, 0, TAU);
    g.fill();
  });
}

/**
 * A paw standing in the air at `p`, upright and facing the viewer: a pad and
 * four toes, amber and inked -- the sign of a tame, over a creature that has
 * just become one. `size` pixels at zoom one, half its height.
 */
function pawSign(k: FxScene, p: P3, size: number, alpha: number): void {
  if (alpha <= 0.01 || size <= 0.1) return;
  const x = k.sx(p), y = k.sy(p), S = size * k.zoom;
  const main = k.pal.main, core = k.pal.core, ink = k.pal.ink, deep = k.pal.deep;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(alpha);
    g.translate(x, y);
    g.scale(S, S);
    g.lineJoin = 'miter';
    g.lineWidth = inkW / S;
    g.strokeStyle = ink;
    const poly = (pts: ReadonlyArray<readonly [number, number]>, fill: string): void => {
      g.beginPath();
      for (let i = 0; i < pts.length; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, pts[i][0], pts[i][1]);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      g.stroke();
    };
    // The pad: a broad six-sided heel, its upper-left lit.
    poly([[-0.55, 0.3], [-0.42, -0.05], [0, -0.18], [0.42, -0.05], [0.55, 0.3], [0.2, 0.62], [-0.2, 0.62]], main);
    g.beginPath();
    g.moveTo(-0.42, -0.02);
    g.lineTo(0, -0.14);
    g.lineTo(0.2, -0.08);
    g.lineTo(-0.3, 0.28);
    g.closePath();
    g.fillStyle = core;
    g.fill();
    // The toes in an arc over it, the outer two lower.
    for (const [tx, ty, r] of [[-0.62, -0.42, 0.2], [-0.22, -0.72, 0.22], [0.22, -0.72, 0.22], [0.62, -0.42, 0.2]] as const) {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 5; i++) {
        const an = -Math.PI / 2 + (i / 5) * TAU;
        pts.push([tx + Math.cos(an) * r * 0.85, ty + Math.sin(an) * r]);
      }
      poly(pts, tx < 0 ? main : deep);
    }
  }, 4);
  k.glow(p, size * 2.6, alpha * 0.5);
}


/** A tooth standing in the air at `p`: a curved fang, root up, `size` pixels at zoom one. `lean` tips it. */
function fang(k: FxScene, p: P3, size: number, alpha: number, lean = 0, bias = 0): void {
  if (alpha <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), S = size * k.zoom;
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i <= 5; i++) {
    const s = i / 5;
    // From the root down to the point, hooking: a canine.
    xs.push(x + (Math.sin(s * 1.6) * 0.45 - 0.2 + lean * (s - 0.5)) * S);
    ys.push(y + (s * 2 - 1) * S);
  }
  const ink = k.pal.ink, deep = k.pal.deep, inkW = Math.max(0.8, 0.7 * k.zoom);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(alpha);
    taper(g, xs, ys, S * 0.9, 0, IVORY, '#ffffff', ink, inkW);
    // The root, set in a band of the beast's colour.
    g.fillStyle = deep;
    g.fillRect(xs[0] - S * 0.5, ys[0] - S * 0.12, S, S * 0.24);
  }, bias);
}

/**
 * A beast at full stretch in the air, nose to tail along +x with its back up:
 * ears, the forelegs reaching, the hind legs thrown out behind, the tail. In
 * units of its half-length.
 */
const SPIRIT: ReadonlyArray<readonly [number, number]> = [
  [1, -0.04], [0.82, -0.2], [0.74, -0.44], [0.62, -0.24], [0.2, -0.28], [-0.3, -0.23], [-0.56, -0.2], [-0.8, -0.34], [-1.04, -0.38],
  [-0.84, -0.22], [-0.64, -0.08], [-0.76, 0.04], [-1.02, 0.2], [-0.92, 0.28], [-0.5, 0.13], [-0.05, 0.1], [0.34, 0.1], [0.8, 0.27],
  [0.9, 0.2], [0.52, 0.02], [0.72, 0.04], [0.98, 0.08],
];
/** Of `SPIRIT`, the points along its back, which the light catches. */
const SPIRIT_BACK = 7;

/**
 * The beast drawn in light at `p`, leaping along screen angle `ang`: the
 * shape above, turned to the way it goes (mirrored rather than turned upside
 * down when it goes left), pitched only partly up or down the slope of its
 * leap so it stays a beast rather than an arrow. `size` pixels at zoom one,
 * half its length.
 */
function spirit(k: FxScene, p: P3, ang: number, size: number, alpha: number, bias = 3): void {
  if (alpha <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), S = size * k.zoom;
  const flip = Math.cos(ang) < 0 ? -1 : 1;
  const pitch = Math.atan2(Math.sin(ang), Math.abs(Math.cos(ang))) * 0.55;
  const main = k.pal.main, core = k.pal.core, ink = k.pal.ink;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(alpha);
    g.translate(x, y);
    g.rotate(flip * pitch);
    g.scale(flip * S, S * 1.3);
    g.lineJoin = 'miter';
    g.beginPath();
    for (let i = 0; i < SPIRIT.length; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, SPIRIT[i][0], SPIRIT[i][1]);
    g.closePath();
    g.fillStyle = main;
    g.fill();
    g.lineWidth = inkW / S;
    g.strokeStyle = ink;
    g.stroke();
    // The light along its back: a band under the line of the back, a third of the body deep.
    g.beginPath();
    for (let i = 0; i < SPIRIT_BACK; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, SPIRIT[i][0], SPIRIT[i][1] + 0.03);
    for (let i = SPIRIT_BACK - 1; i >= 0; i--) g.lineTo(SPIRIT[i][0] * 0.96, SPIRIT[i][1] + 0.15);
    g.closePath();
    g.fillStyle = core;
    g.fill();
    // Claws out on the reaching forefoot.
    g.fillStyle = IVORY;
    g.beginPath();
    for (let c = 0; c < 3; c++) {
      const cy = 0.12 + c * 0.06;
      g.moveTo(0.86, cy);
      g.lineTo(1.02, cy + 0.06);
      g.lineTo(0.86, cy + 0.04);
    }
    g.fill();
  }, bias);
  // Its eye, lit.
  const ex = x + flip * S * (0.78 * Math.cos(pitch) + 0.16 * Math.sin(pitch)), ey = y + S * (0.78 * Math.sin(pitch) - 0.16 * Math.cos(pitch));
  k.glowDraw((g) => {
    g.globalAlpha = clamp(alpha);
    g.fillStyle = k.pal.light;
    g.fillRect(ex - S * 0.06, ey - S * 0.04, S * 0.12, S * 0.08);
  });
  k.glow(p, size * 1.6, alpha * 0.45);
}

/** The leap of a beast through the air: the beast in light along the arc, two fading after-images of it, and its shadow running along the ground under it. */
function leap(k: FxScene, from: P3, to: P3, u: number, lift: number, scale = 1): void {
  const at = (v: number): P3 => arcAt(from, to, clamp(v), lift);
  const head = at(u);
  const ang = screenAngle(k, at(u - 0.04), at(u + 0.04));
  // After-images first, so the beast itself is over them.
  for (let i = 2; i >= 1; i--) {
    const v = u - i * 0.1;
    if (v > 0) spirit(k, at(v), screenAngle(k, at(v - 0.04), at(v + 0.04)), 12 * scale, (0.42 - i * 0.14) * (1 - u * 0.3), 1);
  }
  spirit(k, head, ang, 12 * scale, 0.95);
  // It lights the ground it passes over, so a leap at night is a leap and not a smudge.
  k.light(head, 1.6 * scale, 0.7);
  // The shadow, on the ground under it, smaller and fainter the higher it is.
  const ground = k.on(head.x, head.y);
  const high = clamp((head.z - ground.z) / 30);
  k.disc(head, 0.16 * scale * (1 - 0.4 * high), { main: '#1c140c', alpha: 0.35 * (1 - 0.5 * high), n: 8 });
}

/* ---- the twelve -------------------------------------------------------------------------- */

const fxOf = (id: string): Readonly<Record<string, number>> => spellInfo(id)?.fx ?? {};

/* Sic: a whistle and a point, and the companion's claws across the enemy at once, a blow at `more` of its own. */
const SIC_MORE = fxOf('beastmaster_sic').more ?? 1;
const sicPose: CastPose = (r, t, c) => {
  const b = beats(c);
  const lips = b.top * 0.45;
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [lips, [64, -16, 36]], [b.top, [64, -16, 36]], [b.let, [22, 20, 0]], [1, [12, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [lips, 146], [b.top, 146], [b.let, 40], [1, 22]]);
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [b.top, [34, 36, -18]], [b.let, [94, 0, 0]], [b.through, [91, 2, 0]], [1, [22, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [b.top, 100], [b.let, 0], [b.through, 4], [1, 22]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [20, 0, 0]], [b.let, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > b.let - 0.05;
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [4, 0, -18]], [b.let, [-6, 0, 10]], [b.through, [-5, 0, 8]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [3, 0, -4]], [b.let, [-11, 0, 4]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [lips, [-6, 0, 6]], [b.top, [-6, 0, 10]], [b.let, [-8, 0, -6]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [0, 3, 0]], [b.let, [22, 3, 0]], [b.through, [20, 3, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.let, 22], [1, 6]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.let, [-12, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.let, 12], [1, 5]]);
};

/** The claws' line across the target: down and through, from the side the blow comes from. */
function strikeAngle(k: FxScene, from: Body, steep = 0.95): number {
  const side = sideOf(k, from, k.target);
  return Math.PI / 2 - side * steep;
}

const sic: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 0.62, release: 0.42 }, pose: sicPose },
  fx: {
    charge: (k, t) => {
      // The whistle: two small arcs off the lips toward the beast, while the hand is at the mouth.
      const w = seg(t, 0.12, 0.36);
      if (w > 0 && w < 1) howl(k, k.head(), screenAngle(k, k.caster, strikerOf(k) === k.caster ? k.target : strikerOf(k)), w, { n: 2, reach: 9, span: 0.45, width: 1.4, alpha: 0.9 });
    },
    release: (k) => {
      k.burst(k.hand(1), 6, { kind: 'mote', size: 1.6, life: [0.15, 0.3], speed: [0.6, 1.2], up: [0, 4], heading: k.toward(k.caster, k.target), cone: 0.5, gravity: 0 });
    },
    // The beast is on it at once, a short lunge in light: from where the companion stands, or, not knowing it, from its reach
    // short of the enemy on your side -- which is where it has to be for the word to be obeyed.
    travel: { secs: () => 0.16, draw: (k, u) => {
      const to = k.heart(k.target);
      const back = k.toward(k.target, k.caster);
      const from = k.companion ? k.at(k.companion, 0.5) : k.on(k.target.x + back.x * COMPANION_REACH, k.target.y + back.y * COMPANION_REACH, BEAST_TALL * 0.5);
      leap(k, from, to, easeIn(u) * 0.6 + u * 0.4, 3, 0.7);
    } },
    hit: (k) => {
      const at = k.heart(k.target), away = k.toward(strikerOf(k), k.target);
      k.burst(at, 16 * SIC_MORE, { kind: 'spark', size: 1.8, life: [0.18, 0.4], speed: [0.8, 1.8], up: [6, 26], heading: away, cone: 1.8, gravity: 60, drag: 0.08 });
      k.burst(k.at(k.target, 0.05), 5, { kind: 'dust', colour: '#8a7a62', size: 2.6, life: [0.35, 0.6], speed: [0.2, 0.5], up: [2, 6], gravity: 2 });
    },
    impact: { secs: 0.55, draw: (k, u) => {
      const at = k.heart(k.target);
      const ang = strikeAngle(k, strikerOf(k));
      // The rake's size is the blow's: 130% of the beast's own reads a third longer than Pounce's plain one.
      rake(k, at, { ang, len: 12 * SIC_MORE, gap: 3.4, u: seg(u, 0, 0.22), alpha: 1 - seg(u, 0.45, 1), bend: 0.14 });
      k.flare(at, 8 * (1 - u), flashOf(u, 0.08), k.pal.core, 0.4);
      k.light(k.target, 2, 0.5 * (1 - u));
    } },
  },
};

/* Pounce: the companion leaps up to `reach` tiles onto the enemy and strikes it, and the enemy's next blow is put back `back` seconds. */
const POUNCE = fxOf('beastmaster_pounce');
const pouncePose: CastPose = (r, t, c) => {
  const b = beats(c);
  const low = b.top * 0.55;
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [low, [42, 18, 0]], [b.top, [-34, 18, 0]], [b.let, [128, 4, 0]], [b.through, [120, 6, 0]], [1, [20, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [low, 36], [b.top, 30], [b.let, 4], [b.through, 8], [1, 22]]);
  r.open[1] = t > b.top;
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [low, [40, 14, 10]], [b.top, [44, 16, 10]], [b.let, [-26, 22, 0]], [b.through, [-20, 20, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [low, 34], [b.top, 40], [b.let, 16], [1, 20]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [low, [-26, 0, 0]], [b.top, [-28, 0, -4]], [b.let, [-2, 0, 4]], [b.through, [-5, 0, 2]], [1, [-1, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [low, [-10, 0, -6]], [b.top, [-10, 0, -16]], [b.let, [8, 0, 12]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [low, [-6, 0, 0]], [b.top, [6, 0, 10]], [b.let, [12, 0, -6]], [1, [0, 0, 0]]]);
  // Down on the haunches to spring, as the beast does, then up and through onto the front foot.
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [low, [36, 10, 0]], [b.top, [38, 10, 0]], [b.let, [34, 4, 0]], [b.through, [30, 4, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [low, 70], [b.top, 74], [b.let, 26], [1, 6]]);
  r.leg[1] = euler(t, [[0, [2, 2, 0]], [low, [30, 10, 0]], [b.top, [26, 10, 0]], [b.let, [-20, 4, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [low, 70], [b.top, 76], [b.let, 14], [1, 5]]);
};

/** Where a leap set off from, kept for the cast: the companion where it was when the cast began, or the caster's side. */
function leapFrom(k: FxScene, toward: { x: number; y: number }, near = 1.2, otherwise: (k: FxScene) => { x: number; y: number } = heelOf): P3 {
  const s = k.state;
  if (s.fx === undefined) {
    // The island moves the companion when it says yes, which may be before or after the first frame: one already beside
    // where it is going has leapt, and the leap is drawn from where it would have come from instead.
    const c = k.companion;
    const p = c && Math.hypot(c.x - toward.x, c.y - toward.y) > near ? c : otherwise(k);
    s.fx = p.x;
    s.fy = p.y;
  }
  return k.on(s.fx, s.fy, 5);
}

const pounce: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.0, release: 0.48 }, pose: pouncePose },
  fx: {
    charge: (k, t) => {
      const from = leapFrom(k, k.target);
      const head = k.toward(from, k.target);
      // Gathering to spring: the hind feet dug in where it goes from.
      const g = seg(t, 0.2, 0.46);
      const sx = -head.y * 0.09, sy = head.x * 0.09;
      paw(k, from.x - head.x * 0.1 + sx, from.y - head.y * 0.1 + sy, head, 0.16, 0.7 * smooth(g));
      paw(k, from.x - head.x * 0.1 - sx, from.y - head.y * 0.1 - sy, head, 0.16, 0.7 * smooth(seg(t, 0.26, 0.48)));
    },
    release: (k) => {
      const from = leapFrom(k, k.target);
      k.burst(k.on(from.x, from.y, 1), 10, { kind: 'dust', colour: '#8a7a62', size: 2.8, life: [0.4, 0.7], speed: [0.3, 0.8], up: [2, 8], heading: k.toward(k.target, from), cone: 1.6, gravity: 4 });
    },
    // A leap covers ground fast but hangs at the top: as long as a quick bolt over the same distance, and high.
    travel: { secs: (tiles) => 0.22 + tiles * 0.06, draw: (k, u) => {
      const from = leapFrom(k, k.target), to = k.heart(k.target);
      const tiles = Math.hypot(to.x - from.x, to.y - from.y);
      leap(k, from, to, smooth(u) * 0.85 + u * 0.15, 6 + tiles * 5);
      const fromG = { x: from.x, y: from.y }, head = k.toward(fromG, k.target);
      paw(k, from.x - head.x * 0.1, from.y - head.y * 0.1, head, 0.16, 0.7);
    } },
    hit: (k) => {
      const at = k.heart(k.target), away = k.toward(leapFrom(k, k.target), k.target);
      k.burst(at, 22, { kind: 'spark', size: 2, life: [0.2, 0.45], speed: [0.8, 2], up: [4, 28], heading: away, cone: 2, gravity: 60, drag: 0.08 });
      k.burst(k.at(k.target, 0.04), 16, { kind: 'dust', colour: '#8a7a62', size: 3.2, life: [0.4, 0.8], speed: [0.4, 1.0], up: [2, 8], gravity: 3, drag: 0.15 });
    },
    impact: { secs: Math.max(0.85, (POUNCE.back ?? 0.5) + 0.35), draw: (k, u) => {
      const secs = Math.max(0.85, (POUNCE.back ?? 0.5) + 0.35), age = u * secs;
      const at = k.heart(k.target), from = leapFrom(k, k.target);
      const side = sideOf(k, from, k.target);
      // Both forepaws, straight down the body: a weight landing, not a swipe.
      for (const s of [-1, 1]) {
        rake(k, at, { shift: [s * 5, 1], ang: Math.PI / 2 - side * 0.2 - s * 0.45, len: 12 * (POUNCE.more ?? 1), gap: 2.8, width: 1.8, u: seg(u, 0, 0.18), alpha: 1 - seg(u, 0.55, 1), bend: s * 0.12, glow: 0.6 });
      }
      // The landing in the ground: a ring of dust thrown out and the prints it lands on.
      const r = 0.15 + 0.45 * easeOut(seg(u, 0, 0.5));
      k.ring(k.target, r, { band: 0.06 * (1 - u), alpha: 0.7 * (1 - seg(u, 0.2, 0.7)), main: '#b49a6e', deep: '#6f5a3c', glow: 0 });
      const head = k.toward(from, k.target);
      const sx = -head.y * 0.12, sy = head.x * 0.12;
      const land = { x: k.target.x - head.x * 0.42, y: k.target.y - head.y * 0.42 };
      const pa = 0.75 * (1 - seg(u, 0.6, 1));
      paw(k, land.x + sx, land.y + sy, head, 0.17, pa);
      paw(k, land.x - sx, land.y - sy, head, 0.17, pa);
      // And the skid of its claws, run on from the prints toward what it hit.
      gouge(k, land.x + head.x * 0.22, land.y + head.y * 0.22, head, 0.3, pa, 3, easeOut(seg(u, 0, 0.15)));
      // Its next blow put back: the target set reeling for exactly those seconds, three sparks wheeling over its head.
      const back = POUNCE.back ?? 0.5;
      if (age < back + 0.15) {
        const a = smooth(age / 0.1) * (1 - smooth((age - back) / 0.15));
        const top = k.at(k.target, 1.08);
        for (let i = 0; i < 3; i++) {
          const an = age * 9 + (i * TAU) / 3;
          const p = { x: top.x + Math.cos(an) * 0.12, y: top.y + Math.sin(an) * 0.12, z: top.z };
          k.flare(p, 3.4, a, k.pal.core, an);
        }
      }
      k.flare(at, 10 * (1 - u), flashOf(u, 0.06), k.pal.core, 0.3);
      k.light(k.target, 2.5, 0.6 * (1 - u));
    } },
  },
};

/* Drag Down: the companion bites at `more` of its blow and holds the enemy where it stands, unable to move or strike, for `hold` seconds. */
const DRAG = fxOf('beastmaster_drag_down');
const dragPose: CastPose = (r, t, c) => {
  const b = beats(c);
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [b.top, [166, 16, 0]], [b.let, [40, 14, 0]], [b.through, [26, 16, 0]], [1, [12, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [b.top, 22], [b.let, 72], [b.through, 56], [1, 22]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [b.top, [158, 22, 0]], [b.let, [44, 16, 0]], [b.through, [30, 18, 0]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [b.top, 26], [b.let, 76], [b.through, 60], [1, 22]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [8, 0, 0]], [b.let, [-20, 0, 0]], [b.through, [-16, 0, 0]], [1, [-2, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [8, 0, 0]], [b.let, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [16, 0, 0]], [b.let, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.shrug = [one(t, [[0, 0], [b.top, 0.8], [b.let, 0], [1, 0]]), one(t, [[0, 0], [b.top, 0.8], [b.let, 0], [1, 0]])];
  for (let s = 0; s < 2; s++) {
    r.leg[s] = euler(t, [[0, [2, 2, 0]], [b.top, [0, 4, 0]], [b.let, [24, 9, 0]], [b.through, [22, 9, 0]], [1, [2, 2, 0]]]);
    r.knee[s] = one(t, [[0, 4], [b.top, 2], [b.let, 46], [b.through, 40], [1, 4]]);
  }
};

const dragDown: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.05, release: 0.5 }, pose: dragPose },
  fx: {
    charge: (k, t) => {
      // A grip taken overhead, on nothing: the fists catch the light at the top of the reach.
      const a = bump(t, 0.15, 0.4, 0.52);
      k.glow(mid3(k.hand(0), k.hand(1), 0.5), 5, 0.6 * a);
    },
    hit: (k) => {
      k.burst(k.at(k.target, 0.05), 14, { kind: 'dust', colour: '#7d6a4e', size: 3, life: [0.4, 0.8], speed: [0.3, 0.7], up: [2, 6], gravity: 3 });
      k.burst(k.heart(k.target), 10 * (DRAG.more ?? 1) + 4, { kind: 'spark', size: 1.6, life: [0.15, 0.35], speed: [0.5, 1.2], up: [4, 16], gravity: 50 });
    },
    impact: { secs: 0.6, draw: (k, u) => {
      // The bite, into the flank from the beast's side: jaws snapping shut and hanging on.
      const at = k.at(k.target, 0.55);
      const side = sideOf(k, strikerOf(k), k.target);
      bite(k, { ...at, z: at.z + 1 }, { size: 5 + 6 * (DRAG.more ?? 1), shut: easeOut(seg(u, 0.05, 0.22)), face: side, alpha: smooth(u / 0.06) * (1 - seg(u, 0.6, 1)), turn: 0.35 });
      k.light(k.target, 2, 0.5 * (1 - u));
    } },
    // Held for the hold's seconds: talons up out of the ground round its feet, hooked in over it.
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const R = Math.max(0.2, (b.wide / 40) * 2.8);
      const grow = easeOut(seg(age, 0.05, 0.3)) * smooth(left / 0.35);
      const h = Math.max(5, b.tall * 0.5);
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * TAU + 0.3 + hashOf(k.seed, i) * 0.4;
        // A tremor in them while it strains against them.
        const strain = 0.04 * Math.sin(age * 23 + i * 2.1) * Math.max(0, Math.sin(age * 2.4 + i));
        talon(k, b, ang + strain, R, h * (0.85 + 0.3 * hashOf(k.seed + 1, i)), grow, 1, 3.4);
      }
      k.scorch(b, R * 1.15, { colour: '#3a2a18', alpha: 0.3 * grow });
      // A low light in the hold, so it reads in the dark as well: a creature pinned in a ring of bone.
      k.light(b, 1.4, 0.35 * grow);
      k.glow(k.at(b, 0.3), 10, 0.25 * grow);
      if (!k.fast) k.emit(k.at(b, 0.02), 3 * grow, { kind: 'dust', colour: '#7d6a4e', size: 2.2, life: [0.4, 0.7], speed: [0.1, 0.3], up: [1, 4], gravity: 2, jitter: R });
    } },
  },
};

/* Disembowel: the companion's blow at `more`, and the enemy bleeds `each` of it a second for `secs` seconds. */
const GUT = fxOf('beastmaster_disembowel');
const gutPose: CastPose = (r, t, c) => {
  const b = beats(c);
  // The hand clawed and raised high on the right, the body wound away; then ripped down and across to the left hip, turning
  // through, the way a beast's forepaw opens a belly.
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [b.top, [150, 34, -20]], [b.let, [44, -18, 40]], [b.through, [32, -22, 44]], [1, [14, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [b.top, 64], [b.let, 22], [b.through, 26], [1, 22]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [40, 0, 0]], [b.let, [-30, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > 0.08;
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [b.top, [36, 20, 10]], [b.let, [-14, 26, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [b.top, 70], [b.let, 24], [1, 22]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, -24]], [b.let, [-10, 0, 26]], [b.through, [-8, 0, 28]], [1, [0, 0, 2]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [3, 0, -8]], [b.let, [-16, 0, 8]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [4, 0, 12]], [b.let, [-12, 0, -14]], [1, [0, 0, 0]]]);
  r.leg[1] = euler(t, [[0, [2, 2, 0]], [b.top, [-4, 3, 0]], [b.let, [22, 6, 0]], [b.through, [20, 6, 0]], [1, [4, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.top, 10], [b.let, 24], [1, 6]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.let, [-10, 3, 0]], [1, [-2, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.let, 12], [1, 5]]);
};

const disembowel: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 0.95, release: 0.5 }, pose: gutPose },
  fx: {
    charge: (k, t) => k.glow(k.hand(1), 4, 0.7 * bump(t, 0.2, 0.42, 0.55), BLOOD.light),
    hit: (k) => {
      const at = k.heart(k.target), away = k.toward(strikerOf(k), k.target);
      k.burst(at, 18, { kind: 'drop', colour: [BLOOD.main, BLOOD.deep], size: 2.2, life: [0.35, 0.7], speed: [0.4, 1.1], up: [6, 22], heading: away, cone: 2, gravity: 70, drag: 0.4 });
      k.burst(at, 10, { kind: 'spark', colour: [BLOOD.core, k.pal.core], size: 1.6, life: [0.15, 0.3], speed: [0.6, 1.4], up: [4, 14], heading: away, cone: 1.6, gravity: 50 });
    },
    impact: { secs: 0.6, draw: (k, u) => {
      // Down the belly, near straight: four claws, a gutting, the wound left open in red.
      const at = k.at(k.target, 0.42);
      const side = sideOf(k, strikerOf(k), k.target);
      const fresh = 1 - seg(u, 0.25, 0.7);
      rake(k, at, { ang: Math.PI / 2 - side * 0.3, n: 4, len: 14 * (GUT.more ?? 1), gap: 2.8, u: seg(u, 0, 0.2), alpha: 1, bend: 0.22,
        fill: fresh > 0.5 ? k.pal.main : BLOOD.main, core: fresh > 0.5 ? k.pal.core : BLOOD.core, light: BLOOD.light, width: 2.2 });
      k.flare(at, 9 * (1 - u), flashOf(u, 0.06), BLOOD.core, 0.2);
      k.light(k.target, 2, 0.5 * (1 - u), BLOOD.light);
    } },
    // The bleed, for its seconds: once a second -- as often as it takes `each` of the blow -- the wound opens again and spills.
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const a = smooth(age / 0.3) * smooth(left / 0.6);
      const at = k.at(b, 0.42);
      const side = sideOf(k, strikerOf(k), b);
      const tick = Math.floor(age);
      const since = age - tick;
      const pulse = flashOf(clamp(since / 0.5), 0.15);
      rake(k, at, { ang: Math.PI / 2 - side * 0.3, n: 4, len: 14 * (GUT.more ?? 1), gap: 2.8, u: 1, alpha: a * (0.3 + 0.6 * pulse), bend: 0.22,
        fill: BLOOD.deep, core: BLOOD.main, light: BLOOD.light, width: 1.6, glow: 0.5 * pulse });
      if ((k.state.tick ?? -1) < tick && left > 0.3) {
        k.state.tick = tick;
        k.burst(at, 5, { kind: 'drop', colour: [BLOOD.main, BLOOD.deep], size: 2, life: [0.4, 0.7], speed: [0.05, 0.3], up: [-2, 6], gravity: 60, drag: 0.5, jitter: 0.04 });
      }
      // A pool spreading under it as the seconds run, the bleed's whole length to its full size.
      const secs = GUT.secs ?? 8;
      k.disc(b, 0.08 + 0.2 * clamp(age / secs), { main: BLOOD.deep, alpha: 0.45 * a, n: 9, turn: hashOf(k.seed, 3) * TAU });
    } },
  },
};

/* Lick Wounds: the companion gets `heal` of its health back. */
const LICK = fxOf('beastmaster_lick_wounds');
const lickPose: CastPose = (r, t, c) => {
  const b = beats(c);
  const down = b.top * 0.55;
  // Down on one knee beside it, a hand out low over its back stroking twice, the head bent to it.
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [down, [82, 6, 0]], [b.through, [82, 6, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [down, 92], [b.through, 92], [1, 4]]);
  r.leg[1] = euler(t, [[0, [2, 2, 0]], [down, [-6, 8, 0]], [b.through, [-6, 8, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [down, 96], [b.through, 96], [1, 4]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [down, [-10, 0, -6]], [b.through, [-12, 0, -8]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [down, [-8, -4, -14]], [b.through, [-8, -4, -16]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [down, [-20, -4, -18]], [b.let, [-24, -6, -22]], [b.through, [-22, -4, -20]], [1, [0, 0, 0]]]);
  const s1 = lerp(down, b.let, 0.5), s2 = lerp(b.let, b.through, 0.5);
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [down, [40, 46, -8]], [s1, [58, 38, -8]], [b.let, [40, 46, -8]], [s2, [58, 38, -8]], [b.through, [44, 44, -8]], [1, [12, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [down, 24], [s1, 8], [b.let, 24], [s2, 8], [b.through, 20], [1, 22]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [down, [-20, 0, 0]], [s1, [10, 0, 0]], [b.let, [-20, 0, 0]], [s2, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > 0.1;
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [down, [60, 12, 14]], [b.through, [60, 12, 14]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [down, 54], [b.through, 54], [1, 22]]);
};

const lickWounds: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.5, release: 0.55 }, pose: lickPose },
  fx: {
    charge: (k, t) => {
      const beast = beastOf(k);
      const g = seg(t, 0.25, 0.55);
      k.glow(k.hand(1), 5, 0.6 * g * (1 - seg(t, 0.75, 1)), WILD.light);
      if (t < 0.55) heelBeast(k, beast, 1.4, 0.8 * seg(t, 0.15, 0.35), WILD.light, WILD.core);
      k.emit(k.at(beast, 0.3), 14 * g, { kind: 'mote', colour: [WILD.core, WILD.main], size: 1.5, life: [0.5, 0.9], speed: [0.02, 0.1], up: [8, 16], gravity: 0, jitter: 0.18 });
    },
    hit: (k) => {
      const beast = beastOf(k);
      k.burst(k.at(beast, 0.5), 16, { kind: 'mote', colour: [WILD.core, WILD.main], size: 2, life: [0.5, 1.0], speed: [0.1, 0.35], up: [10, 24], gravity: 0, jitter: 0.12 });
    },
    impact: { secs: 1.3, draw: (k, u) => {
      const beast = beastOf(k);
      const c = k.at(beast, 0.5);
      const look = { main: WILD.main, core: WILD.core, ink: '#1d3318' };
      heelBeast(k, beast, 1.4, 0.8 * (1 - seg(u, 0.75, 1)), WILD.light, WILD.core);
      // Three long strokes up and over its back, one after another, from the side you are on: a tongue, mending.
      const from = sideOf(k, k.caster, beast) > 0 ? Math.PI * 0.92 : Math.PI * 2.08;
      const to = sideOf(k, k.caster, beast) > 0 ? Math.PI * 2.0 : Math.PI * 1.0;
      const rx = Math.max(10, beast.wide * 2.4), ry = beast.tall * HEIGHT_SCALE * 0.42;
      for (let i = 0; i < 3; i++) {
        const v = seg(u, i * 0.17, i * 0.17 + 0.38);
        if (v <= 0 || v >= 1) continue;
        sweep(k, c, rx * (1 - 0.12 * i), ry * (1 - 0.1 * i), from, to, v, { ...look, width: 3.4 - 0.4 * i, alpha: 0.95 });
      }
      // What it gets back: its share of a whole ring under it filled in green, `heal` of the way round.
      const share = LICK.heal ?? 0.15;
      const R = Math.max(0.18, (beast.wide / 40) * 2);
      const fill = easeOut(seg(u, 0.1, 0.6)) * share;
      const fade = 1 - seg(u, 0.75, 1);
      k.ring(beast, R, { band: 0.05, alpha: 0.35 * fade, main: WILD.deep, deep: WILD.deep, glow: 0, dash: 2, n: 20 });
      arcBand(k, beast, R + 0.01, -Math.PI / 2, -Math.PI / 2 + fill * TAU, 0.08, fade, WILD.main, WILD.core);
      k.light(beast, 2.4, 0.5 * (1 - u), WILD.light);
    } },
  },
};

/**
 * A stroke swept round a point on the screen, along an ellipse `rx` by `ry`
 * pixels at zoom one from angle `a0` to `a1`: its head `u` of the way and its
 * tail following half a pace behind, fattest in the middle. A lick, a swipe.
 */
function sweep(k: FxScene, p: P3, rx: number, ry: number, a0: number, a1: number, u: number, o: { width: number; main: string; core: string; ink: string; alpha?: number; bias?: number }): void {
  const head = easeOut(u), tail = Math.max(0, easeIn(u) * 1.1 - 0.1);
  const a = (o.alpha ?? 1) * Math.sin(Math.PI * clamp(u));
  if (head - tail < 0.02 || a <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), Z = k.zoom;
  const xs: number[] = [], ys: number[] = [];
  const m = k.fast ? 6 : 10;
  for (let j = 0; j <= m; j++) {
    const an = lerp(a0, a1, lerp(tail, head, j / m));
    xs.push(x + Math.cos(an) * rx * Z);
    ys.push(y + Math.sin(an) * ry * Z);
  }
  const inkW = Math.max(0.8, 0.7 * Z), W = o.width * Z;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    taper(g, xs, ys, W, 0.6, o.main, o.core, o.ink, inkW);
  }, o.bias ?? 4);
  k.glow({ ...p }, rx * 0.8, a * 0.35, WILD.light);
}

/** A band on the ground round `c` from one angle to another, as a part of a ring: a share of something. */
function arcBand(k: FxScene, c: { x: number; y: number }, r: number, a0: number, a1: number, band: number, alpha: number, main: string, core: string): void {
  if (a1 - a0 <= 0.01 || alpha <= 0.01) return;
  const n = Math.max(3, Math.ceil(((a1 - a0) / TAU) * 32));
  const outer: number[] = [], inner: number[] = [];
  for (let i = 0; i <= n; i++) {
    const an = a0 + ((a1 - a0) * i) / n;
    for (const [rr, list] of [[r, outer], [r - band, inner]] as const) {
      const wx = c.x + Math.cos(an) * rr, wy = c.y + Math.sin(an) * rr;
      list.push(k.eye.worldToScreenX(wx, wy), k.eye.worldToScreenY(wx, wy, k.ground(wx, wy) + 0.2));
    }
  }
  const ink = WILD.deep, inkW = Math.max(0.8, 0.7 * k.zoom);
  k.groundDraw(c.x, c.y, r + 0.3, (g) => {
    g.globalAlpha = clamp(alpha);
    g.beginPath();
    for (let i = 0; i <= n; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, outer[2 * i], outer[2 * i + 1]);
    for (let i = n; i >= 0; i--) g.lineTo(inner[2 * i], inner[2 * i + 1]);
    g.closePath();
    g.fillStyle = main;
    g.fill();
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    g.stroke();
    // The leading edge bright, where it is filling.
    g.strokeStyle = core;
    g.lineWidth = inkW * 2;
    g.beginPath();
    g.moveTo(outer[2 * n], outer[2 * n + 1]);
    g.lineTo(inner[2 * n], inner[2 * n + 1]);
    g.stroke();
  });
  const end = a1;
  k.glow(k.on(c.x + Math.cos(end) * r, c.y + Math.sin(end) * r, 1), 6, alpha * 0.6, WILD.light);
}

/* Snarl: every wild creature within `reach` tiles of the companion turns on it. */
const SNARL = fxOf('beastmaster_snarl');
const snarlPose: CastPose = (r, t, c) => {
  const b = beats(c);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-14, 0, 0]], [b.let, [-22, 0, 0]], [b.through, [-20, 0, 0]], [1, [-2, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 0]], [b.let, [-10, 0, 0]], [1, [0, 0, 0]]]);
  r.neck = euler(t, [[0, [0, 0, 0]], [b.top, [-8, 0, 0]], [b.let, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [12, 0, 0]], [b.let, [20, 0, 0]], [b.through, [18, 0, 0]], [1, [0, 0, 0]]]);
  r.shrug = [one(t, [[0, 0], [b.top, 1], [b.through, 1], [1, 0]]), one(t, [[0, 0], [b.top, 1], [b.through, 1], [1, 0]])];
  for (let s = 0; s < 2; s++) {
    r.arm[s] = euler(t, [[0, [10, 10, 0]], [b.top, [50, 36, 10]], [b.let, [74, 24, 14]], [b.through, [70, 26, 14]], [1, [12, 10, 0]]]);
    r.elbow[s] = one(t, [[0, 20], [b.top, 100], [b.let, 58], [b.through, 62], [1, 22]]);
    r.hand[s] = euler(t, [[0, [0, 0, 0]], [b.top, [-40, 0, 0]], [b.let, [-50, 0, 0]], [1, [0, 0, 0]]]);
    r.open[s] = t > 0.08;
  }
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [12, 12, 0]], [b.let, [24, 10, 0]], [b.through, [22, 10, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.top, 26], [b.let, 32], [1, 5]]);
  r.leg[1] = euler(t, [[0, [2, 2, 0]], [b.top, [12, 12, 0]], [b.let, [-6, 12, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.top, 26], [b.let, 20], [1, 5]]);
};

const snarl: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 0.9, release: 0.45 }, pose: snarlPose },
  fx: {
    charge: (k, t) => {
      // The lips drawn back: the beast's jaws over it, opening, and its eyes coming up.
      const beast = beastOf(k);
      const a = smooth(seg(t, 0.12, 0.3));
      bite(k, k.at(beast, 1.35), { size: 8, shut: 0, face: sideOf(k, k.caster, beast), alpha: a, turn: -0.15 });
      heelBeast(k, beast, 1.4, a * 0.9);
    },
    hit: (k) => {
      const beast = beastOf(k);
      k.burst(k.at(beast, 0.05), 14, { kind: 'dust', colour: '#8a7a62', size: 3, life: [0.4, 0.8], speed: [0.8, 1.6], up: [2, 6], gravity: 3, drag: 0.1 });
      k.burst(k.at(beast, 1.1), 10, { kind: 'spark', size: 1.6, life: [0.2, 0.4], speed: [0.6, 1.4], up: [0, 10], gravity: 20 });
    },
    impact: { secs: 1.25, draw: (k, u) => {
      const beast = beastOf(k);
      const reach = SNARL.reach ?? 4;
      // The snarl going out: a ring of teeth to exactly its reach, a second behind it, and held there a moment.
      const go = easeOut(seg(u, 0, 0.42));
      const held = 1 - seg(u, 0.62, 0.85);
      toothRing(k, beast, 0.2 + (reach - 0.2) * go, { alpha: held, turn: u * 0.2, teeth: Math.round(reach * 7) });
      const go2 = easeOut(seg(u, 0.1, 0.5));
      if (go2 > 0 && go2 < 1) k.ring(beast, 0.2 + (reach - 0.2) * go2, { band: 0.05, alpha: 0.6 * (1 - go2), dash: 3, glow: 0.3 });
      // And everything inside it turning: arrowheads running in from the rim to the beast.
      const inward = seg(u, 0.5, 1);
      if (inward > 0) {
        const n = k.fast ? 6 : 8;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * TAU + hashOf(k.seed, i) * 0.5;
          const v = clamp(inward * 1.3 - hashOf(k.seed + 1, i) * 0.3);
          const rr = reach * (1 - 0.72 * easeIn(v)) - 0.2;
          const head = { x: -Math.cos(ang), y: -Math.sin(ang) };
          chevron(k, beast.x + Math.cos(ang) * rr, beast.y + Math.sin(ang) * rr, head, 0.5, bump(v, 0, 0.2, 1));
        }
      }
      bite(k, k.at(beast, 1.35), { size: 8, shut: 0.3 * Math.abs(Math.sin(u * 18)) * (1 - u), face: sideOf(k, k.caster, beast), alpha: 1 - seg(u, 0.7, 1), turn: -0.15 });
      heelBeast(k, beast, 1.4, 0.9 * (1 - seg(u, 0.7, 1)));
      k.light(beast, reach, 0.45 * held);
    } },
  },
};

/* Guard Me: the companion leaps to your side, and every creature within `reach` tiles of you that is hunting you turns on it. */
const GUARD = fxOf('beastmaster_guard_me');
const guardPose: CastPose = (r, t, c) => {
  const b = beats(c);
  // Two slaps on the thigh, the head turned back over the right shoulder to call it; then the left arm out across the front.
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [0.07, [26, 18, 0]], [0.13, [-6, 14, 0]], [0.19, [26, 18, 0]], [0.25, [-6, 14, 0]], [b.let, [-4, 18, 0]], [b.through, [-4, 18, 0]], [1, [10, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [0.07, 44], [0.13, 8], [0.19, 44], [0.25, 8], [b.let, 14], [1, 22]]);
  r.open[1] = true;
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [b.top, [20, 8, 10]], [b.let, [74, 44, -8]], [b.through, [72, 46, -8]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [b.top, 40], [b.let, 8], [b.through, 10], [1, 22]]);
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [b.let, [-50, 0, 0]], [b.through, [-50, 0, 0]], [1, [0, 0, 0]]]);
  r.open[0] = t > b.top;
  r.head = euler(t, [[0, [0, 0, 0]], [0.1, [0, 0, -36]], [0.28, [0, 0, -36]], [b.let, [-4, 0, 6]], [b.through, [-4, 0, 6]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.1, [0, 0, -14]], [0.28, [0, 0, -14]], [b.let, [-2, 0, 10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.let, [-6, 0, 0]], [1, [0, 0, 0]]]);
  for (let s = 0; s < 2; s++) {
    r.leg[s] = euler(t, [[0, [2, 2, 0]], [b.top, [2, 4, 0]], [b.let, [8, 13, 0]], [b.through, [8, 13, 0]], [1, [2, 2, 0]]]);
    r.knee[s] = one(t, [[0, 4], [b.top, 6], [b.let, 22], [b.through, 20], [1, 4]]);
  }
};

/** Where a companion called to its keeper's side comes from when it is not known: off behind them. */
const behindKeeper = (k: FxScene): P3 => k.local(k.caster, -40, -70, 0);

/** Where the companion lands at its keeper's side. */
const sideOfKeeper = (k: FxScene): P3 => k.local(k.caster, 16, 4, 0);

const guardMe: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.0, release: 0.42 }, pose: guardPose },
  fx: {
    charge: (k, t) => {
      // Each slap a pop of sound at the thigh.
      for (const at of [0.13, 0.25]) {
        const v = seg(t, at, at + 0.14);
        if (v > 0 && v < 1) howl(k, k.hand(1), Math.PI + (k.caster.facing >= 4 ? 0.3 : -0.3), v, { n: 1, reach: 8, span: 0.5, width: 1.4, alpha: 0.85 });
      }
      leapFrom(k, k.caster, 0.8, behindKeeper);
    },
    travel: { secs: () => 0.36, draw: (k, u) => {
      const from = leapFrom(k, k.caster, 0.8, behindKeeper), to = sideOfKeeper(k);
      const tiles = Math.hypot(to.x - from.x, to.y - from.y);
      leap(k, from, { ...to, z: to.z + 5 }, smooth(u), 4 + tiles * 4, 0.9);
    } },
    hit: (k) => {
      const at = sideOfKeeper(k);
      k.burst(at, 12, { kind: 'dust', colour: '#8a7a62', size: 3, life: [0.4, 0.8], speed: [0.3, 0.8], up: [2, 8], gravity: 3, drag: 0.15 });
    },
    impact: { secs: 1.4, draw: (k, u) => {
      const reach = GUARD.reach ?? 6;
      const c = k.caster;
      // Everything hunting you within its reach called in: the reach drawn and drawn in, toward you and the beast.
      const pull = easeIn(seg(u, 0.1, 0.85));
      const r = reach * (1 - 0.82 * pull);
      k.ring(c, r, { band: 0.1 + 0.08 * pull, alpha: 0.9 * smooth(u / 0.1) * (1 - seg(u, 0.75, 0.95)), dash: 4, turn: -u * 0.4, glow: 0.4 });
      const n = k.fast ? 6 : 10;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + 0.2;
        chevron(k, c.x + Math.cos(ang) * (r + 0.25), c.y + Math.sin(ang) * (r + 0.25), { x: -Math.cos(ang), y: -Math.sin(ang) }, 0.3 + 0.1 * (1 - pull), (1 - seg(u, 0.7, 0.9)) * smooth(u / 0.12));
      }
      // The line it holds: a crescent of teeth on the ground before you both, facing out.
      const face = k.facingDir(c);
      const fa = Math.atan2(face.y, face.x);
      const wall = smooth(seg(u, 0, 0.18)) * (1 - seg(u, 0.75, 1));
      toothRing(k, c, 0.7, { from: fa - 1.25, to: fa + 1.25, out: true, teeth: 7, len: 0.16, band: 0.07, alpha: wall, glow: 0.6 });
      const side = sideOfKeeper(k);
      if (!k.companion) heelBeast(k, { ...side, tall: BEAST_TALL, wide: 5, facing: k.caster.facing, kind: 'spot' }, 1.5, wall);
      k.light(c, 2.5, 0.5 * wall);
    } },
  },
};

/* Bloodlust: for `secs` seconds the companion's blows are `more` times as large. */
const LUST = fxOf('beastmaster_bloodlust');
const lustPose: CastPose = (r, t, c) => {
  const b = beats(c);
  // The fist on the chest twice, a heartbeat; then thrown straight up, the head back.
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [0.12, [52, -4, 28]], [0.18, [36, -12, 34]], [0.26, [52, -4, 28]], [0.32, [36, -12, 34]], [b.top, [34, 22, 0]], [b.let, [176, 8, 0]], [b.through, [172, 8, 0]], [1, [12, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [0.12, 112], [0.18, 124], [0.26, 112], [0.32, 124], [b.top, 110], [b.let, 4], [b.through, 8], [1, 22]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [b.top, [14, 26, 0]], [b.let, [24, 34, 0]], [b.through, [22, 34, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [b.top, 40], [b.let, 50], [1, 22]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.18, [-4, 0, 0]], [0.32, [-4, 0, 0]], [b.top, [-8, 0, 4]], [b.let, [12, 0, -4]], [b.through, [10, 0, -4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.18, [-8, 0, 0]], [b.top, [-12, 0, 0]], [b.let, [26, 0, 0]], [b.through, [22, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 0]], [b.let, [4, 0, 0]], [1, [0, 0, 0]]]);
  for (let s = 0; s < 2; s++) {
    r.leg[s] = euler(t, [[0, [2, 2, 0]], [b.top, [10, 6, 0]], [b.let, [4, 9, 0]], [1, [2, 2, 0]]]);
    r.knee[s] = one(t, [[0, 4], [b.top, 22], [b.let, 8], [1, 4]]);
  }
};

const bloodlust: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.25, release: 0.55 }, pose: lustPose },
  fx: {
    charge: (k, t) => {
      // A heartbeat at each blow on the chest.
      for (const at of [0.18, 0.32]) k.glow(k.chest(), 7, 0.8 * bump(t, at - 0.02, at, at + 0.1), BLOOD.light);
      k.glow(k.hand(1), 5, 0.7 * bump(t, 0.4, 0.55, 0.7), BLOOD.light);
    },
    release: (k) => k.burst(k.hand(1), 10, { kind: 'ember', colour: [BLOOD.core, BLOOD.light], size: 1.8, life: [0.3, 0.6], speed: [0.1, 0.5], up: [10, 30], gravity: 10 }),
    // The blood going to it: a red thread from the raised fist to the beast.
    travel: { secs: () => 0.22, draw: (k, u) => {
      const from = k.hand(1), to = k.at(beastOf(k), 0.6);
      const pts: P3[] = [];
      for (let i = 5; i >= 0; i--) pts.push(arcAt(from, to, clamp(u - i * 0.06), 8));
      k.ribbon(pts, { main: BLOOD.main, core: BLOOD.core, ink: BLOOD.deep, width: 3, taper: 'start', glow: 0.6 });
    } },
    hit: (k) => {
      const beast = beastOf(k);
      k.burst(k.at(beast, 0.6), 16, { kind: 'ember', colour: [BLOOD.core, BLOOD.light, BLOOD.main], size: 1.8, life: [0.3, 0.7], speed: [0.2, 0.6], up: [6, 20], gravity: 10 });
    },
    impact: { secs: 0.7, draw: (k, u) => {
      const beast = beastOf(k);
      const len = ((LUST.more ?? 1.4) - 1) * (1 + 1.2 * flashOf(u, 0.15));
      mane(k, beast, { len, alpha: flashOf(u, 0.1) * 0.9, beat: 1.2, t: k.now, main: BLOOD.main, core: BLOOD.core });
      heelBeast(k, beast, 1.5 + flashOf(u, 0.1), 1, BLOOD.light, BLOOD.core);
      k.light(beast, 2.5, 0.6 * (1 - u), BLOOD.light);
    } },
    // For its seconds: the hackles stay up in red, beating like a heart; its eyes red; drops of red light falling off it.
    linger: { draw: (k, age, left) => {
      const beast = beastOf(k);
      const a = smooth(age / 0.5) * smooth(left / 1);
      const beat = 0.5 + 0.5 * Math.pow(Math.max(0, Math.sin(age * 1.2 * TAU)), 6);
      mane(k, beast, { len: ((LUST.more ?? 1.4) - 1) * (0.8 + 0.4 * beat), alpha: a * (0.45 + 0.35 * beat), beat: 0, t: age, main: BLOOD.main, core: BLOOD.core });
      heelBeast(k, beast, 1.4, a * (0.65 + 0.35 * beat), BLOOD.light, BLOOD.core);
      if (!k.fast) k.emit(k.at(beast, 0.7), 4 * a, { kind: 'ember', colour: [BLOOD.light, BLOOD.main], size: 1.4, life: [0.4, 0.7], speed: [0.02, 0.1], up: [-6, -2], gravity: 8, jitter: 0.12 });
    } },
  },
};

/* Primal Fury: for `secs` seconds the companion's blows are `more` times as large and come `quick` times as often. */
const FURY = fxOf('beastmaster_primal_fury');
const FURY_GOLD = { main: '#f0a030', core: '#fff3c2', deep: '#8a4a12', light: '#ffb84a' };
const furyPose: CastPose = (r, t, c) => {
  const b = beats(c);
  // Gathered in low, arms crossed; then thrown open, up and wide, the head back: a roar from the whole body, shaking with it.
  const shake = t > b.let && t < b.through + 0.1 ? Math.sin(t * 160) * 2.5 * (1 - seg(t, b.let, b.through + 0.1)) : 0;
  for (let s = 0; s < 2; s++) {
    r.arm[s] = euler(t, [[0, [10, 10, 0]], [b.top, [62, -28, 40]], [b.let, [150, 60, -10]], [b.through, [146, 62, -10]], [b.through + 0.15, [140, 60, -10]], [1, [12, 10, 0]]]);
    r.elbow[s] = one(t, [[0, 20], [b.top, 126], [b.let, 10], [b.through, 14], [1, 22]]);
    r.open[s] = t > b.let - 0.04;
    r.leg[s] = euler(t, [[0, [2, 2, 0]], [b.top, [26, 10, 0]], [b.let, [6, 18, 0]], [b.through + 0.15, [6, 18, 0]], [1, [2, 2, 0]]]);
    r.knee[s] = one(t, [[0, 4], [b.top, 52], [b.let, 16], [b.through + 0.15, 18], [1, 4]]);
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-24, 0, 0]], [b.let, [8, 0, 0]], [b.through + 0.15, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-10, 0, 0]], [b.let, [16, 0, 0]], [b.through + 0.15, [12, 0, 0]], [1, [0, 0, 0]]]);
  r.chest[1] += shake;
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-22, 0, 0]], [b.let, [30, 0, 0]], [b.through + 0.15, [24, 0, 0]], [1, [0, 0, 0]]]);
};

const primalFury: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.8, release: 0.5 }, pose: furyPose },
  fx: {
    charge: (k, t) => {
      // The ground trembling under the crouch, the light drawn in to the body.
      const g = seg(t, 0.05, 0.48);
      if (!k.fast) k.emit(k.at(k.caster, 0.02), 16 * g, { kind: 'dust', colour: '#8a7a62', size: 2, life: [0.3, 0.6], speed: [0.05, 0.2], up: [1, 4], gravity: 2, jitter: 0.5 });
      k.emit(k.at(k.caster, 0.5), 30 * g, { kind: 'mote', colour: [FURY_GOLD.core, FURY_GOLD.main], size: 1.6, life: [0.3, 0.5], speed: [-1.4, -0.8], up: [-4, 4], gravity: 0, jitter: 0.9, drag: 0.6 });
      k.glow(k.chest(), 8, 0.7 * g, FURY_GOLD.light);
    },
    hit: (k) => {
      k.flash(0.12, FURY_GOLD.light);
      const beast = beastOf(k);
      k.burst(k.at(k.caster, 0.05), 24, { kind: 'dust', colour: '#8a7a62', size: 3.4, life: [0.5, 0.9], speed: [1.0, 1.8], up: [2, 8], gravity: 3, drag: 0.1 });
      k.burst(k.at(beast, 0.6), 40, { kind: 'ember', colour: [FURY_GOLD.core, FURY_GOLD.main, FURY_GOLD.light], size: 2, life: [0.4, 0.9], speed: [0.3, 1.0], up: [10, 34], gravity: 6 });
    },
    impact: { secs: 1.3, draw: (k, u) => {
      const beast = beastOf(k);
      // The roar: arcs going out all round from the head, and the shock in the ground.
      howl(k, k.head(), -Math.PI / 2, seg(u, 0, 0.55), { n: 3, reach: 26, span: 1.25, width: 2, main: FURY_GOLD.main });
      const r = 0.2 + 1.3 * easeOut(seg(u, 0, 0.5));
      k.ring(k.caster, r, { band: 0.18 * (1 - u), alpha: 0.9 * (1 - seg(u, 0.2, 0.6)), main: FURY_GOLD.main, deep: FURY_GOLD.deep, glow: 0.6 });
      // On the beast: claw gouges torn in the ground round it, and its hackles thrown up gold.
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * TAU + 0.6 + hashOf(k.seed, i) * 0.4;
        const rr = 0.45;
        const dir = { x: Math.cos(ang), y: Math.sin(ang) };
        gouge(k, beast.x + dir.x * rr, beast.y + dir.y * rr, dir, 0.4, 0.9 * (1 - seg(u, 0.75, 1)), 3, easeOut(seg(u, i * 0.04, 0.16 + i * 0.04)), FURY_GOLD.main);
      }
      const len = ((FURY.more ?? 1.75) - 1) * (1 + 0.8 * flashOf(u, 0.12));
      mane(k, beast, { len, alpha: 0.95 * Math.min(1, flashOf(u, 0.08) + 0.5), beat: (FURY.quick ?? 1.5) * 1.2, t: k.now, main: FURY_GOLD.main, core: FURY_GOLD.core });
      heelBeast(k, beast, 1.6 + 1.2 * flashOf(u, 0.1), 1, FURY_GOLD.light, '#ffffff');
      k.light(beast, 3.5, 0.9 * (1 - 0.6 * u), FURY_GOLD.light);
      k.light(k.caster, 2.5, 0.7 * (1 - u), FURY_GOLD.light);
    } },
    // For its seconds: the gold hackles up and surging -- `quick` times as fast as Bloodlust's heart -- its eyes gold, sparks off it rising.
    linger: { draw: (k, age, left) => {
      const beast = beastOf(k);
      const a = smooth(age / 0.4) * smooth(left / 1);
      mane(k, beast, { len: (FURY.more ?? 1.75) - 1, alpha: a * 0.7, beat: 1.2 * (FURY.quick ?? 1.5), t: age, main: FURY_GOLD.main, core: FURY_GOLD.core });
      heelBeast(k, beast, 1.5, a * 0.9, FURY_GOLD.light, '#ffffff');
      k.emit(k.at(beast, 0.6), 7 * a, { kind: 'spark', colour: [FURY_GOLD.core, FURY_GOLD.light], size: 1.5, life: [0.25, 0.5], speed: [0.1, 0.4], up: [16, 30], gravity: 0, jitter: 0.12 });
      k.light(beast, 1.8, 0.35 * a, FURY_GOLD.light);
    } },
  },
};

/* Vengeance: for `secs` seconds every creature that lands a blow on you is struck back by the companion at `more` of its blow, within `reach` tiles of it. */
const VENGE = fxOf('beastmaster_vengeance');
const vengePose: CastPose = (r, t, c) => {
  const b = beats(c);
  // A fist on the heart -- a vow -- then the arm drawn out wide and low: this far, and no further.
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [b.top * 0.6, [58, -14, 36]], [b.top, [56, -14, 36]], [b.let, [46, 72, -10]], [b.through, [40, 76, -10]], [1, [12, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [b.top * 0.6, 140], [b.top, 142], [b.let, 6], [b.through, 8], [1, 22]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.let, [-20, 0, -40]], [1, [0, 0, 0]]]);
  r.open[1] = t > b.top + 0.04;
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [b.top, [14, 16, 0]], [b.let, [-10, 30, 0]], [b.through, [-10, 32, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [b.top, 24], [b.let, 12], [1, 22]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 8]], [b.let, [4, 0, -18]], [b.through, [3, 0, -18]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-16, 0, 4]], [b.let, [4, 0, -14]], [b.through, [4, 0, -14]], [1, [0, 0, 0]]]);
  r.leg[1] = euler(t, [[0, [2, 2, 0]], [b.let, [6, 16, 0]], [b.through, [6, 16, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.let, 16], [1, 4]]);
  r.knee[0] = one(t, [[0, 4], [b.let, 12], [1, 4]]);
};

/** Three fangs going round a body at its chest: whoever strikes it is bitten. Those behind it are drawn behind it. */
function fangWard(k: FxScene, b: Body, age: number, alpha: number, size = 3.4): void {
  const n = 3;
  const R = Math.max(0.2, (b.wide / 40) * 3.4);
  for (let i = 0; i < n; i++) {
    const an = age * 0.9 + (i * TAU) / n;
    const bob = Math.sin(age * 2 + i * 2) * 1.2;
    const p = { x: b.x + Math.cos(an) * R, y: b.y + Math.sin(an) * R, z: b.z + b.tall * 0.62 + bob };
    fang(k, p, size, alpha, Math.sin(an) * 0.4);
    if (!k.fast) k.glow(p, size * 1.6, alpha * 0.3);
  }
}

const vengeance: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.2, release: 0.55 }, pose: vengePose },
  fx: {
    charge: (k, t) => k.glow(k.chest(), 6, 0.7 * bump(t, 0.15, 0.4, 0.6)),
    release: (k) => k.burst(k.chest(), 10, { kind: 'mote', size: 1.8, life: [0.4, 0.7], speed: [0.2, 0.5], up: [2, 10], gravity: 0 }),
    impact: { secs: 1.0, draw: (k, u) => {
      const beast = beastOf(k);
      // How far the beast answers: its reach round it, drawn out, held and let fade.
      const reach = VENGE.reach ?? 5;
      const r = 0.3 + (reach - 0.3) * easeOut(seg(u, 0.05, 0.5));
      k.ring(beast, r, { band: 0.08, alpha: 0.75 * (1 - seg(u, 0.7, 1)), dash: 6, turn: u * 0.3, glow: 0.4 });
      heelBeast(k, beast, 1.4, bump(u, 0, 0.2, 1));
      // A thread between you, for a moment: it is watching you.
      if (u < 0.6) k.beam(k.chest(), k.at(beast, 0.7), { width: 1.2, alpha: 0.6 * bump(u, 0, 0.15, 0.6), glow: 0.4 });
    } },
    // For its seconds: three fangs going round you -- closing in from wide as it is cast, then quietly -- and the beast's eyes kept on you.
    linger: { draw: (k, age, left) => {
      const a = smooth(age / 0.25) * smooth(left / 1.2);
      const close = easeOut(clamp(age / 0.6));
      const c = k.caster;
      fangWard(k, { ...c, wide: c.wide * (2.6 - 1.6 * close) }, age * (1 + 2 * (1 - close)), (0.75 + 0.25 * (1 - close)) * a, 3.6 + 1.6 * (1 - close));
      const beast = beastOf(k);
      heelBeast(k, beast, 1.2, 0.35 * a * (0.6 + 0.4 * Math.sin(age * 1.6)));
    } },
  },
};

/* Feral Bond: for `secs` seconds every blow on you or the companion is split between you, `share` to each. */
const BOND = fxOf('beastmaster_feral_bond');
const bondPose: CastPose = (r, t, c) => {
  const b = beats(c);
  // The right palm on the heart, the left over it; then the right given out toward the beast, palm up, while the left keeps the heart.
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [b.top * 0.5, [56, -14, 36]], [b.top, [56, -14, 36]], [b.let, [72, 42, -16]], [b.through, [70, 44, -16]], [0.86, [66, 40, -14]], [1, [12, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [b.top * 0.5, 140], [b.top, 140], [b.let, 14], [b.through, 16], [1, 22]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [0, 0, 0]], [b.let, [0, 0, -70]], [b.through, [0, 0, -70]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [b.top * 0.6, [60, -24, 42]], [b.top, [60, -24, 42]], [b.let, [54, -16, 36]], [0.86, [54, -16, 36]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [b.top * 0.6, 132], [b.top, 132], [b.let, 140], [0.86, 140], [1, 22]]);
  r.open = [t > 0.06, t > 0.06];
  r.head = euler(t, [[0, [0, 0, 0]], [b.top * 0.6, [-18, 0, 0]], [b.top, [-18, 0, 0]], [b.let, [0, 0, -20]], [0.86, [0, 0, -18]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 0]], [b.let, [0, 0, -12]], [0.86, [0, 0, -10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-4, 0, 0]], [b.let, [0, 0, 0]], [1, [0, 0, 0]]]);
};

/** Where the bond leaves you: between your heart and the hand you hold out to the beast, following the hand as it goes. */
const heartOf = (k: FxScene): P3 => mid3(k.chest(), k.hand(1), 0.45);

/** Along the bond from `a` to `b`, `along` of the way: the line it hangs on, sagging a little in the middle. */
function along2(a: P3, b: P3, along: number): P3 {
  const p = mid3(a, b, along);
  return { x: p.x, y: p.y, z: p.z - 5 * Math.sin(Math.PI * along) };
}

/**
 * The bond: two strands twisted round each other between your heart and the
 * beast's, yours amber and its green, sagging a little, with a knot where
 * they are tied at `share` of the way from you -- where every blow on either
 * of you is split. `grow` nought to one, how far it has run out from you.
 */
function braid(k: FxScene, a: P3, b: P3, grow: number, alpha: number, phase: number, width = 2): void {
  if (grow <= 0.02 || alpha <= 0.01) return;
  const share = BOND.share ?? 0.5;
  const n = k.fast ? 12 : 22;
  const at = (along: number, strand: number): P3 => {
    const p = along2(a, b, along);
    // Pinched to nothing at both hearts and at the knot, widest between: two strands tied in the middle.
    const pinch = Math.sin(Math.PI * (along < share ? along / share : (along - share) / (1 - share)));
    const tw = Math.sin(along * TAU * 2 + phase + strand * Math.PI) * 2.2 * pinch;
    return { ...p, z: p.z + tw };
  };
  for (let strand = 0; strand < 2; strand++) {
    const pts: P3[] = [];
    for (let i = 0; i <= n; i++) pts.push(at((i / n) * grow, strand));
    const look = strand === 0 ? { main: k.pal.main, core: k.pal.core, ink: k.pal.ink } : { main: WILD.main, core: WILD.core, ink: '#1d3318' };
    k.ribbon(pts, { ...look, width, taper: 'none', alpha, glow: 0.45 });
  }
  if (grow >= share) {
    const knot = at(share, 0);
    k.orb(knot, 1.6 + width * 0.4, { alpha, turn: k.now * 2, sides: 6, glow: 0.6 });
  }
}

const feralBond: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.6, release: 0.55 }, pose: bondPose },
  fx: {
    charge: (k, t) => {
      k.glow(k.chest(), 6, 0.8 * seg(t, 0.15, 0.4) * (1 - seg(t, 0.5, 0.6)));
      if (t < 0.55) heelBeast(k, beastOf(k), 1.4, 0.8 * seg(t, 0.25, 0.5), WILD.light, WILD.core);
    },
    // Run out from your heart to the beast's.
    travel: { secs: () => 0.4, draw: (k, u) => {
      heelBeast(k, beastOf(k), 1.4, 0.8, WILD.light, WILD.core);
      braid(k, heartOf(k), k.at(beastOf(k), 0.6), easeOut(u), 0.95, k.now * 3);
    } },
    hit: (k) => {
      const share = BOND.share ?? 0.5;
      const knot = along2(heartOf(k), k.at(beastOf(k), 0.6), share);
      k.burst(knot, 14, { kind: 'mote', colour: [k.pal.core, WILD.core], size: 2, life: [0.4, 0.8], speed: [0.1, 0.4], up: [4, 14], gravity: 0 });
    },
    impact: { secs: 0.9, draw: (k, u) => {
      const beast = beastOf(k);
      const a = heartOf(k), b = k.at(beast, 0.6);
      braid(k, a, b, 1, 0.95, k.now * 3, 2 + 1.2 * flashOf(u, 0.1));
      // A blow's worth of light from each end, meeting at the knot and shared out: how every blow will go.
      const share = BOND.share ?? 0.5;
      const v = easeIn(seg(u, 0, 0.45));
      if (v < 1) {
        k.orb(along2(a, b, share * v), 2.2, { alpha: 0.9, sides: 6 });
        k.orb(along2(b, a, (1 - share) * v), 2.2, { alpha: 0.9, sides: 6, main: WILD.main, core: WILD.core });
      } else k.flare(along2(a, b, share), 9 * (1 - seg(u, 0.45, 0.8)), 1, k.pal.core, u * 2);
      k.light(mid3(k.caster, beast, share), 2.5, 0.6 * (1 - u));
    } },
    // For its seconds: the braid kept, faint, and now and then the same light running in from each end to the knot.
    linger: { draw: (k, age, left) => {
      const a = smooth(left / 1.2) * smooth(age / 0.3);
      const beast = beastOf(k);
      const from = heartOf(k), to = k.at(beast, 0.6);
      heelBeast(k, beast, 1.2, a * (0.45 + 0.35 * (1 - seg(age, 0.6, 1.4))), WILD.light, WILD.core);
      braid(k, from, to, 1, a * 0.5, age * 1.5, 1.4);
      const share = BOND.share ?? 0.5;
      const cycle = (age % 3) / 3;
      const v = easeIn(seg(cycle, 0, 0.3));
      if (v > 0 && v < 1) {
        k.orb(along2(from, to, share * v), 1.6, { alpha: a * 0.8, sides: 6, glow: 0.5 });
        k.orb(along2(to, from, (1 - share) * v), 1.6, { alpha: a * 0.8, sides: 6, main: WILD.main, core: WILD.core, glow: 0.5 });
      }
    } },
  },
};

/* Call of the Wild: a wild creature within `reach` tiles whose tame level is no more than your taming is tamed outright. */
const callPose: CastPose = (r, t, c) => {
  const b = beats(c);
  const cup = b.top * 0.4;
  // Hands cupped to the mouth and the head back -- a howl -- then the right hand out to it, palm up, and drawn home: come.
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [cup, [64, -14, 36]], [b.top, [66, -14, 36]], [b.let, [86, 8, -8]], [b.through, [84, 8, -8]], [0.88, [58, 8, -8]], [1, [12, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [cup, 140], [b.top, 140], [b.let, 6], [b.through, 10], [0.88, 76], [1, 22]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [0, 0, 0]], [b.let, [0, 0, -70]], [0.88, [20, 0, -70]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [cup, [64, -16, 38]], [b.top, [66, -16, 38]], [b.let, [16, 16, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [cup, 140], [b.top, 140], [b.let, 24], [1, 22]]);
  r.open = [t > 0.05, t > 0.05];
  r.head = euler(t, [[0, [0, 0, 0]], [cup, [10, 0, 0]], [b.top, [28, 0, 0]], [b.let, [-4, 0, 0]], [0.88, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [12, 0, 0]], [b.let, [-4, 0, 4]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, 0]], [b.let, [-6, 0, 0]], [0.88, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[1] = euler(t, [[0, [2, 2, 0]], [b.through, [2, 2, 0]], [0.88, [-14, 3, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.88, 12], [1, 4]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.let, [14, 3, 0]], [0.88, [6, 3, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.let, 14], [1, 4]]);
};

const callOfTheWild: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 2.0, release: 0.55 }, pose: callPose },
  fx: {
    charge: (k, t) => {
      // The howl, going up and out from the cupped hands.
      const v = seg(t, 0.18, 0.55);
      if (v > 0) howl(k, k.head(), -Math.PI / 2 + (sideOf(k, k.caster, k.target) > 0 ? 0.5 : -0.5), (v * 2.2) % 1, { n: 3, reach: 20, span: 0.8, width: 2.2, alpha: 1 - seg(t, 0.5, 0.58) });
      k.glow(k.head(), 6, 0.6 * bump(t, 0.15, 0.4, 0.58), WILD.light);
    },
    // The call carried to it: arcs of the howl running out along the ground's air to the creature.
    travel: { secs: (tiles) => 0.25 + tiles * 0.07, draw: (k, u) => {
      const from = k.head(), to = k.at(k.target, 0.85);
      const ang = screenAngle(k, from, to);
      for (let i = 0; i < 3; i++) {
        const v = clamp(u * 1.3 - i * 0.15);
        if (v <= 0 || v >= 1) continue;
        const p = arcAt(from, to, v, 6);
        howl(k, p, ang, 0.5, { n: 1, reach: 11, span: 0.75, width: 2.6, alpha: 0.95 * Math.sin(Math.PI * v), main: i === 1 ? WILD.main : k.pal.main });
      }
    } },
    hit: (k) => {
      k.burst(k.at(k.target, 0.6), 20, { kind: 'mote', colour: [WILD.core, WILD.main, k.pal.core], size: 2, life: [0.5, 1.0], speed: [0.1, 0.4], up: [6, 20], gravity: 0, jitter: 0.15 });
    },
    impact: { secs: 1.6, draw: (k, u) => {
      const b = k.target;
      // A ring of the wild's prints round it, walking round once: it is caught by the call.
      const R = Math.max(0.3, (b.wide / 40) * 3.6);
      const n = 6;
      const ring = 1 - seg(u, 0.55, 0.8);
      for (let i = 0; i < n; i++) {
        const show = seg(u, i * 0.04, i * 0.04 + 0.1);
        const an = (i / n) * TAU + u * 0.6;
        paw(k, b.x + Math.cos(an) * R, b.y + Math.sin(an) * R, { x: -Math.sin(an), y: Math.cos(an) }, 0.15, 0.8 * show * ring, WILD.main);
      }
      // Then the sign of a tame set over it, springing up and settling: it is yours.
      const sign = seg(u, 0.18, 0.4);
      const bob = Math.sin(u * 9) * 0.6 * (1 - u);
      pawSign(k, { ...k.at(b, 1), z: b.z + b.tall + 6 + bob }, 7 * easeBack(sign), smooth(sign * 3) * (1 - seg(u, 0.82, 1)));
      if (sign > 0 && sign < 0.3) k.flare(k.at(b, 1.2), 10, 1 - sign / 0.3, k.pal.core);
      // And its prints leading off from it to you: it follows.
      const toward = k.toward(b, k.caster);
      const steps = Math.min(6, Math.max(2, Math.floor(k.dist / 0.45)));
      for (let i = 0; i < steps; i++) {
        const show = seg(u, 0.5 + i * 0.05, 0.56 + i * 0.05) * (1 - seg(u, 0.85, 1));
        const d = 0.45 + i * 0.4;
        const side = (i % 2 ? 1 : -1) * 0.08;
        paw(k, b.x + toward.x * d - toward.y * side, b.y + toward.y * d + toward.x * side, toward, 0.13, 0.75 * show, k.pal.deep);
      }
      k.light(b, 2.5, 0.6 * (1 - u), WILD.light);
    } },
  },
};

export const BEASTMASTER: Record<string, SpellVisual> = {
  beastmaster_sic: sic,
  beastmaster_lick_wounds: lickWounds,
  beastmaster_pounce: pounce,
  beastmaster_snarl: snarl,
  beastmaster_guard_me: guardMe,
  beastmaster_drag_down: dragDown,
  beastmaster_disembowel: disembowel,
  beastmaster_bloodlust: bloodlust,
  beastmaster_vengeance: vengeance,
  beastmaster_feral_bond: feralBond,
  beastmaster_primal_fury: primalFury,
  beastmaster_call_of_the_wild: callOfTheWild,
};
