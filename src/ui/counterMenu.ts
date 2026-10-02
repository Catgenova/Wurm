import { ACTION_BY_ID } from '../game/actions';
import { borderOf, SIDE_NAMES, type Side } from '../game/building';
import {
  buyRefusal, COUNTER_FULL, COUNTER_HOLDS, COUNTER_TOO_FAR_TO_SEE, counterBorder, counterHeld, counterMiddle, counterReach,
  counterRefuses, counterSpare, counterWall, keeps, type Counter,
} from '../game/counters';
import type { Game } from '../game/game';
import { itemName, type Item } from '../game/items';
import { priceWords } from '../game/money';
import { nearestSide, type Pick } from '../render/renderer';
import type { MenuItem } from './contextmenu';
import type { DragPayload } from './dragdrop';
import type { Store } from './panels/crate';

/**
 * A shop counter, as the windows and the menus meet it.
 *
 * A counter is a wall, and nothing stands on a border to be clicked: what is
 * clicked is a tile either side of it. So a click finds the counters on the
 * borders of the tile clicked, the nearest side first -- from the street or
 * from the shop, which is how either of the two people a counter is for comes
 * to it -- and the menu, the tooltip and a thing dragged out of the pack all
 * ask the same question.
 */

const SIDES: Side[] = ['n', 'e', 's', 'w'];

/** The finished counters on the borders of the tile clicked, the one on the side nearest the click first. */
export function countersPicked(g: Game, pick: Pick): Counter[] {
  if (!g.counters.list.size) return [];
  const near = nearestSide(pick.x, pick.y, pick.wx, pick.wy);
  const found: Counter[] = [];
  for (const side of [near, ...SIDES.filter((s) => s !== near)]) {
    const c = g.counters.onBorder(borderOf(pick.x, pick.y, side));
    if (c && counterWall(g, c) && !found.includes(c)) found.push(c);
  }
  return found;
}

/** Whose it is, in the words a menu and a window title use. */
export const counterTitle = (c: Counter): string =>
  (keeps(c) ? 'Your shop counter' : `${c.keeper ? `${c.keeper}'s` : 'A'} shop counter`);

/**
 * A counter's store, seen through the store window like a stall's: what is
 * on it, each thing's price, and Take for its keeper or Buy for anybody else.
 * It goes in and comes out by its own two doors, on an island and off one,
 * so the window, a drag and an item's own menu all mean the same thing.
 */
export function counterStore(g: Game, c: Counter, buy?: (item: Item) => void): Store {
  const mine = keeps(c);
  return {
    title: counterTitle(c),
    id: c.id,
    items: c.items,
    capacity: COUNTER_HOLDS,
    centre: counterMiddle(c),
    what: 'counter',
    kind: 'counter',
    doors: { in: 'set_out_goods', out: 'take_off_counter' },
    near: () => counterReach(g, c, g.player.x, g.player.y, false) === null,
    take: (uid) => (mine ? g.counters.take(c, uid) : null),
    refuses: (item) => counterRefuses(item) ?? (counterSpare(c) <= 0 ? COUNTER_FULL : null),
    fits: (item) => (counterRefuses(item) ? 0 : Math.min(item.count, counterSpare(c))),
    add: (item) => g.counters.add(c, item),
    priced: true,
    sell: mine || !buy ? undefined : {
      why: (item) => buyRefusal(g, c, item),
      go: (item) => buy(item),
    },
  };
}

/** One thing on a counter, as a row of the Buy list says it: what, how many and the price of the lot. */
const goodLine = (it: Item): string =>
  `${itemName(it)}${it.count > 1 ? ` (${it.count})` : ''} — ${it.price !== undefined ? priceWords(it.price) : 'not for sale'}`;

/** What the tile menu does with a counter: open it, and the island's doors for buying and the till. */
export interface CounterWays {
  open: (id: number) => void;
  /** Buy one thing off a counter, on an island. */
  buy?: (item: Item) => void;
  /** Empty a counter's till into the purse, on an island. */
  takings?: (id: number) => void;
  /** Open the Market window where goods are priced, on an island. */
  prices?: () => void;
}

/** Which side of the tile clicked a counter is on, in a word: the border it stands on, seen from that tile. */
function sideFrom(pick: Pick, c: Counter): string {
  const cb = counterBorder(c);
  const side = (['n', 'e', 's', 'w'] as const).find((s) => {
    const b = borderOf(pick.x, pick.y, s);
    return b.dir === cb.dir && b.x === cb.x && b.y === cb.y;
  });
  return side ? SIDE_NAMES[side] : SIDE_NAMES[c.side];
}

/**
 * Whose a counter is, said so that two on one tile are told apart: by its
 * keeper where the two have different keepers, and by its side as well where
 * they have the same one.
 */
function whichCounter(pick: Pick, c: Counter, all: Counter[]): string {
  const whose = keeps(c) ? 'your' : c.keeper ? `${c.keeper}'s` : 'the';
  const twin = all.some((o) => o !== c && keeps(o) === keeps(c) && o.keeper === c.keeper);
  return `${whose} counter${twin ? ` on the ${sideFrom(pick, c)}` : ''}`;
}

/**
 * The tile menu's entries for the counters beside the tile clicked: look at
 * what is on it, buy from it -- each thing at its price, refused in the words
 * the island refuses in -- and for its keeper the till and the prices. With
 * two counters beside the one tile, each entry says whose it is.
 */
export function counterEntries(g: Game, pick: Pick, ways: CounterWays): MenuItem[] {
  const entries: MenuItem[] = [];
  const picked = countersPicked(g, pick);
  for (const c of picked) {
    // Too far off for what is on it to have been sent, with something on it to see.
    const unseen = !c.items.length && counterHeld(c) > 0;
    entries.push({
      label: keeps(c) ? 'Look at your shop counter' : `Look at ${c.keeper ? `${c.keeper}'s` : 'the'} shop counter`,
      note: `${counterHeld(c)} / ${COUNTER_HOLDS} things on it`,
      hint: unseen ? COUNTER_TOO_FAR_TO_SEE : undefined,
      disabled: unseen,
      onSelect: () => ways.open(c.id),
    });
    if (keeps(c)) {
      if (ways.takings && c.till !== undefined) {
        const till = c.till;
        entries.push({
          label: 'Take the takings',
          note: till > 0 ? priceWords(till) : undefined,
          hint: till > 0 ? counterReach(g, c, g.player.x, g.player.y, false) ?? undefined : 'The till is empty.',
          disabled: till <= 0 || counterReach(g, c, g.player.x, g.player.y, false) !== null,
          onSelect: () => ways.takings?.(c.id),
        });
      }
      if (ways.prices) entries.push({ label: 'Set prices', note: 'in the Market window, Stall tab', onSelect: () => ways.prices?.() });
      continue;
    }
    if (!ways.buy) continue;
    const buy = ways.buy;
    const priced = c.items.filter((it) => it.price !== undefined);
    // Two counters beside the one tile: each Buy says whose it buys from.
    const label = picked.length > 1 ? `Buy from ${whichCounter(pick, c, picked)}` : 'Buy';
    if (unseen) {
      entries.push({ label, hint: COUNTER_TOO_FAR_TO_SEE, disabled: true });
      continue;
    }
    if (!priced.length) {
      entries.push({ label, hint: c.items.length ? 'Nothing on it has a price yet.' : 'There is nothing on it.', disabled: true });
      continue;
    }
    entries.push({
      label,
      children: priced.map((it) => {
        const why = buyRefusal(g, c, it);
        return { label: goodLine(it), hint: why ?? undefined, disabled: !!why, onSelect: () => buy(it) };
      }),
    });
  }
  return entries;
}

/** The tooltip's line for a counter beside the tile under the cursor, or null. */
export function counterTip(g: Game, pick: Pick): string | null {
  const c = countersPicked(g, pick)[0];
  if (!c) return null;
  const till = keeps(c) && c.till ? ` · ${priceWords(c.till)} in the till` : '';
  return `${counterTitle(c)}: ${counterHeld(c)} / ${COUNTER_HOLDS} things on it${till}`;
}

/**
 * A thing dragged out of the pack and let go over a counter goes out on it,
 * the whole stack, by the same door as the item's own menu. True when there
 * was a counter there, whatever the door then said.
 */
export function dropOnCounter(g: Game, p: DragPayload, pick: Pick | null): boolean {
  if (!pick || p.from !== 'inventory' || pick.furniture !== undefined || pick.crate !== undefined) return false;
  const c = countersPicked(g, pick)[0];
  if (!c) return false;
  // Somebody else's is refused by the door itself, in the island's words.
  const held = g.inventory.get(p.uid);
  const def = ACTION_BY_ID.get('set_out_goods');
  if (!held || !def) return true;
  if (g.isEquipped(held.uid)) {
    g.logMsg(`Take the ${p.name.toLowerCase()} off first.`, 'error');
    return true;
  }
  g.requestAction(def, { kind: 'item', uid: held.uid, count: held.count, into: c.id });
  return true;
}
