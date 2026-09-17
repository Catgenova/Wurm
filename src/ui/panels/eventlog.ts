import { SAY_MAX } from '../../game/chat';
import type { LogEntry, LogKind } from '../../game/events';
import type { Game } from '../../game/game';
import type { UIWindow } from '../windows';

/**
 * When a line was said.
 *
 * The hour alone until it is not today's hour. Lines used to be stamped with
 * the moment they reached this machine, so every one of them was from the
 * session you were sitting in and the day never needed saying; they carry
 * the island's own hour now, and a chat scrolled back far enough reaches
 * yesterday — where `09:14:02` on its own is a time that could be any day at
 * all.
 */
function stamp(t: number): string {
  const d = new Date(t);
  const two = (n: number): string => String(n).padStart(2, '0');
  const clock = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  return sameDay ? clock : `${d.getDate()} ${MONTHS[d.getMonth()]} ${clock}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The tabs along the top of the log, and which kinds of line each keeps. */
const TABS: Array<{ id: string; label: string; title: string; kinds: LogKind[] | null }> = [
  { id: 'all', label: 'All', title: 'Everything, as it happens', kinds: null },
  { id: 'event', label: 'Work', title: 'What your hands have been doing', kinds: ['event', 'info'] },
  { id: 'skill', label: 'Skills', title: 'What you have learned', kinds: ['skill'] },
  { id: 'chat', label: 'Talk', title: 'What has been said', kinds: ['chat', 'system'] },
  { id: 'error', label: 'Trouble', title: 'What went wrong, and why', kinds: ['error'] },
];

export class EventLogPanel {
  private list: HTMLDivElement;
  readonly input: HTMLInputElement;
  private pinned = true;
  private tab = TABS[0];
  private query = '';
  private search: HTMLInputElement;
  private tabEls = new Map<string, HTMLButtonElement>();
  private unread = new Map<string, number>();

  constructor(
    win: UIWindow,
    private readonly game: Game,
  ) {
    win.body.classList.add('log-body');
    // Which lines are kept, and a box to look through them.
    const bar = document.createElement('div');
    bar.className = 'log-tabs';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-btn tb-small log-tab' + (t === this.tab ? ' tb-on' : '');
      b.textContent = t.label;
      b.title = t.title;
      b.dataset.tab = t.id;
      b.addEventListener('click', () => this.show(t.id));
      this.tabEls.set(t.id, b);
      bar.append(b);
    }
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'panel-search log-search';
    this.search.placeholder = 'Find…';
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
    bar.append(this.search);
    this.list = document.createElement('div');
    this.list.className = 'log-list';
    this.list.addEventListener('scroll', () => {
      this.pinned = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 8;
    });
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'log-input';
    this.input.placeholder = 'Say something… (Enter)';
    this.input.maxLength = SAY_MAX;
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        game.say(this.input.value);
        this.input.value = '';
        this.input.blur();
      } else if (e.key === 'Escape') {
        this.input.blur();
      }
    });
    win.body.append(bar, this.list, this.input);
    this.render();
    game.events.on('log', (entry) => this.arrived(entry));
  }

  /** Whether a line belongs on the tab being looked at, and answers the search. */
  private keeps(entry: LogEntry): boolean {
    if (this.tab.kinds && !this.tab.kinds.includes(entry.kind)) return false;
    return !this.query || entry.text.toLowerCase().includes(this.query);
  }

  /** Switch tabs, and forget what was waiting on the one switched to. */
  show(id: string): void {
    const tab = TABS.find((t) => t.id === id);
    if (!tab) return;
    this.tab = tab;
    this.unread.set(id, 0);
    for (const [key, el] of this.tabEls) el.classList.toggle('tb-on', key === id);
    this.pinned = true;
    this.render();
  }

  /** Redraw the whole list from the game's own log. */
  private render(): void {
    this.list.replaceChildren();
    let shown = 0;
    for (const entry of this.game.log) {
      if (!this.keeps(entry)) continue;
      this.list.append(this.line(entry));
      shown += 1;
    }
    if (!shown) {
      const empty = document.createElement('div');
      empty.className = 'log-line log-info';
      empty.textContent = this.query ? `Nothing in the log answers to “${this.search.value.trim()}”.` : 'Nothing of that sort yet.';
      this.list.append(empty);
    }
    this.marks();
    this.list.scrollTop = this.list.scrollHeight;
  }

  /** A line has come in: add it if it belongs here, and count it if it does not. */
  private arrived(entry: LogEntry): void {
    for (const t of TABS) {
      if (t === this.tab || (t.kinds && !t.kinds.includes(entry.kind))) continue;
      this.unread.set(t.id, (this.unread.get(t.id) ?? 0) + 1);
    }
    this.marks();
    if (!this.keeps(entry)) return;
    // The first real line clears the "nothing of that sort" notice.
    if (this.list.firstElementChild && !this.list.querySelector('.log-time')) this.list.replaceChildren();
    this.list.append(this.line(entry));
    while (this.list.childElementCount > 400) this.list.firstElementChild?.remove();
    if (this.pinned) this.list.scrollTop = this.list.scrollHeight;
  }

  /** Put the waiting count on each tab that has one. */
  private marks(): void {
    for (const t of TABS) {
      const el = this.tabEls.get(t.id);
      if (!el) continue;
      const n = t === this.tab ? 0 : (this.unread.get(t.id) ?? 0);
      el.textContent = n ? `${t.label} ${n > 99 ? '99+' : n}` : t.label;
      el.classList.toggle('log-waiting', n > 0);
    }
  }

  private line(entry: LogEntry): HTMLDivElement {
    const line = document.createElement('div');
    line.className = `log-line log-${entry.kind}`;
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = `[${stamp(entry.time)}] `;
    line.append(time, document.createTextNode(entry.text));
    return line;
  }

  focus(): void {
    this.input.focus();
  }
}
