const DRAG_THRESHOLD = 4;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export interface Pointer {
  x: number;
  y: number;
  /** True when the cursor is over the canvas rather than a UI overlay. */
  overCanvas: boolean;
}

interface Press {
  x: number;
  y: number;
  button: number;
  moved: boolean;
}

/**
 * Mouse and keyboard state for the canvas. UI overlays are DOM elements that
 * sit above the canvas, so events that hit them never reach us.
 */
export class Input {
  readonly pointer: Pointer = { x: 0, y: 0, overCanvas: false };
  onClick?: (x: number, y: number, button: number) => void;
  onDrag?: (dx: number, dy: number, button: number) => void;
  onWheel?: (delta: number, x: number, y: number) => void;
  onKey?: (code: string, ev: KeyboardEvent) => void;

  private keys = new Set<string>();
  private press: Press | null = null;
  private lastX = 0;
  private lastY = 0;

  constructor(canvas: HTMLCanvasElement) {
    canvas.addEventListener('mousedown', (e) => {
      if (this.isTyping()) (document.activeElement as HTMLElement).blur();
      this.press = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.overCanvas = e.target === canvas;
      if (this.press) {
        if (!this.press.moved && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > DRAG_THRESHOLD) {
          this.press.moved = true;
        }
        if (this.press.moved) this.onDrag?.(e.clientX - this.lastX, e.clientY - this.lastY, this.press.button);
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (this.press && e.button === this.press.button) {
        if (!this.press.moved) this.onClick?.(e.clientX, e.clientY, e.button);
        this.press = null;
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.onWheel?.(e.deltaY, e.clientX, e.clientY);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (this.isTyping()) return;
      if (SCROLL_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.onKey?.(e.code, e);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.press = null;
    });
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  get dragging(): boolean {
    return this.press?.moved ?? false;
  }

  /** True while a text field has focus, so hotkeys must not fire. */
  isTyping(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }
}
