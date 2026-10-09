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
  arcAt, bump, clamp, dry, easeIn, easeOut, eatTail, flashOf, hashOf, lateFade, lerp, mid3, mixColour, seg, smooth, TAU,
  nearSegments, type Body, type FxScene, type GroundLayer, type P3, type SpellPalette,
} from './kit';
import { armOut, euler, one } from './poses';
import { armToward, type HandGoal, type V3 } from '../figure';
import { HALF_H, UNITS_PER_TILE } from '../iso';

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
/** What Shroud darkens its caster toward: near black with the patron's violet in it. */
const SHROUD_DARK = '#1a0c26';
/** A soul torn out, a ghost: pale, a little green. */
const SOUL = '#e6ffe9';
/** What a thing being unmade is made of, before it is not: plain wood and iron. */
const STUFF = ['#8a6a44', '#6c7078', '#a88a5c'];

/** Blood's look: its glow is blood too, not the patron's violet light, so a drop of it never shines magenta. */
const bloodLook = { main: BLOOD, deep: BLOOD_DEEP, core: BLOOD_CORE, light: BLOOD } as const;
/** Plague's rot as a look, glowing its own sick green. */
const rotLook = { main: ROT, deep: ROT_DEEP, core: '#e4ff9a', light: ROT } as const;

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
function chaosStar(k: FxScene, c: { x: number; y: number }, r: number, o: { grow?: number; turn?: number; alpha?: number; glow?: number; main?: string; head?: string; light?: string } = {}): void {
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
    { kind: 'fill', colour: o.main ?? k.pal.main, alpha: A, paths: shafts, lift: 0.15 },
    { kind: 'stroke', colour: k.pal.ink, alpha: A, width: inkW, paths: shafts, closed: true, join: 'miter', lift: 0.15, glow: 0.6 * k.night, light: o.light },
    { kind: 'fill', colour: o.head ?? k.pal.accent, alpha: A, paths: heads, lift: 0.16 },
    { kind: 'stroke', colour: k.pal.ink, alpha: A, width: inkW, paths: heads, closed: true, join: 'miter', lift: 0.16 },
  ], (x, y, reach) => nearSegments(spokes, x, y, reach + fat));
  k.ring(c, hub, { band: hub * 0.4, alpha: a * smooth(grow * 3), turn: -turn, glow: o.glow ?? 0.6, dash: 0, main: o.main, light: o.light });
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
  // At least a few pixels across whatever the zoom, so its colour shows inside the ink at play size and it does not
  // read as a pencil line; the ink a third of the band at most.
  // (A tile across the ground is narrowest on the screen up and down the picture: HALF_H root two pixels at zoom one.)
  const tilePx = k.px(HALF_H * Math.SQRT2);
  const band = Math.max(o.band ?? Math.max(0.025, r * 0.045), k.px(1.9) / tilePx);
  const bandPx = band * tilePx;
  // Fewer facets on fast graphics, where the ground pass pays for each.
  const n = Math.max(3, Math.ceil((k.fast ? 24 : Math.max(24, k.facets(r, 48))) * f));
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
    { kind: 'stroke', colour: k.pal.ink, alpha: A, width: Math.min(Math.max(0.6, 0.5 * k.zoom), bandPx / 3), paths: [shape], closed: true, join: 'round', lift: 0.15, glow: 0.45 * k.night, light: o.main ?? k.pal.main },
    // At night its own colour lit along it, so how long is left still reads in the dark.
    { kind: 'stroke', colour: k.pal.accent, alpha: A, width: Math.max(1.4, 1.5 * k.zoom), paths: [notch], lift: 0.16, glow: 0.8 * k.night, light: k.pal.accent },
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
  const deep = k.pal.deep, iris = '#7dff6a', ink = k.pal.ink, lit = k.pal.main, pale = '#c9a6e0';
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
      // Green throughout, lit to shaded: no near-white facet, which the slit would split into two fangs.
      g.fillStyle = m > 0.2 ? iris : m > -0.4 ? '#3f9a32' : '#1f5a1a';
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
    g.lineTo(cx + ir * 0.12, cy);
    g.lineTo(cx, cy + ir * 0.95);
    g.lineTo(cx - ir * 0.12, cy);
    g.closePath();
    g.fill();
    // A wet catch-light high on the iris, to the light: what makes it an eye looking, not a hole.
    const hx = cx - ir * 0.42, hy = cy - ir * 0.42, hs = Math.max(1, ir * 0.2);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(hx, hy - hs);
    g.lineTo(hx + hs * 0.7, hy);
    g.lineTo(hx, hy + hs);
    g.lineTo(hx - hs * 0.7, hy);
    g.closePath();
    g.fill();
    g.restore();
    // The pale rim of the white under the lower lid.
    g.beginPath();
    for (let i = 8; i < lid.length; i += 2) (i === 8 ? g.moveTo(lid[i], lid[i + 1] - R * 0.09 * open) : g.lineTo(lid[i], lid[i + 1] - R * 0.09 * open));
    g.lineTo(lid[0], lid[1]);
    g.lineWidth = Math.max(1, 0.9 * k.zoom * open);
    g.strokeStyle = pale;
    g.stroke();
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
  // A low violet halo, not a white one: added light over the iris would wash it out.
  k.glow(p, o.r * 1.8, a * 0.3 * (0.3 + 0.7 * open), k.pal.main);
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
function cracks(k: FxScene, c: { x: number; y: number }, r: number, o: { n?: number; grow?: number; alpha?: number; turn?: number; width?: number; from?: number } = {}): void {
  const a = o.alpha ?? 1, grow = clamp(o.grow ?? 1);
  if (a <= 0.01 || grow <= 0.01) return;
  // On fast graphics fewer lines and one stroke: the ground pass pays for every one of them.
  const n = Math.min(o.n ?? 9, k.fast ? 6 : 99), seg0 = k.fast ? 4 : 6, from = Math.max(0, o.from ?? 0);
  const lines: number[][] = [], segs: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = (o.turn ?? 0) + (i / n) * TAU + (hashOf(k.seed + 23, i) - 0.5) * 0.5;
    // Out from `from` (the lip of a crater: the cracks run out of it, not over its floor).
    const len = (r - from) * (0.6 + 0.4 * hashOf(k.seed + 29, i)) * easeOut(clamp(grow * 1.2 - 0.2 * hashOf(k.seed + 31, i)));
    if (len <= 0.02) continue;
    const pts: number[] = [];
    // Wandering a little either side of its line, by no more than a fraction of a step: a crack, not a scribble.
    const ca = Math.cos(base), sa = Math.sin(base), step = len / seg0;
    let side = 0;
    for (let j = 0; j <= seg0; j++) {
      const d = from + j * step;
      if (j > 0) side += (hashOf(k.seed + 37 + i, j) - 0.5) * step * 0.7;
      pts.push(c.x + ca * d - sa * side, c.y + sa * d + ca * side);
      if (j > 0) segs.push(pts[2 * j - 2], pts[2 * j - 1], pts[2 * j], pts[2 * j + 1]);
    }
    lines.push(pts);
  }
  if (!lines.length) return;
  const A = clamp(a), wd = o.width ?? 1;
  // The dark of the break, and the green glowing down it (lit at night); on fast graphics the dark line alone, which
  // is what reads over grass.
  const layers: GroundLayer[] = [{ kind: 'stroke', colour: k.pal.ink, alpha: A, width: Math.max(1.6, (k.fast ? 2 : 2.6) * k.zoom * wd), paths: lines, join: 'miter', lift: 0.1, glow: k.fast ? 0.5 * k.night : 0, light: k.pal.accent }];
  if (!k.fast) layers.push({ kind: 'stroke', colour: k.pal.accent, alpha: A, width: Math.max(0.7, 0.9 * k.zoom * wd), paths: lines, join: 'miter', lift: 0.11, glow: 0.5 * k.night, light: k.pal.accent });
  k.groundShape(c.x, c.y, r + 0.5, layers, (x, y, reach) => nearSegments(segs, x, y, reach + 0.05));
}

/**
 * A ragged pool lying on the ground, `r` tiles, its edge torn by the cast's
 * own seed: rot, blood -- and, given `inner`, a second pool inside it in
 * another colour, laid in the same record.
 */
function pool(k: FxScene, c: { x: number; y: number }, r: number, colour: string, alpha: number, salt = 0,
  inner?: { share: number; colour: string; alpha: number; salt: number }): void {
  if (alpha <= 0.01 || r <= 0.03) return;
  const layers: GroundLayer[] = [{ kind: 'fill', colour, alpha: clamp(alpha), paths: [ragged(k, c, r, salt)], lift: 0.08 }];
  if (inner && inner.alpha > 0.01) layers.push({ kind: 'fill', colour: inner.colour, alpha: clamp(inner.alpha), paths: [ragged(k, c, r * inner.share, inner.salt)], lift: 0.09 });
  k.groundShape(c.x, c.y, r + 0.4, layers, inBand(c.x, c.y, 0, r));
}

/** A ragged round edge on the ground, `rad` tiles, torn by the cast's seed and `salt`: flat x, y pairs. */
function ragged(k: FxScene, c: { x: number; y: number }, rad: number, salt: number): number[] {
  const n = k.facets(rad, 26), pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU;
    const rr = rad * (0.72 + 0.28 * hashOf(k.seed + 41 + salt, i));
    pts.push(c.x + Math.cos(an) * rr, c.y + Math.sin(an) * rr);
  }
  return pts;
}

/** The way toward the viewer on the ground at `c` (down the screen), whichever way the camera is turned. */
function nearWay(k: FxScene, c: { x: number; y: number }): { x: number; y: number } {
  const y0 = k.eye.worldToScreenY(c.x, c.y, 0);
  const dx = k.eye.worldToScreenY(c.x + 1, c.y, 0) - y0, dy = k.eye.worldToScreenY(c.x, c.y + 1, 0) - y0;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

/** A closed outline the other way round: laid in the same fill as an outline round it, it cuts a hole in it. */
function backwards(pts: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

/**
 * A crater punched in the ground, `r` tiles at most: a broken rim of rock,
 * the far wall inside it lit (it faces the light over the viewer's shoulder),
 * and the floor in shadow pushed toward the near lip, so it reads as a hole
 * and not a stain.
 *
 * Nobody stands on nothing. Whoever stands in it (`bodies`: the creature it
 * was cast at, the caster cast at their own feet) is left on a pillar of the
 * ground they stood on, the crater broken out round it: a hole in every layer
 * the size of their footing (wound the other way, so the fill leaves it), and
 * the pillar's near face, a crescent of earth under its lip. A hole is kept
 * inside each layer's own ragged edge, so one at the rim notches the crater
 * rather than spilling past it.
 */
function crater(k: FxScene, c: { x: number; y: number }, r: number, alpha: number, bodies: ReadonlyArray<{ x: number; y: number; wide: number }> = []): void {
  if (alpha <= 0.01 || r <= 0.05) return;
  const n = nearWay(k, c), off = Math.min(0.12, r * 0.12), A = clamp(alpha);
  const floorC = { x: c.x + n.x * off, y: c.y + n.y * off };
  const islands = bodies
    .map((b, i) => ({ x: b.x, y: b.y, r: footR(b) * 1.15 + 0.03, i }))
    .filter((p) => Math.hypot(p.x - c.x, p.y - c.y) < r + p.r)
    .slice(0, 6);
  // A ragged edge of `rad` comes no nearer its middle than 0.72 of it, and its chords a little nearer still.
  const within = (pts: number[], cx: number, cy: number, rad: number): number[] => {
    const most = rad * 0.66, out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - cx, dy = pts[i + 1] - cy, d = Math.hypot(dx, dy);
      const s = d > most ? most / d : 1;
      out.push(cx + dx * s, cy + dy * s);
    }
    return out;
  };
  const shapes = islands.map((p) => ragged(k, p, p.r, 30 + p.i));
  const holes = (cx: number, cy: number, rad: number): number[][] => shapes.map((h) => backwards(within(h, cx, cy, rad)));
  const layers: GroundLayer[] = [
    { kind: 'fill', colour: '#4a3e36', alpha: A, paths: [ragged(k, c, r, 9), ...holes(c.x, c.y, r)], lift: 0.08 },
    { kind: 'fill', colour: '#6a5a70', alpha: A, paths: [ragged(k, c, r * 0.86, 10), ...holes(c.x, c.y, r * 0.86)], lift: 0.09 },
    { kind: 'fill', colour: '#1c1420', alpha: A, paths: [ragged(k, floorC, r * 0.74, 11), ...holes(floorC.x, floorC.y, r * 0.74)], lift: 0.1 },
  ];
  // Each pillar's face, toward the viewer under its lip: a crescent of earth, inked round the lip in a lit stone so the
  // ground it stands on reads as standing up out of the pit -- where it stands in the pit's floor.
  const face: number[][] = [], lip: number[][] = [];
  islands.forEach((p, j) => {
    const drop = Math.min(0.1, p.r * 0.3), out = ragged(k, { x: p.x + n.x * drop, y: p.y + n.y * drop }, p.r * 1.06, 30 + p.i);
    face.push(within(out, floorC.x, floorC.y, r * 0.74), backwards(within(shapes[j], floorC.x, floorC.y, r * 0.74)));
    if (Math.hypot(p.x - floorC.x, p.y - floorC.y) + p.r < r * 0.5) lip.push(shapes[j]);
  });
  if (face.length) layers.push({ kind: 'fill', colour: '#5a4a3e', alpha: A, paths: face, lift: 0.105 });
  if (lip.length) layers.push({ kind: 'stroke', colour: '#8a7a68', alpha: A, width: Math.max(1, 1.1 * k.zoom), paths: lip, closed: true, join: 'miter', lift: 0.11 });
  k.groundShape(c.x, c.y, r + 0.4, layers, inBand(c.x, c.y, 0, r));
}

/**
 * Plague's front running out over the ground: not a hoop but the edge of a
 * spreading sickness -- a lumpy, crooked line, bulging and pinched as a stain
 * creeps, inked, lime along its middle, `r` tiles out.
 */
function sickFront(k: FxScene, c: { x: number; y: number }, r: number, alpha: number): void {
  if (alpha <= 0.01 || r <= 0.1) return;
  const n = Math.max(18, Math.min(k.fast ? 40 : 64, Math.ceil(r * 12))), pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU;
    // Lobes where it has crept ahead and bites where it lags: a few slow bulges, and a little ragged on top of them.
    const lobe = 0.06 * Math.sin(an * 5 + k.seed) + 0.04 * Math.sin(an * 9 + k.seed * 1.7) + 0.03 * (hashOf(k.seed + 151, i) - 0.5);
    pts.push(c.x + Math.cos(an) * r * (1 + lobe), c.y + Math.sin(an) * r * (1 + lobe));
  }
  const A = clamp(alpha);
  k.groundShape(c.x, c.y, r * 1.15 + 0.4, [
    { kind: 'stroke', colour: ROT_DEEP, alpha: A, width: Math.max(2, 2.6 * k.zoom), paths: [pts], closed: true, join: 'round', lift: 0.12 },
    { kind: 'stroke', colour: ROT, alpha: A, width: Math.max(1, 1.2 * k.zoom), paths: [pts], closed: true, join: 'round', lift: 0.13, glow: 0.3 + 0.5 * k.night, light: ROT },
  ], inBand(c.x, c.y, r * 0.85, r * 1.15));
}

/**
 * Plague's blight: the ground it sickens broken out in sores rather than
 * painted over. Each sore is its own shape -- five to nine ragged points,
 * stretched along a way of its own -- in one of three sick tones (a bruise
 * edged in rot, a thin dried brown, a bilious olive), every one with a
 * weeping yellow-green heart, so each reads as a lesion and not a stone; they
 * gather in a few clusters near the middle, as a sickness spreads from where it
 * took, with a few strays out toward the edge. `grow` spreads them from the
 * middle out. Small pieces, each in a tile or two, so the ground pass cuts them
 * for next to nothing; half as many on fast graphics.
 */
const SORE_TONES = ['#4e2648', '#3a2a1a', '#6e7a2a'] as const;
function blight(k: FxScene, c: { x: number; y: number }, r: number, grow: number, alpha: number, n = 26): void {
  if (alpha <= 0.01 || grow <= 0.01) return;
  if (k.fast) n = Math.ceil(n / 2);
  const tones: number[][][] = [[], [], []], heart: number[][] = [], segs: number[] = [], stain: number[][] = [];
  // Three places it took hold, within half the radius, each a sickly stain on the ground the sores break out of.
  const hubs: Array<[number, number]> = [];
  for (let j = 0; j < 3; j++) {
    const d = r * 0.45 * Math.sqrt(hashOf(k.seed + 59, j)), an = hashOf(k.seed + 57, j) * TAU;
    hubs.push([Math.cos(an) * d, Math.sin(an) * d]);
    const v = clamp((grow * r - d) / (r * 0.3));
    if (v <= 0) continue;
    const sr = r * (0.2 + 0.08 * hashOf(k.seed + 53, j)) * easeOut(v), pts: number[] = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU, rr = sr * (0.55 + 0.45 * hashOf(k.seed + 51 + j, i));
      pts.push(c.x + Math.cos(an) * d + Math.cos(a) * rr, c.y + Math.sin(an) * d + Math.sin(a) * rr * 0.8);
    }
    stain.push(pts);
    segs.push(c.x + Math.cos(an) * d, c.y + Math.sin(an) * d, c.x + Math.cos(an) * d, c.y + Math.sin(an) * d);
  }
  for (let i = 0; i < n; i++) {
    let ox: number, oy: number;
    const an = hashOf(k.seed + 67, i) * TAU;
    if (i % 4 !== 3) {
      // Most round a hub, within a fifth of the radius of it.
      const h = hubs[i % 3], d = r * 0.2 * Math.sqrt(hashOf(k.seed + 61, i));
      ox = h[0] + Math.cos(an) * d;
      oy = h[1] + Math.sin(an) * d;
    } else {
      // The strays, out toward the edge.
      const d = r * (0.55 + 0.35 * hashOf(k.seed + 61, i));
      ox = Math.cos(an) * d;
      oy = Math.sin(an) * d;
    }
    const d = Math.hypot(ox, oy);
    const v = clamp((grow * r - d) / (r * 0.25));
    if (v <= 0) continue;
    const x = c.x + ox, y = c.y + oy;
    const size = (0.12 + 0.3 * hashOf(k.seed + 71, i)) * (1 - 0.4 * d / r) * easeOut(v);
    const pts = 5 + Math.floor(hashOf(k.seed + 79, i) * 5);
    const axis = hashOf(k.seed + 83, i) * Math.PI, stretch = 0.5 + 0.4 * hashOf(k.seed + 89, i);
    const ca = Math.cos(axis), sa = Math.sin(axis);
    const outer: number[] = [], inner: number[] = [];
    for (let j = 0; j < pts; j++) {
      const a = (j / pts) * TAU + i;
      const rr = size * (0.6 + 0.4 * hashOf(k.seed + 73 + i, j));
      // Stretched along its own axis, not always up the screen.
      const u = Math.cos(a) * rr, w = Math.sin(a) * rr * stretch;
      const px = u * ca - w * sa, py = u * sa + w * ca;
      outer.push(x + px, y + py);
      inner.push(x + px * 0.42 + size * 0.06, y + py * 0.42 - size * 0.05);
    }
    const tone = Math.floor(hashOf(k.seed + 97, i) * 3);
    tones[tone].push(outer);
    heart.push(inner);
    segs.push(x, y, x, y);
  }
  if (!segs.length) return;
  const A = clamp(alpha), layers: GroundLayer[] = [];
  if (stain.length) layers.push({ kind: 'fill', colour: '#6e7a2a', alpha: A * 0.6, paths: stain, lift: 0.07 });
  tones.forEach((paths, t) => {
    if (paths.length) layers.push({ kind: 'fill', colour: SORE_TONES[t], alpha: A * (t === 2 ? 0.75 : t === 1 ? 0.45 : 0.6), paths, lift: 0.08 });
  });
  // The bruises' raw edge, so they read as broken skin of the ground rather than lying on it.
  if (tones[0].length) layers.push({ kind: 'stroke', colour: ROT_DEEP, alpha: A, width: Math.max(1, k.zoom * 0.5), paths: tones[0], closed: true, join: 'round', lift: 0.085 });
  if (heart.length) layers.push({ kind: 'fill', colour: ROT, alpha: A * 0.6, paths: heart, lift: 0.09, glow: 0.35 * k.night, light: ROT });
  k.groundShape(c.x, c.y, r + 0.5, layers, (x, y, reach) => nearSegments(segs, x, y, reach + r * 0.3));
}

/**
 * Flies buzzing round a sick creature: `n` dark specks with pale wings on
 * crooked loops over its back, each its own speed, all in one record.
 */
function flies(k: FxScene, b: { x: number; y: number; z: number; tall: number; wide: number }, n: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const pts: number[] = [], R = Math.max(0.12, b.wide / 22);
  for (let i = 0; i < n; i++) {
    const sp = 3 + 3 * hashOf(k.seed + 113, i), ph = hashOf(k.seed + 127, i) * TAU, t = k.now * sp + ph;
    const rr = R * (0.6 + 0.4 * Math.sin(t * 1.7 + i));
    const x = b.x + Math.cos(t) * rr, y = b.y + Math.sin(t * 1.3) * rr;
    const z = b.z + b.tall * (0.95 + 0.3 * Math.sin(t * 2.3 + i)) + 1;
    pts.push(k.eye.worldToScreenX(x, y), k.eye.worldToScreenY(x, y, z));
  }
  const s = Math.max(1.6, 1.1 * k.zoom), flap = Math.sin(k.now * 60) > 0 ? 1 : 0.4;
  k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
    g.globalAlpha = clamp(alpha);
    g.fillStyle = '#e8f0f0';
    for (let i = 0; i < pts.length; i += 2) g.fillRect(pts[i] - s * 1.1, pts[i + 1] - s * (0.6 + 0.6 * flap), s * 2.2, s * 0.6);
    g.fillStyle = '#141008';
    for (let i = 0; i < pts.length; i += 2) g.fillRect(pts[i] - s * 0.5, pts[i + 1] - s * 0.5, s, s);
  }, 3);
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
  const main = k.pal.main, core = k.pal.core, ink = k.pal.ink;
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
      // Violet, so it holds over a pale hide; its lit facet (the upper left) in the pale core.
      g.fillStyle = main;
      g.fill();
      g.lineWidth = Math.max(0.8, 0.7 * k.zoom);
      g.strokeStyle = ink;
      g.stroke();
      g.globalAlpha = clamp(a * 0.85);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(xm - dy * w * 0.8, ym + dx * w * 0.8);
      g.lineTo(x1, y1);
      g.closePath();
      g.fillStyle = core;
      g.fill();
      g.globalAlpha = clamp(a);
    }
    g.lineJoin = 'round';
  }, 3);
  k.glow({ x: p.x, y: p.y, z: p.z + size * 0.4 }, size * 1.4, a * 0.2, k.pal.main);
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
      g.lineWidth = Math.max(0.8, 0.45 * k.zoom);
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
function soulWisp(k: FxScene, p: P3, from: P3, r: number, alpha: number, glow = 0.9): void {
  if (alpha <= 0.01) return;
  const look = { main: SOUL, deep: '#8fd4a0', core: '#ffffff', ink: '#2b4a33', light: '#9fffb0' };
  k.ribbon([mid3(from, p, 0.45), mid3(from, p, 0.75), p], { width: r * 1.3, taper: 'start', alpha: alpha * 0.6, ...look, glow: 0.4 * glow });
  k.orb(p, r, { alpha, ...look, turn: k.now * 4, glow });
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
    { kind: 'stroke', colour: k.pal.ink, alpha: A, width: Math.max(0.8, 0.7 * k.zoom), paths: vees, closed: true, join: 'miter', lift: 0.15, glow: 0.5 * k.night, light: k.pal.main },
  ], inBand(c.x, c.y, r - size, r + size));
}

/**
 * Rock torn up out of the ground: chunky spires, a third as wide as they are
 * tall, on a ring `r` tiles round a point -- each lit on its left face, shaded
 * on its right, its top snapped off in a slant with a lit break on it, a green
 * seam glowing up its middle, and each its own stone (a violet slate or a
 * brown rock). None comes up within `clear` tiles of anybody standing there
 * (`avoid`): the ground breaks round them, nothing pokes through a body.
 * `grow` nought to one pushes them up out of the ground and lets them sink.
 */
const ROCK = ['#6a5a70', '#5a4e44', '#645464'] as const;
function spires(k: FxScene, c: { x: number; y: number }, r: number, n: number, h: number, grow: number, salt: number,
  avoid: ReadonlyArray<{ x: number; y: number; z: number; tall: number; wide: number }> = [], clear = 1.0): void {
  if (grow <= 0.01) return;
  const seam = k.pal.accent, ink = k.pal.ink;
  // Where each body stands on the screen: a spire standing in front of one, over its legs, is not raised at all.
  const boxes = avoid.map((b) => ({ x: k.eye.worldToScreenX(b.x, b.y), y: k.eye.worldToScreenY(b.x, b.y, b.z), top: k.hpx(b.tall), half: k.hpx(Math.max(3, b.wide)) }));
  const pieces: Array<{ base: P3; sy: number; draw: (g: CanvasRenderingContext2D) => void }> = [];
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU + hashOf(k.seed + salt, i) * 0.9;
    const rr = r * (0.8 + 0.4 * hashOf(k.seed + salt + 1, i));
    const gx = c.x + Math.cos(an) * rr, gy = c.y + Math.sin(an) * rr;
    if (avoid.some((b) => Math.hypot(b.x - gx, b.y - gy) < clear)) continue;
    const base = k.on(gx, gy);
    const tall = h * (0.7 + 0.6 * hashOf(k.seed + salt + 2, i)) * grow;
    const lean = (hashOf(k.seed + salt + 3, i) - 0.5) * 0.5 + Math.cos(an) * 0.25;
    const bx = k.sx(base), by = k.sy(base), H = k.hpx(tall), W = H * 0.32;
    // Judged at its full height, so it does not come up clear and then grow over the body.
    const Hf = k.hpx(h * (0.7 + 0.6 * hashOf(k.seed + salt + 2, i))), Wf = Hf * 0.32;
    if (boxes.some((q) => by > q.y && by - Hf < q.y && Math.abs(bx - q.x) < Wf + q.half)) continue;
    const tx = bx + lean * H * 0.4, ty = by - H;
    // Snapped: the top a slant from a lower left point to a higher right one, the break lit from over the shoulder.
    const snap = 0.08 + 0.1 * hashOf(k.seed + salt + 4, i);
    const tAx = tx - W * 0.3, tAy = ty + H * snap, tBx = tx + W * 0.12, tBy = ty;
    const fx = lerp(tAx, tBx, 0.45) + W * 0.04, fy = Math.max(tAy, tBy) + H * 0.05;
    const lit = ROCK[Math.floor(hashOf(k.seed + salt + 5, i) * ROCK.length)];
    const shade = dry(lit, 1, undefined, 0.5), cap = mixColour(lit, '#e8dcef', 0.35);
    pieces.push({ base, sy: by, draw: (g) => {
      g.lineJoin = 'miter';
      g.globalAlpha = 1;
      const face = (pts: number[], col: string): void => {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let j = 2; j < pts.length; j += 2) g.lineTo(pts[j], pts[j + 1]);
        g.closePath();
        g.fill();
      };
      face([bx - W, by, tAx, tAy, fx, fy, bx + W * 0.1, by + W * 0.3], lit);
      face([bx + W * 0.1, by + W * 0.3, fx, fy, tBx, tBy, bx + W, by], shade);
      face([tAx, tAy, tBx, tBy, fx, fy], cap);
      g.beginPath();
      g.moveTo(bx - W, by);
      g.lineTo(tAx, tAy);
      g.lineTo(tBx, tBy);
      g.lineTo(bx + W, by);
      g.lineTo(bx + W * 0.1, by + W * 0.3);
      g.closePath();
      g.moveTo(tAx, tAy);
      g.lineTo(fx, fy);
      g.lineTo(tBx, tBy);
      g.lineWidth = Math.max(0.9, 0.8 * k.zoom);
      g.strokeStyle = ink;
      g.stroke();
      g.beginPath();
      g.moveTo(lerp(bx, fx, 0.1) - W * 0.15, lerp(by, fy, 0.1));
      g.lineTo(lerp(bx, fx, 0.55) + W * 0.05, lerp(by, fy, 0.55));
      g.lineTo(lerp(bx, fx, 0.8), lerp(by, fy, 0.8));
      g.lineWidth = Math.max(1, 0.9 * k.zoom);
      g.strokeStyle = seam;
      g.stroke();
      g.lineJoin = 'round';
    } });
  }
  // Recorded three at a time, neighbours in depth, each lot sorted at its middle one: a ring of rock costs two or
  // three records rather than one a spire (none stands within `clear` of a body, so a lot sorts true against them).
  pieces.sort((a, b) => a.sy - b.sy);
  for (let i = 0; i < pieces.length; i += 3) {
    const lot = pieces.slice(i, i + 3);
    k.worldDraw(lot[Math.floor(lot.length / 2)].base, (g) => { for (const p of lot) p.draw(g); });
  }
}

/**
 * Which way a frightened creature runs, over its head: a violet arrowhead,
 * inked, its lit half in the pale core, pointing the way `dir` (a unit step on
 * the ground) goes on the screen, with two speed strokes trailing it. Drawn
 * upright to the viewer rather than lying level, so it reads the same at every
 * facing (a level arrow along the diagonal is a skewed V). `size` sets it,
 * thirty pixels at zoom one a tile of it; it jolts forward on the beat. The
 * faith's one mark for "flees", on Fright, Panic and the Gaze.
 */
function fleeMark(k: FxScene, b: { x: number; y: number; z: number; tall: number }, dir: { x: number; y: number }, size: number, alpha: number, beat = 0, lift = 1.12): void {
  if (alpha <= 0.01) return;
  const at: P3 = { x: b.x, y: b.y, z: b.z + b.tall * lift + 2 };
  const x0 = k.sx(at), y0 = k.sy(at);
  const ahead = { x: at.x + dir.x * 0.5, y: at.y + dir.y * 0.5, z: at.z };
  let dx = k.sx(ahead) - x0, dy = k.sy(ahead) - y0;
  const l = Math.hypot(dx, dy) || 1;
  dx /= l; dy /= l;
  const L = size * 30 * k.zoom, push = L * 0.3 * beat;
  const cx = x0 + dx * push, cy = y0 + dy * push, px = -dy, py = dx;
  const p = (along: number, side: number): [number, number] => [cx + dx * along * L + px * side * L, cy + dy * along * L + py * side * L];
  const head = [p(0.5, 0), p(-0.25, -0.45), p(-0.05, 0), p(-0.25, 0.45)];
  // The lit half is whichever is nearer the top of the screen.
  const litSide = py < 0 ? 1 : -1;
  const lit = [p(0.5, 0), p(-0.25, 0.45 * litSide), p(-0.05, 0)];
  const main = k.pal.main, core = k.pal.core, ink = k.pal.ink;
  k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'miter';
    g.lineCap = 'round';
    // The speed strokes behind it.
    g.beginPath();
    for (const s of [-0.2, 0.2]) {
      const [ax, ay] = p(-0.35, s), [bx, by] = p(-0.35 - 0.45 * (1 - 0.4 * beat), s);
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
    }
    g.lineWidth = Math.max(1.6, 1.5 * k.zoom);
    g.strokeStyle = ink;
    g.stroke();
    g.lineWidth = Math.max(0.8, 0.7 * k.zoom);
    g.strokeStyle = main;
    g.stroke();
    const poly = (pts: Array<[number, number]>): void => {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
    };
    poly(head);
    g.fillStyle = main;
    g.fill();
    poly(lit);
    g.globalAlpha = clamp(alpha * 0.8);
    g.fillStyle = core;
    g.fill();
    g.globalAlpha = clamp(alpha);
    poly(head);
    g.lineWidth = Math.max(0.9, 0.8 * k.zoom);
    g.strokeStyle = ink;
    g.stroke();
    g.lineCap = 'butt';
    g.lineJoin = 'round';
  }, 3);
  // Lit at night, so the way it runs still reads in the dark.
  if (k.night > 0.01) k.glow(at, size * 14, 0.35 * k.night * alpha, k.pal.main);
}

/**
 * A shriek going out: a crescent drawn upright to the viewer (as the flee mark
 * is), bowed the way it goes on the screen, so from any facing it reads as a
 * curve and never edge-on as a dart. `sdx, sdy` the way it goes on the screen
 * (a unit), `half` its half-span and `w` its thickness in pixels at zoom one.
 */
function shriekArc(k: FxScene, c: P3, sdx: number, sdy: number, half: number, w: number, alpha: number, bias = 3): void {
  if (alpha <= 0.01 || half <= 0.1) return;
  const x = k.sx(c), y = k.sy(c), H = half * k.zoom, W = w * k.zoom, px = -sdy, py = sdx;
  const n = 8, outer: number[] = [], inner: number[] = [];
  for (let j = 0; j <= n; j++) {
    const s = (j / n) * 2 - 1, bow = (1 - s * s) * H * 0.55, th = W * Math.pow(1 - s * s, 0.8);
    const bx = x + px * s * H + sdx * bow, by = y + py * s * H + sdy * bow;
    outer.push(bx + sdx * th * 0.5, by + sdy * th * 0.5);
    inner.push(bx - sdx * th * 0.5, by - sdy * th * 0.5);
  }
  const main = k.pal.main, core = k.pal.core, ink = k.pal.ink;
  k.worldDraw(c, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'miter';
    g.beginPath();
    g.moveTo(outer[0], outer[1]);
    for (let j = 1; j <= n; j++) g.lineTo(outer[2 * j], outer[2 * j + 1]);
    for (let j = n; j >= 0; j--) g.lineTo(inner[2 * j], inner[2 * j + 1]);
    g.closePath();
    g.fillStyle = main;
    g.fill();
    g.lineWidth = Math.max(0.8, 0.7 * k.zoom);
    g.strokeStyle = ink;
    g.stroke();
    // Its leading edge in the pale core.
    g.beginPath();
    for (let j = 1; j < n; j++) (j === 1 ? g.moveTo(outer[2 * j], outer[2 * j + 1]) : g.lineTo(outer[2 * j], outer[2 * j + 1]));
    g.lineWidth = Math.max(0.8, W * 0.3);
    g.strokeStyle = core;
    g.stroke();
    g.lineJoin = 'round';
  }, bias);
  k.glow(c, half * 1.2, alpha * 0.25, k.pal.main);
}

/** Which way a creature runs from Panic: straight out from the spot, or away from the caster when it stands on the spot itself. */
function fleeWay(k: FxScene, b: { x: number; y: number }): { x: number; y: number; d: number } {
  const dx = b.x - k.spot.x, dy = b.y - k.spot.y, d = Math.hypot(dx, dy);
  if (d > 0.4) return { x: dx / d, y: dy / d, d };
  const t = k.toward(k.caster, b);
  return { x: t.x, y: t.y, d };
}

/**
 * The wild creatures an area spell took (no companion, no penned beast): those the island said it reached, wherever
 * they have run (`k.struck`), or where it did not say, those standing in it now; the nearest few, so a herd does not
 * cost a frame.
 */
function taken(k: FxScene, c: { x: number; y: number }, r: number, most = 8): ReturnType<FxScene['bodiesWithin']> {
  const all = k.struck(r, c);
  if (all.length <= most) return all;
  return all.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y)).slice(0, most);
}

/** Grave-stone: a weathered violet-grey, its lit face, its shaded side and its top. */
const GRAVE = ['#9a8ea8', '#5e5470', '#b4a8c0'];
/**
 * Headstones standing up round a body, as Undying is knelt among graves:
 * five flat slabs `r` tiles out, each a face to the viewer with a rounded
 * shoulder of a top, a shaded side for its thickness, inked, each leaning its
 * own way. `grow` nought to one raises them out of the ground. Those behind
 * the body are drawn behind it and those before it in front, two records.
 */
function graves(k: FxScene, b: Body, r: number, grow: number): void {
  if (grow <= 0.01) return;
  const cy = k.sy(b), back: Array<() => (g: CanvasRenderingContext2D) => void> = [], front: typeof back = [];
  for (let i = 0; i < 5; i++) {
    const an = (i / 5) * TAU + 0.4 + (hashOf(k.seed + 161, i) - 0.5) * 0.6;
    const gx = b.x + Math.cos(an) * r * (0.9 + 0.2 * hashOf(k.seed + 163, i)), gy = b.y + Math.sin(an) * r * (0.9 + 0.2 * hashOf(k.seed + 163, i));
    const base = k.on(gx, gy), x = k.sx(base), y = k.sy(base);
    const H = k.hpx(3.6 * (0.8 + 0.4 * hashOf(k.seed + 167, i))) * easeOut(grow), W = k.hpx(2.4), D = W * 0.35;
    const lean = (hashOf(k.seed + 173, i) - 0.5) * 0.5, ca = Math.cos(lean), sa = Math.sin(lean);
    // A point on the slab's face: across (-1..1 of the half width) and up (0..1 of its height), leant about its foot.
    const P = (u: number, v: number): [number, number] => [x + u * W * 0.5 * ca + v * H * sa, y + u * W * 0.5 * sa - v * H * ca];
    const draw = () => (g: CanvasRenderingContext2D): void => {
      const poly = (pts: Array<[number, number]>, fill: string): void => {
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (let j = 1; j < pts.length; j++) g.lineTo(pts[j][0], pts[j][1]);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
        g.stroke();
      };
      g.globalAlpha = 1;
      g.lineJoin = 'miter';
      g.lineWidth = Math.max(0.8, 0.6 * k.zoom);
      g.strokeStyle = k.pal.ink;
      const face: Array<[number, number]> = [P(-1, 0), P(-1, 0.8), P(-0.6, 0.97), P(0, 1), P(0.6, 0.97), P(1, 0.8), P(1, 0)];
      // Its thickness, to the shaded right and back up the screen.
      poly([P(1, 0), P(1, 0.8), [P(1, 0.8)[0] + D, P(1, 0.8)[1] - D * 0.5], [P(1, 0)[0] + D, P(1, 0)[1] - D * 0.5]], GRAVE[1]);
      poly(face, GRAVE[0]);
      // A lit top edge, and a crack down the face.
      g.beginPath();
      g.moveTo(...P(-0.9, 0.82)); g.lineTo(...P(-0.55, 0.94)); g.lineTo(...P(0, 0.97));
      g.strokeStyle = GRAVE[2];
      g.stroke();
      g.beginPath();
      g.moveTo(...P(0.1, 0.9)); g.lineTo(...P(-0.15, 0.6)); g.lineTo(...P(0.1, 0.35));
      g.strokeStyle = k.pal.ink;
      g.stroke();
      g.lineJoin = 'round';
    };
    (y > cy ? front : back).push(draw);
  }
  const foot = { x: b.x, y: b.y, z: b.z };
  if (back.length) k.worldDraw(foot, (g) => { for (const d of back) d()(g); }, -0.5);
  if (front.length) k.worldDraw(foot, (g) => { for (const d of front) d()(g); }, 3);
}

/** The stretch of a line between `a` and `b` of the way along it (by length): a run going along a path. */
function stretch(pts: readonly P3[], a: number, b: number): P3[] {
  const len = (p: P3, q: P3): number => Math.hypot((q.x - p.x) * UNITS_PER_TILE, (q.y - p.y) * UNITS_PER_TILE, q.z - p.z);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1] || 1;
  const at = (u: number): P3 => {
    const d = clamp(u) * total;
    let i = 1;
    while (i < pts.length - 1 && cum[i] < d) i++;
    const s = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return mid3(pts[i - 1], pts[i], clamp(s));
  };
  const out = [at(a)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] / total > a && cum[i] / total < b) out.push(pts[i]);
  out.push(at(b));
  return out;
}

/** Blood let fall from a point: a few drops, heavy, that land. */
function bleed(k: FxScene, at: P3, n: number, spread = 0.04): void {
  k.burst(at, n, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 2, sizeEnd: 1.4, life: [0.35, 0.6], speed: [0.05, 0.35], up: [-2, 8], gravity: 70, drag: 0.6, jitter: spread, bias: 2 });
}

/**
 * Blood Price's cost on the ground: six small pools spattered round the feet
 * on the cut hand's side (the left), each landing in its turn as `grow` goes
 * nought to one, drying toward its own dark as `dried` does rather than fading
 * into the grass. All in one record.
 */
function spatter(k: FxScene, grow: number, dried: number, alpha: number): void {
  if (alpha <= 0.01 || grow <= 0.01) return;
  const b = k.caster, layers: GroundLayer[] = [], wet: number[][] = [], dark: number[][] = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 6; i++) {
    const land = clamp((grow - i * 0.12) / 0.3);
    if (land <= 0) continue;
    // Out to the left of the feet and a little ahead, where the cut palm was held.
    // Kept where it fell: a caster walking on leaves it behind.
    const c = k.once('spatter' + i, () => k.local(b, -2.2 - 4 * hashOf(k.seed + 131, i), -1 + 4.5 * hashOf(k.seed + 137, i), 0));
    const r = (0.03 + 0.05 * hashOf(k.seed + 139, i)) * easeOut(land);
    (i % 2 ? dark : wet).push(ragged(k, c, r, 140 + i));
    x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y);
  }
  if (!wet.length && !dark.length) return;
  const A = clamp(alpha);
  if (wet.length) layers.push({ kind: 'fill', colour: dry(BLOOD, dried * 0.8), alpha: A, paths: wet, lift: 0.08, glow: 0.3 * k.night, light: BLOOD });
  if (dark.length) layers.push({ kind: 'fill', colour: dry(BLOOD, 0.35 + 0.5 * dried), alpha: A, paths: dark, lift: 0.08, glow: 0.3 * k.night, light: BLOOD });
  k.groundShape((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2 + 0.2, layers);
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

/** A direction keyed through a cast, eased between keys and kept a unit long: an arm swung round rather than through. */
const dirAt = (t: number, keys: ReadonlyArray<readonly [number, V3]>): V3 => {
  if (t <= keys[0][0]) return keys[0][1];
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, a] = keys[i], [t1, b] = keys[i + 1], u = smooth(seg(t, t0, t1));
  const v: V3 = [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

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
const cowerPose: CastPose = (r, t, c) => {
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.42, [8, 0, 0]], [0.55, [-10, 0, 0]], [0.78, [-16, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.42, [6, 0, 10]], [0.55, [-4, 0, 6]], [0.78, [-6, 0, 4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.42, [4, 0, -8]], [0.55, [-10, 0, -4]], [0.78, [-14, 0, -2]], [1, [0, 0, 0]]]);
  r.arm[1] = euler(t, [[0.1, [6, 10, 0]], [0.42, [162, 16, 0]], [0.55, [94, 16, -6]], [0.78, [62, 20, -10]], [1, [8, 10, 0]]]);
  r.elbow[1] = one(t, [[0.1, 14], [0.42, 30], [0.55, 14], [0.78, 18], [1, 14]]);
  // The palm flat to the ground all the way down: pressing, not striking.
  r.hand[1] = euler(t, [[0.1, [0, 0, 0]], [0.42, [70, 0, 0]], [0.55, [60, 0, 0]], [0.78, [50, 0, 0]], [1, [0, 0, 0]]]);
  // Out over the creature as it comes down, the palm pressing toward it -- not across the body.
  const press = one(t, [[0.5, 0], [0.6, 1], [0.8, 1], [0.92, 0]]);
  const aside = clamp((c.aim?.aside ?? 0) * 0.1, -1.5, 1.5);
  r.reach = [undefined, goal([4.2 + aside, 7.5, 8.2], press, { pole: [8, 0, 11] })];
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
  // The chest wrenched round after the leading (right) hand as the two are torn apart: a wide, level rip.
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.4, [-10, 0, 0]], [0.5, [14, 0, -14]], [0.7, [10, 0, -10]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.4, [-2, 0, 0]], [0.5, [10, 0, 4]], [0.7, [6, 0, 3]], [1, [0, 0, 0]]]);
  const claw = one(t, [[0.12, 0], [0.3, 1], [0.8, 1], [0.95, 0]]);
  for (let k = 0; k < 2; k++) {
    // Torn apart and back: out to the sides and pulled behind the body, a little down, the hands ending behind the
    // hips as cloth is torn -- not held level in a T, and not flung up.
    const s = k ? 1 : -1;
    // Steered as a direction (the upper arm's, in the chest's frame), so the swing from ahead to the side goes round
    // level and not up over the head as angles mixed half way would.
    r.arm[k] = armToward(k, dirAt(t, [[0.1, [s * 0.17, 0.1, -0.98]], [0.4, [s * 0.12, 0.98, 0.1]], [0.45, [s * 0.18, 0.97, 0.12]],
      [0.5, [s * 0.72, -0.6, -0.36]], [0.7, [s * 0.66, -0.68, -0.3]], [1, [s * 0.17, 0.1, -0.98]]]));
    r.elbow[k] = one(t, [[0.1, 14], [0.4, 22], [0.45, 30], [0.5, 45], [0.7, 40], [1, 14]]);
    r.hand[k] = euler(t, [[0.1, [0, 0, 0]], [0.4, [-40, 0, 0]], [0.5, [20, 0, 0]], [0.7, [20, 0, 0]], [1, [0, 0, 0]]]);
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
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.28, [4, 0, 0]], [0.5, [-8, 0, 0]], [0.62, [-14, 0, 0]], [0.8, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.28, [4, 0, 0]], [0.5, [-6, 0, 0]], [0.62, [-10, 0, 0]], [0.8, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.28, [-10, 0, 0]], [0.5, [-18, 0, 0]], [0.62, [-24, 0, 0]], [0.8, [-20, 0, 0]], [1, [0, 0, 0]]]);
  const flat = one(t, [[0.14, 0], [0.26, 1], [0.8, 1], [0.95, 0]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0.1, [6, 10, 0]], [0.28, armOut(k, 165, 20)], [0.42, armOut(k, 120, 55)], [0.52, armOut(k, 70, 50)], [0.62, [50, -26, 44]], [0.8, [48, -24, 42]], [1, [8, 10, 0]]]);
    r.elbow[k] = one(t, [[0.1, 14], [0.28, 110], [0.42, 100], [0.52, 70], [0.62, 128], [0.8, 124], [1, 14]]);
    r.open[k] = false;
    r.knee[k] = one(t, [[0.1, 4], [0.28, 2], [0.62, 26], [0.8, 22], [1, 4]]);
    r.leg[k] = euler(t, [[0.1, [2, 2, 0]], [0.62, [12, 3, 0]], [0.8, [10, 3, 0]], [1, [2, 2, 0]]]);
  }
  // The hands' road: up behind the crown, down the sides of the head past the ears, out round the shoulders as a
  // hood is drawn about them, and in to hold it shut at the throat, crossed on the far shoulders.
  const road = (s: number): V3 => {
    const keys: Array<[number, V3]> = [[0.26, [1.1, -0.9, 16.8]], [0.38, [2.0, -0.3, 14.4]], [0.5, [2.9, 0.4, 11.8]], [0.62, [-0.9, 1.1, 11.5]]];
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const [t0, a] = keys[i], [t1, b] = keys[i + 1], u = smooth(seg(t, t0, t1));
    return [s * lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
  };
  const w = one(t, [[0.14, 0], [0.26, 1], [0.82, 1], [0.94, 0]]);
  r.reach = [goal(road(-1), w, { pole: [-6, -1, 11] }), goal(road(1), w, { pole: [6, -1, 11] })];
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
  // Bowed from the neck, not the back, while knelt: the trunk upright over the knee.
  r.spine = euler(t, [[0.1, [0, 0, 0]], [0.36, [-2, 0, 0]], [0.5, [-3, 0, 0]], [0.58, [8, 0, 0]], [0.76, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0.1, [0, 0, 0]], [0.36, [-6, 0, 0]], [0.5, [-6, 0, 0]], [0.58, [16, 0, 0]], [0.76, [12, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0.1, [0, 0, 0]], [0.36, [-28, 0, 0]], [0.5, [-30, 0, 0]], [0.58, [28, 0, 0]], [0.76, [20, 0, 0]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) {
    // Flung up and out in a V over the head with the roar, palms open to the sky: open to whatever comes, and from
    // every side a V, never an arm pointing at something.
    const s = k ? 1 : -1;
    r.arm[k] = euler(t, [[0.1, [6, 10, 0]], [0.36, [56, -30, 48]], [0.5, [56, -30, 48]], [0.58, armToward(k, [s * 0.7, -0.2, 0.68])], [0.76, armToward(k, [s * 0.66, -0.18, 0.72])], [1, [8, 10, 0]]]);
    r.elbow[k] = one(t, [[0.1, 14], [0.36, 142], [0.5, 142], [0.58, 20], [0.76, 20], [1, 14]]);
    r.hand[k] = euler(t, [[0.5, [0, 0, 0]], [0.58, [-30, 0, 0]], [0.76, [-30, 0, 0]], [1, [0, 0, 0]]]);
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

/** How much of a linger's time band to draw: what is left of it, drawn round over its first half second. */
const arcLeft = (age: number, left: number, lasts: number): number => Math.min(left / (lasts || 1), easeOut(clamp(age / 0.5)));
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
        // Over the fingertips, not over the mouth they are held to.
        rune(k, { x: at.x, y: at.y, z: at.z + 2.4 }, 1.6 * g, Math.floor(k.now * 6), { alpha: g, turn: k.now * 3 });
      },
      release: (k) => {
        const a = k.hand(1);
        k.state.ax = a.x; k.state.ay = a.y; k.state.az = a.z;
        // Flicked off the fingertips: a thin green spray along the throw.
        k.burst(a, 8, { kind: 'ember', colour: k.pal.accent, size: 1.4, sizeEnd: 0.6, life: [0.15, 0.3], speed: [0.8, 1.4], up: [-2, 4], heading: k.toward(k.caster, k.target), cone: 0.4, gravity: 0, drag: 0.2 });
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
        }
      } },
      hit: (k) => {
        bleed(k, k.heart(k.target), 8, 0.08);
      },
      // The words close on it: the three runes swinging in from wide to a tight ring round it, and blood at once.
      impact: { secs: 0.55, draw: (k, u) => {
        const b = k.target, R = footR(b) * (2.4 - 1.4 * easeOut(u * 1.6));
        hexRunes(k, b, R, u * 5, 1);
        k.flare(k.heart(b), 5 * (1 - u), 0.5 * flashOf(u), k.pal.accent, 0, k.pal.accent);
      } },
      // Bleeding a beat a second for its seconds: the runes going round it, flaring on the beat; on each beat a run
      // of blood down its flank to the ground, and a pool under it that grows with what it has lost (30% in all by
      // the end), so how far the hex has gone reads at a glance; the time running out round it.
      linger: { draw: (k, age, left) => {
        const b = k.target, a = fadeOf(age, left);
        const lasts = lastsOf(HEX) || 1;
        const beat = bump(age % 1, 0, 0.06, 0.35);
        hexRunes(k, b, footR(b), 5 + age * 1.1, a, beat);
        const heart = k.heart(b), foot = k.local(b, 0.6, 0.3, 0.6);
        const beatNow = ticked(k, age, 'beat') && left > 0.5;
        if (beatNow) {
          k.burst(heart, 4, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 2.8, sizeEnd: 2, life: [0.4, 0.6], speed: [0.02, 0.1], up: [-6, 0], gravity: 60, drag: 0.6, jitter: 0.04, bias: 2 });
        }
        // The run: down the flank from the heart, eaten from the top as the beat passes; lit at night.
        const run = bump(age % 1, 0, 0.1, 0.7);
        if (run > 0.02) {
          const pts = [heart, mid3(heart, foot, 0.5), foot];
          k.ribbon(eatTail(pts, 1 - run), { width: 2.2, taper: 'start', alpha: 0.95 * a, ...bloodLook, glow: 0.4 * k.night, bias: 2 });
        }
        // The pool lies where it bled: a creature that runs leaves it, and leaves a trail of splashes behind it a beat
        // apart, each drying and shrinking over three seconds.
        const lost = clamp(age / lasts);
        const anchor = k.once('pool', () => k.local(b, 0.3, 0.1, 0));
        const moved = Math.hypot(b.x - anchor.x, b.y - anchor.y) > footR(b) * 1.2;
        if (moved && k.state.poolLost === undefined) k.state.poolLost = lost;
        const grown = Math.min(lost, k.state.poolLost ?? 1);
        pool(k, anchor, footR(b) * (0.35 + 0.55 * grown), dry(BLOOD, 0.3 * grown + (moved ? 0.4 * (lost - grown) * 3 : 0)), 0.8 * a, 5, { share: 0.5, colour: BLOOD_DEEP, alpha: 0.7 * a, salt: 6 });
        if (moved && beatNow) {
          const slot = (k.state.splashes ?? 0) % 6;
          k.state.splashes = (k.state.splashes ?? 0) + 1;
          k.state['sx' + slot] = b.x; k.state['sy' + slot] = b.y; k.state['st' + slot] = age;
        }
        const drops: number[][] = [];
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < 6; i++) {
          const t0 = k.state['st' + i];
          if (t0 === undefined || age - t0 > 3) continue;
          const r = footR(b) * 0.3 * (1 - 0.6 * smooth((age - t0) / 3)) * easeOut(clamp((age - t0) * 4));
          const x = k.state['sx' + i], y = k.state['sy' + i];
          if (r <= 0.02) continue;
          drops.push(ragged(k, { x, y }, r, 20 + i));
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        if (drops.length) k.groundShape((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2 + 0.3, [{ kind: 'fill', colour: dry(BLOOD, 0.45), alpha: 0.85 * a, paths: drops, lift: 0.08 }]);
        k.light(anchor, 0.6, 0.25 * k.night * a, '#ff6070');
        timeArc(k, b, footR(b), arcLeft(age, left, lasts), { alpha: 0.75 * smooth(left / 0.8) });
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
      // The shriek going out to it: three crescents, each wider and fainter than the last, quick, bowed toward it.
      travel: { secs: (tiles) => 0.08 + tiles * 0.045, draw: (k, u) => {
        const from = k.head(), to = k.heart(k.target);
        // Drawn upright to the viewer, bowed the way they go on the screen: arcs from every facing, never darts.
        let sdx = k.sx(to) - k.sx(from), sdy = k.sy(to) - k.sy(from);
        const l = Math.hypot(sdx, sdy) || 1;
        sdx /= l; sdy /= l;
        for (let i = 0; i < 3; i++) {
          const v = clamp(u * 1.5 - i * 0.22);
          if (v <= 0 || v >= 1) continue;
          shriekArc(k, mid3(from, to, v), sdx, sdy, 4 + 8 * v, 3 * (1 - v * 0.35), 0.95 * (1 - v * 0.6));
        }
      } },
      // Startled: the jolt over its head, jumping up out of it.
      impact: { secs: 0.45, draw: (k, u) => {
        const b = k.target;
        startle(k, k.at(b, 1.02 + 0.12 * easeOut(u * 2)), 5 * (0.6 + 0.4 * easeOut(u * 3)), { shake: 1.2 });
      } },
      // Fleeing: the jolt settling into the faith's flee mark over it, an arrowhead pointing away from you, the way it
      // runs (the same mark Panic and the Gaze put on what runs from them); a wisp of dread trailing off it; the time.
      linger: { draw: (k, age, left) => {
        const b = k.target, a = fadeOf(age, left, 0.2);
        const jolt = 1 - smooth(seg(age, 0.3, 0.8));
        startle(k, k.at(b, 1.14), 5, { alpha: 0.9 * a * jolt, shake: 0.8 });
        const away = k.toward(k.caster, b);
        fleeMark(k, b, away, 0.32, a * (1 - jolt), bump((age * 2.2) % 1, 0, 0.12, 0.5));
        k.emit(k.at(b, 0.7), 4 * a, { kind: 'mist', colour: [k.pal.deep, k.pal.main], size: 1.6, life: [0.4, 0.7], speed: [0.3, 0.5], up: [2, 5], heading: away, cone: 0.5, gravity: -2, jitter: 0.05 });
        timeArc(k, b, footR(b), arcLeft(age, left, lastsOf(FRIGHT)), { alpha: 0.75 * smooth(left / 0.8) });
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
        // Where it falls: spattered on the ground by the cut hand's side, drop by drop.
        if (k.released < 0) spatter(k, smooth(seg(t, 0.34, 0.58)), 0, 1);
      },
      hit: (k) => {
        const palm = k.hand(0);
        // Taken up: the blood rising off the palm as drops, not sparks.
        k.burst({ x: palm.x, y: palm.y, z: palm.z + 2 }, 8, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.8, sizeEnd: 1.2, life: [0.4, 0.7], speed: [0.05, 0.2], up: [10, 20], gravity: -8, drag: 0.4, jitter: 0.02 });
      },
      // Taken: the blood goes up off the palm, turning the patron's violet, and sinks into the crown as favour; what
      // was paid lies spattered on the ground by the cut hand, drying -- blood on the ground, which no other rite of
      // the faith leaves.
      impact: { secs: 1.0, draw: (k, u) => {
        const palm = k.hand(0);
        const top = { x: palm.x, y: palm.y, z: palm.z + 2 + 6 * easeOut(u * 2) };
        // Over the crown, not into the face: it shrinks to nothing there.
        const into = mid3(top, k.at(k.caster, 1.12), easeIn(seg(u, 0.4, 0.9)));
        const col = mixColour(BLOOD, k.pal.main, smooth(u * 2.2));
        const r = 2.8 * (1 - seg(u, 0.6, 0.95));
        if (r > 0.2) k.orb(into, r, { main: col, deep: k.pal.deep, core: k.pal.core, turn: u * 6 });
        spatter(k, 1, seg(u, 0.2, 0.85), 1 - seg(u, 0.8, 1));
        k.light(k.caster, 1.4, 0.5 * flashOf(u, 0.2), '#ff9a9a');
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
        // What it was taken out of: bleeding at the heart while it is drawn, a pool gathering under it.
        const b = k.target;
        k.emit(from, 8, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.8, sizeEnd: 1.2, life: [0.3, 0.5], speed: [0.02, 0.1], up: [-4, 0], gravity: 60, drag: 0.5, jitter: 0.03, bias: 2 });
        pool(k, k.once('bled', () => k.local(b, 0.4, 0.2, 0)), footR(b) * 0.5 * easeOut(u), BLOOD, 0.85, 12, { share: 0.5, colour: BLOOD_DEEP, alpha: 0.8, salt: 13 });
      } },
      // Into you: the blood hauled into the chest, where it beats once and turns to the patron's green as it heals
      // you. Under the creature it was taken from, its blood drying on the ground.
      impact: { secs: 2.0, draw: (k, u) => {
        const chest = k.chest(), v = clamp(u * 2.5);
        const pulse = seg(v, 0.15, 0.5), col = mixColour(BLOOD, k.pal.accent, pulse);
        if (v < 1) k.orb(chest, 1.8 + 1.6 * bump(v, 0.05, 0.2, 0.5), { sides: 6, alpha: 1 - seg(v, 0.7, 1), main: col, deep: mixColour(BLOOD_DEEP, '#2f7a28', pulse), core: mixColour(BLOOD_CORE, '#e6ffe0', pulse), light: col, turn: 0.4, glow: 0.6 });
        // The blood taken in turning to the patron's green as it heals: a few drops lifting off the front of the chest
        // (out in front of the body, never up over the face).
        if (u > 0.06 && !k.state.healed) {
          k.state.healed = 1;
          const f = k.facingDir(k.caster), c = k.chest();
          k.burst({ x: c.x + f.x * 0.1, y: c.y + f.y * 0.1, z: c.z }, 5, { kind: 'drop', colour: [BLOOD, '#5fbf4a', k.pal.accent], size: 1.8, sizeEnd: 1.2, life: [0.35, 0.55], speed: [0.05, 0.15], up: [2, 6], gravity: 0, drag: 0.6, jitter: 0.03, heading: f, cone: 0.8 });
        }
        const b = k.target;
        pool(k, k.once('bled', () => k.local(b, 0.4, 0.2, 0)), footR(b) * 0.5, dry(BLOOD, seg(u, 0.1, 0.9)), 0.85 * lateFade(1 - u, 0.2), 12, { share: 0.5, colour: BLOOD_DEEP, alpha: 0.8 * lateFade(1 - u, 0.2), salt: 13 });
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
        // Born just over its back and growing down into it as they gather: they are its, not the sky's.
        const w = Math.max(0.14, b.wide / 28);
        thorns(k, b, { R: w * (1.6 - 0.4 * g), z: b.tall * (1.0 + 0.15 * (1 - g)), n: 5, len: 3.6 * (0.6 + 0.4 * g), dir: 'down', width: 1.8, turn: 0.2, grow: g, alpha: 0.85 * g, main: k.pal.main, deep: k.pal.ink });
      },
      // Pressed down onto it, with the palm.
      impact: { secs: 0.6, draw: (k, u) => {
        const b = k.target, w = Math.max(0.14, b.wide / 28);
        const down = easeIn(clamp(u * 2.2));
        thorns(k, b, { R: w * (1.2 - 0.15 * down), z: b.tall * (1.0 - 0.3 * down), n: 5, len: 3.6 + 0.6 * down, dir: 'down', width: 1.8, turn: 0.2, main: k.pal.main, deep: k.pal.ink });
        if (u > 0.45 && !k.state.thud) {
          k.state.thud = 1;
          k.burst(k.at(b, 0.05), 10, { kind: 'dust', colour: '#6a5a74', size: 2.6, life: [0.4, 0.7], speed: [0.3, 0.7], up: [1, 4], gravity: 2, drag: 0.2 });
        }
      } },
      // Bowed under it while it lasts: the talons sunk in its flanks, bearing down with each breath, and on the low of
      // each a puff of dust off its feet, pressed into the ground.
      linger: { draw: (k, age, left) => {
        const b = k.target, a = fadeOf(age, left), w = Math.max(0.14, b.wide / 28);
        const ph = age * 2.2, sag = 0.1 * Math.sin(ph);
        thorns(k, b, { R: w * 1.05, z: b.tall * (0.7 + sag), n: 5, len: 4.2, dir: 'down', width: 1.8, turn: 0.2, alpha: 0.85 * a, main: k.pal.main, deep: k.pal.ink });
        // The low of every breath (one in under three seconds).
        const low = Math.floor((ph + Math.PI / 2) / TAU);
        if (low > (k.state.low ?? 0) && left > 0.5) {
          k.state.low = low;
          k.burst(k.at(b, 0.02), 6, { kind: 'mist', colour: '#6a5a74', size: 2, life: [0.4, 0.7], speed: [0.2, 0.4], up: [0, 2], gravity: 1, drag: 0.4, jitter: b.wide / 60 });
        }
        timeArc(k, b, footR(b), arcLeft(age, left, (lastsOf('chaos_cower') || 1)), { alpha: 0.7 * smooth(left / 0.8) });
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
        k.burst(k.hand(1), 10, { kind: 'ember', colour: [BLOOD_CORE, BLOOD], size: 1.6, life: [0.3, 0.6], speed: [0.3, 0.7], up: [4, 14], gravity: 20, over: true });
      },
      // Sealed: the thorns of the oath closing hard round the fist held up, no mark on the ground -- it is the hand
      // that is armed. (The star under the feet is the grave rites': Undying and Cataclysm.)
      impact: { secs: 0.8, draw: (k, u) => {
        const fist = k.hand(1);
        thorns(k, { x: fist.x, y: fist.y, z: fist.z - 1.2 }, { R: 0.06 + 0.12 * (1 - easeOut(u * 2)), z: 0, n: 5, len: 2.8, dir: 'in', turn: u * 2, alpha: 1, width: 1.3, main: BLOOD, deep: BLOOD_DEEP });
        k.glow(fist, 6 * (1 - u) + 3, 0.7 * flashOf(u, 0.15), BLOOD, true);
        k.light(k.caster, 1.4, 0.6 * flashOf(u, 0.15), '#ffb0a0');
      } },
      // While it lasts: the striking hand bound in a crown of red thorns, blood dripping off the knuckles once a
      // second -- loaded; the time under the feet.
      linger: { on: 'caster', draw: (k, age, left) => {
        const a = fadeOf(age, left), fist = k.hand(1);
        const beat = bump((age * 0.9) % 1, 0, 0.08, 0.5);
        thorns(k, { x: fist.x, y: fist.y, z: fist.z - 1.2 }, { R: 0.06, z: 0, n: 5, len: 2.8, dir: 'in', turn: age * 0.6, alpha: 0.95 * a, width: 1.3, main: BLOOD, deep: BLOOD_DEEP });
        // The fist throbs red on the beat: the hand carries the read at play size, not the ground.
        k.glow(fist, 4 + 4 * beat, (0.25 + 0.55 * beat) * a, BLOOD, true);
        k.glow(fist, 3, 0.5 * beat * a, BLOOD_CORE, true);
        if (ticked(k, age, 'drip') && left > 0.5) k.burst({ x: fist.x, y: fist.y, z: fist.z - 1 }, 2, { kind: 'drop', colour: BLOOD, size: 2.6, sizeEnd: 1.8, life: [0.5, 0.7], speed: [0, 0.03], up: [-2, 0], gravity: 60, bias: 2 });
        // The time under the feet in the dark of the blood, quiet: the quieter of the two bargains' bands.
        timeArc(k, k.caster, footR(k.caster), arcLeft(age, left, (lastsOf('chaos_pact') || 1)), { alpha: 0.55 * smooth(left / 0.8), main: BLOOD_DEEP });
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
          k.orb(hands, 1 + 1.6 * g, { alpha: g, ...rotLook, turn: k.now * 3 });
          k.emit(hands, 12 * g, { kind: 'mist', colour: [ROT, '#6e7a2a'], size: 1.4, life: [0.3, 0.6], speed: [0, 0.05], up: [2, 6], gravity: -2 });
        }
        if (t > 0.42 && t < 0.56) k.emit(k.hand(1), 50, { kind: 'drop', colour: [ROT, '#6e7a2a'], size: 1.4, life: [0.3, 0.6], speed: [0.6, 1.4], up: [2, 10], heading: k.toward(k.caster, k.spot), cone: 1.2, gravity: 40 });
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
          k.ribbon([arcAt(from, to, Math.max(0, v - 0.1), lift), arcAt(from, to, Math.max(0, v - 0.05), lift), p], { width: 2.2, alpha: 0.8, ...rotLook, ink: ROT_DEEP, glow: 0.3 });
          k.orb(p, 1.8, { ...rotLook, glow: 0.4, turn: k.now * 6 });
        }
      } },
      hit: (k) => {
        const c = k.on(k.spot.x, k.spot.y, 1);
        k.burst(c, 24, { kind: 'mist', colour: [ROT, '#6e7a2a'], size: 3, life: [0.6, 1.2], speed: [0.6, 1.6], up: [1, 6], gravity: -1, drag: 0.25 });
        k.burst(c, 16, { kind: 'drop', colour: [ROT, k.pal.accent], size: 1.8, life: [0.3, 0.6], speed: [0.5, 1.2], up: [10, 24], gravity: 60 });
      },
      // It spreads: sores breaking out from where it took, a thin front running out to the edge of what it sickens,
      // and the band of its time drawn round behind the front.
      impact: { secs: 1.2, draw: (k, u) => {
        const R = radiusOf(PLAGUE), e = easeOut(u * 1.3);
        // Gone as it reaches the edge, where the band of the time takes over: never two lines at once.
        sickFront(k, k.spot, R * e, 0.9 * (1 - seg(u, 0.45, 0.7)));
        k.light(k.spot, R * 0.4, 0.45 * (1 - u * 0.5), '#c8f08a');
      } },
      // Festering for its seconds: the sores weeping, a thin haze over them, its edge the band of the time it has left.
      linger: { on: 'spot', draw: (k, age, left) => {
        // (The linger starts as it lands: the sores spread out over the impact's front, and the band of the time is
        // drawn round behind it.)
        const R = radiusOf(PLAGUE), a = fadeOf(age, left, 0.01, 1.5);
        blight(k, k.spot, R, easeOut(age * 1.1), 0.85 * a);
        timeArc(k, k.spot, R, arcLeft(Math.max(0, age - 0.7), left, lastsOf(PLAGUE)), { alpha: 0.85 * smooth(left / 0.8), band: 0.1, main: ROT });
        // Particles held to ten a second all told for its thirty seconds, whatever stands in it: the haze 1.5, a
        // vapour off the nearest three at 1.5 each, one creature's blood let a beat (2), a bubble's 2.
        k.emit(k.on(k.spot.x, k.spot.y, 2), 1.5 * a, { kind: 'mist', colour: [ROT, '#6e7a2a'], size: 2.4, life: [1.8, 2.4], speed: [0.02, 0.08], up: [2, 5], gravity: -1, jitter: R * 0.5 });
        // Every wild creature standing in it sick, and carrying it as it goes: the ground going bad under its feet,
        // flies at it, a sick vapour rising off its back, and its blood let, each in its turn a beat.
        const beat = ticked(k, age, 'beat') && left > 0.5;
        // Each for as long as the island says its bleed runs.
        const sick = taken(k, k.spot, R, 6).filter((b) => age < k.secsOn(b, age + left)), turn = Math.floor(age) % Math.max(1, sick.length);
        sick.forEach((b, i) => {
          pool(k, b, footR(b) * 1.1, '#4e5a22', 0.65 * a, 7, { share: 0.5, colour: '#8a9a2e', alpha: 0.55 * a, salt: 8 });
          // Flies at it, the sign of sickness anybody reads (the nearest few: a herd would cost a frame).
          if (i < 4) flies(k, b, 7, a);
          if (i < 3) k.emit(k.at(b, 0.95), 1.5 * a, { kind: 'mist', colour: '#c8e070', size: 2.6, life: [0.7, 1.1], speed: [0, 0.04], up: [3, 6], gravity: -1, jitter: b.wide / 60 });
          if (beat && i === turn) bleed(k, k.heart(b), 2, 0.06);
        });
        // A bubble breaks each second somewhere in it, on the same beat.
        if (beat) {
          const an = k.rand() * TAU, rr = Math.sqrt(k.rand()) * R * 0.8;
          k.burst(k.on(k.spot.x + Math.cos(an) * rr, k.spot.y + Math.sin(an) * rr, 1), 2, { kind: 'drop', colour: [ROT, k.pal.accent], size: 1.8, life: [0.3, 0.5], speed: [0.2, 0.4], up: [8, 14], gravity: 60 });
        }
        k.light(k.spot, R * 0.3, 0.25 * a, '#c8f08a');
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
        // The shriek out of the thrown-back head: three arcs going up off the mouth, widening, the faith's shriek as
        // Fright's goes out at a creature.
        const since = k.released;
        if (since >= 0 && since < 0.45) {
          const mouth = k.head();
          for (let i = 0; i < 3; i++) {
            const v = clamp((since - i * 0.08) / 0.3);
            if (v <= 0 || v >= 1) continue;
            shriekArc(k, { x: mouth.x, y: mouth.y, z: mouth.z + 2 + 7 * v }, 0, -1, 3 + 6 * v, 2.4 * (1 - 0.5 * v), 1 - v * v);
          }
        }
      },
      // The shriek: everything round the spot thrown out from it in two quick shock rings, arrows racing out on the
      // ground, and a low drift of dust thrown off it.
      hit: (k) => {
        k.burst(k.on(k.spot.x, k.spot.y, 2), 14, { kind: 'mist', colour: '#5a4a66', size: 2, life: [0.5, 0.9], speed: [radiusOf(PANIC) * 0.3, radiusOf(PANIC) * 0.7], up: [1, 4], gravity: 2, drag: 0.3 });
      },
      impact: { secs: 0.9, draw: (k, u) => {
        const R = radiusOf(PANIC);
        // Two shock rings, the outer stopping exactly at the edge of what it frightens.
        for (let i = 0; i < 2; i++) {
          const v = clamp((u - i * 0.14) / 0.6);
          if (v <= 0 || v >= 1) continue;
          const rr = 0.2 + (R - 0.2) * (i === 0 ? 1 : 0.7) * easeOut(v);
          k.ring(k.spot, rr, { band: Math.min(rr * 0.3, 0.2 * (1 - v)), alpha: 1 - v * v, turn: v * 0.5 + i, main: i === 0 ? k.pal.main : k.pal.deep, glow: 0.5 });
        }
        chevrons(k, k.spot, 0.4 + (R - 0.6) * easeOut(u * 1.2), 8, 0.45, { alpha: 1 - seg(u, 0.7, 1), turn: 0.2 });
        // The shock reaching each creature in turn: its arrowhead jumps up over it as the ring passes it.
        for (const b of taken(k, k.spot, R)) {
          const w = fleeWay(k, b);
          const reached = smooth(clamp((0.2 + R * easeOut(clamp(u / 0.6)) - w.d) * 2));
          fleeMark(k, b, w, 0.32 * (0.5 + 0.5 * reached), reached, 1 - reached);
        }
        k.light(k.spot, R * 0.6, 0.45 * flashOf(u, 0.1), k.pal.main);
      } },
      // While they run: arrowheads on the ground racing outward from the spot over and over, and the edge with its time on it.
      linger: { on: 'spot', draw: (k, age, left) => {
        const R = radiusOf(PANIC), a = fadeOf(age, left, 0.5, 1);
        for (let w = 0; w < 2; w++) {
          const cyc = (age * 0.55 + w * 0.5) % 1;
          chevrons(k, k.spot, 0.4 + (R - 0.7) * cyc, 8, 0.4, { alpha: 0.7 * a * Math.sin(Math.PI * cyc), turn: 0.2 + w * (TAU / 16) });
        }
        // Drawn round behind the shock as it reaches the edge, then emptying.
        timeArc(k, k.spot, R, arcLeft(Math.max(0, age - 0.45), left, lastsOf(PANIC)), { alpha: 0.8 * smooth(left / 0.8), band: 0.1 });
        // A low breath of dread blown outward along the ground with them, not sparkle.
        k.emit(k.on(k.spot.x, k.spot.y, 1), 6 * a, { kind: 'mist', colour: [k.pal.main, k.pal.deep], size: 1.8, life: [0.6, 1], speed: [R * 0.5, R * 0.9], up: [0, 3], gravity: 0, drag: 1 });
        // Over every creature fleeing it -- in it, or just run out of it -- an arrowhead pointing the way it runs, for as
        // long as the island says that one flees: a monster for its own three seconds.
        const beat = bump((age * 2.2) % 1, 0, 0.12, 0.5);
        for (const b of taken(k, k.spot, R + 3)) {
          const runs = k.secsOn(b, age + left);
          if (age >= runs) continue;
          const w = fleeWay(k, b);
          const out = w.d > R ? Math.max(0, 1 - (w.d - R) / 3) : 1;
          fleeMark(k, b, w, 0.32, 0.9 * a * out * smooth((runs - age) / 0.4), beat);
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
        k.burst(at, 8, { kind: 'spark', colour: [k.pal.core, k.pal.main], size: 1.4, life: [0.2, 0.4], speed: [0.6, 1.4], up: [0, 12], gravity: 10 });
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
            const at = (w: number): P3 => {
              const q = mid3(from, to, easeIn(w)), aw = i * 2.1 + w * 5;
              q.x += Math.cos(aw) * 0.15 * (1 - w); q.y += Math.sin(aw) * 0.15 * (1 - w);
              return q;
            };
            const p = at(v);
            // Favour as light, not as the patron's dark gem, each with a short tail of its way up so the rise reads.
            k.ribbon([at(Math.max(0, v - 0.16)), at(Math.max(0, v - 0.08)), p], { width: 2.2, taper: 'start', alpha: 0.8, main: k.pal.core, core: '#ffffff', ink: '#8a5aa8', light: k.pal.core, glow: 0.5 });
            k.orb(p, 2.2, { turn: k.now * 5 + an, main: k.pal.core, deep: '#c89ae8', core: '#ffffff', light: k.pal.core, glow: 0.9 });
          }
        }
        // Where it was, nothing: a small tear in the air at the hands where the thing went, gaping once and snapping
        // shut in splinters. Unmade -- gone nowhere, which no other rite of the faith does.
        const fell = k.once('fell', () => mid3(k.hand(0), k.hand(1), 0.5));
        const gape = bump(u, 0, 0.12, 0.4);
        rift(k, fell, { len: 3 + 2 * gape, wide: 2, open: gape, tilt: 0.25, alpha: 1, bias: 3 });
        if (u > 0.36 && !k.state.shut) {
          k.state.shut = 1;
          k.burst(fell, 8, { kind: 'shard', colour: [k.pal.main, k.pal.core], size: 1.2, life: [0.2, 0.35], speed: [0.3, 0.6], up: [-3, 3], gravity: 0, drag: 0.6, spin: 4, ink: false });
        }
        k.light(k.caster, 1.4, 0.5 * flashOf(u, 0.1), '#f0dcff');
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
        // A few splinters of the torn air, staying round the tear rather than flying over everything.
        k.burst(at, 12, { kind: 'shard', colour: [k.pal.main, k.pal.deep], size: 1.8, life: [0.3, 0.6], speed: [0.4, 0.9], up: [4, 14], gravity: 40, spin: 3 });
        bleed(k, at, 10, 0.1);
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
        // Whole, it is dim and small: the split is the bright beat, not the pull.
        if (split < 0.05) soulWisp(k, { x: at.x, y: at.y, z: at.z + 6 * up }, at, 2.2, smooth(u * 10), 0.5);
        else for (const s of [-1, 1]) {
          const p = { x: at.x + (-away.y * s * 0.28 + away.x * 0.05) * split, y: at.y + (away.x * s * 0.28 + away.y * 0.05) * split, z: at.z + 6 * up + 2 * split };
          soulWisp(k, p, { x: at.x, y: at.y, z: at.z + 6 * up }, 3.6 * (1 - 0.3 * split), fade, 1);
        }
        k.light(b, 1.4, 0.8 * flashOf(u, 0.1), '#e0c8ff');
      } },
    },
  },

  // Shroud (pray, on self, 3 tiles round, lasts 60 s): For 60 s nothing notices you from further than 3 tiles off, and whatever is hunting you from further than that loses you.
  chaos_shroud: {
    palette: PALETTE,
    cast: { timing: { secs: 1.8, release: 0.6 }, pose: shroudPose },
    fx: {
      // The dark poured down over the head from the raised hands as the hood comes down, and the body going into it:
      // darkened from the crown as the hands draw it down.
      charge: (k, t) => {
        const g = bump(t, 0.2, 0.4, 0.58);
        if (g > 0) k.emit(mid3(k.hand(0), k.hand(1), 0.5), 24 * g, { kind: 'mist', colour: [k.pal.ink, k.pal.deep], size: 2, life: [0.4, 0.7], speed: [0.03, 0.12], up: [-12, -6], gravity: 4, jitter: 0.05 });
        const hood = smooth(seg(t, 0.3, 0.6));
        k.veil(k.caster, { colour: SHROUD_DARK, tint: 0.7 * hood, fade: 0.4 * hood });
        // The hood itself, in the hands: a dark cowl hanging from them over the crown, drawn down the sides of the
        // head as they come down, and gone into the body's own dark as the veil takes it.
        const cowl = smooth(seg(t, 0.24, 0.32)) * (1 - smooth(seg(t, 0.56, 0.7)));
        if (cowl > 0.01) {
          const crown = k.at(k.caster, 1.06), l = k.hand(0), r = k.hand(1);
          const sag = (h: P3): P3 => { const m = mid3(crown, h, 0.5); return { x: m.x, y: m.y, z: m.z + 1.2 }; };
          k.ribbon([l, sag(l), crown, sag(r), r], { width: 3.4, taper: 'none', alpha: 0.85 * cowl, main: SHROUD_DARK, core: k.pal.deep, ink: k.pal.ink, glow: 0 , bias: 2 });
        }
      },
      // Veiled: a fog rolling off the feet out to the edge past which nothing knows you are there, and settling at it.
      hit: (k) => {
        const R = radiusOf(SHROUD);
        k.burst(k.at(k.caster, 0.08), 16, { kind: 'mist', colour: [k.pal.deep, '#2a1a3a'], size: 2, life: [0.8, 1.2], speed: [R * 0.9, R * 1.3], up: [0, 2], gravity: 0, drag: 0.4 });
      },
      impact: { secs: 1.0, draw: (k, u) => {
        const R = radiusOf(SHROUD);
        k.veil(k.caster, { colour: SHROUD_DARK, tint: 0.7, fade: 0.4 });
        // The fog's front running out to the edge, and the band of the time drawn round behind it.
        k.ring(k.caster, 0.2 + (R - 0.2) * easeOut(u), { band: 0.06, alpha: 0.7 * (1 - u), main: k.pal.main, deep: k.pal.deep, glow: 0.3 * k.night });
      } },
      // While it holds: you, gone dark and half into the air, a low fog curling off your feet, and the edge of the
      // ground past which nothing notices you, with its time.
      linger: { on: 'caster', draw: (k, age, left) => {
        const R = radiusOf(SHROUD), a = fadeOf(age, left, 0.01, 1.5);
        k.veil(k.caster, { colour: SHROUD_DARK, tint: 0.7 * a, fade: (0.4 + 0.05 * Math.sin(age * 1.7)) * a });
        // Quiet: you should know how far you are hidden, but the mark of it should not shout.
        timeArc(k, k.caster, R, arcLeft(Math.max(0, age - 0.6), left, lastsOf(SHROUD)), { alpha: 0.45 * smooth(left / 0.8), band: 0.1, main: k.pal.deep });
        k.emit(k.at(k.caster, 0.04), 6 * a, { kind: 'mist', colour: [k.pal.ink, k.pal.deep], size: 1.6, life: [1, 1.2], speed: [0.04, 0.12], up: [0, 3], gravity: -1, jitter: 0.12 });
      } },
    },
  },

  // Blood Feast (pray, on self, lasts 60 s): Costs no favour.
  chaos_blood_feast: {
    palette: PALETTE,
    cast: { timing: { secs: 1.6, release: 0.55 }, pose: bloodFeastPose },
    fx: {
      // The blood drawn up out of the ground under the turned-up palms: a pool welling there, and drops of it rising
      // nearly straight up into the hands, gathering as they come to the lips.
      charge: (k, t) => {
        const g = smooth(seg(t, 0.15, 0.5));
        if (g <= 0 || t > 0.62) return;
        const into = mid3(k.hand(0), k.hand(1), 0.5);
        const end = 1 - seg(t, 0.5, 0.62);
        for (let s = 0; s < 2; s++) {
          const h = k.hand(s), from = k.on(h.x, h.y, 0.3);
          pool(k, from, 0.12 * g, dry(BLOOD, 0.3), 0.85 * g * end, s, { share: 0.5, colour: BLOOD_DEEP, alpha: 0.8 * g * end, salt: s + 2 });
          // Beads running up a near-upright line to the hand that is over the pool.
          for (let i = 0; i < 4; i++) {
            const v = ((k.now * 1.6 + i / 4 + s * 0.13) % 1);
            const p = arcAt(from, h, v, 1);
            k.orb(p, 1 * (0.6 + 0.4 * v), { ...bloodLook, alpha: g * end * smooth(v * 5) * (1 - seg(v, 0.85, 1)), ink: k.pal.ink, glow: 0.2 });
          }
        }
        k.orb(into, 1 + 1.4 * g, { ...bloodLook, ink: k.pal.ink, turn: k.now * 3, alpha: end });
      },
      // Drunk.
      hit: (k) => {
        k.burst(k.head(), 14, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.6, life: [0.3, 0.5], speed: [0.1, 0.4], up: [2, 8], gravity: 60 });
      },
      impact: { secs: 0.9, draw: (k, u) => {
        const heart = k.chest();
        const beat = Math.max(bump(u, 0, 0.08, 0.3), bump(u, 0.3, 0.38, 0.6));
        k.orb(heart, 2 + 1.6 * beat, { ...bloodLook, ink: k.pal.ink, alpha: 1 - seg(u, 0.7, 1), turn: 0.4, sides: 6 });
        k.glow(heart, 8 + 6 * beat, 0.7 * (1 - u), BLOOD, true);
        k.light(k.caster, 1.4, 0.6 * (1 - u), '#ffb0a0');
      } },
      // While it lasts: a heart of blood beating in the chest, and on each beat the blood sent out from it down both
      // arms to the hands -- the hands that land the blows that feed you; the time under the feet.
      linger: { on: 'caster', draw: (k, age, left) => {
        const a = fadeOf(age, left), heart = k.chest();
        const ph = age % 1.1;
        const beat = Math.max(bump(ph, 0, 0.06, 0.22), 0.6 * bump(ph, 0.22, 0.28, 0.45));
        k.orb(heart, 1.8 + 0.9 * beat, { ...bloodLook, ink: k.pal.ink, alpha: 0.95 * a, sides: 6, turn: 0.4, glow: 0.4 });
        k.glow(heart, 5 + 3 * beat, 0.4 * a * (0.5 + beat), BLOOD, true);
        // Down the arms: a run of blood from the chest to each hand, its head reaching the hand and its tail eaten
        // after it from the chest, over a quarter second a beat; the hands glowing red as it gets there.
        const head = easeOut(seg(ph, 0.02, 0.18)), tail = easeIn(seg(ph, 0.1, 0.3));
        if (head > 0 && tail < 1) {
          for (const s of [0, 1]) {
            // Down the arm itself: the chest, the shoulder, the elbow, the hand.
            const arm = [heart, k.joint(k.caster, `arm${s}`, [0, 0, 0]), k.joint(k.caster, `elbow${s}`, [0, 0, 0]), k.hand(s)];
            k.ribbon(stretch(arm, tail, head), { width: 1.8, taper: 'none', alpha: 0.95 * a, ...bloodLook, ink: k.pal.ink, glow: 0.4, bias: 2 });
          }
        }
        const reached = bump(ph, 0.16, 0.22, 0.45);
        if (reached > 0) for (const s of [0, 1]) k.glow(k.hand(s), 4, 0.6 * a * reached, BLOOD, true);
        const fr = footR(k.caster);
        timeArc(k, k.caster, fr, arcLeft(age, left, (lastsOf('chaos_blood_feast') || 1)), { alpha: 0.75 * smooth(left / 0.8), main: BLOOD });
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
        // Until it breaks: then the impact has them.
        if (k.released < 0) {
          chaosStar(k, k.spot, R, { grow: g, turn: 0.1, alpha: 0.85 * g });
          cracks(k, k.spot, R * 0.85, { n: 10, grow: seg(t, 0.38, 0.5), alpha: 0.9 });
        }
        if (t > 0.4) k.emit(k.on(k.spot.x, k.spot.y, 1), 40, { kind: 'dust', colour: ['#5a4a3e', '#3e3430'], size: 2.4, life: [0.3, 0.6], speed: [0.1, 0.4], up: [2, 8], gravity: 10, jitter: R * 0.6 });
        if (t < 0.5) k.light(k.spot, 3, 0.5 * g, '#e8d8ff');
      },
      hit: (k) => {
        const R = radiusOf(CATACLYSM);
        const c = k.on(k.spot.x, k.spot.y, 2);
        k.burst(c, 70, { kind: 'shard', colour: ['#4a3e36', '#6a5a4e', k.pal.deep], size: 2.6, life: [0.6, 1.2], speed: [R * 0.15, R * 0.6], up: [16, 40], gravity: 70, spin: 3, jitter: R * 0.3 });
        k.burst(c, 40, { kind: 'dust', colour: ['#5a4a3e', '#3e3430', k.pal.deep], size: 4, life: [0.8, 1.4], speed: [R * 0.4, R * 0.9], up: [2, 8], gravity: 2, drag: 0.2 });
        k.burst(c, 30, { kind: 'spark', colour: [k.pal.core, k.pal.accent, k.pal.main], size: 2, life: [0.3, 0.7], speed: [R * 0.3, R * 0.8], up: [10, 40], gravity: 40 });
        k.flash(0.22, k.pal.light);
      },
      // The ground breaks: rock torn up in rings running out to the edge (never through anybody standing there), a
      // black column at the heart, the shock to the very rim, and a crater left where it struck.
      impact: { secs: 1.5, draw: (k, u) => {
        const R = radiusOf(CATACLYSM);
        k.pillar(k.spot, { r: 10 * (1 - u * 0.5), h: 110, alpha: flashOf(u, 0.06), main: k.pal.deep, deep: k.pal.ink, core: k.pal.main });
        // Three rings of rock, the inner first: the break running outward, each up in a jolt and settling back.
        const standing = k.bodiesWithin(R * 1.05 + 0.6, k.spot);
        const rings: Array<[number, number, number]> = [[0.2, 4, 34], [0.5, 5, 26], [0.8, 7, 18]];
        rings.forEach(([at, n, h], i) => {
          const t0 = at * 0.3;
          const v = u < t0 ? 0 : u < t0 + 0.08 ? easeOut((u - t0) / 0.08) : 1 - smooth(seg(u, 0.6, 1));
          spires(k, k.spot, R * at, n, h, v, 50 + i * 7, standing);
        });
        const rr = 0.3 + R * easeOut(seg(u, 0, 0.5));
        k.ring(k.spot, rr, { band: Math.min(rr * 0.3, 0.35 * (1 - u)), alpha: 1 - seg(u, 0.4, 0.75), glow: 0.8, turn: u });
        chaosStar(k, k.spot, R, { grow: 1, turn: 0.1, alpha: 0.9 * (1 - seg(u, 0.8, 1)), main: dry(k.pal.main, seg(u, 0.4, 0.85)), head: dry(k.pal.accent, seg(u, 0.4, 0.85)) });
        // The crater punched where it struck, anybody on the spot left standing on a pillar in it; the cracks run out
        // from its lip.
        const cr = R * 0.18 * easeOut(u * 3), near = k.bodiesWithin(R * 0.18 + 0.6, k.spot);
        crater(k, k.spot, cr, 1, near);
        cracks(k, k.spot, R * 0.85, { n: 10, grow: 1, alpha: 1, from: cr * 0.9 });
        k.light(k.spot, 3, 1 - u * 0.6, '#e8d8ff');
        k.light(k.caster, 1.4, 0.4 * (1 - u), '#fff1d6');
        // The blast reaching each creature it takes in turn, as the break runs out past it: a short column of the
        // patron's dark on it, and as it strikes, its blood and a ring of grit and torn stuff thrown off it. (The one on
        // the spot is under the great column already.)
        taken(k, k.spot, R, 6).forEach((b, i) => {
          const d = Math.hypot(b.x - k.spot.x, b.y - k.spot.y), t0 = (d / R) * 0.3, v = seg(u, t0, t0 + 0.25);
          if (d > 0.6 && v > 0 && v < 1) k.pillar(b, { r: 3, h: 30, alpha: flashOf(v, 0.15) * (1 - v), main: k.pal.deep, deep: k.pal.ink, core: k.pal.accent });
          const key = 'struck' + (b.who && b.who.kind !== 'player' ? b.who.id : -1 - i);
          if (u >= t0 && !k.state[key]) {
            k.state[key] = 1;
            const at = k.heart(b);
            k.burst(at, 10, { kind: 'shard', colour: [k.pal.main, k.pal.deep, '#4a3e36'], size: 1.6, life: [0.3, 0.5], speed: [0.6, 1], up: [2, 6], gravity: 30, drag: 0.5, spin: 3 });
            bleed(k, at, 6, 0.08);
          }
        });
      } },
      // What it leaves: the cracks cooling and the crater, for a few seconds.
      linger: { on: 'spot', secs: 4.5, draw: (k, age, left) => {
        // From the end of the impact (which draws them till then) for three seconds.
        if (age < 1.5) return;
        const R = radiusOf(CATACLYSM), a = smooth(left / 3);
        // The crater closing up rather than fading into the grass, gone by alpha only at the very last.
        const cr = R * 0.18 * (0.35 + 0.65 * smooth(left / 3));
        crater(k, k.spot, cr, smooth(left / 0.6), k.bodiesWithin(R * 0.18 + 0.6, k.spot));
        cracks(k, k.spot, R * 0.85, { n: 10, grow: 1, alpha: a * (0.6 + 0.4 * Math.sin(age * 6) * a), from: cr * 0.9 });
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
        // Its light only until it looks: then the light is on what it looks at.
        if (k.released < 0) k.light(k.caster, 1.4, 0.4 * g, '#e0c8ff');
      },
      // Its stare: a black beam from the eye to it.
      release: (k) => {
        k.flash(0.1, k.pal.deep);
      },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 12, { kind: 'shard', colour: [k.pal.accent, '#3f9a32'], size: 1.8, life: [0.3, 0.6], speed: [0.3, 0.8], up: [4, 14], gravity: 40, spin: 3, ink: false });
      },
      impact: { secs: 0.9, draw: (k, u) => {
        const over = k.at(k.caster, 1.32), b = k.target;
        const fade = 1 - smooth(seg(u, 0.4, 1));
        abyssEye(k, over, { r: 9 * (1 - 0.3 * u), open: fade, alpha: fade, look: { x: 0, y: 1.5 } });
        // The stare out of the eye's own pupil, narrowing to the creature.
        // Sorted with the eye but under it, so it comes out of the pupil rather than lying over it.
        // A cone of the eye's light, wide at the eye and narrowing onto it, with a thin green thread of the iris's
        // own light down its middle: light leaving an eye, not a string.
        const stare = [k.heart(b), mid3(over, k.heart(b), 0.5), over];
        k.ribbon(stare, { width: 8 * fade, taper: 'start', alpha: 0.5 * fade, main: k.pal.deep, core: k.pal.main, light: k.pal.accent, glow: 0.4, edge: false, sortAt: over, bias: 1 });
        k.ribbon(stare, { width: 1.5 * fade, taper: 'start', alpha: 0.9 * fade, main: k.pal.accent, core: '#e6ffe0', light: k.pal.accent, glow: 0.6, edge: false, sortAt: over, bias: 1.1 });
        // Cracked open where it was looked at: what makes every blow cut deeper.
        thorns(k, b, { R: Math.max(0.16, b.wide / 25) * (1.6 - 0.5 * easeOut(u * 2)), z: b.tall * 0.5, n: 7, len: 5, dir: 'in', turn: 0.2, alpha: 1 - seg(u, 0.8, 1) * 0.3, main: k.pal.accent, deep: '#2f7a28', width: 1.6 });
        k.light(b, 1.4, 0.8 * flashOf(u, 0.1), '#e0c8ff');
      } },
      // While it lasts: the eye hanging over it, watching it run and blinking now and then; the green shards in it that let blows in; the time.
      linger: { draw: (k, age, left) => {
        const b = k.target, a = fadeOf(age, left), w = Math.max(0.16, b.wide / 25);
        const blink = 1 - bump(age % 3.7, 3.3, 3.45, 3.6);
        const away = k.toward(b, k.caster);
        // High over it, clear of the flee mark under it (the faith's mark for running, as on Fright and Panic).
        abyssEye(k, { x: b.x, y: b.y, z: b.z + b.tall * 1.12 + 10 }, { r: 5, open: blink * smooth(age / 0.4), alpha: a, look: { x: (away.x - away.y) * 1.4, y: (away.x + away.y) * 0.5 } });
        fleeMark(k, b, k.toward(k.caster, b), 0.24, 0.9 * a, bump((age * 2.2) % 1, 0, 0.12, 0.5));
        // Three green splinters left driven into it from the stare, slowly going round: the cracks every blow gets in by
        // (the impact's thorns, fewer and kept).
        thorns(k, b, { R: w * 1.15, z: b.tall * 0.5, n: 3, len: 3.6, dir: 'in', turn: age * 1.3, alpha: 0.95 * a, main: k.pal.accent, deep: '#1f5a1a', width: 1.5 });
        timeArc(k, b, footR(b), arcLeft(age, left, lastsOf(GAZE)), { alpha: 0.75 * smooth(left / 0.8) });
        k.light(b, 1.4, 0.35 * a, '#e0c8ff');
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
        graves(k, k.caster, 0.55, g * (1 - seg(t, 0.55, 0.6)));
        k.emit(k.at(k.caster, 0.02), 30 * g, { kind: 'smoke', colour: [k.pal.ink, k.pal.deep], size: 2.2, life: [0.5, 0.9], speed: [0.02, 0.1], up: [4, 10], gravity: -2, jitter: 0.5 });
        chaosStar(k, k.caster, 0.8, { grow: g, turn: -0.2, alpha: 0.85 * g });
      },
      // Up from the grave: the stones burst, a black column through you, and the crown of thorns set on the head.
      hit: (k) => {
        k.burst(k.at(k.caster, 0.2), 40, { kind: 'shard', colour: [GRAVE[0], GRAVE[1]], size: 2.2, life: [0.4, 0.9], speed: [0.6, 1.6], up: [10, 30], gravity: 60, spin: 3, jitter: 0.5 });
        k.burst(k.chest(), 4, { kind: 'ember', colour: k.pal.accent, size: 1.4, life: [0.5, 0.9], speed: [0.2, 0.5], up: [10, 20], gravity: 0 });
        k.flash(0.2, k.pal.deep);
      },
      impact: { secs: 1.2, draw: (k, u) => {
        k.pillar(k.caster, { r: 7, h: 80, alpha: flashOf(u, 0.08), main: k.pal.deep, deep: k.pal.ink, core: k.pal.main });
        const head = k.head();
        thorns(k, { x: head.x, y: head.y, z: head.z + 2.2 }, { R: 0.075, z: 0, n: 7, len: 2.4 * easeOut(seg(u, 0.1, 0.5)), dir: 'up', turn: u * 0.6, alpha: 1, main: k.pal.accent, deep: '#2f7a28', width: 0.9 });
        chaosStar(k, k.caster, 0.8, { grow: 1, turn: -0.2, alpha: 0.85 * (1 - seg(u, 0.4, 1)) });
        k.light(k.caster, 3.5, 0.9 * flashOf(u, 0.1));
      } },
      // While death cannot have you: the crown of green thorns on your head, turning, and the time running out under your feet.
      linger: { on: 'caster', draw: (k, age, left) => {
        const a = fadeOf(age, left, 0.3, 1.5), head = k.head();
        thorns(k, { x: head.x, y: head.y, z: head.z + 2.2 }, { R: 0.075, z: 0, n: 7, len: 2.4, dir: 'up', turn: age * 0.5, alpha: 0.95 * a, main: k.pal.accent, deep: '#2f7a28', width: 0.9 });
        k.glow({ x: head.x, y: head.y, z: head.z + 3 }, 5, 0.35 * a, k.pal.accent);
        if (!k.fast) k.emit({ x: head.x, y: head.y, z: head.z + 3 }, 3 * a, { kind: 'ember', colour: k.pal.accent, size: 1.2, life: [0.5, 0.9], speed: [0, 0.04], up: [4, 8], gravity: 0, jitter: 0.08 });
        timeArc(k, k.caster, footR(k.caster), arcLeft(age, left, (lastsOf('chaos_undying') || 1)), { alpha: 0.65 * smooth(left / 0.8) });
      } },
    },
  },
};
