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
 *   paws     prints where it pushed off and landed (`pawTrack`), a forepaw pinning (`pinPaw`)
 *   hackles  a crest standing along its back when its blood is up (`crest`); for
 *            Bloodlust, the beast itself flushed red (`k.tint`) under a low ruff
 *   voice    arcs going out from a mouth, the beast's or the handler's (`howl`)
 *   the beast itself, in light, when it leaps (`spirit`)
 *
 * in amber and earth, with the green of the wild for a mending and a taming
 * and blood red where blood is the point (Disembowel, Bloodlust).
 *
 * The companion is `k.companion`, for one's own casts and for a peer's (their
 * cast says which creature it is), and the caster turns to it for the spells
 * worked on it (`face: 'companion'`). What the beast does to an enemy is
 * drawn on the enemy, from the beast's side; a spell on the beast is drawn on
 * the beast, and on nothing when it cannot be seen.
 *
 * This file is this group's alone and nobody else edits it, so anything its
 * spells share is written here, not in the kit.
 */
import type { CastPose, SpellVisual } from './index';
import { COMPANION_REACH } from '../../game/fight';
import { HEIGHT_SCALE } from '../iso';
import { spellInfo } from './info';
import { armToward } from '../figure';
import { arcAt, bump, clamp, dry, easeBack, easeIn, easeOut, flashOf, hashOf, lerp, mid3, seg, smooth, TAU, type Body, type FxScene, type GroundLayer, type P3, type SpellPalette } from './kit';
import { beats, euler, one, stepIn } from './poses';

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

/** The beast a spell works through: the caster's companion, or nothing when it is not to be seen. */
const beastOf = (k: FxScene): Body | null => k.companion;

/**
 * Where a companion walks at heel, a little to the right of its keeper and
 * behind: where a leap is drawn from when the island has already put the
 * companion where it lands before the cast is drawn.
 */
const heelOf = (k: FxScene): P3 => k.local(k.caster, 22, -6, 0);

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
function bite(k: FxScene, p: P3, o: { size: number; shut: number; face?: number; alpha?: number; turn?: number; bias?: number; jaw?: string; shiftX?: number }): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const S = o.size * k.zoom, x = k.sx(p) + (o.shiftX ?? 0), y = k.sy(p);
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
    // Each jaw swung open about the hinge, the upper further than the lower, as a jaw opens.
    const swing = (upper: boolean): void => {
      g.translate(-1, 0);
      g.rotate(upper ? -open * 0.5 : open * 0.36);
      g.translate(1, 0);
    };
    for (const upper of [false, true]) {
      g.save();
      swing(upper);
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
    // The teeth over both jaws, so that shut they are seen meeting past each other rather than hidden in the gums.
    for (const upper of [false, true]) {
      g.save();
      swing(upper);
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
      g.restore();
    }
  }, o.bias ?? 4);
}

/** A paw print's pad and toes, in units of its length, pointing along +x: what `paw` lays down. */
const PAD: ReadonlyArray<readonly [number, number]> = [[-0.42, 0], [-0.3, 0.3], [0.02, 0.34], [0.14, 0.12], [0.14, -0.12], [0.02, -0.34], [-0.3, -0.3]];
const TOES: ReadonlyArray<readonly [number, number]> = [[0.36, 0.33], [0.52, 0.11], [0.52, -0.11], [0.36, -0.33]];

/** A paw print's outlines on the ground (pad and four toes), `size` tiles long, pointing along `head`, added to `paths`. */
function pawPaths(x: number, y: number, head: { x: number; y: number }, size: number, paths: number[][]): void {
  const put = (f: number, s: number, out: number[]): void => {
    out.push(x + (head.x * f - head.y * s) * size, y + (head.y * f + head.x * s) * size);
  };
  const pad: number[] = [];
  for (const [f, s] of PAD) put(f, s, pad);
  paths.push(pad);
  for (const [f, s] of TOES) {
    const toe: number[] = [];
    for (let i = 0; i < 5; i++) put(f + Math.cos((i / 5) * TAU) * 0.12, s + Math.sin((i / 5) * TAU) * 0.1, toe);
    paths.push(toe);
  }
}

/** A print to lay in a track (`pawTrack`). */
interface Print { x: number; y: number; head: { x: number; y: number }; size: number; alpha: number }

/**
 * Many paw prints as one mark on the ground (one record, however many prints), each at its own alpha, round `c` and
 * within `r` tiles of it; `glow` gives them a night rim, so a track that says the mechanic still reads in the dark.
 */
function pawTrack(k: FxScene, c: { x: number; y: number }, r: number, prints: readonly Print[], colour: string, glow = 0, light?: string): void {
  const layers: GroundLayer[] = [];
  for (const p of prints) {
    if (p.alpha <= 0.01 || p.size <= 0.005) continue;
    const paths: number[][] = [];
    pawPaths(p.x, p.y, p.head, p.size, paths);
    layers.push({ kind: 'fill', colour, alpha: clamp(p.alpha), paths, lift: 0.1, glow: glow * p.alpha, light });
  }
  if (layers.length) k.groundShape(c.x, c.y, r + 0.4, layers);
}

/** Flat x, y pairs in the reverse order, a pair at a time: the far side of a band, walked back. */
const backwards = (pts: readonly number[]): number[] => {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
};

/** An ink line's width on the ground, as drawn. */
const inkOf = (k: FxScene): number => Math.max(0.8, 0.7 * k.zoom);

/**
 * A ring of teeth on the ground, `r` tiles out: a band, its near half lit and
 * its far half shaded as a hoop lying on the land, with fangs standing along
 * its inner edge pointing in at whatever is inside it (or along its outer
 * edge pointing out, for a guard's line). A snarl's reach, a guard's line.
 */
function toothRing(k: FxScene, c: { x: number; y: number }, r: number, o: { teeth?: number; len?: number; band?: number; alpha?: number; turn?: number; from?: number; to?: number; spans?: ReadonlyArray<readonly [number, number]>; out?: boolean; main?: string; glow?: number }): void {
  const a = o.alpha ?? 1;
  if (r <= 0.05 || a <= 0.01) return;
  const band = o.band ?? Math.min(0.12, r * 0.12), len = o.len ?? Math.min(0.3, r * 0.14);
  const turn = o.turn ?? 0;
  // The band runs from `edge` to `root`; the teeth stand on the root and point away from the edge.
  const dir = o.out ? 1 : -1;
  const edge = o.out ? r - band : r, root = o.out ? r : r - band;
  // Broken into stretches (`spans`, each from one angle to another) or one, all of it one mark on the ground.
  const spans = o.spans ?? [[o.from ?? 0, o.to ?? TAU]];
  const total = spans.reduce((s, [f, t]) => s + (t - f), 0);
  const allTeeth = o.teeth ?? Math.max(8, Math.round(r * 7));
  const teethPaths: number[][] = [], near: number[][] = [], far: number[][] = [], rims: number[][] = [];
  const cy = k.eye.worldToScreenY(c.x, c.y, 0);
  let whole = false;
  for (const [from, to] of spans) {
    const teeth = Math.max(1, Math.round((allTeeth * (to - from)) / total));
    whole = to - from >= TAU - 1e-6;
    const steps = teeth * 2;
    const edges: number[] = [], roots: number[] = [], tips: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const ang = turn + from + ((to - from) * i) / steps;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      edges.push(c.x + ca * edge, c.y + sa * edge);
      roots.push(c.x + ca * root, c.y + sa * root);
      // Each tooth's point a little past its root's middle, hooking: a fang, not a sawtooth.
      if (i % 2 === 1) {
        const ta = ang + ((to - from) / steps) * 0.25;
        tips.push(c.x + Math.cos(ta) * (root + dir * len), c.y + Math.sin(ta) * (root + dir * len));
      }
    }
    for (let j = 0; j < teeth; j++) {
      const i = 2 * j;
      teethPaths.push([roots[2 * i], roots[2 * i + 1], tips[2 * j], tips[2 * j + 1], roots[2 * i + 4], roots[2 * i + 5]]);
    }
    // The near half of the band lit and the far half shaded, by which side of the middle it lies on the screen.
    for (let i = 0; i < steps; i++) {
      const quad = [edges[2 * i], edges[2 * i + 1], edges[2 * i + 2], edges[2 * i + 3], roots[2 * i + 2], roots[2 * i + 3], roots[2 * i], roots[2 * i + 1]];
      (k.eye.worldToScreenY((edges[2 * i] + edges[2 * i + 2]) / 2, (edges[2 * i + 1] + edges[2 * i + 3]) / 2, 0) > cy ? near : far).push(quad);
    }
    rims.push(edges);
  }
  const al = clamp(a), w = inkOf(k);
  // At night the teeth carry a rim of light, so the reach is still read in the dark.
  k.groundShape(c.x, c.y, r + len + 0.3, [
    { kind: 'fill', colour: IVORY, alpha: al, paths: teethPaths, lift: 0.15 },
    { kind: 'stroke', colour: k.pal.ink, alpha: al, paths: teethPaths, lift: 0.15, width: w, closed: true, join: 'miter', glow: 0.8 * k.night },
    { kind: 'fill', colour: k.pal.deep, alpha: al, paths: far, lift: 0.15 },
    { kind: 'fill', colour: o.main ?? k.pal.main, alpha: al, paths: near, lift: 0.15 },
    { kind: 'stroke', colour: k.pal.ink, alpha: al, paths: rims, lift: 0.15, width: w, closed: whole && spans.length === 1 },
  ]);
  const gl = o.glow ?? 1;
  if (gl > 0) {
    const spots = 6;
    for (let i = 0; i < spots; i++) {
      const [from, to] = spans[i % spans.length];
      const ang = turn + from + ((to - from) * (Math.floor(i / spans.length) + 0.5)) / Math.ceil(spots / spans.length);
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
  const furrows: number[][] = [], lips: number[][] = [];
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * len * 0.24;
    const left: number[] = [], right: number[] = [];
    for (let j = 0; j <= m; j++) {
      const t = (j / m) * grow;
      const w = len * 0.075 * Math.sin(Math.PI * Math.min(1, t / Math.max(0.3, grow)));
      const side = off * (1 + 0.35 * t);
      const cx = x + dir.x * (t - 0.5) * len + px * side, cy = y + dir.y * (t - 0.5) * len + py * side;
      left.push(cx + px * w, cy + py * w);
      right.push(cx - px * w, cy - py * w);
    }
    furrows.push([...left, ...backwards(right)]);
    lips.push(left);
  }
  const al = clamp(alpha);
  k.groundShape(x, y, len, [
    { kind: 'fill', colour: '#2e2014', alpha: al, paths: furrows, lift: 0.12 },
    // The lip of turned earth catching the light, on the far side of each furrow.
    { kind: 'stroke', colour: lip, alpha: al, paths: lips, lift: 0.12, width: Math.max(0.8, 0.8 * k.zoom) },
  ]);
}

/** An arrowhead on the ground at (x, y) pointing along `head`, `size` tiles: a creature's attention turning. */
interface Chevron { x: number; y: number; head: { x: number; y: number }; size: number; alpha: number; main?: string }

/**
 * Arrowheads on the ground, each at (x, y) pointing along `head`, `size` tiles: creatures' attention turning. All of
 * them one mark round `c` within `r` tiles (one record however many), with a night rim.
 */
function chevrons(k: FxScene, c: { x: number; y: number }, r: number, list: readonly Chevron[]): void {
  const layers: GroundLayer[] = [];
  const w = inkOf(k);
  for (const v of list) {
    if (v.alpha <= 0.01) continue;
    const pts: number[] = [];
    for (const [f, s] of [[0.55, 0], [-0.15, 0.55], [-0.5, 0.55], [0.02, 0], [-0.5, -0.55], [-0.15, -0.55]]) {
      pts.push(v.x + (v.head.x * f - v.head.y * s) * v.size, v.y + (v.head.y * f + v.head.x * s) * v.size);
    }
    const al = clamp(v.alpha);
    layers.push(
      { kind: 'fill', colour: v.main ?? k.pal.main, alpha: al, paths: [pts], lift: 0.15 },
      { kind: 'stroke', colour: k.pal.ink, alpha: al, paths: [pts], lift: 0.15, width: w, closed: true, join: 'miter', glow: 0.7 * k.night },
    );
  }
  if (layers.length) k.groundShape(c.x, c.y, r + 0.6, layers);
}


/**
 * A voice going out from a mouth: `n` faceted arcs, the newest nearest, spreading along screen angle `ang` as `u` goes,
 * every one of them gone by the time `u` is one. Each is laid again in the glow pass, so a call is still seen at night
 * and at play size, where a thin inked arc alone is lost.
 */
function howl(k: FxScene, from: P3, ang: number, u: number, o: { n?: number; reach?: number; span?: number; alpha?: number; width?: number; main?: string; light?: string; glow?: number; bias?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || u <= 0) return;
  const n = o.n ?? 3, reach = (o.reach ?? 18) * k.zoom, span = o.span ?? 0.7, W = (o.width ?? 2.2) * k.zoom;
  const x = k.sx(from), y = k.sy(from);
  const arcs: Array<{ r: number; al: number }> = [];
  // Spaced over the whole of `u`, the last setting off late enough to be gone by the end, so none hangs there.
  const spread = 1 + 0.18 * (n - 1);
  for (let i = 0; i < n; i++) {
    const v = u * spread - i * 0.18;
    if (v <= 0 || v >= 1) continue;
    arcs.push({ r: reach * (0.18 + 0.82 * easeOut(v)), al: a * (1 - v * v) });
  }
  if (!arcs.length) return;
  const main = o.main ?? k.pal.main, ink = k.pal.ink, core = k.pal.core;
  const trace = (g: CanvasRenderingContext2D, r: number): void => {
    g.beginPath();
    for (let j = 0; j <= 5; j++) {
      const an = ang - span + (2 * span * j) / 5;
      // Flattened a little, as a ring seen from over the shoulder.
      (j === 0 ? g.moveTo : g.lineTo).call(g, x + Math.cos(an) * r, y + Math.sin(an) * r * 0.78);
    }
  };
  k.worldDraw(from, (g) => {
    g.lineJoin = 'miter';
    g.lineCap = 'butt';
    for (const { r, al } of arcs) {
      g.globalAlpha = clamp(al);
      trace(g, r);
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
  const gl = (o.glow ?? 0.4) * (0.35 + 0.85 * k.night);
  if (gl > 0.01) {
    const light = o.light ?? k.pal.light;
    k.glowDraw((g) => {
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.strokeStyle = light;
      for (const { r, al } of arcs) {
        g.globalAlpha = clamp(al * gl);
        trace(g, r);
        g.lineWidth = W * 2.2;
        g.stroke();
      }
    });
  }
}

/**
 * A beast's blood up: a crest standing along its back from the shoulders to the rump -- hackles raised, not a burst
 * round the body. Each spike rises off the back and leans toward the tail, the longest over the shoulders. `len` is
 * the longest, in height units; `beat` how many times a second they surge. Leaves (a flame's tongue) for Bloodlust's
 * blood, `claws` (tapered hooks) for Primal Fury's.
 */
function crest(k: FxScene, b: Body, o: { len: number; alpha: number; beat: number; t: number; main: string; core: string; light: string; n: number; claws?: boolean; span?: number }): void {
  if (o.alpha <= 0.01 || o.len <= 0.2) return;
  // The line of the back, from where the head is: the shoulders a third of the way to it, the rump as far behind.
  const head = k.muzzle(b);
  let fx = head.x - b.x, fy = head.y - b.y;
  const reach = Math.hypot(fx, fy);
  if (reach < 1e-3) {
    const f = k.facingDir(b);
    fx = (f.x * b.wide * 1.6) / 40;
    fy = (f.y * b.wide * 1.6) / 40;
  }
  const backZ = b.z + b.tall * 0.55;
  const shoulder = { x: b.x + fx * 0.32, y: b.y + fy * 0.32, z: backZ + b.tall * 0.04 };
  // `span` of the back from the shoulders: all of it for a crest, the shoulders alone for a ruff.
  const sp = o.span ?? 1;
  const rump = { x: b.x + fx * (0.32 - 0.94 * sp), y: b.y + fy * (0.32 - 0.94 * sp), z: backZ + b.tall * (0.04 - 0.08 * sp) };
  const s0x = k.sx(shoulder), s0y = k.sy(shoulder), s1x = k.sx(rump), s1y = k.sy(rump);
  // Toward the tail on the screen, for the lean: none when the beast faces straight at the viewer or away.
  let tx = s1x - s0x, ty = s1y - s0y;
  const tl = Math.hypot(tx, ty);
  const lean = Math.min(1, tl / (k.zoom * 8));
  tx = tl > 1e-3 ? tx / tl : 0;
  ty = tl > 1e-3 ? ty / tl : 0;
  const L = k.hpx(o.len);
  // Seen end on (the beast facing the viewer or away), the back is short on the screen: the spikes are spread across
  // its width and fanned instead, a ruff of hackles, rather than stacked into one spike.
  const across = k.zoom * b.wide * 1.4, extra = Math.max(0, across - tl);
  const gap = Math.max(Math.max(tl, across) / Math.max(1, o.n - 1), k.zoom * 2.4);
  const spikes: number[][] = [];
  for (let i = 0; i < o.n; i++) {
    const s = o.n > 1 ? i / (o.n - 1) : 0.3;
    const h = hashOf(k.seed, i);
    // Each surges on the beat, and flickers a little on its own between.
    const surge = 0.82 + 0.18 * Math.sin(o.t * o.beat * TAU - s * 1.6) + 0.05 * Math.sin(o.t * 11 + i * 2.3);
    const shape = lerp(1 - 0.5 * s, 1 - 0.9 * Math.abs(s - 0.5), extra / Math.max(1, across));
    const len = L * shape * (0.88 + 0.24 * h) * surge;
    const fan = (s - 0.5) * (extra / Math.max(1, across));
    const rx = lerp(s0x, s1x, s) + fan * across, ry = lerp(s0y, s1y, s);
    // Up, leaning back toward the tail (or fanned out across, end on), and swaying.
    const sway = 0.12 * Math.sin(o.t * 5 + i * 1.7);
    let dx = tx * (0.32 * lean + sway) + fan * 1.1 + (tl > 1e-3 ? 0 : sway), dy = -1 + ty * 0.32 * lean;
    const dl = Math.hypot(dx, dy);
    dx /= dl;
    dy /= dl;
    const xs: number[] = [], ys: number[] = [];
    const m = o.claws ? 6 : 4;
    for (let j = 0; j <= m; j++) {
      const v = j / m;
      // A claw hooks over toward the tail at its point; a tongue curls only a little.
      const hook = (o.claws ? 0.45 : 0.18) * v * v * len;
      xs.push(rx + dx * len * v + tx * hook * lean);
      ys.push(ry + dy * len * v + ty * hook * lean + (o.claws ? hook * 0.35 : 0));
    }
    spikes.push(xs, ys);
  }
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  const W = Math.min(gap * (o.claws ? 0.8 : 0.9), L * 0.5);
  k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
    g.globalAlpha = clamp(o.alpha);
    for (let i = 0; i < spikes.length; i += 2) taper(g, spikes[i], spikes[i + 1], W, o.claws ? 0 : 0.3, o.main, o.core, k.pal.ink, inkW);
  }, -1.5);
  k.glow(mid3(shoulder, rump, 0.4), o.len * 1.4 + 4, o.alpha * 0.4, o.light);
}

/**
 * The beast's forepaw in light, come down on a creature's back from the beast's side and pinning it: the foreleg
 * reaching in from over the beast's side, the paw on the back, and its claws hooked over and down the far flank.
 * `side` +1 when the creature is to the right of the beast on the screen; `drop` pixels at zoom one it still has to come
 * down (nought: on the back); `press` how hard it bears down (nought to one), squashing the paw.
 */
function pinPaw(k: FxScene, b: Body, side: number, drop: number, press: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const back = { x: b.x, y: b.y, z: b.z + b.tall * 0.6 };
  const S = Math.max(6 * k.zoom, k.hpx(b.tall * 0.4));
  const x0 = k.sx(back) - side * S * 0.25, y0 = k.sy(back) - drop * k.zoom + S * 0.12 * press;
  const ink = k.pal.ink, main = k.pal.main, core = k.pal.core, deep = k.pal.deep;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  // Claws: from the paw's front edge over the far side and down it, hooked, in the paw's own units (x toward the far side).
  const claws: number[][] = [];
  for (const [cy, reach] of [[-0.32, 0.95], [-0.08, 1.05], [0.16, 0.9]] as const) {
    const xs: number[] = [], ys: number[] = [];
    for (let j = 0; j <= 6; j++) {
      const v = j / 6, an = v * 1.9;
      xs.push(x0 + side * S * (0.45 + Math.sin(an) * 0.5 * reach));
      ys.push(y0 + S * (cy - 0.15 + (1 - Math.cos(an)) * 0.42 * reach));
    }
    claws.push(xs, ys);
  }
  const sq = 1 - 0.18 * press;
  k.worldDraw(back, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'miter';
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    const poly = (pts: ReadonlyArray<readonly [number, number]>, fill: string): void => {
      g.beginPath();
      pts.forEach(([px, py], n) => (n ? g.lineTo : g.moveTo).call(g, x0 + side * px * S, y0 + py * S * sq));
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      g.stroke();
    };
    // The foreleg: a stroke of light reaching in from over the beast's side and down, nothing where it leaves the beast
    // and broad at the wrist -- the beast's reach, ending in its paw.
    const lx: number[] = [], ly: number[] = [];
    for (let j = 0; j <= 8; j++) {
      const v = j / 8;
      lx.push(x0 + side * S * (-1.7 + 1.55 * v - 0.3 * Math.sin(Math.PI * v)));
      ly.push(y0 + S * sq * (-1.65 + 1.4 * v - 0.2 * Math.sin(Math.PI * v)));
    }
    // Light, not a limb: uninked and half seen, so the paw is the solid thing and the reach only says where from.
    g.globalAlpha = clamp(alpha * 0.5);
    taper(g, lx, ly, S * 0.8, 0.85, k.pal.light, core, ink, 0);
    g.globalAlpha = clamp(alpha);
    // The paw, round and flat on the back; three toes along its front edge, where the claws come out.
    const blob: Array<[number, number]> = [];
    for (let j = 0; j < 10; j++) {
      const an = (j / 10) * TAU;
      blob.push([-0.08 + Math.cos(an) * 0.55, -0.15 + Math.sin(an) * 0.42]);
    }
    poly(blob, main);
    for (const ty of [-0.42, -0.16, 0.1]) {
      const toe: Array<[number, number]> = [];
      for (let j = 0; j < 6; j++) toe.push([0.47 + Math.cos((j / 6) * TAU) * 0.15, ty + Math.sin((j / 6) * TAU) * 0.12]);
      poly(toe, dry(main, 0.2, deep));
    }
    poly([[-0.5, -0.4], [-0.15, -0.53], [0.22, -0.46], [0.05, -0.36], [-0.38, -0.28]], core);
    for (let c = 0; c < claws.length; c += 2) taper(g, claws[c], claws[c + 1], S * 0.22, 0, IVORY, '#ffffff', ink, inkW);
  }, 5);
  k.glow({ ...back, z: back.z + 2 }, 8 + b.wide * 0.5, alpha * 0.3);
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
    for (const [tx, ty, r] of [[-0.68, -0.44, 0.24], [-0.25, -0.78, 0.26], [0.25, -0.78, 0.26], [0.68, -0.44, 0.24]] as const) {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 5; i++) {
        const an = -Math.PI / 2 + (i / 5) * TAU;
        pts.push([tx + Math.cos(an) * r * 0.85, ty + Math.sin(an) * r]);
      }
      // Toes as bright as the pad, so the four read as toes at play size; the right-hand pair a shade down.
      poly(pts, tx < 0 ? main : dry(main, 0.25, deep));
    }
  }, 4);
  k.glow(p, size * 2.6, alpha * 0.25);
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

/**
 * A leap along a path of one's own (`at`, nought to one), drawn as `leap` draws one: the beast in light at `u`, two
 * after-images behind it, its light, and its shadow on the ground.
 */
function leapAlong(k: FxScene, at: (v: number) => P3, u: number, scale = 1): void {
  for (let i = 2; i >= 1; i--) {
    const v = u - i * 0.1;
    if (v > 0) spirit(k, at(v), screenAngle(k, at(Math.max(0, v - 0.04)), at(v + 0.04)), 12 * scale, (0.42 - i * 0.14) * (1 - u * 0.3), 1);
  }
  const head = at(u);
  spirit(k, head, screenAngle(k, at(Math.max(0, u - 0.04)), at(Math.min(1, u + 0.04) + (u > 0.96 ? 0.04 : 0))), 12 * scale, 0.95, 6);
  k.light(head, 1.6 * scale, 0.7);
  const ground = k.on(head.x, head.y);
  const high = clamp((head.z - ground.z) / 30);
  k.disc(head, 0.16 * scale * (1 - 0.4 * high), { main: '#1c140c', alpha: 0.35 * (1 - 0.5 * high), n: 8 });
}

/**
 * The beast in light wrapped round the real one while the stage carries it (`cast.companion`, `smooth(u)` of the way
 * from `from`): lifted on an arc a body height or two high at its top (more the further it goes), its shadow kept on the
 * body's own path, so it reads as a leap rather than a dash along the ground. It sets off from the body and comes down
 * onto it: one beast leaping. (The stage carries the body along the ground only; a `lift` on `cast.companion` would let
 * the body itself rise.)
 */
function rideLeap(k: FxScene, beast: Body, from: { x: number; y: number }, u: number, scale: number): void {
  const g = smooth(u);
  const tiles = Math.hypot(beast.x - from.x, beast.y - from.y) / Math.max(0.05, g);
  const H = Math.min(10, 4 + tiles * 1.5);
  leapAlong(k, (v) => {
    const f = g > 0.02 ? v / g : 0;
    return k.on(from.x + (beast.x - from.x) * f, from.y + (beast.y - from.y) * f, beast.tall * 0.45 + 4 * H * v * (1 - v));
  }, g, scale);
  // The body under it lit amber by its own leap, the light and the body one beast rather than a body and a double.
  k.tint(beast, { colour: k.pal.main, share: 0.5 * Math.sin(Math.PI * clamp(g)) });
}

/* ---- the twelve -------------------------------------------------------------------------- */

const fxOf = (id: string): Readonly<Record<string, number>> => spellInfo(id)?.fx ?? {};

/* Sic: a whistle and a point, and the companion's claws across the enemy at once, a blow at `more` of its own. */
const SIC_MORE = fxOf('beastmaster_sic').more ?? 1;
const sicPose: CastPose = (r, t, c) => {
  const b = beats(c);
  const lips = b.top * 0.45;
  // Two fingers to the lips for the whistle, the weight drawn back onto the rear foot and the chest wound away; then the
  // right arm thrown out flat at the enemy, the body leaning in after it and the front foot put down a step on: the
  // beast's word, and where.
  r.shape = [{ two: one(t, [[0, 0], [lips * 0.7, 1], [b.top, 1], [b.let, 0]]) }, { point: one(t, [[0, 0], [b.top, 0.4], [b.let, 1], [b.through, 1], [1, 0]]) }];
  r.mouth = one(t, [[0, 0], [lips, 0.22], [b.top, 0.22], [b.let, 0.55], [b.through, 0.3], [1, 0]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [lips, [66, -16, 36]], [b.top, [66, -16, 36]], [b.let, [-18, 26, 0]], [b.through, [-14, 24, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [lips, 148], [b.top, 148], [b.let, 30], [1, 22]]);
  // The point aimed in the chest's frame: the trunk is pitched 28 degrees forward over it, so the arm is raised that much
  // less 8 (the enemy's chest is below the shoulder) above the chest's level, and the hand ends level at the enemy.
  const point = armToward(1, [0.1, 0.94, 0.34]);
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [lips, [24, 30, -10]], [b.top, [40, 40, -24]], [b.let, point], [b.through, point], [1, [20, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [b.top, 104], [b.let, 0], [b.through, 4], [1, 22]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [24, 0, 0]], [b.let, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [lips, [6, 0, -14]], [b.top, [8, 0, -28]], [b.let, [-10, 0, 16]], [b.through, [-9, 0, 14]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [lips, [4, 0, -4]], [b.top, [6, 0, -8]], [b.let, [-18, 0, 6]], [b.through, [-16, 0, 6]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [lips, [-4, 0, 10]], [b.top, [-4, 0, 22]], [b.let, [-10, 0, -10]], [b.through, [-10, 0, -8]], [1, [0, 0, 0]]]);
  // A short step in with the point -- held to a few units, so the stance stays a stance and the legs do not split.
  stepIn(r, t, c, { hit: b.let, from: b.top, back: b.through + 0.1, by: 3, most: 3, bend: 18 });
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
      // The whistle: arcs off the lips toward the beast while the fingers are at the mouth, lit so they carry at night.
      const w = seg(t, 0.08, 0.4);
      const lips = mid3(k.head(), k.hand(0), 0.5);
      const to = strikerOf(k) === k.caster ? k.target : strikerOf(k);
      if (w > 0 && w < 1) howl(k, lips, screenAngle(k, lips, k.at(to, 0.6)), w, { n: 3, reach: 14, span: 0.45, width: 2, alpha: 0.95, glow: 0.55 });
    },
    release: (k) => {
      k.burst(k.hand(1), 6, { kind: 'mote', size: 1.6, life: [0.15, 0.3], speed: [0.6, 1.2], up: [0, 4], heading: k.toward(k.caster, k.target), cone: 0.5, gravity: 0, over: true });
    },
    // The beast is on it at once, a lunge in light long enough to be seen: from where the companion stands, or, not seeing
    // it, from its reach short of the enemy on your side -- which is where it has to be for the word to be obeyed.
    travel: { secs: () => 0.24, draw: (k, u) => {
      const to = k.heart(k.target);
      const back = k.toward(k.target, k.caster);
      const from = k.companion ? k.at(k.companion, 0.5) : k.on(k.target.x + back.x * COMPANION_REACH, k.target.y + back.y * COMPANION_REACH, 5);
      leap(k, from, to, easeIn(u) * 0.6 + u * 0.4, 4, 0.9);
    } },
    hit: (k) => {
      const at = k.heart(k.target), away = k.toward(strikerOf(k), k.target);
      // Chips of amber thrown off the far side, laid over in their own colour: the creature stays seen through them.
      k.burst(at, Math.round(8 * SIC_MORE), { kind: 'spark', colour: [k.pal.main, IVORY], size: 1.6, life: [0.18, 0.36], speed: [0.8, 1.6], up: [6, 22], heading: away, cone: 1.2, gravity: 60, drag: 0.08, over: true });
      k.burst(k.at(k.target, 0.05), 5, { kind: 'dust', colour: '#8a7a62', size: 2.6, life: [0.35, 0.6], speed: [0.2, 0.5], up: [2, 6], gravity: 2 });
    },
    impact: { secs: 0.55, draw: (k, u) => {
      const at = k.heart(k.target);
      const ang = strikeAngle(k, strikerOf(k));
      // The rake's size is the blow's (130% of the beast's own reads a third longer than Pounce's plain one), and the
      // creature's: a small one is not raked past its own back.
      const fit = Math.min(1, k.target.tall / 22);
      // Broad amber, ivory along the lit edge and inked dark, so a pale coat does not swallow it at play size.
      rake(k, at, { ang, len: 12 * SIC_MORE * fit, gap: 3.4 * fit, u: seg(u, 0, 0.22), alpha: 1 - seg(u, 0.45, 1), bend: 0.14, width: Math.max(2, 2.6 * fit), core: IVORY });
      k.flare(at, 5 * (1 - u), 0.6 * flashOf(u, 0.08), k.pal.core, 0.4);
      k.light(k.target, 2, 0.5 * (1 - u));
    } },
  },
};

/* Pounce: the companion leaps up to `reach` tiles onto the enemy and strikes it, and the enemy's next blow is put back `back` seconds. */
const POUNCE = fxOf('beastmaster_pounce');
const pouncePose: CastPose = (r, t, c) => {
  const b = beats(c);
  const low = b.top * 0.55;
  // Swung back low past the hip, then flung flat out at where it lands -- not up, which reads as hailing a friend -- and
  // held there while it flies.
  // Aimed in the chest's frame, a little below its level: the trunk comes up and back over the release, and the hand
  // should end level with where the beast lands, not raised to it.
  const fling = armToward(1, [0.12, 0.98, -0.12]);
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [low, [42, 18, 0]], [b.top, [-34, 18, 0]], [b.let, fling], [b.through, fling], [1, [20, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [low, 36], [b.top, 30], [b.let, 2], [b.through, 4], [1, 22]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [20, 0, 0]], [b.let, [-6, 0, 0]], [b.through, [-6, 0, 0]], [1, [0, 0, 0]]]);
  // The flung hand flat and open, sending it; the shout with it.
  r.shape = [undefined, { flat: one(t, [[0, 0], [b.top, 0.3], [b.let, 1], [b.through, 1], [1, 0]]) }];
  r.mouth = one(t, [[0, 0], [b.top, 0.1], [b.let, 0.75], [b.through, 0.4], [1, 0]]);
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
    // The stage draws a companion the spell moved where it stood as the cast began (`cast.companion`), so that is where
    // the leap goes from; one already beside where it is going (nothing carried) is drawn leaping from your side.
    const c = k.companion;
    const p = c && Math.hypot(c.x - toward.x, c.y - toward.y) > near ? c : otherwise(k);
    s.fx = p.x;
    s.fy = p.y;
  }
  return k.on(s.fx, s.fy, 5);
}

/** Pounce's flight, as a share of its cast: from the release to where the companion lands (`cast.companion`). */
const POUNCE_TIMING = { secs: 1.0, release: 0.48 };
const POUNCE_LANDS = 0.92;

const pounce: SpellVisual = {
  palette: PALETTE,
  // The stage carries the real companion from where it stood to where the island put it over the flight, and the beast in
  // light is drawn round it, leaping: one beast going, not a body already there and a double flying in.
  cast: { timing: POUNCE_TIMING, pose: pouncePose, companion: { from: POUNCE_TIMING.release, to: POUNCE_LANDS } },
  fx: {
    charge: (k, t) => {
      const from = leapFrom(k, k.target, 0);
      const head = k.toward(from, k.target);
      // Gathering to spring: the hind feet dug in where it goes from.
      const g = seg(t, 0.2, 0.46);
      const sx = -head.y * 0.09, sy = head.x * 0.09;
      pawTrack(k, from, 0.3, [
        { x: from.x - head.x * 0.1 + sx, y: from.y - head.y * 0.1 + sy, head, size: 0.16, alpha: 0.7 * smooth(g) },
        { x: from.x - head.x * 0.1 - sx, y: from.y - head.y * 0.1 - sy, head, size: 0.16, alpha: 0.7 * smooth(seg(t, 0.26, 0.48)) },
      ], k.pal.deep);
    },
    release: (k) => {
      const from = leapFrom(k, k.target, 0);
      k.burst(k.on(from.x, from.y, 1), 10, { kind: 'dust', colour: '#8a7a62', size: 2.8, life: [0.4, 0.7], speed: [0.3, 0.8], up: [2, 8], heading: k.toward(k.target, from), cone: 1.6, gravity: 4 });
    },
    // As long as the stage takes to carry it there, and high: a leap hangs at its top.
    travel: { secs: () => (POUNCE_LANDS - POUNCE_TIMING.release) * POUNCE_TIMING.secs, draw: (k, u) => {
      const from = leapFrom(k, k.target, 0);
      const beast = k.companion;
      const head = k.toward(from, k.target);
      pawTrack(k, from, 0.3, [
        { x: from.x - head.x * 0.1 - head.y * 0.09, y: from.y - head.y * 0.1 + head.x * 0.09, head, size: 0.16, alpha: 0.7 },
        { x: from.x - head.x * 0.1 + head.y * 0.09, y: from.y - head.y * 0.1 - head.x * 0.09, head, size: 0.16, alpha: 0.7 },
      ], k.pal.deep);
      if (!beast) {
        const to = k.heart(k.target);
        const tiles = Math.hypot(to.x - from.x, to.y - from.y);
        leap(k, from, to, smooth(u) * 0.85 + u * 0.15, 6 + tiles * 5);
        return;
      }
      rideLeap(k, beast, from, u, 1.05);
    } },
    hit: (k) => {
      const at = k.heart(k.target), away = k.toward(leapFrom(k, k.target, 0), k.target);
      k.burst(at, 14, { kind: 'spark', colour: [k.pal.main, IVORY], size: 1.8, life: [0.2, 0.45], speed: [0.8, 2], up: [4, 28], heading: away, cone: 2, gravity: 60, drag: 0.08, over: true });
      // The landing's dust: four low puffs kicked out round where it comes down, each with its own short arc on the ground.
      const head = k.toward(leapFrom(k, k.target, 0), k.target);
      const land = { x: k.target.x - head.x * 0.42, y: k.target.y - head.y * 0.42 };
      for (let i = 0; i < 4; i++) {
        const an = (i / 4) * TAU + 0.4 + hashOf(k.seed, i) * 0.5, dir = { x: Math.cos(an), y: Math.sin(an) };
        k.burst(k.on(land.x + dir.x * 0.14, land.y + dir.y * 0.14, 1), 4, { kind: 'dust', colour: '#8a7a62', size: 3, life: [0.35, 0.7], speed: [0.4, 0.8], up: [1, 4], heading: dir, cone: 0.7, gravity: 3, drag: 0.25 });
      }
    },
    impact: { secs: Math.max(0.85, (POUNCE.back ?? 0.5) + 0.35), draw: (k, u) => {
      const secs = Math.max(0.85, (POUNCE.back ?? 0.5) + 0.35), age = u * secs;
      const at = k.heart(k.target), from = leapFrom(k, k.target, 0);
      const side = sideOf(k, from, k.target);
      // Both forepaws, straight down the flank: a weight landing, not a swipe -- fitted to the creature as Sic's rake is,
      // laid low on its side and all but parallel, so they read as two paws come down on it and not a fan over its back.
      const fit = Math.min(1, k.target.tall / 22);
      const flank = k.at(k.target, 0.45);
      for (const s of [-1, 1]) {
        rake(k, flank, { shift: [s * 4 * fit, 0], ang: Math.PI / 2 - side * 0.2 - s * 0.2, len: 12 * (POUNCE.more ?? 1) * fit, gap: 2.8 * fit, width: Math.max(1.6, 2.2 * fit), u: seg(u, 0, 0.18), alpha: 1 - seg(u, 0.55, 1), bend: s * 0.12, glow: 0.6, core: IVORY });
      }
      // The landing in the ground: four short scuffs close round it where the puffs of dust went up, and the prints it
      // lands on.
      const head = k.toward(from, k.target);
      const sx = -head.y * 0.12, sy = head.x * 0.12;
      const land = { x: k.target.x - head.x * 0.42, y: k.target.y - head.y * 0.42 };
      const go = easeOut(seg(u, 0, 0.5)), dust = 1 - seg(u, 0.25, 0.7);
      if (dust > 0.01) {
        // Each a short curve hugging the landing, its ends drawn in as it spreads: kicked-up earth, not a hoop.
        const r = 0.1 + 0.2 * go, segs: Array<[P3, P3]> = [];
        for (let i = 0; i < 4; i++) {
          const a0 = (i / 4) * TAU + 0.4 + hashOf(k.seed, i) * 0.5 - 0.25, span = 0.6 - 0.3 * go;
          for (let j = 0; j < 3; j++) {
            const b0 = a0 + (span * j) / 3, b1 = a0 + (span * (j + 1)) / 3;
            segs.push([k.on(land.x + Math.cos(b0) * r, land.y + Math.sin(b0) * r), k.on(land.x + Math.cos(b1) * r, land.y + Math.sin(b1) * r)]);
          }
        }
        k.groundPath([], { segs, width: 2.2 * (1 - 0.5 * go), main: '#c2ab80', ink: '#7a6444', alpha: 0.75 * dust, glow: 0 });
      }
      const pa = 0.75 * (1 - seg(u, 0.6, 1));
      pawTrack(k, land, 0.3, [
        { x: land.x + sx, y: land.y + sy, head, size: 0.17, alpha: pa },
        { x: land.x - sx, y: land.y - sy, head, size: 0.17, alpha: pa },
      ], k.pal.deep);
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
      k.flare(at, 6 * (1 - u), 0.7 * flashOf(u, 0.06), k.pal.core, 0.3);
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
  // Teeth set as it hauls.
  r.mouth = one(t, [[0, 0], [b.top, 0.1], [b.let, 0.35], [b.through, 0.3], [1, 0]]);
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
      k.burst(k.heart(k.target), 10 * (DRAG.more ?? 1) + 4, { kind: 'spark', colour: [IVORY, k.pal.main], size: 1.6, life: [0.15, 0.35], speed: [0.5, 1.2], up: [4, 16], gravity: 50, over: true });
    },
    impact: { secs: 0.6, draw: (k, u) => {
      // The bite, side-on into the flank from the beast's side: the jaws open wide, snap shut, and hang on, kept in the
      // beast's amber shut as open, so the closed jaws still read as jaws.
      const side = sideOf(k, strikerOf(k), k.target);
      const at = k.at(k.target, 0.55);
      const sx = k.sx(at) - side * k.hpx(k.target.wide * 0.6);
      const open = smooth(seg(u, 0, 0.2)), snap = easeIn(seg(u, 0.3, 0.4));
      const shut = snap > 0 ? snap : 1 - open;
      bite(k, at, { size: 7.5, shut, face: side, alpha: smooth(u / 0.08) * (1 - seg(u, 0.55, 0.8)), turn: 0, shiftX: sx - k.sx(at) });
      k.light(k.target, 2, 0.5 * (1 - u));
    } },
    // Held for the hold's seconds: the beast's forepaw in light come down on the creature's back from the beast's side,
    // its claws hooked over the far flank -- pinned down by the beast, not caged -- pressed hard once as it lands, the
    // creature darkened under it and pressed into a dent in the ground.
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const side = sideOf(k, strikerOf(k), b);
      const R = Math.max(0.12, (b.wide / 40) * 1.6);
      // Coming down as the bite lets go, so the two are seen one after the other.
      const grow = smooth(seg(age, 0.26, 0.42)) * smooth(left / 0.35);
      // Once, hard, as it lands; then held down a little for the rest, with a tremor while it strains.
      const press = bump(age, 0.44, 0.52, 0.85) + 0.3 * seg(age, 0.55, 0.85);
      const strain = 0.6 * Math.sin(age * 23) * Math.max(0, Math.sin(age * 2.4));
      pinPaw(k, b, side, 14 * (1 - easeIn(seg(age, 0.26, 0.46))) + strain, press, grow);
      // The creature itself darkened and pressed for the whole hold.
      k.tint(b, { colour: '#3a2a1a', share: 0.32 * grow * (0.75 + 0.25 * press) });
      if (k.state.pressed === undefined && age > 0.47) {
        k.state.pressed = 1;
        k.burst(k.at(b, 0.03), 12, { kind: 'dust', colour: '#7d6a4e', size: 2.8, life: [0.35, 0.7], speed: [0.6, 1.1], up: [1, 4], gravity: 3, drag: 0.2 });
      }
      // The dent it is pressed into, deepening as the paw bears down.
      k.scorch(b, R * (0.9 + 0.3 * press), { colour: '#2e2014', alpha: (0.3 + 0.25 * press) * grow });
      // A low light in the hold, so it reads in the dark as well.
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
  r.shape = [undefined, { claw: one(t, [[0, 0], [0.12, 1], [b.through, 1], [1, 0]]) }];
  r.mouth = one(t, [[0, 0], [b.top, 0.3], [b.let, 0.6], [b.through, 0.3], [1, 0]]);
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
      k.burst(at, 12, { kind: 'drop', colour: [BLOOD.main, BLOOD.deep], size: 1.8, life: [0.35, 0.7], speed: [0.4, 1.1], up: [6, 18], heading: away, cone: 1.6, gravity: 70, drag: 0.4 });
      k.burst(at, 10, { kind: 'spark', colour: [BLOOD.core, k.pal.core], size: 1.6, life: [0.15, 0.3], speed: [0.6, 1.4], up: [4, 14], heading: away, cone: 1.6, gravity: 50, over: true });
    },
    impact: { secs: 0.6, draw: (k, u) => {
      // Down the belly, near straight: four claws, a gutting, the wound left open -- the amber of the beast's claws going
      // over to blood as it opens, blended rather than swapped in a frame.
      const at = k.at(k.target, 0.42);
      const side = sideOf(k, strikerOf(k), k.target);
      const red = smooth(seg(u, 0.2, 0.6));
      const fit = Math.min(1, k.target.tall / 22);
      rake(k, at, { ang: Math.PI / 2 - side * 0.3, n: 4, len: 12 * (GUT.more ?? 1) * fit, gap: 2.4 * fit, u: seg(u, 0, 0.2), alpha: 1, bend: 0.22,
        fill: dry(k.pal.main, red, BLOOD.main), core: dry(k.pal.core, red, BLOOD.core), light: BLOOD.light, width: 2 });
      k.flare(at, 6 * (1 - u), 0.7 * flashOf(u, 0.06), BLOOD.core, 0.2, BLOOD.light, true);
      k.light(k.target, 2, 0.5 * (1 - u), BLOOD.light);
    } },
    // The bleed, for its seconds: once a second -- as often as it takes `each` of the blow -- the wound opens again and spills.
    // When the island says the bleed has stopped (staunched, or the creature's last taken), it closes then.
    linger: { draw: (k, age, left) => {
      const b = k.target;
      if (age > 1.5 && b.bleeding === false && k.state.dry === undefined) k.state.dry = age;
      const shut = k.state.dry === undefined ? 1 : 1 - smooth((age - k.state.dry) / 0.6);
      if (shut <= 0) return;
      const a = smooth(age / 0.3) * smooth(left / 0.6) * shut;
      const side = sideOf(k, strikerOf(k), b);
      const tick = Math.floor(age);
      const since = age - tick;
      const pulse = flashOf(clamp(since / 0.5), 0.15);
      // The cuts kept on the flank, short, inside the body's outline: dark and plain between beats, opening red on each.
      // And the creature itself flushed with its blood, deeper on each beat: a bleeding body, read at any size.
      const fit = Math.min(1, b.tall / 22);
      const at = k.at(b, 0.42);
      rake(k, at, { ang: Math.PI / 2 - side * 0.3, n: 4, len: 9 * fit, gap: 2 * fit, u: 1, alpha: a * (0.4 + 0.55 * pulse), bend: 0.22,
        fill: BLOOD.deep, core: BLOOD.main, light: BLOOD.light, width: 1.6, glow: 0.4 * pulse });
      k.tint(b, { colour: BLOOD.deep, share: a * (0.15 + 0.15 * pulse) });
      k.light(b, 1.2, 0.35 * a * pulse, BLOOD.light);
      if ((k.state.tick ?? -1) < tick && left > 0.3 && shut === 1) {
        k.state.tick = tick;
        // Dripping off the lowest point of the cut.
        k.burst(k.at(b, 0.3), 5, { kind: 'drop', colour: [BLOOD.main, BLOOD.deep], size: 2, life: [0.4, 0.7], speed: [0.05, 0.25], up: [-2, 4], gravity: 60, drag: 0.5, jitter: 0.03 });
      }
      // A pool spreading under it as the seconds run, the bleed's whole length to its full size: ragged, red at its
      // heart over its dark, the older blood drying darker rather than fading to mud.
      const secs = GUT.secs ?? 8;
      const grow = clamp(age / secs);
      bloodPool(k, b, 0.1 + 0.18 * grow, a, grow * 0.6);
    } },
  },
};

/** A pool of blood on the ground round `c`, `r` tiles at most: three or four lobes run together, a red heart over its dark. */
function bloodPool(k: FxScene, c: { x: number; y: number }, r: number, alpha: number, dried: number): void {
  if (alpha <= 0.01 || r <= 0.01) return;
  const outer: number[][] = [], inner: number[][] = [];
  const lobes = 4;
  for (let i = 0; i < lobes; i++) {
    const h = hashOf(k.seed, 20 + i), ang = (i / lobes) * TAU + h * 1.2;
    const off = r * (i === 0 ? 0 : 0.45 + 0.2 * h), lr = r * (i === 0 ? 0.7 : 0.42 + 0.18 * hashOf(k.seed, 30 + i));
    const cx = c.x + Math.cos(ang) * off, cy = c.y + Math.sin(ang) * off * 0.8;
    const o: number[] = [], n: number[] = [];
    for (let j = 0; j < 7; j++) {
      const a = (j / 7) * TAU + h;
      const wob = 0.85 + 0.3 * hashOf(k.seed, 40 + i * 7 + j);
      o.push(cx + Math.cos(a) * lr * wob, cy + Math.sin(a) * lr * wob);
      n.push(cx + Math.cos(a) * lr * wob * 0.55, cy + Math.sin(a) * lr * wob * 0.55);
    }
    outer.push(o);
    inner.push(n);
  }
  k.groundShape(c.x, c.y, r * 1.6, [
    { kind: 'fill', colour: dry(BLOOD.deep, dried * 0.5), alpha: 0.6 * alpha, paths: outer, lift: 0.08 },
    { kind: 'fill', colour: dry(BLOOD.main, dried), alpha: 0.6 * alpha, paths: inner, lift: 0.09 },
  ]);
}

/* Lick Wounds: the companion gets `heal` of its health back. */
const LICK_TIMING = { secs: 1.5, release: 0.55 };
/** Where through the cast the hand strokes the beast: the first stroke before the release, the second after. */
function lickStrokes(release: number): Array<[number, number]> {
  const top = release * 0.82, down = top * 0.55, through = release + (1 - release) * 0.3;
  return [[down, release], [release, through]];
}

const lickPose: CastPose = (r, t, c) => {
  const b = beats(c);
  const down = b.top * 0.55;
  // Down on one knee before it, the head bent to it and the right hand out low over its back, stroking from the shoulder
  // back along it twice; the left hand on the raised knee. The hand goes as near the beast as a kneeling arm reaches
  // (the body is turned to it), and the strokes in light carry the rest of the way when it stands further off.
  const pet = c.companion;
  // A beast further off than a kneeling arm reaches is gone to first: a step and a half in to it (at most 0.65 tiles,
  // so the cast stays where it is cast), knelt there, and back again after rising.
  const by = pet ? clamp(pet.ahead - 14, 0, 26) : 0;
  // The hands' places are from where the feet stood, so each is carried on by as far as the step has taken the body.
  const went = by > 0 ? stepIn(r, t, c, { hit: down * 0.9, from: 0.02, back: 0.8, by, most: 26, bend: 14 }) : 0;
  const ahead = (pet ? clamp(pet.ahead - 5 - by, 4.5, 9) : 7) + went, aside = pet ? clamp(pet.aside, -3, 3) : 1;
  // Knelt while the hand strokes, then up again over the last of the cast, unhurried.
  const on = one(t, [[0, 0], [by > 0 ? down * 0.6 : 0, 0], [down, 1], [b.through + 0.04, 1], [by > 0 ? 0.86 : 0.97, 0]]);
  r.kneel = on;
  r.spine = euler(t, [[0, [0, 0, 0]], [down, [-6, 0, 0]], [b.through, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [down, [-18, 0, 4]], [b.let, [-24, 0, 6]], [b.through, [-20, 0, 4]], [1, [0, 0, 0]]]);
  const [[, s1e], [, s2e]] = lickStrokes(c.timing.release);
  const s1 = lerp(down, s1e, 0.5), s2 = lerp(b.let, s2e, 0.5);
  const along = one(t, [[0, 0], [down, 0], [s1, 1], [b.let, 0], [s2, 1], [b.through, 0.4], [1, 0.4]]);
  r.reach = [
    { at: [-2.6, 4.5 + went, 5.6], w: on },
    { at: [aside + lerp(0.8, 0, along), ahead + lerp(1.2, -1.2, along), lerp(4.4, 5.4, along)], w: on, stoop: true },
  ];
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [down, [-24, 0, 0]], [s1, [6, 0, 0]], [b.let, [-24, 0, 0]], [s2, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.shape = [{ flat: on * 0.6 }, { flat: on }];
};

/** The ink of the wild's green. */
const WILD_INK = '#1d3318';

/** A lick over the beast's back, from the side you are on: a tongue of green swept up and over it. */
function lick(k: FxScene, beast: Body, v: number, i: number): void {
  const c = k.at(beast, 0.5);
  const right = sideOf(k, k.caster, beast) > 0;
  const from = right ? Math.PI * 0.92 : Math.PI * 2.08, to = right ? Math.PI * 2.0 : Math.PI * 1.0;
  const rx = Math.max(10, beast.wide * 2.4), ry = beast.tall * HEIGHT_SCALE * 0.42;
  sweep(k, c, rx * (1 - 0.12 * i), ry * (1 - 0.1 * i), from, to, v, { main: WILD.main, core: WILD.core, ink: WILD_INK, width: 3.4 - 0.4 * i, alpha: 0.95 });
}

const lickWounds: SpellVisual = {
  palette: PALETTE,
  cast: { timing: LICK_TIMING, pose: lickPose, face: 'companion' },
  fx: {
    charge: (k, t) => {
      const g = seg(t, 0.25, 0.55);
      k.glow(k.hand(1), 5, 0.6 * g * (1 - seg(t, 0.75, 1)), WILD.light);
      const beast = beastOf(k);
      if (!beast) return;
      k.emit(k.at(beast, 0.3), 6 * g * (1 - seg(t, 0.7, 0.9)), { kind: 'mote', colour: [WILD.core, WILD.main], size: 1.5, life: [0.5, 0.9], speed: [0.02, 0.1], up: [8, 16], gravity: 0, jitter: 0.18 });
      // Each stroke of the hand carried to the beast: a ribbon of green from the hand to its back, and the lick going
      // over it where the ribbon lands -- in one place however far off it stands.
      const hand = k.hand(1), back = k.at(beast, 0.7);
      const gap = Math.hypot(back.x - hand.x, back.y - hand.y);
      lickStrokes(LICK_TIMING.release).forEach(([a0, a1], i) => {
        const v = seg(t, a0, a1);
        if (v <= 0 || v >= 1) return;
        if (gap > 0.12) {
          const head = easeOut(seg(v, 0, 0.45)), tail = easeIn(seg(v, 0.2, 0.6));
          if (head - tail > 0.02) {
            const pts: P3[] = [];
            for (let j = 0; j <= 8; j++) pts.push(arcAt(hand, back, lerp(tail, head, j / 8), 3));
            k.ribbon(pts, { main: WILD.main, core: WILD.core, ink: WILD_INK, width: 2.4, taper: 'both', glow: 0.5 });
          }
        }
        lick(k, beast, seg(v, gap > 0.12 ? 0.35 : 0, 1), i);
      });
    },
    hit: (k) => {
      const beast = beastOf(k);
      if (!beast) return;
      // Few, and rising quickly off its back, so they do not pile up on the lick still going over it.
      k.burst(k.at(beast, 0.75), 5, { kind: 'mote', colour: [WILD.core, WILD.main], size: 1.6, life: [0.5, 1.0], speed: [0.1, 0.35], up: [16, 28], gravity: 0, jitter: 0.14 });
    },
    impact: { secs: 1.3, draw: (k, u) => {
      const beast = beastOf(k);
      if (!beast) return;
      // A last long lick over it once the hand is done, and the mending's light on it fading.
      const v = seg(u, 0.18, 0.62);
      if (v > 0 && v < 1) lick(k, beast, v, 2);
      k.glow(k.at(beast, 0.5), 10 + beast.wide, 0.35 * (1 - seg(u, 0.4, 1)), WILD.light);
      k.light(beast, 1.6, 0.5 * (1 - u), WILD.light);
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

/**
 * The creatures standing within `reach` tiles of a point that are not the
 * beast itself, nearest first and at most eight: who a Snarl or a Guard Me
 * turns, as far as can be seen (the island does not say which it reached).
 */
function turnedOn(k: FxScene, c: { x: number; y: number }, reach: number): Body[] {
  const beast = k.companion;
  return k.bodiesWithin(reach, c, ['creature'])
    .filter((b) => !beast || Math.hypot(b.x - beast.x, b.y - beast.y) > 0.05)
    .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))
    .slice(0, 8);
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
  }
  // Both hands clawed and the lips back with the beast's: a snarl given with it.
  const claw = one(t, [[0, 0], [0.12, 1], [b.through, 1], [1, 0]]);
  r.shape = [{ claw }, { claw }];
  r.mouth = one(t, [[0, 0], [b.top, 0.45], [b.let, 0.9], [b.through, 0.8], [1, 0]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [12, 12, 0]], [b.let, [24, 10, 0]], [b.through, [22, 10, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.top, 26], [b.let, 32], [1, 5]]);
  r.leg[1] = euler(t, [[0, [2, 2, 0]], [b.top, [12, 12, 0]], [b.let, [-6, 12, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.top, 26], [b.let, 20], [1, 5]]);
};

/** The beast's own jaws, on its muzzle, facing the way it faces on the screen: where its snarl is shown. */
function jawsOf(k: FxScene, beast: Body): { at: P3; face: number } {
  const head = k.muzzle(beast);
  const dx = k.sx(head) - k.sx(beast);
  return { at: head, face: Math.abs(dx) > 0.5 ? Math.sign(dx) : sideOf(k, k.caster, beast) };
}

const snarl: SpellVisual = {
  palette: PALETTE,
  // Given with the beast: the handler turns to it and snarls along with it.
  cast: { timing: { secs: 0.9, release: 0.45 }, pose: snarlPose, face: 'companion' },
  fx: {
    charge: (k, t) => {
      // The lips drawn back: the beast's jaws at its head, opening wide as the snarl builds.
      const beast = beastOf(k);
      // The impact's own jaws take over at the release.
      if (!beast || k.released >= 0) return;
      const j = jawsOf(k, beast);
      const a = smooth(seg(t, 0.12, 0.3));
      bite(k, j.at, { size: 7, shut: 1 - easeOut(seg(t, 0.12, 0.4)) * 0.9, face: j.face, alpha: a, turn: -0.1 });
    },
    hit: (k) => {
      const beast = beastOf(k);
      if (!beast) return;
      k.burst(k.at(beast, 0.05), 14, { kind: 'dust', colour: '#8a7a62', size: 3, life: [0.4, 0.8], speed: [0.8, 1.6], up: [2, 6], gravity: 3, drag: 0.1 });
      k.burst(jawsOf(k, beast).at, 8, { kind: 'spark', colour: [IVORY, k.pal.main], size: 1.6, life: [0.2, 0.4], speed: [0.6, 1.4], up: [0, 10], gravity: 20, over: true });
    },
    impact: { secs: 1.25, draw: (k, u) => {
      const beast = beastOf(k);
      if (!beast) return;
      const reach = SNARL.reach ?? 4;
      // The snarl going out: a ring of teeth to exactly its reach, a lighter one behind it, and held there a moment --
      // thin enough to let the bodies at its edge be seen through it.
      const go = easeOut(seg(u, 0, 0.42));
      const held = (1 - seg(u, 0.62, 0.85)) * (1 - 0.2 * seg(u, 0.4, 0.5));
      toothRing(k, beast, 0.2 + (reach - 0.2) * go, { alpha: held, band: 0.07, len: 0.22, turn: u * 0.2, teeth: Math.round(reach * 6) });
      const go2 = easeOut(seg(u, 0.1, 0.5));
      if (go2 > 0 && go2 < 1) k.ring(beast, 0.2 + (reach - 0.2) * go2, { band: 0.04, alpha: 0.5 * (1 - go2), glow: 0.3 });
      // And everything wild inside it turning on the beast: the ones that are there marked and set running at it, and
      // arrowheads in from the rim for the reach of it.
      const inward = seg(u, 0.5, 1);
      if (inward > 0) {
        const list: Chevron[] = [];
        for (const b of turnedOn(k, beast, reach)) {
          const head = k.toward(b, beast);
          const run = easeOut(inward) * Math.min(0.7, Math.hypot(beast.x - b.x, beast.y - b.y) * 0.3);
          list.push({ x: b.x + head.x * (0.3 + run), y: b.y + head.y * (0.3 + run), head, size: 0.3, alpha: bump(inward, 0, 0.12, 1), main: k.pal.core });
          if (inward < 0.35) k.flare(k.at(b, 1.12), 7, 1 - inward / 0.35, k.pal.core, inward * 3, k.pal.light, true);
        }
        const n = k.fast ? 4 : 6;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * TAU + hashOf(k.seed, i) * 0.5;
          const v = clamp(inward * 1.3 - hashOf(k.seed + 1, i) * 0.3);
          const rr = reach * (1 - 0.72 * easeIn(v)) - 0.2;
          list.push({ x: beast.x + Math.cos(ang) * rr, y: beast.y + Math.sin(ang) * rr, head: { x: -Math.cos(ang), y: -Math.sin(ang) }, size: 0.5, alpha: 0.7 * bump(v, 0, 0.2, 1) });
        }
        chevrons(k, beast, reach, list);
      }
      // The jaws snapping shut once, as the snarl goes out, held shut a moment at full strength (a snap seen, not a
      // dimming), and let go.
      const j = jawsOf(k, beast);
      bite(k, j.at, { size: 7, shut: 0.1 + 0.9 * easeIn(seg(u, 0, 0.07)), face: j.face, alpha: 1 - seg(u, 0.2, 0.34), turn: -0.1 });
      k.light(beast, Math.min(reach, 2.5), 0.45 * held);
    } },
  },
};

/* Guard Me: the companion leaps to your side, and every creature within `reach` tiles of you that is hunting you turns on it. */
const GUARD = fxOf('beastmaster_guard_me');
const guardPose: CastPose = (r, t, c) => {
  const b = beats(c);
  // Two slaps on the thigh a beat apart, each with a dip of the knees, the chest and head turned back over the right
  // shoulder to call it; then the left arm out across the front, the stance widened: here, and hold.
  const slaps = [0.1, 0.22];
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [0.05, [32, 22, 0]], [slaps[0], [-8, 14, 0]], [0.16, [32, 22, 0]], [slaps[1], [-8, 14, 0]], [0.3, [-6, 16, 0]], [b.let, [-4, 18, 0]], [b.through, [-4, 18, 0]], [1, [10, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [0.05, 50], [slaps[0], 6], [0.16, 50], [slaps[1], 6], [b.let, 14], [1, 22]]);
  // The slapping hand flat, the guarding one flat and turned out; a shout to it with the slaps.
  r.shape = [{ flat: one(t, [[0, 0], [b.top, 0.4], [b.let, 1], [b.through, 1], [1, 0]]) }, { flat: one(t, [[0, 0], [0.04, 1], [b.through, 1], [1, 0]]) }];
  r.mouth = one(t, [[0, 0], [slaps[0], 0.6], [slaps[1], 0.7], [0.3, 0.5], [b.let, 0.15], [1, 0]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [0.3, [16, 8, 10]], [b.let, [74, 44, -8]], [b.through, [72, 46, -8]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [0.3, 36], [b.let, 8], [b.through, 10], [1, 22]]);
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [b.let, [-50, 0, 0]], [b.through, [-50, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.08, [-2, 0, -40]], [0.3, [-2, 0, -40]], [b.let, [-4, 0, 6]], [b.through, [-4, 0, 6]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.08, [0, 0, -24]], [0.3, [0, 0, -24]], [b.let, [-2, 0, 10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [slaps[0], [-7, 0, -4]], [0.16, [-2, 0, -4]], [slaps[1], [-8, 0, -4]], [0.3, [-3, 0, 0]], [b.let, [-6, 0, 0]], [1, [0, 0, 0]]]);
  for (let s = 0; s < 2; s++) {
    r.leg[s] = euler(t, [[0, [2, 2, 0]], [0.3, [4, 5, 0]], [b.let, [8, 13, 0]], [b.through, [8, 13, 0]], [1, [2, 2, 0]]]);
    r.knee[s] = one(t, [[0, 4], [0.05, 6], [slaps[0], 18], [0.16, 8], [slaps[1], 20], [0.3, 10], [b.let, 22], [b.through, 20], [1, 4]]);
  }
};

/** Where a companion called to its keeper's side comes from when it is not known: off behind them. */
const behindKeeper = (k: FxScene): P3 => k.local(k.caster, -40, -70, 0);

/** Where the companion lands at its keeper's side: a step off to the left and a little behind, where the stage draws it. */
const sideOfKeeper = (k: FxScene): P3 => k.local(k.caster, -30, -8, 0);

const GUARD_TIMING = { secs: 1.0, release: 0.42 };
const GUARD_LANDS = 0.8;

const guardMe: SpellVisual = {
  palette: PALETTE,
  // The real companion carried from where it stood to your side over the leap, and put beside you rather than in you.
  cast: { timing: GUARD_TIMING, pose: guardPose, companion: { from: GUARD_TIMING.release, to: GUARD_LANDS } },
  fx: {
    charge: (k, t) => {
      // Each slap a pop of sound at the thigh, lit, and a puff off the leg.
      [0.1, 0.22].forEach((at, i) => {
        const v = seg(t, at, at + 0.16);
        if (v > 0 && v < 1) howl(k, k.hand(1), Math.PI + (k.caster.facing >= 4 ? 0.3 : -0.3), v, { n: 2, reach: 11, span: 0.55, width: 1.8, alpha: 0.9, glow: 0.6 });
        if (t >= at && k.state[`slap${i}`] === undefined) {
          k.state[`slap${i}`] = 1;
          k.burst(k.hand(1), 3, { kind: 'dust', colour: '#a08a68', size: 2.2, life: [0.25, 0.45], speed: [0.2, 0.5], up: [2, 6], gravity: 2 });
        }
      });
      leapFrom(k, k.caster, 0.3, behindKeeper);
    },
    travel: { secs: () => (GUARD_LANDS - GUARD_TIMING.release) * GUARD_TIMING.secs, draw: (k, u) => {
      const from = leapFrom(k, k.caster, 0.3, behindKeeper), to = sideOfKeeper(k);
      // Round the real beast as the stage carries it in; not seeing it, from behind you to your side.
      if (k.companion) {
        rideLeap(k, k.companion, from, u, 0.95);
        return;
      }
      const tiles = Math.hypot(to.x - from.x, to.y - from.y);
      leapAlong(k, (v) => arcAt(from, { ...to, z: to.z + 5 }, clamp(v), 4 + Math.min(4, tiles) * 3), smooth(u), 0.9);
    } },
    hit: (k) => {
      const at = sideOfKeeper(k);
      k.burst(at, 12, { kind: 'dust', colour: '#8a7a62', size: 3, life: [0.4, 0.8], speed: [0.3, 0.8], up: [2, 8], gravity: 3, drag: 0.15 });
    },
    impact: { secs: 1.4, draw: (k, u) => {
      const reach = GUARD.reach ?? 6;
      const c = k.caster;
      // Everything hunting you within its reach called in: the reach drawn as a ring of arrowheads pointing in, closing on
      // you and the beast -- arrows are Guard Me's, as the ring of teeth is Snarl's -- on a thin line that keeps them one
      // ring however far apart they stand.
      const pull = easeIn(seg(u, 0.1, 0.85));
      const r = reach * (1 - 0.82 * pull);
      const ring = smooth(u / 0.1) * (1 - seg(u, 0.75, 0.95));
      k.ring(c, r, { band: 0.035, alpha: 0.55 * ring, glow: 0.3 });
      const list: Chevron[] = [];
      const n = k.fast ? 12 : 16;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + 0.2 - u * 0.4;
        list.push({ x: c.x + Math.cos(ang) * (r + 0.05), y: c.y + Math.sin(ang) * (r + 0.05), head: { x: -Math.cos(ang), y: -Math.sin(ang) }, size: 0.34 + 0.08 * (1 - pull), alpha: ring, main: k.pal.main });
      }
      const side = sideOfKeeper(k);
      for (const b of turnedOn(k, c, reach)) {
        const d = Math.hypot(b.x - c.x, b.y - c.y);
        const reached = seg(u, 0.1 + 0.75 * (1 - d / reach) - 0.05, 0.1 + 0.75 * (1 - d / reach) + 0.1);
        if (reached <= 0) continue;
        const head = k.toward(b, side);
        list.push({ x: b.x + head.x * (0.3 + 0.4 * easeOut(reached)), y: b.y + head.y * (0.3 + 0.4 * easeOut(reached)), head, size: 0.45, alpha: 1 - seg(u, 0.85, 1), main: k.pal.core });
        if (reached < 1) k.flare(k.at(b, 1.12), 7, 1 - reached, k.pal.core, reached * 3, k.pal.light, true);
      }
      chevrons(k, c, reach, list);
      // The line it holds: a crescent of teeth on the ground before you both, facing out -- turned from straight ahead
      // toward the side the beast stands on and set out past it, so the beast stands at the line it holds.
      const face = k.facingDir(c);
      const fa = Math.atan2(face.y, face.x);
      const sa = Math.atan2(side.y - c.y, side.x - c.x);
      const toward = Math.atan2(Math.sin(sa - fa), Math.cos(sa - fa));
      const mid = fa + Math.sign(toward) * Math.min(0.6, Math.abs(toward));
      const wall = smooth(seg(u, 0, 0.18)) * (1 - seg(u, 0.75, 1));
      toothRing(k, c, 1.0, { from: mid - 1.2, to: mid + 1.2, out: true, teeth: 9, len: 0.16, band: 0.07, alpha: wall, glow: 0.6 });
      k.light(c, 1.6, 0.5 * wall, '#fff1d6');
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
  // A grunt at each blow on the chest, a roar with the fist.
  r.mouth = one(t, [[0, 0], [0.18, 0.35], [0.24, 0.1], [0.32, 0.35], [b.top, 0.2], [b.let, 0.95], [b.through, 0.8], [1, 0]]);
  for (let s = 0; s < 2; s++) {
    r.leg[s] = euler(t, [[0, [2, 2, 0]], [b.top, [10, 6, 0]], [b.let, [4, 9, 0]], [1, [2, 2, 0]]]);
    r.knee[s] = one(t, [[0, 4], [b.top, 22], [b.let, 8], [1, 4]]);
  }
};

const bloodlust: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.25, release: 0.55 }, pose: lustPose, face: 'companion' },
  fx: {
    charge: (k, t) => {
      // A heartbeat at each blow on the chest.
      for (const at of [0.18, 0.32]) k.glow(k.chest(), 7, 0.8 * bump(t, at - 0.02, at, at + 0.1), BLOOD.light);
      k.glow(k.hand(1), 5, 0.7 * bump(t, 0.4, 0.55, 0.7), BLOOD.light);
    },
    release: (k) => k.burst(k.hand(1), 10, { kind: 'ember', colour: [BLOOD.core, BLOOD.light], size: 1.8, life: [0.3, 0.6], speed: [0.1, 0.5], up: [10, 30], gravity: 10, over: true }),
    // The blood going to it: a red thread from the raised fist to the beast.
    travel: { secs: () => 0.22, draw: (k, u) => {
      const beast = beastOf(k);
      if (!beast) return;
      const from = k.hand(1), to = k.at(beast, 0.6);
      const pts: P3[] = [];
      for (let i = 5; i >= 0; i--) pts.push(arcAt(from, to, clamp(u - i * 0.06), 8));
      k.ribbon(pts, { main: BLOOD.main, core: BLOOD.core, ink: BLOOD.deep, width: 3, taper: 'start', glow: 0.6 });
    } },
    hit: (k) => {
      const beast = beastOf(k);
      if (!beast) return;
      k.burst(k.at(beast, 0.6), 16, { kind: 'ember', colour: [BLOOD.core, BLOOD.light, BLOOD.main], size: 1.8, life: [0.3, 0.7], speed: [0.2, 0.6], up: [6, 20], gravity: 10, over: true });
    },
    impact: { secs: 0.7, draw: (k, u) => {
      const beast = beastOf(k);
      if (!beast) return;
      // The blood reaching it: the whole beast flushed red at once, and a low ruff of hackles thrown up over its shoulders.
      k.tint(beast, { colour: BLOOD.main, share: 0.6 * flashOf(u, 0.12) });
      const len = lustCrest(beast) * (1 + 0.5 * flashOf(u, 0.15));
      crest(k, beast, { len, alpha: flashOf(u, 0.1) * 0.95, beat: 1.2, t: k.now, main: BLOOD.main, core: BLOOD.core, light: BLOOD.light, n: 3, span: 0.3 });
      k.light(beast, 1.6, 0.6 * (1 - u), BLOOD.light);
    } },
    // For its seconds: the beast's own body flushing red on a heartbeat (1.2 a second) -- the flush fainter as the seconds
    // run out, so a glance says how much is left -- and the low ruff kept up over its shoulders; a drop of blood now and
    // then. Primal Fury's mark is a crest of gold claws the length of the back; this is the beast itself going red.
    linger: { draw: (k, age, left) => {
      const beast = beastOf(k);
      if (!beast) return;
      const a = smooth(age / 0.5) * smooth(left / 1);
      const beat = Math.pow(Math.max(0, Math.sin(age * 1.2 * TAU)), 3);
      const remains = clamp(left / Math.max(1, age + left));
      k.tint(beast, { colour: BLOOD.main, share: a * (0.24 + 0.3 * beat) * (0.45 + 0.55 * remains) });
      crest(k, beast, { len: lustCrest(beast) * (0.5 + 0.5 * remains) * (0.85 + 0.25 * beat), alpha: a * (0.7 + 0.25 * beat), beat: 0, t: age, main: BLOOD.main, core: BLOOD.core, light: BLOOD.light, n: 3, span: 0.3 });
      k.light(beast, 1.4, 0.3 * a * (0.6 + 0.4 * beat), BLOOD.light);
      if (!k.fast) k.emit(k.at(beast, 0.65), 2 * a, { kind: 'drop', colour: [BLOOD.main, BLOOD.deep], size: 1.6, life: [0.4, 0.6], speed: [0.02, 0.08], up: [0, 2], gravity: 50, jitter: 0.1 });
    } },
  },
};

/** How tall Bloodlust's crest stands on a beast, in height units: by how much it adds to the blows (`more`), at most nearly half its height. */
const lustCrest = (b: Body): number => b.tall * Math.min(0.45, 0.9 * ((LUST.more ?? 1.4) - 1));
/** Primal Fury's, the same way: its blows grow more, so its claws stand taller. */
const furyCrest = (b: Body): number => b.tall * Math.min(0.5, 0.9 * ((FURY.more ?? 1.75) - 1));

/* Primal Fury: for `secs` seconds the companion's blows are `more` times as large and come `quick` times as often. */
const FURY = fxOf('beastmaster_primal_fury');
/** Primal Fury's impact, seconds. */
const FURY_IMPACT = 1.3;
const FURY_GOLD = { main: '#f0a030', core: '#fff3c2', deep: '#8a4a12', light: '#ffb84a' };
const furyPose: CastPose = (r, t, c) => {
  const b = beats(c);
  // Gathered in low, arms crossed; then thrown open, up and wide, the head back: a roar from the whole body, shaking with it.
  // A tremble building through the gather, then the shake of the roar dying away after it.
  const gather = t > 0.2 && t <= b.let ? Math.sin(t * 140) * 2 * seg(t, 0.2, b.let) : 0;
  const shake = gather + (t > b.let && t < b.through + 0.1 ? Math.sin(t * 160) * 2.5 * (1 - seg(t, b.let, b.through + 0.1)) : 0);
  for (let s = 0; s < 2; s++) {
    r.arm[s] = euler(t, [[0, [10, 10, 0]], [b.top, [62, -28, 40]], [b.let, [150, 60, -10]], [b.through, [146, 62, -10]], [b.through + 0.15, [140, 60, -10]], [1, [12, 10, 0]]]);
    r.elbow[s] = one(t, [[0, 20], [b.top, 126], [b.let, 10], [b.through, 14], [1, 22]]);
    r.leg[s] = euler(t, [[0, [2, 2, 0]], [b.top, [26, 10, 0]], [b.let, [6, 18, 0]], [b.through + 0.15, [6, 18, 0]], [1, [2, 2, 0]]]);
    r.knee[s] = one(t, [[0, 4], [b.top, 64], [b.let, 16], [b.through + 0.15, 18], [1, 4]]);
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-24, 0, 0]], [b.let, [8, 0, 0]], [b.through + 0.15, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-10, 0, 0]], [b.let, [16, 0, 0]], [b.through + 0.15, [12, 0, 0]], [1, [0, 0, 0]]]);
  r.chest[1] += shake;
  r.spine[1] += gather * 0.5;
  // Fists in the crouch, thrown open into claws with the roar.
  const claw = one(t, [[0, 0], [b.let - 0.06, 0], [b.let, 1], [b.through + 0.15, 1], [1, 0]]);
  r.shape = [{ claw }, { claw }];
  r.mouth = one(t, [[0, 0], [b.top, 0.15], [b.let, 1], [b.through + 0.15, 0.9], [1, 0]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-22, 0, 0]], [b.let, [30, 0, 0]], [b.through + 0.15, [24, 0, 0]], [1, [0, 0, 0]]]);
};

const primalFury: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.8, release: 0.5 }, pose: furyPose, face: 'companion' },
  fx: {
    charge: (k, t) => {
      // The ground trembling under the crouch, the light drawn in to the body.
      const g = seg(t, 0.05, 0.48);
      if (!k.fast) k.emit(k.at(k.caster, 0.02), 16 * g, { kind: 'dust', colour: '#8a7a62', size: 2, life: [0.3, 0.6], speed: [0.05, 0.2], up: [1, 4], gravity: 2, jitter: 0.5 });
      k.emit(k.at(k.caster, 0.5), 30 * g, { kind: 'mote', colour: [FURY_GOLD.core, FURY_GOLD.main], size: 1.6, life: [0.3, 0.5], speed: [-1.4, -0.8], up: [-4, 4], gravity: 0, jitter: 0.9, drag: 0.6, over: true });
      k.glow(k.chest(), 8, 0.7 * g, FURY_GOLD.light);
    },
    hit: (k) => {
      k.flash(0.12, FURY_GOLD.light);
      k.burst(k.at(k.caster, 0.05), 14, { kind: 'dust', colour: '#8a7a62', size: 3.2, life: [0.5, 0.9], speed: [1.0, 1.8], up: [2, 8], gravity: 3, drag: 0.1 });
    },
    impact: { secs: FURY_IMPACT, draw: (k, u) => {
      // The roar: arcs going out to both sides of the head, and the shock in the ground, out far enough to reach the beast,
      // held bright until it has.
      const roar = seg(u, 0, 0.55);
      for (const ang of [-0.4, -Math.PI + 0.4]) howl(k, k.head(), ang, roar, { n: 3, reach: 22, span: 0.8, width: 2, main: FURY_GOLD.main, light: FURY_GOLD.light });
      const beast = beastOf(k);
      const out = beast ? Math.max(1.5, Math.hypot(beast.x - k.caster.x, beast.y - k.caster.y) + 0.3) : 1.5;
      const arrive = beast ? furyArrive(k, beast) : 0.2;
      const r = 0.2 + (out - 0.2) * easeOut(seg(u, 0, 0.5));
      k.ring(k.caster, r, { band: 0.18 * (1 - u), alpha: 0.9 * (1 - seg(u, arrive + 0.1, arrive + 0.4)), main: FURY_GOLD.main, deep: FURY_GOLD.deep, glow: 0.6 });
      k.light(k.caster, 2, 0.7 * (1 - u), FURY_GOLD.light);
      if (!beast || u < arrive) return;
      // On the beast, once the shock has reached it and not before: the earth torn round it in three claw-gouges, gold
      // flying off it, and (the linger) its crest of claws thrown up.
      if (k.state.reached === undefined) {
        k.state.reached = 1;
        k.burst(k.at(beast, 0.6), 40, { kind: 'ember', colour: [FURY_GOLD.core, FURY_GOLD.main, FURY_GOLD.light], size: 2, life: [0.4, 0.9], speed: [0.3, 1.0], up: [10, 34], gravity: 6, over: true });
      }
      const fade = 1 - seg(u, 0.75, 1);
      for (let i = 0; i < 3; i++) {
        const ang = [0.5, 2.6, 4.3][i] + hashOf(k.seed, i) * 0.5;
        const rr = 0.42 + 0.08 * hashOf(k.seed + 2, i);
        const dir = { x: Math.cos(ang + 0.5), y: Math.sin(ang + 0.5) };
        const x = beast.x + Math.cos(ang) * rr, y = beast.y + Math.sin(ang) * rr;
        const torn = easeOut(seg(u, arrive + i * 0.03, arrive + 0.12 + i * 0.03));
        // Torn earth: a dark scuff under each, the furrows in it.
        k.scorch({ x, y }, 0.12 * torn, { colour: '#2e2014', alpha: 0.6 * fade });
        gouge(k, x, y, dir, 0.28, 0.9 * fade, 3, torn, FURY_GOLD.main);
      }
      k.light(beast, 1.8, 0.9 * (1 - seg(u, arrive, 1) * 0.6), FURY_GOLD.light);
    } },
    // For its seconds, from the moment the shock reaches the beast: the gold crest of claws thrown up along its back with
    // a surge and kept up, beating `quick` times as fast as Bloodlust's heart -- sparks off it rising -- and the claws
    // drawing in as the seconds run out.
    linger: { draw: (k, age, left) => {
      const beast = beastOf(k);
      if (!beast) return;
      const at = furyArrive(k, beast) * FURY_IMPACT;
      if (age < at) return;
      const since = age - at;
      const a = smooth(since / 0.08) * smooth(left / 1);
      const remains = 0.5 + 0.5 * clamp(left / Math.max(1, age + left));
      const surge = 1 + 0.4 * flashOf(clamp(since / 0.9), 0.12);
      crest(k, beast, { len: furyCrest(beast) * remains * surge, alpha: a * (0.85 + 0.1 * flashOf(clamp(since / 0.6), 0.1)), beat: 1.2 * (FURY.quick ?? 1.5), t: age, main: FURY_GOLD.main, core: FURY_GOLD.core, light: FURY_GOLD.light, n: 5, claws: true });
      k.emit(k.at(beast, 0.6), 7 * a, { kind: 'spark', colour: [FURY_GOLD.core, FURY_GOLD.light], size: 1.5, life: [0.25, 0.5], speed: [0.1, 0.4], up: [16, 30], gravity: 0, jitter: 0.12, over: true });
      // Its own light only once the impact's two are out, so the cast keeps to two lights.
      k.light(beast, 1.6, 0.35 * a * smooth((age - FURY_IMPACT) / 0.3), FURY_GOLD.light);
    } },
  },
};

/**
 * When Primal Fury's shock in the ground reaches the beast, as a share of the impact: where the ring's radius,
 * `0.2 + (out - 0.2) * easeOut(u / 0.5)`, comes to the beast's distance. Nothing shows on the beast before then.
 */
function furyArrive(k: FxScene, beast: Body): number {
  const d = Math.hypot(beast.x - k.caster.x, beast.y - k.caster.y);
  const out = Math.max(1.5, d + 0.3);
  const want = clamp((d - 0.2) / (out - 0.2));
  return 0.5 * (1 - Math.cbrt(1 - want));
}

/* Vengeance: for `secs` seconds every creature that lands a blow on you is struck back by the companion at `more` of its blow, within `reach` tiles of it. */
const VENGE = fxOf('beastmaster_vengeance');
const vengePose: CastPose = (r, t, c) => {
  const b = beats(c);
  const vow = b.top * 0.6;
  // A fist struck on the heart -- a vow -- the body bowing into it on bent knees; then up, and the arm drawn out wide and
  // low with the weight going out onto the right foot: this far, and no further.
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [vow * 0.7, [70, -8, 30]], [vow, [58, -14, 36]], [b.top, [56, -14, 36]], [b.let, [46, 72, -10]], [b.through, [40, 76, -10]], [1, [12, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [vow * 0.7, 120], [vow, 140], [b.top, 142], [b.let, 6], [b.through, 8], [1, 22]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.let, [-20, 0, -40]], [1, [0, 0, 0]]]);
  // The fist on the heart opened flat as the arm goes out: the line drawn with the edge of the hand.
  r.shape = [undefined, { flat: one(t, [[0, 0], [b.top, 0], [b.let, 1], [b.through, 1], [1, 0]]) }];
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [vow, [20, 18, 0]], [b.top, [16, 18, 0]], [b.let, [-14, 34, 0]], [b.through, [-12, 34, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [vow, 30], [b.top, 26], [b.let, 12], [1, 22]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [vow, [-14, 0, 8]], [b.top, [-10, 0, 8]], [b.let, [6, 0, -22]], [b.through, [4, 0, -22]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [vow, [-10, 0, 0]], [b.top, [-8, 0, 0]], [b.let, [2, 0, -4]], [b.through, [1, 0, -4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [vow, [-22, 0, 4]], [b.top, [-18, 0, 4]], [b.let, [6, 0, -16]], [b.through, [5, 0, -16]], [1, [0, 0, 0]]]);
  r.leg[1] = euler(t, [[0, [2, 2, 0]], [vow, [4, 4, 0]], [b.let, [6, 20, 0]], [b.through, [6, 20, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [vow, 22], [b.top, 18], [b.let, 20], [1, 4]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [vow, [6, 4, 0]], [b.let, [-4, 6, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [vow, 22], [b.top, 18], [b.let, 10], [1, 4]]);
};

/**
 * A bite going round a body at its chest: the beast's jaws, side-on (`bite`, the group's jaws), facing the way they go
 * round -- whoever strikes it is bitten. Every two seconds they are drawn slowly open and snapped shut, held shut a
 * moment and let go. Behind it when they go behind.
 */
function fangWard(k: FxScene, b: Body, age: number, alpha: number, size = 5, R = Math.max(0.24, (b.wide / 40) * 4.1)): void {
  const an = age * 0.9;
  const bob = Math.sin(age * 2) * 1.2;
  const at = (a: number): P3 => ({ x: b.x + Math.cos(a) * R, y: b.y + Math.sin(a) * R, z: b.z + b.tall * 0.74 + bob });
  const p = at(an);
  const behind = k.eye.worldToScreenY(p.x, p.y, 0) < k.eye.worldToScreenY(b.x, b.y, 0);
  // Facing the way it goes round on the screen; seen end on, the way it last went.
  const dx = k.sx(at(an + 0.2)) - k.sx(p);
  const face = Math.abs(dx) > 0.3 ? Math.sign(dx) : (k.state.face ?? 1);
  k.state.face = face;
  const phase = (age % 2) / 2;
  const shut = phase < 0.78 ? 0.6 * (1 - smooth(phase / 0.78)) : phase < 0.86 ? easeIn(seg(phase, 0.78, 0.84)) : 1 - 0.4 * seg(phase, 0.9, 1);
  k.glow(p, size * 2.6, alpha * (0.4 + 0.3 * shut), k.pal.light);
  bite(k, p, { size, shut, face, alpha, turn: -0.1, bias: behind ? -2 : 2 });
}

const vengeance: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.2, release: 0.55 }, pose: vengePose, face: 'companion' },
  fx: {
    charge: (k, t) => k.glow(k.chest(), 6, 0.7 * bump(t, 0.1, 0.3, 0.6)),
    release: (k) => k.burst(k.chest(), 10, { kind: 'mote', size: 1.8, life: [0.4, 0.7], speed: [0.2, 0.5], up: [2, 10], gravity: 0, over: true }),
    impact: { secs: 1.2, draw: (k, u) => {
      const beast = beastOf(k);
      if (!beast) return;
      // How far the beast answers: its own prints going round it at its reach, one after another, held and let go.
      const reach = VENGE.reach ?? 5;
      // Close enough together (a tile apart) to be a track and so a ring, laid one after another round it over 0.6 s.
      const n = 30, prints: Print[] = [];
      const fade = 1 - seg(u, 0.7, 1);
      for (let i = 0; i < n; i++) {
        const an = (i / n) * TAU + 0.2;
        const at = (i / n) * 0.5;
        const show = smooth(seg(u, at, at + 0.05));
        const side = (i % 2 ? 1 : -1) * 0.07;
        prints.push({ x: beast.x + Math.cos(an) * (reach + side), y: beast.y + Math.sin(an) * (reach + side), head: { x: -Math.sin(an), y: Math.cos(an) }, size: 0.22, alpha: 0.9 * show * fade });
      }
      pawTrack(k, beast, reach, prints, k.pal.main, 0.5 + 0.5 * k.night);
      // A thread between you, for a moment: it is watching you.
      if (u < 0.6) k.string(k.chest(), k.at(beast, 0.7), { sag: 3, alpha: 0.9 * bump(u, 0, 0.15, 0.6), glow: 0.5 });
    } },
    // For its seconds: a bite going round you -- closing in from wide as it is cast, then quietly -- and every few
    // seconds the thread from the beast again, for a moment: still watching.
    linger: { draw: (k, age, left) => {
      const a = smooth(age / 0.25) * smooth(left / 1.2);
      const close = easeOut(clamp(age / 0.6));
      const c = k.caster;
      fangWard(k, c, age * (1 + 2 * (1 - close)), (0.85 + 0.15 * (1 - close)) * a, 5 + 1.2 * (1 - close), Math.max(0.24, (c.wide / 40) * 4.1) * (2.2 - 1.2 * close));
      const beast = beastOf(k);
      const since = (age + 1) % 4;
      if (beast && age > 2 && since < 0.45) k.string(k.at(beast, 0.7), k.chest(), { sag: 3, alpha: 0.4 * a * bump(since, 0, 0.1, 0.45), glow: 0.5 });
      // A little light of its own, so the ward is still there at night.
      k.light(c, 1.2, 0.28 * a);
    } },
  },
};

/* Feral Bond: for `secs` seconds every blow on you or the companion is split between you, `share` to each. */
const BOND = fxOf('beastmaster_feral_bond');
const bondPose: CastPose = (r, t, c) => {
  const b = beats(c);
  // Facing the beast: the right palm on the heart, the left over it; then the right given out to it, palm up and level,
  // while the left keeps the heart.
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [b.top * 0.5, [56, -14, 36]], [b.top, [56, -14, 36]], [b.let, [80, 8, -6]], [b.through, [78, 8, -6]], [0.86, [72, 8, -6]], [1, [12, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [b.top * 0.5, 140], [b.top, 140], [b.let, 12], [b.through, 14], [0.86, 20], [1, 22]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [0, 0, 0]], [b.let, [0, 0, -70]], [b.through, [0, 0, -70]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [b.top * 0.6, [60, -24, 42]], [b.top, [60, -24, 42]], [b.let, [54, -16, 36]], [0.86, [54, -16, 36]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [b.top * 0.6, 132], [b.top, 132], [b.let, 140], [0.86, 140], [1, 22]]);
  const flat = one(t, [[0, 0], [0.08, 1], [0.9, 1], [1, 0]]);
  r.shape = [{ flat }, { flat }];
  r.head = euler(t, [[0, [0, 0, 0]], [b.top * 0.6, [-18, 0, 0]], [b.top, [-18, 0, 0]], [b.let, [-6, 0, 0]], [0.86, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 0]], [b.let, [-2, 0, 4]], [0.86, [-2, 0, 4]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-4, 0, 0]], [b.let, [-5, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.let, [12, 3, 0]], [0.86, [10, 3, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.let, 12], [1, 4]]);
};

/**
 * Where the bond leaves you: between your heart and the hand you hold out to the beast while it is given, then home to
 * the heart as the hand comes down (`k.state.home`, nought to one) -- not left tied to the hip for its seconds.
 */
const heartOf = (k: FxScene): P3 => mid3(k.chest(), k.hand(1), 0.45 * (1 - (k.state.home ?? 0)));

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
  const n = k.fast ? 18 : 22;
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
    const look = strand === 0 ? { main: k.pal.main, core: k.pal.core, ink: k.pal.ink } : { main: WILD.main, core: WILD.core, ink: WILD_INK };
    k.ribbon(pts, { ...look, width, taper: 'none', alpha, glow: 0.45 });
  }
  if (grow >= share) knot(k, along2(a, b, share), a, b, alpha, width, phase);
}

/**
 * The knot the strands are tied in at the share point: two small loops crossing each other, one in each strand's
 * colour, standing up off the line -- a knot, not an orb.
 */
function knot(k: FxScene, p: P3, a: P3, b: P3, alpha: number, width: number, phase: number): void {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l;
  const R = 2 + width * 0.35;
  for (let strand = 0; strand < 2; strand++) {
    const s = strand ? 1 : -1;
    const pts: P3[] = [];
    // A loop in the upright plane along the bond, set off to its own side of the knot and leaning over the other.
    for (let i = 0; i <= 10; i++) {
      const an = (i / 10) * TAU + phase * 0.2;
      const along = (s * 0.45 + Math.cos(an) * 0.75) * R / 40, up = Math.sin(an) * R;
      pts.push({ x: p.x + ux * along - uy * s * 0.02, y: p.y + uy * along + ux * s * 0.02, z: p.z + up });
    }
    const look = strand === 0 ? { main: k.pal.main, core: k.pal.core, ink: k.pal.ink } : { main: WILD.main, core: WILD.core, ink: WILD_INK };
    k.ribbon(pts, { ...look, width: width * 0.9, taper: 'none', alpha, glow: 0.5 });
  }
}

const feralBond: SpellVisual = {
  palette: PALETTE,
  cast: { timing: { secs: 1.6, release: 0.55 }, pose: bondPose, face: 'companion' },
  fx: {
    charge: (k, t) => k.glow(k.chest(), 6, 0.8 * seg(t, 0.15, 0.4) * (1 - seg(t, 0.5, 0.6))),
    // Run out from your heart to the beast's.
    travel: { secs: () => 0.4, draw: (k, u) => {
      const beast = beastOf(k);
      if (beast) braid(k, heartOf(k), k.at(beast, 0.6), easeOut(u), 0.95, k.now * 3);
    } },
    hit: (k) => {
      const beast = beastOf(k);
      if (!beast) return;
      const share = BOND.share ?? 0.5;
      const at = along2(heartOf(k), k.at(beast, 0.6), share);
      k.burst(at, 10, { kind: 'mote', colour: [k.pal.main, WILD.main], size: 2, life: [0.4, 0.8], speed: [0.1, 0.4], up: [4, 14], gravity: 0, over: true });
    },
    impact: { secs: 0.9, draw: (k, u) => {
      const beast = beastOf(k);
      if (!beast) return;
      k.state.home = smooth(seg(u, 0.4, 1));
      const a = heartOf(k), b = k.at(beast, 0.6);
      braid(k, a, b, 1, 0.95, k.now * 3, 2 + 1.2 * flashOf(u, 0.1));
      // A blow's worth of light from each end, meeting at the knot and shared out: how every blow will go -- the flash
      // there split, yours on your side and its on its.
      const share = BOND.share ?? 0.5;
      const v = easeIn(seg(u, 0, 0.45));
      if (v < 1) {
        k.orb(along2(a, b, share * v), 2.2, { alpha: 0.9, sides: 6 });
        k.orb(along2(b, a, (1 - share) * v), 2.2, { alpha: 0.9, sides: 6, main: WILD.main, core: WILD.core });
      } else {
        const r = 7 * (1 - seg(u, 0.45, 0.8));
        k.flare(along2(a, b, share - 0.05), r, 1, k.pal.core, u * 2, k.pal.light, true);
        k.flare(along2(a, b, share + 0.05), r, 1, WILD.core, -u * 2, WILD.light, true);
      }
      k.light(mid3(k.caster, beast, share), 1.6, 0.6 * (1 - u), '#fff1d6');
    } },
    // For its seconds: the braid kept, faint, and now and then the same light running in from each end to the knot.
    linger: { draw: (k, age, left) => {
      k.state.home = 1;
      // Taking over from the impact's braid as it ends, rather than a second braid laid over it.
      const a = smooth(left / 1.2) * smooth((age - 0.75) / 0.2);
      const beast = beastOf(k);
      if (!beast) return;
      const from = heartOf(k), to = k.at(beast, 0.6);
      braid(k, from, to, 1, a * 0.55, age * 1.5, 1.4);
      k.light(along2(from, to, BOND.share ?? 0.5), 1.4, 0.25 * a);
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
  // Cupped round the mouth for the howl; then the right hand flat, palm up, and curled home again for the beckon.
  const cupped = one(t, [[0, 0], [cup, 1], [b.top, 1], [b.let, 0], [1, 0]]);
  const flat = one(t, [[0, 0], [b.top, 0], [b.let, 1], [b.through, 1], [0.88, 0.2], [1, 0]]);
  r.shape = [{ cup: cupped }, { cup: Math.max(cupped, one(t, [[0, 0], [b.through, 0], [0.88, 0.9], [1, 0]])), flat }];
  r.mouth = one(t, [[0, 0], [cup, 0.6], [b.top, 1], [b.let, 0.3], [1, 0]]);
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
      // The howl: one long call up from the cupped hands with the head back -- four short arcs let go one after another,
      // each climbing on its own and tipped the other way from the last, so the call wavers up as a column rather than
      // spreading as rings round one point -- and the breath of it rising off the mouth as mist: the cast's longest
      // stretch has something to see.
      const v = seg(t, 0.15, 0.55);
      const mouth = { ...k.head(), z: k.head().z + 1 };
      if (v > 0 && v < 1) {
        for (let i = 0; i < 4; i++) {
          const w = seg(v, i * 0.17, i * 0.17 + 0.5);
          if (w <= 0 || w >= 1) continue;
          const lean = (i % 2 ? 1 : -1) * 0.45;
          const at = { ...mouth, z: mouth.z + 3 + easeOut(w) * 22 };
          howl(k, at, -Math.PI / 2 + lean, w, { n: 1, reach: 11, span: 0.75, width: 2.4, alpha: 1, glow: 0.6 });
        }
        if (!k.fast || v < 0.5) k.emit(mouth, 10, { kind: 'mist', colour: '#e8e2d0', size: 1.6, sizeEnd: 4, life: [0.5, 0.8], speed: [0.02, 0.08], up: [10, 18], gravity: -2, drag: 0.3, jitter: 0.03 });
      }
      k.glow(k.head(), 6, 0.6 * bump(t, 0.15, 0.4, 0.58), WILD.light);
    },
    // The call carried to it: the beast in light, small, loping over the ground from you to the creature.
    travel: { secs: (tiles) => 0.25 + tiles * 0.09, draw: (k, u) => {
      const from = k.caster, to = k.target;
      const g = clamp(u);
      const x = lerp(from.x, to.x, g), y = lerp(from.y, to.y, g);
      // Bounding: up and down three or four times on the way, nose first.
      const bounds = Math.max(2, Math.round(k.dist * 1.2));
      const hop = Math.abs(Math.sin(Math.PI * g * bounds));
      const p = k.on(x, y, 5 + hop * 6);
      const ahead = k.on(lerp(from.x, to.x, Math.min(1, g + 0.05)), lerp(from.y, to.y, Math.min(1, g + 0.05)), 5);
      const a = smooth(g / 0.12) * (1 - smooth((g - 0.85) / 0.15));
      spirit(k, p, screenAngle(k, p, ahead) - 0.25 * Math.cos(Math.PI * g * bounds) * Math.sign(k.sx(ahead) - k.sx(p) || 1), 8, a, 3);
      k.disc(k.on(x, y), 0.1, { main: '#1c140c', alpha: 0.3 * a, n: 8 });
      k.light(p, 1.2, 0.5 * a, WILD.light);
    } },
    hit: (k) => {
      k.burst(k.at(k.target, 0.6), 8, { kind: 'mote', colour: [WILD.core, WILD.main], size: 2, life: [0.5, 1.0], speed: [0.1, 0.4], up: [6, 20], gravity: 0, jitter: 0.15, over: true });
    },
    impact: { secs: 1.6, draw: (k, u) => {
      const b = k.target;
      const prints: Print[] = [];
      // A ring of the wild's prints round it, walking round once: it is caught by the call.
      const R = Math.max(0.3, (b.wide / 40) * 3.6);
      const n = 6;
      const ring = 1 - seg(u, 0.55, 0.8);
      for (let i = 0; i < n; i++) {
        const show = seg(u, i * 0.04, i * 0.04 + 0.1);
        const an = (i / n) * TAU + u * 0.6;
        prints.push({ x: b.x + Math.cos(an) * R, y: b.y + Math.sin(an) * R, head: { x: -Math.sin(an), y: Math.cos(an) }, size: 0.15, alpha: 0.85 * show * ring });
      }
      // And its prints leading off from it to you: it follows.
      const toward = k.toward(b, k.caster);
      const steps = Math.min(6, Math.max(2, Math.floor(k.dist / 0.45)));
      for (let i = 0; i < steps; i++) {
        const show = seg(u, 0.5 + i * 0.05, 0.56 + i * 0.05) * (1 - seg(u, 0.85, 1));
        const d = 0.45 + i * 0.4;
        const side = (i % 2 ? 1 : -1) * 0.08;
        prints.push({ x: b.x + toward.x * d - toward.y * side, y: b.y + toward.y * d + toward.x * side, head: toward, size: 0.14, alpha: 0.9 * show });
      }
      pawTrack(k, b, Math.max(R, 0.45 + steps * 0.4), prints, WILD.main, 0.6 * k.night, WILD.light);
      // The sign of a tame popped up over it on the call's arrival, springing and settling: it is yours.
      const sign = seg(u, 0, 0.2);
      const bob = Math.sin(u * 9) * 0.6 * (1 - u);
      // Never smaller on the screen than at zoom three, so its toes read at play size before its light does.
      pawSign(k, { ...k.at(b, 1), z: b.z + b.tall + 6 + bob }, 7 * Math.max(1, 3 / k.zoom) * easeBack(sign), smooth(sign * 3) * (1 - seg(u, 0.82, 1)));
      if (sign > 0 && sign < 0.4) k.flare(k.at(b, 1.2), 7, 0.7 * (1 - sign / 0.4), k.pal.core, 0, k.pal.light, true);
      k.light(b, 1.6, 0.6 * (1 - u), WILD.light);
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
