/**
 * What is actually in a meal.
 *
 * Filling the food bar takes a raw potato. Eating *well* is a different
 * question, and this is it: four things a body wants, each kept separately,
 * each fed by different food and each falling away on its own. Raw food feeds
 * one of them a little. A cooked dish feeds several, and feeds them properly,
 * which is what the whole kitchen is for.
 *
 * Being well fed makes hunger and thirst come on slower. Being well fed **in
 * all four** makes everything you do teach you more — and that one reads off
 * the *worst* of the four, so a week of nothing but bread buys you nothing.
 */
export type Nutrient = 'starch' | 'flesh' | 'fat' | 'greens';

export const NUTRIENTS: Nutrient[] = ['starch', 'flesh', 'fat', 'greens'];

export const NUTRIENT_NAMES: Record<Nutrient, string> = {
  starch: 'Starch',
  flesh: 'Flesh',
  fat: 'Fat',
  greens: 'Greens',
};

/** What feeds each, for anything that has to explain itself. */
export const NUTRIENT_NOTES: Record<Nutrient, string> = {
  starch: 'bread, porridge, roots and grain',
  flesh: 'meat and fish, cooked for twice the good',
  fat: 'oil, nuts, cheese and what is fried in them',
  greens: 'vegetables, fruit and berries',
};

/** A body with nothing in it. */
export const emptyNutrition = (): Record<Nutrient, number> => ({ starch: 0, flesh: 0, fat: 0, greens: 0 });

/** Seconds a full measure takes to fall away to nothing. */
export const NUTRIENT_HOURS = 50 * 60;
export const NUTRIENT_DECAY = 1 / NUTRIENT_HOURS;

/** The most of hunger and thirst that eating well holds off. */
export const KEPT_BEST = 0.4;
/** The most a table with all four on it is worth on what you learn. */
export const TABLE_BEST = 0.2;

/** How well fed you are in general: the average of the four. */
export const fedness = (n: Record<Nutrient, number>): number =>
  NUTRIENTS.reduce((sum, k) => sum + Math.max(0, Math.min(1, n[k])), 0) / NUTRIENTS.length;

/** How well fed you are in the *worst* of the four, which is what a diet is judged on. */
export const balance = (n: Record<Nutrient, number>): number =>
  NUTRIENTS.reduce((low, k) => Math.min(low, Math.max(0, Math.min(1, n[k]))), 1);

/** What hunger and thirst fall by, against their ordinary pace. */
export const upkeepMul = (n: Record<Nutrient, number>): number => 1 - KEPT_BEST * fedness(n);

/** What everything you do teaches you, against its ordinary rate. */
export const tableMul = (n: Record<Nutrient, number>): number => 1 + TABLE_BEST * balance(n);

/** How well a body is doing, in a word. */
export const fedWord = (n: Record<Nutrient, number>): string => {
  const b = balance(n);
  if (b >= 0.95) return 'wanting for nothing';
  if (b >= 0.7) return 'eating well';
  if (b >= 0.4) return 'eating plainly';
  if (b >= 0.15) return 'living on scraps';
  return 'living on what comes';
};

/**
 * How much of a helping actually goes in. A thing made well is worth more
 * than the same thing made badly, which is the other half of why quality in
 * the kitchen is worth having.
 */
export const helpingOf = (ql: number): number => 0.55 + Math.max(1, Math.min(100, ql)) / 220;
