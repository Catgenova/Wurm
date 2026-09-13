const DRAG_THRESHOLD = 4;
const TOUCH_DRAG_THRESHOLD = 8;
const LONG_PRESS_MS = 450;
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

/** One-finger gesture in progress: becomes a tap, a pan or a long press. */
interface TouchGesture {
  id: number;
  startX: number;
  startY: number;
  startTime: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  /** The long press already fired, so lifting the finger must not count as a tap. */
  fired: boolean;
}

interface Pinch {
  dist: number;
  midX: number;
  midY: number;
}

/**
 * Mouse, touch and keyboard state for the canvas. UI overlays are DOM elements
 * that sit above the canvas, so events that hit them never reach us.
 *
 * Touch: tap = left click, long press = right click, one-finger drag = pan,
 * two fingers = pinch zoom plus pan.
 */
export class Input {
  readonly pointer: Pointer = { x: 0, y: 0, overCanvas: false };
  onClick?: (x: number, y: number, button: number) => void;
  onDrag?: (dx: number, dy: number, button: number) => void;
  onWheel?: (delta: number, x: number, y: number) => void;
  /** Multiplicative zoom about a screen point (pinch). */
  onPinch?: (factor: number, x: number, y: number) => void;
  onKey?: (code: string, ev: KeyboardEvent) => void;

  private keys = new Set<string>();
  private press: Press | null = null;
  private lastX = 0;
  private lastY = 0;
  private touches = new Map<number, { x: number; y: number }>();
  private gesture: TouchGesture | null = null;
  private pinch: Pinch | null = null;
  private longPress: ReturnType<typeof setTimeout> | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.bindTouch(canvas);
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
    /*
     * Right-click opens the game's own menu, which pops up under the cursor
     * before the browser fires contextmenu. The event then targets that menu
     * rather than the canvas, so suppressing it on the canvas alone lets the
     * browser menu through on top. Catch it on the window instead, and leave
     * text fields alone so copy and paste still work there.
     */
    window.addEventListener('contextmenu', (e) => {
      const el = e.target;
      if (el instanceof Element && el.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
    });
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
    return (this.press?.moved ?? false) || (this.gesture?.moved ?? false) || this.pinch !== null;
  }

  private bindTouch(canvas: HTMLCanvasElement): void {
    const opts: AddEventListenerOptions = { passive: false };
    canvas.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        if (this.isTyping()) (document.activeElement as HTMLElement).blur();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          this.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
        const first = e.changedTouches[0];
        this.pointer.x = first.clientX;
        this.pointer.y = first.clientY;
        this.pointer.overCanvas = true;
        if (this.touches.size === 1) {
          this.beginGesture(first.identifier, first.clientX, first.clientY, false);
        } else {
          this.cancelLongPress();
          if (this.gesture) this.gesture.moved = true;
          this.pinch = this.measurePinch();
        }
      },
      opts,
    );
    canvas.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (this.touches.has(t.identifier)) this.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
        if (this.touches.size >= 2) {
          const now = this.measurePinch();
          if (this.pinch) {
            if (this.pinch.dist > 0 && now.dist > 0) this.onPinch?.(now.dist / this.pinch.dist, now.midX, now.midY);
            this.onDrag?.(now.midX - this.pinch.midX, now.midY - this.pinch.midY, 1);
          }
          this.pinch = now;
          return;
        }
        const g = this.gesture;
        if (!g) return;
        const p = this.touches.get(g.id);
        if (!p) return;
        if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) > TOUCH_DRAG_THRESHOLD) {
          g.moved = true;
          this.cancelLongPress();
        }
        if (g.moved && !g.fired) this.onDrag?.(p.x - g.lastX, p.y - g.lastY, 0);
        g.lastX = p.x;
        g.lastY = p.y;
        this.pointer.x = p.x;
        this.pointer.y = p.y;
      },
      opts,
    );
    const end = (e: TouchEvent): void => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) this.touches.delete(e.changedTouches[i].identifier);
      if (this.touches.size === 0) {
        const g = this.gesture;
        this.cancelLongPress();
        if (g && !g.moved && !g.fired && performance.now() - g.startTime < LONG_PRESS_MS) this.onClick?.(g.startX, g.startY, 0);
        this.gesture = null;
        this.pinch = null;
      } else if (this.touches.size === 1) {
        // One finger left after a pinch: carry on as a pan, never a tap.
        const rest = this.touches.entries().next().value;
        this.pinch = null;
        if (rest) this.beginGesture(rest[0], rest[1].x, rest[1].y, true);
      }
    };
    canvas.addEventListener('touchend', end, opts);
    canvas.addEventListener('touchcancel', end, opts);
    // A touch on a UI overlay means the finger is no longer "over" the canvas.
    window.addEventListener('touchstart', (e) => (this.pointer.overCanvas = e.target === canvas), { passive: true, capture: true });
  }

  private beginGesture(id: number, x: number, y: number, moved: boolean): void {
    this.cancelLongPress();
    this.gesture = { id, startX: x, startY: y, startTime: performance.now(), lastX: x, lastY: y, moved, fired: false };
    if (moved) return;
    this.longPress = setTimeout(() => {
      const g = this.gesture;
      this.longPress = null;
      if (!g || g.id !== id || g.moved || g.fired) return;
      g.fired = true;
      navigator.vibrate?.(20);
      this.onClick?.(g.startX, g.startY, 2);
    }, LONG_PRESS_MS);
  }

  private cancelLongPress(): void {
    if (this.longPress !== null) {
      clearTimeout(this.longPress);
      this.longPress = null;
    }
  }

  private measurePinch(): Pinch {
    const pts = Array.from(this.touches.values()).slice(0, 2);
    const a = pts[0];
    const b = pts[1] ?? pts[0];
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
  }

  /** True while a text field has focus, so hotkeys must not fire. */
  isTyping(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }
}
