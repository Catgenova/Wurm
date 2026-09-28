/**
 * The climbing roses on a rose arch, and how far they have grown.
 *
 * Asked for with the pictures: an arch over a path that fills in over the days
 * after it goes up -- bare, then leafy, then in bud, then in flower, flowering
 * in spring and summer and in leaf the rest of the year. What decides it is
 * the moment the arch was set down, which the island keeps for every piece
 * (`placed.made_at`) and hands to every browser that can see it (`set` in the
 * ground read), so everybody looking at one arch sees the same roses on it.
 * Both that moment and the season are the wall clock's; nothing else is kept.
 *
 * Picking an arch up and setting it down again is planting its roses again.
 */
import { seasonAt, type Season } from '../world/calendar';
import { DAY_SECONDS } from './pace';
import { numberWord, spanWords } from './words';

/** Days of the island's year after it is set down that an arch's roses are in leaf, in bud and in flower. */
export const ROSE_LEAFY = 1;
export const ROSE_BUD = 2;
export const ROSE_FLOWER = 3;
/** The seasons roses bud and flower in; the rest of the year a grown arch is in leaf. */
export const ROSE_SEASONS: readonly Season[] = ['spring', 'summer'];

const DAY = DAY_SECONDS;

export type RoseStage = 'bare' | 'leafy' | 'bud' | 'flower';

/** What the roses on an arch look like, in words: "bare", "in leaf", "in bud", "in flower". */
export const ROSE_WORD: Record<RoseStage, string> = { bare: 'bare', leafy: 'in leaf', bud: 'in bud', flower: 'in flower' };

/**
 * How the roses on an arch set down at `setAt` stand at `now`, both in epoch
 * seconds: the stage, how many days they have been growing, and whether it is
 * the time of year they flower. An arch with no moment of its own -- one set
 * down before arches kept one -- is taken as long grown.
 */
export function roseStage(setAt: number | undefined, now: number): { stage: RoseStage; days: number; blooms: boolean } {
  const days = setAt === undefined ? ROSE_FLOWER * 10 : Math.max(0, (now - setAt) / DAY);
  const blooms = ROSE_SEASONS.includes(seasonAt(now).season);
  const stage: RoseStage = days < ROSE_LEAFY ? 'bare' : !blooms || days < ROSE_BUD ? 'leafy' : days < ROSE_FLOWER ? 'bud' : 'flower';
  return { stage, days, blooms };
}

/** What the roses are doing and what they do next, for the line under an arch's name. */
export function roseSays(setAt: number | undefined, now: number): string {
  const { stage, blooms } = roseStage(setAt, now);
  const at = setAt ?? now - ROSE_FLOWER * 10 * DAY;
  const next = (d: number, word: string): string => ` · ${word} in ${spanWords(at + d * DAY - now)}`;
  if (stage === 'bare') return `roses bare${next(ROSE_LEAFY, 'in leaf')}`;
  if (stage === 'leafy' && blooms) return `roses in leaf${next(ROSE_BUD, 'in bud')}`;
  if (stage === 'leafy') return 'roses in leaf · they bud and flower in spring and summer';
  if (stage === 'bud') return `roses in bud${next(ROSE_FLOWER, 'in flower')}`;
  return 'roses in flower';
}

/** The rule, said once: for a piece's description and the help. */
export const ROSES_RULE = `An arch's roses are in leaf ${numberWord(ROSE_LEAFY)} day after it is set down, in bud ${numberWord(ROSE_BUD)} days after and in flower ${numberWord(ROSE_FLOWER)} days after, in spring and summer; the rest of the year a grown arch is in leaf. Picking an arch up and setting it down again starts its roses again.`;
