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
const BASE_SPEED = 2.4; // tiles per second
const ARRIVE = 0.06;

export class Player {
  x: number;
  y: number;
  name = 'Wanderer';
  /** Facing on screen: 1 right, -1 left. */
  facing = 1;
  moving = false;
  swimming = false;
  walkPhase = 0;
  path: PathPoint[] | null = null;
  inputDir = { x: 0, y: 0 };
  stats: Stats = { health: 1, stamina: 1, hunger: 1, thirst: 1 };

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
  walkTo(world: World, tx: number, ty: number): boolean {
    const path = findPath(world, this.tileX, this.tileY, tx, ty, pathOptions(world));
    if (!path) return false;
    this.path = path.length ? path : null;
    if (!this.path) return true;
    return true;
  }

  stop(): void {
    this.path = null;
    this.inputDir.x = 0;
    this.inputDir.y = 0;
  }

  /** Returns the distance actually moved this frame (tiles). */
  update(dt: number, world: World): number {
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
    if (this.swimming) speed *= 0.42;
    if (this.stats.stamina < 0.1) speed *= 0.5;
    // Uphill slows you down.
    const ahead = world.heightAt(this.x + vx * 0.15, this.y + vy * 0.15);
    const grade = (ahead - h) / (0.15 * UNITS_PER_TILE);
    if (grade > 0) speed /= 1 + grade * 1.6;

    const step = Math.min(speed * dt, distanceLimit);
    const nx = this.x + vx * step;
    const ny = this.y + vy * step;
    let moved = 0;
    if (canOccupy(world, this.x, this.y, nx, ny)) {
      this.x = nx;
      this.y = ny;
      moved = step;
    } else if (canOccupy(world, this.x, this.y, nx, this.y)) {
      this.x = nx;
      moved = Math.abs(vx * step);
    } else if (canOccupy(world, this.x, this.y, this.x, ny)) {
      this.y = ny;
      moved = Math.abs(vy * step);
    } else {
      this.path = null;
    }

    const screenDx = vx - vy;
    if (Math.abs(screenDx) > 0.05) this.facing = screenDx > 0 ? 1 : -1;
    this.moving = moved > 0;
    if (this.moving) this.walkPhase += dt * 11 * (speed / BASE_SPEED);
    return moved;
  }
}

/** Whether a point can be stepped onto from another point. */
export function canOccupy(world: World, fromX: number, fromY: number, toX: number, toY: number): boolean {
  const tx = Math.floor(toX);
  const ty = Math.floor(toY);
  if (!world.isPassable(tx, ty)) return false;
  const dist = Math.hypot(toX - fromX, toY - fromY);
  if (dist < 1e-6) return true;
  const dh = Math.abs(world.heightAt(toX, toY) - world.heightAt(fromX, fromY));
  return dh / (dist * UNITS_PER_TILE) <= MAX_STEP / UNITS_PER_TILE;
}

export function pathOptions(world: World) {
  return {
    passable: (x: number, y: number) => world.isPassable(x, y),
    stepOk: (x0: number, y0: number, x1: number, y1: number) =>
      Math.abs(world.centerHeight(x1, y1) - world.centerHeight(x0, y0)) <= MAX_STEP,
    cost: (x: number, y: number) => {
      const def = TILE_DEFS[world.getTile(x, y)];
      let c = 1 / def.speed;
      if (world.centerHeight(x, y) < -SWIM_DEPTH) c *= 3.5;
      return c;
    },
  };
}
