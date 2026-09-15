import { uiBox, uiFloor, uiPoint } from './screen';

export type Anchor = 'tl' | 'tr' | 'bl' | 'br';

export interface WindowOptions {
  id: string;
  title: string;
  /** Offset from the anchor corner of the viewport. */
  x: number;
  y: number;
  width: number;
  height: number;
  anchor?: Anchor;
  open?: boolean;
}

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SavedState extends Geometry {
  open: boolean;
  /** Expanded to (nearly) the whole viewport; x/y/w/h hold the geometry to restore. */
  max?: boolean;
}

const STORAGE_KEY = 'wurm-iso-windows';
const EXPAND_ICON = '⤢';
const RESTORE_ICON = '⤡';

/** A draggable, resizable overlay window in the Wurm style. */
export class UIWindow {
  readonly el: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly titleText: HTMLSpanElement;
  private readonly expandBtn: HTMLButtonElement;
  private maximized = false;
  /** Geometry to go back to when the window is restored from expanded. */
  private normal: Geometry | null = null;

  constructor(
    private readonly mgr: WindowManager,
    readonly opts: WindowOptions,
    saved: SavedState | undefined,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'win';
    this.el.dataset.id = opts.id;
    const title = document.createElement('div');
    title.className = 'win-title';
    this.titleText = document.createElement('span');
    this.titleText.className = 'win-title-text';
    this.titleText.textContent = opts.title;
    const buttons = document.createElement('span');
    buttons.className = 'win-buttons';
    this.expandBtn = document.createElement('button');
    this.expandBtn.className = 'win-btn win-expand';
    this.expandBtn.type = 'button';
    this.expandBtn.title = 'Expand';
    this.expandBtn.textContent = EXPAND_ICON;
    this.expandBtn.addEventListener('click', () => this.toggleMaximized());
    const close = document.createElement('button');
    close.className = 'win-btn win-close';
    close.type = 'button';
    close.title = 'Close';
    close.textContent = '×';
    close.addEventListener('click', () => this.close());
    buttons.append(this.expandBtn, close);
    title.append(this.titleText, buttons);
    this.body = document.createElement('div');
    this.body.className = 'win-body';
    this.el.append(title, this.body);

    // Never start larger than the screen, whatever the saved layout says.
    const w = Math.min(saved?.w ?? opts.width, Math.max(160, uiBox().w - 16));
    const h = Math.min(saved?.h ?? opts.height, Math.max(70, uiBox().h - 16));
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    if (saved) {
      this.el.style.left = `${saved.x}px`;
      this.el.style.top = `${saved.y}px`;
    } else {
      const anchor = opts.anchor ?? 'tl';
      const left = anchor === 'tr' || anchor === 'br' ? uiBox().w - w - opts.x : opts.x;
      const top = anchor === 'bl' || anchor === 'br' ? uiBox().h - h - opts.y : opts.y;
      this.el.style.left = `${left}px`;
      this.el.style.top = `${top}px`;
    }
    this.el.hidden = !(saved?.open ?? opts.open ?? true);
    if (saved?.max) this.setMaximized(true, false);

    let drag: { dx: number; dy: number } | null = null;
    title.addEventListener('pointerdown', (e) => {
      if (buttons.contains(e.target as Node) || e.button !== 0 || this.maximized) return;
      const at = uiPoint(e);
      drag = { dx: at.x - this.el.offsetLeft, dy: at.y - this.el.offsetTop };
      title.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    title.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const at = uiPoint(e);
      this.el.style.left = `${at.x - drag.dx}px`;
      this.el.style.top = `${at.y - drag.dy}px`;
      this.clamp();
    });
    title.addEventListener('pointerup', (e) => {
      if (!drag) return;
      drag = null;
      title.releasePointerCapture(e.pointerId);
      this.mgr.persist();
    });
    title.addEventListener('dblclick', (e) => {
      if (buttons.contains(e.target as Node)) return;
      this.toggleMaximized();
    });
    this.el.addEventListener('mousedown', () => this.mgr.bringToFront(this));
    this.el.addEventListener('mouseup', () => this.mgr.persist());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  get isMaximized(): boolean {
    return this.maximized;
  }

  /** Raise above the other windows. */
  focus(): void {
    this.mgr.bringToFront(this);
  }

  toggleMaximized(): void {
    this.setMaximized(!this.maximized);
  }

  /** Expand to nearly the whole viewport, or go back to the previous size and place. */
  setMaximized(on: boolean, persist = true): void {
    if (on === this.maximized) return;
    this.maximized = on;
    if (on) {
      this.normal = this.geometry();
      this.el.classList.add('maximized');
      this.applyMaximized();
      this.expandBtn.textContent = RESTORE_ICON;
      this.expandBtn.title = 'Restore';
      this.mgr.bringToFront(this);
    } else {
      this.el.classList.remove('maximized');
      if (this.normal) this.applyGeometry(this.normal);
      this.expandBtn.textContent = EXPAND_ICON;
      this.expandBtn.title = 'Expand';
      this.clamp();
    }
    if (persist) this.mgr.persist();
  }

  private applyMaximized(): void {
    const margin = Math.max(8, Math.round(Math.min(uiBox().w, uiBox().h) * 0.04));
    this.applyGeometry({
      x: margin,
      y: margin,
      w: Math.max(160, uiBox().w - margin * 2),
      h: Math.max(70, uiBox().h - margin * 2),
    });
  }

  private applyGeometry(g: Geometry): void {
    this.el.style.left = `${g.x}px`;
    this.el.style.top = `${g.y}px`;
    this.el.style.width = `${g.w}px`;
    this.el.style.height = `${g.h}px`;
  }

  /** Current place and size from the inline styles, which drag, resize and code all write. */
  private geometry(): Geometry {
    return {
      x: parseFloat(this.el.style.left) || 0,
      y: parseFloat(this.el.style.top) || 0,
      w: parseFloat(this.el.style.width) || this.opts.width,
      h: parseFloat(this.el.style.height) || this.opts.height,
    };
  }

  /** Called whenever the window is shown, so a panel can bring itself up to date. */
  onOpen: (() => void) | null = null;

  open(): void {
    this.el.hidden = false;
    this.mgr.bringToFront(this);
    this.clamp();
    this.onOpen?.();
    this.mgr.persist();
  }

  close(): void {
    this.el.hidden = true;
    this.mgr.persist();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Keep every window wholly inside the interface, on every screen. */
  clamp(): void {
    if (this.el.hidden) return;
    if (this.maximized) {
      this.applyMaximized();
      return;
    }
    const box = uiBox();
    const floor = uiFloor();

    /*
     * Nothing goes off the edge, and nothing is bigger than the room it is in.
     *
     * A window used to be allowed to hang over an edge with sixty pixels of
     * itself left showing — or, at the bottom of a desktop, thirty — on the
     * grounds that somebody might want one mostly out of the way and could
     * always drag it back by the title bar. What it actually produced was the
     * event window three quarters off the left of a phone, with its tabs and
     * its "Find…" box out in the dark, and a drag handle you would have to
     * reach past the screen to take hold of. A window you cannot get back is
     * not tidied away, it is lost.
     *
     * Size first, because a window wider or taller than the interface cannot
     * be put inside it however it is moved, and then the position against what
     * that leaves. The same pass runs on every open, every drag, every resize
     * and every turn of the phone, so a window saved from a wide screen and
     * opened on a narrow one comes back in rather than off the side.
     */
    const room = Math.max(70, box.h - floor - 12);
    if (this.el.offsetHeight > room) this.el.style.height = `${room}px`;
    const wide = Math.max(160, box.w - 12);
    if (this.el.offsetWidth > wide) this.el.style.width = `${wide}px`;

    const maxLeft = Math.max(0, box.w - this.el.offsetWidth);
    const maxTop = Math.max(floor, box.h - this.el.offsetHeight);
    this.el.style.left = `${Math.min(maxLeft, Math.max(0, this.el.offsetLeft))}px`;
    this.el.style.top = `${Math.min(maxTop, Math.max(floor, this.el.offsetTop))}px`;
  }

  state(): SavedState {
    const g = this.maximized && this.normal ? this.normal : this.geometry();
    return { ...g, open: this.isOpen, max: this.maximized };
  }
}

export class WindowManager {
  readonly windows = new Map<string, UIWindow>();
  private z = 100;
  private saved: Record<string, SavedState> = {};

  constructor(readonly root: HTMLElement) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.saved = JSON.parse(raw) as Record<string, SavedState>;
    } catch {
      this.saved = {};
    }
    window.addEventListener('resize', () => this.clampAll());
  }

  /**
   * Pull every window back inside the interface.
   *
   * Called when the interface's own box changes, which is not the same event
   * as the window resizing: a pinch, or a browser deciding to lay the page out
   * nine hundred pixels wide, both move the box while `resize` says nothing.
   * Windows are placed once when they are made, and that happens before the
   * box is first measured, so without this a window keeps the position it was
   * given against a viewport that was never the screen.
   */
  clampAll(): void {
    for (const w of this.windows.values()) w.clamp();
  }

  create(opts: WindowOptions): UIWindow {
    const win = new UIWindow(this, opts, this.saved[opts.id]);
    this.windows.set(opts.id, win);
    this.root.append(win.el);
    win.clamp();
    this.bringToFront(win);
    return win;
  }

  get(id: string): UIWindow | undefined {
    return this.windows.get(id);
  }

  toggle(id: string): void {
    this.windows.get(id)?.toggle();
  }

  bringToFront(win: UIWindow): void {
    win.el.style.zIndex = String(++this.z);
  }

  persist(): void {
    const out: Record<string, SavedState> = {};
    for (const [id, w] of this.windows) out[id] = w.state();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch {
      // Storage unavailable; layout simply will not persist.
    }
  }
}
