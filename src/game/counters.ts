import type { ActionDef, Target } from './actions';
import { borderOf, isDone, type Border, type Building, type Side, type Wall } from './building';
import { STORE_REACH } from './crates';
import { furnitureDef, isFurniture } from './furniture';
import type { Game } from './game';
import { foldInto, itemName, rarityStep, sameStack, type Item } from './items';
import { purse } from './money';
import { numberWord } from './words';

/**
 * A shop counter: a stall set into the wall of a house.
 *
 * It is a wall type (`counter` in `WALL_TYPES`): planned, built, painted and
 * repointed as any wall is, full height, with the wall carried over the
 * opening so a storey stands on it. What makes it a counter is the store
 * behind it, which works as a market stall's does -- its keeper sets goods
 * out on it and prices them, anybody else buys, and the coins go into its
 * till for its keeper -- with the difference that it is keyed to its wall
 * rather than to a piece set down, and that it is bought from on one side
 * only: the street side, which is the far side of the wall from the house.
 *
 * The store is kept by the tile of the building it is set in and the side of
 * that tile: on the island a `placed` row of kind `counter` (`sub` the side),
 * which holds the goods (`item.holder` 'counter') and the till exactly as a
 * stall's row does, and whose `made_by` is whoever planned the counter. The
 * stall's doors -- the price, the sale, the takings and the board -- answer
 * for both, off the same questions (`sells`, `sells_reach_refusal`).
 */

/** The wall type that is a counter. */
export const COUNTER_WALL = 'counter' as const;
/** How many things a counter holds: what a market stall holds. */
export const COUNTER_HOLDS = furnitureDef('stall').capacity ?? 0;
/**
 * How far from the middle of a counter you may stand and still buy from it
 * or tend it: what a stall is reached from, measured the way the stall's
 * door measures it (the larger of the two distances across the grid).
 */
export const COUNTER_REACH = STORE_REACH;

/** What is said to a counter planned anywhere but the ground floor. */
export const COUNTER_GROUND = 'A shop counter goes in a wall of the ground floor.';
/** And to one planned on a border with no street on its far side. */
export const COUNTER_STREET_ONLY = 'A shop counter goes in an outside wall, with open ground on its far side: that side is the street it sells to.';
/** Standing inside a house, or off to the side of the shop, and asking to buy. */
export const COUNTER_FROM_STREET = 'Buy from the street side of the counter: the side away from the house.';
/**
 * Too far off to buy from a stall or a counter, or to tend one: how far, off
 * the reach itself. The island says it of both, by which it is (`sells_word`).
 */
export const sellsTooFar = (what: string): string => `Stand within ${COUNTER_REACH} tiles of the ${what}.`;
export const COUNTER_TOO_FAR = sellsTooFar('counter');
/** Where a buyer stands, in a word: what the two refusals above ask between them. */
export const COUNTER_BUY_FROM = `Stand in the street within ${COUNTER_REACH} tiles of the counter.`;
/** A counter with no room left on it, and how much room there ever is. */
export const COUNTER_FULL = `A counter holds ${numberWord(COUNTER_HOLDS)} things, and this one is full.`;
/**
 * How near a counter you must be to be sent what is on it, one by one and at
 * what price (`counter_json` on the island): further off, only how many
 * things there are and a few of their kinds, for the drawing.
 */
export const COUNTER_SEEN = 6;
/** Said to somebody looking at a counter from further off than that. */
export const COUNTER_TOO_FAR_TO_SEE = `Too far off to see what is on it: come within ${numberWord(COUNTER_SEEN)} tiles.`;
/** Setting goods out on somebody else's counter. */
export const COUNTER_NOT_KEEPER = 'Only whoever planned a counter sets goods out on it.';
/** A piece of furniture, which is set down rather than laid out, but for a creature crate. */
export const COUNTER_NO_PIECES = 'A piece of furniture is set down, not laid out on a counter. A creature crate goes on one.';
/** Taking the counter down with anything on it or in its till. */
export const COUNTER_EMPTY_FIRST = 'Take the goods off the counter and the takings out of its till first.';

/** A counter's store, as this browser has it. */
export interface Counter {
  /** The island's row for it, or a number of this machine's own in the game you play by yourself. */
  id: number;
  /** The building tile it is set in, and which side of that tile it is on. */
  x: number;
  y: number;
  side: Side;
  /** What is on it, and each thing's price where it has one. */
  items: Item[];
  /** Whether it is yours; absent in the game you play by yourself, where everything is. */
  mine?: boolean;
  /** Whoever planned it, by name, on an island. */
  keeper?: string;
  /** Silver in its till, for a counter of yours on an island. */
  till?: number;
  /** How many things are on it, for one too far off for what is on it to be sent. */
  units?: number;
  /** A few of the kinds of thing on it, for drawing one too far off for what is on it to be sent. */
  wares?: string[];
}

/** A counter as it is saved: the same, without anything an island says. */
export interface CountersJSON {
  nextId: number;
  list: Counter[];
}

/** Whether a counter is yours to tend: every one is, in the game you play by yourself. */
export const keeps = (c: Counter): boolean => c.mine !== false;

/** The border a counter stands on. */
export const counterBorder = (c: { x: number; y: number; side: Side }): Border => borderOf(c.x, c.y, c.side);

/** Where a counter is reached from: the middle of its border. */
export function counterMiddle(c: { x: number; y: number; side: Side }): [number, number] {
  switch (c.side) {
    case 'n': return [c.x + 0.5, c.y];
    case 's': return [c.x + 0.5, c.y + 1];
    case 'w': return [c.x, c.y + 0.5];
    default: return [c.x + 1, c.y + 0.5];
  }
}

/** The tile on the street side of a counter: across its border from the house. */
export function streetOf(c: { x: number; y: number; side: Side }): { x: number; y: number } {
  const [dx, dy] = c.side === 'n' ? [0, -1] : c.side === 's' ? [0, 1] : c.side === 'w' ? [-1, 0] : [1, 0];
  return { x: c.x + dx, y: c.y + dy };
}

/** Whether a point is on the street side of a counter's border: past the line of the wall, away from the house. */
export function onStreetSide(c: { x: number; y: number; side: Side }, px: number, py: number): boolean {
  switch (c.side) {
    case 'n': return py < c.y;
    case 's': return py >= c.y + 1;
    case 'w': return px < c.x;
    default: return px >= c.x + 1;
  }
}

/**
 * Why somebody at (px, py) cannot reach a counter, or null: too far from the
 * middle of it, or -- when they are buying (`street`) -- not out in the
 * street: on the house's side of the wall's line, or inside any building at
 * all, the keeper's own other rooms and the house next door among them. Its
 * keeper tends it from either side. The island asks the same of a counter,
 * and of a stall the first half only (`sells_reach_refusal`).
 */
export function counterReach(g: Game, c: { x: number; y: number; side: Side }, px: number, py: number, street: boolean): string | null {
  const [cx, cy] = counterMiddle(c);
  if (Math.max(Math.abs(cx - px), Math.abs(cy - py)) > COUNTER_REACH) return COUNTER_TOO_FAR;
  if (street && (!onStreetSide(c, px, py) || g.buildings.buildingAt(Math.floor(px), Math.floor(py)))) return COUNTER_FROM_STREET;
  return null;
}

/**
 * Which building tile, and which side of it, a wall on a border is set in:
 * the one of the two tiles either side of it that is the wall's own building.
 */
export function counterSeat(g: Game, w: Wall): { x: number; y: number; side: Side } {
  if (w.dir === 'h') {
    return g.buildings.buildingAt(w.x, w.y)?.id === w.building ? { x: w.x, y: w.y, side: 'n' } : { x: w.x, y: w.y - 1, side: 's' };
  }
  return g.buildings.buildingAt(w.x, w.y)?.id === w.building ? { x: w.x, y: w.y, side: 'w' } : { x: w.x - 1, y: w.y, side: 'e' };
}

/** The wall a counter's store stands behind, while it is a finished counter. */
export function counterWall(g: Game, c: { x: number; y: number; side: Side }): Wall | undefined {
  const w = g.buildings.wall(0, c.x, c.y, c.side);
  return w && w.type === COUNTER_WALL && isDone(w) ? w : undefined;
}

/**
 * Why a counter will not go on this side of this tile, or null.
 *
 * On the ground floor, and on the outline of the building with no building on
 * the other side: the other side is the street it sells to. The island asks
 * the same (`counter_plan_refusal`).
 */
export function counterPlanRefusal(g: Game, b: Building, level: number, x: number, y: number, side: Side): string | null {
  if (level > 0) return COUNTER_GROUND;
  const st = streetOf({ x, y, side });
  if (g.buildings.buildingAt(st.x, st.y)) return COUNTER_STREET_ONLY;
  void b;
  return null;
}

/** What is said to a building planned, or a building's footprint pushed, over the street a counter sells onto. */
export const COUNTER_STREET_TAKEN = 'A shop counter sells onto this tile. Take the counter out first.';

/**
 * Why a tile will not go into a building, or null: a shop counter on one of
 * its borders, planned or built, sells onto it, and a counter's street is
 * open ground. The island asks the same (`counter_street_refusal`).
 */
export function counterStreetRefusal(g: Game, x: number, y: number): string | null {
  for (const side of ['n', 'e', 's', 'w'] as const) {
    if (g.buildings.wall(0, x, y, side)?.type === COUNTER_WALL) return COUNTER_STREET_TAKEN;
  }
  return null;
}

/**
 * Why a wall will not come down while it is a counter with anything on it or
 * in its till, or null. The island asks the same (`counter_remove_refusal`).
 */
export function counterRemoveRefusal(g: Game, w: Wall): string | null {
  if (w.type !== COUNTER_WALL) return null;
  const seat = counterSeat(g, w);
  const c = g.counters.at(seat.x, seat.y, seat.side);
  return c && (counterHeld(c) > 0 || (c.till ?? 0) > 0) ? COUNTER_EMPTY_FIRST : null;
}

/** A counter finished: its store opens, in the game you play by yourself. The island opens its own (`counter_finished`). */
export function counterFinished(g: Game, w: Wall): void {
  if (w.type !== COUNTER_WALL || !isDone(w)) return;
  const seat = counterSeat(g, w);
  g.counters.open(seat.x, seat.y, seat.side);
}

/** And gone with its wall. */
export function counterGone(g: Game, w: Wall): void {
  if (w.type !== COUNTER_WALL) return;
  const seat = counterSeat(g, w);
  g.counters.close(seat.x, seat.y, seat.side);
}

/** How many things are on a counter. */
export const counterUnits = (c: Counter): number => c.items.reduce((n, it) => n + it.count, 0);
/** How many more it takes. */
export const counterSpare = (c: Counter): number => Math.max(0, COUNTER_HOLDS - counterUnits(c));

/** What is said as goods go out on a counter, on both sides. */
export const setOutLine = (count: number, what: string, left: number): string =>
  `You set ${count > 1 ? `${count} × ` : 'the '}${what.toLowerCase()} out on the counter.`
  + (left > 0 ? ` The other ${left} would not fit.` : '');
/** And as they come back off it. */
export const takeBackLine = (count: number, what: string): string =>
  `You take ${count > 1 ? `${count} × ` : 'the '}${what.toLowerCase()} back off the counter.`;
/** What a buyer is told as a sale goes through. */
export const boughtLine = (count: number, what: string, price: number): string =>
  `You buy ${count > 1 ? `${count} × ` : 'the '}${what.toLowerCase()} for ${price} silver.`;
/** What somebody else is told who reaches for a thing on a counter: the stall's own words. */
export const COUNTER_BOUGHT_NOT_TAKEN = "That is on somebody else's counter. Buy it at the counter.";

/**
 * Why somebody cannot buy this off that counter now, or null. The island asks
 * the same in `rpc_buy`, in the same order and the same words, and has the
 * last say: it is the one holding the coins.
 */
export function buyRefusal(g: Game, c: Counter, good: Item): string | null {
  if (!c.items.some((it) => it.uid === good.uid) || good.price === undefined) return 'That is not for sale.';
  if (keeps(c)) return 'It is your own counter. Take it back off the counter instead.';
  const far = counterReach(g, c, g.player.x, g.player.y, true);
  if (far) return far;
  if (purse(g.inventory.items) < good.price) return `You cannot afford it. It is ${good.price} silver.`;
  return null;
}

/** Why a thing will not go on a counter, or null: furniture is set down, but for a creature crate. */
export function counterRefuses(item: Item): string | null {
  return isFurniture(item.id) && item.id !== 'creature_crate' ? COUNTER_NO_PIECES : null;
}

/**
 * Every counter's store, by id, and the counter each stands behind.
 *
 * In the game you play by yourself this is the record: a counter's store is
 * opened as its wall is finished and closed as the wall comes down, and it is
 * saved with the rest. On an island it is the island's word, laid in with
 * every ground read (`saw`).
 */
export class Counters {
  readonly list = new Map<number, Counter>();
  nextId = 1;

  /** The counter set in this side of this building tile. */
  at(x: number, y: number, side: Side): Counter | undefined {
    for (const c of this.list.values()) if (c.x === x && c.y === y && c.side === side) return c;
    return undefined;
  }

  /** The counter on a border, whichever tile it is looked at from. */
  onBorder(b: Border): Counter | undefined {
    for (const c of this.list.values()) {
      const cb = counterBorder(c);
      if (cb.dir === b.dir && cb.x === b.x && cb.y === b.y) return c;
    }
    return undefined;
  }

  /** The counter a thing is lying on. */
  holding(uid: number): Counter | undefined {
    for (const c of this.list.values()) if (c.items.some((it) => it.uid === uid)) return c;
    return undefined;
  }

  /** The store behind a counter just finished, in the game you play by yourself. */
  open(x: number, y: number, side: Side): Counter {
    const had = this.at(x, y, side);
    if (had) return had;
    const c: Counter = { id: this.nextId++, x, y, side, items: [] };
    this.list.set(c.id, c);
    return c;
  }

  /** And gone with its wall. */
  close(x: number, y: number, side: Side): void {
    const c = this.at(x, y, side);
    if (c) this.list.delete(c.id);
  }

  /** Put goods out on a counter, onto a pile of the same where there is one; false when there is no room. */
  add(c: Counter, item: Item): boolean {
    if (item.count > counterSpare(c)) return false;
    // A thing goes onto a pile of its own kind where there is one, and the
    // pile keeps its price: the island's `move_part` folds it the same way.
    const pile = c.items.find((it) => sameStack(it, item));
    if (pile) foldInto(pile, item);
    else {
      delete item.price;
      c.items.push(item);
    }
    return true;
  }

  /** Take one thing back off, or part of it. */
  take(c: Counter, uid: number, count?: number): Item | null {
    const i = c.items.findIndex((it) => it.uid === uid);
    if (i < 0) return null;
    const it = c.items[i];
    if (count === undefined || count >= it.count) {
      c.items.splice(i, 1);
      delete it.price;
      return it;
    }
    it.count -= count;
    const part: Item = { ...it, count };
    delete part.price;
    return part;
  }

  toJSON(): CountersJSON {
    return { nextId: this.nextId, list: [...this.list.values()] };
  }

  /** Laid in from a save, in place of whatever was here. */
  load(data: CountersJSON | undefined): void {
    this.list.clear();
    this.nextId = data?.nextId ?? 1;
    for (const c of data?.list ?? []) {
      this.list.set(c.id, { ...c, items: c.items ?? [] });
      if (c.id >= this.nextId) this.nextId = c.id + 1;
    }
  }

  /** Forget every counter, before a ground read lays in the island's. */
  clear(): void {
    this.list.clear();
  }

  /**
   * One counter as the island sends it with the ground: its row, what is on
   * it and at what price from within reach, and a few of the kinds of thing
   * on it from further off, for the drawing.
   */
  saw(r: CounterWire): void {
    const side = (['n', 'e', 's', 'w'] as const).find((s) => s === r.sub) ?? 'n';
    this.list.set(r.id, {
      id: r.id, x: r.x, y: r.y, side,
      mine: r.mine,
      keeper: r.keeper ?? undefined,
      till: typeof r.till === 'number' ? r.till : undefined,
      units: r.units ?? undefined,
      wares: r.wares ?? undefined,
      items: (r.goods ?? []).map((it) => ({
        uid: it.id, id: it.def, ql: it.ql, dmg: it.dmg, count: it.count,
        extra: it.extra ?? undefined,
        ...(it.rare ? { rare: rarityStep(it.rare) } : {}),
        ...(typeof it.price === 'number' ? { price: it.price } : {}),
        ...(typeof it.creature === 'number' ? { creature: it.creature } : {}),
      })),
    });
  }
}

/** A counter's row as a ground read sends it: `placed` of kind 'counter', and what `counter_json` adds. */
export interface CounterWire {
  id: number;
  x: number;
  y: number;
  sub?: string | null;
  mine?: boolean;
  keeper?: string | null;
  till?: number | null;
  units?: number | null;
  wares?: string[] | null;
  goods?: Array<{ id: number; def: string; ql: number; dmg: number; count: number; extra: string | null; rare?: string | null; price?: number | null; creature?: number | null }> | null;
}

/** What a counter holds, said as a count, off what this browser has been told. */
export const counterHeld = (c: Counter): number => (c.items.length ? counterUnits(c) : c.units ?? 0);

/* ---- the two doors: setting goods out, and taking them back ---------------- */
/*
 * Why a counter has two doors of its own rather than going through a stall's
 * (`store_in_furniture` and `take_from_store`), when its price, its sale, its
 * till and the board do go through the stall's (`sells`):
 *
 *   * Those two find their store among the pieces of furniture -- `storeInto`
 *     and `storeWith` walk `g.furniture`, and on the island `named_store`,
 *     `nearest_store` and `take_from_store` read `placed` rows of kind
 *     'furniture' and items held as 'furniture' -- and then ask that piece's
 *     own definition what it takes (`furniture_refuses`: liquid, a hive, a
 *     pond, a bin's kind of thing), how much (`furniture_room`, by capacity or
 *     by weight), and its padlock. A counter is a wall: it has no
 *     `furniture_def` row, no padlock, no subtile and no weight limit, so
 *     every one of those questions would grow a counter branch in the
 *     furniture's shared functions, on both sides.
 *   * Its goods are held as 'counter' rather than 'furniture' so that what
 *     works over every piece's holdings -- its count, Take everything, a
 *     worker putting its load away, the ground read's contents of a piece --
 *     never meets them; going through the furniture's doors would mean
 *     holding them as 'furniture' and teaching each of those to step round a
 *     counter instead.
 *   * And it answers differently where the two differ: only its keeper sets
 *     goods out on a counter, where a stall takes them from anybody standing
 *     at it; it is reached from the middle of its border, by the stall's own
 *     measure (`counterReach`, `sells_reach_refusal`); and part of a pile
 *     comes back off it, where `take_from_store` takes the whole row.
 *
 * So these two are the counter's, small, and ask nothing a stall's do not
 * ask in their own way; what both sell through is shared.
 */

type ItemTarget = Extract<Target, { kind: 'item' }>;

/**
 * The counter a thing is going out on: the one the ask names, or the nearest
 * of yours within reach, which is what a thing's own menu means by it.
 */
export function counterInto(g: Game, t: ItemTarget): Counter | undefined {
  if (t.into !== undefined) return g.counters.list.get(t.into);
  let best: Counter | undefined;
  let far = Infinity;
  for (const c of g.counters.list.values()) {
    if (!keeps(c) || !counterWall(g, c)) continue;
    const [cx, cy] = counterMiddle(c);
    const d = Math.max(Math.abs(cx - g.player.x), Math.abs(cy - g.player.y));
    if (d <= COUNTER_REACH && d < far) {
      far = d;
      best = c;
    }
  }
  return best;
}

/** Why this cannot go out on that counter, or null. The island's `counter_refusal` says the same. */
export function setOutRefusal(g: Game, t: ItemTarget): string | null {
  const item = g.inventory.get(t.uid);
  if (!item) return 'It is gone.';
  const c = counterInto(g, t);
  if (!c || !counterWall(g, c)) return 'Stand at a counter of yours.';
  if (!keeps(c)) return COUNTER_NOT_KEEPER;
  const far = counterReach(g, c, g.player.x, g.player.y, false);
  if (far) return far;
  const no = counterRefuses(item);
  if (no) return no;
  if (counterSpare(c) <= 0) return COUNTER_FULL;
  return null;
}

/** Why this cannot come back off its counter, or null. The island's `counter_refusal` says the same. */
export function takeBackRefusal(g: Game, t: ItemTarget): string | null {
  const c = g.counters.holding(t.uid);
  if (!c || !counterWall(g, c)) return 'It is gone.';
  if (!keeps(c)) return COUNTER_BOUGHT_NOT_TAKEN;
  return counterReach(g, c, g.player.x, g.player.y, false);
}

export const COUNTER_ACTIONS: ActionDef[] = [
  {
    id: 'set_out_goods',
    label: 'Set out on the counter',
    verb: 'setting goods out',
    instant: true,
    quantity: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && !counterRefuses(item) && counterInto(g, t) !== undefined;
    },
    check: (t, g) => (t.kind === 'item' ? setOutRefusal(g, t) : null),
    perform: (t, g) => {
      if (t.kind !== 'item' || setOutRefusal(g, t)) return;
      const c = counterInto(g, t);
      const held = g.inventory.get(t.uid);
      if (!c || !held) return;
      const want = Math.min(t.count ?? 1, held.count);
      const fits = Math.min(want, counterSpare(c));
      const item = g.inventory.take(t.uid, fits);
      if (!item) return;
      if (!g.counters.add(c, item)) {
        g.inventory.addItem(item);
        g.logMsg(COUNTER_FULL, 'error');
        return;
      }
      g.events.emit('crate');
      g.events.emit('world', c.x, c.y);
      g.logMsg(setOutLine(item.count, itemName(item), want - item.count), 'event');
    },
  },
  {
    id: 'take_off_counter',
    label: 'Take back off the counter',
    verb: 'taking it back',
    hidden: true,
    instant: true,
    quantity: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => t.kind === 'item' && !g.inventory.get(t.uid) && !!g.counters.holding(t.uid),
    check: (t, g) => (t.kind === 'item' ? takeBackRefusal(g, t) : null),
    perform: (t, g) => {
      if (t.kind !== 'item' || takeBackRefusal(g, t)) return;
      const c = g.counters.holding(t.uid);
      if (!c) return;
      const got = g.counters.take(c, t.uid, t.count);
      if (!got) return;
      g.inventory.addItem(got);
      g.events.emit('crate');
      g.events.emit('world', c.x, c.y);
      g.logMsg(takeBackLine(got.count, itemName(got)), 'event');
    },
  },
];
