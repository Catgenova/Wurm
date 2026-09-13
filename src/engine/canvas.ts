/** A canvas that always covers the whole viewport and is DPR aware. */
export class FullscreenCanvas {
  readonly el: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  width = 1;
  height = 1;
  dpr = 1;
  private listeners: Array<() => void> = [];

  constructor(el: HTMLCanvasElement) {
    this.el = el;
    const ctx = el.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas is not supported in this browser');
    this.ctx = ctx;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  onResize(fn: () => void): void {
    this.listeners.push(fn);
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.el.width = Math.round(this.width * this.dpr);
    this.el.height = Math.round(this.height * this.dpr);
    this.el.style.width = `${this.width}px`;
    this.el.style.height = `${this.height}px`;
    for (const fn of this.listeners) fn();
  }

  /** Reset the transform so one unit equals one CSS pixel. */
  begin(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
}
