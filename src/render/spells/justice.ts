/**
 * Justice's spells: how each is cast and what it looks like.
 *
 * Justice is a judge, and its spells are drawn as a court's things: the
 * upright sword that falls on what is judged, the scales that weigh it, the
 * seal pressed on it, the chain that holds it, the stake and the measured
 * line. Everything is straight and upright and square to the land -- seals
 * are lozenges, the ground marks are squares laid on the tiles' own lines or
 * rings graduated like a rule -- and nothing swirls: what turns, turns a
 * quarter at a time and stops. Judgment comes from above and comes straight
 * down, after a held beat; a working of Justice is a deliberation and then
 * a decision.
 *
 * What lasts a while keeps its time where it can be read: a ring of ticks
 * round its feet, one going out at a time (`tally`), so a Bind's five
 * seconds are five ticks and a Truce's palisade goes down a stake at a time.
 *
 * Every cast is a prayer -- hands joined, raised, laid on the earth or on the
 * heart -- never a blow: a Justice priest judges, the patron strikes.
 */
import type { CastPose, SpellVisual } from './index';
import { spellInfo } from './info';
import {
  arcAt, bump, clamp, easeBack, easeIn, easeOut, flashOf, hashOf, lerp, mid3, seg, smooth, TAU,
  type Body, type FxScene, type P3, type SpellPalette,
} from './kit';
import type { HandShape } from '../figure';
import { euler, one } from './poses';

/** The scales: silver blue and a pale violet. */
export const PALETTE: SpellPalette = {
  core: '#f3f5ff',
  main: '#9fb4ff',
  deep: '#4b5aa8',
  accent: '#e6e8ff',
  ink: '#1d2350',
  light: '#b8c6ff',
};
/** The steel of a judged blade and of the chains: greyer than the light, so the shapes read as things and not glows. */
const STEEL = '#c7cfe6';

/* ---- the spells' own numbers, read off the rules ------------------------------------------- */

const radiusOf = (id: string): number => spellInfo(id)?.radius ?? 0;
const lastsOf = (id: string): number => spellInfo(id)?.lasts ?? 0;
/**
 * How many ticks a tally of `secs` has: one a second up to ten seconds, so a
 * hold reads second by second, and past that one for every five seconds, no
 * more than twelve, so a half-minute is six and a minute twelve.
 */
const ticksFor = (secs: number): number => (secs <= 10 ? Math.max(1, Math.round(secs)) : Math.min(12, Math.max(2, Math.round(secs / 5))));

/* ---- timing helpers ------------------------------------------------------------------------ */

/** A quarter turn at a time: `x` counts quarter turns, each one snapped round over its first third and then held. */
const snapTurn = (x: number): number => (Math.floor(x) + easeOut(clamp((x - Math.floor(x)) * 3))) * (Math.PI / 2);
/** Half a turn at a time, each snapped over and held: a seal turned over, face to face, never left on its edge. */
const flipTurn = (x: number): number => 2 * snapTurn(x);
/** A little shake, for a pose held under strain: degrees, at `t` seconds-ish. */
const tremor = (t: number, deg: number): number => deg * (Math.sin(t * 173) * 0.6 + Math.sin(t * 97 + 1.3) * 0.4);

/* ---- shapes of the court's own ------------------------------------------------------------- */

type Pt = [number, number];

/** Fill and ink a polygon of screen points. */
function poly(g: CanvasRenderingContext2D, pts: readonly Pt[], fill: string | null, ink: string | null, inkW = 1): void {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (ink) {
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    g.stroke();
  }
}

const inkOf = (k: FxScene): number => Math.max(0.8, 0.7 * k.zoom);

/**
 * An upright lozenge, Justice's seal: four facets, the upper left lit and the
 * lower right shaded, inked, with a slit of light down its middle. `h` height
 * units tall; `spin` turns it about the upright, so it narrows to its edge and
 * comes round with its lit side over.
 */
function lozenge(k: FxScene, p: P3, h: number, o: { alpha?: number; spin?: number; wide?: number; glow?: number; bias?: number; slit?: boolean; main?: string } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || h <= 0) return;
  const x = k.sx(p), y = k.sy(p), H = k.hpx(h) / 2;
  const c = Math.cos(o.spin ?? 0);
  const W = H * (o.wide ?? 0.55) * Math.max(0.16, Math.abs(c));
  // Turned past its edge, the far face is the one showing: the lit facets swap sides.
  const flip = c < 0;
  const { core, deep, ink } = k.pal;
  const main = o.main ?? k.pal.main;
  const iw = inkOf(k);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    const T: Pt = [x, y - H], B: Pt = [x, y + H], L: Pt = [x - W, y], R: Pt = [x + W, y], M: Pt = [x, y];
    poly(g, [T, L, M], flip ? main : core, null);
    poly(g, [T, R, M], flip ? core : main, null);
    poly(g, [B, L, M], flip ? deep : main, null);
    poly(g, [B, R, M], flip ? main : deep, null);
    poly(g, [T, R, B, L], null, ink, iw);
    if (o.slit !== false) {
      g.strokeStyle = core;
      g.lineWidth = Math.max(0.8, W * 0.18);
      g.beginPath();
      g.moveTo(x, y - H * 0.62);
      g.lineTo(x, y + H * 0.62);
      g.stroke();
    }
  }, o.bias ?? 2);
  const gl = o.glow ?? 1;
  if (gl > 0) k.glow(p, h * 1.6, a * gl * 0.55);
}

/**
 * The sword of judgment: a broad straight blade of light, point down, with
 * its cross-guard, grip and lozenge pommel, `len` height units from point to
 * pommel. It is drawn upright on the screen whatever the turn of the view,
 * because what it means is "down". `show` draws it on from the pommel down;
 * the part of it under the ground is never drawn, so a planted sword stands
 * in the earth. Driven `through` a body, the part above the body's head is
 * drawn in front of it and the rest behind, so it reads as through the body
 * and not over it.
 */
function sword(k: FxScene, tip: P3, len: number, o: { alpha?: number; glow?: number; show?: number; through?: Body | null; bias?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || len <= 0) return;
  const x = k.sx(tip), y = k.sy(tip), U = k.hpx(len);
  const L = U * 0.72, bw = U * 0.05, gw = U * 0.17, gh = U * 0.03, G = U * 0.16, pr = U * 0.05;
  const top = y - L - gh - G - 2 * pr;
  const showTo = top + (y - top) * clamp(o.show ?? 1);
  const ground = k.on(tip.x, tip.y);
  const gy = k.sy(ground);
  const { core, main, deep, ink } = k.pal;
  const iw = inkOf(k) * 1.1;
  const paint = (g: CanvasRenderingContext2D): void => {
    // The blade: a long point, then straight to the guard; the lit half on the left, a deep fuller down the middle.
    const shoulder = y - L * 0.16;
    poly(g, [[x, y], [x - bw, shoulder], [x - bw, y - L], [x, y - L]], core, null);
    poly(g, [[x, y], [x + bw, shoulder], [x + bw, y - L], [x, y - L]], STEEL, null);
    g.strokeStyle = deep;
    g.lineWidth = Math.max(0.7, bw * 0.28);
    g.beginPath();
    g.moveTo(x, shoulder - L * 0.04);
    g.lineTo(x, y - L * 0.94);
    g.stroke();
    poly(g, [[x, y], [x - bw, shoulder], [x - bw, y - L], [x + bw, y - L], [x + bw, shoulder]], null, ink, iw);
    // The guard: a bar with pointed ends, its upper face lit.
    const gy0 = y - L;
    poly(g, [[x - gw, gy0], [x - gw * 0.8, gy0 - gh], [x + gw * 0.8, gy0 - gh], [x + gw, gy0], [x + gw * 0.8, gy0 + gh], [x - gw * 0.8, gy0 + gh]], main, ink, iw);
    poly(g, [[x - gw * 0.8, gy0 - gh], [x + gw * 0.8, gy0 - gh], [x + gw, gy0], [x - gw, gy0]], core, null);
    // The grip, and the pommel.
    poly(g, [[x - bw * 0.55, gy0 - gh], [x + bw * 0.55, gy0 - gh], [x + bw * 0.55, gy0 - gh - G], [x - bw * 0.55, gy0 - gh - G]], deep, ink, iw);
    const py = gy0 - gh - G - pr;
    poly(g, [[x, py - pr], [x - pr * 0.75, py], [x, py + pr], [x + pr * 0.75, py]], core, ink, iw);
  };
  const clipped = (lo: number, hi: number) => (g: CanvasRenderingContext2D): void => {
    const h = Math.min(hi, showTo, gy + 0.5);
    if (h <= lo) return;
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    g.beginPath();
    g.rect(x - U, lo, 2 * U, h - lo);
    g.clip();
    paint(g);
  };
  const b = o.through;
  if (b) {
    const foot: P3 = { x: b.x, y: b.y, z: b.z };
    const crown = k.sy(k.at(b, 0.92));
    k.worldDraw(foot, clipped(top - 4, crown), 4);
    k.worldDraw(foot, clipped(crown, gy + 1), -4);
  } else k.worldDraw(ground, clipped(top - 4, gy + 1), o.bias ?? 1);
  const gl = o.glow ?? 1;
  if (gl > 0) {
    const vis = clamp(o.show ?? 1);
    const len0 = len * 0.72;
    for (let i = 0; i < 3; i++) {
      const up = len0 * (0.2 + 0.35 * i);
      if (y - k.hpx(up) > showTo) continue;
      k.glow({ x: tip.x, y: tip.y, z: tip.z + up }, len * 0.32, a * gl * 0.4 * vis);
    }
  }
}

/**
 * The scales, hanging from a ring: a beam on a pivot, tipped `tilt` radians
 * (the right pan down for more than nought), a pan on three cords at each
 * end. `size` height units from the ring to a pan; `load` puts a weight in
 * the right pan (one) or the left (minus one). Drawn square to the screen, as
 * a sign is.
 */
function scales(k: FxScene, pivot: P3, size: number, tilt: number, o: { alpha?: number; load?: number; bias?: number; at?: P3 } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const x = k.sx(pivot), y = k.sy(pivot), s = k.hpx(size);
  const hl = s * 0.62, drop = s * 0.62, pw = s * 0.24, ph = s * 0.1;
  const c = Math.cos(tilt), sn = Math.sin(tilt);
  const ends: Pt[] = [[x - hl * c, y - hl * sn], [x + hl * c, y + hl * sn]];
  const { core, main, deep, ink } = k.pal;
  const iw = inkOf(k);
  k.worldDraw(o.at ?? pivot, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    // The hanger: a ring of a lozenge over the pivot and a rod down to it.
    poly(g, [[x, y - s * 0.36], [x - s * 0.06, y - s * 0.28], [x, y - s * 0.2], [x + s * 0.06, y - s * 0.28]], null, ink, iw * 2.4);
    poly(g, [[x, y - s * 0.36], [x - s * 0.06, y - s * 0.28], [x, y - s * 0.2], [x + s * 0.06, y - s * 0.28]], null, core, iw);
    g.lineWidth = iw * 2.6;
    g.strokeStyle = ink;
    g.beginPath();
    g.moveTo(x, y - s * 0.2);
    g.lineTo(x, y + s * 0.06);
    g.stroke();
    g.lineWidth = iw;
    g.strokeStyle = core;
    g.stroke();
    // Cords and pans, one at each end.
    for (let i = 0; i < 2; i++) {
      const [ex, ey] = ends[i];
      const py = ey + drop;
      g.lineWidth = Math.max(0.7, iw * 0.8);
      g.strokeStyle = main;
      g.beginPath();
      g.moveTo(ex, ey);
      g.lineTo(ex - pw, py);
      g.moveTo(ex, ey);
      g.lineTo(ex + pw, py);
      g.moveTo(ex, ey);
      g.lineTo(ex + pw * 0.15, py);
      g.stroke();
      const pan: Pt[] = [[ex - pw * 1.1, py], [ex + pw * 1.1, py], [ex + pw * 0.62, py + ph], [ex - pw * 0.62, py + ph]];
      poly(g, pan, main, ink, iw);
      poly(g, [[ex - pw * 1.1, py], [ex + pw * 1.1, py], [ex + pw * 0.9, py + ph * 0.4], [ex - pw * 0.9, py + ph * 0.4]], core, null);
      if ((o.load ?? 0) === (i ? 1 : -1)) {
        // The weight: a block of it, its lit top and its shaded side.
        const w = pw * 0.55, h = pw * 0.75;
        poly(g, [[ex - w, py], [ex + w, py], [ex + w, py - h], [ex - w, py - h]], deep, ink, iw);
        poly(g, [[ex - w, py - h], [ex + w, py - h], [ex + w * 0.6, py - h - w * 0.45], [ex - w * 0.6, py - h - w * 0.45]], main, ink, iw);
      }
    }
    // The beam over the cords: thick at the pivot, fine at its ends.
    const bt = s * 0.05;
    const nx = -sn, ny = c;
    poly(g, [[ends[0][0], ends[0][1]], [x + nx * bt, y + ny * bt], [ends[1][0], ends[1][1]], [x - nx * bt, y - ny * bt]], main, ink, iw);
    poly(g, [[ends[0][0], ends[0][1]], [x - nx * bt, y - ny * bt], [ends[1][0], ends[1][1]]], core, null);
    poly(g, [[x, y - s * 0.07], [x - s * 0.045, y], [x, y + s * 0.07], [x + s * 0.045, y]], core, ink, iw);
  }, o.bias ?? 2);
  k.glow(pivot, size * 1.5, a * 0.45);
}

/**
 * A chain between two points: links alternately face on (an open lozenge) and
 * edge on (a short bar), along a line that sags `sag` height units at its
 * middle -- slack, or drawn taut.
 */
function chain(k: FxScene, a: P3, b: P3, o: { alpha?: number; sag?: number; link?: number; bias?: number; glow?: number; colour?: string } = {}): void {
  const al = o.alpha ?? 1;
  if (al <= 0.01) return;
  const sag = o.sag ?? 0;
  const pts: Pt[] = [];
  const x0 = k.sx(a), y0 = k.sy(a), x1 = k.sx(b), y1 = k.sy(b);
  const len = Math.hypot(x1 - x0, y1 - y0);
  const L = (o.link ?? 3.4) * k.zoom;
  const n = Math.max(2, Math.min(40, Math.round(len / (L * 0.82))));
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = mid3(a, b, u);
    p.z -= sag * 4 * u * (1 - u);
    pts.push([k.sx(p), k.sy(p)]);
  }
  const steel = o.colour ?? STEEL;
  const { core, deep, ink } = k.pal;
  const iw = inkOf(k);
  const near = y1 > y0 ? b : a;
  k.worldDraw(near, (g) => {
    g.globalAlpha = clamp(al);
    g.lineJoin = 'miter';
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i], [qx, qy] = pts[i + 1];
      const mx = (px + qx) / 2, my = (py + qy) / 2;
      const dx = qx - px, dy = qy - py, l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l;
      const h = l * 0.62;
      if (i % 2 === 0) {
        // Face on: an open lozenge, inked outside and in.
        const w = h * 0.5;
        const ring: Pt[] = [[mx - ux * h, my - uy * h], [mx - uy * w, my + ux * w], [mx + ux * h, my + uy * h], [mx + uy * w, my - ux * w]];
        poly(g, ring, null, ink, iw * 2.6);
        poly(g, ring, null, steel, iw * 1.1);
        g.strokeStyle = core;
        g.lineWidth = Math.max(0.5, iw * 0.5);
        g.beginPath();
        g.moveTo(ring[0][0], ring[0][1]);
        g.lineTo(ring[3][0], ring[3][1]);
        g.stroke();
      } else {
        // Edge on: a bar.
        const w = Math.max(0.9, h * 0.16);
        poly(g, [[mx - ux * h - uy * w, my - uy * h + ux * w], [mx + ux * h - uy * w, my + uy * h + ux * w], [mx + ux * h + uy * w, my + uy * h - ux * w], [mx - ux * h + uy * w, my - uy * h - ux * w]], deep, ink, iw);
      }
    }
  }, o.bias ?? 0);
  const gl = o.glow ?? 1;
  if (gl > 0) {
    const light = k.pal.light;
    k.glowDraw((g) => {
      g.globalAlpha = clamp(al * gl * 0.18);
      g.strokeStyle = light;
      g.lineWidth = L * 1.6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i <= n; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
      g.lineCap = 'butt';
    });
  }
}

/**
 * A square laid on the ground on the land's own lines, `half` tiles from its
 * middle to a side and `band` tiles wide: the near two sides lit, the far two
 * shaded, inked inside and out, a stud at each corner. Justice marks ground as
 * a surveyor does, square to the tiles.
 */
function square(k: FxScene, c: { x: number; y: number }, half: number, o: { band?: number; alpha?: number; glow?: number; studs?: boolean; draw?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (half <= 0.02 || a <= 0.01) return;
  const band = Math.min(half * 0.6, o.band ?? 0.08);
  const corner = (r: number, i: number): [number, number] => [c.x + SQUARE_CORNERS[i][0] * r, c.y + SQUARE_CORNERS[i][1] * r];
  const midY = k.eye.worldToScreenY(c.x, c.y, 0);
  const drawn = clamp(o.draw ?? 1);
  // Laid as shapes on the island, a side at a time as it is drawn on: the near two sides in the lit tone, the far two shaded.
  const near: number[][] = [], far: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const u = clamp(drawn * 4 - i);
    if (u <= 0) continue;
    const j = (i + 1) % 4;
    const [o0x, o0y] = corner(half, i), [o1x, o1y] = corner(half, j);
    const [i0x, i0y] = corner(half - band, i), [i1x, i1y] = corner(half - band, j);
    const side = [o0x, o0y, lerp(o0x, o1x, u), lerp(o0y, o1y, u), lerp(i0x, i1x, u), lerp(i0y, i1y, u), i0x, i0y];
    (k.eye.worldToScreenY((o0x + o1x) / 2, (o0y + o1y) / 2, 0) > midY ? near : far).push(side);
  }
  const studs: number[][] = [];
  if (o.studs !== false && drawn >= 1) {
    const r = Math.max(0.04, band * 0.75);
    for (let i = 0; i < 4; i++) {
      const [x, y] = corner(half, i);
      studs.push([x - r, y, x, y - r, x + r, y, x, y + r]);
    }
  }
  const { core, main, deep, ink } = k.pal;
  const iw = inkOf(k);
  k.groundShape(c.x, c.y, half + 0.3, [
    { kind: 'fill', colour: main, alpha: clamp(a), paths: near, lift: 0.15 },
    { kind: 'fill', colour: deep, alpha: clamp(a), paths: far, lift: 0.15 },
    { kind: 'stroke', colour: ink, alpha: clamp(a), width: iw, paths: [...near, ...far], closed: true, join: 'miter', lift: 0.15 },
    { kind: 'fill', colour: core, alpha: clamp(a), paths: studs, lift: 0.2 },
    { kind: 'stroke', colour: ink, alpha: clamp(a), width: iw, paths: studs, closed: true, join: 'miter', lift: 0.2 },
  ]);
  const gl = o.glow ?? 1;
  if (gl > 0 && drawn > 0) {
    for (let i = 0; i < 4; i++) {
      const [x, y] = corner(half, i);
      k.glow(k.on(x, y, 0.3), Math.max(3, band * 110), a * gl * 0.4 * drawn);
    }
  }
}
/** A square's corners, round from the far one, on the land's own lines. */
const SQUARE_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

/**
 * A rule laid round a point: a fine ring `r` tiles out with `n` ticks
 * standing out from it, `lit` of them bright and the rest dark -- the time a
 * thing has left, going out a tick at a time, the last one fading as it goes.
 * `grow` draws the ring and its ticks on.
 */
function tally(k: FxScene, c: { x: number; y: number }, r: number, n: number, lit: number, o: { alpha?: number; turn?: number; grow?: number; tick?: number; ring?: boolean } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.05) return;
  const grow = clamp(o.grow ?? 1);
  if (o.ring !== false) k.ring(c, r, { band: Math.min(0.05, r * 0.12), alpha: a * 0.8 * smooth(grow * 1.5), glow: 0.35, n: Math.max(16, k.facets(r)) });
  const len = o.tick ?? Math.max(0.07, Math.min(0.3, r * 0.22));
  const turn = (o.turn ?? 0) - Math.PI / 2;
  // The ticks go out the way a clock's hand goes: those still lit bright, those gone dark, and the one going out dimming
  // as its share of the time runs down.
  const on: number[][] = [], off: number[][] = [], going: number[][] = [];
  let goingOn = 0;
  const shown = Math.ceil(n * grow);
  for (let i = 0; i < shown; i++) {
    const ang = turn + (i / n) * TAU;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    const tick = [c.x + cx * r, c.y + cy * r, c.x + cx * (r + len), c.y + cy * (r + len)];
    const v = clamp(lit - i);
    if (v >= 1) on.push(tick);
    else if (v <= 0) off.push(tick);
    else {
      going.push(tick);
      goingOn = v;
    }
  }
  const { core, deep, ink } = k.pal;
  const w = Math.max(1, 1.4 * k.zoom), under = w + Math.max(1, 0.8 * k.zoom);
  const fading = clamp(a * (0.35 + 0.65 * goingOn));
  k.groundShape(c.x, c.y, r + len + 0.3, [
    { kind: 'stroke', colour: ink, alpha: clamp(a * 0.35), width: under, paths: off, cap: 'butt', lift: 0.2 },
    { kind: 'stroke', colour: deep, alpha: clamp(a * 0.35), width: w, paths: off, cap: 'butt', lift: 0.2 },
    { kind: 'stroke', colour: ink, alpha: fading, width: under, paths: going, cap: 'butt', lift: 0.2 },
    { kind: 'stroke', colour: core, alpha: fading, width: w, paths: going, cap: 'butt', lift: 0.2 },
    { kind: 'stroke', colour: ink, alpha: clamp(a), width: under, paths: on, cap: 'butt', lift: 0.2 },
    { kind: 'stroke', colour: core, alpha: clamp(a), width: w, paths: on, cap: 'butt', lift: 0.2 },
  ]);
}

/** A ring hung level round a body at `share` of its height, `r` height units out: its back half behind the body and its front before it. */
function hoop(k: FxScene, b: Body, share: number, r: number, o: { alpha?: number; width?: number; colour?: string } = {}): Pt[] {
  const a = o.alpha ?? 1;
  const n = k.fast ? 12 : 20;
  const z = b.z + b.tall * share;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU;
    pts.push([k.sx({ x: b.x + (Math.cos(ang) * r) / 40, y: b.y + (Math.sin(ang) * r) / 40, z }), k.sy({ x: b.x + (Math.cos(ang) * r) / 40, y: b.y + (Math.sin(ang) * r) / 40, z })]);
  }
  if (a <= 0.01) return pts;
  const cy = k.sy({ x: b.x, y: b.y, z });
  const W = (o.width ?? 1.6) * k.zoom;
  const { core, ink } = k.pal;
  const colour = o.colour ?? core;
  const half = (front: boolean) => (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = clamp(a * (front ? 1 : 0.6));
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if ((pts[i][1] + pts[j][1]) / 2 > cy === front) {
        g.moveTo(pts[i][0], pts[i][1]);
        g.lineTo(pts[j][0], pts[j][1]);
      }
    }
    g.strokeStyle = ink;
    g.lineWidth = W + Math.max(1.2, k.zoom);
    g.stroke();
    g.strokeStyle = colour;
    g.lineWidth = W;
    g.stroke();
  };
  const foot: P3 = { x: b.x, y: b.y, z: b.z };
  k.worldDraw(foot, half(false), -3);
  k.worldDraw(foot, half(true), 3);
  return pts;
}

/**
 * An upright post standing out of the ground, `h` height units of it showing,
 * its lit and its shaded face and a lozenge cap: a Bind's stake, a Truce's
 * pale, Restitution's grave-marker when it is broad.
 */
function post(k: FxScene, foot: { x: number; y: number }, h: number, o: { alpha?: number; wide?: number; cap?: number; bias?: number; glow?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || h <= 0.2) return;
  const base = k.on(foot.x, foot.y);
  k.worldDraw(base, postPainter(k, [{ foot, h, alpha: a }], o.wide ?? 0.9, o.cap ?? (o.wide ?? 0.9) * 1.6), o.bias ?? 0);
  if ((o.glow ?? 1) > 0) k.glow(k.on(foot.x, foot.y, h + (o.cap ?? 1.5) * 0.6), Math.max(4, (o.cap ?? 1.5) * 3), a * (o.glow ?? 1) * 0.5);
}

/** What draws a run of posts, each `h` height units out of the ground at its foot: one record for many, where many stand together. */
function postPainter(k: FxScene, posts: ReadonlyArray<{ foot: { x: number; y: number }; h: number; alpha: number }>, wide: number, cap: number): (g: CanvasRenderingContext2D) => void {
  const W = k.hpx(wide), C = k.hpx(cap);
  const { core, main, deep, ink } = k.pal;
  const iw = inkOf(k);
  const at = posts.filter((p) => p.h > 0.2 && p.alpha > 0.01).map((p) => {
    const base = k.on(p.foot.x, p.foot.y);
    return { x: k.sx(base), y: k.sy(base), H: k.hpx(p.h), a: p.alpha };
  });
  return (g) => {
    g.lineJoin = 'miter';
    for (const { x, y, H, a } of at) {
      g.globalAlpha = clamp(a);
      const top = y - H;
      poly(g, [[x - W, y], [x, y + W * 0.4], [x, top + W * 0.4], [x - W, top]], STEEL, null);
      poly(g, [[x, y + W * 0.4], [x + W, y], [x + W, top], [x, top + W * 0.4]], deep, null);
      poly(g, [[x - W, y], [x, y + W * 0.4], [x + W, y], [x + W, top], [x, top + W * 0.4], [x - W, top]], null, ink, iw);
      // The cap: a lozenge sat on the post's head.
      const cy = top - C * 0.55;
      poly(g, [[x, cy - C], [x - C * 0.62, cy], [x, cy + C * 0.7], [x + C * 0.62, cy]], main, ink, iw);
      poly(g, [[x, cy - C], [x - C * 0.62, cy], [x, cy]], core, null);
    }
  };
}

/** A goods-box, a thing carried: a little cube of light, its lit top, its left and its shaded right face, `s` height units. */
function box(k: FxScene, p: P3, s: number, o: { alpha?: number; spin?: number; dx?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const x = k.sx(p) + (o.dx ?? 0), y = k.sy(p), S = k.hpx(s) * 0.5;
  const t = o.spin ?? 0;
  // Its top turned about the upright: four corners round an ellipse twice as wide as deep.
  const top: Pt[] = [];
  for (let i = 0; i < 4; i++) top.push([x + Math.cos(t + (i * Math.PI) / 2) * S * 1.2, y - S + Math.sin(t + (i * Math.PI) / 2) * S * 0.6]);
  // The two lowest corners of the top, and the one between them nearest the viewer, are the bottom's too, dropped.
  const order = [0, 1, 2, 3].sort((i, j) => top[j][1] - top[i][1]);
  const f = order[0], s0 = order[1], s1 = order[2];
  const drop = S * 1.3;
  const { core, main, deep, ink } = k.pal;
  const iw = inkOf(k);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    const fd: Pt = [top[f][0], top[f][1] + drop];
    for (const side of [s0, s1]) {
      const sd: Pt = [top[side][0], top[side][1] + drop];
      poly(g, [top[f], top[side], sd, fd], top[side][0] < top[f][0] ? main : deep, ink, iw);
    }
    poly(g, top, core, ink, iw);
  }, 2);
}

/** A chevron, point up (`dir` the screen way it points otherwise), `s` height units across: a rank gained, or the way something must go. */
function chevron(k: FxScene, p: P3, s: number, o: { alpha?: number; dir?: Pt; bias?: number; glow?: number; dx?: number; dy?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const x = k.sx(p) + (o.dx ?? 0), y = k.sy(p) + (o.dy ?? 0), S = k.hpx(s) / 2;
  const [dx0, dy0] = o.dir ?? [0, -1];
  const l = Math.hypot(dx0, dy0) || 1;
  const dx = dx0 / l, dy = dy0 / l, nx = -dy, ny = dx;
  const th = S * 0.5;
  const P = (along: number, across: number): Pt => [x + dx * along + nx * across, y + dy * along + ny * across];
  const shape: Pt[] = [P(S * 0.6, 0), P(-S * 0.4, S), P(-S * 0.4 - th, S * 0.72), P(S * 0.6 - th * 1.25, 0), P(-S * 0.4 - th, -S * 0.72), P(-S * 0.4, -S)];
  const { core, main, ink } = k.pal;
  const iw = inkOf(k);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    poly(g, shape, main, ink, iw);
    poly(g, [shape[0], shape[5], shape[4], shape[3]], core, null);
  }, o.bias ?? 3);
  if ((o.glow ?? 1) > 0) k.glow(p, s * 1.4, a * (o.glow ?? 1) * 0.45);
}

/** Straight cracks run out over the ground from a point, `n` of them `r` tiles long: what a blow from above leaves. */
function cracks(k: FxScene, c: { x: number; y: number }, r: number, n: number, o: { alpha?: number; grow?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const grow = clamp(o.grow ?? 1);
  const lines: number[][] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU + (hashOf(k.seed, i) - 0.5) * 0.5;
    const len = r * (0.55 + 0.45 * hashOf(k.seed + 1, i)) * grow;
    const run: number[] = [];
    for (let j = 0; j <= 3; j++) {
      const u = j / 3, side = j && j < 3 ? (hashOf(k.seed + 2 + j, i) - 0.5) * 0.25 : 0;
      run.push(c.x + Math.cos(ang + side) * len * u, c.y + Math.sin(ang + side) * len * u);
    }
    lines.push(run);
  }
  const { core, ink } = k.pal;
  k.groundShape(c.x, c.y, r + 0.3, [
    { kind: 'stroke', colour: ink, alpha: clamp(a), width: Math.max(0.8, 2.6 * k.zoom), paths: lines, join: 'miter', cap: 'round', lift: 0.1 },
    { kind: 'stroke', colour: core, alpha: clamp(a), width: Math.max(0.8, 1 * k.zoom), paths: lines, join: 'miter', cap: 'round', lift: 0.1 },
  ]);
}

/** A square of light knocked flat out over the ground from a point: Justice's shockwave, square to the tiles. */
function squareOut(k: FxScene, c: { x: number; y: number }, u: number, half: number, alpha = 1): void {
  if (u <= 0 || u >= 1) return;
  const h = 0.06 + half * easeOut(u);
  square(k, c, h, { band: Math.min(h * 0.3, 0.09 * (1 - 0.6 * u)), alpha: alpha * (1 - u * u), glow: 0.8, studs: false });
}

/** Once, the first frame `when` is true for this cast: for a burst wanted on a moment inside an impact or a linger. */
function once(k: FxScene, key: string, when: boolean): boolean {
  if (!when || k.state[key]) return false;
  k.state[key] = 1;
  return true;
}

/** Sparks knocked flat out along the ground, the way a blow from above throws them. */
function flatSparks(k: FxScene, at: P3, n: number, speed = 1.6): void {
  k.burst(at, n, { kind: 'spark', size: 2, colour: [k.pal.core, k.pal.main, STEEL], life: [0.2, 0.45], speed: [speed * 0.5, speed], up: [2, 14], gravity: 50, drag: 0.05 });
}

/* ---- the casts ----------------------------------------------------------------------------------- */

/*
 * Every pose below is written key by key in fractions of its own cast, with
 * the release named; the stage blends into it and out of it. Arms are
 * [forward, out, turned in]: ninety forward is level ahead, a hundred and
 * eighty straight up; out is away from the side, and below nought across the
 * front -- until the arm is raised past level, when out turns it back
 * across, so arms held up wide are out below nought. Hands joined before the chest -- Justice's resting prayer -- are
 * `JOINED`, the elbow at `JOINED_BEND`.
 */
const JOINED = [24, -18, 40] as const;
const JOINED_BEND = 84;
const HANG = [4, 10, 4] as const;
/** Both hands the same shape, `w` of the way: joined in prayer, raised, laid down. */
const both = (shape: HandShape): [HandShape, HandShape] => [shape, shape];
/** A hand shape at a share. */
const flat = (w: number): HandShape => ({ flat: w });

/** Mark of Judgment: hands joined and the head bowed; then the right hand lifted and pressed out and down at the creature, as a seal is pressed into wax. */
const MARK_T = { secs: 1.05, release: 0.52 };
const markPose: CastPose = (r, t) => {
  r.arm[0] = euler(t, [[0, HANG], [0.18, JOINED], [0.44, [38, -14, 34]], [1, [36, -12, 32]]]);
  r.elbow[0] = one(t, [[0, 15], [0.18, JOINED_BEND], [1, 110]]);
  r.arm[1] = euler(t, [[0, HANG], [0.18, JOINED], [0.32, JOINED], [0.44, [98, 22, -6]], [0.52, [84, 4, 2]], [0.72, [82, 4, 2]], [1, [30, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 15], [0.18, JOINED_BEND], [0.32, JOINED_BEND], [0.44, 112], [0.52, 6], [0.72, 10], [1, 20]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.44, [30, 0, 0]], [0.52, [-46, 0, 0]], [0.72, [-40, 0, 0]], [1, [0, 0, 0]]]);
  r.open = [t > 0.12, t > 0.12];
  r.shape = both(flat(one(t, [[0.06, 0], [0.18, 1], [0.8, 1], [1, 0]])));
  r.head = euler(t, [[0, [0, 0, 0]], [0.18, [-18, 0, 0]], [0.36, [-18, 0, 0]], [0.5, [-4, 0, -4]], [0.75, [-4, 0, -4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.36, [-4, 0, 0]], [0.44, [4, 0, -10]], [0.52, [-6, 0, 8]], [0.75, [-5, 0, 6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.44, [2, 0, 0]], [0.52, [-8, 0, 0]], [0.75, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.44, [0, 3, 0]], [0.52, [16, 3, 0]], [0.75, [14, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.52, 18], [0.75, 16], [1, 5]]);
  r.knee[1] = one(t, [[0, 4], [0.52, 10], [1, 4]]);
};

/** Retribution: the arms crossed hard over the chest and the head bowed, braced; then flung apart and down, the palms turned out at whatever would strike. */
const RETRIBUTION_T = { secs: 1.15, release: 0.5 };
const retributionPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, HANG], [0.3, [34, -30, 48]], [0.42, [36, -32, 50]], [0.5, [26, 58, -24]], [0.75, [24, 56, -22]], [1, [8, 14, 0]]]);
    r.elbow[k] = one(t, [[0, 15], [0.3, 96], [0.42, 100], [0.5, 6], [0.75, 8], [1, 16]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.42, [0, 0, 0]], [0.5, [-50, 0, 0]], [0.75, [-46, 0, 0]], [1, [0, 0, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.38, 18], [0.5, 6], [1, 4]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.38, [10, 4, 0]], [0.5, [0, 8, 0]], [0.75, [0, 8, 0]], [1, [2, 2, 0]]]);
  }
  r.open = [t > 0.46, t > 0.46];
  r.shape = both(flat(one(t, [[0.42, 0], [0.5, 1], [0.8, 1], [1, 0]])));
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-22, 0, 0]], [0.42, [-24, 0, 0]], [0.5, [8, 0, 0]], [0.75, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-10, 0, 0]], [0.42, [-12, 0, 0]], [0.5, [10, 0, 0]], [0.75, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.42, [-6, 0, 0]], [0.5, [4, 0, 0]], [1, [0, 0, 0]]]);
};

/** Assay: down on the right knee, the right palm laid flat on the earth ahead and the head bowed over it, listening; pressed once; then up again. */
const ASSAY_T = { secs: 1.9, release: 0.58 };
const assayPose: CastPose = (r, t) => {
  r.kneel = one(t, [[0, 0], [0.24, 1], [0.8, 1], [1, 0]]);
  // The palm on the ground a little ahead and to the right of the knee, the trunk bowed only as far as it takes to get it
  // there; pressed down a hair at the release.
  const press = one(t, [[0.5, 0], [0.58, 1], [0.7, 0.4], [0.8, 0]]);
  r.reach = [undefined, { at: [2.4, 6.5, 0.5 - 0.4 * press], stoop: true, w: one(t, [[0.14, 0], [0.34, 1], [0.8, 1], [0.94, 0]]) }];
  r.arm[1] = euler(t, [[0, HANG], [0.22, [50, 8, 0]], [0.8, [42, 6, 0]], [1, HANG]]);
  r.elbow[1] = one(t, [[0, 15], [0.22, 24], [0.8, 6], [1, 15]]);
  r.arm[0] = euler(t, [[0, HANG], [0.26, [62, 10, 6]], [0.8, [62, 10, 6]], [1, HANG]]);
  r.elbow[0] = one(t, [[0, 15], [0.26, 38], [0.8, 38], [1, 15]]);
  r.open = [t > 0.18, t > 0.18];
  r.shape = [flat(one(t, [[0.1, 0], [0.26, 0.6], [0.8, 0.6], [1, 0]])), flat(one(t, [[0.14, 0], [0.34, 1], [0.8, 1], [1, 0]]))];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.26, [-8, 0, 4]], [0.58, [-10, 0, 4]], [0.8, [-8, 0, 4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.26, [-10, 0, 0]], [0.5, [-18, 0, 0]], [0.8, [-18, 0, 0]], [1, [0, 0, 0]]]);
};

/** Sentence: both hands held out before the belly, palms up, weighing -- the right sinks, the left rises, and back; then both turned over and pressed down hard, the knees giving. */
const SENTENCE_T = { secs: 1.0, release: 0.56 };
/** How the caster's two hands weigh, at `t` through a Sentence: positive with the right low. The scales over the creature tip with it. */
const weighing = (t: number): number => (t < 0.12 ? 0 : t < 0.5 ? Math.sin(((t - 0.12) / 0.38) * TAU) * smooth(seg(t, 0.12, 0.2)) : t < 0.56 ? lerp(0, 1.3, smooth(seg(t, 0.5, 0.56))) : 1.3);
const sentencePose: CastPose = (r, t) => {
  const w = weighing(t);
  const press = smooth(seg(t, 0.5, 0.56)) * (1 - smooth(seg(t, 0.78, 1)));
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1;
    const hold = smooth(seg(t, 0, 0.14));
    const fwd = lerp(4, 30 + s * 10 * Math.min(1, w), hold);
    r.arm[k] = [lerp(fwd, 22, press), lerp(10, 22, hold), lerp(4, 6, hold)];
    r.elbow[k] = lerp(lerp(15, 46 - s * 12 * Math.min(1, w), hold), 12, press);
    r.hand[k] = [lerp(0, -54, press), 0, 0];
  }
  r.open = [t > 0.08, t > 0.08];
  // Cupped, palms up, as a pan is; turned over flat to press.
  const cup = one(t, [[0.04, 0], [0.14, 1], [0.5, 1], [0.56, 0]]);
  r.shape = both({ cup, flat: one(t, [[0.5, 0], [0.56, 1], [0.8, 1], [1, 0]]) });
  for (let k = 0; k < 2; k++) r.hand[k][1] += (k ? -1 : 1) * 70 * cup;
  r.chest = [lerp(0, -6, press), -4 * Math.min(1, w) * (1 - press), 0];
  r.spine = euler(t, [[0, [0, 0, 0]], [0.5, [-2, 0, 0]], [0.56, [-10, 0, 0]], [0.78, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.14, [-12, 0, 0]], [0.5, [-10, 0, 0]], [0.56, [-20, 0, 0]], [0.78, [-16, 0, 0]], [1, [0, 0, 0]]]);
  r.knee = [one(t, [[0, 4], [0.5, 8], [0.56, 24], [0.78, 20], [1, 4]]), one(t, [[0, 4], [0.5, 8], [0.56, 24], [0.78, 20], [1, 4]])];
  r.leg = [euler(t, [[0, [2, 2, 0]], [0.56, [12, 6, 0]], [0.78, [10, 6, 0]], [1, [2, 2, 0]]]), euler(t, [[0, [0, 2, 0]], [0.56, [10, 6, 0]], [0.78, [8, 6, 0]], [1, [0, 2, 0]]])];
};

/** Bind: the wrists crossed before the face as though bound, the head bowed behind them; then wrenched apart and down to the hips, fists shut, the knees sunk into it, and held, shaking with the strain. */
const BIND_T = { secs: 1.0, release: 0.5 };
const bindPose: CastPose = (r, t, c) => {
  const strain = t > 0.5 && t < 0.8 ? tremor(t * c.timing.secs, 1.6) : 0;
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, HANG], [0.3, [62, -24, 38]], [0.42, [64, -26, 40]], [0.5, [10, 30, -14]], [0.8, [12, 30, -14]], [1, HANG]]);
    r.arm[k][1] += strain;
    r.elbow[k] = one(t, [[0, 15], [0.3, 84], [0.42, 86], [0.5, 4], [0.8, 6], [1, 15]]);
    r.knee[k] = one(t, [[0, 4], [0.42, 8], [0.5, 30], [0.8, 26], [1, 4]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.42, [2, 3, 0]], [0.5, [14, 12, 0]], [0.8, [12, 12, 0]], [1, [2, 2, 0]]]);
  }
  r.open = [false, false];
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-16, 0, 0]], [0.42, [-18, 0, 0]], [0.5, [4, 0, 0]], [0.8, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.42, [-8, 0, 0]], [0.5, [6, 0, 0]], [0.8, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.42, [-4, 0, 0]], [0.5, [-8, 0, 0]], [0.8, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.shrug = [one(t, [[0, 0], [0.42, 0.5], [0.5, -0.5], [0.8, -0.4], [1, 0]]), one(t, [[0, 0], [0.42, 0.5], [0.5, -0.5], [0.8, -0.4], [1, 0]])];
};

/** Equity: the arms put out level to either side, palms up, the body a balance, tipping one way and the other and settling; then the hands brought together before the chest, level. */
const EQUITY_T = { secs: 1.5, release: 0.6 };
/** How far the body's balance is tipped at `t` through Equity, nought to one either way: rocking and dying away to level at the release. */
const equityTip = (t: number): number => (t < 0.16 ? 0 : t > 0.56 ? 0 : Math.sin(((t - 0.16) / 0.4) * TAU * 1.5) * (1 - seg(t, 0.16, 0.56)) * smooth(seg(t, 0.16, 0.24)));
const equityPose: CastPose = (r, t) => {
  const tip = equityTip(t);
  const join = smooth(seg(t, 0.54, 0.62));
  const back = smooth(seg(t, 0.82, 1));
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    const out = smooth(seg(t, 0, 0.16));
    const level: [number, number, number] = [lerp(4, 8, out), lerp(10, 84 - s * 16 * tip, out), lerp(4, -6, out)];
    const joined: [number, number, number] = [70, -16, 36];
    const now = level.map((v, i) => lerp(v, joined[i], join)) as [number, number, number];
    r.arm[k] = now.map((v, i) => lerp(v, HANG[i], back)) as [number, number, number];
    r.elbow[k] = lerp(lerp(lerp(15, 4, out), 104, join), 15, back);
    r.hand[k] = [0, lerp(lerp(0, s * 70, out), 0, join), 0];
  }
  r.open = [t > 0.06, t > 0.06];
  r.shape = both(flat(one(t, [[0, 0], [0.12, 1], [0.82, 1], [1, 0]])));
  r.chest = [lerp(0, -4, join), 9 * tip, 0];
  r.spine = [0, -3 * tip, 0];
  r.head = euler(t, [[0, [0, 0, 0]], [0.16, [4, 0, 0]], [0.54, [4, 0, 0]], [0.62, [-16, 0, 0]], [0.82, [-14, 0, 0]], [1, [0, 0, 0]]]);
};

/** Verdict: the hands steepled before the face, the head bowed, deliberating; the right arm raised straight up, held; and cut straight down to point at the creature. */
const VERDICT_T = { secs: 1.25, release: 0.6 };
const verdictPose: CastPose = (r, t) => {
  r.arm[0] = euler(t, [[0, HANG], [0.2, [96, -22, 38]], [0.34, [96, -22, 38]], [0.46, JOINED], [0.8, JOINED], [1, HANG]]);
  r.elbow[0] = one(t, [[0, 15], [0.2, 122], [0.34, 122], [0.46, JOINED_BEND], [0.8, JOINED_BEND], [1, 15]]);
  r.arm[1] = euler(t, [[0, HANG], [0.2, [96, -22, 38]], [0.34, [96, -22, 38]], [0.46, [172, 12, 0]], [0.53, [174, 10, 0]], [0.6, [72, 4, 0]], [0.8, [68, 4, 0]], [1, HANG]]);
  r.elbow[1] = one(t, [[0, 15], [0.2, 122], [0.34, 122], [0.46, 8], [0.53, 4], [0.6, 2], [0.8, 6], [1, 15]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.46, [0, 0, 0]], [0.6, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.open = [t > 0.1, t > 0.1];
  const point = one(t, [[0.53, 0], [0.6, 1], [0.84, 1], [1, 0]]);
  r.shape = [flat(one(t, [[0.08, 0], [0.2, 1], [0.84, 1], [1, 0]])), { flat: one(t, [[0.08, 0], [0.2, 1], [0.53, 1], [0.6, 0]]), point }];
  r.mouth = one(t, [[0.55, 0], [0.6, 0.4], [0.72, 0.3], [0.86, 0]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-20, 0, 0]], [0.34, [-22, 0, 0]], [0.46, [12, 0, 0]], [0.53, [14, 0, 0]], [0.6, [-6, 0, 0]], [0.8, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.34, [-6, 0, 0]], [0.46, [8, -4, 6]], [0.53, [9, -4, 6]], [0.6, [-8, 2, -4]], [0.8, [-6, 0, -2]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.46, [4, 0, 0]], [0.6, [-10, 0, 0]], [0.8, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.shrug = [0, one(t, [[0, 0], [0.4, 0], [0.48, 1.2], [0.56, 1.2], [0.62, 0], [1, 0]])];
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.53, [0, 2, 0]], [0.6, [18, 3, 0]], [0.8, [16, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.53, 4], [0.6, 20], [0.8, 16], [1, 5]]);
  r.foot = [0, one(t, [[0, 0], [0.4, 0], [0.48, -12], [0.56, -12], [0.62, 0], [1, 0]])];
};

/** Summons: the right hand held out to the creature, open, palm up -- come; then shut and drawn hard back to the chest, the body leaning back on its rear foot as if hauling it in. */
const SUMMONS_T = { secs: 1.2, release: 0.38 };
const summonsPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, HANG], [0.24, [86, 10, -16]], [0.38, [90, 8, -16]], [0.56, [88, 8, -16]], [0.66, [44, 22, 14]], [0.84, [42, 22, 14]], [1, HANG]]);
  r.elbow[1] = one(t, [[0, 15], [0.24, 8], [0.56, 6], [0.66, 122], [0.84, 118], [1, 15]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.24, [10, 0, -70]], [0.56, [10, 0, -70]], [0.66, [0, 0, 0]], [1, [0, 0, 0]]]);
  r.open = [true, t < 0.6];
  r.shape = [flat(one(t, [[0.1, 0], [0.24, 0.5], [0.84, 0.5], [1, 0]])), flat(one(t, [[0.1, 0], [0.24, 1], [0.58, 1], [0.64, 0]]))];
  r.mouth = one(t, [[0.26, 0], [0.34, 0.5], [0.44, 0.3], [0.62, 0], [0.66, 0.35], [0.8, 0]]);
  r.arm[0] = euler(t, [[0, HANG], [0.24, [14, 26, 0]], [0.56, [16, 26, 0]], [0.66, [-14, 30, 0]], [0.84, [-12, 28, 0]], [1, HANG]]);
  r.elbow[0] = one(t, [[0, 15], [0.24, 24], [0.66, 30], [1, 15]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.24, [-4, 0, 8]], [0.56, [-6, 0, 10]], [0.66, [8, 0, -12]], [0.84, [6, 0, -10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.24, [-6, 0, 0]], [0.56, [-8, 0, 0]], [0.66, [10, 0, 0]], [0.84, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.24, [-4, 0, -6]], [0.56, [-6, 0, -8]], [0.66, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.24, [16, 3, 0]], [0.56, [18, 3, 0]], [0.66, [10, 3, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.24, 14], [0.56, 16], [0.66, 2], [1, 4]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.56, [-2, 2, 0]], [0.66, [-20, 3, 0]], [0.84, [-18, 3, 0]], [1, [0, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.56, 6], [0.66, 22], [0.84, 20], [1, 4]]);
};

/** Temper: the thing in the right fist held up before the face, the left palm laid flat against the fist that holds it and the head bowed to it -- a vigil kept over it; then the face lifted to it as it is tempered, and let down. */
const TEMPER_T = { secs: 1.7, release: 0.6 };
const temperPose: CastPose = (r, t, c) => {
  r.arm[1] = euler(t, [[0, HANG], [0.18, [64, -22, 52]], [0.8, [66, -22, 52]], [1, HANG]]);
  r.elbow[1] = one(t, [[0, 15], [0.18, 96], [0.8, 96], [1, 15]]);
  r.arm[0] = euler(t, [[0, HANG], [0.2, [54, -28, 46]], [0.8, [54, -28, 46]], [1, HANG]]);
  r.elbow[0] = one(t, [[0, 15], [0.2, 104], [0.8, 104], [1, 15]]);
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [0.2, [-30, 0, 0]], [0.8, [-30, 0, 0]], [1, [0, 0, 0]]]);
  r.open = [t > 0.12, !c.carry && t > 0.12];
  r.shape = [flat(one(t, [[0.1, 0], [0.2, 1], [0.8, 1], [1, 0]])), undefined];
  // Whatever is carried is held up into the vigil: a blade by the forearm, a spear or a staff along it.
  const up = one(t, [[0, 0], [0.16, 1], [0.86, 1], [1, 0]]);
  r.wield = c.carry === 'fist' ? up : 0;
  r.wieldStaff = c.carry === 'staff' ? up : 0;
  r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-22, 0, 6]], [0.5, [-24, 0, 6]], [0.62, [8, 0, 4]], [0.8, [6, 0, 4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.2, [-6, 0, 0]], [0.5, [-8, 0, 0]], [0.62, [4, 0, -4]], [0.8, [3, 0, -4]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.5, [-4, 0, 0]], [0.62, [2, 0, 0]], [1, [0, 0, 0]]]);
};

/** Judgment: the arms swept up wide from the sides to overhead, palms up, the face lifted, up on the toes, calling it down; then flung down and out before the body, palms down, with a bow over the field. */
const JUDGMENT_T = { secs: 1.8, release: 0.58 };
const judgmentPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, HANG], [0.18, [20, 70, -10]], [0.36, [112, -56, -10]], [0.5, [150, -34, 0]], [0.58, [44, 42, -14]], [0.8, [40, 42, -14]], [1, HANG]]);
    r.elbow[k] = one(t, [[0, 15], [0.18, 10], [0.5, 8], [0.58, 4], [0.8, 6], [1, 15]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.5, [20, 0, 0]], [0.58, [-36, 0, 0]], [0.8, [-30, 0, 0]], [1, [0, 0, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.5, 0], [0.58, 20], [0.8, 16], [1, 4]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.5, [0, 3, 0]], [0.58, [10, 6, 0]], [0.8, [8, 6, 0]], [1, [2, 2, 0]]]);
  }
  r.foot = [one(t, [[0, 0], [0.36, -6], [0.5, -20], [0.56, 0], [1, 0]]), one(t, [[0, 0], [0.36, -6], [0.5, -20], [0.56, 0], [1, 0]])];
  r.open = [t > 0.08, t > 0.08];
  r.shape = both({ flat: one(t, [[0.06, 0], [0.18, 1], [0.5, 1], [0.58, 0]]), point: one(t, [[0.5, 0], [0.58, 1], [0.84, 1], [1, 0]]) });
  r.shrug = [one(t, [[0, 0], [0.4, 0], [0.5, 1.2], [0.58, 0], [1, 0]]), one(t, [[0, 0], [0.4, 0], [0.5, 1.2], [0.58, 0], [1, 0]])];
  r.head = euler(t, [[0, [0, 0, 0]], [0.36, [10, 0, 0]], [0.5, [20, 0, 0]], [0.58, [-14, 0, 0]], [0.8, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.36, [6, 0, 0]], [0.5, [10, 0, 0]], [0.58, [-8, 0, 0]], [0.8, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.5, [4, 0, 0]], [0.58, [-16, 0, 0]], [0.8, [-14, 0, 0]], [1, [0, 0, 0]]]);
};

/** Truce: both palms raised before the body at the shoulders, facing out -- hold; then pressed slowly down and out to the sides, palms down, as a crowd is quietened, the head inclined. */
const TRUCE_T = { secs: 1.8, release: 0.52 };
const trucePose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, HANG], [0.24, [82, 12, -4]], [0.44, [84, 12, -4]], [0.6, [62, 26, -8]], [0.84, [26, 40, -10]], [1, HANG]]);
    r.elbow[k] = one(t, [[0, 15], [0.24, 46], [0.44, 40], [0.6, 18], [0.84, 6], [1, 15]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.24, [56, 0, 0]], [0.44, [60, 0, 0]], [0.6, [-20, 0, 0]], [0.84, [-40, 0, 0]], [1, [0, 0, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.44, 4], [0.84, 14], [1, 4]]);
  }
  r.open = [t > 0.08, t > 0.08];
  r.shape = both(flat(one(t, [[0.06, 0], [0.2, 1], [0.86, 1], [1, 0]])));
  r.head = euler(t, [[0, [0, 0, 0]], [0.24, [2, 0, 0]], [0.44, [2, 0, 0]], [0.84, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.24, [4, 0, 0]], [0.44, [4, 0, 0]], [0.84, [-4, 0, 0]], [1, [0, 0, 0]]]);
};

/** Restitution: the hands cupped together low before the body, palms up, the head bowed, waiting; then lifted slowly to the heart and closed over it -- given back. */
const RESTITUTION_T = { secs: 1.6, release: 0.46 };
const restitutionPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, HANG], [0.26, [24, -14, 36]], [0.5, [26, -14, 36]], [0.74, [24, -20, 42]], [0.86, [24, -20, 42]], [1, HANG]]);
    r.elbow[k] = one(t, [[0, 15], [0.26, 40], [0.5, 42], [0.74, 96], [0.86, 94], [1, 15]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.26, [30, 0, 0]], [0.5, [30, 0, 0]], [0.74, [0, 0, 0]], [1, [0, 0, 0]]]);
  }
  r.open = [t > 0.08, t > 0.08];
  r.shape = both({ cup: one(t, [[0.06, 0], [0.22, 1], [0.52, 1], [0.7, 0]]), flat: one(t, [[0.52, 0], [0.72, 1], [0.86, 1], [1, 0]]) });
  r.head = euler(t, [[0, [0, 0, 0]], [0.26, [-22, 0, 0]], [0.5, [-24, 0, 0]], [0.74, [2, 0, 0]], [0.86, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.26, [-8, 0, 0]], [0.5, [-8, 0, 0]], [0.74, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.knee = [one(t, [[0, 4], [0.26, 12], [0.5, 12], [0.74, 4], [1, 4]]), one(t, [[0, 4], [0.26, 12], [0.5, 12], [0.74, 4], [1, 4]])];
};

/** Execution: the hands joined and raised straight up overhead, the body drawn up onto its toes, held and trembling; then the whole of it bowed down, the joined hands driven to the knees. */
const EXECUTION_T = { secs: 2.1, release: 0.62 };
const executionPose: CastPose = (r, t, c) => {
  const shake = t > 0.46 && t < 0.6 ? tremor(t * c.timing.secs, 1.4) : 0;
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, HANG], [0.14, JOINED], [0.24, [100, -12, 30]], [0.44, [168, 14, 12]], [0.58, [170, 14, 12]], [0.62, [52, -18, 30]], [0.84, [50, -18, 30]], [1, HANG]]);
    r.arm[k][0] += shake;
    r.elbow[k] = one(t, [[0, 15], [0.14, JOINED_BEND], [0.24, 80], [0.44, 22], [0.58, 20], [0.62, 6], [0.84, 10], [1, 15]]);
  }
  r.open = [t > 0.08, t > 0.08];
  r.shape = both(flat(one(t, [[0.06, 0], [0.14, 1], [0.84, 1], [1, 0]])));
  r.mouth = one(t, [[0.58, 0], [0.62, 0.6], [0.72, 0.4], [0.86, 0]]);
  r.shrug = [one(t, [[0, 0], [0.34, 0], [0.44, 1.4], [0.58, 1.4], [0.62, 0], [1, 0]]), one(t, [[0, 0], [0.34, 0], [0.44, 1.4], [0.58, 1.4], [0.62, 0], [1, 0]])];
  r.foot = [one(t, [[0, 0], [0.3, 0], [0.44, -22], [0.58, -22], [0.61, 0], [1, 0]]), one(t, [[0, 0], [0.3, 0], [0.44, -22], [0.58, -22], [0.61, 0], [1, 0]])];
  r.spine = euler(t, [[0, [0, 0, 0]], [0.44, [8, 0, 0]], [0.58, [9, 0, 0]], [0.62, [-34, 0, 0]], [0.84, [-30, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.14, [-4, 0, 0]], [0.44, [8, 0, 0]], [0.58, [9, 0, 0]], [0.62, [-14, 0, 0]], [0.84, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.14, [-18, 0, 0]], [0.44, [20, 0, 0]], [0.58, [22, 0, 0]], [0.62, [-20, 0, 0]], [0.84, [-18, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.58, [0, 3, 0]], [0.62, [30, 6, 0]], [0.84, [28, 6, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.58, 0], [0.62, 46], [0.84, 42], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.58, [0, 3, 0]], [0.62, [-4, 4, 0]], [0.84, [-4, 4, 0]], [1, [0, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.58, 0], [0.62, 30], [0.84, 28], [1, 5]]);
};

/** Oath: the right hand raised beside the head, palm out, sworn, and the left laid flat on the heart, still; then the right hand let down and held out to the friend, palm up. */
const OATH_T = { secs: 1.45, release: 0.56 };
const oathPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, HANG], [0.24, [120, -26, -14]], [0.48, [122, -26, -14]], [0.56, [80, 10, -18]], [0.82, [78, 10, -18]], [1, HANG]]);
  r.elbow[1] = one(t, [[0, 15], [0.24, 108], [0.48, 110], [0.56, 14], [0.82, 18], [1, 15]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.24, [40, 0, 0]], [0.48, [40, 0, 0]], [0.56, [10, 0, -70]], [0.82, [10, 0, -66]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, HANG], [0.24, [22, -20, 44]], [0.82, [22, -20, 44]], [1, HANG]]);
  r.elbow[0] = one(t, [[0, 15], [0.24, 92], [0.82, 92], [1, 15]]);
  r.open = [t > 0.1, t > 0.1];
  r.shape = both(flat(one(t, [[0.08, 0], [0.22, 1], [0.84, 1], [1, 0]])));
  r.head = euler(t, [[0, [0, 0, 0]], [0.24, [6, 0, 0]], [0.48, [6, 0, 0]], [0.56, [-6, 0, 0]], [0.82, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.24, [4, 0, 4]], [0.48, [4, 0, 4]], [0.56, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.5, [2, 2, 0]], [0.56, [12, 3, 0]], [0.82, [10, 3, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.56, 10], [0.82, 8], [1, 4]]);
};

/** Due Reward: the hands joined at the chest and the head bowed; then raised up the body's middle overhead and opened wide, palms up, the face lifted, up on the toes -- received. */
const REWARD_T = { secs: 1.5, release: 0.58 };
const rewardPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, HANG], [0.2, JOINED], [0.3, JOINED], [0.46, [154, 12, 12]], [0.58, [150, -40, 0]], [0.82, [148, -40, 0]], [1, HANG]]);
    r.elbow[k] = one(t, [[0, 15], [0.2, JOINED_BEND], [0.3, JOINED_BEND], [0.46, 50], [0.58, 10], [0.82, 12], [1, 15]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.46, [0, 0, 0]], [0.58, [30, 0, 0]], [1, [0, 0, 0]]]);
  }
  r.open = [t > 0.08, t > 0.08];
  r.shape = both(flat(one(t, [[0.06, 0], [0.2, 1], [0.84, 1], [1, 0]])));
  r.foot = [one(t, [[0, 0], [0.46, 0], [0.58, -16], [0.8, -16], [0.9, 0], [1, 0]]), one(t, [[0, 0], [0.46, 0], [0.58, -16], [0.8, -16], [0.9, 0], [1, 0]])];
  r.shrug = [one(t, [[0, 0], [0.46, 0.6], [0.58, 1.1], [0.82, 1], [1, 0]]), one(t, [[0, 0], [0.46, 0.6], [0.58, 1.1], [0.82, 1], [1, 0]])];
  r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-20, 0, 0]], [0.3, [-20, 0, 0]], [0.58, [18, 0, 0]], [0.82, [16, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-4, 0, 0]], [0.58, [10, 0, 0]], [0.82, [8, 0, 0]], [1, [0, 0, 0]]]);
};

/* ---- the spells ---------------------------------------------------------------------------- */

/** Over a body's head, where a seal hangs. */
const over = (k: FxScene, b: Body, up = 5): P3 => ({ x: b.x, y: b.y, z: b.z + b.tall + up });
/** A ring's radius round a body's feet, in tiles, from how wide it is. */
const footR = (b: Body): number => Math.max(0.26, (b.wide / 40) * 2.2);
/** The way a body is facing on the screen, pointing from `from` toward `to`: for a chevron. */
const screenDir = (k: FxScene, from: P3, to: P3): Pt => [k.sx(to) - k.sx(from), k.sy(to) - k.sy(from)];
/** Behind a body, away from whoever cast at it (or from its own facing, when it is the caster): where a grave stands. */
function behind(k: FxScene, b: Body, tiles: number): { x: number; y: number } {
  // Away from the caster, past whoever it is on; or, on the caster, back the way they face from.
  const mine = b === k.caster;
  const d = mine ? k.facingDir(b) : k.toward(k.caster, b);
  const s = mine ? -tiles : tiles;
  return { x: b.x + d.x * s, y: b.y + d.y * s };
}

/* Mark of Judgment */
const MARK_IMPACT = 0.8;
const MARK_TICKS = ticksFor(lastsOf('justice_mark'));
const markSeal = (k: FxScene, age: number, left: number): void => {
  const a = smooth((age - MARK_IMPACT * 0.8) / 0.25) * smooth(left / 0.8);
  if (a <= 0.01) return;
  const b = k.target;
  const p = over(k, b, 4 + 0.6 * Math.sin(age * 1.6));
  lozenge(k, p, 5.2, { alpha: 0.92 * a, spin: 2 * snapTurn(age / 2.5), glow: 0.6 });
  tally(k, b, footR(b), MARK_TICKS, (MARK_TICKS * left) / Math.max(1, lastsOf('justice_mark')), { alpha: 0.6 * a });
  if (!k.fast) k.emit({ x: p.x, y: p.y, z: p.z - 3 }, 2.5 * a, { kind: 'mote', size: 1.4, colour: k.pal.main, life: [0.6, 1], speed: [0.01, 0.05], up: [-10, -6], gravity: 0, jitter: 0.04 });
};

/* Retribution: four mirror plates round the body, square to the tiles. */
const RETRIBUTION_TICKS = ticksFor(lastsOf('justice_retribution'));
function plates(k: FxScene, b: Body, r: number, share: number, turn: number, alpha: number, h = 6, glint = -1): void {
  const c = { x: b.x, y: b.y, z: b.z + b.tall * share };
  const cx = k.sx(c), cy = k.sy(c);
  for (let i = 0; i < 4; i++) {
    const ang = turn + (i * Math.PI) / 2 + Math.PI / 4;
    const p = { x: b.x + (Math.cos(ang) * r) / 40, y: b.y + (Math.sin(ang) * r) / 40, z: c.z };
    // Square to whoever looks: a plate on the near or the far side shows its face, one at the side its edge.
    const ox = k.sx(p) - cx, oy = (k.sy(p) - cy) * 2;
    const face = Math.abs(oy) / (Math.hypot(ox, oy) || 1);
    lozenge(k, p, h, { alpha, spin: Math.acos(Math.max(0.16, face)) * (ox > 0 ? 1 : -1), wide: 0.42, glow: i === glint ? 1.6 : 0.5, bias: 0, slit: i === glint, main: STEEL });
  }
}
const retributionLinger = (k: FxScene, age: number, left: number): void => {
  const a = smooth((age - 0.55) / 0.3) * smooth(left / 0.8);
  if (a <= 0.01) return;
  const b = k.target;
  // Every three seconds one plate catches the light: the turned-back blow waiting.
  const glint = Math.floor(age / 3) % 4;
  const g = bump((age % 3) / 3, 0, 0.12, 0.4);
  plates(k, b, 11, 0.55, age * 0.35, 0.75 * a, 6, g > 0.05 ? glint : -1);
  tally(k, b, footR(b) + 0.06, RETRIBUTION_TICKS, (RETRIBUTION_TICKS * left) / Math.max(1, lastsOf('justice_retribution')), { alpha: 0.5 * a });
};

/* Assay */
const ASSAY_R = radiusOf('justice_assay');
const ASSAY_IMPACT = 2.4;
/** A plumb-bob hung over the spot on its line: Assay's measure. */
function plumb(k: FxScene, spot: P3, lift: number, alpha: number, swing: number): void {
  const bob: P3 = { x: spot.x, y: spot.y, z: spot.z + lift };
  const topZ = lift + 22;
  const top: P3 = { x: spot.x, y: spot.y, z: spot.z + topZ };
  const bx = k.sx(bob) + swing * k.zoom, by = k.sy(bob);
  const tx = k.sx(top), ty = k.sy(top);
  const ink = k.pal.ink, core = k.pal.core;
  k.worldDraw(spot, (g) => {
    g.globalAlpha = clamp(alpha * 0.8);
    g.strokeStyle = ink;
    g.lineWidth = Math.max(1.2, 1.4 * k.zoom);
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(bx, by);
    g.stroke();
    g.strokeStyle = core;
    g.lineWidth = Math.max(0.6, 0.6 * k.zoom);
    g.stroke();
  }, 1);
  lozenge(k, { x: spot.x, y: spot.y, z: spot.z + lift - 2 }, 5, { alpha, wide: 0.7, glow: 0.8, bias: 1.5 });
}

/* Sentence */
const SENTENCE_SIZE = 9;
const sentencePivot = (k: FxScene): P3 => over(k, k.target, 14);

/* Bind */
const BIND_LASTS = lastsOf('justice_bind');
const BIND_TICKS = ticksFor(BIND_LASTS);
/** The four stakes a Bind drives, at the corners of a square round the creature on the land's lines. */
function stakes(b: Body): Array<{ x: number; y: number }> {
  const s = Math.max(0.3, (b.wide / 40) * 2.8);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: b.x + i * s, y: b.y + j * s }));
}

/* Verdict */
const VERDICT_LEN = 30;
const verdictHang = (k: FxScene): number => k.target.tall + 30;

/* Judgment */
const JUDGMENT_R = radiusOf('justice_judgment');
const JUDGMENT_IMPACT = 2.4;
const judgmentSwords = (k: FxScene): number => (k.fast ? 5 : 8);
/** Each of Judgment's swords, point to pommel: smaller than a Verdict's, there being many. */
const JUDGMENT_SWORD = 26;
/** The ticks of a judged creature's tally: the seconds it takes more damage. */
const JUDGMENT_TICKS = ticksFor(lastsOf('justice_judgment'));
/** The most creatures Judgment marks for its seconds: past it the marks would crowd the field and cost too much. */
const JUDGED_MOST = 6;
/**
 * The creatures Judgment comes down on: those standing within its reach when the swords first form, nearest the spot
 * first, kept by who they are (`k.state`) so the same ones are followed wherever they go. The island does not say
 * which were hunting somebody, and so which it really hurt; these are the ones there.
 */
function judged(k: FxScene): Array<Body | null> {
  if (!k.state.picked) {
    k.state.picked = 1;
    const there = k.bodiesWithin(JUDGMENT_R, k.spot, ['creature'])
      .sort((a, b) => Math.hypot(a.x - k.spot.x, a.y - k.spot.y) - Math.hypot(b.x - k.spot.x, b.y - k.spot.y));
    let n = 0;
    for (const b of there) {
      if (b.who?.kind !== 'creature' || n >= Math.min(JUDGED_MOST, judgmentSwords(k))) continue;
      k.state[`judged${n++}`] = b.who.id;
    }
    k.state.judgedN = n;
  }
  const n = k.state.judgedN ?? 0;
  if (!n) return [];
  // Followed a little past the reach: a creature struck at the edge that steps out is still marked.
  const near = k.bodiesWithin(JUDGMENT_R + 4, k.spot, ['creature']);
  const out: Array<Body | null> = [];
  for (let i = 0; i < n; i++) {
    const id = k.state[`judged${i}`];
    out.push(near.find((b) => b.who?.kind === 'creature' && b.who.id === id) ?? null);
  }
  return out;
}
/** Where each of Judgment's swords comes down: on a creature standing there, or else spread over the ground it covers. */
function judgmentAt(k: FxScene, i: number, n: number, on: ReadonlyArray<Body | null>): { x: number; y: number } {
  const b = on[i];
  if (b) return { x: b.x, y: b.y };
  if (i === 0) return { x: k.spot.x, y: k.spot.y };
  const ang = ((i - 1) / (n - 1)) * TAU + hashOf(k.seed, i) * 0.7;
  const rr = JUDGMENT_R * (0.35 + 0.55 * Math.sqrt(hashOf(k.seed + 11, i)));
  return { x: k.spot.x + Math.cos(ang) * rr, y: k.spot.y + Math.sin(ang) * rr };
}
/** When each sword falls, seconds into the impact. */
const judgmentFall = (i: number): number => 0.06 + i * 0.075;

/* Truce */
const TRUCE_R = radiusOf('justice_truce');
const TRUCE_LASTS = lastsOf('justice_truce');
const trucePales = (k: FxScene): number => (k.fast ? 12 : 20);
/** How tall a Truce's stakes stand, in height units: chest-high on a person. */
const TRUCE_PALE = 12;
/** The planted sword of a Truce, point to pommel. */
const TRUCE_SWORD = 34;
/** Whoever stands on a spot, for a sword planted there to go through rather than over them. */
const standingAt = (k: FxScene, c: { x: number; y: number }): Body | null => k.bodiesWithin(0.3, c)[0] ?? null;
/** How many of those inside a Truce are drawn bound by it. */
const TRUCE_BONDS = 4;
function pales(k: FxScene, age: number, rise: number, alpha: number): void {
  const n = trucePales(k);
  const left = TRUCE_LASTS - age;
  const each = TRUCE_LASTS / n;
  // In four runs, a quarter of the ring each, each sorted where its middle stands: a body inside the ring is behind the near
  // run and before the far one, and the stakes cost four records rather than one apiece.
  const runs: Array<Array<{ foot: { x: number; y: number }; h: number; alpha: number }>> = [[], [], [], []];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU - Math.PI / 2;
    const foot = { x: k.spot.x + Math.cos(ang) * TRUCE_R, y: k.spot.y + Math.sin(ang) * TRUCE_R };
    const up = smooth(seg(rise, (i / n) * 0.6, (i / n) * 0.6 + 0.4));
    // Each stake stands for its share of the truce's seconds and then goes down into the ground, the first first.
    const down = age > 0 ? smooth(seg(left, (n - 1 - i) * each, (n - 1 - i) * each + Math.min(1, each * 0.5))) : 1;
    runs[Math.floor((i / n) * 4) % 4].push({ foot, h: TRUCE_PALE * easeBack(up) * down, alpha: alpha * Math.min(1, up * 3) });
  }
  for (let q = 0; q < 4; q++) {
    const ang = ((q + 0.5) / 4) * TAU - Math.PI / 2;
    const mid = k.on(k.spot.x + Math.cos(ang) * TRUCE_R, k.spot.y + Math.sin(ang) * TRUCE_R);
    k.worldDraw(mid, postPainter(k, runs[q], 1.1, 2), 0);
  }
  // A little light on each stake's cap, so the ring of them shows at night.
  for (const run of runs) for (const p of run) if (p.h > 1) k.glow(k.on(p.foot.x, p.foot.y, p.h + 2), 5, 0.4 * p.alpha);
}

/* Restitution */
const RESTITUTION_IMPACT = 2.0;
const RESTITUTION_GOODS = 9;
const restitutionGrave = (k: FxScene): { x: number; y: number } => behind(k, k.target, 1.1);

/* Execution */
const EXECUTION_LEN = 64;

/* Oath */
/** Two cords twisted about the line between two points, `amp` pixels at zoom one apart at their widest: a sworn bond. */
function braid(k: FxScene, a: P3, b: P3, amp: number, phase: number, o: { alpha?: number; to?: number } = {}): void {
  const al = o.alpha ?? 1;
  if (al <= 0.01) return;
  const to = clamp(o.to ?? 1);
  const x0 = k.sx(a), y0 = k.sy(a), x1 = k.sx(b), y1 = k.sy(b);
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
  const n = Math.max(8, Math.min(48, Math.round(len / (5 * k.zoom))));
  const A = amp * k.zoom;
  const turns = Math.max(2, len / (26 * k.zoom));
  const cords: Pt[][] = [[], []];
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * to;
    // Pinched to nothing at both ends, where it is tied.
    const w = A * Math.sin(Math.PI * Math.min(1, u / Math.max(0.01, to)));
    for (let c = 0; c < 2; c++) {
      const s = Math.sin(u * turns * TAU + phase + c * Math.PI);
      cords[c].push([lerp(x0, x1, u) + nx * w * s, lerp(y0, y1, u) + ny * w * s]);
    }
  }
  const near = y1 > y0 ? b : a;
  const { core, main, ink } = k.pal;
  k.worldDraw(near, (g) => {
    g.globalAlpha = clamp(al);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (let c = 0; c < 2; c++) {
      g.beginPath();
      g.moveTo(cords[c][0][0], cords[c][0][1]);
      for (const [x, y] of cords[c]) g.lineTo(x, y);
      g.strokeStyle = ink;
      g.lineWidth = Math.max(2, 2.4 * k.zoom);
      g.stroke();
      g.strokeStyle = c ? main : core;
      g.lineWidth = Math.max(0.9, 1.1 * k.zoom);
      g.stroke();
    }
  }, 1);
  const light = k.pal.light;
  k.glowDraw((g) => {
    g.globalAlpha = clamp(al * 0.16);
    g.strokeStyle = light;
    g.lineWidth = A * 2.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(lerp(x0, x1, to), lerp(y0, y1, to));
    g.stroke();
    g.lineCap = 'butt';
  });
}
/** Two lozenges linked, over a sworn head. */
function sworn(k: FxScene, p: P3, h: number, alpha: number, spin: number): void {
  const d = h * 0.32;
  lozenge(k, { x: p.x, y: p.y, z: p.z + d }, h, { alpha, spin, wide: 0.5, glow: 0.5, slit: false });
  lozenge(k, { x: p.x, y: p.y, z: p.z - d }, h, { alpha, spin: spin + Math.PI / 2, wide: 0.5, glow: 0.3, slit: false, main: STEEL });
}
const OATH_IMPACT = 1.1;

/* Due Reward */
const REWARD_IMPACT = 1.4;
const REWARD_RANKS = 4;

export const JUSTICE: Record<string, SpellVisual> = {
  /*
   * Mark of Judgment (on an enemy, 30 s, 15% more damage from every blow).
   * A seal is pressed out of the priest's palm and flies straight and level
   * to the creature, stamps down onto its back with a square knocked out over
   * the ground, and rises to hang over it as a turning lozenge for as long as
   * the mark lasts, its tally going out tick by tick beneath it.
   */
  justice_mark: {
    palette: PALETTE,
    cast: { timing: MARK_T, pose: markPose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.34, 0.5));
        if (g <= 0 || t >= MARK_T.release) return;
        const d = k.toward(k.caster, k.target);
        const h = k.hand(1);
        const at = { x: h.x + d.x * 0.08, y: h.y + d.y * 0.08, z: h.z + 1 };
        lozenge(k, at, 2 + 3 * g, { alpha: g, spin: flipTurn(t * 6), glow: 0.9 });
        k.light(at, 1.5, 0.4 * g);
      },
      release: (k) => k.burst(k.hand(1), 8, { kind: 'mote', size: 1.6, life: [0.2, 0.4], speed: [0.2, 0.6], up: [-2, 6], heading: k.toward(k.caster, k.target), cone: 0.7, gravity: 0 }),
      travel: {
        secs: (tiles) => 0.08 + tiles * 0.055,
        draw: (k, u) => {
          const from = k.hand(1), to = over(k, k.target, 6);
          const head = mid3(from, to, easeIn(u) * 0.35 + u * 0.65);
          k.beam(mid3(from, to, Math.max(0, u - 0.4)), head, { width: 1.2, alpha: 0.6, glow: 0.5 });
          lozenge(k, head, 5, { spin: flipTurn(u * 4), glow: 1 });
          k.light(head, 2, 0.5);
        },
      },
      hit: (k) => k.burst(over(k, k.target, 6), 10, { kind: 'mote', size: 1.8, life: [0.3, 0.6], speed: [0.2, 0.5], up: [-4, 8], gravity: 0 }),
      impact: {
        secs: MARK_IMPACT,
        draw: (k, u) => {
          const b = k.target;
          // Swells over it, a beat; stamped down onto its back; a beat; and lifted off to hang over it.
          const swell = smooth(seg(u, 0, 0.22));
          const stamp = easeIn(seg(u, 0.22, 0.32));
          const lift = smooth(seg(u, 0.5, 1));
          const z = lerp(lerp(b.tall + 6, b.tall * 0.62, stamp), b.tall + 4, lift);
          const h = lerp(lerp(5, 8, swell), 5.2, lift);
          lozenge(k, { x: b.x, y: b.y, z: b.z + z }, h, { alpha: 1 - 0.2 * lift, spin: 0, glow: 1 + flashOf(seg(u, 0.32, 0.6)) });
          if (once(k, 'stamped', u >= 0.32)) {
            flatSparks(k, k.at(b, 0.4), 22, 1.4);
            k.burst(k.at(b, 0.05), 6, { kind: 'dust', colour: '#8a7d68', size: 3, life: [0.4, 0.7], speed: [0.3, 0.6], up: [1, 4], gravity: 2 });
          }
          squareOut(k, b, seg(u, 0.32, 0.85), footR(b) + 0.08, 0.9);
          k.flare(k.at(b, 0.62), 10 * flashOf(seg(u, 0.32, 0.7)), flashOf(seg(u, 0.32, 0.7)), k.pal.core, Math.PI / 4);
          k.light(b, 2.5, 0.7 * (1 - u));
        },
      },
      linger: { draw: markSeal },
    },
  },

  /*
   * Retribution (on oneself or a friend, 60 s, 20% of every blow dealt back).
   * Four mirror plates are gathered in the crossed arms and flung out; they
   * slam into place round whoever it is on, square to the land, and turn
   * slowly about them, one catching the light every few seconds, with a
   * minute's tally of twelve ticks at their feet.
   */
  justice_retribution: {
    palette: PALETTE,
    cast: { timing: RETRIBUTION_T, pose: retributionPose },
    fx: {
      charge: (k, t) => {
        // The plates drawn in round the priest as the arms cross, close and small, before they are flung out.
        const g = smooth(seg(t, 0.12, 0.42)) * (1 - smooth(seg(t, 0.5, 0.56)));
        if (g > 0) plates(k, k.caster, lerp(14, 8, g), 0.5, snapTurn(t * 3), g, 2.5 + 1.5 * g);
        k.light(k.chest(), 1.5, 0.35 * g);
      },
      release: (k) => {
        flatSparks(k, k.chest(), 14, 1.1);
      },
      travel: {
        secs: (tiles) => (tiles < 0.3 ? 0 : 0.14 + tiles * 0.05),
        draw: (k, u) => {
          const from = k.chest(), to = k.at(k.target, 0.55);
          const p = arcAt(from, to, smooth(u), 3 + k.dist);
          const mover: Body = { ...k.target, x: p.x, y: p.y, z: p.z - k.target.tall * 0.55 };
          plates(k, mover, 5, 0.55, u * Math.PI, 1, 4.5);
          k.light(p, 2, 0.5);
        },
      },
      hit: (k) => {
        k.burst(k.at(k.target, 0.55), 18, { kind: 'spark', size: 1.8, colour: [k.pal.core, STEEL], life: [0.2, 0.4], speed: [0.6, 1.4], up: [-6, 10], gravity: 10, drag: 0.05 });
      },
      impact: {
        secs: 0.7,
        draw: (k, u) => {
          const b = k.target;
          // Out from the body and slammed home, a little past and back: a guard taken up.
          const out = easeBack(seg(u, 0, 0.35));
          plates(k, b, lerp(5, 11, out), 0.55, 0, 1, lerp(4, 6.5, out) - 0.5 * seg(u, 0.35, 1), u < 0.35 ? -1 : 0);
          for (let i = 0; i < 4 && u < 0.5; i++) {
            const ang = (i * Math.PI) / 2 + Math.PI / 4;
            k.flare({ x: b.x + (Math.cos(ang) * 11) / 40, y: b.y + (Math.sin(ang) * 11) / 40, z: b.z + b.tall * 0.55 }, 7 * flashOf(seg(u, 0.3, 0.5)), flashOf(seg(u, 0.3, 0.5)));
          }
          k.light(b, 2.5, 0.6 * (1 - u));
        },
      },
      linger: { draw: retributionLinger },
    },
  },

  /*
   * Assay (8 tiles round a spot, 10 minutes, ore seams marked). The priest
   * kneels and lays a palm on the earth; a measuring line runs over the ground
   * to the spot, a plumb-bob drops onto it, and three sounding rings go out,
   * graduated like a rule, exactly to the eight tiles it searches. For the ten
   * minutes after, the bob hangs over the spot and a faint sounding goes out
   * every ten seconds.
   */
  justice_assay: {
    palette: PALETTE,
    cast: { timing: ASSAY_T, pose: assayPose },
    fx: {
      charge: (k, t) => {
        if (t >= ASSAY_T.release) return;
        const g = smooth(seg(t, 0.3, 0.56));
        if (g <= 0) return;
        const h = k.hand(1);
        const under = k.on(h.x, h.y);
        square(k, under, 0.1 + 0.08 * g, { band: 0.035, alpha: g * 0.9, glow: 0.6, studs: false });
        k.glow(h, 6, 0.6 * g);
      },
      release: (k) => {
        const h = k.hand(1);
        k.burst(k.on(h.x, h.y, 0.5), 10, { kind: 'dust', colour: '#8a7d68', size: 2.4, life: [0.3, 0.6], speed: [0.2, 0.5], up: [1, 4], gravity: 2 });
      },
      travel: {
        secs: (tiles) => (tiles < 0.6 ? 0 : 0.12 + tiles * 0.04),
        draw: (k, u) => {
          const h = k.hand(1);
          const from = k.on(h.x, h.y, 0.4), to = k.on(k.spot.x, k.spot.y, 0.4);
          const head = mid3(from, to, u);
          k.ribbon([from, mid3(from, to, u * 0.5), head], { width: 2, alpha: 0.85, taper: 'start', glow: 0.6 });
          lozenge(k, { ...head, z: head.z + 2 }, 3, { spin: flipTurn(u * 6), glow: 0.8 });
        },
      },
      hit: (k) => {
        k.burst(k.on(k.spot.x, k.spot.y, 1), 18, { kind: 'mote', size: 1.8, life: [0.5, 0.9], speed: [0.1, 0.5], up: [-14, -4], gravity: 0, jitter: 0.3 });
        k.burst(k.on(k.spot.x, k.spot.y, 0.5), 10, { kind: 'dust', colour: '#8a7d68', size: 3, life: [0.4, 0.8], speed: [0.3, 0.8], up: [1, 5], gravity: 2 });
      },
      impact: {
        secs: ASSAY_IMPACT,
        draw: (k, u) => {
          const s = k.spot;
          // The bob comes down and stops a hand over the ground; then the soundings go out, one after another, to the reach.
          const drop = easeOut(seg(u, 0, 0.12));
          plumb(k, s, lerp(30, 6, drop), smooth(seg(u, 0, 0.06)), Math.sin(u * 14) * 1.5 * (1 - u));
          for (let i = 0; i < 3; i++) {
            const v = seg(u, 0.1 + i * 0.16, 0.62 + i * 0.16);
            if (v <= 0 || v >= 1) continue;
            const rr = 0.2 + (ASSAY_R - 0.2) * easeOut(v);
            tally(k, s, rr, 24, 24, { alpha: (1 - v * v) * (i ? 0.55 : 0.9), tick: 0.22 + 0.1 * (1 - v), turn: i * 0.13 });
          }
          square(k, s, 0.5, { band: 0.07, alpha: smooth(seg(u, 0.08, 0.2)) * (1 - 0.4 * seg(u, 0.6, 1)), draw: seg(u, 0.08, 0.3) });
          k.light(s, 3 + ASSAY_R * 0.5 * seg(u, 0.1, 0.6), 0.7 * (1 - 0.6 * u));
        },
      },
      linger: {
        on: 'spot',
        draw: (k, age, left) => {
          const a = smooth((age - ASSAY_IMPACT) / 0.6) * smooth(left / 2);
          if (a <= 0.01) return;
          const s = k.spot;
          plumb(k, s, 6 + Math.sin(age * 1.2) * 0.6, 0.65 * a, Math.sin(age * 0.9) * 1.2);
          square(k, s, 0.5, { band: 0.04, alpha: 0.3 * a, glow: 0.3 });
          // Every ten seconds a faint sounding goes out to the reach again: the seams are still marked.
          const v = (((age - ASSAY_IMPACT) % 10) - 7.4) / 2.6;
          if (v > 0 && v < 1) tally(k, s, 0.3 + (ASSAY_R - 0.3) * easeOut(v), 24, 24, { alpha: 0.28 * a * (1 - v * v), tick: 0.2 });
          if (!k.fast) k.emit(k.on(s.x, s.y, 4), 1.2 * a, { kind: 'mote', size: 1.4, life: [0.8, 1.2], speed: [0.01, 0.04], up: [-6, -3], gravity: 0, jitter: 0.25 });
        },
      },
    },
  },

  /*
   * Sentence (on an enemy: a quarter of the health it has already lost). A
   * pair of scales hangs over the creature and tips as the priest's two hands
   * weigh; the hands press down, the loaded pan slams, and its weight drops
   * straight onto the creature and breaks there. The scales come back level
   * and go: weighed and paid.
   */
  justice_sentence: {
    palette: PALETTE,
    cast: { timing: SENTENCE_T, pose: sentencePose },
    fx: {
      charge: (k, t) => {
        if (t >= SENTENCE_T.release) return;
        const a = smooth(seg(t, 0.04, 0.18));
        if (a <= 0) return;
        const tilt = 0.4 * clamp(weighing(t), -1, 1.3);
        scales(k, sentencePivot(k), SENTENCE_SIZE, tilt, { alpha: a, load: t < 0.56 ? 1 : 0, at: k.target, bias: 4 });
        k.glow(mid3(k.hand(0), k.hand(1), 0.5), 5, 0.5 * a);
        k.light(k.target, 2, 0.4 * a);
      },
      release: (k) => k.burst(mid3(k.hand(0), k.hand(1), 0.5), 8, { kind: 'mote', size: 1.6, life: [0.2, 0.4], speed: [0.1, 0.3], up: [-10, -2], gravity: 0 }),
      travel: {
        secs: () => 0.2,
        draw: (k, u) => {
          const piv = sentencePivot(k);
          scales(k, piv, SENTENCE_SIZE, 0.42 - 0.1 * u, { at: k.target, bias: 4 });
          // The weight, off the right-hand pan and falling, quicker and quicker.
          const s = SENTENCE_SIZE;
          // It drops from under the low pan and is drawn in over the creature as it falls, so it lands on its back.
          const tilt = 0.42 - 0.1 * u;
          const fromZ = piv.z - s * 0.62 - s * 0.62 * Math.sin(tilt);
          const z = lerp(fromZ, k.target.z + k.target.tall * 0.85, easeIn(u));
          box(k, { x: k.target.x, y: k.target.y, z }, 3.2 + u, { spin: Math.PI / 4, dx: k.hpx(s) * 0.62 * Math.cos(tilt) * (1 - smooth(u)) });
          k.beam({ x: k.target.x, y: k.target.y, z: z + 2 }, { x: k.target.x, y: k.target.y, z: z + 2 + 10 * u }, { width: 1, alpha: 0.5 * u, glow: 0.4 });
        },
      },
      hit: (k) => {
        const at = k.at(k.target, 0.8);
        k.burst(at, 16, { kind: 'shard', colour: [STEEL, k.pal.main, k.pal.deep], size: 2.2, life: [0.4, 0.8], speed: [0.5, 1.2], up: [10, 26], gravity: 70, drag: 0.4, spin: 2 });
        flatSparks(k, k.at(k.target, 0.3), 18, 1.4);
        k.burst(k.at(k.target, 0.05), 8, { kind: 'dust', colour: '#8a7d68', size: 3, life: [0.4, 0.7], speed: [0.3, 0.7], up: [1, 4], gravity: 2 });
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const piv = sentencePivot(k);
          // Level again, lifting away.
          scales(k, { ...piv, z: piv.z + 6 * smooth(u) }, SENTENCE_SIZE, 0.32 * (1 - easeOut(seg(u, 0, 0.5))) * Math.cos(u * 9), { alpha: 1 - smooth(seg(u, 0.45, 1)), at: k.target, bias: 4 });
          squareOut(k, k.target, seg(u, 0, 0.7), footR(k.target) + 0.12);
          k.flare(k.at(k.target, 0.8), 12 * flashOf(seg(u, 0, 0.4)), flashOf(seg(u, 0, 0.4)), k.pal.core, Math.PI / 4);
          k.light(k.target, 3, 0.8 * (1 - u));
        },
      },
    },
  },

  /*
   * Bind (on an enemy, 5 s held; a monster half that). The priest's wrists
   * are bound before the face and wrenched apart; a line runs over the ground
   * to the creature, four stakes punch up at the corners of a square round it
   * and chains snap from them onto it, taut. It strains against them; a tally
   * of five ticks, one a second, goes out at its feet; and at the end the
   * chains break into pieces.
   */
  justice_bind: {
    palette: PALETTE,
    cast: { timing: BIND_T, pose: bindPose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.1, 0.42)) * (1 - smooth(seg(t, 0.55, 0.7)));
        for (let s = 0; s < 2; s++) {
          if (g <= 0) break;
          const h = k.hand(s as 0 | 1);
          hoop(k, { x: h.x, y: h.y, z: h.z - 1.2, tall: 2.4, wide: 1, facing: 0, kind: 'spot' }, 0.5, 1.6, { alpha: g, width: 1.3, colour: STEEL });
        }
        if (once(k, 'snap', t >= 0.5)) for (let s = 0; s < 2; s++) k.burst(k.hand(s as 0 | 1), 6, { kind: 'spark', size: 1.6, colour: [k.pal.core, STEEL], life: [0.15, 0.3], speed: [0.3, 0.8], up: [-4, 8], gravity: 30 });
      },
      travel: {
        secs: (tiles) => 0.06 + tiles * 0.03,
        draw: (k, u) => {
          const from = k.on(k.caster.x, k.caster.y, 0.3), to = k.on(k.target.x, k.target.y, 0.3);
          k.ribbon([from, mid3(from, to, u * 0.6), mid3(from, to, u)], { width: 1.8, alpha: 0.85, glow: 0.6 });
        },
      },
      hit: (k) => {
        for (const s of stakes(k.target)) k.burst(k.on(s.x, s.y, 0.5), 5, { kind: 'dust', colour: '#8a7d68', size: 2.6, life: [0.3, 0.6], speed: [0.2, 0.5], up: [2, 6], gravity: 4 });
        flatSparks(k, k.at(k.target, 0.5), 12, 0.9);
      },
      impact: {
        secs: 0.5,
        draw: (k, u) => {
          for (const s of stakes(k.target)) k.flare(k.on(s.x, s.y, 5), 6 * flashOf(u), flashOf(u));
          k.light(k.target, 2.5, 0.8 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const b = k.target;
          const up = easeBack(seg(age, 0, 0.12));
          const reach = smooth(seg(age, 0.06, 0.2));
          const fade = smooth(left / 0.25);
          const broke = left < 0.25;
          if (once(k, 'broke', broke)) {
            k.burst(k.at(b, 0.45), 26, { kind: 'shard', colour: [STEEL, k.pal.main, k.pal.deep], size: 1.8, life: [0.4, 0.8], speed: [0.4, 1.2], up: [6, 20], gravity: 60, drag: 0.3, spin: 3 });
            k.burst(k.at(b, 0.45), 10, { kind: 'spark', size: 1.6, life: [0.2, 0.4], speed: [0.5, 1.2], up: [0, 12], gravity: 30 });
          }
          const heart = k.at(b, 0.48);
          let i = 0;
          for (const s of stakes(b)) {
            post(k, s, 6 * up * (broke ? fade : 1), { wide: 0.8, cap: 1.4, glow: 0.5 });
            // The creature straining: each chain shivers as it pulls, out of step with the rest.
            const strain = Math.max(0, Math.sin(age * 5.3 + i * 1.9)) * 0.9;
            const top = k.on(s.x, s.y, 6 * up);
            const end = mid3(top, heart, reach);
            if (!broke) chain(k, top, end, { sag: 0.4 + strain, alpha: reach, link: 3 });
            i++;
          }
          if (!broke) hoop(k, b, 0.48, Math.max(5, b.wide * 1.25), { alpha: reach, width: 1.8, colour: STEEL });
          const s0 = stakes(b)[0];
          square(k, b, Math.abs(s0.x - b.x), { band: 0.05, alpha: 0.6 * up * fade, glow: 0.4, studs: false });
          tally(k, b, footR(b), BIND_TICKS, (BIND_TICKS * left) / Math.max(0.1, BIND_LASTS), { alpha: 0.75 * up * fade });
          k.light(b, 2, 0.35 * fade);
        },
      },
    },
  },

  /*
   * Equity (on a friend: both end at the average of your healths). The priest
   * stands as a balance, arms out, tipping; over the two of them a beam hangs,
   * a hoop round each at the shoulders on its cords like a pan, tipping with
   * the body. At the release it comes level, light runs both ways along it,
   * and both hoops come down to the ground as two rings the same size.
   */
  justice_equity: {
    palette: PALETTE,
    cast: { timing: EQUITY_T, pose: equityPose },
    fx: {
      charge: (k, t) => {
        if (t >= EQUITY_T.release) return;
        const a = smooth(seg(t, 0.08, 0.24));
        if (a > 0) equityBeam(k, 0.3 * equityTip(t), a, EQUITY_PAN);
      },
      release: (k) => {
        const piv = equityPivot(k);
        k.burst(piv, 12, { kind: 'mote', size: 1.8, life: [0.3, 0.6], speed: [0.2, 0.5], up: [-4, 8], gravity: 0 });
      },
      hit: (k) => {
        for (const b of [k.caster, k.target]) k.burst(k.at(b, 0.5), 10, { kind: 'mote', size: 1.8, life: [0.4, 0.8], speed: [0.1, 0.3], up: [4, 12], gravity: 0, jitter: 0.1 });
      },
      impact: {
        secs: 1.1,
        draw: (k, u) => {
          const a = 1 - smooth(seg(u, 0.55, 1));
          equityBeam(k, 0, a, EQUITY_PAN);
          const piv = equityPivot(k);
          const flow = seg(u, 0, 0.45);
          if (flow > 0 && flow < 1) {
            const l = equityEnd(k, k.caster), r = equityEnd(k, k.target);
            for (const [p, q] of [[l, piv], [r, piv]] as const) k.orb(mid3(p, q, smooth(flow)), 2.2, { alpha: 1 - flow * 0.5, glow: 0.8 });
          }
          k.flare(piv, 9 * flashOf(seg(u, 0.4, 0.8)), flashOf(seg(u, 0.4, 0.8)), k.pal.core, 0);
          if (u > 0.6) {
            const v = seg(u, 0.6, 1);
            for (const b of [k.caster, k.target]) square(k, b, footR(b) + 0.1 * v, { band: 0.06, alpha: 0.9 * (1 - v * v), glow: 0.6, studs: false });
          }
          k.light(piv, 3, 0.6 * (1 - u));
        },
      },
    },
  },

  /*
   * Verdict (on an enemy: dies below 20%, a monster 10%; else a tenth of its
   * health). While the priest deliberates a square closes in on the ground
   * round the creature and a sword forms over it, point down; the arm goes up,
   * comes down, and the sword drops straight through the creature into the
   * ground with sparks thrown flat and cracks run out, stands a moment, and
   * goes up as light.
   */
  justice_verdict: {
    palette: PALETTE,
    cast: { timing: VERDICT_T, pose: verdictPose },
    fx: {
      charge: (k, t) => {
        const b = k.target;
        const form = smooth(seg(t, 0.3, 0.56));
        const close = smooth(seg(t, 0.16, 0.6));
        if (t >= VERDICT_T.release) return;
        square(k, b, lerp(1, footR(b) + 0.1, close), { band: 0.06, alpha: 0.85 * smooth(seg(t, 0.12, 0.3)), glow: 0.6, draw: seg(t, 0.12, 0.36) });
        if (form > 0) {
          sword(k, { x: b.x, y: b.y, z: b.z + verdictHang(k) + 3 * (1 - form) }, VERDICT_LEN, { show: form, alpha: Math.min(1, form * 1.6), glow: form });
          k.light(b, 2.5, 0.5 * form);
        }
        k.glow(k.hand(1), 5, 0.6 * bump(t, 0.36, 0.5, 0.62));
      },
      travel: {
        secs: () => 0.12,
        draw: (k, u) => {
          const b = k.target;
          const z = lerp(b.z + verdictHang(k), b.z - 3, easeIn(u));
          sword(k, { x: b.x, y: b.y, z }, VERDICT_LEN, { through: b });
          k.beam({ x: b.x, y: b.y, z: z + VERDICT_LEN * 0.95 }, { x: b.x, y: b.y, z: z + VERDICT_LEN * 0.95 + 18 * u }, { width: 1.4, alpha: 0.55, glow: 0.4 });
          square(k, b, footR(b) + 0.1, { band: 0.06, alpha: 0.85, glow: 0.6 });
        },
      },
      hit: (k) => {
        const b = k.target;
        flatSparks(k, k.at(b, 0.1), 34, 2);
        k.burst(k.at(b, 0.5), 10, { kind: 'shard', colour: [STEEL, k.pal.main], size: 1.8, life: [0.3, 0.6], speed: [0.4, 1], up: [8, 20], gravity: 60, drag: 0.3 });
        k.burst(k.at(b, 0.05), 10, { kind: 'dust', colour: '#8a7d68', size: 3.2, life: [0.4, 0.8], speed: [0.4, 0.9], up: [1, 5], gravity: 2 });
      },
      impact: {
        secs: 1.0,
        draw: (k, u) => {
          const b = k.target;
          const go = smooth(seg(u, 0.55, 1));
          sword(k, { x: b.x, y: b.y, z: b.z - 3 }, VERDICT_LEN, { through: b, alpha: 1 - go, show: 1 - 0.4 * go });
          if (once(k, 'rise', u > 0.55)) k.burst(k.at(b, 1.4), 16, { kind: 'mote', size: 1.8, life: [0.5, 0.9], speed: [0.02, 0.1], up: [10, 24], gravity: 0, jitter: 0.06, jitterZ: 10 });
          cracks(k, b, 0.9, 4, { grow: easeOut(seg(u, 0, 0.12)), alpha: 1 - smooth(seg(u, 0.5, 1)) });
          squareOut(k, b, seg(u, 0, 0.6), footR(b) + 0.3);
          square(k, b, footR(b) + 0.1, { band: 0.06, alpha: 0.85 * (1 - go), glow: 0.6 });
          k.flare(k.at(b, 0.6), 14 * flashOf(seg(u, 0, 0.35)), flashOf(seg(u, 0, 0.35)), k.pal.core, Math.PI / 4);
          k.light(b, 3.5, 0.9 * (1 - u));
        },
      },
    },
  },

  /*
   * Summons (on an enemy, 20 s, it hunts only you). The priest holds out an
   * open hand; a chain is thrown from it and its collar shuts round the
   * creature's neck; the hand shuts and hauls, the chain snaps taut and a
   * pulse runs down it to the priest. For the twenty seconds after, a chevron
   * over the creature points at the priest wherever they go, a thread of dots
   * runs from it to them, and four ticks go out at its feet.
   */
  justice_summons: {
    palette: PALETTE,
    cast: { timing: SUMMONS_T, pose: summonsPose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.12, 0.34)) * (1 - smooth(seg(t, 0.38, 0.44)));
        if (g <= 0) return;
        const h = k.hand(1);
        hoop(k, { x: h.x, y: h.y, z: h.z + 0.6, tall: 2, wide: 1, facing: 0, kind: 'spot' }, 0.5, 2.2 * g, { alpha: g, width: 1.4, colour: STEEL });
        k.glow(h, 5, 0.6 * g);
      },
      release: (k) => k.burst(k.hand(1), 6, { kind: 'spark', size: 1.6, colour: [k.pal.core, STEEL], life: [0.15, 0.3], speed: [0.4, 0.9], up: [-2, 6], heading: k.toward(k.caster, k.target), cone: 0.8, gravity: 20 }),
      travel: {
        secs: (tiles) => 0.1 + tiles * 0.04,
        draw: (k, u) => {
          const from = k.hand(1), to = k.at(k.target, 0.78);
          const head = arcAt(from, to, u, 4 + k.dist);
          chain(k, from, head, { sag: 2 * (1 - u), link: 2.8 });
          hoop(k, { x: head.x, y: head.y, z: head.z - 1, tall: 2, wide: 1, facing: 0, kind: 'spot' }, 0.5, 2.2, { width: 1.4, colour: STEEL });
        },
      },
      hit: (k) => {
        k.burst(k.at(k.target, 0.78), 14, { kind: 'spark', size: 1.8, colour: [k.pal.core, STEEL], life: [0.2, 0.4], speed: [0.5, 1.2], up: [-4, 12], gravity: 30 });
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const b = k.target;
          const collar = k.at(b, 0.78);
          const shut = easeBack(seg(u, 0, 0.18));
          hoop(k, b, 0.78, lerp(9, Math.max(3.2, b.wide * 0.9), shut), { width: 1.8, colour: STEEL, alpha: 1 - smooth(seg(u, 0.75, 1)) });
          // Hauled taut, a pulse running down it to the hand, and then it thins away into the thread that stays.
          const taut = smooth(seg(u, 0.15, 0.35));
          const hand = k.hand(1);
          chain(k, hand, collar, { sag: lerp(2.5, 0, taut), link: 2.8, alpha: 1 - smooth(seg(u, 0.6, 1)) });
          const pulse = seg(u, 0.3, 0.6);
          if (pulse > 0 && pulse < 1) k.orb(mid3(collar, hand, pulse), 2.4, { glow: 1 });
          k.light(b, 2, 0.6 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const a = smooth((age - 0.5) / 0.4) * smooth(left / 0.8);
          if (a <= 0.01) return;
          const b = k.target;
          const head = over(k, b, 4);
          const me = k.chest();
          // Nodding the way it must go, toward you, again and again.
          const dir = screenDir(k, head, me);
          const nod = easeOut((age * 1.2) % 1) * (1 - ((age * 1.2) % 1));
          const l = Math.hypot(dir[0], dir[1]) || 1;
          chevron(k, head, 7, { alpha: 0.95 * a, dir, glow: 0.7, dx: (dir[0] / l) * nod * 4 * k.zoom, dy: (dir[1] / l) * nod * 4 * k.zoom });
          const n = ticksFor(lastsOf('justice_summons'));
          tally(k, b, footR(b), n, (n * left) / Math.max(1, lastsOf('justice_summons')), { alpha: 0.55 * a });
          // The thread it follows: dots running from it to you, near enough to be worth drawing.
          const far = Math.hypot(me.x - b.x, me.y - b.y);
          if (far > 0.4 && far < 14) {
            const from = k.at(b, 0.78);
            const dots = Math.max(3, Math.min(12, Math.round(far * 2)));
            const xs: Pt[] = [];
            for (let i = 0; i < dots; i++) {
              const u = (i + ((age * 1.4) % 1)) / dots;
              const p = mid3(from, me, u);
              xs.push([k.sx(p), k.sy(p)]);
            }
            const main = k.pal.main, ink = k.pal.ink;
            k.worldDraw(far > 0 ? (from.y > me.y ? from : me) : from, (g) => {
              g.globalAlpha = 0.6 * a;
              for (const [x, y] of xs) {
                const r = Math.max(1.2, 1.3 * k.zoom);
                poly(g, [[x, y - r], [x + r * 0.8, y], [x, y + r], [x - r * 0.8, y]], main, ink, Math.max(0.6, 0.5 * k.zoom));
              }
            }, -1);
          }
        },
      },
    },
  },

  /*
   * Temper (on a thing carried, 30 minutes, it takes no wear). The priest
   * holds it across the chest and draws a palm along it: light runs with the
   * palm and drips off it like a quench; then it is lifted up, a line of light
   * goes the length of it and a seal turns over it. For the half hour after, a
   * glint runs up it every few seconds.
   */
  justice_temper: {
    palette: PALETTE,
    cast: { timing: TEMPER_T, pose: temperPose },
    fx: {
      charge: (k, t) => {
        // A band of light climbs it from the fist to its end while the priest keeps the vigil, dripping sparks as it goes.
        const climb = smooth(seg(t, 0.22, 0.58));
        const g = smooth(seg(t, 0.16, 0.26)) * (1 - smooth(seg(t, 0.6, 0.66)));
        if (g <= 0) return;
        k.glow(k.hand(0), 5, 0.5 * g);
        const at = temperAt(k, climb);
        const behindIt = temperAt(k, Math.max(0, climb - 0.3));
        k.beam(behindIt, at, { width: 2.2, alpha: g, glow: 0.8 });
        k.orb(at, 2.2, { alpha: g, glow: 1.1, sides: 6 });
        k.light(at, 1.5, 0.45 * g);
        if (climb > 0 && climb < 1) k.emit(at, 30, { kind: 'spark', size: 1.4, colour: [k.pal.core, k.pal.main], life: [0.2, 0.4], speed: [0.05, 0.25], up: [-4, 4], gravity: 60, drag: 0.2 });
      },
      release: (k) => {
        const at = temperAt(k, 1);
        k.burst(at, 18, { kind: 'spark', size: 1.6, life: [0.2, 0.45], speed: [0.3, 0.9], up: [0, 16], gravity: 40 });
        k.burst(at, 10, { kind: 'mote', size: 1.8, life: [0.4, 0.8], speed: [0.05, 0.2], up: [6, 14], gravity: 0, jitter: 0.06 });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const f = flashOf(u, 0.15);
          const a = temperAt(k, 0), b = temperAt(k, 1);
          k.beam(a, b, { width: 2.4, alpha: f, glow: 1.2 });
          lozenge(k, { ...temperAt(k, 0.5), z: temperAt(k, 0.5).z + 6 }, 4, { alpha: flashOf(u, 0.2), spin: flipTurn(u * 3), glow: 0.8 });
          k.light(a, 2, 0.6 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          // A glint up the length of it every six seconds: it is kept.
          const v = ((age - 1) % 6) / 0.6;
          if (age < 1 || v >= 1 || left < 0.5) return;
          // Up the length of it, wherever it is carried.
          k.flare(temperAt(k, smooth(v)), 4, Math.sin(Math.PI * v) * 0.8, k.pal.core, Math.PI / 4);
        },
      },
    },
  },

  /*
   * Judgment (6 tiles round a spot: every hunting creature there loses 15%
   * and takes 15% more for 30 s). A graduated ring draws itself on at the
   * reach and swords form high over every creature standing in it (and over
   * bare ground where there are fewer), point down; the priest's arms come
   * down pointing and the swords fall one after another through them, each
   * planting itself with sparks and a square knocked out, stand, and go up.
   * Every creature struck then carries a small seal and its tally for the
   * thirty seconds it takes more damage.
   */
  justice_judgment: {
    palette: PALETTE,
    cast: { timing: JUDGMENT_T, pose: judgmentPose },
    fx: {
      release: (k) => {
        for (const s of [0, 1] as const) k.burst(k.hand(s), 6, { kind: 'mote', size: 1.8, life: [0.2, 0.4], speed: [0.2, 0.6], up: [-12, -2], gravity: 0 });
      },
      charge: (k, t) => {
        const n = judgmentSwords(k);
        const on = t > 0.2 ? judged(k) : [];
        tally(k, k.spot, JUDGMENT_R, 24, 24, { grow: seg(t, 0.1, 0.56), alpha: 0.8, tick: 0.3 });
        // Hung there until the arms come down; from the release the impact holds them and lets them fall.
        for (let i = 0; i < n && t < JUDGMENT_T.release; i++) {
          const form = smooth(seg(t, 0.22 + i * 0.03, 0.42 + i * 0.03));
          if (form <= 0) continue;
          const at = judgmentAt(k, i, n, on);
          sword(k, k.on(at.x, at.y, 56 + 6 * hashOf(k.seed + 3, i) + Math.sin(k.now * 2 + i) * 0.8), JUDGMENT_SWORD, { show: form, alpha: Math.min(1, form * 1.5), glow: 0.5 });
        }
        k.light(k.spot, JUDGMENT_R * 0.6, 0.5 * seg(t, 0.2, 0.58));
      },
      impact: {
        secs: JUDGMENT_IMPACT,
        draw: (k, u) => {
          const secs = u * JUDGMENT_IMPACT;
          const n = judgmentSwords(k);
          const on = judged(k);
          for (let i = 0; i < n; i++) {
            const at = judgmentAt(k, i, n, on);
            const body = on[i] ?? null;
            const t0 = judgmentFall(i), fall = 0.14;
            const hang = 56 + 6 * hashOf(k.seed + 3, i);
            const v = clamp((secs - t0) / fall);
            const after = secs - t0 - fall;
            const go = smooth(clamp((after - 0.7) / 0.5));
            const z = lerp(hang, -2, easeIn(v));
            // On a creature, through it; on bare ground, into it.
            sword(k, k.on(at.x, at.y, z), JUDGMENT_SWORD, { alpha: 1 - go, glow: 0.6, through: body });
            if (once(k, `j${i}`, v >= 1)) {
              flatSparks(k, k.on(at.x, at.y, 1), 10, 1.2);
              if (body) k.burst(k.at(body, 0.6), 8, { kind: 'shard', colour: [STEEL, k.pal.main], size: 1.6, life: [0.3, 0.6], speed: [0.3, 0.8], up: [6, 16], gravity: 60, drag: 0.3 });
              k.burst(k.on(at.x, at.y, 0.5), 4, { kind: 'dust', colour: '#8a7d68', size: 2.8, life: [0.4, 0.7], speed: [0.3, 0.6], up: [1, 4], gravity: 2 });
            }
            if (after > 0) squareOut(k, at, clamp(after / 0.5), 0.36, 0.85);
          }
          tally(k, k.spot, JUDGMENT_R, 24, 24, { alpha: 0.8 * (1 - smooth(seg(u, 0.5, 1))), tick: 0.3 });
          k.light(k.spot, JUDGMENT_R * 0.7, 0.8 * (1 - smooth(seg(u, 0.3, 1))));
        },
      },
      // Each creature it came down on carries the seal of a judged thing -- Mark of Judgment's, smaller -- and its tally,
      // for the seconds it takes more damage.
      linger: {
        on: 'spot',
        draw: (k, age, left) => {
          const lasts = lastsOf('justice_judgment');
          let i = 0;
          for (const b of judged(k)) {
            const t0 = judgmentFall(i++) + 0.3;
            const a = smooth((age - t0) / 0.3) * smooth(left / 0.8);
            if (!b || a <= 0.01) continue;
            lozenge(k, over(k, b, 3 + 0.5 * Math.sin(age * 1.6 + i)), 4, { alpha: 0.85 * a, spin: flipTurn(age / 2.5 + i * 0.3), glow: 0.5 });
            tally(k, b, footR(b), JUDGMENT_TICKS, (JUDGMENT_TICKS * left) / Math.max(1, lasts), { alpha: 0.5 * a, ring: false });
          }
        },
      },
    },
  },

  /*
   * Truce (8 tiles round a spot, 30 s, nothing there strikes or is struck).
   * A palisade of pale stakes rises out of the ground round exactly the eight
   * tiles; a sword comes gently down at the spot and stands planted there,
   * hilt up -- peace-bonded -- with the light washing out over the ground,
   * and everyone inside gets a cord of the bond round the waist. As the
   * thirty seconds go the stakes go down into the ground one by one, and
   * when the last is down the sword lifts away.
   */
  justice_truce: {
    palette: PALETTE,
    cast: { timing: TRUCE_T, pose: trucePose },
    fx: {
      release: (k) => {
        for (const s of [0, 1] as const) k.burst(k.hand(s), 5, { kind: 'mote', size: 1.6, life: [0.4, 0.7], speed: [0.05, 0.2], up: [-6, 0], gravity: 0 });
      },
      charge: (k, t) => {
        if (t >= TRUCE_T.release) return;
        pales(k, 0, seg(t, 0.12, 0.6), 1);
        k.ring(k.spot, TRUCE_R, { band: 0.06, alpha: 0.6 * smooth(seg(t, 0.3, 0.6)), glow: 0.4 });
        k.light(k.spot, 3, 0.4 * seg(t, 0.2, 0.5));
      },
      travel: {
        secs: () => 0.55,
        draw: (k, u) => {
          pales(k, 0, 1, 1);
          k.ring(k.spot, TRUCE_R, { band: 0.06, alpha: 0.6, glow: 0.4 });
          sword(k, k.on(k.spot.x, k.spot.y, lerp(40, -3, easeOut(u))), TRUCE_SWORD, { alpha: smooth(u * 4), through: standingAt(k, k.spot) });
          k.light(k.spot, 3, 0.6);
        },
      },
      hit: (k) => {
        k.burst(k.on(k.spot.x, k.spot.y, 1), 30, { kind: 'mote', size: 1.8, life: [0.6, 1.2], speed: [0.4, TRUCE_R * 0.25], up: [4, 12], gravity: 0, drag: 0.3 });
      },
      impact: {
        secs: 1.4,
        draw: (k, u) => {
          const v = easeOut(seg(u, 0, 0.8));
          k.ring(k.spot, 0.3 + (TRUCE_R - 0.3) * v, { band: 0.12 * (1 - v) + 0.03, alpha: 0.8 * (1 - v * v), glow: 0.6 });
          k.light(k.spot, TRUCE_R * 0.8, 0.6 * (1 - u));
        },
      },
      linger: {
        on: 'spot',
        draw: (k, age, left) => {
          const end = smooth(left / 1.2);
          pales(k, age, 1, 1);
          k.ring(k.spot, TRUCE_R, { band: 0.05, alpha: 0.45 * end, glow: 0.3, dash: 2 });
          // Everyone inside, people and creatures, with a peace-bond round them: a cord at the waist. The nearest few only, so a
          // crowd costs no more than a handful.
          const inside = k.bodiesWithin(TRUCE_R).sort((a, b) => Math.hypot(a.x - k.spot.x, a.y - k.spot.y) - Math.hypot(b.x - k.spot.x, b.y - k.spot.y));
          for (const b of inside.slice(0, TRUCE_BONDS)) hoop(k, b, 0.45, Math.max(5, b.wide * 1.5), { alpha: 0.55 * end * smooth((age - 0.4) / 0.6), width: 1.1 });
          const lift = 1 - end;
          sword(k, k.on(k.spot.x, k.spot.y, -3 + 20 * easeIn(lift)), TRUCE_SWORD, { alpha: end, through: standingAt(k, k.spot) });
          // The peace-bond: a cord tied round the guard of the planted sword.
          const g = k.on(k.spot.x, k.spot.y, -3 + TRUCE_SWORD * 0.72 + 20 * easeIn(lift));
          hoop(k, { x: g.x, y: g.y, z: g.z - 1, tall: 2, wide: 1, facing: 0, kind: 'spot' }, 0.5, 2.6, { alpha: end * smooth((age - 0.3) / 0.4), width: 1.2 });
          k.light(k.spot, 3, 0.35 * end);
          if (!k.fast) k.emit(k.on(k.spot.x, k.spot.y, 1), 3 * end, { kind: 'mote', size: 1.5, life: [1, 1.8], speed: [0.02, 0.08], up: [4, 9], gravity: 0, jitter: TRUCE_R * 0.6 });
        },
      },
    },
  },

  /*
   * Restitution (on oneself or a friend: the latest grave's things come back
   * to their pack). The priest waits with cupped hands; behind whoever it is
   * on a grave-stone rises out of the ground, and one by one the things come
   * up out of it and arc over into their pack, each with a glint as it goes
   * in; the hands close on the heart and the stone sinks away.
   */
  justice_restitution: {
    palette: PALETTE,
    cast: { timing: RESTITUTION_T, pose: restitutionPose },
    fx: {
      charge: (k, t) => {
        if (t >= RESTITUTION_T.release) return;
        const up = smooth(seg(t, 0.1, 0.46));
        const grave = restitutionGrave(k);
        post(k, grave, 11 * up, { wide: 3.2, cap: 3.2, glow: 0.8 });
        square(k, grave, 0.3, { band: 0.05, alpha: up * 0.8, glow: 0.4, draw: seg(t, 0.06, 0.3), studs: false });
        if (up > 0 && up < 1) k.emit(k.on(grave.x, grave.y, 0.5), 18, { kind: 'dust', colour: '#8a7d68', size: 2.4, life: [0.3, 0.6], speed: [0.1, 0.4], up: [1, 4], gravity: 2, jitter: 0.12 });
        k.glow(mid3(k.hand(0), k.hand(1), 0.5), 5, 0.5 * seg(t, 0.2, 0.46));
      },
      impact: {
        secs: RESTITUTION_IMPACT,
        draw: (k, u) => {
          const grave = restitutionGrave(k);
          const sink = smooth(seg(u, 0.75, 1));
          post(k, grave, 11 * (1 - sink), { wide: 3.2, cap: 3.2, glow: 0.8 });
          square(k, grave, 0.3, { band: 0.05, alpha: 0.8 * (1 - sink), glow: 0.4, studs: false });
          const b = k.target;
          const pack = k.local(b, 0, -2.5, b.tall * 0.62);
          const secs = u * RESTITUTION_IMPACT;
          for (let i = 0; i < RESTITUTION_GOODS; i++) {
            const t0 = 0.05 + i * 0.13, v = (secs - t0) / 0.5;
            if (once(k, `in${i}`, v >= 1)) {
              k.burst(pack, 4, { kind: 'mote', size: 1.6, life: [0.2, 0.4], speed: [0.1, 0.3], up: [2, 8], gravity: 0 });
              k.state.glint = secs;
            }
            if (v <= 0 || v >= 1) continue;
            const from = k.on(grave.x, grave.y, 13);
            box(k, arcAt(from, pack, easeOut(v) * 0.4 + v * 0.6, 7), 2.6, { spin: flipTurn(v * 2 + i), alpha: Math.min(1, v * 5) });
          }
          const since = secs - (k.state.glint ?? -9);
          k.flare(pack, 5 * flashOf(clamp(since / 0.3)), flashOf(clamp(since / 0.3)), k.pal.core, Math.PI / 4);
          k.light(grave, 2, 0.5 * (1 - sink));
          k.light(b, 2, 0.4 * (1 - u));
        },
      },
    },
  },

  /*
   * Execution (on an enemy: dies below 50%, a monster 30%; else a fifth of its
   * health). The priest's joined hands go up and up, on the toes, trembling,
   * and over the creature a great sword draws itself on, point down, in a
   * square closing round it; the whole body bows and the sword comes down
   * through it, the ground cracking out square and white, and stands there a
   * moment before it breaks apart.
   */
  justice_execution: {
    palette: PALETTE,
    cast: { timing: EXECUTION_T, pose: executionPose },
    fx: {
      release: (k) => {
        const h = mid3(k.hand(0), k.hand(1), 0.5);
        k.burst(h, 14, { kind: 'spark', size: 1.8, life: [0.15, 0.35], speed: [0.4, 1], up: [-20, 4], gravity: 40 });
      },
      charge: (k, t) => {
        if (t >= EXECUTION_T.release) return;
        const b = k.target;
        const form = smooth(seg(t, 0.14, 0.5));
        const close = smooth(seg(t, 0.1, 0.62));
        square(k, b, lerp(1.5, footR(b) + 0.2, close), { band: 0.08, alpha: 0.95 * smooth(seg(t, 0.08, 0.2)), glow: 0.9, draw: seg(t, 0.08, 0.3) });
        square(k, b, lerp(1.0, footR(b) + 0.06, close), { band: 0.035, alpha: 0.6 * smooth(seg(t, 0.2, 0.32)), glow: 0, studs: false });
        if (form > 0) {
          const hang = b.tall + 36 + 4 * (1 - form);
          sword(k, { x: b.x, y: b.y, z: b.z + hang }, EXECUTION_LEN, { show: form, alpha: Math.min(1, form * 1.4), glow: 0.6 + 0.6 * form });
          k.emit({ x: b.x, y: b.y, z: b.z + hang + EXECUTION_LEN * 0.3 }, 30 * form, { kind: 'mote', size: 1.8, life: [0.4, 0.7], speed: [0.3, 0.6], up: [-4, 4], gravity: 0, drag: 0.02, jitter: 0.5, jitterZ: 12 });
          k.light(b, 3.5, 0.7 * form);
        }
        k.glow(mid3(k.hand(0), k.hand(1), 0.5), 6, 0.7 * bump(t, 0.3, 0.55, 0.64));
      },
      travel: {
        secs: () => 0.13,
        draw: (k, u) => {
          const b = k.target;
          const z = lerp(b.z + b.tall + 36, b.z - 8, easeIn(u));
          sword(k, { x: b.x, y: b.y, z }, EXECUTION_LEN, { through: b, glow: 1.2 });
          k.beam({ x: b.x, y: b.y, z: z + EXECUTION_LEN * 0.95 }, { x: b.x, y: b.y, z: z + EXECUTION_LEN * 0.95 + 40 * u }, { width: 2.2, alpha: 0.6, glow: 0.5 });
          square(k, b, footR(b) + 0.2, { band: 0.08, alpha: 0.95, glow: 0.9 });
        },
      },
      hit: (k) => {
        const b = k.target;
        k.flash(0.22);
        flatSparks(k, k.at(b, 0.1), 60, 3);
        k.burst(k.at(b, 0.5), 24, { kind: 'shard', colour: [STEEL, k.pal.main, k.pal.deep], size: 2.4, life: [0.5, 1], speed: [0.6, 1.6], up: [10, 30], gravity: 60, drag: 0.3, spin: 2 });
        k.burst(k.at(b, 0.05), 20, { kind: 'dust', colour: '#8a7d68', size: 4, life: [0.6, 1.1], speed: [0.6, 1.4], up: [1, 6], gravity: 2, drag: 0.1 });
      },
      impact: {
        secs: 1.8,
        draw: (k, u) => {
          const b = k.target;
          const secs = u * 1.8;
          const shatter = secs > 1.0;
          if (once(k, 'shatter', shatter)) {
            for (let i = 0; i < 4; i++) k.burst({ x: b.x, y: b.y, z: b.z + 6 + i * 10 }, 10, { kind: 'shard', colour: [k.pal.core, STEEL, k.pal.main], size: 2.2, life: [0.4, 0.8], speed: [0.4, 1.1], up: [0, 14], gravity: 40, drag: 0.3, spin: 3 });
            k.burst(k.at(b, 1.5), 20, { kind: 'mote', size: 2, life: [0.5, 1], speed: [0.2, 0.6], up: [4, 18], gravity: 0, jitterZ: 16 });
          }
          if (!shatter) sword(k, { x: b.x, y: b.y, z: b.z - 8 }, EXECUTION_LEN, { through: b, glow: 1 - 0.5 * u });
          cracks(k, b, 1.6, 8, { grow: easeOut(seg(u, 0, 0.08)), alpha: 1 - smooth(seg(u, 0.55, 1)) });
          squareOut(k, b, seg(u, 0, 0.45), 1.3);
          squareOut(k, b, seg(u, 0.1, 0.6), 0.8, 0.7);
          square(k, b, footR(b) + 0.2, { band: 0.08, alpha: 0.95 * (1 - smooth(seg(u, 0.5, 0.8))), glow: 0.9 });
          const f = flashOf(seg(u, 0, 0.3));
          k.flare(k.at(b, 0.6), 24 * f, f, k.pal.core, Math.PI / 4);
          k.light(b, 5, 1 - 0.8 * u);
        },
      },
    },
  },

  /*
   * Oath (on a friend, 10 minutes, every blow on either split between you).
   * A hand raised and sworn, a seal at the palm; it is held out to the friend
   * and a cord of two strands twists out from heart to heart, a knot of two
   * linked seals over its middle. For the ten minutes after, a pair of linked
   * seals hangs over each of the two and a faint cord joins them when near.
   */
  justice_oath: {
    palette: PALETTE,
    cast: { timing: OATH_T, pose: oathPose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.18, 0.4)) * (1 - smooth(seg(t, 0.52, 0.6)));
        if (g <= 0) return;
        const h = k.hand(1);
        lozenge(k, { x: h.x, y: h.y, z: h.z + 4 }, 4 * g, { alpha: g, glow: 1 });
        k.light(h, 1.5, 0.4 * g);
      },
      travel: {
        secs: (tiles) => 0.2 + tiles * 0.06,
        draw: (k, u) => {
          braid(k, k.chest(), k.chest(k.target), 3, k.now * 8, { to: easeOut(u) });
        },
      },
      hit: (k) => {
        for (const b of [k.caster, k.target]) k.burst(k.chest(b), 8, { kind: 'mote', size: 1.8, life: [0.3, 0.6], speed: [0.1, 0.4], up: [0, 10], gravity: 0 });
      },
      impact: {
        secs: OATH_IMPACT,
        draw: (k, u) => {
          const a = k.chest(), b = k.chest(k.target);
          braid(k, a, b, 3 * (1 - 0.6 * smooth(u)), k.now * 8 * (1 - u), { alpha: 1 - smooth(seg(u, 0.6, 1)) });
          const mid = mid3(a, b, 0.5);
          sworn(k, { ...mid, z: mid.z + 4 + 4 * smooth(u) }, 5, flashOf(u, 0.15), snapTurn(u * 2));
          for (const p of [a, b]) k.flare(p, 6 * flashOf(seg(u, 0, 0.4)), flashOf(seg(u, 0, 0.4)), k.pal.core, Math.PI / 4);
          k.light(mid, 2.5, 0.5 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const a = smooth((age - OATH_IMPACT * 0.7) / 0.5) * smooth(left / 1.5);
          if (a <= 0.01) return;
          for (const b of [k.caster, k.target]) sworn(k, over(k, b, 4), 3.4, 0.7 * a, snapTurn(age / 4));
          const p = k.chest(), q = k.chest(k.target);
          const far = Math.hypot(p.x - q.x, p.y - q.y);
          if (far < 12) {
            // Every five seconds a pulse along the cord between them: the burden shared.
            const v = (age % 5) / 0.8;
            braid(k, p, q, 1.6, age * 0.6, { alpha: 0.22 * a + (v < 1 ? 0.3 * Math.sin(Math.PI * v) * a : 0) });
          }
        },
      },
    },
  },

  /*
   * Due Reward (on oneself or a friend, 30 minutes, every skill gains 20%
   * more). The hands rise up the body and open; a seal comes down over whoever
   * it is on, and rank on rank of chevrons climbs up them from their feet and
   * stacks over the head while a tally of ticks lights up round their feet,
   * counting up rather than down. For the half hour after, a small chevron
   * rises over their head now and then.
   */
  justice_reward: {
    palette: PALETTE,
    cast: { timing: REWARD_T, pose: rewardPose },
    fx: {
      charge: (k, t) => {
        if (t >= REWARD_T.release) return;
        const g = smooth(seg(t, 0.32, 0.56));
        if (g <= 0) return;
        const p = mid3(k.hand(0), k.hand(1), 0.5);
        lozenge(k, { ...p, z: p.z + 3 }, 3 + 2 * g, { alpha: g, spin: flipTurn(t * 4), glow: 1 });
        k.light(p, 1.6, 0.4 * g);
      },
      travel: {
        secs: (tiles) => (tiles < 0.3 ? 0 : 0.2 + tiles * 0.05),
        draw: (k, u) => {
          const from = k.head(), to = over(k, k.target, 8);
          const p = arcAt(from, to, smooth(u), 6 + k.dist * 2);
          lozenge(k, p, 4.6, { spin: flipTurn(u * 4), glow: 1 });
          k.light(p, 1.6, 0.4);
        },
      },
      hit: (k) => k.burst(over(k, k.target, 8), 12, { kind: 'mote', size: 1.8, life: [0.4, 0.7], speed: [0.1, 0.4], up: [-6, 8], gravity: 0 }),
      impact: {
        secs: REWARD_IMPACT,
        draw: (k, u) => {
          const b = k.target;
          const secs = u * REWARD_IMPACT;
          for (let i = 0; i < REWARD_RANKS; i++) {
            const v = clamp((secs - 0.1 - i * 0.14) / 0.5);
            if (v <= 0) continue;
            // Up from the feet to a stack over the head, the first ending highest.
            const top = b.tall + 4 + (REWARD_RANKS - 1 - i) * 3.4;
            const z = lerp(1, top, easeOut(v));
            chevron(k, { x: b.x, y: b.y, z: b.z + z }, 6 - i * 0.4, { alpha: Math.min(1, v * 4) * (1 - smooth(seg(u, 0.75, 1))), glow: 0.6 });
          }
          lozenge(k, over(k, b, 8), 4.6 * (1 - smooth(seg(u, 0.1, 0.4))), { alpha: 1 - seg(u, 0.1, 0.4), glow: 1 });
          const n = 12;
          tally(k, b, footR(b) + 0.05, n, n * easeOut(seg(u, 0.1, 0.7)), { alpha: 0.8 * (1 - smooth(seg(u, 0.75, 1))) });
          k.light(b, 2.5, 0.6 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          if (age < REWARD_IMPACT || left < 0.5) return;
          // Every four seconds a small rank rises over the head and fades: the half hour of gain, quietly.
          const v = ((age - REWARD_IMPACT) % 4) / 1.6;
          if (v >= 1) return;
          chevron(k, over(k, k.target, 3 + 5 * easeOut(v)), 3.2, { alpha: 0.6 * Math.sin(Math.PI * v), glow: 0.5 });
        },
      },
    },
  },
};

/** Where Equity's pans hang: under the feet of the two of them, each stood in one. */
const EQUITY_PAN = 0.04;

/* ---- Equity's balance ---------------------------------------------------------------------- */

/** Where Equity's beam pivots: over the middle of the two of them, higher than either head. */
function equityPivot(k: FxScene): P3 {
  const a = k.caster, b = k.target;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: Math.max(a.z + a.tall, b.z + b.tall) + 10 };
}
/** One end of Equity's beam: over a body's head. */
function equityEnd(k: FxScene, b: Body, tilt = 0): P3 {
  const p = equityPivot(k);
  const s = b === k.caster ? -1 : 1;
  // Tipped by height at its ends rather than by angle, so a friend far off is not swung up out of sight.
  return { x: b.x, y: b.y, z: p.z + s * tilt * 30 };
}
/** Equity's beam, tipped `tilt`, a hoop round each of the two at `share` of their height hung from its ends on three cords. */
function equityBeam(k: FxScene, tilt: number, alpha: number, share: number): void {
  if (alpha <= 0.01) return;
  const piv = equityPivot(k);
  const ends = [equityEnd(k, k.caster, tilt), equityEnd(k, k.target, tilt)];
  k.beam(ends[0], ends[1], { width: 2, alpha, glow: 0.6 });
  lozenge(k, piv, 4, { alpha, glow: 0.8 });
  k.beam({ ...piv, z: piv.z + 1 }, { ...piv, z: piv.z + 14 }, { width: 1, alpha: alpha * 0.6, glow: 0.3 });
  [k.caster, k.target].forEach((b, i) => {
    const r = Math.max(7, b.wide * 2);
    const pts = hoop(k, b, share, r, { alpha, width: 1.8 });
    const e = ends[i];
    const ex = k.sx(e), ey = k.sy(e);
    const n = pts.length;
    // Three cords from the beam's end down to the pan, those on the far side of the body behind it and the near ones before it.
    const picks = [pts[Math.round(n / 12)], pts[Math.round((5 * n) / 12)], pts[Math.round((9 * n) / 12) % n]];
    const mid = k.sy(k.at(b, share));
    const { main, ink } = k.pal;
    for (const front of [false, true]) {
      k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
        g.globalAlpha = clamp(alpha * 0.9);
        g.beginPath();
        for (const [x, y] of picks) {
          if (y > mid !== front) continue;
          g.moveTo(ex, ey);
          g.lineTo(x, y);
        }
        g.strokeStyle = ink;
        g.lineWidth = Math.max(1.4, 1.5 * k.zoom);
        g.stroke();
        g.strokeStyle = main;
        g.lineWidth = Math.max(0.7, 0.7 * k.zoom);
        g.stroke();
      }, front ? 3 : -3);
    }
  });
}

/** Along the thing Temper is cast on, nought at the fist and one at its far end, wherever it is carried; between the hands when nothing is held. */
function temperAt(k: FxScene, u: number): P3 {
  const grip = k.joint(k.caster, 'grip'), tip = k.joint(k.caster, 'tip');
  // With nothing held the two are the same fist.
  if (Math.hypot((tip.x - grip.x) * 40, (tip.y - grip.y) * 40, tip.z - grip.z) < 1.5) return mid3(k.hand(1), k.hand(0), u * 0.5);
  return mid3(grip, tip, u);
}
