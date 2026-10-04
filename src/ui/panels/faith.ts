import {
  ALIGNMENT_NAMES, FAITH_TIER_AT, PATRON_AT, PATRON_BY_ID, PATRONS, SPELL_BAR, SPELLS_PER_TIER, slotsFor, spellOnText, spellsOf,
  type FaithSpellDef, type PatronDef, type PatronId,
} from '../../game/patrons';
import { listed, NumberWord, numberWord } from '../../game/words';
import type { FaithBook } from '../faithbook';
import type { UIWindow } from '../windows';

/**
 * Faith: your patron, and the spells it gives.
 *
 * A tab for each of the three patrons, each laying open its tiers of spells,
 * so any of them can be read before one is taken; your own patron's tab is
 * the one that opens. Taking a patron and taking a spell are both for good,
 * so neither happens on one press: the first says what the second will do,
 * as the Trades window does.
 *
 * As there, nothing about you is worked out here. The island keeps your
 * patron, your spells and your bar (`faith_said`), and every refusal under a
 * button is the island's own sentence. What a patron offers is read from
 * `src/game/patrons.ts`, which is what the island's rows came from.
 */

/** How often the window asks again while it is open, in seconds. */
const REFRESH = 4;

export class FaithPanel {
  private readonly tabs = new Map<PatronId, HTMLButtonElement>();
  private readonly page: HTMLDivElement;
  private viewing: PatronId = PATRONS[0].id;
  /** Whether a tab was clicked, after which your own patron no longer takes the window back. */
  private chose = false;
  /** The one choice waiting on its second press: `patron:<id>` or `spell:<id>`. */
  private confirming: string | null = null;
  /** The island's last refusal of a press in this window. */
  private why: string | null = null;
  private lastAsk = -1e9;
  /** The last answer drawn, so an unchanged one does not throw away the button under the pointer. */
  private seen = '';

  constructor(
    private readonly win: UIWindow,
    private readonly book: FaithBook,
  ) {
    win.body.classList.add('trade-body');
    const bar = document.createElement('div');
    bar.className = 'trade-tabs';
    for (const p of PATRONS) {
      const b = button(p.name);
      b.addEventListener('click', () => {
        this.viewing = p.id;
        this.chose = true;
        this.confirming = null;
        this.draw();
      });
      this.tabs.set(p.id, b);
      bar.append(b);
    }
    this.page = document.createElement('div');
    this.page.className = 'trade-page';
    win.body.append(bar, this.page);
    book.on(() => this.draw());
    win.onOpen = () => {
      this.lastAsk = -1e9;
      this.why = null;
      this.draw();
    };
    this.draw();
  }

  /** Asked on a clock while the window is up, because favour comes back and faith goes up while it is open. */
  update(now: number): void {
    if (!this.win.isOpen || !this.book.island) return;
    if (now - this.lastAsk < REFRESH) return;
    this.lastAsk = now;
    void this.book.ask();
  }

  private draw(): void {
    const s = this.book.said;
    if (!this.chose && s?.patron && PATRON_BY_ID.has(s.patron as PatronId)) this.viewing = s.patron as PatronId;
    const key = JSON.stringify([s, this.viewing, this.confirming, this.why]);
    if (key === this.seen) return;
    this.seen = key;
    for (const [id, b] of this.tabs) b.classList.toggle('tb-on', id === this.viewing);
    const top = this.page.scrollTop;
    this.page.replaceChildren();
    this.drawPage();
    this.page.scrollTop = top;
  }

  private drawPage(): void {
    const s = this.book.said;
    if (!this.book.island) {
      this.page.append(note('Patrons are the island’s to keep. Playing by yourself in this browser there is nobody to keep one, so none can be taken, but what each offers is here to read.'));
    } else if (!s) {
      this.page.append(note('Asking the island about your faith…'));
    } else {
      const mine = s.patron ? PATRON_BY_ID.get(s.patron as PatronId)?.name ?? s.patron : null;
      this.page.append(note(`Faith ${s.faith.toFixed(1)} · favour ${s.favour} of ${s.cap} · ${mine ? `your patron is ${mine}` : `a patron is taken at ${PATRON_AT} faith`}`));
    }
    if (this.why) this.page.append(whyEl(this.why));
    const p = PATRON_BY_ID.get(this.viewing);
    if (!p) return;
    this.page.append(this.patronCard(p));
    FAITH_TIER_AT.forEach((at, i) => this.page.append(this.tierBlock(p, i + 1, at)));
  }

  private patronCard(p: PatronDef): HTMLDivElement {
    const s = this.book.said;
    const card = document.createElement('div');
    card.className = 'trade-card';
    if (s?.patron === p.id) card.classList.add('trade-mine');
    const top = document.createElement('div');
    top.className = 'trade-card-top';
    const name = document.createElement('span');
    name.className = 'trade-name';
    name.textContent = p.name;
    const align = document.createElement('span');
    align.className = `faith-align faith-${p.alignment}`;
    align.textContent = ALIGNMENT_NAMES[p.alignment];
    top.append(name, align);
    card.append(top);
    card.append(cardNote(`${NumberWord(SPELLS_PER_TIER)} spells at each of ${numberWord(FAITH_TIER_AT.length)} tiers, at ${listed(FAITH_TIER_AT.map(String))} faith; one is taken at each tier, ${numberWord(FAITH_TIER_AT.length)} in all, and ${numberWord(slotsFor('faith'))} of them go on the spell bar at a time.`));
    if (!s) return card;
    if (s.patron === p.id) {
      card.append(cardNote(`Your patron, since ${PATRON_AT} faith. Its spells are below.`));
      return card;
    }
    if (s.patron) return card;
    const ask = `patron:${p.id}`;
    if (this.confirming === ask) {
      card.append(this.confirm(`Take ${p.name} as your patron?`, [
        'A patron is for good: no other can be taken after it.',
        `Its first tier of spells opens with it, the rest at ${listed(FAITH_TIER_AT.slice(1).map(String))} faith.`,
      ], `Take ${p.name}`, () => this.book.takePatron(p.id)));
      return card;
    }
    const why = s.patrons[p.id] ?? null;
    const acts = document.createElement('div');
    acts.className = 'trade-acts';
    const take = button(`Take ${p.name} as patron`, 'trade-take');
    take.disabled = !!why;
    take.addEventListener('click', () => {
      this.confirming = ask;
      this.why = null;
      this.draw();
    });
    acts.append(take);
    card.append(acts);
    if (why) card.append(whyEl(why));
    return card;
  }

  private tierBlock(p: PatronDef, tier: number, at: number): HTMLDivElement {
    const s = this.book.said;
    const block = document.createElement('div');
    block.className = 'trade-tier faith-tier';
    const open = !!s && s.faith >= at;
    if (s && !open) block.classList.add('trade-tier-shut');
    const head = document.createElement('div');
    head.className = 'trade-col-head';
    head.textContent = `Tier ${tier} · ${at} faith${s ? (open ? ' · open' : '') : ''}`;
    block.append(head);
    const spells = spellsOf(p.id, tier);
    if (!spells.length) {
      block.append(note(`No spells are written for this tier yet: ${numberWord(SPELLS_PER_TIER)} will be, and one of them taken.`));
      return block;
    }
    for (const sp of spells) block.append(this.spellCard(p, sp));
    return block;
  }

  private spellCard(p: PatronDef, sp: FaithSpellDef): HTMLDivElement {
    const s = this.book.said;
    const card = document.createElement('div');
    card.className = 'trade-node';
    const taken = !!s?.taken.includes(sp.id);
    if (taken) card.classList.add('trade-node-taken');
    const top = document.createElement('div');
    top.className = 'trade-card-top';
    const name = document.createElement('span');
    name.className = 'trade-node-name';
    name.textContent = sp.name;
    const cost = document.createElement('span');
    cost.className = 'trade-points';
    cost.textContent = `${sp.cost} favour · rests ${sp.rest} s`;
    top.append(name, cost);
    card.append(top, cardNote(`${sp.note} Cast on ${spellOnText(sp)}.`));
    if (!s || s.patron !== p.id) return card;
    if (taken) {
      const slot = s.bar.indexOf(sp.id);
      if (slot >= 0) {
        card.append(cardNote(`On the spell bar, slot ${slot + 1} (Shift+${slot + 1}).`));
      } else {
        const acts = document.createElement('div');
        acts.className = 'trade-acts';
        const put = button('Put on the spell bar', 'trade-take');
        put.addEventListener('click', () => void this.putOnBar(sp.id));
        acts.append(put);
        card.append(acts);
      }
      return card;
    }
    const ask = `spell:${sp.id}`;
    if (this.confirming === ask) {
      card.append(this.confirm(`Take ${sp.name} at tier ${sp.tier}?`, [
        `One spell is taken at each tier, for good: the other ${numberWord(SPELLS_PER_TIER - 1)} at this tier close.`,
      ], `Take ${sp.name}`, () => this.book.takeSpell(sp.id)));
      return card;
    }
    const why = s.spells[sp.id] ?? null;
    const acts = document.createElement('div');
    acts.className = 'trade-acts';
    const take = button('Take', 'trade-take');
    take.disabled = !!why;
    take.addEventListener('click', () => {
      this.confirming = ask;
      this.why = null;
      this.draw();
    });
    acts.append(take);
    card.append(acts);
    if (why) card.append(whyEl(why));
    return card;
  }

  /** Into the first faith slot with nothing in it, or the first faith slot when both are full. */
  private async putOnBar(id: string): Promise<void> {
    const bar = this.book.said?.bar ?? [];
    const faith = SPELL_BAR.map((school, i) => (school === 'faith' ? i : -1)).filter((i) => i >= 0);
    const slot = faith.find((i) => !bar[i]) ?? faith[0];
    this.why = await this.book.setSlot(slot, id);
    this.draw();
  }

  /** The second press, and the way out of it. */
  private confirm(ask: string, lines: string[], yes: string, act: () => Promise<string | null>): HTMLDivElement {
    const box = document.createElement('div');
    box.className = 'trade-confirm';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', ask);
    const q = document.createElement('div');
    q.className = 'trade-confirm-ask';
    q.textContent = ask;
    box.append(q);
    for (const line of lines) {
      const d = document.createElement('div');
      d.className = 'trade-confirm-line';
      d.textContent = line;
      box.append(d);
    }
    const acts = document.createElement('div');
    acts.className = 'trade-acts';
    const go = button(yes, 'trade-take trade-go');
    go.addEventListener('click', () => {
      go.disabled = true;
      this.confirming = null;
      void act().then((why) => {
        this.why = why;
        this.draw();
      });
    });
    const no = button('Not yet', 'trade-take');
    no.addEventListener('click', () => {
      this.confirming = null;
      this.draw();
    });
    acts.append(go, no);
    box.append(acts);
    return box;
  }
}

function button(label: string, extra = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `tb-btn tb-small${extra ? ` ${extra}` : ''}`;
  b.textContent = label;
  return b;
}

function note(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'trade-note';
  d.textContent = text;
  return d;
}

function cardNote(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'trade-card-note';
  d.textContent = text;
  return d;
}

/** The island's sentence, never ours: why this will not do anything. */
function whyEl(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'trade-why';
  d.textContent = text;
  return d;
}
