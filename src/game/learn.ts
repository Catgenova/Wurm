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
