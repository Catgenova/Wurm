import { clockLeft } from '../game/boons';
import { SKILL_DEFS } from '../game/skills';
import { MAX_LEVELS } from '../game/building';
import type { Game } from '../game/game';
import { itemName } from '../game/items';
import { ACTION_BY_ID } from '../game/actions';
import type { Renderer } from '../render/renderer';

export interface HudCallbacks {
  toggle: (id: string) => void;
  toggleGrid: () => void;
  center: () => void;
  newWorld: () => void;
  turn: (step: number) => void;
}

interface Bar {
  fill: HTMLDivElement;
  value: HTMLSpanElement;
}

const BUTTONS: Array<{ label: string; key: string; action: (cb: HudCallbacks) => void; id?: string }> = [
  { label: 'Inventory', key: 'I', action: (cb) => cb.toggle('inventory') },
  { label: 'Craft', key: 'R', action: (cb) => cb.toggle('craft') },
  { label: 'Tile', key: 'T', action: (cb) => cb.toggle('tile') },
  { label: 'Skills', key: 'K', action: (cb) => cb.toggle('skills') },
  { label: 'Events', key: 'L', action: (cb) => cb.toggle('events') },
  { label: 'Map', key: 'M', action: (cb) => cb.toggle('map') },
  { label: 'Wildermon', key: 'P', action: (cb) => cb.toggle('wildermon') },
  { label: 'Grid', key: 'G', action: (cb) => cb.toggleGrid(), id: 'grid' },
  { label: 'Centre', key: 'C', action: (cb) => cb.center() },
  { label: '↻ Turn', key: 'Q', action: (cb) => cb.turn(-1) },
  { label: '↺ Turn', key: 'E', action: (cb) => cb.turn(1) },
  { label: 'Settings', key: 'O', action: (cb) => cb.toggle('settings') },
  { label: 'Help', key: 'F1', action: (cb) => cb.toggle('help') },
  { label: 'New world', key: '', action: (cb) => cb.newWorld(), id: 'new' },
];

/** Status bars, the action timer and the toolbar. */
/** 1st, 2nd, 3rd, 4th... for the storey label. */
function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export class Hud {
  private bars: Record<string, Bar> = {};
  private nameEl: HTMLDivElement;
  private posEl: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private actionEl: HTMLDivElement;
  private actionLabel: HTMLDivElement;
  private actionFill: HTMLDivElement;
  private queueEl: HTMLDivElement;
  private gridBtn: HTMLButtonElement | null = null;
  private compass: HTMLSpanElement;
  private companionEl: HTMLDivElement;
  private gearEl: HTMLDivElement;
  private eatBtn!: HTMLButtonElement;
  private feedBtn!: HTMLButtonElement;
  private companionText = document.createElement('span');
  private boonEl: HTMLDivElement;
  private storeyEl: HTMLDivElement;
  private storeyLabel: HTMLButtonElement;
  private storeyUp: HTMLButtonElement;
  private storeyDown: HTMLButtonElement;
  private cutBtn: HTMLButtonElement;

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
    for (const b of BUTTONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tb-btn' + (b.id === 'new' ? ' tb-danger' : '');
      btn.innerHTML = `${b.label}${b.key ? ` <kbd>${b.key}</kbd>` : ''}`;
      btn.addEventListener('click', () => b.action(cb));
      if (b.id === 'grid') this.gridBtn = btn;
      toolbar.append(btn);
    }
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
    const hint = document.createElement('div');
    hint.className = 'action-hint';
    hint.textContent = 'Esc or move to stop';
    this.actionEl.append(this.actionLabel, track, this.queueEl, hint);
    root.append(this.actionEl);

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

  update(renderer: Renderer, fps: number): void {
    this.refreshStorey();
    const p = this.game.player;
    this.nameEl.textContent = p.name;
    for (const [id, bar] of Object.entries(this.bars)) {
      const v = p.stats[id as keyof typeof p.stats];
      bar.fill.style.width = `${Math.round(v * 100)}%`;
      bar.value.textContent = `${Math.round(v * 100)}%`;
    }
    const h = this.game.world.heightAt(p.x, p.y);
    const deed = this.game.deed && this.game.onDeed(p.tileX, p.tileY) ? `  ·  ${this.game.deed.name}` : '';
    this.posEl.textContent = `${p.tileX}, ${p.tileY}  ·  h ${h.toFixed(0)}  ·  ${this.game.clock()}${p.swimming ? '  ·  swimming' : ''}${deed}`;
    // Rest and affinities, when there are any.
    const rested = this.game.player.rested;
    const boons = this.game.activeBoons();
    const parts: string[] = [];
    if (rested > 0) parts.push(`Rested ${clockLeft(rested)} · everything ×2`);
    for (const b of boons) {
      const name = SKILL_DEFS.find((d) => d.id === b.skill)?.name ?? b.skill;
      parts.push(`${name} +${Math.round(b.bonus * 100)}% · ${clockLeft(b.until - this.game.time)}`);
    }
    this.boonEl.hidden = !parts.length;
    if (parts.length) this.boonEl.textContent = parts.join('  ·  ');
    const mobs = this.game.creatures.ticked;
    const watched = this.game.settings.fog ? ` · ${mobs.thought}/${mobs.near + mobs.far + mobs.asleep} mobs` : '';
    this.fpsEl.textContent = `${fps} fps · ${renderer.tilesDrawn} tiles${watched} · ${renderer.camera.zoom.toFixed(2)}×`;
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

    const a = this.game.action;
    if (!a) {
      this.actionEl.hidden = true;
      return;
    }
    this.actionEl.hidden = false;
    if (a.state === 'walking') {
      this.actionLabel.textContent = `Walking over to ${a.def.label.toLowerCase()}…`;
      this.actionFill.style.width = '0%';
    } else {
      const pct = Math.min(100, (a.elapsed / a.duration) * 100);
      this.actionLabel.textContent = `${a.def.label} · ${Math.max(0, a.duration - a.elapsed).toFixed(1)}s`;
      this.actionFill.style.width = `${pct}%`;
    }
    // What is lined up behind it, and how much room is left in your head.
    const queue = this.game.queue;
    if (queue.length) {
      this.queueEl.hidden = false;
      this.queueEl.textContent = `Then: ${queue.map((q) => q.def.label.toLowerCase()).join(' → ')} · ${queue.length + 1}/${this.game.queueCapacity()}`;
    } else this.queueEl.hidden = true;
  }
}
