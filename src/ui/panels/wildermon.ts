import { clockLeft } from '../../game/boons';
import { ageOf, attackOf, careWord, growsAt, creatureLevel, GATHER_VERB, maxHealth, RANGE_PER_STEP, SEX_MARK, SEX_NAMES, SKILL_STEP, SPECIES, STANCE_NAMES, taskSkill, workRangeOf, type Creature } from '../../game/creatures';
import { TIER_COLOUR, traitOf } from '../../game/traits';
import { TIER_LEVEL } from '../../game/husbandry';

import type { Game } from '../../game/game';
import { itemDef } from '../../game/items';
import type { MenuItem } from '../contextmenu';
import type { UIWindow } from '../windows';

const GROUPS: Array<[Creature['mode'], string]> = [
  ['active', 'Travelling with you'],
  ['deed', 'Working the deed'],
  ['stored', 'Kept at the token'],
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

/** Your tamed wildermon with their condition, progress and actions. Wild ones are not listed. */
export class WildermonPanel {
  private list: HTMLDivElement;
  private footer: HTMLDivElement;
  private search: HTMLInputElement;
  private query = '';
  private sort: SortKey = 'name';
  private grouped = true;
  private lastRender = 0;

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
    sortSel.addEventListener('change', () => {
      this.sort = sortSel.value as SortKey;
      this.render();
    });
    const groupBtn = document.createElement('button');
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

  render(): void {
    const owned = [...this.game.creatures.list.values()].filter((c) => c.mode !== 'wild');
    const shown = owned.filter((c) => this.matches(c));
    this.list.replaceChildren();
    if (!owned.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'You have no tamed wildermon yet. Carry a berry for a Rabba or a spice for a Vola, then try Tame on a wild one.';
      this.list.append(empty);
      this.footer.textContent = '';
      return;
    }
    if (!this.grouped) {
      for (const c of this.ordered(shown)) this.list.append(this.card(c));
    } else
    for (const [mode, title] of GROUPS) {
      const group = shown.filter((c) => c.mode === mode);
      if (!group.length) continue;
      const header = document.createElement('div');
      header.className = 'inv-group';
      header.textContent = `${title} (${group.length})`;
      this.list.append(header);
      for (const c of this.ordered(group)) this.list.append(this.card(c));
    }
    if (!shown.length) {
      const none = document.createElement('div');
      none.className = 'inv-empty';
      none.textContent = `None of your wildermon answer to “${this.search.value.trim()}”.`;
      this.list.append(none);
    }
    const hungry = owned.filter((c) => c.hunger < 0.3).length;
    const hurt = owned.filter((c) => c.health < maxHealth(c, this.game.creatures.species(c)) * 0.6).length;
    const bits = [`${shown.length === owned.length ? owned.length : `${shown.length} of ${owned.length}`} wildermon`];
    if (hungry) bits.push(`${hungry} hungry`);
    if (hurt) bits.push(`${hurt} hurt`);
    this.footer.textContent = bits.join(' · ');
    this.footer.classList.toggle('inv-over', hungry > 0 || hurt > 0);
  }

  private card(c: Creature): HTMLDivElement {
    const def = SPECIES[c.species] ?? SPECIES.rabba;
    const card = document.createElement('div');
    card.className = 'pal-card';
    const head = document.createElement('div');
    head.className = 'pal-head';
    const name = document.createElement('span');
    name.className = 'pal-name';
    name.textContent = `${SEX_MARK[c.sex]} ${c.name}${c.name !== def.name ? ` · ${def.name}` : ''}`;
    name.title = `${SEX_NAMES[c.sex]} ${def.name.toLowerCase()}`;
    const level = document.createElement('span');
    level.className = 'pal-level';
    // Age reads before anything else: a yearling cannot be worked at all.
    const age = ageOf(c, this.game.time);
    const growing = growsAt(c, this.game.time);
    level.textContent = `${age === 'grown' ? '' : `${age} · `}Lv ${creatureLevel(c)}`;
    level.title = growing > 0 ? `Grown in ${clockLeft(growing)}` : age === 'old' ? 'Slower, but a better carcass' : 'Grown';
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'tb-btn tb-small';
    menu.textContent = '⋯';
    menu.title = 'Actions';
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = menu.getBoundingClientRect();
      this.showMenu(r.left, r.bottom + 2, c.name, this.entriesFor(c.id));
    });
    head.append(name, level, menu);
    card.append(head);

    const bar = (label: string, value: number, cls: string, text: string): HTMLDivElement => {
      const row = document.createElement('div');
      row.className = 'hud-bar-row';
      const l = document.createElement('span');
      l.className = 'hud-bar-label';
      l.textContent = label;
      const track = document.createElement('div');
      track.className = 'hud-bar';
      const fill = document.createElement('div');
      fill.className = `hud-bar-fill ${cls}`;
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
      track.append(fill);
      const v = document.createElement('span');
      v.className = 'hud-bar-value';
      v.textContent = text;
      row.append(l, track, v);
      return row;
    };
    const top = maxHealth(c, def);
    card.append(bar('Health', c.health / top, 'bar-health', `${Math.ceil(c.health)}/${top}`));
    card.append(bar('Hunger', c.hunger, 'bar-hunger', `${Math.round(c.hunger * 100)}%`));
    const care = bar('Care', c.care, 'bar-care', `${Math.round(c.care * 100)}%`);
    care.title = `${careWord(c.care)} \u2014 a brushed wildermon works and learns a quarter faster, and throws better young`;
    card.append(care);
    card.append(this.blood(c));

    const info = document.createElement('div');
    info.className = 'pal-info';
    const parts: string[] = [];
    if (c.ridden) parts.push('Under the saddle');
    else if (c.hitchedTo !== null) parts.push('In the traces');
    else if (c.tacked) parts.push('Saddled and bridled');
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
    info.textContent = parts.join(' · ');
    card.append(info);
    return card;
  }

  /**
   * The three traits it was born with. What you can read off an animal depends
   * on the husbandry behind your eyes: a common trait is plain to anybody, old
   * blood takes a breeder to know.
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
        chip.textContent = t.aura ? `\u25c9 ${t.name}` : t.name;
        chip.style.color = TIER_COLOUR[t.tier];
        chip.style.borderColor = TIER_COLOUR[t.tier];
        chip.title = `${t.tier}${t.aura ? ', communal: it lifts the whole deed' : ''} \u2014 ${t.note}`;
      } else {
        chip.textContent = 'something';
        chip.classList.add('trait-unread');
        chip.title = `You can see there is something in it. ${1 + TIER_LEVEL[t.tier]} animal husbandry would tell you what.`;
      }
      row.append(chip);
    }
    return row;
  }
}
