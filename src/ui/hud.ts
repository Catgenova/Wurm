import type { Game } from '../game/game';
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
export class Hud {
  private bars: Record<string, Bar> = {};
  private nameEl: HTMLDivElement;
  private posEl: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private actionEl: HTMLDivElement;
  private actionLabel: HTMLDivElement;
  private actionFill: HTMLDivElement;
  private gridBtn: HTMLButtonElement | null = null;
  private compass: HTMLSpanElement;
  private companionEl: HTMLDivElement;

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
    this.companionEl = document.createElement('div');
    this.companionEl.className = 'hud-companion';
    this.companionEl.hidden = true;
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
    const hint = document.createElement('div');
    hint.className = 'action-hint';
    hint.textContent = 'Esc or move to stop';
    this.actionEl.append(this.actionLabel, track, hint);
    root.append(this.actionEl);
  }

  update(renderer: Renderer, fps: number): void {
    const p = this.game.player;
    this.nameEl.textContent = p.name;
    for (const [id, bar] of Object.entries(this.bars)) {
      const v = p.stats[id as keyof typeof p.stats];
      bar.fill.style.width = `${Math.round(v * 100)}%`;
      bar.value.textContent = `${Math.round(v * 100)}%`;
    }
    const h = this.game.world.heightAt(p.x, p.y);
    const deed = this.game.deed && this.game.onDeed(p.tileX, p.tileY) ? `  ·  ${this.game.deed.name}` : '';
    this.posEl.textContent = `${p.tileX}, ${p.tileY}  ·  h ${h.toFixed(0)}${p.swimming ? '  ·  swimming' : ''}${deed}`;
    this.fpsEl.textContent = `${fps} fps · ${renderer.tilesDrawn} tiles · ${renderer.camera.zoom.toFixed(2)}×`;
    const svg = this.compass.firstElementChild as HTMLElement | null;
    if (svg) svg.style.transform = `rotate(${renderer.camera.northAngle().toFixed(1)}deg)`;
    const companion = this.game.creatures.active();
    if (companion) {
      const hunger = companion.hunger < 0.3 ? 'hungry' : companion.hunger < 0.6 ? 'peckish' : 'fed';
      this.companionEl.textContent = `${companion.name} · ♥ ${Math.ceil(companion.health)} · ${hunger} · ${companion.stance}`;
      this.companionEl.hidden = false;
    } else this.companionEl.hidden = true;
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
  }
}
