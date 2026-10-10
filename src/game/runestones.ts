/**
 * The five Runestones, and the Telestone that takes you to them.
 *
 * A Runestone is part of the world: three tiles by three, on the shore of the
 * Crescent's inner bay, laid down with the island rather than by anybody. Nobody
 * can pick one up, move it, dig, build, plant or set anything down on its
 * nine tiles, and nothing walks through it (`World.solid`, the island's
 * `walk_share`, `creature_tile_ok` and `line_clear`). Each was circled by the
 * owner on the generated map, a little inland, and stands on the shore
 * nearest the circle: the nearest three by three that is dry and level and
 * has the sea on a tile of the ring just outside it, on the live island's
 * generated ground (`tools/runestone-spots.ts`). Whatever was made on those
 * tiles before the stones stood there was taken away, and the ground put back
 * (the island's `runestone_clear`).
 *
 * The places are written for the island, 4096 tiles a side
 * (`STONE_CHART`). A world under `STONE_LEAST` is a test's, sixteen or
 * sixty-four tiles across, where three by three laid five times over would
 * be most of the ground, and has none; `stoneCentre` lays the places over
 * any other size by scale, as the chart's regions are (`chartRegion`, the
 * island's `region_at`), a tile in from the edge.
 *
 * A Telestone, cut from earth motes and a stone brick (`make_telestone`),
 * takes whoever carries it to a free tile beside any Runestone within its
 * reach of where they stand, and they then wait before travelling again.
 * Its reach and that wait go straight from `TELE_NEAR` and `TELE_SLOW` at
 * quality one to `TELE_FAR` and `TELE_FAST` at quality one hundred
 * (`telestoneRange`, `telestoneRest`). The wait is the traveller's, not the
 * stone's: carrying three Telestones is no quicker than carrying one.
 *
 * A leaf on purpose, but for types: the game, the world's walking, the
 * renderer, the help and the defs dump all read it. The island has the same
 * rules off the same numbers (`runestones()`, `telestone_refusal`,
 * `perform_telestone` in the migrations) and says the same words;
 * `supabase/test/telestone.ts` holds the two sides together.
 */
import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { timeWords } from './words';

/** The five, by id: what the renderer draws each one as. */
export const RUNESTONE_IDS = ['crownstone', 'mossmere', 'harrowmark', 'wardenfall', 'sunreach'] as const;
export type RunestoneId = (typeof RUNESTONE_IDS)[number];

export interface Runestone {
  id: RunestoneId;
  name: string;
  /** The centre tile of its three by three, on the chart's 4096 island. */
  x: number;
  y: number;
}

/** Where they stand on the island, 4096 tiles a side: each on the shore of the Crescent's inner bay. */
export const RUNESTONES: readonly Runestone[] = [
  // The north shore, between the two inlets.
  { id: 'crownstone', name: 'The Crownstone', x: 2152, y: 2948 },
  // The west shore.
  { id: 'mossmere', name: 'Mossmere Stone', x: 1606, y: 3004 },
  // The east shore.
  { id: 'harrowmark', name: 'Harrowmark', x: 2550, y: 3000 },
  // The southwest point.
  { id: 'wardenfall', name: 'The Wardenfall', x: 1462, y: 3182 },
  // The southeast point.
  { id: 'sunreach', name: 'Sunreach Stone', x: 2768, y: 3175 },
];
export const RUNESTONE_BY_ID: ReadonlyMap<string, Runestone> = new Map(RUNESTONES.map((s) => [s.id, s]));

/** The island the places are written for: 4096 tiles a side, the chart's own size. */
export const STONE_CHART = 4096;
/**
 * The live island's seed: the generated ground the places were settled on
 * (`tools/runestone-spots.ts`), and the ground the island puts back under
 * each stone (`runestone_ground`).
 */
export const STONE_SEED = 7;
/** Tiles a stone reaches each way from its centre tile: one, for three by three. */
export const STONE_HALF = 1;
/** Tiles a stone spans each way: three. */
export const STONE_SPAN = 2 * STONE_HALF + 1;
/** The smallest world the stones stand on: anything smaller is a test's. The island's `stone_least`. */
export const STONE_LEAST = 1024;
/** Whether the stones stand on a world `size` across. */
export const hasRunestones = (size: number): boolean => size >= STONE_LEAST;

/** A stone's centre tile on a world `size` across: the chart laid over it by scale, a tile in from the edge. */
export function stoneCentre(s: Runestone, size: number): { x: number; y: number } {
  const at = (v: number): number => Math.min(size - 1 - STONE_HALF, Math.max(STONE_HALF, Math.floor((v + 0.5) * size / STONE_CHART)));
  return { x: at(s.x), y: at(s.y) };
}

/** The point a stone's distance is measured to: the middle of its centre tile. */
export function stonePoint(s: Runestone, size: number): { x: number; y: number } {
  const c = stoneCentre(s, size);
  return { x: c.x + 0.5, y: c.y + 0.5 };
}

const tilesBySize = new Map<number, Map<number, Runestone>>();
/** Every tile a stone stands on, on a world `size` across, by `y * size + x`. */
export function stoneTiles(size: number): ReadonlyMap<number, Runestone> {
  let out = tilesBySize.get(size);
  if (out) return out;
  out = new Map();
  for (const s of hasRunestones(size) ? RUNESTONES : []) {
    const c = stoneCentre(s, size);
    for (let dy = -STONE_HALF; dy <= STONE_HALF; dy++) {
      for (let dx = -STONE_HALF; dx <= STONE_HALF; dx++) out.set((c.y + dy) * size + c.x + dx, s);
    }
  }
  tilesBySize.set(size, out);
  return out;
}

/** The stone standing on a tile of a world `size` across, or null. The island's `runestone_on`. */
export function runestoneAt(x: number, y: number, size: number): Runestone | null {
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  return stoneTiles(size).get(y * size + x) ?? null;
}

/** How far a tile is from a stone, in tiles: from the middle of the tile to the middle of the stone's nearest tile; nought on it. */
export function stoneGap(s: Runestone, size: number, x: number, y: number): number {
  const c = stoneCentre(s, size);
  return Math.hypot(Math.max(0, Math.abs(x - c.x) - STONE_HALF), Math.max(0, Math.abs(y - c.y) - STONE_HALF));
}

/** The first stone within `reach` tiles of a tile (`stoneGap`), or null. The island's `runestone_within`. */
export function runestoneWithin(x: number, y: number, size: number, reach: number): Runestone | null {
  if (!hasRunestones(size)) return null;
  return RUNESTONES.find((s) => stoneGap(s, size, x, y) <= reach) ?? null;
}

/* ---- The Telestone ---------------------------------------------------------------------------- */

/** The item, and the key in `Player.usedAt` that holds the wall-clock second its owner may travel again. */
export const TELESTONE = 'telestone';
export const TELESTONE_KEY = 'telestone';
/** The qualities the rule runs between. */
export const TELE_QL_LOW = 1;
export const TELE_QL_HIGH = 100;
/** How far it reaches, in tiles, at the lowest quality and at the highest. */
export const TELE_NEAR = 300;
export const TELE_FAR = 5000;
/** How long its owner waits after a journey, in seconds of the wall clock, at the lowest quality and at the highest. */
export const TELE_SLOW = 24 * 3600;
export const TELE_FAST = 3600;

/**
 * Seconds after a journey in which a word about walking that claims ground
 * further off than a walk could have gone is taken to have been said before
 * the journey, and leaves the body where the journey put it (the island's
 * `rpc_move`). Every word a browser had waiting is dropped when it hears of
 * the journey; this is for one already on its way.
 */
export const TELE_GRACE = 10;

const teleQl = (ql: number): number => Math.min(TELE_QL_HIGH, Math.max(TELE_QL_LOW, ql));
/** How far a Telestone of quality `ql` reaches, in tiles: straight from `TELE_NEAR` to `TELE_FAR`. The island's `telestone_range`. */
export const telestoneRange = (ql: number): number =>
  TELE_NEAR + (teleQl(ql) - TELE_QL_LOW) * (TELE_FAR - TELE_NEAR) / (TELE_QL_HIGH - TELE_QL_LOW);
/** How long a journey on one makes you wait, in seconds: straight from `TELE_SLOW` to `TELE_FAST`. The island's `telestone_rest`. */
export const telestoneRest = (ql: number): number =>
  TELE_SLOW - (teleQl(ql) - TELE_QL_LOW) * (TELE_SLOW - TELE_FAST) / (TELE_QL_HIGH - TELE_QL_LOW);
/** What a point of quality adds to the reach, in tiles, and takes off the wait, in seconds. */
export const TELE_RANGE_STEP = (TELE_FAR - TELE_NEAR) / (TELE_QL_HIGH - TELE_QL_LOW);
export const TELE_REST_STEP = (TELE_SLOW - TELE_FAST) / (TELE_QL_HIGH - TELE_QL_LOW);

/**
 * The tiles a traveller may arrive on round a stone, as offsets from its
 * centre, in the order they are tried: the ring just outside it, then the one
 * outside that, then one more; within a ring the middles of its sides first,
 * the side nearest the screen's foot (south) first. The island's
 * `landing_ring`, which the defs dump writes from this.
 */
export const LANDING: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let r = STONE_HALF + 1; r <= STONE_HALF + 3; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([dx, dy, r]);
  }
  out.sort((a, b) => a[2] - b[2] || (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])) || b[1] - a[1] || a[0] - b[0]);
  return out.map(([dx, dy]) => [dx, dy] as const);
})();

/**
 * Steepest a tile may be, highest corner less lowest, to arrive on: what a
 * body stands on unaided, `MAX_STAND` in `player.ts`, which this leaf may not
 * import (the player reaches the items, which read this);
 * `supabase/test/telestone.ts` holds the two to each other.
 */
export const LANDING_STAND = 60;

/**
 * Where a traveller arrives beside a stone: the first of `LANDING` that is on
 * the map, a tile a body can stand on (`isPassable`, which no stone is), dry,
 * no steeper than `LANDING_STAND` and under no building. Null when there is
 * none. The island's `telestone_landing`.
 */
export function landingTile(g: Game, s: Runestone): { x: number; y: number } | null {
  const w = g.world;
  const c = stoneCentre(s, w.w);
  for (const [dx, dy] of LANDING) {
    const x = c.x + dx;
    const y = c.y + dy;
    if (!w.inBounds(x, y) || !w.isPassable(x, y) || runestoneAt(x, y, w.w)) continue;
    if (w.hasWater(x, y) || w.slope(x, y) > LANDING_STAND || g.buildings.buildingAt(x, y)) continue;
    return { x, y };
  }
  return null;
}

/** What both sides say when a journey will not be made. */
export const TELESTONE_SAID = {
  item: 'Use a Telestone you are carrying.',
  nowhere: 'There are no Runestones on this island.',
  stone: 'Choose a Runestone.',
  busy: 'Finish or stop what you are doing first.',
  fight: 'Not in the middle of a fight.',
  driving: 'Let go of what you are driving or pulling first: a Telestone takes you and nothing else.',
  aboard: 'Step off what you are aboard first: a Telestone takes you and nothing else.',
  mounted: 'Get down first: a Telestone takes you and not your mount.',
  swimming: 'Not while you are swimming.',
  heavy: 'You are carrying too much to walk. Put something down first.',
} as const;

/** A whole number of tiles, rounded as the island rounds (`floor(x + 0.5)`). */
const tilesWord = (n: number): string => String(Math.floor(n + 0.5));

/** Somebody following you, who would be left behind. */
export const companionSaid = (name: string): string =>
  `${name} follows you and would be left behind. Send it to your deed or into a crate first.`;
/** A stone out of this one's reach. */
export const farSaid = (s: Runestone, d: number, reach: number): string =>
  `${s.name} is ${tilesWord(d)} tiles away. This Telestone reaches ${tilesWord(reach)}.`;
/** The wait not over. */
export const restSaid = (secs: number): string => `You can travel by Telestone again in ${timeWords(secs)}.`;
/** Nowhere to arrive. */
export const noRoomSaid = (s: Runestone): string => `There is no free ground beside ${s.name} to arrive on.`;
/** The journey made. */
export const travelledSays = (s: Runestone, rest: number): string =>
  `You hold up the Telestone and are standing beside ${s.name}. You can travel by Telestone again in ${timeWords(rest)}.`;
/** Any work on a stone's ground. */
export const stoneGroundSaid = (s: Runestone): string =>
  `That is the ground of ${s.name}. Nothing can be dug, built, planted or set down on it.`;
/** What Examine says of a stone's tile. The island's `ground_says` says the same. */
export const stoneSays = (s: Runestone): string => ` ${s.name}, a Runestone, stands here. A Telestone can take you to it.`;

/** What Examine adds of a Telestone of quality `ql`: exactly what this one does. */
export const telestoneSays = (ql: number): string =>
  ` This one reaches ${tilesWord(telestoneRange(ql))} tiles, and a journey on it makes you wait ${timeWords(telestoneRest(ql))}.`;

/** The wait still to run, as the menu notes it: "ready in 3 hours and 12 minutes". */
export const timeLeftNote = (secs: number): string => `ready in ${timeWords(secs)}`;

/** A stone's name and how far it is, for the menu: "The Crownstone, 1240 tiles". */
export const stoneChoice = (s: Runestone, d: number): string => `${s.name}, ${tilesWord(d)} tiles`;

/** How far a stone is from where you stand, in tiles, to the middle of its centre tile. */
export function stoneDistance(g: Game, s: Runestone): number {
  const p = stonePoint(s, g.world.w);
  return Math.hypot(g.player.x - p.x, g.player.y - p.y);
}

/** Seconds until its owner may travel again: nought when they may. */
export function telestoneWait(g: Game): number {
  return Math.max(0, (g.player.usedAt[TELESTONE_KEY] ?? 0) - g.wallNow());
}

/** The Telestone a target names, when it is one in your pack. */
const telestoneOf = (g: Game, t: Target) => {
  const it = t.kind === 'item' ? g.inventory.get(t.uid) : undefined;
  return it && it.id === TELESTONE ? it : undefined;
};

/**
 * Why this journey will not be made, or null when it will: the island's
 * `telestone_refusal`, word for word and in the same order.
 */
export function telestoneRefusal(g: Game, t: Target): string | null {
  const it = telestoneOf(g, t);
  if (!it || t.kind !== 'item') return TELESTONE_SAID.item;
  if (!hasRunestones(g.world.w)) return TELESTONE_SAID.nowhere;
  const s = RUNESTONE_BY_ID.get(t.stone ?? '');
  if (!s) return TELESTONE_SAID.stone;
  if (g.action && g.action.def.id !== TRAVEL) return TELESTONE_SAID.busy;
  if (g.inAFight()) return TELESTONE_SAID.fight;
  if (g.driving() || [...g.furniture.values()].some((f) => f.hitched)) return TELESTONE_SAID.driving;
  if (g.aboardShip()) return TELESTONE_SAID.aboard;
  if (g.mounted()) return TELESTONE_SAID.mounted;
  const pet = g.companion();
  if (pet) return companionSaid(pet.name);
  if (g.player.swimming) return TELESTONE_SAID.swimming;
  if (g.stalled()) return TELESTONE_SAID.heavy;
  const d = stoneDistance(g, s);
  const reach = telestoneRange(it.ql);
  if (d > reach) return farSaid(s, d, reach);
  const wait = telestoneWait(g);
  if (wait > 0) return restSaid(wait);
  if (!landingTile(g, s)) return noRoomSaid(s);
  return null;
}

/** The journey, as an action on the Telestone in your pack, with the stone in the target (`stone`). */
export const TRAVEL = 'travel_runestone';

export const TELESTONE_ACTIONS: ActionDef[] = [
  {
    id: TRAVEL,
    label: 'Travel to a Runestone',
    labelFor: (t) => {
      const s = t.kind === 'item' ? RUNESTONE_BY_ID.get(t.stone ?? '') : undefined;
      return s ? `Travel to ${s.name}` : 'Travel to a Runestone';
    },
    verb: 'travelling',
    // The inventory offers it, a stone to a line (`Travel to a Runestone`), rather than the generic menu.
    hidden: true,
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => !!telestoneOf(g, t),
    check: (t, g) => telestoneRefusal(g, t),
    perform: (t, g) => {
      const it = telestoneOf(g, t);
      const s = t.kind === 'item' ? RUNESTONE_BY_ID.get(t.stone ?? '') : undefined;
      const land = s ? landingTile(g, s) : null;
      if (!it || !s || !land) return;
      const rest = telestoneRest(it.ql);
      g.putBody(land.x + 0.5, land.y + 0.5, 0);
      g.player.usedAt[TELESTONE_KEY] = g.wallNow() + rest;
      g.logMsg(travelledSays(s, rest), 'event');
    },
  },
];

/**
 * The jobs that change the ground or put something on a tile, which a
 * stone's nine tiles refuse (`stoneGroundRefusal`). The island's
 * `stone_guarded`, which the defs dump writes from this.
 */
export const STONE_GUARDED: ReadonlySet<string> = new Set([
  // The ground's shape and surface.
  'dig', 'dig_tile', 'dredge', 'flatten', 'drop_dirt', 'drop_dirt_here', 'rubble_fill', 'raise_rock', 'mine', 'chip_corner',
  'pack', 'cultivate', 'pave_cobble', 'pave_slabs', 'remove_paving', 'dig_spring', 'stop_spring', 'dig_pool', 'fill_pool',
  'lay_steps', 'lay_timber_steps', 'take_up_steps', 'plant_moss', 'plant_grass', 'lay_stones', 'lift_stones',
  'plant_lily', 'plant_lotus', 'pull_water_plant', 'cut_grass', 'cut_moss', 'cut_reeds', 'clear_brush', 'dig_worms',
  'collect', 'unearth',
  // What grows on it.
  'plant', 'cut_down', 'dig_stump', 'till', 'plant_seed', 'sow_patch',
  // What is built on it.
  'plan_building', 'add_to_building', 'plan_wall', 'plan_fence', 'plan_floor', 'build_wall', 'build_floor',
  'dig_cellar', 'mine_cellar', 'fill_cellar', 'plan_column', 'build_column',
  'plan_bridge', 'build_bridge', 'plan_aqueduct', 'build_aqueduct', 'plan_foundation', 'pour_foundation', 'strike_foundation',
  // What is set down on it.
  'build_campfire', 'place_smelter', 'place_kiln', 'place_furniture', 'place_anvil', 'place_post', 'place_crate',
  'set_trap', 'found_settlement',
]);

/**
 * The tiles a job works or puts something on: a corner's four, a tile, the
 * tile under your feet for a job aimed at something in your pack (a corner's
 * four for a spadeful dropped there), and for a bridge or an aqueduct every
 * tile between its two ends. The island's `stone_job_tiles`.
 */
export function stoneJobTiles(g: Game, def: ActionDef, t: Target): Array<[number, number]> {
  const box = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push([x, y]);
    return out;
  };
  const corner = (cx: number, cy: number): Array<[number, number]> => box(cx - 1, cy - 1, cx, cy);
  if (t.kind !== 'tile') {
    if (def.id === 'drop_dirt_here') {
      const c = g.nearestCornerToPlayer();
      return corner(c.cx, c.cy);
    }
    return [[g.player.tileX, g.player.tileY]];
  }
  if (def.id === 'plan_bridge') return box(g.player.tileX, g.player.tileY, t.x, t.y);
  if (def.id === 'plan_aqueduct') return t.head ? box(t.head[0], t.head[1], t.x, t.y) : [[t.x, t.y]];
  if (def.corner) return corner(t.cx, t.cy);
  return [[t.x, t.y]];
}

/** Why a job will not be done on a stone's ground, or null: the island's `stone_ground_refusal`. */
export function stoneGroundRefusal(g: Game, def: ActionDef, t: Target): string | null {
  // A check asked with no game at all, as a test of a job's own words asks it, has no ground to ask about.
  if (!STONE_GUARDED.has(def.id) || !g || !hasRunestones(g.world.w)) return null;
  for (const [x, y] of stoneJobTiles(g, def, t)) {
    const s = runestoneAt(x, y, g.world.w);
    if (s) return stoneGroundSaid(s);
  }
  return null;
}
