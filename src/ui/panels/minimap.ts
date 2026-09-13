import type { Game } from '../../game/game';
import type { Renderer } from '../../render/renderer';
import { TileType, TILE_DEFS } from '../../world/tiles';
import type { UIWindow } from '../windows';

/** A small overview map, re-painted per tile as the world changes. */
export class MinimapPanel {
  private base: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private view: HTMLCanvasElement;
  private viewCtx: CanvasRenderingContext2D;
  private dirty = true;

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
    const t = w.getTile(x, y);
    const def = TILE_DEFS[t];
    const h = w.centerHeight(x, y);
    let r = def.color[0];
    let g = def.color[1];
    let b = def.color[2];
    if (w.hasWater(x, y)) {
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
    const i = (y * w.w + x) * 4;
    const d = this.image.data;
    d[i] = Math.min(255, r);
    d[i + 1] = Math.min(255, g);
    d[i + 2] = Math.min(255, b);
    d[i + 3] = 255;
  }

  update(): void {
    if (this.view.closest('.win')?.hasAttribute('hidden')) return;
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
    const p = this.game.player;
    ctx.fillStyle = '#ffe36e';
    ctx.beginPath();
    ctx.arc(p.x * scale, p.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }
}
