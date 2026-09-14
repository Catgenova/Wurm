import { ITEM_DEFS, itemDef } from './items';
import { SKILL_DEFS } from './skills';

/**
 * Two things that make the work go into you faster than it otherwise would.
 *
 * A night in a bed banks **rest**, which burns down while you work and makes
 * everything you do teach you twice as much until it is gone. A cooked dish
 * carries an **affinity** for one trade, and eating it leaves you better at
 * that trade for a while. Which dish favours which trade is settled when the
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

/** What an affinity is worth, and how long the best dish carries it. */
export const AFFINITY_BONUS = 0.5;
export const AFFINITY_SECONDS = 20 * 60;

/** The trades a dish can favour: the ones you work at, not the ones you are. */
export const AFFINITY_SKILLS: string[] = SKILL_DEFS.filter((d) => d.group !== 'Characteristics').map((d) => d.id);

/** Everything cooked, which is everything that can carry an affinity. */
export const AFFINITY_FOODS: string[] = Object.keys(ITEM_DEFS).filter((id) => {
  const def = ITEM_DEFS[id];
  return !!def.food && def.category === 'food';
});

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
export const affinityOf = (seed: number, itemId: string): string | null => {
  const def = ITEM_DEFS[itemId];
  if (!def?.food || def.category !== 'food') return null;
  return AFFINITY_SKILLS[hash(seed, itemId) % AFFINITY_SKILLS.length];
};

/** How long a helping of it holds, by how good a helping it was. */
export const affinityTime = (itemId: string, ql: number): number =>
  Math.round(AFFINITY_SECONDS * Math.min(1.5, (itemDef(itemId).food ?? 0) * 2.2) * (0.4 + Math.min(100, ql) / 140));

/** Minutes and seconds, the way a clock would put it. */
export function clockLeft(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m >= 1 ? `${m}m` : `${s}s`;
}
