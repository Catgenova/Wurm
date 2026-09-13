import type { ActionDef, Target } from './actions';
import { SUBTILES } from './crates';
import type { Game } from './game';
import { itemDef, itemName, type Item } from './items';

/**
 * Furniture: everything a fine carpenter nails together and sets down indoors.
 * A piece covers a block of subtiles like a smelter does, and the ones with
 * doors and shelves on them hold far more than any crate.
 */
export interface FurnitureDef {
  id: string;
  name: string;
  /** Subtiles it covers, across and down. */
  w: number;
  h: number;
  /** Things it holds, for the pieces that hold anything. */
  capacity?: number;
  /** Boards, shafts and nails it is nailed together from. */
  bill: Array<[string, number]>;
  /** How hard it is to make well. */
  difficulty: number;
  /** Seconds of work. */
  time: number;
  /** What the carpenter says when it comes out right. */
  done: string;
}

const piece = (
  id: string,
  name: string,
  w: number,
  h: number,
  bill: Array<[string, number]>,
  difficulty: number,
  time: number,
  done: string,
  capacity?: number,
): FurnitureDef => ({ id, name, w, h, bill, difficulty, time, done, capacity });

/**
 * The twenty pieces, from a three-legged stool to a larder. Everything here is
 * nailed rather than pegged, so every one of them takes nails.
 */
export const FURNITURE: FurnitureDef[] = [
  piece('stool', 'Stool', 1, 1, [['plank', 1], ['shaft', 3], ['nail', 6]], 8, 6, 'You nail up a three-legged stool.'),
  piece('chair', 'Chair', 1, 1, [['plank', 2], ['shaft', 4], ['nail', 10]], 12, 8, 'You nail up a chair with a proper back to it.'),
  piece('bench', 'Bench', 2, 1, [['plank', 4], ['shaft', 4], ['nail', 14]], 12, 9, 'You nail up a bench long enough for two.'),
  piece('table', 'Table', 2, 2, [['plank', 6], ['shaft', 4], ['nail', 16]], 14, 11, 'You nail up a square table.'),
  piece('long_table', 'Long table', 3, 2, [['plank', 10], ['timber', 2], ['shaft', 4], ['nail', 26]], 20, 16, 'You nail up a long table, the sort a hall is built around.'),
  piece('desk', 'Writing desk', 2, 2, [['plank', 8], ['timber', 2], ['nail', 20]], 22, 14, 'You nail up a writing desk, drawers and all.', 20),
  piece('bed', 'Bed', 3, 2, [['plank', 6], ['timber', 4], ['cloth', 2], ['nail', 20]], 18, 15, 'You nail up a bed and stuff the mattress.'),
  piece('cot', 'Cot', 2, 2, [['plank', 4], ['timber', 2], ['cloth', 1], ['nail', 12]], 12, 10, 'You nail up a narrow cot.'),
  piece('chest', 'Chest', 2, 2, [['plank', 8], ['timber', 2], ['nail', 18]], 16, 12, 'You nail up a banded chest.', 60),
  piece('coffer', 'Coffer', 1, 1, [['plank', 4], ['nail', 10]], 14, 8, 'You nail up a small coffer.', 25),
  piece('cupboard', 'Cupboard', 2, 1, [['plank', 10], ['timber', 2], ['nail', 22]], 20, 14, 'You nail up a cupboard and hang its doors.', 80),
  piece('wardrobe', 'Wardrobe', 2, 2, [['plank', 14], ['timber', 4], ['nail', 30]], 24, 18, 'You nail up a wardrobe tall enough to hang a cloak in.', 100),
  piece('shelves', 'Shelves', 3, 1, [['plank', 12], ['timber', 2], ['nail', 26]], 18, 15, 'You nail up a long rack of shelves.', 120),
  piece('bookshelf', 'Bookshelf', 2, 1, [['plank', 10], ['timber', 2], ['nail', 22]], 20, 14, 'You nail up a bookshelf with a cornice on top.', 90),
  piece('larder', 'Larder', 2, 2, [['plank', 16], ['timber', 4], ['nail', 34]], 26, 20, 'You nail up a deep larder, the biggest thing you can store in.', 150),
  piece('barrel', 'Barrel', 1, 1, [['plank', 6], ['shaft', 2], ['nail', 10]], 18, 10, 'You raise the staves and hoop a barrel.', 40),
  piece('lectern', 'Lectern', 1, 1, [['plank', 4], ['shaft', 2], ['nail', 8]], 16, 9, 'You nail up a lectern with a good slant on it.'),
  piece('coat_rack', 'Coat rack', 1, 1, [['plank', 1], ['shaft', 4], ['nail', 6]], 10, 6, 'You nail up a rack of pegs for the door.'),
  piece('planter', 'Planter', 2, 1, [['plank', 6], ['nail', 10]], 10, 7, 'You nail up a planter and fill it with earth.'),
  piece('firewood_rack', 'Firewood rack', 2, 1, [['plank', 2], ['shaft', 6], ['nail', 10]], 12, 8, 'You nail up a rack to keep firewood off the wet.', 40),
];

export const FURNITURE_BY_ID = new Map(FURNITURE.map((f) => [f.id, f]));
export const isFurniture = (id: string): boolean => FURNITURE_BY_ID.has(id);
export const furnitureDef = (id: string): FurnitureDef => FURNITURE_BY_ID.get(id) ?? FURNITURE[0];
/** Pieces that hold things, largest first: the point of a larder. */
export const STORES = FURNITURE.filter((f) => f.capacity).sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0));

export interface PlacedFurniture {
  id: number;
  x: number;
  y: number;
  /** Top-left subtile of the block it covers. */
  sx: number;
  sy: number;
  /** Which of the twenty it is. */
  kind: string;
  ql: number;
  /** What is stored in it, for the pieces that store anything. */
  items: Item[];
}

export const furnitureName = (f: PlacedFurniture): string => furnitureDef(f.kind).name;
export const furnitureUnits = (f: PlacedFurniture): number => f.items.reduce((n, it) => n + it.count, 0);
export const furnitureCapacity = (f: PlacedFurniture): number => furnitureDef(f.kind).capacity ?? 0;
export const furnitureCentre = (f: PlacedFurniture): [number, number] => {
  const def = furnitureDef(f.kind);
  return [f.x + (f.sx + def.w / 2) / SUBTILES, f.y + (f.sy + def.h / 2) / SUBTILES];
};

export function furnitureCovers(f: { kind: string; sx: number; sy: number }, sx: number, sy: number): boolean {
  const def = furnitureDef(f.kind);
  return sx >= f.sx && sx < f.sx + def.w && sy >= f.sy && sy < f.sy + def.h;
}

/** Top-left subtile of the block a piece would take, kept inside the tile. */
export function furnitureAnchor(kind: string, sx: number, sy: number): [number, number] {
  const def = furnitureDef(kind);
  return [Math.max(0, Math.min(SUBTILES - def.w, sx)), Math.max(0, Math.min(SUBTILES - def.h, sy))];
}

export function furnitureState(f: PlacedFurniture): string {
  const cap = furnitureCapacity(f);
  return cap ? `QL ${f.ql.toFixed(0)} · ${furnitureUnits(f)} / ${cap} things` : `QL ${f.ql.toFixed(0)}`;
}

type FurnitureTarget = Extract<Target, { kind: 'furniture' }>;
const pieceOf = (g: Game, t: Target): PlacedFurniture | undefined => (t.kind === 'furniture' ? g.furniture.get((t as FurnitureTarget).id) : undefined);
const nearPiece = (g: Game, f: PlacedFurniture): boolean => {
  const [cx, cy] = furnitureCentre(f);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= 2.4;
};

export const FURNITURE_ACTIONS: ActionDef[] = [
  {
    id: 'place_furniture',
    label: 'Set it down',
    verb: 'setting the furniture down',
    hidden: true,
    stamina: 0.03,
    baseTime: 3,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile' || t.itemUid === undefined || t.sx === undefined || t.sy === undefined) return 'Choose a piece and a spot.';
      const item = g.inventory.get(t.itemUid);
      if (!item || !isFurniture(item.id)) return 'That is not furniture.';
      return g.furniturePlaceReason(item.id, t.x, t.y, t.sx, t.sy);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.itemUid === undefined || t.sx === undefined || t.sy === undefined) return;
      const item = g.inventory.get(t.itemUid);
      if (!item || !isFurniture(item.id) || !g.inventory.remove(item.uid, 1)) return;
      const f = g.addFurniture(item.id, t.x, t.y, t.sx, t.sy, item.ql);
      g.logMsg(`You set the ${furnitureName(f).toLowerCase()} down.`, 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
  {
    id: 'pick_up_furniture',
    label: 'Pick it up',
    verb: 'lifting the furniture',
    stamina: 0.04,
    baseTime: 3,
    applies: (t) => t.kind === 'furniture',
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (f.items.length) return 'Empty it first.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || f.items.length) return;
      g.removeFurniture(f.id);
      g.inventory.add(f.kind, { ql: f.ql });
      g.logMsg(`You pick the ${furnitureName(f).toLowerCase()} up.`, 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
  {
    id: 'furniture_take_all',
    label: 'Take everything',
    verb: 'emptying it',
    stamina: 0.01,
    baseTime: 1,
    applies: (t, g) => !!pieceOf(g, t)?.items.length,
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (!nearPiece(g, f)) return 'Stand next to it.';
      return f.items.length ? null : 'It is empty.';
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || !f.items.length) return;
      const items = f.items.splice(0, f.items.length);
      for (const it of items) g.inventory.addItem(it);
      g.events.emit('crate');
      const names = items.map((it) => (it.count > 1 ? `${it.count} × ${itemName(it).toLowerCase()}` : itemName(it).toLowerCase()));
      g.logMsg(`You take ${names.join(', ')} out of the ${furnitureName(f).toLowerCase()}.`, 'event');
    },
  },
  {
    id: 'store_in_furniture',
    label: 'Put away',
    verb: 'putting it away',
    instant: true,
    quantity: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => t.kind === 'item' && g.nearestStore() !== undefined && !isFurniture(g.inventory.get(t.uid)?.id ?? ''),
    check: (t, g) => {
      const f = g.nearestStore();
      if (!f || !nearPiece(g, f)) return 'Stand next to something to put it in.';
      if (t.kind === 'item' && furnitureUnits(f) + (t.count ?? 1) > furnitureCapacity(f)) return `The ${furnitureName(f).toLowerCase()} is full.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const f = g.nearestStore();
      if (!f) return;
      const item = g.inventory.take(t.uid, t.count ?? 1);
      if (!item) return;
      if (!g.furnitureAdd(f, item)) {
        g.inventory.addItem(item);
        g.logMsg(`The ${furnitureName(f).toLowerCase()} is full.`, 'error');
        return;
      }
      g.logMsg(`You put ${item.count > 1 ? `${item.count} × ` : 'the '}${itemName(item).toLowerCase()} in the ${furnitureName(f).toLowerCase()}.`, 'event');
    },
  },
];

export const FURNITURE_ACTION_BY_ID = new Map(FURNITURE_ACTIONS.map((a) => [a.id, a]));
export { itemDef };
