import { TileType, TILE_DEFS, TREE_DEFS, treeSpecies, treeVariant } from '../world/tiles';
import { BOTANIZE_TABLE, FORAGE_TABLE, rollTable } from './forage';
import type { Game } from './game';
import { crateCentre, crateName, type PlacedCrate } from './crates';
import { CROP_BY_SEED, cropDef, cropReady, cropYield } from './farming';
import { mineChance } from './actions';
import { bedrockAt, oreAt } from '../world/ore';
import { itemDef, type Item } from './items';
import { groundStep } from './player';

/**
 * Wildermon: creatures that roam the wild, can be tamed with the taming
 * skill, and then either travel with the player or work on the deed.
 */

export type CreatureMode = 'wild' | 'active' | 'deed' | 'stored';
export type Stance = 'passive' | 'defensive' | 'aggressive';
/** What a creature gathers from the land, as a wild grazer and as a deed job. */
export type GatherKind = 'forage' | 'botanize' | 'woodcut' | 'farm' | 'mine' | 'sand' | 'clay';
export const GATHER_SKILL: Record<GatherKind, string> = { forage: 'foraging', botanize: 'botanizing', woodcut: 'woodcutting', farm: 'farming', mine: 'mining', sand: 'digging', clay: 'digging' };
export const GATHER_VERB: Record<GatherKind, string> = { forage: 'foraging', botanize: 'botanizing', woodcut: 'felling trees', farm: 'working the fields', mine: 'working the seams', sand: 'digging sand', clay: 'digging clay' };
/** The plain form, for "it will forage" rather than "it will foraging". */
export const GATHER_DO: Record<GatherKind, string> = { forage: 'forage', botanize: 'botanize', woodcut: 'fell trees', farm: 'sow, tend and harvest the fields', mine: 'mine the ore', sand: 'dig sand and carry it home', clay: 'dig clay and carry it home' };
const GATHER_TABLE: Record<GatherKind, Array<[string, number]>> = { forage: FORAGE_TABLE, botanize: BOTANIZE_TABLE, woodcut: [], farm: [], mine: [], sand: [], clay: [] };
export type ButcherPart = 'meat' | 'fur' | 'leather' | 'bone' | 'gland';
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
  /** Fights back rather than bolting, every time it is struck. */
  defensive?: boolean;
  /** Chance a tamed one turns on the player when it has the chance. */
  unruly?: number;
  /** Tiles of working range earned per ten levels of skill; ten by default. */
  rangePerStep?: number;
  /** Stance a newly tamed one takes; defensive unless it is a gentle sort. */
  defaultStance?: Stance;
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
    butcher: { meat: 3, fur: 2, leather: 2, bone: 2, gland: 1 },
    tameFail: 'takes the {food} in its bill, honks once through it, and waddles off',
    leaves: 'waddles back to the nearest clay pit and settles into it',
    nearClay: true,
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
];

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
const INDOOR_JOBS = new Set<GatherKind>(['woodcut', 'farm', 'mine', 'sand', 'clay']);
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
  return id ? { [id]: 1 } : {};
};

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
  /** When the player last called it over for an action; it drops everything and comes. */
  calledAt: number;
  /** Next time an unruly one gets a chance to turn on its keeper. */
  nipAt: number;
  /** The tile this worker walked out to work on: a tree, a seam, a field. */
  workX: number;
  workY: number;
  /** Seeds held in the cheeks, for a farm worker to sow. */
  pouch: Item | null;
  /** What a farm worker walked out to do: sow, tend or harvest. */
  job: FarmJob | null;
}

export type FarmJob = 'sow' | 'tend' | 'harvest';

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
  skills?: Record<string, number>;
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
      calledAt: -1e9,
      nipAt: 0,
      workX: -1,
      workY: -1,
      pouch: null,
      job: null,
    };
  }

  remove(id: number): void {
    this.list.delete(id);
  }

  /** Creatures standing on a tile, from the index rebuilt each update. */
  atTile(x: number, y: number): Creature[] {
    return this.byTile.get(`${x},${y}`) ?? [];
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
      } else if (!TILE_DEFS[w.getTile(x, y)].forage) continue;
      // A Bevere lives on land, but only ever within sight of water; a Seavic needs trees.
      if (def?.nearWater && !nearWater(game, x, y)) continue;
      if (def?.nearTrees && !nearTrees(game, x, y)) continue;
      if (def?.nearClay && !nearClay(game, x, y)) continue;
      this.spawn(id, x + 0.5, y + 0.5, 'wild', game.rand);
      placed++;
    }
    return placed;
  }

  update(dt: number, game: Game): void {
    this.byTile.clear();
    this.respawnClock += dt;
    if (this.respawnClock >= RESPAWN_EVERY) {
      this.respawnClock = 0;
      if (this.wildCount() < WILD_TARGET) this.spawnWild(game, 1, 25);
    }
    for (const c of this.list.values()) {
      if (c.mode === 'stored') continue;
      c.cooldown = Math.max(0, c.cooldown - dt);
      c.moving = false;
      const def = this.species(c);
      if (c.health < def.health && game.time - c.attackedAt > 6) c.health = Math.min(def.health, c.health + dt * (c.mode === 'wild' ? 0.25 : 0.6));
      if (def.unruly && c.mode !== 'wild') this.maybeNip(game, c, def);
      if (game.time >= c.busyUntil) {
        switch (c.mode) {
          case 'wild':
            this.updateWild(c, dt, game);
            break;
          case 'active':
            this.updateActive(c, dt, game);
            break;
          case 'deed':
            this.updateWorker(c, dt, game);
            break;
        }
      }
      if (c.moving) c.walkPhase += dt * 12;
      const key = `${Math.floor(c.x)},${Math.floor(c.y)}`;
      const arr = this.byTile.get(key);
      if (arr) arr.push(c);
      else this.byTile.set(key, [c]);
    }
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
    const helm = game.inventory.tool('helm');
    const soak = helm ? Math.min(0.85, 0.45 + helm.ql / 260) : 0;
    p.stats.health = Math.max(0, p.stats.health - def.attack * 0.012 * (1 - soak));
    p.attackedBy = c.id;
    p.attackedAt = game.time;
    game.logMsg(`${c.name} rounds on you and gets a claw in${helm ? ', though your helm turns the worst of it aside' : ''}.`, 'error');
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

  /** A seed from its cheeks, or failing that one out of the deed crate. */
  private seedFor(game: Game, c: Creature): Item | null {
    if (c.pouch && CROP_BY_SEED.has(c.pouch.id) && c.pouch.count > 0) return c.pouch;
    const crate = game.deedCrate();
    return crate?.items.find((it) => CROP_BY_SEED.has(it.id) && it.count > 0) ?? null;
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
    // As with a miner's pick, cutting the face back is its own matter.
    if (game.rand() < mineChance(skill, 30) && game.world.rockHeight(c.workX, c.workY) > 1) {
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

  /** Sow, tend or harvest the field the worker is standing on. */
  private finishFarming(game: Game, c: Creature, x: number, y: number): Item | null {
    const job = this.farmJobAt(game, c, x, y);
    if (!job) return null;
    const skill = c.skills[GATHER_SKILL.farm] ?? 1;
    this.gainSkill(game, c, GATHER_SKILL.farm, 0.225);
    const ql = Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1));
    if (job === 'sow') {
      const seed = this.seedFor(game, c);
      if (!seed) return null;
      seed.count -= 1;
      if (seed === c.pouch && seed.count <= 0) c.pouch = null;
      if (seed !== c.pouch) {
        const crate = game.deedCrate();
        if (crate && seed.count <= 0) crate.items.splice(crate.items.indexOf(seed), 1);
        game.events.emit('crate');
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

  /** Same diminishing curve as the player's skills. */
  gainSkill(game: Game, c: Creature, id: string, base: number): number {
    const v = c.skills[id] ?? 1;
    const room = Math.max(0, 1 - v / 100);
    const gain = base * Math.pow(room, 1.4) * (0.6 + 0.8 * game.rand());
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
      const e = this.list.get(c.enemy);
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
    const crate = game.deedCrate();
    const crateAt = crate ? crateCentre(crate) : null;
    if (c.state === 'forage') {
      if (game.time >= c.until) {
        c.carrying = kind ? this.finishForage(game, c, kind) : null;
        c.state = 'idle';
        c.until = game.time + 0.5;
      }
      return;
    }
    if (c.carrying) {
      if (c.hunger < HUNGRY && isBaitFor(def, c.carrying.id)) {
        c.hunger = Math.min(1, c.hunger + 0.5);
        c.carrying = null;
        return;
      }
      if (!crate || !crateAt) {
        game.dropOnGround(deed.x, deed.y, c.carrying);
        c.carrying = null;
        return;
      }
      if (Math.hypot(crateAt[0] - c.x, crateAt[1] - c.y) <= 1.3) {
        if (!game.crateAdd(crate, c.carrying)) game.dropOnGround(crate.x, crate.y, c.carrying);
        c.carrying = null;
        c.state = 'idle';
        c.until = game.time + 1;
      } else if (this.stepToward(game, c, crateAt[0], crateAt[1], dt) === 'blocked') {
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return;
    }
    if (c.hunger < HUNGRY) {
      const larder = this.foodCrate(game, c, def);
      if (larder) {
        const [lx, ly] = crateCentre(larder);
        if (Math.hypot(lx - c.x, ly - c.y) <= 1.3) {
          const idx = larder.items.findIndex((it) => isBaitFor(def, it.id));
          if (idx >= 0) {
            const it = larder.items[idx];
            it.count -= 1;
            if (it.count <= 0) larder.items.splice(idx, 1);
            game.events.emit('crate');
            c.hunger = Math.min(1, c.hunger + 0.5);
            game.logMsg(`${c.name} helps itself to ${itemDef(it.id).name.toLowerCase()} from the ${crateName(larder).toLowerCase()}.`, 'event');
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

  /** The nearest crate on the deed holding something this creature will eat. */
  private foodCrate(game: Game, c: Creature, def: SpeciesDef): PlacedCrate | null {
    let best: PlacedCrate | null = null;
    let bestD = Infinity;
    for (const crate of game.crates.values()) {
      if (!game.onDeed(crate.x, crate.y)) continue;
      if (!crate.items.some((it) => isBaitFor(def, it.id))) continue;
      const [cx, cy] = crateCentre(crate);
      const d = Math.hypot(cx - c.x, cy - c.y);
      if (d < bestD) {
        bestD = d;
        best = crate;
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
    const dmg = this.species(a).attack * (0.7 + game.rand() * 0.6);
    this.hurt(game, t, dmg, a);
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

  toJSON(): { nextId: number; list: CreatureJSON[] } {
    return {
      nextId: this.nextId,
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
        skills: c.skills,
      })),
    };
  }

  static fromJSON(data: { nextId: number; list: CreatureJSON[] } | undefined): Creatures {
    const cs = new Creatures();
    if (!data) return cs;
    cs.nextId = data.nextId ?? 1;
    for (const j of data.list ?? []) {
      const c = Creatures.make(j.id, j.species, j.x, j.y, j.mode, Math.random);
      Object.assign(c, { name: j.name, variant: j.variant, stance: j.stance, health: j.health, hunger: j.hunger, carrying: j.carrying ?? null, pouch: j.pouch ?? null, xp: j.xp ?? 0, skills: { ...startSkills(SPECIES[j.species] ?? SPECIES.rabba), ...(j.skills ?? {}) } });
      cs.list.set(c.id, c);
      if (c.id >= cs.nextId) cs.nextId = c.id + 1;
    }
    return cs;
  }
}
