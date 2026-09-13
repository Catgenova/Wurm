import type { ActionDef, Target } from './actions';
import { FUEL_VALUES, hasAshes, isFuel, rakeAshes } from './campfire';
import {
  BUCKET_LITRES,
  BUCKET_OF,
  furnitureCentre,
  furnitureDef,
  furnitureName,
  holdsLiquid,
  isWell,
  liquidCapacity,
  litresIn,
  LIQUID_NAME,
  VESSELS,
  type LiquidKind,
  type PlacedFurniture,
} from './furniture';
import type { Game } from './game';
import { itemDef, type Item } from './items';

/**
 * The placed things that do something of their own: an oven that burns, a well
 * that fills, barrels that hold a liquid and nothing else, a cart that follows
 * you about, and a bed worth waking in.
 */

/** Most fuel an oven holds: it is bigger than a campfire and burns longer. */
export const OVEN_CAPACITY = 7200;

type FurnitureTarget = Extract<Target, { kind: 'furniture' }>;
const pieceOf = (g: Game, t: Target): PlacedFurniture | undefined => (t.kind === 'furniture' ? g.furniture.get((t as FurnitureTarget).id) : undefined);
const nearPiece = (g: Game, f: PlacedFurniture, range = 2.4): boolean => {
  const [cx, cy] = furnitureCentre(f);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= range;
};
const isOven = (f: PlacedFurniture): boolean => !!furnitureDef(f.kind).hearth;
const isBed = (f: PlacedFurniture): boolean => (furnitureDef(f.kind).bed ?? 0) > 0;

/** The trash crate you are standing beside, if there is one. */
export function trashNear(g: Game): PlacedFurniture | undefined {
  for (const f of g.furniture.values()) if (furnitureDef(f.kind).trash && nearPiece(g, f)) return f;
  return undefined;
}

/** How long an oven's fuel will last, in words. */
export const ovenBurnsFor = (f: PlacedFurniture): string => {
  const m = Math.round((f.fuel ?? 0) / 60);
  return m >= 60 ? `${(m / 60).toFixed(1)} hours` : m >= 1 ? `${m} minutes` : `${Math.round(f.fuel ?? 0)} seconds`;
};

/** Every vessel within reach that has a liquid in it, the fullest first. */
export function vesselsNear(g: Game, kind?: LiquidKind): PlacedFurniture[] {
  const out: PlacedFurniture[] = [];
  for (const f of g.furniture.values()) {
    if (!holdsLiquid(f) || litresIn(f) < 1) continue;
    if (kind && f.liquid !== kind) continue;
    if (nearPiece(g, f, 2.6)) out.push(f);
  }
  return out.sort((a, b) => litresIn(b) - litresIn(a));
}

/** A barrel within reach that would take this liquid, the emptiest first. */
export function barrelFor(g: Game, kind: LiquidKind): PlacedFurniture | undefined {
  let best: PlacedFurniture | undefined;
  for (const f of g.furniture.values()) {
    if (!holdsLiquid(f) || isWell(f)) continue;
    if (litresIn(f) > 0 && f.liquid !== kind) continue;
    if (litresIn(f) >= liquidCapacity(f)) continue;
    if (!nearPiece(g, f, 2.6)) continue;
    if (!best || litresIn(f) < litresIn(best)) best = f;
  }
  return best;
}

/** Whether there is water at hand at all: a shore, a well or a barrel of it. */
export const waterNear = (g: Game): boolean => g.nearWater() || vesselsNear(g, 'water').length > 0;

/**
 * The bucket a pour should use: the one that was clicked, or — once that one
 * has been tipped out and is gone — the next full one that a barrel beside you
 * would take, so a run of buckets goes in without pointing at each in turn.
 */
export function nextVessel(g: Game, uid: number): Item | undefined {
  const clicked = g.inventory.get(uid);
  if (clicked && VESSELS[clicked.id]) return clicked;
  return g.inventory.items.find((it) => VESSELS[it.id] && barrelFor(g, VESSELS[it.id].liquid) !== undefined);
}

/** Draw `litres` out of a vessel, saying so when it runs dry. */
function drawFrom(g: Game, f: PlacedFurniture, litres: number): boolean {
  if (litresIn(f) < litres) return false;
  f.litres = litresIn(f) - litres;
  if (f.litres <= 0 && !isWell(f)) f.liquid = undefined;
  g.events.emit('crate');
  g.events.emit('world', f.x, f.y);
  return true;
}

export const PLACEABLE_ACTIONS: ActionDef[] = [
  // ---- The oven: a fire with a roof on it. ----
  {
    id: 'fuel_oven',
    label: 'Fuel',
    verb: 'feeding the oven',
    hidden: true,
    quantity: true,
    stamina: 0.01,
    baseTime: 1.5,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && isOven(f);
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || !isOven(f)) return 'That is not an oven.';
      if (!nearPiece(g, f)) return 'Stand next to the oven.';
      const item = t.kind === 'furniture' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isFuel(it.id));
      if (!item || !isFuel(item.id)) return 'Ovens take the same wood and coal a fire does.';
      if ((f.fuel ?? 0) >= OVEN_CAPACITY) return 'The firebox is packed as full as it will take.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || t.kind !== 'furniture') return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isFuel(it.id));
      if (!item || !isFuel(item.id)) return;
      const per = FUEL_VALUES[item.id];
      const room = Math.max(0, OVEN_CAPACITY - (f.fuel ?? 0));
      const fits = Math.max(1, Math.min(Math.min(t.count ?? 1, item.count), Math.ceil(room / per)));
      if (!g.inventory.remove(item.uid, fits)) return;
      f.fuel = Math.min(OVEN_CAPACITY, (f.fuel ?? 0) + per * fits);
      g.events.emit('world', f.x, f.y);
      g.logMsg(`You feed ${fits > 1 ? `${fits} × ` : 'a '}${itemDef(item.id).name.toLowerCase()} into the oven. ${ovenBurnsFor(f)} of fuel.`, 'event');
    },
  },
  {
    id: 'light_oven',
    label: 'Light',
    verb: 'lighting the oven',
    stamina: 0.04,
    baseTime: 6,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && isOven(f) && !f.lit;
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (f.lit) return 'It is already burning.';
      if ((f.fuel ?? 0) <= 0) return 'There is nothing in the firebox. Feed it some wood.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || f.lit || (f.fuel ?? 0) <= 0) return;
      f.lit = true;
      g.events.emit('world', f.x, f.y);
      g.logMsg(`The oven draws and the fire takes hold. ${ovenBurnsFor(f)} of fuel.`, 'event');
    },
  },
  {
    id: 'put_out_oven',
    label: 'Rake it out',
    verb: 'raking out the oven',
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && isOven(f) && !!f.lit;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || !f.lit) return;
      f.lit = false;
      g.events.emit('world', f.x, f.y);
      g.logMsg('You rake the fire out of the oven. It will keep its heat for nobody.', 'event');
    },
  },
  {
    id: 'take_ashes_oven',
    label: 'Rake out the ashes',
    verb: 'raking out ashes',
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && isOven(f) && hasAshes(f);
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (!nearPiece(g, f)) return 'Stand next to the oven.';
      return hasAshes(f) ? null : 'There are no ashes worth taking yet.';
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (f) rakeAshes(g, f, 'oven');
    },
  },
  // ---- The cart: storage that walks with you. ----
  {
    id: 'pull_cart',
    label: 'Take hold of it',
    verb: 'taking hold of the cart',
    stamina: 0.02,
    baseTime: 1.5,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && !!furnitureDef(f.kind).cart && !f.hitched;
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (!nearPiece(g, f)) return 'Stand beside the shafts.';
      for (const other of g.furniture.values()) if (other.hitched && other.id !== f.id) return 'You already have a cart behind you.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return;
      f.hitched = true;
      g.logMsg(`You take up the shafts of the ${furnitureName(f).toLowerCase()}. It will follow you now.`, 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
  {
    id: 'drop_cart',
    label: 'Let go of it',
    verb: 'setting the cart down',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => !!pieceOf(g, t)?.hitched,
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return;
      f.hitched = false;
      g.logMsg(`You set the ${furnitureName(f).toLowerCase()} down and let go of the shafts.`, 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
  // ---- Wells and barrels. ----
  {
    id: 'drink_from_vessel',
    label: 'Drink from it',
    verb: 'drinking',
    stamina: 0,
    baseTime: 2,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && holdsLiquid(f) && f.liquid === 'water' && litresIn(f) >= 1;
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (!nearPiece(g, f)) return 'Stand next to it.';
      if (f.liquid !== 'water') return 'You would not want to drink that.';
      if (litresIn(f) < 1) return 'It is dry.';
      if (g.player.stats.thirst >= 0.999) return 'You are not thirsty.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || !drawFrom(g, f, 1)) return;
      g.player.stats.thirst = Math.min(1, g.player.stats.thirst + 0.5);
      g.logMsg(`You drink your fill from the ${furnitureName(f).toLowerCase()}.`, 'event');
    },
  },
  {
    id: 'empty_vessel',
    label: 'Empty it out',
    verb: 'emptying it',
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && holdsLiquid(f) && !isWell(f) && litresIn(f) > 0;
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (!nearPiece(g, f)) return 'Stand next to it.';
      return litresIn(f) > 0 ? null : 'It is already empty.';
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return;
      const what = f.liquid ? LIQUID_NAME[f.liquid] : 'it';
      f.litres = 0;
      f.liquid = undefined;
      g.events.emit('crate');
      g.events.emit('world', f.x, f.y);
      g.logMsg(`You tip the ${what} out of the ${furnitureName(f).toLowerCase()}.`, 'event');
    },
  },
  {
    id: 'pour_into_barrel',
    label: 'Pour into the barrel',
    verb: 'pouring it in',
    stamina: 0.01,
    baseTime: 2,
    repeat: true,
    quantity: true,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      const vessel = item && VESSELS[item.id];
      return !!vessel && barrelFor(g, vessel.liquid) !== undefined;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = nextVessel(g, t.uid);
      const vessel = item && VESSELS[item.id];
      if (!vessel) return 'That is not a bucket of anything.';
      const barrel = barrelFor(g, vessel.liquid);
      if (!barrel) return `There is no barrel beside you with room for ${LIQUID_NAME[vessel.liquid]}.`;
      return null;
    },
    maxRepeat: (t, g) => {
      const kind = t.kind === 'item' ? g.inventory.get(t.uid)?.id : undefined;
      return kind ? g.inventory.items.filter((it) => it.id === kind).length : 1;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = nextVessel(g, t.uid);
      const vessel = item && VESSELS[item.id];
      if (!item || !vessel) return;
      const barrel = barrelFor(g, vessel.liquid);
      if (!barrel) return;
      const room = liquidCapacity(barrel) - litresIn(barrel);
      const poured = Math.min(BUCKET_LITRES, room);
      if (poured <= 0 || !g.inventory.remove(item.uid, 1)) return;
      barrel.litres = litresIn(barrel) + poured;
      barrel.liquid = vessel.liquid;
      g.inventory.add(vessel.empty, { ql: item.ql });
      g.events.emit('crate');
      g.events.emit('world', barrel.x, barrel.y);
      g.logMsg(
        `You pour ${poured.toFixed(0)} litres of ${LIQUID_NAME[vessel.liquid]} into the ${furnitureName(barrel).toLowerCase()}. ${litresIn(barrel).toFixed(0)} of ${liquidCapacity(barrel)}.`,
        'event',
      );
      // Keep pouring while there are full buckets left and room to take them.
      if (t.count !== undefined && t.count <= 1) return false;
      if (t.count !== undefined) t.count -= 1;
      return nextVessel(g, t.uid) !== undefined;
    },
  },
  // ---- The trash crate: asked for, never assumed. ----
  {
    id: 'throw_away',
    label: 'Throw it in the trash',
    verb: 'throwing it out',
    instant: true,
    quantity: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => t.kind === 'item' && trashNear(g) !== undefined,
    check: (t, g) => {
      const bin = trashNear(g);
      if (!bin) return 'There is no trash crate beside you.';
      if (t.kind === 'item' && (t.count ?? 1) + bin.items.reduce((n, it) => n + it.count, 0) > (furnitureDef(bin.kind).capacity ?? 0)) {
        return 'The trash crate is full. Wait for it to rot down.';
      }
      return null;
    },
    maxRepeat: (t, g) => (t.kind === 'item' ? (g.inventory.get(t.uid)?.count ?? 1) : 1),
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const bin = trashNear(g);
      if (!bin) return;
      const item = g.inventory.take(t.uid, t.count ?? 1);
      if (!item) return;
      if (!g.furnitureAdd(bin, item)) {
        g.inventory.addItem(item);
        g.logMsg('The trash crate is full.', 'error');
        return;
      }
      g.logMsg(`You throw ${item.count > 1 ? `${item.count} \u00d7 ` : 'the '}${itemDef(item.id).name.toLowerCase()} in the trash crate. It will not last long in there.`, 'event');
    },
  },
  // ---- The bed. ----
  {
    id: 'sleep',
    label: 'Sleep until morning',
    verb: 'sleeping',
    stamina: 0,
    baseTime: 4,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && isBed(f);
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || !isBed(f)) return 'That is not a bed.';
      if (!nearPiece(g, f)) return 'Stand next to it.';
      if (!g.isNight()) return `It is ${g.clock()} and broad daylight. Sleep when it is dark.`;
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return;
      const def = furnitureDef(f.kind);
      // A well-made bed is a better night than a cot with a thin mattress.
      const rest = (def.bed ?? 1) * (0.6 + f.ql / 250);
      g.sleepUntilMorning(rest, furnitureName(f).toLowerCase());
    },
  },
  {
    id: 'set_home',
    label: 'Make this your home',
    verb: 'making your bed',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && isBed(f);
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || !isBed(f)) return 'That is not a bed.';
      if (!nearPiece(g, f)) return 'Stand next to it.';
      if (g.spawn.x === f.x && g.spawn.y === f.y) return 'You already wake up here.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return;
      g.spawn = { x: f.x, y: f.y };
      g.logMsg(`You make up the ${furnitureName(f).toLowerCase()}. This is where you will wake, whatever happens to you.`, 'event');
    },
  },
];

export const PLACEABLE_ACTION_BY_ID = new Map(PLACEABLE_ACTIONS.map((a) => [a.id, a]));

/** The liquid a bucket filled here would come up with, and where from. */
export function sourceFor(g: Game): { from: PlacedFurniture | null; liquid: LiquidKind } | null {
  const vessel = vesselsNear(g)[0];
  if (vessel && litresIn(vessel) >= BUCKET_LITRES && vessel.liquid) return { from: vessel, liquid: vessel.liquid };
  if (g.nearWater()) return { from: null, liquid: 'water' };
  return null;
}

/** Take a bucket's worth out of whatever is at hand. Returns what it was. */
export function fillFromSource(g: Game, item: Item): LiquidKind | null {
  const source = sourceFor(g);
  if (!source) return null;
  if (source.from && !drawFrom(g, source.from, BUCKET_LITRES)) return null;
  if (!g.inventory.remove(item.uid, 1)) return null;
  g.inventory.add(BUCKET_OF[source.liquid], { ql: item.ql });
  return source.liquid;
}
