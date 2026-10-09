/**
 * The Pikeman's spells: how each is cast and what it looks like.
 *
 * A Pikeman fights at the length of a pole, so every spell here is drawn in
 * the one shape language of reach: straight lines, a leaf-bladed point, a
 * line on the ground that says how far. The thrusts throw a lance of bronze
 * light out of the hands along the line of the blow -- the island's reach is
 * tiles, far past the two metres of a real shaft, and the light is what
 * carries the blow across them -- with a sky-blue socket and edge on its
 * head; the spells on oneself set out the ground round the Pikeman at the
 * distances the rules name (a creature's own reach, the spear's, the five
 * tiles a rally carries), in rings of points, a hedge of pikes or a banner.
 *
 * Numbers are never written here twice: a reach, a pull, a push, a width
 * behind or a second's delay is read off the spell's own `fx` (`k.fx`, or
 * `FX_OF` for a pose or a timing) and the fight's own constants, so the
 * ground mark is where the rule is.
 *
 * The spear is in the hands (`Rig.wieldStaff`): the right fist where the
 * pose wants it, the shaft run from it at the target (`onSpear`, aimed by the
 * cue's `aim`, so the lance of light goes on along the shaft's own line) and
 * the left fist on the shaft, the elbows kept down. A thrust levels the
 * spear, a sweep swings it low, a brace grounds its butt and a whirl turns it
 * end over end in both hands. The lances run on from its real point
 * (`figureJoint` 'tip'); once a blow is in, the point is kept where it was
 * (`k.once`) and the lance drawn back before the pose lets the blow go, so it
 * never pivots on a spear that is moving. The stances on oneself are held as
 * long as they last (`cast.hold`).
 */
import { WEAPON_BY_ID } from '../../game/gear';
import { HUNT_REACH, reachOf } from '../../game/fight';
import { armToward, weaponSpan, type Rig, type V3 } from '../figure';
import { UNITS_PER_TILE } from '../iso';
import type { CastPose, PoseCue, SpellVisual } from './index';
import { spellInfo } from './info';
import {
  bump, clamp, easeBack, easeOut, flashOf, glowPicture, hashOf, lerp, mid3, seg, smooth, TAU,
  type Body, type FxScene, type GroundLayer, type P3, type SpellPalette,
} from './kit';
import { armOut, euler, heldFor, one, track } from './poses';

/** Bronze and ochre, with a sky-blue edge: the line held. */
export const PALETTE: SpellPalette = {
  core: '#fff1c4',
  main: '#d9a441',
  deep: '#8a5a22',
  accent: '#7fb3d5',
  ink: '#3b2610',
  light: '#ffc861',
};

/* ---- numbers off the rules ------------------------------------------------------------ */

/** A spell's own numbers, for a pose or a timing that has no `k` to read them from. */
const FX_OF = (id: string): Readonly<Record<string, number>> => spellInfo(id)?.fx ?? {};
/** The spear's reach, in tiles: what a Pikeman's weapon reaches when nothing better is known of it. */
const SPEAR_REACH = reachOf(WEAPON_BY_ID.get('spear') ?? { range: 2 });

/** A spear's length, butt to point, height units: what a whirl or a shove of it is as long as. */
const SPEAR_LONG = ((s) => (s ? s.to - s.from : 18.8))(weaponSpan('spear'));

/** How far the caster's own weapon reaches, as the fight reckons it: a spear's when it is not a weapon the fight knows. */
function reachHeld(k: FxScene): number {
  const id = k.caster.figure?.gear?.weapon?.id;
  const w = id ? WEAPON_BY_ID.get(id) : undefined;
  return w ? reachOf(w) : SPEAR_REACH;
}

/* ---- where the spear is ---------------------------------------------------------------- */

/** The point of the spear the caster holds, wherever the pose has put it; the right fist with nothing in it. */
const spearTip = (k: FxScene, b = k.caster): P3 => k.joint(b, 'tip', undefined, 0.8);
/** The butt of it. */
const spearButt = (k: FxScene, b = k.caster): P3 => k.joint(b, 'butt', undefined, 0.3);

/* ---- ways over the ground ------------------------------------------------------------- */

type V2 = { x: number; y: number };
/** The caster's right of a heading over the ground, as `FxScene.local` turns a body. */
const rightOf = (d: V2): V2 => ({ x: -d.y, y: d.x });
/** A point `t` tiles along `d` from `p` and `s` to its right, `lift` height units over the ground. */
const off = (k: FxScene, p: V2, d: V2, t: number, s = 0, lift = 0): P3 => {
  const r = rightOf(d);
  return k.on(p.x + d.x * t + r.x * s, p.y + d.y * t + r.y * s, lift);
};
/** The way the blow goes: from the caster to what it was cast at, or the way the caster faces. */
const lineOf = (k: FxScene): V2 => k.toward(k.caster, k.target);
/** A point `u` of the way from `a` to `b`. */
const along = (a: P3, b: P3, u: number): P3 => mid3(a, b, u);

/* ---- the shapes of the trade ------------------------------------------------------------ */

interface LanceLook {
  alpha?: number;
  /** The shaft, pixels at zoom one. */
  width?: number;
  /** The head's length, pixels at zoom one. */
  head?: number;
  /** A billhook's barb off the head, curled back toward the shaft. */
  hook?: boolean;
  /** Telescoped: this many sky-blue joints down the shaft, each where a length of it shot on from the last (Overreach). */
  rings?: number;
  /** White-hot: a thin shaft of the palest light, no bronze in it (Vital Thrust). */
  hot?: boolean;
  /** Two shafts side by side, each with its head (Twin Thrust). */
  pair?: boolean;
  /** The head in sky-blue rather than bronze. */
  blue?: boolean;
  /** Both edges of the head whetted sky-blue, not only the lit one: a long head (Reach Advantage). */
  edged?: boolean;
  /** No stripe down the shaft and no whetted edge: one of many standing at once (`cheval`). */
  plain?: boolean;
  /** Where it sorts among bodies; a little out from the butt when not given. */
  sortAt?: P3;
  glow?: number;
  bias?: number;
  /** Drawn into this list rather than recorded on its own, for several drawn as one thing (`cheval`). */
  into?: Array<(g: CanvasRenderingContext2D) => void>;
}

/**
 * A pike of light from `butt` to `tip`: a bronze shaft narrowing to the butt
 * with a lit stripe down it, a sky-blue socket, and a leaf of a head in two
 * tones lit from up and left, inked, its lit edge whetted sky-blue. It sorts
 * a little out from its butt, so it is in front of a caster facing the viewer
 * and behind one facing away, and a target nearer the viewer than the caster
 * stands over the point that has gone into it. Each blow has its own variant
 * of it (`LanceLook`), so no two thrusts throw the same light.
 */
function lance(k: FxScene, butt: P3, tip: P3, o: LanceLook = {}): void {
  const a = clamp(o.alpha ?? 1);
  if (a <= 0.01) return;
  // Never back toward the caster: a target nearer than the spear's own point is struck by the spear, not the light.
  if ((tip.x - butt.x) * (butt.x - k.caster.x) + (tip.y - butt.y) * (butt.y - k.caster.y) < 0) return;
  const x0 = k.sx(butt), y0 = k.sy(butt), x1 = k.sx(tip), y1 = k.sy(tip);
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 2) return;
  const z = k.zoom;
  const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
  const nx = -dy, ny = dx;
  // The lit side of the head: whichever of its two halves faces up and left.
  const s = -0.6 * nx - 0.8 * ny >= 0 ? 1 : -1;
  const H = Math.min(len * 0.7, (o.head ?? 9) * z);
  const W = H * (o.edged ? 0.22 : 0.3);
  const w = Math.max(0.7, ((o.width ?? 2.2) * z) / 2);
  const bx = x1 - dx * H, by = y1 - dy * H;
  const shx = x1 - dx * H * 0.4, shy = y1 - dy * H * 0.4;
  const pal = k.pal;
  const inkW = Math.max(0.8, 0.7 * z);
  const tiles = Math.hypot(tip.x - butt.x, tip.y - butt.y);
  const sortAt = o.sortAt ?? along(butt, tip, tiles > 0.01 ? clamp(0.3 / tiles) : 0);
  const shaft = o.hot ? pal.core : pal.main, stripe = o.hot ? '#ffffff' : pal.core;
  const lit = o.hot ? '#ffffff' : o.blue ? pal.core : pal.core, shade = o.blue ? pal.accent : o.hot ? pal.core : pal.main;
  const rings = o.rings ?? 0;
  // Two shafts a little apart across the line, or the one on it.
  const offs = o.pair ? [-1.9 * w - 0.6 * z, 1.9 * w + 0.6 * z] : [0];
  const one1 = (g: CanvasRenderingContext2D, ox: number, oy: number): void => {
    const X0 = x0 + ox, Y0 = y0 + oy, X1 = x1 + ox, Y1 = y1 + oy, BX = bx + ox, BY = by + oy, SX = shx + ox, SY = shy + oy;
    // The shaft, half as thick at the butt.
    g.beginPath();
    g.moveTo(X0 + nx * w * 0.5, Y0 + ny * w * 0.5);
    g.lineTo(BX + nx * w, BY + ny * w);
    g.lineTo(BX - nx * w, BY - ny * w);
    g.lineTo(X0 - nx * w * 0.5, Y0 - ny * w * 0.5);
    g.closePath();
    g.fillStyle = shaft;
    g.fill();
    g.lineWidth = inkW;
    g.strokeStyle = pal.ink;
    g.stroke();
    if (!o.plain) {
      g.beginPath();
      g.moveTo(X0 + nx * s * w * 0.15, Y0 + ny * s * w * 0.15);
      g.lineTo(BX + nx * s * w * 0.35, BY + ny * s * w * 0.35);
      g.lineWidth = Math.max(0.6, w * 0.6);
      g.strokeStyle = stripe;
      g.stroke();
    }
    // Telescoped joints: a sky-blue collar where each length shot out of the one behind it.
    for (let i = 1; i <= rings; i++) {
      const u = i / (rings + 1);
      const cx = lerp(X0, BX, u), cy = lerp(Y0, BY, u), ww = w * (0.75 + 0.5 * u) * 1.7, hl = 1.1 * z;
      g.beginPath();
      g.moveTo(cx + nx * ww - dx * hl, cy + ny * ww - dy * hl);
      g.lineTo(cx + nx * ww + dx * hl, cy + ny * ww + dy * hl);
      g.lineTo(cx - nx * ww + dx * hl, cy - ny * ww + dy * hl);
      g.lineTo(cx - nx * ww - dx * hl, cy - ny * ww - dy * hl);
      g.closePath();
      g.fillStyle = pal.accent;
      g.fill();
      g.lineWidth = inkW;
      g.strokeStyle = pal.ink;
      g.stroke();
    }
    // A billhook's barb: out from the foot of the head on the shaded side and curled back toward the hands.
    if (o.hook) {
      const hx = BX - nx * s * W * 0.2, hy = BY - ny * s * W * 0.2;
      g.beginPath();
      g.moveTo(hx + dx * H * 0.18, hy + dy * H * 0.18);
      g.lineTo(hx + dx * H * 0.05 - nx * s * W * 1.9, hy + dy * H * 0.05 - ny * s * W * 1.9);
      g.lineTo(hx - dx * H * 0.45 - nx * s * W * 1.5, hy - dy * H * 0.45 - ny * s * W * 1.5);
      g.lineTo(hx - dx * H * 0.08 - nx * s * W * 0.95, hy - dy * H * 0.08 - ny * s * W * 0.95);
      g.lineTo(hx - dx * H * 0.12, hy - dy * H * 0.12);
      g.closePath();
      g.fillStyle = pal.main;
      g.fill();
      g.strokeStyle = pal.ink;
      g.lineWidth = inkW;
      g.stroke();
    }
    // The socket, a band of sky-blue where the head is set on.
    g.beginPath();
    g.moveTo(BX + nx * w * 1.35, BY + ny * w * 1.35);
    g.lineTo(BX + nx * w * 1.35 - dx * H * 0.2, BY + ny * w * 1.35 - dy * H * 0.2);
    g.lineTo(BX - nx * w * 1.35 - dx * H * 0.2, BY - ny * w * 1.35 - dy * H * 0.2);
    g.lineTo(BX - nx * w * 1.35, BY - ny * w * 1.35);
    g.closePath();
    g.fillStyle = o.hot ? pal.core : pal.accent;
    g.fill();
    g.strokeStyle = pal.ink;
    g.lineWidth = inkW;
    g.stroke();
    // The leaf: its lit half pale, its shaded half in tone, a midrib between.
    const half = (side: number, fill: string): void => {
      g.beginPath();
      g.moveTo(BX, BY);
      g.lineTo(SX + nx * side * W, SY + ny * side * W);
      g.lineTo(X1, Y1);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    };
    half(s, lit);
    half(-s, shade);
    g.beginPath();
    g.moveTo(BX, BY);
    g.lineTo(SX + nx * W, SY + ny * W);
    g.lineTo(X1, Y1);
    g.lineTo(SX - nx * W, SY - ny * W);
    g.closePath();
    g.strokeStyle = pal.ink;
    g.lineWidth = inkW;
    g.stroke();
    if (!o.plain) {
      for (const side of o.edged ? [s, -s] : [s]) {
        g.beginPath();
        g.moveTo(SX + nx * side * W * 0.82, SY + ny * side * W * 0.82);
        g.lineTo(X1 - dx * z * 0.6, Y1 - dy * z * 0.6);
        g.strokeStyle = pal.accent;
        g.lineWidth = Math.max(0.7, (o.edged ? 1.1 : 0.8) * z);
        g.stroke();
      }
    }
  };
  const draw = (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = a;
    g.lineJoin = 'miter';
    for (const off of offs) one1(g, nx * off, ny * off);
    g.lineJoin = 'round';
  };
  if (o.into) o.into.push(draw);
  else k.worldDraw(sortAt, draw, o.bias ?? 0);
  const gl = o.glow ?? 1;
  if (gl > 0) {
    const pic = glowPicture(o.blue ? pal.accent : pal.light);
    if (pic) {
      const R = Math.max(6, H * 1.1);
      const r2 = Math.max(4, w * 4);
      k.glowDraw((g) => {
        g.globalAlpha = clamp(a * gl * 0.55);
        g.drawImage(pic, x1 - dx * H * 0.4 - R, y1 - dy * H * 0.4 - R, 2 * R, 2 * R);
        g.globalAlpha = clamp(a * gl * 0.22);
        for (let i = 2; i <= 3; i++) {
          const u = i / 4;
          g.drawImage(pic, lerp(x0, bx, u) - r2, lerp(y0, by, u) - r2, 2 * r2, 2 * r2);
        }
      });
    }
  }
}

/**
 * Flat shapes laid on the ground round `c` (within `r` tiles), each a list of
 * points over the land in tiles: one fill, an ink edge, and, for each, its
 * edge nearest the light picked out in `lit`. One record however many, laid
 * as the kit lays its own marks (`groundShape`), cut along the tiles. `glow`
 * lays the edges again over the night (a night rim), in `light`.
 */
function groundShapes(k: FxScene, c: V2, r: number, shapes: ReadonlyArray<ReadonlyArray<V2>>, o: { fill?: string; ink?: string | false; lit?: string; alpha?: number; glow?: number; light?: string }): void {
  const a = clamp(o.alpha ?? 1);
  if (a <= 0.01 || !shapes.length) return;
  const paths = shapes.map((sh) => sh.flatMap((p) => [p.x, p.y]));
  const z = k.zoom;
  const glow = o.glow ?? 0;
  const layers: GroundLayer[] = [
    { kind: 'fill', colour: o.fill ?? k.pal.main, alpha: a, paths, lift: 0.15 },
  ];
  if (o.ink !== false) layers.push({ kind: 'stroke', colour: o.ink ?? k.pal.ink, alpha: a, paths, lift: 0.15, width: Math.max(0.8, 0.7 * z), closed: true, join: 'miter' });
  // The far edge of each, the one the light falls across first: its first side.
  if (o.lit) layers.push({ kind: 'stroke', colour: o.lit, alpha: a, paths: paths.map((q) => q.slice(0, 4)), lift: 0.15, width: Math.max(0.8, 0.9 * z), glow: glow > 0.01 ? glow : undefined, light: o.light });
  else if (glow > 0.01) layers.push({ kind: 'stroke', colour: o.fill ?? k.pal.main, alpha: a, paths, lift: 0.15, width: Math.max(0.6, 0.5 * z), closed: true, glow, light: o.light });
  k.groundShape(c.x, c.y, r + 0.5, layers);
}

/** A bar on the ground across the way `d` at `c`: `half` tiles either side of the line, `thick` tiles deep, `u` of it drawn from the middle out. */
function barAcross(c: V2, d: V2, half: number, thick: number, u = 1): V2[] {
  const r = rightOf(d);
  const h = half * clamp(u);
  const t = thick / 2;
  return [
    { x: c.x + d.x * t - r.x * h, y: c.y + d.y * t - r.y * h },
    { x: c.x + d.x * t + r.x * h, y: c.y + d.y * t + r.y * h },
    { x: c.x - d.x * t + r.x * h, y: c.y - d.y * t + r.y * h },
    { x: c.x - d.x * t - r.x * h, y: c.y - d.y * t - r.y * h },
  ];
}

/** A leaf-shaped point lying on the ground at `c`, its tip `len` tiles out along `d`: a pike's head laid flat. */
function leafFlat(c: V2, d: V2, len: number): V2[] {
  const r = rightOf(d);
  const w = len * 0.32;
  return [
    { x: c.x + d.x * len, y: c.y + d.y * len },
    { x: c.x + d.x * len * 0.38 + r.x * w, y: c.y + d.y * len * 0.38 + r.y * w },
    { x: c.x, y: c.y },
    { x: c.x + d.x * len * 0.38 - r.x * w, y: c.y + d.y * len * 0.38 - r.y * w },
  ];
}

/** An arrowhead on the ground at `c` pointing along `d`, `len` tiles long: which way a push goes. */
function chevronFlat(c: V2, d: V2, len: number): V2[] {
  const r = rightOf(d);
  return [
    { x: c.x + d.x * len * 0.5, y: c.y + d.y * len * 0.5 },
    { x: c.x - d.x * len * 0.5 + r.x * len * 0.62, y: c.y - d.y * len * 0.5 + r.y * len * 0.62 },
    { x: c.x - d.x * len * 0.18, y: c.y - d.y * len * 0.18 },
    { x: c.x - d.x * len * 0.5 - r.x * len * 0.62, y: c.y - d.y * len * 0.5 - r.y * len * 0.62 },
  ];
}

/**
 * A pennon on a spear's head: a swallow-tailed strip flying off the shaft,
 * `size` pixels at zoom one, its two halves catching the light in turn as it
 * flutters; `stripe` the colour down its middle. Sorted with `body`.
 */
function pennon(k: FxScene, top: P3, body: P3, o: { size?: number; alpha?: number; phase?: number; main?: string; stripe?: string; fly?: number }): void {
  const a = clamp(o.alpha ?? 1);
  if (a <= 0.01) return;
  const z = k.zoom;
  const x = k.sx(top), y = k.sy(top) + 1.6 * z;
  // Flying away from the middle of the body on the screen, so it never lies across the face.
  const fly = o.fly ?? (Math.sign(x - k.sx(body)) || 1);
  const L = (o.size ?? 14) * z, h = L * 0.42;
  const ph = o.phase ?? 0;
  const f1 = Math.sin(ph) * h * 0.28, f2 = Math.sin(ph + 1.7) * h * 0.34, f3 = Math.sin(ph + 3.1) * h * 0.4;
  const main = o.main ?? k.pal.main, stripe = o.stripe ?? k.pal.accent, pal = k.pal;
  const inkW = Math.max(0.8, 0.7 * z);
  const fold = Math.sin(ph + 0.9) > 0;
  k.worldDraw(body, (g) => {
    g.globalAlpha = a;
    g.lineJoin = 'miter';
    const ax = x, ay = y, bx2 = x, by2 = y + h;
    const mx = x + fly * L * 0.5, my = y + h * 0.5 + f1;
    // The near half and the far half of the cloth, one lit and one in shade as it turns.
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(mx, my - h * 0.5);
    g.lineTo(x + fly * L, y + f2);
    g.lineTo(x + fly * L * 0.7, my + f3 * 0.3);
    g.lineTo(mx, my);
    g.closePath();
    g.fillStyle = fold ? pal.core : main;
    g.fill();
    g.beginPath();
    g.moveTo(bx2, by2);
    g.lineTo(mx, my + h * 0.5);
    g.lineTo(x + fly * L, y + h + f3);
    g.lineTo(x + fly * L * 0.7, my + f3 * 0.3);
    g.lineTo(mx, my);
    g.closePath();
    g.fillStyle = fold ? main : pal.deep;
    g.fill();
    // The stripe down its middle, to the notch of the tail.
    g.beginPath();
    g.moveTo(x, y + h * 0.5);
    g.lineTo(mx, my);
    g.lineTo(x + fly * L * 0.7, my + f3 * 0.3);
    g.lineWidth = Math.max(1, h * 0.22);
    g.strokeStyle = stripe;
    g.stroke();
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(mx, my - h * 0.5);
    g.lineTo(x + fly * L, y + f2);
    g.lineTo(x + fly * L * 0.7, my + f3 * 0.3);
    g.lineTo(x + fly * L, y + h + f3);
    g.lineTo(mx, my + h * 0.5);
    g.lineTo(bx2, by2);
    g.lineWidth = inkW;
    g.strokeStyle = pal.ink;
    g.stroke();
    g.lineJoin = 'round';
  }, 3);
}

/** A blow going in: sparks thrown on through it, a few embers, a puff of dust off the hide, a glint. */
function pierce(k: FxScene, at: P3, d: V2, scale = 1): void {
  k.burst(at, Math.round(20 * scale), { kind: 'spark', colour: [k.pal.core, k.pal.light, k.pal.main], size: 2, life: [0.18, 0.42], speed: [1.4, 3.2], up: [-4, 16], heading: d, cone: 0.9, gravity: 50, drag: 0.06 });
  k.burst(at, Math.round(6 * scale), { kind: 'ember', size: 1.8, life: [0.3, 0.6], speed: [0.3, 0.9], up: [4, 14], heading: d, cone: 1.6, gravity: 24 });
}

/* ---- the casts on the body -------------------------------------------------------------- */

/** For a stance key: the rear knee bent however far keeps both feet on the ground (`stance`). */
const P = -1;
/** How far a leg reaches down from the hip, thigh forward `thigh` degrees and the knee bent `knee`, in shares of the two bones (each one). */
const legDown = (thigh: number, knee: number): number => Math.cos((thigh * Math.PI) / 180) + Math.cos(((thigh - knee) * Math.PI) / 180);
/**
 * The legs of a pike stance through the cast, by keys of [t, how far the left
 * foot goes forward, its knee, how far the right goes back, its knee]: the
 * left leading, the right braced behind and turned out a little, `out` apart.
 * The figure stands on whichever sole is lowest, so a lunge whose legs reach
 * down unequally floats a foot off the ground; a rear knee given as `P` is
 * bent just so far that the rear foot comes down as far as the front one, so
 * the body sinks into the stance on both feet.
 */
function stance(r: Rig, t: number, keys: ReadonlyArray<readonly [number, number, number, number, number]>, out = 4): void {
  const rear = keys.map(([a, lf, lk, rb, rk]): readonly [number, number] => {
    if (rk !== P) return [a, rk];
    // The rear thigh back `rb`, its shin bent on back from it: cos(rb) + cos(rb + knee) = the front leg's reach.
    const want = legDown(lf, lk) - Math.cos((rb * Math.PI) / 180);
    const at = (Math.acos(clamp(want, -1, 1)) * 180) / Math.PI - rb;
    return [a, Math.max(0, at)];
  });
  r.leg[0] = euler(t, keys.map(([a, lf]) => [a, [lf, out, 0]] as const));
  r.knee[0] = one(t, keys.map(([a, , lk]) => [a, lk] as const));
  r.leg[1] = euler(t, keys.map(([a, , , rb]) => [a, [-rb, out, -6]] as const));
  r.knee[1] = one(t, rear);
}

/* Ways and places in the body's frame (x right, y ahead, z up, height units from the middle of the feet). */
const DEG = Math.PI / 180;
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const unit3 = (a: V3): V3 => mul3(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
/** `v` turned `deg` about the upright the way a positive yaw turns the chest: its front toward the body's left. */
const yawed = (v: V3, deg: number): V3 => {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
};
/** A way `d` tipped `up` degrees further up (down when less than nought) and turned `yaw` degrees to the left. */
const tipped = (d: V3, up: number, yaw = 0): V3 => {
  const h = Math.hypot(d[0], d[1]) || 1, p = Math.atan2(d[2], h) + up * DEG;
  const flat = yawed([d[0] / h, d[1] / h, 0], yaw);
  return [flat[0] * Math.cos(p), flat[1] * Math.cos(p), Math.sin(p)];
};

/**
 * Where a blow goes: the target's heart (`up` units over it), as the stage
 * tells the pose where it stands -- so a thrust is aimed at what it was cast
 * at, off to one side as well (the body only turns to the nearest of eight
 * ways), and the lance of light runs on from the point along the shaft's own
 * line rather than bending off it. Straight ahead at a man's chest without.
 */
const aimAt = (c: PoseCue, up = 0): V3 => (c.aim ? [c.aim.aside, Math.max(24, c.aim.ahead), c.aim.chest + up] : [0, 120, 9 + up]);
/** The way from `from` to where the blow goes. */
const aimFrom = (c: PoseCue, from: V3, up = 0): V3 => unit3(sub3(aimAt(c, up), from));

/** Elbows down and out of the way of the shaft -- the right behind the hip, the left under the shaft -- and never up across the face. */
const POLE: [V3, V3] = [[-0.5, -0.1, -1], [0.6, -0.5, -1]];

/** A key for `onSpear`: at `t`, the right fist, the way the shaft points from it, and how far on the left fist is (nought: not on it). */
type SpearKey = readonly [number, V3, V3, number];
/**
 * The spear taken in the hands through the cast (`Rig.wieldStaff`): the right
 * fist where the keys have it, the shaft run from it the way they say (the
 * fist turned so, `haft` square across it), and the left fist on the shaft
 * `sep` units on toward the point, closed on it (`both`) -- the elbows kept
 * down (`POLE`), so a two-handed thrust is held at the hip and the waist, not
 * up at the chin.
 */
function onSpear(r: Rig, t: number, keys: readonly SpearKey[], poles: [V3, V3] = POLE, stoop = false): void {
  const R = track(t, keys.map(([a, rr]) => [a, rr] as const)) as V3;
  const d = unit3(track(t, keys.map(([a, , dd]) => [a, dd] as const)) as V3);
  const sep = one(t, keys.map(([a, , , s]) => [a, s] as const));
  const both = clamp(sep / 1.2);
  r.wieldStaff = 1;
  r.haft = -90;
  r.both = both;
  r.reach = [both > 0.01 ? { at: add3(R, mul3(d, Math.max(1.2, sep))), haft: d, w: both, pole: poles[0], stoop } : undefined, { at: R, haft: d, pole: poles[1], stoop }];
}

/** Both hands on a shaft from the right fist `R` to the left fist `L`: a `SpearKey` for a shaft held crosswise rather than at something. */
const across = (t: number, R: V3, L: V3): SpearKey => [t, R, unit3(sub3(L, R)), Math.hypot(L[0] - R[0], L[1] - R[1], L[2] - R[2])];

/** The rest a cast comes from and goes back to: the right fist by the hip, the shaft upright beside the body as it is carried. */
const REST_FIST: V3 = [2.0, 0.6, 7.6];
const REST_UP: V3 = [0.12, 0.2, 1];
const rested = (t: number): SpearKey => [t, REST_FIST, REST_UP, 0];

/** Warning Thrust: the spear in the right fist alone, drawn back and cocked; a jab checked half way and held, the left palm held out flat at it, the leading foot stamped down with it. */
const WARN_T = { secs: 1.1, release: 0.4 };
/** How long the check is held, as a share of the cast: the "no further". */
const WARN_HOLD = 0.78;
const warnPose: CastPose = (r, t, c) => {
  const top = 0.28, at = WARN_T.release, hold = WARN_HOLD;
  const aim = aimAt(c);
  const jab: V3 = [1.0, 3.4, 10.2];
  // Drawn back along the side, the point cocked up and out over the line it will go: across the picture from every side.
  onSpear(r, t, [
    rested(0.04), [top, [2.1, -2.4, 9.0], tipped(aimFrom(c, [2.1, -2.4, 9]), 42, 4), 0],
    [at, jab, aimFrom(c, jab), 0], [hold, [1.0, 3.2, 10.1], aimFrom(c, jab), 0], [0.94, [1.9, 0.8, 8.2], tipped(aim, 50), 0], rested(1),
  ]);
  // The left hand out to the side and forward at the height of the chest, palm flat at it: back -- below the face, never over it.
  const ward = armToward(0, [-0.56, 0.8, -0.2]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [top, [30, 14, 10]], [at, ward], [hold, ward], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [top, 50], [at, 8], [hold, 10], [1, 30]]);
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [top, [-20, 0, 0]], [at, [-80, 0, -10]], [hold, [-78, 0, -10]], [1, [0, 0, 0]]]);
  r.open[0] = t > 0.2 && t < 0.92;
  r.shape = [{ flat: bump(t, 0.2, at, 0.92) }, undefined];
  // The stamp: the left foot up as the fist comes back, down hard on the jab.
  stance(r, t, [[0, 2, 4, 0, P], [top * 0.9, 34, 72, 6, 14], [at, 22, 12, 14, P], [hold, 22, 14, 14, P], [1, 4, 4, 2, P]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [4, 0, -4]], [at, [-8, 0, 2]], [hold, [-7, 0, 2]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [2, 0, -18]], [at, [-4, 0, 8]], [hold, [-4, 0, 8]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [top, [0, 0, 12]], [at, [-6, 0, -4]], [hold, [-8, 0, -4]], [1, [0, 0, 0]]]);
  r.mouth = one(t, [[0, 0], [at - 0.02, 0], [at + 0.02, 0.5], [hold, 0.2], [1, 0]]);
};

/** Overreach: coiled back on the rear leg, then the longest lunge there is -- the spear slid out to its butt in the one fist, level at the heart, the other arm flung back -- held there, and slow to come back. */
const OVER_T = { secs: 1.35, release: 0.32, blendOut: 0.3 };
const OVER_HOLD = 0.82;
const overPose: CastPose = (r, t, c) => {
  const top = 0.26, at = OVER_T.release, hold = OVER_HOLD;
  const coil: V3 = [2.2, -2.8, 9.4], out: V3 = [0.9, 8.0, 9.8];
  // The arm run out as far as it goes, the shaft level along the line to the heart: the lance goes on straight from its point.
  onSpear(r, t, [
    rested(0.04), [top, coil, tipped(aimFrom(c, coil), 40, 4), 0], [at, out, aimFrom(c, out), 0], [hold, out, aimFrom(c, out), 0],
    [0.92, [1.8, 1.0, 8.6], tipped(aimAt(c), 30), 0], rested(1),
  ]);
  // Slid through the fist as it goes, so the fist ends at the butt: every unit of the shaft out in front.
  r.slide = one(t, [[0, 0], [top, 0], [at, 3.8], [hold, 3.8], [0.92, 1], [1, 0]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [top, [52, 14, 14]], [at, [-48, 34, 0]], [hold, [-44, 34, 0]], [0.9, [0, 20, 0]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [top, 50], [at, 8], [hold, 10], [1, 30]]);
  r.open[0] = t > at - 0.04 && t < 0.86;
  r.shape = [{ flat: bump(t, at - 0.04, at, 0.86) }, undefined];
  // A long low step, the front shin all but upright, the rear leg straight behind.
  stance(r, t, [[0, 2, 4, 0, P], [top, 14, 44, 18, P], [at, 44, 30, 40, P], [hold, 43, 30, 40, P], [0.92, 20, 24, 12, P], [1, 4, 4, 2, P]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [8, 0, -6]], [at, [-24, 0, 6]], [hold, [-22, 0, 6]], [0.92, [-6, 0, 2]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [4, 0, -26]], [at, [-8, 0, 18]], [hold, [-8, 0, 18]], [1, [0, 0, 0]]]);
  // The eyes kept on it all the way down the lunge.
  r.head = euler(t, [[0, [0, 0, 0]], [top, [-2, 0, 20]], [at, [16, 0, -12]], [hold, [14, 0, -12]], [1, [0, 0, 0]]]);
};

/**
 * Sweep the Legs: down into a deep crouch, the trunk wound round to the right
 * with the spear low in both hands, then swung round flat from the right
 * across the front to the left -- the hands carried round by the turn of the
 * trunk, the point skimming at the height of a shin.
 */
const SWEEP_T = { secs: 1.1, release: 0.46 };
/** When the swing passes through the line and when it is through, as shares of the cast. */
const SWEEP_SWING = [0.36, 0.62] as const;
/** How far round the trunk is turned at `t`, degrees (positive to the left): wound to the right, swung through to the left. */
const sweepTurn = (t: number): number => one(t, [[0.06, 0], [0.3, -60], [SWEEP_SWING[0], -56], [SWEEP_T.release, 0], [SWEEP_SWING[1], 52], [0.84, 40], [1, 0]]);
const sweepPose: CastPose = (r, t, c) => {
  const top = 0.3, at = SWEEP_T.release, thru = SWEEP_SWING[1];
  const Y = sweepTurn(t);
  // Low and level in front of the trunk, the left fist forward and lower: the point at a shin's height out ahead.
  // The point cocked up behind on the wind-up, flat at the shins through the line, rising a little on the follow-through.
  const pitch0 = one(t, [[0.06, 10], [top, 46], [SWEEP_SWING[0], 40], [at, -18], [thru, -10], [1, 0]]);
  const R = yawed([0.8, 0.8, 5.0], Y), d = tipped(yawed([-0.12, 1, 0], Y), pitch0);
  const low = one(t, [[0.04, 0], [top, 1], [thru, 1], [0.92, 0]]);
  const up = tipped(aimAt(c), 30);
  onSpear(r, t, [[0, add3(mul3(REST_FIST, 1 - low), mul3(R, low)), unit3(add3(mul3(up, 1 - low), mul3(d, low))), 3.2 * Math.min(1, low * 2)]], POLE, t > 0.2 && t < 0.8);
  stance(r, t, [[0, 2, 4, 0, P], [top, 40, 74, 16, P], [at, 46, 80, 18, P], [thru, 44, 78, 18, P], [0.86, 30, 50, 12, P], [1, 4, 4, 2, P]], 14);
  const pitch = one(t, [[0, 0], [top, -30], [at, -26], [thru, -24], [0.86, -14], [1, 0]]);
  r.spine = [pitch, 0, Y * 0.45];
  r.chest = [pitch * 0.3, one(t, [[0, 0], [top, 6], [at, 0], [thru, -6], [1, 0]]), Y * 0.55];
  // The eyes on the shins it goes for, whatever the trunk does.
  r.head = [one(t, [[0, 0], [top, 4], [thru, 6], [1, 0]]), 0, -Y * 0.8];
  r.mouth = one(t, [[0, 0], [at - 0.04, 0], [at, 0.5], [thru, 0.2], [0.8, 0]]);
};

/**
 * Vital Thrust: settled and still, the left hand pointing the way with one
 * finger and the spear carried high on the right under the arm, its point
 * level at the heart, a long aim; then the left hand takes the shaft and both
 * drive it, short and very fast, and snap it back.
 */
const VITAL_T = { secs: 1.25, release: 0.62 };
const vitalPose: CastPose = (r, t, c) => {
  const set = 0.2, top = 0.54, at = VITAL_T.release, thru = 0.76;
  const ribs: V3 = [1.9, 0.4, 9.2], drive: V3 = [0.8, 1.4, 8.8];
  onSpear(r, t, [
    rested(0.04), [set, ribs, aimFrom(c, ribs), 0], [top, [1.9, 0.0, 9.2], aimFrom(c, [1.9, 0, 9.2]), 0],
    [at - 0.03, [1.4, 0.6, 9.0], aimFrom(c, drive), 2.8], [at, drive, aimFrom(c, drive), 3.4], [thru, drive, aimFrom(c, drive), 3.4],
    [0.9, [1.8, 0.8, 8.4], tipped(aimAt(c), 30), 0], rested(1),
  ]);
  // Pointing the way with the left arm while it aims, and down onto the shaft for the drive.
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [set, [84, 4, -6]], [top, [86, 4, -6]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [set, 6], [top, 4], [1, 30]]);
  r.shape = [{ point: bump(t, 0.1, set, top + 0.02) }, undefined];
  r.slide = one(t, [[0, 0], [top, 0], [at, 2.6], [thru, 2.6], [0.9, 0], [1, 0]]);
  stance(r, t, [[0, 2, 4, 0, P], [set, 22, 40, 12, P], [top, 22, 44, 14, P], [at, 32, 52, 22, P], [thru, 32, 50, 22, P], [1, 4, 4, 2, P]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [set, [-6, 0, -4]], [top, [-6, 0, -5]], [at, [-16, 0, 4]], [thru, [-15, 0, 4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [set, [0, 0, -24]], [top, [0, 0, -28]], [at, [-6, 0, 10]], [thru, [-6, 0, 10]], [1, [0, 0, 0]]]);
  // Sighting down the left arm: the head turned on to the line while the chest is turned off it, and low.
  r.head = euler(t, [[0, [0, 0, 0]], [set, [-8, 0, 22]], [top, [-10, 0, 26]], [at, [-4, 0, -8]], [thru, [-4, 0, -8]], [1, [0, 0, 0]]]);
};

/** Hook: a thrust out in both hands, a beat while the barb takes, then a haul back to the hips leaning back on the rear leg, the point kept on what it has hold of as it comes. */
const HOOK_T = { secs: 1.4, release: 0.28 };
/** When the haul starts and ends, as shares of the cast. */
const HAUL = [0.46, 0.62] as const;
/** Seconds from the catch to a little after the haul: how long the hook's impact plays. */
const HOOK_AFTER = (0.84 - HOOK_T.release) * HOOK_T.secs + 0.4;
const hookPose: CastPose = (r, t, c) => {
  const top = 0.18, at = HOOK_T.release, [h0, h1] = HAUL;
  const back: V3 = [1.4, -2.2, 7.6], out: V3 = [0.8, 1.2, 9.0], hauled: V3 = [1.2, -2.0, 7.2];
  onSpear(r, t, [
    rested(0.04), [top, back, tipped(aimFrom(c, back), 12, -10), 3.0], [at, out, aimFrom(c, out), 3.2], [h0, [0.8, 1.0, 9.0], aimFrom(c, out), 3.2],
    [h1, hauled, aimFrom(c, hauled), 3.0], [0.8, hauled, aimFrom(c, hauled), 3.0], [0.94, [1.6, 0.6, 8.0], tipped(aimAt(c), 30), 1.0], rested(1),
  ]);
  r.slide = one(t, [[0, 0], [top, 0], [at, 2.2], [h0, 2.2], [h1, 0], [1, 0]]);
  stance(r, t, [[0, 2, 4, 0, P], [top, -2, 12, 4, P], [at, 28, 34, 16, P], [h0, 28, 36, 16, P], [h1, 40, 4, 20, P], [0.8, 40, 6, 20, P], [1, 4, 4, 2, P]]);
  // The haul is the back: leaning out over the rear leg, turned as the hands come in.
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [4, 0, -4]], [at, [-12, 0, 4]], [h0, [-10, 0, 4]], [h1, [18, 0, -6]], [0.8, [16, 0, -6]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [2, 0, -16]], [at, [-4, 0, 8]], [h0, [-4, 0, 8]], [h1, [6, 0, -18]], [0.8, [6, 0, -16]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [top, [0, 0, 12]], [at, [-6, 0, -6]], [h1, [-10, 0, 16]], [0.8, [-10, 0, 14]], [1, [0, 0, 0]]]);
  r.mouth = one(t, [[0, 0], [h0, 0], [h0 + 0.06, 0.6], [h1, 0.3], [0.8, 0], [1, 0]]);
};

/** Rally the Line: the spear lifted high overhead as a standard and the left fist pumped, the head back in a shout; then the butt brought down hard by the foot and the left arm swept out to call them in. */
const RALLY_T = { secs: 1.5, release: 0.52 };
const rallyPose: CastPose = (r, t) => {
  const up = 0.3, top = 0.44, at = RALLY_T.release, thru = 0.7;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [up, [148, 16, -6]], [top, [168, 12, -6]], [at, [14, 22, 0]], [thru, [14, 22, 0]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [up, 14], [top, 8], [at, 30], [1, 40]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [up, [70, 24, 10]], [top, [104, 22, 10]], [at, armOut(0, 74, 62)], [thru, armOut(0, 72, 64)], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [up, 110], [top, 104], [at, 10], [thru, 12], [1, 30]]);
  r.open[0] = t > at - 0.02 && t < 0.9;
  r.shape = [{ flat: bump(t, at - 0.02, at + 0.04, 0.9) }, undefined];
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.18, [8, 6, 0]], [top, [4, 6, 0]], [at, [10, 10, 0]], [thru, [10, 10, 0]], [1, [2, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.18, [6, 6, 0]], [top, [0, 6, 0]], [at, [-6, 10, 0]], [thru, [-6, 10, 0]], [1, [0, 2, 0]]]);
  const kn = one(t, [[0, 4], [0.18, 26], [top, 2], [at, 20], [thru, 14], [1, 4]]);
  r.knee = [kn, kn];
  r.spine = euler(t, [[0, [0, 0, 0]], [0.18, [-6, 0, 0]], [top, [8, 0, 0]], [at, [-6, 0, 0]], [thru, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [10, -6, 8]], [at, [-4, 0, -6]], [thru, [0, 0, -4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.18, [-8, 0, 0]], [top, [22, 0, 0]], [at, [4, 0, 0]], [thru, [6, 0, 0]], [1, [0, 0, 0]]]);
  // The shout: up with the standard, and again as the butt comes down.
  r.mouth = one(t, [[0, 0], [up, 0.4], [top, 1], [at, 0.8], [thru, 0.2], [1, 0]]);
};

/**
 * Twin Thrust: drawn back once, then two quick jabs in both hands -- the
 * first high into the chest off the leading foot; a recoil; the second low
 * into the belly with the rear foot stepped right through and the trunk
 * turned square behind it.
 */
const TWIN_T = { secs: 1.2, release: 0.3 };
/** When each jab lands, as shares of the cast. */
const JABS = [TWIN_T.release, 0.62] as const;
/** How far over the heart (and under it) each jab goes in, height units. */
const TWIN_HIGH = 2.5, TWIN_LOW = -2.5;
const twinPose: CastPose = (r, t, c) => {
  const top = 0.2, [j1, j2] = JABS, rec = 0.46;
  const hi: V3 = [0.8, 1.2, 9.2], lo: V3 = [0.6, 1.4, 7.8], drawn: V3 = [1.4, -2.2, 8.6], mid: V3 = [1.2, -0.8, 8.4];
  onSpear(r, t, [
    rested(0.04), [top, drawn, tipped(aimFrom(c, drawn, TWIN_HIGH), 10, -8), 3.0], [j1, hi, aimFrom(c, hi, TWIN_HIGH), 3.2], [j1 + 0.07, hi, aimFrom(c, hi, TWIN_HIGH), 3.2],
    [rec, mid, tipped(aimFrom(c, mid, TWIN_LOW), 6), 3.0], [j2, lo, aimFrom(c, lo, TWIN_LOW), 3.2], [j2 + 0.12, lo, aimFrom(c, lo, TWIN_LOW), 3.2],
    [0.92, [1.6, 0.6, 8.0], tipped(aimAt(c), 30), 1.0], rested(1),
  ]);
  // Run out through the lead hand on each jab: a pike is thrust through the hands as much as by them.
  r.slide = one(t, [[0, 0], [top, 0], [j1, 2.2], [j1 + 0.07, 2.2], [rec, 0.4], [j2, 2.6], [j2 + 0.12, 2.6], [0.92, 0], [1, 0]]);
  // The first jab off the leading left foot; then the rear right foot brought right through for the second, the body going on with it.
  r.leg[0] = euler(t, [[0, [2, 4, 0]], [top, [4, 4, 0]], [j1, [24, 4, 0]], [rec, [20, 4, 0]], [j2, [-24, 4, 0]], [j2 + 0.12, [-22, 4, 0]], [1, [2, 4, 0]]]);
  r.knee[0] = one(t, [[0, 4], [top, 18], [j1, 30], [rec, 26], [j2, 14], [j2 + 0.12, 14], [1, 4]]);
  r.leg[1] = euler(t, [[0, [0, 4, -6]], [top, [-6, 4, -6]], [j1, [-14, 4, -6]], [rec, [-8, 4, -6]], [j2, [38, 4, 0]], [j2 + 0.12, [36, 4, 0]], [1, [0, 4, 0]]]);
  r.knee[1] = one(t, [[0, 4], [top, 12], [j1, 14], [rec, 18], [j2, 46], [j2 + 0.12, 44], [1, 4]]);
  r.at = [r.at[0], r.at[1] + one(t, [[rec, 0], [j2, 3.2], [j2 + 0.12, 3.2], [1, 0]]), r.at[2]];
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [4, 0, -4]], [j1, [-16, 0, 4]], [rec, [-4, 0, -2]], [j2, [-22, 0, 10]], [j2 + 0.12, [-20, 0, 10]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [2, 0, -16]], [j1, [-4, 0, 8]], [rec, [0, 0, -12]], [j2, [-6, 0, 26]], [j2 + 0.12, [-6, 0, 24]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [top, [0, 0, 12]], [j1, [-2, 0, -8]], [rec, [-4, 0, 10]], [j2, [6, 0, -24]], [j2 + 0.12, [6, 0, -22]], [1, [0, 0, 0]]]);
  r.mouth = one(t, [[0, 0], [j1 - 0.02, 0], [j1, 0.4], [rec, 0], [j2, 0.6], [j2 + 0.12, 0.2], [1, 0]]);
};

/** Reach Advantage: the long guard -- the weight kept back on a bent rear leg, the front leg straight and light, the spear run out through both hands as far as the arms go while the body stays away; then a short push of the point. */
const REACH_T = { secs: 1.1, release: 0.5 };
const reachPose: CastPose = (r, t, c) => {
  const set = 0.22, top = 0.42, at = REACH_T.release, thru = 0.74;
  const guard: V3 = [1.1, -0.8, 8.4], push: V3 = [1.0, 0.8, 8.6];
  onSpear(r, t, [
    rested(0.04), [set, guard, aimFrom(c, guard), 3.6], [top, [1.1, -1.0, 8.4], aimFrom(c, guard), 3.6],
    [at, push, aimFrom(c, push), 3.6], [thru, push, aimFrom(c, push), 3.6], [0.92, [1.6, 0.6, 8.0], tipped(aimAt(c), 30), 1.0], rested(1),
  ]);
  // Held near the butt: all the length of it out in front.
  r.slide = one(t, [[0, 0], [set, 3.4], [thru, 3.4], [1, 0]]);
  stance(r, t, [[0, 2, 4, 0, P], [set, 40, 2, 14, P], [top, 40, 2, 14, P], [at, 42, 4, 14, P], [thru, 42, 4, 14, P], [1, 4, 4, 2, P]]);
  // Upright, even leaning off it: the reach is the arms', not the body's.
  r.spine = euler(t, [[0, [0, 0, 0]], [set, [10, 0, -4]], [top, [11, 0, -4]], [at, [6, 0, 2]], [thru, [6, 0, 2]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [set, [0, 0, -10]], [top, [0, 0, -12]], [at, [-2, 0, 4]], [thru, [-2, 0, 4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [set, [-6, 0, 10]], [top, [-6, 0, 12]], [at, [-8, 0, -4]], [1, [0, 0, 0]]]);
};

/** Skewer: both hands drawn back high by the right shoulder, the point cocked, the knees down; then a drive with a step right through, the shaft run out through the hands and the body behind it, held long. */
const SKEWER_T = { secs: 1.3, release: 0.42 };
/** Where the drive is held to, as a share of the cast. */
const SKEWER_HOLD = 0.76;
const skewerPose: CastPose = (r, t, c) => {
  const top = 0.34, at = SKEWER_T.release, thru = 0.56, hold = SKEWER_HOLD;
  const cock: V3 = [1.8, -1.6, 9.8], drive: V3 = [0.6, 1.4, 9.0], far: V3 = [0.5, 2.2, 8.8];
  onSpear(r, t, [
    rested(0.04), [top, cock, tipped(aimFrom(c, cock), 16, -22), 3.0], [at, drive, aimFrom(c, drive), 3.2],
    [thru, far, aimFrom(c, far), 3.2], [hold, far, aimFrom(c, far), 3.2], [0.92, [1.6, 0.6, 8.0], tipped(aimAt(c), 30), 1.0], rested(1),
  ]);
  r.slide = one(t, [[0, 0], [top, 0], [at, 2.6], [hold, 2.6], [0.92, 0], [1, 0]]);
  stance(r, t, [[0, 2, 4, 0, P], [top, 6, 32, 10, P], [at, 46, 54, 30, P], [thru, 50, 58, 32, P], [hold, 48, 56, 32, P], [1, 4, 4, 2, P]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [-6, 0, -6]], [at, [-24, 0, 4]], [thru, [-30, 0, 4]], [hold, [-28, 0, 4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [-2, 0, -24]], [at, [-6, 0, 6]], [thru, [-6, 0, 8]], [hold, [-6, 0, 8]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [top, [-6, 0, 18]], [at, [12, 0, -4]], [thru, [16, 0, -6]], [hold, [14, 0, -6]], [1, [0, 0, 0]]]);
  r.mouth = one(t, [[0, 0], [top, 0], [at, 0.6], [thru, 0.3], [hold, 0], [1, 0]]);
};

/** Keep Away: the spear taken slantwise across the front in both hands, drawn in to the chest, and shoved straight out from it with a step -- a bar thrust into whatever is there. */
const KEEP_T = { secs: 1.0, release: 0.48 };
const keepPose: CastPose = (r, t) => {
  const top = 0.34, at = KEEP_T.release, thru = 0.66;
  // Slantwise: at thirty degrees or so to the shoulders and the left end high, so it is seen from the side as well; under the chin.
  onSpear(r, t, [
    rested(0.04), across(top, [1.7, 1.2, 8.4], [-1.3, 0.2, 11.0]), across(at, [1.8, 3.8, 8.6], [-1.2, 2.8, 11.2]),
    across(thru, [1.8, 3.7, 8.6], [-1.2, 2.7, 11.2]), [0.9, [1.6, 0.6, 8.0], REST_UP, 1.0], rested(1),
  ]);
  // Slid back through the right fist, so the shaft lies across the body about its middle.
  r.slide = one(t, [[0, 0], [0.2, -3], [0.74, -3], [0.92, 0]]);
  stance(r, t, [[0, 2, 4, 0, P], [top, 2, 14, 10, P], [at, 30, 30, 14, P], [thru, 30, 30, 14, P], [1, 4, 4, 2, P]], 8);
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [6, 0, 0]], [at, [-12, 0, 0]], [thru, [-11, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [4, 0, 0]], [at, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [top, [4, 0, 0]], [at, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.mouth = one(t, [[0, 0], [at - 0.02, 0], [at + 0.02, 0.6], [thru, 0.1], [1, 0]]);
};

/**
 * Fend Off: the spear whirled end over end in both hands before the body,
 * a turn and a half and quickening, then caught across the body, point high
 * to the left, on bent knees: held so as long as it lasts.
 */
const FEND_T = { secs: 1.1, release: 0.56 };
/** When the whirl goes round, as shares of the cast. */
const FEND_SPIN = [0.06, 0.52] as const;
/** Where the set is held, as a share of the cast. */
const FEND_HOLD = 0.66;
/** The whirl's middle, in the body's frame, and the plane it turns in (across the body and a little ahead, and up). */
const WHIRL_AT: V3 = [0.2, 3.4, 10.2];
const WHIRL_X: V3 = yawed([1, 0, 0], -20), WHIRL_Z: V3 = [0, 0, 1];
/** How far the hands are either side of the whirl's middle, and how far the spear is slid back so it turns about its own middle. */
const WHIRL_HAND = 1.5, WHIRL_SLIDE = -3.5;
/** The guard it is caught in: the right fist low, the shaft across the body point high to the left. */
const FEND_GUARD: V3 = [1.4, 2.2, 8.0], FEND_ACROSS: V3 = unit3([-0.75, 0.25, 0.75]);
/** How far round the whirl is at cast-time `t`, radians, from the shaft lying across with its point to the left; it comes round to the guard's slant. */
const whirlOf = (t: number): number => {
  const w = seg(t, FEND_SPIN[0], FEND_SPIN[1]);
  // Quickening, and slowing only at the very end as the hands catch it.
  const e = w < 0.85 ? (w / 0.85) ** 1.6 * 0.9 : 0.9 + 0.1 * easeOut((w - 0.85) / 0.15);
  return Math.PI + (Math.PI * 3.75) * e;
};
/** The way the shaft points (butt to point) at whirl angle `a`, in the body's frame. */
const whirlWay = (a: number): V3 => add3(mul3(WHIRL_X, Math.cos(a)), mul3(WHIRL_Z, Math.sin(a)));
const fendPose: CastPose = (r, t, c) => {
  const [s0, s1] = FEND_SPIN, at = FEND_T.release;
  const e = whirlWay(whirlOf(t));
  const caught = one(t, [[0, 0], [s1, 0], [at, 1], [0.94, 1], [1, 0]]);
  const R = add3(mul3(sub3(WHIRL_AT, mul3(e, WHIRL_HAND)), 1 - caught), mul3(FEND_GUARD, caught));
  const d = unit3(add3(mul3(e, 1 - caught), mul3(FEND_ACROSS, caught)));
  const into = one(t, [[0, 0], [s0, 1], [1, 1]]);
  onSpear(r, t, [[0, add3(mul3(REST_FIST, 1 - into), mul3(R, into)), unit3(add3(mul3(REST_UP, 1 - into), mul3(d, into))), 2 * WHIRL_HAND * (1 - caught) + 3.4 * caught]]);
  r.slide = WHIRL_SLIDE * into * (1 - caught);
  const breathe = Math.sin(heldFor(c) * TAU * 4);
  stance(r, t, [[0, 2, 4, 0, P], [s1, 12, 24, 8, P], [at, 30, 60, 16, P], [1, 30, 60, 16, P]], 14);
  r.spine = euler(t, [[0, [0, 0, 0]], [s1, [2, 0, 0]], [at, [-10, 0, 0]], [1, [-9, 0, 0]]]);
  r.spine[0] += 1.2 * breathe;
  r.chest = euler(t, [[0, [0, 0, 0]], [s1, [0, 0, 0]], [at, [-2, 0, 0]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [at, [-6, 0, 0]], [1, [-6, 0, 0]]]);
};

/**
 * Brace for the Charge: down on the right knee, the butt grounded behind the
 * rear foot and the shaft run out low through both fists, rising at the
 * height of a charging chest, the point well past the leading knee; held
 * there as long as it lasts, breathing.
 */
const BRACE_T = { secs: 1.3, release: 0.54, blendOut: 0.2 };
/** Where the pose is held, as a share of the cast: set, after the stamp. */
const BRACE_HOLD = 0.66;
/** The brace's shaft: the way it points from the butt, and where the butt is grounded, in the body's frame. */
const BRACE_UP: V3 = unit3([0, 0.87, 0.5]);
const BRACE_BUTT: V3 = [1.1, -3.0, 0.3];
/** A point `d` units up the braced shaft from its butt. */
const braceAt = (d: number): V3 => add3(BRACE_BUTT, mul3(BRACE_UP, d));
/** How far up the shaft from its butt the right fist closes on it, braced: high enough up it for a kneeling arm to reach. */
const BRACE_GRIP = 6;
/** How far the butt is behind the fist as a spear is carried, before any slide. */
const BUTT_TO_FIST = -(weaponSpan('spear')?.from ?? -4.4);
const bracePose: CastPose = (r, t, c) => {
  const top = 0.4, at = BRACE_T.release;
  const low: V3 = [1.4, 1.2, 6.4];
  onSpear(r, t, [rested(0.04), [top, low, tipped(aimAt(c), -4), 3.4], [at, braceAt(BRACE_GRIP), BRACE_UP, 3.0], [1, braceAt(BRACE_GRIP), BRACE_UP, 3.0]], POLE, t > top);
  // Slid back through the fists until the butt is on the ground behind the rear foot.
  r.slide = one(t, [[0, 0], [top, 0], [at, BUTT_TO_FIST - BRACE_GRIP], [1, BUTT_TO_FIST - BRACE_GRIP]]);
  r.kneel = one(t, [[0, 0], [top, 1], [1, 1]]);
  // A breath in the hold: the shoulders rising and settling, slowly.
  const breathe = Math.sin(heldFor(c) * TAU * 3);
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [-14, 0, 0]], [at, [-20, 0, 4]], [1, [-18, 0, 4]]]);
  r.spine[0] += 1.5 * breathe;
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [-2, 0, -8]], [at, [-4, 0, 6]], [1, [-4, 0, 6]]]);
  // Looking out over the point, not down at it.
  r.head = euler(t, [[0, [0, 0, 0]], [top, [10, 0, 0]], [at, [18, 0, -6]], [1, [16, 0, -6]]]);
  r.mouth = one(t, [[0, 0], [top, 0], [at, 0.45], [at + 0.08, 0], [1, 0]]);
};

/* ---- shared moments ----------------------------------------------------------------------- */

/** Where a lance leaves from: the point of the spear, which the light runs on from along the line of the blow. */
const point = (k: FxScene): P3 => spearTip(k);
/**
 * The spear's point where it was when the blow landed, kept for the rest of
 * the cast (`k.once`): a lance held in what it struck stays on the line it
 * went in on, rather than pivoting on the live point as the body recovers.
 */
const struck = (k: FxScene, name = 'tip'): P3 => k.once(name, () => point(k));

/**
 * How far a struck lance has been drawn back, nought to one, by the pose's own
 * timings: held while the pose holds its blow (`hold`, a share of the cast),
 * and drawn back over the last `over` seconds before the pose lets the blow go
 * -- so the light is gone before the spear it came out of moves.
 */
const drawnBack = (k: FxScene, T: { secs: number; release: number }, hold: number, over = 0.16): number => {
  const end = (hold - T.release) * T.secs;
  return smooth(seg(k.released, end - over, end));
};

/** A lance that has struck: from where the point was at the hit to `to`, drawn back toward the point by `back` and gone at one. */
function heldLance(k: FxScene, to: P3, back: number, o: LanceLook = {}, name = 'tip'): void {
  if (back >= 1) return;
  const from = struck(k, name);
  lance(k, from, along(from, to, 1 - back * 0.85), { ...o, alpha: (o.alpha ?? 1) * (1 - back) });
}

/** A glint and a light at the moment a blow lands. */
function landGlint(k: FxScene, at: P3, u: number, size: number): void {
  const f = flashOf(u, 0.08);
  k.flare(at, size * (1 - 0.5 * u), f, k.pal.core, 0.4);
  k.light(at, 1.4, 0.5 * (1 - u), '#fff1d6');
}

/** Dust, the colour of the ground a spear is stamped or dragged on. */
const DUST = ['#8f7f62', '#a8957a'];
/** Turned earth: a furrow's floor. */
const EARTH = '#6b5236';

/* ---- the spells ------------------------------------------------------------------------- */

export const PIKEMAN: Record<string, SpellVisual> = {
  /*
   * Warning Thrust: the jab stops short of the creature, a point of light
   * checked in the air over a line it scores in the ground between them, held
   * there with a clang; over the creature, for the seconds it is warned off, a
   * spear's point turned down over a bar that drains as the warning runs out.
   */
  pikeman_warning_thrust: {
    palette: PALETTE,
    cast: { timing: WARN_T, pose: warnPose },
    fx: {
      charge: (k, t) => k.glow(point(k), 5, 0.6 * bump(t, 0.16, WARN_T.release, WARN_T.release + 0.05)),
      travel: {
        secs: (tiles) => 0.06 + tiles * 0.03,
        draw: (k, u) => {
          const from = point(k), stop = warnStop(k, from);
          lance(k, from, along(from, stop, easeOut(u)), { width: 2 });
        },
      },
      hit: (k) => {
        const stop = k.once('stop', () => warnStop(k, struck(k)));
        warnLine(k);
        // Thrown back off nothing: the clang of a blow stopped.
        const back = k.toward(k.target, k.caster);
        k.burst(stop, 14, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 1.8, life: [0.15, 0.35], speed: [0.8, 2], up: [-6, 14], heading: back, cone: 2.2, gravity: 50, drag: 0.08 });
        // The stamp of the leading foot.
        k.burst(k.joint(k.caster, 'ankle0', [0, 0, 0], 0.02), 7, { kind: 'dust', colour: DUST[0], size: 2.3, life: [0.35, 0.6], speed: [0.2, 0.5], up: [2, 6], gravity: 4, drag: 0.1, jitter: 0.06 });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const stop = k.once('stop', () => warnStop(k, struck(k)));
          // Held checked in the air, trembling, as long as the jab is held; drawn back before the arm comes in.
          const back = drawnBack(k, WARN_T, WARN_HOLD);
          const shake = 0.35 * Math.sin(k.now * 70) * (1 - smooth(u * 3));
          heldLance(k, { ...stop, z: stop.z + shake }, back, { width: 2 });
          k.flare(stop, 10 * (1 - u), flashOf(u, 0.06), k.pal.core, 0.8);
          k.light(stop, 1.4, 0.45 * (1 - u), '#fff1d6');
        },
      },
      linger: {
        draw: (k, age, left) => {
          const secs = k.fx.secs ?? 30;
          // The line in the sand: scored from the middle out, then left to fade once the creature has seen it.
          const scored = smooth(seg(age, 0, 0.25));
          const lineA = (1 - smooth(seg(age, 2.4, 4))) * smooth(left / 0.6);
          if (lineA > 0.01) sandLine(k, scored, lineA, age);
          const a = smooth(age / 0.35) * smooth(left / 1);
          const strong = 1 - 0.35 * smooth(seg(age, 2.5, 4));
          warnSign(k, k.at(k.target, 1.12 + 0.02 * Math.sin(age * 2.2)), a * strong, age, clamp(left / secs));
          if (!k.fast && age < 3) k.emit(k.at(k.target, 1.1), 3, { kind: 'mote', colour: k.pal.accent, size: 1.4, life: [0.5, 0.9], speed: [0.02, 0.06], up: [2, 6], gravity: 0, jitter: 0.08 });
        },
      },
    },
  },

  /*
   * Overreach: the lunge throws a telescoped lance far past where the spear
   * stops -- a sky-blue mark on the ground at the end of the caster's reach,
   * and the light shot on beyond it in three lengths to the enemy -- and it is
   * slow coming back: a sky-blue ring round the fist empties over the second
   * the next swing is put back.
   */
  pikeman_overreach: {
    palette: PALETTE,
    cast: { timing: OVER_T, pose: overPose },
    fx: {
      charge: (k, t) => {
        k.glow(point(k), 5, 0.6 * bump(t, 0.12, OVER_T.release, OVER_T.release + 0.04));
        overReachMark(k, smooth(seg(t, 0.12, OVER_T.release)));
      },
      travel: {
        secs: (tiles) => 0.06 + tiles * 0.045,
        draw: (k, u) => {
          const from = point(k), to = k.heart(k.target);
          // Telescoped out in three steps rather than slid: each joint of it shoots on from the last.
          const step = Math.min(2.999, u * 3);
          const reach = (Math.floor(step) + easeOut(step - Math.floor(step))) / 3;
          lance(k, from, along(from, to, reach), { width: 2.4, head: 11, rings: Math.floor(step) });
          overReachMark(k, 1);
          if (!k.fast) k.emit(along(from, to, reach), 50, { kind: 'mote', colour: k.pal.accent, size: 1.4, life: [0.15, 0.3], speed: [0.02, 0.1], up: [-2, 2], gravity: 0 });
        },
      },
      hit: (k) => {
        struck(k);
        pierce(k, k.heart(k.target), lineOf(k), 1.1);
      },
      impact: {
        // To the end of the second the next swing is put back by.
        secs: 0.2 + (FX_OF('pikeman_overreach').wind ?? 1),
        draw: (k, u) => {
          const wind = k.fx.wind ?? 1;
          const age = u * (0.2 + wind);
          const to = k.heart(k.target);
          heldLance(k, to, drawnBack(k, OVER_T, OVER_HOLD, 0.2), { width: 2.4, head: 11, rings: 2 });
          landGlint(k, to, clamp(age / 0.45), 11);
          overReachMark(k, 1 - smooth(seg(age, 0.3, wind)));
          // What it costs: the arm's next swing, a ring round the fist emptying over that second.
          windRing(k, 1 - clamp(age / wind), smooth(age / 0.12) * (1 - smooth(seg(age, wind, wind + 0.2))));
        },
      },
    },
  },

  /*
   * Sweep the Legs: the real spear swept round low and flat, its swept band
   * drawn off it, and a low arc of bronze carried across the creature's shins
   * with it from the caster's right to their left, dust kicked out of its
   * feet; then for its seconds a hobble round its feet -- two cuffs and a
   * chain between them crawling round at the pace it is cut to, and the dust
   * of dragged feet.
   */
  pikeman_sweep_the_legs: {
    palette: PALETTE,
    cast: { timing: SWEEP_T, pose: sweepPose },
    fx: {
      charge: (k, t) => {
        const [s0, s1] = SWEEP_SWING;
        // The band the shaft sweeps, off the real spear, through the swing.
        // Only once it is down and flat: the cut down from the wind-up is no part of the sweep.
        const on = bump(t, SWEEP_T.release - 0.06, SWEEP_T.release, s1 + 0.02);
        if (on > 0.01) k.trail(k.caster, { secs: 0.12, inner: 0.62, outer: 1, alpha: 0.85 * on, glow: 0.4 });
        // Carried across the shins from the right to the left, passing the middle as the spear passes the line.
        const u = seg(t, s0 + 0.02, SWEEP_T.release + 0.1);
        const fade = 1 - seg(t, SWEEP_T.release + 0.1, SWEEP_T.release + 0.2);
        if (u > 0 && fade > 0) sweepArc(k, Math.min(1, u), fade);
      },
      hit: (k) => {
        const d = lineOf(k);
        const across = rightOf(d);
        const feet = k.at(k.target, 0.12);
        // Thrown the way the sweep goes, right to left.
        k.burst(feet, 22, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 1.8, life: [0.15, 0.35], speed: [1.2, 2.6], up: [0, 10], heading: { x: -across.x, y: -across.y }, cone: 1.1, gravity: 60, drag: 0.08 });
        k.burst(k.at(k.target, 0.02), 14, { kind: 'dust', colour: DUST, size: 3.4, life: [0.45, 0.8], speed: [0.3, 0.8], up: [2, 8], heading: { x: -across.x, y: -across.y }, cone: 2.4, gravity: 4, drag: 0.12 });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          landGlint(k, k.at(k.target, 0.15), u, 9);
          // The hobble snapped shut round the feet: the cuffs come in from wide and close.
          hobble(k, 0, smooth(u / 0.5), 1 + 0.8 * (1 - easeBack(clamp(u * 1.6))));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const a = smooth(age / 0.3) * smooth(left / 0.8);
          hobble(k, age, a, 1);
          // Dragged feet: dust kicked up behind it as it goes, the more the further it has gone this frame.
          const s = k.state, t = k.target;
          const moved = s.hx === undefined ? 0 : Math.hypot(t.x - s.hx, t.y - s.hy);
          s.hx = t.x;
          s.hy = t.y;
          if (!k.fast) k.emit(k.at(t, 0.02), (1.5 + Math.min(30, moved / Math.max(0.001, k.dt) * 12)) * a, { kind: 'dust', colour: DUST[0], size: 2.4, life: [0.5, 0.9], speed: [0.05, 0.15], up: [1, 3], gravity: 2, jitter: footRing(t) * 0.6 });
        },
      },
    },
  },

  /*
   * Vital Thrust: a long aim -- a fine sky-blue sight line from the leading
   * hand and four points closing on the creature's heart -- then a thin
   * white-hot lance there in an instant, unlit until it is in, and a hard
   * eight-pointed glint where it went, the four points thrown off it: a blow
   * found the soft place.
   */
  pikeman_vital_thrust: {
    palette: PALETTE,
    cast: { timing: VITAL_T, pose: vitalPose },
    fx: {
      charge: (k, t) => {
        const rel = VITAL_T.release;
        const aim = smooth(seg(t, 0.14, rel - 0.04));
        const gone = seg(t, rel, rel + 0.02);
        if (aim > 0 && gone < 1) {
          const heart = k.heart(k.target);
          sightLine(k, k.hand(0), heart, aim * (1 - gone));
          reticle(k, heart, lerp(18, 5, aim), aim * (1 - gone), t * 3, 0);
          k.light(heart, 1.1, 0.2 * aim * (1 - gone), k.pal.accent);
        }
      },
      travel: {
        secs: (tiles) => 0.02 + tiles * 0.02,
        draw: (k, u) => {
          const from = point(k), to = k.heart(k.target);
          lance(k, from, along(from, to, u), { width: 1.3, head: 12, hot: true, glow: 0.7 * k.night });
        },
      },
      hit: (k) => {
        struck(k);
        const at = k.heart(k.target), d = lineOf(k);
        pierce(k, at, d, 1.2);
        k.burst(at, 10, { kind: 'shard', colour: [k.pal.accent, k.pal.core], size: 2, life: [0.35, 0.6], speed: [0.6, 1.4], up: [4, 16], heading: d, cone: 2.6, gravity: 40, drag: 0.2, ink: false });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const at = k.heart(k.target);
          heldLance(k, at, drawnBack(k, VITAL_T, 0.76), { width: 1.3, head: 12, hot: true, glow: 0.6 });
          const f = flashOf(u, 0.05);
          k.flare(at, 13 * (1 - 0.4 * u), f, k.pal.core, 0);
          k.flare(at, 9 * (1 - 0.4 * u), f, k.pal.accent, Math.PI / 4);
          // The four points thrown off the heart.
          reticle(k, at, 5 + 18 * easeOut(u), 1 - u, 0, u * 2);
          k.light(at, 1.4, 0.55 * (1 - u), '#fff1d6');
        },
      },
    },
  },

  /*
   * Hook: a lance with a billhook's barb shot out to the enemy and caught in
   * it; on the haul it comes (`cast.pull`), a furrow ploughed over the ground
   * from where it stood toward the caster, the length it is dragged and
   * stopping where it must, dust thrown up along it; the barb lets go with a
   * snap.
   */
  pikeman_hook: {
    palette: PALETTE,
    cast: { timing: HOOK_T, pose: hookPose, pull: { from: HAUL[0], to: HAUL[1] } },
    fx: {
      charge: (k, t) => k.glow(point(k), 5, 0.6 * bump(t, 0.12, HOOK_T.release, HOOK_T.release + 0.04)),
      travel: {
        secs: (tiles) => 0.05 + tiles * 0.035,
        draw: (k, u) => {
          const from = point(k), to = k.heart(k.target);
          lance(k, from, along(from, to, easeOut(u)), { width: 1.8, head: 12, hook: true });
        },
      },
      hit: (k) => {
        // Where it stood when the barb took: the island drags it from here, and the stage draws it coming.
        const s = k.state;
        s.x0 = k.target.x;
        s.y0 = k.target.y;
        s.d0 = k.dist;
        const at = k.heart(k.target);
        k.burst(at, 12, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 1.8, life: [0.15, 0.35], speed: [0.6, 1.6], up: [0, 12], heading: k.toward(k.target, k.caster), cone: 2, gravity: 50 });
      },
      impact: {
        // From the catch to a little after the haul.
        secs: HOOK_AFTER,
        draw: (k, u) => {
          const age = u * HOOK_AFTER;
          const h0 = (HAUL[0] - HOOK_T.release) * HOOK_T.secs, h1 = (HAUL[1] - HOOK_T.release) * HOOK_T.secs;
          const haul = smooth(seg(k.released, h0, h1));
          const free = seg(k.released, h1 + 0.04, h1 + 0.2);
          // Taut from the point, which the haul keeps on what it has hold of; a tremble in it before the haul; let go after.
          const to = k.heart(k.target), from = point(k);
          if (free < 1) {
            const shake = k.released < h0 ? 0.4 * Math.sin(k.now * 60) : 0;
            lance(k, from, { x: to.x, y: to.y, z: to.z + shake }, { width: 1.8, head: 12, hook: true, alpha: 1 - free, glow: 1 + 0.6 * bump(k.released, h0 - 0.1, h0, h1) });
          }
          if (age < 0.3) landGlint(k, to, age / 0.3, 8);
          hookFurrow(k, haul, 1 - smooth(seg(age, (0.84 - HOOK_T.release) * HOOK_T.secs, HOOK_AFTER)), haul > 0 && haul < 1);
          if (haul > 0 && haul < 1) k.emit(k.at(k.target, 0.04), 60, { kind: 'dust', colour: DUST, size: 3, life: [0.35, 0.7], speed: [0.1, 0.4], up: [2, 6], gravity: 4, drag: 0.1, jitter: 0.12 });
          if (k.released >= h1 + 0.04 && !k.state.snap) {
            k.state.snap = 1;
            k.burst(to, 10, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 1.6, life: [0.12, 0.3], speed: [0.6, 1.4], up: [0, 10], gravity: 50 });
          }
        },
      },
    },
  },

  /*
   * Rally the Line: a pennon unfurls on the spear as it is lifted high, and
   * when the butt comes down a thin wave runs out over the ground to the five
   * tiles it reaches, a row of pike-heads riding its edge; as it passes each
   * person in it -- the caster too -- a stack of chevrons and a bar filling
   * over their head: stamina, given back.
   */
  pikeman_rally_the_line: {
    palette: PALETTE,
    cast: { timing: RALLY_T, pose: rallyPose },
    fx: {
      charge: (k, t) => {
        const up = smooth(seg(t, 0.1, 0.34));
        const down = smooth(seg(t, 0.82, 1));
        if (up > 0 && down < 1) {
          const tip = spearTip(k);
          pennon(k, tip, k.caster, { size: 20 * up, alpha: up * (1 - down), phase: k.now * 9 });
          k.glow(tip, 7, 0.5 * up * (1 - down));
        }
      },
      hit: (k) => {
        const feet = k.at(k.caster, 0.02);
        k.burst(feet, 14, { kind: 'dust', colour: DUST, size: 2.6, life: [0.45, 0.8], speed: [0.5, 1.1], up: [1, 5], gravity: 3, drag: 0.1 });
        k.burst(k.at(k.caster, 0.1), 24, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 2, life: [0.25, 0.5], speed: [1.2, 2.6], up: [2, 14], gravity: 40, drag: 0.06 });
      },
      impact: {
        secs: 1.8,
        draw: (k, u) => {
          const secs = 1.8, age = u * secs;
          const R = spellInfo('pikeman_rally_the_line')?.radius || (k.fx.reach ?? 5);
          // Out to the edge in the first second, held there as it thins.
          const out = easeOut(seg(age, 0, 1));
          const fade = 1 - smooth(seg(age, 1, secs));
          const r = 0.3 + (R - 0.3) * out;
          k.ring(k.caster, r, { band: 0.12 * (1 - 0.5 * out), alpha: 0.95 * fade, turn: u * 0.4, glow: 0.3 + 0.6 * k.night });
          // The edge marked as it is reached: the five tiles it gives breath to.
          if (out > 0.92) k.ring(k.caster, R, { band: 0.06, alpha: 0.7 * fade, dash: 4, main: k.pal.accent, glow: 0.4 * k.night });
          rallyHeads(k, r, fade * (1 - smooth(seg(out, 0.9, 1))));
          rallyChevrons(k, R, r, age, fade);
          // Everybody it passes over, as it passes: the caster at once, the rest as the wave gets to them.
          for (const b of k.bodiesWithin(R, k.caster, ['player', 'peer'])) given(k, b, age - waveAt(Math.hypot(b.x - k.caster.x, b.y - k.caster.y), R));
          k.light(k.caster, Math.min(2.4, r + 0.6), 0.55 * fade, '#fff1d6');
          if (age < 0.12) k.flare(k.at(k.caster, 0.08), 12, flashOf(age / 0.12), k.pal.core, 0.3);
        },
      },
    },
  },

  /*
   * Twin Thrust: two blows, one after the other, each a pair of thin lances
   * side by side -- the first high into the chest off the leading foot, the
   * second low into the belly a beat later with the rear foot stepped through
   * and its heads in sky-blue -- each with its own smaller glint and spray:
   * two lighter blows, not one heavy one.
   */
  pikeman_twin_thrust: {
    palette: PALETTE,
    cast: { timing: TWIN_T, pose: twinPose },
    fx: {
      charge: (k, t) => {
        const [j1, j2] = JABS;
        k.glow(point(k), 4, 0.5 * bump(t, 0.1, j1, j1 + 0.04));
        // Each jab: out in a few hundredths, held while the pose holds it, drawn back before it lets go.
        jab(k, t, j1, j1 + 0.07, twinAim(k, 0), 'tip1', { width: 1.3, head: 8, pair: true });
        jab(k, t, j2, j2 + 0.12, twinAim(k, 1), 'tip2', { width: 1.1, head: 8, pair: true, blue: true });
        if (t >= j2 && !k.state.second) {
          k.state.second = 1;
          pierce(k, twinAim(k, 1), lineOf(k), 0.7);
        }
        const v = (t - j2) * TWIN_T.secs / 0.4;
        if (v >= 0 && v < 1) landGlint(k, twinAim(k, 1), v, 7);
      },
      hit: (k) => pierce(k, twinAim(k, 0), lineOf(k), 0.7),
      impact: { secs: 0.4, draw: (k, u) => landGlint(k, twinAim(k, 0), u, 7) },
    },
  },

  /*
   * Reach Advantage: the creature's own reach laid round it on the ground as
   * a dark dashed ring while the guard is set, a tick on the line where the
   * caster stands against it; a long-headed lance with both edges whetted
   * sky-blue goes in. Struck from outside that reach, the ring breaks -- its
   * dashes thrown off, a gap where the blow came through -- and the glint is
   * the large two-tone one of the larger blow; struck from within it, the ring
   * stays whole, goes red and closes in, and the glint is a plain one.
   */
  pikeman_reach_advantage: {
    palette: PALETTE,
    cast: { timing: REACH_T, pose: reachPose },
    fx: {
      charge: (k, t) => {
        const a = smooth(seg(t, 0.06, 0.3)) * (1 - seg(t, REACH_T.release, REACH_T.release + 0.02));
        theirReach(k, a, 0);
      },
      travel: {
        secs: (tiles) => 0.04 + tiles * 0.04,
        draw: (k, u) => {
          const from = point(k), to = k.heart(k.target);
          lance(k, from, along(from, to, easeOut(u)), { width: 2.2, head: 16, edged: true });
          theirReach(k, 1, 0);
        },
      },
      hit: (k) => {
        struck(k);
        const at = k.heart(k.target);
        pierce(k, at, lineOf(k), outReach(k) ? 1.5 : 0.8);
        if (outReach(k)) k.burst(at, 10, { kind: 'shard', colour: [k.pal.accent, k.pal.core], size: 2.2, life: [0.3, 0.55], speed: [0.8, 1.6], up: [2, 14], heading: lineOf(k), cone: 1.4, gravity: 40, drag: 0.15, ink: false });
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const at = k.heart(k.target);
          const big = outReach(k);
          const m = big ? (k.fx.more ?? 1.5) : (k.fx.whole ?? 1);
          heldLance(k, at, drawnBack(k, REACH_T, 0.74), { width: 2.2, head: 16, edged: true, blue: big && u < 0.25, glow: big ? 1.4 : 0.6 });
          landGlint(k, at, u, 8 * m);
          if (big) k.flare(at, 7 * m * (1 - u), flashOf(u, 0.06), k.pal.accent, Math.PI / 4);
          theirReach(k, 1 - smooth(seg(u, 0.4, 1)), u);
        },
      },
    },
  },

  /*
   * Skewer: a thick lance driven in and on out of the far side, two tiles
   * past it; laid on the ground behind the creature, the corridor the thrust
   * goes down -- as long and as wide as the rule has it -- a light running
   * down it as it is laid, and a spark off anything else standing in it, which
   * takes the lesser blow.
   */
  pikeman_skewer: {
    palette: PALETTE,
    cast: { timing: SKEWER_T, pose: skewerPose },
    fx: {
      charge: (k, t) => k.glow(point(k), 5, 0.6 * bump(t, 0.12, SKEWER_T.release, SKEWER_T.release + 0.04)),
      travel: {
        secs: (tiles) => 0.04 + tiles * 0.04,
        draw: (k, u) => {
          const from = point(k), to = k.heart(k.target);
          lance(k, from, along(from, to, u), { width: 3.2, head: 12 });
        },
      },
      hit: (k) => {
        struck(k);
        pierce(k, k.heart(k.target), lineOf(k), 1);
      },
      impact: {
        secs: 1.1,
        draw: (k, u) => {
          const d = k.once('way', () => ({ ...lineOf(k), z: 0 }));
          const behind = k.fx.behind ?? 2;
          const t = k.once('at', () => k.target);
          const at = k.heart(k.target);
          const far = off(k, t, d, behind, 0, at.z - k.ground(t.x, t.y) - 2);
          // On through it, out the far side; held; drawn back before the drive is let go.
          const on = easeOut(seg(u, 0, 0.14));
          const from = struck(k);
          const back = drawnBack(k, SKEWER_T, SKEWER_HOLD, 0.2);
          if (back < 1) lance(k, from, along(from, along(at, far, on), 1 - back * 0.9), { width: 3.2, head: 12, alpha: 1 - back });
          if (on >= 1 && !k.state.out) {
            k.state.out = 1;
            k.burst(far, 18, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 1.8, life: [0.2, 0.4], speed: [1, 2.2], up: [-2, 12], heading: d, cone: 1, gravity: 50, drag: 0.08 });
          }
          const laid = seg(u, 0.04, 0.24);
          skewerLane(k, t, d, behind, laid, 1 - smooth(seg(u, 0.45, 1)));
          // A light run down the lane as it is laid, so it shows in the dark.
          if (laid > 0 && laid < 1) k.light(off(k, t, d, behind * easeOut(laid)), 1.2, 0.45 * (1 - laid), '#fff1d6');
          landGlint(k, at, u, 10);
          // Anything else standing in it takes the lesser blow, as the thrust gets to it.
          skewered(k, t, d, behind, behind * easeOut(laid));
        },
      },
    },
  },

  /*
   * Keep Away: a bar of light the length of the shaft shoved straight out
   * from the chest the one tile a blow will push, and from the feet a ring of
   * arrowheads driven out as far; for its seconds a square sky-blue guidon on
   * the spear and arrowheads round the feet pulsing outward.
   */
  pikeman_keep_away: {
    palette: PALETTE,
    cast: { timing: KEEP_T, pose: keepPose },
    fx: {
      charge: (k, t) => {
        const u = seg(t, KEEP_T.release - 0.04, 0.78);
        if (u > 0 && u < 1) shoveBar(k, u);
      },
      hit: (k) => {
        k.burst(k.at(k.caster, 0.04), 12, { kind: 'dust', colour: DUST[0], size: 3, life: [0.35, 0.6], speed: [0.8, 1.4], up: [1, 4], gravity: 3, drag: 0.1 });
      },
      impact: {
        secs: 0.7,
        draw: (k, u) => {
          // Out by exactly the tile a blow will push.
          const push = k.fx.push ?? 1;
          const r = 0.22 + push * easeOut(u);
          pushRing(k, r, 8, 0.14, 0.95 * (1 - smooth(seg(u, 0.5, 1))), 0);
          k.light(k.caster, 1.6, 0.4 * (1 - u), '#fff1d6');
        },
      },
      linger: {
        on: 'caster',
        draw: (k, age, left) => {
          const a = smooth(age / 0.4) * smooth(left / 0.8);
          const tip = spearTip(k);
          // Put up once the spear is back upright in the hand, not while it is still across the face.
          guidon(k, tip, k.caster, 0.95 * a * smooth(seg(age, 0.4, 0.75)), k.now * 6);
          k.glow(tip, 4, 0.35 * a, k.pal.accent);
          // Pulsing outward, slowly: what a blow does to what it lands on.
          const pulse = (age * 0.7) % 1;
          pushRing(k, 0.4 + 0.1 * easeOut(pulse), 6, 0.14, 0.75 * a * (1 - 0.5 * pulse), 0.3);
        },
      },
    },
  },

  /*
   * Fend Off: the spear whirled end over end before the body leaves a disc of
   * light -- arcs cut by its two ends; when it is caught a ring of leaf points
   * springs out flat on the ground at the reach a creature strikes from, points
   * outward, and for its seconds it stays, a thin wave going out from it now
   * and then the two tiles a creature is thrown back.
   */
  pikeman_fend_off: {
    palette: PALETTE,
    cast: { timing: FEND_T, pose: fendPose, hold: { at: FEND_HOLD } },
    fx: {
      charge: (k, t) => fendWheel(k, t),
      hit: (k) => {
        k.burst(k.at(k.caster, 0.05), 20, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 1.8, life: [0.2, 0.4], speed: [1.4, 2.6], up: [1, 6], gravity: 30, drag: 0.08 });
      },
      impact: {
        secs: 0.55,
        draw: (k, u) => {
          fendRing(k, HUNT_REACH * (0.3 + 0.7 * easeBack(u)), 1, u);
          k.light(k.caster, HUNT_REACH + 0.4, 0.45 * (1 - u), '#fff1d6');
        },
      },
      linger: {
        on: 'caster',
        draw: (k, age, left) => {
          const a = smooth(age / 0.3) * smooth(left / 0.8);
          if (age > 0.55) fendRing(k, HUNT_REACH, 0.6 * a, 1);
          // Every so often a thin wave out the push's length, the way a creature is thrown.
          const push = k.fx.push ?? 2;
          const w = ((age + 0.4) % 1.6) / 1.6;
          k.ring(k.caster, HUNT_REACH + push * easeOut(w), { band: 0.04, alpha: 0.4 * a * (1 - w), main: k.pal.accent, glow: 0.4 * k.night, n: 24 });
        },
      },
    },
  },

  /*
   * Brace for the Charge: the butt planted behind the rear foot with a spurt
   * of dust, and a hedge of pikes of light rising round the caster at the edge
   * of their reach, leant outward over a ring scored on the ground -- where a
   * charge is stopped -- a faint line run out along the braced spear to it;
   * standing for its seconds and sinking back at the end.
   */
  pikeman_brace_for_the_charge: {
    palette: PALETTE,
    cast: { timing: BRACE_T, pose: bracePose, hold: { at: BRACE_HOLD } },
    fx: {
      charge: (k, t) => k.glow(k.at(k.caster, 0.05), 6, 0.5 * bump(t, 0.3, BRACE_T.release, BRACE_T.release + 0.1)),
      hit: (k) => {
        // Where the butt has gone into the ground.
        const butt = spearButt(k);
        const foot = k.on(butt.x, butt.y, 0.5);
        k.burst(foot, 12, { kind: 'dust', colour: DUST, size: 3, life: [0.35, 0.6], speed: [0.3, 0.7], up: [2, 6], gravity: 4, drag: 0.12 });
        k.burst(foot, 10, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 1.6, life: [0.15, 0.3], speed: [0.6, 1.2], up: [4, 12], gravity: 50 });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          k.light(k.caster, 1.6, 0.45 * (1 - u), '#fff1d6');
        },
      },
      linger: {
        on: 'caster',
        draw: (k, age, left) => {
          const rise = easeBack(seg(age, 0, 0.45));
          const sink = smooth(seg(left, 0, 0.7));
          hedge(k, reachHeld(k), rise * sink, smooth(age / 0.2) * smooth(left / 0.4), age);
        },
      },
    },
  },
};

/* ---- the spells' own pieces ------------------------------------------------------------ */

/** How far out a ring round a creature's feet goes, in tiles. */
const footRing = (b: { wide: number }): number => Math.max(0.16, (b.wide / 40) * 1.9);

/**
 * Where the line in the sand is scored, in tiles out from the caster: short of
 * the creature's near side, so it lies between them and never under the body.
 */
function warnLineAt(k: FxScene): number {
  const near = k.dist - footRing(k.target);
  return Math.max(Math.min(0.5, near * 0.6), near - 0.4);
}
/** Where a warning jab is checked: in the air a hand short of the line, on the way from `from` to the heart. */
function warnStop(k: FxScene, from: P3): P3 {
  const d = lineOf(k), to = k.heart(k.target);
  const tipAt = (from.x - k.caster.x) * d.x + (from.y - k.caster.y) * d.y;
  const want = warnLineAt(k) - 0.06;
  return along(from, to, clamp((want - tipAt) / Math.max(0.05, k.dist - tipAt), 0.12, 0.95));
}
/** Where the line was scored and which way it lies, kept from the hit: a line in the ground does not follow the caster about. */
function warnLine(k: FxScene): { c: V2; d: V2 } {
  const d = k.once('lineD', () => ({ ...lineOf(k), z: 0 }));
  const c = k.once('lineC', () => {
    const at = warnLineAt(k);
    return k.on(k.caster.x + d.x * at, k.caster.y + d.y * at);
  });
  return { c, d };
}
/**
 * The line in the sand: a furrow of turned earth scored across the way, from
 * the middle out, with a bar of light lying in it and its lit lip; dust thrown
 * off the two ends while it is being cut.
 */
function sandLine(k: FxScene, scored: number, a: number, age: number): void {
  const { c, d } = warnLine(k);
  const half = 0.3;
  groundShapes(k, c, 0.6, [barAcross(c, d, half + 0.02, 0.13, scored)], { fill: EARTH, ink: k.pal.ink, alpha: 0.9 * a });
  groundShapes(k, c, 0.6, [barAcross({ x: c.x - d.x * 0.01, y: c.y - d.y * 0.01 }, d, half - 0.03, 0.045, scored)],
    { fill: k.pal.main, lit: k.pal.core, alpha: 0.95 * a, glow: 0.25 + 0.75 * k.night });
  if (scored < 1 && !k.fast) {
    const r = rightOf(d), h = half * scored;
    for (const s of [-1, 1]) k.emit(k.on(c.x + r.x * h * s, c.y + r.y * h * s, 0.5), 40, { kind: 'dust', colour: DUST, size: 2.2, life: [0.25, 0.5], speed: [0.1, 0.3], up: [2, 5], gravity: 4, drag: 0.1 });
  }
  if (age < 0.6) k.glow(k.on(c.x, c.y, 0.5), 10, 0.4 * (1 - age / 0.6) * a);
}

/**
 * A spear's point turned down over a bar, in sky-blue, at `p`: warned off.
 * Under it a gauge that drains as the warning runs out (`left`, nought to one
 * of its seconds), so how long it holds can be read off it.
 */
function warnSign(k: FxScene, p: P3, a: number, age: number, left: number): void {
  if (a <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), z = k.zoom;
  const L = 9 * z, W = 3 * z;
  const pal = k.pal;
  // Turning a little about its upright, so it reads as a thing in the air.
  const sq = 0.75 + 0.25 * Math.cos(age * 1.4);
  const inkW = Math.max(0.8, 0.7 * z);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    // The point, down.
    g.beginPath();
    g.moveTo(x, y - L * 0.6);
    g.lineTo(x - W * sq, y - L * 0.05);
    g.lineTo(x, y + L * 0.4);
    g.closePath();
    g.fillStyle = pal.core;
    g.fill();
    g.beginPath();
    g.moveTo(x, y - L * 0.6);
    g.lineTo(x + W * sq, y - L * 0.05);
    g.lineTo(x, y + L * 0.4);
    g.closePath();
    g.fillStyle = pal.accent;
    g.fill();
    g.beginPath();
    g.moveTo(x, y - L * 0.6);
    g.lineTo(x - W * sq, y - L * 0.05);
    g.lineTo(x, y + L * 0.4);
    g.lineTo(x + W * sq, y - L * 0.05);
    g.closePath();
    g.lineWidth = inkW;
    g.strokeStyle = pal.ink;
    g.stroke();
    // The bar it stops on: the warning's seconds, draining from the right.
    const bw = L * 1.3, bh = Math.max(1.6, 1.7 * z), bx = x - bw / 2, by = y + L * 0.55;
    g.beginPath();
    g.rect(bx, by, bw, bh);
    g.fillStyle = pal.ink;
    g.fill();
    if (left > 0.005) {
      g.beginPath();
      g.rect(bx, by, bw * left, bh);
      g.fillStyle = pal.accent;
      g.fill();
      g.beginPath();
      g.rect(bx, by, bw * left, bh * 0.4);
      g.fillStyle = pal.core;
      g.fill();
    }
    g.beginPath();
    g.rect(bx, by, bw, bh);
    g.lineWidth = inkW;
    g.strokeStyle = pal.ink;
    g.stroke();
    g.lineJoin = 'round';
  }, 4);
  k.glow(p, 10, 0.45 * a, pal.accent);
}

/** Overreach's mark of where the caster's own reach ends, on the ground across the way: only when the enemy is past it. */
function overReachMark(k: FxScene, a: number): void {
  const reach = reachHeld(k);
  if (a <= 0.01 || k.dist <= reach + 0.05) return;
  const d = lineOf(k);
  const c = { x: k.caster.x + d.x * reach, y: k.caster.y + d.y * reach };
  // A bar where the spear stops, and an arrowhead past it pointing on: the blow goes further.
  groundShapes(k, c, 0.8, [barAcross(c, d, 0.3, 0.05, a), chevronFlat({ x: c.x + d.x * 0.2, y: c.y + d.y * 0.2 }, d, 0.18 * a)],
    { fill: k.pal.accent, lit: k.pal.core, alpha: 0.9 * a, glow: 0.3 + 0.7 * k.night, light: k.pal.accent });
  k.glow(k.on(c.x, c.y, 1), 9, 0.4 * a, k.pal.accent);
}

/**
 * Overreach's cost, on the caster: a sky-blue ring round the right fist, `left`
 * of it still there, emptying round the clock over the second the next swing
 * is put back -- inked, so it reads by day.
 */
function windRing(k: FxScene, left: number, a: number): void {
  if (a <= 0.01 || left <= 0.005) return;
  const p = k.hand(1), x = k.sx(p), y = k.sy(p), z = k.zoom, R = 5 * z;
  const pal = k.pal;
  const a0 = -Math.PI / 2, a1 = a0 + TAU * left;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineCap = 'butt';
    g.beginPath();
    g.arc(x, y, R, a0, a1);
    g.lineWidth = Math.max(2, 2.2 * z);
    g.strokeStyle = pal.ink;
    g.stroke();
    g.beginPath();
    g.arc(x, y, R, a0, a1);
    g.lineWidth = Math.max(1.1, 1.2 * z);
    g.strokeStyle = pal.accent;
    g.stroke();
    // The hand of the clock, where the second has got to.
    g.beginPath();
    g.moveTo(x + Math.cos(a1) * (R - 2 * z), y + Math.sin(a1) * (R - 2 * z));
    g.lineTo(x + Math.cos(a1) * (R + 2 * z), y + Math.sin(a1) * (R + 2 * z));
    g.lineWidth = Math.max(1, 1.2 * z);
    g.strokeStyle = pal.core;
    g.stroke();
  }, 6);
  k.glow(p, 8, 0.3 * a, pal.accent);
}

/**
 * Sweep the Legs's arc at the creature's shins: centred on it, a chord as wide
 * as it stands and a little more, bowed toward the caster, its head carried
 * from the caster's right to their left (`u` of the way), and a thin low
 * light run from the real spear's point to that head, so the light carries
 * the spear's own swing.
 */
function sweepArc(k: FxScene, u: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const d = lineOf(k), across = rightOf(d), t = k.target;
  const half = footRing(t) + 0.3, bow = 0.22, lift = 2.2;
  const at = (s: number): P3 => {
    const v = s / half;
    return k.on(t.x + across.x * s - d.x * bow * (1 - v * v), t.y + across.y * s - d.y * bow * (1 - v * v), lift);
  };
  const head = lerp(half * 1.15, -half * 1.15, easeOut(u));
  const tail = Math.min(half * 1.15, head + half * 1.4);
  if (tail - head < 0.03) return;
  const pts: P3[] = [];
  const n = k.fast ? 6 : 10;
  for (let i = 0; i <= n; i++) pts.push(at(lerp(tail, head, i / n)));
  k.ribbon(pts, { width: 4.5, taper: 'start', alpha, glow: 0.6, around: t });
  // Its scuff on the ground under it, so it reads as low and flat from every side, not as a stroke in the air.
  const scuff = pts.map((p) => ({ x: p.x, y: p.y }));
  k.groundPath(scuff, { width: 3, alpha: 0.6 * alpha, main: EARTH, glow: 0 });
  const h = pts[pts.length - 1];
  if (u < 1) {
    k.polyline([point(k), h], { alpha: 0.3 * alpha, main: k.pal.light, glow: 0.3, width: 1 });
    if (!k.fast) k.emit(k.on(h.x, h.y, 0.3), 40, { kind: 'dust', colour: DUST[0], size: 2.2, life: [0.2, 0.4], speed: [0.05, 0.2], up: [1, 4], gravity: 2 });
  }
}

/**
 * Sweep the Legs's hobble round a creature's feet: two bronze cuffs either
 * side of it, `wide` times as far out as they close to, and a chain of dashes
 * between them crawling round at the pace it is cut to -- slowly, and visibly
 * so -- with a night rim.
 */
function hobble(k: FxScene, age: number, a: number, wide: number): void {
  if (a <= 0.01) return;
  const t = k.target, R = footRing(t) * wide;
  const pace = k.fx.pace ?? 0.5;
  // A chain going round at half the pace it would at full speed: you can count the links going by.
  const turn = age * pace * 1.6;
  k.ring(t, R, { band: 0.05, alpha: 0.9 * a, main: k.pal.main, deep: k.pal.deep, dash: 2, n: 14, turn, glow: 0.5 * k.night });
  // The cuffs, across the way the caster sees it: thick short arcs, sky-blue edged, closed on the legs.
  const d = lineOf(k), r = rightOf(d);
  const cuffs: V2[][] = [];
  for (const s of [-1, 1]) {
    const c = { x: t.x + r.x * R * s, y: t.y + r.y * R * s };
    cuffs.push(barAcross(c, r, 0.11, 0.07));
  }
  groundShapes(k, t, R + 0.2, cuffs, { fill: k.pal.main, lit: k.pal.accent, alpha: a, glow: 0.6 * k.night });
  k.glow(k.at(t, 0.04), 9 + R * 30, (0.15 + 0.25 * k.night) * a);
}

/** A fine dashed sight line from the leading hand to the heart, drawn on toward it. */
function sightLine(k: FxScene, from: P3, to: P3, a: number): void {
  if (a <= 0.01) return;
  const x0 = k.sx(from), y0 = k.sy(from), x1 = k.sx(to), y1 = k.sy(to);
  const z = k.zoom, accent = k.pal.accent;
  const reach = clamp(a * 1.4);
  k.glowDraw((g) => {
    g.globalAlpha = clamp(a * 0.85);
    g.strokeStyle = accent;
    g.lineWidth = Math.max(0.8, 0.9 * z);
    g.setLineDash([4 * z, 3 * z]);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(lerp(x0, x1, reach), lerp(y0, y1, reach));
    g.stroke();
    g.setLineDash([]);
  });
}

/** Four leaf points round `at`, `r` pixels out, pointing in at it: where the vital blow goes. `spin` turns them, `fly` throws them off. */
function reticle(k: FxScene, at: P3, r: number, a: number, spin: number, fly: number): void {
  if (a <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), z = k.zoom, R = r * z;
  const L = 6.5 * z, W = 2.2 * z;
  const pal = k.pal;
  k.worldDraw(k.target, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    for (let i = 0; i < 4; i++) {
      const an = spin + (i * Math.PI) / 2 + Math.PI / 4 + fly * (i % 2 ? 1 : -1) * 0.6;
      const c = Math.cos(an), s = Math.sin(an) * 0.8;
      const tx = x + c * R, ty = y + s * R;
      const ox = x + c * (R + L), oy = y + s * (R + L);
      const px = -s * W, py = c * W;
      const mx = (tx * 0.6 + ox * 0.4), my = (ty * 0.6 + oy * 0.4);
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(mx + px, my + py);
      g.lineTo(ox, oy);
      g.lineTo(mx - px, my - py);
      g.closePath();
      g.fillStyle = i < 2 ? pal.core : pal.accent;
      g.fill();
      g.lineWidth = Math.max(0.8, 0.7 * z);
      g.strokeStyle = pal.ink;
      g.stroke();
    }
    g.lineJoin = 'round';
  }, 10);
  k.glow(at, r + 5, 0.35 * a, pal.accent);
}

/**
 * Hook's furrow: from where the enemy stood toward the caster, the length it
 * is dragged, `u` of it ploughed; turned earth with a pale lit lip either
 * side, and while it is being ploughed (`live`) a light at its head, so it is
 * seen being made in the dark.
 */
function hookFurrow(k: FxScene, u: number, a: number, live: boolean): void {
  const s = k.state;
  if (u <= 0 || a <= 0.01 || s.x0 === undefined) return;
  const pull = k.fx.pull ?? 2, least = k.fx.least ?? 1;
  const from = { x: s.x0, y: s.y0 };
  const d = k.toward(from, k.caster);
  // No nearer than it may come, and never further than it is.
  const dragged = Math.max(0, Math.min(pull, (s.d0 ?? 0) - least));
  if (dragged <= 0.02) return;
  // As far as the haul has gone, or as far as the creature has been seen to come, whichever is further: on the island it is
  // moved, and the furrow is where it went.
  const len = Math.max(dragged * u, Math.min(dragged, Math.hypot(k.target.x - s.x0, k.target.y - s.y0)));
  const r = rightOf(d);
  const w0 = 0.09, w1 = 0.035;
  const pts: V2[] = [
    { x: from.x + r.x * w0, y: from.y + r.y * w0 },
    { x: from.x + d.x * len + r.x * w1, y: from.y + d.y * len + r.y * w1 },
    { x: from.x + d.x * (len + 0.1), y: from.y + d.y * (len + 0.1) },
    { x: from.x + d.x * len - r.x * w1, y: from.y + d.y * len - r.y * w1 },
    { x: from.x - r.x * w0, y: from.y - r.y * w0 },
  ];
  const c = { x: from.x + d.x * len * 0.5, y: from.y + d.y * len * 0.5 };
  groundShapes(k, c, len * 0.5 + 0.4, [pts], { fill: EARTH, ink: k.pal.ink, alpha: 0.85 * a });
  // The lip of turned earth either side, lit pale, with a night rim.
  const lip = (s1: number): V2[] => [
    { x: from.x + r.x * (w0 + 0.05) * s1, y: from.y + r.y * (w0 + 0.05) * s1 },
    { x: from.x + d.x * len + r.x * (w1 + 0.04) * s1, y: from.y + d.y * len + r.y * (w1 + 0.04) * s1 },
    { x: from.x + d.x * len + r.x * w1 * s1, y: from.y + d.y * len + r.y * w1 * s1 },
    { x: from.x + r.x * w0 * s1, y: from.y + r.y * w0 * s1 },
  ];
  groundShapes(k, c, len * 0.5 + 0.4, [lip(1), lip(-1)], { fill: k.pal.light, ink: k.pal.deep, alpha: 0.45 * a, glow: 0.2 + 0.6 * k.night });
  if (live) k.light(k.on(from.x + d.x * len, from.y + d.y * len), 1.2, 0.5, '#fff1d6');
}

/** When Rally's wave, run out over its first second (`easeOut`), gets `d` tiles from the caster: seconds after the stamp. */
const waveAt = (d: number, R: number): number => 1 - Math.cbrt(1 - clamp((d - 0.3) / Math.max(0.01, R - 0.3)));

/** Rally's wave edge: small upright pike-heads riding round it, the group's own point, `r` tiles out. */
function rallyHeads(k: FxScene, r: number, a: number): void {
  if (a <= 0.01 || r < 0.5) return;
  const c = k.caster, n = k.fast ? 8 : 12, z = k.zoom;
  const pal = k.pal;
  // Two records, the far half behind the caster and the near half in front, each sorted with what stands there.
  for (const nearSide of [false, true]) {
    const pieces: Array<{ pts: P3[]; fill?: string | false; ink?: string | false; alpha?: number }> = [];
    for (let i = 0; i < n; i++) {
      const an = (i / n) * TAU + 0.2;
      const x = c.x + Math.cos(an) * r, y = c.y + Math.sin(an) * r;
      // Nearer the viewer is further down the screen: x + y larger.
      if ((x + y > c.x + c.y) !== nearSide) continue;
      const b = k.on(x, y, 0), h = 6 * (1 + 0.15 * Math.sin(i * 1.7)), w = 0.9 / 40;
      const tx = -Math.sin(an) * w, ty = Math.cos(an) * w;
      pieces.push({ pts: [{ x: b.x, y: b.y, z: b.z + h }, { x: b.x + tx, y: b.y + ty, z: b.z + h * 0.45 }, { x: b.x, y: b.y, z: b.z }, { x: b.x - tx, y: b.y - ty, z: b.z + h * 0.45 }], fill: i % 2 ? pal.core : pal.main, ink: pal.ink, alpha: a });
    }
    if (pieces.length) k.shapes(nearSide ? k.on(c.x + r * 0.7, c.y + r * 0.7) : k.on(c.x - r * 0.7, c.y - r * 0.7), pieces, { width: Math.max(0.7, 0.6 * z) });
  }
}

/** Rally's breath given back off the empty ground: a few double chevrons rising in a ring where the wave has just passed. */
function rallyChevrons(k: FxScene, R: number, reached: number, age: number, fade: number): void {
  if (fade <= 0.01) return;
  const n = k.fast ? 5 : 8;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU + hashOf(k.seed, i) * 0.5;
    const rr = R * (0.45 + 0.4 * hashOf(k.seed + 1, i));
    if (rr > reached) continue;
    // Each rises from when the wave went over it.
    const v = clamp((age - waveAt(rr, R)) / 0.7);
    if (v <= 0 || v >= 1) continue;
    const p = k.on(k.caster.x + Math.cos(an) * rr, k.caster.y + Math.sin(an) * rr, 4 + 16 * v);
    pts.push(k.sx(p), k.sy(p), Math.sin(Math.PI * v));
  }
  if (!pts.length) return;
  const z = k.zoom, core = k.pal.core, accent = k.pal.accent;
  k.glowDraw((g) => {
    g.lineWidth = Math.max(1.2, 1.8 * z);
    g.lineJoin = 'miter';
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], s = 7 * z;
      g.globalAlpha = clamp(pts[i + 2] * fade);
      for (const [dy, col] of [[0, accent], [s * 0.55, core]] as const) {
        g.strokeStyle = col;
        g.beginPath();
        g.moveTo(x - s, y + dy + s * 0.5);
        g.lineTo(x, y + dy - s * 0.2);
        g.lineTo(x + s, y + dy + s * 0.5);
        g.stroke();
      }
    }
    g.lineJoin = 'round';
  });
}

/**
 * Stamina given back to somebody the rally reached, `since` seconds after the
 * wave got to them: three chevrons stacked over the head rising, and a short
 * bar filling under them by the share of a full bar it gives -- inked, so it
 * reads by day -- over about a second.
 */
function given(k: FxScene, b: Body, since: number): void {
  if (since < 0 || since > 1.1) return;
  const a = smooth(since / 0.12) * (1 - smooth(seg(since, 0.8, 1.1)));
  const p = k.at(b, 1.08), z = k.zoom;
  const x = k.sx(p), y = k.sy(p) - 4 * z * easeOut(clamp(since / 0.6));
  const share = k.fx.stamina ?? 0.2;
  const pal = k.pal;
  const fill = easeOut(clamp((since - 0.1) / 0.4));
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    const s = 4.2 * z;
    for (let i = 0; i < 3; i++) {
      const cy = y - i * 3.6 * z - 3 * z;
      g.beginPath();
      g.moveTo(x - s, cy + s * 0.55);
      g.lineTo(x, cy - s * 0.2);
      g.lineTo(x + s, cy + s * 0.55);
      g.lineWidth = Math.max(2, 3 * z);
      g.strokeStyle = pal.ink;
      g.stroke();
      g.lineWidth = Math.max(1.1, 1.6 * z);
      g.strokeStyle = i === 1 ? pal.accent : pal.core;
      g.stroke();
    }
    // The bar: a full bar's width, filled by the share it gives back.
    const bw = 16 * z, bh = Math.max(1.6, 1.8 * z), bx = x - bw / 2, by = y + 2 * z;
    g.fillStyle = pal.ink;
    g.fillRect(bx, by, bw, bh);
    g.fillStyle = '#c9d86a';
    g.fillRect(bx, by, bw * share * fill, bh);
    g.lineWidth = Math.max(0.8, 0.7 * z);
    g.strokeStyle = pal.ink;
    g.strokeRect(bx, by, bw, bh);
    g.lineJoin = 'round';
  }, 6);
  k.glow(p, 8, 0.4 * a);
}

/** Twin Thrust's two marks on the creature: the first high in the chest, the second low and a little to one side. */
function twinAim(k: FxScene, which: number): P3 {
  const h = k.heart(k.target);
  if (!which) return { ...h, z: h.z + TWIN_HIGH };
  const d = lineOf(k);
  const r = rightOf(d);
  return { x: h.x + r.x * 0.06, y: h.y + r.y * 0.06, z: h.z + TWIN_LOW };
}
/** One jab of Twin Thrust at cast-time `t`, landing at `at` of the cast on `to` and held to `hold`: out, held, drawn back before the pose lets it go. */
function jab(k: FxScene, t: number, at: number, hold: number, to: P3, name: string, o: LanceLook): void {
  const out = seg(t, at - 0.035, at);
  const back = smooth(seg(t, hold - 0.04, hold));
  if (out <= 0 || back >= 1) return;
  // Out from the live point; from where the point was when it went in, once it has.
  const from = t >= at ? k.once(name, () => point(k)) : point(k);
  lance(k, from, along(from, to, easeOut(out) * (1 - 0.85 * back)), { ...o, alpha: 1 - back });
}

/** The creature's own reach, in tiles: how near it strikes from (a thrower from far off), as the island has it. */
const theirReach0 = (k: FxScene): number => k.target.reach ?? HUNT_REACH;
/** Whether a Reach Advantage was struck from outside the creature's own reach. */
const outReach = (k: FxScene): boolean => k.dist > theirReach0(k) + 1e-6;
/** The red-brown of a reach the caster stands inside. */
const INSIDE = '#9a4a2a';
/**
 * The creature's own reach laid round it as a dashed ring, and a tick across
 * the line at the caster's feet saying which side of it they stand: struck
 * (`broke` from nought) from outside, the dashes thrown outward and turning
 * as they go, a gap where the blow came through; from inside, the ring kept
 * whole, red-brown, closing in on the caster a little.
 */
function theirReach(k: FxScene, a: number, broke: number): void {
  if (a <= 0.01) return;
  const big = outReach(k);
  const t = k.target, R0 = theirReach0(k);
  const R = big ? R0 : R0 - 0.1 * easeOut(clamp(broke * 3));
  // Dashes of one length however big the ring: a thrower's six tiles is a long way round.
  const n = Math.round(clamp(R * 24, 20, k.fast ? 40 : 64));
  const toC = Math.atan2(k.caster.y - t.y, k.caster.x - t.x);
  const dashes: V2[][] = [];
  const spread = big ? easeOut(clamp(broke * 1.6)) : 0;
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU + broke * 0.2;
    // The gap where the blow came through.
    if (spread > 0 && Math.abs(Math.atan2(Math.sin(an - toC), Math.cos(an - toC))) < 0.12 + 0.3 * spread) continue;
    const rr = R + 0.15 * spread * (0.6 + 0.8 * hashOf(k.seed, i));
    const tw = (hashOf(k.seed + 3, i) - 0.5) * 1.2 * spread;
    const half = Math.min((Math.PI / n) * 0.55, 0.07 / R) * (1 - 0.4 * spread);
    const p = (r: number, q: number): V2 => ({ x: t.x + Math.cos(q) * r, y: t.y + Math.sin(q) * r });
    const w = 0.035;
    dashes.push([p(rr + w, an - half + tw * 0.1), p(rr + w, an + half + tw * 0.1), p(rr - w, an + half - tw * 0.1), p(rr - w, an - half - tw * 0.1)]);
  }
  const col = big ? (broke > 0 ? k.pal.accent : k.pal.deep) : broke > 0 ? INSIDE : k.pal.deep;
  groundShapes(k, t, R + 0.3, dashes, { fill: col, ink: k.pal.ink, lit: big && broke > 0 ? k.pal.core : undefined, alpha: a * (1 - 0.6 * spread * broke), glow: (big ? 0.4 : 0.15) * (0.4 + 0.6 * k.night), light: big ? k.pal.accent : INSIDE });
}

/**
 * Skewer's lane: the ground behind the creature the thrust goes down,
 * `behind` tiles long and as wide as the rule either side of the line, `u` of
 * it laid; the far half darker, sky-blue edges, arrowheads down the middle.
 */
function skewerLane(k: FxScene, t: V2, d: V2, behind: number, u: number, a: number): void {
  if (u <= 0 || a <= 0.01) return;
  const half = k.fx.width ?? 0.5;
  const r = rightOf(d);
  const len = behind * easeOut(u);
  const quad = (s0: number, s1: number): V2[] => [
    { x: t.x + d.x * s0 - r.x * half, y: t.y + d.y * s0 - r.y * half },
    { x: t.x + d.x * s0 + r.x * half, y: t.y + d.y * s0 + r.y * half },
    { x: t.x + d.x * s1 + r.x * half, y: t.y + d.y * s1 + r.y * half },
    { x: t.x + d.x * s1 - r.x * half, y: t.y + d.y * s1 - r.y * half },
  ];
  const c = { x: t.x + d.x * len * 0.5, y: t.y + d.y * len * 0.5 };
  const R = behind * 0.5 + half + 0.3;
  groundShapes(k, c, R, [quad(0, Math.min(len, behind * 0.5))], { fill: k.pal.main, ink: false, alpha: 0.2 * a });
  if (len > behind * 0.5) groundShapes(k, c, R, [quad(behind * 0.5, len)], { fill: k.pal.deep, ink: false, alpha: 0.24 * a });
  // Its two edges and a run of arrowheads down the middle, the way the thrust goes.
  groundShapes(k, c, R, [
    barAlong(t, d, len, half), barAlong(t, d, len, -half),
    ...[0.3, 0.6, 0.9].filter((f) => f * behind <= len).map((f) => chevronFlat({ x: t.x + d.x * f * behind, y: t.y + d.y * f * behind }, d, 0.18)),
  ], { fill: k.pal.accent, lit: k.pal.core, alpha: 0.9 * a, glow: 0.25 + 0.6 * k.night, light: k.pal.accent });
}
/** A bar along the way `d` from `p`, `len` tiles, `side` tiles to the right of it. */
function barAlong(p: V2, d: V2, len: number, side: number): V2[] {
  const r = rightOf(d);
  const w = 0.02;
  return [
    { x: p.x + r.x * (side + w), y: p.y + r.y * (side + w) },
    { x: p.x + d.x * len + r.x * (side + w), y: p.y + d.y * len + r.y * (side + w) },
    { x: p.x + d.x * len + r.x * (side - w), y: p.y + d.y * len + r.y * (side - w) },
    { x: p.x + r.x * (side - w), y: p.y + r.y * (side - w) },
  ];
}
/** Whatever else stands in Skewer's lane, struck as the thrust gets `got` tiles down it: a spark and a glint off each, once. */
function skewered(k: FxScene, t: Body | P3, d: V2, behind: number, got: number): void {
  const half = k.fx.width ?? 0.5;
  const r = rightOf(d);
  const all = k.enemiesWithin(behind + half + 0.5, { x: t.x + d.x * behind * 0.5, y: t.y + d.y * behind * 0.5 });
  for (let i = 0; i < all.length && i < 6; i++) {
    const b = all[i];
    const ax = (b.x - t.x) * d.x + (b.y - t.y) * d.y, sd = Math.abs((b.x - t.x) * r.x + (b.y - t.y) * r.y);
    if (ax <= 0.15 || ax > behind || sd > half || ax > got) continue;
    const key = `sk${Math.round(b.x * 10)}_${Math.round(b.y * 10)}`;
    if (!k.state[key]) {
      k.state[key] = k.now;
      pierce(k, k.heart(b), d, 0.5);
    }
    const age = k.now - k.state[key];
    if (age < 0.35) k.flare(k.heart(b), 7 * (1 - age / 0.35), flashOf(age / 0.35, 0.1), k.pal.core, 0.4);
  }
}

/**
 * Keep Away's shove: a flat bar of light the length of the shaft at the
 * height of the chest, square to the way the caster faces, driven straight
 * out the one tile a blow will push and thinning as it goes -- one inked quad
 * with its top edge lit -- and dust kicked off the ground under it.
 */
function shoveBar(k: FxScene, u: number): void {
  const push = k.fx.push ?? 1;
  const d = k.facingDir(k.caster), r = rightOf(d);
  const out = 0.25 + push * easeOut(u);
  const a = 0.95 * (1 - smooth(seg(u, 0.45, 1)));
  if (a <= 0.01) return;
  const c = k.caster;
  // As long as the shaft, from butt to point.
  const half = (SPEAR_LONG / 2 / UNITS_PER_TILE) * (1 + 0.15 * u);
  const g = k.ground(c.x + d.x * out, c.y + d.y * out);
  const mid = c.tall * 0.55, th = 1.5 * (1 - 0.6 * u);
  // Slanted as the shaft is held, its left end high: seen from the side too, not end-on.
  const tilt = 4;
  const pt = (s: number, z: number): P3 => ({ x: c.x + d.x * out + r.x * s, y: c.y + d.y * out + r.y * s, z: g + z - (s / half) * tilt });
  const top = [pt(-half, mid + th), pt(half, mid + th)];
  k.shapes(pt(0, 0), [
    { pts: [pt(-half - 0.02, mid), top[0], top[1], pt(half + 0.02, mid), pt(half, mid - th), pt(-half, mid - th)], fill: k.pal.light, ink: k.pal.ink, alpha: 0.8 * a },
    { pts: [top[0], top[1]], fill: false, ink: k.pal.core, width: Math.max(1.2, 1.6 * k.zoom), alpha: a, closed: false },
  ], { width: Math.max(0.8, 0.7 * k.zoom) });
  k.glow(pt(0, mid), 10, 0.45 * a);
  if (!k.fast) k.emit(k.on(c.x + d.x * out, c.y + d.y * out, 0.3), 25 * a, { kind: 'dust', colour: DUST, size: 2.4, life: [0.25, 0.5], speed: [0.1, 0.4], up: [1, 4], heading: d, cone: 1.2, gravity: 3, drag: 0.1, jitter: half * 0.8 });
}

/** Arrowheads round the caster's feet at `r` tiles, `n` of them pointing out, `len` tiles long. */
function pushRing(k: FxScene, r: number, n: number, len: number, a: number, turn: number): void {
  if (a <= 0.01) return;
  const c = k.caster;
  const shapes: V2[][] = [];
  for (let i = 0; i < n; i++) {
    const an = turn + (i / n) * TAU;
    const d = { x: Math.cos(an), y: Math.sin(an) };
    shapes.push(chevronFlat({ x: c.x + d.x * r, y: c.y + d.y * r }, d, len));
  }
  groundShapes(k, c, r + len, shapes, { fill: k.pal.accent, lit: k.pal.core, alpha: a, glow: 0.6 * k.night, light: k.pal.accent });
  k.glow(k.at(c, 0.02), 10 + r * 14, 0.2 * a, k.pal.accent);
}

/**
 * Keep Away's guidon on the spear: a square flag of sky-blue with a white
 * chevron on it pointing out, away from the body -- not Rally's swallow-tailed
 * bronze pennon -- stirring a little. Sorted with `body`.
 */
function guidon(k: FxScene, top: P3, body: P3, a: number, phase: number): void {
  if (a <= 0.01) return;
  const z = k.zoom;
  const x = k.sx(top), y = k.sy(top) + 1.4 * z;
  // Flown off the body's right, where the spear is carried: the same side all the while, whatever the spear does.
  const fly = Math.sign(k.sx(k.local(k.caster, 6, 0, 0)) - k.sx(k.caster)) || 1;
  const L = 9 * z, h = 6.5 * z;
  const w1 = Math.sin(phase) * h * 0.12, w2 = Math.sin(phase + 1.4) * h * 0.16;
  const pal = k.pal;
  k.worldDraw(body, (g) => {
    g.globalAlpha = a;
    g.lineJoin = 'miter';
    const c = [[x, y], [x + fly * L, y + w2], [x + fly * L, y + h + w2], [x, y + h]] as const;
    g.beginPath();
    g.moveTo(c[0][0], c[0][1]);
    for (let i = 1; i < 4; i++) g.lineTo(c[i][0], c[i][1]);
    g.closePath();
    g.fillStyle = pal.accent;
    g.fill();
    // The chevron, pointing out the way the flag flies: away.
    g.beginPath();
    g.moveTo(x + fly * L * 0.25, y + h * 0.15 + w1);
    g.lineTo(x + fly * L * 0.72, y + h * 0.5 + w2 * 0.8);
    g.lineTo(x + fly * L * 0.25, y + h * 0.85 + w1);
    g.lineWidth = Math.max(1.2, 1.5 * z);
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.beginPath();
    g.moveTo(c[0][0], c[0][1]);
    for (let i = 1; i < 4; i++) g.lineTo(c[i][0], c[i][1]);
    g.closePath();
    g.lineWidth = Math.max(0.8, 0.7 * z);
    g.strokeStyle = pal.ink;
    g.stroke();
    g.lineJoin = 'round';
  }, 3);
}

/**
 * Fend Off's whirl: a disc of motion cut by the spear turning end over end
 * before the body -- two thin arcs behind its point and one behind its butt,
 * up to three quarters round, all about the one middle the hands turn it on
 * (`WHIRL_AT`), in the plane the pose turns it in.
 */
function fendWheel(k: FxScene, t: number): void {
  const [s0, s1] = FEND_SPIN;
  const on = bump(t, s0, s0 + 0.06, s1 + 0.02);
  if (on <= 0.01) return;
  // The spear turns about its own middle: each end this far from it.
  const rad = SPEAR_LONG / 2;
  const a = whirlOf(t), gone = a - whirlOf(s0);
  const lag = Math.min(gone, Math.PI * 1.5);
  if (lag < 0.2) return;
  const n = k.fast ? 8 : 14;
  const arc = (r: number, ahead: number, lagOf: number): P3[] => {
    const pts: P3[] = [];
    for (let i = n; i >= 0; i--) {
      const q = ahead - (i / n) * lagOf;
      const w = add3(WHIRL_AT, add3(mul3(WHIRL_X, Math.cos(q) * r), mul3(WHIRL_Z, Math.sin(q) * r)));
      pts.push(k.local(k.caster, w[0], w[1], w[2]));
    }
    return pts;
  };
  k.ribbon(arc(rad, a, lag), { width: 3.4, taper: 'start', alpha: 0.9 * on, glow: 0.6 });
  k.ribbon(arc(rad * 0.8, a, lag * 0.7), { width: 1.6, taper: 'start', alpha: 0.7 * on, main: k.pal.accent, glow: 0 });
  k.ribbon(arc(rad, a + Math.PI, lag * 0.6), { width: 2, taper: 'start', alpha: 0.55 * on, glow: 0.3 });
}

/** Fend Off's ring at `r`: a band, and leaf points lying flat on it pointing outward. `grow` draws the points out. */
function fendRing(k: FxScene, r: number, a: number, grow: number): void {
  if (a <= 0.01) return;
  const c = k.caster;
  const n = k.fast ? 6 : 8;
  k.ring(c, r, { band: 0.06, alpha: 0.85 * a, main: k.pal.accent, glow: 0.6 * k.night, n: 32 });
  const shapes: V2[][] = [];
  const len = 0.2 * clamp(grow * 1.6);
  if (len > 0.02) {
    for (let i = 0; i < n; i++) {
      const an = (i / n) * TAU + Math.PI / n;
      const d = { x: Math.cos(an), y: Math.sin(an) };
      shapes.push(leafFlat({ x: c.x + d.x * (r - 0.06), y: c.y + d.y * (r - 0.06) }, d, len));
    }
    groundShapes(k, c, r + len, shapes, { fill: k.pal.main, lit: k.pal.core, alpha: a, glow: 0.5 * k.night });
  }
}

/**
 * Brace's hedge: a ring scored on the ground round the caster at `R` tiles,
 * and on it a cheval-de-frise of pikes of light -- pairs crossed in an X,
 * leant out over the ring -- `rise` of their height up, each pair one record
 * so they sort with whatever stands by them; and a faint line of light run out
 * from the braced spear's own point along its way to the ring.
 */
function hedge(k: FxScene, R: number, rise: number, a: number, age: number): void {
  if (a <= 0.01) return;
  const c = k.caster;
  k.ring(c, R, { band: 0.1, alpha: 0.75 * a, n: 40, glow: 0.5 * k.night });
  if (rise < 0.98) k.ring(c, R - 0.2, { band: 0.035, alpha: 0.55 * a * (1 - rise), main: k.pal.accent, glow: 0, n: 40 });
  if (rise <= 0.02) return;
  const n = k.fast ? 6 : 8;
  const lean = Math.sin(50 * DEG), len = 26;
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU + hashOf(k.seed, i) * 0.1;
    const d = { x: Math.cos(an), y: Math.sin(an) };
    // Rising one after the next round the ring.
    const own = clamp(rise * 1.3 - hashOf(k.seed + 2, i) * 0.3);
    if (own > 0.02) cheval(k, k.on(c.x + d.x * (R - 0.12), c.y + d.y * (R - 0.12), 0), d, len * own, lean, a, age + i);
  }
  // The braced spear's own line, out to where it stops a charge.
  const tip = spearTip(k), butt = spearButt(k);
  const dx = tip.x - butt.x, dy = tip.y - butt.y, l = Math.hypot(dx, dy);
  if (l > 0.01) {
    const end = k.on(c.x + (dx / l) * R, c.y + (dy / l) * R, len * rise * 0.72);
    k.polyline([tip, end], { alpha: 0.3 * a * rise, main: k.pal.light, glow: 0.3, width: 1 });
  }
}

/** Two pikes crossed in an X standing at `base`, leant out along `d` by `lean` (the sine of it), `len` height units long. */
function cheval(k: FxScene, base: P3, d: V2, len: number, lean: number, a: number, beat: number): void {
  const r = rightOf(d);
  const draws: Array<(g: CanvasRenderingContext2D) => void> = [];
  for (const side of [-1, 1]) {
    // Their feet a little apart along the ring, their heads crossing over and apart the other way.
    const foot = { x: base.x + r.x * side * 0.07, y: base.y + r.y * side * 0.07, z: base.z };
    const out = len * lean, up = len * Math.sqrt(1 - lean * lean);
    const tip = {
      x: foot.x + (d.x * out - r.x * side * len * 0.3) / UNITS_PER_TILE,
      y: foot.y + (d.y * out - r.y * side * len * 0.3) / UNITS_PER_TILE,
      z: foot.z + up + 0.25 * Math.sin(k.now * 2.4 + beat + side),
    };
    lance(k, foot, tip, { width: 2.6, head: 11, glow: 0, alpha: a, into: draws, plain: true });
  }
  k.worldDraw(base, (g) => {
    for (const draw of draws) draw(g);
  });
  // One glow where the heads cross rather than one down each shaft: a hedge of them stands for seconds.
  k.glow({ x: base.x + (d.x * len * lean) / UNITS_PER_TILE, y: base.y + (d.y * len * lean) / UNITS_PER_TILE, z: base.z + len * Math.sqrt(1 - lean * lean) * 0.9 }, 11, 0.4 * a);
}
