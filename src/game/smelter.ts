import type { ActionDef, Target } from './actions';
import { FIRE_CAPACITY, FUEL_VALUES, hasAshes, isFuel, rakeAshes } from './campfire';
import { SUBTILES } from './crates';
import type { Game } from './game';
import { itemDef, itemName, type Item } from './items';
import { castSeconds, isOreItem, METAL_BY_LUMP, METAL_BY_ORE, MOULD_BY_ID, smeltSeconds } from './metal';

/**
 * A stone smelter: the deed's second building after the campfire. It fills a
 * three by two block of subtiles, burns the same fuel a campfire does, and
 * works away on its own while it has heat in it.
 */
export interface SmeltJob {
  /** What went in. */
  item: Item;
  /** What comes out. */
  makes: string;
  /** Seconds of burning still needed. */
  left: number;
  /** Total it started with, for the bar. */
  total: number;
  /** Quality the piece will carry. */
  ql: number;
}

export interface PlacedSmelter {
  id: number;
  x: number;
  y: number;
  /** Top-left subtile of its three by two block. */
  sx: number;
  sy: number;
  /** Built quality, which decides how fast it works. */
  ql: number;
  fuel: number;
  lit: boolean;
  /** What it is working through, in order. */
  jobs: SmeltJob[];
  /** Finished pieces waiting to be taken out. */
  output: Item[];
  /** Ashes waiting to be raked out. */
  ash?: number;
}

/** A smelter is three subtiles one way and two the other: six in all. */
export const SMELTER_W = 3;
export const SMELTER_H = 2;
export const SMELTER_CAPACITY = 20;

export const smelterCentre = (s: PlacedSmelter): [number, number] => [s.x + (s.sx + SMELTER_W / 2) / SUBTILES, s.y + (s.sy + SMELTER_H / 2) / SUBTILES];

export function smelterCovers(s: { sx: number; sy: number }, sx: number, sy: number): boolean {
  return sx >= s.sx && sx < s.sx + SMELTER_W && sy >= s.sy && sy < s.sy + SMELTER_H;
}

/** Top-left subtile of the block a smelter would take, kept inside the tile. */
export function smelterAnchor(sx: number, sy: number): [number, number] {
  return [Math.max(0, Math.min(SUBTILES - SMELTER_W, sx)), Math.max(0, Math.min(SUBTILES - SMELTER_H, sy))];
}

export const smelterBurnsFor = (s: PlacedSmelter): string => {
  const m = Math.round(s.fuel / 60);
  return m >= 60 ? `${(m / 60).toFixed(1)} hours` : m >= 1 ? `${m} minutes` : `${Math.round(s.fuel)} seconds`;
};

export function smelterState(s: PlacedSmelter): string {
  const heat = s.lit ? `hot, ${smelterBurnsFor(s)} of fuel` : s.fuel > 0 ? `banked and cold, ${smelterBurnsFor(s)} of fuel` : 'cold and empty';
  const work = s.jobs.length ? ` · ${s.jobs.length} in the furnace` : '';
  const out = s.output.length ? ` · ${s.output.length} waiting` : '';
  return `QL ${s.ql.toFixed(0)} · ${heat}${work}${out}`;
}

type SmelterTarget = Extract<Target, { kind: 'smelter' }>;
const smelterOf = (g: Game, t: Target): PlacedSmelter | undefined => (t.kind === 'smelter' ? g.smelters.get((t as SmelterTarget).id) : undefined);
const nearSmelter = (g: Game, s: PlacedSmelter): boolean => {
  const [cx, cy] = smelterCentre(s);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= 2.6;
};

/** Everything a smelter will take in: ore to smelt, or an anvil mould to cast. */
export function smeltableIn(g: Game, item: Item): { makes: string; seconds: number; ql: number } | null {
  const metal = METAL_BY_ORE.get(item.id);
  if (metal) return { makes: metal.lump, seconds: 0, ql: item.ql };
  return null;
}

export const SMELTER_ACTIONS: ActionDef[] = [
  {
    id: 'place_smelter',
    label: 'Set the smelter down',
    verb: 'setting the smelter down',
    hidden: true,
    stamina: 0.05,
    baseTime: 6,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return 'Choose a spot.';
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.find('smelter');
      if (!item || item.id !== 'smelter') return 'You are not carrying a smelter. Build one at the crafting window.';
      if (!g.deed || !g.onDeed(t.x, t.y)) return 'Smelters stand on your own deed.';
      return g.smelterPlaceReason(t.x, t.y, t.sx, t.sy);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.find('smelter');
      if (!item || item.id !== 'smelter' || !g.inventory.remove(item.uid, 1)) return;
      const s = g.addSmelter(t.x, t.y, t.sx, t.sy, item.ql);
      g.logMsg(`You set the smelter down and bed it in. (QL ${s.ql.toFixed(1)}) Feed it fuel and light it.`, 'event');
      g.events.emit('world', s.x, s.y);
    },
  },
  {
    id: 'pick_up_smelter',
    label: 'Take it up',
    verb: 'taking the smelter up',
    stamina: 0.05,
    baseTime: 6,
    applies: (t, g) => smelterOf(g, t) !== undefined,
    check: (t, g) => {
      const s = smelterOf(g, t);
      if (!s) return 'It is gone.';
      if (s.lit) return 'Not while it is alight.';
      if (s.jobs.length || s.output.length) return 'Empty it first.';
      if (Math.floor(s.ash ?? 0) >= 1) return 'Rake the ashes out first.';
      return null;
    },
    perform: (t, g) => {
      const s = smelterOf(g, t);
      if (!s || s.lit || s.jobs.length || s.output.length) return;
      g.removeSmelter(s.id);
      g.inventory.add('smelter', { ql: s.ql });
      g.logMsg('You take the smelter apart and carry it off in one piece.', 'event');
      g.events.emit('world', s.x, s.y);
    },
  },
  {
    id: 'fuel_smelter',
    label: 'Fuel',
    verb: 'feeding the smelter',
    hidden: true,
    quantity: true,
    stamina: 0.01,
    baseTime: 1.5,
    applies: (t, g) => smelterOf(g, t) !== undefined,
    check: (t, g) => {
      const s = smelterOf(g, t);
      if (!s) return 'It is gone.';
      if (!nearSmelter(g, s)) return 'Stand next to the smelter.';
      const item = t.kind === 'smelter' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isFuel(it.id));
      if (!item || !isFuel(item.id)) return 'A smelter burns wood and coal.';
      if (s.fuel >= FIRE_CAPACITY) return 'The firebox is full.';
      return null;
    },
    perform: (t, g) => {
      const s = smelterOf(g, t);
      if (!s || t.kind !== 'smelter') return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isFuel(it.id));
      if (!item || !isFuel(item.id)) return;
      const per = FUEL_VALUES[item.id];
      const fits = Math.max(1, Math.min(Math.min(t.count ?? 1, item.count), Math.ceil(Math.max(0, FIRE_CAPACITY - s.fuel) / per)));
      if (!g.inventory.remove(item.uid, fits)) return;
      s.fuel = Math.min(FIRE_CAPACITY, s.fuel + per * fits);
      g.events.emit('smelter');
      g.logMsg(`You feed ${fits > 1 ? `${fits} × ` : 'a '}${itemDef(item.id).name.toLowerCase()} into the smelter. ${smelterBurnsFor(s)} of fuel.`, 'event');
    },
  },
  {
    id: 'light_smelter',
    label: 'Light',
    verb: 'lighting the smelter',
    stamina: 0.04,
    baseTime: 6,
    applies: (t, g) => smelterOf(g, t)?.lit === false,
    check: (t, g) => {
      const s = smelterOf(g, t);
      if (!s) return 'It is gone.';
      if (s.lit) return 'It is already hot.';
      if (s.fuel <= 0) return 'There is nothing in the firebox.';
      return null;
    },
    perform: (t, g) => {
      const s = smelterOf(g, t);
      if (!s || s.lit) return;
      s.lit = true;
      g.events.emit('smelter');
      g.events.emit('world', s.x, s.y);
      g.logMsg(`The smelter draws and comes up to heat. It has ${smelterBurnsFor(s)} of fuel.`, 'event');
    },
  },
  {
    id: 'damp_smelter',
    label: 'Damp it down',
    verb: 'damping the smelter',
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => smelterOf(g, t)?.lit === true,
    perform: (t, g) => {
      const s = smelterOf(g, t);
      if (!s) return;
      s.lit = false;
      g.events.emit('smelter');
      g.events.emit('world', s.x, s.y);
      g.logMsg('You damp the smelter down. What is left of the fuel keeps.', 'event');
    },
  },
  {
    id: 'smelt_ore',
    label: 'Smelt',
    verb: 'charging the smelter',
    skill: 'smelting',
    hidden: true,
    quantity: true,
    instant: true,
    stamina: 0.01,
    baseTime: 0,
    applies: (t, g) => smelterOf(g, t) !== undefined,
    check: (t, g) => {
      const s = smelterOf(g, t);
      if (!s) return 'It is gone.';
      if (!nearSmelter(g, s)) return 'Stand next to the smelter.';
      const item = t.kind === 'smelter' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
      if (!item || !isOreItem(item.id)) return 'Smelters take ore.';
      if (s.jobs.length >= SMELTER_CAPACITY) return 'The furnace is charged as full as it will go.';
      return null;
    },
    perform: (t, g) => {
      const s = smelterOf(g, t);
      if (!s || t.kind !== 'smelter' || t.itemUid === undefined) return;
      const item = g.inventory.get(t.itemUid);
      const metal = item && METAL_BY_ORE.get(item.id);
      if (!item || !metal) return;
      const n = Math.max(1, Math.min(Math.min(t.count ?? 1, item.count), SMELTER_CAPACITY - s.jobs.length));
      const taken = g.inventory.take(item.uid, n);
      if (!taken) return;
      const seconds = smeltSeconds(metal.id, taken.ql, s.ql);
      for (let i = 0; i < n; i++) s.jobs.push({ item: { ...taken, count: 1 }, makes: metal.lump, left: seconds, total: seconds, ql: taken.ql });
      g.events.emit('smelter');
      g.logMsg(`You charge the smelter with ${n > 1 ? `${n} × ` : ''}${itemDef(taken.id).name.toLowerCase()}. Each takes about ${Math.round(seconds)} seconds of heat.`, 'event');
    },
  },
  {
    id: 'cast_anvil',
    label: 'Cast an anvil',
    verb: 'filling the anvil mould',
    skill: 'blacksmithing',
    hidden: true,
    stamina: 0.04,
    baseTime: 6,
    applies: (t, g) => smelterOf(g, t) !== undefined,
    check: (t, g) => {
      const s = smelterOf(g, t);
      if (!s) return 'It is gone.';
      if (!nearSmelter(g, s)) return 'Stand next to the smelter.';
      const mould = g.inventory.find('anvil_mould');
      if (!mould) return 'You need an anvil mould.';
      const def = MOULD_BY_ID.get('anvil_mould');
      const lump = t.kind === 'smelter' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
      if (!lump || !METAL_BY_LUMP.has(lump.id)) return 'Choose the metal to pour.';
      if (lump.count < (def?.lumps ?? 4)) return `An anvil takes ${def?.lumps ?? 4} lumps.`;
      return null;
    },
    perform: (t, g) => {
      const s = smelterOf(g, t);
      if (!s || t.kind !== 'smelter' || t.itemUid === undefined) return;
      const mould = g.inventory.find('anvil_mould');
      const lump = g.inventory.get(t.itemUid);
      const metal = lump && METAL_BY_LUMP.get(lump.id);
      const def = MOULD_BY_ID.get('anvil_mould');
      if (!mould || !lump || !metal || !def) return;
      const need = def.lumps;
      if (lump.count < need || !g.inventory.remove(lump.uid, need)) return;
      // The mould is spent by a piece this size, whatever quality it was.
      g.inventory.remove(mould.uid, 1);
      const ql = Math.max(1, Math.min(100, (lump.ql + mould.ql + g.productQl('blacksmithing')) / 3));
      const seconds = castSeconds(metal.id, ql);
      s.jobs.push({ item: { ...lump, count: need }, makes: 'anvil', left: seconds, total: seconds, ql });
      g.events.emit('smelter');
      g.logMsg(`You pour ${need} lumps of ${metal.name.toLowerCase()} into the anvil mould. It needs about ${Math.round(seconds)} seconds to cool.`, 'event');
    },
  },
  {
    id: 'smelter_take_all',
    label: 'Take what is done',
    verb: 'emptying the smelter',
    stamina: 0.01,
    baseTime: 1,
    applies: (t, g) => smelterOf(g, t) !== undefined,
    check: (t, g) => {
      const s = smelterOf(g, t);
      if (!s) return 'It is gone.';
      return s.output.length ? null : 'Nothing is finished yet.';
    },
    perform: (t, g) => {
      const s = smelterOf(g, t);
      if (!s || !s.output.length) return;
      const taken = s.output.splice(0, s.output.length);
      for (const it of taken) g.inventory.addItem(it);
      g.events.emit('smelter');
      const names = taken.map((it) => (it.count > 1 ? `${it.count} × ${itemName(it).toLowerCase()}` : itemName(it).toLowerCase()));
      g.logMsg(`You draw ${names.join(', ')} from the smelter.`, 'event');
    },
  },
  {
    id: 'take_ashes_smelter',
    label: 'Rake out the ashes',
    verb: 'raking out ashes',
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => {
      const h = smelterOf(g, t);
      return !!h && hasAshes(h);
    },
    check: (t, g) => {
      const h = smelterOf(g, t);
      if (!h) return 'It is gone.';
      if (!nearSmelter(g, h)) return 'Stand next to the smelter.';
      return hasAshes(h) ? null : 'There are no ashes worth taking yet.';
    },
    perform: (t, g) => {
      const h = smelterOf(g, t);
      if (h) rakeAshes(g, h, 'smelter');
    },
  },
];

export const SMELTER_ACTION_BY_ID = new Map(SMELTER_ACTIONS.map((a) => [a.id, a]));
