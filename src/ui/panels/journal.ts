import type { Game } from '../../game/game';
import { ALL_GOALS, JOURNAL, chapterOf, nextGoals } from '../../game/journal';
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
  private readonly next: HTMLDivElement;

  constructor(win: UIWindow, private readonly game: Game) {
    win.body.classList.add('skills-body');
    this.count = document.createElement('div');
    this.count.className = 'skill-group';
    /*
     * What to do next, above the eighty-five.
     *
     * The list is complete and in a sensible order and answers the wrong
     * question: with everything on screen at the same volume, "what now" is
     * left entirely to the reader. The chapters were written as an order, so
     * the three undone goals nearest the front are the next thing and the two
     * behind it — and the whole list is still underneath, for when the
     * question has become "what else".
     */
    this.next = document.createElement('div');
    this.next.className = 'goal-next';
    win.body.append(this.count, this.next);
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
    this.next.replaceChildren();
    const up = nextGoals(done, 3);
    if (!up.length) {
      this.next.textContent = 'Everything anybody thought worth doing here, done.';
      return;
    }
    const head = document.createElement('div');
    head.className = 'goal-next-head';
    head.textContent = `Next \u00b7 ${chapterOf(up[0].id)}`;
    this.next.append(head);
    up.forEach((goal, i) => {
      const row = document.createElement('div');
      row.className = 'goal-next-row' + (i === 0 ? ' goal-next-first' : '');
      const what = document.createElement('div');
      what.textContent = goal.text;
      row.append(what);
      // Only the one you are actually on gets the long answer; the two behind
      // it get their note, which is what a list is for.
      const say = i === 0 ? goal.how ?? goal.hint : goal.hint;
      if (say) {
        const note = document.createElement('div');
        note.className = 'goal-next-how';
        note.textContent = say;
        row.append(note);
      }
      this.next.append(row);
    });
  }
}
