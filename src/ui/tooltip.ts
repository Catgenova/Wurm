export class Tooltip {
  readonly el: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tooltip';
    this.el.hidden = true;
    root.append(this.el);
  }

  show(x: number, y: number, lines: string[]): void {
    this.el.replaceChildren(...lines.map((text, i) => {
      const div = document.createElement('div');
      div.className = i === 0 ? 'tooltip-title' : 'tooltip-line';
      div.textContent = text;
      return div;
    }));
    this.el.hidden = false;
    const rect = this.el.getBoundingClientRect();
    let left = x + 16;
    let top = y + 20;
    if (left + rect.width > window.innerWidth - 4) left = x - rect.width - 8;
    if (top + rect.height > window.innerHeight - 4) top = y - rect.height - 8;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
