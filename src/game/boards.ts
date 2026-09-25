/**
 * What the island's leaderboards rank by.
 *
 * Both sides read these. `BOARD_TOP` and `GRADE_STEP` reach the island as
 * `board_top()` and `grade_step(tier)` through `npm run defs`, so the order
 * `rpc_boards` puts things in and the line the Leaderboards window prints over
 * it are one set of numbers.
 */
import { GRADE_STEP, traitOf } from './traits';
import { SKILL_DEFS } from './skills';

/** How many places each board has: per skill, for wildermon, and for settlements. */
export const BOARD_TOP = 10;

/**
 * What a wildermon scores on the best-bred board: each trait it carries
 * counted at its grade's step, added up. The steps are the ones a trait's
 * worth climbs by, so the board ranks blood the way the blood itself pays.
 */
export const bredScore = (traits: readonly string[]): number =>
  traits.reduce((n, id) => {
    const t = traitOf(id);
    return t ? n + GRADE_STEP[t.tier] : n;
  }, 0);

/**
 * Your best skill, for the window to open on and for the game you play by
 * yourself: the highest you have raised above where it starts, characteristics
 * not counted. Every characteristic but one starts at twenty and every other
 * skill at one, so counting them would name a characteristic as every
 * newcomer's best.
 */
export function bestSkill(get: (id: string) => number): { id: string; value: number } | null {
  let best: { id: string; value: number } | null = null;
  for (const d of SKILL_DEFS) {
    if (d.group === 'Characteristics') continue;
    const v = get(d.id);
    if (v > d.start && (!best || v > best.value)) best = { id: d.id, value: v };
  }
  return best;
}
