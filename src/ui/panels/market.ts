import type { Deal, Island, Parcel } from '../../net/island';
import type { Game } from '../../game/game';
import { billWords, itemName, type Item } from '../../game/items';
import { furnitureDef } from '../../game/furniture';
import { priceWords, purse } from '../../game/money';
import type { UIWindow } from '../windows';

/** How often the window asks again while it is open. */
const REFRESH = 5;

/**
 * Where goods change hands.
 *
 * Coins have existed since there was an anvil to strike them on and have
 * never bought anything, because there was nothing to buy them with and
 * nobody to buy from. Three tabs, and they are three because they answer
 * three different questions:
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
 * rather than showing three empty tabs: there is one person in that game and
 * none of these is a thing you do alone.
 */
export class MarketPanel {
  private readonly bar: HTMLDivElement;
  private readonly page: HTMLDivElement;
  private readonly tabs = new Map<string, HTMLButtonElement>();
  private tab: 'deals' | 'stall' | 'post' = 'deals';
  private deals: Deal[] = [];
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
      ['deals', 'Deals', 'Offers out and offers in'],
      ['stall', 'Stall', 'What you have laid out, and what it has taken'],
      ['post', 'Post', 'Parcels waiting at a mailbox'],
    ] as Array<['deals' | 'stall' | 'post', string, string]>) {
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

  private show(id: 'deals' | 'stall' | 'post'): void {
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

  private async refresh(): Promise<void> {
    if (!this.island || this.asking) return;
    this.asking = true;
    try {
      this.deals = await this.island.deals();
      this.waiting = await this.island.waiting();
    } finally {
      this.asking = false;
    }
    this.draw();
  }

  private async act(go: Promise<string | null>): Promise<void> {
    const why = await go;
    if (why) this.game.logMsg(why, 'error');
    this.clock = REFRESH;
    await this.refresh();
  }

  private draw(): void {
    this.page.replaceChildren();
    if (!this.island) {
      this.say('There is one person on this island, and every one of these wants somebody else. '
        + 'Deals, stalls and the post are for an island with other people on it.');
      return;
    }
    if (this.tab === 'deals') this.drawDeals();
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
    // Nothing put by, no coin, and no crate with a wildermon in it, which goes nowhere but down on the ground.
    const pack = this.game.inventory.items.filter((it) => !it.locked && it.id !== 'coin' && it.creature === undefined);
    const list = document.createElement('div');
    list.className = 'market-pick';
    for (const it of pack.slice(0, 40)) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = this.picked.has(it.uid);
      box.addEventListener('change', () => {
        if (box.checked) this.picked.add(it.uid);
        else this.picked.delete(it.uid);
      });
      const name = document.createElement('span');
      name.textContent = it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it);
      label.append(box, name);
      list.append(label);
    }
    this.page.append(list);
    if (pack.length > 40) this.say(`…and ${pack.length - 40} more. Offer what is at the top of your pack, or put the rest away first.`);

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
     * till underneath, which is the part no other window has a place for.
     */
    const stalls = [...this.game.furniture.values()].filter((f) => f.kind === 'stall');
    if (!stalls.length) {
      this.say(`You have no stall. Nail one up — ${billWords(furnitureDef('stall').bill)} — `
        + 'and stand it somewhere people walk past.');
      return;
    }
    for (const f of stalls) {
      this.head(`Stall at ${f.x},${f.y}`);
      const till = (f as { till?: number }).till ?? 0;
      const row = document.createElement('div');
      row.className = 'skill-row';
      const text = document.createElement('span');
      text.textContent = till > 0 ? `The till holds ${priceWords(till)}.` : 'The till is empty.';
      row.append(text);
      if (till > 0) row.append(this.button('Take the takings', 'Stand at the counter', () => void this.act(this.island!.takings(f.id))));
      this.page.append(row);
      const goods = f.items ?? [];
      if (!goods.length) this.say('Nothing on the counter. Put something in it, then set a price.');
      for (const it of goods) {
        const line = document.createElement('div');
        line.className = 'skill-row';
        const name = document.createElement('span');
        const asking = (it as Item & { price?: number }).price ?? 0;
        name.textContent = `${itemName(it)}${asking ? ` — ${priceWords(asking)}` : ' — not for sale'}`;
        const box = document.createElement('input');
        box.type = 'number';
        box.min = '0';
        box.className = 'panel-select market-price';
        box.value = String(asking);
        line.append(name, box, this.button('Set', 'Nought takes it off sale', () =>
          void this.act(this.island!.setPrice(it.uid, Math.max(0, Number(box.value) || 0)))));
        this.page.append(line);
      }
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
  }
}

/** A thing in a deal or in the post, named the way the pack names it. */
const nameOf = (t: { def: string; extra: string | null; ql: number; count: number }): string =>
  itemName({ uid: 0, id: t.def, extra: t.extra ?? undefined, ql: t.ql, count: t.count, dmg: 0 } as Item);
