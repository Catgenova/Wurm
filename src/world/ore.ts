import { mulberry32, Noise2D } from './noise';
import { ROCK_VARIANTS, TileType } from './tiles';
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

/** Deterministic 0..1 from a tile and a salt. */
export function hashTile(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Index into ROCK_VARIANTS for the rock under this tile. */
/**
 * How common each seam is, rarest first. A tile rolls against these in order,
 * so the metals that need the most skill are the ones you almost never see.
 */
const ORE_CHANCE: Array<[kind: number, upTo: number]> = [
  [14, 0.0004], // seryll
  [13, 0.001], // mithril
  [12, 0.002], // glimmersteel
  [11, 0.0035], // adamantine
  [10, 0.006], // gold
  [9, 0.01], // silver
  [8, 0.016], // lead
  [7, 0.024], // zinc
  [6, 0.034], // tin
  [5, 0.052], // coal
  [4, 0.076], // copper
];

export function rockKindAt(seed: number, x: number, y: number, height: number): number {
  const r = hashTile(x, y, seed + 11);
  for (const [kind, upTo] of ORE_CHANCE) if (r < upTo) return kind;
  const n = bandNoise(seed + 50).fbm(x * 0.045 + 50, y * 0.045 + 50, 3);
  if (n > 0.34) return 1;
  if (n < -0.42) return 2;
  if (n > 0.05 && height < 80) return 3;
  return 0;
}

/** Rock kinds 4 and up are metal veins: the ores worth looking for. */
export const ORE_FROM = 4;
export const isOreKind = (kind: number): boolean => kind >= ORE_FROM;

export interface OreInfo {
  kind: number;
  name: string;
  yields: string;
  /** The best quality this deposit will ever give up. */
  maxQl: number;
  /** Mining skill needed to work it at all. */
  level: number;
}

/** The best quality a deposit can yield, fixed for that tile. */
export function oreMaxQl(seed: number, x: number, y: number): number {
  return Math.round(25 + hashTile(x, y, seed + 991) * 74);
}

/** The ore in a rock tile, or null when there is none. */
export function oreAt(world: World, x: number, y: number): OreInfo | null {
  if (world.getTile(x, y) !== TileType.Rock) return null;
  const kind = world.getData(x, y) & 15;
  if (!isOreKind(kind) || kind >= ROCK_VARIANTS.length) return null;
  const def = ROCK_VARIANTS[kind];
  return { kind, name: def.name, yields: def.yields, maxQl: oreMaxQl(world.seed, x, y), level: def.level ?? 1 };
}
