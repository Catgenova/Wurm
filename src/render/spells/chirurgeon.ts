/**
 * The Chirurgeon's spells: how each is cast and what it looks like.
 *
 * A Chirurgeon is a field surgeon, so every spell is drawn with a surgeon's
 * things, in mint for what mends and blood red for what bleeds:
 *
 *   - the dressing: a band of linen wound round a body (`wrap`), the back of
 *     it behind them and the front over them, so it reads as wound round and
 *     not painted on;
 *   - the suture: a gash, and cross stitches drawn along it (`suture`). How
 *     much of the gash is stitched is the spell's own `close` -- a Quick
 *     Stitch sews up three tenths of it, Battlefield Surgery half, and a
 *     Restoration or a Miracle Worker all of it -- so the picture is the
 *     number;
 *   - the tally: a ring of one segment a second round whatever a spell goes
 *     on working on (`tally`), one going out each second as the heal or the
 *     bleed ticks, so how long is left can be read off the ground;
 *   - the cross: the healer's mark (`cross`), rising off whoever was mended.
 *
 * The heals are linen and mint and come in from the hands; the harms (Leech,
 * Toxin, Plague) are blood, a vial and a miasma, in the accent red, and never
 * use the cross. Every spell's size and time are read off its numbers
 * (`k.fx.reach`, `k.fx.secs`, `k.fx.close`), never written here.
 */
import type { Body, FxScene, P3, SpellPalette } from './kit';
import type { CastPose, SpellVisual } from './index';
import { arcAt, bump, clamp, easeOut, flashOf, glowPicture, hashOf, lerp, mid3, mixColour, seg, smooth, TAU } from './kit';
import { euler, one, onSelf } from './poses';
import { HALF_W } from '../iso';

/** Clean mint for what mends, and a blood red for what bleeds. */
export const PALETTE: SpellPalette = {
  core: '#f2fff7',
  main: '#8fe0b0',
  deep: '#3d8a63',
  accent: '#d65a6a',
  ink: '#16392a',
  light: '#a6ffcf',
};

/** Linen: the dressings. Off-white, its shade a warm grey, so it reads as cloth against the mint light. */
const LINEN = '#f1ead6';
const LINEN_DEEP = '#c4b898';
const LINEN_INK = '#4d4532';
/** Blood: the gash, the leech, the toxin, the plague. */
const BLOOD = PALETTE.accent;
const BLOOD_DEEP = '#8a2433';
const BLOOD_CORE = '#ffc2c8';
const BLOOD_INK = '#3a0d14';
const BLOOD_LIGHT = '#ff6a78';
/** The miasma: a bruised, brownish red, drawn as smoke. */
const MIASMA = ['#5a2a33', '#6e3238', '#4a2a2e'] as const;

/* ---- what the spells share ------------------------------------------------------------------ */

/** Whether a point is on the viewer's side of a body: lower on the screen at the ground than its feet. */
function nearSide(k: FxScene, b: Body, p: P3): boolean {
  return k.eye.worldToScreenY(p.x, p.y, 0) >= k.eye.worldToScreenY(b.x, b.y, 0);
}

interface WrapOpts {
  /** Shares of the body's height the band starts and ends at. */
  lo: number;
  hi: number;
  /** Times round. */
  turns: number;
  /** How far it has been wound, nought to one, and where its tail end is (nought: the start). */
  u: number;
  from?: number;
  /** How far out from the body over a snug fit, and its own turn about the body. */
  size?: number;
  spin?: number;
  width?: number;
  alpha?: number;
  /** Linen, or the palette's mint for a band of light. */
  light?: boolean;
}

/**
 * A dressing wound round a body: a band in a helix from `lo` to `hi` of its
 * height, drawn on as `u` goes. Cut where it passes behind the body and in
 * front of it, each run a ribbon sorted with the body on its own side, so it
 * goes round them rather than over them.
 */
function wrap(k: FxScene, b: Body, o: WrapOpts): void {
  const s1 = clamp(o.u), s0 = clamp(o.from ?? 0, 0, s1);
  const a = o.alpha ?? 1;
  if (s1 - s0 < 0.01 || a <= 0.01) return;
  const R = (b.wide * 0.6 + 0.7) * (o.size ?? 1);
  const n = Math.max(4, Math.ceil((s1 - s0) * o.turns * (k.fast ? 8 : 14)));
  const pts: P3[] = [];
  const near: boolean[] = [];
  for (let i = 0; i <= n; i++) {
    const s = lerp(s0, s1, i / n);
    const an = (o.spin ?? 0) + s * o.turns * TAU;
    const p = k.local(b, Math.cos(an) * R, Math.sin(an) * R, b.tall * lerp(o.lo, o.hi, s));
    pts.push(p);
    near.push(nearSide(k, b, p));
  }
  const width = o.width ?? 2.6;
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && near[i] === near[start]) continue;
    const run = pts.slice(start, i + 1);
    if (run.length >= 2) {
      const front = near[start];
      k.ribbon(run, o.light
        ? { width, taper: 'none', alpha: a * (front ? 1 : 0.6), bias: front ? 4 : -4, glow: front ? 0.5 : 0.2 }
        : { width, taper: 'none', alpha: a * (front ? 1 : 0.8), bias: front ? 4 : -4, glow: 0.25, main: front ? LINEN : LINEN_DEEP, core: '#ffffff', ink: LINEN_INK });
    }
    start = i;
  }
}

interface SutureOpts {
  /** Pixels at zoom one, long. */
  len: number;
  /** Radians on the screen. */
  ang: number;
  /** Share of the gash the spell closes. */
  close: number;
  /** How far the stitching has come, nought to one of that share. */
  u: number;
  /** How much of the open gash shows, nought to one. */
  gash?: number;
  alpha?: number;
  /** A needle at the head of the stitching, this opaque, bobbing in and out by `bob` (radians). */
  needle?: number;
  bob?: number;
}

/**
 * A wound on a body and the stitches closing it: a red gash, and cross
 * stitches in mint thread put in along it from one end, `close` of it in all,
 * the stitched part pulled shut. Drawn over whoever it is on, as a wound
 * shows on them from wherever they are seen.
 */
function suture(k: FxScene, b: Body, at: P3, o: SutureOpts): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), L = k.px(o.len);
  const dx = Math.cos(o.ang), dy = Math.sin(o.ang), nx = -dy, ny = dx;
  const ax = x - dx * L * 0.5, ay = y - dy * L * 0.5;
  const sewn = clamp(o.close * clamp(o.u));
  const gash = clamp(o.gash ?? 1);
  const W = L * 0.085;
  const stitches = Math.max(2, Math.round((o.close * o.len) / 2.6));
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    // The open part of the gash, from where the stitching has got to, to the far end: a slit with curved lips, dark
    // at the edges and wet red down its middle, pointed at both ends as a cut is.
    if (gash > 0.01 && sewn < 0.99) {
      const s = sewn;
      const w = W * gash * Math.min(1, (1 - s) * 2);
      const sx0 = ax + dx * L * s, sy0 = ay + dy * L * s, ex0 = ax + dx * L, ey0 = ay + dy * L;
      const mx = (sx0 + ex0) / 2, my = (sy0 + ey0) / 2;
      const lips = (k2: number): void => {
        g.beginPath();
        g.moveTo(sx0, sy0);
        g.quadraticCurveTo(mx + nx * w * 2 * k2, my + ny * w * 2 * k2, ex0, ey0);
        g.quadraticCurveTo(mx - nx * w * 2 * k2, my - ny * w * 2 * k2, sx0, sy0);
        g.closePath();
      };
      g.globalAlpha = clamp(a * Math.min(1, gash * 1.5));
      lips(1);
      g.fillStyle = BLOOD_DEEP;
      g.fill();
      g.lineWidth = Math.max(0.7, inkW * 0.6);
      g.strokeStyle = BLOOD_INK;
      g.stroke();
      lips(0.45);
      g.fillStyle = BLOOD;
      g.fill();
    }
    if (sewn <= 0.001) return;
    g.globalAlpha = clamp(a);
    // The closed seam, and the thread running along it from stitch to stitch.
    const ex = ax + dx * L * sewn, ey = ay + dy * L * sewn;
    g.lineWidth = Math.max(1, k.zoom * 0.9);
    g.strokeStyle = BLOOD_INK;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(ex, ey);
    g.stroke();
    const half = W * 0.95;
    const across = (w: number, c: string): void => {
      g.lineWidth = w;
      g.strokeStyle = c;
      g.beginPath();
      for (let i = 0; i < stitches; i++) {
        const s = ((i + 0.5) / stitches) * o.close;
        if (s > sewn) break;
        const cx = ax + dx * L * s, cy = ay + dy * L * s;
        // Straight across the seam, as an interrupted stitch lies.
        g.moveTo(cx - nx * half, cy - ny * half);
        g.lineTo(cx + nx * half, cy + ny * half);
      }
      g.stroke();
    };
    across(Math.max(1.6, k.zoom * 1.5), PALETTE.ink);
    across(Math.max(0.8, k.zoom * 0.75), PALETTE.core);
  }, 7);
  // The needle at the head of the seam, dipping through and out as each stitch goes in.
  const nd = clamp(o.needle ?? 0);
  if (nd > 0.01) {
    const hx = ax + dx * L * sewn, hy = ay + dy * L * sewn;
    const dip = Math.sin(o.bob ?? 0);
    const tipX = hx + nx * W * 1.2 * dip, tipY = hy + ny * W * 1.2 * dip - k.px(1.5);
    const backX = tipX - nx * L * 0.2 - dx * L * 0.1, backY = tipY - ny * L * 0.2 - dy * L * 0.1 - k.px(2);
    k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
      g.globalAlpha = nd;
      g.lineCap = 'round';
      g.strokeStyle = PALETTE.ink;
      g.lineWidth = Math.max(1.6, k.zoom * 1.5);
      g.beginPath();
      g.moveTo(backX, backY);
      g.lineTo(tipX, tipY);
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = Math.max(0.8, k.zoom * 0.7);
      g.stroke();
    }, 8);
    k.glowDraw((g) => {
      const pic = glowPicture(PALETTE.light);
      if (!pic) return;
      const R = k.px(5);
      g.globalAlpha = nd * 0.6;
      g.drawImage(pic, tipX - R, tipY - R, 2 * R, 2 * R);
    });
  }
  k.glow(mid3(at, at, 0), o.len * 0.9, a * 0.35 * clamp(sewn * 3));
}

/**
 * The Chirurgeon's mark, a cross: four arms, inked, its upper-left arms lit,
 * turning about the upright so it reads as a flat thing in the air. `r`
 * pixels at zoom one, centre to tip.
 */
function cross(k: FxScene, p: P3, r: number, o: { alpha?: number; turn?: number; main?: string; core?: string; ink?: string; bias?: number; glow?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.2) return;
  const x = k.sx(p), y = k.sy(p), R = k.px(r);
  const sq = 0.3 + 0.7 * Math.abs(Math.cos(o.turn ?? 0));
  const w = 0.34;
  const shape = [[-w, -1], [w, -1], [w, -w], [1, -w], [1, w], [w, w], [w, 1], [-w, 1], [-w, w], [-1, w], [-1, -w], [-w, -w]];
  const main = o.main ?? PALETTE.main, core = o.core ?? PALETTE.core, ink = o.ink ?? PALETTE.ink;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.beginPath();
    shape.forEach(([u, v], i) => (i ? g.lineTo(x + u * R * sq, y + v * R) : g.moveTo(x + u * R * sq, y + v * R)));
    g.closePath();
    g.fillStyle = main;
    g.fill();
    g.lineWidth = Math.max(0.8, 0.7 * k.zoom);
    g.strokeStyle = ink;
    g.stroke();
    // The lit facets: the top arm and the left arm's upper halves.
    g.fillStyle = core;
    g.beginPath();
    g.moveTo(x - w * R * sq, y - R);
    g.lineTo(x + w * R * sq, y - R);
    g.lineTo(x, y);
    g.closePath();
    g.moveTo(x - R * sq, y - w * R);
    g.lineTo(x, y);
    g.lineTo(x - R * sq, y + w * R);
    g.closePath();
    g.fill();
  }, o.bias ?? 6);
  const gl = o.glow ?? 1;
  if (gl > 0) k.glow(p, r * 2.4, a * gl * 0.5);
}

/**
 * The tally: a ring on the ground of `n` segments, one a second of what the
 * spell goes on doing, `lit` of them still to come. The one going out fades
 * through its second; the spent ones stay as faint marks, so the whole
 * length and what is left of it both read.
 */
function tally(k: FxScene, c: { x: number; y: number }, r: number, n: number, lit: number, o: { band?: number; alpha?: number; main?: string; deep?: string; ink?: string; light?: string; turn?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || n < 1 || r <= 0.05) return;
  const band = o.band ?? Math.max(0.04, r * 0.11);
  const span = TAU / n, gap = Math.min(span * 0.3, 0.12);
  const sub = Math.max(2, Math.min(k.fast ? 4 : 8, Math.round(span * r * 5)));
  const turn = (o.turn ?? 0) - Math.PI / 2;
  const whole = Math.floor(lit), part = lit - whole;
  // Each segment a polygon on the island in tiles, in one of three layers -- lit, going out, spent -- so the whole
  // tally is a handful of shapes the stage lays along the tiles, however many seconds it counts.
  const on: number[][] = [], off: number[][] = [], going: number[][] = [];
  const mids: P3[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = turn + i * span + gap / 2, a1 = turn + (i + 1) * span - gap / 2;
    const pts: number[] = [];
    for (let j = 0; j <= sub; j++) {
      const an = lerp(a0, a1, j / sub);
      pts.push(c.x + Math.cos(an) * r, c.y + Math.sin(an) * r);
    }
    for (let j = sub; j >= 0; j--) {
      const an = lerp(a0, a1, j / sub);
      pts.push(c.x + Math.cos(an) * (r - band), c.y + Math.sin(an) * (r - band));
    }
    (i < whole ? on : i === whole ? going : off).push(pts);
    if (i <= whole && !k.fast) {
      const am = (a0 + a1) / 2;
      mids.push(k.on(c.x + Math.cos(am) * (r - band / 2), c.y + Math.sin(am) * (r - band / 2), 0.3));
    }
  }
  const main = o.main ?? PALETTE.main, deep = o.deep ?? PALETTE.deep, ink = o.ink ?? PALETTE.ink;
  const inkW = Math.max(0.7, 0.6 * k.zoom);
  k.groundShape(c.x, c.y, r + 0.3, [
    { kind: 'fill', colour: deep, alpha: clamp(a * 0.28), paths: off, lift: 0.15 },
    { kind: 'stroke', colour: ink, alpha: clamp(a * 0.35), paths: off, lift: 0.15, width: inkW, closed: true, join: 'miter' },
    { kind: 'fill', colour: part > 0.5 ? main : deep, alpha: clamp(a * (0.28 + 0.72 * part)), paths: going, lift: 0.15 },
    { kind: 'stroke', colour: ink, alpha: clamp(a * (0.35 + 0.65 * part)), paths: going, lift: 0.15, width: inkW, closed: true, join: 'miter' },
    { kind: 'fill', colour: main, alpha: clamp(a), paths: on, lift: 0.15 },
    { kind: 'stroke', colour: ink, alpha: clamp(a), paths: on, lift: 0.15, width: inkW, closed: true, join: 'miter' },
  ]);
  // At night the lit segments glow a little, so the count still reads in the dark: a few of them, not every one.
  const step = Math.max(1, Math.ceil(mids.length / 6));
  for (let i = 0; i < mids.length; i += step) k.glow(mids[i], band * HALF_W * 2.4, a * 0.35 * (i === whole ? part : 1), o.light ?? PALETTE.light);
}

/** A thread of linen from one point to another, with a glint at the needle end: a stitch being sent. */
function thread(k: FxScene, from: P3, to: P3, o: { alpha?: number; lift?: number; sag?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const lift = o.lift ?? 0;
  const pts: P3[] = [];
  const n = k.fast ? 4 : 7;
  for (let i = 0; i <= n; i++) pts.push(arcAt(from, to, i / n, lift));
  k.ribbon(pts, { width: 1.3, taper: 'none', alpha: a * 0.9, main: LINEN, core: '#ffffff', ink: PALETTE.ink, glow: 0.35 });
}

/** A needle in flight or at work: a bright sliver along its way, and its glint. */
function needle(k: FxScene, tip: P3, back: P3, a = 1): void {
  k.ribbon([back, tip], { width: 2, taper: 'start', alpha: a, main: PALETTE.core, core: '#ffffff', ink: PALETTE.ink, glow: 0.6 });
  k.flare(tip, 4, a * 0.8, PALETTE.core, k.now * 6);
}

/**
 * A red glint: the kit's four-pointed flare, but with its light in blood red
 * rather than the palette's mint, for the moment a cut or a bleed shows.
 */
function glint(k: FxScene, p: P3, r: number, alpha: number, turn = 0): void {
  if (alpha <= 0.01 || r <= 0) return;
  const x = k.sx(p), y = k.sy(p), R = k.px(r), w = R * 0.16;
  k.glowDraw((g) => {
    g.globalAlpha = clamp(alpha);
    g.fillStyle = BLOOD_CORE;
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const an = turn + (i * Math.PI) / 2, len = i % 2 ? R * 0.62 : R;
      const c = Math.cos(an), s = Math.sin(an);
      g.moveTo(x - s * w, y + c * w * 0.5);
      g.lineTo(x + c * len, y + s * len * 0.8);
      g.lineTo(x + s * w, y - c * w * 0.5);
    }
    g.fill();
  });
  k.glow(p, r * 0.8, alpha * 0.6, BLOOD_LIGHT);
}

/** Where to put a wound on somebody: `i` of a few spread over the body, the same every frame. */
function woundAt(k: FxScene, b: Body, i: number): { at: P3; ang: number } {
  const up = [0.62, 0.46, 0.74, 0.34][i % 4];
  const side = [-0.1, 0.16, 0.2, -0.18][i % 4] * b.wide;
  const at = k.local(b, side, 0, b.tall * up);
  const ang = (hashOf(k.seed, i) - 0.5) * 0.8 + (i % 2 ? 0.7 : -0.5);
  return { at, ang };
}

/** A wound along the caster's own left forearm, the one a self-stitch is worked over. */
function forearmWound(k: FxScene): { at: P3; ang: number } {
  const e = k.joint(k.caster, 'elbow0'), h = k.hand(0);
  return { at: mid3(e, h, 0.55), ang: Math.atan2(k.sy(h) - k.sy(e), k.sx(h) - k.sx(e)) };
}

/** The most bodies an area spell marks one by one; past it the rest go unmarked rather than the frame slow. */
const MOST_MARKED = 8;

/**
 * Everybody of these kinds an area spell round the caster covers, the caster
 * left out (their own part is drawn already), the nearest first, with the
 * share of the radius each stands at: what a ring going out reaches in turn.
 */
function covered(k: FxScene, r: number, kinds: ReadonlyArray<Body['kind']>): Array<{ b: Body; d: number }> {
  const out: Array<{ b: Body; d: number }> = [];
  for (const b of k.bodiesWithin(r, k.caster, kinds)) {
    const d = Math.hypot(b.x - k.caster.x, b.y - k.caster.y);
    if (d < 0.05) continue;
    out.push({ b, d: d / r });
  }
  out.sort((p, q) => p.d - q.d);
  return out.slice(0, MOST_MARKED);
}

/** When a front eased out over `[0, until]` of an impact (`easeOut`) reaches a share `d` of its radius. */
const reachedAt = (d: number, until: number): number => until * (1 - Math.cbrt(Math.max(0, 1 - d)));

/** Whether a spell went on its caster, rather than somebody else. */
const castOnSelf = (k: FxScene): boolean => k.target === k.caster;

/** How far out a tally goes round somebody: just clear of their feet, a little more for something broad. */
const tallyR = (b: Body): number => 0.22 + b.wide * 0.03;

/** A spell's own numbers, read off the island's: a count of seconds, a reach, a share. */
const secsOf = (k: FxScene, or = 1): number => k.fx.secs || or;

/* ---- the casts -------------------------------------------------------------------------------- */

/** The right hand closed on a knife, or free to open. */
const freeHand = (c: { carry: string | null }): boolean => c.carry !== 'fist';

/**
 * Field Dressing: a roll of linen held in both hands at the belt, torn off
 * with the right hand flung out to the side, and that hand swung over to the
 * one being dressed, sending the strip; the weight onto the front foot.
 */
const dressingPose: CastPose = (r, t, c) => {
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.24, [42, -6, 30]], [0.36, [44, -4, 30]], [0.5, [40, 4, 22]], [0.7, [30, 10, 10]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 16], [0.24, 92], [0.36, 96], [0.5, 80], [1, 20]]);
  r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.24, [40, -8, 34]], [0.33, [44, -8, 34]], [0.42, [54, 52, -6]], [0.52, [86, 6, -4]], [0.68, [78, 8, -4]], [1, [14, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 16], [0.24, 96], [0.33, 98], [0.42, 30], [0.52, 6], [0.68, 14], [1, 20]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.42, [0, 0, 20]], [0.52, [-20, 0, -60]], [0.7, [-10, 0, -40]], [1, [0, 0, 0]]]);
  r.open = [t > 0.18 && t < 0.8, freeHand(c) && t > 0.4 && t < 0.85];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.24, [-6, 0, 4]], [0.42, [-2, 2, -18]], [0.52, [-8, -2, 10]], [0.7, [-6, 0, 6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [-4, 0, 0]], [0.52, [-10, 0, 4]], [1, [-1, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.24, [-16, 0, 0]], [0.38, [-12, 0, 0]], [0.5, [-4, 0, 6]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.36, [0, 3, 0]], [0.52, [20, 3, 0]], [0.75, [16, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.36, 8], [0.52, 22], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.52, [-12, 2, 0]], [1, [-1, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.36, 10], [0.52, 8], [1, 4]]);
  // The roll held in a cupped left hand; the right hand flat as it sends the strip.
  r.shape = [{ cup: bump(t, 0.1, 0.22, 0.6) }, freeHand(c) ? { flat: bump(t, 0.38, 0.5, 0.86) } : undefined];
  if (onSelf(c)) {
    // On oneself the strip is not sent but wound on: the right hand carried round the waist and back again, the eyes
    // on it, and no step.
    r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.24, [40, -8, 34]], [0.33, [44, -8, 34]], [0.42, [30, 46, -6]], [0.54, [38, -22, 52]], [0.68, [30, 26, -8]], [1, [14, 10, 0]]]);
    r.elbow[1] = one(t, [[0, 16], [0.24, 96], [0.33, 98], [0.42, 50], [0.54, 112], [0.68, 64], [1, 20]]);
    r.hand[1] = [0, 0, 0];
    r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-6, 0, 0]], [0.42, [-6, 0, -12]], [0.54, [-10, 0, 14]], [0.7, [-6, 0, -6]], [1, [0, 0, 0]]]);
    r.head = euler(t, [[0, [0, 0, 0]], [0.24, [-18, 0, 0]], [0.72, [-18, 0, 0]], [1, [0, 0, 0]]]);
    r.leg = [[2, 2, 0], [0, 2, 0]];
    r.knee = [one(t, [[0, 4], [0.4, 10], [1, 4]]), one(t, [[0, 4], [0.4, 10], [1, 4]])];
  }
};

/**
 * Quick Stitch: the left hand held out flat under the wound, the right
 * pinched on a needle and sewing three quick loops in the air before the
 * chest, the last pulled up and out to draw the thread tight.
 */
const stitchPose: CastPose = (r, t, c) => {
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.16, [56, 2, 14]], [0.7, [56, 2, 14]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 16], [0.16, 54], [0.7, 50], [1, 18]]);
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [0.16, [0, 0, -70]], [0.7, [0, 0, -70]], [1, [0, 0, 0]]]);
  r.open[0] = t > 0.08 && t < 0.85;
  // Three loops: down and through, up and out, each quicker than the last.
  const loops = [0.14, 0.27, 0.38, 0.47, 0.55];
  r.arm[1] = euler(t, [[0, [12, 10, 0]], [loops[0], [62, 10, 8]], [0.21, [52, 4, 14]], [loops[1], [70, 16, 0]], [0.33, [54, 4, 14]], [loops[2], [72, 18, 0]],
    [0.43, [56, 6, 12]], [loops[4], [118, 30, -16]], [0.68, [112, 30, -14]], [1, [14, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 16], [loops[0], 70], [0.21, 96], [loops[1], 64], [0.33, 96], [loops[2], 60], [0.43, 96], [loops[4], 54], [0.68, 60], [1, 18]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.21, [30, 0, 0]], [loops[1], [-20, 0, 0]], [0.33, [30, 0, 0]], [loops[2], [-20, 0, 0]], [0.43, [30, 0, 0]], [loops[4], [-30, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = false;
  r.chest = euler(t, [[0, [0, 0, 0]], [0.16, [-6, 0, 0]], [0.45, [-8, 0, -4]], [loops[4], [4, 0, -12]], [0.7, [2, 0, -8]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.16, [-16, 0, 0]], [0.45, [-14, 0, 0]], [loops[4], [-2, 0, -10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.16, [-4, 0, 0]], [0.55, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.knee = [one(t, [[0, 4], [0.2, 10], [0.6, 10], [1, 4]]), one(t, [[0, 4], [0.2, 10], [0.6, 8], [1, 4]])];
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.2, [10, 3, 0]], [0.7, [10, 3, 0]], [1, [2, 2, 0]]]);
  // The left hand flat and turned palm up under the wound; the right pinched on the needle, the forefinger along it.
  r.shape = [{ flat: seg(t, 0.06, 0.16) * (1 - seg(t, 0.75, 0.9)) }, freeHand(c) ? { point: 0.5, cup: 0.5 } : undefined];
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [0.16, [0, 80, -20]], [0.7, [0, 80, -20]], [1, [0, 0, 0]]]);
  if (onSelf(c)) {
    // Stitching oneself: the left forearm brought up across the chest, and the needle worked over it.
    r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.16, [56, -16, 40]], [0.7, [56, -16, 40]], [1, [12, 10, 0]]]);
    r.elbow[0] = one(t, [[0, 16], [0.16, 96], [0.7, 96], [1, 18]]);
    r.head = euler(t, [[0, [0, 0, 0]], [0.16, [-22, 0, 6]], [0.5, [-20, 0, 6]], [0.62, [-8, 0, -6]], [1, [0, 0, 0]]]);
  }
};

/**
 * Leech: the knife taken back across the body to the left shoulder, the
 * body wound up away from the creature; a backhand cut out through it with a
 * step in; then the empty left hand pulled in to the chest, as what was cut
 * comes back.
 */
const leechPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, [16, 12, 0]], [0.3, [74, -34, 46]], [0.36, [76, -36, 48]], [0.44, [84, 30, -20]], [0.52, [70, 54, -30]], [0.72, [40, 28, -10]], [1, [16, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 24], [0.3, 118], [0.36, 122], [0.44, 16], [0.52, 10], [0.72, 30], [1, 24]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.3, [10, 0, 40]], [0.44, [-10, 0, -20]], [0.6, [0, 0, -30]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.3, [40, 20, -6]], [0.44, [20, 26, 0]], [0.6, [52, -10, 34]], [0.82, [50, -8, 32]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 18], [0.3, 40], [0.44, 30], [0.6, 120], [0.82, 116], [1, 18]]);
  r.open[0] = t > 0.5 && t < 0.92;
  r.chest = euler(t, [[0, [0, 0, 0]], [0.32, [4, 2, 24]], [0.44, [-8, -2, -22]], [0.55, [-6, -2, -26]], [0.8, [2, 0, -6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.32, [4, 0, 8]], [0.44, [-12, 0, -8]], [0.6, [-6, 0, -6]], [0.8, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.32, [-4, 0, -18]], [0.44, [-6, 0, 18]], [0.62, [4, 0, 10]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.32, [-4, 3, 0]], [0.44, [28, 4, 0]], [0.62, [24, 4, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.32, 14], [0.44, 30], [0.62, 22], [1, 6]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.32, [6, 2, 0]], [0.44, [-18, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.32, 20], [0.44, 10], [1, 5]]);
  r.wield = 1;
  // The empty left hand clawed as it pulls in what the cut gives back.
  r.shape = [{ claw: bump(t, 0.48, 0.62, 0.92) }, undefined];
};

/**
 * Regenerate: something set going rather than put on. The right hand dips
 * low and cupped by the thigh as the knees give, then comes up through an
 * underarm toss, open, the body rising onto it.
 */
const regeneratePose: CastPose = (r, t, c) => {
  r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.36, [-14, 16, 4]], [0.45, [-12, 14, 4]], [0.56, [104, 4, 0]], [0.72, [112, 6, 0]], [1, [14, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 16], [0.36, 34], [0.45, 30], [0.56, 8], [0.72, 14], [1, 18]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.36, [40, 0, -60]], [0.56, [-10, 0, -70]], [0.8, [0, 0, -40]], [1, [0, 0, 0]]]);
  r.open[1] = freeHand(c) && t > 0.2 && t < 0.88;
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.36, [40, 30, 0]], [0.56, [20, 34, -4]], [0.8, [14, 20, 0]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 16], [0.36, 40], [0.56, 24], [1, 18]]);
  r.open[0] = t > 0.2 && t < 0.88;
  r.spine = euler(t, [[0, [0, 0, 0]], [0.38, [-14, 0, 4]], [0.56, [6, 0, -2]], [0.75, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.38, [-6, 0, 10]], [0.56, [6, 0, -6]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.38, [-14, 0, 0]], [0.56, [6, 0, 0]], [0.75, [4, 0, 0]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) {
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.38, [k ? 6 : 22, 4, 0]], [0.56, [k ? -6 : 10, 3, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.38, k ? 34 : 40], [0.56, 4], [1, 4]]);
  }
  // A seed held in the cupped hand on the way down, the hand flat and open as it lets it go.
  const cupped = seg(t, 0.12, 0.3) * (1 - seg(t, 0.5, 0.56)), let_ = seg(t, 0.5, 0.56) * (1 - seg(t, 0.8, 0.95));
  r.shape = [{ flat: bump(t, 0.2, 0.4, 0.85) }, freeHand(c) ? { cup: cupped, flat: let_ } : undefined];
  if (onSelf(c)) {
    // On oneself: both hands cupped low before the belly as the knees give, then lifted to the breast and opened.
    for (let k2 = 0; k2 < 2; k2++) {
      r.arm[k2] = euler(t, [[0, [12, 10, 0]], [0.36, [30, -8, 30]], [0.45, [30, -8, 30]], [0.58, [58, 4, 20]], [0.76, [56, 6, 18]], [1, [12, 10, 0]]]);
      r.elbow[k2] = one(t, [[0, 16], [0.36, 70], [0.45, 72], [0.58, 112], [0.76, 108], [1, 18]]);
      r.hand[k2] = euler(t, [[0, [0, 0, 0]], [0.45, [0, 0, 0]], [0.58, [0, k2 ? -70 : 70, 0]], [0.8, [0, k2 ? -60 : 60, 0]], [1, [0, 0, 0]]]);
    }
    r.shape = [{ cup: cupped, flat: let_ }, freeHand(c) ? { cup: cupped, flat: let_ } : undefined];
    r.open = [t > 0.2 && t < 0.88, freeHand(c) && t > 0.2 && t < 0.88];
  }
};

/**
 * Toxin: a vial taken from the belt, brought up and unstoppered with the
 * thumb, the face turned away from it, then flicked side-arm at the creature
 * with a snap of the wrist.
 */
const toxinPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.14, [-16, 26, 0]], [0.28, [56, 6, 28]], [0.38, [60, 6, 30]], [0.44, [44, 52, -10]], [0.52, [84, 22, -18]], [0.7, [70, 16, -12]], [1, [14, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 16], [0.14, 50], [0.28, 124], [0.38, 128], [0.44, 96], [0.52, 12], [0.7, 24], [1, 18]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.38, [20, 0, 0]], [0.46, [40, 0, 0]], [0.52, [-40, 0, 0]], [0.7, [-20, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.26, [50, -6, 34]], [0.36, [54, -8, 36]], [0.46, [30, 24, 0]], [0.7, [20, 20, 0]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 16], [0.26, 116], [0.36, 120], [0.46, 40], [1, 18]]);
  r.open[0] = t > 0.42 && t < 0.86;
  r.head = euler(t, [[0, [0, 0, 0]], [0.28, [-10, 0, 0]], [0.36, [-4, 6, 30]], [0.44, [-6, 0, 6]], [0.52, [-8, 0, -4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.36, [-2, 0, 6]], [0.44, [2, 0, -24]], [0.52, [-8, 0, 16]], [0.7, [-6, 0, 10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.36, [-6, 0, 0]], [0.44, [-2, 0, -8]], [0.52, [-12, 0, 8]], [1, [-1, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.44, [-2, 3, 0]], [0.52, [22, 4, 0]], [0.72, [18, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.44, 12], [0.52, 24], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.44, [6, 2, 0]], [0.52, [-12, 2, 0]], [1, [-1, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.44, 20], [0.52, 10], [1, 4]]);
  // The left fingers pinched on the stopper as it is drawn, then spread as the vial goes.
  r.shape = [{ cup: bump(t, 0.24, 0.32, 0.44), point: bump(t, 0.24, 0.32, 0.44) * 0.5, flat: bump(t, 0.46, 0.55, 0.86) }, undefined];
};

/**
 * Surgeon's Hands: the hands scrubbed together before the belly, three
 * times, then lifted before the face, palms in and fingers up, as a surgeon
 * holds clean hands; held there, chin up.
 */
const handsPose: CastPose = (r, t) => {
  const scrub = Math.sin(seg(t, 0.12, 0.44) * TAU * 3) * (1 - seg(t, 0.4, 0.46));
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.12, [40, -4, 30]], [0.44, [42, -4, 30]], [0.56, [56, 22, -6]], [0.8, [54, 22, -6]], [1, [12, 10, 0]]]);
    r.arm[k][2] += 10 * scrub * s;
    r.arm[k][0] += 4 * scrub * s;
    r.elbow[k] = one(t, [[0, 16], [0.12, 86], [0.44, 88], [0.56, 128], [0.8, 126], [1, 18]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.44, [0, 0, 0]], [0.56, [-10, 0, s * 70]], [0.8, [-10, 0, s * 70]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.48 && t < 0.92;
  }
  r.head = euler(t, [[0, [0, 0, 0]], [0.12, [-18, 0, 0]], [0.44, [-16, 0, 0]], [0.56, [8, 0, 0]], [0.8, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.12, [-6, 0, 0]], [0.44, [-6, 0, 0]], [0.56, [6, 0, 0]], [0.8, [5, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.44, [-2, 0, 0]], [0.56, [3, 0, 0]], [1, [0, 0, 0]]]);
  r.knee = [one(t, [[0, 4], [0.44, 8], [0.56, 2], [1, 4]]), one(t, [[0, 4], [0.44, 8], [0.56, 2], [1, 4]])];
  // Cupped as they scrub, flat and spread as they come up clean.
  const clean = seg(t, 0.46, 0.54) * (1 - seg(t, 0.84, 0.95));
  r.shape = [{ cup: bump(t, 0.1, 0.2, 0.46), flat: clean }, { cup: bump(t, 0.1, 0.2, 0.46), flat: clean }];
};

/** How far ahead of the feet, in height units, a Healing Circle's palms go down: where the pose puts them and the ring starts. */
const PALMS_AHEAD = 4.8;

/**
 * Healing Circle: a step in and down onto the knees' bend, the body bowed
 * and both palms pressed flat to the ground ahead; then up again, the arms
 * swept wide and up as the ring goes out from where they were.
 */
const circlePose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.22, [60, 8, 0]], [0.42, [62, 14, 0]], [0.5, [60, 16, 0]], [0.62, [40, 96, -4]], [0.8, [36, 94, -4]], [1, [12, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 16], [0.22, 20], [0.42, 6], [0.5, 6], [0.62, 12], [1, 18]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.3, [-60, 0, 0]], [0.5, [-70, 0, 0]], [0.62, [0, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.14 && t < 0.92;
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [0.32, [-12, 0, 0]], [0.5, [-14, 0, 0]], [0.62, [4, 0, 0]], [0.8, [3, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.32, [-14, 0, 0]], [0.5, [-14, 0, 0]], [0.62, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.32, [6, 0, 0]], [0.5, [4, 0, 0]], [0.62, [12, 0, 0]], [1, [0, 0, 0]]]);
  // Down onto the right knee with both palms flat on the ground ahead, the back bowed as far as gets them there; up again
  // with the ring.
  r.kneel = one(t, [[0, 0], [0.3, 1], [0.5, 1], [0.64, 0]]);
  const press = one(t, [[0.14, 0], [0.32, 1], [0.5, 1], [0.6, 0]]);
  r.reach = [{ at: [-1.5, PALMS_AHEAD, 0.5], w: press, stoop: true }, { at: [1.5, PALMS_AHEAD, 0.5], w: press, stoop: true }];
  r.shape = [{ flat: seg(t, 0.14, 0.3) * (1 - seg(t, 0.85, 0.95)) }, { flat: seg(t, 0.14, 0.3) * (1 - seg(t, 0.85, 0.95)) }];
};

/**
 * Mass Dressing: the arms out wide with the strips in both hands, the trunk
 * wound round to the right, then whipped all the way round to the left so
 * the linen flies out in a spiral; the arms trailing after it.
 */
const massPose: CastPose = (r, t) => {
  const yaw = one(t, [[0, 0], [0.38, -44], [0.5, 30], [0.64, 46], [0.82, 14], [1, 0]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.2, [22, 52, 0]], [0.38, [16, 84, 0]], [0.5, [22, 90, 0]], [0.66, [16, 82, 0]], [0.84, [12, 40, 0]], [1, [12, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 16], [0.2, 40], [0.38, 30], [0.5, 4], [0.7, 10], [1, 18]]);
    r.open[k] = t > 0.46 && t < 0.88;
  }
  // The leading arm (the left, going round to the left) a little higher than the trailing one.
  r.arm[0][0] += 12 * bump(t, 0.38, 0.52, 0.8);
  r.arm[1][0] -= 10 * bump(t, 0.38, 0.52, 0.8);
  r.chest = [one(t, [[0, 0], [0.38, 4], [0.5, -4], [1, 0]]), 0, yaw * 0.55];
  r.spine = [one(t, [[0, 0], [0.38, 2], [0.5, -6], [1, 0]]), 0, yaw * 0.45];
  r.head = [one(t, [[0, 0], [0.38, -4], [0.5, 4], [1, 0]]), 0, -yaw * 0.4];
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.38, [-4, 8, -10]], [0.52, [8, 10, 18]], [0.8, [6, 6, 8]], [1, [2, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.38, [8, 8, -16]], [0.52, [-6, 10, 14]], [0.8, [-2, 6, 6]], [1, [0, 2, 0]]]);
  r.knee = [one(t, [[0, 4], [0.38, 22], [0.52, 14], [1, 4]]), one(t, [[0, 4], [0.38, 26], [0.52, 12], [1, 4]])];
  // The strips held in the fists through the wind-up, the hands flung open as they go.
  const go = seg(t, 0.46, 0.52) * (1 - seg(t, 0.85, 0.95));
  r.shape = [{ cup: 1 - go, flat: go }, { cup: 1 - go, flat: go }];
};

/**
 * Plague: hunched over, both hands brought up to the mouth as if to cough
 * into them, the knees giving; then the hands flung down and out, clawed,
 * the head thrust forward after what was let go.
 */
const plaguePose: CastPose = (r, t) => {
  const cough = Math.sin(seg(t, 0.3, 0.5) * TAU * 2) * (1 - seg(t, 0.46, 0.52));
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.28, [58, -10, 34]], [0.48, [60, -10, 34]], [0.58, [26, 56, 6]], [0.8, [22, 50, 4]], [1, [12, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 16], [0.28, 136], [0.48, 138], [0.58, 30], [0.8, 34], [1, 18]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.48, [0, 0, 0]], [0.58, [-40, 0, 0]], [0.82, [-30, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.52 && t < 0.9;
    r.knee[k] = one(t, [[0, 4], [0.3, 24], [0.48, 30], [0.58, 16], [0.82, 14], [1, 4]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.3, [10, 6, 0]], [0.58, [k ? -4 : 18, 8, 0]], [0.82, [k ? -2 : 14, 6, 0]], [1, [2, 2, 0]]]);
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [-18, 0, 0]], [0.48, [-22, 0, 0]], [0.58, [-14, 0, 0]], [0.82, [-10, 0, 0]], [1, [0, 0, 0]]]);
  r.spine[0] -= 6 * cough;
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-10, 0, 0]], [0.48, [-12, 0, 0]], [0.58, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-16, 0, 0]], [0.48, [-18, 0, 0]], [0.58, [10, 0, 0]], [0.82, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.head[0] -= 8 * cough;
  // The fingers clawed, and the mouth open on the cough and on what is let go.
  r.shape = [{ claw: seg(t, 0.2, 0.32) * (1 - seg(t, 0.85, 0.95)) }, { claw: seg(t, 0.2, 0.32) * (1 - seg(t, 0.85, 0.95)) }];
  r.mouth = Math.max(0, one(t, [[0, 0], [0.3, 0.25], [0.5, 0.3], [0.56, 0.9], [0.72, 0.4], [0.9, 0]]) + 0.25 * Math.max(0, cough));
};

/**
 * Battlefield Surgery: down onto the left knee beside the wounded, both
 * hands working fast before the chest -- right, left, right -- then lifted
 * together and opened toward them; up again after.
 */
const surgeryPose: CastPose = (r, t, c) => {
  const work = Math.sin(seg(t, 0.18, 0.5) * TAU * 3.5) * (1 - seg(t, 0.46, 0.52));
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.18, [54, 2, 18]], [0.5, [56, 2, 18]], [0.56, [84, 12, 0]], [0.76, [80, 12, 0]], [1, [12, 10, 0]]]);
    r.arm[k][0] += 9 * work * s;
    r.elbow[k] = one(t, [[0, 16], [0.18, 76], [0.5, 80], [0.56, 12], [0.76, 16], [1, 18]]);
    r.elbow[k] += 16 * work * s;
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.5, [10, 0, 0]], [0.56, [-30, 0, s * -50]], [0.76, [-20, 0, s * -40]], [1, [0, 0, 0]]]);
  }
  r.open = [t > 0.5 && t < 0.88, freeHand(c) && t > 0.5 && t < 0.88];
  // Down on the left knee, the right foot flat ahead, toes tucked under behind.
  r.kneel = one(t, [[0, 0], [0.16, 1], [0.78, 1], [0.92, 0]]);
  r.kneelLeft = true;
  r.spine = euler(t, [[0, [0, 0, 0]], [0.18, [-16, 0, 0]], [0.5, [-18, 0, 0]], [0.56, [-4, 0, 0]], [0.76, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.18, [-8, 0, 0]], [0.5, [-8, 0, 0]], [0.56, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.18, [-16, 0, 0]], [0.5, [-14, 0, 0]], [0.56, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.chest[2] += 5 * work;
  // Pinched on needles while they work, opened flat as they lift.
  const open = seg(t, 0.5, 0.56) * (1 - seg(t, 0.86, 0.95));
  const pinch = seg(t, 0.14, 0.22) * (1 - open);
  r.shape = [{ point: 0.5 * pinch, cup: 0.5 * pinch, flat: open }, freeHand(c) ? { point: 0.5 * pinch, cup: 0.5 * pinch, flat: open } : undefined];
  if (onSelf(c)) {
    // On oneself: the work done low on one's own front thigh, and the hands brought in to the breast, not lifted out.
    for (let k2 = 0; k2 < 2; k2++) {
      const s2 = k2 ? 1 : -1;
      r.arm[k2] = euler(t, [[0, [12, 10, 0]], [0.18, [34, 4, 14]], [0.5, [36, 4, 14]], [0.56, [52, -8, 30]], [0.76, [50, -8, 30]], [1, [12, 10, 0]]]);
      r.arm[k2][0] += 7 * work * s2;
      r.elbow[k2] = one(t, [[0, 16], [0.18, 70], [0.5, 72], [0.56, 112], [0.76, 110], [1, 18]]) + 12 * work * s2;
      r.hand[k2] = [0, 0, 0];
    }
    r.head = euler(t, [[0, [0, 0, 0]], [0.18, [-24, 0, 0]], [0.5, [-22, 0, 0]], [0.56, [-10, 0, 0]], [1, [0, 0, 0]]]);
  }
};

/**
 * Restoration: the arms crossed over the breast, each hand to the other
 * shoulder, the head bowed and the knees giving; then the arms opened wide
 * and up, the chest lifted, as the light goes up the body.
 */
const restorePose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.3, [66, -24, 44]], [0.5, [68, -26, 46]], [0.6, [34, 128, -6]], [0.82, [32, 124, -6]], [1, [12, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 16], [0.3, 138], [0.5, 140], [0.6, 14], [0.82, 16], [1, 18]]);
    r.open[k] = t > 0.2 && t < 0.92;
  }
  // The right arm over the left, as arms cross.
  r.arm[1][0] += 6 * bump(t, 0.1, 0.3, 0.56);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-22, 0, 0]], [0.5, [-24, 0, 0]], [0.6, [16, 0, 0]], [0.82, [14, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-8, 0, 0]], [0.5, [-10, 0, 0]], [0.6, [12, 0, 0]], [0.82, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [-6, 0, 0]], [0.5, [-6, 0, 0]], [0.6, [5, 0, 0]], [1, [0, 0, 0]]]);
  r.knee = [one(t, [[0, 4], [0.3, 22], [0.5, 24], [0.6, 2], [1, 4]]), one(t, [[0, 4], [0.3, 22], [0.5, 24], [0.6, 2], [1, 4]])];
  r.leg = [euler(t, [[0, [2, 2, 0]], [0.3, [10, 2, 0]], [0.5, [10, 2, 0]], [0.6, [0, 3, 0]], [1, [2, 2, 0]]]), euler(t, [[0, [2, 2, 0]], [0.3, [10, 2, 0]], [0.5, [10, 2, 0]], [0.6, [0, 3, 0]], [1, [2, 2, 0]]])];
  // Flat open hands as the arms open.
  const opened = seg(t, 0.5, 0.58) * (1 - seg(t, 0.86, 0.95));
  r.shape = [{ flat: opened, cup: 0.4 * bump(t, 0.1, 0.3, 0.52) }, { flat: opened, cup: 0.4 * bump(t, 0.1, 0.3, 0.52) }];
};

/**
 * Miracle Worker: both hands raised high and joined over the head, the body
 * stretched up onto it; held a beat; then brought down together to point
 * both open palms at the one being saved, with a long step and a lean in,
 * held while it lands.
 */
const miraclePose: CastPose = (r, t, c) => {
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.3, [168, -4, 14]], [0.46, [172, -6, 16]], [0.56, [92, 6, 4]], [0.8, [88, 8, 4]], [1, [12, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 16], [0.3, 34], [0.46, 30], [0.56, 4], [0.8, 8], [1, 18]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.46, [0, 0, s * -30]], [0.56, [-50, 0, s * 20]], [0.8, [-40, 0, s * 20]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.1 && t < 0.92;
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [8, 0, 0]], [0.46, [10, 0, 0]], [0.56, [-16, 0, 0]], [0.8, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [8, 0, 0]], [0.46, [10, 0, 0]], [0.56, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [22, 0, 0]], [0.46, [24, 0, 0]], [0.56, [-8, 0, 0]], [0.8, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.3, [0, 3, 0]], [0.46, [0, 3, 0]], [0.56, [34, 4, 0]], [0.8, [32, 4, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.3, 0], [0.46, 0], [0.56, 36], [0.8, 34], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.46, [0, 2, 0]], [0.56, [-20, 2, 0]], [0.8, [-18, 2, 0]], [1, [-1, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.46, 0], [0.56, 12], [1, 4]]);
  // Up on the toes at the top.
  r.foot = [-14 * bump(t, 0.15, 0.32, 0.52), -14 * bump(t, 0.15, 0.32, 0.52)];
  r.shape = [{ flat: seg(t, 0.1, 0.25) * (1 - seg(t, 0.86, 0.95)) }, { flat: seg(t, 0.1, 0.25) * (1 - seg(t, 0.86, 0.95)) }];
  if (onSelf(c)) {
    // On oneself the light is brought down into one's own breast: no lunge, the palms laid flat on the chest, the head bowed.
    for (let k2 = 0; k2 < 2; k2++) {
      r.arm[k2] = euler(t, [[0, [12, 10, 0]], [0.3, [168, -4, 14]], [0.46, [172, -6, 16]], [0.56, [50, -12, 34]], [0.8, [48, -12, 32]], [1, [12, 10, 0]]]);
      r.elbow[k2] = one(t, [[0, 16], [0.3, 34], [0.46, 30], [0.56, 120], [0.8, 118], [1, 18]]);
      r.hand[k2] = [0, 0, 0];
    }
    r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [8, 0, 0]], [0.46, [10, 0, 0]], [0.56, [-6, 0, 0]], [0.8, [-5, 0, 0]], [1, [0, 0, 0]]]);
    r.head = euler(t, [[0, [0, 0, 0]], [0.3, [22, 0, 0]], [0.46, [24, 0, 0]], [0.56, [-18, 0, 0]], [0.8, [-16, 0, 0]], [1, [0, 0, 0]]]);
    r.leg = [[2, 2, 0], [0, 2, 0]];
    r.knee = [one(t, [[0, 4], [0.56, 16], [1, 4]]), one(t, [[0, 4], [0.56, 16], [1, 4]])];
  }
};

/* ---- the spells ------------------------------------------------------------------------------ */

/** Seconds to the one it goes to over `tiles`, for what is sent from the hand to a person; nothing for oneself. */
const sent = (base: number, each: number) => (tiles: number): number => (tiles < 0.3 ? 0 : base + tiles * each);

export const CHIRURGEON: Record<string, SpellVisual> = {
  // Field Dressing (ally, on self, player, 2 tiles round): You or somebody within 2 tiles of you gets 10% of their health back, and their worst bleeding wound stops bleeding.
  chirurgeon_field_dressing: {
    palette: PALETTE,
    cast: { timing: { secs: 0.95, release: 0.5 }, pose: dressingPose },
    fx: {
      charge: (k, t) => {
        // The roll between the hands, and the strip stretched between them as it is torn off.
        const h0 = k.hand(0), h1 = k.hand(1);
        const held = seg(t, 0.12, 0.24) * (1 - seg(t, 0.46, 0.52));
        if (held > 0) k.orb(h0, 2.4, { main: LINEN, deep: LINEN_DEEP, core: '#ffffff', ink: LINEN_INK, alpha: held, glow: 0.3, sides: 6, turn: 0.3 });
        const tear = bump(t, 0.3, 0.42, 0.5);
        if (tear > 0.02) k.ribbon([h0, mid3(h0, h1, 0.5), h1], { width: 2.6, taper: 'none', alpha: tear, main: LINEN, core: '#ffffff', ink: LINEN_INK, glow: 0.3 });
        k.glow(h1, 6, 0.5 * bump(t, 0.3, 0.48, 0.6));
      },
      release: (k) => k.burst(k.hand(1), 6, { kind: 'mote', size: 1.6, life: [0.2, 0.4], speed: [0.2, 0.5], up: [2, 8], gravity: 0, heading: k.toward(k.caster, k.target), cone: 1.2 }),
      travel: { secs: sent(0.12, 0.07), draw: (k, u) => {
        // The strip flying, fluttering, its tail unspooling from the hand.
        const from = k.hand(1), to = k.heart(k.target);
        const lift = 5 + k.dist * 2;
        const pts: P3[] = [];
        for (let i = 6; i >= 0; i--) {
          const v = Math.max(0, u - i * 0.06);
          const p = arcAt(from, to, v, lift);
          p.z += Math.sin(k.now * 26 + i * 1.3) * 1.2 * (i / 6);
          pts.push(p);
        }
        k.ribbon(pts, { width: 3, taper: 'start', main: LINEN, core: '#ffffff', ink: LINEN_INK, glow: 0.35 });
        k.glow(pts[6], 5, 0.5);
      } },
      hit: (k) => {
        k.burst(k.heart(k.target), 8, { kind: 'mote', size: 1.8, life: [0.4, 0.8], speed: [0.1, 0.4], up: [6, 16], gravity: 0 });
      },
      impact: { secs: 1.2, draw: (k, u) => {
        const b = k.target;
        // Wound on quickly and pulled tight, held, then gone back into light.
        const on = easeOut(seg(u, 0, 0.38));
        const out = seg(u, 0.72, 1);
        wrap(k, b, { lo: 0.38, hi: 0.62, turns: 1.8, width: 3, u: on, from: out, spin: k.seed * 0.01, size: 1.12 - 0.12 * smooth(seg(u, 0.3, 0.45)), alpha: 1 - 0.3 * out });
        // The worst wound stops bleeding: drops that fall until the band closes over it, then none.
        if (u < 0.3) k.emit(k.at(b, 0.48), 26, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.6, life: [0.3, 0.5], speed: [0.02, 0.08], up: [-6, 0], gravity: 60, bias: 6 });
        const stop = flashOf(seg(u, 0.36, 1), 0.1);
        cross(k, k.at(b, 0.95 + 0.2 * seg(u, 0.36, 1)), 3.6, { alpha: stop, turn: u * 2.4 });
        k.light(b, 2, 0.5 * (1 - u));
      } },
    },
  },
  // Quick Stitch (ally, on self, player, 2 tiles round): The worst wound on you or on somebody within 2 tiles of you closes by 30% of its severity.
  chirurgeon_quick_stitch: {
    palette: PALETTE,
    cast: { timing: { secs: 0.85, release: 0.55 }, pose: stitchPose },
    fx: {
      charge: (k, t) => {
        // The needle's glint at the fingertips, and a thread trailing after the hand through its loops.
        const h = k.hand(1);
        const st = k.state;
        const live = seg(t, 0.08, 0.14) * (1 - seg(t, 0.55, 0.6));
        // Where the hand was over the last few twentieths of a second, kept in the cast's own numbers, newest first.
        if (!st.n || k.now - st.at > 0.045) {
          for (let i = 3; i > 0; i--) {
            st[`x${i}`] = st[`x${i - 1}`] ?? h.x; st[`y${i}`] = st[`y${i - 1}`] ?? h.y; st[`z${i}`] = st[`z${i - 1}`] ?? h.z;
          }
          st.x0 = h.x; st.y0 = h.y; st.z0 = h.z; st.at = k.now; st.n = 1;
        }
        if (live > 0.01) {
          const pts: P3[] = [];
          for (let i = 3; i >= 1; i--) pts.push({ x: st[`x${i}`], y: st[`y${i}`], z: st[`z${i}`] });
          pts.push(h);
          k.ribbon(pts, { width: 1.4, taper: 'start', alpha: 0.85 * live, main: LINEN, core: '#ffffff', ink: PALETTE.ink, glow: 0.3 });
        }
        k.flare(h, 3.2, live * (0.6 + 0.4 * Math.sin(k.now * 30)), PALETTE.core, k.now * 4);
      },
      travel: { secs: sent(0.06, 0.045), draw: (k, u) => {
        // Straight and quick, the thread paying out behind it from the hand.
        const from = k.hand(1), to = k.heart(k.target);
        const tip = mid3(from, to, easeOut(u));
        thread(k, from, tip, { lift: 1.5 });
        needle(k, tip, mid3(from, to, Math.max(0, easeOut(u) - 0.12)));
      } },
      hit: (k) => k.burst(k.heart(k.target), 5, { kind: 'spark', size: 1.4, life: [0.15, 0.3], speed: [0.3, 0.8], up: [0, 10], gravity: 20, colour: [BLOOD, PALETTE.core] }),
      impact: { secs: 1.1, draw: (k, u) => {
        // On somebody else the wound is on their breast; on oneself it is on the left forearm the cast holds up, along it.
        const b = k.target, w = castOnSelf(k) ? forearmWound(k) : woundAt(k, b, 0);
        const sew = seg(u, 0, 0.55);
        const fade = 1 - seg(u, 0.8, 1);
        suture(k, b, w.at, { len: castOnSelf(k) ? 9 : 14, ang: w.ang, close: k.fx.close ?? 0.3, u: easeOut(sew), gash: fade * (1 - 0.3 * seg(u, 0.5, 0.8)), alpha: fade, needle: (1 - seg(u, 0.5, 0.6)) * (u < 0.6 ? 1 : 0), bob: u * 40 });
        // The thread from the caster's hand still to the needle at work, until it is cut and the knot flashes.
        if (u < 0.6 && !castOnSelf(k)) thread(k, k.hand(1), w.at, { alpha: 1 - seg(u, 0.45, 0.6), lift: 1 });
        if (u > 0.55 && u < 0.7) k.flare(w.at, 5, 1 - seg(u, 0.55, 0.7), PALETTE.core);
      } },
    },
  },
  // Leech (strike, on enemy): With a knife in hand: a knife blow at 80%, and you get back as large a share of your health as it takes of the creature's.
  chirurgeon_leech: {
    palette: PALETTE,
    cast: { timing: { secs: 0.8, release: 0.44 }, pose: leechPose },
    fx: {
      charge: (k, t) => {
        glint(k, k.weaponAt(5), 3.5, bump(t, 0.22, 0.34, 0.42), k.now * 3);
        // A thin red cut across the creature, the way the backhand goes: a scalpel's line, not a sword's arc.
        const u = seg(t, 0.38, 0.5);
        if (u > 0 && u < 1 && k.target !== k.caster) {
          const b = k.target;
          k.slash(b, { u, from: 1.25, to: -1.25, tilt: Math.PI / 2 - 0.3, reach: b.wide * 1.6 + 2, up: b.tall * 0.55, width: 3.4, length: 1.6,
            main: BLOOD, core: BLOOD_CORE, ink: BLOOD_INK, alpha: 1 - seg(t, 0.47, 0.53), glow: 0.6, light: BLOOD_LIGHT, bias: 6 });
        }
      },
      hit: (k) => {
        const at = k.heart(k.target), away = k.toward(k.caster, k.target);
        k.burst(at, 16, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.8, life: [0.35, 0.6], speed: [0.5, 1.4], up: [4, 18], heading: away, cone: 1.8, gravity: 70, bias: 4 });
        k.burst(at, 8, { kind: 'spark', colour: [BLOOD_CORE, BLOOD], size: 1.6, life: [0.15, 0.35], speed: [0.8, 1.8], up: [0, 12], heading: away, cone: 1.4, gravity: 30 });
      },
      impact: { secs: 1.15, draw: (k, u) => {
        // What was cut drawn back: a string of drops off the wound to the caster's breast, red turning to mint on the way.
        const from = k.heart(k.target), to = k.chest();
        const lift = 2 + k.dist * 1.2;
        const n = 6;
        const head = clamp(u * 1.5 - 0.1);
        const pts: P3[] = [];
        for (let i = 0; i < n; i++) {
          const p = clamp(u * 1.7 - 0.1 - i * (0.06 + 0.05 * hashOf(k.seed, i)));
          if (p <= 0 || p >= 1) continue;
          const at = arcAt(from, to, smooth(p), lift);
          // Each drop weaving a little off the line, as something drawn through the air does.
          at.z += Math.sin(p * 9 + i * 2.1) * 1.2;
          pts.push(at);
          const mint = smooth(seg(p, 0.45, 0.85));
          const r = (i === 0 ? 2.1 : 1.1 + 0.7 * hashOf(k.seed + 1, i)) * (1 - 0.35 * mint);
          k.orb(at, r, { main: mixColour(BLOOD, PALETTE.main, mint), deep: mint > 0.5 ? PALETTE.deep : BLOOD_DEEP, core: mint > 0.5 ? PALETTE.core : BLOOD_CORE, ink: mint > 0.5 ? PALETTE.ink : BLOOD_INK, glow: 0.4, light: mint > 0.5 ? PALETTE.light : BLOOD_LIGHT, sides: 6, turn: i });
        }
        if (pts.length >= 2) k.ribbon(pts.reverse(), { width: 0.9, taper: 'both', alpha: 0.45, main: BLOOD, core: BLOOD_CORE, ink: BLOOD_INK, glow: 0, edge: false });
        // The wound on the creature, a red line that fades.
        glint(k, from, 6 * (1 - head), flashOf(u, 0.05) * 0.8);
        // Taken in: a pulse at the caster's breast, and the cross over them.
        const got = seg(u, 0.55, 1);
        if (got > 0) {
          k.shell(k.caster, { alpha: 0.35 * flashOf(got, 0.15), size: 0.85 + 0.1 * got, glow: 0.5 });
          cross(k, k.at(k.caster, 1.0 + 0.18 * got), 3.2, { alpha: flashOf(got, 0.2), turn: got * 2 });
          k.light(k.caster, 2, 0.5 * flashOf(got, 0.2));
        }
      } },
    },
  },
  // Regenerate (ally, on self, player, 4 tiles round, lasts 15 s): You or somebody within 4 tiles of you gets 2% of their health back a second for 15 s.
  chirurgeon_regenerate: {
    palette: PALETTE,
    cast: { timing: { secs: 1.2, release: 0.54 }, pose: regeneratePose },
    fx: {
      charge: (k, t) => {
        // A seed of light gathering in the cupped hand as it dips.
        const g = smooth(seg(t, 0.1, 0.5)) * (1 - seg(t, 0.53, 0.56));
        if (g > 0) {
          const h = k.hand(1);
          k.orb(h, 1 + 1.4 * g, { alpha: g, turn: k.now * 3, sides: 6 });
          k.emit(h, 14 * g, { kind: 'mote', size: 1.3, life: [0.3, 0.6], speed: [0.02, 0.08], up: [4, 10], gravity: 0, jitter: 0.04 });
        }
      },
      travel: { secs: sent(0.16, 0.07), draw: (k, u) => {
        // Lobbed high and soft.
        const from = k.hand(1), to = k.at(k.target, 0.85);
        const lift = 8 + k.dist * 3;
        const pts: P3[] = [];
        for (let i = 5; i >= 0; i--) pts.push(arcAt(from, to, Math.max(0, u - i * 0.04), lift));
        k.ribbon(pts, { width: 2.2, alpha: 0.75 });
        k.orb(pts[5], 2.4, { turn: k.now * 4 });
        k.emit(pts[5], 20, { kind: 'mote', size: 1.3, life: [0.3, 0.5], speed: [0.02, 0.06], up: [-2, 2], gravity: 0 });
      } },
      hit: (k) => k.burst(k.at(k.target, 0.85), 12, { kind: 'mote', size: 1.8, life: [0.5, 0.9], speed: [0.1, 0.3], up: [-12, -4], gravity: -6, jitter: 0.06 }),
      impact: { secs: 0.7, draw: (k, u) => {
        // The seed sinks into them and a band of light goes once round them, down to the ground.
        const b = k.target;
        wrap(k, b, { lo: 0.85, hi: 0.05, turns: 1.5, u: easeOut(u * 1.4), from: seg(u, 0.4, 1), light: true, width: 2.4, size: 1.2 });
        k.light(b, 2.5, 0.6 * (1 - u));
      } },
      linger: { draw: (k, age, left) => {
        const b = k.target, secs = secsOf(k, 15);
        const a = smooth(age / 0.5) * smooth(left / 0.6);
        const R = tallyR(b);
        tally(k, b, R, Math.round(secs), left, { alpha: 0.65 * a });
        // Each second's heal: a soft beat out from the feet and a small cross going up off them.
        const f = age % 1;
        k.ring(b, R * (0.3 + 0.55 * easeOut(f)), { band: 0.03, alpha: 0.45 * a * (1 - f), glow: 0.4, n: 16 });
        cross(k, k.at(b, 0.7 + 0.45 * f), 2.4, { alpha: a * flashOf(f, 0.2) * 0.9, turn: age * 1.5, glow: 0.6 });
        k.light(b, 1.6, 0.25 * a);
        if (!k.fast) k.emit(k.at(b, 0.1), 5 * a, { kind: 'mote', size: 1.3, life: [0.7, 1.2], speed: [0.01, 0.04], up: [8, 14], gravity: 0, jitter: R * 0.04 });
      } },
    },
  },
  // Toxin (curse, on enemy, lasts 20 s): An enemy within 4 tiles of you bleeds 1% of its full health a second for 20 s;
  chirurgeon_toxin: {
    palette: PALETTE,
    cast: { timing: { secs: 0.95, release: 0.5 }, pose: toxinPose },
    fx: {
      charge: (k, t) => {
        // The vial in the hand from when it leaves the belt; a wisp off it once it is unstoppered.
        const held = seg(t, 0.12, 0.18) * (t < 0.5 ? 1 : 0);
        if (held > 0) {
          k.orb(k.hand(1), 1.9, { main: BLOOD, deep: BLOOD_DEEP, core: BLOOD_CORE, ink: BLOOD_INK, alpha: held, sides: 6, glow: 0.5, light: BLOOD_LIGHT, turn: 0.5 });
        }
        if (t > 0.34 && t < 0.5) k.emit(k.hand(1), 18, { kind: 'smoke', colour: [...MIASMA], size: 1.6, life: [0.4, 0.7], speed: [0.02, 0.06], up: [6, 12], gravity: -4, bias: 4 });
        if (t > 0.34 && !k.state.pop) {
          k.state.pop = 1;
          k.burst(k.hand(1), 4, { kind: 'shard', colour: LINEN_DEEP, size: 1.2, life: [0.3, 0.5], speed: [0.2, 0.4], up: [10, 18], gravity: 60, spin: 3 });
        }
      },
      travel: { secs: (tiles) => 0.14 + tiles * 0.075, draw: (k, u) => {
        // Tumbling end over end on a high arc, a thin smoke after it.
        const from = k.hand(1), to = k.heart(k.target);
        const at = arcAt(from, to, u, 5 + k.dist * 3.5);
        k.orb(at, 2.2, { main: BLOOD, deep: BLOOD_DEEP, core: BLOOD_CORE, ink: BLOOD_INK, sides: 6, turn: k.now * 16, glow: 0.7, light: BLOOD_LIGHT });
        k.emit(at, 30, { kind: 'smoke', colour: [...MIASMA], size: 1.4, life: [0.3, 0.5], speed: [0.01, 0.04], up: [2, 6], gravity: -2 });
      } },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 18, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.8, life: [0.4, 0.7], speed: [0.3, 1], up: [10, 26], gravity: 70, bias: 4 });
        k.burst(at, 6, { kind: 'shard', colour: [LINEN, LINEN_DEEP], size: 1.3, life: [0.3, 0.5], speed: [0.4, 0.9], up: [6, 16], gravity: 70, spin: 4 });
        k.burst(at, 8, { kind: 'smoke', colour: [...MIASMA], size: 2.6, life: [0.6, 1.0], speed: [0.1, 0.3], up: [2, 8], gravity: -3, bias: 4 });
      },
      impact: { secs: 0.6, draw: (k, u) => {
        glint(k, k.heart(k.target), 7 * (1 - u), flashOf(u, 0.08));
        k.scorch(k.target, 0.22 * easeOut(u * 2), { colour: BLOOD_DEEP, alpha: 0.5 });
        k.light(k.target, 2, 0.5 * (1 - u), BLOOD_LIGHT);
      } },
      linger: { draw: (k, age, left) => {
        const b = k.target, secs = secsOf(k, 20);
        const a = smooth(age / 0.4) * smooth(left / 0.8);
        // A stain spreading under it as it bleeds, and the seconds of the bleed in red round it.
        k.scorch(b, 0.16 + 0.16 * seg(age, 0, secs), { colour: BLOOD_DEEP, alpha: 0.55 * a });
        tally(k, b, tallyR(b), Math.round(secs), left, { alpha: 0.65 * a, main: BLOOD, deep: BLOOD_DEEP, ink: BLOOD_INK, light: BLOOD_LIGHT });
        // Each second's bleed: a drop off it, and a red glint at the wound.
        const tick = Math.floor(age);
        if (tick !== k.state.tick) {
          k.state.tick = tick;
          k.burst(k.at(b, 0.5), 3, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 2.1, life: [0.4, 0.6], speed: [0.02, 0.1], up: [-2, 4], gravity: 60, jitter: b.wide / 80, bias: 4 });
        }
        glint(k, k.heart(b), 3, a * flashOf(age % 1, 0.1) * 0.7);
        if (!k.fast) k.emit(k.at(b, 0.7), 3 * a, { kind: 'smoke', colour: [...MIASMA], size: 1.5, life: [0.8, 1.2], speed: [0.01, 0.04], up: [3, 6], gravity: -1, jitter: b.wide / 60 });
      } },
    },
  },
  // Surgeon’s Hands (buff, on self, lasts 20 s): For 20 s every dressing you put on puts back twice as much health.
  chirurgeon_surgeons_hands: {
    palette: PALETTE,
    cast: { timing: { secs: 1.3, release: 0.55 }, pose: handsPose },
    fx: {
      charge: (k, t) => {
        // Scrubbing: a froth of motes off the hands, then both caught in light as they come up.
        const scrub = bump(t, 0.12, 0.25, 0.46);
        const mid = mid3(k.hand(0), k.hand(1), 0.5);
        if (scrub > 0) k.emit(mid, 40 * scrub, { kind: 'mote', size: 1.3, life: [0.2, 0.45], speed: [0.1, 0.3], up: [-4, 8], gravity: 10, jitter: 0.02 });
        const up = seg(t, 0.46, 0.56);
        for (let s = 0; s < 2; s++) k.glow(k.hand(s), 5 + 4 * up, 0.3 * scrub + 0.7 * up * (1 - seg(t, 0.56, 0.7) * 0.4));
      },
      hit: (k) => {
        for (let s = 0; s < 2; s++) k.burst(k.hand(s), 8, { kind: 'spark', size: 1.4, life: [0.2, 0.4], speed: [0.3, 0.8], up: [6, 16], gravity: 20 });
      },
      impact: { secs: 0.8, draw: (k, u) => {
        // A glove of light on each hand, set and then thinning to what stays.
        for (let s = 0; s < 2; s++) {
          const h = k.hand(s);
          k.orb(h, 2.2 * (1 + 0.3 * (1 - u)), { alpha: 0.6 * flashOf(u, 0.1), sides: 8, turn: k.now * 2 + s, glow: 0.6 });
          k.flare(h, 6 * (1 - u), flashOf(u, 0.08), PALETTE.core, s * 0.6);
        }
        k.ring(k.caster, 0.12 + 0.22 * easeOut(u), { band: 0.04, alpha: 0.6 * (1 - u), glow: 0.4 });
        k.light(k.caster, 2, 0.55 * (1 - u));
      } },
      linger: { draw: (k, age, left) => {
        const b = k.caster, secs = secsOf(k, 20);
        const a = smooth(age / 0.6) * smooth(left / 0.8);
        // The hands kept lit, a stitch of light pulsing at each fingertip; the seconds round the feet, faintly.
        const beat = 0.7 + 0.3 * Math.sin(age * 4);
        for (let s = 0; s < 2; s++) {
          const h = k.hand(s);
          k.glow(h, 5, 0.45 * a * beat);
          cross(k, h, 1.6, { alpha: 0.85 * a, turn: age * 2 + s * 1.5, glow: 0.4, bias: 8 });
        }
        tally(k, b, tallyR(b), Math.round(secs), left, { alpha: 0.45 * a, band: 0.03 });
        if (!k.fast) k.emit(k.hand(age % 2 < 1 ? 0 : 1), 4 * a, { kind: 'mote', size: 1.2, life: [0.4, 0.8], speed: [0.01, 0.04], up: [3, 8], gravity: 0 });
      } },
    },
  },
  // Healing Circle (nova, on self, 4 tiles round): You and everybody within 4 tiles of you each get back 15% of their own full health.
  chirurgeon_healing_circle: {
    palette: PALETTE,
    cast: { timing: { secs: 1.6, release: 0.5 }, pose: circlePose },
    fx: {
      charge: (k, t) => {
        // Light pooling under the palms as they go down, and a small cross drawn on the ground there.
        const g = smooth(seg(t, 0.22, 0.48));
        const at = k.local(k.caster, 0, PALMS_AHEAD, 0);
        if (g > 0) {
          k.disc(at, 0.12 + 0.18 * g, { alpha: 0.5 * g, n: 8 });
          k.glow(k.on(at.x, at.y, 1), 8 + 6 * g, 0.6 * g);
          crossOnGround(k, at, 0.35 * g, { alpha: g, turn: 0 });
        }
      },
      hit: (k) => {
        const at = k.local(k.caster, 0, PALMS_AHEAD, 0);
        k.burst(k.on(at.x, at.y, 1), 24, { kind: 'mote', size: 2, life: [0.4, 0.8], speed: [0.6, 1.4], up: [4, 12], gravity: 0, drag: 0.2 });
        k.flash(0.06);
      },
      impact: { secs: 1.6, draw: (k, u) => {
        const R = k.fx.reach || 4;
        const at = k.local(k.caster, 0, PALMS_AHEAD, 0);
        const c = { x: lerp(at.x, k.caster.x, smooth(seg(u, 0, 0.3))), y: lerp(at.y, k.caster.y, smooth(seg(u, 0, 0.3))) };
        // The ring goes out from the palms to the edge of who it heals, and stands there a moment.
        const r = R * easeOut(seg(u, 0, 0.42));
        const hold = 1 - seg(u, 0.7, 1);
        k.ring(c, Math.max(0.1, r), { band: 0.12 + 0.12 * (1 - seg(u, 0, 0.42)), alpha: hold, glow: 1.2, turn: u * 0.4 });
        k.disc(c, r, { alpha: 0.07 * hold });
        // Just inside the edge, a running stitch: the circle sewn shut round whoever is in it.
        if (r > 0.6) k.ring(c, r - 0.28, { band: 0.06, alpha: 0.8 * hold, dash: 2, n: Math.max(16, Math.round(r * 12)), main: PALETTE.core, deep: PALETTE.main, glow: 0, turn: u * 0.4 });
        crossOnGround(k, c, Math.min(r * 0.9, R * 0.3), { alpha: 0.6 * hold * seg(u, 0.1, 0.4), turn: 0 });
        // Once it gets there, a cross stands up off the edge at each of eight points and rises, with a curtain of motes.
        const up = seg(u, 0.36, 0.95);
        if (up > 0 && up < 1) {
          const m = k.fast ? 4 : 8;
          for (let i = 0; i < m; i++) {
            const an = (i / m) * TAU + Math.PI / 8;
            const x = c.x + Math.cos(an) * R, y = c.y + Math.sin(an) * R;
            cross(k, k.on(x, y, 3 + 14 * easeOut(up)), 4.2, { alpha: flashOf(up, 0.15) * hold, turn: up * 2 + i, glow: 0.5, bias: 0 });
            k.emit(k.on(x, y, 1), 5, { kind: 'mote', size: 1.6, life: [0.5, 0.9], speed: [0.01, 0.05], up: [14, 26], gravity: 0, jitter: 0.3 });
          }
        }
        cross(k, k.at(k.caster, 1.05 + 0.2 * seg(u, 0.3, 1)), 4.2, { alpha: flashOf(seg(u, 0.25, 1), 0.15), turn: u * 3 });
        // Everybody else the ring passes is mended as it reaches them: a flash of light round them, and the cross off their head.
        for (const { b, d } of covered(k, R, ['player', 'peer'])) {
          const v = seg(u, reachedAt(d, 0.42), reachedAt(d, 0.42) + 0.5);
          if (v <= 0 || v >= 1) continue;
          k.shell(b, { alpha: 0.45 * flashOf(v, 0.12), size: 0.95, glow: 0.5 });
          cross(k, k.at(b, 1.05 + 0.2 * v), 3.4, { alpha: flashOf(v, 0.15), turn: v * 3 + d });
        }
        k.light(c, R + 1, 0.7 * hold);
      } },
    },
  },
  // Mass Dressing (nova, on self, 3 tiles round): On you and everybody within 3 tiles of you, the worst wound stops bleeding and closes by 20% of its severity.
  chirurgeon_mass_dressing: {
    palette: PALETTE,
    cast: { timing: { secs: 1.3, release: 0.5 }, pose: massPose },
    fx: {
      charge: (k, t) => {
        // The strips held out from both hands, trailing after them as the body winds and whips round, sagging.
        const g = smooth(seg(t, 0.15, 0.3)) * (1 - seg(t, 0.48, 0.52));
        const st = k.state;
        for (let s = 0; s < 2; s++) {
          const h = k.hand(s);
          const key = s ? 'r' : 'l';
          if (!st[key + 'n'] || k.now - st[key + 'at'] > 0.04) {
            for (let i = 3; i > 0; i--) {
              st[key + 'x' + i] = st[key + 'x' + (i - 1)] ?? h.x;
              st[key + 'y' + i] = st[key + 'y' + (i - 1)] ?? h.y;
              st[key + 'z' + i] = st[key + 'z' + (i - 1)] ?? h.z;
            }
            st[key + 'x0'] = h.x; st[key + 'y0'] = h.y; st[key + 'z0'] = h.z; st[key + 'at'] = k.now; st[key + 'n'] = 1;
          }
          if (g <= 0.01) continue;
          const pts: P3[] = [];
          for (let i = 3; i >= 1; i--) pts.push({ x: st[key + 'x' + i], y: st[key + 'y' + i], z: st[key + 'z' + i] - i * 1.4 + Math.sin(k.now * 16 + i + s * 2) * 0.4 });
          pts.push(h);
          k.ribbon(pts, { width: 2.4, taper: 'none', alpha: g, main: LINEN, core: '#ffffff', ink: LINEN_INK, glow: 0.2 });
        }
      },
      hit: (k) => k.flash(0.05),
      impact: { secs: 1.3, draw: (k, u) => {
        const R = k.fx.reach || 3;
        const c = k.caster;
        // Six strips spun out in a spiral, each laid down on the ground where it reaches the edge.
        const strips = 6;
        const fly = easeOut(seg(u, 0, 0.5));
        const fade = 1 - seg(u, 0.72, 1);
        const swirl = 1.6;
        for (let i = 0; i < strips; i++) {
          const base = (i / strips) * TAU + k.seed * 0.001;
          const pts: P3[] = [];
          for (let j = 0; j <= 5; j++) {
            const v = Math.max(0, fly - (5 - j) * 0.08);
            const an = base + swirl * v;
            const rr = 0.15 + (R - 0.15) * v;
            const x = c.x + Math.cos(an) * rr, y = c.y + Math.sin(an) * rr;
            pts.push(k.on(x, y, lerp(k.caster.tall * 0.55, 1, v) + Math.sin(k.now * 20 + j + i) * 0.5 * (1 - v)));
          }
          k.ribbon(pts, { width: 3.6, taper: 'start', alpha: fade * (1 - seg(u, 0.5, 0.7)), main: LINEN, core: '#ffffff', ink: LINEN_INK, glow: 0.25 });
        }
        // Where they land, a woven band at the edge: linen over mint.
        const band = seg(u, 0.4, 0.55);
        if (band > 0) {
          k.ring(c, R, { band: 0.22, alpha: 0.85 * band * fade, glow: 1, turn: 0.2 });
          k.ring(c, R - 0.04, { band: 0.12, alpha: band * fade, main: LINEN, deep: LINEN_DEEP, ink: LINEN_INK, glow: 0, dash: 2, n: strips * 6, turn: swirl });
        }
        // Everybody else within it dressed as the strips land, the nearer first.
        for (const { b, d } of covered(k, R, ['player', 'peer']).slice(0, 5)) {
          const on = seg(u, 0.25 + 0.2 * d, 0.55 + 0.2 * d);
          if (on > 0) wrap(k, b, { lo: 0.42, hi: 0.58, turns: 1.6, u: easeOut(on), from: seg(u, 0.8, 1), spin: swirl + d * 3 });
        }
        // And on the caster, a dressing of their own.
        wrap(k, c, { lo: 0.42, hi: 0.58, turns: 1.6, u: easeOut(seg(u, 0.1, 0.45)), from: seg(u, 0.75, 1), spin: swirl });
        k.light(c, R + 0.5, 0.6 * fade);
      } },
    },
  },
  // Plague (nova, on self, 4 tiles round, lasts 10 s): Every enemy within 4 tiles of you bleeds 1% of its full health a second for 10 s;
  chirurgeon_plague: {
    palette: PALETTE,
    cast: { timing: { secs: 1.4, release: 0.54 }, pose: plaguePose },
    fx: {
      charge: (k, t) => {
        // A sickness gathering at the mouth, coughed into the hands.
        const g = seg(t, 0.25, 0.5);
        if (g > 0 && t < 0.54) {
          const at = mid3(k.head(), mid3(k.hand(0), k.hand(1), 0.5), 0.5);
          k.emit(at, 30 * g, { kind: 'smoke', colour: [...MIASMA], size: 1.8, life: [0.4, 0.8], speed: [0.02, 0.08], up: [-4, 4], gravity: -2, bias: 6 });
          k.glow(at, 6, 0.35 * g, BLOOD_LIGHT);
        }
      },
      hit: (k) => {
        const R = k.fx.reach || 4;
        const c = k.at(k.caster, 0.25);
        // Flung out over the ground, as far as it reaches.
        k.burst(c, 46, { kind: 'smoke', colour: [...MIASMA], size: 3.2, life: [0.9, 1.5], speed: [R * 0.9, R * 1.5], up: [0, 4], gravity: 0, drag: 0.15, bias: 2 });
        k.burst(k.at(k.caster, 0.5), 12, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.6, life: [0.4, 0.7], speed: [0.6, 1.4], up: [6, 16], gravity: 60 });
      },
      impact: { secs: 1.1, draw: (k, u) => {
        const R = k.fx.reach || 4;
        const r = R * easeOut(seg(u, 0, 0.5));
        k.disc(k.caster, Math.max(0.1, r), { main: BLOOD_DEEP, alpha: 0.12 * (1 - seg(u, 0.6, 1)) + 0.06 * seg(u, 0.6, 1) });
        k.ring(k.caster, Math.max(0.1, r), { band: 0.16, alpha: 0.9 * (1 - seg(u, 0.75, 1)), main: BLOOD, deep: BLOOD_DEEP, ink: BLOOD_INK, glow: 0, dash: 3, turn: -u });
        // A bank of the miasma rolling along the front as it goes out.
        if (u < 0.5) {
          const m = k.fast ? 5 : 10;
          for (let i = 0; i < m; i++) {
            const an = (i / m) * TAU + hashOf(k.seed, i);
            k.emit(k.on(k.caster.x + Math.cos(an) * r, k.caster.y + Math.sin(an) * r, 2), 10, { kind: 'smoke', colour: [...MIASMA], size: 3, sizeEnd: 7, life: [0.6, 1.0], speed: [0.1, 0.3], up: [2, 6], gravity: -2, heading: { x: Math.cos(an), y: Math.sin(an) }, cone: 1 });
          }
        }
        k.light(k.caster, R, 0.4 * (1 - u), BLOOD_LIGHT);
        // Every creature the front reaches: a red glint at its heart as it is caught.
        for (const { b, d } of covered(k, R, ['creature'])) {
          const v = seg(u, reachedAt(d, 0.5), reachedAt(d, 0.5) + 0.35);
          if (v > 0 && v < 1) glint(k, k.heart(b), 6, flashOf(v, 0.1));
        }
      } },
      linger: { draw: (k, age, left) => {
        const R = k.fx.reach || 4, secs = secsOf(k, 10);
        // Every creature in it bleeds a second at a time: a drop off it and a red glint each second, a mark over it.
        const tick = Math.floor(age);
        const struck = covered(k, R, ['creature']);
        const fresh = tick !== k.state.tick;
        k.state.tick = tick;
        for (const { b } of struck) {
          if (fresh) k.burst(k.at(b, 0.5), 2, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 2, life: [0.4, 0.6], speed: [0.02, 0.1], up: [-2, 4], gravity: 60, jitter: b.wide / 80, bias: 4 });
          glint(k, k.heart(b), 3, smooth(age / 0.6) * smooth(left / 1) * flashOf(age % 1, 0.1) * 0.7);
        }
        const a = smooth(age / 0.6) * smooth(left / 1);
        // The edge of the sickness kept as the seconds of the bleed, a faint stain over all it covers, and a low miasma
        // creeping inside it.
        k.disc(k.caster, R * 0.97, { main: BLOOD_DEEP, alpha: 0.06 * a });
        tally(k, k.caster, R, Math.round(secs), left, { alpha: 0.55 * a, band: 0.12, main: BLOOD, deep: BLOOD_DEEP, ink: BLOOD_INK, light: BLOOD_LIGHT, turn: age * 0.05 });
        if (!k.fast || k.rand() < 0.5) {
          const an = k.rand() * TAU, rr = R * Math.sqrt(k.rand());
          k.emit(k.on(k.caster.x + Math.cos(an) * rr, k.caster.y + Math.sin(an) * rr, 1), 8 * a, { kind: 'smoke', colour: [...MIASMA], size: 3.4, sizeEnd: 9, life: [1.4, 2.2], speed: [0.02, 0.08], up: [1, 3], gravity: -1 });
        }
      } },
    },
  },
  // Battlefield Surgery (ally, on self, player, 2 tiles round): Every wound on you or on somebody within 2 tiles of you closes by 50% of its severity, and they get 20% of their health back.
  chirurgeon_battlefield_surgery: {
    palette: PALETTE,
    cast: { timing: { secs: 1.8, release: 0.54 }, pose: surgeryPose },
    fx: {
      charge: (k, t) => {
        // Both hands at work: a glint at one then the other, a thread strung between them.
        const w = seg(t, 0.18, 0.24) * (1 - seg(t, 0.5, 0.54));
        if (w <= 0) return;
        const h0 = k.hand(0), h1 = k.hand(1);
        thread(k, h0, h1, { alpha: w * 0.9, lift: -1.5 });
        const which = Math.sin(seg(t, 0.18, 0.5) * TAU * 3.5) > 0 ? 1 : 0;
        k.flare(which ? h1 : h0, 3.4, w, PALETTE.core, k.now * 5);
        k.glow(mid3(h0, h1, 0.5), 7, 0.4 * w);
      },
      travel: { secs: sent(0.1, 0.05), draw: (k, u) => {
        // Three needles, each on its own arc to its own wound, a thread behind each.
        const b = k.target;
        for (let i = 0; i < 3; i++) {
          const from = k.hand(i === 1 ? 0 : 1), to = woundAt(k, b, i).at;
          const v = clamp(u * 1.15 - i * 0.07);
          const lift = (i - 1) * 3 + 2 + k.dist * 1.5;
          const tip = arcAt(from, to, easeOut(v), lift);
          thread(k, from, tip, { lift: lift * 0.6, alpha: 0.8 });
          needle(k, tip, arcAt(from, to, Math.max(0, easeOut(v) - 0.1), lift));
        }
      } },
      hit: (k) => {
        k.burst(k.heart(k.target), 10, { kind: 'mote', size: 1.8, life: [0.4, 0.8], speed: [0.1, 0.4], up: [4, 14], gravity: 0 });
        k.flash(0.05);
      },
      impact: { secs: 1.7, draw: (k, u) => {
        const b = k.target;
        const fade = 1 - seg(u, 0.82, 1);
        // Every wound, stitched together at once, half of each closed.
        for (let i = 0; i < 3; i++) {
          const w = woundAt(k, b, i);
          suture(k, b, w.at, { len: [13, 11, 10][i], ang: w.ang, close: k.fx.close ?? 0.5, u: easeOut(seg(u, 0.02 + i * 0.05, 0.42 + i * 0.05)), gash: fade, alpha: fade });
        }
        // Then bound, and the health back: a dressing round the middle, a column of light, the cross.
        wrap(k, b, { lo: 0.36, hi: 0.56, turns: 1.8, u: easeOut(seg(u, 0.4, 0.66)), from: seg(u, 0.84, 1), spin: 1 });
        const lift = flashOf(seg(u, 0.5, 1), 0.12);
        k.pillar(b, { r: 6, h: 36, alpha: 0.55 * lift });
        cross(k, k.at(b, 1.05 + 0.2 * seg(u, 0.5, 1)), 4, { alpha: lift, turn: u * 3 });
        k.ring(b, 0.2 + 0.4 * easeOut(seg(u, 0.5, 1)), { band: 0.06, alpha: 0.7 * (1 - seg(u, 0.5, 1)), glow: 0.6 });
        k.light(b, 3, 0.6 * fade);
      } },
    },
  },
  // Restoration (buff, on self): Every wound on you closes, and you get 30% of your health back.
  chirurgeon_restoration: {
    palette: PALETTE,
    cast: { timing: { secs: 1.6, release: 0.55 }, pose: restorePose },
    fx: {
      charge: (k, t) => {
        // The wounds shown on the body as it gathers itself, and light under the crossed arms.
        const b = k.caster;
        const show = seg(t, 0.1, 0.3);
        for (let i = 0; i < 3; i++) {
          const w = woundAt(k, b, i);
          suture(k, b, w.at, { len: 8, ang: w.ang, close: 1, u: 0, gash: show * seg(t, 0.1 + i * 0.04, 0.2 + i * 0.04), alpha: 1 });
        }
        k.glow(k.chest(), 6 + 6 * seg(t, 0.25, 0.55), 0.6 * seg(t, 0.2, 0.55));
      },
      hit: (k) => {
        k.burst(k.chest(), 16, { kind: 'mote', size: 2, life: [0.4, 0.8], speed: [0.2, 0.6], up: [4, 20], gravity: 0 });
        k.flash(0.07);
      },
      impact: { secs: 1.4, draw: (k, u) => {
        const b = k.caster;
        // A band of light rising up the body, feet to crown; each wound it passes is stitched shut, the whole of it.
        const rise = easeOut(seg(u, 0, 0.6));
        const fade = 1 - seg(u, 0.75, 1);
        for (let i = 0; i < 3; i++) {
          const w = woundAt(k, b, i);
          const share = (w.at.z - b.z) / b.tall;
          const sewn = seg(rise, share - 0.12, share + 0.02);
          suture(k, b, w.at, { len: 8, ang: w.ang, close: 1, u: sewn, gash: 1 - seg(u, 0.55, 0.8), alpha: 1 - seg(u, 0.6, 0.9) });
        }
        const h = lerp(0.02, 1.02, rise);
        if (u < 0.75) wrap(k, b, { lo: h, hi: h, turns: 1, u: 1, light: true, width: 3.4 * (1 - 0.5 * seg(u, 0.5, 0.75)), size: 1.25, alpha: 1 - seg(u, 0.6, 0.75) });
        if (u < 0.6) k.emit(k.at(b, h), 30, { kind: 'mote', size: 1.6, life: [0.3, 0.6], speed: [0.05, 0.15], up: [2, 8], gravity: 0, jitter: 0.08 });
        k.shell(b, { alpha: 0.35 * flashOf(seg(u, 0.5, 1), 0.15), size: 0.95, glow: 0.7 });
        cross(k, k.at(b, 1.1 + 0.2 * seg(u, 0.55, 1)), 4.4, { alpha: flashOf(seg(u, 0.55, 1), 0.15), turn: u * 3 });
        k.light(b, 3, 0.7 * fade);
      } },
    },
  },
  // Miracle Worker (ally, on self, player, 4 tiles round): Every wound on you or on somebody within 4 tiles of you closes, with whatever bleeding and venom was in it, and they get 50% of their health back.
  chirurgeon_miracle_worker: {
    palette: PALETTE,
    cast: { timing: { secs: 2.0, release: 0.55 }, pose: miraclePose },
    fx: {
      charge: (k, t) => {
        // A light gathered between the joined hands overhead, and the cross drawn on the ground under whoever it is for.
        const g = smooth(seg(t, 0.12, 0.46)) * (1 - seg(t, 0.5, 0.56));
        const at = mid3(k.hand(0), k.hand(1), 0.5);
        if (g > 0) {
          k.orb(at, 2 + 3 * g, { alpha: g, turn: k.now * 2 });
          k.light(at, 2 + 2 * g, 0.6 * g);
          k.emit(at, 30 * g, { kind: 'mote', size: 1.6, life: [0.3, 0.6], speed: [0.05, 0.2], up: [-10, 4], gravity: 0, jitter: 0.05 });
        }
        const d = smooth(seg(t, 0.2, 0.55));
        if (d > 0) {
          crossOnGround(k, k.target, 0.72 * d, { alpha: 0.85 * d, turn: 0 });
          k.ring(k.target, 1.0, { band: 0.08, alpha: d, glow: 0.8, turn: k.now * 0.3 });
        }
      },
      travel: { secs: sent(0.14, 0.05), draw: (k, u) => {
        // One broad stream of light from both palms.
        const from = mid3(k.hand(0), k.hand(1), 0.5), to = k.heart(k.target);
        const pts: P3[] = [];
        for (let i = 6; i >= 0; i--) pts.push(arcAt(from, to, Math.max(0, easeOut(u) - i * 0.07), 2 + k.dist));
        k.ribbon(pts, { width: 6, taper: 'start' });
        k.orb(pts[6], 3.6, { turn: k.now * 4 });
      } },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 40, { kind: 'mote', size: 2.2, life: [0.6, 1.1], speed: [0.2, 0.8], up: [10, 30], gravity: 0, drag: 0.3 });
        // What was in the wounds driven out: bad blood and venom, flung off and falling.
        k.burst(at, 20, { kind: 'drop', colour: [BLOOD_DEEP, '#5a2a33'], size: 2, life: [0.5, 0.8], speed: [0.6, 1.4], up: [10, 24], gravity: 70, bias: 4 });
        k.burst(at, 12, { kind: 'smoke', colour: [...MIASMA], size: 2.8, life: [0.6, 1.0], speed: [0.3, 0.7], up: [6, 14], gravity: -4, bias: 4 });
        k.flash(0.16);
      },
      impact: { secs: 2.2, draw: (k, u) => {
        const b = k.target;
        const fade = 1 - seg(u, 0.78, 1);
        crossOnGround(k, b, 0.72, { alpha: 0.85 * fade, turn: 0 });
        k.ring(b, 1.0 + 0.1 * easeOut(u), { band: 0.1, alpha: fade, glow: 1, turn: k.now * 0.3 });
        k.pillar(b, { r: 11, h: 90, alpha: 0.75 * flashOf(u, 0.06) });
        // Every wound closed outright, and bound.
        for (let i = 0; i < 4; i++) {
          const w = woundAt(k, b, i);
          suture(k, b, w.at, { len: 10, ang: w.ang, close: 1, u: easeOut(seg(u, 0.02, 0.3)), gash: 1 - seg(u, 0.2, 0.45), alpha: 1 - seg(u, 0.4, 0.6) });
        }
        wrap(k, b, { lo: 0.15, hi: 0.85, turns: 3, u: easeOut(seg(u, 0.1, 0.45)), from: seg(u, 0.65, 0.95), spin: 0.5, light: seg(u, 0.5, 0.6) > 0.5 });
        cross(k, k.at(b, 1.12 + 0.3 * seg(u, 0.3, 1)), 6, { alpha: flashOf(seg(u, 0.2, 1), 0.12), turn: u * 4 });
        k.light(b, 4, 0.9 * fade);
      } },
    },
  },
};

/** The cross laid flat on the ground: a Greek cross `r` tiles to a tip, inked, under whoever it is for. */
function crossOnGround(k: FxScene, c: { x: number; y: number }, r: number, o: { alpha?: number; turn?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.03) return;
  const w = 0.3;
  const shape = [[-w, -1], [w, -1], [w, -w], [1, -w], [1, w], [w, w], [w, 1], [-w, 1], [-w, w], [-1, w], [-1, -w], [-w, -w]];
  // Turned so its arms lie square to the screen, whichever way the camera is turned: a cross, never a saltire.
  const yx = k.eye.worldToScreenY(c.x + 1, c.y, 0) - k.eye.worldToScreenY(c.x, c.y, 0);
  const yy = k.eye.worldToScreenY(c.x, c.y + 1, 0) - k.eye.worldToScreenY(c.x, c.y, 0);
  const th = Math.atan2(-yx, yy) + (o.turn ?? 0);
  const ct = Math.cos(th), st = Math.sin(th);
  const pts: number[] = [];
  for (const [u, v] of shape) pts.push(c.x + (u * ct - v * st) * r, c.y + (u * st + v * ct) * r);
  const inkW = Math.max(0.8, 0.8 * k.zoom);
  k.groundShape(c.x, c.y, r + 0.3, [
    { kind: 'fill', colour: PALETTE.main, alpha: clamp(a * 0.3), paths: [pts], lift: 0.12 },
    { kind: 'stroke', colour: PALETTE.core, alpha: clamp(a), paths: [pts], lift: 0.12, width: inkW * 2.2, closed: true, join: 'miter' },
    { kind: 'stroke', colour: PALETTE.ink, alpha: clamp(a), paths: [pts], lift: 0.12, width: inkW, closed: true, join: 'miter' },
  ]);
  k.glow(k.on(c.x, c.y, 0.5), r * HALF_W * 0.9, a * 0.4);
}
