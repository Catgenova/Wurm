import { keyName, type Keybinds } from '../game/keybinds';
import { clockLeft } from '../game/boons';
import { balance, fedWord, NUTRIENTS, NUTRIENT_NAMES, NUTRIENT_NOTES, tableMul } from '../game/nutrition';
import { SKILL_DEFS } from '../game/skills';
import { WOUND_KINDS, woundText } from '../game/wounds';
import { sailWord, windFrom, windWord } from '../game/wind';
import { FAITH, favourCap } from '../game/faith';
import { FURNITURE_BY_ID } from '../game/furniture';
import { MAX_LEVELS } from '../game/building';
import { groundRoll, TILE_DEFS } from '../world/tiles';
import type { Game } from '../game/game';
import { itemName } from '../game/items';
import { ACTION_BY_ID } from '../game/actions';
import { BELT_MAX, pinLabel } from '../game/belt';
import type { Renderer } from '../render/renderer';
import { ashore, JOURNAL, nextGoals } from '../game/journal';
import { uiPoint } from './screen';
import { VERSION } from '../version';

export interface HudCallbacks {
  toggle: (id: string) => void;
  toggleGrid: () => void;
  center: () => void;
  /** Open the list of windows, anchored under the button that asked. */
  windows: (x: number, y: number) => void;
  turn: (step: number) => void;
  /** Press a loop on the belt, aimed at whatever the cursor is on. */
  useLoop: (loop: number) => void;
  /** Whether the selection window has the number keys just now. */
  numbersTaken: () => boolean;
  /** What every key does, so the toolbar can say so and keep saying so. */
  keys: Keybinds;
}

interface Bar {
  fill: HTMLDivElement;
  value: HTMLSpanElement;
}

/*
 * Every window there is, in the order the menu lists them.
 *
 * These were thirteen buttons across the top, and with the four view controls
 * and a `New world` nobody wanted that was eighteen — sixteen hundred pixels
 * of toolbar, which on a phone is four screens of sideways scrolling with
 * nothing to say so. They are one button and a list now.
 *
 * The keys are unchanged and the list says what they are, which is the other
 * half of the point: a menu you have to open every time would be a step
 * backwards, and this is where somebody learns the key that means they never
 * have to open it again.
 */
export const WINDOWS: Array<{ label: string; bind: string; id: string }> = [
  { label: 'Inventory', bind: 'win_inventory', id: 'inventory' },
  { label: 'Craft', bind: 'win_craft', id: 'craft' },
  { label: 'Tile', bind: 'win_tile', id: 'tile' },
  { label: 'Skills', bind: 'win_skills', id: 'skills' },
  { label: 'Trades', bind: 'win_trades', id: 'trades' },
  { label: 'Tracker', bind: 'win_tracker', id: 'tracker' },
  { label: 'Events', bind: 'win_events', id: 'events' },
  { label: 'Map', bind: 'win_map', id: 'map' },
  { label: 'Wildermon', bind: 'win_wildermon', id: 'wildermon' },
  { label: 'Market', bind: 'win_market', id: 'market' },
  { label: 'Journal', bind: 'win_journal', id: 'journal' },
  { label: 'Ledger', bind: 'win_ledger', id: 'ledger' },
  { label: 'Stores', bind: 'win_stores', id: 'stores' },
  { label: 'Deed', bind: 'win_deed', id: 'deed' },
  { label: 'Social', bind: 'win_social', id: 'social' },
  { label: 'Leaderboards', bind: 'win_boards', id: 'boards' },
  { label: 'Settings', bind: 'win_settings', id: 'settings' },
  { label: 'Help', bind: 'win_help', id: 'help' },
];

/*
 * What is left on the toolbar, which says which key does each of these.
 *
 * It used to say so by spelling the letter out here, which was true right up
 * until the Keys tab let somebody move one. Each button names the *binding*
 * and asks what it currently answers to, so the toolbar cannot go stale.
 *
 * These four stay out where a thumb can reach them because they are not
 * windows: they are how you look at the island, pressed between one glance and
 * the next rather than opened and read.
 */
const BUTTONS: Array<{ label: string; bind?: string; action: (cb: HudCallbacks) => void; id?: string }> = [
  { label: 'Grid', bind: 'grid', action: (cb) => cb.toggleGrid(), id: 'grid' },
  { label: 'Centre', bind: 'centre', action: (cb) => cb.center() },
  { label: '↻ Turn', bind: 'turn_left', action: (cb) => cb.turn(-1) },
  { label: '↺ Turn', bind: 'turn_right', action: (cb) => cb.turn(1) },
];

/** Status bars, the action timer and the toolbar. */
/** 1st, 2nd, 3rd, 4th... for the storey label. */
function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * How often the hud is allowed to redraw itself, in milliseconds. Ten times a
 * second is quicker than anybody reads and a sixth of the work.
 */
const HUD_EVERY = 100;

export class Hud {
  /** When the hud last drew itself, so it does so a few times a second. */
  private lastAt = -1e9;
  /** What each node was last told to say, so it is not told the same thing twice. */
  private readonly said = new WeakMap<HTMLElement, string>();
  private bars: Record<string, Bar> = {};
  /** Toolbar buttons that name a key, and which binding each one names. */
  private keyed: Array<{ btn: HTMLButtonElement; label: string; bind: string }> = [];
  private binds!: Keybinds;
  private nameEl: HTMLDivElement;
  private posEl: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private actionEl: HTMLDivElement;
  private actionLabel: HTMLDivElement;
  private actionFill: HTMLDivElement;
  private queueEl: HTMLDivElement;
  private goBtn: HTMLButtonElement;
  private guideEl: HTMLDivElement;
  private guideTitle: HTMLDivElement;
  private guideBody: HTMLDivElement;
  /** Which goal the guide is showing, so it is only rewritten when it changes. */
  private guideOn = '';
  /** Opens the journal window; filled in by the UI that owns the windows. */
  openJournal: (() => void) | null = null;
  private hintEl: HTMLDivElement;
  private gridBtn: HTMLButtonElement | null = null;
  private compass: HTMLSpanElement;
  private companionEl: HTMLDivElement;
  private gearEl: HTMLDivElement;
  private eatBtn!: HTMLButtonElement;
  private feedBtn!: HTMLButtonElement;
  private companionText = document.createElement('span');
  private boonEl: HTMLDivElement;
  private woundEl: HTMLDivElement;
  private windEl: HTMLDivElement;
  private storeyEl: HTMLDivElement;
  private storeyLabel: HTMLButtonElement;
  private storeyUp: HTMLButtonElement;
  private storeyDown: HTMLButtonElement;
  private cutBtn: HTMLButtonElement;
  private beltEl: HTMLDivElement;
  private loopEls: HTMLButtonElement[] = [];
  private stopBtn: HTMLButtonElement;
  private beltDue = 0;
  private foodEl: HTMLDivElement;
  private foodBars = new Map<string, HTMLDivElement>();
  private numbersTaken: () => boolean;

  constructor(
    root: HTMLElement,
    private readonly game: Game,
    cb: HudCallbacks,
  ) {
    const status = document.createElement('div');
    status.className = 'hud-status';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'hud-name';
    status.append(this.nameEl);
    for (const [id, label, cls] of [
      ['health', 'Health', 'bar-health'],
      ['stamina', 'Stamina', 'bar-stamina'],
      ['hunger', 'Food', 'bar-hunger'],
      ['thirst', 'Water', 'bar-thirst'],
    ]) {
      const row = document.createElement('div');
      row.className = 'hud-bar-row';
      const name = document.createElement('span');
      name.className = 'hud-bar-label';
      name.textContent = label;
      const track = document.createElement('div');
      track.className = 'hud-bar';
      const fill = document.createElement('div');
      fill.className = `hud-bar-fill ${cls}`;
      track.append(fill);
      const value = document.createElement('span');
      value.className = 'hud-bar-value';
      row.append(name, track, value);
      if (id === 'hunger') {
        this.eatBtn = document.createElement('button');
        this.eatBtn.type = 'button';
        this.eatBtn.className = 'hud-mini';
        this.eatBtn.textContent = 'Eat';
        this.eatBtn.title = 'Eat the best food you are carrying';
        this.eatBtn.addEventListener('click', () => this.eatBest());
        row.append(this.eatBtn);
      }
      status.append(row);
      this.bars[id] = { fill, value };
    }
    const footer = document.createElement('div');
    footer.className = 'hud-footer';
    this.posEl = document.createElement('div');
    this.posEl.className = 'hud-pos';
    this.compass = document.createElement('span');
    this.compass.className = 'hud-compass';
    this.compass.title = 'North';
    this.compass.innerHTML =
      '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><polygon points="10,1 14,15 10,11.5 6,15" fill="#e3b657"/><polygon points="10,11.5 14,15 10,19 6,15" fill="#6b5836"/></svg><b>N</b>';
    footer.append(this.posEl, this.compass);
    status.append(footer);
    // Rest banked and whatever the last meal favours.
    this.boonEl = document.createElement('div');
    this.boonEl.className = 'hud-companion hud-boons';
    this.boonEl.hidden = true;
    status.append(this.boonEl);
    // The wind, when you are in something that cares about it.
    this.windEl = document.createElement('div');
    this.windEl.className = 'hud-companion hud-wind';
    this.windEl.hidden = true;
    status.append(this.windEl);
    // Anything open on you, which is the first thing you want to know.
    this.woundEl = document.createElement('div');
    this.woundEl.className = 'hud-companion hud-wounds';
    this.woundEl.hidden = true;
    status.append(this.woundEl);
    /*
     * What is actually in you: four thin bars under the food bar. Eating well
     * holds hunger and thirst off; eating well in all four teaches you more,
     * and that reads off the shortest of them, so the short one is the one to
     * look at.
     */
    this.foodEl = document.createElement('div');
    this.foodEl.className = 'hud-food';
    for (const k of NUTRIENTS) {
      const cell = document.createElement('div');
      cell.className = 'hud-food-cell';
      const label = document.createElement('span');
      label.className = 'hud-food-label';
      label.textContent = NUTRIENT_NAMES[k].slice(0, 2);
      const track = document.createElement('div');
      track.className = 'hud-food-track';
      const fill = document.createElement('div');
      fill.className = `hud-food-fill food-${k}`;
      track.append(fill);
      cell.append(label, track);
      cell.title = `${NUTRIENT_NAMES[k]} — ${NUTRIENT_NOTES[k]}`;
      this.foodBars.set(k, fill);
      this.foodEl.append(cell);
    }
    status.append(this.foodEl);
    this.gearEl = document.createElement('div');
    this.gearEl.className = 'hud-companion hud-gear';
    this.gearEl.hidden = true;
    status.append(this.gearEl);
    this.companionEl = document.createElement('div');
    this.companionEl.className = 'hud-companion';
    this.companionEl.hidden = true;
    this.feedBtn = document.createElement('button');
    this.feedBtn.type = 'button';
    this.feedBtn.className = 'hud-mini';
    this.feedBtn.textContent = 'Feed';
    this.feedBtn.title = 'Feed your companion the poorest thing it will eat';
    this.feedBtn.addEventListener('click', () => this.feedCompanion());
    this.companionEl.append(this.feedBtn);
    status.append(this.companionEl);
    root.append(status);

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    /*
     * One button for all thirteen windows.
     *
     * Anchored under itself rather than at the pointer, because the point of
     * this is a finger: the list wants to open where the thumb already is and
     * stay there, not follow a cursor that a phone does not have. Measured
     * through `uiPoint` because the interface is a scaled box over the screen
     * and a client coordinate is not one of its own.
     */
    const windows = document.createElement('button');
    windows.type = 'button';
    windows.className = 'tb-btn tb-windows';
    windows.textContent = 'UI Menu';
    windows.title = 'Every window there is';
    windows.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = windows.getBoundingClientRect();
      const at = uiPoint({ clientX: r.left, clientY: r.bottom + 2 });
      cb.windows(at.x, at.y);
    });
    toolbar.append(windows);
    for (const b of BUTTONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tb-btn';
      btn.addEventListener('click', () => b.action(cb));
      if (b.id === 'grid') this.gridBtn = btn;
      if (b.bind) this.keyed.push({ btn, label: b.label, bind: b.bind });
      else btn.textContent = b.label;
      toolbar.append(btn);
    }

    this.binds = cb.keys;
    this.drawKeys();
    root.append(toolbar);

    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'hud-fps';
    root.append(this.fpsEl);

    this.actionEl = document.createElement('div');
    this.actionEl.className = 'action-bar';
    this.actionEl.hidden = true;
    this.actionLabel = document.createElement('div');
    this.actionLabel.className = 'action-label';
    const track = document.createElement('div');
    track.className = 'action-track';
    this.actionFill = document.createElement('div');
    this.actionFill.className = 'action-fill';
    track.append(this.actionFill);
    this.queueEl = document.createElement('div');
    this.queueEl.className = 'action-queue';
    this.queueEl.hidden = true;
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'action-hint';
    this.hintEl.textContent = 'Esc to stop · moving puts it down';
    this.stopBtn = document.createElement('button');
    this.stopBtn.type = 'button';
    this.stopBtn.className = 'tb-btn tb-small action-stop';
    this.stopBtn.textContent = 'Stop';
    this.stopBtn.title = 'Put the job down and forget what is lined up (Esc)';
    this.stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.cancelAction();
    });
    /*
     * Taking the work back up after a walk.
     *
     * Walking used to throw the whole list away; it holds it now, and this is
     * how it is taken up again. Deliberately a button rather than something
     * that happens by itself: jobs that started themselves the moment your
     * feet stopped would walk you straight back across the yard you had just
     * crossed on purpose.
     */
    this.goBtn = document.createElement('button');
    this.goBtn.type = 'button';
    this.goBtn.className = 'tb-btn tb-small action-stop';
    this.goBtn.textContent = 'Carry on';
    this.goBtn.hidden = true;
    this.goBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.resumeQueue();
    });
    this.actionEl.append(this.actionLabel, track, this.queueEl, this.goBtn, this.stopBtn, this.hintEl);
    root.append(this.actionEl);

    /*
     * What to do next, for somebody who came ashore ninety seconds ago.
     *
     * There is no tutorial on this island and never has been. The journal is
     * eighty-five goals in eleven chapters, all on screen at once, which is a
     * fine list and a poor answer to the only question a new arrival has,
     * which is "what now": a list says everything at the same volume and
     * leaves the reading to you.
     *
     * So the first chapter is read out, one goal at a time, in as many words
     * as it takes — and then it stands down for good, because by the time the
     * stake is in the ground the question has changed to "what else" and the
     * journal is the right answer to that one. It can be put away sooner, and
     * once put away it stays away.
     */
    this.guideEl = document.createElement('div');
    this.guideEl.className = 'guide';
    this.guideEl.hidden = true;
    this.guideTitle = document.createElement('div');
    this.guideTitle.className = 'guide-title';
    this.guideBody = document.createElement('div');
    this.guideBody.className = 'guide-body';
    const guideBar = document.createElement('div');
    guideBar.className = 'guide-bar';
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'tb-btn tb-small';
    more.textContent = 'The rest of it';
    more.title = 'Open the journal: everything anybody thought worth doing here';
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openJournal?.();
    });
    const hush = document.createElement('button');
    hush.type = 'button';
    hush.className = 'tb-btn tb-small';
    hush.textContent = 'Put it away';
    hush.title = 'Stop showing this. The journal (J) has all of it whenever you want it.';
    hush.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.settings.guide = false;
      this.guideEl.hidden = true;
    });
    guideBar.append(more, hush);
    this.guideEl.append(this.guideTitle, this.guideBody, guideBar);
    root.append(this.guideEl);

    /*
     * The belt: the jobs you do most, hung on a worn toolbelt's loops and
     * pressed with the number keys. No belt, no loops.
     */
    this.beltEl = document.createElement('div');
    this.beltEl.className = 'belt-bar';
    this.beltEl.hidden = true;
    for (let i = 0; i < BELT_MAX; i += 1) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'belt-loop';
      b.dataset.loop = String(i);
      const key = document.createElement('span');
      key.className = 'belt-key';
      key.textContent = String((i + 1) % 10);
      const what = document.createElement('span');
      what.className = 'belt-what';
      b.append(key, what);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        cb.useLoop(i);
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.game.clearLoop(i);
        this.drawBelt();
      });
      this.loopEls.push(b);
      this.beltEl.append(b);
    }
    root.append(this.beltEl);
    this.numbersTaken = cb.numbersTaken;
    this.game.events.on('inventory', () => this.drawBelt());
    this.drawBelt();

    /*
     * The storey control: which floor of a building you are looking at, and
     * whether the walls between you and it are taken away.
     */
    this.storeyEl = document.createElement('div');
    this.storeyEl.className = 'storey';
    this.storeyEl.hidden = true;
    const mk = (cls: string, text: string, title: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    };
    this.storeyUp = mk('tb-btn storey-btn', '▲', 'Look at the storey above (Page Up)', () => this.stepStorey(1));
    this.storeyLabel = mk('storey-label', 'Auto', 'Click to follow your own storey again', () => {
      this.game.settings.viewLevel = null;
    });
    this.storeyDown = mk('tb-btn storey-btn', '▼', 'Look at the storey below (Page Down)', () => this.stepStorey(-1));
    this.cutBtn = mk('tb-btn storey-cut', '◪', 'Cut away the walls facing you (X)', () => {
      this.game.settings.cutaway = !this.game.settings.cutaway;
    });
    this.storeyEl.append(this.storeyUp, this.storeyLabel, this.storeyDown, this.cutBtn);
    root.append(this.storeyEl);
  }

  /**
   * Redraw the belt. Only the loops the worn belt actually has are shown, and
   * a loop greys out when what hangs on it cannot be done just now.
   */
  drawBelt(): void {
    const loops = this.game.beltLoops();
    this.beltEl.hidden = loops === 0;
    // The selection window takes the number keys while it is looking at
    // something, so the belt says so rather than leaving you to find out.
    const taken = this.numbersTaken();
    this.beltEl.classList.toggle('belt-yielded', taken);
    this.beltEl.title = taken ? 'The Tile window has the number keys while something is selected. Close it, or clear the selection, to press the belt.' : '';
    for (let i = 0; i < BELT_MAX; i += 1) {
      const el = this.loopEls[i];
      el.hidden = i >= loops;
      if (i >= loops) continue;
      const what = el.querySelector('.belt-what') as HTMLSpanElement;
      const aim = this.game.aimLoop(i, null);
      if (!aim) {
        const pin = this.game.player.belt[i];
        what.textContent = pin ? pinLabel(pin, undefined) : 'empty';
        el.classList.toggle('belt-empty', !pin);
        el.classList.remove('belt-barred');
        el.title = pin ? 'Right-click to take it off the belt.' : `Loop ${i + 1} is empty. Find a job in a menu and hang it here.`;
        continue;
      }
      const label = pinLabel(aim.pin, aim.def);
      what.textContent = label;
      el.classList.remove('belt-empty');
      el.classList.toggle('belt-barred', !!aim.reason);
      el.title = aim.reason ? `${label} — ${aim.reason}` : `${label}. Press ${(i + 1) % 10}, or right-click to take it off the belt.`;
    }
  }

  /**
   * Put the current key on every button that names one.
   *
   * Called once when the toolbar is built and again whenever a binding changes,
   * so a button cannot go on claiming a key that now does something else. A
   * button whose thing has been left unbound simply stops claiming anything.
   */
  drawKeys(): void {
    for (const k of this.keyed) {
      const codes = this.binds.codes(k.bind);
      k.btn.innerHTML = codes.length ? `${k.label} <kbd>${keyName(codes[0])}</kbd>` : k.label;
    }
  }

  /** Move the view a storey up or down, starting from where the player stands. */
  stepStorey(step: number): void {
    const s = this.game.settings;
    const from = s.viewLevel ?? this.game.player.level;
    s.viewLevel = Math.max(0, Math.min(MAX_LEVELS - 1, from + step));
  }

  toggleCutaway(): void {
    this.game.settings.cutaway = !this.game.settings.cutaway;
  }

  /** Eat the best thing you are carrying, without hunting for it in the pack. */
  private eatBest(): void {
    const food = this.game.bestFood();
    if (!food) {
      this.game.logMsg('You have nothing worth eating.', 'error');
      return;
    }
    const def = ACTION_BY_ID.get('eat');
    if (def) this.game.requestAction(def, { kind: 'item', uid: food.uid });
  }

  /** Feed your companion the poorest thing it will take, and keep the rest. */
  private feedCompanion(): void {
    const c = this.game.creatures.active();
    if (!c) return;
    const food = this.game.worstFoodFor(c);
    if (!food) {
      this.game.logMsg(`You have nothing ${c.name} will eat.`, 'error');
      return;
    }
    const def = ACTION_BY_ID.get('feed');
    if (def) this.game.requestAction(def, { kind: 'creature', id: c.id, itemUid: food.uid });
  }

  private refreshStorey(): void {
    const s = this.game.settings;
    // Only worth showing once there is something built to look into.
    this.storeyEl.hidden = this.game.buildings.list.size === 0 && s.viewLevel === null;
    if (this.storeyEl.hidden) return;
    const level = s.viewLevel;
    this.storeyLabel.textContent = level === null ? 'Auto' : ordinal(level + 1);
    this.storeyLabel.classList.toggle('pinned', level !== null);
    this.storeyUp.disabled = level !== null && level >= MAX_LEVELS - 1;
    this.storeyDown.disabled = level === 0;
    this.cutBtn.classList.toggle('active', s.cutaway);
  }

  /** Write to a node only when what it would say has changed. */
  private say(el: HTMLElement, text: string): void {
    if (this.said.get(el) === text) return;
    this.said.set(el, text);
    el.textContent = text;
  }

  /**
   * Everything along the top and down the side, a few times a second.
   *
   * This used to run on every frame: a dozen `textContent` writes, a handful
   * of template strings, `Object.entries` over the bars, and the whole wound
   * list torn down and built again out of fresh elements — sixty times a
   * second, for figures that change a few times a minute. Every one of those
   * writes can make the browser lay the page out again, and the hud sits over
   * the canvas, so it was doing it in the middle of the frame.
   *
   * Every other panel in the game has gone through `Repaint` since it was
   * written. This one had been missed. Ten times a second is quicker than
   * anybody reads, and nothing is written at all unless it differs from what
   * is already on the screen.
   */
  update(renderer: Renderer, fps: number): void {
    const now = performance.now();
    if (now - this.lastAt < HUD_EVERY) return;
    this.lastAt = now;
    this.refreshStorey();
    this.refreshGuide();
    const p = this.game.player;
    this.say(this.nameEl, p.name);
    for (const [id, bar] of Object.entries(this.bars)) {
      const v = p.stats[id as keyof typeof p.stats];
      const pct = `${Math.round(v * 100)}%`;
      if (this.said.get(bar.value) === pct) continue;
      this.said.set(bar.value, pct);
      bar.fill.style.width = pct;
      bar.value.textContent = pct;
    }
    const h = this.game.world.heightAt(p.x, p.y);
    const standing = this.game.deedOfMineAt(p.tileX, p.tileY);
    const deed = standing ? `  ·  ${standing.name}` : '';
    const title = this.game.titleName();
    this.say(this.posEl, `${p.tileX}, ${p.tileY}  ·  h ${h.toFixed(0)}  ·  ${this.game.clock()}${p.swimming ? '  ·  swimming' : ''}${deed}${title ? `  ·  ${title}` : ''}`);
    // Rest and the knacks running off what you have eaten, when there are any.
    const rested = this.game.player.rested;
    const boons = this.game.activeBoons();
    const parts: string[] = [];
    if (rested > 0) parts.push(`Rested ${clockLeft(rested)} · everything ×2`);
    const favour = this.game.player.favour;
    if (favour >= 1) parts.push(`Favour ${Math.floor(favour)} of ${Math.floor(favourCap(this.game.skills.get(FAITH)))}`);
    const over = this.game.overloaded();
    if (over > 0) parts.push(`Overloaded by ${over.toFixed(0)} kg`);
    /*
     * A light in your hand is a thing with a clock on it, so the clock is
     * shown — and so is what it is buying you, because the whole reason to
     * carry one is the ground it puts back in front of you.
     */
    const lamp = this.game.heldLight();
    if (lamp) {
      parts.push(`${itemName(lamp)} lit · ${clockLeft(lamp.charges ?? 0)} left · sees ${Math.round(this.game.vision.sightRange())} tiles`);
    } else if (this.game.darkness() > 0.45) {
      parts.push(`Dark · you see ${Math.round(this.game.vision.sightRange())} tiles`);
    }
    // What the ground under a loaded wheel is costing, when it is costing anything.
    const cart = this.game.driving();
    if (cart) {
      const def = TILE_DEFS[this.game.world.getTile(p.tileX, p.tileY)];
      const roll = groundRoll(def.roll, this.game.vehicleLoad(cart));
      if (roll < 0.985) parts.push(`${def.name} underfoot · ${Math.round(roll * 100)}% of your pace`);
    }
    for (const b of boons) {
      const name = SKILL_DEFS.find((d) => d.id === b.skill)?.name ?? b.skill;
      parts.push(`${name} +${Math.round(b.bonus * 100)}% · ${clockLeft(b.until - this.game.time)}`);
    }
    this.boonEl.hidden = !parts.length;
    if (parts.length) this.say(this.boonEl, parts.join('  ·  '));
    // The wind, which only matters when there is a sail over you.
    const boat = this.game.afloat();
    const sailing = boat && FURNITURE_BY_ID.get(boat.kind)?.boat?.sail;
    this.windEl.hidden = !sailing;
    if (sailing) {
      const w = this.game.wind();
      const point = sailWord(this.game.heading(), w);
      this.windEl.replaceChildren();
      const arrow = document.createElement('span');
      arrow.className = 'wind-arrow';
      // The arrow flies with the wind, and the compass rose is already turned.
      arrow.style.transform = `rotate(${(w.dir * 180) / Math.PI + 90 + renderer.camera.northAngle()}deg)`;
      arrow.textContent = '\u2191';
      const text = document.createElement('span');
      text.className = point === 'in irons' ? 'wind-irons' : '';
      text.textContent = `${windWord(w.force)} out of the ${windFrom(w)} · ${point}`;
      this.windEl.append(arrow, text);
      this.windEl.title = point === 'in irons' ? 'You are pointed into the wind and she will not go. Bear away and tack up.' : 'Across the wind is fastest; straight into it, she stops.';
    }
    // What is open on you, worst first, with the herb each one wants.
    const wounds = this.game.player.wounds;
    this.woundEl.hidden = !wounds.length;
    const hurts = wounds.map((w) => `${w.kind}${w.severity.toFixed(1)}${w.infected ? 'i' : ''}${w.bleeding ? 'b' : ''}`).join('|');
    if (wounds.length && this.said.get(this.woundEl) !== hurts) {
      this.said.set(this.woundEl, hurts);
      const sorted = [...wounds].sort((a, b) => (b.infected ? 1 : 0) - (a.infected ? 1 : 0) || b.severity - a.severity);
      this.woundEl.replaceChildren();
      for (const w of sorted.slice(0, 4)) {
        const row = document.createElement('div');
        row.className = `wound-row${w.infected ? ' wound-bad' : w.bleeding ? ' wound-open' : ''}`;
        row.textContent = `${woundText(w).replace(/^a /, '')}`;
        row.title = w.infected
          ? `Gone bad. Clean it out with lye before anything will hold on it.`
          : `${WOUND_KINDS[w.kind].note} It wants a ${WOUND_KINDS[w.kind].herb} cover.`;
        this.woundEl.append(row);
      }
      if (sorted.length > 4) {
        const more = document.createElement('div');
        more.className = 'wound-row';
        more.textContent = `and ${sorted.length - 4} more`;
        this.woundEl.append(more);
      }
    }
    const mobs = this.game.creatures.ticked;
    const watched = this.game.settings.fog ? ` · ${mobs.thought}/${mobs.near + mobs.far + mobs.asleep} mobs` : '';
    this.say(this.fpsEl, `${VERSION} · ${fps} fps · ${renderer.tilesDrawn} tiles${watched} · ${renderer.camera.zoom.toFixed(2)}×`);
    const svg = this.compass.firstElementChild as HTMLElement | null;
    if (svg) svg.style.transform = `rotate(${renderer.camera.northAngle().toFixed(1)}deg)`;
    // What is in your hands and how much armour is on you.
    const held = this.game.worn('weapon');
    const shield = this.game.worn('offhand');
    const pieces = (['head', 'chest', 'arms', 'legs', 'feet'] as const).filter((sl) => this.game.worn(sl)).length;
    if (held || shield || pieces) {
      const bits: string[] = [];
      if (held) bits.push(itemName(held));
      if (shield) bits.push(itemName(shield));
      if (pieces) bits.push(`${pieces}/5 armour`);
      this.gearEl.textContent = bits.join(' · ');
      this.gearEl.hidden = false;
    } else this.gearEl.hidden = true;
    // The four nutrients, and what the table is worth right now.
    const n = this.game.player.nutrition;
    for (const k of NUTRIENTS) {
      const fill = this.foodBars.get(k);
      if (fill) fill.style.width = `${Math.round(Math.max(0, Math.min(1, n[k])) * 100)}%`;
    }
    const worth = Math.round((tableMul(n) - 1) * 100);
    this.foodEl.title = `${fedWord(n)} — everything you do goes in ${worth}% faster. It reads off whichever of the four is shortest (${Math.round(balance(n) * 100)}%), so a full board is worth a fifth and bread alone is worth nothing.`;
    this.foodEl.classList.toggle('hud-food-full', balance(n) >= 0.999);

    const companion = this.game.creatures.active();
    if (companion) {
      const hunger = companion.hunger < 0.3 ? 'hungry' : companion.hunger < 0.6 ? 'peckish' : 'fed';
      this.companionText.textContent = `${companion.name} · ♥ ${Math.ceil(companion.health)} · ${hunger} · ${companion.stance} `;
      if (!this.companionText.parentElement) this.companionEl.prepend(this.companionText);
      this.feedBtn.disabled = !this.game.worstFoodFor(companion);
      this.companionEl.hidden = false;
    } else this.companionEl.hidden = true;
    this.eatBtn.disabled = !this.game.bestFood();
    if (this.gridBtn) this.gridBtn.classList.toggle('active', this.game.settings.grid);

    // The belt is cheap to draw but not free, so it is looked over four times a second.
    this.beltDue -= 1;
    if (this.beltDue <= 0) {
      this.beltDue = 15;
      this.drawBelt();
    }

    const a = this.game.action;
    const waiting = this.game.queue;
    /*
     * Nothing in hand, but something waiting.
     *
     * The bar used to go away entirely here and leave `queueEl` showing
     * whatever it last said, which was a stale "Then: …" line under nothing
     * at all. It has a second job now: when a walk has put the work down, the
     * bar stays up to say what is waiting and offer to take it up again,
     * because a list of jobs that is kept and never mentioned is a list that
     * has been lost as far as anybody can tell.
     */
    if (!a) {
      if (!waiting.length) {
        this.actionEl.hidden = true;
        this.queueEl.hidden = true;
        this.goBtn.hidden = true;
        return;
      }
      this.actionEl.hidden = false;
      this.goBtn.hidden = false;
      this.actionLabel.textContent = waiting.length === 1 ? 'One job put down' : `${waiting.length} jobs put down`;
      this.actionFill.style.width = '0%';
      this.queueEl.hidden = false;
      this.queueEl.textContent = `Waiting: ${this.queueWords(waiting)}`;
      this.hintEl.textContent = 'Carry on to take them up · Esc to forget them';
      return;
    }
    this.actionEl.hidden = false;
    this.goBtn.hidden = true;
    this.hintEl.textContent = 'Esc to stop · moving puts it down';
    // A counted job says how far through the count it is: "3 of 10". Coming
    // back to an island mid-job, the island knows what is left and nobody
    // knows what was asked for, so it says that instead.
    // Both numbers are the island's and belong to the same job, so the sum is
    // sound; it is still clamped, because a bar that reads "-8 of 1" is worse
    // than one that reads nothing and there is no telling what an island a
    // version behind will say.
    const at = a.goes !== undefined && a.left !== undefined ? a.goes - a.left + 1 : 0;
    const count = a.goes !== undefined && a.left !== undefined && at >= 1 && at <= a.goes
      ? ` · ${at} of ${a.goes}`
      : a.left !== undefined && a.left > 1 ? ` · ${a.left} to go` : '';
    if (a.state === 'walking') {
      this.actionLabel.textContent = `Walking over to ${a.def.label.toLowerCase()}…${count}`;
      this.actionFill.style.width = '0%';
    } else {
      const pct = Math.min(100, (a.elapsed / a.duration) * 100);
      this.actionLabel.textContent = `${a.def.label} · ${Math.max(0, a.duration - a.elapsed).toFixed(1)}s${count}`;
      this.actionFill.style.width = `${pct}%`;
    }
    // What is lined up behind it, and how much room is left in your head.
    if (waiting.length) {
      this.queueEl.hidden = false;
      this.queueEl.textContent = `Then: ${this.queueWords(waiting)} · ${waiting.length + 1}/${this.game.queueCapacity()}`;
    } else this.queueEl.hidden = true;
  }

  /**
   * The next thing to do, while there is still a first thing.
   *
   * Only rewritten when the goal changes, since this runs every frame and the
   * answer is the same from one to the next for minutes at a time.
   */
  private refreshGuide(): void {
    if (!this.game.settings.guide || ashore(this.game.ticked)) {
      if (!this.guideEl.hidden) this.guideEl.hidden = true;
      return;
    }
    const next = nextGoals(this.game.ticked, 1)[0];
    if (!next) {
      this.guideEl.hidden = true;
      return;
    }
    if (next.id === this.guideOn) return;
    this.guideOn = next.id;
    this.guideEl.hidden = false;
    const done = JOURNAL[0].goals.filter((g) => this.game.ticked.has(g.id)).length;
    this.guideTitle.textContent = `${next.text} \u00b7 ${done + 1} of ${JOURNAL[0].goals.length}`;
    this.guideBody.textContent = next.how ?? next.hint ?? '';
  }

  /**
   * What is lined up, in words. Each one says what it is *for* and not only
   * what it is: three flattens and one flatten ten times are a very different
   * afternoon.
   */
  private queueWords(queue: Game['queue']): string {
    return queue.map((q) => `${q.def.label.toLowerCase()}${(q.goes ?? 1) > 1 ? ` \u00d7${q.goes}` : ''}`).join(' \u2192 ');
  }
}
