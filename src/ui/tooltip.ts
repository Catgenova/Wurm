export class Tooltip {
  readonly el: HTMLDivElement;
  /**
   * Who put it there. There is one tooltip on the page and two things want it:
   * the world under the pointer, which asks for it every frame and gives it up
   * every frame, and a note pinned open from a panel, which must not be wiped
   * off by the next frame of the first. Whoever holds it is the only one who
   * can take it down.
   */
  private holder: unknown = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tooltip';
    this.el.hidden = true;
    root.append(this.el);
  }

  /**
   * `wide` lets the lines wrap inside a fixed width. A fact about what is
   * under the pointer is one short line and reads best on one line; a note
   * about what a thing is *for* is a sentence, and a sentence six hundred
   * pixels long is not a tooltip.
   */
  show(x: number, y: number, lines: string[], holder: unknown = null, wide = false): void {
    if (this.holder && this.holder !== holder) return;
    this.holder = holder;
    this.el.classList.toggle('tooltip-wide', wide);
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

  hide(holder: unknown = null): void {
    if (this.holder && this.holder !== holder) return;
    this.holder = null;
    this.el.hidden = true;
  }
}
