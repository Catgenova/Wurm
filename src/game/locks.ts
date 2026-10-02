import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { keyFromPadlock, padlockFromKey, padlockToFit, type Item } from './items';
import { gateLockable } from './gates';

/**
 * A lock, and the one key cut to it.
 *
 * Everything anybody built on this island has been open to everybody who
 * could walk to it. A crate on your own deed was safe because the *ground*
 * was yours; a crate anywhere else, or a cart left at a work post, or a
 * cupboard in a house you had invited somebody into, was a thing anybody
 * could empty. There was an `item.locked` flag, but it means something else
 * entirely — it stops *you* feeding your own hatchet to a wildermon by
 * accident — and it has never had anything to do with other people.
 *
 * The model is as small as it can be while still being a lock:
 *
 *   A **padlock** is forged with no key. It is a thing in your pack.
 *   **Fitting** it to a store closes it and cuts one **key** to it, there and
 *   then. The number they share is the padlock's own uid, which is unique on
 *   an island for as long as the island lasts, so there is nothing to mint
 *   and nothing to keep in step.
 *   A key is an ordinary item: hand it over and you have handed over what it
 *   opens, and there is no list anywhere saying you did.
 *
 * And one way back in, because a game where losing a small item costs you a
 * building is a game nobody enjoys: the **founder of the settlement the store
 * stands on** may open anything on their own land. That is the master key,
 * it belongs to the ground rather than to a person, and it is the reason a
 * lock is worth fitting on somebody else's deed and only worth so much on
 * your own.
 */

/** A store that may be locked: a crate, a piece of furniture, a cart. */
export interface Lockable {
  /** The padlock fitted to it, by the number it shares with its key. */
  lock?: number;
}

/** Whether anything is fitted to this at all. */
export const isLocked = (store: Lockable | undefined): boolean => !!store && (store.lock ?? 0) > 0;

/** Whether a pack holds the key to this one. */
export const keyFor = (items: readonly Item[], store: Lockable | undefined): Item | undefined =>
  isLocked(store) ? items.find((it) => it.id === 'key' && it.keyed === store?.lock) : undefined;

/**
 * Why this store will not open, or null.
 *
 * `founder` is whether the person asking is the founder of the settlement the
 * store is standing on — the master key, which belongs to the ground.
 */
export function lockRefusal(items: readonly Item[], store: Lockable | undefined, founder: boolean): string | null {
  if (!isLocked(store)) return null;
  if (founder || keyFor(items, store)) return null;
  return 'It is locked, and you have no key to it.';
}

/** What a locked store says about itself, for a window title or a tooltip. */
export const lockWord = (store: Lockable | undefined, canOpen: boolean): string =>
  !isLocked(store) ? '' : canOpen ? ' (unlocked)' : ' (locked)';

/** The crate, piece of furniture, portcullis or drawbridge a target is pointing at, if it is one. */
export function lockableAt(g: Game, t: Target): (Lockable & { x: number; y: number }) | undefined {
  if (t.kind === 'crate') return g.crates.get(t.id);
  if (t.kind === 'furniture') return g.furniture.get(t.id);
  // A portcullis on the ground floor, or a drawbridge's winch (`gates.ts`).
  return gateLockable(g, t);
}

/**
 * Fitting one, and taking it off again.
 *
 * Both are aimed at the store rather than at the padlock in your pack,
 * because the store is the thing you are pointing at — the same way a crate
 * is placed on a tile rather than the tile being handed a crate.
 */
export const LOCK_ACTIONS: ActionDef[] = [
  {
    id: 'fit_lock',
    label: 'Fit a padlock',
    verb: 'fitting a padlock',
    skill: 'blacksmithing',
    stamina: 0.02,
    baseTime: 6,
    // gates: a padlock locked against use is not one to fit (`padlockToFit`).
    applies: (t, g) => lockableAt(g, t) !== undefined && padlockToFit(g.inventory.items) !== undefined,
    check: (t, g) => {
      const store = lockableAt(g, t);
      if (!store) return 'It is gone.';
      if (isLocked(store)) return 'There is a padlock on it already.';
      if (!padlockToFit(g.inventory.items)) return 'You have no padlock. Forge one at a smelter.';
      return null;
    },
    perform: (t, g) => {
      const store = lockableAt(g, t);
      const lock = padlockToFit(g.inventory.items);
      if (!store || !lock) return;
      /*
       * The padlock's own uid is the number, minted by being consumed. It is
       * unique on an island for as long as the island lasts, so there is
       * nothing to allocate and nothing two machines could disagree about.
       * gates: and the padlock's own item becomes the key, as the island
       * makes it (`keyFromPadlock`): every key keyed to its own number.
       */
      store.lock = lock.uid;
      keyFromPadlock(lock);
      g.logMsg(`You fit the padlock and cut its key. Nothing opens it now but that key${
        g.deedOfMineAt(Math.floor(store.x), Math.floor(store.y)) ? ', or you, on your own land' : ''}.`, 'event');
      g.events.emit('inventory');
      g.events.emit('crate');
    },
  },
  {
    id: 'take_off_lock',
    label: 'Take the padlock off',
    verb: 'taking the padlock off',
    stamina: 0.02,
    baseTime: 4,
    applies: (t, g) => isLocked(lockableAt(g, t)),
    check: (t, g) => {
      const store = lockableAt(g, t);
      if (!store) return 'It is gone.';
      if (!isLocked(store)) return 'There is no padlock on it.';
      return g.lockRefusal(store as Lockable & { x: number; y: number });
    },
    perform: (t, g) => {
      const store = lockableAt(g, t);
      if (!store || !isLocked(store)) return;
      const key = keyFor(g.inventory.items, store);
      const code = store.lock;
      store.lock = undefined;
      // The key goes with the lock it was cut to. A key to nothing is an
      // item nobody can tell from a key to something, and a pack full of
      // those is how a lock stops being worth fitting.
      // gates: the key itself becomes the padlock handed back, as the island makes it (`padlockFromKey`).
      if (key) padlockFromKey(key);
      else g.inventory.add('padlock', { ql: 40 });
      g.logMsg(`You take the padlock off${key ? ' and throw the key in after it' : ''}. It is open to anybody again.${
        code ? '' : ''}`, 'event');
      g.events.emit('inventory');
      g.events.emit('crate');
    },
  },
];
