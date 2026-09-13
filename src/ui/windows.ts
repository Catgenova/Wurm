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

interface SavedState {
  x: number;
  y: number;
  w: number;
  h: number;
  open: boolean;
}

const STORAGE_KEY = 'wurm-iso-windows';

/** A draggable, resizable overlay window in the Wurm style. */
export class UIWindow {
  readonly el: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly titleText: HTMLSpanElement;

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
    const close = document.createElement('button');
    close.className = 'win-close';
    close.type = 'button';
    close.title = 'Close';
    close.textContent = '×';
    close.addEventListener('click', () => this.close());
    title.append(this.titleText, close);
    this.body = document.createElement('div');
    this.body.className = 'win-body';
    this.el.append(title, this.body);

    const w = saved?.w ?? opts.width;
    const h = saved?.h ?? opts.height;
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    if (saved) {
      this.el.style.left = `${saved.x}px`;
      this.el.style.top = `${saved.y}px`;
    } else {
      const anchor = opts.anchor ?? 'tl';
      const left = anchor === 'tr' || anchor === 'br' ? window.innerWidth - w - opts.x : opts.x;
      const top = anchor === 'bl' || anchor === 'br' ? window.innerHeight - h - opts.y : opts.y;
      this.el.style.left = `${left}px`;
      this.el.style.top = `${top}px`;
    }
    this.el.hidden = !(saved?.open ?? opts.open ?? true);

    let drag: { dx: number; dy: number } | null = null;
    title.addEventListener('pointerdown', (e) => {
      if (e.target === close || e.button !== 0) return;
      drag = { dx: e.clientX - this.el.offsetLeft, dy: e.clientY - this.el.offsetTop };
      title.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    title.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.el.style.left = `${e.clientX - drag.dx}px`;
      this.el.style.top = `${e.clientY - drag.dy}px`;
      this.clamp();
    });
    title.addEventListener('pointerup', (e) => {
      if (!drag) return;
      drag = null;
      title.releasePointerCapture(e.pointerId);
      this.mgr.persist();
    });
    this.el.addEventListener('mousedown', () => this.mgr.bringToFront(this));
    this.el.addEventListener('mouseup', () => this.mgr.persist());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.el.hidden = false;
    this.mgr.bringToFront(this);
    this.clamp();
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

  /** Keep at least the title bar reachable inside the viewport. */
  clamp(): void {
    if (this.el.hidden) return;
    const maxLeft = Math.max(0, window.innerWidth - 60);
    const maxTop = Math.max(0, window.innerHeight - 30);
    const left = Math.min(maxLeft, Math.max(-this.el.offsetWidth + 60, this.el.offsetLeft));
    const top = Math.min(maxTop, Math.max(0, this.el.offsetTop));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  state(): SavedState {
    return { x: this.el.offsetLeft, y: this.el.offsetTop, w: this.el.offsetWidth, h: this.el.offsetHeight, open: this.isOpen };
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
    window.addEventListener('resize', () => {
      for (const w of this.windows.values()) w.clamp();
    });
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
