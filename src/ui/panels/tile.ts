import type { Game } from '../../game/game';
import type { Pick } from '../../render/renderer';
import { buildMenuRows, type MenuItem } from '../contextmenu';
import { creatureSkills } from '../creatureinfo';
import { Repaint } from '../repaint';
import { groundReading, tileUses } from '../tileinfo';
import type { Tooltip } from '../tooltip';
import type { UIWindow } from '../windows';

/** What the window is looking at, and everything that could be done to it. */
export type TileMenuSource = (pick: Pick) => { title: string; facts?: string[]; entries: MenuItem[] };

/**
 * The tile window: click any tile and everything you could do to it is listed
 * here, the same list the right-click menu shows. It is for playing with one
 * button — a finger, a trackpad, or a left hand that would rather not reach for
 * the other one — and for seeing at a glance why something is not possible yet.
 */
/** Everything about an entry that shows on screen, for telling one list from the next. */
const sign = (e: MenuItem): string =>
  `${e.label}\u0001${e.disabled ? 1 : 0}\u0001${e.hint ?? ''}\u0001${e.note ?? ''}\u0001${e.children ? e.children.map(sign).join('\u0002') : ''}`;

/** The keys the list binds, in the order it hands them out. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export class TilePanel {
  private head: HTMLDivElement;
  private titleEl: HTMLSpanElement;
  /**
   * What is true of the ground, under the name: where the corner you picked
   * stands, and what a prospector read here.
   *
   * Both were mouseover lines and there is no mouseover on a phone. Lighting
   * ground up and then having no way to read it is most of the way to not
   * having prospected at all; marking a corner with a dot and never saying how
   * high it is leaves every corner action to be guessed at.
   */
  private factsEl: HTMLDivElement;
  /** The reading as last drawn, because it fades with nothing to announce it. */
  private reading: string | null = null;
  private info: HTMLButtonElement;
  /** Whether the note is up at all, by hover or by click. */
  private noteOpen = false;
  /** Whether it was pinned by a click, so it stays up when the pointer leaves. */
  private pinned = false;
  private list: HTMLDivElement;
  private pick: Pick | null = null;
  /** What each number key does right now, in the order the list shows them. */
  private keyed: MenuItem[] = [];
  /** Which submenus are open, kept across rebuilds. */
  private readonly folds = new Set<string>();
  private readonly repaint = new Repaint(250);

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly source: TileMenuSource,
    private readonly tooltip: Tooltip,
  ) {
    win.body.classList.add('inv-body');
    this.head = document.createElement('div');
    this.head.className = 'tile-head';
    this.titleEl = document.createElement('span');
    this.titleEl.className = 'tile-head-name';
    // What the thing is *for*, which is a different question from what can be
    // done to it this moment — and the list below already answers that one.
    this.info = document.createElement('button');
    this.info.className = 'tile-info';
    this.info.type = 'button';
    this.info.textContent = 'i';
    this.info.title = 'What this is good for';
    this.info.addEventListener('mouseenter', () => {
      this.noteOpen = true;
      this.showNote();
    });
    this.info.addEventListener('mouseleave', () => {
      if (this.pinned) return;
      this.noteOpen = false;
      this.tooltip.hide(this);
    });
    // A click pins it, so it can be read with a finger as well as a pointer.
    this.info.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pinned = !this.pinned;
      this.noteOpen = this.pinned;
      if (this.pinned) this.showNote();
      else this.tooltip.hide(this);
    });
    this.factsEl = document.createElement('div');
    this.factsEl.className = 'tile-head-facts';
    this.factsEl.hidden = true;
    this.head.append(this.titleEl, this.info, this.factsEl);
    this.list = document.createElement('div');
    this.list.className = 'inv-list';
    win.body.append(this.head, this.list);
    // The list is only as good as the world it was built from, so rebuild it
    // whenever the world, the pack or the job in hand changes.
    // Every action gains a skill, so these fire several times a second while
    // you work. The list is looked at on a beat and only redrawn when it would
    // actually say something different.
    for (const ev of ['world', 'inventory', 'action', 'crate', 'skill'] as const) game.events.on(ev, () => this.repaint.ask());
    this.render();
  }

  /** What the window is showing, if anything. */
  get target(): Pick | null {
    return this.pick;
  }

  /**
   * The note behind the little `i`: what the ground is good for, or what the
   * creature can actually do. Anchored to the button rather than to the
   * pointer, so it stays put while it is being read.
   */
  private showNote(): void {
    if (!this.pick) return;
    const r = this.info.getBoundingClientRect();
    this.tooltip.show(r.left, r.bottom - 12, this.noteLines(this.pick), this, true);
  }

  private noteLines(pick: Pick): string[] {
    const creature = pick.creature !== undefined ? this.game.creatures.get(pick.creature) : undefined;
    if (creature) return creatureSkills(this.game, creature);
    return tileUses(this.game, pick.x, pick.y);
  }

  /** Point the window at a tile, opening it if it is closed. */
  select(pick: Pick | null, open = true): void {
    this.pick = pick;
    // A note always describes what is selected now, not what was selected when
    // the pointer arrived at the button.
    if (this.noteOpen && !pick) {
      this.noteOpen = false;
      this.pinned = false;
      this.tooltip.hide(this);
    }
    // A new thing selected is a different list; nothing is kept open from the
    // last one, and it is drawn at once rather than on the next beat.
    this.folds.clear();
    this.repaint.force();
    if (pick && open) this.win.open();
    this.render();
  }

  /** Look again, on a beat, and redraw only if the list has changed. */
  update(now: number): void {
    // A note cannot outlive the window it was opened from.
    if (!this.win.isOpen && this.noteOpen) {
      this.noteOpen = false;
      this.pinned = false;
      this.tooltip.hide(this);
    }
    if (!this.win.isOpen) return;
    /*
     * A prospector's reading goes out by itself.
     *
     * Everything else here changes because something happened and said so —
     * ground dug, a thing picked up, a skill gained. The marks simply run out
     * of time, and a window left open would go on showing an ore reading for a
     * seam nobody can remember any more. Cheap to ask: it is one string, and
     * `changed` below still refuses to redraw when it reads the same.
     */
    if (this.pick && groundReading(this.game, this.pick.x, this.pick.y) !== this.reading) this.repaint.ask();
    if (!this.repaint.due(now)) return;
    this.render(now);
  }

  render(now = performance.now()): void {
    if (!this.pick) {
      if (!this.repaint.changed(now, 'nothing')) return;
      this.list.replaceChildren();
      this.titleEl.textContent = 'Nothing selected';
      this.info.hidden = true;
      this.reading = null;
      this.factsEl.hidden = true;
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'Click any tile and everything you can do to it is listed here.';
      this.list.append(empty);
      return;
    }
    const { title, facts, entries } = this.source(this.pick);
    // What the list would say, down to every reason and every note. If it
    // matches what is already on screen, nothing is touched.
    if (!this.repaint.changed(now, `${title}\u0000${(facts ?? []).join('\u0001')}\u0000${entries.map(sign).join('\u0000')}`)) return;
    this.list.replaceChildren();
    this.titleEl.textContent = title;
    this.info.hidden = false;
    this.reading = groundReading(this.game, this.pick.x, this.pick.y);
    this.factsEl.replaceChildren(...(facts ?? []).map((fact) => {
      const line = document.createElement('div');
      line.textContent = fact;
      return line;
    }));
    this.factsEl.hidden = !facts?.length;
    if (!entries.length) {
      const none = document.createElement('div');
      none.className = 'inv-empty';
      none.textContent = 'Nothing to do here.';
      this.list.append(none);
      return;
    }
    // The first ten things that can actually be done get a number key, in the
    // order they are listed. A row that only opens onto more choices is not
    // one of them, and neither is one that says why it cannot be done.
    this.keyed = entries.filter((e) => !e.disabled && e.onSelect).slice(0, KEYS.length);
    const keyFor = new Map(this.keyed.map((e, i) => [e, KEYS[i]]));
    this.list.append(...buildMenuRows(entries, 0, { keyOf: (item) => keyFor.get(item), folds: this.folds }));
    // Its figures move while you watch — a beast's trade climbs as it works,
    // and ground is picked clean and grows back.
    if (this.noteOpen) this.showNote();
  }

  /**
   * What each number key would do, for anything that wants to say so. Empty
   * when the window is shut or looking at nothing, since it takes the keys
   * only while it is actually in front of you.
   */
  get bindings(): Array<{ key: string; label: string }> {
    if (!this.win.isOpen || !this.pick) return [];
    return this.keyed.map((e, i) => ({ key: KEYS[i], label: e.label }));
  }

  /**
   * Press a number key. Returns false when this window is not showing
   * anything, so whatever else wants the number keys may have them.
   */
  press(index: number): boolean {
    if (!this.win.isOpen || !this.pick) return false;
    const entry = this.keyed[index];
    if (!entry?.onSelect) return false;
    entry.onSelect();
    // Doing a thing changes what can be done next, so the list is looked at
    // again at once rather than on the next beat.
    this.repaint.ask();
    this.render();
    return true;
  }
}
