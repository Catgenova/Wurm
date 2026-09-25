import { TileType, TILE_DEFS, TREE_DEFS, treeAge, treeSpecies, packTreeData, TREE_AGES } from '../world/tiles';
import { isSeam } from '../world/tiles';
import { mapFromBeast } from './treasure';
import { BOTANIZE_TABLE, FORAGE_TABLE, rollTable } from './forage';
import type { DeedStore, Game } from './game';
import { DAY_SECONDS } from './game';
import { CROP_BY_SEED, cropDef, cropReady, cropYield } from './farming';
import { MINE_COLLAPSE, MINE_DEPTH } from './actions';
import { bedrockAt, oreAt } from '../world/ore';
import { DIGGABLE, findChance, relicsWithin } from './archaeology';
import { fishable, fishHere, waterDepth } from './fishing';
import { itemDef, type Item } from './items';
import { groundStep, standsOn } from './player';
import { skillGain } from './skills';
import { keyX, keyY, tileKey } from './tileindex';
import { fireCentre, FIRE_CAPACITY, FUEL_VALUES, isFuel } from './campfire';
import { BUCKET_LITRES, furnitureCentre } from './furniture';
import type { WoundKind } from './wounds';
import { auraMul, breedTraits, rollTraits, traitList, traitMul, traitTier, TRAIT_SLOTS, type TraitChannel } from './traits';
import { ACTION_FLOOR, ACTION_PACE, WORKER_WEIGHT } from './pace';
import { world } from './pace';
import { emptyCrate, shutIn } from './creaturecrate';

/**
 * Wildermon: creatures that roam the wild, can be tamed with the taming
 * skill, and then either travel with the player or work on the deed.
 */

export type CreatureMode = 'wild' | 'active' | 'deed' | 'stored';
/** Every wildermon is one or the other, and it takes one of each to breed. */
export type Sex = 'male' | 'female';
export const SEX_NAMES: Record<Sex, string> = { male: 'male', female: 'female' };
export const SEX_MARK: Record<Sex, string> = { male: '\u2642', female: '\u2640' };
export type Stance = 'passive' | 'defensive' | 'aggressive';
/** What a creature gathers from the land, as a wild grazer and as a deed job. */
export type GatherKind =
  | 'forage'
  | 'botanize'
  | 'woodcut'
  | 'farm'
  | 'mine'
  | 'sand'
  | 'clay'
  | 'quarry'
  | 'stoke'
  | 'fetch'
  | 'guard'
  | 'hunt'
  | 'peat'
  | 'reed'
  | 'water'
  | 'prospect'
  | 'plant'
  | 'hod'
  | 'mend'
  | 'compost'
  | 'seek'
  | 'fish'
  // A snedda prunes what would otherwise die; a grubba digs out stumps.
  | 'prune'
  | 'stump'
  // A plucka picks what a bearing tree has on it and carries it home.
  | 'fruit';
/**
 * How far a wild thing will drift from where it stands, and how long it stands.
 *
 * It used to pick a spot up to four tiles off, walk it, stand for one to six
 * seconds, and go again — fifty-odd tiles of wandering a minute, for ever.
 * That was written for a game where clicking a creature reached it instantly.
 * On an island you ask, and then your feet have to carry you there, and a
 * thing that has moved five tiles by the time you arrive cannot be tamed at
 * all. Reported exactly so: "its almost impossible to tame them as theyre
 * always too far away".
 *
 * A step and a half, and half a minute of standing about, is about a tenth of
 * the ground and still plainly alive — a beast grazing rather than a beast on
 * its way somewhere. It also happens to be most of the cure for the jumping:
 * a poll two seconds apart nearly always finds a thing that has not moved.
 */
export const WILD_REACH = 1.5;
/*
 * Eight to thirty seconds between turns, which is nineteen on average.
 *
 * These were doubled the night the island went slow, as the cheapest thing on
 * it that could give: a wild thing grazes and stands about, and standing about
 * for twice as long costs the clock half as much. It bought the round back.
 *
 * It was the wrong lever, though, and it is put back here. What was actually
 * broken was that a round had no end: `creature_sweep` took a hundred and
 * twenty at a time and the clock called it once per player per island, so a
 * backlog multiplied instead of draining, and `order by id` meant the same
 * near creatures were looked at every round while the overdue ones waited.
 * Both are fixed -- a round now spends `settle_budget()` on wildlife and no
 * more, and takes the longest-waiting first -- and with them fixed a live
 * round measures 72 ms against a budget of 250.
 *
 * So the rest goes back to the figure the game was designed around, and the
 * budget rather than the rest interval is what keeps a round short. If the
 * demand ever does outrun the budget the queue simply lags: every wild thing
 * moves a little less often, which is what doubling this did by hand, only
 * without a hand.
 */
export const WILD_REST = 8;
export const WILD_REST_SPREAD = 22;

/**
 * How far from its home ground a wild thing will get.
 *
 * Nothing kept a wild animal anywhere. A wander target was drawn a tile and a
 * half from wherever it was standing, from wherever it had got to last time,
 * for ever — a random walk with nothing pulling on it. So an island's
 * wildlife had no geography at all: a thing that spawned in the tundra was as
 * likely to be found on the south beach an hour later, and the places you
 * learned to go for a particular animal were places only until you next
 * looked.
 *
 * Everything wild has a home now, and a step that would take it past this far
 * from home is drawn towards home instead. Twenty-eight tiles is a few
 * screens: big enough that an animal is not pacing a cage, small enough that
 * a valley keeps what lives in it.
 */
export const WILD_RANGE = 28;

/**
 * And how near another of its own kind a grazer has to be to throw in with
 * it.
 *
 * Herds are made at the moment a thing arrives rather than kept as a list: a
 * grazer spawning within this of another of its species takes *that one's*
 * home for its own, so the two of them wander the same patch of country and
 * are found together ever after. Chains of that are what makes a herd, and it
 * costs one look round at birth and nothing at all thereafter.
 *
 * Hunters do not do this. Two hunters sharing a range is a pair of animals
 * competing for the same dinner, and what makes a hunter frightening is
 * meeting it where it lives rather than meeting six of them.
 */
export const HERD_REACH = 14;
/**
 * How many looks at standable ground a rolled species gets before the roll is
 * given up on.
 *
 * What stands up is rolled against `WILD_SPECIES` and the ground says where.
 * Throwing a roll away because *this* tile is wrong for it makes a species as
 * common as its weight times the share of the island that suits it: a mola
 * wants metal under it, metal is a seventh of the ground, and one mola in a
 * hundred and forty is a mola nobody meets. Reported exactly so — "I have yet
 * to see a single mola spawn". So a place is looked for instead, and eight
 * looks put every species back within a fraction of its weight.
 *
 * Looks at ground a creature could stand on, not throws: on an island that is
 * mostly sea, eight throws into the water are no goes at all.
 */
export const SITE_LOOKS = 8;

/** Handed back for a tile nothing is standing on, so the common answer is free. */
const NOBODY: readonly Creature[] = [];
/**
 * How many tiles the creature index may keep arrays for before the lot go.
 * A tick fills as many tiles as there are creatures; this is slack enough
 * that a settled island never pays for the clear.
 */
const TILE_SLACK = 4096;

export const GATHER_SKILL: Record<GatherKind, string> = { forage: 'foraging', botanize: 'botanizing', woodcut: 'woodcutting', farm: 'farming', mine: 'mining', sand: 'digging', clay: 'digging', quarry: 'mining', stoke: 'smelting', fetch: 'foraging', guard: 'body_strength', hunt: 'fighting', peat: 'digging', reed: 'foraging', water: 'carrying', prospect: 'prospecting', plant: 'forestry', hod: 'masonry', mend: 'repair', compost: 'farming', seek: 'archaeology', fish: 'fishing', prune: 'forestry', stump: 'digging', fruit: 'forestry' };
export const GATHER_VERB: Record<GatherKind, string> = { forage: 'foraging', botanize: 'botanizing', woodcut: 'felling trees', farm: 'working the fields', mine: 'working the seams', sand: 'digging sand', clay: 'digging clay', quarry: 'cutting stone', stoke: 'keeping the fires in', fetch: 'clearing up', guard: 'keeping watch', hunt: 'hunting', peat: 'cutting peat', reed: 'cutting reeds', water: 'carrying water', prospect: 'reading the ground', plant: 'planting', hod: 'carrying the hod', mend: 'mending', compost: 'clearing up', seek: 'nosing about', fish: 'fishing', prune: 'pruning the wood', stump: 'digging out stumps', fruit: 'picking fruit' };
/** The plain form, for "it will forage" rather than "it will foraging". */
export const GATHER_DO: Record<GatherKind, string> = { forage: 'forage', botanize: 'botanize', woodcut: 'fell trees', farm: 'sow, tend and harvest the fields', mine: 'mine the ore', sand: 'dig sand and carry it home', clay: 'dig clay and carry it home', quarry: 'cut stone and carry it home', stoke: 'keep the fires and furnaces fed', fetch: 'pick up what is lying about', guard: 'keep watch over the deed', hunt: 'hunt the country round the deed and bring the carcasses home', peat: 'cut peat and tar and carry them home', reed: 'cut reeds and carry them home', water: 'carry water from the shore or the well to your barrels', prospect: 'read the ground for metal and mark what it finds', plant: 'plant sprouts where the trees have been cut', hod: 'carry brick and timber to your planned walls and fit it', mend: 'mend the damaged gear in your stores', compost: 'clear away what is rotting and turn it into compost', seek: 'smell out buried relics and mark where to dig', fish: 'fish the water round the deed and carry the catch home', prune: 'prune what would otherwise die', stump: 'dig out stumps', fruit: 'pick what the fruit trees have on them and carry it home' };
const GATHER_TABLE: Record<GatherKind, Array<[string, number]>> = { forage: FORAGE_TABLE, botanize: BOTANIZE_TABLE, woodcut: [], farm: [], mine: [], sand: [], clay: [], quarry: [], stoke: [], fetch: [], guard: [], hunt: [], peat: [], reed: [], water: [], prospect: [], plant: [], hod: [], mend: [], compost: [], seek: [], fish: [], prune: [], stump: [], fruit: [] };
export type ButcherPart = 'meat' | 'fur' | 'leather' | 'bone' | 'gland' | 'feather' | 'tusk' | 'sinew' | 'scale' | 'hoard';
/** Marks a creature as last hurt by the player rather than another creature. */
export const PLAYER_ATTACKER = -1;
export const STANCES: Stance[] = ['passive', 'defensive', 'aggressive'];
export const STANCE_NAMES: Record<Stance, string> = { passive: 'Passive', defensive: 'Defensive', aggressive: 'Aggressive' };
/**
 * A companion at heel, and what it does about company.
 *
 * An aggressive one goes for anything wild within `COMPANION_SIGHT` of you;
 * either sort drops a fight that has got `COMPANION_LEASH` from you; it
 * strikes from `COMPANION_REACH` every `COMPANION_BLOW` seconds and runs at
 * `COMPANION_PACE` times its walk on the way; and a blow at it or at you is
 * remembered for `BLOW_MEMORY` seconds, which is also how long a defensive
 * worker on a deed remembers one.
 *
 * These were literals in `updateActive`, which was fine while the browser
 * owned the wildlife. It does not any more: the island parked a companion
 * at its keeper's feet and had no rule for what it does about company, so
 * reported as "aggressive and defensive wildermon companions don't
 * attack". They are crossed now, and the island's `companion_settle` walks
 * and strikes off the same six numbers.
 */
export const COMPANION_SIGHT = 5;
export const COMPANION_LEASH = 9;
export const COMPANION_REACH = 0.9;
export const COMPANION_BLOW = 1.2;
export const COMPANION_PACE = 1.3;
export const BLOW_MEMORY = 8;
/**
 * How many swings you turn on something with when it bites you: enough to
 * see a fight out, and the first refusal — dead, gone, out of reach — ends
 * the run, as it ends any run of goes. The next bite starts it again.
 */
export const FIGHT_BACK_GOES = 100;
export const STANCE_HINTS: Record<Stance, string> = {
  passive: 'Never attacks.',
  defensive: 'Fights back when it or you are attacked.',
  aggressive: `Hunts other wildermon within ${COMPANION_SIGHT} tiles of you.`,
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
  /**
   * The trades it may be set to instead, `gathers` among them, for a species
   * with more than one. A bevere fells, prunes or digs out stumps; you say
   * which when you set it to work, and `Creature.trade` remembers.
   */
  trades?: GatherKind[];
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
  /** How far it sees for you, in tiles; seven unless it is a watcher. */
  sight?: number;
  /** Lights the ground around it whatever the hour, like a carried fire. */
  glow?: number;
  /** What its climbing is worth as slope under a rider: one unless it is a goat. */
  pitch?: number;
  /** Crosses deep water with a rider on its back. */
  swims?: boolean;
  /** Its share of a team's pull; a quarter unless it was bred for the traces. */
  pull?: number;
  /** Things it carries on its own back, for the ones that take panniers. */
  pannier?: number;
  /** What shearing takes off it; wool unless it says otherwise. */
  shearYield?: string;
  /** Can be milked into an empty bucket. */
  milk?: boolean;
  /** Keeps a hive of its own going, so long as one stands on the deed. */
  hives?: boolean;
  /** Only ever found out of doors after dark. */
  nocturnal?: boolean;
  /**
   * The kind of wound it leaves. A hoof bruises, a claw opens, a sting goes
   * deep and narrow, and something that carries its own fire burns. Most
   * things bite.
   */
  wound?: WoundKind;
  /**
   * Not a wildermon at all. A monster cannot be tamed, trapped, bred, brushed
   * or kept; it comes at you on sight from a long way off, it hits far harder
   * than anything else that walks, and it is worth killing for what is on it.
   */
  monster?: boolean;
  /** How far off it notices you, in tiles; a monster sees a long way. */
  notice?: number;
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
    wound: 'cut',
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
    wound: 'pierce',
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
    wound: 'burn',
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
    wound: 'crush',
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
    wound: 'cut',
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
    wound: 'cut',
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
    wound: 'cut',
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
    wound: 'crush',
    name: 'Roxxen',
    description: 'A great slab-shouldered ox with horns that sweep forward and a head it holds low. It will not start anything, and it will finish most things that start with it. Nothing but a Shaggan pulls a loaded wagon like a pair of them.',
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
    pull: 0.3,
  },
  orse: {
    id: 'orse',
    wound: 'crush',
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
    wound: 'cut',
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
  // ---- The working sorts. ----
  bogga: {
    id: 'bogga',
    name: 'Bogga',
    description: 'A flat-tailed wallower, black to the shoulder and never far from the black ground. It works peat and tar out of the bog with its forepaws and thinks nothing of the smell.',
    health: 30,
    attack: 4,
    speed: 1.4,
    tameLevel: 10,
    tameChance: 0.11,
    diet: ['mixed_grass', 'cabbage', 'carrot', 'potato'],
    baitHint: 'grass or a root',
    timid: true,
    gathers: 'peat',
    workRange: 9,
    variants: [
      ['#3a332c', '#7a6c58'],
      ['#2b2a28', '#645f56'],
      ['#4a3b2c', '#8b7458'],
      ['#221f1d', '#4f4a44'],
    ],
    butcher: { meat: 4, fur: 3, leather: 3, bone: 3, gland: 1 },
    tameFail: 'takes the {food} in both paws, eats it where it stands, and wallows off',
    leaves: 'slides back into the peat and is gone',
    nearTar: true,
  },
  sedra: {
    id: 'sedra',
    name: 'Sedra',
    description: 'A long-necked wader that stands in the shallows all day and cuts reeds with a bill like a pair of shears. Papyrus starts with this bird whether you keep one or not.',
    health: 22,
    attack: 3,
    speed: 2,
    tameLevel: 8,
    tameChance: 0.12,
    diet: ['reed', 'wheat', 'corn', 'nuts'],
    baitHint: 'reeds or grain',
    timid: true,
    gathers: 'reed',
    workRange: 10,
    variants: [
      ['#9aa88c', '#e4e0cc'],
      ['#7d8c9a', '#d6dce2'],
      ['#b0a276', '#eee7cd'],
      ['#6f7a6a', '#c8ccb8'],
    ],
    butcher: { meat: 3, feather: 4, leather: 1, bone: 2 },
    tameFail: 'lifts one foot, looks at the {food}, and goes back to the reeds',
    leaves: 'runs three steps on the water and is away',
    nearWater: true,
  },
  holla: {
    id: 'holla',
    name: 'Holla',
    description: 'A barrel of a creature with a throat pouch that holds more water than you would credit. It carries the shore to your barrels so that you do not have to.',
    health: 34,
    attack: 3,
    speed: 1.6,
    tameLevel: 12,
    tameChance: 0.1,
    diet: ['mixed_grass', 'wheat', 'corn', 'cabbage'],
    baitHint: 'grass or grain',
    timid: true,
    gathers: 'water',
    workRange: 10,
    variants: [
      ['#6f8496', '#cfd8dd'],
      ['#57707f', '#b6c3cb'],
      ['#8a8f7a', '#dcdcc8'],
      ['#4a5a66', '#9fadb6'],
    ],
    butcher: { meat: 6, fur: 2, leather: 4, bone: 4, gland: 1 },
    tameFail: 'drinks noisily, takes the {food} as an afterthought, and lumbers off',
    leaves: 'wades out until only the pouch shows, and then not even that',
    nearWater: true,
  },
  dowse: {
    id: 'dowse',
    name: 'Dowse',
    description: 'A whiskered burrower that will not settle anywhere there is no metal under it. Put one on a deed and it spends its days reading the ground and telling you what is down there.',
    health: 20,
    attack: 3,
    speed: 1.8,
    tameLevel: 15,
    tameChance: 0.1,
    diet: ['nuts', 'acorn', 'clay', 'potato'],
    baitHint: 'nuts or a root',
    timid: true,
    gathers: 'prospect',
    workRange: 8,
    rangePerStep: 12,
    variants: [
      ['#6d6357', '#c3b49a'],
      ['#8a7a5e', '#ded0ae'],
      ['#514b44', '#a49a8a'],
      ['#7c6a6a', '#cbb9b4'],
    ],
    butcher: { meat: 2, fur: 3, leather: 2, bone: 2, gland: 2 },
    tameFail: 'sniffs the {food}, sniffs the ground, and decides the ground is more interesting',
    leaves: 'goes down a hole that was not there a moment ago',
    onOre: true,
  },
  sappa: {
    id: 'sappa',
    name: 'Sappa',
    description: 'A moss-backed browser of the deep woods that buries more seed than it eats and forgets where. Kept on a deed it plants the ground back up behind your axe.',
    health: 26,
    attack: 3,
    speed: 1.7,
    tameLevel: 10,
    tameChance: 0.12,
    diet: ['acorn', 'nuts', 'sprout', 'blueberry'],
    baitHint: 'nuts or an acorn',
    timid: true,
    gathers: 'plant',
    workRange: 10,
    variants: [
      ['#5d6b45', '#b6bd94'],
      ['#6f5a3c', '#c4ab80'],
      ['#47533c', '#9aa585'],
      ['#7a6f4e', '#d3c8a0'],
    ],
    butcher: { meat: 3, fur: 3, leather: 2, bone: 2, gland: 1 },
    tameFail: 'buries the {food} instead of eating it and wanders off pleased with itself',
    leaves: 'goes up the nearest trunk and out of sight among the leaves',
    nearTrees: true,
  },
  snedda: {
    id: 'snedda',
    name: 'Snedda',
    description: 'A long-necked browser of the wood\'s edge with a mouth like a pair of shears. It nips the dead wood out of a tree and leaves the live, and kept on a deed it prunes what would otherwise die, and nothing else.',
    health: 24,
    attack: 2,
    speed: 1.6,
    tameLevel: 14,
    tameChance: 0.1,
    diet: ['apple', 'cherry', 'olive', 'sprout', 'nuts'],
    baitHint: 'fruit off a tree, or a sprout',
    timid: true,
    gathers: 'prune',
    workRange: 8,
    variants: [
      ['#6e7d4a', '#c9cf9a'],
      ['#807a52', '#d9d2a4'],
      ['#556343', '#a9b58c'],
      ['#8a7f5c', '#e2d8b2'],
    ],
    butcher: { meat: 2, fur: 2, leather: 2, bone: 2, gland: 1 },
    tameFail: 'takes the {food} at the very tips of its teeth, chews it a long while, and goes back to nipping at a branch',
    leaves: 'reaches up into the branches and is a branch itself by the time you look again',
    nearTrees: true,
  },
  grubba: {
    id: 'grubba',
    name: 'Grubba',
    description: 'A squat, hump-shouldered rooter with claws like mattock blades. It digs for what lives under old stumps and takes the stump with it; kept on a deed it clears the ground behind your axe.',
    health: 30,
    attack: 4,
    speed: 1.4,
    tameLevel: 8,
    tameChance: 0.12,
    diet: ['worm', 'acorn', 'nuts', 'potato', 'carrot', 'onion'],
    baitHint: 'worms, or a root out of the ground',
    timid: true,
    gathers: 'stump',
    workRange: 8,
    variants: [
      ['#5a4a3a', '#a08a6a'],
      ['#6b5040', '#b89a7a'],
      ['#4a4640', '#948c80'],
      ['#7a5a3e', '#c9a880'],
    ],
    butcher: { meat: 4, fur: 2, leather: 3, bone: 3, gland: 1 },
    tameFail: 'snuffles the {food} out of your hand and goes straight back to its digging',
    leaves: 'shoulders into the undergrowth and is gone',
    nearTrees: true,
  },
  plucka: {
    id: 'plucka',
    name: 'Plucka',
    description: 'A long-armed climber of the orchard\'s edge with hands like a child\'s and a tail it hangs by. It goes up a bearing tree and comes down with the fruit, and kept on a deed it picks what the trees have on them and carries it home to the crate.',
    health: 18,
    attack: 1,
    speed: 1.7,
    tameLevel: 10,
    tameChance: 0.12,
    diet: ['apple', 'cherry', 'olive', 'pear', 'plum', 'peach', 'fig', 'lemon', 'pomegranate', 'apricot', 'quince', 'nuts'],
    baitHint: 'fruit off a tree',
    timid: true,
    gathers: 'fruit',
    workRange: 8,
    variants: [
      ['#7a5a3a', '#e0c79a'],
      ['#5c4a3c', '#c9b58e'],
      ['#8a6a44', '#efd9ac'],
      ['#4e4238', '#b8a88a'],
    ],
    butcher: { meat: 2, fur: 2, leather: 1, bone: 2, gland: 1 },
    tameFail: 'takes the {food} in both hands, eats it in three bites and is back up the tree before you have moved',
    leaves: 'swings up into the canopy and is gone hand over hand',
    nearTrees: true,
  },
  cobbe: {
    id: 'cobbe',
    name: 'Cobbe',
    description: 'A squat, hard-headed hauler with shoulders like a wall itself. It carries brick and mortar to whatever you have planned and fits it, one piece at a time, without being asked twice.',
    health: 40,
    attack: 5,
    speed: 1.5,
    tameLevel: 20,
    tameChance: 0.09,
    diet: ['bread', 'baked_potato', 'mixed_grass', 'corn'],
    baitHint: 'bread or something cooked',
    timid: false,
    gathers: 'hod',
    workRange: 12,
    variants: [
      ['#8a8178', '#cfc7bb'],
      ['#6e6259', '#b2a79a'],
      ['#9a8467', '#ddcaa8'],
      ['#5c5a58', '#a09d99'],
    ],
    butcher: { meat: 6, fur: 1, leather: 5, bone: 6 },
    tameFail: 'eats the {food} in one, looks at you, and goes back to shoving rocks about',
    leaves: 'walks off with its head down and does not look back',
    defensive: true,
  },
  tinka: {
    id: 'tinka',
    name: 'Tinka',
    description: 'A small, fussy thing with far too many fingers, forever taking something apart to see how it is put together. Left alone with your gear it mends it, which is more than most would do.',
    health: 16,
    attack: 2,
    speed: 2,
    tameLevel: 25,
    tameChance: 0.08,
    diet: ['nuts', 'acorn', 'blueberry', 'honey'],
    baitHint: 'nuts or something sweet',
    timid: true,
    gathers: 'mend',
    workRange: 6,
    variants: [
      ['#8c7a5c', '#e0d1ac'],
      ['#6a6a72', '#bdbdc6'],
      ['#94694f', '#e4bb96'],
      ['#5f6b5a', '#b3c0ab'],
    ],
    butcher: { meat: 1, fur: 2, leather: 1, bone: 1, gland: 2 },
    tameFail: 'turns the {food} over twice looking for a seam in it, then puts it down',
    leaves: 'pockets something of yours and is gone before you can see which',
  },
  middun: {
    id: 'middun',
    name: 'Middun',
    description: 'A low, patient scavenger that eats what everything else has given up on. What comes out the other end is the best thing that ever happened to a field.',
    health: 24,
    attack: 3,
    speed: 1.5,
    tameLevel: 8,
    tameChance: 0.13,
    diet: ['meat', 'potato', 'cabbage', 'corpse'],
    baitHint: 'meat or a vegetable',
    timid: true,
    gathers: 'compost',
    workRange: 10,
    variants: [
      ['#5a4a38', '#9f8a6e'],
      ['#41382e', '#7d7062'],
      ['#6d5a44', '#b39a78'],
      ['#332e2a', '#665f57'],
    ],
    butcher: { meat: 3, fur: 3, leather: 2, bone: 3, gland: 1 },
    tameFail: 'eats the {food} and everything within a foot of where it fell',
    leaves: 'shuffles into the undergrowth after something it can smell and you cannot',
  },
  // ---- Backs and saddles. ----
  bura: {
    id: 'bura',
    wound: 'crush',
    name: 'Bura',
    description: 'A broad, slow, endlessly patient creature that was clearly made to have things strapped to it. Two hundred things ride on its back, and it neither hurries nor complains.',
    health: 55,
    attack: 6,
    speed: 1.5,
    tameLevel: 22,
    tameChance: 0.09,
    diet: ['mixed_grass', 'wheat', 'corn', 'carrot'],
    baitHint: 'grass or grain',
    timid: false,
    gathers: null,
    workRange: 6,
    variants: [
      ['#9c8a6a', '#ded0b0'],
      ['#7a6a54', '#c0b090'],
      ['#6a6f74', '#b4bcc2'],
      ['#8a6a58', '#cfae99'],
    ],
    butcher: { meat: 14, fur: 4, leather: 9, bone: 10, gland: 1 },
    tameFail: 'accepts the {food}, considers it, and goes back to standing still',
    leaves: 'ambles away at exactly the pace it does everything else',
    defensive: true,
    pannier: 200,
  },
  gorral: {
    id: 'gorral',
    wound: 'crush',
    name: 'Gorral',
    description: 'A horned cliff-goat that stands on ground you would not put a ladder against. Under a saddle it goes up what an Orse turns away from, and the more it is worked the worse the ground it will take.',
    health: 44,
    attack: 7,
    speed: 2.4,
    tameLevel: 40,
    tameChance: 0.06,
    diet: ['mixed_grass', 'cabbage', 'acorn', 'carrot'],
    baitHint: 'grass or a root',
    timid: false,
    gathers: null,
    workRange: 6,
    variants: [
      ['#8e8578', '#e2dbcd'],
      ['#5d5751', '#aaa49b'],
      ['#a8865c', '#e6cda4'],
      ['#3f3d3b', '#8a8681'],
    ],
    butcher: { meat: 10, fur: 5, leather: 7, bone: 8, gland: 1 },
    tameFail: 'takes the {food} off the flat of your hand and is four lengths up the rock before you blink',
    leaves: 'goes up the face in three bounds and looks down at you from the top',
    onStone: true,
    defensive: true,
    draught: true,
    mount: 15,
    pitch: 2,
  },
  wadd: {
    id: 'wadd',
    wound: 'crush',
    name: 'Wadd',
    description: 'A slick-furred swimmer with webbed feet and a rudder of a tail. It is the one thing on the island that will take a rider across deep water instead of drowning them.',
    health: 40,
    attack: 6,
    speed: 2.2,
    tameLevel: 38,
    tameChance: 0.07,
    diet: ['meat', 'reed', 'nuts'],
    baitHint: 'meat or reeds',
    timid: false,
    variants: [
      ['#4a5a52', '#a8bcae'],
      ['#3c4a58', '#9cb0c0'],
      ['#5f5142', '#c0ab90'],
      ['#2e3a38', '#84968e'],
    ],
    butcher: { meat: 9, fur: 6, leather: 6, bone: 7, gland: 2 },
    tameFail: 'slides the {food} into the water, eats it there, and looks back at you',
    leaves: 'goes into the water without a sound and surfaces a long way out',
    nearWater: true,
    defensive: true,
    draught: true,
    mount: 14,
    swims: true,
    gathers: 'fish',
    workRange: 10,
  },
  shaggan: {
    id: 'shaggan',
    wound: 'crush',
    name: 'Shaggan',
    description: 'A mountain of hair on four legs, slower than anything else that pulls and stronger than all of them. One in the traces is a waste of a Shaggan; four of them will move a loaded wagon as though it were empty.',
    health: 90,
    attack: 12,
    speed: 1,
    tameLevel: 35,
    tameChance: 0.06,
    diet: ['mixed_grass', 'wheat', 'corn', 'cabbage'],
    baitHint: 'grass or grain',
    timid: false,
    gathers: null,
    workRange: 6,
    variants: [
      ['#6b5a44', '#b39a76'],
      ['#4a4038', '#8d8076'],
      ['#8a7050', '#d0b288'],
      ['#585a56', '#a2a49e'],
    ],
    butcher: { meat: 30, fur: 10, leather: 16, bone: 20, gland: 1 },
    tameFail: 'eats the {food}, and the grass around it, and stands there',
    leaves: 'turns and walks into the wind, which is where it was going anyway',
    defensive: true,
    draught: true,
    pull: 0.45,
  },
  // ---- Eyes, produce and the rare sort. ----
  warda: {
    id: 'warda',
    wound: 'cut',
    name: 'Warda',
    description: 'A tall, still, long-sighted thing that picks the highest ground it can find and watches from it. Nothing comes near a settlement with one of these on the hill without you knowing.',
    health: 30,
    attack: 5,
    speed: 1.9,
    tameLevel: 30,
    tameChance: 0.08,
    diet: ['meat', 'nuts', 'acorn'],
    baitHint: 'meat or nuts',
    timid: false,
    gathers: null,
    workRange: 8,
    variants: [
      ['#7d7a72', '#d6d2c6'],
      ['#5a6470', '#b0bac6'],
      ['#8a7256', '#d9c19c'],
      ['#43474a', '#93989c'],
    ],
    butcher: { meat: 4, feather: 5, leather: 2, bone: 3, gland: 1 },
    tameFail: 'takes the {food} without once taking its eyes off the horizon',
    leaves: 'lifts, circles once to see everything, and is a speck',
    defensive: true,
    sight: 18,
  },
  quill: {
    id: 'quill',
    wound: 'pierce',
    name: 'Quill',
    description: 'A heavy ground-bird that would rather run than fly and would rather eat than run. Its long wing feathers grow back as fast as you can take them, which is what keeps an archer in arrows.',
    health: 26,
    attack: 4,
    speed: 1.9,
    tameLevel: 12,
    tameChance: 0.11,
    diet: ['wheat', 'corn', 'nuts', 'acorn'],
    baitHint: 'grain or nuts',
    timid: true,
    gathers: null,
    workRange: 6,
    variants: [
      ['#8a6a44', '#e0c08a'],
      ['#6a5a4a', '#c2ae94'],
      ['#96585a', '#e2a8a4'],
      ['#4f5a44', '#a8b894'],
    ],
    butcher: { meat: 5, feather: 8, leather: 2, bone: 3 },
    tameFail: 'bolts with the {food} and eats it at a safe distance, watching you',
    leaves: 'runs off with its neck out, going faster than looks possible',
    fleece: 1 / 700,
    shearYield: 'feather',
  },
  cudda: {
    id: 'cudda',
    wound: 'crush',
    name: 'Cudda',
    description: 'A placid, deep-bellied grazer that chews whatever it is given and gives milk back for it. Bring a bucket.',
    health: 48,
    attack: 4,
    speed: 1.2,
    tameLevel: 14,
    tameChance: 0.12,
    diet: ['mixed_grass', 'cabbage', 'carrot', 'wheat'],
    baitHint: 'grass, grain or a root',
    timid: true,
    gathers: null,
    workRange: 6,
    variants: [
      ['#a89880', '#eee3cf'],
      ['#7d6a58', '#c8b49a'],
      ['#5e5a55', '#aaa49c'],
      ['#b0705a', '#e8bfa6'],
    ],
    butcher: { meat: 18, fur: 4, leather: 10, bone: 12, gland: 1 },
    tameFail: 'chews the {food} at you for a while and then chews something else',
    leaves: 'walks to the far side of the field and carries on chewing',
    fleece: 1 / 600,
    milk: true,
  },
  vesp: {
    id: 'vesp',
    wound: 'pierce',
    name: 'Vesp',
    description: 'Not one creature so much as a small furious cloud of them, which settles where there are flowers. Give the swarm a hive on your deed and it will fill it with honey and wax and defend it from anything foolish.',
    health: 12,
    attack: 3,
    speed: 2.4,
    tameLevel: 18,
    tameChance: 0.1,
    diet: ['blueberry', 'raspberry', 'strawberry', 'honey'],
    baitHint: 'berries or honey',
    timid: false,
    gathers: null,
    workRange: 8,
    variants: [
      ['#c8a03a', '#3a3128'],
      ['#a8862e', '#2e2820'],
      ['#d8b858', '#4a3f30'],
      ['#8a6a24', '#241f18'],
    ],
    butcher: { meat: 1, gland: 3 },
    tameFail: 'lifts off the {food} in a body, hangs in the air a moment, and settles again',
    leaves: 'rises all at once and pours away over the hedge',
    defensive: true,
    hives: true,
  },
  snout: {
    id: 'snout',
    name: 'Snout',
    description: 'Wrinkled, half blind, and the finest nose on the island. It smells what is under the ground, and what is under the ground on this island is other people\'s lives.',
    health: 24,
    attack: 4,
    speed: 1.6,
    tameLevel: 50,
    tameChance: 0.05,
    diet: ['meat', 'nuts', 'gland', 'cooked_meat'],
    baitHint: 'meat or nuts',
    timid: false,
    gathers: 'seek',
    workRange: 10,
    rangePerStep: 12,
    variants: [
      ['#8a7a6a', '#d8c8b4'],
      ['#6a5a50', '#b6a294'],
      ['#a08878', '#e6d2c0'],
      ['#4f4844', '#98908a'],
    ],
    butcher: { meat: 4, fur: 3, leather: 3, bone: 3, gland: 3 },
    tameFail: 'works its way over the {food}, over your boots, and over the ground you are standing on',
    leaves: 'follows its nose away and is not seen again',
  },
  lume: {
    id: 'lume',
    wound: 'burn',
    name: 'Lume',
    description: 'A pale slow drifter that is only ever out after dark, and glows with a light that has nothing to do with fire. Keep one and the night stops being half blind.',
    health: 10,
    attack: 1,
    speed: 1.3,
    tameLevel: 55,
    tameChance: 0.05,
    diet: ['gland', 'nuts', 'honey'],
    baitHint: 'a gland or something sweet',
    timid: true,
    gathers: null,
    workRange: 6,
    variants: [
      ['#dfe6c8', '#f6f8e6'],
      ['#c8e0e6', '#e8f6f8'],
      ['#e6d6c0', '#f8efdd'],
      ['#d0c8e6', '#eee8f8'],
    ],
    butcher: { meat: 1, gland: 4 },
    tameFail: 'drifts around the {food} twice, dims, and drifts away',
    leaves: 'goes out like a blown candle and is not there when the light comes back',
    glow: 8,
    nocturnal: true,
  },

  // ---- The things that are not wildermon ----
  //
  // Nothing below this line can be tamed, trapped, bred or brushed. They are
  // rare, they notice you from further off than anything else, they hit hard
  // enough to matter, and every one of them is carrying something you cannot
  // get any other way.
  goblin: {
    id: 'goblin',
    monster: true,
    notice: 11,
    wound: 'cut',
    name: 'Goblin',
    description: 'Knee-high, green-grey and entirely malice, in a jerkin of somebody else\u2019s leather with a notched blade it did not make. The commonest of the bad things, and the only one a careful beginner survives meeting.',
    health: 40,
    attack: 14,
    speed: 2.3,
    tameLevel: 999,
    tameChance: 0,
    diet: [],
    baitHint: 'nothing you would offer it',
    timid: false,
    gathers: null,
    workRange: 0,
    variants: [
      ['#6f7f52', '#c3cf9e'],
      ['#5d6d48', '#aab98a'],
      ['#7c8a5e', '#d0daa9'],
    ],
    butcher: { meat: 2, leather: 3, bone: 4, sinew: 2 },
    tameFail: 'spits at your hand',
    leaves: 'slinks off into the undergrowth',
    hunter: true,
    defensive: true,
    defaultStance: 'aggressive',
  },
  orc: {
    id: 'orc',
    monster: true,
    notice: 13,
    wound: 'cut',
    name: 'Orc',
    description: 'A head taller than you, grey-skinned, tusked, and carrying iron it took the trouble to sharpen. Orcs come down out of the high ground in ones and twos and they do not run from anything.',
    health: 95,
    attack: 22,
    speed: 2.5,
    tameLevel: 999,
    tameChance: 0,
    diet: [],
    baitHint: 'nothing you would offer it',
    timid: false,
    gathers: null,
    workRange: 0,
    variants: [
      ['#5f6a63', '#b3bcb2'],
      ['#4d5851', '#9aa49b'],
      ['#6d7a6f', '#c2cbc0'],
    ],
    butcher: { meat: 5, leather: 6, bone: 7, sinew: 4, tusk: 2 },
    tameFail: 'laughs at you',
    leaves: 'turns and walks away without hurrying',
    hunter: true,
    defensive: true,
    defaultStance: 'aggressive',
  },
  ogre: {
    id: 'ogre',
    monster: true,
    notice: 12,
    wound: 'crush',
    name: 'Ogre',
    description: 'Three times your weight and most of it shoulder, with a tree in one fist and very little behind the eyes. It is slow, it is stupid, and if it gets a hand on you none of that matters.',
    health: 170,
    attack: 34,
    speed: 1.8,
    tameLevel: 999,
    tameChance: 0,
    diet: [],
    baitHint: 'nothing you would offer it',
    timid: false,
    gathers: null,
    workRange: 0,
    variants: [
      ['#8a7358', '#d8c4a4'],
      ['#6f5c47', '#bda88a'],
      ['#9a8464', '#e4d3b3'],
    ],
    butcher: { meat: 14, leather: 10, bone: 14, sinew: 8, tusk: 4, gland: 2 },
    tameFail: 'looks at the {food}, then at you',
    leaves: 'lumbers off, flattening everything in its way',
    hunter: true,
    defensive: true,
    defaultStance: 'aggressive',
  },
  dragon: {
    id: 'dragon',
    monster: true,
    notice: 20,
    wound: 'burn',
    name: 'Dragon',
    description: 'There is one. Nobody agrees where, everybody agrees it is real, and the few who have seen it and come back describe the same thing: scales like roof slates, a smell of hot metal, and the ground going by underneath very fast.',
    health: 700,
    attack: 70,
    speed: 2.9,
    tameLevel: 999,
    tameChance: 0,
    diet: [],
    baitHint: 'nothing in the world',
    timid: false,
    gathers: null,
    workRange: 0,
    variants: [
      ['#7a3b3b', '#d98a4a'],
      ['#3b4f7a', '#5a9ad9'],
      ['#3f6b46', '#7fd07f'],
      ['#4a3f5f', '#a98ad9'],
    ],
    butcher: { meat: 40, leather: 24, bone: 30, sinew: 20, scale: 24, gland: 6, hoard: 1 },
    tameFail: 'does not appear to have noticed',
    leaves: 'is simply not there any more',
    hunter: true,
    defensive: true,
    glow: 5,
    defaultStance: 'aggressive',
  },
};

/** Which species roam wild, by weight. */
/**
 * The bad things, and how often one of the wild's slots turns out to be one.
 * A goblin is a bad afternoon; a dragon is something almost nobody sees.
 */
export const MONSTERS: Array<[string, number]> = [
  ['goblin', 60],
  ['orc', 26],
  ['ogre', 12],
  ['dragon', 2],
];
/** The share of everything that stands up out there that is a monster. */
export const MONSTER_SHARE = 0.022;
/** How many of each may be walking about at once, across the whole island. */
export const MONSTER_CAP: Record<string, number> = { goblin: 6, orc: 3, ogre: 2, dragon: 1 };

export const WILD_SPECIES: Array<[string, number]> = [
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
  ['middun', 9],
  ['quill', 9],
  ['cudda', 9],
  ['sedra', 8],
  ['sappa', 8],
  ['snedda', 5],
  ['grubba', 5],
  ['plucka', 5],
  ['bogga', 6],
  ['holla', 6],
  ['cobbe', 6],
  ['bura', 6],
  ['vesp', 6],
  ['dowse', 5],
  ['warda', 5],
  ['tinka', 4],
  ['gorral', 4],
  ['wadd', 4],
  ['shaggan', 4],
  ['snout', 2],
  ['lume', 2],
];

/** How far off a hunter picks up your scent, and how far you must get to lose it. */
const HUNT_SIGHT = 7;
const HUNT_GIVE_UP = 13;

/**
 * How far a hunter will come from where it first had your scent, in tiles.
 *
 * Reported as being chased until you are dead, and that is exactly what
 * happened: the only thing that called a hunt off was the gap between hunter
 * and hunted, and a hunter runs at `speed * 1.15` — so the gap it was measured
 * against was a gap it was closing. Outrunning one was the only way to lose
 * it, and most things on this island are faster than a body carrying a pack.
 *
 * So the leash is tied where the chase *began* instead. Thirty tiles is a
 * screen and a half: far enough that a goblin is worth running from and not a
 * formality, short enough that running works.
 */
export const HUNT_LEASH = 30;

/**
 * And how far from its own home ground it will go while hunting.
 *
 * The leash above is tied where a chase began, which is the right measure for
 * a hunter you walked in on and the wrong one for a hunter that had already
 * wandered halfway to the next valley — that one would take you thirty tiles
 * further still, which is sixty tiles of country between it and anywhere it
 * has any business being.
 *
 * Both are asked, and the first to run out ends it. So a hunter met at its
 * den chases you the full thirty as it always did, and one met at the edge of
 * its range gives up in a dozen, because it is already nearly as far from
 * home as it is willing to be. A dozen over the range is deliberate: a bound
 * exactly at the range would have a hunter at the edge turn back before it
 * had gone anywhere, which is not a hunter at all.
 */
export const HUNT_HOME = WILD_RANGE + 12;

/**
 * And how long it wants nothing to do with hunting after it gives one up.
 *
 * Without this it drops the chase at the end of the leash, notices you again
 * on the next breath because you are still within its sight, and the leash is
 * measured afresh from there — which is the same endless chase with a stutter
 * in it.
 */
export const HUNT_REST = world(60);
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
/**
 * What a working wildermon may help itself to out of a store on the deed.
 *
 * Its own diet, and then the two things that are somebody's: a locked thing,
 * because locking is how a person says *not this one, not the next thing the
 * game reaches for*, and a thing with a price on it, because that is stock on
 * a stall and not lunch. The island adds post in a mailbox and goods promised
 * in a deal to that list, which this side does not model.
 */
export const mayEat = (species: SpeciesDef, item: Item): boolean =>
  isBaitFor(species, item.id) && !item.locked && item.price === undefined;
/** What a wild one does to feed itself; felling trees puts no food in its belly. */
/** The jobs that are errands rather than a walk out for a load of something. */
const ERRAND_JOBS = new Set<GatherKind>(['water', 'hod', 'mend', 'plant', 'prospect', 'compost']);
const INDOOR_JOBS = new Set<GatherKind>(['woodcut', 'farm', 'mine', 'sand', 'clay', 'quarry', 'stoke', 'fetch', 'guard', 'hunt', 'water', 'prospect', 'plant', 'hod', 'mend', 'compost', 'seek', 'prune', 'stump']);
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
  const earned = species.workRange + rangeSteps(taskSkill(c, species)) * (species.rangePerStep ?? RANGE_PER_STEP);
  return Math.round(earned * traitMul(c.traits, 'range'));
}

/**
 * Where a worker takes its orders from: a settlement, or a work post standing
 * in for one. A deed lets a worker range as far as it has earned; a post is a
 * work site rather than a settlement, and holds it to the post's own reach
 * however much the creature has learned.
 */
export interface WorkSite {
  x: number;
  y: number;
  radius: number;
  /** Set when the site is a post rather than the settlement. */
  post?: number;
}

/** How far this worker ranges from this site. */
export const siteRange = (c: Creature, species: SpeciesDef, site: WorkSite): number =>
  site.post !== undefined ? Math.min(workRangeOf(c, species), site.radius) : workRangeOf(c, species);
/** Fresh task skills for a species. */
const startSkills = (species: SpeciesDef): Record<string, number> => {
  const id = workSkill(species);
  const skills: Record<string, number> = id ? { [id]: 1 } : {};
  // A beast bred to pull starts knowing nothing about hills and learns in the
  // traces, which is what decides the pace of everything it is put in front of.
  if (species.draught) skills[HAUL_SKILL] = 1;
  return skills;
};

/**
 * Age. Everything alive on the island was born at some hour and gets older
 * from there. A young one is small, quick to trust and no use in the traces;
 * a grown one is what the numbers in the book describe; an old one has slowed
 * down and put on weight, which is bad for a cart and good for a butcher.
 */
export type Age = 'young' | 'grown' | 'old';
/** Seconds of real time spent young, and the hour it turns old. */
export const YOUNG_FOR = world(60 * 60);
export const OLD_AT = world(6 * 60 * 60);
/** How long a dam carries: half an island day. */
export const GESTATION = world(12 * 60);
/** How long after a covering either parent will look at another. */
export const BREED_REST = world(20 * 60);

export interface AgeDef {
  id: Age;
  name: string;
  /** Multiplier on how fast it moves, in the traces and under a rider alike. */
  speed: number;
  /** Multiplier on its share of a team's pull. */
  pull: number;
  /** Multiplier on what the carcass is worth. */
  yield: number;
  /** Multiplier on how fast fleece grows back and milk comes in. */
  growth: number;
  /** How much of its full size it is drawn at. */
  scale: number;
  /** Taming is easier on something that has not learned to mistrust you. */
  tame: number;
  /** Old enough to be worked, ridden or put in the traces. */
  works: boolean;
}

export const AGES: Record<Age, AgeDef> = {
  young: { id: 'young', name: 'young', speed: 0.8, pull: 0.4, yield: 0.4, growth: 0, scale: 0.62, tame: 1.6, works: false },
  grown: { id: 'grown', name: 'grown', speed: 1, pull: 1, yield: 1, growth: 1, scale: 1, tame: 1, works: true },
  old: { id: 'old', name: 'old', speed: 0.85, pull: 0.8, yield: 1.35, growth: 0.6, scale: 1.12, tame: 0.8, works: true },
};

/** How old a creature is now. */
export const ageOf = (c: Creature, now: number): Age => {
  // Nothing born before the clock started has an age worth working out: what
  // was already walking about when the island was raised is simply grown.
  if (c.born <= 0) return 'grown';
  const lived = Math.max(0, now - c.born);
  return lived < YOUNG_FOR ? 'young' : lived < OLD_AT ? 'grown' : 'old';
};
export const ageDef = (c: Creature, now: number): AgeDef => AGES[ageOf(c, now)];
/** How long until it is grown, in seconds; zero once it is. */
export const growsAt = (c: Creature, now: number): number => Math.max(0, c.born + YOUNG_FOR - now);

/**
 * Care. A wildermon that is brushed and looked over works better and learns
 * faster than one that is only fed, and the care goes out of it again over a
 * few hours of being left alone. It is also half of what decides whether a
 * pairing throws anything worth keeping.
 */
export const CARE_HOURS = 3;
export const CARE_DECAY = 1 / (CARE_HOURS * 3600);
/** What a thoroughly looked-after beast is worth over a neglected one. */
export const CARE_BONUS = 0.25;
export const careMul = (c: Creature): number => 1 + Math.max(0, Math.min(1, c.care)) * CARE_BONUS;
/** How it reads on a card: groomed, kept, or let go. */
export const careWord = (care: number): string =>
  care >= 0.75 ? 'well looked after' : care >= 0.4 ? 'kept' : care >= 0.12 ? 'wanting a brush' : 'neglected';

/** Its own blood on one channel, with nothing communal in it. */
export const bloodMul = (c: Creature, channel: TraitChannel): number => traitMul(c.traits, channel);

/** What it can take, once its blood is counted. */
export const maxHealth = (c: Creature, species: SpeciesDef): number =>
  Math.round(species.health * bloodMul(c, 'hardy'));
/** What its attack lands for. */
export const attackOf = (c: Creature, species: SpeciesDef): number => species.attack * bloodMul(c, 'tough');

/** What a set of traits is worth, written out for a log line. */
export const TRAIT_COUNT = TRAIT_SLOTS;

/** What a draught beast trains by pulling, and a mount by being ridden. */
export const HAUL_SKILL = 'climbing';
/** What a hunter trains, which decides how hard it hits and how far it ranges. */
export const FIGHT_SKILL = 'fighting';

/**
 * What a fight may pick as its quarry: something wild, and nothing in the
 * traces. Nothing tame is ever picked; one in harness is not picked whatever
 * else is true of it.
 */
export const quarry = (o: Creature): boolean => o.mode === 'wild' && o.hitchedTo === null;

/**
 * A wild thing as the island describes it.
 *
 * `rpc_creatures` builds this; nothing here invents any of it. The leg — where
 * it is walking from, to, and between which two of the island's own instants —
 * is what lets a browser draw movement between one word and the next without
 * ever deciding where anything goes.
 */
export interface IslandCreature {
  id: number;
  species: string;
  name: string;
  variant: number;
  mode: string;
  stance: string;
  x: number;
  y: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  /**
   * How long the leg is and how much of it is left, in seconds.
   *
   * Seconds rather than the two instants, for the same reason the action bar
   * takes seconds: a browser whose clock is out by even a few seconds would
   * otherwise pin every leg at one end and re-pin it on the next answer, which
   * is a thing jumping about rather than a thing walking.
   */
  legFor?: number | null;
  legLeft?: number | null;
  health: number;
  max?: number;
  hunger?: number;
  sex?: string;
  traits?: string[];
  hunting?: boolean;
  mine?: boolean;
  /** Shod, by the island's clock. */
  shod?: boolean;
  /** The vehicle it is in the traces of; absent from older islands. */
  hitchedTo?: number | null;
  /** The trade a worker was set to, which is its species' own unless it was told otherwise. */
  job?: string | null;
  /*
   * And, for your own only, the working life the card used to invent.
   *
   * `rpc_creatures` carried a body and a leg and nothing about what a thing
   * was doing with its day, so the wildermon window filled the rest in from
   * the book: every wildermon on an island read Foraging 1.00, Experience 0.0,
   * Care 0% and "Looking for work", however long it had been at it.
   */
  care?: number;
  xp?: number;
  skills?: Record<string, number>;
  /** What the island says it is up to: `idle`, `out`, `work`, `home`, and the rest. */
  phase?: string;
  carrying?: { def: string; count?: number; ql?: number } | null;
}

/**
 * The island's word for what a worker is doing, in the browser's.
 *
 * Two words each side of the same thing: the island counts a trip as out,
 * work, home; this side has toForage, forage, and a thing with its arms full.
 */
const STATE_OF: Record<string, string> = { out: 'toForage', work: 'forage' };

export interface Creature {
  id: number;
  /**
   * Whose this is, on an island. Absent in the game you play by yourself,
   * where everything on the ground is yours because there is only you.
   */
  mine?: boolean;

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
  /** Male or female. It decides what can be bred, and what can be milked. */
  sex: Sex;
  /** The three traits it was born with. Blood, and the whole of what breeding is for. */
  traits: string[];
  /** How well it has been looked after lately, 0..1. Brushing puts it up; time takes it down. */
  care: number;
  /** Game time it was last put to a mate, so nothing is bred twice in an afternoon. */
  bredAt: number;
  /** Game time a carried young is due, or 0 for one that is not in calf. */
  due: number;
  /** What is coming, settled at the covering so no sire need survive to the birth. */
  unborn: { traits: string[]; sex: Sex } | null;
  // Runtime state below; not saved.
  /**
   * The leg the island last said it was on, when the island is the one
   * thinking. Milliseconds off `Date.parse`, walked in `walkLegs`.
   */
  legFromX: number;
  legFromY: number;
  legToX: number;
  legToY: number;
  legAt: number;
  legEnds: number;
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
  /** Where it first had your scent, which is what the leash is tied to. */
  huntX: number;
  huntY: number;
  /**
   * The middle of its own ground: where it wanders about, and what a hunter's
   * leash is measured from.
   *
   * Set where it is first put down, and shared with the herd it joined if it
   * joined one. Nought for anything that is not wild — a tame thing's home is
   * wherever its keeper is, and a worker's is the settlement.
   */
  homeX: number;
  homeY: number;
  /** When it will take an interest again, after giving a chase up. */
  huntRest: number;
  /** When it last said it had nowhere to put a load down. */
  noRoomAt: number;
  /** Time banked up while nobody was watching, spent on the next think. */
  owed: number;
  /** When the player last called it over for an action; it drops everything and comes. */
  calledAt: number;
  /** Next time an unruly one gets a chance to turn on its keeper. */
  nipAt: number;
  /** Offerings made to a wild one in a row, and when the last was made. */
  coaxed: number;
  coaxedAt: number;
  /** The tile this worker walked out to work on: a tree, a seam, a field. */
  workX: number;
  workY: number;
  /** Seeds held in the cheeks, for a farm worker to sow. */
  pouch: Item | null;
  /** What the worker walked out to do: a farm job, or the hearth a stoker is feeding. */
  job: FarmJob | Hearth | null;
  /**
   * The trade it was set to, when that is not its species' own. Null means
   * `gathers`. The island keeps the same thing in the creature's `job`
   * column, which there has only ever held a trade.
   */
  trade: GatherKind | null;
  /**
   * The vehicle whose traces it is in, if any. Worked out from the vehicles
   * themselves when a world is read back, so it is never saved twice.
   */
  hitchedTo: number | null;
  /** Saddled and bridled, for the sorts that can be ridden. */
  tacked: boolean;
  /** When it was last shod; shoes hold `SHOE_DAYS`. Long ago when it never was. */
  shodAt: number;
  /** What is riding on its back, for the sorts that carry panniers. */
  pannier: Item[];
  /** Set while the player is up on its back. */
  ridden: boolean;
  /** The hour it was born, which is all that age is. */
  born: number;
  /** The trap holding it, if it has walked into one. It does nothing at all while it is held. */
  trapped: number | null;
  /**
   * The work post it takes its orders from, if any. A worker with one treats
   * that post exactly as another treats the settlement token — until the post
   * rots through under it.
   */
  post: number | null;
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
  shodAt?: number;
  pannier?: Item[];
  post?: number | null;
  trapped?: number | null;
  born?: number;
  sex?: Sex;
  traits?: string[];
  care?: number;
  bredAt?: number;
  due?: number;
  unborn?: { traits: string[]; sex: Sex } | null;
  trade?: GatherKind | null;
  /**
   * The middle of its own ground. Saved, because a herd that scattered every
   * time somebody reloaded would not be a herd; a save from before this has
   * none, and everything in it takes where it is standing as home, which is
   * the same answer it would have got had it only just arrived.
   */
  homeX?: number;
  homeY?: number;
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

/**
 * When a wildermon goes looking for food, and how much a meal is worth.
 *
 * Written out four times between the grazing, the bait and now the stores,
 * which is three copies too many of a number that has to agree with itself.
 */
export const GRAZE_HUNGRY = 0.5;
export const GRAZE_FILL = 0.5;

/** How long a called creature keeps making its way over. */
export const CALL_WINDOW = 12;
/**
 * Horseshoes. Four to a mount, nailed on with a mallet; they hold a week,
 * quicker on laid stone by a share and up a steeper step by a fixed
 * height. The island reads the same four.
 */
export const SHOES_PER_MOUNT = 4;
export const SHOE_DAYS = 7;
export const SHOE_PACE = 1.15;
export const SHOE_STEP = 8;
/** Whether the shoes are still on: a week from the fitting, in the clock that fitted them. */
export const isShod = (now: number, c: { shodAt: number }): boolean => now - c.shodAt < SHOE_DAYS * DAY_SECONDS;
/** How close it comes before standing still, well inside arm's reach. */
const CALL_DISTANCE = 0.9;

/**
 * The floor under an island's wildlife, however small the island is.
 *
 * Three times what it was, with `PER_REGION`: a 64-tile island is four
 * stretches of country and would otherwise hold four head, so on anything you
 * can walk across in a minute this number is the whole of the answer.
 */
export const WILD_TARGET = 96;
const RESPAWN_EVERY = 22;
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
/**
 * Wildlife a stretch of country holds, which is what the island adds up to.
 *
 * Back to one, and the reason is worth writing down because the number itself
 * is not the fault.
 *
 * It was one, and "wildermon are too rare" was a fair report: a head to a
 * thirty-two tile square is a creature every thousand tiles and the country
 * between settlements read as empty. So it went to three. What that also did
 * — and nobody looked, which is the actual mistake — was treble the work the
 * island does to *put them out*, and that work happens inside `rpc_move`,
 * which is the call a walking browser makes constantly.
 *
 * `creature_stock_block` throws darts at a two-hundred-and-fifty-six tile
 * square until it has placed what the square is owed, giving up after twelve
 * throws per head. Only an eighth of this island is ground anything can stand
 * on, so most throws miss. Measured on Bigness, one block, inside the walk
 * call:
 *
 *     three a region: 6,963 ms for a land block, 1,797 ms for open sea
 *     one a region:   1,430 ms for a land block,   651 ms for open sea
 *
 * Seven seconds of server, on the move call, every time somebody walks into
 * country nobody has been through in the last fifty minutes. Reported as the
 * island severely delaying its answers, and that is what it was.
 *
 * One again, then, which is a fifth of the stall — and the density question is
 * still open and still fair. The answer to it is not this number, it is that
 * putting the wildlife out has no business happening on the walk call at all;
 * it belongs on the heartbeat, where nobody is waiting for it. Until it moves
 * there, the price of a fuller island is paid by whoever is walking across it.
 *
 * The island reads this number rather than keeping one of its own, so the two
 * of them cannot drift: `wild_per_region()` and `wild_floor()` are emitted
 * from here with the rest of the rulebook.
 */
export const PER_REGION = 1;

/**
 * How much wildlife a piece of country that size should hold.
 *
 * A function of the measurements rather than of the world, because the island
 * asks the same question of a block of 256 tiles as this asks of a whole map,
 * and because it is the one thing both sides have to answer the same way.
 */
export const wildTargetFor = (w: number, h: number): number =>
  Math.max(WILD_TARGET, Math.round(Math.ceil(w / REGION) * Math.ceil(h / REGION) * PER_REGION));
/**
 * Coaxing. A wild thing offered food again and again grows used to the hand
 * holding it, so every attempt in a row makes the next a little likelier. A
 * run lapses if you leave it alone, and raising a hand to it ends the run
 * outright: nothing that has been hit takes food from you.
 *
 * It used to stop at four offerings — a ceiling of twelve points, which on a
 * hard tame is not enough to see, and which turned a long run of refusals back
 * into no progress at all: the very thing coaxing is for. There is no ceiling
 * on it now. Keep offering and it keeps warming, and the only limit is the one
 * on the whole chance, which `tameChance` has always clamped at 0.95 — so
 * patience buys a hard tame rather than guaranteeing it, and the run still
 * lapses the moment you walk away.
 */
export const COAX_STEP = 0.03;
export const COAX_LAPSE = world(90);

/** What a run of offerings is worth to the next one, 0 when the run has lapsed. */
export const coaxBonus = (c: Creature, time: number): number =>
  c.coaxed <= 0 || time - c.coaxedAt > COAX_LAPSE ? 0 : c.coaxed * COAX_STEP;

/** Forget a run of offerings: it was tamed, or hurt, or simply left alone. */
export const forgetCoaxing = (c: Creature): void => {
  c.coaxed = 0;
  c.coaxedAt = -1e9;
};

/** Seconds a wild creature spends grazing. */
const FORAGE_TIME = 2.5;
/** Seconds between chances for an unruly companion to turn on its keeper. */
const NIP_EVERY = 25;

/** A creature's level, read off its best task skill. */
export const creatureLevel = (c: Creature): number => 1 + Math.floor(Math.max(0, ...Object.values(c.skills), 0) / 5);

/** How long a deed worker takes over a task: twice what a player of the same skill would. */
export function workDuration(skill: number): number {
  return 2 * Math.max(ACTION_FLOOR, WORKER_WEIGHT * ACTION_PACE * (1 - skill / 140));
}

type MoveResult = 'arrived' | 'moving' | 'blocked';

/** A blow the island reported by the health it took off, and where it landed. */
export interface Hurt {
  x: number;
  y: number;
  taken: number;
}

/**
 * How much health has to go before it is worth a number.
 *
 * A body's top health moves with its age, so an old thing shedding a
 * hundredth as it goes past its prime is not a wound, and neither is the
 * rounding between one answer and the next. The renderer writes anything
 * under this as "blocked", which would be a lie about both.
 */
const HURT_FLOOR = 0.05;

export class Creatures {
  readonly list = new Map<number, Creature>();
  nextId = 1;
  /**
   * Who is standing where, filed under the tile and rebuilt every tick.
   *
   * Numbers for keys rather than `"x,y"` strings, and the arrays are emptied
   * and kept rather than thrown away: this is rebuilt from scratch on every
   * frame for every creature on the island, so it was making a string and an
   * array per creature per frame and handing both straight to the collector.
   */
  private byTile = new Map<number, Creature[]>();
  /** Tiles written to this tick, so the rest can be left alone. */
  private filled: number[] = [];
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

  /**
   * Whether the island is the one doing the thinking.
   *
   * Set on an island kept in Postgres, where every wild thing's hunger,
   * wandering and hunting is settled there — the same seam as actions. Nothing
   * here may decide anything about a creature then: this side is handed legs
   * with times on them and walks them, so that the frames between one word
   * from the island and the next have something to draw.
   */
  fromIsland = false;

  get(id: number): Creature | undefined {
    return this.list.get(id);
  }

  species(c: Creature): SpeciesDef {
    return SPECIES[c.species] ?? SPECIES.rabba;
  }

  spawn(species: string, x: number, y: number, mode: CreatureMode = 'wild', rand: () => number = Math.random, born = 0): Creature {
    const c = Creatures.make(this.nextId++, species, x, y, mode, rand);
    c.born = born;
    if (mode === 'wild') this.joinHerd(c);
    this.list.set(c.id, c);
    return c;
  }

  /**
   * Throw in with the nearest of its own kind, if there is one about.
   *
   * A herd is not a list anywhere: it is a shared home. A grazer arriving
   * within `HERD_REACH` of another of its species takes that one's home
   * ground for its own, so the pair of them wander the same patch and are
   * found together ever after — and the next one along joins whichever of
   * them it lands nearest, which is how a herd grows out of one look round at
   * birth and no bookkeeping at all.
   *
   * Hunters keep their own ground. Six goblins sharing a range would be a
   * pack, and what makes a hunter frightening is meeting it where it lives.
   */
  private joinHerd(c: Creature): void {
    if (SPECIES[c.species]?.hunter) return;
    let bestD = HERD_REACH;
    let best: Creature | null = null;
    for (const o of this.list.values()) {
      if (o.species !== c.species || o.mode !== 'wild') continue;
      const d = Math.hypot(o.homeX - c.x, o.homeY - c.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return;
    c.homeX = best.homeX;
    c.homeY = best.homeY;
  }

  private static make(id: number, species: string, x: number, y: number, mode: CreatureMode, rand: () => number): Creature {
    const def = SPECIES[species] ?? SPECIES.rabba;
    const c: Creature = {
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
      sex: rand() < 0.5 ? 'male' : 'female',
      traits: rollTraits(rand),
      care: 0,
      bredAt: -1e9,
      due: 0,
      unborn: null,
      legFromX: x,
      legFromY: y,
      legToX: x,
      legToY: y,
      legAt: 0,
      legEnds: 0,
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
      huntX: 0,
      huntY: 0,
      homeX: x,
      homeY: y,
      huntRest: -1e9,
      noRoomAt: 0,
      owed: 0,
      calledAt: -1e9,
      nipAt: 0,
      coaxed: 0,
      coaxedAt: -1e9,
      workX: -1,
      workY: -1,
      pouch: null,
      job: null,
      trade: null,
      hitchedTo: null,
      tacked: false,
      shodAt: -1e9,
      ridden: false,
      pannier: [],
      post: null,
      trapped: null,
      born: 0,
    };
    // Blood decides what it can take, so the ceiling is read off the traits it
    // was just given rather than off the book.
    c.health = maxHealth(c, def);
    return c;
  }

  /**
   * Everything the island says is about, in one word.
   *
   * The browser never asked. `rpc_creatures` has been there since the island
   * was built and nothing under `src/` called it, so on a live island the
   * wildlife was there, moving, hunting — and invisible. The footer said
   * `0/0 mobs` and meant it.
   *
   * Replaces rather than merges: what is not in the list has wandered out of
   * the range we asked about, or is dead, and either way it is not here.
   */
  sawAll(rows: IslandCreature[], time = 0): Hurt[] {
    const now = Date.now();
    const seen = new Set<number>();
    const hurt: Hurt[] = [];
    for (const r of rows) {
      seen.add(r.id);
      let c = this.list.get(r.id);
      // What it stood at before this answer, which is the only record of a
      // blow anybody struck between two of them.
      const was = c?.health;
      if (!c) {
        c = Creatures.make(r.id, r.species, r.x, r.y, r.mode as CreatureMode, Math.random);
        this.list.set(r.id, c);
        if (r.id >= this.nextId) this.nextId = r.id + 1;
      }
      c.name = r.name ?? c.name;
      c.variant = r.variant ?? c.variant;
      c.mode = r.mode as CreatureMode;
      c.stance = r.stance as Stance;
      c.health = r.health;
      /*
       * A number over anything that lost health since the last answer.
       *
       * Not a claim about who struck it — on a shared island it may have been
       * somebody else, and the island does not say. It is what the thing lost,
       * which is what a damage number means. Only over something we had
       * already seen: the first sight of a creature is not a wound.
       */
      if (was !== undefined && was - r.health > HURT_FLOOR) {
        hurt.push({ x: r.x, y: r.y, taken: was - r.health });
      }
      c.hunger = r.hunger ?? c.hunger;
      c.sex = (r.sex as Sex) ?? c.sex;
      c.traits = r.traits ?? c.traits;
      c.enemy = r.hunting ? 0 : null;
      // Whose it is, which the island says and the journal has to know.
      c.mine = r.mine;
      // And what it was set to, if that is not what its kind does anyway.
      if (r.job !== undefined) c.trade = r.job && r.job !== SPECIES[c.species]?.gathers && (SPECIES[c.species]?.trades ?? []).includes(r.job as GatherKind) ? (r.job as GatherKind) : null;
      // Shod or not is the island's word; the browser keeps its own clock of it.
      if (r.shod !== undefined) c.shodAt = r.shod ? (isShod(time, c) ? c.shodAt : time) : -1e9;
      /*
       * And which traces it is in, which the island never said: every hitched
       * animal on an island read as free, so its menu offered to hitch it again
       * and never to take it out, and the wagon's yokes read empty.
       */
      if (r.hitchedTo !== undefined) c.hitchedTo = r.hitchedTo;
      // The working life, which comes for yours and for nobody else's.
      if (r.care !== undefined) c.care = r.care;
      if (r.xp !== undefined) c.xp = r.xp;
      if (r.skills) c.skills = r.skills;
      if (r.phase !== undefined) c.state = STATE_OF[r.phase] ?? 'idle';
      if (r.carrying !== undefined) {
        c.carrying = r.carrying
          ? { uid: 0, id: r.carrying.def, ql: r.carrying.ql ?? 1, dmg: 0, count: r.carrying.count ?? 1 }
          : null;
      }
      /*
       * The leg it is on, put on this machine's clock as it arrives.
       *
       * The island says how long the leg is and how much of it is left; both
       * ends are worked out from `now` here. Nothing has to agree about the
       * time, which is the whole point — the two instants used to travel
       * instead, and a phone a few seconds out pinned every leg at one end and
       * then re-pinned it with the next answer.
       */
      c.legFromX = r.fromX ?? r.x;
      c.legFromY = r.fromY ?? r.y;
      c.legToX = r.toX ?? r.x;
      c.legToY = r.toY ?? r.y;
      const span = (r.legFor ?? 0) * 1000;
      const left = Math.max(0, r.legLeft ?? 0) * 1000;
      if (span > 0) {
        c.legEnds = now + left;
        c.legAt = c.legEnds - span;
      } else {
        c.legAt = 0;
        c.legEnds = 0;
        c.x = r.x;
        c.y = r.y;
      }
    }
    for (const id of [...this.list.keys()]) if (!seen.has(id)) this.list.delete(id);
    return hurt;
  }

  /**
   * Walk everything along the leg the island last gave it.
   *
   * The clock is the browser's, and the two do not have to agree to within
   * anything: a leg that has run out just holds at its far end until the next
   * word arrives, which is a body standing still rather than a body in the
   * wrong place.
   */
  private walkLegs(): void {
    const now = Date.now();
    for (const c of this.list.values()) {
      if (!c.legAt || c.legEnds <= c.legAt) {
        /*
         * A leg of no length is a thing standing still, and it still has to be
         * filed under the tile it is standing on.
         *
         * Reported as "wildermon active with the player are not visible,
         * perhaps those working on deed too", and that is exactly the set: the
         * island parks a companion at its keeper's feet, one kept at the token
         * beside the token, and an idle worker where it stands, each with
         * `leg_at` and `leg_ends` both set to now. This loop is the only thing
         * that fills the tile index while the island owns the wildlife, and it
         * went straight past all three — so `atTile` never returned them and
         * nothing drew them. A wild thing between walks kept its last leg's
         * timestamps and was filed, which is why only tame ones vanished.
         */
        c.moving = false;
        this.place(c);
        continue;
      }
      const t = Math.max(0, Math.min(1, (now - c.legAt) / (c.legEnds - c.legAt)));
      const nx = c.legFromX + (c.legToX - c.legFromX) * t;
      const ny = c.legFromY + (c.legToY - c.legFromY) * t;
      const dx = nx - c.x;
      const dy = ny - c.y;
      c.moving = Math.hypot(dx, dy) > 0.002;
      if (c.moving) {
        c.dirX = dx;
        c.dirY = dy;
        c.walkPhase += Math.hypot(dx, dy) * 6;
      }
      c.x = nx;
      c.y = ny;
      this.place(c);
    }
  }

  remove(id: number): void {
    this.list.delete(id);
  }

  /**
   * Creatures standing on a tile, from the index rebuilt each update. The
   * array is the index's own — read it, do not keep it or reorder it — and an
   * empty tile hands back one shared empty array.
   */
  atTile(x: number, y: number): readonly Creature[] {
    return this.byTile.get(tileKey(x, y)) ?? NOBODY;
  }

  /** How far this one ranges from the token at the skill it has now. */
  rangeFor(c: Creature): number {
    return workRangeOf(c, this.species(c));
  }

  /**
   * The communal part of a channel: what every wildermon working the same
   * settlement — or the same post — lends to all of them, the bearer included.
   * A lead beast standing in the field makes the whole deed quicker.
   */
  aura(c: Creature, channel: TraitChannel): number {
    if (c.mode !== 'deed') return 1;
    let m = 1;
    for (const o of this.list.values()) {
      if (o.mode !== 'deed' || o.post !== c.post) continue;
      m *= auraMul(o.traits, channel);
    }
    return m;
  }

  /** Everything that bears on how fast it moves. */
  speedMul(c: Creature): number {
    return bloodMul(c, 'speed') * this.aura(c, 'speed');
  }

  /** Everything that bears on how fast it gets a task done: blood, herd, and how it is kept. */
  workMul(c: Creature): number {
    return bloodMul(c, 'work') * this.aura(c, 'work') * careMul(c);
  }

  /** Everything that bears on how fast the work goes into it. */
  learnMul(c: Creature): number {
    return bloodMul(c, 'learn') * this.aura(c, 'learn') * careMul(c);
  }

  /** Everything that bears on what it brings home from a trip out. */
  yieldMul(c: Creature): number {
    return bloodMul(c, 'yield') * this.aura(c, 'yield');
  }

  /** Its blood and its herd together on one channel: what a fight rule reads. */
  mul(c: Creature, channel: TraitChannel): number {
    return bloodMul(c, channel) * this.aura(c, channel);
  }

  /** The player's companion. */
  active(): Creature | undefined {
    for (const c of this.list.values()) if (c.mode === 'active') return c;
    return undefined;
  }

  /** The ones shut in creature crates. */
  stored(): Creature[] {
    return [...this.list.values()].filter((c) => c.mode === 'stored');
  }

  /**
   * The wildermon working the settlement itself. One set to a work post is at
   * work too, but not on the deed's books: it costs no settlement slot, which
   * is most of what a post is for. Nor is a young one of the herd, which is
   * not put to work until it is grown and takes no place until then.
   */
  workers(now: number): Creature[] {
    return [...this.list.values()].filter((c) => c.mode === 'deed' && c.post === null && ageDef(c, now).works);
  }

  /** Everything at work anywhere, posts included. */
  working(): Creature[] {
    return [...this.list.values()].filter((c) => c.mode === 'deed');
  }

  wildCount(): number {
    let n = 0;
    for (const c of this.list.values()) if (c.mode === 'wild') n++;
    return n;
  }

  /** Whether a tile is somewhere a creature can walk: passable, dry, in bounds, and no steeper than anything stands on. */
  tileOk(game: Game, x: number, y: number): boolean {
    const w = game.world;
    return w.inBounds(x, y) && w.isPassable(x, y) && w.centerHeight(x, y) >= -1 && standsOn(w, x, y);
  }

  /**
   * Whether a rock face can be worked at all, which is not the same question
   * as whether a body can stand on it.
   *
   * A person may put a pick to a corner under ten units of water — that is
   * `MINE_DEPTH`, about waist deep, and the comment on it says in as many
   * words that you work standing in it. A wildermon could only ever work one
   * under a single unit, because the only question ever asked was whether it
   * could stand there, and a shore face is the whole reason anybody digs at a
   * shore. Reported as a mola that would not touch ore, seam or rock below the
   * tide line.
   *
   * So the same ten units, and a face too deep to stand on is worked from the
   * bank instead — which is what `beside` is for and what a feller, a pruner,
   * an angler and a fruit picker have always done. Past ten it is over
   * everybody's head and nobody swings anything.
   *
   * The tile's own centre rather than one of its corners, which is where this
   * and the person's rule differ and have to: a person puts a pick to a named
   * corner and a worker takes the tile, so the tile's middle is the closest
   * thing it has to the corner being asked about.
   */
  reachableFace(game: Game, x: number, y: number): boolean {
    // Standing on it is still the first answer, and the usual one: dry rock
    // is worked from on top of it exactly as it always was.
    if (this.tileOk(game, x, y)) return true;
    const w = game.world;
    if (!w.inBounds(x, y)) return false;
    // Otherwise the only two questions are how much water is over the face and
    // whether there is a bank to swing from. Its own slope is not asked about
    // — that is a question about standing on it, and nobody is going to.
    if (w.centerHeight(x, y) < -MINE_DEPTH) return false;
    return !!this.beside(game, x, y);
  }

  /**
   * Whether a job is done from the tile beside the one it is done to.
   *
   * A tree, a rod and a fruit bough are always worked from beside, because
   * nothing stands on them. A rock face is worked from beside only when it is
   * standing in water too deep to work from — dry rock is worked from on top
   * of it, as it always was.
   *
   * One function because it used to be two lists that did not agree: the one
   * that chose where to walk had `prune` in it and the one that checked on
   * arrival did not, so a pruner walked to the tile beside a tree and then
   * asked whether the tile it was standing on was a tree worth pruning.
   */
  private worksBeside(game: Game, kind: GatherKind, x: number, y: number): boolean {
    if (kind === 'woodcut' || kind === 'prune' || kind === 'fish' || kind === 'fruit') return true;
    return (kind === 'mine' || kind === 'quarry') && !this.tileOk(game, x, y);
  }

  /**
   * Whether a stretch of ground is the sort a species settles on. A Mola
   * settles over metal, bare or buried, a Crawler on the sand and a Gorral on
   * bare rock; the rest want something growing. Beyond the ground itself a
   * few of them want water, trees, clay or tar within sight of the door, and
   * a Lume wants the sun down.
   */
  suits(game: Game, def: SpeciesDef | undefined, x: number, y: number): boolean {
    if (!def) return false;
    const w = game.world;
    if (def.onOre) {
      if (!isSeam(bedrockAt(w, x, y))) return false;
    } else if (def.onSand) {
      if (w.getTile(x, y) !== TileType.Sand) return false;
    } else if (def.onStone) {
      // Bare rock with nothing in it: the Mola takes the seams, the Quarra the rest.
      if (w.getTile(x, y) !== TileType.Rock || isSeam(bedrockAt(w, x, y))) return false;
    } else if (!TILE_DEFS[w.getTile(x, y)].forage) return false;
    if (def.nearWater && !nearWater(game, x, y)) return false;
    if (def.nearTrees && !nearTrees(game, x, y)) return false;
    if (def.nearClay && !nearClay(game, x, y)) return false;
    if (def.nearTar && !nearTar(game, x, y)) return false;
    if (def.nocturnal && !game.isNight()) return false;
    return true;
  }

  /** Drop wild creatures on grazing land away from the player and the deed. */
  spawnWild(game: Game, count: number, minDistance = 12): number {
    return this.spawnSpecies(game, null, count, minDistance);
  }

  /**
   * Whether anything at all may be put down here: a question about the ground
   * rather than about the species standing on it.
   */
  private groundOk(game: Game, x: number, y: number, minDistance: number): boolean {
    const w = game.world;
    if (!this.tileOk(game, x, y)) return false;
    if (w.centerHeight(x, y) < 2 || game.onDeed(x, y)) return false;
    return Math.hypot(x + 0.5 - game.player.x, y + 0.5 - game.player.y) >= minDistance;
  }

  /**
   * Ground that suits a species, or nothing: `SITE_LOOKS` looks at ground a
   * creature could stand on, given three times that many throws to find them.
   */
  private siteFor(game: Game, id: string, minDistance: number): { x: number; y: number } | null {
    const w = game.world;
    let looks = 0;
    for (let i = 0; i < SITE_LOOKS * 3 && looks < SITE_LOOKS; i++) {
      const x = Math.floor(game.rand() * w.w);
      const y = Math.floor(game.rand() * w.h);
      if (!this.groundOk(game, x, y, minDistance)) continue;
      looks++;
      if (this.suits(game, SPECIES[id], x, y)) return { x, y };
    }
    return null;
  }

  /** As spawnWild, but for one species; pass null to roll the wild mix. */
  spawnSpecies(game: Game, species: string | null, count: number, minDistance = 12): number {
    const w = game.world;
    let placed = 0;
    for (let tries = 0; tries < count * 40 && placed < count; tries++) {
      let x = Math.floor(game.rand() * w.w);
      let y = Math.floor(game.rand() * w.h);
      if (!this.groundOk(game, x, y, minDistance)) continue;
      const id = species ?? (game.rand() < MONSTER_SHARE ? this.pickMonster(game, x, y) : rollTable(WILD_SPECIES, game.rand()));
      if (!id) continue;
      if (!this.suits(game, SPECIES[id], x, y)) {
        /*
         * The roll says what stands up; the ground says where. Throwing the
         * roll away because this tile is wrong for it made a species as common
         * as its weight times the share of the island that suits it, which is
         * how a mola — one in thirty by weight, metal under a seventh of the
         * ground — came out at one in two hundred. A monster keeps the tile it
         * was rolled on: how far it stands from a deed was settled there.
         */
        if (SPECIES[id]?.monster) continue;
        const site = this.siteFor(game, id, minDistance);
        if (!site) continue;
        x = site.x;
        y = site.y;
        tries += SITE_LOOKS;
      }
      // Born at some point in the past, so the country is not all yearlings.
      this.spawn(id, x + 0.5, y + 0.5, 'wild', game.rand, game.time - game.rand() * OLD_AT * 1.6);
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
    this.clearTiles();
    if (this.fromIsland) {
      this.walkLegs();
      return;
    }
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
      // A young one arrives on its own hour, whether or not anybody is looking
      // and whether its dam is out working or standing at the token.
      if (c.due > 0 && game.time >= c.due) this.giveBirth(game, c);
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
      // Held in a trap: it breathes, it heals, it gets hungry. It does not
      // wander off, and it does not fight.
      if (c.trapped !== null) {
        c.enemy = null;
        c.moving = false;
        this.place(c);
        continue;
      }
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
    return wildTargetFor(game.world.w, game.world.h);
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
      if (c.mode !== 'wild' || c.trapped !== null) continue;
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
      // Now and again what stands up out there is not a wildermon at all.
      const id = game.rand() < MONSTER_SHARE ? this.pickMonster(game, x, y) : rollTable(WILD_SPECIES, game.rand());
      if (!id || !this.suits(game, SPECIES[id], x, y)) continue;
      this.spawn(id, x + 0.5, y + 0.5, 'wild', game.rand, game.time - game.rand() * OLD_AT * 1.6);
      return true;
    }
    return false;
  }

  /**
   * Which of the bad things, if any. Each sort is capped across the island and
   * the big ones keep away from anywhere anybody lives: nothing walks out of
   * the trees onto your deed.
   */
  private pickMonster(game: Game, x: number, y: number): string | null {
    const alive: Record<string, number> = {};
    for (const c of this.list.values()) if (c.mode === 'wild') alive[c.species] = (alive[c.species] ?? 0) + 1;
    const room = MONSTERS.filter(([id]) => (alive[id] ?? 0) < (MONSTER_CAP[id] ?? 1));
    if (!room.length) return null;
    const id = rollTable(room, game.rand());
    // A settlement keeps the worst of it at arm's length. The bigger the
    // thing, the further out it wants to be.
    const deed = game.deed;
    if (deed) {
      const want = id === 'dragon' ? 90 : id === 'ogre' ? 55 : id === 'orc' ? 40 : 26;
      if (Math.hypot(x - deed.x, y - deed.y) < want) return null;
    }
    return id;
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
    const top = maxHealth(c, def);
    if (c.health > top) c.health = top;
    else if (c.health < top && game.time - c.attackedAt > 6) c.health = Math.min(top, c.health + elapsed * (c.mode === 'wild' ? 0.25 : 0.6) * bloodMul(c, 'mend'));
    // A yearling grows no fleece and gives no milk; an old one is slower at both.
    const growth = ageDef(c, game.time).growth;
    if (def.fleece && growth > 0 && c.fleece < 1) c.fleece = Math.min(1, c.fleece + elapsed * def.fleece * growth * bloodMul(c, 'grow'));
    // A brushing wears off over a few hours of being left to itself.
    if (c.care > 0) c.care = Math.max(0, c.care - elapsed * CARE_DECAY);
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
    const key = tileKey(Math.floor(c.x), Math.floor(c.y));
    let arr = this.byTile.get(key);
    if (!arr) {
      arr = [];
      this.byTile.set(key, arr);
    }
    if (!arr.length) this.filled.push(key);
    arr.push(c);
  }

  /**
   * Empty the tile index for the tick about to be filled.
   *
   * Only the tiles that were written to, and the arrays are kept: a creature
   * that is standing still stands on the same tile next frame, so the array is
   * wanted again in a moment. The whole map goes only when it has grown past
   * what any one tick could want, which is a herd having wandered over a great
   * deal of country since the map was last thrown away.
   */
  private clearTiles(): void {
    if (this.byTile.size > TILE_SLACK) {
      this.byTile.clear();
      this.filled.length = 0;
      return;
    }
    for (const key of this.filled) {
      const arr = this.byTile.get(key);
      if (arr) arr.length = 0;
    }
    this.filled.length = 0;
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
    game.hurtPlayer(attackOf(c, def) * 0.012, `${c.name} rounds on you and gets a claw in`, def.wound ?? 'bite');
  }

  private stepToward(game: Game, c: Creature, tx: number, ty: number, dt: number, speedMul = 1): MoveResult {
    const dx = tx - c.x;
    const dy = ty - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.12) return 'arrived';
    const pace = c.mode === 'deed' ? 1 + Math.max(1, ...Object.values(c.skills)) / 500 : 1;
    const step = Math.min(this.species(c).speed * ageDef(c, game.time).speed * this.speedMul(c) * speedMul * pace * dt, dist);
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
      if (game.buildings.blocksAt(0, fX, fY, tX, tY, true)) return false;
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

  /**
   * Whether a tile can be foraged, botanized, felled, farmed or mined right now.
   *
   * The floor under the two mining trades is the person's floor — ten units of
   * water, `MINE_DEPTH` — and not the waterline. It read `rockHeight > 1`,
   * which is a waterline rule wearing the clothes of an "is there any rock
   * here" one: bedrock at minus three is bedrock three under the sea, so every
   * tile under water failed it however shallow, and no depth allowance
   * anywhere else could have helped. A person has no such rule; their pick
   * stops at ten under and so does this.
   */
  /**
   * Whether a tile is this kind of work, which `shore.ts` asks of both sides
   * over the same ground — so it is open the way `reachableFace` is, and for
   * the same reason.
   */
  gatherable(game: Game, x: number, y: number, kind: GatherKind, c?: Creature): boolean {
    if (kind === 'mine') {
      // One seam to a miner, and only metal its skill can work.
      const ore = oreAt(game.world, x, y);
      if (!ore || (c && (c.skills[GATHER_SKILL.mine] ?? 1) < ore.level)) return false;
      return game.world.rockHeight(x, y) > -MINE_DEPTH && this.reachableFace(game, x, y) && !this.claimed(x, y, c);
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
      if (game.world.getTile(x, y) !== TileType.Rock || isSeam(rock)) return false;
      return game.world.rockHeight(x, y) > -MINE_DEPTH && this.reachableFace(game, x, y) && !this.claimed(x, y, c);
    }
    if (kind === 'peat') {
      // A bed of the black stuff, taken off the top and left as it was.
      const t = game.world.getTile(x, y);
      if (t !== TileType.Peat && t !== TileType.Tar) return false;
      return this.tileOk(game, x, y) && !game.isForaged(x, y, 'dig') && !this.claimed(x, y, c);
    }
    if (kind === 'reed') {
      if (game.world.getTile(x, y) !== TileType.Reed) return false;
      return !game.isForaged(x, y, 'reed') && !!this.beside(game, x, y) && !this.claimed(x, y, c);
    }
    if (kind === 'fish') {
      // Water with depth in it, and a bank beside it to stand a rod on.
      if (!fishable(game, x, y)) return false;
      return !game.isForaged(x, y, 'reed') && !!this.beside(game, x, y) && !this.claimed(x, y, c);
    }
    if (kind === 'seek') {
      // Ground nobody has been over yet, which is the only ground worth a nose.
      if (game.world.hasWater(x, y) || !DIGGABLE.has(game.world.getTile(x, y))) return false;
      return this.tileOk(game, x, y) && !game.isForaged(x, y, 'dig') && !this.claimed(x, y, c);
    }
    if (kind === 'fetch') {
      // Anything lying on the deed that is not already somebody's errand.
      if (!game.onDeed(x, y) || !game.groundAt(x, y).length) return false;
      return this.tileOk(game, x, y) && !this.claimed(x, y, c);
    }
    if (kind === 'farm') return !!c && this.farmJobAt(game, c, x, y) !== null;
    if (kind === 'woodcut') return game.world.getTile(x, y) === TileType.Tree && !!this.beside(game, x, y);
    if (kind === 'prune') {
      // What would otherwise die: a stage that prunes back and whose next
      // stage has no life in it. Nothing else is touched — a mature tree
      // pruned stops bearing, and a sapling pruned is a shrub for good.
      if (game.world.getTile(x, y) !== TileType.Tree || !this.beside(game, x, y)) return false;
      const age = treeAge(game.world.getData(x, y));
      return age.pruned !== null && age.next !== null && !TREE_AGES[age.next].alive;
    }
    if (kind === 'fruit') {
      // A bearing tree with something on it, and a tile beside it to stand on.
      if (game.world.getTile(x, y) !== TileType.Tree || !this.beside(game, x, y)) return false;
      const data = game.world.getData(x, y);
      const age = treeAge(data);
      return !!TREE_DEFS[treeSpecies(data)].fruit && age.bears && age.alive && !game.isForaged(x, y, 'forage') && !this.claimed(x, y, c);
    }
    if (kind === 'stump') return game.world.getTile(x, y) === TileType.Stump && this.tileOk(game, x, y);
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
      // A tree is never walkable, so a feller or a pruner judges the tile beside it instead.
      if (kind !== 'woodcut' && kind !== 'prune' && !this.tileOk(game, x, y)) return;
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
    c.until = game.time + (c.mode === 'deed' ? workDuration(c.skills[GATHER_SKILL[kind]] ?? 1) / this.workMul(c) : FORAGE_TIME);
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
    if (kind === 'prune') return this.finishPruning(game, c);
    if (kind === 'stump') return this.finishStumping(game, c);
    if (kind === 'farm') return this.finishFarming(game, c, x, y);
    if (kind === 'mine') return this.finishMining(game, c);
    if (kind === 'sand' || kind === 'clay') return this.finishDigging(game, c, kind === 'sand' ? 'sand' : 'clay');
    if (kind === 'stoke' || kind === 'guard') return null;
    if (kind === 'quarry') return this.finishQuarry(game, c);
    if (kind === 'peat') return this.finishPeat(game, c);
    if (kind === 'reed') return this.finishReed(game, c);
    if (kind === 'fruit') return this.finishFruit(game, c);
    if (kind === 'fish') return this.finishFish(game, c);
    if (kind === 'seek') return this.finishSeek(game, c);
    if (kind === 'fetch') return this.finishFetch(game, c);
    game.markForaged(x, y, kind);
    const table = GATHER_TABLE[kind];
    // An errand has no table to roll on: it is done where it is done, and
    // whatever it produced was handed over there.
    if (!table.length) return null;
    if (c.mode !== 'deed') {
      if (game.rand() < 0.25) return null;
      const id = rollTable(table, game.rand());
      return { uid: game.inventory.nextUid++, id, ql: 5 + game.rand() * 30, dmg: 0, count: 1 };
    }
    const skillId = GATHER_SKILL[kind];
    const skill = c.skills[skillId] ?? 1;
    this.gainSkill(game, c, skillId, 0.225);
    const careful = this.yieldMul(c);
    const chance = Math.min(0.98, Math.max(0.3, 0.6 + (skill / 100) * 0.38 - 5 / 150) * careful);
    if (game.rand() < 0.2 || game.rand() >= chance) return null;
    const id = rollTable(table, game.rand());
    const ql = Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1) * careful);
    return { uid: game.inventory.nextUid++, id, ql, dmg: 0, count: 1 };
  }

  /** Fell the tree a worker walked to, and hand it the log it carries home. */
  private finishFelling(game: Game, c: Creature): Item | null {
    const tx = c.workX;
    const ty = c.workY;
    if (game.world.getTile(tx, ty) !== TileType.Tree) return null;
    const data = game.world.getData(tx, ty);
    const def = TREE_DEFS[treeSpecies(data)];
    const age = treeAge(data);
    const skill = c.skills[GATHER_SKILL.woodcut] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.woodcut, 0.225);
    // A worker swings the same number of times a person would, and the notch
    // it leaves is the same notch: anybody may finish the tree it started.
    const cuts = game.world.notchAt(tx, ty) + 1;
    if (cuts < age.hits) {
      game.world.setNotch(tx, ty, cuts);
      return null;
    }
    const logs = age.logs;
    // A tree with timber in it leaves a stump, as it does under a hatchet.
    game.world.setTile(tx, ty, logs ? TileType.Stump : TileType.Grass, logs ? packTreeData(treeSpecies(data), 0) : 0);
    if (!logs) return null;
    const ql = Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1));
    // The rest of the tree is left at the stump; it can only carry one at a time.
    if (logs > 1) {
      game.dropOnGround(tx, ty, { uid: game.inventory.nextUid++, id: 'log', ql, dmg: 0, count: logs - 1, extra: def.name });
    }
    return { uid: game.inventory.nextUid++, id: 'log', ql, dmg: 0, count: 1, extra: def.name };
  }

  /** Prune the tree a forester walked to back a stage. It carries nothing home. */
  private finishPruning(game: Game, c: Creature): Item | null {
    const tx = c.workX;
    const ty = c.workY;
    if (game.world.getTile(tx, ty) !== TileType.Tree) return null;
    const data = game.world.getData(tx, ty);
    const age = treeAge(data);
    if (age.pruned === null) return null;
    this.gainSkill(game, c, GATHER_SKILL.prune, 0.225);
    // The age and nothing else, as under a sickle: the species stays, and so
    // does any notch, since the tile is still a tree.
    game.world.setTile(tx, ty, TileType.Tree, packTreeData(treeSpecies(data), age.pruned));
    return null;
  }

  /** Dig out the stump a forester walked to. Bare dirt where it stood. */
  private finishStumping(game: Game, c: Creature): Item | null {
    const tx = c.workX;
    const ty = c.workY;
    if (game.world.getTile(tx, ty) !== TileType.Stump) return null;
    this.gainSkill(game, c, GATHER_SKILL.stump, 0.225);
    game.world.setTile(tx, ty, TileType.Dirt);
    return null;
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
    if (w.getTile(c.workX, c.workY) !== TileType.Rock || isSeam(rock)) return null;
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

  /** Cut a shovel of peat or tar without touching the shape of the bog. */
  private finishPeat(game: Game, c: Creature): Item | null {
    const t = game.world.getTile(c.workX, c.workY);
    const id = t === TileType.Tar ? 'tar' : t === TileType.Peat ? 'peat' : null;
    if (!id) return null;
    const skill = c.skills[GATHER_SKILL.peat] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.peat, 0.225);
    game.markForaged(c.workX, c.workY, 'dig');
    return { uid: game.inventory.nextUid++, id, ql: Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1)), dmg: 0, count: 1 };
  }

  /**
   * A cast off the bank. What comes up follows the same table the player's
   * rod does, only the depth is whatever the worker walked to.
   */
  private finishFish(game: Game, c: Creature): Item | null {
    const skill = c.skills[GATHER_SKILL.fish] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.fish, 0.225);
    game.markForaged(c.workX, c.workY, 'reed');
    const depth = waterDepth(game, c.workX, c.workY);
    const pool = fishHere(depth, skill);
    if (!pool.length || game.rand() > Math.min(0.9, 0.3 + skill / 190)) return null;
    let total = 0;
    for (const f of pool) total += f.weight;
    let roll = game.rand() * total;
    let got = pool[0];
    for (const f of pool) {
      roll -= f.weight;
      if (roll <= 0) {
        got = f;
        break;
      }
    }
    return { uid: game.inventory.nextUid++, id: got.id, ql: Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1)), dmg: 0, count: 1 };
  }

  /**
   * Pick what a bearing tree has on it, as many as a person's hands would
   * take: an old tree carries more than one only just come into bearing.
   * The tree is left picked for the day, as it is behind a person.
   */
  private finishFruit(game: Game, c: Creature): Item | null {
    if (game.world.getTile(c.workX, c.workY) !== TileType.Tree) return null;
    const data = game.world.getData(c.workX, c.workY);
    const def = TREE_DEFS[treeSpecies(data)];
    const age = treeAge(data);
    if (!def.fruit || !age.bears || !age.alive) return null;
    const skill = c.skills[GATHER_SKILL.fruit] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.fruit, 0.225);
    game.markForaged(c.workX, c.workY, 'forage');
    const old = age.id === 2 || age.id === 4;
    const count = Math.max(1, Math.round((old ? 5 : 3) * (0.5 + skill / 130) * (0.7 + game.rand() * 0.6)));
    return { uid: game.inventory.nextUid++, id: def.fruit, ql: Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1)), dmg: 0, count };
  }

  /** Shear a stand of reeds back to the water, as the player's knife would. */
  private finishReed(game: Game, c: Creature): Item | null {
    if (game.world.getTile(c.workX, c.workY) !== TileType.Reed) return null;
    const skill = c.skills[GATHER_SKILL.reed] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.reed, 0.225);
    game.markForaged(c.workX, c.workY, 'reed');
    const count = 1 + Math.floor(skill / 35);
    return { uid: game.inventory.nextUid++, id: 'reed', ql: Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1)), dmg: 0, count };
  }

  /** Nose through a patch of soil for something worked and long buried. */
  private finishSeek(game: Game, c: Creature): Item | null {
    const skill = c.skills[GATHER_SKILL.seek] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.seek, 0.225);
    game.markForaged(c.workX, c.workY, 'dig');
    if (game.rand() > findChance(skill, 30)) return null;
    const within = relicsWithin(skill);
    if (!within.length) return null;
    const relic = within[Math.floor(game.rand() * within.length)];
    const part = 1 + Math.floor(game.rand() * relic.parts);
    const ql = Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8)));
    return {
      uid: game.inventory.nextUid++,
      id: 'fragment',
      ql,
      dmg: 20 + game.rand() * 45,
      count: 1,
      extra: `${relic.name} ${part}/${relic.parts}`,
    };
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
    /*
     * Harvest: the crop is carried to the crate and the seed rides home in its
     * cheeks to go in after it. Seed of some other crop still in there — which
     * takes two harvests without a trip home in between, and so almost never
     * happens now the cheeks are emptied at every store — is left on the field
     * for the next sowing, or for whoever is clearing up, to find.
     */
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
  /**
   * The errand jobs: the ones that do not come home with a load of something.
   *
   * Each is the same shape — look for a thing worth doing inside the range the
   * worker has earned, walk to it, do one unit of it — and each returns true
   * while it has work in hand, so the ordinary worker loop leaves it alone.
   */
  private errandStep(game: Game, c: Creature, dt: number, kind: GatherKind, deed: WorkSite): boolean {
    const def = this.species(c);
    const range = siteRange(c, def, deed);
    const goto = (tx: number, ty: number, reach = 1.3): boolean => {
      if (Math.hypot(tx - c.x, ty - c.y) <= reach) return true;
      if (this.stepToward(game, c, tx, ty, dt) === 'blocked') {
        // There is no way through to it: drop the spot and pick another.
        c.workX = -1;
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return false;
    };
    const near = (x: number, y: number): boolean => Math.max(Math.abs(x - deed.x), Math.abs(y - deed.y)) <= range;

    if (kind === 'water') return this.waterStep(game, c, dt, range, goto, near);
    if (kind === 'hod') return this.hodStep(game, c, dt, goto, near);
    if (kind === 'mend') return this.mendStep(game, c, goto);
    if (kind === 'plant') return this.plantStep(game, c, goto, near, range, deed);
    if (kind === 'prospect') return this.prospectStep(game, c, goto, near, range, deed);
    if (kind === 'compost') return this.compostStep(game, c, goto, near);
    return false;
  }

  /**
   * Carrying water. A pouch is filled at the shore or out of a well and poured
   * into whichever barrel on the deed has room for it, which is the errand
   * nobody wants to run themselves.
   */
  private waterStep(
    game: Game,
    c: Creature,
    dt: number,
    range: number,
    goto: (x: number, y: number, reach?: number) => boolean,
    near: (x: number, y: number) => boolean,
  ): boolean {
    const full = c.carrying?.id === 'water_bucket';
    const vessel = game.thirstyVessel();
    if (!vessel) return false;
    if (full) {
      const [vx, vy] = furnitureCentre(vessel);
      if (!goto(vx, vy)) return true;
      game.pourInto(vessel, BUCKET_LITRES, 'water');
      c.carrying = null;
      this.gainSkill(game, c, GATHER_SKILL.water, 0.2);
      c.state = 'idle';
      c.until = game.time + 0.5;
      return true;
    }
    const source = game.waterSource(c.x, c.y, range, near);
    if (!source) return false;
    if (!goto(source.x, source.y, 1.5)) return true;
    if (source.well) game.drawFromWell(source.well, BUCKET_LITRES);
    c.carrying = { uid: game.inventory.nextUid++, id: 'water_bucket', ql: 40, dmg: 0, count: 1 };
    return true;
  }

  /** Carrying the hod: one piece of a planned wall at a time, out of the stores. */
  private hodStep(
    game: Game,
    c: Creature,
    dt: number,
    goto: (x: number, y: number, reach?: number) => boolean,
    near: (x: number, y: number) => boolean,
  ): boolean {
    const job = game.wallNeeding(near, c.carrying?.id);
    if (!job) {
      c.carrying = null;
      return false;
    }
    if (!c.carrying) {
      const store = game.deedStores().find((st) => st.items.some((it: Item) => it.id === job.item));
      const stock = store?.items.find((it: Item) => it.id === job.item);
      if (!store || !stock) return false;
      const [sx, sy] = store.centre;
      if (!goto(sx, sy)) return true;
      stock.count -= 1;
      if (stock.count <= 0) store.items.splice(store.items.indexOf(stock), 1);
      store.changed();
      c.carrying = { uid: game.inventory.nextUid++, id: job.item, ql: stock.ql, dmg: 0, count: 1 };
      return true;
    }
    if (!goto(job.x + 0.5, job.y + 0.5, 1.6)) return true;
    game.fitIntoWall(job.wall, c.carrying.id);
    c.carrying = null;
    this.gainSkill(game, c, GATHER_SKILL.hod, 0.25);
    return true;
  }

  /** Mending: it works at the stores, on whatever in them is knocked about. */
  private mendStep(game: Game, c: Creature, goto: (x: number, y: number, reach?: number) => boolean): boolean {
    const found = game.damagedInStores();
    if (!found) return false;
    const [sx, sy] = found.store.centre;
    if (!goto(sx, sy)) return true;
    const skill = c.skills[GATHER_SKILL.mend] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.mend, 0.2);
    // The same bargain the player's own repair makes: damage out, a little
    // quality with it, and a better hand loses less of it.
    found.item.dmg = Math.max(0, found.item.dmg - (2 + skill / 12));
    found.item.ql = Math.max(1, found.item.ql - Math.max(0.05, 0.6 - skill / 220));
    found.store.changed();
    c.busyUntil = game.time + 1.5;
    return true;
  }

  /** Planting: a sprout out of the stores, put in where the wood has gone. */
  private plantStep(
    game: Game,
    c: Creature,
    goto: (x: number, y: number, reach?: number) => boolean,
    near: (x: number, y: number) => boolean,
    range: number,
    deed: { x: number; y: number },
  ): boolean {
    if (!c.carrying) {
      const store = game.deedStores().find((st) => st.items.some((it: Item) => it.id === 'sprout'));
      const sprout = store?.items.find((it: Item) => it.id === 'sprout');
      if (!store || !sprout) return false;
      const [sx, sy] = store.centre;
      if (!goto(sx, sy)) return true;
      sprout.count -= 1;
      if (sprout.count <= 0) store.items.splice(store.items.indexOf(sprout), 1);
      store.changed();
      c.carrying = { uid: game.inventory.nextUid++, id: 'sprout', ql: sprout.ql, dmg: 0, count: 1, extra: sprout.extra };
      return true;
    }
    if (c.carrying.id !== 'sprout') return false;
    if (c.workX < 0 || !game.plantableTile(c.workX, c.workY)) {
      const spot = game.plantingSpot(deed.x, deed.y, range, near, c.x, c.y);
      if (!spot) return false;
      c.workX = spot.x;
      c.workY = spot.y;
    }
    if (!goto(c.workX + 0.5, c.workY + 0.5)) return true;
    game.plantSprout(c.workX, c.workY, c.carrying.extra);
    c.carrying = null;
    c.workX = -1;
    this.gainSkill(game, c, GATHER_SKILL.plant, 0.25);
    return true;
  }

  /** Reading the ground: it walks the country and marks what is under it. */
  private prospectStep(
    game: Game,
    c: Creature,
    goto: (x: number, y: number, reach?: number) => boolean,
    near: (x: number, y: number) => boolean,
    range: number,
    deed: { x: number; y: number },
  ): boolean {
    if (c.workX < 0) {
      const spot = game.unreadGround(deed.x, deed.y, range, near, c.x, c.y);
      if (!spot) return false;
      c.workX = spot.x;
      c.workY = spot.y;
    }
    if (!goto(c.workX + 0.5, c.workY + 0.5)) return true;
    const skill = c.skills[GATHER_SKILL.prospect] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.prospect, 0.22);
    game.readGround(c, c.workX, c.workY, 2 + Math.floor(skill / 20));
    c.workX = -1;
    c.busyUntil = game.time + 2;
    return true;
  }

  /** Clearing up: what is rotting on the ground goes back to the fields. */
  private compostStep(
    game: Game,
    c: Creature,
    goto: (x: number, y: number, reach?: number) => boolean,
    near: (x: number, y: number) => boolean,
  ): boolean {
    if (c.carrying) return false;
    const rot = game.rottingNear(near);
    if (!rot) return false;
    if (!goto(rot.x + 0.5, rot.y + 0.5)) return true;
    const [taken] = game.takeFromGround(rot.x, rot.y, rot.uid);
    if (!taken) return true;
    this.gainSkill(game, c, GATHER_SKILL.compost, 0.2);
    // Whatever it was, what comes back is compost, and the more of it the better.
    c.carrying = { uid: game.inventory.nextUid++, id: 'compost', ql: Math.min(100, 20 + (c.skills[GATHER_SKILL.compost] ?? 1) * 0.6), dmg: 0, count: Math.max(1, Math.round(taken.count / 2)) };
    return true;
  }

  /** Nothing else to do: walk the border, and look again in a moment. */

  private stokeStep(game: Game, c: Creature, dt: number, site: WorkSite): boolean {
    const def = this.species(c);
    const hearth = this.coldHearth(game, c, siteRange(c, def, site));
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
  private defendDeed(game: Game, c: Creature, dt: number, deed: WorkSite): boolean {
    if (c.stance === 'passive') {
      c.enemy = null;
      return false;
    }
    const range = deed.radius + 1;
    const inside = (o: Creature): boolean => Math.max(Math.abs(o.x - deed.x), Math.abs(o.y - deed.y)) <= range;
    if (c.enemy !== null && c.enemy !== PLAYER_ATTACKER) {
      const e = this.list.get(c.enemy);
      if (!e || !quarry(e) || !inside(e)) c.enemy = null;
      else {
        if (Math.hypot(e.x - c.x, e.y - c.y) <= 1) {
          if (c.cooldown <= 0) {
            this.attack(game, c, e);
            c.cooldown = 1.2 / this.mul(c, 'haste');
          }
        } else if (this.stepToward(game, c, e.x, e.y, dt, 1.3) === 'blocked') c.enemy = null;
        return true;
      }
    }
    if (game.time < c.searchAt) return false;
    c.searchAt = game.time + 1.5;
    const recent = (at: number): boolean => game.time - at < BLOW_MEMORY;
    let best: Creature | null = null;
    let bestD = Infinity;
    for (const o of this.list.values()) {
      if (o.id === c.id || !quarry(o) || !inside(o)) continue;
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
    game.logMsg(`${c.name} breaks off and goes for the ${this.species(best).name.toLowerCase()} on the deed.`, 'fight');
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
  private packHunt(game: Game, c: Creature, dt: number, deed: WorkSite): boolean {
    const def = this.species(c);
    const range = siteRange(c, def, deed);
    if (c.enemy !== null) {
      const e = this.list.get(c.enemy);
      const gone = !e || !quarry(e) || Math.max(Math.abs(e.x - deed.x), Math.abs(e.y - deed.y)) > range + 4;
      if (gone) c.enemy = null;
      else {
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        if (d <= 1.1) {
          if (c.cooldown <= 0) {
            this.attack(game, c, e);
            c.cooldown = 1.1 / this.mul(c, 'haste');
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
        const gx = keyX(key);
        const gy = keyY(key);
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
        if (o.id === c.id || !quarry(o)) continue;
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

  private guardStep(game: Game, c: Creature, dt: number, deed: WorkSite): void {
    const range = deed.radius + 1;
    if (c.enemy !== null) {
      const e = this.list.get(c.enemy);
      const gone = !e || !quarry(e) || Math.max(Math.abs(e.x - deed.x), Math.abs(e.y - deed.y)) > range + 3;
      if (gone) c.enemy = null;
      else {
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        if (d <= 1) {
          if (c.cooldown <= 0) {
            this.attack(game, c, e);
            c.cooldown = 1.2 / this.mul(c, 'haste');
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
        if (o.id === c.id || !quarry(o)) continue;
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

  /**
   * Put two together. What the pairing throws is settled here and now, at the
   * covering, and carried by the dam: a sire that is sold, released or eaten
   * before the hour comes has already had his say.
   */
  pair(game: Game, dam: Creature, sire: Creature, husbandry: number): void {
    const care = (dam.care + sire.care) / 2;
    dam.unborn = { traits: breedTraits(sire.traits, dam.traits, husbandry, care, game.rand), sex: game.rand() < 0.5 ? 'male' : 'female' };
    dam.due = game.time + GESTATION;
    dam.bredAt = game.time;
    sire.bredAt = game.time;
  }

  /** The hour comes. */
  giveBirth(game: Game, dam: Creature): Creature | null {
    const coming = dam.unborn;
    dam.unborn = null;
    dam.due = 0;
    if (!coming) return null;
    const def = this.species(dam);
    /*
     * Where it goes, now that nothing is kept at the token. A dam let go before
     * her hour drops a wild one. Otherwise it joins the herd of your
     * settlement, beside its dam when she is out and at the token when she is
     * shut in a crate, and is not put to work until it is grown. Without a
     * settlement it follows you when nothing else does, and goes into an empty
     * creature crate you carry when something does. With none of those it
     * goes off into the wild.
     */
    const crate = dam.mode !== 'wild' && !game.deed && this.active() ? emptyCrate(game) : undefined;
    let mode: CreatureMode = 'wild';
    let at: [number, number] = [dam.x, dam.y];
    let where = '';
    if (dam.mode === 'wild') {
      // Hers, and she is nobody's.
    } else if (game.deed) {
      mode = 'deed';
      if (dam.mode === 'stored') at = [game.deed.x + 0.5, game.deed.y + 1.5];
      where = ` It joins the herd of ${game.deed.name}, and is put to work when it is grown.`;
    } else if (!this.active()) {
      mode = 'active';
      at = [game.player.x, game.player.y];
      where = ' It follows you.';
    } else if (crate) {
      mode = 'stored';
      where = ' It goes into the creature crate in your pack.';
    } else {
      where = ' You have no settlement, something already follows you and you carry no empty creature crate, so it goes off into the wild.';
    }
    const c = this.spawn(dam.species, at[0], at[1], mode, game.rand, game.time);
    c.traits = coming.traits;
    c.sex = coming.sex;
    c.hunger = 0.9;
    c.care = 0.5;
    c.health = maxHealth(c, def);
    if (crate) shutIn(game, c, crate);
    game.logMsg(`${dam.name} drops a young ${def.name.toLowerCase()} (${SEX_NAMES[c.sex]}): ${traitList(c.traits)}.${where}`, 'event');
    game.note('bred');
    if (c.traits.some((t) => traitTier(t) === 'supreme' || traitTier(t) === 'fantastic')) game.note('goodblood');
    game.events.emit('creature');
    return c;
  }

  /** Same diminishing curve as the player's skills. */
  gainSkill(game: Game, c: Creature, id: string, base: number): number {
    const v = c.skills[id] ?? 1;
    // A beast learns on the same curve a player does, and crawls the same last
    // stretch of it.
    const gain = skillGain(v, base * this.learnMul(c), 0.6 + 0.8 * game.rand());
    const before = creatureLevel(c);
    const beforeSteps = rangeSteps(v);
    c.skills[id] = Math.min(100, v + gain);
    c.xp += gain;
    if (creatureLevel(c) > before) game.logMsg(`${c.name} reaches level ${creatureLevel(c)}.`, 'skill');
    const def = this.species(c);
    if (c.mode === 'deed' && id === workSkill(def) && rangeSteps(c.skills[id]) > beforeSteps) {
      game.logMsg(`${c.name} knows the land better and will now work up to ${workRangeOf(c, def)} tiles from where it is set to work.`, 'skill');
    }
    return gain;
  }

  private updateWild(c: Creature, dt: number, game: Game): void {
    c.hunger = Math.max(0, c.hunger - dt * HUNGER_RATE.wild * bloodMul(c, 'appetite'));
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
        if (food && isBaitFor(def, food.id)) c.hunger = Math.min(1, c.hunger + GRAZE_FILL);
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
    if (kind && c.hunger < GRAZE_HUNGRY && game.time >= c.searchAt) {
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
        c.until = game.time + WILD_REST + game.rand() * WILD_REST_SPREAD;
      }
      return;
    }
    /*
     * A step about its own country, rather than a step from wherever it last
     * got to. Past the edge of its range it turns for home instead, which is
     * what keeps an island's wildlife somewhere in particular.
     */
    if (game.time >= c.until) {
      if (Math.hypot(c.x - c.homeX, c.y - c.homeY) > WILD_RANGE) this.wanderTarget(game, c, WILD_REACH, c.homeX, c.homeY);
      else this.wanderTarget(game, c, WILD_REACH);
    }
  }

  /**
   * A hunter closing on the player. It gives up when you get far enough away
   * or when it has been badly enough hurt to think better of it.
   */
  private huntStep(game: Game, c: Creature, def: SpeciesDef, dt: number): boolean {
    const p = game.player;
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    const hunting = c.enemy === PLAYER_ATTACKER;
    const giveUp = def.monster ? HUNT_GIVE_UP * 2.2 : HUNT_GIVE_UP;
    /*
     * Two measures, and the first to run out ends it. How far it has come
     * from where the chase began is the one that grows while it chases — the
     * gap to you does not, because it is closing that — and how far it is
     * from its own home ground is what stops a hunter that had already
     * strayed from taking you another thirty tiles beyond where it strayed
     * to.
     */
    const came = Math.hypot(c.x - c.huntX, c.y - c.huntY);
    const out = Math.hypot(c.x - c.homeX, c.y - c.homeY);
    const spent = came > HUNT_LEASH || out > HUNT_HOME;
    if (hunting && (d > giveUp || spent
                    || c.health < maxHealth(c, def) * (def.monster ? 0.08 : 0.3))) {
      c.enemy = null;
      if (spent) {
        c.huntRest = game.time + HUNT_REST;
        // And back to its own country, rather than standing wherever it
        // happened to stop. A hunter that gave up ten valleys from home and
        // stayed there is how a range stops meaning anything.
        c.tx = c.homeX;
        c.ty = c.homeY;
        c.state = 'wander';
      }
      return false;
    }
    if (!hunting) {
      if (d > (def.notice ?? HUNT_SIGHT) || game.time < c.searchAt || game.time < c.huntRest) return false;
      c.searchAt = game.time + 2;
      if (!this.tileOk(game, Math.floor(p.x), Math.floor(p.y))) return false;
      c.enemy = PLAYER_ATTACKER;
      c.huntX = c.x;
      c.huntY = c.y;
      game.logMsg(`A ${def.name.toLowerCase()} has your scent.`, 'fight');
    }
    if (d <= 1.1) {
      if (c.cooldown <= 0) {
        c.cooldown = 1.4 / this.mul(c, 'haste');
        p.attackedBy = c.id;
        p.attackedAt = game.time;
        game.hurtPlayer(attackOf(c, def) * 0.012, `The ${def.name.toLowerCase()} is on you`, def.wound ?? 'bite');
      }
      return true;
    }
    if (this.stepToward(game, c, p.x, p.y, dt, 1.15) === 'blocked') c.enemy = null;
    return true;
  }

  private updateActive(c: Creature, dt: number, game: Game): void {
    c.hunger = Math.max(0, c.hunger - dt * HUNGER_RATE.active * bloodMul(c, 'appetite'));
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
      let found: Creature | null = null;
      if (c.stance === 'aggressive') {
        let bestD = Infinity;
        for (const o of this.list.values()) {
          if (o.id === c.id || !quarry(o)) continue;
          const d = Math.hypot(o.x - p.x, o.y - p.y);
          if (d <= COMPANION_SIGHT && d < bestD) {
            bestD = d;
            found = o;
          }
        }
      } else {
        const recent = (at: number): boolean => game.time - at < BLOW_MEMORY;
        const threat = recent(c.attackedAt) ? c.attackedBy : recent(p.attackedAt) ? p.attackedBy : null;
        const t = threat === null ? undefined : this.list.get(threat);
        // Only something wild: a worker of your own that nipped you is not a fight for it.
        if (t && t.id !== c.id && quarry(t)) found = t;
      }
      if (found) {
        c.enemy = found.id;
        game.logMsg(`${c.name} goes for the ${this.species(found).name.toLowerCase()}.`, 'fight');
      }
    }
    if (c.enemy !== null) {
      const e = c.enemy === PLAYER_ATTACKER ? undefined : this.list.get(c.enemy);
      if (!e || !quarry(e) || Math.hypot(e.x - p.x, e.y - p.y) > COMPANION_LEASH) {
        c.enemy = null;
      } else {
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        if (d <= COMPANION_REACH) {
          if (c.cooldown <= 0) {
            this.attack(game, c, e);
            c.cooldown = COMPANION_BLOW / this.mul(c, 'haste');
          }
        } else if (this.stepToward(game, c, e.x, e.y, dt, COMPANION_PACE) === 'blocked') {
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

  /**
   * A hungry wildermon on a deed helps itself from the stores.
   *
   * A wild one walks to a forage bed and grazes; one kept inside a border has
   * no bed to walk to and, until now, nothing else either — a penned animal
   * simply starved beside a crate of the very thing it eats. It takes the
   * plainest thing in there first, because the good stuff keeps for people.
   *
   * Only what its own kind eats: `isBaitFor` is the same diet that decides
   * what will tame one, and is crossed into `species_diet` for the island.
   */
  private feedFromStores(game: Game, c: Creature, site: { x: number; y: number; radius: number }): boolean {
    const def = this.species(c);
    for (const crate of game.crates.values()) {
      if (Math.abs(crate.x - site.x) > site.radius || Math.abs(crate.y - site.y) > site.radius) continue;
      let worst: Item | undefined;
      for (const it of crate.items ?? []) {
        if (!isBaitFor(def, it.id)) continue;
        if (!worst || it.ql < worst.ql) worst = it;
      }
      if (!worst) continue;
      if (worst.count > 1) worst.count -= 1;
      else crate.items.splice(crate.items.indexOf(worst), 1);
      c.hunger = Math.min(1, c.hunger + GRAZE_FILL);
      game.events.emit('crate');
      return true;
    }
    return false;
  }

  private updateWorker(c: Creature, dt: number, game: Game): void {
    c.hunger = Math.max(0, c.hunger - dt * HUNGER_RATE.deed * bloodMul(c, 'appetite'));
    // A post stands in for the token: the same loop, a different middle.
    const deed = game.workSite(c);
    if (!deed) {
      c.mode = 'wild';
      return;
    }
    // Hungry, and standing on land with stores on it. Looked for on the same
    // clock the wild ones look for a forage bed on, so it costs no more.
    if (c.hunger < GRAZE_HUNGRY && game.time >= c.searchAt) {
      c.searchAt = game.time + 4;
      this.feedFromStores(game, c, deed);
    }
    if (this.comeWhenCalled(c, dt, game)) return;
    const def = this.species(c);
    // Nothing that young is put to work: it keeps about the settlement until it is grown.
    const kind = ageDef(c, game.time).works ? c.trade ?? def.gathers : undefined;
    // Standing orders come before any job: an intruder is everyone's business.
    if (this.defendDeed(game, c, dt, deed)) return;
    if (kind === 'guard') {
      this.guardStep(game, c, dt, deed);
      return;
    }
    if (kind === 'stoke' && !c.carrying && c.state !== 'forage') {
      if (this.stokeStep(game, c, dt, deed)) return;
    }
    if (kind === 'hunt' && !c.carrying && c.state !== 'forage') {
      if (this.packHunt(game, c, dt, deed)) return;
    }
    if (kind && ERRAND_JOBS.has(kind) && c.state !== 'forage') {
      if (this.errandStep(game, c, dt, kind, deed)) return;
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
    /*
     * Seed does not live in a worker's cheeks.
     *
     * The pouch is how a harvest's seed rides home, not a place to keep it: a
     * field is sown out of the settlement's stores just as readily as out of a
     * Seavic's mouth, so seed left in one is seed nobody can see, count, cook
     * or plant by hand. Reported from the island as a farm hand that harvested
     * all season and put nothing but the crop in the crate.
     *
     * It goes in at the next store it stands at, which in the ordinary run of
     * things is the one it has just put the harvest into — so the round trip
     * this costs is usually no trip at all. Only when there is somewhere for
     * it to go: a worker with its hands full and nowhere to empty them stops
     * working, and a mouthful of seed is not worth stopping a farm for.
     */
    if (c.pouch && c.pouch.count > 0 && this.storeFor(game, c, c.pouch)) {
      c.carrying = c.pouch;
      c.pouch = null;
      return;
    }
    if (c.pouch && c.pouch.count <= 0) c.pouch = null;
    if (c.hunger < HUNGRY) {
      const larder = this.foodCrate(game, c, def);
      if (larder) {
        const [lx, ly] = larder.centre;
        if (Math.hypot(lx - c.x, ly - c.y) <= 1.3) {
          const idx = larder.items.findIndex((it) => mayEat(def, it));
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
        const apart = !!kind && this.worksBeside(game, kind, c.workX, c.workY);
        const wx = apart ? c.workX : Math.floor(c.x);
        const wy = apart ? c.workY : Math.floor(c.y);
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
    // An errand worker never walks out to a tile to work it, so it does not
    // join the search below: when its errand has nothing in it, it waits.
    if (kind && !ERRAND_JOBS.has(kind)) {
      const t = this.findForageTile(game, deed.x + 0.5, deed.y + 0.5, siteRange(c, def, deed), kind, c);
      if (t) {
        // A tree cannot be stood on, so a feller walks to the tile beside it.
        // A tree cannot be stood on and neither can the water: both are worked from beside.
        const spot = kind && this.worksBeside(game, kind, t.x, t.y) ? this.beside(game, t.x, t.y, c.x, c.y) : t;
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
   * Where a load should go: the store built for exactly this thing, then the
   * settlement's own crate while it has room, then the nearest other store
   * that will take it. Null means every place on the deed is full, which is a
   * reason to stop rather than to tip the load out on the ground.
   *
   * The purpose-built store comes first because that is what it is for. A raw
   * material bin holds four hundred where a crate holds a fraction of that and
   * takes nothing a bench has touched, and a worker that filled the deed crate
   * with ore left nowhere for the things only a crate will hold. Asked for:
   * "molas should prioritize storing into raw material bins."
   *
   * It needs no test on what the load is: the list has already been through
   * `furnitureRefuses`, so a restricted store still in it is the one built for
   * this thing. Which is how the craft bin, and then the larder, the seed bin
   * and the sprout bin, joined the rule without a clause each.
   */
  storeFor(game: Game, c: Creature, item: Item): DeedStore | null {
    // A worker out on a post fills whatever stands beside the post before it
    // walks the load all the way home; a worker on the deed fills the
    // settlement's own crate first, as it always has.
    const near = game.postStores(c).filter((s) => s.room(item));
    const stores = near.length ? near : game.deedStores().filter((s) => s.room(item));
    if (!stores.length) return null;
    const nearest = (of: DeedStore[]): DeedStore | null => {
      let best: DeedStore | null = null;
      let bestD = Infinity;
      for (const s of of) {
        const d = Math.hypot(s.centre[0] - c.x, s.centre[1] - c.y);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    };
    // A bin that will have it is the bin built for it: the island's
    // `worker_store` orders by the same one flag, with no second test on what
    // the load is.
    const bin = nearest(stores.filter((s) => s.bin));
    if (bin) return bin;
    const own = near.length ? undefined : stores.find((s) => s.deed);
    if (own) return own;
    return nearest(stores) ?? stores[0];
  }

  /**
   * The nearest store on the deed holding something this creature will eat.
   *
   * Every store on the deed, not only the crates: a larder holds a hundred and
   * fifty and is where anybody would actually keep the food, and a worker that
   * looked in crates alone starved standing next to one. `deedStores` is the
   * same list a load gets put away into, so a cupboard, a chest, a shelf or a
   * cart all count, and a trash crate does not.
   */
  private foodCrate(game: Game, c: Creature, def: SpeciesDef): DeedStore | null {
    let best: DeedStore | null = null;
    let bestD = Infinity;
    for (const store of game.deedStores()) {
      if (!store.items.some((it: Item) => mayEat(def, it))) continue;
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
    // Its blood has a say in what it lands for, as it does in what it bites you for.
    const dmg = this.species(a).attack * this.mul(a, 'tough') * trained * (0.7 + game.rand() * 0.6);
    this.hurt(game, t, dmg, a);
    if (a.skills[FIGHT_SKILL] !== undefined) this.gainSkill(game, a, FIGHT_SKILL, 0.05);
  }

  /** Deal damage from a creature or the player; timid wild creatures bolt, and a kill leaves a corpse. */
  hurt(game: Game, t: Creature, dmg: number, by: Creature | 'player'): void {
    const from = by === 'player' ? game.player : by;
    const before = t.health;
    // What a blow costs it is its blood's to say, and its herd's.
    t.health -= dmg * this.mul(t, 'soak');
    t.attackedBy = by === 'player' ? PLAYER_ATTACKER : by.id;
    t.attackedAt = game.time;
    game.events.emit('hit', t.x, t.y, Math.max(0, before - Math.max(0, t.health)), 'dealt');
    // Nothing that has been hit takes food from the hand that hit it.
    if (by === 'player') forgetCoaxing(t);
    if (t.mode === 'wild' && this.species(t).timid) {
      const dx = t.x - from.x;
      const dy = t.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      t.tx = t.x + (dx / len) * 5;
      t.ty = t.y + (dy / len) * 5;
      t.state = 'flee';
      t.until = game.time + 3;
    }
    if (t.mode === 'active' && by !== 'player' && game.time - (t.busyUntil ?? 0) > 0) game.logMsg(`${t.name} is hurt by a ${this.species(by).name.toLowerCase()}!`, 'fight');
    if (t.health <= 0) this.kill(game, t, by);
  }

  /**
   * Remove a creature and leave its corpse lying on the tile, ready for
   * butchering. `quiet` holds back the lines this writes, for the one caller
   * that has better words of its own: culling a beast you kept is not the
   * same event as killing a wild one, and "has died" is not what happened.
   */
  kill(game: Game, t: Creature, killer: Creature | 'player' | null, quiet = false): void {
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
    // Killing one of the bad things is worth writing down.
    if (def.monster && killer === 'player') {
      game.note(`slew:${def.id}`);
      if (!quiet) game.logMsg(`The ${def.name.toLowerCase()} goes down. Butcher it before it rots: there is a great deal on it.`, 'fight');
    }
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    // What the carcass is worth follows the size of the thing that left it.
    const size = ageDef(t, game.time).yield;
    game.dropOnGround(x, y, { uid: game.inventory.nextUid++, id: 'corpse', ql: Math.max(1, Math.min(100, (15 + game.rand() * 35) * size)), dmg: 0, count: 1, extra: def.name });
    /*
     * And what it was keeping, which is the other half of where a map comes
     * from. Only a monster, and only to whoever struck it down: the odds and
     * the quality both come off its health, so a goblin carries a scrap and a
     * dragon carries a dragon's.
     */
    if (killer === 'player' && def.monster) mapFromBeast(game, def.health, x, y);
    if (quiet) return;
    if (killer === 'player') game.logMsg(`You kill the wild ${def.name.toLowerCase()}. Its corpse lies where it fell.`, 'fight');
    else if (t.mode === 'active' || t.mode === 'deed') game.logMsg(`${t.name} has died.`, 'fight');
    else if (killer && killer.mode !== 'wild') game.logMsg(`${killer.name} killed a wild ${def.name.toLowerCase()}.`, 'fight');
  }

  describe(c: Creature, now?: number): string {
    const job = c.trade ?? this.species(c).gathers;
    const verb = job ? GATHER_VERB[job] : 'busy';
    if (c.ridden) return 'under the saddle';
    if (c.hitchedTo !== null) return 'in the traces';
    switch (c.mode) {
      case 'active':
        return `your companion · ${STANCE_NAMES[c.stance].toLowerCase()}`;
      case 'deed':
        if (now !== undefined && !ageDef(c, now).works) return 'of the herd · not grown';
        if (c.carrying) return `deed worker · carrying ${itemDef(c.carrying.id).name.toLowerCase()}`;
        if (c.state === 'forage') return `deed worker · ${job === 'farm' && c.job ? `${c.job}ing a field` : verb}`;
        return 'deed worker';
      case 'stored':
        return 'in a creature crate';
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
        pannier: c.pannier,
        post: c.post,
        trapped: c.trapped,
        born: c.born,
        sex: c.sex,
        traits: c.traits,
        care: c.care,
        bredAt: c.bredAt,
        due: c.due,
        unborn: c.unborn,
        homeX: c.homeX,
        homeY: c.homeY,
        trade: c.trade,
        shodAt: c.shodAt,
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
      Object.assign(c, { name: j.name, variant: j.variant, stance: j.stance, health: j.health, hunger: j.hunger, carrying: j.carrying ?? null, pouch: j.pouch ?? null, xp: j.xp ?? 0, fleece: j.fleece ?? 1, tacked: !!j.tacked, shodAt: j.shodAt ?? -1e9, pannier: j.pannier ?? [], post: j.post ?? null, trapped: j.trapped ?? null, born: j.born ?? 0, sex: j.sex ?? (j.id % 2 ? 'male' : 'female'), traits: j.traits ?? rollTraits(Math.random), care: j.care ?? 0, bredAt: j.bredAt ?? -1e9, due: j.due ?? 0, unborn: j.unborn ?? null, homeX: j.homeX ?? j.x, homeY: j.homeY ?? j.y, trade: j.trade && (SPECIES[j.species]?.trades ?? []).includes(j.trade) ? j.trade : null, skills: { ...startSkills(SPECIES[j.species] ?? SPECIES.rabba), ...(j.skills ?? {}) } });
      cs.list.set(c.id, c);
      if (c.id >= cs.nextId) cs.nextId = c.id + 1;
    }
    return cs;
  }
}
