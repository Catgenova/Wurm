import type { ActionDef, Target } from './actions';
import { SUBTILES } from './crates';
import type { Game } from './game';
import { itemDef, itemName, type Item } from './items';

/**
 * Campfires: the first thing you build on the ground rather than carry. A fire
 * takes a two by two block of subtiles, is fed wooden things for fuel, and
 * once lit is the station every cooking recipe needs.
 */
export interface PlacedCampfire {
  id: number;
  x: number;
  y: number;
  /** Subtile of the top-left corner of its two by two block, 0..2. */
  sx: number;
  sy: number;
  /** Seconds of burning left in it. */
  fuel: number;
  lit: boolean;
}

/** A campfire covers two subtiles each way, so four of the sixteen on a tile. */
export const FIRE_SUBTILES = 2;
/** Most fuel a fire holds, an hour of burning. */
export const FIRE_CAPACITY = 3600;
/** Shafts laid as the fire is built, and the fuel they are worth. */
export const FIRE_COST = 2;
const FIRE_LAID_FUEL = 120;

/** Seconds of burning each wooden thing is worth. */
export const FUEL_VALUES: Record<string, number> = {
  shaft: 90,
  thatch: 60,
  plank: 120,
  timber: 240,
  log: 600,
};

export const isFuel = (id: string): boolean => FUEL_VALUES[id] !== undefined;
/** World position of a fire's centre. */
export const fireCentre = (f: PlacedCampfire): [number, number] => [f.x + (f.sx + 1) / SUBTILES, f.y + (f.sy + 1) / SUBTILES];
export const fireBurnsFor = (f: PlacedCampfire): string => {
  const m = Math.round(f.fuel / 60);
  return m >= 60 ? `${(m / 60).toFixed(1)} hours` : m >= 1 ? `${m} minutes` : `${Math.round(f.fuel)} seconds`;
};
export const fireState = (f: PlacedCampfire): string => (f.lit ? `burning, ${fireBurnsFor(f)} of fuel left` : f.fuel > 0 ? `laid and unlit, ${fireBurnsFor(f)} of fuel` : 'burnt out');

/** Subtiles a fire covers, for checking whether a spot is free. */
export function fireCovers(f: { sx: number; sy: number }, sx: number, sy: number): boolean {
  return sx >= f.sx && sx < f.sx + FIRE_SUBTILES && sy >= f.sy && sy < f.sy + FIRE_SUBTILES;
}

/** Top-left subtile of the block a fire would take, kept inside the tile. */
export function fireAnchor(sx: number, sy: number): [number, number] {
  return [Math.max(0, Math.min(SUBTILES - FIRE_SUBTILES, sx)), Math.max(0, Math.min(SUBTILES - FIRE_SUBTILES, sy))];
}

type FireTarget = Extract<Target, { kind: 'campfire' }>;
const fireOf = (g: Game, t: Target): PlacedCampfire | undefined => (t.kind === 'campfire' ? g.campfires.get((t as FireTarget).id) : undefined);
const nearFire = (g: Game, f: PlacedCampfire): boolean => {
  const [cx, cy] = fireCentre(f);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= 2.4;
};

export const CAMPFIRE_ACTIONS: ActionDef[] = [
  {
    id: 'build_campfire',
    label: 'Build campfire',
    verb: 'laying a fire',
    skill: 'carpentry',
    hidden: true,
    stamina: 0.03,
    baseTime: 4,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return 'Choose a spot.';
      if (g.inventory.count('shaft') < FIRE_COST) return `A campfire takes ${FIRE_COST} shafts.`;
      return g.firePlaceReason(t.x, t.y, t.sx, t.sy);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return;
      if (!g.inventory.consume('shaft', FIRE_COST)) return;
      const fire = g.addCampfire(t.x, t.y, t.sx, t.sy, FIRE_LAID_FUEL);
      g.logMsg(`You lay a campfire from ${FIRE_COST} shafts. Light it, or feed it more wood first.`, 'event');
      g.events.emit('world', fire.x, fire.y);
    },
  },
  {
    id: 'light_campfire',
    label: 'Light',
    verb: 'lighting the fire',
    stamina: 0.04,
    baseTime: 6,
    applies: (t, g) => fireOf(g, t)?.lit === false,
    check: (t, g) => {
      const f = fireOf(g, t);
      if (!f) return 'It is gone.';
      if (f.lit) return 'It is already burning.';
      if (f.fuel <= 0) return 'There is nothing left to burn. Feed it some wood.';
      return null;
    },
    perform: (t, g) => {
      const f = fireOf(g, t);
      if (!f || f.lit || f.fuel <= 0) return;
      f.lit = true;
      g.events.emit('world', f.x, f.y);
      g.logMsg(`The kindling catches and the campfire burns. It has ${fireBurnsFor(f)} of fuel.`, 'event');
    },
  },
  {
    id: 'put_out_campfire',
    label: 'Put out',
    verb: 'smothering the fire',
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => fireOf(g, t)?.lit === true,
    perform: (t, g) => {
      const f = fireOf(g, t);
      if (!f) return;
      f.lit = false;
      g.events.emit('world', f.x, f.y);
      g.logMsg('You smother the fire. The wood is saved for later.', 'event');
    },
  },
  {
    id: 'fuel_campfire',
    label: 'Fuel',
    verb: 'feeding the fire',
    hidden: true,
    quantity: true,
    stamina: 0.01,
    baseTime: 1.5,
    applies: (t, g) => fireOf(g, t) !== undefined,
    check: (t, g) => {
      const f = fireOf(g, t);
      if (!f) return 'It is gone.';
      if (!nearFire(g, f)) return 'Stand next to the fire.';
      const item = t.kind === 'campfire' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isFuel(it.id));
      if (!item || !isFuel(item.id)) return 'Fires take wooden things: shafts, planks, timbers, logs or thatch.';
      if (f.fuel >= FIRE_CAPACITY) return 'It is already piled as high as it will take.';
      return null;
    },
    perform: (t, g) => {
      const f = fireOf(g, t);
      if (!f || t.kind !== 'campfire') return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isFuel(it.id));
      if (!item || !isFuel(item.id)) return;
      const want = Math.min(t.count ?? 1, item.count);
      const per = FUEL_VALUES[item.id];
      const room = Math.max(0, FIRE_CAPACITY - f.fuel);
      const fits = Math.max(1, Math.min(want, Math.ceil(room / per)));
      if (!g.inventory.remove(item.uid, fits)) return;
      f.fuel = Math.min(FIRE_CAPACITY, f.fuel + per * fits);
      g.events.emit('world', f.x, f.y);
      g.logMsg(`You feed ${fits > 1 ? `${fits} × ` : 'a '}${itemDef(item.id).name.toLowerCase()} to the fire. ${fireBurnsFor(f)} of fuel.`, 'event');
    },
  },
  {
    id: 'take_apart_campfire',
    label: 'Take apart',
    verb: 'taking the fire apart',
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => fireOf(g, t) !== undefined,
    check: (t, g) => {
      const f = fireOf(g, t);
      if (!f) return 'It is gone.';
      if (f.lit) return 'Put it out first.';
      return null;
    },
    perform: (t, g) => {
      const f = fireOf(g, t);
      if (!f || f.lit) return;
      g.removeCampfire(f.id);
      // Whole pieces of wood come back out of the pile; kindling does not.
      const back: string[] = [];
      let left = f.fuel;
      for (const [id, per] of [...Object.entries(FUEL_VALUES)].sort((a, b) => b[1] - a[1])) {
        const n = Math.floor(left / per);
        if (n <= 0) continue;
        left -= n * per;
        const item = g.inventory.add(id, { count: n, ql: 20 });
        back.push(item.count > 1 && n > 1 ? `${n} × ${itemName(item).toLowerCase()}` : itemName(item).toLowerCase());
      }
      g.logMsg(back.length ? `You take the campfire apart and recover ${back.join(', ')}.` : 'You scatter the cold ashes.', 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
];

export const CAMPFIRE_ACTION_BY_ID = new Map(CAMPFIRE_ACTIONS.map((a) => [a.id, a]));
export type { Item };
