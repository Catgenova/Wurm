import { creatureLevel, GATHER_VERB, RANGE_PER_STEP, SKILL_STEP, SPECIES, STANCE_NAMES, taskSkill, workRangeOf, type Creature } from '../../game/creatures';

import type { Game } from '../../game/game';
import { itemDef } from '../../game/items';
import type { MenuItem } from '../contextmenu';
import type { UIWindow } from '../windows';

const GROUPS: Array<[Creature['mode'], string]> = [
  ['active', 'Travelling with you'],
  ['deed', 'Working the deed'],
  ['stored', 'Kept at the token'],
];

/** Your tamed wildermon with their condition, progress and actions. Wild ones are not listed. */
export class WildermonPanel {
  private list: HTMLDivElement;
  private lastRender = 0;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly entriesFor: (id: number) => MenuItem[],
    private readonly showMenu: (x: number, y: number, title: string, items: MenuItem[]) => void,
  ) {
    win.body.classList.add('pals-body');
    this.list = document.createElement('div');
    this.list.className = 'pals-list';
    win.body.append(this.list);
    this.render();
  }

  /** Redraw a few times a second while open; stats move constantly. */
  update(now: number): void {
    if (!this.win.isOpen || now - this.lastRender < 400) return;
    this.lastRender = now;
    this.render();
  }

  render(): void {
    const owned = [...this.game.creatures.list.values()].filter((c) => c.mode !== 'wild');
    this.list.replaceChildren();
    if (!owned.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'You have no tamed wildermon yet. Carry a berry for a Rabba or a spice for a Vola, then try Tame on a wild one.';
      this.list.append(empty);
      return;
    }
    for (const [mode, title] of GROUPS) {
      const group = owned.filter((c) => c.mode === mode);
      if (!group.length) continue;
      const header = document.createElement('div');
      header.className = 'inv-group';
      header.textContent = title;
      this.list.append(header);
      for (const c of group) this.list.append(this.card(c));
    }
  }

  private card(c: Creature): HTMLDivElement {
    const def = SPECIES[c.species] ?? SPECIES.rabba;
    const card = document.createElement('div');
    card.className = 'pal-card';
    const head = document.createElement('div');
    head.className = 'pal-head';
    const name = document.createElement('span');
    name.className = 'pal-name';
    name.textContent = `${c.name}${c.name !== def.name ? ` · ${def.name}` : ''}`;
    const level = document.createElement('span');
    level.className = 'pal-level';
    level.textContent = `Lv ${creatureLevel(c)}`;
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
    card.append(bar('Health', c.health / def.health, 'bar-health', `${Math.ceil(c.health)}/${def.health}`));
    card.append(bar('Hunger', c.hunger, 'bar-hunger', `${Math.round(c.hunger * 100)}%`));

    const info = document.createElement('div');
    info.className = 'pal-info';
    const parts: string[] = [];
    if (c.hitchedTo !== null) parts.push('In the traces');
    if (c.mode === 'active') parts.push(`Stance: ${STANCE_NAMES[c.stance]}`);
    if (c.mode === 'deed') {
      const verb = def.gathers ? GATHER_VERB[def.gathers] : 'working';
      parts.push(c.carrying ? `Carrying ${itemDef(c.carrying.id).name.toLowerCase()} to the crate` : c.state === 'forage' ? `${verb[0].toUpperCase()}${verb.slice(1)}` : c.state === 'toForage' ? `Heading out to ${def.gathers ?? 'work'}` : 'Looking for work');
    }
    if (c.mode === 'deed' && def.gathers) {
      const toNext = SKILL_STEP - (taskSkill(c, def) % SKILL_STEP);
      parts.push(`Range ${workRangeOf(c, def)} tiles (+${def.rangePerStep ?? RANGE_PER_STEP} in ${toNext.toFixed(1)} skill)`);
    }
    parts.push(`Attack ${def.attack}`);
    const skills = Object.entries(c.skills).map(([id, v]) => `${id[0].toUpperCase()}${id.slice(1)} ${v.toFixed(2)}`);
    parts.push(...skills);
    parts.push(`Experience ${c.xp.toFixed(1)}`);
    info.textContent = parts.join(' · ');
    card.append(info);
    return card;
  }
}
