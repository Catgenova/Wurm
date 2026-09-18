import { drinkable, isBrew, isWorking } from './brewing';
import type { ActionDef, Target } from './actions';
import { FUEL_SAID, FUEL_VALUES, hasAshes, isFuel, rakeAshes } from './campfire';
import {
  BUCKET_LITRES,
  BUCKET_OF,
  furnitureCentre,
  furnitureDef,
  furnitureName,
  holdsLiquid,
  isBoat,
  isDriveable,
  isWell,
  liquidCapacity,
  litresIn,
  LIQUID_NAME,
  teamOf,
  vehicleOf,
  VESSELS,
  type LiquidKind,
  type PlacedFurniture,
} from './furniture';
import type { Game } from './game';
import { itemDef, type Item } from './items';
import { world } from './pace';

/**
 * The placed things that do something of their own: an oven that burns, a well
 * that fills, barrels that hold a liquid and nothing else, a cart that follows
 * you about, and a bed worth waking in.
 */

/** Most fuel an oven holds: it is bigger than a campfire and burns longer. */
export const OVEN_CAPACITY = world(7200);

/**
 * How fast a brazier eats what is in it, by how well it was built.
 *
 * A shallow bowl with a bad draw roars through its fuel; one laid true and
 * banded tight burns low and long. Seconds of fuel spent per second alight:
 * about one and a half at quality 1, one at 40, and three fifths at 100 — so
 * a well-made brazier gets nearly three times the night out of the same
 * armful of wood as a rough one.
 *
 * Braziers only. Every other fire on this island burns a second a second, and
 * quietly re-pricing the smelters and the kilns is not what anybody asked for.
 */
export const BRAZIER_BURN_AT_ONE = 1.55;
export const BRAZIER_BURN_AT_HUNDRED = 0.6;
export const brazierBurn = (ql: number): number =>
  BRAZIER_BURN_AT_ONE
  + (BRAZIER_BURN_AT_HUNDRED - BRAZIER_BURN_AT_ONE) * (Math.max(1, Math.min(100, ql)) - 1) / 99;

/** What a brazier holds: a night's worth and a little over. */
export const BRAZIER_CAPACITY = world(3600);

/**
 * What a hearth holds and what it is called.
 *
 * `isOven` has been `furnitureDef(kind).hearth` since the day it was written —
 * the four actions below were never about ovens, only ever about anything that
 * burns. What *was* about ovens was every sentence they said, so a brazier
 * would have told you its firebox was packed and that it had been raked out.
 * The name comes off the piece now, and the capacity with it.
 */
const hearthName = (f: PlacedFurniture): string => furnitureDef(f.kind).name.toLowerCase();
const hearthCapacity = (f: PlacedFurniture): number =>
  (f.kind === 'brazier' ? BRAZIER_CAPACITY : OVEN_CAPACITY);

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
  return g.furnitureWithin(3).find((f) => furnitureDef(f.kind).trash && nearPiece(g, f));
}

/** How long an oven's fuel will last, in words. */
/**
 * Seconds of fuel a hearth spends per second alight.
 *
 * One, for everything that was here before this: an oven, a smelter and a
 * kiln all burn a second a second, and quietly re-pricing them is not what
 * anybody asked for.
 */
export const hearthBurn = (f: PlacedFurniture): number =>
  (f.kind === 'brazier' ? brazierBurn(f.ql ?? 20) : 1);

export const ovenBurnsFor = (f: PlacedFurniture): string => {
  // What is in it divided by how fast it goes, which is how long it will
  // burn — and for everything but a brazier those are the same number.
  const left = (f.fuel ?? 0) / hearthBurn(f);
  const m = Math.round(left / 60);
  return m >= 60 ? `${(m / 60).toFixed(1)} hours` : m >= 1 ? `${m} minutes` : `${Math.round(left)} seconds`;
};

/** Every vessel within reach that has a liquid in it, the fullest first. */
export function vesselsNear(g: Game, kind?: LiquidKind): PlacedFurniture[] {
  const out: PlacedFurniture[] = [];
  for (const f of g.furnitureWithin(4)) {
    if (!holdsLiquid(f) || litresIn(f) < 1) continue;
    if (kind && f.liquid !== kind) continue;
    if (nearPiece(g, f, 2.6)) out.push(f);
  }
  return out.sort((a, b) => litresIn(b) - litresIn(a));
}

/** A barrel within reach that would take this liquid, the emptiest first. */
export function barrelFor(g: Game, kind: LiquidKind): PlacedFurniture | undefined {
  let best: PlacedFurniture | undefined;
  for (const f of g.furnitureWithin(4)) {
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
  const clicked = g.inventory.held(uid);
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
  // ---- A hearth: an oven is a fire with a roof on it, a brazier one without. ----
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
      if (!f || !isOven(f)) return 'That is not something you can light a fire in.';
      if (!nearPiece(g, f)) return `Stand next to the ${hearthName(f)}.`;
      const item = t.kind === 'furniture' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isFuel(it.id));
      if (!item || !isFuel(item.id)) return `An oven takes what a fire takes: ${FUEL_SAID}.`;
      if ((f.fuel ?? 0) >= hearthCapacity(f)) return 'It is packed as full as it will take.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || t.kind !== 'furniture') return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isFuel(it.id));
      if (!item || !isFuel(item.id)) return;
      const per = FUEL_VALUES[item.id];
      const room = Math.max(0, hearthCapacity(f) - (f.fuel ?? 0));
      const fits = Math.max(1, Math.min(Math.min(t.count ?? 1, item.count), Math.ceil(room / per)));
      if (!g.inventory.remove(item.uid, fits)) return;
      f.fuel = Math.min(hearthCapacity(f), (f.fuel ?? 0) + per * fits);
      g.events.emit('world', f.x, f.y);
      g.logMsg(`You feed ${fits > 1 ? `${fits} × ` : 'a '}${itemDef(item.id).name.toLowerCase()} into the ${hearthName(f)}. ${ovenBurnsFor(f)} of fuel.`, 'event');
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
      g.logMsg(`The ${hearthName(f)} draws and the fire takes hold. ${ovenBurnsFor(f)} of fuel.`, 'event');
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
      g.logMsg(`You rake the fire out of the ${hearthName(f)}. It will keep its heat for nobody.`, 'event');
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
      if (!nearPiece(g, f)) return `Stand next to the ${hearthName(f)}.`;
      return hasAshes(f) ? null : 'There are no ashes worth taking yet.';
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (f) rakeAshes(g, f, hearthName(f));
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
  // ---- Vehicles: a team in front and a seat on top. ----
  {
    id: 'board_vehicle',
    label: 'Take the reins',
    verb: 'climbing aboard',
    stamina: 0.01,
    baseTime: 1.5,
    labelFor: (t, g) => (isBoat(pieceOf(g, t) ?? { kind: '' }) ? 'Climb aboard' : 'Take the reins'),
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && isDriveable(f) && !f.driven;
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (!nearPiece(g, f)) return 'Stand beside it first.';
      if (g.driving()) return 'You are already driving something.';
      // A hull asks nothing but that she is still floating.
      if (isBoat(f)) return g.launchSpot(f.kind, f.x, f.y) ? null : 'She is aground. Push her off first.';
      const v = vehicleOf(f);
      const team = teamOf(f).length;
      if (v && team < v.needs) {
        return team === 0
          ? `Nothing is in the yokes. ${furnitureName(f)} needs ${v.needs} to move.`
          : `Only ${team} of ${v.yokes} yokes are filled. It needs ${v.needs}.`;
      }
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return;
      f.driven = true;
      f.driverId = g.actor.id;
      if (isBoat(f)) {
        const boat = furnitureDef(f.kind).boat;
        g.logMsg(
          `You push off and climb into the ${furnitureName(f).toLowerCase()}. ${boat?.sail ? 'The sail fills and she comes round.' : 'You ship the oars and take a stroke.'}`,
          'event',
        );
        g.events.emit('world', f.x, f.y);
        return;
      }
      const team = g.team(f).map((c) => c.name);
      g.logMsg(`You climb onto the ${furnitureName(f).toLowerCase()} and take the reins. ${team.join(' and ')} lean into the traces.`, 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
  {
    id: 'leave_vehicle',
    label: 'Get down',
    verb: 'getting down',
    instant: true,
    stamina: 0,
    baseTime: 0,
    labelFor: (t, g) => (isBoat(pieceOf(g, t) ?? { kind: '' }) ? 'Step ashore' : 'Get down'),
    applies: (t, g) => !!pieceOf(g, t)?.driven,
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (isBoat(f) && !shoreNear(g)) return 'There is no shore within reach. Bring her in first, or swim for it.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return;
      if (isBoat(f)) {
        const shore = shoreNear(g);
        g.leaveVehicle(f);
        if (shore) {
          g.player.x = shore.x + 0.5;
          g.player.y = shore.y + 0.5;
          g.player.stop();
        }
        g.logMsg(`You bring the ${furnitureName(f).toLowerCase()} alongside and step ashore.`, 'event');
        return;
      }
      g.leaveVehicle(f);
      g.logMsg(`You climb down off the ${furnitureName(f).toLowerCase()}.`, 'event');
    },
  },
  {
    id: 'unhitch_team',
    label: 'Unhitch the team',
    verb: 'unhitching the team',
    stamina: 0.01,
    baseTime: 2,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && teamOf(f).length > 0;
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      return nearPiece(g, f) ? null : 'Stand beside it first.';
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return;
      const n = g.unhitchAll(f);
      g.logMsg(`You let ${n === 1 ? 'it' : 'them'} out of the traces of the ${furnitureName(f).toLowerCase()}.`, 'event');
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
      return !!f && holdsLiquid(f) && drinkable(f.liquid) && litresIn(f) >= 1;
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (!nearPiece(g, f)) return 'Stand next to it.';
      if (!drinkable(f.liquid)) return 'You would not want to drink that.';
      if (isWorking(f)) return 'It is still working. Let it alone.';
      if (litresIn(f) < 1) return 'It is dry.';
      if (g.player.stats.thirst >= 0.999 && !isBrew(f.liquid)) return 'You are not thirsty.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || !drawFrom(g, f, 1)) return;
      g.player.stats.thirst = Math.min(1, g.player.stats.thirst + 0.5);
      // A brew straight out of the barrel favours a trade like any other.
      const brew = isBrew(f.liquid) ? BUCKET_OF[f.liquid as LiquidKind] : null;
      const favour = brew ? g.grantBoon(brew, f.ql) : null;
      const full = brew ? g.nourish(brew, f.ql) : null;
      g.logMsg(`You drink your fill from the ${furnitureName(f).toLowerCase()}.${favour ? ` ${favour}` : ''}${full ? ` ${full}` : ''}`, 'event');
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
      const item = g.inventory.held(t.uid);
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
      if (poured <= 0 || !vesselBecomes(g, item, vessel.empty)) return;
      barrel.litres = litresIn(barrel) + poured;
      barrel.liquid = vessel.liquid;
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
      g.note('slept');
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
  // ---- The bell. ----
  {
    id: 'ring_bell',
    label: 'Ring the bell',
    verb: 'ringing the bell',
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && !!furnitureDef(f.kind).bell;
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || !furnitureDef(f.kind).bell) return 'That is not a bell.';
      if (!nearPiece(g, f)) return 'Stand next to it.';
      if (!g.onDeed(f.x, f.y)) return 'Ring it on a settlement of yours; a bell in the wild calls nobody.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || !g.deed) return;
      // Every wildermon working the deed drops what it is doing and comes to
      // whoever rang, the way one called over does.
      let came = 0;
      for (const c of g.creatures.list.values()) {
        if (c.mode !== 'deed') continue;
        c.calledAt = g.time;
        c.enemy = null;
        came++;
      }
      g.note('rang');
      g.logMsg(`You ring the ${furnitureName(f).toLowerCase()} and it sounds over ${g.deed.name}. ${came ? `${came} wildermon ${came === 1 ? 'comes' : 'come'} at the sound` : 'Nothing is working the deed to come'}, and every citizen hears where it hangs: ${f.x}, ${f.y}.`, 'event');
    },
  },
];

export const PLACEABLE_ACTION_BY_ID = new Map(PLACEABLE_ACTIONS.map((a) => [a.id, a]));

/** Dry land within stepping distance of the boat, if there is any. */
export function shoreNear(g: Game, range = 2): { x: number; y: number } | null {
  const px = g.player.tileX;
  const py = g.player.tileY;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (!g.world.inBounds(x, y) || !g.world.isPassable(x, y) || g.world.hasWater(x, y)) continue;
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** The liquid a bucket filled here would come up with, and where from. */
export function sourceFor(g: Game): { from: PlacedFurniture | null; liquid: LiquidKind } | null {
  // A barrel still working is not drawn off; whatever is in it is not ready.
  const vessel = vesselsNear(g).find((v) => !isWorking(v));
  if (vessel && litresIn(vessel) >= BUCKET_LITRES && vessel.liquid) return { from: vessel, liquid: vessel.liquid };
  if (g.nearWater()) return { from: null, liquid: 'water' };
  return null;
}

/** Take a bucket's worth out of whatever is at hand. Returns what it was. */
export function fillFromSource(g: Game, item: Item): LiquidKind | null {
  const source = sourceFor(g);
  if (!source) return null;
  if (source.from && !drawFrom(g, source.from, BUCKET_LITRES)) return null;
  if (!vesselBecomes(g, item, BUCKET_OF[source.liquid])) return null;
  return source.liquid;
}

/**
 * One vessel becoming another, in place: an empty bucket becoming a bucket of
 * water and back again.
 *
 * It was a remove and an add, which is two things where there is one. A bucket
 * is not stackable, so there was never more than one of it to split — and what
 * the pair of them threw away was where it was. Fill a bucket in your backpack
 * that way and the new one lands in your hands, so the bag empties itself a
 * bucket at a time. The island swaps the row in place for the same reason;
 * this is the same swap, and the same rule about charges: as many goes in it
 * as the new thing holds.
 */
export function vesselBecomes(g: Game, item: Item, id: string): boolean {
  if (item.count !== 1) return false;
  item.id = id;
  const charges = itemDef(id).charges;
  if (charges) item.charges = charges;
  else delete item.charges;
  g.inventory.onChange?.();
  g.events.emit('inventory');
  return true;
}
