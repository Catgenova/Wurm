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
