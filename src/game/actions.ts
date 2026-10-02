export { TRY_LEARN, tryGain } from './learn';
import { BURYABLE, BUSH_DEFS, SLAB_BY_ITEM, SLAB_VARIANTS, TILE_DEFS, TREE_AGES, TREE_DEFS, TileType, bushSpecies, packTreeData, slabVariant, treeAge, treeSpecies, treeVariant, lastDawn, nextDawn, type TreeAge, LAWN_AFTER, MOWN_TODAY, MOWING, mownDays, mownToday } from '../world/tiles';
import { FLOWER_ACTIONS, groundSays } from './wildflowers';
import { isSeam } from '../world/tiles';
import type { World } from '../world/world';
import { bedrockAt, oreAt } from '../world/ore';
import { BUILD_ACTIONS } from './buildActions';
import { ANVIL_ACTIONS } from './anvil';
import { POST_ACTIONS } from './posts';
import { FISHING_ACTIONS, fishJournal } from './fishing';
import { BREWING_ACTIONS } from './brewing';
import { CAMPFIRE_ACTIONS } from './campfire';
import { SMELTER_ACTIONS } from './smelter';
import { KILN_ACTIONS } from './kiln';
import { FURNITURE_ACTIONS, furnitureCentre } from './furniture';
import { crateCentre } from './crates';
import { GEAR_ACTIONS } from './gear';
import { IMPROVE_ACTIONS, improvable } from './improve';
import { FARM_ACTIONS, glassSays } from './farming';
import { BUTCHER_ACTIONS } from './butcher';
import { ARCHAEOLOGY_ACTIONS } from './archaeology';
import { CIRCLET, CIRCLET_SET, CIRCLET_STONES, circletSays, circletWithRoom, gemOf, maybeGem, stonesOf } from './gems';
import { TREASURE_ACTIONS, maybeMap } from './treasure';
import { LOCK_ACTIONS } from './locks';
import { FIRST_AID_ACTIONS } from './firstaid';
import { REMEDY_ACTIONS } from './remedies';
import { fillFromSource, PLACEABLE_ACTIONS, sourceFor, vesselBecomes, waterNear } from './placeables';
import { DEED_ACTIONS } from './deed';
import { CRATE_ACTIONS } from './crates';
import { CREATURE_ACTIONS } from './creatureActions';
import { CREATURE_CRATE_ACTIONS } from './creaturecrate';
import { HUSBANDRY_ACTIONS } from './husbandry';
import { DYE_ACTIONS } from './dyes';
import { TRAP_ACTIONS } from './traps';
import { BRIDGE_ACTIONS } from './bridges';
import { AQ_OVER, AQUEDUCT_ACTIONS } from './aqueducts';
import { SPRING_ACTIONS } from './springs';
import { FOUNDATION_ACTIONS } from './foundations';
import { STEPS_ACTIONS } from './steps';
import { GREEN_ACTIONS, greenNow } from './greening';
import { NAMING_ACTIONS } from './naming';
import { LANTERN_ACTIONS } from './lantern';
import { COUNTER_ACTIONS } from './counters';
import { LAMP_ACTIONS } from './lamps';
import { FAITH_ACTIONS } from './faith';
import { BAUBLE_ACTIONS } from './baubles';
import { SACRIFICE_ACTIONS } from './sacrifice';
import { MEDITATION_ACTIONS } from './meditation';
import { SPECIES, type Stance } from './creatures';
import { BOTANIZE_TABLE, BOTANIZE_WATER_TABLE, EMPTY_CHANCE, FIND_CHECK, FORAGE_TABLE, listOf, rollsAt, rollTable } from './forage';
import { atWaterEdge, WATER_GARDEN_ACTIONS } from './watergarden';
import type { FloorKind, RoofShape, Side, WallType } from './building';
import { DEED_RADIUS, rankAtLeast, type Game } from './game';
import { materialOfItem } from './materials';
import { boonOf, boonTime, clockLeft } from './boons';
import { helpingOf, NUTRIENTS } from './nutrition';
import { SKILL_DEFS } from './skills';
import {
  describeFrom, itemDef, itemName, itemWeight, markOf, markSays, rarityOf, bagAdd, bagRefuses, bagSpare, isBag, storedLine, RARITIES, RARITY_WORD, rollRarity,
  NOT_RESTORED, unrestored, type Item,
} from './items';
import { listed, numberWord } from './words';
import { knackable, RECIPE_ACTIONS } from './recipes';

/**
 * What an action acts upon. Tile targets carry the corner nearest to the click
 * and, for building work, the border side plus what to plan there; item targets
 * may carry a quantity; ground targets name an item lying on a tile (uid null
 * means everything there).
 */
export type Target =
  | {
      kind: 'tile';
      x: number;
      y: number;
      cx: number;
      cy: number;
      side?: Side;
      wallType?: WallType;
      material?: string;
      floorKind?: FloorKind;
      /** Which shape of roof, when a roof is what is being planned. */
      roofShape?: RoofShape;
      buildingId?: number;
      /** Subtile for placing objects. */
      sx?: number;
      sy?: number;
      itemUid?: number;
      /** Which way a piece being set down faces. */
      facing?: Side;
      /** Which cast is being called for, when one is. */
      spell?: string;
      /** The tile an aqueduct is led from, when one is being set out to pour into this one. */
      head?: [number, number];
    }
  | { kind: 'crate'; id: number }
  /** Somebody else on the island, by who they are (a Naturalist's Field Medic dressing their wounds). */
  | { kind: 'person'; uid: string; name?: string }
  | { kind: 'campfire'; id: number; itemUid?: number; count?: number }
  | { kind: 'smelter'; id: number; itemUid?: number; count?: number; mouldUid?: number }
  | { kind: 'kiln'; id: number; itemUid?: number; count?: number }
  | {
      kind: 'furniture';
      id: number;
      itemUid?: number;
      count?: number;
      brew?: string;
      /** Which socket of its tier a bauble goes into, when one is asked for (`set_bauble`). */
      slot?: number;
    }
  | { kind: 'anvil'; id: number; itemUid?: number }
  | { kind: 'post'; id: number; creatureId?: number }
  | { kind: 'trap'; id: number }
  | { kind: 'bridge'; id: number }
  | {
      kind: 'item';
      uid: number;
      count?: number;
      spell?: string;
      /**
       * The store this is going into, when the ask knows which one.
       *
       * It did not, and everything went into whichever container happened to
       * be nearest. Reported from a crate rack: "trying to place any items in
       * any of the pine crates gives an error that the maple crate is full" —
       * eight crates stand on one tile there, the nearest of them was the
       * maple, and every put was aimed at it however carefully you had opened
       * one of the others. A crate id for `store_in_crate`, a placed id for
       * `store_in_furniture`; left out, the nearest is still taken, which is
       * what an item's own menu means by "Put in crate".
       */
      into?: number;
      /**
       * A quality to stop improving at.
       *
       * Improving repeats until its own check refuses it, so a ceiling is all
       * a target quality needs to be: `improve.ts` refuses a piece already at
       * or above this, and the repeat stops there of its own accord. The
       * island reads the same field off the same target and refuses in the
       * same words, so "take it to sixty" means the same thing on both sides.
       */
      upto?: number;
      /** The mote going into this thing, for `absorb_mote`: the thing is the target, and the mote this. */
      mote?: number;
    }
  | { kind: 'ground'; x: number; y: number; uid: number | null }
  | { kind: 'creature'; id: number; stance?: Stance; itemUid?: number; job?: string; sex?: string };

/**
 * A name an action cannot go anywhere without.
 *
 * Declared here rather than asked for inside `perform`, because on an island
 * `perform` runs on the island — there is nobody over there to ask. Every
 * action that needed a name used to ask for one in the one menu entry that
 * knew about it, and every other way of starting the same action sent it
 * without: the tile picker, the settlement panel, the toolbelt. The island
 * then either made a name up (`Homestead`) or refused (`Choose a name.`),
 * which is exactly what was reported from the island, both halves of it.
 *
 * `requestAction` is the one door every one of those paths goes through.
 */
export interface AsksName {
  question: string;
  /** What the box is filled with when it opens. */
  fallback?(t: Target, g: Game): string;
  /** Said in the log when nobody types one. */
  declined?: string;
  /** Longest name this one takes. */
  max?: number;
  /** An empty answer means something here, rather than being a refusal. */
  allowEmpty?: boolean;
}

export interface ActionDef {
  id: string;
  label: string;
  /** A label that reads off the target: "Collect clay" rather than "Collect". */
  labelFor?(t: Target, g: Game): string;
  /** Present participle used in messages: "You start digging." */
  verb: string;
  skill?: string;
  /** Item id of the tool that must be carried. */
  tool?: string;
  /** Tiles away the action can be done from; one (arm's length) by default. */
  range?: number;
  /** The same for whoever is doing it, where a perk reaches further (a Fisher's Long Cast): `range` otherwise. */
  rangeFor?(g: Game): number;
  /**
   * What a go wears the tool by, a go being one: a cast of a line is half a
   * swing of an axe. The island's performer for the job wears it the same.
   */
  wear?: number;
  /** Acts on the corner of the tile target rather than the tile itself. */
  corner?: boolean;
  /** Completes immediately without walking or a timer. */
  instant?: boolean;
  /** Keeps going while `perform` returns true. */
  repeat?: boolean;
  /** For item actions: offer "one" and "all" when the stack has more than one. */
  quantity?: boolean;
  /** Not listed by the generic menu; the UI offers it in its own way. */
  hidden?: boolean;
  /** For quantity actions: how many times it can be done now, for the "all" entry. */
  maxRepeat?(t: Target, g: Game): number;
  /** Stamina drained per completion (0..1). */
  stamina: number;
  /** Seconds at skill 1. */
  baseTime: number;
  difficulty?: number;
  applies(t: Target, g: Game): boolean;
  /** Returns a reason the action cannot be done right now, or null. */
  check?(t: Target, g: Game): string | null;
  /** A name to be typed before this can start. Asked once, by `requestAction`. */
  asks?: AsksName;
  /**
   * Something to be sure about first, in these words, or null if not.
   *
   * Same reason as `asks`: the confirmation used to live inside `perform`, so
   * on an island — where `perform` is the island's half — disbanding a
   * settlement asked nobody anything at all.
   */
  confirms?(t: Target, g: Game): string | null;
  /** Runs on completion. Return true to repeat. */
  perform(t: Target, g: Game): boolean | void;
}

/**
 * Ground a shovel can tread down into packed dirt: soil, anything growing on
 * it, and a trail feet have half done the job on -- which is how a path
 * people wore becomes a road: pack it, then pave it. The island's `packable`.
 */
const PACKABLE = new Set<number>([TileType.Dirt, TileType.Grass, TileType.Lawn, TileType.Steppe, TileType.Tundra, TileType.Moss, TileType.Trail]);

const DIGGABLE_PLANT_TILES = new Set<number>([TileType.Grass, TileType.Dirt, TileType.Moss, TileType.Lawn, TileType.Steppe, TileType.Tundra]);

/**
 * What a spadeful lays down: the ground each material makes of the tile it
 * covers. Dirt was the only thing that could be dropped, and a clay bank or a
 * beach could be dug up but never laid; now what comes out of a bed can go
 * back down as itself.
 */
export const SPOIL_TILE: Record<string, TileType> = { dirt: TileType.Dirt, clay: TileType.Clay, sand: TileType.Sand };
/**
 * The jobs that teach the body nothing at all.
 *
 * Every go trains the hands a little, and spending wind trains the chest —
 * which is right for work, and wrong for the three things that are not work.
 * Asked for: "no stats should be gained by eating, drinking, or moving items".
 * Putting something in your mouth, tipping a bucket, and carrying a thing from
 * a crate to your pack are not exercise, and a body that does them over and
 * over should be no steadier for it. The wind they cost is still spent: a cost
 * is not a lesson. The island keeps the same list in `teaches_nothing`, and a
 * test of its own holds the two of them together.
 */
export const TEACHES_NOTHING = new Set<string>([
  // Eating and drinking, and handing food to something else.
  'eat', 'drink', 'drink_from_vessel', 'drink_skin', 'feed',
  // Carrying things about, in and out of whatever holds them.
  'pick_up', 'pick_up_all', 'drop', 'crate_take_all', 'furniture_take_all',
  'kiln_take_all', 'smelter_take_all', 'store_in_crate', 'store_in_furniture',
  'take_from_store', 'stow_item', 'empty_bag', 'throw_away', 'equip', 'unequip',
  // And pouring, which is carrying by another name.
  'fill_bucket', 'fill_skin', 'empty_bucket', 'empty_vessel', 'pour_into_barrel',
]);

/** The order a spadeful is looked for in, which is the order it was written in. */
export const SPOIL_ORDER = ['dirt', 'clay', 'sand'];

/** A word and its article: "an oak", "a pine". */
export const an = (word: string): string => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

/** "in 9 hours", "in 40 minutes", "within the hour". */
export function hoursHence(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s >= 5400) return `in ${Math.round(s / 3600)} hours`;
  if (s >= 3000) return 'in about an hour';
  if (s >= 120) return `in ${Math.round(s / 60)} minutes`;
  return 'any moment';
}

/**
 * What is coming for a tree, and what to do about it: the woods turn over
 * once a day, at dawn, so the next stage is a matter of hours and the
 * sentence says which. Woods not yet turned since the last dawn turn any
 * moment; otherwise at the next. A stage whose next stage is itself has
 * nothing coming.
 */
export function treeOutlook(age: TreeAge, treesAt: number): string {
  if (age.next === age.id) return ' It is clipped, and will stay as it is.';
  const now = Date.now() / 1000;
  const when = hoursHence((treesAt < lastDawn(now) ? now : nextDawn(now)) - now);
  const then = age.next === null ? 'it will be gone' : `it will be ${TREE_AGES[age.next].name.toLowerCase()}`;
  let out = ` The woods turn over ${when}, and ${then}.`;
  if (!age.alive) out += ' Fell it for what timber is in it before then.';
  else if (age.pruned !== null && age.next !== null && !TREE_AGES[age.next].alive) out += ' Prune it to keep it.';
  return out;
}

/** Forestry it takes to graft: a beginner's graft is a sprout thrown away. */
export const GRAFT_SKILL = 50;
/** A sprout of one of the three that bear, which is what a graft is made from. */
export const fruitSprout = (it: { id: string; extra?: string }): boolean =>
  it.id === 'sprout' && !!TREE_DEFS.find((d) => d.name === it.extra)?.fruit;

/**
 * The stage a sprout comes up at when it goes in the ground: a young tree,
 * which bears nothing yet. A Forester's Nursery (`grown:plant`) brings it up
 * that many stages further on, along the stages' own order.
 */
export const PLANTED_AGE = 0;
export const plantedAge = (steps: number): number => {
  let age = PLANTED_AGE;
  for (let i = 0; i < steps; i++) age = TREE_AGES[age].next ?? age;
  return age;
};
/**
 * A Forester's Coppice takes a tree grown enough to bear -- mature and older,
 * and living -- back to where a planted one starts, for its logs.
 */
export const coppiceable = (data: number): boolean => treeAge(data).alive && treeAge(data).bears;
/** The one tree a Forester's Tap Resin taps. */
export const RESIN_TREE = TREE_DEFS.findIndex((d) => d.name === 'Pine');
/** A living pine with timber in it: not a sapling, and not one clipped to a shrub. */
export const tappable = (data: number): boolean =>
  treeSpecies(data) === RESIN_TREE && treeAge(data).alive && treeAge(data).logs > 0;
/**
 * What a Forester's Clear Brush clears, and what it leaves: grass where a bush
 * stood, bare dirt where the reeds were.
 */
export const CLEARED_TO: Partial<Record<number, TileType>> = { [TileType.Bush]: TileType.Grass, [TileType.Reed]: TileType.Dirt };
/** The brush within `r` tiles of (x, y), that tile included. */
export function brushAround(w: World, x: number, y: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let ty = y - r; ty <= y + r; ty++) {
    for (let tx = x - r; tx <= x + r; tx++) {
      if (tx >= 0 && ty >= 0 && tx < w.w && ty < w.h && CLEARED_TO[w.getTile(tx, ty)] !== undefined) out.push([tx, ty]);
    }
  }
  return out;
}

const cornerName = (t: Target & { kind: 'tile' }): string => {
  const ns = t.cy === t.y ? 'north' : 'south';
  const ew = t.cx === t.x ? 'west' : 'east';
  return `${ns}-${ew}`;
};

const tile = (t: Target, g: Game): TileType => (t.kind === 'tile' ? g.world.getTile(t.x, t.y) : TileType.Sand);

/** Paving goes on a packed floor, never on sod or loose earth. */
const unpacked = (t: Target, g: Game): string | null =>
  tile(t, g) === TileType.PackedDirt ? null : 'The ground has to be packed flat before anything is laid on it.';

/** Terraforming is not allowed under a building. */
const underBuilding = (g: Game, x: number, y: number): string | null => (g.buildings.buildingAt(x, y) ? 'You cannot do that inside a building.' : null);
const cornerUnderBuilding = (g: Game, cx: number, cy: number): string | null => {
  for (let y = cy - 1; y <= cy; y++) for (let x = cx - 1; x <= cx; x++) if (g.buildings.buildingAt(x, y)) return 'You cannot dig under a building.';
  return null;
};

/** The four corners of a tile, north-west first and going clockwise. */
export const tileCorners = (x: number, y: number): Array<[number, number]> => [
  [x, y],
  [x + 1, y],
  [x + 1, y + 1],
  [x, y + 1],
];

/**
 * The height flattening works towards: the ground the player is standing on,
 * so a terrace can be carried outwards tile by tile. Standing on the tile
 * being flattened there is nothing to match, so it settles to its own lowest
 * corner and the ground only ever comes down.
 */
export function flattenTarget(g: Game, x: number, y: number): number {
  // A level taken is the mark for everything, and the reason to take one.
  if (g.level !== null) return g.level;
  const w = g.world;
  const heights = tileCorners(x, y).map(([cx, cy]) => w.getHeight(cx, cy));
  if (g.player.tileX === x && g.player.tileY === y) return Math.min(...heights);
  return Math.round(w.centerHeight(g.player.tileX, g.player.tileY));
}

/**
 * Why this corner is finished, when a level has been taken.
 *
 * The one thing a run of goes never knew was when to stop. Ask for
 * twenty-five spadefuls at a corner and you get twenty-five, whatever height
 * that leaves it at, and the only way to land on a number was to count. With
 * a level taken the door itself says when the corner is there, so a run of any
 * length stops exactly on it: the refusal ends the run the way every other
 * refusal does. `dir` is which way the job moves the ground.
 */
export function levelStop(g: Game, cx: number, cy: number, dir: -1 | 1): string | null {
  if (g.level === null) return null;
  const h = g.world.getHeight(cx, cy);
  if (dir < 0 && h <= g.level) return `That corner is down to the level of ${g.level} already.`;
  if (dir > 0 && h >= g.level) return `That corner is up to the level of ${g.level} already.`;
  return null;
}

/**
 * A spadeful, from the pack or out of a store you are standing beside.
 *
 * Twenty kilos a spadeful and a hundred and twenty on your back is six of
 * them, so moving a bank of earth is a great many walks to the crate and back.
 * A cart, a crate or a bin within reach is as good as a pocket for this one
 * job: the ground is what the load was fetched for. The pack comes first, so
 * nothing changes for anybody who is carrying their own.
 */
export function spoilFrom(g: Game, want: string[], uid?: number): { id: string; take: () => boolean } | undefined {
  if (uid !== undefined) {
    const chosen = g.inventory.get(uid);
    if (!chosen || !(chosen.id in SPOIL_TILE)) return undefined;
    return { id: chosen.id, take: () => !!g.inventory.remove(chosen.uid, 1) };
  }
  for (const id of want) {
    const held = g.inventory.items.find((it) => it.id === id);
    if (held) return { id, take: () => !!g.inventory.remove(held.uid, 1) };
  }
  const reach = g.perk('reach:soil', SPOIL_REACH);
  const near = (at: [number, number]): boolean => Math.hypot(at[0] - g.player.x, at[1] - g.player.y) <= reach;
  // One spadeful off the top of the pile, not the pile: a stack of five dirt
  // is one row, and lifting the row out of the crate would take all five.
  const one = (it: { count: number }, whole: () => boolean): boolean => {
    if (it.count > 1) {
      it.count -= 1;
      g.events.emit('crate');
      return true;
    }
    return whole();
  };
  for (const id of want) {
    for (const c of g.crates.values()) {
      const it = near(crateCentre(c)) ? c.items.find((o) => o.id === id) : undefined;
      if (it) return { id, take: () => one(it, () => !!g.crateTake(c, it.uid)) };
    }
    for (const f of g.furniture.values()) {
      // Not out of a grave, whoever's it is: what is in one is taken out through its own doors or not at all.
      if (f.grave) continue;
      const it = near(furnitureCentre(f)) ? f.items.find((o) => o.id === id) : undefined;
      if (it) return { id, take: () => one(it, () => !!g.furnitureTake(f, it.uid)) };
    }
  }
  return undefined;
}

/** True while any corner of the tile is off the height flattening aims at. */
export function needsFlattening(g: Game, x: number, y: number): boolean {
  const target = flattenTarget(g, x, y);
  return tileCorners(x, y).some(([cx, cy]) => g.world.getHeight(cx, cy) !== target);
}

/** The chance a swing cuts the rock face back, from skill and the pick. */
/**
 * How often working a face for its metal happens to bring a slab of it down.
 *
 * One swing in thirty. It was one in a hundred, which is hardly ever enough to
 * be a thing that happens: a seam worked for an afternoon sank a step or two
 * and the whole business read as a fixed wall you chipped at. A thirtieth is
 * still nobody's plan for moving rock -- `chip_corner` is the job for that,
 * and it comes off three swings in four -- but it is often enough that a face
 * you have been at all day is visibly lower than it was.
 *
 * The island holds the same number in `mine_collapse()`, and the browser's
 * miner, the browser's Mola and the island's all ask their own side for it.
 */
export const MINE_COLLAPSE = 1 / 30;

/** Bundles of mixed grass a cut gives. */
export const GRASS_PER_CUT = 2;
/**
 * Moss a cut of a moss tile gives: as many as a cut of grass gives bundles.
 * Asked for: "make that cuttable like grass into mixed grass, but yielding
 * moss." The island's `moss_per_cut`.
 */
export const MOSS_PER_CUT = GRASS_PER_CUT;
/** Reeds a cut gives, and the foraging at which a third is certain (a third one in this many points of it). */
export const REED_CUT = 2;
export const REED_EXTRA_AT = 140;

/** How many times a go of foraging or botanizing looks: by the skill, and once more for a Naturalist's Keen Eye. */
const searches = (g: Game, job: 'forage' | 'botanize', skill: string): number =>
  rollsAt(g.skills.get(skill)) + Math.floor(g.perk(`passes:${job}`, 0));

/**
 * The looks themselves, and what each turned up: none by chance on a share
 * of them (none at all for a Naturalist's Sure Find), then the skill, then the
 * table; and now and then a rare one for their Rare Find.
 */
function lookOver(g: Game, job: 'forage' | 'botanize', skill: string, table: Array<[string, number]>, rolls: number): string[] {
  const found: string[] = [];
  for (let i = 0; i < rolls; i++) {
    if (g.rand() < EMPTY_CHANCE * g.perk(`empty:${job}`, 1) || !g.skillCheck(skill, FIND_CHECK)) continue;
    const id = rollTable(table, g.rand());
    // Only rolled for a Rare Find, so a look draws what it always drew without one.
    const odds = g.perk(`rare:${job}`, 0);
    const rare = odds > 0 ? rollRarity(() => g.rand(), odds) : 0;
    const item = g.gather(id, { ql: g.productQl(skill), rare });
    found.push(`${rare ? `${RARITIES[rare].name} ` : ''}${itemDef(id).name.toLowerCase()} (QL ${item.ql.toFixed(1)})`);
    if (rare) {
      g.note(RARITIES[rare].name);
      g.logMsg(RARITY_WORD[rare], 'skill');
    }
  }
  return found;
}

/** Quality nothing is repaired below: a thing mended often enough is finished in the end. */
export const REPAIR_FLOOR = 1;
/**
 * One go of repair at this skill: the damage it takes out, and the quality
 * it costs for every point of damage taken out.
 */
export const repairGo = (skill: number): { healed: number; cost: number } => ({
  healed: 1.2 + skill * 0.1,
  cost: Math.max(0.004, 0.03 - skill * 0.00026),
});

/** Fruit a picking takes off a tree in bearing and off an old one, at middling forestry. */
export const FRUIT_MATURE = 3;
export const FRUIT_OLD = 5;

/**
 * How deep the water over a face may be and still be worked, in height units.
 *
 * Reported from the island: a copper vein that would not be mined, with "You
 * cannot mine below the water level." and no water anywhere on the tile. Two
 * things were wrong in one line, `rockHeight(corner) <= 0`.
 *
 * It asked the wrong corner height. `rockHeight` is the surface less the soil
 * over it, so a corner shared with a meadow refuses a face standing fifty
 * units above the sea, on the grounds that the bedrock buried under the grass
 * beside it is below sea level. Water is a question about the surface, and the
 * surface is what `hasWater` reads and what the renderer draws.
 *
 * And it was a height out even where the two agree: `<= 0` refuses a face
 * standing *at* the waterline, and water is only drawn below it — so nought is
 * the one height that refuses and shows nothing, which is exactly where a
 * shore face sits.
 *
 * So: the corner's own height, and ten units of water allowed over it. That is
 * about waist deep at the tide line and you work standing in it, which is what
 * a shore quarry looks like. Past that you are swimming, and nobody swings a
 * pick while swimming.
 */
export const MINE_DEPTH = 10;

/** How far a spade reaches down through water, for this body: a Wader works deeper. */
export const digDepth = (g: Game): number => g.perk('depth:dig', MINE_DEPTH);

/**
 * How deep a bottom may lie and still be worked from a boat, in height
 * units: three times what a pick or a shovel works to from the shore. Past
 * that a spadeful comes up empty. The island reads the same number.
 */
export const DREDGE_DEPTH = 30;

/** How much a go of Flatten moves, in height units. */
export const FLATTEN_STEP = 1;

/** A tile's corners, which a Terraformer's Dig out the tile takes down together. */
export const TILE_CORNERS = 4;
/** And the base time of that one go, against four digs one after another. */
export const DIG_TILE_TIME = 16;

/**
 * How far soil is reached for when you drop it or flatten with it: the pack,
 * and then a cart or a container within this many tiles. A Terraformer's Long
 * Reach takes it further (`reach:soil`).
 */
export const SPOIL_REACH = 2.5;

/** Ground with anything living in it, and the damp ground that is full of them. */
export const WORMY = new Set<TileType>([TileType.Grass, TileType.Dirt, TileType.PackedDirt, TileType.Marsh, TileType.Moss]);
export const RICH_WORMS = new Set<TileType>([TileType.Marsh, TileType.Moss]);

/** How often a deliberate chip at a corner actually takes it down: one in four. */
export const CHIP_CHANCE = 0.25;


/** How far a prospector reads the ground: one tile further every ten levels. */
export const PROSPECT_REACH = 3;
export const PROSPECT_STEP = 10;
export const prospectRadius = (skill: number): number => PROSPECT_REACH + Math.floor(skill / PROSPECT_STEP);
/** How far this body reads the ground: a Miner's Far Reader reads further (`further:prospect`). */
export const prospectReach = (g: Game): number => prospectRadius(g.skills.get('prospecting')) + g.perk('further:prospect', 0);

/** How deep a pick works through water, for this body: a Miner's Wet Work works deeper (`depth:mine`). */
export const mineDepth = (g: Game): number => g.perk('depth:mine', MINE_DEPTH);
/** The mining an ore wants of this body before it can be worked: a Miner's Ore Sense wants less (`ore:below`). */
export const oreNeeds = (g: Game, level: number): number => Math.max(0, level - g.perk('ore:below', 0));

/**
 * A Miner's Pan: sand with water at a corner, washed in a pan. What comes out
 * of it when anything does, each as likely, and how long a go takes.
 */
export const PAN_ORES = ['copper_ore', 'tin_ore', 'silver_ore', 'gold_ore'];
export const PAN_TIME = 8;
/** Whether a tile has water at one of its corners, which panning wants. */
export const besideWater = (g: Game, x: number, y: number): boolean =>
  tileCorners(x, y).some(([cx, cy]) => g.world.getHeight(cx, cy) < 0);

/**
 * The steepest slope a spade or a trowel may leave: this many times the skill,
 * and never less than `SLOPE_FLOOR`. A Terraformer's Steep Cut raises the
 * digger's multiple (`slope:digging`).
 */
export const SLOPE_PER_SKILL = 3;
export const SLOPE_FLOOR = 40;

function maxDigSlope(g: Game): number {
  return Math.max(SLOPE_FLOOR, Math.floor(g.skills.get('digging') * g.perk('slope:digging', SLOPE_PER_SKILL)));
}

/**
 * Why a corner of rock may not be raised a step, with concrete or a Mason's
 * rubble, or null. It goes on bare rock and never on a seam; above the water,
 * or under as much of it as a Mason's Wet Set reaches (`depth:raise_rock`).
 */
export function rockRaiseRefusal(g: Game, cx: number, cy: number, what: 'Concrete' | 'Rubble'): string | null {
  const w = g.world;
  // Concrete goes on bare rock, above the water: the only way to build
  // *up* on rock without dirt, which slides off it.
  if (w.getDirt(cx, cy) > 0) return `There is soil on that corner. ${what} goes on bare rock.`;
  const deep = g.perk('depth:raise_rock', 0);
  if (w.getHeight(cx, cy) < -deep) {
    return deep > 0 ? `${what} will not set under more than ${deep} of water.` : `${what} will not set under water.`;
  }
  if (seamUnder(w, cx, cy)) return `That corner is on a seam. ${what} goes on plain rock.`;
  const under = cornerUnderBuilding(g, cx, cy);
  if (under) return under;
  if (!g.inventory.has('trowel')) return `You need a trowel to lay ${what.toLowerCase()}.`;
  return levelStop(g, cx, cy, 1) ?? slopeRefusal(g, 'masonry', cx, cy, 1);
}

/** The same rule for a mason raising rock as for a digger moving soil. */
function maxMasonSlope(g: Game): number {
  return Math.max(SLOPE_FLOOR, Math.floor(g.skills.get('masonry') * g.perk('slope:masonry', SLOPE_PER_SKILL)));
}

/**
 * The skill a slope wants, which is the cap read backwards.
 *
 * `max(40, floor(skill * 3))` allows a slope the moment three times the skill
 * reaches it, so a third of the slope is what it takes, and a tenth of a point
 * is as fine as a skill is ever shown.
 */
export const slopeNeeds = (slope: number, per = SLOPE_PER_SKILL): number => Math.ceil((slope / per) * 10) / 10;

/**
 * Why a cut is too steep, in numbers, or null when it is not.
 *
 * It used to say "The slope would be too steep for your digging skill" and
 * stop there, which tells you neither how far over you are nor what would
 * carry it — so the only way to find either was to dig somewhere else and see.
 * Now it says the slope the cut would leave, the slope you are good for, and
 * the skill that would do it. The island says the same in `slope_refusal`.
 */
export function slopeRefusal(g: Game, skill: 'digging' | 'masonry', cx: number, cy: number, delta: number): string | null {
  const would = slopeAfter(g, cx, cy, delta);
  const cap = skill === 'digging' ? maxDigSlope(g) : maxMasonSlope(g);
  if (would <= cap) return null;
  const per = g.perk(`slope:${skill}`, SLOPE_PER_SKILL);
  return `That would leave a slope of ${would}. Your ${skill} allows ${cap}; it would take ${skill} ${slopeNeeds(would, per).toFixed(1)}.`;
}

/**
 * Ground inside a settlement that is not yours.
 *
 * Nothing stopped a visitor cutting a trench through somebody's token: the
 * doors asked what the ground was made of and never whose it was. A corner is
 * shared by as many as four tiles and is refused if any of them is on a
 * settlement you are not of; a tile action asks about its own tile alone; and
 * a spadeful dropped at your feet asks about the tile you stand on. The island
 * reads the same rule off the same `corner` column, in the same words.
 */
export function foreignGround(g: Game, def: ActionDef, t: Target): string | null {
  const tiles: Array<[number, number]> = t.kind !== 'tile'
    ? [[g.player.tileX, g.player.tileY]]
    : def.corner
      ? [[t.cx - 1, t.cy - 1], [t.cx, t.cy - 1], [t.cx - 1, t.cy], [t.cx, t.cy]]
      : [[t.x, t.y]];
  for (const [x, y] of tiles) {
    const d = g.deedAt(x, y);
    if (d && !g.onDeed(x, y)) return `That ground is part of ${d.name}. Only its citizens may shape it.`;
  }
  return null;
}

/**
 * Whether a corner holds up a seam: any of the four tiles round it over a
 * vein, or the coal. Asked for: "only allow raising a rock corner with
 * concrete, not an ore / seam corner" — a vein raised with concrete would
 * be ore for ever, mined down a step, laid up a step and mined again.
 * `isSeam` is the one word for it on both sides; the island reads it off
 * `rock_def.seam`, which is generated from it.
 */
function seamUnder(w: World, cx: number, cy: number): boolean {
  for (const [x, y] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
    if (w.inBounds(x, y) && isSeam(bedrockAt(w, x, y))) return true;
  }
  return false;
}

/** Slope around a corner if its height were changed by `delta`. */
function slopeAfter(g: Game, cx: number, cy: number, delta: number): number {
  const w = g.world;
  const old = w.getHeight(cx, cy);
  w.heights[cy * w.cw + cx] = old + delta;
  const s = w.slopeAroundCorner(cx, cy);
  w.heights[cy * w.cw + cx] = old;
  return s;
}


/** What somebody without a Tailor's Patch is told. The island says the same. */
export const PATCH_PERK = 'That wants a Tailor who has learned to patch.';
/** What a piece is patched with: cloth for cloth, leather for leather, and nothing else takes a patch. The island's `patch_with`. */
export const patchWith = (id: string): 'cloth' | 'leather' | null => {
  const m = improvable(id)?.material.id;
  return m === 'cloth' || m === 'leather' ? m : null;
};

/** Damage a Mender's repair kit takes off a thing, and none of its quality. The island's `kit_mend`. */
export const KIT_MEND = 50;
/**
 * Moss planted on a tile of dirt to turn it to moss: this many, pressed in
 * at once. Asked for: "Moss can be planted in 10qty on a dirt tile to change
 * it to moss." The island's `moss_plant`.
 */
export const MOSS_PLANT = 10;
describeFrom('moss', { moss: { cut: MOSS_PER_CUT, plant: MOSS_PLANT } });
describeFrom('repair_kit', { mend: KIT_MEND });
/** Whether a thing could take a seal: anything but the sealant itself, and nothing sealed already. */
const sealable = (item: Item): boolean => item.id !== 'sealant' && item.mark?.seal === undefined;

/** What somebody without an Artisan's Glaze is told. The island says the same. */
export const GLAZE_PERK = 'That wants an Artisan who has learned to glaze.';
/** What takes a glaze: a fired pot, bowl or jar, and an amphora. The island's `glazeable`. */
export const GLAZEABLE: ReadonlySet<string> = new Set(['clay_pot', 'clay_bowl', 'clay_jar', 'amphora']);
/** The ashes a glaze is made of, for one thing. */
export const GLAZE_ASH = 1;

/** A share of a bar or a nutrient as a whole percentage, as the island says it. */
const wholePct = (x: number): string => `${Math.round(x * 100)}%`;

/**
 * What a helping of a thing does, to a Cook's tongue (a Cook's Taste): how
 * much of the food bar it fills, or of the thirst bar a drink of it quenches,
 * what it feeds of each of the four, and how long its knack lasts -- all of it
 * at its quality and with its maker's hand in it. Nothing for what is not
 * food or drink. The island says the same (`taste_says`).
 */
export function tasteSays(g: Game, item: Item): string {
  const def = itemDef(item.id);
  if (!(def.food ?? 0) && !(def.drink ?? 0)) return '';
  const said: string[] = [];
  said.push((def.food ?? 0) > 0
    ? `fills ${wholePct((def.food ?? 0) * (0.7 + item.ql / 200) * markOf(item, 'fill'))} of the food bar`
    : `quenches ${wholePct(def.drink ?? 0)} of the thirst bar`);
  const feeds = NUTRIENTS.filter((k) => (def.feeds?.[k] ?? 0) > 0)
    .map((k) => `${k} ${wholePct((def.feeds?.[k] ?? 0) * helpingOf(item.ql) * markOf(item, 'feed'))}`);
  if (feeds.length) said.push(`feeds ${listed(feeds)}`);
  const skill = knackable(item.id) ? boonOf(g.seed, item.id) : null;
  if (skill) said.push(`gives a knack that lasts ${clockLeft(boonTime(item.id, item.ql, markOf(item, 'knack')))}`);
  return ` To your taste, a helping ${listed(said)}.`;
}

export const ACTIONS: ActionDef[] = [
  {
    id: 'examine',
    label: 'Examine',
    verb: 'examining',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t) => t.kind === 'tile',
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      const type = w.getTile(t.x, t.y);
      const c = w.corners(t.x, t.y, [0, 0, 0, 0]);
      const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
      let text = `You see ${w.tileName(t.x, t.y).toLowerCase()} at (${t.x}, ${t.y}).`;
      if (type === TileType.Tree) {
        const data = w.getData(t.x, t.y);
        const age = treeAge(data);
        const kind = TREE_DEFS[treeSpecies(data)].name.toLowerCase();
        text = `You see ${an(`${age.name.toLowerCase()} ${kind} tree`)} at (${t.x}, ${t.y}).`;
        // What is in it, what is coming for it, and what to do about that —
        // the same words the island uses, so a tree reads the same on both.
        const cuts = w.notchAt(t.x, t.y);
        if (cuts) text += ` It has ${cuts} of ${age.hits} strokes in it.`;
        text += treeOutlook(age, g.treesAt);
      } else if (type === TileType.Stump) {
        text = `You see the stump of ${an(TREE_DEFS[treeSpecies(w.getData(t.x, t.y))].name.toLowerCase())} at (${t.x}, ${t.y}). Dig it out, or leave it a day.`;
      } else if (type === TileType.Grass && (w.getData(t.x, t.y) & MOWING)) {
        const d = w.getData(t.x, t.y);
        text += ` Kept cut: ${mownDays(d) + (mownToday(d) ? 1 : 0)} of ${LAWN_AFTER} days towards lawn.`;
      } else if (type === TileType.Bush) {
        text = `You see a ${BUSH_DEFS[bushSpecies(w.getData(t.x, t.y))].name.toLowerCase()} at (${t.x}, ${t.y}).`;
      }
      // What feet have done to it, and what is in flower on it: the island's words (`ground_says`).
      text += groundSays(g, t.x, t.y);
      // And for a Fisher with a Fishing Journal, what the water holds for them.
      const water = w.hasWater(t.x, t.y) ? ` Water laps over it.${fishJournal(g, t.x, t.y)}` : '';
      let extra = '';
      const here = g.deedOfMineAt(t.x, t.y);
      if (here && g.isToken(t.x, t.y)) extra += ` The settlement token of ${here.name} stands here.`;
      else if (here) extra += ` This is part of ${here.name}.`;
      const b = g.buildings.buildingAt(t.x, t.y);
      if (b) extra += ` It belongs to ${b.name}, ${b.levels === 1 ? 'a single-storey building' : `${b.levels} storeys tall`}.`;
      // And a glasshouse says what it is for (`glasshouse.ts`).
      extra += glassSays(g.buildings, b);
      // And its deck, if the tile stands on piers (`pier_says`).
      if (b) extra += g.pierSays(t.x, t.y);
      const crates = g.cratesOnTile(t.x, t.y);
      if (crates.length) extra += ` ${crates.length === 1 ? 'A crate stands' : `${crates.length} crates stand`} here.`;
      g.logMsg(`${text} Height ${avg.toFixed(1)}, slope ${w.slope(t.x, t.y)}.${water}${extra}`, 'event');
    },
  },
  {
    // Sand, clay, peat and tar lie in beds, and dirt lies on top of the
    // ground as they do. You fill a shovel off the top of one without cutting
    // the ground about, which is what digging a corner does: stand on the
    // tile, and the tile is as it was when you walk off it.
    id: 'collect',
    label: 'Collect',
    labelFor: (t, g) => `Collect ${TILE_DEFS[tile(t, g)].name.toLowerCase()}`,
    verb: 'filling a shovel',
    skill: 'digging',
    tool: 'shovel',
    // Nought tiles of reach: you have to be standing on the bed itself, and
    // the walk that starts an action puts you there.
    range: 0,
    stamina: 0.05,
    baseTime: 7,
    difficulty: 6,
    applies: (t, g) => t.kind === 'tile' && !!TILE_DEFS[tile(t, g)].collect,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('shovel')) return 'You need a shovel to dig with.';
      const def = TILE_DEFS[tile(t, g)];
      if (!def.collect) return 'There is no bed of anything here.';
      const under = g.buildings.buildingAt(t.x, t.y);
      if (under) return `${under.name} stands on it.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const def = TILE_DEFS[g.world.getTile(t.x, t.y)];
      const yieldId = def.digYield;
      if (!def.collect || !yieldId) return;
      if (!g.skillCheck('digging', 6, g.toolQl('shovel'))) {
        g.missed();
        g.logMsg(`Your shovel comes up with nothing but a smear of ${def.name.toLowerCase()}.`, 'event');
        return;
      }
      const item = g.gather(yieldId, { ql: g.productQl('digging', g.toolQl('shovel')) });
      g.logMsg(`You fill a shovel with ${itemDef(yieldId).name.toLowerCase()} off the top of the bed. (QL ${item.ql.toFixed(1)})`, 'event');
    },
  },
  {
    // Moss pressed into bare dirt, `MOSS_PLANT` of it at once, turns the tile
    // to moss: the same on both sides (the island's `perform_farm`).
    id: 'plant_moss',
    label: 'Plant moss',
    verb: 'planting moss',
    skill: 'farming',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => t.kind === 'tile' && g.world.getTile(t.x, t.y) === TileType.Dirt && g.inventory.count('moss') > 0,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (g.world.getTile(t.x, t.y) !== TileType.Dirt) return 'Moss is planted on a tile of dirt.';
      if (g.world.hasWater(t.x, t.y)) return 'You cannot plant moss underwater.';
      const have = g.inventory.count('moss');
      if (have < MOSS_PLANT) return `It takes ${MOSS_PLANT} moss to plant a tile; you have ${have}.`;
      // Not the ground under a building, which a tile on piers is (`piers.ts`).
      return underBuilding(g, t.x, t.y);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      if (g.world.getTile(t.x, t.y) !== TileType.Dirt || g.inventory.count('moss') < MOSS_PLANT) return;
      g.inventory.consume('moss', MOSS_PLANT);
      g.world.setTile(t.x, t.y, TileType.Moss);
      g.logMsg(`You plant ${MOSS_PLANT} moss and the dirt is moss now.`, 'event');
    },
  },
  {
    id: 'dig_worms',
    label: 'Turn it over for worms',
    verb: 'turning the dirt over',
    skill: 'digging',
    tool: 'shovel',
    // A spadeful turned over for worms is not a hole dug: the island's `perform_ground` wears the shovel as little.
    wear: 0.4,
    stamina: 0.04,
    baseTime: 6,
    repeat: true,
    applies: (t, g) => t.kind === 'tile' && WORMY.has(g.world.getTile(t.x, t.y)),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('shovel')) return 'You need a shovel.';
      if (g.world.hasWater(t.x, t.y)) return 'Not under water.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.gainSkill('digging', 0.2);
      // Damp ground gives more than dry: a marsh is full of them.
      const rich = RICH_WORMS.has(g.world.getTile(t.x, t.y));
      const n = Math.floor(g.rand() * (rich ? 5 : 3)) + (rich ? 1 : 0);
      if (!n) {
        g.logMsg('You turn a spadeful over and nothing is moving in it.', 'event');
        return true;
      }
      g.gather('worm', { count: n, ql: 20 + g.rand() * 40 });
      g.note('worms');
      g.logMsg(`You turn the dirt over and pick ${n} worm${n > 1 ? 's' : ''} out of it.`, 'event');
      return true;
    },
  },
  {
    id: 'dig',
    label: 'Dig',
    verb: 'digging',
    skill: 'digging',
    tool: 'shovel',
    corner: true,
    stamina: 0.05,
    baseTime: 6,
    difficulty: 8,
    applies: (t, g) => t.kind === 'tile' && !!TILE_DEFS[tile(t, g)].digYield,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('shovel')) return 'You need a shovel to dig.';
      const under = cornerUnderBuilding(g, t.cx, t.cy);
      if (under) return under;
      /*
       * The same depth a pick works to. `<= 0` refused a corner standing
       * exactly *at* the waterline, where no water is drawn — the same height
       * and the same off-by-one that mining was fixed for, and digging was
       * left with.
       */
      if (g.world.getHeight(t.cx, t.cy) < -digDepth(g)) return 'The water is too deep here to work in.';
      if (g.world.getDirt(t.cx, t.cy) <= 0) return 'That corner is bare rock. Only a pickaxe will take it lower.';
      return levelStop(g, t.cx, t.cy, -1) ?? slopeRefusal(g, 'digging', t.cx, t.cy, -1);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      const def = TILE_DEFS[w.getTile(t.x, t.y)];
      if (!g.skillCheck('digging', 8, g.toolQl('shovel'))) {
        g.missed();
        g.logMsg('You fail to dig anything useful.', 'event');
        return;
      }
      w.setHeight(t.cx, t.cy, w.getHeight(t.cx, t.cy) - 1);
      const left = w.getDirt(t.cx, t.cy) - 1;
      w.setDirt(t.cx, t.cy, left);
      if (def.turnsToDirt) w.setTile(t.x, t.y, TileType.Dirt);
      if (left <= 0) {
        g.logMsg('Your shovel grates on bare rock.', 'event');
        g.exposeRock(t.cx, t.cy);
      }
      const yieldId = def.digYield ?? 'dirt';
      const item = g.gather(yieldId, { ql: g.productQl('digging', g.toolQl('shovel')) });
      g.logMsg(`You dig up some ${itemDef(yieldId).name.toLowerCase()} from the ${cornerName(t)} corner. (QL ${item.ql.toFixed(1)})`, 'event');
      // And one spadeful in a thousand that is not dirt at all.
      maybeMap(g, 'digging', 'shovel');
    },
  },
  /*
   * A Terraformer's Dig out the tile: all four corners down by one in a
   * single go, which is four digs' worth of ground in rather less than four
   * digs' time. Offered only to somebody holding the perk (`dig_tile`); the
   * island asks the same of it in `act_refusal_rules` and does it in
   * `perform_dig_tile`.
   */
  {
    id: 'dig_tile',
    label: 'Dig out the tile',
    verb: 'digging out the tile',
    skill: 'digging',
    tool: 'shovel',
    stamina: 0.12,
    baseTime: DIG_TILE_TIME,
    difficulty: 8,
    applies: (t, g) => t.kind === 'tile' && g.perk('dig_tile', 0) > 0 && !!TILE_DEFS[tile(t, g)].digYield,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (g.perk('dig_tile', 0) <= 0) return 'That wants a Terraformer who has learned to dig out a whole tile.';
      if (!g.inventory.has('shovel')) return 'You need a shovel to dig.';
      for (const [cx, cy] of tileCorners(t.x, t.y)) {
        const under = cornerUnderBuilding(g, cx, cy);
        if (under) return under;
        if (g.world.getHeight(cx, cy) < -digDepth(g)) return 'The water is too deep here to work in.';
        if (g.world.getDirt(cx, cy) <= 0) return 'A corner of it is bare rock. Only a pickaxe will take that lower.';
        const why = levelStop(g, cx, cy, -1) ?? slopeRefusal(g, 'digging', cx, cy, -1);
        if (why) return why;
      }
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      const def = TILE_DEFS[w.getTile(t.x, t.y)];
      if (!g.skillCheck('digging', 8, g.toolQl('shovel'))) {
        g.missed();
        g.logMsg('You fail to dig anything useful.', 'event');
        return;
      }
      for (const [cx, cy] of tileCorners(t.x, t.y)) {
        w.setHeight(cx, cy, w.getHeight(cx, cy) - 1);
        w.setDirt(cx, cy, w.getDirt(cx, cy) - 1);
        if (w.getDirt(cx, cy) <= 0) g.exposeRock(cx, cy);
      }
      if (def.turnsToDirt) w.setTile(t.x, t.y, TileType.Dirt);
      const yieldId = def.digYield ?? 'dirt';
      const item = g.gather(yieldId, { count: TILE_CORNERS, ql: g.productQl('digging', g.toolQl('shovel')) });
      g.logMsg(`You dig the whole tile down and come away with ${TILE_CORNERS} × ${itemDef(yieldId).name.toLowerCase()}. (QL ${item.ql.toFixed(1)})`, 'event');
    },
  },
  {
    id: 'dredge',
    label: 'Dredge',
    verb: 'dredging',
    skill: 'digging',
    tool: 'shovel',
    corner: true,
    stamina: 0.06,
    baseTime: 7,
    difficulty: 10,
    // Digging from a boat: the bottom comes up a spadeful at a time, to a
    // depth the shore never reaches, and deepens the water as it goes.
    applies: (t, g) => t.kind === 'tile' && !!g.afloat() && !!TILE_DEFS[tile(t, g)].digYield,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('shovel')) return 'You need a shovel to dredge with.';
      if (!g.afloat()) return 'Dredging is done from a boat.';
      const w = g.world;
      if (w.getHeight(t.cx, t.cy) >= 0) return 'That corner is above the water. Dig it from the shore.';
      if (w.getHeight(t.cx, t.cy) < -DREDGE_DEPTH) return 'The bottom is too deep to reach from a boat.';
      if (w.getDirt(t.cx, t.cy) <= 0) return 'That corner is bare rock down there. A shovel will not bite on it.';
      const under = cornerUnderBuilding(g, t.cx, t.cy);
      if (under) return under;
      return slopeRefusal(g, 'digging', t.cx, t.cy, -1);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      const def = TILE_DEFS[w.getTile(t.x, t.y)];
      if (!g.skillCheck('digging', 10, g.toolQl('shovel'))) {
        g.missed();
        g.logMsg('The shovel comes up with nothing but water.', 'event');
        return;
      }
      w.setHeight(t.cx, t.cy, w.getHeight(t.cx, t.cy) - 1);
      const left = w.getDirt(t.cx, t.cy) - 1;
      w.setDirt(t.cx, t.cy, left);
      if (def.turnsToDirt) w.setTile(t.x, t.y, TileType.Dirt);
      if (left <= 0) g.exposeRock(t.cx, t.cy);
      const yieldId = def.digYield ?? 'dirt';
      const item = g.gather(yieldId, { ql: g.productQl('digging', g.toolQl('shovel')) });
      g.logMsg(`You dredge up some ${itemDef(yieldId).name.toLowerCase()} off the bottom at the ${cornerName(t)} corner. (QL ${item.ql.toFixed(1)})`, 'event');
    },
  },
  {
    id: 'flatten',
    label: 'Flatten',
    verb: 'flattening',
    skill: 'digging',
    tool: 'shovel',
    repeat: true,
    stamina: 0.03,
    baseTime: 3.5,
    applies: (t, g) => t.kind === 'tile' && !!TILE_DEFS[tile(t, g)].digYield && needsFlattening(g, t.x, t.y),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('shovel')) return 'You need a shovel to flatten.';
      // Shallows are workable, to the depth a pick works to.
      if (g.world.centerHeight(t.x, t.y) < -digDepth(g)) return 'The water is too deep here to work in.';
      if (flattenTarget(g, t.x, t.y) < -digDepth(g)) return 'The ground you stand on is too deep to work from.';
      const under = underBuilding(g, t.x, t.y);
      if (under) return under;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return false;
      const w = g.world;
      const own = g.player.tileX === t.x && g.player.tileY === t.y;
      const target = flattenTarget(g, t.x, t.y);
      const cs = tileCorners(t.x, t.y);
      /*
       * The corners furthest above and below the height we are working
       * towards — and the high one has to be soil, because a shovel does not
       * move rock. It used to be the highest corner whatever it was made of,
       * and a tile with one rock shoulder on it stopped the whole run dead
       * with "Mine it down instead" while the other three corners still had
       * work in them. The rock is stepped round now and named at the end.
       */
      let hi = -1;
      let lo = -1;
      let rock = false;
      for (let i = 0; i < 4; i++) {
        const h = w.getHeight(cs[i][0], cs[i][1]);
        if (h > target && w.getDirt(cs[i][0], cs[i][1]) <= 0) rock = true;
        if (h > target && w.getDirt(cs[i][0], cs[i][1]) > 0
            && (hi < 0 || h > w.getHeight(cs[hi][0], cs[hi][1]))) hi = i;
        if (h < target && (lo < 0 || h < w.getHeight(cs[lo][0], cs[lo][1]))) lo = i;
      }
      if (hi < 0 && lo < 0) {
        g.logMsg(rock ? 'What is still standing high here is bare rock. Mine it down.' : 'There is nothing left to move here.', 'error');
        return false;
      }
      const raise = (i: number, by: number): void => {
        const [cx, cy] = cs[i];
        w.setHeight(cx, cy, w.getHeight(cx, cy) + by);
        w.setDirt(cx, cy, w.getDirt(cx, cy) + by);
        g.exposeRock(cx, cy);
      };
      if (hi >= 0 && lo >= 0) {
        // One corner down and one up: the dirt simply moves across the tile.
        raise(hi, -1);
        raise(lo, 1);
        g.logMsg('You move some dirt across the tile.', 'event');
      } else if (hi >= 0) {
        raise(hi, -1);
        // What the ground is made of, which digging has always read off the
        // tile and flattening never did: scrape a clay bank and you have clay.
        const got = TILE_DEFS[w.getTile(t.x, t.y)].digYield ?? 'dirt';
        g.gather(got, { ql: g.productQl('digging', g.toolQl('shovel')) });
        g.logMsg(`You scrape the ground down and pocket the ${itemDef(got).name.toLowerCase()}.`, 'event');
      } else {
        // Its own stuff first, and dirt after: dirt fills anything, and it
        // would be a strange rule that let you take clay out of a bank and
        // not put it back.
        const want = TILE_DEFS[w.getTile(t.x, t.y)].digYield ?? 'dirt';
        const got = spoilFrom(g, want === 'dirt' ? ['dirt'] : [want, 'dirt']);
        if (!got || !got.take()) {
          g.logMsg(`You need ${itemDef(want).name.toLowerCase()} or dirt to bring this ground up, in the pack or in something beside you.`, 'error');
          return false;
        }
        raise(lo, 1);
        g.logMsg(`You pack ${itemDef(got.id).name.toLowerCase()} in to bring the ground up.`, 'event');
      }
      if (TILE_DEFS[w.getTile(t.x, t.y)].turnsToDirt) w.setTile(t.x, t.y, TileType.Dirt);
      if (!needsFlattening(g, t.x, t.y)) {
        g.logMsg(own ? `The tile is now flat at its lowest corner.` : 'The tile is now flat and level with the ground you stand on.', 'event');
        return false;
      }
      return true;
    },
  },
  {
    id: 'drop_dirt',
    label: 'Drop dirt',
    labelFor: (t, g) => {
      const it = t.kind === 'tile' ? spoilFrom(g, SPOIL_ORDER, t.itemUid) : undefined;
      return it ? `Drop ${itemDef(it.id).name.toLowerCase()}` : 'Drop dirt';
    },
    verb: 'dropping dirt',
    skill: 'digging',
    corner: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => t.kind === 'tile' && !!spoilFrom(g, SPOIL_ORDER, t.itemUid),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      const it = spoilFrom(g, SPOIL_ORDER, t.itemUid);
      if (!it) {
        return t.itemUid !== undefined ? 'That is not dirt, clay or sand.'
          : 'You have no dirt, clay or sand to drop, and nothing beside you is holding any.';
      }
      const under = cornerUnderBuilding(g, t.cx, t.cy);
      if (under) return under;
      return levelStop(g, t.cx, t.cy, 1) ?? slopeRefusal(g, 'digging', t.cx, t.cy, 1);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const it = spoilFrom(g, SPOIL_ORDER, t.itemUid);
      if (!it || !it.take()) return;
      const w = g.world;
      w.setHeight(t.cx, t.cy, w.getHeight(t.cx, t.cy) + 1);
      w.setDirt(t.cx, t.cy, w.getDirt(t.cx, t.cy) + 1);
      g.exposeRock(t.cx, t.cy);
      // What the spadeful covers becomes what was in it: dirt, clay or sand.
      if (BURYABLE.has(w.getTile(t.x, t.y))) w.setTile(t.x, t.y, SPOIL_TILE[it.id]);
      g.logMsg(`You drop the ${itemDef(it.id).name.toLowerCase()} on the ${cornerName(t)} corner, raising the ground.`, 'event');
    },
  },
  {
    /*
     * A surveyor's level, and the mark everything else works to.
     *
     * Asked for as "flatten toward a chosen height" and "a run of goes that
     * knows when to stop", which turn out to be one thing: a mark. Sight it at
     * a corner and flattening aims at it instead of at the tile you are
     * standing on, and every job that moves that corner refuses once it is
     * there — so twenty-five spadefuls asked for at a bank stop the moment the
     * bank is down to the mark, rather than twenty-five spadefuls later.
     */
    id: 'take_level',
    label: 'Take the level here',
    verb: 'taking the level',
    instant: true,
    corner: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => t.kind === 'tile' && g.level !== g.world.getHeight(t.cx, t.cy),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.level = g.world.getHeight(t.cx, t.cy);
      g.logMsg(`You sight the level at ${g.level}. Flattening works to it, and digging, dropping and concrete stop at it.`, 'event');
      g.events.emit('action');
    },
  },
  {
    id: 'clear_level',
    label: 'Clear the level',
    verb: 'clearing the level',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (_t, g) => g.level !== null,
    perform: (_t, g) => {
      g.level = null;
      g.logMsg('You put the level away. Flattening works to the ground you stand on again.', 'event');
      g.events.emit('action');
    },
  },
  /*
   * A Mason's Rubble Fill: the same step up on bare rock, bought with rock
   * shards rather than a concrete, under the same rules and the same check.
   */
  {
    id: 'rubble_fill',
    label: 'Raise the rock with rubble',
    verb: 'packing rubble',
    skill: 'masonry',
    tool: 'trowel',
    corner: true,
    stamina: 0.05,
    baseTime: 5,
    difficulty: 10,
    applies: (t, g) => t.kind === 'tile' && g.perk('rubble', 0) > 0 && g.inventory.count('rock_shards') >= g.perk('rubble', 0),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      const n = g.perk('rubble', 0);
      if (n <= 0) return 'That wants a Mason who has learned to fill with rubble.';
      if (g.inventory.count('rock_shards') < n) return `You need ${numberWord(n)} rock shards.`;
      return rockRaiseRefusal(g, t.cx, t.cy, 'Rubble');
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      if (!g.inventory.consume('rock_shards', g.perk('rubble', 0))) return;
      if (!g.skillCheck('masonry', 10, g.toolQl('trowel'))) {
        g.missed();
        g.logMsg('The rubble slides off the rock before it binds, and is lost.', 'event');
        return;
      }
      const w = g.world;
      w.setHeight(t.cx, t.cy, w.getHeight(t.cx, t.cy) + 1);
      g.exposeRock(t.cx, t.cy);
      g.logMsg(`You pack rubble into the ${cornerName(t)} corner and the rock stands a step higher.`, 'event');
    },
  },
  {
    id: 'raise_rock',
    label: 'Raise the rock with concrete',
    verb: 'laying concrete',
    skill: 'masonry',
    tool: 'trowel',
    corner: true,
    stamina: 0.04,
    baseTime: 5,
    difficulty: 10,
    applies: (t, g) => t.kind === 'tile' && g.inventory.has('concrete'),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('concrete')) return 'You have no concrete.';
      return rockRaiseRefusal(g, t.cx, t.cy, 'Concrete');
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      // Spent either way: concrete that slumps off is concrete gone.
      if (!g.inventory.consume('concrete')) return;
      if (!g.sureCheck('raise_rock', 'masonry', 10, g.toolQl('trowel'))) {
        g.missed();
        g.logMsg('The concrete slumps off the rock before it sets, and is lost.', 'event');
        return;
      }
      const w = g.world;
      // The rock rises: the height goes up and the soil over it stays nought.
      w.setHeight(t.cx, t.cy, w.getHeight(t.cx, t.cy) + 1);
      g.exposeRock(t.cx, t.cy);
      g.logMsg(`You lay concrete on the ${cornerName(t)} corner and the rock stands a step higher.`, 'event');
    },
  },
  {
    id: 'mine',
    label: 'Mine',
    verb: 'mining',
    skill: 'mining',
    tool: 'pickaxe',
    corner: true,
    stamina: 0.06,
    baseTime: 8,
    difficulty: 12,
    applies: (t, g) => t.kind === 'tile' && !!TILE_DEFS[tile(t, g)].mineable,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('pickaxe')) return 'You need a pickaxe to mine.';
      // A face that comes down brings a corner down with it (`MINE_COLLAPSE`): not under a building, a tile on piers among them.
      const under = cornerUnderBuilding(g, t.cx, t.cy);
      if (under) return under;
      if (g.world.getHeight(t.cx, t.cy) < -mineDepth(g)) return 'The water is too deep here to work in.';
      const ore = oreAt(g.world, t.x, t.y);
      if (ore && g.skills.get('mining') < oreNeeds(g, ore.level)) return `${ore.name} needs mining ${oreNeeds(g, ore.level)} to work. Yours is ${g.skills.get('mining').toFixed(1)}.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      const pickQl = g.toolQl('pickaxe');
      if (!g.sureCheck('mine', 'mining', 12, pickQl)) {
        g.missed();
        g.logMsg('The rock is hard and you fail to loosen anything.', 'event');
        return;
      }
      const type = w.getTile(t.x, t.y);
      const rock = bedrockAt(w, t.x, t.y);
      const yieldId = type === TileType.Rock ? rock.yields : 'rock_shards';
      if (yieldId.endsWith('_ore')) g.note('ore');
      // No seam gives up more quality than it holds, however good the miner.
      const item = g.gather(yieldId, { ql: Math.min(rock.maxQl, g.productQl('mining', pickQl)) });
      const what = itemDef(yieldId).name.toLowerCase();
      g.logMsg(yieldId.endsWith('lump') ? `You chip a ${what} out of the vein. (QL ${item.ql.toFixed(1)})` : `You mine some ${what}. (QL ${item.ql.toFixed(1)})`, 'event');
      // And one swing in a thousand that brings out something nobody quarried.
      maybeMap(g, 'mining', 'pickaxe');
      // And a stone, now and again, which is the other thing a miner is for.
      maybeGem(g, 'mining', 'pickaxe');
      // Cutting the face back is its own job, with its own entry in the menu.
      // Now and again one comes down anyway.
      if (g.rand() < MINE_COLLAPSE) {
        w.setHeight(t.cx, t.cy, w.getHeight(t.cx, t.cy) - 1);
        w.setDirt(t.cx, t.cy, 0);
        g.exposeRock(t.cx, t.cy);
        g.logMsg('A slab breaks away of its own accord and the face drops.', 'event');
      }
    },
  },
  {
    // Mining takes what is in the rock; this takes the rock itself. Three
    // swings in four find no line in it and the corner stands where it was.
    id: 'chip_corner',
    label: 'Chip corner',
    verb: 'chipping at the face',
    skill: 'mining',
    tool: 'pickaxe',
    corner: true,
    stamina: 0.07,
    baseTime: 9,
    applies: (t, g) => t.kind === 'tile' && !!TILE_DEFS[tile(t, g)].mineable,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('pickaxe')) return 'You need a pickaxe to cut rock.';
      const under = cornerUnderBuilding(g, t.cx, t.cy);
      if (under) return under;
      if (g.world.getHeight(t.cx, t.cy) < -mineDepth(g)) return 'The water is too deep here to work in.';
      const ore = oreAt(g.world, t.x, t.y);
      if (ore && g.skills.get('mining') < oreNeeds(g, ore.level)) return `${ore.name} needs mining ${oreNeeds(g, ore.level)} to work. Yours is ${g.skills.get('mining').toFixed(1)}.`;
      return levelStop(g, t.cx, t.cy, -1);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      if (g.rand() >= CHIP_CHANCE) {
        g.missed();
        g.logMsg(`You work at the ${cornerName(t)} corner and find no line in it. The face holds.`, 'event');
        return;
      }
      w.setHeight(t.cx, t.cy, w.getHeight(t.cx, t.cy) - 1);
      w.setDirt(t.cx, t.cy, 0);
      g.exposeRock(t.cx, t.cy);
      // What broke away is yours, which is the only thing this shares with mining.
      const rock = bedrockAt(w, t.x, t.y);
      const yieldId = w.getTile(t.x, t.y) === TileType.Rock ? rock.yields : 'rock_shards';
      if (yieldId.endsWith('_ore')) g.note('ore');
      const item = g.gather(yieldId, { ql: Math.min(rock.maxQl, g.productQl('mining', g.toolQl('pickaxe'))) });
      g.logMsg(`The ${cornerName(t)} corner breaks away and drops a step. You gather the ${itemDef(yieldId).name.toLowerCase()}. (QL ${item.ql.toFixed(1)})`, 'event');
    },
  },
  {
    id: 'prospect',
    label: 'Prospect',
    verb: 'prospecting',
    skill: 'prospecting',
    tool: 'pickaxe',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => t.kind === 'tile' && g.inventory.has('pickaxe'),
    check: (_t, g) => (g.inventory.has('pickaxe') ? null : 'You need a pickaxe to prospect.'),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      const radius = prospectReach(g);
      const found: string[] = [];
      const tiles: number[] = [];
      for (let y = t.y - radius; y <= t.y + radius; y++) {
        for (let x = t.x - radius; x <= t.x + radius; x++) {
          if (!w.inBounds(x, y)) continue;
          // Metal counts wherever it lies: bare, under soil, or below water.
          const rock = bedrockAt(w, x, y);
          // Anything worth mining, which is not the same as anything metal:
          // a coal seam yields plain `coal` and so fails the `_ore` test.
          if (!isSeam(rock)) continue;
          tiles.push(y * w.w + x);
          found.push(rock.name.toLowerCase());
        }
      }
      g.markProspected(tiles);
      // Sampling where you stand tells you what that particular rock holds.
      const here = bedrockAt(w, t.x, t.y);
      const buried = w.getTile(t.x, t.y) === TileType.Rock ? '' : ` It lies under ${Math.max(1, w.getDirt(t.x, t.y))} of ground.`;
      if (isSeam(here)) {
        const can = g.skills.get('mining') >= here.level;
        g.logMsg(
          `You sample the ${here.name.toLowerCase()}. It needs mining ${here.level} to work${can ? ', which you have' : ''}, and will give up nothing finer than quality ${here.maxQl}.${buried}`,
          'event',
        );
      } else {
        g.logMsg(`Plain ${here.name.toLowerCase()} beneath you, with no metal in it, and nothing finer than quality ${here.maxQl} in the stone.${buried}`, 'event');
      }
      if (!found.length) {
        g.logMsg(`You read the ground ${radius} tiles about you and find no sign of metal.`, 'event');
        return;
      }
      const tally = new Map<string, number>();
      for (const n of found) tally.set(n, (tally.get(n) ?? 0) + 1);
      const parts = [...tally].map(([n, c]) => (c > 1 ? `${c} tiles of ${n}` : `a tile of ${n}`));
      g.logMsg(`Within ${radius} tiles you read ${parts.join(' and ')}, buried or bare. They are marked for a while.`, 'event');
    },
  },
  /*
   * A Miner's Pan: sand washed at the water's edge, and now and then something
   * heavy left in the bottom of the pan. Offered only to somebody holding the
   * perk (`pan`, which is also the share of goes that find anything); the
   * island asks the same of it in `act_refusal_rules` and does it in
   * `perform_pan`.
   */
  {
    id: 'pan',
    label: 'Pan',
    verb: 'panning',
    skill: 'prospecting',
    stamina: 0.04,
    baseTime: PAN_TIME,
    applies: (t, g) => t.kind === 'tile' && g.perk('pan', 0) > 0 && tile(t, g) === TileType.Sand && besideWater(g, t.x, t.y),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (g.perk('pan', 0) <= 0) return 'That wants a Miner who has learned to pan.';
      if (tile(t, g) !== TileType.Sand) return 'Panning is done on sand.';
      if (!besideWater(g, t.x, t.y)) return 'There is no water at this sand to wash it in.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      if (g.rand() >= g.perk('pan', 0)) {
        g.missed();
        g.logMsg('You swirl the sand and water round the pan and find nothing in the bottom of it.', 'event');
        return;
      }
      const ore = PAN_ORES[Math.floor(g.rand() * PAN_ORES.length)];
      const item = g.gather(ore, { ql: g.productQl('prospecting', 0) });
      g.logMsg(`Something heavy settles in the bottom of the pan: ${itemDef(ore).name.toLowerCase()}. (QL ${item.ql.toFixed(1)})`, 'event');
    },
  },
  {
    id: 'cut_down',
    label: 'Cut down',
    verb: 'cutting down',
    skill: 'woodcutting',
    tool: 'hatchet',
    stamina: 0.07,
    baseTime: 8,
    difficulty: 10,
    applies: (t, g) => tile(t, g) === TileType.Tree || tile(t, g) === TileType.Bush,
    check: (t, g) => {
      // The tree may have come down since this was asked for; do not swing at air.
      const type = tile(t, g);
      if (type !== TileType.Tree && type !== TileType.Bush) return 'There is nothing standing here to cut down.';
      return g.inventory.has('hatchet') ? null : 'You need a hatchet to cut that down.';
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      const type = w.getTile(t.x, t.y);
      if (!g.sureCheck('cut_down', 'woodcutting', 10, g.toolQl('hatchet'))) {
        g.missed();
        g.logMsg('Your hatchet glances off and you fail to make headway.', 'event');
        return;
      }
      if (type === TileType.Bush) {
        w.setTile(t.x, t.y, TileType.Grass);
        g.logMsg('You hack the bush down.', 'event');
        return;
      }
      // Nothing standing is nothing to fell. `check` says so before the swing
      // and this says so after it: reading a tree off a tile that has none
      // gives you species 0 age 0 and a birch out of thin air, which is what
      // the suite got the first time it swung one stroke too many.
      if (type !== TileType.Tree) return;
      /*
       * A tree comes down in strokes, and how many depends on what it is.
       *
       * The count is kept in the tile rather than in the swinging, because a
       * wood is not one woodcutter's: leave a half-felled oak and the notch is
       * still in it tomorrow, for you or for whoever finds it. A cut that
       * glances off is not one of them — that is what the skill check above is
       * for, and it already returns before this line.
       */
      const data = w.getData(t.x, t.y);
      const def = TREE_DEFS[treeSpecies(data)];
      const age = treeAge(data);
      const cuts = w.notchAt(t.x, t.y) + 1;
      const what = `${age.name.toLowerCase()} ${def.name.toLowerCase()}`;
      if (cuts < age.hits) {
        w.setNotch(t.x, t.y, cuts);
        g.logMsg(`You cut into the ${what}. ${age.hits - cuts} more like that and it comes down.`, 'event');
        return;
      }
      g.note('tree');
      if (!age.logs) {
        // Nothing that size leaves a stump worth the name.
        w.setTile(t.x, t.y, TileType.Grass);
        g.logMsg(`You clear the ${what} away. There is no timber in one that size.`, 'event');
        return;
      }
      // A tree with timber in it leaves a stump, of its own kind, in the way
      // of the ground for a day or until somebody digs it out.
      w.setTile(t.x, t.y, TileType.Stump, packTreeData(treeSpecies(data), 0));
      const item = g.gather('log', { count: age.logs, ql: g.productQl('woodcutting', g.toolQl('hatchet')), extra: def.name });
      g.logMsg(`The ${what} comes down. You get ${age.logs} ${age.logs === 1 ? 'log' : 'logs'}. (QL ${item.ql.toFixed(1)}) The stump is left.`, 'event');
    },
  },
  {
    id: 'dig_stump',
    label: 'Dig out the stump',
    verb: 'digging out the stump',
    skill: 'digging',
    tool: 'shovel',
    stamina: 0.06,
    baseTime: 8,
    difficulty: 5,
    applies: (t, g) => tile(t, g) === TileType.Stump,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (g.world.getTile(t.x, t.y) !== TileType.Stump) return 'There is no stump here.';
      return g.inventory.has('shovel') ? null : 'You need a shovel to dig out a stump.';
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const def = TREE_DEFS[treeSpecies(g.world.getData(t.x, t.y))];
      if (!g.skillCheck('digging', 5, g.toolQl('shovel'))) {
        g.missed();
        g.logMsg(`The roots hold. You dig round the ${def.name.toLowerCase()} stump and it does not shift.`, 'event');
        return;
      }
      // Bare dirt where it stood: the roots came out with it.
      g.world.setTile(t.x, t.y, TileType.Dirt);
      g.logMsg(`You dig the ${def.name.toLowerCase()} stump out. The ground is bare dirt where it stood.`, 'event');
    },
  },
  {
    id: 'pick_sprout',
    label: 'Pick sprout',
    verb: 'picking a sprout',
    skill: 'forestry',
    stamina: 0.02,
    baseTime: 4,
    difficulty: 15,
    applies: (t, g) => tile(t, g) === TileType.Tree,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (g.world.getTile(t.x, t.y) !== TileType.Tree) return 'There is no tree here.';
      return treeAge(g.world.getData(t.x, t.y)).alive ? null : 'There is no life in it to sprout.';
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const def = TREE_DEFS[treeSpecies(g.world.getData(t.x, t.y))];
      if (!g.sureCheck('pick_sprout', 'forestry', 15)) {
        g.missed();
        g.logMsg('You find no sprout worth picking.', 'event');
        return;
      }
      // And picks more than one for a Forester's Sprout Picker (`count:sprout`), as the island does.
      const n = Math.max(1, Math.floor(g.perk('count:sprout', 1)));
      g.gather('sprout', { count: n, ql: g.productQl('forestry'), extra: def.name });
      g.logMsg(n === 1 ? `You pick a ${def.name.toLowerCase()} sprout.` : `You pick ${numberWord(n)} ${def.name.toLowerCase()} sprouts.`, 'event');
    },
  },
  {
    id: 'prune',
    label: 'Prune',
    verb: 'pruning',
    skill: 'forestry',
    tool: 'sickle',
    stamina: 0.03,
    baseTime: 6,
    difficulty: 20,
    applies: (t, g) => tile(t, g) === TileType.Tree,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (g.world.getTile(t.x, t.y) !== TileType.Tree) return 'There is no tree here to prune.';
      const data = g.world.getData(t.x, t.y);
      const age = treeAge(data);
      if (!age.alive) return 'There is no pruning a dead tree.';
      // What each stage prunes to is the table's: a stage back for a grown
      // tree, a shrub for good out of a sapling, and a young tree left to grow.
      // A stage whose next stage is itself is a shrub already kept.
      if (age.pruned === null && age.next === age.id) return 'It is clipped as far as it goes.';
      if (age.pruned === null) return `The ${TREE_DEFS[treeSpecies(data)].name.toLowerCase()} is too young to prune. Let it grow.`;
      return g.inventory.has('sickle') ? null : 'You need a sickle to prune.';
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const data = g.world.getData(t.x, t.y);
      const def = TREE_DEFS[treeSpecies(data)];
      const age = treeAge(data);
      const to = age.pruned === null ? undefined : TREE_AGES[age.pruned];
      if (!to) return;
      if (!g.skillCheck('forestry', 20, g.toolQl('sickle'))) {
        g.missed();
        g.logMsg(`You cut at the ${def.name.toLowerCase()} and take off nothing that matters.`, 'event');
        return;
      }
      // The age and nothing else. The species stays, and so does the notch a
      // hatchet has left in the trunk — it is beside the land, and the tile
      // is still a tree: pruning is the crown's business, and a half-felled
      // tree pruned back is still half felled.
      g.world.setTile(t.x, t.y, TileType.Tree, packTreeData(treeSpecies(data), to.id));
      g.logMsg(`You prune the ${age.name.toLowerCase()} ${def.name.toLowerCase()} back. It stands as a ${to.name.toLowerCase()} ${def.name.toLowerCase()} now.`, 'event');
    },
  },
  {
    id: 'harvest_bush',
    label: 'Harvest',
    labelFor: (t, g) => {
      const def = t.kind === 'tile' ? BUSH_DEFS[bushSpecies(g.world.getData(t.x, t.y))] : undefined;
      return def?.yields ? `Cut ${itemDef(def.yields).name.toLowerCase()}` : 'Harvest';
    },
    verb: 'harvesting',
    skill: 'forestry',
    tool: 'sickle',
    stamina: 0.02,
    baseTime: 4,
    applies: (t, g) => tile(t, g) === TileType.Bush,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (g.world.getTile(t.x, t.y) !== TileType.Bush) return 'There is no bush here.';
      const def = BUSH_DEFS[bushSpecies(g.world.getData(t.x, t.y))];
      if (!def.yields) return `Nothing on a ${def.name.toLowerCase()} is worth a sickle.`;
      if (g.isForaged(t.x, t.y, 'forage')) return `You have had what this ${def.name.toLowerCase()} has on it. Come back later.`;
      return g.inventory.has('sickle') ? null : 'You need a sickle to harvest a bush.';
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const def = BUSH_DEFS[bushSpecies(g.world.getData(t.x, t.y))];
      if (!def.yields) return;
      // As fruit off a tree: more to a practised hand, and never nothing.
      const skill = g.skills.get('forestry');
      const count = Math.max(1, Math.round(3 * (0.5 + skill / 130) * (0.7 + g.rand() * 0.6)));
      const made = g.gather(def.yields, { count, ql: g.productQl('forestry', g.toolQl('sickle')) });
      g.markForaged(t.x, t.y, 'forage');
      g.gainSkill('forestry', 0.35);
      g.logMsg(`You cut ${count} ${itemDef(def.yields).name.toLowerCase()} off the ${def.name.toLowerCase()}. (QL ${made.ql.toFixed(1)})`, 'event');
    },
  },
  {
    id: 'pick_fruit',
    label: 'Pick fruit',
    labelFor: (t, g) => {
      const def = t.kind === 'tile' ? TREE_DEFS[treeSpecies(g.world.getData(t.x, t.y))] : undefined;
      return def?.fruit ? `Pick ${itemDef(def.fruit).name.toLowerCase()}s` : 'Pick fruit';
    },
    verb: 'picking fruit',
    skill: 'forestry',
    repeat: true,
    stamina: 0.02,
    baseTime: 4,
    applies: (t, g) => {
      if (t.kind !== 'tile' || g.world.getTile(t.x, t.y) !== TileType.Tree) return false;
      return !!TREE_DEFS[treeSpecies(g.world.getData(t.x, t.y))].fruit;
    },
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      const data = g.world.getData(t.x, t.y);
      const def = TREE_DEFS[treeSpecies(data)];
      if (!def.fruit) return 'Nothing grows on this that you would eat.';
      if (!treeAge(data).alive) return 'Nothing hangs on a dead tree.';
      // A sapling bears nothing; it has to have some years in it first.
      if (!treeAge(data).bears) return `The ${def.name.toLowerCase()} is too young to bear. Leave it to grow.`;
      if (g.isForaged(t.x, t.y, 'forage')) return `You have had what this ${def.name.toLowerCase()} has on it. Come back later.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const data = g.world.getData(t.x, t.y);
      const def = TREE_DEFS[treeSpecies(data)];
      if (!def.fruit) return;
      // An old tree carries more than one only just come into bearing, and a
      // very old one as much as an old one.
      const old = treeVariant(data) === 2 || treeVariant(data) === 4;
      const skill = g.skills.get('forestry');
      const count = Math.max(1, Math.round((old ? FRUIT_OLD : FRUIT_MATURE) * (0.5 + skill / 130) * (0.7 + g.rand() * 0.6)));
      const made = g.gather(def.fruit, { count, ql: g.productQl('forestry'), });
      g.markForaged(t.x, t.y, 'forage');
      g.gainSkill('forestry', 0.35);
      g.logMsg(`You pick ${count} ${itemDef(def.fruit).name.toLowerCase()}${count === 1 ? '' : 's'} off the ${def.name.toLowerCase()}. (QL ${made.ql.toFixed(1)})`, 'event');
    },
  },
  {
    id: 'plant',
    label: 'Plant sprout',
    verb: 'planting',
    skill: 'forestry',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => DIGGABLE_PLANT_TILES.has(tile(t, g)) && g.inventory.has('sprout'),
    check: (t, g) => {
      // A tree would grow up through an aqueduct's arches.
      if (t.kind === 'tile' && g.bridgeAt(t.x, t.y)?.kind === 'aqueduct') return AQ_OVER;
      // The one chosen off the menu, or the first that comes to hand. Sprouts
      // come in nine species and do not look alike once they are twenty years
      // old, so a pack holding oak and cedar had no way to say which.
      const asked = t.kind === 'tile' ? t.itemUid : undefined;
      const chosen = asked !== undefined ? g.inventory.get(asked) : undefined;
      if (asked !== undefined && chosen?.id !== 'sprout') return 'That is not a sprout.';
      if (!chosen && !g.inventory.has('sprout')) return 'You have no sprout to plant.';
      // A grown tile of tree is something you walk round, not through, and the
      // sprout becomes that tile the moment it goes in. Planted underfoot it
      // closes over the person who planted it.
      if (t.kind === 'tile' && t.x === g.player.tileX && t.y === g.player.tileY) {
        return 'You would be planting it under your own feet. Step off the tile first.';
      }
      // Nor under a building, where a tile on piers has grass or sand under its deck (`piers.ts`).
      return t.kind === 'tile' ? underBuilding(g, t.x, t.y) : null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const picked = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
      const sprout = picked?.id === 'sprout' ? picked : g.inventory.find('sprout');
      if (!sprout) return;
      const species = Math.max(
        0,
        TREE_DEFS.findIndex((d) => d.name === sprout.extra),
      );
      g.inventory.remove(sprout.uid, 1);
      // Young, or further on for a Forester's Nursery.
      const age = plantedAge(g.perk('grown:plant', 0));
      g.world.setTile(t.x, t.y, TileType.Tree, packTreeData(species, age));
      g.note('planted');
      if (TREE_DEFS[species].fruit) g.note('orchard');
      const name = TREE_DEFS[species].name.toLowerCase();
      g.logMsg(`You plant the ${name} sprout.${age === PLANTED_AGE ? '' : ` It comes up a ${TREE_AGES[age].name.toLowerCase()} ${name}.`}`, 'event');
    },
  },
  {
    id: 'graft',
    label: 'Graft',
    labelFor: (t, g) => {
      const it = t.kind === 'tile' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
      return it?.extra ? `Graft ${it.extra.toLowerCase()} sprout` : 'Graft';
    },
    verb: 'grafting',
    skill: 'forestry',
    tool: 'carving_knife',
    stamina: 0.03,
    baseTime: 8,
    difficulty: 40,
    applies: (t, g) => tile(t, g) === TileType.Tree && g.inventory.items.some((it) => it.id === 'sprout' && fruitSprout(it)),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (g.world.getTile(t.x, t.y) !== TileType.Tree) return 'There is no tree here to graft to.';
      const data = g.world.getData(t.x, t.y);
      const age = treeAge(data);
      if (!age.alive) return 'There is no life in it to graft to.';
      if (TREE_DEFS[treeSpecies(data)].fruit) return 'It bears already.';
      // Grafting is the forester's finest work, and a beginner's graft is a
      // sprout thrown away.
      if (g.skills.get('forestry') < GRAFT_SKILL) return `You do not know enough of trees to graft one yet. It takes forestry ${GRAFT_SKILL}.`;
      const asked = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
      if (asked !== undefined && !(asked?.id === 'sprout' && fruitSprout(asked))) return 'That is not a fruit sprout.';
      if (!asked && !g.inventory.items.some((it) => it.id === 'sprout' && fruitSprout(it))) return 'You have no fruit sprout to graft.';
      if (!g.inventory.has('carving_knife')) return 'You need a carving knife to graft.';
      // Nor under a building (`piers.ts`).
      return underBuilding(g, t.x, t.y);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const picked = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
      const sprout = picked?.id === 'sprout' && fruitSprout(picked) ? picked : g.inventory.items.find((it) => it.id === 'sprout' && fruitSprout(it));
      if (!sprout) return;
      const data = g.world.getData(t.x, t.y);
      const was = TREE_DEFS[treeSpecies(data)];
      const species = TREE_DEFS.findIndex((d) => d.name === sprout.extra);
      if (species < 0) return;
      // The sprout is spent either way: a graft that does not take is a sprout gone.
      g.inventory.remove(sprout.uid, 1);
      if (!g.sureCheck('graft', 'forestry', 40, g.toolQl('carving_knife'))) {
        g.missed();
        g.logMsg(`The ${TREE_DEFS[species].name.toLowerCase()} graft does not take, and the sprout is spent.`, 'event');
        return;
      }
      // The species and nothing else: the age stays, and so does any notch.
      g.world.setTile(t.x, t.y, TileType.Tree, packTreeData(species, treeVariant(data)));
      g.note('orchard');
      g.logMsg(`You graft the ${TREE_DEFS[species].name.toLowerCase()} sprout onto the ${was.name.toLowerCase()}. It is a ${treeAge(data).name.toLowerCase()} ${TREE_DEFS[species].name.toLowerCase()} tree now.`, 'event');
    },
  },
  /*
   * A Forester's Coppice: a tree grown enough to bear cut back to the stool
   * for `coppice` logs, and left standing, young, to grow on. It grows on the
   * same clock as any other, so it is mature again at the next dawn. The
   * island does the same in `perform_ground`.
   */
  {
    id: 'coppice',
    label: 'Coppice',
    verb: 'coppicing',
    skill: 'woodcutting',
    tool: 'hatchet',
    stamina: 0.07,
    baseTime: 8,
    difficulty: 10,
    applies: (t, g) => t.kind === 'tile' && g.perk('coppice', 0) > 0 && tile(t, g) === TileType.Tree,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      // The tool first and then the rest, in the order the island asks them.
      if (!g.inventory.has('hatchet')) return 'You need a hatchet to coppice.';
      if (g.perk('coppice', 0) <= 0) return 'That wants a Forester who has learned to coppice.';
      if (g.world.getTile(t.x, t.y) !== TileType.Tree) return 'There is no tree here to coppice.';
      const data = g.world.getData(t.x, t.y);
      if (!treeAge(data).alive) return 'There is no coppicing a dead tree.';
      if (!coppiceable(data)) return `The ${TREE_DEFS[treeSpecies(data)].name.toLowerCase()} is too young to coppice. Let it grow.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      const data = w.getData(t.x, t.y);
      if (w.getTile(t.x, t.y) !== TileType.Tree || !coppiceable(data)) return;
      const def = TREE_DEFS[treeSpecies(data)];
      if (!g.skillCheck('woodcutting', 10, g.toolQl('hatchet'))) {
        g.missed();
        g.logMsg('Your hatchet glances off and you fail to make headway.', 'event');
        return;
      }
      // A fresh trunk off the stool: whatever notch was in the old one went with it.
      w.setTile(t.x, t.y, TileType.Tree, packTreeData(treeSpecies(data), PLANTED_AGE));
      w.setNotch(t.x, t.y, 0);
      const n = g.perk('coppice', 0);
      const item = g.gather('log', { count: n, ql: g.productQl('woodcutting', g.toolQl('hatchet')), extra: def.name });
      g.logMsg(`You cut the ${treeAge(data).name.toLowerCase()} ${def.name.toLowerCase()} back to the stool and get ${n} ${n === 1 ? 'log' : 'logs'}. (QL ${item.ql.toFixed(1)}) `
        + `It stands as a ${TREE_AGES[PLANTED_AGE].name.toLowerCase()} ${def.name.toLowerCase()} now.`, 'event');
    },
  },
  /*
   * A Forester's Tap Resin: `tap_resin` tar out of a living pine, once a day
   * for each pine -- the day turning at the woods' dawn. The island keeps
   * which pines are tapped (`foraged`, kind `resin`), and so does a game
   * played alone.
   */
  {
    id: 'tap_resin',
    label: 'Tap resin',
    verb: 'tapping resin',
    skill: 'forestry',
    tool: 'carving_knife',
    stamina: 0.03,
    baseTime: 6,
    applies: (t, g) => t.kind === 'tile' && g.perk('tap_resin', 0) > 0 && tile(t, g) === TileType.Tree
      && treeSpecies(g.world.getData(t.x, t.y)) === RESIN_TREE,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('carving_knife')) return 'You need a carving knife to tap resin.';
      if (g.perk('tap_resin', 0) <= 0) return 'That wants a Forester who has learned to tap resin.';
      if (g.world.getTile(t.x, t.y) !== TileType.Tree) return 'There is no tree here to tap.';
      const data = g.world.getData(t.x, t.y);
      const pine = TREE_DEFS[RESIN_TREE].name.toLowerCase();
      if (treeSpecies(data) !== RESIN_TREE) return `Only a ${pine} gives resin.`;
      if (!treeAge(data).alive) return `A dead ${pine} gives no resin.`;
      if (!tappable(data)) return `The ${pine} is too small to tap. Let it grow.`;
      if (g.tappedToday(t.x, t.y)) return `This ${pine} has given its resin today. It runs again at dawn.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const data = g.world.getData(t.x, t.y);
      if (g.world.getTile(t.x, t.y) !== TileType.Tree || !tappable(data) || g.tappedToday(t.x, t.y)) return;
      g.markTapped(t.x, t.y);
      const n = g.perk('tap_resin', 0);
      const item = g.gather('tar', { count: n, ql: g.productQl('forestry', g.toolQl('carving_knife')) });
      g.logMsg(`You cut the ${TREE_DEFS[RESIN_TREE].name.toLowerCase()}'s bark and collect ${n} ${itemDef('tar').name.toLowerCase()} from it. (QL ${item.ql.toFixed(1)})`, 'event');
    },
  },
  /*
   * A Forester's Clear Brush: every bush and reed within `clear_brush` tiles
   * of the one chosen, cleared in one go. A bush leaves grass and reeds leave
   * bare dirt, as `CLEARED_TO` has it; nothing comes of it but the clearing.
   */
  {
    id: 'clear_brush',
    label: 'Clear brush',
    verb: 'clearing brush',
    skill: 'forestry',
    tool: 'sickle',
    stamina: 0.08,
    baseTime: 16,
    applies: (t, g) => t.kind === 'tile' && g.perk('clear_brush', 0) > 0 && CLEARED_TO[tile(t, g)] !== undefined,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('sickle')) return 'You need a sickle to clear brush.';
      if (g.perk('clear_brush', 0) <= 0) return 'That wants a Forester who has learned to clear brush.';
      if (CLEARED_TO[g.world.getTile(t.x, t.y)] === undefined) return 'There is no brush here to clear.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      const spots = brushAround(w, t.x, t.y, g.perk('clear_brush', 0));
      for (const [x, y] of spots) w.setTile(x, y, CLEARED_TO[w.getTile(x, y)] as TileType);
      g.logMsg(`You clear the brush off ${spots.length} ${spots.length === 1 ? 'tile' : 'tiles'}.`, 'event');
    },
  },
  {
    id: 'forage',
    label: 'Forage',
    verb: 'foraging',
    skill: 'foraging',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => t.kind === 'tile' && !!TILE_DEFS[tile(t, g)].forage,
    check: (t, g) => (t.kind === 'tile' && g.isForaged(t.x, t.y, 'forage') ? 'This spot has been picked clean for now.' : null),
    labelFor: (_t, g) => {
      const rolls = searches(g, 'forage', 'foraging');
      return rolls > 1 ? `Forage (${rolls} passes)` : 'Forage';
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.markForaged(t.x, t.y, 'forage');
      // A practised eye goes over the same ground more than once, and a
      // Naturalist's Keen Eye once more again.
      const rolls = searches(g, 'forage', 'foraging');
      const found = lookOver(g, 'forage', 'foraging', FORAGE_TABLE, rolls);
      if (!found.length) {
        g.missed();
        g.logMsg(rolls > 1 ? `You go over the ground ${rolls} times and find nothing edible.` : 'You find nothing edible.', 'event');
        return;
      }
      g.logMsg(`You find some ${listOf(found)}.`, 'event');
    },
  },
  {
    id: 'botanize',
    label: 'Botanize',
    verb: 'botanizing',
    skill: 'botanizing',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => t.kind === 'tile' && !!TILE_DEFS[tile(t, g)].botanize,
    check: (t, g) => (t.kind === 'tile' && g.isForaged(t.x, t.y, 'botanize') ? 'This spot has been picked clean for now.' : null),
    labelFor: (_t, g) => {
      const rolls = searches(g, 'botanize', 'botanizing');
      return rolls > 1 ? `Botanize (${rolls} passes)` : 'Botanize';
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.markForaged(t.x, t.y, 'botanize');
      const rolls = searches(g, 'botanize', 'botanizing');
      // At the water's edge the table has water lily roots and lotus seeds in it too.
      const found = lookOver(g, 'botanize', 'botanizing', atWaterEdge(g, t.x, t.y) ? BOTANIZE_WATER_TABLE : BOTANIZE_TABLE, rolls);
      if (!found.length) {
        g.missed();
        g.logMsg(rolls > 1 ? `You go over the ground ${rolls} times and find nothing of interest.` : 'You find nothing of interest.', 'event');
        return;
      }
      g.logMsg(`You find some ${listOf(found)}.`, 'event');
    },
  },
  {
    id: 'drink',
    label: 'Drink',
    verb: 'drinking',
    stamina: 0,
    baseTime: 2,
    applies: (t, g) => t.kind === 'tile' && g.world.hasWater(t.x, t.y),
    perform: (_t, g) => {
      g.player.stats.thirst = 1;
      g.logMsg('You drink the cool water. It is refreshing.', 'event');
    },
  },
  {
    id: 'pack',
    label: 'Pack',
    verb: 'packing',
    /*
     * Paving, not digging. Treading a road flat is the first thing a paver
     * does and none of it is digging — the shovel is in your hand to cut the
     * turf off, which is the same reason a paver carries one.
     */
    skill: 'paving',
    tool: 'shovel',
    stamina: 0.03,
    baseTime: 4,
    applies: (t, g) => PACKABLE.has(tile(t, g)),
    check: (t, g) => (t.kind === 'tile' && underBuilding(g, t.x, t.y)) || (g.inventory.has('shovel') ? null : 'You need a shovel to pack the ground.'),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const sod = tile(t, g) !== TileType.Dirt;
      g.world.setTile(t.x, t.y, TileType.PackedDirt);
      g.logMsg(sod ? 'You cut the turf away and tread the ground down firm.' : 'You pack the dirt down firmly.', 'event');
    },
  },
  {
    id: 'cultivate',
    label: 'Cultivate',
    verb: 'cultivating',
    skill: 'digging',
    tool: 'shovel',
    stamina: 0.03,
    baseTime: 4,
    applies: (t, g) => tile(t, g) === TileType.PackedDirt,
    check: (t, g) => (t.kind === 'tile' && underBuilding(g, t.x, t.y)) || (g.inventory.has('shovel') ? null : 'You need a shovel to cultivate.'),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.world.setTile(t.x, t.y, TileType.Dirt);
      g.logMsg('You break up the packed earth.', 'event');
    },
  },
  {
    id: 'pave_cobble',
    label: 'Pave (cobblestone)',
    verb: 'paving',
    skill: 'paving',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => tile(t, g) === TileType.PackedDirt,
    check: (t, g) => (t.kind === 'tile' && underBuilding(g, t.x, t.y)) || unpacked(t, g) || (g.inventory.has('stone_brick') ? null : 'You need a stone brick to lay cobblestone.'),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      if (!g.inventory.consume('stone_brick')) return;
      g.world.setTile(t.x, t.y, TileType.Cobblestone);
      // Laid, and bare: the moss starts from here (`greening.ts`).
      g.pavingSince.set(`${t.x},${t.y}`, greenNow());
      g.logMsg('You lay the cobblestones.', 'event');
    },
  },
  {
    id: 'pave_slabs',
    label: 'Pave (slabs)',
    verb: 'laying slabs',
    skill: 'paving',
    tool: 'trowel',
    stamina: 0.04,
    baseTime: 7,
    difficulty: 10,
    applies: (t, g) => tile(t, g) === TileType.PackedDirt,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      const under = underBuilding(g, t.x, t.y);
      if (under) return under;
      const soft = unpacked(t, g);
      if (soft) return soft;
      if (!g.inventory.has('trowel')) return 'You need a trowel to bed a slab.';
      const slab = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => SLAB_BY_ITEM.has(it.id));
      if (!slab || !SLAB_BY_ITEM.has(slab.id)) return 'You need a cut slab to pave with.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const slab = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => SLAB_BY_ITEM.has(it.id));
      const kind = slab && SLAB_BY_ITEM.get(slab.id);
      if (!slab || kind === undefined) return;
      if (!g.sureCheck('pave_slabs', 'paving', 10, slab.ql)) {
        g.missed();
        g.logMsg('The slab rocks on its bed however you set it. You leave it for now.', 'event');
        return;
      }
      if (!g.inventory.remove(slab.uid, 1)) return;
      g.world.setTile(t.x, t.y, TileType.Slabs, kind);
      g.pavingSince.set(`${t.x},${t.y}`, greenNow());
      g.logMsg(`You bed the ${itemDef(slab.id).name.toLowerCase()} down flat and true.`, 'event');
    },
  },
  {
    id: 'remove_paving',
    label: 'Remove paving',
    verb: 'breaking up the paving',
    skill: 'paving',
    tool: 'pickaxe',
    stamina: 0.04,
    baseTime: 5,
    applies: (t, g) => tile(t, g) === TileType.Cobblestone || tile(t, g) === TileType.Slabs,
    check: (t, g) => (t.kind === 'tile' && underBuilding(g, t.x, t.y)) || (g.inventory.has('pickaxe') ? null : 'You need a pickaxe to break up paving.'),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      // A slab comes up whole more often than not; a cobble does not.
      const wasSlab = g.world.getTile(t.x, t.y) === TileType.Slabs;
      const kind = wasSlab ? SLAB_VARIANTS[slabVariant(g.world.getData(t.x, t.y))] : null;
      g.world.setTile(t.x, t.y, TileType.Dirt);
      g.pavingSince.delete(`${t.x},${t.y}`);
      if (kind && g.rand() < 0.6) {
        const back = g.gather(kind.item, { ql: g.productQl('paving') });
        g.logMsg(`You lever the ${kind.name.toLowerCase().replace(/s$/, '')} up whole. (QL ${back.ql.toFixed(1)})`, 'event');
        return;
      }
      g.logMsg('You break up the paving, leaving bare dirt.', 'event');
    },
  },
  // Item actions
  {
    id: 'examine_item',
    label: 'Examine',
    verb: 'examining',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t) => t.kind === 'item',
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item) return;
      const def = itemDef(item.id);
      const desc = def.description ? ` ${def.description}` : '';
      // What it is made of is half of what it is, so it is said here.
      const made = materialOfItem(item);
      const stuff = made ? ` ${made.name}: ${made.note}` : '';
      const r = rarityOf(item);
      const rare = r.name ? ` It is ${r.name}: better at what it is for by a ${r.boost > 1.3 ? 'half' : r.boost > 1.15 ? 'quarter' : 'tenth'}, slower to wear and to rot, and can be bettered ${r.ceiling} past your own skill.` : '';
      // Rare work is signed, and what a maker's perks put into it is said.
      const by = `${item.maker ? ` Made by ${item.maker}.` : ''}${markSays(item.mark)}`;
      // A knack comes off something somebody made, so the examine line says so
      // for the same things the eating does.
      const skill = knackable(item.id) ? boonOf(g.seed, item.id) : null;
      const favours = (skill ? ` It favours ${(SKILL_DEFS.find((d) => d.id === skill)?.name ?? skill).toLowerCase()}.` : '')
        // And what an Artisan's circlet has in it.
        + (item.id === CIRCLET ? circletSays(item) : '');
      // What it is worth at the work now, which is rarely the number stamped on it.
      const worth = g.toolWorth(item);
      const at = itemDef(item.id).category === 'tool' && Math.abs(worth - item.ql) >= 0.05 ? ` It works as a ${worth.toFixed(1)} today.` : '';
      // And to a Cook's tongue, what a helping of it does (a Cook's Taste).
      const taste = g.perk('taste', 0) > 0 ? tasteSays(g, item) : '';
      g.logMsg(`${itemName(item)}: QL ${item.ql.toFixed(2)}, damage ${item.dmg.toFixed(2)}, weight ${itemWeight(item).toFixed(2)} kg.${at}${desc}${rare}${by}${favours}${stuff}${taste}`, 'event');
    },
  },
  {
    id: 'eat',
    label: 'Eat',
    verb: 'eating',
    stamina: 0,
    baseTime: 2,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && !!itemDef(item.id).food && !item.locked;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item) return;
      const def = itemDef(item.id);
      g.inventory.remove(item.uid, 1);
      // Fuller, the more and the longer for its maker's hand in it (a Cook's
      // Filling, Hearty and Flavoursome), whoever is eating it.
      g.player.stats.hunger = Math.min(1, g.player.stats.hunger + (def.food ?? 0) * (0.7 + item.ql / 200) * markOf(item, 'fill'));
      // A dish favours a trade, and having eaten it you are better at that
      // trade for a while.
      const favour = g.grantBoon(item.id, item.ql, markOf(item, 'knack'));
      const full = g.nourish(item.id, item.ql, markOf(item, 'feed'));
      g.logMsg(`You eat the ${def.name.toLowerCase()}.${favour ? ` ${favour}` : ''}${full ? ` ${full}` : ''}`, 'event');
    },
  },
  {
    id: 'stow_item',
    label: 'Put it in a bag',
    verb: 'stowing it',
    instant: true,
    quantity: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      if (!item || isBag(item) || g.isEquipped(item.uid)) return false;
      return g.inventory.items.some((b) => isBag(b) && !bagRefuses(b, { ...item, count: 1 }));
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (!item) return 'It is gone.';
      if (isBag(item)) return 'One bag will not go inside another.';
      // A bag with room for one of them is a bag worth walking a stack to:
      // what fits goes in and the rest stays loose in the pack.
      const bag = g.inventory.items.find((b) => isBag(b) && !bagRefuses(b, { ...item, count: 1 }));
      return bag ? null : 'There is no bag with room for it.';
    },
    maxRepeat: (t, g) => (t.kind === 'item' ? (g.inventory.get(t.uid)?.count ?? 1) : 1),
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const held = g.inventory.get(t.uid);
      if (!held) return;
      const want = Math.min(t.count ?? 1, held.count);
      const bag = g.inventory.items.find((b) => isBag(b) && !bagRefuses(b, { ...held, count: 1 }));
      if (!bag) return;
      const fits = Math.min(want, bagSpare(bag));
      if (fits <= 0) return;
      const taken = g.inventory.take(held.uid, fits);
      if (!taken || !bagAdd(bag, taken)) {
        if (taken) g.inventory.addItem(taken);
        return;
      }
      g.events.emit('inventory');
      g.logMsg(storedLine(taken.count, itemName(taken), itemDef(bag.id).name, want - taken.count), 'event');
    },
  },
  {
    id: 'empty_bag',
    label: 'Empty it out',
    verb: 'emptying it',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && isBag(item) && !!item.inside?.length;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const bag = g.inventory.get(t.uid);
      if (!bag?.inside?.length) return;
      const n = bag.inside.length;
      for (const it of bag.inside.splice(0)) g.inventory.addItem(it);
      g.events.emit('inventory');
      g.logMsg(`You turn the ${itemDef(bag.id).name.toLowerCase()} out: ${n} ${n === 1 ? 'thing' : 'things'} back in your pack.`, 'event');
    },
  },
  {
    id: 'repair_item',
    label: 'Repair',
    verb: 'repairing',
    skill: 'repair',
    repeat: true,
    stamina: 0.02,
    baseTime: 1,
    // Not offered on a find nobody has restored yet (`unrestored`), which nothing mends.
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && item.dmg > 0 && !unrestored(item);
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (!item) return 'It is gone.';
      if (unrestored(item)) return NOT_RESTORED;
      if (item.dmg <= 0) return 'There is nothing wrong with it.';
      if (item.ql <= REPAIR_FLOOR) return 'It is worn away to nothing and will not take another repair.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item || item.dmg <= 0) return;
      // A second's work: some of the damage comes out, and a little of the quality
      // with it — a little, not much, so mending a thing is not the end of it.
      // More out at a go for a Mender's Big Mend, less quality for each point of
      // it for Light Touch, and now and then none at all for Clean Repair.
      const go = repairGo(g.skills.get('repair'));
      const healed = Math.min(item.dmg, go.healed * g.perk('mend:repair_item', 1));
      const keep = g.perk('keep:repair_item', 0);
      const clean = keep > 0 && g.rand() < keep;
      item.dmg = Math.max(0, item.dmg - healed);
      if (!clean) item.ql = Math.max(REPAIR_FLOOR, item.ql - healed * go.cost * g.perk('cost:repair_item', 1));
      g.events.emit('inventory');
      g.gainSkill('repair', 0.25);
      if (item.dmg <= 0) {
        g.logMsg(`The ${itemName(item).toLowerCase()} is as sound as it will ever be again. (QL ${item.ql.toFixed(1)})`, 'event');
        return false;
      }
      // Keep at it while there is damage left and wind to do it with.
      return true;
    },
  },
  {
    /*
     * A Tailor's Patch: a cloth or a leather piece mended with a piece of its
     * own stuff, the perk's own number of damage off at a go and nothing off
     * its quality, where a repair takes a little off every time.
     */
    id: 'patch_item',
    label: 'Patch',
    verb: 'patching',
    stamina: 0.02,
    baseTime: 4,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && item.dmg > 0 && patchWith(item.id) !== null;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      if (g.perk('patch_item', 0) <= 0) return PATCH_PERK;
      const item = g.inventory.get(t.uid);
      if (!item) return 'It is gone.';
      const stuff = patchWith(item.id);
      if (!stuff) return 'Only cloth or leather takes a patch.';
      if (item.dmg <= 0) return 'There is nothing wrong with it.';
      if (!g.inventory.has(stuff)) return `You need ${stuff} to patch it with.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      const stuff = item ? patchWith(item.id) : null;
      const piece = stuff ? g.inventory.find(stuff) : undefined;
      if (!item || !stuff || !piece || !g.inventory.remove(piece.uid, 1)) return;
      const off = Math.min(item.dmg, g.perk('patch_item', 0));
      item.dmg = Math.max(0, item.dmg - off);
      g.events.emit('inventory');
      g.gainSkill(improvable(item.id)?.skill ?? 'tailoring', 0.25);
      // The piece by its plain name, as the island says it.
      g.logMsg(`You patch the ${itemDef(item.id).name.toLowerCase()} with ${stuff}. (damage ${item.dmg.toFixed(2)})`, 'event');
    },
  },
  {
    /*
     * A Mender's repair kit, which anybody who has one may use: `KIT_MEND`
     * damage off anything, wherever you are, and nothing off its quality, and
     * the kit is used up.
     */
    id: 'mend_kit',
    label: 'Use a repair kit',
    verb: 'mending',
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && item.dmg > 0 && item.id !== 'repair_kit' && !unrestored(item) && g.inventory.count('repair_kit') > 0;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (!item) return 'It is gone.';
      if (unrestored(item)) return NOT_RESTORED;
      if (item.dmg <= 0) return 'There is nothing wrong with it.';
      if (item.id === 'repair_kit') return 'A kit does not mend itself.';
      if (g.inventory.count('repair_kit') < 1) return 'You have no repair kit.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      const kit = g.inventory.find('repair_kit');
      if (!item || !kit || item.dmg <= 0 || !g.inventory.remove(kit.uid, 1)) return;
      item.dmg = Math.max(0, item.dmg - KIT_MEND);
      g.events.emit('inventory');
      g.gainSkill('repair', 0.25);
      g.logMsg(`You mend the ${itemDef(item.id).name.toLowerCase()} with a repair kit. (damage ${item.dmg.toFixed(2)})`, 'event');
    },
  },
  {
    /*
     * A Mender's sealant, which anybody who has some may work over a thing: it
     * never decays after, wherever it is left (`seal`, nought). A pile takes one
     * for each thing in it.
     */
    id: 'seal_item',
    label: 'Seal it',
    verb: 'sealing',
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && sealable(item) && g.inventory.count('sealant') > 0;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (!item) return 'It is gone.';
      if (item.id === 'sealant') return 'Sealant does not seal itself.';
      if (item.mark?.seal !== undefined) return 'It is sealed already.';
      const have = g.inventory.count('sealant');
      if (have < item.count) return `You need ${item.count} sealant to seal all ${item.count} of them; you have ${have}.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item || !sealable(item) || g.inventory.count('sealant') < item.count) return;
      g.inventory.consume('sealant', item.count);
      item.mark = { ...(item.mark ?? {}), seal: 0 };
      g.events.emit('inventory');
      g.gainSkill('repair', 0.1);
      g.logMsg(`You work the sealant over the ${itemName(item).toLowerCase()}. It will not decay now.`, 'event');
    },
  },
  {
    /*
     * A stone set in an Artisan's circlet, off the stone's own menu, by anybody
     * with a file: on jewellery at `CIRCLET_SET`, surer for a perk on it (an
     * Artisan's Sure Setting), and a stone that will not seat is taken out
     * again whole. It goes into the first circlet carried that has a setting
     * empty, by the order they were made, which is the island's order too.
     */
    id: 'set_in_circlet',
    label: 'Set in the circlet',
    verb: 'setting a stone',
    skill: 'jewellery',
    tool: 'file',
    stamina: 0.03,
    baseTime: 10,
    difficulty: CIRCLET_SET,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return item?.id === 'gem' && !!gemOf(item) && circletWithRoom(g.inventory.items) !== undefined;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (!item) return 'It is gone.';
      if (item.id !== 'gem' || !gemOf(item)) return 'Only a stone goes in a circlet.';
      if (!circletWithRoom(g.inventory.items)) return `You have no circlet with a setting empty: each takes ${CIRCLET_STONES} stones.`;
      if (!g.inventory.has('file')) return 'You need a file.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      const room = circletWithRoom(g.inventory.items);
      const circlet = room ? g.inventory.get(room.uid) : undefined;
      const gem = item ? gemOf(item) : undefined;
      if (!item || !circlet || !gem) return;
      if (!g.sureCheck('set_in_circlet', 'jewellery', CIRCLET_SET, g.toolQl('file'), g.mindEase())) {
        g.missed();
        g.logMsg(`The ${gem.name.toLowerCase()} will not seat, and you take it out again whole.`, 'event');
        return;
      }
      if (!g.inventory.remove(item.uid, 1)) return;
      circlet.extra = [...stonesOf(circlet).map((s) => s.name), gem.name].join(', ');
      g.events.emit('inventory');
      g.logMsg(`You seat the ${gem.name.toLowerCase()} in the circlet and close the claws over it: `
        + `${stonesOf(circlet).length} of its ${CIRCLET_STONES} settings are filled.`, 'event');
    },
  },
  {
    /*
     * An Artisan's Glaze: ashes worked into a slip and brushed over a fired
     * pot, bowl or jar, or an amphora, which never decays after, wherever it
     * is left (`glaze`, nought). Only an Artisan who has learned it.
     */
    id: 'glaze_item',
    label: 'Glaze it',
    verb: 'glazing',
    skill: 'pottery',
    stamina: 0.02,
    baseTime: 6,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && GLAZEABLE.has(item.id) && item.mark?.glaze === undefined;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      if (g.perk('glaze_item', 0) <= 0) return GLAZE_PERK;
      const item = g.inventory.get(t.uid);
      if (!item) return 'It is gone.';
      if (!GLAZEABLE.has(item.id)) return 'Only a fired pot, bowl or jar, or an amphora, takes a glaze.';
      if (item.mark?.glaze !== undefined) return 'It is glazed already.';
      if (g.inventory.count('ash') < GLAZE_ASH) return 'You need ashes to make a glaze of.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item || !GLAZEABLE.has(item.id) || item.mark?.glaze !== undefined || g.perk('glaze_item', 0) <= 0) return;
      if (!g.inventory.consume('ash', GLAZE_ASH)) return;
      item.mark = { ...(item.mark ?? {}), glaze: 0 };
      g.events.emit('inventory');
      g.logMsg(`You brush an ash glaze over the ${itemName(item).toLowerCase()} and it takes. It will not decay now.`, 'event');
    },
  },
  {
    id: 'drink_skin',
    label: 'Drink',
    verb: 'drinking',
    stamina: 0,
    baseTime: 1.5,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.held(t.uid);
      return !!item && !!itemDef(item.id).charges && !!itemDef(item.id).drink;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.held(t.uid);
      return item && (item.charges ?? 0) > 0 ? null : 'It is empty.';
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.held(t.uid);
      if (!item || !(item.charges ?? 0)) return;
      item.charges = (item.charges ?? 1) - 1;
      g.player.stats.thirst = Math.min(1, g.player.stats.thirst + (itemDef(item.id).drink ?? 0));
      g.inventory.onChange?.();
      // Milk and anything brewed favour a trade the way a cooked dish does,
      // and for longer for its brewer's hand in it (a Cook's Strong Brew).
      const favour = g.grantBoon(item.id, item.ql, markOf(item, 'knack'));
      const full = g.nourish(item.id, item.ql, markOf(item, 'feed'));
      g.logMsg(`You take a drink from the ${itemDef(item.id).name.toLowerCase()}.${favour ? ` ${favour}` : ''}${full ? ` ${full}` : ''}`, 'event');
    },
  },
  {
    id: 'fill_bucket',
    label: 'Fill with water',
    verb: 'filling the bucket',
    stamina: 0.01,
    baseTime: 2,
    applies: (t, g) => t.kind === 'item' && g.inventory.held(t.uid)?.id === 'bucket',
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      if (g.inventory.held(t.uid)?.id !== 'bucket') return 'That is not an empty bucket.';
      return sourceFor(g) ? null : 'You need water: a shore, a well, or a barrel with something in it.';
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.held(t.uid);
      if (!item || item.id !== 'bucket') return;
      const source = sourceFor(g);
      const got = fillFromSource(g, item);
      if (!got) return;
      g.logMsg(source?.from ? `You draw a bucket of ${got} out of the ${itemDef(source.from.kind).name.toLowerCase()}.` : 'You dip the bucket full of water.', 'event');
    },
  },
  {
    id: 'empty_bucket',
    label: 'Empty it out',
    verb: 'emptying the bucket',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const id = g.inventory.held(t.uid)?.id;
      return id === 'water_bucket' || id === 'lye_bucket';
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.held(t.uid);
      if (!item) return;
      const was = itemDef(item.id).name.toLowerCase();
      if (!vesselBecomes(g, item, 'bucket')) return;
      g.logMsg(`You tip the ${was} out.`, 'event');
    },
  },
  {
    id: 'fill_skin',
    label: 'Fill with water',
    verb: 'filling',
    stamina: 0,
    baseTime: 2,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.held(t.uid);
      return !!item && !!itemDef(item.id).charges;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.held(t.uid);
      if (item && (item.charges ?? 0) >= (itemDef(item.id).charges ?? 0)) return 'It is already full.';
      return waterNear(g) ? null : 'You need water: a shore, a well, or a barrel of it.';
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.held(t.uid);
      if (!item) return;
      item.charges = itemDef(item.id).charges ?? 0;
      g.inventory.onChange?.();
      g.logMsg(`You fill the ${itemDef(item.id).name.toLowerCase()} with water.`, 'event');
    },
  },
  {
    id: 'pick_up_all',
    label: 'Pick up everything here',
    verb: 'gathering up',
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => t.kind === 'ground' || (t.kind === 'tile' && g.sweepable(t.x, t.y) > 0),
    check: (t, g) => {
      const x = t.kind === 'ground' || t.kind === 'tile' ? t.x : g.player.tileX;
      const y = t.kind === 'ground' || t.kind === 'tile' ? t.y : g.player.tileY;
      return g.sweepable(x, y) ? null : 'There is nothing lying about here.';
    },
    perform: (t, g) => {
      const x = t.kind === 'ground' || t.kind === 'tile' ? t.x : g.player.tileX;
      const y = t.kind === 'ground' || t.kind === 'tile' ? t.y : g.player.tileY;
      const got = g.sweep(x, y);
      if (!got.length) {
        g.logMsg('There is nothing lying about here.', 'error');
        return;
      }
      const counts = new Map<string, number>();
      for (const it of got) counts.set(itemDef(it.id).name.toLowerCase(), (counts.get(itemDef(it.id).name.toLowerCase()) ?? 0) + it.count);
      const what = [...counts.entries()].map(([n, c]) => (c > 1 ? `${c} × ${n}` : n)).join(', ');
      g.logMsg(`You gather up ${what}.`, 'event');
    },
  },
  {
    id: 'lock_item',
    label: 'Keep this back',
    verb: 'setting it aside',
    instant: true,
    stamina: 0,
    baseTime: 0,
    /*
     * Only what is loose in your hands. This asked whether the thing was
     * *not* locked, which is also true of a thing that is not there at all —
     * so the entry turned up on anything in a crate or a bag and then did
     * nothing, and on an island fetched back "It is gone." Putting a thing by
     * is about keeping a craft from spending it, and a craft only spends what
     * is loose, so a stowed thing is already safe.
     */
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && !item.locked;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item) return;
      item.locked = true;
      g.logMsg(`You set the ${itemName(item).toLowerCase()} aside. Nothing will spend it, drop it or feed it away until you say so.`, 'info');
      g.events.emit('inventory');
    },
  },
  {
    id: 'unlock_item',
    label: 'Put it back in the pack',
    verb: 'putting it back',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => t.kind === 'item' && !!g.inventory.get(t.uid)?.locked,
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item) return;
      delete item.locked;
      g.logMsg(`The ${itemName(item).toLowerCase()} is fair game again.`, 'info');
      g.events.emit('inventory');
    },
  },
  {
    id: 'drop',
    label: 'Drop',
    verb: 'dropping',
    instant: true,
    quantity: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && !item.locked;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.take(t.uid, t.count ?? 1);
      if (!item) return;
      // Food set down by a Cook with Cool Pack, and fish by a Fisher with theirs, rots slower where it lies.
      const cool = (itemDef(item.id).category === 'food' ? g.perk('cool:food', 1) : 1) * g.perk(`cool:${item.id}`, 1);
      if (cool !== 1) item.cool = cool;
      else delete item.cool;
      g.dropOnGround(g.player.tileX, g.player.tileY, item);
      const what = item.count > 1 ? `${item.count} × ${itemName(item).toLowerCase()}` : `the ${itemName(item).toLowerCase()}`;
      g.logMsg(`You drop ${what} on the ground.`, 'event');
    },
  },
  {
    id: 'pick_up',
    label: 'Pick up',
    verb: 'picking up',
    stamina: 0.01,
    baseTime: 1,
    applies: (t) => t.kind === 'ground',
    check: (t, g) => (t.kind === 'ground' && g.groundAt(t.x, t.y).length ? null : 'There is nothing there any more.'),
    perform: (t, g) => {
      if (t.kind !== 'ground') return;
      const taken = g.takeFromGround(t.x, t.y, t.uid);
      if (!taken.length) return;
      for (const item of taken) g.inventory.addItem(item);
      const names = taken.map((it) => (it.count > 1 ? `${it.count} × ${itemName(it).toLowerCase()}` : itemName(it).toLowerCase()));
      g.logMsg(`You pick up ${names.join(', ')}.`, 'event');
    },
  },
  {
    id: 'found_settlement',
    asks: {
      question: 'What is your settlement called?',
      fallback: () => 'Homestead',
      declined: 'You decide not to found a settlement just yet.',
    },
    label: 'Found settlement here',
    verb: 'founding a settlement',
    stamina: 0.05,
    baseTime: 4,
    /*
     * On the tile, as well as on the stake.
     *
     * Reported as "still unable to place a deed stake", and it was not a
     * refusal at all: "there's no menu option at all, grey or otherwise". The
     * entry was only ever offered on the tile you are standing on — which is
     * right about where the token goes, and is the one tile on a phone that a
     * thumb cannot hit, because your own body is drawn over it.
     *
     * `range: 0` means the tile you are standing on, and `requestAction`
     * already knows how to walk somewhere before it acts. So the offer can be
     * made anywhere: pick a spot, your feet take you there, and the token goes
     * in where you end up — which is what the island was always going to do,
     * since it founds at the player's position and takes the stake out of the
     * pack without looking at what was clicked.
     */
    range: 0,
    applies: (t, g) => (t.kind === 'item' && g.inventory.get(t.uid)?.id === 'deed_stake')
      || (t.kind === 'tile' && g.inventory.items.some((it) => it.id === 'deed_stake')),
    check: (t, g) => {
      // The spot the token would go in: the tile picked, or the one underfoot
      // when the stake itself was the thing clicked.
      const x = t.kind === 'tile' ? t.x : g.player.tileX;
      const y = t.kind === 'tile' ? t.y : g.player.tileY;
      /*
       * Somebody else's border, which used to arrive as `g.deed` because an
       * island held one settlement and everybody was handed it. It is a
       * neighbour now, and the refusal can say whose.
       */
      const near = g.deedAt(x, y);
      if (near) {
        return `${near.name}${near.holder ? `, which is ${near.holder}'s,` : ''} already reaches there. Found yours further out.`;
      }
      /*
       * Only a settlement you founded stands in the way, which is the island's
       * rule (`deed_refusal` asks `founded_by`). On an island `g.deed` is the
       * first of yours, and with none of your own it is one you were asked
       * onto -- so this refused a citizen of somebody else's settlement as if
       * it were their own. Reported: "i disbanded my settlement so i could
       * make a new one but it's still telling me i can't because i already
       * have a deed ... i think it must be because i'm a citizen of
       * oceanport". No rank at all is the solo game, where the deed is yours.
       */
      if (g.deed && rankAtLeast(g.deed.role, 'founder')) return 'You already hold a settlement. Disband it first.';
      const w = g.world;
      if (x - DEED_RADIUS < 0 || y - DEED_RADIUS < 0 || x + DEED_RADIUS >= w.w || y + DEED_RADIUS >= w.h) return 'Too close to the edge of the world.';
      // A poured slab is dry, level ground standing above whatever is under
      // it, which is exactly what a token wants and is sometimes the only
      // such tile on a hillside.
      if (!g.slabAt(x, y)) {
        if (w.hasWater(x, y)) return 'The token must stand on dry land.';
        if (!w.isPassable(x, y)) return 'The token needs a clear tile.';
      }
      return null;
    },
    perform: (t, g) => {
      // The stake is taken out of the pack whichever way the job was asked
      // for: the island does the same, and never looks at what was clicked.
      const stake = t.kind === 'item' ? g.inventory.get(t.uid) : g.inventory.items.find((it) => it.id === 'deed_stake');
      if (!stake || stake.id !== 'deed_stake') return;
      // The name rides in on the target, put there by `requestAction` before
      // any of this — on an island this half runs over there, where there is
      // nobody to ask.
      const name = (t as { name?: string }).name ?? '';
      if (!name.trim()) return;
      if (!g.inventory.remove(stake.uid, 1)) return;
      g.deed = { name: name.trim().slice(0, 32), x: g.player.tileX, y: g.player.tileY, radius: DEED_RADIUS, level: 1 };
      g.placeDeedCrate();
      g.logMsg(`You found the settlement of ${g.deed.name}. The land ${DEED_RADIUS * 2 + 1} tiles across around the token is yours to build on. A deed crate stands beside the token.`, 'system');
      g.events.emit('world', g.deed.x, g.deed.y);
    },
  },
  {
    id: 'rename_deed',
    asks: {
      question: 'What should the settlement be called?',
      fallback: (_t, g) => g.deed?.name ?? '',
    },
    label: 'Rename settlement',
    verb: 'renaming',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => t.kind === 'tile' && g.isToken(t.x, t.y),
    perform: (t, g) => {
      if (!g.deed) return;
      const name = ((t as { name?: string }).name ?? '').trim();
      if (!name) return;
      g.deed.name = name.slice(0, 32);
      g.logMsg(`The settlement is now called ${g.deed.name}.`, 'system');
    },
  },
  {
    id: 'disband_deed',
    confirms: (_t, g) => (g.deed
      ? `Disband ${g.deed.name}? Its buildings and crates stay but nothing new can be built there, things left outside will rot at full speed, and any wildermon kept here run wild.`
      : null),
    label: 'Disband settlement',
    verb: 'disbanding',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => t.kind === 'tile' && g.isToken(t.x, t.y),
    perform: (_t, g) => {
      if (!g.deed) return;
      const name = g.deed.name;
      let freed = 0;
      // The settlement's workers go with it. One in a creature crate is in
      // your crate, not the settlement's, and stays yours.
      for (const c of g.creatures.list.values()) {
        if (c.mode === 'deed') {
          if (c.carrying) g.dropOnGround(Math.floor(c.x), Math.floor(c.y), c.carrying);
          c.carrying = null;
          c.mode = 'wild';
          c.name = SPECIES[c.species]?.name ?? c.name;
          freed++;
        }
      }
      // The settlement's own crate goes with the settlement. It used to be
      // quietly demoted to an ordinary crate and left standing, so founding
      // again put a second one beside the new token and the old one sat there
      // for good. Whatever was in it is tipped out where it stood rather than
      // vanishing with it.
      const crate = g.deedCrate();
      let tipped = 0;
      if (crate) {
        for (const it of [...crate.items]) {
          g.dropOnGround(crate.x, crate.y, it);
          tipped += 1;
        }
        crate.items.length = 0;
        g.removeCrate(crate.id);
      }
      for (const c of g.crates.values()) c.deed = false;
      g.deed = null;
      g.inventory.add('deed_stake', { ql: 50 });
      const spilt = tipped ? ` The deed crate comes up with it and ${tipped === 1 ? 'what was in it lies' : 'what was in it lies'} on the ground where it stood.` : ' The deed crate comes up with it.';
      g.logMsg(`You disband ${name}. You pull up the stake and pack it away.${crate ? spilt : ''}${freed ? ` ${freed} wildermon run off into the wild.` : ''}`, 'system');
    },
  },
  {
    id: 'cut_grass',
    label: 'Cut grass',
    verb: 'cutting grass',
    skill: 'foraging',
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => ([TileType.Grass, TileType.Steppe, TileType.Lawn, TileType.Tundra] as TileType[]).includes(tile(t, g)),
    check: (t, g) => (t.kind === 'tile' && g.isForaged(t.x, t.y, 'grass') ? 'The grass here is still short.' : null),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.markForaged(t.x, t.y, 'grass');
      // More to a cut for a Naturalist's Hay Cutter.
      const cut = g.perk('count:mixed_grass', GRASS_PER_CUT);
      g.gather('mixed_grass', { count: cut, ql: g.productQl('foraging') });
      // Grass kept cut on a deed becomes lawn: the tile counts the days.
      const w = g.world;
      if (w.getTile(t.x, t.y) === TileType.Grass && g.onDeed(t.x, t.y)) {
        const days = mownDays(w.getData(t.x, t.y));
        w.setTile(t.x, t.y, TileType.Grass, days | MOWN_TODAY);
        const left = LAWN_AFTER - days - 1;
        g.logMsg(`You cut ${numberWord(cut)} bundles of mixed grass.${left > 0 ? ` Kept cut, this will be lawn in ${left} more day${left === 1 ? '' : 's'}.` : ' Kept cut, this will be lawn tomorrow.'}`, 'event');
        return;
      }
      g.logMsg(`You cut ${numberWord(cut)} bundles of mixed grass.`, 'event');
    },
  },
  {
    // A moss tile is cut as grass is and gives moss, the tile staying moss;
    // cut, it is short until it has grown back like grass. The island's
    // `ground_refusal` and `perform_ground`.
    id: 'cut_moss',
    label: 'Cut moss',
    verb: 'cutting moss',
    skill: 'foraging',
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => tile(t, g) === TileType.Moss,
    check: (t, g) => (t.kind === 'tile' && g.isForaged(t.x, t.y, 'moss') ? 'The moss here is still short.' : null),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.markForaged(t.x, t.y, 'moss');
      g.gather('moss', { count: MOSS_PER_CUT, ql: g.productQl('foraging') });
      g.logMsg(`You cut ${numberWord(MOSS_PER_CUT)} clumps of moss.`, 'event');
    },
  },
  {
    id: 'cut_reeds',
    label: 'Cut reeds',
    verb: 'cutting reeds',
    skill: 'foraging',
    tool: 'carving_knife',
    stamina: 0.03,
    baseTime: 4,
    applies: (t, g) => tile(t, g) === TileType.Reed,
    check: (t, g) => {
      if (!g.inventory.has('carving_knife')) return 'You need a knife to cut reeds.';
      return t.kind === 'tile' && g.isForaged(t.x, t.y, 'reed') ? 'The reeds here are cut back to the water.' : null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.markForaged(t.x, t.y, 'reed');
      // Never fewer than a Naturalist's Reed Cutter says, whatever the roll.
      const count = Math.max(g.perk('count:reed', 0), REED_CUT + (g.rand() < g.skills.get('foraging') / REED_EXTRA_AT ? 1 : 0));
      g.gather('reed', { count, ql: g.productQl('foraging', g.toolQl('carving_knife')) });
      g.logMsg(`You cut ${count} reeds out of the bed.`, 'event');
    },
  },
  ...BUILD_ACTIONS,
  ...CREATURE_ACTIONS,
  ...CREATURE_CRATE_ACTIONS,
  ...HUSBANDRY_ACTIONS,
  ...DYE_ACTIONS,
  ...TRAP_ACTIONS,
  ...NAMING_ACTIONS,
  ...LANTERN_ACTIONS,
  ...LAMP_ACTIONS,
  ...COUNTER_ACTIONS,
  ...BRIDGE_ACTIONS,
  ...AQUEDUCT_ACTIONS,
  ...SPRING_ACTIONS,
  ...FLOWER_ACTIONS,
  ...WATER_GARDEN_ACTIONS,
  ...FOUNDATION_ACTIONS,
  ...STEPS_ACTIONS,
  ...FAITH_ACTIONS,
  ...BAUBLE_ACTIONS,
  ...SACRIFICE_ACTIONS,
  ...MEDITATION_ACTIONS,
  ...ARCHAEOLOGY_ACTIONS,
  ...TREASURE_ACTIONS,
  ...FIRST_AID_ACTIONS,
  ...REMEDY_ACTIONS,
  ...PLACEABLE_ACTIONS,
  ...CRATE_ACTIONS,
  ...LOCK_ACTIONS,
  ...RECIPE_ACTIONS,
  ...BUTCHER_ACTIONS,
  ...CAMPFIRE_ACTIONS,
  ...SMELTER_ACTIONS,
  ...KILN_ACTIONS,
  ...FURNITURE_ACTIONS,
  ...GEAR_ACTIONS,
  ...IMPROVE_ACTIONS,
  ...ANVIL_ACTIONS,
  ...POST_ACTIONS,
  ...FISHING_ACTIONS,
  ...BREWING_ACTIONS,
  ...DEED_ACTIONS,
  ...FARM_ACTIONS,
  ...GREEN_ACTIONS,
  {
    id: 'drop_dirt_here',
    label: 'Drop (raises the ground)',
    verb: 'dropping dirt',
    skill: 'digging',
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => t.kind === 'item' && g.inventory.get(t.uid)?.id === 'dirt',
    check: (_t, g) => {
      const c = g.nearestCornerToPlayer();
      // Not a corner of a building: standing on a deck on piers, the ground under it (`piers.ts`), as `drop_dirt` has it.
      return cornerUnderBuilding(g, c.cx, c.cy) ?? slopeRefusal(g, 'digging', c.cx, c.cy, 1);
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      if (!g.inventory.remove(t.uid, 1)) return;
      const c = g.nearestCornerToPlayer();
      const w = g.world;
      w.setHeight(c.cx, c.cy, w.getHeight(c.cx, c.cy) + 1);
      // The soil as well as the height, which the island has always written
      // here and this side never did: a spadeful is a spadeful of something.
      w.setDirt(c.cx, c.cy, w.getDirt(c.cx, c.cy) + 1);
      g.exposeRock(c.cx, c.cy);
      // And the ground it covered, which is the tile under your feet — the
      // corner it raises belongs to as many as four of them.
      const [fx, fy] = [g.player.tileX, g.player.tileY];
      if (BURYABLE.has(w.getTile(fx, fy))) w.setTile(fx, fy, TileType.Dirt);
      g.logMsg('You drop the dirt at your feet, raising the ground.', 'event');
    },
  },
];

/**
 * The jobs that change the shape or the surface of the ground, and so the ones
 * a settlement's border speaks for. Wrapped once here rather than written into
 * fourteen doors, so there is one rule and one wording, and every place that
 * asks a door — the menu, the belt, a job coming off the queue — is covered by
 * having asked it.
 */
const SHAPES_GROUND = new Set(['dig', 'dredge', 'flatten', 'drop_dirt', 'drop_dirt_here', 'raise_rock',
  'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble', 'pave_slabs', 'remove_paving',
  'dig_spring', 'stop_spring', 'dig_pool', 'fill_pool',
  'lay_steps', 'lay_timber_steps', 'take_up_steps', 'plant_moss',
  // Stepping stones laid and taken up, and a water lily or a lotus planted or pulled up.
  'lay_stones', 'lift_stones', 'plant_lily', 'plant_lotus', 'pull_water_plant']);
for (const def of ACTIONS) {
  if (!SHAPES_GROUND.has(def.id)) continue;
  const was = def.check;
  def.check = (t, g) => foreignGround(g, def, t) ?? was?.(t, g) ?? null;
}

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
