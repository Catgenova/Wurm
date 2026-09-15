import type { Game } from '../../game/game';
import { MARK_COLOURS, MARK_CSS } from '../../game/marks';
import type { Renderer } from '../../render/renderer';
import { ROCK_VARIANTS, TileType, TILE_DEFS, rockVariant } from '../../world/tiles';
import { UNSEEN, VISIBLE } from '../../game/vision';
import type { UIWindow } from '../windows';
import { waterRgb } from '../../render/water';

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
/**
 * The widest the base picture is allowed to be, in pixels.
 *
 * It used to be one pixel to the tile, which on a thousand-tile island is a
 * megapixel and on a 4096 one is **sixteen** — a 67 MB `ImageData` and, on
 * Safari, exactly the canvas area cap. Above this the map samples: four tiles
 * to a pixel at 4096, which is what the picture is scaled down to anyway
 * before anybody sees it.
 */
const MAX_BASE = 1024;

/**
 * Contours. The map has always shown height as a wash of shading, which says
 * which way the ground falls but never how far. A line every twenty units —
 * half a tile of rise — says it exactly, and every fifth line is drawn harder,
 * which is how a walker reads a hill off a map without measuring anything.
 */
const CONTOUR_STEP = 20;
const CONTOUR_INDEX = 5;

/** A small overview map, re-painted per tile as the world changes. */
export class MinimapPanel {
  private base: HTMLCanvasElement;
  /** Tiles to a base pixel, and the size of the base picture in pixels. */
  private readonly step: number;
  private readonly bw: number;
  private readonly bh: number;
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
  /** The list of marks under the map, and whether names are drawn on it. */
  private marksEl: HTMLDivElement;
  private names = true;

  constructor(
    win: UIWindow,
    private readonly game: Game,
    private readonly renderer: Renderer,
  ) {
    const w = game.world;
    // Tiles to a pixel: one on a small island, four at 4096.
    this.step = Math.max(1, Math.ceil(Math.max(w.w, w.h) / MAX_BASE));
    this.bw = Math.ceil(w.w / this.step);
    this.bh = Math.ceil(w.h / this.step);
    this.base = document.createElement('canvas');
    this.base.width = this.bw;
    this.base.height = this.bh;
    this.baseCtx = this.base.getContext('2d') as CanvasRenderingContext2D;
    this.image = this.baseCtx.createImageData(this.bw, this.bh);
    this.view = document.createElement('canvas');
    this.view.className = 'minimap';
    // Fixed, rather than two pixels to the tile: an island of a thousand tiles
    // a side would otherwise be a four-megapixel canvas rescaled every frame.
    this.view.width = VIEW_SIZE;
    this.view.height = VIEW_SIZE;
    this.viewCtx = this.view.getContext('2d') as CanvasRenderingContext2D;
    win.body.classList.add('map-body');
    // A row of controls over the map, and the marks listed under it.
    const bar = document.createElement('div');
    bar.className = 'panel-bar map-bar';
    const dropBtn = document.createElement('button');
    dropBtn.type = 'button';
    dropBtn.className = 'tb-btn tb-small';
    dropBtn.textContent = 'Mark here';
    dropBtn.title = 'Pin a name to the tile you are standing on';
    dropBtn.addEventListener('click', () => this.drop(game.player.tileX, game.player.tileY));
    const homeBtn = document.createElement('button');
    homeBtn.type = 'button';
    homeBtn.className = 'tb-btn tb-small';
    homeBtn.textContent = 'Walk home';
    homeBtn.title = 'Set off for the settlement token, or the bed you last woke in (Home)';
    homeBtn.addEventListener('click', () => game.walkHome());
    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'tb-btn tb-small tb-on';
    nameBtn.textContent = 'Names';
    nameBtn.title = 'Write the names beside the pins, or leave the pins bare';
    nameBtn.addEventListener('click', () => {
      this.names = !this.names;
      nameBtn.classList.toggle('tb-on', this.names);
    });
    bar.append(dropBtn, homeBtn, nameBtn);
    this.marksEl = document.createElement('div');
    this.marksEl.className = 'map-marks';
    win.body.append(bar, this.view, this.marksEl);
    game.events.on('world', () => this.listMarks());
    this.listMarks();
    // Unexplored to start with, which is a fill rather than a million lookups.
    // What is known is painted the first time the map is opened.
    const px = new Uint32Array(this.image.data.buffer);
    px.fill(this.unseenPixel());
    this.lastFog = game.settings.fog;
    game.events.on('world', (x, y) => {
      for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (w.inBounds(xx, yy)) this.paint(xx, yy);
      this.dirty = true;
    });
    this.view.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const [x, y] = this.tileAt(e.clientX, e.clientY);
      this.drop(Math.floor(x), Math.floor(y));
    });
    this.view.addEventListener('click', (e) => {
      const [x, y] = this.tileAt(e.clientX, e.clientY);
      const cam = this.renderer.camera;
      cam.follow = false;
      cam.focus(x, y, w.heightAt(x, y), null);
    });
  }

  /** Where on the island a point on the drawn map is. */
  private tileAt(sx: number, sy: number): [number, number] {
    const rect = this.view.getBoundingClientRect();
    return [this.win.x + ((sx - rect.left) / rect.width) * this.win.span, this.win.y + ((sy - rect.top) / rect.height) * this.win.span];
  }

  /** Ask for a name and pin it to a tile. An empty answer drops nothing. */
  private drop(x: number, y: number): void {
    if (!this.game.world.inBounds(x, y)) return;
    const said = this.game.hooks.prompt(`Name this spot (${x}, ${y}):`, '');
    if (said === null) return;
    this.game.addMark(x, y, said);
    this.listMarks();
  }

  /** Redraw the list of marks under the map. */
  private listMarks(): void {
    const g = this.game;
    this.marksEl.replaceChildren();
    if (!g.marks.length) {
      const none = document.createElement('div');
      none.className = 'map-none';
      none.textContent = 'No marks yet. Right-click the map, or press “Mark here”, to pin a name to a spot.';
      this.marksEl.append(none);
      return;
    }
    const near = [...g.marks].sort((a, b) => Math.hypot(a.x - g.player.x, a.y - g.player.y) - Math.hypot(b.x - g.player.x, b.y - g.player.y));
    for (const m of near) {
      const row = document.createElement('div');
      row.className = 'map-mark';
      const pip = document.createElement('span');
      pip.className = 'map-pip';
      pip.style.background = MARK_CSS(m.colour);
      pip.title = 'Click for another colour';
      pip.addEventListener('click', () => {
        const i = MARK_COLOURS.findIndex((c) => c.id === m.colour);
        m.colour = MARK_COLOURS[(i + 1) % MARK_COLOURS.length].id;
        this.listMarks();
      });
      const name = document.createElement('span');
      name.className = 'map-mark-name';
      const away = Math.round(Math.hypot(m.x - g.player.x, m.y - g.player.y));
      name.textContent = m.name;
      name.title = `(${m.x}, ${m.y}), ${away} tiles off. Click to rename.`;
      name.addEventListener('click', () => {
        const said = g.hooks.prompt('What is this spot called?', m.name);
        if (said === null) return;
        g.renameMark(m.id, said);
        this.listMarks();
      });
      const dist = document.createElement('span');
      dist.className = 'map-mark-away';
      dist.textContent = `${away}`;
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'tb-btn tb-small';
      go.textContent = 'Go';
      go.title = `Walk to (${m.x}, ${m.y})`;
      go.addEventListener('click', () => {
        g.moveTo(m.x, m.y);
        g.logMsg(`Walking to ${m.name}.`, 'info');
      });
      const off = document.createElement('button');
      off.type = 'button';
      off.className = 'tb-btn tb-small tb-danger';
      off.textContent = '×';
      off.title = 'Rub this mark off the map';
      off.addEventListener('click', () => {
        g.removeMark(m.id);
        this.listMarks();
      });
      row.append(pip, name, dist, go, off);
      this.marksEl.append(row);
    }
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

  /** How big the picture is and how many tiles to a pixel, for anybody measuring. */
  get picture(): { w: number; h: number; step: number } {
    return { w: this.bw, h: this.bh, step: this.step };
  }

  private paint(x: number, y: number): void {
    const w = this.game.world;
    const i = (((y / this.step) | 0) * this.bw + ((x / this.step) | 0)) * 4;
    const d = this.image.data;
    // Three states here as in the world: nothing for land nobody has seen, the
    // land as it is where somebody is looking, and what it was where not.
    const fog = this.game.vision.state(x, y);
    // Land nobody has laid eyes on is black, as it is in the world: a hole in
    // the map rather than a dark patch of it.
    if (fog === UNSEEN) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
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
      // The same ramp the world is painted with. The map used to roll its own,
      // over a different pair of colours and a different depth, so a shelf
      // that read as pale green out of the window read as navy on the map.
      [r, g, b] = waterRgb(Math.max(0, -h));
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
      // A contour runs wherever the ground climbs past a multiple of the step
      // on the way to the tile east or south of this one.
      const band = Math.floor(h / CONTOUR_STEP);
      if (band !== Math.floor(w.centerHeight(x + 1, y) / CONTOUR_STEP) || band !== Math.floor(w.centerHeight(x, y + 1) / CONTOUR_STEP)) {
        const hard = band % CONTOUR_INDEX === 0 ? 0.55 : 0.74;
        r *= hard;
        g *= hard;
        b *= hard;
      }
    }
    /*
     * Ground out of sight keeps its shape and loses its colour. Grey rather
     * than the blue it was, for the reason the world is: this is a memory of
     * the place, not the place after dark.
     */
    if (!lit) {
      const grey = 0.299 * r + 0.587 * g + 0.114 * b;
      r = (grey + (r - grey) * 0.22) * 0.5 + 16;
      g = (grey + (g - grey) * 0.22) * 0.5 + 16;
      b = (grey + (b - grey) * 0.22) * 0.5 + 17;
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
    // Strided by the same step the picture is sampled at: at 4096 that is a
    // sixteenth of the work, and every pixel still gets a tile.
    const st = this.step;
    for (let y = Math.max(0, box.y0); y <= Math.min(w.h - 1, box.y1); y += st) {
      for (let x = Math.max(0, box.x0); x <= Math.min(w.w - 1, box.x1); x += st) this.paint(x, y);
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
    ctx.drawImage(this.base, ox / this.step, oy / this.step, view.span / this.step, view.span / this.step,
                  0, 0, this.view.width, this.view.height);
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
    // The marks, each a pin with its name written beside it. The map is drawn
    // at a fixed 512 and scaled down with nearest-neighbour, so the writing has
    // to start larger than it will end up.
    ctx.font = '15px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const m of this.game.marks) {
      const mx = (m.x + 0.5 - ox) * scale;
      const my = (m.y + 0.5 - oy) * scale;
      if (mx < -20 || my < -20 || mx > this.view.width + 20 || my > this.view.height + 20) continue;
      const css = MARK_CSS(m.colour);
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx, my - 9);
      ctx.stroke();
      ctx.strokeStyle = css;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = css;
      ctx.beginPath();
      ctx.arc(mx, my - 10, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.stroke();
      if (!this.names) continue;
      // The name sits to the right of its pin, and swaps to the left rather
      // than running off the edge of the map.
      const w = ctx.measureText(m.name).width;
      const right = mx + 6 + w + 6 <= this.view.width;
      const bx = right ? mx + 6 : Math.max(0, mx - 6 - w - 6);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(bx, my - 20, w + 6, 17);
      ctx.fillStyle = css;
      ctx.fillText(m.name, bx + 3, my - 11);
    }
    const p = this.game.player;
    ctx.fillStyle = '#ffe36e';
    ctx.beginPath();
    ctx.arc((p.x - ox) * scale, (p.y - oy) * scale, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
