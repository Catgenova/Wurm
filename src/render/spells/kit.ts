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
import { figureJoint, figureJoints, viewOf, weaponSpan, type FigurePose, type V3 } from '../figure';
import { HALF_H, HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from '../iso';
import type { View } from '../view';
import { wildermonHead, wildermonTop } from '../wildermon';
import type { CastAim, CastTravel } from './index';

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

/* ---- going without going muddy ------------------------------------------------------------ */

/*
 * Something faded by its alpha over the ground is mixed with the ground: red
 * half gone over grass is olive, gold is khaki. These go another way. A pool
 * or a stain dries -- darkens toward its own deep shade, keeping its hue --
 * and is let go by alpha only at the very end (`lateFade`); a cut or a trail
 * is eaten from its tail (`eatTail`), opaque to the last.
 */

/** Three numbers as '#rrggbb'. */
const hexOf = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/**
 * A colour dried, `u` of the way (nought to one) toward `to` -- its own shade at `dark` of its brightness
 * (0.45) when not given: blood going brown-black, a glow going to embers. As '#rrggbb', so it can go
 * anywhere a palette colour can (a light, a glow).
 */
export function dry(hex: string, u: number, to?: string, dark = 0.45): string {
  const [r, g, b] = rgbOf(hex);
  const [r1, g1, b1] = to ? rgbOf(to) : [r * dark, g * dark, b * dark];
  const k = clamp(u);
  return hexOf(lerp(r, r1, k), lerp(g, g1, k), lerp(b, b1, k));
}

/**
 * Points along a line with its first `u` (nought to one) eaten away, measured along its length: what is left of a
 * cut or a trail as it goes, its head where it was. One point (the head) once it is all gone. Allocates its answer.
 */
export function eatTail(pts: readonly P3[], u: number): P3[] {
  const n = pts.length;
  if (n < 2 || u <= 0) return pts.slice();
  const len = (a: P3, b: P3): number => Math.hypot((b.x - a.x) * UNITS_PER_TILE, (b.y - a.y) * UNITS_PER_TILE, b.z - a.z);
  let total = 0;
  for (let i = 1; i < n; i++) total += len(pts[i - 1], pts[i]);
  let left = clamp(u) * total;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1], b = pts[i], l = len(a, b);
    if (left <= l) return [mid3(a, b, l > 0 ? left / l : 1), ...pts.slice(i)];
    left -= l;
  }
  return [pts[n - 1]];
}

/** An alpha held at one until the last `secs` (0.2) of what is `left`, then let down to nought: for a mark that has dried first. */
export const lateFade = (left: number, secs = 0.2): number => (secs > 0 ? smooth(left / secs) : left > 0 ? 1 : 0);

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

/** Somebody or something a spell is cast by or at, by who they are: you, somebody else by their id, a creature by its id. */
export type Who = { kind: 'player' } | { kind: 'peer'; id: number } | { kind: 'creature'; id: number };
/** Whether two `Who`s are the same somebody. */
export const sameWho = (a: Who, b: Who): boolean => a.kind === b.kind && (a.kind === 'player' || (a as { id: number }).id === (b as { id: number }).id);

/** Seconds a linger plays on once the island says the waiting spell it shows was spent (`Told.used`), to let it go rather than cut it. */
export const USED_FADE = 0.4;

/**
 * What the island said a cast did (`fx_told` on the island, `CastTold` in the game), as the stage plays it: who it
 * reached, each by who they are on the screen, with the seconds what it left lasts on them (`secs`: a hold, a root,
 * a flight, a burn, a bleed, a slow, a mark, a buff) and whether it holds them still (`held`); the caster's waiting
 * spells it spent (`used`: `kindler_stoke`, `warder_thicken`); the largest skin it laid, or the skin a Ward Burst
 * broke, as a share of health (`size`); and an Execute's on a creature below its line (`low`).
 */
export interface Told {
  hit: ReadonlyArray<{ who: Who; secs?: number; held?: boolean }>;
  used?: readonly string[];
  size?: number;
  low?: boolean;
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
  /** Who it is, when the stage knows: to tell the bodies `FxScene.bodiesWithin` finds apart, and the caster among them. */
  who?: Who;
  /** For a creature: its kind, for where its head is (`FxScene.muzzle`). */
  species?: string;
  /**
   * For a creature: how near it can strike you from, in tiles, as the game has it (`beastReach`): a blow's
   * `HUNT_REACH`, or a thrower's `THROW_REACH`. Where a reach advantage is measured from.
   */
  reach?: number;
  /**
   * For a creature: somebody's -- a companion out (`companion`), a beast on a deed or in a pen -- rather than wild; and
   * after somebody now (`hostile`), hunting or fighting. Left out (false) for what the stage cannot tell.
   */
  tame?: boolean;
  companion?: boolean;
  hostile?: boolean;
  /**
   * What the island says is on a creature now, where the payload carries it: a
   * Kindler's burn running, a knife's bleed running, held fast in a trap or by
   * a hold a cast was told of (`Told.held`: a Bind, a Lock, a Skull Crack, an
   * Earthshaker, a Still field) for as long as the island said it holds.
   * Nothing is said of people, and no other mark is in the payload.
   */
  burning?: boolean;
  bleeding?: boolean;
  held?: boolean;
}

/* ---- kept between frames for a cast -------------------------------------------------- */

/** Seconds of a cast's own clock between a weapon trail's samples: a sixtieth, whatever the frames are drawn at. */
const TRAIL_STEP = 1 / 60;
/**
 * Each cast's weapon trails' samples (`FxScene.trail`), by its `state` (which is the cast's own, and goes with it) and
 * the trail: by step, the inner and the outer point in the body's frame.
 */
const trails = new WeakMap<object, Map<string, Map<number, [V3, V3]>>>();

/** Where a creature's head is on its own model, standing: units ahead of its feet and up, and how tall the model is, in height units. */
const kindHeads = new Map<string, { ahead: number; up: number; tall: number } | null>();
function headOfKind(species: string): { ahead: number; up: number; tall: number } | null {
  let h = kindHeads.get(species);
  if (h === undefined) {
    // Seen side on (facing two), ahead is across the screen, so where the head is on the screen there says both how far
    // ahead of the feet it is and how high.
    const at = wildermonHead(species, 2), top = wildermonTop(species), ey = viewOf(2).ey;
    h = null;
    if (at && top && Math.abs(ey[0]) > 1e-3) {
      const ahead = at[0] / ey[0];
      h = { ahead, up: -(at[1] - ahead * ey[1]) / HEIGHT_SCALE, tall: Math.max(22, top) / HEIGHT_SCALE };
    }
    kindHeads.set(species, h);
  }
  return h;
}

/**
 * How wide a creature of a kind stands, as `Body.wide` (height units from its middle out to its side), at its own
 * size: from the length of its own model -- how far ahead of its feet its head is -- measured against the ulva's,
 * which stands five wide. A rabbit-sized thing is narrower, an ogre or a bear broader; a kind with no model is five.
 */
export function creatureWide(species: string): number {
  const h = headOfKind(species), ref = headOfKind('ulva');
  if (!h || !ref || Math.abs(ref.ahead) < 0.5) return 5;
  return 5 * clamp(Math.max(Math.abs(h.ahead), h.tall * 0.35) / Math.max(Math.abs(ref.ahead), ref.tall * 0.35), 0.5, 4);
}

/* ---- the pools ---------------------------------------------------------------- */

/** The longest a side of a circle's facet is drawn, in pixels, before it is cut finer (`FxScene.finer`); and the most times over. */
const FACET_PX = 24, FINER_MOST = 8;

/** The most particles alive at once, over every spell on the screen; a third of it on fast graphics. */
export const MOST_PARTICLES = 1200;
/** The most lights spells may hold up at once. */
export const MOST_LIGHTS = 8;

/**
 * Kinds of particle, by how they are drawn. Spark, ember, mote and heal are light, added in the glow pass; the rest
 * are things, sorted in the world. A `mote` is a small round glint that says nothing in particular; a `heal` is the
 * white cross that says health given back, and only a heal should use it (a mote cast by a spell whose numbers are a
 * heal, `fx.heal`, is drawn as one).
 */
export type ParticleKind = 'spark' | 'ember' | 'mote' | 'smoke' | 'dust' | 'shard' | 'drop' | 'mist' | 'heal';
const KIND_NO: Record<ParticleKind, number> = { spark: 0, ember: 1, mote: 2, smoke: 3, dust: 4, shard: 5, drop: 6, mist: 7, heal: 8 };
/** Whether a kind is light (glow pass) rather than a thing (world pass). */
export const isLightKind = (k: number): boolean => k <= 2 || k === 8;

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
  /**
   * For light kinds (spark, ember, mote): laid over the picture in their own colour rather than added to it. Added,
   * a warm colour takes the green of the grass under it into itself -- brass and gold sparks go lime, and at night
   * the wash under them does the same -- so a spark that has to stay its colour (brass, blood, anything but a white
   * or a pale tint) is drawn over. Still drawn after the night, so it shines in the dark as the others do.
   */
  over?: boolean;
  /** For shards: `false` leaves off the dark edge, for chips small or bright enough that an edge makes them dark specks. */
  ink?: boolean;
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
  /** One for drawn over rather than added (`BurstOpts.over`), two for a shard with no edge (`BurstOpts.ink`). */
  readonly flags: Uint8Array;
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
    this.flags = new Uint8Array(most);
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

/**
 * The colour a light lays over the ground it falls on at night (`SpellStage.layLight`): its own hue, saturated, so it goes
 * over the grass as a colour rather than added to it as a brightness. The night takes the cold off a light's circle,
 * which uncovers the grass as green as it is by day, and a warm white added to that is mostly the green brought up --
 * the olive pool a 1.4-tile `#fff1d6` made. Laid as a colour, warm reads warm; a white or a grey light lays grey, which
 * takes the green out of what it uncovers rather than leaving it.
 */
export function lightTint(cast: string): string {
  const [r, g, b] = cast.split(',').map((v) => Number(v) / 255);
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), c = hi - lo;
  const h = c <= 0 ? 0 : hi === r ? ((g - b) / c + 6) % 6 : hi === g ? (b - r) / c + 2 : (r - g) / c + 4;
  // Its hue at 55% lightness, saturated to 85% for any colour with a little of one (a warm white has about a sixth), grey for none.
  const S = 0.85 * clamp((hi > 0 ? c / hi : 0) * 6), L = 0.55, C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs((h % 2) - 1)), m = L - C / 2;
  const [r1, g1, b1] = h < 1 ? [C, X, 0] : h < 2 ? [X, C, 0] : h < 3 ? [0, C, X] : h < 4 ? [0, X, C] : h < 5 ? [X, 0, C] : [C, 0, X];
  const hex = (v: number): string => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r1)}${hex(g1)}${hex(b1)}`;
}

/*
 * How a spell's light falls off at night, shared by the island's night (`Renderer.lightLayers`), the preview's and the
 * stage's colour on the ground (`SpellStage.layout`), so the dark cut back, the colour added and the hue laid all fall
 * together.
 */

/**
 * A spell light's share at `t` of the way from its middle (0) to its edge (1): (1 - t²)², flat at the heart and
 * falling to nothing at the edge with no ring, about half at halfway and a fifth at three quarters.
 */
export function lightFall(t: number): number {
  const u = 1 - t * t;
  return u <= 0 ? 0 : u * u;
}
/**
 * Where a light's gradients are stopped, and `lightFall` at each: drawn as straight runs between them. Evenly spaced,
 * which a canvas fills about a third faster than the same number of stops unevenly spaced.
 */
export const LIGHT_STOPS: readonly number[] = [0, 1, 2, 3, 4, 5, 6].map((i) => i / 6);
export const LIGHT_FALLS: readonly number[] = LIGHT_STOPS.map(lightFall);
/** Tiles of radius up to which a spell light is at its full strength; a wider one is weakened for its size. */
export const LIGHT_FULL = 2;
/**
 * How much of a spell light's strength cuts the night, and adds its cast, at its middle, for its radius: all of it up to
 * `LIGHT_FULL` tiles, then (`LIGHT_FULL` / r)^0.8, so a light twice as wide covers about three times the ground for
 * the same light in all: a 4-tile light 57%, a 7-tile 37%.
 */
export function lightHole(radius: number): number {
  return radius <= LIGHT_FULL ? 1 : (LIGHT_FULL / radius) ** 0.8;
}
/**
 * How much of a spell light's colour it lays on the ground at its middle, for its radius (`SpellStage`): all of it up to
 * `LIGHT_FULL` tiles, then (`LIGHT_FULL` / r)^0.7: a 4-tile light 62%, a 7-tile 42%. A wide light is a glow over the
 * ground rather than a sheet of its colour.
 */
export function lightHue(radius: number): number {
  return radius <= LIGHT_FULL ? 1 : (LIGHT_FULL / radius) ** 0.7;
}
/** A radial gradient falling as `lightFall` from `x`, `y` out to `r`, its colour at each stop `at(fall)`. */
export function fallGradient(g: CanvasRenderingContext2D, x: number, y: number, r: number, at: (fall: number, i: number) => string): CanvasGradient {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  for (let i = 0; i < LIGHT_STOPS.length; i++) grad.addColorStop(LIGHT_STOPS[i], at(LIGHT_FALLS[i], i));
  return grad;
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

/**
 * One part of a mark laid on the ground as shapes on the island
 * (`FxScene.groundShape`): polygons filled, or lines stroked, in one colour,
 * every point a place on the ground in tiles (x, y pairs, flat), drawn
 * `lift` height units over it. `width` is in pixels as drawn (zoom already
 * in it). A `closed` stroke goes back to its first point.
 */
export interface GroundLayer {
  kind: 'fill' | 'stroke';
  colour: string;
  alpha: number;
  paths: number[][];
  lift: number;
  width?: number;
  closed?: boolean;
  join?: CanvasLineJoin;
  cap?: CanvasLineCap;
  /**
   * Light from it as well, this bright (nought or left out for none): its lines and its fills laid again in the glow
   * pass, over the night, in `light` (the palette's light unless given) -- so a ring or a tick on the ground still
   * shows in the dark. Lines glow three times as wide as they are drawn.
   */
  glow?: number;
  light?: string;
}

/** Shapes on the ground drawn whole, each point put on the land where it is: for the preview, and anything else that wants them uncut. */
export function drawGroundLayers(g: CanvasRenderingContext2D, layers: readonly GroundLayer[], eye: Eye, ground: (x: number, y: number) => number): void {
  for (const l of layers) {
    if (!l.paths.length || l.alpha <= 0.01) continue;
    g.beginPath();
    for (const pts of l.paths) {
      for (let i = 0; i < pts.length; i += 2) {
        const sx = eye.worldToScreenX(pts[i], pts[i + 1]), sy = eye.worldToScreenY(pts[i], pts[i + 1], ground(pts[i], pts[i + 1]) + l.lift);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      if (l.kind === 'fill' || l.closed) g.closePath();
    }
    paintGroundLayer(g, l);
  }
}

/** Fill or stroke what is in `g`'s path as a ground layer says. */
export function paintGroundLayer(g: CanvasRenderingContext2D, l: GroundLayer, path?: Path2D): void {
  g.globalAlpha = l.alpha;
  if (l.kind === 'fill') {
    g.fillStyle = l.colour;
    if (path) g.fill(path);
    else g.fill();
    return;
  }
  g.strokeStyle = l.colour;
  g.lineWidth = l.width ?? 1;
  g.lineJoin = l.join ?? 'round';
  g.lineCap = l.cap ?? 'butt';
  if (path) g.stroke(path);
  else g.stroke();
}

/**
 * Something laid on the ground: the tiles it may cover, and how to draw it.
 *
 * The kit's own marks (`ring`, `disc`, `sigil`, `scorch`, `groundPath`, and
 * anything made with `groundShape`) also give their `shape`, which the stage
 * cuts along the tiles' edges and lays a line of the ground at a time with no
 * clip. Anything else (`groundDraw`) is drawn whole into a layer and cut out
 * of it a line at a time under a clip, which costs by the area cut; `keep(x,
 * y, reach)`, when given, says whether it draws anything at all within `reach`
 * tiles of (x, y), and the ground it says no to is not cut for it. It may say
 * yes too often (it is then cut a little wider than it needs), never too
 * seldom (it would be cut off).
 */
export interface GroundRec {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  draw: (g: CanvasRenderingContext2D) => void;
  shape?: readonly GroundLayer[];
  keep?: (x: number, y: number, reach: number) => boolean;
}

/** How far a point is from a segment, in tiles. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const u = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2) : 0;
  return Math.hypot(px - (ax + dx * u), py - (ay + dy * u));
}

/**
 * Whether a point is within `reach` of any of a set of segments, given flat as
 * x0, y0, x1, y1 a segment: a mark's `keep` for lines on the ground, asked
 * thousands of times a frame, so a segment whose box is out of reach is
 * passed over before any square root. `slack`, a number a segment, is how
 * much further each may stray (`FxScene.chordSlack`).
 */
export function nearSegments(segs: readonly number[], x: number, y: number, reach: number, slack?: readonly number[]): boolean {
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const ax = segs[i], ay = segs[i + 1], bx = segs[i + 2], by = segs[i + 3];
    const r = reach + (slack ? slack[i >> 2] : 0);
    if (x < Math.min(ax, bx) - r || x > Math.max(ax, bx) + r || y < Math.min(ay, by) - r || y > Math.max(ay, by) + r) continue;
    if (segDist(x, y, ax, ay, bx, by) <= r) return true;
  }
  return false;
}

/** Tiles on the ground a height unit is up the screen, at the steepest: what a stroke straight across a hill strays by. */
const TILES_A_UNIT = HEIGHT_SCALE / ((2 * HALF_H) / Math.SQRT2);
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
  /** A spell's: falls off smoothly and is weakened for its size where it cuts the night (`lightFall`, `lightHole`). */
  soft: true;
}

/** What a frame of every spell on the screen came to, pass by pass. Filled by `FxScene`, drawn by the stage. */
/** A person veiled this frame: who, and the veil (`FigurePose.veil`). */
export interface VeilRec {
  who: Who;
  colour: string;
  tint: number;
  fade: number;
}
/** A creature tinted this frame (`FxScene.tint`): who, the colour, and how far to it. */
export interface TintRec {
  who: Who;
  colour: string;
  share: number;
}

export class FxFrame {
  ground: GroundRec[] = [];
  world: WorldRec[] = [];
  glow: Array<(g: CanvasRenderingContext2D) => void> = [];
  screen: Array<(g: CanvasRenderingContext2D, w: number, h: number) => void> = [];
  lights: LightRec[] = [];
  /** Bodies veiled this frame (`FxScene.veil`), for whoever draws them. */
  veils: VeilRec[] = [];
  /** Creatures tinted this frame (`FxScene.tint`). */
  tints: TintRec[] = [];
  reset(): void {
    this.veils.length = 0;
    this.tints.length = 0;
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
  /** The colour of that glow, '#rrggbb', over the palette's `light`: a heal's green glow off a Warder's gold. */
  light?: string;
  /** Pixels at zoom one, for the line shapes: how wide. */
  width?: number;
  /** For world shapes: pixels nearer the viewer in the sort (a shape at a body's feet with a positive bias is drawn over the body). */
  bias?: number;
}

/**
 * One polygon (or open line) of a `shapes` group: points in the world, filled
 * in `fill` (the look's `main` unless given, or `false` for none) and edged in
 * `ink` (the look's ink unless given, or `false` for none).
 */
export interface ShapePiece {
  pts: readonly P3[];
  fill?: string | false;
  ink?: string | false;
  /** Pixels at zoom one for its edge. */
  width?: number;
  /** Over the group's own. */
  alpha?: number;
  /** Closed, as a polygon (the default), or an open line, stroked only. */
  closed?: boolean;
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
  /**
   * How dark it is where it is drawn, nought by day to one at the dead of night, as the island lays its night: for
   * choosing tones -- a mark in ink by day and in its light at night, a glow that only wants to show in the dark. The
   * kit's own shapes do not use it; nothing changes unless a spell asks.
   */
  night = 0;
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
  /**
   * Where the caster stood before a move the island made for this cast (a
   * Lunge, a Parting Throw), on the ground; nothing for a cast made standing.
   * The body is carried from here to where it ends up over the cast
   * (`cast.move`), so `k.caster` is already wherever it has got to.
   */
  from: P3 | null = null;
  /** Bodies within `r` tiles of a point, by the stage (`bodiesWithin`). */
  near: ((x: number, y: number, r: number) => readonly Body[]) | null = null;
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
  /**
   * The cast is being played left-handed (`cast.mirror`: a shouldered weapon on the left shoulder): the weapon is in the
   * left hand and the blows come from the left. `side` is minus one then and one otherwise -- multiply anything put to
   * one side by it (`k.local(b, k.side * 4, ...)`, a slash's `tilt`), and ask for `k.hand(k.lefty ? 0 : 1)`.
   */
  lefty = false;
  side = 1;
  /** Where the target stands from the caster, as the pose is told it (`CastAim`); nothing for a cast on oneself. */
  aim: CastAim | null = null;
  /** The stage carrying the caster in for the blow or back after it (`cast.close`, `CastTravel`), nothing while it is not: for a run's streaks and dust keyed to the real thing. */
  travel: CastTravel | null = null;
  /** The cast's timing (its seconds and its release), for what samples the pose through it (`trail`). */
  timing: { secs: number; release: number } | null = null;
  /**
   * Seconds since the spell left the hand (minus one before it has), and seconds left of the cast's pose (its hold
   * included; nought once it is over): `charge` is called to the end of the pose, not only to the release, so a
   * warning or a charge that has to go at the release fades by `released`, and one that has to last the pose fades
   * out over the end by `castLeft` rather than vanishing in a frame.
   */
  released = -1;
  castLeft = 0;
  /** Lights this cast may still put down this frame (`light`): two a cast, eight on the screen. */
  lightsLeft = 2;
  /** The spell gives health back (its numbers have a `heal`): its motes are the heal's cross (`ParticleKind`). */
  healing = false;
  /** Shapes recorded inside `together` this frame past the first of each lot, which the budget does not count again. */
  grouped = 0;
  /**
   * What the island said this cast did (`Told`), or null where it said nothing: an island from before it, a cast drawn
   * from the console or the preview without it. Read it through `hit`, `reached`, `struck`, `secsOn`, `heldOn`, `used`
   * and `fired`, which fall back to what stands near when it is null.
   */
  told: Told | null = null;
  /** The bodies the island said the cast reached, where each is this frame (those gone left out); null where it did not say. */
  hit: Body[] | null = null;
  /**
   * Seconds since the island said this cast's waiting spell was spent (a Stoke's glow by the fire it fed, a Thicken by
   * the skin it made larger); minus one while it waits. The stage ends its linger `USED_FADE` after.
   */
  used = -1;
  /**
   * What the island said this cast fired after it was cast (a Ward Link's skin going back over somebody): on whom, where
   * they are this frame (null when they are gone), how long ago in seconds, and how large as a share of health.
   */
  fired: ReadonlyArray<{ on: Body | null; age: number; size?: number }> = [];

  eye!: Eye;
  out!: FxFrame;
  parts!: Particles;
  /** How many particles may be alive at once, on this graphics setting. */
  partCap = MOST_PARTICLES;

  /**
   * How bright a shape's own glow is drawn (`Look.glow`, one by default): none on fast graphics, where the glow is the
   * second copy of everything drawn and the first thing to go. `k.glow`, `k.flare` and `k.light` are kept.
   */
  glowOf(o: Look): number {
    return this.fast ? 0 : o.glow ?? 1;
  }

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

  /**
   * A point kept for the rest of the cast from the first frame it is asked for (in `k.state`, under `name`): where the
   * weapon's tip was at the hit, so a lance or a line tied to it stays put while the pose recovers rather than
   * kinking and swinging at the sky with the live tip. `get` is asked once.
   *
   *     hit: (k) => { k.once('tip', () => k.joint(k.caster, 'tip')); },
   *     impact: { secs: 0.4, draw: (k, u) => k.ribbon(eatTail([k.once('tip', ...), k.heart()], u), ...) },
   */
  once(name: string, get: () => P3): P3 {
    const st = this.state, kx = name + ':x', ky = name + ':y', kz = name + ':z';
    if (st[kx] === undefined) {
      const p = get();
      st[kx] = p.x;
      st[ky] = p.y;
      st[kz] = p.z;
    }
    return { x: st[kx], y: st[ky], z: st[kz] };
  }

  /**
   * An aura hugging a body: a halo the shape of the body rather than an egg round it -- a band round its outline,
   * close at the sides and over the head, wavering upward like heat (`flow`, how fast; `waver`, how far, in pixels at
   * zoom one), the band behind the body and only its two edges down the sides in front, so the body shows inside it.
   * A siphon's draw, a shroud, a body kept from death -- anything that is the body's own and not a skin laid over it,
   * which is the Warder's `shell`. `size` over a snug fit (one), `width` the band's in pixels at zoom one (3).
   */
  aura(b: Body, o: Look & { size?: number; width?: number; flow?: number; waver?: number; n?: number } = {}): void {
    const a = o.alpha ?? 0.8;
    if (a <= 0.01) return;
    const size = o.size ?? 1;
    const foot = { x: b.x, y: b.y, z: b.z };
    const cx = this.sx(foot), base = this.sy(foot);
    const H = b.tall * HEIGHT_SCALE * this.zoom * 1.06 * size, Wd = Math.max(H * 0.2, b.wide * 1.9 * this.zoom * size);
    const n = o.n ?? (this.fast ? 14 : 22);
    const band = (o.width ?? 3) * this.zoom, wav = (o.waver ?? 1.6) * this.zoom, flow = o.flow ?? 1.2;
    // Round the outline from the right foot, up over the head and down to the left: a body's silhouette, wide at the
    // shoulders, narrow at the neck, round over the head.
    const outer: number[] = [], inner: number[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, ang = Math.PI * u;
      const up = Math.sin(ang) * 0.95 + 0.05 * (1 - Math.cos(2 * ang));
      const side = Math.cos(ang);
      const shoulder = 1 - 0.25 * Math.max(0, Math.sin(ang * 1.0) - 0.82) * 5;
      const wob = Math.sin(this.now * flow * TAU - u * 9 + this.seed) * wav;
      const x = cx + side * (Wd * shoulder + wob * 0.6), y = base - up * H - Math.abs(wob) * Math.sin(ang);
      outer.push(x, y);
      inner.push(cx + side * Math.max(0, Wd * shoulder - band), base - up * Math.max(0, H - band));
    }
    const main = o.main ?? this.pal.main, core = o.core ?? this.pal.core, ink = o.ink ?? this.pal.ink;
    const m = n + 1;
    // Behind: the whole band, a little thinner in tone.
    this.worldDraw(foot, (g) => {
      g.globalAlpha = clamp(a * 0.6);
      g.fillStyle = main;
      g.beginPath();
      for (let i = 0; i < m; i++) (i ? g.lineTo(outer[2 * i], outer[2 * i + 1]) : g.moveTo(outer[0], outer[1]));
      for (let i = m - 1; i >= 0; i--) g.lineTo(inner[2 * i], inner[2 * i + 1]);
      g.closePath();
      g.fill();
    }, -0.3);
    // In front: the two edges down the sides, from the hips up to the shoulders, in its core with an inked outside.
    const sideRun = (from: number, to: number): number[] => {
      const out: number[] = [];
      for (let i = from; i <= to; i++) out.push(outer[2 * i], outer[2 * i + 1]);
      return out;
    };
    const k0 = Math.round(n * 0.08), k1 = Math.round(n * 0.3);
    const runs = [sideRun(k0, k1), sideRun(n - k1, n - k0)];
    this.worldDraw(foot, (g) => {
      g.globalAlpha = clamp(a);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const [wd, col] of [[band * 0.7 + Math.max(1, 0.8 * this.zoom), ink], [band * 0.7, core]] as const) {
        g.lineWidth = wd;
        g.strokeStyle = col;
        g.beginPath();
        for (const r of runs) for (let i = 0; i < r.length; i += 2) (i ? g.lineTo(r[i], r[i + 1]) : g.moveTo(r[i], r[i + 1]));
        g.stroke();
      }
      g.lineCap = 'butt';
    }, 0.6);
    const gl = this.glowOf(o);
    if (gl > 0) this.glow(this.at(b, 0.55), (H / this.zoom) * 0.7, a * gl * 0.3, o.light);
  }

  /**
   * A creature's head, where its jaws are: from the creature's own model where it has one (`species` on the body),
   * scaled to the body's size and turned the way it faces; a person's head; or up its height otherwise. Where a bite
   * starts, a muzzle is bound, a howl comes from.
   */
  muzzle(b: Body = this.target): P3 {
    if (b.figure) return this.head(b);
    const h = b.species ? headOfKind(b.species) : null;
    if (!h) return this.at(b, 0.85);
    const k = h.tall > 0 ? b.tall / h.tall : 1;
    return this.local(b, 0, h.ahead * k, h.up * k);
  }

  /**
   * A person veiled for this frame: `tint` (nought to one) of the way to `colour` (the palette's deep) over the whole
   * body, and the body drawn `fade` of the way to nothing -- a shroud, a body gone to smoke, the dark of a stealth.
   * Only people (whose figure is drawn); the strongest veil a body is given in a frame is the one drawn. Called every
   * frame it is wanted, from any part of a cast (a linger as well).
   */
  veil(b: Body = this.caster, o: { colour?: string; tint?: number; fade?: number } = {}): void {
    if (!b.figure || !b.who) return;
    const tint = clamp(o.tint ?? 0), fade = clamp(o.fade ?? 0);
    if (tint <= 0.004 && fade <= 0.004) return;
    this.out.veils.push({ who: b.who, colour: o.colour ?? this.pal.deep, tint, fade });
  }

  /**
   * A creature (or a person) tinted for this frame, on itself rather than round it: `share` (nought to one) of the way to
   * `colour` (the palette's deep) over the whole of its body as drawn -- sick, marked, frozen, burnt. Call it every
   * frame it is wanted, from any part (a linger too); the strongest a body is given wins. A person's is their `veil`'s
   * tint. A body the stage does not know by who (a spot) is passed over.
   */
  tint(b: Body = this.target, o: { colour?: string; share?: number } = {}): void {
    const share = clamp(o.share ?? 0.4);
    if (share <= 0.004 || !b.who) return;
    if (b.figure) return this.veil(b, { colour: o.colour, tint: share });
    this.out.tints.push({ who: b.who, colour: o.colour ?? this.pal.deep, share });
  }

  /**
   * Draw many things as one shape in the budget (SPELLS.md: about fifteen shapes a frame): everything `draw` records
   * counts once. For the same thing drawn on every body an area reached -- a burn on each of sixteen creatures a
   * Firestorm caught -- which is one effect, each still sorted with its own body.
   */
  together(draw: () => void): void {
    const at = this.out.world.length + this.out.ground.length;
    draw();
    this.grouped += Math.max(0, this.out.world.length + this.out.ground.length - at - 1);
  }

  /**
   * The swept trail of a body's weapon through the air: the band its blade swept over the last `secs` (0.12) of the
   * cast, from `inner` to `outer` of the way from the fist to the point (0.4 to 1), drawn through where the weapon
   * really was -- the posed figure sampled every sixtieth of a second of the cast whatever the frames are drawn at, so
   * at fifteen frames a second a blow is still a smooth band and not three planks. Its head is the weapon as drawn this
   * frame; its tail narrows to the edge, eaten rather than faded. Opaque by default, in `main` with a `core` strip
   * along the edge and the edge inked.
   *
   * Cheap: each sample is posed once and kept for the rest of the trail's life, and the head is the pose the effects
   * were already asking of (`k.joint`) -- a posing a sixtieth of a second, however many frames. `key` names it, for
   * two trails off one cast. Only while the body is in a cast (its pose stops in a hold, and the trail shrinks away).
   */
  trail(b: Body = this.caster, o: Look & { secs?: number; inner?: number; outer?: number; key?: string; edge?: boolean } = {}): void {
    const fig = b.figure, cast = fig?.cast, timing = this.timing;
    if (!fig || !cast || !timing) return;
    const a = o.alpha ?? 1;
    if (a <= 0.01) return;
    const id = fig.gear?.weapon?.id, span = id ? weaponSpan(id) : null;
    const reach = span ? span.to : 0;
    const zIn = reach * clamp(o.inner ?? 0.4), zOut = reach * clamp(o.outer ?? 1);
    const back = Math.min(0.3, Math.max(TRAIL_STEP, o.secs ?? 0.12));
    const now = cast.t * timing.secs;
    // This cast's samples, kept by the step of the cast's own clock each was taken at.
    let mine = trails.get(this.state);
    if (!mine) trails.set(this.state, (mine = new Map()));
    const key = `${o.key ?? ''}|${zIn.toFixed(2)}|${zOut.toFixed(2)}`;
    let buf = mine.get(key);
    if (!buf) mine.set(key, (buf = new Map()));
    const first = Math.ceil((now - back) / TRAIL_STEP), last = Math.floor(now / TRAIL_STEP - 1e-6);
    for (const j of buf.keys()) if (j < first || j > last) buf.delete(j);
    const posed: FigurePose = { ...fig, facing: b.facing };
    const wants: Array<readonly [string, V3]> = [['weapon', [0, 0, zIn]], ['weapon', [0, 0, zOut]]];
    for (let j = Math.max(0, first); j <= last; j++) {
      if (buf.has(j)) continue;
      const got = figureJoints({ ...posed, cast: { ...cast, t: (j * TRAIL_STEP) / timing.secs } }, wants);
      buf.set(j, [got[0], got[1]]);
    }
    const inner: P3[] = [], outer: P3[] = [];
    const put = (i0: V3, o0: V3): void => {
      inner.push(this.local(b, i0[0], i0[1], i0[2]));
      outer.push(this.local(b, o0[0], o0[1], o0[2]));
    };
    for (const j of [...buf.keys()].sort((x, y) => x - y)) {
      const s = buf.get(j) as [V3, V3];
      put(s[0], s[1]);
    }
    // The head: the weapon where it is drawn now, the pose the effects already asked of.
    put(figureJoint(posed, 'weapon', [0, 0, zIn]), figureJoint(posed, 'weapon', [0, 0, zOut]));
    const n = outer.length;
    if (n < 2) return;
    // The inner edge narrowed toward the outer one down the trail: all of the band at the head, none of it at the tail.
    const xo: number[] = [], yo: number[] = [], xi: number[] = [], yi: number[] = [], xc: number[] = [], yc: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const ox = this.sx(outer[i]), oy = this.sy(outer[i]), ix = this.sx(inner[i]), iy = this.sy(inner[i]);
      xo.push(ox);
      yo.push(oy);
      xi.push(lerp(ox, ix, u));
      yi.push(lerp(oy, iy, u));
      xc.push(lerp(ox, ix, 0.3 * u));
      yc.push(lerp(oy, iy, 0.3 * u));
    }
    const main = o.main ?? this.pal.main, core = o.core ?? this.pal.core, ink = o.ink ?? this.pal.ink;
    const inkW = Math.max(0.8, 0.7 * this.zoom);
    let near = n - 1;
    for (let i = 0; i < n; i++) if (yo[i] > yo[near]) near = i;
    this.worldDraw(outer[near], (g) => {
      g.globalAlpha = clamp(a);
      const band = (x0: number[], y0: number[], x1: number[], y1: number[]): void => {
        g.beginPath();
        g.moveTo(x0[0], y0[0]);
        for (let i = 1; i < n; i++) g.lineTo(x0[i], y0[i]);
        for (let i = n - 1; i >= 0; i--) g.lineTo(x1[i], y1[i]);
        g.closePath();
      };
      band(xo, yo, xi, yi);
      g.fillStyle = main;
      g.fill();
      band(xo, yo, xc, yc);
      g.fillStyle = core;
      g.fill();
      if (o.edge !== false) {
        g.lineWidth = inkW;
        g.strokeStyle = ink;
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(xo[0], yo[0]);
        for (let i = 1; i < n; i++) g.lineTo(xo[i], yo[i]);
        g.stroke();
      }
    }, o.bias ?? 0);
    const gl = this.glowOf(o);
    if (gl > 0) {
      const pic = glowPicture(o.light ?? this.pal.light);
      if (pic) {
        const R = Math.max(5, 5 * this.zoom);
        this.out.glow.push((g) => {
          g.globalAlpha = clamp(a * gl * 0.35);
          for (let i = n - 1; i >= 0; i -= 2) g.drawImage(pic, xo[i] - R, yo[i] - R, 2 * R, 2 * R);
        });
      }
    }
  }

  /**
   * The creatures within `r` tiles of a point (the spot by default) that are anybody's to harm: wild ones, not a
   * companion, a beast on a deed or one in a pen -- yours or anybody else's. What an area harm (a ricochet, a fan of
   * blades, a judgment) should strike, where `bodiesWithin` is everybody standing there.
   */
  enemiesWithin(r: number, c: { x: number; y: number } = this.spot): Body[] {
    return this.bodiesWithin(r, c, ['creature']).filter((b) => !b.tame);
  }

  /**
   * What an area spell reached: the bodies the island said it did (`hit`), of the `kinds` asked, wherever they are now;
   * and where it did not say, everybody within `r` tiles of `c` as `bodiesWithin` finds them. A Rally's people, a
   * Sanctuary's skins, a Healing Circle's hurt.
   */
  reached(r: number, c: { x: number; y: number } = this.spot, kinds?: ReadonlyArray<Body['kind']>): Body[] {
    if (!this.hit) return this.bodiesWithin(r, c, kinds);
    return kinds ? this.hit.filter((b) => kinds.includes(b.kind)) : this.hit.slice();
  }

  /**
   * What an area harm struck: the creatures the island said it reached (a blow that landed, a fire that took, a flight,
   * a hold); and where it did not say, `enemiesWithin(r, c)`. A Firestorm's burns, a Panic's flights, a Judgment's marks.
   */
  struck(r: number, c: { x: number; y: number } = this.spot): Body[] {
    return this.hit ? this.hit.filter((b) => b.kind === 'creature') : this.enemiesWithin(r, c);
  }

  /** The island's word on one body: what it said of it, or nothing (not reached, or nothing said). */
  private toldOn(b: Body): Told['hit'][number] | undefined {
    const w = b.who;
    return w && this.told ? this.told.hit.find((h) => sameWho(h.who, w)) : undefined;
  }

  /**
   * Seconds what this cast left on `b` lasts, as the island said (a monster held for its own share of a hold, a
   * monster put to flight for a Panic's three seconds); `otherwise` where it did not say.
   */
  secsOn(b: Body, otherwise: number): number {
    return this.toldOn(b)?.secs ?? otherwise;
  }

  /** Whether the island said this cast reached `b`; `otherwise` where it said nothing at all. */
  reachedOn(b: Body, otherwise = true): boolean {
    return this.told ? !!this.toldOn(b) : otherwise;
  }

  /** Whether the island said this cast holds `b` still; `otherwise` where it said nothing at all. */
  heldOn(b: Body, otherwise = false): boolean {
    return this.told ? !!this.toldOn(b)?.held : otherwise;
  }

  /**
   * A line through points cut where it passes `b`: the runs of it behind the body (further from the viewer than
   * where the body stands, as the sort goes) and the runs in front, each cut exactly where it crosses. For a chain, a
   * braid, a tether that goes round or past somebody: record the back runs sorted behind the body and the front ones
   * in front of it (`polyline`'s and `ribbon`'s `around` do just that).
   */
  aroundBody(b: Body, pts: readonly P3[]): { back: P3[][]; front: P3[][]; backAt: Array<[number, number]>; frontAt: Array<[number, number]> } {
    const back: P3[][] = [], front: P3[][] = [], backAt: Array<[number, number]> = [], frontAt: Array<[number, number]> = [];
    const by = this.eye.worldToScreenY(b.x, b.y, this.ground(b.x, b.y));
    const d = (p: P3): number => this.eye.worldToScreenY(p.x, p.y, this.ground(p.x, p.y)) - by;
    const last = Math.max(1, pts.length - 1);
    // Each run, and where it starts and ends along the whole line as a share of its points (for a taper kept whole).
    let run: P3[] = [pts[0]], from = 0, was = d(pts[0]);
    const end = (inFront: boolean, to: number): void => {
      if (run.length < 2) return;
      (inFront ? front : back).push(run);
      (inFront ? frontAt : backAt).push([from / last, to / last]);
    };
    for (let i = 1; i < pts.length; i++) {
      const now = d(pts[i]);
      if ((was > 0) !== (now > 0)) {
        const u = was / (was - now), cut = mid3(pts[i - 1], pts[i], u);
        run.push(cut);
        end(was > 0, i - 1 + u);
        run = [cut];
        from = i - 1 + u;
      }
      run.push(pts[i]);
      was = now;
    }
    end(was > 0, last);
    return { back, front, backAt, frontAt };
  }

  /**
   * Everybody and everything standing within `r` tiles of a point (the spot by
   * default): people (you, others) and creatures, the caster among them when
   * inside; each body's `kind` and `who` tell which. What an area spell
   * covers: a skin on every ally in a ward, a mark on every creature a
   * judgment hits. `kinds` keeps only those kinds. Found afresh each frame (and
   * asked once a frame however often it is called with the same numbers). This
   * is who is there; who the island says a spell reached is `reached` and
   * `struck`, which come back to this where it said nothing.
   */
  bodiesWithin(r: number, c: { x: number; y: number } = this.spot, kinds?: ReadonlyArray<Body['kind']>): Body[] {
    const all = this.near?.(c.x, c.y, r) ?? [];
    const out: Body[] = [];
    for (const b of all) {
      if (Math.hypot(b.x - c.x, b.y - c.y) > r) continue;
      if (kinds && !kinds.includes(b.kind)) continue;
      out.push(b);
    }
    return out;
  }

  /**
   * How far, in tiles, a stroke drawn straight on the screen from one point
   * of the ground to another strays from the ground between them: over a
   * hill or a hollow the straight line is not over the line on the ground. A
   * mark's `keep` adds it to its reach, so a long stroke across uneven ground
   * is not cut where it passes over tiles its own segment does not cross.
   */
  chordSlack(ax: number, ay: number, bx: number, by: number, samples = 3): number {
    const ha = this.ground(ax, ay), hb = this.ground(bx, by);
    let most = 0;
    for (let i = 1; i <= samples; i++) {
      const u = i / (samples + 1);
      most = Math.max(most, Math.abs(this.ground(lerp(ax, bx, u), lerp(ay, by, u)) - lerp(ha, hb, u)));
    }
    return most * TILES_A_UNIT;
  }

  /* ---- recording ------------------------------------------------------------------ */

  /**
   * Something drawn on the ground round (x, y), within `r` tiles of it. Draw in screen pixels with `this` for projecting.
   * `keep(tx, ty, reach)`, when given, is whether it draws anything within `reach` tiles of (tx, ty) (see `GroundRec`):
   * ground it says no to is not laid at all, so a big mark that covers little of its square (a ring, lines) costs only
   * what it covers. `nearSegments` is one for lines.
   */
  groundDraw(x: number, y: number, r: number, draw: (g: CanvasRenderingContext2D) => void, keep?: (x: number, y: number, reach: number) => boolean): void {
    this.out.ground.push({ x0: x - r, y0: y - r, x1: x + r, y1: y + r, draw, keep });
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
    if (strength <= 0.01) return;
    // Counted asked for, so a cast over its two shows as over (`SpellStage.over`), and refused past them.
    if (this.lightsLeft-- <= 0 || this.out.lights.length >= MOST_LIGHTS) return;
    this.out.lights.push({ x: p.x, y: p.y, radius, strength: clamp(strength), cast: channelsOf(colour), castAlpha: 0.32 * clamp(strength), soft: true });
  }

  /* ---- glow -------------------------------------------------------------------------- */

  /**
   * A soft glow round a point, `r` pixels at zoom one, in the palette's light unless told. Added to what is under it,
   * as light is; `over` lays it over instead, in its own colour, for a warm one (gold, brass, blood) that added over
   * grass goes lime -- still after the night, so it still shows in the dark.
   */
  glow(p: P3, r: number, alpha = 1, colour = this.pal.light, over = false): void {
    if (alpha <= 0.01 || r <= 0) return;
    const pic = glowPicture(colour);
    if (!pic) return;
    const x = this.sx(p), y = this.sy(p), R = r * this.zoom;
    this.out.glow.push((g) => {
      g.globalAlpha = clamp(alpha);
      if (over) g.globalCompositeOperation = 'source-over';
      g.drawImage(pic, x - R, y - R, 2 * R, 2 * R);
      if (over) g.globalCompositeOperation = 'lighter';
    });
  }
  /**
   * A four-pointed glint: the moment something lands, or a star. `r` pixels at zoom one; `colour` the glint's own
   * (the palette's core), `light` the glow round it (the palette's light), as `Look.light` is for the other shapes;
   * `over` lays both over rather than adding them (see `glow`), for a gold or brass glint that has to stay gold.
   */
  flare(p: P3, r: number, alpha = 1, colour = this.pal.core, turn = 0, light = this.pal.light, over = false): void {
    if (alpha <= 0.01 || r <= 0) return;
    const x = this.sx(p), y = this.sy(p), R = r * this.zoom, w = R * 0.16;
    this.out.glow.push((g) => {
      g.globalAlpha = clamp(alpha);
      if (over) g.globalCompositeOperation = 'source-over';
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
      if (over) g.globalCompositeOperation = 'lighter';
    });
    this.glow(p, r * 0.7, alpha * 0.6, light, over);
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
  /** Points round a circle on the ground, in tiles: x, y a point. */
  private circle(cx: number, cy: number, r: number, n: number, turn: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = turn + (i / n) * TAU;
      out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return out;
  }
  /** Facets round a circle: fewer far off and on fast graphics, never fewer than a hexagon. */
  facets(rTiles: number, most = 48): number {
    const n = Math.round(10 + rTiles * 7 * Math.min(2, this.zoom));
    // On fast graphics fewer, but a big ring still round: a few more for every tile out.
    return Math.max(6, Math.min(this.fast ? Math.min(most, 18 + Math.round(rTiles * 3)) : most, n));
  }
  /**
   * How many times over to cut each of `n` facets round a circle `rTiles` across for it to look round on the screen:
   * a facet's side no longer than `FACET_PX` pixels, so a ring or a shock wave looked at close (zoom three or four)
   * is not a polygon, while at the sizes the island is played at the count is the old one. Once on fast graphics.
   */
  finer(rTiles: number, n: number): number {
    if (this.fast || n <= 0) return 1;
    return Math.max(1, Math.min(FINER_MOST, Math.ceil((TAU * rTiles * HALF_W * this.zoom) / (FACET_PX * n))));
  }
  /**
   * Facets for a circle of your own `rTiles` across that looks round at this zoom (`facets` cut finer as `finer` says,
   * `most` as for `facets`): for a ring, a tick ring or a measure drawn with `groundShape`.
   */
  roundFacets(rTiles: number, most = 48): number {
    const n = this.facets(rTiles, most);
    return n * this.finer(rTiles, n);
  }

  /**
   * Something laid on the ground as shapes on the island rather than strokes
   * on the screen (`GroundLayer`): polygons filled and lines stroked, each
   * point a place on the ground, in tiles. The stage cuts them along the
   * edges of the tiles and lays each piece with its own line of the ground,
   * with no clip -- which is why the kit's own marks on the ground cost what
   * they cover however big they are. `r` tiles round (x, y) holds all of it.
   * `keep` (as `groundDraw`'s) is for when it has to be drawn whole after all:
   * laid between records drawn with `groundDraw`, it goes into their layer to
   * keep its place among them, and is cut from there only where it says.
   */
  groundShape(x: number, y: number, r: number, layers: GroundLayer[], keep?: (x: number, y: number, reach: number) => boolean): void {
    const eye = this.eye, ground = this.ground;
    this.out.ground.push({ x0: x - r, y0: y - r, x1: x + r, y1: y + r, shape: layers, keep, draw: (g) => drawGroundLayers(g, layers, eye, ground) });
    // Whatever of it is to glow, again over the night: the same paths in the light's colour, lines widened.
    for (const l of layers) {
      const gl = l.glow ?? 0;
      if (gl <= 0 || !l.paths.length || l.alpha <= 0.01) continue;
      const lit: GroundLayer = { ...l, colour: l.light ?? this.pal.light, alpha: clamp(l.alpha * gl * 0.45), width: (l.width ?? 1) * 3, join: 'round', cap: 'round' };
      this.out.glow.push((g) => drawGroundLayers(g, [lit], eye, ground));
    }
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
    // Each facet cut finer as the ring is drawn larger on the screen (`finer`), so close up it stays round; dashes and the
    // glow along it go by the facets as they were.
    const n0 = o.n ?? this.facets(r), sub = o.n ? 1 : this.finer(r, n0), n = n0 * sub;
    const main = o.main ?? this.pal.main, deep = o.deep ?? this.pal.deep, ink = o.ink ?? this.pal.ink;
    const turn = o.turn ?? 0;
    const outer: number[] = [], inner: number[] = [];
    this.around(c.x, c.y, r, n, turn, 0.15, outer);
    this.around(c.x, c.y, r - band, n, turn, 0.15, inner);
    const wo = this.circle(c.x, c.y, r, n, turn), wi = this.circle(c.x, c.y, r - band, n, turn);
    const dash = o.dash ?? 0;
    const inkW = Math.max(0.8, 0.7 * this.zoom);
    // The facets in two tones, the near half of the band lit and the far half shaded -- a hoop lying on the ground --
    // each a quad on the ground, and the rim round the outside.
    const lit: number[][] = [], shade: number[][] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (dash && Math.floor(i / sub) % dash === dash - 1) continue;
      const into = outer[2 * i + 1] + outer[2 * j + 1] > inner[2 * i + 1] + inner[2 * j + 1] ? lit : shade;
      into.push([wo[2 * i], wo[2 * i + 1], wo[2 * j], wo[2 * j + 1], wi[2 * j], wi[2 * j + 1], wi[2 * i], wi[2 * i + 1]]);
    }
    // Drawn whole, its sides are straight on the screen, which over uneven ground stray off the circle on the ground by as
    // much as the ground bends under them; and its inner edge is a polygon, whose sides come in from the circle.
    let bend = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      bend = Math.max(bend, this.chordSlack(wo[2 * i], wo[2 * i + 1], wo[2 * j], wo[2 * j + 1], 1));
    }
    const cx = c.x, cy = c.y, rIn = (r - band) * Math.cos(Math.PI / n) - bend, rOut = r + bend;
    this.groundShape(c.x, c.y, r + 0.5, [
      { kind: 'fill', colour: main, alpha: clamp(a), paths: lit, lift: 0.15 },
      { kind: 'fill', colour: deep, alpha: clamp(a), paths: shade, lift: 0.15 },
      { kind: 'stroke', colour: ink, alpha: clamp(a), width: inkW, paths: [wo], closed: true, join: 'round', lift: 0.15 },
    ], (tx, ty, reach) => {
      const d = Math.hypot(tx - cx, ty - cy);
      return d >= rIn - reach && d <= rOut + reach;
    });
    const gl = this.glowOf(o);
    if (gl > 0) {
      const pic = glowPicture(o.light ?? this.pal.light);
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
    const n0 = o.n ?? this.facets(r, 32), n = o.n ? n0 : n0 * this.finer(r, n0);
    this.groundShape(c.x, c.y, r + 0.5, [
      { kind: 'fill', colour: o.main ?? this.pal.main, alpha: clamp(a), paths: [this.circle(c.x, c.y, r, n, o.turn ?? 0)], lift: 0.1 },
    ]);
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
    const drawn = clamp(grow * 1.4 - 0.4);
    if (drawn <= 0) return;
    const star: number[] = [];
    const ticks: number[][] = [];
    const inner = r * 0.76;
    for (let i = 0; i < points; i++) {
      const q = (i * step) % points;
      const ang = turn + (q / points) * TAU - Math.PI / 2;
      star.push(c.x + Math.cos(ang) * inner, c.y + Math.sin(ang) * inner);
      const ta = turn + (i / points) * TAU - Math.PI / 2;
      ticks.push([c.x + Math.cos(ta) * r * 0.8, c.y + Math.sin(ta) * r * 0.8, c.x + Math.cos(ta) * r * 0.98, c.y + Math.sin(ta) * r * 0.98]);
    }
    // The star drawn on stroke by stroke as it grows.
    const strokes = points * drawn;
    const path: number[] = [star[0], star[1]];
    for (let i = 1; i <= Math.ceil(strokes); i++) {
      const k = i % points, j = (i - 1) % points;
      const u = Math.min(1, strokes - (i - 1));
      path.push(lerp(star[2 * j], star[2 * k], u), lerp(star[2 * j + 1], star[2 * k + 1], u));
    }
    const main = o.core ?? this.pal.accent, ink = o.ink ?? this.pal.ink;
    const w = (o.width ?? 1.6) * this.zoom;
    // Its strokes as segments, each with how far it strays off the ground it crosses when drawn straight on the screen.
    const lines: number[] = [], slack: number[] = [];
    for (let i = 2; i < path.length; i += 2) {
      lines.push(path[i - 2], path[i - 1], path[i], path[i + 1]);
      slack.push(this.chordSlack(path[i - 2], path[i - 1], path[i], path[i + 1], 5));
    }
    for (const t of ticks) {
      lines.push(t[0], t[1], t[2], t[3]);
      slack.push(0);
    }
    this.groundShape(c.x, c.y, r + 0.5, [
      { kind: 'stroke', colour: ink, alpha: clamp(a), width: w + Math.max(1.2, this.zoom), paths: [path], join: 'miter', lift: 0.2 },
      { kind: 'stroke', colour: main, alpha: clamp(a), width: w, paths: [path], join: 'miter', lift: 0.2 },
      { kind: 'stroke', colour: main, alpha: clamp(a), width: w * 0.8, paths: ticks, join: 'miter', lift: 0.2 },
    ], (tx, ty, reach) => nearSegments(lines, tx, ty, reach, slack));
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
      pts.push(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr);
    }
    this.groundShape(c.x, c.y, r + 0.5, [{ kind: 'fill', colour: o.colour ?? '#1d1612', alpha: clamp(a), paths: [pts], lift: 0.08 }]);
  }

  /**
   * Lines on the ground through points, following the land over its hills: a
   * crack, a furrow, a rune's strokes, the spokes of a wheel. `width` pixels at
   * zoom one (1.6), inked underneath; `closed` joins the last point to the
   * first. `segs` adds separate stretches to the same record:
   * `[[a, b], [c, d], ...]`. Laid as shapes on the ground (`groundShape`), so
   * it follows the land and costs what it covers.
   */
  groundPath(pts: ReadonlyArray<{ x: number; y: number }>, o: Look & { closed?: boolean; lift?: number; segs?: ReadonlyArray<readonly [{ x: number; y: number }, { x: number; y: number }]> } = {}): void {
    const a = o.alpha ?? 1;
    if (a <= 0.01) return;
    const runs: number[][] = [];
    if (pts.length >= 2) {
      const run: number[] = [];
      for (const p of pts) run.push(p.x, p.y);
      if (o.closed) run.push(pts[0].x, pts[0].y);
      runs.push(run);
    }
    for (const [p0, p1] of o.segs ?? []) runs.push([p0.x, p0.y, p1.x, p1.y]);
    if (!runs.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const run of runs) {
      for (let i = 0; i < run.length; i += 2) {
        x0 = Math.min(x0, run[i]); y0 = Math.min(y0, run[i + 1]); x1 = Math.max(x1, run[i]); y1 = Math.max(y1, run[i + 1]);
      }
    }
    const lift = o.lift ?? 0.15;
    const main = o.main ?? this.pal.main, ink = o.ink ?? this.pal.ink;
    const w = (o.width ?? 1.6) * this.zoom;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const segs: number[] = [], slack: number[] = [];
    for (const run of runs) {
      for (let i = 2; i < run.length; i += 2) {
        segs.push(run[i - 2], run[i - 1], run[i], run[i + 1]);
        // Its own half-width, in tiles at the steepest a tile is drawn, and how far it strays when drawn whole.
        slack.push(((o.width ?? 1.6) + 1.5) / 68 + this.chordSlack(run[i - 2], run[i - 1], run[i], run[i + 1]));
      }
    }
    this.groundShape(cx, cy, Math.max(x1 - x0, y1 - y0) / 2 + 0.5, [
      { kind: 'stroke', colour: ink, alpha: clamp(a), width: w + Math.max(1.2, this.zoom), paths: runs, join: 'round', cap: 'round', lift },
      { kind: 'stroke', colour: main, alpha: clamp(a), width: w, paths: runs, join: 'round', cap: 'round', lift },
    ], (tx, ty, reach) => nearSegments(segs, tx, ty, reach, slack));
    const gl = o.glow ?? 0;
    if (gl > 0) {
      const light = o.light ?? this.pal.light;
      const eye = this.eye, ground = this.ground;
      this.out.glow.push((g) => {
        g.globalAlpha = clamp(a * gl * 0.4);
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.strokeStyle = light;
        g.lineWidth = w * 3;
        g.beginPath();
        for (const run of runs) {
          for (let i = 0; i < run.length; i += 2) {
            const sx = eye.worldToScreenX(run[i], run[i + 1]), sy = eye.worldToScreenY(run[i], run[i + 1], ground(run[i], run[i + 1]) + lift);
            if (i === 0) g.moveTo(sx, sy);
            else g.lineTo(sx, sy);
          }
        }
        g.stroke();
        g.lineCap = 'butt';
      });
    }
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
    const gl = this.glowOf(o);
    if (gl > 0) this.glow(p, r * 3.2, a * gl * 0.8, o.light);
  }

  /**
   * A ribbon through points in the world, `width` pixels at zoom one at its widest, tapering to nothing at the first
   * point (`taper` 'start', the default), the last ('end': a beam from an eye, a thrust running out to its point),
   * both, or neither: a trail, a slash, a wisp.
   */
  ribbon(pts: readonly P3[], o: Look & { taper?: 'start' | 'end' | 'both' | 'none'; edge?: boolean; around?: Body; sortAt?: P3; span?: readonly [number, number] } = {}): void {
    const n = pts.length;
    const a = o.alpha ?? 1;
    if (n < 2 || a <= 0.01) return;
    if (o.around) {
      // Cut where it passes the body, each piece tapered as its stretch of the whole was.
      const { back, front, backAt, frontAt } = this.aroundBody(o.around, pts);
      const foot = { x: o.around.x, y: o.around.y, z: o.around.z };
      back.forEach((run, i) => this.ribbon(run, { ...o, around: undefined, sortAt: foot, span: backAt[i], bias: (o.bias ?? 0) - 0.5 }));
      front.forEach((run, i) => this.ribbon(run, { ...o, around: undefined, sortAt: foot, span: frontAt[i], bias: (o.bias ?? 0) + 0.5 }));
      return;
    }
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
      const u = o.span ? lerp(o.span[0], o.span[1], i / (n - 1)) : i / (n - 1);
      const w = (W / 2) * (taper === 'none' ? 1 : taper === 'both' ? Math.sin(Math.PI * u) : taper === 'end' ? 1 - u : u);
      left.push(xs[i] - dy * w, ys[i] + dx * w);
      right.push(xs[i] + dy * w, ys[i] - dx * w);
    }
    const main = o.main ?? this.pal.main, core = o.core ?? this.pal.core, ink = o.ink ?? this.pal.ink;
    const inkW = Math.max(0.8, 0.7 * this.zoom);
    // Sorted with its nearest end, so it passes in front of what is behind both ends.
    const near = o.sortAt ?? pts[ys.indexOf(Math.max(...ys))] ?? pts[n - 1];
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
    const gl = this.glowOf(o);
    if (gl > 0) {
      const pic = glowPicture(o.light ?? this.pal.light);
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
    const gl = this.glowOf(o);
    if (gl > 0) {
      const light = o.light ?? this.pal.light;
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
  shell(b: Body, o: Look & { size?: number; turn?: number; sides?: number; back?: number; lit?: boolean; rim?: number; tall?: number } = {}): void {
    const a = o.alpha ?? 0.6;
    if (a <= 0.01) return;
    const size = o.size ?? 1;
    const c = this.at(b, 0.5);
    const x = this.sx(c), y = this.sy(c);
    const ry = b.tall * HEIGHT_SCALE * this.zoom * 0.62 * size * (o.tall ?? 1);
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
    // The facets gathered into a path a tone, made once here, so the shell is three fills and a stroke however many sides
    // it has rather than a fill a facet: it is the shape most often left on for a whole linger, on several bodies at once.
    const back0 = new Path2D(), back1 = new Path2D(), lit = new Path2D(), rim = new Path2D();
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const into = i % 2 ? back1 : back0;
      into.moveTo(x, y - ry * 0.15);
      into.lineTo(ptsX[i], ptsY[i]);
      into.lineTo(ptsX[j], ptsY[j]);
      into.closePath();
      if (i === 0) rim.moveTo(ptsX[0], ptsY[0]);
      else rim.lineTo(ptsX[i], ptsY[i]);
      const mx = (ptsX[i] + ptsX[j]) / 2 - x, my = (ptsY[i] + ptsY[j]) / 2 - y;
      if (o.lit === false || -0.6 * mx / rx - 0.8 * my / ry < 0.45) continue;
      lit.moveTo(lerp(x, ptsX[i], 0.82), lerp(y, ptsY[i], 0.82));
      lit.lineTo(ptsX[i], ptsY[i]);
      lit.lineTo(ptsX[j], ptsY[j]);
      lit.lineTo(lerp(x, ptsX[j], 0.82), lerp(y, ptsY[j], 0.82));
      lit.closePath();
    }
    rim.lineTo(ptsX[0], ptsY[0]);
    // Behind: the whole of it, faint, its facets in two tones.
    const back = o.back ?? 0.45;
    if (back > 0) this.worldDraw(foot, (g) => {
      g.globalAlpha = clamp(a * back);
      g.fillStyle = deep;
      g.fill(back0);
      g.fillStyle = main;
      g.fill(back1);
    }, -0.3);
    // In front: the rim, and the facets the light catches.
    this.worldDraw(foot, (g) => {
      g.globalAlpha = clamp(a);
      g.lineWidth = Math.max(0.9, (o.rim ?? 0.8) * this.zoom);
      g.strokeStyle = ink;
      g.stroke(rim);
      g.globalAlpha = clamp(a * 0.55);
      g.fillStyle = core;
      g.fill(lit);
    }, 0.6);
    const gl = this.glowOf(o);
    if (gl > 0) this.glow(c, (ry / this.zoom) * 1.1, a * gl * 0.35, o.light);
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
    const gl = this.glowOf(o);
    if (gl > 0) {
      this.glow(foot, (o.r ?? 8) * 2.6, a * gl * 0.6, o.light);
      this.glow(this.on(c.x, c.y, (o.h ?? 40) * 0.35), (o.r ?? 8) * 2.2, a * gl * 0.4, o.light);
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
    if ((o.glow ?? 1) > 0) this.glow(this.on(c.x, c.y, h * 0.4), 10 + h, a * (o.glow ?? 1) * 0.35, o.light);
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
    if ((o.glow ?? 1) > 0) this.glow(p, (o.r ?? 5) * 2.6, a * (o.glow ?? 1) * 0.5, o.light);
  }

  /**
   * A thin inked line through points in the world: a bowstring, a tether, a
   * thread of a binding, a crack of light over a body. `width` pixels at zoom
   * one (1.2), its ink round it; `closed` joins the last point to the first.
   * Sorted with its nearest point, as a ribbon is. No glow unless `glow` is
   * given.
   */
  polyline(pts: readonly P3[], o: Look & { closed?: boolean; around?: Body; sortAt?: P3 } = {}): void {
    const n = pts.length;
    const a = o.alpha ?? 1;
    if (n < 2 || a <= 0.01) return;
    if (o.around) {
      const { back, front } = this.aroundBody(o.around, o.closed ? [...pts, pts[0]] : pts);
      const foot = { x: o.around.x, y: o.around.y, z: o.around.z };
      for (const run of back) this.polyline(run, { ...o, closed: false, around: undefined, sortAt: foot, bias: (o.bias ?? 0) - 0.5 });
      for (const run of front) this.polyline(run, { ...o, closed: false, around: undefined, sortAt: foot, bias: (o.bias ?? 0) + 0.5 });
      return;
    }
    const path = new Path2D();
    let near = pts[0], nearY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = this.sx(pts[i]), y = this.sy(pts[i]);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
      // The nearest by where it stands on the ground, as the sort itself goes.
      const gy = this.eye.worldToScreenY(pts[i].x, pts[i].y, this.ground(pts[i].x, pts[i].y));
      if (gy > nearY) {
        nearY = gy;
        near = pts[i];
      }
    }
    if (o.closed) path.closePath();
    const W = (o.width ?? 1.2) * this.zoom;
    const main = o.main ?? this.pal.main, ink = o.ink ?? this.pal.ink;
    this.worldDraw(o.sortAt ?? near, (g) => {
      g.globalAlpha = clamp(a);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.strokeStyle = ink;
      g.lineWidth = W + Math.max(1, 0.8 * this.zoom);
      g.stroke(path);
      g.strokeStyle = main;
      g.lineWidth = W;
      g.stroke(path);
      g.lineCap = 'butt';
    }, o.bias ?? 0);
    const gl = o.glow ?? 0;
    if (gl > 0) {
      const light = o.light ?? this.pal.light;
      this.out.glow.push((g) => {
        g.globalAlpha = clamp(a * gl * 0.5);
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.strokeStyle = light;
        g.lineWidth = W * 4;
        g.stroke(path);
        g.lineCap = 'butt';
      });
    }
  }

  /**
   * A string from one point to another, sagging `sag` height units at its
   * middle (a negative sag bows it up; nought is taut), cut into `n` (8)
   * stretches: a bowstring drawn to the hand, a tether to a companion, a leash
   * of force. A `polyline`, so it takes the same look.
   */
  string(a: P3, b: P3, o: Look & { sag?: number; n?: number } = {}): void {
    const sag = o.sag ?? 0;
    const n = Math.max(1, Math.round(o.n ?? (sag ? 8 : 1)));
    const pts: P3[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      pts.push({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) - 4 * sag * u * (1 - u) });
    }
    this.polyline(pts, o);
  }

  /**
   * Many small polygons as one thing standing in the world, sorted together at
   * `at` (`bias` pixels nearer): a crown of shards, a scatter of petals, a
   * cage of bars, a rune built of facets -- one record however many pieces,
   * where a call each would be a record each. Each piece is filled and inked
   * as it says (`ShapePiece`), in the order given, so put the far ones first.
   */
  shapes(at: P3, pieces: readonly ShapePiece[], o: Look = {}): void {
    const a = o.alpha ?? 1;
    if (a <= 0.01 || !pieces.length) return;
    const main = o.main ?? this.pal.main, ink = o.ink ?? this.pal.ink;
    const inkW = Math.max(0.8, 0.7 * this.zoom);
    const drawn: Array<{ path: Path2D; fill: string | false; ink: string | false; width: number; alpha: number; closed: boolean }> = [];
    for (const piece of pieces) {
      if (piece.pts.length < 2) continue;
      const path = new Path2D();
      for (let i = 0; i < piece.pts.length; i++) {
        const x = this.sx(piece.pts[i]), y = this.sy(piece.pts[i]);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      const closed = piece.closed !== false;
      if (closed) path.closePath();
      drawn.push({
        path, closed, fill: closed ? (piece.fill === undefined ? main : piece.fill) : false, ink: piece.ink === undefined ? ink : piece.ink,
        width: piece.width !== undefined ? piece.width * this.zoom : inkW, alpha: clamp(a * (piece.alpha ?? 1)),
      });
    }
    this.worldDraw(at, (g) => {
      g.lineJoin = 'miter';
      for (const d of drawn) {
        g.globalAlpha = d.alpha;
        if (d.fill) {
          g.fillStyle = d.fill;
          g.fill(d.path);
        }
        if (d.ink) {
          g.strokeStyle = d.ink;
          g.lineWidth = d.width;
          g.stroke(d.path);
        }
      }
      g.lineJoin = 'round';
    }, o.bias ?? 0);
    const gl = o.glow ?? 0;
    if (gl > 0) this.glow(at, 12, a * gl * 0.5, o.light);
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
    // A mote off a heal is the heal's cross, as it always was there (`ParticleKind`).
    const kind = o.kind === 'mote' && this.healing ? KIND_NO.heal : KIND_NO[o.kind ?? 'spark'];
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
      ps.size1[s] = o.sizeEnd ?? (kind === 3 || kind === 4 || kind === 7 ? ps.size[s] * 2.6 : ps.size[s] * 0.3);
      ps.grav[s] = o.gravity ?? (kind === 3 || kind === 7 ? -6 : 30);
      ps.drag[s] = o.drag ?? 0.25;
      ps.spin[s] = (o.spin ?? 1.5) * (r() - 0.5) * 2;
      ps.bias[s] = o.bias ?? 0;
      ps.kind[s] = kind;
      ps.flags[s] = (o.over ? 1 : 0) | (o.ink === false ? 2 : 0);
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
    // A mote: a small round glint that comes and goes, a hexagon -- a speck of light, which says nothing of what it is.
    const tw = Math.max(0, Math.sin(u * Math.PI));
    g.globalAlpha = tw;
    g.fillStyle = colour;
    const s = Math.max(0.6, size) * 0.7;
    g.beginPath();
    for (let j = 0; j < 6; j++) {
      const an = (j / 6) * TAU;
      if (j === 0) g.moveTo(x + Math.cos(an) * s, y + Math.sin(an) * s);
      else g.lineTo(x + Math.cos(an) * s, y + Math.sin(an) * s);
    }
    g.closePath();
    g.fill();
    return;
  }
  if (k === 8) {
    // A heal: the cross, a glint that comes and goes -- health given back, and nothing else.
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
  if (k === 7) {
    // Mist: a soft round puff with no edge, opening out and thinning -- a breath, a vapour off a dressing, a healing
    // haze -- where smoke is a hard flat hexagon. Laid over, not added, so it is its own colour by day.
    const pic = glowPicture(colour.startsWith('#') ? colour : '#ffffff');
    if (!pic) return;
    g.globalAlpha = 0.5 * (1 - u) * Math.min(1, u * 6);
    const s = Math.max(1, size) * 1.8;
    g.drawImage(pic, x - s, y - s * 0.8, 2 * s, 1.6 * s);
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
    if (ps.flags[i] & 2) return;
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
