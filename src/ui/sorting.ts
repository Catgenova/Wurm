import { itemName, itemWeight, type Item } from '../game/items';

/**
 * How a list of things is put in order.
 *
 * The pack has had this since the storage work — a select at the top of the
 * window offering five orders — and a crate, a cupboard, a cart and a bag
 * have had none of it. Their contents came out sorted by name, always, with
 * no way to ask for anything else, which is exactly backwards: your pack
 * holds a dozen things and a deed crate holds three hundred, and the window
 * that needs an order most was the one that could not be given one.
 *
 * So the rule lives here now and both windows ask it. One list of orders,
 * one comparison apiece, and a name that climbs while everything else falls —
 * because "sort by quality" means the good ones at the top, and nobody has
 * ever meant anything else by it.
 */
export type SortKey = 'name' | 'ql' | 'weight' | 'dmg' | 'count';

export const SORTS: Array<[SortKey, string]> = [
  ['name', 'Name'],
  ['ql', 'Quality'],
  ['weight', 'Weight'],
  ['dmg', 'Damage'],
  ['count', 'How many'],
];

const BY: Record<SortKey, (a: Item, b: Item) => number> = {
  name: (a, b) => itemName(a).localeCompare(itemName(b)),
  ql: (a, b) => b.ql - a.ql,
  weight: (a, b) => itemWeight(b) - itemWeight(a),
  dmg: (a, b) => b.dmg - a.dmg,
  count: (a, b) => b.count - a.count,
};

/**
 * The list in that order, as a copy. Ties fall back to the name, so a crate
 * of two hundred identical planks does not shuffle itself every time
 * something else in it changes.
 */
export const orderBy = (items: readonly Item[], key: SortKey): Item[] =>
  [...items].sort((a, b) => BY[key](a, b) || itemName(a).localeCompare(itemName(b)));

/** The select itself, since both windows want the same one. */
export function sortSelect(title: string, onPick: (key: SortKey) => void): HTMLSelectElement {
  const el = document.createElement('select');
  el.className = 'panel-select';
  el.title = title;
  for (const [key, label] of SORTS) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    el.append(opt);
  }
  el.addEventListener('change', () => onPick(el.value as SortKey));
  return el;
}
