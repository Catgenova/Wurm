/**
 * Every spell on the screen, from the cast to the last of what it left.
 *
 * `play` starts one: who cast it and at what. Every frame `update` runs each
 * one's functions (`SpellVisual.fx`) against an `FxScene` -- the caster and
 * the target where they are this frame, followed wherever they walk -- and
 * what they record is laid out (`layout`) and drawn in the renderer's passes:
 * the ground a line at a time (`groundLine`), what stands in the world sorted
 * in with everything else standing there (`itemsAt`, `drawItem`), light over
 * the night (`glowPass`), the screen last (`screenPass`). Lights for the night
 * are in `lights`, which `Game.lights` hands on with its own.
 *
 * A cast ends when its pose, its impact and its lingering are all over; what
 * it lingers on going away (a creature killed, a person gone) ends it then,
 * unless it lingers on the caster or the spot (`linger.on`).
 * What the island said the cast did comes with it (`PlayOpts.told`): its
 * linger on what it was cast at lasts the seconds the island gave that (a
 * monster's shorter hold), a waiting spell the island says a later cast spent
 * ends its linger then (`used`), and what fires after it (`fired`) is handed
 * to its linger. Without it, a linger lasts the spell's own seconds.
 *
 * Nothing here is the island's. A cast is drawn when the island said yes to
 * it, on this browser and on everybody else's watching (`Island.castSeen`).
 */
import { FIGURE_TOP, figureJoint, weaponSpan, type FigurePose } from '../figure';
import { HALF_H, HALF_W, HEIGHT_SCALE, TILE_W, UNITS_PER_TILE } from '../iso';
import { depthOf, type View } from '../view';
import { castLefty, lingerSecs, visualOf, type CastAim, type CastClose, type CastNow, type CastTarget, type CastTravel, type SpellVisual } from './index';
import { spellInfo, type SpellInfo } from './info';
import { clamp, drawParticle, fallGradient, FxFrame, FxScene, isLightKind, lightHole, lightHue, lightTint, MOST_PARTICLES, paintGroundLayer, Particles, rngOf, sameWho, seg, smooth, USED_FADE, type Body, type Eye, type GroundLayer, type LightRec, type P3, type Told, type Who, type WorldRec } from './kit';

export type { Told, Who };
/** What a spell was cast at: somebody, a spot on the ground, or the caster themselves. */
export type Aim = Who | { kind: 'spot'; x: number; y: number } | { kind: 'self' };

/** How the stage finds things in the world: the renderer's answers, or the preview's. */
export interface Where {
  /** Where somebody is this frame, or nothing when they are gone. */
  body(w: Who): Body | null;
  /** The ground's height, in height units. */
  ground(x: number, y: number): number;
  /** Turn somebody to face a point, as a cast begins. */
  turn?(w: Who, x: number, y: number): void;
  /** What follows somebody, for a Beastmaster's spells: your own; somebody else's comes with their cast (`play`'s `companion`). */
  companion?(w: Who): Body | null;
  /** Everybody and everything standing within `r` tiles of a point, each with its `who`, for `FxScene.bodiesWithin`. */
  near?(x: number, y: number, r: number): Body[];
}

/** What else a cast is played with: whose it is, when, whose companion, and where the caster stood before the island moved them. */
export interface PlayOpts {
  /** Your own cast, which alone may tint the screen. */
  mine?: boolean;
  /** Seconds on the drawing clock it starts at; now when not given. */
  now?: number;
  /** The creature the caster's companion is, when the cast says (somebody else's, over the broadcast). */
  companion?: number;
  /** Where the caster stood before a move the island made for this cast (a Lunge), to be carried from. */
  from?: { x: number; y: number };
  /**
   * Where the creature it was cast at stood before the cast, for a spell the island moves it with (a Hook): with
   * `cast.pull`, the creature is drawn carried from there to wherever the island put it. Where it stood as the cast
   * began when not given.
   */
  targetFrom?: { x: number; y: number };
  /** Where the caster's companion stood before the cast, for a spell the island moves it with (`cast.companion`); where it stood as the cast began when not given. */
  companionFrom?: { x: number; y: number };
  /** What the island said the cast did (`Told`), for its effects to follow; left out, they draw from what stands near. */
  told?: Told;
}

/** How far ahead of the feet a standing blow lands with nothing in the hand, in height units; a weapon's length is added to it (`cast.close`). */
const CLOSE_ARM = 6;
/** The furthest a melee cast closes in by default, in tiles (`CastClose.most`). */
const CLOSE_MOST = 2;
/** Seconds the trip back of a closing cast runs on past the cast's end, by default: a quarter of a second and this much a tile (`CastClose.after`), between the two below. */
const BACK_BASE = 0.25, BACK_TILE = 0.15, BACK_LEAST = 0.4, BACK_MOST = 0.6;
/** Nearer its master than this, in tiles, a companion is drawn beside them rather than in them (`cast.companion`). */
const BESIDE = 0.35;
/**
 * How far over to a light's own colour the ground it falls on is laid at its middle, at night, for each of its strength
 * (`lightHueAt`), and at the most, for a light of up to `LIGHT_FULL` tiles: a light of half strength (a cast's impact)
 * lays a little over half its colour. A wider one lays less (`lightHue`).
 */
const LIGHT_COLOUR = 1.2, LIGHT_COLOUR_MOST = 0.75;
/**
 * About how much of the ground the night's wash covers at the dead of night (`skyWash`: the island's 0.68, the
 * preview's 0.62). The colour is laid on the ground under the wash, so it is laid that much stronger where the wash
 * still covers it, to come out through it as strong as it would laid over the wash.
 */
const NIGHT_WASH = 0.65;
/** Shapes a cast may record in a frame (SPELLS.md's budget), past which the preview says so. */
const SHAPES_MOST = 15;

/** The most casts kept going at once; past it, the oldest one that has finished casting goes. */
const MOST_PLAYING = 32;
/** A cast whose caster cannot be found for this long is let go. */
const LOST_FOR = 2;

interface Playing {
  id: string;
  vis: SpellVisual;
  info: SpellInfo | undefined;
  by: Who;
  at: Aim;
  mine: boolean;
  start: number;
  seed: number;
  released: boolean;
  landed: boolean;
  /** Seconds along the pose (its own clock, which stops through a hold) when it lets go. */
  release: number;
  /** Seconds from the start: when it let go, when it lands, when everything is over. */
  releasedAt: number;
  arrive: number;
  end: number;
  lingers: number;
  caster: Body | null;
  target: Body | null;
  spot: P3;
  lostAt: number;
  state: Record<string, number>;
  /** What it went at, as the pose is told it. */
  aimed: CastTarget;
  /** The companion's creature, when the cast came with one. */
  companion: Who | null;
  /** A held pose: seconds along the pose it is held at, and seconds from the start the hold ends (sooner if the caster walks off). */
  holdAt: number;
  holdEnd: number;
  /** For a move the island made: where the caster stood, and how far that was from where they were put, in tiles. */
  from: P3 | null;
  shiftX: number;
  shiftY: number;
  /** Where the target stood from the caster last frame, for the pose (`CastAim`); and whether it was played left-handed. */
  aim: CastAim | null;
  lefty: boolean;
  /** How far the body is drawn closed in on the target this frame (`cast.close`), in tiles. */
  closeX: number;
  closeY: number;
  /**
   * The close as it was asked for up to the blow (`cast.close`, its `when` asked of the caster's weapon), how far it carries
   * the body in height units and which way over the ground, all kept from the blow on; the legs' steps this frame; and
   * seconds from the start the trip back ends, past the cast's own end (nought for none).
   */
  close: CastClose | null;
  closeBy: number;
  closeDX: number;
  closeDY: number;
  travel: CastTravel | undefined;
  closeEnd: number;
  /** Where the target stood as the cast was made (`cast.pull`), and how far off where it is it is drawn this frame, in tiles. */
  targetFrom: { x: number; y: number } | null;
  pullX: number;
  pullY: number;
  /** Where the companion stood as the cast was made (`cast.companion`), and how far off where it is it is drawn this frame. */
  petFrom: { x: number; y: number } | null;
  petX: number;
  petY: number;
  /** The companion as found last frame, for the pose (`PoseCue.companion`). */
  pet: Body | null;
  /** What the island said it did, or null (`PlayOpts.told`). */
  told: Told | null;
  /** Seconds from the start the island said the waiting spell it shows was spent (`Told.used`); minus one while it waits. */
  usedT: number;
  /** What the island said fired after it (`fired`): on whom, seconds from the start, how large. */
  fires: Array<{ on: Who | null; t: number; size?: number }>;
}

/**
 * A piece of a line's share of the ground, to clip what lies on it to: the
 * corners of its quads on the screen (four corners, eight numbers, a quad),
 * the box round them in the screen's own pixels, and the path once made.
 */
interface Piece {
  pts: number[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  path: Path2D | null;
}

/** One thing on a line's ground: a layer of a shape and its pieces on this line, or a run of drawn records and its clips here. */
interface GroundItem {
  layer: GroundLayer | null;
  path: Path2D | null;
  run: number;
  pieces: Piece[] | null;
  recs: number[] | null;
}

/** The layer a run of drawn records is drawn into, and the part of it drawn on last frame. */
interface RunLayer {
  canvas: HTMLCanvasElement | null;
  dirty: [number, number, number, number] | null;
}

/** A polygon (x, y pairs, in tiles) cut to the tile at (tx, ty): what of it lies in that tile, by its four edges in turn. */
function clipToTile(poly: readonly number[], tx: number, ty: number): number[] {
  let pts: number[] = poly as number[];
  for (let e = 0; e < 4 && pts.length >= 6; e++) {
    const axis = e & 1, edge = e < 2 ? (axis ? ty : tx) : (axis ? ty + 1 : tx + 1), keepAbove = e < 2;
    const out: number[] = [];
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * j], by = pts[2 * j + 1];
      const av = axis ? ay : ax, bv = axis ? by : bx;
      const ain = keepAbove ? av >= edge : av <= edge, bin = keepAbove ? bv >= edge : bv <= edge;
      if (ain) out.push(ax, ay);
      if (ain !== bin) {
        const u = (edge - av) / (bv - av);
        out.push(ax + (bx - ax) * u, ay + (by - ay) * u);
      }
    }
    pts = out;
  }
  return pts;
}


/** Seconds along a cast's pose `e` seconds after it began: the wall's own seconds, but for the stop through a hold. */
function poseClock(p: Playing, e: number): number {
  if (e <= p.holdAt) return e;
  return e < p.holdEnd ? p.holdAt : p.holdAt + (e - p.holdEnd);
}
/** Seconds from the start a cast's pose is over: its own seconds, and however long it is held. */
const poseEnd = (p: Playing): number => p.vis.cast.timing.secs + (p.holdEnd > p.holdAt ? p.holdEnd - p.holdAt : 0);
/** Seconds a cast lingers from where it lands: its own, cut short by the island's word that what it shows was spent. */
const lingersOf = (p: Playing): number => (p.usedT >= 0 ? Math.min(p.lingers, Math.max(0, p.usedT - p.arrive) + USED_FADE) : p.lingers);
/** Seconds from the start everything a cast does after it lands is over: its impact and its linger. */
const endOf = (p: Playing): number => Math.max(p.arrive + (p.vis.fx.impact?.secs ?? 0), p.arrive + lingersOf(p));
/** A key for somebody, for what the stage keeps about them between casts. */
const whoKey = (w: Who): string => (w.kind === 'player' ? 'p' : `${w.kind === 'peer' ? 'q' : 'c'}${w.id}`);
/** How far through its hold a cast is at `e`, nought to one. */
const heldShare = (p: Playing, e: number): number => (p.holdEnd > p.holdAt ? clamp((e - p.holdAt) / (p.holdEnd - p.holdAt)) : e > p.holdAt ? 1 : 0);

export class SpellStage {
  private playing: Playing[] = [];
  readonly out = new FxFrame();
  readonly parts = new Particles(MOST_PARTICLES);
  private readonly k = new FxScene();
  private now = 0;
  /** How dark it is this frame, nought by day to one at the dead of night (`update`'s `night`). */
  private night = 0;
  private eye: Eye | null = null;
  private seeds = 1;
  /** Lines of the ground to what stands on them this frame, and the clip of each line's tiles for what lies on them. */
  private lines = new Map<number, WorldRec[]>();
  private spare: WorldRec[][] = [];
  /** What lies on each line's ground, in the order it was recorded: a shape's pieces in one of its layers, or a run of drawn records' clips. */
  private groundItems = new Map<number, GroundItem[]>();
  /**
   * How drawn records (`groundDraw`, not the kit's shapes) are put down a line
   * at a time. 'layer': a run of them drawn once a frame into a layer of its
   * own, and copied out of it under each line's clip. 'vector': each drawn
   * again under each line's clip, kept to measure against.
   */
  static groundMode: 'layer' | 'vector' = 'layer';
  /**
   * Pixels of clip a piece of ground more is worth: a clip and a copy of their
   * own cost about what clipping this many more pixels does (measured in
   * Chromium's own canvas), so two pieces whose box together is no more than
   * this bigger than their two boxes are drawn as one.
   */
  static pieceWorth = 30000;
  /** The most cells a side a tile is cut into for what lies on it (see `clipRun`). */
  static cellsMost = 6;
  /** Bodies near a point asked for this frame, by the point and the reach. */
  private nearby = new Map<string, Body[]>();
  /** A layer for each run of drawn records, kept from frame to frame, with the part drawn on last, which is all that needs clearing. */
  private runLayers: RunLayer[] = [];
  /** Joints asked for this frame, by body and bone. */
  private joints = new Map<string, P3>();
  /** Creatures the island said a cast holds still (`Told.held`), to when on the drawing clock: `Body.held` for every cast. */
  private holds = new Map<string, number>();
  /**
   * The spells' lights' colour on the ground at night (`layLight`), made once a frame: for each line, each light's
   * share of its tiles and the light's gradient, to fill it with as a colour under what stands there (`groundLine`).
   */
  private lightLines = new Map<number, Array<{ path: Path2D; fill: CanvasGradient }>>();
  /** The tiles a light falls on, by line: each tile's corners on the screen, left, top, right and bottom. */
  private lightTiles = new Map<number, number[][]>();

  constructor(private readonly where: Where) {
    this.k.parts = this.parts;
    this.k.out = this.out;
    this.k.ground = (x, y) => this.where.ground(x, y);
    this.k.jointOf = (b, bone, at) => this.jointOf(b, bone, at);
    this.k.near = (x, y, r) => this.near(x, y, r);
  }

  /** Lights for the night this frame. */
  get lights(): FxFrame['lights'] {
    return this.out.lights;
  }

  /** How many casts are going, for a footer or a test. */
  get count(): number {
    return this.playing.length;
  }

  /**
   * Start a cast: `by` casting `spell` at `at`. False when the spell has no
   * visual, or the caster is not to be found. `mine` is your own cast, which
   * alone may tint the screen; `companion` the caster's companion when the
   * cast came with one; `from` where the caster stood before a move the
   * island made for it.
   */
  play(spell: string, by: Who, at: Aim, opts: PlayOpts = {}): boolean {
    const vis = visualOf(spell);
    if (!vis) return false;
    const caster = this.bodyOf(by);
    if (!caster) return false;
    const now = opts.now ?? this.now;
    const info = spellInfo(spell);
    const target = this.targetOf(at, caster, null);
    const companion: Who | null = opts.companion !== undefined ? { kind: 'creature', id: opts.companion } : null;
    // Turned to face it first: a cast is aimed with the whole body -- at what it is cast at, or at the companion told to act.
    const face = vis.cast.face ?? 'target';
    const toward = face === 'none' ? null
      : face === 'companion' ? (companion ? this.bodyOf(companion) : this.where.companion?.(by) ?? null) ?? target : target;
    if (toward && toward !== caster && (Math.abs(toward.x - caster.x) > 0.05 || Math.abs(toward.y - caster.y) > 0.05)) this.where.turn?.(by, toward.x, toward.y);
    const timing = vis.cast.timing;
    const told = opts.told ?? null;
    let lingers = lingerSecs(vis, info);
    if (told) {
      // A linger on what it was cast at lasts what the island said it gave that: a monster's shorter hold, a burn made longer.
      const aimed = at.kind === 'self' ? by : at.kind === 'spot' ? null : at;
      const on = aimed && (vis.fx.linger?.on ?? 'target') === 'target' ? told.hit.find((h) => sameWho(h.who, aimed)) : undefined;
      if (on?.secs !== undefined && vis.fx.linger) lingers = on.secs;
      for (const h of told.hit) if (h.held && h.secs) this.holds.set(whoKey(h.who), Math.max(this.holds.get(whoKey(h.who)) ?? 0, now + h.secs));
      // And a waiting spell of the caster's it spent (a Stoke, a Thicken): that one's linger lets go now.
      for (const id of told.used ?? []) {
        for (let i = this.playing.length - 1; i >= 0; i--) {
          const q = this.playing[i];
          if (q.id === id && q.usedT < 0 && sameWho(q.by, by)) {
            q.usedT = now - q.start;
            break;
          }
        }
      }
    }
    const hold = vis.cast.hold;
    const holdAt = hold ? timing.secs * clamp(hold.at) : Infinity;
    const from = opts.from && Math.hypot(opts.from.x - caster.x, opts.from.y - caster.y) > 0.05
      ? { x: opts.from.x, y: opts.from.y, z: this.where.ground(opts.from.x, opts.from.y) } : null;
    const p: Playing = {
      id: spell, vis, info, by, at, mine: !!opts.mine, start: now, seed: (this.seeds = (this.seeds * 1103515245 + 12345) >>> 0) || 1,
      released: false, landed: false, release: timing.secs * timing.release, releasedAt: 0, arrive: Infinity, end: Infinity, lingers,
      caster, target, spot: { x: target?.x ?? caster.x, y: target?.y ?? caster.y, z: target?.z ?? caster.z }, lostAt: -1, state: {},
      aimed: at.kind === 'self' || (at.kind === 'player' && by.kind === 'player') ? 'self' : at.kind === 'spot' ? 'spot' : at.kind === 'creature' ? 'creature' : 'person',
      companion, holdAt, holdEnd: hold ? holdAt + Math.max(0, hold.secs ?? lingers) : Infinity,
      from, shiftX: from ? from.x - caster.x : 0, shiftY: from ? from.y - caster.y : 0, aim: null, lefty: false, closeX: 0, closeY: 0,
      close: null, closeBy: 0, closeDX: 0, closeDY: 0, travel: undefined, closeEnd: 0,
      targetFrom: vis.cast.pull && target && target !== caster && target.kind !== 'spot' ? opts.targetFrom ?? { x: target.x, y: target.y } : null, pullX: 0, pullY: 0,
      petFrom: null, petX: 0, petY: 0, pet: null, told, usedT: -1, fires: [],
    };
    if (vis.cast.companion) {
      const pet = companion ? this.bodyOf(companion) : this.where.companion?.(by) ?? null;
      if (pet) p.petFrom = opts.companionFrom ?? { x: pet.x, y: pet.y };
    }
    // A second cast by the same caster takes the body over from the first; the first's effects play on.
    this.playing.push(p);
    if (this.playing.length > MOST_PLAYING) {
      const old = this.playing.findIndex((q) => now - q.start > poseEnd(q));
      this.playing.splice(old >= 0 ? old : 0, 1);
    }
    return true;
  }

  /**
   * Something of a cast's that the island said fired after it (a Ward Link laying a skin back over somebody): handed to
   * the latest such cast of `by`'s still playing, for its linger to draw (`FxScene.fired`). False when none is.
   */
  fired(spell: string, by: Who, on: Who | null, size?: number): boolean {
    for (let i = this.playing.length - 1; i >= 0; i--) {
      const p = this.playing[i];
      if (p.id !== spell || !sameWho(p.by, by)) continue;
      p.fires.push({ on, t: this.now - p.start, ...(size !== undefined ? { size } : {}) });
      return true;
    }
    return false;
  }

  /** The cast somebody is part way through, for their figure (`FigurePose.cast`). */
  poseOf(w: Who): CastNow | undefined {
    for (let i = this.playing.length - 1; i >= 0; i--) {
      const p = this.playing[i];
      if (!sameWho(p.by, w)) continue;
      const e = this.now - p.start;
      // And on past it while it bounds back to where it stands (`cast.close`), for the legs to step it.
      if (e >= 0 && e < Math.max(poseEnd(p), p.travel ? p.closeEnd : 0)) return this.castNow(p, e);
    }
    return undefined;
  }

  /**
   * How far off where they stand somebody is drawn, in tiles, while a cast
   * carries them from where they stood before the island moved them (a
   * Lunge): the renderer adds it where it draws them. Nothing when no cast is.
   */
  shiftOf(w: Who): { x: number; y: number } | null {
    for (let i = this.playing.length - 1; i >= 0; i--) {
      const p = this.playing[i];
      // The companion a spell moved (`cast.companion`): carried from where it stood, or put beside its master.
      if ((p.petX || p.petY) && p.pet?.who && sameWho(p.pet.who, w)) return { x: p.petX, y: p.petY };
      // A creature (or a person) a spell moved, carried from where it stood (`cast.pull`).
      if (p.targetFrom && p.at.kind !== 'spot' && p.at.kind !== 'self' && sameWho(p.at, w)) {
        if (p.pullX || p.pullY) return { x: p.pullX, y: p.pullY };
        continue;
      }
      if (!sameWho(p.by, w) || (!p.from && !p.vis.cast.close)) continue;
      const left = this.shiftLeft(p, this.now - p.start);
      const x = p.shiftX * left + p.closeX, y = p.shiftY * left + p.closeY;
      return x || y ? { x, y } : null;
    }
    return null;
  }

  /**
   * The close a cast asks for (`cast.close`), with what is in its caster's hand: nothing when it does not close, or not
   * with that (`CastClose.when`).
   */
  private closeOf(p: Playing, c: Body): CastClose | null {
    const cl = p.vis.cast.close;
    if (!cl) return null;
    const o = cl === true ? {} : cl;
    return o.when && !o.when(c.figure?.gear?.weapon?.id) ? null : o;
  }

  /**
   * When a closing cast's trip back begins and ends, in seconds from its start: from `back` of the way through the pose
   * (its hold counted), to `after` seconds past the pose's end.
   */
  private backSpan(p: Playing, o: CastClose): [number, number] {
    const timing = p.vis.cast.timing, rel = timing.release;
    const at = (o.back ?? rel + (1 - rel) * 0.3) * timing.secs;
    const start = at <= p.holdAt ? at : at + (p.holdEnd - p.holdAt);
    const after = o.after ?? clamp(BACK_BASE + (BACK_TILE * p.closeBy) / UNITS_PER_TILE, BACK_LEAST, BACK_MOST);
    return [start, poseEnd(p) + Math.max(0, after)];
  }

  /**
   * How far in a melee cast closes (`cast.close`), nought to one, `e` seconds in: in over the wind-up to the blow,
   * held through a hold, and back from the follow-through to a little past the end (`backSpan`). Also how far along
   * the way in and the way back it is.
   */
  private closeShare(p: Playing, e: number, o: CastClose): { share: number; inn: number; out: number; back: [number, number] } {
    const back = this.backSpan(p, o);
    if (e < 0 || e >= back[1]) return { share: 0, inn: 0, out: 1, back };
    const timing = p.vis.cast.timing, rel = timing.release;
    const u = poseClock(p, e) / timing.secs;
    const inn = smooth(seg(u, o.from ?? 0, o.to ?? rel)), out = smooth(seg(e, back[0], back[1]));
    return { share: inn * (1 - out), inn, out, back };
  }

  /** How far a melee cast carries its body in at the blow, in height units: what its blow is short of the target by, and no further than it may go. */
  private closeBy(o: CastClose, c: Body, aim: CastAim | null): number {
    if (!aim || c.figure?.moving || c.figure?.swimming || c.figure?.driving) return 0;
    const id = c.figure?.gear?.weapon?.id, span = id ? weaponSpan(id) : null;
    const reach = o.reach ?? CLOSE_ARM + (span ? span.to : 0);
    return clamp(aim.near - reach, 0, (o.most ?? CLOSE_MOST) * UNITS_PER_TILE);
  }

  /** How much of the way back to where it stood a cast's caster still is, `e` seconds in: one at the start, nought once moved. */
  private shiftLeft(p: Playing, e: number): number {
    if (!p.from) return 0;
    if (e < 0) return 1;
    const m = p.vis.cast.move, timing = p.vis.cast.timing;
    const u = poseClock(p, e) / timing.secs;
    return 1 - smooth(seg(u, m?.from ?? 0, m?.to ?? timing.release));
  }

  private castNow(p: Playing, e: number): CastNow {
    return {
      id: p.id, t: Math.min(0.9999, poseClock(p, e) / p.vis.cast.timing.secs), at: p.aimed, held: heldShare(p, e), aim: p.aim ?? undefined,
      moved: p.from ? Math.hypot(p.shiftX, p.shiftY) : 0, companion: p.pet && p.caster ? this.offsetOf(p.caster, p.pet) : undefined, travel: p.travel,
    };
  }

  /** Where `b` stands from `c` in `c`'s own frame: height units ahead along the way it faces, and to its right. */
  private offsetOf(c: Body, b: { x: number; y: number }): { ahead: number; aside: number } {
    const k = this.k, f = k.facingDir(c), right = k.local(c, UNITS_PER_TILE, 0, 0);
    const dx = b.x - c.x, dy = b.y - c.y;
    return { ahead: (dx * f.x + dy * f.y) * UNITS_PER_TILE, aside: (dx * (right.x - c.x) + dy * (right.y - c.y)) * UNITS_PER_TILE };
  }

  /** What the frame's casts asked for over their budgets (`SPELLS.md`): shapes, lights; for the preview to say. */
  readonly over: string[] = [];

  /**
   * How somebody is veiled by the spells on them this frame (`FxScene.veil`), for their figure (`FigurePose.veil`):
   * the strongest of what they were given. Nothing when nothing veils them.
   */
  veilOf(w: Who): { colour: string; tint: number; fade: number } | undefined {
    let best: { colour: string; tint: number; fade: number } | undefined;
    for (const v of this.out.veils) {
      if (!sameWho(v.who, w)) continue;
      if (!best || v.tint + v.fade > best.tint + best.fade) best = { colour: v.colour, tint: v.tint, fade: v.fade };
    }
    return best;
  }

  /**
   * How a creature is tinted by the spells on it this frame (`FxScene.tint`), for whoever draws it: the strongest it was
   * given. Nothing when nothing tints it.
   */
  tintOf(w: Who): { colour: string; share: number } | undefined {
    let best: { colour: string; share: number } | undefined;
    for (const v of this.out.tints) {
      if (sameWho(v.who, w) && (!best || v.share > best.share)) best = { colour: v.colour, share: v.share };
    }
    return best;
  }

  /** Where `p`'s target stands from its caster `c` (see `CastAim`), in the caster's own frame and units; nothing for a cast on oneself. */
  private aimOf(c: Body, p: Playing, t: Body | null): CastAim | null {
    if (!t || t === c || p.aimed === 'self') return null;
    const k = this.k;
    const f = k.facingDir(c), right = k.local(c, UNITS_PER_TILE, 0, 0);
    const rx = right.x - c.x, ry = right.y - c.y;
    const dx = t.x - c.x, dy = t.y - c.y;
    const ahead = (dx * f.x + dy * f.y) * UNITS_PER_TILE, aside = (dx * rx + dy * ry) * UNITS_PER_TILE;
    if (t.kind === 'spot') {
      const z = t.z - c.z;
      return { ahead, aside, near: ahead, head: z, chest: z, top: z, close: 0 };
    }
    return { ahead, aside, near: ahead - t.wide, head: k.muzzle(t).z - c.z, chest: k.heart(t).z - c.z, top: t.z + t.tall - c.z, close: 0 };
  }

  /** Forget everything: a new island, a new body. */
  clear(): void {
    this.playing.length = 0;
    this.holds.clear();
    this.parts.clear();
    this.out.reset();
  }

  /** Somebody where they are this frame, told who they are. */
  private bodyOf(w: Who): Body | null {
    const b = this.where.body(w);
    if (b && !b.who) b.who = w;
    // Held still by a hold the island told of, for as long as it said.
    if (b && w.kind === 'creature' && !b.held && (this.holds.get(whoKey(w)) ?? 0) > this.now) b.held = true;
    return b;
  }

  private targetOf(at: Aim, caster: Body, last: Body | null): Body | null {
    if (at.kind === 'self') return caster;
    if (at.kind === 'spot') return { x: at.x, y: at.y, z: this.where.ground(at.x, at.y), tall: 0, wide: 0, facing: 0, kind: 'spot' };
    return this.bodyOf(at) ?? last;
  }

  /** The bodies a cast reached, as the island said, where each is this frame; those not to be found are left out. */
  private hitBodies(told: Told): Body[] {
    const out: Body[] = [];
    for (const h of told.hit) {
      const b = this.bodyOf(h.who);
      if (b) out.push(b);
    }
    return out;
  }

  /** Everybody near a point, asked of the world once a frame for each point and reach. */
  private near(x: number, y: number, r: number): readonly Body[] {
    if (!this.where.near) return NO_BODIES;
    const key = `${x.toFixed(2)},${y.toFixed(2)},${r.toFixed(2)}`;
    let got = this.nearby.get(key);
    if (!got) {
      got = this.where.near(x, y, r);
      this.nearby.set(key, got);
    }
    return got;
  }

  private jointOf(b: Body, bone: string, at?: [number, number, number]): P3 | null {
    const f = b.figure;
    if (!f) return null;
    const key = `${b.x.toFixed(3)},${b.y.toFixed(3)},${bone},${at ? at.join(',') : ''}`;
    const had = this.joints.get(key);
    if (had) return had;
    const j = figureJoint({ ...f, facing: b.facing }, bone, at);
    const p = this.k.local(b, j[0], j[1], j[2]);
    this.joints.set(key, p);
    return p;
  }

  /* ---- a frame ------------------------------------------------------------------------- */

  /**
   * Run every cast for this frame, `now` seconds on the drawing clock: their
   * bodies found where they are, their moments passed, their effects recorded.
   */
  update(env: { eye: Eye; now: number; dt: number; fast: boolean; night?: number }): void {
    this.now = env.now;
    this.eye = env.eye;
    this.out.reset();
    this.joints.clear();
    this.nearby.clear();
    this.parts.step(Math.min(0.1, env.dt));
    const k = this.k;
    k.eye = env.eye;
    k.zoom = env.eye.zoom;
    k.now = env.now;
    k.dt = Math.min(0.1, env.dt);
    k.fast = env.fast;
    k.night = this.night = clamp(env.night ?? 0);
    k.partCap = env.fast ? Math.round(MOST_PARTICLES / 3) : MOST_PARTICLES;
    this.over.length = 0;
    for (const [key, until] of this.holds) if (until <= this.now) this.holds.delete(key);
    let keep = 0;
    for (const p of this.playing) {
      if (this.run(p)) this.playing[keep++] = p;
    }
    this.playing.length = keep;
  }

  /** One cast's frame; false when it is over. */
  private run(p: Playing): boolean {
    const t = this.now - p.start;
    if (t < 0) return true;
    // The caster where they are now; somebody gone for long enough lets the cast go.
    const caster = this.bodyOf(p.by);
    if (caster) {
      p.caster = caster;
      p.lostAt = -1;
    } else {
      if (p.lostAt < 0) p.lostAt = this.now;
      if (this.now - p.lostAt > LOST_FOR || !p.caster) return false;
    }
    let c = p.caster as Body;
    const timing = p.vis.cast.timing;
    // A held pose is let go as soon as the caster walks off.
    if (t > p.holdAt && t < p.holdEnd && c.figure?.moving) p.holdEnd = t;
    const castEnd = poseEnd(p);
    const ct = poseClock(p, t);
    // Carried from where they stood, for a move the island made before the cast was drawn.
    if (p.from) {
      const left = this.shiftLeft(p, t);
      if (left > 0) {
        const x = c.x + p.shiftX * left, y = c.y + p.shiftY * left;
        c = { ...c, x, y, z: c.z + this.where.ground(x, y) - this.where.ground(c.x, c.y) };
      }
    }
    // Where the target stands from where the caster stands (before any closing in), for the pose and the effects.
    p.aim = this.aimOf(c, p, p.at.kind === 'self' ? null : this.targetOf(p.at, c, p.target));
    // A melee cast closing in on what it strikes (`cast.close`): the body drawn carried toward it over the wind-up by as
    // much as its blow falls short, and back from the follow-through to a little past the cast's end, bounding. Where it is
    // drawn, and so where its effects come from. How far, and which way, are kept from the blow on: the creature struck
    // may die or run, and the body still has to get back.
    if (!p.released) {
      p.close = this.closeOf(p, c);
      p.closeBy = p.close ? this.closeBy(p.close, c, p.aim) : 0;
      if (p.target) {
        const dx = p.target.x - c.x, dy = p.target.y - c.y, l = Math.hypot(dx, dy) || 1;
        p.closeDX = dx / l;
        p.closeDY = dy / l;
      }
    }
    const by = p.closeBy, cs = p.close && by > 0 ? this.closeShare(p, t, p.close) : null, share = cs?.share ?? 0;
    p.closeX = p.closeY = 0;
    p.travel = undefined;
    p.closeEnd = cs ? cs.back[1] : 0;
    if (p.aim) p.aim.close = by;
    if (share > 0) {
      const go = (by * share) / UNITS_PER_TILE;
      p.closeX = p.closeDX * go;
      p.closeY = p.closeDY * go;
      const x = c.x + p.closeX, y = c.y + p.closeY;
      c = { ...c, x, y, z: c.z + this.where.ground(x, y) - this.where.ground(c.x, c.y) };
    }
    if (cs && p.close && t < cs.back[1]) {
      // The way it goes in the body's own frame, for the legs to step it: running in, bounding back (`CastTravel`).
      const f = this.k.facingDir(c), right = this.k.local(c, UNITS_PER_TILE, 0, 0);
      const ax = p.closeDX * (right.x - c.x) + p.closeDY * (right.y - c.y), ay = p.closeDX * f.x + p.closeDY * f.y;
      const l = Math.hypot(ax, ay) || 1, dx = ax / l, dy = ay / l;
      const steps = p.close.steps ?? true, back = t >= cs.back[0];
      const stepping = steps === true || steps === (back ? 'back' : 'in');
      const w = !stepping ? 0 : back ? smooth(seg(cs.out, 0, 0.1)) : smooth(seg(cs.inn, 0, 0.1)) * (1 - smooth(seg(cs.inn, 0.8, 1)));
      p.travel = {
        dir: back ? [-dx, -dy] : [dx, dy], by, at: back ? cs.out : cs.inn, gait: back ? 'bound' : 'run', w,
        ground: [-dx * by * share, -dy * by * share],
      };
    }
    // The companion, and where it is drawn: carried from where it stood over a leap the island made (`cast.companion`), or
    // put beside its master when the island has put it on the master's own spot.
    let pet = p.companion ? this.bodyOf(p.companion) : this.where.companion?.(p.by) ?? null;
    p.petX = p.petY = 0;
    const cm = p.vis.cast.companion;
    if (pet && cm) {
      const o = cm === true ? {} : cm;
      let dx = 0, dy = 0;
      if (p.petFrom) {
        const left = 1 - smooth(seg(ct / timing.secs, o.from ?? 0, o.to ?? timing.release));
        dx = (p.petFrom.x - pet.x) * left;
        dy = (p.petFrom.y - pet.y) * left;
      }
      if ((o.beside ?? true) && Math.hypot(pet.x + dx - c.x, pet.y + dy - c.y) < BESIDE) {
        // On top of its master: drawn a step off to the left and a little behind instead.
        const at = this.k.local(c, -0.75 * UNITS_PER_TILE, -0.2 * UNITS_PER_TILE, 0);
        dx = at.x - pet.x;
        dy = at.y - pet.y;
      }
      if (dx || dy) {
        p.petX = dx;
        p.petY = dy;
        const x = pet.x + dx, y = pet.y + dy;
        pet = { ...pet, x, y, z: pet.z + this.where.ground(x, y) - this.where.ground(pet.x, pet.y) };
      }
    }
    p.pet = pet;
    // While it is being cast, the figure is the cast: its hands are where the pose has them.
    if (c.figure && t < castEnd) c.figure = { ...c.figure, cast: this.castNow(p, t) };
    let target = this.targetOf(p.at, c, p.target);
    const gone = p.at.kind !== 'self' && p.at.kind !== 'spot' && !this.where.body(p.at);
    // Moved by the spell (`cast.pull`): drawn carried from where it stood to where the island put it.
    p.pullX = p.pullY = 0;
    if (p.targetFrom && target && target !== c && !gone) {
      const m = typeof p.vis.cast.pull === 'object' ? p.vis.cast.pull : {};
      const left = 1 - smooth(seg(ct / timing.secs, m.from ?? 0, m.to ?? timing.release));
      const dx = p.targetFrom.x - target.x, dy = p.targetFrom.y - target.y;
      if (left > 0 && Math.hypot(dx, dy) > 0.05) {
        p.pullX = dx * left;
        p.pullY = dy * left;
        const x = target.x + p.pullX, y = target.y + p.pullY;
        target = { ...target, x, y, z: target.z + this.where.ground(x, y) - this.where.ground(target.x, target.y) };
      }
    }
    p.target = target ?? c;
    // What it lands on: followed until it lands, then where it landed for anything on the ground.
    if (!p.landed || p.at.kind !== 'spot') p.spot = { x: p.target.x, y: p.target.y, z: p.target.z };

    const k = this.k;
    k.pal = p.vis.palette;
    k.fx = p.info?.fx ?? {};
    k.caster = c;
    k.target = p.target;
    // Whether the cast is played left-handed, decided while it is cast and kept after.
    if (c.figure?.cast) p.lefty = castLefty(c.figure);
    k.aim = p.aim;
    k.travel = p.travel ?? null;
    k.lefty = p.lefty;
    k.side = p.lefty ? -1 : 1;
    k.timing = timing;
    k.spot = p.spot;
    k.dist = Math.hypot(p.spot.x - c.x, p.spot.y - c.y);
    k.state = p.state;
    k.seed = p.seed;
    k.mine = p.mine;
    k.from = p.from;
    k.rand = rngOf((p.seed ^ Math.imul(Math.floor(this.now * 60), 2654435761)) >>> 0);
    k.companion = pet;
    k.lightsLeft = 2;
    k.healing = !!p.info?.fx.heal;
    k.grouped = 0;
    k.released = p.released ? t - p.releasedAt : -1;
    k.castLeft = Math.max(0, castEnd - t);
    // What the island said it did: whom it reached, where they are now; what of it was spent; what fired after it.
    k.told = p.told;
    k.hit = p.told ? this.hitBodies(p.told) : null;
    k.used = p.usedT >= 0 ? t - p.usedT : -1;
    k.fired = p.fires.length ? p.fires.map((f) => ({ on: f.on ? this.bodyOf(f.on) : null, age: t - f.t, size: f.size })) : NO_FIRES;
    const shapes0 = this.out.world.length + this.out.ground.length;

    const fx = p.vis.fx;
    if (t < castEnd && fx.charge) fx.charge(k, Math.min(1, ct / timing.secs));
    if (!p.released && ct >= p.release) {
      p.released = true;
      p.releasedAt = t;
      fx.release?.(k);
      const travel = fx.travel ? Math.max(0, fx.travel.secs(k.dist)) : 0;
      p.arrive = t + travel;
      p.end = endOf(p);
    }
    if (p.released && fx.travel && t >= p.releasedAt && t < p.arrive) fx.travel.draw(k, (t - p.releasedAt) / Math.max(1e-3, p.arrive - p.releasedAt));
    if (p.released && !p.landed && t >= p.arrive) {
      p.landed = true;
      fx.hit?.(k);
    }
    if (p.landed && fx.impact && t - p.arrive < fx.impact.secs) fx.impact.draw(k, (t - p.arrive) / fx.impact.secs);
    let on = true;
    const lingers = lingersOf(p);
    if (p.usedT >= 0 && p.released) p.end = endOf(p);
    if (p.landed && fx.linger && lingers > 0) {
      // What it lingered on is gone: over now. A linger on the caster or on the spot plays on.
      if (gone && (fx.linger.on ?? 'target') === 'target') on = false;
      else {
        const age = t - p.arrive;
        if (age < lingers) fx.linger.draw(k, age, lingers - age);
      }
    }
    // Over its budgets this frame: said, for the preview.
    const shapes = this.out.world.length + this.out.ground.length - shapes0 - k.grouped;
    if (shapes > SHAPES_MOST) this.over.push(`${p.id} ${shapes} shapes`);
    if (k.lightsLeft < 0) this.over.push(`${p.id} lights`);
    if (!on) return t < Math.max(castEnd, p.closeEnd, p.arrive + (fx.impact?.secs ?? 0));
    return !p.released || t < Math.max(castEnd, p.closeEnd, p.end);
  }

  /* ---- laying out --------------------------------------------------------------------- */

  /**
   * Sort what the frame recorded into the lines of the ground it is drawn on,
   * and cut what lies on the ground into each line's share (`groundLine`).
   * `ctx` is the screen's, for its size and scale.
   *
   * What lies on the ground is cut two ways. The kit's own marks come as
   * shapes on the island (`GroundRec.shape`): they are cut along the tiles'
   * edges here and each piece is filled or stroked with its own line, with no
   * clip, so they cost what they cover. Anything drawn with `groundDraw` is
   * drawn whole into a layer, a run of them to a layer, and copied out of it
   * a line at a time under a clip of that line's tiles.
   */
  layout(ctx: CanvasRenderingContext2D, view: View, dLo: number, dHi: number): void {
    for (const [, list] of this.lines) {
      list.length = 0;
      this.spare.push(list);
    }
    this.lines.clear();
    this.groundItems.clear();
    this.lightLines.clear();
    const eye = this.eye;
    if (!eye) return;
    const line = (x: number, y: number): number => Math.max(dLo, Math.min(dHi, depthOf(view, Math.floor(x), Math.floor(y))));
    const put = (rec: WorldRec): void => {
      const d = line(rec.x, rec.y);
      let list = this.lines.get(d);
      if (!list) {
        list = this.spare.pop() ?? [];
        this.lines.set(d, list);
      }
      list.push(rec);
    };
    for (const rec of this.out.world) put(rec);
    const ps = this.parts;
    for (let i = 0; i < ps.span; i++) {
      if (ps.life[i] <= 0 || isLightKind(ps.kind[i])) continue;
      const x = ps.x[i], y = ps.y[i];
      put({ x, y, sx: eye.worldToScreenX(x, y), sy: eye.worldToScreenY(x, y, this.where.ground(x, y)) + ps.bias[i], draw: null, p: i });
    }
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const m = ctx.getTransform();
    this.layLight(ctx, view, dLo, dHi, W, H);
    const ground = this.out.ground;
    if (!ground.length) return;
    // In the order they were recorded, so what was laid over what still is on every line: the shapes before the first
    // drawn record and after the last cut along the tiles, and everything from the first drawn record to the last drawn
    // into one layer together -- a shape among them too, to keep its place over one and under the next.
    let first = -1, last = -1;
    for (let i = 0; i < ground.length; i++) {
      if (ground[i].shape) continue;
      if (first < 0) first = i;
      last = i;
    }
    for (let i = 0; i < ground.length; i++) {
      if (i === first) {
        this.layRun(0, first, last + 1, ctx, m, view, dLo, dHi, W, H);
        i = last;
        continue;
      }
      this.cutShape(ground[i].shape as readonly GroundLayer[], view, dLo, dHi);
    }
  }

  /* ---- shapes, cut along the tiles ---------------------------------------------------------- */

  /**
   * A shape's layers cut along the tiles' edges, each piece added to the path
   * of the line its tile is drawn with: a polygon clipped to each tile it
   * covers, a line split where it crosses a tile's edge. Every corner, the
   * cut ones too, is put on the ground where it is, so a piece meets the
   * ground's own outline exactly and the shape follows the land.
   */
  private cutShape(layers: readonly GroundLayer[], view: View, dLo: number, dHi: number): void {
    const eye = this.eye as Eye;
    const paths = this.cutPaths;
    for (const l of layers) {
      if (!l.paths.length || l.alpha <= 0.01) continue;
      paths.clear();
      const pathOf = (d: number): Path2D => {
        let p = paths.get(d);
        if (!p) {
          p = new Path2D();
          paths.set(d, p);
        }
        return p;
      };
      const sx = (x: number, y: number): number => eye.worldToScreenX(x, y);
      const sy = (x: number, y: number): number => eye.worldToScreenY(x, y, this.where.ground(x, y) + l.lift);
      if (l.kind === 'fill') {
        for (const poly of l.paths) {
          if (poly.length < 6) continue;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let i = 0; i < poly.length; i += 2) {
            x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i]);
            y0 = Math.min(y0, poly[i + 1]); y1 = Math.max(y1, poly[i + 1]);
          }
          for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) {
            for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++) {
              const d = depthOf(view, tx, ty);
              if (d < dLo || d > dHi) continue;
              // Within one tile, as most of a ring's facets are, it is itself.
              const inside = x0 >= tx && x1 <= tx + 1 && y0 >= ty && y1 <= ty + 1;
              const piece = inside ? poly : clipToTile(poly, tx, ty);
              if (piece.length < 6) continue;
              const p = pathOf(d);
              for (let i = 0; i < piece.length; i += 2) {
                if (i === 0) p.moveTo(sx(piece[0], piece[1]), sy(piece[0], piece[1]));
                else p.lineTo(sx(piece[i], piece[i + 1]), sy(piece[i], piece[i + 1]));
              }
              p.closePath();
            }
          }
        }
      } else {
        for (const pts of l.paths) {
          const n = pts.length / 2;
          if (n < 2) continue;
          // Along the line a stretch at a time, each cut where it crosses a tile's edge; a piece that goes on in the
          // same line as the last goes on in the same stroke, so its corners are joined as they were.
          let lastD = NaN, lx = NaN, ly = NaN;
          const segs = l.closed ? n : n - 1;
          for (let s = 0; s < segs; s++) {
            const ax = pts[2 * s], ay = pts[2 * s + 1], bx = pts[(2 * s + 2) % pts.length], by = pts[(2 * s + 3) % pts.length];
            const cuts = this.cuts;
            cuts.length = 0;
            cuts.push(0, 1);
            const dx = bx - ax, dy = by - ay;
            if (dx) for (let k = Math.ceil(Math.min(ax, bx)); k <= Math.floor(Math.max(ax, bx)); k++) cuts.push((k - ax) / dx);
            if (dy) for (let k = Math.ceil(Math.min(ay, by)); k <= Math.floor(Math.max(ay, by)); k++) cuts.push((k - ay) / dy);
            cuts.sort((a, b) => a - b);
            for (let c = 1; c < cuts.length; c++) {
              const u0 = cuts[c - 1], u1 = cuts[c];
              if (u1 - u0 < 1e-9) continue;
              const um = (u0 + u1) / 2;
              const d = depthOf(view, Math.floor(ax + dx * um), Math.floor(ay + dy * um));
              const ex = ax + dx * u1, ey = ay + dy * u1;
              if (d < dLo || d > dHi) {
                lastD = NaN;
                continue;
              }
              const p = pathOf(d);
              const fx = ax + dx * u0, fy = ay + dy * u0;
              if (d !== lastD || fx !== lx || fy !== ly) p.moveTo(sx(fx, fy), sy(fx, fy));
              p.lineTo(sx(ex, ey), sy(ex, ey));
              lastD = d;
              lx = ex;
              ly = ey;
            }
          }
        }
      }
      for (const [d, path] of paths) {
        let items = this.groundItems.get(d);
        if (!items) {
          items = [];
          this.groundItems.set(d, items);
        }
        items.push({ layer: l, path, run: -1, pieces: null, recs: null });
      }
    }
  }

  /* ---- drawn records, laid into a layer and clipped --------------------------------------- */

  /**
   * A run of records drawn with `groundDraw`, `from` to `to` of the frame's:
   * drawn whole into a layer of their own and cut a line at a time by clips
   * of that line's share of their tiles (`clipRun`).
   */
  private layRun(run: number, from: number, to: number, ctx: CanvasRenderingContext2D, m: DOMMatrix, view: View, dLo: number, dHi: number, W: number, H: number): void {
    const byLine = this.clipRun(from, to, m, view, dLo, dHi, W, H);
    if (!byLine.size) return;
    let layer: RunLayer | null = null;
    if (SpellStage.groundMode === 'layer') {
      layer = this.runLayers[run] ?? (this.runLayers[run] = { canvas: null, dirty: null });
      if (!layer.canvas) layer.canvas = document.createElement('canvas');
      const c = layer.canvas;
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
        layer.dirty = null;
      }
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (layer.dirty) g.clearRect(...layer.dirty);
      layer.dirty = this.runNext;
      g.setTransform(m);
      for (let i = from; i < to; i++) {
        g.save();
        this.out.ground[i].draw(g);
        g.restore();
      }
    }
    const recs: number[] = [];
    for (let i = from; i < to; i++) recs.push(i);
    for (const [d, pieces] of byLine) {
      let items = this.groundItems.get(d);
      if (!items) {
        items = [];
        this.groundItems.set(d, items);
      }
      items.push({ layer: null, path: null, run, pieces, recs });
    }
  }

  /**
   * The spells' lights' colour on the ground, at night: each light's hue (`lightTint`) as a gradient falling off from its
   * middle as the light does (`lightFall`), and each line's share of the tiles it lights, for `groundLine` to fill with
   * it as a colour (`'color'`: the ground's own lightness, the light's hue) before anything stands on the line. On the
   * ground only: a body standing in a light is lit by the night's hole and the light's cast added (`Game.lights`),
   * warmer and brighter, but keeps its own colours.
   */
  private layLight(g: CanvasRenderingContext2D, view: View, dLo: number, dHi: number, W: number, H: number): void {
    const eye = this.eye;
    if (!eye || this.night <= 0.02 || !this.out.lights.length) return;
    const tiles = this.lightTiles;
    const hw = HALF_W * eye.zoom, hh = HALF_H * eye.zoom, h = (x: number, y: number): number => this.where.ground(x, y);
    const sx = (x: number, y: number): number => eye.worldToScreenX(x, y), sy = (x: number, y: number): number => eye.worldToScreenY(x, y, h(x, y));
    // The screen's own pixels, for what is off it.
    const m = g.getTransform(), sc = Math.hypot(m.a, m.b);
    const wash = NIGHT_WASH * this.night;
    for (const l of this.out.lights) {
      const a = this.lightHueAt(l);
      if (a <= 0.01) continue;
      const lx = sx(l.x, l.y), ly = sy(l.x, l.y), r = l.radius * hw;
      // As far out as it lays as much as 3% of its colour, where the wash is still all over it: (1 - t²)² = 0.03 (1 - wash) / a.
      const rp = r * Math.sqrt(1 - Math.sqrt(Math.min(1, (0.03 * (1 - wash)) / a)));
      const cx = m.a * lx + m.c * ly + m.e, cy = m.b * lx + m.d * ly + m.f;
      if (cx + rp * sc < 0 || cy + rp * sc < 0 || cx - rp * sc > W || cy - rp * sc > H) continue;
      tiles.clear();
      const reach = Math.ceil(l.radius * Math.SQRT2) + 1;
      for (let x = Math.floor(l.x) - reach; x <= Math.floor(l.x) + reach; x++) {
        for (let y = Math.floor(l.y) - reach; y <= Math.floor(l.y) + reach; y++) {
          // A tile is in it where its diamond comes within `rp` of the light's middle.
          const u = Math.abs(sx(x + 0.5, y + 0.5) - lx), v = Math.abs(sy(x + 0.5, y + 0.5) - ly);
          if (u > rp + hw || v > rp + hh || (u / hw + v / hh > 1 && (u * hh + v * hw - hw * hh) / Math.hypot(hw, hh) > rp)) continue;
          const d = depthOf(view, x, y);
          if (d < dLo || d > dHi) continue;
          // Its corners on the screen, sorted into left, top, right and bottom, as many as the ground drew it with.
          const cs = [sx(x, y), sy(x, y), sx(x + 1, y), sy(x + 1, y), sx(x + 1, y + 1), sy(x + 1, y + 1), sx(x, y + 1), sy(x, y + 1)];
          let L = 0, T = 0, R = 0, B = 0;
          for (let c = 1; c < 4; c++) {
            if (cs[2 * c] < cs[2 * L]) L = c;
            if (cs[2 * c] > cs[2 * R]) R = c;
            if (cs[2 * c + 1] < cs[2 * T + 1]) T = c;
            if (cs[2 * c + 1] > cs[2 * B + 1]) B = c;
          }
          let list = tiles.get(d);
          if (!list) tiles.set(d, (list = []));
          list.push([cs[2 * L], cs[2 * L + 1], cs[2 * T], cs[2 * T + 1], cs[2 * R], cs[2 * R + 1], cs[2 * B], cs[2 * B + 1]]);
        }
      }
      if (!tiles.size) continue;
      const fill = this.lightFill(g, l, lx, ly, r, a);
      // Each line's tiles along it as one piece, its outline the tiles' own, or a few where it is broken.
      for (const [d, list] of tiles) {
        list.sort((p, q) => p[0] - q[0]);
        const path = new Path2D();
        let start = 0;
        for (let i = 1; i <= list.length; i++) {
          if (i < list.length && Math.abs(list[i][0] - list[i - 1][4]) < hw * 0.5) continue;
          path.moveTo(list[start][0], list[start][1]);
          for (let k = start; k < i; k++) {
            const q = list[k];
            path.lineTo(q[2], q[3]);
            path.lineTo(q[4], q[5]);
          }
          for (let k = i - 1; k >= start; k--) {
            const q = list[k];
            path.lineTo(q[4], q[5]);
            path.lineTo(q[6], q[7]);
            path.lineTo(q[0], q[1]);
          }
          path.closePath();
          start = i;
        }
        let on = this.lightLines.get(d);
        if (!on) this.lightLines.set(d, (on = []));
        on.push({ path, fill });
      }
    }
  }

  /** How far over to its colour a light lays the ground at its middle, now: its strength, how dark it is and its size. */
  private lightHueAt(l: LightRec): number {
    return Math.min(LIGHT_COLOUR_MOST, LIGHT_COLOUR * l.strength * this.night) * lightHue(l.radius);
  }

  /**
   * A light's colour as a gradient, a circle as the night's hole for it is (`Game.lights`) at `x`, `y` and `r` pixels,
   * falling off as it does: laid a little stronger where the wash is still over it (`NIGHT_WASH`), so it comes out
   * through the wash as it went in.
   */
  private lightFill(g: CanvasRenderingContext2D, l: LightRec, x: number, y: number, r: number, a: number): CanvasGradient {
    const tint = lightTint(l.cast), hole = l.strength * lightHole(l.radius), wash = NIGHT_WASH * this.night;
    const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16));
    return fallGradient(g, x, y, r, (f) => `rgba(${cr},${cg},${cb},${Math.min(1, (a * f) / (1 - wash * (1 - hole * f))).toFixed(3)})`);
  }

  /** What of the run's layer was drawn on this frame, in its own pixels, worked out by `clipRun`. */
  private runNext: [number, number, number, number] | null = null;

  /**
   * Each line's share of a run of drawn records, as clips to cut it to: the
   * tiles of the line the records lie on, and of a tile only the cells a
   * record draws in when every record on it says which (`GroundRec.keep`),
   * gathered into a few pieces along the line, each with the box round it.
   * A canvas pays for a clip by the box round it, so pieces whose boxes hug
   * what they hold cost less than a line's whole tiles at once.
   */
  private clipRun(from: number, to: number, m: DOMMatrix, view: View, dLo: number, dHi: number, W: number, H: number): Map<number, Piece[]> {
    const eye = this.eye as Eye;
    const zoom = eye.zoom;
    // Cells a tile is cut into, a side: about thirty pixels across a cell, at most six (past that the asking costs more than the cut saves).
    const n = Math.max(1, Math.min(SpellStage.cellsMost, Math.round((TILE_W * zoom) / 32)));
    // How far round a point a record is asked about: the cell's half-diagonal, and six pixels for its ink and its edge in
    // tiles at their steepest (a tile down the screen is `HALF_H` * 2 / root two pixels at zoom one).
    const slack = 6 / ((HALF_H * 2 * zoom) / Math.SQRT2);
    const tileReach = Math.SQRT1_2 + slack, cellReach = Math.SQRT1_2 / n + slack;
    const tiles = this.cellTiles;
    tiles.clear();
    // The box on the screen round every record's square, whatever of it is laid: all of it is drawn into the layer, and
    // all of it has to be cleared off again, even where a record said wrongly that it drew nothing.
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let ri = from; ri < to; ri++) {
      const rec = this.out.ground[ri];
      const keep = rec.keep;
      for (let c = 0; c < 4; c++) {
        const cx = c === 1 || c === 2 ? rec.x1 : rec.x0, cy = c >= 2 ? rec.y1 : rec.y0;
        const qx = eye.worldToScreenX(cx, cy), qy = eye.worldToScreenY(cx, cy, this.where.ground(cx, cy));
        const sx = m.a * qx + m.c * qy + m.e, sy = m.b * qx + m.d * qy + m.f;
        bx0 = Math.min(bx0, sx);
        by0 = Math.min(by0, sy);
        bx1 = Math.max(bx1, sx);
        by1 = Math.max(by1, sy);
      }
      for (let x = Math.floor(rec.x0); x <= Math.floor(rec.x1); x++) {
        for (let y = Math.floor(rec.y0); y <= Math.floor(rec.y1); y++) {
          if (keep && !keep(x + 0.5, y + 0.5, tileReach)) continue;
          const d = depthOf(view, x, y);
          if (d < dLo || d > dHi) continue;
          const key = x * 65536 + y;
          let t = tiles.get(key);
          if (!t) {
            t = { x, y, d, full: false, keeps: [] };
            tiles.set(key, t);
          }
          if (!keep) t.full = true;
          else if (!t.full) t.keeps.push(keep);
        }
      }
    }
    // What lies on the ground reaches a little past its square (an edge, a glow, the land rising): clear that much more next time.
    const more = Math.ceil(64 * Math.max(1, zoom));
    const cx0 = Math.max(0, Math.floor(bx0) - more), cy0 = Math.max(0, Math.floor(by0) - more);
    this.runNext = bx1 > bx0 ? [cx0, cy0, Math.max(0, Math.min(W, Math.ceil(bx1) + more) - cx0), Math.max(0, Math.min(H, Math.ceil(by1) + more) - cy0)] : [0, 0, W, H];
    // A piece a tile first: its cells, and the box round them on the screen.
    const h = (cx: number, cy: number): number => this.where.ground(cx, cy);
    const q = this.quad;
    const byLine = new Map<number, Piece[]>();
    for (const t of tiles.values()) {
      // The tile's corners on the screen, in the order the ground draws it; a cell's are between them, bilinearly, which
      // keeps a row of cells on the tile's own edges and so the line's outline exactly the tiles' it always was.
      for (let c = 0; c < 4; c++) {
        const cx = t.x + (c === 1 || c === 2 ? 1 : 0), cy = t.y + (c >= 2 ? 1 : 0);
        q[2 * c] = eye.worldToScreenX(cx, cy);
        q[2 * c + 1] = eye.worldToScreenY(cx, cy, h(cx, cy));
      }
      const piece: Piece = { pts: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, path: null };
      if (t.full || n === 1) this.cell(piece, m, 0, 1, 0, 1);
      else {
        // A row of cells at a time, a run of cells the records draw in laid as one quad.
        for (let j = 0; j < n; j++) {
          const cy = t.y + (j + 0.5) / n;
          let start = -1;
          for (let i = 0; i <= n; i++) {
            let on = false;
            if (i < n) {
              const cx = t.x + (i + 0.5) / n;
              for (const keep of t.keeps) {
                if (keep(cx, cy, cellReach)) {
                  on = true;
                  break;
                }
              }
            }
            if (on && start < 0) start = i;
            else if (!on && start >= 0) {
              this.cell(piece, m, start / n, i / n, j / n, (j + 1) / n);
              start = -1;
            }
          }
        }
      }
      // Off the screen, or nothing in it after all.
      if (!piece.pts.length || piece.x1 < 0 || piece.y1 < 0 || piece.x0 > W || piece.y0 > H) continue;
      let list = byLine.get(t.d);
      if (!list) {
        list = [];
        byLine.set(t.d, list);
      }
      list.push(piece);
    }
    // Then along each line, neighbouring pieces taken together while that saves more than it adds.
    for (const [d, list] of byLine) {
      list.sort((a, b) => a.x0 - b.x0);
      const out: Piece[] = [];
      let cur: Piece | null = null;
      const done = (p: Piece): void => {
        const path = new Path2D();
        const pts = p.pts;
        for (let i = 0; i < pts.length; i += 8) {
          path.moveTo(pts[i], pts[i + 1]);
          path.lineTo(pts[i + 2], pts[i + 3]);
          path.lineTo(pts[i + 4], pts[i + 5]);
          path.lineTo(pts[i + 6], pts[i + 7]);
          path.closePath();
        }
        p.path = path;
        p.x0 = Math.max(0, Math.floor(p.x0) - 2);
        p.y0 = Math.max(0, Math.floor(p.y0) - 2);
        p.x1 = Math.min(W, Math.ceil(p.x1) + 2);
        p.y1 = Math.min(H, Math.ceil(p.y1) + 2);
        if (p.x1 > p.x0 && p.y1 > p.y0) out.push(p);
      };
      const area = (a: { x0: number; y0: number; x1: number; y1: number }): number => (a.x1 - a.x0) * (a.y1 - a.y0);
      for (const p of list) {
        if (cur) {
          const ux0 = Math.min(cur.x0, p.x0), uy0 = Math.min(cur.y0, p.y0), ux1 = Math.max(cur.x1, p.x1), uy1 = Math.max(cur.y1, p.y1);
          // Taken together when the box round both is no bigger than theirs apart by more than a clip and a copy cost.
          if ((ux1 - ux0) * (uy1 - uy0) <= area(cur) + area(p) + SpellStage.pieceWorth) {
            for (const v of p.pts) cur.pts.push(v);
            cur.x0 = ux0;
            cur.y0 = uy0;
            cur.x1 = ux1;
            cur.y1 = uy1;
            continue;
          }
          done(cur);
        }
        cur = p;
      }
      if (cur) done(cur);
      if (out.length) byLine.set(d, out);
      else byLine.delete(d);
    }
    return byLine;
  }

  /** Tiles some record lies on, by tile: their line, and whether all of it is wanted or which records to ask about its cells. */
  private cellTiles = new Map<number, { x: number; y: number; d: number; full: boolean; keeps: Array<(x: number, y: number, reach: number) => boolean> }>();
  /** The tile being cut, its four corners on the screen. */
  private quad = new Float64Array(8);
  /** A shape's layer's paths by line, while it is cut; and where a stretch of a line crosses tiles' edges. */
  private cutPaths = new Map<number, Path2D>();
  private cuts: number[] = [];

  /** The part of the tile in `quad` from `u0` to `u1` across and `v0` to `v1` down, onto a piece and its box in the screen's pixels. */
  private cell(piece: Piece, m: DOMMatrix, u0: number, u1: number, v0: number, v1: number): void {
    const q = this.quad;
    for (let c = 0; c < 4; c++) {
      const u = c === 1 || c === 2 ? u1 : u0, v = c >= 2 ? v1 : v0;
      const a = (1 - u) * (1 - v), b = u * (1 - v), cc = u * v, dd = (1 - u) * v;
      const px = a * q[0] + b * q[2] + cc * q[4] + dd * q[6], py = a * q[1] + b * q[3] + cc * q[5] + dd * q[7];
      piece.pts.push(px, py);
      const sx = m.a * px + m.c * py + m.e, sy = m.b * px + m.d * py + m.f;
      if (sx < piece.x0) piece.x0 = sx;
      if (sx > piece.x1) piece.x1 = sx;
      if (sy < piece.y0) piece.y0 = sy;
      if (sy > piece.y1) piece.y1 = sy;
    }
  }

  /* ---- the passes --------------------------------------------------------------------- */

  /** What lies on the ground of line `d`: after the line's ground, before anything stands on it. */
  groundLine(ctx: CanvasRenderingContext2D, d: number): void {
    // The lights' colour first, on the line's ground alone, under the spells' own marks: each light's share of the line
    // filled with its gradient.
    const lit = this.lightLines.get(d);
    if (lit) {
      ctx.save();
      ctx.globalCompositeOperation = 'color';
      for (const p of lit) {
        ctx.fillStyle = p.fill;
        ctx.fill(p.path);
      }
      ctx.restore();
    }
    const items = this.groundItems.get(d);
    if (!items) return;
    for (const it of items) {
      if (it.layer && it.path) {
        ctx.save();
        paintGroundLayer(ctx, it.layer, it.path);
        ctx.restore();
        continue;
      }
      const layer = SpellStage.groundMode === 'layer' ? this.runLayers[it.run]?.canvas : null;
      for (const p of it.pieces ?? []) {
        if (!p.path) continue;
        ctx.save();
        ctx.clip(p.path);
        if (SpellStage.groundMode === 'vector') {
          for (const ri of it.recs ?? []) {
            ctx.save();
            this.out.ground[ri].draw(ctx);
            ctx.restore();
          }
        } else if (layer) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          const w = p.x1 - p.x0, hh = p.y1 - p.y0;
          ctx.drawImage(layer, p.x0, p.y0, w, hh, p.x0, p.y0, w, hh);
        }
        ctx.restore();
      }
    }
  }

  /** What stands on line `d`, to be sorted in with the line's bodies and trees by `sy`. */
  itemsAt(d: number): readonly WorldRec[] {
    return this.lines.get(d) ?? NONE;
  }

  /** Draw one thing standing in the world. */
  drawItem(ctx: CanvasRenderingContext2D, rec: WorldRec): void {
    ctx.save();
    if (rec.p >= 0) {
      if (this.parts.life[rec.p] > 0 && this.eye) drawParticle(ctx, this.parts, rec.p, this.eye, this.now);
    } else rec.draw?.(ctx);
    ctx.restore();
  }

  /** Light, over everything and over the night. */
  glowPass(ctx: CanvasRenderingContext2D): void {
    const ps = this.parts;
    if (!this.out.glow.length && !ps.n) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const draw of this.out.glow) {
      draw(ctx);
      ctx.globalAlpha = 1;
    }
    if (ps.n && this.eye) {
      ctx.lineCap = 'round';
      for (let i = 0; i < ps.span; i++) {
        if (ps.life[i] <= 0 || !isLightKind(ps.kind[i])) continue;
        // Over rather than added, for a spark that has to keep its colour (`BurstOpts.over`).
        if (ps.flags[i] & 1) ctx.globalCompositeOperation = 'source-over';
        drawParticle(ctx, ps, i, this.eye, this.now);
        if (ps.flags[i] & 1) ctx.globalCompositeOperation = 'lighter';
      }
    }
    ctx.restore();
  }

  /** The screen, last: a flash for your own great casts. */
  screenPass(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.out.screen.length) return;
    ctx.save();
    for (const draw of this.out.screen) draw(ctx, w, h);
    ctx.restore();
  }

  /* ---- for the preview ------------------------------------------------------------------- */

  /** The lights' colour on the ground at night, whole and uncut (`layLight`): for a picture to lay before its own ground marks and figures. */
  drawGroundLight(ctx: CanvasRenderingContext2D): void {
    if (!this.eye || this.night <= 0.02 || !this.out.lights.length) return;
    const eye = this.eye;
    ctx.save();
    ctx.globalCompositeOperation = 'color';
    for (const l of this.out.lights) {
      const a = this.lightHueAt(l);
      if (a <= 0.01) continue;
      const x = eye.worldToScreenX(l.x, l.y), y = eye.worldToScreenY(l.x, l.y, this.where.ground(l.x, l.y)), r = l.radius * HALF_W * eye.zoom;
      ctx.fillStyle = this.lightFill(ctx, l, x, y, r, a);
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }

  /** Everything on the ground at once, uncut: for a picture with nothing standing in front of it. */
  drawGroundAll(ctx: CanvasRenderingContext2D): void {
    for (const rec of this.out.ground) {
      ctx.save();
      rec.draw(ctx);
      ctx.restore();
    }
  }

  /** Everything standing in the world this frame, unsorted, for a picture to sort in with its own figures. */
  worldItems(): WorldRec[] {
    const out = [...this.out.world];
    const ps = this.parts, eye = this.eye;
    if (!eye) return out;
    for (let i = 0; i < ps.span; i++) {
      if (ps.life[i] <= 0 || isLightKind(ps.kind[i])) continue;
      const x = ps.x[i], y = ps.y[i];
      out.push({ x, y, sx: eye.worldToScreenX(x, y), sy: eye.worldToScreenY(x, y, this.where.ground(x, y)) + ps.bias[i], draw: null, p: i });
    }
    return out;
  }
}

const NONE: readonly WorldRec[] = [];
const NO_BODIES: readonly Body[] = [];
const NO_FIRES: FxScene['fired'] = [];

/** How tall a person stands, in height units, for a body the stage is given. */
export const PERSON_TALL = FIGURE_TOP / HEIGHT_SCALE;
/** And how far out from the middle of them a shell goes, in height units. */
export const PERSON_WIDE = 4;

/** A person as the stage wants them: where, turned which way, and enough of their pose to find a hand in. */
export function personBody(x: number, y: number, z: number, facing: number, kind: 'player' | 'peer', figure: FigurePose): Body {
  return { x, y, z, tall: PERSON_TALL, wide: PERSON_WIDE, facing, kind, figure };
}
