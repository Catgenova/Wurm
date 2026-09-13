import { TileType, TILE_DEFS, TREE_DEFS, BUSH_DEFS, treeSpecies, treeVariant, bushSpecies, packTreeData, SLAB_VARIANTS, SLAB_BY_ITEM, slabVariant } from '../world/tiles';
import { bedrockAt, oreAt } from '../world/ore';
import { BUILD_ACTIONS } from './buildActions';
import { ANVIL_ACTIONS } from './anvil';
import { CAMPFIRE_ACTIONS } from './campfire';
import { SMELTER_ACTIONS } from './smelter';
import { KILN_ACTIONS } from './kiln';
import { FARM_ACTIONS } from './farming';
import { BUTCHER_ACTIONS } from './butcher';
import { DEED_ACTIONS } from './deed';
import { CRATE_ACTIONS } from './crates';
import { CREATURE_ACTIONS } from './creatureActions';
import { SPECIES, type Stance } from './creatures';
import { BOTANIZE_TABLE, FORAGE_TABLE, rollTable } from './forage';
import type { FloorKind, Side, WallType } from './building';
import { DEED_RADIUS, type Game } from './game';
import { itemDef, itemName } from './items';
import { RECIPE_ACTIONS } from './recipes';

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
    }
  | { kind: 'crate'; id: number }
  | { kind: 'campfire'; id: number; itemUid?: number; count?: number }
  | { kind: 'smelter'; id: number; itemUid?: number; count?: number }
  | { kind: 'kiln'; id: number; itemUid?: number; count?: number }
  | { kind: 'anvil'; id: number; itemUid?: number; mouldUid?: number }
  | { kind: 'item'; uid: number; count?: number }
  | { kind: 'ground'; x: number; y: number; uid: number | null }
  | { kind: 'creature'; id: number; stance?: Stance; itemUid?: number };

export interface ActionDef {
  id: string;
  label: string;
  /** Present participle used in messages: "You start digging." */
  verb: string;
  skill?: string;
  /** Item id of the tool that must be carried. */
  tool?: string;
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
  /** Runs on completion. Return true to repeat. */
  perform(t: Target, g: Game): boolean | void;
}

const DIGGABLE_PLANT_TILES = new Set<number>([TileType.Grass, TileType.Dirt, TileType.Moss, TileType.Lawn, TileType.Steppe, TileType.Tundra]);

const cornerName = (t: Target & { kind: 'tile' }): string => {
  const ns = t.cy === t.y ? 'north' : 'south';
  const ew = t.cx === t.x ? 'west' : 'east';
  return `${ns}-${ew}`;
};

const tile = (t: Target, g: Game): TileType => (t.kind === 'tile' ? g.world.getTile(t.x, t.y) : TileType.Sand);

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
export const mineChance = (skill: number, pickQl: number): number => Math.max(0.08, Math.min(0.85, 0.1 + skill * 0.005 + pickQl * 0.002));

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
      if (g.world.getHeight(t.cx, t.cy) <= 0) return 'You cannot dig below the water level.';
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
      if (g.world.hasWater(t.x, t.y)) return 'You cannot flatten below the water level.';
      if (flattenTarget(g, t.x, t.y) < 0) return 'The ground you stand on is below the water line.';
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
        g.inventory.add('dirt', { ql: g.productQl('digging', g.toolQl('shovel')) });
        g.logMsg('You scrape the ground down and pocket the dirt.', 'event');
      } else {
        if (!g.inventory.consume('dirt')) {
          g.logMsg('You need dirt to bring this ground up to your level.', 'error');
          return false;
        }
        raise(lo, 1);
        g.logMsg('You pack dirt in to bring the ground up.', 'event');
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
      if (g.world.rockHeight(t.cx, t.cy) <= 0) return 'You cannot mine below the water level.';
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
      // No seam gives up more quality than it holds, however good the miner.
      const item = g.inventory.add(yieldId, { ql: Math.min(rock.maxQl, g.productQl('mining', pickQl)) });
      const what = itemDef(yieldId).name.toLowerCase();
      g.logMsg(yieldId.endsWith('lump') ? `You chip a ${what} out of the vein. (QL ${item.ql.toFixed(1)})` : `You mine some ${what}. (QL ${item.ql.toFixed(1)})`, 'event');
      // Cutting the face back is a separate matter, and mostly a question of skill.
      if (g.rand() < mineChance(g.skills.get('mining'), pickQl)) {
        w.setHeight(t.cx, t.cy, w.getHeight(t.cx, t.cy) - 1);
        w.setDirt(t.cx, t.cy, 0);
        g.exposeRock(t.cx, t.cy);
        g.logMsg('A slab breaks away and the face drops.', 'event');
      }
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
          if (!rock.ore) continue;
          tiles.push(y * w.w + x);
          found.push(rock.name.toLowerCase());
        }
      }
      g.markProspected(tiles);
      // Sampling where you stand tells you what that particular rock holds.
      const here = bedrockAt(w, t.x, t.y);
      const buried = w.getTile(t.x, t.y) === TileType.Rock ? '' : ` It lies under ${Math.max(1, w.getDirt(t.x, t.y))} of ground.`;
      if (here.ore) {
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
    check: (_t, g) => (g.inventory.has('hatchet') ? null : 'You need a hatchet to cut that down.'),
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
    id: 'plant',
    label: 'Plant sprout',
    verb: 'planting',
    skill: 'forestry',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => DIGGABLE_PLANT_TILES.has(tile(t, g)) && g.inventory.has('sprout'),
    check: (_t, g) => (g.inventory.has('sprout') ? null : 'You have no sprout to plant.'),
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
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.markForaged(t.x, t.y, 'forage');
      if (g.rand() < 0.2 || !g.skillCheck('foraging', 5)) {
        g.logMsg('You find nothing edible.', 'event');
        return;
      }
      const id = rollTable(FORAGE_TABLE, g.rand());
      const item = g.inventory.add(id, { ql: g.productQl('foraging') });
      g.logMsg(`You find some ${itemDef(id).name.toLowerCase()}. (QL ${item.ql.toFixed(1)})`, 'event');
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
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.markForaged(t.x, t.y, 'botanize');
      if (g.rand() < 0.2 || !g.skillCheck('botanizing', 5)) {
        g.logMsg('You find nothing of interest.', 'event');
        return;
      }
      const id = rollTable(BOTANIZE_TABLE, g.rand());
      const item = g.inventory.add(id, { ql: g.productQl('botanizing') });
      g.logMsg(`You find some ${itemDef(id).name.toLowerCase()}. (QL ${item.ql.toFixed(1)})`, 'event');
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
    skill: 'digging',
    tool: 'shovel',
    stamina: 0.03,
    baseTime: 4,
    applies: (t, g) => tile(t, g) === TileType.Dirt,
    check: (t, g) => (t.kind === 'tile' && underBuilding(g, t.x, t.y)) || (g.inventory.has('shovel') ? null : 'You need a shovel to pack the dirt.'),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.world.setTile(t.x, t.y, TileType.PackedDirt);
      g.logMsg('You pack the dirt down firmly.', 'event');
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
    applies: (t, g) => t.kind === 'tile' && !!TILE_DEFS[tile(t, g)].pavable && tile(t, g) !== TileType.Gravel,
    check: (t, g) => (t.kind === 'tile' && underBuilding(g, t.x, t.y)) || (g.inventory.has('rock_shards') ? null : 'You need rock shards to pave with gravel.'),
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
    applies: (t, g) => t.kind === 'tile' && (!!TILE_DEFS[tile(t, g)].pavable || tile(t, g) === TileType.Gravel) && tile(t, g) !== TileType.Cobblestone,
    check: (t, g) => (t.kind === 'tile' && underBuilding(g, t.x, t.y)) || (g.inventory.has('stone_brick') ? null : 'You need a stone brick to lay cobblestone.'),
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
    applies: (t, g) => t.kind === 'tile' && (!!TILE_DEFS[tile(t, g)].pavable || tile(t, g) === TileType.Gravel || tile(t, g) === TileType.Cobblestone) && tile(t, g) !== TileType.Slabs,
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      const under = underBuilding(g, t.x, t.y);
      if (under) return under;
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
      g.logMsg(`${itemName(item)}: QL ${item.ql.toFixed(2)}, damage ${item.dmg.toFixed(2)}, weight ${(def.weight * item.count).toFixed(2)} kg.${desc}`, 'event');
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
      return !!item && !!itemDef(item.id).food;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item) return;
      const def = itemDef(item.id);
      g.inventory.remove(item.uid, 1);
      g.player.stats.hunger = Math.min(1, g.player.stats.hunger + (def.food ?? 0) * (0.7 + item.ql / 200));
      g.logMsg(`You eat the ${def.name.toLowerCase()}.`, 'event');
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
      const item = g.inventory.get(t.uid);
      return !!item && !!itemDef(item.id).charges && !!itemDef(item.id).drink;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      return item && (item.charges ?? 0) > 0 ? null : 'It is empty.';
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item || !(item.charges ?? 0)) return;
      item.charges = (item.charges ?? 1) - 1;
      g.player.stats.thirst = Math.min(1, g.player.stats.thirst + (itemDef(item.id).drink ?? 0));
      g.inventory.onChange?.();
      g.logMsg(`You take a drink from the ${itemDef(item.id).name.toLowerCase()}.`, 'event');
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
      const item = g.inventory.get(t.uid);
      return !!item && !!itemDef(item.id).charges;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (item && (item.charges ?? 0) >= (itemDef(item.id).charges ?? 0)) return 'It is already full.';
      return g.nearWater() ? null : 'You need to stand next to water.';
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item) return;
      item.charges = itemDef(item.id).charges ?? 0;
      g.inventory.onChange?.();
      g.logMsg(`You fill the ${itemDef(item.id).name.toLowerCase()} with water.`, 'event');
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
      return !!item && item.id !== 'dirt';
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
    label: 'Found settlement here',
    verb: 'founding a settlement',
    stamina: 0.05,
    baseTime: 4,
    applies: (t, g) => t.kind === 'item' && g.inventory.get(t.uid)?.id === 'deed_stake',
    check: (_t, g) => {
      if (g.deed) return 'You already hold a settlement. Disband it first.';
      const x = g.player.tileX;
      const y = g.player.tileY;
      const w = g.world;
      if (x - DEED_RADIUS < 0 || y - DEED_RADIUS < 0 || x + DEED_RADIUS >= w.w || y + DEED_RADIUS >= w.h) return 'Too close to the edge of the world.';
      if (w.hasWater(x, y)) return 'The token must stand on dry land.';
      if (!w.isPassable(x, y)) return 'The token needs a clear tile.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const name = g.hooks.prompt('Name your settlement', 'Homestead');
      if (name === null || !name.trim()) {
        g.logMsg('You decide not to found a settlement just yet.', 'info');
        return;
      }
      if (!g.inventory.remove(t.uid, 1)) return;
      g.deed = { name: name.trim().slice(0, 32), x: g.player.tileX, y: g.player.tileY, radius: DEED_RADIUS, level: 1 };
      g.placeDeedCrate();
      g.logMsg(`You found the settlement of ${g.deed.name}. The land ${DEED_RADIUS * 2 + 1} tiles across around the token is yours to build on. A deed crate stands beside the token.`, 'system');
      g.events.emit('world', g.deed.x, g.deed.y);
    },
  },
  {
    id: 'rename_deed',
    label: 'Rename settlement',
    verb: 'renaming',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => t.kind === 'tile' && g.isToken(t.x, t.y),
    perform: (_t, g) => {
      if (!g.deed) return;
      const name = g.hooks.prompt('Rename the settlement', g.deed.name);
      if (name === null || !name.trim()) return;
      g.deed.name = name.trim().slice(0, 32);
      g.logMsg(`The settlement is now called ${g.deed.name}.`, 'system');
    },
  },
  {
    id: 'disband_deed',
    label: 'Disband settlement',
    verb: 'disbanding',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => t.kind === 'tile' && g.isToken(t.x, t.y),
    perform: (_t, g) => {
      if (!g.deed) return;
      if (!g.hooks.confirm(`Disband ${g.deed.name}? Its buildings and crates stay but nothing new can be built there, things left outside will rot at full speed, and any wildermon kept here run wild.`)) return;
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
      for (const c of g.crates.values()) c.deed = false;
      g.deed = null;
      g.inventory.add('deed_stake', { ql: 50 });
      g.logMsg(`You disband ${name}. You pull up the stake and pack it away.${freed ? ` ${freed} wildermon run off into the wild.` : ''}`, 'system');
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
  ...BUILD_ACTIONS,
  ...CREATURE_ACTIONS,
  ...CRATE_ACTIONS,
  ...RECIPE_ACTIONS,
  ...BUTCHER_ACTIONS,
  ...CAMPFIRE_ACTIONS,
  ...SMELTER_ACTIONS,
  ...KILN_ACTIONS,
  ...ANVIL_ACTIONS,
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
