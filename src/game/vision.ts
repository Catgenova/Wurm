import { TileType } from '../world/tiles';
import { isDone, WALL_TYPE_BY_ID } from './building';
import { bloodMul } from './creatures';
import type { Game } from './game';
import { heldReach } from './light';
import { KEEN_SIGHT } from './meditation';

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
export const BASE_SIGHT = 15;
/** Every this many height units underfoot is worth another tile of range. */
const HEIGHT_PER_TILE = 9;
export const MAX_SIGHT = 28;
/**
 * How much of your sight the dark takes.
 *
 * Three quarters of it. A night used to cost about half, which made the dark
 * an inconvenience; at three quarters it is a reason to stop walking, and a
 * reason for the torch to exist.
 */
export const NIGHT_LOSS = 0.75;
/** How much of what the night took a light in your hand gives back. */
export const LIGHT_GIVES_BACK = 0.75;
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
/** Tamed creatures are extra eyes, but not far-seeing ones: this many tiles, unless the kind says otherwise. */
export const COMPANION_SIGHT = 7;
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
export const TREE_OPACITY = 0.34;
const OPACITY: Partial<Record<number, number>> = {
  [TileType.Tree]: TREE_OPACITY,
  [TileType.Bush]: 0.12,
  [TileType.Reed]: 0.18,
};

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
  /**
   * The borders a finished solid wall stands on, storey by storey, as numbers
   * (`borderKey`). Gathered once a look rather than asked of the buildings a
   * border at a time: a look follows thousands of lines, and asked one at a
   * time every crossing made a string to look itself up by, which more than
   * doubled what a look cost among a dozen houses.
   */
  private readonly shut = new Map<number, Set<number>>();

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
     * back — `LIGHT_GIVES_BACK` of what the night took — and its own reach is a
     * floor under your sight however black the hour: you can always see as far
     * as the thing you are carrying throws.
     */
    const lamp = g.heldLight();
    const day = 1 - NIGHT_LOSS * g.darkness() * (lamp ? 1 - LIGHT_GIVES_BACK : 1);
    // The reader's path sees further than anybody else.
    const keen = g.walks('knowledge', 5) ? KEEN_SIGHT : 1;
    const seen = Math.max(3, Math.min(MAX_SIGHT * keen, open * day * keen));
    return lamp ? Math.max(seen, heldReach(lamp.id, lamp.ql)) : seen;
  }

  private recompute(): void {
    const g = this.game;
    const next = this.scratch;
    // Walls go up and come down between looks; what shuts the eye is gathered afresh each time.
    this.shut.clear();
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

    this.cast(next, g.player.x, g.player.y, this.sightRange(), mark, g.player.level);
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
   * lying behind it, which is what makes a hill worth standing on. `level` is
   * the storey the eye is on, whose walls are the ones in its way.
   */
  private cast(out: Uint8Array, ex: number, ey: number, range: number, mark: (x: number, y: number) => void, level = 0): void {
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
        if (this.lineOfSight(eyeX, eyeY, eyeH, tx, ty, level)) {
          out[ty * this.w + tx] = 1;
          mark(tx, ty);
        }
      }
    }
  }

  /**
   * Whether the ground, what grows on it and the walls standing on it leave
   * the far tile in view. The ground is judged by slope — a ridge hides the
   * hollow behind it — trees by how much of the view they take up between
   * here and there, and walls by the borders the line crosses.
   *
   * A wall stands on the border between two tiles, so that is where it is
   * asked about (`wallInTheWay`). Only a solid wall stops the eye. It used to
   * be every tile a building stood on, whatever stood round it, which is the
   * same rule as a solid block: from a doorway you saw the first tile in and
   * nothing past it, and from inside a house you saw the tiles touching you
   * and no further -- reported as "i can see through the doors, but only one
   * tile deep", with the night's radius a long way off.
   */
  private lineOfSight(ex: number, ey: number, eyeH: number, tx: number, ty: number, level = 0): boolean {
    const world = this.game.world;
    if (this.game.buildings.walls.size && this.wallInTheWay(level, ex, ey, tx, ty)) return false;
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
      if (opacity >= 1) return false;
      const s = (world.centerHeight(cx, cy) - eyeH) / i;
      if (s > slope) slope = s;
    }
    return (world.centerHeight(tx, ty) + 2 - eyeH) / steps >= slope;
  }

  /**
   * Whether a wall that stops the eye stands across the line from the middle
   * of one tile to the middle of another.
   *
   * The line is followed border by border, every border it crosses in the
   * order it crosses them, rather than tile by rounded tile: rounded, a line
   * two tiles out from a doorway stepped round the jamb and saw the tile
   * beside the door on the inside. Followed exactly, a doorway shows the
   * wedge of the room behind it that a real one does, wider the further in
   * you look. A line through a corner exactly is stopped only when both ways
   * round the corner are, as feet are.
   */
  private wallInTheWay(level: number, ex: number, ey: number, tx: number, ty: number): boolean {
    const shut = this.shutAt(level);
    if (!shut.size) return false;
    // Across the border on the east or west of (x, y), and on the north or south.
    const acrossX = (x: number, y: number, sx: number): boolean => shut.has(this.borderKey('v', sx > 0 ? x + 1 : x, y));
    const acrossY = (x: number, y: number, sy: number): boolean => shut.has(this.borderKey('h', x, sy > 0 ? y + 1 : y));
    const dx = tx - ex;
    const dy = ty - ey;
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    // How far along the line, as a fraction of it, the borders come: the
    // first half a tile out, and one tile's worth apart after that.
    const everyX = dx ? 1 / Math.abs(dx) : Infinity;
    const everyY = dy ? 1 / Math.abs(dy) : Infinity;
    let nextX = everyX / 2;
    let nextY = everyY / 2;
    let x = ex;
    let y = ey;
    while (x !== tx || y !== ty) {
      if (Math.abs(nextX - nextY) < 1e-9) {
        const aroundX = !acrossX(x, y, sx) && !acrossY(x + sx, y, sy);
        const aroundY = !acrossY(x, y, sy) && !acrossX(x, y + sy, sx);
        if (!aroundX && !aroundY) return true;
        x += sx;
        y += sy;
        nextX += everyX;
        nextY += everyY;
      } else if (nextX < nextY) {
        if (acrossX(x, y, sx)) return true;
        x += sx;
        nextX += everyX;
      } else {
        if (acrossY(x, y, sy)) return true;
        y += sy;
        nextY += everyY;
      }
    }
    return false;
  }

  /**
   * One border as a number. A vertical one at `x` stands between tiles x - 1
   * and x, a horizontal one at `y` between rows y - 1 and y -- the buildings'
   * own reckoning -- so a border can sit on the far edge of the map, and the
   * rows are one wider than the map is.
   */
  private borderKey(dir: 'v' | 'h', x: number, y: number): number {
    return (y * (this.w + 1) + x) * 2 + (dir === 'v' ? 1 : 0);
  }

  /** The borders shut to the eye on a storey: a finished wall of a type that is `opaque`. */
  private shutAt(level: number): Set<number> {
    let set = this.shut.get(level);
    if (set) return set;
    set = new Set();
    for (const w of this.game.buildings.walls.values()) {
      if (w.level !== level || !WALL_TYPE_BY_ID.get(w.type)?.opaque || !isDone(w)) continue;
      set.add(this.borderKey(w.dir, w.x, w.y));
    }
    this.shut.set(level, set);
    return set;
  }
}
