import { mulberry32, Noise2D } from './noise';
import { isSeam, ROCK_VARIANTS, TileType } from './tiles';
import type { World } from './world';

/**
 * What kind of rock lies under a given tile, and which of those kinds carry an
 * ore worth prospecting for. The answer is a pure function of the world seed
 * and the tile, so rock uncovered by digging matches the rock that was there
 * from the start.
 */
const noiseCache = new Map<number, Noise2D>();
const bandNoise = (seed: number): Noise2D => {
  let n = noiseCache.get(seed);
  if (!n) {
    n = new Noise2D(mulberry32(seed >>> 0));
    noiseCache.set(seed, n);
  }
  return n;
};

/**
 * Deterministic 0..1 from a tile and a salt.
 *
 * The three multiplies are `Math.imul` and not `*`, which is the whole of why
 * this comment is here. A seed is up to 0x7fffffff, and `salt * 2246822519`
 * with a seed that size is about 4.8e18 -- two hundred times past the largest
 * whole number a double can hold exactly. So the sum was already wrong before
 * `>>> 0` took the bottom of it, and wrong by however much precision had been
 * thrown away, which grows with the seed.
 *
 * The island computes the same hash in `hash_tile`, in bigint, where 4.8e18 is
 * exact. The two agreed on a seed of seven and parted company on a real one --
 * measured, at one tile: on seed 2,000,000,000 this said the rock topped out
 * at QL 54 and the island held it to 98. Since the island is the one that
 * holds the land and does the mining, its answer was the real cap and the
 * browser's was the lie: a tile read "Rock · up to QL 29" and handed back
 * QL 69 rock shards, which is the report this fixed.
 *
 * `Math.imul` is the low thirty-two bits of a product, worked out exactly, so
 * the sum of the three is a few billion at most and the shift takes the same
 * bits the island's modulo does.
 */
export function hashTile(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Index into ROCK_VARIANTS for the rock under this tile, wherever it lies. */
/**
 * How common each seam is, rarest first. A tile rolls against these in order,
 * so the metals that need the most skill are the ones you almost never see.
 */
const ORE_LADDER: Array<[yields: string, upTo: number]> = [
  ['seryll_ore', 0.0004],
  ['mithril_ore', 0.001],
  ['glimmersteel_ore', 0.002],
  ['adamantine_ore', 0.0035],
  ['gold_ore', 0.006],
  ['silver_ore', 0.01],
  ['lead_ore', 0.016],
  ['zinc_ore', 0.024],
  ['tin_ore', 0.034],
  ['coal', 0.052],
  ['copper_ore', 0.076],
  // Iron is over half of everything that carries metal, which is what makes it
  // the metal you actually build with rather than the one you hoard.
  ['iron_ore', 0.16],
];

/** The share of every seam on the island that gives up this. */
export const seamShare = (yields: string): number => {
  const i = ORE_LADDER.findIndex(([y]) => y === yields);
  return i < 0 ? 0 : (ORE_LADDER[i][1] - (i ? ORE_LADDER[i - 1][1] : 0)) / ORE_LADDER[ORE_LADDER.length - 1][1];
};

/** Keyed by what the seam gives up, so inserting a metal cannot shuffle the ladder. */
const ORE_CHANCE: Array<[kind: number, upTo: number]> = ORE_LADDER.map(([yields, upTo]) => [ROCK_VARIANTS.findIndex((r) => r.yields === yields), upTo]);

/** The ladder as fractions of all ore, so its shape survives any density. */
const ORE_TOP = ORE_CHANCE[ORE_CHANCE.length - 1][1];
const ORE_SHARE: Array<[kind: number, upTo: number]> = ORE_CHANCE.map(([k, upTo]) => [k, upTo / ORE_TOP]);

/**
 * How much of the ground carries metal. Two thirds of the map is sea, and ore
 * on the seabed is ore nobody can reach, so dry land is made far richer than
 * the water and the island keeps most of the metal.
 */
export const ORE_DENSITY = { land: 0.15, water: 0.02 };

/** The seam under a tile, given how much metal that ground holds. */
export function oreKindFor(seed: number, x: number, y: number, density: number): number {
  const r = hashTile(x, y, seed + 11);
  if (r >= density) return -1;
  const t = r / density;
  for (const [kind, upTo] of ORE_SHARE) if (t < upTo) return kind;
  return -1;
}

/** The plain stone under a tile, in broad bands. */
export function stoneKindAt(seed: number, x: number, y: number): number {
  const n = bandNoise(seed + 50).fbm(x * 0.045 + 50, y * 0.045 + 50, 3);
  if (n > 0.34) return 1;
  if (n < -0.42) return 2;
  const deep = bandNoise(seed + 51).fbm(x * 0.012 + 9, y * 0.012 + 9, 2);
  if (n > 0.05 && deep < 0.2) return 3;
  return 0;
}

/** Rock kinds 4 and up are metal veins: the ores worth looking for. */
export const ORE_FROM = 4;
export const isOreKind = (kind: number): boolean => kind >= ORE_FROM;

export interface OreInfo {
  kind: number;
  name: string;
  yields: string;
  /** The best quality this rock will ever give up. */
  maxQl: number;
  /** Mining skill needed to work it at all. */
  level: number;
  /** Whether it is metal rather than plain stone. */
  ore: boolean;
}

/** The best quality a deposit can yield, fixed for that tile. */
export function oreMaxQl(seed: number, x: number, y: number): number {
  return Math.round(25 + hashTile(x, y, seed + 991) * 74);
}

/**
 * The rock beneath any tile at all, bare or buried or drowned. This is what
 * prospecting reads; mining still needs the rock uncovered first.
 */
export function bedrockAt(world: World, x: number, y: number): OreInfo {
  // The world holds a kind for every tile, settled when it was made.
  const kind = Math.min(ROCK_VARIANTS.length - 1, world.rockKind(x, y));
  const def = ROCK_VARIANTS[kind];
  return { kind, name: def.name, yields: def.yields, maxQl: oreMaxQl(world.seed, x, y), level: def.level ?? 1, ore: isOreKind(kind) };
}

/** The ore in a tile whose rock is already bare, or null. */
export function oreAt(world: World, x: number, y: number): OreInfo | null {
  if (world.getTile(x, y) !== TileType.Rock) return null;
  const rock = bedrockAt(world, x, y);
  return isSeam(rock) ? rock : null;
}

/** The index of the iron seam, which is what says whether a world knows about iron. */
const IRON = ROCK_VARIANTS.findIndex((r) => r.yields === 'iron_ore');

/**
 * Whether this world was made before iron was in the ground. The rock under
 * each tile is written down per tile, so a world rolled without iron keeps a
 * hole where the useful metal ought to be however many times it is loaded.
 * With iron over half of every seam, a world without a single one of them is
 * not a world that got unlucky.
 */
export function needsIron(rock: Uint8Array): boolean {
  for (let i = 0; i < rock.length; i += 1) if (rock[i] === IRON) return false;
  return true;
}
