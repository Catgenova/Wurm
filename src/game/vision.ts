import { TileType } from '../world/tiles';
import { bloodMul } from './creatures';
import type { Game } from './game';
import { heldReach } from './light';

/**
 * What can be seen from where you are standing.
 *
 * Three states, and the difference between them is the whole point: ground
 * nobody has ever laid eyes on is not drawn at all, ground somebody is looking
 * at right now is drawn as it is, and ground that has been walked but is not
 * being watched is drawn as it was last seen, in the cold.
 *
 * The set is worked out with a viewshed: from each pair of eyes, a line is
 * walked out to every tile within range and the steepest thing so far decides
 * whether the next thing is hidden behind it. Standing on a hill sees over a
 * wood; standing in a hollow does not. It is only recomputed when a viewer
 * crosses a tile, when something that blocks the view changes, or once a
 * second for the light, so the cost never lands on a frame that is busy.
 */

/** State of one tile as far as the player is concerned. */
export const UNSEEN = 0;
export const KNOWN = 1;
export const VISIBLE = 2;

/** The characteristic that decides how much of the world reaches you. */
export const AWARENESS = 'awareness';

/** How far you can see on flat ground at noon, in tiles — at awareness 100. */
const BASE_SIGHT = 15;
/** Every this many height units underfoot is worth another tile of range. */
const HEIGHT_PER_TILE = 9;
const MAX_SIGHT = 28;
/**
 * How much of your sight the dark takes.
 *
 * Three quarters of it. A night used to cost about half, which made the dark
 * an inconvenience; at three quarters it is a reason to stop walking, and a
 * reason for the torch to exist.
 */
const NIGHT_LOSS = 0.75;
/**
 * What awareness is worth.
 *
 * Everything above is what somebody at **100** sees. At 1 you see a little
 * over a third of it, and the curve is a square root rather than a straight
 * line because the early levels are the ones that matter: the difference
 * between six tiles and nine is the difference between being walked into and
 * seeing it coming, and the difference between twenty-four and twenty-seven is
 * a nicer view.
 */
const AWARE_FLOOR = 0.36;
export const awarenessReach = (level: number): number =>
  AWARE_FLOOR + (1 - AWARE_FLOOR) * Math.sqrt(Math.max(0, Math.min(100, level)) / 100);
/** Tamed creatures are extra eyes, but not far-seeing ones. */
const COMPANION_SIGHT = 7;
/** A lit fire shows its own ground, however dark it is. */
const FIRE_SIGHT = 6;
/**
 * How far past the edge of sight the map still remembers. You make out the
 * shape of the far bank without standing on it, and a cliff needs a couple of
 * tiles either side of it to read as a cliff rather than a splinter.
 */
const EDGE = 2;

/**
 * How much of the view a thing growing on a tile takes up. Ground blocks by
 * being in the way; a wood blocks by there being a lot of it, so these add up
 * along a line and the view stops when they reach one. Three trees deep is as
 * far as anyone sees into a forest.
 */
const OPACITY: Partial<Record<number, number>> = {
  [TileType.Tree]: 0.34,
  [TileType.Bush]: 0.12,
  [TileType.Reed]: 0.18,
};
/** A finished building stops the view dead. */
const WALL_OPACITY = 1;

export class Vision {
  /** One byte a tile: 0 unseen, 2 in sight now. Known lives in the world. */
  readonly visible: Uint8Array;
  /** Bumped whenever the set changes, so the map knows to repaint. */
  revision = 0;
  /** The box that changed at the last recompute, for anything redrawing. */
  dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** How many tiles are in sight, for the counters. */
  count = 0;

  /**
   * The box everything in sight falls inside. Anything outside it is certainly
   * not being watched, which is four comparisons instead of a lookup — worth
   * having when it is asked of every creature on the map, every frame.
   */
  bounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private lastAt = -1;
  private lastTile = -1;
  private stale = true;
  private readonly w: number;
  private readonly h: number;
  private scratch: Uint8Array;

  constructor(private readonly game: Game) {
    this.w = game.world.w;
    this.h = game.world.h;
    this.visible = new Uint8Array(this.w * this.h);
    this.scratch = new Uint8Array(this.w * this.h);
  }

  /** Something that blocks the view has changed; look again. */
  invalidate(): void {
    this.stale = true;
  }

  state(x: number, y: number): number {
    if (!this.game.settings.fog) return VISIBLE;
    const i = y * this.w + x;
    if (this.visible[i]) return VISIBLE;
    return this.game.world.seen[i] ? KNOWN : UNSEEN;
  }

  isVisible(x: number, y: number): boolean {
    return !this.game.settings.fog || this.visible[y * this.w + x] === 1;
  }

  /** Whether a point in the world is being watched, for creatures and the like. */
  isWatched(wx: number, wy: number): boolean {
    const x = Math.floor(wx);
    const y = Math.floor(wy);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.isVisible(x, y);
  }

  /**
   * Work the set out again if anything has moved or changed. Called every
   * frame; it does the work rarely.
   */
  update(): void {
    const g = this.game;
    if (!g.settings.fog) return;
    const tile = g.player.tileY * this.w + g.player.tileX;
    const aged = g.time - this.lastAt > 1;
    if (!this.stale && tile === this.lastTile && !aged) return;
    this.stale = false;
    this.lastTile = tile;
    this.lastAt = g.time;
    this.recompute();
  }

  /**
   * The distance the player can see right now.
   *
   * Four things have a say, in this order: how much you notice, how high you
   * are standing, how dark it is, and what you are carrying that burns.
   */
  sightRange(): number {
    const g = this.game;
    const up = Math.max(0, g.world.heightAt(g.player.x, g.player.y));
    // What you would see in broad daylight, given how much you notice.
    const open = (BASE_SIGHT + up / HEIGHT_PER_TILE) * awarenessReach(g.skills.get(AWARENESS));
    /*
     * And what the dark takes off it. A light in your hand gives most of that
     * back — three quarters of what the night took — and its own reach is a
     * floor under your sight however black the hour: you can always see as far
     * as the thing you are carrying throws.
     */
    const lamp = g.heldLight();
    const day = 1 - NIGHT_LOSS * g.darkness() * (lamp ? 0.25 : 1);
    // The reader's path sees a quarter further than anybody else.
    const keen = g.walks('knowledge', 5) ? 1.25 : 1;
    const seen = Math.max(3, Math.min(MAX_SIGHT * keen, open * day * keen));
    return lamp ? Math.max(seen, heldReach(lamp.id, lamp.ql)) : seen;
  }

  private recompute(): void {
    const g = this.game;
    const next = this.scratch;
    // Clearing the whole island every look would grow with the map too; only
    // what was written last time needs wiping.
    const last = this.bounds;
    if (last) {
      for (let y = Math.max(0, last.y0 - EDGE); y <= Math.min(this.h - 1, last.y1 + EDGE); y++) {
        const row = y * this.w;
        next.fill(0, row + Math.max(0, last.x0 - EDGE), row + Math.min(this.w - 1, last.x1 + EDGE) + 1);
      }
    } else next.fill(0);
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    const mark = (x: number, y: number): void => {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    };

    this.cast(next, g.player.x, g.player.y, this.sightRange(), mark);
    // Your own creatures are eyes as well, and a settlement is watched by the
    // people in it whether or not you are standing in the middle of it.
    for (const c of g.creatures.list.values()) {
      if (c.mode === 'wild' || c.mode === 'stored') continue;
      const def = g.creatures.species(c);
      // A watcher is worth a hill; a Lume carries its own daylight about with
      // it, so what it lights is lit whatever the hour.
      const keen = bloodMul(c, 'sight');
      const range = def.glow ? Math.max(def.glow, COMPANION_SIGHT * (1 - NIGHT_LOSS * g.darkness())) * keen : (def.sight ?? COMPANION_SIGHT) * keen * (1 - NIGHT_LOSS * g.darkness() * 0.5);
      this.cast(next, c.x, c.y, Math.max(3, range), mark);
    }
    const deed = g.deed;
    if (deed) {
      for (let y = deed.y - deed.radius; y <= deed.y + deed.radius; y++) {
        for (let x = deed.x - deed.radius; x <= deed.x + deed.radius; x++) {
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          next[y * this.w + x] = 1;
          mark(x, y);
        }
      }
    }
    // Anything alight shows the ground around it, however dark the hour.
    for (const f of g.campfires.values()) if (f.lit) this.cast(next, f.x + 0.5, f.y + 0.5, FIRE_SIGHT, mark);
    for (const s of g.smelters.values()) if (s.lit) this.cast(next, s.x + 0.5, s.y + 0.5, FIRE_SIGHT, mark);
    for (const k of g.kilns.values()) if (k.lit) this.cast(next, k.x + 0.5, k.y + 0.5, FIRE_SIGHT, mark);
    for (const f of g.furniture.values()) if (f.lit) this.cast(next, f.x + 0.5, f.y + 0.5, FIRE_SIGHT, mark);

    // Only the ground that was in sight last time or is in sight now can have
    // changed, so the work stays the size of a viewshed however big the map
    // gets. Sweeping the whole island here would be the one thing in this that
    // grows with the map, which is the opposite of the point.
    const world = g.world;
    const prev = this.bounds;
    const rx0 = Math.max(0, Math.min(x0, prev ? prev.x0 : x0) - EDGE);
    const ry0 = Math.max(0, Math.min(y0, prev ? prev.y0 : y0) - EDGE);
    const rx1 = Math.min(this.w - 1, Math.max(x1, prev ? prev.x1 : x1) + EDGE);
    const ry1 = Math.min(this.h - 1, Math.max(y1, prev ? prev.y1 : y1) + EDGE);
    this.bounds = x1 >= 0 ? { x0, y0, x1, y1 } : null;
    let changed = false;
    let count = 0;
    for (let y = ry0; y <= ry1; y++) {
      for (let x = rx0; x <= rx1; x++) {
        const i = y * this.w + x;
        if (next[i]) count++;
        if (next[i] === this.visible[i]) continue;
        changed = true;
        mark(x, y);
      }
    }
    this.count = count;
    if (changed) {
      // Everything in sight is written into the map's memory as it stands now,
      // and so is the ring just past it: you see the edge of the far bank
      // without standing on it, and a cliff drawn one tile wide with nothing
      // either side of it reads as a shard rather than a cliff.
      for (let y = ry0; y <= ry1; y++) {
        for (let x = rx0; x <= rx1; x++) {
        if (!next[y * this.w + x]) continue;
        world.remember(x, y);
        for (let ny = y - EDGE; ny <= y + EDGE; ny++) {
          if (ny < 0 || ny >= this.h) continue;
          for (let nx = x - EDGE; nx <= x + EDGE; nx++) {
            if (nx < 0 || nx >= this.w) continue;
            if (world.remember(nx, ny)) mark(nx, ny);
          }
        }
        }
      }
      // Only the box that was touched needs copying back.
      for (let y = ry0; y <= ry1; y++) {
        const row = y * this.w;
        this.visible.set(next.subarray(row + rx0, row + rx1 + 1), row + rx0);
      }
      this.revision++;
      this.dirty = x1 >= 0 ? { x0, y0, x1, y1 } : null;
    } else {
      this.dirty = null;
    }
  }

  /**
   * Walk a line out to every tile within `range` of an eye and mark what the
   * ground allows it to see. The steepest slope met so far hides anything
   * lying behind it, which is what makes a hill worth standing on.
   */
  private cast(out: Uint8Array, ex: number, ey: number, range: number, mark: (x: number, y: number) => void): void {
    const world = this.game.world;
    const eyeX = Math.floor(ex);
    const eyeY = Math.floor(ey);
    if (eyeX < 0 || eyeY < 0 || eyeX >= this.w || eyeY >= this.h) return;
    const eyeH = world.centerHeight(eyeX, eyeY) + 6;
    const r = Math.ceil(range);
    const r2 = range * range;
    out[eyeY * this.w + eyeX] = 1;
    mark(eyeX, eyeY);
    for (let dy = -r; dy <= r; dy++) {
      const ty = eyeY + dy;
      if (ty < 0 || ty >= this.h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const tx = eyeX + dx;
        if (tx < 0 || tx >= this.w) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2 || d2 === 0) continue;
        if (out[ty * this.w + tx]) continue;
        if (this.lineOfSight(eyeX, eyeY, eyeH, tx, ty)) {
          out[ty * this.w + tx] = 1;
          mark(tx, ty);
        }
      }
    }
  }

  /**
   * Whether the ground and what grows on it leave the far tile in view. The
   * ground is judged by slope — a ridge hides the hollow behind it — and trees
   * and walls by how much of the view they take up between here and there.
   */
  private lineOfSight(ex: number, ey: number, eyeH: number, tx: number, ty: number): boolean {
    const world = this.game.world;
    const buildings = this.game.buildings;
    const dx = tx - ex;
    const dy = ty - ey;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (steps <= 1) return true;
    const stepX = dx / steps;
    const stepY = dy / steps;
    let slope = -Infinity;
    let opacity = 0;
    for (let i = 1; i < steps; i++) {
      const cx = Math.round(ex + stepX * i);
      const cy = Math.round(ey + stepY * i);
      opacity += OPACITY[world.tiles[cy * this.w + cx]] ?? 0;
      if (buildings.list.size && buildings.buildingAt(cx, cy)) opacity += WALL_OPACITY;
      if (opacity >= 1) return false;
      const s = (world.centerHeight(cx, cy) - eyeH) / i;
      if (s > slope) slope = s;
    }
    return (world.centerHeight(tx, ty) + 2 - eyeH) / steps >= slope;
  }
}
