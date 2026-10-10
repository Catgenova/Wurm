import { TileType, TILE_DEFS } from '../world/tiles';
import { seasonAt, YEAR_FROM } from '../world/calendar';
import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import type { PlacedFurniture } from './furniture';
import { describeFrom, itemDef, itemName, type Item } from './items';
import { world } from './pace';
import { clockNamed, cropClockOf, fieldClock, fieldMoment, fieldRate, fieldStops, fieldWakes, GLASSHOUSE_GROWTH, handClock, handMoment, handRate, PLANTER_GROWTH, steadyRate, type CropClock } from './growth';
import { clearedSaid, clearedTo, glassTillRefusal, glazing, isGlasshouse } from './glasshouse';
import type { Building, Buildings } from './building';
import { capital, share, timeWords, times } from './words';

/**
 * Farming: rake a field out of grass or dirt, sow a seed, tend it through
 * each stage of growth and harvest it. Tending is what makes a field worth
 * planting; skill is what makes the harvest good.
 *
 * A field grows through the year at its season's share of a crop's pace and
 * not at all in winter; a planter grows one crop at `PLANTER_GROWTH` of its
 * pace in every season, wherever it stands, and is sown, tended and harvested
 * like a field by the same jobs aimed at the piece (`growth.ts`).
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
  // Every crop's stage at the world's pace, in the one place all thirteen
  // pass through. Cotton is the yardstick: five minutes a stage.
  stageSeconds: world(stageSeconds),
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
  /**
   * When the current stage began, on the clock the crop grows on
   * (`Game.growNow`): a field's growing seconds, which stand still in winter,
   * or a planter's, which run at `PLANTER_GROWTH` of the plain clock.
   */
  stageAt: number;
  /** Stages tended so far; each one lifts the harvest. */
  tended: number;
  /** Whether the stage it is in has already been tended. */
  tendedNow: boolean;
  /** Quality the harvest will carry, built up while tending. */
  ql: number;
  /**
   * How long each of its stages takes, as a share of the crop's own: 1 for
   * anybody's, less for a Farmer's with Fast Growth, or Crop Rotation on a
   * field last sown with something else. Stamped when it is sown, so putting
   * the trade down later takes nothing back from a field already growing.
   */
  pace?: number;
  /** The planter it grows in, by the piece's id; a crop in a field has none. `x` and `y` are the planter's tile. */
  planter?: number;
  /**
   * A field under glass: its tile is in a glasshouse, so it grows on the
   * glass clock (`GLASSHOUSE_GROWTH` in every season) and `stageAt` is a
   * reading of that. Absent for a field in the open and for a planter.
   */
  glass?: boolean;
  /**
   * Sown by somebody with Love's Season's Hand: out of glass it grows on the
   * Season's Hand's clock (`handClock`), through winter at `HAND_WINTER`.
   * Stamped at sowing, as the island's `crop.hand` is.
   */
  hand?: boolean;
}

/** Tiles a field can be raked out of. */
export const TILLABLE = new Set<number>([TileType.Grass, TileType.Dirt, TileType.Lawn, TileType.Steppe, TileType.Tundra, TileType.Moss]);

/**
 * Whether Till is offered on a building's packed floor: in one roofed, or
 * being roofed, in glass, where no floor is planned. Whether it goes is
 * `glassTillRefusal`'s to say -- only a finished glasshouse's does.
 */
export const glassTillable = (g: Game, x: number, y: number): boolean =>
  g.world.getTile(x, y) === TileType.PackedDirt && !g.buildings.floor(0, x, y) && !g.foundationAt(x, y)
  && glazing(g.buildings, g.buildings.buildingAt(x, y));

/**
 * What a harvest gives. An untended field returns the seed it was sown from
 * and a single crop; tending every stage doubles the seed and quadruples the
 * crop. `bumper` is a Farmer's Bumper Crop: that many more on a crop tended at
 * every stage, and nothing on one that was not.
 */
export function cropYield(tended: number, bumper = 0): { seeds: number; produce: number } {
  const t = Math.max(0, Math.min(CROP_STAGES - 1, tended));
  return { seeds: t >= 2 ? 2 : 1, produce: 1 + t + (t >= RIPE ? bumper : 0) };
}

export const cropDef = (id: string): CropDef => CROPS[id] ?? CROPS.onion;
export const cropReady = (c: Crop): boolean => c.stage >= RIPE;
export const cropStageName = (c: Crop): string => STAGE_NAMES[Math.min(RIPE, c.stage)];
/** Seconds one stage of this crop takes, at the pace it was sown at. */
export const cropStageSeconds = (c: Crop): number => cropDef(c.id).stageSeconds * (c.pace ?? 1);

/**
 * How many stages a crop moves on, from where it is to a reading `now` of the
 * clock it grows on, `per` growing seconds a stage: never past ripe and never
 * back. One division and a floor, as the island's `crop_settled` has it,
 * rather than a stage at a time, so the two come out alike to the last second.
 */
export const cropSteps = (c: { stage: number; stageAt: number }, per: number, now: number): number =>
  Math.max(0, Math.min(RIPE - c.stage, Math.floor((now - c.stageAt) / per)));

/**
 * Bring a crop up to `now` on its own clock, and say whether it moved: each
 * stage that has come due is added on at its own length, never restarted
 * from now, and a new stage has not been tended.
 */
export function settleCrop(c: Crop, per: number, now: number): boolean {
  const steps = cropSteps(c, per, now);
  if (steps <= 0) return false;
  c.stage += steps;
  c.stageAt = c.stageAt + per * steps;
  c.tendedNow = false;
  return true;
}

/** Growing seconds still to go in the stage a crop is in: `per` a stage, `now` its clock's reading. */
export const cropGrowthLeft = (c: Crop, per: number, now: number): number => Math.max(0, per - (now - c.stageAt));

/**
 * Real seconds until a crop moves on, from the moment `wall` (epoch seconds),
 * or null once it is ripe: what is left of its stage, `per` growing seconds
 * long with its clock reading `now`, at a planter's steady `PLANTER_GROWTH`
 * or a glasshouse's steady `GLASSHOUSE_GROWTH`, or over the year for a field
 * -- whose winter adds its whole length to a stage that runs into one.
 */
export function cropTimeLeft(c: Crop, per: number, now: number, wall: number): number | null {
  if (cropReady(c)) return null;
  const left = cropGrowthLeft(c, per, now);
  const clock = cropClockOf(c);
  if (clock === 'hand') return left > 0 ? handMoment(handClock(wall) + left) - wall : 0;
  if (clock !== 'field') return left / steadyRate(clock);
  return left > 0 ? fieldMoment(fieldClock(wall) + left) - wall : 0;
}

/**
 * When a crop comes to its `next` stage, as a line says it, from `left`
 * growing seconds still to go and the moment `wall`: "sprouting in 5
 * minutes"; for a field's stage that runs into a winter, "sprouting in 7
 * days and 2 hours, after the winter"; and for a field in one, "waiting for
 * spring, in 3 days and 4 hours, then sprouting 5 minutes after". A planter's
 * and a glasshouse's never wait. `clock` is the crop's (`CropClock`), or true
 * for a planter's and false for a field's. The island's `crop_when` and
 * `crop_when_on` say the same, in the same words.
 */
export function cropWhen(next: string, left: number, clock: boolean | CropClock, wall: number): string {
  const k = clockNamed(clock);
  // A Season's Hand's field never stands still, so it never waits.
  if (k === 'hand') return `${next} in ${timeWords(handMoment(handClock(wall) + left) - wall)}`;
  if (k !== 'field') return `${next} in ${timeWords(left / steadyRate(k))}`;
  const wakes = fieldWakes(wall);
  if (!Number.isFinite(wakes)) return `${next} when a field grows again`;
  const end = fieldMoment(fieldClock(wall) + left);
  if (wakes > wall) return `waiting for ${seasonAt(wakes).season}, in ${timeWords(wakes - wall)}, then ${next} ${timeWords(end - wakes)} after`;
  const stops = fieldStops(wall);
  return `${next} in ${timeWords(end - wall)}${end > stops ? `, after the ${seasonAt(stops).season}` : ''}`;
}

/**
 * What a seed offered for sowing says about its stage, in real seconds at the
 * moment `wall`: `per` growing seconds a stage (the crop's, at the pace this
 * sowing would grow at), at a planter's or a glasshouse's share of it in any
 * season, or at the field's share the season gives -- and none in a field's
 * winter. `clock` as `cropWhen` takes it.
 */
export function stageNote(name: string, per: number, clock: boolean | CropClock, wall: number): string {
  const k = clockNamed(clock);
  if (k === 'planter') return `${name}, ${Math.round(per / PLANTER_GROWTH)}s a stage in any season`;
  if (k === 'glass') return `${name}, ${Math.round(per / steadyRate(k))}s a stage in any season`;
  const rate = k === 'hand' ? handRate(wall) : fieldRate(wall);
  const season = seasonAt(wall).season;
  if (rate <= 0) return `${name}, nothing until ${seasonAt(fieldWakes(wall)).season}: a field does not grow in ${season}`;
  return `${name}, ${Math.round(per / rate)}s a stage${wall >= YEAR_FROM ? ` in ${season}` : ''}`;
}

/** A share of a crop's pace as a line says it: "at its own pace", "half again as fast", "at half its pace", "at a quarter of its pace", "not at all". */
export function growthWords(r: number): string {
  if (r <= 0) return 'not at all';
  if (r === 1) return 'at its own pace';
  if (r > 1) return `${times(r)} as fast`;
  const part = share(r);
  return part === 'half' ? 'at half its pace' : `at ${part} of its pace`;
}

/**
 * What Examine adds on a tile of a glasshouse (`glasshouse.ts`), after the
 * building it belongs to: what it is and what it does for a crop. The island
 * says it in the same words (`glass_examine_said`, written by the
 * definitions, and `glass_examine`).
 */
export const glassExamine = (): string =>
  ` It is a glasshouse, walled all round to full height and roofed wholly in glass: its ground tills into fields, and a crop in it grows ${growthWords(GLASSHOUSE_GROWTH)} in every season, winter too.`;

/** Examine's line for a building: `glassExamine` for a glasshouse, nothing for any other. */
export const glassSays = (bld: Buildings, b: Building | undefined): string => (isGlasshouse(bld, b) ? glassExamine() : '');

/**
 * What a sowing says: "You sow wheat. Sprouting in 5 minutes.", in a planter
 * "You sow wheat in the planter. ...", in a glasshouse "You sow wheat under
 * glass. ...". `clock` as `cropWhen` takes it. The island's is `sown_said`,
 * and `sown_said_on` for a clock by name.
 */
export const sownSaid = (name: string, clock: boolean | CropClock, when: string): string => {
  const k = clockNamed(clock);
  return `You sow ${name.toLowerCase()}${k === 'planter' ? ' in the planter' : k === 'glass' ? ' under glass' : ''}. ${capital(when)}.`;
};

/**
 * Look on a crop, in a field or in a planter: its stage, when the next one
 * comes, and what its tending has earned. `per` and `now` are its stage's
 * length and its clock's reading (`Game.cropPer`, `Game.growNow`), `wall`
 * the moment; `bumper` is the looker's own Bumper Crop, for what it would
 * give them.
 */
export function describeCrop(c: Crop, per: number, now: number, wall: number, bumper = 0): string {
  const def = cropDef(c.id);
  const when = cropReady(c) ? 'ready to harvest' : cropWhen(STAGE_NAMES[c.stage + 1], cropGrowthLeft(c, per, now), cropClockOf(c), wall);
  const y = cropYield(c.tended, bumper);
  return `${def.name}${c.glass ? ' under glass' : ''}, ${cropStageName(c)} · ${when} · tended ${c.tended} of ${RIPE} times, for ${y.produce} ${itemDef(def.produce).name.toLowerCase()} and ${y.seeds} seed${y.seeds > 1 ? 's' : ''}`;
}

// The planter says what it grows at, off the rule.
describeFrom('planter', { growth: PLANTER_GROWTH });

/** The planter a job is aimed at, when it is aimed at one. */
const planterOf = (g: Game, t: Target): PlacedFurniture | undefined => (t.kind === 'furniture' ? g.planterPiece(t.id) : undefined);
/** What a job is aimed at: the crop in a field, or the one in a planter. */
const cropOf = (g: Game, t: Target): Crop | undefined =>
  t.kind === 'tile' ? g.cropAt(t.x, t.y) : t.kind === 'furniture' ? g.planted.get(t.id) : undefined;
/** Why a planter is out of reach, as the island says it (`fire_refusal`), or null. */
const planterReach = (g: Game, f: PlacedFurniture): string | null => (g.besidePiece(f) ? null : 'Stand next to the planter.');

/**
 * The tiles within `r` of (x, y), that tile included, row by row from the
 * north-west: a Farmer's patch, three by three at a reach of one.
 */
export const patchAround = (g: Game, x: number, y: number, r: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let ty = y - r; ty <= y + r; ty++) {
    for (let tx = x - r; tx <= x + r; tx++) if (tx >= 0 && ty >= 0 && tx < g.world.w && ty < g.world.h) out.push([tx, ty]);
  }
  return out;
};
/** A patch job takes as long as this many of the one-tile job it does up to nine of. */
export const PATCH_TIME = 3;
/** The one-tile jobs' own times and stamina, which the patch jobs are made from. */
const SOW = { baseTime: 3, stamina: 0.02 };
const TEND = { baseTime: 4, stamina: 0.03 };
const HARVEST = { baseTime: 5, stamina: 0.04 };
const patchOf = (job: { baseTime: number; stamina: number }): { baseTime: number; stamina: number } =>
  ({ baseTime: job.baseTime * PATCH_TIME, stamina: job.stamina * PATCH_TIME });

/** The empty fields in a patch: tilled, and nothing growing. */
export const emptyFields = (g: Game, x: number, y: number, r: number): Array<[number, number]> =>
  patchAround(g, x, y, r).filter(([tx, ty]) => g.world.getTile(tx, ty) === TileType.Field && !g.cropAt(tx, ty));
/** The crops in a patch that want tending: not ripe, and not tended at the stage they are at. */
export const wantTending = (g: Game, x: number, y: number, r: number): Crop[] =>
  patchAround(g, x, y, r).flatMap(([tx, ty]) => {
    const c = g.cropAt(tx, ty);
    return c && !cropReady(c) && !c.tendedNow ? [c] : [];
  });
/** The ripe crops in a patch. */
export const ripeIn = (g: Game, x: number, y: number, r: number): Crop[] =>
  patchAround(g, x, y, r).flatMap(([tx, ty]) => {
    const c = g.cropAt(tx, ty);
    return c && cropReady(c) ? [c] : [];
  });

/**
 * The pace a crop sown now grows at, for whoever is sowing it, given what was
 * last sown there: a Farmer's Fast Growth, and Crop Rotation where the last
 * crop was another one. Ground never sown has no last crop to differ from.
 */
const paceAfter = (g: Game, last: string | undefined, id: string): number =>
  g.perk('grow:plant_seed', 1) * (last !== undefined && last !== id ? g.perk('rotate:plant_seed', 1) : 1);

/** The pace a crop sown on this field now grows at (`paceAfter`, off the field's last crop). */
export function sownPace(g: Game, x: number, y: number, id: string): number {
  return paceAfter(g, g.lastSown(x, y), id);
}

/** And in a planter: Crop Rotation reads the planter's own last crop, as a field's reads the field's. */
export const planterPace = (g: Game, f: PlacedFurniture, id: string): number => paceAfter(g, f.sown, id);

/**
 * Sow one field, or a planter, from a seed in the pack. A Farmer's Seed Saver
 * keeps the seed now and then; null when there was no seed left to spend.
 */
function sowOne(g: Game, into: { x: number; y: number } | PlacedFurniture, seed: Item, def: CropDef): 'sown' | 'kept' | null {
  const kept = g.rand() < g.perk('keep:plant_seed', 0);
  const ql = seed.ql;
  if (!kept && !g.inventory.remove(seed.uid, 1)) return null;
  if ('kind' in into) g.sowPlanter(into, def.id, ql, planterPace(g, into, def.id));
  else g.plantCrop(into.x, into.y, def.id, ql, sownPace(g, into.x, into.y, def.id));
  return kept ? 'kept' : 'sown';
}

/** Tend one crop at the stage it is at. */
function tendOne(g: Game, c: Crop): void {
  c.tendedNow = true;
  c.tended += 1;
  // Quality follows the farmer, averaged over the care the field was given.
  c.ql = (c.ql * c.tended + g.productQl('farming')) / (c.tended + 1);
  g.events.emit('world', c.x, c.y);
}

/**
 * Harvest one ripe crop into the pack, or the cart being worked from: what
 * its tending earned, the gardener's path, and a Farmer's Bumper Crop, the
 * two more of Herb Plot, Grain Master and Fibre Farmer, and Fodder's grass.
 */
function reapOne(g: Game, c: Crop): { produce: Item; got: number; seeds: number; ql: number } {
  const def = cropDef(c.id);
  const y = cropYield(c.tended, g.perk('bumper:harvest_crop', 0));
  // The field's own quality, lifted by the farmer's skill at harvest.
  const ql = Math.max(1, Math.min(100, (c.ql + g.productQl('farming')) / 2));
  // Love's Abundance takes more out of the same ground.
  const more = g.pathFx('harvest', 1);
  const got = Math.max(1, Math.round(y.produce * more)) + g.perk(`plus:${def.produce}`, 0);
  const produce = g.gather(def.produce, { count: got, ql });
  g.gather(def.seed, { count: y.seeds, ql });
  const grass = g.perk('fodder:harvest_crop', 0);
  if (grass > 0) g.inventory.add('mixed_grass', { count: grass, ql });
  g.uproot(c);
  return { produce, got, seeds: y.seeds, ql };
}

/** "That wants a Farmer who has learned to sow a patch." */
const unlearned = (what: string): string => `That wants a Farmer who has learned to ${what}.`;

export const FARM_ACTIONS: ActionDef[] = [
  {
    id: 'till',
    label: 'Till',
    verb: 'tilling',
    skill: 'farming',
    tool: 'rake',
    stamina: 0.04,
    baseTime: 5,
    // Bare ground, or a glasshouse's packed floor (`glasshouse.ts`).
    applies: (t, g) => t.kind === 'tile' && (TILLABLE.has(g.world.getTile(t.x, t.y)) || glassTillable(g, t.x, t.y)),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('rake')) return 'You need a rake to till the ground.';
      // In a building, only a glasshouse's ground, and only where no floor is planned on it.
      const inside = glassTillRefusal(g, t.x, t.y, TILLABLE);
      if (inside) return inside;
      if (g.world.hasWater(t.x, t.y)) return 'You cannot till underwater.';
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
    ...SOW,
    // A tilled field, or a planter with nothing growing in it.
    applies: (t, g) => (t.kind === 'tile' && g.world.getTile(t.x, t.y) === TileType.Field) || !!planterOf(g, t),
    check: (t, g) => {
      const box = planterOf(g, t);
      if (box) {
        const far = planterReach(g, box);
        if (far) return far;
        if (g.planted.has(box.id)) return 'Something is already growing there.';
      } else {
        if (t.kind !== 'tile') return 'Choose a field.';
        if (g.world.getTile(t.x, t.y) !== TileType.Field) return 'Sow on a tilled field.';
        if (g.cropAt(t.x, t.y)) return 'Something is already growing there.';
      }
      const uid = t.kind === 'tile' || t.kind === 'furniture' ? t.itemUid : undefined;
      const seed = uid !== undefined ? g.inventory.get(uid) : undefined;
      if (!seed || !CROP_BY_SEED.has(seed.id)) return 'Choose a seed to sow.';
      return null;
    },
    perform: (t, g) => {
      const box = planterOf(g, t);
      const uid = t.kind === 'tile' || t.kind === 'furniture' ? t.itemUid : undefined;
      if ((!box && t.kind !== 'tile') || uid === undefined) return;
      if (box && g.planted.has(box.id)) return;
      const seed = g.inventory.get(uid);
      const def = seed && CROP_BY_SEED.get(seed.id);
      if (!seed || !def) return;
      const sown = sowOne(g, box ?? { x: t.kind === 'tile' ? t.x : 0, y: t.kind === 'tile' ? t.y : 0 }, seed, def);
      if (!sown) return;
      const c = box ? g.planted.get(box.id) : t.kind === 'tile' ? g.cropAt(t.x, t.y) : undefined;
      // When it will be sprouting, in real time, from the season it was sown in -- or in any, in a planter or under glass.
      const clock: CropClock = c ? cropClockOf(c) : box ? 'planter' : 'field';
      const when = c ? cropWhen(STAGE_NAMES[1], g.cropPer(c), clock, g.wallNow()) : `${STAGE_NAMES[1]} soon`;
      g.logMsg(`${sownSaid(def.name, clock, when)}${sown === 'kept' ? ' It cost you no seed.' : ''}`, 'event');
    },
  },
  {
    id: 'tend_crop',
    label: 'Tend',
    verb: 'tending the field',
    skill: 'farming',
    ...TEND,
    applies: (t, g) => cropOf(g, t) !== undefined,
    check: (t, g) => {
      const box = planterOf(g, t);
      const far = box ? planterReach(g, box) : null;
      if (far) return far;
      const c = cropOf(g, t);
      if (!c) return 'Nothing is growing there.';
      if (cropReady(c)) return 'It is ripe. Harvest it.';
      if (c.tendedNow) return 'You have already tended it at this stage. Wait for it to grow on.';
      return null;
    },
    perform: (t, g) => {
      const c = cropOf(g, t);
      if (!c || c.tendedNow || cropReady(c)) return;
      tendOne(g, c);
      const y = cropYield(c.tended, g.perk('bumper:harvest_crop', 0));
      const what = itemDef(cropDef(c.id).produce).name.toLowerCase();
      g.logMsg(`You weed and water the ${cropDef(c.id).name.toLowerCase()}. It should give ${y.produce} ${what} and ${y.seeds} seed${y.seeds > 1 ? 's' : ''}.`, 'event');
    },
  },
  {
    id: 'harvest_crop',
    label: 'Harvest',
    verb: 'harvesting',
    skill: 'farming',
    ...HARVEST,
    applies: (t, g) => cropOf(g, t) !== undefined,
    check: (t, g) => {
      const box = planterOf(g, t);
      const far = box ? planterReach(g, box) : null;
      if (far) return far;
      const c = cropOf(g, t);
      if (!c) return 'Nothing is growing there.';
      if (!cropReady(c)) return `It is only ${cropStageName(c)}. Let it grow.`;
      return null;
    },
    perform: (t, g) => {
      const c = cropOf(g, t);
      if (!c || !cropReady(c)) return;
      const def = cropDef(c.id);
      const r = reapOne(g, c);
      g.logMsg(
        `You harvest ${r.got} × ${itemName(r.produce).toLowerCase()} and ${r.seeds} ${itemDef(def.seed).name.toLowerCase()}. The ${c.planter !== undefined ? 'planter' : 'field'} is ready to sow again. (QL ${r.ql.toFixed(1)})`,
        'event',
      );
    },
  },
  {
    // A field broken back up; and in a planter, what is growing turned back into the soil so the planter can be sown again or picked up.
    id: 'clear_field',
    label: 'Clear the field',
    labelFor: (t, g) => (planterOf(g, t) ? 'Pull it up' : 'Clear the field'),
    verb: 'clearing the field',
    skill: 'farming',
    stamina: 0.03,
    baseTime: 3,
    applies: (t, g) => (t.kind === 'tile' && g.world.getTile(t.x, t.y) === TileType.Field) || (t.kind === 'furniture' && !!planterOf(g, t) && g.planted.has(t.id)),
    check: (t, g) => {
      const box = planterOf(g, t);
      if (!box) return null;
      return planterReach(g, box) ?? (g.planted.has(box.id) ? null : 'Nothing is growing there.');
    },
    perform: (t, g) => {
      const box = planterOf(g, t);
      if (box) {
        const c = g.planted.get(box.id);
        if (!c) return;
        g.uproot(c);
        g.logMsg(`You turn the ${cropDef(c.id).name.toLowerCase()} back into the soil.`, 'event');
        return;
      }
      if (t.kind !== 'tile') return;
      const c = g.cropAt(t.x, t.y);
      if (c) g.removeCrop(t.x, t.y);
      // Broken up, it is not a field any more, and has no last crop.
      g.forgetSown(t.x, t.y);
      // Inside a footprint, packed flat again as the rest of it is (`glasshouse.ts`).
      const to = clearedTo(g.buildings, t.x, t.y);
      g.world.setTile(t.x, t.y, to);
      g.logMsg(clearedSaid(c ? cropDef(c.id).name.toLowerCase() : null, to === TileType.PackedDirt), 'event');
    },
  },
  // ---- A Farmer's patch jobs: the three by three around a tile, as one job. ----
  {
    id: 'sow_patch',
    label: 'Sow a patch',
    verb: 'sowing a patch',
    skill: 'farming',
    hidden: true,
    ...patchOf(SOW),
    applies: (t, g) => t.kind === 'tile' && g.perk('sow_patch', 0) > 0 && g.world.getTile(t.x, t.y) === TileType.Field,
    check: (t, g) => {
      if (t.kind !== 'tile') return 'Choose a field.';
      if (g.perk('sow_patch', 0) <= 0) return unlearned('sow a patch');
      const seed = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
      if (!seed || !CROP_BY_SEED.has(seed.id)) return 'Choose a seed to sow.';
      if (!emptyFields(g, t.x, t.y, g.perk('sow_patch', 0)).length) return 'There is no empty field in the patch to sow.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.itemUid === undefined) return;
      const first = g.inventory.get(t.itemUid);
      const def = first && CROP_BY_SEED.get(first.id);
      if (!first || !def) return;
      let sown = 0;
      let kept = 0;
      for (const [x, y] of emptyFields(g, t.x, t.y, g.perk('sow_patch', 0))) {
        const seed = g.inventory.get(t.itemUid);
        if (!seed) break;
        const how = sowOne(g, { x, y }, seed, def);
        if (!how) break;
        sown += 1;
        if (how === 'kept') kept += 1;
      }
      if (!sown) return;
      g.logMsg(`You sow ${sown} ${sown === 1 ? 'field' : 'fields'} with ${def.name.toLowerCase()}.`
        + `${kept ? ` ${kept === sown ? (sown === 1 ? 'It' : 'They') : `${kept} of them`} cost you no seed.` : ''}`, 'event');
    },
  },
  {
    id: 'tend_patch',
    label: 'Tend a patch',
    verb: 'tending a patch',
    skill: 'farming',
    ...patchOf(TEND),
    applies: (t, g) => t.kind === 'tile' && g.perk('tend_patch', 0) > 0 && g.cropAt(t.x, t.y) !== undefined,
    check: (t, g) => {
      if (t.kind !== 'tile') return 'Choose a field.';
      if (g.perk('tend_patch', 0) <= 0) return unlearned('tend a patch');
      if (!wantTending(g, t.x, t.y, g.perk('tend_patch', 0)).length) return 'Nothing in the patch wants tending.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const crops = wantTending(g, t.x, t.y, g.perk('tend_patch', 0));
      for (const c of crops) tendOne(g, c);
      if (crops.length) g.logMsg(`You weed and water ${crops.length} ${crops.length === 1 ? 'crop' : 'crops'}.`, 'event');
    },
  },
  {
    id: 'harvest_patch',
    label: 'Harvest a patch',
    verb: 'harvesting a patch',
    skill: 'farming',
    ...patchOf(HARVEST),
    applies: (t, g) => t.kind === 'tile' && g.perk('harvest_patch', 0) > 0 && g.cropAt(t.x, t.y) !== undefined,
    check: (t, g) => {
      if (t.kind !== 'tile') return 'Choose a field.';
      if (g.perk('harvest_patch', 0) <= 0) return unlearned('harvest a patch');
      if (!ripeIn(g, t.x, t.y, g.perk('harvest_patch', 0)).length) return 'Nothing in the patch is ripe.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const crops = ripeIn(g, t.x, t.y, g.perk('harvest_patch', 0));
      // What came up, by the thing, in the order it first came up.
      const tally = new Map<string, number>();
      for (const c of crops) {
        const def = cropDef(c.id);
        const r = reapOne(g, c);
        tally.set(def.produce, (tally.get(def.produce) ?? 0) + r.got);
        tally.set(def.seed, (tally.get(def.seed) ?? 0) + r.seeds);
      }
      if (!crops.length) return;
      g.logMsg(`You harvest ${crops.length} ${crops.length === 1 ? 'field' : 'fields'}: `
        + `${[...tally].map(([id, n]) => `${n} × ${itemDef(id).name.toLowerCase()}`).join(', ')}. `
        + `${crops.length === 1 ? 'The field is' : 'The fields are'} ready to sow again.`, 'event');
    },
  },
];

export const FARM_ACTION_BY_ID = new Map(FARM_ACTIONS.map((a) => [a.id, a]));
export { TILE_DEFS };
