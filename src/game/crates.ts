import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { itemDef, itemName, type Item } from './items';

/**
 * Crates are the first placeable objects. Each tile is a 4 by 4 grid of
 * subtiles; a crate occupies one subtile and snaps to that grid.
 */
export type CrateKind = 'log' | 'plank';

export interface PlacedCrate {
  id: number;
  x: number;
  y: number;
  /** Subtile column and row, 0..3. */
  sx: number;
  sy: number;
  kind: CrateKind;
  items: Item[];
  /** The settlement's crate: deed workers deliver here. */
  deed?: boolean;
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

export const SUBTILES = 4;

export const crateKindOfItem = (itemId: string): CrateKind | null => (itemId === 'crate_log' ? 'log' : itemId === 'crate_plank' ? 'plank' : null);
export const crateUnits = (c: PlacedCrate): number => c.items.reduce((n, it) => n + it.count, 0);
export const crateName = (c: PlacedCrate): string => (c.deed ? `Deed crate (${CRATE_DEFS[c.kind].name.toLowerCase()})` : CRATE_DEFS[c.kind].name);
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
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= 2.4;
};

function makeCrate(kind: CrateKind, logsNeeded: number, material: string): ActionDef {
  const def = CRATE_DEFS[kind];
  return {
    id: `make_${kind}_crate`,
    label: `Build ${def.name.toLowerCase()}`,
    verb: 'building a crate',
    skill: 'carpentry',
    tool: 'mallet',
    stamina: 0.05,
    baseTime: 6,
    applies: (t, g) => t.kind === 'item' && g.inventory.get(t.uid)?.id === material,
    check: (_t, g) => {
      if (!g.inventory.has('mallet')) return 'You need a mallet.';
      if (g.inventory.count(material) < logsNeeded) return `A ${def.name.toLowerCase()} takes ${logsNeeded} ${itemDef(material).name.toLowerCase()}s.`;
      return null;
    },
    perform: (_t, g) => {
      if (!g.inventory.consume(material, logsNeeded)) return;
      g.inventory.add(def.item, { ql: g.productQl('carpentry', g.toolQl('mallet')) });
      g.logMsg(`You knock together a ${def.name.toLowerCase()}. Place it on any spot of a tile.`, 'event');
    },
  };
}

export const CRATE_ACTIONS: ActionDef[] = [
  makeCrate('log', 3, 'log'),
  makeCrate('plank', 6, 'plank'),
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
      if (!item || !crateKindOfItem(item.id)) return 'That is not a crate.';
      if (!g.world.isPassable(t.x, t.y) || g.world.hasWater(t.x, t.y)) return 'Crates need dry, open ground.';
      if (g.world.slope(t.x, t.y) > 20) return 'The ground is too steep for a crate to stand.';
      if (g.crateAt(t.x, t.y, t.sx, t.sy)) return 'There is already a crate on that spot.';
      if (g.isToken(t.x, t.y)) return 'Not on the token.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.itemUid === undefined || t.sx === undefined || t.sy === undefined) return;
      const item = g.inventory.get(t.itemUid);
      const kind = item && crateKindOfItem(item.id);
      if (!item || !kind || !g.inventory.remove(item.uid, 1)) return;
      const crate = g.addCrate(kind, t.x, t.y, t.sx, t.sy);
      g.logMsg(`You set the ${CRATE_DEFS[kind].name.toLowerCase()} down.`, 'event');
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
      if (c.items.length) return 'Empty it first.';
      return null;
    },
    perform: (t, g) => {
      const c = crateOf(g, t);
      if (!c || c.items.length) return;
      g.removeCrate(c.id);
      g.inventory.add(CRATE_DEFS[c.kind].item, { ql: 20 });
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
      return c && c.items.length ? null : 'The crate is empty.';
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
      const c = g.nearestCrate();
      if (!c || !nearCrate(g, c)) return 'Stand next to a crate.';
      if (t.kind === 'item') {
        const item = g.inventory.get(t.uid);
        if (item && crateUnits(c) + (t.count ?? 1) > CRATE_DEFS[c.kind].capacity) return `The ${CRATE_DEFS[c.kind].name.toLowerCase()} is full.`;
      }
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const c = g.nearestCrate();
      if (!c) return;
      const item = g.inventory.take(t.uid, t.count ?? 1);
      if (!item) return;
      if (!g.crateAdd(c, item)) {
        g.inventory.addItem(item);
        g.logMsg('The crate is full.', 'error');
        return;
      }
      g.logMsg(`You put ${item.count > 1 ? `${item.count} × ` : 'the '}${itemName(item).toLowerCase()} in the ${CRATE_DEFS[c.kind].name.toLowerCase()}.`, 'event');
    },
  },
];

export const CRATE_ACTION_BY_ID = new Map(CRATE_ACTIONS.map((a) => [a.id, a]));
