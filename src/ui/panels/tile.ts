import type { Game } from '../../game/game';
import type { Pick } from '../../render/renderer';
import { buildMenuRows, type MenuItem } from '../contextmenu';
import type { UIWindow } from '../windows';

/** What the window is looking at, and everything that could be done to it. */
export type TileMenuSource = (pick: Pick) => { title: string; entries: MenuItem[] };

/**
 * The tile window: click any tile and everything you could do to it is listed
 * here, the same list the right-click menu shows. It is for playing with one
 * button — a finger, a trackpad, or a left hand that would rather not reach for
 * the other one — and for seeing at a glance why something is not possible yet.
 */
export class TilePanel {
  private head: HTMLDivElement;
  private list: HTMLDivElement;
  private pick: Pick | null = null;

  constructor(
    private readonly win: UIWindow,
    game: Game,
    private readonly source: TileMenuSource,
  ) {
    win.body.classList.add('inv-body');
    this.head = document.createElement('div');
    this.head.className = 'tile-head';
    this.list = document.createElement('div');
    this.list.className = 'inv-list';
    win.body.append(this.head, this.list);
    // The list is only as good as the world it was built from, so rebuild it
    // whenever the world, the pack or the job in hand changes.
    for (const ev of ['world', 'inventory', 'action', 'crate', 'skill'] as const) game.events.on(ev, () => this.render());
    this.render();
  }

  /** What the window is showing, if anything. */
  get target(): Pick | null {
    return this.pick;
  }

  /** Point the window at a tile, opening it if it is closed. */
  select(pick: Pick | null, open = true): void {
    this.pick = pick;
    if (pick && open) this.win.open();
    this.render();
  }

  render(): void {
    this.list.replaceChildren();
    if (!this.pick) {
      this.head.textContent = 'Nothing selected';
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'Click any tile and everything you can do to it is listed here.';
      this.list.append(empty);
      return;
    }
    const { title, entries } = this.source(this.pick);
    this.head.textContent = title;
    if (!entries.length) {
      const none = document.createElement('div');
      none.className = 'inv-empty';
      none.textContent = 'Nothing to do here.';
      this.list.append(none);
      return;
    }
    this.list.append(...buildMenuRows(entries, 0));
  }
}
