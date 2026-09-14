/**
 * A record of everything you have ever made.
 *
 * The journal tracks what you set out to do. This tracks what you did: every
 * kind of thing that has come off your bench, how many of them, the best one
 * you ever managed, and how many came off better than they had any right to.
 * It is the number a maker actually cares about, and the game had no memory of
 * it at all.
 */
export interface MadeRecord {
  /** How many have come off the bench, counting stacks. */
  n: number;
  /** The best quality ever reached. */
  best: number;
  /** How many of them were rare or better. */
  rare: number;
  /** Game time the first and the best were made. */
  first: number;
  bestAt: number;
}

export type Ledger = Record<string, MadeRecord>;

/** Fold one finished thing into the record. */
export function record(ledger: Ledger, id: string, ql: number, count: number, rare: number, time: number): MadeRecord {
  const was = ledger[id];
  const rec: MadeRecord = was ?? { n: 0, best: 0, rare: 0, first: time, bestAt: time };
  rec.n += count;
  rec.rare += rare > 0 ? count : 0;
  if (ql > rec.best) {
    rec.best = ql;
    rec.bestAt = time;
  }
  ledger[id] = rec;
  return rec;
}

/** How many different things have been made, and how many in all. */
export const ledgerTotals = (ledger: Ledger): { kinds: number; made: number; rare: number; best: number } => {
  let made = 0;
  let rare = 0;
  let best = 0;
  for (const r of Object.values(ledger)) {
    made += r.n;
    rare += r.rare;
    best = Math.max(best, r.best);
  }
  return { kinds: Object.keys(ledger).length, made, rare, best };
};
