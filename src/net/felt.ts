/**
 * What the island's answers say has happened to you.
 *
 * The island settles a body and raises a skill over there, so the two places
 * that put a number over your head in a game of your own — `hurtPlayer` and
 * `gainSkill` — never run on one. Everything needed is in the answer already;
 * it is the *change* that was never worked out. So these take what the island
 * said and what was being held, and give back what moved.
 */

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
