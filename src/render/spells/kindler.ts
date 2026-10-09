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
import type { CastPose, SpellVisual } from './index';
import {
  arcAt, bump, clamp, easeIn, easeOut, flashOf, glowPicture, hashOf, lerp, mid3, seg, smooth, TAU,
  type Body, type FxScene, type P3, type SpellPalette,
} from './kit';
import type { HandShape, V3 } from '../figure';
import { UNITS_PER_TILE } from '../iso';
import { spellInfo } from './info';
import { beats, euler, one } from './poses';

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
const SCALD = { main: '#ffe6b8', deep: '#e0a060', core: '#ffffff', ink: '#6a3a14' };
const DIRT = '#7d6a55';

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

/** Tongues drawn together, sorted with whatever stands at `at`: back to front among themselves. */
function flameGroup(k: FxScene, at: P3, flames: Flame[], alpha = 1, bias = 0, apart = false): void {
  if (!flames.length || alpha <= 0.01) return;
  flames.sort((a, b) => a.by - b.by);
  const inkW = Math.max(0.6, 0.42 * k.zoom);
  k.worldDraw(at, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'round';
    if (apart) drawFlames(g, flames, inkW, false);
    else for (const f of flames) drawFlame(g, f, inkW);
  }, bias);
  flameLight(k, flames, alpha);
}

/** Tongues again in the light pass, faintly, so they burn as bright in the dark as by day. */
function flameLight(k: FxScene, flames: readonly Flame[], alpha: number): void {
  k.glowDraw((g) => {
    g.globalAlpha = clamp(alpha * FLAME_LIGHT);
    drawFlames(g, flames, 0, true);
  });
}

/** Soft light at several points with one record: the glow along a ring, over a field. */
function glowSpots(k: FxScene, pts: readonly P3[], r: number, alpha: number, colour = PALETTE.light): void {
  if (alpha <= 0.01 || !pts.length) return;
  const pic = glowPicture(colour);
  if (!pic) return;
  const R = r * k.zoom;
  const xy = pts.map((p) => [k.sx(p), k.sy(p)]);
  k.glowDraw((g) => {
    g.globalAlpha = clamp(alpha);
    for (const [x, y] of xy) g.drawImage(pic, x - R, y - R, 2 * R, 2 * R);
  });
}

/**
 * A ring of tongues standing on the ground round `c`, `r` tiles out: a wall
 * of fire, an aura, a wave. Drawn in a few arcs, each sorted where it stands,
 * so a ring round a body passes behind it at the back and in front at the
 * front. `from` and `span` (radians) draw only part of the ring; `h` is the
 * tallest tongue in height units, `w` the base's half-width in pixels.
 */
function flameRing(k: FxScene, c: { x: number; y: number }, r: number, o: {
  h: number; w: number; n?: number; heat?: number; alpha?: number; turn?: number; from?: number; span?: number; key?: number; arcs?: number; glow?: number;
  /** Where round the ring (radians) a crest of taller flame stands, running round with it: the ring seen to turn. */
  crest?: number;
  /**
   * Height of the near half against the far, so a ring round a body does not hide it: the tongues in front of
   * the middle stand this much of their height, and the slimmer for it.
   */
  front?: number;
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
  for (let i = 0; i < n; i++) {
    const ang = (o.turn ?? 0) + (o.from ?? 0) + span * ((i + 0.5) / n);
    const x = c.x + Math.cos(ang) * r, y = c.y + Math.sin(ang) * r;
    const crest = o.crest === undefined ? 1 : 1 + 0.8 * Math.pow(Math.max(0, Math.cos(ang - o.crest)), 6) + 0.8 * Math.pow(Math.max(0, Math.cos(ang - o.crest - Math.PI)), 6);
    const h = o.h * crest * (0.62 + 0.38 * hashOf(key, i)) * flick(k.now, i);
    const heat = (o.heat ?? 1) + (hashOf(key + 1, i) < 0.25 ? 0.6 : 0);
    // Nearer the viewer than the middle: lower, so whoever is inside shows over it.
    const near = o.front !== undefined && k.sy(k.on(x, y)) > k.sy(k.on(c.x, c.y));
    const f = upright(k, k.on(x, y, 0.2), near ? h * (o.front as number) : h, o.w * (0.8 + 0.4 * hashOf(key + 2, i)), heat, 0.12 * Math.sin(k.now * 3 + i), sway(k.now, i));
    groups[Math.min(arcs - 1, Math.floor((i / n) * arcs))].push(f);
  }
  for (let j = 0; j < arcs; j++) flameGroup(k, at[j], groups[j], a, 0, true);
  if ((o.glow ?? 1) > 0) glowSpots(k, at.map((p) => ({ ...p, z: p.z + o.h * 0.4 })), 6 + o.h * 0.9, a * 0.45 * (o.glow ?? 1));
}

/**
 * A fire: a tall tongue with two shorter ones leaning off it, which is how
 * flame stands on anything that is not a wall of it. `h` height units.
 */
function fireCluster(k: FxScene, base: P3, h: number, heat: number, key: number, out: Flame[]): void {
  const H = k.hpx(h);
  if (H < 1) return;
  const bx = k.sx(base), by = k.sy(base);
  out.push({ bx, by, tx: bx + 0.1 * H * Math.sin(k.now * 4 + key), ty: by - H, w: 0.26 * H, heat: heat + 0.35, wob: sway(k.now, key) });
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
 * middle of the body are drawn behind it, the rest in front.
 */
function burnOn(k: FxScene, b: Body, age: number, power: number, life: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const patches = power < 0.5 ? 1 : power < 0.9 ? 2 : 3;
  const size = (0.5 + 0.5 * life) * alpha;
  const person = !!b.figure;
  const front: Flame[] = [], back: Flame[] = [];
  const foot = k.on(b.x, b.y);
  const footY = k.sy(foot);
  for (let i = 0; i < patches; i++) {
    // Two fires to a patch, half a cycle apart, so one is rising as the other dies and the patch is never out.
    for (let half = 0; half < 2; half++) {
      const period = 0.9 + 0.4 * hashOf(k.seed + 11, i);
      const cyc = age / period + hashOf(k.seed + 13, i) + half * 0.5;
      const round = Math.floor(cyc), u = cyc - round;
      const env = Math.sin(Math.PI * u);
      if (env <= 0.08) continue;
      const hk = k.seed + round * 7 + i * 31 + half * 101;
      // Where on the body this round's fire is: the back of a creature, the shoulders and arms of a person.
      const right = (hashOf(hk, 1) * 2 - 1) * b.wide * (person ? 0.8 : 0.6);
      const ahead = (hashOf(hk, 2) * 2 - 1) * b.wide * (person ? 0.4 : 1.1);
      const up = b.tall * (person ? 0.5 + 0.35 * hashOf(hk, 3) : 0.55 + 0.25 * hashOf(hk, 3));
      const base = k.local(b, right, ahead, up);
      const h = (3 + 5 * power) * size * (0.35 + 0.65 * env) * (0.8 + 0.4 * hashOf(hk, 4));
      fireCluster(k, base, h, 0.7 + 0.7 * life * env, i * 5 + half, k.sy(k.on(base.x, base.y)) > footY ? front : back);
    }
  }
  flameGroup(k, foot, back, 1, -3);
  flameGroup(k, foot, front, 1, 3);
  const heart = k.at(b, 0.62);
  k.glow(heart, 9 + 8 * power, (0.35 + 0.25 * power) * alpha * (0.85 + 0.15 * Math.sin(k.now * 13)));
  k.light(b, 1.3 + 1.2 * power, (0.25 + 0.25 * power) * alpha * (0.9 + 0.1 * Math.sin(k.now * 17)));
  k.emit(k.at(b, 0.8), (5 + 9 * power) * alpha, { kind: 'ember', colour: [GOLD, PALETTE.main], size: 1.4, life: [0.4, 0.9], speed: [0.05, 0.25], up: [10, 22], gravity: -4, drag: 0.4, jitter: b.wide / 40, jitterZ: 2 });
  k.emit(k.at(b, 0.85), (1.5 + 3 * power) * alpha * life, { kind: 'smoke', colour: [SMOKE, ASH], size: 2.2 + power * 1.5, life: [0.8, 1.5], speed: [0.02, 0.1], up: [8, 14], gravity: -4, drag: 0.5, jitter: b.wide / 50 });
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
function burnWatched(k: FxScene, b: Body, slot: string, age: number, secs: number, power: number): void {
  const now = burnNow(k, b, slot, age, secs);
  if (now && !burntAlready(k, b)) burnOn(k, b, age, power, now.life, now.alpha);
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
  k.orb(at, size * (0.6 + 0.4 * a), { ...GEM, alpha: a, turn: k.now * 5, glow: 0.8, light: GEM.main, bias: 3 });
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
  flameGroup(k, at, [upright(k, at, h, w, heat, 0.1 * Math.sin(k.now * 6), sway(k.now, 3))], alpha, 6);
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

/** A hand's shape keyed over the cast: each of its shares eased from one key to the next, nought where a key leaves it out. */
function shapeAt(t: number, keys: ReadonlyArray<readonly [number, HandShape]>): HandShape {
  const out: HandShape = {};
  for (const name of ['claw', 'cup', 'flat', 'point', 'two'] as const) {
    const v = one(t, keys.map(([at, h]) => [at, h[name] ?? 0] as const));
    if (v > 0.001) out[name] = v;
  }
  return out;
}

/** Scorch: a backhand flick, the right hand cocked at the left shoulder and snapped out at the creature, two fingers' worth. */
const scorchPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  r.arm[1] = euler(t, [[0, [20, 10, 0]], [b.top, [66, -34, 44]], [b.let, [94, 10, -6]], [b.through, [84, 34, -14]], [1, [24, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [b.top, 128], [b.let, 4], [b.through, 16], [1, 28]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [30, 0, 10]], [b.let, [-24, 0, -10]], [1, [0, 0, 0]]]);
  r.open[1] = t > b.let - 0.03 && t < 0.9;
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [b.top, [40, 8, 20]], [b.let, [12, 22, 0]], [1, [14, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [b.top, 80], [b.let, 50], [1, 26]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [4, 0, 24]], [b.let, [-4, 0, -14]], [b.through, [-2, 0, -18]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [4, 0, 6]], [b.let, [-8, 0, -4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-4, 0, -18]], [b.let, [-4, 0, 10]], [b.through, [-2, 0, 14]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [-4, 3, 0]], [b.let, [18, 4, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.top, 8], [b.let, 20], [1, 6]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.top, [6, 2, 0]], [b.let, [-10, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.top, 16], [b.let, 8], [1, 4]]);
  // The flame held in a loose bowl of the fingers as the hand cocks, flicked off two fingers at the snap.
  r.shape = [undefined, shapeAt(t, [[0, {}], [b.top * 0.6, { cup: 0.8 }], [b.let - 0.04, { cup: 0.6 }], [b.let, { two: 1 }], [b.through, { two: 0.8 }], [1, {}]])];
});

/** Ember: a coal pinched out of the left fist, the right hand swung down and back, and lobbed underhand. */
const emberPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const pinch = b.top * 0.42;
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [pinch, [60, -6, 30]], [b.top, [54, -2, 26]], [b.let, [36, 12, 8]], [1, [16, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [pinch, 104], [b.top, 96], [b.let, 70], [1, 28]]);
  r.arm[1] = euler(t, [[0, [20, 10, 0]], [pinch, [62, -16, 34]], [b.top, [-30, 14, 0]], [b.let, [104, 4, 0]], [b.through, [118, 6, 0]], [1, [24, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [pinch, 104], [b.top, 18], [b.let, 12], [b.through, 18], [1, 28]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [-36, 0, 0]], [b.let, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > b.let - 0.02 && t < 0.9;
  r.chest = euler(t, [[0, [0, 0, 0]], [pinch, [-4, 0, 0]], [b.top, [-6, 0, -16]], [b.let, [4, 0, 10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-10, 0, -4]], [b.let, [4, 0, 4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [pinch, [-16, 0, 0]], [b.top, [-8, 0, 12]], [b.let, [6, 0, -4]], [b.through, [8, 0, 0]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) r.knee[k] = one(t, [[0, 4], [pinch, 6], [b.top, 22], [b.let, 6], [1, 4]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [16, 3, 0]], [b.let, [20, 3, 0]], [1, [4, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.top, [12, 2, 0]], [b.let, [-8, 2, 0]], [1, [0, 2, 0]]]);
  // The coal pinched out between two fingers; the hand that lobs it opens flat under it as it goes.
  r.shape = [undefined, shapeAt(t, [[0, {}], [pinch, { two: 0.6, claw: 0.3 }], [b.top, { two: 0.6, claw: 0.3 }], [b.let, { flat: 1 }], [b.through, { flat: 0.8 }], [1, {}]])];
});

/** Flash Fire: both palms drawn in to the chest, a step in, and shoved out at the creature an arm's length off; the body kicked back by it. */
const flashFirePose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [b.top, [26, 4, 26]], [b.let, [88, -8, 6]], [b.through, [74, -4, 6]], [1, [20, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 30], [b.top, 132], [b.let, 4], [b.through, 26], [1, 28]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [b.top, [-30, 0, 0]], [b.let, [-58, 0, 0]], [b.through, [-40, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.05 && t < 0.92;
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, 0]], [b.let, [-16, 0, 0]], [b.through, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [4, 0, -6]], [b.let, [-6, 0, 0]], [b.through, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, 0]], [b.let, [-4, 0, 0]], [b.through, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [4, 4, 0]], [b.let, [30, 4, 0]], [b.through, [24, 4, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.top, 18], [b.let, 32], [b.through, 22], [1, 6]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.top, [4, 2, 0]], [b.let, [-18, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.top, 18], [b.let, 10], [1, 4]]);
  // Palms cupped round the heat at the chest, then shoved out flat, fingers spread a little with the force of it.
  const hands = shapeAt(t, [[0, {}], [b.top * 0.5, { cup: 0.7 }], [b.top, { cup: 0.7 }], [b.let, { flat: 0.8, claw: 0.2 }], [b.through, { flat: 0.8 }], [1, {}]]);
  r.shape = [hands, hands];
});

/** Scald: a sweeping fling from the left hip out across the front, the hand open as if throwing out a pan, the left arm out for balance. */
const scaldPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  r.arm[1] = euler(t, [[0, [20, 10, 0]], [b.top, [34, -30, 44]], [b.let, [82, 0, -6]], [b.through, [76, 50, -20]], [1, [22, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [b.top, 74], [b.let, 10], [b.through, 14], [1, 28]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top, [24, 0, -60]], [b.let, [-10, 0, -40]], [b.through, [-20, 0, -10]], [1, [0, 0, 0]]]);
  r.open[1] = t > 0.06 && t < 0.92;
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [b.top, [20, 46, 0]], [b.let, [34, 52, 0]], [b.through, [26, 30, 0]], [1, [16, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [b.top, 30], [b.let, 22], [1, 28]]);
  r.open[0] = t > 0.1 && t < 0.85;
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-4, 4, 32]], [b.let, [-2, 0, 0]], [b.through, [0, -2, -22]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [-8, 0, 8]], [b.let, [-6, 0, 0]], [b.through, [-2, 0, -6]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top, [-6, 0, -24]], [b.let, [-2, 0, 0]], [b.through, [0, 0, 18]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) r.knee[k] = one(t, [[0, 4], [b.top, 20], [b.let, 12], [1, 4]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [8, 6, 0]], [b.let, [18, 6, 0]], [1, [4, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.top, [6, 6, 0]], [b.let, [-8, 6, 0]], [1, [0, 2, 0]]]);
  // The right hand a bowl that holds the scald back at the hip, flat as it flings it; the left flat out for balance.
  r.shape = [shapeAt(t, [[0, {}], [b.top, { flat: 0.7 }], [b.through, { flat: 0.7 }], [1, {}]]),
    shapeAt(t, [[0, {}], [b.top * 0.5, { cup: 1 }], [b.top, { cup: 1 }], [b.let, { flat: 1 }], [b.through, { flat: 0.7 }], [1, {}]])];
});

/** Immolate: the left arm points it out; the right hand, palm up, lifts the fire up out of the ground under it and closes on it. */
const immolatePose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [b.top * 0.4, [84, 6, -4]], [b.through, [82, 6, -4]], [1, [18, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [b.top * 0.4, 6], [b.through, 10], [1, 28]]);
  r.arm[1] = euler(t, [[0, [20, 10, 0]], [b.top * 0.35, [14, 34, -26]], [b.top, [118, 28, -18]], [b.let, [112, 22, -10]], [b.through, [104, 20, -8]], [1, [22, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [b.top * 0.35, 58], [b.top, 64], [b.let, 100], [b.through, 104], [1, 28]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [b.top * 0.35, [0, 0, -80]], [b.top, [10, 0, -70]], [b.let, [-20, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > 0.06 && t < b.let - 0.02;
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top * 0.4, [0, 0, -8]], [b.top, [6, 0, -12]], [b.let, [-6, 0, -4]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [2, 0, 0]], [b.let, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top * 0.4, [-6, 0, 6]], [b.top, [-2, 0, 6]], [b.let, [-8, 0, 4]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top * 0.4, [10, 8, 0]], [b.through, [12, 8, 0]], [1, [4, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.top * 0.4, [-8, 8, 0]], [b.through, [-8, 8, 0]], [1, [0, 2, 0]]]);
  for (let k = 0; k < 2; k++) r.knee[k] = one(t, [[0, 4], [b.top, 10], [b.let, 18], [1, 4]]);
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
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [24, 4, 0]], [b.let, [20, 4, 0]], [b.through, [10, 4, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.top, 26], [b.through, 10], [1, 4]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.top, [-12, 2, 0]], [b.through, [-4, 2, 0]], [1, [0, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.top, 8], [b.through, 16], [1, 4]]);
  // Clawed as it takes hold of the burn, shut hard on the yank; teeth bared with it.
  r.shape = [undefined, shapeAt(t, [[0, {}], [b.top * 0.6, { claw: 1 }], [b.top, { claw: 1 }], [b.let, {}], [1, {}]])];
  r.mouth = one(t, [[0, 0], [b.top, 0.15], [b.let, 0.45], [b.through, 0.2], [1, 0]]);
});

/** Inferno Bolt: the fire gathered between both hands at the right hip, the body wound round it, then both palms driven out together in a lunge. */
const infernoPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const shake = bump(t, b.top * 0.5, b.top, b.let) * Math.sin(t * 140) * 2;
  r.arm[1] = euler(t, [[0, [20, 10, 0]], [b.top * 0.4, [22, 24, 6]], [b.top, [6, 28, -6]], [b.let, [90, -4, 6]], [b.through, [86, -2, 6]], [1, [22, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [b.top * 0.4, 90], [b.top, 96], [b.let, 4], [b.through, 10], [1, 28]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [b.top * 0.4, [44, -28, 40]], [b.top, [36, -34, 44]], [b.let, [90, -6, 6]], [b.through, [86, -4, 6]], [1, [18, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [b.top * 0.4, 76], [b.top, 82], [b.let, 4], [b.through, 10], [1, 28]]);
  for (let k = 0; k < 2; k++) {
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [b.top, [0, 0, k ? 40 : -40]], [b.let, [-56, 0, 0]], [b.through, [-50, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.08 && t < 0.92;
  }
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top * 0.4, [2, 0, -30]], [b.top, [4 + shake, 0, -38]], [b.let, [-6, 0, 6]], [b.through, [-4, 0, 4]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, -10]], [b.let, [-16, 0, 4]], [b.through, [-12, 0, 2]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [b.top * 0.4, [-8, 0, 26]], [b.top, [-6, 0, 34]], [b.let, [-6, 0, -4]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [10, 6, 0]], [b.let, [32, 5, 0]], [b.through, [30, 5, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.top, 26], [b.let, 36], [b.through, 32], [1, 6]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.top, [-6, 6, 0]], [b.let, [-22, 4, 0]], [b.through, [-20, 4, 0]], [1, [0, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [b.top, 26], [b.let, 12], [1, 4]]);
  // Clawed round the ball at the hip, flat behind it in the thrust, a grunt with it.
  const hands = shapeAt(t, [[0, {}], [b.top * 0.4, { claw: 0.7, cup: 0.3 }], [b.top, { claw: 0.8, cup: 0.2 }], [b.let, { flat: 1 }], [b.through, { flat: 0.8 }], [1, {}]]);
  r.shape = [hands, hands];
  r.mouth = one(t, [[0, 0], [b.top, 0.1], [b.let, 0.6], [b.through, 0.3], [1, 0]]);
});

/** Meteor: both arms up to the sky, open, reaching for it; then hauled down hard, fists closed, into a crouch as it falls. */
const meteorPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const reach = b.top * 0.55;
  const hold = Math.min(0.92, b.through + 0.2);
  const strain = bump(t, reach, b.top, b.let) * Math.sin(t * 120);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [reach, [168, 22, 0]], [b.top, [174, 18, 0]], [b.let, [62, 10, 0]], [hold, [56, 12, 0]], [1, [18, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 30], [reach, 14], [b.top, 6], [b.let, 10], [hold, 24], [1, 28]]) + 3 * strain;
    r.open[k] = t > 0.06 && t < b.let - 0.03;
    r.shrug[k] = one(t, [[0, 0], [reach, 0.5], [b.top, 0.6], [b.let, 0], [1, 0]]);
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [reach, [8, 0, 0]], [b.top, [12, 0, 0]], [b.let, [-20, 0, 0]], [hold, [-16, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [8, 0, 0]], [b.let, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [reach, [26, 0, 0]], [b.top, [30, 0, 0]], [b.let, [-6, 0, 0]], [hold, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [b.top, [2, 6, 0]], [b.let, [30, 8, 0]], [hold, [28, 8, 0]], [1, [4, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [b.top, [0, 6, 0]], [b.let, [-6, 8, 0]], [hold, [-6, 8, 0]], [1, [0, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [b.top, 2], [b.let, 46], [hold, 42], [1, 6]]);
  r.knee[1] = one(t, [[0, 4], [b.top, 2], [b.let, 36], [hold, 32], [1, 4]]);
  // Fingers spread to the sky, straining for it; fists as it is hauled down, and a shout with it.
  const hands = shapeAt(t, [[0, {}], [reach, { claw: 0.5, flat: 0.5 }], [b.top, { claw: 0.8, flat: 0.2 }], [b.let, {}], [1, {}]]);
  r.shape = [hands, hands];
  r.mouth = one(t, [[0, 0], [b.top, 0.2], [b.let, 0.9], [hold, 0.4], [1, 0]]);
});

/** Heat Seeker: the flame cupped in the left palm, the right hand circling over it, the head turning to search; then it is sent up and away. */
const heatSeekerPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const cup = b.top * 0.3;
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [cup, [52, -6, 26]], [b.let, [56, -4, 22]], [b.through, [40, 6, 10]], [1, [16, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [cup, 96], [b.let, 92], [b.through, 70], [1, 28]]);
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [cup, [0, 0, -80]], [b.let, [0, 0, -80]], [1, [0, 0, 0]]]);
  r.open[0] = t > 0.05 && t < 0.92;
  // The right hand stirs over the left: two and a half turns, wide at first and tightening.
  const stir = bump(t, cup, cup + 0.1, b.top), ph = t * TAU * 5;
  const base = track1(t, [[0, [20, 10, 0]], [cup, [66, -10, 28]], [b.top, [70, -8, 24]], [b.let, [146, 18, 0]], [b.through, [150, 20, 0]], [1, [24, 10, 0]]]);
  r.arm[1] = [base[0] + 9 * stir * Math.sin(ph), base[1] + 9 * stir * Math.cos(ph), base[2]];
  r.elbow[1] = one(t, [[0, 30], [cup, 100], [b.top, 96], [b.let, 10], [b.through, 14], [1, 28]]);
  r.open[1] = t > 0.05 && t < 0.92;
  // The head searches, left and right, then follows it up.
  const look = bump(t, cup, (cup + b.top) / 2, b.top) * Math.sin((seg(t, cup, b.top) - 0.5) * Math.PI) * 34;
  r.head = euler(t, [[0, [0, 0, 0]], [cup, [-14, 0, 0]], [b.top, [-6, 0, 0]], [b.let, [22, 0, 0]], [b.through, [18, 0, 0]], [1, [0, 0, 0]]]);
  r.head[2] += look;
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [-2, 0, 0]], [b.let, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.chest[2] += look * 0.35;
  r.spine = euler(t, [[0, [0, 0, 0]], [b.let, [4, 0, 0]], [1, [0, 0, 0]]]);
  // The left palm cupped under the wisp; the right forefinger stirs it, and the hand opens flat to send it.
  r.shape = [shapeAt(t, [[0, {}], [cup, { cup: 1 }], [b.let, { cup: 1 }], [b.through, { cup: 0.4 }], [1, {}]]),
    shapeAt(t, [[0, {}], [cup, { point: 1 }], [b.top, { point: 1 }], [b.let, { flat: 1 }], [b.through, { flat: 0.6 }], [1, {}]])];
});

/** Stoke: the coal cupped in both hands and lifted to the mouth, blown on twice, bellows-like, then closed in the right fist and kept. */
const stokePose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const low = b.top * 0.3, up = b.top * 0.6;
  // Each breath out: the chest falls and the head goes in over the hands.
  const blow = bump(t, up, up + 0.04, b.top + 0.04) * Math.max(0, Math.sin(seg(t, up, b.let) * TAU * 2));
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [low, [40, -14, 30]], [up, [66, -16, 34]], [b.let, [64, -16, 34]],
      ...(k ? [[b.through, [30, 16, 0]], [1, [20, 10, 0]]] as const : [[b.through, [20, 12, 0]], [1, [18, 10, 0]]] as const)]);
    r.elbow[k] = one(t, k ? [[0, 30], [low, 76], [up, 124], [b.let, 122], [b.through, 84], [1, 30]] : [[0, 30], [low, 76], [up, 124], [b.let, 122], [b.through, 40], [1, 28]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [low, [0, 0, k ? -60 : 60]], [b.let, [0, 0, k ? -60 : 60]], [b.through, [0, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.05 && (k ? t < b.let + 0.02 : t < 0.9);
  }
  r.chest = euler(t, [[0, [0, 0, 0]], [low, [-6, 0, 0]], [up, [6, 0, 0]], [b.let, [-4, 0, 0]], [b.through, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest[0] -= 9 * blow;
  r.head = euler(t, [[0, [0, 0, 0]], [low, [-20, 0, 0]], [up, [-4, 0, 0]], [b.let, [-10, 0, 0]], [b.through, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.head[0] -= 10 * blow;
  r.spine = euler(t, [[0, [0, 0, 0]], [low, [-12, 0, 0]], [up, [-6, 0, 0]], [b.let, [-8, 0, 0]], [b.through, [2, 0, 0]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) {
    r.knee[k] = one(t, [[0, 4], [low, 30], [up, 18], [b.let, 20], [b.through, 4], [1, 4]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [low, [16, 4, 0]], [up, [10, 4, 0]], [b.let, [10, 4, 0]], [b.through, [2, 2, 0]], [1, [2, 2, 0]]]);
  }
  // Both hands a bowl round the coal at the mouth; the right shuts on it once it is hot. Lips pursed, blowing.
  r.shape = [shapeAt(t, [[0, {}], [low, { cup: 1 }], [b.let, { cup: 1 }], [b.through, {}], [1, {}]]),
    shapeAt(t, [[0, {}], [low, { cup: 1 }], [b.let - 0.02, { cup: 1 }], [b.let + 0.04, {}], [1, {}]])];
  r.mouth = 0.12 * bump(t, up, up + 0.04, b.let) + 0.3 * blow;
});

/** Firebrand: an hourglass written in the air with the right forefinger, then pressed into the raised left forearm, where it stays. */
const firebrandPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const [w0, w1] = BRAND_WRITE;
  // The right hand goes round the hourglass's corners as the glyph is drawn: top left, top right, bottom left, bottom right, top left.
  const corners: Array<readonly [number, number]> = [[106, -10], [104, 24], [70, -10], [70, 24], [106, -10]];
  const u = seg(t, w0, w1) * 4, i = Math.min(3, Math.floor(u)), f = smooth(u - i);
  const writing: [number, number, number] = [lerp(corners[i][0], corners[i + 1][0], f), lerp(corners[i][1], corners[i + 1][1], f), 0];
  const start = track1(t, [[0, [20, 10, 0]], [w0, [106, -10, 0]]]);
  const after = track1(t, [[w1, [106, -10, 0]], [b.let, [52, -24, 34]], [b.through, [56, -22, 32]], [1, [22, 10, 0]]]);
  r.arm[1] = (t < w0 ? start : t < w1 ? writing : after) as [number, number, number];
  r.elbow[1] = one(t, [[0, 30], [w0, 26], [w1, 26], [b.let, 104], [b.through, 100], [1, 28]]);
  r.open[1] = t > b.let - 0.06 && t < 0.92;
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [w0, [-10, 0, 0]], [b.let, [-20, 0, 0]], [1, [0, 0, 0]]]);
  // The left forearm raised across the body to take it.
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [w1 - 0.08, [24, 10, 0]], [b.let, [64, -4, 30]], [b.through, [74, -2, 26]], [1, [16, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [w1 - 0.08, 30], [b.let, 96], [b.through, 104], [1, 28]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [w0, [2, 0, -6]], [w1, [2, 0, -4]], [b.let, [-6, 0, 10]], [b.through, [4, 0, 6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [b.let, [-6, 0, 0]], [b.through, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [w0, [-10, 0, 0]], [w1, [-16, 0, 0]], [b.let, [-18, 0, 14]], [b.through, [-6, 0, 12]], [1, [0, 0, 0]]]);
  // The forefinger writes; the hand opens flat to press the glyph in.
  r.shape = [undefined, shapeAt(t, [[0, {}], [w0 - 0.04, { point: 1 }], [w1, { point: 1 }], [b.let, { flat: 1 }], [b.through, { flat: 0.6 }], [1, {}]])];
  // The hand put on the glyph's own strokes as it writes them: the points the fire is drawn through (`brandPoint`).
  const pen = smooth(seg(t, w0 - 0.06, w0)) * (1 - smooth(seg(t, w1, w1 + 0.08)));
  if (pen > 0) r.reach = [undefined, { at: brandPoint(c.facing, seg(t, w0, w1) * 4), w: pen }];
});

/** Blaze Aura: arms out low and palms down, the body turning right round to lay the fire out in a ring, and settling with the arms wide. */
const blazeAuraPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const open = b.top * 0.25;
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [open, [36, 58, 0]], [b.top, [40, 66, 0]], [b.let, [64, 78, 0]], [b.through, [52, 74, 0]], [1, [18, 12, 0]]]);
    r.elbow[k] = one(t, [[0, 30], [open, 20], [b.let, 8], [1, 26]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [open, [-30, 0, 0]], [b.let, [-40, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.06 && t < 0.92;
    r.knee[k] = one(t, [[0, 4], [open, 18], [b.let, 24], [b.through, 16], [1, 4]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [open, [8, 10, 0]], [b.let, [10, 12, 0]], [1, [2, 2, 0]]]);
  }
  // The trunk swings from wound right round to the left and back to the front: the ring laid out by the right hand.
  const turn = one(t, [[0, 0], [open, -42], [b.top, 34], [b.let, 0], [1, 0]]);
  r.spine = [one(t, [[0, 0], [open, -4], [b.let, 2], [1, 0]]), 0, turn * 0.45];
  r.chest = [one(t, [[0, 0], [b.let, 4], [1, 0]]), 0, turn * 0.55];
  r.head = [one(t, [[0, 0], [open, -10], [b.let, 2], [1, 0]]), 0, turn * 0.3];
  const palms = shapeAt(t, [[0, {}], [open, { flat: 1 }], [b.through, { flat: 1 }], [1, {}]]);
  r.shape = [palms, palms];
});

/** Firestorm: crouched low with the fists crossed over the heart, then rising on the legs as the arms spiral up and fling wide over the head. */
const firestormPose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const low = b.top * 0.55;
  const tremble = bump(t, low * 0.6, low, b.top) * Math.sin(t * 150);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [low, [58, -30, 40]], [b.top, [128, 10, 10]], [b.let, [138, 64, 0]], [b.through, [132, 66, 0]], [1, [18, 12, 0]]]);
    r.elbow[k] = one(t, [[0, 30], [low, 122], [b.top, 40], [b.let, 6], [b.through, 10], [1, 26]]) + 3 * tremble;
    r.open[k] = t > b.top - 0.04 && t < 0.92;
    r.knee[k] = one(t, [[0, 4], [low, 56], [b.top, 12], [b.let, 2], [b.through, 4], [1, 4]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [low, [30, 10, 0]], [b.top, [6, 8, 0]], [b.let, [0, 10, 0]], [1, [2, 2, 0]]]);
    r.shrug[k] = one(t, [[0, 0], [b.top, 0.3], [b.let, 0.5], [b.through, 0.4], [1, 0]]);
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [low, [-20, 0, 0]], [b.top, [0, 0, 0]], [b.let, [10, 0, 0]], [b.through, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [low, [-10, 0, 0]], [b.let, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [low, [-20, 0, 0]], [b.top, [6, 0, 0]], [b.let, [24, 0, 0]], [b.through, [20, 0, 0]], [1, [0, 0, 0]]]);
  // Fists over the heart, then flung open, fingers spread, with a shout at the let.
  const hands = shapeAt(t, [[0, {}], [b.top - 0.04, {}], [b.let, { claw: 0.6, flat: 0.4 }], [b.through, { claw: 0.4, flat: 0.6 }], [1, {}]]);
  r.shape = [hands, hands];
  r.mouth = one(t, [[0, 0], [b.top, 0.3], [b.let, 1], [b.through, 0.6], [1, 0]]);
});

/** Pyre: the hands clasped round the ruby at the chest, raised over the head together, and hammered down to the ground on one knee. */
const pyrePose: CastPose = cast((r, t, c) => {
  const b = beats(c);
  const clasp = b.top * 0.3;
  const hold = Math.min(0.9, b.through + 0.12);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [clasp, [50, -18, 36]], [b.top, [170, -8, 6]], [b.let, [44, -12, 14]], [hold, [40, -10, 14]], [1, [18, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 30], [clasp, 116], [b.top, 40], [b.let, 10], [hold, 18], [1, 28]]);
    r.open[k] = false;
    r.shrug[k] = one(t, [[0, 0], [b.top, 0.6], [b.let, 0], [1, 0]]);
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [clasp, [-4, 0, 0]], [b.top, [12, 0, 0]], [b.let, [-12, 0, 0]], [hold, [-10, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [b.top, [6, 0, 0]], [b.let, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [clasp, [-14, 0, 0]], [b.top, [18, 0, 0]], [b.let, [6, 0, 0]], [hold, [4, 0, 0]], [1, [0, 0, 0]]]);
  // Down on the right knee with the blow, and the clasped fists brought down to the ground before it.
  r.kneel = one(t, [[0, 0], [b.top, 0], [b.let, 1], [hold, 1], [1, 0]]);
  const down = smooth(seg(t, lerp(b.top, b.let, 0.5), b.let)) * (1 - smooth(seg(t, hold, 1)));
  if (down > 0) r.reach = [{ at: [-0.5, 4.5, 1.8], w: down, stoop: true }, { at: [0.5, 4.5, 1.8], w: down, stoop: true }];
  r.mouth = one(t, [[0, 0], [b.top, 0.3], [b.let, 0.8], [hold, 0.3], [1, 0]]);
});

/** `track` for three numbers, as a mutable triple. */
function track1(t: number, keys: ReadonlyArray<readonly [number, readonly [number, number, number]]>): [number, number, number] {
  return euler(t, keys) as unknown as [number, number, number];
}

/** When the Firebrand's hourglass is written, as shares of the cast. */
const BRAND_WRITE = [0.12, 0.44] as const;

/**
 * A point along the hourglass the Firebrand writes, `u` nought to four along
 * its strokes (top left, top right, bottom left, bottom right, top left), in
 * the caster's own frame (right, ahead, up). It is written square to the
 * viewer, whichever way the caster faces, so it reads as a glyph and not
 * as a line seen edge on: its across is the way that is level on the screen,
 * turned into the body's terms for its facing (as `FxScene.local` turns
 * them back). The pose puts the hand on it and the fire is drawn through it.
 */
function brandPoint(facing: number, u: number): V3 {
  const th = Math.PI / 4 - (facing * Math.PI) / 4, sn = Math.sin(th), cs = Math.cos(th);
  // Level on the screen is along the view's (1, -1); in the body's terms, by the same turn `local` undoes.
  const ax = (-sn - cs) / Math.SQRT2, ay = (cs - sn) / Math.SQRT2;
  const corners: ReadonlyArray<readonly [number, number]> = [[-1, 1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  const v = clamp(u, 0, 4), i = Math.min(3, Math.floor(v)), f = smooth(v - i);
  const across = lerp(corners[i][0], corners[i + 1][0], f) * BRAND_W, up = lerp(corners[i][1], corners[i + 1][1], f) * BRAND_H;
  return [BRAND_AT[0] + ax * across, BRAND_AT[1] + ay * across, BRAND_AT[2] + up];
}
/** Where the glyph is written, before the chest and a little to the right, and its half width and half height (figure units). */
const BRAND_AT: V3 = [2.6, 5.5, 11.5];
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

/* ---- the record --------------------------------------------------------------------------- */

/** Height units the Blaze Aura's tongues stand, and how fast (radians a second) its ring turns. */
const AURA_H = 6;
const AURA_TURN = 0.5;

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
        secs: (tiles) => 0.05 + tiles * 0.035,
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
        k.burst(at, 6, { kind: 'smoke', colour: SMOKE, size: 2, life: [0.4, 0.8], speed: [0.05, 0.2], up: [6, 12] });
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
        const edge = bump(t, 0.46, 0.52, 0.8);
        k.ring(k.caster, R, { band: 0.08, alpha: 0.5 * edge, dash: 3, glow: 0.5, main: PALETTE.main, deep: PALETTE.deep, turn: k.now * 0.2 });
        // What it found, picked out as the second pulse goes over it and held till it goes: a ring at its feet, its heart lit.
        if (t > 0.36) {
          const q = quarryOf(k);
          if (q) {
            const d = Math.hypot(q.x - k.caster.x, q.y - k.caster.y);
            const found = smooth(seg(t, lerp(0.36, 0.62, reachedAt(d, 0.4, R)), 1)) ;
            if (found > 0.01) {
              k.ring(q, footOf(q) * (1.6 - 0.5 * found), { band: 0.05, alpha: 0.85 * found, glow: 0.7, main: PALETTE.accent, deep: PALETTE.main, dash: 3, turn: k.now });
              k.glow(k.heart(q), 7, 0.5 * found, PALETTE.accent);
            }
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
        k.burst(at, 6, { kind: 'smoke', colour: SMOKE, size: 2.2, life: [0.4, 0.8], speed: [0.05, 0.2], up: [6, 12] });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const q = quarryOf(k);
          if (!q) return;
          // It strikes from above: a star of flame thrown down and out, a breath of fire up it, out.
          const at = k.heart(q);
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
          k.orb({ ...hand, z: hand.z + 1 }, 2.4 * g * (1 + 0.12 * Math.sin(k.now * 20)), { ...SCALD, glow: 0.6, bias: 5, turn: k.now * 2 });
          k.emit({ ...hand, z: hand.z + 2 }, 14 * g, { kind: 'smoke', colour: [STEAM, STEAM_SHADE], size: 1.6, life: [0.4, 0.7], speed: [0.02, 0.1], up: [8, 14], gravity: -6, jitter: 0.04 });
        }
      },
      release: (k) => {
        const from = k.hand(1);
        k.burst(from, 10, { kind: 'drop', colour: [SCALD.core, SCALD.main], size: 1.6, life: [0.25, 0.45], speed: [0.4, 1.2], up: [4, 16], heading: k.toward(k.caster, k.target), cone: 1.4, gravity: 90 });
      },
      travel: {
        secs: (tiles) => 0.1 + tiles * 0.075,
        draw: (k, u) => {
          // The pan's worth in the air: three streams fanned out of the sweep and closing on the creature, each shedding
          // drops as it goes.
          const from = k.hand(1), to = k.heart(k.target);
          const dir = k.toward(k.caster, k.target), side = { x: -dir.y, y: dir.x };
          for (let j = 0; j < 3; j++) {
            const spread = (j - 1) * 0.35, lift = 3 + k.dist * (1 + 0.25 * j);
            const at = (v: number): P3 => {
              const p = arcAt(from, to, v, lift), w = spread * Math.sin(Math.PI * v);
              return { x: p.x + side.x * w, y: p.y + side.y * w, z: p.z };
            };
            const lag = j === 1 ? 0 : 0.06;
            const pts: P3[] = [];
            for (let i = 5; i >= 0; i--) pts.push(at(clamp(u - lag - i * 0.055)));
            k.ribbon(pts, { ...SCALD, width: j === 1 ? 5.5 : 4, alpha: 0.92, taper: 'start', glow: 0.5 });
            k.orb(pts[pts.length - 1], j === 1 ? 2.2 : 1.6, { ...SCALD, glow: 0.5, turn: k.now * 6 });
            k.emit(pts[pts.length - 1], 22, { kind: 'drop', colour: [SCALD.core, SCALD.main, PALETTE.accent], size: 1.6, life: [0.2, 0.35], speed: [0.05, 0.3], up: [-4, 4], gravity: 90 });
          }
          k.emit(arcAt(from, to, u, 3 + k.dist), 10, { kind: 'smoke', colour: [STEAM, STEAM_SHADE], size: 1.8, life: [0.3, 0.6], speed: [0.02, 0.1], up: [4, 10], gravity: -5, jitter: 0.08 });
        },
      },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 16, { kind: 'smoke', colour: [STEAM, STEAM_SHADE], size: 3, life: [0.6, 1.1], speed: [0.2, 0.6], up: [6, 16], gravity: -6, drag: 0.3 });
        k.burst(at, 20, { kind: 'drop', colour: [SCALD.core, SCALD.main], size: 1.8, life: [0.3, 0.5], speed: [0.5, 1.2], up: [10, 24], gravity: 90, drag: 0.6 });
        k.burst(at, 10, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.4, life: [0.2, 0.35], speed: [0.6, 1.4], up: [4, 20], gravity: 40 });
      },
      impact: {
        secs: 0.5,
        draw: (k, u) => {
          // A splash crown at its feet, pale and hot.
          k.ring(k.target, 0.1 + 0.4 * easeOut(u), { band: 0.06 * (1 - u) + 0.02, alpha: 0.9 * (1 - u), main: SCALD.main, deep: SCALD.deep, ink: SCALD.ink, glow: 0.6 });
          k.flare(k.heart(k.target), 8 * (1 - u), flashOf(u), SCALD.core);
          k.light(k.target, 1.8, 0.6 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const b = k.target;
          const a = smooth(age / 0.4) * smooth(left / 0.9);
          const life = left / Math.max(0.01, age + left);
          // Steam hanging low round the legs, slow to lift: the weight it carries for as long as it is slowed.
          const R = footOf(b) * 1.3;
          k.disc(b, R * 0.7, { main: STEAM_SHADE, alpha: 0.14 * a });
          // Low and clinging at the legs, and lifting off its back in slow wisps.
          k.emit(k.at(b, 0.15), (5 + 4 * life) * a, { kind: 'smoke', colour: [STEAM, STEAM_SHADE], size: 1.6, sizeEnd: 4, life: [0.8, 1.3], speed: [0.03, 0.1], up: [2, 5], gravity: -1, drag: 0.5, jitter: R * 0.6, jitterZ: 1 });
          k.emit(k.at(b, 0.7), (4 + 4 * life) * a, { kind: 'smoke', colour: [STEAM, STEAM_SHADE], size: 1.4, sizeEnd: 4.5, life: [1.2, 1.9], speed: [0.02, 0.06], up: [9, 14], gravity: -2, drag: 0.6, jitter: b.wide / 50 });
          k.emit(k.at(b, 0.45), 5 * a, { kind: 'drop', colour: [SCALD.main, SCALD.core], size: 1.4, life: [0.25, 0.4], speed: [0, 0.05], up: [-2, 0], gravity: 60, jitter: b.wide / 50 });
          // The scalded hide glistening, the heat in it pulsing slowly.
          k.glow(k.at(b, 0.45), 8, 0.3 * a * (0.6 + 0.4 * Math.sin(age * 3)), SCALD.deep);
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
          k.orb(mid, 1.2 + 2.2 * g, { main: PALETTE.accent, deep: PALETTE.main, core: '#ffffff', alpha: g, bias: 6, turn: k.now * 9 });
          k.light(mid, 1.5 + g, 0.5 * g);
          k.emit(mid, 30 * g, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.2, life: [0.1, 0.22], speed: [0.4, 1], up: [-6, 10], gravity: 0, drag: 0.2 });
        }
      },
      hit: (k) => {
        const at = k.heart(k.target), dir = k.toward(k.caster, k.target);
        k.burst(at, 46, { kind: 'spark', colour: [PALETTE.core, GOLD, PALETTE.main], size: 1.8, life: [0.2, 0.5], speed: [1.2, 3], up: [0, 24], heading: dir, cone: 1.4, gravity: 40, drag: 0.1 });
        k.burst(at, 14, { kind: 'ember', size: 1.8, life: [0.4, 0.8], speed: [0.3, 0.9], up: [8, 24], gravity: 10 });
        k.burst(k.at(k.target, 0.6), 10, { kind: 'smoke', colour: [SMOKE, ASH], size: 3, life: [0.6, 1], speed: [0.1, 0.4], up: [8, 14], heading: dir, cone: 1.2 });
      },
      impact: {
        secs: 0.55,
        draw: (k, u) => {
          const from = mid3(k.hand(0), k.hand(1), 0.5), to = k.heart(k.target);
          // The cone: tongues laid out along the shove, fanned, reaching past the creature; it pours, holds and burns back.
          const grow = easeOut(seg(u, 0, 0.18)), die = smooth(seg(u, 0.25, 0.8));
          const fx = k.sx(from), fy = k.sy(from), tx = k.sx(to), ty = k.sy(to);
          let dx = tx - fx, dy = ty - fy;
          const L = Math.hypot(dx, dy) || 1;
          dx /= L;
          dy /= L;
          // Ranks of tongues along the shove, each rank further out, longer and wider than the last, so the fire leaves
          // the palms narrow and white and billows out orange over the creature; re-thrown every few frames.
          const flames: Flame[] = [];
          const ranks = k.fast ? 3 : 4, across = k.fast ? 2 : 3;
          for (let rk = 0; rk < ranks; rk++) {
            for (let i = 0; i < across; i++) {
              const q = across > 1 ? (i / (across - 1)) * 2 - 1 : 0;
              const a = q * (0.08 + 0.05 * rk) + 0.06 * Math.sin(k.now * 13 + i * 2.7 + rk);
              const c = Math.cos(a), sn = Math.sin(a);
              const vx = dx * c - dy * sn, vy = dx * sn + dy * c;
              const jig = 0.8 + 0.35 * hashOf(k.seed + Math.floor(k.now * 14), rk * 5 + i);
              // Each rank reaches past the base of the next, so the cone is one body of fire, not pieces of it.
              const len = L * (0.34 + 0.08 * rk) * jig * grow * (1 - die) * flick(k.now, rk * 3 + i);
              const off = L * (0.03 + 0.22 * rk) * grow;
              const bx = fx + vx * off, by = fy + vy * off;
              // Fire rises: the tips lift off the line of the shove, more as it dies and less is pushing it.
              const rise = len * (0.18 + 0.7 * die);
              flames.push({ bx, by, tx: bx + vx * len * (1 - 0.4 * die), ty: by + vy * len * (1 - 0.4 * die) - rise, w: len * 0.2, heat: cooling(u) * 0.6 + 0.9 - 0.45 * rk, wob: sway(k.now, rk * 3 + i) * 0.8 });
            }
          }
          // Sorted with whichever end is nearer the viewer, so it lies over the nearer of the two.
          const near = to.y + to.x > from.y + from.x ? to : from;
          flameGroup(k, near, flames, 1 - seg(u, 0.4, 0.7), 4);
          k.flare(to, 16 * (1 - u), flashOf(u, 0.08), '#ffffff');
          k.glow(mid3(from, to, 0.5), 18 * (1 - die), 0.7 * (1 - die));
          k.light(mid3(from, to, 0.6), 3.5, 1 - u);
          k.scorch(k.target, 0.4, { alpha: 0.3 * smooth(u * 4) * (1 - seg(u, 0.7, 1)) });
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
    cast: { timing: { secs: 1.4, release: 0.6 }, pose: stokePose },
    fx: {
      charge: (k, t) => {
        const cup = mid3(k.hand(0), k.hand(1), 0.5);
        const lift = { ...cup, z: cup.z + 1.2 };
        kindle(k, lift, seg(t, 0, 0.2), 1.4);
        // How hot it is: one step at each breath, the breaths at the pose's own.
        const up = beatsOf(0.6).top * 0.6, rel = 0.6;
        const breaths = seg(t, up, rel) * 2;
        const pulse = Math.max(0, Math.sin(seg(t, up, rel) * TAU * 2));
        const heat = 0.25 + 0.3 * Math.floor(breaths) + 0.35 * pulse;
        const a = smooth(seg(t, 0.08, 0.2)) * (1 - seg(t, rel + 0.02, rel + 0.06));
        if (a > 0.01) {
          k.orb(lift, 2.2 + 0.4 * heat, { ...COAL, core: heat > 0.7 ? PALETTE.core : COAL.core, alpha: a, glow: 0.4 + heat, bias: 6, turn: k.now });
          k.glow(lift, 6 + 8 * heat, 0.4 + 0.5 * heat * a);
          k.light(lift, 1.2 + 1.5 * heat, (0.3 + 0.5 * heat) * a);
          // The breath fans it: sparks off it as each one lands.
          if (pulse > 0.6) k.emit(lift, 40 * pulse, { kind: 'spark', colour: [GOLD, PALETTE.core], size: 1.2, life: [0.15, 0.35], speed: [0.2, 0.6], up: [6, 20], heading: k.toward(k.caster, k.target), cone: 2, gravity: 10 });
          handFlame(k, { ...lift, z: lift.z + 1.5 }, 3.5 * pulse, 1.4, 1.5, a * pulse);
        }
      },
      release: (k) => {
        const at = k.hand(1);
        k.burst(at, 20, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.5, life: [0.2, 0.4], speed: [0.4, 1], up: [6, 26], gravity: 30 });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const at = k.hand(1);
          k.flare(at, 10 * (1 - u), flashOf(u), PALETTE.core, u * 2);
          k.ring(k.caster, 0.15 + 0.3 * easeOut(u), { band: 0.04, alpha: 0.7 * (1 - u), glow: 0.4 });
          k.light(k.caster, 2.5, 0.6 * (1 - u));
        },
      },
      linger: {
        on: 'caster',
        draw: (k, age, left) => {
          // Banked in the hand: a coal, no flame on it, glowing steady with two sparks going slowly round it -- heat kept
          // for the next fire, not fire. It gutters only as the last few seconds go.
          const a = smooth(age / 0.5) * smooth(left / 1.5);
          const gutter = left < 5 ? 0.6 + 0.4 * Math.abs(Math.sin(age * 9)) : 1;
          const at = k.hand(1);
          const coal = { ...at, z: at.z + 1 };
          k.orb(coal, 1.7, { ...COAL, core: PALETTE.accent, alpha: a, glow: 0.7 * gutter, bias: 6, turn: age * 0.7 });
          for (let i = 0; i < 2; i++) {
            const ang = age * 2.4 + i * Math.PI;
            const p = { x: coal.x + Math.cos(ang) * 0.06, y: coal.y + Math.sin(ang) * 0.06, z: coal.z + 0.6 * Math.sin(ang * 2) };
            k.flare(p, 2.2, 0.8 * a * gutter, PALETTE.core, ang);
          }
          if (!k.fast) k.emit(coal, 1.5 * a, { kind: 'ember', size: 1.1, life: [0.4, 0.8], speed: [0.02, 0.06], up: [6, 12], gravity: -2 });
          k.light(coal, 1, 0.22 * a * gutter);
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
        const drawn = seg(t, w0, w1) * 4;
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
        const end = Math.min(4, drawn), whole = Math.floor(end);
        const pts: P3[] = [];
        for (let j = 0; j <= whole; j++) pts.push(on(j));
        if (end > whole) pts.push(on(end));
        const xs = pts.map((q) => k.sx(q)), ys = pts.map((q) => k.sy(q));
        const hx = xs[xs.length - 1], hy = ys[ys.length - 1];
        const c = on(2);
        const cx = k.sx(c), cy = k.sy(c);
        const W = Math.max(...xs.map((x) => Math.abs(x - cx))) + 1, H = Math.max(...ys.map((y) => Math.abs(y - cy))) + 1;
        const z = k.zoom;
        const path = (g: CanvasRenderingContext2D): void => {
          g.beginPath();
          g.moveTo(xs[0], ys[0]);
          for (let j = 1; j < xs.length; j++) g.lineTo(xs[j], ys[j]);
        };
        k.worldDraw(c, (g) => {
          g.globalAlpha = clamp(a);
          g.lineJoin = 'round';
          g.lineCap = 'round';
          path(g);
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
        const pic = glowPicture(PALETTE.light);
        k.glowDraw((g) => {
          if (!pic) return;
          g.globalAlpha = 0.55 * a;
          const R = 9 * z;
          g.drawImage(pic, cx - W - R, cy - H - R, 2 * (W + R), 2 * (H + R));
          if (t < w1) {
            // The writing point, burning hotter than what it has written.
            g.globalAlpha = 0.9;
            g.drawImage(pic, hx - 4 * z, hy - 4 * z, 8 * z, 8 * z);
          }
        });
        if (t < w1) k.emit(finger, 30, { kind: 'ember', size: 1.2, life: [0.2, 0.5], speed: [0.02, 0.1], up: [-6, 4], gravity: 20 });
        k.light(c, 1.6, 0.45 * a);
      },
      release: (k) => {
        const arm = mid3(k.joint(k.caster, 'elbow0', [0, 0, 0]), k.hand(0), 0.6);
        k.burst(arm, 22, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.6, life: [0.2, 0.45], speed: [0.5, 1.4], up: [6, 26], gravity: 40 });
        k.burst(arm, 6, { kind: 'smoke', colour: [SMOKE, ASH], size: 2, life: [0.5, 0.9], speed: [0.05, 0.2], up: [8, 14] });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const arm = mid3(k.joint(k.caster, 'elbow0', [0, 0, 0]), k.hand(0), 0.6);
          k.flare(arm, 11 * (1 - u), flashOf(u), PALETTE.core, u);
          k.light(arm, 2.2, 0.7 * (1 - u));
        },
      },
      linger: {
        on: 'caster',
        draw: (k, age, left) => {
          const a = smooth(age / 0.5) * smooth(left / 0.8);
          const share = left / Math.max(0.01, age + left);
          // The brand on the forearm: two small tongues and a glow, burning steady.
          const elbow = k.joint(k.caster, 'elbow0', [0, 0, 0]), wrist = k.hand(0);
          const flames: Flame[] = [];
          for (let i = 0; i < 2; i++) {
            const p = mid3(elbow, wrist, 0.45 + 0.35 * i);
            flames.push(upright(k, p, (2.2 + 0.8 * Math.sin(age * 8 + i * 2)) * a, 1, 1.2, 0, sway(k.now, i)));
          }
          flameGroup(k, wrist, flames, a, 6);
          k.glow(mid3(elbow, wrist, 0.6), 5, 0.4 * a);
          // The hourglass over the left shoulder, running down for as long as the brand holds.
          const at = k.local(k.caster, -6, 0, k.caster.tall + 3.5);
          hourglass(k, at, 4.2, share, 0.95 * a, age * 0.8);
          if (!k.fast) k.emit({ ...at, z: at.z - 0.5 }, 2.5 * a, { kind: 'ember', size: 1, life: [0.3, 0.5], speed: [0, 0.02], up: [-6, -3], gravity: 0, jitter: 0.01 });
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
        // The ground under it heating: a ring of cracks glowing up, smoke beginning to rise.
        const b = k.target;
        const R = footOf(b);
        k.sigil(b, R, { grow: g, points: 6, step: 1, turn: k.seed, alpha: 0.85 * g, glow: 0.8, core: PALETTE.accent, width: 1.2 });
        k.disc(b, R * 0.9, { main: PALETTE.deep, alpha: 0.35 * g });
        k.emit(k.at(b, 0.05), 14 * g, { kind: 'smoke', colour: [SMOKE, ASH], size: 2, life: [0.5, 0.9], speed: [0.02, 0.1], up: [6, 12], jitter: R * 0.8 });
        k.emit(k.at(b, 0.05), 16 * g, { kind: 'ember', size: 1.2, life: [0.3, 0.6], speed: [0.02, 0.1], up: [8, 18], gravity: 0, jitter: R * 0.8 });
        k.light(b, 1.5, 0.4 * g);
      },
      hit: (k) => {
        const b = k.target;
        k.burst(k.at(b, 0.1), 40, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.6, life: [0.3, 0.6], speed: [0.1, 0.5], up: [30, 60], gravity: 40, jitter: b.wide / 40 });
        k.burst(k.at(b, 0.5), 10, { kind: 'smoke', colour: [SMOKE, ASH], size: 3, life: [0.6, 1.1], speed: [0.05, 0.3], up: [10, 18] });
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const b = k.target;
          const R = footOf(b);
          // A wall of flame up out of the ground all round it, climbing past its head, then sinking onto it as its burn.
          const rise = easeOut(seg(u, 0, 0.25)) * (1 - smooth(seg(u, 0.4, 1)));
          flameRing(k, b, R * (1 - 0.3 * u), { h: (b.tall * 0.9 + 3) * rise, w: 2, n: 10, front: 0.45, heat: cooling(u * 0.8), arcs: 4, alpha: 1 - seg(u, 0.85, 1) });
          k.sigil(b, R, { points: 6, step: 1, turn: k.seed, alpha: 0.85 * (1 - u), glow: 0.8, core: PALETTE.accent, width: 1.2 });
          k.light(b, 2.6, 0.9 * (1 - u * 0.6));
        },
      },
      linger: {
        on: 'target',
        secs: burnSecs('kindler_immolate'),
        draw: (k, age, left) => {
          burnLinger(k, age, left);
          // The ground it was lit from stays scorched under it for the first few seconds.
          const b = k.target;
          k.scorch(b, footOf(b), { alpha: 0.4 * (1 - seg(age, 2, 5)) });
        },
      },
    },
  },

  /*
   * Combust (bolt, on enemy): a burning creature takes at once 150% of what its burn had left, and stops burning. The
   * right hand reaches out and takes hold of the burn -- embers drawn in off it, a taut line of heat to the hand, its fire
   * squeezed in -- and as the fist closes and is yanked back, it goes off: a star of flame and a ring of smoke, and then
   * nothing burning on it.
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
          // Its fire drawn in on itself: embers pulled in from round it, a shell of heat tightening.
          drawIn(k, k.at(b, 0.3), 0.9, k.fast ? 3 : 6, 10 * grip, k.now * 2, 0.35, 6);
          k.shell(b, { size: 1.5 - 0.6 * grip, alpha: 0.35 * grip, turn: k.now * 3, main: PALETTE.main, deep: PALETTE.deep, core: PALETTE.accent, glow: 0.8 });
          k.glow(heart, 6 + 10 * grip, 0.7 * grip, PALETTE.accent);
          k.light(b, 1.6, 0.6 * grip);
        }
      },
      hit: (k) => {
        const b = k.target, at = k.heart(b);
        k.burst(at, 60, { kind: 'spark', colour: [PALETTE.core, GOLD, PALETTE.main], size: 1.8, life: [0.25, 0.55], speed: [1.5, 3.5], up: [0, 30], gravity: 40, drag: 0.08 });
        k.burst(at, 16, { kind: 'ember', size: 2, life: [0.5, 1], speed: [0.4, 1.2], up: [10, 30], gravity: 14 });
        // The smoke ring: thrown flat out round it.
        k.burst(k.at(b, 0.35), 22, { kind: 'smoke', colour: [SMOKE, ASH], size: 3.2, sizeEnd: 6, life: [0.7, 1.2], speed: [1.2, 1.8], up: [0, 3], gravity: -2, drag: 0.08 });
      },
      impact: {
        secs: 1.0,
        draw: (k, u) => {
          const b = k.target, at = k.heart(b);
          const pop = easeOut(seg(u, 0, 0.3));
          starburst(k, at, k.fast ? 6 : 9, 8 + 16 * pop, 3.2 * (1 - 0.5 * u), cooling(u * 1.4), 1 - seg(u, 0.35, 0.6), k.now * 0.2);
          k.flare(at, 20 * (1 - u), flashOf(u, 0.06), '#ffffff', 0.4);
          k.ring(b, 0.15 + 0.6 * easeOut(u), { band: 0.08 * (1 - u) + 0.02, alpha: 0.9 * (1 - u * u), glow: 0.8 });
          k.light(b, 3, 1 - u);
          // What is left: a thin column of smoke going up off it, not a flame on it.
          if (u > 0.3) k.emit(k.at(b, 0.7), 14 * (1 - u), { kind: 'smoke', colour: [SMOKE, ASH], size: 2.4, life: [0.8, 1.3], speed: [0.02, 0.08], up: [12, 18], gravity: -2 });
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
    cast: { timing: { secs: 1.2, release: 0.5 }, pose: blazeAuraPose },
    fx: {
      charge: (k, t) => {
        const R = k.fx.reach ?? 2;
        kindle(k, k.hand(1), seg(t, 0, 0.2), 1.3);
        // The ring laid down by the sweep: a band of low flame drawn round after the hand.
        const b = beatsOf(0.5);
        const laid = smooth(seg(t, b.top * 0.25, 0.5));
        const from = Math.atan2(k.facingDir(k.caster).y, k.facingDir(k.caster).x) - Math.PI / 2;
        if (laid > 0) {
          flameRing(k, k.caster, R, { h: 3.5, w: 1.6, from, span: TAU * laid, heat: 1.4, arcs: 6, glow: 0.6 });
          const tip = from + TAU * laid;
          k.emit(k.on(k.caster.x + Math.cos(tip) * R, k.caster.y + Math.sin(tip) * R, 1), 50 * (1 - laid), { kind: 'ember', size: 1.4, life: [0.2, 0.5], speed: [0.1, 0.4], up: [8, 20], gravity: 10 });
        }
        k.light(k.caster, R + 0.5, 0.5 * laid);
      },
      hit: (k) => {
        const R = k.fx.reach ?? 2;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + k.seed;
          k.burst(k.on(k.caster.x + Math.cos(a) * R, k.caster.y + Math.sin(a) * R, 2), 10, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.5, life: [0.3, 0.6], speed: [0.1, 0.4], up: [20, 40], gravity: 40 });
        }
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const R = k.fx.reach ?? 2;
          // It stands up: tall and white for a beat, then down to the aura's own height.
          const h = lerp(14, AURA_H, smooth(u)) * easeOut(seg(u, 0, 0.15));
          flameRing(k, k.caster, R, { h, w: 2.2, heat: cooling(u) * 0.5 + 1, turn: k.now * AURA_TURN });
          k.ring(k.caster, R, { band: 0.16, alpha: 0.8, glow: 0.8, turn: k.now * AURA_TURN });
          k.light(k.caster, R + 1, 0.9 - 0.4 * u);
        },
      },
      linger: {
        on: 'caster',
        draw: (k, age, left) => {
          const R = k.fx.reach ?? 2;
          if (age < 0.6) return;
          const a = smooth(left / 0.8);
          const share = left / Math.max(0.01, age + left);
          // Knee-high tongues standing at its reach and turning with the caster, lower as its seconds run out.
          flameRing(k, k.caster, R, { h: AURA_H * (0.6 + 0.4 * share) * a, w: 2, heat: 1, turn: k.now * AURA_TURN, alpha: a, crest: k.now * AURA_TURN * 4, front: 0.75 });
          k.ring(k.caster, R, { band: 0.12, alpha: 0.55 * a, glow: 0.6, turn: k.now * AURA_TURN });
          // Its fire on whatever stands in it, a round a second: a lick of flame off the ring and up each one.
          const round = age - 0.6, lick = round - Math.floor(round);
          if (lick < 0.5) {
            let i = 0;
            for (const b of k.bodiesWithin(R, k.caster, ['creature'])) {
              const at = k.heart(b);
              starburst(k, at, 4, 7 * easeOut(lick * 4), 1.6, cooling(lick * 2), a * (1 - seg(lick, 0.25, 0.5)), k.seed + Math.floor(round) + i);
              alight(k, b, 4 * (1 - smooth(seg(lick, 0.1, 0.5))), 1, a, i++);
            }
          }
          k.emit(k.at(k.caster, 0.05), 12 * a, { kind: 'ember', size: 1.3, life: [0.5, 1], speed: [0.05, 0.2], up: [10, 20], gravity: -2, jitter: R * 0.9 });
          k.light(k.caster, R + 0.8, 0.5 * a);
        },
      },
    },
  },

  /*
   * Inferno Bolt (bolt, on enemy, lasts 10 s): fire at 300% and a burn of 3% a second for 10 s. The great bolt: a ball of
   * fire gathered between both hands at the hip, driven out in a lunge, heavy and trailing smoke; it bursts on the
   * creature in a star of flame and leaves it burning as hard as a Kindler can for its ten seconds.
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
        k.burst(mid, 3, { kind: 'smoke', colour: [SMOKE, ASH], size: 2.5, life: [0.4, 0.7], speed: [0.1, 0.4], up: [6, 12] });
      },
      travel: {
        secs: (tiles) => 0.12 + tiles * 0.065,
        draw: (k, u) => {
          const from = mid3(k.hand(0), k.hand(1), 0.5), to = k.heart(k.target), lift = k.dist * 0.5;
          const head = arcAt(from, to, u, lift), back = arcAt(from, to, Math.max(0, u - 0.06), lift);
          fireball(k, head, back, 5.2, 3.2);
          k.light(head, 3.2, 0.85);
          k.emit(head, 50, { kind: 'ember', colour: [GOLD, PALETTE.main], size: 1.8, life: [0.25, 0.5], speed: [0.05, 0.3], up: [-4, 8], gravity: 4, jitter: 0.06 });
          k.emit(back, 16, { kind: 'smoke', colour: [SMOKE, ASH], size: 2.6, sizeEnd: 6, life: [0.5, 0.9], speed: [0.02, 0.1], up: [2, 8], gravity: -3, jitter: 0.04 });
        },
      },
      hit: (k) => {
        const b = k.target, at = k.heart(b);
        k.burst(at, 70, { kind: 'spark', colour: [PALETTE.core, GOLD, PALETTE.main], size: 2, life: [0.3, 0.7], speed: [1.2, 3.2], up: [0, 40], gravity: 50, drag: 0.08 });
        k.burst(at, 20, { kind: 'ember', size: 2.2, life: [0.6, 1.2], speed: [0.3, 1], up: [10, 34], gravity: 14 });
        k.burst(k.at(b, 0.6), 14, { kind: 'smoke', colour: [SMOKE, ASH], size: 4, sizeEnd: 8, life: [0.8, 1.4], speed: [0.2, 0.6], up: [6, 16], gravity: -3 });
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const b = k.target, at = k.heart(b);
          const pop = easeOut(seg(u, 0, 0.25));
          starburst(k, at, k.fast ? 7 : 11, 10 + 20 * pop, 4.5 * (1 - 0.5 * u), cooling(u * 1.3), 1 - seg(u, 0.4, 0.75), k.seed);
          k.flare(at, 22 * (1 - u), flashOf(u, 0.06), '#ffffff');
          k.ring(b, 0.2 + 0.75 * easeOut(u), { band: 0.12 * (1 - u) + 0.03, alpha: 0.95 * (1 - u * u), glow: 1 });
          k.scorch(b, 0.5, { alpha: 0.35 * smooth(u * 3) });
          k.light(b, 4.5, 1 - 0.6 * u);
        },
      },
      linger: {
        on: 'target',
        secs: burnSecs('kindler_inferno_bolt'),
        draw: (k, age, left) => {
          burnLinger(k, age, left);
          k.scorch(k.target, 0.5, { alpha: 0.35 * (1 - seg(age, 1, 4)) });
        },
      },
    },
  },

  /*
   * Meteor (bolt, on enemy, 3 tiles round): fire at 400% on the enemy and 150% on every other within 3 tiles of it. Both
   * arms up to the sky and hauled down: a red ring marks the ground at exactly its three tiles while a star kindles
   * high over it; the stone comes down out of the sky, burning, and the ground goes up -- a shockwave and a wall of
   * flame out to the ring's edge, rock and dirt thrown, and a crater left smouldering.
   */
  kindler_meteor: {
    palette: PALETTE,
    cast: { timing: { secs: 1.8, release: 0.5, blendOut: 0.18 }, pose: meteorPose },
    fx: {
      charge: (k, t) => {
        const W = k.fx.wide ?? 3;
        kindle(k, mid3(k.hand(0), k.hand(1), 0.5), seg(t, 0.05, 0.3), 1.6);
        // Where it will fall, marked at exactly its reach: drawn on as the arms go up.
        const g = seg(t, 0.12, 0.48);
        meteorMark(k, W, g, 0);
        // And the star over it, kindling as the hands reach for it.
        const star = skyOf(k);
        const s = smooth(seg(t, 0.2, 0.5));
        k.flare(star, 4 + 10 * s, s, PALETTE.core, k.now);
        k.glow(star, 10 + 14 * s, 0.6 * s);
        k.light(k.spot, W, 0.35 * s);
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
          k.light(k.spot, W + 0.5, 0.35 + 0.5 * u);
          k.emit(back, 40, { kind: 'smoke', colour: [SMOKE, ASH], size: 3, sizeEnd: 7, life: [0.5, 1], speed: [0.02, 0.1], up: [0, 4], gravity: -2, jitter: 0.1, jitterZ: 3 });
          k.emit(head, 50, { kind: 'ember', size: 1.8, life: [0.2, 0.45], speed: [0.1, 0.4], up: [0, 10], gravity: 10, jitter: 0.05 });
          // The ground under it brightening as it comes.
          meteorMark(k, W, 1, u);
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
        k.burst(at, 90, { kind: 'spark', colour: [PALETTE.core, GOLD, PALETTE.main], size: 2.2, life: [0.4, 0.8], speed: [W * 1.2, W * 3], up: [10, 60], gravity: 60, drag: 0.1 });
        k.burst(at, 30, { kind: 'ember', size: 2.2, life: [0.8, 1.6], speed: [0.5, W], up: [20, 50], gravity: 20 });
        k.burst(at, 30, { kind: 'dust', colour: [DIRT, ASH], size: 4, sizeEnd: 9, life: [0.6, 1.2], speed: [W * 0.8, W * 1.6], up: [2, 10], gravity: 3, drag: 0.1 });
        k.burst(at, 16, { kind: 'shard', colour: [ROCK.main, ROCK.deep, PALETTE.deep], size: 2.2, life: [0.6, 1], speed: [0.8, W * 1.2], up: [30, 60], gravity: 90, spin: 2, bias: 2 });
      },
      impact: {
        secs: 1.1,
        draw: (k, u) => {
          const W = k.fx.wide ?? 3;
          const c = k.on(k.state.x ?? k.spot.x, k.state.y ?? k.spot.y);
          // The shockwave and the fire riding it, out to exactly its reach and no further.
          const wave = easeOut(seg(u, 0, 0.55));
          const r = 0.3 + (W - 0.3) * wave;
          k.ring(c, r, { band: 0.5 * (1 - wave) + 0.12, alpha: 1 - seg(u, 0.55, 1), glow: 1, main: PALETTE.accent, deep: PALETTE.main });
          flameRing(k, c, r, { h: 16 * (1 - 0.6 * wave) * (1 - seg(u, 0.5, 0.95)), w: 2.6, heat: cooling(wave), alpha: 1 - seg(u, 0.85, 1) });
          // The column where it struck, and the crater glowing under it.
          const col = 1 - seg(u, 0, 0.4);
          flameRing(k, c, 0.5, { h: 34 * col * easeOut(u * 8), w: 4.5, n: 7, heat: 2, arcs: 3, glow: 1, alpha: col });
          k.disc(c, 0.55, { main: PALETTE.main, alpha: 0.75 * (1 - u * 0.4) });
          k.scorch(c, 0.95, { alpha: 0.55 * smooth(u * 4) });
          k.ring(c, W, { band: 0.08, alpha: 0.8 * (1 - u), glow: 0.6, main: PALETTE.deep, deep: PALETTE.ink });
          k.light(c, W + 1.5, 1 - 0.4 * u);
          // Every other creature within it, struck as the wave of fire reaches it.
          const near = marked(k, 'm', c, W * 2);
          for (const [i, b] of near) {
            if (b.who?.kind === 'creature' && k.target.who?.kind === 'creature' && b.who.id === k.target.who.id) continue;
            const at = reachedAt(Math.hypot(b.x - c.x, b.y - c.y), 0.3, W) * 0.55, v = seg(u, at, at + 0.4);
            if (v <= 0 || v >= 1) continue;
            starburst(k, k.heart(b), 5, 9 * easeOut(v * 2), 2, cooling(v), 1 - seg(v, 0.4, 1), k.seed + i);
            alight(k, b, 7 * (1 - smooth(v)), cooling(v * 0.7), 1, i);
          }
        },
      },
      linger: {
        // The crater's own, not a number of the spell's: long enough to be seen cooling, no longer.
        secs: 5,
        on: 'spot',
        draw: (k, age, left) => {
          const W = k.fx.wide ?? 3;
          const c = k.on(k.state.x ?? k.spot.x, k.state.y ?? k.spot.y);
          const a = smooth(left / 2);
          // The crater left: molten at the heart, cooling to coals, a few tongues on its lip, smoke going up.
          k.scorch(c, 0.95, { alpha: 0.55 * a });
          k.disc(c, 0.55, { main: PALETTE.deep, alpha: 0.65 * a });
          k.disc(c, 0.32, { main: PALETTE.main, alpha: 0.7 * a * (0.8 + 0.2 * Math.sin(age * 5)) });
          flameRing(k, c, 0.55, { h: 5 * a * (0.6 + 0.4 * (left / (age + left))), w: 1.6, n: 7, heat: 0.9, arcs: 3, alpha: a, glow: 0.6 });
          k.ring(c, W, { band: 0.06, alpha: 0.35 * a * (1 - seg(age, 0, 3)), glow: 0.4, main: PALETTE.deep, deep: PALETTE.ink });
          k.emit(k.on(c.x, c.y, 2), 10 * a, { kind: 'smoke', colour: [SMOKE, ASH], size: 3, sizeEnd: 7, life: [1, 1.8], speed: [0.02, 0.1], up: [8, 14], gravity: -3, jitter: 0.6 });
          k.emit(k.on(c.x, c.y, 1), 8 * a, { kind: 'ember', size: 1.4, life: [0.5, 1], speed: [0.05, 0.2], up: [8, 18], gravity: 0, jitter: 0.8 });
          k.light(c, W, 0.5 * a);
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
        // The vortex: embers spiralling in from the edge of its reach, faster as it builds; the reach ringed.
        const g = smooth(seg(t, 0.08, 0.5));
        const ring = smooth(seg(t, 0.05, 0.25)) * (1 - seg(t, 0.56, 0.62));
        k.ring(c, R, { band: 0.12, alpha: 0.6 * ring, turn: -k.now * 0.6, glow: 0.7 });
        // And the edge of it catching, low, in a run going round against the vortex.
        flameRing(k, c, R, { h: 4 * ring * (0.5 + 0.5 * g), w: 1.4, n: 40, heat: 0.9, turn: -k.now * 0.6, alpha: ring, crest: -k.now * 2.4, glow: 0.6 });
        drawIn(k, k.at(c, 0), R * (1 - 0.4 * g), k.fast ? 4 : 8, 6 + 10 * g, -k.now * (0.6 + 1.6 * g), 0.55 - 0.2 * g, 2 + 10 * g);
        // A tight ring of fire at the feet, turning with the vortex and climbing as it builds: the storm's eye.
        if (g > 0.05 && t < 0.58) flameRing(k, c, 0.35, { h: (3 + 7 * g) * (1 - seg(t, 0.54, 0.58)), w: 1.4, n: 9, heat: 1 + 0.6 * g, arcs: 3, turn: -k.now * 5, crest: -k.now * 9, glow: 0.7 });
        k.glow(k.chest(), 8 + 14 * g, 0.6 * g);
        k.light(c, 2 + 2 * g, 0.4 + 0.4 * g);
      },
      hit: (k) => {
        const R = k.fx.reach ?? 6;
        k.state.x = k.caster.x;
        k.state.y = k.caster.y;
        mark(k, 'f', k.caster, R, 8);
        k.flash(0.2);
        k.burst(k.at(k.caster, 0.4), 80, { kind: 'spark', colour: [PALETTE.core, GOLD, PALETTE.main], size: 2, life: [0.4, 0.8], speed: [R * 0.8, R * 1.5], up: [4, 24], gravity: 20, drag: 0.2 });
        k.burst(k.at(k.caster, 0.05), 24, { kind: 'dust', colour: [DIRT, ASH], size: 4, sizeEnd: 8, life: [0.6, 1], speed: [R * 0.6, R], up: [2, 6], gravity: 2, drag: 0.15 });
      },
      impact: {
        secs: 1.0,
        draw: (k, u) => {
          const R = k.fx.reach ?? 6;
          const c = k.on(k.state.x ?? k.caster.x, k.state.y ?? k.caster.y);
          // The wall rolling out to exactly its reach: tall and white near, lower and orange as it goes, stopping there.
          const wave = easeOut(seg(u, 0, 0.7));
          const r = 0.5 + (R - 0.5) * wave;
          flameRing(k, c, r, { h: (20 - 8 * wave) * (1 - seg(u, 0.7, 1)), w: 2.8, heat: cooling(wave * 0.7), turn: k.seed, arcs: 10 });
          k.ring(c, r, { band: 0.4 * (1 - wave) + 0.15, alpha: 1 - seg(u, 0.75, 1), glow: 1, main: PALETTE.accent });
          k.disc(c, r, { main: PALETTE.deep, alpha: 0.18 * (1 - u) });
          k.light(c, R + 1, 1 - 0.4 * u);
          // Each creature it caught struck as the wall reaches it (its burn is the linger's).
          for (const [i, b] of marked(k, 'f', c, R * 2)) {
            const at = reachedAt(Math.hypot(b.x - c.x, b.y - c.y), 0.5, R) * 0.7, v = seg(u, at, at + 0.35);
            if (v > 0 && v < 1) starburst(k, k.heart(b), 5, 10 * easeOut(v * 2), 2.2, cooling(v), 1 - seg(v, 0.4, 1), k.seed + i);
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
          // Every creature it caught, burning for as long as the island has it burning, wherever it runs.
          for (const [i, b] of marked(k, 'f', c, R * 4)) burnWatched(k, b, `f${i}`, age, k.fx.secs ?? age + left, burnPower(k.fx.each));
          const total = k.fx.secs ?? age + left;
          if (age < 0.7 || age >= total) return;
          const a = smooth((total - age) / 1.2);
          // Fires left on the ground it swept, each going out at its own moment over the storm's seconds, so the field
          // burns down rather than switching off.
          const n = k.fast ? 5 : 10;
          for (let i = 0; i < n; i++) {
            const out = total * (0.35 + 0.65 * hashOf(k.seed + 41, i));
            const life = clamp((out - age) / Math.max(0.5, out));
            if (life <= 0) continue;
            const at = inDisc(k, c, R * 0.92, i, 43);
            const fl: Flame[] = [];
            fireCluster(k, k.on(at.x, at.y, 0.2), (5 + 4 * hashOf(k.seed + 45, i)) * (0.35 + 0.65 * life), 0.5 + 0.8 * life, i * 3, fl);
            flameGroup(k, k.on(at.x, at.y), fl, smooth(life * 4));
            if (!k.fast) k.scorch(at, 0.35 + 0.2 * hashOf(k.seed + 47, i), { alpha: 0.35 * a });
          }
          // Its reach, faintly, so the burnt ground reads as the storm's.
          k.ring(c, R, { band: 0.1, alpha: 0.45 * a, dash: 4, glow: 0.6, main: PALETTE.deep, deep: PALETTE.ink });
          k.emit(k.on(c.x, c.y, 1), 18 * a, { kind: 'ember', size: 1.4, life: [0.6, 1.2], speed: [0.05, 0.2], up: [10, 20], gravity: -2, jitter: R * 0.8 });
          k.emit(k.on(c.x, c.y, 2), 6 * a, { kind: 'smoke', colour: [SMOKE, ASH], size: 3, sizeEnd: 7, life: [1, 1.8], speed: [0.02, 0.1], up: [8, 14], gravity: -3, jitter: R * 0.7 });
          k.light(c, R, 0.45 * ((total - age) / total) * a + 0.1 * a);
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
          k.orb(pinch, 1.7 * a, { ...COAL, glow: 0.8, bias: 6, turn: k.now * 2 });
          k.light(pinch, 1.2, 0.35 * a);
          k.emit(pinch, 8 * a, { kind: 'ember', size: 1, life: [0.2, 0.4], speed: [0.02, 0.08], up: [4, 10], gravity: 0 });
        }
      },
      travel: {
        secs: (tiles) => 0.25 + tiles * 0.08,
        draw: (k, u) => {
          const from = k.hand(1), to = k.heart(k.target), lift = 5 + k.dist * 2.2;
          const head = arcAt(from, to, u, lift);
          const pts: P3[] = [];
          for (let i = 5; i >= 0; i--) pts.push(arcAt(from, to, Math.max(0, u - i * 0.04), lift));
          k.ribbon(pts, { width: 1.6, alpha: 0.6, main: PALETTE.deep, core: PALETTE.main, glow: 0.4, edge: false });
          k.orb(head, 1.8, { ...COAL, turn: k.now * 8, glow: 0.9 });
          k.light(head, 1.3, 0.45);
          k.emit(head, 14, { kind: 'ember', size: 1.1, life: [0.2, 0.45], speed: [0.02, 0.1], up: [-2, 4], gravity: 6 });
        },
      },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 14, { kind: 'spark', colour: [GOLD, PALETTE.main], size: 1.4, life: [0.2, 0.4], speed: [0.4, 1], up: [8, 22], gravity: 50 });
        k.burst(at, 5, { kind: 'smoke', colour: SMOKE, size: 2, life: [0.5, 0.9], speed: [0.05, 0.15], up: [6, 12] });
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
    cast: { timing: { secs: 1.2, release: 0.5 }, pose: pyrePose },
    fx: {
      charge: (k, t) => {
        const R = k.fx.reach ?? 3;
        const fists = mid3(k.hand(0), k.hand(1), 0.5);
        kindle(k, fists, seg(t, 0, 0.45), 2);
        // The ruby whitening as it is lifted; the ground round about darkening and ringed, as if holding its breath.
        const g = smooth(seg(t, 0.15, 0.48)) * (1 - seg(t, 0.5, 0.56));
        k.glow(fists, 4 + 8 * g, (0.3 + 0.5 * g) * (1 - seg(t, 0.5, 0.56)), g > 0.6 ? PALETTE.core : PALETTE.light);
        k.light(fists, 1.5 + 1.5 * g, 0.5 * g);
        k.ring(k.caster, R, { band: 0.1, alpha: 0.5 * g, glow: 0.6, turn: k.now * 0.4, main: PALETTE.deep, deep: PALETTE.ink });
        k.disc(k.caster, R, { main: '#2a140c', alpha: 0.25 * g });
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
          k.burst(k.on(at.x, at.y, 2), 14, { kind: 'spark', colour: [PALETTE.core, GOLD], size: 1.8, life: [0.3, 0.7], speed: [0.1, 0.5], up: [30, 70], gravity: 50 });
        }
        k.burst(k.at(c, 0.05), 20, { kind: 'dust', colour: [DIRT, ASH], size: 3.5, sizeEnd: 7, life: [0.5, 0.9], speed: [R * 0.5, R], up: [2, 6], gravity: 2, drag: 0.2 });
      },
      impact: {
        secs: 0.9,
        draw: (k, u) => {
          const R = k.fx.reach ?? 3;
          const c = k.on(k.state.x ?? k.caster.x, k.state.y ?? k.caster.y);
          // The whole round at once: a field of tongues standing up everywhere in it in the same instant.
          const env = easeOut(seg(u, 0, 0.1)) * (1 - smooth(seg(u, 0.3, 1)));
          const heat = cooling(seg(u, 0.1, 0.8));
          const n = k.fast ? 12 : 30, arcs = 6;
          const groups: Flame[][] = Array.from({ length: arcs + 1 }, () => []);
          for (let i = 0; i < n; i++) {
            const at = inDisc(k, c, R * 0.97, i, 67);
            const d = Math.hypot(at.x - c.x, at.y - c.y);
            const h = (10 + 10 * hashOf(k.seed + 69, i)) * env * flick(k.now, i);
            const f = upright(k, k.on(at.x, at.y, 0.2), h, 2.4 + 1.2 * hashOf(k.seed + 71, i), heat + (hashOf(k.seed + 73, i) < 0.3 ? 0.5 : 0), 0.1 * Math.sin(k.now * 4 + i), sway(k.now, i));
            const sector = d < R * 0.3 ? arcs : Math.floor(((Math.atan2(at.y - c.y, at.x - c.x) + Math.PI) / TAU) * arcs) % arcs;
            groups[sector].push(f);
          }
          for (let j = 0; j <= arcs; j++) {
            const ang = ((j + 0.5) / arcs) * TAU - Math.PI;
            const at = j === arcs ? k.on(c.x, c.y) : k.on(c.x + Math.cos(ang) * R * 0.65, c.y + Math.sin(ang) * R * 0.65);
            flameGroup(k, at, groups[j], 1);
          }
          k.disc(c, R, { main: u < 0.2 ? PALETTE.core : PALETTE.main, alpha: 0.4 * (1 - smooth(u * 1.4)) });
          k.ring(c, R, { band: 0.22, alpha: 1 - seg(u, 0.5, 1), glow: 1, main: PALETTE.accent });
          k.light(c, R + 1.5, 1 - 0.5 * u);
          // And every creature in it alight with the ground, in the same instant.
          for (const [i, b] of marked(k, 'p', c, R * 2)) alight(k, b, 12 * env, heat, 1, i);
        },
      },
      linger: {
        // The scorched round's own, not a number of the spell's (it is over when it lands): long enough to see it smoke.
        secs: 2.5,
        on: 'spot',
        draw: (k, age, left) => {
          const R = k.fx.reach ?? 3;
          const a = smooth(left / 1.5);
          const c = k.on(k.state.x ?? k.caster.x, k.state.y ?? k.caster.y);
          k.disc(c, R * 0.95, { main: '#2a1a12', alpha: 0.2 * a });
          k.ring(c, R, { band: 0.08, alpha: 0.5 * a, glow: 0.5, main: PALETTE.deep, deep: PALETTE.ink });
          k.emit(k.on(c.x, c.y, 1), 14 * a, { kind: 'smoke', colour: [SMOKE, ASH], size: 2.5, sizeEnd: 6, life: [0.8, 1.4], speed: [0.02, 0.08], up: [8, 14], gravity: -3, jitter: R * 0.8 });
          k.emit(k.on(c.x, c.y, 0.5), 14 * a, { kind: 'ember', size: 1.3, life: [0.4, 0.9], speed: [0.02, 0.1], up: [6, 14], gravity: 0, jitter: R * 0.8 });
          k.light(c, R, 0.3 * a);
        },
      },
    },
  },
};

/** The beats a cast released at `release` has, for an effect timed to its own pose. */
function beatsOf(release: number): { top: number; let: number; through: number; back: number } {
  return beats({ timing: { secs: 1, release }, facing: 0, moving: false, carry: null });
}

/**
 * Where a Meteor will fall, at exactly the tiles its fire reaches: a ring
 * drawn on as the arms go up, a dashed ring inside it turning the other way
 * and a small one round the creature it is aimed at, all brightening from
 * the red of a warning to the yellow of heat as it comes down (`heat`).
 */
function meteorMark(k: FxScene, W: number, grow: number, heat: number): void {
  const a = smooth(grow * 1.6);
  if (a <= 0.01) return;
  const main = heat > 0.6 ? PALETTE.accent : heat > 0.25 ? PALETTE.main : PALETTE.deep;
  const deep = heat > 0.6 ? PALETTE.main : PALETTE.ink;
  const r = W * easeOut(grow);
  k.ring(k.spot, r, { band: 0.09, alpha: 0.9 * a, glow: 0.5 + heat, main, deep, turn: k.seed });
  k.ring(k.spot, r * 0.84, { band: 0.05, alpha: 0.7 * a, dash: 3, glow: 0, main, deep, turn: -k.now * 0.5 });
  k.ring(k.spot, Math.max(0.2, footOf(k.target)), { band: 0.05, alpha: 0.8 * smooth(grow * 2 - 0.8), glow: 0.4, main, deep, turn: k.now });
}

/** Where a Meteor kindles and falls from: high over the ground behind the caster's shoulder, toward the target. */
function skyOf(k: FxScene): P3 {
  const dir = k.toward(k.caster, k.spot);
  return k.on(k.spot.x - dir.x * 3.5 - dir.y * 1.2, k.spot.y - dir.y * 3.5 + dir.x * 1.2, 95);
}
