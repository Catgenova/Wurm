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
    for (const item of items) this.el.append(...this.buildRow(item, 0));
    this.el.hidden = false;
    this.anchor = { x, y };
    this.fit();
  }

  private anchor = { x: 0, y: 0 };

  private buildRow(item: MenuItem, depth: number): HTMLElement[] {
    const row = document.createElement('div');
    row.className = 'ctx-item' + (item.disabled ? ' disabled' : '') + (depth ? ' ctx-child' : '');
    row.style.paddingLeft = `${8 + depth * 14}px`;
    const label = document.createElement('span');
    label.textContent = item.label;
    row.append(label);
    if (item.children) {
      const chevron = document.createElement('span');
      chevron.className = 'ctx-chevron';
      chevron.textContent = '▸';
      row.append(chevron);
      let open: HTMLElement[] | null = null;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.disabled) return;
        if (open) {
          for (const el of open) el.remove();
          open = null;
          chevron.textContent = '▸';
        } else {
          open = item.children!.flatMap((child) => this.buildRow(child, depth + 1));
          row.after(...open);
          chevron.textContent = '▾';
        }
        this.fit();
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
      this.hide();
      item.onSelect?.();
    });
    return [row];
  }

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
