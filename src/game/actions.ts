import { TileType, TILE_DEFS, TREE_DEFS, BUSH_DEFS, treeSpecies, treeVariant, bushSpecies, packTreeData, SLAB_VARIANTS, SLAB_BY_ITEM, slabVariant } from '../world/tiles';
import { isSeam } from '../world/tiles';
import { bedrockAt, oreAt } from '../world/ore';
import { BUILD_ACTIONS } from './buildActions';
import { ANVIL_ACTIONS } from './anvil';
import { POST_ACTIONS } from './posts';
import { FISHING_ACTIONS } from './fishing';
import { BREWING_ACTIONS } from './brewing';
import { CAMPFIRE_ACTIONS } from './campfire';
import { SMELTER_ACTIONS } from './smelter';
import { KILN_ACTIONS } from './kiln';
import { FURNITURE_ACTIONS } from './furniture';
import { GEAR_ACTIONS } from './gear';
import { IMPROVE_ACTIONS } from './improve';
import { FARM_ACTIONS } from './farming';
import { BUTCHER_ACTIONS } from './butcher';
import { ARCHAEOLOGY_ACTIONS } from './archaeology';
import { TREASURE_ACTIONS, maybeMap } from './treasure';
import { FIRST_AID_ACTIONS } from './firstaid';
import { fillFromSource, PLACEABLE_ACTIONS, sourceFor, vesselBecomes, waterNear } from './placeables';
import { DEED_ACTIONS } from './deed';
import { CRATE_ACTIONS } from './crates';
import { CREATURE_ACTIONS } from './creatureActions';
import { HUSBANDRY_ACTIONS } from './husbandry';
import { DYE_ACTIONS } from './dyes';
import { TRAP_ACTIONS } from './traps';
import { BRIDGE_ACTIONS } from './bridges';
import { NAMING_ACTIONS } from './naming';
import { LANTERN_ACTIONS } from './lantern';
import { FAITH_ACTIONS } from './faith';
import { MEDITATION_ACTIONS } from './meditation';
import { SPECIES, type Stance } from './creatures';
import { BOTANIZE_TABLE, FORAGE_TABLE, listOf, rollsAt, rollTable } from './forage';
import type { FloorKind, Side, WallType } from './building';
import { DEED_RADIUS, type Game } from './game';
import { materialOfItem } from './materials';
import { boonOf } from './boons';
import { SKILL_DEFS } from './skills';
import { itemDef, itemName, itemWeight, rarityOf, bagAdd, bagRefuses, isBag } from './items';
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
      buildingId?: number;
      /** Subtile for placing objects. */
      sx?: number;
      sy?: number;
      itemUid?: number;
      /** Which cast is being called for, when one is. */
      spell?: string;
    }
  | { kind: 'crate'; id: number }
  | { kind: 'campfire'; id: number; itemUid?: number; count?: number }
  | { kind: 'smelter'; id: number; itemUid?: number; count?: number }
  | { kind: 'kiln'; id: number; itemUid?: number; count?: number }
  | { kind: 'furniture'; id: number; itemUid?: number; count?: number; brew?: string }
  | { kind: 'anvil'; id: number; itemUid?: number; mouldUid?: number }
  | { kind: 'post'; id: number; creatureId?: number }
  | { kind: 'trap'; id: number }
  | { kind: 'bridge'; id: number }
  | { kind: 'item'; uid: number; count?: number; spell?: string }
  | { kind: 'ground'; x: number; y: number; uid: number | null }
  | { kind: 'creature'; id: number; stance?: Stance; itemUid?: number };

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

/** Ground a shovel can tread down into packed dirt: soil, and anything growing on it. */
const PACKABLE = new Set<number>([TileType.Dirt, TileType.Grass, TileType.Lawn, TileType.Steppe, TileType.Tundra, TileType.Moss]);

const DIGGABLE_PLANT_TILES = new Set<number>([TileType.Grass, TileType.Dirt, TileType.Moss, TileType.Lawn, TileType.Steppe, TileType.Tundra]);

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
  const w = g.world;
  const heights = tileCorners(x, y).map(([cx, cy]) => w.getHeight(cx, cy));
  if (g.player.tileX === x && g.player.tileY === y) return Math.min(...heights);
  return Math.round(w.centerHeight(g.player.tileX, g.player.tileY));
}

/** True while any corner of the tile is off the height flattening aims at. */
export function needsFlattening(g: Game, x: number, y: number): boolean {
  const target = flattenTarget(g, x, y);
  return tileCorners(x, y).some(([cx, cy]) => g.world.getHeight(cx, cy) !== target);
}

/** The chance a swing cuts the rock face back, from skill and the pick. */
/**
 * How often working a face for its metal happens to bring a slab of it down.
 * Hardly ever: mining a seam is for what is in it, and a shaft that sinks
 * itself every third swing is a shaft nobody planned.
 */
export const MINE_COLLAPSE = 0.01;

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

/** Ground with anything living in it, and the damp ground that is full of them. */
export const WORMY = new Set<TileType>([TileType.Grass, TileType.Dirt, TileType.PackedDirt, TileType.Marsh, TileType.Moss]);
export const RICH_WORMS = new Set<TileType>([TileType.Marsh, TileType.Moss]);

/** How often a deliberate chip at a corner actually takes it down: one in four. */
export const CHIP_CHANCE = 0.25;

/** How far a prospector reads the ground: one tile further every ten levels. */
export const prospectRadius = (skill: number): number => 3 + Math.floor(skill / 10);

function maxDigSlope(g: Game): number {
  return Math.max(40, Math.floor(g.skills.get('digging') * 3));
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
        const age = ['young', 'mature', 'old'][treeVariant(w.getData(t.x, t.y))];
        text = `You see a ${age} ${TREE_DEFS[treeSpecies(w.getData(t.x, t.y))].name.toLowerCase()} tree at (${t.x}, ${t.y}).`;
      } else if (type === TileType.Bush) {
        text = `You see a ${BUSH_DEFS[bushSpecies(w.getData(t.x, t.y))].name.toLowerCase()} at (${t.x}, ${t.y}).`;
      }
      const water = w.hasWater(t.x, t.y) ? ' Water laps over it.' : '';
      let extra = '';
      if (g.isToken(t.x, t.y) && g.deed) extra += ` The settlement token of ${g.deed.name} stands here.`;
      else if (g.onDeed(t.x, t.y) && g.deed) extra += ` This is part of ${g.deed.name}.`;
      const b = g.buildings.buildingAt(t.x, t.y);
      if (b) extra += ` It belongs to ${b.name}, ${b.levels === 1 ? 'a single-storey building' : `${b.levels} storeys tall`}.`;
      const crates = g.cratesOnTile(t.x, t.y);
      if (crates.length) extra += ` ${crates.length === 1 ? 'A crate stands' : `${crates.length} crates stand`} here.`;
      g.logMsg(`${text} Height ${avg.toFixed(1)}, slope ${w.slope(t.x, t.y)}.${water}${extra}`, 'event');
    },
  },
  {
    // Sand, clay, peat and tar lie in beds. You fill a shovel off the top of
    // one without cutting the ground about, which is what digging a corner
    // does: stand on the tile, and the tile is as it was when you walk off it.
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
        g.logMsg(`Your shovel comes up with nothing but a smear of ${def.name.toLowerCase()}.`, 'event');
        return;
      }
      const item = g.inventory.add(yieldId, { ql: g.productQl('digging', g.toolQl('shovel')) });
      g.logMsg(`You fill a shovel with ${itemDef(yieldId).name.toLowerCase()} off the top of the bed. (QL ${item.ql.toFixed(1)})`, 'event');
    },
  },
  {
    id: 'dig_worms',
    label: 'Turn it over for worms',
    verb: 'turning the dirt over',
    skill: 'digging',
    tool: 'shovel',
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
      g.wearTool('shovel', 0.4);
      // Damp ground gives more than dry: a marsh is full of them.
      const rich = RICH_WORMS.has(g.world.getTile(t.x, t.y));
      const n = Math.floor(g.rand() * (rich ? 5 : 3)) + (rich ? 1 : 0);
      if (!n) {
        g.logMsg('You turn a spadeful over and nothing is moving in it.', 'event');
        return true;
      }
      g.inventory.add('worm', { count: n, ql: 20 + g.rand() * 40 });
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
      if (g.world.getHeight(t.cx, t.cy) < -MINE_DEPTH) return 'The water is too deep here to work in.';
      if (g.world.getDirt(t.cx, t.cy) <= 0) return 'That corner is bare rock. Only a pickaxe will take it lower.';
      if (slopeAfter(g, t.cx, t.cy, -1) > maxDigSlope(g)) return 'The slope would be too steep for your digging skill.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      const def = TILE_DEFS[w.getTile(t.x, t.y)];
      if (!g.skillCheck('digging', 8, g.toolQl('shovel'))) {
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
      const item = g.inventory.add(yieldId, { ql: g.productQl('digging', g.toolQl('shovel')) });
      g.logMsg(`You dig up some ${itemDef(yieldId).name.toLowerCase()} from the ${cornerName(t)} corner. (QL ${item.ql.toFixed(1)})`, 'event');
      // And one spadeful in a thousand that is not dirt at all.
      maybeMap(g, 'digging', 'shovel');
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
      if (g.world.centerHeight(t.x, t.y) < -MINE_DEPTH) return 'The water is too deep here to work in.';
      if (flattenTarget(g, t.x, t.y) < -MINE_DEPTH) return 'The ground you stand on is too deep to work from.';
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
      // The corners furthest above and below the height we are working towards.
      let hi = -1;
      let lo = -1;
      for (let i = 0; i < 4; i++) {
        const h = w.getHeight(cs[i][0], cs[i][1]);
        if (h > target && (hi < 0 || h > w.getHeight(cs[hi][0], cs[hi][1]))) hi = i;
        if (h < target && (lo < 0 || h < w.getHeight(cs[lo][0], cs[lo][1]))) lo = i;
      }
      if (hi < 0 && lo < 0) return false;
      const raise = (i: number, by: number): void => {
        const [cx, cy] = cs[i];
        w.setHeight(cx, cy, w.getHeight(cx, cy) + by);
        w.setDirt(cx, cy, w.getDirt(cx, cy) + by);
        g.exposeRock(cx, cy);
      };
      // Only soil can be moved with a shovel; bedrock needs a pickaxe.
      if (hi >= 0 && w.getDirt(cs[hi][0], cs[hi][1]) <= 0) {
        g.logMsg('The high corner is bare rock. Mine it down instead.', 'error');
        return false;
      }
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
        g.inventory.add(got, { ql: g.productQl('digging', g.toolQl('shovel')) });
        g.logMsg(`You scrape the ground down and pocket the ${itemDef(got).name.toLowerCase()}.`, 'event');
      } else {
        // Its own stuff first, and dirt after: dirt fills anything, and it
        // would be a strange rule that let you take clay out of a bank and
        // not put it back.
        const want = TILE_DEFS[w.getTile(t.x, t.y)].digYield ?? 'dirt';
        const used = g.inventory.consume(want) ? want : (g.inventory.consume('dirt') ? 'dirt' : null);
        if (!used) {
          g.logMsg(`You need ${itemDef(want).name.toLowerCase()} or dirt to bring this ground up to your level.`, 'error');
          return false;
        }
        raise(lo, 1);
        g.logMsg(`You pack ${itemDef(used).name.toLowerCase()} in to bring the ground up.`, 'event');
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
    verb: 'dropping dirt',
    skill: 'digging',
    corner: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => t.kind === 'tile' && g.inventory.has('dirt'),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('dirt')) return 'You have no dirt to drop.';
      const under = cornerUnderBuilding(g, t.cx, t.cy);
      if (under) return under;
      if (slopeAfter(g, t.cx, t.cy, 1) > maxDigSlope(g)) return 'The slope would be too steep for your digging skill.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      if (!g.inventory.consume('dirt')) return;
      const w = g.world;
      w.setHeight(t.cx, t.cy, w.getHeight(t.cx, t.cy) + 1);
      w.setDirt(t.cx, t.cy, w.getDirt(t.cx, t.cy) + 1);
      g.exposeRock(t.cx, t.cy);
      const type = w.getTile(t.x, t.y);
      if (type === TileType.Grass || type === TileType.Lawn) w.setTile(t.x, t.y, TileType.Dirt);
      g.logMsg(`You drop the dirt on the ${cornerName(t)} corner, raising the ground.`, 'event');
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
      if (g.world.getHeight(t.cx, t.cy) < -MINE_DEPTH) return 'The water is too deep here to work in.';
      const ore = oreAt(g.world, t.x, t.y);
      if (ore && g.skills.get('mining') < ore.level) return `${ore.name} needs mining ${ore.level} to work. Yours is ${g.skills.get('mining').toFixed(1)}.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      const pickQl = g.toolQl('pickaxe');
      if (!g.skillCheck('mining', 12, pickQl)) {
        g.logMsg('The rock is hard and you fail to loosen anything.', 'event');
        return;
      }
      const type = w.getTile(t.x, t.y);
      const rock = bedrockAt(w, t.x, t.y);
      const yieldId = type === TileType.Rock ? rock.yields : 'rock_shards';
      if (yieldId.endsWith('_ore')) g.note('ore');
      // No seam gives up more quality than it holds, however good the miner.
      const item = g.inventory.add(yieldId, { ql: Math.min(rock.maxQl, g.productQl('mining', pickQl)) });
      const what = itemDef(yieldId).name.toLowerCase();
      g.logMsg(yieldId.endsWith('lump') ? `You chip a ${what} out of the vein. (QL ${item.ql.toFixed(1)})` : `You mine some ${what}. (QL ${item.ql.toFixed(1)})`, 'event');
      // And one swing in a thousand that brings out something nobody quarried.
      maybeMap(g, 'mining', 'pickaxe');
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
      if (g.world.getHeight(t.cx, t.cy) < -MINE_DEPTH) return 'The water is too deep here to work in.';
      const ore = oreAt(g.world, t.x, t.y);
      if (ore && g.skills.get('mining') < ore.level) return `${ore.name} needs mining ${ore.level} to work. Yours is ${g.skills.get('mining').toFixed(1)}.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const w = g.world;
      if (g.rand() >= CHIP_CHANCE) {
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
      const item = g.inventory.add(yieldId, { ql: Math.min(rock.maxQl, g.productQl('mining', g.toolQl('pickaxe'))) });
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
      const radius = prospectRadius(g.skills.get('prospecting'));
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
      if (!g.skillCheck('woodcutting', 10, g.toolQl('hatchet'))) {
        g.logMsg('Your hatchet glances off and you fail to make headway.', 'event');
        return;
      }
      if (type === TileType.Bush) {
        w.setTile(t.x, t.y, TileType.Grass);
        g.logMsg('You hack the bush down.', 'event');
        return;
      }
      const data = w.getData(t.x, t.y);
      const def = TREE_DEFS[treeSpecies(data)];
      const logs = def.logs + (treeVariant(data) === 2 ? 1 : 0);
      w.setTile(t.x, t.y, TileType.Grass);
      const item = g.inventory.add('log', { count: logs, ql: g.productQl('woodcutting', g.toolQl('hatchet')), extra: def.name });
      g.note('tree');
      g.logMsg(`The ${def.name.toLowerCase()} tree falls. You get ${logs} ${logs === 1 ? 'log' : 'logs'}. (QL ${item.ql.toFixed(1)})`, 'event');
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
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const def = TREE_DEFS[treeSpecies(g.world.getData(t.x, t.y))];
      if (!g.skillCheck('forestry', 15)) {
        g.logMsg('You find no sprout worth picking.', 'event');
        return;
      }
      g.inventory.add('sprout', { ql: g.productQl('forestry'), extra: def.name });
      g.logMsg(`You pick a ${def.name.toLowerCase()} sprout.`, 'event');
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
      // A sapling bears nothing; it has to have some years in it first.
      if (treeVariant(data) === 0) return `The ${def.name.toLowerCase()} is too young to bear. Leave it to grow.`;
      if (g.isForaged(t.x, t.y, 'forage')) return `You have had what this ${def.name.toLowerCase()} has on it. Come back later.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const data = g.world.getData(t.x, t.y);
      const def = TREE_DEFS[treeSpecies(data)];
      if (!def.fruit) return;
      // An old tree carries more than one only just come into bearing.
      const old = treeVariant(data) === 2;
      const skill = g.skills.get('forestry');
      const count = Math.max(1, Math.round((old ? 5 : 3) * (0.5 + skill / 130) * (0.7 + g.rand() * 0.6)));
      const made = g.inventory.add(def.fruit, { count, ql: g.productQl('forestry'), });
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
      if (!g.inventory.has('sprout')) return 'You have no sprout to plant.';
      // A grown tile of tree is something you walk round, not through, and the
      // sprout becomes that tile the moment it goes in. Planted underfoot it
      // closes over the person who planted it.
      if (t.kind === 'tile' && t.x === g.player.tileX && t.y === g.player.tileY) {
        return 'You would be planting it under your own feet. Step off the tile first.';
      }
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const sprout = g.inventory.find('sprout');
      if (!sprout) return;
      const species = Math.max(
        0,
        TREE_DEFS.findIndex((d) => d.name === sprout.extra),
      );
      g.inventory.remove(sprout.uid, 1);
      g.world.setTile(t.x, t.y, TileType.Tree, packTreeData(species, 0));
      g.note('planted');
      if (TREE_DEFS[species].fruit) g.note('orchard');
      g.logMsg(`You plant the ${TREE_DEFS[species].name.toLowerCase()} sprout.`, 'event');
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
      const rolls = rollsAt(g.skills.get('foraging'));
      return rolls > 1 ? `Forage (${rolls} passes)` : 'Forage';
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.markForaged(t.x, t.y, 'forage');
      // A practised eye goes over the same ground more than once.
      const rolls = rollsAt(g.skills.get('foraging'));
      const found: string[] = [];
      for (let i = 0; i < rolls; i++) {
        if (g.rand() < 0.2 || !g.skillCheck('foraging', 5)) continue;
        const id = rollTable(FORAGE_TABLE, g.rand());
        const item = g.inventory.add(id, { ql: g.productQl('foraging') });
        found.push(`${itemDef(id).name.toLowerCase()} (QL ${item.ql.toFixed(1)})`);
      }
      if (!found.length) {
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
      const rolls = rollsAt(g.skills.get('botanizing'));
      return rolls > 1 ? `Botanize (${rolls} passes)` : 'Botanize';
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.markForaged(t.x, t.y, 'botanize');
      const rolls = rollsAt(g.skills.get('botanizing'));
      const found: string[] = [];
      for (let i = 0; i < rolls; i++) {
        if (g.rand() < 0.2 || !g.skillCheck('botanizing', 5)) continue;
        const id = rollTable(BOTANIZE_TABLE, g.rand());
        const item = g.inventory.add(id, { ql: g.productQl('botanizing') });
        found.push(`${itemDef(id).name.toLowerCase()} (QL ${item.ql.toFixed(1)})`);
      }
      if (!found.length) {
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
    id: 'pave_gravel',
    label: 'Pave (gravel)',
    verb: 'paving',
    skill: 'paving',
    stamina: 0.03,
    baseTime: 4,
    applies: (t, g) => tile(t, g) === TileType.PackedDirt,
    check: (t, g) => (t.kind === 'tile' && underBuilding(g, t.x, t.y)) || unpacked(t, g) || (g.inventory.has('rock_shards') ? null : 'You need rock shards to pave with gravel.'),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      if (!g.inventory.consume('rock_shards')) return;
      g.world.setTile(t.x, t.y, TileType.Gravel);
      g.logMsg('You spread the crushed rock into a gravel surface.', 'event');
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
      if (!g.skillCheck('paving', 10, slab.ql)) {
        g.logMsg('The slab rocks on its bed however you set it. You leave it for now.', 'event');
        return;
      }
      if (!g.inventory.remove(slab.uid, 1)) return;
      g.world.setTile(t.x, t.y, TileType.Slabs, kind);
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
    applies: (t, g) => tile(t, g) === TileType.Gravel || tile(t, g) === TileType.Cobblestone || tile(t, g) === TileType.Slabs,
    check: (t, g) => (t.kind === 'tile' && underBuilding(g, t.x, t.y)) || (g.inventory.has('pickaxe') ? null : 'You need a pickaxe to break up paving.'),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      // A slab comes up whole more often than not; gravel and cobbles do not.
      const wasSlab = g.world.getTile(t.x, t.y) === TileType.Slabs;
      const kind = wasSlab ? SLAB_VARIANTS[slabVariant(g.world.getData(t.x, t.y))] : null;
      g.world.setTile(t.x, t.y, TileType.Dirt);
      if (kind && g.rand() < 0.6) {
        const back = g.inventory.add(kind.item, { ql: g.productQl('paving') });
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
      // A knack comes off something somebody made, so the examine line says so
      // for the same things the eating does.
      const skill = knackable(item.id) ? boonOf(g.seed, item.id) : null;
      const favours = skill ? ` It favours ${(SKILL_DEFS.find((d) => d.id === skill)?.name ?? skill).toLowerCase()}.` : '';
      // What it is worth at the work now, which is rarely the number stamped on it.
      const worth = g.toolWorth(item);
      const at = itemDef(item.id).category === 'tool' && Math.abs(worth - item.ql) >= 0.05 ? ` It works as a ${worth.toFixed(1)} today.` : '';
      g.logMsg(`${itemName(item)}: QL ${item.ql.toFixed(2)}, damage ${item.dmg.toFixed(2)}, weight ${itemWeight(item).toFixed(2)} kg.${at}${desc}${rare}${favours}${stuff}`, 'event');
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
      g.player.stats.hunger = Math.min(1, g.player.stats.hunger + (def.food ?? 0) * (0.7 + item.ql / 200));
      // A dish favours a trade, and having eaten it you are better at that
      // trade for a while.
      const favour = g.grantBoon(item.id, item.ql);
      const full = g.nourish(item.id, item.ql);
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
      const bag = g.inventory.items.find((b) => isBag(b) && !bagRefuses(b, { ...item, count: t.count ?? 1 }));
      return bag ? null : 'There is no bag with room for it.';
    },
    maxRepeat: (t, g) => (t.kind === 'item' ? (g.inventory.get(t.uid)?.count ?? 1) : 1),
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const held = g.inventory.get(t.uid);
      if (!held) return;
      const want = Math.min(t.count ?? 1, held.count);
      const bag = g.inventory.items.find((b) => isBag(b) && !bagRefuses(b, { ...held, count: want }));
      if (!bag) return;
      const taken = g.inventory.take(held.uid, want);
      if (!taken || !bagAdd(bag, taken)) {
        if (taken) g.inventory.addItem(taken);
        return;
      }
      g.events.emit('inventory');
      g.logMsg(`You put ${want > 1 ? `${want} × ` : ''}${itemName(taken).toLowerCase()} in the ${itemDef(bag.id).name.toLowerCase()}.`, 'event');
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
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && item.dmg > 0;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (!item) return 'It is gone.';
      if (item.dmg <= 0) return 'There is nothing wrong with it.';
      if (item.ql <= 1) return 'It is worn away to nothing and will not take another repair.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item || item.dmg <= 0) return;
      // A second's work: some of the damage comes out, and a little of the quality
      // with it — a little, not much, so mending a thing is not the end of it.
      const skill = g.skills.get('repair');
      const healed = Math.min(item.dmg, 1.2 + skill * 0.1);
      const lost = healed * Math.max(0.004, 0.03 - skill * 0.00026);
      item.dmg = Math.max(0, item.dmg - healed);
      item.ql = Math.max(1, item.ql - lost);
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
      // Milk and anything brewed favour a trade the way a cooked dish does.
      const favour = g.grantBoon(item.id, item.ql);
      const full = g.nourish(item.id, item.ql);
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
      return !!item && item.id !== 'dirt' && !item.locked;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.take(t.uid, t.count ?? 1);
      if (!item) return;
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
      if (g.deed) return 'You already hold a settlement. Disband it first.';
      const w = g.world;
      if (x - DEED_RADIUS < 0 || y - DEED_RADIUS < 0 || x + DEED_RADIUS >= w.w || y + DEED_RADIUS >= w.h) return 'Too close to the edge of the world.';
      if (w.hasWater(x, y)) return 'The token must stand on dry land.';
      if (!w.isPassable(x, y)) return 'The token needs a clear tile.';
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
      const d = g.deed;
      let freed = 0;
      for (const c of g.creatures.list.values()) {
        if (c.mode === 'stored' || c.mode === 'deed') {
          if (c.mode === 'stored') {
            c.x = d.x + 0.5;
            c.y = d.y + 1.5;
          }
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
      g.inventory.add('mixed_grass', { count: 2, ql: g.productQl('foraging') });
      g.logMsg('You cut two bundles of mixed grass.', 'event');
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
      const count = 2 + (g.rand() < g.skills.get('foraging') / 140 ? 1 : 0);
      g.inventory.add('reed', { count, ql: g.productQl('foraging', g.toolQl('carving_knife')) });
      g.logMsg(`You cut ${count} reeds out of the bed.`, 'event');
    },
  },
  ...BUILD_ACTIONS,
  ...CREATURE_ACTIONS,
  ...HUSBANDRY_ACTIONS,
  ...DYE_ACTIONS,
  ...TRAP_ACTIONS,
  ...NAMING_ACTIONS,
  ...LANTERN_ACTIONS,
  ...BRIDGE_ACTIONS,
  ...FAITH_ACTIONS,
  ...MEDITATION_ACTIONS,
  ...ARCHAEOLOGY_ACTIONS,
  ...TREASURE_ACTIONS,
  ...FIRST_AID_ACTIONS,
  ...PLACEABLE_ACTIONS,
  ...CRATE_ACTIONS,
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
      if (slopeAfter(g, c.cx, c.cy, 1) > maxDigSlope(g)) return 'The slope would be too steep for your digging skill.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      if (!g.inventory.remove(t.uid, 1)) return;
      const c = g.nearestCornerToPlayer();
      const w = g.world;
      w.setHeight(c.cx, c.cy, w.getHeight(c.cx, c.cy) + 1);
      g.logMsg('You drop the dirt at your feet, raising the ground.', 'event');
    },
  },
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
