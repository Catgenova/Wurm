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
  /*
   * 13 was gravel, which is retired: it was the cheap paving and it was the
   * ugly one, a heap of chips with no work in it, and cobblestone now costs
   * the same handful of rock shards and does the same job properly. The id
   * is left out rather than reused, because land laid down before this is
   * still full of thirteens and they are turned to cobblestone where they
   * come in rather than silently becoming whatever took the number.
   */
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
export const HARD_EDGED: ReadonlySet<number> = new Set<number>([TileType.Rock, TileType.Slabs, TileType.Cobblestone]);

/**
 * How far a tile of sand with the sea against it goes towards wet.
 *
 * Damp sand is darker and a shade cooler than dry, and the band of it is where
 * the last wave reached. It is the strongest thing about a beach seen from
 * above and it costs four tile reads: a beach without it is a flat cream
 * ribbon, and a beach with it is a beach.
 */
export const DAMP_SAND: readonly [number, number, number] = [204, 190, 160];

/**
 * The grounds drawn as one flat colour: no grain, and no nudge of brightness
 * from one tile of them to the next.
 *
 * Everything else gets both -- five specks a tile close up, and a tenth
 * either way per tile, so a wide sheet of one ground does not read as paper.
 * These do not want either. The pictures they are drawn from are flat colour
 * with the detail sitting *on* it in pieces you can count, and a speckle over
 * the whole tile puts the ground into the same range of light and dark as the
 * things standing in it. The per-tile nudge is worse: a tenth either way is a
 * chequerboard, and on the bare grounds -- a road, a beach, a dug plot, all
 * of them wide sheets of one colour -- it was the loudest thing in the
 * picture, a tiled floor where a path should be.
 */
export const FLAT: ReadonlySet<number> = new Set<number>([
  TileType.Grass, TileType.Steppe, TileType.Rock, TileType.Sand,
  TileType.Dirt, TileType.PackedDirt, TileType.Field,
]);

/**
 * The flat grounds with things lying about on them, and what each one has is
 * in `meadow.ts`: clumps in a meadow, tussocks on a steppe, clods on a dug
 * path, stones trodden into a packed one, pebbles on a beach.
 *
 * All of it is the same machinery. A thing lying on a ground is a few lobes
 * with a line round them and a light on top, and it is painted in three tones
 * worked out from the colour of the ground it lies on, so a ground joins this
 * by saying what its colour is and what the stuff on it is called.
 *
 * Rock is flat and has nothing: a stone shelf with lumps of stone strewn on
 * it is a stone shelf with a rash.
 */
export const STREWN: ReadonlySet<number> = new Set<number>([
  TileType.Grass, TileType.Steppe, TileType.Dirt, TileType.PackedDirt, TileType.Sand,
]);

/**
 * And the two that are a *field*, which is a narrower thing: the grounds that
 * run out over the edge of a bare one rather than stopping at the line
 * between them. Only these ruffle, so a dug path beside a packed one still
 * meets it on the tile line, the way two bare grounds should.
 */
export const SWARDED: ReadonlySet<number> = new Set<number>([TileType.Grass, TileType.Steppe]);

/**
 * The bare grounds that a field runs out over the edge of.
 *
 * Earth somebody walked or packed, the stone a hillside wears through to, and
 * the sand above a tideline: a field does not stop dead at any of them, so the
 * join is drawn as a ruffle of lobes hanging over the bare side rather than as
 * the soft band of one colour into the other every other pair of grounds gets.
 * Both at once is a ruffle standing in a smear.
 *
 * Rock is in here and in `HARD_EDGED` both, which is the point of it. Blending
 * washed a scallop of grass right round every cliff -- a band of the
 * neighbour's colour reaching in, with nothing in it that knows the neighbour
 * is twenty feet below. The ruffle is drawn from the stone's own tile and
 * clipped to it, and it only goes on where the two are at much the same
 * height.
 */
export const RUFFLED: ReadonlySet<number> = new Set<number>([TileType.Dirt, TileType.PackedDirt, TileType.Rock, TileType.Sand]);

/** Whether these two grounds meet in a ruffle rather than a blended band. */
export const ruffledJoin = (a: number, b: number): boolean =>
  (SWARDED.has(a) && RUFFLED.has(b)) || (SWARDED.has(b) && RUFFLED.has(a));

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
 *
 * And a reed bed: a spadeful of dirt on it is dry ground, the way a marsh is
 * drained, and the reeds are gone with the wet they stood in.
 */
export const BURYABLE: ReadonlySet<number> = new Set<number>([
  TileType.Grass, TileType.Lawn, TileType.Steppe, TileType.Tundra, TileType.Moss,
  TileType.Marsh, TileType.Sand, TileType.Clay, TileType.Peat, TileType.Tar, TileType.Reed,
]);

/**
 * How much a footfall raises off a given ground. Dry loose stuff — sand,
 * bare dirt, a ploughed field — goes up in a cloud; turf and moss hold
 * together and barely mark; a marsh swallows the whole question.
 */
export const DUSTINESS: Readonly<Record<number, number>> = {
  [TileType.Sand]: 1,
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
  /** Laid stone: a shod mount goes quicker on it. */
  paved?: boolean;
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
  /*
   * A teal blue-green rather than the yellow-green of a hayfield: cool and a
   * shade off what a field is supposed to be, which is the whole map moving
   * at once and is the point of it. It went to 125, 195, 166 first and came
   * back ten degrees of hue towards green and a little darker with it, which
   * is where a field stops reading as water.
   *
   * 92, 146, 62 was picked when grass was one flat colour and had to carry a
   * field on its own. It is flat colour again now -- the clumps growing in it
   * are the only thing on it -- but a loud warm green under them is a green
   * as loud as they are, and the eye cannot find a thing on a ground that is
   * shouting. A mown lawn stays the deeper and stronger of the two, because a
   * lawn is tended and a meadow is what the summer left.
   */
  [TileType.Grass]: { name: 'Grass', color: [110, 188, 142], speed: 1, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true, roll: 0.7 },
  /*
   * A dusty clay leaning a little rose: not the dark chocolate it started as
   * and not the sandy tan it went to next. Bare earth against a teal field is
   * the loudest join on the island -- at 121, 92, 60 a footpath read as a
   * trench cut through it, and a saturated brown is a trench however light
   * you make it. Packed dirt stays the lighter and greyer of the two -- it is
   * earth somebody walked flat and dusty -- and a ploughed field the darkest,
   * because turned soil is wet soil.
   */
  [TileType.Dirt]: { name: 'Dirt', color: [186, 155, 135], speed: 1, digYield: 'dirt', pavable: true, roll: 0.7 },
  /*
   * Greyer and dustier than the dirt it was made from, not just lighter.
   * Both of them were the same brown at two brightnesses and a road beside a
   * dug plot read as one ground somebody had shaded in: earth that has been
   * walked flat for a season has the colour trodden out of it.
   */
  [TileType.PackedDirt]: { name: 'Packed dirt', color: [194, 182, 168], speed: 1.05, pavable: true, roll: 0.9 },
  /*
   * Clean cream, and the palest ground on the island. It was a saturated
   * yellow-tan for a long while -- the last colour on the map still picked
   * for a yellow-green field -- and between a blue sea and a teal shore that
   * was the loudest thing in the picture, when the whole use of a beach is to
   * be the quiet strip between the two.
   *
   * It is flat like the others -- no grain, no nudge from one tile to the
   * next -- a field runs out over the top of it rather than stopping at a
   * ruled line, and where the sea is against it it is damp. That last is most
   * of what makes a beach read as a beach rather than as a cream stripe
   * between a field and the water.
   */
  [TileType.Sand]: { name: 'Sand', color: [228, 219, 195], speed: 0.9, digYield: 'sand', pavable: true, collect: true, roll: 0.45 },
  [TileType.Rock]: { name: 'Rock', color: [168, 166, 178], speed: 0.9, mineable: true, roll: 0.85 },
  /*
   * Dry grass, pale and clean, rather than the mustard it was. 156, 150, 84
   * was a colour for a field of one flat green to sit beside and came out as
   * mud against a teal one -- it was the loudest thing left on the island and
   * covered more of it than anything else does.
   *
   * It stops here rather than going paler still. Two hundred and four, a
   * hundred and ninety-eight, a hundred and fifty read better on its own and
   * came far too near the sand, and a beach you cannot tell from a steppe is
   * worse than a steppe that is a little green.
   */
  [TileType.Steppe]: { name: 'Steppe', color: [178, 190, 140], speed: 1, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true, roll: 0.7 },
  [TileType.Tundra]: { name: 'Tundra', color: [144, 154, 124], speed: 0.95, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true, roll: 0.65 },
  [TileType.Marsh]: { name: 'Marsh', color: [78, 112, 96], speed: 0.6, digYield: 'dirt', forage: true, botanize: true, turnsToDirt: true, roll: 0.3 },
  [TileType.Clay]: { name: 'Clay', color: [166, 138, 108], speed: 0.9, digYield: 'clay', collect: true, roll: 0.45 },
  [TileType.Peat]: { name: 'Peat', color: [74, 60, 46], speed: 0.8, digYield: 'peat', collect: true, roll: 0.4 },
  [TileType.Tar]: { name: 'Tar', color: [36, 32, 32], speed: 0.5, digYield: 'tar', collect: true, roll: 0.25 },
  [TileType.Moss]: { name: 'Moss', color: [72, 124, 93], speed: 1, digYield: 'dirt', forage: true, botanize: true, pavable: true, turnsToDirt: true, roll: 0.65 },
  [TileType.Snow]: { name: 'Snow', color: [236, 240, 245], speed: 0.8, mineable: true, roll: 0.35 },
  [TileType.Cobblestone]: { name: 'Cobblestone', paved: true, color: [126, 122, 116], speed: 1.25, roll: 1 },
  [TileType.Field]: { name: 'Field', color: [158, 122, 104], speed: 0.9, digYield: 'dirt', turnsToDirt: true, roll: 0.5 },
  [TileType.Tree]: { name: 'Tree', color: [62, 122, 86], speed: 1, blocks: true, roll: 0.6 },
  [TileType.Bush]: { name: 'Bush', color: [66, 134, 92], speed: 0.5, roll: 0.4 },
  // Walked over, and in the way of everything else until it is dug out or
  // rots: no digging its corners, no planting, no paving, no building.
  [TileType.Stump]: { name: 'Stump', color: [64, 127, 82], speed: 0.7, roll: 0.35 },
  [TileType.Kelp]: { name: 'Kelp', color: [71, 106, 97], speed: 1, roll: 0.5 },
  [TileType.Reed]: { name: 'Reed', color: [85, 129, 102], speed: 0.8, roll: 0.4 },
  [TileType.Lawn]: { name: 'Lawn', color: [85, 170, 123], speed: 1, forage: true, botanize: true, pavable: true, turnsToDirt: true, roll: 0.75 },
  [TileType.Slabs]: { name: 'Stone slabs', paved: true, color: [172, 170, 164], speed: 1.3, roll: 1 },
};

/**
 * The grounds that were laid by somebody rather than grown, taken off the
 * definitions rather than listed a second time.
 *
 * A paved tile used to draw as a flat lozenge of one colour like any other
 * ground, which is fair for grass and wrong for work somebody did with a
 * trowel: slabs have joints and cobbles are separate stones. Derived, because
 * a list of two written out by hand is a list that will be three one day and
 * still say two.
 */
export const PAVED: ReadonlySet<number> = new Set<number>(
  Object.entries(TILE_DEFS).filter(([, d]) => d.paved).map(([id]) => Number(id)));

/**
 * Slab paving comes in the four stones it is cut from, kept in the tile's data
 * byte the way a rock tile keeps its seam.
 */
export const SLAB_VARIANTS: Array<{ name: string; color: RGB; item: string; courses: number }> = [
  // `courses` is how many flags run across a tile, which is how big the stone
  // is cut: marble comes off the block whole and slate splits into small
  // pieces. It is the difference between a temple floor and a garden path, and
  // it costs one number a stone to say it.
  { name: 'Stone slabs', color: [172, 170, 164], item: 'stone_slab', courses: 3 },
  { name: 'Slate slabs', color: [104, 112, 126], item: 'slate_slab', courses: 4 },
  { name: 'Marble slabs', color: [224, 222, 216], item: 'marble_slab', courses: 2 },
  { name: 'Sandstone slabs', color: [204, 180, 134], item: 'sandstone_slab', courses: 3 },
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
  /** Fruit it bears once it is grown, for the eleven that bear any. */
  fruit?: string;
}

/**
 * Tree species; stored in a tree tile's data byte, the low nibble and the top
 * bit (`packTreeData`). The order is storage: never reorder these.
 *
 * Every canopy is a teal blue-green, which is the field they stand in and the
 * whole look of the place. They were yellow-greens, picked against a grass
 * that was a yellow-green too; the field moved and they had to move with it,
 * or a wood is a warm thing sitting on a cool one and both of them look like
 * a mistake. Each one's hue came off its old one in order, so the birch is
 * still the palest of them and the pine still the deepest and bluest.
 *
 * The maple is the exception and keeps its orange. It is the autumn tree and
 * the one warm thing in the wood, and it is worth more against this than it
 * ever was against a yellow-green.
 */
export const TREE_DEFS: TreeDef[] = [
  { name: 'Birch', shape: 'round', trunk: '#e8e4d8', canopy: ['#79d391', '#57b172', '#408859'], size: 0.85 },
  { name: 'Pine', shape: 'conifer', trunk: '#6d4b32', canopy: ['#6c9b83', '#44705e', '#305245'], size: 1 },
  { name: 'Oak', shape: 'round', trunk: '#5c4330', canopy: ['#65bc7d', '#3f8f5b', '#2e6a44'], size: 1.1 },
  { name: 'Maple', shape: 'round', trunk: '#6b4a34', canopy: ['#f0b053', '#d6782e', '#9c4a1c'], size: 0.95 },
  { name: 'Willow', shape: 'weeping', trunk: '#7a6248', canopy: ['#8cd49b', '#68b17d', '#4d895f'], size: 1 },
  { name: 'Cedar', shape: 'conifer', trunk: '#7c5236', canopy: ['#7db291', '#5e8774', '#416455'], size: 1.05 },
  // The three that bear. They grow wild only here and there; an orchard is
  // something you plant.
  { name: 'Apple', shape: 'round', trunk: '#6a4a33', canopy: ['#64b87f', '#478f61', '#326846'], size: 0.8, fruit: 'apple' },
  { name: 'Cherry', shape: 'round', trunk: '#5a3c30', canopy: ['#73c488', '#4d9a65', '#367049'], size: 0.78, fruit: 'cherry' },
  { name: 'Olive', shape: 'round', trunk: '#8a7a62', canopy: ['#84a98f', '#668773', '#4c6456'], size: 0.75, fruit: 'olive' },
  // Eight more that bear, asked for, each held to one island of the chart
  // (regions.ts) the way the cherry is, and sprinkled anywhere on an island
  // of your own. Past the ninth the species needs a fifth bit: see below.
  { name: 'Pear', shape: 'round', trunk: '#6b4f38', canopy: ['#73c789', '#53a16b', '#3b784f'], size: 0.82, fruit: 'pear' },
  { name: 'Plum', shape: 'round', trunk: '#4e3a36', canopy: ['#6dad82', '#4d8562', '#3a6149'], size: 0.76, fruit: 'plum' },
  { name: 'Peach', shape: 'round', trunk: '#7a5a44', canopy: ['#7bcc8e', '#5aa670', '#407a52'], size: 0.74, fruit: 'peach' },
  { name: 'Fig', shape: 'round', trunk: '#8c8270', canopy: ['#7ab28b', '#5c8c6f', '#456854'], size: 0.7, fruit: 'fig' },
  { name: 'Lemon', shape: 'round', trunk: '#7c6a4e', canopy: ['#7fce92', '#5cac72', '#418658'], size: 0.68, fruit: 'lemon' },
  { name: 'Pomegranate', shape: 'round', trunk: '#6e4a3c', canopy: ['#6fb983', '#4e9566', '#386e4b'], size: 0.66, fruit: 'pomegranate' },
  { name: 'Apricot', shape: 'round', trunk: '#6f5040', canopy: ['#74c786', '#54a269', '#3b764d'], size: 0.74, fruit: 'apricot' },
  { name: 'Quince', shape: 'round', trunk: '#6a5646', canopy: ['#7fbd90', '#5e936f', '#476e55'], size: 0.72, fruit: 'quince' },
];

/** The trees that bear, by index. */
export const FRUIT_TREES: number[] = TREE_DEFS.map((t, i) => (t.fruit ? i : -1)).filter((i) => i >= 0);
/** The eight of them the chart holds to an island each: everything past the olive. */
export const ISLAND_FRUIT: number[] = FRUIT_TREES.filter((i) => i > TREE_DEFS.findIndex((t) => t.name === 'Olive'));

export interface BushDef {
  name: string;
  foliage: [light: string, dark: string];
  flowers?: string;
  /** What a sickle cuts off it, or nothing worth the blade. */
  yields?: string;
}

/** The three bushes, in the same teal as the canopies. Flowers stay theirs. */
export const BUSH_DEFS: BushDef[] = [
  { name: 'Rose bush', foliage: ['#509c6a', '#326a49'], flowers: '#e0455f', yields: 'rose_petals' },
  { name: 'Thorn bush', foliage: ['#549564', '#366444'] },
  { name: 'Lavender bush', foliage: ['#7ba589', '#567963'], flowers: '#9a6fd0', yields: 'lavender' },
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
/**
 * How much of the metal shows in the colour of a tile of it.
 *
 * The seam itself is shapes drawn in the stone (`render/seam.ts`) and that is
 * the picture. This is the long view, for the zoom the shapes are too small to
 * draw at: a tile filled with the ore outright was a coloured rectangle, and a
 * tile filled with plain stone would be a seam nobody could see from the top
 * of the next hill.
 *
 * An eighth of the way over and no further. The thing that gives it away is
 * that a tile is a square and a seam is not: at a third the boundary of a
 * patch of ore read as a painted rectangle straight through the shapes lying
 * over it, and the shapes are the half of this that is telling the truth.
 */
export const ORE_WASH = 0.13;

/** That mix, into a buffer the caller owns: this is worked out per tile per frame. */
export function oreWash(ore: readonly number[], into: [number, number, number]): [number, number, number] {
  const stone = ROCK_VARIANTS[0].color;
  for (let i = 0; i < 3; i++) into[i] = stone[i] + (ore[i] - stone[i]) * ORE_WASH;
  return into;
}

export const ROCK_VARIANTS: RockVariantDef[] = [
  // Plain stone, dug out for shards.
  { name: 'Rock', color: [168, 166, 178], yields: 'rock_shards' },
  { name: 'Slate', color: [149, 154, 163], yields: 'slate_shards' },
  { name: 'Marble', color: [220, 217, 211], yields: 'marble_shards' },
  { name: 'Sandstone', color: [201, 190, 172], yields: 'sandstone_shards' },
  // Metal, in order of the skill it takes to work.
  { name: 'Copper vein', color: [180, 143, 110], yields: 'copper_ore', level: 1 },
  { name: 'Coal seam', color: [88, 85, 90], yields: 'coal', level: 1 },
  { name: 'Tin vein', color: [190, 191, 188], yields: 'tin_ore', level: 10 },
  { name: 'Zinc vein', color: [172, 181, 186], yields: 'zinc_ore', level: 20 },
  { name: 'Lead vein', color: [137, 140, 151], yields: 'lead_ore', level: 30 },
  { name: 'Silver vein', color: [196, 199, 205], yields: 'silver_ore', level: 40 },
  { name: 'Gold vein', color: [202, 181, 125], yields: 'gold_ore', level: 50 },
  { name: 'Adamantine vein', color: [129, 152, 171], yields: 'adamantine_ore', level: 60 },
  { name: 'Glimmersteel vein', color: [212, 219, 229], yields: 'glimmersteel_ore', level: 70 },
  { name: 'Mithril vein', color: [162, 181, 216], yields: 'mithril_ore', level: 80 },
  { name: 'Seryll vein', color: [215, 202, 159], yields: 'seryll_ore', level: 90 },
  // Iron belongs at mining 5, between copper and tin, and sits here at the end
  // of the list instead. Which rock lies under which tile is written down per
  // tile as an index into this array, so putting a metal in the middle would
  // quietly turn every saved coal seam into iron, every tin vein into coal, and
  // so on down the line. The order of this list is storage; `level` is the
  // ladder.
  { name: 'Iron vein', color: [158, 112, 104], yields: 'iron_ore', level: 5 },
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

/**
 * The kind of rock in the data byte of a Rock tile.
 *
 * Not what a face is *drawn* as — that is `World.rockFace`, off the bedrock
 * array, because a face the generator laid down carries no kind in its byte.
 * This is the byte itself, which both sides still write when a tile is dug
 * bare and which `supabase/test/agree.ts` compares across the wire.
 */
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
 * A day apiece, and a real one, turning at dawn.
 *
 * Asked for from the island as "a real life day" per stage, so this is wall
 * clock and not the world's own faster hours: a tree planted on a Tuesday is a
 * young tree on Wednesday whether or not anybody was logged in for any of it.
 * Six days from a sapling to a stump — the last two of them very old and then
 * shrivelled — and the stump leaves two saplings behind it.
 *
 * Asked for next: "make the tree tick fire at 6am UTC-7 every day". The day
 * used to be measured from the last turnover, so it crept ten minutes a day
 * and fell at a different hour on every island. It turns at dawn now, the same
 * moment everywhere: thirteen hundred UTC, six in the morning at UTC-7 — a
 * fixed offset rather than a place, so it does not move with the clocks. The
 * island's `tree_tick` reads the same hour off `tree_dawn_utc()`, and both
 * sides' Look says when the next one is.
 */
export const TREE_DAWN_UTC = 13;
const DAY = 24 * 60 * 60;
/** The most recent dawn at or before `now`, in epoch seconds. */
export const lastDawn = (now: number): number => Math.floor((now - TREE_DAWN_UTC * 3600) / DAY) * DAY + TREE_DAWN_UTC * 3600;
/** The first dawn after `now`. */
export const nextDawn = (now: number): number => lastDawn(now) + DAY;

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

/**
 * A grass tile kept cut on a deed becomes lawn.
 *
 * The data byte of a grass tile, which nothing else used, keeps the count:
 * the low two bits are days cut running, and the bit above them says it was
 * cut today. The day's pass moves the flag into the count and the third day
 * makes lawn; a day with no cut sets the count back to nought. The island
 * reads the same bits, in `tree_day`.
 */
export const MOWN_TODAY = 4;
export const MOWN_DAYS = 3;
export const LAWN_AFTER = 3;
export const mownDays = (data: number): number => data & MOWN_DAYS;
export const mownToday = (data: number): boolean => (data & MOWN_TODAY) !== 0;

/**
 * The species, in the low nibble and the top bit of the byte.
 *
 * Nine species fit a nibble and seventeen do not. The age over the species
 * only ever reaches five, so the top bit was never written, and it is the
 * fifth bit of the species now: a byte from before reads exactly as it did,
 * a pear is 9 with nothing set and a quince is 16 with the top bit. The
 * island packs and reads the same way (`tree_pack`, `tree_species`,
 * `tree_age`), and nothing on either side takes the byte apart by hand.
 */
export const treeSpecies = (data: number): number => Math.min(TREE_DEFS.length - 1, (data & 15) | ((data >> 7) << 4));
/**
 * The age, in the three bits over the species; the fourth is the species' own.
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
export const treeVariant = (data: number): number => (data >> 4) & 7;
/** How far along the tree on this tile is. A value no stage answers to reads as young. */
export const treeAge = (data: number): TreeAge => TREE_AGES[treeVariant(data)] ?? TREE_AGES[0];
export const bushSpecies = (data: number): number => Math.min(BUSH_DEFS.length - 1, data & 15);
export const packTreeData = (species: number, variant: number): number => (species & 15) | ((variant & 7) << 4) | ((species >> 4) << 7);
