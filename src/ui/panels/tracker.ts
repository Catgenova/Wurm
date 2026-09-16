import type { Game } from '../../game/game';
import { SKILL_DEFS } from '../../game/skills';
import type { MenuItem } from '../contextmenu';
import type { UIWindow } from '../windows';

/**
 * How many trades you may keep an eye on at once.
 *
 * Five is enough for a session's work — a smith watching blacksmithing, the
 * two metals under it and the weapon he is making — and few enough that the
 * window stays a corner of the screen rather than a second skills list. The
 * whole book is in the Skills window and always was; this is for the handful
 * you are actually moving today.
 */
export const TRACKED_MAX = 5;

const STORAGE_KEY = 'wurm.tracked';

/**
 * Which trades this browser is watching.
 *
 * Kept where the window layout is kept rather than with the island: it is a
 * preference about this screen, not a fact about the body — two people at one
 * account watch different things, and the island has no business knowing which
 * bars somebody likes looking at.
 */
function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const got = JSON.parse(raw) as unknown;
    if (!Array.isArray(got)) return [];
    const known = new Set(SKILL_DEFS.map((d) => d.id));
    return got.filter((id): id is string => typeof id === 'string' && known.has(id)).slice(0, TRACKED_MAX);
  } catch {
    return [];
  }
}

function save(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable; the list simply will not survive a refresh.
  }
}

/** Where a trade stands between one level and the next. */
export function toNext(value: number): { level: number; part: number; capped: boolean } {
  if (value >= 100) return { level: 100, part: 1, capped: true };
  const level = Math.floor(value);
  return { level, part: value - level, capped: false };
}

/**
 * The few trades you are watching today, with a bar apiece.
 *
 * The Skills window is the whole book — forty rows in three groups, every one
 * of them a number to two places — and reading a single one of them climb
 * means finding it again each time. This is the handful you care about this
 * session, each with how far it has come toward its next level and what it
 * actually stands at.
 */
export class TrackerPanel {
  private tracked: string[] = load();
  private readonly list: HTMLDivElement;
  private readonly addBtn: HTMLButtonElement;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly showMenu: (x: number, y: number, title: string, items: MenuItem[]) => void,
  ) {
    win.body.classList.add('track-body');
    this.list = document.createElement('div');
    this.list.className = 'track-list';
    this.addBtn = document.createElement('button');
    this.addBtn.type = 'button';
    this.addBtn.className = 'track-add';
    this.addBtn.addEventListener('click', () => {
      const r = this.addBtn.getBoundingClientRect();
      this.showMenu(r.left, r.bottom, 'Track a trade', this.choices());
    });
    win.body.append(this.list, this.addBtn);
    this.draw();
    win.onOpen = () => this.draw();
    // Every action gains something, so this fires several times a second while
    // you work. Redrawing five rows is nothing; the Skills window is the one
    // that has to be careful.
    game.events.on('skill', () => {
      if (this.win.isOpen) this.draw();
    });
  }

  /** Whether a trade is being watched, for anything that wants to say so. */
  has(id: string): boolean {
    return this.tracked.includes(id);
  }

  /** Watch a trade, or stop watching it. Returns why not, when it will not. */
  toggle(id: string): string | null {
    const at = this.tracked.indexOf(id);
    if (at >= 0) {
      this.tracked.splice(at, 1);
    } else {
      if (this.tracked.length >= TRACKED_MAX) {
        const why = `You can watch ${TRACKED_MAX} trades at once. Drop one first.`;
        this.game.logMsg(why, 'error');
        return why;
      }
      this.tracked.push(id);
    }
    save(this.tracked);
    this.draw();
    return null;
  }

  /** The list to pick from: every trade, grouped as the Skills window groups them. */
  private choices(): MenuItem[] {
    const groups = ['Characteristics', 'Fighting', 'Skills'] as const;
    return groups.map((group) => ({
      label: group,
      children: SKILL_DEFS.filter((d) => d.group === group).map((d) => ({
        label: `${this.has(d.id) ? '✓ ' : ''}${d.name}`,
        note: this.game.skills.get(d.id).toFixed(2),
        disabled: !this.has(d.id) && this.tracked.length >= TRACKED_MAX,
        hint: !this.has(d.id) && this.tracked.length >= TRACKED_MAX
          ? `${TRACKED_MAX} already` : undefined,
        onSelect: () => void this.toggle(d.id),
      })),
    }));
  }

  private draw(): void {
    this.list.replaceChildren();
    this.addBtn.textContent = this.tracked.length >= TRACKED_MAX
      ? `Watching ${TRACKED_MAX} — swap one out`
      : 'Track a trade…';
    if (!this.tracked.length) {
      const none = document.createElement('div');
      none.className = 'inv-empty';
      none.textContent = `Pick up to ${TRACKED_MAX} trades and they will keep a bar here: how far each is toward its next level, and what it stands at now.`;
      this.list.append(none);
      return;
    }
    for (const id of this.tracked) {
      const def = SKILL_DEFS.find((d) => d.id === id);
      if (!def) continue;
      const value = this.game.skills.get(id);
      const { level, part, capped } = toNext(value);

      const row = document.createElement('div');
      row.className = 'track-row';

      const name = document.createElement('span');
      name.className = 'track-name';
      name.textContent = def.name;

      const shown = document.createElement('span');
      shown.className = 'track-value';
      shown.textContent = value.toFixed(2);

      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'track-drop';
      drop.textContent = '✕';
      drop.title = `Stop watching ${def.name.toLowerCase()}`;
      drop.addEventListener('click', () => void this.toggle(id));

      const track = document.createElement('div');
      track.className = 'hud-bar track-bar';
      const fill = document.createElement('div');
      fill.className = 'hud-bar-fill track-fill';
      fill.style.width = `${(part * 100).toFixed(1)}%`;
      track.append(fill);

      const next = document.createElement('span');
      next.className = 'track-next';
      next.textContent = capped
        ? 'as high as it goes'
        : `${Math.floor(part * 100)}% to ${level + 1}`;

      row.append(name, shown, drop, track, next);
      this.list.append(row);
    }
  }
}
