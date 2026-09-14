import { TileType, TILE_DEFS } from '../world/tiles';
import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { itemDef, itemName } from './items';

/**
 * Farming: rake a field out of grass or dirt, sow a seed, tend it through
 * each stage of growth and harvest it. Tending is what makes a field worth
 * planting; skill is what makes the harvest good.
 */
export type CropKind = 'vegetable' | 'starch' | 'spice' | 'fibre';
/** Which set of shapes a crop is drawn with. */
export type CropLook = 'root' | 'leaf' | 'grain' | 'herb' | 'fibre';

export interface CropDef {
  id: string;
  name: string;
  /** Seed item sown to plant it. */
  seed: string;
  /** Item harvested from it. */
  produce: string;
  kind: CropKind;
  look: CropLook;
  /** Seconds each stage of growth takes. */
  stageSeconds: number;
  /** Foliage and fruit colours. */
  colors: [leaf: string, fruit: string];
}

/** Sown, sprouting, growing, ripe. The last stage is the one you harvest. */
export const CROP_STAGES = 4;
export const RIPE = CROP_STAGES - 1;
export const STAGE_NAMES = ['sown', 'sprouting', 'growing', 'ripe'];

const crop = (id: string, name: string, produce: string, kind: CropKind, look: CropLook, stageSeconds: number, colors: [string, string]): CropDef => ({
  id,
  name,
  seed: `${id}_seed`,
  produce,
  kind,
  look,
  stageSeconds,
  colors,
});

export const CROPS: Record<string, CropDef> = {
  // Vegetables come up quickly.
  onion: crop('onion', 'Onion', 'onion', 'vegetable', 'leaf', 70, ['#7fae55', '#c9a06a']),
  carrot: crop('carrot', 'Carrot', 'carrot', 'vegetable', 'root', 80, ['#6fa64e', '#e08b3c']),
  cabbage: crop('cabbage', 'Cabbage', 'cabbage', 'vegetable', 'leaf', 95, ['#79b45e', '#a8d08a']),
  // Starches take their time.
  potato: crop('potato', 'Potato', 'potato', 'starch', 'root', 110, ['#5f9c4a', '#caa268']),
  wheat: crop('wheat', 'Wheat', 'wheat', 'starch', 'grain', 130, ['#9cae5c', '#dcc36a']),
  corn: crop('corn', 'Corn', 'corn', 'starch', 'grain', 150, ['#6da84f', '#e6c451']),
  // Spices are quick but fussy.
  sage: crop('sage', 'Sage', 'sage', 'spice', 'herb', 60, ['#8fa98a', '#b9c7ad']),
  basil: crop('basil', 'Basil', 'basil', 'spice', 'herb', 55, ['#5fa04a', '#8fd07a']),
  thyme: crop('thyme', 'Thyme', 'thyme', 'spice', 'herb', 55, ['#7aa86a', '#c3d6a2']),
  mint: crop('mint', 'Mint', 'mint', 'spice', 'herb', 50, ['#6fbf8c', '#a9e0bd']),
  rosemary: crop('rosemary', 'Rosemary', 'rosemary', 'spice', 'herb', 65, ['#6f9184', '#a8bcae']),
  // Fibre, from the seeds that already turn up while botanizing.
  cotton: crop('cotton', 'Cotton', 'cotton', 'fibre', 'fibre', 120, ['#7ba55f', '#f0ece2']),
  wemp: crop('wemp', 'Wemp', 'wemp', 'fibre', 'fibre', 105, ['#82a862', '#cfd39a']),
};

export const CROP_LIST = Object.values(CROPS);
/** Seed item id to the crop it grows. */
export const CROP_BY_SEED = new Map(CROP_LIST.map((c) => [c.seed, c]));

export interface Crop {
  x: number;
  y: number;
  /** Crop id, a key of CROPS. */
  id: string;
  /** 0 sown, up to RIPE. */
  stage: number;
  /** Game time the current stage began. */
  stageAt: number;
  /** Stages tended so far; each one lifts the harvest. */
  tended: number;
  /** Whether the stage it is in has already been tended. */
  tendedNow: boolean;
  /** Quality the harvest will carry, built up while tending. */
  ql: number;
}

/** Tiles a field can be raked out of. */
export const TILLABLE = new Set<number>([TileType.Grass, TileType.Dirt, TileType.Lawn, TileType.Steppe, TileType.Tundra, TileType.Moss]);

/**
 * What a harvest gives. An untended field returns the seed it was sown from
 * and a single crop; tending every stage doubles the seed and quadruples the
 * crop.
 */
export function cropYield(tended: number): { seeds: number; produce: number } {
  const t = Math.max(0, Math.min(CROP_STAGES - 1, tended));
  return { seeds: t >= 2 ? 2 : 1, produce: 1 + t };
}

export const cropDef = (id: string): CropDef => CROPS[id] ?? CROPS.onion;
export const cropReady = (c: Crop): boolean => c.stage >= RIPE;
export const cropStageName = (c: Crop): string => STAGE_NAMES[Math.min(RIPE, c.stage)];

/** Seconds until this crop moves on, or null once it is ripe. */
export function cropTimeLeft(c: Crop, now: number): number | null {
  if (cropReady(c)) return null;
  return Math.max(0, cropDef(c.id).stageSeconds - (now - c.stageAt));
}

export function describeCrop(c: Crop, now: number): string {
  const def = cropDef(c.id);
  const left = cropTimeLeft(c, now);
  const when = left === null ? 'ready to harvest' : left > 90 ? `${Math.ceil(left / 60)} minutes to the next stage` : `${Math.ceil(left)} seconds to the next stage`;
  const y = cropYield(c.tended);
  return `${def.name}, ${cropStageName(c)} · ${when} · tended ${c.tended} of ${RIPE} times, for ${y.produce} ${itemDef(def.produce).name.toLowerCase()} and ${y.seeds} seed${y.seeds > 1 ? 's' : ''}`;
}

const cropOf = (g: Game, t: Target): Crop | undefined => (t.kind === 'tile' ? g.cropAt(t.x, t.y) : undefined);

export const FARM_ACTIONS: ActionDef[] = [
  {
    id: 'till',
    label: 'Till',
    verb: 'tilling',
    skill: 'farming',
    tool: 'rake',
    stamina: 0.04,
    baseTime: 5,
    applies: (t, g) => t.kind === 'tile' && TILLABLE.has(g.world.getTile(t.x, t.y)),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('rake')) return 'You need a rake to till the ground.';
      if (g.world.hasWater(t.x, t.y)) return 'You cannot till underwater.';
      if (g.buildings.buildingAt(t.x, t.y)) return 'Not inside a building.';
      if (g.world.slope(t.x, t.y) > 20) return 'The ground is too steep to work.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.world.setTile(t.x, t.y, TileType.Field);
      g.logMsg('You rake the ground into a field, ready for sowing.', 'event');
    },
  },
  {
    id: 'plant_seed',
    label: 'Sow',
    verb: 'sowing',
    skill: 'farming',
    hidden: true,
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => t.kind === 'tile' && g.world.getTile(t.x, t.y) === TileType.Field,
    check: (t, g) => {
      if (t.kind !== 'tile') return 'Choose a field.';
      if (g.world.getTile(t.x, t.y) !== TileType.Field) return 'Sow on a tilled field.';
      if (g.cropAt(t.x, t.y)) return 'Something is already growing there.';
      const seed = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
      if (!seed || !CROP_BY_SEED.has(seed.id)) return 'Choose a seed to sow.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.itemUid === undefined) return;
      const seed = g.inventory.get(t.itemUid);
      const def = seed && CROP_BY_SEED.get(seed.id);
      if (!seed || !def || !g.inventory.remove(seed.uid, 1)) return;
      g.plantCrop(t.x, t.y, def.id, seed.ql);
      g.logMsg(`You sow ${def.name.toLowerCase()}. It should be ${STAGE_NAMES[1]} in a couple of minutes.`, 'event');
    },
  },
  {
    id: 'tend_crop',
    label: 'Tend',
    verb: 'tending the field',
    skill: 'farming',
    stamina: 0.03,
    baseTime: 4,
    applies: (t, g) => cropOf(g, t) !== undefined,
    check: (t, g) => {
      const c = cropOf(g, t);
      if (!c) return 'Nothing is growing there.';
      if (cropReady(c)) return 'It is ripe. Harvest it.';
      if (c.tendedNow) return 'You have already tended it at this stage. Wait for it to grow on.';
      return null;
    },
    perform: (t, g) => {
      const c = cropOf(g, t);
      if (!c || c.tendedNow || cropReady(c)) return;
      c.tendedNow = true;
      c.tended += 1;
      // Quality follows the farmer, averaged over the care the field was given.
      c.ql = (c.ql * c.tended + g.productQl('farming')) / (c.tended + 1);
      const y = cropYield(c.tended);
      g.events.emit('world', c.x, c.y);
      const what = itemDef(cropDef(c.id).produce).name.toLowerCase();
      g.logMsg(`You weed and water the ${cropDef(c.id).name.toLowerCase()}. It should give ${y.produce} ${what} and ${y.seeds} seed${y.seeds > 1 ? 's' : ''}.`, 'event');
    },
  },
  {
    id: 'harvest_crop',
    label: 'Harvest',
    verb: 'harvesting',
    skill: 'farming',
    stamina: 0.04,
    baseTime: 5,
    applies: (t, g) => cropOf(g, t) !== undefined,
    check: (t, g) => {
      const c = cropOf(g, t);
      if (!c) return 'Nothing is growing there.';
      if (!cropReady(c)) return `It is only ${cropStageName(c)}. Let it grow.`;
      return null;
    },
    perform: (t, g) => {
      const c = cropOf(g, t);
      if (!c || !cropReady(c)) return;
      const def = cropDef(c.id);
      const y = cropYield(c.tended);
      // The field's own quality, lifted by the farmer's skill at harvest.
      const ql = Math.max(1, Math.min(100, (c.ql + g.productQl('farming')) / 2));
      // The gardener's path takes a third more out of the same ground.
      const more = g.walks('love', 5) ? 1.34 : 1;
      const got = Math.max(1, Math.round(y.produce * more));
      const produce = g.inventory.add(def.produce, { count: got, ql });
      g.inventory.add(def.seed, { count: y.seeds, ql });
      g.removeCrop(c.x, c.y);
      g.logMsg(
        `You harvest ${got} × ${itemName(produce).toLowerCase()} and ${y.seeds} ${itemDef(def.seed).name.toLowerCase()}. The field is ready to sow again. (QL ${ql.toFixed(1)})`,
        'event',
      );
    },
  },
  {
    id: 'clear_field',
    label: 'Clear the field',
    verb: 'clearing the field',
    skill: 'farming',
    stamina: 0.03,
    baseTime: 3,
    applies: (t, g) => t.kind === 'tile' && g.world.getTile(t.x, t.y) === TileType.Field,
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const c = g.cropAt(t.x, t.y);
      if (c) g.removeCrop(t.x, t.y);
      g.world.setTile(t.x, t.y, TileType.Dirt);
      g.logMsg(c ? `You turn the ${cropDef(c.id).name.toLowerCase()} back into the soil.` : 'You break the field back up into plain dirt.', 'event');
    },
  },
];

export const FARM_ACTION_BY_ID = new Map(FARM_ACTIONS.map((a) => [a.id, a]));
export { TILE_DEFS };
