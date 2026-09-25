import type { Game } from '../game/game';
import { itemDef, itemName, type Item, rarityOf } from '../game/items';

/**
 * The three cells a list of things is made of.
 *
 * There are two windows that show you things you own -- your pack and whatever
 * container you have open -- and they were writing their rows separately. The
 * pack's row knew that a rare thing is written in its own colour, that a thing
 * kept back is written in italics, that a blunt tool is not worth what it says
 * on it and that a tool at ninety damage is about to go to pieces. The
 * container's row knew none of it: it wrote the name in the ordinary colour
 * and the two numbers plain, so a fantastic hatchet in a crate looked exactly
 * like every other hatchet in the crate. Reported: *"item rarities aren't
 * displayed inside of containers."*
 *
 * So the cells live here, and both windows build their rows out of them. There
 * is nowhere left for the two to disagree.
 */

/**
 * The name of a thing.
 *
 * `itemName` already puts the word -- rare, supreme, fantastic -- into the
 * name; what this adds is the colour, which is the thing anybody actually
 * scans a list for, and the marks for what is worn and what is kept back.
 */
export function nameCell(item: Item, opts: { worn?: boolean; occupant?: string } = {}): HTMLSpanElement {
  const name = document.createElement('span');
  name.className = 'inv-name';
  const worn = opts.worn ?? false;
  // A creature crate says who is in it.
  const marks = [worn ? 'worn' : '', item.locked ? 'kept' : '', opts.occupant ? `${opts.occupant} inside` : ''].filter(Boolean);
  const full = (item.count > 1 ? `${itemName(item)} (${item.count})` : itemName(item))
    + (marks.length ? ` · ${marks.join(' · ')}` : '');
  name.textContent = full;
  // The column is narrow and some of these names are long.
  name.title = item.locked ? `${full}. Kept back: nothing will spend, drop or feed it away.` : full;
  const rare = rarityOf(item);
  if (rare.colour) name.style.color = rare.colour;
  if (worn) name.classList.add('inv-worn');
  if (item.locked) name.classList.add('inv-kept');
  return name;
}

/**
 * Its quality, and what it is worth at the work today where the two differ:
 * the number it was made at dragged down by the state it is in and lifted by
 * its metal, its rarity and any blessing on it.
 */
export function qualityCell(game: Game, item: Item): HTMLSpanElement {
  const ql = document.createElement('span');
  ql.textContent = item.ql.toFixed(1);
  if (itemDef(item.id).category !== 'tool') return ql;
  const worth = game.toolWorth(item);
  ql.title = `Made at ${item.ql.toFixed(1)}; it works as a ${worth.toFixed(1)} today.`;
  if (worth < item.ql - 0.05) {
    ql.classList.add('inv-blunt');
    ql.textContent = `${item.ql.toFixed(1)}→${worth.toFixed(0)}`;
  } else if (worth > item.ql + 0.05) {
    ql.classList.add('inv-keen');
    ql.textContent = `${item.ql.toFixed(1)}→${worth.toFixed(0)}`;
  }
  return ql;
}

/** Its damage, and a word about it where it is close to going to pieces. */
export function damageCell(item: Item): HTMLSpanElement {
  const dmg = document.createElement('span');
  dmg.textContent = item.dmg.toFixed(1);
  if (item.dmg >= 90) {
    dmg.classList.add('inv-breaking');
    dmg.title = 'About to go to pieces. Repair it now.';
  } else if (item.dmg >= 75) {
    dmg.classList.add('inv-worn-out');
    dmg.title = 'Getting badly worn. Repair it before it breaks.';
  }
  return dmg;
}
