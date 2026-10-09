/**
 * The Kindler's spells: how each is cast and what it looks like.
 *
 * Twelve spells, and the arcane Ember and Pyre. The group's shape is the
 * tongue of flame: a faceted teardrop, lit on the side toward the viewer's
 * left shoulder, shaded on the other, a hotter heart up its middle and an ink
 * edge round it, licking and dying in a cycle of its own. Every fire here is
 * made of those -- a burn is a few of them licking over a body, a wall is a
 * ring of them, a fireball trails them -- so a Kindler's work reads as one
 * hand's across a field. Heat is told by colour: white-hot at the moment of a
 * blow, orange while it burns, the deep red of coals as it dies.
 *
 * What each spell does is what it shows. A burn licks over its creature for
 * exactly its seconds and dwindles as they run out, bigger the more it burns a
 * second; an area is drawn at exactly the tiles it reaches; a buff stays with
 * the caster for exactly as long as it holds, quietly. Every size and time is
 * read from the spell's own numbers (`k.fx`, `spellInfo`), never written here.
 *
 * Nothing here is shared with other files, so the flame, the ring of flames,
 * the burn and the fireball are all written below, above the record.
 */
import type { CastPose, PoseCue, SpellVisual } from './index';
import {
  arcAt, bump, clamp, dry, easeIn, easeOut, flashOf, glowPicture, hashOf, lateFade, lerp, mid3, seg, smooth, TAU,
  type Body, type FxScene, type P3, type ShapePiece, type SpellPalette,
} from './kit';
import { armToward, figureStance, standFeet, type Euler, type HandShape, type Rig, type V3 } from '../figure';
import { UNITS_PER_TILE } from '../iso';
import { spellInfo } from './info';
import { armOut, beats, euler, one, track, type Key } from './poses';

/** Fire: a white-yellow heart, orange body, a deep red edge. Garnet and ruby. */
export const PALETTE: SpellPalette = {
  core: '#fff2a8',
  main: '#ff7a1a',
  deep: '#b3300f',
  accent: '#ffd23a',
  ink: '#4a1305',
  light: '#ff8a2a',
};

/* ---- colours the fire is not, but goes with ---------------------------------------- */

/** The focus every Kindler casts out of: a garnet or a ruby, kindled in the hand as a cast begins. */
const GEM = { main: '#e0284a', deep: '#7a0c22', core: '#ffc2cc', ink: '#3a0410' };
/** A coal: black outside, its cracks the fire's own. */
const COAL = { main: '#5a1a0c', deep: '#2a0c06', core: '#ff9a3c', ink: '#1a0603' };
/** The meteor's stone, molten where it has split. */
const ROCK = { main: '#5b4236', deep: '#2b1d17', core: '#ffb347', ink: '#140c08' };
/** Sparks and embers in a gold with red in it: the palette's yellow, added over grass, goes lime. */
const GOLD = '#ff9a38';
const SMOKE = '#2e2420';
const ASH = '#6b5d55';
const STEAM = '#f2ece2';
const STEAM_SHADE = '#cfc6b8';
const SCALD = { main: '#fff1d8', deep: '#e0a060', core: '#ffffff', ink: '#8a6a4a' };
const DIRT = '#7d6a55';
/** The light a big fire throws on the ground round it: a warm white, which the night takes as firelight (a wide light in
 * the fire's own orange washes the grass olive). */
const WARM = '#fff1d6';

/* ---- a tongue of flame ---------------------------------------------------------------- */

/** One tongue, in the screen's pixels: from its base to its tip, `w` half as wide as its base, `heat` nought (coals) to two (white). */
interface Flame { bx: number; by: number; tx: number; ty: number; w: number; heat: number; wob: number }

/** The three tones a tongue is drawn in at each heat: its lit side, its shaded side, its heart. */
const HEATS = [
  { lit: PALETTE.deep, shade: PALETTE.ink, heart: PALETTE.main },
  { lit: PALETTE.main, shade: PALETTE.deep, heart: PALETTE.accent },
  { lit: PALETTE.accent, shade: PALETTE.main, heart: '#ffffff' },
];
/**
 * Fire is light: drawn among the bodies it is darkened by the night like
 * them, so each tongue is drawn again, faintly, in the light pass over the
 * night -- its body and its heart, no ink -- and a flame in the dark still
 * burns as bright as it does by day.
 */
const FLAME_LIGHT = 0.3;
const tonesOf = (heat: number): (typeof HEATS)[number] => HEATS[heat >= 1.5 ? 2 : heat >= 0.7 ? 1 : 0];

/**
 * A tongue's outline into the current path, as a closed subpath: `part`
 * nought its whole body, one the shaded band down its far side, two its
 * heart. A teardrop of straight facets, its base rounded under it and its tip
 * swayed by `wob`, the side facing up and left lit and the other shaded, a
 * hotter heart up the middle toward the light. False when it is too small to
 * draw at all; a tongue of a few pixels is given its body alone.
 */
function traceFlame(g: CanvasRenderingContext2D, f: Flame, part: 0 | 1 | 2): boolean {
  let ax = f.tx - f.bx, ay = f.ty - f.by;
  const L = Math.hypot(ax, ay);
  if (L < 0.6 || f.w < 0.2 || (part > 0 && L < 5)) return false;
  ax /= L;
  ay /= L;
  // Across it, turned so that plus is the side the light is on.
  let px = -ay, py = ax;
  if (-0.6 * px - 0.8 * py < 0) {
    px = -px;
    py = -py;
  }
  const w = f.w, s = f.wob * w;
  const to = (a: number, n: number, first = false): void => {
    const x = f.bx + ax * a * L + px * n, y = f.by + ay * a * L + py * n;
    if (first) g.moveTo(x, y);
    else g.lineTo(x, y);
  };
  if (part === 2) {
    // The heart: a smaller tongue inside, low and toward the lit side, where a flame is hottest.
    to(-0.35 * w / L, w * 0.1, true);
    to(0.02, w * 0.62);
    to(0.26, w * 0.66 + s * 0.25);
    to(0.66, w * 0.14 + s * 0.65);
    to(0.3, -w * 0.28 + s * 0.3);
    to(0.02, -w * 0.36);
    g.closePath();
    return true;
  }
  // Half-widths up the tongue, the belly just over the base and the tip drawn out, swayed more the higher it is.
  to(-0.75 * w / L, 0, true);
  to(-0.02, -w * 0.8);
  to(0.24, -w * 1.08 + s * 0.25);
  to(0.52, -w * 0.74 + s * 0.6);
  to(0.8, -w * 0.34 + s * 0.85);
  to(1, s);
  if (part === 1) {
    // The shaded side: a band down the far edge, back down inside it, so the lit body stays the most of it.
    to(0.8, -w * 0.12 + s * 0.85);
    to(0.5, -w * 0.42 + s * 0.6);
    to(0.2, -w * 0.62 + s * 0.25);
  } else {
    to(0.8, w * 0.34 + s * 0.85);
    to(0.52, w * 0.74 + s * 0.6);
    to(0.24, w * 1.08 + s * 0.25);
    to(-0.02, w * 0.8);
  }
  g.closePath();
  return true;
}

/** One tongue, body, ink, shade and heart, over whatever is under it. */
function drawFlame(g: CanvasRenderingContext2D, f: Flame, inkW: number): void {
  const t = tonesOf(f.heat);
  g.beginPath();
  if (!traceFlame(g, f, 0)) return;
  g.fillStyle = t.lit;
  g.fill();
  g.lineWidth = inkW;
  g.strokeStyle = PALETTE.ink;
  g.stroke();
  g.beginPath();
  if (traceFlame(g, f, 1)) {
    g.fillStyle = t.shade;
    g.fill();
  }
  g.beginPath();
  if (traceFlame(g, f, 2)) {
    g.fillStyle = t.heart;
    g.fill();
  }
}

/**
 * Tongues drawn a tone at a time rather than a tongue at a time: every body
 * of one heat in one fill, their ink in one stroke, then the shades, then the
 * hearts. Three or four calls a heat however many tongues, which is what lets
 * a ring of sixty stand round a Kindler for fifteen seconds; but a tongue's
 * shade is laid over its neighbour's body, so it is only for tongues that
 * stand apart (a ring) -- and for the light pass, where adding is the same in
 * any order. `light` draws bodies and hearts only, no ink, no shade.
 */
function drawFlames(g: CanvasRenderingContext2D, flames: readonly Flame[], inkW: number, light: boolean): void {
  for (let h = 0; h < 3; h++) {
    const t = HEATS[h];
    const mine = (f: Flame): boolean => tonesOf(f.heat) === t;
    let any = false;
    g.beginPath();
    for (const f of flames) if (mine(f) && traceFlame(g, f, 0)) any = true;
    if (!any) continue;
    g.fillStyle = t.lit;
    g.fill();
    if (!light) {
      g.lineWidth = inkW;
      g.strokeStyle = PALETTE.ink;
      g.stroke();
      g.beginPath();
      for (const f of flames) if (mine(f)) traceFlame(g, f, 1);
      g.fillStyle = t.shade;
      g.fill();
    }
    g.beginPath();
    for (const f of flames) if (mine(f)) traceFlame(g, f, 2);
    g.fillStyle = t.heart;
    g.fill();
  }
}

/** How a tongue's height breathes: never still, never in step with its neighbours. */
const flick = (now: number, i: number): number => 0.86 + 0.1 * Math.sin(now * 11 + i * 2.3) + 0.06 * Math.sin(now * 23 + i * 5.1);
/** And how its tip sways. */
const sway = (now: number, i: number): number => 0.35 * Math.sin(now * 7 + i * 1.7) + 0.15 * Math.sin(now * 17 + i * 3.1);

/** A tongue standing up off a point in the world, `h` height units tall and `w` pixels (at zoom one) half-wide at its base. */
function upright(k: FxScene, base: P3, h: number, w: number, heat: number, lean: number, wob: number): Flame {
  const bx = k.sx(base), by = k.sy(base), H = k.hpx(h);
  // Never thinner than a flame is: a quarter as wide as it is tall, however narrow it was asked for.
  return { bx, by, tx: bx + lean * H, ty: by - H, w: Math.max(w * k.zoom, 0.24 * H), heat, wob };
}

/**
 * Tongues drawn together, sorted with whatever stands at `at`: back to front among themselves. `lit` false leaves
 * them out of the light pass, for a caller that lays one light pass over many groups at once (`flameLight`).
 */
function flameGroup(k: FxScene, at: P3, flames: Flame[], alpha = 1, bias = 0, apart = false, lit = true): void {
  if (!flames.length || alpha <= 0.01) return;
  flames.sort((a, b) => a.by - b.by);
  const inkW = Math.max(0.6, 0.42 * k.zoom);
  k.worldDraw(at, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'round';
    if (apart) drawFlames(g, flames, inkW, false);
    else for (const f of flames) drawFlame(g, f, inkW);
  }, bias);
  if (lit) flameLight(k, flames, alpha);
}

/**
 * Tongues again in the light pass, faintly, so they burn as bright in the dark as by day. Not on fast graphics: it is
 * the second copy of every tongue, the first thing to go (as the kit's own shapes drop their glow there).
 */
function flameLight(k: FxScene, flames: readonly Flame[], alpha: number): void {
  if (k.fast || !flames.length) return;
  k.glowDraw((g) => {
    g.globalAlpha = clamp(alpha * FLAME_LIGHT);
    drawFlames(g, flames, 0, true);
  });
}

/** Soft light at several points with one record: the glow along a ring, over a field. Every other point on fast graphics. */
function glowSpots(k: FxScene, pts: readonly P3[], r: number, alpha: number, colour = PALETTE.light): void {
  if (alpha <= 0.01 || !pts.length) return;
  const pic = glowPicture(colour);
  if (!pic) return;
  const R = r * k.zoom;
  const xy: number[][] = [];
  for (let i = 0; i < pts.length; i += k.fast ? 2 : 1) xy.push([k.sx(pts[i]), k.sy(pts[i])]);
  k.glowDraw((g) => {
    g.globalAlpha = clamp(alpha);
    for (const [x, y] of xy) g.drawImage(pic, x - R, y - R, 2 * R, 2 * R);
  });
}

/**
 * A ring of tongues standing on the ground round `c`, `r` tiles out, each
 * standing apart: a crater's lip, a column's foot. Drawn in a few arcs, each
 * sorted where it stands, so a ring round a body passes behind it at the back
 * and in front at the front, with one light pass for all of them. `from` and
 * `span` (radians) draw only part of the ring; `h` is the tallest tongue in
 * height units, `w` the base's half-width in pixels. A wall of fire is
 * `fireWall`, below: tongues this far apart read as candles, not as a wall.
 */
function flameRing(k: FxScene, c: { x: number; y: number }, r: number, o: {
  h: number; w: number; n?: number; heat?: number; alpha?: number; turn?: number; from?: number; span?: number; key?: number; arcs?: number; glow?: number;
  /** Where round the ring (radians) a crest of taller flame stands, running round with it: the ring seen to turn. */
  crest?: number;
  /** Height of the near half against the far, so a ring round a body does not hide it. */
  front?: number;
  /** How far each tongue leans out from the middle, as a share of its height: fire thrown outward. */
  lean?: number;
}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.02 || o.h <= 0.2) return;
  const span = o.span ?? TAU;
  const want = o.n ?? Math.round((span * r) / 0.5);
  const n = Math.max(3, Math.min(k.fast ? 20 : 48, want));
  const arcs = Math.max(1, Math.min(o.arcs ?? 8, n));
  const groups: Flame[][] = [];
  const at: P3[] = [];
  for (let j = 0; j < arcs; j++) {
    groups.push([]);
    const ang = (o.turn ?? 0) + (o.from ?? 0) + span * ((j + 0.5) / arcs);
    at.push(k.on(c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r));
  }
  const key = o.key ?? k.seed;
  const mid = k.on(c.x, c.y), cx = k.sx(mid), cy = k.sy(mid);
  const all: Flame[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (o.turn ?? 0) + (o.from ?? 0) + span * ((i + 0.5) / n);
    const x = c.x + Math.cos(ang) * r, y = c.y + Math.sin(ang) * r;
    const crest = o.crest === undefined ? 1 : 1 + 0.8 * Math.pow(Math.max(0, Math.cos(ang - o.crest)), 6) + 0.8 * Math.pow(Math.max(0, Math.cos(ang - o.crest - Math.PI)), 6);
    const h = o.h * crest * (0.62 + 0.38 * hashOf(key, i)) * flick(k.now, i);
    const heat = (o.heat ?? 1) + (hashOf(key + 1, i) < 0.25 ? 0.6 : 0);
    const base = k.on(x, y, 0.2);
    const near = o.front !== undefined && k.sy(base) > cy;
    const f = upright(k, base, near ? h * (o.front as number) : h, o.w * (0.8 + 0.4 * hashOf(key + 2, i)), heat, 0.12 * Math.sin(k.now * 3 + i), sway(k.now, i));
    if (o.lean) {
      // Out from the middle as the screen has it, by its height.
      const ox = f.bx - cx, oy = (f.by - cy) * 2, ol = Math.hypot(ox, oy) || 1, tall = f.by - f.ty;
      f.tx += (ox / ol) * tall * o.lean;
      f.ty += (oy / ol) * tall * o.lean * 0.5;
    }
    groups[Math.min(arcs - 1, Math.floor((i / n) * arcs))].push(f);
    all.push(f);
  }
  for (let j = 0; j < arcs; j++) flameGroup(k, at[j], groups[j], a, 0, true, false);
  flameLight(k, all, a);
  if ((o.glow ?? 1) > 0) glowSpots(k, at.map((p) => ({ ...p, z: p.z + o.h * 0.4 })), 6 + o.h * 0.9, a * 0.45 * (o.glow ?? 1));
}

/**
 * A wall of fire standing on the ground round `c`, `r` tiles out: one body of
 * flame, not a row of tongues -- its foot one unbroken line along the ground,
 * its top a crown of points that lick up and fall back each on its own beat,
 * each point's far flank in shade and a hotter heart burning low along the
 * inside, inked round. Drawn in `arcs` pieces, each sorted where it stands, so
 * the back of the wall is behind whoever is inside and the front before them;
 * one light pass for all of it. `h` the tallest point in height units; `front`
 * how much of that the near half stands, so whoever is inside shows over it;
 * `lean` how far its top is thrown out from the middle (a blast); `from` and
 * `span` (radians) for part of it; `crest` a run of taller flame going round.
 */
function fireWall(k: FxScene, c: { x: number; y: number }, r: number, o: {
  h: number; heat?: number; alpha?: number; turn?: number; from?: number; span?: number; key?: number; arcs?: number;
  front?: number; lean?: number; crest?: number; glow?: number; spacing?: number; ragged?: number;
}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.05 || o.h <= 0.3) return;
  const span = o.span ?? TAU, from = (o.turn ?? 0) + (o.from ?? 0), whole = span >= TAU - 1e-3;
  // A point every so far round, near enough that the points read as one crown of fire; fewer on fast graphics.
  const step = ((o.spacing ?? 0.17) * (k.fast ? 1.6 : 1)) / clamp(k.zoom / 2, 0.75, 1.5);
  const n = Math.max(6, Math.min(k.fast ? 64 : 140, Math.round((span * r) / step)));
  const arcs = Math.max(1, Math.min(o.arcs ?? (whole ? 8 : 4), Math.floor(n / 3)));
  const key = o.key ?? k.seed;
  const tones = tonesOf(o.heat ?? 1);
  const mid = k.on(c.x, c.y), cx = k.sx(mid), cy = k.sy(mid);
  const ragged = o.ragged ?? 0.38;
  const bx: number[] = [], by: number[] = [], tx: number[] = [], ty: number[] = [], H: number[] = [];
  const count = whole ? n : n + 1;
  for (let i = 0; i < count; i++) {
    const ang = from + span * (i / n);
    const base = k.on(c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r, 0.2);
    const x = k.sx(base), y = k.sy(base);
    const crest = o.crest === undefined ? 1 : 1 + 0.7 * Math.pow(Math.max(0, Math.cos(ang - o.crest)), 8);
    // Each point licks on a beat of its own: up, and falling back, never in step with its neighbours.
    const lick = 0.55 + 0.45 * Math.abs(Math.sin(k.now * (2.2 + 1.4 * hashOf(key + 3, i)) + hashOf(key + 4, i) * 6));
    const near = o.front !== undefined && y > cy ? o.front : 1;
    const h = k.hpx(o.h * crest * near * (1 - ragged + ragged * hashOf(key, i)) * lick);
    let ox = x - cx, oy = (y - cy) * 2;
    const ol = Math.hypot(ox, oy) || 1;
    ox /= ol;
    oy /= ol;
    // Each point swaying on its own, wide enough that neighbours lean apart: even, upright points read as a saw blade.
    const lean = (o.lean ?? 0) * h, sw = h * 0.28 * Math.sin(k.now * 6 + i * 1.9);
    bx.push(x);
    by.push(y);
    tx.push(x + ox * lean + sw);
    ty.push(y - h + oy * lean * 0.5);
    H.push(h);
  }
  const at = (i: number): number => (whole ? ((i % n) + n) % n : clamp(i, 0, n));
  // And each tip pushed a third of the way toward one neighbour or the other, by its own hash: uneven points.
  for (let i = 0; i < count; i++) {
    const q = at(i + 1), p = at(i - 1);
    const lr = hashOf(key + 6, i) < 0.5 ? -1 : 1;
    tx[i] += 0.3 * lr * (lr > 0 ? bx[q] - bx[i] : bx[i] - bx[p]);
  }
  const pieces: Array<{ i0: number; i1: number; p: P3 }> = [];
  for (let j = 0; j < arcs; j++) {
    const i0 = Math.floor((j * n) / arcs), i1 = Math.floor(((j + 1) * n) / arcs);
    const ang = from + span * ((i0 + i1) / 2 / n);
    pieces.push({ i0, i1, p: k.on(c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r) });
  }
  const inkW = Math.max(0.6, 0.45 * k.zoom);
  // One piece's outline: its foot along the ground, then back along the crown, a point at each place and a dip between.
  const body = (g: CanvasRenderingContext2D, i0: number, i1: number, share: number, lift = 0, edge = false): void => {
    const s = 1 - share;
    g.moveTo(bx[at(i0)], by[at(i0)] - lift);
    for (let i = i0 + 1; i <= i1; i++) g.lineTo(bx[at(i)], by[at(i)] - lift);
    for (let i = i1; i >= i0; i--) {
      const q = at(i);
      const x = lerp(tx[q], bx[q], s), y = lerp(ty[q], by[q], s) - lift;
      // For its ink, the foot and the crown only: inked up its ends, the pieces showed their seams.
      if (edge && i === i1) g.moveTo(x, y);
      else g.lineTo(x, y);
      if (i > i0) {
        // The dip between two points, a third of their height: what makes them one wall.
        const p = at(i - 1);
        g.lineTo((bx[q] + bx[p]) / 2, (by[q] + by[p]) / 2 - lift - 0.32 * share * (H[q] + H[p]) / 2);
      }
    }
    if (!edge) g.closePath();
  };
  for (const pc of pieces) {
    k.worldDraw(pc.p, (g) => {
      g.globalAlpha = clamp(a);
      g.lineJoin = 'round';
      g.beginPath();
      body(g, pc.i0, pc.i1, 1);
      g.fillStyle = tones.lit;
      g.fill();
      g.beginPath();
      body(g, pc.i0, pc.i1, 1, 0, true);
      g.lineWidth = inkW;
      g.strokeStyle = PALETTE.ink;
      g.stroke();
      // Each point's far flank in shade: from its tip down to the dip after it.
      g.beginPath();
      for (let i = pc.i0; i < pc.i1; i++) {
        const q = at(i), p = at(i + 1);
        const dx = (bx[q] + bx[p]) / 2, dy = (by[q] + by[p]) / 2 - 0.32 * (H[q] + H[p]) / 2;
        g.moveTo(tx[q], ty[q]);
        g.lineTo(dx, dy);
        g.lineTo(lerp(dx, bx[q], 0.3), lerp(dy, by[q], 0.5));
        g.closePath();
      }
      g.fillStyle = tones.shade;
      g.fill();
      // The heart, low along it and hotter.
      g.beginPath();
      body(g, pc.i0, pc.i1, 0.48, Math.max(0.5, 0.35 * k.zoom));
      g.fillStyle = tones.heart;
      g.fill();
    }, 0);
  }
  if (!k.fast) {
    k.glowDraw((g) => {
      g.globalAlpha = clamp(a * lerp(FLAME_LIGHT, 0.5, seg(k.night, 0.3, 0.7)));
      g.beginPath();
      for (const pc of pieces) body(g, pc.i0, pc.i1, 0.75);
      g.fillStyle = tones.lit;
      g.fill();
    });
  }
  if ((o.glow ?? 1) > 0) glowSpots(k, pieces.map((pc) => ({ ...pc.p, z: pc.p.z + o.h * 0.4 })), 8 + o.h * 1.1, a * 0.4 * (o.glow ?? 1));
}

/**
 * The foot of a wall of fire on the ground: a narrow bed of coals along the
 * ring, unbroken and a little ragged, dark red with an orange heart -- what is
 * burning, rather than a band of paint -- with a rim of light in the dark.
 * `hot` (nought to one) how much of the orange heart is left.
 */
function emberBed(k: FxScene, c: { x: number; y: number }, r: number, alpha: number, o: { from?: number; span?: number; width?: number; hot?: number } = {}): void {
  if (alpha <= 0.01 || r <= 0.05) return;
  const span = o.span ?? TAU, from = o.from ?? 0;
  const n = Math.max(8, Math.round(k.facets(r, 64) * (span / TAU)));
  const run: number[] = [];
  for (let i = 0; i <= n; i++) {
    const ang = from + span * (i / n);
    const rr = r * (1 + 0.03 * (hashOf(k.seed + 5, i % n) - 0.5));
    run.push(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr);
  }
  const w = (o.width ?? 3.2) * k.zoom, hot = o.hot ?? 1;
  // On fast graphics the bed is one stroke, its deep red: three strokes round a six-tile ring are the ground pass's
  // dearest line.
  if (k.fast) {
    k.groundShape(c.x, c.y, r + 0.5, [{ kind: 'stroke', colour: PALETTE.deep, alpha: clamp(alpha), width: w + 0.6 * k.zoom, paths: [run], join: 'round', cap: 'round', lift: 0.14 }]);
    return;
  }
  k.groundShape(c.x, c.y, r + 0.5, [
    { kind: 'stroke', colour: PALETTE.ink, alpha: clamp(alpha * 0.8), width: w + 1.6 * k.zoom, paths: [run], join: 'round', cap: 'round', lift: 0.12 },
    { kind: 'stroke', colour: PALETTE.deep, alpha: clamp(alpha), width: w, paths: [run], join: 'round', cap: 'round', lift: 0.14 },
    { kind: 'stroke', colour: PALETTE.main, alpha: clamp(alpha * hot), width: w * 0.4, paths: [run], join: 'round', cap: 'round', lift: 0.16, glow: 0.4 + 0.6 * k.night },
  ]);
}

/**
 * Cracks in the ground glowing up from under it: `n` jagged lines out from
 * round `c`, at most `r` tiles long, drawn on from the middle as `grow` goes
 * to one. Ground heating before it goes up, not a seal laid on it.
 */
function cracks(k: FxScene, c: { x: number; y: number }, r: number, n: number, grow: number, alpha: number, salt: number): void {
  if (alpha <= 0.01 || grow <= 0.01) return;
  // Each a thin jagged run of five short legs, the last one apart so it can be drawn finer: a crack narrows to its end.
  // Thin and square-ended, as a split in the ground is; thick and round-capped they read as sticks lying on it.
  const runs: number[][] = [], tips: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU + hashOf(k.seed + salt, i) * 0.8;
    const len = r * (0.6 + 0.4 * hashOf(k.seed + salt + 1, i)) * grow;
    const run: number[] = [];
    let ang = a0;
    for (let s = 0; s <= 5; s++) {
      const d = len * (0.12 + 0.88 * (s / 5));
      if (s > 0) ang = a0 + (hashOf(k.seed + salt + 2, i * 7 + s) - 0.5) * 1.1;
      run.push(c.x + Math.cos(ang) * d, c.y + Math.sin(ang) * d);
    }
    tips.push(run.slice(-4));
    runs.push(run.slice(0, -2));
  }
  const z = k.zoom;
  // The fine end in the fire's own colour alone; on fast graphics no white-hot thread down the middle.
  k.groundShape(c.x, c.y, r + 0.5, [
    { kind: 'stroke', colour: PALETTE.ink, alpha: clamp(alpha), width: 1.4 * z, paths: runs, join: 'miter', cap: 'butt', lift: 0.12 },
    { kind: 'stroke', colour: PALETTE.main, alpha: clamp(alpha), width: 0.8 * z, paths: runs, join: 'miter', cap: 'butt', lift: 0.14, glow: 0.6 + 0.4 * k.night },
    { kind: 'stroke', colour: PALETTE.main, alpha: clamp(alpha * 0.85), width: 0.55 * z, paths: tips, join: 'miter', cap: 'butt', lift: 0.14 },
    ...(k.fast ? [] : [{ kind: 'stroke' as const, colour: PALETTE.core, alpha: clamp(alpha * grow), width: 0.35 * z, paths: runs, join: 'miter' as const, cap: 'butt' as const, lift: 0.15 }]),
  ]);
}

/**
 * A fire: a tall tongue with two shorter ones leaning off it, which is how
 * flame stands on anything that is not a wall of it. `h` height units.
 */
function fireCluster(k: FxScene, base: P3, h: number, heat: number, key: number, out: Flame[], most = 2): void {
  const H = k.hpx(h);
  if (H < 1) return;
  const bx = k.sx(base), by = k.sy(base);
  out.push({ bx, by, tx: bx + 0.1 * H * Math.sin(k.now * 4 + key), ty: by - H, w: 0.26 * H, heat: Math.min(most, heat + 0.35), wob: sway(k.now, key) });
  for (const q of [-1, 1]) {
    const hh = H * (0.56 + 0.12 * Math.sin(k.now * 9 + key * 2 + q));
    out.push({ bx: bx + q * 0.2 * H, by: by + 0.05 * H, tx: bx + q * (0.2 * H + 0.22 * hh), ty: by - hh, w: 0.27 * hh, heat, wob: sway(k.now, key + q * 3) });
  }
}

/**
 * Tongues licking over a body while it burns. Each licks up and dies on a
 * cycle of its own and comes back somewhere else on it, so the fire crawls
 * over the body rather than standing on it; `power` (nought to one) is how
 * hard it burns -- the size and the count -- and `life` how much of the burn
 * is left, so it dwindles as its seconds run out. The tongues behind the
 * middle of the body are drawn behind it, the rest in front. Every fire's foot
 * is on the body itself: along a creature's back from its rump to its neck
 * (its own model says how long it is and how high its head is), over a
 * person's shoulders and arms. `lit` false draws it without a light of its
 * own, for a spell that burns many at once on its two lights.
 */
function burnOn(k: FxScene, b: Body, age: number, power: number, life: number, alpha: number, lit = true): void {
  if (alpha <= 0.01) return;
  const patches = power < 0.5 ? 1 : power < 0.9 ? 2 : 3;
  const size = (0.5 + 0.5 * life) * alpha;
  const person = !!b.figure;
  const front: Flame[] = [], back: Flame[] = [];
  const foot = k.on(b.x, b.y);
  const footY = k.sy(foot);
  // A creature's length and its back: how far ahead of its feet its head is, and how high.
  const head = person ? null : k.muzzle(b);
  const reach = head ? Math.hypot(head.x - b.x, head.y - b.y) * UNITS_PER_TILE : 0;
  const crown = head ? head.z - b.z : b.tall;
  for (let i = 0; i < patches; i++) {
    // Two fires to a patch, half a cycle apart, so one is rising as the other dies and the patch is never out.
    for (let half = 0; half < 2; half++) {
      const period = 0.9 + 0.4 * hashOf(k.seed + 11, i);
      const cyc = age / period + hashOf(k.seed + 13, i) + half * 0.5;
      const round = Math.floor(cyc), u = cyc - round;
      const env = Math.sin(Math.PI * u);
      if (env <= 0.08) continue;
      const hk = k.seed + round * 7 + i * 31 + half * 101;
      let base: P3;
      if (person) {
        base = k.local(b, (hashOf(hk, 1) * 2 - 1) * b.wide * 0.6, (hashOf(hk, 2) * 2 - 1) * b.wide * 0.25, b.tall * (0.55 + 0.3 * hashOf(hk, 3)));
      } else if (reach > 1) {
        // Along the back from the rump (about as far behind the feet as the head is ahead) to the neck, rising toward
        // the shoulders.
        const along = -0.75 + 1.25 * hashOf(hk, 2);
        const up = crown * (0.6 + 0.12 * hashOf(hk, 3) + 0.12 * Math.max(0, along));
        base = k.local(b, (hashOf(hk, 1) * 2 - 1) * b.wide * 0.3, along * reach, up);
      } else {
        base = k.local(b, (hashOf(hk, 1) * 2 - 1) * b.wide * 0.35, (hashOf(hk, 2) * 2 - 1) * b.wide * 0.6, b.tall * (0.7 + 0.15 * hashOf(hk, 3)));
      }
      const h = (3 + 5 * power) * size * (0.35 + 0.65 * env) * (0.8 + 0.4 * hashOf(hk, 4));
      // Orange through, its lead tongue never white: white-hot is the blow's, and a burn that starts white washes the
      // creature's head and chest out to a glare.
      fireCluster(k, base, h, 0.7 + 0.7 * life * env, i * 5 + half, k.sy(k.on(base.x, base.y)) > footY ? front : back, 1.45);
    }
  }
  // Unlit -- one of many burning at once -- it is one record: the few tongues behind the body drawn with the rest.
  if (lit) flameGroup(k, foot, back, 1, -3);
  else front.push(...back);
  flameGroup(k, foot, front, 1, 3);
  const heart = k.at(b, 0.62);
  k.glow(heart, 9 + 8 * power, (0.35 + 0.25 * power) * alpha * (0.85 + 0.15 * Math.sin(k.now * 13)));
  if (lit) k.light(b, 1.3 + 1.2 * power, (0.25 + 0.25 * power) * alpha * (0.9 + 0.1 * Math.sin(k.now * 17)));
  k.emit(k.at(b, 0.8), (5 + 9 * power) * alpha, { kind: 'ember', colour: [GOLD, PALETTE.main], size: 1.4, life: [0.4, 0.9], speed: [0.05, 0.25], up: [10, 22], gravity: -4, drag: 0.4, jitter: b.wide / 40, jitterZ: 2 });
  // Smoke off it: small soft dark puffs, not grey tiles over its head.
  k.emit(k.at(b, 0.85), (1.5 + 3 * power) * alpha * life, { kind: 'mist', colour: SMOKE, size: 1.6 + power, sizeEnd: 3.6 + 2 * power, life: [0.8, 1.5], speed: [0.02, 0.1], up: [8, 14], gravity: -4, drag: 0.5, jitter: b.wide / 50 });
}

/** A burn's share of its strength, from its own fraction of health a second: the hottest the Kindler has (Inferno's) is one. */
const burnPower = (each: number | undefined): number => clamp((each ?? 0.01) / 0.03, 0.25, 1);

/** Tiles out from the middle of a body to round its feet, with room: what a ring under it or a patch of ground lit under it is sized by. */
const footOf = (b: Body): number => clamp((b.wide / UNITS_PER_TILE) * 2.6, 0.25, 0.7);

/** How many times as long a Firebrand makes every burn: what a burn's linger has to allow for. */
const BRAND_LONG = spellInfo('kindler_firebrand')?.fx.long ?? 1;
/** Seconds a burn spell's linger is kept for: its own, as long again as a Firebrand can make them. */
const burnSecs = (id: string): number => (spellInfo(id)?.lasts ?? 0) * BRAND_LONG;

/**
 * Who has had a burn drawn on them this frame: two casts that both burn one
 * creature (an Immolate, and the Scorch over it) draw the island's one burn
 * once. Begun again at the first burn of each frame.
 */
const burnt = { now: -1, who: new Set<string>() };
const keyOf = (b: Body): string => (b.who && b.who.kind !== 'player' ? `${b.who.kind}${b.who.id}` : `${b.x.toFixed(2)},${b.y.toFixed(2)}`);

/**
 * How a burn on `b` stands by what the island says of it (`Body.burning`):
 * its share of strength left and how much of it to draw, or null when it is
 * out. Once the creature has been seen burning, its burn goes on until the
 * island says it is out -- a Firebrand's doubled seconds, a Combust's or a
 * poultice's early end -- and dies over a breath then; never seen burning (no
 * word yet, or a person), it burns for its own `secs`. `slot` keeps one
 * body's watch apart from another's in `k.state`.
 */
function burnNow(k: FxScene, b: Body, slot: string, age: number, secs: number): { life: number; alpha: number } | null {
  const st = k.state, seen = `${slot}s`, out = `${slot}o`;
  if (b.burning) {
    st[seen] = 1;
    st[out] = -1;
  }
  const rise = smooth(age / 0.35);
  if (st[seen] === 1) {
    const left = 0.35 + 0.65 * clamp((secs - age) / Math.max(0.01, secs));
    if (b.burning !== false) return { life: left, alpha: rise };
    if ((st[out] ?? -1) < 0) st[out] = age;
    const f = 1 - (age - st[out]) / 0.6;
    return f > 0 ? { life: left * f, alpha: rise * f } : null;
  }
  if (age >= secs) return null;
  return { life: (secs - age) / Math.max(0.01, secs), alpha: rise * smooth((secs - age) / 0.9) };
}

/** Whether `b`'s burn has been drawn already this frame; marks it drawn. */
function burntAlready(k: FxScene, b: Body): boolean {
  if (burnt.now !== k.now) {
    burnt.now = k.now;
    burnt.who.clear();
  }
  const key = keyOf(b);
  if (burnt.who.has(key)) return true;
  burnt.who.add(key);
  return false;
}

/** A burn drawn on `b` as the island has it, once a frame whoever asks. */
function burnWatched(k: FxScene, b: Body, slot: string, age: number, secs: number, power: number, lit = true): void {
  const now = burnNow(k, b, slot, age, secs);
  if (now && !burntAlready(k, b)) burnOn(k, b, age, power, now.life, now.alpha, lit);
}

/** A burn lingering on what it was cast at, at the strength its numbers say, for as long as the island has it burning. */
function burnLinger(k: FxScene, age: number, left: number): void {
  burnWatched(k, k.target, 't', age, k.fx.secs ?? age + left, burnPower(k.fx.each));
}

/** The creatures in `ids` (`k.state[prefix + i]`, `k.state[prefix + 'n']` of them), wherever they have got to, by slot. */
function marked(k: FxScene, prefix: string, c: { x: number; y: number }, r: number): Array<[number, Body]> {
  const n = k.state[`${prefix}n`] ?? 0;
  if (!n) return [];
  const out: Array<[number, Body]> = [];
  for (const b of k.bodiesWithin(r, c, ['creature'])) {
    if (b.who?.kind !== 'creature') continue;
    for (let i = 0; i < n; i++) if (k.state[`${prefix}${i}`] === b.who.id) out.push([i, b]);
  }
  return out;
}

/** Remember the creatures within `r` of `c` now, by their ids, up to `most` of them: who an area spell caught. */
function mark(k: FxScene, prefix: string, c: { x: number; y: number }, r: number, most: number): void {
  let n = 0;
  for (const b of k.bodiesWithin(r, c, ['creature'])) {
    if (b.who?.kind !== 'creature' || n >= most) continue;
    k.state[`${prefix}${n++}`] = b.who.id;
  }
  k.state[`${prefix}n`] = n;
}

/** Share of a wave's way out (`r = from + (to - from) * easeOut(u)`) at which it reaches `d`. */
const reachedAt = (d: number, from: number, to: number): number => 1 - Math.cbrt(1 - clamp((d - from) / Math.max(0.01, to - from)));

/** A creature caught in the fire of an area: a few tongues up it for a moment, the heat of the blow. */
function alight(k: FxScene, b: Body, h: number, heat: number, alpha: number, key: number): void {
  if (alpha <= 0.01 || h <= 0.3) return;
  const fl: Flame[] = [];
  fireCluster(k, k.at(b, 0.5), h, heat, key, fl);
  flameGroup(k, k.on(b.x, b.y), fl, alpha, 3);
  k.glow(k.heart(b), 6 + h, 0.5 * alpha);
}

/**
 * Short tongues standing off a body all round it, between a third and two
 * thirds of its height, `h` height units long, leaning `lean` of their length
 * out from it (in, when negative): a Combust's fire drawn into a creature and
 * thrown out of it. The ones behind it drawn behind it and the rest before.
 */
function popTongues(k: FxScene, b: Body, h: number, lean: number, heat: number, alpha: number): void {
  if (h <= 0.3 || alpha <= 0.01) return;
  const front: Flame[] = [], back: Flame[] = [];
  const foot = k.on(b.x, b.y), fy = k.sy(foot), mid = k.at(b, 0.5), mx = k.sx(mid), my = k.sy(mid);
  const n = k.fast ? 6 : 8;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU + k.seed;
    const base = k.local(b, Math.cos(ang) * b.wide * 0.45, Math.sin(ang) * b.wide * 0.6, b.tall * (0.3 + 0.4 * hashOf(k.seed + 121, i)));
    const f = upright(k, base, h * (0.7 + 0.5 * hashOf(k.seed + 123, i)) * flick(k.now, i), 1.2, heat, 0, sway(k.now, i));
    const ox = f.bx - mx, oy = f.by - my, ol = Math.hypot(ox, oy) || 1, len = f.by - f.ty;
    f.tx += (ox / ol) * len * lean;
    f.ty += (oy / ol) * len * lean * 0.6;
    (k.sy(k.on(base.x, base.y)) > fy ? front : back).push(f);
  }
  flameGroup(k, foot, back, alpha, -3);
  flameGroup(k, foot, front, alpha, 3);
}

/**
 * A ball of fire on its way: tongues streaming back from it along where it
 * has been, a hot gem at its head. `r` pixels at zoom one; `tail` how many of
 * its own widths the tongues stream; a rock rather than fire for a meteor.
 */
function fireball(k: FxScene, head: P3, prev: P3, r: number, tail: number, rock = false): void {
  const hx = k.sx(head), hy = k.sy(head);
  let dx = k.sx(prev) - hx, dy = k.sy(prev) - hy;
  const l = Math.hypot(dx, dy);
  if (l < 0.01) {
    dx = 0;
    dy = 1;
  } else {
    dx /= l;
    dy /= l;
  }
  const R = r * k.zoom;
  const flames: Flame[] = [];
  const spread = [0, 0.32, -0.3, 0.6, -0.55];
  for (let i = 0; i < (k.fast ? 3 : 5); i++) {
    const a = spread[i] + 0.12 * Math.sin(k.now * 19 + i * 2.1);
    const c = Math.cos(a), s = Math.sin(a);
    const vx = dx * c - dy * s, vy = dx * s + dy * c;
    const len = R * tail * (i === 0 ? 1 : i < 3 ? 0.72 : 0.45) * flick(k.now, i);
    flames.push({ bx: hx - vx * R * 0.3, by: hy - vy * R * 0.3, tx: hx + vx * len, ty: hy + vy * len, w: R * (i === 0 ? 0.95 : 0.6), heat: i === 0 ? 1.6 : 1, wob: sway(k.now, i) });
  }
  // The outer tongues first, so the long one down the middle lies over them.
  flames.reverse();
  const inkW = Math.max(0.7, 0.55 * k.zoom);
  k.worldDraw(head, (g) => {
    g.lineJoin = 'round';
    for (const f of flames) drawFlame(g, f, inkW);
  }, 1);
  flameLight(k, flames, 1);
  k.orb(head, r, { ...(rock ? ROCK : { main: PALETTE.accent, deep: PALETTE.main, core: '#ffffff' }), turn: k.now * 6, bias: 2, glow: rock ? 0.5 : 1 });
}

/** The focus kindling: a garnet's glint in the hand as the working starts, gone as the fire takes over. */
function kindle(k: FxScene, at: P3, u: number, size = 1.8): void {
  const a = bump(u, 0, 0.35, 1);
  if (a <= 0.01) return;
  k.orb(at, size * (0.6 + 0.4 * a), { ...GEM, alpha: a, turn: k.now * 5, glow: 0.8, light: GEM.main, bias: 1 });
  k.flare(at, size * 3.5 * a, a * 0.8, GEM.core, k.now * 2);
}

/**
 * The creature a Heat Seeker goes to, as far as this end can tell. The island
 * picks the one within its reach with the least of its health left, the nearer
 * of two alike, and does not say which; a creature's health is not here, so
 * this takes the nearest within the reach -- the island's own choice whenever
 * one creature is in reach or all are as hurt as each other. Chosen once and
 * followed by its id; null when nothing is in reach.
 */
function quarryOf(k: FxScene): Body | null {
  const R = k.fx.reach ?? 10;
  if (k.state.q === undefined) {
    let best: Body | null = null, bd = Infinity;
    for (const b of k.bodiesWithin(R, k.caster, ['creature'])) {
      const d = Math.hypot(b.x - k.caster.x, b.y - k.caster.y);
      if (b.who?.kind === 'creature' && d < bd) {
        best = b;
        bd = d;
      }
    }
    k.state.q = best?.who?.kind === 'creature' ? best.who.id : -1;
    return best;
  }
  if (k.state.q < 0) return null;
  for (const b of k.bodiesWithin(R * 1.6, k.caster, ['creature'])) if (b.who?.kind === 'creature' && b.who.id === k.state.q) return b;
  return null;
}

/**
 * The creature a Heat Seeker has found, picked out `found` (nought to one) of the way: a ring of small tongues
 * licking up round its feet, closing in on it, and its heart lit. It comes and goes by its height, never by fading,
 * so it never washes olive over the grass.
 */
function quarryMark(k: FxScene, q: Body, found: number): void {
  if (found <= 0.01) return;
  flameRing(k, q, footOf(q) * (1.4 - 0.4 * found), { h: 3 * found, w: 1.2, n: 8, front: 0.5, heat: 1.2, arcs: 2, turn: k.now * 0.6, glow: 0.6 });
  k.glow(k.heart(q), 7, 0.5 * found, PALETTE.accent, true);
}

/** A star of tongues bursting out of a point, `n` of them, `len` pixels long at zoom one: a detonation. */
function starburst(k: FxScene, at: P3, n: number, len: number, w: number, heat: number, alpha: number, turn = 0): void {
  const x = k.sx(at), y = k.sy(at), flames: Flame[] = [];
  for (let i = 0; i < n; i++) {
    const a = turn + (i / n) * TAU + 0.3 * (hashOf(k.seed + 17, i) - 0.5);
    // Flattened, as everything round a point on the island is seen from above it.
    const c = Math.cos(a), s = Math.sin(a) * 0.72 - 0.25;
    const L = len * k.zoom * (0.7 + 0.45 * hashOf(k.seed + 19, i)) * flick(k.now, i);
    flames.push({ bx: x + c * w * k.zoom * 0.4, by: y + s * w * k.zoom * 0.4, tx: x + c * L, ty: y + s * L, w: w * k.zoom, heat, wob: sway(k.now, i) });
  }
  const inkW = Math.max(0.7, 0.55 * k.zoom);
  k.worldDraw(at, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'round';
    for (const f of flames) drawFlame(g, f, inkW);
  }, 4);
  flameLight(k, flames, alpha);
}

/** Embers drawn in from a ring toward a point, along the ground: heat gathered. `perSecond` from each of `n` places. */
function drawIn(k: FxScene, c: P3, r: number, n: number, perSecond: number, turn: number, life = 0.45, z = 4): void {
  for (let i = 0; i < n; i++) {
    const a = turn + (i / n) * TAU;
    const from = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, z: c.z + z };
    const sp = r / life;
    k.emit(from, perSecond, { kind: 'ember', colour: [GOLD, PALETTE.main], size: 1.5, life: [life * 0.85, life], speed: [sp * 0.9, sp], heading: { x: -Math.cos(a) + 0.35 * -Math.sin(a), y: -Math.sin(a) + 0.35 * Math.cos(a) }, cone: 0.15, up: [-z / life, -z / life + 4], gravity: 0, drag: 1, jitter: 0.05, jitterZ: 1 });
  }
}

/** A tongue of flame at a hand, fed from the palm: what most of the casts hold before they let go. */
function handFlame(k: FxScene, at: P3, h: number, w: number, heat: number, alpha = 1): void {
  if (h <= 0.3 || alpha <= 0.01) return;
  flameGroup(k, at, [upright(k, at, h, w, heat, 0.1 * Math.sin(k.now * 6), sway(k.now, 3))], alpha, 1);
  k.glow({ ...at, z: at.z + h * 0.4 }, 4 + h * 0.9, 0.55 * alpha);
}

/** Points in a disc, the same every frame of a cast: where the field's fires stand. */
function inDisc(k: FxScene, c: { x: number; y: number }, r: number, i: number, salt: number): { x: number; y: number } {
  const a = hashOf(k.seed + salt, i) * TAU;
  const d = r * Math.sqrt(0.04 + 0.96 * hashOf(k.seed + salt + 1, i));
  return { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
}

/* ---- the casts on the body ------------------------------------------------------------- */

/** Every Kindler pose works with the hands, so none of them hangs loose while it is cast. */
const cast = (pose: CastPose): CastPose => (r, t, c) => {
  r.loose = [false, false];
  pose(r, t, c);
};
/**
 * A cast that wants both hands clasped, or a finger for writing in the air: whatever is held is put away for it
 * (`Rig.stow`), so a sword does not swing up with clasped fists or spin with a writing finger.
 */
const free = (pose: CastPose): CastPose => cast((r, t, c) => {
  r.stow = 1;
  pose(r, t, c);
});

/** A hand's shape keyed over the cast: each of its shares eased from one key to the next, nought where a key leaves it out. */
function shapeAt(t: number, keys: ReadonlyArray<readonly [number, HandShape]>): HandShape {
  const out: HandShape = {};
  for (const name of ['claw', 'cup', 'flat', 'point', 'two'] as const) {
    const v = one(t, keys.map(([at, h]) => [at, h[name] ?? 0] as const));
    if (v > 0.001) out[name] = v;
  }
  return out;
}

/**
 * Both feet put down where a pose wants them, keyed over the cast: each key's numbers are the left foot's
 * right, ahead and lift, the right foot's the same, the hips carried right and ahead, the weight `on` (minus
 * one the left, one the right) and how bent the leg taking it is -- units off where each foot stands. The
 * legs are solved to the feet, so a foot planted stays planted while the hips go over it: weight shifted, not
 * a leg swung. Not on the move: there the walk keeps its own legs.
 */
function feet(r: Rig, t: number, c: PoseCue, keys: readonly Key[]): void {
  if (c.moving) return;
  const v = track(t, keys);
  const s = figureStance(c.look);
  r.at = [r.at[0] + v[6], r.at[1] + v[7], r.at[2]];
  standFeet(r, [[s[0][0] + v[0], s[0][1] + v[1], s[0][2] + v[2]], [s[1][0] + v[3], s[1][1] + v[4], s[1][2] + v[5]]], { on: v[8], bend: v[9], look: c.look });
}
/** Feet where they stand, the weight on both, the knees soft: what a key of `feet` goes back to. */
const STAND = [0, 0, 0, 0, 0, 0, 0, 0, 0, 6] as const;

/**
 * Scorch: drawn from the hip. The right hand low by the hip, forearm forward and the wrist cocked back with the
 * flame on the fingers, the trunk turned away; snapped straight out at the creature, two fingers flicking it off,
 * with a short step onto the left foot.
 */
const scorchPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const cock = b.top * 0.6;
  r.arm[1] = euler(t, [[0, [20, 10, 0]], [cock, [-6, 16, -6]], [b.top, [-14, 18, -8]], [b.let, [80, 2, -4]], [b.through, [74, 4, -6]], [1, [22, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [cock, 96], [b.top, 104], [b.let, 2], [b.through, 10], [1, 28]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [cock, [46, 0, 0]], [b.top, [56, 0, 0]], [b.let, [-10, 0, 0]], [b.through, [-34, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > b.let - 0.03 && t < 0.9;
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [b.top, [26, 14, 0]], [b.let, [-14, 18, 0]], [b.through, [-10, 16, 0]], [1, [16, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [b.top, 40], [b.let, 24], [1, 28]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [2, 0, -24]], [b.let, [-4, 0, 8]], [b.through, [-2, 0, 10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [4, 0, -6]], [b.let, [-8, 0, 4]], [b.through, [-6, 0, 4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 20]], [b.let, [-4, 0, -6]], [1, [0, 0, 0]]]);
  feet(r, t, c, [[0, STAND], [b.top, [0, 0, 0, 0, -1, 0, 0.5, -1.2, 0.6, 10]], [lerp(b.top, b.let, 0.5), [0, 2.5, 1.2, 0, -1, 0, 0.2, 0, 0.6, 10]],
    [b.let, [0, 4.5, 0, 0, -1, 0, -0.4, 1.6, -0.6, 14]], [b.through, [0, 4.5, 0, 0, -1, 0, -0.4, 1.4, -0.5, 12]], [0.94, STAND]]);
  // The flame held in a loose bowl of the fingers at the hip, flicked off two fingers at the snap.
  r.shape = [undefined, shapeAt(t, [[0, {}], [cock, { cup: 0.8 }], [b.let - 0.04, { cup: 0.5 }], [b.let, { two: 1 }], [b.through, { two: 0.8 }], [1, {}]])];
});

/**
 * Ember: a coal pinched out of the left fist, then the right arm swung straight down and well back, the knees
 * dipping, and lobbed underhand -- let go at chest height, palm up, the arm following through no higher than the
 * shoulder.
 */
const emberPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const pinch = b.top * 0.38;
  // The pinch at the chest, not the face.
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [pinch, [44, 4, 24]], [b.top, [40, 4, 20]], [b.let, [26, 14, 8]], [1, [16, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [pinch, 96], [b.top, 90], [b.let, 60], [1, 28]]);
  r.arm[1] = euler(t, [[0, [20, 10, 0]], [pinch, [46, -10, 30]], [b.top, [-55, 20, 0]], [b.let, [60, 6, 0]], [b.through, [92, 6, 0]], [1, [24, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [pinch, 100], [b.top, 10], [b.let, 14], [b.through, 20], [1, 28]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [-30, 0, 0]], [b.let, [24, 0, 0]], [b.through, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > b.let - 0.02 && t < 0.9;
  r.chest = euler(t, [[0, [0, 0, 0]], [pinch, [-4, 0, 0]], [b.top, [-8, 0, -18]], [b.let, [4, 0, 8]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-12, 0, -4]], [b.let, [2, 0, 4]], [b.through, [4, 0, 2]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [pinch, [-16, 0, 0]], [b.top, [-6, 0, 16]], [b.let, [4, 0, -4]], [b.through, [8, 0, 0]], [1, [0, 0, 0]]]);
  // The knees dip with the back-swing and the body rises onto the left foot with the lob.
  feet(r, t, c, [[0, STAND], [pinch, [0, 0, 0, 0, 0, 0, 0, 0, 0, 8]], [b.top, [0, 2, 0, 0, -1, 0, 0.3, -1, 0.4, 26]], [b.let, [0, 3, 0, 0, -1, 0, 0, 1.4, -0.5, 8]],
    [b.through, [0, 3, 0, 0, -1, 0, 0, 1.6, -0.6, 6]], [0.94, STAND]]);
  // The coal pinched out between two fingers; the hand that lobs it opens flat under it as it goes.
  r.shape = [undefined, shapeAt(t, [[0, {}], [pinch, { two: 0.6, claw: 0.3 }], [b.top, { two: 0.6, claw: 0.3 }], [b.let, { flat: 1 }], [b.through, { flat: 0.8 }], [1, {}]])];
});

/**
 * Flash Fire: crouched with both hands drawn back to the hips, then shoved out low and straight, the wrists bent
 * back and the fingers up, palms at the creature; and the body kicked back by it, a step back onto the right foot.
 */
const flashFirePose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [b.top * 0.5, [6, 12, 10]], [b.top, [-10, 12, 14]], [b.let, [58, -6, 4]], [b.through, [64, -4, 4]], [1, [20, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 30], [b.top * 0.5, 70], [b.top, 98], [b.let, 4], [b.through, 18], [1, 28]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [b.top, [20, 0, 0]], [b.let, [62, 0, 0]], [b.through, [50, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.05 && t < 0.92;
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-14, 0, 0]], [b.let, [-6, 0, 0]], [b.through, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 0]], [b.let, [-4, 0, 0]], [b.through, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 0]], [b.let, [-2, 0, 0]], [b.through, [10, 0, 0]], [1, [0, 0, 0]]]);
  feet(r, t, c, [[0, STAND], [b.top, [0, 1, 0, 0, 0, 0, 0, -0.5, 0, 26]], [b.let, [0, 3, 0, 0, 0, 0, 0, 1.6, -0.3, 16]],
    [b.through, [0, 3, 0, 0, -3.5, 0, 0, -1.8, 0.7, 14]], [0.95, STAND]]);
  // Palms hooked round the heat at the hips, then shoved out flat, fingers spread a little with the force of it.
  const hands = shapeAt(t, [[0, {}], [b.top * 0.5, { cup: 0.7 }], [b.top, { cup: 0.7 }], [b.let, { flat: 0.8, claw: 0.2 }], [b.through, { flat: 0.8 }], [1, {}]]);
  r.shape = [hands, hands];
});

/**
 * Scald: the right hand down at the left hip, palm up, holding the scald back as the body twists away to the left
 * over a bent left knee; then swept out level at hip height across the front, as a pan's worth is thrown out, the
 * weight going over onto the right foot and the left arm out for balance.
 */
const scaldPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const wide = armOut(0, 40, 60);
  r.arm[1] = euler(t, [[0, [20, 10, 0]], [b.top, [30, -42, 30]], [b.let, [52, -4, 0]], [b.through, [54, 50, -10]], [1, [22, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [b.top, 62], [b.let, 8], [b.through, 10], [1, 28]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [10, 0, -70]], [b.let, [-6, 0, -40]], [b.through, [-14, 0, -10]], [1, [0, 0, 0]]]);
  r.open[1] = t > 0.06 && t < 0.92;
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [b.top, wide], [b.let, wide], [b.through, [26, 30, 0]], [1, [16, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [b.top, 24], [b.let, 20], [1, 28]]);
  r.open[0] = t > 0.1 && t < 0.85;
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 30]], [b.let, [-2, 0, 4]], [b.through, [0, 0, -24]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-12, 0, 12]], [b.let, [-6, 0, 2]], [b.through, [-2, 0, -8]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-4, 0, -24]], [b.let, [-2, 0, 0]], [b.through, [0, 0, 16]], [1, [0, 0, 0]]]);
  feet(r, t, c, [[0, STAND], [b.top, [0, 2.5, 0, 0, 0, 0, -1.2, 0.6, -0.8, 28]], [b.let, [0, 2.5, 0, 0, 0, 0, 0, 0.8, 0, 14]],
    [b.through, [0, 2.5, 0, 0, 0, 0, 1.2, 0.4, 0.7, 10]], [0.94, STAND]]);
  // The right hand a bowl that holds the scald back at the hip, flat as it flings it; the left flat out for balance.
  r.shape = [shapeAt(t, [[0, {}], [b.top, { flat: 0.7 }], [b.through, { flat: 0.7 }], [1, {}]]),
    shapeAt(t, [[0, {}], [b.top * 0.5, { cup: 1 }], [b.top, { cup: 1 }], [b.let, { flat: 1 }], [b.through, { flat: 0.7 }], [1, {}]])];
});

/**
 * Immolate: the left arm points it out; the right hand, low at the right hip and palm up, crouched, lifts the fire
 * up out of the ground under it to the height of the shoulder as the body straightens, and closes on it.
 */
const immolatePose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [b.top * 0.4, [84, 6, -4]], [b.through, [82, 6, -4]], [1, [18, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [b.top * 0.4, 6], [b.through, 10], [1, 28]]);
  // The right hand lifts out to the side, away from the pointing arm, then closes up toward the shoulder: from the
  // side two arms held straight out together were a sleepwalker's.
  const lifted = armOut(1, 85, 70, [0, 0, 1]), closed = armOut(1, 85, 78, [0, 0, 1]);
  r.arm[1] = euler(t, [[0, [20, 10, 0]], [b.top * 0.35, [30, 30, -20]], [b.top, [34, 30, -18]], [b.let, lifted], [b.through, closed], [1, [22, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [b.top * 0.35, 40], [b.top, 44], [b.let, 40], [b.through, 96], [1, 28]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top * 0.35, [0, 0, -80]], [b.top, [10, 0, -70]], [b.let, [-20, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > 0.06 && t < b.let - 0.02;
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top * 0.4, [0, 0, -8]], [b.top, [-4, 0, -12]], [b.let, [4, 0, -4]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-10, 0, 0]], [b.let, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top * 0.4, [-6, 0, 6]], [b.top, [-4, 0, 6]], [b.let, [-6, 0, 4]], [1, [0, 0, 0]]]);
  feet(r, t, c, [[0, STAND], [b.top * 0.4, [0, 2, 0, 0, 0, 0, 0, 0, -0.2, 22]], [b.top, [0, 2, 0, 0, 0, 0, 0, 0.2, -0.2, 30]],
    [b.let, [0, 2, 0, 0, 0, 0, 0, 1, -0.3, 6]], [b.through, [0, 2, 0, 0, 0, 0, 0, 0.8, -0.2, 6]], [0.95, STAND]]);
  // The left forefinger names it; the right palm, up, lifts the fire out of the ground and clutches it at the let.
  r.shape = [shapeAt(t, [[0, {}], [b.top * 0.4, { point: 1 }], [b.through, { point: 1 }], [1, {}]]),
    shapeAt(t, [[0, {}], [b.top * 0.35, { flat: 1 }], [b.top, { flat: 0.6, claw: 0.4 }], [b.let, { claw: 1 }], [b.through, { claw: 0.4 }], [1, {}]])];
});

/** Combust: the right hand reaches out, clawed, and holds the burn in it; then the fist closes and is yanked back, the body jerking with it. */
const combustPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  // A tremor in the reaching hand as it takes hold, the moment before the yank.
  const strain = bump(t, b.top * 0.6, b.top, b.let) * Math.sin(t * 160);
  r.arm[1] = euler(t, [[0, [20, 10, 0]], [b.top * 0.6, [96, 4, 0]], [b.top, [98, 4, 0]], [b.let, [74, 8, 0]], [b.through, [42, 14, 4]], [1, [22, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [b.top * 0.6, 10], [b.top, 18], [b.let, 74], [b.through, 128], [1, 28]]) + 4 * strain;
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top * 0.6, [-30, 0, 0]], [b.top, [-40, 0, 0]], [b.let, [0, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > 0.08 && t < b.let - 0.04;
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [b.top, [-14, 20, 0]], [b.let, [-6, 18, 0]], [b.through, [24, 30, 0]], [1, [16, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [b.top, 30], [b.through, 50], [1, 28]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-12, 0, 0]], [b.let, [2, 0, 0]], [b.through, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-4, 0, 10]], [b.let, [2, 0, -6]], [b.through, [6, 0, -14]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, -6]], [b.let, [0, 0, 4]], [b.through, [4, 0, 8]], [1, [0, 0, 0]]]);
  // Leaning in on the left foot to take hold, and the weight thrown back onto the right with the yank.
  feet(r, t, c, [[0, STAND], [b.top, [0, 3.5, 0, 0, -0.5, 0, 0, 1.6, -0.6, 18]], [b.let, [0, 3.5, 0, 0, -0.5, 0, 0, 0.4, 0, 10]],
    [b.through, [0, 3.5, 0, 0, -0.5, 0, 0, -1.2, 0.6, 14]], [0.95, STAND]]);
  // Clawed as it takes hold of the burn, shut hard on the yank; teeth bared with it.
  r.shape = [undefined, shapeAt(t, [[0, {}], [b.top * 0.6, { claw: 1 }], [b.top, { claw: 1 }], [b.let, {}], [1, {}]])];
  r.mouth = one(t, [[0, 0], [b.top, 0.15], [b.let, 0.45], [b.through, 0.2], [1, 0]]);
});

/**
 * Inferno Bolt: the fire gathered between both hands low at the right hip, the body wound right round it and the
 * weight sunk on the back leg; then driven out at the waist in a deep lunge onto the left, both palms behind it.
 */
const infernoPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const gather = b.top * 0.4;
  const shake = bump(t, b.top * 0.5, b.top, b.let) * Math.sin(t * 140) * 2;
  r.arm[1] = euler(t, [[0, [20, 10, 0]], [gather, [10, 26, -4]], [b.top, [-6, 30, -10]], [b.let, [70, -6, 6]], [b.through, [68, -4, 6]], [1, [22, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [gather, 92], [b.top, 98], [b.let, 4], [b.through, 10], [1, 28]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [gather, [40, -36, 44]], [b.top, [32, -40, 48]], [b.let, [70, -8, 6]], [b.through, [68, -6, 6]], [1, [18, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [gather, 80], [b.top, 86], [b.let, 4], [b.through, 10], [1, 28]]);
  for (let k = 0; k < 2; k++) {
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [b.top, [0, 0, k ? 40 : -40]], [b.let, [-40, 0, 0]], [b.through, [-36, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.08 && t < 0.92;
  }
  r.chest = euler(t, [[0, [0, 0, 0]], [gather, [2, 0, -34]], [b.top, [4 + shake, 0, -50]], [b.let, [-6, 0, 8]], [b.through, [-4, 0, 6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, -12]], [b.let, [-18, 0, 4]], [b.through, [-16, 0, 2]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [gather, [-8, 0, 28]], [b.top, [-6, 0, 40]], [b.let, [-2, 0, -6]], [1, [0, 0, 0]]]);
  feet(r, t, c, [[0, STAND], [gather, [0, 1, 0, 0, -1.5, 0, 0.6, -1.4, 0.6, 14]], [b.top, [0, 1, 0, 0, -1.5, 0, 0.8, -2.4, 0.8, 20]],
    [lerp(b.top, b.let, 0.55), [0, 5, 1.6, 0, -1.5, 0, 0.3, 0, 0.6, 16]],
    [b.let, [0, 6.5, 0, 0, -2, 0, -0.3, 2.6, -0.8, 36]], [b.through, [0, 6.5, 0, 0, -2, 0, -0.3, 2.5, -0.75, 34]], [0.8, [0, 6.5, 0, 0, -2, 0, 0, 1.6, -0.3, 16]], [0.97, STAND]]);
  // Clawed round the ball at the hip, flat behind it in the thrust, a grunt with it.
  const hands = shapeAt(t, [[0, {}], [gather, { claw: 0.7, cup: 0.3 }], [b.top, { claw: 0.8, cup: 0.2 }], [b.let, { flat: 1 }], [b.through, { flat: 0.8 }], [1, {}]]);
  r.shape = [hands, hands];
  r.mouth = one(t, [[0, 0], [b.top, 0.1], [b.let, 0.6], [b.through, 0.3], [1, 0]]);
});

/**
 * Meteor: both arms flung up to the right, to the star kindling over that shoulder (`skyOf`), leaning after it,
 * fingers straining; then hauled down hard across the body to the left hip, fists closed, into a crouch as it falls.
 */
const meteorPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const reach = b.top * 0.55;
  const hold = Math.min(0.9, b.through + 0.2);
  const strain = bump(t, reach, b.top, b.let) * Math.sin(t * 120);
  // Up and back over the right shoulder, the body arched after it: from the side a reach behind the head, where
  // Pyre's fists are cocked together and Firestorm's arms are thrown up and forward.
  const up: [Euler, Euler] = [armToward(0, [0.3, -0.2, 0.93]), armToward(1, [0.62, -0.35, 0.7])];
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [reach * 0.5, k ? [70, 30, 0] : [70, -10, 20]], [reach, up[k]], [b.top, up[k]], [b.let, k ? [40, -30, 30] : [30, -10, 34]], [hold, k ? [36, -28, 30] : [26, -8, 30]], [1, [18, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 30], [reach, 12], [b.top, 6], [b.let, k ? 50 : 70], [hold, k ? 56 : 76], [1, 28]]) + 3 * strain;
    r.open[k] = t > 0.06 && t < b.let - 0.03;
    r.shrug[k] = one(t, [[0, 0], [reach, k ? 0.6 : 0.4], [b.top, k ? 0.7 : 0.5], [b.let, 0], [1, 0]]);
  }
  // Leaning up and over to the right after the star, then the trunk wrenched down and round to the left.
  r.spine = euler(t, [[0, [0, 0, 0]], [reach, [12, 10, -8]], [b.top, [14, 12, -10]], [b.let, [-20, -4, 14]], [hold, [-16, -2, 10]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [8, 6, -12]], [b.let, [-10, 0, 18]], [hold, [-8, 0, 14]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [reach, [26, 0, -20]], [b.top, [30, 0, -24]], [b.let, [-6, 0, -20]], [hold, [-2, 0, -16]], [1, [0, 0, 0]]]);
  feet(r, t, c, [[0, STAND], [reach, [0, 0, 0, 0.5, 0, 0, 1, 0, 0.7, 4]], [b.top, [0, 0, 0, 0.5, 0, 0, 1.2, 0, 0.8, 2]],
    [b.let, [-0.5, 3, 0, 0.5, -1, 0, -1, 1.2, -0.5, 44]], [hold, [-0.5, 3, 0, 0.5, -1, 0, -0.8, 1, -0.4, 40]], [0.97, STAND]]);
  // Fingers spread to the sky, straining for it; fists as it is hauled down, and a shout with it.
  const hands = shapeAt(t, [[0, {}], [reach, { claw: 0.5, flat: 0.5 }], [b.top, { claw: 0.8, flat: 0.2 }], [b.let, {}], [1, {}]]);
  r.shape = [hands, hands];
  r.mouth = one(t, [[0, 0], [b.top, 0.2], [b.let, 0.9], [hold, 0.4], [1, 0]]);
});

/**
 * Heat Seeker: the flame cupped in the left palm low before the belly, the right hand circling wide over it and
 * the head turning to search; then the right arm flung up and over the shoulder to send it.
 */
const heatSeekerPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const cup = b.top * 0.3;
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [cup, [30, -4, 20]], [b.let, [34, -4, 18]], [b.through, [26, 6, 10]], [1, [16, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [cup, 80], [b.let, 76], [b.through, 60], [1, 28]]);
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [cup, [0, 0, -80]], [b.let, [0, 0, -80]], [1, [0, 0, 0]]]);
  r.open[0] = t > 0.05 && t < 0.92;
  // The right hand stirs over the left: two and a half turns, wide, the forearm down and the elbow up and out.
  const stir = bump(t, cup, cup + 0.08, b.top), ph = t * TAU * 5;
  const send = armOut(1, 150, 14);
  const base = track1(t, [[0, [20, 10, 0]], [cup, [44, 18, 14]], [b.top, [46, 18, 12]], [b.let, send], [b.through, send], [1, [24, 10, 0]]]);
  r.arm[1] = [base[0] + 20 * stir * Math.sin(ph), base[1] + 20 * stir * Math.cos(ph), base[2]];
  r.elbow[1] = one(t, [[0, 30], [cup, 70], [b.top, 66], [b.let, 10], [b.through, 14], [1, 28]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [cup, [-30, 0, 0]], [b.top, [-30, 0, 0]], [b.let, [0, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > 0.05 && t < 0.92;
  // The head searches, left and right, then follows it up.
  const look = bump(t, cup, (cup + b.top) / 2, b.top) * Math.sin((seg(t, cup, b.top) - 0.5) * Math.PI) * 38;
  r.head = euler(t, [[0, [0, 0, 0]], [cup, [-10, 0, 0]], [b.top, [-2, 0, 0]], [b.let, [24, 0, 0]], [b.through, [20, 0, 0]], [1, [0, 0, 0]]]);
  r.head[2] += look;
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-2, 0, 0]], [b.let, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.chest[2] += look * 0.35;
  r.spine = euler(t, [[0, [0, 0, 0]], [b.let, [4, 0, 0]], [1, [0, 0, 0]]]);
  feet(r, t, c, [[0, STAND], [b.top, [0, 0, 0, 0, 0, 0, 0, 0, 0, 8]], [b.let, [0, 0, 1.2, 0, 0, 0, 0.6, 0, 0.8, 4]], [b.through, [0, 0, 0, 0, 0, 0, 0.3, 0, 0.3, 4]], [0.95, STAND]]);
  // The left palm cupped under the wisp; the right forefinger stirs it, and the hand opens flat to send it.
  r.shape = [shapeAt(t, [[0, {}], [cup, { cup: 1 }], [b.let, { cup: 1 }], [b.through, { cup: 0.4 }], [1, {}]]),
    shapeAt(t, [[0, {}], [cup, { point: 1 }], [b.top, { point: 1 }], [b.let, { flat: 1 }], [b.through, { flat: 0.6 }], [1, {}]])];
});

/** When a Stoke's cupped hands come up to the mouth for its two breaths, as a share of the cast; they go at the release. */
const STOKE_UP = 0.36;
const STOKE_LET = 0.6;

/**
 * Stoke: the coal cupped in both hands low before the belly, the knees bent and the body hunched over it; lifted to
 * the mouth only for the two breaths -- the chest swelling and the shoulders rising before each, falling hard as it
 * is blown -- then closed in the right fist and kept.
 */
const stokePose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const low = 0.12, up = STOKE_UP, lift = up - 0.07;
  const cyc = seg(t, up, b.let) * 2, w = Math.sin(cyc * TAU) * bump(t, up, up + 0.03, b.let);
  const inhale = Math.max(0, w), blow = Math.max(0, -w);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [low, [34, -14, 30]], [lift, [36, -14, 30]], [up, [66, -16, 34]], [b.let, [64, -16, 34]],
      ...(k ? [[b.through, [30, 16, 0]], [1, [20, 10, 0]]] as const : [[b.through, [20, 12, 0]], [1, [18, 10, 0]]] as const)]);
    r.elbow[k] = one(t, k ? [[0, 30], [low, 84], [lift, 84], [up, 124], [b.let, 122], [b.through, 84], [1, 30]] : [[0, 30], [low, 84], [lift, 84], [up, 124], [b.let, 122], [b.through, 40], [1, 28]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [low, [0, 0, k ? -60 : 60]], [b.let, [0, 0, k ? -60 : 60]], [b.through, [0, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.05 && (k ? t < b.let + 0.02 : t < 0.9);
    r.shrug[k] = 0.7 * inhale;
  }
  r.chest = euler(t, [[0, [0, 0, 0]], [low, [-8, 0, 0]], [lift, [-8, 0, 0]], [up, [4, 0, 0]], [b.let, [-4, 0, 0]], [b.through, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest[0] += 6 * inhale - 15 * blow;
  r.head = euler(t, [[0, [0, 0, 0]], [low, [-28, 0, 0]], [lift, [-26, 0, 0]], [up, [-4, 0, 0]], [b.let, [-10, 0, 0]], [b.through, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.head[0] += 4 * inhale - 10 * blow;
  r.spine = euler(t, [[0, [0, 0, 0]], [low, [-16, 0, 0]], [lift, [-16, 0, 0]], [up, [-4, 0, 0]], [b.let, [-8, 0, 0]], [b.through, [2, 0, 0]], [1, [0, 0, 0]]]);
  feet(r, t, c, [[0, STAND], [low, [0, 1.5, 0, 0, -0.5, 0, 0, -0.6, 0, 30]], [lift, [0, 1.5, 0, 0, -0.5, 0, 0, -0.6, 0, 30]], [up, [0, 1.5, 0, 0, -0.5, 0, 0, 0, 0, 12]],
    [b.let, [0, 1.5, 0, 0, -0.5, 0, 0, 0, 0, 14]], [b.through, [0, 1.5, 0, 0, -0.5, 0, 0, 0, 0, 6]], [0.95, STAND]]);
  // Both hands a bowl round the coal; the right shuts on it once it is hot. Lips pursed, blowing.
  r.shape = [shapeAt(t, [[0, {}], [low, { cup: 1 }], [b.let, { cup: 1 }], [b.through, {}], [1, {}]]),
    shapeAt(t, [[0, {}], [low, { cup: 1 }], [b.let - 0.02, { cup: 1 }], [b.let + 0.04, {}], [1, {}]])];
  r.mouth = 0.1 * bump(t, up, up + 0.04, b.let) + 0.35 * blow;
});

/**
 * Firebrand: an hourglass written in the air with the right forefinger, low before the body -- its left side in to
 * the waist and out, its bottom bar, its right side back up, its top bar -- then pressed into the left forearm held
 * level across the belly, where it stays.
 */
const firebrandPose: CastPose = free((r, t, c) => {
  const b = beats(c);
  const [w0, w1] = BRAND_WRITE;
  // The right arm goes round the glass's corners as the hand is put on them (`brandPoint`): the arm's own keys.
  const u = seg(t, w0, w1) * BRAND_SEGS, i = Math.min(BRAND_SEGS - 1, Math.floor(u)), f = smooth(u - i);
  // Near where the reach puts the hand, so the reach only refines it: an arm keyed far from it flips the elbow over.
  const toArm = (q: readonly [number, number]): [number, number] => [lerp(48, 84, (q[1] + 1) / 2), lerp(-6, 28, (q[0] + 1) / 2)];
  const p0 = toArm(BRAND_CORNERS[i]), p1 = toArm(BRAND_CORNERS[i + 1]);
  const writing: [number, number, number] = [lerp(p0[0], p1[0], f), lerp(p0[1], p1[1], f), 0];
  const first = toArm(BRAND_CORNERS[0]);
  const start = track1(t, [[0, [20, 10, 0]], [w0, [first[0], first[1], 0]]]);
  // Down onto the forearm at the belly, the palm flat on it.
  const after = track1(t, [[w1, [first[0], first[1], 0]], [b.let, [30, -20, 30]], [b.through, [32, -18, 28]], [1, [22, 10, 0]]]);
  r.arm[1] = (t < w0 ? start : t < w1 ? writing : after) as [number, number, number];
  r.elbow[1] = one(t, [[0, 30], [w0, 26], [w1, 26], [b.let, 104], [b.through, 100], [1, 28]]);
  r.open[1] = t > b.let - 0.06 && t < 0.92;
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [w0, [-10, 0, 0]], [b.let, [-20, 0, 0]], [1, [0, 0, 0]]]);
  // The left forearm raised across the body to take it.
  // Across the belly, low and level: a press, not the hands at the face that Stoke's breath is.
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [w1 - 0.08, [24, 10, 0]], [b.let, [40, -4, 34]], [b.through, [44, -2, 30]], [1, [16, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [w1 - 0.08, 30], [b.let, 100], [b.through, 104], [1, 28]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [w0, [2, 0, -6]], [w1, [2, 0, -4]], [b.let, [-6, 0, 10]], [b.through, [4, 0, 6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.let, [-6, 0, 0]], [b.through, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [w0, [-10, 0, 0]], [w1, [-16, 0, 0]], [b.let, [-18, 0, 14]], [b.through, [-6, 0, 12]], [1, [0, 0, 0]]]);
  // The forefinger writes; the hand opens flat to press the glyph in.
  r.shape = [undefined, shapeAt(t, [[0, {}], [w0 - 0.04, { point: 1 }], [w1, { point: 1 }], [b.let, { flat: 1 }], [b.through, { flat: 0.6 }], [1, {}]])];
  // The hand put on the glyph's own strokes as it writes them: the points the fire is drawn through (`brandPoint`).
  const pen = smooth(seg(t, w0 - 0.06, w0)) * (1 - smooth(seg(t, w1, w1 + 0.08)));
  if (pen > 0) r.reach = [undefined, { at: brandPoint(c.facing, seg(t, w0, w1) * BRAND_SEGS), w: pen }];
});

/** When the Blaze Aura's arms are out and the body turns to lay its ring, as a share of the cast; it is laid at the release. */
const AURA_OPEN = 0.15;
const AURA_LET = 0.5;

/**
 * Blaze Aura: both arms out low to the sides, palms down, the body wound right round one way; then turned right
 * round the other on the feet -- hips, trunk and shoulders, the feet stepping on the spot -- the two hands laying the
 * ring on the ground as they go (`charge` follows them), and settling with the arms wide.
 */
const blazeAuraPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const open = AURA_OPEN;
  const turn = one(t, [[0, 0], [open, -120], [b.let, 120], [b.through, 30], [1, 0]]);
  for (let k = 0; k < 2; k++) {
    const low = armToward(k, [k ? 0.8 : -0.8, 0.2, -0.5]), wide = armOut(k, 50, 85);
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [open, low], [b.let, low], [b.through, wide], [1, [18, 12, 0]]]);
    r.elbow[k] = one(t, [[0, 30], [open, 14], [b.let, 8], [b.through, 16], [1, 26]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [open, [-30, 0, 0]], [b.let, [-40, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.06 && t < 0.92;
  }
  r.pelvis = [0, 0, turn * 0.3];
  r.spine = [one(t, [[0, 0], [open, -6], [b.let, 2], [1, 0]]), 0, turn * 0.35];
  r.chest = [one(t, [[0, 0], [b.let, 4], [1, 0]]), 0, turn * 0.35];
  r.head = [one(t, [[0, 0], [open, -10], [b.let, 2], [1, 0]]), 0, -turn * 0.15];
  // The feet stepping round under the turn: each lifted in its turn and put down where it stood.
  const step = seg(t, open, b.let);
  const lift0 = 1.4 * Math.max(0, Math.sin(step * TAU * 2)), lift1 = 1.4 * Math.max(0, -Math.sin(step * TAU * 2));
  const bend = one(t, [[0, 6], [open, 18], [b.let, 22], [b.through, 14], [1, 6]]);
  feet(r, t, c, [[0, [0, 0, lift0, 0, 0, lift1, 0, 0, lift0 > 0.1 ? 0.6 : lift1 > 0.1 ? -0.6 : 0, bend]]]);
  const palms = shapeAt(t, [[0, {}], [open, { flat: 1 }], [b.through, { flat: 1 }], [1, {}]]);
  r.shape = [palms, palms];
});

/**
 * Firestorm: crouched low with the fists crossed over the heart, then rising on the legs as the arms spiral up and
 * are flung wide over the head in a V, the chest open to the sky.
 */
const firestormPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const low = b.top * 0.55;
  const tremble = bump(t, low * 0.6, low, b.top) * Math.sin(t * 150);
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    // The V thrown up and forward, out over the ground the wall rolls across: from the side it is arms flung ahead
    // and up, not straight up as Meteor's and Pyre's tops are.
    const rise = armToward(k, [s * 0.35, 0.5, 0.8]), vee = armToward(k, [s * 0.7, 0.45, 0.55]);
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [low, [58, -30, 40]], [b.top, rise], [b.let, vee], [b.through, vee], [1, [18, 12, 0]]]);
    r.elbow[k] = one(t, [[0, 30], [low, 122], [b.top, 50], [b.let, 6], [b.through, 10], [1, 26]]) + 3 * tremble;
    r.open[k] = t > b.top - 0.04 && t < 0.92;
    r.shrug[k] = one(t, [[0, 0], [b.top, 0.3], [b.let, 0.5], [b.through, 0.4], [1, 0]]);
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [low, [-20, 0, 0]], [b.top, [0, 0, 0]], [b.let, [2, 0, 0]], [b.through, [0, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [low, [-10, 0, 0]], [b.let, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [low, [-20, 0, 0]], [b.top, [6, 0, 0]], [b.let, [24, 0, 0]], [b.through, [20, 0, 0]], [1, [0, 0, 0]]]);
  feet(r, t, c, [[0, STAND], [low, [-1, 0, 0, 1, 0, 0, 0, -0.5, 0, 56]], [b.top, [-1, 0, 0, 1, 0, 0, 0, 0, 0, 12]], [b.let, [-1, 0, 0, 1, 0, 0, 0, 0, 0, 2]],
    [b.through, [-1, 0, 0, 1, 0, 0, 0, 0, 0, 4]], [0.95, STAND]]);
  // Fists over the heart, then flung open, fingers spread, with a shout at the let.
  const hands = shapeAt(t, [[0, {}], [b.top - 0.04, {}], [b.let, { claw: 0.6, flat: 0.4 }], [b.through, { claw: 0.4, flat: 0.6 }], [1, {}]]);
  r.shape = [hands, hands];
  r.mouth = one(t, [[0, 0], [b.top, 0.3], [b.let, 1], [b.through, 0.6], [1, 0]]);
});

/** When a Pyre's kneel ends and the body pushes up off the front knee, as a share of the cast. */
const PYRE_HOLD = 0.76;

/**
 * Pyre: the hands clasped round the ruby at the chest, raised together over the left shoulder, and hammered down
 * in front of the knee as the body drops onto it -- upright through the trunk, the fists driven into the ground;
 * held there while it burns, then a push off the front knee and up.
 */
const pyrePose: CastPose = free((r, t, c) => {
  const b = beats(c);
  const clasp = b.top * 0.3, hold = PYRE_HOLD, push = lerp(hold, 1, 0.4);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [clasp, [50, -18, 36]], [b.top, [150, -20, 20]], [b.let, [44, -12, 14]], [hold, [40, -10, 14]], [1, [18, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 30], [clasp, 116], [b.top, 60], [b.let, 10], [hold, 18], [1, 28]]);
    r.open[k] = false;
    r.shrug[k] = one(t, [[0, 0], [b.top, k ? 0.3 : 0.7], [b.let, 0], [1, 0]]);
  }
  // Wound up to the left, the trunk upright through the blow; a lean forward over the front knee for the push up.
  r.spine = euler(t, [[0, [0, 0, 0]], [clasp, [-4, 0, 0]], [b.top, [8, -6, 22]], [b.let, [-12, 0, 0]], [hold, [-10, 0, 0]], [push, [-20, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, 16]], [b.let, [-6, 0, 0]], [hold, [-4, 0, 0]], [push, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [clasp, [-14, 0, 0]], [b.top, [6, 0, -28]], [b.let, [2, 0, 0]], [hold, [4, 0, 0]], [push, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.kneel = one(t, [[0, 0], [lerp(b.top, b.let, 0.3), 0], [b.let, 1], [hold, 1], [push, 0.75], [1, 0]]);
  // The clasped fists: over the left shoulder at the top, then driven down before the front knee, held there.
  const fists: Array<[number, V3, V3, number]> = [
    [clasp, [-0.6, 4, 11], [0.6, 4, 11], 0.6],
    // Behind the head and together, a hammer cocked over the shoulder: from the side not arms straight up.
    [b.top, [-2.6, -4.2, 16.5], [-1.8, -3.8, 16.5], 1],
    [b.let, [-0.7, 3.5, 3.5], [0.7, 3.5, 3.5], 1],
    [hold, [-0.7, 3.5, 3.6], [0.7, 3.5, 3.6], 1],
  ];
  const w = one(t, [[0, 0], [clasp, 0.6], [b.top, 1], [hold, 1], [push, 0.5], [1, 0]]);
  if (w > 0) {
    const at = (h: 1 | 2): V3 => track(t, fists.map((f) => [f[0], f[h]] as const)) as V3;
    r.reach = [{ at: at(1), w }, { at: at(2), w }];
  }
  r.mouth = one(t, [[0, 0], [b.top, 0.3], [b.let, 0.8], [hold, 0.3], [1, 0]]);
});

/** `track` for three numbers, as a mutable triple. */
function track1(t: number, keys: ReadonlyArray<readonly [number, readonly [number, number, number]]>): [number, number, number] {
  return euler(t, keys) as unknown as [number, number, number];
}

/** When the Firebrand's hourglass is written, as shares of the cast. */
const BRAND_WRITE = [0.12, 0.44] as const;
/**
 * The hourglass's outline in the order it is written, across and up (minus one to one): its left side in to the
 * narrow waist and out again, its bottom bar, its right side back up, its top bar -- half a glass on its base after
 * the first two strokes, where starting with the top bar read as a "7".
 */
const BRAND_CORNERS: ReadonlyArray<readonly [number, number]> = [[-1, 1], [-0.3, 0], [-1, -1], [1, -1], [0.3, 0], [1, 1], [-1, 1]];
const BRAND_SEGS = BRAND_CORNERS.length - 1;

/**
 * A point along the hourglass the Firebrand writes, `u` nought to
 * `BRAND_SEGS` along its strokes (`BRAND_CORNERS`), in the caster's own frame
 * (right, ahead, up). It is written square to the viewer, whichever way the
 * caster faces, so it reads as a glyph and not as a line seen edge on: its
 * across is the way that is level on the screen, turned into the body's terms
 * for its facing (as `FxScene.local` turns them back). The pose puts the hand
 * on it and the fire is drawn through it.
 */
function brandPoint(facing: number, u: number): V3 {
  const th = Math.PI / 4 - (facing * Math.PI) / 4, sn = Math.sin(th), cs = Math.cos(th);
  // Level on the screen is along the view's (1, -1); in the body's terms, by the same turn `local` undoes.
  const ax = (-sn - cs) / Math.SQRT2, ay = (cs - sn) / Math.SQRT2;
  const v = clamp(u, 0, BRAND_SEGS), i = Math.min(BRAND_SEGS - 1, Math.floor(v)), f = smooth(v - i);
  const c0 = BRAND_CORNERS[i], c1 = BRAND_CORNERS[i + 1];
  const across = lerp(c0[0], c1[0], f) * BRAND_W, up = lerp(c0[1], c1[1], f) * BRAND_H;
  return [BRAND_AT[0] + ax * across, BRAND_AT[1] + ay * across, BRAND_AT[2] + up];
}
/** Where the glyph is written, before the belly and out to the right, so the hand stays below the chin; its half width and half height (figure units). */
const BRAND_AT: V3 = [3.6, 6, 9.5];
const BRAND_W = 2.2;
const BRAND_H = 2.8;

/* ---- what a Firebrand writes ------------------------------------------------------------- */

/**
 * An hourglass in the air: two triangles of flame meeting at a waist, the fire
 * in the top running into the bottom as `left` (nought to one) of its time
 * runs out. What a Firebrand is: burns made to last, and how long it has.
 */
function hourglass(k: FxScene, c: P3, r: number, left: number, alpha: number, turn: number): void {
  if (alpha <= 0.01) return;
  const x = k.sx(c), y = k.sy(c), R = r * k.zoom;
  // Turning about its upright, as a flat thing in the air.
  const sq = 0.4 + 0.6 * Math.abs(Math.cos(turn));
  const W = R * 0.62 * sq;
  const inkW = Math.max(0.8, 0.6 * k.zoom);
  k.worldDraw(c, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'miter';
    // The sand: fire in the top triangle down to its level, gathered in the bottom one up to its own.
    const top = clamp(left), bot = 1 - top;
    g.fillStyle = PALETTE.main;
    if (top > 0.02) {
      const h = R * top, w = W * top;
      g.beginPath();
      g.moveTo(x - w, y - h);
      g.lineTo(x + w, y - h);
      g.lineTo(x, y);
      g.closePath();
      g.fill();
    }
    if (bot > 0.02) {
      // The bottom fills from its base up, clipped to its triangle.
      const h = R * Math.sqrt(bot);
      g.save();
      g.beginPath();
      g.moveTo(x - W, y + R);
      g.lineTo(x + W, y + R);
      g.lineTo(x, y);
      g.closePath();
      g.clip();
      g.fillStyle = PALETTE.main;
      g.fillRect(x - W, y + R - h, 2 * W, h);
      g.restore();
    }
    // The glass: two triangles inked, a bar top and bottom.
    g.beginPath();
    g.moveTo(x - W, y - R);
    g.lineTo(x + W, y - R);
    g.lineTo(x - W, y + R);
    g.lineTo(x + W, y + R);
    g.closePath();
    g.lineWidth = inkW + 1.4 * k.zoom;
    g.strokeStyle = PALETTE.ink;
    g.stroke();
    g.lineWidth = 1.4 * k.zoom;
    g.strokeStyle = PALETTE.accent;
    g.stroke();
    g.fillStyle = PALETTE.core;
    g.fillRect(x - W * 1.15, y - R - 0.7 * k.zoom, W * 2.3, 1.4 * k.zoom);
    g.fillRect(x - W * 1.15, y + R - 0.7 * k.zoom, W * 2.3, 1.4 * k.zoom);
  }, 6);
  k.glow(c, r * 2.4, alpha * 0.45);
}

/* ---- what a Scald throws --------------------------------------------------------------------- */

/**
 * The scald in the air, `u` of the way from `from` to `to` along an arc `lift`
 * high: one sheet of liquid flung flat, fanning out across the way it goes as it
 * flies, thinning to nothing behind and breaking at its front into three
 * fingers that shed drops. Pale and hot, edged in its own brown: liquid, not
 * fire.
 */
function scaldSheet(k: FxScene, from: P3, to: P3, u: number, lift: number): void {
  const dir = k.toward(k.caster, k.target), side = { x: -dir.y, y: dir.x };
  const n = 7, tail = Math.max(0, u - 0.24);
  const mid: P3[] = [], wide: number[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    mid.push(arcAt(from, to, lerp(tail, u, f), lift));
    wide.push((0.02 + 0.22 * f * f * (0.5 + 0.5 * u)) * (1 + 0.25 * Math.sin(k.now * 17 + i * 2.3)));
  }
  const at = (p: P3, w: number, up: number): [number, number] => {
    const q = { x: p.x + side.x * w, y: p.y + side.y * w, z: p.z + up };
    return [k.sx(q), k.sy(q)];
  };
  const head = mid[n], prev = mid[n - 1];
  const fwd = { x: head.x - prev.x, y: head.y - prev.y, z: head.z - prev.z };
  const fl = Math.hypot(fwd.x * UNITS_PER_TILE, fwd.y * UNITS_PER_TILE, fwd.z) || 1;
  const step = 3 / fl;
  const tips: P3[] = [];
  const outline: Array<[number, number]> = [];
  // As thick as it is wide, near enough, so seen edge on it is still a body of liquid and not a line.
  // Turned so its width across and its thickness add on the screen rather than cancel: seen side on, the side that is
  // lower on the screen is the lower edge too.
  const lower = k.sy({ x: head.x + side.x * 0.1, y: head.y + side.y * 0.1, z: head.z }) > k.sy(head) ? -1 : 1;
  const thick = (w: number): number => w * UNITS_PER_TILE * 0.3 * lower;
  for (let i = 0; i <= n; i++) outline.push(at(mid[i], wide[i], thick(wide[i])));
  // The front: rounded and lumpy, bulging out ahead, the drops it sheds coming off its lumps.
  const W = wide[n];
  for (let j = 1; j < 6; j++) {
    const th = Math.PI / 2 - (j / 6) * Math.PI;
    const reach = step * (1.4 + 0.9 * Math.abs(Math.sin(k.now * 13 + j * 2.1))) * Math.cos(th);
    const p = { x: head.x + fwd.x * reach + side.x * W * Math.sin(th), y: head.y + fwd.y * reach + side.y * W * Math.sin(th), z: head.z + fwd.z * reach + thick(W) * Math.sin(th) };
    outline.push([k.sx(p), k.sy(p)]);
    if (j % 2) tips.push(p);
  }
  for (let i = n; i >= 0; i--) outline.push(at(mid[i], -wide[i], -thick(wide[i])));
  // The light caught along it, bent with it, nearer the front.
  const streak: Array<[number, number]> = [];
  for (let i = 3; i <= n; i++) streak.push(at(mid[i], wide[i] * 0.3, thick(wide[i]) * 0.3 + 0.3));
  // The front breaking up: round drops just ahead of it, coming off its lumps.
  const beads: Array<[number, number, number]> = [];
  for (let j = 0; j < 4; j++) {
    const th = (j / 3 - 0.5) * 2.2;
    const ahead = step * (2.6 + 1.4 * hashOf(k.seed + 85, j) + 0.8 * Math.sin(k.now * 9 + j));
    const p = { x: head.x + fwd.x * ahead + side.x * W * 0.7 * Math.sin(th), y: head.y + fwd.y * ahead + side.y * W * 0.7 * Math.sin(th), z: head.z + fwd.z * ahead };
    beads.push([k.sx(p), k.sy(p), (1.2 + 0.6 * hashOf(k.seed + 86, j)) * k.zoom]);
  }
  const z = k.zoom;
  // A closed curve through the midpoints of the outline: rounded all round, as a body of liquid is, never a cut sheet.
  const smoothPath = (g: CanvasRenderingContext2D, pts: Array<[number, number]>): void => {
    const m = pts.length;
    const midOf = (i: number): [number, number] => [(pts[i % m][0] + pts[(i + 1) % m][0]) / 2, (pts[i % m][1] + pts[(i + 1) % m][1]) / 2];
    const s0 = midOf(0);
    g.moveTo(s0[0], s0[1]);
    for (let i = 1; i <= m; i++) {
      const c = pts[i % m], e = midOf(i);
      g.quadraticCurveTo(c[0], c[1], e[0], e[1]);
    }
    g.closePath();
  };
  // The tail half alone, for the thin end: drawn fainter under the whole, so the sheet thins to nothing behind.
  const half = Math.floor(n / 2), body = outline.length;
  const front = outline.slice(half, body - half);
  k.worldDraw(head, (g) => {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // See-through, as liquid is: thin behind, fuller at the front.
    g.globalAlpha = 0.35;
    g.beginPath();
    smoothPath(g, outline);
    g.fillStyle = SCALD.main;
    g.fill();
    g.globalAlpha = 0.6;
    g.beginPath();
    smoothPath(g, front);
    g.fill();
    g.globalAlpha = 0.8;
    g.beginPath();
    smoothPath(g, front);
    g.lineWidth = Math.max(0.7, 0.55 * z);
    g.strokeStyle = SCALD.ink;
    g.stroke();
    g.globalAlpha = 0.95;
    g.beginPath();
    streak.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.lineWidth = 1.1 * z;
    g.strokeStyle = SCALD.core;
    g.stroke();
    // The drops, round, each with its glint.
    for (const [x, y, r] of beads) {
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fillStyle = SCALD.main;
      g.fill();
      g.lineWidth = Math.max(0.5, 0.4 * z);
      g.strokeStyle = SCALD.ink;
      g.stroke();
      g.fillStyle = SCALD.core;
      g.fillRect(x - r * 0.5, y - r * 0.6, r * 0.5, r * 0.5);
    }
  }, 2);
  for (const tip of tips) k.emit(tip, 14, { kind: 'drop', colour: [SCALD.core, SCALD.main], size: 1.5, life: [0.2, 0.35], speed: [0.05, 0.3], up: [-4, 4], gravity: 90 });
}

/**
 * The scald breaking over what it hit, `u` through the moment: a crown of
 * liquid thrown up and out round it and falling back, the spikes behind it
 * drawn behind it and the rest before it.
 */
function scaldCrown(k: FxScene, b: Body, u: number): void {
  const h = 6 * Math.sin(Math.PI * Math.min(1, u * 1.15));
  if (h <= 0.3) return;
  // One thin, see-through skirt of liquid thrown up all round it -- a splash's crown -- its top edge rounded into
  // lobes that each throw a round drop off their crest, opening out as it rises and falling back. Its far side drawn
  // behind the creature and its near side before it.
  const r0 = footOf(b) * 0.55, r1 = r0 * (1.3 + 0.6 * easeOut(u));
  const m = k.fast ? 24 : 36, lobes = 7, turn = hashOf(k.seed + 81, 0) * TAU;
  const foot = k.on(b.x, b.y), fy = k.sy(foot);
  const bot: Array<[number, number]> = [], top: Array<[number, number]> = [];
  for (let i = 0; i < m; i++) {
    const ang = (i / m) * TAU;
    const lobe = 0.6 + 0.4 * Math.cos(lobes * ang + turn);
    const pb = k.on(b.x + Math.cos(ang) * r0, b.y + Math.sin(ang) * r0, 0.3);
    const pt = k.on(b.x + Math.cos(ang) * r1, b.y + Math.sin(ang) * r1, h * lobe * (0.85 + 0.3 * hashOf(k.seed + 82, i)));
    bot.push([k.sx(pb), k.sy(pb)]);
    top.push([k.sx(pt), k.sy(pt)]);
  }
  const drops: Array<[number, number, number]> = [];
  if (u > 0.15) {
    for (let j = 0; j < lobes; j++) {
      const ang = (j * TAU - turn) / lobes;
      const d = k.on(b.x + Math.cos(ang) * r1 * (1 + 0.3 * u), b.y + Math.sin(ang) * r1 * (1 + 0.3 * u), h + 2 + 4 * u);
      drops.push([k.sx(d), k.sy(d), (0.9 + 0.5 * hashOf(k.seed + 84, j)) * k.zoom]);
    }
  }
  const a = 1 - seg(u, 0.75, 1), z = k.zoom;
  const W = 400 * z;
  const draw = (near: boolean) => (g: CanvasRenderingContext2D): void => {
    g.save();
    g.beginPath();
    if (near) g.rect(-W + bot[0][0], fy, 2 * W, W);
    else g.rect(-W + bot[0][0], fy - W, 2 * W, W);
    g.clip();
    g.globalAlpha = clamp(0.5 * a);
    g.beginPath();
    for (let i = 0; i < m; i++) {
      const q = (i + 1) % m;
      g.moveTo(bot[i][0], bot[i][1]);
      g.lineTo(top[i][0], top[i][1]);
      g.lineTo(top[q][0], top[q][1]);
      g.lineTo(bot[q][0], bot[q][1]);
      g.closePath();
    }
    g.fillStyle = SCALD.main;
    g.fill();
    // Its rim, rounded through the lobes: inked, and lit white along it where the light catches the liquid.
    g.beginPath();
    const midOf = (i: number): [number, number] => [(top[i % m][0] + top[(i + 1) % m][0]) / 2, (top[i % m][1] + top[(i + 1) % m][1]) / 2];
    const s0 = midOf(0);
    g.moveTo(s0[0], s0[1]);
    for (let i = 1; i <= m; i++) {
      const c = top[i % m], e = midOf(i);
      g.quadraticCurveTo(c[0], c[1], e[0], e[1]);
    }
    g.lineJoin = 'round';
    g.globalAlpha = clamp(0.8 * a);
    g.lineWidth = Math.max(0.6, 0.5 * z);
    g.strokeStyle = SCALD.ink;
    g.stroke();
    g.lineWidth = Math.max(0.5, 0.35 * z);
    g.strokeStyle = SCALD.core;
    g.stroke();
    g.globalAlpha = clamp(0.9 * a);
    for (const [x, y, r] of drops) {
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fillStyle = SCALD.main;
      g.fill();
    }
    g.restore();
  };
  k.worldDraw(foot, draw(false), -3);
  k.worldDraw(foot, draw(true), 3);
}

/**
 * The ground wet under a scalded creature: a ragged patch, darker where it has
 * soaked in and paler in the middle where it still steams, `grow` (nought to one)
 * as it splashes out and `size` as it dries in from the edge.
 */
function scaldPatch(k: FxScene, b: Body, grow: number, size: number, alpha = 1): void {
  if (alpha <= 0.01 || grow <= 0.01) return;
  const R = footOf(b) * 0.8 * grow * size, n = 13;
  const outer: number[] = [], glint: number[][] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU;
    const rr = R * (0.6 + 0.4 * hashOf(k.seed + 87, i));
    outer.push(b.x + Math.cos(ang) * rr, b.y + Math.sin(ang) * rr);
  }
  // Two small bright glints where the wet catches the light: what says wet rather than stained.
  for (let j = 0; j < 2; j++) {
    const ang = -2.2 + j * 0.9, d = R * (0.35 + 0.15 * j), l = R * 0.18;
    const x = b.x + Math.cos(ang) * d, y = b.y + Math.sin(ang) * d;
    glint.push([x - l, y + l * 0.3, x + l, y - l * 0.3]);
  }
  k.groundShape(b.x, b.y, R + 0.5, [
    { kind: 'fill', colour: STEAM_SHADE, alpha: clamp(0.5 * alpha), paths: [outer], lift: 0.08, glow: 0.3 * k.night, light: STEAM },
    { kind: 'stroke', colour: SCALD.ink, alpha: clamp(0.45 * alpha), width: 0.6 * k.zoom, paths: [outer], closed: true, join: 'round', lift: 0.09 },
    { kind: 'stroke', colour: '#ffffff', alpha: clamp(0.8 * alpha * size), width: 1.1 * k.zoom, paths: glint, cap: 'round', lift: 0.1 },
  ]);
}

/**
 * The Firebrand's mark on the forearm from `elbow` to `wrist`: a small
 * hourglass burnt into the skin, lying along the arm, its glass at `heat`
 * (two white, one orange, nought coals). Drawn before the arm.
 */
function brandMark(k: FxScene, elbow: P3, wrist: P3, heat: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const ax = k.sx(elbow), ay = k.sy(elbow), bx = k.sx(wrist), by = k.sy(wrist);
  let ux = bx - ax, uy = by - ay;
  const len = Math.hypot(ux, uy);
  if (len < 2) return;
  ux /= len;
  uy /= len;
  const cx = ax + ux * len * 0.55, cy = ay + uy * len * 0.55;
  const h = Math.max(1.6, len * 0.2), w = Math.max(1.2, len * 0.15);
  const tone = tonesOf(heat);
  const P = (along: number, across: number): [number, number] => [cx + ux * along - uy * across, cy + uy * along + ux * across];
  const glass = [P(-h, -w), P(-h, w), P(0, 0.15 * w), P(h, w), P(h, -w), P(0, -0.15 * w)];
  k.worldDraw(wrist, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'miter';
    g.beginPath();
    glass.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = tone.lit;
    g.fill();
    g.lineWidth = Math.max(0.6, 0.45 * k.zoom);
    g.strokeStyle = PALETTE.ink;
    g.stroke();
    // Its heart: the sand still in the top.
    const s = [P(-h * 0.7, -w * 0.6), P(-h * 0.7, w * 0.6), P(-h * 0.1, 0)];
    g.beginPath();
    s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = tone.heart;
    g.fill();
  }, 7);
}

/* ---- the record --------------------------------------------------------------------------- */

/** Height units the Blaze Aura's tongues stand, and how fast (radians a second) its ring turns. */
const AURA_H = 7;
const AURA_TURN = 0.5;
/** Seconds a Meteor's blast lasts, before the crater is the linger's. */
const METEOR_BLAST = 1.1;
/** Seconds a Firestorm's wall takes to roll out and die at its reach. */
const FIRESTORM_WAVE = 1;

/** The heat of a hit fading from white to orange to coals over `u`. */
const cooling = (u: number): number => 2 - 2 * smooth(u);

export const KINDLER: Record<string, SpellVisual> = {
  /*
   * Scorch (bolt, on enemy, lasts 8 s): fire at 80% and a burn of 1% a second for 8 s. The little one: a flick of the
   * fingers, a thin dart of flame straight and fast, a splash, and a small burn that licks over it for its eight seconds.
   */
  kindler_scorch: {
    palette: PALETTE,
    cast: { timing: { secs: 0.7, release: 0.45 }, pose: scorchPose },
    fx: {
      charge: (k, t) => {
        const hand = k.hand(1);
        kindle(k, hand, seg(t, 0, 0.3), 1.4);
        // A flame standing off the fingers as the hand cocks, the fire ready in it.
        handFlame(k, { ...hand, z: hand.z + 0.5 }, 2.6 * smooth(seg(t, 0.12, 0.4)), 1.2, 1.2, 1 - seg(t, 0.44, 0.5));
        if (t > 0.45) k.glow(hand, 6, 0.6 * (1 - seg(t, 0.45, 0.7)));
      },
      release: (k) => {
        k.burst(k.hand(1), 8, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.6, life: [0.12, 0.25], speed: [1.2, 2.6], up: [0, 8], heading: k.toward(k.caster, k.target), cone: 0.9, gravity: 20, drag: 0.1 });
      },
      travel: {
        secs: (tiles) => 0.1 + tiles * 0.035,
        draw: (k, u) => {
          const from = k.hand(1), to = k.heart(k.target);
          const head = arcAt(from, to, u, k.dist * 0.15);
          // A thin dart: one long tongue streaming back the way it came.
          const back = arcAt(from, to, Math.max(0, u - 0.16), k.dist * 0.15);
          fireball(k, head, back, 1.7, 5);
          k.light(head, 1.6, 0.5);
          k.emit(head, 30, { kind: 'ember', colour: [GOLD, PALETTE.main], size: 1.2, life: [0.15, 0.3], speed: [0.05, 0.2], up: [-2, 6], gravity: 6, jitter: 0.03 });
        },
      },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 18, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.6, life: [0.2, 0.4], speed: [0.6, 1.6], up: [4, 24], heading: k.toward(k.caster, k.target), cone: 2.2, gravity: 50, drag: 0.1 });
        k.burst(at, 6, { kind: 'mist', colour: SMOKE, size: 2, life: [0.4, 0.8], speed: [0.05, 0.2], up: [6, 12] });
      },
      impact: {
        secs: 0.45,
        draw: (k, u) => {
          const at = k.heart(k.target);
          // The splash: a small star of flame off where it went in, white to orange, as the burn takes.
          starburst(k, at, 5, 9 * (0.5 + 0.5 * easeOut(u * 2)), 2, cooling(u), 1 - seg(u, 0.5, 1), k.seed);
          k.flare(at, 7 * (1 - u), flashOf(u), PALETTE.core);
          k.light(k.target, 2, 0.7 * (1 - u));
        },
      },
      linger: { on: 'target', secs: burnSecs('kindler_scorch'), draw: burnLinger },
    },
  },

  /*
   * Heat Seeker (nova, on self, 10 tiles round): fire at 100% on the weakest enemy within 10 tiles. The island picks the
   * creature, and the cast is not told which, so what is drawn is the seeking: a wisp of flame stirred up in the palm,
   * circling the head while a sweep of heat runs round the ground at exactly the tiles it searches, then sent up and
   * away over the caster's shoulder to find it.
   */
  kindler_heat_seeker: {
    palette: PALETTE,
    cast: { timing: { secs: 1.2, release: 0.6 }, pose: heatSeekerPose },
    fx: {
      charge: (k, t) => {
        const R = k.fx.reach ?? 10;
        const palm = k.hand(0);
        kindle(k, palm, seg(t, 0.02, 0.22), 1.5);
        // The wisp: in the palm, then lifted round the head as the right hand stirs it, faster and higher.
        const lift = smooth(seg(t, 0.2, 0.5));
        const spin = k.now * (6 + 6 * lift) + k.seed;
        const head = k.head();
        const ring = { x: head.x + Math.cos(spin) * 0.22 * lift, y: head.y + Math.sin(spin) * 0.22 * lift, z: lerp(palm.z + 1.5, head.z + 2, lift) };
        const a = smooth(seg(t, 0.08, 0.2)) * (1 - seg(t, 0.6, 0.64));
        if (a > 0.01) {
          const trail: P3[] = [];
          for (let i = 6; i >= 0; i--) {
            const s = spin - i * 0.22 * lift;
            trail.push({ x: head.x + Math.cos(s) * 0.22 * lift, y: head.y + Math.sin(s) * 0.22 * lift, z: ring.z - i * 0.15 });
          }
          if (lift > 0.1) k.ribbon(trail, { width: 3, alpha: 0.85 * a, taper: 'start', glow: 0.6 });
          handFlame(k, ring, 2.6 + 0.8 * Math.sin(k.now * 9), 1.4, 1.6, a);
          k.light(ring, 1.8, 0.4 * a);
        }
        // The search: two pulses of heat going out over the ground from the caster to exactly its reach, the second
        // after the first, and the edge of the reach lit for a moment as each arrives.
        for (let i = 0; i < 2; i++) {
          const v = seg(t, 0.22 + i * 0.14, 0.5 + i * 0.12);
          if (v <= 0 || v >= 1) continue;
          const r = 0.4 + (R - 0.4) * easeOut(v);
          k.ring(k.caster, r, { band: 0.12 + 0.1 * (1 - v), alpha: 0.85 * (1 - 0.5 * v) * smooth(v * 6), glow: 0.8, main: PALETTE.accent, deep: PALETTE.main, n: 48 });
        }
        // Near the caster, where the eye is at play size, the heat seen going out over the ground: a broken ring of
        // shimmer rolling out to a few tiles, sparks kicked up off its front, slower than the pulse and fading as it goes.
        const near = seg(t, 0.2, 0.5);
        if (near > 0 && near < 1) {
          const r = 0.35 + 2.4 * easeOut(near), a = smooth(near * 5) * (1 - smooth(seg(near, 0.5, 1)));
          // A run of coals going out over the ground: the group's own shape, not a painted band.
          emberBed(k, k.caster, r, 0.9 * a, { width: 2 });
          for (let i = 0; i < (k.fast ? 3 : 6); i++) {
            const ang = (i / (k.fast ? 3 : 6)) * TAU + k.now * 0.8;
            k.emit(k.on(k.caster.x + Math.cos(ang) * r, k.caster.y + Math.sin(ang) * r, 1), 14 * a, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.2, life: [0.15, 0.3], speed: [0.05, 0.2], up: [8, 18], gravity: 20, over: true });
          }
        }
        // The edge of the reach lit as the second pulse arrives, gone by the time the wisp is sent.
        const edge = bump(t, 0.46, 0.52, 0.6);
        k.ring(k.caster, R, { band: 0.08, alpha: 0.5 * edge, dash: 3, glow: 0.5, main: PALETTE.main, deep: PALETTE.deep, turn: k.now * 0.2, n: 48 });
        // What it found, picked out as the second pulse goes over it; from the release it is the travel's to hold.
        if (t > 0.36 && k.released < 0) {
          const q = quarryOf(k);
          if (q) {
            const d = Math.hypot(q.x - k.caster.x, q.y - k.caster.y);
            quarryMark(k, q, smooth(seg(t, lerp(0.36, 0.62, reachedAt(d, 0.4, R)), 0.66)));
          }
        }
      },
      release: (k) => {
        k.burst(k.at(k.caster, 1.05), 14, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.6, life: [0.2, 0.45], speed: [0.4, 1.2], up: [10, 40], gravity: 30 });
      },
      travel: {
        secs: () => 0.85,
        draw: (k, u) => {
          const q = quarryOf(k);
          if (q) {
            // Up over the shoulder, a curl at the top as it turns, and down on the creature it found.
            const start = k.at(k.caster, 1.1), end = k.heart(q);
            const side = k.toward(k.caster, q);
            const top = k.on(lerp(start.x, end.x, 0.35), lerp(start.y, end.y, 0.35), Math.max(start.z, end.z) + 40);
            const at = (v: number): P3 => {
              const w = v * v * 0.45 + v * 0.55, iw = 1 - w;
              const curl = Math.sin(Math.PI * Math.min(1, w * 1.6)) * 0.9 * iw;
              return {
                x: iw * iw * start.x + 2 * iw * w * top.x + w * w * end.x - side.y * curl,
                y: iw * iw * start.y + 2 * iw * w * top.y + w * w * end.y + side.x * curl,
                z: iw * iw * start.z + 2 * iw * w * top.z + w * w * end.z,
              };
            };
            const head = at(u);
            // What it found stays picked out until it lands.
            quarryMark(k, q, 1);
            const pts: P3[] = [];
            for (let i = 7; i >= 0; i--) pts.push(at(Math.max(0, u - i * 0.035)));
            k.ribbon(pts, { width: 2.6, alpha: 0.85, glow: 0.8 });
            fireball(k, head, pts[pts.length - 2], 2.4, 3.4);
            k.light(head, 2, 0.5);
            k.emit(head, 30, { kind: 'ember', size: 1.3, life: [0.2, 0.45], speed: [0.05, 0.2], up: [-4, 4], gravity: 4, jitter: 0.04 });
            return;
          }
          // Nothing within its reach that this end can see: up over the shoulder, a turn in the air, and away.
          const R = k.fx.reach ?? 10;
          const dir = k.facingDir(k.caster);
          const side = { x: -dir.y, y: dir.x };
          const at = (v: number): P3 => {
            const e = easeIn(v);
            const out = R * 0.75 * e;
            const curl = Math.sin(v * Math.PI * 1.2) * 1.2 * (1 - e);
            return { x: k.caster.x + dir.x * out + side.x * curl, y: k.caster.y + dir.y * out + side.y * curl, z: k.caster.z + 22 + 40 * Math.sin(Math.PI * Math.min(1, v * 1.1)) - 10 * v };
          };
          const head = at(u);
          const pts: P3[] = [];
          for (let i = 7; i >= 0; i--) pts.push(at(Math.max(0, u - i * 0.035)));
          const fade = 1 - seg(u, 0.75, 1);
          k.ribbon(pts, { width: 2.6, alpha: 0.85 * fade, glow: 0.8 });
          fireball(k, head, pts[pts.length - 2], 2 * fade + 0.4, 3.4);
          k.light(head, 2, 0.5 * fade);
          k.emit(head, 30 * fade, { kind: 'ember', size: 1.3, life: [0.2, 0.45], speed: [0.05, 0.2], up: [-4, 4], gravity: 4, jitter: 0.04 });
        },
      },
      hit: (k) => {
        const q = quarryOf(k);
        if (!q) return;
        const at = k.heart(q);
        k.burst(at, 24, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.7, life: [0.2, 0.45], speed: [0.6, 1.8], up: [4, 30], gravity: 50, drag: 0.1 });
        k.burst(at, 6, { kind: 'mist', colour: SMOKE, size: 2.2, life: [0.4, 0.8], speed: [0.05, 0.2], up: [6, 12] });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const q = quarryOf(k);
          if (!q) return;
          // It strikes from above: a star of flame thrown down and out, a breath of fire up it, out.
          const at = k.heart(q);
          // The mark it was found by closes in on it as it is struck, and is gone.
          quarryMark(k, q, 1 - smooth(seg(u, 0, 0.3)));
          starburst(k, at, 6, 10 * (0.5 + 0.5 * easeOut(u * 2)), 2.4, cooling(u), 1 - seg(u, 0.45, 1), k.seed);
          alight(k, q, 6 * (1 - smooth(seg(u, 0.2, 1))), cooling(u * 0.7), 1 - seg(u, 0.7, 1), 2);
          k.flare(at, 9 * (1 - u), flashOf(u), PALETTE.core);
          k.light(q, 2.2, 0.8 * (1 - u));
        },
      },
    },
  },

  /*
   * Scald (bolt, on enemy, lasts 6 s): fire at 70% and, for 6 s, the creature at 60% of its pace. A pan's worth of
   * white-hot liquid flung across the front, an arc of it splashing over the creature, and steam clinging low round its
   * legs for its six seconds, dripping, weighing it down.
   */
  kindler_scald: {
    palette: PALETTE,
    cast: { timing: { secs: 0.9, release: 0.48 }, pose: scaldPose },
    fx: {
      charge: (k, t) => {
        const hand = k.hand(1);
        kindle(k, hand, seg(t, 0, 0.3), 1.4);
        // A bead of scalding liquid wobbling in the palm, steaming.
        const g = smooth(seg(t, 0.1, 0.42)) * (1 - seg(t, 0.47, 0.5));
        if (g > 0.01) {
          k.orb({ ...hand, z: hand.z + 1 }, 2.4 * g * (1 + 0.12 * Math.sin(k.now * 20)), { ...SCALD, glow: 0.6, bias: 1, turn: k.now * 2 });
          k.emit({ ...hand, z: hand.z + 2 }, 14 * g, { kind: 'mist', colour: [STEAM, STEAM_SHADE], size: 1.6, sizeEnd: 3, life: [0.4, 0.7], speed: [0.02, 0.1], up: [8, 14], gravity: -6, jitter: 0.04 });
        }
      },
      release: (k) => {
        const from = k.hand(1);
        k.burst(from, 10, { kind: 'drop', colour: [SCALD.core, SCALD.main], size: 1.6, life: [0.25, 0.45], speed: [0.4, 1.2], up: [4, 16], heading: k.toward(k.caster, k.target), cone: 1.4, gravity: 90 });
      },
      travel: {
        secs: (tiles) => 0.1 + tiles * 0.075,
        draw: (k, u) => {
          // The pan's worth in the air: one sheet of liquid flung flat out of the sweep, fanning wider as it flies and
          // thinning behind, its front breaking up into fingers and drops.
          const from = k.hand(1), to = k.heart(k.target), lift = 3 + k.dist;
          scaldSheet(k, from, to, u, lift);
          k.emit(arcAt(from, to, u, lift), 10, { kind: 'mist', colour: [STEAM, STEAM_SHADE], size: 1.8, sizeEnd: 3.5, life: [0.3, 0.6], speed: [0.02, 0.1], up: [4, 10], gravity: -5, jitter: 0.08 });
        },
      },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 14, { kind: 'mist', colour: [STEAM, STEAM_SHADE], size: 3, sizeEnd: 6, life: [0.6, 1.1], speed: [0.2, 0.6], up: [6, 16], gravity: -6, drag: 0.3 });
        k.burst(at, 24, { kind: 'drop', colour: [SCALD.core, SCALD.main], size: 1.8, life: [0.3, 0.5], speed: [0.5, 1.2], up: [10, 24], gravity: 90, drag: 0.6 });
      },
      impact: {
        secs: 0.5,
        draw: (k, u) => {
          // It breaks over the creature: a crown of liquid thrown up off it and falling back, and the ground wet under it.
          scaldCrown(k, k.target, u);
          scaldPatch(k, k.target, smooth(u * 3), 1);
          k.light(k.target, 1.4, 0.4 * (1 - u), WARM);
        },
      },
      linger: {
        draw: (k, age, left) => {
          const b = k.target;
          const a = smooth(age / 0.4) * lateFade(left, 0.6);
          const life = left / Math.max(0.01, age + left);
          // The scald on the ground under it, drying in from its edge over the seconds the creature is slowed.
          scaldPatch(k, b, 1, 0.45 + 0.55 * life, a);
          // How fast it is going: the slow is in what it drags, heavier the more it tries to move.
          const st = k.state;
          const moved = st.lx === undefined ? 0 : Math.hypot(b.x - st.lx, b.y - st.ly) / Math.max(1e-3, k.dt);
          st.lx = b.x;
          st.ly = b.y;
          st.v = lerp(st.v ?? 0, clamp(moved / 2), 0.1);
          const drag = st.v;
          // The weight it carries: heavy steam round its legs that sinks and rolls along the ground rather than lifting,
          // left trailing behind it as it goes -- dragged, a pace that is not its own.
          const vx = st.vx = lerp(st.vx ?? 0, st.lx0 === undefined ? 0 : (b.x - st.lx0) / Math.max(1e-3, k.dt), 0.1);
          const vy = st.vy = lerp(st.vy ?? 0, st.ly0 === undefined ? 0 : (b.y - st.ly0) / Math.max(1e-3, k.dt), 0.1);
          st.lx0 = b.x;
          st.ly0 = b.y;
          const vl = Math.hypot(vx, vy);
          const behind = vl > 0.05 ? { x: -vx / vl, y: -vy / vl } : undefined;
          k.emit(k.at(b, 0.18), (10 + 12 * drag) * a, { kind: 'mist', colour: [STEAM, STEAM_SHADE], size: 2.6, sizeEnd: 6, life: [0.9, 1.4], speed: behind ? [0.15 + 0.4 * drag, 0.3 + 0.6 * drag] : [0.02, 0.06], heading: behind, cone: 0.6, up: [-2, 0], gravity: 1.5, drag: 0.4, jitter: footOf(b) * 0.7, jitterZ: 1 });
          // Hot drops running off its legs onto the ground, a few always and many more while it drags itself along.
          k.emit(k.at(b, 0.3), (5 + 22 * drag) * a, { kind: 'drop', colour: [SCALD.core, SCALD.main], size: 1.6, life: [0.25, 0.4], speed: [0, 0.03], up: [-4, 0], gravity: 70, jitter: b.wide / 40 });
          // The scalded hide glistening, the heat in it pulsing slowly.
          k.glow(k.at(b, 0.45), 7, 0.3 * a * (0.6 + 0.4 * Math.sin(age * 3)), SCALD.deep, true);
        },
      },
    },
  },

  /*
   * Flash Fire (bolt, on enemy, reach 2): fire at 200% on an enemy within 2 tiles. Point-blank: both palms shoved out
   * and a cone of white flame pouring out of them over the creature and past it, a beat of it, gone.
   */
  kindler_flash_fire: {
    palette: PALETTE,
    cast: { timing: { secs: 0.65, release: 0.38 }, pose: flashFirePose },
    fx: {
      charge: (k, t) => {
        const mid = mid3(k.hand(0), k.hand(1), 0.5);
        kindle(k, mid, seg(t, 0, 0.25), 1.4);
        // Heat pressed between the palms: a white point, swelling, sparks spat off it.
        const g = smooth(seg(t, 0.1, 0.36));
        if (g > 0.01 && t < 0.4) {
          k.orb(mid, 1.2 + 2.2 * g, { main: PALETTE.accent, deep: PALETTE.main, core: '#ffffff', alpha: g, bias: 1, turn: k.now * 9 });
          k.light(mid, 1.5 + g, 0.5 * g);
          k.emit(mid, 30 * g, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.2, life: [0.1, 0.22], speed: [0.4, 1], up: [-6, 10], gravity: 0, drag: 0.2 });
        }
      },
      impact: {
        secs: 0.55,
        draw: (k, u) => {
          const from = mid3(k.hand(0), k.hand(1), 0.5), to = k.heart(k.target);
          // What it throws off the creature, as the cone reaches it and not before.
          if (u >= 0.14 && k.state.hit === undefined) {
            k.state.hit = 1;
            const dir = k.toward(k.caster, k.target);
            k.burst(to, 46, { kind: 'spark', colour: [PALETTE.core, GOLD, PALETTE.main], size: 1.8, life: [0.2, 0.5], speed: [1.2, 3], up: [0, 24], heading: dir, cone: 1.4, gravity: 40, drag: 0.1, over: true });
            k.burst(to, 14, { kind: 'ember', size: 1.8, life: [0.4, 0.8], speed: [0.3, 0.9], up: [8, 24], gravity: 10 });
            k.burst(k.at(k.target, 0.6), 8, { kind: 'mist', colour: SMOKE, size: 3, life: [0.6, 1], speed: [0.1, 0.4], up: [8, 14], heading: dir, cone: 1.2 });
          }
          // The cone: tongues laid out along the shove, fanned, reaching past the creature; it pours, holds and burns back.
          const grow = easeOut(seg(u, 0, 0.18)), die = smooth(seg(u, 0.25, 0.8));
          const fx = k.sx(from), fy = k.sy(from), tx = k.sx(to), ty = k.sy(to);
          let dx = tx - fx, dy = ty - fy;
          const L = Math.hypot(dx, dy) || 1;
          dx /= L;
          dy /= L;
          // Ranks of tongues along the shove, each rank further out, longer and wider than the last, so the fire leaves
          // the palms narrow and white and billows out orange over the creature; re-thrown every few frames. It reaches
          // half a tile past the creature at most, and as it dies it burns back into the palms it came from -- the ranks
          // drawn in along the line, shorter -- rather than breaking up where it stood.
          const flames: Flame[] = [];
          const ranks = k.fast ? 3 : 4, across = k.fast ? 2 : 3;
          const most = L * (1 + 0.5 / Math.max(0.5, k.dist)), full = L * 1.36;
          const fit = Math.min(1, most / full), back = 1 - 0.85 * die;
          for (let rk = 0; rk < ranks; rk++) {
            for (let i = 0; i < across; i++) {
              const q = across > 1 ? (i / (across - 1)) * 2 - 1 : 0;
              // Fanned less at the far end than it was, so it billows there as one body, not four spikes.
              const a = q * (0.05 + 0.02 * rk) + 0.05 * Math.sin(k.now * 13 + i * 2.7 + rk);
              const c = Math.cos(a), sn = Math.sin(a);
              const vx = dx * c - dy * sn, vy = dx * sn + dy * c;
              const jig = 0.8 + 0.35 * hashOf(k.seed + Math.floor(k.now * 14), rk * 5 + i);
              // Each rank reaches past the base of the next, so the cone is one body of fire, not pieces of it.
              const len = L * fit * (0.34 + 0.08 * rk) * jig * grow * (1 - 0.8 * die) * flick(k.now, rk * 3 + i);
              const off = L * fit * (0.03 + 0.22 * rk) * grow * back;
              const bx = fx + vx * off, by = fy + vy * off;
              // Fire rises: the tips lift off the line of the shove a little, a little more as less is pushing it.
              const rise = len * (0.12 + 0.18 * die);
              flames.push({ bx, by, tx: bx + vx * len, ty: by + vy * len - rise, w: len * (rk ? 0.22 : 0.15), heat: cooling(u) * 0.6 + 0.9 - 0.45 * rk, wob: sway(k.now, rk * 3 + i) });
            }
          }
          // Sorted with whichever end is nearer the viewer, so it lies over the nearer of the two.
          const near = to.y + to.x > from.y + from.x ? to : from;
          flameGroup(k, near, flames, 1 - seg(u, 0.8, 1), 4);
          // The flash and the glow go with the fire: nothing lights the creature before the cone reaches it.
          k.flare(to, 10 * (1 - u), 0.8 * flashOf(seg(u, 0.12, 1), 0.08), '#ffffff');
          k.glow(mid3(from, to, 0.5 * grow), 18 * (1 - die), 0.7 * (1 - die) * grow);
          k.light(mid3(from, to, 0.6), 2, 1 - u, WARM);
          k.scorch(k.target, 0.35, { alpha: 0.2 * smooth(seg(u, 0.14, 0.4)) * (1 - seg(u, 0.7, 1)) });
        },
      },
    },
  },

  /*
   * Stoke (buff, on self, lasts 60 s): the next fire spell within 60 s deals 50% more. A coal cupped in the hands and
   * blown on twice, brighter each breath, then closed in the right fist and kept there, banked and glowing, for as long
   * as it holds -- spent by the next fire, or out after its sixty seconds.
   */
  kindler_stoke: {
    palette: PALETTE,
    cast: { timing: { secs: 1.4, release: STOKE_LET }, pose: stokePose },
    fx: {
      charge: (k, t) => {
        // The coal held a little out before the cupped hands, in front of the mouth rather than on it, so the face shows
        // through the breaths.
        const cup = mid3(k.hand(0), k.hand(1), 0.5), ahead = k.facingDir(k.caster), out = 1.5 / UNITS_PER_TILE;
        const lift = { x: cup.x + ahead.x * out, y: cup.y + ahead.y * out, z: cup.z + 1.2 };
        kindle(k, lift, seg(t, 0, 0.2), 1.4);
        // How hot it is: a step up at each breath, the breaths at the pose's own, as the chest falls.
        const breaths = seg(t, STOKE_UP, STOKE_LET) * 2;
        const pulse = Math.max(0, -Math.sin(breaths * TAU)) * bump(t, STOKE_UP, STOKE_UP + 0.03, STOKE_LET);
        const heat = 0.25 + 0.3 * Math.floor(breaths) + 0.35 * pulse;
        const a = smooth(seg(t, 0.08, 0.2)) * (1 - seg(t, STOKE_LET + 0.02, STOKE_LET + 0.06));
        if (a > 0.01) {
          k.orb(lift, 2.2 + 0.4 * heat, { ...COAL, core: heat > 0.7 ? PALETTE.core : COAL.core, alpha: a, glow: 0.4 + heat, bias: 1, turn: k.now });
          k.glow(lift, 3 + 4 * heat, 0.4 + 0.5 * heat * a);
          k.light(lift, 1.2 + 1.5 * heat, (0.3 + 0.5 * heat) * a);
          // The breath fans it: sparks blown off it as each one lands.
          if (pulse > 0.5) k.emit(lift, 40 * pulse, { kind: 'spark', colour: [GOLD, PALETTE.core], size: 1.2, life: [0.15, 0.35], speed: [0.2, 0.6], up: [6, 20], heading: k.toward(k.caster, k.target), cone: 2, gravity: 10, over: true });
          handFlame(k, { ...lift, z: lift.z + 1.5 }, 3.5 * pulse, 1.4, 1.5, a * pulse);
        }
      },
      release: (k) => {
        const at = k.hand(1);
        // Shut in the fist: the heat squeezed out between the fingers in a puff of sparks.
        k.burst(at, 16, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.4, life: [0.15, 0.35], speed: [0.3, 0.8], up: [2, 16], gravity: 30, over: true });
        k.burst(at, 4, { kind: 'mist', colour: SMOKE, size: 1.8, life: [0.4, 0.7], speed: [0.02, 0.1], up: [6, 12] });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          // The fist glowing through: the coal banked in it, as hot as the breaths made it, settling to its keep.
          const at = k.hand(1);
          k.glow(at, 10 * (1 - 0.5 * u), 0.8 * (1 - u), PALETTE.light);
          k.flare(at, 6 * (1 - u), flashOf(u), PALETTE.core, u * 2);
          handFlame(k, { ...at, z: at.z + 0.8 }, 3.2 * (1 - smooth(u)), 1.3, 1.6 - u, 1);
          k.light(at, 1.6, 0.5 * (1 - u));
        },
      },
      linger: {
        on: 'caster',
        draw: (k, age, left) => {
          // Banked in the fist: a coal glowing through the fingers, and a small tongue standing off it that swells and
          // sinks on a slow beat -- heat kept for the next fire, breathing. It gutters only as the last seconds go.
          const a = smooth(age / 0.5) * smooth(left / 1.5);
          const gutter = left < 5 ? 0.6 + 0.4 * Math.abs(Math.sin(age * 9)) : 1;
          const at = k.hand(1);
          const coal = { ...at, z: at.z + 0.6 };
          const beat = 0.5 + 0.5 * Math.sin((age / 3) * TAU - Math.PI / 2);
          k.orb(coal, 1.5, { ...COAL, core: PALETTE.accent, alpha: a, glow: 0.6 * gutter, bias: 1, turn: age * 0.7 });
          handFlame(k, { ...coal, z: coal.z + 0.6 }, (0.9 + 1.5 * beat) * gutter, 0.9, 1 + 0.5 * beat, a);
          if (!k.fast) k.emit(coal, (0.8 + 2 * beat) * a, { kind: 'ember', size: 1.1, life: [0.4, 0.8], speed: [0.02, 0.06], up: [6, 12], gravity: -2, over: true });
          k.light(coal, 1, (0.16 + 0.12 * beat) * a * gutter);
        },
      },
    },
  },

  /*
   * Firebrand (buff, on self, lasts 30 s): every burn the caster starts lasts twice as long, for 30 s. An hourglass
   * written in the air in fire and pressed into the raised left forearm; the brand burns on the arm, and the hourglass
   * stands at the shoulder and runs down for exactly its thirty seconds.
   */
  kindler_firebrand: {
    palette: PALETTE,
    cast: { timing: { secs: 1.3, release: 0.6 }, pose: firebrandPose },
    fx: {
      charge: (k, t) => {
        const finger = k.hand(1);
        kindle(k, finger, seg(t, 0, BRAND_WRITE[0] + 0.05), 1.3);
        const [w0, w1] = BRAND_WRITE;
        const drawn = seg(t, w0, w1) * BRAND_SEGS;
        if (drawn <= 0) return;
        // Written square to the viewer through the points the hand is put on (`brandPoint`), then pressed into the
        // forearm and shrinking onto it.
        const press = smooth(seg(t, w1 + 0.04, 0.6));
        const arm = mid3(k.joint(k.caster, 'elbow0', [0, 0, 0]), k.hand(0), 0.6);
        const a = 1 - seg(t, 0.58, 0.62);
        const on = (u: number): P3 => {
          const [x, y, up] = brandPoint(k.caster.facing, u);
          return mid3(k.local(k.caster, x, y, up), arm, press * 0.85);
        };
        const end = Math.min(BRAND_SEGS, drawn), whole = Math.floor(end);
        const pts: P3[] = [];
        for (let j = 0; j <= whole; j++) pts.push(on(j));
        if (end > whole) pts.push(on(end));
        const xs = pts.map((q) => k.sx(q)), ys = pts.map((q) => k.sy(q));
        // The whole glass there faintly from the first stroke, written over: an hourglass at every moment of it.
        const guide: Array<[number, number]> = [];
        for (let j = 0; j <= BRAND_SEGS; j++) {
          const q = on(j);
          guide.push([k.sx(q), k.sy(q)]);
        }
        const c = mid3(on(1), on(4), 0.5);
        const z = k.zoom;
        k.worldDraw(c, (g) => {
          g.lineJoin = 'round';
          g.lineCap = 'round';
          g.globalAlpha = clamp(a * 0.3 * (1 - press));
          g.beginPath();
          guide.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.strokeStyle = PALETTE.main;
          g.lineWidth = 1.2 * z;
          g.stroke();
          g.globalAlpha = clamp(a);
          g.beginPath();
          g.moveTo(xs[0], ys[0]);
          for (let j = 1; j < xs.length; j++) g.lineTo(xs[j], ys[j]);
          g.strokeStyle = PALETTE.ink;
          g.lineWidth = 3.4 * z;
          g.stroke();
          g.strokeStyle = PALETTE.main;
          g.lineWidth = 2.2 * z;
          g.stroke();
          g.strokeStyle = PALETTE.core;
          g.lineWidth = 0.9 * z;
          g.stroke();
        }, 8);
        // Its light where it is written, a spot at each corner and the hottest at the writing point -- not a wash over
        // the caster.
        glowSpots(k, pts, 4, 0.5 * a);
        if (t < w1) k.glow(pts[pts.length - 1], 5, 0.9);
        if (t < w1) k.emit(finger, 30, { kind: 'ember', size: 1.2, life: [0.2, 0.5], speed: [0.02, 0.1], up: [-6, 4], gravity: 20, over: true });
        k.light(c, 1.4, 0.4 * a);
      },
      release: (k) => {
        // Pressed in: it sizzles on the skin, a few sparks spat off and a curl of smoke.
        const arm = mid3(k.joint(k.caster, 'elbow0', [0, 0, 0]), k.hand(0), 0.55);
        k.burst(arm, 10, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.2, life: [0.12, 0.3], speed: [0.2, 0.6], up: [4, 14], gravity: 40, over: true });
        // Low and drifting off ahead, away from the face.
        k.burst(arm, 6, { kind: 'mist', colour: SMOKE, size: 1.2, sizeEnd: 2.8, life: [0.6, 1.1], speed: [0.04, 0.1], up: [3, 6], heading: k.facingDir(k.caster), cone: 0.8, gravity: -1 });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          // The brand taking on the skin: the glass white-hot as it goes in, cooling to the brand's own orange.
          const elbow = k.joint(k.caster, 'elbow0', [0, 0, 0]), wrist = k.hand(0);
          brandMark(k, elbow, wrist, 2 - smooth(u), 1);
          if (u < 0.6) k.emit(mid3(elbow, wrist, 0.55), 12 * (1 - u), { kind: 'mist', colour: SMOKE, size: 1.1, sizeEnd: 2.6, life: [0.5, 0.9], speed: [0.03, 0.08], up: [3, 6], heading: k.facingDir(k.caster), cone: 0.8, gravity: -1 });
          k.light(wrist, 1.4, 0.4 * (1 - u));
        },
      },
      linger: {
        on: 'caster',
        draw: (k, age, left) => {
          const a = smooth(age / 0.5) * smooth(left / 0.8);
          const share = left / Math.max(0.01, age + left);
          // The brand on the forearm: the small glass burnt into it, glowing.
          const elbow = k.joint(k.caster, 'elbow0', [0, 0, 0]), wrist = k.hand(0);
          brandMark(k, elbow, wrist, 1 + 0.15 * Math.sin(age * 4), a);
          k.glow(mid3(elbow, wrist, 0.55), 4, 0.35 * a);
          // The hourglass over the left shoulder, running down for as long as the brand holds.
          const at = k.local(k.caster, -6, 0, k.caster.tall + 3.5);
          hourglass(k, at, 4.2, share, 0.95 * a, age * 0.8);
          if (!k.fast) k.emit({ ...at, z: at.z - 0.5 }, 2.5 * a, { kind: 'ember', size: 1, life: [0.3, 0.5], speed: [0, 0.02], up: [-6, -3], gravity: 0, jitter: 0.01, over: true });
          k.light(k.caster, 1.2, 0.18 * a);
        },
      },
    },
  },


  /*
   * Immolate (bolt, on enemy, lasts 15 s): a burn of 2% a second for 15 s, and nothing at once. No missile: the left
   * hand points, the ground under the creature heats -- cracks glowing, smoke from its feet -- and as the right hand closes
   * the fire comes up out of the ground round it and climbs it, then burns on it for its fifteen seconds.
   */
  kindler_immolate: {
    palette: PALETTE,
    cast: { timing: { secs: 1.1, release: 0.55 }, pose: immolatePose },
    fx: {
      charge: (k, t) => {
        const hand = k.hand(1);
        kindle(k, hand, seg(t, 0, 0.25), 1.4);
        const g = smooth(seg(t, 0.18, 0.55));
        handFlame(k, { ...hand, z: hand.z + 0.8 }, 3 * g, 1.4, 1, (1 - seg(t, 0.52, 0.56)) * g);
        // The ground under it heating: cracks running out from under its feet and glowing up, smoke beginning to rise; from
        // the release the impact has the ground.
        const b = k.target;
        const R = footOf(b);
        const live = k.released < 0 ? 1 : 0;
        cracks(k, b, R * 1.15, 6, g, 0.95 * live, 91);
        k.disc(b, R * 0.9, { main: PALETTE.deep, alpha: 0.35 * g * live });
        k.emit(k.at(b, 0.05), 14 * g * live, { kind: 'mist', colour: SMOKE, size: 1.6, sizeEnd: 4, life: [0.5, 0.9], speed: [0.02, 0.1], up: [6, 12], jitter: R * 0.8 });
        k.emit(k.at(b, 0.05), 16 * g * live, { kind: 'ember', size: 1.2, life: [0.3, 0.6], speed: [0.02, 0.1], up: [8, 18], gravity: 0, jitter: R * 0.8 });
        k.light(b, 1.5, 0.4 * g * live);
      },
      hit: (k) => {
        const b = k.target;
        // A few sparks kicked up off the ground as it goes up, low, so the creature shows through them.
        k.burst(k.at(b, 0.1), 20, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.5, life: [0.3, 0.6], speed: [0.1, 0.5], up: [10, 30], gravity: 40, jitter: b.wide / 40, over: true });
        k.burst(k.at(b, 0.5), 8, { kind: 'mist', colour: SMOKE, size: 2.4, sizeEnd: 5, life: [0.6, 1.1], speed: [0.05, 0.3], up: [10, 18] });
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const b = k.target;
          const R = footOf(b);
          // A wall of flame up out of the ground all round it, climbing past its head, then sinking onto it as its burn.
          const rise = easeOut(seg(u, 0, 0.25)) * (1 - smooth(seg(u, 0.4, 1)));
          // One body of flame, its foot unbroken round it, sinking onto it as a whole rather than shrinking into tongues.
          // It closes in on the body as it sinks, so it goes down onto it as its burn, not out as a hoop on the ground.
          const close = smooth(seg(u, 0.3, 0.9));
          fireWall(k, b, R * (0.85 - 0.45 * close), { h: (b.tall * 0.9 + 3) * rise, front: 0.45, heat: 1.6 - 0.9 * smooth(u), arcs: 4, spacing: 0.12, alpha: 1 - seg(u, 0.65, 0.9), glow: 0.7 });
          cracks(k, b, R * 1.15, 6, 1, 0.95 * (1 - smooth(u)), 91);
          k.light(b, 2, 0.9 * (1 - u * 0.6), WARM);
        },
      },
      linger: {
        on: 'target',
        secs: burnSecs('kindler_immolate'),
        draw: (k, age, left) => {
          burnLinger(k, age, left);
          // The ground it was lit from stays scorched under it for the first few seconds.
          const b = k.target;
          k.scorch(b, footOf(b) * 0.7, { alpha: 0.25 * (1 - seg(age, 2, 5)) });
        },
      },
    },
  },

  /*
   * Combust (bolt, on enemy): a burning creature takes at once 150% of what its burn had left, and stops burning. The
   * right hand reaches out and takes hold of the burn -- embers drawn in off it, a taut line of heat to the hand, its fire
   * squeezed in -- and as the fist closes and is yanked back, its fire is sucked into its heart and it goes off from
   * within: its outline ringed white-hot and thrown out, a ring of smoke, and then nothing burning on it.
   */
  kindler_combust: {
    palette: PALETTE,
    cast: { timing: { secs: 0.85, release: 0.5 }, pose: combustPose },
    fx: {
      charge: (k, t) => {
        const hand = k.hand(1), b = k.target, heart = k.heart(b);
        kindle(k, hand, seg(t, 0, 0.25), 1.4);
        const grip = smooth(seg(t, 0.2, 0.48));
        // The burn it goes up from (the island casts Combust only on a burning creature): on it till the grip takes it,
        // shrinking into the hold, its fire pulled in.
        if (t < 0.5 && !burntAlready(k, b)) burnOn(k, b, t * 0.85, burnPower(0.02), 1 - 0.85 * grip, 1 - 0.5 * grip);
        if (grip > 0.01 && t < 0.5) {
          // The hold: a taut, trembling line of heat from the open hand into it.
          k.bolt(hand, heart, { width: 0.7 + 0.6 * grip, jag: 3 * (1 - grip) + 1.2, kinks: 6, fork: 0, alpha: 0.85 * grip, main: PALETTE.main, core: PALETTE.core, glow: 0.35 });
          // Its fire drawn in on itself: embers pulled in from round it, a rim of heat tightening round it (a rim only:
          // filled, orange over grass went olive).
          drawIn(k, k.at(b, 0.3), 0.9, k.fast ? 3 : 6, 10 * grip, k.now * 2, 0.35, 6);
          // Its fire drawn in: tongues on it leaning in toward its heart, tighter as the grip closes.
          popTongues(k, b, 3 * grip, -0.5 * grip, 1.2, 0.8 * grip);
          k.glow(heart, 6 + 10 * grip, 0.7 * grip, PALETTE.accent);
          k.light(b, 1.6, 0.6 * grip);
        }
      },
      impact: {
        secs: 1.0,
        draw: (k, u) => {
          const b = k.target, at = k.heart(b);
          // In, then out. First the burn's own tongues sucked in off the body into its heart, leaning in as they go.
          const suck = seg(u, 0, 0.16);
          if (suck < 1) {
            const fl: Flame[] = [], R = footOf(b) * 0.9 * (1 - easeIn(suck));
            for (let i = 0; i < 6; i++) {
              const ang = (i / 6) * TAU + k.seed;
              const base = k.on(b.x + Math.cos(ang) * R, b.y + Math.sin(ang) * R, b.tall * (0.35 + 0.3 * suck));
              const f = upright(k, base, 4 * (1 - suck) * (1 - 0.5 * suck), 1.1, 1.4 + suck * 0.6, 0, sway(k.now, i));
              // Leaning in toward the heart on the screen.
              // By a third of the way, and shorter as they go: they shrink into it rather than cross it.
              f.tx += (k.sx(at) - f.bx) * 0.35;
              f.ty += (k.sy(at) - f.by) * 0.2;
              fl.push(f);
            }
            flameGroup(k, k.on(b.x, b.y), fl, 1, 3);
            k.glow(at, 6 + 10 * suck, 0.5 + 0.5 * suck, PALETTE.accent);
          }
          // Then it goes off from within: the creature's outline ringed white-hot for a breath and thrown outward, the
          // heart lit through it, a small hard star -- the creature seen through all of it.
          const v = seg(u, 0.14, 0.5);
          if (v > 0 && v < 1) {
            if (k.state.pop === undefined) {
              k.state.pop = 1;
              k.burst(at, 50, { kind: 'spark', colour: [PALETTE.core, GOLD, PALETTE.main], size: 1.8, life: [0.25, 0.55], speed: [1.5, 3.5], up: [0, 30], gravity: 40, drag: 0.08, over: true });
              k.burst(at, 14, { kind: 'ember', size: 2, life: [0.5, 1], speed: [0.4, 1.2], up: [10, 30], gravity: 14 });
              // The smoke ring: thrown flat out round it.
              k.burst(k.at(b, 0.35), 18, { kind: 'mist', colour: SMOKE, size: 2.6, sizeEnd: 6, life: [0.7, 1.2], speed: [1.2, 1.8], up: [0, 3], gravity: -2, drag: 0.08 });
            }
            const out = easeOut(v);
            // Its own fire bursting out of it: short tongues thrown outward off its body all round, white to orange,
            // the creature seen between them.
            popTongues(k, b, 4.5 * (1 - 0.6 * out) * (1 - smooth(seg(v, 0.5, 1))), 0.6 + 0.6 * out, cooling(v * 0.5), 1);
            k.glow(at, 9 * (1 - 0.5 * v), 0.4 * (1 - v), PALETTE.core);
            starburst(k, at, k.fast ? 5 : 7, 8 * (0.4 + 0.6 * out), 1.3, cooling(v), 0.5 * (1 - smooth(v)), k.seed);
          }
          k.light(b, 2.4, u < 0.14 ? 0.5 + 3 * u : 1 - u, WARM);
          // What is left: a thin column of smoke going up off it, not a flame on it.
          if (u > 0.35) k.emit(k.at(b, 0.7), 14 * (1 - u), { kind: 'mist', colour: SMOKE, size: 2, sizeEnd: 5, life: [0.8, 1.3], speed: [0.02, 0.08], up: [12, 18], gravity: -2 });
        },
      },
    },
  },


  /*
   * Blaze Aura (nova, on self, 2 tiles round, lasts 15 s): fire at 30% a second on every enemy within 2 tiles, for 15 s.
   * The body turns right round with the arms out low and lays a ring of fire on the ground at exactly its two tiles; it
   * stands up into a low wall of tongues that turns slowly round the caster wherever they go, for its fifteen seconds.
   */
  kindler_blaze_aura: {
    palette: PALETTE,
    cast: { timing: { secs: 1.2, release: AURA_LET }, pose: blazeAuraPose },
    fx: {
      charge: (k, t) => {
        const R = k.fx.reach ?? 2;
        kindle(k, k.hand(1), seg(t, 0, 0.2), 1.3);
        // From the release the ring is the impact's, risen out of this one at the same height.
        if (k.released >= 0) return;
        // The ring laid on the ground by the hands themselves: each hand, out low, lays fire on the ground under where
        // it points as the body turns, from where it started; between them they go right round by the release.
        let laid = 0;
        for (let side = 0; side < 2; side++) {
          const h = k.hand(side), st = k.state;
          const ang = Math.atan2(h.y - k.caster.y, h.x - k.caster.x);
          const s0 = `a${side}`, s1 = `b${side}`, last = `l${side}`;
          if (t < AURA_OPEN) {
            delete st[s0];
            continue;
          }
          if (st[s0] === undefined) {
            st[s0] = ang;
            st[s1] = ang;
          } else {
            let d = ang - st[last];
            if (d > Math.PI) d -= TAU;
            if (d < -Math.PI) d += TAU;
            st[s1] += d;
          }
          st[last] = ang;
          // The two hands start half a turn apart: by the release each has run at least its half, so the ring is whole
          // when the impact stands it up, however little the body could turn (on the move, the hips stay the walk's).
          const close = smooth(seg(t, 0.36, AURA_LET)), dir = st[s1] >= st[s0] ? 1 : -1;
          const end = st[s0] + dir * Math.max(Math.abs(st[s1] - st[s0]), close * Math.PI * 1.08);
          const from = Math.min(st[s0], end), span = Math.min(TAU, Math.abs(end - st[s0]));
          laid += span / TAU;
          if (span < 0.05) continue;
          fireWall(k, k.caster, R, { h: AURA_H * 0.6, from, span, heat: 1.4, arcs: 3, front: 0.75, glow: 0.6 });
          emberBed(k, k.caster, R, 0.9, { from, span });
          // Fire running off the ground at the end being laid.
          k.emit(k.on(k.caster.x + Math.cos(end) * R, k.caster.y + Math.sin(end) * R, 1), 40, { kind: 'ember', size: 1.4, life: [0.2, 0.5], speed: [0.1, 0.4], up: [8, 20], gravity: 10, over: true });
        }
        k.light(k.caster, R + 0.5, 0.5 * Math.min(1, laid), WARM);
      },
      hit: (k) => {
        const R = k.fx.reach ?? 2;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + k.seed;
          k.burst(k.on(k.caster.x + Math.cos(a) * R, k.caster.y + Math.sin(a) * R, 2), 10, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.5, life: [0.3, 0.6], speed: [0.1, 0.4], up: [20, 40], gravity: 40, over: true });
        }
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const R = k.fx.reach ?? 2;
          // It stands up: out of the laid ring, at its height, up tall and white for a beat, then down to the aura's
          // own height, its heat and its bed easing into the linger's.
          const h = u < 0.2 ? lerp(AURA_H * 0.6, AURA_H * 2.2, easeOut(u / 0.2)) : lerp(AURA_H * 2.2, AURA_H, smooth((u - 0.2) / 0.8));
          fireWall(k, k.caster, R, { h, heat: lerp(1.6, 1, smooth(u)), turn: k.now * AURA_TURN, front: 0.75, crest: k.now * AURA_TURN * 4 * smooth(u), arcs: 6 });
          emberBed(k, k.caster, R, 0.9);
          k.light(k.caster, R + 0.5, lerp(0.9, 0.5, smooth(u)), WARM);
        },
      },
      linger: {
        on: 'caster',
        draw: (k, age, left) => {
          const R = k.fx.reach ?? 2;
          if (age < 0.6) return;
          const a = smooth(left / 0.8);
          const share = left / Math.max(0.01, age + left);
          // A low wall of fire standing at exactly its reach and turning with the caster -- a run of taller flame going
          // round it -- lower as its seconds run out.
          fireWall(k, k.caster, R, { h: AURA_H * (0.6 + 0.4 * share) * a, heat: 1, turn: k.now * AURA_TURN, alpha: a, crest: k.now * AURA_TURN * 4, front: 0.75, arcs: 6 });
          emberBed(k, k.caster, R, 0.9 * a, { hot: 0.6 + 0.4 * share });
          // Its fire on whatever stands in it, a round a second: a lick of flame up each one.
          const round = age - 0.6, lick = round - Math.floor(round);
          if (lick < 0.5) {
            // A fire up each: one record a creature for the first few, sorted with it; any more share one.
            let i = 0;
            const rest: Flame[] = [];
            const h = 5 * easeOut(lick * 5) * (1 - smooth(seg(lick, 0.15, 0.5)));
            for (const b of k.enemiesWithin(R, k.caster)) {
              const fl = i < 4 ? [] as Flame[] : rest;
              fireCluster(k, k.at(b, 0.5), h, cooling(lick * 2) * 0.7 + 0.3, i, fl, 1.6);
              if (i < 4) flameGroup(k, k.on(b.x, b.y), fl, a, 3);
              k.glow(k.heart(b), 6 + h, 0.5 * a * (1 - seg(lick, 0.25, 0.5)));
              i++;
            }
            flameGroup(k, k.caster, rest, a, 3);
          }
          k.emit(k.at(k.caster, 0.05), 10 * a, { kind: 'ember', size: 1.3, life: [0.5, 1], speed: [0.05, 0.2], up: [10, 20], gravity: -2, jitter: R * 0.9, over: true });
          k.light(k.caster, R + 0.5, 0.5 * a, WARM);
        },
      },
    },
  },

  /*
   * Inferno Bolt (bolt, on enemy, lasts 10 s): fire at 300% and a burn of 3% a second for 10 s. The great bolt: a ball of
   * fire gathered between both hands at the hip, driven out in a lunge, heavy and trailing smoke; it bursts up through the
   * creature in a column of fire with a cap rolling off it, splashes along the ground, and leaves it burning as hard as
   * a Kindler can for its ten seconds.
   */
  kindler_inferno_bolt: {
    palette: PALETTE,
    cast: { timing: { secs: 1.5, release: 0.55 }, pose: infernoPose },
    fx: {
      charge: (k, t) => {
        const mid = mid3(k.hand(0), k.hand(1), 0.5);
        kindle(k, mid, seg(t, 0, 0.2), 1.6);
        const g = smooth(seg(t, 0.12, 0.52));
        if (g > 0.01 && t < 0.56) {
          // The ball swelling between the palms, tongues licking off it, heat pulled into it.
          fireball(k, mid, { ...mid, z: mid.z - 1 }, 1.5 + 3.6 * g, 1.6 + 0.6 * Math.sin(k.now * 9));
          k.light(mid, 1.5 + 2 * g, 0.4 + 0.5 * g);
          drawIn(k, mid, 0.7, k.fast ? 2 : 4, 12 * g, k.now * 3, 0.3, 0);
        }
      },
      release: (k) => {
        const mid = mid3(k.hand(0), k.hand(1), 0.5);
        k.burst(mid, 24, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.8, life: [0.15, 0.35], speed: [0.8, 2], up: [0, 12], heading: k.toward(k.caster, k.target), cone: 1.4, gravity: 20 });
        k.burst(mid, 3, { kind: 'mist', colour: SMOKE, size: 2.5, life: [0.4, 0.7], speed: [0.1, 0.4], up: [6, 12] });
      },
      travel: {
        secs: (tiles) => 0.12 + tiles * 0.065,
        draw: (k, u) => {
          // The great bolt: a ball as big as a head with its fire streaming five times its width behind it, a second,
          // smaller ball of it torn off and following, and a trail of smoke.
          const from = mid3(k.hand(0), k.hand(1), 0.5), to = k.heart(k.target), lift = k.dist * 0.5;
          const head = arcAt(from, to, u, lift), back = arcAt(from, to, Math.max(0, u - 0.06), lift);
          const second = Math.max(0, u - 0.04);
          if (second > 0.02) fireball(k, arcAt(from, to, second, lift), arcAt(from, to, Math.max(0, second - 0.06), lift), 3.2, 3);
          fireball(k, head, back, 6.5, 5);
          k.light(head, 2.2, 0.85, WARM);
          k.emit(head, 50, { kind: 'ember', colour: [GOLD, PALETTE.main], size: 1.8, life: [0.25, 0.5], speed: [0.05, 0.3], up: [-4, 8], gravity: 4, jitter: 0.06, over: true });
          // A plume of smoke off the ball itself, one continuous soft trail rather than a row of puffs.
          k.emit(head, 40, { kind: 'mist', colour: SMOKE, size: 2, sizeEnd: 5, life: [0.4, 0.7], speed: [0.01, 0.05], up: [2, 6], gravity: -3, jitter: 0.03 });
        },
      },
      hit: (k) => {
        const b = k.target, at = k.heart(b);
        k.burst(at, 60, { kind: 'spark', colour: [PALETTE.core, GOLD, PALETTE.main], size: 2, life: [0.3, 0.7], speed: [1.2, 3.2], up: [0, 40], gravity: 50, drag: 0.08, over: true });
        k.burst(k.at(b, 0.05), 24, { kind: 'dust', colour: [DIRT, ASH], size: 3.5, sizeEnd: 7, life: [0.5, 0.9], speed: [0.6, 1.4], up: [2, 8], gravity: 3, drag: 0.15 });
        k.burst(k.at(b, 1), 14, { kind: 'mist', colour: SMOKE, size: 4, sizeEnd: 8, life: [0.8, 1.4], speed: [0.2, 0.5], up: [14, 24], gravity: -3 });
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const b = k.target;
          // It bursts up and out, not as a star: a column of fire up through the creature and over its head, a cap of
          // flame rolling out from the top of it and falling, and fire splashed out along the ground from its feet.
          const rise = easeOut(seg(u, 0, 0.2)), fall = 1 - smooth(seg(u, 0.25, 0.85));
          const top = b.tall + 4 + 10 * rise;
          const col: Flame[] = [];
          // Narrow, so the creature shows through either side of it: a tall tongue, two lower ones off it.
          const H = k.hpx(top * fall), fx = k.sx(k.on(b.x, b.y, 0.3)), fy = k.sy(k.on(b.x, b.y, 0.3));
          if (H > 1) {
            col.push({ bx: fx, by: fy, tx: fx + 0.05 * H * Math.sin(k.now * 9), ty: fy - H, w: 0.14 * H, heat: cooling(u * 1.2), wob: sway(k.now, 1) });
            for (const q of [-1, 1]) col.push({ bx: fx + q * 0.08 * H, by: fy, tx: fx + q * 0.2 * H, ty: fy - 0.5 * H, w: 0.09 * H, heat: cooling(u * 1.2) - 0.4, wob: sway(k.now, 2 + q) });
          }
          flameGroup(k, k.on(b.x, b.y), col, 1, 4);
          // The cap: a mushroom of flame on the column's head. A broad dome of fire licking up over the top, and round
          // its rim the fire rolling over and hanging down and out, of mixed lengths, white to orange. The dome is what
          // makes it one head: rim tongues alone, on a thin stalk, read as a palm or a flower.
          const capH = k.hpx(3 + 4 * rise) * fall;
          if (capH > 1.5) {
            const cx = k.sx(k.on(b.x, b.y, top * fall)), cy = k.sy(k.on(b.x, b.y, top * fall)) + capH * 0.2;
            const cap: Flame[] = [];
            const n = k.fast ? 4 : 6, roll = smooth(seg(u, 0.05, 0.35));
            for (let i = 0; i < n; i++) {
              const ang = (i / n) * TAU + k.seed;
              const ox = Math.cos(ang), oy = Math.sin(ang) * 0.5;
              const l = capH * (0.6 + 0.4 * hashOf(k.seed + 71, i));
              const bx = cx + ox * capH * 0.75, by = cy + oy * capH * 0.75 - capH * 0.3;
              cap.push({ bx, by, tx: bx + ox * l * 0.6, ty: by + oy * l * 0.3 + l * lerp(0, 0.75, roll), w: l * 0.3, heat: cooling(u * 1.1) - 0.4, wob: sway(k.now, i) });
            }
            // The dome last, over the rim's roots.
            cap.push({ bx: cx, by: cy, tx: cx + 0.08 * capH * Math.sin(k.now * 8), ty: cy - capH * 1.3, w: capH * 0.85, heat: cooling(u * 1.1), wob: sway(k.now, 9) });
            flameGroup(k, k.on(b.x, b.y), cap, 1 - seg(u, 0.75, 1), 5);
          }
          // The splash along the ground: low fire thrown out flat from its feet in a ring.
          fireWall(k, b, 0.15 + 0.5 * easeOut(u), { h: 6 * (1 - smooth(seg(u, 0, 0.65))), lean: 0.9, heat: Math.min(1.6, cooling(u)), arcs: 4, front: 0.45, spacing: 0.1, glow: 0.6 });
          k.flare(k.heart(b), 8 * (1 - u), 0.6 * flashOf(u, 0.06), '#ffffff');
          k.light(b, 2.2, 1 - 0.6 * u, WARM);
        },
      },
      linger: {
        on: 'target',
        secs: burnSecs('kindler_inferno_bolt'),
        draw: (k, age, left) => {
          burnLinger(k, age, left);
          // The one scorch it leaves where it struck, darkening as the splash dies and gone in a few seconds.
          k.scorch(k.target, 0.35, { alpha: 0.28 * smooth(age * 2.5) * (1 - seg(age, 1.5, 4)) });
        },
      },
    },
  },

  /*
   * Meteor (bolt, on enemy, 3 tiles round): fire at 400% on the enemy and 150% on every other within 3 tiles of it. Both
   * arms flung up to the star kindling over the right shoulder and hauled down across the body: a red ring marks the
   * ground at exactly its three tiles while the star kindles high over it; the stone comes down out of the sky, burning,
   * and the ground goes up -- a shockwave and a wall of flame flung out to the ring's edge, the stone's pieces thrown,
   * and a crater left smouldering.
   */
  kindler_meteor: {
    palette: PALETTE,
    cast: { timing: { secs: 1.8, release: 0.5, blendOut: 0.18 }, pose: meteorPose },
    fx: {
      charge: (k, t) => {
        const W = k.fx.wide ?? 3;
        kindle(k, mid3(k.hand(0), k.hand(1), 0.5), seg(t, 0.05, 0.3), 1.6);
        // All of this is the warning, and goes as the stone leaves the star: the travel draws its own mark, hotter.
        const live = 1 - seg(k.released, 0, 0.06);
        if (live <= 0.01) return;
        // Where it will fall, marked at exactly its reach: drawn on as the arms go up.
        meteorMark(k, W, seg(t, 0.12, 0.48), 0, live);
        // And the star over the right shoulder, where the hands reach for it, kindling.
        const star = skyOf(k);
        const s = smooth(seg(t, 0.15, 0.45)) * live;
        k.flare(star, 4 + 10 * s, s, PALETTE.core, k.now);
        k.glow(star, 10 + 14 * s, 0.6 * s);
        // Its light is the travel's from the release, which asks for two of its own -- and the frame the release comes
        // in draws this before it, so it goes a beat early.
        if (k.released < 0 && t < (k.timing?.release ?? 0.5) - 0.03) k.light(k.spot, 2.4, 0.35 * s, WARM);
      },
      travel: {
        secs: () => 0.6,
        draw: (k, u) => {
          const W = k.fx.wide ?? 3;
          const star = skyOf(k), to = k.on(k.spot.x, k.spot.y, 2);
          // Falling faster and faster; the tail the length of the way it came this last tenth of a second.
          const v = easeIn(u) * 0.85 + u * 0.15;
          const head = mid3(star, to, v), back = mid3(star, to, Math.max(0, v - 0.1));
          fireball(k, head, back, 8, 5.5, true);
          k.light(head, 3, 0.9);
          k.light(k.spot, 2.4, 0.35 + 0.5 * u, WARM);
          k.emit(back, 40, { kind: 'mist', colour: SMOKE, size: 3, sizeEnd: 7, life: [0.5, 1], speed: [0.02, 0.1], up: [0, 4], gravity: -2, jitter: 0.1, jitterZ: 3 });
          k.emit(head, 50, { kind: 'ember', size: 1.8, life: [0.2, 0.45], speed: [0.1, 0.4], up: [0, 10], gravity: 10, jitter: 0.05, over: true });
          // The ground under it brightening as it comes.
          meteorMark(k, W, 1, u, 1);
        },
      },
      hit: (k) => {
        const W = k.fx.wide ?? 3;
        const at = k.on(k.spot.x, k.spot.y, 3);
        // Where it fell, for the crater: the creature it fell on may run, or die of it.
        k.state.x = k.spot.x;
        k.state.y = k.spot.y;
        mark(k, 'm', k.spot, W, 8);
        k.flash(0.22, PALETTE.core);
        k.burst(at, 90, { kind: 'spark', colour: [PALETTE.core, GOLD, PALETTE.main], size: 2.2, life: [0.4, 0.8], speed: [W * 1.2, W * 3], up: [10, 60], gravity: 60, drag: 0.1, over: true });
        k.burst(at, 30, { kind: 'ember', size: 2.2, life: [0.8, 1.6], speed: [0.5, W], up: [20, 50], gravity: 20, over: true });
        k.burst(at, 30, { kind: 'dust', colour: [DIRT, ASH], size: 4, sizeEnd: 9, life: [0.6, 1.2], speed: [W * 0.8, W * 1.6], up: [2, 10], gravity: 3, drag: 0.1 });
        k.burst(at, 16, { kind: 'shard', colour: [ROCK.main, ROCK.deep, PALETTE.deep], size: 2.2, life: [0.6, 1], speed: [0.8, W * 1.2], up: [30, 60], gravity: 90, spin: 2, bias: 2 });
      },
      impact: {
        secs: METEOR_BLAST,
        draw: (k, u) => {
          const W = k.fx.wide ?? 3;
          const c = k.on(k.state.x ?? k.spot.x, k.state.y ?? k.spot.y);
          // The shockwave and the fire riding it, out to exactly its reach and no further: a pale line of thrown dust
          // just ahead, and behind it a wall of flame flung outward off the blast, leaning away from where it struck.
          const wave = easeOut(seg(u, 0, 0.55));
          const r = 0.3 + (W - 0.3) * wave;
          k.ring(c, Math.min(W, r + 0.12), { band: 0.05, alpha: 0.8 * (1 - seg(u, 0.4, 0.6)), glow: 0, main: '#e8dcc4', deep: DIRT, ink: ASH });
          fireWall(k, c, r, { h: 18 * (1 - 0.55 * wave) * (1 - seg(u, 0.5, 0.95)), lean: 0.55, heat: cooling(wave * 0.8), alpha: 1 - seg(u, 0.85, 1), spacing: 0.15, arcs: 4 });
          // The column where it struck, taller than a man: one roaring body of fire, white only at its heart -- a great
          // tongue up the middle, a ring of broad ones close round its foot -- and the crater glowing under it.
          const col = 1 - seg(u, 0, 0.45), H = 60 * col * easeOut(u * 8);
          if (H > 1) {
            const fl: Flame[] = [];
            const foot = k.on(c.x, c.y, 0.3);
            fl.push(upright(k, foot, H, 9, cooling(u * 2), 0.05 * Math.sin(k.now * 7), sway(k.now, 1)));
            for (let i = 0; i < 6; i++) {
              const ang = (i / 6) * TAU + k.seed;
              const f = upright(k, k.on(c.x + Math.cos(ang) * 0.22, c.y + Math.sin(ang) * 0.22, 0.3), H * (0.45 + 0.25 * hashOf(k.seed + 7, i)) * flick(k.now, i), 6, cooling(u * 2) - 0.6, 0, sway(k.now, i + 2));
              f.tx += (f.bx - k.sx(foot)) * 0.6;
              fl.push(f);
            }
            flameGroup(k, foot, fl, col, 2);
            k.glow({ ...foot, z: foot.z + H * 0.4 }, 14 + H * 0.3, 0.6 * col);
          }
          crater(k, c, 0, smooth(seg(u, 0.1, 0.5)));
          rocks(k, c, 0.95, easeOut(seg(u, 0.05, 0.3)), 1.6 - u);
          k.ring(c, W, { band: 0.08, alpha: 0.8 * (1 - u), glow: 0.6, main: PALETTE.deep, deep: PALETTE.ink });
          k.light(c, W + 0.5, 1 - 0.4 * u, WARM);
          // Every other creature within it, struck as the wave of fire reaches it.
          const near = marked(k, 'm', c, W * 2);
          for (const [i, b] of near) {
            if (b.who?.kind === 'creature' && k.target.who?.kind === 'creature' && b.who.id === k.target.who.id) continue;
            const at = reachedAt(Math.hypot(b.x - c.x, b.y - c.y), 0.3, W) * 0.55, v = seg(u, at, at + 0.4);
            if (v <= 0 || v >= 1) continue;
            alight(k, b, 7 * (1 - smooth(v)), cooling(v * 0.7), 1, i);
          }
        },
      },
      linger: {
        // The crater's own, not a number of the spell's: long enough to be seen cooling, no longer.
        secs: METEOR_BLAST + 4,
        on: 'spot',
        draw: (k, age, left) => {
          // The impact has the crater until it is done.
          if (age < METEOR_BLAST) return;
          const c = k.on(k.state.x ?? k.spot.x, k.state.y ?? k.spot.y);
          const a = smooth(left / 2);
          // The crater left: molten at the heart, cooling to coals, the stone's pieces round it going dark, a few
          // tongues on its lip, smoke going up.
          const cool = clamp((age - METEOR_BLAST) / 4);
          crater(k, c, cool, a);
          rocks(k, c, 0.95, 1, 0.6 * (1 - cool), a);
          // A few fires left burning on its lip, each where the stone's heat caught.
          const lip: Flame[] = [];
          for (let i = 0; i < (k.fast ? 2 : 4); i++) {
            const ang = hashOf(k.seed + 31, i) * TAU, d = 0.5 + 0.25 * hashOf(k.seed + 33, i);
            fireCluster(k, k.on(c.x + Math.cos(ang) * d, c.y + Math.sin(ang) * d, 0.2), (3 + 3 * hashOf(k.seed + 35, i)) * a * (1 - 0.6 * cool), 0.9 * (1 - 0.5 * cool), i * 3, lip);
          }
          flameGroup(k, c, lip, a, 2);
          k.emit(k.on(c.x, c.y, 2), 10 * a, { kind: 'mist', colour: SMOKE, size: 3, sizeEnd: 7, life: [1, 1.8], speed: [0.02, 0.1], up: [8, 14], gravity: -3, jitter: 0.6 });
          k.emit(k.on(c.x, c.y, 1), 8 * a * (1 - cool), { kind: 'ember', size: 1.4, life: [0.5, 1], speed: [0.05, 0.2], up: [8, 18], gravity: 0, jitter: 0.8, over: true });
          k.light(c, 1.6, 0.5 * a * (1 - 0.5 * cool), WARM);
        },
      },
    },
  },

  /*
   * Firestorm (nova, on self, 6 tiles round, lasts 10 s): fire at 100% on every enemy within 6 tiles and a burn of 2% a
   * second for 10 s on each. The ultimate: crouched with the fists over the heart while a vortex of embers spirals in
   * from exactly six tiles out; rising and flinging the arms wide, a wall of fire rolls out to the six tiles, and the
   * ground it crossed burns in patches for its ten seconds, the patches going out one by one.
   */
  kindler_firestorm: {
    palette: PALETTE,
    cast: { timing: { secs: 2.0, release: 0.55 }, pose: firestormPose },
    fx: {
      charge: (k, t) => {
        const R = k.fx.reach ?? 6;
        const c = k.caster;
        kindle(k, k.chest(), seg(t, 0.02, 0.25), 1.8);
        // The vortex: embers spiralling in from the edge of its reach, faster as it builds. The reach itself smoulders
        // -- a bed of coals at exactly its six tiles -- and catches in a run of flame going round it against the spiral.
        const g = smooth(seg(t, 0.08, 0.5));
        const ring = smooth(seg(t, 0.05, 0.25)) * (1 - seg(t, 0.56, 0.62));
        emberBed(k, c, R, 0.85 * ring, { hot: 0.4 + 0.6 * g });
        const run = -k.now * 1.4;
        fireWall(k, c, R, { h: (3 + 3 * g) * ring, from: run, span: 0.5 + 0.9 * g, heat: 1.1, arcs: 2, alpha: ring, glow: 0.6, ragged: 0.5 });
        drawIn(k, k.at(c, 0), R * (1 - 0.4 * g), k.fast ? 4 : 8, 6 + 10 * g, -k.now * (0.6 + 1.6 * g), 0.55 - 0.2 * g, 2 + 10 * g);
        // The storm's eye: a ring of low fire round the feet, turning with the vortex, wide and low enough that the
        // caster shows inside it.
        if (g > 0.05 && t < 0.58) flameRing(k, c, 0.55, { h: (2 + 4 * g) * (1 - seg(t, 0.54, 0.58)), w: 1.3, n: 10, heat: 1 + 0.6 * g, arcs: 3, turn: -k.now * 5, crest: -k.now * 9, front: 0.6, glow: 0.7 });
        k.glow(k.chest(), 8 + 14 * g, 0.6 * g);
        k.light(c, 2 + 2 * g, (0.4 + 0.4 * g) * (1 - seg(k.released, 0, 0.2)), WARM);
      },
      hit: (k) => {
        const R = k.fx.reach ?? 6;
        k.state.x = k.caster.x;
        k.state.y = k.caster.y;
        mark(k, 'f', k.caster, R, 8);
        k.flash(0.2);
        k.burst(k.at(k.caster, 0.4), 80, { kind: 'spark', colour: [PALETTE.core, GOLD, PALETTE.main], size: 2, life: [0.4, 0.8], speed: [R * 0.8, R * 1.5], up: [4, 24], gravity: 20, drag: 0.2, over: true });
        k.burst(k.at(k.caster, 0.05), 24, { kind: 'dust', colour: [DIRT, ASH], size: 4, sizeEnd: 8, life: [0.6, 1], speed: [R * 0.6, R], up: [2, 6], gravity: 2, drag: 0.15 });
      },
      impact: {
        secs: FIRESTORM_WAVE,
        draw: (k, u) => {
          const R = k.fx.reach ?? 6;
          const c = k.on(k.state.x ?? k.caster.x, k.state.y ?? k.caster.y);
          // The wall rolling out to exactly its reach: tall and white near, lower and orange as it goes, its top rolling
          // over ahead of it, stopping there. Behind it the ground it has crossed is burnt dark.
          const wave = easeOut(seg(u, 0, 0.7));
          const r = 0.5 + (R - 0.5) * wave;
          // The ground it has crossed burnt behind it, at the strength the linger keeps it: handed over, not faded out.
          burntRound(k, c, r, 1);
          emberBed(k, c, r, 1 - seg(u, 0.75, 1), { width: 4 });
          fireWall(k, c, r, { h: (22 - 10 * wave) * (1 - seg(u, 0.7, 1)), heat: cooling(wave * 0.7), lean: 0.35, turn: k.seed, front: 0.8, spacing: 0.2, arcs: 6 });
          k.light(c, R * 0.6, 1 - 0.4 * u, WARM);
          // Each creature it caught takes fire as the wall reaches it (its burn is the linger's).
          for (const [, b] of marked(k, 'f', c, R * 2)) {
            const at = reachedAt(Math.hypot(b.x - c.x, b.y - c.y), 0.5, R) * 0.7, v = seg(u, at, at + 0.35);
            // A creature's burn is the linger's, lit as the wall reaches it; here the flash of its catching.
            if (v > 0 && v < 0.5) k.flare(k.heart(b), 8 * (1 - 2 * v), flashOf(v * 2), PALETTE.core);
          }
        },
      },
      linger: {
        on: 'spot',
        secs: burnSecs('kindler_firestorm'),
        draw: (k, age, left) => {
          const R = k.fx.reach ?? 6;
          // Where it was cast, not where the caster has walked since: the ground burns, not the Kindler.
          const c = k.on(k.state.x ?? k.spot.x, k.state.y ?? k.spot.y);
          // Every creature it caught, burning for as long as the island has it burning, wherever it runs: on the storm's
          // own light, not one each (eight burning would ask for eight).
          for (const [i, b] of marked(k, 'f', c, R * 4)) {
            // Burning from when the wall reached it, not before.
            const lit = reachedAt(Math.hypot(b.x - c.x, b.y - c.y), 0.5, R) * 0.7 * FIRESTORM_WAVE;
            if (age > lit) burnWatched(k, b, `f${i}`, age - lit, k.fx.secs ?? age + left, burnPower(k.fx.each), false);
          }
          const total = k.fx.secs ?? age + left;
          // The field is the wall's until it is done.
          if (age < FIRESTORM_WAVE || age >= total) return;
          const a = smooth((total - age) / 1.2);
          // The whole round it swept stays burnt for its seconds, as the wall left it.
          burntRound(k, c, R, a);
          // Fires left burning on the ground it swept, big and few, each going out at its own moment over the storm's
          // seconds, so the field burns down rather than switching off: three groups, back to front, and the blacker
          // ground each burns on in one record.
          const n = k.fast ? 3 : 6;
          const groups: Flame[][] = [[], [], []];
          const patches: number[][] = [];
          const cy = k.sy(c), spread = Math.max(1, k.sy(k.on(c.x + R, c.y + R)) - cy);
          for (let i = 0; i < n; i++) {
            const out = total * (0.35 + 0.65 * hashOf(k.seed + 41, i));
            const life = clamp((out - age) / Math.max(0.5, out));
            const at = inDisc(k, c, R * 0.85, i, 43);
            // An uneven blackened run under it, longer one way than the other.
            const pr = 0.45 + 0.3 * hashOf(k.seed + 47, i), stretch = 1.3 + 0.6 * hashOf(k.seed + 48, i), tilt = hashOf(k.seed + 46, i) * Math.PI;
            const patch: number[] = [];
            for (let j = 0; j < 9; j++) {
              const ang = (j / 9) * TAU, rr = pr * (0.45 + 0.55 * hashOf(k.seed + 49 + i, j));
              const ex = Math.cos(ang) * rr * stretch, ey = Math.sin(ang) * rr;
              patch.push(at.x + ex * Math.cos(tilt) - ey * Math.sin(tilt), at.y + ex * Math.sin(tilt) + ey * Math.cos(tilt));
            }
            patches.push(patch);
            if (life <= 0) continue;
            const base = k.on(at.x, at.y, 0.2);
            const band = clamp(Math.floor(((k.sy(base) - cy) / spread + 1) * 1.5), 0, 2);
            const h = (8 + 6 * hashOf(k.seed + 45, i)) * (0.35 + 0.65 * life) * smooth(life * 4);
            fireCluster(k, base, h, 0.5 + 0.8 * life, i * 3, groups[band]);
            // A second fire beside the first, lower, so each is a patch of burning ground and not a campfire.
            const side = k.on(at.x + Math.cos(tilt) * pr * 0.8, at.y + Math.sin(tilt) * pr * 0.8, 0.2);
            fireCluster(k, side, h * 0.6, 0.4 + 0.7 * life, i * 3 + 1, groups[band]);
          }
          k.groundShape(c.x, c.y, R + 0.5, [{ kind: 'fill', colour: '#1d1612', alpha: clamp(0.3 * a), paths: patches, lift: 0.09 }]);
          const lit: Flame[] = [];
          for (let j = 0; j < 3; j++) {
            const at = k.on(c.x + (j - 1) * R * 0.5, c.y + (j - 1) * R * 0.5);
            flameGroup(k, at, groups[j], 1, 0, false, false);
            lit.push(...groups[j]);
          }
          flameLight(k, lit, 1);
          // Its reach, faintly, so the burnt ground reads as the storm's: the bed of coals at its edge, dying.
          emberBed(k, c, R, 0.6 * a, { hot: 0.5 * (1 - age / total) });
          k.emit(k.on(c.x, c.y, 1), 18 * a, { kind: 'ember', size: 1.4, life: [0.6, 1.2], speed: [0.05, 0.2], up: [10, 20], gravity: -2, jitter: R * 0.8, over: true });
          k.emit(k.on(c.x, c.y, 2), 6 * a, { kind: 'mist', colour: SMOKE, size: 3, sizeEnd: 7, life: [1, 1.8], speed: [0.02, 0.1], up: [8, 14], gravity: -3, jitter: R * 0.7 });
          k.light(c, R * 0.55, (0.45 * ((total - age) / total) + 0.1) * a, WARM);
        },
      },
    },
  },

  /* ---- the arcane, out of a focus ---- */

  /*
   * Ember (bolt, on enemy, reach 5): a coal out of the stone, put where you are looking. The humblest fire: a coal
   * pinched out of the garnet in the left fist and lobbed underhand, high and slow, a little puff of flame where it lands.
   */
  ember: {
    palette: PALETTE,
    cast: { timing: { secs: 0.95, release: 0.5 }, pose: emberPose },
    fx: {
      charge: (k, t) => {
        const fist = k.hand(0), pinch = k.hand(1);
        kindle(k, fist, seg(t, 0, 0.3), 1.6);
        // The coal comes out of the fist with the pinch and is held as the arm swings back.
        const a = smooth(seg(t, 0.16, 0.24)) * (1 - seg(t, 0.49, 0.5));
        if (a > 0.01) {
          k.orb(pinch, 1.7 * a, { ...COAL, glow: 0.8, bias: 1, turn: k.now * 2 });
          k.light(pinch, 1.2, 0.35 * a);
          k.emit(pinch, 8 * a, { kind: 'ember', size: 1, life: [0.2, 0.4], speed: [0.02, 0.08], up: [4, 10], gravity: 0 });
        }
      },
      travel: {
        secs: (tiles) => 0.25 + tiles * 0.08,
        draw: (k, u) => {
          // From where it was let go, kept: the hand goes on moving, and an arc tied to it bent into a rod.
          const from = k.once('from', () => k.hand(1)), to = k.heart(k.target), lift = 5 + k.dist * 2.2;
          const head = arcAt(from, to, u, lift);
          const pts: P3[] = [];
          // A short thread, an eighth of its flight, and none of it from the hand: from the hand it read as a rod.
          for (let i = 5; i >= 0; i--) pts.push(arcAt(from, to, Math.max(0, u - i * 0.025 * smooth(seg(u, 0.1, 0.25))), lift));
          // A live coal, red through and glowing, trailing a thread of its own fire once it is clear of the hand.
          if (u > 0.12) k.ribbon(pts, { width: 2.4, alpha: 0.8, main: PALETTE.main, core: PALETTE.accent, glow: 0.5, edge: false, taper: 'start' });
          k.orb(head, 2.4, { main: '#c4421a', deep: COAL.main, core: '#ffc070', ink: COAL.ink, turn: k.now * 8, glow: 1.2 });
          k.light(head, 1.3, 0.45);
          k.emit(head, 14, { kind: 'ember', size: 1.1, life: [0.2, 0.45], speed: [0.02, 0.1], up: [-2, 4], gravity: 6, over: true });
        },
      },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 14, { kind: 'spark', colour: [GOLD, PALETTE.main], size: 1.4, life: [0.2, 0.4], speed: [0.4, 1], up: [8, 22], gravity: 50 });
        k.burst(at, 5, { kind: 'mist', colour: SMOKE, size: 2, life: [0.5, 0.9], speed: [0.05, 0.15], up: [6, 12] });
      },
      impact: {
        secs: 0.7,
        draw: (k, u) => {
          // It catches: a couple of tongues on it, a breath of flame, gone.
          const b = k.target;
          const fl: Flame[] = [];
          const env = easeOut(seg(u, 0, 0.2)) * (1 - smooth(seg(u, 0.3, 1)));
          fireCluster(k, k.at(b, 0.6), 5 * env, cooling(u * 0.6), 1, fl);
          flameGroup(k, k.on(b.x, b.y), fl, 1, 3);
          k.flare(k.heart(b), 6 * (1 - u), flashOf(u), PALETTE.core);
          k.light(b, 1.6, 0.6 * (1 - u));
        },
      },
    },
  },

  /*
   * Pyre (nova, on self, 3 tiles round): everything close enough to feel it, at once. The clasped fists raised and
   * hammered down to the ground, and the whole of the ground within exactly three tiles goes up together -- white, then
   * orange, then out -- with no wave, no travel: everything at once. A scorched round left smoking.
   */
  pyre: {
    palette: PALETTE,
    // Long enough to stay down on the knee while it burns and to push up off it with some weight.
    cast: { timing: { secs: 1.5, release: 0.4, blendOut: 0.12 }, pose: pyrePose },
    fx: {
      charge: (k, t) => {
        const R = k.fx.reach ?? 3;
        const fists = mid3(k.hand(0), k.hand(1), 0.5);
        kindle(k, fists, seg(t, 0, 0.36), 2);
        // The ruby whitening as it is lifted; the ground round about darkening and its edge ringed thin and dark, as if
        // holding its breath -- all of it gone at the blow.
        const g = smooth(seg(t, 0.12, 0.38)) * (1 - seg(t, 0.4, 0.45));
        k.glow(fists, 4 + 8 * g, (0.3 + 0.5 * g) * (1 - seg(t, 0.4, 0.45)), g > 0.6 ? PALETTE.core : PALETTE.light);
        k.light(fists, 1.5 + 1.5 * g, 0.5 * g);
        k.ring(k.caster, R, { band: 0.04, alpha: 0.6 * g, glow: 0.4 * k.night, turn: k.now * 0.4, main: PALETTE.deep, deep: PALETTE.ink });
        // The ground it will burn, foreshadowed exactly.
        pyreGround(k, k.caster, R, 0.4 * g);
        drawIn(k, k.at(k.caster, 0), R, k.fast ? 3 : 6, 8 * g, k.now, 0.5, 2);
      },
      hit: (k) => {
        const R = k.fx.reach ?? 3;
        k.flash(0.12, PALETTE.core);
        const c = k.caster;
        k.state.x = c.x;
        k.state.y = c.y;
        mark(k, 'p', c, R, 8);
        for (let i = 0; i < 6; i++) {
          const at = inDisc(k, c, R * 0.9, i, 61);
          k.burst(k.on(at.x, at.y, 2), 14, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.8, life: [0.3, 0.7], speed: [0.1, 0.5], up: [30, 70], gravity: 50, over: true });
        }
        k.burst(k.at(c, 0.05), 20, { kind: 'dust', colour: [DIRT, ASH], size: 3.5, sizeEnd: 7, life: [0.5, 0.9], speed: [R * 0.5, R], up: [2, 6], gravity: 2, drag: 0.2 });
      },
      impact: {
        secs: 0.9,
        draw: (k, u) => {
          const R = k.fx.reach ?? 3;
          const c = k.on(k.state.x ?? k.caster.x, k.state.y ?? k.caster.y);
          // The whole round at once: fires standing up everywhere in it in the same instant -- each a tall tongue
          // with two leaning off it -- white, then orange; then dying down where they stand, low and red, rather than
          // shrinking away to sparks.
          const up = easeOut(seg(u, 0, 0.1)), down = smooth(seg(u, 0.3, 0.95));
          // Each fire goes out at its own moment, so the field burns down from all of them to none rather than
          // shrinking all at once into dots.
          const heat = cooling(seg(u, 0.1, 0.8));
          const n = k.fast ? 8 : 16, arcs = 4;
          const groups: Flame[][] = Array.from({ length: arcs + 1 }, () => []);
          for (let i = 0; i < n; i++) {
            const at = inDisc(k, c, R * 0.95, i, 67);
            const d = Math.hypot(at.x - c.x, at.y - c.y);
            const out = 0.35 + 0.5 * hashOf(k.seed + 75, i), left = 1 - smooth(seg(u, out - 0.15, out));
            if (left <= 0.01) continue;
            const h = (10 + 9 * hashOf(k.seed + 69, i)) * up * (1 - 0.6 * down) * left * flick(k.now, i);
            const sector = d < R * 0.3 ? arcs : Math.floor(((Math.atan2(at.y - c.y, at.x - c.x) + Math.PI) / TAU) * arcs) % arcs;
            const into = groups[sector], from = into.length;
            fireCluster(k, k.on(at.x, at.y, 0.2), h, heat - 0.5 * down + (hashOf(k.seed + 73, i) < 0.3 ? 0.4 : 0), i, into);
            // Dying down, a fire stays as wide as it stood: low and broad, not small.
            for (let j = from; j < into.length; j++) into[j].w = Math.max(into[j].w, k.hpx(3.2) * up * left);
          }
          const lit: Flame[] = [];
          for (let j = 0; j <= arcs; j++) {
            const ang = ((j + 0.5) / arcs) * TAU - Math.PI;
            const at = j === arcs ? k.on(c.x, c.y) : k.on(c.x + Math.cos(ang) * R * 0.65, c.y + Math.sin(ang) * R * 0.65);
            flameGroup(k, at, groups[j], 1 - seg(u, 0.85, 1), 0, false, false);
            lit.push(...groups[j]);
          }
          flameLight(k, lit, 1 - seg(u, 0.85, 1));
          // The round burnt, all of it at once and out to exactly its edge.
          pyreGround(k, c, R, smooth(u * 5));
          k.light(c, 2.5, 1 - 0.5 * u, WARM);
          // And every creature in it alight with the ground, in the same instant.
          for (const [i, b] of marked(k, 'p', c, R * 2)) alight(k, b, 12 * up * (1 - down), heat, 1, i);
        },
      },
      linger: {
        // The scorched round's own, not a number of the spell's (it is over when it lands): long enough to see it smoke.
        secs: 3,
        on: 'spot',
        draw: (k, age, left) => {
          const R = k.fx.reach ?? 3;
          if (age < 0.9) return;
          const a = lateFade(left, 1.2);
          const c = k.on(k.state.x ?? k.caster.x, k.state.y ?? k.caster.y);
          pyreGround(k, c, R, a);
          k.emit(k.on(c.x, c.y, 1), 14 * a, { kind: 'mist', colour: SMOKE, size: 2.5, sizeEnd: 6, life: [0.8, 1.4], speed: [0.02, 0.08], up: [8, 14], gravity: -3, jitter: R * 0.8 });
          k.emit(k.on(c.x, c.y, 0.5), 14 * a, { kind: 'ember', size: 1.3, life: [0.4, 0.9], speed: [0.02, 0.1], up: [6, 14], gravity: 0, jitter: R * 0.8, over: true });
          k.light(c, 2, 0.3 * a, WARM);
        },
      },
    },
  },
};

/**
 * The ground a Pyre burnt: a round of scorched earth exactly its reach across,
 * ragged at its edge where the fire stopped, coals glinting in it.
 */
function pyreGround(k: FxScene, c: { x: number; y: number }, R: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const n = k.facets(R, 40);
  const edge: number[] = [], inner: number[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU;
    const rr = R * (0.94 + 0.06 * hashOf(k.seed + 101, i));
    edge.push(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr);
    const ri = R * (0.55 + 0.25 * hashOf(k.seed + 103, i));
    inner.push(c.x + Math.cos(ang) * ri, c.y + Math.sin(ang) * ri);
  }
  k.groundShape(c.x, c.y, R + 0.5, [
    { kind: 'fill', colour: '#2a1a12', alpha: clamp(0.3 * alpha), paths: [edge], lift: 0.08 },
    { kind: 'fill', colour: '#1d1612', alpha: clamp(0.25 * alpha), paths: [inner], lift: 0.09 },
    { kind: 'stroke', colour: PALETTE.deep, alpha: clamp(0.7 * alpha), width: 1.4 * k.zoom, paths: [edge], closed: true, join: 'round', lift: 0.1, glow: 0.3 + 0.5 * k.night },
  ]);
}

/**
 * The round a Firestorm's wall swept, `r` tiles out: burnt dark and ragged at
 * its edge, one shape over all of it. The impact lays it as the wall goes out
 * and the linger keeps it, at the same strength, for the storm's seconds.
 */
function burntRound(k: FxScene, c: { x: number; y: number }, r: number, alpha: number): void {
  if (alpha <= 0.01 || r <= 0.05) return;
  const n = Math.max(k.facets(r, 48), Math.round(16 + 4 * r)), edge: number[] = [];
  for (let i = 0; i < n; i++) {
    // Just inside the bed of coals at its edge, never past it.
    const ang = (i / n) * TAU, rr = r * (0.94 + 0.04 * hashOf(k.seed + 105, i));
    edge.push(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr);
  }
  k.groundShape(c.x, c.y, r + 0.5, [{ kind: 'fill', colour: '#2a1a12', alpha: clamp(0.24 * alpha), paths: [edge], lift: 0.08 }]);
}

/**
 * Where a Meteor will fall, at exactly the tiles its fire reaches: a ring
 * drawn on as the arms go up, a dashed ring inside it turning the other way
 * and a small one round the creature it is aimed at, all brightening from
 * the red of a warning to the yellow of heat as it comes down (`heat`).
 */
function meteorMark(k: FxScene, W: number, grow: number, heat: number, alpha: number): void {
  const a = smooth(grow * 1.6) * alpha;
  if (a <= 0.01) return;
  const main = heat > 0.6 ? PALETTE.accent : heat > 0.25 ? PALETTE.main : PALETTE.deep;
  const deep = heat > 0.6 ? PALETTE.main : PALETTE.ink;
  const r = W * easeOut(grow);
  k.ring(k.spot, r, { band: 0.09, alpha: 0.9 * a, glow: 0.5 + heat, main, deep, turn: k.seed });
  k.ring(k.spot, r * 0.84, { band: 0.05, alpha: 0.7 * a, dash: 3, glow: 0, main, deep, turn: -k.now * 0.5 });
  k.ring(k.spot, Math.max(0.2, footOf(k.target)), { band: 0.05, alpha: 0.8 * smooth(grow * 2 - 0.8) * alpha, glow: 0.4, main, deep, turn: k.now });
}

/**
 * Where a Meteor kindles and falls from: high over the caster's right shoulder, a little toward where it will fall
 * -- where the pose reaches up for it -- and kept there for the cast.
 */
function skyOf(k: FxScene): P3 {
  return k.once('sky', () => {
    const d = k.toward(k.caster, k.spot), right = { x: -d.y, y: d.x };
    // The caster's right, as the body faces: the body is turned to the target, so its right is the target line's.
    const side = k.local(k.caster, 10, 0, 0), s = Math.sign((side.x - k.caster.x) * right.x + (side.y - k.caster.y) * right.y) || 1;
    return k.on(k.caster.x + right.x * 1.6 * s + d.x * 0.8, k.caster.y + right.y * 1.6 * s + d.y * 0.8, 95);
  });
}

/**
 * The meteor's stone, broken: pieces of it lying round where it struck, `r`
 * tiles out, standing up out of the ground as `grow` goes to one, molten in
 * their cracks while `heat` (nought to one and more) lasts. One record.
 */
function rocks(k: FxScene, c: { x: number; y: number }, r: number, grow: number, heat: number, alpha = 1): void {
  if (grow <= 0.01 || alpha <= 0.01) return;
  const pieces: ShapePiece[] = [];
  const n = k.fast ? 5 : 8;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU + hashOf(k.seed + 93, i) * 0.7;
    const d = r * (0.55 + 0.45 * hashOf(k.seed + 95, i));
    const x = c.x + Math.cos(ang) * d, y = c.y + Math.sin(ang) * d;
    const s = (0.05 + 0.05 * hashOf(k.seed + 97, i)) * grow, h = (1.5 + 2.5 * hashOf(k.seed + 99, i)) * grow;
    // A lump: a low peak off centre over a base of four corners, its lit face and its shaded one.
    const top = k.on(x + s * 0.2, y - s * 0.2, h), q = [k.on(x - s, y, 0.2), k.on(x, y - s * 0.8, 0.2), k.on(x + s, y, 0.2), k.on(x, y + s, 0.2)];
    pieces.push({ pts: [q[0], q[1], top], fill: ROCK.main, ink: ROCK.ink, width: 0.6 });
    pieces.push({ pts: [q[1], q[2], top], fill: ROCK.deep, ink: ROCK.ink, width: 0.6 });
    pieces.push({ pts: [q[2], q[3], q[0], top], fill: ROCK.main, ink: ROCK.ink, width: 0.6 });
    if (heat > 0.05) pieces.push({ pts: [mid3(q[3], top, 0.2), mid3(q[0], top, 0.55), mid3(q[2], top, 0.5)], fill: heat > 0.8 ? ROCK.core : PALETTE.deep, ink: false, alpha: clamp(heat) });
  }
  k.shapes(k.on(c.x, c.y), pieces, { alpha, bias: 2 });
}

/**
 * The crater a Meteor leaves: a ragged pit of scorched earth, and in it a
 * ragged pool of the stone's heat, molten as it lands and drying to dull red
 * as `cool` goes to one. The impact lays it and the linger keeps it, so it is
 * the same shape throughout and never pops.
 */
function crater(k: FxScene, c: { x: number; y: number }, cool: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const n = 13, pit: number[] = [], pool: number[] = [], rim: number[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU;
    const rr = 0.95 * (0.72 + 0.28 * hashOf(k.seed + 111, i)), rp = 0.3 * (0.55 + 0.45 * hashOf(k.seed + 113, i));
    pit.push(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr);
    rim.push(c.x + Math.cos(ang) * rr * 0.62, c.y + Math.sin(ang) * rr * 0.62);
    pool.push(c.x + Math.cos(ang + 0.15) * rp, c.y + Math.sin(ang + 0.15) * rp);
  }
  const hot = dry(PALETTE.main, cool * 0.7);
  k.groundShape(c.x, c.y, 1.5, [
    { kind: 'fill', colour: '#2a1a12', alpha: clamp(0.5 * alpha), paths: [pit], lift: 0.08 },
    { kind: 'fill', colour: '#3a1c12', alpha: clamp(0.7 * alpha), paths: [rim], lift: 0.09 },
    { kind: 'fill', colour: hot, alpha: clamp(0.85 * alpha * (0.85 + 0.15 * Math.sin(k.now * 5))), paths: [pool], lift: 0.1, glow: 0.4 + 0.4 * k.night, light: hot },
    { kind: 'stroke', colour: PALETTE.ink, alpha: clamp(0.6 * alpha), width: 1 * k.zoom, paths: [rim], closed: true, join: 'round', lift: 0.11 },
  ]);
  // The heat running out of the pool in cracks across the pit's floor, going dark as it cools.
  cracks(k, c, 0.8, 7, 1, alpha * (1 - 0.7 * cool), 115);
}
