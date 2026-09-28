/**
 * Water lilies and lotus: what is planted in still water, and what it does
 * through the island's year.
 *
 * A plant is where it was planted, when, and when its flower or seed head was
 * last picked, and nothing else is kept: everything about it at any moment is
 * worked out from those and the wall clock, the same on every page and on the
 * island (`water_plant_state`), through the island's year (`seasonAt`).
 *
 * It puts its leaves up the moment it is planted and roots over
 * `WATER_ROOTING`; once rooted it flowers, or carries a seed head, in its own
 * seasons, and each picking takes that season's flower or seed head until the
 * next season comes round. In the seasons its leaves are down there is only
 * the root, under the water, and it comes up again with them.
 */
import { SEASON_DAYS, SEASONS, YEAR_DAYS, YEAR_FROM, seasonAt, type Season } from './calendar';

/** How long a water plant takes to root, in seconds of the wall clock: it flowers or sets seed only once this has passed. */
export const WATER_ROOTING = 24 * 60 * 60;
/** The shallowest and the deepest still water a water plant takes root in, at the middle of the tile, in height units. */
export const WATER_PLANT_SHALLOWEST = 2;
export const WATER_PLANT_DEEPEST = 20;

export type WaterPlantKind = 'lily' | 'lotus';

export interface WaterPlantDef {
  id: WaterPlantKind;
  /** What one is called. */
  name: string;
  /** What is planted to grow one: a root or a seed, which botanizing at the water's edge turns up. */
  from: string;
  /** The seasons its leaves are up; in the others only its root is left, under the water. */
  leaves: readonly Season[];
  /** The seasons it flowers in once it has rooted, and what picking a flower gives. */
  flowers: readonly Season[];
  flower: string;
  /** The seasons it carries a seed head once it has rooted, and what picking one gives, and how many. */
  seeds: readonly Season[];
  seed?: string;
  seedCount?: number;
}

/**
 * The two water plants, in the order the island keeps them.
 *
 * A water lily lays round notched pads flat on the water and flowers in white
 * or pink cups through spring and summer. A lotus holds bigger leaves up on
 * stalks, flowers tall and pink in summer and stands in seed heads through
 * autumn; picking a seed head gives its seeds, which are planted to grow more
 * and are eaten.
 */
export const WATER_PLANTS: readonly WaterPlantDef[] = [
  {
    id: 'lily', name: 'Water lily', from: 'lily_root',
    leaves: ['spring', 'summer', 'autumn'], flowers: ['spring', 'summer'], flower: 'water_lily', seeds: [],
  },
  {
    id: 'lotus', name: 'Lotus', from: 'lotus_seed',
    leaves: ['spring', 'summer', 'autumn'], flowers: ['summer'], flower: 'lotus_flower',
    seeds: ['autumn'], seed: 'lotus_seed', seedCount: 3,
  },
];
export const WATER_PLANT_BY_ID = new Map(WATER_PLANTS.map((d) => [d.id, d]));
/** The plant each root or seed grows into. */
export const WATER_PLANT_FROM = new Map(WATER_PLANTS.map((d) => [d.from, d]));

/** A planted water plant: where, which, and when it was planted and last picked, in epoch seconds. */
export interface WaterPlant {
  x: number;
  y: number;
  kind: WaterPlantKind;
  at: number;
  picked: number | null;
}

const DAY = 24 * 60 * 60;

/** The first dawn of the season `now` falls in, in epoch seconds: when the last season turned. */
export function seasonBegan(now: number): number {
  const days = Math.floor((now - YEAR_FROM) / DAY);
  const inYear = ((days % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  return YEAR_FROM + (days - (inYear % SEASON_DAYS)) * DAY;
}

/** The season after this one. */
export const nextSeason = (s: Season): Season => SEASONS[(SEASONS.indexOf(s) + 1) % SEASONS.length];

/** What a water plant is at a moment. */
export interface WaterPlantState {
  season: Season;
  /** Planted `WATER_ROOTING` ago or more. */
  rooted: boolean;
  /** Its leaves are up: in its leaf seasons; in the rest only the root is left. */
  leaves: boolean;
  /** What it carries this season, once rooted: a flower, a seed head, or nothing. */
  bears: 'flower' | 'seed' | null;
  /** Whether that is there to pick: nobody has picked it since this season began. */
  ripe: boolean;
}

export function waterPlantState(def: WaterPlantDef, at: number, picked: number | null, now: number): WaterPlantState {
  const { season } = seasonAt(now);
  const rooted = now >= at + WATER_ROOTING;
  const bears = !rooted ? null : def.flowers.includes(season) ? 'flower' : def.seeds.includes(season) ? 'seed' : null;
  const ripe = bears !== null && (picked === null || picked < seasonBegan(now));
  return { season, rooted, leaves: def.leaves.includes(season), bears, ripe };
}

/** The same, as one line, as the island says it (`water_plant_state`): for holding the two to each other. */
export const stateLine = (s: WaterPlantState): string =>
  `${s.season}|${s.rooted ? 'rooted' : 'rooting'}|${s.leaves ? 'leaves' : 'root'}|${s.bears ?? 'none'}|${s.ripe ? 'ripe' : 'bare'}`;
