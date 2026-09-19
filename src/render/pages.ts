/**
 * Tile colours, kept by the page rather than by the island.
 *
 * Shading a tile is not cheap — the sun's angle against the slope, the tile's
 * own colour, the dirt on it, the dark — so the answer is kept. It was kept in
 * one array the size of the whole island, which on a four thousand square map
 * is sixteen and three quarter million slots, and there were two of them: one
 * for ground in sight and one for ground only remembered. Something over a
 * quarter of a gigabyte of pointers, for a screen that shows a couple of
 * thousand tiles.
 *
 * The size was not even the expensive part. Every step of the sun — and the
 * sun is cut into forty-eight of them, so a little over a minute of real time
 * apiece — threw the whole thing away with `fill(null)`, which is sixteen and
 * three quarter million writes in the middle of a frame. That is a stutter you
 * can set your watch by, and it is the one this was written to stop.
 *
 * So: sixty-four by sixty-four pages, made when first asked for and dropped
 * when there are more of them than a walk could want. The working set for a
 * screen is a few dozen; throwing the lot away is then a matter of dropping
 * that many arrays rather than writing out a whole island, and the memory is
 * what is being looked at rather than what exists.
 *
 * Nothing about what a colour *is* changed. This is where the answers live,
 * not how they are worked out.
 */

/** A page is 64 × 64 tiles. Big enough that a screen is a handful of them. */
const BITS = 6;
const SIDE = 1 << BITS;
const MASK = SIDE - 1;
const SLOTS = SIDE * SIDE;
/**
 * How many pages are held before the lot are dropped.
 *
 * A screen at the furthest zoom out wants something under a hundred; the rest
 * is slack for walking. Dropping all of them rather than the coldest is
 * deliberate — an LRU wants bookkeeping on every lookup, and a lookup here
 * happens for every tile of every frame, which is exactly where the cost must
 * not go. Losing a page is a recomputation, not a mistake.
 */
const KEEP = 256;

/** What a page holds: the colours, and one byte a tile for anything else. */
interface Page {
  colour: Array<string | null>;
  /** 0 nobody has asked, 1 the answer was no, 2 the answer was yes. */
  flag: Uint8Array;
}

export class ColourPages {
  private pages = new Map<number, Page>();
  private readonly across: number;

  constructor(worldWidth: number) {
    this.across = ((worldWidth + SIDE - 1) >> BITS) + 1;
  }

  /** The page a tile's answers live on, made if this is the first time. */
  private page(x: number, y: number): Page {
    const key = (y >> BITS) * this.across + (x >> BITS);
    let page = this.pages.get(key);
    if (!page) {
      if (this.pages.size >= KEEP) this.pages.clear();
      page = { colour: new Array<string | null>(SLOTS).fill(null), flag: new Uint8Array(SLOTS) };
      this.pages.set(key, page);
    }
    return page;
  }

  /** The colour worked out for a tile, or null when nobody has worked it out. */
  get(x: number, y: number): string | null {
    const key = (y >> BITS) * this.across + (x >> BITS);
    const page = this.pages.get(key);
    return page ? page.colour[((y & MASK) << BITS) | (x & MASK)] : null;
  }

  set(x: number, y: number, colour: string): void {
    this.page(x, y).colour[((y & MASK) << BITS) | (x & MASK)] = colour;
  }

  /**
   * A yes-or-no about a tile that costs as much to work out as the colour and
   * goes stale at the same moments — whether the ground here has a different
   * sort of ground beside it, and so wants a blended seam drawn over it. Nought
   * means nobody has asked, one no, two yes.
   */
  flag(x: number, y: number): number {
    const key = (y >> BITS) * this.across + (x >> BITS);
    const page = this.pages.get(key);
    return page ? page.flag[((y & MASK) << BITS) | (x & MASK)] : 0;
  }

  setFlag(x: number, y: number, v: number): void {
    this.page(x, y).flag[((y & MASK) << BITS) | (x & MASK)] = v;
  }

  /** One tile's answers are out of date. */
  forget(x: number, y: number): void {
    const key = (y >> BITS) * this.across + (x >> BITS);
    const page = this.pages.get(key);
    if (!page) return;
    const slot = ((y & MASK) << BITS) | (x & MASK);
    page.colour[slot] = null;
    page.flag[slot] = 0;
  }

  /**
   * Everything in a box is out of date. The pages the box touches are dropped
   * whole rather than walked tile by tile: a page is cheap to make again, and
   * the box this is called with — the ground somebody has just seen — covers
   * most of every page it reaches anyway.
   */
  forgetBox(x0: number, y0: number, x1: number, y1: number): void {
    for (let py = y0 >> BITS; py <= (y1 >> BITS); py++) {
      for (let px = x0 >> BITS; px <= (x1 >> BITS); px++) this.pages.delete(py * this.across + px);
    }
  }

  /** Everything is out of date: the sun has moved, or the map has. */
  clear(): void {
    this.pages.clear();
  }

  /** How many pages are being held, for anything that wants to say so. */
  get size(): number {
    return this.pages.size;
  }
}
