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
  arcAt, bump, clamp, dry, easeBack, easeIn, easeOut, flashOf, hashOf, lateFade, lerp, mid3, seg, smooth, TAU,
  type Body, type FxScene, type GroundLayer, type P3, type ShapePiece, type SpellPalette,
} from './kit';
import { armToward, type HandShape } from '../figure';
import { armOut, euler, one } from './poses';

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

/** A body's box on the screen, feet to a little over its head (`up` of its height): what a sword in front of it must not hide. */
function screenBox(k: FxScene, b: Body, up = 1.35): [number, number, number, number] {
  const x = k.sx(b), w = k.hpx(Math.max(5, b.wide * 1.2));
  return [x - w, k.sy(k.at(b, up)), x + w, k.sy({ x: b.x, y: b.y, z: b.z }) + k.px(2)];
}
/** Whether a thing sorted where `p` stands is drawn over `b`: nearer the viewer on the ground. */
const sortsOver = (k: FxScene, p: { x: number; y: number }, b: Body): boolean =>
  k.eye.worldToScreenY(p.x, p.y, 0) > k.eye.worldToScreenY(b.x, b.y, 0);
/**
 * Draw with `draw` at `a`, but where it passes over `box` (screen pixels) at under half that: a great blade hung or
 * planted between the viewer and the priest lets the priest's performance show through it rather than covering it.
 */
function thinOver(g: CanvasRenderingContext2D, box: readonly number[] | null, a: number, draw: (g: CanvasRenderingContext2D) => void): void {
  if (!box) {
    g.globalAlpha = clamp(a);
    draw(g);
    return;
  }
  const [x0, y0, x1, y1] = box;
  g.save();
  g.beginPath();
  g.rect(-1e5, -1e5, 2e5, 2e5);
  g.rect(x0, y0, x1 - x0, y1 - y0);
  g.clip('evenodd');
  g.globalAlpha = clamp(a);
  draw(g);
  g.restore();
  g.save();
  g.beginPath();
  g.rect(x0, y0, x1 - x0, y1 - y0);
  g.clip();
  g.globalAlpha = clamp(a * 0.45);
  draw(g);
  g.restore();
}

/** A sword's measures on the screen, from `U` pixels point to pommel: blade, its half-width, guard, grip, pommel. */
const swordSizes = (U: number) => ({ L: U * 0.72, bw: U * 0.05, gw: U * 0.17, gh: U * 0.03, G: U * 0.16, pr: U * 0.05 });

/**
 * Paint a sword upright with its point at (x, y), `U` pixels long: a long point, then straight to the guard, the lit
 * half on the left and a deep fuller down the middle; the guard, the grip and a lozenge pommel. `sheath` (Truce's)
 * puts the lower blade in a deep scabbard with a steel chape and binds the hilt to its throat with a pale cord, wound
 * crosswise and tied off, its ends hanging: a sword that is not to be drawn.
 */
function paintSword(g: CanvasRenderingContext2D, k: FxScene, x: number, y: number, U: number, sheath = false): void {
  const { L, bw, gw: gw0, gh, G, pr } = swordSizes(U);
  const { core, main, deep, ink } = k.pal;
  const iw = inkOf(k) * 1.1;
  g.lineJoin = 'miter';
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
  const gy0 = y - L;
  // Sheathed, the guard broader, so the cross of a sword over its scabbard is what reads first at play size.
  const gw = sheath ? gw0 * 1.3 : gw0;
  if (sheath) {
    // The scabbard over all but a hand of the blade, hardly broader than the blade in it: deep, its lit edge a line of
    // main, a steel chape at its foot and a band at its throat.
    const sw = bw * 1.15, top = gy0 + L * 0.1, foot = y + bw * 0.6;
    poly(g, [[x - sw, top], [x + sw, top], [x + sw, foot - sw * 1.6], [x, foot], [x - sw, foot - sw * 1.6]], deep, ink, iw);
    poly(g, [[x - sw, top], [x - sw * 0.35, top], [x - sw * 0.35, foot - sw * 1.2], [x - sw, foot - sw * 1.6]], SHEATH_LIT, null);
    poly(g, [[x - sw, foot - sw * 3.4], [x + sw, foot - sw * 3.4], [x + sw, foot - sw * 1.6], [x, foot], [x - sw, foot - sw * 1.6]], STEEL, ink, iw);
    poly(g, [[x - sw * 1.1, top], [x + sw * 1.1, top], [x + sw * 1.1, top + sw * 1.1], [x - sw * 1.1, top + sw * 1.1]], main, ink, iw);
    // The peace-bond: a cord from the grip to the scabbard's throat, wound crosswise twice, and its two ends hanging from
    // the guard with a tassel each -- under the guard and the grip, so the hilt reads over it.
    const cw = Math.max(1.4, bw * 0.55);
    const wraps: Pt[][] = [
      [[x - bw * 1.2, gy0 - gh - G * 0.7], [x + bw * 1.6, top + bw * 1.2]],
      [[x + bw * 1.2, gy0 - gh - G * 0.7], [x - bw * 1.6, top + bw * 1.2]],
      [[x - bw * 1.2, gy0 - gh - G * 0.25], [x + bw * 1.2, gy0 - gh - G * 0.45]],
    ];
    const tails: Pt[][] = [
      [[x - gw * 0.55, gy0 + gh], [x - gw * 0.62, gy0 + L * 0.2], [x - gw * 0.5, gy0 + L * 0.3]],
      [[x + gw * 0.5, gy0 + gh], [x + gw * 0.58, gy0 + L * 0.16], [x + gw * 0.7, gy0 + L * 0.25]],
    ];
    g.lineCap = 'round';
    for (const [w, colour] of [[cw + Math.max(1.2, k.zoom * 0.9), ink], [cw, CORD]] as const) {
      g.lineWidth = w;
      g.strokeStyle = colour;
      g.beginPath();
      for (const run of [...wraps, ...tails]) {
        g.moveTo(run[0][0], run[0][1]);
        for (let i = 1; i < run.length; i++) g.lineTo(run[i][0], run[i][1]);
      }
      g.stroke();
    }
    g.lineCap = 'butt';
    for (const run of tails) {
      const [tx, ty] = run[run.length - 1], r = cw * 1.5;
      poly(g, [[tx, ty - r * 0.4], [tx - r * 0.7, ty + r * 0.9], [tx + r * 0.7, ty + r * 0.9]], CORD, ink, iw * 0.8);
    }
  }
  poly(g, [[x - gw, gy0], [x - gw * 0.8, gy0 - gh], [x + gw * 0.8, gy0 - gh], [x + gw, gy0], [x + gw * 0.8, gy0 + gh], [x - gw * 0.8, gy0 + gh]], main, ink, iw);
  poly(g, [[x - gw * 0.8, gy0 - gh], [x + gw * 0.8, gy0 - gh], [x + gw, gy0], [x - gw, gy0]], core, null);
  poly(g, [[x - bw * 0.55, gy0 - gh], [x + bw * 0.55, gy0 - gh], [x + bw * 0.55, gy0 - gh - G], [x - bw * 0.55, gy0 - gh - G]], deep, ink, iw);
  const py = gy0 - gh - G - pr;
  poly(g, [[x, py - pr], [x - pr * 0.75, py], [x, py + pr], [x + pr * 0.75, py]], core, ink, iw);
}
/** Truce's scabbard: its lit edge. */
const SHEATH_LIT = '#6a78c4';
/** The cord of a peace-bond: undyed, paler than the light, so it shows against steel and scabbard alike. */
const CORD = '#efe6cf';

/**
 * The sword of judgment: a broad straight blade of light, point down, `len` height units from point to pommel,
 * upright on the screen whatever the turn of the view, because what it means is "down". `show` draws it on from the
 * pommel down; the part of it under the ground is never drawn, so a planted sword stands in the earth. Driven
 * `through` a body, the part above the body's head is drawn in front of it and the rest behind, so it reads as
 * through the body and not over it. `clear` is a body (the priest) it must not hide: where it is drawn over them, it
 * is drawn thin. `sheath`: Truce's, sheathed and bound, the one sword of Justice that is not a blow.
 */
function sword(k: FxScene, tip: P3, len: number, o: { alpha?: number; glow?: number; show?: number; through?: Body | null; bias?: number; clear?: Body | null; sheath?: boolean } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || len <= 0) return;
  const x = k.sx(tip), y = k.sy(tip), U = k.hpx(len);
  const { L, gw, gh, G, pr } = swordSizes(U);
  const top = y - L - gh - G - 2 * pr;
  const showTo = top + (y - top) * clamp(o.show ?? 1);
  const ground = k.on(tip.x, tip.y);
  const gy = k.sy(ground);
  const b = o.through;
  // Thin where it covers the priest: only when it is drawn over them, and only if the two overlap at all.
  let box: readonly number[] | null = null, litBox: readonly number[] | null = null;
  const c = o.clear;
  if (c) {
    const bx = screenBox(k, c);
    if (bx[0] < x + gw && bx[2] > x - gw && bx[1] < Math.min(gy, y) && bx[3] > top) {
      // Its light goes over everything after dark, so it is kept off the priest from either side; the blade itself only
      // from the near side.
      litBox = bx;
      if (sortsOver(k, b ?? ground, c)) box = bx;
    }
  }
  const clipped = (lo: number, hi: number) => (g: CanvasRenderingContext2D): void => {
    const h = Math.min(hi, showTo, gy + 0.5);
    if (h <= lo) return;
    g.beginPath();
    g.rect(x - U, lo, 2 * U, h - lo);
    g.clip();
    thinOver(g, box, a, (g) => paintSword(g, k, x, y, U, o.sheath));
  };
  if (b) {
    const foot: P3 = { x: b.x, y: b.y, z: b.z };
    const crown = k.sy(k.at(b, 0.92));
    k.worldDraw(foot, clipped(top - 4, crown), 4);
    k.worldDraw(foot, clipped(crown, gy + 1), -4);
  } else k.worldDraw(ground, clipped(top - 4, gy + 1), o.bias ?? 1);
  const gl = o.glow ?? 1;
  // One glow, at the guard, where a sword of light is brightest.
  if (gl > 0 && y - L > showTo - 1) k.glow({ x: tip.x, y: tip.y, z: tip.z + len * 0.72 }, len * 0.5, a * gl * 0.5 * clamp(o.show ?? 1));
  // After dark, its light down the blade as well: a sword of light hung over the field reads bright, not grey.
  const lit = k.night * 0.45 * a * Math.min(1, gl) * smooth(seg(o.show ?? 1, 0.6, 1));
  if (lit > 0.02) {
    const light = k.pal.light, w = U * 0.09, from = Math.min(y, gy), to = y - L;
    k.glowDraw((g) => {
      // Not over the priest: where the blade is thinned over them its light is left off altogether.
      if (litBox) {
        const [x0, y0, x1, y1] = litBox;
        g.save();
        g.beginPath();
        g.rect(-1e5, -1e5, 2e5, 2e5);
        g.rect(x0, y0, x1 - x0, y1 - y0);
        g.clip('evenodd');
      }
      g.globalAlpha = clamp(lit);
      g.strokeStyle = light;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, from);
      g.lineTo(x, to);
      g.stroke();
      g.lineCap = 'butt';
      if (litBox) g.restore();
    });
  }
}

/**
 * A sword swung in the hand of nobody: held by its grip at screen point (`px`, `py`) and turned `ang` radians from
 * hanging point down (a quarter turn on is pointing screen left, half a turn straight up), `len` height units, drawn on
 * from the pommel by `show`. The band its point swept since `from` is drawn behind it as a white crescent, eaten from
 * its tail. Recorded at `at` (`bias` nearer).
 */
function swungSword(k: FxScene, at: P3, px: number, py: number, ang: number, len: number, o: { alpha?: number; from?: number; show?: number; bias?: number; clear?: Body | null; trail?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const U = k.hpx(len);
  const { L, gh, G, pr } = swordSizes(U);
  // The grip's middle is the turning point: the point is this far below it, hanging.
  const reach = L + gh + G * 0.5;
  const top = -(gh + G * 0.5 + 2 * pr);
  const show = clamp(o.show ?? 1);
  const from = o.from ?? ang;
  const tipAt = (t: number): Pt => [px - Math.sin(t) * reach, py + Math.cos(t) * reach];
  let box: readonly number[] | null = null;
  const c = o.clear;
  if (c && sortsOver(k, at, c)) {
    const bx = screenBox(k, c), [tx, ty] = tipAt(ang);
    if (bx[0] < Math.max(px, tx) && bx[2] > Math.min(px, tx) && bx[1] < Math.max(py, ty) && bx[3] > Math.min(py, ty)) box = bx;
  }
  const { core, ink } = k.pal;
  const iw = inkOf(k);
  k.worldDraw(at, (g) => {
    const sweep = ang - from;
    if (Math.abs(sweep) > 0.02 && (o.trail ?? 1) > 0.01) {
      // The crescent its blade swept: from the inner third of the blade out to its point, the tail end narrowed away.
      const n = Math.max(6, Math.round(Math.abs(sweep) * 10));
      const outer: Pt[] = [], inner: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n, t = from + sweep * u;
        const r0 = reach * lerp(0.94, 0.55, smooth(u)), r1 = reach * (1 + 0.04 * u);
        outer.push([px - Math.sin(t) * r1, py + Math.cos(t) * r1]);
        inner.push([px - Math.sin(t) * r0, py + Math.cos(t) * r0]);
      }
      const band = [...outer, ...inner.reverse()];
      g.globalAlpha = clamp(a * (o.trail ?? 1) * 0.75);
      poly(g, band, core, null);
      g.lineWidth = iw;
      g.strokeStyle = ink;
      g.beginPath();
      g.moveTo(outer[0][0], outer[0][1]);
      for (const [x, y] of outer) g.lineTo(x, y);
      g.stroke();
    }
    const draw = (g: CanvasRenderingContext2D): void => {
      g.save();
      g.translate(px, py);
      g.rotate(ang);
      g.beginPath();
      g.rect(-U, top - 4, 2 * U, (reach - top + 4) * show + 2);
      g.clip();
      paintSword(g, k, 0, reach, U);
      g.restore();
    };
    thinOver(g, box, a, draw);
  }, o.bias ?? 4);
  // Its light down the blade: faint by day, and what shows it after dark.
  const gl = lerp(0.04, 0.5, k.night) * a * smooth(seg(show, 0.8, 1));
  if (gl > 0.02) {
    const [tx, ty] = tipAt(ang), light = k.pal.light, w = k.hpx(len) * 0.12;
    k.glowDraw((g) => {
      g.globalAlpha = clamp(gl);
      g.strokeStyle = light;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(tx, ty);
      g.stroke();
      g.lineCap = 'butt';
    });
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

/** How bright a mark's night rim is: `day` of it by day, all of it at the dead of night; on fast graphics only after dark. */
const nightRim = (k: FxScene, day = 0.3): number => (k.fast ? 0.8 * k.night : lerp(day, 1, k.night));

/**
 * A chain between two points: links alternately face on (an open ring of a
 * lozenge, lit along its upper edges) and edge on (a short bar), along a line
 * that sags `sag` height units at its middle -- slack, or drawn taut. The links
 * are the same size however long it is: past forty the face-on ones lose their
 * light rather than growing. `sortAt` is where it stands among bodies (its
 * nearer end otherwise).
 */
function chain(k: FxScene, a: P3, b: P3, o: { alpha?: number; sag?: number; link?: number; bias?: number; glow?: number; colour?: string; sortAt?: P3 } = {}): void {
  const al = o.alpha ?? 1;
  if (al <= 0.01) return;
  const sag = o.sag ?? 0;
  const pts: Pt[] = [];
  const x0 = k.sx(a), y0 = k.sy(a), x1 = k.sx(b), y1 = k.sy(b);
  const len = Math.hypot(x1 - x0, y1 - y0);
  const L = (o.link ?? 3.4) * k.zoom;
  const n = Math.max(2, Math.min(160, Math.round(len / (L * 0.82))));
  const fine = n <= 40;
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
  k.worldDraw(o.sortAt ?? near, (g) => {
    g.globalAlpha = clamp(al);
    g.lineJoin = 'miter';
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i], [qx, qy] = pts[i + 1];
      const mx = (px + qx) / 2, my = (py + qy) / 2;
      const dx = qx - px, dy = qy - py, l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l;
      const h = l * 0.62;
      if (i % 2 === 0) {
        // Face on: a ring of a lozenge with its hole, inked outside and in, its two upper edges catching the light.
        const w = h * 0.62;
        const ring: Pt[] = [[mx - ux * h, my - uy * h], [mx - uy * w, my + ux * w], [mx + ux * h, my + uy * h], [mx + uy * w, my - ux * w]];
        poly(g, ring, null, ink, iw * 2.3);
        poly(g, ring, null, steel, iw * 1.3);
        if (fine) {
          // The two edges either side of the highest corner.
          let top = 0;
          for (let j = 1; j < 4; j++) if (ring[j][1] < ring[top][1]) top = j;
          const p0 = ring[(top + 3) % 4], p1 = ring[top], p2 = ring[(top + 1) % 4];
          g.strokeStyle = core;
          g.lineWidth = Math.max(0.6, iw * 0.6);
          g.beginPath();
          g.moveTo(lerp(p1[0], p0[0], 0.8), lerp(p1[1], p0[1], 0.8));
          g.lineTo(p1[0], p1[1]);
          g.lineTo(lerp(p1[0], p2[0], 0.8), lerp(p1[1], p2[1], 0.8));
          g.stroke();
        }
      } else {
        // Edge on: a short bar through the two rings either side, so each ring stands clear with its hole showing.
        const w = Math.max(0.9, h * 0.16), e = h * 0.72;
        poly(g, [[mx - ux * e - uy * w, my - uy * e + ux * w], [mx + ux * e - uy * w, my + uy * e + ux * w], [mx + ux * e + uy * w, my + uy * e - ux * w], [mx - ux * e + uy * w, my - uy * e - ux * w]], deep, ink, iw);
      }
    }
  }, o.bias ?? 0);
  // A breath of light along it, only after dark: by day it read as a tape under the links.
  const gl = (o.glow ?? 1) * k.night;
  if (gl > 0.02) {
    const light = k.pal.light;
    k.glowDraw((g) => {
      g.globalAlpha = clamp(al * gl * 0.2);
      g.strokeStyle = light;
      g.lineWidth = L * 1.4;
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
 * a surveyor does, square to the tiles. Its edges and studs keep a rim of light
 * after dark (`glow`, a share of the night rim).
 */
function square(k: FxScene, c: { x: number; y: number }, half: number, o: { band?: number; alpha?: number; glow?: number; studs?: boolean; draw?: number; dry?: number } = {}): void {
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
  // Going, it dries toward its own deep tone (`dry`) rather than thinning into the grass.
  const d = o.dry ?? 0;
  const core = d > 0 ? dry(k.pal.core, d, k.pal.main) : k.pal.core, main = d > 0 ? dry(k.pal.main, d, k.pal.deep) : k.pal.main;
  const deep = d > 0 ? dry(k.pal.deep, d, k.pal.ink) : k.pal.deep, ink = k.pal.ink;
  const iw = inkOf(k);
  const gl = (o.glow ?? 1) * nightRim(k) * (1 - 0.7 * d);
  k.groundShape(c.x, c.y, half + 0.3, [
    { kind: 'fill', colour: main, alpha: clamp(a), paths: near, lift: 0.15 },
    { kind: 'fill', colour: deep, alpha: clamp(a), paths: far, lift: 0.15 },
    { kind: 'stroke', colour: ink, alpha: clamp(a), width: iw, paths: [...near, ...far], closed: true, join: 'miter', lift: 0.15, glow: gl * 0.7 },
    { kind: 'fill', colour: core, alpha: clamp(a), paths: studs, lift: 0.2, glow: gl },
    { kind: 'stroke', colour: ink, alpha: clamp(a), width: iw, paths: studs, closed: true, join: 'miter', lift: 0.2 },
  ]);
}
/** A square's corners, round from the far one, on the land's own lines. */
const SQUARE_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

/**
 * A rule laid round a point: a fine ring `r` tiles out with `n` ticks
 * standing out from it, `lit` of them bright and the rest dark -- the time a
 * thing has left, going out a tick at a time, the last one fading as it goes.
 * A lit tick is long and broad, one gone out half as long, thin and dark, so
 * the count reads by shape as well as tone; the ring and the lit ticks keep a
 * rim of light after dark. `grow` draws the ring and its ticks on.
 */
function tally(k: FxScene, c: { x: number; y: number }, r: number, n: number, lit: number, o: { alpha?: number; turn?: number; grow?: number; tick?: number; ring?: boolean; band?: number; dry?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.05) return;
  const grow = clamp(o.grow ?? 1);
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
    const v = clamp(lit - i);
    const l = v <= 0 ? len * 0.5 : len;
    const tick = [c.x + cx * r, c.y + cy * r, c.x + cx * (r + l), c.y + cy * (r + l)];
    if (v >= 1) on.push(tick);
    else if (v <= 0) off.push(tick);
    else {
      going.push(tick);
      goingOn = v;
    }
  }
  const layers: GroundLayer[] = [];
  // Going, it dries toward its deep tones (`dry`) rather than thinning into the grass.
  const d = o.dry ?? 0, ink = k.pal.ink;
  const core = d > 0 ? dry(k.pal.core, d, k.pal.main) : k.pal.core, main = d > 0 ? dry(k.pal.main, d, k.pal.deep) : k.pal.main;
  const deep = d > 0 ? dry(k.pal.deep, d, k.pal.ink) : k.pal.deep;
  const w = Math.max(1, 1.4 * k.zoom), under = Math.max(1, 0.8 * k.zoom);
  const rim = nightRim(k, 0.12);
  if (o.ring !== false && grow > 0) {
    // The rule itself: a fine line round, drawn on the way the ticks are.
    const m = Math.max(16, k.facets(r));
    const pts: number[] = [];
    const most = Math.max(2, Math.ceil(m * grow));
    for (let i = 0; i <= most; i++) {
      const ang = turn + (Math.min(i, m * grow) / m) * TAU;
      pts.push(c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r);
    }
    const rw = (o.band ?? 1) * Math.max(1, 1.2 * k.zoom), ra = clamp(a * 0.8 * smooth(grow * 1.5));
    layers.push(
      { kind: 'stroke', colour: ink, alpha: ra, width: rw + under * 1.4, paths: [pts], join: 'round', lift: 0.15 },
      { kind: 'stroke', colour: main, alpha: ra, width: rw, paths: [pts], join: 'round', lift: 0.15, glow: rim * 0.8 },
    );
  }
  const fading = clamp(a * (0.35 + 0.65 * goingOn));
  layers.push(
    { kind: 'stroke', colour: ink, alpha: clamp(a * 0.35), width: w * 0.7 + under, paths: off, cap: 'butt', lift: 0.2 },
    { kind: 'stroke', colour: deep, alpha: clamp(a * 0.35), width: w * 0.7, paths: off, cap: 'butt', lift: 0.2 },
    { kind: 'stroke', colour: ink, alpha: fading, width: w * 1.6 + under, paths: going, cap: 'butt', lift: 0.2 },
    { kind: 'stroke', colour: core, alpha: fading, width: w * 1.6, paths: going, cap: 'butt', lift: 0.2 },
    { kind: 'stroke', colour: ink, alpha: clamp(a), width: w * 1.6 + under, paths: on, cap: 'butt', lift: 0.2 },
    { kind: 'stroke', colour: core, alpha: clamp(a), width: w * 1.6, paths: on, cap: 'butt', lift: 0.2 },
  );
  k.groundShape(c.x, c.y, r + len + 0.3, layers);
  // After dark the lit ticks keep their light as ticks: square-ended strokes a little wider than they are drawn, laid over
  // the night -- a ground layer's own glow is three times as wide with round ends, and a short tick became a bead.
  const shine = k.night * (k.fast ? 0.8 : 1) * a;
  if (shine > 0.02 && (on.length || going.length)) {
    const z = k.ground(c.x, c.y) + 0.2, light = k.pal.light;
    const lines = [...on, ...going].map((t) => [k.sx({ x: t[0], y: t[1], z }), k.sy({ x: t[0], y: t[1], z }), k.sx({ x: t[2], y: t[3], z }), k.sy({ x: t[2], y: t[3], z })]);
    k.glowDraw((g) => {
      g.globalAlpha = clamp(shine * 0.55);
      g.strokeStyle = light;
      g.lineWidth = w * 2.2;
      g.lineCap = 'butt';
      g.beginPath();
      for (const [x0, y0, x1, y1] of lines) {
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
      }
      g.stroke();
    });
  }
}

/** A ring hung level round a body at `share` of its height, `r` height units out: its back half behind the body and its front before it. */
function hoop(k: FxScene, b: Body, share: number, r: number, o: { alpha?: number; width?: number; colour?: string; front?: number } = {}): Pt[] {
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
    g.globalAlpha = clamp(a * (front ? o.front ?? 1 : 0.6));
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

/**
 * A goods-box, a thing carried: a little block of light, its lit top, its left and its shaded right face, `s` height
 * units; `long` stretches it along itself (a tool, a blade in its wrapping) and `tall` raises or flattens it.
 */
function box(k: FxScene, p: P3, s: number, o: { alpha?: number; spin?: number; dx?: number; long?: number; tall?: number; bias?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const x = k.sx(p) + (o.dx ?? 0), y = k.sy(p), S = k.hpx(s) * 0.5;
  const t = o.spin ?? 0, ln = o.long ?? 1;
  // Its top turned about the upright: four corners, flattened twice as wide as deep as the ground is.
  const top: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const cx = Math.cos((i * Math.PI) / 2) * S * ln, cy = Math.sin((i * Math.PI) / 2) * S;
    top.push([x + (Math.cos(t) * cx - Math.sin(t) * cy) * 1.2, y - S + (Math.sin(t) * cx + Math.cos(t) * cy) * 0.6]);
  }
  // The two lowest corners of the top, and the one between them nearest the viewer, are the bottom's too, dropped.
  const order = [0, 1, 2, 3].sort((i, j) => top[j][1] - top[i][1]);
  const f = order[0], s0 = order[1], s1 = order[2];
  const drop = S * 1.3 * (o.tall ?? 1);
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
  }, o.bias ?? 2);
}

/** A chevron, point up (`dir` the screen way it points otherwise), `s` height units across: a rank gained, or the way something must go. */
function chevron(k: FxScene, p: P3, s: number, o: { alpha?: number; dir?: Pt; bias?: number; glow?: number; dx?: number; dy?: number; solid?: boolean } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const x = k.sx(p) + (o.dx ?? 0), y = k.sy(p) + (o.dy ?? 0), S = k.hpx(s) / 2;
  const [dx0, dy0] = o.dir ?? [0, -1];
  const l = Math.hypot(dx0, dy0) || 1;
  const dx = dx0 / l, dy = dy0 / l, nx = -dy, ny = dx;
  const th = S * 0.5;
  const P = (along: number, across: number): Pt => [x + dx * along + nx * across, y + dy * along + ny * across];
  // `solid`: "this way" in Justice's own shapes -- a lozenge drawn out two and a half to one along the way, its lit
  // half and its shaded half, and an open chevron following behind it, pointing the same way: a needle, not a pointer.
  const shape: Pt[] = o.solid
    ? [P(S * 0.85, 0), P(0, S * 0.34), P(-S * 0.85, 0), P(0, -S * 0.34)]
    : [P(S * 0.6, 0), P(-S * 0.4, S), P(-S * 0.4 - th, S * 0.72), P(S * 0.6 - th * 1.25, 0), P(-S * 0.4 - th, -S * 0.72), P(-S * 0.4, -S)];
  const { core, main, deep, ink } = k.pal;
  const iw = inkOf(k);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    if (o.solid) {
      // Two chevrons behind, their arms swept well back: the needle's way said twice over.
      g.lineCap = 'round';
      for (const [w, colour] of [[Math.max(2.2, S * 0.2) + iw * 2, ink], [Math.max(1.1, S * 0.2), main]] as const) {
        g.lineWidth = w;
        g.strokeStyle = colour;
        g.beginPath();
        for (const at of [1.05, 1.45]) {
          const tail: Pt[] = [P(-S * (at + 0.42), S * 0.3), P(-S * at, 0), P(-S * (at + 0.42), -S * 0.3)];
          g.moveTo(tail[0][0], tail[0][1]);
          g.lineTo(tail[1][0], tail[1][1]);
          g.lineTo(tail[2][0], tail[2][1]);
        }
        g.stroke();
      }
      g.lineCap = 'butt';
      // The needle lit on whichever half is upper on the screen, a slit of light down its length.
      const upper = shape[1][1] < shape[3][1] ? 1 : 3;
      poly(g, [shape[0], shape[1], shape[2]], upper === 1 ? core : main, null);
      poly(g, [shape[0], shape[3], shape[2]], upper === 3 ? core : main, null);
      poly(g, shape, null, ink, iw * 1.2);
      g.strokeStyle = deep;
      g.lineWidth = Math.max(0.8, S * 0.06);
      g.beginPath();
      g.moveTo(shape[0][0] * 0.7 + shape[2][0] * 0.3, shape[0][1] * 0.7 + shape[2][1] * 0.3);
      g.lineTo(shape[2][0] * 0.8 + shape[0][0] * 0.2, shape[2][1] * 0.8 + shape[0][1] * 0.2);
      g.stroke();
    } else {
      poly(g, shape, main, ink, iw);
      poly(g, [shape[0], shape[5], shape[4], shape[3]], core, null);
    }
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
  // Dried toward its deep tone as it goes out and let go by alpha only over its last quarter, so it never thins to khaki.
  square(k, c, h, { band: Math.min(h * 0.3, 0.09 * (1 - 0.6 * u)), alpha: alpha * lateFade(1 - u, 0.25), glow: 0.8, studs: false, dry: u });
}

/** Once, the first frame `when` is true for this cast: for a burst wanted on a moment inside an impact or a linger. */
function once(k: FxScene, key: string, when: boolean): boolean {
  if (!when || k.state[key]) return false;
  k.state[key] = 1;
  return true;
}

/**
 * Justice's motes: the palette's pale blues laid over the picture in their own colour (`over`), so a glint fading over
 * grass stays silver-blue rather than going mint.
 */
const MOTE = (k: FxScene) => ({ kind: 'mote' as const, colour: [k.pal.core, k.pal.accent, k.pal.main], over: true });

/** Sparks knocked flat out along the ground, the way a blow from above throws them. */
function flatSparks(k: FxScene, at: P3, n: number, speed = 1.6): void {
  k.burst(at, n, { kind: 'spark', size: 2, colour: [k.pal.core, k.pal.main, STEEL], life: [0.2, 0.45], speed: [speed * 0.5, speed], up: [2, 14], gravity: 50, drag: 0.05 });
}

/**
 * A cuff round the caster's wrist (`side`), square to the forearm and a little up it: a band of steel standing round the
 * arm as a cuff does, not a ring laid level, so two wrists held together read as two cuffs and not one dish.
 */
function cuff(k: FxScene, side: 0 | 1, alpha: number): void {
  if (alpha <= 0.01) return;
  const n = k.fast ? 8 : 12, r = 0.85;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const p = k.joint(k.caster, `wrist${side}`, [Math.cos(a) * r, Math.sin(a) * r, 2.2]);
    pts.push([k.sx(p), k.sy(p)]);
  }
  const at = k.joint(k.caster, `wrist${side}`, [0, 0, 2.2]);
  const { core, ink } = k.pal;
  const w = Math.max(1.2, 1.15 * k.zoom);
  k.worldDraw(at, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.strokeStyle = ink;
    g.lineWidth = w + Math.max(1.2, k.zoom);
    g.stroke();
    g.strokeStyle = STEEL;
    g.lineWidth = w;
    g.stroke();
    // Its lit upper edge.
    let top = 0;
    for (let i = 1; i < n; i++) if (pts[i][1] < pts[top][1]) top = i;
    const p0 = pts[(top + n - 1) % n], p1 = pts[top], p2 = pts[(top + 1) % n];
    g.strokeStyle = core;
    g.lineWidth = Math.max(0.7, w * 0.4);
    g.beginPath();
    g.moveTo(p0[0], p0[1]);
    g.lineTo(p1[0], p1[1]);
    g.lineTo(p2[0], p2[1]);
    g.stroke();
  }, 3);
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
/** The hand cocked for the press: the upper arm out to the side at the shoulder's height, the forearm up, the palm out past the shoulder and clear of the face. */
const MARK_COCK = armToward(1, [0.9, 0.3, -0.05], [0.3, 0.7, 0.8]);
const markPose: CastPose = (r, t) => {
  r.arm[0] = euler(t, [[0, HANG], [0.18, JOINED], [0.44, [38, -14, 34]], [1, [36, -12, 32]]]);
  r.elbow[0] = one(t, [[0, 15], [0.18, JOINED_BEND], [1, 110]]);
  // Lifted to the shoulder and cocked; then driven forward and down from the trunk and the front knee, the hand finishing
  // below the shoulder and the wrist bent down into what it presses.
  r.arm[1] = euler(t, [[0, HANG], [0.18, JOINED], [0.32, JOINED], [0.44, MARK_COCK], [0.52, [70, 4, 2]], [0.72, [68, 4, 2]], [1, [30, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 15], [0.18, JOINED_BEND], [0.32, JOINED_BEND], [0.44, 80], [0.52, 20], [0.72, 22], [1, 20]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.44, [30, 0, 0]], [0.52, [-50, 0, 0]], [0.72, [-44, 0, 0]], [1, [0, 0, 0]]]);
  r.open = [t > 0.12, t > 0.12];
  r.shape = both(flat(one(t, [[0.06, 0], [0.18, 1], [0.8, 1], [1, 0]])));
  r.head = euler(t, [[0, [0, 0, 0]], [0.18, [-18, 0, 0]], [0.36, [-18, 0, 0]], [0.44, [-2, 0, -4]], [0.52, [-10, 0, -4]], [0.75, [-9, 0, -4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.36, [-4, 0, 0]], [0.44, [6, 0, -12]], [0.52, [-10, 0, 10]], [0.75, [-8, 0, 8]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.44, [4, 0, 0]], [0.52, [-12, 0, 0]], [0.75, [-10, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.44, [0, 3, 0]], [0.52, [22, 3, 0]], [0.75, [20, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.44, 6], [0.52, 22], [0.75, 20], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.44, [2, 2, 0]], [0.52, [-8, 2, 0]], [0.75, [-7, 2, 0]], [1, [0, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.52, 12], [1, 4]]);
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

/** Assay: down on the right knee, the trunk upright and leant out to the right, the right palm laid low on the earth at that side and the head up and turned, listening; pressed once; then up again. */
const ASSAY_T = { secs: 2.2, release: 0.58 };
const assayPose: CastPose = (r, t) => {
  // Down onto the knee, and up off it again with weight: the hand pushing off the front knee as the body rises.
  r.kneel = one(t, [[0, 0], [0.22, 1], [0.72, 1], [0.86, 0.45], [1, 0]]);
  // The palm on the ground beside the front foot, the trunk leaning out to that side rather than bowing flat over it,
  // the head up and turned a little, listening; pressed down a hair at the release.
  const press = one(t, [[0.5, 0], [0.58, 1], [0.68, 0.4], [0.76, 0]]);
  const w = one(t, [[0.14, 0], [0.32, 1], [0.72, 1], [0.82, 0]]);
  r.reach = [
    { at: [-2.6, 4.4, 7.4], w: one(t, [[0.7, 0], [0.8, 1], [0.9, 1], [1, 0]]) },
    { at: [5.2, 2.8, 1.4 - 0.4 * press], w },
  ];
  r.arm[1] = euler(t, [[0, HANG], [0.22, [50, 14, 0]], [0.72, [42, 12, 0]], [1, HANG]]);
  r.elbow[1] = one(t, [[0, 15], [0.22, 24], [0.72, 6], [1, 15]]);
  r.arm[0] = euler(t, [[0, HANG], [0.26, [56, 10, 6]], [0.72, [56, 10, 6]], [1, HANG]]);
  r.elbow[0] = one(t, [[0, 15], [0.26, 60], [0.72, 60], [1, 15]]);
  r.open = [t > 0.18, t > 0.18];
  r.shape = [flat(one(t, [[0.1, 0], [0.26, 0.6], [0.72, 0.6], [1, 0]])), flat(one(t, [[0.14, 0], [0.32, 1], [0.72, 1], [0.9, 0]]))];
  r.spine = euler(t, [[0, [0, 0, 0]], [0.26, [-8, -24, 0]], [0.72, [-8, -24, 0]], [0.9, [-6, -2, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.26, [-4, -12, 6]], [0.58, [-6, -14, 6]], [0.72, [-4, -12, 6]], [0.9, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.26, [-4, 12, -8]], [0.42, [6, 18, -16]], [0.72, [6, 18, -16]], [0.86, [-8, 0, 0]], [1, [0, 0, 0]]]);
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
    // The two hands are the pans: one sinks as the other rises, a long way, the arms opened out from the sides.
    const fwd = lerp(4, 34 + s * 30 * clamp(w, -1, 1), hold);
    // Out well clear of the body's sides, so from any side both hands stand off its outline.
    r.arm[k] = [lerp(fwd, 22, press), lerp(10, 40, hold), lerp(4, 6, hold)];
    r.elbow[k] = lerp(lerp(15, 48 - s * 18 * clamp(w, -1, 1), hold), 12, press);
    r.hand[k] = [lerp(0, -54, press), 0, 0];
  }
  r.open = [t > 0.08, t > 0.08];
  // Cupped, palms up, as a pan is; turned over flat to press.
  const cup = one(t, [[0.04, 0], [0.14, 1], [0.5, 1], [0.56, 0]]);
  r.shape = both({ cup, flat: one(t, [[0.5, 0], [0.56, 1], [0.8, 1], [1, 0]]) });
  for (let k = 0; k < 2; k++) r.hand[k][1] += (k ? -1 : 1) * 70 * cup;
  // The whole body weighs with them: the chest rolled down to the low hand, the hips shifted out to it and the head tipped
  // toward it.
  const lean = clamp(w, -1, 1) * (1 - press);
  r.chest = [lerp(0, -6, press), -10 * lean, 0];
  r.spine = euler(t, [[0, [0, 0, 0]], [0.5, [-2, 0, 0]], [0.56, [-10, 0, 0]], [0.78, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.spine[1] += 4 * lean;
  r.head = euler(t, [[0, [0, 0, 0]], [0.14, [-12, 0, 0]], [0.5, [-10, 0, 0]], [0.56, [-20, 0, 0]], [0.78, [-16, 0, 0]], [1, [0, 0, 0]]]);
  r.head[1] -= 12 * lean;
  r.knee = [one(t, [[0, 4], [0.5, 8], [0.56, 24], [0.78, 20], [1, 4]]), one(t, [[0, 4], [0.5, 8], [0.56, 24], [0.78, 20], [1, 4]])];
  r.leg = [euler(t, [[0, [2, 2, 0]], [0.56, [12, 6, 0]], [0.78, [10, 6, 0]], [1, [2, 2, 0]]]), euler(t, [[0, [0, 2, 0]], [0.56, [10, 6, 0]], [0.78, [8, 6, 0]], [1, [0, 2, 0]]])];
  // Weight onto the low side: that leg's knee gives and the other leg opens out.
  r.leg[0][1] += 6 * Math.max(0, -lean);
  r.leg[1][1] += 6 * Math.max(0, lean);
  r.knee[1] += 10 * Math.max(0, lean);
  r.knee[0] += 10 * Math.max(0, -lean);
};

/** Bind: the wrists crossed before the face as though bound, the head bowed behind them; then wrenched apart and down to the hips, fists shut, the knees sunk into it, and held, shaking with the strain. */
const BIND_T = { secs: 1.0, release: 0.5 };
const bindPose: CastPose = (r, t, c) => {
  const strain = t > 0.5 && t < 0.8 ? tremor(t * c.timing.secs, 1.6) : 0;
  for (let k = 0; k < 2; k++) {
    // Held up side by side before the face, not crossed -- bound wrist to wrist -- so the two cuffs stay two.
    r.arm[k] = euler(t, [[0, HANG], [0.3, [64, -10, 30]], [0.42, [66, -11, 32]], [0.5, [10, 30, -14]], [0.8, [12, 30, -14]], [1, HANG]]);
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
/** Seconds from the beam come level to the two squares gone: the light along it, the pans down, and the squares held. */
const EQUITY_IMPACT = 1.8;
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
    const joined: [number, number, number] = [56, -16, 36];
    const now = level.map((v, i) => lerp(v, joined[i], join)) as [number, number, number];
    r.arm[k] = now.map((v, i) => lerp(v, HANG[i], back)) as [number, number, number];
    r.elbow[k] = lerp(lerp(lerp(15, 4, out), 96, join), 15, back);
    r.hand[k] = [0, lerp(lerp(0, s * 70, out), 0, join), 0];
  }
  r.open = [t > 0.06, t > 0.06];
  r.shape = both(flat(one(t, [[0, 0], [0.12, 1], [0.82, 1], [1, 0]])));
  // The body is the balance: the trunk rolls with the tip, the hips shift out from under it, and the knee on the low side
  // gives.
  r.chest = [lerp(0, -4, join), 8 * tip, 0];
  r.spine = [0, 14 * tip, 0];
  r.leg = [[2, 3 + 8 * Math.max(0, tip), 0], [2, 3 + 8 * Math.max(0, -tip), 0]];
  r.knee = [4 + 16 * Math.max(0, -tip), 4 + 16 * Math.max(0, tip)];
  r.head = euler(t, [[0, [0, 0, 0]], [0.16, [4, 0, 0]], [0.54, [4, 0, 0]], [0.62, [-16, 0, 0]], [0.82, [-14, 0, 0]], [1, [0, 0, 0]]]);
};

/** Verdict: the hands steepled before the face, the head bowed, deliberating; the right arm raised straight up, held; and cut straight down to point at the creature. */
const VERDICT_T = { secs: 1.25, release: 0.6 };
const verdictPose: CastPose = (r, t) => {
  r.arm[0] = euler(t, [[0, HANG], [0.2, [96, -22, 38]], [0.34, [96, -22, 38]], [0.46, JOINED], [0.8, JOINED], [1, HANG]]);
  r.elbow[0] = one(t, [[0, 15], [0.2, 122], [0.34, 122], [0.46, JOINED_BEND], [0.8, JOINED_BEND], [1, 15]]);
  r.arm[1] = euler(t, [[0, HANG], [0.2, [96, -22, 38]], [0.34, [96, -22, 38]], [0.46, [172, 12, 0]], [0.53, [176, 10, 0]], [0.6, [95, 4, 0]], [0.8, [92, 4, 0]], [1, HANG]]);
  r.elbow[1] = one(t, [[0, 15], [0.2, 122], [0.34, 122], [0.46, 8], [0.53, 4], [0.6, 2], [0.8, 6], [1, 15]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.46, [0, 0, 0]], [0.6, [-6, 0, 0]], [1, [0, 0, 0]]]);
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

/** Temper: the thing in the right fist held out from the belly and stood up beside the head, the left palm laid along it and the head bowed to it -- a vigil kept over it; then the face lifted to it as it is tempered, and let down. */
const TEMPER_T = { secs: 1.7, release: 0.6 };
/**
 * The way out from the body, on the ground in its own frame ([right, ahead]), that Temper's fist is held: whichever of
 * straight out to the right and up to seventy degrees forward of it lies most across the screen for a body turned
 * `facing` (nought at the viewer, two to screen right), so the blade stood up from the fist stands clear of the head.
 */
function temperHold(facing: number): [number, number] {
  const th = (facing * Math.PI) / 4;
  let best = 0, most = -1;
  for (let i = 0; i <= 7; i++) {
    const phi = (i / 7) * 1.22;
    // Across the screen: the body's frame has screen right at (-cos, sin) of its turn.
    const across = Math.abs(-Math.cos(th) * Math.cos(phi) + Math.sin(th) * Math.sin(phi));
    if (across > most + 0.02) {
      most = across;
      best = phi;
    }
  }
  return [Math.cos(best), Math.sin(best)];
}
const temperPose: CastPose = (r, t, c) => {
  // Whatever is held stood up beside the head, clear of it from whichever side it is seen, and the chest turned a
  // little to show it; the left palm laid flat along it.
  const up = one(t, [[0, 0], [0.16, 1], [0.86, 1], [1, 0]]);
  const lay = one(t, [[0.12, 0], [0.24, 1], [0.8, 1], [0.92, 0]]);
  r.arm[1] = euler(t, [[0, HANG], [0.18, [58, -14, 40]], [0.8, [60, -14, 40]], [1, HANG]]);
  r.elbow[1] = one(t, [[0, 15], [0.18, 80], [0.8, 80], [1, 15]]);
  r.open = [t > 0.12, !c.carry && t > 0.12];
  r.shape = [flat(lay), undefined];
  if (c.carry === 'fist') {
    r.wield = up;
    // The fist at the belly and out from the body, and the blade stood up from it leaning out the same way, so it rises
    // beside the head and never through it. Which way out is chosen by the way the body is turned to the viewer: from
    // straight out to the right side to well forward, whichever puts the fist furthest across the screen from the head.
    const at = temperHold(c.facing);
    r.reach = [undefined, { at: [6.2 * at[0], 6.2 * at[1], 9], haft: [0.42 * at[0], 0.42 * at[1], 1], w: up }];
    // The blade along the haft the hand is turned to, rather than its usual third of the way toward the forearm.
    r.haft = -30 * up;
    r.both = lay;
    r.bothAt = 3.5;
  } else if (c.carry === 'staff') {
    // A spear or a staff along the line from the right fist through the left, stood up and out past the right shoulder.
    r.wieldStaff = up;
    r.both = up;
    // Held out the same side as a blade is (`temperHold`), the shaft leant out from the body, both hands on it.
    const at = temperHold(c.facing);
    r.reach = [{ at: [5.6 * at[0], 5.6 * at[1], 13.5], w: up }, { at: [4.4 * at[0], 4.4 * at[1], 9], w: up }];
  } else {
    // Nothing held: the left palm laid over the right fist, the two held at the breastbone, below the chin.
    r.arm[1] = euler(t, [[0, HANG], [0.18, [44, -16, 40]], [0.8, [46, -16, 40]], [1, HANG]]);
    r.elbow[1] = one(t, [[0, 15], [0.18, 88], [0.8, 88], [1, 15]]);
    r.arm[0] = euler(t, [[0, HANG], [0.2, [40, -24, 42]], [0.8, [40, -24, 42]], [1, HANG]]);
    r.elbow[0] = one(t, [[0, 15], [0.2, 90], [0.8, 90], [1, 15]]);
    r.hand[0] = euler(t, [[0, [0, 0, 0]], [0.2, [-30, 0, 0]], [0.8, [-30, 0, 0]], [1, [0, 0, 0]]]);
  }
  r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-20, 0, -10]], [0.5, [-22, 0, -12]], [0.62, [8, 0, -14]], [0.8, [6, 0, -12]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.2, [-6, 0, -6]], [0.5, [-8, 0, -6]], [0.62, [4, 0, -8]], [0.8, [3, 0, -6]], [1, [0, 0, 0]]]);
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
/**
 * Down on one knee to wait, the cupped hands held out low over the front knee and the head bowed; and as the things come
 * home, up off the knee with them, the hands lifted to the heart and closed over it.
 */
const RESTITUTION_T = { secs: 2.4, release: 0.42 };
const restitutionPose: CastPose = (r, t) => {
  r.kneel = one(t, [[0, 0], [0.2, 0.75], [0.36, 1], [0.54, 1], [0.78, 0], [1, 0]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, HANG], [0.2, [40, -12, 30]], [0.54, [44, -12, 32]], [0.76, [26, -20, 42]], [0.9, [24, -20, 42]], [1, HANG]]);
    r.elbow[k] = one(t, [[0, 15], [0.2, 34], [0.54, 34], [0.76, 96], [0.9, 94], [1, 15]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.2, [30, 0, 0]], [0.54, [30, 0, 0]], [0.76, [0, 0, 0]], [1, [0, 0, 0]]]);
  }
  r.open = [t > 0.08, t > 0.08];
  r.shape = both({ cup: one(t, [[0.06, 0], [0.2, 1], [0.56, 1], [0.72, 0]]), flat: one(t, [[0.56, 0], [0.74, 1], [0.9, 1], [1, 0]]) });
  r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-22, 0, 0]], [0.42, [-26, 0, 0]], [0.54, [-10, 0, 0]], [0.76, [6, 0, 0]], [0.9, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.2, [-10, 0, 0]], [0.54, [-10, 0, 0]], [0.76, [4, 0, 0]], [0.9, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.2, [-6, 0, 0]], [0.54, [-6, 0, 0]], [0.76, [6, 0, 0]], [0.9, [4, 0, 0]], [1, [0, 0, 0]]]);
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
  // Sworn with the upper arm out to the side and the forearm up, so the open hand stands beside the head and never
  // before the face.
  const sworn = armToward(1, [1, -0.15, 0.1], [0.5, -0.1, 1]);
  r.arm[1] = euler(t, [[0, HANG], [0.24, sworn], [0.48, sworn], [0.56, [80, 10, -18]], [0.82, [78, 10, -18]], [1, HANG]]);
  r.elbow[1] = one(t, [[0, 15], [0.24, 96], [0.48, 98], [0.56, 14], [0.82, 18], [1, 15]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.24, [10, 0, 0]], [0.48, [10, 0, 0]], [0.56, [10, 0, -70]], [0.82, [10, 0, -66]], [1, [0, 0, 0]]]);
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
  // Received rather than called down: the hands cupped low before the belly, palms up, the head bowed over them; then
  // lifted to the shoulders and opened out wide, palms up, the chest opened and the face lifted -- never overhead, and
  // the heels kept down.
  const wide = [armOut(0, 96, 56), armOut(1, 96, 56)];
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, HANG], [0.22, [30, -10, 30]], [0.36, [32, -10, 30]], [0.5, [70, 6, 10]], [0.6, wide[k]], [0.84, wide[k]], [1, HANG]]);
    r.elbow[k] = one(t, [[0, 15], [0.22, 46], [0.36, 46], [0.5, 40], [0.6, 14], [0.84, 16], [1, 15]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.22, [30, 0, 0]], [0.5, [20, 0, 0]], [0.6, [10, 0, 0]], [1, [0, 0, 0]]]);
    r.hand[k][1] += (k ? -1 : 1) * 70 * one(t, [[0.1, 0], [0.22, 1], [0.84, 1], [1, 0]]);
  }
  r.open = [t > 0.08, t > 0.08];
  r.shape = both({ cup: one(t, [[0.06, 0], [0.22, 1], [0.4, 1], [0.56, 0]]), flat: one(t, [[0.4, 0], [0.56, 1], [0.84, 1], [1, 0]]) });
  r.shrug = [one(t, [[0, 0], [0.5, 0], [0.6, 0.5], [0.84, 0.4], [1, 0]]), one(t, [[0, 0], [0.5, 0], [0.6, 0.5], [0.84, 0.4], [1, 0]])];
  r.head = euler(t, [[0, [0, 0, 0]], [0.22, [-22, 0, 0]], [0.38, [-22, 0, 0]], [0.6, [14, 0, 0]], [0.84, [12, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.22, [-8, 0, 0]], [0.38, [-8, 0, 0]], [0.6, [10, 0, 0]], [0.84, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.22, [-4, 0, 0]], [0.6, [3, 0, 0]], [1, [0, 0, 0]]]);
  r.knee = [one(t, [[0, 4], [0.22, 10], [0.38, 12], [0.6, 4], [1, 4]]), one(t, [[0, 4], [0.22, 10], [0.38, 12], [0.6, 4], [1, 4]])];
};

/* ---- the spells ---------------------------------------------------------------------------- */

/** Over a body's head, where a seal hangs. */
const over = (k: FxScene, b: Body, up = 5): P3 => ({ x: b.x, y: b.y, z: b.z + b.tall + up });
/** A ring's radius round a body's feet, in tiles, from how wide it is. */
const footR = (b: Body): number => Math.max(0.26, (b.wide / 40) * 2.2);
/** The way a body is facing on the screen, pointing from `from` toward `to`: for a chevron. */
const screenDir = (k: FxScene, from: P3, to: P3): Pt => [k.sx(to) - k.sx(from), k.sy(to) - k.sy(from)];
/** Where a collar goes round a creature: its neck, between the middle of its back and its head, from its own model. */
const collarAt = (k: FxScene, b: Body): P3 => mid3(k.at(b, 0.62), k.muzzle(b), 0.55);
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
  // Brighter after dark, with a little light of its own: a half-minute mark is the easiest thing on the field to find.
  lozenge(k, p, 5.2, { alpha: 0.92 * a, spin: 2 * snapTurn(age / 2.5), glow: lerp(0.6, 1, k.night) });
  tally(k, b, footR(b), MARK_TICKS, (MARK_TICKS * left) / Math.max(1, lastsOf('justice_mark')), { alpha: 0.65 * a });
  k.light(over(k, b), 1.2, 0.25 * a);
  if (!k.fast) k.emit({ x: p.x, y: p.y, z: p.z - 3 }, 2.5 * a, { ...MOTE(k), size: 1.4, colour: k.pal.main, life: [0.6, 1], speed: [0.01, 0.05], up: [-10, -6], gravity: 0, jitter: 0.04 });
};

/* Retribution: four mirror plates round the body, square to the tiles. */
const RETRIBUTION_TICKS = ticksFor(lastsOf('justice_retribution'));
/**
 * The angle on the ground, from a body, that is straight toward the viewer: a plate there would stand dead in front of
 * it. The plates stand an eighth of a turn either side of it and of its opposite, so none ever covers the body.
 */
function towardViewer(k: FxScene, b: Body): number {
  const z = b.z;
  const e0x = k.sx({ x: b.x + 1, y: b.y, z }) - k.sx(b), e1x = k.sx({ x: b.x, y: b.y + 1, z }) - k.sx(b);
  const e0y = k.sy({ x: b.x + 1, y: b.y, z }) - k.sy({ x: b.x, y: b.y, z }), e1y = k.sy({ x: b.x, y: b.y + 1, z }) - k.sy({ x: b.x, y: b.y, z });
  let th = Math.atan2(-e0x, e1x);
  if (Math.cos(th) * e0y + Math.sin(th) * e1y < 0) th += Math.PI;
  return th;
}
/** Where Retribution's plate `i` stands round a body, `r` height units out at height `z`, turned `turn` (quarter turns land it on another's place). */
function plateAt(k: FxScene, b: Body, r: number, z: number, turn: number, i: number): P3 {
  const tv = towardViewer(k, b), ang = tv + Math.PI / 4 + turn + (i * Math.PI) / 2;
  // The near pair further out and the far pair closer in and higher, so the four sit round the body on a ring as the
  // eye reads one, each near plate clear of the far one behind it rather than stacked under it in a column.
  const near = smooth(clamp((Math.cos(ang - tv) + 0.71) / 1.42));
  const rr = r * lerp(0.85, 1.25, near);
  return { x: b.x + (Math.cos(ang) * rr) / 40, y: b.y + (Math.sin(ang) * rr) / 40, z: z + (1 - near) * 0.15 * b.tall };
}
function plates(k: FxScene, b: Body, r: number, share: number, turn: number, alpha: number, h = 6, glint = -1): void {
  const c = { x: b.x, y: b.y, z: b.z + b.tall * share };
  const cx = k.sx(c), cy = k.sy(c);
  for (let i = 0; i < 4; i++) {
    const p = plateAt(k, b, r, c.z, turn, i);
    // Square to whoever looks: a plate on the near or the far side shows its face, one at the side its edge -- but never
    // less than a sliver of its face, so it reads as a plate and not a stick.
    const ox = k.sx(p) - cx, oy = (k.sy(p) - cy) * 2;
    const face = Math.abs(oy) / (Math.hypot(ox, oy) || 1);
    lozenge(k, p, h, { alpha, spin: Math.acos(Math.max(0.35, face)) * (ox > 0 ? 1 : -1), wide: 0.42, glow: i === glint ? 1.6 : 0.5, bias: 0, slit: i === glint, main: STEEL });
  }
}
/** Retribution's plates' turn at `age`: half a turn every six seconds, snapped over as the glint comes, and held. */
const retributionTurn = (age: number): number => {
  const q = age / RETRIBUTION_TURN, f = q - Math.floor(q);
  return (Math.floor(q) + easeOut(clamp(f / 0.1))) * Math.PI;
};
/** Seconds between the half turns of Retribution's plates: each one crosses from one side of the body to the other. */
const RETRIBUTION_TURN = 6;
const retributionLinger = (k: FxScene, age: number, left: number): void => {
  const a = smooth((age - 0.55) / 0.3) * smooth(left / 0.8);
  if (a <= 0.01) return;
  const b = k.target;
  // Every three seconds one plate catches the light, and every six the four snap half round the body as it does, a lit
  // plate crossing from one side to the other: the turned-back blow waiting.
  const glint = Math.floor(age / 3) % 4;
  const g = bump((age % 3) / 3, 0.04, 0.12, 0.4);
  plates(k, b, 11, 0.55, retributionTurn(age), 0.8 * a, 6, g > 0.05 ? glint : -1);
  tally(k, b, footR(b) + 0.06, RETRIBUTION_TICKS, (RETRIBUTION_TICKS * left) / Math.max(1, lastsOf('justice_retribution')), { alpha: 0.55 * a });
  k.light(k.at(b, 0.55), 1.2, (0.18 + 0.25 * g) * a);
};

/* Assay */
const ASSAY_R = radiusOf('justice_assay');
const ASSAY_IMPACT = 2.4;
/** A plumb-bob hung over the spot on its line: Assay's measure. */
function plumb(k: FxScene, spot: P3, lift: number, alpha: number, swing: number): void {
  const bob: P3 = { x: spot.x, y: spot.y, z: spot.z + lift };
  const topZ = lift + 22;
  const top: P3 = { x: spot.x, y: spot.y, z: spot.z + topZ };
  // The line swings about its top; the bob stays over the spot it measures.
  const bx = k.sx(bob), by = k.sy(bob);
  const tx = k.sx(top) - swing * k.zoom, ty = k.sy(top);
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
  // A small seal at the line's top, so it hangs from something rather than out of nothing.
  lozenge(k, { x: top.x, y: top.y, z: top.z + 1 }, 2, { alpha, glow: 0.5, slit: false, bias: 1.5 });
}

/* Sentence */
const SENTENCE_SIZE = 9;
const sentencePivot = (k: FxScene): P3 => over(k, k.target, 8 + k.target.tall * 0.2);

/* Bind */
const BIND_LASTS = lastsOf('justice_bind');
const BIND_TICKS = ticksFor(BIND_LASTS);
/** The four stakes a Bind drives, at the corners of a square round the creature on the land's lines. */
function stakes(b: Body): Array<{ x: number; y: number }> {
  const s = Math.max(0.45, (b.wide / 40) * 3.6);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: b.x + i * s, y: b.y + j * s }));
}

/* Verdict: no falling blade, but a cut -- a sword of light held by no hand, swung down through the creature as the priest's arm cuts down. */
const VERDICT_LEN = 30;
/** Pixels from a sword's grip to its point, `len` height units point to pommel. */
const swordReach = (k: FxScene, len: number): number => {
  const { L, gh, G } = swordSizes(k.hpx(len));
  return L + gh + G * 0.5;
};
/**
 * Verdict's swing on the screen: its grip, up beside the creature on the side away from the priest (so the raised
 * blade never stands between the viewer and the priest's performance), the angle it is raised at, and the angle it
 * finishes at, its blade through the creature's middle. `s` is the way it swings: one clockwise, from the left.
 */
function verdictSwing(k: FxScene): { x: number; y: number; start: number; end: number; through: number; s: number } {
  const b = k.target, s = k.sx(k.caster) <= k.sx(b) ? -1 : 1;
  const mid = k.at(b, 0.5);
  const reach = swordReach(k, VERDICT_LEN);
  const l = Math.hypot(0.9, 0.44), dx = (s * 0.9) / l, dy = 0.44 / l;
  const x = k.sx(mid) - dx * reach * 0.5, y = k.sy(mid) - dy * reach * 0.5;
  // The point's way on the screen is (-sin, cos) of the angle: raised, it leans back away from the creature.
  const start = Math.atan2(s * 0.35, -0.94);
  let through = Math.atan2(-dx, dy);
  if (s > 0) while (through < start) through += TAU;
  else while (through > start) through -= TAU;
  // Followed on through and down past the body, half a radian on, so it never comes to rest lying across it.
  const end = through + Math.sign(through - start) * 0.5;
  return { x, y, start, end, through, s };
}
/** The angle of Verdict's sword at `t` through the cast: formed raised, cocked a little further back, and cut down at the release. */
function verdictAngle(k: FxScene, t: number): number {
  const v = verdictSwing(k);
  const cock = smooth(seg(t, 0.44, 0.53)) * 0.22 * -v.s;
  const cut = easeIn(seg(t, 0.53, VERDICT_T.release));
  return lerp(v.start + cock, v.end, cut);
}
/** The way on the ground, in tiles, that a way on the screen (`dx`, `dy`) lies along, from a point on it. */
function groundWay(k: FxScene, at: { x: number; y: number }, dx: number, dy: number): { x: number; y: number } {
  const z = k.ground(at.x, at.y), o = { x: at.x, y: at.y, z };
  const ax = k.sx({ x: at.x + 1, y: at.y, z }) - k.sx(o), ay = k.sy({ x: at.x + 1, y: at.y, z }) - k.sy(o);
  const bx = k.sx({ x: at.x, y: at.y + 1, z }) - k.sx(o), by = k.sy({ x: at.x, y: at.y + 1, z }) - k.sy(o);
  const det = ax * by - bx * ay || 1;
  const u = (dx * by - bx * dy) / det, v = (ax * dy - dx * ay) / det;
  const l = Math.hypot(u, v) || 1;
  return { x: u / l, y: v / l };
}
/**
 * The one straight cut a Verdict leaves on the ground through the creature's feet, along the way the blade went:
 * opened from the side the blade came from by `open`, white at first and drying to the deep tone by `dry` (0..1).
 */
function verdictCut(k: FxScene, open: number, dryU: number, alpha: number): void {
  if (alpha <= 0.01 || open <= 0) return;
  const b = k.target, v = verdictSwing(k);
  const way = groundWay(k, b, -Math.sin(v.through), Math.cos(v.through));
  const half = footR(b) + 0.32;
  const p0 = { x: b.x - way.x * half, y: b.y - way.y * half };
  const p1 = { x: lerp(p0.x, b.x + way.x * half, open), y: lerp(p0.y, b.y + way.y * half, open) };
  // A cut in the turf, not a stave lying on it: narrow, its edges ragged, widest where the blade went in and running out
  // thin; dark soil in it and the far lip turned up and catching the light.
  const n = { x: -way.y, y: way.x }, w = 0.042 * (1 - 0.3 * dryU);
  const along = (u: number, side: number, wide: number): number[] => {
    const x = lerp(p0.x, p1.x, u), y = lerp(p0.y, p1.y, u);
    return [x + n.x * side * wide, y + n.y * side * wide];
  };
  const prof = [0, 0.7, 1, 0.55, 0.8, 0.4, 0];
  const lipA: number[] = [], lipB: number[] = [];
  for (let i = 0; i < prof.length; i++) {
    const u = i / (prof.length - 1), j = 0.75 + 0.5 * hashOf(k.seed + 41, i);
    lipA.push(...along(u, 1, w * prof[i] * j));
    lipB.unshift(...along(u, -1, w * prof[i] * (1.75 - j)));
  }
  const gash = [...lipA, ...lipB], far = lipA;
  const m = mid3({ ...p0, z: 0 }, { ...p1, z: 0 }, 0.5);
  const line = [lerp(p0.x, m.x, 0.3), lerp(p0.y, m.y, 0.3), lerp(p1.x, m.x, 0.3), lerp(p1.y, m.y, 0.3)];
  const { core, deep, ink } = k.pal;
  // After dark a line of light down it is what shows it.
  const lit = smooth(seg(k.night, 0.2, 0.6));
  const layers: GroundLayer[] = [
    { kind: 'fill', colour: SOIL, alpha: clamp(alpha), paths: [gash], lift: 0.12 },
    { kind: 'stroke', colour: ink, alpha: clamp(alpha * 0.8), width: Math.max(0.8, 0.8 * k.zoom), paths: [gash], closed: true, join: 'round', lift: 0.12 },
    { kind: 'stroke', colour: EARTH, alpha: clamp(alpha * (1 - lit) * (1 - 0.5 * dryU)), width: Math.max(0.8, 0.7 * k.zoom), paths: [far], cap: 'round', join: 'round', lift: 0.13 },
  ];
  if (lit > 0.01) layers.push({ kind: 'stroke', colour: dry(core, dryU, deep), alpha: clamp(alpha * lit), width: Math.max(1, 1.3 * k.zoom), paths: [line], cap: 'round', lift: 0.14, glow: nightRim(k, 0.5) * (1 - 0.6 * dryU) });
  k.groundShape(b.x, b.y, half + 0.4, layers);
}

/* Judgment */
const JUDGMENT_R = radiusOf('justice_judgment');
const JUDGMENT_IMPACT = 2.4;
const judgmentSwords = (k: FxScene): number => (k.fast ? 5 : 8);
/** Each of Judgment's swords, point to pommel: smaller than a Verdict's, there being many. */
const JUDGMENT_SWORD = 26;
/** The ticks of a judged creature's tally: the seconds it takes more damage. */
const JUDGMENT_TICKS = ticksFor(lastsOf('justice_judgment'));
/**
 * The most creatures Judgment marks for its seconds: past it the marks would crowd the field and cost too much. A sword
 * still comes down on every creature there that there is a sword for.
 */
const JUDGED_MOST = 4;
/** When Judgment's sword `i` of `n` forms over its mark: all of them formed by a little before the arms come down. */
const judgmentForm = (t: number, i: number, n: number): number => {
  const t0 = 0.22 + i * 0.03 * (6 / n);
  return smooth(seg(t, t0, t0 + 0.16));
};
/**
 * The creatures Judgment comes down on: the wild ones standing within its reach when the swords first form -- never a
 * companion or a beast somebody keeps, which the rule does not touch -- nearest the spot first, kept by who they are
 * (`k.state`) so the same ones are followed wherever they go. The island does not say which were hunting somebody, and
 * so which it really hurt; these are the ones there that it may.
 */
function judged(k: FxScene): Array<Body | null> {
  if (!k.state.picked) {
    k.state.picked = 1;
    const pet = k.companion;
    const there = k.enemiesWithin(JUDGMENT_R, k.spot)
      .filter((b) => !b.companion && !(pet && Math.hypot(b.x - pet.x, b.y - pet.y) < 0.3))
      .sort((a, b) => Math.hypot(a.x - k.spot.x, a.y - k.spot.y) - Math.hypot(b.x - k.spot.x, b.y - k.spot.y));
    // A sword for every creature there, as many as there are swords; the nearest few of them also carry the mark.
    let n = 0;
    for (const b of there) {
      if (b.who?.kind !== 'creature' || n >= judgmentSwords(k)) continue;
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
/**
 * Where each of Judgment's swords comes down: on a creature standing there, or else spread over the ground it covers --
 * but never within a little of a person (the priest among them) or a companion, where a blade from above would read as
 * striking them. Chosen once, the first frame it is asked, and kept.
 */
function judgmentAt(k: FxScene, i: number, n: number, on: ReadonlyArray<Body | null>): { x: number; y: number } {
  const b = on[i];
  if (b) return { x: b.x, y: b.y };
  const kx = `jx${i}`, ky = `jy${i}`;
  if (k.state[kx] === undefined) {
    const spared = k.bodiesWithin(JUDGMENT_R + 0.6, k.spot, ['player', 'peer']);
    if (k.companion) spared.push(k.companion);
    let at = { x: k.spot.x, y: k.spot.y };
    for (let tries = 0; tries < 8; tries++) {
      const h = i * 8 + tries;
      const ang = i === 0 && tries === 0 ? 0 : ((i - 1) / Math.max(1, n - 1)) * TAU + hashOf(k.seed, h) * 0.7 + tries * 0.9;
      const rr = i === 0 && tries === 0 ? 0 : JUDGMENT_R * (0.35 + 0.55 * Math.sqrt(hashOf(k.seed + 11, h)));
      at = { x: k.spot.x + Math.cos(ang) * rr, y: k.spot.y + Math.sin(ang) * rr };
      if (!spared.some((p) => Math.hypot(p.x - at.x, p.y - at.y) < 0.6)) break;
    }
    k.state[kx] = at.x;
    k.state[ky] = at.y;
  }
  return { x: k.state[kx], y: k.state[ky] };
}
/** When each sword falls, seconds into the impact. */
const judgmentFall = (i: number): number => 0.06 + i * 0.075;

/* Truce */
const TRUCE_R = radiusOf('justice_truce');
const TRUCE_LASTS = lastsOf('justice_truce');
/** A Truce's palisade: a stake every ninety-hundredths of a tile round its ring, every tile and a half on fast graphics. */
const trucePales = (k: FxScene): number => Math.round((TAU * TRUCE_R) / (k.fast ? 1.5 : 0.9));
/** How tall a Truce's stakes stand, in height units: chest-high on a person. */
const TRUCE_PALE = 12;
/** The planted sword of a Truce, point to pommel. */
const TRUCE_SWORD = 34;
/**
 * Where the Truce's sword is planted: on the spot, or, when anybody or anything stands on it, a little off it toward the
 * priest -- a sheathed sword stands beside those it binds, never through them. Chosen once and kept.
 */
function trucePlant(k: FxScene): { x: number; y: number } {
  if (k.state.plantX === undefined) {
    const there = k.bodiesWithin(0.5, k.spot).length > 0;
    const d = k.toward(k.spot, k.caster);
    // Cast at one's own feet, beside the priest rather than toward them.
    const way = Math.hypot(k.caster.x - k.spot.x, k.caster.y - k.spot.y) < 0.6 ? { x: -d.y, y: d.x } : d;
    const off = there ? 0.7 : 0;
    k.state.plantX = k.spot.x + way.x * off;
    k.state.plantY = k.spot.y + way.y * off;
  }
  return { x: k.state.plantX, y: k.state.plantY };
}
/** How many of those inside a Truce are drawn bound by it. */
const TRUCE_BONDS = 4;
function pales(k: FxScene, age: number, rise: number, alpha: number): void {
  const n = trucePales(k);
  const left = TRUCE_LASTS - age;
  const each = TRUCE_LASTS / n;
  // In four runs, a quarter of the ring each -- the near one, the far one and the two sides as the viewer sees them --
  // each sorted where its middle stands: a body inside the ring is behind the near run and before the far one, and the
  // fence costs four records rather than one a stake.
  const spot = { ...k.spot, tall: 0, wide: 0, facing: 0, kind: 'spot' as const };
  const near = towardViewer(k, spot);
  const runs: Array<Array<{ foot: { x: number; y: number }; h: number; alpha: number }>> = [[], [], [], []];
  for (let i = 0; i < n; i++) {
    const ang = near - Math.PI / 4 + (i / n) * TAU;
    const foot = { x: k.spot.x + Math.cos(ang) * TRUCE_R, y: k.spot.y + Math.sin(ang) * TRUCE_R };
    const up = smooth(seg(rise, (i / n) * 0.6, (i / n) * 0.6 + 0.4));
    // Each stake stands for its share of the truce's seconds and then goes down into the ground, the first first.
    const down = age > 0 ? smooth(seg(left, (n - 1 - i) * each, (n - 1 - i) * each + Math.min(1, each * 0.5))) : 1;
    runs[Math.floor((i / n) * 4) % 4].push({ foot, h: TRUCE_PALE * easeBack(up) * down, alpha: alpha * Math.min(1, up * 3) });
  }
  // Each run's rails run on to the next run's first stake, so the fence is unbroken where the runs meet.
  for (let q = 0; q < 4; q++) {
    const ang = near + (q / 4) * TAU;
    const mid = k.on(k.spot.x + Math.cos(ang) * TRUCE_R, k.spot.y + Math.sin(ang) * TRUCE_R);
    k.worldDraw(mid, palePainter(k, runs[q], runs[(q + 1) % 4][0]), 0);
  }
  // At night the top rail keeps a line of light, so the ring of the fence shows in the dark: one stroke round it.
  const rim = nightRim(k, 0) * alpha;
  if (rim > 0.02) {
    const light = k.pal.light;
    const lines: Pt[][] = [];
    let open = true;
    const all = runs.flat();
    for (let i = 0; i <= all.length; i++) {
      const p = all[i % all.length];
      if (p.h < 2) {
        open = true;
        continue;
      }
      const at = k.on(p.foot.x, p.foot.y, p.h * 0.78);
      if (open) lines.push([]);
      lines[lines.length - 1].push([k.sx(at), k.sy(at)]);
      open = false;
    }
    const w = 3 * k.zoom;
    k.glowDraw((g) => {
      g.globalAlpha = clamp(rim * 0.35);
      g.strokeStyle = light;
      g.lineWidth = w;
      g.lineJoin = 'round';
      g.beginPath();
      for (const run of lines) {
        if (run.length < 2) continue;
        g.moveTo(run[0][0], run[0][1]);
        for (const [x, y] of run) g.lineTo(x, y);
      }
      g.stroke();
    });
  }
}
/**
 * What draws a run of a Truce's stakes as a fence: two rails from stake to stake, behind the stakes, then the stakes,
 * each with its lit and its shaded face and a lozenge cap. A rail runs only between two stakes both still standing, so
 * the fence breaks where the stakes go down. `next` is the next run's first stake, for the rails to reach.
 */
function palePainter(k: FxScene, posts: ReadonlyArray<{ foot: { x: number; y: number }; h: number; alpha: number }>, next?: { foot: { x: number; y: number }; h: number; alpha: number }): (g: CanvasRenderingContext2D) => void {
  const pts = (next ? [...posts, next] : posts).map((p) => {
    const base = k.on(p.foot.x, p.foot.y);
    return { x: k.sx(base), y: k.sy(base), H: k.hpx(p.h), a: p.alpha, h: p.h };
  });
  // At play size or on fast graphics a stake at every other post, the rails still unbroken: it reads as the same fence for
  // half the drawing.
  const sparse = k.fast || k.zoom < 1.5;
  const paint = postPainter(k, sparse ? posts.filter((_, i) => i % 2 === 0) : posts, 1.1, 2);
  const { ink } = k.pal;
  const rw = Math.max(1, 1.1 * k.zoom);
  return (g) => {
    g.lineCap = 'round';
    g.globalAlpha = clamp(pts.reduce((m, p) => Math.max(m, p.a), 0));
    for (const [w, colour] of [[rw + Math.max(1.2, k.zoom), ink], [rw, STEEL]] as const) {
      g.lineWidth = w;
      g.strokeStyle = colour;
      for (const share of [0.38, 0.78]) {
        g.beginPath();
        for (let i = 0; i + 1 < pts.length; i++) {
          const p = pts[i], q = pts[i + 1];
          if (p.h < 2 || q.h < 2) continue;
          const H = Math.min(p.H, q.H) * share;
          g.moveTo(p.x, p.y - H);
          g.lineTo(q.x, q.y - H);
        }
        g.stroke();
      }
    }
    g.lineCap = 'butt';
    paint(g);
  };
}
/* Restitution */
const RESTITUTION_IMPACT = 2.0;
const RESTITUTION_GOODS = 9;
/** Where the grave stands: behind whoever it is on, near enough to be seen with them. */
const restitutionGrave = (k: FxScene): { x: number; y: number } => behind(k, k.target, 0.85);
/** A grave's stone: grey, its face lit and its side shaded. */
const STONE = '#9aa0b0', STONE_SIDE = '#646b7e', EARTH = '#8a7d68';
/** The dark of turned soil, in a cut. */
const SOIL = '#2e261c';
/**
 * The grave: a headstone with a rounded head standing out of a low mound, its shaded side showing, Justice's lozenge
 * cut into its face. `up` (0..1) is how far it has risen out of the ground; what is still under the ground is not drawn.
 */
function headstone(k: FxScene, foot: { x: number; y: number }, up: number, alpha: number): void {
  if (alpha <= 0.01) return;
  // The mound first, on the ground, whether or not the stone is up: it is the grave.
  const r = 0.26, m: number[] = [];
  const d = k.toward(k.caster, foot);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    // Longer toward and away from the priest, as a grave is laid.
    const u = Math.cos(a) * r * 1.25, v = Math.sin(a) * r * 0.75;
    m.push(foot.x + d.x * u - d.y * v, foot.y + d.y * u + d.x * v);
  }
  k.groundShape(foot.x, foot.y, r * 1.4 + 0.2, [
    { kind: 'fill', colour: EARTH, alpha: clamp(alpha * 0.9), paths: [m], lift: 0.1 },
    { kind: 'stroke', colour: k.pal.ink, alpha: clamp(alpha * 0.6), width: Math.max(0.8, 0.7 * k.zoom), paths: [m], closed: true, lift: 0.1 },
  ]);
  if (up <= 0.02) return;
  const base = k.on(foot.x, foot.y);
  const x = k.sx(base), y = k.sy(base);
  const W = k.hpx(2.6), D = W * 0.42, H = k.hpx(10), sink = H * (1 - up);
  const { ink, deep, core } = k.pal;
  const iw = inkOf(k);
  k.worldDraw(base, (g) => {
    g.beginPath();
    g.rect(x - W * 2, y - H * 2, W * 4, H * 2 + D * 0.5);
    g.clip();
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'miter';
    const y0 = y + sink, top = y0 - H, sh = top + W * 0.55;
    // The head of the stone rounded: a half-round over the face, in a few facets.
    const head: Pt[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      head.push([x + Math.cos(a) * W, sh + Math.sin(a) * W * 0.55]);
    }
    const face: Pt[] = [[x - W, y0], ...head, [x + W, y0]];
    const side: Pt[] = [[x + W, y0], [x + W, sh], [x + W + D * 0.7, sh - D * 0.55], [x + W + D, sh - D * 0.1], [x + W + D, y0 - D * 0.5]];
    poly(g, side, STONE_SIDE, ink, iw);
    poly(g, face, STONE, ink, iw);
    // The lozenge cut into its face: a sunk outline, its lower edges catching light.
    const cy = top + H * 0.42, ch = H * 0.2, cw = W * 0.42;
    poly(g, [[x, cy - ch], [x - cw, cy], [x, cy + ch], [x + cw, cy]], deep, ink, iw);
    g.strokeStyle = core;
    g.lineWidth = Math.max(0.6, iw * 0.7);
    g.beginPath();
    g.moveTo(x - cw * 0.8, cy + ch * 0.2);
    g.lineTo(x, cy + ch * 0.95);
    g.lineTo(x + cw * 0.8, cy + ch * 0.2);
    g.stroke();
  }, 0);
}

/* Execution */
const EXECUTION_LEN = 64;
/** How deep Execution's sword is driven in after the blow, in height units: its point and lower blade in the ground. */
const EXECUTION_DEPTH = EXECUTION_LEN * 0.35;
/**
 * The great sword broken: five pieces cut from its outline -- pommel and grip, the guard, two lengths of blade and the
 * point -- each from where it stood, thrown out and falling, turning, `v` (0..1) of the way through their half second.
 */
function brokenSword(k: FxScene, b: Body, tipZ: number, v: number, alpha: number): void {
  if (alpha <= 0.01 || v >= 1) return;
  const len = EXECUTION_LEN, U = len;
  const { L, bw, gw, gh, G, pr } = swordSizes(U);
  const { main, deep, ink } = k.pal;
  // Each piece in units up the sword from its point, and its outline about its own middle (across, up).
  const pieces: Array<{ at: number; pts: Array<[number, number]>; fill: string }> = [
    { at: L * 0.12, pts: [[0, -L * 0.12], [-bw, L * 0.04], [-bw, L * 0.13], [bw, L * 0.1], [bw, L * 0.04]], fill: STEEL },
    { at: L * 0.42, pts: [[-bw, -L * 0.17], [bw, -L * 0.2], [bw, L * 0.15], [-bw, L * 0.19]], fill: STEEL },
    { at: L * 0.78, pts: [[-bw, -L * 0.18], [bw, -L * 0.14], [bw, L * 0.2], [-bw, L * 0.2]], fill: STEEL },
    { at: L + gh, pts: [[-gw, 0], [-gw * 0.8, -gh * 1.4], [gw * 0.8, -gh * 1.4], [gw, 0], [gw * 0.8, gh * 1.4], [-gw * 0.8, gh * 1.4]], fill: main },
    { at: L + gh * 2 + G * 0.6 + pr, pts: [[-bw * 0.55, G * 0.5], [bw * 0.55, G * 0.5], [bw * 0.55, -G * 0.5], [pr * 0.75, -G * 0.5 - pr], [0, -G * 0.5 - 2 * pr], [-pr * 0.75, -G * 0.5 - pr], [-bw * 0.55, -G * 0.5]], fill: deep },
  ];
  const out: ShapePiece[] = [];
  const t = v * 0.5;
  // Going, the steel goes dark rather than thin, and is let go by alpha only at the very end.
  const dim = smooth(seg(v, 0.5, 1));
  // Across the screen, on the ground, and how many tiles of it a height unit drawn across is.
  const wx = groundWay(k, b, 1, 0);
  const perUnit = k.hpx(1) / (Math.abs(k.sx({ x: b.x + wx.x, y: b.y + wx.y, z: b.z }) - k.sx(b)) || 1);
  // Each piece is a slab with its thickness: its edge in the deep tone a little down and to the right of its face.
  const th = 1.4;
  const faces: ShapePiece[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const h = hashOf(k.seed + 31, i), side = i % 2 ? 1 : -1;
    // Thrown out to either side and a little up, then down under its own weight; turning as it goes.
    const vx = side * (0.5 + h * 0.7), vz = 10 + 14 * h;
    const way = { x: Math.cos(h * TAU) * vx, y: Math.sin(h * TAU) * vx };
    const cx = b.x + way.x * t, cy = b.y + way.y * t;
    const turn = side * (3 + 4 * h) * t;
    const c = Math.cos(turn), s = Math.sin(turn);
    // Smaller than the sword they came from, as broken pieces read; its outline turned in the plane of the screen, in
    // units, across along the screen's x as the sword was drawn.
    const rot = p.pts.map(([ax, az]): [number, number] => [(ax * c - az * s) * 0.7, (ax * s + az * c) * 0.7]);
    // Stopped whole at the ground, its middle held up by its lowest corner, rather than its corners pressed flat.
    const low = Math.min(...rot.map(([, rz]) => rz));
    const cz = Math.max(k.ground(cx, cy) + th - low, tipZ + p.at + vz * t - 70 * t * t);
    const at = (rx: number, rz: number, dx = 0, dz = 0): P3 => ({ x: cx + (rx + dx) * perUnit * wx.x, y: cy + (rx + dx) * perUnit * wx.y, z: cz + rz + dz });
    out.push({ pts: rot.map(([rx, rz]) => at(rx, rz, th * 0.6, -th)), fill: dry(deep, dim, ink) });
    faces.push({ pts: rot.map(([rx, rz]) => at(rx, rz)), fill: dry(p.fill, dim, deep) });
  }
  k.shapes({ x: b.x, y: b.y, z: b.z }, [...out, ...faces], { alpha: alpha * lateFade(1 - v, 0.15), bias: 4 });
}

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
  // Its light: a breath by day, where a broad band read as tape under it, and a glow after dark.
  const light = k.pal.light;
  const gl = lerp(0.06, 0.2, k.night);
  k.glowDraw((g) => {
    g.globalAlpha = clamp(al * gl);
    g.strokeStyle = light;
    g.lineWidth = A * 1.4;
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
/**
 * Where Due Reward's seal is while it is cast: five units out before the priest at the height the cupped hands had, and
 * `rise` (0..1) of the way up from there to well over the head.
 */
function rewardSeal(k: FxScene, rise: number): P3 {
  const z = (k.state.rewardZ ?? k.caster.tall * 0.5) + 3;
  return k.local(k.caster, 0, 5 + 2 * rise, lerp(z, k.caster.tall + 6, rise));
}

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
        // Beside the hand on its outer side, never between the hand and the face.
        const o = k.local(k.caster, 0, 0, 0), out = k.local(k.caster, 5.4 * k.side, 2.4, 0);
        const h = k.hand(1);
        const at = { x: h.x + out.x - o.x, y: h.y + out.y - o.y, z: h.z - 3 };
        lozenge(k, at, 2 + 3 * g, { alpha: g, spin: flipTurn(t * 6), glow: 0.9, bias: 3 });
        k.light(at, 1.5, 0.4 * g);
      },
      release: (k) => k.burst(k.hand(1), 8, { ...MOTE(k), size: 1.6, life: [0.2, 0.4], speed: [0.2, 0.6], up: [-2, 6], heading: k.toward(k.caster, k.target), cone: 0.7, gravity: 0 }),
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
      hit: (k) => k.burst(over(k, k.target, 6), 10, { ...MOTE(k), size: 1.8, life: [0.3, 0.6], speed: [0.2, 0.5], up: [-4, 8], gravity: 0 }),
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
   * slam into place round whoever it is on, square to the land and never in
   * front of them, the near pair out wider and the far pair closer and
   * higher, so the four stand on a ring; every three seconds one catches the
   * light, and every six they snap half round the body and stop, with a
   * minute's tally of twelve ticks at their feet.
   */
  justice_retribution: {
    palette: PALETTE,
    cast: { timing: RETRIBUTION_T, pose: retributionPose },
    fx: {
      charge: (k, t) => {
        // The plates drawn in round the priest's chest as the arms cross, close and small, before they are flung out.
        const g = smooth(seg(t, 0.12, 0.42)) * (1 - smooth(seg(t, 0.5, 0.56)));
        if (g > 0) plates(k, k.caster, lerp(15, 10, g), 0.62, snapTurn(t * 3 - 0.5), g, 2.5 + 1.5 * g);
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
        // Thrown out from the body, away from whoever cast it (or round it, on oneself), not bunched on the chest.
        const far = Math.hypot(k.target.x - k.caster.x, k.target.y - k.caster.y) > 0.3;
        k.burst(k.at(k.target, 0.55), 10, { kind: 'spark', size: 1.8, colour: [k.pal.core, STEEL], life: [0.2, 0.4], speed: [0.8, 1.5], up: [-6, 10], gravity: 10, drag: 0.05, ...(far ? { heading: k.toward(k.caster, k.target), cone: 1.2 } : {}) });
      },
      impact: {
        secs: 0.7,
        draw: (k, u) => {
          const b = k.target;
          // Out from the body and slammed home, a little past and back: a guard taken up.
          const out = easeBack(seg(u, 0, 0.35));
          plates(k, b, lerp(5, 11, out), 0.55, 0, 1, lerp(4, 6.5, out) - 0.5 * seg(u, 0.35, 1), u < 0.35 ? -1 : 0);
          const f = flashOf(seg(u, 0.3, 0.5));
          for (let i = 0; i < 4 && u < 0.5; i++) k.flare(plateAt(k, b, 11, b.z + b.tall * 0.55, 0, i), 4 * f, f);
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
        k.burst(k.on(k.spot.x, k.spot.y, 1), 18, { ...MOTE(k), size: 1.8, life: [0.5, 0.9], speed: [0.1, 0.5], up: [-14, -4], gravity: 0, jitter: 0.3 });
        k.burst(k.on(k.spot.x, k.spot.y, 0.5), 10, { kind: 'dust', colour: '#8a7d68', size: 3, life: [0.4, 0.8], speed: [0.3, 0.8], up: [1, 5], gravity: 2 });
      },
      impact: {
        // The soundings; the bob and the square it hangs over are the linger's from the moment it lands, so nothing of
        // them changes hands between the two.
        secs: ASSAY_IMPACT,
        draw: (k, u) => {
          const s = k.spot;
          for (let i = 0; i < 3; i++) {
            const v = seg(u, 0.1 + i * 0.16, 0.62 + i * 0.16);
            if (v <= 0 || v >= 1) continue;
            const rr = 0.2 + (ASSAY_R - 0.2) * easeOut(v);
            const fade = (1 - v * v) * (i ? 0.55 : 0.95);
            // The first sounding broad and bright, a band of light under its rule, so it reads at play size.
            if (!i) k.ring(s, rr, { band: 0.08, alpha: 0.7 * fade, glow: 0.8, n: Math.max(24, k.facets(rr)) });
            tally(k, s, rr, 24, 24, { alpha: fade, tick: i ? 0.22 + 0.1 * (1 - v) : 0.35, turn: i * 0.13, band: i ? 1 : 2, dry: v });
          }
          k.light(s, 2 + seg(u, 0.1, 0.6), 0.7 * (1 - 0.6 * u));
        },
      },
      linger: {
        on: 'spot',
        draw: (k, age, left) => {
          const a = smooth(left / 2);
          if (a <= 0.01) return;
          const s = k.spot;
          // The bob drops onto the spot and stops a hand over it, swinging and settling; then hangs there, breathing.
          const drop = easeOut(clamp(age / (ASSAY_IMPACT * 0.12)));
          const settle = smooth(age / ASSAY_IMPACT);
          const lift = lerp(30, 6, drop) + Math.sin(age * 1.2) * 0.6 * settle;
          const swing = Math.sin(age * 5.8) * 1.5 * (1 - settle) + Math.sin(age * 0.9) * 1.2 * settle;
          plumb(k, s, lift, a * smooth(age / 0.15) * lerp(1, 0.7, smooth(seg(age, ASSAY_IMPACT * 0.6, ASSAY_IMPACT + 1))), swing);
          // Its square drawn on as the bob lands, then let down slowly to the quiet mark that stays.
          const quiet = smooth(seg(age, ASSAY_IMPACT * 0.6, ASSAY_IMPACT + 2));
          square(k, s, 0.5, { band: lerp(0.07, 0.045, quiet), alpha: lateFade(left, 0.5) * lerp(0.95, 0.85, quiet), glow: lerp(1, 0.6, quiet), draw: seg(age, 0.19, 0.72), dry: 0.45 * quiet });
          // Every ten seconds a faint sounding goes out to the reach again: the seams are still marked.
          const v = (((age - ASSAY_IMPACT) % 10) - 7.4) / 2.6;
          if (age > ASSAY_IMPACT && v > 0 && v < 1) tally(k, s, 0.3 + (ASSAY_R - 0.3) * easeOut(v), 24, 24, { alpha: 0.3 * a * (1 - v * v), tick: 0.2 });
          if (!k.fast && age > ASSAY_IMPACT) k.emit(k.on(s.x, s.y, 4), 1.2 * a, { ...MOTE(k), size: 1.4, life: [0.8, 1.2], speed: [0.01, 0.04], up: [-6, -3], gravity: 0, jitter: 0.25 });
          if (age > ASSAY_IMPACT) k.light(s, 1.2, 0.22 * a * smooth(seg(age, ASSAY_IMPACT, ASSAY_IMPACT + 1)));
        },
      },
    },
  },

  /*
   * Sentence (on an enemy: a quarter of the health it has already lost). A
   * pair of scales hangs over the creature and tips as the priest's two hands
   * weigh; the hands press down, the loaded pan slams, and its weight drops
   * straight onto the creature's back and breaks there. The scales come back
   * level and go: weighed and paid.
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
        // A light in each palm, its own colour laid over the grass rather than added to it.
        for (const s of [0, 1] as const) k.glow(k.hand(s), 3, 0.6 * a, k.pal.core, true);
        k.light(k.target, 2, 0.4 * a);
      },
      release: (k) => k.burst(mid3(k.hand(0), k.hand(1), 0.5), 8, { ...MOTE(k), size: 1.6, life: [0.2, 0.4], speed: [0.1, 0.3], up: [-10, -2], gravity: 0 }),
      travel: {
        secs: () => 0.2,
        draw: (k, u) => {
          const piv = sentencePivot(k);
          scales(k, piv, SENTENCE_SIZE, 0.42 - 0.1 * u, { at: k.target, bias: 4 });
          // The weight, off the low pan and falling, quicker and quicker, drawn in over the creature so it lands on its back.
          const s = SENTENCE_SIZE;
          const tilt = 0.42 - 0.1 * u;
          const fromZ = piv.z - s * 0.62 - s * 0.62 * Math.sin(tilt);
          const z = lerp(fromZ, k.target.z + k.target.tall * 0.95, easeIn(u));
          box(k, { x: k.target.x, y: k.target.y, z }, 3.2 + u, { spin: Math.PI / 4, dx: k.hpx(s) * 0.62 * Math.cos(tilt) * (1 - smooth(u)) });
          k.beam({ x: k.target.x, y: k.target.y, z: z + 2 }, { x: k.target.x, y: k.target.y, z: z + 2 + 10 * u }, { width: 1, alpha: 0.5 * u, glow: 0.4 });
        },
      },
      hit: (k) => {
        const at = k.at(k.target, 0.95);
        k.burst(at, 10, { kind: 'shard', colour: [STEEL, k.pal.main, k.pal.deep], size: 2.2, life: [0.4, 0.8], speed: [0.5, 1.2], up: [10, 26], gravity: 70, drag: 0.4, spin: 2 });
        flatSparks(k, k.at(k.target, 0.3), 12, 1.4);
        k.burst(k.at(k.target, 0.05), 8, { kind: 'dust', colour: '#8a7d68', size: 3, life: [0.4, 0.7], speed: [0.3, 0.7], up: [1, 4], gravity: 2 });
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const piv = sentencePivot(k);
          // Level again, lifting away.
          scales(k, { ...piv, z: piv.z + 6 * smooth(u) }, SENTENCE_SIZE, 0.32 * (1 - easeOut(seg(u, 0, 0.5))) * Math.cos(u * 9), { alpha: 1 - smooth(seg(u, 0.45, 1)), at: k.target, bias: 4 });
          squareOut(k, k.target, seg(u, 0, 0.7), footR(k.target) + 0.12);
          // A small hard glint where the weight lands, on the top of its back -- not a flash over the whole of it.
          const f = flashOf(seg(u, 0, 0.4));
          k.flare(k.at(k.target, 1.0), 8 * f, 0.7 * f, k.pal.core, Math.PI / 4);
          k.light(k.target, 3, 0.8 * (1 - u));
        },
      },
    },
  },

  /*
   * Bind (on an enemy, 5 s held; a monster half that). The priest's wrists
   * are bound before the face, a short chain between the cuffs, and wrenched
   * apart, snapping it; a line runs over the ground to the creature, four
   * stakes punch up at the corners of a square round it and chains snap from
   * them to a hoop at its waist, taut, the far ones behind it and the near ones
   * kept low so its body shows. It strains against them; a tally of five
   * ticks, one a second, goes out at its feet; and at the end the chains break.
   */
  justice_bind: {
    palette: PALETTE,
    cast: { timing: BIND_T, pose: bindPose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.1, 0.42)) * (1 - smooth(seg(t, 0.55, 0.7)));
        if (g <= 0) return;
        // A cuff on each wrist, apart, and the two-link chain between them that the wrench snaps.
        // Each a little up its forearm from the wrist, so where the wrists cross the two cuffs stay two.
        const w0 = k.joint(k.caster, 'wrist0', [0, 0, 2.2]), w1 = k.joint(k.caster, 'wrist1', [0, 0, 2.2]);
        for (const side of [0, 1] as const) cuff(k, side, g);
        if (t < 0.5) chain(k, w0, w1, { alpha: g, sag: 0.6, link: 2.2, glow: 0, bias: 2 });
        if (once(k, 'snap', t >= 0.5)) k.burst(mid3(w0, w1, 0.5), 10, { kind: 'spark', size: 1.6, colour: [k.pal.core, STEEL], life: [0.15, 0.3], speed: [0.3, 0.8], up: [-4, 8], gravity: 30 });
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
        // Low, at its feet, where the stakes go in: not a spray over the creature.
        flatSparks(k, k.at(k.target, 0.05), 8, 0.9);
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
          const R = Math.max(5, b.wide * 1.25);
          const waist = b.z + b.tall * 0.48;
          const by = k.eye.worldToScreenY(b.x, b.y, 0);
          const all = stakes(b);
          // The stake nearest the viewer: its chain is kept low and slack, so it does not run up across the body.
          let nearest = 0;
          for (let i = 1; i < 4; i++) if (k.eye.worldToScreenY(all[i].x, all[i].y, 0) > k.eye.worldToScreenY(all[nearest].x, all[nearest].y, 0)) nearest = i;
          let i = 0;
          for (const s of all) {
            post(k, s, 6 * up * (broke ? fade : 1), { wide: 0.8, cap: 1.4, glow: 0.5 });
            // The creature straining: each chain shivers as it pulls, out of step with the rest.
            const strain = Math.max(0, Math.sin(age * 5.3 + i * 1.9)) * 0.9;
            const top = k.on(s.x, s.y, 6 * up);
            // To the near side of the waist hoop, toward its stake: the chain holds the hoop, not the creature's heart.
            const d = k.toward(b, s);
            const low = i === nearest;
            const end: P3 = { x: b.x + (d.x * R * 0.8) / 40, y: b.y + (d.y * R * 0.8) / 40, z: low ? b.z + b.tall * 0.14 : waist };
            const far = k.eye.worldToScreenY(s.x, s.y, 0) < by;
            if (!broke) chain(k, top, mid3(top, end, reach), { sag: 0.4 + strain + (low ? 1.4 : 0), alpha: reach, link: 4.4, sortAt: k.on(s.x, s.y), bias: far ? -4 : 2 });
            i++;
          }
          // The hoop the chains hold, its front half faint so it does not band across the creature; the stakes mark the
          // square's corners, so no square is drawn.
          if (!broke) hoop(k, b, 0.48, R, { alpha: 0.6 * reach, width: 1.8, colour: STEEL, front: 0.35 / 0.6 });
          tally(k, b, footR(b), BIND_TICKS, (BIND_TICKS * left) / Math.max(0.1, BIND_LASTS), { alpha: 0.75 * up * fade });
          k.light(b, 2, 0.35 * fade);
        },
      },
    },
  },

  /*
   * Equity (on a friend: both end at the average of your healths). The priest
   * stands as a balance, arms out, tipping; over the two of them a beam hangs,
   * square to the screen as a sign is and never shorter than a body's width
   * either side of its pivot, a pan hung from each end on a cord just over each
   * of their heads, tipping with the body. At the release it comes level, light
   * runs along it both ways, and each pan itself comes down round its own body
   * to the feet and lies there as a square, the two the same size, held a
   * moment and dried away.
   */
  justice_equity: {
    palette: PALETTE,
    cast: { timing: EQUITY_T, pose: equityPose },
    fx: {
      charge: (k, t) => {
        if (t >= EQUITY_T.release) return;
        const a = smooth(seg(t, 0.08, 0.24));
        if (a > 0) equityBeam(k, 0.3 * equityTip(t), a, 1);
      },
      release: (k) => {
        k.burst(equityPivot(k), 12, { ...MOTE(k), size: 1.8, life: [0.3, 0.6], speed: [0.2, 0.5], up: [-4, 8], gravity: 0 });
      },
      hit: (k) => {
        for (const b of [k.caster, k.target]) k.burst(k.at(b, 0.5), 10, { ...MOTE(k), size: 1.8, life: [0.4, 0.8], speed: [0.1, 0.3], up: [4, 12], gravity: 0, jitter: 0.1 });
      },
      impact: {
        secs: EQUITY_IMPACT,
        draw: (k, u) => {
          const secs = u * EQUITY_IMPACT;
          const a = 1 - smooth(seg(secs, 0.6, 0.95));
          // The pans hang on till the light has met; then each pan itself comes down round its own body, from where it
          // hung to the feet, opening out into a ring as it goes, and lies there as a square -- the two the same size.
          const down = smooth(seg(secs, 0.55, 1.0));
          equityBeam(k, 0, a, down > 0 ? 0 : 1);
          const piv = equityPivot(k);
          const flow = seg(secs, 0, 0.5);
          if (flow > 0 && flow < 1) {
            // Light along it both ways: from each end to the middle and on to the other end.
            const l = equityEnd(k, k.caster), r = equityEnd(k, k.target);
            k.orb(mid3(l, r, smooth(flow)), 2.2, { alpha: 1 - flow * 0.4, glow: 0.8 });
            k.orb(mid3(r, l, smooth(flow)), 2.2, { alpha: 1 - flow * 0.4, glow: 0.8 });
          }
          const f = flashOf(seg(secs, 0.24, 0.65));
          k.flare(piv, 9 * f, f, k.pal.core, 0);
          for (const b of [k.caster, k.target]) {
            const r = Math.max(7, b.wide * 2);
            if (down > 0 && down < 1) {
              const pan = equityPan(k, b, equityEnd(k, b));
              const at = { ...b, x: lerp(pan.at.x, b.x, smooth(seg(down, 0, 0.6))), y: lerp(pan.at.y, b.y, smooth(seg(down, 0, 0.6))) };
              hoop(k, at, lerp(pan.share, 0.02, down), lerp(Math.max(3.4, b.wide * 0.8), r, smooth(seg(down, 0, 0.5))), { alpha: 1, width: 1.8 });
            }
            // Laid at the feet, held a while, then dried down to the deep tone and let go.
            const lie = secs - 1.0;
            if (lie >= 0) {
              const v = seg(lie, 0.4, EQUITY_IMPACT - 1.0);
              square(k, b, r / 40 + 0.03 * smooth(seg(lie, 0, 0.2)), { band: 0.09, alpha: lateFade(EQUITY_IMPACT - secs, 0.15), glow: 0.8, studs: false, dry: v });
            }
          }
          k.light(piv, 2, 0.6 * (1 - u));
        },
      },
    },
  },

  /*
   * Verdict (on an enemy: dies below 20%, a monster 10%; else a tenth of its
   * health). While the priest deliberates a square closes in on the ground
   * round the creature and a sword of light forms up beside it, raised by no
   * hand; the priest's arm goes up, the sword cocks back with it, and as the
   * arm cuts down to point at the creature the sword is swung down through it
   * in one white arc. It leaves a single straight cut across the ground at the
   * creature's feet, which dries and fades.
   */
  justice_verdict: {
    palette: PALETTE,
    cast: { timing: VERDICT_T, pose: verdictPose },
    fx: {
      charge: (k, t) => {
        const b = k.target;
        const close = smooth(seg(t, 0.16, 0.6));
        if (t >= VERDICT_T.release) return;
        square(k, b, lerp(1, footR(b) + 0.1, close), { band: 0.06, alpha: 0.9, glow: 0.6, draw: seg(t, 0.12, 0.36) });
        const form = smooth(seg(t, 0.26, 0.46));
        if (form > 0) {
          const v = verdictSwing(k);
          const ang = verdictAngle(k, t);
          swungSword(k, b, v.x, v.y, ang, VERDICT_LEN, { show: form, alpha: Math.min(1, form * 1.6), from: t > 0.53 ? verdictAngle(k, Math.max(0.53, t - 0.03)) : ang, clear: k.caster });
          k.glow(b, 10, 0.3 * form);
          k.light(b, 2.5, 0.5 * form);
        }
        k.glow(k.hand(1), 5, 0.6 * bump(t, 0.36, 0.5, 0.62));
      },
      hit: (k) => {
        const b = k.target;
        const v = verdictSwing(k);
        // Thrown out along the cut, the way the blade went through.
        const way = groundWay(k, b, -Math.sin(v.through), Math.cos(v.through));
        k.burst(k.at(b, 0.1), 24, { kind: 'spark', size: 2, colour: [k.pal.core, k.pal.main, STEEL], life: [0.2, 0.45], speed: [0.8, 2], up: [2, 12], gravity: 50, drag: 0.05, heading: way, cone: 0.5 });
        k.burst(k.at(b, 0.5), 8, { kind: 'shard', colour: [STEEL, k.pal.main], size: 1.8, life: [0.3, 0.6], speed: [0.4, 1], up: [8, 20], gravity: 60, drag: 0.3, heading: way, cone: 0.9 });
        k.burst(k.at(b, 0.05), 8, { kind: 'dust', colour: '#8a7d68', size: 3, life: [0.4, 0.8], speed: [0.3, 0.8], up: [1, 5], gravity: 2 });
      },
      impact: {
        secs: 1.1,
        draw: (k, u) => {
          const b = k.target;
          const v = verdictSwing(k);
          const secs = u * 1.1;
          // A beat at the end of the cut, the blade still through it; then it goes, its arc eaten from the tail first.
          const over = v.end + v.s * 0.06 * Math.sin(Math.min(1, secs / 0.16) * Math.PI);
          const tail = lerp(v.end - (v.end - v.start) * 0.55, v.end, smooth(secs / 0.22));
          // Gone by a quarter second, before it can read as laid there.
          swungSword(k, b, v.x, v.y, over, VERDICT_LEN, { alpha: 1 - smooth(seg(secs, 0.1, 0.25)), from: tail, trail: 1 - smooth(seg(secs, 0.06, 0.24)), clear: k.caster });
          verdictCut(k, easeOut(seg(secs, 0, 0.1)), smooth(seg(secs, 0.25, 1)), 1 - smooth(seg(u, 0.7, 1)));
          square(k, b, footR(b) + 0.1, { band: 0.06, alpha: 0.9 * lateFade(0.6 - u, 0.12), glow: 0.6, dry: seg(u, 0.2, 0.5) });
          const f = flashOf(seg(u, 0, 0.3));
          k.flare(k.at(b, 0.5), 9 * f, 0.8 * f, k.pal.core, v.through);
          k.light(b, 2.5, 0.8 * (1 - u));
        },
      },
    },
  },

  /*
   * Summons (on an enemy, 20 s, it hunts only you). The priest holds out an
   * open hand; a chain is thrown from it and its collar shuts round the
   * creature's neck; the hand shuts and hauls, the chain snaps taut and a
   * pulse runs down it to the priest. For the twenty seconds after, a needle
   * over the creature -- a drawn-out lozenge with two chevrons behind it --
   * points at the priest wherever they go, a thread of beads, three to a tile,
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
          const from = k.hand(1), to = collarAt(k, k.target);
          const head = arcAt(from, to, u, 4 + k.dist);
          chain(k, from, head, { sag: 2 * (1 - u), link: 2.8 });
          hoop(k, { x: head.x, y: head.y, z: head.z - 1, tall: 2, wide: 1, facing: 0, kind: 'spot' }, 0.5, 2.2, { width: 1.4, colour: STEEL });
        },
      },
      hit: (k) => {
        k.burst(collarAt(k, k.target), 14, { kind: 'spark', size: 1.8, colour: [k.pal.core, STEEL], life: [0.2, 0.4], speed: [0.5, 1.2], up: [-4, 12], gravity: 30 });
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const b = k.target;
          const collar = collarAt(k, b);
          const shut = easeBack(seg(u, 0, 0.18));
          hoop(k, { x: collar.x, y: collar.y, z: collar.z - 1, tall: 2, wide: b.wide, facing: b.facing, kind: 'spot' }, 0.5, lerp(9, Math.max(3, b.wide * 0.6), shut), { width: 1.8, colour: STEEL, alpha: 1 - smooth(seg(u, 0.75, 1)) });
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
          // Whole from the first frame it shows, growing in rather than thinning in over the grass, and let go by alpha
          // only at the very end.
          if (age < 0.5) return;
          const a = lateFade(left, 0.3), grow = lerp(0.4, 1, easeBack(clamp((age - 0.5) / 0.3)));
          if (a <= 0.01) return;
          const b = k.target;
          const head = over(k, b, 5);
          const me = k.chest();
          // Pointing the way it must go, toward you, snapped to the nearest of eight so it does not swim; nodding that
          // way again and again.
          const raw = screenDir(k, head, me);
          const ang = Math.round(Math.atan2(raw[1], raw[0]) / (Math.PI / 4)) * (Math.PI / 4);
          const dir: Pt = [Math.cos(ang), Math.sin(ang)];
          const nod = easeOut((age * 1.2) % 1) * (1 - ((age * 1.2) % 1));
          chevron(k, head, 8 * grow, { alpha: a, dir, glow: 0.7, dx: dir[0] * nod * 4 * k.zoom, dy: dir[1] * nod * 4 * k.zoom, solid: true });
          const n = ticksFor(lastsOf('justice_summons'));
          tally(k, b, footR(b), n, (n * left) / Math.max(1, lastsOf('justice_summons')), { alpha: 0.8 * a, grow: clamp((age - 0.5) / 0.4) });
          k.light(head, 1.2, 0.22 * a);
          // The thread it follows: beads running from it to you, near enough to be worth drawing, every other one a
          // lozenge with a light in it.
          const far = Math.hypot(me.x - b.x, me.y - b.y);
          if (far > 0.4 && far < 14) {
            const from = collarAt(k, b);
            const dots = Math.max(6, Math.min(16, Math.round(far * 3)));
            const xs: Array<[number, number, boolean]> = [];
            const step = (age * 1.4) % 1;
            for (let i = 0; i < dots; i++) {
              const u = (i + step) / dots;
              const p = mid3(from, me, u);
              const big = i % 2 === 0;
              xs.push([k.sx(p), k.sy(p), big]);
              if (i % 4 === 0) k.glow(p, 4, 0.35 * a * Math.sin(Math.PI * u));
            }
            const { main, core, ink } = k.pal;
            const r0 = Math.max(1.6, 1.8 * k.zoom);
            k.worldDraw(from.y > me.y ? from : me, (g) => {
              g.globalAlpha = a;
              for (const [x, y, big] of xs) {
                const r = big ? r0 * 1.25 : r0 * 0.7;
                poly(g, [[x, y - r], [x + r * 0.7, y], [x, y + r], [x - r * 0.7, y]], big ? core : main, ink, Math.max(0.6, 0.5 * k.zoom));
              }
            }, -1);
          }
        },
      },
    },
  },

  /*
   * Temper (on a thing carried, 30 minutes, it takes no wear). The priest
   * holds it out from the belly, leant away from the body to whichever side
   * keeps it clear of the head as the viewer sees it, the left palm laid along it, the
   * head bowed in a vigil: a band of light climbs it from the fist to its end,
   * dripping sparks like a quench; then the face lifts, a line of light goes
   * the length of it and a seal turns over it. For the half hour after, a
   * glint runs up it every few seconds.
   */
  justice_temper: {
    palette: PALETTE,
    cast: { timing: TEMPER_T, pose: temperPose },
    fx: {
      charge: (k, t) => {
        const climb = smooth(seg(t, 0.22, 0.58));
        const g = smooth(seg(t, 0.16, 0.26)) * (1 - smooth(seg(t, 0.6, 0.66)));
        if (g <= 0) return;
        k.glow(k.hand(0), 5, 0.5 * g);
        const at = temperAt(k, climb);
        const behindIt = temperAt(k, Math.max(0, climb - 0.3));
        k.beam(behindIt, at, { width: 2.2, alpha: g, glow: 0.8 });
        k.orb(at, 2, { alpha: g, glow: 1, sides: 6 });
        k.light(at, 1.5, 0.45 * g);
        if (climb > 0 && climb < 1) k.emit(at, 30, { kind: 'spark', size: 1.4, colour: [k.pal.core, k.pal.main], life: [0.2, 0.4], speed: [0.05, 0.25], up: [-4, 4], gravity: 60, drag: 0.2 });
      },
      release: (k) => {
        const at = temperAt(k, 1);
        if (temperBare(k)) {
          // Nothing held: the quench thrown out level from the joined hands, low, never up into the face.
          k.burst(at, 12, { kind: 'spark', size: 1.5, colour: [k.pal.core, k.pal.main], life: [0.15, 0.35], speed: [0.4, 0.9], up: [-8, 2], gravity: 40, over: true });
          return;
        }
        k.burst(at, 18, { kind: 'spark', size: 1.6, life: [0.2, 0.45], speed: [0.3, 0.9], up: [0, 16], gravity: 40 });
        k.burst(at, 10, { ...MOTE(k), size: 1.8, life: [0.4, 0.8], speed: [0.05, 0.2], up: [6, 14], gravity: 0, jitter: 0.06 });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const f = flashOf(u, 0.15);
          const a = temperAt(k, 0), b = temperAt(k, 1);
          k.beam(a, b, { width: 2.4, alpha: f, glow: 1.2 });
          // The seal over the end of what is kept; over the head when it is the bare hands, so it never sits on the face.
          const seal = temperBare(k) ? over(k, k.caster, 4) : { ...b, z: b.z + 4 };
          lozenge(k, seal, 4 * lerp(0.4, 1, easeBack(clamp(u / 0.2))), { alpha: lateFade((1 - u) * 0.6, 0.15), spin: flipTurn(u * 3), glow: 0.8 });
          k.light(a, 2, 0.6 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          // A glint up the length of it every six seconds: it is kept.
          const v = ((age - 1) % 6) / 0.6;
          if (age < 1 || v >= 1 || left < 0.5) return;
          k.flare(temperAt(k, smooth(v)), 4, Math.sin(Math.PI * v) * 0.8, k.pal.core, Math.PI / 4);
        },
      },
    },
  },

  /*
   * Judgment (6 tiles round a spot: every hunting creature there loses 15%
   * and takes 15% more for 30 s). A graduated ring draws itself on at the
   * reach and swords form high over every wild creature standing in it (and
   * over bare ground clear of people where there are fewer), point down; the
   * priest's arms come down pointing and the swords fall one after another
   * through them, each planting itself with sparks, stand, and go up. Every
   * creature struck then carries a small seal and its tally for the thirty
   * seconds it takes more damage.
   */
  justice_judgment: {
    palette: PALETTE,
    cast: { timing: JUDGMENT_T, pose: judgmentPose },
    fx: {
      release: (k) => {
        for (const s of [0, 1] as const) k.burst(k.hand(s), 6, { ...MOTE(k), size: 1.8, life: [0.2, 0.4], speed: [0.2, 0.6], up: [-12, -2], gravity: 0 });
      },
      charge: (k, t) => {
        const n = judgmentSwords(k);
        const on = t > 0.2 ? judged(k) : [];
        tally(k, k.spot, JUDGMENT_R, 24, 24, { grow: seg(t, 0.1, 0.56), alpha: 0.85, tick: 0.3, band: 1.6 });
        // Hung there until the arms come down; from the release the impact holds them and lets them fall.
        for (let i = 0; i < n && t < JUDGMENT_T.release; i++) {
          const form = judgmentForm(t, i, n);
          if (form <= 0) continue;
          const at = judgmentAt(k, i, n, on);
          sword(k, k.on(at.x, at.y, 56 + 6 * hashOf(k.seed + 3, i) + Math.sin(k.now * 2 + i) * 0.8), JUDGMENT_SWORD, { show: form, alpha: Math.min(1, form * 1.5), glow: 0.9, clear: k.caster });
        }
        k.light(k.spot, 2, 0.5 * seg(t, 0.2, 0.58));
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
            if (go >= 1) continue;
            const z = lerp(hang, -2, easeIn(v));
            // On bare ground, into it; on a creature, sorted just behind it, so the blade stands up out of its back and
            // its body hides the rest -- through it, at one record a sword rather than two.
            sword(k, k.on(at.x, at.y, z), JUDGMENT_SWORD, { alpha: 1 - go, glow: v < 1 ? 0.9 : 0.6, bias: body ? -4 : 1, clear: k.caster });
            if (once(k, `j${i}`, v >= 1)) {
              flatSparks(k, k.on(at.x, at.y, 1), 10, 1.2);
              if (body) k.burst(k.at(body, 0.6), 8, { kind: 'shard', colour: [STEEL, k.pal.main], size: 1.6, life: [0.3, 0.6], speed: [0.3, 0.8], up: [6, 16], gravity: 60, drag: 0.3 });
              k.burst(k.on(at.x, at.y, 0.5), 4, { kind: 'dust', colour: '#8a7d68', size: 2.8, life: [0.4, 0.7], speed: [0.3, 0.6], up: [1, 4], gravity: 2 });
            }
            // A square knocked out where a creature is struck; on bare ground only the sparks and the dust.
            if (body && i < 3 && after > 0) squareOut(k, at, clamp(after / 0.5), 0.36, 0.85);
          }
          tally(k, k.spot, JUDGMENT_R, 24, 24, { alpha: 0.85 * lateFade(1 - u, 0.15), tick: 0.3, band: 1.6, dry: smooth(seg(u, 0.4, 0.9)) });
          k.light(k.spot, 2, 0.8 * (1 - smooth(seg(u, 0.3, 1))));
        },
      },
      // Each creature it came down on carries the seal of a judged thing -- Mark of Judgment's, smaller -- and its tally,
      // for the seconds it takes more damage.
      linger: {
        on: 'spot',
        draw: (k, age, left) => {
          const lasts = lastsOf('justice_judgment');
          let i = 0, lit = 0;
          for (const b of judged(k).slice(0, JUDGED_MOST)) {
            // Each seal comes as its sword goes up, so the two never stand over it together.
            const t0 = judgmentFall(i++) + 0.14 + 1.05;
            const a = smooth((age - t0) / 0.3) * smooth(left / 0.8);
            if (!b || a <= 0.01) continue;
            const p = over(k, b, 3 + 0.5 * Math.sin(age * 1.6 + i));
            lozenge(k, p, 4.4, { alpha: 0.9 * a, spin: flipTurn(age / 2.5 + i * 0.3), glow: lerp(0.5, 1, k.night) });
            tally(k, b, footR(b), JUDGMENT_TICKS, (JUDGMENT_TICKS * left) / Math.max(1, lasts), { alpha: 0.7 * a, band: 0.6 });
            // Once the falling light is gone, a small light over the first of them, so the judged show after dark.
            if (age > JUDGMENT_IMPACT && !lit++) k.light(p, 1.2, 0.22 * a);
          }
        },
      },
    },
  },

  /*
   * Truce (8 tiles round a spot, 30 s, nothing there strikes or is struck).
   * A palisade of pale stakes railed together rises out of the ground round
   * exactly the eight tiles; a sheathed sword, its hilt bound to its scabbard
   * with a cord -- peace-bonded, not to be drawn -- comes gently down and
   * stands planted at the spot, beside whoever stands there and never through
   * them, the light washing out over the ground, and everyone inside gets a
   * cord of the bond round the waist. As the thirty seconds go the stakes go
   * down into the ground one by one, and when the last is down the sword
   * lifts away.
   */
  justice_truce: {
    palette: PALETTE,
    cast: { timing: TRUCE_T, pose: trucePose },
    fx: {
      release: (k) => {
        for (const s of [0, 1] as const) k.burst(k.hand(s), 5, { ...MOTE(k), size: 1.6, life: [0.4, 0.7], speed: [0.05, 0.2], up: [-6, 0], gravity: 0 });
      },
      charge: (k, t) => {
        if (t >= TRUCE_T.release) return;
        pales(k, 0, seg(t, 0.12, 0.6), 1);
        k.light(k.spot, 2, 0.4 * seg(t, 0.2, 0.5));
      },
      travel: {
        secs: () => 0.55,
        draw: (k, u) => {
          pales(k, 0, 1, 1);
          const at = trucePlant(k);
          sword(k, k.on(at.x, at.y, lerp(40, -3, easeOut(u))), TRUCE_SWORD, { alpha: smooth(u * 4), sheath: true, clear: k.caster });
          k.light(k.spot, 2, 0.6);
        },
      },
      hit: (k) => {
        const at = trucePlant(k);
        k.burst(k.on(at.x, at.y, 1), 30, { ...MOTE(k), size: 1.8, life: [0.6, 1.2], speed: [0.4, TRUCE_R * 0.25], up: [4, 12], gravity: 0, drag: 0.3 });
      },
      impact: {
        secs: 1.4,
        draw: (k, u) => {
          const v = easeOut(seg(u, 0, 0.8));
          // Dried toward the deep tone as it goes out, not thinned into the grass.
          k.ring(k.spot, 0.3 + (TRUCE_R - 0.3) * v, { band: 0.12 * (1 - v) + 0.03, alpha: 0.85 * lateFade(1 - v, 0.2), glow: 0.6, main: dry(k.pal.main, v, k.pal.deep), core: dry(k.pal.core, v, k.pal.main) });
          k.light(k.spot, 2.5, 0.6 * (1 - u));
        },
      },
      linger: {
        on: 'spot',
        draw: (k, age, left) => {
          const end = smooth(left / 1.2);
          pales(k, age, 1, 1);
          // Everyone inside, people and creatures, with a peace-bond round them: a cord at the waist. The nearest few only, so a
          // crowd costs no more than a handful.
          const inside = k.bodiesWithin(TRUCE_R).sort((a, b) => Math.hypot(a.x - k.spot.x, a.y - k.spot.y) - Math.hypot(b.x - k.spot.x, b.y - k.spot.y));
          for (const b of inside.slice(0, TRUCE_BONDS)) hoop(k, b, 0.45, Math.max(5, b.wide * 1.5), { alpha: 0.75 * end * smooth((age - 0.4) / 0.6), width: 1.6, colour: CORD });
          const lift = 1 - end;
          const at = trucePlant(k);
          sword(k, k.on(at.x, at.y, -3 + 20 * easeIn(lift)), TRUCE_SWORD, { alpha: end, sheath: true, clear: k.caster });
          k.light(k.on(at.x, at.y), 1.6, 0.35 * end);
          if (!k.fast) k.emit(k.on(k.spot.x, k.spot.y, 1), 3 * end, { ...MOTE(k), size: 1.5, life: [1, 1.8], speed: [0.02, 0.08], up: [4, 9], gravity: 0, jitter: TRUCE_R * 0.6 });
        },
      },
    },
  },

  /*
   * Restitution (on oneself or a friend: the latest grave's things come back
   * to their pack). The priest kneels and waits with cupped hands; behind
   * whoever it is on a headstone rises out of its mound, and one by one the
   * things come up out of the grave -- boxes, long bundles, flat cases -- and
   * arc over into their pack, each with a glint as it goes in; the priest
   * rises with the hands closed on the heart and the stone sinks away.
   */
  justice_restitution: {
    palette: PALETTE,
    cast: { timing: RESTITUTION_T, pose: restitutionPose },
    fx: {
      charge: (k, t) => {
        if (t >= RESTITUTION_T.release) return;
        const up = smooth(seg(t, 0.1, 0.42));
        const grave = restitutionGrave(k);
        headstone(k, grave, up, smooth(seg(t, 0.04, 0.16)));
        if (up > 0 && up < 1) k.emit(k.on(grave.x, grave.y, 0.5), 18, { kind: 'dust', colour: EARTH, size: 2.4, life: [0.3, 0.6], speed: [0.1, 0.4], up: [1, 4], gravity: 2, jitter: 0.12 });
        k.glow(mid3(k.hand(0), k.hand(1), 0.5), 5, 0.5 * seg(t, 0.2, 0.42));
        k.light(k.on(grave.x, grave.y, 6), 1.6, 0.4 * up);
      },
      impact: {
        secs: RESTITUTION_IMPACT,
        draw: (k, u) => {
          const grave = restitutionGrave(k);
          const sink = smooth(seg(u, 0.75, 1));
          headstone(k, grave, 1 - sink, 1 - smooth(seg(u, 0.88, 1)));
          const b = k.target;
          // The pack on the back, low enough that nothing comes in over the head.
          const pack = k.local(b, 0, -3.5, b.tall * 0.55);
          const secs = u * RESTITUTION_IMPACT;
          for (let i = 0; i < RESTITUTION_GOODS; i++) {
            const t0 = 0.05 + i * 0.13, v = (secs - t0) / 0.5;
            if (once(k, `in${i}`, v >= 1)) {
              k.burst(pack, 4, { ...MOTE(k), size: 1.6, life: [0.2, 0.4], speed: [0.1, 0.3], up: [2, 8], gravity: 0 });
              k.state.glint = secs;
            }
            if (v <= 0 || v >= 1) continue;
            // Each thing its own: every third a long bundle, a tool or a blade; the rest boxes and flat cases. Each up
            // out of the grave on an arc of its own height.
            const from = k.on(grave.x, grave.y, 6);
            const p = arcAt(from, pack, easeOut(v) * 0.4 + v * 0.6, 3 + 3 * hashOf(k.seed + 7, i));
            // Whole from the first, grown up out of the grave rather than thinned in over the grass; over the last of the
            // way sorted behind the body, so each goes in at the back and never across the chest.
            const g = lerp(0.4, 1, smooth(clamp(v * 5)));
            const spin = flipTurn(v * 2 + i), bias = v > 0.8 ? -2 : 2;
            if (i % 3 === 0) box(k, p, 2.2 * g, { spin, long: 2.4, tall: 0.6, bias });
            else if (i % 3 === 1) box(k, p, 2.6 * g, { spin, bias });
            else box(k, p, 3 * g, { spin, tall: 0.35, bias });
          }
          const since = secs - (k.state.glint ?? -9);
          k.flare(pack, 5 * flashOf(clamp(since / 0.3)), flashOf(clamp(since / 0.3)), k.pal.core, Math.PI / 4);
          k.light(k.on(grave.x, grave.y, 6), 1.6, 0.4 * (1 - sink));
          k.light(b, 2, 0.4 * (1 - u));
        },
      },
    },
  },

  /*
   * Execution (on an enemy: dies below 50%, a monster 30%; else a fifth of its
   * health). The priest's joined hands go up and up, on the toes, trembling,
   * and over the creature a great sword draws itself on, point down, in two
   * squares closing round it; the whole body bows and the sword comes down
   * through it, the ground cracking out square and white, and is driven on in
   * to the hilt; it stands there a moment and breaks, its pieces thrown out.
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
        square(k, b, lerp(1.5, footR(b) + 0.2, close), { band: 0.08, alpha: 0.95, glow: 0.9, draw: seg(t, 0.08, 0.3) });
        square(k, b, lerp(1.0, footR(b) + 0.06, close), { band: 0.035, alpha: 0.9, glow: 0, studs: false, draw: seg(t, 0.2, 0.34), dry: 0.4 });
        if (form > 0) {
          const hang = b.tall + 36 + 4 * (1 - form);
          sword(k, { x: b.x, y: b.y, z: b.z + hang }, EXECUTION_LEN, { show: form, alpha: Math.min(1, form * 1.4), glow: 0.6 + 0.6 * form, clear: k.caster });
          k.emit({ x: b.x, y: b.y, z: b.z + hang + EXECUTION_LEN * 0.3 }, 30 * form, { ...MOTE(k), size: 1.8, life: [0.4, 0.7], speed: [0.3, 0.6], up: [-4, 4], gravity: 0, drag: 0.02, jitter: 0.5, jitterZ: 12 });
          k.light(b, 2, 0.7 * form);
        }
        k.glow(mid3(k.hand(0), k.hand(1), 0.5), 6, 0.7 * bump(t, 0.3, 0.55, 0.64));
      },
      travel: {
        secs: () => 0.13,
        draw: (k, u) => {
          const b = k.target;
          const z = lerp(b.z + b.tall + 36, b.z - 8, easeIn(u));
          sword(k, { x: b.x, y: b.y, z }, EXECUTION_LEN, { through: b, glow: 1.2, clear: k.caster });
          k.beam({ x: b.x, y: b.y, z: z + EXECUTION_LEN * 0.95 }, { x: b.x, y: b.y, z: z + EXECUTION_LEN * 0.95 + 40 * u }, { width: 2.2, alpha: 0.6, glow: 0.5 });
          square(k, b, footR(b) + 0.2, { band: 0.08, alpha: 0.95, glow: 0.9 });
          // The inner square held where the charge left it until the blow lands.
          square(k, b, footR(b) + 0.06, { band: 0.035, alpha: 0.9, glow: 0, studs: false, dry: 0.4 });
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
          // Driven on in after the blow, to the hilt, over a sixth of a second.
          const tipZ = b.z - lerp(8, EXECUTION_DEPTH, easeOut(secs / 0.16));
          const shatter = secs > 1.0;
          if (once(k, 'shatter', shatter)) {
            // The dust of it: a few small chips and motes going up, under the great pieces.
            k.burst({ x: b.x, y: b.y, z: tipZ + EXECUTION_LEN * 0.8 }, 16, { kind: 'shard', colour: [k.pal.core, STEEL, k.pal.main], size: 1.6, life: [0.3, 0.6], speed: [0.3, 0.9], up: [0, 12], gravity: 40, drag: 0.3, spin: 3, ink: false });
            k.burst(k.at(b, 1.5), 16, { ...MOTE(k), size: 2, life: [0.5, 1], speed: [0.2, 0.6], up: [4, 18], gravity: 0, jitterZ: 16 });
          }
          if (!shatter) sword(k, { x: b.x, y: b.y, z: tipZ }, EXECUTION_LEN, { through: b, glow: 1 - 0.5 * u, clear: k.caster });
          else brokenSword(k, b, tipZ, (secs - 1.0) / 0.5, 1);
          cracks(k, b, 1.6, 8, { grow: easeOut(seg(u, 0, 0.08)), alpha: 1 - smooth(seg(u, 0.55, 1)) });
          squareOut(k, b, seg(u, 0, 0.45), 1.3);
          squareOut(k, b, seg(u, 0.1, 0.6), 0.8, 0.7);
          square(k, b, footR(b) + 0.2, { band: 0.08, alpha: 0.95 * lateFade(0.8 - u, 0.1), glow: 0.9, dry: seg(u, 0.45, 0.75) });
          const f = flashOf(seg(u, 0, 0.3));
          k.flare(k.at(b, 0.6), 24 * f, f, k.pal.core, Math.PI / 4);
          k.light(b, 2, 1 - 0.8 * u);
        },
      },
    },
  },

  /*
   * Oath (on a friend, 10 minutes, every blow on either split between you).
   * A hand raised out beside the head and sworn, a seal at the palm; it is held
   * out to the friend and a cord of two strands twists out from heart to
   * heart, a knot of two linked seals over its middle. For the ten minutes
   * after, a pair of linked seals hangs over each of the two, brightening
   * together with the pulse along the faint cord that joins them when near.
   */
  justice_oath: {
    palette: PALETTE,
    cast: { timing: OATH_T, pose: oathPose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.18, 0.4)) * (1 - smooth(seg(t, 0.44, 0.5)));
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
        for (const b of [k.caster, k.target]) k.burst(k.chest(b), 8, { ...MOTE(k), size: 1.8, life: [0.3, 0.6], speed: [0.1, 0.4], up: [0, 10], gravity: 0 });
      },
      impact: {
        secs: OATH_IMPACT,
        draw: (k, u) => {
          const a = k.chest(), b = k.chest(k.target);
          braid(k, a, b, 3 * (1 - 0.6 * smooth(u)), k.now * 8 * (1 - u), { alpha: 1 - smooth(seg(u, 0.6, 1)) });
          const mid = mid3(a, b, 0.5);
          // Whole from its first frame, grown in rather than thinned in over the grass, and let go only at the very end.
          sworn(k, { ...mid, z: mid.z + 4 + 4 * smooth(u) }, 5.4 * lerp(0.4, 1, easeBack(clamp(u / 0.15))), lateFade((1 - u) * OATH_IMPACT, 0.25), snapTurn(u * 2));
          for (const p of [a, b]) k.flare(p, 6 * flashOf(seg(u, 0, 0.4)), flashOf(seg(u, 0, 0.4)), k.pal.core, Math.PI / 4);
          k.light(mid, 2.5, 0.5 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          // Each pair grows in over its head as the knot goes, whole from its first frame, and goes by alpha only at the end.
          if (age < OATH_IMPACT * 0.75) return;
          const a = lateFade(left, 0.4), grow = lerp(0.4, 1, easeBack(clamp((age - OATH_IMPACT * 0.75) / 0.3)));
          if (a <= 0.01) return;
          // Every five seconds a pulse along the cord between them, and both their seals brighten with it: the burden shared.
          const v = (age % 5) / 0.8;
          const pulse = v < 1 ? Math.sin(Math.PI * v) : 0;
          for (const b of [k.caster, k.target]) {
            const p = over(k, b, 5);
            sworn(k, p, 5.4 * grow, a, snapTurn(age / 4));
            if (pulse > 0.02) k.glow(p, 9, 0.5 * pulse * a);
          }
          const p = k.chest(), q = k.chest(k.target);
          const far = Math.hypot(p.x - q.x, p.y - q.y);
          if (far < 12) braid(k, p, q, 1.6, age * 0.6, { alpha: 0.22 * a + 0.3 * pulse * a });
        },
      },
    },
  },

  /*
   * Due Reward (on oneself or a friend, 30 minutes, every skill gains 20%
   * more). The hands are held cupped low to receive and then lifted to the
   * shoulders and opened wide; a seal comes down over whoever it is on, and
   * rank on rank of chevrons climbs up over their head and stacks there while
   * a tally of ticks lights up round their feet, counting up rather than down.
   * For the half hour after, a small chevron rises over their head now and
   * then.
   */
  justice_reward: {
    palette: PALETTE,
    cast: { timing: REWARD_T, pose: rewardPose },
    fx: {
      charge: (k, t) => {
        if (t >= REWARD_T.release) return;
        const g = smooth(seg(t, 0.3, 0.46));
        if (g <= 0) return;
        // Formed out before the cupped hands at their height, and held there while the hands rise past it to the
        // shoulders -- so it never comes up to the face -- then lifted away over the head as the arms open.
        if (t <= 0.36 || k.state.rewardZ === undefined) k.state.rewardZ = mid3(k.hand(0), k.hand(1), 0.5).z - k.caster.z;
        const p = rewardSeal(k, smooth(seg(t, 0.5, REWARD_T.release)));
        lozenge(k, p, 1.5 + 3.5 * g, { spin: flipTurn(t * 4), glow: 1 });
        k.light(p, 1.6, 0.4 * g);
      },
      travel: {
        secs: (tiles) => (tiles < 0.3 ? 0 : 0.2 + tiles * 0.05),
        draw: (k, u) => {
          const from = rewardSeal(k, 1), to = over(k, k.target, 8);
          const p = arcAt(from, to, smooth(u), 6 + k.dist * 2);
          lozenge(k, p, 4.6, { spin: flipTurn(u * 4), glow: 1 });
          k.light(p, 1.6, 0.4);
        },
      },
      hit: (k) => k.burst(over(k, k.target, 8), 12, { ...MOTE(k), size: 1.8, life: [0.4, 0.7], speed: [0.1, 0.4], up: [-6, 8], gravity: 0 }),
      impact: {
        secs: REWARD_IMPACT,
        draw: (k, u) => {
          const b = k.target;
          const secs = u * REWARD_IMPACT;
          for (let i = 0; i < REWARD_RANKS; i++) {
            const v = clamp((secs - 0.1 - i * 0.14) / 0.5);
            if (v <= 0) continue;
            // Up from the shoulders to a stack over the head, the first ending highest: never across the face.
            const top = b.tall + 4 + (REWARD_RANKS - 1 - i) * 3.4;
            const z = lerp(b.tall * 0.95, top, easeOut(v));
            // Grown in whole rather than thinned in, and let go by alpha only at the very end.
            chevron(k, { x: b.x, y: b.y, z: b.z + z }, (6 - i * 0.4) * lerp(0.4, 1, easeOut(clamp(v * 4))), { alpha: lateFade((1 - u) * REWARD_IMPACT, 0.25), glow: 0.6 });
          }
          lozenge(k, over(k, b, 8), 4.6 * (1 - smooth(seg(u, 0.1, 0.4))), { glow: 1 });
          const n = 12;
          tally(k, b, footR(b) + 0.05, n, n * easeOut(seg(u, 0.1, 0.7)), { alpha: lateFade((1 - u) * REWARD_IMPACT, 0.25) });
          k.light(b, 2, 0.6 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          if (age < REWARD_IMPACT || left < 0.5) return;
          // Every four seconds a small rank rises over the head and fades: the half hour of gain, quietly.
          const v = ((age - REWARD_IMPACT) % 4) / 1.6;
          if (v >= 1) return;
          chevron(k, over(k, k.target, 3 + 5 * easeOut(v)), 3.2 * lerp(0.4, 1, easeOut(clamp(v * 4))), { alpha: lateFade((1 - v) * 1.6, 0.4), glow: lerp(0.5, 0.9, k.night) });
        },
      },
    },
  },
};

/* ---- Equity's balance ---------------------------------------------------------------------- */

/** A point over (x, y) on the ground that is drawn at screen height `Y`: for a thing hung square to the screen over two bodies. */
function atScreenY(k: FxScene, x: number, y: number, Y: number): P3 {
  const g = k.ground(x, y);
  const y0 = k.sy({ x, y, z: g }), y1 = k.sy({ x, y, z: g + 10 });
  return { x, y, z: g + (10 * (y0 - Y)) / (y0 - y1 || 1) };
}
/** Where on the screen Equity's beam hangs: level over both heads, high enough for a pan to hang over the higher of them. */
function equityY(k: FxScene): number {
  const top = Math.min(k.sy(over(k, k.caster, 0)), k.sy(over(k, k.target, 0)));
  return top - k.hpx(EQUITY_DROP + 9);
}
/** How far Equity's pans hang under its beam over the higher head, in height units; the other pan hangs on to its own head. */
const EQUITY_DROP = 5;
/** Half the shortest beam Equity hangs, in height units: seen with one of the two behind the other, it still has its length. */
const EQUITY_HALF = 11;
/** Where Equity's beam pivots: over the middle of the two of them on the ground, at the beam's height on the screen. */
function equityPivot(k: FxScene): P3 {
  const a = k.caster, b = k.target;
  return atScreenY(k, (a.x + b.x) / 2, (a.y + b.y) / 2, equityY(k) - k.hpx(1));
}
/**
 * One end of Equity's beam, the caster's or the friend's: at the beam's height on the screen whatever the turn of the
 * view -- so level looks level from every side -- tipped up or down by `tilt`, and across the screen over its own body,
 * but never nearer the middle than `EQUITY_HALF`: where one stands behind the other the ends go out to either side
 * (the caster's to the left), so the beam always has its length and the two pans hang apart.
 */
function equityEnd(k: FxScene, b: Body, tilt = 0): P3 {
  const mine = b === k.caster;
  const a = k.caster, c = k.target;
  const m = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  const dx = k.sx(c) - k.sx(a);
  const side = (mine ? -1 : 1) * (Math.abs(dx) < 1 ? 1 : Math.sign(dx));
  const across = side * Math.max(Math.abs(dx) / 2, k.hpx(EQUITY_HALF));
  // Along the ground the way that goes across the screen, as far as it takes to get there.
  const gw = groundWay(k, m, 1, 0), z = k.ground(m.x, m.y);
  const o = { x: m.x, y: m.y, z };
  const perTile = Math.abs(k.sx({ x: m.x + gw.x, y: m.y + gw.y, z }) - k.sx(o)) || 1;
  const s = ((k.sx(a) + k.sx(c)) / 2 + across - k.sx(o)) / perTile;
  return atScreenY(k, m.x + gw.x * s, m.y + gw.y * s, equityY(k) + (mine ? -1 : 1) * tilt * k.hpx(22));
}
/** Where a pan of Equity's hangs on the screen when the beam is level: its rim a little over its own body's head. */
const equityPanY = (k: FxScene, b: Body): number => k.sy(over(k, b, 3));
/**
 * Where a pan of Equity's is in the world (`end` the beam's end over it), and how far up its body's height that is:
 * where it starts from when it comes down round the body.
 */
function equityPan(k: FxScene, b: Body, end: P3): { at: P3; share: number } {
  const at = atScreenY(k, end.x, end.y, equityPanY(k, b));
  return { at, share: (at.z - b.z) / Math.max(1, b.tall) };
}
/**
 * Equity's beam, tipped `tilt`: a lozenge at its pivot on a rod from above, and from each end three cords to a pan hung
 * just over its own body's head (`pans`, 0..1, how much of the pans shows): everything over their heads, so nothing
 * crosses either body, and neither pan left hanging far over the nearer of the two.
 */
function equityBeam(k: FxScene, tilt: number, alpha: number, pans: number): void {
  if (alpha <= 0.01) return;
  const piv = equityPivot(k);
  const ends = [equityEnd(k, k.caster, tilt), equityEnd(k, k.target, tilt)];
  k.beam(ends[0], ends[1], { width: 2, alpha, glow: 0.6 });
  lozenge(k, piv, 4, { alpha, glow: 0.8 });
  k.beam({ ...piv, z: piv.z + 1 }, { ...piv, z: piv.z + 14 }, { width: 1, alpha: alpha * 0.6, glow: 0.3 });
  if (pans <= 0.01) return;
  const { core, main, ink } = k.pal;
  const iw = inkOf(k);
  [k.caster, k.target].forEach((b, i) => {
    const e = ends[i];
    const ex = k.sx(e), ey = k.sy(e);
    const pw = k.hpx(Math.max(3.4, b.wide * 0.8)), ph = pw * 0.3;
    // On cords as long as it takes to hang just over its own head, the tip of the beam carried down with it.
    const py = Math.max(ey + k.hpx(3), equityPanY(k, b) + Math.min(k.hpx(1.5), ey - equityY(k)));
    k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
      g.globalAlpha = clamp(alpha * pans);
      g.lineJoin = 'miter';
      g.lineWidth = Math.max(0.8, iw * 0.9);
      g.strokeStyle = main;
      // One cord down from the end to a ring a little over the pan, and three from the ring to its rim, as a pan is hung:
      // a long drop reads as a cord and not as a funnel.
      const ry = Math.max(ey, py - k.hpx(5));
      g.beginPath();
      g.moveTo(ex, ey);
      g.lineTo(ex, ry);
      for (const dx of [-pw * 0.9, pw * 0.1, pw * 0.9]) {
        g.moveTo(ex, ry);
        g.lineTo(ex + dx, py);
      }
      g.stroke();
      if (ry > ey + 1) poly(g, [[ex, ry - iw * 1.6], [ex - iw * 1.2, ry], [ex, ry + iw * 1.6], [ex + iw * 1.2, ry]], core, ink, iw * 0.7);
      poly(g, [[ex - pw, py], [ex + pw, py], [ex + pw * 0.6, py + ph], [ex - pw * 0.6, py + ph]], main, ink, iw);
      poly(g, [[ex - pw, py], [ex + pw, py], [ex + pw * 0.85, py + ph * 0.4], [ex - pw * 0.85, py + ph * 0.4]], core, null);
    }, 2);
  });
}

/** Whether Temper is cast with nothing in the hand: the grip and the tip are then the same fist. */
function temperBare(k: FxScene): boolean {
  const grip = k.joint(k.caster, 'grip'), tip = k.joint(k.caster, 'tip');
  return Math.hypot((tip.x - grip.x) * 40, (tip.y - grip.y) * 40, tip.z - grip.z) < 1.5;
}
/** Along the thing Temper is cast on, nought at the fist and one at its far end, wherever it is carried; between the hands when nothing is held. */
function temperAt(k: FxScene, u: number): P3 {
  if (temperBare(k)) return mid3(k.hand(1), k.hand(0), u * 0.5);
  return mid3(k.joint(k.caster, 'grip'), k.joint(k.caster, 'tip'), u);
}
