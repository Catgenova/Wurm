/**
 * What one go at something teaches.
 *
 * A leaf on purpose: this module imports nothing. It was written in
 * `actions.ts` first, and the moment the trades that live in their own files —
 * fishing, brewing, the anvil, first aid — started asking it a question, every
 * one of them grew a runtime edge back into the hub they are collected by.
 * That ring builds perfectly and empties the action list at load, which is the
 * second time this session a value import into `actions.ts` has done it.
 */

/**
 * What a go that missed is worth against one that landed.
 *
 * Not nothing: a swing you had to line up, take and follow through teaches the
 * arm something whether or not the edge found anything. Not the same either.
 */
export const TRY_LEARN = 0.3;

/**
 * One go at a trade, priced by whether it came off.
 *
 * Every trade on the island had its own answer to this and most of them were
 * wrong in one of two directions: some paid a hand-written fraction of their
 * own choosing, some paid the *same* for a miss as for a hit because the gain
 * was written above the roll rather than below it, and eight paid nothing at
 * all. One number now, read by both sides of the wire.
 */
export const tryGain = (ok: boolean, base = 1): number => base * (ok ? 1 : TRY_LEARN);

/**
 * What a go of work teaches the body itself, whatever the work was.
 *
 * Reported from the island: *"i haven't seemed to be able to increase any
 * characteristics aside from mind logic so far in this iteration, in the solo
 * world i was making body gains from my digging and mining."*
 *
 * Exactly right, and the reason is that these two numbers lived in the
 * browser's `finishGo` and nowhere else. The island charged the wind — it
 * reads `action_def.stamina` and takes it off — and then said nothing about
 * what spending it taught you. So on an island `body_stamina` rose only from
 * a night's sleep and `body_control` rose from nothing at all, while in the
 * solo world every spadeful paid both.
 *
 * Wind for spending it, control for doing it: a body that has swung a shovel
 * a thousand times has both a deeper chest and a steadier hand, and neither of
 * those is the digging skill.
 */
export const WORK_WIND = 0.05;
/** And what each unit of wind actually spent is worth on top of that. */
export const WORK_WIND_SPENT = 0.6;
/** What the go itself teaches the hands, spent or not. */
export const WORK_HAND = 0.05;

/**
 * How dark it has to be before a fight teaches you anything about noticing.
 *
 * Awareness is learned in one place on this island and one only: fighting in
 * the dark. Nothing teaches a person what they were not noticing like
 * something coming out of it at them — so the characteristic that decides how
 * far you see is bought with the hours when you can see least.
 *
 * Which the island did not know either. It has had `darkness()` since the
 * clock went in and never once paid anybody for being out in it.
 */
export const NIGHT_EYES_FROM = 0.35;
/** A swing taken in the dark, an arrow loosed into it, and a blow taken out of it. */
export const DARK_SWING = 0.5;
export const DARK_SHOT = 0.7;
export const DARK_HIT = 0.8;
