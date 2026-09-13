import { UNITS_PER_TILE } from '../render/iso';
import { findPath, type PathPoint } from '../world/pathfinding';
import { TILE_DEFS } from '../world/tiles';
import type { World } from '../world/world';

export interface Stats {
  health: number;
  stamina: number;
  hunger: number;
  thirst: number;
}

/** Steepest climb allowed between two adjacent tile centres, in height units. */
export const MAX_STEP = 32;
/** Water deeper than this (in height units below the surface) means swimming. */
export const SWIM_DEPTH = 4;
/** Share of walking speed kept in deep water before any swimming skill. */
export const SWIM_SPEED = 0.42;
const BASE_SPEED = 2.4; // tiles per second
const ARRIVE = 0.06;

export class Player {
  x: number;
  y: number;
  name = 'Wanderer';
  /** Last movement direction in world space; the renderer turns it into a screen facing. */
  dirX = 1;
  dirY = 0;
  /** Storey the player stands on; 0 is the ground. */
  level = 0;
  /** Last creature that hurt the player, for defensive companions. */
  attackedBy: number | null = null;
  attackedAt = -1e9;
  /** Eased copy of `level` for drawing, so climbing stairs is not a jump. */
  visualLevel = 0;
  moving = false;
  swimming = false;
  walkPhase = 0;
  path: PathPoint[] | null = null;
  inputDir = { x: 0, y: 0 };
  stats: Stats = { health: 1, stamina: 1, hunger: 1, thirst: 1 };
  /** Steepest step allowed, raised by the climbing skill. */
  maxStep = MAX_STEP;
  /** Share of walking speed kept in deep water, raised by the swimming skill. */
  swimSpeed = SWIM_SPEED;
  /** Steepness of the last step taken between tiles, for the climbing skill. */
  lastClimb = 0;

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
    const path = findPath(world, this.tileX, this.tileY, this.level, tx, ty, pathOptions(world, rule, levels));
    if (!path) return false;
    this.path = path.length ? path : null;
    return true;
  }

  stop(): void {
    this.path = null;
    this.inputDir.x = 0;
    this.inputDir.y = 0;
  }

  /** Returns the distance actually moved this frame (tiles). */
  update(dt: number, world: World, rule?: StepRule): number {
    this.visualLevel += (this.level - this.visualLevel) * Math.min(1, dt * 7);
    if (Math.abs(this.level - this.visualLevel) < 0.01) this.visualLevel = this.level;
    const step = (x0: number, y0: number, x1: number, y1: number): number | null =>
      rule ? rule(x0, y0, this.level, x1, y1) : groundStep(world, x0, y0, x1, y1, this.maxStep) ? this.level : null;
    let vx = 0;
    let vy = 0;
    let distanceLimit = Infinity;
    if (this.inputDir.x !== 0 || this.inputDir.y !== 0) {
      this.path = null;
      const len = Math.hypot(this.inputDir.x, this.inputDir.y);
      vx = this.inputDir.x / len;
      vy = this.inputDir.y / len;
    } else if (this.path && this.path.length) {
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
    this.swimming = h < -SWIM_DEPTH;

    if (vx === 0 && vy === 0) {
      this.moving = false;
      return 0;
    }

    const tileDef = TILE_DEFS[world.getTile(this.tileX, this.tileY)];
    let speed = BASE_SPEED * tileDef.speed;
    if (this.swimming) speed *= this.swimSpeed;
    if (this.stats.stamina < 0.1) speed *= 0.5;
    // Uphill slows you down.
    const ahead = world.heightAt(this.x + vx * 0.15, this.y + vy * 0.15);
    const grade = (ahead - h) / (0.15 * UNITS_PER_TILE);
    if (grade > 0) speed /= 1 + grade * 1.6;

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
    if (!world.isPassable(tx, ty)) return false;
    const fx = this.tileX;
    const fy = this.tileY;
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

/** Something (a wall) that forbids stepping from one tile to another. */
export type StepBlock = (x0: number, y0: number, x1: number, y1: number) => boolean;

/** Decides a step between tiles: the storey you land on, or null when it is not allowed. */
export type StepRule = (x0: number, y0: number, level: number, x1: number, y1: number) => number | null;

export function pathOptions(world: World, rule?: StepRule, levels = 1) {
  return {
    passable: (x: number, y: number) => world.isPassable(x, y),
    step: (x0: number, y0: number, level: number, x1: number, y1: number): number | null =>
      rule ? rule(x0, y0, level, x1, y1) : groundStep(world, x0, y0, x1, y1) ? level : null,
    levels,
    cost: (x: number, y: number) => {
      const def = TILE_DEFS[world.getTile(x, y)];
      let c = 1 / def.speed;
      if (world.centerHeight(x, y) < -SWIM_DEPTH) c *= 3.5;
      return c;
    },
  };
}
