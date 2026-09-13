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
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

export type RGB = readonly [number, number, number];

export interface TileDef {
  name: string;
  color: RGB;
  /** Movement speed multiplier. */
  speed: number;
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
}

export const TILE_DEFS: Record<TileType, TileDef> = {
  [TileType.Grass]: { name: 'Grass', color: [92, 146, 62], speed: 1, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true },
  [TileType.Dirt]: { name: 'Dirt', color: [121, 92, 60], speed: 1, digYield: 'dirt', pavable: true },
  [TileType.PackedDirt]: { name: 'Packed dirt', color: [140, 116, 86], speed: 1.05, pavable: true },
  [TileType.Sand]: { name: 'Sand', color: [214, 198, 146], speed: 0.9, digYield: 'sand', pavable: true },
  [TileType.Rock]: { name: 'Rock', color: [132, 130, 124], speed: 0.9, mineable: true },
  [TileType.Steppe]: { name: 'Steppe', color: [156, 150, 84], speed: 1, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true },
  [TileType.Tundra]: { name: 'Tundra', color: [144, 154, 124], speed: 0.95, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true },
  [TileType.Marsh]: { name: 'Marsh', color: [74, 112, 74], speed: 0.6, digYield: 'dirt', forage: true, botanize: true, turnsToDirt: true },
  [TileType.Clay]: { name: 'Clay', color: [166, 138, 108], speed: 0.9, digYield: 'clay' },
  [TileType.Peat]: { name: 'Peat', color: [74, 60, 46], speed: 0.8, digYield: 'peat' },
  [TileType.Tar]: { name: 'Tar', color: [36, 32, 32], speed: 0.5, digYield: 'tar' },
  [TileType.Moss]: { name: 'Moss', color: [82, 126, 66], speed: 1, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true },
  [TileType.Snow]: { name: 'Snow', color: [236, 240, 245], speed: 0.8, mineable: true },
  [TileType.Gravel]: { name: 'Gravel', color: [156, 152, 144], speed: 1.15, pavable: true },
  [TileType.Cobblestone]: { name: 'Cobblestone', color: [126, 122, 116], speed: 1.25 },
  [TileType.Field]: { name: 'Field', color: [130, 102, 62], speed: 0.9, digYield: 'dirt', turnsToDirt: true },
  [TileType.Tree]: { name: 'Tree', color: [76, 124, 56], speed: 1, blocks: true },
  [TileType.Bush]: { name: 'Bush', color: [86, 138, 60], speed: 0.5 },
  [TileType.Kelp]: { name: 'Kelp', color: [66, 106, 88], speed: 1 },
  [TileType.Reed]: { name: 'Reed', color: [96, 132, 80], speed: 0.8 },
  [TileType.Lawn]: { name: 'Lawn', color: [104, 164, 74], speed: 1, forage: true, botanize: true, pavable: true, turnsToDirt: true },
  [TileType.Slabs]: { name: 'Stone slabs', color: [172, 170, 164], speed: 1.3 },
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
  logs: number;
}

/** Tree species; stored in the low nibble of a tree tile's data byte. */
export const TREE_DEFS: TreeDef[] = [
  { name: 'Birch', shape: 'round', trunk: '#e8e4d8', canopy: ['#b6dc78', '#88b852', '#5f8c3a'], size: 0.85, logs: 1 },
  { name: 'Pine', shape: 'conifer', trunk: '#6d4b32', canopy: ['#6fa06a', '#3f7048', '#2b4f34'], size: 1, logs: 2 },
  { name: 'Oak', shape: 'round', trunk: '#5c4330', canopy: ['#9ac560', '#5f9438', '#3f6a27'], size: 1.1, logs: 2 },
  { name: 'Maple', shape: 'round', trunk: '#6b4a34', canopy: ['#f0b053', '#d6782e', '#9c4a1c'], size: 0.95, logs: 1 },
  { name: 'Willow', shape: 'weeping', trunk: '#7a6248', canopy: ['#c4dc8c', '#93b864', '#6a8c48'], size: 1, logs: 1 },
  { name: 'Cedar', shape: 'conifer', trunk: '#7c5236', canopy: ['#8fb87c', '#5a8a5c', '#3c6440'], size: 1.05, logs: 2 },
];

export interface BushDef {
  name: string;
  foliage: [light: string, dark: string];
  flowers?: string;
}

export const BUSH_DEFS: BushDef[] = [
  { name: 'Rose bush', foliage: ['#6ea24a', '#3e6a2c'], flowers: '#e0455f' },
  { name: 'Thorn bush', foliage: ['#7e9a4e', '#4c6430'] },
  { name: 'Lavender bush', foliage: ['#8faa7a', '#5f7a52'], flowers: '#9a6fd0' },
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
];
/** Four bits of the data byte, so there is room for every kind of seam. */
export const rockVariant = (data: number): number => Math.min(ROCK_VARIANTS.length - 1, data & 15);

export const treeSpecies = (data: number): number => Math.min(TREE_DEFS.length - 1, data & 15);
export const treeVariant = (data: number): number => Math.min(2, (data >> 4) & 3);
export const bushSpecies = (data: number): number => Math.min(BUSH_DEFS.length - 1, data & 15);
export const packTreeData = (species: number, variant: number): number => (species & 15) | ((variant & 3) << 4);
