/**
 * Things standing on tiles, filed under the tile they stand on.
 *
 * Everything placed used to be found by walking the whole collection: the
 * renderer asked "what furniture is on this tile?" for every tile on screen,
 * every frame, and the answer was a fresh copy of every piece of furniture in
 * the world. That is fine with ten pieces and ruinous with a thousand, and it
 * gets worse as the map grows rather than better. Filing them by tile turns
 * every one of those questions into a lookup, and `around` keeps a search for
 * the nearest anything to the handful of tiles it could possibly be on.
 */
export interface Placed {
  x: number;
  y: number;
}

/** Handed back when a tile holds nothing, so the common answer costs nothing. */
const NONE: never[] = [];
/**
 * Rows are this far apart in the key. Bigger than any map we would make, so
 * the index needs to know nothing about the world it is filing.
 */
export const STRIDE = 8192;

/**
 * A tile as one number, for anything filing things by tile.
 *
 * Exported because this index is not the only place that does it: the piles on
 * the ground and the crops in the fields were both kept under a `"x,y"` string
 * built fresh on every lookup — and the renderer asks both of them about every
 * tile it draws, sixty times a second. A few hundred thousand short-lived
 * strings a second is not a cost anybody can see in a profile as one line, and
 * it is exactly the sort of thing that makes a whole game feel slack.
 */
export const tileKey = (x: number, y: number): number => y * STRIDE + x;
/** And back again, for the two places that iterate and want the tile. */
export const keyX = (key: number): number => key % STRIDE;
export const keyY = (key: number): number => (key - (key % STRIDE)) / STRIDE;

/**
 * How many placed things stand on each tile, across every index at once.
 *
 * The renderer asked eight separate indexes what was on a tile, for every tile
 * it drew: eight map lookups apiece, and on all but a handful of tiles all
 * eight answers are nothing. One shared count answers "is there anything here
 * at all" in a single lookup, and the eight are only asked on the few tiles
 * where the answer can be yes.
 */
export class Tally {
  private n = new Map<number, number>();

  up(key: number, by = 1): void {
    if (by <= 0) return;
    this.n.set(key, (this.n.get(key) ?? 0) + by);
  }

  down(key: number, by = 1): void {
    if (by <= 0) return;
    const was = this.n.get(key);
    if (was === undefined) return;
    if (was > by) this.n.set(key, was - by);
    else this.n.delete(key);
  }

  /** Whether anything at all stands on a tile. */
  any(x: number, y: number): boolean {
    return this.n.has(tileKey(x, y));
  }
}

export class TileIndex<T extends Placed> {
  private byTile = new Map<number, T[]>();

  /** The shared count of what stands where, when this index is part of one. */
  constructor(private readonly tally?: Tally) {}

  private key(x: number, y: number): number {
    return tileKey(x, y);
  }

  add(item: T): void {
    const k = this.key(item.x, item.y);
    const at = this.byTile.get(k);
    if (at) at.push(item);
    else this.byTile.set(k, [item]);
    this.tally?.up(k);
  }

  remove(item: T, x = item.x, y = item.y): void {
    const k = this.key(x, y);
    const at = this.byTile.get(k);
    if (!at) return;
    const i = at.indexOf(item);
    if (i < 0) return;
    at.splice(i, 1);
    this.tally?.down(k);
    if (!at.length) this.byTile.delete(k);
  }

  /** Something that walks, such as a cart being pulled, has changed tile. */
  moved(item: T, fromX: number, fromY: number): void {
    if (fromX === item.x && fromY === item.y) return;
    this.remove(item, fromX, fromY);
    this.add(item);
  }

  /**
   * What is standing on a tile. The array is the index's own, so read it and
   * do not keep it or reorder it.
   */
  at(x: number, y: number): readonly T[] {
    return this.byTile.get(this.key(x, y)) ?? NONE;
  }

  /** Everything on the tiles within `r` of a point, nearest tiles included. */
  around(wx: number, wy: number, r: number, fn: (item: T) => void): void {
    const x0 = Math.floor(wx - r);
    const x1 = Math.floor(wx + r);
    const y0 = Math.floor(wy - r);
    const y1 = Math.floor(wy + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const at = this.byTile.get(this.key(x, y));
        if (!at) continue;
        for (const item of at) fn(item);
      }
    }
  }

  /** Rebuild from scratch, for a world that has just been loaded. */
  reset(items: Iterable<T>): void {
    // What this index was contributing to the shared count comes off first,
    // or a reload would leave every tile it ever held counted twice.
    if (this.tally) for (const [k, at] of this.byTile) this.tally.down(k, at.length);
    this.byTile.clear();
    for (const item of items) this.add(item);
  }
}
