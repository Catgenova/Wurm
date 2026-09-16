/**
 * What the island's answers say has happened to you.
 *
 * The island settles a body and raises a skill over there, so the two places
 * that put a number over your head in a game of your own — `hurtPlayer` and
 * `gainSkill` — never run on one. Everything needed is in the answer already;
 * it is the *change* that was never worked out. So these take what the island
 * said and what was being held, and give back what moved.
 */

import { HEAL_FED, HEAL_RATE, HUNGER_RATE, THIRST_RATE, WIND_REST, WIND_STARVING } from '../game/body';

/** A skill that went up, and by how much. */
export interface Rise {
  id: string;
  gain: number;
}

/**
 * The smallest rise worth a number over your head.
 *
 * The same one `gainSkill` uses to decide a gain happened at all, so the two
 * ways a skill can go up agree about when it is worth saying so.
 */
export const SKILL_FLOOR = 0.000005;

/**
 * Which skills rose between the last answer and this one.
 *
 * `seeded` is false for the first answer of a session: a browser comes ashore
 * with a book of ones and the island's numbers land all at once, which is a
 * seeding rather than an afternoon's work and should not throw up forty
 * numbers at the join.
 */
export function skillRises(
  said: Record<string, number>,
  held: (id: string) => number,
  seeded: boolean,
): Rise[] {
  if (!seeded) return [];
  const out: Rise[] = [];
  for (const [id, value] of Object.entries(said)) {
    const gain = value - held(id);
    if (gain > SKILL_FLOOR) out.push({ id, gain });
  }
  return out;
}

/**
 * How much health an answer took off you, or nothing.
 *
 * A body heals as well as bleeds and only one of those is worth a number, and
 * the bars move in thousandths on a quiet beat, which is not a blow.
 */
export const HURT_FLOOR = 0.0005;

export const tookOff = (was: number, now: number): number =>
  (was - now > HURT_FLOOR ? was - now : 0);

/* ---- And the body, drawn forward between answers ------------------------- */

/** The four bars, as the island keeps them. */
export interface Body {
  health: number;
  stamina: number;
  hunger: number;
  thirst: number;
}

/**
 * The most of a gap the island will settle in one go. `body_settle` clamps to
 * this, so drawing past it would draw a body the island does not believe in.
 * Nothing reaches it in practice: an answer arrives at least every heartbeat.
 */
export const BODY_GAP = 180;

/**
 * A body carried forward by the island's own arithmetic.
 *
 * This is `body_settle` in TypeScript, to the letter — the same rates, which
 * are generated from the same constants, so the curve drawn here is the curve
 * the next answer will confirm rather than one near it.
 *
 * It is deliberately *not* `Game.update`'s own richer version, which the
 * island has never had: that one multiplies hunger and thirst by what is in
 * your stomach, gets wind back more slowly while walking, and will not knit a
 * wound while it is still bleeding. Drawing any of those here would drift from
 * the island and snap back on every answer, which is worse than either. They
 * are the island's to decide, not this function's to guess.
 */
export function bodyForward(
  was: Body,
  secs: number,
  at: { acting: boolean; wind: number; drain?: number; spend?: number },
): Body {
  const gone = Math.max(0, Math.min(BODY_GAP, secs));
  if (gone <= 0) return was;
  const hunger = Math.max(0, was.hunger - gone * HUNGER_RATE);
  const thirst = Math.max(0, was.thirst - gone * THIRST_RATE);
  // What is running out of you, which is `wounds_settle` rather than
  // `body_settle` but lands on the same number and so has to be drawn with it.
  const bled = Math.max(0, was.health - gone * (at.drain ?? 0));
  // Wind comes back only while your hands are empty, and an empty stomach or a
  // dry throat gets it back at a share of the rate.
  const starving = was.hunger <= 0 || was.thirst <= 0 ? WIND_STARVING : 1;
  /*
   * Wind, which goes one way at a time.
   *
   * The island takes the whole cost of a job at the end of it, in `spend_wind`
   * — one step, and the beat lands a quarter-second later, so the bar sat
   * still through a four-and-a-half-second swing and then dropped. Spread over
   * the go it comes down as the work is done and arrives at the same number,
   * which is the same bargain as everything else drawn here: the shape is
   * ours, the value is the island's, and every answer re-pins it.
   */
  const stamina = at.acting
    ? Math.max(0, was.stamina - gone * (at.spend ?? 0))
    : Math.min(1, was.stamina + gone * WIND_REST * at.wind * starving);
  // Nothing knits on an empty stomach — and a body that is still bleeding is
  // losing more than it is making, which the island works out in two places
  // and this has to add up in one.
  const health = hunger > HEAL_FED && thirst > HEAL_FED && bled < 1
    ? Math.min(1, bled + gone * HEAL_RATE)
    : bled;
  return { health, stamina, hunger, thirst };
}
