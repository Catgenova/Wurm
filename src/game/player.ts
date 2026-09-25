import type { Boon } from './boons';
import type { Wound } from './wounds';
import type { PathId } from './meditation';
import type { BeltPin } from './belt';
import { emptyNutrition, type Nutrient } from './nutrition';
import { BELT_MAX } from './belt';
import { UNITS_PER_TILE } from '../render/iso';
import { findPath, type PathPoint } from '../world/pathfinding';
import { groundRoll, TILE_DEFS } from '../world/tiles';
import type { World } from '../world/world';
import { cleanLook, DEFAULT_LOOK, type Look } from './look';

export interface Stats {
  health: number;
  stamina: number;
  hunger: number;
  thirst: number;
}

/** Steepest climb allowed between two adjacent tile centres, in height units. */
export const MAX_STEP = 32;

/**
 * What a level of climbing adds to that.
 *
 * It was written inline in `Game.climbStep` and nowhere else, which was fine
 * while nothing else needed it. The island checks the ground under a claimed
 * walk now, so it needs the same allowance — and a number that lives in two
 * places is the one thing this repository will not have.
 */
export const CLIMB_PER_LEVEL = 0.4;
/**
 * The steepest tile a body can stand on: sixty between its highest corner and
 * its lowest, before climbing, which raises it at the rate it raises the
 * step. The step between tiles is asked about separately; this is the tile
 * itself. The island reads the same number.
 */
export const MAX_STAND = 60;
/** Above this a tile is slow going whichever way it is crossed, and the pace falls off with the slope. */
export const SLOW_SLOPE = 40;

/** Water deeper than this (in height units below the surface) means swimming. */
export const SWIM_DEPTH = 4;
/** Share of walking speed kept in deep water before any swimming skill. */
export const SWIM_SPEED = 0.42;
export const BASE_SPEED = 2.4; // tiles per second
/**
 * What is left of your pace half again over the limit.
 *
 * It was nought — "when inventory is above 150% cap, movement speed becomes
 * 0" — and nought has a sharp edge on it: a body that cannot move at all is a
 * body that cannot get itself out of the trouble it walked into, and the only
 * way out was to put things on the ground where they stood. Asked for now:
 * five per cent. That is a hundredth of a tile a second short of nothing, so
 * it is still a wall in every way that matters — you will not carry a hill of
 * ore home on it — but a wall you can creep along rather than one you are
 * pinned to. The island reads the same number.
 */
export const CARRY_CRAWL = 0.05;
const ARRIVE = 0.06;

export class Player {
  x: number;
  y: number;
  name = 'Wanderer';
  /**
   * Skin, hair, eyes, build and the clothes washed ashore in.
   *
   * On the body rather than in a settings file, because it travels: it is
   * saved with the game, sent to everybody else on an island, and read back
   * off `player.look` when you come ashore somewhere you have been before.
   */
  look: Look = DEFAULT_LOOK;
  /**
   * An emote in progress, and when it started on the drawing clock.
   *
   * `performance.now()`, not `game.time`: the world clock runs at its own pace
   * and a wave is a second and a half of *yours*. The roster stamps other
   * people's the same way, off the same clock, so the two are drawn alike.
   */
  emote?: string;
  emoteAt?: number;
  /** Last movement direction in world space; the renderer turns it into a screen facing. */
  dirX = 1;
  dirY = 0;
  /** Storey the player stands on; 0 is the ground. */
  level = 0;
  /**
   * Rest banked from a night in a bed, in seconds. It burns while you work,
   * and everything you do while it burns teaches you twice as much.
   */
  rested = 0;
  /** Knacks running just now off what you have eaten and drunk; these wear off. */
  boons: Boon[] = [];
  /** What is actually in you, by nutrient. Eating well holds hunger off and teaches you more. */
  nutrition: Record<Nutrient, number> = emptyNutrition();
  /** The path chosen at the rug, once and for good, and when you last sat. */
  way: PathId | null = null;
  satAt = -1e9;
  /** Game time each path ability was last called on. */
  usedAt: Record<string, number> = {};
  /** Banked favour, and the hour you last had anything to say. */
  favour = 0;
  prayedAt = -1e9;
  /** What is open on you, and what is on it. */
  wounds: Wound[] = [];
  nextWound = 1;
  /** Knacks earned at the work, by trade: each is worth a tenth more gain in it. */
  knacks: Record<string, number> = {};
  /** Titles earned, and the one being worn. */
  titles: string[] = [];
  title: string | null = null;
  /** Last creature that hurt the player, for defensive companions. */
  attackedBy: number | null = null;
  attackedAt = -1e9;
  /** Eased copy of `level` for drawing, so climbing stairs is not a jump. */
  visualLevel = 0;
  moving = false;
  swimming = false;
  /**
   * Whether something else is holding you up: a hull, a cart bed, a saddle.
   *
   * Deep water was read off the ground and nothing else, so a hull in thirty
   * feet of water was *swimming* — slowed to a swimmer's share of a walking
   * pace and spending a swimmer's wind, in a boat, which is the one thing a
   * boat is for. A Wadd carrying a rider across a sound was the same. The
   * question deep water actually asks is whether your own feet are in it, and
   * only the game knows what is under you, so it says so each tick.
   */
  carried = false;
  /**
   * The hull this body rides in as a passenger, by its furniture id, and the
   * place on her deck it has. A passenger goes where she goes: nothing it
   * asks of its own feet moves it.
   */
  aboard: number | null = null;
  seat = 0;
  walkPhase = 0;
  path: PathPoint[] | null = null;
  stats: Stats = { health: 1, stamina: 1, hunger: 1, thirst: 1 };
  /** What is worn or held, by slot: the uid of the item, or null. */
  equipped: Record<string, number | null> = { head: null, chest: null, arms: null, legs: null, feet: null, weapon: null, offhand: null };
  /** Jobs hung on the belt's loops, by loop. Only as many as the belt has are reachable. */
  belt: Array<BeltPin | null> = Array.from({ length: BELT_MAX }, () => null);
  /** How much armour is weighing you down, 0 for nothing worn. */
  burden = 0;
  /**
   * Carrying more than a body can walk under. Set from `Game.stalled`, which
   * is the same sum the island holds a body to. Not a stop any more — a
   * twentieth of your pace, `CARRY_CRAWL` — so the name is a shade strong
   * for what it now does, and kept because it is what both sides call it.
   */
  stalled = false;
  /** Steepest step allowed, raised by the climbing skill. */
  maxStep = MAX_STEP;
  /** Steepest tile that can be stood on, raised by the climbing skill. */
  maxStand = MAX_STAND;
  /** Share of walking speed kept in deep water, raised by the swimming skill. */
  swimSpeed = SWIM_SPEED;
  /** Steepness of the last step taken between tiles, for the climbing skill. */
  lastClimb = 0;
  /**
   * What the legs are worth against the usual walking pace. One on foot; a
   * team's pace when there is a vehicle under you, which is how a wagon full
   * of stone still gets home before dark.
   */
  speedMul = 1;
  /**
   * How full whatever is under you is, 0..1, and 0 when you are on your own
   * feet. It decides how much the ground tells on you.
   */
  wheelLoad = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  get tileX(): number {
    return Math.floor(this.x);
  }

  get tileY(): number {
    return Math.floor(this.y);
  }

  /** Path to a tile; returns false when unreachable. */
  walkTo(world: World, tx: number, ty: number, rule?: StepRule, levels = 1): boolean {
    const path = findPath(world, this.tileX, this.tileY, this.level, tx, ty, pathOptions(world, rule, levels, this.wheelLoad));
    if (!path) return false;
    this.path = path.length ? path : null;
    return true;
  }

  stop(): void {
    this.path = null;
  }

  /** Returns the distance actually moved this frame (tiles). */
  update(dt: number, world: World, rule?: StepRule): number {
    this.visualLevel += (this.level - this.visualLevel) * Math.min(1, dt * 7);
    if (Math.abs(this.level - this.visualLevel) < 0.01) this.visualLevel = this.level;
    const step = (x0: number, y0: number, x1: number, y1: number): number | null =>
      rule ? rule(x0, y0, this.level, x1, y1) : groundStep(world, x0, y0, x1, y1, this.maxStep) && standsOn(world, x1, y1, this.maxStand) ? this.level : null;
    let vx = 0;
    let vy = 0;
    let distanceLimit = Infinity;
    /*
     * A body goes where it is walking to and nowhere else.
     *
     * There used to be a second way in here: a held direction, straight off the
     * keys, which steered the body frame by frame and threw the path away. The
     * keys push the view now, nothing feeds a direction in, and a branch nobody
     * can reach is worse than no branch at all — it reads like a thing that
     * still happens.
     */
    if (this.path && this.path.length) {
      const wp = this.path[0];
      const dx = wp.x + 0.5 - this.x;
      const dy = wp.y + 0.5 - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < ARRIVE) {
        this.path.shift();
        if (!this.path.length) this.path = null;
        this.x = wp.x + 0.5;
        this.y = wp.y + 0.5;
      } else {
        vx = dx / dist;
        vy = dy / dist;
        distanceLimit = dist;
      }
    }

    const h = world.heightAt(this.x, this.y);
    this.swimming = !this.carried && h < -SWIM_DEPTH;

    if (vx === 0 && vy === 0) {
      this.moving = false;
      return 0;
    }

    const tileDef = TILE_DEFS[world.getTile(this.tileX, this.tileY)];
    // Feet hardly care what is under them. A laden wheel cares about little
    // else, and that is what makes a paved road worth the stone in it.
    let speed = BASE_SPEED * tileDef.speed * this.speedMul * groundRoll(tileDef.roll, this.wheelLoad);
    if (this.swimming) speed *= this.swimSpeed;
    if (this.stats.stamina < 0.1) speed *= 0.5;
    if (this.burden > 0) speed /= 1 + this.burden;
    /*
     * And a load half again over the limit leaves you a twentieth of your
     * pace. The walk is no longer dropped: at five per cent you are still
     * going somewhere, slowly, so a path is a thing worth keeping — and the
     * island allows the same fraction on the same sum, so the few inches
     * taken here are inches it will let you keep.
     */
    if (this.stalled) speed *= CARRY_CRAWL;
    // Uphill slows you down.
    const ahead = world.heightAt(this.x + vx * 0.15, this.y + vy * 0.15);
    const grade = (ahead - h) / (0.15 * UNITS_PER_TILE);
    if (grade > 0) speed /= 1 + grade * 1.6;
    // And a steep tile is slow going whichever way it is crossed — on your
    // own feet. A hull floats over whatever the bottom does, and a seat has
    // legs or wheels under it that answer for their own pace.
    const steep = this.carried ? 0 : world.slope(this.tileX, this.tileY);
    if (steep > SLOW_SLOPE) speed *= SLOW_SLOPE / steep;

    const len = Math.min(speed * dt, distanceLimit);
    const nx = this.x + vx * len;
    const ny = this.y + vy * len;
    let moved = 0;
    if (this.tryMove(world, nx, ny, step)) moved = len;
    else if (this.tryMove(world, nx, this.y, step)) moved = Math.abs(vx * len);
    else if (this.tryMove(world, this.x, ny, step)) moved = Math.abs(vy * len);
    else this.path = null;

    if (moved > 0) {
      this.dirX = vx;
      this.dirY = vy;
    }
    this.moving = moved > 0;
    if (this.moving) this.walkPhase += dt * 11 * (speed / BASE_SPEED);
    return moved;
  }

  /** Move to a point if the tile it lies on can be entered from here; updates the storey. */
  private tryMove(world: World, nx: number, ny: number, step: (x0: number, y0: number, x1: number, y1: number) => number | null): boolean {
    const tx = Math.floor(nx);
    const ty = Math.floor(ny);
    const fx = this.tileX;
    const fy = this.tileY;
    /*
     * A body can always walk out of somewhere it should not be.
     *
     * The first stride of any walk stays inside the tile the body started in,
     * so asking whether that tile may be entered pins anyone who is already
     * standing in one that may not: all three attempts fail, the path is
     * thrown away, and the only way out is to take the obstacle down. Whoever
     * ends up inside a tree — by planting one, by somebody else planting one,
     * or by a tile change arriving from the island — gets to leave on foot.
     * Walking *into* a blocked tile is refused exactly as before.
     */
    if (!world.isPassable(tx, ty) && !(tx === fx && ty === fy)) return false;
    if (fx !== tx || fy !== ty) {
      const level = step(fx, fy, tx, ty);
      if (level === null) return false;
      this.lastClimb = Math.abs(world.centerHeight(tx, ty) - world.centerHeight(fx, fy));
      this.level = level;
    }
    this.x = nx;
    this.y = ny;
    return true;
  }
}

/**
 * Terrain-only rule for a step between tiles: nothing steeper than `maxStep`,
 * which for the player grows with climbing and for everything else is MAX_STEP.
 */
export function groundStep(world: World, x0: number, y0: number, x1: number, y1: number, maxStep = MAX_STEP): boolean {
  return Math.abs(world.centerHeight(x1, y1) - world.centerHeight(x0, y0)) <= maxStep;
}

/**
 * Terrain-only rule for standing on a tile: nothing steeper than `maxStand`
 * between its highest corner and its lowest, which for the player grows with
 * climbing and for everything else is MAX_STAND. A body already inside a tile
 * that has been dug too steep under it is never asked this; it is asked of
 * the tile being stepped into.
 */
export function standsOn(world: World, x: number, y: number, maxStand = MAX_STAND): boolean {
  return world.slope(x, y) <= maxStand;
}

/** Something (a wall) that forbids stepping from one tile to another. */
export type StepBlock = (x0: number, y0: number, x1: number, y1: number) => boolean;

/** Decides a step between tiles: the storey you land on, or null when it is not allowed. */
export type StepRule = (x0: number, y0: number, level: number, x1: number, y1: number) => number | null;

export function pathOptions(world: World, rule?: StepRule, levels = 1, wheelLoad = 0) {
  return {
    passable: (x: number, y: number) => world.isPassable(x, y),
    step: (x0: number, y0: number, level: number, x1: number, y1: number): number | null =>
      rule ? rule(x0, y0, level, x1, y1) : groundStep(world, x0, y0, x1, y1) && standsOn(world, x1, y1) ? level : null,
    levels,
    cost: (x: number, y: number) => {
      const def = TILE_DEFS[world.getTile(x, y)];
      // A laden wagon is routed the way a carter would take it: round the bog
      // and along the stone, even when the stone is the longer way about.
      let c = 1 / (def.speed * groundRoll(def.roll, wheelLoad));
      if (world.centerHeight(x, y) < -SWIM_DEPTH) c *= 3.5;
      return c;
    },
  };
}

/**
 * A body, written down.
 *
 * There was one of these and it lived in two halves: a long line in the save
 * that read every field off the player, and a longer block in the game's
 * constructor that put them all back. That was fine while there was one body
 * on the island. There is more than one now — the person at the screen and
 * everybody visiting — and two copies of a list of twenty fields is two places
 * for a field to go missing from.
 *
 * So it is one shape and two functions, and the host's body and a guest's go
 * through exactly the same pair. Whatever a body is, it is this, for everyone.
 */
export interface PlayerSave {
  x: number;
  y: number;
  name: string;
  stats: Stats;
  level?: number;
  equipped?: Record<string, number | null>;
  rested?: number;
  boons?: Boon[];
  knacks?: Record<string, number>;
  nutrition?: Record<Nutrient, number>;
  /** What knacks were called before they were called knacks. */
  affinities?: Record<string, number>;
  titles?: string[];
  title?: string | null;
  wounds?: Wound[];
  nextWound?: number;
  favour?: number;
  prayedAt?: number;
  way?: PathId | null;
  satAt?: number;
  usedAt?: Record<string, number>;
  belt?: Array<BeltPin | null>;
  /** Absent in every save written before there was a creator; those get the default. */
  look?: Look;
}

export function writePlayer(p: Player): PlayerSave {
  return {
    x: p.x,
    y: p.y,
    name: p.name,
    look: p.look,
    stats: p.stats,
    level: p.level,
    equipped: p.equipped,
    rested: p.rested,
    boons: p.boons,
    knacks: p.knacks,
    nutrition: p.nutrition,
    titles: p.titles,
    title: p.title,
    wounds: p.wounds,
    nextWound: p.nextWound,
    favour: p.favour,
    prayedAt: p.prayedAt,
    way: p.way,
    satAt: p.satAt,
    usedAt: p.usedAt,
    belt: p.belt,
  };
}

export function readPlayer(p: Player, saved: PlayerSave): void {
  p.x = saved.x;
  p.y = saved.y;
  p.name = saved.name;
  p.stats = { ...saved.stats };
  p.level = saved.level ?? 0;
  p.visualLevel = p.level;
  if (saved.equipped) p.equipped = { ...p.equipped, ...saved.equipped };
  p.rested = saved.rested ?? 0;
  p.boons = saved.boons ?? [];
  p.nutrition = { ...emptyNutrition(), ...(saved.nutrition ?? {}) };
  // A save written before knacks were called knacks still says affinities.
  p.knacks = saved.knacks ?? saved.affinities ?? {};
  p.titles = saved.titles ?? [];
  p.title = saved.title ?? null;
  p.wounds = saved.wounds ?? [];
  p.nextWound = saved.nextWound ?? 1;
  p.favour = saved.favour ?? 0;
  p.prayedAt = saved.prayedAt ?? -1e9;
  p.way = saved.way ?? null;
  p.satAt = saved.satAt ?? -1e9;
  p.usedAt = saved.usedAt ?? {};
  // Cleaned rather than trusted: a save is a file on somebody's own machine,
  // and this is the same value that ends up in `fillStyle`.
  if (saved.look) p.look = cleanLook(saved.look);
  if (saved.belt) for (let i = 0; i < BELT_MAX; i += 1) p.belt[i] = saved.belt[i] ?? null;
}
