/** Tile types, modelled on Wurm's surface tiles. */
export const TileType = {
  Grass: 0,
  Dirt: 1,
  PackedDirt: 2,
  Sand: 3,
  Rock: 4,
  Steppe: 5,
  Tundra: 6,
  Marsh: 7,
  Clay: 8,
  Peat: 9,
  Tar: 10,
  Moss: 11,
  Snow: 12,
  Gravel: 13,
  Cobblestone: 14,
  Field: 15,
  Tree: 16,
  Bush: 17,
  Kelp: 18,
  Reed: 19,
  Lawn: 20,
  Slabs: 21,
  /**
   * What a felled tree leaves: its species in the data byte, a day in the
   * way of planting, building and paving, and then grass. Dug out with a
   * shovel by anybody who cannot wait.
   */
  Stump: 22,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

export type RGB = readonly [number, number, number];

/**
 * Ground that keeps a hard edge. A paved road stops where it was laid and a
 * rock face is rock; everything else on the island is soil of one sort or
 * another, and soil runs into its neighbour rather than stopping dead on a
 * tile line.
 */
export const HARD_EDGED: ReadonlySet<number> = new Set<number>([TileType.Rock, TileType.Slabs, TileType.Cobblestone, TileType.Gravel]);

/**
 * Ground a spadeful of dirt covers over, leaving dirt.
 *
 * Reported from the island: *"dropping dirt on a clay/sand tile corner isn't
 * properly changing those tiles to dirt."* It was not: the rule buried grass
 * and lawn by name and nothing else, so a bank of clay took the dirt, rose a
 * step and stayed clay.
 *
 * The principle, rather than a list of two: a spadeful covers soft ground and
 * what grows flat on it, and it does not cover what is built, standing or
 * bedrock. So grass, lawn and the three other growing faces; the four beds you
 * dig out of — sand, clay, peat, tar — and marsh, which is ground you are
 * filling in. Not paving, which is broken up rather than buried; not a crop,
 * a tree or a bush, which are standing on the tile; not rock, which has no
 * soil on it to be dirt.
 *
 * That the beds are in this list is deliberate and is the opposite of the rule
 * above it: `reconcile` leaves a bed alone, so the ground will never turn your
 * clay to dirt behind your back, and this will, because you asked it to with a
 * shovel. A bed buried is a bed gone — nothing remembers what was under it.
 */
export const BURYABLE: ReadonlySet<number> = new Set<number>([
  TileType.Grass, TileType.Lawn, TileType.Steppe, TileType.Tundra, TileType.Moss,
  TileType.Marsh, TileType.Sand, TileType.Clay, TileType.Peat, TileType.Tar,
]);

/**
 * How much a footfall raises off a given ground. Dry loose stuff — sand,
 * gravel, a ploughed field — goes up in a cloud; turf and moss hold together
 * and barely mark; a marsh swallows the whole question.
 */
export const DUSTINESS: Readonly<Record<number, number>> = {
  [TileType.Sand]: 1,
  [TileType.Gravel]: 0.95,
  [TileType.Dirt]: 0.9,
  [TileType.PackedDirt]: 0.8,
  [TileType.Field]: 0.85,
  [TileType.Clay]: 0.65,
  [TileType.Steppe]: 0.7,
  [TileType.Rock]: 0.55,
  [TileType.Tundra]: 0.5,
  [TileType.Snow]: 0.45,
  [TileType.Peat]: 0.45,
  [TileType.Cobblestone]: 0.3,
  [TileType.Slabs]: 0.25,
  [TileType.Grass]: 0.16,
  [TileType.Tree]: 0.16,
  [TileType.Bush]: 0.16,
  [TileType.Stump]: 0.2,
  [TileType.Lawn]: 0.13,
  [TileType.Tar]: 0.12,
  [TileType.Moss]: 0.1,
  [TileType.Marsh]: 0,
  [TileType.Kelp]: 0,
  [TileType.Reed]: 0,
};

/** What this ground gives up underfoot, 0 for ground that gives up nothing. */
export const dustiness = (type: number): number => DUSTINESS[type] ?? 0.4;

/** Where a slope starts wearing through to the rock under it, and where it is all rock. */
export const BARE_FROM = 0.5;
export const BARE_FULL = 1.15;

/** How much of the rock shows on a slope this steep, 0..1. */
export const bareRock = (slope: number): number => Math.max(0, Math.min(1, (slope - BARE_FROM) / (BARE_FULL - BARE_FROM)));


/**
 * What a loaded wheel makes of a piece of ground. An empty vehicle rolls over
 * anything at its own pace; a full one is held to what the ground will take.
 * Between the two it is a straight blend, so a half-loaded cart pays half.
 */
export const groundRoll = (roll: number | undefined, load: number): number => {
  const r = roll ?? 0.7;
  return r + (1 - r) * (1 - Math.max(0, Math.min(1, load)));
};

export interface TileDef {
  name: string;
  color: RGB;
  /** Movement speed multiplier. */
  speed: number;
  /**
   * How well a loaded wheel runs over it, 0..1. Feet hardly care what is under
   * them; a laden wagon cares about very little else. An empty vehicle notices
   * none of this and a full one notices all of it, which is the whole argument
   * for paving a road: see `groundRoll`.
   */
  roll?: number;
  /** Blocks walking entirely. */
  blocks?: boolean;
  /** Can be dug with a shovel; `digYield` names the item produced. */
  digYield?: string;
  /** Can be surface mined with a pickaxe. */
  mineable?: boolean;
  forage?: boolean;
  botanize?: boolean;
  /** Can be paved over. */
  pavable?: boolean;
  /** Digging turns the tile into dirt. */
  turnsToDirt?: boolean;
  /**
   * A bed of something that can be taken off the top without cutting the
   * ground about: sand, clay, peat, tar. You stand on the tile and fill a
   * shovel, and the tile is exactly as it was afterwards.
   */
  collect?: boolean;
}

export const TILE_DEFS: Record<TileType, TileDef> = {
  [TileType.Grass]: { name: 'Grass', color: [92, 146, 62], speed: 1, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true, roll: 0.7 },
  [TileType.Dirt]: { name: 'Dirt', color: [121, 92, 60], speed: 1, digYield: 'dirt', pavable: true, roll: 0.7 },
  [TileType.PackedDirt]: { name: 'Packed dirt', color: [140, 116, 86], speed: 1.05, pavable: true, roll: 0.9 },
  [TileType.Sand]: { name: 'Sand', color: [214, 198, 146], speed: 0.9, digYield: 'sand', pavable: true, collect: true, roll: 0.45 },
  [TileType.Rock]: { name: 'Rock', color: [132, 130, 124], speed: 0.9, mineable: true, roll: 0.85 },
  [TileType.Steppe]: { name: 'Steppe', color: [156, 150, 84], speed: 1, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true, roll: 0.7 },
  [TileType.Tundra]: { name: 'Tundra', color: [144, 154, 124], speed: 0.95, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true, roll: 0.65 },
  [TileType.Marsh]: { name: 'Marsh', color: [74, 112, 74], speed: 0.6, digYield: 'dirt', forage: true, botanize: true, turnsToDirt: true, roll: 0.3 },
  [TileType.Clay]: { name: 'Clay', color: [166, 138, 108], speed: 0.9, digYield: 'clay', collect: true, roll: 0.45 },
  [TileType.Peat]: { name: 'Peat', color: [74, 60, 46], speed: 0.8, digYield: 'peat', collect: true, roll: 0.4 },
  [TileType.Tar]: { name: 'Tar', color: [36, 32, 32], speed: 0.5, digYield: 'tar', collect: true, roll: 0.25 },
  [TileType.Moss]: { name: 'Moss', color: [82, 126, 66], speed: 1, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true, roll: 0.65 },
  [TileType.Snow]: { name: 'Snow', color: [236, 240, 245], speed: 0.8, mineable: true, roll: 0.35 },
  [TileType.Gravel]: { name: 'Gravel', color: [156, 152, 144], speed: 1.15, pavable: true, roll: 1 },
  [TileType.Cobblestone]: { name: 'Cobblestone', color: [126, 122, 116], speed: 1.25, roll: 1 },
  [TileType.Field]: { name: 'Field', color: [130, 102, 62], speed: 0.9, digYield: 'dirt', turnsToDirt: true, roll: 0.5 },
  [TileType.Tree]: { name: 'Tree', color: [76, 124, 56], speed: 1, blocks: true, roll: 0.6 },
  [TileType.Bush]: { name: 'Bush', color: [86, 138, 60], speed: 0.5, roll: 0.4 },
  // Walked over, and in the way of everything else until it is dug out or
  // rots: no digging its corners, no planting, no paving, no building.
  [TileType.Stump]: { name: 'Stump', color: [98, 130, 58], speed: 0.7, roll: 0.35 },
  [TileType.Kelp]: { name: 'Kelp', color: [66, 106, 88], speed: 1, roll: 0.5 },
  [TileType.Reed]: { name: 'Reed', color: [96, 132, 80], speed: 0.8, roll: 0.4 },
  [TileType.Lawn]: { name: 'Lawn', color: [104, 164, 74], speed: 1, forage: true, botanize: true, pavable: true, turnsToDirt: true, roll: 0.75 },
  [TileType.Slabs]: { name: 'Stone slabs', color: [172, 170, 164], speed: 1.3, roll: 1 },
};

/**
 * Slab paving comes in the four stones it is cut from, kept in the tile's data
 * byte the way a rock tile keeps its seam.
 */
export const SLAB_VARIANTS: Array<{ name: string; color: RGB; item: string }> = [
  { name: 'Stone slabs', color: [172, 170, 164], item: 'stone_slab' },
  { name: 'Slate slabs', color: [104, 112, 126], item: 'slate_slab' },
  { name: 'Marble slabs', color: [224, 222, 216], item: 'marble_slab' },
  { name: 'Sandstone slabs', color: [204, 180, 134], item: 'sandstone_slab' },
];
export const slabVariant = (data: number): number => Math.min(SLAB_VARIANTS.length - 1, data & 3);
export const SLAB_BY_ITEM = new Map(SLAB_VARIANTS.map((v, i) => [v.item, i]));

export interface TreeDef {
  name: string;
  shape: 'round' | 'conifer' | 'weeping';
  trunk: string;
  canopy: [light: string, mid: string, dark: string];
  /** Relative size of the full grown tree. */
  size: number;
  /** Fruit it bears once it is grown, for the three that bear any. */
  fruit?: string;
}

/** Tree species; stored in the low nibble of a tree tile's data byte. */
export const TREE_DEFS: TreeDef[] = [
  { name: 'Birch', shape: 'round', trunk: '#e8e4d8', canopy: ['#b6dc78', '#88b852', '#5f8c3a'], size: 0.85 },
  { name: 'Pine', shape: 'conifer', trunk: '#6d4b32', canopy: ['#6fa06a', '#3f7048', '#2b4f34'], size: 1 },
  { name: 'Oak', shape: 'round', trunk: '#5c4330', canopy: ['#9ac560', '#5f9438', '#3f6a27'], size: 1.1 },
  { name: 'Maple', shape: 'round', trunk: '#6b4a34', canopy: ['#f0b053', '#d6782e', '#9c4a1c'], size: 0.95 },
  { name: 'Willow', shape: 'weeping', trunk: '#7a6248', canopy: ['#c4dc8c', '#93b864', '#6a8c48'], size: 1 },
  { name: 'Cedar', shape: 'conifer', trunk: '#7c5236', canopy: ['#8fb87c', '#5a8a5c', '#3c6440'], size: 1.05 },
  // The three that bear. They grow wild only here and there; an orchard is
  // something you plant.
  { name: 'Apple', shape: 'round', trunk: '#6a4a33', canopy: ['#8fc060', '#5f9440', '#41682c'], size: 0.8, fruit: 'apple' },
  { name: 'Cherry', shape: 'round', trunk: '#5a3c30', canopy: ['#a8cc70', '#74a047', '#4d7030'], size: 0.78, fruit: 'cherry' },
  { name: 'Olive', shape: 'round', trunk: '#8a7a62', canopy: ['#9aae84', '#6f8a64', '#4f6448'], size: 0.75, fruit: 'olive' },
];

export interface BushDef {
  name: string;
  foliage: [light: string, dark: string];
  flowers?: string;
  /** What a sickle cuts off it, or nothing worth the blade. */
  yields?: string;
}

export const BUSH_DEFS: BushDef[] = [
  { name: 'Rose bush', foliage: ['#6ea24a', '#3e6a2c'], flowers: '#e0455f', yields: 'rose_petals' },
  { name: 'Thorn bush', foliage: ['#7e9a4e', '#4c6430'] },
  { name: 'Lavender bush', foliage: ['#8faa7a', '#5f7a52'], flowers: '#9a6fd0', yields: 'lavender' },
];

export interface RockVariantDef {
  name: string;
  color: RGB;
  /** Item produced by mining a corner of it. */
  yields: string;
  /** Mining skill a seam of this needs before it can be worked at all. */
  level?: number;
}

/** Kinds of rock; stored in the data byte of a Rock tile. */
export const ROCK_VARIANTS: RockVariantDef[] = [
  // Plain stone, dug out for shards.
  { name: 'Rock', color: [132, 130, 124], yields: 'rock_shards' },
  { name: 'Slate', color: [98, 106, 120], yields: 'slate_shards' },
  { name: 'Marble', color: [216, 214, 208], yields: 'marble_shards' },
  { name: 'Sandstone', color: [198, 172, 124], yields: 'sandstone_shards' },
  // Metal, in order of the skill it takes to work.
  { name: 'Copper vein', color: [162, 116, 74], yields: 'copper_ore', level: 1 },
  { name: 'Coal seam', color: [58, 56, 58], yields: 'coal', level: 1 },
  { name: 'Tin vein', color: [178, 180, 174], yields: 'tin_ore', level: 10 },
  { name: 'Zinc vein', color: [154, 166, 172], yields: 'zinc_ore', level: 20 },
  { name: 'Lead vein', color: [108, 112, 124], yields: 'lead_ore', level: 30 },
  { name: 'Silver vein', color: [186, 190, 198], yields: 'silver_ore', level: 40 },
  { name: 'Gold vein', color: [198, 168, 86], yields: 'gold_ore', level: 50 },
  { name: 'Adamantine vein', color: [96, 128, 152], yields: 'adamantine_ore', level: 60 },
  { name: 'Glimmersteel vein', color: [206, 216, 230], yields: 'glimmersteel_ore', level: 70 },
  { name: 'Mithril vein', color: [138, 166, 214], yields: 'mithril_ore', level: 80 },
  { name: 'Seryll vein', color: [214, 196, 132], yields: 'seryll_ore', level: 90 },
  // Iron belongs at mining 5, between copper and tin, and sits here at the end
  // of the list instead. Which rock lies under which tile is written down per
  // tile as an index into this array, so putting a metal in the middle would
  // quietly turn every saved coal seam into iron, every tin vein into coal, and
  // so on down the line. The order of this list is storage; `level` is the
  // ladder.
  { name: 'Iron vein', color: [124, 82, 74], yields: 'iron_ore', level: 5 },
];
/**
 * Four bits of the data byte, which is sixteen kinds of rock and no more —
 * and the list above now holds exactly sixteen. A seventeenth needs another
 * bit before it needs a name.
 */
/**
 * Whether a face gives up anything but shards.
 *
 * Not the same question as `ore`, which is `yields` ending in `_ore` and
 * nothing more. A coal seam yields plain `coal`, so it fails that test — and
 * every rule that goes looking for something worth mining asks that test, so a
 * coal seam was invisible to prospecting, said "no metal in it" when you stood
 * on one, and was quarry work rather than a miner's. The ground had them all
 * along; nothing could see them.
 *
 * Stated as what it is rather than as a list, so a rock added later is
 * classified by what it gives up rather than by somebody remembering.
 */
export const isSeam = (rock: { yields: string }): boolean => !rock.yields.endsWith('_shards');

export const rockVariant = (data: number): number => Math.min(ROCK_VARIANTS.length - 1, data & 15);

/**
 * What a tree is worth to bring down, by how far along it is.
 *
 * Felling used to be one swing and a species: birch one log, pine two, and an
 * old one of anything a log more than a grown one. A tree the size of a house
 * and a tree you could step over came down for the same single stroke.
 *
 * Now it is the age that decides both — how many landed cuts it takes, and what
 * is left on the ground afterwards — and the species decides nothing. A sapling
 * is one stroke and no timber, which is to say it is cleared rather than felled.
 *
 * ## Why the numbers are in this order
 *
 * The two bits over the species have held 0 young, 1 mature, 2 old since the
 * day a tree had an age at all, and every tree standing on the island holds one
 * of those three. Sapling is the *fourth* value rather than the first, so that
 * adding a stage younger than any of them does not quietly make every wood on
 * every island one age younger than the day before.
 *
 * So the table is indexed by the byte, not by seniority, and nothing reads it
 * as an order. `bears` is what "old enough to fruit" used to ask as `=== 0`.
 */
export interface TreeAge {
  /** The value in the age bits. Not a rank: see above. */
  id: number;
  name: string;
  /** Landed cuts to bring it down. A cut that glances off is not one of them. */
  hits: number;
  /** What it leaves on the ground when it goes. */
  logs: number;
  /** Whether it is grown enough to fruit. */
  bears: boolean;
  /**
   * Whether there is life in it. A shrivelled tree is timber standing up:
   * nothing hangs on it, nothing sprouts from it, and there is no pruning it.
   */
  alive: boolean;
  /**
   * What it becomes when its day is up, or null for the last of them.
   *
   * Written down rather than counted, because the stored values are in the
   * order they were added and not the order a tree lives them: a sapling is 3
   * and grows into 0. Nothing has to know that but this column.
   */
  next: number | null;
  /**
   * What a hatchet prunes it back to, or null for one too young to prune.
   *
   * Asked for as "only old and mature trees": a stage back apiece, so an old
   * tree that would be gone when its day is up is a mature one instead, and a
   * mature one is young and stops bearing until it grows again. Written down
   * like `next` rather than worked backwards from it, so that either side of
   * the wire reads it off the table and neither has to know the order.
   */
  pruned: number | null;
  /** How big it is drawn, as a share of the species' own size. */
  size: number;
  /**
   * How it is drawn: grown as its species is; worn, the same with a thinned
   * and browning crown and bare wood showing through; bare, a dead trunk and
   * branches with no crown at all; clipped, a low flat-topped shrub.
   */
  look: 'grown' | 'worn' | 'bare' | 'clipped';
}

export const TREE_AGES: TreeAge[] = [
  { id: 0, name: 'Young', hits: 2, logs: 2, bears: false, alive: true, next: 1, pruned: null, size: 0.7, look: 'grown' },
  { id: 1, name: 'Mature', hits: 3, logs: 4, bears: true, alive: true, next: 2, pruned: 0, size: 0.92, look: 'grown' },
  { id: 2, name: 'Old', hits: 3, logs: 3, bears: true, alive: true, next: 4, pruned: 1, size: 1.12, look: 'grown' },
  { id: 3, name: 'Sapling', hits: 1, logs: 0, bears: false, alive: true, next: 0, pruned: 6, size: 0.4, look: 'grown' },
  // The last two days. A very old tree is the biggest timber there is and the
  // last stage a hatchet can take back; a shrivelled one is dead wood standing
  // up, felled for what is in it, and gone when its day is up.
  { id: 4, name: 'Very old', hits: 4, logs: 5, bears: true, alive: true, next: 5, pruned: 2, size: 1.2, look: 'worn' },
  { id: 5, name: 'Shrivelled', hits: 2, logs: 2, bears: false, alive: false, next: null, pruned: null, size: 1.05, look: 'bare' },
  // A sapling pruned back: a shrub for good. Its next stage is itself, which
  // is how a stage that never turns over is written down.
  { id: 6, name: 'Clipped', hits: 1, logs: 0, bears: false, alive: true, next: 6, pruned: null, size: 0.48, look: 'clipped' },
];

/**
 * A day apiece, and a real one.
 *
 * Asked for from the island as "a real life day" per stage, so this is wall
 * clock seconds and not the world's own faster hours: a tree planted on a
 * Tuesday is a young tree on Wednesday whether or not anybody was logged in
 * for any of it. Six days from a sapling to a stump — the last two of them
 * very old and then shrivelled — and the stump leaves two saplings behind it.
 */
export const TREE_STAGE = 24 * 60 * 60;

/** The most an old tree leaves behind it when its day is up. */
export const TREE_SEEDS = 2;

/**
 * How many it actually leaves, and how much room it wants to leave them.
 *
 * Two apiece is two offspring per tree per life, which is a doubling every four
 * days until there is no plantable ground left on the island — measured: a wood
 * at a quarter density is the whole map inside three weeks.
 *
 * What stops that is not a smaller number. A flat average of one is not
 * replacement either, because a seed that finds no room is a seed lost and
 * nothing ever gives one back: measured, a wood at a quarter thins to a sixth
 * over eight months and keeps going. There is no flat average that holds — a
 * hair over one fills the island slowly, a hair under empties it slowly.
 *
 * So the roll is a little over replacement and the *room* does the regulating.
 * A stump in the open leaves 1.1 on average; a stump hemmed in leaves fewer or
 * none. That gives a wood somewhere to settle rather than somewhere to run to,
 * and it settles there from either side — measured on a real island, the same
 * ground sown at a fifth and at four fifths, forty days each:
 *
 *     mean 1.02    a fifth -> 17%, four fifths -> 32%    both down
 *     mean 1.10    a fifth -> 30%, four fifths -> 46%    <- this one
 *     mean 1.30    a fifth -> 68%, four fifths -> 69%
 *     mean 1.50    a fifth -> 78%, four fifths -> 78%
 *
 * A shade over one is not enough. 1.02 with the same room cap was built and
 * run, and both ends fall: the thin wood is still falling at three hundred
 * days, by which point a fifth of the island has become a twentieth. The room
 * cap cannot save it, because at low density there is always room and the cap
 * never fires — moving the thresholds anywhere between 3+ and 8+ barely
 * touched it.
 *
 * The reason is worth keeping: seeds are lost to more than crowding. Two stumps
 * that pick the same tile plant one tree between them, a stump at the island's
 * edge has fewer neighbours to try, and a stump beside a settlement may have
 * nowhere at all. Every one of those is a seed gone and none of them ever gives
 * one back, so the surplus has to cover them before it can hold a wood up.
 *
 * 1.10 is the gentlest that does. The ones above it settle at two thirds of the
 * island and better, which is a wood with no clearings in it and a daily
 * turnover three times the size.
 */
export const TREE_SEED_NONE = 0.2;
export const TREE_SEED_BOTH = 0.3;

/** Free ground round the stump, of the twenty-four tiles near it, for two and for one. */
export const TREE_ROOM_TWO = 8;
export const TREE_ROOM_ONE = 4;

/** How far from the stump one of them may take, in tiles. */
export const TREE_SEED_REACH = 2;

/**
 * How much of a wild wood is scrub too small to be worth a hatchet.
 *
 * Saplings have to come from somewhere, and the only other candidate was
 * planting — which would make a planted sprout worth nothing for ever, since
 * nothing on this island grows a tree from one age to the next. So they grow
 * where the rest of the wood grew, and clearing one costs a stroke and returns
 * a stroke's worth of nothing, which is what a sapling is.
 */
export const SAPLING_SHARE = 0.12;

export const treeSpecies = (data: number): number => Math.min(TREE_DEFS.length - 1, data & 15);
/**
 * The age, in the four bits over the species.
 *
 * Two of them for a long time, with the felling notch in the two above. Four
 * values was one short the day a fifth stage was wanted, and of the two
 * things sharing the byte the notch was the one with somewhere else to be: a
 * half-felled tree is rare and brief, and the byte is every tree on the
 * island. So the notch lives beside the land rather than in it — `World.notches`
 * here, `tree_notch` on the island — and the age has room for sixteen stages.
 *
 * `TREE_DATA_LAYOUT` says which layout a byte was written under, for a solo
 * save to carry: one from before has its top two bits cleared on the way in.
 */
export const TREE_DATA_LAYOUT = 2;
export const treeVariant = (data: number): number => (data >> 4) & 15;
/** How far along the tree on this tile is. A value no stage answers to reads as young. */
export const treeAge = (data: number): TreeAge => TREE_AGES[treeVariant(data)] ?? TREE_AGES[0];
export const bushSpecies = (data: number): number => Math.min(BUSH_DEFS.length - 1, data & 15);
export const packTreeData = (species: number, variant: number): number => (species & 15) | ((variant & 15) << 4);
