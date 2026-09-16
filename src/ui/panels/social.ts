import type { Folk, Island, Letter, MyDeed, Social } from '../../net/island';
import type { Game } from '../../game/game';
import type { UIWindow } from '../windows';

/** How often the window asks again while it is open. */
const REFRESH = 6;

/**
 * Everybody, and what they are to you.
 *
 * Three tabs, because they are three questions somebody asks at three
 * different moments: *who is waiting on me*, *who do I know and where are
 * they*, and *what has been said*. One window rather than three because they
 * are all one thing — the people on this island — and because the first of
 * them is a thing you answer once and never think about again.
 *
 * The whole page comes from one ask (`rpc_social`), so it is never half one
 * moment and half another. It asks again while it is open and after anything
 * it does, and not at all while it is shut: an invitation and a friend's
 * asking both announce themselves in the log the second they happen, which is
 * what actually needs to be prompt.
 */
export class SocialPanel {
  private readonly bar: HTMLDivElement;
  private readonly page: HTMLDivElement;
  private readonly tabs = new Map<string, HTMLButtonElement>();
  private tab: 'waiting' | 'friends' | 'letters' = 'waiting';
  private seen: Social | null = null;
  private asking = false;
  private lastAsk = -1e9;
  /** Whose thread is open on the letters tab, and what is in it. */
  private talkingTo: Folk | null = null;
  private thread: Letter[] = [];
  private draft = '';

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly island: Island | null,
  ) {
    win.body.classList.add('social-body');
    this.bar = document.createElement('div');
    this.bar.className = 'log-tabs';
    for (const [id, label, title] of [
      ['waiting', 'Waiting', 'Invitations and askings that want an answer'],
      ['friends', 'Friends', 'Who you know, and where they are'],
      ['letters', 'Letters', 'What has been written to you'],
    ] as Array<['waiting' | 'friends' | 'letters', string, string]>) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tb-btn tb-small log-tab${id === this.tab ? ' tb-on' : ''}`;
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => {
        this.tab = id;
        this.talkingTo = null;
        this.draw();
      });
      this.tabs.set(id, b);
      this.bar.append(b);
    }
    this.page = document.createElement('div');
    this.page.className = 'social-page';
    win.body.append(this.bar, this.page);
    win.onOpen = () => void this.refresh(true);
    this.draw();
  }

  /** Ask again now and then, while anybody is looking. */
  update(now: number): void {
    if (!this.win.isOpen || now - this.lastAsk < REFRESH) return;
    this.lastAsk = now;
    void this.refresh(false);
  }

  /** Open on somebody, from wherever they were picked. */
  openOn(uid: string, tab: 'friends' | 'letters' = 'letters'): void {
    this.tab = tab;
    this.talkingTo = null;
    this.win.open();
    void this.refresh(true).then(() => {
      const who = this.find(uid);
      if (who && tab === 'letters') void this.openThread(who);
    });
  }

  private find(uid: string): Folk | null {
    const s = this.seen;
    if (!s) return null;
    return [...s.friends, ...this.neighbours(s), ...s.here].find((f) => f.uid === uid) ?? null;
  }

  /** Everybody off every roll of yours, each named once however many you share. */
  private neighbours(s: Social): Folk[] {
    const by = new Map<string, Folk>();
    for (const d of s.deeds) for (const f of d.folk) if (!by.has(f.uid)) by.set(f.uid, f);
    return [...by.values()];
  }

  private async refresh(force: boolean): Promise<void> {
    if (!this.island || this.asking) return;
    if (!force && !this.win.isOpen) return;
    this.asking = true;
    try {
      const said = await this.island.social();
      if (said) this.seen = said;
    } finally {
      this.asking = false;
    }
    this.draw();
  }

  /** Do a thing, say why it would not, and look again either way. */
  private async did(what: Promise<string | null>): Promise<void> {
    const why = await what;
    if (why) this.game.logMsg(why, 'error');
    await this.refresh(true);
  }

  private async openThread(who: Folk): Promise<void> {
    if (!this.island) return;
    // From wherever it was asked for: `Write` sits on the Friends tab too, and
    // the thread is only drawn on this one.
    this.tab = 'letters';
    this.talkingTo = who;
    this.thread = await this.island.letters(who.uid);
    this.draw();
    // Reading the thread is what marks it read, so the count on the tab has
    // to come from a fresh ask rather than from the page it was drawn with.
    void this.refresh(true);
  }

  // -- the furniture ---------------------------------------------------------

  private head(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'deed-head';
    el.textContent = text;
    return el;
  }

  private empty(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'inv-empty';
    el.textContent = text;
    return el;
  }

  private button(label: string, title: string, go: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-btn tb-small social-do';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', go);
    return b;
  }

  /** One person: a light for whether they are about, a name, and what you can do. */
  private row(who: Folk, note: string, acts: HTMLButtonElement[]): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'social-row';
    const dot = document.createElement('span');
    dot.className = `social-dot${who.online ? ' social-on' : ''}`;
    dot.title = who.online ? 'Ashore now' : 'Away';
    const name = document.createElement('span');
    name.className = 'social-name';
    name.textContent = who.name;
    const where = document.createElement('span');
    where.className = 'social-where';
    where.textContent = note;
    const doing = document.createElement('span');
    doing.className = 'social-acts';
    doing.append(...acts);
    el.append(dot, name, where, doing);
    return el;
  }

  /** A row that is a question rather than a person: a name, a note, and buttons. */
  private plain(text: string, note: string, acts: HTMLButtonElement[]): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'social-row social-ask';
    const name = document.createElement('span');
    name.className = 'social-name';
    name.textContent = text;
    const where = document.createElement('span');
    where.className = 'social-where';
    where.textContent = note;
    const doing = document.createElement('span');
    doing.className = 'social-acts';
    doing.append(...acts);
    el.append(name, where, doing);
    return el;
  }

  /** Where somebody is, when the island is willing to say. */
  private whereabouts(who: Folk): string {
    if (!who.online) return 'away';
    if (typeof who.x !== 'number' || typeof who.y !== 'number') return 'ashore';
    return `${who.x}, ${who.y}`;
  }

  // -- the pages -------------------------------------------------------------

  private draw(): void {
    const s = this.seen;
    const waiting = s ? s.invites.length + s.asked.length : 0;
    const unread = s ? s.unread.reduce((n, u) => n + u.n, 0) : 0;
    this.tabs.get('waiting')?.classList.toggle('log-waiting', waiting > 0);
    const wt = this.tabs.get('waiting');
    if (wt) wt.textContent = waiting ? `Waiting (${waiting})` : 'Waiting';
    this.tabs.get('letters')?.classList.toggle('log-waiting', unread > 0);
    const lt = this.tabs.get('letters');
    if (lt) lt.textContent = unread ? `Letters (${unread})` : 'Letters';
    for (const [id, b] of this.tabs) b.classList.toggle('tb-on', id === this.tab);

    this.page.replaceChildren();
    this.page.classList.toggle('social-talking', this.tab === 'letters' && !!this.talkingTo);
    if (!this.island) {
      this.page.append(this.empty('You are playing by yourself, in this browser. There is nobody else here to know.'));
      return;
    }
    if (!s) {
      this.page.append(this.empty('Asking the island who is about…'));
      return;
    }
    if (this.tab === 'waiting') this.drawWaiting(s);
    else if (this.tab === 'friends') this.drawFriends(s);
    else this.drawLetters(s);
  }

  /** Everything that wants a yes or a no, and nothing that does not. */
  private drawWaiting(s: Social): void {
    const isle = this.island;
    if (!isle) return;
    if (!s.invites.length && !s.asked.length && !s.sent.length && !s.asking.length) {
      this.page.append(this.empty('Nothing is waiting on you. Right-click somebody on the island to invite them home or ask to be their friend.'));
      return;
    }
    if (s.invites.length) {
      this.page.append(this.head('Asked to live somewhere'));
      for (const inv of s.invites) {
        const el = document.createElement('div');
        el.className = 'social-row social-ask';
        const text = document.createElement('span');
        text.className = 'social-name';
        text.textContent = `${inv.by} · ${inv.deed}`;
        const acts = document.createElement('span');
        acts.className = 'social-acts';
        acts.append(
          this.button('Move in', `Become a citizen of ${inv.deed}`,
            () => void this.did(isle.answerInvite(inv.founder, true))),
          this.button('No', `Turn ${inv.by} down`,
            () => void this.did(isle.answerInvite(inv.founder, false))),
        );
        el.append(text, acts);
        this.page.append(el);
      }
    }
    if (s.asked.length) {
      this.page.append(this.head('Would like to be your friend'));
      for (const who of s.asked) {
        const el = document.createElement('div');
        el.className = 'social-row social-ask';
        const text = document.createElement('span');
        text.className = 'social-name';
        text.textContent = who.name;
        const acts = document.createElement('span');
        acts.className = 'social-acts';
        acts.append(
          this.button('Yes', `${who.name} becomes a friend`, () => void this.did(isle.befriend(who.uid))),
          this.button('No', `Turn ${who.name} down`, () => void this.did(isle.unfriend(who.uid))),
        );
        el.append(text, acts);
        this.page.append(el);
      }
    }
    if (s.sent.length) {
      this.page.append(this.head('Invitations you have out'));
      for (const who of s.sent) this.page.append(this.plain(who.name, 'not answered', []));
    }
    if (s.asking.length) {
      this.page.append(this.head('Friends you have asked'));
      for (const who of s.asking) {
        this.page.append(this.plain(who.name, 'not answered',
          [this.button('Withdraw', 'Take the asking back', () => void this.did(isle.unfriend(who.uid)))]));
      }
    }
  }

  /** Who you know, who you live with, and everybody else on the island. */
  private drawFriends(s: Social): void {
    const isle = this.island;
    if (!isle) return;
    this.page.append(this.head(`Friends (${s.friends.length})`));
    if (!s.friends.length) {
      this.page.append(this.empty('Nobody yet. Right-click somebody on the island, or pick a name below.'));
    }
    for (const who of s.friends) {
      this.page.append(this.row(who, this.whereabouts(who), [
        this.button('Write', `Write to ${who.name}`, () => void this.openThread(who)),
        this.button('Drop', `Take ${who.name} off the list`, () => void this.did(isle.unfriend(who.uid))),
      ]));
    }

    for (const d of s.deeds) this.drawDeed(s, d);
    if (!s.deeds.length) {
      this.page.append(this.head('Settlements'));
      this.page.append(this.empty('You hold none and live on none. Plant a stake, or wait to be asked.'));
    } else if (s.room > 0) {
      this.page.append(this.empty(`You may be a citizen of ${s.room} more.`));
    }

    const known = new Set([...s.friends, ...this.neighbours(s)].map((f) => f.uid));
    const strangers = s.here.filter((f) => !known.has(f.uid));
    this.page.append(this.head(`Everybody else ashore (${strangers.length})`));
    if (!strangers.length) this.page.append(this.empty('Nobody else has been here.'));
    for (const who of strangers) {
      const acts = [
        this.button('Befriend', `Ask ${who.name} to be a friend`, () => void this.did(isle.befriend(who.uid))),
        this.button('Write', `Write to ${who.name}`, () => void this.openThread(who)),
      ];
      const own = s.deeds.find((d) => d.mine);
      if (own) {
        acts.unshift(this.button('Invite', `Ask ${who.name} to live at ${own.name}`,
          () => void this.did(isle.invite(who.uid))));
      }
      this.page.append(this.row(who, this.whereabouts(who), acts));
    }
    /*
     * And why a stranger has a place beside their name, which will one day
     * stop being true without anybody deploying anything. Said here rather
     * than left to be noticed: the island decides this on a headcount, and a
     * rule that changes itself is a rule people should be able to read.
     */
    if (s.open !== undefined) {
      this.page.append(this.empty(s.open
        ? `While there are fewer than ${s.crowd ?? 0} people about, the island says where everybody is, and they are all on your map. That stops on its own once it fills up.`
        : `There are ${s.crowd ?? 0} or more people about, so the island says where your friends and neighbours are and no more.`));
    }
  }


  /**
   * One settlement of yours: who lives on it, and the way off it.
   *
   * The same block whether you planted the stake or were asked on. A founder
   * gets a way to take somebody off the roll; everybody else gets a way to
   * take themselves off it.
   */
  private drawDeed(s: Social, d: MyDeed): void {
    const isle = this.island;
    if (!isle) return;
    this.page.append(this.head(`${d.name} · ${d.mine ? 'yours' : `${d.by}'s`} · ${d.x}, ${d.y}`));
    if (!d.folk.length) {
      this.page.append(this.empty(d.mine
        ? 'Nobody else lives here yet. Right-click somebody and invite them.'
        : 'Nobody else lives here yet.'));
    }
    for (const who of d.folk) {
      const acts = [this.button('Write', `Write to ${who.name}`, () => void this.openThread(who))];
      if (d.mine && who.uid !== d.founder) {
        acts.push(this.button('Send away', `Take ${who.name} off the roll of ${d.name}`,
          () => void this.did(isle.leaveDeed(d.founder, who.uid))));
      }
      this.page.append(this.row(who, this.whereabouts(who), acts));
    }
    if (!d.mine) {
      this.page.append(this.plain(`You are a citizen of ${d.name}.`, '',
        [this.button('Leave', `Stop being a citizen of ${d.name}`,
          () => void this.did(isle.leaveDeed(d.founder)))]));
    }
  }

  /** What has been written: a list of correspondents, or one conversation. */
  private drawLetters(s: Social): void {
    const isle = this.island;
    if (!isle) return;
    if (this.talkingTo) {
      this.drawThread(this.talkingTo);
      return;
    }
    const unread = new Map(s.unread.map((u) => [u.uid, u.n]));
    const people = [...s.friends, ...this.neighbours(s)];
    for (const u of s.unread) {
      if (!people.some((p) => p.uid === u.uid)) people.push({ uid: u.uid, name: u.name, online: false });
    }
    this.page.append(this.head('Write to'));
    if (!people.length) {
      this.page.append(this.empty('Make a friend or move onto somebody’s land, and this is where you can write to them. Anybody ashore can be written to from the Friends tab.'));
      return;
    }
    for (const who of people) {
      const n = unread.get(who.uid) ?? 0;
      const el = this.row(who, n ? `${n} waiting` : this.whereabouts(who),
        [this.button('Open', `Read what ${who.name} has written`, () => void this.openThread(who))]);
      if (n) el.classList.add('social-unread');
      this.page.append(el);
    }
  }

  /** One conversation, and the box you answer in. */
  private drawThread(who: Folk): void {
    const isle = this.island;
    if (!isle) return;
    const back = document.createElement('div');
    back.className = 'social-row social-ask';
    const name = document.createElement('span');
    name.className = 'social-name';
    name.textContent = `${who.name} · ${this.whereabouts(who)}`;
    const acts = document.createElement('span');
    acts.className = 'social-acts';
    acts.append(this.button('Back', 'Everybody you write to', () => {
      this.talkingTo = null;
      this.draw();
    }));
    back.append(name, acts);

    const list = document.createElement('div');
    list.className = 'social-thread';
    if (!this.thread.length) {
      list.append(this.empty(`Nothing has been said between you and ${who.name} yet.`));
    }
    for (const line of this.thread) {
      const el = document.createElement('div');
      el.className = `social-said${line.mine ? ' social-mine' : ''}`;
      const from = document.createElement('span');
      from.className = 'social-from';
      from.textContent = line.mine ? 'You' : who.name;
      const text = document.createElement('span');
      text.className = 'social-text';
      text.textContent = line.text;
      el.title = new Date(line.at * 1000).toLocaleString();
      el.append(from, text);
      list.append(el);
    }

    const write = document.createElement('form');
    write.className = 'social-write';
    const box = document.createElement('input');
    box.type = 'text';
    box.id = 'social-draft';
    box.className = 'log-search';
    box.maxLength = 400;
    box.placeholder = `Write to ${who.name}…`;
    box.value = this.draft;
    box.addEventListener('input', () => {
      this.draft = box.value;
    });
    const send = this.button('Send', `Send it to ${who.name}`, () => void 0);
    send.type = 'submit';
    write.append(box, send);
    write.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = box.value.trim();
      if (!text) return;
      box.value = '';
      this.draft = '';
      void isle.writeTo(who.uid, text).then(async (why) => {
        if (why) this.game.logMsg(why, 'error');
        await this.openThread(who);
      });
    });

    this.page.append(back, list, write);
    // A conversation is read bottom-up, like every other one.
    list.scrollTop = list.scrollHeight;
  }
}
