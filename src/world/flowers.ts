/**
 * Wildflowers: where they grow, and how thick.
 *
 * Untouched grass carries drifts of small flowers in spring and summer and
 * none in autumn or winter. A drift is set by where the tile is and nothing
 * else, so it is the same drift on every page and on the island, which has to
 * know it too: Pick flowers is refused on a tile the page draws bare.
 *
 * ## The drift
 *
 * Two lattices of whole numbers, one every `FLOWER_OCTAVES[0].cell` tiles
 * and a finer one every `FLOWER_OCTAVES[1].cell`, each corner hashed out of
 * where it is and the world's seed (`hashTile` here, `hash_tile` on the
 * island, which are one hash) and eased between -- the coarse one with a
 * smoothstep, the fine one straight -- and the two weighed together. The
 * coarse one lays the drifts; the fine one frays their edges, so a drift is
 * a ragged patch rather than a blob with a lattice showing through it.
 *
 * Whole numbers all the way, so the two sides cannot come apart in a last
 * bit of rounding: the island's `flower_drift` is the same sum in `bigint`.
 * What comes out is nought to 255, rolling slowly over the map, and a tile
 * flowers where it stands high enough: patches a few tiles across with open
 * meadow between, clumped rather than sprinkled.
 *
 * ## How thick
 *
 * A tile in flower carries one clump for being in the drift and one more for
 * every `FLOWER_STEP` it stands above the season's line, up to the season's
 * most -- so a drift is thin at its edge and full in its middle, and summer's
 * line is lower and its most higher than spring's. What it carries is what
 * picking it gives: a wildflower a clump.
 */
import { seasonAt, type Season } from './calendar';
import { hashTile } from './ore';
import { FLOWERS_PICKED, TileType } from './tiles';

/**
 * The lattices a drift is laid on: how many tiles to a cell, what the
 * corners are hashed with over the world's seed, how much each weighs, and
 * whether it is eased between its corners or taken straight.
 */
export interface FlowerOctave { cell: number; salt: number; weight: number; eased: boolean }
export const FLOWER_OCTAVES: readonly FlowerOctave[] = [
  { cell: 7, salt: 7331, weight: 2, eased: true },
  { cell: 3, salt: 7349, weight: 1, eased: false },
];
/** How high a tile's drift has to stand for it to flower, by season. None means it never does. */
export const FLOWER_FROM: Readonly<Record<Season, number | null>> = { spring: 182, summer: 166, autumn: null, winter: null };
/** The most clumps a tile carries, by season. */
export const FLOWER_MOST: Readonly<Record<Season, number>> = { spring: 2, summer: 4, autumn: 0, winter: 0 };
/** How far over the line a tile has to stand for each clump past the first. */
export const FLOWER_STEP = 8;
/** The seasons anything flowers in, in the order they come. */
export const FLOWER_SEASONS: Season[] = (['spring', 'summer', 'autumn', 'winter'] as Season[]).filter((s) => FLOWER_FROM[s] !== null);

/** Whole-number division of two whole numbers, exactly: no rounding a quotient up past a whole. */
const idiv = (a: number, b: number): number => (a - (a % b)) / b;

/**
 * One lattice at a tile, as a fraction: a numerator over `(2 cell)^6`. The
 * ease is taken at tile middles, which are odd halves of a cell, so it is
 * worked in twice the cell and every weight is a whole number.
 */
function octave(seed: number, x: number, y: number, o: FlowerOctave): [number, number] {
  const k = 2 * o.cell;
  const k3 = k * k * k;
  const ease = (i: number): number => {
    const t = 2 * i + 1;
    return o.eased ? t * t * (3 * k - 2 * t) : t * k * k;
  };
  const gx = Math.floor(x / o.cell);
  const gy = Math.floor(y / o.cell);
  const sx = ease(x - gx * o.cell);
  const sy = ease(y - gy * o.cell);
  const at = (i: number, j: number): number => Math.floor(hashTile(gx + i, gy + j, seed + o.salt) * 256);
  const top = at(0, 0) * (k3 - sx) + at(1, 0) * sx;
  const bottom = at(0, 1) * (k3 - sx) + at(1, 1) * sx;
  return [top * (k3 - sy) + bottom * sy, k3 * k3];
}

/**
 * How deep in a drift a tile lies, nought to 255: the same whole number here
 * and on the island (`flower_drift`). Tile coordinates are never negative.
 *
 * The two lattices over one denominator, their product: under 2^53 for the
 * cells here, which is what keeps every step of this exact in a double.
 */
export function flowerDrift(seed: number, x: number, y: number): number {
  const [a, b] = FLOWER_OCTAVES;
  const [na, da] = octave(seed, x, y, a);
  const [nb, db] = octave(seed, x, y, b);
  return idiv(a.weight * na * db + b.weight * nb * da, (a.weight + b.weight) * da * db);
}

/** How many clumps a drift this deep carries in a season: nought where it does not flower. */
export function bloomOf(drift: number, season: Season): number {
  const from = FLOWER_FROM[season];
  if (from === null || drift < from) return 0;
  return Math.min(FLOWER_MOST[season], 1 + Math.floor((drift - from) / FLOWER_STEP));
}

/**
 * The clumps of wildflowers on a tile as the ground stands: grass only, and
 * not grass whose flowers have been picked this year. Whether a building
 * stands over it is the caller's to ask; the ground does not know.
 */
export function flowersOn(seed: number, x: number, y: number, tile: number, data: number, season: Season): number {
  if (tile !== TileType.Grass || (data & FLOWERS_PICKED) !== 0) return 0;
  return bloomOf(flowerDrift(seed, x, y), season);
}

/** The season at a moment, for the callers that only have the clock. */
export const flowerSeason = (nowSeconds: number): Season => seasonAt(nowSeconds).season;
