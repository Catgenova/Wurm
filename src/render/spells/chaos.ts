/**
 * Chaos's spells: how each is cast and what it looks like.
 *
 * Chaos is asked, never commanded: every cast here is a prayer said with the
 * body -- whispered into the fingers, paid for out of an opened palm, knelt
 * for -- and what answers it comes up out of the ground or tears through the
 * air rather than flying out of a fist. So that a Chaos priest is one across
 * a field before anything lands, the group keeps one look throughout:
 *
 *   - violet and near black for what the patron sends, a sick green at its
 *     points and edges (the arrowheads of its star, an eye's iris, a rune);
 *   - blood, a colour of this file's own, wherever a spell is paid for in
 *     health (Blood Price, Pact, Blood Feast, Undying) or takes it (Hex,
 *     Plague, Siphon, Soul Rend);
 *   - crooked shapes: the eight-armed star drawn by a shaking hand, thorns,
 *     jagged tears in the air, a slit-pupilled eye;
 *   - and under whatever lasts, a thin crooked band on the ground that empties
 *     as the seconds go, so how long is left can be read at a glance.
 *
 * Every size and time is read off the spell's own numbers (`k.fx`,
 * `spellInfo`): a ring reaches what the spell reaches, a bleed ticks once a
 * second for its seconds.
 */
import type { CastPose, SpellVisual } from './index';
import { spellInfo } from './info';
import {
  arcAt, bump, clamp, easeIn, easeOut, flashOf, hashOf, lerp, mid3, mixColour, seg, smooth, TAU,
  nearSegments, type FxScene, type GroundLayer, type P3, type SpellPalette,
} from './kit';
import { euler, one } from './poses';
import type { HandGoal, V3 } from '../figure';
import { UNITS_PER_TILE } from '../iso';

/** Ruin: violet and black, with a sick green. */
export const PALETTE: SpellPalette = {
  core: '#f0c8ff',
  main: '#a64dd6',
  deep: '#4a1a6e',
  accent: '#7dff6a',
  ink: '#1c0828',
  light: '#b45cff',
};

/** Blood: what the bargains are paid in and what the curses take. Darker than a wound's red, so it sits with the violet. */
const BLOOD = '#b0182e';
const BLOOD_DEEP = '#5c0a1c';
const BLOOD_CORE = '#ff7a86';
/** Plague's sickness: a bilious yellow-green over a bruised blight that shows on grass as well as on bare earth. */
const ROT = '#a8d23a';
const ROT_DEEP = '#3a2a3e';
/** A soul torn out, a ghost: pale, a little green. */
const SOUL = '#e6ffe9';
/** What a thing being unmade is made of, before it is not: plain wood and iron. */
const STUFF = ['#8a6a44', '#6c7078', '#a88a5c'];

const bloodLook = { main: BLOOD, deep: BLOOD_DEEP, core: BLOOD_CORE } as const;

/* ---- numbers off the rules ------------------------------------------------------------- */

/** A spell's area, from the rules: its radius, or its reach. */
const radiusOf = (id: string): number => spellInfo(id)?.radius ?? 0;
/** How long a spell's effect lasts, from the rules. */
const lastsOf = (id: string): number => spellInfo(id)?.lasts ?? 0;

/* ---- shapes of the patron's own ---------------------------------------------------------- */

/** Within `reach` tiles of the band between `r0` and `r1` round a point: the `keep` of a mark that is a hoop or a patch on the ground. */
const inBand = (cx: number, cy: number, r0: number, r1: number) => (x: number, y: number, reach: number): boolean => {
  const d = Math.hypot(x - cx, y - cy);
  return d >= r0 - reach && d <= r1 + reach;
};

/**
 * The patron's seal on the ground: eight arrows out of a hub, violet shafts
 * with green heads, each a little off its eighth and its own length, as a
 * shaking hand would draw it. `grow` draws the arms out from the hub.
 */
function chaosStar(k: FxScene, c: { x: number; y: number }, r: number, o: { grow?: number; turn?: number; alpha?: number; glow?: number } = {}): void {
  const a = o.alpha ?? 1, grow = clamp(o.grow ?? 1);
  if (a <= 0.01 || grow <= 0 || r <= 0.05) return;
  const turn = o.turn ?? 0, hub = Math.min(0.5, r * 0.15), w = Math.min(0.045, Math.max(0.016, r * 0.016));
  const shafts: number[][] = [], heads: number[][] = [], spokes: number[] = [];
  for (let i = 0; i < 8; i++) {
    const ang = turn + (i / 8) * TAU + (hashOf(k.seed, i) - 0.5) * 0.16;
    const len = r * (0.84 + 0.16 * hashOf(k.seed + 1, i));
    const u = easeOut(clamp(grow * 1.35 - 0.35 * hashOf(k.seed + 2, i)));
    if (u <= 0.02) continue;
    const tip = hub + (len - hub) * u, hd = Math.min(0.28, r * 0.1, (tip - hub) * 0.5);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const at = (along: number, side: number, out: number[]): void => { out.push(c.x + ca * along - sa * side, c.y + sa * along + ca * side); };
    const shaft: number[] = [], head: number[] = [];
    at(hub, -w, shaft); at(tip - hd * 0.8, -w * 0.7, shaft); at(tip - hd * 0.8, w * 0.7, shaft); at(hub, w, shaft);
    at(tip - hd, -w * 2.8, head); at(tip, 0, head); at(tip - hd, w * 2.8, head);
    shafts.push(shaft); heads.push(head);
    spokes.push(c.x + ca * hub, c.y + sa * hub, c.x + ca * tip, c.y + sa * tip);
  }
  const inkW = Math.max(0.8, 0.7 * k.zoom), A = clamp(a), fat = w * 2.8 + 0.05;
  k.groundShape(c.x, c.y, r + 0.5, [
    { kind: 'fill', colour: k.pal.main, alpha: A, paths: shafts, lift: 0.15 },
    { kind: 'stroke', colour: k.pal.ink, alpha: A, width: inkW, paths: shafts, closed: true, join: 'miter', lift: 0.15 },
    { kind: 'fill', colour: k.pal.accent, alpha: A, paths: heads, lift: 0.16 },
    { kind: 'stroke', colour: k.pal.ink, alpha: A, width: inkW, paths: heads, closed: true, join: 'miter', lift: 0.16 },
  ], (x, y, reach) => nearSegments(spokes, x, y, reach + fat));
  k.ring(c, hub, { band: hub * 0.4, alpha: a * smooth(grow * 3), turn: -turn, glow: o.glow ?? 0.6, dash: 0 });
}

/**
 * A crooked band on the ground that empties as what it stands under runs
 * out: `left` nought to one of it still to go, gone clockwise from the top.
 * Every Chaos spell that lasts has one, so how long is left reads the same
 * on all of them.
 */
function timeArc(k: FxScene, c: { x: number; y: number }, r: number, left: number, o: { alpha?: number; band?: number; main?: string } = {}): void {
  const a = o.alpha ?? 0.8;
  const f = clamp(left);
  if (a <= 0.01 || f <= 0.005 || r <= 0.05) return;
  const band = o.band ?? Math.max(0.025, r * 0.045);
  const n = Math.max(3, Math.ceil(Math.max(24, k.facets(r, 48)) * f));
  const outer: number[] = [], inner: number[] = [];
  const start = -Math.PI * 0.75;
  for (let i = 0; i <= n; i++) {
    const an = start + (i / n) * f * TAU;
    // Crooked: the band wanders in and out by a hair, as everything of the patron's does.
    const wob = 1 + 0.015 * Math.sin(an * 7 + k.seed);
    outer.push(c.x + Math.cos(an) * r * wob, c.y + Math.sin(an) * r * wob);
    inner.push(c.x + Math.cos(an) * (r * wob - band), c.y + Math.sin(an) * (r * wob - band));
  }
  const shape = outer.slice();
  for (let i = n; i >= 0; i--) shape.push(inner[2 * i], inner[2 * i + 1]);
  // The running end, a green notch: where the time is being eaten from.
  const e = 2 * n, notch = [outer[e], outer[e + 1], inner[e], inner[e + 1]];
  const A = clamp(a);
  k.groundShape(c.x, c.y, r + 0.4, [
    { kind: 'fill', colour: o.main ?? k.pal.main, alpha: A, paths: [shape], lift: 0.15 },
    { kind: 'stroke', colour: k.pal.ink, alpha: A, width: Math.max(0.8, 0.6 * k.zoom), paths: [shape], closed: true, join: 'round', lift: 0.15 },
    { kind: 'stroke', colour: k.pal.accent, alpha: A, width: Math.max(1.4, 1.5 * k.zoom), paths: [notch], lift: 0.16 },
  ], inBand(c.x, c.y, r * 0.98 - band, r * 1.02));
}

/**
 * A tear in the air: a jagged slit of the dark between, violet at its lips
 * and green deep inside. `len` height units long, `wide` pixels at zoom one
 * across when `open` is one; `tilt` radians off upright.
 */
function rift(k: FxScene, p: P3, o: { len: number; wide: number; open: number; tilt?: number; alpha?: number; bias?: number }): void {
  const a = o.alpha ?? 1, open = clamp(o.open);
  if (a <= 0.01 || open <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), H = k.hpx(o.len / 2), W = o.wide * k.zoom * open;
  const tilt = o.tilt ?? 0, dx = Math.sin(tilt), dy = -Math.cos(tilt);
  const n = k.fast ? 5 : 8;
  const left: number[] = [], right: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, along = (u * 2 - 1) * H * (0.6 + 0.4 * open);
    const w = W * Math.pow(Math.sin(Math.PI * u), 0.7);
    const jl = 0.6 + 0.7 * hashOf(k.seed + 11, i), jr = 0.6 + 0.7 * hashOf(k.seed + 13, i);
    left.push(x + dx * along - dy * w * jl, y + dy * along + dx * w * jl);
    right.push(x + dx * along + dy * w * jr, y + dy * along - dx * w * jr);
  }
  const ink = k.pal.ink, lip = k.pal.main, inside = k.pal.accent;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    g.beginPath();
    g.moveTo(left[0], left[1]);
    for (let i = 1; i <= n; i++) g.lineTo(left[2 * i], left[2 * i + 1]);
    for (let i = n; i >= 0; i--) g.lineTo(right[2 * i], right[2 * i + 1]);
    g.closePath();
    g.fillStyle = ink;
    g.fill();
    g.lineWidth = Math.max(1.2, 1.4 * k.zoom);
    g.strokeStyle = lip;
    g.stroke();
    // A green seam down the inside, where whatever is beyond shows.
    g.beginPath();
    for (let i = 1; i < n; i++) {
      const mx = (left[2 * i] + right[2 * i]) / 2, my = (left[2 * i + 1] + right[2 * i + 1]) / 2;
      if (i === 1) g.moveTo(mx, my);
      else g.lineTo(mx, my);
    }
    g.lineWidth = Math.max(0.8, 0.6 * k.zoom * open);
    g.strokeStyle = inside;
    g.stroke();
    g.lineJoin = 'round';
  }, o.bias ?? 2);
  k.glow(p, o.wide * 1.6 + o.len * 0.6, a * 0.55 * open);
}

/**
 * An eye of the abyss, open in the air: a faceted almond, the white of it
 * dark violet, a green iris and a slit pupil looking `look` (pixels at zoom
 * one off the middle). `r` pixels at zoom one corner to middle.
 */
function abyssEye(k: FxScene, p: P3, o: { r: number; open: number; look?: { x: number; y: number }; alpha?: number; bias?: number }): void {
  const a = o.alpha ?? 1, open = clamp(o.open);
  if (a <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), R = o.r * k.zoom;
  const up = R * 0.56 * Math.max(0.04, open), down = R * 0.44 * Math.max(0.04, open);
  // Each lid five straight facets, not a curve: the island's shapes are cut, not drawn.
  const lid: number[] = [];
  for (let i = 0; i <= 4; i++) {
    const u = i / 4, s = Math.sin(Math.PI * u);
    lid.push(x - R + 2 * R * u, y - up * s);
  }
  for (let i = 3; i >= 1; i--) {
    const u = i / 4, s = Math.sin(Math.PI * u);
    lid.push(x - R + 2 * R * u, y + down * s);
  }
  const lx = (o.look?.x ?? 0) * k.zoom, ly = (o.look?.y ?? 0) * k.zoom;
  const ir = R * 0.42;
  const deep = k.pal.deep, iris = k.pal.accent, ink = k.pal.ink, lit = k.pal.main;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    const almond = (): void => {
      g.beginPath();
      g.moveTo(lid[0], lid[1]);
      for (let i = 2; i < lid.length; i += 2) g.lineTo(lid[i], lid[i + 1]);
      g.closePath();
    };
    almond();
    g.fillStyle = deep;
    g.fill();
    g.save();
    almond();
    g.clip();
    // The iris a hexagon, its upper-left facets lit; the pupil a black slit.
    const cx = x + lx, cy = y + ly;
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * TAU, a1 = ((i + 1) / 6) * TAU;
      const m = -0.6 * Math.cos((a0 + a1) / 2) - 0.8 * Math.sin((a0 + a1) / 2);
      g.fillStyle = m > 0.2 ? '#c8ffb8' : m > -0.4 ? iris : '#3f9a32';
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a0) * ir, cy + Math.sin(a0) * ir);
      g.lineTo(cx + Math.cos(a1) * ir, cy + Math.sin(a1) * ir);
      g.closePath();
      g.fill();
    }
    g.fillStyle = ink;
    g.beginPath();
    g.moveTo(cx, cy - ir * 0.95);
    g.lineTo(cx + ir * 0.2, cy);
    g.lineTo(cx, cy + ir * 0.95);
    g.lineTo(cx - ir * 0.2, cy);
    g.closePath();
    g.fill();
    g.restore();
    // Heavy lids: the upper one a band of violet over the eye, then the ink round it all.
    g.beginPath();
    g.moveTo(lid[0], lid[1]);
    for (let i = 2; i <= 8; i += 2) g.lineTo(lid[i], lid[i + 1]);
    for (let i = 8; i >= 0; i -= 2) g.lineTo(lid[i], lid[i + 1] + R * 0.12 * open);
    g.closePath();
    g.fillStyle = lit;
    g.fill();
    almond();
    g.lineWidth = Math.max(1.2, 1.3 * k.zoom);
    g.strokeStyle = ink;
    g.stroke();
    g.lineJoin = 'round';
  }, o.bias ?? 3);
  k.glow(p, o.r * 2.2, a * 0.6 * (0.3 + 0.7 * open));
}

/**
 * Thorns standing round a body: `n` of them on a circle `R` tiles out at
 * `z` height units over its feet, each `len` long and pointing `dir` -- in
 * at it (a clamp), up (a crown) or down (a weight). The ones behind the body
 * are drawn behind it and the ones in front over it, so it stands inside.
 */
function thorns(k: FxScene, b: { x: number; y: number; z: number }, o: {
  R: number; z: number; n: number; len: number; dir: 'in' | 'up' | 'down'; turn?: number; alpha?: number; width?: number; grow?: number;
  main?: string; deep?: string;
}): void {
  const a = o.alpha ?? 1, grow = clamp(o.grow ?? 1);
  if (a <= 0.01 || grow <= 0.01) return;
  const turn = o.turn ?? 0, cy = k.eye.worldToScreenY(b.x, b.y, b.z + o.z);
  const back: number[] = [], front: number[] = [];
  const W = (o.width ?? 2.2) * k.zoom;
  const len = o.len * grow, step = len / UNITS_PER_TILE;
  for (let i = 0; i < o.n; i++) {
    const an = turn + (i / o.n) * TAU + (hashOf(k.seed + 17, i) - 0.5) * 0.4;
    const ca = Math.cos(an), sa = Math.sin(an);
    const l = 0.75 + 0.5 * hashOf(k.seed + 19, i);
    const bx = b.x + ca * o.R, by = b.y + sa * o.R, bz = b.z + o.z;
    let tx = bx, ty = by, tz = bz;
    if (o.dir === 'in') { tx -= ca * step * l; ty -= sa * step * l; tz -= len * 0.25 * l; }
    else if (o.dir === 'up') { tx += ca * step * 0.25 * l; ty += sa * step * 0.25 * l; tz += len * l; }
    else { tx -= ca * step * 0.6 * l; ty -= sa * step * 0.6 * l; tz -= len * 0.85 * l; }
    const sx0 = k.eye.worldToScreenX(bx, by), sy0 = k.eye.worldToScreenY(bx, by, bz);
    const sx1 = k.eye.worldToScreenX(tx, ty), sy1 = k.eye.worldToScreenY(tx, ty, tz);
    (sy0 > cy ? front : back).push(sx0, sy0, sx1, sy1);
  }
  // A thin thorn gets a thin edge: an ink line as wide as the thorn would leave nothing but ink.
  const main = o.main ?? k.pal.main, deep = o.deep ?? k.pal.deep, ink = k.pal.ink, inkW = Math.max(0.6, Math.min(0.7 * k.zoom, W * 0.45));
  const draw = (list: number[]) => (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    for (let i = 0; i < list.length; i += 4) {
      const x0 = list[i], y0 = list[i + 1], x1 = list[i + 2], y1 = list[i + 3];
      const l = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / l * W, ny = (x1 - x0) / l * W;
      // Two facets, lit and shaded down the spine of the thorn.
      g.fillStyle = main;
      g.beginPath();
      g.moveTo(x0 + nx, y0 + ny);
      g.lineTo(x1, y1);
      g.lineTo(x0, y0);
      g.closePath();
      g.fill();
      g.fillStyle = deep;
      g.beginPath();
      g.moveTo(x0 - nx, y0 - ny);
      g.lineTo(x1, y1);
      g.lineTo(x0, y0);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(x0 + nx, y0 + ny);
      g.lineTo(x1, y1);
      g.lineTo(x0 - nx, y0 - ny);
      g.lineWidth = inkW;
      g.strokeStyle = ink;
      g.stroke();
    }
    g.lineJoin = 'round';
  };
  const foot = { x: b.x, y: b.y, z: b.z };
  if (back.length) k.worldDraw(foot, draw(back), -0.5);
  if (front.length) k.worldDraw(foot, draw(front), 3);
}

/** The crooked runes a curse is spoken in: strokes in a box a unit each way. */
const RUNES: readonly (readonly number[])[][] = [
  [[-0.5, -1, 0.35, -0.25, -0.35, 0.3, 0.5, 1]],
  [[0, -1, 0.1, 1], [-0.6, -0.35, 0.55, 0.15]],
  [[-0.55, 1, 0, -1, 0.55, 1], [-0.3, 0.25, 0.4, 0.05]],
  [[0.5, -1, -0.45, -0.25, 0.45, 0.35, -0.5, 1], [-0.65, -0.85, -0.15, -0.55]],
];
/** A rune in the air, inked and green: `size` pixels at zoom one, `turn` swung about the upright. */
function rune(k: FxScene, p: P3, size: number, which: number, o: { turn?: number; alpha?: number; colour?: string; bias?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), S = size * k.zoom;
  const sq = 0.35 + 0.65 * Math.abs(Math.cos(o.turn ?? 0));
  const strokes = RUNES[((which % RUNES.length) + RUNES.length) % RUNES.length];
  const colour = o.colour ?? k.pal.accent, ink = k.pal.ink;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    g.lineCap = 'square';
    const path = (): void => {
      g.beginPath();
      for (const s of strokes) {
        g.moveTo(x + s[0] * S * sq, y + s[1] * S);
        for (let i = 2; i < s.length; i += 2) g.lineTo(x + s[i] * S * sq, y + s[i + 1] * S);
      }
    };
    path();
    g.lineWidth = Math.max(2.2, S * 0.42);
    g.strokeStyle = ink;
    g.stroke();
    path();
    g.lineWidth = Math.max(1, S * 0.2);
    g.strokeStyle = colour;
    g.stroke();
    g.lineCap = 'butt';
    g.lineJoin = 'round';
  }, o.bias ?? 2);
  k.glow(p, size * 2.4, a * 0.45, k.pal.accent);
}

/** Hex's three runes going round a body at heart height, `R` tiles out, `turn` radians on; `beat` swells them. */
function hexRunes(k: FxScene, b: { x: number; y: number; z: number; tall: number }, R: number, turn: number, alpha: number, beat = 0): void {
  for (let i = 0; i < 3; i++) {
    const an = turn + (i * TAU) / 3;
    const p = { x: b.x + Math.cos(an) * R, y: b.y + Math.sin(an) * R, z: b.z + b.tall * (0.55 + 0.08 * Math.sin(turn * 1.7 + i * 2)) };
    rune(k, p, 3.2 * (1 + 0.3 * beat), i, { turn: an + Math.PI / 2, alpha: alpha * (0.85 + 0.15 * beat), bias: Math.sin(an) > 0 ? 3 : -1 });
  }
}

/** Jagged cracks run out across the ground from a point, `grow` of the way to `r` tiles, glowing along their length. */
function cracks(k: FxScene, c: { x: number; y: number }, r: number, o: { n?: number; grow?: number; alpha?: number; turn?: number } = {}): void {
  const a = o.alpha ?? 1, grow = clamp(o.grow ?? 1);
  if (a <= 0.01 || grow <= 0.01) return;
  const n = o.n ?? 9, seg0 = k.fast ? 4 : 6;
  const lines: number[][] = [], segs: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = (o.turn ?? 0) + (i / n) * TAU + (hashOf(k.seed + 23, i) - 0.5) * 0.5;
    const len = r * (0.6 + 0.4 * hashOf(k.seed + 29, i)) * easeOut(clamp(grow * 1.2 - 0.2 * hashOf(k.seed + 31, i)));
    const pts: number[] = [];
    // Wandering a little either side of its line, by no more than a fraction of a step: a crack, not a scribble.
    const ca = Math.cos(base), sa = Math.sin(base), step = len / seg0;
    let side = 0;
    for (let j = 0; j <= seg0; j++) {
      const d = j * step;
      if (j > 0) side += (hashOf(k.seed + 37 + i, j) - 0.5) * step * 0.7;
      pts.push(c.x + ca * d - sa * side, c.y + sa * d + ca * side);
      if (j > 0) segs.push(pts[2 * j - 2], pts[2 * j - 1], pts[2 * j], pts[2 * j + 1]);
    }
    lines.push(pts);
  }
  const A = clamp(a);
  k.groundShape(c.x, c.y, r + 0.5, [
    { kind: 'stroke', colour: k.pal.ink, alpha: A, width: Math.max(2, 2.6 * k.zoom), paths: lines, join: 'miter', lift: 0.1 },
    { kind: 'stroke', colour: k.pal.accent, alpha: A, width: Math.max(0.8, 0.9 * k.zoom), paths: lines, join: 'miter', lift: 0.11 },
  ], (x, y, reach) => nearSegments(segs, x, y, reach + 0.05));
}

/**
 * A ragged pool lying on the ground, `r` tiles, its edge torn by the cast's
 * own seed: rot, blood -- and, given `inner`, a second pool inside it in
 * another colour, laid in the same record.
 */
function pool(k: FxScene, c: { x: number; y: number }, r: number, colour: string, alpha: number, salt = 0,
  inner?: { share: number; colour: string; alpha: number; salt: number }): void {
  if (alpha <= 0.01 || r <= 0.03) return;
  const ring = (rad: number, sl: number): number[] => {
    const n = k.facets(rad, 26), pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const an = (i / n) * TAU;
      const rr = rad * (0.72 + 0.28 * hashOf(k.seed + 41 + sl, i));
      pts.push(c.x + Math.cos(an) * rr, c.y + Math.sin(an) * rr);
    }
    return pts;
  };
  const layers: GroundLayer[] = [{ kind: 'fill', colour, alpha: clamp(alpha), paths: [ring(r, salt)], lift: 0.08 }];
  if (inner && inner.alpha > 0.01) layers.push({ kind: 'fill', colour: inner.colour, alpha: clamp(inner.alpha), paths: [ring(r * inner.share, inner.salt)], lift: 0.09 });
  k.groundShape(c.x, c.y, r + 0.4, layers, inBand(c.x, c.y, 0, r));
}

/**
 * Plague's blight: the ground it sickens broken out in sores rather than
 * painted over -- `n` ragged blotches of rot strewn through `r` tiles, each a
 * bruised patch with a bilious heart, the most of them near the middle, and
 * a ragged band of rot round the edge. `grow` spreads it from the middle
 * out. Small pieces, each in a tile or two, so the ground pass cuts them for
 * next to nothing where one great disc is cut against every tile it covers.
 */
function blight(k: FxScene, c: { x: number; y: number }, r: number, grow: number, alpha: number, n = 16): void {
  if (alpha <= 0.01 || grow <= 0.01) return;
  const bruise: number[][] = [], heart: number[][] = [], segs: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = r * 0.92 * Math.sqrt(hashOf(k.seed + 61, i));
    const v = clamp((grow * r - d) / (r * 0.25));
    if (v <= 0) continue;
    const an = hashOf(k.seed + 67, i) * TAU, x = c.x + Math.cos(an) * d, y = c.y + Math.sin(an) * d;
    const size = (0.22 + 0.3 * hashOf(k.seed + 71, i)) * (1 - 0.35 * d / r) * easeOut(v);
    const outer: number[] = [], inner: number[] = [];
    for (let j = 0; j < 7; j++) {
      const a = (j / 7) * TAU + i;
      const rr = size * (0.65 + 0.35 * hashOf(k.seed + 73 + i, j));
      outer.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.9);
      inner.push(x + Math.cos(a) * rr * 0.45 + size * 0.08, y + Math.sin(a) * rr * 0.4 - size * 0.06);
    }
    bruise.push(outer);
    heart.push(inner);
    segs.push(x, y, x, y);
  }
  const A = clamp(alpha);
  if (bruise.length) {
    k.groundShape(c.x, c.y, r + 0.5, [
      { kind: 'fill', colour: ROT_DEEP, alpha: A * 0.75, paths: bruise, lift: 0.08 },
      { kind: 'fill', colour: ROT, alpha: A * 0.55, paths: heart, lift: 0.09 },
    ], (x, y, reach) => nearSegments(segs, x, y, reach + 0.6));
  }
  // The edge of what it sickens: a ragged band of rot, spreading out with it.
  k.ring(c, r * easeOut(grow), { band: Math.max(0.12, r * 0.04), alpha: A * 0.85, main: ROT, deep: ROT_DEEP, turn: 0.3, glow: 0.2 });
}

/**
 * Fright's mark over a frightened head: three short pale strokes fanned out
 * from a point under them, tapered and inked, shaking -- the jolt a body
 * gives when it is startled, which is a shape somebody reads without thinking.
 */
function startle(k: FxScene, p: P3, size: number, o: { alpha?: number; shake?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const S = size * k.zoom, sh = (o.shake ?? 0) * k.zoom;
  const x = k.sx(p) + sh * Math.sin(k.now * 53), y = k.sy(p);
  const core = k.pal.core, ink = k.pal.ink;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    for (const an of [-0.62, 0, 0.62]) {
      const dx = Math.sin(an), dy = -Math.cos(an);
      // A long thin diamond, sharp at both ends and widest a third of the way out.
      const x0 = x + dx * S * 0.4, y0 = y + dy * S * 0.4, x1 = x + dx * S * 1.35, y1 = y + dy * S * 1.35;
      const xm = lerp(x0, x1, 0.38), ym = lerp(y0, y1, 0.38), w = S * 0.14;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(xm - dy * w, ym + dx * w);
      g.lineTo(x1, y1);
      g.lineTo(xm + dy * w, ym - dx * w);
      g.closePath();
      g.fillStyle = core;
      g.fill();
      g.lineWidth = Math.max(0.8, 0.7 * k.zoom);
      g.strokeStyle = ink;
      g.stroke();
    }
    g.lineJoin = 'round';
  }, 3);
  k.glow({ x: p.x, y: p.y, z: p.z + size * 0.4 }, size * 1.4, a * 0.2, k.pal.core);
}

/**
 * A thing carried, held up to be unmade: a small faceted box in plain wood,
 * its top lit, its sides in two shades, inked -- and `crack` nought to one of
 * it split by violet seams as it is crushed. `size` pixels at zoom one.
 */
function trinket(k: FxScene, p: P3, size: number, crack: number, alpha = 1): void {
  if (alpha <= 0.01) return;
  const S = size * k.zoom, x = k.sx(p), y = k.sy(p);
  const jit = crack * 0.6 * k.zoom * Math.sin(k.now * 47);
  const cx = x + jit;
  const top = [cx, y - S, cx + S, y - S * 0.5, cx, y, cx - S, y - S * 0.5];
  const left = [cx - S, y - S * 0.5, cx, y, cx, y + S, cx - S, y + S * 0.5];
  const right = [cx, y, cx + S, y - S * 0.5, cx + S, y + S * 0.5, cx, y + S];
  const seam = k.pal.main, ink = k.pal.ink;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'miter';
    const face = (f: number[], c: string): void => {
      g.beginPath();
      g.moveTo(f[0], f[1]);
      for (let i = 2; i < f.length; i += 2) g.lineTo(f[i], f[i + 1]);
      g.closePath();
      g.fillStyle = c;
      g.fill();
      g.lineWidth = Math.max(0.8, 0.7 * k.zoom);
      g.strokeStyle = ink;
      g.stroke();
    };
    face(top, STUFF[2]);
    face(left, STUFF[0]);
    face(right, '#5a4228');
    if (crack > 0.02) {
      // The seams, drawn on as it gives: across the top and down both faces.
      const u = clamp(crack * 1.4);
      g.beginPath();
      g.moveTo(cx - S * 0.6, y - S * 0.6);
      g.lineTo(cx - S * 0.6 + S * 0.9 * u, y - S * 0.6 + S * 0.25 * u);
      g.moveTo(cx - S * 0.1, y + S * 0.05);
      g.lineTo(cx - S * 0.1 - S * 0.4 * u, y + S * 0.05 + S * 0.7 * u);
      g.moveTo(cx + S * 0.5, y - S * 0.15);
      g.lineTo(cx + S * 0.5 + S * 0.2 * u, y - S * 0.15 + S * 0.75 * u);
      g.lineWidth = Math.max(1, 0.9 * k.zoom);
      g.strokeStyle = seam;
      g.stroke();
    }
    g.lineJoin = 'round';
  }, 3);
}

/** A soul, or half of one: a pale gem with a wisp trailing off it toward `from`. */
function soulWisp(k: FxScene, p: P3, from: P3, r: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const look = { main: SOUL, deep: '#8fd4a0', core: '#ffffff', ink: '#2b4a33' };
  k.ribbon([mid3(from, p, 0.45), mid3(from, p, 0.75), p], { width: r * 1.3, taper: 'start', alpha: alpha * 0.6, ...look, glow: 0.4 });
  k.orb(p, r, { alpha, ...look, turn: k.now * 4, glow: 0.9 });
}

/**
 * Arrowheads on the ground pointing out from a point, `n` round it at `r`
 * tiles: the way everything runs from Panic. Each a flat chevron, violet with
 * an ink edge, `size` tiles from tip to tail.
 */
function chevrons(k: FxScene, c: { x: number; y: number }, r: number, n: number, size: number, o: { alpha?: number; turn?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.05) return;
  const vees: number[][] = [];
  for (let i = 0; i < n; i++) {
    const an = (o.turn ?? 0) + (i / n) * TAU + (hashOf(k.seed + 43, i) - 0.5) * 0.2;
    const ca = Math.cos(an), sa = Math.sin(an);
    const v: number[] = [];
    const at = (along: number, side: number): void => { v.push(c.x + ca * along - sa * side, c.y + sa * along + ca * side); };
    // A V: two barbs back from the tip, and its notch.
    at(r + size * 0.5, 0); at(r - size * 0.5, -size * 0.6); at(r - size * 0.2, 0); at(r - size * 0.5, size * 0.6);
    vees.push(v);
  }
  const A = clamp(a);
  k.groundShape(c.x, c.y, r + size + 0.5, [
    { kind: 'fill', colour: k.pal.main, alpha: A, paths: vees, lift: 0.15 },
    { kind: 'stroke', colour: k.pal.ink, alpha: A, width: Math.max(0.8, 0.7 * k.zoom), paths: vees, closed: true, join: 'miter', lift: 0.15 },
  ], inBand(c.x, c.y, r - size, r + size));
}

/**
 * Rock torn up out of the ground: chunky spires, a third as wide as they are
 * tall, on a ring `r` tiles round a point -- each lit on its left face,
 * shaded on its right, a green seam glowing up its middle. `grow` nought to
 * one pushes them up out of the ground and lets them sink again.
 */
function spires(k: FxScene, c: { x: number; y: number }, r: number, n: number, h: number, grow: number, salt: number): void {
  if (grow <= 0.01) return;
  const lit = '#6a5a70', shade = '#2e2436', seam = k.pal.accent, ink = k.pal.ink;
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU + hashOf(k.seed + salt, i) * 0.9;
    const rr = r * (0.8 + 0.4 * hashOf(k.seed + salt + 1, i));
    const base = k.on(c.x + Math.cos(an) * rr, c.y + Math.sin(an) * rr);
    const tall = h * (0.7 + 0.6 * hashOf(k.seed + salt + 2, i)) * grow;
    const lean = (hashOf(k.seed + salt + 3, i) - 0.5) * 0.5 + Math.cos(an) * 0.25;
    const bx = k.sx(base), by = k.sy(base), H = k.hpx(tall), W = H * 0.32;
    const tx = bx + lean * H * 0.4, ty = by - H;
    k.worldDraw(base, (g) => {
      g.lineJoin = 'miter';
      g.globalAlpha = 1;
      g.fillStyle = lit;
      g.beginPath();
      g.moveTo(bx - W, by);
      g.lineTo(tx, ty);
      g.lineTo(bx + W * 0.1, by + W * 0.3);
      g.closePath();
      g.fill();
      g.fillStyle = shade;
      g.beginPath();
      g.moveTo(bx + W * 0.1, by + W * 0.3);
      g.lineTo(tx, ty);
      g.lineTo(bx + W, by);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(bx - W, by);
      g.lineTo(tx, ty);
      g.lineTo(bx + W, by);
      g.lineTo(bx + W * 0.1, by + W * 0.3);
      g.closePath();
      g.lineWidth = Math.max(0.9, 0.8 * k.zoom);
      g.strokeStyle = ink;
      g.stroke();
      g.beginPath();
      g.moveTo(lerp(bx, tx, 0.1) - W * 0.15, lerp(by, ty, 0.1));
      g.lineTo(lerp(bx, tx, 0.55) + W * 0.05, lerp(by, ty, 0.55));
      g.lineTo(lerp(bx, tx, 0.8), lerp(by, ty, 0.8));
      g.lineWidth = Math.max(1, 0.9 * k.zoom);
      g.strokeStyle = seam;
      g.stroke();
      g.lineJoin = 'round';
    });
  }
}

/**
 * Which way a frightened creature runs, over its head: a flat violet
 * arrowhead lying level in the air, inked, pointing along `dir` (a unit step
 * on the ground). `size` tiles tip to tail; it jolts forward on the beat.
 */
function fleeMark(k: FxScene, b: { x: number; y: number; z: number; tall: number }, dir: { x: number; y: number }, size: number, alpha: number, beat = 0): void {
  if (alpha <= 0.01) return;
  const z = b.z + b.tall * 1.12 + 2;
  const push = size * 0.25 * beat;
  const cx = b.x + dir.x * push, cy = b.y + dir.y * push, px = -dir.y, py = dir.x;
  const at = (along: number, side: number): P3 => ({ x: cx + dir.x * along * size + px * side * size, y: cy + dir.y * along * size + py * side * size, z });
  k.shapes({ x: b.x, y: b.y, z: b.z }, [
    { pts: [at(0.55, 0), at(-0.45, -0.55), at(-0.2, 0), at(-0.45, 0.55)], fill: k.pal.main, ink: k.pal.ink, width: 1.1 },
    { pts: [at(0.55, 0), at(-0.45, -0.55), at(-0.2, 0)], fill: k.pal.core, ink: false, alpha: 0.6 },
  ], { alpha, bias: 3 });
}

/** Which way a creature runs from Panic: straight out from the spot, or away from the caster when it stands on the spot itself. */
function fleeWay(k: FxScene, b: { x: number; y: number }): { x: number; y: number; d: number } {
  const dx = b.x - k.spot.x, dy = b.y - k.spot.y, d = Math.hypot(dx, dy);
  if (d > 0.4) return { x: dx / d, y: dy / d, d };
  const t = k.toward(k.caster, b);
  return { x: t.x, y: t.y, d };
}

/** The wild creatures an area spell takes: those standing in it now, the nearest few, so a herd does not cost a frame. */
function taken(k: FxScene, c: { x: number; y: number }, r: number, most = 8): ReturnType<FxScene['bodiesWithin']> {
  const all = k.bodiesWithin(r, c, ['creature']);
  if (all.length <= most) return all;
  return all.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y)).slice(0, most);
}

/** Blood let fall from a point: a few drops, heavy, that land. */
function bleed(k: FxScene, at: P3, n: number, spread = 0.04): void {
  k.burst(at, n, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 2, sizeEnd: 1.4, life: [0.35, 0.6], speed: [0.05, 0.35], up: [-2, 8], gravity: 70, drag: 0.6, jitter: spread, bias: 2 });
}

/** Once a whole second goes by, for what ticks: a bleed's beat. */
function ticked(k: FxScene, age: number, key: string): boolean {
  const s = Math.floor(age);
  if (s <= (k.state[key] ?? -1)) return false;
  k.state[key] = s;
  return true;
}

/** Tiles round a body's feet for the band that counts its time down: just clear of a creature's legs or a person's. */
const footR = (b: { wide: number }): number => Math.max(0.24, b.wide / 16);

/** A shiver, the same for the same `t`: dread in the hands. */
const shiver = (t: number, hz: number, amp: number, phase = 0): number => amp * (Math.sin(t * hz * TAU + phase) * 0.6 + Math.sin(t * hz * 2.7 * TAU + phase * 1.3) * 0.4);

/* ---- the casts ---------------------------------------------------------------------- */

/*
 * Every pose below is a prayer of one kind or another, said with the hands
 * where the magic comes from (`Rig.shape`, `Rig.reach`), the mouth (`mouth`)
 * and, for the gravest, on one knee (`kneel`).
 */

/*
 * Places on the body the hands go to, in its own frame from the middle of
 * the feet (x to its right, y ahead, z up; `figureJoint`'s frame), for the
 * plain build: the lips, the eyes, the heart, the far shoulders. Reached for
 * with `Rig.reach`, so a hand that covers the eyes covers them on any build.
 */
const LIPS: V3 = [0.15, 1.75, 12.95];
const EYES = (side: number): V3 => [side * 0.55, 1.45, 13.7];
const HEART: V3 = [0.45, 1.5, 10.4];
/** Hand `k` laid flat on the far shoulder, as the dead are laid: the right on the left, the left on the right. */
const FAR_SHOULDER = (k: number): V3 => [k ? -1.45 : 1.45, 0.95, k ? 11.0 : 11.35];

/** A hand goal `w` of the way there, or none at all when it is nought (the arm's own pose throughout). */
const goal = (at: V3, w: number, o: Omit<HandGoal, 'at' | 'w'> = {}): HandGoal | undefined => (w > 0.001 ? { at, w, ...o } : undefined);

/** Muttering: the mouth working a little, quickly, between `a` and `b` of the cast. */
const mutter = (t: number, s: number, a: number, b: number): number => bump(t, a, a + 0.04, b) * (0.15 + 0.17 * Math.abs(Math.sin(s * 19)));

/** Hex: a curse whispered into the fingers, hunched over them, and flicked off the fingertips at the creature. */
const hexPose: CastPose = (r, t, c) => {
  const s = t * c.timing.secs;
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.34, [-8, 0, -4]], [0.5, [-4, 0, 6]], [0.66, [-3, 0, 5]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.34, [-10, 2, -10]], [0.5, [-2, 0, 16]], [0.66, [-2, 0, 14]], [1, [0, 0, 0]]]);
  r.neck = euler(t, [[0.1, [0, 0, 0]], [0.34, [-10, 0, 0]], [0.5, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.34, [-14, 4, -8]], [0.5, [2, 0, -10]], [0.66, [0, 0, -8]], [1, [0, 0, 0]]]);
  // The right forefinger at the lips, the left cupped under it to keep the words in; then the right flung out flat.
  r.arm[1] = euler(t, [[0.1, [6, 10, 0]], [0.34, [68, -14, 34]], [0.42, [72, -10, 30]], [0.5, [92, 14, -4]], [0.66, [86, 16, -6]], [1, [10, 10, 0]]]);
  r.elbow[1] = one(t, [[0.1, 14], [0.34, 146], [0.42, 140], [0.5, 12], [0.66, 20], [1, 16]]);
  r.hand[1] = euler(t, [[0.1, [0, 0, 0]], [0.34, [30, 0, 0]], [0.46, [30, 0, 0]], [0.5, [-40, 0, 0]], [0.66, [-30, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0.1, [6, 10, 0]], [0.34, [54, -14, 30]], [0.5, [24, 14, 6]], [1, [6, 10, 0]]]);
  r.elbow[0] = one(t, [[0.1, 14], [0.34, 118], [0.5, 40], [1, 16]]);
  r.hand[0] = euler(t, [[0.1, [0, 0, 0]], [0.34, [0, -60, 0]], [0.5, [0, 0, 0]]]);
  const atLips = one(t, [[0.14, 0], [0.3, 1], [0.44, 1], [0.5, 0]]);
  r.reach = [goal([LIPS[0] - 0.35, LIPS[1] + 0.1, LIPS[2] - 1.1], atLips * 0.9), goal(LIPS, atLips)];
  r.shape = [{ cup: one(t, [[0.14, 0], [0.3, 1], [0.48, 1], [0.56, 0]]) }, { point: one(t, [[0.12, 0], [0.26, 1], [0.46, 1], [0.5, 0]]), flat: one(t, [[0.46, 0], [0.5, 1], [0.8, 1], [0.95, 0]]) }];
  r.mouth = mutter(t, s, 0.2, 0.47);
  r.open = [false, false];
  r.leg[0] = euler(t, [[0.1, [2, 2, 0]], [0.34, [-2, 3, 0]], [0.5, [16, 3, 0]], [0.7, [14, 3, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0.1, 4], [0.34, 8], [0.5, 18], [1, 4]]);
  r.knee[1] = one(t, [[0.1, 4], [0.34, 14], [0.5, 6], [1, 4]]);
};

/** Fright: the face hidden behind both hands, then the hands torn away clawed and the face thrust at the creature in a scream, shaking. */
const frightPose: CastPose = (r, t, c) => {
  const s = t * c.timing.secs;
  const sh = bump(t, 0.4, 0.5, 0.85);
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.36, [-6, 0, 0]], [0.46, [-14, 0, 0]], [0.7, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.36, [-10, 0, 0]], [0.46, [4, 0, 0]], [0.7, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.neck = euler(t, [[0.1, [0, 0, 0]], [0.36, [-8, 0, 0]], [0.46, [-16, 0, 0]], [0.7, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.36, [-16, 0, 0]], [0.46, [6, 0, 0]], [0.7, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.head[2] += shiver(s, 7, 4 * sh);
  const hide = one(t, [[0.12, 0], [0.3, 1], [0.4, 1], [0.46, 0]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0.1, [6, 10, 0]], [0.36, [86, -12, 38]], [0.46, [74, 76, -12]], [0.7, [70, 78, -12]], [1, [8, 10, 0]]]);
    r.elbow[k] = one(t, [[0.1, 14], [0.36, 140], [0.46, 40], [0.7, 46], [1, 14]]);
    r.arm[k][1] += shiver(s, 9, 3 * sh, k * 2);
    r.hand[k] = euler(t, [[0.36, [10, 0, 0]], [0.46, [-45, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = false;
  }
  r.reach = [goal(EYES(-1), hide, { pole: [-3, -1, 9] }), goal(EYES(1), hide, { pole: [3, -1, 9] })];
  const claw = one(t, [[0.4, 0], [0.46, 1], [0.8, 1], [0.95, 0]]);
  r.shape = [{ flat: hide, claw }, { flat: hide, claw }];
  r.mouth = one(t, [[0.42, 0], [0.47, 1], [0.72, 0.85], [0.88, 0]]);
  r.knee = [one(t, [[0.1, 4], [0.36, 22], [0.46, 10], [1, 4]]), one(t, [[0.1, 4], [0.36, 22], [0.46, 16], [1, 4]])];
  r.leg[0] = euler(t, [[0.1, [2, 2, 0]], [0.36, [8, 3, 0]], [0.46, [22, 4, 0]], [0.75, [20, 4, 0]], [1, [2, 2, 0]]]);
  r.leg[1] = euler(t, [[0.1, [2, 2, 0]], [0.36, [8, 3, 0]], [0.46, [-6, 3, 0]], [1, [2, 2, 0]]]);
};

/** Blood Price: the right forefinger drawn across the left palm, then the cut palm raised up flat, full, to be taken. */
const bloodPricePose: CastPose = (r, t) => {
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.26, [-6, 0, 0]], [0.4, [-8, 0, 0]], [0.58, [6, 0, 0]], [0.78, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.26, [-8, 0, 6]], [0.4, [-8, 0, -6]], [0.58, [8, -2, 0]], [0.78, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.26, [-22, 0, 6]], [0.4, [-24, 0, 4]], [0.58, [20, -4, 8]], [0.78, [16, 0, 6]], [1, [0, 0, 0]]]);
  // The left palm up before the chest; the right comes to it, and draws its nail out across it.
  r.arm[0] = euler(t, [[0.1, [6, 10, 0]], [0.26, [58, 2, 8]], [0.4, [60, 2, 6]], [0.58, [158, 18, -10]], [0.78, [150, 20, -10]], [1, [8, 10, 0]]]);
  r.elbow[0] = one(t, [[0.1, 14], [0.26, 84], [0.4, 80], [0.58, 22], [0.78, 30], [1, 14]]);
  r.hand[0] = euler(t, [[0.1, [0, 0, 0]], [0.26, [0, 70, 0]], [0.58, [-20, 70, 0]], [0.78, [-20, 60, 0]], [1, [0, 0, 0]]]);
  r.arm[1] = euler(t, [[0.1, [6, 10, 0]], [0.26, [62, -26, 40]], [0.4, [56, 30, 0]], [0.58, [30, 22, 10]], [0.78, [26, 16, 10]], [1, [8, 10, 0]]]);
  r.elbow[1] = one(t, [[0.1, 14], [0.26, 108], [0.4, 70], [0.58, 76], [1, 14]]);
  r.shape = [{ flat: one(t, [[0.12, 0], [0.24, 1], [0.86, 1], [0.98, 0]]) }, { point: one(t, [[0.14, 0], [0.24, 1], [0.42, 1], [0.52, 0]]) }];
  r.mouth = one(t, [[0.3, 0], [0.34, 0.3], [0.42, 0.1], [0.58, 0.35], [0.8, 0.3], [0.92, 0]]);
  r.open = [false, false];
  r.knee = [one(t, [[0.1, 4], [0.4, 12], [0.58, 2], [1, 4]]), one(t, [[0.1, 4], [0.4, 12], [0.58, 2], [1, 4]])];
};

/** Siphon: the right hand reached out clawed at the creature, closed on what it finds there and hauled back to the chest. */
const siphonPose: CastPose = (r, t) => {
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.34, [-12, 0, 4]], [0.42, [-12, 0, 4]], [0.7, [10, 0, -4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.34, [-6, 0, 16]], [0.42, [-6, 0, 18]], [0.7, [6, 0, -10]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.34, [-4, 0, -14]], [0.7, [8, 0, 8]], [1, [0, 0, 0]]]);
  r.arm[1] = euler(t, [[0.1, [6, 10, 0]], [0.34, [104, 4, -6]], [0.42, [100, 4, -6]], [0.7, [50, -10, 34]], [0.82, [46, -12, 34]], [1, [8, 10, 0]]]);
  r.elbow[1] = one(t, [[0.1, 14], [0.34, 4], [0.42, 12], [0.7, 128], [0.82, 124], [1, 14]]);
  r.hand[1] = euler(t, [[0.1, [0, 0, 0]], [0.34, [-30, 0, 0]], [0.42, [10, 0, 0]], [0.7, [20, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0.1, [6, 10, 0]], [0.34, [-14, 22, 0]], [0.7, [30, 12, 10]], [1, [6, 10, 0]]]);
  r.elbow[0] = one(t, [[0.1, 14], [0.34, 30], [0.7, 50], [1, 14]]);
  // Clawed as it reaches; shut on the catch, a fist hauling it in.
  r.shape = [{ claw: one(t, [[0.15, 0], [0.3, 0.6], [0.8, 0.6], [0.95, 0]]) }, { claw: one(t, [[0.12, 0], [0.26, 1], [0.4, 1], [0.44, 0]]) }];
  r.mouth = one(t, [[0.4, 0], [0.46, 0.4], [0.72, 0.3], [0.85, 0]]);
  r.open = [false, false];
  r.leg[0] = euler(t, [[0.1, [2, 2, 0]], [0.34, [24, 3, 0]], [0.42, [24, 3, 0]], [0.7, [10, 3, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0.1, 4], [0.34, 24], [0.7, 6], [1, 4]]);
  r.leg[1] = euler(t, [[0.1, [2, 2, 0]], [0.34, [-8, 2, 0]], [0.7, [-12, 2, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0.1, 4], [0.34, 8], [0.7, 22], [1, 4]]);
};

/** Cower: the right palm lifted high over the creature and pressed slowly down flat, the body sinking behind it as it bears down. */
const cowerPose: CastPose = (r, t) => {
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.42, [8, 0, 0]], [0.55, [-10, 0, 0]], [0.78, [-16, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.42, [6, 0, 10]], [0.55, [-4, 0, 6]], [0.78, [-6, 0, 4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.42, [4, 0, -8]], [0.55, [-10, 0, -4]], [0.78, [-14, 0, -2]], [1, [0, 0, 0]]]);
  r.arm[1] = euler(t, [[0.1, [6, 10, 0]], [0.42, [162, 16, 0]], [0.55, [96, 8, 0]], [0.78, [62, 8, 0]], [1, [8, 10, 0]]]);
  r.elbow[1] = one(t, [[0.1, 14], [0.42, 30], [0.55, 14], [0.78, 18], [1, 14]]);
  // The palm flat to the ground all the way down: pressing, not striking.
  r.hand[1] = euler(t, [[0.1, [0, 0, 0]], [0.42, [70, 0, 0]], [0.55, [60, 0, 0]], [0.78, [50, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0.1, [6, 10, 0]], [0.42, [20, 26, 0]], [0.78, [10, 30, 0]], [1, [6, 10, 0]]]);
  r.elbow[0] = one(t, [[0.1, 14], [0.42, 40], [1, 14]]);
  r.shape = [{ flat: one(t, [[0.2, 0], [0.4, 0.7], [0.88, 0.7], [0.98, 0]]) }, { flat: one(t, [[0.15, 0], [0.3, 1], [0.9, 1], [1, 0]]) }];
  r.mouth = one(t, [[0.5, 0], [0.56, 0.25], [0.8, 0.2], [0.92, 0]]);
  r.open = [false, false];
  r.leg[0] = euler(t, [[0.1, [2, 2, 0]], [0.42, [6, 3, 0]], [0.55, [22, 4, 0]], [0.78, [28, 4, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0.1, 4], [0.42, 2], [0.55, 26], [0.78, 36], [1, 4]]);
  r.leg[1] = euler(t, [[0.1, [2, 2, 0]], [0.42, [-4, 2, 0]], [0.55, [4, 2, 0]], [0.78, [6, 2, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0.1, 4], [0.42, 2], [0.55, 30], [0.78, 40], [1, 4]]);
};

/** Pact: the fist struck to the heart, then wrenched out of the chest and held up high with an oath, and brought down ready for the fight. */
const pactPose: CastPose = (r, t, c) => {
  const s = t * c.timing.secs;
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.3, [-10, 0, 0]], [0.55, [10, 0, 0]], [0.72, [6, 0, 0]], [0.86, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.3, [-10, 0, 0]], [0.55, [12, -4, -6]], [0.72, [8, -2, -4]], [0.86, [-2, 0, 6]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.3, [-24, 0, 0]], [0.55, [22, 0, -6]], [0.72, [18, 0, -4]], [0.86, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[1] = euler(t, [[0.1, [6, 10, 0]], [0.3, [48, -22, 42]], [0.38, [56, -16, 34]], [0.55, [172, 6, -6]], [0.72, [168, 8, -6]], [0.86, [74, 14, 0]], [1, [8, 10, 0]]]);
  r.elbow[1] = one(t, [[0.1, 14], [0.3, 132], [0.38, 120], [0.55, 6], [0.72, 12], [0.86, 96], [1, 14]]);
  r.arm[1][1] += shiver(s, 8, 2.5 * bump(t, 0.55, 0.62, 0.78));
  r.arm[0] = euler(t, [[0.1, [6, 10, 0]], [0.3, [44, -18, 38]], [0.42, [30, 0, 20]], [0.55, [-12, 30, 0]], [0.86, [16, 20, 0]], [1, [6, 10, 0]]]);
  r.elbow[0] = one(t, [[0.1, 14], [0.3, 116], [0.42, 70], [0.55, 24], [0.86, 60], [1, 14]]);
  // The fist on the heart, and the left laid flat over it, while the price is struck.
  const onHeart = one(t, [[0.16, 0], [0.28, 1], [0.36, 1], [0.44, 0]]);
  r.reach = [goal([HEART[0] - 0.2, HEART[1] + 0.55, HEART[2] + 0.2], onHeart * 0.9), goal(HEART, onHeart)];
  r.shape = [{ flat: one(t, [[0.15, 0], [0.26, 1], [0.5, 1], [0.6, 0]]) }, undefined];
  r.mouth = one(t, [[0.5, 0], [0.56, 0.9], [0.7, 0.75], [0.8, 0]]);
  r.open = [false, false];
  r.leg[0] = euler(t, [[0.1, [2, 2, 0]], [0.3, [2, 2, 0]], [0.55, [12, 4, 0]], [0.86, [16, 5, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0.1, 4], [0.3, 14], [0.55, 6], [0.86, 20], [1, 4]]);
  r.knee[1] = one(t, [[0.1, 4], [0.3, 14], [0.55, 4], [0.86, 16], [1, 4]]);
};

/** Plague: the sickness breathed into cupped hands, stooping over them, then sown -- the right arm swept broad and low, scattering it. */
const plaguePose: CastPose = (r, t) => {
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.32, [-18, 0, 0]], [0.55, [-12, 0, 0]], [0.75, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.32, [-10, 0, 24]], [0.55, [-4, -4, -30]], [0.75, [-2, -2, -24]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.32, [-20, 0, -8]], [0.55, [-6, 0, 22]], [0.75, [-4, 0, 16]], [1, [0, 0, 0]]]);
  r.arm[1] = euler(t, [[0.1, [6, 10, 0]], [0.32, [44, -20, 34]], [0.42, [56, -34, 24]], [0.55, [76, 58, -14]], [0.75, [64, 62, -14]], [1, [8, 10, 0]]]);
  r.elbow[1] = one(t, [[0.1, 14], [0.32, 96], [0.42, 60], [0.55, 10], [0.75, 18], [1, 14]]);
  r.hand[1] = euler(t, [[0.1, [0, 0, 0]], [0.32, [0, 50, 0]], [0.55, [-10, -40, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0.1, [6, 10, 0]], [0.32, [44, -18, 34]], [0.45, [40, -6, 26]], [0.55, [26, 16, 6]], [1, [6, 10, 0]]]);
  r.elbow[0] = one(t, [[0.1, 14], [0.32, 96], [0.45, 90], [0.55, 70], [1, 14]]);
  r.hand[0] = euler(t, [[0.1, [0, 0, 0]], [0.32, [0, -50, 0]], [0.55, [0, -30, 0]], [1, [0, 0, 0]]]);
  // The hands brought together under the mouth, a bowl, and breathed into.
  const bowl = one(t, [[0.12, 0], [0.26, 1], [0.4, 1], [0.48, 0]]);
  r.reach = [goal([-0.35, 2.4, 10.4], bowl), goal([0.35, 2.4, 10.4], bowl)];
  const cup = one(t, [[0.12, 0], [0.24, 1], [0.42, 1], [0.48, 0]]);
  const sow = one(t, [[0.44, 0], [0.52, 1], [0.8, 1], [0.95, 0]]);
  r.shape = [{ cup, flat: sow * 0.6 }, { cup, flat: sow * 0.6, claw: sow * 0.4 }];
  r.mouth = one(t, [[0.2, 0], [0.26, 0.45], [0.4, 0.45], [0.46, 0]]);
  r.open = [false, false];
  r.leg[0] = euler(t, [[0.1, [2, 2, 0]], [0.32, [10, 4, 0]], [0.55, [22, 6, 0]], [0.8, [18, 5, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0.1, 4], [0.32, 24], [0.55, 22], [1, 4]]);
  r.leg[1] = euler(t, [[0.1, [2, 2, 0]], [0.32, [6, 4, 0]], [0.55, [-8, 4, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0.1, 4], [0.32, 24], [0.55, 14], [1, 4]]);
};

/** Panic: curled small round the dread, arms locked over the chest, then flung open and up, clawed, in a shriek, head thrown back. */
const panicPose: CastPose = (r, t, c) => {
  const s = t * c.timing.secs;
  const sh = bump(t, 0.45, 0.52, 0.8);
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.4, [-18, 0, 0]], [0.5, [10, 0, 0]], [0.72, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.4, [-12, 0, 0]], [0.5, [12, 0, 0]], [0.72, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.4, [-24, 0, 0]], [0.5, [28, 0, 0]], [0.72, [24, 0, 0]], [1, [0, 0, 0]]]);
  r.head[2] += shiver(s, 6, 5 * sh);
  const claw = one(t, [[0.44, 0], [0.5, 1], [0.8, 1], [0.94, 0]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0.1, [6, 10, 0]], [0.4, [58, -26, 44]], [0.5, [158, 48, -12]], [0.72, [150, 50, -12]], [1, [8, 10, 0]]]);
    r.elbow[k] = one(t, [[0.1, 14], [0.4, 136], [0.5, 22], [0.72, 30], [1, 14]]);
    r.arm[k][1] += shiver(s, 10, 3 * sh, k * 3);
    r.open[k] = false;
    r.leg[k] = euler(t, [[0.1, [2, 2, 0]], [0.4, [26, 6, 0]], [0.5, [0, 6, 0]], [0.72, [0, 6, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0.1, 4], [0.4, 50], [0.5, 2], [1, 4]]);
  }
  r.shape = [{ claw }, { claw }];
  r.mouth = one(t, [[0.44, 0], [0.5, 1], [0.76, 1], [0.9, 0]]);
};

/** Unmake: the thing held cupped up before the face, crushed between the hands with the whole body bent on it, and let fall from them open. */
const unmakePose: CastPose = (r, t) => {
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.32, [-4, 0, 0]], [0.5, [-14, 0, 0]], [0.55, [-14, 0, 0]], [0.75, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.32, [-2, 0, 0]], [0.5, [-12, 0, 0]], [0.75, [0, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.32, [-18, 0, 0]], [0.5, [-26, 0, 0]], [0.75, [-20, 0, 0]], [1, [0, 0, 0]]]);
  r.shrug = [one(t, [[0.3, 0], [0.5, 0.8], [0.62, 0]]), one(t, [[0.3, 0], [0.5, 0.8], [0.62, 0]])];
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0.1, [6, 10, 0]], [0.32, [44, -14, 30]], [0.46, [50, -18, 34]], [0.55, [46, -20, 36]], [0.75, [32, 34, -4]], [1, [8, 10, 0]]]);
    r.elbow[k] = one(t, [[0.1, 14], [0.32, 96], [0.46, 106], [0.55, 116], [0.75, 30], [1, 14]]);
    r.hand[k] = euler(t, [[0.1, [0, 0, 0]], [0.32, [0, (k ? 1 : -1) * 40, 0]], [0.55, [0, 0, 0]], [0.75, [10, (k ? -1 : 1) * 60, 0]], [1, [0, 0, 0]]]);
    r.open[k] = false;
    r.knee[k] = one(t, [[0.1, 4], [0.32, 6], [0.55, 22], [0.75, 8], [1, 4]]);
  }
  // Held in a bowl of the two hands, close before the face; the hands closing on it -- clawed, crushing -- and opening flat to let it go.
  const near = one(t, [[0.12, 0], [0.28, 1], [0.5, 1], [0.6, 0]]);
  const gap = 0.55 - 0.3 * smooth(seg(t, 0.36, 0.52));
  r.reach = [goal([-gap, 2.3, 11.2], near), goal([gap, 2.3, 11.2], near)];
  const cup = one(t, [[0.12, 0], [0.24, 1], [0.38, 1], [0.48, 0]]);
  const claw = one(t, [[0.38, 0], [0.48, 1], [0.56, 1], [0.6, 0]]);
  const flat = one(t, [[0.56, 0], [0.62, 1], [0.86, 1], [0.96, 0]]);
  r.shape = [{ cup, claw, flat }, { cup, claw, flat }];
  r.mouth = one(t, [[0.44, 0], [0.5, 0.3], [0.58, 0]]);
};

/** Soul Rend: both hands clawed out at the creature, low and leaning, then torn apart and back with a snarl, as though something were ripped between them. */
const soulRendPose: CastPose = (r, t) => {
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.4, [-16, 0, 0]], [0.5, [12, 0, 0]], [0.7, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.4, [-10, 0, 0]], [0.5, [14, 0, 0]], [0.7, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.4, [-2, 0, 0]], [0.5, [10, 0, 0]], [0.7, [6, 0, 0]], [1, [0, 0, 0]]]);
  const claw = one(t, [[0.12, 0], [0.3, 1], [0.8, 1], [0.95, 0]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0.1, [6, 10, 0]], [0.4, [92, -4, 14]], [0.45, [96, -2, 12]], [0.5, [78, 74, -24]], [0.7, [70, 80, -24]], [1, [8, 10, 0]]]);
    r.elbow[k] = one(t, [[0.1, 14], [0.4, 22], [0.45, 30], [0.5, 50], [0.7, 46], [1, 14]]);
    r.hand[k] = euler(t, [[0.1, [0, 0, 0]], [0.4, [-40, 0, 0]], [0.5, [20, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = false;
  }
  r.shape = [{ claw }, { claw }];
  r.mouth = one(t, [[0.44, 0], [0.5, 0.65], [0.7, 0.5], [0.85, 0]]);
  r.leg[0] = euler(t, [[0.1, [2, 2, 0]], [0.4, [30, 5, 0]], [0.5, [18, 5, 0]], [0.7, [16, 5, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0.1, 4], [0.4, 34], [0.5, 14], [1, 4]]);
  r.leg[1] = euler(t, [[0.1, [2, 2, 0]], [0.4, [-6, 3, 0]], [0.5, [-16, 3, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0.1, 4], [0.4, 26], [0.5, 10], [1, 4]]);
};

/** Shroud: both hands raised flat behind the crown and drawn down over the head and round the shoulders, as a hood is, the body folding into it. */
const shroudPose: CastPose = (r, t) => {
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.3, [4, 0, 0]], [0.55, [-14, 0, 0]], [0.78, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.3, [4, 0, 0]], [0.55, [-10, 0, 0]], [0.78, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.3, [-16, 0, 0]], [0.55, [-22, 0, 0]], [0.78, [-18, 0, 0]], [1, [0, 0, 0]]]);
  const flat = one(t, [[0.14, 0], [0.26, 1], [0.8, 1], [0.95, 0]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0.1, [6, 10, 0]], [0.3, [168, 22, -4]], [0.42, [120, -4, 20]], [0.55, [50, -26, 44]], [0.78, [48, -24, 42]], [1, [8, 10, 0]]]);
    r.elbow[k] = one(t, [[0.1, 14], [0.3, 96], [0.42, 140], [0.55, 128], [0.78, 124], [1, 14]]);
    r.open[k] = false;
    r.knee[k] = one(t, [[0.1, 4], [0.3, 2], [0.55, 26], [0.78, 22], [1, 4]]);
    r.leg[k] = euler(t, [[0.1, [2, 2, 0]], [0.55, [12, 3, 0]], [0.78, [10, 3, 0]], [1, [2, 2, 0]]]);
  }
  // Then the hood held shut at the throat: the hands crossed on the far shoulders.
  const held = one(t, [[0.46, 0], [0.56, 1], [0.8, 1], [0.92, 0]]);
  r.reach = [goal([0.9, 1.1, 11.6], held), goal([-0.9, 1.1, 11.4], held)];
  r.shape = [{ flat }, { flat }];
};

/** Blood Feast: palms turned up flat low at the sides to draw the blood out of the ground, then raised cupped to the mouth and drunk, head back. */
const bloodFeastPose: CastPose = (r, t) => {
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.3, [-8, 0, 0]], [0.55, [10, 0, 0]], [0.78, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.3, [-6, 0, 0]], [0.55, [10, 0, 0]], [0.78, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.3, [-22, 0, 0]], [0.48, [-4, 0, 0]], [0.55, [26, 0, 0]], [0.78, [18, 0, 0]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0.1, [6, 10, 0]], [0.3, [24, 34, -14]], [0.48, [80, -14, 34]], [0.55, [96, -14, 34]], [0.78, [42, -18, 38]], [1, [8, 10, 0]]]);
    r.elbow[k] = one(t, [[0.1, 14], [0.3, 30], [0.48, 140], [0.55, 140], [0.78, 118], [1, 14]]);
    r.hand[k] = euler(t, [[0.1, [0, 0, 0]], [0.3, [0, (k ? -1 : 1) * 80, 0]], [0.48, [0, (k ? 1 : -1) * 50, 0]], [0.78, [0, 0, 0]]]);
    r.open[k] = false;
    r.knee[k] = one(t, [[0.1, 4], [0.3, 18], [0.55, 2], [1, 4]]);
  }
  // The cupped hands to the lips, wherever the head has gone back to.
  const drink = one(t, [[0.4, 0], [0.5, 1], [0.6, 1], [0.7, 0]]);
  r.reach = [goal([-0.32, 1.7, 13.0], drink), goal([0.32, 1.7, 13.0], drink)];
  const flat = one(t, [[0.12, 0], [0.22, 1], [0.38, 1], [0.44, 0]]);
  const cup = one(t, [[0.38, 0], [0.46, 1], [0.66, 1], [0.76, 0]]);
  r.shape = [{ flat, cup }, { flat, cup }];
  r.mouth = one(t, [[0.44, 0], [0.5, 0.55], [0.62, 0.5], [0.72, 0]]);
};

/** Cataclysm: arms raised clawed to call it, then down on one knee with both palms slammed flat on the earth, then up and flung open with a shout as it breaks. */
const cataclysmPose: CastPose = (r, t) => {
  r.spine = euler(t, [[0.08, [0, 0, 0]], [0.22, [10, 0, 0]], [0.42, [-20, 0, 0]], [0.5, [-22, 0, 0]], [0.66, [12, 0, 0]], [0.8, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.08, [0, 0, 0]], [0.22, [8, 0, 0]], [0.42, [-10, 0, 0]], [0.5, [-10, 0, 0]], [0.66, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.08, [0, 0, 0]], [0.22, [24, 0, 0]], [0.42, [10, 0, 0]], [0.5, [16, 0, 0]], [0.66, [26, 0, 0]], [0.8, [20, 0, 0]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0.08, [6, 10, 0]], [0.22, [168, 22, -4]], [0.42, [76, 14, 0]], [0.5, [70, 16, 0]], [0.66, [150, 52, -10]], [0.8, [146, 54, -10]], [1, [8, 10, 0]]]);
    r.elbow[k] = one(t, [[0.08, 14], [0.22, 14], [0.42, 8], [0.5, 10], [0.66, 20], [1, 14]]);
    r.hand[k] = euler(t, [[0.22, [0, 0, 0]], [0.42, [60, 0, 0]], [0.5, [70, 0, 0]], [0.62, [0, 0, 0]]]);
    r.open[k] = false;
  }
  // Down onto the right knee as the hands come down, the palms put flat on the ground before it, and back up for the blast.
  r.kneel = one(t, [[0.24, 0], [0.4, 1], [0.54, 1], [0.66, 0]]);
  const slam = one(t, [[0.3, 0], [0.4, 1], [0.53, 1], [0.6, 0]]);
  r.reach = [goal([-1.0, 3.6, 0.5], slam, { stoop: true }), goal([1.0, 3.6, 0.5], slam, { stoop: true })];
  r.shape = [{ claw: one(t, [[0.1, 0], [0.2, 1], [0.32, 0]]) + one(t, [[0.6, 0], [0.66, 1], [0.84, 1], [0.96, 0]]), flat: slam }, { claw: one(t, [[0.1, 0], [0.2, 1], [0.32, 0]]) + one(t, [[0.6, 0], [0.66, 1], [0.84, 1], [0.96, 0]]), flat: slam }];
  r.mouth = one(t, [[0.2, 0], [0.24, 0.5], [0.32, 0], [0.56, 0], [0.62, 1], [0.82, 0.9], [0.94, 0]]);
};

/** Abyssal Gaze: the eyes covered with both hands and the head bowed, then the hands drawn slowly apart, fingers spread, and the stare lifted straight at it. */
const abyssalGazePose: CastPose = (r, t) => {
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.36, [-10, 0, 0]], [0.55, [-2, 0, 0]], [0.84, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.36, [-8, 0, 0]], [0.55, [2, 0, 0]], [0.84, [0, 0, 0]], [1, [0, 0, 0]]]);
  r.neck = euler(t, [[0.1, [0, 0, 0]], [0.36, [-10, 0, 0]], [0.55, [-8, 0, 0]], [0.84, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.36, [-24, 0, 0]], [0.48, [-12, 0, 0]], [0.55, [6, 0, 0]], [0.84, [4, 0, 0]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0.1, [6, 10, 0]], [0.36, [92, -10, 40]], [0.48, [104, 18, 16]], [0.55, [72, 36, -6]], [0.84, [34, 34, -16]], [1, [8, 10, 0]]]);
    r.elbow[k] = one(t, [[0.1, 14], [0.36, 142], [0.48, 110], [0.55, 40], [0.84, 20], [1, 14]]);
    r.hand[k] = euler(t, [[0.36, [10, 0, 0]], [0.55, [-20, 0, 0]], [0.84, [-30, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = false;
  }
  // Over the eyes, then parted slowly to either side of them, the face showing between.
  const cover = one(t, [[0.12, 0], [0.3, 1], [0.4, 1], [0.5, 0]]);
  const part = smooth(seg(t, 0.36, 0.5));
  r.reach = [goal([EYES(-1)[0] - 1.2 * part, EYES(-1)[1], EYES(-1)[2]], cover), goal([EYES(1)[0] + 1.2 * part, EYES(1)[1], EYES(1)[2]], cover)];
  const flat = one(t, [[0.12, 0], [0.26, 1], [0.38, 1], [0.48, 0]]);
  const claw = one(t, [[0.38, 0], [0.5, 0.7], [0.84, 0.7], [0.96, 0]]);
  r.shape = [{ flat, claw }, { flat, claw }];
};

/** Undying: down on one knee with the hands laid on the far shoulders, as the dead are laid, then the head flung back with a roar and the arms opened, and up. */
const undyingPose: CastPose = (r, t) => {
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.36, [-8, 0, 0]], [0.5, [-10, 0, 0]], [0.58, [8, 0, 0]], [0.76, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.36, [-6, 0, 0]], [0.5, [-6, 0, 0]], [0.58, [12, 0, 0]], [0.76, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.36, [-28, 0, 0]], [0.5, [-30, 0, 0]], [0.58, [28, 0, 0]], [0.76, [20, 0, 0]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0.1, [6, 10, 0]], [0.36, [56, -30, 48]], [0.5, [56, -30, 48]], [0.58, [44, 70, -14]], [0.76, [40, 66, -14]], [1, [8, 10, 0]]]);
    r.elbow[k] = one(t, [[0.1, 14], [0.36, 142], [0.5, 142], [0.58, 20], [0.76, 26], [1, 14]]);
    r.open[k] = false;
  }
  const laid = one(t, [[0.14, 0], [0.3, 1], [0.5, 1], [0.56, 0]]);
  r.reach = [goal(FAR_SHOULDER(0), laid), goal(FAR_SHOULDER(1), laid)];
  r.kneel = one(t, [[0.12, 0], [0.34, 1], [0.56, 1], [0.76, 0]]);
  const flat = one(t, [[0.14, 0], [0.26, 1], [0.52, 1], [0.56, 0]]);
  const claw = one(t, [[0.54, 0], [0.6, 1], [0.84, 1], [0.95, 0]]);
  r.shape = [{ flat, claw }, { flat, claw }];
  r.mouth = one(t, [[0.54, 0], [0.6, 1], [0.78, 0.8], [0.9, 0]]);
};

/* ---- the effects -------------------------------------------------------------------- */

const HEX = 'chaos_hex';
const FRIGHT = 'chaos_fright';
const PLAGUE = 'chaos_plague';
const PANIC = 'chaos_panic';
const SHROUD = 'chaos_shroud';
const CATACLYSM = 'chaos_cataclysm';
const GAZE = 'chaos_abyssal_gaze';

/** In over the first `inS` seconds of a linger and out over the last `outS`. */
const fadeOf = (age: number, left: number, inS = 0.4, outS = 0.8): number => smooth(age / inS) * smooth(left / outS);

export const CHAOS: Record<string, SpellVisual> = {
  // Hex (curse, on enemy, lasts 15 s): The creature bleeds 2% of its health a second for 15 s, 30% in all.
  chaos_hex: {
    palette: PALETTE,
    cast: { timing: { secs: 1.1, release: 0.5 }, pose: hexPose },
    fx: {
      // The words said into the fingers: a green breath at the lips, and the runes taking shape in it.
      charge: (k, t) => {
        const g = bump(t, 0.16, 0.42, 0.52);
        if (g <= 0) return;
        const at = k.hand(1);
        k.glow(at, 5, 0.7 * g, k.pal.accent);
        rune(k, { x: at.x, y: at.y, z: at.z + 1.2 }, 2.2 * g, Math.floor(k.now * 6), { alpha: g, turn: k.now * 3 });
      },
      release: (k) => {
        const a = k.hand(1);
        k.state.ax = a.x; k.state.ay = a.y; k.state.az = a.z;
        k.burst(a, 8, { kind: 'mote', colour: [k.pal.accent, k.pal.core], size: 1.6, life: [0.2, 0.4], speed: [0.2, 0.6], up: [0, 6], heading: k.toward(k.caster, k.target), cone: 1, gravity: 0 });
      },
      // Three runes drift over to it on a wavering line, slowly: a hex is muttered, not thrown.
      travel: { secs: (tiles) => 0.2 + tiles * 0.09, draw: (k, u) => {
        const from = { x: k.state.ax, y: k.state.ay, z: k.state.az }, to = k.heart(k.target);
        for (let i = 0; i < 3; i++) {
          const v = clamp(u * 1.25 - i * 0.12);
          if (v <= 0) continue;
          const p = arcAt(from, to, easeIn(v) * 0.4 + v * 0.6, 3 + i * 2);
          const side = Math.sin(v * 9 + i * 2.1) * 0.12 * (1 - v);
          p.x += side * 0.7; p.y -= side * 0.7;
          rune(k, p, 3.4, i, { turn: k.now * 2 + i, alpha: smooth(v * 6) });
          k.emit(p, 14, { kind: 'mote', colour: k.pal.accent, size: 1.2, life: [0.2, 0.4], speed: [0, 0.05], up: [-2, 2], gravity: 0 });
        }
      } },
      hit: (k) => {
        k.burst(k.heart(k.target), 14, { kind: 'shard', colour: [k.pal.main, k.pal.deep], size: 1.8, life: [0.3, 0.5], speed: [0.4, 1], up: [4, 14], gravity: 40 });
        bleed(k, k.heart(k.target), 8, 0.08);
      },
      // The words close on it: the three runes swinging in from wide to a tight ring round it, and blood at once.
      impact: { secs: 0.55, draw: (k, u) => {
        const b = k.target, R = footR(b) * (2.4 - 1.4 * easeOut(u * 1.6));
        hexRunes(k, b, R, u * 5, 1);
        k.flare(k.heart(b), 9 * (1 - u), flashOf(u), k.pal.accent);
      } },
      // Bleeding a beat a second for its seconds: the runes going round it, each flaring on the beat as drops fall off it, the time running out under it.
      linger: { draw: (k, age, left) => {
        const b = k.target, a = fadeOf(age, left);
        const beat = bump(age % 1, 0, 0.06, 0.35);
        hexRunes(k, b, footR(b), 5 + age * 1.1, a, beat);
        if (ticked(k, age, 'beat') && left > 0.5) bleed(k, k.heart(b), 4, 0.06);
        timeArc(k, b, footR(b), left / lastsOf(HEX), { alpha: 0.6 * a });
      } },
    },
  },

  // Fright (curse, on enemy, lasts 8 s): The creature flees from you for 8 s.
  chaos_fright: {
    palette: PALETTE,
    cast: { timing: { secs: 0.9, release: 0.46 }, pose: frightPose },
    fx: {
      charge: (k, t) => {
        // Dread pooling behind the hands.
        const g = bump(t, 0.12, 0.42, 0.5);
        if (g > 0) k.glow(k.head(), 6, 0.6 * g, k.pal.deep);
      },
      release: (k) => {
        k.burst(k.head(), 10, { kind: 'smoke', colour: [k.pal.deep, k.pal.ink], size: 2.4, life: [0.3, 0.6], speed: [0.4, 0.9], up: [0, 4], heading: k.toward(k.caster, k.target), cone: 1.1, gravity: -2 });
      },
      // The shriek going out to it: three crescents, each wider and fainter than the last, quick, bowed toward it.
      travel: { secs: (tiles) => 0.08 + tiles * 0.045, draw: (k, u) => {
        const from = k.head(), to = k.heart(k.target);
        const dir = k.toward(k.caster, k.target);
        for (let i = 0; i < 3; i++) {
          const v = clamp(u * 1.5 - i * 0.22);
          if (v <= 0 || v >= 1) continue;
          const c = mid3(from, to, v);
          const half = 0.08 + 0.22 * v, bow = 0.1 * (0.4 + v);
          const pts: P3[] = [];
          for (let j = 0; j <= 8; j++) {
            const s = j / 4 - 1;
            pts.push({ x: c.x - dir.y * s * half - dir.x * bow * s * s, y: c.y + dir.x * s * half - dir.y * bow * s * s, z: c.z - 2 * s * s });
          }
          k.ribbon(pts, { width: 3.4 * (1 - v * 0.35), taper: 'both', alpha: 0.95 * (1 - v * 0.6), main: k.pal.main, core: k.pal.core, glow: 0.6 });
        }
      } },
      hit: (k) => {
        k.burst(k.at(k.target, 0.85), 8, { kind: 'drop', colour: ['#dff4ff', '#9fc4e8'], size: 1.4, life: [0.25, 0.45], speed: [0.3, 0.7], up: [10, 20], gravity: 60 });
      },
      // Startled: the jolt over its head, jumping up out of it.
      impact: { secs: 0.45, draw: (k, u) => {
        const b = k.target;
        startle(k, k.at(b, 1.02 + 0.12 * easeOut(u * 2)), 5 * (0.6 + 0.4 * easeOut(u * 3)), { shake: 1.2 });
      } },
      // Fleeing: the jolt still shaking over it, and dread smoking off it on the side away from you, the way it runs.
      linger: { draw: (k, age, left) => {
        const b = k.target, a = fadeOf(age, left, 0.2);
        startle(k, k.at(b, 1.14), 5, { alpha: 0.9 * a, shake: 0.8 });
        const away = k.toward(k.caster, b);
        k.emit(k.at(b, 0.7), 9 * a, { kind: 'smoke', colour: [k.pal.deep, k.pal.ink], size: 1.8, life: [0.4, 0.7], speed: [0.3, 0.6], up: [2, 6], heading: away, cone: 0.7, gravity: -2, jitter: 0.06 });
        timeArc(k, b, footR(b), left / lastsOf(FRIGHT), { alpha: 0.6 * a });
      } },
    },
  },

  // Blood Price (pray, on self): Costs no favour.
  chaos_blood_price: {
    palette: PALETTE,
    cast: { timing: { secs: 1.6, release: 0.58 }, pose: bloodPricePose },
    fx: {
      charge: (k, t) => {
        const palm = k.hand(0);
        // The cut: a red line drawn across the palm by the passing hand, and the blood after it.
        if (t > 0.3 && t < 0.42) k.ribbon([k.hand(1), mid3(k.hand(1), palm, 0.5)], { width: 1.6, taper: 'start', alpha: 0.9, ...bloodLook, glow: 0 });
        if (t > 0.34) k.emit(palm, t < 0.58 ? 20 : 6, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.6, life: [0.4, 0.6], speed: [0, 0.06], up: [-4, 0], gravity: 70, drag: 0.5, jitter: 0.02, bias: 2 });
        if (t > 0.34 && !k.state.cut) {
          k.state.cut = 1;
          bleed(k, palm, 6, 0.02);
        }
        // What is paid gathering in the raised palm, red going over to the patron's violet.
        const g = smooth(seg(t, 0.42, 0.58));
        if (g > 0) k.orb({ x: palm.x, y: palm.y, z: palm.z + 2 }, 1.2 + 1.6 * g, { alpha: g * (1 - seg(t, 0.58, 0.6)), ...bloodLook, turn: k.now * 2 });
        pool(k, k.local(k.caster, -3, 3, 0), 0.03 + 0.05 * smooth(seg(t, 0.36, 0.6)), BLOOD_DEEP, 0.75 * smooth(seg(t, 0.36, 0.5)) * (1 - seg(t, 0.85, 1)), 3);
      },
      hit: (k) => {
        const palm = k.hand(0);
        k.burst({ x: palm.x, y: palm.y, z: palm.z + 2 }, 18, { kind: 'ember', colour: [BLOOD_CORE, k.pal.main], fade: k.pal.light, size: 1.8, life: [0.4, 0.8], speed: [0.1, 0.4], up: [8, 22], gravity: 0, drag: 0.3 });
      },
      // Taken: the blood goes up off the palm as violet and comes down into the head as favour, and the star under the feet answers.
      impact: { secs: 1.0, draw: (k, u) => {
        const palm = k.hand(0);
        const top = { x: palm.x, y: palm.y, z: palm.z + 2 + 6 * easeOut(u * 2) };
        const into = mid3(top, k.head(), easeIn(seg(u, 0.4, 0.9)));
        const col = mixColour(BLOOD, k.pal.main, smooth(u * 2.2));
        k.orb(into, 2.8 * (1 - 0.6 * seg(u, 0.6, 1)), { alpha: 1 - seg(u, 0.85, 1), main: col, deep: k.pal.deep, core: k.pal.core, turn: u * 6 });
        chaosStar(k, k.caster, 0.55, { grow: easeOut(u * 3), turn: -0.2 + u * 0.3, alpha: flashOf(u, 0.25) * 0.9 });
        k.light(k.caster, 2, 0.5 * flashOf(u, 0.2));
        if (u > 0.85 && !k.state.took) {
          k.state.took = 1;
          k.burst(k.head(), 10, { kind: 'mote', colour: [k.pal.core, k.pal.light], size: 1.8, life: [0.3, 0.6], speed: [0.1, 0.4], up: [4, 10], gravity: 0 });
        }
      } },
    },
  },

  // Siphon (bolt, on enemy): Takes 10% of the creature's health, and heals you by what a blow of that much would take from you.
  chaos_siphon: {
    palette: PALETTE,
    cast: { timing: { secs: 1.3, release: 0.42 }, pose: siphonPose },
    fx: {
      // The reach: a thin dark thread feeling its way out of the clawed hand to the creature.
      charge: (k, t) => {
        const g = smooth(seg(t, 0.24, 0.42));
        if (g <= 0 || t > 0.44) return;
        const from = k.hand(1), to = k.heart(k.target);
        k.bolt(from, mid3(from, to, g), { width: 1.2, jag: 3, fork: 0, alpha: 0.7, main: k.pal.deep, core: k.pal.main, glow: 0.4 });
        k.glow(from, 4, 0.6 * g);
      },
      // Caught: its blood pulled out of it in a spurt toward you.
      release: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 14, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 2, life: [0.3, 0.55], speed: [0.4, 1], up: [4, 14], heading: k.toward(k.target, k.caster), cone: 1.2, gravity: 50, drag: 0.4 });
        rift(k, at, { len: 5, wide: 3, open: 1, alpha: 0.9 });
      },
      // Hauled in: a tether from it to your hand, and beads of its life running down it to you.
      travel: { secs: (tiles) => 0.3 + tiles * 0.08, draw: (k, u) => {
        const from = k.heart(k.target), to = k.hand(1);
        const lift = 2 + k.dist * 1.5;
        const pts: P3[] = [];
        for (let i = 0; i <= 8; i++) pts.push(arcAt(from, to, i / 8, lift));
        k.ribbon(pts, { width: 1.6, taper: 'both', alpha: 0.75 * (1 - seg(u, 0.85, 1)), main: k.pal.deep, core: BLOOD });
        for (let i = 0; i < 5; i++) {
          const v = u * 1.4 - i * 0.1;
          if (v <= 0 || v >= 1) continue;
          const p = arcAt(from, to, easeIn(v) * 0.5 + v * 0.5, lift);
          k.orb(p, 1.8 + 0.6 * (i === 0 ? 1 : 0), { ...bloodLook, ink: k.pal.ink, glow: 0.5, turn: k.now * 5 + i });
        }
        k.light(to, 2, 0.4 * u);
      } },
      // Into you: the blood turns to the patron's green as it reaches the hand, and runs through you.
      hit: (k) => {
        k.burst(k.hand(1), 16, { kind: 'mote', colour: [k.pal.accent, k.pal.core], size: 1.8, life: [0.3, 0.6], speed: [0.2, 0.6], up: [2, 12], gravity: 0 });
      },
      impact: { secs: 0.7, draw: (k, u) => {
        k.shell(k.caster, { alpha: 0.4 * flashOf(u, 0.15), size: 0.85 + 0.1 * u, main: k.pal.accent, deep: '#2f7a28', core: '#e6ffe0', glow: 0.5 });
        k.ring(k.caster, 0.12 + footR(k.caster) * easeOut(u), { band: 0.04, alpha: 0.9 * (1 - u), main: k.pal.accent, deep: '#2f7a28', glow: 0.5 });
        k.emit(k.at(k.caster, 0.3), 20 * (1 - u), { kind: 'mote', colour: k.pal.accent, size: 1.4, life: [0.4, 0.7], speed: [0, 0.05], up: [10, 18], gravity: 0, jitter: 0.12 });
      } },
    },
  },

  // Cower (curse, on enemy, lasts 30 s): For 30 s the creature's blows do 30% less damage.
  chaos_cower: {
    palette: PALETTE,
    cast: { timing: { secs: 1.2, release: 0.55 }, pose: cowerPose },
    fx: {
      charge: (k, t) => {
        // Weight gathering in the raised palm, and over the creature a dark yoke of talons forming high up.
        const g = smooth(seg(t, 0.2, 0.5));
        if (g <= 0 || t > 0.56) return;
        k.glow(k.hand(1), 5, 0.7 * g, k.pal.deep);
        k.emit(k.hand(1), 14 * g, { kind: 'smoke', colour: [k.pal.deep, k.pal.ink], size: 1.6, life: [0.3, 0.5], speed: [0, 0.05], up: [-8, -4], gravity: 6 });
        const b = k.target;
        thorns(k, b, { R: Math.max(0.14, b.wide / 28) * 1.4, z: b.tall * (1.6 + 0.2 * (1 - g)), n: 5, len: 3.6, dir: 'down', width: 1.8, turn: 0.2, grow: g, alpha: 0.8 * g, main: k.pal.main, deep: k.pal.ink });
      },
      // Pressed down onto it, with the palm.
      impact: { secs: 0.6, draw: (k, u) => {
        const b = k.target, w = Math.max(0.14, b.wide / 28);
        const down = easeIn(clamp(u * 2.2));
        thorns(k, b, { R: w * (1.4 - 0.35 * down), z: b.tall * (1.6 - 0.75 * down), n: 5, len: 3.6, dir: 'down', width: 1.8, turn: 0.2, main: k.pal.main, deep: k.pal.ink });
        if (u > 0.45 && !k.state.thud) {
          k.state.thud = 1;
          k.burst(k.at(b, 0.05), 10, { kind: 'dust', colour: '#6a5a74', size: 2.6, life: [0.4, 0.7], speed: [0.3, 0.7], up: [1, 4], gravity: 2, drag: 0.2 });
        }
        k.ring(b, w * (1 + 2 * seg(u, 0.45, 1)), { band: 0.05, alpha: 0.8 * (1 - seg(u, 0.45, 1)) * (u > 0.45 ? 1 : 0), glow: 0.4 });
      } },
      // Bowed under it while it lasts: the talons on its shoulders, sagging with each breath, and its strength trickling out of it.
      linger: { draw: (k, age, left) => {
        const b = k.target, a = fadeOf(age, left), w = Math.max(0.14, b.wide / 28);
        const sag = 0.04 * Math.sin(age * 2.2);
        thorns(k, b, { R: w * 1.05, z: b.tall * (0.85 + sag), n: 5, len: 3.6, dir: 'down', width: 1.8, turn: 0.2, alpha: 0.8 * a, main: k.pal.main, deep: k.pal.ink });
        k.emit(k.at(b, 0.75), 4 * a, { kind: 'mote', colour: k.pal.deep, size: 1.4, life: [0.5, 0.8], speed: [0, 0.04], up: [-10, -6], gravity: 0, jitter: 0.08 });
        timeArc(k, b, footR(b), left / (lastsOf('chaos_cower') || 1), { alpha: 0.7 * a });
      } },
    },
  },

  // Pact (pray, on self, lasts 60 s): Costs no favour.
  chaos_pact: {
    palette: PALETTE,
    cast: { timing: { secs: 1.5, release: 0.55 }, pose: pactPose },
    fx: {
      charge: (k, t) => {
        // The fist on the heart; then pulled out of it with the blood following.
        const heart = k.chest();
        k.glow(heart, 5, 0.7 * bump(t, 0.15, 0.3, 0.42), BLOOD);
        if (t > 0.3 && t < 0.56) {
          const pts: P3[] = [];
          for (let i = 0; i <= 4; i++) pts.push(mid3(heart, k.hand(1), i / 4));
          k.ribbon(pts, { width: 2.2, taper: 'start', alpha: 0.85 * bump(t, 0.3, 0.4, 0.56), ...bloodLook, ink: k.pal.ink });
          k.emit(k.hand(1), 24, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.6, life: [0.3, 0.5], speed: [0, 0.1], up: [-2, 4], gravity: 60, bias: 2 });
        }
      },
      // Sealed: the fist held high, thorns closing round the wrist that strikes.
      hit: (k) => {
        k.burst(k.hand(1), 20, { kind: 'ember', colour: [BLOOD_CORE, k.pal.main, k.pal.accent], size: 1.8, life: [0.3, 0.6], speed: [0.3, 0.8], up: [4, 16], gravity: 20 });
        k.flash(0.04, BLOOD);
      },
      impact: { secs: 0.8, draw: (k, u) => {
        const fist = k.hand(1);
        thorns(k, { x: fist.x, y: fist.y, z: fist.z - 1.2 }, { R: 0.035 + 0.1 * (1 - easeOut(u * 2)), z: 0, n: 5, len: 1.4, dir: 'in', turn: u * 2, alpha: 1 - seg(u, 0.8, 1) * 0.3, width: 0.9, main: BLOOD, deep: BLOOD_DEEP });
        chaosStar(k, k.caster, 0.6, { grow: easeOut(u * 2.5), turn: 0.2 - u * 0.4, alpha: flashOf(u, 0.2) });
        k.light(k.caster, 2.5, 0.6 * flashOf(u, 0.15), '#c0304a');
      } },
      // While it lasts: the striking hand bound in thorns, smouldering; the time under the feet.
      linger: { on: 'caster', draw: (k, age, left) => {
        const a = fadeOf(age, left), fist = k.hand(1);
        const beat = bump((age * 0.9) % 1, 0, 0.08, 0.5);
        thorns(k, { x: fist.x, y: fist.y, z: fist.z - 1.2 }, { R: 0.035, z: 0, n: 5, len: 1.4, dir: 'in', turn: age * 0.6, alpha: 0.85 * a, width: 0.9, main: BLOOD, deep: BLOOD_DEEP });
        k.glow(fist, 4 + 2 * beat, (0.35 + 0.35 * beat) * a, BLOOD);
        if (!k.fast) k.emit(fist, 5 * a, { kind: 'ember', colour: [BLOOD_CORE, k.pal.main], size: 1.3, life: [0.3, 0.6], speed: [0, 0.05], up: [4, 10], gravity: 0, jitter: 0.02 });
        timeArc(k, k.caster, footR(k.caster), left / (lastsOf('chaos_pact') || 1), { alpha: 0.6 * a, main: BLOOD });
      } },
    },
  },

  // Plague (ground, on area, 5 tiles round, lasts 30 s): Every wild creature within 5 tiles of the spot bleeds 1.5% of its health a second for 30 s, 45% in all.
  chaos_plague: {
    palette: PALETTE,
    cast: { timing: { secs: 1.6, release: 0.55 }, pose: plaguePose },
    fx: {
      charge: (k, t) => {
        // Rot welling up in the cupped hands as they are held, then flung out of the right as it sweeps.
        const hands = mid3(k.hand(0), k.hand(1), 0.5);
        const g = bump(t, 0.12, 0.34, 0.46);
        if (g > 0) {
          k.orb(hands, 1 + 1.6 * g, { alpha: g, main: ROT, deep: ROT_DEEP, core: k.pal.accent, turn: k.now * 3 });
          k.emit(hands, 16 * g, { kind: 'smoke', colour: [ROT, ROT_DEEP], size: 1.4, life: [0.3, 0.6], speed: [0, 0.05], up: [2, 6], gravity: -2 });
        }
        if (t > 0.42 && t < 0.56) k.emit(k.hand(1), 70, { kind: 'mote', colour: [k.pal.accent, ROT], size: 1.6, life: [0.3, 0.6], speed: [0.6, 1.4], up: [2, 10], heading: k.toward(k.caster, k.spot), cone: 1.4, gravity: 20 });
      },
      // Sown: five gobbets of it arcing out to the spot, each its own way.
      travel: { secs: (tiles) => 0.3 + tiles * 0.07, draw: (k, u) => {
        const from = k.hand(1);
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * TAU + hashOf(k.seed, i);
          const rr = radiusOf(PLAGUE) * 0.18 * hashOf(k.seed + 5, i);
          const to = k.on(k.spot.x + Math.cos(ang) * rr, k.spot.y + Math.sin(ang) * rr, 1);
          const v = clamp(u * 1.15 - i * 0.03);
          const lift = 6 + k.dist * 2.5;
          const p = arcAt(from, to, v, lift);
          k.ribbon([arcAt(from, to, Math.max(0, v - 0.1), lift), arcAt(from, to, Math.max(0, v - 0.05), lift), p], { width: 2.2, alpha: 0.8, main: ROT, core: k.pal.accent, ink: ROT_DEEP, glow: 0.3 });
          k.orb(p, 1.8, { main: ROT, deep: ROT_DEEP, core: k.pal.accent, glow: 0.4, turn: k.now * 6 });
        }
      } },
      hit: (k) => {
        const c = k.on(k.spot.x, k.spot.y, 1);
        k.burst(c, 40, { kind: 'smoke', colour: [ROT, ROT_DEEP, k.pal.deep], size: 3, life: [0.6, 1.2], speed: [0.6, 1.6], up: [1, 6], gravity: -1, drag: 0.25 });
        k.burst(c, 16, { kind: 'drop', colour: [ROT, k.pal.accent], size: 1.8, life: [0.3, 0.6], speed: [0.5, 1.2], up: [10, 24], gravity: 60 });
      },
      // It spreads: a ragged pool of rot running out to the edge of what it sickens, the edge marked.
      impact: { secs: 1.2, draw: (k, u) => {
        const R = radiusOf(PLAGUE), e = easeOut(u * 1.3);
        blight(k, k.spot, R, e, 1);
        k.light(k.spot, R, 0.5 * (1 - u * 0.5), '#7dff6a');
      } },
      // Festering for its seconds: the pool bubbling, a green haze crawling over it, the edge and the time it has left.
      linger: { on: 'spot', draw: (k, age, left) => {
        const R = radiusOf(PLAGUE), a = fadeOf(age, left, 0.3, 1.5);
        blight(k, k.spot, R, 1, 0.8 * a);
        timeArc(k, k.spot, R - Math.max(0.12, R * 0.04) - 0.04, left / lastsOf(PLAGUE), { alpha: 0.8 * a, band: 0.1, main: ROT });
        k.emit(k.on(k.spot.x, k.spot.y, 2), 8 * a, { kind: 'smoke', colour: [ROT, ROT_DEEP], size: 3.4, life: [1, 1.8], speed: [0.02, 0.1], up: [2, 6], gravity: -1, jitter: R * 0.6 });
        // Every creature standing in it sick: a green pall over it, and on the beat its blood let.
        const beat = ticked(k, age, 'beat') && left > 0.5;
        for (const b of taken(k, k.spot, R)) {
          k.glow(k.at(b, 0.9), 5, 0.35 * a, ROT);
          if (beat) bleed(k, k.heart(b), 3, 0.06);
        }
        // A bubble breaks each second somewhere in it, on the same beat.
        if (beat) {
          const an = k.rand() * TAU, rr = Math.sqrt(k.rand()) * R * 0.8;
          k.burst(k.on(k.spot.x + Math.cos(an) * rr, k.spot.y + Math.sin(an) * rr, 1), 8, { kind: 'drop', colour: [ROT, k.pal.accent], size: 1.5, life: [0.3, 0.5], speed: [0.2, 0.5], up: [8, 16], gravity: 60 });
        }
        k.light(k.spot, R, 0.25 * a, '#7dff6a');
      } },
    },
  },

  // Panic (ground, on area, 6 tiles round, lasts 10 s): Every wild creature within 6 tiles of the spot flees from it for 10 s, a monster for 3 s.
  chaos_panic: {
    palette: PALETTE,
    cast: { timing: { secs: 1.3, release: 0.5 }, pose: panicPose },
    fx: {
      charge: (k, t) => {
        // Dread wound tight in the chest, and the star on the spot drawn in black as it builds.
        const g = smooth(seg(t, 0.12, 0.48));
        k.glow(k.chest(), 6, 0.7 * g * (1 - seg(t, 0.5, 0.56)), k.pal.deep);
        k.emit(k.chest(), 20 * g * (t < 0.5 ? 1 : 0), { kind: 'smoke', colour: [k.pal.ink, k.pal.deep], size: 1.4, life: [0.2, 0.4], speed: [0.1, 0.3], up: [-2, 2], gravity: 0, jitter: 0.12 });
      },
      release: (k) => {
        k.burst(k.head(), 16, { kind: 'mote', colour: [k.pal.core, k.pal.main], size: 2, life: [0.3, 0.5], speed: [0.6, 1.2], up: [8, 20], gravity: 10 });
      },
      // The shriek: everything round the spot thrown out from it in three quick shock rings, arrows racing out on the ground.
      hit: (k) => {
        k.burst(k.on(k.spot.x, k.spot.y, 2), 30, { kind: 'dust', colour: ['#5a4a66', '#3a2a44'], size: 3, life: [0.5, 0.9], speed: [radiusOf(PANIC) * 0.4, radiusOf(PANIC) * 0.9], up: [1, 5], gravity: 2, drag: 0.15 });
        k.flash(0.05, k.pal.deep);
      },
      impact: { secs: 0.9, draw: (k, u) => {
        const R = radiusOf(PANIC);
        for (let i = 0; i < 3; i++) {
          const v = clamp((u - i * 0.12) / 0.6);
          if (v <= 0 || v >= 1) continue;
          const rr = 0.2 + R * easeOut(v);
          k.ring(k.spot, rr, { band: Math.min(rr * 0.3, 0.2 * (1 - v)), alpha: 1 - v * v, turn: v * 0.5 + i, main: i === 1 ? k.pal.main : k.pal.deep, glow: 0.5 });
        }
        chevrons(k, k.spot, 0.4 + (R - 0.6) * easeOut(u * 1.2), 8, 0.45, { alpha: 1 - seg(u, 0.7, 1), turn: 0.2 });
        // The shock reaching each creature in turn: its arrowhead jumps up over it as the ring passes it.
        for (const b of taken(k, k.spot, R)) {
          const w = fleeWay(k, b);
          const reached = smooth(clamp((0.2 + R * easeOut(clamp(u / 0.6)) - w.d) * 2));
          fleeMark(k, b, w, 0.22 * (0.5 + 0.5 * reached), reached, 1 - reached);
        }
        k.light(k.spot, R, 0.7 * flashOf(u, 0.1));
      } },
      // While they run: arrowheads on the ground racing outward from the spot over and over, and the edge with its time on it.
      linger: { on: 'spot', draw: (k, age, left) => {
        const R = radiusOf(PANIC), a = fadeOf(age, left, 0.5, 1);
        for (let w = 0; w < 2; w++) {
          const cyc = (age * 0.55 + w * 0.5) % 1;
          chevrons(k, k.spot, 0.4 + (R - 0.7) * cyc, 8, 0.4, { alpha: 0.7 * a * Math.sin(Math.PI * cyc), turn: 0.2 + w * (TAU / 16) });
        }
        k.ring(k.spot, R, { band: 0.05, alpha: 0.3 * a, dash: 3, turn: -age * 0.1, glow: 0 });
        timeArc(k, k.spot, R, left / lastsOf(PANIC), { alpha: 0.8 * a, band: 0.1 });
        k.emit(k.on(k.spot.x, k.spot.y, 1), 6 * a, { kind: 'mote', colour: [k.pal.main, k.pal.core], size: 1.4, life: [0.6, 1], speed: [R * 0.5, R * 0.9], up: [0, 3], gravity: 0, drag: 1 });
        // Over every creature fleeing it -- in it, or just run out of it -- an arrowhead pointing the way it runs.
        const beat = bump((age * 2.2) % 1, 0, 0.12, 0.5);
        for (const b of taken(k, k.spot, R + 3)) {
          const w = fleeWay(k, b);
          const out = w.d > R ? 1 - (w.d - R) / 3 : 1;
          fleeMark(k, b, w, 0.22, 0.9 * a * out, beat);
        }
      } },
    },
  },

  // Unmake (pray, on object): Costs no favour.
  chaos_unmake: {
    palette: PALETTE,
    cast: { timing: { secs: 1.6, release: 0.55 }, pose: unmakePose },
    fx: {
      // The thing held up in the cupped hands, splitting with violet seams as the hands close on it.
      charge: (k, t) => {
        const at = mid3(k.hand(0), k.hand(1), 0.5);
        const held = smooth(seg(t, 0.08, 0.22)) * (t < 0.55 ? 1 : 0);
        if (held <= 0) return;
        const crush = smooth(seg(t, 0.36, 0.55));
        const p = { x: at.x, y: at.y, z: at.z + 1.4 * (1 - crush) };
        trinket(k, p, 2.6 * (1 - 0.25 * crush) * (0.4 + 0.6 * held), crush, held);
        if (crush > 0) {
          k.glow(p, 4 + 5 * crush, 0.8 * crush);
          k.emit(p, 30 * crush, { kind: 'spark', colour: [k.pal.core, k.pal.main], size: 1.2, life: [0.1, 0.25], speed: [0.2, 0.6], up: [-4, 8], gravity: 0 });
        }
      },
      // Unmade: it breaks to splinters and grit in the fists.
      hit: (k) => {
        const at = mid3(k.hand(0), k.hand(1), 0.5);
        k.burst(at, 24, { kind: 'shard', colour: STUFF, size: 1.8, life: [0.4, 0.8], speed: [0.3, 0.8], up: [4, 14], gravity: 50, spin: 3 });
        k.burst(at, 16, { kind: 'spark', colour: [k.pal.core, k.pal.main], size: 1.6, life: [0.2, 0.4], speed: [0.6, 1.4], up: [0, 12], gravity: 10 });
      },
      // What is left falls from the opened hands as dust, and rises again off it as the favour it was worth, into the head.
      impact: { secs: 1.1, draw: (k, u) => {
        const hands = [k.hand(0), k.hand(1)];
        if (u < 0.5) for (const h of hands) k.emit(h, 30 * (1 - u * 2), { kind: 'dust', colour: ['#7a6a5a', '#5a4e44'], size: 1.6, life: [0.4, 0.7], speed: [0, 0.05], up: [-6, -2], gravity: 20 });
        const rise = seg(u, 0.25, 0.95);
        if (rise > 0 && rise < 1) {
          const from = k.at(k.caster, 0.08), to = k.head();
          for (let i = 0; i < 3; i++) {
            const v = clamp(rise * 1.3 - i * 0.15);
            if (v <= 0 || v >= 1) continue;
            const an = i * 2.1 + v * 5;
            const p = mid3(from, to, easeIn(v));
            p.x += Math.cos(an) * 0.15 * (1 - v); p.y += Math.sin(an) * 0.15 * (1 - v);
            k.orb(p, 1.3, { turn: k.now * 5, glow: 0.6 });
          }
        }
        chaosStar(k, k.caster, 0.5, { grow: easeOut(u * 3), turn: u * 0.4, alpha: flashOf(u, 0.15) * 0.65 });
        k.light(k.caster, 2, 0.5 * flashOf(u, 0.1));
      } },
    },
  },

  // Soul Rend (bolt, on enemy): Takes 30% of the creature's health;
  chaos_soul_rend: {
    palette: PALETTE,
    cast: { timing: { secs: 1.4, release: 0.5 }, pose: soulRendPose },
    fx: {
      // Claws of light on both hands, and two spectral hands closing on it from either side.
      charge: (k, t) => {
        const g = smooth(seg(t, 0.15, 0.46));
        if (g <= 0 || t > 0.52) return;
        for (const s of [0, 1]) k.glow(k.hand(s), 4 + 2 * g, 0.7 * g);
        const b = k.target, at = k.heart(b), dir = k.toward(k.caster, b);
        const reach = Math.max(0.2, b.wide / 18) * (2.2 - 1.2 * g);
        for (const s of [-1, 1]) {
          // Each a hooked crescent, its open side to the creature: fingers curling round it.
          const pts: P3[] = [];
          for (let j = 0; j <= 5; j++) {
            const v = j / 5, an = (v - 0.5) * 2.2;
            const r = reach * (1 - 0.25 * v);
            pts.push({ x: at.x + (-dir.y * s * Math.cos(an) - dir.x * Math.sin(an) * 0.6) * r, y: at.y + (dir.x * s * Math.cos(an) - dir.y * Math.sin(an) * 0.6) * r, z: at.z + 3 * Math.sin(an) });
          }
          k.ribbon(pts, { width: 3.2, taper: 'both', alpha: 0.9 * g, main: k.pal.main, core: k.pal.core, glow: 0.6 });
        }
      },
      // Torn: the air opens across it and its soul is dragged out and ripped in two.
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 30, { kind: 'shard', colour: [k.pal.main, k.pal.deep, k.pal.ink], size: 2, life: [0.4, 0.8], speed: [0.6, 1.6], up: [6, 22], gravity: 40, spin: 3 });
        bleed(k, at, 14, 0.1);
        k.flash(0.06, k.pal.deep);
      },
      impact: { secs: 1.0, draw: (k, u) => {
        const b = k.target, at = k.heart(b);
        const open = u < 0.15 ? easeOut(u / 0.15) : 1 - smooth(seg(u, 0.5, 0.9));
        rift(k, at, { len: b.tall * 0.75, wide: 3.2, open, tilt: 0.35, alpha: 0.95 });
        // The soul: a pale wisp pulled up out of the tear, then split, each half flung its own way and fading.
        const up = easeOut(seg(u, 0.05, 0.35));
        const split = easeOut(seg(u, 0.3, 0.85));
        const away = k.toward(k.caster, b);
        const fade = 1 - seg(u, 0.65, 1);
        if (split < 0.05) soulWisp(k, { x: at.x, y: at.y, z: at.z + 6 * up }, at, 3.4, smooth(u * 10));
        else for (const s of [-1, 1]) {
          const p = { x: at.x + (-away.y * s * 0.18 + away.x * 0.05) * split, y: at.y + (away.x * s * 0.18 + away.y * 0.05) * split, z: at.z + 6 * up + 2 * split };
          soulWisp(k, p, { x: at.x, y: at.y, z: at.z + 6 * up }, 3 * (1 - 0.3 * split), fade);
        }
        k.light(b, 3, 0.8 * flashOf(u, 0.1));
      } },
    },
  },

  // Shroud (pray, on self, 3 tiles round, lasts 60 s): For 60 s nothing notices you from further than 3 tiles off, and whatever is hunting you from further than that loses you.
  chaos_shroud: {
    palette: PALETTE,
    cast: { timing: { secs: 1.5, release: 0.55 }, pose: shroudPose },
    fx: {
      // The dark poured down over the head from the raised hands, as the hood comes down.
      charge: (k, t) => {
        const g = bump(t, 0.2, 0.4, 0.58);
        if (g <= 0) return;
        k.emit(mid3(k.hand(0), k.hand(1), 0.5), 50 * g, { kind: 'smoke', colour: [k.pal.ink, k.pal.deep], size: 2.4, life: [0.4, 0.7], speed: [0.05, 0.2], up: [-12, -6], gravity: 4, jitter: 0.05 });
        k.shell(k.caster, { alpha: 0.5 * smooth(seg(t, 0.3, 0.55)), size: 1.15 - 0.2 * seg(t, 0.3, 0.55), main: k.pal.deep, deep: k.pal.ink, core: k.pal.main, glow: 0 });
      },
      // Veiled: a fog rolling off the feet to the edge past which nothing knows you are there, and settling at it.
      hit: (k) => {
        const R = radiusOf(SHROUD);
        k.burst(k.at(k.caster, 0.08), 40, { kind: 'smoke', colour: [k.pal.ink, k.pal.deep, '#2a1a3a'], size: 3.2, life: [0.6, 1.1], speed: [R * 0.6, R * 1.1], up: [0, 3], gravity: 0, drag: 0.15 });
      },
      impact: { secs: 1.0, draw: (k, u) => {
        const R = radiusOf(SHROUD);
        k.ring(k.caster, 0.2 + (R - 0.2) * easeOut(u), { band: 0.06, alpha: 0.7 * (1 - 0.4 * u), main: k.pal.deep, deep: k.pal.ink, glow: 0 });
        k.shell(k.caster, { alpha: 0.5 * (1 - u * 0.5), size: 0.95, main: k.pal.deep, deep: k.pal.ink, core: k.pal.main, glow: 0 });
      } },
      // While it holds: a thin dark veil round you, smoke curling off the feet, and the edge of the hidden ground with its time.
      linger: { on: 'caster', draw: (k, age, left) => {
        const R = radiusOf(SHROUD), a = fadeOf(age, left, 0.5, 1.5);
        k.shell(k.caster, { alpha: (0.2 + 0.05 * Math.sin(age * 1.7)) * a, size: 0.95, turn: age * 0.2, main: k.pal.deep, deep: k.pal.ink, core: k.pal.main, glow: 0 });
        k.ring(k.caster, R, { band: 0.04, alpha: 0.25 * a, dash: 4, turn: age * 0.08, main: k.pal.deep, deep: k.pal.ink, glow: 0 });
        timeArc(k, k.caster, R, left / lastsOf(SHROUD), { alpha: 0.6 * a, band: 0.07, main: k.pal.deep });
        k.emit(k.at(k.caster, 0.04), 8 * a, { kind: 'smoke', colour: [k.pal.ink, k.pal.deep], size: 2.2, life: [0.8, 1.4], speed: [0.05, 0.15], up: [0, 3], gravity: -1, jitter: 0.12 });
      } },
    },
  },

  // Blood Feast (pray, on self, lasts 60 s): Costs no favour.
  chaos_blood_feast: {
    palette: PALETTE,
    cast: { timing: { secs: 1.6, release: 0.55 }, pose: bloodFeastPose },
    fx: {
      // The blood drawn up out of the ground in five threads, round and in to the cupped hands.
      charge: (k, t) => {
        const g = smooth(seg(t, 0.15, 0.5));
        if (g <= 0 || t > 0.58) return;
        const into = mid3(k.hand(0), k.hand(1), 0.5);
        for (let i = 0; i < 5; i++) {
          const an = (i / 5) * TAU + t * 2.5;
          const from = k.on(k.caster.x + Math.cos(an) * 0.45, k.caster.y + Math.sin(an) * 0.45, 0.5);
          const head = clamp(g * 1.2 - i * 0.04);
          const pts: P3[] = [];
          for (let j = 0; j <= 4; j++) pts.push(arcAt(from, into, Math.max(0, head - 0.45 + (j / 4) * 0.45), 4));
          k.ribbon(pts, { width: 1.4, taper: 'both', alpha: 0.85, ...bloodLook, ink: k.pal.ink, glow: 0.3 });
          pool(k, from, 0.05, BLOOD_DEEP, 0.6 * g * (1 - head), i);
        }
        k.orb(into, 1 + 1.4 * g, { ...bloodLook, ink: k.pal.ink, turn: k.now * 3 });
      },
      // Drunk.
      hit: (k) => {
        k.burst(k.head(), 14, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.6, life: [0.3, 0.5], speed: [0.1, 0.4], up: [2, 8], gravity: 60 });
      },
      impact: { secs: 0.9, draw: (k, u) => {
        const heart = k.chest();
        const beat = Math.max(bump(u, 0, 0.08, 0.3), bump(u, 0.3, 0.38, 0.6));
        k.orb(heart, 2 + 1.6 * beat, { ...bloodLook, ink: k.pal.ink, alpha: 1 - seg(u, 0.7, 1), turn: 0.4, sides: 6 });
        k.glow(heart, 8 + 6 * beat, 0.7 * (1 - u), BLOOD);
        k.light(k.caster, 2.5, 0.6 * (1 - u), '#c0304a');
      } },
      // While it lasts: a heart of blood beating in the chest, and a drop circling it, hungry.
      linger: { on: 'caster', draw: (k, age, left) => {
        const a = fadeOf(age, left), heart = k.chest();
        const beat = Math.max(bump(age % 1.1, 0, 0.06, 0.22), 0.6 * bump(age % 1.1, 0.22, 0.28, 0.45));
        k.orb(heart, 1.3 + 0.6 * beat, { ...bloodLook, ink: k.pal.ink, alpha: 0.9 * a, sides: 6, turn: 0.4, glow: 0.4 });
        k.glow(heart, 5 + 3 * beat, 0.4 * a * (0.5 + beat), BLOOD);
        const an = age * 2.2;
        k.orb({ x: heart.x + Math.cos(an) * 0.16, y: heart.y + Math.sin(an) * 0.16, z: heart.z + Math.sin(an * 0.5) * 2 }, 0.9, { ...bloodLook, ink: k.pal.ink, alpha: 0.8 * a, glow: 0.2 });
        timeArc(k, k.caster, footR(k.caster), left / (lastsOf('chaos_blood_feast') || 1), { alpha: 0.6 * a, main: BLOOD });
      } },
    },
  },

  // Cataclysm (ground, on area, 8 tiles round): Every wild creature within 8 tiles of the spot loses 40% of its health at once.
  chaos_cataclysm: {
    palette: PALETTE,
    cast: { timing: { secs: 2.2, release: 0.5 }, pose: cataclysmPose },
    fx: {
      charge: (k, t) => {
        const R = radiusOf(CATACLYSM);
        // Called down: the raised hands catching violet out of the air.
        const call = bump(t, 0.08, 0.22, 0.36);
        if (call > 0) {
          const at = mid3(k.hand(0), k.hand(1), 0.5);
          k.orb(at, 2.4 * call, { turn: k.now * 4, alpha: call });
          k.emit(at, 40 * call, { kind: 'spark', colour: [k.pal.core, k.pal.main], size: 1.4, life: [0.2, 0.4], speed: [0.3, 0.8], up: [-10, 10], gravity: 0, jitter: 0.2, jitterZ: 6 });
        }
        // Struck into the ground: the star of the patron drawn out over everything it will take, and the earth cracking under it.
        const g = smooth(seg(t, 0.3, 0.5));
        chaosStar(k, k.spot, R, { grow: g, turn: 0.1, alpha: 0.85 * g });
        cracks(k, k.spot, R * 0.85, { n: 10, grow: seg(t, 0.38, 0.5), alpha: 0.9 });
        if (t > 0.4) k.emit(k.on(k.spot.x, k.spot.y, 1), 40, { kind: 'dust', colour: ['#5a4a3e', '#3e3430'], size: 2.4, life: [0.3, 0.6], speed: [0.1, 0.4], up: [2, 8], gravity: 10, jitter: R * 0.6 });
        if (t < 0.5) k.light(k.spot, R * 0.7, 0.5 * g);
      },
      hit: (k) => {
        const R = radiusOf(CATACLYSM);
        const c = k.on(k.spot.x, k.spot.y, 2);
        k.burst(c, 70, { kind: 'shard', colour: ['#4a3e36', '#6a5a4e', k.pal.deep], size: 2.6, life: [0.6, 1.2], speed: [R * 0.15, R * 0.6], up: [16, 40], gravity: 70, spin: 3, jitter: R * 0.3 });
        k.burst(c, 40, { kind: 'dust', colour: ['#5a4a3e', '#3e3430', k.pal.deep], size: 4, life: [0.8, 1.4], speed: [R * 0.4, R * 0.9], up: [2, 8], gravity: 2, drag: 0.2 });
        k.burst(c, 30, { kind: 'spark', colour: [k.pal.core, k.pal.accent, k.pal.main], size: 2, life: [0.3, 0.7], speed: [R * 0.3, R * 0.8], up: [10, 40], gravity: 40 });
        k.flash(0.22, k.pal.light);
        // Each creature it takes, struck: torn flesh and grit off it, and its blood.
        for (const b of taken(k, k.spot, R, 6)) {
          const at = k.heart(b);
          k.burst(at, 10, { kind: 'shard', colour: [k.pal.main, k.pal.deep, '#4a3e36'], size: 1.8, life: [0.4, 0.7], speed: [0.4, 1], up: [8, 20], gravity: 50, spin: 3 });
          bleed(k, at, 6, 0.08);
        }
      },
      // The ground breaks: rock torn up in rings running out to the edge, a black column at the heart, the shock to the very rim.
      impact: { secs: 1.5, draw: (k, u) => {
        const R = radiusOf(CATACLYSM);
        k.pillar(k.spot, { r: 10 * (1 - u * 0.5), h: 110, alpha: flashOf(u, 0.06), main: k.pal.deep, deep: k.pal.ink, core: k.pal.main });
        // Three rings of rock, the inner first: the break running outward, each up in a jolt and settling back.
        const rings: Array<[number, number, number]> = [[0.2, 4, 34], [0.5, 5, 26], [0.8, 7, 18]];
        rings.forEach(([at, n, h], i) => {
          const t0 = at * 0.3;
          const v = u < t0 ? 0 : u < t0 + 0.08 ? easeOut((u - t0) / 0.08) : 1 - smooth(seg(u, 0.6, 1));
          spires(k, k.spot, R * at, n, h, v, 50 + i * 7);
        });
        const rr = 0.3 + R * easeOut(seg(u, 0, 0.5));
        k.ring(k.spot, rr, { band: Math.min(rr * 0.3, 0.35 * (1 - u)), alpha: 1 - seg(u, 0.4, 0.75), glow: 0.8, turn: u });
        chaosStar(k, k.spot, R, { grow: 1, turn: 0.1, alpha: 0.9 * (1 - seg(u, 0.5, 1)) });
        cracks(k, k.spot, R * 0.85, { n: 10, grow: 1, alpha: 1 });
        pool(k, k.spot, R * 0.28 * easeOut(u * 3), '#241a28', 0.55, 9);
        k.light(k.spot, R + 1, 1 - u * 0.6);
        k.light(k.caster, 3, 0.4 * (1 - u));
        // Under each creature it takes, the ground opened: a green-lit crack flashing and closing.
        for (const b of taken(k, k.spot, R, 6)) k.ring(b, Math.max(0.2, b.wide / 14) * (1 + u), { band: 0.06, alpha: flashOf(u, 0.08) * (1 - u), main: k.pal.accent, deep: k.pal.deep, glow: 0.6 });
      } },
      // What it leaves: the cracks cooling and the broken ground, for a few seconds.
      linger: { on: 'spot', secs: 3, draw: (k, age, left) => {
        const R = radiusOf(CATACLYSM), a = smooth(left / 3);
        pool(k, k.spot, R * 0.28, '#241a28', 0.55 * a, 9);
        cracks(k, k.spot, R * 0.85, { n: 10, grow: 1, alpha: a * (0.6 + 0.4 * Math.sin(age * 6) * a) });
        k.emit(k.on(k.spot.x, k.spot.y, 1), 20 * a, { kind: 'smoke', colour: ['#3e3430', k.pal.deep], size: 3, life: [0.8, 1.4], speed: [0.05, 0.2], up: [4, 10], gravity: -2, jitter: R * 0.5 });
      } },
    },
  },

  // Abyssal Gaze (curse, on enemy, lasts 15 s): The creature flees from you for 15 s, monsters too, and takes 50% more damage from every blow while it does.
  chaos_abyssal_gaze: {
    palette: PALETTE,
    cast: { timing: { secs: 1.8, release: 0.55 }, pose: abyssalGazePose },
    fx: {
      // An eye opening over you in the dark as your hands come away from your own.
      charge: (k, t) => {
        const open = smooth(seg(t, 0.36, 0.55));
        const g = smooth(seg(t, 0.12, 0.36));
        if (g <= 0) return;
        const over = k.at(k.caster, 1.32);
        rift(k, over, { len: 3 + 3 * g, wide: 1 + 9 * open, open: 0.3 + 0.7 * g, tilt: Math.PI / 2, alpha: g * (1 - open * 0.9) });
        if (open > 0) abyssEye(k, over, { r: 9, open, alpha: open, look: { x: 0, y: 1.5 } });
        k.light(k.caster, 2.5, 0.4 * g);
      },
      // Its stare: a black beam from your face to it.
      release: (k) => {
        k.flash(0.18, k.pal.ink);
      },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 30, { kind: 'shard', colour: [k.pal.main, k.pal.deep], size: 2, life: [0.4, 0.8], speed: [0.4, 1.2], up: [4, 18], gravity: 40, spin: 3 });
        k.burst(at, 16, { kind: 'mote', colour: [k.pal.accent, k.pal.core], size: 2, life: [0.4, 0.8], speed: [0.3, 0.8], up: [6, 18], gravity: 0 });
      },
      impact: { secs: 0.9, draw: (k, u) => {
        const over = k.at(k.caster, 1.32), b = k.target;
        const fade = 1 - smooth(seg(u, 0.4, 1));
        abyssEye(k, over, { r: 9 * (1 - 0.3 * u), open: fade, alpha: fade, look: { x: 0, y: 1.5 } });
        k.beam(k.head(), k.heart(b), { width: 3.4 * fade, alpha: fade, main: k.pal.deep, core: k.pal.accent, glow: 1 });
        // Cracked open where it was looked at: what makes every blow cut deeper.
        thorns(k, b, { R: Math.max(0.16, b.wide / 25) * (1.6 - 0.5 * easeOut(u * 2)), z: b.tall * 0.5, n: 7, len: 5, dir: 'in', turn: 0.2, alpha: 1 - seg(u, 0.8, 1) * 0.3, main: k.pal.accent, deep: '#2f7a28', width: 1.6 });
        k.light(b, 3, 0.8 * flashOf(u, 0.1));
      } },
      // While it lasts: the eye hanging over it, watching it run and blinking now and then; the green shards in it that let blows in; the time.
      linger: { draw: (k, age, left) => {
        const b = k.target, a = fadeOf(age, left), w = Math.max(0.16, b.wide / 25);
        const blink = 1 - bump(age % 3.7, 3.3, 3.45, 3.6);
        const away = k.toward(b, k.caster);
        abyssEye(k, k.at(b, 1.3), { r: 5, open: blink * smooth(age / 0.4), alpha: a, look: { x: (away.x - away.y) * 1.4, y: (away.x + away.y) * 0.5 } });
        // Three green splinters circling in it: the cracks every blow gets in by.
        for (let i = 0; i < 3; i++) {
          const an = age * 1.3 + (i * TAU) / 3;
          k.orb({ x: b.x + Math.cos(an) * w * 1.1, y: b.y + Math.sin(an) * w * 1.1, z: b.z + b.tall * (0.5 + 0.12 * Math.sin(age * 2 + i)) }, 1.6, { sides: 4, turn: an, alpha: 0.9 * a, main: k.pal.accent, deep: '#2f7a28', core: '#e6ffe0', glow: 0.5 });
        }
        timeArc(k, b, footR(b), left / lastsOf(GAZE), { alpha: 0.75 * a });
        k.light(b, 2, 0.35 * a);
      } },
    },
  },

  // Undying (pray, on self, lasts 60 s): Costs no favour.
  chaos_undying: {
    palette: PALETTE,
    cast: { timing: { secs: 2.2, release: 0.55 }, pose: undyingPose },
    fx: {
      // Knelt among graves: pale stones rising round you, and the dark seeping up through the ground.
      charge: (k, t) => {
        const g = smooth(seg(t, 0.2, 0.52));
        if (g <= 0) return;
        k.shards(k.caster, { n: 6, r: 0.5, h: 4.5, grow: g * (1 - seg(t, 0.55, 0.6)), main: '#d8cce4', deep: '#7a6a8c', core: '#ffffff', glow: 0.4 });
        k.emit(k.at(k.caster, 0.02), 30 * g, { kind: 'smoke', colour: [k.pal.ink, k.pal.deep], size: 2.2, life: [0.5, 0.9], speed: [0.02, 0.1], up: [4, 10], gravity: -2, jitter: 0.5 });
        chaosStar(k, k.caster, 0.8, { grow: g, turn: -0.2, alpha: 0.85 * g });
      },
      // Up from the grave: the stones burst, a black column through you, and the crown of thorns set on the head.
      hit: (k) => {
        k.burst(k.at(k.caster, 0.2), 40, { kind: 'shard', colour: ['#d8cce4', '#7a6a8c'], size: 2.2, life: [0.4, 0.9], speed: [0.6, 1.6], up: [10, 30], gravity: 60, spin: 3, jitter: 0.5 });
        k.burst(k.chest(), 12, { kind: 'mote', colour: [k.pal.accent, k.pal.core], size: 1.6, life: [0.5, 0.9], speed: [0.2, 0.7], up: [10, 26], gravity: 0 });
        k.flash(0.2, k.pal.deep);
      },
      impact: { secs: 1.2, draw: (k, u) => {
        k.pillar(k.caster, { r: 7, h: 80, alpha: flashOf(u, 0.08), main: k.pal.deep, deep: k.pal.ink, core: k.pal.main });
        k.shell(k.caster, { alpha: 0.7 * flashOf(u, 0.12), size: 1.3 - 0.3 * easeOut(u), main: k.pal.main, deep: k.pal.deep });
        const head = k.head();
        thorns(k, { x: head.x, y: head.y, z: head.z + 2.2 }, { R: 0.07, z: 0, n: 7, len: 1.9 * easeOut(seg(u, 0.1, 0.5)), dir: 'up', turn: u * 0.6, alpha: 1, main: '#c8ffb8', deep: k.pal.accent, width: 0.75 });
        chaosStar(k, k.caster, 0.8, { grow: 1, turn: -0.2, alpha: 0.85 * (1 - seg(u, 0.4, 1)) });
        k.light(k.caster, 3.5, 0.9 * flashOf(u, 0.1));
      } },
      // While death cannot have you: the crown of green thorns on your head, turning, and the time running out under your feet.
      linger: { on: 'caster', draw: (k, age, left) => {
        const a = fadeOf(age, left, 0.3, 1.5), head = k.head();
        thorns(k, { x: head.x, y: head.y, z: head.z + 2.2 }, { R: 0.07, z: 0, n: 7, len: 1.9, dir: 'up', turn: age * 0.5, alpha: 0.9 * a, main: '#c8ffb8', deep: k.pal.accent, width: 0.75 });
        k.glow({ x: head.x, y: head.y, z: head.z + 3 }, 5, 0.35 * a, k.pal.accent);
        if (!k.fast) k.emit({ x: head.x, y: head.y, z: head.z + 3 }, 3 * a, { kind: 'ember', colour: [k.pal.accent, k.pal.core], size: 1.2, life: [0.5, 0.9], speed: [0, 0.04], up: [4, 8], gravity: 0, jitter: 0.08 });
        timeArc(k, k.caster, footR(k.caster), left / (lastsOf('chaos_undying') || 1), { alpha: 0.65 * a });
      } },
    },
  },
};
