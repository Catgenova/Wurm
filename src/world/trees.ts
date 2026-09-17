import { hash2 } from './noise';
import { TREE_STAGE } from './tiles';

/**
 * A tree's own hour of the day, in seconds into it.
 *
 * A whole island turning over on the same instant is a forest that dies all at
 * once and comes back all at once, so each tile keeps its own hour — taken from
 * where it stands and the island's seed, which means it is the same answer
 * every time it is asked and nothing has to be written down to remember it.
 */
export const treePhase = (seed: number, x: number, y: number): number =>
  hash2(x, y, seed + 911) * TREE_STAGE;

/**
 * Whether a day of this tree's own turned between two moments, both in
 * seconds. The two sides ask this the same way off the same two numbers.
 */
export const treeDue = (seed: number, x: number, y: number, from: number, to: number): boolean =>
  Math.floor((to - treePhase(seed, x, y)) / TREE_STAGE)
  > Math.floor((from - treePhase(seed, x, y)) / TREE_STAGE);
