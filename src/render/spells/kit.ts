/**
 * The spells' toolkit: everything a spell draws is drawn with this.
 *
 * The island is low-poly and flat: faceted shapes in two or three tones, an ink
 * edge round them, no gradients on a surface. A spell has to look as though it
 * belongs among those bodies and trees, so the shapes here are the same --
 * an orb is an eight-sided gem lit from over the viewer's left shoulder, a
 * bolt is a jagged ribbon with an ink edge, a ring on the ground is a band of
 * flat facets laid over the land's own corners -- and light is the one thing
 * allowed to be soft: a glow, added over everything after the night is laid.
 *
 * ## How a spell draws
 *
 * Immediate mode. Every frame the stage (`./stage`) calls the spell's own
 * functions with an `FxScene`, `k`, and those call the methods below, which
 * record what to draw and where. The stage then draws each record in its pass:
 *
 *   ground   laid on the land under everything standing on it: `ring`,
 *            `disc`, `sigil`, `scorch`. Cut a line of the ground at a time so
 *            a hill in front still hides it and a body standing in it stands
 *            on it rather than in it.
 *   world    sorted in among bodies, trees and walls by where it is: `orb`,
 *            `bolt`, `beam`, `ribbon`, `slash`, `shell`, `pillar`, `shards`,
 *            `mark`, and the particles that are not light (smoke, dust,
 *            shards).
 *   glow     added over the whole picture after the night's wash, so it shines
 *            in the dark: `glow`, `flare`, and the particles that are light
 *            (sparks, embers, motes). Most world shapes put a glow down
 *            themselves; say `glow: 0` to leave it off.
 *   light    `light`: a circle cut out of the night, which lights the ground
 *            and everything on it as a fire does (`Game.lights`).
 *   screen   `flash`: the whole screen tinted for a moment. Only ever for the
 *            caster's own big spells, and sparingly: the stage drops it for
 *            anybody else's.
 *
 * ## Units
 *
 *   - Where: `P3`, `x`/`y` in tiles on the island and `z` in height units
 *     (a tenth of a metre, the land's own; a person is about 17 tall),
 *     counted from the sea, as the land's heights are.
 *   - How far along the ground: tiles. How high: height units.
 *   - How thick or big a mark is drawn -- a line's width, an orb's radius, a
 *     particle: pixels at zoom one, multiplied by the zoom. The island is
 *     played at zoom 1 to 2.5, where a person is 40 to 100 pixels tall.
 *   - Colours: '#rrggbb' for anything drawn; a light's colour is 'r, g, b'.
 *
 * ## What it costs
 *
 * Particles live in one pool of fixed arrays (`MOST_PARTICLES`, a third of it
 * on fast graphics), glows are a cached picture per colour, and nothing here
 * keeps anything between frames but the particles. The records a frame makes
 * are small and thrown away. A spell that wants a hundred of something wants
 * a particle burst, not a hundred records.
 */
import { HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from '../iso';
import type { View } from '../view';

/* ---- numbers ------------------------------------------------------------------ */

export const TAU = Math.PI * 2;
export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
/** Where `t` is between `a` and `b`, nought to one. */
export const seg = (t: number, a: number, b: number): number => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
/** Smooth both ends. */
export const smooth = (u: number): number => { const v = clamp(u); return v * v * (3 - 2 * v); };
export const easeIn = (u: number): number => { const v = clamp(u); return v * v * v; };
export const easeOut = (u: number): number => { const v = 1 - clamp(u); return 1 - v * v * v; };
/** Overshoots and settles: for a snap into a pose. */
export const easeBack = (u: number): number => { const v = clamp(u) - 1; return 1 + 2.4 * v * v * v + 1.4 * v * v; };
/** Nought at `a`, one at `b`, nought again at `c`, smoothly. */
export const bump = (t: number, a: number, b: number, c: number): number => (t < b ? smooth(seg(t, a, b)) : 1 - smooth(seg(t, b, c)));
/** Up quickly and down slowly, over nought to one: a flash, a burst's brightness. */
export const flashOf = (u: number, up = 0.12): number => (u < up ? smooth(u / up) : Math.pow(1 - clamp((u - up) / (1 - up)), 1.6));

/** A seeded random number source, nought to one. */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number in [0, 1) from two whole numbers, the same every time: for something that must not flicker. */
export function hashOf(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ---- colour ------------------------------------------------------------------- */

const rgbCache = new Map<string, [number, number, number]>();
/** '#rrggbb' as three numbers. */
export function rgbOf(hex: string): [number, number, number] {
  let c = rgbCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1, 7), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}
/** '#rrggbb' as 'r, g, b', for a light or a glow. */
export const channelsOf = (hex: string): string => rgbOf(hex).join(', ');
/** The colour lighter (k above one, toward white) or darker (below one, toward black). */
export function tone(hex: string, k: number): string {
  const [r, g, b] = rgbOf(hex);
  const f = (v: number): number => Math.round(k >= 1 ? v + (255 - v) * Math.min(1, k - 1) : v * Math.max(0, k));
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}
/** Between two colours. */
export function mixColour(a: string, b: string, u: number): string {
  const [r0, g0, b0] = rgbOf(a), [r1, g1, b1] = rgbOf(b);
  return `rgb(${Math.round(lerp(r0, r1, u))}, ${Math.round(lerp(g0, g1, u))}, ${Math.round(lerp(b0, b1, u))})`;
}

/**
 * The colours of a school, a trade or a patron. Every spell of a group draws in
 * its group's, so a Kindler across a field is a Kindler before the spell lands.
 */
export interface SpellPalette {
  /** The heart of it: the inside of a flame, the middle of a bolt. Near white. */
  core: string;
  /** What it is: the body of an orb, the band of a ring. */
  main: string;
  /** Its shaded side, and its far facets. */
  deep: string;
  /** A second colour for an edge, a rune, a spark. */
  accent: string;
  /** The ink round its shapes: darker than `deep`, never black. */
  ink: string;
  /** The colour it lights the night with and glows in, '#rrggbb'. */
  light: string;
}

/* ---- where things are --------------------------------------------------------- */

/** A point on the island: tiles across, tiles down, and height units up from the sea. */
export interface P3 {
  x: number;
  y: number;
  z: number;
}
export const p3 = (x: number, y: number, z: number): P3 => ({ x, y, z });
export const mid3 = (a: P3, b: P3, u: number): P3 => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) });
/** Along a throw from `a` to `b`, `u` of the way, `lift` height units over the straight line at the middle. */
export const arcAt = (a: P3, b: P3, u: number, lift: number): P3 => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) + 4 * lift * u * (1 - u) });
/** Tiles apart on the ground. */
export const tilesApart = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(b.x - a.x, b.y - a.y);

/** What the stage needs of the camera: the projection, and its turn for walking a direction round the body. */
export interface Eye {
  zoom: number;
  view: View;
  worldToScreenX(wx: number, wy: number): number;
  worldToScreenY(wx: number, wy: number, h: number): number;
  rotateX(x: number, y: number): number;
  rotateY(x: number, y: number): number;
  unrotateX(u: number, v: number): number;
  unrotateY(u: number, v: number): number;
}

/**
 * Something a spell is cast by or at: a person or a creature, where its feet
 * are and how big it is. `facing` is the way it is drawn turned (nought at the
 * viewer, two to screen right); `figure`, for a person, is enough of their pose
 * for `FxScene.hand` and friends to find a hand in it.
 */
export interface Body {
  x: number;
  y: number;
  /** Height of the ground under its feet, in height units. */
  z: number;
  /** Height units from the feet to the top of the head. */
  tall: number;
  /** Height units from the middle out to its side. */
  wide: number;
  facing: number;
  kind: 'player' | 'peer' | 'creature' | 'spot';
  /** For a person: who, so a hand can be found (`FxScene.hand`). */
  figure?: import('../figure').FigurePose;
}

/* ---- the pools ---------------------------------------------------------------- */

/** The most particles alive at once, over every spell on the screen; a third of it on fast graphics. */
export const MOST_PARTICLES = 1200;
/** The most lights spells may hold up at once. */
export const MOST_LIGHTS = 8;

/** Kinds of particle, by how they are drawn. The first three are light, added in the glow pass; the rest are things, sorted in the world. */
export type ParticleKind = 'spark' | 'ember' | 'mote' | 'smoke' | 'dust' | 'shard' | 'drop';
const KIND_NO: Record<ParticleKind, number> = { spark: 0, ember: 1, mote: 2, smoke: 3, dust: 4, shard: 5, drop: 6 };
/** Whether a kind is light (glow pass) rather than a thing (world pass). */
export const isLightKind = (k: number): boolean => k <= 2;

/**
 * What a burst of particles is: how many, which way and how fast, how long
 * they live and how they look. Every number has a default that reads as a
 * small puff of sparks.
 */
export interface BurstOpts {
  kind?: ParticleKind;
  /** '#rrggbb', or several to pick from at random. */
  colour?: string | readonly string[];
  /** What it fades to over its life, if anything. */
  fade?: string;
  /** Pixels at zoom one: at birth, and at death. */
  size?: number;
  sizeEnd?: number;
  /** Seconds, at least and at most. */
  life?: [number, number];
  /** Tiles a second outwards over the ground, at least and at most. */
  speed?: [number, number];
  /** Height units a second upwards, at least and at most. */
  up?: [number, number];
  /** Spread round a heading, radians; a full circle when there is no heading. */
  heading?: { x: number; y: number };
  cone?: number;
  /** Height units a second a second pulling down (a spark falls, smoke rises with a negative one). */
  gravity?: number;
  /** Share of its speed kept each second: one keeps it all, nought stops it at once. */
  drag?: number;
  /** Tiles round the point they start anywhere in, and height units up and down. */
  jitter?: number;
  jitterZ?: number;
  /** Turns a second, for shards and dust. */
  spin?: number;
  /** For world kinds: drawn this much nearer the viewer in the sort, in pixels, to keep in front of whatever they came off. */
  bias?: number;
}

/**
 * Every particle there is, in fixed arrays. A slot whose `life` is nought is
 * free. Kept off the garbage collector: a burst of three hundred is three
 * hundred writes into numbers already there.
 */
export class Particles {
  readonly most: number;
  n = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size: Float32Array;
  readonly size1: Float32Array;
  readonly grav: Float32Array;
  readonly drag: Float32Array;
  readonly spin: Float32Array;
  readonly bias: Float32Array;
  readonly kind: Uint8Array;
  readonly colour: Uint16Array;
  readonly fade: Uint16Array;
  /** Colours by number: a particle keeps a number rather than a string. */
  readonly colours: string[] = [];
  private readonly colourNo = new Map<string, number>();
  private free: number[] = [];
  private top = 0;

  constructor(most = MOST_PARTICLES) {
    this.most = most;
    const f = (): Float32Array => new Float32Array(most);
    this.x = f(); this.y = f(); this.z = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.size = f(); this.size1 = f(); this.grav = f(); this.drag = f(); this.spin = f(); this.bias = f();
    this.kind = new Uint8Array(most);
    this.colour = new Uint16Array(most);
    this.fade = new Uint16Array(most);
  }

  colourOf(c: string): number {
    let i = this.colourNo.get(c);
    if (i === undefined) {
      i = this.colours.length;
      this.colours.push(c);
      this.colourNo.set(c, i);
    }
    return i;
  }

  /** A free slot, or -1 when the pool is full: the burst is smaller, never the frame slower. */
  take(cap: number): number {
    if (this.free.length) return this.free.pop() as number;
    if (this.top < Math.min(cap, this.most)) return this.top++;
    return -1;
  }

  /** On by `dt` seconds: moved, slowed, pulled, aged, and the dead given back. */
  step(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.top; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.life[i] = 0;
        this.free.push(i);
        continue;
      }
      const keep = Math.pow(this.drag[i], dt);
      this.vx[i] *= keep;
      this.vy[i] *= keep;
      this.vz[i] = this.vz[i] * keep - this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      alive++;
    }
    this.n = alive;
    // Nothing alive at all: start the slots from the bottom again, so a quiet screen walks no empty arrays.
    if (!alive) {
      this.top = 0;
      this.free.length = 0;
    }
  }

  /** How many slots to walk. */
  get span(): number {
    return this.top;
  }

  clear(): void {
    this.life.fill(0);
    this.top = 0;
    this.n = 0;
    this.free.length = 0;
  }
}

/* ---- glow pictures ------------------------------------------------------------- */

const glowPics = new Map<string, HTMLCanvasElement>();
const GLOW_PX = 64;
/**
 * A soft round glow in one colour, made once and kept: drawn scaled wherever
 * something shines. Three bands rather than a smooth fall, so even the light
 * keeps a little of the island's stepped look.
 */
export function glowPicture(hex: string): HTMLCanvasElement | null {
  let c = glowPics.get(hex);
  if (c) return c;
  if (typeof document === 'undefined') return null;
  c = document.createElement('canvas');
  c.width = c.height = GLOW_PX;
  const g = c.getContext('2d');
  if (!g) return null;
  const [r, gg, b] = rgbOf(hex);
  const h = GLOW_PX / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, `rgba(${r},${gg},${b},0.95)`);
  grad.addColorStop(0.16, `rgba(${r},${gg},${b},0.7)`);
  grad.addColorStop(0.2, `rgba(${r},${gg},${b},0.42)`);
  grad.addColorStop(0.5, `rgba(${r},${gg},${b},0.16)`);
  grad.addColorStop(0.56, `rgba(${r},${gg},${b},0.09)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, GLOW_PX, GLOW_PX);
  if (glowPics.size > 96) glowPics.delete(glowPics.keys().next().value as string);
  glowPics.set(hex, c);
  return c;
}

/* ---- what a frame records ------------------------------------------------------- */

/** Something laid on the ground: the tiles it may cover, and how to draw it. */
export interface GroundRec {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  draw: (g: CanvasRenderingContext2D) => void;
}
/** Something standing in the world: the tile it sorts with, where on the screen it sorts, and how to draw it. */
export interface WorldRec {
  x: number;
  y: number;
  sx: number;
  sy: number;
  draw: ((g: CanvasRenderingContext2D) => void) | null;
  /** Or a particle, by its slot. */
  p: number;
}
/** A light for the night. Shaped as `LightSource`. */
export interface LightRec {
  x: number;
  y: number;
  radius: number;
  strength: number;
  cast: string;
  castAlpha: number;
}

/** What a frame of every spell on the screen came to, pass by pass. Filled by `FxScene`, drawn by the stage. */
export class FxFrame {
  ground: GroundRec[] = [];
  world: WorldRec[] = [];
  glow: Array<(g: CanvasRenderingContext2D) => void> = [];
  screen: Array<(g: CanvasRenderingContext2D, w: number, h: number) => void> = [];
  lights: LightRec[] = [];
  reset(): void {
    this.ground.length = 0;
    this.world.length = 0;
    this.glow.length = 0;
    this.screen.length = 0;
    this.lights.length = 0;
  }
}

/* ---- options common to the shapes ------------------------------------------------- */

/** How a shape is drawn: its colours (the palette's, unless given), how opaque, and how much glow goes with it. */
export interface Look {
  /** Over the palette's own. */
  main?: string;
  deep?: string;
  core?: string;
  ink?: string;
  /** Nought to one, over all of it. */
  alpha?: number;
  /** How bright the glow put down with it, nought for none; one is the shape's own default. */
  glow?: number;
  /** Pixels at zoom one, for the line shapes: how wide. */
  width?: number;
  /** For world shapes: pixels nearer the viewer in the sort (a shape at a body's feet with a positive bias is drawn over the body). */
  bias?: number;
}

/* ---- the scene a spell draws into ------------------------------------------------- */

/**
 * What a spell's functions are handed every frame, `k`: the time, the caster,
 * the target and the place, and every shape and particle as a method.
 *
 * One of these is used for every spell in turn, so keep nothing on it: keep
 * what a cast has to remember in `k.state`, which is that cast's own.
 */
export class FxScene {
  /** Seconds, on the clock the frames are drawn on. */
  now = 0;
  /** Seconds since the last frame. */
  dt = 0;
  zoom = 1;
  /** Fast graphics: fewer particles, fewer facets, no screen accents. */
  fast = false;
  /** Whether you cast it, rather than somebody else: a screen accent is only ever for the caster. */
  mine = false;
  /** The spell's palette. */
  pal!: SpellPalette;
  /** The spell's numbers, as the island casts it from: `secs`, `reach`, `radius` and the rest. */
  fx: Readonly<Record<string, number>> = {};
  /** Who cast it, where they are this frame. */
  caster!: Body;
  /** What it was cast at, where it is this frame: a body, or the caster again for a spell on oneself. */
  target!: Body;
  /** Where on the ground it lands: the target's feet, or the spot chosen. */
  spot!: P3;
  /** The caster's companion, when the caster is you and something follows you: what a Beastmaster's spells act through. */
  companion: Body | null = null;
  /** Tiles from the caster to the spot. */
  dist = 0;
  /** Of this cast, kept from frame to frame: for an artist's own counters. */
  state: Record<string, number> = {};
  /** A seed of this cast's own, the same every frame. */
  seed = 1;
  /** A random number source fresh for this frame and this cast: things that should crackle. */
  rand: () => number = Math.random;

  /** The ground's height under a point, in height units. */
  ground: (x: number, y: number) => number = () => 0;
  /** Where a joint of a person is (`figureJoint`), by the stage. */
  jointOf: ((b: Body, bone: string, at?: [number, number, number]) => P3 | null) | null = null;

  eye!: Eye;
  out!: FxFrame;
  parts!: Particles;
  /** How many particles may be alive at once, on this graphics setting. */
  partCap = MOST_PARTICLES;

  /* ---- projecting -------------------------------------------------------------- */

  sx(p: P3): number {
    return this.eye.worldToScreenX(p.x, p.y);
  }
  sy(p: P3): number {
    return this.eye.worldToScreenY(p.x, p.y, p.z);
  }
  /** Pixels at zoom one to pixels now. */
  px(n: number): number {
    return n * this.zoom;
  }
  /** A height in units, in pixels now. */
  hpx(units: number): number {
    return units * HEIGHT_SCALE * this.zoom;
  }
  /** A point on the ground, `lift` height units over it. */
  on(x: number, y: number, lift = 0): P3 {
    return { x, y, z: this.ground(x, y) + lift };
  }

  /* ---- bodies ------------------------------------------------------------------ */

  /** A point up a body: `share` of its height over its feet (nought the feet, one the top of its head). */
  at(b: Body, share: number): P3 {
    return { x: b.x, y: b.y, z: b.z + b.tall * share };
  }
  /** Which way a body faces on the ground, as a unit step in tiles. */
  facingDir(b: Body): { x: number; y: number } {
    // As `viewOf`: nought is toward the viewer, each step an eighth of a turn to screen right.
    const th = Math.PI / 4 - (b.facing * Math.PI) / 4;
    const u = Math.cos(th), v = Math.sin(th);
    const x = this.eye.unrotateX(u, v), y = this.eye.unrotateY(u, v);
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }
  /** The unit step from one point to another over the ground; the caster's facing when they are one place. */
  toward(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
    return l > 1e-4 ? { x: dx / l, y: dy / l } : this.facingDir(this.caster);
  }
  /** A point on a body in its own terms: `right`, `ahead` and `up` in height units from the middle of its feet, as `figureJoint` gives them. */
  local(b: Body, right: number, ahead: number, up: number): P3 {
    // As `viewOf` turns a figure: its right and its ahead in the view's own terms, then back onto the island.
    const th = Math.PI / 4 - (b.facing * Math.PI) / 4;
    const s = 1 / UNITS_PER_TILE;
    const u = (-Math.sin(th) * right + Math.cos(th) * ahead) * s, v = (Math.cos(th) * right + Math.sin(th) * ahead) * s;
    return { x: b.x + this.eye.unrotateX(u, v), y: b.y + this.eye.unrotateY(u, v), z: b.z + up };
  }

  /** A joint of a person, or a point up a creature when it is not one. */
  joint(b: Body, bone: string, at?: [number, number, number], share = 0.6): P3 {
    return (b.figure && this.jointOf?.(b, bone, at)) || this.at(b, share);
  }
  /** The middle of a closed hand: the right (1, the default) or the left (0). Where a spell leaves a person from. */
  hand(side = 1, b: Body = this.caster): P3 {
    return this.joint(b, `wrist${side}`, [0, 0, -0.62], 0.55);
  }
  chest(b: Body = this.caster): P3 {
    return b.figure ? this.joint(b, 'chest', [0, 0.4, 1.2], 0.68) : this.at(b, 0.6);
  }
  head(b: Body = this.caster): P3 {
    return b.figure ? this.joint(b, 'head', [0, 0, 1.4], 0.92) : this.at(b, 0.85);
  }
  /** The middle of a body, where a bolt goes in. */
  heart(b: Body = this.target): P3 {
    return b.figure ? this.chest(b) : this.at(b, 0.5);
  }
  /** Out along a weapon in the right fist, `along` height units from the fist toward its point. */
  weaponAt(along: number, b: Body = this.caster): P3 {
    return this.joint(b, 'wrist1', [0, 0.87 * along, -0.62 - 0.5 * along], 0.5);
  }

  /* ---- recording ------------------------------------------------------------------ */

  /** Something drawn on the ground round (x, y), within `r` tiles of it. Draw in screen pixels with `this` for projecting. */
  groundDraw(x: number, y: number, r: number, draw: (g: CanvasRenderingContext2D) => void): void {
    this.out.ground.push({ x0: x - r, y0: y - r, x1: x + r, y1: y + r, draw });
  }
  /** Something standing at `p`, sorted with what stands there; `bias` pixels nearer the viewer. */
  worldDraw(p: P3, draw: (g: CanvasRenderingContext2D) => void, bias = 0): void {
    // Sorted on where its foot is on the ground, not where it is in the air: a bolt over a body's head sorts with the body.
    this.out.world.push({ x: p.x, y: p.y, sx: this.eye.worldToScreenX(p.x, p.y), sy: this.eye.worldToScreenY(p.x, p.y, this.ground(p.x, p.y)) + bias, draw, p: -1 });
  }
  /** Something added over everything, as light is. */
  glowDraw(draw: (g: CanvasRenderingContext2D) => void): void {
    this.out.glow.push(draw);
  }

  /* ---- light -------------------------------------------------------------------------- */

  /** A light in the night at a point: `radius` tiles, `strength` nought to one, in the palette's light unless told. */
  light(p: { x: number; y: number }, radius: number, strength: number, colour = this.pal.light): void {
    if (strength <= 0.01 || this.out.lights.length >= MOST_LIGHTS) return;
    this.out.lights.push({ x: p.x, y: p.y, radius, strength: clamp(strength), cast: channelsOf(colour), castAlpha: 0.32 * clamp(strength) });
  }

  /* ---- glow -------------------------------------------------------------------------- */

  /** A soft glow round a point, `r` pixels at zoom one, in the palette's light unless told. */
  glow(p: P3, r: number, alpha = 1, colour = this.pal.light): void {
    if (alpha <= 0.01 || r <= 0) return;
    const pic = glowPicture(colour);
    if (!pic) return;
    const x = this.sx(p), y = this.sy(p), R = r * this.zoom;
    this.out.glow.push((g) => {
      g.globalAlpha = clamp(alpha);
      g.drawImage(pic, x - R, y - R, 2 * R, 2 * R);
    });
  }
  /** A four-pointed glint: the moment something lands, or a star. `r` pixels at zoom one. */
  flare(p: P3, r: number, alpha = 1, colour = this.pal.core, turn = 0): void {
    if (alpha <= 0.01 || r <= 0) return;
    const x = this.sx(p), y = this.sy(p), R = r * this.zoom, w = R * 0.16;
    this.out.glow.push((g) => {
      g.globalAlpha = clamp(alpha);
      g.fillStyle = colour;
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = turn + (i * Math.PI) / 2, len = i % 2 ? R * 0.62 : R;
        const c = Math.cos(a), s = Math.sin(a);
        g.moveTo(x - s * w, y + c * w * 0.5);
        g.lineTo(x + c * len, y + s * len * 0.8);
        g.lineTo(x + s * w, y - c * w * 0.5);
      }
      g.fill();
    });
    this.glow(p, r * 0.7, alpha * 0.6);
  }

  /* ---- the screen ------------------------------------------------------------------- */

  /** The whole screen tinted for a moment, `alpha` nought to one. Only for your own casts, never on fast graphics, and keep it under a quarter. */
  flash(alpha: number, colour = this.pal.light): void {
    if (!this.mine || this.fast || alpha <= 0.005) return;
    const a = Math.min(0.3, alpha);
    this.out.screen.push((g, w, h) => {
      g.globalAlpha = a;
      g.fillStyle = colour;
      g.fillRect(0, 0, w, h);
    });
  }

  /* ---- on the ground -------------------------------------------------------------------- */

  /** Points round a circle on the ground, lifted a hair off it so the band never sinks into a slope. */
  private around(cx: number, cy: number, r: number, n: number, turn: number, lift: number, out: number[]): void {
    out.length = 0;
    for (let i = 0; i < n; i++) {
      const a = turn + (i / n) * TAU;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      out.push(this.eye.worldToScreenX(x, y), this.eye.worldToScreenY(x, y, this.ground(x, y) + lift));
    }
  }
  /** Facets round a circle: fewer far off and on fast graphics, never fewer than a hexagon. */
  facets(rTiles: number, most = 48): number {
    const n = Math.round(10 + rTiles * 7 * Math.min(2, this.zoom));
    return Math.max(6, Math.min(this.fast ? Math.min(most, 18) : most, n));
  }

  /**
   * A band round a point on the ground, `r` tiles out and `width` tiles wide: the shockwave, the edge of a ward, the
   * reach of a spell. Flat facets, the inner edge inked; `turn` turns its facets.
   */
  ring(c: { x: number; y: number }, r: number, o: Look & { band?: number; turn?: number; n?: number; dash?: number } = {}): void {
    if (r <= 0.02) return;
    const band = Math.min(r, o.band ?? 0.18);
    const a = o.alpha ?? 1;
    if (a <= 0.01) return;
    const n = o.n ?? this.facets(r);
    const main = o.main ?? this.pal.main, deep = o.deep ?? this.pal.deep, ink = o.ink ?? this.pal.ink;
    const outer: number[] = [], inner: number[] = [];
    this.around(c.x, c.y, r, n, o.turn ?? 0, 0.15, outer);
    this.around(c.x, c.y, r - band, n, o.turn ?? 0, 0.15, inner);
    const dash = o.dash ?? 0;
    const inkW = Math.max(0.8, 0.7 * this.zoom);
    // The facets in two paths, the near half of the band in the lit tone and the far half shaded -- a hoop lying on the
    // ground -- so it is three fills and a stroke however many facets, which matters: it is drawn again for every line
    // of the ground it lies across.
    const lit = new Path2D(), shade = new Path2D(), rim = new Path2D();
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!(dash && i % dash === dash - 1)) {
        const into = outer[2 * i + 1] + outer[2 * j + 1] > inner[2 * i + 1] + inner[2 * j + 1] ? lit : shade;
        into.moveTo(outer[2 * i], outer[2 * i + 1]);
        into.lineTo(outer[2 * j], outer[2 * j + 1]);
        into.lineTo(inner[2 * j], inner[2 * j + 1]);
        into.lineTo(inner[2 * i], inner[2 * i + 1]);
        into.closePath();
      }
      if (i === 0) rim.moveTo(outer[0], outer[1]);
      else rim.lineTo(outer[2 * i], outer[2 * i + 1]);
    }
    rim.closePath();
    this.groundDraw(c.x, c.y, r + 0.5, (g) => {
      g.globalAlpha = clamp(a);
      g.fillStyle = main;
      g.fill(lit);
      g.fillStyle = deep;
      g.fill(shade);
      g.lineWidth = inkW;
      g.strokeStyle = ink;
      g.stroke(rim);
    });
    const gl = o.glow ?? 1;
    if (gl > 0) {
      const pic = glowPicture(this.pal.light);
      if (pic) {
        // A glow round the band itself, as a few soft spots along it rather than one over the whole disc.
        const step = Math.max(1, Math.floor(n / 12));
        const R = Math.max(6, band * HALF_W * this.zoom * 2.2);
        this.out.glow.push((g) => {
          g.globalAlpha = clamp(a * gl * 0.35);
          for (let i = 0; i < n; i += step) g.drawImage(pic, outer[2 * i] - R, outer[2 * i + 1] - R, 2 * R, 2 * R);
        });
      }
    }
  }

  /** A flat round patch on the ground, `r` tiles across: light pooled under a spell, or the shadow of one. */
  disc(c: { x: number; y: number }, r: number, o: Look & { n?: number; turn?: number } = {}): void {
    const a = o.alpha ?? 0.5;
    if (r <= 0.02 || a <= 0.01) return;
    const n = o.n ?? this.facets(r, 32);
    const pts: number[] = [];
    this.around(c.x, c.y, r, n, o.turn ?? 0, 0.1, pts);
    const fill = o.main ?? this.pal.main;
    this.groundDraw(c.x, c.y, r + 0.5, (g) => {
      g.globalAlpha = clamp(a);
      g.fillStyle = fill;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        if (i === 0) g.moveTo(pts[0], pts[1]);
        else g.lineTo(pts[2 * i], pts[2 * i + 1]);
      }
      g.closePath();
      g.fill();
    });
  }

  /**
   * A sigil on the ground: an outer and an inner band, a star of `points` drawn
   * through the inner circle, and a tick at each point on the outer -- a
   * patron's seal, a ward's circle. `turn` radians turns it; `grow` nought to
   * one draws it on as it is cast.
   */
  sigil(c: { x: number; y: number }, r: number, o: Look & { points?: number; turn?: number; grow?: number; step?: number } = {}): void {
    const a = o.alpha ?? 1;
    if (r <= 0.05 || a <= 0.01) return;
    const grow = clamp(o.grow ?? 1);
    const turn = o.turn ?? 0;
    const points = o.points ?? 5;
    const step = o.step ?? 2;
    this.ring(c, r, { ...o, band: Math.max(0.06, r * 0.07), turn, glow: o.glow ?? 0.7, alpha: a * smooth(grow * 2) });
    this.ring(c, r * 0.78, { ...o, band: Math.max(0.04, r * 0.035), turn: -turn, glow: 0, alpha: a * smooth(grow * 2 - 0.3) });
    const star: number[] = [];
    const ticks: number[] = [];
    const inner = r * 0.76;
    for (let i = 0; i < points; i++) {
      const q = (i * step) % points;
      const ang = turn + (q / points) * TAU - Math.PI / 2;
      const x = c.x + Math.cos(ang) * inner, y = c.y + Math.sin(ang) * inner;
      star.push(this.eye.worldToScreenX(x, y), this.eye.worldToScreenY(x, y, this.ground(x, y) + 0.2));
      const ta = turn + (i / points) * TAU - Math.PI / 2;
      for (const rr of [r * 0.8, r * 0.98]) {
        const tx = c.x + Math.cos(ta) * rr, ty = c.y + Math.sin(ta) * rr;
        ticks.push(this.eye.worldToScreenX(tx, ty), this.eye.worldToScreenY(tx, ty, this.ground(tx, ty) + 0.2));
      }
    }
    const main = o.core ?? this.pal.accent, ink = o.ink ?? this.pal.ink;
    const w = (o.width ?? 1.6) * this.zoom;
    const drawn = clamp(grow * 1.4 - 0.4);
    this.groundDraw(c.x, c.y, r + 0.5, (g) => {
      if (drawn <= 0) return;
      g.globalAlpha = clamp(a);
      g.lineJoin = 'miter';
      // The star drawn on stroke by stroke as it grows.
      const strokes = points * drawn;
      const path = (): void => {
        g.beginPath();
        g.moveTo(star[0], star[1]);
        for (let i = 1; i <= Math.ceil(strokes); i++) {
          const k = i % points, j = (i - 1) % points;
          const u = Math.min(1, strokes - (i - 1));
          g.lineTo(lerp(star[2 * j], star[2 * k], u), lerp(star[2 * j + 1], star[2 * k + 1], u));
        }
      };
      g.strokeStyle = ink;
      g.lineWidth = w + Math.max(1.2, this.zoom);
      path();
      g.stroke();
      g.strokeStyle = main;
      g.lineWidth = w;
      path();
      g.stroke();
      g.beginPath();
      for (let i = 0; i < ticks.length; i += 4) {
        g.moveTo(ticks[i], ticks[i + 1]);
        g.lineTo(ticks[i + 2], ticks[i + 3]);
      }
      g.lineWidth = w * 0.8;
      g.stroke();
      g.lineJoin = 'round';
    });
  }

  /** A burnt or blasted patch on the ground, ragged, `r` tiles: what a fire or a blow leaves behind. */
  scorch(c: { x: number; y: number }, r: number, o: Look & { colour?: string } = {}): void {
    const a = o.alpha ?? 0.5;
    if (r <= 0.02 || a <= 0.01) return;
    const n = this.facets(r, 22);
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU;
      const rr = r * (0.62 + 0.38 * hashOf(this.seed + i, 7));
      const x = c.x + Math.cos(ang) * rr, y = c.y + Math.sin(ang) * rr;
      pts.push(this.eye.worldToScreenX(x, y), this.eye.worldToScreenY(x, y, this.ground(x, y) + 0.08));
    }
    const fill = o.colour ?? '#1d1612';
    this.groundDraw(c.x, c.y, r + 0.5, (g) => {
      g.globalAlpha = clamp(a);
      g.fillStyle = fill;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        if (i === 0) g.moveTo(pts[0], pts[1]);
        else g.lineTo(pts[2 * i], pts[2 * i + 1]);
      }
      g.closePath();
      g.fill();
    });
  }

  /* ---- standing in the world -------------------------------------------------------------- */

  /**
   * A low-poly gem of light: an eight-sided ball lit from over the viewer's
   * left shoulder, inked, with its heart showing, and a glow round it. A bolt's
   * head, a charge in the hand, a mote over a mark. `r` pixels at zoom one.
   */
  orb(p: P3, r: number, o: Look & { turn?: number; sides?: number } = {}): void {
    const a = o.alpha ?? 1;
    if (r <= 0.1 || a <= 0.01) return;
    const x = this.sx(p), y = this.sy(p), R = r * this.zoom;
    const sides = o.sides ?? (this.fast || R < 4 ? 6 : 8);
    const turn = o.turn ?? 0;
    const main = o.main ?? this.pal.main, deep = o.deep ?? this.pal.deep, core = o.core ?? this.pal.core, ink = o.ink ?? this.pal.ink;
    const inkW = Math.max(0.8, 0.75 * this.zoom);
    this.worldDraw(p, (g) => {
      g.globalAlpha = clamp(a);
      // The heart, a little up and left of the middle, where the light is.
      const hx = x - R * 0.22, hy = y - R * 0.25;
      for (let i = 0; i < sides; i++) {
        const a0 = turn + (i / sides) * TAU, a1 = turn + ((i + 1) / sides) * TAU;
        const mx = Math.cos((a0 + a1) / 2), my = Math.sin((a0 + a1) / 2);
        // Facets facing up and left lit, down and right shaded.
        const lit = -0.6 * mx - 0.8 * my;
        g.fillStyle = lit > 0.35 ? core : lit > -0.3 ? main : deep;
        g.beginPath();
        g.moveTo(hx, hy);
        g.lineTo(x + Math.cos(a0) * R, y + Math.sin(a0) * R);
        g.lineTo(x + Math.cos(a1) * R, y + Math.sin(a1) * R);
        g.closePath();
        g.fill();
      }
      g.lineWidth = inkW;
      g.strokeStyle = ink;
      g.beginPath();
      for (let i = 0; i <= sides; i++) {
        const an = turn + (i / sides) * TAU;
        if (i === 0) g.moveTo(x + Math.cos(an) * R, y + Math.sin(an) * R);
        else g.lineTo(x + Math.cos(an) * R, y + Math.sin(an) * R);
      }
      g.stroke();
    }, o.bias ?? 0);
    const gl = o.glow ?? 1;
    if (gl > 0) this.glow(p, r * 3.2, a * gl * 0.8);
  }

  /** A ribbon through points in the world, `width` pixels at zoom one at its widest, tapering to nothing at the first point: a trail, a slash, a wisp. */
  ribbon(pts: readonly P3[], o: Look & { taper?: 'start' | 'both' | 'none'; edge?: boolean } = {}): void {
    const n = pts.length;
    const a = o.alpha ?? 1;
    if (n < 2 || a <= 0.01) return;
    const W = (o.width ?? 4) * this.zoom;
    const xs: number[] = [], ys: number[] = [];
    for (const p of pts) {
      xs.push(this.sx(p));
      ys.push(this.sy(p));
    }
    const taper = o.taper ?? 'start';
    const left: number[] = [], right: number[] = [];
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      let dx = xs[i1] - xs[i0], dy = ys[i1] - ys[i0];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const u = i / (n - 1);
      const w = (W / 2) * (taper === 'none' ? 1 : taper === 'both' ? Math.sin(Math.PI * u) : u);
      left.push(xs[i] - dy * w, ys[i] + dx * w);
      right.push(xs[i] + dy * w, ys[i] - dx * w);
    }
    const main = o.main ?? this.pal.main, core = o.core ?? this.pal.core, ink = o.ink ?? this.pal.ink;
    const inkW = Math.max(0.8, 0.7 * this.zoom);
    // Sorted with its nearest end, so it passes in front of what is behind both ends.
    const near = pts[ys.indexOf(Math.max(...ys))] ?? pts[n - 1];
    this.worldDraw(near, (g) => {
      g.globalAlpha = clamp(a);
      const outline = (): void => {
        g.beginPath();
        g.moveTo(left[0], left[1]);
        for (let i = 1; i < n; i++) g.lineTo(left[2 * i], left[2 * i + 1]);
        for (let i = n - 1; i >= 0; i--) g.lineTo(right[2 * i], right[2 * i + 1]);
        g.closePath();
      };
      outline();
      g.fillStyle = main;
      g.fill();
      if (o.edge !== false) {
        g.lineWidth = inkW;
        g.strokeStyle = ink;
        g.stroke();
      }
      // The core down its middle, half as wide.
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const mx = (left[2 * i] + right[2 * i]) / 2, my = (left[2 * i + 1] + right[2 * i + 1]) / 2;
        const lx = lerp(mx, left[2 * i], 0.4), ly = lerp(my, left[2 * i + 1], 0.4);
        if (i === 0) g.moveTo(lx, ly);
        else g.lineTo(lx, ly);
      }
      for (let i = n - 1; i >= 0; i--) {
        const mx = (left[2 * i] + right[2 * i]) / 2, my = (left[2 * i + 1] + right[2 * i + 1]) / 2;
        g.lineTo(lerp(mx, right[2 * i], 0.25), lerp(my, right[2 * i + 1], 0.25));
      }
      g.closePath();
      g.fillStyle = core;
      g.fill();
    }, o.bias ?? 0);
    const gl = o.glow ?? 1;
    if (gl > 0) {
      const pic = glowPicture(this.pal.light);
      if (pic) {
        const R = Math.max(5, W * 1.6);
        const step = Math.max(1, Math.floor(n / 6));
        this.out.glow.push((g) => {
          g.globalAlpha = clamp(a * gl * 0.4);
          for (let i = n - 1; i >= 0; i -= step) g.drawImage(pic, xs[i] - R, ys[i] - R, 2 * R, 2 * R);
        });
      }
    }
  }

  /** A straight shaft of light from one point to another, `width` pixels at zoom one, square at both ends. */
  beam(a: P3, b: P3, o: Look = {}): void {
    this.ribbon([a, mid3(a, b, 0.5), b], { ...o, taper: 'none', width: o.width ?? 3 });
  }

  /**
   * A jagged bolt from one point to another, struck afresh every frame: a
   * crackle of lightning, a binding's chain of force, a hex's thread. `jag` is
   * how far it wanders, in pixels at zoom one.
   */
  bolt(a: P3, b: P3, o: Look & { jag?: number; kinks?: number; fork?: number } = {}): void {
    const al = o.alpha ?? 1;
    if (al <= 0.01) return;
    const x0 = this.sx(a), y0 = this.sy(a), x1 = this.sx(b), y1 = this.sy(b);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const kinks = o.kinks ?? Math.max(3, Math.min(14, Math.round(len / (14 * this.zoom))));
    const jag = (o.jag ?? 6) * this.zoom;
    const nx = -(y1 - y0) / (len || 1), ny = (x1 - x0) / (len || 1);
    const pts: number[] = [x0, y0];
    for (let i = 1; i < kinks; i++) {
      const u = i / kinks;
      const off = (this.rand() * 2 - 1) * jag * Math.sin(Math.PI * u);
      pts.push(lerp(x0, x1, u) + nx * off, lerp(y0, y1, u) + ny * off);
    }
    pts.push(x1, y1);
    // A fork or two off the main line, shorter and thinner.
    const forks: number[][] = [];
    for (let f = 0; f < (o.fork ?? 1); f++) {
      const at = 1 + Math.floor(this.rand() * (kinks - 1));
      const fx = pts[2 * at], fy = pts[2 * at + 1];
      const dir = this.rand() < 0.5 ? -1 : 1;
      const l = len * (0.12 + 0.12 * this.rand());
      const ang = Math.atan2(y1 - y0, x1 - x0) + dir * (0.5 + 0.5 * this.rand());
      forks.push([fx, fy, fx + Math.cos(ang) * l * 0.5 + nx * jag * 0.3, fy + Math.sin(ang) * l * 0.5, fx + Math.cos(ang) * l, fy + Math.sin(ang) * l]);
    }
    const W = (o.width ?? 2.2) * this.zoom;
    const main = o.main ?? this.pal.main, core = o.core ?? this.pal.core, ink = o.ink ?? this.pal.ink;
    const near = y1 > y0 ? b : a;
    const stroke = (g: CanvasRenderingContext2D, w: number, c: string): void => {
      g.lineWidth = w;
      g.strokeStyle = c;
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      for (const f of forks) {
        g.moveTo(f[0], f[1]);
        g.lineTo(f[2], f[3]);
        g.lineTo(f[4], f[5]);
      }
      g.stroke();
    };
    this.worldDraw(near, (g) => {
      g.globalAlpha = clamp(al);
      g.lineJoin = 'miter';
      g.lineCap = 'butt';
      stroke(g, W + Math.max(1.4, 1.1 * this.zoom), ink);
      stroke(g, W, main);
      stroke(g, Math.max(0.8, W * 0.4), core);
      g.lineJoin = 'round';
    }, -0.5);
    const gl = o.glow ?? 1;
    if (gl > 0) {
      const light = this.pal.light;
      this.out.glow.push((g) => {
        g.globalAlpha = clamp(al * gl * 0.5);
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.strokeStyle = light;
        g.lineWidth = W * 4;
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.stroke();
        g.lineCap = 'butt';
      });
    }
  }

  /**
   * A crescent swept by a body's blade: the arc a cut leaves in the air.
   * The arc lies in the plane through the body's `ahead` and an `up` leant
   * `tilt` radians toward its right (nought an overhead chop straight down
   * the middle, a quarter turn a flat sweep from right to left); `from` and
   * `to` are angles in that plane, nought straight ahead and a quarter turn
   * straight up the leant up, so the default 2.4 to -0.8 starts over the
   * right shoulder and ends low across the front. `reach` height units out
   * from the shoulder at `up` units over the feet; `u` nought to one how far
   * the cut has come, the edge trailing `length` radians of light.
   */
  slash(b: Body, o: Look & { from?: number; to?: number; tilt?: number; reach?: number; u?: number; up?: number; length?: number } = {}): void {
    const u = clamp(o.u ?? 1);
    const from = o.from ?? 2.4, to = o.to ?? -0.8;
    const tilt = o.tilt ?? 0.45;
    const reach = o.reach ?? 12;
    const up = o.up ?? b.tall * 0.72;
    const length = o.length ?? 1.4;
    const head = lerp(from, to, u);
    const tail = from < to ? Math.max(from, head - length) : Math.min(from, head + length);
    const n = this.fast ? 6 : 12;
    const pts: P3[] = [];
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    for (let i = 0; i <= n; i++) {
      const ang = lerp(tail, head, i / n);
      const c = Math.cos(ang) * reach, s = Math.sin(ang) * reach;
      pts.push(this.local(b, s * st, c, Math.max(1, up + s * ct)));
    }
    this.ribbon(pts, { ...o, width: o.width ?? 7, taper: 'start', alpha: (o.alpha ?? 1) * (u < 1 ? 1 : 0.6) });
  }

  /**
   * A shell round a body: a faceted egg of light, the back of it drawn behind
   * the body and only its rim and its lit facets in front, so whoever is in it
   * still shows through. `size` over the body's own (one fits a person
   * snugly), `turn` turns its facets.
   */
  shell(b: Body, o: Look & { size?: number; turn?: number; sides?: number } = {}): void {
    const a = o.alpha ?? 0.6;
    if (a <= 0.01) return;
    const size = o.size ?? 1;
    const c = this.at(b, 0.5);
    const x = this.sx(c), y = this.sy(c);
    const ry = b.tall * HEIGHT_SCALE * this.zoom * 0.62 * size;
    const rx = Math.max(ry * 0.55, b.wide * 2.6 * this.zoom * size);
    const sides = o.sides ?? (this.fast ? 8 : 12);
    const turn = o.turn ?? 0;
    const main = o.main ?? this.pal.main, deep = o.deep ?? this.pal.deep, core = o.core ?? this.pal.core, ink = o.ink ?? this.pal.ink;
    const ptsX: number[] = [], ptsY: number[] = [];
    for (let i = 0; i < sides; i++) {
      const an = turn + (i / sides) * TAU;
      ptsX.push(x + Math.cos(an) * rx);
      ptsY.push(y + Math.sin(an) * ry);
    }
    const foot = { x: b.x, y: b.y, z: b.z };
    // Behind: the whole of it, faint, its facets in two tones.
    this.worldDraw(foot, (g) => {
      g.globalAlpha = clamp(a * 0.45);
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        g.fillStyle = i % 2 ? main : deep;
        g.beginPath();
        g.moveTo(x, y - ry * 0.15);
        g.lineTo(ptsX[i], ptsY[i]);
        g.lineTo(ptsX[j], ptsY[j]);
        g.closePath();
        g.fill();
      }
    }, -0.3);
    // In front: the rim, and the facets the light catches.
    this.worldDraw(foot, (g) => {
      g.globalAlpha = clamp(a);
      g.lineWidth = Math.max(0.9, 0.8 * this.zoom);
      g.strokeStyle = ink;
      g.beginPath();
      for (let i = 0; i <= sides; i++) {
        const k = i % sides;
        if (i === 0) g.moveTo(ptsX[k], ptsY[k]);
        else g.lineTo(ptsX[k], ptsY[k]);
      }
      g.stroke();
      g.globalAlpha = clamp(a * 0.55);
      g.fillStyle = core;
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        const mx = (ptsX[i] + ptsX[j]) / 2 - x, my = (ptsY[i] + ptsY[j]) / 2 - y;
        if (-0.6 * mx / rx - 0.8 * my / ry < 0.45) continue;
        g.beginPath();
        g.moveTo(lerp(x, ptsX[i], 0.82), lerp(y, ptsY[i], 0.82));
        g.lineTo(ptsX[i], ptsY[i]);
        g.lineTo(ptsX[j], ptsY[j]);
        g.lineTo(lerp(x, ptsX[j], 0.82), lerp(y, ptsY[j], 0.82));
        g.closePath();
        g.fill();
      }
    }, 0.6);
    const gl = o.glow ?? 1;
    if (gl > 0) this.glow(c, (ry / this.zoom) * 1.1, a * gl * 0.35);
  }

  /** A column of light standing on the ground at a point, `r` pixels at zoom one across and `h` height units tall, fading up its length. */
  pillar(c: { x: number; y: number }, o: Look & { r?: number; h?: number } = {}): void {
    const a = o.alpha ?? 1;
    if (a <= 0.01) return;
    const foot = this.on(c.x, c.y);
    const x = this.sx(foot), y = this.sy(foot);
    const R = (o.r ?? 8) * this.zoom, H = (o.h ?? 40) * HEIGHT_SCALE * this.zoom;
    const main = o.main ?? this.pal.main, deep = o.deep ?? this.pal.deep, core = o.core ?? this.pal.core;
    this.worldDraw(foot, (g) => {
      const fade = (c0: string, al: number): CanvasGradient => {
        const grad = g.createLinearGradient(0, y, 0, y - H);
        grad.addColorStop(0, c0);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = clamp(al);
        return grad;
      };
      // Three faces of a hexagonal shaft: the shaded left, the lit right, and a core.
      g.fillStyle = fade(deep, a * 0.7);
      g.fillRect(x - R, y - H, R, H);
      g.fillStyle = fade(main, a * 0.7);
      g.fillRect(x, y - H, R, H);
      g.fillStyle = fade(core, a * 0.9);
      g.fillRect(x - R * 0.3, y - H, R * 0.6, H);
    }, 0.4);
    const gl = o.glow ?? 1;
    if (gl > 0) {
      this.glow(foot, (o.r ?? 8) * 2.6, a * gl * 0.6);
      this.glow(this.on(c.x, c.y, (o.h ?? 40) * 0.35), (o.r ?? 8) * 2.2, a * gl * 0.4);
    }
  }

  /** Shards standing up out of the ground round a point, `n` of them `r` tiles out: ice, stone, crystal. `h` height units tall, `grow` nought to one. */
  shards(c: { x: number; y: number }, o: Look & { n?: number; r?: number; h?: number; grow?: number } = {}): void {
    const a = o.alpha ?? 1;
    const grow = clamp(o.grow ?? 1);
    if (a <= 0.01 || grow <= 0) return;
    const n = o.n ?? 6, r = o.r ?? 0.35, h = (o.h ?? 6) * grow;
    const main = o.main ?? this.pal.main, deep = o.deep ?? this.pal.deep, core = o.core ?? this.pal.core, ink = o.ink ?? this.pal.ink;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + hashOf(this.seed, i) * 0.6;
      const rr = r * (0.7 + 0.5 * hashOf(this.seed + 3, i));
      const base = this.on(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr);
      const lean = (hashOf(this.seed + 5, i) - 0.5) * 0.8 + Math.cos(ang) * 0.4;
      const tall = h * (0.6 + 0.6 * hashOf(this.seed + 7, i));
      const w = (2 + 1.6 * hashOf(this.seed + 9, i)) * this.zoom;
      const bx = this.sx(base), by = this.sy(base);
      const tx = bx + lean * tall * HEIGHT_SCALE * this.zoom * 0.35, ty = by - tall * HEIGHT_SCALE * this.zoom;
      this.worldDraw(base, (g) => {
        g.globalAlpha = clamp(a);
        g.fillStyle = deep;
        g.beginPath();
        g.moveTo(bx - w, by);
        g.lineTo(tx, ty);
        g.lineTo(bx, by + w * 0.35);
        g.closePath();
        g.fill();
        g.fillStyle = main;
        g.beginPath();
        g.moveTo(bx, by + w * 0.35);
        g.lineTo(tx, ty);
        g.lineTo(bx + w, by);
        g.closePath();
        g.fill();
        g.fillStyle = core;
        g.beginPath();
        g.moveTo(lerp(bx, tx, 0.45) - w * 0.15, lerp(by, ty, 0.45));
        g.lineTo(tx, ty);
        g.lineTo(lerp(bx, tx, 0.3) + w * 0.25, lerp(by, ty, 0.3));
        g.closePath();
        g.fill();
        g.lineWidth = Math.max(0.8, 0.7 * this.zoom);
        g.strokeStyle = ink;
        g.beginPath();
        g.moveTo(bx - w, by);
        g.lineTo(tx, ty);
        g.lineTo(bx + w, by);
        g.lineTo(bx, by + w * 0.35);
        g.closePath();
        g.stroke();
      });
    }
    if ((o.glow ?? 1) > 0) this.glow(this.on(c.x, c.y, h * 0.4), 10 + h, a * (o.glow ?? 1) * 0.35);
  }

  /**
   * A mark over something: a small turning rune at a point -- over a marked
   * creature's head, on a warded body's brow. `r` pixels at zoom one, `points`
   * its corners (three a triangle, four a diamond, more a star).
   */
  mark(p: P3, o: Look & { r?: number; points?: number; turn?: number } = {}): void {
    const a = o.alpha ?? 1;
    if (a <= 0.01) return;
    const x = this.sx(p), y = this.sy(p), R = (o.r ?? 5) * this.zoom;
    const points = o.points ?? 4;
    const turn = o.turn ?? 0;
    const main = o.main ?? this.pal.accent, core = o.core ?? this.pal.core, ink = o.ink ?? this.pal.ink;
    // Turning about the upright: squashed across as it turns, so it reads as a flat thing in the air.
    const sq = 0.35 + 0.65 * Math.abs(Math.cos(turn));
    this.worldDraw(p, (g) => {
      g.globalAlpha = clamp(a);
      g.beginPath();
      for (let i = 0; i < points * 2; i++) {
        const an = (i / (points * 2)) * TAU - Math.PI / 2;
        const rr = points <= 4 ? (i % 2 ? R * 0.5 : R) : i % 2 ? R * 0.45 : R;
        const px = x + Math.cos(an) * rr * sq, py = y + Math.sin(an) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = main;
      g.fill();
      g.lineWidth = Math.max(0.8, 0.7 * this.zoom);
      g.strokeStyle = ink;
      g.stroke();
      g.fillStyle = core;
      g.beginPath();
      g.moveTo(x, y - R * 0.45);
      g.lineTo(x + R * 0.2 * sq, y);
      g.lineTo(x, y + R * 0.2);
      g.lineTo(x - R * 0.2 * sq, y);
      g.closePath();
      g.fill();
    }, o.bias ?? 2);
    if ((o.glow ?? 1) > 0) this.glow(p, (o.r ?? 5) * 2.6, a * (o.glow ?? 1) * 0.5);
  }

  /* ---- particles ------------------------------------------------------------------------- */

  /** A burst of `n` particles from a point (a third as many on fast graphics). */
  burst(p: P3, n: number, o: BurstOpts = {}): void {
    this.spawn(p, Math.round(n * (this.fast ? 0.35 : 1)), o);
  }

  /** A steady stream of particles from a point, `perSecond` of them, for as long as it is called each frame. */
  emit(p: P3, perSecond: number, o: BurstOpts = {}): void {
    const want = perSecond * this.dt * (this.fast ? 0.35 : 1);
    const n = Math.floor(want) + (this.rand() < want - Math.floor(want) ? 1 : 0);
    if (n > 0) this.spawn(p, n, o);
  }

  private spawn(p: P3, count: number, o: BurstOpts): void {
    const ps = this.parts;
    const kind = KIND_NO[o.kind ?? 'spark'];
    const colours = o.colour === undefined ? [this.pal.core, this.pal.main] : typeof o.colour === 'string' ? [o.colour] : o.colour;
    const fade = o.fade !== undefined ? ps.colourOf(o.fade) : 65535;
    const [l0, l1] = o.life ?? [0.4, 0.9];
    const [s0, s1] = o.speed ?? [0.6, 1.6];
    const [u0, u1] = o.up ?? [4, 18];
    const cone = o.cone ?? TAU;
    const head = o.heading ? Math.atan2(o.heading.y, o.heading.x) : 0;
    const jit = o.jitter ?? 0.05, jz = o.jitterZ ?? 0.5;
    for (let i = 0; i < count; i++) {
      const s = ps.take(this.partCap);
      if (s < 0) return;
      const r = this.rand;
      const ang = o.heading ? head + (r() - 0.5) * cone : r() * TAU;
      const sp = lerp(s0, s1, r());
      ps.x[s] = p.x + (r() - 0.5) * 2 * jit;
      ps.y[s] = p.y + (r() - 0.5) * 2 * jit;
      ps.z[s] = p.z + (r() - 0.5) * 2 * jz;
      ps.vx[s] = Math.cos(ang) * sp;
      ps.vy[s] = Math.sin(ang) * sp;
      ps.vz[s] = lerp(u0, u1, r());
      ps.age[s] = 0;
      ps.life[s] = lerp(l0, l1, r());
      ps.size[s] = (o.size ?? 2.2) * (0.7 + 0.6 * r());
      ps.size1[s] = o.sizeEnd ?? (kind === 3 || kind === 4 ? ps.size[s] * 2.6 : ps.size[s] * 0.3);
      ps.grav[s] = o.gravity ?? (kind === 3 ? -6 : 30);
      ps.drag[s] = o.drag ?? 0.25;
      ps.spin[s] = (o.spin ?? 1.5) * (r() - 0.5) * 2;
      ps.bias[s] = o.bias ?? 0;
      ps.kind[s] = kind;
      ps.colour[s] = ps.colourOf(colours[Math.floor(r() * colours.length) % colours.length]);
      ps.fade[s] = fade;
    }
  }
}

/* ---- drawing particles ----------------------------------------------------------------- */

/**
 * Draw one particle, at its place this frame. Light (sparks, embers, motes) is
 * drawn into the glow pass with 'lighter' already set; things (smoke, dust,
 * shards, drops) into the world, sorted with whatever is standing there.
 */
export function drawParticle(g: CanvasRenderingContext2D, ps: Particles, i: number, eye: Eye, now: number): void {
  const zoom = eye.zoom;
  const u = ps.age[i] / ps.life[i];
  const x = eye.worldToScreenX(ps.x[i], ps.y[i]), y = eye.worldToScreenY(ps.x[i], ps.y[i], ps.z[i]);
  const size = lerp(ps.size[i], ps.size1[i], u) * zoom;
  const k = ps.kind[i];
  const colour = ps.fade[i] !== 65535 && u > 0.4 ? ps.colours[ps.fade[i]] : ps.colours[ps.colour[i]];
  if (k === 0) {
    // A spark: a short streak along where it is going.
    const nx = eye.worldToScreenX(ps.x[i] - ps.vx[i] * 0.05, ps.y[i] - ps.vy[i] * 0.05);
    const ny = eye.worldToScreenY(ps.x[i] - ps.vx[i] * 0.05, ps.y[i] - ps.vy[i] * 0.05, ps.z[i] - ps.vz[i] * 0.05);
    g.globalAlpha = 1 - u * u;
    g.strokeStyle = colour;
    g.lineWidth = Math.max(0.8, size * 0.6);
    g.beginPath();
    g.moveTo(nx, ny);
    g.lineTo(x, y);
    g.stroke();
    return;
  }
  if (k === 1) {
    // An ember: a diamond that flickers as it cools.
    const fl = 0.7 + 0.3 * Math.sin(now * 23 + i * 1.7);
    g.globalAlpha = (1 - u) * fl;
    g.fillStyle = colour;
    const s = Math.max(0.7, size);
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.7, y);
    g.lineTo(x, y + s);
    g.lineTo(x - s * 0.7, y);
    g.closePath();
    g.fill();
    return;
  }
  if (k === 2) {
    // A mote: a glint that comes and goes.
    const tw = Math.max(0, Math.sin(u * Math.PI));
    g.globalAlpha = tw;
    g.fillStyle = colour;
    const s = Math.max(0.6, size);
    g.fillRect(x - s * 0.35, y - s * 1.2, s * 0.7, s * 2.4);
    g.fillRect(x - s * 1.2, y - s * 0.35, s * 2.4, s * 0.7);
    return;
  }
  if (k === 3 || k === 4) {
    // Smoke or dust: a flat hexagon puff, opening out and thinning.
    g.globalAlpha = (k === 3 ? 0.55 : 0.75) * (1 - u) * Math.min(1, u * 8);
    g.fillStyle = colour;
    g.beginPath();
    const turn = ps.spin[i] * ps.age[i];
    for (let j = 0; j < 6; j++) {
      const an = turn + (j / 6) * TAU;
      const px = x + Math.cos(an) * size, py = y + Math.sin(an) * size * 0.75;
      if (j === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    return;
  }
  if (k === 5) {
    // A shard: a spinning inked triangle.
    const turn = ps.spin[i] * ps.age[i] * TAU;
    g.globalAlpha = Math.min(1, (1 - u) * 3);
    g.fillStyle = colour;
    g.beginPath();
    for (let j = 0; j < 3; j++) {
      const an = turn + (j / 3) * TAU;
      const rr = j === 0 ? size * 1.5 : size;
      const px = x + Math.cos(an) * rr, py = y + Math.sin(an) * rr * 0.8;
      if (j === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.lineWidth = Math.max(0.6, 0.5 * zoom);
    g.strokeStyle = 'rgba(20,16,24,0.8)';
    g.stroke();
    return;
  }
  // A drop: a falling bead.
  g.globalAlpha = 1 - u;
  g.fillStyle = colour;
  g.beginPath();
  g.ellipse(x, y, Math.max(0.6, size * 0.5), Math.max(0.8, size * 0.8), 0, 0, TAU);
  g.fill();
}
