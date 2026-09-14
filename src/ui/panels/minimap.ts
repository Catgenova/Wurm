import type { Game } from '../../game/game';
import type { Renderer } from '../../render/renderer';
import { ROCK_VARIANTS, TileType, TILE_DEFS, rockVariant } from '../../world/tiles';
import { UNSEEN, VISIBLE } from '../../game/vision';
import type { UIWindow } from '../windows';

/** How wide the drawn map is, whatever size the island is. */
const VIEW_SIZE = 512;
/**
 * The smallest window the map will show, in tiles. A thousand-tile island
 * drawn whole is a black square with a speck of coast in it, so the map shows
 * what you know of it instead: a window around the ground you have walked,
 * widening as you explore and never narrowing, out to the whole island once
 * you have been round it.
 */
const MIN_SPAN = 64;

/** A small overview map, re-painted per tile as the world changes. */
export class MinimapPanel {
  private base: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private view: HTMLCanvasElement;
  private viewCtx: CanvasRenderingContext2D;
  private dirty = true;
  private lastVision = -1;
  private painted = false;
  private lastFog = true;
  /** The window drawn last, in tiles: where it sits and how wide it is. */
  private win = { x: 0, y: 0, span: MIN_SPAN };

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
    // Fixed, rather than two pixels to the tile: an island of a thousand tiles
    // a side would otherwise be a four-megapixel canvas rescaled every frame.
    this.view.width = VIEW_SIZE;
    this.view.height = VIEW_SIZE;
    this.viewCtx = this.view.getContext('2d') as CanvasRenderingContext2D;
    win.body.classList.add('map-body');
    win.body.append(this.view);
    // Unexplored to start with, which is a fill rather than a million lookups.
    // What is known is painted the first time the map is opened.
    const px = new Uint32Array(this.image.data.buffer);
    px.fill(this.unseenPixel());
    this.lastFog = game.settings.fog;
    game.events.on('world', (x, y) => {
      for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (w.inBounds(xx, yy)) this.paint(xx, yy);
      this.dirty = true;
    });
    this.view.addEventListener('click', (e) => {
      const rect = this.view.getBoundingClientRect();
      const x = this.win.x + ((e.clientX - rect.left) / rect.width) * this.win.span;
      const y = this.win.y + ((e.clientY - rect.top) / rect.height) * this.win.span;
      const cam = this.renderer.camera;
      cam.follow = false;
      cam.focus(x, y, w.heightAt(x, y), null);
    });
  }

  /** The colour of ground nobody has seen, as one packed pixel. */
  private unseenPixel(): number {
    // Little end first: alpha, blue, green, red.
    return (255 << 24) | (30 << 16) | (20 << 8) | 16;
  }

  /**
   * Where the map looks, in tiles. It holds everything known and the player
   * with it, squared off and widened to the next power of two so that it
   * settles rather than creeping as the fog rolls back.
   */
  private window(): { x: number; y: number; span: number } {
    const w = this.game.world;
    const p = this.game.player;
    const b = w.knownBox;
    const seen = b.x1 >= 0 && this.game.settings.fog;
    let x0 = seen ? Math.min(b.x0, p.x - 8) : 0;
    let y0 = seen ? Math.min(b.y0, p.y - 8) : 0;
    let x1 = seen ? Math.max(b.x1, p.x + 8) : w.w - 1;
    let y1 = seen ? Math.max(b.y1, p.y + 8) : w.h - 1;
    let span = Math.max(MIN_SPAN, x1 - x0 + 1, y1 - y0 + 1);
    // Up to the next power of two, and never wider than the island.
    span = Math.min(Math.max(w.w, w.h), 2 ** Math.ceil(Math.log2(span)));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    x0 = Math.round(Math.max(0, Math.min(w.w - span, cx - span / 2)));
    y0 = Math.round(Math.max(0, Math.min(w.h - span, cy - span / 2)));
    return { x: x0, y: y0, span };
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
    const fog = this.game.settings.fog;
    // Turning the fog off shows the island whole, which is a fresh painting of
    // all of it; turning it back on is the same in reverse.
    const settingChanged = fog !== this.lastFog;
    if (v.revision === this.lastVision && this.painted && !settingChanged) return;
    const w = this.game.world;
    const all = { x0: 0, y0: 0, x1: w.w - 1, y1: w.h - 1 };
    const known = fog && w.knownBox.x1 >= 0 ? w.knownBox : all;
    // First look, or a change of setting: everything there is to see. After
    // that, only the box the last look around changed.
    const box = !this.painted || settingChanged || !v.dirty ? known : v.dirty;
    this.lastVision = v.revision;
    this.lastFog = fog;
    this.painted = true;
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
    const view = this.window();
    this.win = view;
    const scale = this.view.width / view.span;
    const ox = view.x;
    const oy = view.y;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, ox, oy, view.span, view.span, 0, 0, this.view.width, this.view.height);
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
    corners.forEach((c, i) => (i === 0 ? ctx.moveTo((c.x - ox) * scale, (c.y - oy) * scale) : ctx.lineTo((c.x - ox) * scale, (c.y - oy) * scale)));
    ctx.closePath();
    ctx.stroke();
    const deed = this.game.deed;
    if (deed) {
      ctx.strokeStyle = 'rgba(96, 230, 110, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect((deed.x - deed.radius - ox) * scale, (deed.y - deed.radius - oy) * scale, (deed.radius * 2 + 1) * scale, (deed.radius * 2 + 1) * scale);
      ctx.lineWidth = 1;
    }
    const p = this.game.player;
    ctx.fillStyle = '#ffe36e';
    ctx.beginPath();
    ctx.arc((p.x - ox) * scale, (p.y - oy) * scale, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }
}
