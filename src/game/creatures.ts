import { TileType, TILE_DEFS, TREE_DEFS, treeSpecies, treeVariant } from '../world/tiles';
import { BOTANIZE_TABLE, FORAGE_TABLE, rollTable } from './forage';
import type { DeedStore, Game } from './game';
import { CROP_BY_SEED, cropDef, cropReady, cropYield } from './farming';
import { MINE_COLLAPSE } from './actions';
import { bedrockAt, oreAt } from '../world/ore';
import { itemDef, type Item } from './items';
import { groundStep } from './player';
import { skillGain } from './skills';
import { fireCentre, FIRE_CAPACITY, FUEL_VALUES, isFuel } from './campfire';

/**
 * Wildermon: creatures that roam the wild, can be tamed with the taming
 * skill, and then either travel with the player or work on the deed.
 */

export type CreatureMode = 'wild' | 'active' | 'deed' | 'stored';
export type Stance = 'passive' | 'defensive' | 'aggressive';
/** What a creature gathers from the land, as a wild grazer and as a deed job. */
export type GatherKind = 'forage' | 'botanize' | 'woodcut' | 'farm' | 'mine' | 'sand' | 'clay' | 'quarry' | 'stoke' | 'fetch' | 'guard' | 'hunt';
export const GATHER_SKILL: Record<GatherKind, string> = { forage: 'foraging', botanize: 'botanizing', woodcut: 'woodcutting', farm: 'farming', mine: 'mining', sand: 'digging', clay: 'digging', quarry: 'mining', stoke: 'smelting', fetch: 'foraging', guard: 'body_strength', hunt: 'fighting' };
export const GATHER_VERB: Record<GatherKind, string> = { forage: 'foraging', botanize: 'botanizing', woodcut: 'felling trees', farm: 'working the fields', mine: 'working the seams', sand: 'digging sand', clay: 'digging clay', quarry: 'cutting stone', stoke: 'keeping the fires in', fetch: 'clearing up', guard: 'keeping watch', hunt: 'hunting' };
/** The plain form, for "it will forage" rather than "it will foraging". */
export const GATHER_DO: Record<GatherKind, string> = { forage: 'forage', botanize: 'botanize', woodcut: 'fell trees', farm: 'sow, tend and harvest the fields', mine: 'mine the ore', sand: 'dig sand and carry it home', clay: 'dig clay and carry it home', quarry: 'cut stone and carry it home', stoke: 'keep the fires and furnaces fed', fetch: 'pick up what is lying about', guard: 'keep watch over the deed', hunt: 'hunt the country round the deed and bring the carcasses home' };
const GATHER_TABLE: Record<GatherKind, Array<[string, number]>> = { forage: FORAGE_TABLE, botanize: BOTANIZE_TABLE, woodcut: [], farm: [], mine: [], sand: [], clay: [], quarry: [], stoke: [], fetch: [], guard: [], hunt: [] };
export type ButcherPart = 'meat' | 'fur' | 'leather' | 'bone' | 'gland' | 'feather';
/** Marks a creature as last hurt by the player rather than another creature. */
export const PLAYER_ATTACKER = -1;
export const STANCES: Stance[] = ['passive', 'defensive', 'aggressive'];
export const STANCE_NAMES: Record<Stance, string> = { passive: 'Passive', defensive: 'Defensive', aggressive: 'Aggressive' };
export const STANCE_HINTS: Record<Stance, string> = {
  passive: 'Never attacks.',
  defensive: 'Fights back when it or you are attacked.',
  aggressive: 'Hunts other wildermon within 5 tiles of you.',
};

export interface SpeciesDef {
  id: string;
  name: string;
  description: string;
  health: number;
  attack: number;
  /** Tiles per second. */
  speed: number;
  /** Taming skill needed to try. */
  tameLevel: number;
  /** Base chance per attempt at the minimum skill. */
  tameChance: number;
  /** Items it eats and that work as taming bait. */
  diet: string[];
  /** Short description of its bait for menus: "a berry or vegetable". */
  baitHint: string;
  /** Runs rather than fights when hurt. */
  timid: boolean;
  /** How it feeds itself in the wild and what it does as a job on the deed. */
  gathers: GatherKind | null;
  /** How far from the token a deed worker roams before it earns any skill. */
  workRange: number;
  /** Body and belly colours per variant. */
  variants: Array<[string, string]>;
  /** What a full butchering of its corpse can yield. */
  butcher: Partial<Record<ButcherPart, number>>;
  /** How it shrugs off a failed taming attempt. */
  tameFail: string;
  /** How it leaves when released. */
  leaves: string;
  /** Only settles within a few tiles of open water. */
  nearWater?: boolean;
  /** Only settles among trees. */
  nearTrees?: boolean;
  /** Only settles on a seam of ore. */
  onOre?: boolean;
  /** Only settles on sand. */
  onSand?: boolean;
  /** Only settles within a few tiles of a clay pit. */
  nearClay?: boolean;
  /** Only settles on the black ground: tar, peat and the marshes they lie in. */
  nearTar?: boolean;
  /** Only settles on bare rock with no metal in it. */
  onStone?: boolean;
  /** Hunts the player on sight rather than waiting to be struck. */
  hunter?: boolean;
  /** Grows a fleece that can be shorn, and how fast. */
  fleece?: number;
  /** Fights back rather than bolting, every time it is struck. */
  defensive?: boolean;
  /** Chance a tamed one turns on the player when it has the chance. */
  unruly?: number;
  /** Tiles of working range earned per ten levels of skill; ten by default. */
  rangePerStep?: number;
  /** Stance a newly tamed one takes; defensive unless it is a gentle sort. */
  defaultStance?: Stance;
  /**
   * Bred to pull. A draught beast trains climbing in the traces, and what it
   * knows decides how fast a vehicle goes and how steep a line it can take.
   */
  draught?: boolean;
  /** Can be ridden once it is saddled and bridled; the seat height in pixels. */
  mount?: number;
}

export const SPECIES: Record<string, SpeciesDef> = {
  rabba: {
    id: 'rabba',
    name: 'Rabba',
    description: 'A plump, long-eared grazer with a twitching nose. Skittish, but it cannot resist a berry.',
    health: 20,
    attack: 3,
    speed: 2.2,
    tameLevel: 1,
    tameChance: 0.12,
    diet: ['blueberry', 'raspberry', 'strawberry', 'lingonberry', 'potato', 'onion'],
    baitHint: 'a berry or vegetable',
    timid: true,
    gathers: 'forage',
    workRange: 8,
    variants: [
      ['#9a7048', '#d2b08a'],
      ['#8c8a86', '#c8c5bf'],
      ['#c9b58a', '#ede2c8'],
      ['#eae6de', '#ffffff'],
    ],
    butcher: { meat: 3, fur: 2, leather: 2, bone: 3, gland: 1 },
    tameFail: 'nibbles the {food}, twitches its nose, and hops off unconvinced',
    leaves: 'bounds off into the wild',
  },
  vola: {
    id: 'vola',
    name: 'Vola',
    description: 'A velvet-furred digger with a pink snout and broad shovel paws. It noses through the undergrowth for herbs and roots and would rather burrow than bite.',
    health: 16,
    attack: 2,
    speed: 1.9,
    tameLevel: 1,
    tameChance: 0.12,
    diet: ['sage', 'basil', 'thyme', 'mint', 'rosemary', 'potato', 'onion'],
    baitHint: 'a spice or vegetable',
    timid: true,
    gathers: 'botanize',
    workRange: 8,
    variants: [
      ['#4a3b33', '#7d6a5c'],
      ['#6f6c68', '#a09a92'],
      ['#7d5a3c', '#b8926a'],
      ['#2b2624', '#5b524c'],
    ],
    butcher: { meat: 2, fur: 3, leather: 2, bone: 2, gland: 1 },
    tameFail: 'snuffles the {food} out of your palm, then shuffles away and buries itself in the leaf litter',
    leaves: 'shuffles off and burrows out of sight',
  },
  bevere: {
    id: 'bevere',
    name: 'Bevere',
    description: 'A broad, flat-tailed gnawer with orange teeth and oiled fur. It never strays far from water, and it fells a tree faster than a man with a hatchet.',
    health: 26,
    attack: 3,
    speed: 1.8,
    tameLevel: 1,
    tameChance: 0.1,
    diet: ['potato', 'carrot', 'cabbage', 'onion', 'corn', 'wheat', 'acorn', 'nuts'],
    baitHint: 'a vegetable or something starchy',
    timid: true,
    gathers: 'woodcut',
    workRange: 8,
    /** It will not settle more than this far from water. */
    variants: [
      ['#6b4a2e', '#a67c4e'],
      ['#4f3a2a', '#8a6a48'],
      ['#7d5636', '#c09163'],
      ['#3b2f26', '#6f5a44'],
    ],
    butcher: { meat: 3, fur: 3, leather: 3, bone: 2, gland: 1 },
    tameFail: 'takes the {food} in both paws, eats it without hurry, and slips back into the water',
    leaves: 'slaps its tail and slides into the water',
    nearWater: true,
    defaultStance: 'passive',
  },
  crawler: {
    id: 'crawler',
    name: 'Crawler',
    description: 'A broad sand-coloured crab that goes at everything sideways. It shovels sand with its claws faster than a man with a spade, and it has never once been sorry for pinching anybody.',
    health: 24,
    attack: 5,
    speed: 1.6,
    tameLevel: 1,
    tameChance: 0.1,
    diet: ['potato', 'carrot', 'cabbage', 'onion'],
    baitHint: 'a vegetable',
    timid: false,
    gathers: 'sand',
    workRange: 8,
    variants: [
      ['#c58a52', '#e8c79a'],
      ['#a8623c', '#dba173'],
      ['#8f8a6e', '#cfc7a6'],
      ['#b5483a', '#e0937f'],
    ],
    butcher: { meat: 3, leather: 1, bone: 4, gland: 1 },
    tameFail: 'takes the {food} in one claw, waves the other at you, and backs off sideways',
    leaves: 'scuttles off sideways and buries itself in the sand',
    onSand: true,
    defensive: true,
    defaultStance: 'defensive',
    unruly: 0.12,
  },
  noot: {
    id: 'noot',
    name: 'Noot',
    description: 'A plump, upright waddler in a slate coat, with a broad bill it uses as a spade and a flat tail it uses as a stool. It spends its whole day up to the knees in a clay pit and appears to think this is the good life.',
    health: 26,
    attack: 3,
    speed: 1.5,
    tameLevel: 1,
    tameChance: 0.12,
    diet: ['carrot', 'onion', 'potato', 'mixed_grass'],
    baitHint: 'a root vegetable',
    timid: true,
    gathers: 'clay',
    workRange: 9,
    variants: [
      ['#4a5a6e', '#eceff3'],
      ['#3d4a5c', '#e2e7ee'],
      ['#5c5348', '#f0ece2'],
      ['#46605c', '#e6efec'],
    ],
    butcher: { meat: 3, leather: 2, bone: 2, gland: 1, feather: 4 },
    tameFail: 'takes the {food} in its bill, honks once through it, and waddles off',
    leaves: 'waddles back to the nearest clay pit and settles into it',
    nearClay: true,
  },
  embra: {
    id: 'embra',
    name: 'Embra',
    description: 'A soot-dark, slow-blinking creature that sleeps in the peat and tar of the marshes and wakes up wherever there is a fire. It carries wood the way other creatures carry food, and it will not eat anything raw.',
    health: 24,
    attack: 4,
    speed: 1.5,
    tameLevel: 1,
    tameChance: 0.1,
    diet: ['cooked_meat', 'baked_potato', 'roast_onion', 'roast_nuts', 'berry_compote', 'stew', 'pottage'],
    baitHint: 'something cooked',
    timid: true,
    gathers: 'stoke',
    workRange: 10,
    variants: [
      ['#3c3631', '#e08a3c'],
      ['#4a3d33', '#f0a850'],
      ['#33312e', '#d2702c'],
      ['#453a3a', '#e8c35a'],
    ],
    butcher: { meat: 2, fur: 2, leather: 2, bone: 2, gland: 2 },
    tameFail: 'sniffs at the {food}, finds it cold, and turns its back on you',
    leaves: 'settles into the warm ash and pays you no more attention',
    nearTar: true,
  },
  quarra: {
    id: 'quarra',
    name: 'Quarra',
    description: 'A low, broad creature with a jaw like a chisel and a hide the colour of the rock it sits on. It eats clay by the mouthful and spends the rest of the day taking the mountain apart a piece at a time.',
    health: 34,
    attack: 5,
    speed: 1.2,
    tameLevel: 1,
    tameChance: 0.09,
    diet: ['clay'],
    baitHint: 'a lump of clay',
    timid: false,
    gathers: 'quarry',
    workRange: 8,
    rangePerStep: 6,
    variants: [
      ['#8d8a84', '#c3bfb6'],
      ['#6f7684', '#a9b0bc'],
      ['#9a8f7e', '#cfc6b4'],
      ['#7c7269', '#b4aa9c'],
    ],
    butcher: { meat: 4, leather: 3, bone: 4, gland: 1 },
    tameFail: 'takes the {food} in one bite, considers you, and goes back to the rock',
    leaves: 'lumbers off and settles against the nearest stone face',
    onStone: true,
  },
  woola: {
    id: 'woola',
    name: 'Woola',
    description: 'A round, mild grazer under a deep fleece, which it grows back as fast as you can take it off. It has no opinion about anything and no job worth speaking of, and everyone keeps one anyway.',
    health: 26,
    attack: 2,
    speed: 1.3,
    tameLevel: 1,
    tameChance: 0.2,
    diet: ['mixed_grass', 'cabbage', 'carrot', 'wheat', 'corn'],
    baitHint: 'grass or greens',
    timid: true,
    gathers: null,
    workRange: 6,
    variants: [
      ['#efe9dc', '#d8cfbc'],
      ['#e3d6c2', '#c6b69c'],
      ['#4c4742', '#6d665e'],
      ['#f4efe6', '#cdc0ac'],
    ],
    butcher: { meat: 3, fur: 3, leather: 2, bone: 2 },
    tameFail: 'eats the {food} without appearing to notice you at all',
    leaves: 'wanders off grazing and does not look back',
    fleece: 1 / 900,
  },
  ulva: {
    id: 'ulva',
    name: 'Ulva',
    description: 'Grey, lean and long in the leg, and the first thing on this island that will come at you without being struck first. Tame one and it will do the same for everything that comes near your border.',
    health: 34,
    attack: 9,
    speed: 2.1,
    tameLevel: 30,
    tameChance: 0.06,
    diet: ['meat', 'cooked_meat'],
    baitHint: 'meat',
    timid: false,
    gathers: 'guard',
    workRange: 12,
    variants: [
      ['#6b6a66', '#cfcac0'],
      ['#4c4a47', '#b2ada4'],
      ['#7d7263', '#d9d2c4'],
      ['#5a5f66', '#bcc2c8'],
    ],
    butcher: { meat: 5, fur: 4, leather: 4, bone: 4, gland: 2 },
    tameFail: 'takes the {food} off your palm with its teeth and watches you back away',
    leaves: 'trots to the edge of the field, looks back once, and is gone',
    hunter: true,
    defensive: true,
    defaultStance: 'aggressive',
  },
  magga: {
    id: 'magga',
    name: 'Magga',
    description: 'A sharp-eyed black and white bird that lives in the treetops and cannot leave anything shiny where it lies. Tamed, it clears a settlement of everything dropped and forgotten; wild, it is the reason your things are not where you left them.',
    health: 16,
    attack: 3,
    speed: 2,
    tameLevel: 5,
    tameChance: 0.14,
    diet: ['blueberry', 'raspberry', 'strawberry', 'lingonberry', 'acorn', 'nuts'],
    baitHint: 'a berry or a handful of nuts',
    timid: true,
    gathers: 'fetch',
    workRange: 12,
    rangePerStep: 12,
    variants: [
      ['#26282e', '#f2f0ea'],
      ['#2e2a33', '#e6e3dc'],
      ['#20262c', '#dfe6ea'],
      ['#332a26', '#efe6d8'],
    ],
    butcher: { meat: 1, leather: 1, bone: 1, gland: 1, feather: 6 },
    tameFail: 'snatches the {food} and is twenty feet up a tree before you can blink',
    leaves: 'lifts off with a rattle of wings and is gone over the trees',
    nearTrees: true,
  },
  mola: {
    id: 'mola',
    name: 'Mola',
    description: 'A heavy-shouldered mole with claws like trowels and grit worked into its coat. It can smell metal through a foot of stone and would rather be underground than not.',
    health: 22,
    attack: 4,
    speed: 1.5,
    tameLevel: 1,
    tameChance: 0.1,
    diet: ['sage', 'basil', 'thyme', 'mint', 'rosemary'],
    baitHint: 'a spice',
    timid: true,
    gathers: 'mine',
    workRange: 8,
    rangePerStep: 5,
    variants: [
      ['#3f3b38', '#78706a'],
      ['#4a4038', '#8a7c6e'],
      ['#5c5450', '#9a9088'],
      ['#332e2c', '#6a625c'],
    ],
    butcher: { meat: 2, fur: 2, leather: 2, bone: 2, gland: 2 },
    tameFail: 'noses the {food} over, thinks better of you, and digs itself out of sight',
    leaves: 'digs straight down and is gone',
    onOre: true,
  },
  seavic: {
    id: 'seavic',
    name: 'Seavic',
    description: 'A quick red-brown squirrel with a tail it wears like a cloak and cheeks it stuffs with seed. It lives in the treetops and cannot leave a field alone.',
    health: 14,
    attack: 2,
    speed: 2.6,
    tameLevel: 1,
    tameChance: 0.12,
    diet: ['acorn', 'nuts'],
    baitHint: 'an acorn or a handful of nuts',
    timid: true,
    gathers: 'farm',
    workRange: 8,
    variants: [
      ['#a65a2e', '#e0b189'],
      ['#8a8f95', '#d6dade'],
      ['#3a3230', '#8c8078'],
      ['#c98f4e', '#f0dcc0'],
    ],
    butcher: { meat: 1, fur: 2, leather: 1, bone: 1, gland: 1 },
    tameFail: 'stuffs the {food} into its cheeks and is up the nearest trunk before you can blink',
    leaves: 'flicks its tail and runs up the nearest tree',
    nearTrees: true,
    defaultStance: 'passive',
  },
  roxxen: {
    id: 'roxxen',
    name: 'Roxxen',
    description: 'A great slab-shouldered ox with horns that sweep forward and a head it holds low. It will not start anything, and it will finish most things that start with it. Nothing on the island pulls a loaded wagon like a pair of them.',
    health: 80,
    attack: 11,
    speed: 1.1,
    tameLevel: 25,
    tameChance: 0.07,
    diet: ['mixed_grass', 'wheat', 'corn', 'cabbage', 'carrot'],
    baitHint: 'grass or grain',
    timid: false,
    gathers: null,
    workRange: 6,
    variants: [
      ['#7a5a3c', '#c2a077'],
      ['#4a4441', '#8f8880'],
      ['#8d4f34', '#caa484'],
      ['#b3a894', '#e4dccb'],
    ],
    butcher: { meat: 26, fur: 4, leather: 14, bone: 18, gland: 1 },
    tameFail: 'chews through the {food} without once looking up, and goes back to the grass',
    leaves: 'walks off at its own pace and does not look back',
    defensive: true,
    draught: true,
  },
  orse: {
    id: 'orse',
    name: 'Orse',
    description: 'Long in the leg and deep in the chest, with a mane that falls to one side. It will carry a rider once it is saddled and bridled, and the further it has been worked the surer its footing on a bad slope.',
    health: 50,
    attack: 7,
    speed: 3,
    tameLevel: 30,
    tameChance: 0.07,
    diet: ['mixed_grass', 'wheat', 'corn', 'carrot', 'acorn'],
    baitHint: 'grass, grain or a root',
    timid: false,
    gathers: null,
    workRange: 6,
    variants: [
      ['#6b4830', '#2e2320'],
      ['#8f8880', '#514c47'],
      ['#3a3330', '#211d1b'],
      ['#a8703c', '#e0c294'],
    ],
    butcher: { meat: 14, fur: 3, leather: 10, bone: 12, gland: 1 },
    tameFail: 'lips the {food} out of your hand, tosses its head, and moves off a few lengths',
    leaves: 'wheels away at a canter and is over the rise before you can call it',
    defensive: true,
    draught: true,
    mount: 16,
  },
  rowl: {
    id: 'rowl',
    name: 'Rowl',
    description: 'A deep-chested hunter that runs the treeline in the half-light. It hunts the moment it sees you, and tamed it will hunt for you instead: give it a settlement and it works a circuit of it, and the more it fights the wider that circuit gets.',
    health: 46,
    attack: 14,
    speed: 2.5,
    tameLevel: 35,
    tameChance: 0.05,
    diet: ['meat', 'cooked_meat'],
    baitHint: 'meat',
    timid: false,
    gathers: 'hunt',
    workRange: 12,
    rangePerStep: 12,
    variants: [
      ['#575450', '#b5aea3'],
      ['#2f2c2a', '#6f6862'],
      ['#c8c2b6', '#eee9df'],
      ['#7a5b40', '#c8ac8c'],
    ],
    butcher: { meat: 8, fur: 6, leather: 5, bone: 6, gland: 2 },
    tameFail: 'takes the {food} and keeps its shoulder to you the whole while, unconvinced',
    leaves: 'goes off at a long easy lope and is lost in the trees',
    nearTrees: true,
    hunter: true,
    defensive: true,
    unruly: 0.08,
    defaultStance: 'aggressive',
  },
};

/** Which species roam wild, by weight. */
const WILD_SPECIES: Array<[string, number]> = [
  ['rabba', 27],
  ['vola', 23],
  ['bevere', 15],
  ['seavic', 15],
  ['mola', 10],
  ['crawler', 10],
  ['noot', 10],
  ['woola', 12],
  ['magga', 10],
  ['quarra', 8],
  ['embra', 6],
  ['ulva', 6],
  ['roxxen', 9],
  ['orse', 9],
  ['rowl', 5],
];

/** How far off a hunter picks up your scent, and how far you must get to lose it. */
const HUNT_SIGHT = 7;
const HUNT_GIVE_UP = 13;
/** Fuel in a hearth above which a stoker leaves it alone: ten minutes' worth. */
const HEARTH_FULL = 600;
/** A deed worker goes looking for a meal once its belly is down to this. */
export const HUNGRY = 0.25;

/** How close to open water a water-bound species will settle. */
const WATER_RANGE = 4;

/** Whether open water lies within a few tiles of here. */
export function nearWater(game: Game, x: number, y: number, range = WATER_RANGE): boolean {
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (game.world.inBounds(x + dx, y + dy) && game.world.hasWater(x + dx, y + dy)) return true;
    }
  }
  return false;
}

/** Whether there is clay to work within a few tiles of here. */
export function nearClay(game: Game, x: number, y: number, range = WATER_RANGE): boolean {
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (game.world.inBounds(x + dx, y + dy) && game.world.getTile(x + dx, y + dy) === TileType.Clay) return true;
    }
  }
  return false;
}

/** Whether there is black burnable ground — tar, peat or the marsh they sit in — nearby. */
export function nearTar(game: Game, x: number, y: number, range = WATER_RANGE): boolean {
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const t = game.world.inBounds(x + dx, y + dy) ? game.world.getTile(x + dx, y + dy) : null;
      if (t === TileType.Tar || t === TileType.Peat || t === TileType.Marsh) return true;
    }
  }
  return false;
}

/** Whether there are trees to live in within a few tiles of here. */
export function nearTrees(game: Game, x: number, y: number, range = WATER_RANGE): boolean {
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (game.world.inBounds(x + dx, y + dy) && game.world.getTile(x + dx, y + dy) === TileType.Tree) return true;
    }
  }
  return false;
}

export const isBaitFor = (species: SpeciesDef, itemId: string): boolean => species.diet.includes(itemId);
/** What a wild one does to feed itself; felling trees puts no food in its belly. */
const INDOOR_JOBS = new Set<GatherKind>(['woodcut', 'farm', 'mine', 'sand', 'clay', 'quarry', 'stoke', 'fetch', 'guard', 'hunt']);
export const wildGather = (species: SpeciesDef): GatherKind | null => (species.gathers && INDOOR_JOBS.has(species.gathers) ? 'forage' : species.gathers);
/** The task skill a species trains, if it has a job. */
export const workSkill = (species: SpeciesDef): string | null => (species.gathers ? GATHER_SKILL[species.gathers] : null);
/** Every ten levels of its task skill let a worker range ten tiles further from the token. */
export const SKILL_STEP = 10;
export const RANGE_PER_STEP = 10;
export const rangeSteps = (skill: number): number => Math.floor(skill / SKILL_STEP);
/** A worker's task skill, or 0 for a species with no job. */
export function taskSkill(c: Creature, species: SpeciesDef): number {
  const id = workSkill(species);
  return id ? (c.skills[id] ?? 1) : 0;
}
/** How far from the token this worker may range right now. */
export function workRangeOf(c: Creature, species: SpeciesDef): number {
  return species.workRange + rangeSteps(taskSkill(c, species)) * (species.rangePerStep ?? RANGE_PER_STEP);
}
/** Fresh task skills for a species. */
const startSkills = (species: SpeciesDef): Record<string, number> => {
  const id = workSkill(species);
  const skills: Record<string, number> = id ? { [id]: 1 } : {};
  // A beast bred to pull starts knowing nothing about hills and learns in the
  // traces, which is what decides the pace of everything it is put in front of.
  if (species.draught) skills[HAUL_SKILL] = 1;
  return skills;
};

/** What a draught beast trains by pulling, and a mount by being ridden. */
export const HAUL_SKILL = 'climbing';
/** What a hunter trains, which decides how hard it hits and how far it ranges. */
export const FIGHT_SKILL = 'fighting';

export interface Creature {
  id: number;
  species: string;
  name: string;
  variant: number;
  x: number;
  y: number;
  mode: CreatureMode;
  stance: Stance;
  health: number;
  hunger: number;
  carrying: Item | null;
  /** Total experience earned from work. */
  xp: number;
  /** How much fleece has grown back, 0..1, for the species that carry one. */
  fleece: number;
  /** Task skills, on the same 1..100 scale as the player's. */
  skills: Record<string, number>;
  // Runtime state below; not saved.
  state: string;
  until: number;
  tx: number;
  ty: number;
  dirX: number;
  dirY: number;
  walkPhase: number;
  moving: boolean;
  enemy: number | null;
  attackedBy: number | null;
  attackedAt: number;
  cooldown: number;
  busyUntil: number;
  searchAt: number;
  /** When it last said it had nowhere to put a load down. */
  noRoomAt: number;
  /** Time banked up while nobody was watching, spent on the next think. */
  owed: number;
  /** When the player last called it over for an action; it drops everything and comes. */
  calledAt: number;
  /** Next time an unruly one gets a chance to turn on its keeper. */
  nipAt: number;
  /** The tile this worker walked out to work on: a tree, a seam, a field. */
  workX: number;
  workY: number;
  /** Seeds held in the cheeks, for a farm worker to sow. */
  pouch: Item | null;
  /** What the worker walked out to do: a farm job, or the hearth a stoker is feeding. */
  job: FarmJob | Hearth | null;
  /**
   * The vehicle whose traces it is in, if any. Worked out from the vehicles
   * themselves when a world is read back, so it is never saved twice.
   */
  hitchedTo: number | null;
  /** Saddled and bridled, for the sorts that can be ridden. */
  tacked: boolean;
  /** Set while the player is up on its back. */
  ridden: boolean;
}

export type FarmJob = 'sow' | 'tend' | 'harvest';
/** The three things a stoker keeps alight. */
export type Hearth = 'campfire' | 'smelter' | 'kiln';

export interface CreatureJSON {
  id: number;
  species: string;
  name: string;
  variant: number;
  x: number;
  y: number;
  mode: CreatureMode;
  stance: Stance;
  health: number;
  hunger: number;
  carrying: Item | null;
  pouch?: Item | null;
  xp?: number;
  fleece?: number;
  skills?: Record<string, number>;
  tacked?: boolean;
}

/**
 * How fast hunger drains, per second. Roughly the pace a player's own hunger
 * falls, so a wildermon goes most of an hour between meals rather than
 * needing one every few minutes.
 */
const HUNGER_RATE: Record<Exclude<CreatureMode, 'stored'>, number> = {
  wild: 0.0005,
  active: 0.00025,
  deed: 0.0004,
};

/** How long a called creature keeps making its way over. */
export const CALL_WINDOW = 12;
/** How close it comes before standing still, well inside arm's reach. */
const CALL_DISTANCE = 0.9;

export const WILD_TARGET = 32;
const RESPAWN_EVERY = 45;
/**
 * How closely creatures are followed, by tiles from the player. Anything being
 * looked at is followed whatever the distance; these are for the rest.
 */
const NEAR_RANGE = 26;
const FAR_RANGE = 70;
/** How often something out of sight thinks, in seconds. */
const FAR_STEP = 0.25;
const ASLEEP_STEP = 2;
/** The most time one think may cover, so nothing strides through a wall. */
const MAX_STEP_TIME = 0.34;
/**
 * Streaming. Wild creatures only exist in memory near whoever is playing: past
 * CULL_RANGE one is put away into the count for the stretch of country it was
 * in, and when somebody comes back within LIVE_RANGE it is let out again. What
 * is banked is a number, not a creature, so an island of any size costs the
 * same as the piece of it being walked. Both ranges sit well outside how far
 * anyone can see, so nothing is ever seen to come or go.
 */
const LIVE_RANGE = 60;
const CULL_RANGE = 85;
/** Tiles to a stretch of country, for the purposes of banking. */
const REGION = 32;
/** How often creatures are put away and let out, in seconds. */
const STREAM_EVERY = 2;
/** Most creatures let out in one pass, so a walk never stalls on it. */
const STREAM_BATCH = 6;
/** Wildlife a stretch of country holds, which is what the island adds up to. */
const PER_REGION = 0.5;
/** Seconds a wild creature spends grazing. */
const FORAGE_TIME = 2.5;
/** Seconds between chances for an unruly companion to turn on its keeper. */
const NIP_EVERY = 25;

/** A creature's level, read off its best task skill. */
export const creatureLevel = (c: Creature): number => 1 + Math.floor(Math.max(0, ...Object.values(c.skills), 0) / 5);

/** How long a deed worker takes over a task: twice what a player of the same skill would. */
export function workDuration(skill: number): number {
  return 2 * Math.max(1.2, 5 * (1 - skill / 140));
}

type MoveResult = 'arrived' | 'moving' | 'blocked';

export class Creatures {
  readonly list = new Map<number, Creature>();
  nextId = 1;
  private byTile = new Map<string, Creature[]>();
  /**
   * Wildlife that belongs to a stretch of country but is not in memory just
   * now, by region. A number apiece: what comes back is of the country rather
   * than the particular creature that walked away from it.
   */
  banked = new Map<number, number>();
  private streamAt = 0;

  /**
   * How the creatures stand: how many are being followed closely, how many are
   * out of sight, how many are left to themselves, and how many of the lot
   * actually thought on the last frame. The last number is the one that says
   * whether any of this is earning its keep.
   */
  ticked = { near: 0, far: 0, asleep: 0, thought: 0 };
  private respawnClock = 0;

  get(id: number): Creature | undefined {
    return this.list.get(id);
  }

  species(c: Creature): SpeciesDef {
    return SPECIES[c.species] ?? SPECIES.rabba;
  }

  spawn(species: string, x: number, y: number, mode: CreatureMode = 'wild', rand: () => number = Math.random): Creature {
    const c = Creatures.make(this.nextId++, species, x, y, mode, rand);
    this.list.set(c.id, c);
    return c;
  }

  private static make(id: number, species: string, x: number, y: number, mode: CreatureMode, rand: () => number): Creature {
    const def = SPECIES[species] ?? SPECIES.rabba;
    return {
      id,
      species: def.id,
      name: def.name,
      variant: Math.floor(rand() * def.variants.length),
      x,
      y,
      mode,
      stance: def.defaultStance ?? 'defensive',
      health: def.health,
      hunger: 0.6 + rand() * 0.4,
      carrying: null,
      xp: 0,
      fleece: 0.6 + rand() * 0.4,
      skills: startSkills(def),
      state: 'idle',
      until: 0,
      tx: x,
      ty: y,
      dirX: 1,
      dirY: 0,
      walkPhase: 0,
      moving: false,
      enemy: null,
      attackedBy: null,
      attackedAt: -1e9,
      cooldown: 0,
      busyUntil: 0,
      searchAt: 0,
      noRoomAt: 0,
      owed: 0,
      calledAt: -1e9,
      nipAt: 0,
      workX: -1,
      workY: -1,
      pouch: null,
      job: null,
      hitchedTo: null,
      tacked: false,
      ridden: false,
    };
  }

  remove(id: number): void {
    this.list.delete(id);
  }

  /** Creatures standing on a tile, from the index rebuilt each update. */
  atTile(x: number, y: number): Creature[] {
    return this.byTile.get(`${x},${y}`) ?? [];
  }

  /** How far this one ranges from the token at the skill it has now. */
  rangeFor(c: Creature): number {
    return workRangeOf(c, this.species(c));
  }

  /** The player's companion. */
  active(): Creature | undefined {
    for (const c of this.list.values()) if (c.mode === 'active') return c;
    return undefined;
  }

  stored(): Creature[] {
    return [...this.list.values()].filter((c) => c.mode === 'stored');
  }

  workers(): Creature[] {
    return [...this.list.values()].filter((c) => c.mode === 'deed');
  }

  wildCount(): number {
    let n = 0;
    for (const c of this.list.values()) if (c.mode === 'wild') n++;
    return n;
  }

  /** Whether a tile is somewhere a creature can walk: passable, dry, in bounds. */
  tileOk(game: Game, x: number, y: number): boolean {
    const w = game.world;
    return w.inBounds(x, y) && w.isPassable(x, y) && w.centerHeight(x, y) >= -1;
  }

  /** Drop wild creatures on grazing land away from the player and the deed. */
  spawnWild(game: Game, count: number, minDistance = 12): number {
    return this.spawnSpecies(game, null, count, minDistance);
  }

  /** As spawnWild, but for one species; pass null to roll the wild mix. */
  spawnSpecies(game: Game, species: string | null, count: number, minDistance = 12): number {
    const w = game.world;
    let placed = 0;
    for (let tries = 0; tries < count * 40 && placed < count; tries++) {
      const x = Math.floor(game.rand() * w.w);
      const y = Math.floor(game.rand() * w.h);
      if (!this.tileOk(game, x, y)) continue;
      if (w.centerHeight(x, y) < 2 || game.onDeed(x, y)) continue;
      if (Math.hypot(x + 0.5 - game.player.x, y + 0.5 - game.player.y) < minDistance) continue;
      const id = species ?? rollTable(WILD_SPECIES, game.rand());
      const def = SPECIES[id];
      // A Mola settles over metal, bare or buried, a Crawler on the sand; the rest want grazing.
      if (def?.onOre) {
        if (!bedrockAt(w, x, y).ore) continue;
      } else if (def?.onSand) {
        if (w.getTile(x, y) !== TileType.Sand) continue;
      } else if (def?.onStone) {
        // Bare rock with nothing in it: the Mola takes the seams, the Quarra the rest.
        if (w.getTile(x, y) !== TileType.Rock || bedrockAt(w, x, y).ore) continue;
      } else if (!TILE_DEFS[w.getTile(x, y)].forage) continue;
      // A Bevere lives on land, but only ever within sight of water; a Seavic needs trees.
      if (def?.nearWater && !nearWater(game, x, y)) continue;
      if (def?.nearTrees && !nearTrees(game, x, y)) continue;
      if (def?.nearClay && !nearClay(game, x, y)) continue;
      if (def?.nearTar && !nearTar(game, x, y)) continue;
      this.spawn(id, x + 0.5, y + 0.5, 'wild', game.rand);
      placed++;
    }
    return placed;
  }

  /**
   * Everything alive, once a frame — but not everything at the same rate.
   *
   * What is being watched moves every frame, because you would see it stutter.
   * What is out of sight but close enough to matter thinks a few times a
   * second. What is far away and unwatched keeps its body going — it heals, it
   * grows its fleece, it gets hungry — and thinks once in a while, which is
   * all anybody could tell from where they are standing. That is what lets a
   * map grow: the cost follows what is being looked at rather than what exists.
   */
  update(dt: number, game: Game): void {
    this.byTile.clear();
    this.respawnClock += dt;
    if (this.respawnClock >= RESPAWN_EVERY) {
      this.respawnClock = 0;
      // The island's wildlife grows in the abstract; it only takes a body when
      // somebody is near enough to meet it.
      if (this.wildCount() + this.bankedTotal() < this.islandTarget(game)) this.bankOne(game);
    }
    if (game.time - this.streamAt >= STREAM_EVERY) {
      this.streamAt = game.time;
      this.stream(game);
    }
    this.ticked = { near: 0, far: 0, asleep: 0, thought: 0 };
    const px = game.player.x;
    const py = game.player.y;
    for (const c of this.list.values()) {
      if (c.mode === 'stored') continue;
      const tier = this.tierOf(game, c, px, py);
      this.ticked[tier]++;
      let step = dt;
      let elapsed = dt;
      if (tier !== 'near') {
        // Out of sight: bank the time and think in longer, rarer steps. Until
        // its turn comes round nothing at all is done to it, which is what
        // keeps the cost of a crowded map off every frame.
        c.owed += dt;
        const every = tier === 'far' ? FAR_STEP : ASLEEP_STEP;
        if (c.owed < every) {
          // Something left to itself is not worth filing under a tile either:
          // nothing is going to look it up out there.
          if (tier === 'far') this.place(c);
          continue;
        }
        elapsed = c.owed;
        // Never hand a creature so much time that it walks through a wall.
        step = Math.min(c.owed, MAX_STEP_TIME);
        c.owed = 0;
      }
      this.ticked.thought++;
      const def = this.body(game, c, elapsed);
      // A beast in the traces, or under a rider, goes where it is taken. It
      // heals and grows its fleece like any other; it just does no thinking.
      if (c.hitchedTo !== null || c.ridden) {
        this.place(c);
        continue;
      }

      if (def.unruly && c.mode !== 'wild') this.maybeNip(game, c, def);
      if (game.time >= c.busyUntil) {
        switch (c.mode) {
          case 'wild':
            this.updateWild(c, step, game);
            break;
          case 'active':
            this.updateActive(c, step, game);
            break;
          case 'deed':
            this.updateWorker(c, step, game);
            break;
        }
      }
      if (c.moving) c.walkPhase += step * 12;
      if (tier !== 'asleep') this.place(c);
    }
  }

  /**
   * Lay a whole island's wildlife on the books at once. Nothing is stood up
   * here: the first streaming pass gives bodies to whatever is near enough to
   * be met, which is how a map ten times the size costs the same to start.
   */
  stockIsland(game: Game): void {
    const want = this.islandTarget(game) - this.wildCount() - this.bankedTotal();
    for (let i = 0; i < want; i++) this.bankOne(game);
  }

  /** Which stretch of country a point belongs to. */
  private region(x: number, y: number): number {
    return Math.floor(y / REGION) * 4096 + Math.floor(x / REGION);
  }

  /** How much wildlife is banked across the whole island. */
  bankedTotal(): number {
    let n = 0;
    for (const v of this.banked.values()) n += v;
    return n;
  }

  /** How much wildlife an island of this size should hold in all. */
  private islandTarget(game: Game): number {
    const regions = Math.ceil(game.world.w / REGION) * Math.ceil(game.world.h / REGION);
    return Math.max(WILD_TARGET, Math.round(regions * PER_REGION));
  }

  /** Put one more head of wildlife on the books, somewhere out there. */
  private bankOne(game: Game): void {
    const w = game.world;
    for (let tries = 0; tries < 20; tries++) {
      const x = Math.floor(game.rand() * w.w);
      const y = Math.floor(game.rand() * w.h);
      if (!this.tileOk(game, x, y) || w.centerHeight(x, y) < 2 || game.onDeed(x, y)) continue;
      const r = this.region(x, y);
      this.banked.set(r, (this.banked.get(r) ?? 0) + 1);
      return;
    }
  }

  /**
   * Put away what has been left behind and let out what has been come upon.
   * This is the whole of streaming: the island keeps its wildlife as numbers,
   * and only the stretch of it being walked costs anything.
   */
  private stream(game: Game): void {
    const px = game.player.x;
    const py = game.player.y;
    // Away and unwatched: put it back on the books.
    for (const c of [...this.list.values()]) {
      if (c.mode !== 'wild') continue;
      if (c.enemy !== null || c.attackedBy !== null) continue;
      const d = Math.max(Math.abs(c.x - px), Math.abs(c.y - py));
      if (d <= CULL_RANGE || game.vision.isWatched(c.x, c.y)) continue;
      const r = this.region(c.x, c.y);
      this.banked.set(r, (this.banked.get(r) ?? 0) + 1);
      this.list.delete(c.id);
    }
    // Come upon: let out what belongs to the country around you, a few at a time.
    let out = 0;
    const reach = Math.ceil(LIVE_RANGE / REGION) + 1;
    const rx = Math.floor(px / REGION);
    const ry = Math.floor(py / REGION);
    for (let gy = ry - reach; gy <= ry + reach && out < STREAM_BATCH; gy++) {
      for (let gx = rx - reach; gx <= rx + reach && out < STREAM_BATCH; gx++) {
        if (gx < 0 || gy < 0) continue;
        const r = gy * 4096 + gx;
        let owed = this.banked.get(r) ?? 0;
        while (owed > 0 && out < STREAM_BATCH) {
          if (!this.releaseInto(game, gx, gy)) break;
          owed--;
          out++;
        }
        if (owed > 0) this.banked.set(r, owed);
        else this.banked.delete(r);
      }
    }
  }

  /** Try to stand a creature up somewhere in one stretch of country. */
  private releaseInto(game: Game, gx: number, gy: number): boolean {
    const w = game.world;
    const px = game.player.x;
    const py = game.player.y;
    for (let tries = 0; tries < 24; tries++) {
      const x = gx * REGION + Math.floor(game.rand() * REGION);
      const y = gy * REGION + Math.floor(game.rand() * REGION);
      if (!w.inBounds(x, y) || !this.tileOk(game, x, y)) continue;
      if (w.centerHeight(x, y) < 2 || game.onDeed(x, y)) continue;
      // Never where it could be seen appearing, and never so far off that it
      // would be put away again on the next pass.
      const d = Math.max(Math.abs(x + 0.5 - px), Math.abs(y + 0.5 - py));
      if (d < 30 || d > LIVE_RANGE) continue;
      const id = rollTable(WILD_SPECIES, game.rand());
      const def = SPECIES[id];
      if (def?.onOre) {
        if (!bedrockAt(w, x, y).ore) continue;
      } else if (def?.onSand) {
        if (w.getTile(x, y) !== TileType.Sand) continue;
      }
      this.spawn(id, x + 0.5, y + 0.5, 'wild', game.rand);
      return true;
    }
    return false;
  }

  /**
   * The part of a creature that goes on whether it is thinking or not: wounds
   * closing, fleece growing, a cooldown running out. It is handed all the time
   * banked since its last turn, so a creature left alone for a minute comes
   * back as rested as one that was watched the whole while.
   */
  private body(game: Game, c: Creature, elapsed: number): SpeciesDef {
    const def = this.species(c);
    c.cooldown = Math.max(0, c.cooldown - elapsed);
    c.moving = false;
    if (c.health < def.health && game.time - c.attackedAt > 6) c.health = Math.min(def.health, c.health + elapsed * (c.mode === 'wild' ? 0.25 : 0.6));
    if (def.fleece && c.fleece < 1) c.fleece = Math.min(1, c.fleece + elapsed * def.fleece);
    return def;
  }

  /** How closely a creature is being followed, and so how often it thinks. */
  private tierOf(game: Game, c: Creature, px: number, py: number): 'near' | 'far' | 'asleep' {
    const d = Math.max(Math.abs(c.x - px), Math.abs(c.y - py));
    if (d <= NEAR_RANGE) return 'near';
    // Outside the box that anything can see into, there is no need to ask.
    const b = game.vision.bounds;
    const maybe = !game.settings.fog || (!!b && c.x >= b.x0 && c.x <= b.x1 + 1 && c.y >= b.y0 && c.y <= b.y1 + 1);
    if (maybe && game.vision.isWatched(c.x, c.y)) return 'near';
    // Your own creatures are never left entirely to themselves: a deed worker
    // out of sight is still meant to be working.
    if (c.mode !== 'wild') return 'far';
    return d <= FAR_RANGE ? 'far' : 'asleep';
  }

  /** File a creature under the tile it is standing on, for quick lookups. */
  private place(c: Creature): void {
    const key = `${Math.floor(c.x)},${Math.floor(c.y)}`;
    const arr = this.byTile.get(key);
    if (arr) arr.push(c);
    else this.byTile.set(key, [c]);
  }

  /**
   * Some creatures never quite stop being wild. Now and then, with its keeper
   * in reach, one of those gets its chance and takes it.
   */
  private maybeNip(game: Game, c: Creature, def: SpeciesDef): void {
    if (game.time < c.nipAt) return;
    c.nipAt = game.time + NIP_EVERY;
    const p = game.player;
    if (Math.hypot(p.x - c.x, p.y - c.y) > 2 || game.rand() >= (def.unruly ?? 0)) return;
    p.attackedBy = c.id;
    p.attackedAt = game.time;
    game.hurtPlayer(def.attack * 0.012, `${c.name} rounds on you and gets a claw in`);
  }

  private stepToward(game: Game, c: Creature, tx: number, ty: number, dt: number, speedMul = 1): MoveResult {
    const dx = tx - c.x;
    const dy = ty - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.12) return 'arrived';
    const pace = c.mode === 'deed' ? 1 + Math.max(1, ...Object.values(c.skills)) / 500 : 1;
    const step = Math.min(this.species(c).speed * speedMul * pace * dt, dist);
    const vx = dx / dist;
    const vy = dy / dist;
    const nx = c.x + vx * step;
    const ny = c.y + vy * step;
    let moved = false;
    if (this.canMove(game, c.x, c.y, nx, ny)) {
      c.x = nx;
      c.y = ny;
      moved = true;
    } else if (Math.abs(nx - c.x) > 1e-6 && this.canMove(game, c.x, c.y, nx, c.y)) {
      c.x = nx;
      moved = true;
    } else if (Math.abs(ny - c.y) > 1e-6 && this.canMove(game, c.x, c.y, c.x, ny)) {
      c.y = ny;
      moved = true;
    }
    if (!moved) return 'blocked';
    c.dirX = vx;
    c.dirY = vy;
    c.moving = true;
    return 'moving';
  }

  private canMove(game: Game, fx: number, fy: number, tx: number, ty: number): boolean {
    const tX = Math.floor(tx);
    const tY = Math.floor(ty);
    if (!this.tileOk(game, tX, tY)) return false;
    const fX = Math.floor(fx);
    const fY = Math.floor(fy);
    if (fX !== tX || fY !== tY) {
      if (!groundStep(game.world, fX, fY, tX, tY)) return false;
      if (game.buildings.blocksAt(0, fX, fY, tX, tY)) return false;
    }
    return true;
  }

  private wanderTarget(game: Game, c: Creature, radius: number, aroundX = c.x, aroundY = c.y): void {
    for (let i = 0; i < 8; i++) {
      const x = aroundX + (game.rand() * 2 - 1) * radius;
      const y = aroundY + (game.rand() * 2 - 1) * radius;
      if (this.tileOk(game, Math.floor(x), Math.floor(y))) {
        c.tx = x;
        c.ty = y;
        c.state = 'wander';
        return;
      }
    }
    c.state = 'idle';
    c.until = game.time + 2;
  }

  /**
   * What a field wants next, or null. A farm worker only ever works ground
   * that has already been tilled; it never rakes a field of its own.
   */
  farmJobAt(game: Game, c: Creature, x: number, y: number): FarmJob | null {
    if (game.world.getTile(x, y) !== TileType.Field) return null;
    const crop = game.cropAt(x, y);
    if (!crop) return this.seedFor(game, c) ? 'sow' : null;
    if (cropReady(crop)) return 'harvest';
    return crop.tendedNow ? null : 'tend';
  }

  /**
   * A seed to put in the ground: one out of its own cheeks first, and failing
   * that one from any store on the deed — the settlement crate, a bin, a chest,
   * whichever has seed in it. `store` is null when the seed is its own.
   */
  private seedFor(game: Game, c: Creature): { seed: Item; store: DeedStore | null } | null {
    if (c.pouch && CROP_BY_SEED.has(c.pouch.id) && c.pouch.count > 0) return { seed: c.pouch, store: null };
    for (const store of game.deedStores()) {
      const seed = store.items.find((it: Item) => CROP_BY_SEED.has(it.id) && it.count > 0);
      if (seed) return { seed, store };
    }
    return null;
  }

  /** Whether another worker is already on its way to this tile, or working it. */
  private claimed(x: number, y: number, self?: Creature): boolean {
    for (const o of this.list.values()) {
      if (o === self || o.mode !== 'deed') continue;
      if (o.workX === x && o.workY === y && (o.state === 'toForage' || o.state === 'forage')) return true;
    }
    return false;
  }

  /** Whether a tile can be foraged, botanized, felled, farmed or mined right now. */
  private gatherable(game: Game, x: number, y: number, kind: GatherKind, c?: Creature): boolean {
    if (kind === 'mine') {
      // One seam to a miner, and only metal its skill can work.
      const ore = oreAt(game.world, x, y);
      if (!ore || (c && (c.skills[GATHER_SKILL.mine] ?? 1) < ore.level)) return false;
      return game.world.rockHeight(x, y) > 1 && this.tileOk(game, x, y) && !this.claimed(x, y, c);
    }
    if (kind === 'sand' || kind === 'clay') {
      // Soft ground left on a corner of the right sort of tile, and one digger to it.
      if (game.world.getTile(x, y) !== (kind === 'sand' ? TileType.Sand : TileType.Clay)) return false;
      return this.sandCorner(game, x, y) !== null && this.tileOk(game, x, y) && !this.claimed(x, y, c);
    }
    // Stoking and guarding are not tile work; they never send a worker walking to one.
    if (kind === 'stoke' || kind === 'guard') return false;
    if (kind === 'quarry') {
      // Bare stone with no metal in it, and one cutter to a face.
      const rock = bedrockAt(game.world, x, y);
      if (game.world.getTile(x, y) !== TileType.Rock || rock.ore) return false;
      return game.world.rockHeight(x, y) > 1 && this.tileOk(game, x, y) && !this.claimed(x, y, c);
    }
    if (kind === 'fetch') {
      // Anything lying on the deed that is not already somebody's errand.
      if (!game.onDeed(x, y) || !game.groundAt(x, y).length) return false;
      return this.tileOk(game, x, y) && !this.claimed(x, y, c);
    }
    if (kind === 'farm') return !!c && this.farmJobAt(game, c, x, y) !== null;
    if (kind === 'woodcut') return game.world.getTile(x, y) === TileType.Tree && !!this.beside(game, x, y);
    const def = TILE_DEFS[game.world.getTile(x, y)];
    return !!(kind === 'forage' ? def.forage : def.botanize) && !game.isForaged(x, y, kind);
  }

  /**
   * The corner of a tile there is still a load to be had from: above the water,
   * with soil over the rock. The highest goes first, so the pit a digger leaves
   * comes out level rather than ragged.
   */
  private sandCorner(game: Game, x: number, y: number): [number, number] | null {
    const w = game.world;
    let best: [number, number] | null = null;
    let bestH = -Infinity;
    for (const [cx, cy] of [
      [x, y],
      [x + 1, y],
      [x, y + 1],
      [x + 1, y + 1],
    ]) {
      const h = w.getHeight(cx, cy);
      if (h <= 0 || w.getDirt(cx, cy) <= 0) continue;
      if (h > bestH) {
        bestH = h;
        best = [cx, cy];
      }
    }
    return best;
  }

  /**
   * A tree blocks movement, so a feller works from a tile beside it: the one
   * nearest whoever is walking there, since it cannot path around the trunk.
   */
  private beside(game: Game, x: number, y: number, fromX = x, fromY = y): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.tileOk(game, nx, ny)) continue;
      const d = Math.hypot(nx + 0.5 - fromX, ny + 0.5 - fromY);
      if (d < bestD) {
        bestD = d;
        best = { x: nx, y: ny };
      }
    }
    return best;
  }

/**
   * Nearest tile within `range` of a point that can be gathered from right now.
   * Searched in rings outward, stopping one ring past the first hit, so a
   * skilled worker allowed to range a hundred tiles still costs a handful of
   * checks while there is anything to pick near the token.
   */
  private findForageTile(game: Game, cx: number, cy: number, range: number, kind: GatherKind, who?: Creature): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const visit = (x: number, y: number): void => {
      // A tree is never walkable, so a feller judges the tile beside it instead.
      if (kind !== 'woodcut' && !this.tileOk(game, x, y)) return;
      if (!this.gatherable(game, x, y, kind, who)) return;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + game.rand() * 1.5;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    };
    let lastRing = Infinity;
    for (let r = 0; r <= range && r <= lastRing; r++) {
      if (r === 0) visit(x0, y0);
      else {
        for (let x = x0 - r; x <= x0 + r; x++) {
          visit(x, y0 - r);
          visit(x, y0 + r);
        }
        for (let y = y0 - r + 1; y <= y0 + r - 1; y++) {
          visit(x0 - r, y);
          visit(x0 + r, y);
        }
      }
      // One more ring after the first hit, so the pick is not a hard square shell.
      if (best && lastRing === Infinity) lastRing = r + 1;
    }
    return best;
  }

  private beginForage(game: Game, c: Creature, kind: GatherKind): void {
    c.state = 'forage';
    c.until = game.time + (c.mode === 'deed' ? workDuration(c.skills[GATHER_SKILL[kind]] ?? 1) : FORAGE_TIME);
  }

  /**
   * Finish gathering: the tile goes on cooldown as if a player had picked it
   * over. Workers roll like a player of their skill and learn from it at half
   * a player's pace.
   */
  private finishForage(game: Game, c: Creature, kind: GatherKind): Item | null {
    const x = Math.floor(c.x);
    const y = Math.floor(c.y);
    if (kind === 'woodcut') return this.finishFelling(game, c);
    if (kind === 'farm') return this.finishFarming(game, c, x, y);
    if (kind === 'mine') return this.finishMining(game, c);
    if (kind === 'sand' || kind === 'clay') return this.finishDigging(game, c, kind === 'sand' ? 'sand' : 'clay');
    if (kind === 'stoke' || kind === 'guard') return null;
    if (kind === 'quarry') return this.finishQuarry(game, c);
    if (kind === 'fetch') return this.finishFetch(game, c);
    game.markForaged(x, y, kind);
    const table = GATHER_TABLE[kind];
    if (c.mode !== 'deed') {
      if (game.rand() < 0.25) return null;
      const id = rollTable(table, game.rand());
      return { uid: game.inventory.nextUid++, id, ql: 5 + game.rand() * 30, dmg: 0, count: 1 };
    }
    const skillId = GATHER_SKILL[kind];
    const skill = c.skills[skillId] ?? 1;
    this.gainSkill(game, c, skillId, 0.225);
    const chance = Math.min(0.98, Math.max(0.3, 0.6 + (skill / 100) * 0.38 - 5 / 150));
    if (game.rand() < 0.2 || game.rand() >= chance) return null;
    const id = rollTable(table, game.rand());
    const ql = Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1));
    return { uid: game.inventory.nextUid++, id, ql, dmg: 0, count: 1 };
  }

  /** Fell the tree a worker walked to, and hand it the log it carries home. */
  private finishFelling(game: Game, c: Creature): Item | null {
    const tx = c.workX;
    const ty = c.workY;
    if (game.world.getTile(tx, ty) !== TileType.Tree) return null;
    const data = game.world.getData(tx, ty);
    const def = TREE_DEFS[treeSpecies(data)];
    const logs = def.logs + (treeVariant(data) === 2 ? 1 : 0);
    game.world.setTile(tx, ty, TileType.Grass);
    const skill = c.skills[GATHER_SKILL.woodcut] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.woodcut, 0.225);
    const ql = Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1));
    // The rest of the tree is left at the stump; it can only carry one at a time.
    if (logs > 1) {
      game.dropOnGround(tx, ty, { uid: game.inventory.nextUid++, id: 'log', ql, dmg: 0, count: logs - 1, extra: def.name });
    }
    return { uid: game.inventory.nextUid++, id: 'log', ql, dmg: 0, count: 1, extra: def.name };
  }

  /** Work the seam a miner walked to, and hand it the ore it carries home. */
  private finishMining(game: Game, c: Creature): Item | null {
    const ore = oreAt(game.world, c.workX, c.workY);
    if (!ore) return null;
    const skill = c.skills[GATHER_SKILL.mine] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.mine, 0.225);
    // Its own skill decides the metal, though no seam gives up more than it holds.
    const ql = Math.min(ore.maxQl, Math.max(1, Math.min(100, skill * (0.6 + game.rand() * 0.8) + 1)));
    // As with a miner's pick, the face only comes down by luck.
    if (game.rand() < MINE_COLLAPSE && game.world.rockHeight(c.workX, c.workY) > 1) {
      game.world.setHeight(c.workX, c.workY, game.world.getHeight(c.workX, c.workY) - 1);
      game.world.setDirt(c.workX, c.workY, 0);
      game.exposeRock(c.workX, c.workY);
    }
    return { uid: game.inventory.nextUid++, id: ore.yields, ql, dmg: 0, count: 1 };
  }

  /** Dig out the ground a worker walked to, and hand it the load it carries home. */
  private finishDigging(game: Game, c: Creature, yields: 'sand' | 'clay'): Item | null {
    const corner = this.sandCorner(game, c.workX, c.workY);
    if (!corner) return null;
    const [cx, cy] = corner;
    const w = game.world;
    const skill = c.skills.digging ?? 1;
    this.gainSkill(game, c, 'digging', 0.225);
    // Claws take the ground down the same way a shovel does.
    w.setHeight(cx, cy, w.getHeight(cx, cy) - 1);
    const left = w.getDirt(cx, cy) - 1;
    w.setDirt(cx, cy, left);
    if (left <= 0) game.exposeRock(cx, cy);
    game.events.emit('world', c.workX, c.workY);
    const ql = Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1));
    return { uid: game.inventory.nextUid++, id: yields, ql, dmg: 0, count: 1 };
  }

  /** Cut stone from the face a quarrier walked to. */
  private finishQuarry(game: Game, c: Creature): Item | null {
    const w = game.world;
    const rock = bedrockAt(w, c.workX, c.workY);
    if (w.getTile(c.workX, c.workY) !== TileType.Rock || rock.ore) return null;
    const skill = c.skills[GATHER_SKILL.quarry] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.quarry, 0.225);
    const ql = Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1));
    // Cutting the face back is a matter of luck, as it is for a miner.
    if (game.rand() < MINE_COLLAPSE && w.rockHeight(c.workX, c.workY) > 1) {
      w.setHeight(c.workX, c.workY, w.getHeight(c.workX, c.workY) - 1);
      w.setDirt(c.workX, c.workY, 0);
      game.exposeRock(c.workX, c.workY);
    }
    return { uid: game.inventory.nextUid++, id: rock.yields, ql, dmg: 0, count: 1 };
  }

  /** Pick up one thing lying on the tile a fetcher walked to. */
  private finishFetch(game: Game, c: Creature): Item | null {
    const pile = game.groundAt(c.workX, c.workY);
    if (!pile.length) return null;
    this.gainSkill(game, c, GATHER_SKILL.fetch, 0.12);
    const [item] = game.takeFromGround(c.workX, c.workY, pile[0].uid);
    return item ?? null;
  }

  /** Sow, tend or harvest the field the worker is standing on. */
  private finishFarming(game: Game, c: Creature, x: number, y: number): Item | null {
    const job = this.farmJobAt(game, c, x, y);
    if (!job) return null;
    const skill = c.skills[GATHER_SKILL.farm] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.farm, 0.225);
    const ql = Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1));
    if (job === 'sow') {
      const found = this.seedFor(game, c);
      if (!found) return null;
      const { seed, store } = found;
      seed.count -= 1;
      if (!store && seed.count <= 0) c.pouch = null;
      if (store) {
        if (seed.count <= 0) store.items.splice(store.items.indexOf(seed), 1);
        store.changed();
      }
      const def = CROP_BY_SEED.get(seed.id);
      if (def) game.plantCrop(x, y, def.id, seed.ql);
      return null;
    }
    const crop = game.cropAt(x, y);
    if (!crop) return null;
    if (job === 'tend') {
      crop.tendedNow = true;
      crop.tended += 1;
      crop.ql = (crop.ql * crop.tended + ql) / (crop.tended + 1);
      game.events.emit('world', x, y);
      return null;
    }
    // Harvest: the crop is carried to the crate, the seed goes in its cheeks.
    const def = cropDef(crop.id);
    const y2 = cropYield(crop.tended);
    const grade = Math.max(1, Math.min(100, (crop.ql + ql) / 2));
    game.removeCrop(x, y);
    const seeds: Item = { uid: game.inventory.nextUid++, id: def.seed, ql: grade, dmg: 0, count: y2.seeds };
    if (c.pouch && c.pouch.id === seeds.id) c.pouch.count += seeds.count;
    else if (!c.pouch) c.pouch = seeds;
    else game.dropOnGround(x, y, seeds);
    return { uid: game.inventory.nextUid++, id: def.produce, ql: grade, dmg: 0, count: y2.produce };
  }

  /**
   * A fire, furnace or kiln on the deed that is running low, nearest first.
   * Anything with less than a few minutes in it counts as wanting wood.
   */
  private coldHearth(game: Game, c: Creature, range: number): { x: number; y: number; fuel: number; lit: boolean; kind: Hearth; id: number } | null {
    const deed = game.deed;
    if (!deed) return null;
    let best: { x: number; y: number; fuel: number; lit: boolean; kind: Hearth; id: number } | null = null;
    let bestD = Infinity;
    const consider = (x: number, y: number, fuel: number, lit: boolean, kind: Hearth, id: number): void => {
      if (fuel >= HEARTH_FULL) return;
      if (Math.max(Math.abs(x - deed.x), Math.abs(y - deed.y)) > range) return;
      const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
      if (d < bestD) {
        bestD = d;
        best = { x, y, fuel, lit, kind, id };
      }
    };
    for (const f of game.campfires.values()) consider(...(fireCentre(f).map(Math.floor) as [number, number]), f.fuel, f.lit, 'campfire', f.id);
    for (const sm of game.smelters.values()) consider(sm.x, sm.y, sm.fuel, sm.lit, 'smelter', sm.id);
    for (const k of game.kilns.values()) consider(k.x, k.y, k.fuel, k.lit, 'kiln', k.id);
    return best;
  }

  /**
   * Fetch wood from the crate for whatever is burning low. Returns true when
   * the stoker has taken the job in hand this tick.
   */
  private stokeStep(game: Game, c: Creature, dt: number): boolean {
    const def = this.species(c);
    const hearth = this.coldHearth(game, c, workRangeOf(c, def));
    if (!hearth) return false;
    // Nothing to carry: go to whichever store has wood in it and take a piece.
    const store = game.deedStores().find((st) => st.items.some((it: Item) => isFuel(it.id)));
    const fuel = store?.items.find((it: Item) => isFuel(it.id));
    if (!store || !fuel) return false;
    const [cx, cy] = store.centre;
    if (Math.hypot(cx - c.x, cy - c.y) > 1.3) {
      if (this.stepToward(game, c, cx, cy, dt) === 'blocked') {
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return true;
    }
    fuel.count -= 1;
    if (fuel.count <= 0) store.items.splice(store.items.indexOf(fuel), 1);
    store.changed();
    c.carrying = { uid: game.inventory.nextUid++, id: fuel.id, ql: fuel.ql, dmg: 0, count: 1 };
    c.workX = hearth.x;
    c.workY = hearth.y;
    c.job = hearth.kind;
    return true;
  }

  /** Carry the wood to the hearth it was fetched for, feed it and light it. */
  private feedFire(game: Game, c: Creature, dt: number): void {
    const carrying = c.carrying;
    if (!carrying) return;
    const tx = c.workX + 0.5;
    const ty = c.workY + 0.5;
    if (Math.hypot(tx - c.x, ty - c.y) > 1.6) {
      if (this.stepToward(game, c, tx, ty, dt) === 'blocked') {
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return;
    }
    const per = FUEL_VALUES[carrying.id] ?? 0;
    const light = (fuel: number, lit: boolean, set: (f: number, l: boolean) => void, what: string): void => {
      const now = Math.min(FIRE_CAPACITY, fuel + per);
      set(now, lit || now > 0);
      this.gainSkill(game, c, GATHER_SKILL.stoke, 0.18);
      if (!lit) game.logMsg(`${c.name} gets the ${what} going again.`, 'event');
    };
    if (c.job === 'campfire') {
      const f = [...game.campfires.values()].find((k) => Math.floor(fireCentre(k)[0]) === c.workX && Math.floor(fireCentre(k)[1]) === c.workY);
      if (f) light(f.fuel, f.lit, (fuel, lit) => { f.fuel = fuel; f.lit = lit; }, 'campfire');
    } else if (c.job === 'smelter') {
      const sm = [...game.smelters.values()].find((k) => k.x === c.workX && k.y === c.workY);
      if (sm) light(sm.fuel, sm.lit, (fuel, lit) => { sm.fuel = fuel; sm.lit = lit; }, 'smelter');
    } else if (c.job === 'kiln') {
      const k = [...game.kilns.values()].find((n) => n.x === c.workX && n.y === c.workY);
      if (k) light(k.fuel, k.lit, (fuel, lit) => { k.fuel = fuel; k.lit = lit; }, 'kiln');
    }
    game.events.emit('smelter');
    game.events.emit('world', c.workX, c.workY);
    c.carrying = null;
    c.job = null;
    c.state = 'idle';
    c.until = game.time + 1;
  }

  /**
   * What a worker does about company. Aggressive ones go for anything wild that
   * crosses the border; defensive ones only answer what has already struck at
   * them or at their keeper; passive ones carry on working whatever happens.
   * Returns true when the creature is dealing with it rather than working.
   */
  private defendDeed(game: Game, c: Creature, dt: number, deed: { x: number; y: number; radius: number }): boolean {
    if (c.stance === 'passive') {
      c.enemy = null;
      return false;
    }
    const range = deed.radius + 1;
    const inside = (o: Creature): boolean => Math.max(Math.abs(o.x - deed.x), Math.abs(o.y - deed.y)) <= range;
    if (c.enemy !== null && c.enemy !== PLAYER_ATTACKER) {
      const e = this.list.get(c.enemy);
      if (!e || e.mode !== 'wild' || !inside(e)) c.enemy = null;
      else {
        if (Math.hypot(e.x - c.x, e.y - c.y) <= 1) {
          if (c.cooldown <= 0) {
            this.attack(game, c, e);
            c.cooldown = 1.2;
          }
        } else if (this.stepToward(game, c, e.x, e.y, dt, 1.3) === 'blocked') c.enemy = null;
        return true;
      }
    }
    if (game.time < c.searchAt) return false;
    c.searchAt = game.time + 1.5;
    const recent = (at: number): boolean => game.time - at < 8;
    let best: Creature | null = null;
    let bestD = Infinity;
    for (const o of this.list.values()) {
      if (o.id === c.id || o.mode !== 'wild' || !inside(o)) continue;
      // A defensive one waits to be given a reason; an aggressive one does not.
      if (c.stance === 'defensive') {
        const struck = (recent(c.attackedAt) && c.attackedBy === o.id) || (recent(game.player.attackedAt) && game.player.attackedBy === o.id);
        if (!struck) continue;
      }
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return false;
    c.enemy = best.id;
    game.logMsg(`${c.name} breaks off and goes for the ${this.species(best).name.toLowerCase()} on the deed.`, 'event');
    return true;
  }

  /** A guard walks its border and goes for anything wild that crosses it. */
  /**
   * A hunter's circuit of the settlement.
   *
   * It runs down anything wild inside its range, and its range is what it has
   * learned: a young one works the border, an old one quarters half a valley.
   * What it pulls down it goes back for, and carries home like any other load,
   * because a carcass left in the grass is meat nobody eats.
   */
  private packHunt(game: Game, c: Creature, dt: number, deed: { x: number; y: number; radius: number }): boolean {
    const def = this.species(c);
    const range = workRangeOf(c, def);
    if (c.enemy !== null) {
      const e = this.list.get(c.enemy);
      const gone = !e || e.mode !== 'wild' || Math.max(Math.abs(e.x - deed.x), Math.abs(e.y - deed.y)) > range + 4;
      if (gone) c.enemy = null;
      else {
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        if (d <= 1.1) {
          if (c.cooldown <= 0) {
            this.attack(game, c, e);
            c.cooldown = 1.1;
          }
        } else if (this.stepToward(game, c, e.x, e.y, dt, 1.4) === 'blocked') c.enemy = null;
        return true;
      }
    }
    // Nothing in its teeth: go back for a carcass, this kill or an older one
    // left lying about. The piles on the ground are few, so the whole lot is
    // cheaper to look through than a box of tiles round the hunter.
    if (c.workX < 0 && game.time >= c.searchAt) {
      let bestD = Infinity;
      for (const [key, pile] of game.ground) {
        if (!pile.some((it) => it.id === 'corpse')) continue;
        const [gx, gy] = key.split(',').map(Number);
        if (Math.max(Math.abs(gx - deed.x), Math.abs(gy - deed.y)) > range) continue;
        const d = Math.hypot(gx + 0.5 - c.x, gy + 0.5 - c.y);
        if (d < bestD) {
          bestD = d;
          c.workX = gx;
          c.workY = gy;
        }
      }
    }
    // Back for the kill, wherever it went down.
    if (c.workX >= 0) {
      const pile = game.groundAt(c.workX, c.workY);
      const carcass = pile.find((it) => it.id === 'corpse');
      if (!carcass) c.workX = -1;
      else if (Math.hypot(c.workX + 0.5 - c.x, c.workY + 0.5 - c.y) <= 1.2) {
        const [taken] = game.takeFromGround(c.workX, c.workY, carcass.uid);
        c.workX = -1;
        if (taken) {
          c.carrying = taken;
          c.state = 'idle';
          c.until = game.time + 0.5;
          return true;
        }
      } else if (this.stepToward(game, c, c.workX + 0.5, c.workY + 0.5, dt) === 'blocked') c.workX = -1;
      else return true;
    }
    if (game.time >= c.searchAt) {
      c.searchAt = game.time + 1.2;
      let best: Creature | null = null;
      let bestD = Infinity;
      for (const o of this.list.values()) {
        if (o.id === c.id || o.mode !== 'wild') continue;
        if (Math.max(Math.abs(o.x - deed.x), Math.abs(o.y - deed.y)) > range) continue;
        const d = Math.hypot(o.x - c.x, o.y - c.y);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        c.enemy = best.id;
        this.gainSkill(game, c, FIGHT_SKILL, 0.08);
        return true;
      }
    }
    // Nothing worth chasing: walk the country and look again.
    if (c.state === 'wander') {
      if (this.stepToward(game, c, c.tx, c.ty, dt, 0.9) !== 'moving') {
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return true;
    }
    if (game.time >= c.until) {
      this.wanderTarget(game, c, Math.min(range, 8), deed.x + 0.5, deed.y + 0.5);
      c.state = 'wander';
      c.until = game.time + 6;
    }
    return true;
  }

  private guardStep(game: Game, c: Creature, dt: number, deed: { x: number; y: number; radius: number }): void {
    const range = deed.radius + 1;
    if (c.enemy !== null) {
      const e = this.list.get(c.enemy);
      const gone = !e || e.mode !== 'wild' || Math.max(Math.abs(e.x - deed.x), Math.abs(e.y - deed.y)) > range + 3;
      if (gone) c.enemy = null;
      else {
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        if (d <= 1) {
          if (c.cooldown <= 0) {
            this.attack(game, c, e);
            c.cooldown = 1.2;
          }
        } else if (this.stepToward(game, c, e.x, e.y, dt, 1.3) === 'blocked') c.enemy = null;
        return;
      }
    }
    if (game.time >= c.searchAt) {
      c.searchAt = game.time + 1.5;
      let best: Creature | null = null;
      let bestD = Infinity;
      for (const o of this.list.values()) {
        if (o.id === c.id || o.mode !== 'wild') continue;
        if (Math.max(Math.abs(o.x - deed.x), Math.abs(o.y - deed.y)) > range) continue;
        const d = Math.hypot(o.x - c.x, o.y - c.y);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        c.enemy = best.id;
        this.gainSkill(game, c, GATHER_SKILL.guard, 0.1);
        return;
      }
    }
    // Nothing about: walk the border.
    if (c.state === 'wander') {
      if (this.stepToward(game, c, c.tx, c.ty, dt, 0.8) !== 'moving') {
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return;
    }
    if (game.time < c.until) return;
    this.wanderTarget(game, c, Math.max(2, deed.radius), deed.x + 0.5, deed.y + 0.5);
    c.until = game.time + 4;
  }

  /** Same diminishing curve as the player's skills. */
  gainSkill(game: Game, c: Creature, id: string, base: number): number {
    const v = c.skills[id] ?? 1;
    // A beast learns on the same curve a player does, and crawls the same last
    // stretch of it.
    const gain = skillGain(v, base, 0.6 + 0.8 * game.rand());
    const before = creatureLevel(c);
    const beforeSteps = rangeSteps(v);
    c.skills[id] = Math.min(100, v + gain);
    c.xp += gain;
    if (creatureLevel(c) > before) game.logMsg(`${c.name} reaches level ${creatureLevel(c)}.`, 'skill');
    const def = this.species(c);
    if (c.mode === 'deed' && id === workSkill(def) && rangeSteps(c.skills[id]) > beforeSteps) {
      game.logMsg(`${c.name} knows the land better and will now work up to ${workRangeOf(c, def)} tiles from the token.`, 'skill');
    }
    return gain;
  }

  private updateWild(c: Creature, dt: number, game: Game): void {
    c.hunger = Math.max(0, c.hunger - dt * HUNGER_RATE.wild);
    const def = this.species(c);
    const kind = wildGather(def);
    if (c.state === 'flee') {
      if (game.time >= c.until) c.state = 'idle';
      else if (this.stepToward(game, c, c.tx, c.ty, dt, 1.6) !== 'moving') c.state = 'idle';
      return;
    }
    if (c.state === 'forage') {
      if (game.time >= c.until) {
        const food = kind ? this.finishForage(game, c, kind) : null;
        if (food && isBaitFor(def, food.id)) c.hunger = Math.min(1, c.hunger + 0.5);
        c.state = 'idle';
        c.until = game.time + 2 + game.rand() * 3;
      }
      return;
    }
    if (c.state === 'toForage') {
      const r = this.stepToward(game, c, c.tx, c.ty, dt);
      if (r === 'arrived') {
        if (kind && this.gatherable(game, Math.floor(c.x), Math.floor(c.y), kind, c)) this.beginForage(game, c, kind);
        else c.state = 'idle';
      } else if (r === 'blocked') c.state = 'idle';
      return;
    }
    if (def.hunter && this.huntStep(game, c, def, dt)) return;
    if (kind && c.hunger < 0.5 && game.time >= c.searchAt) {
      c.searchAt = game.time + 4;
      const t = this.findForageTile(game, c.x, c.y, 3, kind, c);
      if (t) {
        c.tx = t.x + 0.5;
        c.ty = t.y + 0.5;
        c.state = 'toForage';
        return;
      }
    }
    if (c.state === 'wander') {
      if (this.stepToward(game, c, c.tx, c.ty, dt, 0.7) !== 'moving') {
        c.state = 'idle';
        c.until = game.time + 1 + game.rand() * 5;
      }
      return;
    }
    if (game.time >= c.until) this.wanderTarget(game, c, 4);
  }

  /**
   * A hunter closing on the player. It gives up when you get far enough away
   * or when it has been badly enough hurt to think better of it.
   */
  private huntStep(game: Game, c: Creature, def: SpeciesDef, dt: number): boolean {
    const p = game.player;
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    const hunting = c.enemy === PLAYER_ATTACKER;
    if (hunting && (d > HUNT_GIVE_UP || c.health < def.health * 0.3)) {
      c.enemy = null;
      return false;
    }
    if (!hunting) {
      if (d > HUNT_SIGHT || game.time < c.searchAt) return false;
      c.searchAt = game.time + 2;
      if (!this.tileOk(game, Math.floor(p.x), Math.floor(p.y))) return false;
      c.enemy = PLAYER_ATTACKER;
      game.logMsg(`A ${def.name.toLowerCase()} has your scent.`, 'error');
    }
    if (d <= 1.1) {
      if (c.cooldown <= 0) {
        c.cooldown = 1.4;
        p.attackedBy = c.id;
        p.attackedAt = game.time;
        game.hurtPlayer(def.attack * 0.012, `The ${def.name.toLowerCase()} is on you`);
      }
      return true;
    }
    if (this.stepToward(game, c, p.x, p.y, dt, 1.15) === 'blocked') c.enemy = null;
    return true;
  }

  private updateActive(c: Creature, dt: number, game: Game): void {
    c.hunger = Math.max(0, c.hunger - dt * HUNGER_RATE.active);
    const p = game.player;
    const distP = Math.hypot(p.x - c.x, p.y - c.y);
    if (distP > 18) {
      // Lost sight of you: catches up.
      c.x = p.x;
      c.y = p.y;
      c.enemy = null;
      return;
    }
    if (this.comeWhenCalled(c, dt, game)) return;
    if (c.stance === 'passive') c.enemy = null;
    else if (c.enemy === null) {
      if (c.stance === 'aggressive') {
        let best: Creature | null = null;
        let bestD = Infinity;
        for (const o of this.list.values()) {
          if (o.id === c.id || o.mode !== 'wild') continue;
          const d = Math.hypot(o.x - p.x, o.y - p.y);
          if (d <= 5 && d < bestD) {
            bestD = d;
            best = o;
          }
        }
        if (best) c.enemy = best.id;
      } else {
        const recent = (at: number): boolean => game.time - at < 8;
        const threat = recent(c.attackedAt) ? c.attackedBy : recent(p.attackedAt) ? p.attackedBy : null;
        if (threat !== null && threat !== c.id && this.list.has(threat)) c.enemy = threat;
      }
    }
    if (c.enemy !== null) {
      const e = c.enemy === PLAYER_ATTACKER ? undefined : this.list.get(c.enemy);
      if (!e || e.mode === 'stored' || Math.hypot(e.x - p.x, e.y - p.y) > 9) {
        c.enemy = null;
      } else {
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        if (d <= 0.9) {
          if (c.cooldown <= 0) {
            this.attack(game, c, e);
            c.cooldown = 1.2;
          }
        } else if (this.stepToward(game, c, e.x, e.y, dt, 1.3) === 'blocked') {
          c.enemy = null;
        }
        return;
      }
    }
    if (distP > 2.2) {
      this.stepToward(game, c, p.x, p.y, dt, 1.25);
      return;
    }
    if (c.state === 'wander') {
      if (this.stepToward(game, c, c.tx, c.ty, dt, 0.6) !== 'moving') {
        c.state = 'idle';
        c.until = game.time + 2 + game.rand() * 4;
      }
    } else if (game.time >= c.until) this.wanderTarget(game, c, 1.5, p.x, p.y);
  }

  private updateWorker(c: Creature, dt: number, game: Game): void {
    c.hunger = Math.max(0, c.hunger - dt * HUNGER_RATE.deed);
    const deed = game.deed;
    if (!deed) {
      c.mode = 'wild';
      return;
    }
    if (this.comeWhenCalled(c, dt, game)) return;
    const def = this.species(c);
    const kind = def.gathers;
    // Standing orders come before any job: an intruder is everyone's business.
    if (this.defendDeed(game, c, dt, deed)) return;
    if (kind === 'guard') {
      this.guardStep(game, c, dt, deed);
      return;
    }
    if (kind === 'stoke' && !c.carrying && c.state !== 'forage') {
      if (this.stokeStep(game, c, dt)) return;
    }
    if (kind === 'hunt' && !c.carrying && c.state !== 'forage') {
      if (this.packHunt(game, c, dt, deed)) return;
    }
    if (c.state === 'forage') {
      if (game.time >= c.until) {
        c.carrying = kind ? this.finishForage(game, c, kind) : null;
        c.state = 'idle';
        c.until = game.time + 0.5;
      }
      return;
    }
    if (c.carrying && kind === 'stoke') {
      this.feedFire(game, c, dt);
      return;
    }
    if (c.carrying) {
      if (c.hunger < HUNGRY && isBaitFor(def, c.carrying.id)) {
        c.hunger = Math.min(1, c.hunger + 0.5);
        c.carrying = null;
        return;
      }
      const store = this.storeFor(game, c, c.carrying);
      if (!store) {
        // Everything on the deed is full. A worker will not tip a load out on
        // the ground: it holds on to it and waits for room.
        if (game.time - c.noRoomAt > 60) {
          c.noRoomAt = game.time;
          game.logMsg(`${c.name} is holding ${itemDef(c.carrying.id).name.toLowerCase()} with nowhere on the deed to put it. Empty something, or build more storage.`, 'error');
        }
        this.wanderTarget(game, c, 2, deed.x + 0.5, deed.y + 0.5);
        c.state = 'wander';
        c.until = game.time + 5;
        return;
      }
      const [dx, dy] = store.centre;
      if (Math.hypot(dx - c.x, dy - c.y) <= 1.3) {
        if (!store.add(c.carrying)) return;
        c.carrying = null;
        c.state = 'idle';
        c.until = game.time + 1;
      } else if (this.stepToward(game, c, dx, dy, dt) === 'blocked') {
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return;
    }
    if (c.hunger < HUNGRY) {
      const larder = this.foodCrate(game, c, def);
      if (larder) {
        const [lx, ly] = larder.centre;
        if (Math.hypot(lx - c.x, ly - c.y) <= 1.3) {
          const idx = larder.items.findIndex((it) => isBaitFor(def, it.id));
          if (idx >= 0) {
            const it = larder.items[idx];
            it.count -= 1;
            if (it.count <= 0) larder.items.splice(idx, 1);
            larder.changed();
            c.hunger = Math.min(1, c.hunger + 0.5);
            game.logMsg(`${c.name} helps itself to ${itemDef(it.id).name.toLowerCase()} from the ${larder.name.toLowerCase()}.`, 'event');
          }
        } else this.stepToward(game, c, lx, ly, dt);
        return;
      }
    }
    if (c.state === 'toForage') {
      const r = this.stepToward(game, c, c.tx, c.ty, dt);
      if (r === 'arrived') {
        const wx = kind === 'woodcut' ? c.workX : Math.floor(c.x);
        const wy = kind === 'woodcut' ? c.workY : Math.floor(c.y);
        if (kind && this.gatherable(game, wx, wy, kind, c)) this.beginForage(game, c, kind);
        else c.state = 'idle';
      } else if (r === 'blocked') {
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return;
    }
    if (c.state === 'wander') {
      if (this.stepToward(game, c, c.tx, c.ty, dt, 0.7) !== 'moving') {
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return;
    }
    if (game.time < c.until) return;
    if (kind) {
      const t = this.findForageTile(game, deed.x + 0.5, deed.y + 0.5, workRangeOf(c, def), kind, c);
      if (t) {
        // A tree cannot be stood on, so a feller walks to the tile beside it.
        const spot = kind === 'woodcut' ? this.beside(game, t.x, t.y, c.x, c.y) : t;
        if (kind === 'mine') c.job = null;
        if (spot) {
          c.job = kind === 'farm' ? this.farmJobAt(game, c, t.x, t.y) : null;
          c.workX = t.x;
          c.workY = t.y;
          c.tx = spot.x + 0.5;
          c.ty = spot.y + 0.5;
          c.state = 'toForage';
          return;
        }
      }
    }
    // Nothing to do right now: potter about near the token.
    this.wanderTarget(game, c, 3, deed.x + 0.5, deed.y + 0.5);
    c.until = game.time + 4;
  }

  /**
   * Where a load should go: the settlement's own crate while it has room, and
   * failing that the nearest other store that will take it. Null means every
   * place on the deed is full, which is a reason to stop rather than to tip the
   * load out on the ground.
   */
  private storeFor(game: Game, c: Creature, item: Item): DeedStore | null {
    const stores = game.deedStores().filter((s) => s.room(item));
    if (!stores.length) return null;
    const own = stores.find((s) => s.deed);
    if (own) return own;
    let best = stores[0];
    let bestD = Infinity;
    for (const s of stores) {
      const d = Math.hypot(s.centre[0] - c.x, s.centre[1] - c.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** The nearest store on the deed holding something this creature will eat. */
  private foodCrate(game: Game, c: Creature, def: SpeciesDef): DeedStore | null {
    let best: DeedStore | null = null;
    let bestD = Infinity;
    for (const store of game.deedStores()) {
      if (!store.items.some((it: Item) => isBaitFor(def, it.id))) continue;
      const d = Math.hypot(store.centre[0] - c.x, store.centre[1] - c.y);
      if (d < bestD) {
        bestD = d;
        best = store;
      }
    }
    return best;
  }

  /** Ask a tamed creature to come over, so an action on it can start where the player stands. */
  callToPlayer(game: Game, c: Creature): void {
    if (c.mode === 'wild' || c.mode === 'stored') return;
    c.calledAt = game.time;
    c.enemy = null;
    c.state = 'idle';
    c.until = game.time;
  }

  /** True while a called creature is making its way to the player, or waiting there. */
  private comeWhenCalled(c: Creature, dt: number, game: Game): boolean {
    if (game.time - c.calledAt >= CALL_WINDOW) return false;
    const p = game.player;
    c.enemy = null;
    if (Math.hypot(p.x - c.x, p.y - c.y) > CALL_DISTANCE && this.stepToward(game, c, p.x, p.y, dt, 1.35) === 'moving') return true;
    // Arrived, or cannot get closer: stand still so the action can run.
    c.state = 'idle';
    c.until = game.time + 1;
    return true;
  }

  attack(game: Game, a: Creature, t: Creature): void {
    // A hunter hits harder the more hunting it has done: half again at mastery.
    const trained = 1 + (a.skills[FIGHT_SKILL] ?? 0) / 200;
    const dmg = this.species(a).attack * trained * (0.7 + game.rand() * 0.6);
    this.hurt(game, t, dmg, a);
    if (a.skills[FIGHT_SKILL] !== undefined) this.gainSkill(game, a, FIGHT_SKILL, 0.05);
  }

  /** Deal damage from a creature or the player; timid wild creatures bolt, and a kill leaves a corpse. */
  hurt(game: Game, t: Creature, dmg: number, by: Creature | 'player'): void {
    const from = by === 'player' ? game.player : by;
    t.health -= dmg;
    t.attackedBy = by === 'player' ? PLAYER_ATTACKER : by.id;
    t.attackedAt = game.time;
    if (t.mode === 'wild' && this.species(t).timid) {
      const dx = t.x - from.x;
      const dy = t.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      t.tx = t.x + (dx / len) * 5;
      t.ty = t.y + (dy / len) * 5;
      t.state = 'flee';
      t.until = game.time + 3;
    }
    if (t.mode === 'active' && by !== 'player' && game.time - (t.busyUntil ?? 0) > 0) game.logMsg(`${t.name} is hurt by a ${this.species(by).name.toLowerCase()}!`, 'error');
    if (t.health <= 0) this.kill(game, t, by);
  }

  /** Remove a creature and leave its corpse lying on the tile, ready for butchering. */
  kill(game: Game, t: Creature, killer: Creature | 'player' | null): void {
    // A beast that dies in the traces leaves an empty yoke behind it, and one
    // that dies under a rider puts them on the ground.
    if (t.hitchedTo !== null) game.unhitch(t);
    if (t.ridden) game.dismount();
    // A hunter marks where its kill went down and comes back for it.
    if (killer && killer !== 'player' && this.species(killer).gathers === 'hunt' && !killer.carrying) {
      killer.workX = Math.floor(t.x);
      killer.workY = Math.floor(t.y);
      this.gainSkill(game, killer, FIGHT_SKILL, 0.4);
    }
    this.list.delete(t.id);
    for (const o of this.list.values()) if (o.enemy === t.id) o.enemy = null;
    const def = this.species(t);
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    game.dropOnGround(x, y, { uid: game.inventory.nextUid++, id: 'corpse', ql: 15 + game.rand() * 35, dmg: 0, count: 1, extra: def.name });
    if (killer === 'player') game.logMsg(`You kill the wild ${def.name.toLowerCase()}. Its corpse lies where it fell.`, 'event');
    else if (t.mode === 'active' || t.mode === 'deed') game.logMsg(`${t.name} has died.`, 'error');
    else if (killer && killer.mode !== 'wild') game.logMsg(`${killer.name} killed a wild ${def.name.toLowerCase()}.`, 'event');
  }

  describe(c: Creature): string {
    const job = this.species(c).gathers;
    const verb = job ? GATHER_VERB[job] : 'busy';
    if (c.ridden) return 'under the saddle';
    if (c.hitchedTo !== null) return 'in the traces';
    switch (c.mode) {
      case 'active':
        return `your companion · ${STANCE_NAMES[c.stance].toLowerCase()}`;
      case 'deed':
        if (c.carrying) return `deed worker · carrying ${itemDef(c.carrying.id).name.toLowerCase()}`;
        if (c.state === 'forage') return `deed worker · ${job === 'farm' && c.job ? `${c.job}ing a field` : verb}`;
        return 'deed worker';
      case 'stored':
        return 'kept at the token';
      default:
        return c.state === 'forage' ? `wild · ${verb}` : c.state === 'flee' ? 'wild · fleeing' : 'wild';
    }
  }

  toJSON(): { nextId: number; list: CreatureJSON[]; banked?: Array<[number, number]> } {
    return {
      nextId: this.nextId,
      banked: [...this.banked.entries()],
      list: [...this.list.values()].map((c) => ({
        id: c.id,
        species: c.species,
        name: c.name,
        variant: c.variant,
        x: c.x,
        y: c.y,
        mode: c.mode,
        stance: c.stance,
        health: c.health,
        hunger: c.hunger,
        carrying: c.carrying,
        pouch: c.pouch,
        xp: c.xp,
        fleece: c.fleece,
        skills: c.skills,
        tacked: c.tacked,
      })),
    };
  }

  static fromJSON(data: { nextId: number; list: CreatureJSON[]; banked?: Array<[number, number]> } | undefined): Creatures {
    const cs = new Creatures();
    if (!data) return cs;
    cs.nextId = data.nextId ?? 1;
    for (const [r, n] of data.banked ?? []) cs.banked.set(r, n);
    for (const j of data.list ?? []) {
      const c = Creatures.make(j.id, j.species, j.x, j.y, j.mode, Math.random);
      Object.assign(c, { name: j.name, variant: j.variant, stance: j.stance, health: j.health, hunger: j.hunger, carrying: j.carrying ?? null, pouch: j.pouch ?? null, xp: j.xp ?? 0, fleece: j.fleece ?? 1, tacked: !!j.tacked, skills: { ...startSkills(SPECIES[j.species] ?? SPECIES.rabba), ...(j.skills ?? {}) } });
      cs.list.set(c.id, c);
      if (c.id >= cs.nextId) cs.nextId = c.id + 1;
    }
    return cs;
  }
}
