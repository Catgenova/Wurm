/**
 * A settlement's ranks, and the one comparison everybody asks of them.
 *
 * Here, in a module that imports nothing, rather than in `game.ts`, where they
 * were. The baubles needed the comparison, and taking it from `game.ts` closed
 * a ring -- baubles → game → actions → baubles -- so the bundle could run
 * `actions.ts` before `baubles.ts` had finished, and `ACTIONS` spread a
 * `BAUBLE_ACTIONS` that was not there yet. The page stopped on "Raising an
 * island…" with "is not iterable" in the console, for everybody, and nothing
 * in the suite noticed, because no test loads the built page. It is the same
 * race `items.ts` tells of for `TREASURE_ACTIONS`.
 *
 * `game.ts` passes these on, so what imported them from there still does.
 */

/**
 * What somebody is on a settlement.
 *
 * `deed_member` was a flat list: in or out, and everybody in it could dig up
 * the gardens, empty the stores and pull the walls down. Inviting anybody to
 * anything was therefore a decision nobody could take back short of throwing
 * them out, which is not a thing you want to have to do to somebody you are
 * merely unsure about.
 *
 *   founder   planted the stake. Cannot be demoted, may do everything, and
 *             holds the master key to every lock on their own land.
 *   mayor     everything but founding: invites, expels, ranks, upgrades,
 *             and may disband.
 *   builder   the ordinary citizen, and what an invitation makes you: shapes
 *             the ground, builds, takes from the stores.
 *   guest     walks the land and opens nothing. What you offer somebody you
 *             want to show round rather than hand the keys to.
 */
export type DeedRole = 'founder' | 'mayor' | 'builder' | 'guest';

/** The ranks in order, so "at least a builder" is one comparison. */
export const DEED_RANKS: DeedRole[] = ['guest', 'builder', 'mayor', 'founder'];

/** Whether a rank is at least another. Absent means the solo game: founder. */
export const rankAtLeast = (have: DeedRole | undefined, want: DeedRole): boolean =>
  DEED_RANKS.indexOf(have ?? 'founder') >= DEED_RANKS.indexOf(want);
