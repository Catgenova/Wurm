import type { Game } from '../../game/game';
import { ALL_GOALS, JOURNAL } from '../../game/journal';
import type { UIWindow } from '../windows';

/**
 * The journal: everything somebody thought worth doing on this island, in
 * chapters, ticking itself off as it is done. Nothing here is required and
 * nothing is rewarded; it exists because there is a great deal to do and
 * nothing anywhere else that says so.
 */
export class JournalPanel {
  private readonly rows = new Map<string, HTMLDivElement>();
  private readonly count: HTMLDivElement;

  constructor(win: UIWindow, private readonly game: Game) {
    win.body.classList.add('skills-body');
    this.count = document.createElement('div');
    this.count.className = 'skill-group';
    win.body.append(this.count);
    for (const chapter of JOURNAL) {
      const head = document.createElement('div');
      head.className = 'skill-group';
      head.textContent = chapter.name;
      win.body.append(head);
      for (const goal of chapter.goals) {
        const row = document.createElement('div');
        row.className = 'skill-row goal-row';
        const tick = document.createElement('span');
        tick.className = 'goal-tick';
        const text = document.createElement('span');
        text.textContent = goal.text;
        const hint = document.createElement('span');
        hint.className = 'skill-note';
        hint.textContent = goal.hint ?? '';
        row.append(tick, text, hint);
        row.title = goal.hint ?? goal.text;
        win.body.append(row);
        this.rows.set(goal.id, row);
      }
    }
    this.refresh();
    win.onOpen = () => this.refresh();
    game.events.on('journal', () => this.refresh());
  }

  refresh(): void {
    const done = this.game.ticked;
    for (const [id, row] of this.rows) {
      const met = done.has(id);
      row.classList.toggle('goal-done', met);
      const tick = row.firstElementChild as HTMLElement;
      tick.textContent = met ? '✔' : '·';
    }
    this.count.textContent = `${done.size} of ${ALL_GOALS.length} done`;
  }
}
