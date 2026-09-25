import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { describeWith, itemName, type Item } from './items';

/**
 * A loop on the belt. Either a job done to a kind of thing you carry — eat a
 * meal, drink from a skin, sharpen the axe — or a job done to the ground,
 * which is taken where you are pointing.
 */
export interface BeltPin {
  /** Action id. */
  action: string;
  /** Item id, when the loop is for a thing you carry rather than the ground. */
  item?: string;
}

/** The most loops a belt can ever have: the keys 1 to 9, and 0 for the tenth. */
export const BELT_MAX = 10;
/** Points of quality per loop. */
export const QL_PER_LOOP = 10;
describeWith({ loopEvery: QL_PER_LOOP });

/**
 * How many loops a belt of this quality has: one for every ten points of it, so
 * a belt made as well as anyone can make one carries ten. Even a poor belt has
 * one loop, or there would be no reason to wear it at all.
 */
export const loopsFor = (ql: number): number => Math.max(1, Math.min(BELT_MAX, Math.floor(ql / QL_PER_LOOP)));

/**
 * The best carried thing of a kind for a loop to act on: the soundest first,
 * then the finest. Kept-back things are still fair game — a loop is a
 * deliberate act, not a stack being spent out from under you.
 */
export function bestFor(g: Game, id: string): Item | undefined {
  let best: Item | undefined;
  for (const it of g.inventory.items) {
    if (it.id !== id) continue;
    if (!best || it.dmg < best.dmg - 5 || (Math.abs(it.dmg - best.dmg) <= 5 && it.ql > best.ql)) best = it;
  }
  return best;
}

/** What a loop reads as on the bar. */
export function pinLabel(pin: BeltPin, def: ActionDef | undefined): string {
  const what = def?.label ?? pin.action;
  if (!pin.item) return what;
  return `${what} · ${itemName({ uid: 0, id: pin.item, ql: 1, dmg: 0, count: 1 }).toLowerCase()}`;
}

/**
 * Where a loop would land, and why it cannot. `where` is what you are pointing
 * at, when you are pointing at anything; a ground loop falls back to the tile
 * under your own feet.
 */
export function aimPin(g: Game, pin: BeltPin, def: ActionDef, where: Target | null): { target: Target; reason: string | null } | null {
  if (pin.item) {
    const it = bestFor(g, pin.item);
    if (!it) return null;
    const t: Target = { kind: 'item', uid: it.uid };
    if (!def.applies(t, g)) return { target: t, reason: 'That is not something you can do to it now.' };
    return { target: t, reason: def.check?.(t, g) ?? null };
  }
  const tries: Target[] = [];
  if (where) tries.push(where);
  const px = g.player.tileX;
  const py = g.player.tileY;
  tries.push({ kind: 'tile', x: px, y: py, cx: px, cy: py });
  let fallback: { target: Target; reason: string | null } | null = null;
  for (const t of tries) {
    if (!def.applies(t, g)) continue;
    const reason = def.check?.(t, g) ?? null;
    if (!reason) return { target: t, reason: null };
    fallback ??= { target: t, reason };
  }
  return fallback;
}
