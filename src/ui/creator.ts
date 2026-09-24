import { LOOK_TABLES, cleanLook, randomLook, type Look } from '../game/look';
import { drawHeadshot, drawPortrait, type PortraitMotion } from '../render/sprites';

/** Hair that is tied back is chosen by what it is tied into, so its thumbnail shows the back of the head. */
const FROM_BEHIND = new Set(['ponytail', 'bun', 'braid', 'locs']);

const TITLES: Record<keyof Look, string> = {
  gender: 'Build', skin: 'Skin', hair: 'Hair', hairColour: 'Hair colour',
  eyes: 'Eyes', beard: 'Beard', shirt: 'Shirt', trousers: 'Trousers',
};

const MOTIONS: Array<[PortraitMotion, string]> = [
  ['idle', 'Stand'], ['walk', 'Walk'], ['run', 'Run'], ['work', 'Work'], ['wave', 'Wave'], ['hop', 'Hop'],
];

/** Dragging across the mirror turns it an eighth for every so far dragged. */
const DRAG_STEP = 26;

const button = (className: string, text: string, label?: string): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  if (label) b.setAttribute('aria-label', label);
  return b;
};

/**
 * The character creator: a mirror, and a row of choices for every part of a
 * look.
 *
 * One of it, in two places. The account page shows it to a new account before
 * it comes ashore, and the game's "How you look" window, off Settings, shows it
 * to anybody who wants to change their look afterwards. The two are the same
 * code so that they cannot offer different things: a haircut you could choose
 * on the way in and not on a second visit would be a haircut you could never
 * get back.
 *
 * It keeps the look being chosen and nothing else. Keeping it anywhere is the
 * page's business, off a button of its own. Its rules are in `creator.css`,
 * which each page that shows it links.
 */
export class Creator {
  readonly el: HTMLDivElement;
  private chosen: Look;
  /** What the pointer is resting on or the keyboard is on, shown in the mirror until it moves off. */
  private preview: Look | null = null;
  private readonly mirror: HTMLCanvasElement;
  private readonly choices: HTMLDivElement;
  private readonly closeUp: HTMLButtonElement;
  private readonly motionButtons: HTMLButtonElement[] = [];
  /** The thumbnails, so that changing skin or hair colour redraws all of them, and which way round each is shown. */
  private readonly thumbs: Array<{ canvas: HTMLCanvasElement; of: (l: Look) => Look; facing: number }> = [];
  /** Every row's buttons, so the selected one can be marked without rebuilding. */
  private readonly marks: Array<{ kind: keyof Look; id: string; button: HTMLButtonElement; label: HTMLElement }> = [];
  private walking = 0;
  private facing = 1;
  private motion: PortraitMotion = 'walk';
  private close = false;

  /** `shown` says whether anybody can see it; the mirror stops moving while nobody can. */
  constructor(start: Look, private readonly shown: () => boolean) {
    this.chosen = cleanLook(start);
    this.el = document.createElement('div');
    this.el.className = 'cr';
    const inner = document.createElement('div');
    inner.className = 'cr-in';
    const column = document.createElement('div');
    column.className = 'cr-mirror';

    this.mirror = document.createElement('canvas');
    this.mirror.className = 'cr-me';
    this.mirror.width = 240;
    this.mirror.height = 380;
    this.mirror.tabIndex = 0;
    this.mirror.setAttribute('aria-label', 'How you will look. Drag, or use the arrow keys, to turn.');

    /*
     * The mirror walks, and turns, and looks close.
     *
     * Standing still is easier to draw and worse to choose from: a walk is how
     * you will actually see yourself, and it is the only way to find out that
     * the ponytail moves and the long beard does not. It turns through the same
     * eight ways the island draws you -- by its arrows, by dragging across it,
     * or by the arrow keys -- because a haircut is chosen as much from behind
     * as from the front, and the face button brings the head up to fill it.
     */
    const turn = document.createElement('div');
    turn.className = 'cr-turn';
    const left = button('', '◀', 'Turn left');
    this.closeUp = button('cr-close', 'Face');
    this.closeUp.setAttribute('aria-pressed', 'false');
    const right = button('', '▶', 'Turn right');
    left.addEventListener('click', () => this.turn(-1));
    right.addEventListener('click', () => this.turn(1));
    this.closeUp.addEventListener('click', () => {
      this.close = !this.close;
      this.closeUp.setAttribute('aria-pressed', String(this.close));
    });
    turn.append(left, this.closeUp, right);

    const motions = document.createElement('div');
    motions.className = 'cr-motions';
    motions.setAttribute('role', 'group');
    motions.setAttribute('aria-label', 'What the mirror shows you doing');
    for (const [id, label] of MOTIONS) {
      const b = button('', label);
      b.dataset.motion = id;
      b.addEventListener('click', () => {
        this.showMotion(id);
        // Asking to see a move is asking to see the body do it.
        if (this.close) {
          this.close = false;
          this.closeUp.setAttribute('aria-pressed', 'false');
        }
      });
      this.motionButtons.push(b);
      motions.append(b);
    }
    this.showMotion(this.motion);

    const roll = button('cr-roll', 'Roll me one');
    roll.addEventListener('click', () => {
      this.look = randomLook();
    });

    column.append(this.mirror, turn, motions, roll);

    this.choices = document.createElement('div');
    this.choices.className = 'cr-choices';
    inner.append(column, this.choices);
    this.el.append(inner);

    let dragFrom: number | null = null;
    this.mirror.addEventListener('pointerdown', (e) => {
      dragFrom = e.clientX;
      this.mirror.setPointerCapture(e.pointerId);
    });
    this.mirror.addEventListener('pointermove', (e) => {
      if (dragFrom === null) return;
      const steps = Math.trunc((e.clientX - dragFrom) / DRAG_STEP);
      if (steps) {
        this.turn(steps);
        dragFrom += steps * DRAG_STEP;
      }
    });
    const letGo = (): void => { dragFrom = null; };
    this.mirror.addEventListener('pointerup', letGo);
    this.mirror.addEventListener('pointercancel', letGo);
    this.mirror.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        this.turn(e.key === 'ArrowLeft' ? -1 : 1);
        e.preventDefault();
        // In the game the arrows also push the view about; turning the mirror is all this press was for.
        e.stopPropagation();
      }
    });

    this.buildChoices();
    this.redraw();
  }

  /** The look being chosen. */
  get look(): Look {
    return this.chosen;
  }

  set look(l: Look) {
    this.chosen = cleanLook(l);
    this.preview = null;
    this.redraw();
  }

  /** Start the mirror moving, if it is not already. It stops by itself once it cannot be seen. */
  wake(): void {
    if (!this.walking) this.walking = requestAnimationFrame((now) => this.frame(now));
  }

  /**
   * Three kinds of button for three kinds of choice.
   *
   * A colour is shown as the colour — a name for it is a word you have to
   * imagine. A shape (a haircut, a beard) is shown as a head wearing it, drawn
   * with `drawHeadshot`, which is the same `head()` the island draws: a
   * thumbnail that came from anywhere else is a thumbnail that can lie about
   * what you are choosing. Only the build, which is neither a colour nor a
   * silhouette you could tell at 46 pixels, is a word.
   */
  private buildChoices(): void {
    for (const [key, table] of Object.entries(LOOK_TABLES) as Array<[keyof Look, Array<{ id: string; name: string; colour?: string }>]>) {
      const block = document.createElement('div');
      block.className = 'cr-choice';
      const head = document.createElement('h2');
      head.textContent = TITLES[key];
      const chosen = document.createElement('span');
      head.append(chosen);
      const row = document.createElement('div');
      row.className = 'cr-row';
      block.append(head, row);
      for (const option of table) {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = option.name;
        b.dataset.kind = key;
        b.dataset.id = option.id;
        if (option.colour) {
          b.className = 'cr-pick cr-swatch';
          b.style.background = option.colour;
        } else if (key === 'hair' || key === 'beard') {
          b.className = 'cr-pick cr-face';
          const canvas = document.createElement('canvas');
          // Drawn at the screen's own resolution, so a haircut is not chosen from a blur.
          canvas.width = canvas.height = Math.round(52 * Math.min(3, window.devicePixelRatio || 1));
          b.append(canvas);
          this.thumbs.push({ canvas, of: (l) => ({ ...l, [key]: option.id, ...(key === 'hair' ? {} : { hair: 'crop' }) }), facing: key === 'hair' && FROM_BEHIND.has(option.id) ? 3 : 1 });
        } else {
          b.className = 'cr-pick cr-word';
          b.textContent = option.name;
        }
        b.addEventListener('click', () => {
          this.look = { ...this.chosen, [key]: option.id };
        });
        // Resting the pointer on a choice, or tabbing to it, tries it on in the mirror; moving off puts back what was chosen.
        const tryOn = (): void => { this.preview = cleanLook({ ...this.chosen, [key]: option.id }); };
        const takeOff = (): void => { this.preview = null; };
        b.addEventListener('pointerenter', tryOn);
        b.addEventListener('focus', tryOn);
        b.addEventListener('pointerleave', takeOff);
        b.addEventListener('blur', takeOff);
        this.marks.push({ kind: key, id: option.id, button: b, label: chosen });
        row.append(b);
      }
      this.choices.append(block);
    }
  }

  /** The thumbnails and the ticks, from the one look. The mirror redraws itself every frame. */
  private redraw(): void {
    for (const m of this.marks) {
      const on = this.chosen[m.kind] === m.id;
      m.button.classList.toggle('on', on);
      m.button.setAttribute('aria-pressed', String(on));
      if (on) {
        const table = LOOK_TABLES[m.kind] as Array<{ id: string; name: string }>;
        m.label.textContent = table.find((o) => o.id === m.id)?.name ?? '';
      }
    }
    for (const t of this.thumbs) {
      const ctx = t.canvas.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, t.canvas.width, t.canvas.height);
      drawHeadshot(ctx, 0, 0, t.canvas.width, t.of(this.chosen), t.facing);
    }
  }

  private frame(now: number): void {
    if (!this.shown()) {
      this.walking = 0;
      return;
    }
    const ctx = this.mirror.getContext('2d');
    if (ctx) {
      // The backing store follows the size the page gives the mirror, at the screen's own resolution.
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.round(this.mirror.clientWidth * dpr), h = Math.round(this.mirror.clientHeight * dpr);
      if (w > 0 && h > 0 && (this.mirror.width !== w || this.mirror.height !== h)) {
        this.mirror.width = w;
        this.mirror.height = h;
      }
      ctx.clearRect(0, 0, this.mirror.width, this.mirror.height);
      const shown = this.preview ?? this.chosen;
      if (this.close) {
        drawHeadshot(ctx, 0, 0, this.mirror.width, shown, this.facing, now / 1000, this.mirror.height);
      } else {
        drawPortrait(ctx, 0, 0, this.mirror.width, this.mirror.height, shown, now / 1000, this.facing, this.motion);
      }
    }
    this.walking = requestAnimationFrame((t) => this.frame(t));
  }

  private turn(by: number): void {
    this.facing = (((this.facing + by) % 8) + 8) % 8;
  }

  private showMotion(m: PortraitMotion): void {
    this.motion = m;
    for (const b of this.motionButtons) b.setAttribute('aria-pressed', String(b.dataset.motion === m));
  }
}
