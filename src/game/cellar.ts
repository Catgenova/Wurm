import type { ActionDef, Target } from './actions';
import {
  CELLAR_DEPTH, CELLAR_LEVEL, CELLAR_SOIL, FLOOR_KIND_NAMES, floorKind, floorOf, gapText, type Building, type Side,
} from './building';
import { FURNITURE, furnitureDef, type FurnitureDef } from './furniture';
import type { Game } from './game';
import { itemDef } from './items';
import { maybeGem } from './gems';
import { maybeMap } from './treasure';
import { bedrockAt } from '../world/ore';
import type { World } from '../world/world';

/**
 * Cellars: the storey under the ground floor.
 *
 * A finished building's ground-floor tile is dug out from under it a slice at
 * a time -- a unit of depth over the whole tile a go, one of what that ground
 * gives for it -- until it is `CELLAR_DEPTH` down, one storey: a cellar tile,
 * something to stand on at `CELLAR_LEVEL`. The slices down through the soil
 * over the rock are shovel work (`dig_cellar`, digging, a spadeful of dirt a
 * go); the rest is the rock under it (`mine_cellar`, mining, what that rock
 * gives -- shards, or ore where the building stands over a seam). The ground
 * floor over it is left as it is, and the ground over a cellar is not dug or
 * raised while the cellar is there.
 *
 * It is dug, mined and filled in by somebody inside the building, on its
 * ground floor or down in its cellar (`standsIn`).
 *
 * A cellar needs no walls: the ground round it is its walls, and the ground
 * between two cellars side by side is as solid as any: nothing walks, sees,
 * reaches or digs from one into the other (`Buildings.sameCellar`). It is a
 * room, it is always indoors, and what lies on its floor rots at
 * `CELLAR_DECAY` of the rate out of doors. The way in is a staircase or a
 * ladder on the ground floor, over a cellar tile, with its foot on the cellar
 * tile on the side it is climbed from (`flightDown`): stepping off it that way
 * is going down, and stepping onto it from its foot, and from nowhere else, is
 * going up.
 *
 * It is dark. Down there the hour is the dead of night whatever the clock
 * says: you see what the dark lets you (`Vision.sightRange` at full dark) and
 * what you carry alight shows, a lantern or a torch; and by day the daylight
 * down a flight or a ladder shows `CELLAR_DAYLIGHT` round its foot. Every
 * piece of furniture goes down there but what burns an open fire -- no flue
 * -- what rolls or floats, and `cellarOutdoor`; and a lantern is lit only off
 * something already alight in your hand.
 *
 * Every rule here is the island's too (`supabase/migrations/*_cellars.sql`),
 * in the same words and the same order; `supabase/test/cellar.ts` holds the
 * two sides to each other.
 */

/** Tiles of daylight round the foot of a flight or a ladder into a cellar, by day. */
export const CELLAR_DAYLIGHT = 2;

/**
 * The soil over the rock under a tile, as the cellar reckons it: the four
 * corners' soil, averaged and rounded down. That many slices from the top are
 * shovel work, and everything under them is the rock.
 */
export function cellarSoil(w: World, x: number, y: number): number {
  return Math.floor((w.getDirt(x, y) + w.getDirt(x + 1, y) + w.getDirt(x + 1, y + 1) + w.getDirt(x, y + 1)) / 4);
}

/** The shallowest soil at any corner of a tile, which is what `CELLAR_SOIL` is asked of. */
export function cellarShallowest(w: World, x: number, y: number): number {
  return Math.min(w.getDirt(x, y), w.getDirt(x + 1, y), w.getDirt(x + 1, y + 1), w.getDirt(x, y + 1));
}

/** The height of the ground floor over a tile: a footprint is flat, so its first corner. */
export const groundFloorAt = (w: World, x: number, y: number): number => w.getHeight(x, y);

/**
 * The pieces that do not go down into a cellar although nothing burns in them
 * and nothing about them rolls or floats: a market stall, a mailbox, a trash
 * crate, a hive, a fish pond, a planter, a well and a tiered fountain, a rose
 * arch of either kind, a flagpole, a lantern post and a lantern pillar (whose
 * lantern lights the ground round it for everybody, `lamps.ts`), a creature
 * crate and a grave. The island reads the same list (`cellar_outdoor`,
 * written out by `npm run defs`).
 */
export function cellarOutdoor(): readonly string[] {
  outdoor ??= FURNITURE.filter((d) => d.stall || d.post || d.trash || d.hive || d.pond || d.planter
    || d.well || d.roses || d.grave || d.lamp || d.id === 'flagpole' || d.id === 'creature_crate').map((d) => d.id);
  return outdoor;
}
let outdoor: readonly string[] | undefined;

/** Whether a piece of furniture may be set down in a cellar, and why not when it may not: every piece may, but for these. */
export function cellarPieceReason(def: FurnitureDef): string | null {
  // An open fire has nowhere to put its smoke down there.
  if (def.hearth) return 'Nothing that burns an open fire goes down into a cellar.';
  if (def.cart || def.vehicle || def.boat) return 'Nothing on wheels or afloat goes down into a cellar.';
  if (cellarOutdoor().includes(def.id)) {
    const name = def.name.toLowerCase();
    return `${/^[aeiou]/.test(name) ? 'An' : 'A'} ${name} does not go down into a cellar.`;
  }
  return null;
}

/**
 * Tile jobs done from either side of the ground floor: from the floor over a
 * cellar tile, or from down in the cellar. Everything else aimed at a tile is
 * work on the ground, up top.
 */
const EITHER: ReadonlySet<string> = new Set(['examine', 'dig_cellar', 'mine_cellar', 'fill_cellar', 'pick_up_all', 'place_crate', 'place_furniture']);

/** Where a job's target is, for reach: the storey it is on and its tile. */
export interface TargetSpot {
  /** The cellar (`CELLAR_LEVEL`), or the ground and everything over it (0). */
  floor: number;
  x: number;
  y: number;
}

/**
 * Where a job's target is, for reach: on which side of the ground floor --
 * the cellar (`CELLAR_LEVEL`), or the ground and everything over it (0) --
 * and on which tile; or null where it is wherever you are: a thing in your
 * pack, or one of the jobs done from either side.
 */
export function targetSpot(g: Game, id: string, t: Target): TargetSpot | null {
  const spot = (level: number | undefined, x: number, y: number): TargetSpot => ({ floor: floorOf(level ?? 0), x: Math.floor(x), y: Math.floor(y) });
  switch (t.kind) {
    case 'crate': {
      const c = g.crates.get(t.id);
      return c ? spot(c.level, c.x, c.y) : null;
    }
    case 'furniture': {
      const f = g.furniture.get(t.id);
      return f ? spot(f.level, f.x, f.y) : null;
    }
    case 'ground':
      return spot(t.down ? CELLAR_LEVEL : 0, t.x, t.y);
    case 'item': {
      // A shop counter is set in a wall of the ground floor (`counters.ts`): goods go onto it and come off it up top.
      if (id === 'set_out_goods' || id === 'take_off_counter') return { floor: 0, x: 0, y: 0 };
      // Going into a store, or coming out of one, is done where the store is.
      if (t.into !== undefined) {
        const store = id === 'store_in_crate' ? g.crates.get(t.into) : id === 'store_in_furniture' ? g.furniture.get(t.into) : undefined;
        return store ? spot(store.level, store.x, store.y) : null;
      }
      if (id === 'take_from_store' && !g.inventory.get(t.uid)) {
        const where = g.storeWith(t.uid);
        return where?.level !== undefined ? spot(where.level, where.at[0], where.at[1]) : null;
      }
      return null;
    }
    case 'person': {
      const who = g.roster.list().find((p) => p.uid === t.uid);
      return who ? spot(who.level, who.x, who.y) : null;
    }
    case 'tile':
      return EITHER.has(id) ? null : spot(0, t.x, t.y);
    default:
      // A creature, a fire, a forge, a kiln, an anvil, a post, a trap and a bridge are all out on the ground.
      return { floor: 0, x: 0, y: 0 };
  }
}

/** The storey a job's target is on, for reach: the cellar, the ground, or null where it is wherever you are (`targetSpot`). */
export const targetFloor = (g: Game, id: string, t: Target): number | null => targetSpot(g, id, t)?.floor ?? null;

/** Refused from down in one cellar at a thing in the cellar of the building next door: the ground between them is solid. */
export const OTHER_CELLAR = "That is in another building's cellar.";

/**
 * Why a job cannot be done from where you stand, or null.
 *
 * Asked just before a go, when the walk that brought you there is over: a
 * thing in the cellar is reached from the cellar, and a thing up top from up
 * top; and from down in a cellar, only a thing in that same cellar. The
 * island asks the same of the same target (`cellar_gate`).
 */
export function cellarGate(g: Game, id: string, t: Target): string | null {
  const at = targetSpot(g, id, t);
  if (at === null) return null;
  const here = floorOf(g.player.level);
  if (here !== at.floor) return here < 0 ? 'You are down in the cellar. Go up to do that.' : 'That is down in the cellar.';
  if (here < 0 && !g.buildings.sameCellar(g.myCellar(), at.x, at.y)) return OTHER_CELLAR;
  return null;
}

/**
 * Whether the player stands in a building: on its ground floor, or down in
 * its cellar. A cellar is dug out, mined out and filled in from there and
 * nowhere else -- not through a wall from outside, not from upstairs, and not
 * from the cellar of the building next door.
 */
export function standsIn(g: Game, building: number): boolean {
  const { level, tileX: x, tileY: y } = g.player;
  if (level === 0) return g.buildings.buildingAt(x, y)?.id === building;
  return level < 0 && g.buildings.cellar(x, y)?.building === building;
}

/** The tile a cellar job is aimed at, and the building over it. */
const siteOf = (g: Game, t: Target): { x: number; y: number; b: Building } | null => {
  if (t.kind !== 'tile') return null;
  const b = g.buildings.buildingAt(t.x, t.y);
  return b ? { x: t.x, y: t.y, b } : null;
};

/**
 * What stops a tile being dug out any further, whichever tool the next slice
 * wants: everything the two jobs have in common, in the order they are asked.
 */
export function cellarDigReason(g: Game, t: Target): string | null {
  if (t.kind !== 'tile') return null;
  const site = siteOf(g, t);
  if (!site) return 'A cellar is dug out under a building.';
  const { x, y, b } = site;
  // The ground under a deck on piers is not dug while the building stands (`piers.ts`).
  if (g.buildings.onPiers(x, y)) return 'A cellar is not dug out under a deck on piers.';
  if (!standsIn(g, b.id)) return 'Dig it out from inside that building, on its ground floor or down in its cellar.';
  const dug = g.buildings.cellar(x, y)?.dug ?? 0;
  if (dug >= CELLAR_DEPTH) return `The cellar is dug out here, the whole ${CELLAR_DEPTH} down.`;
  // A building standing over it, and closed in: there is no ground floor to dig under until there is.
  const open = gapText(1, g.buildings.levelGaps(b, 0, g.player.x, g.player.y));
  if (open) return open;
  if (g.foundations.size && g.slabAt(x, y)) return 'A cellar is not dug out under a poured foundation.';
  const w = g.world;
  const shallow = cellarShallowest(w, x, y);
  if (dug === 0 && shallow < CELLAR_SOIL) {
    return `The rock lies ${shallow} under the ground floor at the shallowest corner here. A cellar is begun in soil, ${CELLAR_SOIL} of it at every corner.`;
  }
  const h = groundFloorAt(w, x, y);
  if (h - CELLAR_DEPTH < 0) {
    return `The ground floor here stands at ${h}. A cellar ${CELLAR_DEPTH} deep under it would lie under the sea: it wants the ground floor ${CELLAR_DEPTH} over the water.`;
  }
  return null;
}

/** Whether the next slice down under a tile is rock, for a pickaxe, rather than soil, for a shovel. */
export const nextSliceRock = (g: Game, x: number, y: number): boolean =>
  (g.buildings.cellar(x, y)?.dug ?? 0) >= cellarSoil(g.world, x, y);

/** Why a tile cannot be filled back in by a slice, or null. */
export function cellarFillReason(g: Game, t: Target): string | null {
  if (t.kind !== 'tile') return null;
  const c = g.buildings.cellar(t.x, t.y);
  if (!c) return 'There is no cellar dug out under this tile.';
  if (!standsIn(g, c.building)) return 'Fill it in from inside that building, on its ground floor or down in its cellar.';
  if (g.player.level < 0 && g.player.tileX === t.x && g.player.tileY === t.y) return 'You are standing on it. Step off it first.';
  if (g.groundAt(t.x, t.y, CELLAR_LEVEL).length) return 'Clear away what is lying down there first.';
  if (g.cratesOnTile(t.x, t.y).some((k) => floorOf(k.level) < 0) || g.furnitureOnTile(t.x, t.y).some((f) => floorOf(f.level) < 0)) {
    return 'Carry out what stands down there first.';
  }
  // The flight or ladder down that stands on it, or has its foot on it.
  const flight = flightOnto(g, t.x, t.y);
  if (flight) return `The ${FLOOR_KIND_NAMES[flight]} down to the cellar stands on it. Take it out first.`;
  if (g.roster.list().some((p) => p.level < 0 && Math.floor(p.x) === t.x && Math.floor(p.y) === t.y)) return 'Somebody is standing down there.';
  return null;
}

/**
 * Why nothing is let go of where the body stands, or null: on the head of a
 * way down, up top, a thing dropped would lie over the stairwell. The island
 * asks the same (`cellar_refusal`).
 */
export function dropRefusal(g: Game): string | null {
  const p = g.player;
  const f = p.level === 0 ? g.buildings.flightDown(p.tileX, p.tileY) : undefined;
  if (!f) return null;
  return floorKind(f) === 'ladder' ? 'Not on the ladder: step off it first.' : 'Not on the stairs: step off them first.';
}

/** A flight or a ladder down that stands on a tile, or lands on it at its foot: what it is, or null. */
export function flightOnto(g: Game, x: number, y: number): 'stairs' | 'ladder' | null {
  const b = g.buildings;
  const own = b.floor(0, x, y);
  if (own && (floorKind(own) === 'stairs' || floorKind(own) === 'ladder') && b.cellar(x, y)) return floorKind(own) as 'stairs' | 'ladder';
  for (const [dx, dy, side] of [[0, -1, 's'], [1, 0, 'w'], [0, 1, 'n'], [-1, 0, 'e']] as Array<[number, number, Side]>) {
    const f = b.floor(0, x + dx, y + dy);
    if (!f || (floorKind(f) !== 'stairs' && floorKind(f) !== 'ladder') || !b.cellar(x + dx, y + dy)) continue;
    // Its foot is on the side it is climbed from: this tile, when that side faces here.
    if ((f.facing ?? 's') === side) return floorKind(f) as 'stairs' | 'ladder';
  }
  return null;
}

/**
 * An examine of a tile of the cellar you are down in, from down there: the
 * floor of it -- what it is cut in, how far under the ground floor, at what
 * height -- and how much lies on it, rather than the ground up top. The
 * island's `cellar_floor_said` says the same. Null for any other tile.
 */
export function cellarFloorSaid(g: Game, x: number, y: number): string | null {
  const c = g.buildings.cellar(x, y);
  const b = c ? g.buildings.list.get(c.building) : undefined;
  if (!c || !b || g.player.level >= 0 || c.building !== g.myCellar()) return null;
  const floor = c.dug > cellarSoil(g.world, x, y) ? bedrockAt(g.world, x, y).name.toLowerCase() : 'soil';
  const height = (groundFloorAt(g.world, x, y) - c.dug).toFixed(1);
  const lying = g.groundAt(x, y, CELLAR_LEVEL).reduce((n, it) => n + it.count, 0);
  return (c.dug >= CELLAR_DEPTH
    ? `You see the floor of the cellar under ${b.name} at (${x}, ${y}): ${floor}, ${CELLAR_DEPTH} under the ground floor, at height ${height}.`
    : `You see the bottom of the cellar being dug under ${b.name} at (${x}, ${y}): ${floor}, ${downSaid(c.dug)}, at height ${height}.`)
    + (lying ? ` ${lying} ${lying === 1 ? 'thing lies' : 'things lie'} on it.` : ' Nothing lies on it.');
}

/** "12 of 30 down": how far a tile is dug out, as the log says it. */
const downSaid = (dug: number): string => `${dug} of ${CELLAR_DEPTH} down`;

/** A slice more off a tile's cellar, for the two jobs that dig one. */
function slice(g: Game, x: number, y: number, building: number): number {
  const dug = Math.min(CELLAR_DEPTH, (g.buildings.cellar(x, y)?.dug ?? 0) + 1);
  g.buildings.setCellar(building, x, y, dug);
  g.events.emit('world', x, y);
  return dug;
}

export const CELLAR_ACTIONS: ActionDef[] = [
  {
    // Down through the soil: a spadeful of dirt a slice, off the whole tile.
    id: 'dig_cellar',
    label: 'Dig out the cellar',
    verb: 'digging out the cellar',
    skill: 'digging',
    tool: 'shovel',
    repeat: true,
    stamina: 0.05,
    baseTime: 6,
    difficulty: 8,
    applies: (t, g) => t.kind === 'tile' && !!g.buildings.buildingAt(t.x, t.y) && !g.buildings.cellarDone(t.x, t.y) && !nextSliceRock(g, t.x, t.y),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      const why = cellarDigReason(g, t);
      if (why) return why;
      if (nextSliceRock(g, t.x, t.y)) {
        return `The soil is dug through here, ${g.buildings.cellar(t.x, t.y)?.dug ?? 0} down. The rest is rock, for a pickaxe.`;
      }
      return g.inventory.has('shovel') ? null : 'You need a shovel to dig.';
    },
    perform: (t, g) => {
      const site = siteOf(g, t);
      if (!site || cellarDigReason(g, t) || nextSliceRock(g, site.x, site.y)) return false;
      if (!g.skillCheck('digging', 8, g.toolQl('shovel'))) {
        g.missed();
        g.logMsg('You fail to dig anything useful.', 'event');
        return true;
      }
      const dug = slice(g, site.x, site.y, site.b.id);
      const item = g.gather('dirt', { ql: g.productQl('digging', g.toolQl('shovel')) });
      g.logMsg(`You dig out some dirt from under the ground floor: ${downSaid(dug)}. (QL ${item.ql.toFixed(1)})`, 'event');
      maybeMap(g, 'digging', 'shovel');
      if (dug >= CELLAR_DEPTH) {
        g.logMsg(`The cellar is dug out here, the whole ${CELLAR_DEPTH} down.`, 'event');
        return false;
      }
      if (nextSliceRock(g, site.x, site.y)) {
        g.logMsg(`Your shovel grates on rock ${dug} down. The rest is for a pickaxe.`, 'event');
        return false;
      }
      return true;
    },
  },
  {
    // And down through the rock under it: what mining that rock gives, a slice at a time.
    id: 'mine_cellar',
    label: 'Mine out the cellar',
    verb: 'cutting out the cellar',
    skill: 'mining',
    tool: 'pickaxe',
    repeat: true,
    stamina: 0.06,
    baseTime: 8,
    difficulty: 12,
    applies: (t, g) => t.kind === 'tile' && !!g.buildings.buildingAt(t.x, t.y) && !g.buildings.cellarDone(t.x, t.y) && nextSliceRock(g, t.x, t.y),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      const why = cellarDigReason(g, t);
      if (why) return why;
      if (!nextSliceRock(g, t.x, t.y)) {
        const c = g.buildings.cellar(t.x, t.y)?.dug ?? 0;
        return `There is soil to dig out here first, ${cellarSoil(g.world, t.x, t.y) - c} of it, for a shovel.`;
      }
      if (!g.inventory.has('pickaxe')) return 'You need a pickaxe to mine.';
      // A seam under the building gives up its metal only to somebody who knows how to take it, as a face of it would.
      const rock = bedrockAt(g.world, t.x, t.y);
      const need = Math.max(0, rock.level - g.perk('ore:below', 0));
      if (rock.ore && g.skills.get('mining') < need) return `${rock.name} needs mining ${need} to work. Yours is ${g.skills.get('mining').toFixed(1)}.`;
      return null;
    },
    perform: (t, g) => {
      const site = siteOf(g, t);
      if (!site || cellarDigReason(g, t) || !nextSliceRock(g, site.x, site.y)) return false;
      const pickQl = g.toolQl('pickaxe');
      if (!g.skillCheck('mining', 12, pickQl)) {
        g.missed();
        g.logMsg('The rock is hard and you fail to loosen anything.', 'event');
        return true;
      }
      const dug = slice(g, site.x, site.y, site.b.id);
      // What the rock under the building gives, as a face of it would: shards, or the ore of a seam.
      const rock = bedrockAt(g.world, site.x, site.y);
      if (rock.yields.endsWith('_ore')) g.note('ore');
      const item = g.gather(rock.yields, { ql: Math.min(rock.maxQl, g.productQl('mining', pickQl)) });
      const what = itemDef(rock.yields).name.toLowerCase();
      g.logMsg(`You cut some ${what} out of the rock under the ground floor: ${downSaid(dug)}. (QL ${item.ql.toFixed(1)})`, 'event');
      maybeMap(g, 'mining', 'pickaxe');
      maybeGem(g, 'mining', 'pickaxe');
      if (dug >= CELLAR_DEPTH) {
        g.logMsg(`The cellar is dug out here, the whole ${CELLAR_DEPTH} down.`, 'event');
        return false;
      }
      return true;
    },
  },
  {
    // And back in again, a slice at a time, out of what digging gave: dirt, clay or sand.
    id: 'fill_cellar',
    label: 'Fill in the cellar',
    verb: 'filling in the cellar',
    skill: 'digging',
    tool: 'shovel',
    repeat: true,
    stamina: 0.03,
    baseTime: 3,
    applies: (t, g) => t.kind === 'tile' && !!g.buildings.cellar(t.x, t.y),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      const why = cellarFillReason(g, t);
      if (why) return why;
      if (!g.inventory.has('shovel')) return 'You need a shovel to fill it in.';
      return g.spoilToHand() ? null : 'You need dirt, clay or sand to fill it in, in the pack or in something beside you.';
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || cellarFillReason(g, t)) return false;
      const c = g.buildings.cellar(t.x, t.y);
      const spoil = g.spoilToHand();
      if (!c || !spoil || !spoil.take()) return false;
      const dug = c.dug - 1;
      g.buildings.setCellar(c.building, t.x, t.y, dug);
      g.events.emit('world', t.x, t.y);
      if (dug <= 0) {
        g.logMsg(`You pack the last of the ${itemDef(spoil.id).name.toLowerCase()} in, and the ground under the floor here is whole again.`, 'event');
        return false;
      }
      g.logMsg(`You pack ${itemDef(spoil.id).name.toLowerCase()} back in under the ground floor: ${downSaid(dug)}.`, 'event');
      return true;
    },
  },
];

export const CELLAR_ACTION_BY_ID = new Map(CELLAR_ACTIONS.map((a) => [a.id, a]));

/** Whether a piece of this kind may go down into a cellar, by its id. */
export const cellarPieceOk = (kind: string): string | null => cellarPieceReason(furnitureDef(kind));
