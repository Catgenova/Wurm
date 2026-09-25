import { LETTER_MAX, type Deal, type Good, type Island, type Occupant, type Order, type Parcel, type Stall } from '../../net/island';
import type { Game } from '../../game/game';
import { billWords, ITEM_DEFS, itemName, type Item } from '../../game/items';
import { furnitureDef } from '../../game/furniture';
import { SPECIES } from '../../game/creatures';
import { priceWords, purse } from '../../game/money';
import { couldBring, ORDER_LIFE, orderWords } from '../../game/orders';
import { awayFor } from '../../game/away';
import { spanWords } from '../../game/words';
import type { UIWindow } from '../windows';

/** How often the window asks again while it is open. */
const REFRESH = 5;

/**
 * Where goods change hands.
 *
 * Coins have existed since there was an anvil to strike them on and have
 * never bought anything, because there was nothing to buy them with and
 * nobody to buy from. Five tabs, because they answer five different
 * questions:
 *
 *   **Board** — what is for sale anywhere on the island, and what is wanted.
 *   Every stall, where it stands, what is on it and for how much, read at a
 *   settlement token or a mailbox, and a Buy for each, which goes through
 *   when you stand at that stall's counter; and every buy order, with a Fill
 *   for each, which goes through there and then.
 *
 *   **Orders** — what you want and nobody has put out. Your own buy orders,
 *   wherever you are, to take back; and putting one up, at a token or a
 *   mailbox.
 *
 *   **Deals** — two people standing together. An offer with its terms written
 *   down, held out of the offerer's pack while it stands, taken or turned
 *   down whole. Not a live two-window negotiation: the terms you read are the
 *   terms that execute, which is the property the ready-flag dance in every
 *   other game exists to fake.
 *
 *   **Stall** — for when you are not there. Lay goods out, put a price on
 *   each, and it sells while you are asleep; the coins wait in the till.
 *
 *   **Post** — for when neither of you is. A parcel in at one mailbox and out
 *   at any other.
 *
 * Nothing here works in the game you play by yourself, and the window says so
 * rather than showing empty tabs: there is one person in that game and none
 * of these is a thing you do alone.
 *
 * A creature crate with a wildermon in it goes everywhere the rest do: into a
 * deal, onto a stall, into the post. Whoever it goes to keeps the wildermon.
 */
type Tab = 'board' | 'orders' | 'deals' | 'stall' | 'post';
export class MarketPanel {
  private readonly bar: HTMLDivElement;
  private readonly page: HTMLDivElement;
  private readonly tabs = new Map<string, HTMLButtonElement>();
  private tab: Tab = 'board';
  private deals: Deal[] = [];
  private market: { board: boolean; stalls: Stall[] } = { board: false, stalls: [] };
  private orders: { board: boolean; orders: Order[] } = { board: false, orders: [] };
  /** The order being written: the name of what is wanted, the least quality, how many and the silver for each. */
  private wanted = { name: '', ql: 0, count: 1, price: 1 };
  /** How many somebody has typed that they will bring to an order, by the order's number. */
  private readonly bringing = new Map<number, number>();
  /** What is ticked to go in a parcel, by item uid, and the note that goes with it. */
  private readonly posting = new Set<number>();
  private note = '';
  private waiting: { at_box: boolean; things: Parcel[] } = { at_box: false, things: [] };
  private asking = false;
  private clock = 0;
  /** What is ticked to go into an offer, by item uid. */
  private readonly picked = new Set<number>();
  private want = 0;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly island: Island | null,
    /** Somebody to offer to: the social window's list, so there is one roll. */
    private readonly folk: () => Array<{ uid: string; name: string }>,
  ) {
    win.body.classList.add('skills-body');
    this.bar = document.createElement('div');
    this.bar.className = 'log-tabs';
    for (const [id, label, title] of [
      ['board', 'Board', 'Every stall and buy order on the island, read at a settlement token or a mailbox'],
      ['orders', 'Orders', 'What you have asked for, and asking for something'],
      ['deals', 'Deals', 'Offers out and offers in'],
      ['stall', 'Stall', 'What you have laid out, and what it has taken'],
      ['post', 'Post', 'Parcels waiting at a mailbox'],
    ] as Array<[Tab, string, string]>) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-btn tb-small log-tab' + (id === this.tab ? ' tb-on' : '');
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => this.show(id));
      this.tabs.set(id, b);
      this.bar.append(b);
    }
    this.page = document.createElement('div');
    win.body.append(this.bar, this.page);
    win.onOpen = () => void this.refresh();
    this.draw();
  }

  private show(id: Tab): void {
    this.tab = id;
    for (const [key, el] of this.tabs) el.classList.toggle('tb-on', key === id);
    this.draw();
  }

  /** Asked again while the window is open, and not at all while it is shut. */
  update(dt: number): void {
    if (!this.win.isOpen || !this.island) return;
    this.clock += dt;
    if (this.clock < REFRESH) return;
    this.clock = 0;
    void this.refresh();
  }

  /**
   * Asked again, and drawn again -- but not over somebody typing. An order is
   * four boxes filled in one after another, and a window that redrew itself
   * every few seconds took the box away from under the hand typing into it.
   * What was typed is kept either way; a press of a button draws regardless.
   */
  private async refresh(force = false): Promise<void> {
    if (!this.island || this.asking) return;
    this.asking = true;
    try {
      this.deals = await this.island.deals();
      this.waiting = await this.island.waiting();
      this.market = await this.island.market();
      this.orders = await this.island.orders();
    } finally {
      this.asking = false;
    }
    if (force || !this.typing()) this.draw();
  }

  /** Whether one of this window's boxes has somebody typing into it. */
  private typing(): boolean {
    const el = document.activeElement;
    return el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'number') && this.page.contains(el);
  }

  private async act(go: Promise<string | null>): Promise<void> {
    const why = await go;
    if (why) this.game.logMsg(why, 'error');
    this.clock = REFRESH;
    await this.refresh(true);
  }

  private draw(): void {
    this.page.replaceChildren();
    if (!this.island) {
      this.say('There is one person on this island, and every one of these wants somebody else. '
        + 'The board, buy orders, deals, stalls and the post are for an island with other people on it.');
      return;
    }
    if (this.tab === 'board') this.drawBoard();
    else if (this.tab === 'orders') this.drawOrders();
    else if (this.tab === 'deals') this.drawDeals();
    else if (this.tab === 'stall') this.drawStall();
    else this.drawPost();
  }

  private say(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'skill-note market-note';
    el.textContent = text;
    this.page.append(el);
    return el;
  }

  private head(text: string): void {
    const el = document.createElement('div');
    el.className = 'skill-group';
    el.textContent = text;
    this.page.append(el);
  }

  private button(label: string, title: string, go: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-btn tb-small';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', go);
    return b;
  }

  /** What a deal is, in one line: the goods, and the coins one way or the other. */
  private terms(d: Deal): string {
    const things = d.things.map((t) => (t.count > 1 ? `${t.count} × ${nameOf(t)}` : nameOf(t)));
    const coins = d.want > 0 ? `for ${priceWords(d.want)}`
      : d.give > 0 ? `and ${priceWords(d.give)} with it` : 'for nothing';
    return `${things.length ? things.join(', ') : 'nothing'} ${coins}`;
  }

  private drawDeals(): void {
    const mine = this.deals.filter((d) => d.mine);
    const theirs = this.deals.filter((d) => !d.mine);
    this.head('Offered to you');
    if (!theirs.length) this.say('Nothing. An offer stands until it is taken or turned down.');
    for (const d of theirs) {
      const row = document.createElement('div');
      row.className = 'skill-row';
      const text = document.createElement('span');
      text.textContent = `${d.who}: ${this.terms(d)}`;
      row.append(text,
        this.button('Take it', 'You both have to be standing together', () => void this.act(this.island!.answerDeal(d.n, true))),
        this.button('No', 'Turn it down; everything goes back', () => void this.act(this.island!.answerDeal(d.n, false))));
      this.page.append(row);
    }

    this.head('Offered by you');
    if (!mine.length) this.say('Nothing out.');
    for (const d of mine) {
      const row = document.createElement('div');
      row.className = 'skill-row';
      const text = document.createElement('span');
      text.textContent = `${d.who}: ${this.terms(d)}`;
      row.append(text, this.button('Take it back', 'Everything held comes home', () => void this.act(this.island!.answerDeal(d.n, false))));
      this.page.append(row);
    }

    /*
     * And making one. Tick what is going, name what is wanted for it, choose
     * who — in that order, because that is the order somebody thinks in.
     */
    this.head('Make an offer');
    const people = this.folk();
    if (!people.length) {
      this.say('You know nobody to offer anything to yet. Anybody you share land with, '
        + 'or have written to, is somebody you can deal with.');
      return;
    }
    this.pick(this.picked, 'Offer');

    const bar = document.createElement('div');
    bar.className = 'panel-bar';
    const price = document.createElement('input');
    price.type = 'number';
    price.min = '0';
    price.className = 'panel-select market-price';
    price.value = String(this.want);
    price.title = 'Silver you want for it. Nought gives it away.';
    price.addEventListener('input', () => (this.want = Math.max(0, Number(price.value) || 0)));
    const who = document.createElement('select');
    who.className = 'panel-select';
    for (const f of people) {
      const o = document.createElement('option');
      o.value = f.uid;
      o.textContent = f.name;
      who.append(o);
    }
    bar.append(price, who, this.button('Offer', 'The terms are fixed once it is out', () => {
      const items = [...this.picked];
      this.picked.clear();
      void this.act(this.island!.offer(who.value, items, this.want, 0));
    }));
    this.page.append(bar);
    this.say(`You are carrying ${priceWords(purse(this.game.inventory.items))}.`);
  }

  private drawStall(): void {
    /*
     * A stall is a piece of furniture, so what is on it is already the store
     * window's business. What belongs here is the price on each thing and the
     * till underneath, which is the part no other window has a place for --
     * and they come from the island, which keeps them, for your own stalls
     * wherever you stand.
     */
    const stalls = this.market.stalls.filter((st) => st.mine);
    if (!stalls.length) {
      this.say(`You have no stall. Nail one up — ${billWords(furnitureDef('stall').bill)} — `
        + 'and stand it somewhere people walk past.');
      return;
    }
    for (const st of stalls) {
      this.head(`Stall at ${st.x},${st.y}${st.deed ? ` on ${st.deed}` : ''}`);
      const till = st.till ?? 0;
      const row = document.createElement('div');
      row.className = 'skill-row';
      const text = document.createElement('span');
      text.textContent = till > 0 ? `The till holds ${priceWords(till)}.` : 'The till is empty.';
      row.append(text);
      if (till > 0) row.append(this.button('Take the takings', 'Stand at the counter', () => void this.act(this.island!.takings(st.id))));
      this.page.append(row);
      if (!st.goods.length) this.say('Nothing on the counter. Put something in it, then set a price.');
      for (const good of st.goods) {
        const line = document.createElement('div');
        line.className = 'skill-row';
        const name = document.createElement('span');
        name.textContent = `${goodName(good)}${good.price ? ` — ${priceWords(good.price)}` : ' — not for sale'}`;
        const box = document.createElement('input');
        box.type = 'number';
        box.min = '0';
        box.className = 'panel-select market-price';
        box.value = String(good.price ?? 0);
        line.append(name, box, this.button('Set', 'Nought takes it off sale', () =>
          void this.act(this.island!.setPrice(good.id, Math.max(0, Number(box.value) || 0)))));
        this.page.append(line);
      }
    }
  }

  /**
   * Everything for sale on the island, stall by stall, nearest first, and
   * then everything wanted, order by order, oldest first. It is read at a
   * settlement token or a mailbox; buying is done at the stall, whose counter
   * you have to be standing at when you press Buy, and filling an order is
   * done where you stand.
   */
  private drawBoard(): void {
    if (!this.market.board) {
      this.say('The market board is read at a settlement token or a mailbox. '
        + 'Stand at one to see every stall and every buy order on the island.');
      return;
    }
    const me = this.game.player;
    const theirs = this.market.stalls
      .filter((st) => !st.mine && st.goods.length)
      .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
    if (!theirs.length) this.say('Nobody has anything for sale.');
    for (const st of theirs) {
      const far = Math.round(Math.hypot(st.x + 0.5 - me.x, st.y + 0.5 - me.y));
      this.head(`${st.owner}'s stall at ${st.x},${st.y}${st.deed ? ` on ${st.deed}` : ''} — ${far} ${far === 1 ? 'tile' : 'tiles'} away`);
      for (const good of st.goods) {
        const row = document.createElement('div');
        row.className = 'skill-row';
        const text = document.createElement('span');
        text.textContent = `${goodName(good)} — ${priceWords(good.price ?? 0)}`;
        row.append(text, this.button('Buy', 'Stand at the counter of this stall', () => void this.act(this.island!.buy(good.id))));
        this.page.append(row);
      }
    }
    this.drawWanted();
    this.say(`You are carrying ${priceWords(purse(this.game.inventory.items))}. `
      + 'Your own stalls are on the Stall tab, and your own orders on the Orders tab.');
  }

  /**
   * Everybody else's buy orders, and a Fill for each that you have something
   * for: how many of yours will do is counted off your pack the way the
   * island counts it, and the box starts at as many as it can take.
   */
  private drawWanted(): void {
    this.head('Wanted');
    const theirs = this.orders.orders.filter((o) => !o.mine);
    if (!theirs.length) this.say('Nobody has put up an order.');
    for (const o of theirs) {
      const left = o.want - o.got;
      const have = couldBring(this.game.inventory.items, o, (uid) => this.game.isEquipped(uid));
      const row = document.createElement('div');
      row.className = 'skill-row market-row';
      const text = document.createElement('span');
      text.textContent = `${o.who} wants ${orderWords(o.def, left, o.ql)} at ${priceWords(o.price)} each, `
        + `put up at ${o.x},${o.y}${o.deed ? ` on ${o.deed}` : ''}. `
        + (have ? `You have ${have} that will do.` : 'You have none that will do.');
      row.append(text);
      if (have) {
        const most = Math.min(have, left);
        const box = document.createElement('input');
        box.type = 'number';
        box.min = '1';
        box.max = String(most);
        box.className = 'panel-select market-count';
        box.value = String(Math.min(this.bringing.get(o.n) ?? most, most));
        box.title = 'How many to bring';
        box.addEventListener('input', () => this.bringing.set(o.n, Math.max(1, Math.floor(Number(box.value) || 1))));
        row.append(box, this.button('Fill',
          `Paid ${priceWords(o.price)} for each out of what it holds, at once; what you bring goes to ${o.who} by the post`,
          () => {
            const n = Math.max(1, Math.floor(Number(box.value) || 1));
            this.bringing.delete(o.n);
            void this.act(this.island!.fillOrder(o.n, n));
          }));
      }
      this.page.append(row);
    }
  }

  /**
   * Your own buy orders, wherever you are, each with what it still holds and
   * how long it has left; and putting one up, which is done at a settlement
   * token or a mailbox, where the board is read.
   */
  private drawOrders(): void {
    this.head('Your orders');
    const mine = this.orders.orders.filter((o) => o.mine);
    if (!mine.length) this.say('Nothing asked for.');
    for (const o of mine) {
      const left = o.want - o.got;
      const row = document.createElement('div');
      row.className = 'skill-row market-row';
      const text = document.createElement('span');
      text.textContent = `${orderWords(o.def, left, o.ql)} at ${priceWords(o.price)} each`
        + `${o.got ? `, ${o.got} of ${o.want} brought` : ''}: ${priceWords(left * o.price)} held, `
        + `lapses in ${awayFor(o.left)}.`;
      row.append(text, this.button('Take it back', `${priceWords(left * o.price)} comes back to your purse`,
        () => void this.act(this.island!.cancelOrder(o.n))));
      this.page.append(row);
    }

    this.head('Put up an order');
    if (!this.orders.board) {
      this.say('Stand at a settlement token or a mailbox to put one up.');
      return;
    }
    // What it would hold, said under the boxes and said again as they change.
    const held = document.createElement('div');
    held.className = 'skill-note market-note';
    held.textContent = this.holds();
    const form = document.createElement('div');
    form.className = 'panel-bar market-order';
    const list = kindList();
    const kind = document.createElement('input');
    kind.type = 'text';
    kind.className = 'panel-select market-kind';
    kind.placeholder = 'What you want';
    kind.title = 'Anything of this kind will do, whatever it is made of';
    kind.setAttribute('list', list.id);
    kind.value = this.wanted.name;
    kind.addEventListener('input', () => (this.wanted.name = kind.value));
    const box = (value: number, least: number, title: string, set: (n: number) => void): HTMLInputElement => {
      const el = document.createElement('input');
      el.type = 'number';
      el.min = String(least);
      el.className = 'panel-select market-count';
      el.value = String(value);
      el.title = title;
      el.addEventListener('input', () => {
        set(Math.max(least, Math.floor(Number(el.value) || least)));
        held.textContent = this.holds();
      });
      return el;
    };
    const ql = box(this.wanted.ql, 0, 'The least quality that will do; nought takes any', (n) => (this.wanted.ql = Math.min(100, n)));
    ql.max = '100';
    const count = box(this.wanted.count, 1, 'How many you want', (n) => (this.wanted.count = n));
    const price = box(this.wanted.price, 1, 'Silver for each one brought', (n) => (this.wanted.price = n));
    form.append(kind, field('quality at least', ql), field('how many', count), field('silver each', price),
      this.button('Put it up', 'The whole price comes out of your purse now', () => {
        const def = kindNamed(this.wanted.name);
        if (!def) {
          this.game.logMsg('There is no such thing to ask for. Choose one off the list.', 'error');
          return;
        }
        const { ql: least, count: n, price: each } = this.wanted;
        void this.act(this.island!.order(def, n, each, least).then((why) => {
          if (!why) this.wanted = { name: '', ql: 0, count: 1, price: 1 };
          return why;
        }));
      }));
    this.page.append(form, list, held);
  }

  /** What the order being written would hold, and for how long, against what you carry. */
  private holds(): string {
    const { count, price } = this.wanted;
    return `It holds ${priceWords(count * price)} out of your purse until it is filled, until you take it back, `
      + `or for ${spanWords(ORDER_LIFE)}, when it lapses and gives back what is left. `
      + `You are carrying ${priceWords(purse(this.game.inventory.items))}.`;
  }

  /** A tick list of what is in your pack, to offer or to post. A crate with a wildermon in it is on it too. */
  private pick(into: Set<number>, doing: string): void {
    // Nothing put by and no coin: coins go by the number in the box, not by the stack.
    const pack = this.game.inventory.items.filter((it) => !it.locked && it.id !== 'coin');
    const list = document.createElement('div');
    list.className = 'market-pick';
    for (const it of pack.slice(0, PICK_SHOWN)) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = into.has(it.uid);
      box.addEventListener('change', () => {
        if (box.checked) into.add(it.uid);
        else into.delete(it.uid);
      });
      const name = document.createElement('span');
      const occupant = it.creature === undefined ? undefined : this.game.creatures.get(it.creature);
      const named = occupant ? `${itemName(it)} — ${occupant.name}, ${speciesName(occupant.species)}` : itemName(it);
      name.textContent = it.count > 1 ? `${named} (${it.count})` : named;
      label.append(box, name);
      list.append(label);
    }
    this.page.append(list);
    if (pack.length > PICK_SHOWN) {
      this.say(`…and ${pack.length - PICK_SHOWN} more. ${doing} what is at the top of your pack, or put the rest away first.`);
    }
  }

  private drawPost(): void {
    this.head('Waiting for you');
    if (!this.waiting.things.length) {
      this.say('Nothing in the post. A parcel goes in at one mailbox and comes out at any other, '
        + 'so you need one within reach to send and they need one to collect.');
    }
    for (const t of this.waiting.things) {
      const row = document.createElement('div');
      row.className = 'skill-row';
      const text = document.createElement('span');
      text.textContent = `${t.count > 1 ? `${t.count} × ` : ''}${nameOf(t)}${t.from ? ` — from ${t.from}` : ''}`;
      row.append(text);
      this.page.append(row);
    }
    if (this.waiting.things.length) {
      const bar = document.createElement('div');
      bar.className = 'panel-bar';
      bar.append(this.button('Collect it all', this.waiting.at_box ? 'Out of the box and into your pack' : 'Stand at a mailbox first',
        () => void this.act(this.island!.collect())));
      this.page.append(bar);
      if (!this.waiting.at_box) this.say('Stand at a mailbox to draw it out. Any mailbox will do.');
    }

    /*
     * And sending: tick what goes, write a line with it, choose who. It goes
     * into the post at the mailbox you stand at and is theirs from then on,
     * waiting for them at any mailbox.
     */
    this.head('Send a parcel');
    if (!this.waiting.at_box) {
      this.say('Stand at a mailbox to send one.');
      return;
    }
    const people = this.folk();
    if (!people.length) {
      this.say('You know nobody to send anything to yet. Anybody you share land with, or have written to, is somebody you can post to.');
      return;
    }
    this.pick(this.posting, 'Send');
    const bar = document.createElement('div');
    bar.className = 'panel-bar';
    const note = document.createElement('input');
    note.type = 'text';
    note.maxLength = LETTER_MAX;
    note.className = 'panel-select market-note-input';
    note.placeholder = 'A line with it';
    note.value = this.note;
    note.addEventListener('input', () => (this.note = note.value));
    const who = document.createElement('select');
    who.className = 'panel-select';
    for (const f of people) {
      const o = document.createElement('option');
      o.value = f.uid;
      o.textContent = f.name;
      who.append(o);
    }
    bar.append(note, who, this.button('Send', 'It is theirs from the moment it goes in', () => {
      const items = [...this.posting];
      this.posting.clear();
      const text = this.note;
      this.note = '';
      void this.act(this.island!.post(who.value, text, items));
    }));
    this.page.append(bar);
  }
}

/** How many things of the pack a tick list shows. */
const PICK_SHOWN = 40;

/** A thing in a deal or in the post, named the way the pack names it, and a crate with who is in it. */
const nameOf = (t: { def: string; extra: string | null; ql: number; count: number; creature?: Occupant | null }): string => {
  const named = itemName({ uid: 0, id: t.def, extra: t.extra ?? undefined, ql: t.ql, count: t.count, dmg: 0 } as Item);
  return t.creature ? `${named} — ${t.creature.name}, ${speciesName(t.creature.species)}` : named;
};
/** A species as a sentence names it. */
const speciesName = (id: string): string => (SPECIES[id]?.name ?? id).toLowerCase();
const goodName = (g: Good): string => (g.count > 1 ? `${g.count} × ${nameOf(g)}` : nameOf(g));

/**
 * Every kind of thing an order may ask for, as the pack names it: all but
 * coins, which are what an order pays with. Worked out the first time it is
 * asked for rather than when this file loads, by which time every table that
 * adds a kind of its own has added it.
 */
const orderable = (): Array<[string, string]> =>
  Object.entries(ITEM_DEFS).filter(([id]) => id !== 'coin').map(([id, d]) => [id, d.name] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));
let kinds: Map<string, string> | null = null;
/** The kind of thing typed into an order, by its name, whatever case it was typed in. */
const kindNamed = (name: string): string | undefined =>
  (kinds ??= new Map(orderable().map(([id, n]) => [n.toLowerCase(), id]))).get(name.trim().toLowerCase());
let kindsOffered: HTMLDataListElement | null = null;
/** The names offered as one is typed. */
const kindList = (): HTMLDataListElement => {
  if (kindsOffered) return kindsOffered;
  kindsOffered = document.createElement('datalist');
  kindsOffered.id = 'market-kinds';
  for (const [, name] of orderable()) {
    const o = document.createElement('option');
    o.value = name;
    kindsOffered.append(o);
  }
  return kindsOffered;
};

/** A box with what it is for written in front of it. */
const field = (label: string, input: HTMLInputElement): HTMLLabelElement => {
  const el = document.createElement('label');
  el.className = 'market-field';
  el.append(label, input);
  return el;
};

