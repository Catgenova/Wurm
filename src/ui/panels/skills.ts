import type { Game } from '../../game/game';
import { SKILL_DEFS } from '../../game/skills';
import type { UIWindow } from '../windows';

export class SkillsPanel {
  private values = new Map<string, HTMLSpanElement>();
  private notes = new Map<string, HTMLSpanElement>();
  private rows = new Map<string, HTMLDivElement>();

  constructor(win: UIWindow, private readonly game: Game) {
    win.body.classList.add('skills-body');
    for (const group of ['Characteristics', 'Fighting', 'Skills'] as const) {
      const header = document.createElement('div');
      header.className = 'skill-group';
      header.textContent = group;
      win.body.append(header);
      for (const def of SKILL_DEFS.filter((d) => d.group === group)) {
        const row = document.createElement('div');
        row.className = 'skill-row';
        const name = document.createElement('span');
        name.textContent = def.name;
        const note = document.createElement('span');
        note.className = 'skill-note';
        const value = document.createElement('span');
        value.className = 'skill-value';
        row.append(name, note, value);
        win.body.append(row);
        this.values.set(def.id, value);
        this.notes.set(def.id, note);
        this.rows.set(def.id, row);
      }
    }
    this.refresh();
    win.onOpen = () => this.refresh();
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
    for (const [id, el] of this.notes) el.textContent = this.note(id);
  }

  /** What a characteristic is worth right now, in the plainest terms. */
  private note(id: string): string {
    const g = this.game;
    const v = g.skills.get(id);
    switch (id) {
      case 'body_strength':
        return `hits for ${(2 + v / 12).toFixed(1)}`;
      case 'body_stamina':
        return `−${Math.round((1 - g.staminaCost(1)) * 100)}% wind`;
      case 'body_control':
        return `−${Math.round((1 - g.controlSpeed()) * 100)}% time`;
      case 'mind_logic':
        return `${g.queueCapacity()} jobs in hand`;
      case 'soul_strength':
        return `+${(g.soulBonus() * 100).toFixed(1)}% tame`;
      case 'climbing':
        return `slopes to ${Math.round(g.climbStep())}`;
      case 'swimming':
        return `${Math.round(g.player.swimSpeed * 100)}% swim speed`;
      default:
        return '';
    }
  }
}
