/**
 * The Skirmisher's spells: how each is cast and what it looks like.
 *
 * A Skirmisher fights from a few tiles off with something thrown, so nearly
 * every spell here is a throw, and what tells them apart has to be the body
 * and the flight: a flick from the ear, a crow-hop and a long lob, a sidearm
 * skim, a two-handed hurl, a low underhand at the belly, a throw and a leap
 * back, two in a rhythm, a spinning fan. The group's own marks are what
 * the weapon leaves in the air and on the ground: a two-tailed wake, thin as
 * a swallow's, behind whatever is thrown, and chevrons in sand on the land
 * -- pointing where it went, and one to a second wherever a spell lasts, so
 * a buff or a mark is seen running out.
 *
 * ## The weapon that is thrown
 *
 * The figure keeps a javelin upright at the hip whatever the arm does, and
 * keeps a throwing axe or a knife in the fist after it has gone. So the
 * casts here put the weapon away (`Rig.stowed`) for as long as the hand is
 * empty, and draw what is thrown themselves:
 *
 *   - a javelin (carried 'staff'): put on the back from the first moments of
 *     the cast, and drawn here in the hand, lying along the line of the
 *     throw, until it leaves; the hand reaches back over the shoulder to
 *     draw the next as the cast ends, which is when the real one comes back.
 *   - an axe or a knife (carried in the fist): swung by the forearm
 *     (`Rig.wield`) up to the release, put away on the belt as it leaves the
 *     hand, and drawn again from the hip in the recovery.
 *
 * `HELD` below is when each spell has what in the hand, read by the pose and
 * the effects alike so that the two never disagree.
 */
import { KNIFE_BLEED_SECS, STAGGER_MAUL } from '../../game/fight';
import { weaponCarry, type Euler, type Rig } from '../figure';
import { UNITS_PER_TILE } from '../iso';
import type { CastPose, CastTiming, PoseCue, SpellVisual } from './index';
import { spellInfo } from './info';
import { arcAt, bump, clamp, easeBack, easeOut, flashOf, hashOf, lerp, mid3, seg, smooth, TAU, type Body, type FxScene, type P3, type SpellPalette } from './kit';
import { euler, one, type Key } from './poses';

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

/** How much of the pose is the cast's at `t`, as the stage blends it (`castWeight`): a switch in the pose holds from a half. */
const castW = (t: number, timing: CastTiming): number => {
  const a = timing.blendIn ?? 0.12, b = timing.blendOut ?? 0.25;
  return smooth(a > 0 ? t / a : 1) * smooth(b > 0 ? (1 - t) / b : 1);
};

/* ---- what is in the hand, and when ------------------------------------------------------ */

/**
 * When a throw's weapon leaves the hand and when the next is drawn, as
 * fractions of the cast: `throws[i]` it goes, `draws[i]` the next is in the
 * hand. Javelins are drawn by the effects up to each throw; an axe or a knife
 * is the figure's own, swung by the forearm.
 */
interface Held {
  timing: CastTiming;
  throws: readonly number[];
  draws: readonly number[];
}

/** Whether the right hand holds a javelin drawn by the effects at `t`. */
function javelinInHand(h: Held, t: number): boolean {
  if (castW(t, h.timing) < 0.5) return false;
  if (t < h.throws[0]) return true;
  for (let i = 1; i < h.throws.length; i++) if (t >= h.draws[i - 1] && t < h.throws[i]) return true;
  return false;
}

/** The figure's weapon put away or wielded, as `Held` says: what every throw's pose ends with. */
function holdFor(r: Rig, t: number, c: PoseCue, h: Held): void {
  if (c.carry === 'fist') {
    let gone = false;
    for (let i = 0; i < h.throws.length; i++) if (t >= h.throws[i] && t < h.draws[i]) gone = true;
    r.stowed = gone;
    r.wield = gone ? 0 : 1;
  } else if (c.carry === 'staff' || c.carry === null) {
    // A javelin rides on the back the whole cast but for the moment of drawing the next, which is when it is in the fist again.
    r.stowed = t < h.draws[h.draws.length - 1];
  }
}

/**
 * The arm reaching for the next weapon after a throw, from `from` to `to`
 * of the cast: over the right shoulder for a javelin, down to the right hip
 * for an axe or a knife. Laid over whatever the arm was doing between.
 */
function reachForNext(r: Rig, t: number, c: PoseCue, from: number, at: number, to: number): void {
  if (t <= from || t >= to) return;
  const w = t < at ? smooth(seg(t, from, at)) : 1 - smooth(seg(t, at, to));
  const back = c.carry === 'fist' ? ([-8, 22, -6] as const) : ([148, 34, -44] as const);
  const bend = c.carry === 'fist' ? 62 : 128;
  for (let j = 0; j < 3; j++) r.arm[1][j] = lerp(r.arm[1][j], back[j], w);
  r.elbow[1] = lerp(r.elbow[1], bend, w);
  r.open[1] = false;
  r.head[2] = lerp(r.head[2], c.carry === 'fist' ? r.head[2] : 10, w * 0.5);
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
/** A direction in a body's own terms: to its right, ahead of it and up. */
function bodyDir(k: FxScene, b: Body, right: number, ahead: number, up: number): V {
  const o = k.local(b, 0, 0, 0), p = k.local(b, right, ahead, up);
  return unitV((p.x - o.x) * U, (p.y - o.y) * U, p.z - o.z);
}
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

/** A javelin's length behind the fist and ahead of it, height units (the figure's own javelin, butt to point). */
const JAV_BACK = 2.6, JAV_AHEAD = 10.8;

/**
 * A javelin as it is drawn on the body, gripped at `grip` and lying along `d`:
 * an inked ash shaft, the pale vanes at the butt and a long iron head. In two
 * halves, each sorted where it is, so a javelin held across a body is in
 * front of it at one end and behind it at the other.
 */
function javelin(k: FxScene, grip: P3, d: V, o: { alpha?: number; sheen?: number; bias?: number; ahead?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const ahead = o.ahead ?? JAV_AHEAD;
  const butt = along(grip, d, -JAV_BACK), neck = along(grip, d, Math.min(ahead, JAV_AHEAD - 1.3)), tip = along(grip, d, ahead);
  const midP = mid3(butt, tip, 0.5);
  const bx = k.sx(butt), by = k.sy(butt), nx = k.sx(neck), ny = k.sy(neck), tx = k.sx(tip), ty = k.sy(tip);
  const mx = k.sx(midP), my = k.sy(midP);
  const len = Math.hypot(tx - bx, ty - by) || 1;
  const ux = (tx - bx) / len, uy = (ty - by) / len, px = -uy, py = ux;
  const z = k.zoom, shaft = Math.max(1.1, 0.7 * z), ink = Math.max(0.8, 0.55 * z);
  const sheen = o.sheen ?? 0;
  const pal = k.pal;
  const half = (g: CanvasRenderingContext2D, from: number): void => {
    g.globalAlpha = clamp(a);
    g.lineCap = 'butt';
    const x0 = from ? mx : bx, y0 = from ? my : by, x1 = from ? nx : mx, y1 = from ? ny : my;
    g.strokeStyle = '#2a1c10';
    g.lineWidth = shaft + 2 * ink;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = '#a07a4c';
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
      g.fillStyle = '#e8e0c8';
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
      const w = 1.25 * z, hx = lerp(nx, tx, 0.3), hy = lerp(ny, ty, 0.3);
      g.fillStyle = '#6f7a84';
      g.beginPath();
      g.moveTo(nx, ny);
      g.lineTo(hx - px * w, hy - py * w);
      g.lineTo(tx, ty);
      g.closePath();
      g.fill();
      g.fillStyle = '#d6dde2';
      g.beginPath();
      g.moveTo(nx, ny);
      g.lineTo(hx + px * w, hy + py * w);
      g.lineTo(tx, ty);
      g.closePath();
      g.fill();
      g.strokeStyle = '#1e2328';
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
  k.worldDraw(mid3(butt, midP, 0.5), (g) => half(g, 0), o.bias ?? 0);
  k.worldDraw(mid3(midP, tip, 0.5), (g) => half(g, 1), o.bias ?? 0);
}

/**
 * A throwing axe or a knife turning end over end, its middle at `at`, going
 * along `d`, turned `spin` radians: a dark haft and an inked iron head -- a
 * francisca's sweep of a bit, or a knife's straight blade.
 */
function spinner(k: FxScene, kind: 'axe' | 'knife', at: P3, d: V, spin: number, o: { alpha?: number; scale?: number; bias?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
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
    g.strokeStyle = '#21160c';
    g.lineWidth = (kind === 'axe' ? 1.4 : 1.6) * z * s + 2 * ink;
    g.beginPath();
    g.moveTo(butt[0], butt[1]);
    g.lineTo(top[0], top[1]);
    g.stroke();
    g.strokeStyle = kind === 'axe' ? '#5a3f26' : '#6b4a2c';
    g.lineWidth = (kind === 'axe' ? 1.4 : 1.6) * z * s;
    g.stroke();
    g.lineCap = 'butt';
    g.fillStyle = '#b7c1c8';
    g.beginPath();
    head.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    // The upper half of the head catching the light.
    g.fillStyle = '#e4eaee';
    g.beginPath();
    g.moveTo(head[0][0], head[0][1]);
    const m = Math.floor(head.length / 2);
    for (let i = 1; i <= m; i++) g.lineTo(head[i][0], head[i][1]);
    g.closePath();
    g.fill();
    g.strokeStyle = '#1e2328';
    g.lineWidth = ink;
    g.beginPath();
    head.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.stroke();
  }, o.bias ?? 0);
}

/** Whatever is thrown, at a point of its flight: a javelin's point at `tip`, an axe's or a knife's middle there. */
function thrownAt(k: FxScene, kind: Thrown, tip: P3, d: V, spin: number, o: { alpha?: number; sheen?: number; scale?: number; bias?: number } = {}): void {
  if (kind === 'javelin') javelin(k, along(tip, d, -JAV_AHEAD), d, o);
  else spinner(k, kind, tip, d, spin, o);
}

/* ---- the wake ------------------------------------------------------------------------------ */

/**
 * The group's wake behind whatever is thrown: two thin tails, a swallow's,
 * opening out behind the head and closing on it, drawn along the last `span`
 * of the flight `path`. `spread` tiles apart at their widest, `width` pixels.
 */
function wake(k: FxScene, path: (u: number) => P3, u: number, o: { span?: number; spread?: number; width?: number; alpha?: number; deep?: boolean } = {}): void {
  const span = o.span ?? 0.16, spread = o.spread ?? 0.05, a = o.alpha ?? 0.9;
  const n = k.fast ? 4 : 6;
  const head = path(u), back = path(Math.max(0, u - 0.02));
  const side = across(between(back, head));
  for (const s of [-1, 1]) {
    const pts: P3[] = [];
    for (let i = n; i >= 0; i--) {
      const v = Math.max(0, u - (span * i) / n);
      const p = path(v);
      // Widest a third of the way back from the head, closing to the head and drifting in again at the tail.
      const w = s * spread * Math.sin(Math.PI * Math.min(1, (i / n) * 1.5)) * (u - v > 0 ? 1 : 0);
      pts.push({ x: p.x + side.x * w, y: p.y + side.y * w, z: p.z + Math.abs(w) * 6 });
    }
    k.ribbon(pts, { width: o.width ?? 2.2, taper: 'start', alpha: a, edge: false, glow: 0.7, main: o.deep ? k.pal.deep : k.pal.main });
  }
}

/** The shadow of something in the air, on the ground under it: smaller and fainter the higher it is. */
function shadowOf(k: FxScene, p: P3, r = 3): void {
  const gz = k.ground(p.x, p.y);
  const high = Math.max(0, p.z - gz);
  const a = 0.26 * clamp(1 - high / 60);
  if (a <= 0.02) return;
  const q = k.on(p.x, p.y, 0.1);
  const x = k.sx(q), y = k.sy(q), R = r * k.zoom * (1 - 0.4 * clamp(high / 60));
  k.groundDraw(p.x, p.y, 0.3, (g) => {
    g.globalAlpha = a;
    g.fillStyle = '#0d1a14';
    g.beginPath();
    g.ellipse(x, y, R, R * 0.45, 0, 0, TAU);
    g.fill();
  });
}

/* ---- chevrons ------------------------------------------------------------------------------ */

/**
 * A chevron lying on the ground at (x, y), pointing along (dx, dy), `s`
 * tiles from notch to point: the group's mark on the land. Added to `out` as
 * screen points, four to a chevron.
 */
function chevronOn(k: FxScene, x: number, y: number, dx: number, dy: number, s: number, out: number[]): void {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l, tx = -uy, ty = ux;
  const pts = [[s * 0.6, 0], [-s * 0.4, s * 0.55], [-s * 0.1, 0], [-s * 0.4, -s * 0.55]];
  for (const [a, b] of pts) {
    const px = x + ux * a + tx * b, py = y + uy * a + ty * b;
    out.push(k.sx({ x: px, y: py, z: k.ground(px, py) + 0.2 }), k.sy({ x: px, y: py, z: k.ground(px, py) + 0.2 }));
  }
}

/**
 * Chevrons on the ground (`chevronOn`'s points), each at its own alpha by
 * `alphas`. Those at the same alpha -- all of a count but the one going out --
 * go down as one path, one fill and one inking, as this is drawn again for
 * every line of the ground it lies across.
 */
function drawChevrons(k: FxScene, cx: number, cy: number, reach: number, pts: number[], alphas: number[], colour = k.pal.accent): void {
  if (!pts.length) return;
  const ink = k.pal.ink, w = Math.max(0.8, 0.6 * k.zoom);
  k.groundDraw(cx, cy, reach + 0.5, (g) => {
    g.lineJoin = 'miter';
    g.fillStyle = colour;
    g.lineWidth = w;
    g.strokeStyle = ink;
    let i = 0;
    while (i < alphas.length) {
      const a = alphas[i];
      let j = i;
      g.beginPath();
      for (; j < alphas.length && Math.abs(alphas[j] - a) < 0.004; j++) {
        for (let q = 0; q < 4; q++) {
          const x = pts[8 * j + 2 * q], y = pts[8 * j + 2 * q + 1];
          if (q) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.closePath();
      }
      if (a > 0.01) {
        g.globalAlpha = clamp(a);
        g.fill();
        g.stroke();
      }
      i = j;
    }
  });
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
  const pts: number[] = [], alphas: number[] = [];
  const s = o.size ?? Math.min(0.1, ((TAU * r) / n) * 0.45);
  for (let i = 0; i < n; i++) {
    // The first at the far side, round clockwise as the screen shows it, so the one going out is always the last before it.
    const ang = (o.turn ?? 0) - Math.PI * 0.75 + (i / n) * TAU;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const lit = clamp(left - i);
    if (lit <= 0) continue;
    const dir = o.point === 'in' ? [-ux, -uy] : o.point === 'out' ? [ux, uy] : [-uy, ux];
    chevronOn(k, c.x + ux * r, c.y + uy * r, dir[0], dir[1], s, pts);
    alphas.push(a * smooth(lit));
  }
  drawChevrons(k, c.x, c.y, r + s, pts, alphas, o.colour);
}

/**
 * How far something reaches round a point, shown the group's way: a ring of
 * chevrons pointing out, running out to `R` tiles as `u` goes from nought and
 * going out again. No band joining them: at three tiles a band is a line
 * across half the screen, and the chevrons alone say where the edge is.
 */
function reachRing(k: FxScene, c: { x: number; y: number }, R: number, u: number, n: number): void {
  const r = R * easeOut(seg(u, 0, 0.45));
  const a = smooth(u * 6) * (1 - smooth(seg(u, 0.55, 1)));
  if (r < 0.1 || a <= 0.01) return;
  tally(k, c, r, n, n, { point: 'out', size: 0.13, alpha: 0.9 * a, turn: u * 0.4 });
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

/** A scuff of dust off the ground where a foot pushes or lands: low, small and quick, so it never hides the feet. */
function scuff(k: FxScene, at: P3, n: number, heading?: { x: number; y: number }, far = 1): void {
  k.burst(at, n, { kind: 'dust', colour: ['#9a8a6c', '#b3a383'], size: 1.5, sizeEnd: 3.2, life: [0.3, 0.55], speed: [0.3 * far, 0.8 * far], up: [1, 5], gravity: 6, drag: 0.06, heading, cone: heading ? 1.6 : undefined, bias: -1 });
}

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

/** What was thrown, stood in what it hit for a beat after, its point in: then gone, fading over the last third. */
function stuck(k: FxScene, kind: Thrown, at: P3, d: V, u: number, spin: number): void {
  const a = 1 - smooth(seg(u, 0.6, 1));
  if (kind === 'javelin') javelin(k, along(at, d, -JAV_AHEAD + 2.2), d, { alpha: a, ahead: JAV_AHEAD });
  else spinner(k, kind, along(at, d, -1.2), d, spin, { alpha: a });
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

/** Where the throw left the hand: kept at the release, so the flight starts there whatever the arm does after. */
function keepFrom(k: FxScene, key = 'h'): void {
  const h = k.hand(1);
  k.state[`${key}x`] = h.x;
  k.state[`${key}y`] = h.y;
  k.state[`${key}z`] = h.z;
}
const keptFrom = (k: FxScene, key = 'h'): P3 => (`${key}x` in k.state ? { x: k.state[`${key}x`], y: k.state[`${key}y`], z: k.state[`${key}z`] } : k.hand(1));

/**
 * A throw on its way, `u` of it, from `from` to `to`: the weapon at its
 * point of the arc turned along it, the wake behind, its shadow on the
 * ground and a little light round its head at night.
 */
function flying(k: FxScene, f: Flight, from: P3, to: P3, u: number, o: { wake?: Parameters<typeof wake>[3]; scale?: number; light?: number; alpha?: number } = {}): { at: P3; d: V } {
  const kind = thrownBy(k);
  const lift = f.lift(k.dist);
  const path = (v: number): P3 => arcAt(from, to, v, lift);
  const at = path(u), d = arcDir(from, to, u, lift);
  wake(k, path, u, o.wake);
  const spin = (k.now - (k.state.t0 ?? k.now)) * f.turns * TAU;
  thrownAt(k, kind, at, d, spin + (k.seed % 7), { sheen: 0.9, scale: o.scale, alpha: o.alpha });
  shadowOf(k, at, kind === 'javelin' ? 4 : 3);
  k.glow(at, 7, 0.45 * (o.alpha ?? 1));
  if (o.light) k.light(at, 0.8, o.light);
  return { at, d };
}

/* ---- the casts --------------------------------------------------------------------------- */

/** Keys for a joint, eased between: `euler` with a pose's beats as plain numbers. */
const E = (t: number, keys: readonly Key[]): Euler => euler(t, keys);

/*
 * Snap Throw: no wind-up to speak of. The hand comes back only as far as the
 * ear and flicks it off at the wrist; a short step, half a turn of the chest.
 * Half a second, the quickest thing the Skirmisher does, because what it
 * buys is time: the next swing a second sooner (`fx.sooner`), counted down by
 * a sand hand going once round the throwing hand.
 */
const SNAP: Held = { timing: { secs: 0.55, release: 0.4, blendIn: 0.1, blendOut: 0.3 }, throws: [0.4], draws: [0.8] };
const SNAP_FLIGHT: Flight = { perTile: 0.03, base: 0.03, lift: (d) => 0.6 + d * 0.5, turns: 4 };
const snapPose: CastPose = (r, t, c) => {
  const cock = 0.26, rel = 0.4, thr = 0.52;
  r.arm[1] = E(t, [[0, [26, 14, 0]], [cock, [132, 30, -18]], [rel, [100, 8, 8]], [thr, [76, 4, 20]], [1, [22, 12, 4]]]);
  r.elbow[1] = one(t, [[0, 36], [cock, 122], [rel, 10], [thr, 20], [1, 28]]);
  r.hand[1] = E(t, [[0, [0, 0, 0]], [cock, [34, 0, 0]], [rel, [-46, 0, 0]], [thr, [-30, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = E(t, [[0, [30, 12, -6]], [cock, [62, 12, -12]], [rel, [26, 20, 0]], [1, [14, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 60], [cock, 78], [rel, 44], [1, 30]]);
  r.chest = E(t, [[0, [0, 0, 0]], [cock, [4, -3, -18]], [rel, [-6, 2, 14]], [thr, [-4, 2, 10]], [1, [0, 0, 2]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [cock, [2, 0, -4]], [rel, [-6, 0, 4]], [1, [-1, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [cock, [-2, 0, 16]], [rel, [-4, 0, -12]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [4, 3, 0]], [cock, [10, 4, 0]], [rel, [20, 4, 0]], [1, [6, 3, 0]]]);
  r.knee[0] = one(t, [[0, 10], [cock, 14], [rel, 20], [1, 8]]);
  r.leg[1] = E(t, [[0, [-2, 3, 0]], [rel, [-12, 3, 0]], [1, [-3, 3, 0]]]);
  r.knee[1] = one(t, [[0, 10], [rel, 14], [1, 6]]);
  reachForNext(r, t, c, 0.6, 0.8, 0.95);
  holdFor(r, t, c, SNAP);
};

/*
 * Long Throw: a run-up of one crossover step and a hop, the javelin drawn
 * right back at arm's length, the body laid back over the rear leg -- and
 * let go high, into an arc that lobs it up to two tiles past where a throw
 * would reach (`fx.past`). While it is wound up a line of chevrons runs out
 * over the ground to where it will come down.
 */
const LONG: Held = { timing: { secs: 1.25, release: 0.56, blendIn: 0.1, blendOut: 0.24 }, throws: [0.56], draws: [0.84] };
const LONG_FLIGHT: Flight = { perTile: 0.06, base: 0.08, lift: (d) => 5 + d * 2.4, turns: 1.6 };
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
  holdFor(r, t, c, LONG);
};

/*
 * Hit and Run: a sidearm whip from the hip while already turning to go --
 * the throw lets go across the body and the chest and the hips keep turning
 * away, the head left looking back over the shoulder at what was hit, the
 * back foot stepping off. Then for `fx.secs` the pace it buys: tails of wind
 * at the heels and a trail of chevrons behind, one to a second.
 */
const RUN: Held = { timing: { secs: 0.75, release: 0.42, blendIn: 0.1 }, throws: [0.42], draws: [0.78] };
const RUN_FLIGHT: Flight = { perTile: 0.038, base: 0.04, lift: (d) => 1 + d * 0.8, turns: 3.4 };
const runPose: CastPose = (r, t, c) => {
  const wind = 0.28, rel = 0.42, thr = 0.56, off = 0.74;
  r.arm[1] = E(t, [[0, [22, 14, 0]], [wind, [62, 74, -24]], [rel, [84, 18, 26]], [thr, [56, -16, 44]], [off, [20, 10, 10]], [1, [16, 10, 4]]]);
  r.elbow[1] = one(t, [[0, 32], [wind, 64], [rel, 8], [thr, 28], [off, 40], [1, 30]]);
  r.hand[1] = E(t, [[0, [0, 0, 0]], [wind, [10, 0, 30]], [rel, [-20, 0, -30]], [1, [0, 0, 0]]]);
  r.arm[0] = E(t, [[0, [20, 10, 0]], [wind, [50, 20, -14]], [rel, [10, 30, 0]], [off, [-24, 14, 0]], [1, [8, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [wind, 70], [rel, 40], [off, 60], [1, 26]]);
  r.chest = E(t, [[0, [0, 0, 0]], [wind, [2, -4, -30]], [rel, [-6, 4, 18]], [thr, [-4, 2, 34]], [off, [-6, 0, 30]], [1, [0, 0, 4]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [wind, [2, 0, -10]], [rel, [-8, 0, 10]], [off, [-10, 0, 18]], [1, [-2, 0, 0]]]);
  r.pelvis = E(t, [[0, [0, 0, 0]], [wind, [0, 0, -8]], [rel, [0, 0, 6]], [off, [0, 0, 24]], [1, [0, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [wind, [-2, 0, 24]], [rel, [-4, 0, -6]], [thr, [-2, 0, -30]], [off, [0, 0, -44]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 2, 0]], [wind, [14, 4, 0]], [rel, [22, 4, 0]], [off, [8, 6, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 6], [wind, 22], [rel, 26], [off, 16], [1, 6]]);
  r.leg[1] = E(t, [[0, [0, 2, 0]], [rel, [-14, 4, 0]], [thr, [-22, 12, 0]], [off, [-26, 14, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 6], [wind, 18], [rel, 10], [off, 34], [1, 6]]);
  reachForNext(r, t, c, 0.6, 0.78, 0.95);
  holdFor(r, t, c, RUN);
};

/*
 * Heavy Throw: two hands up behind the head and the back arched, a held
 * beat at the top, then the whole body comes over onto the front leg and the
 * back foot comes off the ground. It flies thicker and lower; where it lands
 * the creature is jolted and three chevrons go round over its head for as
 * long as its next blow is put back (`STAGGER_MAUL`).
 */
const HEAVY: Held = { timing: { secs: 1.15, release: 0.55, blendIn: 0.12, blendOut: 0.26 }, throws: [0.55], draws: [0.84] };
const HEAVY_FLIGHT: Flight = { perTile: 0.052, base: 0.05, lift: (d) => 2 + d * 1.4, turns: 1.8 };
const heavyPose: CastPose = (r, t, c) => {
  const up = 0.3, top = 0.44, hold = 0.49, rel = 0.55, thr = 0.68;
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
  holdFor(r, t, c, HEAVY);
};

/*
 * Gut Throw: down low, the knees well bent and the trunk over them, the arm
 * swung back past the hip and through underhand, letting go at the belt so it
 * flies flat at the belly. It bleeds as a knife does, every second for
 * `KNIFE_BLEED_SECS`: a pulse of drops each second, and a pool under it.
 */
const GUT: Held = { timing: { secs: 0.8, release: 0.48, blendIn: 0.12 }, throws: [0.48], draws: [0.82] };
const GUT_FLIGHT: Flight = { perTile: 0.036, base: 0.03, lift: (d) => 0.4 + d * 0.3, turns: 3 };
const gutPose: CastPose = (r, t, c) => {
  const back = 0.32, rel = 0.48, thr = 0.6;
  r.arm[1] = E(t, [[0, [22, 12, 0]], [back, [-54, 18, 0]], [rel, [62, 6, -12]], [thr, [96, 4, -8]], [1, [18, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [back, 14], [rel, 6], [thr, 16], [1, 26]]);
  r.hand[1] = E(t, [[0, [0, 0, 0]], [back, [-20, 0, 60]], [rel, [20, 0, 70]], [1, [0, 0, 0]]]);
  r.arm[0] = E(t, [[0, [20, 10, 0]], [back, [70, 30, -10]], [rel, [56, 40, -4]], [thr, [30, 36, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [back, 30], [rel, 24], [1, 24]]);
  r.open[0] = t > 0.15 && t < 0.8;
  r.spine = E(t, [[0, [0, 0, 0]], [back, [-22, 0, -6]], [rel, [-26, 0, 4]], [thr, [-20, 0, 6]], [1, [-2, 0, 0]]]);
  r.chest = E(t, [[0, [0, 0, 0]], [back, [-6, -4, -20]], [rel, [-8, 2, 10]], [1, [0, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [back, [20, 0, 10]], [rel, [24, 0, -4]], [thr, [18, 0, -4]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 4, 0]], [back, [30, 6, 0]], [rel, [44, 6, 0]], [thr, [40, 6, 0]], [1, [6, 3, 0]]]);
  r.knee[0] = one(t, [[0, 8], [back, 46], [rel, 64], [thr, 58], [1, 10]]);
  r.leg[1] = E(t, [[0, [0, 4, 0]], [back, [-6, 6, 0]], [rel, [-16, 6, 0]], [1, [-2, 3, 0]]]);
  r.knee[1] = one(t, [[0, 8], [back, 50], [rel, 56], [thr, 48], [1, 8]]);
  reachForNext(r, t, c, 0.64, 0.82, 0.96);
  holdFor(r, t, c, GUT);
};

/*
 * Parting Throw: the island puts the body its leap back (`fx.leap` tiles,
 * where ground allows) the moment it says yes, before the cast is drawn, so
 * the cast begins in the air at the far end of the leap: coming down
 * crouched, arms flung forward for the balance, a skid of dust -- and
 * throwing from the crouch as it rises. Behind it a streak runs back the way
 * it came and a chevron for every tile of the leap points along it.
 */
const PART: Held = { timing: { secs: 1.0, release: 0.5, blendIn: 0.03, blendOut: 0.22 }, throws: [0.5], draws: [0.86] };
const PART_FLIGHT: Flight = { perTile: 0.042, base: 0.04, lift: (d) => 1.6 + d * 1.1, turns: 2.6 };
/** When the feet come down from the leap, as a fraction of the cast. */
const PART_DOWN = 0.16;
const partPose: CastPose = (r, t, c) => {
  const down = PART_DOWN, low = 0.24, cock = 0.38, rel = 0.5, thr = 0.62;
  r.arm[1] = E(t, [[0, [70, 30, 0]], [down, [56, 30, 4]], [low, [40, 34, 0]], [cock, [150, 30, -22]], [rel, [94, 10, 16]], [thr, [56, 4, 26]], [1, [18, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [down, 30], [low, 50], [cock, 100], [rel, 10], [thr, 24], [1, 26]]);
  r.arm[0] = E(t, [[0, [84, 30, 0]], [down, [64, 34, 0]], [low, [40, 30, 0]], [cock, [84, 12, -6]], [rel, [28, 24, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 14], [down, 20], [low, 30], [cock, 14], [rel, 40], [1, 22]]);
  r.open = [t < cock || (t > rel && t < 0.95), t < low];
  r.spine = E(t, [[0, [-14, 0, 0]], [down, [-24, 0, 0]], [low, [-26, 0, 0]], [cock, [4, 0, -6]], [rel, [-12, 0, 6]], [thr, [-14, 0, 6]], [1, [-1, 0, 0]]]);
  r.chest = E(t, [[0, [-4, 0, 0]], [down, [-6, 0, 0]], [cock, [6, -4, -22]], [rel, [-8, 4, 18]], [thr, [-8, 2, 22]], [1, [0, 0, 0]]]);
  r.head = E(t, [[0, [12, 0, 0]], [down, [18, 0, 0]], [low, [16, 0, 0]], [cock, [0, 0, 18]], [rel, [-4, 0, -6]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [40, 6, 0]], [down, [36, 6, 0]], [low, [34, 6, 0]], [cock, [22, 4, 0]], [rel, [26, 4, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 70], [down, 64], [low, 70], [cock, 30], [rel, 28], [1, 6]]);
  r.leg[1] = E(t, [[0, [30, 6, 0]], [down, [20, 6, 0]], [low, [18, 6, 0]], [cock, [-6, 4, 0]], [rel, [-16, 3, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 64], [down, 60], [low, 68], [cock, 22], [rel, 16], [1, 6]]);
  r.lift = one(t, [[0, 6], [down * 0.5, 4.5], [down, 0], [1, 0]]);
  reachForNext(r, t, c, 0.7, 0.86, 1);
  holdFor(r, t, c, PART);
};

/*
 * Double Throw: two throws, one after the other at `fx.throws` -- a short one
 * from where it stands and a second, drawn at once, thrown through with a
 * full step: ta, TA. Two weapons in the air one after the other, landing a
 * hand apart.
 */
const DOUBLE: Held = { timing: { secs: 1.25, release: 0.3, blendIn: 0.08, blendOut: 0.22 }, throws: [0.3, 0.6], draws: [0.44, 0.86] };
const DOUBLE_FLIGHT: Flight = { perTile: 0.036, base: 0.035, lift: (d) => 1 + d * 0.9, turns: 3 };
const doublePose: CastPose = (r, t, c) => {
  const [r1, r2] = DOUBLE.throws;
  const c1 = 0.18, t1 = r1 + 0.06, c2 = 0.52, t2 = r2 + 0.1;
  r.arm[1] = E(t, [[0, [24, 14, 0]], [c1, [136, 30, -20]], [r1, [94, 10, 10]], [t1, [70, 8, 18]],
    [c2, [154, 34, -24]], [r2, [84, 10, 20]], [t2, [36, 2, 30]], [1, [16, 10, 4]]]);
  r.elbow[1] = one(t, [[0, 34], [c1, 112], [r1, 10], [t1, 22], [c2, 104], [r2, 12], [t2, 28], [1, 26]]);
  r.arm[0] = E(t, [[0, [20, 10, 0]], [c1, [64, 12, -8]], [r1, [30, 20, 0]], [c2, [86, 10, -8]], [r2, [24, 26, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [c1, 40], [r1, 44], [c2, 12], [r2, 44], [1, 22]]);
  r.open[0] = (t > 0.08 && t < r1) || (t > 0.46 && t < r2);
  r.chest = E(t, [[0, [0, 0, 0]], [c1, [4, -3, -16]], [r1, [-6, 2, 12]], [c2, [8, -5, -30]], [r2, [-10, 4, 24]], [t2, [-12, 2, 28]], [1, [0, 0, 4]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [c1, [2, 0, -4]], [r1, [-6, 0, 4]], [c2, [8, 0, -8]], [r2, [-16, 0, 8]], [t2, [-18, 0, 8]], [1, [-2, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [c1, [0, 0, 14]], [r1, [-4, 0, -8]], [c2, [0, 0, 22]], [r2, [-6, 0, -10]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 2, 0]], [c1, [8, 3, 0]], [r1, [12, 3, 0]], [c2, [20, 3, 0]], [r2, [32, 4, 0]], [t2, [30, 4, 0]], [1, [6, 2, 0]]]);
  r.knee[0] = one(t, [[0, 6], [r1, 14], [c2, 12], [r2, 30], [t2, 34], [1, 8]]);
  r.leg[1] = E(t, [[0, [0, 2, 0]], [r1, [-8, 2, 0]], [c2, [-10, 2, 0]], [r2, [-24, 3, 0]], [t2, [-34, 3, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 6], [r1, 10], [c2, 16], [r2, 20], [t2, 36], [1, 6]]);
  reachForNext(r, t, c, r1 + 0.03, DOUBLE.draws[0], c2 - 0.02);
  reachForNext(r, t, c, 0.72, DOUBLE.draws[1], 0.98);
  holdFor(r, t, c, DOUBLE);
};

/*
 * Ricochet: thrown flat and low, sidearm, the body dropped and tipped over
 * to the right as a stone is skimmed over water. It glances off what it hits
 * and skips on, two-thirds spent, at the nearest other enemy within
 * `fx.reach` tiles -- which the effect cannot see, so the glance goes off the
 * way a skimmed stone would and the ring of its reach is shown where it hit.
 */
const RICO: Held = { timing: { secs: 0.85, release: 0.46, blendIn: 0.1 }, throws: [0.46], draws: [0.8] };
const RICO_FLIGHT: Flight = { perTile: 0.034, base: 0.03, lift: (d) => 0.3 + d * 0.25, turns: 5 };
const ricoPose: CastPose = (r, t, c) => {
  const wind = 0.3, rel = 0.46, thr = 0.6;
  r.arm[1] = E(t, [[0, [22, 14, 0]], [wind, [10, 70, -10]], [rel, [64, 56, 20]], [thr, [62, -10, 40]], [1, [16, 10, 4]]]);
  r.elbow[1] = one(t, [[0, 32], [wind, 70], [rel, 6], [thr, 14], [1, 28]]);
  r.hand[1] = E(t, [[0, [0, 0, 0]], [wind, [0, 0, 40]], [rel, [0, 0, -20]], [1, [0, 0, 0]]]);
  r.arm[0] = E(t, [[0, [20, 10, 0]], [wind, [70, 4, -30]], [rel, [40, 46, 0]], [thr, [20, 50, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [wind, 50], [rel, 20], [1, 22]]);
  r.open[0] = t > 0.12 && t < 0.85;
  r.spine = E(t, [[0, [0, 0, 0]], [wind, [-16, -26, -14]], [rel, [-20, -30, 6]], [thr, [-16, -22, 12]], [1, [-1, 0, 0]]]);
  r.chest = E(t, [[0, [0, 0, 0]], [wind, [-2, -6, -26]], [rel, [-4, -6, 14]], [thr, [-4, -4, 24]], [1, [0, 0, 2]]]);
  r.head = E(t, [[0, [0, 0, 0]], [wind, [4, 18, 24]], [rel, [6, 22, -8]], [thr, [4, 16, -16]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 4, 0]], [wind, [34, 12, 0]], [rel, [44, 12, 0]], [1, [6, 3, 0]]]);
  r.knee[0] = one(t, [[0, 8], [wind, 56], [rel, 66], [thr, 60], [1, 8]]);
  r.leg[1] = E(t, [[0, [0, 4, 0]], [wind, [-10, 20, 0]], [rel, [-16, 24, 0]], [1, [-2, 3, 0]]]);
  r.knee[1] = one(t, [[0, 8], [wind, 40], [rel, 46], [1, 8]]);
  reachForNext(r, t, c, 0.62, 0.8, 0.95);
  holdFor(r, t, c, RICO);
};

/*
 * Fan of Blades: a whole turn on the spot, as a discus is thrown -- wound
 * back to the right, then spun round to the left on bent knees with the
 * throwing arm straight out from the shoulder, and let go as the body comes
 * round to face it again, the arm whipping through. The fan goes out from the
 * end of the turn: one at what was aimed at and one each way at whatever
 * stands within `fx.reach` tiles of it, whose ring is drawn where they land.
 */
const FAN: Held = { timing: { secs: 1.15, release: 0.55, blendIn: 0.1, blendOut: 0.24 }, throws: [0.55], draws: [0.86] };
const FAN_FLIGHT: Flight = { perTile: 0.042, base: 0.05, lift: (d) => 1.2 + d, turns: 3.6 };
/** Blades in the fan, and seconds between one leaving the hand and the next, as the arm sweeps across. */
const FAN_BLADES = 5;
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
  holdFor(r, t, c, FAN);
};

/*
 * Opportunist: no throw. Sunk low and still, the head turning slowly from
 * one side to the other as an opening is looked for, then a sharp tap of two
 * fingers at the temple and the hand flicked out at it. Chevrons gather at
 * the eyes and drop to the feet as a ring of `fx.secs` of them, pointing in.
 */
const OPP: CastTiming = { secs: 0.95, release: 0.58, blendIn: 0.14 };
const OPP_SECS = fxOf('opportunist').secs ?? 0;
/** Seconds the ring takes to come down to the feet. */
const OPP_IN = 0.45;
const oppPose: CastPose = (r, t) => {
  const low = 0.2, look = 0.42, tap = 0.52, rel = 0.58, out = 0.7;
  // The free left hand does the looking; the right keeps its weapon low and ready.
  r.arm[0] = E(t, [[0, [20, 10, 0]], [low, [34, 20, -4]], [look, [40, 20, -6]], [tap, [146, 10, -50]], [rel, [150, 12, -50]], [out, [96, 30, -6]], [0.86, [80, 26, -4]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [low, 40], [tap, 150], [rel, 146], [out, 10], [0.86, 16], [1, 22]]);
  r.open[0] = t > tap - 0.06 && t < 0.92;
  r.arm[1] = E(t, [[0, [22, 12, 0]], [low, [36, 22, -6]], [rel, [34, 22, -6]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [low, 70], [rel, 74], [1, 28]]);
  r.spine = E(t, [[0, [0, 0, 0]], [low, [-14, 0, 0]], [rel, [-12, 0, 0]], [out, [-8, 0, 0]], [1, [-1, 0, 0]]]);
  r.chest = E(t, [[0, [0, 0, 0]], [low, [-4, 0, 10]], [look, [-4, 0, -12]], [rel, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [low, [6, 6, 28]], [look, [6, -6, -30]], [tap, [10, 8, -6]], [rel, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 4, 0]], [low, [16, 8, 0]], [1, [4, 3, 0]]]);
  r.knee[0] = one(t, [[0, 8], [low, 46], [rel, 44], [out, 30], [1, 8]]);
  r.leg[1] = E(t, [[0, [0, 4, 0]], [low, [-10, 8, 0]], [1, [-2, 3, 0]]]);
  r.knee[1] = one(t, [[0, 8], [low, 44], [rel, 42], [out, 26], [1, 8]]);
};

/*
 * Fade: the left forearm swept up across the face as a cloak is, the body
 * turned away under it and dropped into a crouch, a step back. A puff of
 * dust off the ground all round, wisps winding up the body, and for
 * `fx.secs` a low haze at the feet with a broken ring of chevrons pointing
 * out: whatever was coming for you looking elsewhere.
 */
const FADE: CastTiming = { secs: 0.9, release: 0.46, blendIn: 0.12, blendOut: 0.28 };
const fadePose: CastPose = (r, t) => {
  const sweep = 0.32, rel = 0.46, low = 0.6;
  r.arm[0] = E(t, [[0, [20, 10, 0]], [sweep, [108, -24, 44]], [rel, [104, -26, 46]], [low, [70, -10, 30]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [sweep, 124], [rel, 128], [low, 100], [1, 22]]);
  r.arm[1] = E(t, [[0, [20, 12, 0]], [sweep, [-10, 26, 0]], [rel, [-14, 30, 0]], [low, [10, 34, 0]], [1, [16, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [sweep, 50], [low, 60], [1, 28]]);
  r.chest = E(t, [[0, [0, 0, 0]], [sweep, [-6, 0, 26]], [rel, [-8, 0, 30]], [low, [-10, 0, 18]], [1, [0, 0, 0]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [sweep, [-6, 0, 8]], [rel, [-12, 0, 10]], [low, [-18, 0, 4]], [1, [-1, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [sweep, [12, 0, -6]], [rel, [18, 0, -10]], [low, [14, 0, -16]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 4, 0]], [sweep, [6, 6, 0]], [rel, [12, 6, 0]], [low, [20, 8, 0]], [1, [4, 3, 0]]]);
  r.knee[0] = one(t, [[0, 8], [sweep, 20], [rel, 40], [low, 62], [1, 8]]);
  r.leg[1] = E(t, [[0, [0, 4, 0]], [sweep, [-12, 6, 0]], [rel, [-22, 6, 0]], [low, [-18, 8, 0]], [1, [-2, 3, 0]]]);
  r.knee[1] = one(t, [[0, 8], [sweep, 20], [rel, 46], [low, 66], [1, 8]]);
};

/*
 * Marked for Death: the throwing hand keeps its weapon. Two fingers of the
 * left hand to the eye -- seen -- and then the arm thrown out straight at the
 * creature, a line of sand to it, and a reticle of chevrons closing on it
 * that stays for `fx.secs`, ringed on the ground by as many chevrons as
 * seconds.
 */
const MARK: CastTiming = { secs: 1.1, release: 0.56, blendIn: 0.12 };
const markPose: CastPose = (r, t) => {
  const eye = 0.32, hold = 0.44, rel = 0.56, thr = 0.68;
  r.arm[0] = E(t, [[0, [20, 10, 0]], [eye, [138, -6, 48]], [hold, [140, -6, 50]], [rel, [96, 4, 0]], [thr, [94, 4, 0]], [0.86, [80, 6, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 26], [eye, 150], [hold, 150], [rel, 0], [thr, 2], [1, 22]]);
  r.open[0] = t > 0.18;
  r.hand[0] = E(t, [[0, [0, 0, 0]], [rel, [-10, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[1] = E(t, [[0, [22, 12, 0]], [eye, [28, 16, 0]], [rel, [14, 18, 0]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 30], [eye, 40], [rel, 36], [1, 28]]);
  r.chest = E(t, [[0, [0, 0, 0]], [eye, [4, 0, 14]], [hold, [4, 0, 16]], [rel, [-4, 0, -16]], [thr, [-4, 0, -18]], [1, [0, 0, 0]]]);
  r.spine = E(t, [[0, [0, 0, 0]], [eye, [4, 0, 0]], [rel, [-8, 0, -4]], [1, [-1, 0, 0]]]);
  r.head = E(t, [[0, [0, 0, 0]], [eye, [-8, -6, -12]], [hold, [-10, -6, -14]], [rel, [-4, 0, 14]], [thr, [-4, 0, 16]], [1, [0, 0, 0]]]);
  r.leg[0] = E(t, [[0, [2, 2, 0]], [eye, [4, 3, 0]], [rel, [18, 4, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 6], [rel, 18], [1, 6]]);
  r.leg[1] = E(t, [[0, [0, 2, 0]], [rel, [-10, 3, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 6], [rel, 12], [1, 6]]);
};

/* ---- the effects of a throw ------------------------------------------------------------------- */

/**
 * The javelin in the hand while the hand has it (`HELD`): from the slant it
 * is carried at as the cast begins, round over the wind-up to lie along the
 * line it will leave on by the release, its edge coming up in the group's
 * light as it goes.
 */
function heldJavelin(k: FxScene, h: Held, t: number, f: Flight, aimBy: number, to: P3 = aimAt(k), lie?: (k: FxScene, t: number) => V | null): void {
  if (thrownBy(k) !== 'javelin' || !javelinInHand(h, t)) return;
  const b = k.caster, f8 = ((Math.round(b.facing) % 8) + 8) % 8;
  // As the figure carries one: leant forward, or back three-quarters on, and out.
  const lean = (f8 === 1 || f8 === 5 ? -8 : 22) * (Math.PI / 180), out = (f8 % 4 === 1 ? 22 : 10) * (Math.PI / 180);
  const carried = bodyDir(k, b, Math.sin(out), Math.sin(lean), Math.cos(out) * Math.cos(lean));
  const grip = k.hand(1);
  const launch = arcDir(along(grip, between(grip, to), JAV_AHEAD), to, 0, f.lift(k.dist));
  const first = h.throws.findIndex((x) => t < x);
  const start = first > 0 ? h.draws[first - 1] : 0.06;
  const u = smooth(seg(t, start, Math.max(start + 0.05, aimBy * h.throws[first])));
  // A throw that is not along the line until the last moment (a turn) says how the javelin lies before then.
  const own = lie?.(k, t);
  javelin(k, grip, own ?? mixV(carried, launch, u), { sheen: 0.8 * bump(t, start, h.throws[first], h.throws[first] + 0.05) });
}

/** The throw's flight as a `travel`: the weapon from where it left the hand to what it was thrown at, `to` it lands. */
function throwTravel(f: Flight, o: { to?: (k: FxScene) => P3; wake?: Parameters<typeof wake>[3]; light?: number } = {}): NonNullable<SpellVisualFx['travel']> {
  return {
    secs: flightSecs(f),
    draw: (k, u) => {
      if (k.state.t0 === undefined) k.state.t0 = k.now;
      const to = o.to ? o.to(k) : aimAt(k);
      const from = keptFrom(k);
      const kind = thrownBy(k);
      // A javelin's point flies from where it was in the hand, out ahead of the fist.
      const start = kind === 'javelin' ? along(from, arcDir(from, to, 0, f.lift(k.dist)), JAV_AHEAD) : from;
      const { d } = flying(k, f, start, to, u, { wake: o.wake, light: o.light });
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
const LONG_PAST = fxOf('long_throw').past ?? 0;
const RUN_SECS = fxOf('hit_and_run').secs ?? 0;
const DOUBLE_N = fxOf('double_throw').throws ?? 2;
const RICO_REACH = fxOf('ricochet').reach ?? 0;
const FAN_REACH = fxOf('fan_of_blades').reach ?? 0;
const PART_LEAP = fxOf('parting_throw').leap ?? 0;

/** A creature's or a person's footprint on the ground, in tiles: what a ring round it starts from. */
const footOf = (b: Body): number => Math.max(0.22, (b.wide / 40) * 2.6);

export const SKIRMISHER: Record<string, SpellVisual> = {
  // Snap Throw (throw, on enemy): a throw at 80%; your own next swing comes 1 s sooner.
  skirmisher_snap_throw: {
    palette: PALETTE,
    cast: { timing: SNAP.timing, pose: snapPose },
    fx: {
      charge: (k, t) => {
        heldJavelin(k, SNAP, t, SNAP_FLIGHT, 0.6);
        // The flick: a glint off the fingers the instant it goes.
        k.flare(k.hand(1), 4.5, bump(t, 0.34, 0.4, 0.5), k.pal.core, 0.3);
      },
      release: (k) => {
        keepFrom(k);
        k.burst(k.hand(1), 4, { kind: 'mote', size: 1.4, life: [0.15, 0.3], speed: [0.4, 0.9], up: [0, 6], heading: k.toward(k.caster, k.target), cone: 0.8, gravity: 0 });
      },
      travel: throwTravel(SNAP_FLIGHT, { wake: { span: 0.12, spread: 0.03, width: 1.8 } }),
      hit: (k) => bite(k, aimAt(k), landedDir(k), 0.8),
      impact: { secs: 0.4, draw: (k, u) => {
        glint(k, aimAt(k), u, 6);
        stuck(k, thrownBy(k), aimAt(k), landedDir(k), u * 1.4, landedSpin(k));
      } },
      // The second it buys, from when it lands: a sand hand going once round the throwing fist, and a glint when it is round.
      linger: { secs: SNAP_SOONER, draw: (k, age, left) => {
        const u = clamp(age / Math.max(0.01, age + left));
        const h = k.hand(1);
        const x = k.sx(h), y = k.sy(h), R = 4.2 * k.zoom, a = smooth(age / 0.12) * (1 - smooth(seg(u, 0.9, 1)));
        const pal = k.pal;
        k.worldDraw(h, (g) => {
          g.globalAlpha = a * 0.9;
          g.lineCap = 'butt';
          g.strokeStyle = pal.ink;
          g.lineWidth = 2 * k.zoom;
          g.beginPath();
          g.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + u * TAU);
          g.stroke();
          g.strokeStyle = pal.accent;
          g.lineWidth = 1 * k.zoom;
          g.stroke();
          // The hand of it, a chevron at its head.
          const ang = -Math.PI / 2 + u * TAU;
          airChevron(g, x + Math.cos(ang) * R, y + Math.sin(ang) * R, ang + Math.PI / 2, 2.6 * k.zoom);
          g.fillStyle = pal.accent;
          g.fill();
          g.lineWidth = Math.max(0.8, 0.5 * k.zoom);
          g.strokeStyle = pal.ink;
          g.stroke();
        }, 4);
        // Round: ready.
        if (left < 0.15) k.flare(h, 6, flashOf(1 - left / 0.15), pal.core, 0.6);
      } },
    },
  },

  // Long Throw (throw, on enemy): a throw at 110% on an enemy up to 2 tiles past your reach.
  skirmisher_long_throw: {
    palette: PALETTE,
    cast: { timing: LONG.timing, pose: longPose },
    fx: {
      charge: (k, t) => {
        heldJavelin(k, LONG, t, LONG_FLIGHT, 0.55);
        // Where it will come down, measured out over the ground: a chevron a half tile, running out to it as the arm goes back.
        const run = smooth(seg(t, 0.14, 0.5));
        const gone = 1 - smooth(seg(t, 0.56, 0.8));
        if (run > 0 && gone > 0) {
          const d = k.toward(k.caster, k.spot), far = k.dist;
          const n = Math.max(2, Math.round(far / 0.5));
          const pts: number[] = [], alphas: number[] = [];
          for (let i = 1; i <= n; i++) {
            const s = (i / n) * far;
            const show = clamp(run * far * 1.1 - s + 0.4);
            if (show <= 0) continue;
            // The last `fx.past` tiles of it, beyond where a throw would reach, in the brighter colour.
            chevronOn(k, k.caster.x + d.x * (s - 0.25), k.caster.y + d.y * (s - 0.25), d.x, d.y, i === n ? 0.2 : 0.12, pts);
            alphas.push(0.85 * show * gone * (far - s < LONG_PAST ? 1 : 0.55));
          }
          drawChevrons(k, (k.caster.x + k.spot.x) / 2, (k.caster.y + k.spot.y) / 2, far / 2 + 0.3, pts, alphas);
        }
      },
      release: (k) => {
        keepFrom(k);
        const foot = k.joint(k.caster, 'ankle0', [0, 0, 0], 0.02);
        scuff(k, foot, 8, k.toward(k.caster, k.target));
      },
      travel: throwTravel(LONG_FLIGHT, { wake: { span: 0.2, spread: 0.06, width: 2.4 }, light: 0.35 }),
      hit: (k) => {
        bite(k, aimAt(k), landedDir(k), 1.1);
        scuff(k, k.at(k.target, 0.02), 8);
      },
      impact: { secs: 0.75, draw: (k, u) => {
        glint(k, aimAt(k), u, 8);
        stuck(k, thrownBy(k), aimAt(k), landedDir(k), u, landedSpin(k));
        const r = footOf(k.target);
        k.ring(k.target, r + 0.25 * easeOut(u), { band: 0.05 * (1 - u), alpha: 0.8 * (1 - u), main: k.pal.accent, deep: k.pal.deep, glow: 0.4 });
      } },
    },
  },

  // Hit and Run (throw, on enemy, lasts 5 s): a throw or a knife blow at 100%, and for 5 s you walk 40% faster.
  skirmisher_hit_and_run: {
    palette: PALETTE,
    cast: { timing: RUN.timing, pose: runPose },
    fx: {
      charge: (k, t) => heldJavelin(k, RUN, t, RUN_FLIGHT, 0.7),
      release: (k) => {
        keepFrom(k);
        const away = k.toward(k.target, k.caster);
        scuff(k, k.at(k.caster, 0.02), 7, { x: -away.x, y: -away.y });
      },
      travel: throwTravel(RUN_FLIGHT, { wake: { span: 0.14, spread: 0.04, width: 2 } }),
      hit: (k) => bite(k, aimAt(k), landedDir(k)),
      impact: { secs: 0.45, draw: (k, u) => {
        glint(k, aimAt(k), u);
        stuck(k, thrownBy(k), aimAt(k), landedDir(k), u * 1.3, landedSpin(k));
      } },
      // The pace, on the caster for its seconds: wind at the heels and a trail of chevrons behind, one to a second, the last going out.
      linger: { draw: (k, age, left) => {
        const b = k.caster;
        const a = smooth(age / 0.3) * smooth(left / 0.6);
        const fwd = k.facingDir(b);
        const pts: number[] = [], alphas: number[] = [];
        const n = Math.round(RUN_SECS);
        for (let i = 0; i < n; i++) {
          const lit = clamp(left - i);
          if (lit <= 0) continue;
          const s = 0.3 + i * 0.22;
          chevronOn(k, b.x - fwd.x * s, b.y - fwd.y * s, fwd.x, fwd.y, 0.13, pts);
          alphas.push(a * 0.85 * smooth(lit) * (1 - i / (n + 2)));
        }
        drawChevrons(k, b.x, b.y, 0.3 + n * 0.22, pts, alphas);
        // A tail of wind off each calf, streaming back and lifting, flickering as the feet go. Put by the body's own frame
        // rather than found on the posed leg: five seconds of a figure posed again every frame is the cost of the whole
        // spell, and at a calf the difference does not show.
        for (let s = 0; s < 2; s++) {
          const ankle = k.local(b, s ? 1.4 : -1.4, -0.4, 3.2);
          const wave = Math.sin(k.now * 9 + s * 2.2);
          const p0 = ankle, p1 = { x: ankle.x - fwd.x * 0.18, y: ankle.y - fwd.y * 0.18, z: ankle.z + 1.2 + wave }, p2 = { x: ankle.x - fwd.x * 0.36, y: ankle.y - fwd.y * 0.36, z: ankle.z + 2.6 - wave };
          k.ribbon([p2, p1, p0], { width: 1.8, taper: 'start', alpha: a * 0.75, edge: false, glow: 0.5 });
        }
        if (!k.fast) k.emit(k.at(b, 0.05), 6 * a, { kind: 'mote', size: 1.3, life: [0.3, 0.6], speed: [0.2, 0.5], up: [2, 6], heading: { x: -fwd.x, y: -fwd.y }, cone: 0.8, gravity: 0 });
      } },
    },
  },

  // Heavy Throw (throw, on enemy): a throw at 140% that staggers it as a maul does: a heavy blow knocked off its stroke, and its next blow put back 1 s.
  skirmisher_heavy_throw: {
    palette: PALETTE,
    cast: { timing: HEAVY.timing, pose: heavyPose },
    fx: {
      charge: (k, t) => {
        heldJavelin(k, HEAVY, t, HEAVY_FLIGHT, 0.75);
        // The weight coming up off the ground into the hands, held at the top.
        const g = bump(t, 0.2, 0.46, 0.56);
        if (g > 0.05 && !k.fast) k.emit(k.at(k.caster, 0.02), 10 * g, { kind: 'dust', colour: ['#9a8a6c', '#b3a383'], size: 1.1, sizeEnd: 1.8, life: [0.4, 0.7], speed: [0.02, 0.1], up: [5, 12], gravity: -2, jitter: 0.35, bias: -1 });
        k.glow(mid3(k.hand(0), k.hand(1), 0.5), 5, 0.3 * g, k.pal.light);
      },
      release: (k) => {
        keepFrom(k);
        const foot = k.joint(k.caster, 'ankle0', [0, 0, 0], 0.02);
        scuff(k, foot, 10, undefined, 1.3);
      },
      travel: throwTravel(HEAVY_FLIGHT, { wake: { span: 0.18, spread: 0.08, width: 3.6, deep: true }, light: 0.4 }),
      hit: (k) => {
        bite(k, aimAt(k), landedDir(k), 1.5);
        scuff(k, k.at(k.target, 0.02), 14, undefined, 1.8);
      },
      impact: { secs: 0.8, draw: (k, u) => {
        const at = aimAt(k), d = landedDir(k);
        glint(k, at, u, 11);
        stuck(k, thrownBy(k), at, d, u, landedSpin(k));
        // The jolt: a band of shock off its feet, and two lines either side of it driven on the way the blow went.
        const r = footOf(k.target);
        k.ring(k.target, r + 0.45 * easeOut(u), { band: 0.09 * (1 - u), alpha: 0.9 * (1 - u * u), main: k.pal.accent, deep: '#8a7450', glow: 0.3 });
        const side = across(d), w = 0.22 * k.target.wide / 5;
        for (const s of [-1, 1]) {
          const base = { x: at.x + side.x * w * s, y: at.y + side.y * w * s, z: at.z + 2 * s };
          const v = easeOut(seg(u, 0, 0.5));
          k.ribbon([along(base, d, 2 + 10 * v), along(base, d, 6 + 16 * v)], { width: 2, taper: 'start', alpha: 0.9 * (1 - seg(u, 0.3, 0.6)), edge: false });
        }
      } },
      // The stagger, for as long as its next blow is put back: three chevrons going round over its head.
      linger: { secs: STAGGER_MAUL + 0.3, draw: (k, age, left) => {
        const b = k.target, a = smooth(age / 0.2) * smooth(left / 0.3);
        const c = k.at(b, 1.06);
        const x = k.sx(c), y = k.sy(c), R = Math.max(6, b.wide * 1.6) * k.zoom;
        const pal = k.pal;
        k.worldDraw(c, (g) => {
          g.globalAlpha = a;
          for (let i = 0; i < 3; i++) {
            const ang = age * 5.5 + (i * TAU) / 3;
            const px = x + Math.cos(ang) * R, py = y + Math.sin(ang) * R * 0.4;
            airChevron(g, px, py, ang + Math.PI / 2, 4.2 * k.zoom);
            g.fillStyle = pal.accent;
            g.fill();
            g.lineWidth = Math.max(0.8, 0.5 * k.zoom);
            g.strokeStyle = pal.ink;
            g.stroke();
          }
        }, 3);
      } },
    },
  },

  // Gut Throw (throw, on enemy): a throw at 90% that bleeds it as a knife does, 15% of the throw a second for 6 s.
  skirmisher_gut_throw: {
    palette: PALETTE,
    cast: { timing: GUT.timing, pose: gutPose },
    fx: {
      charge: (k, t) => heldJavelin(k, GUT, t, GUT_FLIGHT, 0.6, gutOf(k)),
      release: (k) => {
        keepFrom(k);
        k.burst(k.hand(1), 4, { kind: 'mote', size: 1.4, life: [0.2, 0.35], speed: [0.3, 0.7], up: [0, 4], heading: k.toward(k.caster, k.target), cone: 0.7, gravity: 0 });
      },
      travel: throwTravel(GUT_FLIGHT, { to: (k) => gutOf(k), wake: { span: 0.14, spread: 0.035, width: 2 } }),
      hit: (k) => {
        const at = gutOf(k), d = landedDir(k);
        bite(k, at, d, 0.7);
        k.burst(at, 14, { kind: 'drop', colour: ['#8e1c1c', '#6a1212'], size: 2, life: [0.4, 0.7], speed: [0.4, 1], up: [4, 14], heading: { x: d.x, y: d.y }, cone: 1.6, gravity: 70, bias: 2 });
      },
      impact: { secs: 0.5, draw: (k, u) => {
        glint(k, gutOf(k), u, 6);
        stuck(k, thrownBy(k), gutOf(k), landedDir(k), u, landedSpin(k));
      } },
      // The bleed, a second at a time for as long as a knife's: a pulse of drops each second, and a pool spreading under it.
      linger: { secs: KNIFE_BLEED_SECS, draw: (k, age, left) => {
        const at = gutOf(k), b = k.target;
        const tick = Math.floor(age);
        if ((k.state.tick ?? -1) < tick) {
          k.state.tick = tick;
          k.burst(at, 5, { kind: 'drop', colour: ['#8e1c1c', '#6a1212'], size: 1.8, life: [0.35, 0.6], speed: [0.05, 0.25], up: [-2, 4], gravity: 70, bias: 2 });
        }
        const pulse = flashOf(age - tick, 0.08) * smooth(left / 0.5);
        k.glow(at, 5, 0.5 * pulse, '#ff5a4a');
        // The wound itself: a short stub of teal where it went in, breathing with the pulse.
        k.flare(at, 3 + 2 * pulse, 0.5 + 0.4 * pulse, k.pal.light, 0.8);
        const pool = 0.12 + 0.18 * smooth(age / KNIFE_BLEED_SECS);
        k.disc(b, pool, { main: '#5a1010', alpha: 0.5 * smooth(age / 0.6) * smooth(left / 1) });
        tally(k, b, footOf(b), KNIFE_BLEED_SECS, left, { point: 'in', size: 0.1, alpha: 0.6 * smooth(age / 0.4), colour: '#c46a5a' });
      } },
    },
  },

  // Parting Throw (throw, on enemy): a throw at 100%, and you leap 3 tiles straight back from it, over ground you could walk.
  skirmisher_parting_throw: {
    palette: PALETTE,
    cast: { timing: PART.timing, pose: partPose },
    fx: {
      charge: (k, t) => {
        heldJavelin(k, PART, t, PART_FLIGHT, 0.75);
        // Where the leap began: the leap's length back toward what it is thrown at, kept from the first frame, as the body
        // is already where it came down. Short of the leap only when what it is thrown at is nearer than that.
        if (k.state.ox === undefined) {
          const to = k.toward(k.caster, k.target), far = Math.min(PART_LEAP, Math.max(0.5, k.dist * 0.85));
          k.state.ox = k.caster.x + to.x * far;
          k.state.oy = k.caster.y + to.y * far;
          k.state.far = far;
        }
        if (t >= PART_DOWN && k.state.landed === undefined) {
          k.state.landed = 1;
          scuff(k, k.at(k.caster, 0.02), 12, k.toward(k.target, k.caster), 1.4);
        }
        const ox = k.state.ox, oy = k.state.oy, far = k.state.far;
        const bx = k.caster.x, by = k.caster.y;
        const ax = (bx - ox) / (far || 1), ay = (by - oy) / (far || 1);
        // The streak of the leap: the group's two tails from where it began to the body, reeled in after it as it lands.
        const reel = 1 - smooth(seg(t, 0.02, 0.32));
        if (reel > 0.02) {
          const hip = k.caster.tall * 0.5;
          const path = (v: number): P3 => k.on(lerp(ox, bx, v), lerp(oy, by, v), hip * (0.6 + 0.8 * v * (1 - v)));
          wake(k, path, 1, { span: reel, spread: 0.1, width: 2.4, alpha: 0.8 * smooth(t / 0.03) * Math.min(1, reel * 2) });
        }
        // A chevron for each tile of the leap, pointing the way it went, the one furthest back going out first.
        const n = Math.max(1, Math.round(far));
        const pts: number[] = [], alphas: number[] = [];
        for (let i = 0; i < n; i++) {
          const show = smooth(seg(t, 0, 0.08)) * (1 - smooth(seg(t, 0.45 + (i / n) * 0.3, 0.6 + (i / n) * 0.3)));
          chevronOn(k, ox + ax * (i + 0.5) * (far / n), oy + ay * (i + 0.5) * (far / n), ax, ay, 0.16, pts);
          alphas.push(0.9 * show);
        }
        drawChevrons(k, (ox + bx) / 2, (oy + by) / 2, far / 2 + 0.3, pts, alphas);
      },
      release: (k) => keepFrom(k),
      travel: throwTravel(PART_FLIGHT, { wake: { span: 0.16, spread: 0.045, width: 2.2 } }),
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
          heldJavelin(k, DOUBLE, t, DOUBLE_FLIGHT, 0.7);
          for (let i = 0; i < DOUBLE.throws.length; i++) k.flare(k.hand(1), 4, bump(t, DOUBLE.throws[i] - 0.05, DOUBLE.throws[i], DOUBLE.throws[i] + 0.08), k.pal.core, 0.3);
          // The second leaves the hand while the first is in the air: kept where it left, as the first was at the release.
          if (t >= DOUBLE.throws[1] && k.state.h2x === undefined) keepFrom(k, 'h2');
        },
        release: (k) => keepFrom(k),
        travel: {
          secs: (tiles) => gap + fly(tiles),
          draw: (k, u) => {
            if (k.state.t0 === undefined) k.state.t0 = k.now;
            const total = gap + fly(k.dist), el = u * total, f = fly(k.dist);
            for (let i = 0; i < DOUBLE_N && i < 2; i++) {
              const v = (el - i * gap) / f;
              const to = into(k, i);
              if (v >= 0 && v < 1) {
                const from = i ? keptFrom(k, 'h2') : keptFrom(k);
                const kind = thrownBy(k);
                const start = kind === 'javelin' ? along(from, arcDir(from, to, 0, DOUBLE_FLIGHT.lift(k.dist)), JAV_AHEAD) : from;
                const { d } = flying(k, DOUBLE_FLIGHT, start, to, v, { wake: { span: 0.14, spread: 0.04, width: 2 } });
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
    /** Where the glance goes: off the side the seed says, a skimmed stone's angle off the way it came, most of the reach on. */
    const glanceTo = (k: FxScene): P3 => {
      const d = landedDir(k), at = aimAt(k);
      const s = hashOf(k.seed, 3) < 0.5 ? -1 : 1, ang = s * 0.95;
      const dx = d.x * Math.cos(ang) - d.y * Math.sin(ang), dy = d.x * Math.sin(ang) + d.y * Math.cos(ang), l = Math.hypot(dx, dy) || 1;
      const far = RICO_REACH * 0.8;
      return k.on(at.x + (dx / l) * far, at.y + (dy / l) * far, k.target.tall * 0.45);
    };
    return {
      palette: PALETTE,
      cast: { timing: RICO.timing, pose: ricoPose },
      fx: {
        charge: (k, t) => heldJavelin(k, RICO, t, RICO_FLIGHT, 0.6),
        release: (k) => keepFrom(k),
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
          reachRing(k, k.target, RICO_REACH, u, 12);
          const v = el / glanceSecs, to = glanceTo(k);
          if (v < 1) {
            // On, lighter: the glance, at three-fifths of the throw.
            const path = (w: number): P3 => arcAt(at, to, w, 3);
            wake(k, path, v, { span: 0.3, spread: 0.03, width: 1.6, alpha: 0.75 });
            const kind = thrownBy(k);
            thrownAt(k, kind, path(v), arcDir(at, to, v, 3), k.now * RICO_FLIGHT.turns * TAU, { sheen: 0.9, alpha: 0.85, scale: 0.85 });
            shadowOf(k, path(v), 3);
          } else {
            if (k.state.glanced === undefined) {
              k.state.glanced = 1;
              k.burst(to, 10, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 1.6, life: [0.15, 0.35], speed: [0.8, 2], up: [0, 16], gravity: 50 });
            }
            glint(k, to, clamp((el - glanceSecs) / 0.45), 5);
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
        // Two chevrons closing on the eyes from either side as it looks, meeting at the tap.
        const u = smooth(seg(t, 0.2, 0.52));
        const a = bump(t, 0.18, 0.4, 0.62);
        if (a > 0.02) {
          const eye = k.head(), x = k.sx(eye), y = k.sy(eye) + 1.2 * k.zoom, pal = k.pal, z = k.zoom;
          k.worldDraw(eye, (g) => {
            g.globalAlpha = a;
            for (const s of [-1, 1]) {
              airChevron(g, x + s * (16 - 11 * u) * z, y, s < 0 ? 0 : Math.PI, 3.4 * z);
              g.fillStyle = pal.accent;
              g.fill();
              g.lineWidth = Math.max(0.8, 0.5 * z);
              g.strokeStyle = pal.ink;
              g.stroke();
            }
          }, 6);
          k.glow(eye, 6, 0.5 * a);
        }
      },
      hit: (k) => {
        k.flare(k.head(), 6, 1, k.pal.core, 0.2);
        k.burst(k.head(), 6, { kind: 'mote', colour: [k.pal.accent, k.pal.core], size: 1.6, life: [0.3, 0.5], speed: [0.2, 0.5], up: [-14, -4], gravity: 0 });
      },
      // The ring comes down to the feet out wide and snaps in to its size, every chevron lit; the linger takes it from there.
      impact: { secs: OPP_IN, draw: (k, u) => {
        const r = footOf(k.caster) + 0.7 * (1 - easeBack(u));
        tally(k, k.caster, r, OPP_SECS, OPP_SECS, { point: 'in', alpha: 0.85 * smooth(u * 3) });
      } },
      linger: { draw: (k, age, left) => {
        if (age < OPP_IN) return;
        const a = smooth(left / 0.5);
        tally(k, k.caster, footOf(k.caster), OPP_SECS, left, { point: 'in', alpha: 0.85 * a });
        // Every so often a glint at the eyes: still looking.
        const w = (age % 2.5) / 2.5, glint = a * bump(w, 0, 0.05, 0.16);
        if (glint > 0.01) k.flare(k.head(), 3.2, glint, k.pal.accent, 0.3);
      } },
    },
  },

  // Fade (buff, on self, lasts 10 s): Every creature hunting you loses you, and will not come for you again for 10 s unless you strike it.
  skirmisher_fade: {
    palette: PALETTE,
    cast: { timing: FADE, pose: fadePose },
    fx: {
      charge: (k, t) => {
        const u = seg(t, 0.2, 0.46);
        if (u > 0 && u < 1 && !k.fast) k.emit(k.at(k.caster, 0.02), 10 * u, { kind: 'smoke', colour: ['#8fb0a9', '#b6c9c2'], size: 1.4, sizeEnd: 3, life: [0.5, 0.9], speed: [0.1, 0.25], up: [1, 3], gravity: -1, jitter: 0.2, bias: -1 });
      },
      hit: (k) => {
        // The puff it goes in: low and all round, out of the ground.
        k.burst(k.at(k.caster, 0.03), 22, { kind: 'smoke', colour: ['#8fb0a9', '#b6c9c2', '#6f948d'], size: 1.6, sizeEnd: 3.6, life: [0.6, 1.1], speed: [0.7, 1.3], up: [1, 4], gravity: -1, drag: 0.04, jitter: 0.12, bias: -1 });
        k.burst(k.at(k.caster, 0.5), 10, { kind: 'mote', size: 1.4, life: [0.4, 0.8], speed: [0.2, 0.6], up: [4, 14], gravity: 0 });
      },
      impact: { secs: 0.9, draw: (k, u) => {
        // Three wisps winding up round the body and coming apart.
        const b = k.caster, n = k.fast ? 4 : 7;
        for (let w = 0; w < 3; w++) {
          const pts: P3[] = [];
          const head = easeOut(u) * 1.3;
          for (let i = 0; i <= n; i++) {
            const v = head - 0.5 * (1 - i / n);
            if (v < 0) continue;
            const ang = (w * TAU) / 3 + v * 5.5;
            const r = (0.2 + 0.1 * v) * (b.wide / 4);
            pts.push({ x: b.x + Math.cos(ang) * r, y: b.y + Math.sin(ang) * r, z: b.z + b.tall * Math.min(1.1, v * 0.85) });
          }
          if (pts.length >= 2) k.ribbon(pts, { width: 2.4, taper: 'both', alpha: 0.8 * (1 - smooth(seg(u, 0.5, 1))), edge: false, main: '#8fb8b0', glow: 0.5 });
        }
        k.ring(b, footOf(b) + 0.4 * easeOut(u), { band: 0.04 * (1 - u), alpha: 0.6 * (1 - u), main: '#b6c9c2', deep: '#6f948d', glow: 0.2 });
      } },
      // While it lasts: a haze low at the feet, and a broken ring of chevrons pointing out -- eyes turned off you -- one to a second.
      linger: { draw: (k, age, left) => {
        const b = k.caster, a = smooth(age / 0.6) * smooth(left / 0.8);
        const drift = 0.06 * Math.sin(age * 1.7);
        tally(k, b, footOf(b) + 0.12 + drift, fxOf('fade').secs ?? 10, left, { point: 'out', alpha: 0.65 * a, turn: age * 0.25, colour: '#cfe3dc' });
        if (!k.fast) k.emit(k.at(b, 0.02), 5 * a, { kind: 'smoke', colour: ['#8fb0a9', '#b6c9c2'], size: 1.2, sizeEnd: 2.6, life: [0.8, 1.4], speed: [0.08, 0.2], up: [0.3, 1.2], gravity: -0.3, jitter: 0.35, bias: -1 });
      } },
    },
  },

  // Fan of Blades (throw, on enemy): a throw at 60% at the enemy you aim at and at every other enemy within 3 tiles of it.
  skirmisher_fan_of_blades: (() => {
    /** Where each blade of the fan comes down: the middle one at what was aimed at, the rest across the reach round it. */
    const landing = (k: FxScene, i: number): P3 => {
      const mid = (FAN_BLADES - 1) / 2;
      if (i === mid) return aimAt(k);
      const d = k.toward(k.caster, k.target), side = { x: -d.y, y: d.x };
      const s = (i - mid) / mid, R = FAN_REACH * 0.75;
      const x = k.target.x + side.x * s * R + d.x * (Math.abs(s) - 0.6) * R * 0.5;
      const y = k.target.y + side.y * s * R + d.y * (Math.abs(s) - 0.6) * R * 0.5;
      return k.on(x, y, 3);
    };
    const fly = flightSecs(FAN_FLIGHT);
    const far = (k: FxScene, i: number): number => Math.hypot(landing(k, i).x - k.caster.x, landing(k, i).y - k.caster.y);
    return {
      palette: PALETTE,
      cast: { timing: FAN.timing, pose: fanPose },
      fx: {
        charge: (k, t) => {
          // Through the turn it lies out along the arm, the point leading, and swings onto the line only as it goes.
          heldJavelin(k, FAN, t, FAN_FLIGHT, 0.2, aimAt(k), (q, w) => {
            if (w < 0.18) return null;
            const grip = q.hand(1), out = between(q.chest(), grip), launch = between(grip, aimAt(q));
            const lead = unitV(out.x + 0.3 * launch.x, out.y + 0.3 * launch.y, out.z * 0.3 + 0.12);
            return mixV(mixV(between(q.hand(1), aimAt(q)), lead, smooth(seg(w, 0.18, 0.3))), launch, smooth(seg(w, 0.47, 0.55)));
          });
          k.glow(k.hand(1), 6, 0.6 * bump(t, 0.3, 0.55, 0.62));
        },
        release: (k) => {
          keepFrom(k);
          k.burst(k.hand(1), 8, { kind: 'mote', size: 1.5, life: [0.2, 0.4], speed: [0.4, 1], up: [0, 6], heading: k.toward(k.caster, k.target), cone: 1.6, gravity: 0 });
        },
        travel: {
          secs: (tiles) => fly(tiles + FAN_REACH * 0.4) + FAN_STAGGER * (FAN_BLADES - 1),
          draw: (k, u) => {
            if (k.state.t0 === undefined) k.state.t0 = k.now;
            const total = fly(k.dist + FAN_REACH * 0.4) + FAN_STAGGER * (FAN_BLADES - 1), el = u * total, from = keptFrom(k), mid = (FAN_BLADES - 1) / 2;
            for (let i = 0; i < FAN_BLADES; i++) {
              // Each a little after the last as the arm sweeps across, from one side of the fan to the other.
              const to = landing(k, i), f = fly(far(k, i)), v = (el - i * FAN_STAGGER) / f;
              if (v < 0) continue;
              if (v < 1) {
                const lift = FAN_FLIGHT.lift(far(k, i));
                const path = (w: number): P3 => arcAt(from, to, w, lift);
                if (i === mid) wake(k, path, v, { span: 0.14, spread: 0.04, width: 2 });
                else k.ribbon([path(Math.max(0, v - 0.12)), path(Math.max(0, v - 0.05)), path(v)], { width: 1.6, taper: 'start', alpha: 0.8, edge: false, glow: 0.5 });
                const d = arcDir(from, to, v, lift);
                thrownAt(k, thrownBy(k), path(v), d, k.now * FAN_FLIGHT.turns * TAU + i, { sheen: 0.9, scale: i === mid ? 1 : 0.85 });
                k.state[`d${i}x`] = d.x;
                k.state[`d${i}y`] = d.y;
              } else {
                // Down: the one aimed at bites as any throw does; the rest go into whatever is there (the ground, as drawn).
                const d = { x: k.state[`d${i}x`] ?? 0, y: k.state[`d${i}y`] ?? 1, z: -0.3 };
                if (k.state[`in${i}`] === undefined) {
                  k.state[`in${i}`] = 1;
                  if (i === mid) bite(k, to, d, 0.8);
                  else {
                    k.burst(to, 6, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 1.5, life: [0.15, 0.3], speed: [0.6, 1.6], up: [0, 14], gravity: 50 });
                    scuff(k, k.on(to.x, to.y, 0.5), 4);
                  }
                }
                stuck(k, thrownBy(k), to, d, 0.2, i);
              }
            }
          },
        },
        // The last of the fan is down: the reach of it round what was aimed at opens out to its edge, and every blade glints
        // and stands where it came down for a beat before it goes.
        impact: { secs: 0.85, draw: (k, u) => {
          reachRing(k, k.target, FAN_REACH, u, 16);
          for (let i = 0; i < FAN_BLADES; i++) {
            const at = landing(k, i), d = { x: k.state[`d${i}x`] ?? 0, y: k.state[`d${i}y`] ?? 1, z: -0.3 };
            glint(k, at, clamp(u * 1.4 - i * 0.04), i === (FAN_BLADES - 1) / 2 ? 7 : 4.5);
            stuck(k, thrownBy(k), at, d, 0.2 + 0.8 * u, i);
          }
        } },
      },
    } satisfies SpellVisual;
  })(),

  // Marked for Death (curse, on enemy, lasts 15 s): An enemy within 12 tiles: for 15 s every blow, throw and shot a person lands on it is critical twice as often.
  skirmisher_marked_for_death: (() => {
    const SECS = fxOf('marked_for_death').secs ?? 0;
    /** Seconds the reticle takes to close and lock. */
    const MARK_LOCK = 0.55;
    /** The reticle over the heart: four chevrons pointing in at it, `r` pixels out, turned `turn`. */
    const reticle = (k: FxScene, at: P3, r: number, turn: number, alpha: number): void => {
      if (alpha <= 0.01) return;
      const x = k.sx(at), y = k.sy(at), z = k.zoom, pal = k.pal;
      k.worldDraw(at, (g) => {
        g.globalAlpha = clamp(alpha);
        for (let i = 0; i < 4; i++) {
          const ang = turn + (i * Math.PI) / 2;
          airChevron(g, x + Math.cos(ang) * r * z, y + Math.sin(ang) * r * z * 0.8, ang + Math.PI, 3.6 * z);
          g.fillStyle = pal.accent;
          g.fill();
          g.lineWidth = Math.max(0.8, 0.55 * z);
          g.strokeStyle = pal.ink;
          g.stroke();
        }
      }, 5);
    };
    return {
      palette: PALETTE,
      cast: { timing: MARK, pose: markPose },
      fx: {
        charge: (k, t) => {
          // Seen: a glint at the eye under the fingers.
          k.flare(k.head(), 4.5, bump(t, 0.26, 0.36, 0.5), k.pal.accent, 0.4);
        },
        travel: { secs: (tiles) => 0.08 + tiles * 0.02, draw: (k, u) => {
          // The line of it, run out from the pointing hand to the creature, a chevron at its head.
          const from = k.hand(0), to = aimAt(k), head = mid3(from, to, easeOut(u));
          k.beam(mid3(from, to, Math.max(0, easeOut(u) - 0.5)), head, { width: 1.3, alpha: 0.9, main: k.pal.accent, glow: 0.6 });
          reticle(k, head, 3, 0, 0.9);
        } },
        hit: (k) => {
          k.burst(aimAt(k), 10, { kind: 'mote', colour: [k.pal.accent, k.pal.core], size: 1.8, life: [0.3, 0.6], speed: [0.3, 0.8], up: [2, 12], gravity: 0 });
        },
        impact: { secs: MARK_LOCK, draw: (k, u) => {
          // The reticle closing on it, over-shooting and settling: it is locked.
          const at = aimAt(k);
          reticle(k, at, 6 + 12 * (1 - easeBack(u)), (1 - u) * 0.9, smooth(u * 4));
          k.beam(k.hand(0), at, { width: 1.1, alpha: 0.8 * (1 - smooth(u * 1.6)), main: k.pal.accent, glow: 0.4 });
          glint(k, at, u, 6);
        } },
        linger: { draw: (k, age, left) => {
          const b = k.target, a = smooth(age / 0.5) * smooth(left / 0.6);
          const at = aimAt(k);
          // Breathing in a little now and then, as a sight is held on it.
          const held = age - MARK_LOCK, breathe = 1 + 0.12 * Math.sin(held * 2.4);
          // Taken over from the impact's reticle once it has locked, from where that one left it.
          if (held >= 0) reticle(k, at, 6 * breathe, held * 0.25, 0.85 * a);
          tally(k, b, footOf(b) + 0.08, SECS, left, { point: 'in', alpha: 0.8 * a, size: 0.09 });
          k.glow(at, 6, 0.25 * a, k.pal.accent);
        } },
      },
    } satisfies SpellVisual;
  })(),
};
