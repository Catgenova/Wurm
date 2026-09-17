import { World } from '../world/world';

/**
 * The island, as rows of bytes going to and from the database.
 *
 * One row of the island per row of the table, which is how it is stored the
 * other end: a dig touches two rows of corners and one of tiles, and nothing
 * has to rewrite six megabytes to move one.
 *
 * The wire format is base64 of the raw arrays, little-endian for the heights.
 * That is not an implementation detail that can drift — `b_i16` in
 * `supabase/migrations/0002_land.sql` takes the two bytes apart by hand in
 * that order, so the two ends agree by construction, and the check below turns
 * a machine that disagreed into a loud failure rather than an island with its
 * hills inside out.
 */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * One tile the island says changed, as the row comes off `tile_change`.
 *
 * The same shape whether it arrives in a join's replay or a moment later on
 * the channel, because it is the same row read two ways.
 */
export interface TileChange {
  x: number;
  y: number;
  tile: number;
  data: number;
  /** The square's four corner heights, clockwise from its own corner. */
  corners: number[];
  /**
   * And the soil over the rock at those same four corners, in the same order.
   *
   * Absent on a row written before the island carried it, and on one an older
   * page is replaying — which is why it is applied only when all four are
   * there. A browser that is not told how deep the soil is keeps the
   * generator's answer for ever: reported as digging fourteen spadefuls out of
   * a corner and being no nearer the rock, because the height came down the
   * wire and the soil never did.
   */
  soil?: number[];
}

/**
 * Lay a change onto the land.
 *
 * Out here rather than inside the client because it is the load-bearing half
 * of a join and the client cannot be made to do one without a network. What it
 * has to survive is the world being *worked out as it goes*: a change on a
 * square nobody has generated yet must not be laid under ground that arrives
 * afterwards and wipes it. It is not: `setHeight` and `setTile` both call
 * `ensure` first, so the square is worked out from the seed and then written
 * over, in that order, and the square is marked done and never made twice.
 *
 * Says whether the tile is inside the island at all, so a caller can tell a
 * change it dropped from one it applied.
 */
export function layChange(world: World, c: TileChange): boolean {
  if (!world.inBounds(c.x, c.y)) return false;
  const k = c.corners;
  if (Array.isArray(k) && k.length === 4) {
    world.setHeight(c.x, c.y, k[0]);
    world.setHeight(c.x + 1, c.y, k[1]);
    world.setHeight(c.x + 1, c.y + 1, k[2]);
    world.setHeight(c.x, c.y + 1, k[3]);
  }
  // And how much soil is left over the rock, which used to be the one thing
  // about a square the island changed and never said.
  const s = c.soil;
  if (Array.isArray(s) && s.length === 4) {
    world.setDirt(c.x, c.y, s[0]);
    world.setDirt(c.x + 1, c.y, s[1]);
    world.setDirt(c.x + 1, c.y + 1, s[2]);
    world.setDirt(c.x, c.y + 1, s[3]);
  }
  world.setTile(c.x, c.y, c.tile as Parameters<World['setTile']>[2], c.data);
  return true;
}

/**
 * Lay the whole of an island's history down, a page at a time.
 *
 * Out here rather than in the client for the same reason `layChange` is: the
 * client cannot be made to do this without a network, and this is the part
 * that failed. Reported from the island as *"all my paved tiles and levelled
 * terrain from this morning reverted"* — nothing had been lost. A join builds
 * the ground from the seed and lays the record over it, so a read of the
 * record that comes back empty is an island nobody has ever touched, and a
 * read that *fails* came back empty.
 *
 * Two mistakes, the same one twice. It asked for every row in one request, of
 * a table that grows with every spadeful anybody has ever turned; and it threw
 * the error away, so a failure and an untouched island were the same thing to
 * everything downstream.
 *
 * `read` is given the cursor and a page size and answers with rows or an
 * error. The cursor moves per page, so a read that dies half way through has
 * kept what it read and the next one carries on from there. An error is
 * thrown, never swallowed: what to do about it belongs to the caller, and
 * during a join the answer is to stop rather than to draw the wrong island.
 */
export async function layHistory<T extends { n: number }>(
  from: number,
  limit: number,
  read: (after: number, take: number) => Promise<{ rows: T[]; error?: string }>,
  lay: (c: T) => void,
  onPage?: (seen: number) => void,
): Promise<number> {
  let seen = from;
  for (let page = 0; ; page++) {
    const { rows, error } = await read(seen, limit);
    if (error) throw new Error(`the island's history would not come: ${error}`);
    for (const c of rows) lay(c);
    /*
     * Empty is the end of it, not short.
     *
     * A page smaller than the one asked for looks like the end and is not: a
     * server may have a cap of its own below what was asked, and then every
     * page is short and the first one ends the read — which is the bug this
     * whole function exists to be rid of, put back in a new place. An extra
     * request to hear "nothing more" costs one round trip and cannot be wrong.
     */
    if (!rows.length) return seen;
    seen = Math.max(seen, rows[rows.length - 1].n);
    onPage?.(seen);
  }
}

export interface LandRow {
  y: number;
  heights: string;
  dirt: string;
  /** Absent on the last row: there is one more row of corners than of tiles. */
  tiles?: string;
  data?: string;
  rock?: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The island's rows from y0 to y1 inclusive, ready to hand over. */
export function rowsOf(world: World, y0: number, y1: number): LandRow[] {
  if (!LITTLE_ENDIAN) throw new Error('This machine stores numbers the other way round; the island format is little-endian.');
  const { w, cw } = world;
  const heightBytes = new Uint8Array(world.heights.buffer, world.heights.byteOffset, world.heights.byteLength);
  const out: LandRow[] = [];
  for (let y = Math.max(0, y0); y <= Math.min(world.h, y1); y++) {
    const row: LandRow = {
      y,
      heights: toBase64(heightBytes.subarray(y * cw * 2, (y + 1) * cw * 2)),
      dirt: toBase64(world.dirt.subarray(y * cw, (y + 1) * cw)),
    };
    // The last row of corners has no row of tiles below it.
    if (y < world.h) {
      row.tiles = toBase64(world.tiles.subarray(y * w, (y + 1) * w));
      row.data = toBase64(world.data.subarray(y * w, (y + 1) * w));
      row.rock = toBase64(world.rock.subarray(y * w, (y + 1) * w));
    }
    out.push(row);
  }
  return out;
}

/** And the other way: rows off the wire laid into a world. */
export function layRows(world: World, rows: LandRow[]): number {
  if (!LITTLE_ENDIAN) throw new Error('This machine stores numbers the other way round; the island format is little-endian.');
  const { w, cw } = world;
  const heightBytes = new Uint8Array(world.heights.buffer, world.heights.byteOffset, world.heights.byteLength);
  let laid = 0;
  for (const row of rows) {
    const y = row.y;
    if (!Number.isInteger(y) || y < 0 || y > world.h) continue;
    const h = fromBase64(row.heights);
    const d = fromBase64(row.dirt);
    if (h.length !== cw * 2 || d.length !== cw) throw new Error(`row ${y} is the wrong width`);
    heightBytes.set(h, y * cw * 2);
    world.dirt.set(d, y * cw);
    if (y < world.h && row.tiles && row.data && row.rock) {
      const t = fromBase64(row.tiles);
      const dt = fromBase64(row.data);
      const r = fromBase64(row.rock);
      if (t.length !== w || dt.length !== w || r.length !== w) throw new Error(`row ${y} is the wrong width`);
      world.tiles.set(t, y * w);
      world.data.set(dt, y * w);
      world.rock.set(r, y * w);
    }
    laid += 1;
  }
  return laid;
}

/** An empty island of the right shape, for rows to be laid into. */
export function blankWorld(size: number, seed: number): World {
  const world = new World(size, size);
  world.seed = seed;
  return world;
}
