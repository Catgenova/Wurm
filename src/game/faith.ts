import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { furnitureCentre, furnitureDef, type PlacedFurniture } from './furniture';
import { itemName, type Item } from './items';
import { world, worldRate } from './pace';
import { capital, spanWords, times } from './words';

/**
 * An altar, and what it is worth to have one.
 *
 * There is no god on this island with a name, and nobody here would claim to
 * know one. There is a stone table, there is the hour before the sun is
 * properly up, and there is the plain fact that a thing knelt over at dawn
 * comes out better than a thing that was not. Whether that is anybody's doing
 * is not a question the work answers.
 *
 * What a prayer banks is **favour**, and favour is spent on a handful of
 * things none of which can be had any other way: a tool that works better
 * than it was made, a wound closed in a breath, a fair wind, a field brought
 * on a week in a moment.
 */

export const FAITH = 'prayer';

/**
 * Favour comes back on its own, slowly, up to what your faith carries.
 *
 * A rate rather than a duration, so it is *divided* by the world's pace: leave
 * it alone and the well fills just as fast as it always did, and nothing has
 * been slowed at all. The one place a multiplication would have been exactly
 * backwards.
 */
export const FAVOUR_TRICKLE = worldRate(0.004);
/** What a prayer at an altar is worth, before the hour and the stone are counted. */
export const PRAYER_FAVOUR = 22;
/** How long between prayers that are worth anything: most of an island day. */
export const PRAYER_REST = world(16 * 60);
/** The most favour anybody holds, whatever their faith. */
export const FAVOUR_CEILING = 120;

/** How much favour this much faith will carry at once. */
export const favourCap = (faith: number): number => Math.min(FAVOUR_CEILING, 25 + faith * 0.95);

/**
 * The two hours of the clock a prayer is worth most at, how many hours either
 * side it tapers over, what it is worth well away from both, and what the
 * best of them adds. The island's `pray` keeps the same two hours.
 */
export const PRAYER_PEAKS = [6, 20] as const;
export const PRAYER_TAPER = 3;
export const PRAYER_BASE = 0.55;
export const PRAYER_LIFT = 0.75;

/** What the hour does to a prayer. */
export const prayerHour = (hour: number): number =>
  PRAYER_BASE + Math.max(...PRAYER_PEAKS.map((p) => Math.max(0, 1 - Math.abs(hour - p) / PRAYER_TAPER))) * PRAYER_LIFT;

/** An altar is worth more the better it was built, and those two hours are worth more than noon. */
export const prayerWorth = (altarQl: number, hour: number, faith: number): number =>
  PRAYER_FAVOUR * prayerHour(hour) * (0.6 + altarQl / 200) * (0.7 + faith / 220);

export interface CastDef {
  id: string;
  name: string;
  /** Favour it costs. */
  cost: number;
  /** Faith it takes before it will work at all. */
  level: number;
  /** What it wants pointed at: an item in the pack, or nothing. */
  on: 'item' | 'self';
  note: string;
}

/** The most times one tool will take the circle. */
export const BLESS_CAP = 3;
/** What each blessing is worth to the working quality of a tool, in per cent. */
export const BLESS_STEP = 9;
/** How long a fair wind holds behind you, in seconds of the clock. */
export const FAIR_WIND = 6 * 60;

export const CASTS: CastDef[] = [
  {
    id: 'call',
    name: 'Call',
    cost: 12,
    level: 3,
    on: 'self',
    note: 'Whatever travels with you is beside you again, from wherever it had got to.',
  },
  {
    id: 'mend',
    name: 'Mend',
    cost: 18,
    level: 8,
    on: 'item',
    note: 'Every mark of use comes off one thing at once, as though it were off the bench this morning.',
  },
  {
    id: 'dawnlight',
    name: 'Light of the dawn',
    cost: 26,
    level: 16,
    on: 'self',
    note: 'Everything open on you closes, and anything that had gone bad is clean.',
  },
  {
    id: 'cunning',
    name: 'Circle of cunning',
    cost: 34,
    level: 24,
    on: 'item',
    note: `A tool comes out of it working ${BLESS_STEP}% better than it was ever made to, and stays that way. ${capital(times(BLESS_CAP))} is as far as anything will take it.`,
  },
  {
    id: 'fairwind',
    name: 'Fair wind',
    cost: 30,
    level: 30,
    on: 'self',
    note: `The wind comes round behind wherever you are pointed and holds there ${spanWords(FAIR_WIND)}.`,
  },
  {
    id: 'bounty',
    name: 'Bounty',
    cost: 44,
    level: 40,
    on: 'self',
    note: 'Every field on the settlement comes on a stage, all at once, in front of you.',
  },
];
export const CAST_BY_ID = new Map(CASTS.map((c) => [c.id, c]));

/** What the blessings on a thing are worth, as a multiplier on what it is worth working. */
export const blessBonus = (n: number | undefined): number => 1 + Math.min(BLESS_CAP, n ?? 0) * (BLESS_STEP / 100);

const isAltar = (f: PlacedFurniture): boolean => !!furnitureDef(f.kind).altar;
const pieceOf = (g: Game, t: Target): PlacedFurniture | undefined => (t.kind === 'furniture' ? g.furniture.get(t.id) : undefined);
const nearPiece = (g: Game, f: PlacedFurniture): boolean => {
  const [cx, cy] = furnitureCentre(f);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= 2.4;
};

/** The altar within reach, if there is one. */
export function altarNear(g: Game): PlacedFurniture | undefined {
  for (const f of g.furniture.values()) {
    if (!isAltar(f)) continue;
    const [cx, cy] = furnitureCentre(f);
    if (Math.hypot(cx - g.player.x, cy - g.player.y) <= 2.4) return f;
  }
  return undefined;
}

/** Why this cast will not go, or null. */
export function castReason(g: Game, def: CastDef, item?: Item): string | null {
  if (g.skills.get(FAITH) < def.level) return `${def.name} takes ${def.level} prayer; you have ${g.skills.get(FAITH).toFixed(0)}.`;
  if (g.player.favour < def.cost) return `${def.name} costs ${def.cost} favour; you hold ${Math.floor(g.player.favour)}. Pray at an altar.`;
  if (def.on === 'item' && !item) return 'Choose something to lay it on.';
  if (def.id === 'mend' && item && item.dmg <= 0) return `There is nothing wrong with the ${itemName(item).toLowerCase()}.`;
  if (def.id === 'cunning' && item) {
    if ((item.bless ?? 0) >= BLESS_CAP) return `The ${itemName(item).toLowerCase()} has taken all it will take.`;
    if (item.issued) return 'What you washed ashore with has nothing in it to work on.';
  }
  if (def.id === 'call' && !g.creatures.active()) return 'Nothing travels with you.';
  if (def.id === 'dawnlight' && !g.player.wounds.length) return 'Nothing is open on you.';
  if (def.id === 'bounty' && !g.deed) return 'You have no settlement, and so no fields.';
  return null;
}

/** Work one cast. Returns what it did, for the log. */
export function doCast(g: Game, def: CastDef, item?: Item): string {
  g.player.favour = Math.max(0, g.player.favour - def.cost);
  g.gainSkill(FAITH, 0.6);
  g.note(`cast:${def.id}`);
  switch (def.id) {
    case 'call': {
      const c = g.creatures.active();
      if (c) {
        c.x = g.player.x + 0.6;
        c.y = g.player.y;
        c.state = 'idle';
        c.enemy = null;
        g.events.emit('creature');
        return `${c.name} is beside you, and gives no sign of having travelled.`;
      }
      return 'Nothing comes.';
    }
    case 'mend': {
      if (!item) return 'Nothing to mend.';
      item.dmg = 0;
      g.events.emit('inventory');
      return `Every mark of use goes out of the ${itemName(item).toLowerCase()}.`;
    }
    case 'dawnlight': {
      const n = g.player.wounds.length;
      g.player.wounds = [];
      g.player.stats.health = Math.min(1, g.player.stats.health + 0.25);
      return n === 1 ? 'The wound closes over, and what had gone bad is clean.' : `All ${n} of them close over, and what had gone bad is clean.`;
    }
    case 'cunning': {
      if (!item) return 'Nothing to work on.';
      item.bless = Math.min(BLESS_CAP, (item.bless ?? 0) + 1);
      g.events.emit('inventory');
      return `The ${itemName(item).toLowerCase()} comes out of it working ${Math.round((blessBonus(item.bless) - 1) * 100)}% better than it was made. (${item.bless} of ${BLESS_CAP})`;
    }
    case 'fairwind': {
      g.favourWind = g.time + FAIR_WIND;
      return 'The wind comes round behind you and settles there.';
    }
    case 'bounty': {
      const n = g.hastenCrops();
      return n ? `Every field on the settlement comes on a stage: ${n} of them.` : 'Nothing is in the ground to come on.';
    }
    default:
      return 'Nothing happens.';
  }
}

const itemOf = (g: Game, t: Target): Item | undefined => (t.kind === 'item' ? g.inventory.get(t.uid) : undefined);

/** Which cast a target is asking for, carried on the target itself. */
const castOf = (t: Target): CastDef | undefined => (t.kind === 'item' || t.kind === 'tile' ? CAST_BY_ID.get((t as { spell?: string }).spell ?? '') : undefined);

export const FAITH_ACTIONS: ActionDef[] = [
  {
    id: 'cast',
    label: 'Call on it',
    verb: 'calling on it',
    hidden: true,
    skill: FAITH,
    stamina: 0.03,
    baseTime: 6,
    applies: () => true,
    labelFor: (t) => castOf(t)?.name ?? 'Call on it',
    check: (t, g) => {
      const def = castOf(t);
      if (!def) return 'Choose what to call for.';
      return castReason(g, def, itemOf(g, t));
    },
    perform: (t, g) => {
      const def = castOf(t);
      if (!def) return;
      const item = itemOf(g, t);
      if (castReason(g, def, item)) return;
      g.logMsg(doCast(g, def, item), 'event');
    },
  },
  {
    id: 'pray',
    label: 'Pray',
    verb: 'praying',
    skill: FAITH,
    stamina: 0.02,
    baseTime: 14,
    applies: (t, g) => {
      const f = pieceOf(g, t);
      return !!f && isAltar(f);
    },
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (!nearPiece(g, f)) return 'Kneel at the altar.';
      const rest = g.player.prayedAt + PRAYER_REST - g.time;
      if (rest > 0) return `You have said what you had to say today. ${Math.ceil(rest / 60)} minutes.`;
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return;
      const faith = g.skills.get(FAITH);
      const hour = g.hourOfDay();
      const gained = prayerWorth(f.ql, hour, faith);
      const cap = favourCap(faith);
      const before = g.player.favour;
      g.player.favour = Math.min(cap, before + gained);
      g.player.prayedAt = g.time;
      g.gainSkill(FAITH, 1.4);
      g.note('prayed');
      const dawn = Math.abs(hour - 6) < 2 || Math.abs(hour - 20) < 2;
      g.logMsg(
        `${dawn ? 'You kneel in the half light and it goes better than it usually does.' : 'You kneel at the stone.'} Favour ${Math.floor(g.player.favour)} of ${Math.floor(cap)}.`,
        'event',
      );
    },
  },
];
