import type { Game } from '../game/game';
import type { Renderer } from '../render/renderer';

export interface HudCallbacks {
  toggle: (id: string) => void;
  toggleGrid: () => void;
  center: () => void;
  newWorld: () => void;
}

interface Bar {
  fill: HTMLDivElement;
  value: HTMLSpanElement;
}

const BUTTONS: Array<{ label: string; key: string; action: (cb: HudCallbacks) => void; id?: string }> = [
  { label: 'Inventory', key: 'I', action: (cb) => cb.toggle('inventory') },
  { label: 'Skills', key: 'K', action: (cb) => cb.toggle('skills') },
  { label: 'Events', key: 'L', action: (cb) => cb.toggle('events') },
  { label: 'Map', key: 'M', action: (cb) => cb.toggle('map') },
  { label: 'Grid', key: 'G', action: (cb) => cb.toggleGrid(), id: 'grid' },
  { label: 'Centre', key: 'C', action: (cb) => cb.center() },
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
    this.posEl = document.createElement('div');
    this.posEl.className = 'hud-pos';
    status.append(this.posEl);
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
    this.posEl.textContent = `${p.tileX}, ${p.tileY}  ·  h ${h.toFixed(0)}${p.swimming ? '  ·  swimming' : ''}`;
    this.fpsEl.textContent = `${fps} fps · ${renderer.tilesDrawn} tiles · ${renderer.camera.zoom.toFixed(2)}×`;
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
