export interface MenuItem {
  label: string;
  /** Why the entry is unavailable; shown in red. */
  hint?: string;
  /** Neutral extra text such as a materials list. */
  note?: string;
  disabled?: boolean;
  onSelect?: () => void;
  /** A submenu; the row expands in place so it works with a mouse or a finger. */
  children?: MenuItem[];
}

/** What a list of menu rows needs from whatever is showing it. */
export interface RowHooks {
  /** A submenu opened or closed, so a floating menu can measure itself again. */
  changed?: () => void;
  /** An entry is about to run, so a floating menu can get out of the way. */
  chose?: () => void;
  /** The key that does this entry, when whatever is showing it binds keys. */
  keyOf?: (item: MenuItem) => string | undefined;
  /**
   * Which folds are open, by path. A list that is rebuilt while you work would
   * otherwise shut every submenu under your hand; passing the same set back in
   * keeps them open across as many rebuilds as it takes.
   */
  folds?: Set<string>;
}

/**
 * Build the rows for a list of menu entries. The right-click menu and the tile
 * window both draw their entries with this, so the two can never drift apart.
 */
export function buildMenuRows(items: MenuItem[], depth: number, hooks: RowHooks = {}, path = ''): HTMLElement[] {
  return items.flatMap((item) => buildMenuRow(item, depth, hooks, `${path}/${item.label}`));
}

function buildMenuRow(item: MenuItem, depth: number, hooks: RowHooks, path: string): HTMLElement[] {
  const row = document.createElement('div');
  row.className = 'ctx-item' + (item.disabled ? ' disabled' : '') + (depth ? ' ctx-child' : '');
  row.style.paddingLeft = `${8 + depth * 14}px`;
  // A key that does this entry, written where it can be seen.
  const key = hooks.keyOf?.(item);
  if (key !== undefined) {
    const kbd = document.createElement('kbd');
    kbd.className = 'ctx-key';
    kbd.textContent = key;
    row.append(kbd);
    row.classList.add('ctx-keyed');
  }
  const label = document.createElement('span');
  label.textContent = item.label;
  row.append(label);
  if (item.children) {
    const chevron = document.createElement('span');
    chevron.className = 'ctx-chevron';
    chevron.textContent = '\u25b8';
    // A row that is both a job and a fold: the label does it, the arrow opens
    // the choices. A row that is only a fold opens wherever it is clicked.
    if (item.onSelect) chevron.title = 'More ways to do this';
    row.append(chevron);
    let open: HTMLElement[] | null = null;
    const fold = (remember = true): void => {
      if (open) {
        for (const el of open) el.remove();
        open = null;
        chevron.textContent = '\u25b8';
        if (remember) hooks.folds?.delete(path);
      } else {
        open = buildMenuRows(item.children ?? [], depth + 1, hooks, path);
        row.after(...open);
        chevron.textContent = '\u25be';
        if (remember) hooks.folds?.add(path);
      }
      hooks.changed?.();
    };
    // A fold that was open before this list was rebuilt opens again with it.
    if (hooks.folds?.has(path)) queueMicrotask(() => {
      if (row.isConnected && !open) fold(false);
    });
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.disabled) return;
      fold();
    });
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.disabled) return;
      if (!item.onSelect) {
        fold();
        return;
      }
      hooks.chose?.();
      item.onSelect();
    });
    return [row];
  }
  if (item.hint) {
    const hint = document.createElement('span');
    hint.className = 'ctx-hint';
    hint.textContent = item.hint;
    row.append(hint);
    row.title = item.hint;
  } else if (item.note) {
    const note = document.createElement('span');
    note.className = 'ctx-note';
    note.textContent = item.note;
    row.append(note);
  }
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    if (item.disabled) return;
    hooks.chose?.();
    item.onSelect?.();
  });
  return [row];
}

/** Wurm-style right-click menu. */
export class ContextMenu {
  readonly el: HTMLDivElement;
  private swallow = false;

  constructor(root: HTMLElement, private readonly canvas: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'ctx-menu';
    this.el.hidden = true;
    root.append(this.el);
    const outside = (e: Event): void => {
      if (this.el.hidden) return;
      if (!this.el.contains(e.target as Node)) {
        this.hide();
        if (e.target === this.canvas) this.swallow = true;
      }
    };
    window.addEventListener('mousedown', outside, true);
    window.addEventListener('touchstart', outside, { capture: true, passive: true });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  show(x: number, y: number, title: string, items: MenuItem[]): void {
    this.el.replaceChildren();
    const head = document.createElement('div');
    head.className = 'ctx-title';
    head.textContent = title;
    this.el.append(head);
    if (!items.length) {
      const none = document.createElement('div');
      none.className = 'ctx-item disabled';
      none.textContent = 'Nothing to do here';
      this.el.append(none);
    }
    this.el.append(...buildMenuRows(items, 0, { changed: () => this.fit(), chose: () => this.hide() }));
    this.el.hidden = false;
    this.anchor = { x, y };
    this.fit();
  }

  private anchor = { x: 0, y: 0 };

  /** Place the menu at its anchor, pulled back inside the viewport if it would overflow. */
  private fit(): void {
    this.el.style.left = '0px';
    this.el.style.top = '0px';
    const rect = this.el.getBoundingClientRect();
    const left = Math.min(this.anchor.x, window.innerWidth - rect.width - 4);
    const top = Math.min(this.anchor.y, window.innerHeight - rect.height - 4);
    this.el.style.left = `${Math.max(0, left)}px`;
    this.el.style.top = `${Math.max(0, top)}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }

  /** True once when the menu was just closed by a press on the canvas, so a plain click there does nothing else. */
  consumeSwallow(): boolean {
    const s = this.swallow;
    this.swallow = false;
    return s;
  }
}
