/**
 * The Archer's spells: how each is cast and what it looks like.
 *
 * Nine of the twelve are a bow drawn and loosed, so the trade's look is the
 * shot itself, done twelve ways: the string drawn back to the cheek and the
 * arrow on it, a real arrow in flight -- shaft, head and fletching -- and the
 * arrow left standing in what it hit. What makes each shot its own is how it
 * is drawn (snapped off half-drawn, held still at the anchor, lofted, from a
 * knee, from the hip), how it flies (flat and quick, on a high arc, two at
 * once, straight as a sight line) and what it leaves (a crosshair, brambles
 * at the feet, tethers to the ground). The other three are the archer's
 * craft without a shot: reading the wind, setting out a decoy, marking a
 * creature's weak places, steadying the eye.
 *
 * The palette is leaf green and fletching gold; the shapes are chevrons (a
 * fletching's V, a crosshair's four ticks), thin straight lines (strings,
 * sight lines, tethers), small dials and wedges that count time down, and
 * leaves (spinning green shards). Gold is the archer's own will laid on the
 * world -- a shot that cannot miss, a hold, a mark, a count of seconds won --
 * and green is the wood and the wind it works with. Each spell keeps its own
 * sign: only Aimed Shot has the crosshair, Snipe a scope's pip, Expose
 * weak-spot diamonds, Deadeye an iris; a count of seconds is a ring of wedges
 * (Crippling Shot, Decoy, Deadeye), a dial (Quick Shot) or a telltale burning
 * short (Read the Wind).
 *
 * Gold drawn among bodies goes olive under the night, so every mark that has
 * to read as light is laid again over the night in its own colours
 * (`overNight`), and a cast's light is small and warm (`WARM`).
 *
 * ## The bow
 *
 * The figure holds a bow upright at the left fist, standing in the hips'
 * frame -- it goes where the left hand goes but does not turn with the arm --
 * and its string is drawn straight between the tips whatever the right hand
 * does. So the draw is drawn here: `bowOf` finds the tips as the figure sets
 * them, and `drawnString` pulls a string from each tip back to the right
 * hand, with the arrow on it, while the pose has the hand at the string. The
 * poses keep the bow arm all but level and the trunk side-on, where an
 * upright bow is what a drawn bow looks like anyway.
 */
import type { CastPose, PoseCue, SpellVisual } from './index';
import { spellInfo } from './info';
import { arcAt, bump, clamp, dry, easeIn, easeOut, flashOf, hashOf, lerp, mid3, seg, smooth, TAU, type Body, type FxScene, type P3, type SpellPalette } from './kit';
import { euler, one, stepIn } from './poses';
import { UNITS_PER_TILE } from '../iso';
import { figureProportions, figureStance, standFeet, weaponSpan } from '../figure';

/** Leaf green and fletching gold. */
export const PALETTE: SpellPalette = {
  core: '#f4ffd8',
  main: '#8cc56a',
  deep: '#3f6b2f',
  accent: '#e9d36a',
  ink: '#1d3318',
  light: '#c8f08a',
};

/** The things an archer carries, in the island's own browns and greys rather than the trade's colours. */
const SHAFT = '#a07d4c';
const STEEL = '#d5dadc';
/** Leaves for the wind and the brambles, lit to shaded. */
const LEAVES = ['#b7d77a', '#8cc56a', '#5f9a45'] as const;
const GOLD = PALETTE.accent;
const GOLD_DEEP = '#a8862c';
/** The light a shot leaves on the ground at night: a warm white, as gold or green light washes the grass olive. */
const WARM = '#fff1d6';
/** Dug turf and dust. */
const DIRT = '#7d6e58';

/** A spell's own numbers, as the island casts it. */
const fxOf = (id: string): Readonly<Record<string, number>> => spellInfo(id)?.fx ?? {};

/**
 * A mark drawn among the bodies laid again over the night, in its own
 * colours, `k.night` of the way: a gold crosshair, dial or pip that has to
 * read as light rather than going olive in the dark. `paint` draws it in
 * screen pixels and leaves the alpha alone.
 */
function overNight(k: FxScene, alpha: number, paint: (g: CanvasRenderingContext2D) => void): void {
  const a = alpha * k.night * 0.85;
  if (a <= 0.01) return;
  k.glowDraw((g) => {
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = clamp(a);
    paint(g);
    g.globalCompositeOperation = 'lighter';
  });
}

/* ---- points as height units ------------------------------------------------------------- */

/** A point or a step in height units every way, so lengths along an arrow are the same in the air as over the ground. */
type V = [number, number, number];
const toV = (p: P3): V => [p.x * UNITS_PER_TILE, p.y * UNITS_PER_TILE, p.z];
const toP = (v: V): P3 => ({ x: v[0] / UNITS_PER_TILE, y: v[1] / UNITS_PER_TILE, z: v[2] });
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V, s = 1): V => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** `p` moved `s` height units along the unit step `d`. */
const along = (p: P3, d: V, s: number): P3 => toP(add(toV(p), d, s));
/** The unit step from one point to another. */
const dirOf = (a: P3, b: P3): V => unit(sub(toV(b), toV(a)));

/* ---- the bow, as the figure holds it ------------------------------------------------------ */

/** Whether a weapon is a bow the figure strings: one with tips. Asked of the figure's own measures, once a kind. */
const BOWS = new Map<string, boolean>();
function isBow(id: string | undefined): boolean {
  if (!id) return false;
  let y = BOWS.get(id);
  if (y === undefined) BOWS.set(id, (y = !!weaponSpan(id)?.tips));
  return y;
}

interface Bow {
  /** The middle of the left fist on the stave. */
  grip: P3;
  /** Where the string is made fast at either end. */
  top: P3;
  bottom: P3;
  /** The string where the hand has it, drawn or not, and the point of an arrow on it. */
  nock: P3;
  point: P3;
}

/**
 * Where a body's bow is this frame, as the figure holds and strings it (the
 * pose takes it in the left fist, draws the string and nocks the arrow; see
 * `figureJoint`). Nothing when there is no bow in the hand.
 */
function bowOf(k: FxScene, b: Body = k.caster): Bow | null {
  if (!isBow(b.figure?.gear?.weapon?.id)) return null;
  return { grip: k.joint(b, 'grip'), top: k.joint(b, 'bowTop'), bottom: k.joint(b, 'bowBottom'), nock: k.joint(b, 'nock'), point: k.joint(b, 'arrow') };
}

/** An arrow's length in height units: three-quarters of a metre. */
const ARROW = 7.5;

/**
 * An arrow in the world, its head at `head` pointing along `d`: a shaft in
 * wood, a steel head, and two vanes at the nock in the trade's green (gold for
 * a shot that cannot miss). Drawn in screen pixels so it keeps its
 * proportions however it is turned; seen end on it is a short stub, as it
 * should be.
 */
function arrow(k: FxScene, head: P3, d: V, o: { long?: number; alpha?: number; fletch?: string; tip?: string; bias?: number; glow?: number; sunk?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const L = ARROW * (o.long ?? 1);
  const tail = along(head, d, -L);
  // How much of it is in whatever it is stuck in: the shaft is drawn from where it goes in.
  const shown = along(head, d, -L * (o.sunk ?? 0));
  const hx = k.sx(shown), hy = k.sy(shown), tx = k.sx(tail), ty = k.sy(tail);
  const dx = hx - tx, dy = hy - ty, l = Math.hypot(dx, dy);
  if (l < 0.5) return;
  const ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
  const z = k.zoom;
  const w = Math.max(0.9, 0.55 * z);
  const sunk = (o.sunk ?? 0) > 0;
  const headLen = sunk ? 0 : Math.min(l * 0.22, 2.6 * z), headW = Math.max(1.1, 0.9 * z);
  const vane = Math.min(l * 0.3, 3.4 * z), vaneW = Math.max(1.2, 1.15 * z);
  const fletch = o.fletch ?? PALETTE.main, tip = o.tip ?? STEEL, ink = PALETTE.ink;
  // Sorted with whichever end is nearer the viewer, so it passes in front of what it stands out of.
  const near = ty > hy ? tail : shown;
  k.worldDraw(near, (g) => {
    g.globalAlpha = clamp(a);
    g.lineCap = 'butt';
    g.strokeStyle = ink;
    g.lineWidth = w + Math.max(1, 0.6 * z);
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(hx - ux * headLen * 0.6, hy - uy * headLen * 0.6);
    g.stroke();
    g.strokeStyle = SHAFT;
    g.lineWidth = w;
    g.stroke();
    // The vanes: a chevron either side at the nock, swept back.
    g.fillStyle = fletch;
    g.strokeStyle = ink;
    g.lineWidth = Math.max(0.6, 0.45 * z);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(tx + ux * vane * 0.15, ty + uy * vane * 0.15);
      g.lineTo(tx + ux * vane * 0.05 + nx * vaneW * s, ty + uy * vane * 0.05 + ny * vaneW * s);
      g.lineTo(tx + ux * vane + nx * vaneW * 0.35 * s, ty + uy * vane + ny * vaneW * 0.35 * s);
      g.lineTo(tx + ux * vane, ty + uy * vane);
      g.closePath();
      g.fill();
      g.stroke();
    }
    if (headLen > 0.5) {
      g.fillStyle = tip;
      g.beginPath();
      g.moveTo(hx, hy);
      g.lineTo(hx - ux * headLen + nx * headW, hy - uy * headLen + ny * headW);
      g.lineTo(hx - ux * headLen * 0.75, hy - uy * headLen * 0.75);
      g.lineTo(hx - ux * headLen - nx * headW, hy - uy * headLen - ny * headW);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }, o.bias ?? 0);
  if ((o.glow ?? 0) > 0) k.glow(shown, 4 + 2 * (o.glow ?? 0), a * (o.glow ?? 0) * 0.7);
}

/** The way to the target from the caster's chest, as a unit step: where an arrow on the string points when the hand is at the bow. */
const aimOf = (k: FxScene): V => dirOf(k.chest(), k.heart(k.target));

/** Where a shot leaves from: the bow's grip, or the left hand when there is no bow to find. */
const muzzle = (k: FxScene): P3 => (isBow(k.caster.figure?.gear?.weapon?.id) ? k.joint(k.caster, 'grip') : k.hand(0));

/**
 * An arrow on its way, `u` of the way from `from` to `to` on an arc `lift`
 * height units over the straight line, pointing the way it is going, with a
 * trail behind it `trail` of the way long.
 */
function flight(k: FxScene, from: P3, to: P3, u: number, lift: number, o: { trail?: number; width?: number; fletch?: string; tip?: string; glow?: number; long?: number; main?: string; core?: string; side?: V; wide?: number; path?: (v: number) => P3; alpha?: number } = {}): P3 {
  // Bowed out sideways along `side` by `wide` height units at the middle of the way as well as lifted, when asked: opening out
  // quickly off the string and closing late, so two arrows loosed together are seen to part at once. Or a path of the
  // spell's own (Long Shot's drifting arc, Crippling Shot's dip to the knee).
  const side = o.side, wide = o.wide ?? 0;
  const path = o.path ?? ((v: number): P3 => (side && wide ? along(arcAt(from, to, v, lift), side, wide * Math.sqrt(4 * v * (1 - v))) : arcAt(from, to, v, lift)));
  const head = path(u);
  const behind = path(Math.max(0, u - 0.02));
  let d = dirOf(behind, head);
  if (u < 0.02) d = dirOf(from, path(0.04));
  const tr = o.trail ?? 0.2;
  if (tr > 0) {
    const pts: P3[] = [];
    for (let i = 5; i >= 0; i--) pts.push(path(Math.max(0, u - tr * (i / 5))));
    // The trail stops at the vanes rather than running up the arrow.
    pts[5] = along(head, d, -ARROW * 0.9);
    k.ribbon(pts, { width: o.width ?? 2.2, alpha: 0.75 * (o.alpha ?? 1), glow: 0.6, main: o.main, core: o.core, edge: false });
  }
  arrow(k, head, d, { fletch: o.fletch, tip: o.tip, glow: o.glow ?? 0.6, long: o.long ?? 1.15, alpha: o.alpha });
  return head;
}

/**
 * The arrow left standing in what it hit, pointing the way it came, `sunk` of it in: for the impact and anything that
 * lingers. `long` draws it longer than life, so the shaft and its vanes can be found on a creature at play size.
 */
function stuck(k: FxScene, at: P3, d: V, alpha = 1, sunk = 0.3, fletch?: string, long = 1): void {
  arrow(k, along(at, d, ARROW * long * sunk), d, { alpha, sunk, fletch, bias: 2, long });
}

/** The way an arrow came in, kept from the moment it landed so it stays put as the caster walks off. */
function keepWay(k: FxScene, from: P3, to: P3): V {
  const d = dirOf(from, to);
  k.state.dx = d[0];
  k.state.dy = d[1];
  k.state.dz = d[2];
  return d;
}
const keptWay = (k: FxScene): V => (k.state.dx === undefined ? aimOf(k) : [k.state.dx, k.state.dy, k.state.dz]);

/** An arrow going in: splinters of light thrown back the way it came and on through, a flare, a little dust at the feet. */
function strike(k: FxScene, at: P3, d: V, scale = 1, colour?: string): void {
  const back = { x: -d[0], y: -d[1] }, on = { x: d[0], y: d[1] };
  k.burst(at, 10 * scale, { kind: 'spark', size: 1.8, colour: colour ? [colour, PALETTE.core] : undefined, life: [0.18, 0.4], speed: [0.6, 1.6], up: [4, 22], heading: back, cone: 1.6, gravity: 50, drag: 0.1 });
  k.burst(at, 6 * scale, { kind: 'spark', size: 1.5, life: [0.15, 0.3], speed: [0.8, 1.8], up: [-2, 10], heading: on, cone: 0.8, gravity: 40, drag: 0.1 });
  k.burst(k.at(k.target, 0.05), 4 * scale, { kind: 'dust', colour: '#8a7a62', size: 2.6, life: [0.35, 0.6], speed: [0.15, 0.4], up: [2, 6], gravity: 2 });
}

/**
 * Four chevrons round a point, each pointing in at it: a crosshair. `r`
 * pixels at zoom one out from the middle, `turn` radians round, in gold. Drawn
 * over whatever it is on.
 */
function crosshair(k: FxScene, p: P3, r: number, o: { alpha?: number; turn?: number; size?: number; colour?: string; squash?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), z = k.zoom, R = r * z, s = (o.size ?? 3) * z;
  const turn = o.turn ?? 0, sq = o.squash ?? 1;
  const fill = o.colour ?? GOLD;
  const paint = (g: CanvasRenderingContext2D): void => {
    g.lineJoin = 'miter';
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const an = turn + (i * Math.PI) / 2;
      const c = Math.cos(an), sn = Math.sin(an);
      // The chevron's point toward the middle, its arms swept out behind it.
      const px = x + c * R, py = y + sn * R * sq;
      const bx = x + c * (R + s), by = y + sn * (R + s) * sq;
      g.moveTo(px, py);
      g.lineTo(bx - sn * s, by + c * s * sq);
      g.lineTo(x + c * (R + s * 0.55), y + sn * (R + s * 0.55) * sq);
      g.lineTo(bx + sn * s, by - c * s * sq);
      g.closePath();
    }
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = Math.max(0.8, 0.6 * z);
    g.strokeStyle = PALETTE.ink;
    g.stroke();
  };
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    paint(g);
  }, 30);
  // Lit, not tinted, at night: the chevrons themselves laid over the dark.
  overNight(k, a, paint);
  k.glow(p, r * 1.6, a * 0.22, GOLD, true);
}

/**
 * A ribbon round a body, split where it passes behind the body and where in
 * front, so a streamer that wraps somebody goes behind them and comes out
 * the other side rather than lying wholly over or under them.
 */
function wrap(k: FxScene, b: Body, pts: P3[], look: { width?: number; alpha?: number; main?: string; core?: string; glow?: number }): void {
  const depth = (p: P3): number => k.eye.worldToScreenY(p.x, p.y, 0);
  const mine = depth(b);
  let run: P3[] = [];
  let front = depth(pts[0]) >= mine;
  let first = true;
  // Tapered at its two ends only: the first run from its start, the last toward its end (drawn reversed so the taper is there).
  const flush = (last: boolean): void => {
    if (run.length >= 2) {
      const taper = first && last ? 'both' : first || last ? 'start' : 'none';
      k.ribbon(last && !first ? [...run].reverse() : run, { ...look, taper, edge: true, bias: front ? 3 : -3 });
      first = false;
    }
    run = last ? [] : [run[run.length - 1]];
  };
  for (const p of pts) {
    const f = depth(p) >= mine;
    if (f !== front) {
      run.push(p);
      flush(false);
      front = f;
    } else run.push(p);
  }
  flush(true);
}

/* ---- the body ----------------------------------------------------------------------------- */

/**
 * A shot's moments as fractions of the cast, and the shape of the draw. The
 * right hand goes to the quiver over the shoulder (when `quiver`), comes to
 * the string at `nock`, is at the anchor by `anchor` and lets go at the
 * release.
 */
interface Shot {
  nock: number;
  anchor: number;
  /** The line of the arrow, written as the bow arm's forward angle it reads as: 88 level, more for a lofted shot, less for a low one. */
  aim: number;
  /** How far the bow hand comes up on the loose, as degrees of the arm. */
  kick: number;
  /** How far back the string comes: 140 to the jaw, less stops short of it along the line (about 100 is the chest). */
  depth: number;
  /** The trunk turned side-on to the target, degrees: the left shoulder toward it. */
  side: number;
  /** The spine at the anchor, leant back (positive) or over (negative). */
  lean: number;
  /** The right hand to the quiver over the shoulder for the arrow first. */
  quiver: boolean;
  /** The bow canted, degrees, its top to the right: a shot from the hip. */
  cant?: number;
  /** Down on the right knee for it, this share of the way. */
  kneel?: number;
}

/*
 * The figure's own measures (`figureProportions`), and the heights a shot is
 * laid out from in the body's frame: x to the right, y ahead -- at the target,
 * since the body is turned to it when the cast starts -- z up, from the middle
 * of the feet. This is the frame `Rig.reach` puts a hand in.
 */
const BODY = figureProportions();
/** The spine's joint over the soles: what a lean pitches the trunk about. */
const SPINE_AT = BODY.hips + BODY.spine;
/** The shoulders' joints over the soles, standing straight. */
const SHOULDERS_AT = SPINE_AT + BODY.chest + BODY.shoulder[2];
/** The jaw, where the string comes to: a little over half an upper arm above the shoulders. */
const JAW_AT = SHOULDERS_AT + BODY.upper * 0.58;
/** From a shoulder to the middle of the fist with the arm all but straight: the elbow left soft. */
const ARM = (BODY.upper + BODY.lower + BODY.fist) * 0.96;
/** How far down a kneel lets the trunk: the hips come down to the thigh stood upright on the knee, and the knee's own thickness. */
const KNEEL_DROP = BODY.hips - BODY.thigh - 1.5 * BODY.fist;
const RAD = Math.PI / 180;

/**
 * A point of the trunk, given standing straight, once the trunk is turned
 * `yaw` degrees (positive turns the front to the body's left), leant back
 * `lean` degrees about the spine's joint, and let down `drop` by a kneel.
 */
function trunkPoint(p: V, yaw: number, lean: number, drop: number): V {
  const a = yaw * RAD, l = lean * RAD;
  const x = p[0] * Math.cos(a) - p[1] * Math.sin(a), y = p[0] * Math.sin(a) + p[1] * Math.cos(a), h = p[2] - SPINE_AT;
  return [x, y * Math.cos(l) - h * Math.sin(l), SPINE_AT + y * Math.sin(l) + h * Math.cos(l) - drop];
}
/** A shoulder's joint (`k` 1 the right) with the trunk turned, leant and let down so. */
const shoulderOf = (k: number, yaw: number, lean: number, drop: number): V =>
  trunkPoint([(k ? 1 : -1) * BODY.shoulder[0], BODY.shoulder[1], SHOULDERS_AT], yaw, lean, drop);

/**
 * Where a shot's hands go: the anchor at the right of the jaw, the line the
 * arrow lies along from there at the target, `aim` degrees over level, the
 * bow hand out along that line as far as the left arm reaches from its
 * shoulder with the trunk turned `side` -- and the way the stave stands in
 * that fist: square to the arrow (leant back for a lofted shot), canted
 * `cant` degrees to the right.
 */
function shotLine(side: number, aim: number, lean: number, drop: number, cant: number): { anchor: V; dir: V; bow: V; haft: V } {
  const up = aim * RAD, c = cant * RAD;
  const dir: V = [0, Math.cos(up), Math.sin(up)];
  // The head turns back to look along the arrow, so the jaw is where the head is (which a lean and a kneel move) and a little to its right.
  const anchor = add(trunkPoint([0, 0, JAW_AT], 0, lean, drop), [0.45, 0.55, 0]);
  const L = shoulderOf(0, side, lean, drop);
  let lo = 0, hi = 14;
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    if (len(sub(add(anchor, dir, m), L)) < ARM) lo = m;
    else hi = m;
  }
  const haft: V = [Math.sin(c), -Math.sin(up) * Math.cos(c), Math.cos(up) * Math.cos(c)];
  return { anchor, dir, bow: add(anchor, dir, lo), haft };
}

/** A place along keys in time, as `track` but for a place. */
function placeAt(t: number, keys: Array<readonly [number, V]>): V {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const u = smooth(t1 > t0 ? (t - t0) / (t1 - t0) : 1);
      return [lerp(v0[0], v1[0], u), lerp(v0[1], v1[1], u), lerp(v0[2], v1[2], u)];
    }
  }
  return keys[keys.length - 1][1];
}

type Rig = Parameters<CastPose>[0];

/**
 * A bow drawn and loosed, side-on: the trunk turned to put the left shoulder
 * at the target and the head turned back to look along the arrow; the bow
 * taken in the left fist and its arm brought up straight along the line to
 * the target; the right hand fetching an arrow from over the shoulder (when it
 * does), coming to the string at the bow and drawing it back to the jaw,
 * holding, and on the loose flying back past the ear and opening while the
 * bow arm gives and the string shivers. The feet set apart side-on under it.
 */
function shotPose(r: Rig, t: number, c: PoseCue, s: Shot): void {
  const rel = c.timing.release, n = s.nock, an = s.anchor;
  const fly = rel + (1 - rel) * 0.22, set = rel + (1 - rel) * 0.6;
  const q = s.quiver ? n * 0.55 : -1;
  // A kneel is not made on the move (the legs are the walk's), so the hands are not let down for one.
  const kneel = c.moving ? 0 : s.kneel ?? 0;
  const { anchor, dir, bow, haft } = shotLine(s.side, s.aim - 88, s.lean, kneel * KNEEL_DROP, s.cant ?? 0);
  // The bow in the fist, the stave square to the arrow; the bow hand up the line, and given upward a little on the loose.
  r.wieldBow = 1;
  const kick = add(bow, [0, 0, 1], s.kick * 0.06);
  r.reach = [
    { at: placeAt(t, [[0, add(bow, [0, -2.4, -3.6])], [n * 0.85, add(bow, dir, -0.5)], [an, bow], [rel, bow], [fly, kick], [set, add(kick, [0, -0.4, -1.2])]]), haft, pole: [-0.7, -0.2, -1], w: one(t, [[0, 0], [Math.max(0.06, n * 0.6), 1], [set, 1], [1, 0.4]]) },
    undefined,
  ];
  // The draw hand: to the quiver over the shoulder, to the string at the bow, back to the anchor, and flung back past the ear.
  const atBow = add(bow, dir, -1.1);
  const drawn = add(anchor, dir, (140 - s.depth) * 0.05);
  const R = shoulderOf(1, s.side, s.lean, kneel * KNEEL_DROP);
  const keys: Array<readonly [number, V]> = [];
  if (q > 0) keys.push([q, add(R, [-0.5, -1.0, 2.3])], [q + (n - q) * 0.3, add(R, [-0.7, -0.8, 2.0])]);
  keys.push([n, atBow], [an, drawn], [rel, add(drawn, dir, -0.15)], [fly, add(add(drawn, dir, -1.4), [1.1, -0.2, 0.3])], [set, add(R, [0.4, 0.8, -3.4])]);
  r.reach[1] = { at: placeAt(t, keys), pole: [0.6, -1, 0.35], w: one(t, [[0, 0], [Math.max(0.06, (q > 0 ? q : n) * 0.7), 1], [set, 1], [1, 0.3]]) };
  // The string to the fingers from the moment the hand has it, let go at the release, and shivering back to straight after it.
  const age = (t - rel) * c.timing.secs;
  r.draw = t < n ? 0 : t < rel ? 1 : 0.16 * Math.max(0, 1 - age / 0.24) * Math.abs(Math.cos(age * 80));
  r.nocked = t >= n && t < rel;
  r.open[1] = t > rel && t < set + 0.1;
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [n, [-10, 0, 0]], [an, [0, 0, 0]], [fly, [-30, 0, 0]], [1, [0, 0, 0]]]);
  // Side-on: the spine and chest turned to put the left shoulder at the target; the head turned back to sight along the line.
  const side = s.side, look = (s.aim - 88) * 0.6;
  r.spine = euler(t, [[0, [0, 0, 0]], [n, [0, 0, side * 0.4]], [an, [s.lean, 0, side * 0.4]], [rel, [s.lean, 0, side * 0.4]], [fly, [s.lean + 2, 0, side * 0.4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [n, [0, 0, side * 0.6]], [an, [0, -4, side * 0.6]], [rel, [0, -4, side * 0.6]], [fly, [1, -2, side * 0.55]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [n, [-4 + look, 0, -side * 0.9]], [an, [-4 + look, -8, -side * 0.95]], [rel, [-4 + look, -8, -side * 0.95]], [fly, [-2 + look, -4, -side * 0.9]], [1, [0, 0, 0]]]);
  // The feet set apart side-on under it, the knees soft; or down on the right knee.
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [n, [8, 9, -8]], [1, [3, 3, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [n, [-8, 9, 16]], [1, [-1, 3, 0]]]);
  r.knee[0] = one(t, [[0, 4], [n, 10], [rel, 10], [fly, 14], [1, 5]]);
  r.knee[1] = one(t, [[0, 4], [n, 8], [1, 5]]);
  if (kneel > 0) r.kneel = kneel * one(t, [[0, 0], [n, 1], [set, 1], [1, 0]]);
}

/** A pose from `shotPose`, with whatever else the spell's own shot does written over it. */
const shotWith = (s: Shot, more?: (r: Rig, t: number, rel: number, c: PoseCue) => void): CastPose => (r, t, c) => {
  shotPose(r, t, c, s);
  more?.(r, t, c.timing.release, c);
};

/**
 * What a shot's charge adds to the bow the figure draws: the arrow in the
 * hand on its way from the quiver to the string, more arrows on the string
 * than the one the figure nocks (Twin Arrows, fanned), and a gold thread
 * along a shot that cannot miss.
 */
function bowCharge(k: FxScene, t: number, s: Shot, rel: number, o: { arrows?: number; fletch?: string; glow?: number } = {}): Bow | null {
  const bow = bowOf(k);
  if (!bow) return null;
  const q = s.quiver ? s.nock * 0.55 : -1;
  if (q > 0 && t > q && t < s.nock) {
    // Fetched: held by the nock end, its point swinging over from behind the shoulder toward the bow.
    const h = k.hand(1), d = unit(add(dirOf(h, bow.grip), [0, 0, 1], 1.4 * (1 - seg(t, q, s.nock))));
    arrow(k, along(h, d, ARROW * 0.8), d, { bias: 1 });
  }
  if (t < s.nock || t >= rel) return bow;
  const d = dirOf(bow.nock, bow.point), L = len(sub(toV(bow.point), toV(bow.nock)));
  for (let i = 1; i < (o.arrows ?? 1); i++) {
    // The second arrow two fingers over the first and splayed up from it, so the pair reads as two at play size and parts as it leaves.
    const di = unit(add(d, [0, 0, 1], 0.24 * i));
    arrow(k, along(along(bow.nock, [0, 0, 1], 1.2 * i), di, L), di, { fletch: o.fletch, bias: 1.5 });
  }
  if (o.fletch === GOLD) k.beam(bow.nock, bow.point, { width: 0.6, alpha: 0.4 + 0.4 * (o.glow ?? 0), main: GOLD, core: PALETTE.core, glow: 0.4 + (o.glow ?? 0) });
  return bow;
}

/** A shot's time in the air: `least` seconds and `perTile` more a tile. */
const shotTravel = (perTile: number, least: number) => (tiles: number): number => least + tiles * perTile;

/* ---- Quick Shot ---------------------------------------------------------------------------- */

const QUICK = fxOf('archer_quick_shot');
const QUICK_T = { secs: 0.62, release: 0.4, blendIn: 0.1, blendOut: 0.3 };
/**
 * Snapped off: no quiver, the arrow is on the string already; the bow never brought up to full height but loosed low and
 * a little canted from a crouch, drawn only to the chest and let go the moment it is there.
 */
const QUICK_SHOT: Shot = { nock: 0.12, anchor: 0.32, aim: 76, kick: 6, depth: 100, side: -30, lean: -7, quiver: false, cant: 16 };

/* ---- Aimed Shot ---------------------------------------------------------------------------- */

const AIMED_T = { secs: 1.5, release: 0.66 };
/** The full draw to the cheek, held: the arrow fetched, drawn, and then the body still for a third of the cast while the crosshair closes. */
const AIMED_SHOT: Shot = { nock: 0.22, anchor: 0.33, aim: 90, kick: 1, depth: 142, side: -50, lean: 3, quiver: true };

/* ---- Long Shot ------------------------------------------------------------------------------ */

const LONG = fxOf('archer_long_shot');
const LONG_T = { secs: 1.35, release: 0.6 };
/** Lofted: the bow arm high, the body leant back from the hips to get under it, the weight on the back foot. */
const LONG_SHOT: Shot = { nock: 0.22, anchor: 0.42, aim: 122, kick: 6, depth: 138, side: -46, lean: 12, quiver: true };

/* ---- Crippling Shot ------------------------------------------------------------------------- */

const CRIPPLE = fxOf('archer_crippling_shot');
const CRIPPLE_T = { secs: 1.2, release: 0.58, blendIn: 0.16 };
/** From a knee, aimed low at the legs. */
const CRIPPLE_SHOT: Shot = { nock: 0.3, anchor: 0.44, aim: 74, kick: 4, depth: 136, side: -44, lean: -4, quiver: false, kneel: 1 };

/* ---- Point Blank ---------------------------------------------------------------------------- */

const BLANK = fxOf('archer_point_blank');
const BLANK_T = { secs: 0.75, release: 0.42, blendIn: 0.08 };
/** From the hip: a short sharp draw to the chest, the bow low at a creature at arm's length, and a step back on the loose. */
const BLANK_SHOT: Shot = { nock: 0.12, anchor: 0.32, aim: 70, kick: 18, depth: 96, side: -42, lean: 6, quiver: false, cant: 24 };

/* ---- Twin Arrows ---------------------------------------------------------------------------- */

const TWIN = fxOf('archer_twin_arrows');
const TWIN_T = { secs: 1.2, release: 0.6 };
/** Two arrows fetched together, nocked together, drawn a little wider. */
const TWIN_SHOT: Shot = { nock: 0.28, anchor: 0.44, aim: 90, kick: 5, depth: 134, side: -44, lean: 0, quiver: true };

/** Twin Arrows' time in the air, and the beat in seconds the second lands after the first. */
const twinTravel = shotTravel(0.042, 0.06);
const TWIN_LAG = 0.07;

/**
 * Where each of Twin Arrows' pair goes in -- a hand apart across the line,
 * one high and one low -- and the way it comes in from, the line from the
 * bow to it tipped as its own arc has it.
 */
function twinWay(k: FxScene, i: number): { to: P3; d: V } {
  const from = k.once('from', () => muzzle(k)), at = k.heart(k.target);
  const d = dirOf(from, at), across: V = unit([-d[1], d[0], 0]);
  const s = TWIN.arrows > 1 ? (i / (TWIN.arrows - 1)) * 2 - 1 : 0;
  const to = along(along(at, across, 1.4 * s), [0, 0, 1], s < 0 ? 1 : -0.6);
  return { to, d: unit(add(d, [0, 0, 1], s < 0 ? -0.15 : 0.1)) };
}

/**
 * One of Twin Arrows' pair `v` of the way: one climbing higher and bowed out
 * to one side, the other flatter and out to the other, apart most at the
 * middle of the way -- by a share of the range up to a few strides at most,
 * so far off they still read as a pair -- and together again at the end.
 */
function twinFlight(k: FxScene, i: number, v: number): void {
  if (v <= 0 || v >= 1) return;
  const from = k.once('from', () => muzzle(k)), { to } = twinWay(k, i);
  const d = dirOf(from, to), across: V = unit([-d[1], d[0], 0]);
  const s = TWIN.arrows > 1 ? (i / (TWIN.arrows - 1)) * 2 - 1 : 0;
  const lift = 2 + Math.min(k.dist, 4) * (1.3 + 1.5 * s);
  flight(k, from, to, v, lift, { trail: 0.2, width: 1.8, glow: 0.5, side: across, wide: s * Math.min(3 + k.dist * 1.5, 7) });
}

/* ---- Pinning Shot --------------------------------------------------------------------------- */

const PIN_T = { secs: 1.1, release: 0.55 };
/** A heavy shot driven down: a lunge in onto the front foot, the bow pitched down at the creature's feet, the whole body leaning over it. */
const PIN_SHOT: Shot = { nock: 0.18, anchor: 0.4, aim: 72, kick: 2, depth: 140, side: -42, lean: -12, quiver: true };

/* ---- Snipe ---------------------------------------------------------------------------------- */

const SNIPE_T = { secs: 2.0, release: 0.74, blendOut: 0.2 };
/** Low and long: the stance wide, the head down along the arrow, the deepest draw and the longest hold. */
const SNIPE_SHOT: Shot = { nock: 0.2, anchor: 0.36, aim: 89, kick: 2, depth: 146, side: -54, lean: -2, quiver: true };

/* ---- Read the Wind, Deadeye, Expose, Decoy (the craft without a shot) ------------------------- */

const WIND_T = { secs: 1.35, release: 0.56 };
const EXPOSE_T = { secs: 0.95, release: 0.46 };
const DECOY = fxOf('archer_decoy');
const DECOY_T = { secs: 1.05, release: 0.5 };
/** Seconds the decoy's arrow is in the air from the hand to where the decoy rises: long enough to be followed there. */
const DECOY_FLING = 0.32;
const DEADEYE = fxOf('archer_deadeye');
const DEADEYE_T = { secs: 1.25, release: 0.56 };

/** A place given from the chest's joint (the trunk standing straight), in the body's frame `Rig.reach` takes. */
const CHEST_AT = SPINE_AT + BODY.chest;
const fromChest = (x: number, y: number, z: number): V => [x, y, CHEST_AT + z];
/** A hand's goal that comes in over the start of a cast and goes over its end: `w` keyed nought, one from `on` to `off`, nought. */
const goal = (at: V, t: number, on: number, off: number, o: { pole?: V; haft?: V; stoop?: boolean } = {}) => ({ at, w: one(t, [[0, 0], [on, 1], [off, 1], [1, 0]]), ...o });

/**
 * Read the Wind: the bow let down, the right hand lifted out to the side
 * above the head, open and palm to the air, the head turned up to it; then
 * the hand drawn slowly across in front of the face, the head following it,
 * and closed into a fist on the release -- the wind caught -- and brought to
 * the chest.
 */
const windPose: CastPose = (r, t, c) => {
  const rel = c.timing.release;
  const up = rel * 0.4, across = rel * 0.92, chest = rel + (1 - rel) * 0.35;
  r.reach = [
    // The bow let down by the left side out of the way.
    goal(fromChest(-2.9, 1.0, -2.8), t, up, chest, { pole: [-1, -0.2, -0.3] }),
    // Up and out at the side, held there feeling the air, drawn across before the face, closed, and to the chest.
    goal(placeAt(t, [[0, fromChest(4.4, 1.4, 2.0)], [up, fromChest(5.3, 1.5, 4.1)], [rel * 0.66, fromChest(5.0, 2.1, 4.4)], [across, fromChest(0.4, 3.0, 3.3)], [rel, fromChest(-0.6, 2.8, 3.0)], [chest, fromChest(0.5, 1.5, 1.0)]]), t, up * 0.7, chest, { pole: [1, -0.2, -1] }),
  ];
  // Open and flat, palm up to the air, through the reach and the sweep; a fist from the release.
  r.shape = [undefined, { flat: smooth(seg(t, 0.06, up)) * (1 - smooth(seg(t, rel - 0.06, rel))) }];
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [up, [-30, 70, -40]], [across, [-20, 50, -20]], [rel, [0, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = t > 0.06 && t < rel;
  r.head = euler(t, [[0, [0, 0, 0]], [up, [14, 4, -34]], [rel * 0.6, [16, 4, -38]], [across, [6, 0, 8]], [rel, [2, 0, 12]], [chest, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.neck = euler(t, [[0, [0, 0, 0]], [up, [6, 0, -10]], [across, [2, 0, 4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [up, [4, 2, -14]], [across, [0, 0, 10]], [rel, [-2, 0, 12]], [chest, [-4, 0, 4]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [up, [2, 0, -4]], [rel, [-2, 0, 4]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [up, [4, 7, -6]], [1, [2, 3, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [up, [-4, 7, 8]], [1, [0, 3, 0]]]);
  r.knee[0] = one(t, [[0, 4], [up, 8], [rel, 12], [1, 5]]);
  r.knee[1] = one(t, [[0, 4], [up, 6], [rel, 10], [1, 5]]);
};

/** Expose's lean into the point, at the release: the trunk turned to the right and over forward, as the pose below has it. */
const EXPOSE_TURN = -22, EXPOSE_LEAN = -22;

/**
 * Expose: a hunter showing where to hit. The bow let down to the side; the
 * right arm drawn back across the body, then flung straight out at the
 * creature, the forefinger out, the body leaning after it and a foot forward,
 * the head thrust forward along the arm -- and a short sharp flick of the
 * hand at the end, there.
 */
const exposePose: CastPose = (r, t, c) => {
  const rel = c.timing.release;
  // The wind-up the first three-fifths to the release, the point held to most of the way through the recovery.
  const back = rel * 0.62, flick = rel + (1 - rel) * 0.14, hold = rel + (1 - rel) * 0.85;
  // Pointing: from the right shoulder, where the turn and the lean have put it, straight at the creature ahead and a hair over level.
  const at = add(shoulderOf(1, EXPOSE_TURN, EXPOSE_LEAN, 0), unit([0, 1, 0.12]), ARM);
  r.reach = [
    // The bow hand drops back and out of the way as the body turns into the point.
    goal(placeAt(t, [[0, fromChest(-2.9, 1.2, -2.6)], [back, fromChest(-2.6, 1.6, -2.4)], [rel, fromChest(-3.0, -0.6, -2.6)]]), t, back * 0.6, hold, { pole: [-1, -0.2, -0.3] }),
    // Drawn back across the body to the left shoulder, then flung out straight at it.
    goal(placeAt(t, [[0, fromChest(1.2, 1.4, 0.4)], [back, fromChest(-1.8, 0.6, 2.8)], [rel, at], [flick, add(at, [0, 0.2, -0.5])], [hold, at]]), t, back * 0.6, hold, { pole: [0.5, 0, -1] }),
  ];
  r.shape = [undefined, { point: smooth(seg(t, back, rel)) }];
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [back, [10, 0, 0]], [rel, [-6, 0, 0]], [flick, [-28, 0, 0]], [hold, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [back, [6, 0, 30]], [rel, [EXPOSE_LEAN * 0.4, 0, EXPOSE_TURN * 0.7]], [hold, [EXPOSE_LEAN * 0.3, 0, EXPOSE_TURN * 0.6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [back, [5, 0, 10]], [rel, [EXPOSE_LEAN * 0.6, 0, EXPOSE_TURN * 0.3]], [hold, [EXPOSE_LEAN * 0.5, 0, EXPOSE_TURN * 0.25]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [back, [-4, 0, -20]], [rel, [-10, 0, 14]], [hold, [-8, 0, 12]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [back, [-2, 3, 0]], [rel, [26, 4, 0]], [hold, [24, 4, 0]], [1, [4, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [rel, 24], [hold, 22], [1, 6]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [rel, [-12, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [back, 10], [rel, 8], [1, 5]]);
};

/** The end of the right forefinger, pointing: out past the middle of the hand along it. */
const fingertip = (k: FxScene): P3 => k.joint(k.caster, 'wrist1', [0, 0, -1.7], 0.6);

/** Where Decoy's arrow leaves the hand, in the body's frame: out to the right and low, flung from the bottom of a lunge. */
const DECOY_TOSS: V = [4.0, 3.0, 6.5];

/**
 * Both feet put down `left` and `right` units off where each stands (right, ahead, lift), the legs solved to them
 * from the hips, the weight `on` (minus one the left, one the right) on a leg bent `bend` degrees: a lunge or a wide
 * stance with the feet staying where they are put. Not on the move, where the walk keeps its own legs.
 */
function plant(r: Rig, c: PoseCue, left: V, right: V, on: number, bend: number): void {
  if (c.moving) return;
  const s = figureStance(c.look);
  standFeet(r, [[s[0][0] + left[0], s[0][1] + left[1], s[0][2] + left[2]], [s[1][0] + right[0], s[1][1] + right[1], s[1][2] + right[2]]], { on, bend, look: c.look });
}

/**
 * Decoy: an arrow fetched from over the shoulder, swung back low past the
 * hip, and flung underhand out to the right from the bottom of a lunge over
 * the right knee -- the trunk let down with the legs, not folded over them --
 * and followed up and out, the body rising back out of the lunge as the
 * arrow lands a stride off and the decoy springs up where it went in.
 */
const decoyPose: CastPose = (r, t, c) => {
  const rel = c.timing.release;
  const fetch = rel * 0.35, wind = rel * 0.75, down = rel, through = rel + (1 - rel) * 0.22, away = rel + (1 - rel) * 0.6;
  const R = shoulderOf(1, 0, 0, 0);
  r.reach = [
    goal(placeAt(t, [[0, fromChest(-2.9, 1.0, -2.8)], [down, fromChest(-2.6, 1.6, -3.2)], [away, fromChest(-2.4, 2.0, -1.4)]]), t, fetch, away, { pole: [-1, -0.2, -0.4] }),
    // Up over the shoulder for it, swung back low past the hip, flung out and down to the right, and followed up and out.
    goal(placeAt(t, [[0, add(R, [0.4, 0.8, -3.4])], [fetch, add(R, [-0.5, -1.0, 2.3])], [wind, add(R, [1.6, -2.4, -6.5])], [down, DECOY_TOSS], [through, add(DECOY_TOSS, [1.0, 1.6, 3.2])], [away, add(R, [0.8, 1.2, -3.0])]]), t, fetch * 0.6, away, { pole: [1, -0.4, -0.2] }),
  ];
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [fetch, [-10, 0, 0]], [wind, [-30, 0, 0]], [down, [30, 0, 0]], [through, [10, 0, 0]], [away, [0, 0, 0]]]);
  r.open[1] = t > down && t < away;
  // The trunk goes down with the hips and leans out after the hand, no more than a third of the way to level.
  r.spine = euler(t, [[0, [0, 0, 0]], [fetch, [4, 0, 0]], [wind, [-4, 2, 10]], [down, [-14, -8, -4]], [through, [-8, -6, -8]], [away, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [fetch, [4, 0, -10]], [wind, [0, 0, 14]], [down, [-10, -6, -14]], [through, [-4, -4, -16]], [away, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [fetch, [-4, 0, 0]], [wind, [-8, 0, -20]], [down, [-14, 0, -30]], [through, [-6, 0, -34]], [away, [4, 0, -10]], [1, [0, 0, 0]]]);
  // The lunge: the right foot stepped out to the right and ahead and the weight let down onto it, the left long behind; and back.
  const g = one(t, [[0, 0], [wind * 0.8, 0], [down, 1], [through, 1], [away, 0]]);
  const step = 1.6 * (Math.sin(Math.PI * seg(t, wind * 0.8, down)) + Math.sin(Math.PI * seg(t, through, away)));
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [1, [2, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [1, [0, 2, 0]]]);
  plant(r, c, [-0.4 * g, -1.6 * g, 0], [3.6 * g, 3.2 * g, step], 0.8 * g, 8 + 40 * g);
};

/**
 * Deadeye: the bow taken up and stood upright before the face and the brow
 * lowered to it, the draw hand's two fingers to the brow beside the eye -- a
 * breath held -- then the head snapping up and the bow swept out and down to
 * the side, ready.
 */
const deadeyePose: CastPose = (r, t, c) => {
  const rel = c.timing.release;
  const up = rel * 0.45, out = rel + (1 - rel) * 0.3;
  r.wieldBow = 1;
  r.reach = [
    goal(placeAt(t, [[0, fromChest(-2.6, 1.6, -1.6)], [up, fromChest(-0.3, 2.7, 1.6)], [rel, fromChest(-0.3, 2.6, 1.7)], [out, fromChest(-3.7, 2.2, -0.6)]]), t, up * 0.6, out + (1 - out) * 0.5,
      { pole: [-1, -0.3, -0.6], haft: unit([-0.6 * smooth(seg(t, rel, out)), 0.15, 1]) }),
    goal(placeAt(t, [[0, fromChest(2.4, 1.0, -2.6)], [up, fromChest(0.6, 1.4, 3.6)], [rel, fromChest(0.6, 1.3, 3.7)], [out, fromChest(2.7, 1.2, -1.4)]]), t, up * 0.6, out, { pole: [1, -0.2, -0.6] }),
  ];
  r.shape = [undefined, { two: smooth(seg(t, up * 0.5, up)) * (1 - smooth(seg(t, rel, out))) }];
  r.head = euler(t, [[0, [0, 0, 0]], [up, [-11, 0, 0]], [rel, [-13, 0, 0]], [out, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.neck = euler(t, [[0, [0, 0, 0]], [up, [-4, 0, 0]], [out, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [up, [-6, 0, 0]], [rel, [-7, 0, 0]], [out, [6, 0, -6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [up, [-4, 0, 0]], [out, [3, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [up, [4, 6, 0]], [out, [6, 8, -6]], [1, [2, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [up, [-2, 6, 0]], [out, [-6, 8, 10]], [1, [0, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [up, 10], [rel, 12], [out, 6], [1, 4]]);
  r.knee[1] = one(t, [[0, 4], [up, 10], [rel, 12], [out, 6], [1, 4]]);
};

/* ---- the effects shared ------------------------------------------------------------------- */

/** A puff of leaves, tumbling: spinning green shards, light on the air. */
function leaves(k: FxScene, at: P3, n: number, o: { heading?: { x: number; y: number }; cone?: number; speed?: [number, number]; up?: [number, number]; life?: [number, number] } = {}): void {
  k.burst(at, n, { kind: 'shard', colour: LEAVES, size: 1.5, sizeEnd: 1.2, life: o.life ?? [0.6, 1.2], speed: o.speed ?? [0.3, 0.9], up: o.up ?? [4, 14], heading: o.heading, cone: o.cone, gravity: 9, drag: 0.15, spin: 2.2, jitter: 0.08 });
}

/**
 * A count of seconds round a spot on the ground, read as one dial: a thin ink
 * ring with a wedge standing out of it for each part of the time, the ones
 * still to come lit in `colour`, the spent ones dark -- and the wedge being
 * spent drawing in to the ring over its own part, so the count runs down
 * smoothly rather than a tick at a time. A wedge a second up to twelve, ten
 * for a longer count. At night the lit wedges and the ring give light.
 */
function countdown(k: FxScene, b: { x: number; y: number }, r: number, secs: number, age: number, alpha: number, colour = GOLD, light = WARM): void {
  if (alpha <= 0.01 || secs <= 0) return;
  const z = k.zoom;
  const ticks = secs <= 12 ? Math.max(1, Math.round(secs)) : 10;
  const gone = clamp(age / secs) * ticks;
  const r0 = r * 0.8, half = (Math.PI / ticks) * 0.46;
  const lit: number[][] = [], dim: number[][] = [];
  for (let i = 0; i < ticks; i++) {
    const an = -Math.PI / 2 + ((i + 0.5) / ticks) * TAU;
    // The one being spent draws in to the ring as its part of the time goes.
    const out = i < Math.floor(gone) ? r : i === Math.floor(gone) ? lerp(r, r0 + (r - r0) * 0.15, gone - i) : r;
    const wedge = (R: number): number[] => {
      const a0 = an - half, a1 = an + half, a0i = an - half * 0.7, a1i = an + half * 0.7;
      return [b.x + Math.cos(a0i) * r0, b.y + Math.sin(a0i) * r0, b.x + Math.cos(a0) * R, b.y + Math.sin(a0) * R,
        b.x + Math.cos(a1) * R, b.y + Math.sin(a1) * R, b.x + Math.cos(a1i) * r0, b.y + Math.sin(a1i) * r0];
    };
    (i < Math.floor(gone) ? dim : lit).push(wedge(out));
  }
  const ring: number[] = [];
  const n = Math.max(18, ticks * 3);
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU;
    ring.push(b.x + Math.cos(an) * r0, b.y + Math.sin(an) * r0);
  }
  k.groundShape(b.x, b.y, r + 0.3, [
    { kind: 'fill', colour: PALETTE.ink, alpha: clamp(alpha * 0.3), paths: dim, lift: 0.2 },
    { kind: 'stroke', colour: PALETTE.ink, alpha: clamp(alpha * 0.75), width: 1.1 * z, paths: [ring], closed: true, join: 'round', lift: 0.2, glow: k.night * 0.5, light },
    { kind: 'fill', colour, alpha: clamp(alpha), paths: lit, lift: 0.2, glow: k.night, light },
    { kind: 'stroke', colour: PALETTE.ink, alpha: clamp(alpha * 0.85), width: Math.max(0.7, 0.6 * z), paths: lit, closed: true, join: 'miter', lift: 0.2 },
  ]);
}

/**
 * Quick Shot's dial: a small clock face beside the archer's head on the side
 * the draw hand is, eight inked ticks round it, the swept part of the face
 * filled in gold and a gold needle sweeping from twelve once round as `u`
 * goes nought to one. Held in screen space beside the head so it is never
 * over the face or lost against the body, whichever way the archer stands.
 */
function quickDial(k: FxScene, u: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const b = k.caster, z = k.zoom, head = k.head();
  // Beside the head on the draw shoulder's side of the screen; to the right when that shoulder is toward or away from the viewer.
  const sh = k.local(b, 4, 0, b.tall * 0.8), side = k.sx(sh) - k.sx(b);
  const s = Math.abs(side) < 1.5 * z ? 1 : Math.sign(side);
  const R = 6 * z * (1 + 0.15 * bump(u, 0.9, 0.97, 1));
  const x = k.sx(head) + s * 12 * z, y = k.sy(head) - 4 * z;
  const top = -Math.PI / 2, now = top + u * TAU;
  const paint = (g: CanvasRenderingContext2D): void => {
    const a = g.globalAlpha;
    // The face, a dark disc to read the gold against, and the time gone filled in as a wedge.
    g.fillStyle = PALETTE.ink;
    g.globalAlpha = a * 0.5;
    g.beginPath();
    g.arc(x, y, R, 0, TAU);
    g.fill();
    g.globalAlpha = a * 0.65;
    g.fillStyle = GOLD;
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, R * 0.9, top, now);
    g.closePath();
    g.fill();
    g.globalAlpha = a;
    // The rim: a thin gold hoop over ink, so it reads as a face and not a burst.
    g.strokeStyle = PALETTE.ink;
    g.lineWidth = 1.6 * z * 0.6;
    g.beginPath();
    g.arc(x, y, R, 0, TAU);
    g.stroke();
    g.strokeStyle = GOLD_DEEP;
    g.lineWidth = 0.7 * z * 0.6;
    g.stroke();
    // Eight ticks round the rim, ink under gold; the one at twelve longer.
    g.lineCap = 'butt';
    for (const [w, c] of [[2.2, PALETTE.ink], [1.1, GOLD]] as const) {
      g.strokeStyle = c;
      g.lineWidth = w * z * 0.6;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const an = top + (i / 8) * TAU, r0 = i ? R * 0.72 : R * 0.55;
        g.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0);
        g.lineTo(x + Math.cos(an) * R * 1.05, y + Math.sin(an) * R * 1.05);
      }
      g.stroke();
    }
    // The needle, from the hub to the rim.
    g.lineCap = 'round';
    for (const [w, c] of [[2.6, PALETTE.ink], [1.3, GOLD]] as const) {
      g.strokeStyle = c;
      g.lineWidth = w * z * 0.6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(now) * R * 0.95, y + Math.sin(now) * R * 0.95);
      g.stroke();
    }
    g.fillStyle = PALETTE.core;
    g.beginPath();
    g.arc(x, y, 0.9 * z, 0, TAU);
    g.fill();
    g.lineCap = 'butt';
  };
  k.worldDraw(sh, (g) => {
    g.globalAlpha = clamp(0.95 * alpha);
    paint(g);
  }, 24);
  overNight(k, alpha, paint);
}

/* ---- the spells --------------------------------------------------------------------------- */


export const ARCHER: Record<string, SpellVisual> = {
  /*
   * Quick Shot: snapped off. No quiver and no hold -- the arrow already on
   * the string, the bow kept low and canted, drawn to the chest and gone in
   * a little over half a second, the quickest cast the trade has. A lean
   * arrow on a flat line with a long pale streak that snaps shut behind it,
   * and on the loose a gold dial by the archer's head, its needle sweeping
   * once round from twelve in the second the next draw is brought forward by.
   */
  archer_quick_shot: {
    palette: PALETTE,
    cast: { timing: QUICK_T, pose: shotWith(QUICK_SHOT) },
    fx: {
      charge: (k, t) => {
        bowCharge(k, t, QUICK_SHOT, QUICK_T.release);
      },
      release: (k) => {
        const d = aimOf(k);
        k.once('from', () => muzzle(k));
        k.burst(muzzle(k), 5, { kind: 'spark', size: 1.4, life: [0.1, 0.2], speed: [0.6, 1.2], up: [0, 6], heading: { x: d[0], y: d[1] }, cone: 0.7, gravity: 0 });
      },
      travel: {
        secs: shotTravel(0.035, 0.05),
        draw: (k, u) => {
          const from = muzzle(k), to = k.heart(k.target);
          // A snap: thin, pale and long-streaked, unlike the heavier shots' green ribbons.
          flight(k, from, to, u, k.dist * 0.5, { trail: 0.45, width: 1.2, main: PALETTE.light, core: PALETTE.core, glow: 0.3, long: 1 });
        },
      },
      hit: (k) => {
        const d = keepWay(k, muzzle(k), k.heart(k.target));
        strike(k, k.heart(k.target), d, 0.8);
      },
      impact: {
        secs: 0.55,
        draw: (k, u) => {
          const at = k.heart(k.target);
          stuck(k, at, keptWay(k), 1 - seg(u, 0.6, 1), 0.3, undefined, 1.2);
          k.flare(at, 6 * (1 - u), flashOf(u, 0.08), PALETTE.core, 0.4);
          // The streak it left, snapping shut on the creature from the bow end.
          const from = k.once('from', () => muzzle(k)), e = easeOut(seg(u, 0, 0.3));
          if (e < 1) k.beam(mid3(from, at, 0.35 + 0.65 * e), at, { width: 1.1 * (1 - e), alpha: 0.7 * (1 - e), main: PALETTE.light, core: PALETTE.core, glow: 0.3 });
        },
      },
      // The next draw a second sooner: a dial by the head, its needle once round in that second.
      linger: {
        secs: QUICK.sooner,
        on: 'caster',
        draw: (k, age, left) => {
          const secs = age + left;
          const u = clamp(age / secs);
          quickDial(k, u, smooth(age / 0.08) * smooth(left / 0.12));
        },
      },
    },
  },

  /*
   * Aimed Shot: the arrow fetched from the quiver, drawn to the cheek and
   * held -- the body still for a third of the cast while a gold crosshair
   * closes on the creature and locks. Loosed, it flies dead straight down the
   * line it was aimed along, gold-fletched, and the crosshair snaps shut on
   * it as it goes in: a shot that cannot miss.
   */
  archer_aimed_shot: {
    palette: PALETTE,
    cast: { timing: AIMED_T, pose: shotWith(AIMED_SHOT, (r, t, rel) => {
      // At the anchor the breath let half out and held: the shoulders settle a hair, the cheek comes down to the hand, and the
      // body is still for half a second, the bow arm locked dead level.
      const hold = smooth(seg(t, AIMED_SHOT.anchor, AIMED_SHOT.anchor + 0.06)) * (1 - smooth(seg(t, rel, rel + 0.08)));
      r.chest[0] -= 2 * hold;
      r.head[0] -= 4 * hold;
      r.neck[0] -= 3 * hold;
    }) },
    fx: {
      charge: (k, t) => {
        const rel = AIMED_T.release;
        bowCharge(k, t, AIMED_SHOT, rel, { fletch: GOLD });
        // The crosshair coming in from wide and turned, to tight and square, then held locked until the arrow lands.
        const close = smooth(seg(t, AIMED_SHOT.anchor - 0.08, rel - 0.06));
        const on = smooth(seg(t, AIMED_SHOT.nock, AIMED_SHOT.anchor));
        if (on > 0) {
          const locked = t > rel - 0.06;
          crosshair(k, k.heart(k.target), lerp(18, 7, close), { alpha: on * (locked ? 1 : 0.75), turn: (1 - close) * 0.8, size: 3 });
        }
      },
      release: (k) => {
        const d = aimOf(k);
        k.burst(muzzle(k), 6, { kind: 'mote', colour: [GOLD, PALETTE.core], size: 1.6, life: [0.15, 0.3], speed: [0.4, 1], up: [0, 6], heading: { x: d[0], y: d[1] }, cone: 0.5, gravity: 0, over: true });
      },
      travel: {
        secs: shotTravel(0.04, 0.04),
        draw: (k, u) => {
          const from = muzzle(k), to = k.heart(k.target);
          // Straight: down the sight line, no drop -- a gold thread laid ahead of it to where it is going.
          k.beam(mid3(from, to, u), to, { width: 0.8, alpha: 0.35 * (1 - u), main: GOLD, core: PALETTE.core, glow: 0.3 });
          flight(k, from, to, u, 0, { trail: 0.35, width: 1.8, fletch: GOLD, main: GOLD, glow: 0.7 });
          crosshair(k, to, 7, { alpha: 1, size: 3 });
        },
      },
      hit: (k) => {
        const at = k.heart(k.target);
        const d = keepWay(k, muzzle(k), at);
        strike(k, at, d, 1.1, GOLD);
      },
      impact: {
        secs: 0.7,
        draw: (k, u) => {
          const at = k.heart(k.target);
          stuck(k, at, keptWay(k), 1 - seg(u, 0.7, 1), 0.32, GOLD, 1.3);
          // The crosshair snapping shut on the arrow, and gone.
          const snap = easeOut(seg(u, 0, 0.25));
          crosshair(k, at, lerp(7, 2, snap), { alpha: 1 - seg(u, 0.25, 0.6), size: 3 + snap });
          // A glint, not a blaze: the creature and the gold-fletched arrow stay in sight.
          k.flare(at, 7 * (1 - u), flashOf(u, 0.06), PALETTE.core, Math.PI / 4);
          k.light(at, 1, 0.45 * (1 - u), WARM);
        },
      },
    },
  },

  /*
   * Read the Wind: no shot. The bow let down, the hand up and open to the
   * air, drawn across in front of the face and closed on it. Streamers of
   * wind and leaves come in round the archer from one side, wind round the
   * body, and are caught into the closed fist with a gold glint. After that, a
   * telltale -- the scrap of yarn an archer ties to a bow tip to read the air
   * -- flies from the top of the bow, gold, for as long as the next shot is
   * sure, and comes off when it is spent.
   */
  archer_read_the_wind: {
    palette: PALETTE,
    cast: { timing: WIND_T, pose: windPose },
    fx: {
      charge: (k, t) => {
        const rel = WIND_T.release;
        const b = k.caster;
        const g = smooth(seg(t, 0.04, rel * 0.7)) * (1 - smooth(seg(t, rel - 0.04, rel + 0.08)));
        if (g <= 0) return;
        // Three streamers coming round the body, each a turn of a helix that winds in tighter and higher as the hand closes.
        const pull = smooth(seg(t, rel * 0.5, rel));
        for (let s = 0; s < 3; s++) {
          const pts: P3[] = [];
          const a0 = k.now * 2.6 + s * (TAU / 3);
          const R = lerp(0.24, 0.13, pull) * (1 + 0.15 * s);
          for (let i = 0; i < 9; i++) {
            const an = a0 - i * 0.32;
            const h = b.tall * (0.25 + 0.16 * s + 0.05 * i * (1 - pull)) + 3 * Math.sin(k.now * 3 + i * 0.7 + s);
            pts.push({ x: b.x + Math.cos(an) * R, y: b.y + Math.sin(an) * R, z: b.z + h });
          }
          pts.reverse();
          wrap(k, b, pts, { width: 2.2 - 0.4 * s, alpha: 0.7 * g, main: LEAVES[s], core: PALETTE.core, glow: 0.3 });
        }
        if (!k.fast) {
          const side = k.local(b, 14, 2, b.tall * 0.6);
          k.emit(side, 10 * g, { kind: 'shard', colour: LEAVES, size: 1.4, life: [0.5, 0.9], speed: [0.4, 0.8], up: [-2, 6], heading: k.toward(side, b), cone: 0.9, gravity: 3, drag: 0.4, spin: 2.4, jitter: 0.25 });
        }
      },
      release: (k) => {
        const h = k.hand(1);
        k.burst(h, 10, { kind: 'mote', colour: [GOLD, PALETTE.core], size: 1.8, life: [0.25, 0.5], speed: [0.2, 0.6], up: [2, 12], gravity: 0, over: true });
        leaves(k, h, 6, { speed: [0.3, 0.7], up: [4, 12] });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const h = k.hand(1);
          k.flare(h, 8 * (1 - u), flashOf(u, 0.1), GOLD, u * 1.5, GOLD, true);
          // The wind caught: gusts in leaf green curling in over the grass to the feet, drawn in from a stride out.
          gusts(k, k.caster, u);
        },
      },
      linger: {
        draw: (k, age, left) => {
          // The telltale, burning short as the time to use it runs out.
          telltale(k, age, left, smooth(age / 0.5) * smooth(left / 1));
        },
      },
    },
  },

  /*
   * Long Shot: lofted. The bow arm raised high and the body leant back under
   * it, judging the distance: a dotted arc is laid out from the bow to the
   * creature while the hand holds at the anchor. Loosed, the arrow climbs
   * that arc, slower than a flat shot and high over the ground in proportion
   * to the range, its path left behind it in a fading dotted line, and comes
   * down steep into the creature.
   */
  archer_long_shot: {
    palette: PALETTE,
    cast: { timing: LONG_T, pose: shotWith(LONG_SHOT, (r, t, rel) => {
      // The weight sat back on the back foot under the lofted bow, and given forward on the loose.
      const back = smooth(seg(t, LONG_SHOT.nock, LONG_SHOT.anchor)) * (1 - smooth(seg(t, rel, 1)));
      r.knee[1] += 14 * back;
      r.leg[1][0] -= 6 * back;
      r.leg[0][0] += 8 * back;
    }) },
    fx: {
      charge: (k, t) => {
        const rel = LONG_T.release;
        bowCharge(k, t, LONG_SHOT, rel);
        // The arc judged: chevrons laid out along it from the bow, outward, while the hand holds.
        const lay = smooth(seg(t, LONG_SHOT.anchor - 0.06, rel - 0.04));
        if (lay <= 0 || k.released >= 0) return;
        dottedArc(k, longPath(k, muzzle(k), k.heart(k.target)), 0, lay, 0.6);
      },
      release: (k) => {
        k.once('from', () => muzzle(k));
        k.burst(muzzle(k), 6, { kind: 'mote', size: 1.5, life: [0.2, 0.4], speed: [0.2, 0.5], up: [6, 16], gravity: 0 });
      },
      travel: {
        // Slower than a flat shot: it goes up and comes down.
        secs: shotTravel(0.05, 0.12),
        draw: (k, u) => {
          const from = k.once('from', () => muzzle(k)), to = k.heart(k.target), path = longPath(k, from, to);
          // The judged arc still laid out ahead of it and eaten behind it as it climbs and falls along it.
          dottedArc(k, path, Math.max(0, u - 0.4), 1, 0.6);
          flight(k, from, to, u, 0, { trail: 0.12, width: 2, glow: 0.6, path });
        },
      },
      hit: (k) => {
        const at = k.heart(k.target);
        const from = k.once('from', () => muzzle(k));
        const d = keepWay(k, longPath(k, from, at)(0.96), at);
        strike(k, at, d, 1);
        k.burst(k.at(k.target, 0.02), 10, { kind: 'dust', colour: '#8a7a62', size: 3, life: [0.4, 0.8], speed: [0.2, 0.6], up: [2, 9], gravity: 3 });
      },
      impact: {
        secs: 0.75,
        draw: (k, u) => {
          const at = k.heart(k.target);
          stuck(k, at, keptWay(k), 1 - seg(u, 0.7, 1), 0.34, undefined, 1.25);
          // The last of the arc going out from the top down.
          const from = k.once('from', () => muzzle(k));
          dottedArc(k, longPath(k, from, at), Math.min(1, 0.6 + u * 0.6), 1, 0.6 * (1 - u));
          k.flare(at, 8 * (1 - u), flashOf(u, 0.08));
          // Where it came down, a patch of turf scuffed up under the creature: a plunge, not a ripple.
          scuff(k, k.target, easeOut(seg(u, 0, 0.2)), 1 - seg(u, 0.6, 1));
        },
      },
    },
  },

  /*
   * Crippling Shot: from one knee, the bow low, aimed at the legs. The arrow
   * dips to knee height off the string and skims in over the grass, throwing
   * a line of leaves up under it, and takes the creature by the leg. What it
   * leaves is a hobble, not a hold: a vine or two wound low round the legs,
   * drag lines scuffed in the turf behind it, the arrow standing in its leg,
   * dust off its feet at half its pace -- and the eight seconds of the slow
   * counted down in green wedges round its feet.
   */
  archer_crippling_shot: {
    palette: PALETTE,
    cast: { timing: CRIPPLE_T, pose: shotWith(CRIPPLE_SHOT) },
    fx: {
      charge: (k, t) => {
        bowCharge(k, t, CRIPPLE_SHOT, CRIPPLE_T.release);
      },
      release: (k) => {
        k.once('from', () => muzzle(k));
      },
      travel: {
        secs: shotTravel(0.04, 0.04),
        draw: (k, u) => {
          const from = k.once('from', () => muzzle(k)), to = legOf(k), path = lowPath(from, to);
          const head = flight(k, from, to, u, 0, { trail: 0.3, width: 2, glow: 0.5, path, main: PALETTE.deep, core: PALETTE.main });
          // Skimming low: leaves thrown up off the grass under it once it is down to the leg's height.
          if (!k.fast && u > 0.18) k.emit(k.on(head.x, head.y, 0.5), 40, { kind: 'shard', colour: LEAVES, size: 1.8, sizeEnd: 1.2, life: [0.3, 0.6], speed: [0.05, 0.25], up: [5, 12], gravity: 20, drag: 0.3, spin: 2.4, ink: false });
        },
      },
      hit: (k) => {
        const at = legOf(k);
        const d = keepWay(k, lowPath(k.once('from', () => muzzle(k)), at)(0.95), at);
        strike(k, at, d, 0.9);
        leaves(k, k.at(k.target, 0.05), 10, { speed: [0.3, 0.8], up: [6, 16] });
      },
      impact: {
        secs: 0.5,
        draw: (k, u) => {
          k.flare(legOf(k), 7 * (1 - u), flashOf(u, 0.08));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const b = k.target;
          const a = smooth(age / 0.35) * smooth(left / 0.8);
          const grow = easeOut(age / 0.4) * (left < 0.8 ? smooth(left / 0.8) : 1);
          hobble(k, b, grow, a, age);
          stuck(k, legOf(k), keptWay(k), a, 0.15, undefined, 1.3);
          // A little light at the feet at night, so the hobble and its count still read.
          k.light(b, 0.9, 0.3 * a * k.night, PALETTE.light);
          // Hobbling: a scuff of dust off the feet at half its pace -- it drags them for the whole of the slow.
          if (Math.floor(age * 3 * CRIPPLE.pace) !== k.state.scuff) {
            k.state.scuff = Math.floor(age * 3 * CRIPPLE.pace);
            k.burst(k.at(b, 0.02), 3, { kind: 'dust', colour: DIRT, size: 2.2, life: [0.4, 0.7], speed: [0.1, 0.25], up: [1, 4], gravity: 1 });
          }
        },
      },
    },
  },

  /*
   * Point Blank: from the hip at arm's length. A short, hard draw to the
   * chest with the bow held low, and on the loose a step back with the kick.
   * A cone of gold chevrons blasts from the bow, the arrow is across the gap
   * at once, and the creature takes it hard: a bright flare, a shock ring and
   * dust thrown out behind it the way the arrow was going.
   */
  archer_point_blank: {
    palette: PALETTE,
    cast: { timing: BLANK_T, pose: shotWith(BLANK_SHOT, (r, t, rel) => {
      // The step back on the loose: the right foot goes back and takes the weight, the body rocked back by the kick.
      const step = smooth(seg(t, rel, rel + (1 - rel) * 0.3)) * (1 - smooth(seg(t, rel + (1 - rel) * 0.55, 1)));
      r.leg[1][0] -= 18 * step;
      r.knee[1] += 18 * step;
      r.leg[0][0] += 8 * step;
      r.spine[0] += 8 * step;
      r.head[0] += 6 * step;
    }) },
    fx: {
      charge: (k, t) => {
        bowCharge(k, t, BLANK_SHOT, BLANK_T.release);
        // The muzzle: three chevrons thrown from the bow along the shot the moment it goes, opening out and fading in a quarter second.
        const back = (t - BLANK_T.release) * BLANK_T.secs;
        if (back >= 0 && back < 0.25) {
          const v = back / 0.25, m = muzzle(k), d = aimOf(k);
          for (let i = 0; i < 3; i++) crosshairChevron(k, along(m, d, 2.5 + i * 2.6 + v * 5), d, 3.5 + i * 1.4, (1 - v) * (1 - i * 0.22));
        }
      },
      release: (k) => {
        const m = muzzle(k), d = aimOf(k);
        k.burst(m, 18, { kind: 'spark', colour: [GOLD, PALETTE.core], size: 2, life: [0.12, 0.28], speed: [BLANK.reach * 0.6, BLANK.reach * 1.3], up: [-4, 8], heading: { x: d[0], y: d[1] }, cone: 0.9, gravity: 10, drag: 0.05, over: true });
      },
      travel: {
        secs: shotTravel(0.02, 0.03),
        draw: (k, u) => {
          flight(k, muzzle(k), k.heart(k.target), u, 0, { trail: 0.6, width: 3, glow: 0.8 });
        },
      },
      hit: (k) => {
        const at = k.heart(k.target);
        const d = keepWay(k, muzzle(k), at);
        strike(k, at, d, 1.6, GOLD);
        k.burst(k.at(k.target, 0.04), 10, { kind: 'dust', colour: '#8a7a62', size: 3.4, life: [0.4, 0.8], speed: [0.5, 1.1], up: [2, 8], heading: { x: d[0], y: d[1] }, cone: 1.4, gravity: 3, drag: 0.2 });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const at = k.heart(k.target), d = keptWay(k);
          stuck(k, at, d, 1 - seg(u, 0.7, 1), 0.5);
          // A hard glint, up in a frame and going at once, smaller than the creature so it is seen to take it.
          k.flare(at, 9 * (1 - u), flashOf(u, 0.04 / 0.6), PALETTE.core, 0.3);
          k.ring(k.target, 0.1 + 0.26 * easeOut(u), { band: 0.06 * (1 - u) + 0.015, alpha: 0.85 * (1 - u), main: GOLD, deep: GOLD_DEEP, glow: 0.5 });
          k.light(at, 1, 0.5 * (1 - u), WARM);
        },
      },
    },
  },

  /*
   * Twin Arrows: two arrows fetched and nocked together, fanned on the
   * string, the draw hand rolled over to hold the pair. They part as they
   * go, one high and one wide -- never further apart than a few strides,
   * however far the shot -- and close again on the creature, landing a beat
   * apart: two strikes, two arrows left standing in it.
   */
  archer_twin_arrows: {
    palette: PALETTE,
    cast: { timing: TWIN_T, pose: shotWith(TWIN_SHOT, (r, t, rel) => {
      // The draw hand rolled well over to hold the pair on the string, and a little lean into the release.
      const on = bump(t, TWIN_SHOT.nock, TWIN_SHOT.anchor, rel + 0.05);
      r.hand[1][1] += 40 * on;
      r.spine[0] -= 3 * smooth(seg(t, TWIN_SHOT.anchor, rel));
    }) },
    fx: {
      charge: (k, t) => {
        bowCharge(k, t, TWIN_SHOT, TWIN_T.release, { arrows: TWIN.arrows });
      },
      release: (k) => {
        const d = aimOf(k);
        k.once('from', () => muzzle(k));
        k.burst(muzzle(k), 8, { kind: 'mote', size: 1.5, life: [0.15, 0.3], speed: [0.4, 1], up: [0, 6], heading: { x: d[0], y: d[1] }, cone: 1.2, gravity: 0 });
      },
      travel: {
        secs: twinTravel,
        draw: (k, u) => {
          // The first arrow lands at the end of the travel; the second a beat behind it, finished in the impact.
          const T = twinTravel(k.dist);
          for (let i = 0; i < TWIN.arrows; i++) twinFlight(k, i, (u * T - i * TWIN_LAG) / T);
        },
      },
      hit: (k) => {
        const { to, d } = twinWay(k, 0);
        keepWay(k, k.once('from', () => muzzle(k)), k.heart(k.target));
        strike(k, to, d, 0.7);
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const T = twinTravel(k.dist), age = u * 0.8;
          const fade = 1 - seg(u, 0.7, 1);
          for (let i = 0; i < TWIN.arrows; i++) {
            const v = (T + age - i * TWIN_LAG) / T;
            const { to, d } = twinWay(k, i);
            if (v < 1) {
              twinFlight(k, i, v);
              continue;
            }
            // In: its own strike and glint the moment it lands, and standing in it the way it came.
            const since = (v - 1) * T;
            if (!k.state[`in${i}`] && i > 0) {
              k.state[`in${i}`] = 1;
              strike(k, to, d, 0.7);
            }
            stuck(k, to, d, fade, 0.3, undefined, 1.15);
            k.flare(to, 7 * (1 - seg(since, 0, 0.35)), flashOf(clamp(since / 0.35), 0.15), PALETTE.core, i * 0.6);
          }
        },
      },
    },
  },

  /*
   * Pinning Shot: a heavy shot driven down -- a lunge in onto the front foot
   * and the bow pitched down at the creature's feet. The arrow goes in, and
   * three ghost arrows strike down out of the air into the ground in a
   * triangle round its feet, a gold line pegged out between them; taut lines
   * run from each stake's nock to the side of the creature nearest it and
   * hold it there, trembling, for as long as it is held -- and when it is let
   * go they break, each whipping back in two halves to its stake and its
   * creature, and the stakes go.
   */
  archer_pinning_shot: {
    palette: PALETTE,
    cast: { timing: PIN_T, pose: shotWith(PIN_SHOT, (r, t, rel, c) => {
      // Driven down into the loose, and a lunge in onto the front foot under it, the hips let down over the bent knee.
      const drive = bump(t, rel - 0.08, rel + 0.04, rel + 0.3);
      r.spine[0] -= 6 * drive;
      stepIn(r, t, c, { hit: PIN_SHOT.anchor, from: PIN_SHOT.nock, back: rel + (1 - rel) * 0.45, most: 3, bend: 30 });
    }) },
    fx: {
      charge: (k, t) => {
        bowCharge(k, t, PIN_SHOT, PIN_T.release);
      },
      release: (k) => {
        k.once('from', () => muzzle(k));
      },
      travel: {
        secs: shotTravel(0.04, 0.05),
        draw: (k, u) => {
          // Heavier than the others: a broad dark ribbon behind a gold-fletched arrow, coming down on its mark.
          flight(k, k.once('from', () => muzzle(k)), k.heart(k.target), u, k.dist * 0.4, { trail: 0.25, width: 2.8, glow: 0.4, fletch: GOLD, main: PALETTE.deep, core: PALETTE.main });
        },
      },
      hit: (k) => {
        const at = k.heart(k.target);
        strike(k, at, keepWay(k, k.once('from', () => muzzle(k)), at), 1);
        k.burst(k.at(k.target, 0.02), 10, { kind: 'dust', colour: '#8a7a62', size: 2.8, life: [0.4, 0.7], speed: [0.3, 0.7], up: [2, 6], gravity: 2 });
      },
      impact: {
        secs: 0.5,
        draw: (k, u) => {
          k.flare(k.heart(k.target), 8 * (1 - u), flashOf(u, 0.06));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const b = k.target, at = k.heart(b);
          const R = pinR(k);
          const fall = 0.14;
          // The last third of a second: the tethers break, then the stakes go.
          const snap = smooth(seg(0.35 - left, 0, 0.15)), gone = smooth(left / 0.2);
          stuck(k, at, keptWay(k), smooth(left / 0.4), 0.32);
          const half = (b.wide / UNITS_PER_TILE) * 0.5, mine = k.sy(b);
          const feet: P3[] = [];
          for (let i = 0; i < 3; i++) {
            const an = (k.seed % 7) * 0.4 + (i / 3) * TAU;
            const foot = k.on(b.x + Math.cos(an) * R, b.y + Math.sin(an) * R, 0);
            feet.push(foot);
            const v = clamp((age - i * 0.04) / fall);
            if (v <= 0) continue;
            // Each ghost arrow dropping from over the creature straight down into the turf beside its feet, and standing there as a
            // tent peg does, its nock leant out away from what it holds.
            const out = dirOf(k.on(b.x, b.y, 0), foot);
            const from = along(along(foot, [0, 0, 1], 20), [out[0], out[1], 0], 3.5);
            const d = dirOf(from, foot);
            const head = v < 1 ? mid3(from, foot, easeIn(v)) : foot;
            arrow(k, head, d, { alpha: 0.95 * gone, fletch: GOLD, tip: PALETTE.core, glow: 0.6, sunk: v < 1 ? 0 : 0.3, bias: 1 });
            if (v < 1) continue;
            if (!k.state[`dug${i}`]) {
              k.state[`dug${i}`] = 1;
              k.burst(foot, 5, { kind: 'dust', colour: DIRT, size: 2, life: [0.3, 0.6], speed: [0.1, 0.3], up: [2, 6], gravity: 3 });
            }
            // The tether, from low on the stake to the creature's side nearest it, taut and shivering as it strains; drawn
            // behind the body when its stake is behind it, so it never stands up out of its back.
            const nock = along(foot, d, -ARROW * 0.6);
            const side = { x: b.x + Math.cos(an) * half, y: b.y + Math.sin(an) * half, z: b.z + b.tall * 0.55 };
            const bias = k.sy(foot) < mine ? -3 : 2;
            const look = { width: 1.5, taper: 'none' as const, alpha: 0.9, main: GOLD, core: PALETTE.core, ink: GOLD_DEEP, glow: 0.3 + 0.4 * k.night, light: WARM, bias };
            if (snap <= 0) {
              const shiver = Math.sin(k.now * 60 + i * 2) * 0.6;
              const mid = mid3(nock, side, 0.5);
              k.ribbon([nock, { ...mid, z: mid.z + shiver }, side], look);
            } else if (snap < 1) {
              // Broken in the middle, each half whipping back to where it is tied, curling as it goes.
              const mid = mid3(nock, side, 0.5), curl = 2.5 * Math.sin(Math.PI * snap);
              const toNock = mid3(nock, mid, 1 - snap), toSide = mid3(side, mid, 1 - snap);
              k.ribbon([nock, { ...mid3(nock, toNock, 0.5), z: mid3(nock, toNock, 0.5).z + curl }, toNock], { ...look, taper: 'start', alpha: 0.9 * (1 - snap * 0.5) });
              k.ribbon([side, { ...mid3(side, toSide, 0.5), z: mid3(side, toSide, 0.5).z - curl }, toSide], { ...look, taper: 'start', alpha: 0.9 * (1 - snap * 0.5) });
              if (!k.state[`snap${i}`]) {
                k.state[`snap${i}`] = 1;
                k.burst(mid, 6, { kind: 'spark', colour: [GOLD, PALETTE.core], size: 1.6, life: [0.15, 0.35], speed: [0.3, 0.9], up: [-4, 10], gravity: 30, over: true });
              }
            }
          }
          // The pen: a gold line pegged out on the ground between the stakes while it is held.
          if (age > fall + 0.08 && snap < 1) {
            k.groundPath(feet, { closed: true, width: 1.1, alpha: 0.7 * (1 - snap) * smooth((age - fall - 0.08) / 0.2), main: GOLD, ink: GOLD_DEEP, glow: 0.2 + 0.7 * k.night, light: WARM });
          }
          // A little warm light under it while it is held, so the stakes and the tethers read at night.
          k.light(b, 1, 0.32 * gone * k.night, WARM);
        },
      },
    },
  },

  /*
   * Expose: no shot -- a hunter showing where to hit. The bow down, the right
   * arm drawn back across the body to the left shoulder and flung out at the
   * creature, the forefinger pointing, a flick at the end, and the point held.
   * A gold line runs out along the point, and three gold diamonds come up on
   * the creature's weak places -- neck, flank, haunch -- each swelling in its
   * turn, for as long as every blow on it does more; a bullseye at its feet
   * whose outer ring draws in as the fifteen seconds run out.
   */
  archer_expose: {
    palette: PALETTE,
    cast: { timing: EXPOSE_T, pose: exposePose },
    fx: {
      charge: (k, t) => {
        k.glow(fingertip(k), 4, 0.6 * bump(t, EXPOSE_T.release * 0.5, EXPOSE_T.release, EXPOSE_T.release + 0.15), GOLD, true);
      },
      travel: {
        secs: () => 0.18,
        draw: (k, u) => {
          const from = fingertip(k), to = k.heart(k.target);
          const head = mid3(from, to, easeOut(u));
          k.beam(from, head, { width: 1, alpha: 0.85, main: GOLD, core: PALETTE.core, ink: GOLD_DEEP, glow: 0.4 });
          crosshairChevron(k, head, dirOf(from, to), 3, 1);
        },
      },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 12, { kind: 'mote', colour: [GOLD, PALETTE.core], size: 1.8, life: [0.3, 0.6], speed: [0.3, 0.8], up: [0, 12], gravity: 0, over: true });
      },
      impact: {
        secs: 0.45,
        draw: (k, u) => {
          const from = fingertip(k), at = k.heart(k.target);
          const v = 1 - seg(u, 0, 0.6);
          k.beam(from, at, { width: 1 * v, alpha: 0.8 * v, main: GOLD, core: PALETTE.core, ink: GOLD_DEEP, glow: 0.3 });
        },
      },
      linger: {
        draw: (k, age, left) => {
          const b = k.target;
          const a = smooth(age / 0.2) * smooth(left / 0.8);
          const share = clamp(left / Math.max(0.01, age + left));
          // The weak places, brighter for the first moments.
          weakSpots(k, b, age, a * (0.8 + 0.2 * Math.max(0, 1 - age / 1.5)));
          // The bullseye at its feet: the outer ring drawing in on the inner as the seconds run out.
          const G = Math.max(0.22, (b.wide / UNITS_PER_TILE) * 1.4 + 0.1);
          const night = { light: WARM, glow: 0.2 + 0.6 * k.night };
          k.ring(b, G * (0.62 + 0.38 * share), { band: 0.05, alpha: 0.6 * a, dash: 4, turn: age * 0.25, main: GOLD, deep: GOLD_DEEP, ...night });
          k.ring(b, G * 0.5, { band: 0.04, alpha: 0.5 * a, turn: -age * 0.4, main: GOLD, deep: GOLD_DEEP, ...night });
          k.light(b, 0.8, 0.25 * a * k.night, WARM);
        },
      },
    },
  },

  /*
   * Decoy: an arrow fetched from the quiver and flung underhand from the
   * bottom of a lunge, a stride off to the right; it arcs there trailing
   * leaves, goes in point first, and a scarecrow of leaves springs up on it
   * -- a hooded green cloak on the shaft -- that flutters and calls the
   * creatures to it in slow rings while it lasts, its seconds counted in
   * gold wedges round its foot, and falls to leaves at the end. It keeps at
   * the archer's feet, following a little behind when they move.
   */
  archer_decoy: {
    palette: PALETTE,
    cast: { timing: DECOY_T, pose: decoyPose },
    fx: {
      charge: (k, t) => {
        // The arrow in the fist from the quiver to the throw; then flung, in the air long enough to be followed, into the turf
        // where the decoy will stand.
        const rel = DECOY_T.release, h = k.hand(1);
        if (t > rel * 0.35 && t < rel) {
          const d = unit(add(dirOf(k.chest(), h), [0, 0, -1], 0.6));
          arrow(k, along(h, d, ARROW * 0.7), d, { bias: 1 });
        }
        const fly = (t - rel) * DECOY_T.secs / DECOY_FLING;
        if (fly >= 0 && fly < 1) {
          const from = k.once('toss', () => k.hand(1)), at = decoyAt(k, k.state.decoyX === undefined);
          const v = lerp(fly, easeIn(fly), 0.4), head = arcAt(from, at, v, 6);
          arrow(k, head, dirOf(arcAt(from, at, Math.max(0, v - 0.05), 6), head), { glow: 0.4, long: 1.15 });
          if (!k.fast) k.emit(head, 30, { kind: 'shard', colour: LEAVES, size: 1.3, life: [0.3, 0.6], speed: [0.05, 0.2], up: [-2, 4], gravity: 6, drag: 0.4, spin: 2.4, ink: false });
        }
      },
      linger: {
        draw: (k, age, left) => {
          const at = decoyAt(k, false);
          if (age >= DECOY_FLING && !k.state.landed) {
            k.state.landed = 1;
            k.burst(at, 6, { kind: 'dust', colour: DIRT, size: 2.4, life: [0.3, 0.6], speed: [0.1, 0.3], up: [2, 6], gravity: 3 });
            leaves(k, k.on(at.x, at.y, 6), 14, { speed: [0.3, 0.8], up: [8, 18] });
          }
          const rise = easeOut((age - DECOY_FLING) / 0.35);
          const fall = smooth(left / 0.5);
          scarecrow(k, at, rise * fall, age);
          // A ring going out from it each second: the call that brings the blows to it.
          const u = (Math.max(0, age - DECOY_FLING) % 1.2) / 1.2;
          k.ring(at, 0.15 + 0.55 * smooth(u), { band: 0.05, alpha: 0.55 * (1 - u) * fall * rise, glow: 0.2 + 0.5 * k.night, light: WARM, dash: 3, turn: age * 0.3 });
          countdown(k, at, 0.3, DECOY.secs, age, 0.9 * fall * rise);
          if (left < 0.5 && !k.state.fell) {
            k.state.fell = 1;
            leaves(k, k.on(at.x, at.y, 8), 20, { speed: [0.2, 0.7], up: [0, 10] });
          }
        },
      },
    },
  },

  /*
   * Snipe: the trade's heaviest shot. A wide, low stance, the arrow fetched,
   * the deepest draw and the longest hold, the head down along the shaft. A
   * gold sight line from the eye to the creature steadies as the hold goes
   * on, its shake dying away, a scope's pip at its end shrinking still on the
   * creature. Loosed with a flash, the arrow
   * is across the field almost at once, leaving a straight wake of light in
   * the air, and goes in and out of the creature: a burst through its far
   * side, a tight ring on the ground.
   */
  archer_snipe: {
    palette: PALETTE,
    cast: { timing: SNIPE_T, pose: shotWith(SNIPE_SHOT, (r, t, rel) => {
      // The stance set wide and low; still as stone through the hold, the cheek down on the hand.
      const set = smooth(seg(t, 0.05, SNIPE_SHOT.anchor)) * (1 - smooth(seg(t, rel + (1 - rel) * 0.4, 1)));
      r.leg[0][1] += 16 * set;
      r.leg[1][1] += 16 * set;
      r.knee[0] += 18 * set;
      r.knee[1] += 18 * set;
      r.head[0] -= 6 * set;
      r.neck[0] -= 4 * set;
    }) },
    fx: {
      charge: (k, t) => {
        const rel = SNIPE_T.release;
        bowCharge(k, t, SNIPE_SHOT, rel, { fletch: GOLD, glow: 0.3 * smooth(seg(t, SNIPE_SHOT.anchor, rel)) });
        const on = smooth(seg(t, SNIPE_SHOT.anchor - 0.06, SNIPE_SHOT.anchor + 0.08));
        if (on <= 0) return;
        const steady = smooth(seg(t, SNIPE_SHOT.anchor, rel - 0.08));
        const eye = k.head(), at = k.heart(k.target);
        // The sight line, shaking at the end at first and settling dead still, dashed while it settles.
        const shake = (1 - steady) * 3;
        const end = { x: at.x, y: at.y, z: at.z + Math.sin(k.now * 31) * shake + Math.sin(k.now * 17) * shake * 0.6 };
        sightLine(k, eye, end, on * (0.45 + 0.35 * steady), steady);
        // The scope's pip where the line ends: shaking with it at first, small and dead still once the hold has settled.
        scopePip(k, end, on * (0.7 + 0.3 * steady) * (1 - seg(k.released, 0, 0.1)), steady);
        k.light(at, 0.8, 0.25 * on * steady * k.night, WARM);
      },
      release: (k) => {
        k.flash(0.12, '#fff6d0');
        const m = muzzle(k), d = aimOf(k);
        k.burst(m, 14, { kind: 'spark', colour: [GOLD, PALETTE.core], size: 1.8, life: [0.15, 0.3], speed: [0.8, 1.8], up: [-2, 8], heading: { x: d[0], y: d[1] }, cone: 0.5, gravity: 0, over: true });
        // A breath of light dust off the planted feet with the kick: soft puffs, not debris.
        k.burst(k.at(k.caster, 0.03), 4, { kind: 'mist', colour: '#d8ccb0', size: 1.8, sizeEnd: 3, life: [0.3, 0.5], speed: [0.15, 0.35], up: [1, 3], gravity: 0, drag: 0.4 });
        k.state.fromX = m.x;
        k.state.fromY = m.y;
        k.state.fromZ = m.z;
      },
      travel: {
        secs: shotTravel(0.018, 0.03),
        draw: (k, u) => {
          const from = snipeFrom(k), to = k.heart(k.target);
          k.beam(from, mid3(from, to, u), { width: 2.4, alpha: 0.8, main: GOLD, core: PALETTE.core, ink: GOLD_DEEP, glow: 0.8 });
          flight(k, from, to, u, 0, { trail: 0, fletch: GOLD, tip: PALETTE.core, glow: 1, long: 1.3 });
        },
      },
      hit: (k) => {
        const at = k.heart(k.target);
        const d = keepWay(k, snipeFrom(k), at);
        strike(k, at, d, 1.4, GOLD);
        // Out through the far side.
        k.burst(at, 24, { kind: 'spark', colour: [GOLD, PALETTE.core, PALETTE.main], size: 2, life: [0.25, 0.55], speed: [1.6, 3], up: [-4, 14], heading: { x: d[0], y: d[1] }, cone: 0.7, gravity: 30, drag: 0.08, over: true });
        k.burst(k.at(k.target, 0.03), 12, { kind: 'dust', colour: '#8a7a62', size: 3.4, life: [0.5, 0.9], speed: [0.4, 1], up: [2, 8], gravity: 2, drag: 0.2 });
      },
      impact: {
        secs: 0.9,
        draw: (k, u) => {
          const from = snipeFrom(k), at = k.heart(k.target), d = keptWay(k);
          // The wake: the straight line of its flight, thinning and fading where it hung in the air.
          k.beam(from, at, { width: 2.4 * (1 - u), alpha: 0.7 * (1 - smooth(u)), main: GOLD, core: PALETTE.core, ink: GOLD_DEEP, glow: 0.6 * (1 - u) });
          stuck(k, at, d, 1 - seg(u, 0.75, 1), 0.55, GOLD, 1.3);
          k.flare(at, 18 * (1 - u), flashOf(u, 0.05), PALETTE.core, Math.PI / 4);
          k.flare(along(at, d, 6), 10 * (1 - u), flashOf(u, 0.08), GOLD, 0, GOLD, true);
          k.ring(k.target, 0.12 + 0.3 * easeOut(u), { band: 0.05, alpha: 0.9 * (1 - u), main: GOLD, deep: GOLD_DEEP, glow: 0.3 + 0.5 * k.night, light: WARM });
          k.light(at, 1.2, 0.55 * (1 - u), WARM);
        },
      },
    },
  },

  /*
   * Deadeye: the bow brought up before the face, the brow lowered to it and
   * the draw hand's fingers to the eye, a breath held while six gold blades
   * of an iris turn in and close on the eye; then the head snaps up and the
   * eye opens -- a gold sight line flung out ahead of the archer a few
   * strides and gone -- and the bow is swept out ready. A glint stays in the
   * eye, and ten gold wedges round the feet count the seconds the draws are
   * quick for.
   */
  archer_deadeye: {
    palette: PALETTE,
    cast: { timing: DEADEYE_T, pose: deadeyePose },
    fx: {
      charge: (k, t) => {
        const rel = DEADEYE_T.release;
        const close = smooth(seg(t, 0.15, rel));
        const on = smooth(seg(t, 0.1, 0.3)) * (1 - smooth(seg(t, rel, rel + 0.06)));
        iris(k, k.head(), close, on * 0.95);
      },
      release: (k) => {
        const eye = k.head(), f = k.facingDir(k.caster);
        k.flash(0.1, '#fff6d0');
        k.burst(eye, 14, { kind: 'mote', colour: [GOLD, PALETTE.core], size: 1.8, life: [0.25, 0.5], speed: [0.8, 1.8], up: [-2, 6], heading: { x: f.x, y: f.y }, cone: 0.5, gravity: 0, over: true });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const eye = k.head(), f = k.facingDir(k.caster);
          k.flare(eye, 9 * (1 - u), flashOf(u, 0.08), GOLD, Math.PI / 4, GOLD, true);
          // The eye opened: a gold sight line flung out ahead along the way the archer faces, three tiles, and gone in 0.4 s.
          const go = easeOut(seg(u, 0, 0.25)), fade = 1 - seg(u, 0.25, 0.67);
          if (fade > 0) {
            const far = { x: eye.x + f.x * 3 * go, y: eye.y + f.y * 3 * go, z: eye.z };
            const near = { x: eye.x + f.x * 3 * go * seg(u, 0.2, 0.67), y: eye.y + f.y * 3 * go * seg(u, 0.2, 0.67), z: eye.z };
            k.beam(near, far, { width: 1.6 * fade + 0.4, alpha: 0.9 * fade, main: GOLD, core: PALETTE.core, ink: GOLD_DEEP, glow: 0.5, light: WARM });
            crosshairChevron(k, far, [f.x, f.y, 0], 3.5, fade);
          }
          k.light(k.caster, 1, 0.45 * (1 - u), WARM);
        },
      },
      linger: {
        draw: (k, age, left) => {
          const a = smooth(age / 0.4) * smooth(left / 0.6);
          countdown(k, k.caster, 0.42, DEADEYE.secs, age, a);
          // The glint in the eye, coming round faster than a heartbeat: the draw a share quicker for it.
          const beat = (age / (DEADEYE.time * 1.2)) % 1;
          k.flare(k.head(), 3.5 + 2 * (1 - beat), a * (0.35 + 0.5 * (1 - beat)), GOLD, beat * 1.4, GOLD, true);
        },
      },
    },
  },
};

/* ---- the shared helpers the spells above call -------------------------------------------- */

/** How high a Long Shot climbs over the straight line: more for further, as a lofted arrow does. */
function longLift(k: FxScene): number {
  return 3 + k.dist * 2.2 * LONG.range;
}

/**
 * The beads of a Long Shot's arc between `u0` and `u1` of the way along it:
 * small fletching chevrons in gold and pale green pointing along the way,
 * larger toward the top of the arc, laid out like a judged trajectory, in
 * one record; lit over the night.
 */
function dottedArc(k: FxScene, path: (v: number) => P3, u0: number, u1: number, alpha: number): void {
  if (alpha <= 0.01 || u1 <= u0) return;
  const n = 16, z = k.zoom;
  const beads: number[] = [];
  for (let i = 1; i < n; i++) {
    const u = i / n;
    if (u < u0 || u > u1) continue;
    const p = path(u), q = path(u + 0.01);
    const x = k.sx(p), y = k.sy(p), dx = k.sx(q) - x, dy = k.sy(q) - y, l = Math.hypot(dx, dy) || 1;
    beads.push(x, y, dx / l, dy / l, (1.7 + 1.5 * Math.sin(Math.PI * u)) * z, i % 3 ? 0 : 1);
  }
  if (!beads.length) return;
  const paint = (g: CanvasRenderingContext2D): void => {
    g.lineJoin = 'miter';
    g.lineWidth = Math.max(0.7, 0.5 * z);
    g.strokeStyle = PALETTE.ink;
    for (let i = 0; i < beads.length; i += 6) {
      const x = beads[i], y = beads[i + 1], ux = beads[i + 2], uy = beads[i + 3], s = beads[i + 4];
      // A fletching's V, its point along the way.
      g.beginPath();
      g.moveTo(x + ux * s, y + uy * s);
      g.lineTo(x - ux * s * 0.6 - uy * s * 0.8, y - uy * s * 0.6 + ux * s * 0.8);
      g.lineTo(x - ux * s * 0.15, y - uy * s * 0.15);
      g.lineTo(x - ux * s * 0.6 + uy * s * 0.8, y - uy * s * 0.6 - ux * s * 0.8);
      g.closePath();
      g.fillStyle = beads[i + 5] ? GOLD : PALETTE.light;
      g.fill();
      g.stroke();
    }
  };
  k.worldDraw(path(0.5), (g) => {
    g.globalAlpha = clamp(alpha);
    paint(g);
  }, 4);
  overNight(k, alpha, paint);
}

/** A ragged patch of turf scuffed up where something came down hard: dug earth, drying as it goes. `grow` its spread. */
function scuff(k: FxScene, b: Body, grow: number, alpha: number): void {
  if (alpha <= 0.01 || grow <= 0) return;
  const R = Math.max(0.14, (b.wide / UNITS_PER_TILE) * 0.9) * (0.5 + 0.5 * grow);
  const pts: number[] = [], inner: number[] = [];
  for (let i = 0; i < 10; i++) {
    const an = (i / 10) * TAU + (k.seed % 5) * 0.3, j = 0.7 + 0.3 * hashOf(k.seed, i);
    pts.push(b.x + Math.cos(an) * R * j, b.y + Math.sin(an) * R * j * 0.9);
    inner.push(b.x + Math.cos(an) * R * j * 0.5, b.y + Math.sin(an) * R * j * 0.45);
  }
  k.groundShape(b.x, b.y, R + 0.3, [
    { kind: 'fill', colour: dry(DIRT, 1 - alpha), alpha: clamp(alpha * 0.75), paths: [pts], lift: 0.1 },
    { kind: 'fill', colour: '#5a4c3a', alpha: clamp(alpha * 0.7), paths: [inner], lift: 0.12 },
  ]);
}

/** One chevron along a line, pointing along `d`: a fletching's V, for a muzzle blast or a pointed line's head. */
function crosshairChevron(k: FxScene, p: P3, d: V, size: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const q = along(p, d, 2);
  const x = k.sx(p), y = k.sy(p), dx = k.sx(q) - x, dy = k.sy(q) - y, l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l, z = k.zoom, s = size * z;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(alpha);
    g.beginPath();
    g.moveTo(x + ux * s, y + uy * s);
    g.lineTo(x - ux * s * 0.4 - uy * s, y - uy * s * 0.4 + ux * s);
    g.lineTo(x, y);
    g.lineTo(x - ux * s * 0.4 + uy * s, y - uy * s * 0.4 - ux * s);
    g.closePath();
    g.fillStyle = GOLD;
    g.fill();
    g.lineWidth = Math.max(0.7, 0.5 * z);
    g.strokeStyle = PALETTE.ink;
    g.stroke();
  }, 6);
  k.glow(p, size * 1.4, alpha * 0.4, GOLD, true);
}

/** Where a Crippling Shot goes in: low on the creature, at its legs. */
const legOf = (k: FxScene): P3 => k.at(k.target, 0.2);
/** The hobble's count: just outside the creature's feet. */
const brambleR = (k: FxScene): number => Math.max(0.18, (k.target.wide / UNITS_PER_TILE) * 1.4 + 0.08);

/** The pinning arrows' ring: a stride out from the creature's feet. */
const pinR = (k: FxScene): number => Math.max(0.28, (k.target.wide / UNITS_PER_TILE) * 1.6 + 0.12);
/** Where a Snipe was loosed from, kept at the loose so its wake stays where it was laid. */
const snipeFrom = (k: FxScene): P3 => (k.state.fromX === undefined ? muzzle(k) : { x: k.state.fromX, y: k.state.fromY, z: k.state.fromZ });

/** A sight line from the eye to a point: thin gold, dashed until `steady` is one and then solid. */
function sightLine(k: FxScene, a: P3, b: P3, alpha: number, steady: number): void {
  if (alpha <= 0.01) return;
  const x0 = k.sx(a), y0 = k.sy(a), x1 = k.sx(b), y1 = k.sy(b), z = k.zoom;
  const near = y1 > y0 ? b : a;
  k.worldDraw(near, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineCap = 'butt';
    if (steady < 0.98) g.setLineDash([4 * z, (2 + 4 * (1 - steady)) * z]);
    g.strokeStyle = GOLD;
    g.lineWidth = Math.max(0.8, 0.5 * z);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.setLineDash([]);
  }, 8);
  k.glowDraw((g) => {
    g.globalAlpha = clamp(alpha * 0.18);
    g.strokeStyle = PALETTE.light;
    g.lineWidth = 2 * z;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  });
}

/**
 * Where the decoy stands: set down a stride ahead of the caster's feet when it
 * is made, and then kept within a stride of them, gliding after them when they
 * move off.
 */
function decoyAt(k: FxScene, fresh: boolean): P3 {
  if (fresh || k.state.decoyX === undefined) {
    // Flung a stride off from the right hand: ahead, behind or out to the side, whichever stands it most beside the archer on the
    // screen rather than in front of them or hidden behind them -- what is to a body's right is toward the viewer from some ways.
    const cx = k.eye.worldToScreenX(k.caster.x, k.caster.y), cy = k.eye.worldToScreenY(k.caster.x, k.caster.y, 0);
    let want: P3 = k.caster, best = -Infinity;
    // All out to the right, where the hand flings it, and ahead or a little back.
    for (const [r, a] of [[13, 6], [11, 12], [14, -4]] as const) {
      const p = k.local(k.caster, r, a, 0);
      const score = Math.abs(k.eye.worldToScreenX(p.x, p.y) - cx) - 0.25 * Math.max(0, k.eye.worldToScreenY(p.x, p.y, 0) - cy);
      if (score > best) {
        best = score;
        want = p;
      }
    }
    k.state.decoyX = want.x;
    k.state.decoyY = want.y;
  }
  const dx = k.caster.x - k.state.decoyX, dy = k.caster.y - k.state.decoyY, far = Math.hypot(dx, dy);
  if (far > 0.6) {
    const go = Math.min(1, k.dt * 3) * (far - 0.6) / far;
    k.state.decoyX += dx * go;
    k.state.decoyY += dy * go;
  }
  return k.on(k.state.decoyX, k.state.decoyY, 0);
}

/**
 * The decoy, a scarecrow of leaves about the height of a person's shoulder:
 * the arrow it is made on standing out of the ground, a bough across it for
 * arms with tatters of leaf hanging off the ends, a cloak of leaves hung from
 * the bough narrow at the shoulders and wide at the hem, and a hood with a
 * dark hollow for a face and two gold eyes in it. Faceted in the trade's
 * greens, lit on the left and shaded on the right, with an ink edge. `up`
 * nought to one as it springs up and as it falls.
 */
function scarecrow(k: FxScene, at: P3, up: number, age: number): void {
  if (up <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), z = k.zoom;
  const H = k.hpx(13.5) * up;
  const u1 = k.hpx(1);
  const sway = Math.sin(age * 2.2) * 0.05;
  const ink = PALETTE.ink, inkW = Math.max(0.8, 0.7 * z);
  k.worldDraw(at, (g) => {
    g.globalAlpha = 1;
    g.lineJoin = 'miter';
    // Everything leans with the sway from the foot of the stake.
    const lean = (h: number): number => x + h * sway;
    const top = y - H;
    const sh = top + H * 0.3, hem = y - H * 0.3;
    // The stake: the arrow it is made on, out of the ground to under the cloak.
    g.strokeStyle = ink;
    g.lineWidth = 2 * z;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(lean(H * 0.75), sh);
    g.stroke();
    g.strokeStyle = SHAFT;
    g.lineWidth = 0.9 * z;
    g.stroke();
    // The bough across the shoulders, a little askew, and its tatters.
    const bw = 3.8 * u1 * up, by = sh + 0.2 * u1;
    const bl: [number, number] = [lean(H * 0.7) - bw, by + 0.5 * u1], br: [number, number] = [lean(H * 0.7) + bw, by - 0.3 * u1];
    g.strokeStyle = ink;
    g.lineWidth = 2 * z;
    g.beginPath();
    g.moveTo(bl[0], bl[1]);
    g.lineTo(br[0], br[1]);
    g.stroke();
    g.strokeStyle = SHAFT;
    g.lineWidth = 0.9 * z;
    g.stroke();
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    for (const [ex, ey, s] of [[bl[0], bl[1], -1], [br[0], br[1], 1]] as const) {
      for (let i = 0; i < 2; i++) {
        const fl = Math.sin(age * 8 + i * 2 + s) * 0.5 * u1;
        const tx = ex - s * (0.5 + i * 1.1) * u1, ty = ey + (i ? 0.2 : 0) * u1;
        g.fillStyle = i ? PALETTE.deep : PALETTE.main;
        g.beginPath();
        g.moveTo(tx - 0.6 * u1, ty);
        g.lineTo(tx + 0.6 * u1, ty);
        g.lineTo(tx + fl + s * 0.3 * u1, ty + (2.2 + i * 0.6) * u1);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
    // The cloak: narrow at the shoulders, wide at the hem, its hem in fluttering points; lit half and shaded half, a fold between.
    const ws = 1.7 * u1, wh = 2.7 * u1 * (0.5 + 0.5 * up);
    const cx = lean(H * 0.7), hx = lean(H * 0.3);
    const hemPts: Array<[number, number]> = [];
    for (let i = 0; i <= 4; i++) {
      const v = i / 4;
      const fl = Math.sin(age * 9 + i * 1.7) * 0.35 * u1;
      hemPts.push([lerp(hx - wh, hx + wh, v) + fl, hem + (i % 2 ? -0.9 * u1 : 0.4 * u1) + fl * 0.4]);
    }
    const fold: [number, number] = [hx + 0.2 * u1, hem - 0.3 * u1];
    g.fillStyle = PALETTE.main;
    g.beginPath();
    g.moveTo(cx - ws, sh);
    g.lineTo(cx + 0.1 * u1, sh - 0.2 * u1);
    g.lineTo(fold[0], fold[1]);
    for (let i = 2; i >= 0; i--) g.lineTo(hemPts[i][0], hemPts[i][1]);
    g.closePath();
    g.fill();
    g.fillStyle = PALETTE.deep;
    g.beginPath();
    g.moveTo(cx + 0.1 * u1, sh - 0.2 * u1);
    g.lineTo(cx + ws, sh);
    for (let i = 4; i >= 2; i--) g.lineTo(hemPts[i][0], hemPts[i][1]);
    g.lineTo(fold[0], fold[1]);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(cx - ws, sh);
    g.lineTo(cx + ws, sh);
    for (let i = 4; i >= 0; i--) g.lineTo(hemPts[i][0], hemPts[i][1]);
    g.closePath();
    g.lineWidth = inkW;
    g.stroke();
    // The hood over the top of the stake: a pointed cowl, lit half and shaded half, its face a dark hollow.
    const hr = 1.35 * u1 * (0.6 + 0.4 * up), hcx = lean(H * 0.95), hcy = top + hr * 1.3;
    g.fillStyle = LEAVES[0];
    g.beginPath();
    g.moveTo(hcx - 0.3 * hr, top);
    g.lineTo(hcx - hr, hcy);
    g.lineTo(hcx - 0.7 * hr, hcy + hr);
    g.lineTo(hcx, hcy + hr * 1.1);
    g.lineTo(hcx, hcy - hr * 0.4);
    g.closePath();
    g.fill();
    g.fillStyle = PALETTE.main;
    g.beginPath();
    g.moveTo(hcx - 0.3 * hr, top);
    g.lineTo(hcx, hcy - hr * 0.4);
    g.lineTo(hcx, hcy + hr * 1.1);
    g.lineTo(hcx + 0.7 * hr, hcy + hr);
    g.lineTo(hcx + hr, hcy);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(hcx - 0.3 * hr, top);
    g.lineTo(hcx + hr, hcy);
    g.lineTo(hcx + 0.7 * hr, hcy + hr);
    g.lineTo(hcx - 0.7 * hr, hcy + hr);
    g.lineTo(hcx - hr, hcy);
    g.closePath();
    g.stroke();
    g.fillStyle = ink;
    g.beginPath();
    g.moveTo(hcx - 0.55 * hr, hcy);
    g.lineTo(hcx + 0.55 * hr, hcy);
    g.lineTo(hcx + 0.4 * hr, hcy + 0.8 * hr);
    g.lineTo(hcx - 0.4 * hr, hcy + 0.8 * hr);
    g.closePath();
    g.fill();
    // Two gold eyes in the hollow, so it looks back at what it calls.
    const e = Math.max(1, 0.8 * z);
    g.fillStyle = GOLD;
    g.fillRect(hcx - 0.28 * hr - e / 2, hcy + 0.3 * hr, e, e);
    g.fillRect(hcx + 0.28 * hr - e / 2, hcy + 0.3 * hr, e, e);
  }, 0);
  k.glow(k.on(at.x, at.y, 11.5 * up), 4, 0.5 * up, GOLD, true);
  if (!k.fast) k.emit(k.on(at.x, at.y, 7), 1.5, { kind: 'shard', colour: LEAVES, size: 1.2, life: [0.6, 1.1], speed: [0.1, 0.3], up: [-2, 4], gravity: 6, drag: 0.3, spin: 2, jitter: 0.06 });
}

/**
 * Read the Wind's gusts: five strokes of leaf green curling in over the grass
 * toward the feet from a stride out, the stretch of each that shows sliding
 * in along it as `u` goes nought to one -- the wind drawn in and caught.
 */
function gusts(k: FxScene, b: Body, u: number): void {
  const a = 1 - seg(u, 0.55, 1);
  if (a <= 0.01) return;
  const e = easeOut(u), z = k.zoom;
  const runs: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const a0 = (k.seed % 13) * 0.4 + (i / 5) * TAU;
    // Out a stride, curling a quarter turn round as it comes in.
    const head = lerp(0.8, 0.14, e), tail = Math.min(0.95, head + 0.26);
    const run: number[] = [];
    for (let j = 0; j <= 4; j++) {
      const r = lerp(tail, head, j / 4), an = a0 + (0.95 - r) * 1.6;
      run.push(b.x + Math.cos(an) * r, b.y + Math.sin(an) * r);
    }
    runs.push(run);
  }
  k.groundShape(b.x, b.y, 1.3, [
    { kind: 'stroke', colour: PALETTE.ink, alpha: clamp(a * 0.8), width: 2.6 * z, paths: runs, join: 'round', cap: 'round', lift: 0.15 },
    { kind: 'stroke', colour: LEAVES[0], alpha: clamp(a), width: 1.4 * z, paths: runs, join: 'round', cap: 'round', lift: 0.15, glow: 0.2 + 0.8 * k.night },
  ]);
}

/**
 * Read the Wind's telltale: a gold streamer tied a hand's width off the top
 * of the bow, flying out to the side of the screen away from the head so it
 * never lies over the face, fluttering -- and burning shorter as the time to
 * use the sure shot runs out, so how long is left can be read off it.
 */
function telltale(k: FxScene, age: number, left: number, a: number): void {
  if (a <= 0.01) return;
  const b = k.caster, bow = bowOf(k, b);
  const top = bow ? bow.top : k.at(b, 1.05);
  const away = Math.sign(k.sx(top) - k.sx(k.head())) || 1;
  // The way over the ground that runs furthest across the screen on the side away from the head, and least up or down it.
  let fx = 1, fy = 0, best = -Infinity;
  for (let i = 0; i < 8; i++) {
    const an = (i / 8) * TAU, cx = Math.cos(an), cy = Math.sin(an);
    const p = { x: top.x + cx * 0.1, y: top.y + cy * 0.1, z: top.z };
    const score = (k.sx(p) - k.sx(top)) * away - 0.6 * Math.abs(k.sy(p) - k.sy(top));
    if (score > best) {
      best = score;
      fx = cx;
      fy = cy;
    }
  }
  const root = { x: top.x + fx * 0.05, y: top.y + fy * 0.05, z: top.z - 0.4 };
  const share = clamp(left / Math.max(0.01, age + left));
  const step = 0.035 * (0.22 + 0.78 * share);
  const pts: P3[] = [root];
  for (let i = 1; i <= 9; i++) {
    const w = Math.sin(age * 7 - i * 1.1) * 0.45 * i;
    pts.push({ x: root.x + fx * step * i - fy * 0.008 * w, y: root.y + fy * step * i + fx * 0.008 * w, z: root.z - 0.22 * i * (0.4 + 0.6 * share) + 0.45 * Math.sin(age * 5 - i) });
  }
  k.polyline([top, root], { alpha: a, main: GOLD_DEEP });
  k.ribbon(pts.reverse(), { width: 3.4, taper: 'start', alpha: a, main: GOLD, core: PALETTE.core, ink: GOLD_DEEP, glow: 0.3 + 0.5 * k.night, light: WARM });
  if (!k.fast && Math.sin(age * 1.3) > 0.97) k.emit(root, 4, { kind: 'mote', colour: GOLD, size: 1.3, life: [0.6, 1], speed: [0.05, 0.15], up: [-3, 3], gravity: 0, over: true });
}

/**
 * Long Shot's way: the lofted arc, and bowed off to one side by a quarter of
 * its lift -- the way that goes up the screen -- so it reads as a curve from
 * every facing, even where the lift and the line of travel are both up and
 * down the screen. The arrow, the judged dots and the dots it leaves all take it.
 */
function longPath(k: FxScene, from: P3, to: P3): (v: number) => P3 {
  const lift = longLift(k);
  const d = dirOf(from, to), across: V = unit([-d[1], d[0], 0]);
  const mid = mid3(from, to, 0.5), test = along(mid, across, 4);
  // A fourteenth of the range, and never less than a quarter of the lift: enough to bend the line on the screen.
  const wide = (k.sy(test) <= k.sy(mid) ? 1 : -1) * Math.max(0.25 * lift, 0.07 * k.dist * UNITS_PER_TILE);
  return (v) => along(arcAt(from, to, v, lift), across, wide * 4 * v * (1 - v));
}

/** Crippling Shot's way: down from the bow to the height of the leg over the first fifth, and on in, skimming the grass. */
function lowPath(from: P3, to: P3): (v: number) => P3 {
  return (v) => {
    const down = smooth(clamp(v / 0.2));
    return { x: lerp(from.x, to.x, v), y: lerp(from.y, to.y, v), z: lerp(lerp(from.z, to.z, v), to.z, down) };
  };
}

/**
 * The hobble left on a creature slowed: one or two vines wound low round its
 * legs (a hobble, not a cage: below the knee, and no ring), short drag lines
 * scuffed in the turf behind it on the side away from the archer, and the
 * seconds of the slow counted down in green wedges round its feet.
 */
function hobble(k: FxScene, b: Body, grow: number, alpha: number, age: number): void {
  if (alpha <= 0.01 || grow <= 0) return;
  const R = brambleR(k);
  // A vine wound up a foreleg and one up a hind leg, each round its own leg, not round the creature.
  const vines = k.fast ? 1 : 2;
  const high = b.tall * 0.22;
  for (let v = 0; v < vines; v++) {
    const leg = k.local(b, (v ? -1 : 1) * b.wide * 0.08, (v ? -1 : 1) * b.wide * 0.3, 0);
    const a0 = (v / vines) * TAU + (k.seed % 11) * 0.5;
    const pts: P3[] = [];
    const n = 9;
    const reachTo = Math.max(2, Math.round(n * grow));
    for (let i = 0; i < reachTo; i++) {
      const u = i / (n - 1);
      const rr = lerp(0.07, 0.035, Math.sqrt(u));
      const an = a0 + u * 2.2 * TAU + Math.sin(age * 1.6 + v) * 0.08 * u;
      pts.push({ x: leg.x + Math.cos(an) * rr, y: leg.y + Math.sin(an) * rr, z: b.z + 0.3 + high * u });
    }
    wrap(k, { ...b, x: leg.x, y: leg.y }, pts, { width: 1.6, alpha, main: PALETTE.main, core: LEAVES[0], glow: 0.4 * k.night });
  }
  // Drag lines behind it, away from the archer: the feet it cannot lift.
  const ax = b.x - k.caster.x, ay = b.y - k.caster.y, al = Math.hypot(ax, ay) || 1;
  const ux = ax / al, uy = ay / al, px = -uy, py = ux;
  const runs: number[][] = [];
  for (let i = -1; i <= 1; i++) {
    const o = i * R * 0.35, l = (0.22 + 0.06 * (1 - Math.abs(i))) * grow;
    const x0 = b.x + ux * R * 0.5 + px * o, y0 = b.y + uy * R * 0.5 + py * o;
    runs.push([x0, y0, x0 + ux * l * 0.5 + px * o * 0.15, y0 + uy * l * 0.5 + py * o * 0.15, x0 + ux * l + px * o * 0.35, y0 + uy * l + py * o * 0.35]);
  }
  k.groundShape(b.x, b.y, R + 0.6, [
    { kind: 'stroke', colour: PALETTE.ink, alpha: clamp(alpha * 0.55), width: 2.4 * k.zoom, paths: runs, join: 'round', cap: 'round', lift: 0.1 },
    { kind: 'stroke', colour: DIRT, alpha: clamp(alpha * 0.9), width: 1.3 * k.zoom, paths: runs, join: 'round', cap: 'round', lift: 0.1 },
  ]);
  countdown(k, b, R + 0.06, CRIPPLE.secs, age, alpha, PALETTE.main, PALETTE.light);
}

/**
 * Snipe's scope pip: a small gold diamond at the end of the sight line, on
 * the creature, inked, larger while it shakes and small and still once the
 * hold is steady.
 */
function scopePip(k: FxScene, p: P3, alpha: number, steady: number): void {
  if (alpha <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), z = k.zoom, s = (2.6 + 1.4 * (1 - steady)) * z;
  const paint = (g: CanvasRenderingContext2D): void => {
    g.lineJoin = 'miter';
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.75, y);
    g.lineTo(x, y + s);
    g.lineTo(x - s * 0.75, y);
    g.closePath();
    g.fillStyle = GOLD;
    g.fill();
    g.lineWidth = Math.max(0.8, 0.6 * z);
    g.strokeStyle = PALETTE.ink;
    g.stroke();
    g.fillStyle = PALETTE.core;
    g.fillRect(x - 0.6 * z, y - 0.6 * z, 1.2 * z, 1.2 * z);
  };
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(alpha);
    paint(g);
  }, 30);
  overNight(k, alpha, paint);
}

/**
 * Expose's weak spots: three gold diamonds on the creature -- the neck, the
 * flank and the haunch -- each swelling in its turn, so the mark reads as
 * places to strike rather than a sight laid on it.
 */
function weakSpots(k: FxScene, b: Body, age: number, alpha: number): void {
  if (alpha <= 0.01) return;
  // Along its body, about as long as it is tall: up at the neck, low at the flank, at the haunch.
  const L = Math.max(b.wide * 0.5, b.tall * 0.42), z = k.zoom;
  const spots = [k.local(b, 0, L, b.tall * 0.62), k.local(b, 0, L * 0.05, b.tall * 0.42), k.local(b, 0, -L, b.tall * 0.55)];
  // A creature seen end on would stack them in a column: spread them across the screen to at least half its height.
  const H = k.hpx(b.tall), dx = k.sx(spots[2]) - k.sx(spots[0]), more = Math.max(0, 0.55 * H - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
  const pts = spots.map((p, i) => [k.sx(p) + (i - 1) * more, k.sy(p)] as const);
  const sizes = spots.map((_, i) => {
    const beat = (((age * 0.8 - i / 3) % 1) + 1) % 1;
    return (2.4 + 1.6 * Math.max(0, 1 - beat * 4)) * z;
  });
  const paint = (g: CanvasRenderingContext2D): void => {
    g.lineJoin = 'miter';
    g.lineWidth = Math.max(0.8, 0.6 * z);
    g.strokeStyle = PALETTE.ink;
    for (let i = 0; i < 3; i++) {
      const [x, y] = pts[i], s = sizes[i];
      g.beginPath();
      g.moveTo(x, y - s);
      g.lineTo(x + s * 0.7, y);
      g.lineTo(x, y + s);
      g.lineTo(x - s * 0.7, y);
      g.closePath();
      g.fillStyle = GOLD;
      g.fill();
      g.stroke();
      // The lit facet, the upper left, as everything is lit.
      g.fillStyle = PALETTE.core;
      g.beginPath();
      g.moveTo(x, y - s);
      g.lineTo(x - s * 0.7, y);
      g.lineTo(x - s * 0.15, y - s * 0.1);
      g.closePath();
      g.fill();
    }
  };
  // Sorted with the creature and laid over it.
  k.worldDraw(b, (g) => {
    g.globalAlpha = clamp(alpha);
    paint(g);
  }, 30);
  overNight(k, alpha, paint);
}

/**
 * Deadeye's iris: six thin gold blades round the eye, turning in on it as
 * `close` goes nought to one, as a lens closes -- the breath held, the eye
 * narrowed to a point.
 */
function iris(k: FxScene, p: P3, close: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), z = k.zoom;
  const R = lerp(12, 4.5, close) * z, r = lerp(7, 1.2, close) * z, turn = (1 - close) * 1.4;
  const paint = (g: CanvasRenderingContext2D): void => {
    g.lineJoin = 'miter';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a0 = turn + (i / 6) * TAU, a1 = a0 + TAU / 6 + 0.35;
      // A blade: a curved leaf from the edge of the opening out to the rim, swept round a sixth and overlapping the next.
      g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r * 0.85);
      g.lineTo(x + Math.cos(a1) * R, y + Math.sin(a1) * R * 0.85);
      g.lineTo(x + Math.cos(a1 - 0.5) * R, y + Math.sin(a1 - 0.5) * R * 0.85);
      g.lineTo(x + Math.cos(a0 + 0.35) * (r + (R - r) * 0.4), y + Math.sin(a0 + 0.35) * (r + (R - r) * 0.4) * 0.85);
      g.closePath();
    }
    g.fillStyle = GOLD;
    g.fill();
    g.lineWidth = Math.max(0.7, 0.5 * z);
    g.strokeStyle = PALETTE.ink;
    g.stroke();
  };
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(alpha);
    paint(g);
  }, 30);
  overNight(k, alpha, paint);
}

