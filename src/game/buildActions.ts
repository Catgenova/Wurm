import type { ActionDef, Target } from './actions';
import {
  borderOf,
  CELLAR_DEPTH,
  describeNeeds,
  scaledBill,
  FLOOR_KIND_NAMES,
  floorName,
  floorKind,
  isDone,
  MATERIAL_BY_ID,
  MAX_LEVELS,
  SIDE_NAMES,
  gapText,
  heftWord,
  onlyRefusal,
  roofShapeDef,
  storeySkill,
  WALL_TYPE_BY_ID,
  type Bill,
  type Building,
  type Side,
  type Wall,
  type WallType,
  type FloorKind,
  type MaterialDef,
  jobLevel,
} from './building';
import type { PlacedCrate } from './crates';
import { dyedAlready, dyeRefusal, litresWord, pickDye, spendDye } from './dyes';
import { colourWord, DYE_LITRES } from './dyestuffs';
import type { Game } from './game';
import { gatePlanRefusal, gateRemoveRefusal, planGate, planLine } from './gates';
import { greenNow } from './greening';
import { glassPlanRefusal, glassResync } from './glasshouse';
import { counterFinished, counterGone, counterPlanRefusal, counterRemoveRefusal, counterStreetRefusal } from './counters';
import { lampWallRefusal } from './lamps';
import { itemDef, spendOut, type Item } from './items';
import { billPlus, deckBears, deckCarries, metres, pierBill, pierDrop } from './piers';
import { TileType } from '../world/tiles';
import { floorHolds, jettyOnWall, jettyOver, jettyReason, jettyRoofOnWall, storeyOf, storeyOnWall, terraceRailed, wallFrameReason, wallLevelOf } from './frame';

type TileTarget = Extract<Target, { kind: 'tile' }>;
const isTile = (t: Target): t is TileTarget => t.kind === 'tile';

const TOOL_NAMES: Record<string, string> = { mallet: 'a mallet', trowel: 'a trowel' };
export const needTool = (g: Game, tool: string): string | null => (g.inventory.has(tool) ? null : `You need ${TOOL_NAMES[tool] ?? tool} for that.`);

/** Plural-ish item names for material lists. */
export function materialName(id: string, n: number): string {
  const name = itemDef(id).name.toLowerCase();
  if (n === 1 || name.endsWith('s') || ['mortar', 'thatch', 'adobe'].includes(name)) return name;
  return `${name}s`;
}

export const needsText = (bill: Bill): string => describeNeeds(bill, materialName);

/**
 * The work site: a crate standing on the tile you are building on.
 *
 * A builder carried everything. Six log walls, at what a log weighs, is trip
 * after trip from the woodpile to the corner of a house, and the crate you
 * tipped them all into is standing on the very tile you are working — which
 * is where a builder's materials have stood since anybody built anything. So
 * the bill draws from a crate on the tile first and from the pack after: the
 * pile on the site is the pile you are building out of.
 *
 * On the tile, not within reach: a crate two tiles off is a store, and walking
 * to it is the point of it being over there.
 */
const siteCrates = (g: Game, x: number, y: number): PlacedCrate[] =>
  [...g.crates.values()].filter((c) => c.x === x && c.y === y);

/**
 * What a perk names building work by: `build_stone` for anything laid with
 * the trowel, `build_wood` for timber (`time:build_stone`, `reach:build_stone`).
 */
export const buildWork = (mat: MaterialDef | undefined): string => `build_${mat?.kind ?? 'wood'}`;

/**
 * The stores a Mason's Hod Carrier builds out of, besides the pack and a
 * crate on the tile: those within the perk's reach that a craft may take
 * from, nearest first. None for anybody without it, and none for timber.
 */
const hodStores = (g: Game, mat: MaterialDef | undefined): Array<{ items: Item[] }> => {
  const reach = g.perk(`reach:${buildWork(mat)}`, 0);
  return reach > 0 ? g.storesWithin(reach) : [];
};
const takeable = (it: Item, id: string): boolean => it.id === id && it.count > 0 && !it.locked && it.price === undefined;

/** The next item on a bill that is to hand: in the pack, in a crate on the tile, or in a Hod Carrier's reach. */
export function nextAvailable(g: Game, bill: Bill & { material: string }, at?: { x: number; y: number }): string | null {
  const stores = hodStores(g, material(bill.material));
  for (const [id, n] of Object.entries(bill.needed)) {
    if (n <= 0) continue;
    if (g.inventory.has(id)) return id;
    if (at && siteCrates(g, at.x, at.y).some((c) => c.items.some((it) => it.id === id && it.count > 0))) return id;
    if (stores.some((st) => st.items.some((it) => takeable(it, id)))) return id;
  }
  return null;
}

/** One unit of `id` out of the pack, then a crate on the tile, then a Hod Carrier's stores. */
function takeUnit(g: Game, id: string, mat: MaterialDef | undefined, at?: { x: number; y: number }): boolean {
  if (g.inventory.has(id)) return g.inventory.consume(id);
  // Out of the crate on the site, a unit at a time, and the row goes when
  // the last of it does.
  for (const c of siteCrates(g, at?.x ?? 0, at?.y ?? 0)) {
    const i = c.items.findIndex((it) => it.id === id && it.count > 0);
    if (i < 0) continue;
    const it = c.items[i];
    it.count -= 1;
    if (it.count <= 0) c.items.splice(i, 1);
    return true;
  }
  for (const st of hodStores(g, mat)) {
    const it = st.items.find((x) => takeable(x, id));
    if (it && spendOut(st.items, it.uid, 1)) {
      g.events.emit('crate');
      return true;
    }
  }
  return false;
}

export function consumeUnit(g: Game, bill: Bill & { material: string }, at?: { x: number; y: number }): string | null {
  const id = nextAvailable(g, bill, at);
  if (!id || !takeUnit(g, id, material(bill.material), at)) return null;
  bill.needed[id] -= 1;
  return id;
}

/** How much of `id` is to hand for a bill: the pack, a crate on the tile, and a Hod Carrier's reach. */
function toHand(g: Game, id: string, mat: MaterialDef | undefined, at: { x: number; y: number }): number {
  let n = g.inventory.count(id);
  for (const c of siteCrates(g, at.x, at.y)) for (const it of c.items) if (it.id === id) n += it.count;
  for (const st of hodStores(g, mat)) for (const it of st.items) if (takeable(it, id)) n += it.count;
  return n;
}

/**
 * A Mason's Repoint.
 *
 * A finished stone wall laid again in another stone, in one go: the new
 * stone's whole bill is paid out of whatever a wall may be built out of, the
 * fittings stay where they are, and `REPOINT_BACK` of the old stone comes
 * back -- the bricks, shards or adobe, not the mortar, which is spent once it
 * has set. The paint goes with the old face.
 */
/**
 * The share of its material a wall of this type is planned for: all of it,
 * or less for a fence type and a Carpenter's Fence Builder (`bill:fence`).
 * A fence type is one that stands on its own border (`FENCE_TYPES`), wherever
 * it is planned; the island asks the same of `wall_type_def.standalone`.
 */
export const fenceScale = (g: Game, type: WallType): number =>
  WALL_TYPE_BY_ID.get(type)?.standalone ? g.perk('bill:fence', 1) : 1;

export const REPOINT_BACK = 0.5;
export const REPOINT_TIME = 30;
/** What a wall of `mat` is laid in, without its fittings: the bill a Repoint pays. */
export const layingBill = (mat: string, type: Wall['type']): Bill => scaledBill(mat, WALL_TYPE_BY_ID.get(type)?.factor ?? 1);

function repointReason(g: Game, t: TileTarget): string | null {
  if (g.perk('repoint', 0) <= 0) return 'That wants a Mason who has learned to repoint.';
  if (!t.side) return 'Choose a side.';
  const wall = wallAt(g, t);
  if (!wall) return 'There is no wall there.';
  const was = material(wall.material);
  if (was?.kind !== 'stone') return 'Only a wall of stone is repointed.';
  if (!isDone(wall)) return 'Finish it before you repoint it.';
  const mat = material(t.material);
  if (!mat || mat.kind !== 'stone') return 'Choose the stone to lay it in.';
  if (mat.id === was.id) return `It is ${mat.name.toLowerCase()} already.`;
  const only = onlyRefusal(mat.id, { wall: wall.type });
  if (only) return only;
  const tool = needTool(g, mat.tool);
  if (tool) return tool;
  const b = storeyOf(g, t);
  if (b && wall.building === b.id) {
    // What is under it has to carry the new stone, as it would a new wall,
    // and the new stone has to carry what stands on it.
    // A building on piers stands on its decks, which carry what they are laid in (`piers.ts`).
    const deck = b.deck != null ? deckCarries(mat, g.buildings.deckUnder(b), b.name) : null;
    if (deck) return deck;
    const bears = g.buildings.bearing(b, wall.level);
    if (mat.heft > bears) return `${mat.name} is too heavy to raise over what is under it. This storey carries ${heftWord(bears)}, no more.`;
    let over = 0;
    for (const w of g.buildings.walls.values()) {
      if (w.building === b.id && w.level > wall.level) over = Math.max(over, material(w.material)?.heft ?? 0);
    }
    if (mat.heft < over) return `${mat.name} will not carry the ${heftWord(over)} standing on it.`;
    const stands = mat.storeys + g.perk(`storeys:${buildWork(mat)}`, 0);
    if (b.levels > stands) return `${mat.name} will not stand ${b.levels} storeys. ${stands} is as high as it goes.`;
  }
  const bill = layingBill(mat.id, wall.type);
  const short = Object.entries(bill.needed).filter(([id, n]) => toHand(g, id, mat, t) < n);
  if (short.length) return `You need ${needsText(bill)}.`;
  return null;
}

const buildingOf = (g: Game, t: TileTarget): Building | undefined => g.buildings.buildingAt(t.x, t.y);
/** The storey a floor job is for: the one it names, or the one being worked (`jobLevel`). */
const topLevel = (b: Building, t: TileTarget): number => jobLevel(b, t);
/**
 * The storey a floor job works on: the roof's, over the top storey; the
 * ground floor's, for a flight or a ladder down to a cellar (`down`), whatever
 * storey the building is being worked on; and otherwise the one the job names,
 * or the one being worked (`jobLevel`).
 */
const slotLevel = (t: TileTarget, b: Building): number => (t.floorKind === 'roof' ? b.levels : t.down ? 0 : topLevel(b, t));
/**
 * Whether a flight or a ladder down planned here goes in where the ground
 * floor is floored: it takes the flooring up, as taking the flooring up
 * would, rather than asking for it to be taken up first -- which on a tile
 * with a wall along it is not to be had while the wall stands.
 */
const flooringUnder = (g: Game, t: TileTarget, level: number, kind: FloorKind): boolean => {
  const there = g.buildings.floor(level, t.x, t.y);
  return level === 0 && (kind === 'stairs' || kind === 'ladder') && !!there && floorKind(there) === 'floor';
};
/** The tile across a side of another: where the foot of a flight climbed from that side lands. */
const across = (x: number, y: number, side: Side): [number, number] =>
  side === 'n' ? [x, y - 1] : side === 's' ? [x, y + 1] : side === 'w' ? [x - 1, y] : [x + 1, y];
/**
 * Why a flight or a ladder cannot go down from the ground floor here, into
 * the cellar under it, or null. It stands over a tile of the cellar and comes
 * down, on the side it is climbed from, onto another: the island's
 * `cellar_flight_refusal` says the same.
 */
function flightDownReason(g: Game, t: TileTarget, b: Building): string | null {
  const c = g.buildings.cellar(t.x, t.y);
  if (!c && !t.down) {
    // Not a way down, so a way up: jobs go to the storey being worked on (`jobLevel`), and in a building with one over the ground it is that storey to work on.
    return b.levels > 1 ? `Work on storey 2 or above to plan ${t.floorKind === 'ladder' ? 'a ladder' : 'stairs'} here.`
      : 'Stairs and ladders belong to an upper storey; plan another storey first.';
  }
  const dug = c?.dug ?? 0;
  if (dug < CELLAR_DEPTH) return `Dig the cellar out under it first: it is ${dug} of ${CELLAR_DEPTH} down.`;
  // A glasshouse's field is cleared before anything is planned over it (`glasshouse.ts`).
  if (g.world.getTile(t.x, t.y) === TileType.Field) return 'There is a field here: clear the field before you plan a way down through it.';
  if (!t.side) return 'Choose the side to climb from.';
  const [fx, fy] = across(t.x, t.y, t.side);
  if (g.buildings.cellar(fx, fy)?.building !== b.id || !g.buildings.cellarDone(fx, fy)) {
    return `Its foot would come down on ${fx},${fy}, and there is no cellar dug out there to come down on.`;
  }
  return null;
}
/**
 * Why a flight or a ladder cannot go in here because one the other way is
 * on the same tile, or null. A flight up from the ground floor and a flight
 * down from it would both be walked onto from the ground floor's tile, and
 * only the one would ever be taken: one way off the ground floor a tile. The
 * island's `cellar_stack_refusal` says the same.
 */
function stackedFlightReason(g: Game, t: TileTarget, level: number): string | null {
  const other = level === 1 ? g.buildings.floor(0, t.x, t.y) : level === 0 ? g.buildings.floor(1, t.x, t.y) : undefined;
  if (!other || (floorKind(other) !== 'stairs' && floorKind(other) !== 'ladder')) return null;
  const what = FLOOR_KIND_NAMES[floorKind(other)];
  return level === 1 ? `The ${what} down to the cellar is there.` : `The ${what} up to the next storey is there.`;
}
/** The storey wall work happens on: a building's working one, a jetty's, round a flat roof, or the ground (`wallLevelOf`). */
const wallLevel = (g: Game, t: TileTarget): number => wallLevelOf(g, t);
/** The wall or fence on the side of a tile that is being worked on. */
const wallAt = (g: Game, t: TileTarget) => (t.side ? g.buildings.wall(wallLevel(g, t), t.x, t.y, t.side) : undefined);
const material = (id: string | undefined): MaterialDef | undefined => (id ? MATERIAL_BY_ID.get(id) : undefined);
/** "second", "third": the ordinal ending, for the sentence that names a storey. */
const nth = (n: number): string => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

/** Building work. These are hidden from the generic menu; the UI composes them with sides and materials. */
export const BUILD_ACTIONS: ActionDef[] = [
  {
    id: 'plan_building',
    label: 'Plan building',
    verb: 'planning a building',
    hidden: true,
    asks: {
      question: 'What is the building called?',
      fallback: () => 'House',
      declined: 'You put the mallet away without planning anything.',
    },
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => isTile(t) && !g.buildings.buildingAt(t.x, t.y),
    // Nor under a jetty (`frame.ts`), nor on the street a shop counter sells onto (`counters.ts`).
    check: (t, g) => (isTile(t) ? (jettyOver(g, t.x, t.y) ?? needTool(g, 'mallet') ?? g.planReason(t.x, t.y) ?? counterStreetRefusal(g, t.x, t.y)) : null),
    perform: (t, g) => {
      if (!isTile(t)) return;
      const name = ((t as { name?: string }).name ?? '').trim();
      // On level ground, as it stands; anywhere else, on piers under a deck at the tile's top (`piers.ts`).
      const site = g.foundationAt(t.x, t.y) ? null : g.pierSite(t.x, t.y);
      const deck = site?.deck ?? undefined;
      const b = g.buildings.create(name.slice(0, 32) || 'House', t.x, t.y, deck);
      // Nothing walks under a deck: a creature standing there is moved off (`Creatures.shoo`).
      if (deck !== undefined) g.creatures.shoo(g, t.x, t.y);
      if (site && deck !== undefined) {
        g.logMsg(`You plan ${b.name} here on piers: its deck at ${deck}, ${metres(pierDrop(site.ground, deck))} m over the lowest ground under it.`
          + ' Plan the deck to build it and the piers under it, then plan walls on it.', 'event');
      } else {
        g.logMsg(`You plan ${b.name} here. Extend it onto neighbouring flat packed tiles, then plan walls on its borders.`, 'event');
      }
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'add_to_building',
    label: 'Add to building',
    verb: 'extending the plan',
    hidden: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !g.buildings.buildingAt(t.x, t.y) && !!g.buildings.neighbourBuilding(t.x, t.y),
    check: (t, g) => {
      if (!isTile(t)) return null;
      const over = jettyOver(g, t.x, t.y);
      if (over) return over;
      const tool = needTool(g, 'mallet');
      if (tool) return tool;
      const b = g.buildings.neighbourBuilding(t.x, t.y);
      if (!b) return 'There is no building next to this tile.';
      if (b.levels > 1) return 'The footprint cannot change once upper floors are planned.';
      return g.planReason(t.x, t.y, b) ?? counterStreetRefusal(g, t.x, t.y);
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = g.buildings.neighbourBuilding(t.x, t.y);
      if (!b) return;
      // Under the building's deck, or its floor if it has no deck yet, where the ground is not level with it (`piers.ts`).
      const site = g.foundationAt(t.x, t.y) ? null : g.pierSite(t.x, t.y, b);
      const deck = site?.deck ?? undefined;
      g.buildings.addTile(b, t.x, t.y, deck);
      if (deck !== undefined) g.creatures.shoo(g, t.x, t.y);
      // A tile with no glass over it: a glasshouse is one no longer, and what grows in it goes back on the field's clock.
      glassResync(g);
      if (site && deck !== undefined) {
        g.logMsg(`You add the tile to ${b.name} on piers: under its deck at ${deck}, ${metres(pierDrop(site.ground, deck))} m over the lowest ground under it.`, 'event');
      } else {
        g.logMsg(`You add the tile to ${b.name}.`, 'event');
      }
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'remove_from_plan',
    label: 'Remove from plan',
    verb: 'removing the plan',
    hidden: true,
    stamina: 0.01,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t)) return null;
      const b = buildingOf(g, t);
      if (!b) return 'No building here.';
      if (b.levels > 1) return 'Remove the upper floors first.';
      // A building with a cellar under it comes down only once the cellar is filled in: see `cellar.ts`.
      if (g.buildings.cellar(t.x, t.y)) return 'Fill in the cellar under it first.';
      if (g.buildings.tileHasStructures(t.x, t.y)) return 'Remove the walls and floor on this tile first.';
      // And the columns on its corners, which would be left standing on nothing.
      for (const [cx, cy] of [[t.x, t.y], [t.x + 1, t.y], [t.x + 1, t.y + 1], [t.x, t.y + 1]]) {
        if (g.buildings.column(0, cx, cy)) return 'Take down the columns on its corners first.';
      }
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      if (!b) return;
      g.buildings.removeTile(b, t.x, t.y);
      glassResync(g);
      g.logMsg(b.tiles.length ? `You remove the tile from ${b.name}.` : `You remove the last of ${b.name}'s plan.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'plan_wall',
    label: 'Plan wall',
    verb: 'planning a wall',
    hidden: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !!storeyOf(g, t),
    check: (t, g) => {
      if (!isTile(t) || !t.side || !t.wallType || !t.material) return 'Choose a side, a wall type and a material.';
      // Glass goes on a roof and nowhere else (`glasshouse.ts`).
      const glass = glassPlanRefusal(g, t, 'plan_wall');
      if (glass) return glass;
      const tool = needTool(g, 'mallet');
      if (tool) return tool;
      const b = storeyOf(g, t);
      if (!b) return 'No building here.';
      // Round a flat roof only a railing, and a railing only off the ground (`frame.ts`).
      const frame = wallFrameReason(g, t, b);
      if (frame) return frame;
      const level = wallLevel(g, t);
      // On an upper storey, and on the ground floor of a tile on piers, which is its deck.
      if (level > 0 || g.buildings.onPiers(t.x, t.y)) {
        const floor = g.buildings.floor(level, t.x, t.y);
        if (!floor || !isDone(floor)) return 'Build the floor of this storey first.';
      }
      if (g.buildings.wall(level, t.x, t.y, t.side)) return 'There is already a wall on that side.';
      // A shop counter faces the street from the ground floor (`counters.ts`).
      if (t.wallType === 'counter') {
        const street = counterPlanRefusal(g, b, level, t.x, t.y, t.side);
        if (street) return street;
      }
      // Nor does a wall close over a lantern post's arm (`lamps.ts`).
      const arm = lampWallRefusal(g, level, t.x, t.y, t.side, t.wallType);
      if (arm) return arm;
      /*
       * And what is underneath has to carry it. A storey of cut stone raised
       * over a log one is a roof looking for somewhere to fall; the courses
       * below are what hold a wall up, and a beginner finds that out by
       * being told rather than by watching it come down.
       */
      const mat = material(t.material);
      // And a building on piers stands on its decks, which carry what they are laid in (`piers.ts`).
      const deck = mat && b.deck != null ? deckCarries(mat, g.buildings.deckUnder(b), b.name) : null;
      if (deck) return deck;
      const bears = g.buildings.bearing(b, level);
      if (mat && mat.heft > bears) {
        return `${mat.name} is too heavy to raise over what is under it. This storey carries ${heftWord(bears)}, no more.`;
      }
      // A portcullis in stone on the ground floor; a hidden door's padlock and hinges in hand (`gates.ts`).
      return gatePlanRefusal(t.wallType, mat, level, !g.buildings.buildingAt(t.x, t.y));
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side || !t.wallType || !t.material) return;
      const b = storeyOf(g, t);
      if (!b) return;
      // A fence type stood in a building is still a fence, to a Carpenter's Fence Builder.
      const wall = g.buildings.setWall(b, wallLevel(g, t), t.x, t.y, t.side, t.wallType, t.material, fenceScale(g, t.wallType));
      // gates: a solid wall planned on a border its planner asked a hidden door on takes its padlock and hinges now,
      // and cuts its key, and says so on the end of the plan's own line; and any other type is named as what it is
      // ("a portcullis in stone brick", and a railing as "a log railing"), as the island names it (`planLine`).
      const gate = planGate(g, wall);
      // A glasshouse is walled all round (`glasshouse.ts`).
      glassResync(g);
      g.logMsg(`${planLine(t.wallType, material(t.material)?.name ?? t.material, SIDE_NAMES[t.side])} It needs ${needsText(wall)}.${
        gate ? ` ${gate}` : ''}`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'plan_fence',
    label: 'Plan fence',
    verb: 'planning a fence',
    hidden: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t) || !t.side || !t.wallType || !t.material) return 'Choose a side, a kind and a material.';
      const glass = glassPlanRefusal(g, t, 'plan_fence');
      if (glass) return glass;
      const type = WALL_TYPE_BY_ID.get(t.wallType);
      if (!type?.standalone) return 'Only fences and half walls stand on their own.';
      const mat = material(t.material);
      const tool = mat ? needTool(g, mat.tool) : 'Choose a material.';
      if (tool) return tool;
      if (buildingOf(g, t)) return 'That is part of a building: plan a wall instead.';
      const border = borderOf(t.x, t.y, t.side);
      // The border is shared, so the tile on the other side of it has a say.
      const [ax, ay] = t.side === 'n' ? [t.x, t.y - 1] : t.side === 's' ? [t.x, t.y + 1] : t.side === 'w' ? [t.x - 1, t.y] : [t.x + 1, t.y];
      if (g.buildings.buildingAt(ax, ay)) return 'A building stands on the other side of that border.';
      if (!g.world.inBounds(ax, ay)) return 'That border is the edge of the world.';
      if (g.world.hasWater(t.x, t.y) || g.world.hasWater(ax, ay)) return 'Fences do not stand in water.';
      if (!g.world.isPassable(t.x, t.y) || !g.world.isPassable(ax, ay)) return 'There is no room for posts there.';
      if (g.buildings.wallOnBorder(0, border)) return 'There is already something on that border.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side || !t.wallType || !t.material) return;
      // For less of the material, for a Carpenter's Fence Builder, as `perform_building` has it.
      const wall = g.buildings.setFence(t.x, t.y, t.side, t.wallType, t.material, fenceScale(g, t.wallType));
      const type = WALL_TYPE_BY_ID.get(t.wallType)?.name.toLowerCase() ?? 'fence';
      g.logMsg(`You mark out a ${material(t.material)?.name.toLowerCase()} ${type} on the ${SIDE_NAMES[t.side]} border. It needs ${needsText(wall)}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'build_wall',
    label: 'Build wall',
    verb: 'building',
    hidden: true,
    repeat: true,
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => isTile(t) && (!!storeyOf(g, t) || !!wallAt(g, t)),
    check: (t, g) => {
      if (!isTile(t) || !t.side) return 'Choose a side.';
      const wall = wallAt(g, t);
      if (!wall) return 'There is no wall planned there.';
      if (isDone(wall)) return 'That wall is finished.';
      // Nor is one raised over a lantern post's arm (`lamps.ts`).
      const arm = lampWallRefusal(g, wall.level, t.x, t.y, t.side, wall.type);
      if (arm) return arm;
      const mat = material(wall.material);
      const tool = mat ? needTool(g, mat.tool) : null;
      if (tool) return tool;
      if (!nextAvailable(g, wall, t)) return `You need ${needsText(wall)}.`;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side) return false;
      const wall = wallAt(g, t);
      if (!wall || isDone(wall)) return false;
      const mat = material(wall.material);
      const used = consumeUnit(g, wall, t);
      if (!used || !mat) return false;
      g.gainSkill(mat.skill, 0.4);
      g.events.emit('world', t.x, t.y);
      if (isDone(wall)) {
        // Finished, and bare: the ivy starts from here (`greening.ts`).
        wall.greenSince = greenNow();
        // The last wall round a building roofed in glass makes a glasshouse of it (`glasshouse.ts`).
        glassResync(g);
        // A shop counter's store opens as it is finished (`counters.ts`).
        counterFinished(g, wall);
        const what = WALL_TYPE_BY_ID.get(wall.type)?.low ? WALL_TYPE_BY_ID.get(wall.type)?.name.toLowerCase() : 'wall';
        g.logMsg(`You finish the ${mat.name.toLowerCase()} ${what}.`, 'event');
        return false;
      }
      g.logMsg(`You fit ${materialName(used, 1)} into the wall. Still needed: ${needsText(wall)}.`, 'event');
      return nextAvailable(g, wall, t) !== null;
    },
  },
  /*
   * Paint.
   *
   * Everything on this island comes out the colour of what it was made of, so
   * a street of twelve materials is a street of twelve colours and no more:
   * the builder chooses what a wall is *of* and never what it looks like. A
   * litre of the same dye the tailoring uses (`DYE_LITRES`), worked into a
   * limewash and brushed over finished work, is the first thing a builder gets
   * to choose — and it is cheap, which is the point of offering it at all.
   */
  {
    id: 'paint_wall',
    label: 'Paint the wall',
    verb: 'painting',
    hidden: true,
    skill: 'alchemy',
    stamina: 0.02,
    baseTime: 6,
    applies: (t, g) => isTile(t) && !!wallAt(g, t),
    labelFor: (t, g) => {
      const d = pickDye(g, DYE_LITRES.wall);
      return d ? `Paint it ${colourWord(d.hex)}` : 'Paint the wall';
    },
    check: (t, g) => {
      if (!isTile(t) || !t.side) return 'Choose a side.';
      const wall = wallAt(g, t);
      if (!wall) return 'There is no wall there.';
      if (!isDone(wall)) return 'Finish it before you paint it.';
      const d = pickDye(g, DYE_LITRES.wall);
      if (!d) return dyeRefusal(g, DYE_LITRES.wall);
      if (wall.dye === d.hex) return dyedAlready(d.hex);
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side) return;
      const wall = wallAt(g, t);
      const d = pickDye(g, DYE_LITRES.wall);
      if (!wall || !d || !spendDye(g, d.item, DYE_LITRES.wall)) return;
      wall.dye = d.hex;
      g.gainSkill('alchemy', 0.3);
      g.logMsg(`You brush ${litresWord(DYE_LITRES.wall)} of ${colourWord(d.hex)} dye over the wall on the ${SIDE_NAMES[t.side]} side. It comes up ${colourWord(d.hex)}, ${d.hex}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'strip_wall_paint',
    label: 'Scrub the paint off',
    verb: 'scrubbing',
    hidden: true,
    skill: 'alchemy',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => isTile(t) && !!wallAt(g, t)?.dye,
    check: (t, g) => {
      if (!isTile(t) || !t.side) return 'Choose a side.';
      const wall = wallAt(g, t);
      if (!wall?.dye) return 'It has taken no colour.';
      if (!g.inventory.has('lye_bucket')) return 'You need a bucket of lye to scrub it back.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side) return;
      const wall = wallAt(g, t);
      const lye = g.inventory.find('lye_bucket');
      if (!wall || !lye) return;
      g.inventory.remove(lye.uid, 1);
      g.inventory.add('bucket', { ql: lye.ql });
      delete wall.dye;
      g.gainSkill('alchemy', 0.2);
      g.logMsg(`You scrub the wall back to bare ${material(wall.material)?.name.toLowerCase() ?? 'stone'}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'repoint_wall',
    label: 'Repoint the wall',
    verb: 'repointing',
    hidden: true,
    skill: 'masonry',
    tool: 'trowel',
    stamina: 0.06,
    baseTime: REPOINT_TIME,
    applies: (t, g) => isTile(t) && g.perk('repoint', 0) > 0 && material(wallAt(g, t)?.material)?.kind === 'stone',
    labelFor: (t) => (isTile(t) && t.material ? `Repoint in ${material(t.material)?.name.toLowerCase()}` : 'Repoint the wall'),
    check: (t, g) => (isTile(t) ? repointReason(g, t) : null),
    perform: (t, g) => {
      if (!isTile(t) || !t.side || repointReason(g, t)) return;
      const wall = wallAt(g, t);
      const was = material(wall?.material);
      const mat = material(t.material);
      if (!wall || !was || !mat) return;
      const bill = layingBill(mat.id, wall.type);
      for (const [id, n] of Object.entries(bill.needed)) for (let i = 0; i < n; i++) if (!takeUnit(g, id, mat, t)) return;
      // Half the old stone back, rounded down: what was laid of the first thing on its bill.
      const stone = was.bill[0][0];
      const back = Math.floor((wall.total[stone] ?? 0) * REPOINT_BACK);
      if (back > 0) g.inventory.add(stone, { count: back, ql: 20 });
      // The fittings stay where they are; the stone around them is new.
      const fitted = WALL_TYPE_BY_ID.get(wall.type)?.fittings ?? [];
      wall.material = mat.id;
      wall.total = { ...bill.total };
      for (const [id, n] of fitted) wall.total[id] = (wall.total[id] ?? 0) + n;
      wall.needed = Object.fromEntries(Object.keys(wall.total).map((id) => [id, 0]));
      delete wall.dye;
      // New stone, and bare: whatever grew on the old went with it.
      wall.greenSince = greenNow();
      g.gainSkill('masonry', 1);
      g.logMsg(`You take the ${was.name.toLowerCase()} out of the wall on the ${SIDE_NAMES[t.side]} side and lay it again in ${mat.name.toLowerCase()}`
        + `${back > 0 ? `, and save ${back} ${materialName(stone, back)}` : ''}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'paint_floor',
    label: 'Paint the floor',
    verb: 'painting',
    hidden: true,
    skill: 'alchemy',
    stamina: 0.02,
    baseTime: 6,
    applies: (t, g) => {
      if (!isTile(t)) return false;
      const b = storeyOf(g, t);
      return !!b && !!g.buildings.floor(topLevel(b, t), t.x, t.y);
    },
    labelFor: (t, g) => {
      const d = pickDye(g, DYE_LITRES.floor);
      return d ? `Paint the floor ${colourWord(d.hex)}` : 'Paint the floor';
    },
    check: (t, g) => {
      if (!isTile(t)) return null;
      const b = storeyOf(g, t);
      const floor = b && g.buildings.floor(topLevel(b, t), t.x, t.y);
      if (!floor) return 'There is no floor here.';
      if (!isDone(floor)) return 'Finish it before you paint it.';
      const d = pickDye(g, DYE_LITRES.floor);
      if (!d) return dyeRefusal(g, DYE_LITRES.floor);
      if (floor.dye === d.hex) return dyedAlready(d.hex);
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = storeyOf(g, t);
      const floor = b && g.buildings.floor(topLevel(b, t), t.x, t.y);
      const d = pickDye(g, DYE_LITRES.floor);
      if (!floor || !d || !spendDye(g, d.item, DYE_LITRES.floor)) return;
      floor.dye = d.hex;
      g.gainSkill('alchemy', 0.3);
      g.logMsg(`You work ${litresWord(DYE_LITRES.floor)} of ${colourWord(d.hex)} dye into the boards. The floor comes up ${colourWord(d.hex)}, ${d.hex}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'remove_wall',
    label: 'Remove wall',
    verb: 'taking down the wall',
    hidden: true,
    stamina: 0.04,
    baseTime: 4,
    applies: (t, g) => isTile(t) && (!!storeyOf(g, t) || !!wallAt(g, t)),
    check: (t, g) => {
      if (!isTile(t) || !t.side) return 'Choose a side.';
      const wall = wallAt(g, t);
      if (!wall) return 'There is no wall there.';
      // A jetty resting on it alone would be left in the air, and so would a roof over one, or the storey over it (`frame.ts`).
      const jetty = jettyOnWall(g, wall);
      if (jetty !== null) return `A jetty of storey ${jetty + 1} rests on this wall: raise a column at each end of it, or tear the jetty up, first.`;
      const over = jettyRoofOnWall(g, wall) ?? storeyOnWall(g, wall);
      if (over) return over;
      // And a shop counter comes down empty, till and all (`counters.ts`).
      const counter = counterRemoveRefusal(g, wall);
      if (counter) return counter;
      // gates: a padlock on a portcullis keeps it from being taken down as from being worked (`gates.ts`).
      return gateRemoveRefusal(g, wall);
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side) return;
      const wall = wallAt(g, t);
      if (!wall || counterRemoveRefusal(g, wall)) return;
      counterGone(g, wall);
      const what = WALL_TYPE_BY_ID.get(wall.type)?.low ? (WALL_TYPE_BY_ID.get(wall.type)?.name.toLowerCase() ?? 'fence') : 'wall';
      g.buildings.removeWall(wallLevel(g, t), t.x, t.y, t.side);
      // A glasshouse with a wall down is open to the weather (`glasshouse.ts`).
      glassResync(g);
      g.logMsg(`You take down the ${what} on the ${SIDE_NAMES[t.side]} side.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'add_floor',
    label: 'Plan another storey',
    verb: 'planning a storey',
    hidden: true,
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t)) return null;
      // No storey over a field (`glasshouse.ts`).
      const glass = glassPlanRefusal(g, t, 'add_floor');
      if (glass) return glass;
      const tool = needTool(g, 'mallet');
      if (tool) return tool;
      const b = buildingOf(g, t);
      if (!b) return 'No building here.';
      // A Mason's Tall Walls: stone stands higher in a building of theirs.
      const tall = g.perk('storeys:build_stone', 0);
      if (b.levels >= MAX_LEVELS + tall) return `Buildings cannot be taller than ${MAX_LEVELS + tall} storeys.`;
      /*
       * And no taller than what it is made of will stand.
       *
       * The shortest material in the whole building answers, not the one you
       * are standing on: a plank wing joined to a stone tower caps the tower,
       * because a building is one thing and comes down as one thing.
       */
      const cap = g.buildings.storeyCap(b, tall);
      if (b.levels >= cap) {
        const stands = (m: MaterialDef): number => m.storeys + (m.kind === 'stone' ? tall : 0);
        const worst = g.buildings.materialsIn(b).reduce((a, m) => (a && stands(a) <= stands(m) ? a : m), undefined as MaterialDef | undefined);
        return `${worst?.name ?? 'What this is built of'} will not stand ${cap + 1} storeys. ${cap} is as high as it goes.`;
      }
      // And the hands to raise it: ten a storey in the trade of the one below.
      const under = g.buildings.storeyMaterial(b, b.levels - 1);
      const want = storeySkill(b.levels);
      if (under && g.skills.get(under.skill) < want) {
        return `Raising a ${b.levels + 1}${nth(b.levels + 1)} storey over ${under.name.toLowerCase()} takes ${under.skill} ${want}. You have ${g.skills.get(under.skill).toFixed(1)}.`;
      }
      if (g.buildings.hasRoof(b)) return 'Take the roof off first.';
      if (g.buildings.hasLowWall(b, b.levels - 1)) {
        return 'Nothing rests on a fence, a half wall or a railing: the storey below needs walls, or finished columns at both ends of every open side.';
      }
      const below = gapText(b.levels, g.buildings.levelGaps(b, b.levels - 1, g.player.x, g.player.y));
      if (below) return below;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      if (!b) return;
      b.levels += 1;
      b.workLevel = b.levels - 1;
      glassResync(g);
      g.logMsg(`You plan storey ${b.levels} of ${b.name}. Plan and build its floor tiles, then raise walls on them.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'plan_floor',
    label: 'Plan floor',
    verb: 'planning a floor',
    hidden: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !!storeyOf(g, t),
    check: (t, g) => {
      if (!isTile(t) || !t.material) return 'Choose a material.';
      // Glass on a pitched roof and nowhere else, no floor over a field, and no roof but glass on a building with one (`glasshouse.ts`).
      const glass = glassPlanRefusal(g, t, 'plan_floor');
      if (glass) return glass;
      const tool = needTool(g, 'mallet');
      if (tool) return tool;
      const b = storeyOf(g, t);
      if (!b) return 'No building here.';
      const kind: FloorKind = t.floorKind ?? 'floor';
      const level = slotLevel(t, b);
      // Out past the footprint: a jetty, or the roof over one (`frame.ts`).
      if (!buildingOf(g, t)) {
        const jetty = jettyReason(g, t, b, kind, level);
        if (jetty) return jetty;
      }
      if (kind === 'roof') {
        // Which storey and which border, because "all walls must be built"
        // reads like a lie while you are standing in a finished room and the
        // storey that is short of a wall is the one planned over your head.
        const top = gapText(b.levels, g.buildings.levelGaps(b, b.levels - 1, g.player.x, g.player.y));
        if (top) return top;
      } else if (kind === 'stairs' || kind === 'ladder') {
        // On the ground floor, a way down to the cellar under it.
        if (level < 1) {
          const down = flightDownReason(g, t, b);
          if (down) return down;
        }
        if (!t.side) return 'Choose the side to climb from.';
        // A flight or a ladder up from a tile on piers stands on its deck.
        if ((level > 1 || g.buildings.onPiers(t.x, t.y)) && !g.buildings.floor(level - 1, t.x, t.y)) return 'Plan the floor of the storey below first.';
        const stacked = stackedFlightReason(g, t, level);
        if (stacked) return stacked;
      }
      // A flight or a ladder down takes up the ground floor's flooring where it goes (`flooringUnder`).
      if (g.buildings.floor(level, t.x, t.y) && !flooringUnder(g, t, level, kind)) {
        return kind === 'roof' ? 'There is already roof planned here.' : 'There is already a floor planned here.';
      }
      // A deck on piers carries what it is laid in, and the building standing on it is as heavy as its heaviest wall.
      const mat = material(t.material);
      if (mat && level === 0 && kind === 'floor' && g.buildings.onPiers(t.x, t.y)) return deckBears(mat, g.buildings.heaviestWall(b), b.name);
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.material) return;
      const b = storeyOf(g, t);
      if (!b) return;
      const kind: FloorKind = t.floorKind ?? 'floor';
      const level = slotLevel(t, b);
      /*
       * A building has one roof, so the first tile of it decides the shape and
       * the rest follow. Changing your mind means taking the roof off, which
       * is what changing your mind about a roof means anywhere.
       */
      if (kind === 'roof' && !b.roof) b.roof = t.roofShape ?? 'hip';
      if (flooringUnder(g, t, level, kind)) g.logMsg('You take up the flooring there.', 'event');
      const floor = g.buildings.setFloor(b, level, t.x, t.y, t.material, kind, kind === 'stairs' || kind === 'ladder' ? t.side : undefined,
        kind === 'stairs' ? t.hand : undefined);
      glassResync(g);
      // The ground floor of a tile on piers is its deck, and the piers under it go on its bill (`piers.ts`).
      const piers = level === 0 && kind === 'floor' && g.buildings.onPiers(t.x, t.y);
      if (piers) Object.assign(floor, billPlus(floor, pierBill(t.material, g.pierDropAt(t.x, t.y))));
      const shape = kind === 'roof' ? `${roofShapeDef(b).name.toLowerCase()} ` : '';
      const what = kind === 'ladder' ? 'ladder' : `${shape}${material(t.material)?.name.toLowerCase()} ${piers ? 'deck on piers' : floorName(floor)}`;
      g.logMsg(`You plan a ${what}. It needs ${needsText(floor)}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'build_floor',
    label: 'Build floor',
    verb: 'building',
    hidden: true,
    repeat: true,
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => isTile(t) && !!storeyOf(g, t),
    check: (t, g) => {
      if (!isTile(t)) return null;
      const b = storeyOf(g, t);
      const floor = b && g.buildings.floor(slotLevel(t, b), t.x, t.y);
      if (!floor) return 'There is nothing planned here.';
      if (isDone(floor)) return 'That is already finished.';
      const mat = material(floor.material);
      const tool = floorKind(floor) === 'ladder' ? needTool(g, 'mallet') : mat ? needTool(g, mat.tool) : null;
      if (tool) return tool;
      if (!nextAvailable(g, floor, t)) return `You need ${needsText(floor)}.`;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return false;
      const b = storeyOf(g, t);
      const floor = b && g.buildings.floor(slotLevel(t, b), t.x, t.y);
      if (!floor || isDone(floor)) return false;
      const used = consumeUnit(g, floor, t);
      if (!used) return false;
      // The last pane of a glass roof makes a glasshouse, and what grows in it goes onto the glass clock.
      glassResync(g);
      const kind = floorKind(floor);
      const mat = material(floor.material);
      // Floors are paving; stairs, ladders and roofs are carpentry or masonry by material.
      g.gainSkill(kind === 'floor' ? 'paving' : kind === 'ladder' ? 'carpentry' : (mat?.skill ?? 'carpentry'), 0.4);
      g.events.emit('world', t.x, t.y);
      const what = kind === 'ladder' ? 'ladder' : `${mat?.name.toLowerCase()} ${floorName(floor)}`;
      if (isDone(floor)) {
        g.logMsg(`You finish the ${what}.`, 'event');
        return false;
      }
      g.logMsg(`You work ${materialName(used, 1)} into the ${floorName(floor)}. Still needed: ${needsText(floor)}.`, 'event');
      return nextAvailable(g, floor, t) !== null;
    },
  },
  {
    id: 'remove_floor',
    label: 'Remove floor',
    verb: 'tearing up the floor',
    hidden: true,
    stamina: 0.04,
    baseTime: 4,
    applies: (t, g) => isTile(t) && !!storeyOf(g, t),
    check: (t, g) => {
      if (!isTile(t)) return null;
      const b = storeyOf(g, t);
      if (!b) return 'No building here.';
      const level = slotLevel(t, b);
      const floor = g.buildings.floor(level, t.x, t.y);
      if (!floor) return 'There is nothing here to remove.';
      // A flight down is let into the ground floor, and the walls round it stand on the ground;
      // and a way down is a way up too, for whoever is down there.
      if (level === 0 && (floorKind(floor) === 'stairs' || floorKind(floor) === 'ladder')) {
        return g.buildings.cellar(t.x, t.y) && g.cellarOccupied(b) ? 'Somebody is down in the cellar, and this is a way up out of it.' : null;
      }
      // A railing round a flat roof stands on it (`frame.ts`).
      if (floorKind(floor) === 'roof' && terraceRailed(g, b, t.x, t.y)) return 'Take down the railing standing on it first.';
      if (floorKind(floor) !== 'roof') {
        // A wall stands on a floor only where it may not go up without a finished one (`plan_wall`): a storey up, or a
        // deck on piers. On the ground floor it stands on the ground, and a floor still planned carries nothing.
        if (isDone(floor) && (level > 0 || g.buildings.onPiers(t.x, t.y))) {
          for (const side of ['n', 'e', 's', 'w'] as const) if (g.buildings.wall(level, t.x, t.y, side)) return 'Take down the walls standing on it first.';
        }
        // A column on it, or the roof over a jetty (`frame.ts`).
        const holds = floorHolds(g, b, level, t.x, t.y);
        if (holds) return holds;
      }
      // A deck on piers holds up whatever stands or lies on it, and whoever is taking it up (`deck_refusal`).
      if (level === 0 && g.buildings.onPiers(t.x, t.y)) {
        if (g.anythingPlaced(t.x, t.y) || g.groundAt(t.x, t.y).length) return 'Clear what stands or lies on the deck first.';
        if (g.bridges.size && g.bridgeEndAt(t.x, t.y)) return 'A bridge lands on the deck. Take the bridge down first.';
        const p = g.player;
        if (p.level === 0 && p.tileX === t.x && p.tileY === t.y) return 'Step off the deck first.';
        if (g.peerOn(t.x, t.y)) return 'Somebody is standing on the deck.';
      }
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = storeyOf(g, t);
      if (!b) return;
      const level = slotLevel(t, b);
      const floor = g.buildings.floor(level, t.x, t.y);
      if (!floor) return;
      g.buildings.removeFloor(level, t.x, t.y);
      // Glass taken off a glasshouse: what grows in it goes back on the field's clock.
      glassResync(g);
      const p = g.player;
      if (p.tileX === t.x && p.tileY === t.y && p.level >= level && level > 0) p.level = level - 1;
      g.logMsg(`You remove the ${floorName(floor)}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'remove_storey',
    label: 'Remove top storey',
    verb: 'removing the storey',
    hidden: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && (buildingOf(g, t)?.levels ?? 0) > 1,
    check: (t, g) => {
      if (!isTile(t)) return null;
      const b = buildingOf(g, t);
      if (!b || b.levels <= 1) return 'There is no upper storey.';
      const level = b.levels - 1;
      if (g.buildings.hasRoof(b)) return 'Take the roof off first.';
      for (const w of g.buildings.walls.values()) if (w.building === b.id && w.level === level) return 'Take down the walls of the top storey first.';
      for (const f of g.buildings.floors.values()) if (f.building === b.id && f.level === level) return 'Tear up the floors of the top storey first.';
      for (const c of g.buildings.columns.values()) if (c.building === b.id && c.level === level) return 'Take down the columns of the top storey first.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      if (!b || b.levels <= 1) return;
      b.levels -= 1;
      b.workLevel = b.levels - 1;
      glassResync(g);
      g.logMsg(`${b.name} is back to ${b.levels === 1 ? 'a single storey' : `${b.levels} storeys`}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'rename_building',
    asks: {
      question: 'What should the building be called?',
      fallback: (t, g) => (isTile(t) ? buildingOf(g, t)?.name ?? '' : ''),
    },
    label: 'Rename building',
    verb: 'renaming',
    hidden: true,
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      if (!b) return;
      const name = ((t as { name?: string }).name ?? '').trim();
      if (!name) return;
      b.name = name.slice(0, 32);
      g.logMsg(`The building is now called ${b.name}.`, 'event');
    },
  },
];

export const BUILD_ACTION_BY_ID = new Map(BUILD_ACTIONS.map((a) => [a.id, a]));
