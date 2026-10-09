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
 * A buff on the caster's own hands (Surgeon's Hands) keeps its count on the
 * hands, a ring of a tick a second round each, never on the ground: the tally
 * is for what ticks on a body. On a heal the open wound is drawn dark and the
 * share sewn a glowing mint seam, so a body being mended never reads as one
 * being cut.
 *
 * The heals are linen and mint and come in from the hands; the harms (Leech,
 * Toxin, Plague) are blood, a vial and a miasma, in the accent red, and never
 * use the cross. Every spell's size and time are read off its numbers
 * (`k.fx.reach`, `k.fx.secs`, `k.fx.close`), never written here.
 */
import type { Body, FxScene, P3, SpellPalette } from './kit';
import type { CastClose, CastPose, SpellVisual } from './index';
import { arcAt, bump, clamp, dry, easeOut, eatTail, flashOf, glowPicture, hashOf, lerp, mid3, mixColour, seg, smooth, TAU } from './kit';
import { armOut, euler, heldFor, one, onSelf } from './poses';
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
/** The miasma, a gas: a bruised red, pale enough that its soft mist reads as a vapour and not as specks of dirt. */
const VAPOUR = ['#a0606c', '#8a4a58', '#b47a84'] as const;

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
  /**
   * How wet the open part is: one a bright red down its middle (a wound still bleeding), nought dark all through.
   * A wound being mended dries as it is sewn, so the red never outshines the mending on a heal.
   */
  wet?: number;
  alpha?: number;
  /** A needle at the head of the stitching, this opaque, bobbing in and out by `bob` (radians). */
  needle?: number;
  bob?: number;
  /** Pixels nearer the viewer in the sort (7): over a column of light, say. */
  bias?: number;
}

/**
 * A wound on a body and the stitches closing it: a dark gash, and stitches
 * put in along it from one end, `close` of it in all. The stitched part is
 * pulled shut into a mint seam that glows, so on a heal the share mended is
 * the brightest thing on the body and what is left open a dark line. Drawn
 * over whoever it is on, as a wound shows on them from wherever they are seen.
 */
function suture(k: FxScene, b: Body, at: P3, o: SutureOpts): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), L = k.px(o.len);
  const dx = Math.cos(o.ang), dy = Math.sin(o.ang), nx = -dy, ny = dx;
  const ax = x - dx * L * 0.5, ay = y - dy * L * 0.5;
  const sewn = clamp(o.close * clamp(o.u));
  const done = clamp(o.u);
  const gash = clamp(o.gash ?? 1);
  const W = L * 0.085;
  const stitches = Math.max(3, Math.round((o.close * o.len) / 2.6));
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  // Bright only while it bleeds and nothing is sewn yet; as the stitching comes, the rest of it dries dark and narrows.
  const wet = clamp((o.wet ?? 0) * (1 - done));
  const bias = o.bias ?? 7;
  k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    // The open part of the gash, from where the stitching has got to, to the far end: a slit with curved lips, dark
    // at the edges, pointed at both ends as a cut is.
    if (gash > 0.01 && sewn < 0.99) {
      const s = sewn;
      const w = W * gash * Math.min(1, (1 - s) * 2) * (1 - 0.4 * done);
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
      lips(0.4);
      g.fillStyle = mixColour(BLOOD_INK, BLOOD, wet);
      g.fill();
    }
    if (sewn <= 0.001) return;
    g.globalAlpha = clamp(a);
    // The closed part: a mint seam, pulled shut, the stitches across it in the deep green and its upper edge lit.
    const ex = ax + dx * L * sewn, ey = ay + dy * L * sewn;
    const half = W * 0.95;
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo((ax + ex) / 2 + nx * W * 0.7, (ay + ey) / 2 + ny * W * 0.7, ex, ey);
    g.quadraticCurveTo((ax + ex) / 2 - nx * W * 0.7, (ay + ey) / 2 - ny * W * 0.7, ax, ay);
    g.closePath();
    g.fillStyle = PALETTE.main;
    g.fill();
    g.lineWidth = Math.max(0.7, inkW * 0.6);
    g.strokeStyle = PALETTE.deep;
    g.stroke();
    g.lineWidth = Math.max(1, k.zoom * 0.9);
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
  }, bias);
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
      g.lineCap = 'butt';
    }, bias + 1);
    k.glowDraw((g) => {
      const pic = glowPicture(PALETTE.light);
      if (!pic) return;
      const R = k.px(5);
      g.globalAlpha = nd * 0.6;
      g.drawImage(pic, tipX - R, tipY - R, 2 * R, 2 * R);
    });
  }
  // The mended share glows along its whole length, so at play size it reads as light along a seam, not a cut.
  const lit = a * clamp(sewn * 4);
  if (lit > 0.01) {
    const ex = ax + dx * L * sewn, ey = ay + dy * L * sewn;
    k.glowDraw((g) => {
      g.globalAlpha = clamp(lit * 0.4);
      g.lineCap = 'round';
      g.strokeStyle = PALETTE.light;
      g.lineWidth = k.px(2.8);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(ex, ey);
      g.stroke();
      g.lineCap = 'butt';
    });
    k.glow(at, o.len * 0.5, lit * 0.25);
  }
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
function tally(k: FxScene, c: { x: number; y: number }, r: number, n: number, lit: number, o: { band?: number; alpha?: number; main?: string; deep?: string; ink?: string; light?: string; turn?: number; glowEvery?: number; over?: boolean } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || n < 1 || r <= 0.05) return;
  const band = o.band ?? Math.max(0.04, r * 0.11);
  const span = TAU / n, gap = Math.min(span * 0.3, 0.12);
  const sub = Math.max(2, Math.min(k.fast ? 3 : 5, Math.round(span * r * 4)));
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
    // The segments still to come are lit from within after dark (a night rim), so the count reads at night.
    { kind: 'fill', colour: main, alpha: clamp(a), paths: on, lift: 0.15, glow: 0.55 * k.night * a, light: o.light ?? PALETTE.light },
    { kind: 'stroke', colour: ink, alpha: clamp(a), paths: on, lift: 0.15, width: inkW, closed: true, join: 'miter' },
  ]);
  // A soft light off every `glowEvery`th lit segment, so the tally has a little light of its own by day as well.
  const step = o.glowEvery ?? Math.max(1, Math.ceil(mids.length / 6));
  for (let i = 0; i < mids.length; i += step) k.glow(mids[i], band * HALF_W * 2.4, a * (0.35 + 0.25 * k.night) * (i === whole ? part : 1), o.light ?? PALETTE.light, o.over);
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
  // Laid over, not added: blood added over grass goes olive.
  k.glow(p, r * 0.8, alpha * 0.6, BLOOD_LIGHT, true);
}

/** Where to put a wound on somebody: `i` of a few spread over the body, the same every frame. */
function woundAt(k: FxScene, b: Body, i: number): { at: P3; ang: number } {
  // Breast, belly, thigh, shoulder: spread down the body, so a few of them never run into one another.
  const up = [0.66, 0.5, 0.34, 0.78][i % 4];
  const side = [-0.14, 0.16, -0.1, 0.18][i % 4] * b.wide;
  let at = k.local(b, side, 0, b.tall * up);
  if (b.figure) {
    // On a person, on the body as it is posed -- kneeling, bowed, stepping -- and not where it would be standing up.
    const on = [mid3(k.joint(b, 'chest'), k.joint(b, 'spine'), 0.3), mid3(k.joint(b, 'spine'), k.joint(b, 'pelvis'), 0.4),
      mid3(k.joint(b, 'hip0'), k.joint(b, 'knee0'), 0.45), mid3(k.joint(b, 'chest'), k.joint(b, 'neck'), 0.5)][i % 4];
    const off = k.local(b, side, 0, 0);
    at = { x: on.x + off.x - b.x, y: on.y + off.y - b.y, z: on.z };
  }
  // All lying much the same way, as cuts from one fight do, so they never cross into an X.
  const ang = (hashOf(k.seed, i) - 0.5) * 0.5 - 0.35 + (i % 2) * 0.3;
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

/*
 * Every cast but Leech is hand-work -- a dressing torn, a needle pinched, palms laid flat -- so the knife is put away
 * at the belt for it (`Rig.stow`), blended in and out with the cast, and both hands are free to open and take shape.
 * Leech is the one blow, and keeps it.
 */

/**
 * Field Dressing: a roll of linen held in both hands at the belt, torn off
 * with the right hand flung out and back to the side as the chest winds away,
 * then the chest swung through and the arm whipped straight at the one being
 * dressed, sending the strip; a long step onto the front foot.
 */
const dressingPose: CastPose = (r, t, c) => {
  r.stow = 1;
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.24, [42, -6, 30]], [0.36, [44, -4, 30]], [0.5, [40, 4, 22]], [0.7, [30, 10, 10]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 16], [0.24, 92], [0.36, 96], [0.5, 80], [1, 20]]);
  r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.24, [40, -8, 34]], [0.32, [44, -8, 34]], [0.42, [50, 62, -12]], [0.52, [95, 10, -4]], [0.68, [84, 8, -4]], [1, [14, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 16], [0.24, 96], [0.32, 98], [0.42, 34], [0.52, 4], [0.68, 12], [1, 20]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.42, [0, 0, 20]], [0.52, [-20, 0, -60]], [0.7, [-10, 0, -40]], [1, [0, 0, 0]]]);
  r.open = [t > 0.18 && t < 0.8, t > 0.4 && t < 0.85];
  // Wound away (the right shoulder back) as the strip tears, swung through as it goes.
  r.chest = euler(t, [[0, [0, 0, 0]], [0.24, [-6, 0, 4]], [0.42, [-4, 2, -28]], [0.54, [-10, -2, 22]], [0.72, [-6, 0, 10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [-4, 0, -4]], [0.42, [-2, 0, -10]], [0.54, [-14, 0, 10]], [0.75, [-8, 0, 4]], [1, [-1, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.24, [-16, 0, 0]], [0.38, [-12, 0, 10]], [0.52, [-4, 0, -8]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.36, [0, 3, 0]], [0.42, [-6, 3, 0]], [0.54, [28, 3, 0]], [0.75, [22, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.42, 10], [0.54, 30], [0.75, 24], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.42, [4, 2, 0]], [0.54, [-16, 2, 0]], [0.75, [-12, 2, 0]], [1, [-1, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.42, 16], [0.54, 8], [1, 4]]);
  // The roll held in a cupped left hand; the right hand flat as it sends the strip.
  r.shape = [{ cup: bump(t, 0.1, 0.22, 0.6) }, { flat: bump(t, 0.38, 0.5, 0.86) }];
  if (onSelf(c)) {
    // On oneself the strip is not sent but wound on: the right hand carried round the waist and back again, the eyes
    // on it, and no step.
    r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.24, [40, -8, 34]], [0.33, [44, -8, 34]], [0.42, [30, 46, -6]], [0.54, [38, -22, 52]], [0.68, [30, 26, -8]], [1, [14, 10, 0]]]);
    r.elbow[1] = one(t, [[0, 16], [0.24, 96], [0.33, 98], [0.42, 50], [0.54, 112], [0.68, 64], [1, 20]]);
    r.hand[1] = [0, 0, 0];
    r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-6, 0, 0]], [0.42, [-6, 0, -12]], [0.54, [-10, 0, 14]], [0.7, [-6, 0, -6]], [1, [0, 0, 0]]]);
    r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [-4, 0, 0]], [1, [0, 0, 0]]]);
    r.head = euler(t, [[0, [0, 0, 0]], [0.24, [-18, 0, 0]], [0.72, [-18, 0, 0]], [1, [0, 0, 0]]]);
    r.leg = [[2, 2, 0], [0, 2, 0]];
    r.knee = [one(t, [[0, 4], [0.4, 10], [1, 4]]), one(t, [[0, 4], [0.4, 10], [1, 4]])];
  }
};

/** Where a Quick Stitch's pose stops, holding the thread up taut, while the stitches go in at the far end. */
const STITCH_HOLD = 0.68;

/**
 * Quick Stitch: the left hand held out flat under the wound, the right
 * pinched on a needle and sewing three big loops before the chest -- in and
 * down to the left palm, up and out to the right -- then flicked at the one
 * being stitched, sending the needle; the hand then held up high with the
 * thread taut, tugging it once for every stitch that goes in.
 */
const stitchPose: CastPose = (r, t, c) => {
  r.stow = 1;
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.16, [56, 2, 14]], [0.74, [56, 2, 14]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 16], [0.16, 54], [0.74, 50], [1, 18]]);
  r.open[0] = t > 0.08 && t < 0.88;
  // Three loops: in and down to the palm, then up and out, each quicker than the last.
  const IN: [number, number, number] = [50, -16, 26], OUT: [number, number, number] = [80, 40, -12];
  r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.12, OUT], [0.19, IN], [0.26, OUT], [0.32, IN], [0.38, OUT], [0.43, IN],
    [0.49, [70, 30, -8]], [0.55, [96, 12, -6]], [STITCH_HOLD, [124, 24, -14]], [1, [14, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 16], [0.12, 40], [0.19, 116], [0.26, 40], [0.32, 116], [0.38, 40], [0.43, 116], [0.49, 60], [0.55, 8], [STITCH_HOLD, 46], [1, 18]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.19, [30, 0, 0]], [0.26, [-24, 0, 0]], [0.32, [30, 0, 0]], [0.38, [-24, 0, 0]], [0.43, [30, 0, 0]], [0.55, [-30, 0, 0]], [STITCH_HOLD, [-20, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = false;
  // Each stitch that goes in at the far end, a tug on the thread: the hand jerked up and back.
  const held = t >= STITCH_HOLD - 0.001 ? heldFor(c) : 0;
  const tug = held > 0 && held < 1 ? Math.pow(Math.abs(Math.sin(held * 3 * Math.PI)), 3) : 0;
  r.arm[1] = [r.arm[1][0] + 14 * tug, r.arm[1][1] + 6 * tug, r.arm[1][2]];
  r.elbow[1] -= 22 * tug;
  r.chest = euler(t, [[0, [0, 0, 0]], [0.16, [-6, 0, 0]], [0.45, [-8, 0, -4]], [0.55, [-2, 0, 10]], [STITCH_HOLD, [4, 0, -8]], [1, [0, 0, 0]]]);
  r.chest[0] += 3 * tug;
  r.head = euler(t, [[0, [0, 0, 0]], [0.16, [-16, 0, 0]], [0.45, [-14, 0, 0]], [0.55, [-4, 0, -6]], [STITCH_HOLD, [-2, 0, -8]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.16, [-4, 0, 0]], [0.55, [-6, 0, 4]], [STITCH_HOLD, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.knee = [one(t, [[0, 4], [0.2, 10], [0.55, 16], [0.75, 10], [1, 4]]), one(t, [[0, 4], [0.2, 10], [0.6, 8], [1, 4]])];
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.2, [10, 3, 0]], [0.55, [16, 3, 0]], [0.75, [10, 3, 0]], [1, [2, 2, 0]]]);
  // The left hand flat and turned palm up under the wound; the right pinched on the needle, the forefinger along it.
  r.shape = [{ flat: seg(t, 0.06, 0.16) * (1 - seg(t, 0.78, 0.92)) }, { point: 0.5, cup: 0.5 }];
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [0.16, [0, 80, -20]], [0.74, [0, 80, -20]], [1, [0, 0, 0]]]);
  if (onSelf(c)) {
    // Stitching oneself: the left forearm brought up across the chest and kept there, the needle worked over it.
    r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.16, [56, -16, 40]], [0.76, [56, -16, 40]], [1, [12, 10, 0]]]);
    r.elbow[0] = one(t, [[0, 16], [0.16, 96], [0.76, 96], [1, 18]]);
    r.hand[0] = [0, 0, 0];
    r.head = euler(t, [[0, [0, 0, 0]], [0.16, [-22, 0, 6]], [0.5, [-20, 0, 6]], [STITCH_HOLD, [-16, 0, 0]], [1, [0, 0, 0]]]);
  }
};

/** How Leech closes on what it cuts: carried in over the wind-up to where the knife reaches it, and back after. */
const LEECH_CLOSE: CastClose = { from: 0.08, to: 0.42, back: 0.62 };

/**
 * Leech: the knife taken back across the body to the left shoulder, the
 * body wound up away from the creature; a lunge in onto the front foot, the
 * backhand cut out through it with the arm straight; then the empty left hand
 * pulled in to the chest, as what was cut comes back.
 */
const leechPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, [16, 12, 0]], [0.3, [74, -34, 46]], [0.36, [76, -36, 48]], [0.44, [88, 20, -10]], [0.52, [72, 56, -30]], [0.72, [40, 28, -10]], [1, [16, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 24], [0.3, 118], [0.36, 122], [0.44, 8], [0.52, 8], [0.72, 30], [1, 24]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.3, [10, 0, 40]], [0.44, [-10, 0, -20]], [0.6, [0, 0, -30]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.3, [40, 20, -6]], [0.44, [20, 30, 0]], [0.6, [52, -10, 34]], [0.82, [50, -8, 32]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 18], [0.3, 40], [0.44, 30], [0.6, 120], [0.82, 116], [1, 18]]);
  r.open[0] = t > 0.5 && t < 0.92;
  r.chest = euler(t, [[0, [0, 0, 0]], [0.32, [4, 2, 26]], [0.44, [-10, -2, -20]], [0.55, [-8, -2, -26]], [0.8, [2, 0, -6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.32, [4, 0, 8]], [0.44, [-20, 0, -8]], [0.6, [-12, 0, -6]], [0.8, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.32, [-4, 0, -18]], [0.44, [6, 0, 14]], [0.62, [4, 0, 10]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.32, [-4, 3, 0]], [0.44, [40, 4, 0]], [0.62, [30, 4, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.32, 14], [0.44, 40], [0.62, 28], [1, 6]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.32, [6, 2, 0]], [0.44, [-22, 2, 0]], [1, [-2, 2, 0]]]);
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
  r.stow = 1;
  r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.36, [-14, 16, 4]], [0.45, [-12, 14, 4]], [0.56, [104, 4, 0]], [0.72, [112, 6, 0]], [1, [14, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 16], [0.36, 34], [0.45, 30], [0.56, 8], [0.72, 14], [1, 18]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.36, [40, 0, -60]], [0.56, [-10, 0, -70]], [0.8, [0, 0, -40]], [1, [0, 0, 0]]]);
  r.open[1] = t > 0.2 && t < 0.88;
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
  r.shape = [{ flat: bump(t, 0.2, 0.4, 0.85) }, { cup: cupped, flat: let_ }];
  if (onSelf(c)) {
    // On oneself: both hands cupped low before the belly as the knees give, then lifted to the breast and opened.
    for (let k2 = 0; k2 < 2; k2++) {
      r.arm[k2] = euler(t, [[0, [12, 10, 0]], [0.36, [30, -8, 30]], [0.45, [30, -8, 30]], [0.58, [58, 4, 20]], [0.76, [56, 6, 18]], [1, [12, 10, 0]]]);
      r.elbow[k2] = one(t, [[0, 16], [0.36, 70], [0.45, 72], [0.58, 112], [0.76, 108], [1, 18]]);
      r.hand[k2] = euler(t, [[0, [0, 0, 0]], [0.45, [0, 0, 0]], [0.58, [0, k2 ? -70 : 70, 0]], [0.8, [0, k2 ? -60 : 60, 0]], [1, [0, 0, 0]]]);
    }
    r.shape = [{ cup: cupped, flat: let_ }, { cup: cupped, flat: let_ }];
    r.open = [t > 0.2 && t < 0.88, t > 0.2 && t < 0.88];
  }
};

/**
 * Toxin: a vial taken from the belt, brought up and unstoppered with the
 * thumb, the face turned away from it, then flicked side-arm at the creature
 * with a snap of the wrist.
 */
const toxinPose: CastPose = (r, t) => {
  r.stow = 1;
  r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.14, [-16, 26, 0]], [0.28, [56, 6, 28]], [0.38, [60, 6, 30]], [0.44, [44, 56, -10]], [0.52, [86, 22, -18]], [0.7, [70, 16, -12]], [1, [14, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 16], [0.14, 50], [0.28, 124], [0.38, 128], [0.44, 96], [0.52, 8], [0.7, 24], [1, 18]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.38, [20, 0, 0]], [0.46, [40, 0, 0]], [0.52, [-40, 0, 0]], [0.7, [-20, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.26, [50, -6, 34]], [0.36, [54, -8, 36]], [0.46, [30, 24, 0]], [0.7, [20, 20, 0]], [1, [12, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 16], [0.26, 116], [0.36, 120], [0.46, 40], [1, 18]]);
  r.open[0] = t > 0.42 && t < 0.86;
  r.head = euler(t, [[0, [0, 0, 0]], [0.28, [-10, 0, 0]], [0.36, [-4, 6, 30]], [0.44, [-6, 0, 6]], [0.52, [-8, 0, -4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.36, [-2, 0, 6]], [0.44, [2, 0, -26]], [0.52, [-8, 0, 18]], [0.7, [-6, 0, 10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.36, [-6, 0, 0]], [0.44, [-2, 0, -8]], [0.52, [-14, 0, 8]], [1, [-1, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.44, [-2, 3, 0]], [0.52, [24, 4, 0]], [0.72, [20, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.44, 12], [0.52, 26], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.44, [6, 2, 0]], [0.52, [-14, 2, 0]], [1, [-1, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.44, 20], [0.52, 10], [1, 4]]);
  // The right fingers round the vial; the left pinched on the stopper as it is drawn, then spread as the vial goes.
  r.shape = [{ cup: bump(t, 0.24, 0.32, 0.44), point: bump(t, 0.24, 0.32, 0.44) * 0.5, flat: bump(t, 0.46, 0.55, 0.86) },
    { cup: seg(t, 0.12, 0.2) * (1 - seg(t, 0.5, 0.54)), flat: bump(t, 0.5, 0.55, 0.8) }];
};

/** Where Surgeon's Hands holds its clean hands up before the face, while the buff sets. */
const HANDS_HOLD = 0.7;

/**
 * Surgeon's Hands: the hands scrubbed together before the belly, three
 * times, then lifted before the face, palms in and fingers up, as a surgeon
 * holds clean hands; held there, chin up.
 */
const handsPose: CastPose = (r, t) => {
  r.stow = 1;
  const scrub = Math.sin(seg(t, 0.12, 0.44) * TAU * 3) * (1 - seg(t, 0.4, 0.46));
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.12, [40, -4, 30]], [0.44, [42, -4, 30]], [0.56, [56, 22, -6]], [0.86, [54, 22, -6]], [1, [12, 10, 0]]]);
    r.arm[k][2] += 12 * scrub * s;
    r.arm[k][0] += 5 * scrub * s;
    r.elbow[k] = one(t, [[0, 16], [0.12, 86], [0.44, 88], [0.56, 128], [0.86, 126], [1, 18]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.44, [0, 0, 0]], [0.56, [-10, 0, s * 70]], [0.86, [-10, 0, s * 70]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.48 && t < 0.94;
  }
  r.head = euler(t, [[0, [0, 0, 0]], [0.12, [-18, 0, 0]], [0.44, [-16, 0, 0]], [0.56, [8, 0, 0]], [0.86, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.12, [-6, 0, 0]], [0.44, [-6, 0, 0]], [0.56, [6, 0, 0]], [0.86, [5, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.44, [-2, 0, 0]], [0.56, [3, 0, 0]], [1, [0, 0, 0]]]);
  r.knee = [one(t, [[0, 4], [0.44, 8], [0.56, 2], [1, 4]]), one(t, [[0, 4], [0.44, 8], [0.56, 2], [1, 4]])];
  // Cupped as they scrub, flat and spread as they come up clean.
  const clean = seg(t, 0.46, 0.54) * (1 - seg(t, 0.88, 0.97));
  r.shape = [{ cup: bump(t, 0.1, 0.2, 0.46), flat: clean }, { cup: bump(t, 0.1, 0.2, 0.46), flat: clean }];
};

/** How far ahead of the feet, in height units, a Healing Circle's palms go down: where the pose puts them and the ring starts. */
const PALMS_AHEAD = 5;

/**
 * Healing Circle: a step in and down onto one knee, the back kept long and
 * the head up, both palms pressed flat to the ground ahead; then up again,
 * the arms swept wide and high as the ring goes out from where they were.
 */
const circlePose: CastPose = (r, t) => {
  r.stow = 1;
  const press = one(t, [[0.14, 0], [0.32, 1], [0.5, 1], [0.58, 0]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.22, [60, 8, 0]], [0.5, [62, 14, 0]], [0.56, [96, 30, 0]], [1, [12, 10, 0]]]);
    // Up and wide once the palms leave the ground: a V over the head, opened away from the body.
    const sweep = smooth(seg(t, 0.52, 0.64)) * (1 - smooth(seg(t, 0.84, 1)));
    if (sweep > 0) {
      const v = armOut(k, 150, 42);
      r.arm[k] = [lerp(r.arm[k][0], v[0], sweep), lerp(r.arm[k][1], v[1], sweep), lerp(r.arm[k][2], v[2], sweep)];
    }
    r.elbow[k] = one(t, [[0, 16], [0.22, 20], [0.42, 6], [0.5, 6], [0.62, 10], [1, 18]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.3, [-60, 0, 0]], [0.5, [-70, 0, 0]], [0.62, [0, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.14 && t < 0.92;
  }
  // The back long and the head up while the palms are down: a healer bowing to the ground, not one falling to it.
  r.spine = euler(t, [[0, [0, 0, 0]], [0.32, [-8, 0, 0]], [0.5, [-8, 0, 0]], [0.62, [6, 0, 0]], [0.82, [5, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.32, [-8, 0, 0]], [0.5, [-8, 0, 0]], [0.62, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.32, [30, 0, 0]], [0.5, [28, 0, 0]], [0.62, [14, 0, 0]], [1, [0, 0, 0]]]);
  r.kneel = one(t, [[0, 0], [0.3, 1], [0.5, 1], [0.62, 0]]);
  // Held flat a hand's breadth over the ground, drawing the light up out of it: low enough to read as laid to the
  // ground from any way it is seen, high enough that the back stays long.
  r.reach = [{ at: [-2.6, PALMS_AHEAD, 3.4], w: press, stoop: true }, { at: [2.6, PALMS_AHEAD, 3.4], w: press, stoop: true }];
  r.shape = [{ flat: seg(t, 0.14, 0.3) * (1 - seg(t, 0.85, 0.95)) }, { flat: seg(t, 0.14, 0.3) * (1 - seg(t, 0.85, 0.95)) }];
};

/**
 * Mass Dressing: the arms out wide with the strips in both hands, the trunk
 * wound right round to the right with the weight on the back foot, then
 * whipped all the way round to the left, the weight thrown across, so the
 * linen flies out in a spiral; the arms trailing after it.
 */
const massPose: CastPose = (r, t) => {
  r.stow = 1;
  const yaw = one(t, [[0, 0], [0.38, -70], [0.5, 34], [0.64, 70], [0.82, 22], [1, 0]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.2, [24, 56, 0]], [0.38, [20, 86, 0]], [0.5, [26, 92, 0]], [0.66, [18, 84, 0]], [0.84, [12, 40, 0]], [1, [12, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 16], [0.2, 40], [0.38, 30], [0.5, 4], [0.7, 10], [1, 18]]);
    r.open[k] = t > 0.46 && t < 0.88;
  }
  // The leading arm (the left, going round to the left) higher than the trailing one, so the whirl tilts.
  r.arm[0][0] += 22 * bump(t, 0.38, 0.52, 0.8);
  r.arm[1][0] -= 14 * bump(t, 0.38, 0.52, 0.8);
  r.chest = [one(t, [[0, 0], [0.38, 4], [0.5, -6], [1, 0]]), one(t, [[0, 0], [0.38, -6], [0.5, 8], [0.8, 0]]), yaw * 0.55];
  r.spine = [one(t, [[0, 0], [0.38, 2], [0.5, -8], [1, 0]]), 0, yaw * 0.45];
  r.head = [one(t, [[0, 0], [0.38, -4], [0.5, 4], [1, 0]]), 0, -yaw * 0.4];
  // The weight on the right foot wound up, thrown over onto the left through the whirl.
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.38, [-6, 14, -10]], [0.52, [10, 12, 22]], [0.8, [6, 8, 8]], [1, [2, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.38, [10, 12, -18]], [0.52, [-8, 14, 16]], [0.8, [-2, 8, 6]], [1, [0, 2, 0]]]);
  r.knee = [one(t, [[0, 4], [0.38, 12], [0.52, 26], [1, 4]]), one(t, [[0, 4], [0.38, 30], [0.52, 10], [1, 4]])];
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
  r.stow = 1;
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
 * Battlefield Surgery: down onto the left knee facing the wounded, both
 * hands reaching low and forward toward them, working fast -- right, left,
 * right -- on the threads that run to their wounds; then lifted together and
 * opened toward them; up again after.
 */
const surgeryPose: CastPose = (r, t, c) => {
  r.stow = 1;
  const work = Math.sin(seg(t, 0.18, 0.5) * TAU * 3.5) * (1 - seg(t, 0.46, 0.52));
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.18, [70, 4, 12]], [0.5, [72, 4, 12]], [0.56, [92, 12, 0]], [0.76, [88, 12, 0]], [1, [12, 10, 0]]]);
    r.arm[k][0] += 10 * work * s;
    r.elbow[k] = one(t, [[0, 16], [0.18, 40], [0.5, 42], [0.56, 8], [0.76, 12], [1, 18]]);
    r.elbow[k] += 18 * work * s;
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.18, [20, 0, 0]], [0.5, [20, 0, 0]], [0.56, [-30, 0, s * -50]], [0.76, [-20, 0, s * -40]], [1, [0, 0, 0]]]);
  }
  r.open = [t > 0.5 && t < 0.88, t > 0.5 && t < 0.88];
  // Down on the left knee, the right foot flat ahead, toes tucked under behind; leant in over the work.
  r.kneel = one(t, [[0, 0], [0.16, 1], [0.78, 1], [0.92, 0]]);
  r.kneelLeft = true;
  r.spine = euler(t, [[0, [0, 0, 0]], [0.18, [-20, 0, 0]], [0.5, [-22, 0, 0]], [0.56, [-8, 0, 0]], [0.76, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.18, [-6, 0, 0]], [0.5, [-6, 0, 0]], [0.56, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.18, [-4, 0, 0]], [0.5, [-2, 0, 0]], [0.56, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.chest[2] += 6 * work;
  // Pinched on needles while they work, opened flat as they lift.
  const open = seg(t, 0.5, 0.56) * (1 - seg(t, 0.86, 0.95));
  const pinch = seg(t, 0.14, 0.22) * (1 - open);
  r.shape = [{ point: 0.5 * pinch, cup: 0.5 * pinch, flat: open }, { point: 0.5 * pinch, cup: 0.5 * pinch, flat: open }];
  if (onSelf(c)) {
    // On oneself: the work done low on one's own front thigh, and the hands brought in to the breast, not lifted out.
    for (let k2 = 0; k2 < 2; k2++) {
      const s2 = k2 ? 1 : -1;
      r.arm[k2] = euler(t, [[0, [12, 10, 0]], [0.18, [34, 4, 14]], [0.5, [36, 4, 14]], [0.56, [52, -8, 30]], [0.76, [50, -8, 30]], [1, [12, 10, 0]]]);
      r.arm[k2][0] += 7 * work * s2;
      r.elbow[k2] = one(t, [[0, 16], [0.18, 70], [0.5, 72], [0.56, 112], [0.76, 110], [1, 18]]) + 12 * work * s2;
      r.hand[k2] = [0, 0, 0];
    }
    r.spine = euler(t, [[0, [0, 0, 0]], [0.18, [-16, 0, 0]], [0.5, [-18, 0, 0]], [0.56, [-4, 0, 0]], [0.76, [-6, 0, 0]], [1, [0, 0, 0]]]);
    r.head = euler(t, [[0, [0, 0, 0]], [0.18, [-24, 0, 0]], [0.5, [-22, 0, 0]], [0.56, [-10, 0, 0]], [1, [0, 0, 0]]]);
  }
};

/**
 * Restoration: the arms crossed over the breast, each hand to the other
 * shoulder, the head bowed and the knees giving; then the arms opened wide
 * and up, the chest lifted, as the light goes up the body.
 */
const restorePose: CastPose = (r, t) => {
  r.stow = 1;
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.3, [66, -24, 44]], [0.5, [68, -26, 46]], [1, [12, 10, 0]]]);
    // Opened up and wide, away from the body.
    const open = smooth(seg(t, 0.5, 0.6)) * (1 - smooth(seg(t, 0.82, 1)));
    if (open > 0) {
      const v = armOut(k, 128, 58);
      r.arm[k] = [lerp(r.arm[k][0], v[0], open), lerp(r.arm[k][1], v[1], open), lerp(r.arm[k][2], v[2], open)];
    }
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
  // Up on the toes as the arms open.
  r.foot = [-10 * bump(t, 0.52, 0.62, 0.85), -10 * bump(t, 0.52, 0.62, 0.85)];
  // Flat open hands as the arms open.
  const opened = seg(t, 0.5, 0.58) * (1 - seg(t, 0.86, 0.95));
  r.shape = [{ flat: opened, cup: 0.4 * bump(t, 0.1, 0.3, 0.52) }, { flat: opened, cup: 0.4 * bump(t, 0.1, 0.3, 0.52) }];
};

/**
 * Miracle Worker: both hands raised high and joined over the head, the body
 * stretched up onto it; held a beat; then brought down together to drive
 * both open palms at the one being saved, the arms straight, with a long
 * deep lunge and the trunk thrown in after them, held while it lands.
 */
const miraclePose: CastPose = (r, t, c) => {
  r.stow = 1;
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    r.arm[k] = euler(t, [[0, [12, 10, 0]], [0.3, [168, -4, 14]], [0.46, [172, -6, 16]], [0.56, [96, 6, 6]], [0.8, [92, 8, 6]], [1, [12, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 16], [0.3, 34], [0.46, 30], [0.56, 0], [0.8, 4], [1, 18]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.46, [0, 0, s * -30]], [0.56, [-60, 0, s * 20]], [0.8, [-50, 0, s * 20]], [1, [0, 0, 0]]]);
    r.open[k] = t > 0.1 && t < 0.92;
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [8, 0, 0]], [0.46, [10, 0, 0]], [0.56, [-22, 0, 0]], [0.8, [-20, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [8, 0, 0]], [0.46, [10, 0, 0]], [0.56, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [22, 0, 0]], [0.46, [24, 0, 0]], [0.56, [6, 0, 0]], [0.8, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.3, [0, 3, 0]], [0.46, [0, 3, 0]], [0.56, [44, 4, 0]], [0.8, [42, 4, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.3, 0], [0.46, 0], [0.56, 46], [0.8, 44], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.46, [0, 2, 0]], [0.56, [-24, 2, 0]], [0.8, [-22, 2, 0]], [1, [-1, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.46, 0], [0.56, 14], [1, 4]]);
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

/* ---- the spells' own things ---------------------------------------------------------------- */

/** Glass: a vial's body, a pale green-white, and its shards. */
const GLASS = '#e6f2ee';

/**
 * A vial of the toxin: a glass body with the red in it, a neck and (until it
 * is drawn) a cork, `r` pixels at zoom one to the shoulder, turned `turn`
 * radians on the screen -- upright in the hand, end over end in flight.
 */
function vial(k: FxScene, at: P3, o: { turn: number; cork: boolean; alpha?: number; bias?: number; r?: number }): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), R = k.px(o.r ?? 2.4);
  const inkW = Math.max(0.8, 0.6 * k.zoom);
  k.worldDraw(at, (g) => {
    g.save();
    g.translate(x, y);
    g.rotate(o.turn);
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    // The body: a squat flask, its bottom flat. Up the screen is up the vial.
    const body = (): void => {
      g.beginPath();
      g.moveTo(-R * 0.35, -R * 1.0);
      g.lineTo(-R * 0.9, -R * 0.35);
      g.lineTo(-R * 0.9, R * 0.75);
      g.lineTo(R * 0.9, R * 0.75);
      g.lineTo(R * 0.9, -R * 0.35);
      g.lineTo(R * 0.35, -R * 1.0);
      g.closePath();
    };
    body();
    g.fillStyle = GLASS;
    g.globalAlpha = clamp(a * 0.55);
    g.fill();
    // The red in it, two thirds full; its lit side up-left.
    g.globalAlpha = clamp(a);
    g.fillStyle = BLOOD;
    g.fillRect(-R * 0.9, -R * 0.1, R * 1.8, R * 0.85);
    g.fillStyle = BLOOD_DEEP;
    g.fillRect(R * 0.2, -R * 0.1, R * 0.7, R * 0.85);
    body();
    g.lineWidth = inkW;
    g.strokeStyle = BLOOD_INK;
    g.stroke();
    // The neck, and a glint of glass down its left.
    g.fillStyle = GLASS;
    g.fillRect(-R * 0.3, -R * 1.5, R * 0.6, R * 0.5);
    g.strokeRect(-R * 0.3, -R * 1.5, R * 0.6, R * 0.5);
    g.strokeStyle = '#ffffff';
    g.lineWidth = Math.max(0.6, 0.5 * k.zoom);
    g.beginPath();
    g.moveTo(-R * 0.6, -R * 0.3);
    g.lineTo(-R * 0.6, R * 0.5);
    g.stroke();
    if (o.cork) {
      g.fillStyle = LINEN_DEEP;
      g.fillRect(-R * 0.38, -R * 2.0, R * 0.76, R * 0.55);
      g.lineWidth = inkW;
      g.strokeStyle = LINEN_INK;
      g.strokeRect(-R * 0.38, -R * 2.0, R * 0.76, R * 0.55);
    }
    g.restore();
  }, o.bias ?? 0);
}

/**
 * Drops of blood on their way somewhere, drawn as drops: a round head and a
 * tail drawn out behind it along the way it goes, all of them one record.
 * Each is `{ at, back, r, mint }`: where its head is, a point behind it on its
 * path, its size in height units, and how far it has turned from blood to mint.
 */
function teardrops(k: FxScene, drops: ReadonlyArray<{ at: P3; back: P3; r: number; mint: number }>): void {
  if (!drops.length) return;
  const pieces: Array<{ pts: P3[]; fill: string; ink: string; width?: number }> = [];
  const lit: Array<{ pts: P3[]; fill: string; ink: false }> = [];
  for (const d of drops) {
    const { at, back, r } = d;
    // Along the way it goes on the ground (tiles) and up (height units); the tail back along it, the head round.
    const ux = at.x - back.x, uy = at.y - back.y, uz = at.z - back.z;
    const len = Math.hypot(ux * 40, uy * 40, uz) || 1;
    const fx = ux / len, fy = uy / len, fz = uz / len;
    const t = (s: number, up: number): P3 => ({ x: at.x + fx * s, y: at.y + fy * s, z: at.z + fz * s + up });
    const pts = [t(-r * 3.2, 0), t(-r * 0.6, r), t(r * 0.5, r * 0.8), t(r, 0), t(r * 0.5, -r * 0.8), t(-r * 0.6, -r)];
    const m = d.mint;
    pieces.push({ pts, fill: mixColour(BLOOD, PALETTE.main, m), ink: m > 0.5 ? PALETTE.ink : BLOOD_INK });
    lit.push({ pts: [t(-r * 0.2, r * 0.6), t(r * 0.45, r * 0.55), t(r * 0.2, r * 0.1)], fill: m > 0.5 ? PALETTE.core : BLOOD_CORE, ink: false });
  }
  k.shapes(mid3(drops[0].at, drops[drops.length - 1].at, 0.5), [...pieces, ...lit], { bias: 4 });
}

/**
 * A count of seconds on a hand: a ring of `n` ticks round it, `lit` still to
 * come, the one going out fading through its second and the spent ones left
 * faint -- the clock of a buff carried on the hands. Both hands in one record.
 */
function handClocks(k: FxScene, hands: readonly P3[], n: number, lit: number, alpha: number): void {
  if (alpha <= 0.01 || n < 1) return;
  const R = k.px(3.8), r0 = R * 0.7;
  const whole = Math.floor(lit), part = lit - whole;
  const pts = hands.map((h) => [k.sx(h), k.sy(h)] as const);
  k.worldDraw(hands[0], (g) => {
    g.lineCap = 'round';
    for (const [x, y] of pts) {
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          const an = -Math.PI / 2 + (i / n) * TAU;
          const on = i < whole ? 1 : i === whole ? part : 0;
          const c = Math.cos(an), s = Math.sin(an) * 0.8;
          if (pass === 0) {
            g.globalAlpha = clamp(alpha * (on > 0 ? 1 : 0.35));
            g.strokeStyle = PALETTE.ink;
            g.lineWidth = Math.max(1.6, 1.5 * k.zoom);
          } else {
            g.globalAlpha = clamp(alpha * (on > 0 ? 0.35 + 0.65 * on : 0.4));
            g.strokeStyle = on > 0 ? PALETTE.core : PALETTE.deep;
            g.lineWidth = Math.max(0.8, 0.75 * k.zoom);
          }
          g.beginPath();
          g.moveTo(x + c * r0, y + s * r0);
          g.lineTo(x + c * R, y + s * R);
          g.stroke();
        }
      }
    }
    g.lineCap = 'butt';
  }, 9);
}

/** How Leech's cut lies: where the knife's point was at the start of the blow, and where at the cut, kept. */
const LEECH_FROM = 0.38;

/** Seconds to the one it goes to over `tiles`, for what is sent from the hand to a person; nothing for oneself. */
const sent = (base: number, each: number) => (tiles: number): number => (tiles < 0.3 ? 0 : base + tiles * each);

/** Where Field Dressing's worst wound is, on whoever is dressed: under the band, at the waist. */
const dressedAt = (k: FxScene, b: Body): { at: P3; ang: number } => ({ at: k.local(b, b.wide * 0.08, 0, b.tall * 0.49), ang: 0.35 });

/** The worst wound bleeding before it is dressed: the open gash, and drops off it. */
function bleeding(k: FxScene, b: Body, alpha: number): void {
  if (alpha <= 0.01) return;
  const w = dressedAt(k, b);
  suture(k, b, w.at, { len: 8, ang: w.ang, close: 0, u: 0, gash: 1, wet: 1, alpha });
  k.emit(w.at, 14 * alpha, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.6, life: [0.3, 0.5], speed: [0.02, 0.08], up: [-6, 0], gravity: 60, bias: 8 });
}

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
        if (tear > 0.02) k.ribbon([h0, mid3(h0, h1, 0.5), h1], { width: 3, taper: 'none', alpha: tear, main: LINEN, core: '#ffffff', ink: LINEN_INK, glow: 0.3 });
        k.glow(h1, 6, 0.5 * bump(t, 0.3, 0.48, 0.6));
        // What it is for: the worst wound, open and bleeding, until the band is on it.
        if (!k.state.landed) bleeding(k, k.target, seg(t, 0.15, 0.3));
      },
      release: (k) => k.burst(k.hand(1), 6, { kind: 'mote', size: 1.6, life: [0.2, 0.4], speed: [0.2, 0.5], up: [2, 8], gravity: 0, heading: k.toward(k.caster, k.target), cone: 1.2 }),
      travel: { secs: sent(0.12, 0.07), draw: (k, u) => {
        // The strip flying, fluttering, its tail unspooling from the hand, on an arc high enough to read end on.
        const from = k.hand(1), to = k.heart(k.target);
        const lift = 8 + k.dist * 2.5;
        const pts: P3[] = [];
        for (let i = 6; i >= 0; i--) {
          const v = Math.max(0, u - i * 0.06);
          const p = arcAt(from, to, v, lift);
          p.z += Math.sin(k.now * 26 + i * 1.3) * 1.2 * (i / 6);
          pts.push(p);
        }
        k.ribbon(pts, { width: 3.2, taper: 'start', main: LINEN, core: '#ffffff', ink: LINEN_INK, glow: 0.35 });
        k.glow(pts[6], 5, 0.5);
      } },
      hit: (k) => {
        k.state.landed = 1;
        k.burst(k.heart(k.target), 8, { kind: 'mote', size: 1.8, life: [0.4, 0.8], speed: [0.1, 0.4], up: [6, 16], gravity: 0 });
      },
      impact: { secs: 1.2, draw: (k, u) => {
        const b = k.target;
        // Wound on quickly and pulled tight, held, then gone back into light.
        const on = easeOut(seg(u, 0, 0.38));
        const out = seg(u, 0.72, 1);
        wrap(k, b, { lo: 0.38, hi: 0.62, turns: 1.8, width: 3, u: on, from: out, spin: k.seed * 0.01, size: 1.12 - 0.12 * smooth(seg(u, 0.3, 0.45)), alpha: 1 - 0.3 * out });
        // The worst wound stops bleeding: still open and dripping as the band comes round, gone under it as its front
        // run passes over, and a mint glint where it was.
        bleeding(k, b, 1 - seg(u, 0.18, 0.3));
        const w = dressedAt(k, b);
        k.flare(w.at, 4.5, bump(u, 0.24, 0.32, 0.5), PALETTE.core, 0.4);
        const stop = flashOf(seg(u, 0.36, 1), 0.1);
        cross(k, k.at(b, 0.95 + 0.2 * seg(u, 0.36, 1)), 3.6, { alpha: stop, turn: u * 2.4 });
        k.light(b, 1.6, 0.5 * (1 - u), PALETTE.core);
      } },
    },
  },
  // Quick Stitch (ally, on self, player, 2 tiles round): The worst wound on you or on somebody within 2 tiles of you closes by 30% of its severity.
  chirurgeon_quick_stitch: {
    palette: PALETTE,
    cast: { timing: { secs: 0.85, release: 0.55 }, pose: stitchPose, hold: { at: STITCH_HOLD, secs: 0.55 } },
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
          k.ribbon(pts, { width: 1.5, taper: 'start', alpha: 0.9 * live, main: LINEN, core: '#ffffff', ink: PALETTE.ink, glow: 0.3 });
        }
        k.flare(h, 3.4, live * (0.6 + 0.4 * Math.sin(k.now * 30)), PALETTE.core, k.now * 4);
        // The wound it is for, open on whoever it is for, until the needle gets there.
        if (!castOnSelf(k) && !st.landed) {
          const w = woundAt(k, k.target, 0);
          suture(k, k.target, w.at, { len: 11, ang: w.ang, close: k.fx.close ?? 0.3, u: 0, gash: seg(t, 0.2, 0.4), wet: 0.35, alpha: 0.75 });
        }
      },
      travel: { secs: sent(0.06, 0.045), draw: (k, u) => {
        // Straight and quick, the thread paying out behind it from the hand.
        const from = k.hand(1), to = k.heart(k.target);
        const tip = mid3(from, to, easeOut(u));
        thread(k, from, tip, { lift: 1.5 });
        needle(k, tip, mid3(from, to, Math.max(0, easeOut(u) - 0.12)));
      } },
      hit: (k) => {
        k.state.landed = 1;
        k.burst(k.heart(k.target), 5, { kind: 'spark', size: 1.4, life: [0.15, 0.3], speed: [0.3, 0.8], up: [0, 10], gravity: 20, colour: [PALETTE.core, PALETTE.main] });
      },
      impact: { secs: 1.1, draw: (k, u) => {
        // On somebody else the wound is on their breast; on oneself it is on the left forearm the cast holds up, along it.
        const b = k.target, self = castOnSelf(k), w = self ? forearmWound(k) : woundAt(k, b, 0);
        // Sewn while the caster holds the thread up (`STITCH_HOLD`), a tug of the hand for every stitch.
        const sew = seg(u, 0, 0.5);
        const fade = 1 - seg(u, 0.8, 1);
        suture(k, b, w.at, { len: self ? 9 : 11, ang: w.ang, close: k.fx.close ?? 0.3, u: sew, gash: fade, wet: 0.35, alpha: fade, needle: 1 - seg(u, 0.48, 0.56), bob: u * 40 });
        // The thread from the caster's hand still to the needle at work, until it is cut and the knot glints.
        if (!self) thread(k, k.hand(1), w.at, { alpha: 1 - seg(u, 0.5, 0.6), lift: 0.6 });
        k.flare(w.at, 4, 0.8 * bump(u, 0.5, 0.56, 0.7), PALETTE.core);
      } },
    },
  },
  // Leech (strike, on enemy): With a knife in hand: a knife blow at 80%, and you get back as large a share of your health as it takes of the creature's.
  chirurgeon_leech: {
    palette: PALETTE,
    cast: { timing: { secs: 0.8, release: 0.44 }, pose: leechPose, close: LEECH_CLOSE },
    fx: {
      charge: (k, t) => {
        glint(k, k.weaponAt(5), 3.5, bump(t, 0.22, 0.34, 0.42), k.now * 3);
        // The knife's own path through the creature, thin and red: a scalpel's line, not a sword's arc.
        if (t > LEECH_FROM && t < 0.62) {
          k.trail(k.caster, { main: BLOOD, core: BLOOD_CORE, ink: BLOOD_INK, secs: 0.1, inner: 0.25, outer: 1.1, alpha: 1 - seg(t, 0.5, 0.62), glow: 0 });
        }
        // Where the point was as the blow started and as it cut, kept: the line the cut lies along.
        if (t >= LEECH_FROM) k.once('k0', () => k.joint(k.caster, 'tip'));
        if (t >= k.timing!.release) k.once('k1', () => k.joint(k.caster, 'tip'));
      },
      hit: (k) => {
        const at = k.heart(k.target), away = k.toward(k.caster, k.target);
        k.burst(at, 14, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.8, life: [0.35, 0.6], speed: [0.5, 1.4], up: [4, 18], heading: away, cone: 1.8, gravity: 70, bias: 4 });
        k.burst(at, 8, { kind: 'spark', colour: [BLOOD_CORE, BLOOD], size: 1.6, life: [0.15, 0.35], speed: [0.8, 1.8], up: [0, 12], heading: away, cone: 1.4, gravity: 30, over: true });
      },
      impact: { secs: 1.15, draw: (k, u) => {
        const heart = k.heart(k.target), to = k.chest();
        // The cut on the creature, along the way the knife went through it, drying and closing from its tail.
        const k0 = k.once('k0', () => k.joint(k.caster, 'tip')), k1 = k.once('k1', () => k.joint(k.caster, 'tip'));
        // Mostly across it, as a slash lies, whatever the wrist did on the way.
        let dx = (k1.x - k0.x) * 40, dy = (k1.y - k0.y) * 40, dz = (k1.z - k0.z) * 0.35;
        const dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl; dy /= dl; dz /= dl;
        // On the flank toward the caster, where the knife went in, a little shorter than the creature is broad.
        const half = 1.2 + k.target.wide * 0.22;
        const nearX = (k.caster.x - heart.x), nearY = (k.caster.y - heart.y), nl = Math.hypot(nearX, nearY) || 1;
        const side = (k.target.wide * 0.3) / 40;
        const c0 = { x: heart.x + (nearX / nl) * side, y: heart.y + (nearY / nl) * side, z: heart.z };
        const cut: P3[] = [];
        for (let i = -2; i <= 2; i++) cut.push({ x: c0.x + (dx * half * i) / 80, y: c0.y + (dy * half * i) / 80, z: c0.z + (dz * half * i) / 2 + (i * i - 4) * 0.08 });
        // On the move the stage cannot carry the body in, so a cut still short is carried the rest of the way by a thin
        // red line off the knife's point to the wound, quick, eaten from its tail: the cut still comes from the knife.
        const short = Math.hypot(k1.x - heart.x, k1.y - heart.y);
        if (short > 0.5 && u < 0.2) {
          const v = smooth(u / 0.1), from = mid3(k1, c0, Math.max(0, v - 0.5));
          k.ribbon([from, mid3(from, mid3(k1, c0, v), 0.5), mid3(k1, c0, v)], { width: 1.6, taper: 'start', main: BLOOD, core: BLOOD_CORE, ink: BLOOD_INK, glow: 0, alpha: 1 - seg(u, 0.12, 0.2) });
        }
        const gone = seg(u, 0.25, 0.9);
        if (gone < 1) k.ribbon(eatTail(cut, gone), { width: 1.8, taper: 'both', main: dry(BLOOD, seg(u, 0.1, 0.6)), core: BLOOD_CORE, ink: BLOOD_INK, alpha: 1, glow: 0, bias: 6 });
        // What was cut drawn back: drops off the wound to the caster's breast, blood turning to mint on the way.
        const lift = 2 + k.dist * 1.2;
        const n = 6;
        const drops: Array<{ at: P3; back: P3; r: number; mint: number }> = [];
        const line: P3[] = [];
        for (let i = 0; i < n; i++) {
          const p = clamp(u * 1.7 - 0.1 - i * (0.06 + 0.05 * hashOf(k.seed, i)));
          if (p <= 0 || p >= 1) continue;
          const wob = (q: number): P3 => {
            const at = arcAt(heart, to, smooth(q), lift);
            // Each drop weaving a little off the line, as something drawn through the air does.
            at.z += Math.sin(q * 9 + i * 2.1) * 1.2;
            return at;
          };
          const at = wob(p);
          line.push(at);
          const mint = smooth(seg(p, 0.45, 0.85));
          drops.push({ at, back: wob(Math.max(0, p - 0.04)), r: (i === 0 ? 1.0 : 0.6 + 0.3 * hashOf(k.seed + 1, i)) * (1 - 0.3 * mint), mint });
        }
        if (line.length >= 2) k.ribbon(line.reverse(), { width: 0.9, taper: 'both', alpha: 0.45, main: BLOOD, core: BLOOD_CORE, ink: BLOOD_INK, glow: 0, edge: false });
        teardrops(k, drops);
        // The mint ones lit; the red ones given a little light of their own after dark, laid over so they stay red.
        for (const d of drops) {
          if (d.mint > 0.5) k.glow(d.at, 3, 0.5 * d.mint);
          else k.glow(d.at, 3, 0.4 * k.night, BLOOD_LIGHT, true);
        }
        glint(k, heart, 6 * (1 - u), flashOf(u, 0.05) * 0.8);
        // Taken in: the caster's own outline lit in mint a moment, and a pulse at the breast.
        const got = seg(u, 0.55, 1);
        if (got > 0) {
          k.aura(k.caster, { alpha: 0.55 * flashOf(got, 0.15), size: 0.95 + 0.08 * got, width: 2, glow: 0.4, flow: 2 });
          k.glow(k.chest(), 8, 0.7 * flashOf(got, 0.12));
          k.light(k.caster, 1.4, 0.5 * flashOf(got, 0.2), PALETTE.core);
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
          k.orb(h, 1.2 + 1.8 * g, { alpha: g, turn: k.now * 3, sides: 6 });
          k.emit(h, 14 * g, { kind: 'mote', size: 1.3, life: [0.3, 0.6], speed: [0.02, 0.08], up: [4, 10], gravity: 0, jitter: 0.04 });
        }
      },
      travel: { secs: sent(0.16, 0.07), draw: (k, u) => {
        // Lobbed high and soft, a seed big enough to follow.
        const from = k.hand(1), to = k.at(k.target, 0.85);
        const lift = 8 + k.dist * 3;
        const pts: P3[] = [];
        for (let i = 5; i >= 0; i--) pts.push(arcAt(from, to, Math.max(0, u - i * 0.04), lift));
        k.ribbon(pts, { width: 2.6, alpha: 0.75 });
        for (let i = 1; i < 5; i += 2) k.glow(pts[i], 6, 0.35);
        k.orb(pts[5], 3.2, { turn: k.now * 4 });
        k.emit(pts[5], 20, { kind: 'mote', size: 1.3, life: [0.3, 0.5], speed: [0.02, 0.06], up: [-2, 2], gravity: 0 });
      } },
      hit: (k) => {
        const at = k.at(k.target, 0.85);
        k.burst(at, 10, { kind: 'mote', size: 1.8, life: [0.4, 0.8], speed: [0.2, 0.5], up: [8, 20], gravity: 0, drag: 0.3 });
        k.burst(at, 10, { kind: 'mote', size: 1.8, life: [0.5, 0.9], speed: [0.1, 0.3], up: [-12, -4], gravity: -6, jitter: 0.06 });
      },
      impact: { secs: 0.7, draw: (k, u) => {
        // The seed bursts on them -- a glint where it landed and a beat out from their feet -- and a band of light
        // goes round them, down to the ground.
        const b = k.target;
        k.flare(k.at(b, 0.85), 7, flashOf(seg(u, 0, 0.4), 0.15), PALETTE.core, u * 2);
        const beat = seg(u, 0, 0.36);
        if (beat < 1) k.ring(b, 0.15 + 0.2 * easeOut(beat), { band: 0.05, alpha: 0.9 * (1 - beat), glow: 0.6, n: 16 });
        wrap(k, b, { lo: 0.85, hi: 0.05, turns: 1.5, u: 0.15 + 0.85 * easeOut(u * 1.4), from: seg(u, 0.4, 1), light: true, width: 2.4, size: 1.2 });
        k.light(b, 1.6, 0.6 * (1 - u), PALETTE.core);
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
        k.light(b, 1.4, 0.25 * a, PALETTE.core);
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
        // The vial in the hand from when it leaves the belt, corked until the thumb draws it, then a wisp off it.
        const held = seg(t, 0.12, 0.18) * (t < 0.5 ? 1 : 0);
        const h = k.hand(1);
        if (held > 0) vial(k, k.on(h.x, h.y, h.z + 1.4), { turn: 0.25 - 0.6 * seg(t, 0.4, 0.5), cork: t < 0.34, alpha: held, bias: 6, r: 3 });
        if (t > 0.34 && t < 0.5) k.emit(k.on(h.x, h.y, h.z + 3), 10, { kind: 'mist', colour: [...VAPOUR], size: 2.4, sizeEnd: 5, life: [0.4, 0.7], speed: [0.01, 0.04], up: [6, 12], gravity: -4, bias: 4 });
        if (t > 0.34 && !k.state.pop) {
          k.state.pop = 1;
          k.burst(k.on(h.x, h.y, h.z + 3.5), 1, { kind: 'shard', colour: LINEN_DEEP, size: 1.6, life: [0.4, 0.5], speed: [0.2, 0.3], up: [14, 18], gravity: 60, spin: 3 });
        }
      },
      travel: { secs: (tiles) => 0.14 + tiles * 0.075, draw: (k, u) => {
        // Tumbling end over end on a high arc, a thread of the red spilling after it.
        const from = k.hand(1), to = k.heart(k.target);
        const lift = 5 + k.dist * 3.5;
        const pts: P3[] = [];
        for (let i = 5; i >= 0; i--) pts.push(arcAt(from, to, Math.max(0, u - i * 0.016), lift));
        k.ribbon(pts, { width: 1.1, taper: 'start', main: BLOOD_DEEP, core: BLOOD, ink: BLOOD_INK, glow: 0, edge: false });
        vial(k, pts[5], { turn: k.now * 16, cork: false, bias: 2, r: 3.2 });
        if (!k.fast) k.emit(pts[5], 14, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.2, life: [0.2, 0.35], speed: [0.01, 0.04], up: [-2, 2], gravity: 60 });
      } },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 16, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.8, life: [0.4, 0.7], speed: [0.3, 1], up: [10, 26], gravity: 70, bias: 4 });
        // The glass breaking on it: pale chips, no ink, so they read as glass and not as grit.
        k.burst(at, 10, { kind: 'shard', colour: [GLASS, '#ffffff'], size: 1.5, life: [0.3, 0.55], speed: [0.4, 1.0], up: [6, 18], gravity: 70, spin: 4, ink: false, bias: 4 });
        k.burst(at, 6, { kind: 'mist', colour: [...VAPOUR], size: 4, sizeEnd: 9, life: [0.6, 1.0], speed: [0.1, 0.3], up: [2, 8], gravity: -3, bias: 4 });
      },
      impact: { secs: 0.6, draw: (k, u) => {
        glint(k, k.heart(k.target), 7 * (1 - u), flashOf(u, 0.08));
        k.scorch(k.target, 0.22 * easeOut(u * 2), { colour: BLOOD_DEEP, alpha: 0.5 });
        k.light(k.target, 1.4, 0.5 * (1 - u), BLOOD_LIGHT);
      } },
      linger: { draw: (k, age, left) => {
        const b = k.target, secs = secsOf(k, 20);
        const a = smooth(age / 0.4) * smooth(left / 0.8);
        // A stain spreading under it as it bleeds, and the seconds of the bleed in red round it.
        k.scorch(b, 0.16 + 0.16 * seg(age, 0, secs), { colour: BLOOD_DEEP, alpha: 0.55 * a });
        tally(k, b, tallyR(b), Math.round(secs), left, { alpha: 0.7 * a, main: BLOOD, deep: BLOOD_DEEP, ink: BLOOD_INK, light: BLOOD_LIGHT, glowEvery: 2 });
        // Each second's bleed: a drop off it, and a red glint at the wound.
        const tick = Math.floor(age);
        if (tick !== k.state.tick) {
          k.state.tick = tick;
          k.burst(k.at(b, 0.5), 3, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 2.1, life: [0.4, 0.6], speed: [0.02, 0.1], up: [-2, 4], gravity: 60, jitter: b.wide / 80, bias: 4 });
        }
        glint(k, k.heart(b), 3, a * flashOf(age % 1, 0.1) * 0.7);
        k.light(b, 1, 0.15 * a, BLOOD_LIGHT);
        if (!k.fast) k.emit(k.at(b, 0.7), 2.5 * a, { kind: 'mist', colour: [...VAPOUR], size: 2.5, sizeEnd: 6, life: [0.8, 1.2], speed: [0.01, 0.04], up: [3, 6], gravity: -1, jitter: b.wide / 60 });
      } },
    },
  },
  // Surgeon’s Hands (buff, on self, lasts 20 s): For 20 s every dressing you put on puts back twice as much health.
  chirurgeon_surgeons_hands: {
    palette: PALETTE,
    cast: { timing: { secs: 1.3, release: 0.55 }, pose: handsPose, hold: { at: HANDS_HOLD, secs: 0.4 } },
    fx: {
      charge: (k, t) => {
        // Scrubbing: a froth of motes off the hands, then both caught in light as they come up.
        const scrub = bump(t, 0.12, 0.25, 0.46);
        const mid = mid3(k.hand(0), k.hand(1), 0.5);
        if (scrub > 0) k.emit(mid, 40 * scrub, { kind: 'mote', size: 1.3, life: [0.2, 0.45], speed: [0.1, 0.3], up: [-4, 8], gravity: 10, jitter: 0.02 });
        const up = seg(t, 0.46, 0.56);
        for (let s = 0; s < 2; s++) k.glow(k.hand(s), 5 + 3 * up, 0.3 * scrub + 0.6 * up * (1 - seg(t, 0.56, 0.7) * 0.4));
      },
      hit: (k) => {
        for (let s = 0; s < 2; s++) k.burst(k.hand(s), 8, { kind: 'spark', size: 1.4, life: [0.2, 0.4], speed: [0.3, 0.8], up: [6, 16], gravity: 20 });
      },
      impact: { secs: 0.8, draw: (k, u) => {
        // A glove of light on each hand, set and then thinning to what stays; light enough that the hands raised clean
        // before the face still show through it, and a beat after they get there.
        const v = seg(u, 0.1, 1);
        for (let s = 0; s < 2; s++) {
          const h = k.hand(s);
          k.orb(h, 2.2 * (1 + 0.3 * (1 - v)), { alpha: 0.3 * flashOf(v, 0.1), sides: 8, turn: k.now * 2 + s, glow: 0.5 });
          k.flare(h, 3, 0.5 * flashOf(v, 0.08), PALETTE.core, s * 0.6);
        }
        k.light(k.caster, 1.4, 0.5 * (1 - u), PALETTE.core);
      } },
      linger: { on: 'caster', draw: (k, age, left) => {
        const secs = secsOf(k, 20);
        // Come on as the hands come down from before the face, so the clean hands held up are seen bare first.
        const a = smooth(seg(age, 0.6, 1.1)) * smooth(left / 0.8);
        // The buff is on the hands, so its count is too: a ring of a tick a second round each hand, going out a tick a
        // second, and the healer's cross in each, pulsing.
        const beat = 0.7 + 0.3 * Math.sin(age * 4);
        const hands = [k.hand(0), k.hand(1)];
        handClocks(k, hands, Math.round(secs), left, 0.9 * a);
        for (let s = 0; s < 2; s++) {
          k.glow(hands[s], 6, 0.45 * a * beat);
          cross(k, hands[s], 2.1, { alpha: 0.9 * a, turn: age * 2 + s * 1.5, glow: 0.4, bias: 10 });
        }
        if (!k.fast) k.emit(hands[age % 2 < 1 ? 0 : 1], 4 * a, { kind: 'mote', size: 1.2, life: [0.4, 0.8], speed: [0.01, 0.04], up: [3, 8], gravity: 0 });
      } },
    },
  },
  // Healing Circle (nova, on self, 4 tiles round): You and everybody within 4 tiles of you each get back 15% of their own full health.
  chirurgeon_healing_circle: {
    palette: PALETTE,
    cast: { timing: { secs: 1.6, release: 0.5 }, pose: circlePose },
    fx: {
      charge: (k, t) => {
        // Light pooling under the palms as they go down, handed over to the ring as it leaves them.
        const g = smooth(seg(t, 0.22, 0.48)) * (1 - seg(t, 0.5, 0.6));
        const at = k.local(k.caster, 0, PALMS_AHEAD, 0);
        if (g > 0) {
          k.disc(at, 0.12 + 0.2 * g, { alpha: 0.55 * g, n: 8 });
          k.glow(k.on(at.x, at.y, 1), 8 + 6 * g, 0.6 * g);
          if (t < 0.5) k.emit(k.on(at.x, at.y, 1), 16 * g, { kind: 'mote', size: 1.4, life: [0.3, 0.6], speed: [0.02, 0.08], up: [6, 12], gravity: 0, jitter: 0.12 });
        }
      },
      hit: (k) => {
        const at = k.local(k.caster, 0, PALMS_AHEAD, 0);
        k.burst(k.on(at.x, at.y, 1), 12, { kind: 'mote', size: 1.8, life: [0.4, 0.7], speed: [0.8, 1.4], up: [2, 8], gravity: 0, drag: 0.2 });
      },
      impact: { secs: 1.6, draw: (k, u) => {
        const R = k.fx.reach || 4;
        const at = k.local(k.caster, 0, PALMS_AHEAD, 0);
        const c = { x: lerp(at.x, k.caster.x, smooth(seg(u, 0, 0.3))), y: lerp(at.y, k.caster.y, smooth(seg(u, 0, 0.3))) };
        // The ring goes out from the palms to the edge of who it heals, and stands there a moment.
        const r = R * easeOut(seg(u, 0, 0.42));
        const hold = 1 - seg(u, 0.7, 1);
        k.ring(c, Math.max(0.1, r), { band: 0.12 + 0.12 * (1 - seg(u, 0, 0.42)), alpha: hold, glow: 1.2, turn: u * 0.4 });
        // Just inside the edge, a running stitch: the circle sewn shut round whoever is in it. Its own picture.
        if (r > 0.6) k.ring(c, r - 0.28, { band: 0.07, alpha: 0.9 * hold, dash: 2, n: Math.max(16, Math.round(r * 12)), main: PALETTE.core, deep: PALETTE.main, glow: 0, turn: u * 0.4 });
        // Once it gets there, a cross stands up off the edge at each of four points and rises, with a curtain of motes.
        const up = seg(u, 0.36, 0.95);
        if (up > 0 && up < 1) {
          for (let i = 0; i < 4; i++) {
            const an = (i / 4) * TAU + Math.PI / 4;
            const x = c.x + Math.cos(an) * R, y = c.y + Math.sin(an) * R;
            cross(k, k.on(x, y, 3 + 14 * easeOut(up)), 7, { alpha: flashOf(up, 0.15) * hold, turn: up * 2 + i, glow: 0.7, bias: 0 });
            k.emit(k.on(x, y, 1), k.fast ? 6 : 10, { kind: 'mote', size: 1.6, life: [0.5, 0.9], speed: [0.01, 0.05], up: [14, 26], gravity: 0, jitter: 0.3 });
          }
        }
        cross(k, k.at(k.caster, 1.05 + 0.2 * seg(u, 0.3, 1)), 4.2, { alpha: flashOf(seg(u, 0.25, 1), 0.15), turn: u * 3 });
        // Everybody else the ring passes is mended as it reaches them: light at their breast, and the cross off their head.
        for (const { b, d } of covered(k, R, ['player', 'peer']).slice(0, 6)) {
          const v = seg(u, reachedAt(d, 0.42), reachedAt(d, 0.42) + 0.5);
          if (v <= 0 || v >= 1) continue;
          k.glow(k.chest(b), 9, 0.6 * flashOf(v, 0.12));
          cross(k, k.at(b, 1.05 + 0.2 * v), 3.4, { alpha: flashOf(v, 0.15), turn: v * 3 + d });
        }
        k.light(c, 2.2, 0.6 * hold, PALETTE.core);
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
          k.ribbon(pts, { width: 3.2, taper: 'none', alpha: g, main: LINEN, core: '#ffffff', ink: LINEN_INK, glow: 0.2 });
        }
      },
      impact: { secs: 1.3, draw: (k, u) => {
        const R = k.fx.reach || 3;
        const c = k.caster;
        // Six strips spun out in a spiral, each laid down on the ground where it reaches the edge.
        const strips = 6;
        const fly = easeOut(seg(u, 0, 0.5));
        const fade = 1 - seg(u, 0.72, 1);
        const swirl = 1.6;
        const flying = fade * (1 - seg(u, 0.42, 0.55));
        for (let i = 0; i < strips && flying > 0.01; i++) {
          const base = (i / strips) * TAU + k.seed * 0.001;
          const pts: P3[] = [];
          for (let j = 0; j <= 5; j++) {
            const v = Math.max(0, fly - (5 - j) * 0.08);
            const an = base + swirl * v;
            const rr = 0.15 + (R - 0.15) * v;
            const x = c.x + Math.cos(an) * rr, y = c.y + Math.sin(an) * rr;
            pts.push(k.on(x, y, lerp(k.caster.tall * 0.55, 1, v) + Math.sin(k.now * 20 + j + i) * 0.5 * (1 - v)));
          }
          k.ribbon(pts, { width: 3.6, taper: 'start', alpha: flying, main: LINEN, core: '#ffffff', ink: LINEN_INK, glow: 0.25 });
        }
        // Where they land, a ring of linen laid at the edge, stitched: cloth, not light.
        const band = seg(u, 0.36, 0.5);
        if (band > 0) k.ring(c, R - 0.04, { band: 0.16, alpha: band * fade, main: LINEN, deep: LINEN_DEEP, core: '#ffffff', ink: LINEN_INK, glow: 0.6 * k.night, light: '#fff1d6', dash: 2, n: strips * 6, turn: swirl });
        // Everybody within it dressed as the strips land, the nearer first -- the band round them, and the worst wound
        // under it sewn a fifth of the way, the spell's own share.
        const close = k.fx.close ?? 0.2;
        const dress = (b: Body, start: number, spin: number): void => {
          const on = seg(u, start, start + 0.3);
          if (on <= 0) return;
          wrap(k, b, { lo: 0.42, hi: 0.58, turns: 1.1, u: easeOut(on), from: seg(u, 0.8, 1), spin });
          const w = woundAt(k, b, 1);
          suture(k, b, w.at, { len: 9, ang: w.ang, close, u: seg(u, start, start + 0.25), gash: 1, alpha: 1 - seg(u, 0.75, 0.95) });
        };
        for (const { b, d } of covered(k, R, ['player', 'peer']).slice(0, 3)) dress(b, 0.25 + 0.2 * d, swirl + d * 3);
        // And on the caster, a dressing of their own.
        dress(c, 0.1, swirl);
        k.light(c, 1.8, 0.5 * fade, '#fff1d6');
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
          k.emit(at, 14 * g, { kind: 'mist', colour: [...VAPOUR], size: 2.6, sizeEnd: 5, life: [0.4, 0.8], speed: [0.02, 0.08], up: [-4, 4], gravity: -2, bias: 6 });
          k.glow(at, 6, 0.4 * g, BLOOD_LIGHT, true);
        }
      },
      hit: (k) => {
        const R = k.fx.reach || 4;
        // Where it was let go, and who was in it then: the sickness stays there, on them, whoever walks where after.
        const st = k.state;
        st.cx = k.caster.x; st.cy = k.caster.y;
        let n = 0;
        for (const b of k.bodiesWithin(R, k.caster, ['creature'])) {
          if (n >= MOST_MARKED || b.who?.kind !== 'creature') continue;
          st[`c${n}`] = b.who.id;
          st[`d${n}`] = Math.hypot(b.x - k.caster.x, b.y - k.caster.y) / R;
          n++;
        }
        st.caught = n;
        // Flung out low over the ground, as far as it reaches.
        k.burst(k.at(k.caster, 0.25), 14, { kind: 'mist', colour: [...VAPOUR], size: 5, sizeEnd: 12, life: [0.9, 1.4], speed: [R * 0.6, R * 1.0], up: [0, 3], gravity: 0, drag: 0.15, bias: 2 });
        k.burst(k.at(k.caster, 0.5), 8, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 1.6, life: [0.4, 0.7], speed: [0.6, 1.4], up: [6, 16], gravity: 60 });
      },
      impact: { secs: 1.1, draw: (k, u) => {
        const R = k.fx.reach || 4;
        const C = plagueAt(k);
        const r = R * easeOut(seg(u, 0, 0.5));
        const gone = seg(u, 0.6, 1);
        k.ring(C, Math.max(0.1, r), { band: 0.16, alpha: 0.9 * (1 - seg(u, 0.75, 1)), main: BLOOD, deep: BLOOD_DEEP, ink: BLOOD_INK, glow: 0, dash: 3, turn: -u });
        // A bank of the miasma rolling along the ground behind the front: low puffs, a few soft wisps off them.
        miasma(k, C, r, 0.3 * (1 - gone), u);
        if (u < 0.5) {
          for (let i = 0; i < (k.fast ? 3 : 6); i++) {
            const an = (i / 6) * TAU + hashOf(k.seed, i);
            k.emit(k.on(C.x + Math.cos(an) * r, C.y + Math.sin(an) * r, 2), 5, { kind: 'mist', colour: [...VAPOUR], size: 4, sizeEnd: 9, life: [0.6, 1.0], speed: [0.05, 0.2], up: [1, 4], gravity: -1, heading: { x: Math.cos(an), y: Math.sin(an) }, cone: 1 });
          }
        }
        k.light(C, R * 0.5, 0.4 * (1 - u), BLOOD_LIGHT);
        // Every creature the front reaches: a red glint at its heart as it is caught.
        for (const { b, d } of plagued(k)) {
          const v = seg(u, reachedAt(d, 0.5), reachedAt(d, 0.5) + 0.35);
          if (v > 0 && v < 1) glint(k, k.heart(b), 6, flashOf(v, 0.1));
        }
      } },
      linger: { on: 'spot', draw: (k, age, left) => {
        const R = k.fx.reach || 4, secs = secsOf(k, 10);
        const C = plagueAt(k);
        const a = smooth(age / 0.6) * smooth(left / 1);
        // Every creature it caught bleeds a second at a time, wherever it goes: its own red tally of the seconds under
        // it, coming on as the front reaches it, a drop off it and a glint each second.
        const tick = Math.floor(age);
        const fresh = tick !== k.state.tick;
        k.state.tick = tick;
        for (const { b, d } of plagued(k)) {
          const on = a * seg(age, reachedAt(d, 0.5) * 1.1, reachedAt(d, 0.5) * 1.1 + 0.3);
          tally(k, b, tallyR(b), Math.round(secs), left, { alpha: 0.75 * on, band: 0.05, main: BLOOD, deep: BLOOD_DEEP, ink: BLOOD_INK, light: BLOOD_LIGHT, glowEvery: 3 });
          if (fresh) k.burst(k.at(b, 0.5), 2, { kind: 'drop', colour: [BLOOD, BLOOD_DEEP], size: 2, life: [0.4, 0.6], speed: [0.02, 0.1], up: [-2, 4], gravity: 60, jitter: b.wide / 80, bias: 4 });
          glint(k, k.heart(b), 3, on * flashOf(age % 1, 0.1) * 0.7);
        }
        // The edge of the sickness where it was let go, kept as the seconds of the bleed, and a wisp of the miasma inside it
        // now and then: the puffs on the ground were the impact's, and ten seconds of them over four tiles is the most of its cost.
        // Handed over from the impact's ring as that one goes, so there is never the one ring drawn twice.
        tally(k, C, R, Math.round(secs), left, { alpha: 0.55 * a * seg(age, 0.75, 1.1), band: 0.12, main: BLOOD, deep: BLOOD_DEEP, ink: BLOOD_INK, light: BLOOD_LIGHT, turn: age * 0.05 });
        k.light(C, R * 0.5, 0.15 * a, BLOOD_LIGHT);
        if (!k.fast) {
          const an = k.rand() * TAU, rr = R * Math.sqrt(k.rand());
          k.emit(k.on(C.x + Math.cos(an) * rr, C.y + Math.sin(an) * rr, 1), 3 * a, { kind: 'mist', colour: [...VAPOUR], size: 4, sizeEnd: 10, life: [1.4, 2.2], speed: [0.02, 0.08], up: [1, 3], gravity: -1 });
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
        // The wounds open on whoever it is for, and a thread already run from the working hands to each of them, drawn
        // taut and slack as the hands work; a glint at one hand then the other.
        const b = k.target;
        const w = seg(t, 0.18, 0.3) * (1 - seg(t, 0.5, 0.54));
        if (!k.state.landed) {
          for (let i = 0; i < 3; i++) {
            const wd = woundAt(k, b, i);
            suture(k, b, wd.at, { len: [9, 8, 7][i], ang: wd.ang, close: k.fx.close ?? 0.5, u: 0, gash: seg(t, 0.12 + i * 0.04, 0.22 + i * 0.04), wet: 0.5 });
          }
        }
        if (w <= 0) return;
        const work = Math.sin(seg(t, 0.18, 0.5) * TAU * 3.5);
        for (let i = 0; i < 3; i++) {
          const from = k.hand(i === 1 ? 0 : 1), to = woundAt(k, b, i).at;
          const reach = easeOut(seg(t, 0.18 + i * 0.05, 0.32 + i * 0.05));
          if (reach <= 0) continue;
          const sag = (i === 1 ? -work : work) * 1.2 - 1;
          thread(k, from, mid3(from, to, reach), { alpha: w * 0.9, lift: -sag });
        }
        const which = work > 0 ? 1 : 0;
        k.flare(k.hand(which), 3.4, w, PALETTE.core, k.now * 5);
      },
      travel: { secs: sent(0.1, 0.05), draw: (k, u) => {
        // Three needles, each run down its own thread to its own wound.
        const b = k.target;
        for (let i = 0; i < 3; i++) {
          const from = k.hand(i === 1 ? 0 : 1), to = woundAt(k, b, i).at;
          const v = clamp(u * 1.15 - i * 0.07);
          const lift = (i - 1) * 2 + 1 + k.dist;
          const tip = arcAt(from, to, easeOut(v), lift);
          thread(k, from, to, { lift: lift * 0.6, alpha: 0.8 });
          needle(k, tip, arcAt(from, to, Math.max(0, easeOut(v) - 0.1), lift));
        }
      } },
      hit: (k) => {
        k.state.landed = 1;
        k.burst(k.heart(k.target), 10, { kind: 'mote', size: 1.8, life: [0.4, 0.8], speed: [0.1, 0.4], up: [4, 14], gravity: 0 });
      },
      impact: { secs: 1.7, draw: (k, u) => {
        const b = k.target;
        const fade = 1 - seg(u, 0.82, 1);
        // Every wound, stitched together at once, half of each closed: the halves sewn glow, the rest dries dark.
        for (let i = 0; i < 3; i++) {
          const w = woundAt(k, b, i);
          suture(k, b, w.at, { len: [9, 8, 7][i], ang: w.ang, close: k.fx.close ?? 0.5, u: easeOut(seg(u, 0.02 + i * 0.05, 0.42 + i * 0.05)), gash: fade, wet: 0.5, alpha: fade, needle: 1 - seg(u, 0.4 + i * 0.05, 0.48 + i * 0.05), bob: u * 30 + i });
        }
        // Then bound, and the health back: a dressing round the middle, a breath of light off them, the cross.
        wrap(k, b, { lo: 0.36, hi: 0.56, turns: 1.8, u: easeOut(seg(u, 0.4, 0.66)), from: seg(u, 0.84, 1), spin: 1 });
        const lift = flashOf(seg(u, 0.5, 1), 0.12);
        if (u > 0.5 && !k.state.up) {
          k.state.up = 1;
          k.burst(k.at(b, 0.5), 14, { kind: 'mote', size: 1.8, life: [0.6, 1.0], speed: [0.05, 0.2], up: [12, 24], gravity: 0, jitter: 0.12 });
        }
        k.glow(k.chest(b), 10, 0.5 * lift);
        cross(k, k.at(b, 1.05 + 0.2 * seg(u, 0.5, 1)), 4, { alpha: lift, turn: u * 3 });
        k.light(b, 1.6, 0.6 * fade, PALETTE.core);
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
          suture(k, b, w.at, { len: 6, ang: w.ang, close: 1, u: 0, gash: show * seg(t, 0.1 + i * 0.04, 0.2 + i * 0.04), wet: 0.5, alpha: 1 - seg(t, 0.9, 1) });
        }
        k.glow(k.chest(), 6 + 6 * seg(t, 0.25, 0.55), 0.6 * seg(t, 0.2, 0.55) * (1 - seg(t, 0.55, 0.7)));
      },
      hit: (k) => {
        // Out from the breast as the arms open, and down off the face.
        k.burst(k.chest(), 8, { kind: 'mote', size: 2, life: [0.4, 0.7], speed: [0.5, 0.9], up: [-2, 6], gravity: 0, drag: 0.2 });
      },
      impact: { secs: 1.4, draw: (k, u) => {
        const b = k.caster;
        // A band of light rising up the body, feet to crown; each wound it passes is stitched shut, the whole of it,
        // and over the head it draws in and closes, and the cross goes up.
        const rise = easeOut(seg(u, 0, 0.6));
        const fade = 1 - seg(u, 0.75, 1);
        for (let i = 0; i < 3; i++) {
          const w = woundAt(k, b, i);
          const share = (w.at.z - b.z) / b.tall;
          const sewn = seg(rise, share - 0.12, share + 0.02);
          suture(k, b, w.at, { len: 6, ang: w.ang, close: 1, u: sewn, gash: 1 - seg(u, 0.45, 0.7), alpha: 1 - seg(u, 0.5, 0.75) });
        }
        const h = lerp(0.02, 1.15, rise);
        // Drawn in from the shoulders up, shut to nothing by the crown: it goes over, it never sits there.
        const shut = smooth(seg(rise, 0.66, 0.92));
        if (shut < 0.98) wrap(k, b, { lo: h, hi: h, turns: 1, u: 1, light: true, width: 3.4 * (1 - 0.5 * shut), size: 1.25 * (1 - shut) + 0.05 });
        if (u < 0.6) k.emit(k.at(b, h), 15, { kind: 'mote', size: 1.6, life: [0.3, 0.6], speed: [0.05, 0.15], up: [2, 8], gravity: 0, jitter: 0.08 });
        k.flare(k.at(b, 1.1), 5, bump(u, 0.5, 0.6, 0.8), PALETTE.core, u * 3);
        cross(k, k.at(b, 1.1 + 0.25 * seg(u, 0.55, 1)), 4.4, { alpha: flashOf(seg(u, 0.55, 1), 0.15), turn: u * 3 });
        k.light(b, 1.6, 0.7 * fade, PALETTE.core);
      } },
    },
  },
  // Miracle Worker (ally, on self, player, 4 tiles round): Every wound on you or on somebody within 4 tiles of you closes, with whatever bleeding and venom was in it, and they get 50% of their health back.
  chirurgeon_miracle_worker: {
    palette: PALETTE,
    cast: { timing: { secs: 2.0, release: 0.55 }, pose: miraclePose },
    fx: {
      charge: (k, t) => {
        // A light gathered between the joined hands overhead, and the cross drawn on the ground under whoever it is for,
        // kept until the light lands and the impact's own takes over.
        const g = smooth(seg(t, 0.12, 0.46)) * (1 - seg(t, 0.5, 0.56));
        const at = mid3(k.hand(0), k.hand(1), 0.5);
        if (g > 0) {
          k.orb(at, 2 + 3 * g, { alpha: g, turn: k.now * 2 });
          k.light(at, 1.6, 0.6 * g, PALETTE.core);
          k.emit(at, 30 * g, { kind: 'mote', size: 1.6, life: [0.3, 0.6], speed: [0.05, 0.2], up: [-10, 4], gravity: 0, jitter: 0.05 });
        }
        const d = smooth(seg(t, 0.2, 0.55));
        if (d > 0 && !k.state.landed) crossOnGround(k, k.target, 0.72 * d, { alpha: 0.85 * d, turn: 0 });
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
        k.state.landed = 1;
        const at = k.heart(k.target);
        k.burst(at, 20, { kind: 'mote', size: 2.2, life: [0.6, 1.1], speed: [0.2, 0.8], up: [10, 30], gravity: 0, drag: 0.3 });
        // What was in the wounds driven out: bad blood and venom, flung off and falling.
        k.burst(at, 16, { kind: 'drop', colour: [BLOOD_DEEP, '#5a2a33'], size: 2, life: [0.5, 0.8], speed: [0.6, 1.4], up: [10, 24], gravity: 70, bias: 4 });
        k.burst(at, 8, { kind: 'mist', colour: [...VAPOUR], size: 4, sizeEnd: 9, life: [0.6, 1.0], speed: [0.3, 0.7], up: [6, 14], gravity: -4, bias: 4 });
        k.flash(0.12);
      },
      impact: { secs: 2.2, draw: (k, u) => {
        const b = k.target;
        const fade = 1 - seg(u, 0.78, 1);
        crossOnGround(k, b, 0.72, { alpha: 0.85 * fade, turn: 0 });
        // The column comes up thin while the wounds close in it, and swells once they are shut, so they are seen closing.
        k.pillar(b, { r: 8, h: 90, alpha: lerp(0.3, 0.65, seg(u, 0.1, 0.3)) * (1 - smooth(seg(u, 0.3, 0.8))), glow: 0.4 });
        // Every wound closed outright, and bound.
        for (let i = 0; i < 4; i++) {
          const w = woundAt(k, b, i);
          suture(k, b, w.at, { len: 8, ang: w.ang, close: 1, u: easeOut(seg(u, 0.02, 0.3)), gash: 1 - seg(u, 0.2, 0.45), alpha: 1 - seg(u, 0.4, 0.6), bias: 12 });
        }
        wrap(k, b, { lo: 0.15, hi: 0.85, turns: 3, u: easeOut(seg(u, 0.1, 0.45)), from: seg(u, 0.65, 0.95), spin: 0.5, light: seg(u, 0.5, 0.6) > 0.5 });
        cross(k, k.at(b, 1.12 + 0.3 * seg(u, 0.3, 1)), 6, { alpha: flashOf(seg(u, 0.2, 1), 0.12), turn: u * 4 });
        k.light(b, 2, 0.9 * fade, PALETTE.core);
      } },
    },
  },
};

/** Where a Plague was let go: the caster's feet at the hit, kept, so the sickness stays put when they walk on. */
function plagueAt(k: FxScene): { x: number; y: number } {
  const st = k.state;
  return st.cx === undefined ? { x: k.caster.x, y: k.caster.y } : { x: st.cx, y: st.cy };
}

/** The creatures a Plague caught when it was let go, wherever they are now, with the share of its radius each stood at. */
function plagued(k: FxScene): Array<{ b: Body; d: number }> {
  const st = k.state, n = st.caught ?? 0;
  if (!n) return [];
  const out: Array<{ b: Body; d: number }> = [];
  const C = plagueAt(k);
  // Looked for a good way past the edge: a creature caught goes on bleeding as it runs.
  for (const b of k.bodiesWithin((k.fx.reach || 4) + 6, C, ['creature'])) {
    const who = b.who;
    if (who?.kind !== 'creature') continue;
    for (let i = 0; i < n; i++) {
      if (st[`c${i}`] === who.id) {
        out.push({ b, d: st[`d${i}`] ?? 1 });
        break;
      }
    }
  }
  return out;
}

/**
 * The miasma lying on the ground: a ring of low puffs of it at `r` tiles round
 * `c`, each a ragged blob in the bruised red, as one shape on the land -- a gas
 * hugging the ground rather than flecks in the air. `drift` turns and swells them.
 */
function miasma(k: FxScene, c: { x: number; y: number }, r: number, alpha: number, drift: number): void {
  if (alpha <= 0.01 || r <= 0.2) return;
  const n = 10;
  const lo: number[][] = [], hi: number[][] = [];
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU + hashOf(k.seed, i + 20) * 0.5 + drift * 0.1;
    const rr = r * (0.75 + 0.2 * hashOf(k.seed, i + 40));
    const px = c.x + Math.cos(an) * rr, py = c.y + Math.sin(an) * rr;
    const size = (0.3 + 0.25 * hashOf(k.seed, i + 60)) * (0.6 + 0.4 * Math.min(1, r / 2)) * (1 + 0.1 * Math.sin(drift * 2 + i));
    const pts: number[] = [];
    for (let j = 0; j < 7; j++) {
      const a2 = (j / 7) * TAU + i;
      const s2 = size * (0.75 + 0.35 * hashOf(k.seed + i, j));
      pts.push(px + Math.cos(a2) * s2 * 1.3, py + Math.sin(a2) * s2);
    }
    (i % 2 ? hi : lo).push(pts);
  }
  k.groundShape(c.x, c.y, r + 1, [
    { kind: 'fill', colour: VAPOUR[1], alpha: clamp(alpha), paths: lo, lift: 0.1 },
    { kind: 'fill', colour: VAPOUR[0], alpha: clamp(alpha * 0.8), paths: hi, lift: 0.1 },
  ]);
}

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
    { kind: 'stroke', colour: PALETTE.core, alpha: clamp(a), paths: [pts], lift: 0.12, width: inkW * 2.2, closed: true, join: 'miter', glow: 0.8 * k.night * a },
    { kind: 'stroke', colour: PALETTE.ink, alpha: clamp(a), paths: [pts], lift: 0.12, width: inkW, closed: true, join: 'miter' },
  ]);
  k.glow(k.on(c.x, c.y, 0.5), r * HALF_W * 0.9, a * 0.4);
}
