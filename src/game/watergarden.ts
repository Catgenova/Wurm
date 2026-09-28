/**
 * The water garden: stepping stones laid across shallow water, and water
 * lilies and lotus planted in still water. (The third thing in it, the tiered
 * fountain, is a piece of furniture that draws its own water as a well does:
 * see `furniture.ts`.)
 *
 * Stepping stones are a tile (`TileType.SteppingStones`), laid over the bed of
 * the water with the bed kept in the tile's data byte, and walked dry-shod:
 * `Player.update` and the island's `in_deep_water` both say nobody swims on
 * one. A water plant is kept beside the land, a row to a tile, and what it is
 * at any moment is `waterPlantState` of when it was planted and last picked.
 *
 * Every refusal here is said in the same words, in the same order, by the
 * island's `water_garden_refusal`, and `supabase/test/pondlife.ts` holds the
 * two to each other.
 */
import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { waterDepth } from './fishing';
import { describeFrom, itemDef } from './items';
import { SWIM_DEPTH } from './player';
import { listed, numberWord, spanWords } from './words';
import { SLAB_BY_ITEM, SLAB_VARIANTS, STONE_BEDS, TileType, stonesBed, stonesData, stonesKind } from '../world/tiles';
import {
  WATER_PLANT_BY_ID, WATER_PLANT_DEEPEST, WATER_PLANT_SHALLOWEST, WATER_PLANTS, WATER_ROOTING, waterPlantState,
  type WaterPlant, type WaterPlantDef,
} from '../world/waterplants';

/* ---- Stepping stones --------------------------------------------------------------------------- */

/**
 * The deepest water a stepping stone stands on the bottom in, at the middle
 * of the tile, in height units: twice the depth a body starts to swim at, so
 * stones carry you over water you would otherwise swim.
 */
export const STONES_DEPTH = 2 * SWIM_DEPTH;
/** Cut slabs a tile of stepping stones takes, of any of the four stones: what a tile of slab paving takes. Taken up, they give it back. */
export const STONES_SLABS = 1;
/** How hard it is to set them firm on the bottom, at masonry, with the slab's quality helping as a tool's does. */
export const STONES_DIFFICULTY = 12;

/** A height in metres, to a tenth, as everything on the island says one. */
const metres = (units: number): string => (units / 10).toFixed(1);

/** The water plant on a tile, if one is planted there. */
const plantOn = (g: Game, x: number, y: number): WaterPlant | undefined => g.waterPlantAt(x, y);

/**
 * Why stepping stones cannot be laid on a tile, or null: they stand on the
 * bottom of water shallow enough for them -- the edge of the sea, a pond, or
 * ground a stream runs over -- on a bed they can be laid over.
 */
export function stonesRefusal(g: Game, x: number, y: number): string | null {
  const w = g.world;
  if (!w.inBounds(x, y)) return 'There is nothing there.';
  if (g.buildings.buildingAt(x, y)) return 'You cannot do that inside a building.';
  if (g.slabAt(x, y)) return 'Stepping stones stand on the bottom of the water, not on a poured slab.';
  const t = w.getTile(x, y);
  if (t === TileType.SteppingStones) return 'Stepping stones are laid here already.';
  if (!w.hasWater(x, y) && !(w.water?.runsOver(x, y) ?? false)) {
    return 'Stepping stones are laid across water: the edge of the sea, a pond, or where a stream runs.';
  }
  if (waterDepth(g, x, y) > STONES_DEPTH) {
    return `The water here is too deep. A stepping stone stands on the bottom only where it is ${metres(STONES_DEPTH)} m deep or less.`;
  }
  if (!STONE_BEDS.has(t)) return 'Stepping stones go on bare ground or what grows flat on it. Clear what stands or is laid here first.';
  const p = plantOn(g, x, y);
  if (p) return `A ${WATER_PLANT_BY_ID.get(p.kind)?.name.toLowerCase() ?? 'water plant'} grows here. Pull it up first.`;
  return null;
}

/** The cut slab stepping stones would be laid from: the one pointed at, or the first to hand. */
const slabFor = (g: Game, t: Target): ReturnType<Game['inventory']['get']> =>
  (t.kind === 'tile' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined)
  ?? g.inventory.items.find((it) => SLAB_BY_ITEM.has(it.id) && !it.locked);

/* ---- Water lilies and lotus --------------------------------------------------------------------- */

/**
 * Why a water plant cannot be planted on a tile, or null: in still water --
 * a pond, a pool, the shallows of the sea, never where a stream or a fall
 * runs -- between `WATER_PLANT_SHALLOWEST` and `WATER_PLANT_DEEPEST` deep at
 * the middle of the tile, one to a tile, and not among stepping stones.
 */
export function plantRefusal(g: Game, def: WaterPlantDef, x: number, y: number): string | null {
  const w = g.world;
  const name = def.name.toLowerCase();
  if (!w.inBounds(x, y)) return 'There is nothing there.';
  if (g.buildings.buildingAt(x, y)) return 'You cannot do that inside a building.';
  if (!w.hasWater(x, y)) return `A ${name} is planted in still water: a pond, a pool or the shallows of the sea.`;
  if (w.water?.runsOver(x, y)) return `The water runs here. A ${name} takes root only in still water.`;
  const depth = waterDepth(g, x, y);
  if (depth < WATER_PLANT_SHALLOWEST || depth > WATER_PLANT_DEEPEST) {
    return `A ${name} takes root where the water is ${metres(WATER_PLANT_SHALLOWEST)} to ${metres(WATER_PLANT_DEEPEST)} m deep.`;
  }
  if (w.stonesAt(x, y)) return 'Stepping stones are laid here.';
  const p = plantOn(g, x, y);
  if (p) return `A ${WATER_PLANT_BY_ID.get(p.kind)?.name.toLowerCase() ?? 'water plant'} grows here already.`;
  return null;
}

/** What a water plant does in the year, in so many words: "flowers in spring and summer" -- off its own seasons. */
export function yearSays(def: WaterPlantDef): string {
  const parts = [`flowers in ${listed([...def.flowers])}`];
  if (def.seeds.length) parts.push(`carries its seed heads in ${listed([...def.seeds])}`);
  return listed(parts);
}

/** Why a water plant's flower or seed head cannot be picked now, or null. */
export function pickRefusal(g: Game, x: number, y: number, now: number): string | null {
  const p = plantOn(g, x, y);
  const def = p && WATER_PLANT_BY_ID.get(p.kind);
  if (!p || !def) return 'Nothing is planted here.';
  if (!g.world.hasWater(x, y)) return 'Its water is gone. It lies in the mud until the water comes back.';
  const s = waterPlantState(def, p.at, p.picked, now);
  if (!s.rooted) return `It has not rooted yet. A ${def.name.toLowerCase()} roots ${spanWords(WATER_ROOTING)} after it is planted.`;
  if (!s.bears) return `A ${def.name.toLowerCase()} ${yearSays(def)}, and it is ${s.season} now.`;
  if (!s.ripe) return `Its ${s.bears === 'seed' ? 'seed head was' : 'flower was'} picked this ${s.season}. There is no other until the season turns.`;
  return null;
}

/**
 * What a water plant is doing now, in a line, for whoever points at it: rooting
 * and for how long yet, in flower or in seed and there to pick, picked this
 * season, in leaf, or only a root under the water -- and when that changes.
 */
export function describeWaterPlant(g: Game, p: WaterPlant, now: number): string {
  const def = WATER_PLANT_BY_ID.get(p.kind);
  if (!def) return '';
  const name = def.name;
  if (!g.world.hasWater(p.x, p.y)) return `${name}, lying in the mud: its water is gone.`;
  const s = waterPlantState(def, p.at, p.picked, now);
  if (!s.leaves) return `${name}: only its root, under the water, until its leaves come up in ${def.leaves[0]}.`;
  if (!s.rooted) return `${name}, rooting: it roots in ${spanWords(Math.max(1, p.at + WATER_ROOTING - now))}, and then ${yearSays(def)}.`;
  const what = s.bears === 'seed' ? 'seed head' : 'flower';
  if (s.bears && s.ripe) return `${name} in ${s.bears === 'seed' ? 'seed' : 'flower'}: pick its ${what}.`;
  if (s.bears) return `${name}: its ${what} was picked this ${s.season}, and there is no other until the season turns.`;
  return `${name} in leaf: it ${yearSays(def)}.`;
}

/**
 * Whether a tile is at the water's edge, where botanizing turns up water lily
 * roots and lotus seeds (`BOTANIZE_WATER_TABLE`): water on it, or on a tile
 * beside it -- the sea, a pond or a pool.
 */
export function atWaterEdge(g: Game, x: number, y: number): boolean {
  const w = g.world;
  for (const [dx, dy] of [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
    if (w.inBounds(x + dx, y + dy) && w.hasWater(x + dx, y + dy)) return true;
  }
  return false;
}

/* ---- Descriptions -------------------------------------------------------------------------------- */

const lily = WATER_PLANT_BY_ID.get('lily') as WaterPlantDef;
const lotus = WATER_PLANT_BY_ID.get('lotus') as WaterPlantDef;
const planting = {
  shallow: metres(WATER_PLANT_SHALLOWEST),
  deep: metres(WATER_PLANT_DEEPEST),
  rooting: spanWords(WATER_ROOTING),
};
describeFrom('lily_root', { ...planting, year: yearSays(lily) });
describeFrom('lotus_seed', { ...planting, year: yearSays(lotus), seeds: numberWord(lotus.seedCount ?? 0) });

/* ---- The actions --------------------------------------------------------------------------------- */

const tileOf = (t: Target): [number, number] | null => (t.kind === 'tile' ? [t.x, t.y] : null);

export const WATER_GARDEN_ACTIONS: ActionDef[] = [
  {
    id: 'lay_stones',
    label: 'Lay stepping stones',
    verb: 'laying stepping stones',
    skill: 'masonry',
    tool: 'trowel',
    stamina: 0.04,
    baseTime: 7,
    difficulty: STONES_DIFFICULTY,
    applies: (t, g) => t.kind === 'tile' && !g.world.stonesAt(t.x, t.y)
      && (g.world.hasWater(t.x, t.y) || (g.world.water?.runsOver(t.x, t.y) ?? false)) && !g.slabAt(t.x, t.y),
    check: (t, g) => {
      const at = tileOf(t);
      if (!at) return null;
      const why = stonesRefusal(g, at[0], at[1]);
      if (why) return why;
      if (!g.inventory.has('trowel')) return 'You need a trowel to set a stone.';
      const slab = slabFor(g, t);
      if (!slab || !SLAB_BY_ITEM.has(slab.id)) return 'You need a cut slab to break into stepping stones.';
      return null;
    },
    perform: (t, g) => {
      const at = tileOf(t);
      const slab = slabFor(g, t);
      const kind = slab && SLAB_BY_ITEM.get(slab.id);
      if (!at || !slab || kind === undefined) return;
      if (!g.sureCheck('lay_stones', 'masonry', STONES_DIFFICULTY, slab.ql)) {
        g.missed();
        g.logMsg('The stone rocks on the bottom however you set it. You leave it for now.', 'event');
        return;
      }
      if (!g.inventory.remove(slab.uid, STONES_SLABS)) return;
      const [x, y] = at;
      g.world.setTile(x, y, TileType.SteppingStones, stonesData(kind, g.world.getTile(x, y)));
      g.logMsg(`You break the ${itemDef(slab.id).name.toLowerCase()} into flat stones and set them on the bottom, a stride apart.`, 'event');
    },
  },
  {
    id: 'lift_stones',
    label: 'Take up the stepping stones',
    verb: 'taking up the stepping stones',
    skill: 'masonry',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => t.kind === 'tile' && g.world.stonesAt(t.x, t.y),
    check: (t, g) => {
      const at = tileOf(t);
      if (!at) return null;
      if (!g.world.stonesAt(at[0], at[1])) return 'There are no stepping stones here.';
      return g.buildings.buildingAt(at[0], at[1]) ? 'You cannot do that inside a building.' : null;
    },
    perform: (t, g) => {
      const at = tileOf(t);
      if (!at || !g.world.stonesAt(at[0], at[1])) return;
      const [x, y] = at;
      const data = g.world.getData(x, y);
      const stone = SLAB_VARIANTS[stonesKind(data)];
      const bed = stonesBed(data);
      // The bed goes back as it was: a rock one showing its own rock again.
      g.world.setTile(x, y, bed, bed === TileType.Rock ? g.world.rockKind(x, y) : 0);
      const back = g.gather(stone.item, { ql: g.productQl('masonry'), count: STONES_SLABS });
      g.logMsg(`You lift the stones out of the water, a ${itemDef(stone.item).name.toLowerCase()}'s worth. (QL ${back.ql.toFixed(1)})`, 'event');
    },
  },
  ...WATER_PLANTS.map((def): ActionDef => ({
    id: `plant_${def.id}`,
    label: `Plant a ${def.name.toLowerCase()}`,
    verb: `planting a ${def.name.toLowerCase()}`,
    skill: 'botanizing',
    stamina: 0.02,
    baseTime: 4,
    range: 2,
    applies: (t, g) => t.kind === 'tile' && g.inventory.has(def.from) && g.world.hasWater(t.x, t.y) && !g.waterPlantAt(t.x, t.y),
    check: (t, g) => {
      const at = tileOf(t);
      if (!at) return null;
      return plantRefusal(g, def, at[0], at[1]) ?? (g.inventory.has(def.from) ? null : `You have no ${itemDef(def.from).name.toLowerCase()} to plant.`);
    },
    perform: (t, g) => {
      const at = tileOf(t);
      if (!at || !g.inventory.consume(def.from)) return;
      g.plantWater(at[0], at[1], def.id, g.wallNow());
      g.logMsg(`You press the ${itemDef(def.from).name.toLowerCase()} into the mud under the water. It will root in ${spanWords(WATER_ROOTING)}.`, 'event');
    },
  })),
  {
    id: 'pick_water_plant',
    label: 'Pick',
    labelFor: (t, g) => {
      const p = t.kind === 'tile' ? g.waterPlantAt(t.x, t.y) : undefined;
      const def = p && WATER_PLANT_BY_ID.get(p.kind);
      if (!p || !def) return 'Pick';
      const s = waterPlantState(def, p.at, p.picked, g.wallNow());
      return s.bears === 'seed' ? `Pick the ${def.name.toLowerCase()} seed head` : `Pick the ${def.name.toLowerCase()} flower`;
    },
    verb: 'picking',
    skill: 'botanizing',
    stamina: 0.01,
    baseTime: 3,
    range: 2,
    applies: (t, g) => t.kind === 'tile' && !!g.waterPlantAt(t.x, t.y),
    check: (t, g) => (t.kind === 'tile' ? pickRefusal(g, t.x, t.y, g.wallNow()) : null),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const now = g.wallNow();
      const p = g.waterPlantAt(t.x, t.y);
      const def = p && WATER_PLANT_BY_ID.get(p.kind);
      if (!p || !def || pickRefusal(g, t.x, t.y, now)) return;
      const s = waterPlantState(def, p.at, p.picked, now);
      p.picked = now;
      const ql = g.productQl('botanizing');
      if (s.bears === 'seed' && def.seed) {
        const got = g.gather(def.seed, { ql, count: def.seedCount ?? 1 });
        g.logMsg(`You break the ${def.name.toLowerCase()} seed head open: ${numberWord(def.seedCount ?? 1)} ${itemDef(def.seed).name.toLowerCase()}. (QL ${got.ql.toFixed(1)})`, 'event');
      } else {
        const got = g.gather(def.flower, { ql });
        g.logMsg(`You pick a ${itemDef(def.flower).name.toLowerCase()}. (QL ${got.ql.toFixed(1)})`, 'event');
      }
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'pull_water_plant',
    label: 'Pull it up',
    labelFor: (t, g) => {
      const p = t.kind === 'tile' ? g.waterPlantAt(t.x, t.y) : undefined;
      return p ? `Pull up the ${WATER_PLANT_BY_ID.get(p.kind)?.name.toLowerCase() ?? 'water plant'}` : 'Pull it up';
    },
    verb: 'pulling it up',
    skill: 'botanizing',
    stamina: 0.02,
    baseTime: 3,
    range: 2,
    applies: (t, g) => t.kind === 'tile' && !!g.waterPlantAt(t.x, t.y),
    check: (t, g) => (t.kind === 'tile' && !g.waterPlantAt(t.x, t.y) ? 'Nothing is planted here.' : null),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const p = g.waterPlantAt(t.x, t.y);
      const def = p && WATER_PLANT_BY_ID.get(p.kind);
      if (!p || !def) return;
      g.pullWater(t.x, t.y);
      g.inventory.add(def.from, { ql: g.productQl('botanizing') });
      g.logMsg(`You pull up the ${def.name.toLowerCase()}, root and all.`, 'event');
    },
  },
];
