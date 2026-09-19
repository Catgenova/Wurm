import type { Item } from './items';

/**
 * What a coin is worth, and how a pile of them is counted.
 *
 * Coins have existed on this island since there was an anvil to strike them
 * on. They are struck twenty to a lump from silver or gold, they go in a
 * pocket, they melt back down into the lump they came from — and they have
 * never once bought anything, because there has never been anything to buy
 * them with or anybody to buy from. A currency nobody can spend is a metal
 * with a picture on it.
 *
 * So, one number: **a gold coin is worth ten silver**, and every price on
 * this island is named in silver. That is the whole of the exchange. It is
 * stated here and nowhere else, both sides read it from here, and it is
 * deliberately not a market — a rate that moved would want a market to move
 * it, and there is no market, there are people.
 *
 * Change is given in silver, which is why the rate is a round number: a
 * purse of gold spends cleanly and comes back as silver rather than as a
 * fraction of something.
 */

/** What one coin of each metal is worth, counted in silver. */
export const COIN_WORTH: Record<string, number> = { Silver: 1, Gold: 10 };

/** The metal change is given in, and the unit every price is named in. */
export const CHANGE_METAL = 'Silver';

/** What one stack of coins is worth. Anything that is not a coin is worth nothing. */
export const stackWorth = (it: Item): number =>
  it.id === 'coin' ? (COIN_WORTH[it.extra ?? ''] ?? 0) * it.count : 0;

/** What a pack is worth in silver, counting every coin in it. */
export const purse = (items: readonly Item[]): number =>
  items.reduce((sum, it) => sum + stackWorth(it), 0);

/**
 * Coins in a price, in words: "12 silver", "1 gold and 2 silver".
 *
 * Written from the largest coin down, because that is how anybody would say
 * it and how anybody would count it out.
 */
export function priceWords(silver: number): string {
  const n = Math.max(0, Math.round(silver));
  if (n === 0) return 'nothing';
  const gold = Math.floor(n / COIN_WORTH.Gold);
  const left = n - gold * COIN_WORTH.Gold;
  const parts: string[] = [];
  if (gold) parts.push(`${gold} gold`);
  if (left) parts.push(`${left} silver`);
  return parts.join(' and ');
}

/**
 * Which coins to take out of a pack to cover a price, largest first, and what
 * is left over to give back as change.
 *
 * Largest first is what a person does and it is also what keeps a purse
 * usable: paying eleven silver out of a gold and five silver should leave you
 * the four silver rather than spending the five and breaking the gold. Null
 * when the pack cannot cover it at all.
 */
export function pay(items: readonly Item[], silver: number): { take: Array<{ uid: number; count: number }>; change: number } | null {
  const want = Math.max(0, Math.round(silver));
  if (want === 0) return { take: [], change: 0 };
  const coins = items.filter((it) => stackWorth(it) > 0)
    .sort((a, b) => (COIN_WORTH[b.extra ?? ''] ?? 0) - (COIN_WORTH[a.extra ?? ''] ?? 0));
  const take: Array<{ uid: number; count: number }> = [];
  let paid = 0;
  for (const it of coins) {
    if (paid >= want) break;
    const each = COIN_WORTH[it.extra ?? ''] ?? 0;
    // As many of this coin as are needed and no more, which is what leaves
    // the small change in your pocket rather than in the till.
    const n = Math.min(it.count, Math.ceil((want - paid) / each));
    if (n <= 0) continue;
    take.push({ uid: it.uid, count: n });
    paid += n * each;
  }
  if (paid < want) return null;
  return { take, change: paid - want };
}
