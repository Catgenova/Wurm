/**
 * Turning the island's `item` rows into the things the game holds.
 *
 * Its own file rather than a corner of `play.ts` because it is the seam: on an
 * island every last thing in your hands is a row over there, and this is the
 * only place it becomes a thing over here. What this function leaves out, the
 * browser does not know — which is exactly how the bug below happened.
 */
import { RARITIES, type Item } from '../game/items';
import type { ItemRow } from './island';

/** As much of an island as this needs: what its clock says about a stamp. */
export interface Aged {
  since(stamp: string | null): number;
}

/**
 * An island's item row, as this browser holds one.
 *
 * All of it, rather than the six fields this used to take. Reported as
 * "players cannot drink from water skins or fill them", and the whole of it
 * was this one map: `charges` was dropped on the way in, so every skin read
 * empty however full it was. The Drink entry is greyed out by
 * `actionsFor` — `check` says "It is empty." — before the ask ever leaves the
 * browser, which is the first half. The second half is that filling one *did*
 * work: the island filled the row, the row came back down this same map, and
 * the charge was thrown away again, so the skin still read empty and Drink
 * stayed grey. Two symptoms, one line.
 *
 * Six more went the same way, each its own silent bug on a live island:
 *
 *   locked   nothing could be put by — and the island refused to drop what
 *            this side did not know was put by
 *   rare     a rare, supreme or fantastic thing was written in the plain hand
 *   issued   what you washed ashore with offered to be bettered, and the
 *            island said no every time
 *   dye      a dyed thing drew undyed
 *   bless    circles of cunning did not show
 *   lit      a lit lantern lit nothing: you lit it, the island knew, and this
 *            side never heard, so the light in hand stayed dark
 *
 * The browser must be told everything. This is the list of what it was not.
 */
export function packed(it: ItemRow, island: Aged): Item {
  const rare = it.rare ? RARITIES.findIndex((r) => r.name === it.rare) : -1;
  return {
    uid: it.id,
    id: it.def,
    ql: it.ql,
    dmg: it.dmg,
    count: it.count,
    extra: it.extra ?? undefined,
    charges: burnt(it, island),
    locked: it.locked || undefined,
    issued: it.issued || undefined,
    lit: it.lit || undefined,
    rare: rare > 0 ? rare : undefined,
    dye: it.dye ?? undefined,
    bless: it.bless ?? undefined,
  };
}

/**
 * What is left in it now, rather than when it was lit.
 *
 * The island keeps a burning thing as the charge it had at `lit_at` and works
 * the rest out when something asks — `candle_left` — so the raw column on a
 * lantern that has been going for ten minutes is ten minutes stale. Taking
 * the age off here is the same sum against the island's own clock, and from
 * there `Game.update` counts it down between one answer and the next, the way
 * the action bar and a wildermon's leg already do.
 *
 * Nothing that is not alight burns, so a skin, a flask and an unlit lantern
 * all pass straight through.
 */
export function burnt(it: ItemRow, island: Aged): number | undefined {
  if (it.charges === null || it.charges === undefined) return undefined;
  if (!it.lit || !it.lit_at) return it.charges;
  return Math.max(0, it.charges - island.since(it.lit_at));
}
