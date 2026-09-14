import type { ActionDef, Target } from './actions';
import { SUBTILES } from './crates';
import type { Game } from './game';
import { itemDef, itemName, type Item } from './items';
import { matOf } from './materials';

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
  /** Trade that builds it; fine carpentry with a mallet unless it says otherwise. */
  skill?: string;
  tool?: string;
  /** Takes nothing but bulk: stackable stuff, and a great deal of it. */
  bulk?: boolean;
  /** What is put in rots this many times faster than it would in the open. */
  trash?: number;
  /** Can be taken hold of and pulled along behind you. */
  cart?: boolean;
  /** A wheeled thing a team is hitched to and a driver sits on. */
  vehicle?: VehicleDef;
  /** A hull that floats, and is pushed along by whoever is sitting in it. */
  boat?: BoatDef;
  /** Litres of one liquid it holds, and nothing else. */
  liquid?: number;
  /** Draws its own water, up to this many litres. */
  well?: number;
  /** Burns fuel, and cooks whatever a campfire cooks. */
  hearth?: boolean;
  /** Can be slept in; the number is how much of a rest it is. */
  bed?: number;
  /**
   * A swarm's own house. Nobody puts anything into a hive: a tamed Vesp on
   * the deed fills it with comb, and the number is how much it will hold
   * before the swarm stops and waits for it to be emptied.
   */
  hive?: number;
}

/**
 * What it takes to put a vehicle on the road.
 *
 * A large cart rolls behind one wildermon and rolls better behind two; a wagon
 * has four yokes and will not stir until every one of them is filled. Nothing
 * about the load decides it — a full wagon is no slower than an empty one —
 * but the team does: a fast animal gets there sooner, and more of them pull
 * better than fewer.
 */
export interface VehicleDef {
  /** Places a wildermon can be hitched. */
  yokes: number;
  /** Yokes that have to be filled before it will move at all. */
  needs: number;
  /** How high off the ground the seat is in pixels, for drawing the driver. */
  seat: number;
}

/**
 * What it takes to float. A boat goes on water and nowhere else: it is
 * launched into it, it will not cross dry land, and the one aboard has to
 * find a shore again before getting out. Nothing is hitched to it; the pace
 * is the hull's and the arms or the wind behind it.
 */
export interface BoatDef {
  /** Tiles a second at a fair effort. */
  speed: number;
  /** Height units of water it needs under it. */
  draught: number;
  /** How high the deck sits, for drawing whoever is in it. */
  seat: number;
  /** True when the wind does the work, so the body behind it matters less. */
  sail?: boolean;
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
  extra: Partial<FurnitureDef> = {},
): FurnitureDef => ({ id, name, w, h, bill, difficulty, time, done, capacity, ...extra });

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
  piece('bed', 'Bed', 3, 2, [['plank', 6], ['timber', 4], ['cloth', 2], ['nail', 20]], 18, 15, 'You nail up a bed and stuff the mattress.', undefined, { bed: 1 }),
  piece('cot', 'Cot', 2, 2, [['plank', 4], ['timber', 2], ['cloth', 1], ['nail', 12]], 12, 10, 'You nail up a narrow cot.', undefined, { bed: 0.7 }),
  piece('chest', 'Chest', 2, 2, [['plank', 8], ['timber', 2], ['nail', 18]], 16, 12, 'You nail up a banded chest.', 60),
  piece('coffer', 'Coffer', 1, 1, [['plank', 4], ['nail', 10]], 14, 8, 'You nail up a small coffer.', 25),
  piece('cupboard', 'Cupboard', 2, 1, [['plank', 10], ['timber', 2], ['nail', 22]], 20, 14, 'You nail up a cupboard and hang its doors.', 80),
  piece('wardrobe', 'Wardrobe', 2, 2, [['plank', 14], ['timber', 4], ['nail', 30]], 24, 18, 'You nail up a wardrobe tall enough to hang a cloak in.', 100),
  piece('shelves', 'Shelves', 3, 1, [['plank', 12], ['timber', 2], ['nail', 26]], 18, 15, 'You nail up a long rack of shelves.', 120),
  piece('bookshelf', 'Bookshelf', 2, 1, [['plank', 10], ['timber', 2], ['nail', 22]], 20, 14, 'You nail up a bookshelf with a cornice on top.', 90),
  piece('larder', 'Larder', 2, 2, [['plank', 16], ['timber', 4], ['nail', 34]], 26, 20, 'You nail up a deep larder, the biggest thing you can store in.', 150),
  piece('barrel', 'Barrel', 1, 1, [['plank', 6], ['shaft', 2], ['nail', 10]], 18, 10, 'You raise the staves and hoop a barrel.', undefined, { liquid: 80 }),
  piece('lectern', 'Lectern', 1, 1, [['plank', 4], ['shaft', 2], ['nail', 8]], 16, 9, 'You nail up a lectern with a good slant on it.'),
  piece('coat_rack', 'Coat rack', 1, 1, [['plank', 1], ['shaft', 4], ['nail', 6]], 10, 6, 'You nail up a rack of pegs for the door.'),
  piece('planter', 'Planter', 2, 1, [['plank', 6], ['nail', 10]], 10, 7, 'You nail up a planter and fill it with earth.'),
  piece('firewood_rack', 'Firewood rack', 2, 1, [['plank', 2], ['shaft', 6], ['nail', 10]], 12, 8, 'You nail up a rack to keep firewood off the wet.', 40),
  piece('hive', 'Hive', 2, 1, [['plank', 6], ['shaft', 2], ['cloth', 1], ['nail', 12]], 18, 13, 'You nail up a hive of shallow boxes and turn the mouth of it south. Now it wants a swarm.', undefined, { hive: 40 }),
  // The two the cloth trade is built on. Stand at one to spin or weave.
  piece('spindle', 'Spindle', 1, 1, [['plank', 2], ['shaft', 3], ['nail', 8]], 14, 9, 'You turn a spindle and set it on its stand.'),
  piece('loom', 'Loom', 2, 2, [['plank', 8], ['timber', 4], ['shaft', 6], ['nail', 24]], 22, 18, 'You build a loom and thread the warp.'),
  // Masonry, not carpentry: these two are laid in brick and mortar.
  piece('oven', 'Oven', 2, 2, [['stone_brick', 10], ['mortar', 4]], 24, 18, 'You lay the courses, turn an arch over the mouth and leave it to set. An oven.', undefined, { skill: 'masonry', tool: 'trowel', hearth: true }),
  piece('well', 'Well', 2, 2, [['stone_brick', 12], ['mortar', 4], ['shaft', 4], ['nail', 8]], 30, 24, 'You line the shaft, cap it with a kerb and hang a windlass over it. It will find its own water.', undefined, { skill: 'masonry', tool: 'trowel', well: 50 }),
  // Storage of a different sort: bulk, rubbish, and something to pull it in.
  piece('bulk_bin', 'Bulk storage bin', 2, 2, [['plank', 12], ['timber', 4], ['nail', 24]], 20, 16, 'You build a deep bin with a hinged lid, the sort a hundred bricks go into.', 400, { bulk: true }),
  piece('trash_crate', 'Trash crate', 1, 1, [['plank', 3], ['nail', 6]], 8, 5, 'You knock together an open crate with a rotten bottom. Nothing lasts in it.', 30, { trash: 30 }),
  piece('cart', 'Small cart', 2, 1, [['plank', 8], ['shaft', 4], ['nail', 16]], 18, 14, 'You build a small cart on two wheels, light enough for one person to pull.', 100, { cart: true }),
  // The two that are driven rather than carried. A wheelwright's bill: wheels
  // on cast axles, a body banded with metal ribbon, and a yoke a wildermon is
  // hitched into.
  piece('large_cart', 'Large cart', 3, 2, [['plank', 20], ['timber', 6], ['large_wheel', 2], ['big_axle', 1], ['ribbon', 8], ['yoke', 2], ['nail', 40]], 30, 40, 'You build a large cart: box body, seat over the axle and a yoke to each side.', 1000, { skill: 'carpentry', vehicle: { yokes: 2, needs: 1, seat: 15 } }),
  piece('wagon', 'Wagon', 4, 3, [['plank', 40], ['timber', 12], ['large_wheel', 4], ['big_axle', 2], ['ribbon', 16], ['yoke', 4], ['nail', 80]], 45, 75, 'You build a wagon: four wheels under a long bed, a driver\'s box at the front and four yokes ahead of it.', 10000, { skill: 'carpentry', vehicle: { yokes: 4, needs: 4, seat: 19 } }),
  // The two that float. Built on the bank and launched into water with a
  // couple of feet under it; they carry their load and their crew and will
  // not be dragged up a beach.
  piece('rowing_boat', 'Rowing boat', 3, 2, [['plank', 20], ['timber', 6], ['shaft', 2], ['nail', 30]], 28, 34, 'You lay the strakes over the ribs, caulk the seams and set a pair of oars in her.', 300, { skill: 'carpentry', boat: { speed: 1.9, draught: 2, seat: 9 } }),
  piece('sailing_boat', 'Sailing boat', 4, 3, [['plank', 40], ['timber', 14], ['shaft', 3], ['cloth', 6], ['ribbon', 4], ['nail', 70]], 42, 70, 'You plank her, step the mast, bend the sail on and hang a rudder off the stern.', 1500, { skill: 'carpentry', boat: { speed: 3.4, draught: 4, seat: 13, sail: true } }),
  // Barrels hold liquid and nothing else, in three sizes.
  piece('small_barrel', 'Small barrel', 1, 1, [['plank', 3], ['shaft', 1], ['nail', 6]], 12, 7, 'You raise a small barrel and hoop it tight.', undefined, { liquid: 30 }),
  piece('large_barrel', 'Large barrel', 2, 2, [['plank', 14], ['shaft', 4], ['nail', 26]], 26, 20, 'You raise a great barrel, as tall as you are and twice as wide.', undefined, { liquid: 250 }),
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
  /** Seconds of fuel left and whether it is alight, for the oven. */
  fuel?: number;
  lit?: boolean;
  ash?: number;
  /** Litres held, and of what, for barrels and the well. */
  litres?: number;
  liquid?: LiquidKind;
  /** Set while the cart is being pulled along behind you. */
  hitched?: boolean;
  /** Wildermon hitched to it, in yoke order; only vehicles have any. */
  team?: number[];
  /** Set while the player is up on the seat with the reins in hand. */
  driven?: boolean;
  /** Comb drawn but not yet capped, for a hive. */
  comb?: number;
  /** Seconds a brew still has to work before it can be drawn off. */
  ferment?: number;
  /** The wood it was built of, for the pieces a carpenter builds. */
  material?: string;
}

/** The two liquids worth keeping a barrel for. */
export type LiquidKind = 'water' | 'lye' | 'milk' | 'ale' | 'cider' | 'mead' | 'wine';
export const LIQUID_NAME: Record<LiquidKind, string> = { water: 'water', lye: 'lye', milk: 'milk', ale: 'ale', cider: 'cider', mead: 'mead', wine: 'wine' };
/** A bucket holds five litres, whichever way it is going. */
export const BUCKET_LITRES = 5;
/** Which liquid a full vessel is carrying, and which empty vessel it leaves. */
export const VESSELS: Record<string, { liquid: LiquidKind; empty: string }> = {
  water_bucket: { liquid: 'water', empty: 'bucket' },
  lye_bucket: { liquid: 'lye', empty: 'bucket' },
  milk_bucket: { liquid: 'milk', empty: 'bucket' },
  ale_bucket: { liquid: 'ale', empty: 'bucket' },
  cider_bucket: { liquid: 'cider', empty: 'bucket' },
  mead_bucket: { liquid: 'mead', empty: 'bucket' },
  wine_bucket: { liquid: 'wine', empty: 'bucket' },
};
/** Which full vessel a litre of each liquid fills an empty bucket into. */
export const BUCKET_OF: Record<LiquidKind, string> = { water: 'water_bucket', lye: 'lye_bucket', milk: 'milk_bucket', ale: 'ale_bucket', cider: 'cider_bucket', mead: 'mead_bucket', wine: 'wine_bucket' };

export const furnitureName = (f: PlacedFurniture): string => (f.material ? `${furnitureDef(f.kind).name} (${f.material.toLowerCase()})` : furnitureDef(f.kind).name);
export const furnitureUnits = (f: PlacedFurniture): number => f.items.reduce((n, it) => n + it.count, 0);
/** What it holds: its build, and how strong a wood it was built out of. */
export const furnitureCapacity = (f: PlacedFurniture): number => Math.round((furnitureDef(f.kind).capacity ?? furnitureDef(f.kind).hive ?? 0) * matOf(f.material).hold);
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

/** The vehicle a piece is, if it is one. */
export const vehicleOf = (f: { kind: string }): VehicleDef | undefined => furnitureDef(f.kind).vehicle;
export const isVehicle = (f: { kind: string }): boolean => !!furnitureDef(f.kind).vehicle;
/** The boat a piece is, if it is one. */
export const boatOf = (f: { kind: string }): BoatDef | undefined => furnitureDef(f.kind).boat;
export const isBoat = (f: { kind: string }): boolean => !!furnitureDef(f.kind).boat;
/** Anything that is boarded and steered: wheels or hull. */
export const isDriveable = (f: { kind: string }): boolean => isVehicle(f) || isBoat(f);
/** Wildermon hitched to it, which is an empty list for everything else. */
export const teamOf = (f: PlacedFurniture): number[] => f.team ?? [];

/** Litres a vessel holds: a barrel by its build, a well by how deep it was sunk. */
export const liquidCapacity = (f: PlacedFurniture): number => {
  const def = furnitureDef(f.kind);
  // A well is a lined shaft in the ground; only the coopered things vary.
  return def.liquid ? Math.round(def.liquid * matOf(f.material).hold) : def.well ?? 0;
};
export const holdsLiquid = (f: PlacedFurniture): boolean => liquidCapacity(f) > 0;
export const litresIn = (f: PlacedFurniture): number => f.litres ?? 0;
/** A well draws its own water; a barrel only holds what is poured into it. */
export const isWell = (f: PlacedFurniture): boolean => (furnitureDef(f.kind).well ?? 0) > 0;
/** A hive fills itself, and takes nothing from anyone's hands. */
export const hiveRoom = (f: PlacedFurniture): number => furnitureCapacity(f) - furnitureUnits(f);
export const isHive = (f: { kind: string }): boolean => (furnitureDef(f.kind).hive ?? 0) > 0;

/**
 * Why a piece will not take something, or null if it will. A bulk bin takes
 * bulk and nothing else; a barrel takes no solids at all.
 */
export function furnitureRefuses(f: PlacedFurniture, item: Item): string | null {
  const def = furnitureDef(f.kind);
  const it = `${/^[aeiou]/i.test(def.name) ? 'An' : 'A'} ${def.name.toLowerCase()}`;
  if (holdsLiquid(f)) return `${it} holds liquid and nothing else.`;
  if (def.hive) return `${it} is the swarm's, not yours. Take what is in it; do not put anything back.`;
  if (!def.capacity) return `${it} does not hold things.`;
  if (def.bulk && !itemDef(item.id).stackable) return 'A bulk bin takes bulk: things that stack, by the pile.';
  return null;
}

export function furnitureState(f: PlacedFurniture): string {
  const def = furnitureDef(f.kind);
  const ql = `QL ${f.ql.toFixed(0)}`;
  if (holdsLiquid(f)) {
    const litres = litresIn(f);
    const what = f.liquid ? LIQUID_NAME[f.liquid] : 'empty';
    // A barrel that is working says so, and how long it has to go.
    const left = f.ferment ?? 0;
    const working = left > 0 ? ` · working, ${left >= 60 ? `${Math.ceil(left / 60)}m` : `${Math.ceil(left)}s`} to go` : '';
    return `${ql} · ${litres.toFixed(0)} / ${liquidCapacity(f)} litres of ${what}${working}`;
  }
  if (def.hearth) return `${ql} · ${f.lit ? 'lit' : 'cold'}`;
  if (def.hive) return `${ql} · ${furnitureUnits(f)} / ${furnitureCapacity(f)} of comb`;
  const cap = furnitureCapacity(f);
  const held = cap ? `${ql} · ${furnitureUnits(f)} / ${cap} things` : ql;
  const v = def.vehicle;
  if (!v) return held;
  return `${held} · ${teamOf(f).length} of ${v.yokes} yoked${f.driven ? ' · you have the reins' : ''}`;
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
      const f = g.addFurniture(item.id, t.x, t.y, t.sx, t.sy, item.ql, [], item.extra);
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
      if (f.lit) return 'Not while it is alight.';
      if (litresIn(f) > 0) return 'Empty it out first.';
      if (f.hitched) return 'Let go of it first.';
      if (teamOf(f).length) return 'Unhitch the team first.';
      if (f.driven) return 'Get down off it first.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || f.items.length || f.lit || litresIn(f) > 0 || f.hitched || f.driven || teamOf(f).length) return;
      g.removeFurniture(f.id);
      g.inventory.add(f.kind, { ql: f.ql, extra: f.material });
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
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && !isFurniture(item.id) && g.nearestStore(item) !== undefined;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      const f = item && g.nearestStore(item);
      if (!item) return 'It is gone.';
      if (!f || !nearPiece(g, f)) {
        // Say why the thing beside you will not take it, rather than that nothing will.
        const beside = [...g.furniture.values()].filter((o) => nearPiece(g, o));
        beside.sort((a, b) => furnitureCapacity(b) - furnitureCapacity(a));
        for (const other of beside) {
          const why = furnitureRefuses(other, item);
          if (why) return why;
        }
        return 'Stand next to something that will take it.';
      }
      const refused = furnitureRefuses(f, item);
      if (refused) return refused;
      if (furnitureUnits(f) + (t.count ?? 1) > furnitureCapacity(f)) return `The ${furnitureName(f).toLowerCase()} is full.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const held = g.inventory.get(t.uid);
      const f = held && g.nearestStore(held);
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
