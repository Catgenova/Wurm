import { itemDef, type Item } from './items';

/**
 * Buy orders: the other half of a stall.
 *
 * A stall is for selling what you have to somebody who is not there. An order
 * is for buying what you want from somebody who is not there: at a settlement
 * token or a mailbox you name a kind of thing, the least quality that will do,
 * how many and the silver for each, and the whole price comes out of your
 * purse there and then and is held against it. The board lists it beside the
 * stalls. Anybody else at a token or a mailbox brings some or all of it out of
 * their pack and is paid from what it holds at once; what they bring goes to
 * you by the post. You may take it back whenever you like, and one left open
 * for `ORDER_LIFE` takes itself back.
 *
 * The island does every part of that (`rpc_order`, `rpc_orders`,
 * `rpc_order_fill`, `rpc_order_cancel`) and there is no such thing in the
 * game you play by yourself, where there is nobody to fill one. This is what
 * the browser needs in order to say it: how long one stands, what one asks for
 * in words, and what in a pack would go to one.
 */

/**
 * How long an order stands before it lapses and gives back what it still
 * holds, in seconds: a week of real time, not of the island's. The island
 * reads it as `order_life()`.
 */
export const ORDER_LIFE = 7 * 24 * 60 * 60;

/**
 * What an order asks for, the way a line says it: "15 × iron ore of quality
 * 30 or better", or "15 × iron ore" when any quality will do. The island says
 * it in the same words (`order_words`).
 */
export const orderWords = (def: string, n: number, ql: number): string =>
  `${n} × ${itemDef(def).name.toLowerCase()}${ql > 0 ? ` of quality ${ql} or better` : ''}`;

/**
 * Whether a thing in a pack would go to an order: of its kind, whatever it is
 * made of, and of its quality or better. Never what is put by, what you are
 * wearing or holding, or a crate or a bag with anything in it -- the island
 * chooses what goes, and it does not strip a body or empty a bag to do it.
 * Something held out in a deal does not go either, which the pack a browser
 * holds cannot see; the island counts without it.
 */
export const fitsOrder = (it: Item, order: { def: string; ql: number }, worn: boolean): boolean =>
  it.id === order.def && it.ql >= order.ql && !it.locked && !worn
  && it.creature === undefined && !(it.inside?.length);

/** How many of what an order wants a pack could bring to it, counted by the unit. */
export const couldBring = (items: readonly Item[], order: { def: string; ql: number },
  worn: (uid: number) => boolean): number =>
  items.reduce((n, it) => n + (fitsOrder(it, order, worn(it.uid)) ? it.count : 0), 0);
