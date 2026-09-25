import { clockLeft } from '../../game/boons';
import { DAY_SECONDS } from '../../game/game';
import { isShod, SHOE_DAYS, ageOf, attackOf, bloodMul, CARE_BONUS, careMul, careWord, growsAt, creatureLevel, GATHER_VERB, maxHealth, RANGE_PER_STEP, SEX_MARK, SEX_NAMES, SKILL_STEP, SPECIES, STANCE_NAMES, taskSkill, workRangeOf, type Creature } from '../../game/creatures';
import { CHANNELS, isGain, pct, TIER_COLOUR, traitOf, type TraitChannel } from '../../game/traits';
import { TIER_LEVEL } from '../../game/husbandry';

import type { Game } from '../../game/game';
import { itemDef } from '../../game/items';
import type { MenuItem } from '../contextmenu';
import type { UIWindow } from '../windows';

const GROUPS: Array<[Creature['mode'], string]> = [
  ['active', 'Travelling with you'],
  ['deed', 'Working the deed'],
  ['stored', 'In creature crates'],
];

/** How a herd may be put in order. */
type SortKey = 'name' | 'level' | 'species' | 'health' | 'hunger' | 'care' | 'age' | 'traits';
const SORTS: Array<[SortKey, string]> = [
  ['name', 'Name'],
  ['level', 'Level'],
  ['species', 'Kind'],
  ['health', 'Health'],
  ['hunger', 'Hunger'],
  ['care', 'Care'],
  ['age', 'Age'],
  ['traits', 'Best trait'],
];

/**
 * What counts as wanting attention. The footer has always counted these and
 * the cards never said which ones they were, so the count sent you looking
 * through the herd by eye. One definition, read by both, so they cannot drift.
 */
export const HURT_AT = 0.6;
export const HUNGRY_AT = 0.3;

/** Your tamed wildermon with their condition, progress and actions. Wild ones are not listed. */
export class WildermonPanel {
  private list: HTMLDivElement;
  private footer: HTMLDivElement;
  private search: HTMLInputElement;
  private query = '';
  private sort: SortKey = 'name';
  private sortSel!: HTMLSelectElement;
  private groupBtn!: HTMLButtonElement;
  private grouped = true;
  private lastRender = 0;
  /**
   * The cards on screen, by the wildermon each one is for, and the group
   * headings above them.
   *
   * Reported: "hard to press the buttons and it scrolls constantly to the
   * bottom." The list was thrown away and built again every 400 ms --
   * `replaceChildren` and thirty fresh cards, two and a half times a second --
   * and a button that is destroyed between the press and the release is a
   * button that was never clicked. That is the whole of why they were hard to
   * press: the ⋯ on every card, and the two in the footer, were new elements
   * by the time the mouse came back up.
   *
   * So nothing is thrown away now. A card is built once and brought up to date
   * in place, and the list is reconciled against the order it should be in:
   * a wildermon that has not moved in the order is not touched at all.
   */
  private readonly cards = new Map<number, { el: HTMLDivElement; refresh: (c: Creature) => void }>();
  private readonly heads = new Map<string, HTMLDivElement>();
  private footerKey = '';

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly entriesFor: (id: number) => MenuItem[],
    private readonly showMenu: (x: number, y: number, title: string, items: MenuItem[]) => void,
  ) {
    win.body.classList.add('pals-body');
    // A herd of thirty is a scroll; searching and ordering it is the point.
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'panel-search';
    this.search.placeholder = 'Name, kind, trait, job…';
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Escape') return;
      this.search.value = '';
      this.query = '';
      this.render();
    });
    const bar = document.createElement('div');
    bar.className = 'panel-bar';
    const sortSel = document.createElement('select');
    sortSel.className = 'panel-select';
    sortSel.title = 'How to order the herd';
    for (const [key, label] of SORTS) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      sortSel.append(opt);
    }
    this.sortSel = sortSel;
    sortSel.addEventListener('change', () => {
      this.sort = sortSel.value as SortKey;
      this.render();
    });
    const groupBtn = document.createElement('button');
    this.groupBtn = groupBtn;
    groupBtn.type = 'button';
    groupBtn.className = 'tb-btn tb-small tb-on';
    groupBtn.textContent = 'Grouped';
    groupBtn.title = 'Group by where each one is, or run the whole herd together in one list';
    groupBtn.addEventListener('click', () => {
      this.grouped = !this.grouped;
      groupBtn.textContent = this.grouped ? 'Grouped' : 'Flat';
      groupBtn.classList.toggle('tb-on', this.grouped);
      this.render();
    });
    bar.append(sortSel, groupBtn);
    this.list = document.createElement('div');
    this.list.className = 'pals-list';
    this.footer = document.createElement('div');
    this.footer.className = 'inv-footer';
    win.body.append(this.search, bar, this.list, this.footer);
    this.render();
  }

  /** Everything one of them answers to: its name, kind, job, orders and traits. */
  private matches(c: Creature): boolean {
    if (!this.query) return true;
    const def = SPECIES[c.species] ?? SPECIES.rabba;
    const traits = c.traits.map((id) => traitOf(id)?.name ?? '').join(' ');
    const age = ageOf(c, this.game.time);
    const job = def.gathers ? GATHER_VERB[def.gathers] : '';
    return `${c.name} ${def.name} ${c.mode} ${c.stance} ${job} ${SEX_NAMES[c.sex]} ${age} ${traits}`.toLowerCase().includes(this.query);
  }

  /** The best tier any of its traits reached, for ordering by breeding. */
  private bestTier(c: Creature): number {
    let best = -1;
    for (const id of c.traits) {
      const t = traitOf(id);
      if (t) best = Math.max(best, TIER_LEVEL[t.tier]);
    }
    return best;
  }

  /** The order asked for: name and kind climb, everything else falls. */
  private ordered(list: Creature[]): Creature[] {
    const by: Record<SortKey, (a: Creature, b: Creature) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      level: (a, b) => creatureLevel(b) - creatureLevel(a),
      species: (a, b) => (SPECIES[a.species]?.name ?? '').localeCompare(SPECIES[b.species]?.name ?? '') || a.name.localeCompare(b.name),
      health: (a, b) => a.health / maxHealth(a, this.game.creatures.species(a)) - b.health / maxHealth(b, this.game.creatures.species(b)),
      hunger: (a, b) => a.hunger - b.hunger,
      care: (a, b) => b.care - a.care,
      age: (a, b) => a.born - b.born,
      traits: (a, b) => this.bestTier(b) - this.bestTier(a) || creatureLevel(b) - creatureLevel(a),
    };
    return [...list].sort(by[this.sort]);
  }

  /** Redraw a few times a second while open; stats move constantly. */
  update(now: number): void {
    if (!this.win.isOpen || now - this.lastRender < 400) return;
    this.lastRender = now;
    this.render();
  }

  /**
   * Put the list in this order, moving as little as possible.
   *
   * `insertBefore` on a node already in the tree moves it rather than copying
   * it, so a card that is already where it should be is not touched, and one
   * that has only changed places keeps its identity, its listeners and the
   * press that is halfway through happening on it.
   */
  private place(want: Node[]): void {
    for (let i = 0; i < want.length; i++) {
      if (this.list.childNodes[i] === want[i]) continue;
      this.list.insertBefore(want[i], this.list.childNodes[i] ?? null);
    }
    while (this.list.childNodes.length > want.length) this.list.lastChild?.remove();
  }

  /** A group heading, kept between renders so the list has nothing to rebuild. */
  private heading(mode: string, text: string): HTMLDivElement {
    let el = this.heads.get(mode);
    if (!el) {
      el = document.createElement('div');
      el.className = 'inv-group';
      this.heads.set(mode, el);
    }
    if (el.textContent !== text) el.textContent = text;
    return el;
  }

  /** A line that is only ever a sentence: built once, worded as needed. */
  private note(mode: string, text: string): HTMLDivElement {
    const el = this.heading(`note:${mode}`, text);
    el.className = 'inv-empty';
    return el;
  }

  render(): void {
    const owned = [...this.game.creatures.list.values()].filter((c) => c.mode !== 'wild');
    const shown = owned.filter((c) => this.matches(c));
    if (!owned.length) {
      this.place([this.note('none', 'You have no tamed wildermon yet. Carry a berry for a Rabba or a spice for a Vola, then try Tame on a wild one.')]);
      this.footer.replaceChildren();
      this.footerKey = '';
      return;
    }
    const want: Node[] = [];
    const take = (c: Creature): void => {
      let held = this.cards.get(c.id);
      if (!held) {
        held = this.card(c);
        this.cards.set(c.id, held);
      }
      held.refresh(c);
      want.push(held.el);
    };
    if (!this.grouped) {
      for (const c of this.ordered(shown)) take(c);
    } else
    for (const [mode, title] of GROUPS) {
      const group = shown.filter((c) => c.mode === mode);
      if (!group.length) continue;
      want.push(this.heading(mode, `${title} (${group.length})`));
      for (const c of this.ordered(group)) take(c);
    }
    if (!shown.length) {
      want.push(this.note('search', `None of your wildermon answer to “${this.search.value.trim()}”.`));
    }
    this.place(want);
    // Cards for wildermon that are no longer any of ours are let go, so a herd
    // that changes hands does not leave the map growing for the session.
    if (this.cards.size > owned.length) {
      const alive = new Set(owned.map((c) => c.id));
      for (const id of [...this.cards.keys()]) if (!alive.has(id)) this.cards.delete(id);
    }

    const hungry = owned.filter((c) => this.isHungry(c)).length;
    const hurt = owned.filter((c) => this.isHurt(c)).length;
    /*
     * The footer carries two buttons of its own, so it is rebuilt only when
     * what it says has actually changed -- which is when one of these three
     * numbers moves, and not two and a half times a second.
     */
    const key = `${shown.length}/${owned.length}|${hungry}|${hurt}`;
    if (key !== this.footerKey) {
      this.footerKey = key;
      this.footer.replaceChildren();
      const count = document.createElement('span');
      count.textContent = `${shown.length === owned.length ? owned.length : `${shown.length} of ${owned.length}`} wildermon`;
      this.footer.append(count);
      // A count of things wrong is only useful if it takes you to them.
      const jump = (n: number, what: string, sort: SortKey): void => {
        if (!n) return;
        this.footer.append(document.createTextNode(' · '));
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `pal-jump pal-flag-${what}`;
        b.textContent = `${n} ${what}`;
        b.title = `Show them: worst first, every group together, nothing filtered out`;
        b.addEventListener('click', () => this.findThose(sort));
        this.footer.append(b);
      };
      jump(hungry, 'hungry', 'hunger');
      jump(hurt, 'hurt', 'health');
      this.footer.classList.toggle('inv-over', hungry > 0 || hurt > 0);
    }
  }

  /** Hurt enough to be worth doing something about. */
  private isHurt(c: Creature): boolean {
    return c.health < maxHealth(c, this.game.creatures.species(c)) * HURT_AT;
  }

  private isHungry(c: Creature): boolean {
    return c.hunger < HUNGRY_AT;
  }

  /**
   * Bring whatever wants attention to the top, and stop hiding any of it
   * behind a search. What the footer counts, this finds.
   */
  private findThose(sort: SortKey): void {
    this.sort = sort;
    this.sortSel.value = sort;
    this.search.value = '';
    this.query = '';
    this.grouped = false;
    this.groupBtn.textContent = 'Flat';
    this.groupBtn.classList.remove('tb-on');
    this.render();
  }

  /**
   * One card, built once, and how to bring it up to date.
   *
   * Everything a card shows moves -- health, hunger, care, what it is carrying
   * -- so a card compared against its old self would differ on nearly every
   * render, and comparing was never going to save the buttons. What saves them
   * is not replacing anything: the structure is made here and `refresh` writes
   * the new figures into it, so the ⋯ button is the same element from the day
   * the card appears until the wildermon is gone.
   */
  private card(c: Creature): { el: HTMLDivElement; refresh: (c: Creature) => void } {
    let cur = c;
    const card = document.createElement('div');
    card.className = 'pal-card';
    const head = document.createElement('div');
    head.className = 'pal-head';
    const name = document.createElement('span');
    name.className = 'pal-name';
    const level = document.createElement('span');
    level.className = 'pal-level';
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'tb-btn tb-small';
    menu.textContent = '⋯';
    menu.title = 'Actions';
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = menu.getBoundingClientRect();
      this.showMenu(r.left, r.bottom + 2, cur.name, this.entriesFor(cur.id));
    });
    const flags = document.createElement('span');
    flags.className = 'pal-flags';
    head.append(name, flags, level, menu);
    card.append(head);

    const bar = (label: string, cls: string): { row: HTMLDivElement; fill: HTMLDivElement; value: HTMLSpanElement } => {
      const row = document.createElement('div');
      row.className = 'hud-bar-row';
      const l = document.createElement('span');
      l.className = 'hud-bar-label';
      l.textContent = label;
      const track = document.createElement('div');
      track.className = 'hud-bar';
      const fill = document.createElement('div');
      fill.className = `hud-bar-fill ${cls}`;
      track.append(fill);
      const value = document.createElement('span');
      value.className = 'hud-bar-value';
      row.append(l, track, value);
      return { row, fill, value };
    };
    const health = bar('Health', 'bar-health');
    const hunger = bar('Hunger', 'bar-hunger');
    const care = bar('Care', 'bar-care');
    const bloodBox = document.createElement('div');
    bloodBox.className = 'pal-traits';
    const worthBox = document.createElement('div');
    worthBox.className = 'pal-worth';
    const info = document.createElement('div');
    info.className = 'pal-info';
    card.append(health.row, hunger.row, care.row, bloodBox, worthBox, info);

    const set = (el: { textContent: string | null; title: string }, text: string, title: string): void => {
      if (el.textContent !== text) el.textContent = text;
      if (el.title !== title) el.title = title;
    };

    const refresh = (c: Creature): void => {
      cur = c;
      const def = SPECIES[c.species] ?? SPECIES.rabba;
      set(name, `${SEX_MARK[c.sex]} ${c.name}${c.name !== def.name ? ` · ${def.name}` : ''}`,
        `${SEX_NAMES[c.sex]} ${def.name.toLowerCase()}`);
      // Age reads before anything else: a yearling cannot be worked at all.
      const age = ageOf(c, this.game.time);
      const growing = growsAt(c, this.game.time);
      set(level, `${age === 'grown' ? '' : `${age} · `}Lv ${creatureLevel(c)}`,
        growing > 0 ? `Grown in ${clockLeft(growing)}` : age === 'old' ? 'Slower, but a better carcass' : 'Grown');
      // Which one it is, not just that one of them is: the card is marked and
      // the reason is written beside the name.
      const wants: string[] = [];
      if (this.isHurt(c)) wants.push('hurt');
      if (this.isHungry(c)) wants.push('hungry');
      if (flags.dataset.says !== wants.join()) {
        flags.dataset.says = wants.join();
        flags.replaceChildren();
        for (const what of wants) {
          const tag = document.createElement('span');
          tag.className = `pal-flag pal-flag-${what}`;
          tag.textContent = what;
          tag.title = what === 'hurt' ? `Under ${Math.round(HURT_AT * 100)}% of the health it can carry. Herbs and a cover, or leave it somewhere quiet.` : `Under ${Math.round(HUNGRY_AT * 100)}% fed. A hungry wildermon works slowly and learns nothing.`;
          flags.append(tag);
        }
      }
      card.classList.toggle('pal-card-wants', wants.length > 0);

      const width = (fill: HTMLDivElement, v: number): void => {
        const w = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
        if (fill.style.width !== w) fill.style.width = w;
      };
      const top = maxHealth(c, def);
      width(health.fill, c.health / top);
      health.value.textContent = `${Math.ceil(c.health)}/${top}`;
      width(hunger.fill, c.hunger);
      hunger.value.textContent = `${Math.round(c.hunger * 100)}%`;
      width(care.fill, c.care);
      care.value.textContent = `${Math.round(c.care * 100)}%`;
      // What brushing is worth, said as the figure the rules read rather than
      // as “a quarter”, which was a number written in prose and never checked.
      care.row.title = `${careWord(c.care)} \u2014 work and learning \u00d7${careMul(c).toFixed(2)} at this much care, up to \u00d7${(1 + CARE_BONUS).toFixed(2)} brushed to a shine, and it throws better young`;

      bloodBox.replaceChildren(...this.blood(c).childNodes);
      const w = this.worth(c);
      worthBox.replaceChildren(...(w ? [...w.childNodes] : []));
      worthBox.hidden = !w;

      const parts: string[] = [];
      if (c.ridden) parts.push('Under the saddle');
      else if (c.hitchedTo !== null) parts.push('In the traces');
      else if (c.tacked) parts.push('Saddled and bridled');
      if (isShod(this.game.time, c)) parts.push(`Shod, for ${Math.max(1, Math.ceil((SHOE_DAYS * DAY_SECONDS - (this.game.time - c.shodAt)) / DAY_SECONDS))} more day${Math.ceil((SHOE_DAYS * DAY_SECONDS - (this.game.time - c.shodAt)) / DAY_SECONDS) === 1 ? '' : 's'}`);
      if (c.due > 0) parts.push(`In young, due in ${clockLeft(Math.max(0, c.due - this.game.time))}`);
      if (c.mode === 'active') parts.push(`Stance: ${STANCE_NAMES[c.stance]}`);
      if (c.mode === 'deed') {
        const verb = def.gathers ? GATHER_VERB[def.gathers] : 'working';
        parts.push(c.carrying ? `Carrying ${itemDef(c.carrying.id).name.toLowerCase()} to the crate` : c.state === 'forage' ? `${verb[0].toUpperCase()}${verb.slice(1)}` : c.state === 'toForage' ? `Heading out to ${def.gathers ?? 'work'}` : 'Looking for work');
      }
      if (c.mode === 'deed' && def.gathers) {
        const toNext = SKILL_STEP - (taskSkill(c, def) % SKILL_STEP);
        parts.push(`Range ${workRangeOf(c, def)} tiles (+${def.rangePerStep ?? RANGE_PER_STEP} in ${toNext.toFixed(1)} skill)`);
      }
      parts.push(`Attack ${attackOf(c, def).toFixed(attackOf(c, def) % 1 ? 1 : 0)}`);
      const skills = Object.entries(c.skills).map(([id, v]) => `${id[0].toUpperCase()}${id.slice(1)} ${v.toFixed(2)}`);
      parts.push(...skills);
      parts.push(`Experience ${c.xp.toFixed(1)}`);
      const said = parts.join(' · ');
      if (info.textContent !== said) info.textContent = said;
    };

    return { el: card, refresh };
  }

  /**
   * The three traits it was born with, with what each of them is worth.
   *
   * What you can read off an animal depends on the husbandry behind your eyes:
   * a common trait is plain to anybody, old blood takes a breeder to know. What
   * does *not* depend on anything is the figure beside a trait you can already
   * read — it was in `effects` from the day the trait was written and the card
   * printed the prose and threw the number away, which is what made a page of
   * real multipliers read as flair.
   */
  private blood(c: Creature): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'pal-traits';
    const skill = this.game.skills.get('animal_husbandry');
    for (const id of c.traits) {
      const t = traitOf(id);
      if (!t) continue;
      const chip = document.createElement('span');
      chip.className = 'trait-chip';
      const known = this.game.walks('knowledge', 3) || skill >= 1 + TIER_LEVEL[t.tier];
      if (known) {
        chip.textContent = t.aura ? `◉ ${t.name}` : t.name;
        chip.style.color = TIER_COLOUR[t.tier];
        chip.style.borderColor = TIER_COLOUR[t.tier];
        // The figures, beside the name rather than behind a hover: a trait you
        // have to point at to learn anything about is one you never read.
        for (const ch of CHANNELS) {
          const v = t.effects[ch.id];
          if (v === undefined) continue;
          const fig = document.createElement('span');
          fig.className = `trait-fig ${isGain(ch.id, v) ? 'trait-up' : 'trait-down'}`;
          fig.textContent = `${pct(v)} ${ch.label}`;
          chip.append(' ', fig);
        }
        const says = CHANNELS.filter((ch) => t.effects[ch.id] !== undefined)
          .map((ch) => `${pct(t.effects[ch.id] as number)} ${ch.label}: ${ch.note}`);
        chip.title = `${t.tier}${t.aura ? ', communal: what it lifts, it lifts for every wildermon on the same deed or post, itself included' : ''}`
          + ` — ${t.note}\n${says.join('\n')}`;
      } else {
        chip.textContent = 'something';
        chip.classList.add('trait-unread');
        chip.title = `You can see there is something in it. ${1 + TIER_LEVEL[t.tier]} animal husbandry would tell you what.`;
      }
      row.append(chip);
    }
    return row;
  }

  /**
   * What the three of them come to, after the herd and the brush.
   *
   * The chips say what each trait is worth on its own; this says what the
   * animal in front of you is worth, which is a different number and the one
   * every rule actually reads. Three traits multiply, a lead beast standing in
   * the same field multiplies again, and a well-brushed animal works and learns
   * a quarter faster — and the card had been claiming that last one in a
   * tooltip on the Care bar for as long as the bar has existed.
   *
   * Taken from `speedMul`, `workMul`, `learnMul` and `yieldMul` themselves
   * rather than worked out again here. A number written twice is a number that
   * drifts, and a card that works out its own answer is a card that can be
   * wrong about the rules while agreeing with itself.
   */
  private worth(c: Creature): HTMLDivElement | null {
    const beasts = this.game.creatures;
    const net = (ch: TraitChannel): number =>
      ch === 'speed' ? beasts.speedMul(c)
      : ch === 'work' ? beasts.workMul(c)
      : ch === 'learn' ? beasts.learnMul(c)
      : ch === 'yield' ? beasts.yieldMul(c)
      : bloodMul(c, ch);
    const row = document.createElement('div');
    row.className = 'pal-worth';
    const label = document.createElement('span');
    label.className = 'worth-label';
    label.textContent = 'In all';
    label.title = 'The three traits multiplied together, with the herd it stands in and the brush it has had';
    row.append(label);
    let any = false;
    for (const ch of CHANNELS) {
      const v = net(ch.id);
      if (Math.abs(v - 1) < 0.005) continue;
      any = true;
      const tag = document.createElement('span');
      tag.className = `worth-tag ${isGain(ch.id, v) ? 'trait-up' : 'trait-down'}`;
      tag.textContent = `${pct(v)} ${ch.label}`;
      // Where it came from, so a figure that moved has somewhere to have moved from.
      const parts = [`${ch.note}.`, `Blood ${bloodMul(c, ch.id).toFixed(2)}×`];
      const herd = beasts.aura(c, ch.id);
      if (Math.abs(herd - 1) >= 0.005) parts.push(`herd ${herd.toFixed(2)}×`);
      if ((ch.id === 'work' || ch.id === 'learn') && c.care > 0) parts.push(`brushing ${careMul(c).toFixed(2)}×`);
      tag.title = parts.join(' · ');
      row.append(tag);
    }
    return any ? row : null;
  }
}
