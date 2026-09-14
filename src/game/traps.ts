import type { ActionDef, Target } from './actions';
import { SUBTILES } from './crates';
import type { Game } from './game';
import { isBaitFor, SPECIES, type Creature } from './creatures';
import { itemDef, itemName, type Item } from './items';
import { BAIT_BY_ID, isBait } from './fishing';
import { matOf } from './materials';

/**
 * Traps.
 *
 * Everything on this island that has been taken so far has been taken by
 * hand: you stand in front of a wild thing with a berry out and hope. A trap
 * is the other way of doing it. You set it, you bait it, you walk away, and
 * whatever comes to the bait while you are somewhere else is waiting for you
 * when you come back — alive, and with whatever blood it was born with still
 * in it, which is the point now that blood is worth something.
 *
 * Two of them. A **snare** is a noose of rope on a bent shaft: it costs
 * almost nothing, it takes the small and the timid, and anything heavier
 * walks off with it. A **deadfall** is a weighted board on a trigger: it will
 * hold most of what walks, and it is a great deal more work to build.
 */

export type TrapKind = 'snare' | 'deadfall' | 'creel';

export interface TrapDef {
  id: TrapKind;
  name: string;
  /** What it is built from. */
  bill: Array<[string, number]>;
  difficulty: number;
  time: number;
  /** The stiffest taming level it will hold. Anything warier walks off with it. */
  holds: number;
  /** How far from it the bait carries, in tiles. */
  reach: number;
  /** Base chance per check that something in reach comes to it. */
  odds: number;
  /** Seconds it stands out in the weather at quality one and at a hundred. */
  lifeMin: number;
  lifeMax: number;
  /** Goes in the water and takes fish rather than standing on land and taking beasts. */
  water?: boolean;
  /** The most fish one of these holds before it stops taking any. */
  hold?: number;
  note: string;
}

export const TRAPS: Record<TrapKind, TrapDef> = {
  snare: {
    id: 'snare',
    name: 'Snare',
    bill: [['rope', 1], ['shaft', 2]],
    difficulty: 8,
    time: 6,
    holds: 20,
    reach: 7,
    odds: 0.3,
    lifeMin: 20 * 60,
    lifeMax: 90 * 60,
    note: 'A noose of rope on a bent shaft. It takes the small and the trusting; anything with weight in it walks off wearing the rope.',
  },
  creel: {
    id: 'creel',
    name: 'Creel',
    bill: [['reed', 14], ['rope', 1]],
    difficulty: 16,
    time: 16,
    holds: 0,
    reach: 0,
    odds: 0.34,
    lifeMin: 40 * 60,
    lifeMax: 3 * 60 * 60,
    water: true,
    hold: 8,
    note: 'A woven basket with a throat turned inward, so what swims in stays in. It sits in the water and works while you are elsewhere.',
  },
  deadfall: {
    id: 'deadfall',
    name: 'Deadfall',
    bill: [['plank', 3], ['shaft', 2], ['rope', 2], ['nail', 6]],
    difficulty: 26,
    time: 14,
    holds: 60,
    reach: 10,
    odds: 0.22,
    lifeMin: 45 * 60,
    lifeMax: 4 * 60 * 60,
    note: 'A weighted board on a trigger, propped over the bait. It will hold very nearly anything that walks, and it is a day’s work to build one.',
  },
};

export interface PlacedTrap {
  id: number;
  /** What you have called it, when you have called it anything. */
  name?: string;
  x: number;
  y: number;
  /** Subtile it is set on, 0..3 each way. */
  sx: number;
  sy: number;
  kind: TrapKind;
  ql: number;
  /** How far gone it is; at a hundred it has rotted through. */
  dmg: number;
  /** What is laid in it, or null for an unbaited trap, which catches nothing. */
  bait: Item | null;
  /** The wildermon held in it, if it has sprung. */
  caught: number | null;
  /** Game time of the next roll. */
  checkAt: number;
  /** What has swum into it, for a creel. */
  fish?: Item[];
  /** The wood it was made of. */
  material?: string;
}

const clampQl = (ql: number): number => Math.max(1, Math.min(100, ql));
export const trapDef = (t: PlacedTrap): TrapDef => TRAPS[t.kind] ?? TRAPS.snare;
/** How long one of these stands, in seconds, at this quality. */
export const trapLife = (kind: TrapKind, ql: number): number => {
  const d = TRAPS[kind] ?? TRAPS.snare;
  return d.lifeMin + ((clampQl(ql) - 1) / 99) * (d.lifeMax - d.lifeMin);
};
export const trapDecayRate = (t: PlacedTrap): number => 100 / trapLife(t.kind, t.ql);
export const trapLeft = (t: PlacedTrap): number => Math.max(0, trapLife(t.kind, t.ql) * (1 - t.dmg / 100));
export const trapCentre = (t: PlacedTrap): [number, number] => [t.x + (t.sx + 0.5) / SUBTILES, t.y + (t.sy + 0.5) / SUBTILES];
export const trapName = (t: PlacedTrap): string =>
  t.name ? t.name : t.material ? `${trapDef(t).name} (${t.material.toLowerCase()})` : trapDef(t).name;

/** How often a set trap is rolled, in seconds. */
export const CHECK_EVERY = 45;

/** What it will hold, once the build quality is counted in. */
export const trapHolds = (t: PlacedTrap): number => Math.round(trapDef(t).holds * (0.6 + clampQl(t.ql) / 250));

/**
 * The odds one roll catches something. A well-made trap catches more; a
 * trusting animal walks in and a wary one does not; and a timid creature,
 * which is the very thing you cannot walk up to, is the easiest of all to
 * take this way.
 */
export function catchChance(t: PlacedTrap, c: Creature): number {
  const def = TRAPS[t.kind] ?? TRAPS.snare;
  const s = SPECIES[c.species];
  if (!s) return 0;
  const quality = 0.5 + clampQl(t.ql) / 140;
  const wary = Math.max(0.15, 1 - s.tameLevel / (trapHolds(t) * 1.8));
  const timid = s.timid ? 1.5 : s.hunter ? 0.6 : 1;
  return Math.min(0.9, def.odds * quality * wary * timid);
}

/** What it says it is doing, for the menu and the log. */
export function trapState(t: PlacedTrap, g: Game): string {
  if (trapDef(t).water) {
    const n = (t.fish ?? []).reduce((a, f) => a + f.count, 0);
    const left = Math.ceil(trapLeft(t) / 60);
    return `${n ? `${n} in it` : 'empty'} \u00b7 ${t.bait ? `baited with ${itemName(t.bait).toLowerCase()}` : 'not baited'} \u00b7 ${left}m left`;
  }
  if (t.caught !== null) {
    const c = g.creatures.get(t.caught);
    if (c) return `${SPECIES[c.species]?.name ?? 'Something'} in it`;
  }
  const left = trapLeft(t);
  const mins = Math.ceil(left / 60);
  const when = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
  return t.bait ? `set and baited with ${itemName(t.bait).toLowerCase()} · ${when}` : `set but not baited · ${when}`;
}

type TrapTarget = Extract<Target, { kind: 'trap' }>;
const trapOf = (g: Game, t: Target): PlacedTrap | undefined => (t.kind === 'trap' ? g.traps.get((t as TrapTarget).id) : undefined);
const nearTrap = (g: Game, t: PlacedTrap): boolean => {
  const [cx, cy] = trapCentre(t);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= 2.4;
};

/** Anything in the pack some wild thing would come to. */
export const baitInPack = (g: Game, t?: PlacedTrap): Item[] => {
  // A creel is baited with what fish come to; a land trap with what beasts eat.
  if (t && trapDef(t).water) return g.inventory.items.filter((it) => isBait(it.id));
  return g.inventory.items.filter((it) => Object.values(SPECIES).some((s) => isBaitFor(s, it.id)));
};

export const TRAP_ACTIONS: ActionDef[] = [
  {
    id: 'set_trap',
    label: 'Set it',
    verb: 'setting the trap',
    hidden: true,
    stamina: 0.03,
    baseTime: 4,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return 'Choose a spot.';
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
      if (!item || !(item.id in TRAPS)) return 'You have no trap to set.';
      return g.trapPlaceReason(t.x, t.y, t.sx, t.sy, item.id as TrapKind);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
      if (!item || !(item.id in TRAPS) || !g.inventory.remove(item.uid, 1)) return;
      const trap = g.addTrap(item.id as TrapKind, t.x, t.y, t.sx, t.sy, item.ql, item.extra);
      const mins = Math.round(trapLife(trap.kind, trap.ql) / 60);
      g.logMsg(
        trapDef(trap).water
          ? `You sink the ${trapName(trap).toLowerCase()} and make the line fast. It will fish about ${mins} minutes and holds ${trapDef(trap).hold ?? 8}. Bait it.`
          : `You set the ${trapName(trap).toLowerCase()} and cover the sign of it. It will stand about ${mins} minutes and will hold anything up to taming ${trapHolds(trap)}. Bait it.`,
        'event',
      );
      g.events.emit('world', trap.x, trap.y);
    },
  },
  {
    id: 'bait_trap',
    label: 'Bait it',
    verb: 'baiting the trap',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const trap = trapOf(g, t);
      return !!trap && trap.caught === null;
    },
    labelFor: (t, g) => {
      const bait = baitInPack(g)[0];
      return bait ? `Bait it with ${itemName(bait).toLowerCase()}` : 'Bait it';
    },
    check: (t, g) => {
      const trap = trapOf(g, t);
      if (!trap) return 'It is gone.';
      if (trap.caught !== null) return 'There is something in it already.';
      if (!nearTrap(g, trap)) return 'Stand at the trap.';
      if (!baitInPack(g, trap).length) return trapDef(trap).water ? 'You have nothing a fish would come to. Dig worms, or use corn, meat or a small fish.' : 'You have nothing anything would come to. Carry a berry, a vegetable, a nut, a spice.';
      return null;
    },
    perform: (t, g) => {
      const trap = trapOf(g, t);
      const bait = baitInPack(g, trap)[0];
      if (!trap || !bait) return;
      const one = g.inventory.take(bait.uid, 1);
      if (!one) return;
      // Whatever was in it goes back in the pack rather than on the ground.
      if (trap.bait) g.inventory.addItem(trap.bait);
      trap.bait = one;
      trap.checkAt = g.time + CHECK_EVERY;
      if (trapDef(trap).water) {
        const b = BAIT_BY_ID.get(one.id);
        g.logMsg(`You put the ${itemName(one).toLowerCase()} in the creel and sink it again. ${b ? b.note : ''}`, 'event');
      } else {
        const comers = Object.values(SPECIES).filter((s) => isBaitFor(s, one.id) && s.tameLevel <= trapHolds(trap));
        g.logMsg(
          `You lay the ${itemName(one).toLowerCase()} in the ${trapName(trap).toLowerCase()}. ${comers.length ? `${comers.length === 1 ? 'One sort' : `${comers.length} sorts`} would come to that.` : 'Nothing this trap will hold eats that.'}`,
          'event',
        );
      }
      g.events.emit('world', trap.x, trap.y);
    },
  },
  {
    id: 'take_catch',
    label: 'Take what is in it',
    verb: 'taking it out of the trap',
    skill: 'taming',
    stamina: 0.05,
    baseTime: 8,
    applies: (t, g) => trapOf(g, t)?.caught !== null && trapOf(g, t) !== undefined,
    labelFor: (t, g) => {
      const trap = trapOf(g, t);
      const c = trap?.caught !== null && trap ? g.creatures.get(trap.caught as number) : undefined;
      return c ? `Take the ${SPECIES[c.species]?.name.toLowerCase() ?? 'catch'} out` : 'Take what is in it';
    },
    check: (t, g) => {
      const trap = trapOf(g, t);
      if (!trap) return 'It is gone.';
      if (trap.caught === null) return 'There is nothing in it.';
      const c = g.creatures.get(trap.caught);
      if (!c) return 'Whatever was in it is gone.';
      if (!nearTrap(g, trap)) return 'Stand at the trap.';
      const s = SPECIES[c.species];
      if (s && g.skills.get('taming') < s.tameLevel) return `A ${s.name.toLowerCase()} takes taming ${s.tameLevel} to handle, trapped or not. It is held; come back when you can.`;
      if (!g.deed && g.creatures.active()) return 'You have a companion at your side and no settlement to send this one to.';
      return null;
    },
    perform: (t, g) => {
      const trap = trapOf(g, t);
      if (!trap || trap.caught === null) return;
      const c = g.creatures.get(trap.caught);
      if (!c) return;
      const s = SPECIES[c.species];
      // It is held, not willing. Getting it out without being bitten is the skill.
      const clean = g.skillCheck('taming', s ? s.tameLevel + 10 : 10, trap.ql, g.mindEase());
      g.gainSkill('taming', 1.1);
      if (!clean) {
        g.logMsg(`The ${s?.name.toLowerCase() ?? 'thing'} thrashes and you cannot get a hand on it. It is still held.`, 'error');
        return;
      }
      c.trapped = null;
      trap.caught = null;
      trap.bait = null;
      c.state = 'idle';
      c.enemy = null;
      if (!g.creatures.active()) {
        c.mode = 'active';
        g.logMsg(`You get the noose off the ${s?.name.toLowerCase() ?? 'thing'} and it stays. It comes with you.`, 'event');
      } else if (g.deed) {
        c.mode = 'stored';
        c.x = g.deed.x + 0.5;
        c.y = g.deed.y + 1.5;
        g.logMsg(`You get it out of the trap and walk it home to the token of ${g.deed.name}.`, 'event');
      }
      g.note('trapped');
      g.events.emit('creature');
      g.events.emit('world', trap.x, trap.y);
    },
  },
  {
    id: 'free_catch',
    label: 'Let it go',
    verb: 'letting it go',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const trap = trapOf(g, t);
      return !!trap && trap.caught !== null;
    },
    check: (t, g) => {
      const trap = trapOf(g, t);
      if (!trap || trap.caught === null) return 'There is nothing in it.';
      if (!nearTrap(g, trap)) return 'Stand at the trap.';
      return null;
    },
    perform: (t, g) => {
      const trap = trapOf(g, t);
      if (!trap || trap.caught === null) return;
      g.springTrap(trap, 'You lift the board and it is gone into the grass before you have straightened up.');
    },
  },
  {
    id: 'empty_creel',
    label: 'Empty it',
    verb: 'emptying the creel',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => {
      const trap = trapOf(g, t);
      return !!trap && !!trapDef(trap).water && (trap.fish ?? []).length > 0;
    },
    labelFor: (t, g) => {
      const trap = trapOf(g, t);
      const n = (trap?.fish ?? []).reduce((a, f) => a + f.count, 0);
      return n ? `Empty it (${n} fish)` : 'Empty it';
    },
    check: (t, g) => {
      const trap = trapOf(g, t);
      if (!trap) return 'It is gone.';
      if (!(trap.fish ?? []).length) return 'There is nothing in it yet.';
      if (!nearTrap(g, trap)) return 'Stand at the creel.';
      return null;
    },
    perform: (t, g) => {
      const trap = trapOf(g, t);
      if (!trap || !trap.fish?.length) return;
      const parts: string[] = [];
      for (const f of trap.fish) {
        g.inventory.addItem(f);
        parts.push(`${f.count} \u00d7 ${itemDef(f.id).name.toLowerCase()}`);
      }
      trap.fish = [];
      g.note('creeled');
      g.gainSkill('fishing', 0.5);
      g.logMsg(`You lift the creel and tip it out: ${parts.join(', ')}.`, 'event');
      g.events.emit('world', trap.x, trap.y);
    },
  },
  {
    id: 'pick_up_trap',
    label: 'Take it up',
    verb: 'taking the trap up',
    stamina: 0.03,
    baseTime: 3,
    applies: (t, g) => trapOf(g, t) !== undefined,
    check: (t, g) => {
      const trap = trapOf(g, t);
      if (!trap) return 'It is gone.';
      if (trap.caught !== null) return 'Deal with what is in it first.';
      if (!nearTrap(g, trap)) return 'Stand at the trap.';
      return null;
    },
    perform: (t, g) => {
      const trap = trapOf(g, t);
      if (!trap) return;
      if (trap.bait) g.inventory.addItem(trap.bait);
      for (const f of trap.fish ?? []) g.inventory.addItem(f);
      const back = g.inventory.add(trap.kind, { ql: trap.ql, extra: trap.material });
      back.dmg = trap.dmg;
      g.removeTrap(trap.id);
      g.logMsg(`You take the ${trapName(trap).toLowerCase()} up${trap.bait ? ' and pocket the bait' : ''}.`, 'event');
      g.events.emit('world', trap.x, trap.y);
    },
  },
];

/** Every trap recipe, one per sort, built from the book above. */
export const TRAP_BILL = (kind: TrapKind): string =>
  TRAPS[kind].bill.map(([id, n]) => `${n} ${itemDef(id).name.toLowerCase()}`).join(', ');
/** What the wood it was cut from is worth to it: a stiff wood holds better. */
export const trapStrength = (t: PlacedTrap): number => matOf(t.material).hold;
