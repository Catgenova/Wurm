import type { ActionDef, Target } from './actions';
import { FIRE_CAPACITY, FUEL_VALUES, hasAshes, isFuel, rakeAshes } from './campfire';
import { SUBTILES } from './crates';
import type { Game } from './game';
import { itemDef, itemName, type Item } from './items';
import { world } from './pace';

/**
 * A kiln: four subtiles of stone brick with a firebox under them. Clay is
 * shaped cold and is only worth anything once it has been through here, so a
 * potter builds one early and keeps it fed.
 */
export interface KilnJob {
  /** The green ware that went in. */
  item: Item;
  /** What comes out of it. */
  makes: string;
  /** Seconds of burning still needed. */
  left: number;
  /** What it started with, for the bar. */
  total: number;
  ql: number;
}

export interface PlacedKiln {
  id: number;
  x: number;
  y: number;
  /** Top-left subtile of its two by two block. */
  sx: number;
  sy: number;
  /** Built quality: a better kiln fires faster and truer. */
  ql: number;
  fuel: number;
  lit: boolean;
  jobs: KilnJob[];
  output: Item[];
  /** Ashes waiting to be raked out. */
  ash?: number;
}

/** A kiln covers two subtiles each way: four in all. */
export const KILN_SUBTILES = 2;
export const KILN_CAPACITY = 16;

/** Green ware, and what it becomes once it has been fired. */
export interface PotteryDef {
  unfired: string;
  fired: string;
  /** Seconds in an ordinary kiln. */
  seconds: number;
}

export const POTTERY: PotteryDef[] = [
  { unfired: 'unfired_clay_brick', fired: 'clay_brick', seconds: world(22) },
  { unfired: 'unfired_clay_bowl', fired: 'clay_bowl', seconds: world(30) },
  { unfired: 'unfired_clay_pot', fired: 'clay_pot', seconds: world(40) },
  { unfired: 'unfired_clay_jar', fired: 'clay_jar', seconds: world(34) },
];

export const POTTERY_BY_UNFIRED = new Map(POTTERY.map((p) => [p.unfired, p]));
export const isGreenware = (id: string): boolean => POTTERY_BY_UNFIRED.has(id);

/** How long a piece takes: its own size, quickened by a well-built kiln. */
export const fireSeconds = (def: PotteryDef, kilnQl: number): number => Math.max(6, def.seconds * (1.4 - kilnQl / 160));

/**
 * What comes out. The potter's hands settle most of it, and a good kiln keeps
 * what they made rather than adding to it.
 */
export const firedQl = (greenQl: number, kilnQl: number): number => Math.max(1, Math.min(100, greenQl * (0.82 + kilnQl / 420)));

export const kilnCentre = (k: PlacedKiln): [number, number] => [k.x + (k.sx + 1) / SUBTILES, k.y + (k.sy + 1) / SUBTILES];

export function kilnCovers(k: { sx: number; sy: number }, sx: number, sy: number): boolean {
  return sx >= k.sx && sx < k.sx + KILN_SUBTILES && sy >= k.sy && sy < k.sy + KILN_SUBTILES;
}

/** Top-left subtile of the block a kiln would take, kept inside the tile. */
export function kilnAnchor(sx: number, sy: number): [number, number] {
  return [Math.max(0, Math.min(SUBTILES - KILN_SUBTILES, sx)), Math.max(0, Math.min(SUBTILES - KILN_SUBTILES, sy))];
}

export const kilnBurnsFor = (k: PlacedKiln): string => {
  const m = Math.round(k.fuel / 60);
  return m >= 60 ? `${(m / 60).toFixed(1)} hours` : m >= 1 ? `${m} minutes` : `${Math.round(k.fuel)} seconds`;
};

export function kilnState(k: PlacedKiln): string {
  const heat = k.lit ? `firing, ${kilnBurnsFor(k)} of fuel` : k.fuel > 0 ? `laid and cold, ${kilnBurnsFor(k)} of fuel` : 'cold and empty';
  const work = k.jobs.length ? ` · ${k.jobs.length} inside` : '';
  const out = k.output.length ? ` · ${k.output.length} waiting` : '';
  return `QL ${k.ql.toFixed(0)} · ${heat}${work}${out}`;
}

type KilnTarget = Extract<Target, { kind: 'kiln' }>;
const kilnOf = (g: Game, t: Target): PlacedKiln | undefined => (t.kind === 'kiln' ? g.kilns.get((t as KilnTarget).id) : undefined);
const nearKiln = (g: Game, k: PlacedKiln): boolean => {
  const [cx, cy] = kilnCentre(k);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= 2.4;
};

export const KILN_ACTIONS: ActionDef[] = [
  {
    id: 'place_kiln',
    label: 'Set the kiln down',
    verb: 'setting the kiln down',
    hidden: true,
    stamina: 0.04,
    baseTime: 5,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return 'Choose a spot.';
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.find('kiln');
      if (!item || item.id !== 'kiln') return 'You are not carrying a kiln. Build one at the crafting window.';
      return g.kilnPlaceReason(t.x, t.y, t.sx, t.sy);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.find('kiln');
      if (!item || item.id !== 'kiln' || !g.inventory.remove(item.uid, 1)) return;
      const k = g.addKiln(t.x, t.y, t.sx, t.sy, item.ql);
      g.logMsg(`You set the kiln down on level ground. (QL ${k.ql.toFixed(1)}) Fill it with green ware, feed it and light it.`, 'event');
      g.events.emit('world', k.x, k.y);
    },
  },
  {
    id: 'pick_up_kiln',
    label: 'Take it up',
    verb: 'taking the kiln up',
    stamina: 0.04,
    baseTime: 5,
    applies: (t, g) => kilnOf(g, t) !== undefined,
    check: (t, g) => {
      const k = kilnOf(g, t);
      if (!k) return 'It is gone.';
      if (k.lit) return 'Not while it is alight.';
      if (k.jobs.length || k.output.length) return 'Empty it first.';
      if (Math.floor(k.ash ?? 0) >= 1) return 'Rake the ashes out first.';
      return null;
    },
    perform: (t, g) => {
      const k = kilnOf(g, t);
      if (!k || k.lit || k.jobs.length || k.output.length) return;
      g.removeKiln(k.id);
      g.inventory.add('kiln', { ql: k.ql });
      g.logMsg('You lift the kiln off its base and carry it away whole.', 'event');
      g.events.emit('world', k.x, k.y);
    },
  },
  {
    id: 'fuel_kiln',
    label: 'Fuel',
    verb: 'feeding the kiln',
    hidden: true,
    quantity: true,
    stamina: 0.01,
    baseTime: 1.5,
    applies: (t, g) => kilnOf(g, t) !== undefined,
    check: (t, g) => {
      const k = kilnOf(g, t);
      if (!k) return 'It is gone.';
      if (!nearKiln(g, k)) return 'Stand next to the kiln.';
      const item = t.kind === 'kiln' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isFuel(it.id));
      if (!item || !isFuel(item.id)) return 'A kiln burns wood and coal.';
      if (k.fuel >= FIRE_CAPACITY) return 'The firebox is full.';
      return null;
    },
    perform: (t, g) => {
      const k = kilnOf(g, t);
      if (!k || t.kind !== 'kiln') return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isFuel(it.id));
      if (!item || !isFuel(item.id)) return;
      const per = FUEL_VALUES[item.id];
      const fits = Math.max(1, Math.min(Math.min(t.count ?? 1, item.count), Math.ceil(Math.max(0, FIRE_CAPACITY - k.fuel) / per)));
      if (!g.inventory.remove(item.uid, fits)) return;
      k.fuel = Math.min(FIRE_CAPACITY, k.fuel + per * fits);
      g.events.emit('smelter');
      g.logMsg(`You feed ${fits > 1 ? `${fits} × ` : 'a '}${itemDef(item.id).name.toLowerCase()} into the kiln. ${kilnBurnsFor(k)} of fuel.`, 'event');
    },
  },
  {
    id: 'load_kiln',
    label: 'Fire in the kiln',
    verb: 'loading the kiln',
    skill: 'pottery',
    hidden: true,
    quantity: true,
    instant: true,
    stamina: 0.01,
    baseTime: 0,
    applies: (t, g) => kilnOf(g, t) !== undefined,
    check: (t, g) => {
      const k = kilnOf(g, t);
      if (!k) return 'It is gone.';
      if (!nearKiln(g, k)) return 'Stand next to the kiln.';
      const item = t.kind === 'kiln' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isGreenware(it.id));
      if (!item || !isGreenware(item.id)) return 'A kiln takes unfired clay.';
      if (k.jobs.length >= KILN_CAPACITY) return 'The kiln is packed as full as it will go.';
      return null;
    },
    perform: (t, g) => {
      const k = kilnOf(g, t);
      if (!k || t.kind !== 'kiln') return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.items.find((it) => isGreenware(it.id));
      const def = item && POTTERY_BY_UNFIRED.get(item.id);
      if (!item || !def) return;
      const n = Math.max(1, Math.min(Math.min(t.count ?? 1, item.count), KILN_CAPACITY - k.jobs.length));
      const taken = g.inventory.take(item.uid, n);
      if (!taken) return;
      const seconds = fireSeconds(def, k.ql);
      for (let i = 0; i < n; i++) k.jobs.push({ item: { ...taken, count: 1 }, makes: def.fired, left: seconds, total: seconds, ql: firedQl(taken.ql, k.ql) });
      g.events.emit('smelter');
      g.logMsg(`You pack ${n > 1 ? `${n} × ` : ''}${itemDef(taken.id).name.toLowerCase()} into the kiln. Each needs about ${Math.round(seconds)} seconds of heat.`, 'event');
    },
  },
  {
    id: 'light_kiln',
    label: 'Light',
    verb: 'lighting the kiln',
    stamina: 0.04,
    baseTime: 6,
    applies: (t, g) => kilnOf(g, t)?.lit === false,
    check: (t, g) => {
      const k = kilnOf(g, t);
      if (!k) return 'It is gone.';
      if (k.lit) return 'It is already firing.';
      if (k.fuel <= 0) return 'There is nothing in the firebox.';
      return null;
    },
    perform: (t, g) => {
      const k = kilnOf(g, t);
      if (!k || k.lit) return;
      k.lit = true;
      g.events.emit('smelter');
      g.events.emit('world', k.x, k.y);
      g.logMsg(`The kiln catches and begins to draw. It has ${kilnBurnsFor(k)} of fuel.`, 'event');
    },
  },
  {
    id: 'damp_kiln',
    label: 'Let it cool',
    verb: 'damping the kiln',
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => kilnOf(g, t)?.lit === true,
    perform: (t, g) => {
      const k = kilnOf(g, t);
      if (!k) return;
      k.lit = false;
      g.events.emit('smelter');
      g.events.emit('world', k.x, k.y);
      g.logMsg('You close the kiln down and let it cool. What is left of the fuel keeps.', 'event');
    },
  },
  {
    id: 'kiln_take_all',
    label: 'Take what is fired',
    verb: 'unpacking the kiln',
    stamina: 0.01,
    baseTime: 1,
    applies: (t, g) => kilnOf(g, t) !== undefined,
    check: (t, g) => {
      const k = kilnOf(g, t);
      if (!k) return 'It is gone.';
      return k.output.length ? null : 'Nothing is fired yet.';
    },
    perform: (t, g) => {
      const k = kilnOf(g, t);
      if (!k || !k.output.length) return;
      const taken = k.output.splice(0, k.output.length);
      for (const it of taken) g.inventory.addItem(it);
      g.events.emit('smelter');
      const names = taken.map((it) => (it.count > 1 ? `${it.count} × ${itemName(it).toLowerCase()}` : itemName(it).toLowerCase()));
      g.logMsg(`You unpack ${names.join(', ')} from the kiln.`, 'event');
    },
  },
  {
    id: 'take_ashes_kiln',
    label: 'Rake out the ashes',
    verb: 'raking out ashes',
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => {
      const h = kilnOf(g, t);
      return !!h && hasAshes(h);
    },
    check: (t, g) => {
      const h = kilnOf(g, t);
      if (!h) return 'It is gone.';
      if (!nearKiln(g, h)) return 'Stand next to the kiln.';
      return hasAshes(h) ? null : 'There are no ashes worth taking yet.';
    },
    perform: (t, g) => {
      const h = kilnOf(g, t);
      if (h) rakeAshes(g, h, 'kiln');
    },
  },
];

export const KILN_ACTION_BY_ID = new Map(KILN_ACTIONS.map((a) => [a.id, a]));
