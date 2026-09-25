import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { describeFrom, itemName, rarityOf, roomFor, storedLine, type Item } from './items';
import { matOf } from './materials';

/**
 * Crates are the first placeable objects. Each tile is a 4 by 4 grid of
 * subtiles; a crate occupies one subtile and snaps to that grid.
 */
export type CrateKind = 'log' | 'plank';

export interface PlacedCrate {
  id: number;
  /**
   * Whether the island counts it yours: set down by you, from before crates
   * had owners, or standing on a settlement of yours. Absent in the game you
   * play by yourself, where every crate is yours because there is only you.
   */
  mine?: boolean;
  /**
   * How full the island says it is, when `items` is not the whole story.
   *
   * A crate too far off to reach into comes over with its count and no
   * contents, because a label does not need them and they are not free.
   */
  units?: number;
  /** What you have called it, when you have called it anything. */
  name?: string;
  x: number;
  y: number;
  /** Subtile column and row, 0..3. */
  sx: number;
  sy: number;
  kind: CrateKind;
  /**
   * What it was built at.
   *
   * A crate had none at all, and picking one up handed back a QL 20 crate
   * whatever the one you set down had been: `pick_up_crate` wrote the number
   * 20 into the item because there was nothing on the row to read instead.
   * A crate you had worked up to eighty was a crate you could only lose.
   */
  ql: number;
  items: Item[];
  /** The settlement's crate: deed workers deliver here. */
  deed?: boolean;
  /** The wood it was built of. */
  material?: string;
  /** 1 rare, 2 supreme, 3 fantastic; absent for the ordinary run of things. */
  rare?: number;
  /**
   * The padlock fitted to it, by the number it shares with its key.
   *
   * See `locks.ts`. Absent on everything that has never been locked, which
   * is nearly everything: a crate on your own deed is safe because the ground
   * is, and a lock is for a crate standing anywhere else.
   */
  lock?: number;
}

export interface CrateDef {
  name: string;
  /** Inventory item that becomes this crate when placed. */
  item: string;
  /** Item units it holds. */
  capacity: number;
}

export const CRATE_DEFS: Record<CrateKind, CrateDef> = {
  log: { name: 'Log crate', item: 'crate_log', capacity: 30 },
  plank: { name: 'Plank crate', item: 'crate_plank', capacity: 60 },
};
// What a crate holds is said off the crate: `{capacity}` in its item's text.
for (const c of Object.values(CRATE_DEFS)) describeFrom(c.item, c);

export const SUBTILES = 4;

/** How far from a store's centre you can stand and still put things in or take them out, in tiles. */
export const STORE_REACH = 2.4;

export const crateKindOfItem = (itemId: string): CrateKind | null => (itemId === 'crate_log' ? 'log' : itemId === 'crate_plank' ? 'plank' : null);
/**
 * How full it is.
 *
 * `units` when the island has said so and the contents have not travelled —
 * which is every crate too far off to reach into. Counting `items` alone made
 * every crate on an island read as empty, and the browser's own "the crate is
 * full" was therefore never true: it waved a store through and the island
 * refused it, with nothing said that anybody would connect to the crate.
 */
export const crateUnits = (c: PlacedCrate): number =>
  c.items.length ? c.items.reduce((n, it) => n + it.count, 0) : c.units ?? 0;
/** What it holds: its build, and how strong a wood it was built out of. */
export const crateCapacity = (c: PlacedCrate): number => roomFor(CRATE_DEFS[c.kind].capacity * matOf(c.material).hold, c);
/** How much more it will take, which is what a put is allowed to be. */
export const crateSpare = (c: PlacedCrate): number => Math.max(0, crateCapacity(c) - crateUnits(c));
export const crateName = (c: PlacedCrate): string => {
  if (c.name) return c.name;
  const wood = c.material ? ` (${c.material.toLowerCase()})` : '';
  const rare = rarityOf(c).name;
  const said = c.deed ? `Deed crate (${CRATE_DEFS[c.kind].name.toLowerCase()})${wood}` : `${CRATE_DEFS[c.kind].name}${wood}`;
  return rare ? `${rare.charAt(0).toUpperCase()}${rare.slice(1)} ${said.toLowerCase()}` : said;
};
/** World position of a crate's centre. */
export const crateCentre = (c: PlacedCrate): [number, number] => [c.x + (c.sx + 0.5) / SUBTILES, c.y + (c.sy + 0.5) / SUBTILES];

/** Which subtile of tile (x, y) a world point falls in. */
export function subtileOf(x: number, y: number, wx: number, wy: number): [number, number] {
  const sx = Math.max(0, Math.min(SUBTILES - 1, Math.floor((wx - x) * SUBTILES)));
  const sy = Math.max(0, Math.min(SUBTILES - 1, Math.floor((wy - y) * SUBTILES)));
  return [sx, sy];
}

type CrateTarget = Extract<Target, { kind: 'crate' }>;
const crateOf = (g: Game, t: Target): PlacedCrate | undefined => (t.kind === 'crate' ? g.crates.get((t as CrateTarget).id) : undefined);
const nearCrate = (g: Game, c: PlacedCrate): boolean => {
  const [cx, cy] = crateCentre(c);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= STORE_REACH;
};

/**
 * The crate a thing is being put into: the one the ask names, and the nearest
 * when it names none.
 *
 * It was always the nearest, which is fine at a crate standing on its own and
 * wrong everywhere else. Reported from a rack: "trying to place any items in
 * any of the pine crates gives an error that the maple crate is full". Eight
 * crates stand on one tile on a rack; the nearest of the eight was the maple;
 * so every drag into an open pine crate was aimed at the maple, and once the
 * maple was full every one of them was refused in the maple's name. A crate
 * window that says which crate it is has to be able to say so in the ask.
 */
const crateInto = (g: Game, t: Target): PlacedCrate | undefined => {
  if (t.kind === 'item' && t.into !== undefined) {
    const named = g.crates.get(t.into);
    // Named and within reach: a crate you have walked away from is not the
    // crate you are putting something in, and the island reads it the same way.
    if (named && nearCrate(g, named)) return named;
  }
  return g.nearestCrate();
};

export const CRATE_ACTIONS: ActionDef[] = [
  {
    id: 'place_crate',
    label: 'Place crate',
    verb: 'placing the crate',
    hidden: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile' || t.itemUid === undefined || t.sx === undefined || t.sy === undefined) return 'Choose a crate and a spot.';
      const item = g.inventory.get(t.itemUid);
      const kind = item && crateKindOfItem(item.id);
      if (!item || !kind) return 'That is not a crate.';
      /*
       * A rack's deck is a crate spot, and the ground under it is the rack's
       * business rather than the crate's: whoever put the rack there already
       * answered for the footing. So the ground rules below are skipped on a
       * deck and asked on bare earth, which is the only difference between the
       * two — a crate on a rack is an ordinary crate at an ordinary subtile.
       */
      const rack = g.rackAt(t.x, t.y, t.sx, t.sy);
      if (rack) {
        if (kind !== 'plank') return `A ${CRATE_DEFS[kind].name.toLowerCase()} will not sit on the runners. The rack takes plank crates.`;
      } else {
        if (!g.world.isPassable(t.x, t.y) || g.world.hasWater(t.x, t.y)) return 'Crates need dry, open ground.';
        if (g.world.slope(t.x, t.y) > 20) return 'The ground is too steep for a crate to stand.';
      }
      if (g.crateAt(t.x, t.y, t.sx, t.sy)) return 'There is already a crate on that spot.';
      if (g.isToken(t.x, t.y)) return 'Not on the token.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.itemUid === undefined || t.sx === undefined || t.sy === undefined) return;
      const item = g.inventory.get(t.itemUid);
      const kind = item && crateKindOfItem(item.id);
      if (!item || !kind || !g.inventory.remove(item.uid, 1)) return;
      const crate = g.addCrate(kind, t.x, t.y, t.sx, t.sy, [], false, item.extra, item.ql);
      // A rare crate holds more, so it has to stay rare once it is standing.
      if (item.rare) crate.rare = item.rare;
      g.note('crate');
      g.logMsg(`You set the ${crateName(crate).toLowerCase()} down.`, 'event');
      g.events.emit('world', crate.x, crate.y);
    },
  },
  {
    id: 'pick_up_crate',
    label: 'Pick up crate',
    verb: 'lifting the crate',
    stamina: 0.03,
    baseTime: 2,
    applies: (t) => t.kind === 'crate',
    check: (t, g) => {
      const c = crateOf(g, t);
      if (!c) return 'It is gone.';
      // A crate with a lock on it is not carried off with the lock: a locked
      // thing that could simply be picked up is not locked at all.
      const shut = g.lockRefusal(c);
      if (shut) return shut;
      if (c.items.length) return 'Empty it first.';
      return null;
    },
    perform: (t, g) => {
      const c = crateOf(g, t);
      if (!c || c.items.length) return;
      g.removeCrate(c.id);
      const back = g.inventory.add(CRATE_DEFS[c.kind].item, { ql: c.ql, extra: c.material });
      if (c.rare) back.rare = c.rare;
      g.logMsg(`You pick up the ${CRATE_DEFS[c.kind].name.toLowerCase()}.${c.deed ? ' Deed workers will leave their finds by the token until a deed crate stands again.' : ''}`, 'event');
      g.events.emit('world', c.x, c.y);
    },
  },
  {
    id: 'crate_take_all',
    label: 'Take everything',
    verb: 'emptying the crate',
    stamina: 0.01,
    baseTime: 1,
    applies: (t) => t.kind === 'crate',
    check: (t, g) => {
      const c = crateOf(g, t);
      if (!c) return 'The crate is empty.';
      const shut = g.lockRefusal(c);
      if (shut) return shut;
      return c.items.length ? null : 'The crate is empty.';
    },
    perform: (t, g) => {
      const c = crateOf(g, t);
      if (!c || !c.items.length) return;
      const items = c.items.splice(0, c.items.length);
      for (const it of items) g.inventory.addItem(it);
      g.events.emit('crate');
      const names = items.map((it) => (it.count > 1 ? `${it.count} × ${itemName(it).toLowerCase()}` : itemName(it).toLowerCase()));
      g.logMsg(`You take ${names.join(', ')} from the crate.`, 'event');
    },
  },
  {
    id: 'store_in_crate',
    label: 'Put in crate',
    verb: 'stowing',
    instant: true,
    quantity: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => t.kind === 'item' && g.crates.size > 0 && !crateKindOfItem(g.inventory.get(t.uid)?.id ?? ''),
    check: (t, g) => {
      const c = crateInto(g, t);
      if (!c || !nearCrate(g, c)) return 'Stand next to a crate.';
      const shut = g.lockRefusal(c);
      if (shut) return shut;
      // Room for some of it is enough: what fits goes in and the rest stays in
      // the pack. Only a crate with no room at all has anything to refuse, and
      // the refusal names the crate you were aiming at.
      if (crateSpare(c) <= 0) return `The ${crateName(c).toLowerCase()} is full.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const c = crateInto(g, t);
      if (!c) return;
      const want = t.count ?? 1;
      const fits = Math.min(want, crateSpare(c));
      if (fits <= 0) {
        g.logMsg(`The ${crateName(c).toLowerCase()} is full.`, 'error');
        return;
      }
      const item = g.inventory.take(t.uid, fits);
      if (!item) return;
      if (!g.crateAdd(c, item)) {
        g.inventory.addItem(item);
        g.logMsg(`The ${crateName(c).toLowerCase()} is full.`, 'error');
        return;
      }
      g.logMsg(storedLine(item.count, itemName(item), crateName(c), want - item.count), 'event');
    },
  },
];

CRATE_ACTIONS.push({
  id: 'take_from_store',
  label: 'Take out',
  verb: 'taking it out',
  instant: true,
  quantity: true,
  stamina: 0,
  baseTime: 0,
  /*
   * Not in the generic item menu: it only means anything about a thing that is
   * already in a crate or a chest, and those are reached through the store
   * window. It exists so that taking one thing out has a door of its own —
   * there has been a way to put a thing in and a way to take everything out,
   * and nothing in between, so the browser did the in-between itself and the
   * island put it straight back.
   */
  hidden: true,
  applies: (t, g) => t.kind === 'item' && !g.inventory.get(t.uid) && !!g.storeWith(t.uid),
  check: (t, g) => {
    if (t.kind !== 'item') return null;
    const where = g.storeWith(t.uid);
    if (!where) return 'It is gone.';
    const dx = where.at[0] - g.player.x;
    const dy = where.at[1] - g.player.y;
    return Math.hypot(dx, dy) > STORE_REACH ? `Stand next to the ${where.what} to take things out of it.` : null;
  },
  perform: (t, g) => {
    if (t.kind !== 'item') return;
    const where = g.storeWith(t.uid);
    if (!where) return;
    const got = where.take(t.uid);
    if (!got) return;
    g.inventory.addItem(got);
    g.logMsg(`You take ${got.count > 1 ? `${got.count} × ` : 'the '}${itemName(got).toLowerCase()} out of the ${where.what}.`, 'event');
  },
});

export const CRATE_ACTION_BY_ID = new Map(CRATE_ACTIONS.map((a) => [a.id, a]));
