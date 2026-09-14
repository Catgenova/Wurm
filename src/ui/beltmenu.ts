import { ACTION_BY_ID, type ActionDef, type Target } from '../game/actions';
import { pinLabel, type BeltPin } from '../game/belt';
import type { Game } from '../game/game';
import type { MenuItem } from './contextmenu';

/**
 * The "hang this on your belt" entry offered wherever a job is offered. It
 * lists the loops, saying what is on each, so nothing is overwritten by
 * accident; the first empty one is marked.
 */
export function pinEntry(g: Game, pin: BeltPin): MenuItem {
  const loops = g.beltLoops();
  if (!loops) return { label: 'Hang on your belt', hint: 'You are wearing no toolbelt. Stitch one and put it on.', disabled: true };
  const free = g.freeLoop();
  return {
    label: 'Hang on your belt',
    children: Array.from({ length: loops }, (_, i) => {
      const there = g.player.belt[i];
      return {
        label: `Loop ${i + 1}`,
        note: there ? `over ${pinLabel(there, ACTION_BY_ID.get(there.action))}` : i === free ? 'empty — the first free one' : 'empty',
        onSelect: () => g.pinToBelt(i, pin),
      };
    }),
  };
}

/** Whether a job is worth a loop at all: a job you might do again and again. */
export const pinnable = (def: ActionDef): boolean => !def.hidden;

/** The handfuls a job is offered in. */
export const COUNTS = [5, 10, 25, 50];

/**
 * Whether a job can sensibly be asked for by the handful. Anything with a
 * timer on it can: it stops of its own accord the moment it cannot go on, so
 * a count that runs out of ground simply says how far it got. A job offered
 * one-or-all already has its own way of saying how many.
 */
export const countable = (def: ActionDef): boolean => !def.instant && !def.quantity;

/**
 * One job in a menu. Clicking the row does it the way it has always been
 * done; the arrow beside it opens the handfuls — five, ten, twenty-five,
 * fifty — and a counted job counts itself down and puts the work away.
 */
export function jobEntry(g: Game, def: ActionDef, target: Target, reason: string | null, label: string): MenuItem {
  const go = (goes?: number): void => g.requestAction(def, target, goes);
  if (reason || !countable(def)) return { label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => go() };
  return {
    label,
    onSelect: () => go(),
    children: [
      { label: 'Once', onSelect: () => go(1) },
      ...COUNTS.map((n) => ({ label: `${n} times`, onSelect: () => go(n) })),
      ...(def.repeat ? [{ label: 'Until you stop', note: 'or until your wind gives out', onSelect: () => go() }] : []),
    ],
  };
}
