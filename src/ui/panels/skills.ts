import type { Game } from '../../game/game';
import { SKILL_DEFS } from '../../game/skills';
import type { UIWindow } from '../windows';

export class SkillsPanel {
  private values = new Map<string, HTMLSpanElement>();
  private rows = new Map<string, HTMLDivElement>();

  constructor(win: UIWindow, private readonly game: Game) {
    win.body.classList.add('skills-body');
    for (const group of ['Characteristics', 'Skills'] as const) {
      const header = document.createElement('div');
      header.className = 'skill-group';
      header.textContent = group;
      win.body.append(header);
      for (const def of SKILL_DEFS.filter((d) => d.group === group)) {
        const row = document.createElement('div');
        row.className = 'skill-row';
        const name = document.createElement('span');
        name.textContent = def.name;
        const value = document.createElement('span');
        value.className = 'skill-value';
        row.append(name, value);
        win.body.append(row);
        this.values.set(def.id, value);
        this.rows.set(def.id, row);
      }
    }
    this.refresh();
    game.events.on('skill', (id) => {
      this.refresh();
      const row = this.rows.get(id);
      if (row) {
        row.classList.remove('flash');
        void row.offsetWidth;
        row.classList.add('flash');
      }
    });
  }

  refresh(): void {
    for (const [id, el] of this.values) el.textContent = this.game.skills.get(id).toFixed(2);
  }
}
