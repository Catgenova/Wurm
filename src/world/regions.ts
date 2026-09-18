import { ROCK_VARIANTS, TREE_DEFS } from './tiles';
import { oreKindFor, stoneKindAt } from './ore';

/**
 * Which island you are standing on, and what that means for the ground.
 *
 * The survey chart is an archipelago rather than one island, so the things
 * worth crossing water for are split across it: each landmass carries a stone
 * and a metal or two that occur nowhere else, and the biomes are placed rather
 * than left to altitude. A region decides three things — which biomes may
 * appear on it, which seams the ore ladder is allowed to return there, and
 * which tree species grow there.
 *
 * Exclusivity is structural, not a rarity tweak. Every restricted material is
 * owned by exactly one region in REGIONS, and `rockKindFor` turns a seam that
 * belongs to another island into iron, so there is no seed and no amount of
 * prospecting that finds seryll off the volcano.
 */

/**
 * ROCK_VARIANTS is stored per tile as an index into itself, so its order is
 * storage and a kind must never be written down as a literal. Everything here
 * asks for a kind by what it yields, exactly as ore.ts does.
 */
const kindOf = (yields: string): number => ROCK_VARIANTS.findIndex((r) => r.yields === yields);
const PLAIN_ROCK = kindOf('rock_shards');
const IRON = kindOf('iron_ore');

const speciesOf = (name: string): number => TREE_DEFS.findIndex((t) => t.name === name);
const BIRCH = speciesOf('Birch');
const WILLOW = speciesOf('Willow');
const APPLE = speciesOf('Apple');
const CHERRY = speciesOf('Cherry');
const PEAR = speciesOf('Pear');
const PLUM = speciesOf('Plum');
const PEACH = speciesOf('Peach');
const FIG = speciesOf('Fig');
const LEMON = speciesOf('Lemon');
const POMEGRANATE = speciesOf('Pomegranate');
const APRICOT = speciesOf('Apricot');
const QUINCE = speciesOf('Quince');
/** The trees that bear, by index: a fruit rolled anywhere is one of these. */
const FRUIT = new Set(TREE_DEFS.map((t, i) => (t.fruit ? i : -1)).filter((i) => i >= 0));

export interface Region {
  key: string;
  name: string;
  /** Measured centroid of the landmass on the chart, normalised 0..1. */
  at: [number, number];
  /** Shifts moisture on this island; negative is drier, which means steppe. */
  moistBias: number;
  /** Chance a dry tile becomes steppe rather than grass. */
  steppe: number;
  tundra: boolean;
  snow: boolean;
  /** The stone this island's bedrock bands into, by what it yields. */
  stone: string;
  /** Seams that occur here and nowhere else, by what they yield. */
  ores: string[];
  /** Species that grow here and nowhere else. */
  trees: number[];
}

export const REGIONS: Region[] = [
  {
    key: 'Crescent',
    name: 'The Crescent',
    at: [0.5048, 0.7091],
    moistBias: -0.05,
    steppe: 0.35,
    tundra: false,
    snow: false,
    stone: 'rock_shards',
    ores: [],
    trees: [PEAR, QUINCE],
  },
  {
    key: 'NorthwestSteppe',
    name: 'Northwest Steppe',
    at: [0.2044, 0.2674],
    moistBias: -0.55,
    steppe: 1,
    tundra: false,
    snow: false,
    stone: 'sandstone_shards',
    ores: ['lead_ore', 'adamantine_ore'],
    trees: [POMEGRANATE, APRICOT],
  },
  {
    key: 'NortheastTundra',
    name: 'Northeast Tundra',
    at: [0.8378, 0.2728],
    moistBias: -0.15,
    steppe: 0,
    tundra: true,
    snow: true,
    stone: 'marble_shards',
    ores: ['glimmersteel_ore'],
    trees: [PLUM],
  },
  {
    key: 'Volcano',
    name: 'Volcano Isle',
    at: [0.5039, 0.1258],
    moistBias: 0,
    steppe: 0,
    tundra: false,
    snow: false,
    stone: 'slate_shards',
    ores: ['seryll_ore'],
    trees: [LEMON],
  },
  {
    key: 'MiddleIsle',
    name: 'Middle Isle',
    at: [0.5043, 0.3946],
    moistBias: 0.05,
    steppe: 0,
    tundra: false,
    snow: false,
    stone: 'rock_shards',
    ores: ['zinc_ore'],
    trees: [WILLOW, PEACH],
  },
  {
    key: 'EastIsle',
    name: 'East Isle',
    at: [0.7541, 0.4599],
    moistBias: 0.05,
    steppe: 0,
    tundra: false,
    snow: false,
    stone: 'rock_shards',
    ores: [],
    trees: [CHERRY],
  },
  {
    key: 'WestSkerry',
    name: 'West Skerry',
    at: [0.0801, 0.4309],
    moistBias: 0,
    steppe: 0,
    tundra: false,
    snow: false,
    stone: 'rock_shards',
    ores: [],
    trees: [FIG],
  },
];

export const OCEAN_REGION = 255;

/** Centre of the crescent's inner bay, and the shore band players start on. */
export const BAY: [number, number] = [0.5221, 0.8193];
export const SPAWN_RADIUS = 0.15;
export const SPAWN_REGION = 0;

/**
 * Every restricted material against the one region that has it. Built from
 * REGIONS so that moving a metal from one island to another is a one-line
 * edit above and cannot leave a stale second owner behind.
 */
const OWNER = new Map<string, number>();
REGIONS.forEach((R, i) => {
  if (R.stone !== 'rock_shards') OWNER.set(R.stone, i);
  for (const ore of R.ores) OWNER.set(ore, i);
});

/** Whether this material is restricted at all, and to whom. */
export const ownerOf = (yields: string): number | undefined => OWNER.get(yields);

/**
 * The rock under a tile of a given region.
 *
 * The ore ladder in ore.ts is left exactly as it is — the same density, the
 * same rarity order — and filtered afterwards, so the metal a region does keep
 * turns up at the rate it always did. A seam owned elsewhere becomes iron,
 * which is what the ground would otherwise mostly have been anyway.
 */
export function rockKindFor(seed: number, region: number, x: number, y: number, density: number): number {
  const ore = oreKindFor(seed, x, y, density);
  if (ore >= 0) {
    const owner = OWNER.get(ROCK_VARIANTS[ore].yields);
    return owner === undefined || owner === region ? ore : IRON;
  }
  // Where the bands call for something other than plain stone, the island's own
  // stone shows through; islands without one are plain rock throughout.
  if (stoneKindAt(seed, x, y) === PLAIN_ROCK) return PLAIN_ROCK;
  const own = REGIONS[region]?.stone;
  return own && own !== 'rock_shards' ? kindOf(own) : PLAIN_ROCK;
}

/**
 * The species that actually grows, given the one the climate asked for.
 * Willow and cherry are held to their islands; a cherry rolled anywhere else
 * comes up as an apple, which grows in the same warm low country. And the
 * eight fruit trees asked for are held to an island each the same way: where
 * the climate rolled a fruit tree, half of them come up as one of the kinds
 * that are this island's own rather than the apple and olive that grow
 * anywhere, so a pear is the Crescent's and a fig the skerry's.
 */
export function speciesFor(region: number, base: number, avg: number, r: number): number {
  const R = REGIONS[region];
  if (!R) return base;
  if (base === WILLOW && R.trees.indexOf(WILLOW) < 0) return BIRCH;
  if (base === CHERRY && R.trees.indexOf(CHERRY) < 0) return APPLE;
  // On its own island a cherry is worth the crossing, so it grows past the one
  // tree in fifty that the fruit trees manage elsewhere.
  if (R.trees.indexOf(CHERRY) >= 0 && r > 0.93 && avg < 162) return CHERRY;
  const own = R.trees.filter((s) => FRUIT.has(s) && s !== CHERRY);
  if (own.length && FRUIT.has(base)) {
    // The roll that chose a fruit tree is spent above 0.978; what is left of
    // it under the hundredths is as good as a second roll.
    const f = (r * 997) % 1;
    if (f < 0.5) return own[Math.floor(f * 2 * own.length)] as number;
  }
  return base;
}

/**
 * One region per landmass, matched by centroid, then grown out over the water
 * so that a coastal tile never falls outside a region.
 */
export function buildRegionMap(elev: Float32Array, n: number): Uint8Array {
  const comp = new Int32Array(n * n).fill(-1);
  const reg = new Uint8Array(n * n).fill(OCEAN_REGION);
  const centres: [number, number][] = [];
  for (let i = 0; i < n * n; i++) {
    if (elev[i] < 0 || comp[i] >= 0) continue;
    const me = centres.length;
    const stack = [i];
    comp[i] = me;
    let area = 0;
    let sx = 0;
    let sy = 0;
    while (stack.length) {
      const j = stack.pop() as number;
      const x = j % n;
      const y = (j / n) | 0;
      area++;
      sx += x;
      sy += y;
      if (x > 0 && elev[j - 1] >= 0 && comp[j - 1] < 0) { comp[j - 1] = me; stack.push(j - 1); }
      if (x < n - 1 && elev[j + 1] >= 0 && comp[j + 1] < 0) { comp[j + 1] = me; stack.push(j + 1); }
      if (y > 0 && elev[j - n] >= 0 && comp[j - n] < 0) { comp[j - n] = me; stack.push(j - n); }
      if (y < n - 1 && elev[j + n] >= 0 && comp[j + n] < 0) { comp[j + n] = me; stack.push(j + n); }
    }
    centres.push([sx / area / n, sy / area / n]);
  }
  const pick = centres.map((c) => {
    let best = 0;
    let bestD = Infinity;
    REGIONS.forEach((R, q) => {
      const dx = c[0] - R.at[0];
      const dy = c[1] - R.at[1];
      if (dx * dx + dy * dy < bestD) {
        bestD = dx * dx + dy * dy;
        best = q;
      }
    });
    return best;
  });
  for (let i = 0; i < n * n; i++) if (comp[i] >= 0) reg[i] = pick[comp[i]];
  const queue: number[] = [];
  for (let i = 0; i < n * n; i++) if (reg[i] !== OCEAN_REGION) queue.push(i);
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    const x = k % n;
    const y = (k / n) | 0;
    if (x > 0 && reg[k - 1] === OCEAN_REGION) { reg[k - 1] = reg[k]; queue.push(k - 1); }
    if (x < n - 1 && reg[k + 1] === OCEAN_REGION) { reg[k + 1] = reg[k]; queue.push(k + 1); }
    if (y > 0 && reg[k - n] === OCEAN_REGION) { reg[k - n] = reg[k]; queue.push(k - n); }
    if (y < n - 1 && reg[k + n] === OCEAN_REGION) { reg[k + n] = reg[k]; queue.push(k + n); }
  }
  return reg;
}
