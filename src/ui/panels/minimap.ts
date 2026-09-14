import type { Game } from '../../game/game';
import type { Renderer } from '../../render/renderer';
import { ROCK_VARIANTS, TileType, TILE_DEFS, rockVariant } from '../../world/tiles';
import { UNSEEN, VISIBLE } from '../../game/vision';
import type { UIWindow } from '../windows';

/** A small overview map, re-painted per tile as the world changes. */
export class MinimapPanel {
  private base: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private view: HTMLCanvasElement;
  private viewCtx: CanvasRenderingContext2D;
  private dirty = true;
  private lastVision = -1;

  constructor(
    win: UIWindow,
    private readonly game: Game,
    private readonly renderer: Renderer,
  ) {
    const w = game.world;
    this.base = document.createElement('canvas');
    this.base.width = w.w;
    this.base.height = w.h;
    this.baseCtx = this.base.getContext('2d') as CanvasRenderingContext2D;
    this.image = this.baseCtx.createImageData(w.w, w.h);
    this.view = document.createElement('canvas');
    this.view.className = 'minimap';
    this.view.width = w.w * 2;
    this.view.height = w.h * 2;
    this.viewCtx = this.view.getContext('2d') as CanvasRenderingContext2D;
    win.body.classList.add('map-body');
    win.body.append(this.view);
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) this.paint(x, y);
    game.events.on('world', (x, y) => {
      for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (w.inBounds(xx, yy)) this.paint(xx, yy);
      this.dirty = true;
    });
    this.view.addEventListener('click', (e) => {
      const rect = this.view.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * w.w;
      const y = ((e.clientY - rect.top) / rect.height) * w.h;
      const cam = this.renderer.camera;
      cam.follow = false;
      cam.focus(x, y, w.heightAt(x, y), null);
    });
  }

  private paint(x: number, y: number): void {
    const w = this.game.world;
    const i = (y * w.w + x) * 4;
    const d = this.image.data;
    // Three states here as in the world: nothing for land nobody has seen, the
    // land as it is where somebody is looking, and what it was where not.
    const fog = this.game.vision.state(x, y);
    if (fog === UNSEEN) {
      d[i] = 16;
      d[i + 1] = 20;
      d[i + 2] = 30;
      d[i + 3] = 255;
      return;
    }
    const lit = fog === VISIBLE;
    const t = w.viewTile(x, y, lit);
    const def = TILE_DEFS[t];
    const h = w.centerHeight(x, y);
    const base = t === TileType.Rock ? ROCK_VARIANTS[rockVariant(w.viewData(x, y, lit))].color : def.color;
    let r = base[0];
    let g = base[1];
    let b = base[2];
    if (this.game.buildings.buildingAt(x, y)) {
      r = 84;
      g = 60;
      b = 40;
    } else if (w.hasWater(x, y)) {
      const k = Math.max(0.35, 1 - Math.max(0, -h) / 60);
      r = 30 * k + 20;
      g = 80 * k + 30;
      b = 140 * k + 50;
    } else {
      const slope = w.getHeight(x + 1, y + 1) - w.getHeight(x, y);
      const shade = 0.9 + Math.max(-0.35, Math.min(0.25, -slope / 60));
      r *= shade;
      g *= shade;
      b *= shade;
      if (t === TileType.Tree) {
        r *= 0.8;
        g *= 0.85;
        b *= 0.8;
      }
    }
    // Ground out of sight keeps its shape but loses its light.
    if (!lit) {
      r = r * 0.42 + 14;
      g = g * 0.42 + 18;
      b = b * 0.46 + 30;
    }
    d[i] = Math.min(255, r);
    d[i + 1] = Math.min(255, g);
    d[i + 2] = Math.min(255, b);
    d[i + 3] = 255;
  }

  /** Repaint the box the last look around changed, rather than the island. */
  private followVision(): void {
    const v = this.game.vision;
    if (v.revision === this.lastVision) return;
    const w = this.game.world;
    const box = this.lastVision < 0 || !v.dirty ? { x0: 0, y0: 0, x1: w.w - 1, y1: w.h - 1 } : v.dirty;
    this.lastVision = v.revision;
    for (let y = Math.max(0, box.y0); y <= Math.min(w.h - 1, box.y1); y++) {
      for (let x = Math.max(0, box.x0); x <= Math.min(w.w - 1, box.x1); x++) this.paint(x, y);
    }
    this.dirty = true;
  }

  update(): void {
    if (this.view.closest('.win')?.hasAttribute('hidden')) return;
    this.followVision();
    if (this.dirty) {
      this.baseCtx.putImageData(this.image, 0, 0);
      this.dirty = false;
    }
    const ctx = this.viewCtx;
    const w = this.game.world;
    const scale = this.view.width / w.w;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, this.view.width, this.view.height);
    const cam = this.renderer.camera;
    const corners = [
      cam.screenToWorld(0, 0),
      cam.screenToWorld(cam.width, 0),
      cam.screenToWorld(cam.width, cam.height),
      cam.screenToWorld(0, cam.height),
    ];
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x * scale, c.y * scale) : ctx.lineTo(c.x * scale, c.y * scale)));
    ctx.closePath();
    ctx.stroke();
    const deed = this.game.deed;
    if (deed) {
      ctx.strokeStyle = 'rgba(96, 230, 110, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect((deed.x - deed.radius) * scale, (deed.y - deed.radius) * scale, (deed.radius * 2 + 1) * scale, (deed.radius * 2 + 1) * scale);
      ctx.lineWidth = 1;
    }
    const p = this.game.player;
    ctx.fillStyle = '#ffe36e';
    ctx.beginPath();
    ctx.arc(p.x * scale, p.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }
}
