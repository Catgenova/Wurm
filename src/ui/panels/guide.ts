import type { Game } from '../../game/game';
import { SPECIES, type SpeciesDef } from '../../game/creatures';
import { countsLine, GUIDE_MARKS, guidePage, guidePages, keepable, MARK_NAMES, type GuideMark } from '../../game/guide';
import type { Island } from '../../net/island';
import { drawCreaturePortrait } from '../../render/sprites';
import type { UIWindow } from '../windows';

/** How big a kind is drawn on the index and on its own page, in CSS pixels. */
const CARD = { w: 76, h: 56 };
const PAGE = { w: 150, h: 104 };
/** Which way round a kind is drawn: three quarters on, facing to the right. */
const FACING = 1;
/** The one colour a kind nobody has seen is drawn in. */
const SHADOW = '#4f4538';

/**
 * The field guide: every kind there is, as a collection. The index draws the
 * kinds you have seen and names them, and leaves the rest as their shape in
 * shadow; each has a page, turned to from the index, from the page either
 * side of it, or from a creature's own menu.
 *
 * Nothing here works anything out. The marks are the book's (`game.guide`) and
 * every line on a page is `guidePage`'s, read off the kind's definition. On an
 * island the book is the island's, asked for once each time the window opens,
 * and what comes back is added to what this side already holds.
 */
export class GuidePanel {
  private readonly counts: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly view: HTMLDivElement;
  /** The kind whose page is open, or null for the index. */
  private shown: string | null = null;
  /** Pictures already drawn, by kind and by whether it has been seen, since a drawing does not change. */
  private readonly pictures = new Map<string, HTMLCanvasElement>();
  /** What was last drawn, so a mark that changes nothing on screen redraws nothing. */
  private drawn = '';
  /** Whether the island's answer is on its way, and whether the last ask came back empty. */
  private asking = false;
  private failed = false;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly island: Island | null,
  ) {
    win.body.classList.add('guide-body');
    this.counts = document.createElement('div');
    this.counts.className = 'guide-counts';
    this.bar = document.createElement('div');
    this.bar.className = 'panel-bar guide-bar';
    this.view = document.createElement('div');
    win.body.append(this.counts, this.bar, this.view);
    win.onOpen = () => void this.refresh();
    game.events.on('guide', () => {
      if (this.win.isOpen) this.draw();
    });
    // Nothing is drawn for a window that starts shut, which is forty pictures
    // nobody may look at; one the layout left open is drawn now.
    if (win.isOpen) void this.refresh();
  }

  /** Open the book at a kind's page. */
  openAt(species: string): void {
    this.shown = SPECIES[species] ? species : null;
    if (this.win.isOpen) {
      this.win.focus();
      this.draw();
    } else this.win.open();
  }

  /** Asked of the island once as the window opens; alone, the book is already here. */
  private async refresh(): Promise<void> {
    this.draw();
    if (!this.island || this.asking) return;
    this.asking = true;
    try {
      const book = await this.island.guide();
      this.failed = !book;
      if (book) this.game.guideRead(book);
    } finally {
      this.asking = false;
    }
    this.draw();
  }

  private draw(): void {
    const g = this.game.guide;
    const key = `${this.shown}|${this.failed}|${[...g.seen].sort()}|${[...g.tamed].sort()}|${[...g.bred].sort()}`;
    if (key === this.drawn) return;
    this.drawn = key;
    this.counts.textContent = countsLine(g);
    this.counts.title = 'Kinds seen out of every kind there is; tamed and bred out of the kinds that can be, which the monsters cannot';
    this.bar.replaceChildren();
    this.view.replaceChildren();
    if (this.failed) this.say('The island did not answer just now, so this is what it said last. It is asked again each time the window opens.');
    const def = this.shown ? SPECIES[this.shown] : undefined;
    if (def) this.drawPage(def);
    else this.drawIndex();
  }

  /** Every kind, a card each: drawn and named once seen, a shadow until then. */
  private drawIndex(): void {
    this.bar.hidden = true;
    const grid = document.createElement('div');
    grid.className = 'guide-grid';
    const g = this.game.guide;
    guidePages().forEach((def, i) => {
      const seen = g.seen.has(def.id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `guide-card${seen ? '' : ' guide-unseen'}`;
      card.append(this.picture(def, seen, CARD.w, CARD.h));
      const name = document.createElement('span');
      name.className = 'guide-name';
      name.textContent = seen ? def.name : `No. ${i + 1}`;
      card.append(name);
      const tags = document.createElement('span');
      tags.className = 'guide-tags';
      for (const m of ['tamed', 'bred'] as const) {
        if (!g.has(def.id, m)) continue;
        const tag = document.createElement('span');
        tag.className = 'guide-tag';
        tag.textContent = MARK_NAMES[m].toLowerCase();
        tags.append(tag);
      }
      card.append(tags);
      card.title = seen ? `${def.name}: ${this.marksSaid(def)}` : 'Not seen yet';
      card.addEventListener('click', () => this.turnTo(def.id));
      grid.append(card);
    });
    this.view.append(grid);
  }

  /** One kind's page: its picture and marks, and then what the book says of it, once it has been seen. */
  private drawPage(def: SpeciesDef): void {
    const pages = guidePages();
    const at = pages.findIndex((d) => d.id === def.id);
    this.bar.hidden = false;
    const button = (text: string, title: string, go: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-btn tb-small';
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', go);
      return b;
    };
    const back = pages[(at - 1 + pages.length) % pages.length];
    const next = pages[(at + 1) % pages.length];
    const where = document.createElement('span');
    where.className = 'guide-where';
    where.textContent = `No. ${at + 1} of ${pages.length}`;
    this.bar.append(
      button('Index', 'Every kind, a card each', () => this.turnTo(null)),
      button('‹', 'The page before', () => this.turnTo(back.id)),
      button('›', 'The page after', () => this.turnTo(next.id)),
      where,
    );

    const seen = this.game.guide.seen.has(def.id);
    const head = document.createElement('div');
    head.className = 'guide-head';
    head.append(this.picture(def, seen, PAGE.w, PAGE.h));
    const side = document.createElement('div');
    side.className = 'guide-side';
    const name = document.createElement('div');
    name.className = 'guide-title';
    name.textContent = seen ? def.name : 'Not seen yet';
    side.append(name);
    if (seen) {
      const marks = document.createElement('div');
      marks.className = 'guide-marks';
      for (const m of GUIDE_MARKS) {
        if (m !== 'seen' && !keepable(def)) continue;
        const chip = document.createElement('span');
        const has = this.game.guide.has(def.id, m);
        chip.className = `guide-mark${has ? ' guide-mark-on' : ''}`;
        chip.textContent = MARK_NAMES[m];
        chip.title = has ? `${MARK_NAMES[m]}` : `Not ${MARK_NAMES[m].toLowerCase()} yet`;
        marks.append(chip);
      }
      side.append(marks);
    }
    head.append(side);
    this.view.append(head);
    // A kind nobody has seen is its shape and nothing else.
    if (!seen) return;
    for (const s of guidePage(def, !!this.island)) {
      const h = document.createElement('div');
      h.className = 'skill-group';
      h.textContent = s.head;
      const list = document.createElement('ul');
      list.className = 'guide-lines';
      for (const line of s.lines) {
        const li = document.createElement('li');
        li.textContent = line;
        list.append(li);
      }
      this.view.append(h, list);
    }
  }

  /** "seen, tamed, not bred yet", for a card's hover. */
  private marksSaid(def: SpeciesDef): string {
    const marks: GuideMark[] = keepable(def) ? GUIDE_MARKS : ['seen'];
    return marks.map((m) => (this.game.guide.has(def.id, m) ? MARK_NAMES[m].toLowerCase() : `not ${MARK_NAMES[m].toLowerCase()} yet`)).join(', ');
  }

  private turnTo(species: string | null): void {
    this.shown = species;
    this.draw();
    // A new page is read from the top, and so is the index come back to.
    this.win.body.scrollTop = 0;
  }

  /**
   * A kind's picture, drawn once at this size and kept: in its own colours
   * once seen, and as a shadow of its shape until then.
   */
  private picture(def: SpeciesDef, seen: boolean, w: number, h: number): HTMLCanvasElement {
    const key = `${def.id}|${seen}|${w}x${h}`;
    let pic = this.pictures.get(key);
    if (!pic) {
      pic = document.createElement('canvas');
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      pic.width = Math.round(w * dpr);
      pic.height = Math.round(h * dpr);
      pic.style.width = `${w}px`;
      pic.style.height = `${h}px`;
      pic.className = 'guide-picture';
      const ctx = pic.getContext('2d');
      if (ctx) drawCreaturePortrait(ctx, pic.width, pic.height, def.id, def.variants[0], FACING, seen ? undefined : SHADOW);
      this.pictures.set(key, pic);
    }
    // Put in its new place, which takes it out of the old one: the index and a
    // page are never up at once, and they draw at different sizes anyway.
    return pic;
  }

  private say(text: string): void {
    const el = document.createElement('div');
    el.className = 'skill-note market-note';
    el.textContent = text;
    this.view.append(el);
  }
}
