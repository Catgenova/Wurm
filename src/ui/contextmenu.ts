export interface MenuItem {
  label: string;
  hint?: string;
  disabled?: boolean;
  onSelect?: () => void;
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
    window.addEventListener(
      'mousedown',
      (e) => {
        if (this.el.hidden) return;
        if (!this.el.contains(e.target as Node)) {
          this.hide();
          if (e.target === this.canvas) this.swallow = true;
        }
      },
      true,
    );
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
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'ctx-item' + (item.disabled ? ' disabled' : '');
      const label = document.createElement('span');
      label.textContent = item.label;
      row.append(label);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'ctx-hint';
        hint.textContent = item.hint;
        row.append(hint);
        row.title = item.hint;
      }
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.disabled) return;
        this.hide();
        item.onSelect?.();
      });
      this.el.append(row);
    }
    this.el.hidden = false;
    this.el.style.left = '0px';
    this.el.style.top = '0px';
    const rect = this.el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 4);
    const top = Math.min(y, window.innerHeight - rect.height - 4);
    this.el.style.left = `${Math.max(0, left)}px`;
    this.el.style.top = `${Math.max(0, top)}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }

  /** True once when the menu was just closed by a click on the canvas, so that click does nothing else. */
  consumeSwallow(): boolean {
    const s = this.swallow;
    this.swallow = false;
    return s;
  }
}
