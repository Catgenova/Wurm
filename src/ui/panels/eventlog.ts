import type { LogEntry } from '../../game/events';
import type { Game } from '../../game/game';
import type { UIWindow } from '../windows';

function stamp(t: number): string {
  const d = new Date(t);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export class EventLogPanel {
  private list: HTMLDivElement;
  readonly input: HTMLInputElement;
  private pinned = true;

  constructor(win: UIWindow, game: Game) {
    win.body.classList.add('log-body');
    this.list = document.createElement('div');
    this.list.className = 'log-list';
    this.list.addEventListener('scroll', () => {
      this.pinned = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 8;
    });
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'log-input';
    this.input.placeholder = 'Say something… (Enter)';
    this.input.maxLength = 200;
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
    win.body.append(this.list, this.input);
    for (const entry of game.log) this.append(entry);
    game.events.on('log', (entry) => this.append(entry));
  }

  private append(entry: LogEntry): void {
    const line = document.createElement('div');
    line.className = `log-line log-${entry.kind}`;
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = `[${stamp(entry.time)}] `;
    line.append(time, document.createTextNode(entry.text));
    this.list.append(line);
    while (this.list.childElementCount > 400) this.list.firstElementChild?.remove();
    if (this.pinned) this.list.scrollTop = this.list.scrollHeight;
  }

  focus(): void {
    this.input.focus();
  }
}
