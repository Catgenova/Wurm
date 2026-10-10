/**
 * The one curve both wells are filled to: favour (`faith.ts`), held by faith,
 * and Calm (`meditation.ts`), held by meditation.
 *
 * A leaf of its own because the two rulebooks cannot import each other:
 * `faith.ts` reaches the farm through the furniture, and the farm reads the
 * paths. The island's `favour_cap` is generated from these numbers and its
 * `calm_cap` is written over `favour_cap`, so all four cannot disagree.
 */

/** The most anybody holds, whatever their skill. */
export const WELL_CEILING = 120;
/** What the first point of the skill holds, and what each point after it adds. */
export const WELL_BASE = 25;
export const WELL_PER = 0.95;

/** How much this much skill will carry at once. */
export const wellCap = (level: number): number => Math.min(WELL_CEILING, WELL_BASE + level * WELL_PER);
