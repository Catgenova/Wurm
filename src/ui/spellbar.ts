import type { Game } from '../game/game';
import { FAITH_SPELL_BY_ID, PATRON_AT, SCHOOL_NAMES, SPELL_BAR, type SpellSchool } from '../game/patrons';
import type { MenuItem } from './contextmenu';
import type { FaithBook } from './faithbook';

/**
 * The spell bar: six slots along the bottom, three for your trade's spells,
 * two for your patron's and one for your path's (`SPELL_BAR`).
 *
 * A click, or Shift and the slot's number, calls what is in it; a right-click
 * says what can go in it. What is in each slot is the island's (`faith_said`
 * `.bar`), as is whether a call is refused, and the spell's own sentence for
 * what it did comes back through the log. A slot resting shows how much of
 * its rest is left as a shade drawn down across it.
 *
 * Only on an island: playing by yourself there is nobody to keep a patron,
 * so there is nothing to put here.
 */
export class SpellBar {
  private readonly el: HTMLDivElement;
  private readonly slots: Array<{ btn: HTMLButtonElement; name: HTMLSpanElement; shade: HTMLSpanElement }> = [];
  /** What each slot's shade was last set to, so a frame that changes nothing writes nothing. */
  private readonly shaded: string[] = [];

  constructor(
    root: HTMLElement,
    private readonly game: Game,
    private readonly book: FaithBook,
    private readonly menu: (x: number, y: number, title: string, items: MenuItem[]) => void,
    private readonly openFaith: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'spell-bar';
    this.el.hidden = !book.island;
    let group: HTMLDivElement | null = null;
    let school: SpellSchool | null = null;
    SPELL_BAR.forEach((s, i) => {
      if (s !== school) {
        school = s;
        group = document.createElement('div');
        group.className = `spell-group spell-${s}`;
        const cap = document.createElement('span');
        cap.className = 'spell-cap';
        cap.textContent = SCHOOL_NAMES[s];
        group.append(cap);
        this.el.append(group);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'spell-slot';
      const key = document.createElement('span');
      key.className = 'spell-key';
      key.textContent = `⇧${i + 1}`;
      const name = document.createElement('span');
      name.className = 'spell-name';
      const shade = document.createElement('span');
      shade.className = 'spell-shade';
      btn.append(shade, key, name);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.cast(i);
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.choose(i, e.clientX, e.clientY);
      });
      group?.append(btn);
      this.slots.push({ btn, name, shade });
      this.shaded.push('');
    });
    root.append(this.el);
    book.on(() => this.draw());
    this.draw();
  }

  /** Call the spell in a slot, at what you are fighting or have marked when it wants a creature. */
  async cast(i: number): Promise<void> {
    if (!this.book.island) return;
    const id = this.book.said?.bar[i] ?? null;
    if (!id) {
      this.game.logMsg(this.emptyWhy(i), 'error');
      return;
    }
    const def = FAITH_SPELL_BY_ID.get(id);
    const target: Record<string, unknown> = {};
    if (def?.on === 'creature') {
      const c = this.game.fightTarget ?? this.game.marked;
      if (c === null) {
        this.game.logMsg(`${def.name} is called on what you are fighting or have marked: mark something first (Tab).`, 'error');
        return;
      }
      target.kind = 'creature';
      target.id = c;
    }
    const why = await this.book.cast(i, target);
    if (why) this.game.logMsg(why, 'error');
  }

  /** The shade on each resting slot, a frame at a time. */
  update(): void {
    if (this.el.hidden) return;
    const bar = this.book.said?.bar ?? [];
    this.slots.forEach((slot, i) => {
      const id = bar[i];
      const def = id ? FAITH_SPELL_BY_ID.get(id) : undefined;
      const left = def ? this.book.restLeft(def.id) : 0;
      const frac = def && def.rest > 0 ? Math.min(1, left / def.rest) : 0;
      const h = `${Math.round(frac * 100)}%`;
      if (this.shaded[i] === h) return;
      this.shaded[i] = h;
      slot.shade.style.height = h;
      slot.btn.classList.toggle('spell-resting', frac > 0);
    });
  }

  private draw(): void {
    const s = this.book.said;
    this.el.hidden = !this.book.island;
    SPELL_BAR.forEach((school, i) => {
      const { btn, name } = this.slots[i];
      const id = s?.bar[i] ?? null;
      const def = id ? FAITH_SPELL_BY_ID.get(id) : undefined;
      name.textContent = def?.name ?? id ?? '—';
      btn.classList.toggle('spell-empty', !id);
      btn.title = def
        ? `${def.name}: ${def.note} ${def.cost} favour, rests ${def.rest} s. Shift+${i + 1}; right-click to change.`
        : `${SCHOOL_NAMES[school]} slot. ${this.emptyWhy(i)}`;
    });
  }

  /** Why a slot has nothing in it, and what would put something there. */
  private emptyWhy(i: number): string {
    const school = SPELL_BAR[i];
    if (school !== 'faith') return `No ${SCHOOL_NAMES[school].toLowerCase()} spells are written yet.`;
    if (!this.book.said?.patron) return `Faith spells come from a patron, taken at ${PATRON_AT} faith in the Faith window.`;
    if (!this.book.said.taken.length) return 'Take a spell of your patron’s in the Faith window, and it goes here.';
    return 'Right-click to put one of your patron’s spells here.';
  }

  /** What can go in a slot: the spells of its school you have, and nothing. */
  private choose(i: number, x: number, y: number): void {
    const s = this.book.said;
    const school = SPELL_BAR[i];
    const items: MenuItem[] = [];
    if (school === 'faith' && s) {
      for (const id of s.taken) {
        const def = FAITH_SPELL_BY_ID.get(id);
        items.push({
          label: def?.name ?? id,
          note: def ? `${def.cost} favour · rests ${def.rest} s` : undefined,
          disabled: s.bar[i] === id,
          onSelect: () => void this.put(i, id),
        });
      }
      if (s.bar[i]) items.push({ label: 'Empty this slot', onSelect: () => void this.put(i, null) });
    }
    if (!items.length) items.push({ label: this.emptyWhy(i), disabled: true });
    items.push({ label: 'Open the Faith window', onSelect: () => this.openFaith() });
    this.menu(x, y, `${SCHOOL_NAMES[school]} slot ${i + 1}`, items);
  }

  private async put(i: number, id: string | null): Promise<void> {
    const why = await this.book.setSlot(i, id);
    if (why) this.game.logMsg(why, 'error');
  }
}
