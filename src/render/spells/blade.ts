/**
 * The Sworn Blade's spells: how each is cast and what it looks like.
 *
 * A Blade is a swordsman who fights by measure: the distance judged, the blow
 * placed, the guard kept. Everything here is drawn in that one language --
 * cold steel and a white edge for what the sword does, brass for where a blow
 * lands and for what is being kept count of -- and three shapes carry it:
 *
 *   the sweep    the sword's own path, the band the real blade swept through
 *                the air (`swept`, on `k.trail`), so a cut's light is exactly
 *                where the blade went rather than a stock crescent laid near it;
 *   the line     a straight ruled stroke: the cut left hanging in the air
 *                across what was struck, the measure taken before a blow, the
 *                line scored on the ground;
 *   the measure  a brass arc on the ground that unwinds over what a spell
 *                lasts (`measure`), under everything that lasts: full and
 *                bold under the tactical ones (Challenge, Hold the Line,
 *                Guardian's Call, Last Stand), a thin one under the rest
 *                (Hamstring, Deflect, Disarming Cut), and as a brass lip
 *                round the stamina gauge for Measured Breathing.
 *
 * Blows close in and swing the real weapon through the target (`cast.close`,
 * `wield`): no blow lands from where the island lets it be struck. The buffs
 * are stances and breaths, each a different silhouette and a different tempo.
 */
import { type Rig } from '../figure';
import { HALF_H, HALF_W, HEIGHT_SCALE } from '../iso';
import type { CastClose, CastPose, PoseCue, SpellVisual } from './index';
import { spellInfo } from './info';
import { bump, clamp, easeOut, flashOf, hashOf, lerp, mid3, seg, smooth, TAU, type Body, type FxScene, type GroundLayer, type Look, type P3, type SpellPalette } from './kit';
import { armOut, euler, one, track, type Key } from './poses';

/** Steel and a cold white edge, with brass where a blow lands. */
export const PALETTE: SpellPalette = {
  core: '#ffffff',
  main: '#c9d6e3',
  deep: '#6d7f94',
  accent: '#e8c35a',
  ink: '#27303d',
  light: '#bfd8ff',
};

/** The brass of the palette as a shape's own colours: where a blow lands, and what is kept count of. */
const BRASS: Look = { main: PALETTE.accent, deep: '#a37a2a', core: '#fff4cc' };
const BRASS_DEEP = '#a37a2a';
const BRASS_CORE = '#fff4cc';
/** Breath in the cold: pale, a little blue. */
const BREATH = '#e6eef8';
const DUST = '#8a7a62';
/** A wooden shield's face, and the lit side of it. */
const WOOD = '#8a6a44';
const WOOD_LIT = '#d9b98a';
/** A blade's steel seen whole, between the palette's pale and its deep: grey, so its lit edge reads as an edge. */
const STEEL = '#8e9eb1';
/** Blood, and its wet light. */
const BLOOD = '#b0241c';
const BLOOD_LIT = '#ff9c8a';

/* ---- where the sword is ----------------------------------------------------------------- */

/** The point of whatever is in the caster's hand, this frame. */
const tipOf = (k: FxScene): P3 => k.joint(k.caster, 'tip');

/* ---- closing in ---------------------------------------------------------------------------- */

/*
 * The island lets a sword strike from as far as it reaches -- 2.2 tiles -- and a blade is a quarter of a tile, so a
 * Blade standing where the island has it never touches what it strikes. Each strike closes in (`cast.close`): the
 * body is carried in over the wind-up so the blade passes through the creature on the blow, and back after the
 * follow-through. The legs run it (`dash`), and the effects stream off it (`rush`). On the move the stage does not
 * close in, so a blow still short is carried the rest of the way by a bright edge off the point (`bridge`).
 */

/** When a strike closes in and goes back, as shares of the cast, and how far ahead of its feet its blow lands. */
interface Closing {
  from: number;
  to: number;
  back: number;
  /** Height units ahead of the feet the blow lands: a little short of the point's full reach, so the point goes in. */
  reach: number;
}

/** The stage's closing in (`cast.close`) for a strike. */
const closeOf = (o: Closing): CastClose => ({ from: o.from, to: o.to, back: o.back, reach: o.reach });

/** How far in the stage has a closing strike at `u` of the cast, nought to one (as `stage.ts` has it). */
const closeAt = (u: number, o: Closing): number => smooth(seg(u, o.from, o.to)) * (1 - smooth(seg(u, o.back, 1)));

/** Height units a running stride covers: three or four of them over the island's whole reach. */
const STRIDE = 24;

/**
 * How hard the body is running at `t`, nought to one: its speed as the stage carries it in or back, over the pace of
 * a hard run; `dir` one going in and minus one coming away; `run` the ground covered so far, in height units.
 */
function pace(t: number, secs: number, by: number, o: Closing): { w: number; dir: number; run: number } {
  const h = 0.005;
  const v = (Math.abs(closeAt(t + h, o) - closeAt(t - h, o)) / (2 * h)) * (by / secs);
  const go = smooth(seg(t, o.from, o.to)), home = smooth(seg(t, o.back, 1));
  return { w: clamp(v / 150), dir: t < (o.to + o.back) / 2 ? 1 : -1, run: by * (go + go * home) };
}

/**
 * The legs of a body the stage carries in to the blow and back (`cast.close`): a run laid over the pose's own legs,
 * a stride every `STRIDE` units of ground and as hard as the body is going -- the feet cover the ground, it does
 * not slide -- leant into going in and back coming away. Nothing when there is no way to go (in reach already) or
 * the caster is walking (the walk's legs are kept). Called after the legs are written.
 */
function dash(r: Rig, t: number, c: PoseCue, o: Closing): number {
  const by = c.aim?.close ?? 0;
  if (by < 3 || c.moving) return 0;
  const { w, dir, run } = pace(t, c.timing.secs, by, o);
  if (w < 0.01) return 0;
  const ph = (Math.PI * run) / STRIDE, s = Math.sin(ph), cs = Math.cos(ph), A = 44 * w;
  r.leg[0] = [r.leg[0][0] + A * s, r.leg[0][1], r.leg[0][2]];
  r.leg[1] = [r.leg[1][0] - A * s, r.leg[1][1], r.leg[1][2]];
  // The leg swinging through (forward going in, back coming away) folds at the knee; the one under the body is straight.
  r.knee = [r.knee[0] + 85 * w * Math.max(0, dir * cs), r.knee[1] + 85 * w * Math.max(0, -dir * cs)];
  r.at = [r.at[0], r.at[1], r.at[2] + 1.4 * w * Math.abs(s)];
  r.spine = [r.spine[0] - 12 * w * dir, r.spine[1], r.spine[2]];
  // The free arm pumps against the legs.
  r.arm[0] = [r.arm[0][0] - 26 * w * s, r.arm[0][1], r.arm[0][2]];
  return w;
}

/**
 * The run on the ground, for the effects: streaks off behind the body at its height while it goes in, and dust
 * kicked back off its feet, as hard as it is going. Nothing in reach already, nor coming away (a step back is not a
 * charge). `extra` keeps them up to that share whatever the stage is doing (a Lunge's stride the island made).
 */
function rush(k: FxScene, t: number, o: Closing, extra = 0): void {
  const by = k.aim?.close ?? 0, timing = k.timing;
  let run = extra;
  if (by >= 3 && timing) {
    const p = pace(t, timing.secs, by, o);
    if (p.dir > 0) run = Math.max(run, p.w);
  }
  if (run < 0.05) return;
  const f = k.toward(k.caster, k.target), back = { x: -f.x, y: -f.y };
  for (let i = 0; i < 3; i++) {
    const h = k.caster.tall * (0.3 + 0.22 * i), side = (hashOf(k.seed, i) - 0.5) * 0.3;
    const a = { x: k.caster.x - f.y * side + back.x * 0.12, y: k.caster.y + f.x * side + back.y * 0.12, z: k.caster.z + h };
    const len = 0.8 * run * (0.6 + 0.4 * hashOf(k.seed, i + 4));
    const tail = { x: a.x + back.x * len, y: a.y + back.y * len, z: a.z };
    k.ribbon([tail, mid3(tail, a, 0.6), a], { width: 1.6 + 0.6 * hashOf(k.seed, i + 7), taper: 'both', alpha: 0.75 * run, glow: 0.3 });
  }
  k.emit(k.on(k.caster.x, k.caster.y, 1), 28 * run, { kind: 'dust', colour: DUST, size: 1.8, life: [0.2, 0.4], speed: [0.2, 0.6], up: [2, 8], heading: back, cone: 1.2, gravity: 4, drag: 0.1 });
}

/** Tiles from the drawn caster to its target past which a blow is still short and is carried the rest (`bridge`). */
const SHORT = 0.75;

/**
 * Seconds a blow's bright edge takes over what the blow is still short by: none when the body was carried in (the
 * blade went through), a quick run when it could not be (on the move).
 */
const bridgeSecs = (tiles: number): number => (tiles > SHORT ? 0.03 + 0.025 * tiles : 0);

/**
 * The blow carried the rest of the way: a bright stroke shot off the point of the sword (where it was at the
 * release) to `to`, its head at `u` and its tail eaten after it, so what opens there is where it arrived.
 */
function bridge(k: FxScene, to: P3, u: number, o: { brass?: boolean; width?: number } = {}): void {
  const from = k.once('rel', () => tipOf(k));
  const v = smooth(u);
  const head = mid3(from, to, v), tail = mid3(from, to, Math.max(0, v - 0.45));
  k.ribbon([tail, mid3(tail, head, 0.5), head], { ...(o.brass ? BRASS : {}), width: o.width ?? 3, taper: 'start', glow: 0.7 });
  k.flare(head, 4, 0.9, PALETTE.core, 0.6);
}

/* ---- the Blade's shapes -------------------------------------------------------------------- */

/**
 * The sword's own path: the band the real blade swept over the last `secs` of the cast (`k.trail`), steel with a
 * white edge down its whole length, inked, eaten from the tail as the blade slows. The group's signature and so its
 * boldest mark: opaque, and wider in toward the fist than a stock trail.
 */
function swept(k: FxScene, alpha = 1, o: { secs?: number; inner?: number; brass?: boolean } = {}): void {
  if (alpha <= 0.01) return;
  const look = o.brass ? { main: PALETTE.accent, core: BRASS_CORE } : { main: PALETTE.main, core: PALETTE.core };
  // At night the band itself goes down under the dark with everything else, so its edge is lit up over it: white
  // light along the edge, as bright as the night is deep, so the sweep stays the brightest thing in a blow.
  k.trail(k.caster, { ...look, alpha, secs: o.secs ?? 0.14, inner: o.inner ?? 0.3, outer: 1.04, glow: 0.6 + 1.2 * k.night, light: k.night > 0.3 ? PALETTE.core : PALETTE.light });
}

/** The caster's ahead and right over the ground, as unit steps in tiles, ahead being at the target. */
function frameOf(k: FxScene): { fwd: { x: number; y: number }; right: { x: number; y: number } } {
  const fwd = k.toward(k.caster, k.target);
  const r0 = k.local(k.caster, 1, 0, 0);
  const rx = r0.x - k.caster.x, ry = r0.y - k.caster.y;
  // The perpendicular to ahead that lies on the body's right.
  const s = -fwd.y * rx + fwd.x * ry >= 0 ? 1 : -1;
  return { fwd, right: { x: -fwd.y * s, y: fwd.x * s } };
}

/** A point off `p`: `right` and `ahead` tiles along the caster's frame, `up` height units. */
const off = (p: P3, f: ReturnType<typeof frameOf>, right: number, ahead: number, up: number): P3 =>
  ({ x: p.x + f.right.x * right + f.fwd.x * ahead, y: p.y + f.right.y * right + f.fwd.y * ahead, z: p.z + up });

/** A step along the ground that runs straight across the screen, left to right, a tile long. */
function across(k: FxScene): { x: number; y: number } {
  const e = k.eye, dx = e.unrotateX(1, -1), dy = e.unrotateY(1, -1), l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

/** `p` moved `x` pixels right and `y` pixels up the screen (at zoom one): sideways over the ground, up in height. */
function nudge(k: FxScene, p: P3, x: number, y: number): P3 {
  const d = across(k), h = x / (Math.SQRT2 * HALF_W);
  return { x: p.x + d.x * h, y: p.y + d.y * h, z: p.z + y / HEIGHT_SCALE };
}

/**
 * Where the point of the sword was the frame before and this frame, kept in `k.state` from a strike's `charge`, so
 * the blow's `hit` can say which way the blade was going through it (`noteTravel`).
 */
function notePoint(k: FxScene): void {
  const s = k.state, p = tipOf(k);
  if (s.nx !== undefined) { s.ox = s.nx; s.oy = s.ny; s.oz = s.nz; }
  s.nx = p.x; s.ny = p.y; s.nz = p.z;
}

/** At the hit: which way the point was going across the screen as it went in (`travel` for `slant`), kept for the cut. */
function noteTravel(k: FxScene): void {
  const s = k.state;
  if (s.ox === undefined || s.tvx !== undefined) return;
  const o = { x: s.ox, y: s.oy, z: s.oz }, n = { x: s.nx, y: s.ny, z: s.nz };
  s.tvx = k.sx(n) - k.sx(o);
  s.tvy = k.sy(o) - k.sy(n);
}

/**
 * The two ends of a stroke `len` pixels long (at zoom one) through `c`, slanting `deg` degrees up from the
 * screen's level: the first end on the caster's right as the screen has it, raised; the second on the left,
 * lowered. A cut is laid in the screen's terms rather than the body's, so a level cut reads level and a
 * slanting one slants from wherever it is seen -- and never within `apart` degrees of the line from the caster to
 * what it struck, which from some facings would lay it along the blow and read as a thrust through, not a cut across.
 * Where the blade's own way through it is known (`noteTravel`), the stroke leans the way the blade went -- down to
 * the left if the blade went down to the left -- so the cut is where the steel passed, from every side.
 */
function slant(k: FxScene, c: P3, len: number, deg: number, apart = 55): [P3, P3] {
  const d = across(k);
  // Which way the caster's right lies across the screen; square on to the viewer, the right of the screen.
  const rt = k.local(k.caster, 1, 0, 0);
  const sign = k.sx(rt) - k.sx(k.caster) < -0.05 * k.zoom ? -1 : 1;
  // The cut as a line on the screen (up positive, half a turn the same): its first end at `cut` from the middle.
  const first = sign > 0 ? deg : 180 - deg;
  // The blow's own line on the screen, kept clear of: a cut at `c`, and how far it had to be turned to be.
  const ax = k.sx(k.target) - k.sx(k.caster), ay = k.sy(k.caster) - k.sy(k.target);
  const blow = Math.hypot(ax, ay) > 2 * k.zoom ? (Math.atan2(ay, ax) * 180) / Math.PI : undefined;
  const clear = (c: number): [number, number] => {
    if (blow === undefined) return [c, 0];
    const off = ((((c - blow) % 180) + 270) % 180) - 90;
    return Math.abs(off) < apart ? [blow + (off >= 0 ? apart : -apart), apart - Math.abs(off)] : [c, 0];
  };
  // Of the slant and its mirror, the one that needs turning least; where both stand clear, the one leaning the way
  // the blade went.
  const [c0, t0] = clear(first), [c1, t1] = clear(180 - first);
  let cut = t0 <= t1 ? c0 : c1;
  const tvx = k.state.tvx ?? 0, tvy = k.state.tvy ?? 0;
  if (t0 === 0 && t1 === 0 && Math.abs(tvx) > 0.3 * k.zoom && Math.abs(tvy) > 0.3 * k.zoom) {
    const r = (first * Math.PI) / 180;
    cut = Math.cos(r) * Math.sin(r) * tvx * tvy < 0 ? 180 - first : first;
  }
  const a = (cut * Math.PI) / 180;
  const h = ((len / 2) * Math.cos(a)) / (Math.SQRT2 * HALF_W), v = ((len / 2) * Math.sin(a)) / HEIGHT_SCALE;
  return [{ x: c.x + d.x * h, y: c.y + d.y * h, z: c.z + v }, { x: c.x - d.x * h, y: c.y - d.y * h, z: c.z - v }];
}

/**
 * The cut left in the air: a long thin straight stroke from `a` to `b`, sharp at both ends, brass with a white
 * heart and an ink edge, opened out both ways from its middle -- where the blade went in -- as `grow` goes to one, so
 * its first frame is a spark on what was struck and never a sliver floating off it. Then it hangs, and `part` opens
 * it into two edges drifting apart -- what was struck, cut.
 */
function cutLine(k: FxScene, a: P3, b: P3, o: { grow?: number; part?: number; alpha?: number; width?: number; floor?: number } = {}): void {
  const al = o.alpha ?? 1;
  if (al <= 0.01) return;
  // Kept out of the ground: lifted whole until its lower end clears `floor`.
  const lift = o.floor === undefined ? 0 : Math.max(0, o.floor - Math.min(a.z, b.z));
  if (lift > 0) { a = { ...a, z: a.z + lift }; b = { ...b, z: b.z + lift }; }
  const grow = clamp(o.grow ?? 1), part = clamp(o.part ?? 0);
  const s = mid3(a, b, 0.5 - grow / 2), end = mid3(a, b, 0.5 + grow / 2);
  const pts = [s, mid3(s, end, 0.25), mid3(s, end, 0.5), mid3(s, end, 0.75), end];
  // Narrow while it is short, so it opens as a line and not a lozenge.
  const w = (o.width ?? 3.4) * (1 - 0.55 * part) * (0.45 + 0.55 * grow);
  if (part <= 0) {
    k.ribbon(pts, { ...BRASS, alpha: al, width: w, taper: 'both', glow: 0.8 });
    return;
  }
  // Parted: the two edges, each a hair of the stroke, drifting a few units apart up and down.
  const gap = 1.6 * part;
  for (const s of [-1, 1]) {
    const q = pts.map((p) => ({ x: p.x, y: p.y, z: p.z + s * gap }));
    k.ribbon(q, { ...BRASS, alpha: al * (1 - part * 0.6), width: w, taper: 'both', glow: 0.5 });
  }
}

/**
 * The point come out of the far side: a star of short straight rays thrown out of `p` in a cone round `dir` (a step
 * on the ground), flung out and thinned as `u` goes to one. White with a pale brass heart, inked, in one record.
 */
function exitBurst(k: FxScene, p: P3, dir: { x: number; y: number }, u: number): void {
  const al = 1 - smooth(seg(u, 0.2, 0.75));
  if (al <= 0.01) return;
  const out = easeOut(seg(u, 0, 0.5));
  const rays: number[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 5 - 0.5) * 1.3 + (hashOf(k.seed, i) - 0.5) * 0.2;
    const c = Math.cos(ang), s = Math.sin(ang);
    const dx = dir.x * c - dir.y * s, dy = dir.x * s + dir.y * c, dz = (hashOf(k.seed, i + 3) - 0.45) * 10;
    const r0 = 0.06 + 0.2 * out, r1 = r0 + 0.08 + 0.12 * (1 - out) * (i % 2 ? 0.6 : 1);
    const a = { x: p.x + dx * r0, y: p.y + dy * r0, z: p.z + dz * r0 }, b = { x: p.x + dx * r1, y: p.y + dy * r1, z: p.z + dz * r1 };
    rays.push(k.sx(a), k.sy(a), k.sx(b), k.sy(b));
  }
  const z = k.zoom, w = (1.3 * (1 - 0.5 * u) + 0.4) * z;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(al);
    g.lineCap = 'round';
    for (const [wd, col] of [[w + Math.max(1, 0.8 * z), PALETTE.ink], [w, PALETTE.core], [w * 0.4, BRASS_CORE]] as const) {
      g.lineWidth = wd;
      g.strokeStyle = col;
      g.beginPath();
      for (let i = 0; i < rays.length; i += 4) {
        g.moveTo(rays[i], rays[i + 1]);
        g.lineTo(rays[i + 2], rays[i + 3]);
      }
      g.stroke();
    }
    g.lineCap = 'butt';
  }, 3);
}

/** The face of the shield on the caster's left forearm, this frame. */
const shieldAt = (k: FxScene): P3 => mid3(k.joint(k.caster, 'elbow0'), k.joint(k.caster, 'wrist0'), 0.8);

/** A heater's outline in its own units, up positive (as the figure's own `metal_shield`). */
const HEATER: ReadonlyArray<readonly [number, number]> = [[-1.75, 2.3], [1.75, 2.3], [1.8, 0.6], [1.45, -0.9], [0.8, -2.1], [0, -2.9], [-0.8, -2.1], [-1.45, -0.9], [-1.8, 0.6]];

/**
 * A face the shape of the shield the caster carries -- round, wooden and bossed for a wooden one, a steel heater for
 * a metal one -- at `c`, `scale` times its size, flat on to the line from the caster to what it struck and so
 * foreshortened as the ground is: its own wood or steel inside a steel rim with a white lip, a soft lit quarter and a
 * brass boss, inked. The shield itself, not a white oval.
 */
function shieldFace(k: FxScene, c: P3, scale: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const f = frameOf(k), x = k.sx(c), y = k.sy(c);
  const rt = off(c, f, 1, 0, 0);
  let a = ((k.sx(rt) - x) / 40) * scale;
  const b = ((k.sy(rt) - y) / 40) * scale, d = -HEIGHT_SCALE * k.zoom * scale;
  // Never quite edge on: seen side on it would be a sliver, so it is turned a little to the viewer, as a shield is.
  const least = 0.9 * k.zoom * scale;
  if (Math.abs(a) < least) a = (a < 0 ? -1 : 1) * least;
  const P = (u: number, v: number): [number, number] => [x + a * u, y + b * u + d * v];
  const round = (k.caster.figure?.gear?.offhand?.id ?? 'wooden_shield') !== 'metal_shield';
  const rim: Array<[number, number]> = round
    ? Array.from({ length: 16 }, (_, i) => P(2.5 * Math.cos((i / 16) * TAU), 2.5 * Math.sin((i / 16) * TAU)))
    : HEATER.map(([u, v]) => P(u, v));
  // The lit quarter: up and to the viewer's left, as everything is lit.
  const lit: Array<[number, number]> = round
    ? [P(0, 0), ...Array.from({ length: 5 }, (_, i) => P(2.5 * Math.cos(Math.PI * (0.5 + i / 8)), 2.5 * Math.sin(Math.PI * (0.5 + i / 8))))]
    : [P(0, 0), P(0, 2.3), P(-1.75, 2.3), P(-1.8, 0.6)];
  const boss: Array<[number, number]> = Array.from({ length: 8 }, (_, i) => P(0.75 * Math.cos((i / 8) * TAU), (round ? 0 : 0.4) + 0.75 * Math.sin((i / 8) * TAU)));
  const z = k.zoom;
  k.worldDraw(c, (g) => {
    const poly = (pts: Array<[number, number]>): void => {
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.closePath();
    };
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'round';
    poly(rim);
    g.fillStyle = round ? WOOD : PALETTE.main;
    g.fill();
    g.lineWidth = Math.max(1, 0.9 * z) + 1.8 * z;
    g.strokeStyle = PALETTE.ink;
    g.stroke();
    g.lineWidth = 1.8 * z;
    g.strokeStyle = round ? PALETTE.deep : PALETTE.main;
    g.stroke();
    g.globalAlpha = clamp(alpha * 0.6);
    g.lineWidth = 0.6 * z;
    g.strokeStyle = PALETTE.core;
    g.stroke();
    g.globalAlpha = clamp(alpha);
    poly(lit);
    g.globalAlpha = clamp(alpha * 0.4);
    g.fillStyle = round ? WOOD_LIT : PALETTE.core;
    g.fill();
    g.globalAlpha = clamp(alpha);
    poly(boss);
    g.fillStyle = PALETTE.accent;
    g.fill();
    g.lineWidth = Math.max(0.8, 0.7 * z);
    g.strokeStyle = PALETTE.ink;
    g.stroke();
  }, 3);
  k.glow(c, 10 * scale, alpha * 0.2);
}

/**
 * A line scored into the ground from `a` to `b`: a long brass diamond lying flat on the land, `w` tiles across at
 * its widest, inked, with a white groove down its middle. On the ground rather than standing over it, so whoever
 * stands on it stands on it, from any side.
 */
function scored(k: FxScene, a: P3, b: P3, w: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  const px = (-dy / l) * w, py = (dx / l) * w;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const out = [a.x, a.y, mx + px, my + py, b.x, b.y, mx - px, my - py];
  const groove = [lerp(a.x, mx, 0.3), lerp(a.y, my, 0.3), mx + px * 0.3, my + py * 0.3, lerp(b.x, mx, 0.3), lerp(b.y, my, 0.3), mx - px * 0.3, my - py * 0.3];
  k.groundShape(mx, my, l / 2 + 0.2, [
    { kind: 'fill', colour: PALETTE.accent, alpha, paths: [out], lift: 0.2 },
    { kind: 'stroke', colour: PALETTE.ink, alpha, width: Math.max(0.8, 0.8 * k.zoom), paths: [out], closed: true, join: 'miter', lift: 0.2 },
    { kind: 'fill', colour: BRASS_CORE, alpha, paths: [groove], lift: 0.22 },
  ]);
  const ga = k.on(groove[0], groove[1], 0.2), gb = k.on(groove[4], groove[5], 0.2);
  const x0 = k.sx(ga), y0 = k.sy(ga), x1 = k.sx(gb), y1 = k.sy(gb), z = k.zoom;
  k.glowDraw((g) => {
    g.globalAlpha = clamp(alpha * 0.25);
    g.strokeStyle = PALETTE.accent;
    g.lineWidth = 3 * z;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.lineCap = 'butt';
  });
}

/** Half the length of the line Hold the Line scores, in tiles. */
const HOLD_HALF = 0.45;

/** Hold the Line's scored line, `half` tiles each way along it from where it was scored (kept in `k.state` at the hit). */
function holdLine(k: FxScene, half: number): [P3, P3] {
  const s = k.state;
  return [k.on(s.lx - s.dx * half, s.ly - s.dy * half, 0.3), k.on(s.lx + s.dx * half, s.ly + s.dy * half, 0.3)];
}

/**
 * The measure: a brass arc on the ground round `c`, `r` tiles out, that runs clockwise from the top of the screen
 * through `share` of a full turn -- how much of a lasting spell is left -- over a faint track of the whole, with a
 * tick at each quarter. One shape under every lasting Blade spell, so how long reads the same everywhere. Laid as
 * shapes on the island, so it costs what it covers however long it lies there.
 */
function measure(k: FxScene, c: { x: number; y: number }, r: number, share: number, alpha: number, o: { band?: number; ticks?: number } = {}): void {
  if (alpha <= 0.01 || r <= 0.05) return;
  const s = clamp(share);
  const band = o.band ?? Math.max(0.022, r * 0.065);
  // Round however close it is seen: never fewer than 40 sides to the full turn, where the kit's own count drops
  // to a dozen for a small ring.
  const full = Math.max(40, k.facets(r, 48));
  const n = Math.max(8, Math.round(full * Math.max(s, 0.25)));
  // Clockwise on the screen from its top: the view's own (-1, -1) is straight up the screen.
  const e = k.eye;
  const a0 = -0.75 * Math.PI;
  const at = (ang: number, rr: number, out: number[]): void => {
    const u = Math.cos(ang), v = Math.sin(ang);
    out.push(c.x + e.unrotateX(u, v) * rr, c.y + e.unrotateY(u, v) * rr);
  };
  const outer: number[] = [], inner: number[] = [];
  for (let i = 0; i <= n; i++) {
    const ang = a0 + (i / n) * s * TAU;
    at(ang, r, outer);
    at(ang, r - band, inner);
  }
  const arc = [...outer];
  for (let i = n; i >= 0; i--) arc.push(inner[2 * i], inner[2 * i + 1]);
  const track: number[] = [];
  const nt = full;
  for (let i = 0; i < nt; i++) at(a0 + (i / nt) * TAU, r - band * 0.5, track);
  const ticks: number[][] = [];
  for (let i = 0; i < (o.ticks ?? 4); i++) {
    const q: number[] = [];
    const ang = a0 + (i / (o.ticks ?? 4)) * TAU;
    at(ang, r + band * 0.6, q);
    at(ang, r - band * 1.6, q);
    ticks.push(q);
  }
  // Its head a small dart on the band, pointing the way it unwinds: where the time is going.
  const head: number[] = [];
  const ah = a0 + s * TAU, dh = Math.min(0.5, (band * 3) / r);
  at(ah - dh, r - band * 0.5, head);
  at(ah + dh * 0.4, r + band * 1.3, head);
  at(ah, r - band * 0.5, head);
  at(ah + dh * 0.4, r - band * 2.3, head);
  const z = k.zoom, inkW = Math.max(0.8, 0.7 * z);
  const layers: GroundLayer[] = [
    // The track and its ticks in one stroke (a tick closed on itself is the same line).
    { kind: 'stroke', colour: PALETTE.ink, alpha: alpha * 0.22, width: inkW, paths: [track, ...ticks], closed: true, lift: 0.15 },
  ];
  if (s > 0.002) {
    layers.push(
      // A night rim on what is left, laid over the dark in a pale brass rather than added (which goes lime).
      { kind: 'fill', colour: PALETTE.accent, alpha, paths: [arc], lift: 0.2, glow: 0.5 * k.night, light: BRASS_CORE },
      { kind: 'stroke', colour: PALETTE.ink, alpha, width: inkW, paths: [arc], closed: true, join: 'round', lift: 0.2 },
      { kind: 'fill', colour: BRASS_CORE, alpha, paths: [head], lift: 0.22, glow: 0.6 * k.night, light: BRASS_CORE },
      { kind: 'stroke', colour: PALETTE.ink, alpha, width: inkW, paths: [head], closed: true, join: 'miter', lift: 0.22 },
    );
  }
  k.groundShape(c.x, c.y, r + 0.3, layers);
}

/**
 * The stamina gauge: a ring of ten segments on the ground round `c`, `r` tiles out, `share` of them lit (clockwise from
 * the top of the screen) in the pale of a breath with a white lip, the rest a faint inked track. A tenth of a full bar
 * of stamina each: what a breath gives back, or (full, and not running down) what a swing costs nothing of. One record.
 */
function breathGauge(k: FxScene, c: { x: number; y: number }, r: number, share: number, alpha: number, time?: number): void {
  if (alpha <= 0.01) return;
  const e = k.eye, a0 = -0.75 * Math.PI, N = 10, band = Math.max(0.05, r * 0.16), gap = 0.08;
  const at = (ang: number, rr: number, out: number[]): void => {
    const u = Math.cos(ang), v = Math.sin(ang);
    out.push(c.x + e.unrotateX(u, v) * rr, c.y + e.unrotateY(u, v) * rr);
  };
  const lit: number[][] = [], dim: number[][] = [], lips: number[][] = [];
  const s = clamp(share) * N;
  for (let i = 0; i < N; i++) {
    const fill = clamp(s - i);
    const b0 = a0 + ((i + gap) / N) * TAU, b1 = a0 + ((i + 1 - gap) / N) * TAU;
    const seg4 = (to: number): number[] => {
      const q: number[] = [];
      for (let j = 0; j <= 3; j++) at(lerp(b0, to, j / 3), r, q);
      for (let j = 3; j >= 0; j--) at(lerp(b0, to, j / 3), r - band, q);
      return q;
    };
    dim.push(seg4(b1));
    if (fill > 0.01) {
      const to = lerp(b0, b1, fill);
      lit.push(seg4(to));
      const lip: number[] = [];
      for (let j = 0; j <= 3; j++) at(lerp(b0, to, j / 3), r - band * 0.2, lip);
      lips.push(lip);
    }
  }
  const z = k.zoom, inkW = Math.max(0.8, 0.7 * z);
  const layers: GroundLayer[] = [
    { kind: 'stroke', colour: PALETTE.ink, alpha: alpha * 0.35, width: inkW, paths: dim, closed: true, lift: 0.15 },
  ];
  if (lit.length) {
    layers.push(
      { kind: 'fill', colour: BREATH, alpha, paths: lit, lift: 0.2, glow: 0.5 * k.night },
      { kind: 'stroke', colour: PALETTE.ink, alpha, width: inkW, paths: lit, closed: true, join: 'round', lift: 0.2 },
      { kind: 'stroke', colour: PALETTE.core, alpha, width: Math.max(0.7, 0.6 * z), paths: lips, lift: 0.22 },
    );
  }
  // How long it has left, as a brass band running round just outside it from the top, clockwise, once.
  if (time !== undefined && time > 0.002) {
    const arc: number[] = [], n = Math.max(12, Math.round(48 * time));
    for (let i = 0; i <= n; i++) at(a0 + (i / n) * time * TAU, r + band * 0.32, arc);
    // Brighter than the gauge it lies on: it is the one thing in it that moves.
    const tw = Math.max(1.6, 1.5 * z);
    layers.push(
      { kind: 'stroke', colour: PALETTE.ink, alpha: Math.min(1, alpha * 1.6), width: tw + Math.max(1, 0.8 * z), paths: [arc], cap: 'round', lift: 0.23 },
      { kind: 'stroke', colour: PALETTE.accent, alpha: Math.min(1, alpha * 1.6), width: tw, paths: [arc], cap: 'round', lift: 0.24, glow: 0.6 * k.night, light: BRASS_CORE },
    );
  }
  k.groundShape(c.x, c.y, r + 0.3, layers);
}

/** Tiles out from the middle of a creature or a person that a mark on the ground under it goes: clear of its feet. */
const markR = (b: Body): number => 0.16 + (b.wide / 40) * 1.4;

/** The measure of a lasting spell at `age` with `left` to go: how much of it is left, faded in and out at the ends. */
function measureFor(k: FxScene, c: { x: number; y: number }, r: number, age: number, left: number, alpha = 0.85, o: { band?: number } = {}): void {
  measure(k, c, r, left / Math.max(1e-3, age + left), alpha * smooth(age / 0.35) * smooth(left / 0.5), o);
}

/**
 * A small sword drawn at screen point (x, y), point toward `ang` (nought straight down), `R` pixels from pommel
 * to point: a blade lit down its left, a brass guard, grip and pommel, inked. Drawn into `g` as it stands, for
 * a record of one sword or of several.
 */
function drawSword(g: CanvasRenderingContext2D, x: number, y: number, R: number, ang: number, alpha: number, zoom: number, brass = false): void {
  g.save();
  g.globalAlpha = clamp(alpha);
  g.translate(x, y);
  g.rotate(ang);
  // Pommel at the top (-y), the point down (+y): the blade two thirds of it, the guard across at a third.
  const gy = -R * 0.18, w = R * 0.11;
  g.lineJoin = 'miter';
  g.lineWidth = Math.max(0.9, 0.8 * zoom);
  g.strokeStyle = PALETTE.ink;
  g.beginPath();
  g.moveTo(-w, gy);
  g.lineTo(w, gy);
  g.lineTo(w * 0.8, R * 0.62);
  g.lineTo(0, R * 0.82);
  g.lineTo(-w * 0.8, R * 0.62);
  g.closePath();
  g.fillStyle = brass ? PALETTE.accent : PALETTE.main;
  g.fill();
  g.stroke();
  // The lit half of the blade, down its left.
  g.fillStyle = PALETTE.core;
  g.beginPath();
  g.moveTo(-w * 0.85, gy);
  g.lineTo(0, gy);
  g.lineTo(0, R * 0.8);
  g.lineTo(-w * 0.7, R * 0.62);
  g.closePath();
  g.fill();
  // Guard and grip in one path, the pommel a diamond.
  g.beginPath();
  g.rect(-R * 0.3, gy - R * 0.07, R * 0.6, R * 0.09);
  g.moveTo(0, -R * 0.56);
  g.lineTo(w * 1.1, -R * 0.47);
  g.lineTo(0, -R * 0.38);
  g.lineTo(-w * 1.1, -R * 0.47);
  g.closePath();
  g.fillStyle = PALETTE.accent;
  g.fill();
  g.stroke();
  g.fillStyle = brass ? BRASS_DEEP : PALETTE.deep;
  g.beginPath();
  g.rect(-w * 0.6, -R * 0.38, w * 1.2, R * 0.13);
  g.fill();
  g.stroke();
  g.restore();
}

/**
 * A small sword in the air at `p`, point toward `ang` on the screen (nought straight down), `r` pixels at zoom one
 * from pommel to point. What marks something as the Blade's.
 */
function swordGlyph(k: FxScene, p: P3, r: number, ang: number, alpha: number, o: { brass?: boolean; bias?: number } = {}): void {
  if (alpha <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), R = r * k.zoom, z = k.zoom;
  k.worldDraw(p, (g) => drawSword(g, x, y, R, ang, alpha, z, o.brass), o.bias ?? 2);
  k.glow(p, r * 1.2, alpha * 0.22);
}

/**
 * Darts on the ground, each at its `c` pointing along its `dir` (a step in tiles), `s` tiles long: brass with its lit
 * half pale, inked, with a night rim. Which way something is turned: a challenged creature at the one who challenged
 * it, the called ones inward. However many, one record: they share a size and a strength.
 */
function darts(k: FxScene, list: ReadonlyArray<{ c: { x: number; y: number }; dir: { x: number; y: number } }>, s: number, alpha: number): void {
  if (alpha <= 0.01 || !list.length) return;
  const whole: number[][] = [], lit: number[][] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { c, dir } of list) {
    const px = -dir.y, py = dir.x;
    const P = (a: number, b: number): [number, number] => [c.x + dir.x * a + px * b, c.y + dir.y * a + py * b];
    const tip = P(s * 0.6, 0), l = P(-s * 0.4, s * 0.55), notch = P(-s * 0.15, 0), r = P(-s * 0.4, -s * 0.55);
    whole.push([...tip, ...l, ...notch, ...r]);
    lit.push([...tip, ...l, ...notch]);
    x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  k.groundShape(cx, cy, Math.hypot(x1 - x0, y1 - y0) / 2 + s + 0.2, [
    { kind: 'fill', colour: PALETTE.accent, alpha, paths: whole, lift: 0.2, glow: 0.5 * k.night, light: BRASS_CORE },
    { kind: 'fill', colour: BRASS_CORE, alpha, paths: lit, lift: 0.21 },
    { kind: 'stroke', colour: PALETTE.ink, alpha, width: Math.max(0.8, 0.7 * k.zoom), paths: whole, closed: true, join: 'miter', lift: 0.22, glow: 0.6 * k.night, light: BRASS_CORE },
  ]);
}

/** One dart (`darts`). */
const dart = (k: FxScene, c: { x: number; y: number }, dir: { x: number; y: number }, s: number, alpha: number): void => darts(k, [{ c, dir }], s, alpha);
/**
 * A hoop round a body, level, at `c`, `r` tiles across: its far half drawn behind the body and its near half
 * over it, so it goes round rather than across. A band of steel (or brass) with an ink edge and a white lip.
 */
function hoop(k: FxScene, c: P3, r: number, o: { alpha?: number; width?: number; brass?: boolean; foot?: { x: number; y: number } } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.01) return;
  const x = k.sx(c), y = k.sy(c);
  const rx = r * HALF_W * k.zoom, ry = r * HALF_H * k.zoom;
  const W = (o.width ?? 2) * k.zoom;
  const main = o.brass ? PALETTE.accent : PALETTE.main, core = o.brass ? '#fff4cc' : PALETTE.core;
  const foot = o.foot ?? c;
  const half = (g: CanvasRenderingContext2D, near: boolean): void => {
    g.globalAlpha = clamp(a * (near ? 1 : 0.6));
    const a0 = near ? 0 : Math.PI, a1 = near ? Math.PI : TAU;
    g.lineCap = 'butt';
    g.strokeStyle = PALETTE.ink;
    g.lineWidth = W + Math.max(1.2, 1.1 * k.zoom);
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, a0, a1);
    g.stroke();
    g.strokeStyle = near ? main : o.brass ? BRASS_DEEP : PALETTE.deep;
    g.lineWidth = W;
    g.stroke();
    if (near) {
      g.strokeStyle = core;
      g.lineWidth = Math.max(0.6, W * 0.35);
      g.beginPath();
      g.ellipse(x, y - W * 0.2, rx, ry, 0, a0 + 0.35, a1 - 0.35);
      g.stroke();
    }
  };
  k.worldDraw({ x: foot.x, y: foot.y, z: c.z }, (g) => half(g, false), -0.4);
  k.worldDraw({ x: foot.x, y: foot.y, z: c.z }, (g) => half(g, true), 0.7);
  k.glow(c, Math.max(4, r * HALF_W * 0.9), a * 0.35);
}

/**
 * A ring of steel light going out over the ground from `c` to `r` tiles as `u` goes to one, thinning as it goes:
 * round however close it is seen, and with a pale lip round its outer edge that is lit at night (laid over the dark
 * in a pale tone rather than added, which over grass goes olive).
 */
function wave(k: FxScene, c: { x: number; y: number }, u: number, r: number, alpha = 1, o: Look & { band?: number; lip?: string } = {}): void {
  const rr = 0.08 + r * (1 - Math.pow(1 - clamp(u), 2.2));
  const al = alpha * (1 - u * u);
  const n = Math.max(k.facets(rr, 72), Math.min(72, Math.round(28 + rr * 10)));
  k.ring(c, rr, { ...o, band: Math.min(rr * 0.4, (o.band ?? 0.2) * (1 - 0.7 * u)), alpha: al, turn: u * 0.4, n, glow: 0 });
  if (al <= 0.01) return;
  const lip: number[] = [];
  for (let i = 0; i < n; i++) lip.push(c.x + Math.cos(u * 0.4 + (i / n) * TAU) * rr, c.y + Math.sin(u * 0.4 + (i / n) * TAU) * rr);
  k.groundShape(c.x, c.y, rr + 0.4, [
    { kind: 'stroke', colour: o.lip ?? PALETTE.core, alpha: al * 0.8, width: Math.max(0.8, 0.8 * k.zoom), paths: [lip], closed: true, lift: 0.17, glow: 0.9 * k.night, light: o.lip ?? PALETTE.core },
  ], annulus(c, rr - 0.1, rr + 0.1));
}

/**
 * The edge of an area, `r` tiles round `c`: a dashed brass band `band` tiles wide, inked, `turn` turning it, each dash
 * a quad on the ground -- fine enough to stay round close up -- with a night rim on the dashes in a pale brass, so the
 * reach still reads after dark. One record.
 */
function reachRing(k: FxScene, c: { x: number; y: number }, r: number, band: number, alpha: number, turn: number): void {
  if (alpha <= 0.01) return;
  const n = 96, dashes: number[][] = [];
  const P = (i: number, rr: number): [number, number] => [c.x + Math.cos(turn + (i / n) * TAU) * rr, c.y + Math.sin(turn + (i / n) * TAU) * rr];
  for (let i = 0; i < n; i += 4) {
    const q: number[] = [];
    for (let j = 0; j <= 2; j++) q.push(...P(i + j, r));
    for (let j = 2; j >= 0; j--) q.push(...P(i + j, r - band));
    dashes.push(q);
  }
  k.groundShape(c.x, c.y, r + 0.4, [
    { kind: 'fill', colour: PALETTE.accent, alpha, paths: dashes, lift: 0.15, glow: 0.8 * k.night, light: BRASS_CORE },
    { kind: 'stroke', colour: PALETTE.ink, alpha, width: Math.max(0.8, 0.6 * k.zoom), paths: dashes, closed: true, join: 'round', lift: 0.15 },
  ], annulus(c, r - band - 0.1, r + 0.1));
}

/** Only the ground within a ring from `r0` to `r1` tiles round `c` is cut for a mark (`groundShape`'s `keep`): a ring costs its band, not its disc. */
const annulus = (c: { x: number; y: number }, r0: number, r1: number) => (x: number, y: number, reach: number): boolean => {
  const d = Math.hypot(x - c.x, y - c.y);
  return d >= r0 - reach && d <= r1 + reach;
};

/**
 * Sparks off steel: white and a pale brass, quick, falling. No full brass: added over grass or at night it goes lime,
 * so brass is kept to solid shapes.
 */
function clash(k: FxScene, at: P3, n: number, heading?: { x: number; y: number }, cone = 2.2, speed = 1): void {
  k.burst(at, n, {
    kind: 'spark', colour: [PALETTE.core, PALETTE.core, '#fff9e8'], size: 1.8, life: [0.18, 0.45], speed: [0.8 * speed, 2.4 * speed],
    up: [4, 26], heading, cone: heading ? cone : undefined, gravity: 70, drag: 0.05, over: true,
  });
}

/* ---- the poses ----------------------------------------------------------------------------- */

/*
 * Where the sword points, which is the whole of a Blade's cast: with `wield` the blade leaves the fist on the
 * thumb's side, sixty degrees off the line down the forearm, `haft` degrees less, and every pitch down the arm
 * turns it in the same plane. So in the arm's own plane the blade stands at
 *
 *     60 - haft + arm pitch + elbow + hand pitch     degrees from straight down, toward ahead
 *
 * -- 90 level ahead, 180 straight up, 210 back over the shoulder -- and an arm's roll out to the side lays that
 * plane over (a full roll out makes it level, for a flat sweep). The keys below are written from it: each comment
 * says where the blade is. A `haft` of 150 is the grip reversed, the point down out of the bottom of the fist,
 * which is how a sword is held to be driven into the ground; letting it back to nought swings the point up and
 * over through ahead.
 */

/** Feet and knees for a stance at `t`, keyed: [left forward, left out, right forward, right out, left knee, right knee]. */
function legs(r: Rig, t: number, keys: readonly Key[]): void {
  const v = track(t, keys);
  r.leg[0] = [v[0], v[1], 0];
  r.leg[1] = [v[2], v[3], 0];
  r.knee = [v[4], v[5]];
}

/**
 * Measured Cut: the sword taken up beside the head, its point back over the right shoulder, the left hand put out
 * flat toward the creature to take its distance, a held beat -- the measure -- and then the run in and the cut, over
 * and down through it off a long front step, the body turning in behind the blade, a breath let out with it, and
 * back out to guard.
 */
const MEASURED: Closing = { from: 0.28, to: 0.51, back: 0.72, reach: 8 };
const measuredCut: CastPose = (r, t, c) => {
  // Blade: 124 at guard, 205 back over the shoulder at the top, 82 level at the blow, 72 going down and across, 116.
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.24, [160, 16, -8]], [0.46, [162, 18, -8]], [0.55, [62, 4, 14]], [0.66, [30, -16, 40]], [1, [26, 14, 6]]]);
  r.elbow[1] = one(t, [[0, 40], [0.24, 24], [0.46, 26], [0.55, 8], [0.66, 22], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.24, [-6, 0, 0]], [0.46, [-8, 0, 0]], [0.55, [-48, 0, 0]], [0.66, [-40, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.2, [70, 10, 8]], [0.46, [72, 8, 8]], [0.55, [6, 22, 0]], [0.74, [10, 18, 0]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.2, 10], [0.46, 10], [0.55, 80], [1, 30]]);
  // The measuring hand flat and square to the creature, closing as it is pulled back into the cut.
  r.shape = [{ flat: one(t, [[0.06, 0], [0.18, 1], [0.48, 1], [0.56, 0]]) }, undefined];
  r.hand[0] = euler(t, [[0.06, [0, 0, 0]], [0.2, [-60, 0, 0]], [0.48, [-60, 0, 0]], [0.56, [0, 0, 0]]]);
  r.mouth = one(t, [[0.48, 0], [0.55, 0.4], [0.74, 0]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.24, [6, -2, -24]], [0.46, [6, -3, -26]], [0.55, [-10, 4, 22]], [0.66, [-10, 3, 28]], [1, [0, 0, 4]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.24, [4, 0, -8]], [0.46, [4, 0, -10]], [0.55, [-14, 0, 12]], [0.66, [-12, 0, 12]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.24, [-4, 0, 18]], [0.46, [-5, 0, 22]], [0.55, [-8, 0, -14]], [1, [-2, 0, -2]]]);
  // A long front step under the blow: the left foot well out, its knee deep, the back leg long.
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.24, [6, 4, -4, 4, 16, 14]], [0.46, [6, 4, -4, 4, 18, 16]], [0.55, [40, 4, -22, 3, 45, 12]],
    [0.68, [38, 4, -21, 3, 42, 12]], [1, [8, 3, -3, 2, 8, 6]]]);
  r.wield = 1;
  dash(r, t, c, MEASURED);
};

/**
 * Lunge: the stride run -- the body carried from where it stood (`cast.move`, the island's stride) and on in to the
 * creature (`cast.close`: the island leaves a Lunge 1.8 tiles off it) on a low bound, the sword drawn back by the
 * hip -- then the fencer's lunge as it arrives: front knee deep, back leg straight, the back arm flung out behind
 * with the hand open, the point driven straight through with a shout. Already in reach with nothing to run, it is
 * the lunge alone, from a guard.
 */
const LUNGING: Closing = { from: 0.04, to: 0.4, back: 0.74, reach: 9 };
/** How much of a bound a Lunge has to run, nought to one: the ground it covers, the island's stride and the closing in. */
const boundOf = (moved: number, close: number): number => clamp((moved * 40 + close - 8) / 24);
const lunge: CastPose = (r, t, c) => {
  const run = c.moving ? 0 : boundOf(c.moved ?? 0, c.aim?.close ?? 0);
  // The point levelled at its heart: lower for a wolf's chest than a man's.
  const low = clamp(10 - (c.aim?.chest ?? 10), 0, 8) * 0.6;
  // Blade: level ahead from the hip as it comes in (92), and level ahead at the full reach of the arm (90).
  r.arm[1] = euler(t, [[0, [-10, 18, 0]], [0.2, [-22, 16, 4]], [0.4, [92 - low, 0, 0]], [0.62, [90 - low, 0, 0]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 80], [0.2, 94], [0.4, 0], [0.62, 4], [1, 40]]);
  r.hand[1] = euler(t, [[0, [-36, 0, 0]], [0.2, [-40, 0, 0]], [0.4, [0, 0, 0]], [0.62, [0, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [44, 14, 0]], [0.1, [20, 14, 0]], [0.2, [50, 12, 0]], [0.4, [-40, 36, 0]], [0.62, [-38, 36, 0]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 70], [0.1, 50], [0.2, 70], [0.4, 8], [0.62, 10], [1, 26]]);
  r.shape = [{ flat: one(t, [[0.28, 0], [0.4, 1], [0.7, 1], [0.9, 0]]) }, undefined];
  // The thrust itself: the blade turned in the fist to run on straight out of the forearm (`haft` 60), so the arm,
  // levelled at the heart, is the line the point goes along -- not left to the wrist's own angle, which carries the
  // point off to the right.
  const thrust = one(t, [[0.24, 0], [0.36, 1], [0.66, 1], [0.86, 0]]);
  r.haft = 60 * thrust;
  r.mouth = one(t, [[0.32, 0], [0.4, 0.8], [0.6, 0.3], [0.75, 0]]);
  r.chest = euler(t, [[0, [-4, 0, -8]], [0.2, [-2, 0, -14]], [0.4, [-6, 0, 2]], [0.62, [-6, 0, 2]], [1, [0, 0, 2]]]);
  r.spine = euler(t, [[0, [-18 * run, 0, 0]], [0.2, [-6 - 10 * run, 0, -4]], [0.4, [-16, 0, 0]], [0.62, [-14, 0, 0]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [8 * run, 0, 6]], [0.4, [10, 0, -14]], [0.62, [8, 0, -12]], [1, [0, 0, 0]]]);
  // A running bound -- left foot reaching, then the right -- into the lunge's long stance; or, with no ground to
  // cover, a guard with the weight back and the one long step of the lunge.
  const bound: Key[] = [[0, [36, 3, -30, 3, 30, 50]], [0.1, [-20, 3, 30, 3, 50, 24]], [0.2, [30, 3, -24, 3, 40, 30]], [0.4, [56, 4, -36, 3, 60, 4]],
    [0.62, [54, 4, -35, 3, 58, 6]], [1, [8, 3, -4, 2, 8, 6]]];
  const guard: Key[] = [[0, [2, 2, 0, 2, 4, 4]], [0.2, [10, 4, -6, 4, 14, 22]], [0.4, [56, 4, -36, 3, 60, 4]], [0.62, [54, 4, -35, 3, 58, 6]], [1, [8, 3, -4, 2, 8, 6]]];
  const vb = track(t, bound), vg = track(t, guard);
  const v = vb.map((x, i) => lerp(vg[i], x, run));
  r.leg[0] = [v[0], v[1], 0];
  r.leg[1] = [v[2], v[3], 0];
  r.knee = [v[4], v[5]];
  r.wield = 1;
  // The step back out to where the island has the body, after the thrust is held.
  if (t > LUNGING.back) dash(r, t, c, LUNGING);
};

/**
 * Hamstring: run in, and down low on bent knees as it arrives, the sword drawn back wide on the right with the arm
 * out level; then swept flat across at the height of the creature's legs, the arm rolled out so the blade's plane is
 * level as it passes, the body turning through it and the blade carried on across the body; and up again.
 */
const HAMSTRUNG: Closing = { from: 0.1, to: 0.44, back: 0.76, reach: 7 };
const hamstring: CastPose = (r, t, c) => {
  // Blade: laid flat out to the right and back with the arm rolled out level, then level ahead at shin height as it
  // passes (the arm rolled out 60, the hand let down), then on across the body to the left.
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.32, [14, 76, -24]], [0.48, [30, 60, 10]], [0.62, [34, -10, 36]], [0.75, [34, -34, 42]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.32, 20], [0.48, 6], [0.62, 10], [0.75, 14], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.32, [-60, 0, 0]], [0.48, [12, 0, 0]], [0.62, [-10, 0, 0]], [0.75, [-36, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.32, [60, -10, 10]], [0.48, [20, 50, 0]], [0.75, [16, 52, 0]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.32, 60], [0.48, 20], [1, 26]]);
  r.shape = [{ flat: one(t, [[0.2, 0], [0.32, 1], [0.7, 1], [0.85, 0]]) }, undefined];
  r.mouth = one(t, [[0.42, 0], [0.48, 0.5], [0.66, 0]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.32, [-4, 4, -40]], [0.48, [-6, -2, 20]], [0.62, [-6, -2, 34]], [0.75, [-6, -2, 38]], [1, [0, 0, 2]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.32, [-22, 0, -8]], [0.48, [-30, 0, 8]], [0.75, [-28, 0, 10]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.32, [14, 0, 22]], [0.48, [16, 0, -14]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.32, [30, 8, -14, 6, 56, 44]], [0.48, [46, 8, -26, 6, 70, 50]], [0.75, [44, 8, -24, 6, 66, 48]],
    [1, [8, 3, -3, 2, 8, 6]]]);
  r.wield = 1;
  dash(r, t, c, HAMSTRUNG);
};

/**
 * Shield Bash: run in with the left shoulder drawn back, the shield tucked across the chest and the weight coming
 * onto the back foot, then the whole body driven in behind it with a grunt off a long front step, the shield
 * punched out square into the creature, the sword kept back by the hip in its carry.
 */
const BASHING: Closing = { from: 0.06, to: 0.4, back: 0.72, reach: 7 };
const shieldBash: CastPose = (r, t, c) => {
  r.arm[0] = euler(t, [[0, [20, 12, 0]], [0.3, [30, 2, 44]], [0.42, [90, 2, 8]], [0.56, [86, 4, 8]], [1, [20, 14, 0]]]);
  r.elbow[0] = one(t, [[0, 40], [0.3, 108], [0.42, 34], [0.56, 40], [1, 40]]);
  // The sword kept back out of the way by the right hip, in its carry, as the shield does the work.
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.3, [-16, 20, 0]], [0.42, [-28, 22, 0]], [0.56, [-26, 22, 0]], [1, [24, 14, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [0.3, 40], [0.42, 46], [1, 40]]);
  r.mouth = one(t, [[0.34, 0], [0.42, 0.7], [0.6, 0]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [4, 0, 34]], [0.42, [-10, 0, -28]], [0.56, [-10, 0, -24]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [6, 0, 8]], [0.42, [-28, 0, -8]], [0.56, [-24, 0, -8]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-6, 0, -18]], [0.42, [10, 0, 18]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.3, [-4, 4, 10, 4, 18, 30]], [0.42, [48, 4, -30, 3, 48, 4]], [0.56, [46, 4, -28, 3, 46, 6]],
    [1, [6, 3, -2, 2, 6, 5]]]);
  dash(r, t, c, BASHING);
};

/**
 * Disarming Cut: the sword laid low across to the left hip, point down, then whipped up and out through the
 * creature's guard from low left to high right on a quick rise of the body, the wrist flicking at the top -- run in
 * low, the blade coming up through the creature as the body arrives.
 */
const DISARMING: Closing = { from: 0.06, to: 0.38, back: 0.7, reach: 8 };
const disarmingCut: CastPose = (r, t, c) => {
  // Blade: down and ahead across the left hip (30), up through the blow (158), up and a little back at the top (194).
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.3, [10, -30, 40]], [0.45, [110, 30, -20]], [0.56, [148, 44, -28]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.3, 20], [0.45, 8], [0.56, 14], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.3, [-60, 0, 0]], [0.45, [-20, 0, 0]], [0.56, [-28, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.3, [30, 30, 0]], [0.45, [40, 12, 30]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.3, 40], [0.45, 96], [1, 26]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-6, 2, 28]], [0.45, [6, -2, -22]], [0.56, [6, -2, -26]], [1, [0, 0, 2]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [-12, 0, 8]], [0.45, [4, 0, -6]], [0.56, [5, 0, -6]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [6, 0, -16]], [0.45, [2, 0, 14]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.3, [14, 4, -6, 4, 36, 32]], [0.45, [26, 4, -14, 3, 12, 6]], [0.56, [26, 4, -14, 3, 10, 6]],
    [1, [6, 3, -2, 2, 6, 5]]]);
  r.wield = 1;
  dash(r, t, c, DISARMING);
};

/**
 * Challenge: feet together, the hilt brought up before the chin in a salute, blade upright, and held; then the
 * blade swept down and out to point level at the creature, held there while the left hand, open, calls it on --
 * the whole arm swung out wide and back in to the chest twice -- and the point kept on it (`cast.hold`) while the
 * line between them is taut, before it is lowered.
 */
const challenge: CastPose = (r, t) => {
  // Blade: upright before the face (180), then level at the creature (90).
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.26, [42, -12, 30]], [0.4, [42, -12, 30]], [0.55, [86, 6, -2]], [0.82, [84, 6, -2]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.26, 112], [0.4, 112], [0.55, 2], [0.82, 4], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.26, [-34, 0, 0]], [0.4, [-34, 0, 0]], [0.55, [-58, 0, 0]], [0.82, [-56, 0, 0]], [1, [-10, 0, 0]]]);
  // Come on: the whole left arm, palm up, swung out wide to the side and then up and in to the chest, twice -- out past
  // the body's edge and back across it, so it reads from across the field, where curling fingers are lost. Done and
  // out at the side, open, by the time the point is held on it.
  const wide = armOut(0, 60, 62);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [0.4, [8, 12, 0]], [0.55, wide], [0.61, [84, 18, -8]], [0.67, wide], [0.73, [84, 18, -8]],
    [0.8, wide], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [0.4, 22], [0.55, 14], [0.61, 104], [0.67, 14], [0.73, 104], [0.8, 18], [1, 24]]);
  const curl = one(t, [[0.55, 0], [0.61, 1], [0.67, 0], [0.73, 1], [0.8, 0]]);
  r.shape = [{ flat: one(t, [[0.42, 0], [0.54, 1], [0.9, 1], [1, 0]]) * (1 - curl), claw: curl }, undefined];
  r.hand[0] = euler(t, [[0.42, [0, 0, 0]], [0.54, [0, -80, 0]], [0.9, [0, -80, 0]], [1, [0, 0, 0]]]);
  r.mouth = one(t, [[0.5, 0], [0.58, 0.4], [0.7, 0]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.26, [4, 0, 0]], [0.4, [4, 0, 0]], [0.55, [2, 0, 14]], [0.82, [2, 0, 12]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.26, [3, 0, 0]], [0.55, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.26, [-10, 0, 0]], [0.4, [-10, 0, 0]], [0.55, [6, 0, -10]], [0.82, [6, 0, -10]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.26, [0, 1, 0, 1, 2, 2]], [0.4, [0, 1, 0, 1, 2, 2]], [0.55, [20, 3, -8, 3, 16, 6]], [0.82, [20, 3, -8, 3, 16, 6]],
    [1, [4, 2, -2, 2, 5, 4]]]);
  r.wield = 1;
};

/**
 * Second Breath: bent over spent, hands toward the knees, mouth open, then the great breath -- the body coming up
 * and the chest opening, the arms going wide and low with the hands open, the head back -- and let out as it
 * settles.
 */
const secondBreath: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    // Opened low and wide, each arm swung out away from the body to its own side, the hands open: the chest let
    // open, never an arm pointing ahead.
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [0.2, [44, 4, 10]], [0.5, armOut(k, 28, 46)], [0.66, armOut(k, 26, 42)], [1, [14, 12, 0]]]);
    r.elbow[k] = one(t, [[0, 20], [0.2, 30], [0.5, 12], [0.66, 14], [1, 20]]);
  }
  const flat = one(t, [[0.1, 0], [0.3, 0.6], [0.5, 1], [0.8, 1], [1, 0]]);
  r.shape = [{ flat }, undefined];
  r.mouth = one(t, [[0, 0], [0.18, 0.45], [0.42, 0.65], [0.52, 0.2], [0.6, 0.45], [0.8, 0]]);
  const sh = one(t, [[0, 0], [0.2, -0.2], [0.5, 0.7], [0.66, 0.5], [1, 0]]);
  r.shrug = [sh, sh];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.2, [-14, 0, 0]], [0.5, [14, 0, 0]], [0.66, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.2, [-20, 0, 0]], [0.5, [6, 0, 0]], [0.66, [3, 0, 0]], [1, [0, 0, 0]]]);
  r.neck = euler(t, [[0, [0, 0, 0]], [0.2, [-6, 0, 0]], [0.5, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-14, 0, 0]], [0.5, [20, 0, 0]], [0.66, [12, 0, 0]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.2, [10, 4, 8, 4, 30, 30]], [0.5, [2, 4, 0, 4, 2, 2]], [0.66, [2, 4, 0, 4, 6, 6]], [1, [2, 2, 0, 2, 4, 4]]]);
};

/**
 * Deflect: snapped into a hanging guard, the blade upright across the front of the body and the left hand open
 * behind it, and a short hard beat of the wrist out as a blow is met -- quick, and held.
 */
const deflect: CastPose = (r, t, c) => {
  // Blade: upright before the body (170), beaten out at the meeting (185), back to upright.
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.22, [50, -10, 30]], [0.35, [54, -2, 18]], [0.5, [50, -8, 26]], [0.8, [48, -10, 28]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.22, 70], [0.35, 62], [0.5, 70], [0.8, 72], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.22, [-10, 0, 0]], [0.35, [9, 0, -16]], [0.5, [-10, 0, 0]], [0.8, [-10, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.22, [30, 30, 0]], [0.8, [28, 30, 0]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.22, 60], [1, 26]]);
  r.shape = [{ flat: one(t, [[0.1, 0], [0.22, 1], [0.8, 1], [1, 0]]) }, undefined];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.22, [2, 0, 14]], [0.35, [0, 0, 6]], [0.5, [2, 0, 12]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.22, [4, 0, 0]], [0.35, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.22, [-4, 0, -6]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.22, [-6, 5, 12, 5, 20, 22]], [0.35, [-8, 5, 14, 5, 24, 24]], [0.8, [-6, 5, 12, 5, 20, 22]], [1, [2, 2, 0, 2, 4, 4]]]);
  r.wield = 1;
  // The guard kept for as long as the parry hangs (`cast.hold`), breathing in it, the point stirring.
  const held = c.held ?? 0;
  if (held > 0 && held < 1) {
    const br = Math.sin(held * TAU * 2.5) * smooth(held / 0.05) * (1 - smooth(seg(held, 0.95, 1)));
    r.chest = [r.chest[0] + 2.5 * br, r.chest[1], r.chest[2]];
    r.shrug = [0.25 * br, 0.25 * br];
    r.hand[1] = [r.hand[1][0] + 3 * br, r.hand[1][1], r.hand[1][2]];
  }
};

/**
 * Hold the Line: the sword turned over in the fist as it comes up (`haft`), raised before the face point down, the
 * left hand closing on the grip under the right (`both`), then driven down into the ground before the feet as the
 * stance goes wide and low, and leant on -- and drawn out and turned back over to the guard.
 */
const holdTheLine: CastPose = (r, t) => {
  // Blade (haft 150 from 0.32): point down from the raised fists (60 - 150 + 150 - 60 = 0), driven down (-5), held.
  r.haft = one(t, [[0.08, 0], [0.32, 150], [0.82, 150], [1, 0]]);
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.32, [120, 6, 10]], [0.44, [126, 6, 10]], [0.55, [40, 4, 12]], [0.82, [40, 4, 12]], [1, [26, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.32, 30], [0.44, 32], [0.55, 20], [0.82, 22], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.32, [-60, 0, 0]], [0.44, [-62, 0, 0]], [0.55, [25, 0, 0]], [0.82, [25, 0, 0]], [1, [-10, 0, 0]]]);
  r.both = one(t, [[0.22, 0], [0.34, 1], [0.84, 1], [0.94, 0]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.32, [118, -12, 20]], [0.44, [124, -12, 20]], [0.55, [40, -12, 22]], [0.82, [40, -12, 22]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.32, 34], [0.55, 26], [0.82, 28], [1, 26]]);
  r.mouth = one(t, [[0.48, 0], [0.55, 0.6], [0.7, 0]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.36, [8, 0, 0]], [0.55, [-10, 0, 0]], [0.8, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.36, [6, 0, 0]], [0.55, [-16, 0, 0]], [0.8, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.36, [10, 0, 0]], [0.55, [-8, 0, 0]], [0.8, [0, 0, 0]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.36, [2, 3, 0, 3, 6, 6]], [0.55, [12, 12, -8, 12, 36, 30]], [0.8, [12, 12, -8, 12, 32, 26]], [1, [2, 2, 0, 2, 4, 4]]]);
  r.wield = 1;
};

/**
 * Measured Breathing: the sword let down at the side, point low, the left hand flat on the belly, and one slow
 * breath in and out -- on the in-breath the chin lifted, the shoulders drawn up and back and the chest thrown open;
 * on the out-breath the head and shoulders let fall, the knees giving and the feet stepped a half-pace apart into a
 * settled stance -- the breath let out through the lips.
 */
const measuredBreathing: CastPose = (r, t) => {
  // Blade: let down at the side, point low, from the very first (no swing ahead on the way there).
  // The point kept up off the ground to the end, so it never goes down past the feet as the pose is let go.
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.08, [12, 18, 0]], [0.42, [6, 26, 0]], [0.74, [14, 18, 0]], [0.9, [14, 18, 0]], [1, [24, 14, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [0.08, 24], [0.85, 20], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.08, [-32, 0, 0]], [0.95, [-32, 0, 0]], [1, [-10, 0, 0]]]);
  // The open left hand on the belly, drawn up to the chest with the in-breath and pressed down past the belt with the
  // out-breath: the breath shown by the hand, large enough to read from any side.
  const hand = track(t, [[0, [-2.5, 1.5, 7.1]], [0.16, [-0.8, 2.8, 8.4]], [0.42, [-0.6, 3, 10.2]], [0.5, [-0.6, 3, 10.2]], [0.74, [-1.6, 3.6, 7]],
    [0.86, [-1.4, 3.2, 7.8]], [1, [-2.5, 1.5, 7.1]]]);
  r.reach = [{ at: [hand[0], hand[1], hand[2]], pole: [-3, -1, -2], w: one(t, [[0.04, 0], [0.14, 1], [0.88, 1], [0.98, 0]]) }, undefined];
  r.shape = [{ flat: one(t, [[0.06, 0], [0.18, 1], [0.86, 1], [0.96, 0]]) }, undefined];
  r.hand[0] = euler(t, [[0.1, [0, 0, 0]], [0.18, [-20, 0, -30]], [0.86, [-20, 0, -30]], [0.96, [0, 0, 0]]]);
  r.mouth = one(t, [[0.48, 0], [0.54, 0.3], [0.7, 0.25], [0.76, 0]]);
  // The chest filling and the shoulders coming up a whole shrug, the chin lifted and the body leant back a little
  // on the rise -- held -- then let go: head and chest down past where they began, the knees giving.
  const s = one(t, [[0, 0], [0.16, 0], [0.42, 1], [0.5, 1], [0.74, -0.4], [0.86, -0.1], [1, 0]]);
  r.shrug = [s, s];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.16, [-2, 0, 0]], [0.42, [18, 0, 0]], [0.5, [18, 0, 0]], [0.74, [-16, 0, 0]], [0.86, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.neck = euler(t, [[0, [0, 0, 0]], [0.42, [8, 0, 0]], [0.5, [8, 0, 0]], [0.74, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.16, [-6, 0, 0]], [0.42, [16, 0, 0]], [0.5, [16, 0, 0]], [0.74, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.42, [6, 0, 0]], [0.5, [6, 0, 0]], [0.74, [-8, 0, 0]], [1, [0, 0, 0]]]);
  // Feet together for the in-breath, then a half-pace apart -- left foot forward and out, right back -- as it is
  // let out, knees giving, and settled there.
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.16, [2, 3, 0, 3, 4, 4]], [0.42, [1, 2, 1, 2, 2, 2]], [0.5, [1, 2, 1, 2, 2, 2]], [0.62, [14, 9, -8, 9, 16, 12]],
    [0.74, [14, 10, -8, 10, 22, 20]], [0.9, [12, 9, -6, 9, 14, 12]], [1, [2, 2, 0, 2, 4, 4]]]);
  r.wield = 1;
};

/**
 * Guardian's Call: gathered over the sword with the knees bent and the head down, then up -- the sword thrust
 * straight up over the head, the left arm flung wide with the hand open, the head back in the shout -- and held,
 * for everything round to see.
 */
const guardiansCall: CastPose = (r, t) => {
  // Blade: upright before the chest (170), then straight up over the head (180).
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.32, [56, -14, 30]], [0.5, [172, 12, 0]], [0.78, [170, 12, 0]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.32, 104], [0.5, 4], [0.78, 6], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.32, [-50, 0, 0]], [0.5, [-56, 0, 0]], [0.78, [-56, 0, 0]], [1, [-10, 0, 0]]]);
  // The left arm flung up and wide away from the body, not ahead: a call to everything round, not a point at one.
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.32, [40, -6, 30]], [0.5, armOut(0, 160, 45)], [0.78, armOut(0, 156, 45)], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.32, 100], [0.5, 6], [0.78, 8], [1, 26]]);
  r.shape = [{ flat: one(t, [[0.36, 0], [0.48, 1], [0.84, 1], [0.94, 0]]) }, undefined];
  r.mouth = one(t, [[0.42, 0], [0.5, 1], [0.74, 0.9], [0.86, 0]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.32, [-10, 0, 0]], [0.5, [12, 0, 0]], [0.78, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.32, [-12, 0, 0]], [0.5, [6, 0, 0]], [0.78, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.32, [-16, 0, 0]], [0.5, [20, 0, 0]], [0.78, [16, 0, 0]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.32, [10, 6, 4, 6, 36, 34]], [0.5, [6, 10, -4, 10, 4, 4]], [0.78, [6, 10, -4, 10, 6, 6]], [1, [2, 2, 0, 2, 4, 4]]]);
  r.wield = 1;
};

/**
 * Last Stand: down on the right knee (`kneel`), the sword turned over in both fists and planted point down before
 * it, the head bowed over the hilt -- spent -- then up all at once with a shout into a wide stance, the grip let
 * back round so the blade swings up through ahead to stand upright before the face in both hands, and held.
 */
const lastStand: CastPose = (r, t) => {
  // Blade: reversed (haft 150) and point down before the knee (60 - 150 + 70 + 15 = -5), then the grip let back as
  // the arms come up, which swings the point up through ahead to upright before the face (60 + 160 - 40 = 180).
  r.haft = one(t, [[0.04, 0], [0.2, 150], [0.44, 150], [0.55, 0]]);
  r.kneel = one(t, [[0.04, 0], [0.22, 1], [0.44, 1], [0.54, 0]]);
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.22, [40, -4, 16]], [0.44, [42, -4, 16]], [0.55, [60, -16, 34]], [0.82, [60, -16, 34]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.22, 30], [0.44, 30], [0.55, 100], [0.82, 100], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.22, [15, 0, 0]], [0.44, [15, 0, 0]], [0.55, [-40, 0, 0]], [0.82, [-40, 0, 0]], [1, [-10, 0, 0]]]);
  r.both = one(t, [[0.1, 0], [0.22, 1], [0.84, 1], [0.95, 0]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.22, [40, -14, 26]], [0.44, [42, -14, 26]], [0.55, [58, -24, 40]], [0.82, [58, -24, 40]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.22, 34], [0.55, 104], [0.82, 104], [1, 26]]);
  r.mouth = one(t, [[0.46, 0], [0.55, 1], [0.72, 0.6], [0.84, 0]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.22, [-8, 0, 0]], [0.44, [-10, 0, 0]], [0.55, [10, 0, 0]], [0.82, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.22, [-10, 0, 0]], [0.44, [-12, 0, 0]], [0.55, [2, 0, 0]], [0.82, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.22, [-22, 0, 0]], [0.44, [-24, 0, 0]], [0.55, [6, 0, 0]], [0.82, [4, 0, 0]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.44, [2, 2, 0, 2, 4, 4]], [0.55, [14, 14, -8, 14, 20, 16]], [0.82, [14, 14, -8, 14, 22, 18]], [1, [2, 2, 0, 2, 4, 4]]]);
  r.wield = 1;
};
/* ---- the numbers each spell is drawn from -------------------------------------------------- */

const fxOf = (id: string): Readonly<Record<string, number>> => spellInfo(id)?.fx ?? {};
/** Tiles round the caster a Guardian's Call reaches: what it turns. */
const CALL_REACH = spellInfo('blade_guardians_call')?.radius ?? 5;
/** Seconds a Shield Bash puts a creature's next blow back: how long it is shown reeling. */
const BASH_BACK = fxOf('blade_shield_bash').back ?? 2;

/* ---- the spells ---------------------------------------------------------------------------- */

export const BLADE: Record<string, SpellVisual> = {
  // Measured Cut (strike, on enemy): A blow at 130% that cannot miss, on an enemy within your reach.
  // The measure: a ruled brass line from the point to the creature through the held beat, which the cut then
  // follows exactly -- it cannot miss -- and a straight cut left hanging across it that parts.
  blade_measured_cut: {
    palette: PALETTE,
    cast: { timing: { secs: 1.1, release: 0.53 }, pose: measuredCut, close: closeOf(MEASURED) },
    fx: {
      charge: (k, t) => {
        // The measure taken: drawn out from the left hand's reach to the creature and held at full to the blow,
        // shortening as the Blade runs it in; on the blow it goes white along its length and is gone.
        const m = smooth(seg(t, 0.12, 0.2)) * (1 - seg(t, 0.56, 0.64));
        if (m > 0.01) {
          const a = k.hand(0), b = k.heart(k.target);
          const grow = smooth(seg(t, 0.12, 0.3)), lit = bump(t, 0.5, 0.55, 0.64);
          k.ribbon([a, mid3(a, b, grow * 0.5), mid3(a, b, grow)], { ...BRASS, main: lit > 0.3 ? BRASS_CORE : PALETTE.accent, core: PALETTE.core, width: 1.4 + 1.6 * lit, taper: 'none', alpha: 0.85 * m, glow: 0.4 + 0.6 * lit });
          // Its ticks, at even steps, the last on the creature.
          for (let i = 1; i <= 3; i++) if (grow > i / 3 - 0.02) k.flare(mid3(a, b, i / 3), 3 + (i === 3 ? 2 : 0), 0.8 * m, BRASS_CORE, 0, undefined, true);
        }
        k.glow(tipOf(k), 5, 0.6 * bump(t, 0.2, 0.42, 0.5));
        rush(k, t, MEASURED);
        notePoint(k);
        if (t > 0.46 && t < 0.72) swept(k, 1, { secs: 0.12 });
      },
      release: noteTravel,
      travel: { secs: bridgeSecs, draw: (k, u) => bridge(k, k.heart(k.target), u) },
      hit: (k) => {
        const f = frameOf(k);
        clash(k, k.heart(k.target), 26, f.fwd, 1.8);
        k.burst(k.heart(k.target), 8, { kind: 'shard', colour: [PALETTE.main, PALETTE.core], size: 1.6, life: [0.3, 0.6], speed: [0.4, 1.0], up: [8, 20], heading: f.fwd, cone: 1.6, gravity: 50, ink: false });
      },
      impact: { secs: 0.7, draw: (k, u) => {
        // Down through it the way the blade came: one long straight cut opened out from where the blade went in,
        // held a beat and then parted -- what cannot miss, cut clean.
        const [a, b] = slant(k, k.heart(k.target), 44, 40);
        cutLine(k, a, b, { grow: smooth(u / 0.1), part: smooth(seg(u, 0.35, 1)), alpha: 1 - seg(u, 0.72, 1), width: 4, floor: k.target.z + 1.5 });
        k.flare(k.heart(k.target), 7 * (1 - u), flashOf(u, 0.08), PALETTE.core, 0.6);
        k.light(k.target, 1.4, 0.7 * (1 - u), '#fff1d6');
      } },
    },
  },

  // Challenge (curse, on enemy, lasts 10 s): The creature turns on you at once and hunts only you for 10 s.
  // A salute, then the point laid on it: a taut brass line from the point to the creature, and crossed swords
  // over it for as long as it hunts you, a dart under it turned at you, and the measure running out.
  blade_challenge: {
    palette: PALETTE,
    // The point kept on it while the line runs out and is taut, before the sword is lowered.
    cast: { timing: { secs: 1.15, release: 0.55 }, pose: challenge, hold: { at: 0.8, secs: 0.55 } },
    fx: {
      charge: (k, t) => {
        // The salute's glint as the hilt comes up before the face, and down the blade as it is laid on the creature.
        k.flare(mid3(k.hand(1), tipOf(k), 0.85), 7, bump(t, 0.2, 0.3, 0.42), PALETTE.core, 0.3);
        if (t > 0.42 && t < 0.62) swept(k, 0.85, { secs: 0.12, inner: 0.5 });
      },
      // The line run out from the point, where the point is laid on it at the release, to its heart.
      travel: { secs: (tiles) => 0.12 + tiles * 0.03, draw: (k, u) => {
        const a = k.once('rel', () => tipOf(k)), b = k.heart(k.target);
        k.ribbon([a, mid3(a, b, smooth(u) * 0.5), mid3(a, b, smooth(u))], { ...BRASS, width: 1.8, taper: 'none', glow: 0.6 });
      } },
      hit: (k) => {
        k.burst(k.at(k.target, 1.05), 6, { kind: 'spark', colour: [BRASS_CORE, PALETTE.core], size: 1.8, life: [0.3, 0.6], speed: [0.3, 0.7], up: [4, 12], gravity: 0, over: true });
        clash(k, k.heart(k.target), 10, k.toward(k.target, k.caster), 1.4, 0.6);
      },
      impact: { secs: 0.6, draw: (k, u) => {
        // Taut from where the point was laid on it, which the pose holds there; gone as the sword is lowered, rather
        // than left hanging in the air off a point that has gone.
        const a = k.once('rel', () => tipOf(k)), b = k.heart(k.target);
        const off = Math.hypot(k.sx(tipOf(k)) - k.sx(a), k.sy(tipOf(k)) - k.sy(a)) / k.zoom;
        const al = (1 - u) * (1 - smooth(seg(off, 1.5, 5)));
        k.ribbon([a, mid3(a, b, 0.5), b], { ...BRASS, width: 1.8 * (1 - 0.6 * u), taper: 'none', alpha: al, glow: 0.6 });
        k.flare(k.at(k.target, 1.15), 10 * (1 - u), flashOf(u, 0.1), BRASS_CORE, 0, undefined, true);
      } },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.3) * smooth(left / 0.6);
        const b = k.target, top = k.at(b, 1.18);
        // Crossed swords, struck together as it lands and then riding over it, bobbing a little.
        const lift = { ...top, z: top.z + 1.2 * Math.sin(age * 2.4) };
        const open = 0.55 + 0.3 * (1 - smooth(age / 0.25));
        swordGlyph(k, lift, 12, Math.PI - open, a, { brass: true });
        swordGlyph(k, lift, 12, Math.PI + open, a);
        // Turned at you: a dart on the ground at its feet, pointed at you. Where its body would stand over it (you
        // behind it on the screen) it is put off to the side of its feet across the screen instead -- clear of the
        // body and of the swords over it, which further out behind would sit right under.
        const d = k.toward(b, k.caster), r = markR(b);
        const ex = k.sx(k.caster) - k.sx(b), ey = k.sy(k.caster) - k.sy(b);
        const behind = ey < 0 && Math.abs(ex) < -ey * 1.2;
        const side = across(k), sd = ex >= 0 ? 1 : -1, out = r + 0.05;
        const at = behind ? { x: b.x + side.x * sd * (r + 0.1), y: b.y + side.y * sd * (r + 0.1) } : { x: b.x + d.x * out, y: b.y + d.y * out };
        dart(k, at, d, 0.24, 0.95 * a);
        measureFor(k, b, r, age, left);
        // Now and then a pulse down the tie between you, from it to you: it is coming. The tie shows faintly under it.
        // The first after the line from the point is gone, so the two never lie side by side.
        const ph = ((age + 1.4) % 2.2) / 2.2;
        if (ph < 0.45 && age > 0.75) {
          const from = k.heart(b), to = k.chest(), v = smooth(ph / 0.45), env = Math.sin((Math.PI * ph) / 0.45);
          k.ribbon([from, mid3(from, to, 0.5), to], { ...BRASS, width: 1, taper: 'none', alpha: a * 0.3 * env, glow: 0 });
          // A short brass stroke running down the line, long enough to read as going somewhere.
          const head = mid3(from, to, v), tail = mid3(from, to, Math.max(0, v - 0.12));
          k.ribbon([tail, mid3(tail, head, 0.5), head], { ...BRASS, width: 2.4, taper: 'start', alpha: a * 0.85 * env, glow: 0.6 });
        }
      } },
    },
  },

  // Lunge (strike, on enemy): You stride to an enemy up to 4 tiles off, over ground you could walk, and strike it at 150%.
  // The stride run in: wind lines streaming off behind for as far as the body really goes (the island's stride and
  // the closing in), dust kicked up, the body driving its last step; then the point straight through the creature
  // and out of its far side in a burst. Already in reach, no wind and no dust: only the lunge.
  blade_lunge: {
    palette: PALETTE,
    // The body carried over the ground the island put it across, from the start of the bound to the stamp of the lunge.
    cast: { timing: { secs: 0.85, release: 0.4 }, pose: lunge, move: { from: 0, to: 0.36 }, close: closeOf(LUNGING) },
    fx: {
      charge: (k, t) => {
        // The rush, as hard as the island's stride goes; the closing in adds its own.
        const came = k.from ? Math.hypot(k.caster.x - k.from.x, k.caster.y - k.from.y) : 0;
        rush(k, t, LUNGING, k.from ? clamp(came / 0.6) * (1 - smooth(seg(t, 0.3, 0.42))) : 0);
        // The thrust's own sweep, once the blade is level and going in.
        if (t > 0.3 && t < 0.6) swept(k, 1, { secs: 0.1, inner: 0.4 });
      },
      release: (k) => {
        if (boundOf(k.from ? Math.hypot(k.caster.x - k.from.x, k.caster.y - k.from.y) : 0, k.aim?.close ?? 0) < 0.2) return;
        const f = frameOf(k);
        k.burst(off(k.at(k.caster, 0), f, 0, 0.1, 1), 8, { kind: 'dust', colour: DUST, size: 2.6, life: [0.3, 0.6], speed: [0.3, 0.8], up: [2, 8], heading: { x: -f.fwd.x, y: -f.fwd.y }, cone: 2.6, gravity: 3, drag: 0.1 });
      },
      travel: { secs: bridgeSecs, draw: (k, u) => bridge(k, k.heart(k.target), u, { brass: true }) },
      hit: (k) => {
        const f = frameOf(k), h = k.heart(k.target);
        // Out of the far side: where the point comes through.
        const out = off(h, f, 0, 0.1 + k.target.wide / 40, 0);
        k.once('out', () => out);
        clash(k, out, 14, f.fwd, 0.7, 1.5);
      },
      impact: { secs: 0.6, draw: (k, u) => {
        const f = frameOf(k), h = k.heart(k.target);
        // The line of the thrust: from where the point was as it went in, through the heart and out past the far side.
        const a = k.once('tip', () => mid3(k.hand(1), tipOf(k), 0.4)), out = k.once('out', () => off(h, f, 0, 0.25, 0));
        const b = mid3(a, out, 1.15 + 0.2 * smooth(u * 3));
        k.ribbon([a, mid3(a, b, 0.5), mid3(a, b, 0.8), b], { ...BRASS, width: 3 * (1 - 0.6 * u), taper: 'both', alpha: 1 - seg(u, 0.4, 0.85), glow: 0.6 });
        // The exit: a star of short rays out of the far side along the thrust, flung out and gone.
        exitBurst(k, out, f.fwd, u);
        k.flare(out, 8 * (1 - u), flashOf(u, 0.06), PALETTE.core, 0.785);
        k.light(out, 1.4, 0.8 * (1 - u), '#fff1d6');
      } },
    },
  },

  // Hamstring (strike, on enemy, lasts 10 s): A blow at 80%; for 10 s it walks, hunts and flees at 50% of its pace.
  // Low and flat at its legs: a brass cut across them at knee height; then, for as long as it lasts, one thin brass
  // band round its legs, a hind foot dragged -- a furrow scored behind it, a brass tick across it at every dragged
  // step -- and the thin measure of the ten seconds round its feet.
  blade_hamstring: {
    palette: PALETTE,
    cast: { timing: { secs: 0.85, release: 0.48 }, pose: hamstring, close: closeOf(HAMSTRUNG) },
    fx: {
      charge: (k, t) => {
        rush(k, t, HAMSTRUNG);
        notePoint(k);
        if (t > 0.38 && t < 0.8) swept(k, 1, { secs: 0.14 });
      },
      release: noteTravel,
      travel: { secs: bridgeSecs, draw: (k, u) => bridge(k, k.at(k.target, 0.22), u) },
      hit: (k) => {
        const f = frameOf(k), legs = k.at(k.target, 0.22);
        clash(k, legs, 20, f.right, 2, 0.8);
        k.burst(k.at(k.target, 0.05), 6, { kind: 'dust', colour: DUST, size: 2.4, life: [0.3, 0.5], speed: [0.2, 0.5], up: [2, 6], gravity: 3 });
      },
      impact: { secs: 0.55, draw: (k, u) => {
        const legs = k.at(k.target, 0.22);
        // Level and low, across its legs: low on the legs a cut is never read as a thrust from the side, so it may
        // come nearer the blow's line than a high one, and it is kept a hair over the ground at both ends.
        const [a, b] = slant(k, legs, 30, -6, 20);
        const floor = k.target.z + 1.2;
        for (const p of [a, b]) p.z = Math.max(p.z, floor);
        cutLine(k, a, b, { grow: smooth(u / 0.12), part: smooth(seg(u, 0.4, 1)), alpha: 1 - seg(u, 0.7, 1), width: 3.4 });
        k.flare(legs, 6 * (1 - u), flashOf(u, 0.1), PALETTE.core, 0);
        k.light(k.target, 1.4, 0.6 * (1 - u), '#fff1d6');
      } },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.3) * smooth(left / 0.6);
        const b = k.target, r = 0.06 + (b.wide / 40) * 0.6;
        // The hobble: one thin brass band round its legs, pulled tight as it lands, and jerked tight again at every
        // hitch of the dragged foot (`hobbled`), a beat slower than a free step.
        const hitch = age > 0.5 ? Math.max(0, 1 - ((age - 0.5) % 1.6) / 0.25) : 0;
        const tight = 1 + 0.5 * (1 - smooth(age / 0.3)) - 0.18 * hitch * hitch;
        hoop(k, k.at(b, 0.18 + 0.03 * hitch), r * tight, { alpha: a * 0.9, width: 1.4 + 0.6 * hitch, brass: true, foot: b });
        // The ten seconds, a thin measure round its feet.
        measureFor(k, b, markR(b), age, left, 0.85, { band: 0.024 });
        hobbled(k, b, age, a);
      } },
    },
  },

  // Shield Bash (strike, on enemy): With a shield in your off hand: a crushing blow at 70% that knocks a heavy blow off its stroke and puts its next blow back 2 s.
  // Blunt, not sharp: a face of light the shape of the shield slammed flat into it, a shock going through, and
  // the creature reeling for the 2 s its next blow is put back, with the measure for those seconds under it.
  blade_shield_bash: {
    palette: PALETTE,
    cast: { timing: { secs: 0.75, release: 0.42 }, pose: shieldBash, close: closeOf(BASHING) },
    fx: {
      charge: (k, t) => {
        k.glow(k.hand(0), 7, 0.6 * bump(t, 0.15, 0.4, 0.5));
        rush(k, t, BASHING);
      },
      // Short of it (on the move), the shield's face goes the rest of the way.
      travel: { secs: bridgeSecs, draw: (k, u) => {
        const from = k.once('rel', () => shieldAt(k));
        shieldFace(k, mid3(from, k.heart(k.target), smooth(u)), 1, 0.85);
      } },
      hit: (k) => {
        const f = frameOf(k), h = k.heart(k.target);
        k.once('face', () => mid3(shieldAt(k), h, 0.35));
        clash(k, off(h, f, 0, -0.12, 0), 18, { x: -f.fwd.x, y: -f.fwd.y }, 2.6, 0.7);
        k.burst(k.at(k.target, 0.02), 6, { kind: 'dust', colour: DUST, size: 2.4, life: [0.3, 0.5], speed: [0.3, 0.7], up: [2, 6], heading: f.fwd, cone: 1.6, gravity: 3, drag: 0.1 });
      },
      impact: { secs: 0.6, draw: (k, u) => {
        const f = frameOf(k);
        // The shield's own face, struck into it: the shape of what is on the arm, larger, flat on to the blow, held
        // at full for the moment of the blow and then gone on through it.
        const c = off(k.once('face', () => k.heart(k.target)), f, 0, 0.1 * smooth(u), 0);
        shieldFace(k, c, 1.5 + 0.5 * smooth(u * 2), 0.95 * (1 - smooth(seg(u, 0.25, 0.6))));
        // The shock going on through it.
        for (let i = 0; i < 2; i++) {
          const v = clamp(u * 1.5 - i * 0.2);
          if (v <= 0 || v >= 1) continue;
          k.slash(k.target, { u: 1, from: 0.9, to: -0.9, tilt: Math.PI / 2, reach: 3 + 10 * v, up: k.target.tall * 0.5, width: 3.2 * (1 - v), length: 1.8, alpha: 0.8 * (1 - v), glow: 0.4 });
        }
        k.light(k.target, 1.4, 0.6 * (1 - u), '#fff1d6');
      } },
      linger: { secs: BASH_BACK, draw: (k, age, left) => {
        const a = smooth(age / 0.25) * smooth(left / 0.4);
        const top = k.at(k.target, 1.1);
        // Reeling for exactly the seconds its next blow is put back: three brass pips going round over it, wobbling,
        // with a little light of their own so they stand out of the dark.
        for (let i = 0; i < 3; i++) {
          const ang = age * 5 + (i * TAU) / 3;
          const p = { x: top.x + Math.cos(ang) * 0.12, y: top.y + Math.sin(ang) * 0.12, z: top.z + 1.2 * Math.sin(ang * 2) };
          k.mark(p, { r: 2.6, points: 4, turn: age * 6 + i, alpha: a, glow: 0.4 + 0.6 * k.night, light: k.night > 0.3 ? BRASS_CORE : undefined });
        }
        k.light(top, 0.8, 0.25 * a, '#fff1d6');
      } },
    },
  },

  // Second Breath (buff, on self): Costs no stamina. 40% of a full bar of stamina back at once.
  // The breath drawn in: streams of cold air pulled in to the chest from round about; then it goes out in a
  // white breath and a ring off the chest, and the measure fills to the share of a full bar given back.
  blade_second_breath: {
    palette: PALETTE,
    cast: { timing: { secs: 1.1, release: 0.5 }, pose: secondBreath },
    fx: {
      charge: (k, t) => {
        // The draw: wisps of air one after another out of the ground close round about, each spiralling in and up to
        // the chest and gone into it, quicker as the breath deepens.
        const c = k.chest();
        const n = k.fast ? 4 : 7;
        for (let i = 0; i < n; i++) {
          const s0 = 0.12 + (0.3 * i) / n;
          const v = seg(t, s0, s0 + 0.2 - 0.06 * (i / n));
          if (v <= 0 || v >= 1) continue;
          const a0 = (i / n) * TAU * 1.618 + hashOf(k.seed, i) * 0.6;
          const pts: P3[] = [];
          for (let j = 0; j <= 5; j++) {
            const w = clamp(v - 0.4 * (1 - j / 5));
            const e = w * w;
            const rr = 0.6 * (1 - e);
            const ang = a0 + e * 2.4;
            pts.push({ x: c.x + Math.cos(ang) * rr, y: c.y + Math.sin(ang) * rr, z: lerp(k.caster.z + 3, c.z, Math.sqrt(w)) });
          }
          k.ribbon(pts, { main: BREATH, core: PALETTE.core, width: 2, taper: 'start', alpha: 0.85 * Math.sin(Math.PI * v), glow: 0.4, edge: false });
        }
        // The out-breath, in front of the face.
        if (t > 0.52 && t < 0.72) k.emit(k.local(k.caster, 0, 2.5, k.head().z - k.caster.z - 1.5), 40, { kind: 'mist', colour: BREATH, size: 2.4, life: [0.5, 0.9], speed: [0.15, 0.35], up: [1, 3], heading: k.facingDir(k.caster), cone: 0.8, gravity: -2, drag: 0.3 });
      },
      hit: (k) => {
        // The breath let go off the chest: a puff of it, not a spark of anything.
        k.burst(k.chest(), 8, { kind: 'mist', colour: BREATH, size: 2.6, life: [0.4, 0.8], speed: [0.3, 0.6], up: [1, 4], gravity: -1, drag: 0.2 });
      },
      impact: { secs: 1.3, draw: (k, u) => {
        const c = k.chest();
        // A small ring off the chest, level, going out and thinning: a breath let go, under the gauge that says it.
        const v = clamp(u / 0.7);
        hoop(k, c, 0.12 + 0.45 * (1 - Math.pow(1 - v, 2)), { alpha: (1 - v) * 0.45, width: 1.4 * (1 - v) + 0.4, foot: k.caster });
        // What came back, on the stamina gauge at the feet: its share of a full bar lit a segment at a time, in the
        // breath's own colour and not the brass of time kept count of.
        breathGauge(k, k.caster, 0.44, (k.fx.stamina ?? 0.4) * smooth(u / 0.4), (1 - seg(u, 0.75, 1)) * smooth(u / 0.08));
        k.light(k.caster, 1.4, 0.5 * (1 - u), '#fff1d6');
      } },
    },
  },

  // Deflect (buff, on self, lasts 6 s): For 6 s, every blow you block lands back on what struck at 50% of the blow.
  // The parry left hanging: the upright sword's edge doubled in light, a crescent bowed out beside the blade, a glint
  // running up it, and now and then a blow met on it -- a flare of steel and a brass stroke thrown back out the way
  // the blow came -- with the measure of the six seconds at the feet.
  blade_deflect: {
    palette: PALETTE,
    // The guard held for the six seconds the parry hangs, so the body keeps what the buff says.
    cast: { timing: { secs: 0.65, release: 0.35 }, pose: deflect, hold: { at: 0.5 } },
    fx: {
      charge: (k, t) => {
        if (t > 0.12 && t < 0.45) swept(k, 0.9, { secs: 0.1, inner: 0.5 });
      },
      hit: (k) => {
        const p = mid3(k.hand(1), tipOf(k), 0.6);
        clash(k, p, 16, k.facingDir(k.caster), 2.2, 0.9);
        k.flare(p, 6, 1, PALETTE.core, 0.3);
      },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.2) * smooth(left / 0.5);
        const b = k.caster, st = k.state;
        // Sprung out wide as the guard is taken, then drawn in to lie close along the blade.
        const open = 1 + 0.6 * (1 - smooth(age / 0.25));
        // The edge of the upright sword doubled in light: a crescent from below the hilt up past the point, bowed out
        // beside the blade on its outer side as the screen has it -- away from the body -- so from every side it is
        // the same shape in the same place, the parrying edge standing by the sword. Once the guard is let go (walked
        // off), it stays where the guard was.
        const live = smooth(k.castLeft / 0.3);
        const H0 = k.local(b, 2, 4, b.tall * 0.5), T0 = k.local(b, 2, 5, b.tall * 0.5 + 12);
        const H = mid3(H0, k.hand(1), live), T = mid3(T0, tipOf(k), live);
        const A = mid3(H, T, -0.2), B = mid3(H, T, 1.25);
        if (st.dside === undefined) {
          const away = k.sx(H) - k.sx(k.chest());
          const ahead = k.sx(k.local(b, 0, 4, 0)) - k.sx(b), right = k.sx(k.local(b, 4, 0, 0)) - k.sx(b);
          st.dside = Math.abs(away) > 1.5 * k.zoom ? Math.sign(away) : Math.abs(ahead) > 1.5 * k.zoom ? Math.sign(ahead) : Math.sign(right) || 1;
        }
        // Square off the blade on the screen, on the outer side.
        let px = -(k.sy(B) - k.sy(A)), py = k.sx(B) - k.sx(A);
        const pl = Math.hypot(px, py) || 1;
        px /= pl; py /= pl;
        if (Math.sign(px) !== st.dside) { px = -px; py = -py; }
        const at = (s: number, out = 0): P3 => {
          const bow = (1.8 + 5 * Math.sin(Math.PI * clamp(s)) + out) * open;
          return nudge(k, mid3(A, B, s), px * bow, -py * bow);
        };
        const n = k.fast ? 6 : 10;
        const arc: P3[] = [];
        for (let i = 0; i <= n; i++) arc.push(at(i / n));
        k.ribbon(arc, { width: 3.2, taper: 'both', alpha: 0.85 * a, glow: 0.5 + 0.5 * k.night, bias: 3 });
        // The glint running up it.
        const g = (age * 0.8) % 1.4;
        if (g < 1) k.flare(at(g, 0.3), 4.5, a * Math.sin(Math.PI * g), PALETTE.core, 0.3);
        // A blow met: every so often, somewhere along it.
        const beat = Math.floor(age / 1.4);
        if (st.beat !== beat && age > 0.6 && left > 0.6) {
          st.beat = beat;
          const s = 0.35 + 0.45 * hashOf(k.seed, beat);
          clash(k, at(s), 9, k.facingDir(b), 1.2, 0.8);
          st.met = age;
          st.ms = s;
        }
        const since = age - (st.met ?? -9);
        if (since < 0.5) {
          const v = since / 0.5, f = k.facingDir(b), p = at(st.ms);
          if (v < 0.5) k.flare(p, 7 * (1 - 2 * v), a, PALETTE.core, 0.4);
          // What lands back: a brass stroke thrown out from it, on along the way the Blade faces, at chest height.
          const head = 0.15 + 0.55 * easeOut(v), tail = Math.max(0.05, head - 0.35);
          const q0 = { x: p.x + f.x * tail, y: p.y + f.y * tail, z: p.z }, q1 = { x: p.x + f.x * head, y: p.y + f.y * head, z: p.z };
          k.ribbon([q0, mid3(q0, q1, 0.5), q1], { ...BRASS, width: 3.4, taper: 'start', alpha: a * (1 - smooth(seg(v, 0.5, 1))), glow: 0.5 });
        }
        // The six seconds, a thin measure at the feet.
        measureFor(k, b, 0.34, age, left, 0.85, { band: 0.02 });
      } },
    },
  },

  // Hold the Line (buff, on self, lasts 15 s): For 15 s your wounds bleed 50% less, and those on your arms do not slow your swing.
  // The sword driven point down into the ground: a line scored across the ground where it went in, in brass, and
  // for as long as it lasts steel bands bound round both forearms -- arms that keep their swing -- with the
  // measure running out under the feet.
  blade_hold_the_line: {
    palette: PALETTE,
    cast: { timing: { secs: 1.2, release: 0.55 }, pose: holdTheLine },
    fx: {
      charge: (k, t) => {
        k.flare(tipOf(k), 6, bump(t, 0.26, 0.4, 0.5), PALETTE.core, 0.2);
        if (t > 0.44 && t < 0.62) swept(k, 0.9, { secs: 0.1 });
      },
      hit: (k) => {
        const tip = tipOf(k);
        const p = k.on(tip.x, tip.y, 0.5);
        clash(k, p, 24, undefined, 0, 0.7);
        k.burst(p, 10, { kind: 'dust', colour: DUST, size: 2.6, life: [0.3, 0.6], speed: [0.3, 0.8], up: [3, 10], gravity: 4, drag: 0.1 });
        // Where the line lies: through where the point went in, across the way the Blade faces, kept where it was
        // scored. Square across, unless that runs it up the screen (the Blade side on), where a line on the ground
        // reads as a blade stood upright: then it is laid along the nearer of the ground's diagonals, still across.
        const f = k.facingDir(k.caster), st = k.state;
        st.lx = tip.x; st.ly = tip.y;
        let dx = -f.y, dy = f.x;
        const o = k.on(st.lx, st.ly), q = k.on(st.lx + dx, st.ly + dy);
        if (Math.abs(k.sy(q) - k.sy(o)) > 1.2 * Math.abs(k.sx(q) - k.sx(o))) {
          const c = Math.SQRT1_2;
          [dx, dy] = [c * (dx - dy), c * (dx + dy)];
        }
        st.dx = dx; st.dy = dy;
      },
      impact: { secs: 1.6, draw: (k, u) => {
        const s = k.state;
        if (s.lx === undefined) return;
        // Scored outward both ways from the point, fast.
        const half = HOLD_HALF * smooth(u / 0.1);
        const [a, b] = holdLine(k, half);
        const al = 1 - 0.7 * seg(u, 0.55, 1);
        scored(k, a, b, 0.045, al);
        if (u < 0.1) k.flare(mid3(a, b, 0.5), 8, 1 - u / 0.1, BRASS_CORE, 0, undefined, true);
        // Sparks running out along it to its two ends as it is scored.
        if (u < 0.12) for (const q of [a, b]) k.emit(q, 120, { kind: 'spark', colour: [BRASS_CORE, PALETTE.core], size: 1.4, life: [0.12, 0.3], speed: [0.3, 0.8], up: [6, 16], gravity: 60, over: true });
        k.light({ x: s.lx, y: s.ly }, 1.4, 0.5 * (1 - u), '#fff1d6');
      } },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.4) * smooth(left / 0.6);
        const b = k.caster, s = k.state;
        // The line held: left faint on the ground for as long as the Blade stands on it, gone once it walks off.
        if (s.lx !== undefined && age > 1.6) {
          const on = 1 - smooth(seg(Math.hypot(b.x - s.lx, b.y - s.ly), 0.5, 0.7));
          if (on > 0.01) {
            const [p, q] = holdLine(k, HOLD_HALF);
            scored(k, p, q, 0.045, 0.3 * a * on);
          }
        }
        // Bound as it lands: each band drawn tight from wider than the arm.
        const bind = 1 + 0.8 * (1 - smooth(age / 0.3));
        for (let i = 0; i < 2; i++) bracer(k, k.joint(b, `elbow${i}`), k.joint(b, `wrist${i}`), a, bind);
        // Bleeding held back: now and then three drops run down the arm nearer the viewer, one after another, and each
        // is stopped dead at the band -- it glints as it takes it -- and dries to nothing there.
        if (age > 0.6) staunched(k, b, (age - 0.6) % 3.2, a);
        measureFor(k, b, 0.4, age, left);
      } },
    },
  },

  // Disarming Cut (strike, on enemy, lasts 30 s): A blow at 70%; its next 3 blows within 30 s do 40% less damage.
  // A rising flick through its guard: a brass cut from low to high, steel chips thrown up off it, and over it
  // three broken swords -- its next three blows, blunted -- with the measure of the thirty seconds under it.
  blade_disarming_cut: {
    palette: PALETTE,
    cast: { timing: { secs: 0.8, release: 0.4 }, pose: disarmingCut, close: closeOf(DISARMING) },
    fx: {
      charge: (k, t) => {
        rush(k, t, DISARMING);
        notePoint(k);
        if (t > 0.3 && t < 0.66) swept(k, 1, { secs: 0.13 });
      },
      release: noteTravel,
      travel: { secs: bridgeSecs, draw: (k, u) => bridge(k, k.at(k.target, 0.62), u) },
      hit: (k) => {
        const f = frameOf(k), h = k.at(k.target, 0.62);
        clash(k, h, 18, f.fwd, 2.4, 0.9);
        // Chips knocked off whatever it fights with, up and away.
        k.burst(h, 9, { kind: 'shard', colour: [PALETTE.main, PALETTE.deep, PALETTE.core], size: 1.6, life: [0.5, 0.9], speed: [0.4, 1.1], up: [18, 34], heading: f.right, cone: 2.4, gravity: 60, spin: 3 });
      },
      impact: { secs: 0.6, draw: (k, u) => {
        // From low on the caster's left to high on its right: the way the blade went up, steeper than a cut down.
        const [b, a] = slant(k, k.at(k.target, 0.62), 36, 58);
        cutLine(k, a, b, { grow: smooth(u / 0.12), part: smooth(seg(u, 0.4, 1)), alpha: 1 - seg(u, 0.7, 1), width: 3.2, floor: k.target.z + 1.5 });
        k.flare(k.at(k.target, 0.62), 7 * (1 - u), flashOf(u, 0.08), PALETTE.core, 0.3);
        k.light(k.target, 1.4, 0.6 * (1 - u), '#fff1d6');
      } },
      linger: { draw: (k, age, left) => {
        // Its next blows, blunted, one broken sword each; and under it the measure of the thirty seconds they are
        // blunted for, which the swords do not say (they count blows, not time).
        const a = smooth(age / 0.4) * smooth(left / 0.8);
        brokenBlades(k, k.at(k.target, 1.14), k.fx.blows ?? 3, 11, a, age);
        measureFor(k, k.target, markR(k.target), age, left, 0.85, { band: 0.03 });
      } },
    },
  },

  // Measured Breathing (buff, on self, lasts 20 s): For 20 s a swing or a draw costs no stamina.
  // One slow breath, the hand on the belly: a ring under the feet drawn in and let out with it, and for as long
  // as it lasts that ring breathing slowly under the Blade, the measure running round inside it.
  blade_measured_breathing: {
    palette: PALETTE,
    cast: { timing: { secs: 1.6, release: 0.6 }, pose: measuredBreathing },
    fx: {
      charge: (k, t) => {
        // The stamina gauge filled by the in-breath, a segment at a time, and full when it is held: the gauge the
        // linger keeps, at the linger's own size, handed over as the spell lands.
        const fill = smooth(seg(t, 0.16, 0.44));
        breathGauge(k, k.caster, 0.5, fill, (0.95 - 0.45 * seg(t, 0.5, 0.6)) * seg(t, 0.04, 0.14) * (1 - smooth(seg(t, 0.6, 0.7))));
        if (t > 0.5 && t < 0.76) k.emit(k.local(k.caster, 0, 2.5, k.head().z - k.caster.z - 1.5), 30, { kind: 'mist', colour: BREATH, size: 2, life: [0.6, 1.1], speed: [0.06, 0.16], up: [1, 3], heading: k.facingDir(k.caster), cone: 0.8, gravity: -2, drag: 0.4 });
      },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.15) * smooth(left / 0.8);
        // The gauge full, and never running down while it lasts: a swing or a draw takes nothing from it. It breathes
        // with the Blade, a breath every four seconds, and a breath shows at the mouth on each out-breath.
        const ph = (age % 4) / 4;
        const breath = smooth(seg(ph, 0, 0.4)) - smooth(seg(ph, 0.5, 0.95));
        // And round its rim, in the brass of time kept count of, what is left of the twenty seconds: a lip running
        // round once, while the stamina stays full.
        breathGauge(k, k.caster, 0.5 + 0.03 * breath, 1, (0.5 + 0.2 * breath) * a, left / Math.max(1e-3, age + left));
        if (!k.fast && ph > 0.5 && ph < 0.7) k.emit(k.local(k.caster, 0, 2.5, k.head().z - k.caster.z - 1.5), 6, { kind: 'mist', colour: BREATH, size: 1.6, life: [0.6, 1], speed: [0.04, 0.1], up: [1, 2], heading: k.facingDir(k.caster), cone: 0.8, gravity: -2, drag: 0.4 });
      } },
    },
  },

  // Guardian’s Call (nova, on self, 5 tiles round, lasts 8 s): Every creature within 5 tiles of you that is hunting somebody turns on you and hunts only you for 8 s.
  // The sword thrust up: a ring of brass going out over the ground to exactly its reach, darts round its edge all
  // turned in at the Blade, and the sword raised over the Blade's head like a standard while they come.
  blade_guardians_call: {
    palette: PALETTE,
    cast: { timing: { secs: 1.3, release: 0.5 }, pose: guardiansCall },
    fx: {
      charge: (k, t) => {
        if (t > 0.32 && t < 0.6) swept(k, 0.9, { secs: 0.12, inner: 0.4 });
        k.flare(tipOf(k), 9, bump(t, 0.44, 0.52, 0.8), PALETTE.core, 0);
      },
      hit: (k) => {
        k.burst(k.at(k.caster, 0.05), 16, { kind: 'dust', colour: DUST, size: 2.8, life: [0.4, 0.7], speed: [CALL_REACH * 0.25, CALL_REACH * 0.5], up: [2, 6], gravity: 2, drag: 0.1 });
        k.burst(tipOf(k), 7, { kind: 'spark', colour: [BRASS_CORE, PALETTE.core], size: 1.6, life: [0.4, 0.8], speed: [0.2, 0.6], up: [4, 14], gravity: 0, over: true });
        k.flash(0.06);
      },
      impact: { secs: 1.0, draw: (k, u) => {
        wave(k, k.caster, smooth(u / 0.7), CALL_REACH, 1, { ...BRASS, band: 0.22, lip: BRASS_CORE });
        k.light(k.caster, 1.4, 0.7 * (1 - u), '#fff1d6');
      } },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.6) * smooth(left / 0.8);
        const b = k.caster;
        // The reach, faint, its edge dashed; and just inside it one round of darts stepping in at the Blade -- kept to
        // the edge, so the ground inside stays clear for the marks that matter.
        reachRing(k, b, CALL_REACH, 0.06, 0.55 * a, age * 0.05);
        const n = 6, step = (age * 0.55) % 1, rr = CALL_REACH * (1 - 0.12 * step);
        const wave6: Array<{ c: { x: number; y: number }; dir: { x: number; y: number } }> = [];
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * TAU + 0.3;
          const d = { x: -Math.cos(ang), y: -Math.sin(ang) };
          wave6.push({ c: { x: b.x - d.x * rr, y: b.y - d.y * rr }, dir: d });
        }
        darts(k, wave6, 0.3, a * 0.7 * Math.sin(Math.PI * step));
        // Every creature in reach that is after somebody, turned: a large dart at its feet pointed at the Blade, a brass
        // tick ring struck round it as the call reaches it, and a brass thread drawn taut from it to the Blade and let
        // go. The nearest six, to keep to the budget.
        const near = k.enemiesWithin(CALL_REACH, b).filter((c) => c.hostile);
        near.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
        const pull = 1 - smooth(seg(age, 0.4, 1.2));
        const turned: Array<{ c: { x: number; y: number }; dir: { x: number; y: number } }> = [];
        const ticks: number[][] = [];
        let tickA = 0;
        for (const c of near.slice(0, 6)) {
          const d = k.toward(c, b), r = markR(c);
          turned.push({ c: { x: c.x + d.x * (r + 0.16), y: c.y + d.y * (r + 0.16) }, dir: d });
          if (pull > 0.01) k.string(k.heart(c), k.chest(), { ...BRASS, alpha: pull * a, sag: 1.5 * (1 - pull), glow: 0.5 });
          // The tick: struck as the wave goes by it, closing in on it and gone.
          const hitAt = (Math.hypot(c.x - b.x, c.y - b.y) / CALL_REACH) * 0.7;
          const tick = seg(age, hitAt, hitAt + 0.5);
          if (tick > 0 && tick < 1) {
            const rr = r * (1.6 - 0.6 * smooth(tick)), q: number[] = [];
            for (let i = 0; i < 24; i++) q.push(c.x + Math.cos((i / 24) * TAU) * rr, c.y + Math.sin((i / 24) * TAU) * rr);
            ticks.push(q);
            tickA = Math.max(tickA, a * (1 - tick));
          }
        }
        // The ticks in one record, however many were struck.
        if (ticks.length) {
          k.groundShape(b.x, b.y, CALL_REACH + 0.6, [
            { kind: 'stroke', colour: PALETTE.ink, alpha: tickA, width: Math.max(2.2, 2.6 * k.zoom), paths: ticks, closed: true, lift: 0.18 },
            { kind: 'stroke', colour: PALETTE.accent, alpha: tickA, width: Math.max(1.2, 1.4 * k.zoom), paths: ticks, closed: true, lift: 0.2, glow: 0.5 * k.night, light: BRASS_CORE },
          ]);
        }
        darts(k, turned, 0.3, a);
        // The standard: a sword over the head, lit so it stands in the dark.
        const top = k.at(b, 1.25 + 0.03 * Math.sin(age * 2));
        swordGlyph(k, top, 12, Math.PI, a, { brass: true });
        k.light(top, 1.2, 0.3 * a, '#fff1d6');
        measureFor(k, b, 0.42, age, left);
      } },
    },
  },

  // Last Stand (buff, on self, lasts 10 s): Costs no stamina. Only below 25% of your health: for 10 s you take 60% less damage.
  // Down on a knee, then up: a ring of swords comes down point first into the ground all round the Blade -- a
  // palisade of steel to stand inside -- with a shock over the ground and a skin of steel flashing over the body
  // as it closes, standing for the ten seconds with the measure running out under it. The heaviest thing a Blade
  // wears.
  blade_last_stand: {
    palette: PALETTE,
    // The stand held upright before the face a moment, so it is seen, before it is let go.
    cast: { timing: { secs: 1.4, release: 0.55 }, pose: lastStand, hold: { at: 0.7, secs: 1.2 } },
    fx: {
      charge: (k, t) => {
        // Down on the knee: the light drawn in close round the body, low.
        const g = bump(t, 0.2, 0.45, 0.56);
        if (g > 0.01) {
          k.ring(k.caster, 0.5 - 0.18 * g, { ...BRASS, band: 0.025 + 0.02 * g, alpha: g, turn: k.now * 0.6, dash: 4 });
          k.emit(k.at(k.caster, 0.05), 50 * g, { kind: 'ember', colour: [BRASS_CORE, PALETTE.core], size: 1.5, life: [0.3, 0.6], speed: [0.05, 0.2], up: [6, 16], gravity: 0, jitter: 0.4, over: true });
        }
        if (t > 0.46 && t < 0.64) swept(k, 0.85, { secs: 0.12, brass: true });
      },
      hit: (k) => {
        clash(k, k.chest(), 30, undefined, 0, 1);
        k.burst(k.at(k.caster, 0.05), 20, { kind: 'dust', colour: DUST, size: 2.4, life: [0.3, 0.6], speed: [0.8, 1.6], up: [2, 8], gravity: 2, drag: 0.1 });
        k.flash(0.08, PALETTE.light);
      },
      impact: { secs: 0.8, draw: (k, u) => {
        // The shock of the stand, out to just past the ring of swords.
        wave(k, k.caster, u, 1.1, 0.55, { band: 0.04 });
        k.light(k.caster, 1.4, 0.9 * (1 - u), '#fff1d6');
      } },
      linger: { draw: (k, age, left) => {
        const a = smooth(left / 0.6);
        const b = k.caster;
        const n = k.fast ? 6 : 8, R = 0.5;
        // Each sword falls from over the head, one after another round the ring, and stands where it lands. Drawn as
        // two records rather than eight: the swords behind the Blade in one, under the body, and those in front in
        // another, over it, each lot nearest last.
        const L = 13, stand = (0.82 * L) / HEIGHT_SCALE, Rz = L * k.zoom, z = k.zoom;
        const by = k.sy(b);
        const back: number[] = [], front: number[] = [];
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * TAU + 0.2;
          const fall = smooth(seg(age, 0.03 * i, 0.03 * i + 0.16));
          if (fall <= 0) continue;
          const x = b.x + Math.cos(ang) * R, y = b.y + Math.sin(ang) * R;
          const p = k.on(x, y, stand + 26 * (1 - fall) * (1 - fall));
          const foot = k.on(x, y);
          // Leant a hair out from the middle, as swords stuck in the ground stand.
          const lean = ((k.sx(foot) - k.sx(b)) / (R * HALF_W * k.zoom * Math.SQRT2)) * 0.12;
          (k.sy(foot) < by ? back : front).push(k.sy(foot), k.sx(p), k.sy(p), lean, Math.min(1, fall * 3));
          if (fall >= 1 && !(k.state[`s${i}`] > 0)) {
            k.state[`s${i}`] = 1;
            k.burst(k.on(x, y, 0.5), 5, { kind: 'dust', colour: DUST, size: 2.4, life: [0.3, 0.6], speed: [0.1, 0.4], up: [2, 6], gravity: 3 });
            k.burst(k.on(x, y, 1), 4, { kind: 'spark', colour: [PALETTE.core, PALETTE.accent], size: 1.4, life: [0.15, 0.3], speed: [0.3, 0.8], up: [6, 16], gravity: 60 });
          }
        }
        // Those in front drawn smaller, their points kept in the ground, so the legs show between them.
        const lot = (q: number[], bias: number, size: number): void => {
          if (!q.length) return;
          const order = Array.from({ length: q.length / 5 }, (_, j) => j).sort((u, v) => q[5 * u] - q[5 * v]);
          const R = Rz * size, drop = 0.82 * (Rz - R);
          k.worldDraw(b, (g) => { for (const j of order) drawSword(g, q[5 * j + 1], q[5 * j + 2] + drop, R, q[5 * j + 3], a * q[5 * j + 4], z); }, bias);
        };
        lot(back, -0.5, 1);
        lot(front, 0.8, 0.85);
        k.glow(k.at(b, 0.3), 26, 0.3 * a);
        // A band of steel slammed down round the ring at the swords' height as it closes -- steel, not a skin -- and gone.
        if (age < 0.6) hoop(k, k.at(b, 0.3 + 0.3 * (1 - smooth(age / 0.15))), R * (1.2 - 0.2 * smooth(age / 0.15)), { alpha: 1 - smooth(seg(age, 0.2, 0.6)), width: 2.6, foot: b });
        measureFor(k, b, 0.5, age, left);
        // A little light off the steel for the ten seconds, so the ring of swords stands in the dark.
        k.light(b, 1.4, 0.35 * a * smooth(age / 0.4), '#fff1d6');
        // Steel catching the light: a glint going round the swords' blades one after another -- steel, and nothing
        // given back (it is damage kept off, not health).
        if (age > 0.4) {
          const gi = Math.floor(age / 0.7) % n, gu = (age % 0.7) / 0.7;
          const ang = (gi / n) * TAU + 0.2;
          const shine = k.on(b.x + Math.cos(ang) * R, b.y + Math.sin(ang) * R, stand);
          k.flare(shine, 4, a * Math.sin(Math.PI * gu), PALETTE.core, 0.3 + gu);
        }
      } },
    },
  },

};

/**
 * Two steel bands round a forearm running from `e` (elbow) to `w` (wrist), at its middle and toward the wrist:
 * each a short hoop square across the arm as the screen shows it, its near half drawn, so it wraps the arm
 * rather than lying on it. `bind` above one draws them wider than the arm, for the moment they are put on.
 */
function bracer(k: FxScene, e: P3, w: P3, alpha: number, bind = 1): void {
  if (alpha <= 0.01) return;
  const ang = Math.atan2(k.sy(w) - k.sy(e), k.sx(w) - k.sx(e));
  const R = 2.2 * k.zoom * bind;
  const at = [mid3(e, w, 0.42), mid3(e, w, 0.8)];
  const pts = at.map((p) => [k.sx(p), k.sy(p)]);
  k.worldDraw(at[0], (g) => {
    g.globalAlpha = clamp(alpha * Math.min(1, 2.2 - bind));
    for (const [x, y] of pts) {
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.lineWidth = 1.6 * k.zoom + Math.max(1, 0.9 * k.zoom);
      g.strokeStyle = PALETTE.ink;
      g.beginPath();
      g.ellipse(0, 0, R * 0.38, R, 0, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      g.lineWidth = 1.6 * k.zoom;
      g.strokeStyle = PALETTE.main;
      g.stroke();
      g.lineWidth = Math.max(0.6, 0.6 * k.zoom);
      g.strokeStyle = PALETTE.core;
      g.beginPath();
      g.ellipse(0, 0, R * 0.38, R, 0, -Math.PI / 2, -0.2);
      g.stroke();
      g.restore();
    }
  }, 3);
  k.glow(at[0], 3.5, alpha * 0.35);
}

/**
 * `n` swords snapped in two, side by side in the air over `p`, `r` pixels at zoom one each: each stood hilt down --
 * pommel, grip and a broad brass guard -- with a long stub of steel blade going up from the guard to a jagged break,
 * and just over it, across a hair of air, the lost point, tilted off the line and rocking: one sword, broken. Steel
 * with a lit edge down its left, inked, the point as solid as the stub so the eye joins them. A creature's next
 * blows, blunted -- one each. All in one record, as they always sort together over the one head.
 */
function brokenBlades(k: FxScene, p: P3, n: number, r: number, alpha: number, age: number): void {
  if (alpha <= 0.01 || n <= 0) return;
  const x0 = k.sx(p), y0 = k.sy(p), R = r * k.zoom, gap = R * 0.95;
  const W = 0.15, L = 0.12;
  const poly = (g: CanvasRenderingContext2D, pts: ReadonlyArray<readonly [number, number]>): void => {
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px * R, py * R) : g.moveTo(px * R, py * R)));
    g.closePath();
  };
  // Up is minus. The stub from the guard (0.3) up to its jagged break (about -0.1), and the lit strip down its left;
  // the lost point from its own jagged base (0) up to its tip, the lit strip likewise.
  const stub = [[-W, 0.3], [-W, -0.05], [-W * 0.4, -0.14], [0, -0.05], [W * 0.5, -0.17], [W, -0.08], [W, 0.3]] as const;
  const stubLit = [[-W, 0.3], [-W, -0.05], [-W * 0.4, -0.14], [-W + L, -0.1], [-W + L, 0.3]] as const;
  const point = [[-W, 0.02], [-W * 0.4, -0.06], [0, 0.03], [W * 0.5, -0.08], [W, 0.0], [W * 0.85, -0.3], [0, -0.46], [-W * 0.85, -0.3]] as const;
  const pointLit = [[-W, 0.02], [-W * 0.4, -0.06], [-W + L, -0.04], [-W + L * 0.8, -0.32], [0, -0.46], [-W * 0.85, -0.3]] as const;
  const z = k.zoom;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'miter';
    g.lineWidth = Math.max(0.8, 0.6 * z);
    g.strokeStyle = PALETTE.ink;
    for (let i = 0; i < n; i++) {
      // Each bobbing a little on its own beat.
      const x = x0 + (i - (n - 1) / 2) * gap, y = y0 - Math.sin(age * 1.8 + i * 1.3) * R * 0.05;
      g.save();
      g.translate(x, y);
      // Pommel, grip, and the guard broad across the top of the hilt.
      poly(g, [[0, 0.6], [W * 1.2, 0.68], [0, 0.76], [-W * 1.2, 0.68]]);
      g.fillStyle = PALETTE.accent;
      g.fill();
      g.stroke();
      g.fillStyle = BRASS_DEEP;
      g.beginPath();
      g.rect(-R * W * 0.6, R * 0.42, R * W * 1.2, R * 0.19);
      g.fill();
      g.stroke();
      g.fillStyle = PALETTE.accent;
      g.beginPath();
      g.rect(-R * 0.36, R * 0.29, R * 0.72, R * 0.14);
      g.fill();
      g.stroke();
      g.fillStyle = BRASS_CORE;
      g.fillRect(-R * 0.33, R * 0.3, R * 0.66, R * 0.04);
      poly(g, stub);
      g.fillStyle = STEEL;
      g.fill();
      g.stroke();
      poly(g, stubLit);
      g.fillStyle = PALETTE.main;
      g.fill();
      // The lost point, over the break across a hair of air, tilted off the line and rocking on it.
      g.translate(R * 0.04, -R * 0.27);
      g.rotate(0.42 + 0.08 * Math.sin(age * 1.3 + i * 2.1));
      poly(g, point);
      g.fillStyle = STEEL;
      g.fill();
      g.stroke();
      poly(g, pointLit);
      g.fillStyle = PALETTE.main;
      g.fill();
      g.restore();
    }
  }, 2);
  k.glow(p, r * 1.6, alpha * (0.1 + 0.3 * k.night), PALETTE.light);
}

/**
 * A creature going at half its pace: a hind foot dragged. A furrow scored in the ground behind the hind foot -- along
 * the way it has really come while it moves, a short stub straight back while it stands -- inked, its lip a
 * scrape of brass, and a puff of dust off the foot at every step it drags (every 1.6 s while it stands, the foot
 * hitched). One record however long.
 */
function hobbled(k: FxScene, b: Body, age: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const s = k.state, back = k.facingDir(b);
  const foot = k.local(b, -b.wide * 0.12, -b.wide * 0.6, 0);
  // Its dragged steps: where the foot was at each, and when, newest first.
  const STEP = 0.14, KEEP = 2.4, N = 5;
  if (s.hx === undefined || Math.hypot(foot.x - s.hx, foot.y - s.hy) > STEP) {
    for (let i = N; i > 1; i--) { s[`hx${i}`] = s[`hx${i - 1}`]; s[`hy${i}`] = s[`hy${i - 1}`]; s[`ht${i}`] = s[`ht${i - 1}`]; }
    if (s.hx !== undefined) { s.hx1 = s.hx; s.hy1 = s.hy; s.ht1 = age; }
    s.hx = foot.x; s.hy = foot.y;
    if (age > 0.4) k.burst(k.on(foot.x, foot.y, 0.5), 4, { kind: 'dust', colour: DUST, size: 2, life: [0.3, 0.6], speed: [0.05, 0.25], up: [1, 4], heading: back, cone: 1, gravity: 2 });
  }
  const pts: Array<{ x: number; y: number }> = [foot];
  for (let i = 1; i <= N; i++) {
    const t0 = s[`ht${i}`];
    if (t0 === undefined || age - t0 > KEEP) break;
    pts.push({ x: s[`hx${i}`], y: s[`hy${i}`] });
  }
  // Standing: the stub of a dragged foot, and the foot hitched every 1.6 s (the band jerks with it).
  if (pts.length < 2) {
    const stub = { x: foot.x - back.x * 0.3, y: foot.y - back.y * 0.3 };
    pts.push(stub);
    const beat = Math.floor((age - 0.5) / 1.6);
    if (age > 0.5 && s.hitch !== beat) {
      s.hitch = beat;
      k.burst(k.on(foot.x, foot.y, 0.5), 3, { kind: 'dust', colour: DUST, size: 1.8, life: [0.3, 0.5], speed: [0.05, 0.2], up: [1, 3], heading: back, cone: 1, gravity: 2 });
    }
  }
  // The furrow: a wedge down the line, widest at the foot.
  const L: number[] = [], R: number[] = [];
  const dirAt = (i: number): [number, number] => {
    const q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - (i + 1 < pts.length ? 0 : 1))];
    const dx = q.x - o.x, dy = q.y - o.y, l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], [dx, dy] = dirAt(i);
    const w = 0.07 * (1 - (0.75 * i) / Math.max(1, pts.length - 1));
    L.push(p.x - dy * w, p.y + dx * w);
    R.unshift(p.x + dy * w, p.y - dx * w);
  }
  const furrow = [...L, ...R];
  const z = k.zoom;
  let x0 = foot.x, y0 = foot.y, x1 = foot.x, y1 = foot.y;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  k.groundShape((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) / 2 + 0.3, [
    { kind: 'fill', colour: '#3e3226', alpha: alpha * 0.9, paths: [furrow], lift: 0.12 },
    { kind: 'stroke', colour: PALETTE.ink, alpha: alpha * 0.7, width: Math.max(0.8, 0.6 * z), paths: [furrow], closed: true, join: 'round', lift: 0.12 },
    // The earth turned up along its lip, and where each dragged step bit: a pale brass scrape.
    { kind: 'stroke', colour: BRASS_DEEP, alpha: alpha * 0.9, width: Math.max(1, 0.9 * z), paths: [L], cap: 'round', lift: 0.13, glow: 0.5 * k.night, light: BRASS_CORE },
  ]);
}

/**
 * Bleeding staunched, `ph` seconds into a round of it: three drops of blood, one after another, run down the arm of
 * `b` nearer the viewer from high on the upper arm to its upper band and are stopped there -- the band glinting as
 * each is taken -- and shrink to nothing. Big enough to read at play size (a drop six pixels tall at zoom two); one
 * record.
 */
function staunched(k: FxScene, b: Body, ph: number, alpha: number): void {
  if (alpha <= 0.01 || ph > 1.6) return;
  // The arm nearer the viewer: the one whose elbow stands lower on the screen at its own height.
  const e0 = k.joint(b, 'elbow0'), e1 = k.joint(b, 'elbow1');
  const side = k.sy({ ...e1, z: b.z }) >= k.sy({ ...e0, z: b.z }) ? 1 : 0;
  const sh = k.joint(b, `arm${side}`), el = k.joint(b, `elbow${side}`), wr = k.joint(b, `wrist${side}`);
  const from = mid3(sh, el, 0.25), band = mid3(el, wr, 0.3);
  const drops: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 3; i++) {
    const t0 = i * 0.32, u = ph - t0;
    if (u < 0 || u > 1.0) continue;
    const run = smooth(clamp(u / 0.4));
    // Down the upper arm to the elbow, then on down the forearm to the band.
    const p = run < 0.5 ? mid3(from, el, run * 2) : mid3(el, band, run * 2 - 1);
    const dry = 1 - smooth(seg(u, 0.7, 1.0));
    const squash = smooth(seg(u, 0.38, 0.5));
    drops.push([k.sx(p), k.sy(p), dry, squash]);
    if (u > 0.4 && u < 0.6) k.flare(band, 4.5 * (1 - (u - 0.4) / 0.2), alpha, PALETTE.core, 0.6);
  }
  if (!drops.length) return;
  const z = k.zoom, R0 = 1.6 * z;
  k.worldDraw(band, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'round';
    for (const [x, y, dry, squash] of drops) {
      const R = R0 * (0.25 + 0.75 * dry), tail = R * (2.3 - 1.1 * squash), wide = R * (1 + 0.25 * squash);
      g.beginPath();
      g.moveTo(x, y - tail);
      g.bezierCurveTo(x + wide * 0.4, y - tail * 0.5, x + wide, y - R * 0.6, x + wide, y);
      g.arc(x, y, wide, 0, Math.PI);
      g.bezierCurveTo(x - wide, y - R * 0.6, x - wide * 0.4, y - tail * 0.5, x, y - tail);
      g.closePath();
      g.fillStyle = BLOOD;
      g.fill();
      g.lineWidth = Math.max(0.8, 0.6 * z);
      g.strokeStyle = PALETTE.ink;
      g.stroke();
      g.fillStyle = BLOOD_LIT;
      g.beginPath();
      g.arc(x - wide * 0.35, y - R * 0.2, R * 0.32, 0, TAU);
      g.fill();
    }
  }, 4);
}
