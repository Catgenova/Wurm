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
 * The figure's limit (render/figure.ts): a spear is carried upright in the
 * right fist (`carry: 'staff'`), set off the hips, and only a fist weapon
 * follows the forearm (`wield`). The casts are drawn with that spear
 * standing in the fist -- the thrusts drive the fist along the line of the
 * blow and the lance of light leaves it; the rally lifts the standing spear
 * overhead as a standard; the brace lowers it to plant the butt -- and the
 * spear's head is found from the fist the way the figure stands it
 * (`spearTip`).
 */
import { WEAPON_BY_ID } from '../../game/gear';
import { HUNT_REACH, reachOf } from '../../game/fight';
import { weaponCarry, type Rig } from '../figure';
import { UNITS_PER_TILE } from '../iso';
import type { CastPose, SpellVisual } from './index';
import { spellInfo } from './info';
import {
  bump, clamp, easeBack, easeOut, flashOf, glowPicture, hashOf, lerp, mid3, seg, smooth, TAU,
  type FxScene, type P3, type SpellPalette,
} from './kit';
import { euler, one } from './poses';

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

/** How far the caster's own weapon reaches, as the fight reckons it: a spear's when it is not a weapon the fight knows. */
function reachHeld(k: FxScene): number {
  const id = k.caster.figure?.gear?.weapon?.id;
  const w = id ? WEAPON_BY_ID.get(id) : undefined;
  return w ? reachOf(w) : SPEAR_REACH;
}

/* ---- where the spear is ---------------------------------------------------------------- */

/*
 * The figure stands a spear in the right fist leaning forward and out past the
 * face, by a table of facings (figure.ts `staffUp`); these are that table, so
 * the head of the spear can be found for a banner or a glint on it. The figure
 * does not hand its weapon's geometry out: if it is changed there, change it here.
 */
const STAFF_BACK = [0, 1, 0, 0, 0, 1, 0, 0];
const STAFF_BACK_BY = -8;
const STAFF_OUT = [10, 22, 10, 10, 10, 32, 10, 10];
const STAFF_LEAST = [0, 0, 22, 0, 0, 0, 22, 0];
/** A spear's lean forward in the fist, and how far its point is past the fist, in height units (figure.ts `spear`). */
const SPEAR_LEAN = 7;
const SPEAR_POINT = 14.4;

/** The point of the spear the caster holds, or, with nothing standing in the fist, a hand's width over the fist. */
function spearTip(k: FxScene, b = k.caster): P3 {
  const hand = k.hand(1, b);
  const id = b.figure?.gear?.weapon?.id;
  if (!id || weaponCarry(id)?.carry !== 'staff') return { x: hand.x, y: hand.y, z: hand.z + 4 };
  const f = ((Math.round(b.facing) % 8) + 8) % 8;
  const back = STAFF_BACK[f];
  const ahead = Math.max(SPEAR_LEAN, STAFF_LEAST[f]);
  const fwd = ((ahead + (STAFF_BACK_BY - ahead) * back) * Math.PI) / 180, out = (STAFF_OUT[f] * Math.PI) / 180;
  const d = [Math.sin(out), Math.sin(fwd), Math.cos(out) * Math.cos(fwd)];
  const o = k.local(b, 0, 0, 0), q = k.local(b, d[0] * SPEAR_POINT, d[1] * SPEAR_POINT, d[2] * SPEAR_POINT);
  return { x: hand.x + q.x - o.x, y: hand.y + q.y - o.y, z: hand.z + q.z - o.z };
}

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
 * stands over the point that has gone into it.
 */
function lance(k: FxScene, butt: P3, tip: P3, o: LanceLook = {}): void {
  const a = clamp(o.alpha ?? 1);
  if (a <= 0.01) return;
  const x0 = k.sx(butt), y0 = k.sy(butt), x1 = k.sx(tip), y1 = k.sy(tip);
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 2) return;
  const z = k.zoom;
  const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
  const nx = -dy, ny = dx;
  // The lit side of the head: whichever of its two halves faces up and left.
  const s = -0.6 * nx - 0.8 * ny >= 0 ? 1 : -1;
  const H = Math.min(len * 0.7, (o.head ?? 9) * z);
  const W = H * 0.3;
  const w = Math.max(0.7, ((o.width ?? 2.2) * z) / 2);
  const bx = x1 - dx * H, by = y1 - dy * H;
  const shx = x1 - dx * H * 0.4, shy = y1 - dy * H * 0.4;
  const pal = k.pal;
  const inkW = Math.max(0.8, 0.7 * z);
  const tiles = Math.hypot(tip.x - butt.x, tip.y - butt.y);
  const sortAt = o.sortAt ?? along(butt, tip, tiles > 0.01 ? clamp(0.3 / tiles) : 0);
  const draw = (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = a;
    g.lineJoin = 'miter';
    // The shaft, half as thick at the butt.
    g.beginPath();
    g.moveTo(x0 + nx * w * 0.5, y0 + ny * w * 0.5);
    g.lineTo(bx + nx * w, by + ny * w);
    g.lineTo(bx - nx * w, by - ny * w);
    g.lineTo(x0 - nx * w * 0.5, y0 - ny * w * 0.5);
    g.closePath();
    g.fillStyle = pal.main;
    g.fill();
    g.lineWidth = inkW;
    g.strokeStyle = pal.ink;
    g.stroke();
    g.beginPath();
    g.moveTo(x0 + nx * s * w * 0.15, y0 + ny * s * w * 0.15);
    g.lineTo(bx + nx * s * w * 0.35, by + ny * s * w * 0.35);
    g.lineWidth = Math.max(0.6, w * 0.6);
    g.strokeStyle = pal.core;
    g.stroke();
    // A billhook's barb: out from the foot of the head on the shaded side and curled back toward the hands.
    if (o.hook) {
      const hx = bx - nx * s * W * 0.2, hy = by - ny * s * W * 0.2;
      g.beginPath();
      g.moveTo(hx + dx * H * 0.18, hy + dy * H * 0.18);
      g.lineTo(hx + dx * H * 0.05 - nx * s * W * 1.9, hy + dy * H * 0.05 - ny * s * W * 1.9);
      g.lineTo(hx - dx * H * 0.45 - nx * s * W * 1.5, hy - dy * H * 0.45 - ny * s * W * 1.5);
      g.lineTo(hx - dx * H * 0.08 - nx * s * W * 0.95, hy - dy * H * 0.08 - ny * s * W * 0.95);
      g.lineTo(hx - dx * H * 0.12, hy - dy * H * 0.12);
      g.closePath();
      g.fillStyle = pal.deep;
      g.fill();
      g.strokeStyle = pal.ink;
      g.lineWidth = inkW;
      g.stroke();
    }
    // The socket, a band of sky-blue where the head is set on.
    g.beginPath();
    g.moveTo(bx + nx * w * 1.35, by + ny * w * 1.35);
    g.lineTo(bx + nx * w * 1.35 - dx * H * 0.2, by + ny * w * 1.35 - dy * H * 0.2);
    g.lineTo(bx - nx * w * 1.35 - dx * H * 0.2, by - ny * w * 1.35 - dy * H * 0.2);
    g.lineTo(bx - nx * w * 1.35, by - ny * w * 1.35);
    g.closePath();
    g.fillStyle = pal.accent;
    g.fill();
    g.strokeStyle = pal.ink;
    g.lineWidth = inkW;
    g.stroke();
    // The leaf: its lit half pale, its shaded half bronze, a midrib between.
    const half = (side: number, fill: string): void => {
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(shx + nx * side * W, shy + ny * side * W);
      g.lineTo(x1, y1);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    };
    half(s, pal.core);
    half(-s, pal.main);
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(shx + nx * W, shy + ny * W);
    g.lineTo(x1, y1);
    g.lineTo(shx - nx * W, shy - ny * W);
    g.closePath();
    g.strokeStyle = pal.ink;
    g.lineWidth = inkW;
    g.stroke();
    g.beginPath();
    g.moveTo(shx + nx * s * W * 0.82, shy + ny * s * W * 0.82);
    g.lineTo(x1 - dx * z * 0.6, y1 - dy * z * 0.6);
    g.strokeStyle = pal.accent;
    g.lineWidth = Math.max(0.7, 0.8 * z);
    g.stroke();
    g.lineJoin = 'round';
  };
  if (o.into) o.into.push(draw);
  else k.worldDraw(sortAt, draw, o.bias ?? 0);
  const gl = o.glow ?? 1;
  if (gl > 0) {
    const pic = glowPicture(pal.light);
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

/** A point on the ground projected to the screen, a hair over it. */
function onScreen(k: FxScene, x: number, y: number, out: number[]): void {
  out.push(k.eye.worldToScreenX(x, y), k.eye.worldToScreenY(x, y, k.ground(x, y) + 0.15));
}

/**
 * Flat shapes laid on the ground round `c` (within `r` tiles), each a list of
 * points over the land in tiles: one fill, an ink edge, and, for each, its
 * edge nearest the light picked out in `lit`. One record however many.
 */
function groundShapes(k: FxScene, c: V2, r: number, shapes: ReadonlyArray<ReadonlyArray<V2>>, o: { fill?: string; ink?: string; lit?: string; alpha?: number }): void {
  const a = clamp(o.alpha ?? 1);
  if (a <= 0.01 || !shapes.length) return;
  const pts: number[][] = shapes.map((s) => {
    const out: number[] = [];
    for (const p of s) onScreen(k, p.x, p.y, out);
    return out;
  });
  const fill = o.fill ?? k.pal.main, ink = o.ink ?? k.pal.ink, lit = o.lit;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  k.groundDraw(c.x, c.y, r + 0.5, (g) => {
    g.globalAlpha = a;
    g.beginPath();
    for (const p of pts) {
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
      g.closePath();
    }
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    g.stroke();
    if (lit) {
      // The far edge of each, the one the light falls across first: its first side.
      g.beginPath();
      for (const p of pts) {
        g.moveTo(p[0], p[1]);
        g.lineTo(p[2], p[3]);
      }
      g.lineWidth = Math.max(0.8, 0.9 * k.zoom);
      g.strokeStyle = lit;
      g.stroke();
    }
  });
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

/** Warning Thrust: the fist drawn to the hip, a jab checked half way and held, the leading foot stamped down with it. */
const WARN_T = { secs: 0.95, release: 0.42 };
const warnPose: CastPose = (r, t) => {
  const top = 0.32, at = WARN_T.release, hold = 0.66;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [top, [-14, 18, 6]], [at, [66, 6, 6]], [hold, [64, 6, 6]], [1, [22, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [top, 96], [at, 34], [hold, 36], [1, 40]]);
  // The left hand up and open, palm out at it: back.
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [top, [48, 10, 18]], [at, [76, 6, 10]], [hold, [74, 6, 10]], [1, [22, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [top, 60], [at, 22], [hold, 24], [1, 30]]);
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [top, [-30, 0, 0]], [at, [-72, 0, 0]], [hold, [-70, 0, 0]], [1, [0, 0, 0]]]);
  r.open[0] = t > 0.2 && t < 0.86;
  // The stamp: the left foot up as the fist comes back, down hard on the jab.
  stance(r, t, [[0, 2, 4, 0, P], [top * 0.9, 34, 72, 6, 14], [at, 20, 10, 12, P], [hold, 20, 12, 12, P], [1, 4, 4, 2, P]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [4, 0, -4]], [at, [-8, 0, 2]], [hold, [-7, 0, 2]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [2, 0, -18]], [at, [-4, 0, 8]], [hold, [-4, 0, 8]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [top, [0, 0, 12]], [at, [-6, 0, -4]], [hold, [-8, 0, -4]], [1, [0, 0, 0]]]);
};

/** Overreach: coiled back on the rear leg, then the longest lunge there is, one arm out to its end and the other flung back; held there, and slow to come back. */
const OVER_T = { secs: 1.25, release: 0.34, blendOut: 0.34 };
const overPose: CastPose = (r, t) => {
  const top = 0.27, at = OVER_T.release, hold = 0.62;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [top, [-22, 16, 6]], [at, [96, 2, 0]], [hold, [94, 2, 0]], [0.84, [50, 8, 0]], [1, [22, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [top, 104], [at, 0], [hold, 2], [0.84, 30], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [at, [-12, 0, 0]], [hold, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [top, [52, 14, 14]], [at, [-48, 34, 0]], [hold, [-44, 34, 0]], [0.84, [0, 20, 0]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [top, 50], [at, 8], [hold, 10], [1, 30]]);
  r.open[0] = t > at - 0.04 && t < 0.8;
  stance(r, t, [[0, 2, 4, 0, P], [top, 16, 50, 20, P], [at, 62, 80, 40, P], [hold, 60, 78, 40, P], [0.84, 26, 34, 14, P], [1, 4, 4, 2, P]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [8, 0, -6]], [at, [-26, 0, 6]], [hold, [-24, 0, 6]], [0.84, [-8, 0, 2]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [4, 0, -26]], [at, [-8, 0, 18]], [hold, [-8, 0, 18]], [1, [0, 0, 0]]]);
  // The eyes kept on it all the way down the lunge.
  r.head = euler(t, [[0, [0, 0, 0]], [top, [-2, 0, 20]], [at, [20, 0, -12]], [hold, [18, 0, -12]], [1, [0, 0, 0]]]);
};

/** Sweep the Legs: down on both knees' worth of crouch, the fist swung low and flat from the right across the front to the left. */
const SWEEP_T = { secs: 1.05, release: 0.46 };
const sweepPose: CastPose = (r, t) => {
  const top = 0.34, at = SWEEP_T.release, thru = 0.62;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [top, [14, 74, -24]], [at, [58, -8, 30]], [thru, [40, -28, 40]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [top, 22], [at, 6], [thru, 24], [1, 40]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [top, [46, 20, 10]], [at, [12, 58, 0]], [thru, [8, 62, 0]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [top, 40], [at, 14], [1, 30]]);
  r.open[0] = t > top && t < 0.86;
  stance(r, t, [[0, 2, 4, 0, P], [top, 40, 84, 10, P], [at, 46, 96, 12, P], [thru, 44, 92, 12, P], [1, 4, 4, 2, P]], 14);
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [-18, 0, -8]], [at, [-24, 0, 8]], [thru, [-22, 0, 12]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [-6, 4, -40]], [at, [-10, -4, 22]], [thru, [-8, -6, 38]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [top, [-4, 0, 30]], [at, [6, 0, -16]], [thru, [6, 0, -30]], [1, [0, 0, 0]]]);
};

/** Vital Thrust: settled and still, the left hand pointing the line and the fist held back at the hip, a long aim; then a short, very fast drive and a snap back. */
const VITAL_T = { secs: 1.2, release: 0.64 };
const vitalPose: CastPose = (r, t) => {
  const set = 0.2, top = 0.56, at = VITAL_T.release, thru = 0.74;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [set, [-14, 16, 6]], [top, [-22, 18, 8]], [at, [90, 2, 2]], [thru, [88, 2, 2]], [0.86, [34, 10, 0]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [set, 94], [top, 100], [at, 0], [thru, 2], [0.86, 40], [1, 40]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [set, [84, 4, -6]], [top, [86, 4, -6]], [at, [42, -10, 30]], [thru, [40, -10, 30]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [set, 6], [top, 4], [at, 110], [thru, 108], [1, 30]]);
  r.open[0] = t > 0.08 && t < at;
  stance(r, t, [[0, 2, 4, 0, P], [set, 22, 40, 12, P], [top, 22, 44, 14, P], [at, 32, 52, 22, P], [thru, 32, 50, 22, P], [1, 4, 4, 2, P]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [set, [-6, 0, -4]], [top, [-6, 0, -5]], [at, [-16, 0, 4]], [thru, [-15, 0, 4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [set, [0, 0, -24]], [top, [0, 0, -28]], [at, [-6, 0, 14]], [thru, [-6, 0, 12]], [1, [0, 0, 0]]]);
  // Sighting down the left arm: the head turned on to the line while the chest is turned off it, and low.
  r.head = euler(t, [[0, [0, 0, 0]], [set, [-8, 0, 22]], [top, [-10, 0, 26]], [at, [-4, 0, -10]], [thru, [-4, 0, -8]], [1, [0, 0, 0]]]);
};

/** Hook: a thrust out, a beat while the barb takes, then a haul back to the hips leaning back on the rear leg. */
const HOOK_T = { secs: 1.4, release: 0.28 };
/** When the haul starts and ends, as shares of the cast. */
const HAUL = [0.46, 0.6] as const;
/** Seconds from the catch to a little after the haul: how long the hook's impact plays. */
const HOOK_AFTER = (0.82 - HOOK_T.release) * HOOK_T.secs + 0.5;
const hookPose: CastPose = (r, t) => {
  const top = 0.22, at = HOOK_T.release, [h0, h1] = HAUL;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [top, [-16, 14, 6]], [at, [86, 4, 4]], [h0, [84, 4, 4]], [h1, [-12, 18, 8]], [0.76, [-10, 18, 8]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [top, 96], [at, 4], [h0, 8], [h1, 104], [0.76, 100], [1, 40]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [top, [40, 8, 20]], [at, [80, 2, 14]], [h0, [80, 2, 14]], [h1, [18, 4, 24]], [0.76, [16, 4, 24]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [top, 70], [at, 18], [h0, 20], [h1, 104], [0.76, 100], [1, 30]]);
  stance(r, t, [[0, 2, 4, 0, P], [top, -2, 12, 4, P], [at, 28, 34, 16, P], [h0, 28, 36, 16, P], [h1, 40, 4, 20, P], [0.76, 40, 6, 20, P], [1, 4, 4, 2, P]]);
  // The haul is the back: leaning out over the rear leg, turned as the hands come in.
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [4, 0, -4]], [at, [-12, 0, 4]], [h0, [-10, 0, 4]], [h1, [18, 0, -6]], [0.76, [16, 0, -6]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [2, 0, -20]], [at, [-4, 0, 10]], [h0, [-4, 0, 10]], [h1, [6, 0, -22]], [0.76, [6, 0, -20]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [top, [0, 0, 14]], [at, [-6, 0, -6]], [h1, [-10, 0, 18]], [0.76, [-10, 0, 16]], [1, [0, 0, 0]]]);
};

/** Rally the Line: the spear lifted high overhead as a standard and the left fist pumped, the head back in a shout; then the butt brought down hard and the left arm swept out to call them in. */
const RALLY_T = { secs: 1.5, release: 0.52 };
const rallyPose: CastPose = (r, t) => {
  const up = 0.3, top = 0.44, at = RALLY_T.release, thru = 0.7;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [up, [148, 16, -6]], [top, [168, 12, -6]], [at, [14, 22, 0]], [thru, [14, 22, 0]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [up, 14], [top, 8], [at, 30], [1, 40]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [up, [70, 24, 10]], [top, [104, 22, 10]], [at, [72, 70, 0]], [thru, [70, 72, 0]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [up, 110], [top, 104], [at, 10], [thru, 12], [1, 30]]);
  r.open[0] = t > at - 0.02 && t < 0.9;
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.18, [8, 6, 0]], [top, [4, 6, 0]], [at, [10, 10, 0]], [thru, [10, 10, 0]], [1, [2, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.18, [6, 6, 0]], [top, [0, 6, 0]], [at, [-6, 10, 0]], [thru, [-6, 10, 0]], [1, [0, 2, 0]]]);
  const kn = one(t, [[0, 4], [0.18, 26], [top, 2], [at, 20], [thru, 14], [1, 4]]);
  r.knee = [kn, kn];
  r.spine = euler(t, [[0, [0, 0, 0]], [0.18, [-6, 0, 0]], [top, [8, 0, 0]], [at, [-6, 0, 0]], [thru, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [10, -6, 8]], [at, [-4, 0, -6]], [thru, [0, 0, -4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.18, [-8, 0, 0]], [top, [22, 0, 0]], [at, [4, 0, 0]], [thru, [6, 0, 0]], [1, [0, 0, 0]]]);
};

/** Twin Thrust: drawn back once, then two quick jabs -- the first high, a half recoil, the second low with a deeper step. */
const TWIN_T = { secs: 1.15, release: 0.3 };
/** When each jab lands, as shares of the cast. */
const JABS = [TWIN_T.release, 0.56] as const;
const twinPose: CastPose = (r, t) => {
  const top = 0.22, [j1, j2] = JABS;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [top, [-18, 14, 4]], [j1, [94, 2, 2]], [j1 + 0.06, [92, 2, 2]], [0.44, [22, 10, 4]], [j2, [70, 0, -4]], [j2 + 0.1, [68, 0, -4]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [top, 96], [j1, 2], [j1 + 0.06, 4], [0.44, 84], [j2, 0], [j2 + 0.1, 4], [1, 40]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [top, [52, 6, 18]], [j1, [74, 2, 14]], [0.44, [62, 4, 16]], [j2, [66, 2, 12]], [j2 + 0.1, [64, 2, 12]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [top, 60], [j1, 28], [0.44, 46], [j2, 30], [1, 30]]);
  stance(r, t, [[0, 2, 4, 0, P], [top, 4, 16, 6, P], [j1, 22, 26, 12, P], [0.44, 22, 24, 12, P], [j2, 36, 46, 20, P], [j2 + 0.1, 34, 44, 20, P], [1, 4, 4, 2, P]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [4, 0, -4]], [j1, [-10, 0, 4]], [0.44, [-6, 0, -2]], [j2, [-20, 0, 4]], [j2 + 0.1, [-18, 0, 4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [2, 0, -20]], [j1, [-4, 0, 10]], [0.44, [0, 0, -12]], [j2, [-6, 0, 14]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [top, [0, 0, 12]], [j1, [-2, 0, -6]], [0.44, [-4, 0, 8]], [j2, [-12, 0, -8]], [1, [0, 0, 0]]]);
};

/** Reach Advantage: the long guard -- the weight kept back on a bent rear leg, the front leg straight and light, and both arms run out to their full length while the body stays away. */
const REACH_T = { secs: 1.05, release: 0.5 };
const reachPose: CastPose = (r, t) => {
  const set = 0.22, top = 0.42, at = REACH_T.release, thru = 0.7;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [set, [34, 12, 4]], [top, [30, 12, 4]], [at, [92, 2, 2]], [thru, [90, 2, 2]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [set, 72], [top, 80], [at, 0], [thru, 0], [1, 40]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [set, [66, 4, 14]], [top, [64, 4, 14]], [at, [90, 0, 8]], [thru, [88, 0, 8]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [set, 34], [top, 38], [at, 4], [thru, 6], [1, 30]]);
  stance(r, t, [[0, 2, 4, 0, P], [set, 40, 2, 14, P], [top, 40, 2, 14, P], [at, 42, 4, 14, P], [thru, 42, 4, 14, P], [1, 4, 4, 2, P]]);
  // Upright, even leaning off it: the reach is the arms', not the body's.
  r.spine = euler(t, [[0, [0, 0, 0]], [set, [8, 0, -4]], [top, [9, 0, -4]], [at, [5, 0, 2]], [thru, [5, 0, 2]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [set, [0, 0, -12]], [top, [0, 0, -14]], [at, [-2, 0, 6]], [thru, [-2, 0, 6]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [set, [-4, 0, 10]], [top, [-4, 0, 12]], [at, [-6, 0, -4]], [1, [0, 0, 0]]]);
};

/** Skewer: both hands by the right hip and the knees down, then a drive with a step right through, both hands together and the body behind them, held long. */
const SKEWER_T = { secs: 1.25, release: 0.44 };
const skewerPose: CastPose = (r, t) => {
  const top = 0.36, at = SKEWER_T.release, thru = 0.58, hold = 0.74;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [top, [-26, 18, 6]], [at, [78, 0, 8]], [thru, [84, 0, 8]], [hold, [82, 0, 8]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [top, 102], [at, 8], [thru, 4], [hold, 6], [1, 40]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [top, [26, -6, 34]], [at, [80, -4, 16]], [thru, [84, -4, 16]], [hold, [82, -4, 16]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [top, 104], [at, 16], [thru, 10], [hold, 12], [1, 30]]);
  stance(r, t, [[0, 2, 4, 0, P], [top, 6, 32, 10, P], [at, 46, 54, 30, P], [thru, 50, 58, 32, P], [hold, 48, 56, 32, P], [1, 4, 4, 2, P]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [-6, 0, -6]], [at, [-24, 0, 4]], [thru, [-30, 0, 4]], [hold, [-28, 0, 4]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [-2, 0, -28]], [at, [-6, 0, 6]], [thru, [-6, 0, 8]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [top, [-6, 0, 20]], [at, [12, 0, -4]], [thru, [16, 0, -6]], [hold, [14, 0, -6]], [1, [0, 0, 0]]]);
};

/** Keep Away: a wide flat sweep of the spear arm from the right across to the left at the chest, the left hand thrust out open the other way. */
const KEEP_T = { secs: 1.0, release: 0.48 };
const keepPose: CastPose = (r, t) => {
  const top = 0.34, at = KEEP_T.release, thru = 0.64;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [top, [58, 62, -12]], [at, [84, -18, 28]], [thru, [72, -26, 32]], [1, [20, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [top, 24], [at, 8], [thru, 20], [1, 40]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [top, [40, 0, 26]], [at, [64, 62, -6]], [thru, [62, 64, -6]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [top, 90], [at, 6], [thru, 8], [1, 30]]);
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [top, [0, 0, 0]], [at, [-70, 0, 0]], [thru, [-68, 0, 0]], [1, [0, 0, 0]]]);
  r.open[0] = t > top && t < 0.88;
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [top, [10, 12, 0]], [at, [14, 14, 0]], [1, [2, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [top, [-8, 12, 0]], [at, [-10, 14, 0]], [1, [0, 2, 0]]]);
  const kn = one(t, [[0, 4], [top, 18], [at, 24], [thru, 22], [1, 4]]);
  r.knee = [kn, kn];
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [2, 0, -10]], [at, [-4, 0, 10]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [0, 4, -32]], [at, [-2, -4, 30]], [thru, [-2, -4, 34]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [top, [0, 0, 22]], [at, [0, 0, -20]], [thru, [0, 0, -24]], [1, [0, 0, 0]]]);
};

/** Fend Off: the spear whirled before the body, the fist going round twice, then set wide on bent knees with the left palm thrust out. */
const FEND_T = { secs: 1.0, release: 0.5 };
/** When the whirl goes round, as shares of the cast. */
const FEND_SPIN = [0.08, 0.44] as const;
const fendPose: CastPose = (r, t) => {
  const [s0, s1] = FEND_SPIN, at = FEND_T.release, thru = 0.68;
  // The fist round a small circle before the chest, twice, quickening, as the pike of light goes round it (`fendWheel`).
  const ph = whirlOf(t);
  const spin = bump(t, s0, s0 + 0.08, at);
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [s0 + 0.06, [64, 18, 0]], [s1, [64, 18, 0]], [at, [52, 14, 0]], [thru, [52, 14, 0]], [1, [20, 12, 0]]]);
  r.arm[1][0] += 12 * Math.sin(ph) * spin;
  r.arm[1][1] += 14 * Math.cos(ph) * spin;
  r.elbow[1] = one(t, [[0, 40], [s0 + 0.06, 50], [s1, 50], [at, 40], [1, 40]]) + 10 * Math.sin(ph + 1) * spin;
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [s1, [36, 8, 22]], [at, [84, 6, -4]], [thru, [82, 6, -4]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [s1, 90], [at, 6], [thru, 8], [1, 30]]);
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [s1, [0, 0, 0]], [at, [-74, 0, 0]], [thru, [-72, 0, 0]], [1, [0, 0, 0]]]);
  r.open[0] = t > s1 - 0.04 && t < 0.88;
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [s1, [6, 8, 0]], [at, [14, 16, 0]], [thru, [14, 16, 0]], [1, [2, 2, 0]]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [s1, [-4, 8, 0]], [at, [-10, 16, 0]], [thru, [-10, 16, 0]], [1, [0, 2, 0]]]);
  const kn = one(t, [[0, 4], [s1, 12], [at, 34], [thru, 30], [1, 4]]);
  r.knee = [kn, kn];
  r.spine = euler(t, [[0, [0, 0, 0]], [s1, [2, 0, 0]], [at, [-6, 0, 0]], [thru, [-5, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [s1, [0, 0, -8]], [at, [-2, 0, 10]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [at, [-4, 0, 0]], [1, [0, 0, 0]]]);
};

/** Brace for the Charge: down into a deep brace, the rear leg run out behind, the fist lowered beside the foot to plant the butt, the left hand out along the line; stamped and held. */
const BRACE_T = { secs: 1.3, release: 0.54, blendOut: 0.2 };
const bracePose: CastPose = (r, t) => {
  const top = 0.42, at = BRACE_T.release, thru = 0.8;
  r.arm[1] = euler(t, [[0, [20, 12, 0]], [top, [-4, 24, 0]], [at, [-8, 26, 0]], [thru, [-8, 26, 0]], [1, [16, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [top, 10], [at, 8], [thru, 8], [1, 36]]);
  r.arm[0] = euler(t, [[0, [20, 10, 0]], [top, [60, 4, 12]], [at, [70, 4, 10]], [thru, [70, 4, 10]], [1, [20, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 30], [top, 40], [at, 28], [thru, 28], [1, 30]]);
  stance(r, t, [[0, 2, 4, 0, P], [top, 50, 100, 44, P], [at, 56, 112, 50, P], [thru, 56, 112, 50, P], [1, 6, 6, 4, P]], 6);
  r.spine = euler(t, [[0, [0, 0, 0]], [top, [-20, 0, 0]], [at, [-26, 0, 4]], [thru, [-26, 0, 4]], [1, [-2, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [top, [-2, 0, -8]], [at, [-2, 0, 4]], [thru, [-2, 0, 4]], [1, [0, 0, 0]]]);
  // Looking out over the guard, not down at it.
  r.head = euler(t, [[0, [0, 0, 0]], [top, [20, 0, 0]], [at, [26, 0, -4]], [thru, [26, 0, -4]], [1, [0, 0, 0]]]);
};

/* ---- shared moments ----------------------------------------------------------------------- */

/** Where a lance leaves from: the right fist, the one that drives. */
const fist = (k: FxScene): P3 => k.hand(1);

/** A lance that has struck held in the target for `stay` of `u`, then drawn back to the fist and gone. */
function heldLance(k: FxScene, u: number, stay: number, to: P3, o: LanceLook = {}): void {
  const back = smooth(seg(u, stay, 1));
  const from = fist(k);
  lance(k, from, along(from, to, 1 - back * 0.85), { ...o, alpha: (o.alpha ?? 1) * (1 - back) });
}

/** A glint and a light at the moment a blow lands. */
function landGlint(k: FxScene, at: P3, u: number, size: number): void {
  const f = flashOf(u, 0.08);
  k.flare(at, size * (1 - 0.5 * u), f, k.pal.core, 0.4);
  k.light(at, 1.6, 0.5 * (1 - u));
}

/* ---- the spells ------------------------------------------------------------------------- */

export const PIKEMAN: Record<string, SpellVisual> = {
  /*
   * Warning Thrust: the jab stops short of the creature, a point of light
   * checked in the air a pace off it with a clang, and a line is scored across
   * the ground between them; over the creature, for its seconds, a spear's
   * point turned down over a bar -- warned off.
   */
  pikeman_warning_thrust: {
    palette: PALETTE,
    cast: { timing: WARN_T, pose: warnPose },
    fx: {
      charge: (k, t) => k.glow(fist(k), 5, 0.6 * bump(t, 0.2, WARN_T.release, WARN_T.release + 0.05)),
      travel: {
        secs: (tiles) => 0.06 + tiles * 0.03,
        draw: (k, u) => {
          const from = fist(k), stop = warnStop(k);
          lance(k, from, along(from, stop, easeOut(u)), { width: 2 });
        },
      },
      hit: (k) => {
        const stop = warnStop(k);
        // Thrown back off nothing: the clang of a blow stopped.
        const back = k.toward(k.target, k.caster);
        k.burst(stop, 14, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 1.8, life: [0.15, 0.35], speed: [0.8, 2], up: [-6, 14], heading: back, cone: 2.2, gravity: 50, drag: 0.08 });
        // The stamp of the leading foot.
        k.burst(k.joint(k.caster, 'ankle0', [0, 0, 0], 0.02), 8, { kind: 'dust', colour: '#8f7f62', size: 3, life: [0.35, 0.6], speed: [0.2, 0.5], up: [2, 6], gravity: 4, drag: 0.1, jitter: 0.06 });
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const stop = warnStop(k);
          heldLance(k, u, 0.35, stop, { width: 2 });
          k.flare(stop, 9 * (1 - u), flashOf(u, 0.06), k.pal.core, 0.8);
          k.light(stop, 1.4, 0.45 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const d = lineOf(k);
          // The line in the sand: scored across the way from the middle out, then left to fade.
          const scored = smooth(seg(age, 0, 0.22));
          const lineA = (1 - smooth(seg(age, 1.6, 3))) * smooth(left / 0.6);
          if (lineA > 0.01) {
            const st = warnLine(k, d);
            groundShapes(k, st, 1, [barAcross(st, d, 0.24, 0.032, scored), barAcross({ x: st.x - d.x * 0.07, y: st.y - d.y * 0.07 }, d, 0.13, 0.018, scored)],
              { fill: k.pal.main, lit: k.pal.core, alpha: 0.95 * lineA });
            // Lying on the ground it is under the night; a little light along it keeps it there in the dark.
            k.glow(k.on(st.x, st.y, 0.5), 12, 0.3 * lineA * scored);
          }
          const a = smooth(age / 0.35) * smooth(left / 1);
          const strong = 1 - 0.45 * smooth(seg(age, 2.5, 4));
          warnSign(k, k.at(k.target, 1.12 + 0.02 * Math.sin(age * 2.2)), a * strong, age);
          if (!k.fast && age < 3) k.emit(k.at(k.target, 1.1), 3, { kind: 'mote', colour: k.pal.accent, size: 1.4, life: [0.5, 0.9], speed: [0.02, 0.06], up: [2, 6], gravity: 0, jitter: 0.08 });
        },
      },
    },
  },

  /*
   * Overreach: the lunge throws a lance far past where the spear stops -- a
   * sky-blue mark on the ground at the end of the caster's reach, and the
   * light run on beyond it to the enemy -- and it is slow coming back: the
   * lance draws back to the fist over the second the next swing is put back.
   */
  pikeman_overreach: {
    palette: PALETTE,
    cast: { timing: OVER_T, pose: overPose },
    fx: {
      charge: (k, t) => {
        k.glow(fist(k), 5, 0.6 * bump(t, 0.12, OVER_T.release, OVER_T.release + 0.04));
        overReachMark(k, smooth(seg(t, 0.12, OVER_T.release)));
      },
      travel: {
        secs: (tiles) => 0.06 + tiles * 0.045,
        draw: (k, u) => {
          const from = fist(k), to = k.heart(k.target);
          // Telescoped out in three steps rather than slid: each joint of it shoots on from the last.
          const step = Math.min(2.999, u * 3);
          const reach = (Math.floor(step) + easeOut(step - Math.floor(step))) / 3;
          lance(k, from, along(from, to, reach), { width: 1.8, head: 10 });
          overReachMark(k, 1);
          if (!k.fast) k.emit(along(from, to, reach), 50, { kind: 'mote', colour: k.pal.accent, size: 1.4, life: [0.15, 0.3], speed: [0.02, 0.1], up: [-2, 2], gravity: 0 });
        },
      },
      hit: (k) => {
        pierce(k, k.heart(k.target), lineOf(k), 1.1);
      },
      impact: {
        // The lance comes back over the second the next swing is put back by.
        secs: 0.2 + (FX_OF('pikeman_overreach').wind ?? 1),
        draw: (k, u) => {
          const wind = k.fx.wind ?? 1;
          const total = 0.2 + wind;
          const age = u * total;
          const to = k.heart(k.target);
          const back = smooth(seg(age, 0.2, total));
          const from = fist(k);
          lance(k, from, along(from, to, 1 - back * 0.92), { width: 1.8, head: 10, alpha: 1 - 0.75 * back });
          landGlint(k, to, clamp(age / 0.45), 11);
          overReachMark(k, 1 - smooth(seg(age, 0.3, total)));
        },
      },
    },
  },

  /*
   * Sweep the Legs: a low flat arc of bronze across the creature's shins,
   * dust kicked out of its feet; then for its seconds a hobble of two rings
   * round its feet, turning at the pace it is cut to, and the dust of
   * dragged feet.
   */
  pikeman_sweep_the_legs: {
    palette: PALETTE,
    cast: { timing: SWEEP_T, pose: sweepPose },
    fx: {
      charge: (k, t) => {
        const u = seg(t, 0.36, SWEEP_T.release + 0.06);
        if (u > 0 && u < 1) sweepArc(k, u, 1);
        else if (t >= SWEEP_T.release + 0.06) sweepArc(k, 1, 1 - seg(t, SWEEP_T.release + 0.06, SWEEP_T.release + 0.14));
      },
      hit: (k) => {
        const d = lineOf(k);
        const across = rightOf(d);
        const feet = k.at(k.target, 0.12);
        // Thrown the way the sweep goes, right to left.
        k.burst(feet, 22, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 1.8, life: [0.15, 0.35], speed: [1.2, 2.6], up: [0, 10], heading: { x: -across.x, y: -across.y }, cone: 1.1, gravity: 60, drag: 0.08 });
        k.burst(k.at(k.target, 0.02), 14, { kind: 'dust', colour: ['#8f7f62', '#a8957a'], size: 3.4, life: [0.45, 0.8], speed: [0.3, 0.8], up: [2, 8], heading: { x: -across.x, y: -across.y }, cone: 2.4, gravity: 4, drag: 0.12 });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          landGlint(k, k.at(k.target, 0.15), u, 9);
          // The hobble snapped shut round the feet.
          const R = footRing(k.target);
          k.ring(k.target, R * (1.8 - 0.8 * easeBack(u * 1.6)), { band: 0.07, alpha: 0.9 * (1 - 0.3 * u), main: k.pal.accent, glow: 0.6 });
        },
      },
      linger: {
        draw: (k, age, left) => {
          const a = smooth(age / 0.3) * smooth(left / 0.8);
          const R = footRing(k.target);
          // Turning at the pace it is cut to.
          const pace = k.fx.pace ?? 0.5;
          // A chain round the feet: bronze links and sky-blue links between them, going round at the pace it is cut to.
          const turn = age * pace * 1.2;
          k.ring(k.target, R, { band: 0.045, alpha: 0.85 * a, main: k.pal.main, deep: k.pal.deep, dash: 2, n: 16, turn, glow: 0 });
          k.glow(k.at(k.target, 0.04), 9 + R * 30, 0.3 * a);
          k.ring(k.target, R - 0.008, { band: 0.028, alpha: 0.85 * a, main: k.pal.accent, deep: k.pal.accent, dash: 2, n: 16, turn: turn + TAU / 16, glow: 0 });
          if (!k.fast) k.emit(k.at(k.target, 0.02), 2.5 * a, { kind: 'dust', colour: '#8f7f62', size: 2.4, life: [0.5, 0.9], speed: [0.05, 0.15], up: [1, 3], gravity: 2, jitter: R * 0.6 });
        },
      },
    },
  },

  /*
   * Vital Thrust: a long aim -- a fine sky-blue sight line from the leading
   * hand and four points closing on the creature's heart -- then the lance
   * there in an instant and a hard eight-pointed glint where it went in, the
   * four points thrown off it: a blow found the soft place.
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
          reticle(k, heart, lerp(11, 3.4, aim), aim * (1 - gone), t * 3, 0);
        }
      },
      travel: {
        secs: (tiles) => 0.02 + tiles * 0.02,
        draw: (k, u) => {
          const from = fist(k), to = k.heart(k.target);
          lance(k, from, along(from, to, u), { width: 1.8, head: 11 });
        },
      },
      hit: (k) => {
        const at = k.heart(k.target), d = lineOf(k);
        pierce(k, at, d, 1.2);
        k.burst(at, 10, { kind: 'shard', colour: [k.pal.accent, k.pal.core], size: 2, life: [0.35, 0.6], speed: [0.6, 1.4], up: [4, 16], heading: d, cone: 2.6, gravity: 40, drag: 0.2 });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          const at = k.heart(k.target);
          heldLance(k, u, 0.2, at, { width: 1.8, head: 11 });
          const f = flashOf(u, 0.05);
          k.flare(at, 12 * (1 - 0.4 * u), f, k.pal.core, 0);
          k.flare(at, 8 * (1 - 0.4 * u), f, k.pal.accent, Math.PI / 4);
          // The four points thrown off the heart.
          reticle(k, at, 3.4 + 16 * easeOut(u), 1 - u, 0, u * 2);
          k.light(at, 1.6, 0.55 * (1 - u));
        },
      },
    },
  },

  /*
   * Hook: a lance with a billhook's barb shot out to the enemy and caught in
   * it; on the haul a furrow is ploughed over the ground from where it stood
   * toward the caster, the length it is dragged and stopping where it must,
   * dust thrown up along it; the barb lets go with a snap.
   */
  pikeman_hook: {
    palette: PALETTE,
    cast: { timing: HOOK_T, pose: hookPose },
    fx: {
      charge: (k, t) => k.glow(fist(k), 5, 0.6 * bump(t, 0.12, HOOK_T.release, HOOK_T.release + 0.04)),
      travel: {
        secs: (tiles) => 0.05 + tiles * 0.035,
        draw: (k, u) => {
          const from = fist(k), to = k.heart(k.target);
          lance(k, from, along(from, to, easeOut(u)), { width: 1.8, head: 12, hook: true });
        },
      },
      hit: (k) => {
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
          const secs = HOOK_AFTER;
          const age = u * secs;
          const h0 = (HAUL[0] - HOOK_T.release) * HOOK_T.secs, h1 = (HAUL[1] - HOOK_T.release) * HOOK_T.secs;
          const haul = smooth(seg(age, h0, h1));
          const free = seg(age, h1 + 0.12, h1 + 0.42);
          const to = k.heart(k.target), from = fist(k);
          // Taut before the haul, a tremble in it; let go after.
          if (free < 1) {
            const shake = age < h1 ? 0.4 * Math.sin(k.now * 60) * (1 - haul) : 0;
            lance(k, from, { x: to.x, y: to.y, z: to.z + shake }, { width: 1.8, head: 12, hook: true, alpha: 1 - free });
          }
          if (age < 0.3) landGlint(k, to, age / 0.3, 8);
          hookFurrow(k, haul, 1 - smooth(seg(age, h1 + 0.2, secs)));
          if (haul > 0 && haul < 1) k.emit(k.at(k.target, 0.04), 60, { kind: 'dust', colour: ['#8f7f62', '#a8957a'], size: 3, life: [0.35, 0.7], speed: [0.1, 0.4], up: [2, 6], gravity: 4, drag: 0.1, jitter: 0.12 });
          if (age >= h1 + 0.12 && !k.state.snap) {
            k.state.snap = 1;
            k.burst(to, 10, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 1.6, life: [0.12, 0.3], speed: [0.6, 1.4], up: [0, 10], gravity: 50 });
          }
        },
      },
    },
  },

  /*
   * Rally the Line: a pennon unfurls on the spear as it is lifted high, and
   * when the butt comes down a wave runs out over the ground to the five
   * tiles it reaches, upturned chevrons of breath rising off the ground
   * behind it as it passes: stamina, given back.
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
        k.burst(feet, 16, { kind: 'dust', colour: ['#8f7f62', '#a8957a'], size: 3.6, life: [0.45, 0.8], speed: [0.5, 1.1], up: [1, 5], gravity: 3, drag: 0.1 });
        k.burst(k.at(k.caster, 0.1), 24, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 2, life: [0.25, 0.5], speed: [1.2, 2.6], up: [2, 14], gravity: 40, drag: 0.06 });
        k.flash(0.04);
      },
      impact: {
        secs: 1.4,
        draw: (k, u) => {
          const R = spellInfo('pikeman_rally_the_line')?.radius || (k.fx.reach ?? 5);
          const out = easeOut(seg(u, 0, 0.55));
          const fade = 1 - smooth(seg(u, 0.45, 1));
          // The wave: a broad band running out to the edge and holding there as it thins.
          const r = 0.3 + (R - 0.3) * out;
          k.ring(k.caster, r, { band: Math.min(r * 0.3, 0.1 + 0.22 * (1 - out)), alpha: 0.95 * fade, turn: u * 0.4, glow: 0.35 });
          if (u > 0.08) k.ring(k.caster, Math.max(0.2, r - 0.6 * out), { band: 0.05, alpha: 0.5 * fade, main: k.pal.accent, glow: 0, turn: -u * 0.4 });
          // The edge marked as it is reached: the five tiles it gives breath to.
          if (out > 0.92) k.ring(k.caster, R, { band: 0.06, alpha: 0.7 * fade, dash: 4, main: k.pal.accent, glow: 0.4 });
          rallyChevrons(k, R, r, u, fade);
          k.light(k.caster, r + 1, 0.6 * fade);
          if (u < 0.08) k.flare(k.at(k.caster, 0.08), 12, flashOf(u / 0.08), k.pal.core, 0.3);
        },
      },
    },
  },

  /*
   * Twin Thrust: two lances, one after the other -- the first high into the
   * chest, the second low into the belly a beat later -- each with its own
   * smaller glint and spray: two lighter blows, not one heavy one.
   */
  pikeman_twin_thrust: {
    palette: PALETTE,
    cast: { timing: TWIN_T, pose: twinPose },
    fx: {
      charge: (k, t) => {
        const [j1, j2] = JABS;
        k.glow(fist(k), 4, 0.5 * bump(t, 0.1, j1, j1 + 0.04));
        // Each jab: out in a few hundredths, held a moment, drawn back.
        jab(k, t, j1, twinAim(k, 0));
        jab(k, t, j2, twinAim(k, 1));
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
   * a dark dashed ring while the guard is set; struck from outside it, the
   * ring breaks and the blow lands with the large glint of the larger blow,
   * struck from within it, the ring stays dull and the glint is a plain one.
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
          const from = fist(k), to = k.heart(k.target);
          lance(k, from, along(from, to, easeOut(u)), { width: 2.2, head: 10 });
          theirReach(k, 1, 0);
        },
      },
      hit: (k) => pierce(k, k.heart(k.target), lineOf(k), outReach(k) ? 1.5 : 0.9),
      impact: {
        secs: 0.75,
        draw: (k, u) => {
          const at = k.heart(k.target);
          const big = outReach(k);
          const m = big ? (k.fx.more ?? 1.5) : (k.fx.whole ?? 1);
          heldLance(k, u, 0.3, at, { width: 2.2, head: 10 });
          landGlint(k, at, u, 8 * m);
          if (big) k.flare(at, 7 * m * (1 - u), flashOf(u, 0.06), k.pal.accent, Math.PI / 4);
          theirReach(k, 1 - smooth(seg(u, 0.3, 1)), u);
        },
      },
    },
  },

  /*
   * Skewer: the lance driven in and on out of the far side, two tiles past
   * it; laid on the ground behind the creature, the corridor the thrust goes
   * down -- as long and as wide as the rule has it -- lit for a moment, where
   * anything else standing takes the lesser blow.
   */
  pikeman_skewer: {
    palette: PALETTE,
    cast: { timing: SKEWER_T, pose: skewerPose },
    fx: {
      charge: (k, t) => k.glow(fist(k), 5, 0.6 * bump(t, 0.12, SKEWER_T.release, SKEWER_T.release + 0.04)),
      travel: {
        secs: (tiles) => 0.04 + tiles * 0.04,
        draw: (k, u) => {
          const from = fist(k), to = k.heart(k.target);
          lance(k, from, along(from, to, u), { width: 2.4, head: 11 });
        },
      },
      hit: (k) => pierce(k, k.heart(k.target), lineOf(k), 1),
      impact: {
        secs: 1.0,
        draw: (k, u) => {
          const d = lineOf(k);
          const behind = k.fx.behind ?? 2;
          const at = k.heart(k.target);
          const far = off(k, k.target, d, behind, 0, at.z - k.ground(k.target.x, k.target.y) - 2);
          // On through it, out the far side, then drawn back.
          const on = easeOut(seg(u, 0, 0.16));
          const back = smooth(seg(u, 0.5, 0.95));
          const from = fist(k);
          const tip = along(at, far, on);
          lance(k, from, along(from, tip, 1 - back * 0.9), { width: 2.4, head: 11, alpha: 1 - back });
          if (on >= 1 && !k.state.out) {
            k.state.out = 1;
            k.burst(far, 18, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 1.8, life: [0.2, 0.4], speed: [1, 2.2], up: [-2, 12], heading: d, cone: 1, gravity: 50, drag: 0.08 });
          }
          skewerLane(k, d, behind, seg(u, 0.04, 0.2), (1 - smooth(seg(u, 0.35, 1))));
          landGlint(k, at, u, 10);
        },
      },
    },
  },

  /*
   * Keep Away: a flat sweep of light round the front at the chest, and from
   * the feet a ring of arrowheads driven out the one tile a blow will push;
   * for its seconds a sky-blue pennon on the spear and three faint arrowheads
   * round the feet pointing out.
   */
  pikeman_keep_away: {
    palette: PALETTE,
    cast: { timing: KEEP_T, pose: keepPose },
    fx: {
      charge: (k, t) => {
        const u = seg(t, 0.3, KEEP_T.release + 0.08);
        if (u > 0 && u < 1) k.slash(k.caster, { u: smooth(u), from: 1.5, to: -1.5, tilt: Math.PI / 2, reach: 15, up: k.caster.tall * 0.62, width: 5, length: 1.6, alpha: 0.9 });
        else if (u >= 1) k.slash(k.caster, { u: 1, from: 1.5, to: -1.5, tilt: Math.PI / 2, reach: 15, up: k.caster.tall * 0.62, width: 5 * (1 - seg(t, KEEP_T.release + 0.08, 0.72)), length: 1.6, alpha: 0.9 * (1 - seg(t, KEEP_T.release + 0.08, 0.72)) });
      },
      hit: (k) => {
        k.burst(k.at(k.caster, 0.04), 12, { kind: 'dust', colour: '#8f7f62', size: 3, life: [0.35, 0.6], speed: [0.8, 1.4], up: [1, 4], gravity: 3, drag: 0.1 });
      },
      impact: {
        secs: 0.7,
        draw: (k, u) => {
          // Out by exactly the tile a blow will push.
          const push = k.fx.push ?? 1;
          const r = 0.22 + push * easeOut(u);
          pushRing(k, r, 8, 0.1, 0.95 * (1 - smooth(seg(u, 0.5, 1))), 0);
          k.light(k.caster, 1.8, 0.4 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const a = smooth(age / 0.4) * smooth(left / 0.8);
          const tip = spearTip(k);
          pennon(k, tip, k.caster, { size: 9, alpha: 0.9 * a, phase: k.now * 7, main: k.pal.accent, stripe: k.pal.core });
          k.glow(tip, 4, 0.35 * a, k.pal.accent);
          pushRing(k, 0.26, 3, 0.07, 0.5 * a * (0.75 + 0.25 * Math.sin(age * 3)), age * 0.6);
        },
      },
    },
  },

  /*
   * Fend Off: the whirl of the spear leaves a wheel of light; when it is set a
   * ring of leaf points springs out flat on the ground at the reach a
   * creature strikes from, points outward, and for its seconds it stays, a
   * thin wave going out from it now and then the two tiles a creature is
   * thrown back.
   */
  pikeman_fend_off: {
    palette: PALETTE,
    cast: { timing: FEND_T, pose: fendPose },
    fx: {
      charge: (k, t) => fendWheel(k, t),
      hit: (k) => {
        k.burst(k.at(k.caster, 0.05), 20, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 1.8, life: [0.2, 0.4], speed: [1.4, 2.6], up: [1, 6], gravity: 30, drag: 0.08 });
      },
      impact: {
        secs: 0.55,
        draw: (k, u) => {
          fendRing(k, HUNT_REACH * (0.3 + 0.7 * easeBack(u)), 1, u);
          k.light(k.caster, HUNT_REACH + 1, 0.45 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const a = smooth(age / 0.3) * smooth(left / 0.8);
          if (age > 0.55) fendRing(k, HUNT_REACH, 0.55 * a, 1);
          // Every so often a thin wave out the push's length, the way a creature is thrown.
          const push = k.fx.push ?? 2;
          const w = ((age + 0.4) % 1.6) / 1.6;
          k.ring(k.caster, HUNT_REACH + push * easeOut(w), { band: 0.04, alpha: 0.35 * a * (1 - w), main: k.pal.accent, glow: 0, n: 24 });
        },
      },
    },
  },

  /*
   * Brace for the Charge: the butt planted with a spurt of dust, and a hedge
   * of pikes of light rising round the caster at the edge of their reach,
   * leant outward over a ring scored on the ground -- where a charge is
   * stopped -- standing for its seconds and sinking back at the end.
   */
  pikeman_brace_for_the_charge: {
    palette: PALETTE,
    cast: { timing: BRACE_T, pose: bracePose },
    fx: {
      charge: (k, t) => k.glow(k.at(k.caster, 0.05), 6, 0.5 * bump(t, 0.3, BRACE_T.release, BRACE_T.release + 0.1)),
      hit: (k) => {
        const butt = k.hand(1);
        const foot = k.on(butt.x, butt.y, 0.5);
        k.burst(foot, 12, { kind: 'dust', colour: ['#8f7f62', '#a8957a'], size: 3, life: [0.35, 0.6], speed: [0.3, 0.7], up: [2, 6], gravity: 4, drag: 0.12 });
        k.burst(foot, 10, { kind: 'spark', colour: [k.pal.core, k.pal.light], size: 1.6, life: [0.15, 0.3], speed: [0.6, 1.2], up: [4, 12], gravity: 50 });
      },
      impact: {
        secs: 0.6,
        draw: (k, u) => {
          k.light(k.caster, reachHeld(k) + 1, 0.45 * (1 - u));
        },
      },
      linger: {
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

/** Where a warning jab is stopped: a pace short of the creature, never behind the fist. */
function warnStop(k: FxScene): P3 {
  const from = fist(k), to = k.heart(k.target);
  const d = Math.max(0.01, k.dist);
  return along(from, to, clamp((d - 0.42) / d, 0.25, 0.9));
}
/** Where the line in the sand is scored: under the stopped point, across the way. */
function warnLine(k: FxScene, d: V2): V2 {
  const at = Math.max(0.3, k.dist - 0.5);
  return { x: k.caster.x + d.x * at, y: k.caster.y + d.y * at };
}

/** A spear's point turned down over a bar, in sky-blue: warned off. `p` where it hangs. */
function warnSign(k: FxScene, p: P3, a: number, age: number): void {
  if (a <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), z = k.zoom;
  const L = 7 * z, W = 2.4 * z;
  const pal = k.pal;
  // Turning a little about its upright, so it reads as a thing in the air.
  const sq = 0.7 + 0.3 * Math.cos(age * 1.4);
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
    g.lineWidth = Math.max(0.8, 0.7 * z);
    g.strokeStyle = pal.ink;
    g.stroke();
    // The bar it stops on.
    const by = y + L * 0.55;
    g.beginPath();
    g.rect(x - L * 0.55 * sq, by, L * 1.1 * sq, Math.max(1.2, 1.3 * z));
    g.fillStyle = pal.accent;
    g.fill();
    g.stroke();
    g.lineJoin = 'round';
  }, 4);
  k.glow(p, 9, 0.45 * a, pal.accent);
}

/** Overreach's mark of where the caster's own reach ends, on the ground across the way: only when the enemy is past it. */
function overReachMark(k: FxScene, a: number): void {
  const reach = reachHeld(k);
  if (a <= 0.01 || k.dist <= reach + 0.05) return;
  const d = lineOf(k);
  const c = { x: k.caster.x + d.x * reach, y: k.caster.y + d.y * reach };
  // A bar where the spear stops, and an arrowhead past it pointing on: the blow goes further.
  groundShapes(k, c, 0.8, [barAcross(c, d, 0.17, 0.028, a), chevronFlat({ x: c.x + d.x * 0.14, y: c.y + d.y * 0.14 }, d, 0.1 * a)],
    { fill: k.pal.accent, lit: k.pal.core, alpha: 0.9 * a });
  k.glow(k.on(c.x, c.y, 1), 8, 0.4 * a, k.pal.accent);
}

/** Sweep the Legs's arc: a ribbon at the shins swept across the creature from the caster's right to their left, `u` of the way. */
function sweepArc(k: FxScene, u: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const d = lineOf(k), across = rightOf(d);
  const dist = Math.max(0.5, k.dist);
  // Wide enough to go right across a creature, whatever it is: half a tile either side of it.
  const half = Math.min(1.1, 0.55 / dist + 0.25);
  const head = lerp(half, -half, u);
  const tail = Math.min(half, head + 0.75);
  if (tail - head < 0.05) return;
  const pts: P3[] = [];
  const n = k.fast ? 6 : 10;
  for (let i = 0; i <= n; i++) {
    const a = lerp(tail, head, i / n);
    // Positive is to the caster's right of the line, so it comes in from the right and goes out to the left.
    pts.push(off(k, k.caster, { x: d.x * Math.cos(a) + across.x * Math.sin(a), y: d.y * Math.cos(a) + across.y * Math.sin(a) }, dist, 0, 2.6));
  }
  k.ribbon(pts, { width: 5, taper: 'start', alpha });
  if (!k.fast) k.emit(pts[pts.length - 1], 40, { kind: 'dust', colour: '#8f7f62', size: 2.2, life: [0.2, 0.4], speed: [0.05, 0.2], up: [1, 4], gravity: 2 });
}

/** How far out a ring round a creature's feet goes, in tiles. */
const footRing = (b: { wide: number }): number => Math.max(0.16, (b.wide / 40) * 1.9);

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

/** Four small leaf points round `at`, `r` pixels out, pointing in at it: where the vital blow goes. `spin` turns them, `fly` throws them off. */
function reticle(k: FxScene, at: P3, r: number, a: number, spin: number, fly: number): void {
  if (a <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), z = k.zoom, R = r * z;
  const L = 4.2 * z, W = 1.5 * z;
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
      const mx = (tx + ox) / 2, my = (ty + oy) / 2;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(mx + px, my + py);
      g.lineTo(ox, oy);
      g.lineTo(mx - px, my - py);
      g.closePath();
      g.fillStyle = i < 2 ? pal.core : pal.accent;
      g.fill();
      g.lineWidth = Math.max(0.7, 0.6 * z);
      g.strokeStyle = pal.ink;
      g.stroke();
    }
    g.lineJoin = 'round';
  }, 10);
  k.glow(at, r + 4, 0.35 * a, pal.accent);
}

/** Hook's furrow: from where the enemy stood toward the caster, the length it is dragged, `u` of it ploughed. */
function hookFurrow(k: FxScene, u: number, a: number): void {
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
  const w0 = 0.07, w1 = 0.025;
  const pts: V2[] = [
    { x: from.x + r.x * w0, y: from.y + r.y * w0 },
    { x: from.x + d.x * len + r.x * w1, y: from.y + d.y * len + r.y * w1 },
    { x: from.x + d.x * (len + 0.1), y: from.y + d.y * (len + 0.1) },
    { x: from.x + d.x * len - r.x * w1, y: from.y + d.y * len - r.y * w1 },
    { x: from.x - r.x * w0, y: from.y - r.y * w0 },
  ];
  const c = { x: from.x + d.x * len * 0.5, y: from.y + d.y * len * 0.5 };
  groundShapes(k, c, len * 0.5 + 0.4, [pts], { fill: '#6b5236', ink: k.pal.deep, alpha: 0.7 * a });
  // The lip of turned earth either side, lit.
  groundShapes(k, c, len * 0.5 + 0.4, [
    [pts[0], { x: pts[1].x + r.x * 0.02, y: pts[1].y + r.y * 0.02 }, pts[1]],
    [pts[4], { x: pts[3].x - r.x * 0.02, y: pts[3].y - r.y * 0.02 }, pts[3]],
  ], { fill: k.pal.main, alpha: 0.6 * a });
}

/** Rally's breath given back: upturned chevrons rising off the ground the wave has passed over. */
function rallyChevrons(k: FxScene, R: number, reached: number, u: number, fade: number): void {
  if (fade <= 0.01) return;
  const n = k.fast ? 8 : 16;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const an = hashOf(k.seed, i) * TAU;
    const rr = R * Math.sqrt(0.05 + 0.95 * hashOf(k.seed + 1, i));
    if (rr > reached) continue;
    // Each rises from when the wave went over it.
    const born = (rr / R) * 0.55;
    const v = clamp((u - born) / 0.45);
    if (v <= 0 || v >= 1) continue;
    const p = k.on(k.caster.x + Math.cos(an) * rr, k.caster.y + Math.sin(an) * rr, 4 + 18 * v);
    pts.push(k.sx(p), k.sy(p), Math.sin(Math.PI * v));
  }
  if (!pts.length) return;
  const z = k.zoom, core = k.pal.core, accent = k.pal.accent;
  k.glowDraw((g) => {
    g.lineWidth = Math.max(1.2, 1.8 * z);
    g.lineJoin = 'miter';
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], s = 4.6 * z;
      g.globalAlpha = clamp(pts[i + 2] * fade);
      g.strokeStyle = i % 2 ? core : accent;
      g.beginPath();
      g.moveTo(x - s, y + s * 0.6);
      g.lineTo(x, y - s * 0.3);
      g.lineTo(x + s, y + s * 0.6);
      g.stroke();
    }
    g.lineJoin = 'round';
  });
}

/** Twin Thrust's two marks on the creature: the first high in the chest, the second low and a little to one side. */
function twinAim(k: FxScene, which: number): P3 {
  if (!which) return k.at(k.target, 0.62);
  const d = lineOf(k);
  const r = rightOf(d);
  const p = k.at(k.target, 0.34);
  return { x: p.x + r.x * 0.08, y: p.y + r.y * 0.08, z: p.z };
}
/** One jab of Twin Thrust at cast-time `t`, landing at `at` of the cast on `to`: out, held, back. */
function jab(k: FxScene, t: number, at: number, to: P3): void {
  const out = seg(t, at - 0.035, at);
  const back = seg(t, at + 0.06, at + 0.14);
  if (out <= 0 || back >= 1) return;
  const from = fist(k);
  lance(k, from, along(from, to, easeOut(out) * (1 - 0.85 * back)), { width: 1.7, head: 8, alpha: 1 - back });
}

/** Whether a Reach Advantage was struck from outside the creature's own reach. */
const outReach = (k: FxScene): boolean => k.dist > HUNT_REACH;
/** The creature's own reach laid round it: dark and dashed while it is set, broken outward once struck from outside it. */
function theirReach(k: FxScene, a: number, broke: number): void {
  if (a <= 0.01) return;
  const big = outReach(k);
  const R = HUNT_REACH + (big ? 0.5 * easeOut(broke) : 0);
  k.ring(k.target, R, {
    band: 0.07, dash: 3, n: 30, turn: broke * 0.3, alpha: a * (big ? 0.85 : 0.45),
    main: big && broke > 0 ? k.pal.accent : k.pal.deep, deep: k.pal.ink, glow: big ? 0.4 : 0,
  });
  // Where the caster stands against it: a mark under the caster's feet, bright when it is outside.
  k.ring(k.caster, 0.32, { band: 0.05, alpha: a * (big ? 0.8 : 0.35), main: big ? k.pal.accent : k.pal.deep, glow: big ? 0.4 : 0, n: 12 });
}

/** Skewer's lane: the ground behind the creature the thrust goes down, `behind` tiles long and as wide as the rule, `u` of it laid. */
function skewerLane(k: FxScene, d: V2, behind: number, u: number, a: number): void {
  if (u <= 0 || a <= 0.01) return;
  const half = k.fx.width ?? 0.5;
  const r = rightOf(d);
  const t = k.target;
  const len = behind * easeOut(u);
  const quad: V2[] = [
    { x: t.x - r.x * half, y: t.y - r.y * half },
    { x: t.x + r.x * half, y: t.y + r.y * half },
    { x: t.x + d.x * len + r.x * half, y: t.y + d.y * len + r.y * half },
    { x: t.x + d.x * len - r.x * half, y: t.y + d.y * len - r.y * half },
  ];
  const c = { x: t.x + d.x * len * 0.5, y: t.y + d.y * len * 0.5 };
  groundShapes(k, c, behind * 0.5 + half + 0.3, [quad], { fill: k.pal.main, ink: k.pal.deep, alpha: 0.13 * a });
  // Its two edges and a run of arrowheads down the middle, the way the thrust goes.
  groundShapes(k, c, behind * 0.5 + half + 0.3, [
    barAlong(t, d, len, half), barAlong(t, d, len, -half),
    ...[0.3, 0.6, 0.9].filter((f) => f * behind <= len).map((f) => chevronFlat({ x: t.x + d.x * f * behind, y: t.y + d.y * f * behind }, d, 0.1)),
  ], { fill: k.pal.accent, lit: k.pal.core, alpha: 0.9 * a });
}
/** A thin bar along the way `d` from `p`, `len` tiles, `side` tiles to the right of it. */
function barAlong(p: V2, d: V2, len: number, side: number): V2[] {
  const r = rightOf(d);
  const w = 0.014;
  return [
    { x: p.x + r.x * (side + w), y: p.y + r.y * (side + w) },
    { x: p.x + d.x * len + r.x * (side + w), y: p.y + d.y * len + r.y * (side + w) },
    { x: p.x + d.x * len + r.x * (side - w), y: p.y + d.y * len + r.y * (side - w) },
    { x: p.x + r.x * (side - w), y: p.y + r.y * (side - w) },
  ];
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
  groundShapes(k, c, r + len, shapes, { fill: k.pal.accent, lit: k.pal.core, alpha: a });
  k.glow(k.at(c, 0.02), 10 + r * 14, 0.25 * a, k.pal.accent);
}

/** How far round Fend Off's whirl has gone at cast-time `t`, in radians: twice round, quickening, as the fist goes round in the pose. */
const whirlOf = (t: number): number => {
  const w = seg(t, FEND_SPIN[0], FEND_SPIN[1]);
  return TAU * 2 * w * w;
};

/**
 * Fend Off's whirl: a pike of light spun round the fist in the body's own
 * upright plane, a hand's breadth in front of it, its head trailing an arc --
 * the wheel a pike makes whirled before the body to keep everything off it.
 */
function fendWheel(k: FxScene, t: number): void {
  const on = bump(t, FEND_SPIN[0], FEND_SPIN[0] + 0.08, FEND_T.release + 0.04);
  if (on <= 0.01) return;
  const b = k.caster;
  const c = k.hand(1, b);
  const o = k.local(b, 0, 0, 0), side = k.local(b, 1, 0, 0), fore = k.local(b, 0, 1, 0);
  const rx = side.x - o.x, ry = side.y - o.y, fx = fore.x - o.x, fy = fore.y - o.y;
  // Half the pike's length either side of the fist, in height units, and held out in front of the chest.
  const L = 9, F = 4;
  const at = (ph: number, len: number): P3 => ({
    x: c.x + rx * len * Math.cos(ph) + fx * F, y: c.y + ry * len * Math.cos(ph) + fy * F, z: c.z + len * Math.sin(ph),
  });
  const ph = whirlOf(t) + Math.PI / 2;
  const trail: P3[] = [];
  const n = k.fast ? 5 : 8;
  // The arc behind the head grows with the speed of it.
  const lag = 0.25 + 0.9 * seg(t, FEND_SPIN[0], FEND_SPIN[1]);
  for (let i = n; i >= 0; i--) trail.push(at(ph - (i / n) * lag * 2.2, L));
  k.ribbon(trail, { width: 5, taper: 'start', alpha: 0.8 * on, glow: 0.6 });
  lance(k, at(ph + Math.PI, L * 0.75), at(ph, L), { width: 1.8, head: 7, alpha: on, sortAt: at(0, 0) });
}

/** Fend Off's ring at `r`: a band, and leaf points lying flat on it pointing outward. `grow` draws the points out. */
function fendRing(k: FxScene, r: number, a: number, grow: number): void {
  if (a <= 0.01) return;
  const c = k.caster;
  const n = k.fast ? 6 : 8;
  k.ring(c, r, { band: 0.06, alpha: 0.85 * a, main: k.pal.accent, glow: 0.5, n: 32 });
  const shapes: V2[][] = [];
  const len = 0.13 * clamp(grow * 1.6);
  if (len > 0.02) {
    for (let i = 0; i < n; i++) {
      const an = (i / n) * TAU + Math.PI / n;
      const d = { x: Math.cos(an), y: Math.sin(an) };
      shapes.push(leafFlat({ x: c.x + d.x * (r - 0.06), y: c.y + d.y * (r - 0.06) }, d, len));
    }
    groundShapes(k, c, r + len, shapes, { fill: k.pal.main, lit: k.pal.core, alpha: a });
  }
}

/**
 * Brace's hedge: a ring scored on the ground round the caster at `R` tiles,
 * and on it a cheval-de-frise of pikes of light -- pairs crossed in an X,
 * leant out over the ring -- `rise` of their height up, each pair one record
 * so they sort with whatever stands by them.
 */
function hedge(k: FxScene, R: number, rise: number, a: number, age: number): void {
  if (a <= 0.01) return;
  const c = k.caster;
  k.ring(c, R, { band: 0.1, alpha: 0.75 * a, n: 40, glow: 0.3 });
  k.ring(c, R - 0.2, { band: 0.035, alpha: 0.55 * a, main: k.pal.accent, glow: 0, n: 40 });
  if (rise <= 0.02) return;
  const n = k.fast ? 6 : 10;
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU + hashOf(k.seed, i) * 0.1;
    const d = { x: Math.cos(an), y: Math.sin(an) };
    // Rising one after the next round the ring.
    const own = clamp(rise * 1.3 - hashOf(k.seed + 2, i) * 0.3);
    if (own > 0.02) cheval(k, k.on(c.x + d.x * (R - 0.12), c.y + d.y * (R - 0.12), 0), d, 20 * own, a, age + i);
  }
}

/** Two pikes crossed in an X standing at `base`, leant out along `d` at about forty degrees, `len` height units long. */
function cheval(k: FxScene, base: P3, d: V2, len: number, a: number, beat: number): void {
  const r = rightOf(d);
  const lean = 0.64;
  const draws: Array<(g: CanvasRenderingContext2D) => void> = [];
  for (const side of [-1, 1]) {
    // Their feet a little apart along the ring, their heads crossing over and apart the other way.
    const foot = { x: base.x + r.x * side * 0.07, y: base.y + r.y * side * 0.07, z: base.z };
    const out = len * lean, up = len * Math.sqrt(1 - lean * lean);
    const tip = {
      x: foot.x + (d.x * out - r.x * side * len * 0.32) / UNITS_PER_TILE,
      y: foot.y + (d.y * out - r.y * side * len * 0.32) / UNITS_PER_TILE,
      z: foot.z + up + 0.25 * Math.sin(k.now * 2.4 + beat + side),
    };
    lance(k, foot, tip, { width: 2.6, head: 10, glow: 0, alpha: a, into: draws });
  }
  k.worldDraw(base, (g) => {
    for (const draw of draws) draw(g);
  });
  // One glow where the heads cross rather than one down each shaft: a hedge of ten of them stands for seconds.
  k.glow({ x: base.x + (d.x * len * lean) / UNITS_PER_TILE, y: base.y + (d.y * len * lean) / UNITS_PER_TILE, z: base.z + len * 0.72 }, 11, 0.4 * a);
}
