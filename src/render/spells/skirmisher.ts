/**
 * The Skirmisher's spells: how each is cast and what it looks like.
 *
 * A Skirmisher fights from a few tiles off with something thrown, so nearly
 * every spell here is a throw, and what tells them apart has to be the body
 * and the flight: a flick from the ear, a crow-hop and a long lob, a sidearm
 * whip while turning to go, a two-handed heave, a low underhand at the
 * belly, a throw and a leap back, two in a rhythm, a skim that glances on, a
 * whole turn that sends a fan. The group's own marks are what the weapon
 * leaves in the air and on the ground: a two-tailed wake, thin as a
 * swallow's, behind whatever is thrown, and chevrons in sand on the land --
 * pointing where it went, and one to a second wherever a spell lasts, so a
 * buff or a mark is seen running out.
 *
 * ## The weapon that is thrown
 *
 * It is the figure's own weapon up to the moment it leaves the hand: a
 * javelin taken into the arms (`Rig.wieldStaff`) and laid along the line of
 * the throw by putting the fist where the throw has it, closed along that
 * line (`reach` with a `haft`), an axe or a knife carried by the forearm
 * (`wield`). As it goes the hand is emptied (`Rig.thrown`) and the effects
 * take it over from where the figure had it -- its grip and its point, read
 * off the posed figure every frame up to the release -- so the one in the air
 * starts exactly where the one in the hand was. The empty hand comes down and
 * back to the right hip for the next, where the carry keeps one, and the
 * weapon is in it again from the moment the fist is there -- below the head,
 * never conjured over it.
 *
 * `Held` below is when each spell has what in the hand, read by the pose and
 * the effects alike so that the two never disagree.
 */
import { KNIFE_BLEED_SECS, reachOf, STAGGER_MAUL } from '../../game/fight';
import { WEAPON_BY_ID } from '../../game/gear';
import { weaponCarry, weaponSpan, type Euler, type Rig } from '../figure';
import { HALF_W, UNITS_PER_TILE } from '../iso';
import type { CastPose, CastTiming, PoseCue, SpellVisual } from './index';
import { spellInfo } from './info';
import { arcAt, bump, clamp, dry, easeBack, easeOut, eatTail, flashOf, hashOf, lateFade, lerp, mid3, seg, smooth, TAU, type Body, type FxScene, type GroundLayer, type P3, type SpellPalette } from './kit';
import { euler, one, stepIn, track, type Key } from './poses';

/** Sea teal and sand: quick, light, gone. */
export const PALETTE: SpellPalette = {
  core: '#e2fff9',
  main: '#4fc2b4',
  deep: '#1f6e69',
  accent: '#e8c68a',
  ink: '#123532',
  light: '#7cf0df',
};

/* ---- numbers -------------------------------------------------------------------------- */

/** A spell's own numbers, read off the game's tables, so nothing here is written twice. */
const fxOf = (id: string): Readonly<Record<string, number>> => spellInfo(`skirmisher_${id}`)?.fx ?? {};

/* ---- what is in the hand, and when ------------------------------------------------------ */

/**
 * When a throw's weapon leaves the hand and when the next is in it, as
 * fractions of the cast: `throws[i]` it goes, `draws[i]` the next is in the
 * hand.
 */
interface Held {
  timing: CastTiming;
  throws: readonly number[];
  draws: readonly number[];
}

/** Whether the hand is empty at `t`: between a throw and the drawing of the next. */
const emptyAt = (h: Held, t: number): boolean => h.throws.some((at, i) => t >= at && t < h.draws[i]);
/** The next throw at or after `t`, or -1 when all are gone. */
const nextThrow = (h: Held, t: number): number => h.throws.findIndex((at) => t < at);

/**
 * The weapon in the arms and the hand emptied, as `Held` says: what every
 * throw's pose ends with. Empty, the throwing hand is opened and spread, as a
 * hand that has just let something go is.
 */
function holdFor(r: Rig, t: number, c: PoseCue, h: Held): void {
  const gone = emptyAt(h, t);
  r.thrown = gone;
  if (c.carry === 'fist') r.wield = 1;
  else r.wieldStaff = 1;
  if (gone) r.shape = [r.shape?.[0], { flat: 0.55, claw: 0.3 }];
}

/** A place for the right fist and the way a javelin in it lies, at a moment of a throw: the body's frame, from its feet. */
interface JavelinKey {
  t: number;
  /** Where the fist is: right, ahead, up, in height units from the middle of the feet. */
  at: readonly [number, number, number];
  /** Which way the javelin lies through it, point first. */
  lie: readonly [number, number, number];
  /** Where the elbow goes. */
  pole?: readonly [number, number, number];
}

/** The fist and the javelin as a carry has them, hanging by the right hip and leant forward: where a throw starts and ends. */
const CARRIED: Omit<JavelinKey, 't'> = { at: [2.5, 0.9, 6.9], lie: [0.16, 0.36, 0.92], pole: [3, -2, 4] };
/** The empty hand on its way down from the follow-through: by the right thigh, a little back, the palm in. */
const DOWN_BY_HIP: Omit<JavelinKey, 't'> = { at: [2.9, -0.4, 7.6], lie: [0.12, 0.3, 0.95], pole: [3.5, -2.5, 4] };

/**
 * The end of every javelin throw's keys: from the follow-through at `thr` the empty hand comes down by the hip
 * and back to the carry, which it reaches at `draw` -- the moment `Held` puts the next javelin in it -- and holds.
 */
const backToHip = (thr: number, draw: number): JavelinKey[] => [
  { t: lerp(thr, draw, 0.55), ...DOWN_BY_HIP },
  { t: draw, ...CARRIED },
  { t: 1, ...CARRIED },
];

/**
 * A javelin thrown, for a pose with one in the hand (`carry 'staff'`, or
 * nothing in the hand at all): the right fist put through `keys`, closed along
 * the way the javelin lies at each, and the javelin taken into it. Turned with
 * the hips by `spin` degrees, for a throw made turning. An axe or a knife is
 * left to the arm's own angles.
 */
function javelinThrow(r: Rig, t: number, c: PoseCue, keys: readonly JavelinKey[], spin = 0): void {
  if (c.carry === 'fist') return;
  const at = track(t, keys.map((q) => [q.t, q.at] as const));
  const lie = track(t, keys.map((q) => [q.t, q.lie] as const));
  const pole = track(t, keys.map((q) => [q.t, q.pole ?? [3, -2, 4]] as const));
  const turn = (v: number[]): [number, number, number] => {
    if (!spin) return [v[0], v[1], v[2]];
    const a = (spin * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
    return [v[0] * cs - v[1] * sn, v[0] * sn + v[1] * cs, v[2]];
  };
  // Square across the fist is along the hand's own y, which is the way `reach` closes it.
  r.haft = -90;
  r.reach = [r.reach?.[0], { at: turn(at), haft: turn(lie), pole: turn(pole) }];
}

/**
 * The arm reaching for the next axe or knife after a throw, from `from` to
 * `to` of the cast: down to the right hip, where it hangs. Laid over whatever
 * the arm was doing between. A javelin's reach is in its keys.
 */
function reachForNext(r: Rig, t: number, c: PoseCue, from: number, at: number, to: number): void {
  if (c.carry !== 'fist' || t <= from || t >= to) return;
  const w = t < at ? smooth(seg(t, from, at)) : 1 - smooth(seg(t, at, to));
  const back = [-8, 22, -6];
  for (let j = 0; j < 3; j++) r.arm[1][j] = lerp(r.arm[1][j], back[j], w);
  r.elbow[1] = lerp(r.elbow[1], 62, w);
  r.open[1] = false;
}

/* ---- directions in the world ---------------------------------------------------------------- */

const U = UNITS_PER_TILE;
/** A direction in the island's terms, with x and y in height units (a fortieth of a tile) so it can be turned and measured as z is. */
interface V { x: number; y: number; z: number }
const unitV = (x: number, y: number, z: number): V => {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
};
/** From a point, `len` height units along a direction. */
const along = (p: P3, d: V, len: number): P3 => ({ x: p.x + (d.x * len) / U, y: p.y + (d.y * len) / U, z: p.z + d.z * len });
const between = (a: P3, b: P3): V => unitV((b.x - a.x) * U, (b.y - a.y) * U, b.z - a.z);
const mixV = (a: V, b: V, u: number): V => unitV(lerp(a.x, b.x, u), lerp(a.y, b.y, u), lerp(a.z, b.z, u));
/** Which way along the arc of a throw it is going `u` of the way: the slope of `arcAt`. */
const arcDir = (a: P3, b: P3, u: number, lift: number): V => unitV((b.x - a.x) * U, (b.y - a.y) * U, b.z - a.z + 4 * lift * (1 - 2 * u));
/** The level unit step across a direction, to its left as it goes. */
const across = (d: V): { x: number; y: number } => {
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: -d.y / l, y: d.x / l };
};

/** Where a throw at a body goes in: the middle of a person, the shoulder of a creature. */
const aimAt = (k: FxScene, b: Body = k.target): P3 => (b.figure ? k.heart(b) : k.at(b, 0.55));
/** Its belly: a gut throw's mark. */
const gutOf = (k: FxScene, b: Body = k.target): P3 => k.at(b, b.figure ? 0.5 : 0.36);

/* ---- the weapons, drawn -------------------------------------------------------------------- */

type Thrown = 'javelin' | 'axe' | 'knife';
/** What the caster throws: what is in their hand, a javelin when it cannot be told. */
function thrownBy(k: FxScene): Thrown {
  const id = k.caster.figure?.gear?.weapon?.id;
  if (!id) return 'javelin';
  const w = weaponCarry(id);
  if (!w || w.carry === 'staff') return 'javelin';
  return id.includes('knife') ? 'knife' : 'axe';
}

/** A javelin's length behind the fist and ahead of it, in height units: the figure's own javelin, butt to point. */
const JAV = weaponSpan('javelin');
const JAV_BACK = -(JAV?.from ?? 0), JAV_AHEAD = JAV?.to ?? 0;

/**
 * The colours a thrown weapon is drawn in: its own wood and iron, or -- `ghost` -- the spell's copies of it, the
 * light of the group all through with its deep for an edge, so a fan of them is plainly conjured and not five
 * weapons out of one hand.
 */
interface Kit { dark: string; wood: string; vane: string; ironDark: string; ironLit: string; edge: string; haft: string; grip: string }
const REAL: Kit = { dark: '#2a1c10', wood: '#a07a4c', vane: '#e8e0c8', ironDark: '#6f7a84', ironLit: '#d6dde2', edge: '#1e2328', haft: '#21160c', grip: '#5a3f26' };
const ghostKit = (k: FxScene): Kit => ({ dark: k.pal.deep, wood: k.pal.light, vane: k.pal.core, ironDark: k.pal.main, ironLit: k.pal.core, edge: k.pal.deep, haft: k.pal.deep, grip: k.pal.light });

/**
 * A javelin as it is drawn on the body, gripped at `grip` and lying along `d`:
 * an inked ash shaft, the pale vanes at the butt and a long iron head. In two
 * halves, each sorted where it is, so a javelin held across a body is in
 * front of it at one end and behind it at the other.
 */
function javelin(k: FxScene, grip: P3, d: V, o: { alpha?: number; sheen?: number; bias?: number; ahead?: number; scale?: number; ghost?: boolean } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const sc = o.scale ?? 1, col = o.ghost ? ghostKit(k) : REAL;
  const ahead = (o.ahead ?? JAV_AHEAD) * sc;
  const butt = along(grip, d, -JAV_BACK * sc), neck = along(grip, d, Math.min(ahead, JAV_AHEAD - 1.3)), tip = along(grip, d, ahead);
  const midP = mid3(butt, tip, 0.5);
  const bx = k.sx(butt), by = k.sy(butt), nx = k.sx(neck), ny = k.sy(neck), tx = k.sx(tip), ty = k.sy(tip);
  const mx = k.sx(midP), my = k.sy(midP);
  const len = Math.hypot(tx - bx, ty - by) || 1;
  const ux = (tx - bx) / len, uy = (ty - by) / len, px = -uy, py = ux;
  const z = k.zoom, shaft = Math.max(1.1, 0.7 * z * sc), ink = Math.max(0.8, 0.55 * z);
  const sheen = o.sheen ?? 0;
  const pal = k.pal;
  const half = (g: CanvasRenderingContext2D, from: number): void => {
    g.globalAlpha = clamp(a);
    g.lineCap = 'butt';
    const x0 = from ? mx : bx, y0 = from ? my : by, x1 = from ? nx : mx, y1 = from ? ny : my;
    g.strokeStyle = col.dark;
    g.lineWidth = shaft + 2 * ink;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = col.wood;
    g.lineWidth = shaft;
    g.stroke();
    if (sheen > 0.02) {
      // The edge the spell is in: a line of the group's light along the top of the shaft.
      g.globalAlpha = clamp(a * sheen);
      g.strokeStyle = pal.core;
      g.lineWidth = Math.max(0.6, shaft * 0.45);
      g.beginPath();
      g.moveTo(x0 + px * shaft * 0.3, y0 + py * shaft * 0.3);
      g.lineTo(x1 + px * shaft * 0.3, y1 + py * shaft * 0.3);
      g.stroke();
      g.globalAlpha = clamp(a);
    }
    if (!from) {
      // The vanes: two pale blades across each other at the butt.
      const vx = bx + ux * 3.4 * z, vy = by + uy * 3.4 * z, w = 1.7 * z;
      g.fillStyle = col.vane;
      g.strokeStyle = pal.ink;
      g.lineWidth = ink;
      g.beginPath();
      g.moveTo(bx + px * w, by + py * w);
      g.lineTo(vx + px * w * 0.55, vy + py * w * 0.55);
      g.lineTo(vx - px * w * 0.55, vy - py * w * 0.55);
      g.lineTo(bx - px * w, by - py * w);
      g.closePath();
      g.fill();
      g.stroke();
    } else {
      // The head: a long thin leaf of iron, lit on its upper side.
      const w = 1.25 * z * sc, hx = lerp(nx, tx, 0.3), hy = lerp(ny, ty, 0.3);
      g.fillStyle = col.ironDark;
      g.beginPath();
      g.moveTo(nx, ny);
      g.lineTo(hx - px * w, hy - py * w);
      g.lineTo(tx, ty);
      g.closePath();
      g.fill();
      g.fillStyle = col.ironLit;
      g.beginPath();
      g.moveTo(nx, ny);
      g.lineTo(hx + px * w, hy + py * w);
      g.lineTo(tx, ty);
      g.closePath();
      g.fill();
      g.strokeStyle = col.edge;
      g.lineWidth = ink;
      g.beginPath();
      g.moveTo(nx, ny);
      g.lineTo(hx + px * w, hy + py * w);
      g.lineTo(tx, ty);
      g.lineTo(hx - px * w, hy - py * w);
      g.closePath();
      g.stroke();
    }
  };
  // A conjured copy in the air is never held across a body: one record, sorted at its middle, keeps a fan within its shapes.
  if (o.ghost) {
    k.worldDraw(midP, (g) => {
      half(g, 0);
      half(g, 1);
    }, o.bias ?? 0);
    return;
  }
  k.worldDraw(mid3(butt, midP, 0.5), (g) => half(g, 0), o.bias ?? 0);
  k.worldDraw(mid3(midP, tip, 0.5), (g) => half(g, 1), o.bias ?? 0);
}

/**
 * A throwing axe or a knife turning end over end, its middle at `at`, going
 * along `d`, turned `spin` radians: a dark haft and an inked iron head -- a
 * francisca's sweep of a bit, or a knife's straight blade.
 */
function spinner(k: FxScene, kind: 'axe' | 'knife', at: P3, d: V, spin: number, o: { alpha?: number; scale?: number; bias?: number; ghost?: boolean } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const col = o.ghost ? ghostKit(k) : REAL;
  // A shade over its own size: turning end over end it is never seen side on for long, and smaller than this it is a speck.
  const s = (o.scale ?? 1) * 1.25;
  // The plane it turns in: along its way and straight up.
  const f = unitV(d.x, d.y, 0);
  const c = Math.cos(spin), sn = Math.sin(spin);
  const h: V = { x: f.x * sn, y: f.y * sn, z: c }, p: V = { x: f.x * c, y: f.y * c, z: -sn };
  const pt = (alongH: number, alongP: number): [number, number] => {
    const q = along(along(at, h, alongH * s), p, alongP * s);
    return [k.sx(q), k.sy(q)];
  };
  const z = k.zoom, ink = Math.max(0.8, 0.55 * z);
  const butt = pt(kind === 'axe' ? -2.3 : -1.4, 0), top = pt(kind === 'axe' ? 1.6 : 0, 0);
  const head: Array<[number, number]> = kind === 'axe'
    ? [pt(0.5, -0.15), pt(0.4, 0.7), pt(0.2, 1.9), pt(1.6, 2.2), pt(2.6, 1.7), pt(1.9, 0.6), pt(1.7, -0.2)]
    : [pt(0, -0.35), pt(3.2, -0.05), pt(3.6, 0.1), pt(0, 0.35)];
  k.worldDraw(at, (g) => {
    g.globalAlpha = clamp(a);
    g.lineCap = 'round';
    g.strokeStyle = col.haft;
    g.lineWidth = (kind === 'axe' ? 1.4 : 1.6) * z * s + 2 * ink;
    g.beginPath();
    g.moveTo(butt[0], butt[1]);
    g.lineTo(top[0], top[1]);
    g.stroke();
    g.strokeStyle = o.ghost ? col.grip : kind === 'axe' ? '#5a3f26' : '#6b4a2c';
    g.lineWidth = (kind === 'axe' ? 1.4 : 1.6) * z * s;
    g.stroke();
    g.lineCap = 'butt';
    g.fillStyle = col.ironDark;
    g.beginPath();
    head.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    // The upper half of the head catching the light.
    g.fillStyle = col.ironLit;
    g.beginPath();
    g.moveTo(head[0][0], head[0][1]);
    const m = Math.floor(head.length / 2);
    for (let i = 1; i <= m; i++) g.lineTo(head[i][0], head[i][1]);
    g.closePath();
    g.fill();
    g.strokeStyle = col.edge;
    g.lineWidth = ink;
    g.beginPath();
    head.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.stroke();
  }, o.bias ?? 0);
}

/** Whatever is thrown, at a point of its flight: a javelin's point at `tip`, an axe's or a knife's middle there. */
function thrownAt(k: FxScene, kind: Thrown, tip: P3, d: V, spin: number, o: { alpha?: number; sheen?: number; scale?: number; bias?: number; ghost?: boolean } = {}): void {
  if (kind === 'javelin') javelin(k, along(tip, d, -JAV_AHEAD * (o.scale ?? 1)), d, o);
  else spinner(k, kind, tip, d, spin, o);
}

/* ---- the wake ------------------------------------------------------------------------------ */

/**
 * How a wake is drawn: `span` of the flight behind the head, `spread` tiles apart at its widest, `width` pixels.
 * Each throw has one thing of its own: `single` one thick ribbon rather than two tails (a heave), `tint` a colour the
 * tails turn to over the last third of the flight (a gut throw's red), `alpha`.
 */
interface WakeLook { span?: number; spread?: number; width?: number; alpha?: number; deep?: boolean; single?: boolean; tint?: string }

/**
 * The group's wake behind whatever is thrown: two thin tails, a swallow's,
 * opening out behind the head and closing on it, drawn along the last `span`
 * of the flight `path` -- or, `single`, one ribbon down the middle of them.
 */
function wake(k: FxScene, path: (u: number) => P3, u: number, o: WakeLook = {}): void {
  const span = o.span ?? 0.16, spread = o.spread ?? 0.05, a = o.alpha ?? 0.9;
  const n = k.fast ? 4 : 6;
  const head = path(u), back = path(Math.max(0, u - 0.02));
  const side = across(between(back, head));
  const base = o.deep ? k.pal.deep : k.pal.main;
  const main = o.tint ? dry(base, smooth(seg(u, 0.6, 0.85)), o.tint) : base;
  for (const s of o.single ? [0] : [-1, 1]) {
    const pts: P3[] = [];
    for (let i = n; i >= 0; i--) {
      const v = Math.max(0, u - (span * i) / n);
      const p = path(v);
      // Widest a third of the way back from the head, closing to the head and drifting in again at the tail.
      const w = s * spread * Math.sin(Math.PI * Math.min(1, (i / n) * 1.5)) * (u - v > 0 ? 1 : 0);
      pts.push({ x: p.x + side.x * w, y: p.y + side.y * w, z: p.z + Math.abs(w) * 6 });
    }
    k.ribbon(pts, { width: o.width ?? 2.2, taper: 'start', alpha: a, edge: !!o.single, glow: 0.7, main });
  }
}

/** The shadow of something in the air, on the ground under it: smaller and fainter the higher it is. */
function shadowOf(k: FxScene, p: P3, r = 3): void {
  const high = Math.max(0, p.z - k.ground(p.x, p.y));
  const a = 0.26 * clamp(1 - high / 60);
  if (a <= 0.02) return;
  // A flat ellipse on the land, `r` pixels at zoom one across and half that deep: in tiles, as the ground shapes are.
  const R = (r * (1 - 0.4 * clamp(high / 60))) / (HALF_W * 0.7), pts: number[] = [];
  for (let i = 0; i < 8; i++) pts.push(p.x + Math.cos((i / 8) * TAU) * R, p.y + Math.sin((i / 8) * TAU) * R);
  k.groundShape(p.x, p.y, R + 0.1, [{ kind: 'fill', colour: '#0d1a14', alpha: a, paths: [pts], lift: 0.1 }]);
}

/* ---- chevrons ------------------------------------------------------------------------------ */

/**
 * A chevron lying on the ground at (x, y), pointing along (dx, dy), `s`
 * tiles from notch to point: the group's mark on the land. Added to `out` as
 * a path of points on the ground, in tiles.
 */
function chevronOn(x: number, y: number, dx: number, dy: number, s: number, out: number[][]): void {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l, tx = -uy, ty = ux;
  const pts: number[] = [];
  for (const [a, b] of [[s * 0.6, 0], [-s * 0.4, s * 0.55], [-s * 0.1, 0], [-s * 0.4, -s * 0.55]]) pts.push(x + ux * a + tx * b, y + uy * a + ty * b);
  out.push(pts);
}

/**
 * Chevrons on the ground (`chevronOn`'s paths), each at its own alpha by
 * `alphas`: laid on the land as the kit's own ground marks are, those at the
 * same alpha -- all of a count but the one going out -- in one fill and one
 * inking.
 */
function drawChevrons(k: FxScene, cx: number, cy: number, reach: number, paths: number[][], alphas: number[], colour = k.pal.accent, extra: GroundLayer[] = []): void {
  if (!paths.length && !extra.length) return;
  const layers: GroundLayer[] = [...extra];
  const width = Math.max(0.8, 0.6 * k.zoom);
  // After dark the ink and the sand go down into the night's ground: each is laid again in the glow pass, in its own
  // sand, so a count of seconds still reads at night. Nought by day.
  const rim = k.night;
  let i = 0;
  while (i < alphas.length) {
    const a = alphas[i];
    let j = i;
    while (j < alphas.length && Math.abs(alphas[j] - a) < 0.004) j++;
    if (a > 0.01) {
      const some = paths.slice(i, j);
      layers.push({ kind: 'fill', colour, alpha: clamp(a), paths: some, lift: 0.2, glow: 0.9 * rim, light: colour });
      layers.push({ kind: 'stroke', colour: k.pal.ink, alpha: clamp(a), paths: some, lift: 0.2, width, closed: true, join: 'miter', glow: 0.5 * rim, light: colour });
    }
    i = j;
  }
  if (layers.length) k.groundShape(cx, cy, reach + 0.3, layers);
}

/**
 * The group's count of seconds: `total` chevrons round a point on the
 * ground, one to a second, the last of them going out as each second goes
 * by, so how long a spell has left is how many are lit. `point` says which
 * way they face: in at the middle, out from it, or round it.
 */
function tally(k: FxScene, c: { x: number; y: number }, r: number, total: number, left: number, o: { point: 'in' | 'out' | 'round'; size?: number; turn?: number; alpha?: number; colour?: string }): void {
  const n = Math.max(1, Math.round(total));
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const pts: number[][] = [], alphas: number[] = [];
  const s = o.size ?? Math.min(0.1, ((TAU * r) / n) * 0.45);
  for (let i = 0; i < n; i++) {
    // The first at the far side, round clockwise as the screen shows it, so the one going out is always the last before it.
    const ang = (o.turn ?? 0) - Math.PI * 0.75 + (i / n) * TAU;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const lit = clamp(left - i);
    if (lit <= 0) continue;
    const dir = o.point === 'in' ? [-ux, -uy] : o.point === 'out' ? [ux, uy] : [-uy, ux];
    chevronOn(c.x + ux * r, c.y + uy * r, dir[0], dir[1], s, pts);
    alphas.push(a * smooth(lit));
  }
  drawChevrons(k, c.x, c.y, r + s, pts, alphas, o.colour);
}

/**
 * How far something reaches round a point, shown the group's way: a thin
 * dashed line on the ground at the edge, with small chevrons sitting on it
 * pointing out, close enough together (one to every `REACH_STEP` tiles of the
 * edge) to read as one ring rather than arrows strewn about. Runs out to `R`
 * tiles as `u` goes from nought, and goes out again. Where it passes under the
 * caster's own feet it is let go, so it never reads as something at them.
 */
const REACH_STEP = 0.45;
function reachRing(k: FxScene, c: { x: number; y: number }, R: number, u: number): void {
  const r = R * easeOut(seg(u, 0, 0.45));
  const a = smooth(u * 6) * (1 - smooth(seg(u, 0.55, 1)));
  if (r < 0.1 || a <= 0.01) return;
  const n = Math.max(8, Math.round((TAU * R) / REACH_STEP));
  const turn = u * 0.25, s = 0.11;
  const pts: number[][] = [], alphas: number[] = [], dashes: number[][] = [];
  const by = (ang: number): [number, number] => [c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r];
  const clear = (x: number, y: number): number => smooth(seg(Math.hypot(x - k.caster.x, y - k.caster.y), 0.35, 0.8));
  for (let i = 0; i < n; i++) {
    const ang = turn + (i / n) * TAU, [x, y] = by(ang);
    const off = clear(x, y);
    if (off > 0.02) {
      chevronOn(x, y, Math.cos(ang), Math.sin(ang), s, pts);
      // Stepped, so the chevrons share as few fills as they can.
      alphas.push(Math.round(0.9 * a * off * 10) / 10);
    }
    // The dash between this one and the next, clear of both.
    const a0 = ang + ((s * 0.9) / Math.max(r, 0.1)), a1 = ang + TAU / n - ((s * 0.9) / Math.max(r, 0.1));
    if (a1 > a0 && clear(...by((a0 + a1) / 2)) > 0.5) {
      const d: number[] = [];
      for (let j = 0; j <= 2; j++) d.push(...by(lerp(a0, a1, j / 2)));
      dashes.push(d);
    }
  }
  const line: GroundLayer = { kind: 'stroke', colour: k.night > 0.5 ? k.pal.accent : k.pal.ink, alpha: 0.4 * a, paths: dashes, lift: 0.15, width: Math.max(0.8, k.zoom), cap: 'butt', glow: 0.8 * k.night, light: k.pal.accent };
  drawChevrons(k, c.x, c.y, r + s, pts, alphas, k.pal.accent, dashes.length ? [line] : []);
}

/** A chevron standing in the air, in screen points: pointing at `ang` (screen radians), `s` pixels now from notch to point. */
function airChevron(g: CanvasRenderingContext2D, x: number, y: number, ang: number, s: number): void {
  const c = Math.cos(ang), sn = Math.sin(ang);
  const p = (a: number, b: number): [number, number] => [x + c * a - sn * b, y + sn * a + c * b];
  const pts = [p(s * 0.6, 0), p(-s * 0.4, s * 0.55), p(-s * 0.1, 0), p(-s * 0.4, -s * 0.55)];
  g.beginPath();
  pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
  g.closePath();
}

/** A chevron in the air: where on the screen, which way it points (screen radians) and how big now, in pixels. */
type AirMark = readonly [number, number, number, number];

/**
 * Chevrons standing in the air (`airChevron`), filled in `colour` and inked, as one record sorted at `at`; after dark
 * their outlines laid again in the glow pass in the same colour, so they still read at night.
 */
function airChevrons(k: FxScene, at: P3, marks: readonly AirMark[], alpha: number, o: { colour?: string; bias?: number } = {}): void {
  if (alpha <= 0.01 || !marks.length) return;
  const colour = o.colour ?? k.pal.accent, ink = k.pal.ink, z = k.zoom;
  k.worldDraw(at, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'miter';
    for (const [x, y, ang, s] of marks) {
      airChevron(g, x, y, ang, s);
      g.fillStyle = colour;
      g.fill();
      g.lineWidth = Math.max(0.8, 0.5 * z);
      g.strokeStyle = ink;
      g.stroke();
    }
  }, o.bias ?? 0);
  if (k.night > 0.05) {
    k.glowDraw((g) => {
      g.globalAlpha = clamp(alpha * k.night * 0.55);
      g.strokeStyle = colour;
      g.lineWidth = Math.max(1, 1.2 * z);
      g.lineJoin = 'round';
      for (const [x, y, ang, s] of marks) {
        airChevron(g, x, y, ang, s);
        g.stroke();
      }
    });
  }
}

/** A scuff of dust off the ground where a foot pushes or lands: low, small and quick, so it never hides the feet. */
function scuff(k: FxScene, at: P3, n: number, heading?: { x: number; y: number }, far = 1): void {
  k.burst(at, n, { kind: 'dust', colour: ['#9a8a6c', '#b3a383'], size: 1.5, sizeEnd: 3.2, life: [0.3, 0.55], speed: [0.3 * far, 0.8 * far], up: [1, 5], gravity: 6, drag: 0.06, heading, cone: heading ? 1.6 : undefined, bias: -1 });
}

/* ---- other creatures ------------------------------------------------------------------ */

/** A creature's number, from who the stage says it is; -1 for anything else. */
const creatureNo = (b: Body): number => (b.who && b.who.kind === 'creature' ? b.who.id : -1);
/** Whether two bodies are the same one: by who they are when the stage says, else by where they stand. */
const sameBody = (a: Body, b: Body): boolean =>
  a.who && b.who ? a.who.kind === b.who.kind && creatureNo(a) === creatureNo(b) : Math.hypot(a.x - b.x, a.y - b.y) < 0.05;
/**
 * The other enemies standing within `r` tiles of what was hit, nearest first:
 * who a glance or a fan finds. Only what anybody may harm (`enemiesWithin`:
 * no companion, no beast on a deed or in a pen), and never the caster's own
 * companion whatever the stage knows of it. The island does not say who it
 * reached, so this is who is there -- which is who it picks from.
 */
const othersNear = (k: FxScene, r: number): Body[] =>
  k.enemiesWithin(r, k.target).filter((b) => !sameBody(b, k.target) && creatureNo(b) >= 0 && !b.companion && !(k.companion && sameBody(b, k.companion)))
    .sort((a, b) => Math.hypot(a.x - k.target.x, a.y - k.target.y) - Math.hypot(b.x - k.target.x, b.y - k.target.y));
/** A creature found by its number near a point, this frame; null when it is gone from there. */
const creatureBy = (k: FxScene, no: number, c: { x: number; y: number }, r: number): Body | null =>
  k.bodiesWithin(r, c, ['creature']).find((b) => creatureNo(b) === no) ?? null;

/* ---- the moment it lands ---------------------------------------------------------------- */

/** Where a throw bites: sparks thrown on through, splinters of sand-coloured light, a little dust off the ground under it. */
function bite(k: FxScene, at: P3, d: V, power = 1): void {
  const on = { x: d.x, y: d.y };
  k.burst(at, Math.round(14 * power), { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 1.8, life: [0.18, 0.4], speed: [1.2, 2.8 * power], up: [-4, 22], heading: on, cone: 1.3, gravity: 50, drag: 0.05 });
  k.burst(at, Math.round(5 * power), { kind: 'shard', colour: [k.pal.accent, k.pal.main], size: 1.6, life: [0.3, 0.55], speed: [0.4, 1.1], up: [6, 22], heading: { x: -on.x, y: -on.y }, cone: 2.2, gravity: 70, spin: 3, bias: 2 });
}

/** The glint where it bites: four points of light turned along its way, out quick and gone slower. */
function glint(k: FxScene, at: P3, u: number, r = 7): void {
  k.flare(at, r * (1.2 - 0.5 * u), flashOf(u, 0.1), k.pal.core, 0.4 + u * 0.4);
}

/**
 * What was thrown, stood in what it hit for a beat after, its point in: then gone, fading over the last third. Never
 * steeper than a lob comes down at, so a short lob's javelin does not stand up out of the creature's back taller
 * than it; `ghost` for one of a fan's conjured copies.
 */
function stuck(k: FxScene, kind: Thrown, at: P3, d: V, u: number, spin: number, o: { ghost?: boolean; alpha?: number } = {}): void {
  const a = (1 - smooth(seg(u, 0.6, 1))) * (o.alpha ?? 1);
  let h = Math.hypot(d.x, d.y);
  let dx = d.x, dy = d.y;
  if (h < 0.25) {
    const f = k.toward(k.caster, at);
    dx = f.x; dy = f.y; h = 1;
  }
  const lay = unitV(dx, dy, Math.max(d.z, -0.55 * h));
  if (kind === 'javelin') javelin(k, along(at, lay, -JAV_AHEAD + 2.2), lay, { alpha: a, ahead: JAV_AHEAD, ghost: o.ghost, scale: o.ghost ? 0.7 : 1 });
  else spinner(k, kind, along(at, lay, -1.2), lay, spin, { alpha: a, ghost: o.ghost });
}

/* ---- a flight ----------------------------------------------------------------------------- */

/** How a throw flies: seconds a tile and over, and how high its arc goes over a straight line, by distance. */
interface Flight {
  perTile: number;
  base: number;
  lift: (tiles: number) => number;
  /** Turns a second, end over end, of an axe or a knife. */
  turns: number;
}
const flightSecs = (f: Flight) => (tiles: number): number => f.base + tiles * f.perTile;

/**
 * The weapon as the figure holds it, kept every frame it is in the hand
 * before a throw: its fist and its point. Read off the posed figure, so the
 * one that flies starts where the one in the hand was on the last frame it
 * was there, whatever the pose did.
 */
function followHeld(k: FxScene, h: Held, t: number): void {
  if (emptyAt(h, t) || nextThrow(h, t) < 0) return;
  const g = k.joint(k.caster, 'grip'), q = k.joint(k.caster, 'tip');
  k.state.gx = g.x; k.state.gy = g.y; k.state.gz = g.z;
  k.state.qx = q.x; k.state.qy = q.y; k.state.qz = q.z;
}

/** At a throw: where it left the hand, kept under `key` for its flight. */
function letGo(k: FxScene, key = 'h'): void {
  for (const a of ['x', 'y', 'z']) {
    k.state[`${key}g${a}`] = k.state[`g${a}`] ?? k.hand(1)[a as 'x'];
    k.state[`${key}q${a}`] = k.state[`q${a}`] ?? k.hand(1)[a as 'x'];
  }
}

/** Where a throw kept under `key` starts its flight -- a javelin's point, an axe's or a knife's middle -- and how it lay as it went. */
function launchOf(k: FxScene, key = 'h'): { from: P3; lay: V } {
  if (k.state[`${key}gx`] === undefined) {
    const hand = k.hand(1);
    return { from: hand, lay: between(hand, aimAt(k)) };
  }
  const g = { x: k.state[`${key}gx`], y: k.state[`${key}gy`], z: k.state[`${key}gz`] };
  const q = { x: k.state[`${key}qx`], y: k.state[`${key}qy`], z: k.state[`${key}qz`] };
  const near = Math.hypot((q.x - g.x) * U, (q.y - g.y) * U, q.z - g.z) < 0.5;
  const lay = near ? between(g, aimAt(k)) : between(g, q);
  return { from: thrownBy(k) === 'javelin' ? q : mid3(g, q, 0.5), lay };
}

/**
 * A throw on its way, `u` of it, from where it left the hand to `to`: the
 * weapon at its point of the arc -- a javelin swinging from how it lay in the
 * hand onto the line of its flight over the first of it, an axe or a knife
 * turning end over end from how it was held -- the wake behind, its shadow on
 * the ground and a little light round its head at night.
 */
/** What a flight has of its own besides its wake: a sand chevron on the ground under it pointing on (`chevron`), dust shed behind (`dust`). */
interface FlightMarks { chevron?: boolean; dust?: boolean }

function flying(k: FxScene, f: Flight, launch: { from: P3; lay: V }, to: P3, u: number, o: { wake?: WakeLook; scale?: number; light?: number; alpha?: number; lift?: number; ghost?: boolean } & FlightMarks = {}): { at: P3; d: V } {
  const kind = thrownBy(k);
  const from = launch.from;
  const lift = o.lift ?? f.lift(k.dist);
  const path = (v: number): P3 => arcAt(from, to, v, lift);
  const at = path(u), d = arcDir(from, to, u, lift);
  wake(k, path, u, o.wake);
  if (kind === 'javelin') thrownAt(k, kind, at, mixV(launch.lay, d, smooth(u / 0.2)), 0, { sheen: 0.9, scale: o.scale, alpha: o.alpha, ghost: o.ghost });
  else {
    // From how the haft lay in the fist, end over end in the plane of the flight.
    const fl = Math.hypot(d.x, d.y) || 1;
    const spin0 = Math.atan2((launch.lay.x * d.x + launch.lay.y * d.y) / fl, launch.lay.z);
    const spin = spin0 + (k.now - (k.state.t0 ?? k.now)) * f.turns * TAU;
    thrownAt(k, kind, at, d, spin, { sheen: 0.9, scale: o.scale, alpha: o.alpha, ghost: o.ghost });
  }
  if (o.chevron) {
    // A long throw's shadow is a chevron of sand running over the ground under it, pointing where it will come down.
    const pts: number[][] = [];
    chevronOn(at.x, at.y, d.x, d.y, 0.2, pts);
    drawChevrons(k, at.x, at.y, 0.3, pts, [0.85 * (o.alpha ?? 1)]);
  } else shadowOf(k, at, kind === 'javelin' ? 4 : 3);
  // A heave sheds a little dust off the weapon as it goes, low and heavy.
  if (o.dust && !k.fast) k.emit(at, 22, { kind: 'mist', colour: ['#b3a383', '#cbbd9c'], size: 1.2, sizeEnd: 2.6, life: [0.25, 0.45], speed: [0.02, 0.08], up: [-3, 0], gravity: 4, bias: -1 });
  k.glow(at, 7, 0.45 * (o.alpha ?? 1));
  if (o.light) k.light(at, 0.8, o.light);
  return { at, d };
}

/* ---- the casts --------------------------------------------------------------------------- */

/** Keys for a joint, eased between: `euler` with a pose's beats as plain numbers. */
const E = (t: number, keys: readonly Key[]): Euler => euler(t, keys);

/*
 * Snap Throw: no wind-up to speak of. The fist comes up only to the front of
 * the shoulder, never behind the ear, the elbow stays bent near square, and
 * it goes off the wrist -- a flick -- over a short step onto the front foot
 * and a nod of the trunk after it. Half a second, the quickest thing the
 * Skirmisher does, because what it buys is time: the next swing a second
 * sooner (`fx.sooner`), counted down by a sand hand going once round the grip
 * of the weapon that will swing it.
 */
const SNAP: Held = { timing: { secs: 0.55, release: 0.4, blendIn: 0.1, blendOut: 0.3 }, throws: [0.4], draws: [0.8] };
const SNAP_FLIGHT: Flight = { perTile: 0.03, base: 0.03, lift: (d) => 0.6 + d * 0.5, turns: 4 };
const snapPose: CastPose = (r, t, c) => {
  const cock = 0.24, rel = 0.4, thr = 0.52;
  r.arm[1] = E(t, [[0, [26, 14, 0]], [cock, [120, 48, -10]], [rel, [112, 30, 0]], [thr, [92, 18, 8]], [1, [22, 12, 4]]]);
  r.elbow[1] = one(t, [[0, 36], [cock, 92], [rel, 70], [thr, 56], [1, 28]]);
  // All of it in the wrist: cocked back, then snapped through.
  r.hand[1] = E(t, [[0, [0, 0, 0]], [cock, [56, 0, 0]], [rel, [-50, 0, 0]], [thr, [-58, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = E(t, [[0, [30, 12, -6]], [cock, [58, 14, -10]], [rel, [30, 20, 0]], [1, [14, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 60], [cock, 72], [rel, 44], [1, 30]]);
  r.chest = E(t, [[0, [0, 0, 0]], [cock, [4, -2, -10]], [rel, [-6, 2, 10]], [thr, [-8, 2, 8]], [1, [0, 0, 2]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [cock, [3, 0, -3]], [rel, [-6, 0, 4]], [thr, [-10, 0, 4]], [0.75, [-4, 0, 0]], [1, [-1, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [cock, [-2, 0, 8]], [rel, [-4, 0, -8]], [1, [0, 0, 0]]]);
  reachForNext(r, t, c, 0.6, 0.8, 0.95);
  // An axe or a knife cocked by the right ear and outside it, the elbow out to the side, so the forearm never crosses the face.
  if (c.carry === 'fist') {
    // Up the outside: out from the hip to the side first, then up by the ear.
    const w = one(t, [[0.02, 0], [0.1, 1], [rel - 0.03, 0.5], [rel + 0.02, 0]]);
    const at = track(t, [[0, [3.2, 0.8, 7.0]], [0.12, [5.2, 0.4, 10.4]], [cock, [4.2, -0.4, 14.8]], [rel, [3.0, 2.4, 14.2]]]);
    if (w > 0) r.reach = [r.reach?.[0], { at: [at[0], at[1], at[2]], pole: [8, -1, 9], w }];
  }
  javelinThrow(r, t, c, [
    { t: 0, ...CARRIED },
    // Up the outside of the arm, never across the face.
    { t: 0.12, at: [4.4, 0.6, 10.6], lie: [0.1, 0.7, 0.7], pole: [7, -1, 7] },
    { t: cock, at: [3.0, 1.0, 14.2], lie: [0.02, 0.8, 0.6], pole: [6, -1, 9] },
    { t: rel, at: [2.4, 3.6, 14.2], lie: [0, 0.99, 0.12], pole: [4.5, 0, 8] },
    { t: thr, at: [2.0, 4.4, 12.2], lie: [0, 0.94, -0.34], pole: [4.5, -1, 7] },
    ...backToHip(thr, SNAP.draws[0]),
  ]);
  holdFor(r, t, c, SNAP);
  // A short step onto the front foot as it goes, and back.
  stepIn(r, t, c, { hit: rel, from: 0.12, back: 0.6, by: 4, bend: 16 });
};

/*
 * Long Throw: a run-up of one crossover step and a hop, the javelin drawn
 * right back at arm's length behind the right shoulder, the body laid back
 * over the rear leg -- and let go high, into an arc that lobs it up to two
 * tiles past where a throw would reach (`fx.past`). While it is wound up a
 * line of chevrons runs out over the ground to where it will come down,
 * those past the weapon's own reach in the brighter sand.
 */
const LONG: Held = { timing: { secs: 1.25, release: 0.56, blendIn: 0.1, blendOut: 0.24 }, throws: [0.56], draws: [0.84] };
/** A lob: high over a long way, but brought down for a short one so it comes in, not straight down. */
const LONG_FLIGHT: Flight = { perTile: 0.06, base: 0.08, lift: (d) => (5 + Math.max(d, 3) * 2.4) * Math.min(1, d / 3), turns: 1.6 };
const longPose: CastPose = (r, t, c) => {
  const gather = 0.18, hop = 0.32, top = 0.48, rel = 0.56, thr = 0.68;
  r.arm[1] = E(t, [[0, [24, 14, 0]], [gather, [40, 50, 0]], [hop, [-20, 74, 8]], [top, [-34, 78, 8]], [rel, [158, 18, 4]], [thr, [52, -12, 32]], [1, [18, 12, 4]]]);
  r.elbow[1] = one(t, [[0, 34], [gather, 30], [hop, 12], [top, 8], [rel, 14], [thr, 30], [1, 26]]);
  r.arm[0] = E(t, [[0, [24, 10, 0]], [gather, [50, 12, -8]], [hop, [88, 8, -10]], [top, [96, 6, -12]], [rel, [30, 26, 6]], [thr, [-10, 30, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [hop, 16], [top, 12], [rel, 60], [thr, 50], [1, 24]]);
  r.open[0] = t > gather && t < rel;
  r.chest = E(t, [[0, [0, 0, 0]], [gather, [2, 0, -16]], [hop, [6, -4, -34]], [top, [10, -6, -40]], [rel, [-10, 6, 20]], [thr, [-14, 4, 26]], [1, [0, 0, 4]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [hop, [6, 0, -8]], [top, [14, -4, -10]], [rel, [-14, 2, 8]], [thr, [-22, 0, 10]], [1, [-2, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [hop, [-4, 0, 30]], [top, [-10, 4, 38]], [rel, [-6, 0, -14]], [thr, [-4, 0, -18]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 2, 0]], [gather, [14, 3, 0]], [hop, [30, 4, 0]], [top, [34, 6, 0]], [rel, [30, 4, 0]], [thr, [26, 3, 0]], [1, [6, 2, 0]]]);
  r.knee[0] = one(t, [[0, 6], [gather, 20], [hop, 26], [top, 10], [rel, 20], [thr, 34], [1, 8]]);
  r.leg[1] = E(t, [[0, [0, 2, 0]], [gather, [-10, 2, 0]], [hop, [-2, 8, 0]], [top, [-14, 6, 0]], [rel, [-28, 3, 0]], [thr, [-44, 3, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 6], [gather, 10], [hop, 40], [top, 26], [rel, 18], [thr, 52], [1, 6]]);
  r.lift = one(t, [[0, 0], [gather, 0], [hop, 2.6], [top, 0], [1, 0]]);
  reachForNext(r, t, c, 0.7, 0.84, 0.97);
  // Raised by the shoulder, drawn right back at arm's length behind it through the hop and the plant -- the shaft
  // running back past the shoulder, clear of the face -- then up and over high.
  javelinThrow(r, t, c, [
    { t: 0, ...CARRIED },
    { t: gather, at: [4.2, -1.8, 11.4], lie: [0.2, 0.86, 0.46], pole: [6, -2, 7] },
    { t: hop, at: [3.8, -5.4, 15.2], lie: [0.3, 0.78, 0.55], pole: [5, -3, 9] },
    { t: top, at: [3.8, -5.8, 15.0], lie: [0.3, 0.78, 0.55], pole: [5, -3, 9] },
    { t: rel, at: [2.0, 3.0, 16.2], lie: [0, 0.88, 0.47], pole: [5, 0, 10] },
    { t: thr, at: [0.4, 4.6, 8.8], lie: [0, 0.88, 0.47], pole: [4, -1, 5] },
    ...backToHip(thr, LONG.draws[0]),
  ]);
  r.mouth = one(t, [[0, 0], [top, 0.1], [rel, 0.5], [thr, 0.2], [0.8, 0]]);
  holdFor(r, t, c, LONG);
};

/*
 * Hit and Run: a sidearm whip at the height of the shoulder while already
 * turning to go -- the throw lets go flat across the body and the chest and
 * the hips keep turning away, the head left looking back over the shoulder at
 * what was hit, the back foot stepping off. With a knife in the hand it is a
 * blow instead (`runKnifePose`): a dart in, a cut across, and the same turn
 * away. Then for `fx.secs` the pace it buys: streamers of wind off the heels
 * and a trail of chevrons behind, one to a second.
 */
const RUN: Held = { timing: { secs: 0.75, release: 0.42, blendIn: 0.1 }, throws: [0.42], draws: [0.78] };
const RUN_FLIGHT: Flight = { perTile: 0.038, base: 0.04, lift: (d) => 1 + d * 0.8, turns: 3.4 };
/** The knife's dart in, the cut across and the spring back out, as fractions of the cast. */
/** Tiles the wind streams back off a heel. */
const RUN_STREAM = 0.22;
const RUN_IN = 0.1, RUN_CUT = 0.34, RUN_THROUGH = 0.46, RUN_OUT = 0.74;

/**
 * Whether the caster's weapon is a knife, which the pose cannot see (it is told only that it is carried in the
 * fist, as a throwing axe is): said by the effects each frame of the cast and kept by the caster's look, which the
 * pose is given.
 */
const KNIFE_IN = new WeakMap<object, boolean>();
const NO_LOOK = {};
const knifeIn = (c: PoseCue): boolean => c.carry === 'fist' && (KNIFE_IN.get(c.look ?? NO_LOOK) ?? false);
const sayKnife = (k: FxScene): void => {
  KNIFE_IN.set(k.caster.figure?.look ?? NO_LOOK, thrownBy(k) === 'knife');
};

const runThrowPose: CastPose = (r, t, c) => {
  const wind = 0.28, rel = 0.42, thr = 0.56, off = 0.74;
  r.arm[1] = E(t, [[0, [22, 14, 0]], [wind, [80, 84, -24]], [rel, [92, 24, 26]], [thr, [74, -16, 44]], [off, [20, 10, 10]], [1, [16, 10, 4]]]);
  r.elbow[1] = one(t, [[0, 32], [wind, 50], [rel, 8], [thr, 20], [off, 40], [1, 30]]);
  r.hand[1] = E(t, [[0, [0, 0, 0]], [wind, [10, 0, 30]], [rel, [-20, 0, -30]], [1, [0, 0, 0]]]);
  r.arm[0] = E(t, [[0, [20, 10, 0]], [wind, [50, 20, -14]], [rel, [10, 30, 0]], [off, [-24, 14, 0]], [1, [8, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [wind, 70], [rel, 40], [off, 60], [1, 26]]);
  r.chest = E(t, [[0, [0, 0, 0]], [wind, [2, -4, -34]], [rel, [-4, 4, 18]], [thr, [-4, 2, 36]], [off, [-6, 0, 30]], [1, [0, 0, 4]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [wind, [2, 4, -10]], [rel, [-6, 2, 10]], [off, [-10, 0, 18]], [1, [-2, 0, 0]]]);
  r.pelvis = E(t, [[0, [0, 0, 0]], [wind, [0, 0, -8]], [rel, [0, 0, 8]], [off, [0, 0, 30]], [1, [0, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [wind, [-2, 0, 24]], [rel, [-4, 0, -6]], [thr, [-2, 0, -30]], [off, [0, 0, -50]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 2, 0]], [wind, [14, 4, 0]], [rel, [22, 4, 0]], [off, [8, 6, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 6], [wind, 22], [rel, 26], [off, 16], [1, 6]]);
  r.leg[1] = E(t, [[0, [0, 2, 0]], [rel, [-14, 4, 0]], [thr, [-22, 12, 0]], [off, [-30, 16, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 6], [wind, 18], [rel, 10], [off, 38], [1, 6]]);
  reachForNext(r, t, c, 0.6, 0.78, 0.95);
  // Drawn back out to the side at the shoulder, whipped flat across the front at that height, and on across the body as it turns off.
  javelinThrow(r, t, c, [
    { t: 0, ...CARRIED },
    { t: wind, at: [4.6, -2.6, 12.4], lie: [0.1, 0.99, 0.06], pole: [4, -3, 9] },
    { t: rel, at: [2.6, 4.2, 12.8], lie: [0, 0.99, 0.08], pole: [5, 0, 9] },
    { t: thr, at: [-0.6, 3.8, 11.0], lie: [-0.2, 0.97, 0.08], pole: [3, -1, 7] },
    ...backToHip(thr, RUN.draws[0]),
  ]);
  holdFor(r, t, c, RUN);
};

/**
 * Hit and Run with a knife: a dart in on the front foot, the knife cut across the body from out on the right to the
 * left hip at what it strikes, and a spring back out with the hips already turning away and the head left looking
 * back. The body darts in by what the knife is short of the creature's near side, up to a stride (further and the
 * body would leave its own shadow behind: the stage's `cast.close` cannot be had for a knife alone, see the report),
 * and back.
 */
const RUN_DART = 12;
const runKnifePose: CastPose = (r, t, c) => {
  const by = c.aim ? clamp(c.aim.near - 16, 0, RUN_DART) : 0;
  const go = smooth(seg(t, RUN_IN, RUN_CUT - 0.04)) * (1 - smooth(seg(t, RUN_THROUGH + 0.04, RUN_OUT)));
  r.wield = 1;
  r.arm[1] = E(t, [[0, [22, 14, 0]], [RUN_IN, [40, 40, -10]], [RUN_CUT - 0.06, [96, 70, -30]], [RUN_CUT, [92, 40, 10]], [RUN_THROUGH, [62, -24, 50]], [RUN_OUT, [20, 10, 10]], [1, [16, 10, 4]]]);
  r.elbow[1] = one(t, [[0, 32], [RUN_IN, 70], [RUN_CUT - 0.06, 80], [RUN_CUT, 20], [RUN_THROUGH, 30], [RUN_OUT, 40], [1, 30]]);
  r.hand[1] = E(t, [[0, [0, 0, 0]], [RUN_CUT - 0.06, [20, 0, 40]], [RUN_THROUGH, [-20, 0, -40]], [1, [0, 0, 0]]]);
  r.arm[0] = E(t, [[0, [20, 10, 0]], [RUN_IN, [50, 20, -10]], [RUN_CUT, [20, 40, 0]], [RUN_OUT, [-20, 16, 0]], [1, [8, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [RUN_IN, 70], [RUN_CUT, 40], [RUN_OUT, 60], [1, 26]]);
  r.chest = E(t, [[0, [0, 0, 0]], [RUN_CUT - 0.06, [0, -2, -30]], [RUN_CUT, [-6, 2, 10]], [RUN_THROUGH, [-8, 2, 36]], [RUN_OUT, [-6, 0, 30]], [1, [0, 0, 4]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [RUN_IN, [-10, 0, 0]], [RUN_CUT, [-16, 0, 6]], [RUN_THROUGH, [-12, 0, 12]], [RUN_OUT, [-8, 0, 18]], [1, [-2, 0, 0]]]);
  r.pelvis = E(t, [[0, [0, 0, 0]], [RUN_CUT, [0, 0, -6]], [RUN_THROUGH, [0, 0, 10]], [RUN_OUT, [0, 0, 30]], [1, [0, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [RUN_CUT, [4, 0, 0]], [RUN_THROUGH, [-2, 0, -24]], [RUN_OUT, [0, 0, -50]], [1, [0, 0, 0]]]);
  // A running stride in and a spring back out: off the ground at the middle of each, landing on the front foot for the cut.
  r.leg[0] = E(t, [[0, [2, 2, 0]], [RUN_IN, [10, 4, 0]], [(RUN_IN + RUN_CUT) / 2, [44, 4, 0]], [RUN_CUT, [36, 4, 0]], [RUN_THROUGH, [30, 6, 0]], [(RUN_THROUGH + RUN_OUT) / 2, [-10, 8, 0]], [RUN_OUT, [8, 6, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 6], [RUN_IN, 30], [(RUN_IN + RUN_CUT) / 2, 50], [RUN_CUT, 40], [RUN_THROUGH, 36], [(RUN_THROUGH + RUN_OUT) / 2, 40], [RUN_OUT, 16], [1, 6]]);
  r.leg[1] = E(t, [[0, [0, 2, 0]], [RUN_IN, [-8, 2, 0]], [(RUN_IN + RUN_CUT) / 2, [-30, 4, 0]], [RUN_CUT, [-34, 4, 0]], [RUN_THROUGH, [-22, 10, 0]], [(RUN_THROUGH + RUN_OUT) / 2, [-30, 14, 0]], [RUN_OUT, [-26, 14, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 6], [RUN_IN, 20], [(RUN_IN + RUN_CUT) / 2, 60], [RUN_CUT, 24], [RUN_THROUGH, 20], [(RUN_THROUGH + RUN_OUT) / 2, 50], [RUN_OUT, 34], [1, 6]]);
  r.lift = (r.lift ?? 0) + 2.4 * (Math.sin(Math.PI * seg(t, RUN_IN, RUN_CUT - 0.04)) + Math.sin(Math.PI * seg(t, RUN_THROUGH + 0.04, RUN_OUT))) * Math.min(1, by / 12);
  r.at = [r.at[0], r.at[1] + by * go, r.at[2]];
};

const runPose: CastPose = (r, t, c) => (knifeIn(c) ? runKnifePose : runThrowPose)(r, t, c);

/*
 * Heavy Throw: two hands up behind the head and the back arched, a held
 * beat at the top, then the whole body comes over onto the front leg and the
 * back foot comes off the ground. It flies thicker and lower, one deep ribbon
 * behind it and dust shed as it goes; where it lands the creature is jolted
 * and three chevrons go round over its head for as long as its next blow is
 * put back (`STAGGER_MAUL`).
 */
const HEAVY: Held = { timing: { secs: 1.15, release: 0.55, blendIn: 0.12, blendOut: 0.26 }, throws: [0.55], draws: [0.84] };
const HEAVY_FLIGHT: Flight = { perTile: 0.052, base: 0.05, lift: (d) => 2 + d * 1.4, turns: 1.8 };
/** When the weight is up over the head: what the dust off the feet marks. */
const HEAVY_UP = 0.3;
const heavyPose: CastPose = (r, t, c) => {
  const up = HEAVY_UP, top = 0.44, hold = 0.49, rel = 0.55, thr = 0.68;
  for (let s = 0; s < 2; s++) {
    r.arm[s] = E(t, [[0, [20, 12, 0]], [up, [168, 18, 0]], [top, [178, 16, -4]], [hold, [180, 16, -4]], [rel, [138, 10, 6]], [thr, [52, 8, 10]], [1, [14, 10, 0]]]);
    r.elbow[s] = one(t, [[0, 30], [up, 90], [top, 112], [hold, 116], [rel, 12], [thr, 22], [1, 24]]);
  }
  r.open[0] = t > up * 0.6 && t < thr;
  r.chest = E(t, [[0, [0, 0, 0]], [up, [10, 0, -6]], [top, [16, 0, -8]], [hold, [18, 0, -8]], [rel, [-16, 0, 6]], [thr, [-20, 0, 4]], [1, [0, 0, 0]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [up, [8, 0, 0]], [top, [14, 0, 0]], [hold, [15, 0, 0]], [rel, [-20, 0, 0]], [thr, [-28, 0, 0]], [1, [-3, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [top, [-14, 0, 0]], [rel, [-6, 0, 0]], [thr, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 2, 0]], [up, [20, 4, 0]], [top, [32, 5, 0]], [rel, [36, 5, 0]], [thr, [34, 4, 0]], [1, [6, 2, 0]]]);
  r.knee[0] = one(t, [[0, 6], [up, 16], [top, 24], [rel, 40], [thr, 46], [1, 8]]);
  r.leg[1] = E(t, [[0, [0, 2, 0]], [up, [-8, 2, 0]], [top, [-16, 3, 0]], [rel, [-30, 3, 0]], [thr, [-48, 3, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 6], [up, 14], [top, 20], [rel, 26], [thr, 58], [1, 6]]);
  reachForNext(r, t, c, 0.72, 0.84, 0.97);
  // A javelin heaved two-handed as a harpoon is: both fists on the shaft over the head, the left ahead of the right along it,
  // drawn back over the arched back and driven out together; the left lets go as it leaves.
  javelinThrow(r, t, c, [
    { t: 0, ...CARRIED },
    { t: up, at: [1.6, -2.6, 16.6], lie: [0, 0.92, 0.4], pole: [4, -2, 12] },
    { t: top, at: [1.4, -3.8, 16.6], lie: [0, 0.9, 0.44], pole: [4, -3, 12] },
    { t: hold, at: [1.4, -4.0, 16.5], lie: [0, 0.9, 0.44], pole: [4, -3, 12] },
    { t: rel, at: [1.2, 3.0, 15.8], lie: [0, 0.95, 0.3], pole: [5, 0, 9] },
    { t: thr, at: [0.6, 4.2, 9.0], lie: [0, 0.95, 0.3], pole: [4, -1, 5] },
    ...backToHip(thr, HEAVY.draws[0]),
  ]);
  if (c.carry !== 'fist') {
    const both = one(t, [[0.12, 0], [up, 1], [rel - 0.01, 1], [rel + 0.03, 0]]);
    r.both = both;
    const left = track(t, [[0, [-1.5, 3, 15]], [up, [0.2, 0.6, 17.6]], [top, [0.1, -0.6, 17.8]], [hold, [0.1, -0.8, 17.7]], [rel, [0, 6, 16.2]]]);
    r.reach = [{ at: [left[0], left[1], left[2]], w: both, pole: [-4, -1, 10] }, r.reach?.[1]];
  }
  r.mouth = one(t, [[0, 0], [hold, 0.15], [rel, 0.85], [thr, 0.6], [0.85, 0]]);
  holdFor(r, t, c, HEAVY);
};

/*
 * Gut Throw: a pitch. Down onto the back knee, the trunk over the front
 * thigh, the arm swung back past the hip and through underhand, letting go
 * below the belt so it flies low and flat at the belly, and the arm coming up
 * after it as the body rises. It bleeds as a knife does, every second for
 * `KNIFE_BLEED_SECS`: a pulse of drops each second, and a pool under it.
 */
const GUT: Held = { timing: { secs: 0.8, release: 0.48, blendIn: 0.12 }, throws: [0.48], draws: [0.84] };
const GUT_FLIGHT: Flight = { perTile: 0.036, base: 0.03, lift: (d) => 0.3 + d * 0.22, turns: 3 };
const gutPose: CastPose = (r, t, c) => {
  const back = 0.32, rel = 0.48, thr = 0.6;
  r.kneel = one(t, [[0.06, 0], [back, 0.8], [thr, 0.8], [0.86, 0]]);
  r.arm[1] = E(t, [[0, [22, 12, 0]], [back, [-62, 18, 0]], [rel, [40, 6, -12]], [thr, [104, 4, -8]], [1, [18, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [back, 10], [rel, 6], [thr, 16], [1, 26]]);
  r.hand[1] = E(t, [[0, [0, 0, 0]], [back, [-20, 0, 60]], [rel, [20, 0, 70]], [1, [0, 0, 0]]]);
  r.arm[0] = E(t, [[0, [20, 10, 0]], [back, [76, 30, -10]], [rel, [56, 40, -4]], [thr, [30, 36, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [back, 30], [rel, 24], [1, 24]]);
  r.open[0] = t > 0.15 && t < 0.8;
  r.spine = E(t, [[0, [0, 0, 0]], [back, [-16, 0, -6]], [rel, [-22, 0, 4]], [thr, [-10, 0, 6]], [1, [-2, 0, 0]]]);
  r.chest = E(t, [[0, [0, 0, 0]], [back, [-6, -4, -24]], [rel, [-8, 2, 10]], [1, [0, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [back, [14, 0, 10]], [rel, [18, 0, -4]], [thr, [10, 0, -4]], [1, [0, 0, 0]]]);
  reachForNext(r, t, c, 0.64, GUT.draws[0], 0.96);
  // Swung back low past the hip and through underhand, let go below the belt, flat; the arm up after it.
  javelinThrow(r, t, c, [
    { t: 0, ...CARRIED },
    { t: 0.18, at: [3.0, -0.8, 6.6], lie: [0.05, 0.97, 0.2], pole: [3.5, -1, 5] },
    { t: back, at: [3.4, -4.8, 4.8], lie: [0.04, 0.99, 0.1], pole: [3.5, -1, 5] },
    { t: rel, at: [2.2, 4.4, 4.4], lie: [0, 0.995, 0.06], pole: [3.5, -2, 4] },
    { t: thr, at: [1.8, 5.4, 9.4], lie: [0, 0.96, 0.28], pole: [4, -1, 5] },
    ...backToHip(thr, GUT.draws[0]),
  ]);
  holdFor(r, t, c, GUT);
};

/*
 * Parting Throw: a short push off the shoulder with the body already leaning
 * back from it -- loading the spring -- and before the arm has finished the
 * knees drop and the body springs straight back off both feet, arms flung
 * forward for the balance, and lands crouched `fx.leap` tiles off, holding
 * the crouch a beat before it stands (the island has already put it there;
 * the stage carries the body over the leap, `cast.move`). Behind it a smear
 * runs back the way it went at the height of the knees, and a chevron for
 * every tile it crossed points along it.
 */
const PART: Held = { timing: { secs: 1.15, release: 0.3, blendIn: 0.1, blendOut: 0.18 }, throws: [0.3], draws: [0.93] };
const PART_FLIGHT: Flight = { perTile: 0.042, base: 0.04, lift: (d) => 1.6 + d * 1.1, turns: 2.6 };
/** When the feet leave the ground and come down again: the leap the stage carries the body over; and the crouch held after. */
const PART_OFF = 0.4, PART_DOWN = 0.78, PART_HELD = 0.84;
const partPose: CastPose = (r, t, c) => {
  const cock = 0.16, rel = 0.3, thr = 0.36, dip = PART_OFF - 0.02, high = 0.58, down = PART_DOWN, held = PART_HELD;
  r.arm[1] = E(t, [[0, [24, 14, 0]], [cock, [140, 26, -18]], [rel, [116, 14, 10]], [thr, [96, 12, 16]], [high, [84, 20, 0]], [down, [50, 26, 0]], [1, [18, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 34], [cock, 110], [rel, 30], [thr, 24], [high, 16], [down, 30], [1, 26]]);
  r.arm[0] = E(t, [[0, [20, 10, 0]], [cock, [70, 12, -6]], [rel, [40, 24, 0]], [dip, [-14, 20, 0]], [high, [86, 24, 0]], [down, [56, 30, 0]], [held, [50, 28, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [cock, 30], [rel, 40], [dip, 24], [high, 14], [down, 28], [1, 22]]);
  r.open[0] = t > rel && t < 0.95;
  r.shape = [t > dip && t < 0.9 ? { flat: 0.8 } : undefined, undefined];
  r.chest = E(t, [[0, [0, 0, 0]], [cock, [8, -2, -14]], [rel, [6, 2, 10]], [dip, [-6, 0, 8]], [high, [-6, 0, 0]], [1, [0, 0, 0]]]);
  // Leant back off the throw (the weight already going back), then forward over the knees going back through the air, as a
  // body leaping backward has to be to land on its feet.
  r.spine = E(t, [[0, [0, 0, 0]], [cock, [6, 0, -4]], [rel, [10, 0, 4]], [thr, [8, 0, 4]], [dip, [-16, 0, 2]], [high, [-16, 0, 0]], [down, [-22, 0, 0]], [held, [-20, 0, 0]], [0.92, [-8, 0, 0]], [1, [-1, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [cock, [2, 0, 12]], [rel, [-6, 0, -4]], [high, [6, 0, 0]], [down, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 2, 0]], [cock, [10, 3, 0]], [rel, [16, 3, 0]], [dip, [22, 4, 0]], [PART_OFF + 0.04, [6, 4, 0]], [high, [44, 5, 0]], [down, [34, 5, 0]], [held, [34, 5, 0]], [0.93, [12, 3, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 6], [rel, 18], [dip, 48], [PART_OFF + 0.04, 12], [high, 70], [down, 70], [held, 70], [0.93, 24], [1, 6]]);
  r.leg[1] = E(t, [[0, [0, 2, 0]], [cock, [-8, 2, 0]], [rel, [-16, 2, 0]], [dip, [12, 4, 0]], [PART_OFF + 0.04, [-4, 4, 0]], [high, [36, 5, 0]], [down, [30, 5, 0]], [held, [30, 5, 0]], [0.93, [8, 3, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 6], [rel, 14], [dip, 50], [PART_OFF + 0.04, 10], [high, 66], [down, 72], [held, 72], [0.93, 22], [1, 6]]);
  r.lift = one(t, [[0, 0], [PART_OFF, 0], [high, 4.5], [down, 0], [1, 0]]);
  reachForNext(r, t, c, 0.8, PART.draws[0], 1);
  // From by the ear, pushed out short off the shoulder -- the arm hardly straightens, the body is going the other way.
  javelinThrow(r, t, c, [
    { t: 0, ...CARRIED },
    { t: cock, at: [2.2, -0.6, 15.0], lie: [0.02, 0.9, 0.44], pole: [5, -1, 10] },
    { t: rel, at: [2.2, 2.6, 14.6], lie: [0, 0.97, 0.25], pole: [5, -1, 9] },
    { t: thr, at: [2.0, 3.4, 13.4], lie: [0, 0.96, 0.1], pole: [4.5, -1, 8] },
    { t: high, at: [2.2, 4.2, 11.4], lie: [0, 0.6, 0.8], pole: [5, -1, 6] },
    { t: down, at: [2.6, 2.8, 8.6], lie: [0, 0.4, 0.9], pole: [4, -2, 5] },
    ...backToHip(held, PART.draws[0]),
  ]);
  holdFor(r, t, c, PART);
};

/*
 * Double Throw: two throws, one after the other at `fx.throws` -- ta, TA.
 * The first is pushed flat off the chest from where it stands, no wind-up at
 * all; the hand drops to the hip for the second and brings it straight up and
 * back over the shoulder, and that one is thrown through with a full step.
 * Two weapons in the air one after the other, landing a hand apart.
 */
const DOUBLE: Held = { timing: { secs: 1.25, release: 0.3, blendIn: 0.08, blendOut: 0.22 }, throws: [0.3, 0.6], draws: [0.44, 0.86] };
const DOUBLE_FLIGHT: Flight = { perTile: 0.036, base: 0.035, lift: (d) => 1 + d * 0.9, turns: 3 };
const doublePose: CastPose = (r, t, c) => {
  const [r1, r2] = DOUBLE.throws;
  const c1 = 0.16, t1 = r1 + 0.06, d1 = DOUBLE.draws[0], c2 = 0.53, t2 = r2 + 0.1;
  r.arm[1] = E(t, [[0, [24, 14, 0]], [c1, [64, 24, -16]], [r1, [92, 8, 6]], [t1, [86, 8, 10]], [d1, [-10, 20, -4]],
    [c2, [154, 34, -24]], [r2, [84, 10, 20]], [t2, [36, 2, 30]], [1, [16, 10, 4]]]);
  r.elbow[1] = one(t, [[0, 34], [c1, 124], [r1, 8], [t1, 14], [d1, 50], [c2, 104], [r2, 12], [t2, 28], [1, 26]]);
  r.arm[0] = E(t, [[0, [20, 10, 0]], [c1, [50, 12, -8]], [r1, [30, 20, 0]], [c2, [86, 10, -8]], [r2, [24, 26, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [c1, 60], [r1, 44], [c2, 12], [r2, 44], [1, 22]]);
  r.open[0] = (t > 0.08 && t < r1) || (t > 0.46 && t < r2);
  r.chest = E(t, [[0, [0, 0, 0]], [c1, [2, 0, -8]], [r1, [-6, 0, 6]], [d1, [2, -2, -8]], [c2, [8, -5, -30]], [r2, [-10, 4, 24]], [t2, [-12, 2, 28]], [1, [0, 0, 4]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [c1, [2, 0, 0]], [r1, [-6, 0, 2]], [d1, [2, 0, -4]], [c2, [8, 0, -8]], [r2, [-16, 0, 8]], [t2, [-18, 0, 8]], [1, [-2, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [c1, [0, 0, 6]], [r1, [-4, 0, -4]], [c2, [0, 0, 22]], [r2, [-6, 0, -10]], [1, [0, 0, 0]]]);
  reachForNext(r, t, c, r1 + 0.03, d1, c2 - 0.02);
  reachForNext(r, t, c, 0.72, DOUBLE.draws[1], 0.98);
  // Pushed flat off the chest; the hand down to the hip for the next and straight up and back over the shoulder with it;
  // that one thrown through.
  javelinThrow(r, t, c, [
    { t: 0, ...CARRIED },
    { t: c1, at: [2.2, 0.4, 12.6], lie: [0.02, 0.99, 0.12], pole: [5, -2, 9] },
    { t: r1, at: [2.0, 4.6, 13.0], lie: [0, 0.99, 0.08], pole: [4, 0, 9] },
    { t: t1, at: [2.0, 5.0, 12.2], lie: [0, 0.99, 0.08], pole: [4, 0, 8] },
    { t: d1, at: [2.6, -1.0, 7.5], lie: CARRIED.lie, pole: [3.5, -2.5, 4] },
    { t: c2, at: [2.9, -2.8, 14.0], lie: [0.02, 0.95, 0.3], pole: [4, -2, 8] },
    { t: r2, at: [2.0, 3.8, 15.2], lie: [0, 0.97, 0.24], pole: [5, 0, 9] },
    { t: t2, at: [0.3, 4.4, 8.6], lie: [0, 0.97, 0.24], pole: [4, -1, 5] },
    ...backToHip(t2, DOUBLE.draws[1]),
  ]);
  holdFor(r, t, c, DOUBLE);
  // Standing for the first; a full step through for the second.
  stepIn(r, t, c, { hit: r2, from: d1, back: 0.8, by: 4.5, bend: 14 });
};

/*
 * Ricochet: thrown flat and low, sidearm at the height of the knee, the body
 * dropped on bent knees and tipped right over to the throwing side as a stone
 * is skimmed over water. It glances off what it hits and skips on, two-thirds
 * spent, at the nearest other enemy within `fx.reach` tiles; with none, off
 * the way a skimmed stone would go, and the ring of its reach is shown where
 * it hit.
 */
const RICO: Held = { timing: { secs: 0.85, release: 0.46, blendIn: 0.1 }, throws: [0.46], draws: [0.8] };
const RICO_FLIGHT: Flight = { perTile: 0.034, base: 0.03, lift: (d) => 0.3 + d * 0.25, turns: 5 };
const ricoPose: CastPose = (r, t, c) => {
  const wind = 0.3, rel = 0.46, thr = 0.6;
  r.arm[1] = E(t, [[0, [22, 14, 0]], [wind, [10, 76, -10]], [rel, [64, 60, 20]], [thr, [62, -10, 40]], [1, [16, 10, 4]]]);
  r.elbow[1] = one(t, [[0, 32], [wind, 70], [rel, 6], [thr, 14], [1, 28]]);
  r.hand[1] = E(t, [[0, [0, 0, 0]], [wind, [0, 0, 40]], [rel, [0, 0, -20]], [1, [0, 0, 0]]]);
  r.arm[0] = E(t, [[0, [20, 10, 0]], [wind, [80, 4, -30]], [rel, [60, 56, 0]], [thr, [40, 60, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [wind, 50], [rel, 20], [1, 22]]);
  r.open[0] = t > 0.12 && t < 0.85;
  // Tipped right over to the right: the left arm up and out against it.
  r.spine = E(t, [[0, [0, 0, 0]], [wind, [-18, -34, -14]], [rel, [-22, -40, 6]], [thr, [-18, -30, 12]], [1, [-1, 0, 0]]]);
  r.chest = E(t, [[0, [0, 0, 0]], [wind, [-2, -8, -28]], [rel, [-4, -8, 14]], [thr, [-4, -6, 24]], [1, [0, 0, 2]]]);
  r.head = E(t, [[0, [0, 0, 0]], [wind, [4, 26, 24]], [rel, [6, 32, -8]], [thr, [4, 22, -16]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 4, 0]], [wind, [34, 12, 0]], [rel, [46, 12, 0]], [1, [6, 3, 0]]]);
  r.knee[0] = one(t, [[0, 8], [wind, 60], [rel, 72], [thr, 64], [1, 8]]);
  r.leg[1] = E(t, [[0, [0, 4, 0]], [wind, [-10, 24, 0]], [rel, [-16, 30, 0]], [1, [-2, 3, 0]]]);
  r.knee[1] = one(t, [[0, 8], [wind, 44], [rel, 50], [1, 8]]);
  reachForNext(r, t, c, 0.62, 0.8, 0.95);
  // Out to the side at the knee, swept flat round in front low over the ground, and on across.
  javelinThrow(r, t, c, [
    { t: 0, ...CARRIED },
    { t: wind, at: [5.0, -2.2, 5.6], lie: [0.05, 0.99, -0.04], pole: [3, -3, 2] },
    { t: rel, at: [3.0, 4.6, 5.0], lie: [0, 1, -0.02], pole: [5, 0, 3] },
    { t: thr, at: [-1.0, 4.0, 6.0], lie: [0, 1, -0.02], pole: [3, -1, 3] },
    ...backToHip(thr, RICO.draws[0]),
  ]);
  holdFor(r, t, c, RICO);
};

/*
 * Fan of Blades: a whole turn on the spot, as a discus is thrown -- wound
 * back to the right, then spun round to the left on bent knees with the
 * throwing arm straight out from the shoulder, and let go as the body comes
 * round to face it again, the arm whipping through. The weapon goes at what
 * was aimed at; the spell's copies of it, conjured in its light, go one each
 * at every other enemy within `fx.reach` tiles of it, whose ring is drawn
 * where they land.
 */
const FAN: Held = { timing: { secs: 1.15, release: 0.55, blendIn: 0.1, blendOut: 0.24 }, throws: [0.55], draws: [0.86] };
const FAN_FLIGHT: Flight = { perTile: 0.042, base: 0.05, lift: (d) => 1.2 + d, turns: 3.6 };
/** Most blades drawn in a fan: the one thrown and its copies (the island throws at every enemy in reach; past this many the picture is no clearer). */
const FAN_MOST = 7;
/** Seconds between one blade leaving the hand and the next, as the arm sweeps across. */
const FAN_STAGGER = 0.025;
/** When the turn begins and when it is round, as fractions of the cast. */
const FAN_WOUND = 0.26, FAN_ROUND = 0.68;
const fanPose: CastPose = (r, t, c) => {
  const wound = FAN_WOUND, rel = 0.55, round = FAN_ROUND;
  // The turn: wound back a little to the right, then once round to the left, ending square to what it threw at. Written
  // past half a turn as the same angle less a whole one, so the blend in and out of it, which only sees the numbers,
  // never turns the body back the long way round.
  let spin = one(t, [[0, 0], [wound, -40], [rel, 330], [round, 360], [1, 360]]);
  if (spin > 180) spin -= 360;
  r.pelvis = [0, 0, spin];
  r.arm[1] = E(t, [[0, [22, 14, 0]], [wound, [60, 70, -10]], [0.45, [80, 84, 0]], [rel, [90, 40, 10]], [round, [64, -6, 30]], [1, [16, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 32], [wound, 40], [0.45, 6], [rel, 4], [round, 20], [1, 28]]);
  r.arm[0] = E(t, [[0, [20, 10, 0]], [wound, [50, 30, -20]], [0.45, [70, 60, -10]], [rel, [40, 50, 0]], [round, [20, 30, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [wound, 60], [0.45, 30], [rel, 40], [1, 22]]);
  r.open[0] = t > wound && t < 0.9;
  // The shoulders lag the hips into the turn and whip past them at the end of it.
  r.chest = E(t, [[0, [0, 0, 0]], [wound, [2, 0, -24]], [0.45, [0, 0, -20]], [rel, [-6, 0, 16]], [round, [-6, 0, 10]], [1, [0, 0, 0]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [wound, [-6, 0, -10]], [0.45, [-10, 4, -8]], [rel, [-12, 0, 8]], [round, [-8, 0, 4]], [1, [-1, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [wound, [0, 0, 30]], [0.45, [0, 0, 24]], [rel, [-2, 0, -4]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 4, 0]], [wound, [8, 10, 0]], [rel, [18, 12, 0]], [round, [14, 8, 0]], [1, [4, 3, 0]]]);
  r.knee[0] = one(t, [[0, 8], [wound, 36], [0.45, 40], [rel, 30], [round, 24], [1, 8]]);
  r.leg[1] = E(t, [[0, [0, 4, 0]], [wound, [-8, 10, 0]], [rel, [-12, 12, 0]], [1, [-2, 3, 0]]]);
  r.knee[1] = one(t, [[0, 8], [wound, 36], [0.45, 40], [rel, 28], [round, 22], [1, 8]]);
  reachForNext(r, t, c, 0.72, FAN.draws[0], 0.98);
  // Held out at arm's length from the shoulder through the turn, point leading round, and swung onto the line as it goes.
  javelinThrow(r, t, c, [
    { t: 0, ...CARRIED },
    { t: wound, at: [4.2, -1.2, 10.6], lie: [0.9, 0.3, 0.25], pole: [3, -2, 5] },
    { t: 0.45, at: [6.2, 0.6, 11.6], lie: [0.85, 0.5, 0.12], pole: [3, -2, 6] },
    { t: rel, at: [3.0, 4.8, 12.4], lie: [0.1, 0.99, 0.12], pole: [5, 0, 7] },
    { t: round, at: [-0.4, 4.4, 9.6], lie: [0.1, 0.99, 0.12], pole: [3, -1, 4] },
    ...backToHip(round, FAN.draws[0]),
  ], spin);
  holdFor(r, t, c, FAN);
};

/*
 * Opportunist: no throw. Sunk low and still, the head turning slowly to one
 * side and then over to the other as an opening is looked for -- the better
 * part of half a second of it -- then a sharp tap of two fingers at the
 * temple and the hand flicked out at it. Two chevrons close on the eyes as it
 * looks and snap shut at the tap; then a ring of `fx.secs` of them at the
 * feet, turned round it as a sweep of the eyes is, one to a second.
 */
const OPP: CastTiming = { secs: 1.2, release: 0.58, blendIn: 0.12 };
const OPP_SECS = fxOf('opportunist').secs ?? 0;
/** Seconds the ring takes to come down to the feet. */
const OPP_IN = 0.45;
/** The look: when it starts, when it is right over to one side, over to the other, and the tap. */
const OPP_LOW = 0.1, OPP_ONE = 0.25, OPP_OTHER = 0.42, OPP_TAP = 0.52;
const oppPose: CastPose = (r, t) => {
  const low = OPP_LOW, one_ = OPP_ONE, look = OPP_OTHER, tap = OPP_TAP, rel = 0.58, out = 0.7;
  // The free left hand does the looking; the right keeps its weapon low and ready.
  r.arm[0] = E(t, [[0, [20, 10, 0]], [low, [34, 20, -4]], [look, [40, 20, -6]], [tap, [146, 10, -50]], [rel, [150, 12, -50]], [out, [96, 30, -6]], [0.86, [80, 26, -4]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [low, 40], [look, 50], [tap, 150], [rel, 146], [out, 10], [0.86, 16], [1, 22]]);
  // Two fingers to the temple, then the hand flicked open and out at the opening seen.
  const two = one(t, [[low, 0], [look, 0.6], [tap, 1], [rel, 1], [out, 0], [1, 0]]);
  const flick = one(t, [[rel, 0], [out, 1], [0.86, 0.6], [1, 0]]);
  r.shape = [{ two, flat: flick * 0.7, point: flick * 0.3 }, r.shape?.[1]];
  r.arm[1] = E(t, [[0, [22, 12, 0]], [low, [36, 22, -6]], [rel, [34, 22, -6]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [low, 70], [rel, 74], [1, 28]]);
  r.spine = E(t, [[0, [0, 0, 0]], [low, [-14, 0, 0]], [rel, [-12, 0, 0]], [out, [-8, 0, 0]], [1, [-1, 0, 0]]]);
  r.chest = E(t, [[0, [0, 0, 0]], [low, [-4, 0, 4]], [one_, [-4, 0, 14]], [look, [-4, 0, -14]], [rel, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [low, [6, 4, 10]], [one_, [6, 8, 34]], [look, [6, -8, -34]], [tap, [10, 6, -6]], [rel, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 4, 0]], [low, [16, 8, 0]], [1, [4, 3, 0]]]);
  r.knee[0] = one(t, [[0, 8], [low, 46], [rel, 44], [out, 30], [1, 8]]);
  r.leg[1] = E(t, [[0, [0, 4, 0]], [low, [-10, 8, 0]], [1, [-2, 3, 0]]]);
  r.knee[1] = one(t, [[0, 8], [low, 44], [rel, 42], [out, 26], [1, 8]]);
};

/*
 * Fade: the left forearm swept up across the face as a cloak is, the body
 * turned away under it and dropped into a crouch -- and the body itself goes
 * thin and grey, to a little over half there, for `fx.secs`. Grey wisps
 * winding up it into a low haze at the feet, a broken ring of chevrons
 * pointing out, one to a second, and now and then over whatever is hunting
 * nearby a grey chevron turning away: it has lost you.
 */
const FADE: CastTiming = { secs: 0.9, release: 0.46, blendIn: 0.12, blendOut: 0.28 };
const fadePose: CastPose = (r, t) => {
  const sweep = 0.32, rel = 0.46, low = 0.6;
  // The sweeping hand flat, a cloak's edge; let down open and loose.
  r.shape = [{ flat: one(t, [[0.1, 0], [sweep, 1], [low, 1], [0.9, 0.3], [1, 0]]) }, r.shape?.[1]];
  r.arm[0] = E(t, [[0, [20, 10, 0]], [sweep, [108, -24, 44]], [rel, [104, -26, 46]], [low, [70, -10, 30]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [sweep, 124], [rel, 128], [low, 100], [1, 22]]);
  r.arm[1] = E(t, [[0, [20, 12, 0]], [sweep, [-10, 26, 0]], [rel, [-14, 30, 0]], [low, [10, 34, 0]], [1, [16, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [sweep, 50], [low, 60], [1, 28]]);
  r.chest = E(t, [[0, [0, 0, 0]], [sweep, [-6, 0, 30]], [rel, [-8, 0, 36]], [low, [-12, 0, 22]], [1, [0, 0, 0]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [sweep, [-8, 0, 10]], [rel, [-14, 0, 14]], [low, [-22, 0, 6]], [1, [-1, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [sweep, [14, 0, -6]], [rel, [20, 0, -12]], [low, [16, 0, -18]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 4, 0]], [sweep, [6, 6, 0]], [rel, [14, 6, 0]], [low, [24, 8, 0]], [1, [4, 3, 0]]]);
  r.knee[0] = one(t, [[0, 8], [sweep, 24], [rel, 48], [low, 72], [1, 8]]);
  r.leg[1] = E(t, [[0, [0, 4, 0]], [sweep, [-12, 6, 0]], [rel, [-22, 6, 0]], [low, [-18, 8, 0]], [1, [-2, 3, 0]]]);
  r.knee[1] = one(t, [[0, 8], [sweep, 24], [rel, 52], [low, 74], [1, 8]]);
};

/*
 * Marked for Death: the throwing hand keeps its weapon. Drawn up tall, two
 * fingers of the left hand to the eye -- seen -- and then a step in onto the
 * front foot, the trunk thrown forward after the arm as it goes out straight
 * at the creature, the head down it, the right hand drawn back. A line of
 * light to it, a sight that closes on it and stays for `fx.secs`, and a ring
 * of as many chevrons as seconds round its feet, pointing in.
 */
const MARK: CastTiming = { secs: 1.1, release: 0.56, blendIn: 0.12 };
const markPose: CastPose = (r, t, c) => {
  const eye = 0.32, hold = 0.44, rel = 0.56, thr = 0.68;
  r.arm[0] = E(t, [[0, [20, 10, 0]], [eye, [138, -6, 48]], [hold, [140, -6, 50]], [rel, [96, 4, 0]], [thr, [94, 4, 0]], [0.86, [80, 6, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [eye, 150], [hold, 150], [rel, 0], [thr, 2], [1, 22]]);
  // Two fingers to the eye -- seen -- and then one pointed at it.
  const two = one(t, [[0.12, 0], [eye, 1], [hold, 1], [rel, 0], [1, 0]]);
  const point = one(t, [[hold, 0], [rel, 1], [0.86, 1], [1, 0]]);
  r.shape = [{ two, point }, r.shape?.[1]];
  r.hand[0] = E(t, [[0, [0, 0, 0]], [rel, [-10, 0, 0]], [1, [0, 0, 0]]]);
  // The weapon hand drawn back and down as the other goes out: the body opens along the line of the point.
  r.arm[1] = E(t, [[0, [22, 12, 0]], [eye, [28, 16, 0]], [rel, [-24, 22, 0]], [thr, [-28, 22, 0]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [eye, 40], [rel, 24], [1, 28]]);
  r.chest = E(t, [[0, [0, 0, 0]], [eye, [6, 0, 14]], [hold, [6, 0, 16]], [rel, [-6, 0, -16]], [thr, [-6, 0, -18]], [1, [0, 0, 0]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [eye, [6, 0, 0]], [hold, [6, 0, 0]], [rel, [-12, 0, -4]], [thr, [-12, 0, -4]], [0.85, [-6, 0, 0]], [1, [-1, 0, 0]]]);
  // Looking down the arm: turned back against the chest so the face is along the point, and dropped a little to it.
  r.head = E(t, [[0, [0, 0, 0]], [eye, [-10, -6, -12]], [hold, [-12, -6, -14]], [rel, [6, 0, 18]], [thr, [8, 0, 20]], [1, [0, 0, 0]]]);
  stepIn(r, t, c, { hit: rel, from: hold, back: 0.8, by: 4, bend: 14 });
};

/* ---- the effects of a throw ------------------------------------------------------------------- */

/** The throw's flight as a `travel`: the weapon from where it left the hand to what it was thrown at, `to` it lands. */
function throwTravel(f: Flight, o: { to?: (k: FxScene) => P3; wake?: WakeLook } & FlightMarks = {}): NonNullable<SpellVisualFx['travel']> {
  return {
    secs: flightSecs(f),
    draw: (k, u) => {
      if (k.state.t0 === undefined) k.state.t0 = k.now;
      // How high it goes is settled as it leaves the hand: the stage measures the way from the body, which a Parting
      // Throw's leap carries off while it is in the air, and an arc re-aimed in flight climbs as it goes.
      if (k.state.lift === undefined) k.state.lift = f.lift(k.dist);
      const { d } = flying(k, f, launchOf(k), o.to ? o.to(k) : aimAt(k), u, { wake: o.wake, lift: k.state.lift, chevron: o.chevron, dust: o.dust });
      k.state.dx = d.x;
      k.state.dy = d.y;
      k.state.dz = d.z;
    },
  };
}
type SpellVisualFx = SpellVisual['fx'];
/** The way the throw was going when it landed, kept by `throwTravel`. */
const landedDir = (k: FxScene): V => (k.state.dx !== undefined ? { x: k.state.dx, y: k.state.dy, z: k.state.dz } : between(k.caster.figure ? k.chest() : k.at(k.caster, 0.6), aimAt(k)));
const landedSpin = (k: FxScene): number => 0.5 + (k.seed % 5) * 0.2;

/* ---- the twelve ------------------------------------------------------------------------------ */

const SNAP_SOONER = fxOf('snap_throw').sooner ?? 0;
const RUN_SECS = fxOf('hit_and_run').secs ?? 0;
const DOUBLE_N = fxOf('double_throw').throws ?? 2;
const RICO_REACH = fxOf('ricochet').reach ?? 0;
const FAN_REACH = fxOf('fan_of_blades').reach ?? 0;
const PART_LEAP = fxOf('parting_throw').leap ?? 0;

/** A creature's or a person's footprint on the ground, in tiles: what a ring round it starts from. */
const footOf = (b: Body): number => Math.max(0.22, (b.wide / 40) * 2.6);

/** How far the weapon in the caster's hand reaches, in tiles, as the island has it (`melee_reach`, before perks): what a Long Throw goes past. */
function reachOfHand(k: FxScene): number {
  const id = k.caster.figure?.gear?.weapon?.id, w = id ? WEAPON_BY_ID.get(id) : undefined;
  return w && !w.ammo ? reachOf(w) : reachOf({ range: undefined });
}

/** The nearest creature hunting or fighting within `r` tiles of the caster that is not somebody's: who a Fade loses, or an Opportunist watches. */
function hunterNear(k: FxScene, r: number): Body | null {
  let best: Body | null = null, bestFar = Infinity;
  for (const b of k.enemiesWithin(r, k.caster)) {
    if (!b.hostile || b.companion) continue;
    const far = Math.hypot(b.x - k.caster.x, b.y - k.caster.y);
    if (far < bestFar) [best, bestFar] = [b, far];
  }
  return best;
}

/**
 * A ring drawn in the air round a point on the screen, `r` pixels, from the top round `turn` of the way (all of it
 * when `turn` is one) -- inked under and in `colour` over, as one record sorted at `at`; after dark its line again in
 * the glow pass, so it still reads at night.
 */
function airRing(k: FxScene, at: P3, r: number, turn: number, alpha: number, colour: string, bias = 0): void {
  if (alpha <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), R = r * k.zoom, z = k.zoom, ink = k.pal.ink;
  const end = -Math.PI / 2 + clamp(turn) * TAU;
  k.worldDraw(at, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineCap = 'butt';
    g.beginPath();
    g.arc(x, y, R, -Math.PI / 2, end);
    g.strokeStyle = ink;
    g.lineWidth = 2.2 * z;
    g.stroke();
    g.strokeStyle = colour;
    g.lineWidth = 1.1 * z;
    g.stroke();
  }, bias);
  if (k.night > 0.05) {
    k.glowDraw((g) => {
      g.globalAlpha = clamp(alpha * k.night * 0.6);
      g.lineCap = 'butt';
      g.beginPath();
      g.arc(x, y, R, -Math.PI / 2, end);
      g.strokeStyle = colour;
      g.lineWidth = 2.4 * z;
      g.stroke();
    });
  }
}

export const SKIRMISHER: Record<string, SpellVisual> = {
  // Snap Throw (throw, on enemy): a throw at 80%; your own next swing comes 1 s sooner.
  skirmisher_snap_throw: {
    palette: PALETTE,
    cast: { timing: SNAP.timing, pose: snapPose },
    fx: {
      charge: (k, t) => {
        followHeld(k, SNAP, t);
        // The flick: a glint off the fingers the instant it goes.
        k.flare(k.hand(1), 4.5, bump(t, 0.34, 0.4, 0.5), k.pal.core, 0.3);
      },
      release: (k) => {
        letGo(k);
      },
      // A flick's wake: short and tight, the two tails never opening.
      travel: throwTravel(SNAP_FLIGHT, { wake: { span: 0.09, spread: 0.008, width: 1.7 } }),
      hit: (k) => bite(k, aimAt(k), landedDir(k), 0.8),
      impact: { secs: 0.4, draw: (k, u) => {
        glint(k, aimAt(k), u, 6);
        stuck(k, thrownBy(k), aimAt(k), landedDir(k), u * 1.4, landedSpin(k));
      } },
      // The second it buys, from when it lands: a sand hand going once round the grip of the weapon that will swing next,
      // and the weapon itself flashing when it is round -- ready.
      linger: { secs: SNAP_SOONER, draw: (k, age, left) => {
        const u = clamp(age / Math.max(0.01, age + left));
        const grip = k.joint(k.caster, 'grip');
        const a = smooth(age / 0.12) * (1 - smooth(seg(u, 0.92, 1)));
        airRing(k, grip, 4.6, u, 0.9 * a, k.pal.accent, 4);
        // The hand of it, a chevron at its head.
        const ang = -Math.PI / 2 + u * TAU, R = 4.6 * k.zoom;
        airChevrons(k, grip, [[k.sx(grip) + Math.cos(ang) * R, k.sy(grip) + Math.sin(ang) * R, ang + Math.PI / 2, 2.8 * k.zoom]], a, { bias: 4.5 });
        if (left < 0.18) {
          const w = flashOf(1 - left / 0.18, 0.25);
          const tip = k.joint(k.caster, 'tip');
          k.flare(tip, 7, w, k.pal.core, 0.6);
          k.glow(mid3(grip, tip, 0.6), 6, 0.6 * w);
        }
      } },
    },
  },

  // Long Throw (throw, on enemy): a throw at 110% on an enemy up to 2 tiles past your reach.
  skirmisher_long_throw: {
    palette: PALETTE,
    cast: { timing: LONG.timing, pose: longPose },
    fx: {
      charge: (k, t) => {
        followHeld(k, LONG, t);
        // Where it will come down, measured out over the ground: a chevron a half tile, running out to it as the arm goes
        // back; those past the reach of the weapon in the hand -- what only this throw gets to -- in full sand, the rest dimmer.
        const run = smooth(seg(t, 0.14, 0.5));
        const gone = 1 - smooth(seg(t, 0.56, 0.8));
        if (run > 0 && gone > 0) {
          const d = k.toward(k.caster, k.spot), far = k.dist, reach = reachOfHand(k);
          const n = Math.max(2, Math.round(far / 0.5));
          const pts: number[][] = [], alphas: number[] = [];
          for (let i = 1; i <= n; i++) {
            const s = (i / n) * far;
            const show = clamp(run * far * 1.1 - s + 0.4);
            if (show <= 0) continue;
            chevronOn(k.caster.x + d.x * (s - 0.25), k.caster.y + d.y * (s - 0.25), d.x, d.y, i === n ? 0.2 : s > reach ? 0.16 : 0.12, pts);
            alphas.push(Math.round(10 * show * gone * (s > reach ? 0.9 : 0.45)) / 10);
          }
          drawChevrons(k, (k.caster.x + k.spot.x) / 2, (k.caster.y + k.spot.y) / 2, far / 2 + 0.3, pts, alphas);
        }
      },
      release: (k) => {
        letGo(k);
        const foot = k.joint(k.caster, 'ankle0', [0, 0, 0], 0.02);
        scuff(k, foot, 8, k.toward(k.caster, k.target));
      },
      // A long thin wake, and its shadow a chevron of sand running over the ground under it.
      travel: throwTravel(LONG_FLIGHT, { wake: { span: 0.3, spread: 0.022, width: 1.5 }, chevron: true }),
      hit: (k) => {
        bite(k, aimAt(k), landedDir(k), 1.1);
        scuff(k, k.at(k.target, 0.02), 8);
      },
      impact: { secs: 0.75, draw: (k, u) => {
        const at = aimAt(k), el = u * 0.75;
        glint(k, at, u, 8);
        stuck(k, thrownBy(k), at, landedDir(k), u, landedSpin(k));
        const r = footOf(k.target);
        k.ring(k.target, r + 0.25 * easeOut(u), { band: 0.05 * (1 - u), alpha: 0.8 * (1 - u), main: k.pal.accent, deep: k.pal.deep, glow: 0.4 });
        // Where it came down, lit for a moment at night: not along the way, a javelin is not a lamp.
        if (el < 0.4) k.light(at, 1.4, 0.7 * (1 - el / 0.4), '#fff1d6');
      } },
    },
  },

  // Hit and Run (throw, on enemy, lasts 5 s): a throw or a knife blow at 100%, and for 5 s you walk 40% faster.
  skirmisher_hit_and_run: (() => {
    const thrown = throwTravel(RUN_FLIGHT, { wake: { span: 0.14, spread: 0.04, width: 2 } });
    return {
      palette: PALETTE,
      cast: { timing: RUN.timing, pose: runPose },
      fx: {
        charge: (k, t) => {
          sayKnife(k);
          if (thrownBy(k) !== 'knife') {
            followHeld(k, RUN, t);
            return;
          }
          // The knife: the cut is the blade's own sweep; and on what it strikes, a cut opened across it as the blade goes
          // through, eaten from its tail, with a bite.
          if (t > RUN_CUT - 0.07 && t < RUN_THROUGH + 0.1) k.trail(k.caster, { secs: 0.08, inner: 0.25, alpha: 0.95 });
          const at = aimAt(k);
          if (t >= RUN_CUT && k.state.cut === undefined) {
            k.state.cut = 1;
            bite(k, at, between(k.chest(), at), 0.8);
          }
          const cut = seg(t, RUN_CUT - 0.03, RUN_THROUGH + 0.16);
          if (cut > 0 && cut < 1) {
            const side = across(between(k.chest(), at)), w = Math.max(3, k.target.wide * 0.9) / U;
            const a0 = { x: at.x + side.x * w, y: at.y + side.y * w, z: at.z + 2.5 }, a1 = { x: at.x - side.x * w, y: at.y - side.y * w, z: at.z - 2.5 };
            // Opened from its near end across, then eaten from that end after it.
            const head = smooth(Math.min(1, cut / 0.3)), tail = head * smooth(seg(cut, 0.45, 1));
            const drawn = [tail, (tail + head) / 2, head].map((v) => mid3(a0, a1, v));
            k.ribbon(drawn, { width: 2.4, taper: 'both', alpha: 0.95, main: k.pal.core, edge: true, glow: 0.6 });
          }
          k.flare(at, 6, bump(t, RUN_CUT - 0.02, RUN_CUT + 0.02, RUN_CUT + 0.14), k.pal.core, 0.5);
        },
        release: (k) => {
          if (thrownBy(k) !== 'knife') letGo(k);
          const away = k.toward(k.target, k.caster);
          scuff(k, k.at(k.caster, 0.02), 7, { x: -away.x, y: -away.y });
        },
        travel: { secs: thrown.secs, draw: (k, u) => {
          if (thrownBy(k) !== 'knife') thrown.draw(k, u);
        } },
        hit: (k) => {
          if (thrownBy(k) !== 'knife') bite(k, aimAt(k), landedDir(k));
        },
        impact: { secs: 0.45, draw: (k, u) => {
          if (thrownBy(k) === 'knife') return;
          glint(k, aimAt(k), u);
          stuck(k, thrownBy(k), aimAt(k), landedDir(k), u * 1.3, landedSpin(k));
        } },
        // The pace, on the caster for its seconds whatever becomes of what was hit: wind streaming off the heels and a trail
        // of chevrons behind, one to a second, the last going out.
        linger: { on: 'caster', draw: (k, age, left) => {
          const b = k.caster;
          const a = smooth(age / 0.3) * smooth(left / 0.6);
          const fwd = k.facingDir(b);
          const pts: number[][] = [], alphas: number[] = [];
          const n = Math.round(RUN_SECS);
          for (let i = 0; i < n; i++) {
            const lit = clamp(left - i);
            if (lit <= 0) continue;
            const s = 0.3 + i * 0.22;
            chevronOn(b.x - fwd.x * s, b.y - fwd.y * s, fwd.x, fwd.y, 0.13, pts);
            alphas.push(a * 0.85 * smooth(lit) * (1 - i / (n + 2)));
          }
          drawChevrons(k, b.x, b.y, 0.3 + n * 0.22, pts, alphas);
          // A streamer of wind off each heel at the height of the shin, trailing half a tile back and lifting and falling at
          // its far end as it streams. Put by the body's own frame rather than found on the posed leg: five seconds of a
          // figure posed again every frame is the cost of the whole spell, and at a heel the difference does not show.
          for (let s = 0; s < 2; s++) {
            const heel = k.local(b, s ? 1.3 : -1.3, -0.8, 2.6);
            const line: P3[] = [];
            for (let i = 3; i >= 0; i--) {
              const v = i / 3, wave = Math.sin(k.now * 8 + s * 2.2 - v * 2.6) * 1.2 * v;
              line.push({ x: heel.x - fwd.x * RUN_STREAM * v, y: heel.y - fwd.y * RUN_STREAM * v, z: heel.z + 1.2 * v + wave });
            }
            k.ribbon(line, { width: 2, taper: 'start', alpha: a * 0.65, edge: false, glow: 0.4, main: k.pal.light });
          }
        } },
      },
    } satisfies SpellVisual;
  })(),

  // Heavy Throw (throw, on enemy): a throw at 140% that staggers it as a maul does: a heavy blow knocked off its stroke, and its next blow put back 1 s.
  skirmisher_heavy_throw: {
    palette: PALETTE,
    cast: { timing: HEAVY.timing, pose: heavyPose },
    fx: {
      charge: (k, t) => {
        followHeld(k, HEAVY, t);
        // The weight coming up off the ground: a scuff at each foot as it is heaved up, and the hands lit with it at the top.
        if (t >= HEAVY_UP * 0.8 && k.state.up === undefined) {
          k.state.up = 1;
          for (const f of ['ankle0', 'ankle1']) scuff(k, k.joint(k.caster, f, [0, 0, 0], 0.02), 3, undefined, 0.6);
        }
        const g = bump(t, 0.2, 0.46, 0.56);
        k.glow(mid3(k.hand(0), k.hand(1), 0.5), 5, 0.3 * g, k.pal.light);
      },
      release: (k) => {
        letGo(k);
        const foot = k.joint(k.caster, 'ankle0', [0, 0, 0], 0.02);
        scuff(k, foot, 10, undefined, 1.3);
      },
      // One thick deep ribbon behind it, and dust shed as it goes: weight in the air.
      travel: throwTravel(HEAVY_FLIGHT, { wake: { span: 0.2, spread: 0, width: 4.4, deep: true, single: true }, dust: true }),
      hit: (k) => {
        bite(k, aimAt(k), landedDir(k), 1.5);
        scuff(k, k.at(k.target, 0.02), 14, undefined, 1.8);
      },
      impact: { secs: 0.8, draw: (k, u) => {
        const at = aimAt(k), d = landedDir(k);
        glint(k, at, u, 11);
        stuck(k, thrownBy(k), at, d, u, landedSpin(k));
        // The jolt: a tight band of shock at its feet -- it, not an area -- and two lines either side of it driven on the way the blow went.
        const r = footOf(k.target);
        k.ring(k.target, r + 0.15 * easeOut(u), { band: 0.05 * (1 - u), alpha: 0.9 * (1 - u * u), main: k.pal.accent, deep: '#8a7450', glow: 0.3 });
        const side = across(d), w = 0.22 * k.target.wide / 5;
        for (const s of [-1, 1]) {
          const base = { x: at.x + side.x * w * s, y: at.y + side.y * w * s, z: at.z + 2 * s };
          const v = easeOut(seg(u, 0, 0.5));
          k.ribbon([along(base, d, 2 + 10 * v), along(base, d, 6 + 16 * v)], { width: 2, taper: 'start', alpha: 0.9 * (1 - seg(u, 0.3, 0.6)), edge: false });
        }
      } },
      // The stagger, for as long as its next blow is put back: three chevrons going round over its head, as big as it is.
      linger: { secs: STAGGER_MAUL + 0.3, draw: (k, age, left) => {
        const b = k.target, a = smooth(age / 0.2) * smooth(left / 0.3);
        const c = k.at(b, 1.06);
        const x = k.sx(c), y = k.sy(c), R = Math.max(6, b.wide * 1.6) * k.zoom, s = Math.max(4.2, b.tall * 0.25) * k.zoom;
        const marks: AirMark[] = [];
        for (let i = 0; i < 3; i++) {
          const ang = age * 5.5 + (i * TAU) / 3;
          marks.push([x + Math.cos(ang) * R, y + Math.sin(ang) * R * 0.4, ang + Math.PI / 2, s]);
        }
        airChevrons(k, c, marks, a, { bias: 3 });
      } },
    },
  },

  // Gut Throw (throw, on enemy): a throw at 90% that bleeds it as a knife does, 15% of the throw a second for 6 s.
  skirmisher_gut_throw: {
    palette: PALETTE,
    cast: { timing: GUT.timing, pose: gutPose },
    fx: {
      charge: (k, t) => followHeld(k, GUT, t),
      release: (k) => {
        letGo(k);
      },
      // Low and flat, the tails going red over the last of it.
      travel: throwTravel(GUT_FLIGHT, { to: (k) => gutOf(k), wake: { span: 0.15, spread: 0.035, width: 2, tint: '#c8463a' } }),
      hit: (k) => {
        const at = gutOf(k), d = landedDir(k);
        bite(k, at, d, 0.7);
        k.burst(at, 14, { kind: 'drop', colour: ['#8e1c1c', '#6a1212'], size: 2, life: [0.4, 0.7], speed: [0.4, 1], up: [4, 14], heading: { x: d.x, y: d.y }, cone: 1.6, gravity: 70, bias: 2 });
      },
      impact: { secs: 0.5, draw: (k, u) => {
        glint(k, gutOf(k), u, 6);
        stuck(k, thrownBy(k), gutOf(k), landedDir(k), u, landedSpin(k));
      } },
      // The bleed, a second at a time for as long as a knife's: a pulse of drops each second, a dark wound, a pool spreading
      // under it and spots on the side it was hit from, and the seconds left counted round its feet in red.
      linger: { secs: KNIFE_BLEED_SECS, draw: (k, age, left) => {
        const at = gutOf(k), b = k.target;
        // Stanched before its time -- the island says the bleed is no longer running -- it dries up there and then. Given a
        // second and a half first, for the word that it started to arrive.
        if (b.kind === 'creature' && b.bleeding === false && age > 1.5 && k.state.dry === undefined) k.state.dry = age;
        const stop = k.state.dry === undefined ? 1 : 1 - smooth((age - k.state.dry) / 0.6);
        if (stop <= 0) return;
        const tick = Math.floor(age);
        if ((k.state.tick ?? -1) < tick && stop === 1) {
          k.state.tick = tick;
          k.burst(at, 5, { kind: 'drop', colour: ['#8e1c1c', '#6a1212'], size: 1.8, life: [0.35, 0.6], speed: [0.05, 0.25], up: [-2, 4], gravity: 70, bias: 2 });
        }
        const pulse = flashOf(age - tick, 0.08) * smooth(left / 0.5);
        // The wound: dark red laid over, swelling with each pulse -- not a sparkle.
        k.glow(at, 3.5 + 1.5 * pulse, 0.55 + 0.35 * pulse, '#9a1a14', true);
        // The pool: an irregular blot, drying darker as it goes, and spots on the side the throw came from.
        const grow = 0.07 + 0.11 * smooth(age / KNIFE_BLEED_SECS);
        const shade = dry('#7a0f0f', 0.6 * smooth(age / KNIFE_BLEED_SECS));
        const blot: number[] = [];
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * TAU + hashOf(k.seed, i) * 0.5, rr = grow * (0.7 + 0.5 * hashOf(k.seed, 10 + i));
          blot.push(at.x + Math.cos(ang) * rr, at.y + Math.sin(ang) * rr * 0.9);
        }
        const from = k.toward(at, k.caster), spots: number[][] = [];
        for (let i = 0; i < 3; i++) {
          const far = grow + 0.06 + 0.07 * i, sx = at.x + from.x * far + from.y * (hashOf(k.seed, 20 + i) - 0.5) * 0.12, sy = at.y + from.y * far - from.x * (hashOf(k.seed, 20 + i) - 0.5) * 0.12;
          const rr = 0.022 * (1 - i * 0.2) * smooth(age / (0.6 + i * 0.5));
          const sp: number[] = [];
          for (let j = 0; j < 5; j++) sp.push(sx + Math.cos((j / 5) * TAU) * rr, sy + Math.sin((j / 5) * TAU) * rr);
          spots.push(sp);
        }
        k.groundShape(at.x, at.y, grow + 0.35, [{ kind: 'fill', colour: shade, alpha: 0.65 * stop * smooth(age / 0.6) * lateFade(left, 0.6), paths: [blot, ...spots], lift: 0.1 }]);
        tally(k, b, footOf(b), KNIFE_BLEED_SECS, left, { point: 'in', size: 0.1, alpha: 0.75 * stop * smooth(age / 0.4), colour: '#d2584a' });
      } },
    },
  },

  // Parting Throw (throw, on enemy): a throw at 100%, and you leap 3 tiles straight back from it, over ground you could walk.
  skirmisher_parting_throw: {
    palette: PALETTE,
    cast: { timing: PART.timing, pose: partPose, move: { from: PART_OFF, to: PART_DOWN } },
    fx: {
      charge: (k, t) => {
        followHeld(k, PART, t);
        k.flare(k.hand(1), 4, bump(t, PART.throws[0] - 0.05, PART.throws[0], PART.throws[0] + 0.08), k.pal.core, 0.3);
        // The leap, when the island made one: dust off both feet as it goes, again as it lands.
        const from = k.from;
        if (!from) return;
        if (t >= PART_OFF && k.state.off === undefined) {
          k.state.off = 1;
          scuff(k, k.on(from.x, from.y, 0.5), 12, k.toward(k.target, from), 1.3);
        }
        if (t >= PART_DOWN && k.state.landed === undefined) {
          k.state.landed = 1;
          scuff(k, k.at(k.caster, 0.02), 12, k.toward(from, k.caster), 1.4);
        }
        if (t < PART_OFF + 0.03) return;
        const bx = k.caster.x, by = k.caster.y, far = Math.hypot(bx - from.x, by - from.y);
        if (far < 0.25) return;
        const ax = (bx - from.x) / far, ay = (by - from.y) / far;
        // The smear of it: one tapered ribbon from where it left the ground to the body at the height of the knees, eaten
        // from its tail once the body is down.
        const eaten = smooth(seg(t, PART_DOWN - 0.02, 0.95));
        if (eaten < 0.98) {
          const n = Math.round(clamp((far - 0.25) / 2.75) * 2) + 8, knee = 5;
          const line: P3[] = [];
          for (let i = 0; i <= n; i++) {
            const v = i / n, x = lerp(from.x, bx, v), y = lerp(from.y, by, v);
            line.push({ x, y, z: k.ground(x, y) + knee + 3 * Math.sin(Math.PI * v) * (1 - eaten) });
          }
          k.ribbon(eatTail(line, eaten), { width: 3.2, taper: 'start', alpha: 0.75, edge: false, glow: 0.5, main: k.pal.main });
        }
        // A chevron for every tile it has crossed, pointing the way it went, put down as the body passes over each.
        const n = Math.max(1, Math.round(PART_LEAP));
        const pts: number[][] = [], alphas: number[] = [];
        for (let i = 0; i < n; i++) {
          const s = i + 0.5;
          if (s > far) break;
          chevronOn(from.x + ax * s, from.y + ay * s, ax, ay, 0.16, pts);
          alphas.push(0.9 * (1 - smooth(seg(t, 0.86 + i * 0.03, 0.99))));
        }
        drawChevrons(k, (from.x + bx) / 2, (from.y + by) / 2, far / 2 + 0.3, pts, alphas);
      },
      release: (k) => letGo(k),
      travel: throwTravel(PART_FLIGHT, { wake: { span: 0.14, spread: 0.045, width: 2.2 } }),
      hit: (k) => bite(k, aimAt(k), landedDir(k)),
      impact: { secs: 0.5, draw: (k, u) => {
        glint(k, aimAt(k), u);
        stuck(k, thrownBy(k), aimAt(k), landedDir(k), u, landedSpin(k));
      } },
    },
  },

  // Double Throw (throw, on enemy): two throws at 70% each, one after the other.
  skirmisher_double_throw: (() => {
    const gap = (DOUBLE.throws[1] - DOUBLE.throws[0]) * DOUBLE.timing.secs;
    const fly = flightSecs(DOUBLE_FLIGHT);
    /** Where each of the two goes in: a hand apart, the first a little high and to one side, the second low to the other. */
    const into = (k: FxScene, i: number): P3 => {
      const at = aimAt(k), side = across(between(k.at(k.caster, 0.6), at)), w = (k.target.wide / 40) * 0.6 * (i ? -1 : 1);
      return { x: at.x + side.x * w, y: at.y + side.y * w, z: at.z + (i ? -1.5 : 1.5) };
    };
    return {
      palette: PALETTE,
      cast: { timing: DOUBLE.timing, pose: doublePose },
      fx: {
        charge: (k, t) => {
          followHeld(k, DOUBLE, t);
          for (let i = 0; i < DOUBLE.throws.length; i++) k.flare(k.hand(1), 4, bump(t, DOUBLE.throws[i] - 0.05, DOUBLE.throws[i], DOUBLE.throws[i] + 0.08), k.pal.core, 0.3);
          // The second leaves the hand while the first is in the air: kept where it left, as the first was at the release.
          if (t >= DOUBLE.throws[1] && k.state.h2gx === undefined) letGo(k, 'h2');
        },
        release: (k) => letGo(k),
        travel: {
          secs: (tiles) => gap + fly(tiles),
          draw: (k, u) => {
            if (k.state.t0 === undefined) k.state.t0 = k.now;
            if (k.state.lift === undefined) k.state.lift = DOUBLE_FLIGHT.lift(k.dist);
            const total = gap + fly(k.dist), el = u * total, f = fly(k.dist);
            for (let i = 0; i < DOUBLE_N && i < 2; i++) {
              const v = (el - i * gap) / f;
              const to = into(k, i);
              if (v >= 0 && v < 1) {
                // The first flatter and quicker off the chest, the second the full throw.
                const { d } = flying(k, DOUBLE_FLIGHT, launchOf(k, i ? 'h2' : 'h'), to, v, { wake: { span: 0.14, spread: i ? 0.045 : 0.025, width: i ? 2.2 : 1.7 }, lift: k.state.lift * (i ? 1 : 0.6) });
                k.state[`d${i}x`] = d.x;
                k.state[`d${i}y`] = d.y;
                k.state[`d${i}z`] = d.z;
              } else if (v >= 1 && i === 0) {
                // The first in: bitten as any throw lands, and stood in it while the second comes.
                const d = { x: k.state.d0x ?? 0, y: k.state.d0y ?? 1, z: k.state.d0z ?? 0 };
                if (k.state.bit0 === undefined) {
                  k.state.bit0 = 1;
                  bite(k, to, d, 0.7);
                }
                const w = (el - f) / 0.5;
                glint(k, to, clamp(w), 5);
                stuck(k, thrownBy(k), to, d, 0.3, landedSpin(k));
              }
            }
          },
        },
        hit: (k) => bite(k, into(k, 1), { x: k.state.d1x ?? 0, y: k.state.d1y ?? 1, z: k.state.d1z ?? 0 }, 0.9),
        impact: { secs: 0.6, draw: (k, u) => {
          for (let i = 0; i < 2; i++) {
            const d = { x: k.state[`d${i}x`] ?? 0, y: k.state[`d${i}y`] ?? 1, z: k.state[`d${i}z`] ?? 0 };
            stuck(k, thrownBy(k), into(k, i), d, i ? u : 0.3 + 0.7 * u, landedSpin(k) + i);
          }
          glint(k, into(k, 1), u, 7);
        } },
      },
    } satisfies SpellVisual;
  })(),

  // Ricochet (throw, on enemy): a throw at 100% that, when it lands, glances on to the nearest other enemy within 3 tiles of it at 60%.
  skirmisher_ricochet: (() => {
    const glanceSecs = 0.34;
    /**
     * Where the glance goes, decided as it lands: the nearest other enemy within `fx.reach` of what it hit, followed as
     * it moves; with none there, off the side a skimmed stone would go, spent in the grass a tile on.
     */
    const pick = (k: FxScene): void => {
      if (k.state.gno !== undefined) return;
      const next = othersNear(k, RICO_REACH)[0];
      k.state.gno = next ? creatureNo(next) : -1;
      const d = landedDir(k), at = aimAt(k);
      const sd = hashOf(k.seed, 3) < 0.5 ? -1 : 1, ang = sd * 0.95;
      const dx = d.x * Math.cos(ang) - d.y * Math.sin(ang), dy = d.x * Math.sin(ang) + d.y * Math.cos(ang), l = Math.hypot(dx, dy) || 1;
      const end = next ? aimAt(k, next) : k.on(at.x + (dx / l) * 1.2, at.y + (dy / l) * 1.2, 0.5);
      k.state.ex = end.x; k.state.ey = end.y; k.state.ez = end.z;
    };
    const glanceTo = (k: FxScene): P3 => {
      pick(k);
      const kept = { x: k.state.ex, y: k.state.ey, z: k.state.ez };
      if (k.state.gno < 0) return kept;
      const b = creatureBy(k, k.state.gno, kept, 1.5);
      if (!b) return kept;
      const at = aimAt(k, b);
      k.state.ex = at.x; k.state.ey = at.y; k.state.ez = at.z;
      return at;
    };
    return {
      palette: PALETTE,
      cast: { timing: RICO.timing, pose: ricoPose },
      fx: {
        charge: (k, t) => followHeld(k, RICO, t),
        release: (k) => letGo(k),
        travel: throwTravel(RICO_FLIGHT, { wake: { span: 0.16, spread: 0.03, width: 2 } }),
        hit: (k) => {
          const d = landedDir(k), at = aimAt(k);
          // Glancing: sparks off sideways, the way it goes on, rather than on through.
          const on = between(at, glanceTo(k));
          k.burst(at, 16, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 1.8, life: [0.18, 0.4], speed: [1.4, 3], up: [-4, 16], heading: { x: on.x, y: on.y }, cone: 1, gravity: 50, drag: 0.05 });
          k.burst(at, 4, { kind: 'shard', colour: [k.pal.accent, k.pal.main], size: 1.6, life: [0.3, 0.5], speed: [0.4, 1], up: [6, 18], heading: { x: -d.x, y: -d.y }, cone: 2, gravity: 70, spin: 3, bias: 2 });
        },
        impact: { secs: glanceSecs + 0.5, draw: (k, u) => {
          const at = aimAt(k), secs = glanceSecs + 0.5, el = u * secs;
          glint(k, at, clamp(el / 0.4), 7);
          // Its reach from where it hit, drawn as the glance goes out: whatever it can glance on to is inside it.
          reachRing(k, k.target, RICO_REACH, u);
          const v = el / glanceSecs, to = glanceTo(k);
          if (v < 1) {
            // On, lighter: the glance, at three-fifths of the throw.
            const path = (w: number): P3 => arcAt(at, to, w, 3);
            wake(k, path, v, { span: 0.3, spread: 0.03, width: 1.6, alpha: 0.75 });
            const kind = thrownBy(k);
            thrownAt(k, kind, path(v), arcDir(at, to, v, 3), k.now * RICO_FLIGHT.turns * TAU, { sheen: 0.9, alpha: 0.85, scale: 0.85 });
            shadowOf(k, path(v), 3);
          } else {
            const into = k.state.gno >= 0;
            if (k.state.glanced === undefined) {
              k.state.glanced = 1;
              // Into the next creature, bitten as a throw is but lighter; or down into the grass with nothing to find.
              if (into) bite(k, to, arcDir(at, to, 1, 3), 0.6);
              else scuff(k, to, 6);
            }
            if (into) {
              glint(k, to, clamp((el - glanceSecs) / 0.45), 5);
              stuck(k, thrownBy(k), to, arcDir(at, to, 1, 3), clamp((el - glanceSecs) / 0.5), landedSpin(k));
            } else stuck(k, thrownBy(k), to, { x: 0, y: 0, z: -1 }, clamp((el - glanceSecs) / 0.5), landedSpin(k));
          }
        } },
      },
    } satisfies SpellVisual;
  })(),

  // Opportunist (buff, on self, lasts 10 s): For 10 s every blow, throw and shot of yours on a creature fighting somebody else does 30% more damage.
  skirmisher_opportunist: {
    palette: PALETTE,
    cast: { timing: OPP, pose: oppPose },
    fx: {
      charge: (k, t) => {
        // Two chevrons closing on the eyes from either side as it looks, snapping shut at the tap.
        const u = smooth(seg(t, OPP_LOW + 0.05, OPP_TAP));
        const a = smooth(seg(t, OPP_LOW, OPP_LOW + 0.1)) * (1 - smooth(seg(t, OPP_TAP + 0.04, OPP_TAP + 0.14)));
        if (a > 0.02) {
          const eye = k.head(), x = k.sx(eye), y = k.sy(eye) + 1.2 * k.zoom, z = k.zoom;
          airChevrons(k, eye, [-1, 1].map((s) => [x + s * (16 - 12 * u) * z, y, s < 0 ? 0 : Math.PI, 3.4 * z] as const), a, { bias: 6 });
          k.glow(eye, 6, 0.4 * a);
        }
      },
      hit: (k) => {
        // Shut: a snap of sand-coloured sparks out from the eyes.
        k.flare(k.head(), 6, 1, k.pal.core, 0.2);
        k.burst(k.head(), 8, { kind: 'spark', colour: [k.pal.accent, '#f3dcae'], size: 1.2, life: [0.15, 0.3], speed: [0.6, 1.2], up: [-4, 6], gravity: 0, drag: 0.08, over: true });
      },
      // The ring comes down to the feet out wide and snaps in to its size, every chevron lit; the linger takes it from there.
      impact: { secs: OPP_IN, draw: (k, u) => {
        const r = footOf(k.caster) + 0.7 * (1 - easeBack(u));
        tally(k, k.caster, r, OPP_SECS, OPP_SECS, { point: 'round', alpha: 0.85 * smooth(u * 3), colour: k.pal.light, turn: u * 0.6 });
      } },
      // The seconds it lasts: chevrons round the feet pointing round them, turning as eyes do sweeping a field; every so often
      // a glint at the eyes, and a sand chevron over the nearest creature that is fighting -- the opening it is waiting for.
      linger: { draw: (k, age, left) => {
        if (age < OPP_IN) return;
        const a = smooth(left / 0.5);
        tally(k, k.caster, footOf(k.caster), OPP_SECS, left, { point: 'round', alpha: 0.85 * a, colour: k.pal.light, turn: OPP_IN * 0.6 + (age - OPP_IN) * 0.35 });
        const w = (age % 2.5) / 2.5, glint = a * bump(w, 0, 0.05, 0.16);
        if (glint > 0.01) k.flare(k.head(), 3.2, glint, k.pal.accent, 0.3, k.pal.accent, true);
        const seen = a * bump(w, 0.04, 0.12, 0.4);
        if (seen > 0.01) {
          const b = hunterNear(k, 10);
          if (b) {
            const over = k.at(b, 1.15), x = k.sx(over), y = k.sy(over), z = k.zoom;
            airChevrons(k, over, [[x, y - (1 - seen) * 5 * z, Math.PI / 2, 6 * z]], seen, { bias: 4 });
            k.flare(over, 4, seen * 0.8, k.pal.accent, 0.3, k.pal.accent, true);
          }
        }
      } },
    },
  },

  // Fade (buff, on self, lasts 10 s): Every creature hunting you loses you, and will not come for you again for 10 s unless you strike it.
  skirmisher_fade: (() => {
    const SECS = fxOf('fade').secs ?? 10;
    /** The body gone thin and grey: how far to nothing, and how far to the haze's grey. */
    const THIN = 0.45, GREY = 0.4, HAZE = '#6f8f88';
    return {
      palette: PALETTE,
      cast: { timing: FADE, pose: fadePose },
      fx: {
        charge: (k, t) => {
          const w = smooth(seg(t, 0.22, 0.5));
          k.veil(k.caster, { colour: HAZE, tint: GREY * w, fade: THIN * w });
          const u = seg(t, 0.2, 0.46);
          if (u > 0 && u < 1 && !k.fast) k.emit(k.at(k.caster, 0.02), 9 * u, { kind: 'mist', colour: ['#8fa8a2', '#a9bcb6'], size: 2, sizeEnd: 4.4, life: [0.5, 0.9], speed: [0.1, 0.25], up: [1, 3], gravity: -1, jitter: 0.2, bias: -1 });
        },
        hit: (k) => {
          // The puff it goes in: low and all round, out of the ground.
          k.burst(k.at(k.caster, 0.03), 18, { kind: 'mist', colour: ['#8fa8a2', '#a9bcb6', '#6f8f88'], size: 2.2, sizeEnd: 5, life: [0.6, 1.1], speed: [0.6, 1.1], up: [1, 4], gravity: -1, drag: 0.04, jitter: 0.12, bias: -1 });
        },
        impact: { secs: 0.9, draw: (k, u) => {
          // Three grey wisps winding up round the body and thinning into the haze.
          const b = k.caster, n = k.fast ? 4 : 7;
          for (let w = 0; w < 3; w++) {
            const pts: P3[] = [];
            const head = easeOut(u) * 1.3;
            for (let i = 0; i <= n; i++) {
              const v = head - 0.5 * (1 - i / n);
              if (v < 0) continue;
              const ang = (w * TAU) / 3 + v * 5.5;
              const r = (0.09 + 0.05 * v) * (b.wide / 4);
              pts.push({ x: b.x + Math.cos(ang) * r, y: b.y + Math.sin(ang) * r, z: b.z + b.tall * Math.min(1.1, v * 0.85) });
            }
            if (pts.length >= 2) k.ribbon(pts, { width: 3, taper: 'both', alpha: 0.45 * (1 - smooth(seg(u, 0.4, 1))), edge: false, main: HAZE, core: '#8fa8a2', deep: HAZE, glow: 0 });
          }
          k.ring(b, footOf(b) + 0.4 * easeOut(u), { band: 0.04 * (1 - u), alpha: 0.5 * (1 - u), main: '#a9bcb6', deep: HAZE, glow: 0 });
        } },
        // While it lasts: the body thin and grey, a haze low at the feet, and a broken ring of chevrons pointing out -- eyes
        // turned off you -- one to a second; and every couple of seconds over the nearest creature hunting about, a grey
        // chevron that points at you and turns away.
        linger: { draw: (k, age, left) => {
          const b = k.caster, a = smooth(age / 0.6) * smooth(left / 0.8);
          k.veil(b, { colour: HAZE, tint: GREY * smooth(left / 0.8), fade: THIN * smooth(left / 0.8) });
          const drift = 0.06 * Math.sin(age * 1.7);
          tally(k, b, footOf(b) + 0.12 + drift, SECS, left, { point: 'out', alpha: 0.65 * a, turn: age * 0.25, colour: '#cfe3dc' });
          if (!k.fast) k.emit(k.at(b, 0.02), 4 * a, { kind: 'mist', colour: ['#8fa8a2', '#a9bcb6'], size: 1.8, sizeEnd: 3.6, life: [0.8, 1.4], speed: [0.08, 0.2], up: [0.3, 1.2], gravity: -0.3, jitter: 0.35, bias: -1 });
          const w = ((age + 1.2) % 2.4) / 2.4, lost = a * bump(w, 0, 0.12, 0.5);
          if (lost > 0.01) {
            const h = hunterNear(k, 8);
            if (h) {
              const over = k.at(h, 1.15), x = k.sx(over), y = k.sy(over), z = k.zoom;
              // At you, then turned away from you.
              const toYou = Math.atan2(k.sy(b) - y, k.sx(b) - x), turn = toYou + Math.PI * smooth(seg(w, 0.08, 0.32));
              airChevrons(k, over, [[x, y, turn, 6 * z]], lost, { colour: '#d6e2de', bias: 4 });
            }
          }
        } },
      },
    } satisfies SpellVisual;
  })(),

  // Fan of Blades (throw, on enemy): a throw at 60% at the enemy you aim at and at every other enemy within 3 tiles of it.
  skirmisher_fan_of_blades: (() => {
    /**
     * The fan, decided as it leaves the hand: the weapon at what was aimed at, and a copy at every other enemy within
     * `fx.reach` of it -- as many as there are and no more -- ordered from one side of the throw to the other, so the
     * blades leave the hand in the order the arm sweeps across. Kept by number: `n` blades, blade `j` at creature
     * `no{j}` (-1 the one aimed at), last seen at `x{j}` `y{j}` `z{j}`.
     */
    const pick = (k: FxScene): void => {
      if (k.state.n !== undefined) return;
      const d = k.toward(k.caster, k.target);
      const sideOf = (b: Body): number => Math.atan2(d.x * (b.y - k.caster.y) - d.y * (b.x - k.caster.x), d.x * (b.x - k.caster.x) + d.y * (b.y - k.caster.y));
      const all: Array<{ b: Body; no: number; side: number }> = [{ b: k.target, no: -1, side: 0 }];
      for (const b of othersNear(k, FAN_REACH).slice(0, FAN_MOST - 1)) all.push({ b, no: creatureNo(b), side: sideOf(b) });
      all.sort((a, b) => b.side - a.side);
      k.state.n = all.length;
      all.forEach((o, j) => {
        const at = aimAt(k, o.b);
        k.state[`no${j}`] = o.no;
        k.state[`x${j}`] = at.x; k.state[`y${j}`] = at.y; k.state[`z${j}`] = at.z;
      });
    };
    /** Where blade `j` comes down this frame: at whoever it went at, followed while they are there. */
    const landing = (k: FxScene, j: number): P3 => {
      pick(k);
      const no = k.state[`no${j}`];
      if (no < 0) return aimAt(k);
      const kept = { x: k.state[`x${j}`], y: k.state[`y${j}`], z: k.state[`z${j}`] };
      const b = creatureBy(k, no, kept, 1.5);
      if (!b) return kept;
      const at = aimAt(k, b);
      k.state[`x${j}`] = at.x; k.state[`y${j}`] = at.y; k.state[`z${j}`] = at.z;
      return at;
    };
    const fly = flightSecs(FAN_FLIGHT);
    /** The reach round what was aimed at opens out as the fan goes, by the seconds since it left the hand. */
    const RING_SECS = 1.2;
    const ring = (k: FxScene): void => reachRing(k, k.target, FAN_REACH, clamp(k.released / RING_SECS));
    return {
      palette: PALETTE,
      cast: { timing: FAN.timing, pose: fanPose },
      fx: {
        charge: (k, t) => {
          followHeld(k, FAN, t);
          k.glow(k.hand(1), 6, 0.6 * bump(t, 0.3, 0.55, 0.62));
        },
        release: (k) => {
          letGo(k);
          pick(k);
        },
        travel: {
          // Long enough for the furthest a copy can go: from the far side of the reach.
          secs: (tiles) => fly(tiles + FAN_REACH) + FAN_STAGGER * (FAN_MOST - 1),
          draw: (k, u) => {
            if (k.state.t0 === undefined) k.state.t0 = k.now;
            pick(k);
            ring(k);
            const total = fly(k.dist + FAN_REACH) + FAN_STAGGER * (FAN_MOST - 1), el = u * total, from = launchOf(k).from;
            for (let j = 0; j < k.state.n; j++) {
              const real = k.state[`no${j}`] < 0, to = landing(k, j);
              const far = Math.hypot(to.x - k.caster.x, to.y - k.caster.y), f = fly(far), v = (el - j * FAN_STAGGER) / f;
              if (v < 0) continue;
              const kind = thrownBy(k);
              if (v < 1) {
                if (k.state[`l${j}`] === undefined) k.state[`l${j}`] = FAN_FLIGHT.lift(far);
                const lift = k.state[`l${j}`];
                if (real) {
                  const { d } = flying(k, FAN_FLIGHT, launchOf(k), to, v, { wake: { span: 0.14, spread: 0.04, width: 2 }, lift });
                  k.state[`d${j}x`] = d.x; k.state[`d${j}y`] = d.y;
                } else {
                  // A copy: the weapon's shape in the spell's light, thinner, a streak of light behind it (laid in the glow,
                  // which it is, so a fan of them stays within its shapes), no shadow.
                  const path = (w: number): P3 => arcAt(from, to, w, lift);
                  const d = arcDir(from, to, v, lift);
                  const streak = [path(Math.max(0, v - 0.14)), path(Math.max(0, v - 0.07)), path(v)].map((p) => [k.sx(p), k.sy(p)]);
                  k.glowDraw((g) => {
                    g.globalAlpha = 0.7;
                    g.strokeStyle = k.pal.light;
                    g.lineCap = 'round';
                    for (let i = 1; i < streak.length; i++) {
                      g.lineWidth = Math.max(0.8, 0.8 * i * k.zoom);
                      g.beginPath();
                      g.moveTo(streak[i - 1][0], streak[i - 1][1]);
                      g.lineTo(streak[i][0], streak[i][1]);
                      g.stroke();
                    }
                  });
                  thrownAt(k, kind, path(v), d, k.now * FAN_FLIGHT.turns * TAU + j, { alpha: 0.8, scale: kind === 'javelin' ? 0.7 : 0.85, ghost: true });
                  k.state[`d${j}x`] = d.x; k.state[`d${j}y`] = d.y;
                }
              } else {
                const d = { x: k.state[`d${j}x`] ?? 0, y: k.state[`d${j}y`] ?? 1, z: -0.3 };
                if (k.state[`in${j}`] === undefined) {
                  k.state[`in${j}`] = 1;
                  bite(k, to, d, real ? 0.8 : 0.55);
                }
                stuck(k, kind, to, d, real ? 0.2 : 0.4, j, { ghost: !real, alpha: real ? 1 : 0.8 });
              }
            }
          },
        },
        // The fan is down: the reach of it round what was aimed at opened to its edge, and every blade glints and stands where
        // it came down for a beat -- the copies going first, back into light.
        impact: { secs: 0.7, draw: (k, u) => {
          pick(k);
          ring(k);
          for (let j = 0; j < k.state.n; j++) {
            const real = k.state[`no${j}`] < 0, at = landing(k, j), d = { x: k.state[`d${j}x`] ?? 0, y: k.state[`d${j}y`] ?? 1, z: -0.3 };
            glint(k, at, clamp(u * 1.4 - j * 0.04), real ? 7 : 5);
            stuck(k, thrownBy(k), at, d, real ? 0.2 + 0.8 * u : 0.4 + 1.2 * u, j, { ghost: !real, alpha: real ? 1 : 0.8 });
          }
        } },
      },
    } satisfies SpellVisual;
  })(),

  // Marked for Death (curse, on enemy, lasts 15 s): An enemy within 12 tiles: for 15 s every blow, throw and shot a person lands on it is critical twice as often.
  skirmisher_marked_for_death: (() => {
    const SECS = fxOf('marked_for_death').secs ?? 0;
    /** Seconds the sight takes to close and lock. */
    const MARK_LOCK = 0.55;
    /**
     * The sight on it: a thin ring `r` pixels round where a throw goes in with four ticks pointing in at it, turned
     * `turn`, laid over everything (so neither the body it is on nor the night hides it) -- a sight held on it, not
     * shapes stuck to its chest.
     */
    const reticle = (k: FxScene, at: P3, r: number, turn: number, alpha: number): void => {
      if (alpha <= 0.01) return;
      const x = k.sx(at), y = k.sy(at), z = k.zoom, R = r * z, pal = k.pal;
      const draw = (g: CanvasRenderingContext2D, col: string, w: number): void => {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.beginPath();
        g.ellipse(x, y, R, R * 0.8, 0, 0, TAU);
        for (let i = 0; i < 4; i++) {
          const ang = turn + Math.PI / 4 + (i * Math.PI) / 2, c = Math.cos(ang), s = Math.sin(ang) * 0.8;
          g.moveTo(x + c * R * 1.35, y + s * R * 1.35);
          g.lineTo(x + c * R * 0.55, y + s * R * 0.55);
        }
        g.stroke();
      };
      k.glowDraw((g) => {
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = clamp(alpha);
        g.lineCap = 'round';
        draw(g, pal.ink, Math.max(2, 2.4 * z));
        draw(g, pal.accent, Math.max(1, 1.1 * z));
        g.globalCompositeOperation = 'lighter';
      });
    };
    return {
      palette: PALETTE,
      cast: { timing: MARK, pose: markPose },
      fx: {
        charge: (k, t) => {
          // Seen: a glint at the eye under the fingers.
          k.flare(k.head(), 4.5, bump(t, 0.26, 0.36, 0.5), k.pal.accent, 0.4, k.pal.accent, true);
        },
        travel: { secs: (tiles) => 0.08 + tiles * 0.02, draw: (k, u) => {
          // The line of it, run out from the pointing hand to the creature, the sight at its head.
          const from = k.hand(0), to = aimAt(k), head = mid3(from, to, easeOut(u));
          k.beam(mid3(from, to, Math.max(0, easeOut(u) - 0.5)), head, { width: 1.6, alpha: 0.9, main: k.pal.core, glow: 0.9 });
          reticle(k, head, 3, 0, 0.9);
        } },
        hit: (k) => {
          k.burst(aimAt(k), 10, { kind: 'spark', colour: [k.pal.accent, '#f3dcae'], size: 1.4, life: [0.2, 0.45], speed: [0.4, 1], up: [2, 12], gravity: 0, drag: 0.06, over: true });
        },
        impact: { secs: MARK_LOCK, draw: (k, u) => {
          // The sight closing on it, over-shooting and settling: it is locked.
          const at = aimAt(k);
          reticle(k, at, 6 + 12 * (1 - easeBack(u)), (1 - u) * 0.9, smooth(u * 4));
          k.beam(k.hand(0), at, { width: 1.4, alpha: 0.8 * (1 - smooth(u * 1.6)), main: k.pal.core, glow: 0.8 });
          glint(k, at, u, 6);
        } },
        linger: { draw: (k, age, left) => {
          const b = k.target, a = smooth(age / 0.5) * smooth(left / 0.6);
          const at = aimAt(k);
          // Breathing in a little now and then, as a sight is held on it.
          const held = age - MARK_LOCK, breathe = 1 + 0.12 * Math.sin(held * 2.4);
          // Taken over from the impact's sight once it has locked, from where that one left it.
          if (held >= 0) reticle(k, at, 6 * breathe, held * 0.25, 0.85 * a);
          tally(k, b, footOf(b) + 0.08, SECS, left, { point: 'in', alpha: 0.8 * a, size: 0.09 });
        } },
      },
    } satisfies SpellVisual;
  })(),
};
