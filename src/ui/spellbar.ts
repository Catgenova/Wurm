import { PLAYER_ATTACKER } from '../game/creatures';
import type { Game } from '../game/game';
import {
  FAITH_SPELL_BY_ID, PATRON_AT, SCHOOL_NAMES, SPELL_BAR, SPELL_REACH, spellOnText, type FaithSpellDef, type SpellSchool,
} from '../game/patrons';
import type { MenuItem } from './contextmenu';
import type { FaithBook } from './faithbook';

/** What a spell is sent at (`rpc_cast_spell`'s `p_target`); the island decides what kind of thing it counts as. */
export type SpellAim =
  | { kind: 'self' }
  | { kind: 'player'; uid: string }
  | { kind: 'creature'; id: number }
  | { kind: 'item'; id: number }
  | { kind: 'placed'; id: number }
  | { kind: 'area'; x?: number; y?: number };

/** The most creatures a "Cast on" list names, nearest first. */
const AIM_MOST = 10;

/** Whether a spell takes this sort of thing at all, before the island is asked about this one. */
const takes = (def: FaithSpellDef, aim: SpellAim): boolean => {
  switch (aim.kind) {
    case 'self': return def.on.includes('self');
    case 'player': return def.on.includes('player');
    case 'creature': return def.on.includes('enemy') || def.on.includes('wildermon');
    case 'item':
    case 'placed': return def.on.includes('object');
    case 'area': return def.on.includes('area');
  }
};

/**
 * The spell bar: six slots along the bottom, three for your trade's spells,
 * two for your patron's and one for your path's (`SPELL_BAR`).
 *
 * A click, or Shift and the slot's number, calls what is in it: at what you
 * are fighting or have marked when the spell takes a creature, on yourself or
 * round where you stand when it takes those, and otherwise the bar asks what
 * at. A right-click says what can go in the slot and what in reach the spell
 * can be cast on, and right-clicking a person, a creature, a thing or the
 * ground offers every spell on the bar that takes it (`entriesFor`).
 *
 * What is in each slot is the island's (`faith_said` `.bar`), as is whether a
 * call is refused, and the spell's own sentence for what it did comes back
 * through the log. A slot resting shows how much of its rest is left as a
 * shade drawn down across it.
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

  /** Call the spell in a slot at whatever it would go at by itself, or ask what at when there is nothing. */
  async cast(i: number): Promise<void> {
    if (!this.book.island) return;
    const id = this.book.said?.bar[i] ?? null;
    if (!id) {
      this.game.logMsg(this.emptyWhy(i), 'error');
      return;
    }
    const def = FAITH_SPELL_BY_ID.get(id);
    const aim = def ? this.aimOf(def) : { kind: 'self' as const };
    if (aim) {
      await this.castAt(i, aim);
      return;
    }
    if (!def) return;
    const r = this.slots[i].btn.getBoundingClientRect();
    this.menu(r.left, r.top, `Cast ${def.name} on`, this.aimItems(i, def));
  }

  /** Call the spell in a slot at this. */
  async castAt(i: number, aim: SpellAim): Promise<void> {
    const why = await this.book.cast(i, aim);
    if (why) this.game.logMsg(why, 'error');
  }

  /** "Cast ..." for every spell on the bar that takes this, for the menu of whatever it is. */
  entriesFor(aim: SpellAim): MenuItem[] {
    if (!this.book.island) return [];
    const bar = this.book.said?.bar ?? [];
    const out: MenuItem[] = [];
    bar.forEach((id, i) => {
      const def = id ? FAITH_SPELL_BY_ID.get(id) : undefined;
      if (!def || !takes(def, aim)) return;
      const left = this.book.restLeft(def.id);
      out.push({
        label: `Cast ${def.name}`,
        note: left > 0 ? `${def.cost} favour · ready in ${Math.ceil(left)} s` : `${def.cost} favour`,
        onSelect: () => void this.castAt(i, aim),
      });
    });
    return out;
  }

  /** What a spell goes at by itself, in the order its kinds are written: nothing, when it has to be asked. */
  private aimOf(def: FaithSpellDef): SpellAim | null {
    const g = this.game;
    const id = g.fightTarget ?? g.marked;
    const c = id !== null ? g.creatures.get(id) : undefined;
    for (const on of def.on) {
      if ((on === 'enemy' || on === 'wildermon') && c) return { kind: 'creature', id: c.id };
      if (on === 'self') return { kind: 'self' };
      if (on === 'area') return { kind: 'area' };
    }
    return null;
  }

  /** Everything within reach a spell can be cast on, nearest first, as menu rows that cast it. */
  private aimItems(i: number, def: FaithSpellDef): MenuItem[] {
    const g = this.game;
    const p = g.player;
    const far = (x: number, y: number): number => Math.hypot(x - p.x, y - p.y);
    const tiles = (d: number): string => `${Math.round(d)} tiles off`;
    const items: MenuItem[] = [];
    const at = (aim: SpellAim) => () => void this.castAt(i, aim);
    if (def.on.includes('self')) items.push({ label: 'Yourself', onSelect: at({ kind: 'self' }) });
    if (def.on.includes('area')) {
      items.push({ label: 'Where you stand', note: `everything within ${def.radius ?? 0} tiles`, onSelect: at({ kind: 'area' }) });
    }
    if (def.on.includes('player')) {
      for (const peer of g.roster.list()) {
        const d = far(peer.x, peer.y);
        if (peer.uid && d <= SPELL_REACH) items.push({ label: peer.name, note: tiles(d), onSelect: at({ kind: 'player', uid: peer.uid }) });
      }
    }
    if (def.on.includes('enemy') || def.on.includes('wildermon')) {
      const near = [...g.creatures.list.values()]
        .filter((c) => c.health > 0 && far(c.x, c.y) <= SPELL_REACH
          && ((def.on.includes('enemy') && c.mode === 'wild') || (def.on.includes('wildermon') && c.enemy !== PLAYER_ATTACKER)))
        .sort((a, b) => far(a.x, a.y) - far(b.x, b.y))
        .slice(0, AIM_MOST);
      for (const c of near) {
        items.push({ label: `${c.name} (${g.creatures.species(c).name.toLowerCase()})`, note: tiles(far(c.x, c.y)), onSelect: at({ kind: 'creature', id: c.id }) });
      }
    }
    if (def.on.includes('object')) items.push({ label: 'A thing: right-click it in your pack, or where it stands', disabled: true });
    if (!items.length) items.push({ label: `Nothing it can be cast on is within ${SPELL_REACH} tiles`, disabled: true });
    return items;
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
        ? `${def.name}: ${def.note} Cast on ${spellOnText(def)}. ${def.cost} favour, rests ${def.rest} s. Shift+${i + 1}; right-click to change.`
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

  /** What the spell in a slot can be cast on, then what can go in it: the spells of its school you have, and nothing. */
  private choose(i: number, x: number, y: number): void {
    const s = this.book.said;
    const school = SPELL_BAR[i];
    const items: MenuItem[] = [];
    const now = s?.bar[i] ? FAITH_SPELL_BY_ID.get(s.bar[i] as string) : undefined;
    if (now) items.push({ label: `Cast ${now.name} on…`, children: this.aimItems(i, now) });
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
