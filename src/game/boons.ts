import { ITEM_DEFS, itemDef } from './items';
import { SKILL_DEFS } from './skills';
import { world } from './pace';

/**
 * Two things that make the work go into you faster than it otherwise would.
 *
 * A night in a bed banks **rest**, which burns down while you work and makes
 * everything you do teach you twice as much until it is gone. A cooked dish
 * carries a **knack** for one trade, and eating it leaves you better at
 * that trade for a while. This is the same idea as the knack a long day at a
 * trade leaves behind, except that this one wears off. Which dish favours which trade is settled when the
 * island is raised and never changes on it — no two islands agree, and the
 * only way to find out is to look at the food.
 */
export interface Boon {
  /** Skill it lifts. */
  skill: string;
  /** Added to the rate that skill goes in at: 0.25 is a quarter again. */
  bonus: number;
  /** Game time it runs out at. */
  until: number;
  /** What gave it, for the hud. */
  from: string;
}

/** The most rest that will stay banked: an hour of it, and no more. */
export const REST_CAP = 3600;
/** What rest is worth while it burns. */
export const REST_MULT = 2;
/** How much of a night's sleep is banked as rest, at a perfect bed. */
export const REST_PER_SECOND = 0.5;

/** What a dish's knack is worth, and how long the best of them carries it. */
export const BOON_BONUS = 0.5;
export const BOON_SECONDS = world(20 * 60);

/** The trades a dish can favour: the ones you work at, not the ones you are. */
export const BOON_SKILLS: string[] = SKILL_DEFS.filter((d) => d.group !== 'Characteristics').map((d) => d.id);

/** Everything cooked, which is everything that can carry a knack. */
export const BOON_FOODS: string[] = Object.keys(ITEM_DEFS).filter((id) => nourishing(ITEM_DEFS[id]));

/** Anything eaten or drunk that is worth a knack: not plain water. */
function nourishing(def: { category?: string; food?: number; drink?: number }): boolean {
  return def.category === 'food' && ((def.food ?? 0) > 0 || (def.drink ?? 0) > 0);
}

/** A small, stable scramble, so an island's table is its own and never moves. */
function hash(seed: number, id: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Which trade this dish favours on this island. */
export const boonOf = (seed: number, itemId: string): string | null => {
  const def = ITEM_DEFS[itemId];
  if (!def || !nourishing(def)) return null;
  return BOON_SKILLS[hash(seed, itemId) % BOON_SKILLS.length];
};

/** How long a helping of it holds, by how good a helping it was. */
export const boonTime = (itemId: string, ql: number): number => {
  const def = itemDef(itemId);
  // Something brewed sits with you far longer than something eaten.
  const body = (def.food ?? 0) + (def.drink ?? 0) * 2.4;
  return Math.round(BOON_SECONDS * Math.min(2.5, body * 2.2) * (0.4 + Math.min(100, ql) / 140));
};

/** Minutes and seconds, the way a clock would put it. */
export function clockLeft(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m >= 1 ? `${m}m` : `${s}s`;
}
